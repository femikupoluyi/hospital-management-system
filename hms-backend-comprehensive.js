const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Client } = require('pg');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const PORT = 5700;
const JWT_SECRET = 'hms-secret-key-2024';

// PostgreSQL client
const dbClient = new Client({
    connectionString: 'postgresql://neondb_owner:npg_InhJz3HWVO6E@ep-solitary-recipe-adrz8omw-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require'
});

// Middleware
app.use(cors());
app.use(express.json());

// Create HTTP server
const server = http.createServer(app);

// WebSocket server
const wss = new WebSocket.Server({ server });
const wsClients = new Set();

wss.on('connection', (ws) => {
    wsClients.add(ws);
    console.log('New WebSocket connection');
    
    ws.on('close', () => {
        wsClients.delete(ws);
        console.log('WebSocket connection closed');
    });
});

// Broadcast function
function broadcast(data) {
    wsClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// Authentication middleware
function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({ success: false, error: 'No token provided' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        res.status(401).json({ success: false, error: 'Invalid token' });
    }
}

// ============================================
// ROUTES
// ============================================

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'HMS Backend',
        timestamp: new Date().toISOString(),
        database: 'connected'
    });
});

// ============================================
// AUTHENTICATION ENDPOINTS
// ============================================

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const result = await dbClient.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }
        
        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);
        
        if (!validPassword) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }
        
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, error: 'Login failed' });
    }
});

app.get('/api/auth/verify', authMiddleware, (req, res) => {
    res.json({ success: true, user: req.user });
});

// ============================================
// PATIENT MANAGEMENT
// ============================================

app.get('/api/patients', authMiddleware, async (req, res) => {
    try {
        const result = await dbClient.query(
            'SELECT * FROM patients ORDER BY created_at DESC LIMIT 100'
        );
        res.json({ success: true, patients: result.rows });
    } catch (error) {
        console.error('Error fetching patients:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch patients' });
    }
});

app.post('/api/patients', authMiddleware, async (req, res) => {
    try {
        const { name, email, phone, date_of_birth, gender, address, blood_group } = req.body;
        
        const result = await dbClient.query(
            `INSERT INTO patients (name, email, phone, date_of_birth, gender, address, blood_group, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             RETURNING *`,
            [name, email, phone, date_of_birth, gender, address, blood_group || 'Unknown']
        );
        
        broadcast({
            type: 'new_patient',
            data: { name, id: result.rows[0].id }
        });
        
        res.json({ success: true, patient: result.rows[0] });
    } catch (error) {
        console.error('Error creating patient:', error);
        res.status(500).json({ success: false, error: 'Failed to create patient' });
    }
});

app.get('/api/patients/:id', authMiddleware, async (req, res) => {
    try {
        const result = await dbClient.query(
            'SELECT * FROM patients WHERE id = $1',
            [req.params.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Patient not found' });
        }
        
        res.json({ success: true, patient: result.rows[0] });
    } catch (error) {
        console.error('Error fetching patient:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch patient' });
    }
});

// ============================================
// MEDICAL RECORDS
// ============================================

app.get('/api/medical-records', authMiddleware, async (req, res) => {
    try {
        const result = await dbClient.query(`
            SELECT mr.*, p.name as patient_name, u.name as doctor_name
            FROM medical_records mr
            LEFT JOIN patients p ON mr.patient_id = p.id
            LEFT JOIN users u ON mr.doctor_id = u.id
            ORDER BY mr.created_at DESC
            LIMIT 100
        `);
        res.json({ success: true, records: result.rows });
    } catch (error) {
        console.error('Error fetching medical records:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch medical records' });
    }
});

app.post('/api/medical-records', authMiddleware, async (req, res) => {
    try {
        const { patient_id, symptoms, diagnosis, treatment, prescription, visit_type } = req.body;
        
        const result = await dbClient.query(
            `INSERT INTO medical_records (patient_id, doctor_id, symptoms, diagnosis, treatment, prescription, visit_type, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             RETURNING *`,
            [patient_id, req.user.id, symptoms, diagnosis, treatment, prescription, visit_type || 'consultation']
        );
        
        res.json({ success: true, record: result.rows[0] });
    } catch (error) {
        console.error('Error creating medical record:', error);
        res.status(500).json({ success: false, error: 'Failed to create medical record' });
    }
});

