-- Create comprehensive audit logging tables for HIPAA/GDPR compliance

-- Main audit log table
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    user_email VARCHAR(255),
    user_role VARCHAR(50),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id INTEGER,
    ip_address INET,
    user_agent TEXT,
    request_method VARCHAR(10),
    request_path TEXT,
    response_status INTEGER,
    details JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    
    -- Indexes for performance
    INDEX idx_audit_user_id (user_id),
    INDEX idx_audit_created_at (created_at),
    INDEX idx_audit_action (action),
    INDEX idx_audit_resource (resource_type, resource_id)
);

-- Data access log for HIPAA compliance
CREATE TABLE IF NOT EXISTS data_access_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    patient_id INTEGER,
    access_type VARCHAR(50) NOT NULL, -- 'view', 'create', 'update', 'delete'
    table_accessed VARCHAR(50),
    fields_accessed TEXT[],
    reason TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    
    INDEX idx_access_patient (patient_id),
    INDEX idx_access_user (user_id),
    INDEX idx_access_time (created_at)
);

-- Login attempts log for security monitoring
CREATE TABLE IF NOT EXISTS login_attempts (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255),
    ip_address INET,
    success BOOLEAN NOT NULL,
    failure_reason VARCHAR(100),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    
    INDEX idx_login_email (email),
    INDEX idx_login_ip (ip_address),
    INDEX idx_login_time (created_at)
);

