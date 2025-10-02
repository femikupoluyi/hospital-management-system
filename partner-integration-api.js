const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const fetch = require('node-fetch');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json());

// Database connection
const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_InhJz3HWVO6E@ep-solitary-recipe-adrz8omw-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require',
    ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = 'hms-secret-key-2024'; // Use same secret as main HMS

// WebSocket connections
const wsClients = new Set();

wss.on('connection', (ws) => {
    console.log('New WebSocket connection for partner updates');
    wsClients.add(ws);
    
    ws.on('close', () => {
        wsClients.delete(ws);
    });
});

// Broadcast function
function broadcast(type, data) {
    const message = JSON.stringify({ type, data, timestamp: new Date() });
    wsClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Auth middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

// Initialize partner tables
async function initializePartnerTables() {
    try {
        // Insurance partners table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS insurance_partners (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                api_endpoint VARCHAR(255),
                api_key VARCHAR(255),
                status VARCHAR(50) DEFAULT 'active',
                supported_plans JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Insurance claims table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS insurance_claims (
                id SERIAL PRIMARY KEY,
                patient_id INTEGER,
                partner_id INTEGER REFERENCES insurance_partners(id),
                claim_number VARCHAR(100) UNIQUE,
                amount DECIMAL(10,2),
                status VARCHAR(50) DEFAULT 'pending',
                submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                approved_at TIMESTAMP,
                response_data JSONB
            )
        `);

        // Pharmacy partners table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pharmacy_partners (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                api_endpoint VARCHAR(255),
                api_key VARCHAR(255),
                status VARCHAR(50) DEFAULT 'active',
                catalog_updated TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Pharmacy orders table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pharmacy_orders (
                id SERIAL PRIMARY KEY,
                partner_id INTEGER REFERENCES pharmacy_partners(id),
                order_number VARCHAR(100) UNIQUE,
                items JSONB,
                total_amount DECIMAL(10,2),
                status VARCHAR(50) DEFAULT 'pending',
                ordered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                delivered_at TIMESTAMP
            )
        `);

        // Telemedicine providers table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS telemedicine_providers (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                api_endpoint VARCHAR(255),
                api_key VARCHAR(255),
                specialties JSONB,
                status VARCHAR(50) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Telemedicine sessions table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS telemedicine_sessions (
                id SERIAL PRIMARY KEY,
                patient_id INTEGER,
                provider_id INTEGER REFERENCES telemedicine_providers(id),
                doctor_id INTEGER,
                session_id VARCHAR(100) UNIQUE,
                scheduled_time TIMESTAMP,
                duration INTEGER,
                status VARCHAR(50) DEFAULT 'scheduled',
                meeting_link TEXT,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Compliance reports table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS compliance_reports (
                id SERIAL PRIMARY KEY,
                report_type VARCHAR(100),
                report_period VARCHAR(50),
                generated_by INTEGER,
                file_path TEXT,
                submission_status VARCHAR(50) DEFAULT 'draft',
                submitted_to VARCHAR(255),
                submitted_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Add sample partners if not exists
        const partnerCheck = await pool.query('SELECT COUNT(*) FROM insurance_partners');
        if (partnerCheck.rows[0].count == 0) {
            await addSamplePartners();
        }

        console.log('Partner tables initialized successfully');
    } catch (error) {
        console.error('Error initializing partner tables:', error);
    }
}

// Add sample partners
async function addSamplePartners() {
    try {
        // Add insurance partners
        await pool.query(`
            INSERT INTO insurance_partners (name, api_endpoint, api_key, supported_plans)
            VALUES 
            ('HealthGuard Insurance', 'https://api.healthguard.com/v1', 'HG_API_KEY_2024', '["Basic", "Premium", "Gold"]'),
            ('MediCare Plus', 'https://api.medicareplus.com/claims', 'MCP_API_KEY_2024', '["Standard", "Enhanced", "Executive"]'),
            ('National Health Insurance', 'https://api.nhis.gov/v2', 'NHIS_API_KEY_2024', '["Universal Coverage"]')
        `);

        // Add pharmacy partners
        await pool.query(`
            INSERT INTO pharmacy_partners (name, api_endpoint, api_key)
            VALUES 
            ('MedSupply Direct', 'https://api.medsupply.com/v1', 'MSD_API_KEY_2024'),
            ('PharmaCare Network', 'https://api.pharmacare.net/orders', 'PCN_API_KEY_2024'),
            ('QuickMeds Delivery', 'https://api.quickmeds.com/v2', 'QMD_API_KEY_2024')
        `);

        // Add telemedicine providers
        await pool.query(`
            INSERT INTO telemedicine_providers (name, api_endpoint, api_key, specialties)
            VALUES 
            ('TeleHealth Connect', 'https://api.telehealthconnect.com/v1', 'THC_API_KEY_2024', '["General Practice", "Psychiatry", "Dermatology"]'),
            ('Virtual Care Plus', 'https://api.virtualcareplus.com/sessions', 'VCP_API_KEY_2024', '["Pediatrics", "Internal Medicine", "Cardiology"]'),
            ('DocOnline Services', 'https://api.doconline.com/v2', 'DOS_API_KEY_2024', '["Emergency Medicine", "Family Medicine", "Psychology"]')
        `);

        console.log('Sample partners added successfully');
    } catch (error) {
        console.error('Error adding sample partners:', error);
    }
}

// ============================================
// INSURANCE INTEGRATION APIs
// ============================================

// Get insurance partners
app.get('/api/insurance/partners', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM insurance_partners WHERE status = $1', ['active']);
        res.json({ success: true, partners: result.rows });
    } catch (error) {
        console.error('Error fetching insurance partners:', error);
        res.status(500).json({ error: 'Failed to fetch insurance partners' });
    }
});

