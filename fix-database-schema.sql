-- Fix database schema issues

-- Ensure uploads directory exists for file uploads
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Add missing columns to existing tables
ALTER TABLE patients ADD COLUMN IF NOT EXISTS registered_date TIMESTAMP DEFAULT NOW();
ALTER TABLE patients ADD COLUMN IF NOT EXISTS emergency_contact JSONB;

ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS doctor_id UUID;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS symptoms TEXT;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS treatment_plan TEXT;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS vital_signs JSONB;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS items JSONB;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_amount DECIMAL(10,2) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS balance DECIMAL(10,2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS insurance_claim JSONB;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;

ALTER TABLE inventory ADD COLUMN IF NOT EXISTS category VARCHAR(100);
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS unit VARCHAR(50);
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS reorder_level INTEGER;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS unit_price DECIMAL(10,2);
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS supplier_id UUID;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS last_updated TIMESTAMP;

ALTER TABLE staff ADD COLUMN IF NOT EXISTS department VARCHAR(100);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS role VARCHAR(100);

ALTER TABLE beds ADD COLUMN IF NOT EXISTS ward_id UUID;
ALTER TABLE beds ADD COLUMN IF NOT EXISTS bed_number VARCHAR(20);
ALTER TABLE beds ADD COLUMN IF NOT EXISTS bed_type VARCHAR(50);
ALTER TABLE beds ADD COLUMN IF NOT EXISTS current_patient_id UUID;

ALTER TABLE admissions ADD COLUMN IF NOT EXISTS admission_reason TEXT;
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS admission_date TIMESTAMP;
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS expected_discharge DATE;
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS discharge_date TIMESTAMP;
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS discharge_notes TEXT;
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS follow_up_date DATE;

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS appointment_time TIME;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS department_id UUID;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS test_name VARCHAR(200);
ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS test_type VARCHAR(100);
ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS results JSONB;
ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS normal_range TEXT;
ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS technician_id UUID;

ALTER TABLE hospital_applications ADD COLUMN IF NOT EXISTS owner_name VARCHAR(200);
ALTER TABLE hospital_applications ADD COLUMN IF NOT EXISTS owner_email VARCHAR(200);
ALTER TABLE hospital_applications ADD COLUMN IF NOT EXISTS owner_phone VARCHAR(50);
ALTER TABLE hospital_applications ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE hospital_applications ADD COLUMN IF NOT EXISTS bed_capacity INTEGER;
ALTER TABLE hospital_applications ADD COLUMN IF NOT EXISTS specialties JSONB;
ALTER TABLE hospital_applications ADD COLUMN IF NOT EXISTS score DECIMAL(5,2);

ALTER TABLE application_documents ADD COLUMN IF NOT EXISTS document_type VARCHAR(100);
ALTER TABLE application_documents ADD COLUMN IF NOT EXISTS file_path TEXT;
ALTER TABLE application_documents ADD COLUMN IF NOT EXISTS file_name VARCHAR(255);
ALTER TABLE application_documents ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMP DEFAULT NOW();

ALTER TABLE application_evaluations ADD COLUMN IF NOT EXISTS evaluator_id UUID;
ALTER TABLE application_evaluations ADD COLUMN IF NOT EXISTS scores JSONB;
ALTER TABLE application_evaluations ADD COLUMN IF NOT EXISTS total_score DECIMAL(5,2);
ALTER TABLE application_evaluations ADD COLUMN IF NOT EXISTS comments TEXT;

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS application_id UUID;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_path TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS terms TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS signature_data TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS signed_at TIMESTAMP;

-- Rename onboardingprogress to onboarding_progress if needed
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'onboardingprogress') THEN
        ALTER TABLE onboardingprogress RENAME TO onboarding_progress;
    END IF;
END $$;

-- Add missing columns to onboarding_progress
ALTER TABLE onboarding_progress ADD COLUMN IF NOT EXISTS application_id UUID;
ALTER TABLE onboarding_progress ADD COLUMN IF NOT EXISTS step VARCHAR(100);
ALTER TABLE onboarding_progress ADD COLUMN IF NOT EXISTS status VARCHAR(50);
ALTER TABLE onboarding_progress ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Create missing tables if they don't exist
CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200),
    contact_email VARCHAR(200),
    contact_phone VARCHAR(50),
    address TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID,
    type VARCHAR(50),
    quantity INTEGER,
    reason TEXT,
    patient_id UUID,
    user_id UUID,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reorder_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID UNIQUE,
    item_name VARCHAR(200),
    current_quantity INTEGER,
    reorder_level INTEGER,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staff_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID,
    date DATE,
    shift_start TIME,
    shift_end TIME,
    department VARCHAR(100),
    notes TEXT,
    created_by UUID,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staff_attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID,
    check_type VARCHAR(50),
    check_time TIMESTAMP,
    location VARCHAR(200),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_revenue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE,
    total_revenue DECIMAL(10,2),
    transaction_count INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Add test data
INSERT INTO evaluation_criteria (id, criteria_name, weight, max_score)
VALUES 
    (gen_random_uuid(), 'Infrastructure', 40, 100),
    (gen_random_uuid(), 'Staff Qualification', 30, 100),
    (gen_random_uuid(), 'Equipment', 30, 100)
ON CONFLICT DO NOTHING;

INSERT INTO onboarding_checklist (id, item_name, description, sequence, is_mandatory)
VALUES
    (gen_random_uuid(), 'Application Submitted', 'Initial application received', 1, true),
    (gen_random_uuid(), 'Documents Verified', 'All required documents checked', 2, true),
    (gen_random_uuid(), 'Evaluation Completed', 'Technical evaluation done', 3, true),
    (gen_random_uuid(), 'Contract Generated', 'Partnership contract created', 4, true),
    (gen_random_uuid(), 'Contract Signed', 'Contract digitally signed', 5, true),
    (gen_random_uuid(), 'Onboarding Complete', 'Hospital fully onboarded', 6, true)
ON CONFLICT DO NOTHING;

-- Ensure departments exist
INSERT INTO departments (id, name, description)
VALUES
    (gen_random_uuid(), 'Emergency', 'Emergency Department'),
    (gen_random_uuid(), 'Cardiology', 'Heart and Vascular'),
    (gen_random_uuid(), 'Pediatrics', 'Children Care'),
    (gen_random_uuid(), 'General Medicine', 'General Medical Care')
ON CONFLICT DO NOTHING;

-- Ensure some wards exist
INSERT INTO wards (id, name, description, total_beds)
VALUES
    (gen_random_uuid(), 'General Ward', 'General patient care', 20),
    (gen_random_uuid(), 'ICU', 'Intensive Care Unit', 10),
    (gen_random_uuid(), 'Pediatric Ward', 'Children ward', 15),
    (gen_random_uuid(), 'Maternity Ward', 'Maternity care', 12)
ON CONFLICT DO NOTHING;