app.get('/api/medical-records/:id', authMiddleware, async (req, res) => {
    try {
        const result = await dbClient.query(`
            SELECT mr.*, p.name as patient_name, u.name as doctor_name
            FROM medical_records mr
            LEFT JOIN patients p ON mr.patient_id = p.id
            LEFT JOIN users u ON mr.doctor_id = u.id
            WHERE mr.id = $1
        `, [req.params.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Record not found' });
        }
        
        res.json({ success: true, record: result.rows[0] });
    } catch (error) {
        console.error('Error fetching medical record:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch medical record' });
    }
});

// ============================================
// BILLING & INVOICES
// ============================================

app.get('/api/invoices', authMiddleware, async (req, res) => {
    try {
        const result = await dbClient.query(`
            SELECT i.*, p.name as patient_name
            FROM invoices i
            LEFT JOIN patients p ON i.patient_id = p.id
            ORDER BY i.created_at DESC
            LIMIT 100
        `);
        res.json({ success: true, invoices: result.rows });
    } catch (error) {
        console.error('Error fetching invoices:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch invoices' });
    }
});

app.post('/api/invoices', authMiddleware, async (req, res) => {
    try {
        const { patient_id, items, payment_method, insurance_provider } = req.body;
        
        // Calculate total
        const total_amount = items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
        
        const result = await dbClient.query(
            `INSERT INTO invoices (patient_id, total_amount, payment_status, payment_method, insurance_provider, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             RETURNING *`,
            [patient_id, total_amount, 'pending', payment_method || 'cash', insurance_provider || null]
        );
        
        const invoiceId = result.rows[0].id;
        
        // Insert invoice items
        for (const item of items) {
            await dbClient.query(
                `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, total)
                 VALUES ($1, $2, $3, $4, $5)`,
                [invoiceId, item.description, item.quantity, item.unit_price, item.quantity * item.unit_price]
            );
        }
        
        res.json({ success: true, invoice: result.rows[0] });
    } catch (error) {
        console.error('Error creating invoice:', error);
        res.status(500).json({ success: false, error: 'Failed to create invoice' });
    }
});

app.post('/api/invoices/:id/payment', authMiddleware, async (req, res) => {
    try {
        const { amount_paid } = req.body;
        
        const result = await dbClient.query(
            `UPDATE invoices 
             SET amount_paid = $1, 
                 payment_status = CASE 
                     WHEN $1 >= total_amount THEN 'paid'
                     WHEN $1 > 0 THEN 'partial'
                     ELSE 'pending'
                 END,
                 updated_at = NOW()
             WHERE id = $2
             RETURNING *`,
            [amount_paid, req.params.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Invoice not found' });
        }
        
        res.json({ success: true, invoice: result.rows[0] });
    } catch (error) {
        console.error('Error updating payment:', error);
        res.status(500).json({ success: false, error: 'Failed to update payment' });
    }
});

// ============================================
// INVENTORY MANAGEMENT
// ============================================

app.get('/api/inventory', authMiddleware, async (req, res) => {
    try {
        const result = await dbClient.query(
            'SELECT * FROM inventory ORDER BY item_name'
        );
        res.json({ success: true, items: result.rows });
    } catch (error) {
        console.error('Error fetching inventory:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch inventory' });
    }
});

app.post('/api/inventory', authMiddleware, async (req, res) => {
    try {
        const { item_name, category, quantity, unit, unit_price, expiry_date, reorder_level } = req.body;
        
        const result = await dbClient.query(
            `INSERT INTO inventory (item_name, category, quantity, unit, unit_price, expiry_date, reorder_level, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             RETURNING *`,
            [item_name, category || 'general', quantity, unit || 'units', unit_price || 0, expiry_date || null, reorder_level || 10]
        );
        
        // Check for low stock
        if (quantity <= (reorder_level || 10)) {
            broadcast({
                type: 'low_stock_alert',
                data: { item: item_name, quantity }
            });
        }
        
        res.json({ success: true, item: result.rows[0] });
    } catch (error) {
        console.error('Error adding inventory item:', error);
        res.status(500).json({ success: false, error: 'Failed to add inventory item' });
    }
});