// Verify insurance coverage
app.post('/api/insurance/verify-coverage', authenticateToken, async (req, res) => {
    try {
        const { patientId, partnerId, policyNumber } = req.body;
        
        // Get partner details
        const partner = await pool.query('SELECT * FROM insurance_partners WHERE id = $1', [partnerId]);
        
        if (partner.rows.length === 0) {
            return res.status(404).json({ error: 'Insurance partner not found' });
        }
        
        // Simulate API call to insurance provider
        const coverageData = {
            verified: true,
            policyNumber: policyNumber,
            coverageLevel: 'Premium',
            deductible: 500,
            copay: 20,
            maxCoverage: 100000,
            validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
        };
        
        broadcast('insurance_verified', { patientId, partnerId, coverage: coverageData });
        
        res.json({ 
            success: true, 
            coverage: coverageData,
            message: `Coverage verified with ${partner.rows[0].name}`
        });
    } catch (error) {
        console.error('Error verifying insurance:', error);
        res.status(500).json({ error: 'Failed to verify insurance coverage' });
    }
});

// Submit insurance claim
app.post('/api/insurance/submit-claim', authenticateToken, async (req, res) => {
    try {
        const { patientId, partnerId, invoiceId, amount, services } = req.body;
        const claimNumber = 'CLM-' + Date.now();
        
        // Get partner details
        const partner = await pool.query('SELECT * FROM insurance_partners WHERE id = $1', [partnerId]);
        
        if (partner.rows.length === 0) {
            return res.status(404).json({ error: 'Insurance partner not found' });
        }
        
        // Create claim record
        const claim = await pool.query(
            `INSERT INTO insurance_claims (patient_id, partner_id, claim_number, amount, status)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [patientId, partnerId, claimNumber, amount, 'submitted']
        );
        
        // Simulate API call to insurance provider
        setTimeout(async () => {
            // Simulate claim approval (80% approval rate)
            const approved = Math.random() > 0.2;
            const status = approved ? 'approved' : 'rejected';
            const approvedAmount = approved ? amount * 0.8 : 0;
            
            await pool.query(
                `UPDATE insurance_claims 
                 SET status = $1, approved_at = $2, response_data = $3
                 WHERE id = $4`,
                [status, new Date(), JSON.stringify({ approvedAmount, reason: approved ? 'Claim approved' : 'Documentation incomplete' }), claim.rows[0].id]
            );
            
            broadcast('claim_processed', { claimNumber, status, approvedAmount });
        }, 3000);
        
        res.json({ 
            success: true, 
            claim: claim.rows[0],
            message: `Claim submitted to ${partner.rows[0].name}`
        });
    } catch (error) {
        console.error('Error submitting claim:', error);
        res.status(500).json({ error: 'Failed to submit insurance claim' });
    }
});

// Get claim status
app.get('/api/insurance/claims/:claimNumber', authenticateToken, async (req, res) => {
    try {
        const { claimNumber } = req.params;
        
        const result = await pool.query(
            `SELECT c.*, p.name as partner_name
             FROM insurance_claims c
             LEFT JOIN insurance_partners p ON c.partner_id = p.id
             WHERE c.claim_number = $1`,
            [claimNumber]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Claim not found' });
        }
        
        res.json({ success: true, claim: result.rows[0] });
    } catch (error) {
        console.error('Error fetching claim:', error);
        res.status(500).json({ error: 'Failed to fetch claim status' });
    }
});

// ============================================
// PHARMACY INTEGRATION APIs
// ============================================

// Get pharmacy partners
app.get('/api/pharmacy/partners', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM pharmacy_partners WHERE status = $1', ['active']);
        res.json({ success: true, partners: result.rows });
    } catch (error) {
        console.error('Error fetching pharmacy partners:', error);
        res.status(500).json({ error: 'Failed to fetch pharmacy partners' });
    }
});

// Check medication availability
app.post('/api/pharmacy/check-availability', authenticateToken, async (req, res) => {
    try {
        const { partnerId, medications } = req.body;
        
        // Get partner details
        const partner = await pool.query('SELECT * FROM pharmacy_partners WHERE id = $1', [partnerId]);
        
        if (partner.rows.length === 0) {
            return res.status(404).json({ error: 'Pharmacy partner not found' });
        }
        
        // Simulate API call to pharmacy
        const availability = medications.map(med => ({
            medication: med.name,
            available: Math.random() > 0.3,
            quantity: Math.floor(Math.random() * 100) + 10,
            price: (Math.random() * 50 + 5).toFixed(2)
        }));
        
        res.json({ 
            success: true, 
            partner: partner.rows[0].name,
            availability
        });
    } catch (error) {
        console.error('Error checking availability:', error);
        res.status(500).json({ error: 'Failed to check medication availability' });
    }
});

// Place pharmacy order
app.post('/api/pharmacy/place-order', authenticateToken, async (req, res) => {
    try {
        const { partnerId, items, deliveryAddress } = req.body;
        const orderNumber = 'PO-' + Date.now();
        
        // Calculate total
        const totalAmount = items.reduce((sum, item) => sum + (item.quantity * item.price), 0);
        
        // Create order record
        const order = await pool.query(
            `INSERT INTO pharmacy_orders (partner_id, order_number, items, total_amount, status)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [partnerId, orderNumber, JSON.stringify(items), totalAmount, 'processing']
        );
        
        // Simulate order processing
        setTimeout(async () => {
            await pool.query(
                `UPDATE pharmacy_orders 
                 SET status = $1, delivered_at = $2
                 WHERE id = $3`,
                ['delivered', new Date(Date.now() + 24 * 60 * 60 * 1000), order.rows[0].id]
            );
            
            broadcast('pharmacy_order_update', { orderNumber, status: 'delivered' });
        }, 5000);
        
        res.json({ 
            success: true, 
            order: order.rows[0],
            message: 'Order placed successfully',
            estimatedDelivery: new Date(Date.now() + 24 * 60 * 60 * 1000)
        });
    } catch (error) {
        console.error('Error placing order:', error);
        res.status(500).json({ error: 'Failed to place pharmacy order' });
    }
});