-- Data retention policy table for GDPR
CREATE TABLE IF NOT EXISTS data_retention_policies (
    id SERIAL PRIMARY KEY,
    table_name VARCHAR(50) NOT NULL UNIQUE,
    retention_days INTEGER NOT NULL,
    last_cleanup TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Insert default retention policies
INSERT INTO data_retention_policies (table_name, retention_days) VALUES
    ('audit_logs', 2555),        -- 7 years for audit logs (HIPAA requirement)
    ('login_attempts', 90),      -- 90 days for login attempts
    ('data_access_logs', 1095),  -- 3 years for data access logs
    ('sessions', 30)              -- 30 days for sessions
ON CONFLICT (table_name) DO NOTHING;

-- Function to log data access automatically
CREATE OR REPLACE FUNCTION log_data_access()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO data_access_logs (
        user_id,
        patient_id,
        access_type,
        table_accessed,
        created_at
    ) VALUES (
        current_setting('app.current_user_id', true)::INTEGER,
        CASE 
            WHEN TG_TABLE_NAME = 'patients' THEN NEW.id
            WHEN TG_TABLE_NAME = 'medical_records' THEN NEW.patient_id
            WHEN TG_TABLE_NAME = 'invoices' THEN NEW.patient_id
            ELSE NULL
        END,
        TG_OP,
        TG_TABLE_NAME,
        NOW()
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for sensitive tables
CREATE TRIGGER log_patient_access
AFTER INSERT OR UPDATE OR DELETE ON patients
FOR EACH ROW EXECUTE FUNCTION log_data_access();

CREATE TRIGGER log_medical_record_access
AFTER INSERT OR UPDATE OR DELETE ON medical_records
FOR EACH ROW EXECUTE FUNCTION log_data_access();

CREATE TRIGGER log_invoice_access
AFTER INSERT OR UPDATE OR DELETE ON invoices
FOR EACH ROW EXECUTE FUNCTION log_data_access();

-- View for GDPR data export (right to data portability)
CREATE OR REPLACE VIEW patient_data_export AS
SELECT 
    p.id as patient_id,
    p.name,
    p.email,
    p.phone,
    p.date_of_birth,
    p.gender,
    p.address,
    p.created_at as registration_date,
    json_agg(DISTINCT jsonb_build_object(
        'date', mr.created_at,
        'diagnosis', mr.diagnosis,
        'treatment', mr.treatment
    )) FILTER (WHERE mr.id IS NOT NULL) as medical_history,
    json_agg(DISTINCT jsonb_build_object(
        'date', i.created_at,
        'amount', i.total_amount,
        'status', i.payment_status
    )) FILTER (WHERE i.id IS NOT NULL) as billing_history
FROM patients p
LEFT JOIN medical_records mr ON p.id = mr.patient_id
LEFT JOIN invoices i ON p.id = i.patient_id
GROUP BY p.id;

-- Function for GDPR right to erasure (right to be forgotten)
CREATE OR REPLACE FUNCTION gdpr_delete_patient_data(patient_id_param INTEGER)
RETURNS JSONB AS $$
DECLARE
    deleted_count JSONB;
BEGIN
    -- Start transaction
    deleted_count = jsonb_build_object('status', 'started', 'patient_id', patient_id_param);
    
    -- Delete from dependent tables
    DELETE FROM medical_records WHERE patient_id = patient_id_param;
    DELETE FROM invoices WHERE patient_id = patient_id_param;
    DELETE FROM appointments WHERE patient_id = patient_id_param;
    DELETE FROM lab_results WHERE patient_id = patient_id_param;
    DELETE FROM admissions WHERE patient_id = patient_id_param;
    
    -- Finally delete the patient
    DELETE FROM patients WHERE id = patient_id_param;
    
    -- Log the deletion for compliance
    INSERT INTO audit_logs (action, resource_type, resource_id, details)
    VALUES ('GDPR_DELETE', 'patient', patient_id_param, 
            jsonb_build_object('reason', 'Right to erasure requested', 'timestamp', NOW()));
    
    RETURN jsonb_build_object(
        'status', 'success',
        'patient_id', patient_id_param,
        'deleted_at', NOW()
    );
END;
$$ LANGUAGE plpgsql;

-- Create session management table for security
CREATE TABLE IF NOT EXISTS user_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    token_hash VARCHAR(255) UNIQUE NOT NULL,
    ip_address INET,
    user_agent TEXT,
    last_activity TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    
    INDEX idx_session_token (token_hash),
    INDEX idx_session_user (user_id),
    INDEX idx_session_expires (expires_at)
);

-- Function to clean up expired sessions
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM user_sessions WHERE expires_at < NOW() OR is_active = false;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Add encrypted_data column for sensitive fields (future enhancement)
ALTER TABLE patients ADD COLUMN IF NOT EXISTS encrypted_data BYTEA;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS encrypted_notes BYTEA;

-- Create backup metadata table
CREATE TABLE IF NOT EXISTS backup_history (
    id SERIAL PRIMARY KEY,
    backup_type VARCHAR(50) NOT NULL, -- 'full', 'incremental', 'point-in-time'
    backup_location TEXT,
    backup_size BIGINT,
    tables_backed_up TEXT[],
    success BOOLEAN NOT NULL,
    error_message TEXT,
    started_at TIMESTAMP NOT NULL,
    completed_at TIMESTAMP,
    created_by VARCHAR(100),
    
    INDEX idx_backup_time (started_at DESC)
);

-- Performance monitoring table
CREATE TABLE IF NOT EXISTS performance_metrics (
    id SERIAL PRIMARY KEY,
    metric_type VARCHAR(50) NOT NULL, -- 'query_time', 'api_response', 'db_connection'
    metric_value DECIMAL(10,3),
    endpoint TEXT,
    query_text TEXT,
    execution_time_ms INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    
    INDEX idx_perf_type (metric_type),
    INDEX idx_perf_time (created_at DESC)
);

-- Create view for security dashboard
CREATE OR REPLACE VIEW security_dashboard AS
SELECT 
    (SELECT COUNT(*) FROM login_attempts WHERE created_at > NOW() - INTERVAL '24 hours') as login_attempts_24h,
    (SELECT COUNT(*) FROM login_attempts WHERE success = false AND created_at > NOW() - INTERVAL '24 hours') as failed_logins_24h,
    (SELECT COUNT(DISTINCT user_id) FROM audit_logs WHERE created_at > NOW() - INTERVAL '24 hours') as active_users_24h,
    (SELECT COUNT(*) FROM data_access_logs WHERE created_at > NOW() - INTERVAL '24 hours') as data_accesses_24h,
    (SELECT COUNT(DISTINCT ip_address) FROM audit_logs WHERE created_at > NOW() - INTERVAL '24 hours') as unique_ips_24h,
    (SELECT MAX(created_at) FROM backup_history WHERE success = true) as last_successful_backup;

COMMENT ON TABLE audit_logs IS 'HIPAA-compliant audit log tracking all user actions';
COMMENT ON TABLE data_access_logs IS 'Tracks access to patient data for HIPAA compliance';
COMMENT ON TABLE login_attempts IS 'Security monitoring for authentication attempts';
COMMENT ON TABLE data_retention_policies IS 'GDPR-compliant data retention configuration';
COMMENT ON TABLE user_sessions IS 'Secure session management with token hashing';
COMMENT ON VIEW patient_data_export IS 'GDPR Article 20 - Right to data portability';
COMMENT ON FUNCTION gdpr_delete_patient_data IS 'GDPR Article 17 - Right to erasure';

-- Grant appropriate permissions (adjust based on your roles)
GRANT SELECT ON security_dashboard TO PUBLIC;
GRANT ALL ON audit_logs TO neondb_owner;
GRANT ALL ON data_access_logs TO neondb_owner;
GRANT ALL ON login_attempts TO neondb_owner;