app.get('/api/inventory/low-stock', authMiddleware, async (req, res) => {
    try {
        const result = await dbClient.query(
            'SELECT * FROM inventory WHERE quantity <= reorder_level ORDER BY quantity'
        );
        res.json({ success: true, items: result.rows });
    } catch (error) {
        console.error('Error fetching low stock items:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch low stock items' });
    }
});

app.put('/api/inventory/:id', authMiddleware, async (req, res) => {
    try {
        const { quantity } = req.body;
        
        const result = await dbClient.query(
            `UPDATE inventory SET quantity = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
            [quantity, req.params.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Item not found' });
        }
        
        const item = result.rows[0];
        if (item.quantity <= item.reorder_level) {
            broadcast({
                type: 'low_stock_alert',
                data: { item: item.item_name, quantity: item.quantity }
            });
        }
        
        res.json({ success: true, item });
    } catch (error) {
        console.error('Error updating inventory:', error);
        res.status(500).json({ success: false, error: 'Failed to update inventory' });
    }
});

// ============================================
// STAFF MANAGEMENT & SCHEDULING
// ============================================

app.get('/api/schedules', authMiddleware, async (req, res) => {
    try {
        const result = await dbClient.query(
            `SELECT * FROM schedules 
             WHERE date >= CURRENT_DATE 
             ORDER BY date, shift_start`
        );
        res.json({ success: true, schedules: result.rows });
    } catch (error) {
        console.error('Error fetching schedules:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch schedules' });
    }
});

app.post('/api/schedules', authMiddleware, async (req, res) => {
    try {
        const { staff_name, department, shift_start, shift_end, date } = req.body;
        
        const result = await dbClient.query(
            `INSERT INTO schedules (staff_name, department, shift_start, shift_end, date, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             RETURNING *`,
            [staff_name, department || 'General', shift_start, shift_end, date]
        );
        
        res.json({ success: true, schedule: result.rows[0] });
    } catch (error) {
        console.error('Error creating schedule:', error);
        res.status(500).json({ success: false, error: 'Failed to create schedule' });
    }
});

app.get('/api/staff', authMiddleware, async (req, res) => {
    try {
        const result = await dbClient.query(
            `SELECT id, name, email, role, department, phone, specialization
             FROM users WHERE role IN ('doctor', 'nurse', 'staff')
             ORDER BY name`
        );
        res.json({ success: true, staff: result.rows });
    } catch (error) {
        console.error('Error fetching staff:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch staff' });
    }
});

// ============================================
// BED MANAGEMENT
// ============================================

app.get('/api/beds/available', authMiddleware, async (req, res) => {
    try {
        const result = await dbClient.query(
            `SELECT * FROM beds WHERE status = 'available' ORDER BY ward, bed_number`
        );
        res.json({ success: true, beds: result.rows });
    } catch (error) {
        console.error('Error fetching available beds:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch available beds' });
    }
});

app.get('/api/beds/occupancy', authMiddleware, async (req, res) => {
    try {
        const totalResult = await dbClient.query('SELECT COUNT(*) as total FROM beds');
        const occupiedResult = await dbClient.query('SELECT COUNT(*) as occupied FROM beds WHERE status = $1', ['occupied']);
        
        const total = parseInt(totalResult.rows[0].total);
        const occupied = parseInt(occupiedResult.rows[0].occupied);
        const occupancy_rate = total > 0 ? (occupied / total * 100) : 0;
        
        res.json({ 
            success: true, 
            occupancy_rate,
            total_beds: total,
            occupied_beds: occupied,
            available_beds: total - occupied
        });
    } catch (error) {
        console.error('Error calculating occupancy:', error);
        res.status(500).json({ success: false, error: 'Failed to calculate occupancy' });
    }
});

app.post('/api/admissions', authMiddleware, async (req, res) => {
    try {
        const { patient_id, ward, bed_number, admission_reason, doctor_name } = req.body;
        
        // Check if bed exists, if not create it
        const bedCheck = await dbClient.query(
            'SELECT * FROM beds WHERE bed_number = $1 AND ward = $2',
            [bed_number, ward]
        );
        
        let bedId;
        if (bedCheck.rows.length === 0) {
            const bedResult = await dbClient.query(
                `INSERT INTO beds (bed_number, ward, status) VALUES ($1, $2, 'occupied') RETURNING id`,
                [bed_number, ward]
            );
            bedId = bedResult.rows[0].id;
        } else {
            bedId = bedCheck.rows[0].id;
            await dbClient.query(
                `UPDATE beds SET status = 'occupied' WHERE id = $1`,
                [bedId]
            );
        }
        
        const result = await dbClient.query(
            `INSERT INTO admissions (patient_id, bed_id, admission_date, admission_reason, doctor_name, status)
             VALUES ($1, $2, NOW(), $3, $4, 'active')
             RETURNING *`,
            [patient_id, bedId, admission_reason, doctor_name]
        );
        
        broadcast({
            type: 'bed_status_changed',
            data: { bedId: bed_number, status: 'occupied' }
        });
        
        res.json({ success: true, admission: result.rows[0] });
    } catch (error) {
        console.error('Error creating admission:', error);
        res.status(500).json({ success: false, error: 'Failed to create admission' });
    }
});

app.post('/api/admissions/:id/discharge', authMiddleware, async (req, res) => {
    try {
        const { discharge_notes } = req.body;
        
        // Update admission
        const admissionResult = await dbClient.query(
            `UPDATE admissions 
             SET status = 'discharged', 
                 discharge_date = NOW(), 
                 discharge_notes = $1
             WHERE id = $2
             RETURNING *`,
            [discharge_notes, req.params.id]
        );
        
        if (admissionResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Admission not found' });
        }
        
        // Update bed status
        const bedId = admissionResult.rows[0].bed_id;
        await dbClient.query(
            `UPDATE beds SET status = 'available' WHERE id = $1`,
            [bedId]
        );
        
        broadcast({
            type: 'bed_status_changed',
            data: { bedId, status: 'available' }
        });
        
        res.json({ success: true, admission: admissionResult.rows[0] });
    } catch (error) {
        console.error('Error discharging patient:', error);
        res.status(500).json({ success: false, error: 'Failed to discharge patient' });
    }
});

// ============================================
// ANALYTICS ENDPOINTS
// ============================================

app.get('/api/analytics/dashboard', authMiddleware, async (req, res) => {
    try {
        // Get various metrics
        const patientsResult = await dbClient.query('SELECT COUNT(*) as total FROM patients');
        const admissionsResult = await dbClient.query('SELECT COUNT(*) as total FROM admissions WHERE status = $1', ['active']);
        const revenueResult = await dbClient.query('SELECT SUM(total_amount) as total FROM invoices WHERE created_at >= CURRENT_DATE - INTERVAL \'30 days\'');
        const appointmentsResult = await dbClient.query('SELECT COUNT(*) as total FROM appointments WHERE appointment_date >= CURRENT_DATE');
        
        res.json({
            success: true,
            metrics: {
                total_patients: parseInt(patientsResult.rows[0].total),
                active_admissions: parseInt(admissionsResult.rows[0].total),
                monthly_revenue: parseFloat(revenueResult.rows[0].total || 0),
                upcoming_appointments: parseInt(appointmentsResult.rows[0]?.total || 0),
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error fetching dashboard data:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch dashboard data' });
    }
});

app.get('/api/analytics/revenue', authMiddleware, async (req, res) => {
    try {
        const result = await dbClient.query(`
            SELECT 
                DATE_TRUNC('day', created_at) as date,
                SUM(total_amount) as revenue,
                COUNT(*) as invoice_count
            FROM invoices
            WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
            GROUP BY DATE_TRUNC('day', created_at)
            ORDER BY date
        `);
        
        res.json({ 
            success: true, 
            data: result.rows,
            summary: {
                total_revenue: result.rows.reduce((sum, row) => sum + parseFloat(row.revenue), 0),
                total_invoices: result.rows.reduce((sum, row) => sum + parseInt(row.invoice_count), 0)
            }
        });
    } catch (error) {
        console.error('Error fetching revenue data:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch revenue data' });
    }
});

app.get('/api/analytics/patient-flow', authMiddleware, async (req, res) => {
    try {
        const result = await dbClient.query(`
            SELECT 
                DATE_TRUNC('day', created_at) as date,
                COUNT(*) as new_patients
            FROM patients
            WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
            GROUP BY DATE_TRUNC('day', created_at)
            ORDER BY date
        `);
        
        res.json({ 
            success: true, 
            data: result.rows,
            summary: {
                total_new_patients: result.rows.reduce((sum, row) => sum + parseInt(row.new_patients), 0),
                average_daily: Math.round(result.rows.reduce((sum, row) => sum + parseInt(row.new_patients), 0) / (result.rows.length || 1))
            }
        });
    } catch (error) {
        console.error('Error fetching patient flow data:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch patient flow data' });
    }
});

app.post('/api/analytics/export', authMiddleware, async (req, res) => {
    try {
        const { report_type, date_from, date_to } = req.body;
        
        let query = '';
        let params = [];
        
        switch(report_type) {
            case 'patients':
                query = 'SELECT * FROM patients WHERE created_at BETWEEN $1 AND $2';
                params = [date_from, date_to];
                break;
            case 'revenue':
                query = 'SELECT * FROM invoices WHERE created_at BETWEEN $1 AND $2';
                params = [date_from, date_to];
                break;
            case 'inventory':
                query = 'SELECT * FROM inventory';
                break;
            default:
                return res.status(400).json({ success: false, error: 'Invalid report type' });
        }
        
        const result = await dbClient.query(query, params);
        
        res.json({
            success: true,
            data: result.rows,
            metadata: {
                report_type,
                date_from,
                date_to,
                generated_at: new Date().toISOString(),
                record_count: result.rows.length
            }
        });
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ success: false, error: 'Failed to generate report' });
    }
});

// ============================================
// APPOINTMENTS
// ============================================

app.get('/api/appointments', authMiddleware, async (req, res) => {
    try {
        const result = await dbClient.query(`
            SELECT a.*, p.name as patient_name, u.name as doctor_name
            FROM appointments a
            LEFT JOIN patients p ON a.patient_id = p.id
            LEFT JOIN users u ON a.doctor_id = u.id
            WHERE a.appointment_date >= CURRENT_DATE
            ORDER BY a.appointment_date, a.appointment_time
        `);
        res.json({ success: true, appointments: result.rows });
    } catch (error) {
        console.error('Error fetching appointments:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch appointments' });
    }
});

app.post('/api/appointments', authMiddleware, async (req, res) => {
    try {
        const { patient_id, doctor_id, appointment_date, appointment_time, reason, duration } = req.body;
        
        const result = await dbClient.query(
            `INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, reason, status, duration, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             RETURNING *`,
            [patient_id, doctor_id || req.user.id, appointment_date, appointment_time, reason, 'scheduled', duration || 30]
        );
        
        res.json({ success: true, appointment: result.rows[0] });
    } catch (error) {
        console.error('Error creating appointment:', error);
        res.status(500).json({ success: false, error: 'Failed to create appointment' });
    }
});

// ============================================
// LAB RESULTS
// ============================================

app.get('/api/lab-results', authMiddleware, async (req, res) => {
    try {
        const result = await dbClient.query(`
            SELECT lr.*, p.name as patient_name, u.name as technician_name
            FROM lab_results lr
            LEFT JOIN patients p ON lr.patient_id = p.id
            LEFT JOIN users u ON lr.technician_id = u.id
            ORDER BY lr.created_at DESC
            LIMIT 100
        `);
        res.json({ success: true, results: result.rows });
    } catch (error) {
        console.error('Error fetching lab results:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch lab results' });
    }
});

app.post('/api/lab-results', authMiddleware, async (req, res) => {
    try {
        const { patient_id, test_type, test_results, normal_range, status } = req.body;
        
        const result = await dbClient.query(
            `INSERT INTO lab_results (patient_id, test_type, test_results, normal_range, status, technician_id, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             RETURNING *`,
            [patient_id, test_type, test_results, normal_range, status || 'completed', req.user.id]
        );
        
        res.json({ success: true, result: result.rows[0] });
    } catch (error) {
        console.error('Error creating lab result:', error);
        res.status(500).json({ success: false, error: 'Failed to create lab result' });
    }
});

// Start server
async function startServer() {
    try {
        await dbClient.connect();
        console.log('Connected to PostgreSQL database');
        
        server.listen(PORT, () => {
            console.log(`HMS Backend running on port ${PORT}`);
            console.log(`WebSocket server ready for connections`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