// Automatic restocking
app.post('/api/pharmacy/auto-restock', authenticateToken, async (req, res) => {
    try {
        // Get low stock items from inventory
        const lowStock = await pool.query(
            'SELECT * FROM inventory WHERE quantity <= reorder_level'
        );
        
        if (lowStock.rows.length === 0) {
            return res.json({ success: true, message: 'No items need restocking' });
        }
        
        // Get preferred pharmacy partner
        const partner = await pool.query(
            'SELECT * FROM pharmacy_partners WHERE status = $1 LIMIT 1',
            ['active']
        );
        
        if (partner.rows.length === 0) {
            return res.status(404).json({ error: 'No active pharmacy partners' });
        }
        
        // Create restock orders
        const orders = [];
        for (const item of lowStock.rows) {
            const orderQuantity = (item.reorder_level * 3) - item.quantity;
            const orderNumber = 'AUTO-' + Date.now() + '-' + item.id;
            
            const order = await pool.query(
                `INSERT INTO pharmacy_orders (partner_id, order_number, items, total_amount, status)
                 VALUES ($1, $2, $3, $4, $5) RETURNING *`,
                [
                    partner.rows[0].id,
                    orderNumber,
                    JSON.stringify([{
                        name: item.item_name,
                        quantity: orderQuantity,
                        price: item.unit_price
                    }]),
                    orderQuantity * item.unit_price,
                    'auto-generated'
                ]
            );
            orders.push(order.rows[0]);
        }
        
        broadcast('auto_restock_initiated', { itemCount: orders.length });
        
        res.json({ 
            success: true, 
            orders,
            message: `Auto-restocking initiated for ${orders.length} items`
        });
    } catch (error) {
        console.error('Error auto-restocking:', error);
        res.status(500).json({ error: 'Failed to initiate auto-restocking' });
    }
});

// ============================================
// TELEMEDICINE INTEGRATION APIs
// ============================================

// Get telemedicine providers
app.get('/api/telemedicine/providers', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM telemedicine_providers WHERE status = $1', ['active']);
        res.json({ success: true, providers: result.rows });
    } catch (error) {
        console.error('Error fetching providers:', error);
        res.status(500).json({ error: 'Failed to fetch telemedicine providers' });
    }
});

// Schedule telemedicine session
app.post('/api/telemedicine/schedule', authenticateToken, async (req, res) => {
    try {
        const { patientId, providerId, doctorId, scheduledTime, reason } = req.body;
        const sessionId = 'TM-' + Date.now();
        
        // Get provider details
        const provider = await pool.query('SELECT * FROM telemedicine_providers WHERE id = $1', [providerId]);
        
        if (provider.rows.length === 0) {
            return res.status(404).json({ error: 'Telemedicine provider not found' });
        }
        
        // Generate meeting link
        const meetingLink = `https://${provider.rows[0].name.toLowerCase().replace(/ /g, '')}.com/session/${sessionId}`;
        
        // Create session record
        const session = await pool.query(
            `INSERT INTO telemedicine_sessions 
             (patient_id, provider_id, doctor_id, session_id, scheduled_time, status, meeting_link, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [patientId, providerId, doctorId, sessionId, scheduledTime, 'scheduled', meetingLink, reason]
        );
        
        broadcast('telemedicine_scheduled', { sessionId, scheduledTime, meetingLink });
        
        res.json({ 
            success: true, 
            session: session.rows[0],
            message: `Telemedicine session scheduled with ${provider.rows[0].name}`
        });
    } catch (error) {
        console.error('Error scheduling session:', error);
        res.status(500).json({ error: 'Failed to schedule telemedicine session' });
    }
});

// Start telemedicine session
app.post('/api/telemedicine/start/:sessionId', authenticateToken, async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        // Update session status
        const result = await pool.query(
            `UPDATE telemedicine_sessions 
             SET status = $1, duration = 0
             WHERE session_id = $2 RETURNING *`,
            ['in-progress', sessionId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Session not found' });
        }
        
        broadcast('telemedicine_started', { sessionId });
        
        res.json({ 
            success: true, 
            session: result.rows[0],
            message: 'Telemedicine session started'
        });
    } catch (error) {
        console.error('Error starting session:', error);
        res.status(500).json({ error: 'Failed to start telemedicine session' });
    }
});

// End telemedicine session
app.post('/api/telemedicine/end/:sessionId', authenticateToken, async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { duration, notes, prescription } = req.body;
        
        // Update session
        const result = await pool.query(
            `UPDATE telemedicine_sessions 
             SET status = $1, duration = $2, notes = $3
             WHERE session_id = $4 RETURNING *`,
            ['completed', duration, notes, sessionId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Session not found' });
        }
        
        // If prescription provided, create medical record
        if (prescription) {
            await pool.query(
                `INSERT INTO medical_records 
                 (patient_id, doctor_id, symptoms, diagnosis, treatment, prescription, visit_type, notes)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    result.rows[0].patient_id,
                    result.rows[0].doctor_id,
                    'Telemedicine consultation',
                    notes,
                    'See prescription',
                    prescription,
                    'telemedicine',
                    `Session ID: ${sessionId}`
                ]
            );
        }
        
        broadcast('telemedicine_completed', { sessionId, duration });
        
        res.json({ 
            success: true, 
            session: result.rows[0],
            message: 'Telemedicine session completed'
        });
    } catch (error) {
        console.error('Error ending session:', error);
        res.status(500).json({ error: 'Failed to end telemedicine session' });
    }
});

// ============================================
// GOVERNMENT/NGO COMPLIANCE REPORTING
// ============================================

// Generate compliance report
app.post('/api/compliance/generate-report', authenticateToken, async (req, res) => {
    try {
        const { reportType, startDate, endDate, targetAgency } = req.body;
        
        let reportData = {};
        
        switch(reportType) {
            case 'patient-statistics':
                const patients = await pool.query(
                    `SELECT COUNT(*) as total,
                     COUNT(CASE WHEN created_at BETWEEN $1 AND $2 THEN 1 END) as new_patients
                     FROM patients`,
                    [startDate, endDate]
                );
                
                const demographics = await pool.query(
                    `SELECT gender, COUNT(*) as count
                     FROM patients
                     GROUP BY gender`
                );
                
                reportData = {
                    totalPatients: patients.rows[0].total,
                    newPatients: patients.rows[0].new_patients,
                    demographics: demographics.rows
                };
                break;
                
            case 'disease-surveillance':
                const diseases = await pool.query(
                    `SELECT diagnosis, COUNT(*) as cases
                     FROM medical_records
                     WHERE created_at BETWEEN $1 AND $2
                     GROUP BY diagnosis
                     ORDER BY cases DESC`,
                    [startDate, endDate]
                );
                
                reportData = {
                    period: { startDate, endDate },
                    diseases: diseases.rows,
                    totalCases: diseases.rows.reduce((sum, d) => sum + parseInt(d.cases), 0)
                };
                break;
                
            case 'vaccination-records':
                const vaccinations = await pool.query(
                    `SELECT COUNT(*) as total
                     FROM medical_records
                     WHERE visit_type = 'vaccination'
                     AND created_at BETWEEN $1 AND $2`,
                    [startDate, endDate]
                );
                
                reportData = {
                    period: { startDate, endDate },
                    totalVaccinations: vaccinations.rows[0].total
                };
                break;
                
            case 'financial-audit':
                const revenue = await pool.query(
                    `SELECT 
                     COUNT(*) as total_invoices,
                     SUM(total_amount) as total_revenue,
                     COUNT(CASE WHEN status = 'paid' THEN 1 END) as paid_invoices
                     FROM invoices
                     WHERE created_at BETWEEN $1 AND $2`,
                    [startDate, endDate]
                );
                
                reportData = {
                    period: { startDate, endDate },
                    financial: revenue.rows[0]
                };
                break;
        }
        
        // Create report record
        const report = await pool.query(
            `INSERT INTO compliance_reports 
             (report_type, report_period, generated_by, submission_status, submitted_to)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [
                reportType,
                `${startDate} to ${endDate}`,
                req.user.id,
                'generated',
                targetAgency
            ]
        );
        
        broadcast('compliance_report_generated', { reportType, reportId: report.rows[0].id });
        
        res.json({ 
            success: true, 
            report: report.rows[0],
            data: reportData,
            message: `${reportType} report generated successfully`
        });
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ error: 'Failed to generate compliance report' });
    }
});

// Submit compliance report
app.post('/api/compliance/submit/:reportId', authenticateToken, async (req, res) => {
    try {
        const { reportId } = req.params;
        const { targetAgency, submissionMethod } = req.body;
        
        // Get report
        const report = await pool.query('SELECT * FROM compliance_reports WHERE id = $1', [reportId]);
        
        if (report.rows.length === 0) {
            return res.status(404).json({ error: 'Report not found' });
        }
        
        // Simulate submission to government/NGO
        const submissionId = 'SUB-' + Date.now();
        
        // Update report status
        await pool.query(
            `UPDATE compliance_reports 
             SET submission_status = $1, submitted_to = $2, submitted_at = $3
             WHERE id = $4`,
            ['submitted', targetAgency, new Date(), reportId]
        );
        
        broadcast('compliance_report_submitted', { reportId, targetAgency, submissionId });
        
        res.json({ 
            success: true,
            submissionId,
            message: `Report submitted to ${targetAgency}`,
            trackingUrl: `https://gov-portal.com/track/${submissionId}`
        });
    } catch (error) {
        console.error('Error submitting report:', error);
        res.status(500).json({ error: 'Failed to submit compliance report' });
    }
});

// Export compliance report
app.get('/api/compliance/export/:reportId', authenticateToken, async (req, res) => {
    try {
        const { reportId } = req.params;
        const { format = 'json' } = req.query;
        
        // Get report
        const report = await pool.query('SELECT * FROM compliance_reports WHERE id = $1', [reportId]);
        
        if (report.rows.length === 0) {
            return res.status(404).json({ error: 'Report not found' });
        }
        
        // Generate export based on format
        let exportData;
        const reportContent = report.rows[0];
        
        if (format === 'csv') {
            // Simple CSV format
            exportData = `Report Type,${reportContent.report_type}\n`;
            exportData += `Period,${reportContent.report_period}\n`;
            exportData += `Status,${reportContent.submission_status}\n`;
            exportData += `Generated At,${reportContent.created_at}\n`;
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=compliance_report_${reportId}.csv`);
        } else {
            exportData = reportContent;
            res.setHeader('Content-Type', 'application/json');
        }
        
        res.send(exportData);
    } catch (error) {
        console.error('Error exporting report:', error);
        res.status(500).json({ error: 'Failed to export compliance report' });
    }
});

// Get all compliance reports
app.get('/api/compliance/reports', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM compliance_reports ORDER BY created_at DESC'
        );
        
        res.json({ success: true, reports: result.rows });
    } catch (error) {
        console.error('Error fetching reports:', error);
        res.status(500).json({ error: 'Failed to fetch compliance reports' });
    }
});

// ============================================
// INTEGRATION STATUS & MONITORING
// ============================================

// Get integration status
app.get('/api/integrations/status', authenticateToken, async (req, res) => {
    try {
        const [insurance, pharmacy, telemedicine, reports] = await Promise.all([
            pool.query('SELECT COUNT(*) as count FROM insurance_partners WHERE status = $1', ['active']),
            pool.query('SELECT COUNT(*) as count FROM pharmacy_partners WHERE status = $1', ['active']),
            pool.query('SELECT COUNT(*) as count FROM telemedicine_providers WHERE status = $1', ['active']),
            pool.query('SELECT COUNT(*) as count FROM compliance_reports')
        ]);
        
        const [claims, orders, sessions] = await Promise.all([
            pool.query('SELECT COUNT(*) as total, COUNT(CASE WHEN status = \'approved\' THEN 1 END) as approved FROM insurance_claims'),
            pool.query('SELECT COUNT(*) as total, COUNT(CASE WHEN status = \'delivered\' THEN 1 END) as delivered FROM pharmacy_orders'),
            pool.query('SELECT COUNT(*) as total, COUNT(CASE WHEN status = \'completed\' THEN 1 END) as completed FROM telemedicine_sessions')
        ]);
        
        res.json({
            success: true,
            status: {
                insurance: {
                    partners: insurance.rows[0].count,
                    totalClaims: claims.rows[0].total,
                    approvedClaims: claims.rows[0].approved,
                    active: true
                },
                pharmacy: {
                    partners: pharmacy.rows[0].count,
                    totalOrders: orders.rows[0].total,
                    deliveredOrders: orders.rows[0].delivered,
                    active: true
                },
                telemedicine: {
                    providers: telemedicine.rows[0].count,
                    totalSessions: sessions.rows[0].total,
                    completedSessions: sessions.rows[0].completed,
                    active: true
                },
                compliance: {
                    totalReports: reports.rows[0].count,
                    active: true
                }
            },
            message: 'All partner integrations are operational'
        });
    } catch (error) {
        console.error('Error fetching integration status:', error);
        res.status(500).json({ error: 'Failed to fetch integration status' });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        service: 'Partner Integration API',
        timestamp: new Date(),
        integrations: ['insurance', 'pharmacy', 'telemedicine', 'compliance']
    });
});

// Start server
const PORT = process.env.PORT || 6100;

async function startServer() {
    await initializePartnerTables();
    
    server.listen(PORT, () => {
        console.log(`Partner Integration API running on port ${PORT}`);
        console.log(`WebSocket server ready for real-time updates`);
        console.log(`Available integrations:`);
        console.log(`  - Insurance/HMO APIs`);
        console.log(`  - Pharmacy supplier systems`);
        console.log(`  - Telemedicine services`);
        console.log(`  - Government/NGO compliance reporting`);
    });
}

startServer().catch(console.error);
