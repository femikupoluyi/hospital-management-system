const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const WebSocket = require('ws');
const http = require('http');
const PDFDocument = require('pdfkit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// File upload configuration
const upload = multer({ 
    dest: 'uploads/',
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Database connection
const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_InhJz3HWVO6E@ep-solitary-recipe-adrz8omw-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require',
    ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = 'hms-secret-key-2024';
const wsClients = new Set();

// WebSocket setup
wss.on('connection', (ws) => {
    console.log('New WebSocket connection');
    wsClients.add(ws);
    ws.on('close', () => wsClients.delete(ws));
});

function broadcast(type, data) {
    const message = JSON.stringify({ type, data, timestamp: new Date() });
    wsClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
};

// ============ AUTHENTICATION ============
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);
        
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role, name: user.name },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.json({
            success: true,
            token,
            user: { id: user.id, email: user.email, name: user.name, role: user.role }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, name, role } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const result = await pool.query(
            'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role',
            [email, hashedPassword, name, role || 'staff']
        );
        
        res.json({ success: true, user: result.rows[0] });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// ============ ELECTRONIC MEDICAL RECORDS ============
app.post('/api/emr/records', authenticateToken, async (req, res) => {
    try {
        const { patient_id, diagnosis, symptoms, treatment_plan, notes, vital_signs } = req.body;
        
        const result = await pool.query(
            `INSERT INTO medical_records (patient_id, doctor_id, diagnosis, symptoms, treatment_plan, notes, vital_signs, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             RETURNING *`,
            [patient_id, req.user.id, diagnosis, symptoms, treatment_plan, notes, JSON.stringify(vital_signs)]
        );
        
        broadcast('emr_created', result.rows[0]);
        res.json({ success: true, record: result.rows[0] });
    } catch (error) {
        console.error('EMR creation error:', error);
        res.status(500).json({ error: 'Failed to create medical record' });
    }
});

app.get('/api/emr/records', authenticateToken, async (req, res) => {
    try {
        const { patient_id, limit = 50, offset = 0 } = req.query;
        
        let query = `
            SELECT mr.*, p.name as patient_name, u.name as doctor_name
            FROM medical_records mr
            LEFT JOIN patients p ON mr.patient_id = p.id
            LEFT JOIN users u ON mr.doctor_id = u.id
            WHERE 1=1
        `;
        const params = [];
        
        if (patient_id) {
            params.push(patient_id);
            query += ` AND mr.patient_id = $${params.length}`;
        }
        
        query += ` ORDER BY mr.created_at DESC LIMIT ${limit} OFFSET ${offset}`;
        
        const result = await pool.query(query, params);
        res.json({ success: true, records: result.rows });
    } catch (error) {
        console.error('EMR fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch medical records' });
    }
});

app.put('/api/emr/records/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { diagnosis, symptoms, treatment_plan, notes, vital_signs } = req.body;
        
        const result = await pool.query(
            `UPDATE medical_records 
             SET diagnosis = $1, symptoms = $2, treatment_plan = $3, notes = $4, vital_signs = $5, updated_at = NOW()
             WHERE id = $6 RETURNING *`,
            [diagnosis, symptoms, treatment_plan, notes, JSON.stringify(vital_signs), id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Record not found' });
        }
        
        broadcast('emr_updated', result.rows[0]);
        res.json({ success: true, record: result.rows[0] });
    } catch (error) {
        console.error('EMR update error:', error);
        res.status(500).json({ error: 'Failed to update medical record' });
    }
});

app.delete('/api/emr/records/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query('DELETE FROM medical_records WHERE id = $1 RETURNING id', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Record not found' });
        }
        
        broadcast('emr_deleted', { id });
        res.json({ success: true, message: 'Record deleted successfully' });
    } catch (error) {
        console.error('EMR delete error:', error);
        res.status(500).json({ error: 'Failed to delete medical record' });
    }
});

// ============ BILLING & REVENUE ============
app.post('/api/billing/invoices', authenticateToken, async (req, res) => {
    try {
        const { patient_id, items, total_amount, payment_method, insurance_claim } = req.body;
        
        const result = await pool.query(
            `INSERT INTO invoices (patient_id, items, total_amount, paid_amount, balance, status, payment_method, insurance_claim, created_at)
             VALUES ($1, $2, $3, 0, $3, 'pending', $4, $5, NOW())
             RETURNING *`,
            [patient_id, JSON.stringify(items), total_amount, payment_method, insurance_claim]
        );
        
        broadcast('invoice_created', result.rows[0]);
        res.json({ success: true, invoice: result.rows[0] });
    } catch (error) {
        console.error('Invoice creation error:', error);
        res.status(500).json({ error: 'Failed to create invoice' });
    }
});

app.get('/api/billing/invoices', authenticateToken, async (req, res) => {
    try {
        const { patient_id, status, limit = 50, offset = 0 } = req.query;
        
        let query = `
            SELECT i.*, p.name as patient_name, p.email as patient_email
            FROM invoices i
            LEFT JOIN patients p ON i.patient_id = p.id
            WHERE 1=1
        `;
        const params = [];
        
        if (patient_id) {
            params.push(patient_id);
            query += ` AND i.patient_id = $${params.length}`;
        }
        
        if (status) {
            params.push(status);
            query += ` AND i.status = $${params.length}`;
        }
        
        query += ` ORDER BY i.created_at DESC LIMIT ${limit} OFFSET ${offset}`;
        
        const result = await pool.query(query, params);
        res.json({ success: true, invoices: result.rows });
    } catch (error) {
        console.error('Invoice fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch invoices' });
    }
});

app.post('/api/billing/payment/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { amount, payment_method, reference } = req.body;
        
        // Get current invoice
        const invoice = await pool.query('SELECT * FROM invoices WHERE id = $1', [id]);
        
        if (invoice.rows.length === 0) {
            return res.status(404).json({ error: 'Invoice not found' });
        }
        
        const currentInvoice = invoice.rows[0];
        const newPaidAmount = parseFloat(currentInvoice.paid_amount) + parseFloat(amount);
        const newBalance = parseFloat(currentInvoice.total_amount) - newPaidAmount;
        const newStatus = newBalance <= 0 ? 'paid' : 'partial';
        
        // Update invoice
        const result = await pool.query(
            `UPDATE invoices 
             SET paid_amount = $1, balance = $2, status = $3, updated_at = NOW()
             WHERE id = $4 RETURNING *`,
            [newPaidAmount, newBalance, newStatus, id]
        );
        
        // Record payment
        await pool.query(
            `INSERT INTO payments (invoice_id, amount, payment_method, reference, created_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [id, amount, payment_method, reference]
        );
        
        broadcast('payment_received', result.rows[0]);
        res.json({ success: true, invoice: result.rows[0] });
    } catch (error) {
        console.error('Payment error:', error);
        res.status(500).json({ error: 'Failed to process payment' });
    }
});

app.get('/api/billing/revenue', authenticateToken, async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        
        let query = `
            SELECT 
                DATE(created_at) as date,
                SUM(paid_amount) as total_revenue,
                COUNT(*) as transaction_count
            FROM invoices
            WHERE status IN ('paid', 'partial')
        `;
        const params = [];
        
        if (start_date) {
            params.push(start_date);
            query += ` AND created_at >= $${params.length}`;
        }
        
        if (end_date) {
            params.push(end_date);
            query += ` AND created_at <= $${params.length}`;
        }
        
        query += ` GROUP BY DATE(created_at) ORDER BY date DESC`;
        
        const result = await pool.query(query, params);
        res.json({ success: true, revenue: result.rows });
    } catch (error) {
        console.error('Revenue fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch revenue data' });
    }
});

// ============ INVENTORY MANAGEMENT ============
app.post('/api/inventory/items', authenticateToken, async (req, res) => {
    try {
        const { name, category, quantity, unit, reorder_level, unit_price, supplier_id } = req.body;
        
        const result = await pool.query(
            `INSERT INTO inventory (name, category, quantity, unit, reorder_level, unit_price, supplier_id, last_updated)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             RETURNING *`,
            [name, category, quantity, unit, reorder_level, unit_price, supplier_id]
        );
        
        // Check if below reorder level
        if (quantity <= reorder_level) {
            await pool.query(
                `INSERT INTO reorder_alerts (item_id, item_name, current_quantity, reorder_level, created_at)
                 VALUES ($1, $2, $3, $4, NOW())`,
                [result.rows[0].id, name, quantity, reorder_level]
            );
            broadcast('low_stock_alert', result.rows[0]);
        }
        
        broadcast('inventory_added', result.rows[0]);
        res.json({ success: true, item: result.rows[0] });
    } catch (error) {
        console.error('Inventory add error:', error);
        res.status(500).json({ error: 'Failed to add inventory item' });
    }
});

app.get('/api/inventory', authenticateToken, async (req, res) => {
    try {
        const { category, low_stock, search, limit = 50, offset = 0 } = req.query;
        
        let query = `
            SELECT i.*, s.name as supplier_name
            FROM inventory i
            LEFT JOIN suppliers s ON i.supplier_id = s.id
            WHERE 1=1
        `;
        const params = [];
        
        if (category) {
            params.push(category);
            query += ` AND i.category = $${params.length}`;
        }
        
        if (low_stock === 'true') {
            query += ` AND i.quantity <= i.reorder_level`;
        }
        
        if (search) {
            params.push(`%${search}%`);
            query += ` AND i.name ILIKE $${params.length}`;
        }
        
        query += ` ORDER BY i.name LIMIT ${limit} OFFSET ${offset}`;
        
        const result = await pool.query(query, params);
        res.json({ success: true, items: result.rows });
    } catch (error) {
        console.error('Inventory fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch inventory' });
    }
});

app.put('/api/inventory/use/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { quantity, reason, patient_id } = req.body;
        
        // Get current item
        const item = await pool.query('SELECT * FROM inventory WHERE id = $1', [id]);
        
        if (item.rows.length === 0) {
            return res.status(404).json({ error: 'Item not found' });
        }
        
        const currentItem = item.rows[0];
        const newQuantity = currentItem.quantity - quantity;
        
        if (newQuantity < 0) {
            return res.status(400).json({ error: 'Insufficient stock' });
        }
        
        // Update inventory
        const result = await pool.query(
            `UPDATE inventory 
             SET quantity = $1, last_updated = NOW()
             WHERE id = $2 RETURNING *`,
            [newQuantity, id]
        );
        
        // Record transaction
        await pool.query(
            `INSERT INTO stock_transactions (item_id, type, quantity, reason, patient_id, user_id, created_at)
             VALUES ($1, 'usage', $2, $3, $4, $5, NOW())`,
            [id, quantity, reason, patient_id, req.user.id]
        );
        
        // Check if below reorder level
        if (newQuantity <= currentItem.reorder_level) {
            await pool.query(
                `INSERT INTO reorder_alerts (item_id, item_name, current_quantity, reorder_level, created_at)
                 VALUES ($1, $2, $3, $4, NOW())
                 ON CONFLICT (item_id) WHERE status = 'pending'
                 DO UPDATE SET current_quantity = $3, created_at = NOW()`,
                [id, currentItem.name, newQuantity, currentItem.reorder_level]
            );
            broadcast('low_stock_alert', result.rows[0]);
        }
        
        broadcast('inventory_updated', result.rows[0]);
        res.json({ success: true, item: result.rows[0] });
    } catch (error) {
        console.error('Inventory use error:', error);
        res.status(500).json({ error: 'Failed to update inventory' });
    }
});

app.get('/api/inventory/low-stock', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT i.*, s.name as supplier_name
            FROM inventory i
            LEFT JOIN suppliers s ON i.supplier_id = s.id
            WHERE i.quantity <= i.reorder_level
            ORDER BY (i.quantity::float / NULLIF(i.reorder_level, 0)) ASC
        `);
        
        res.json({ success: true, items: result.rows });
    } catch (error) {
        console.error('Low stock fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch low stock items' });
    }
});

// ============ STAFF MANAGEMENT ============
app.post('/api/staff/schedules', authenticateToken, async (req, res) => {
    try {
        const { staff_id, date, shift_start, shift_end, department, notes } = req.body;
        
        const result = await pool.query(
            `INSERT INTO staff_schedules (staff_id, date, shift_start, shift_end, department, notes, created_by, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             RETURNING *`,
            [staff_id, date, shift_start, shift_end, department, notes, req.user.id]
        );
        
        broadcast('schedule_added', result.rows[0]);
        res.json({ success: true, schedule: result.rows[0] });
    } catch (error) {
        console.error('Schedule add error:', error);
        res.status(500).json({ error: 'Failed to add schedule' });
    }
});

app.get('/api/staff/schedules', authenticateToken, async (req, res) => {
    try {
        const { staff_id, department, date, limit = 50, offset = 0 } = req.query;
        
        let query = `
            SELECT ss.*, s.name as staff_name, s.role as staff_role
            FROM staff_schedules ss
            LEFT JOIN staff s ON ss.staff_id = s.id
            WHERE 1=1
        `;
        const params = [];
        
        if (staff_id) {
            params.push(staff_id);
            query += ` AND ss.staff_id = $${params.length}`;
        }
        
        if (department) {
            params.push(department);
            query += ` AND ss.department = $${params.length}`;
        }
        
        if (date) {
            params.push(date);
            query += ` AND ss.date = $${params.length}`;
        }
        
        query += ` ORDER BY ss.date DESC, ss.shift_start ASC LIMIT ${limit} OFFSET ${offset}`;
        
        const result = await pool.query(query, params);
        res.json({ success: true, schedules: result.rows });
    } catch (error) {
        console.error('Schedule fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch schedules' });
    }
});

app.post('/api/staff/attendance', authenticateToken, async (req, res) => {
    try {
        const { staff_id, check_type, location } = req.body;
        
        const result = await pool.query(
            `INSERT INTO staff_attendance (staff_id, check_type, check_time, location)
             VALUES ($1, $2, NOW(), $3)
             RETURNING *`,
            [staff_id, check_type, location]
        );
        
        broadcast('attendance_marked', result.rows[0]);
        res.json({ success: true, attendance: result.rows[0] });
    } catch (error) {
        console.error('Attendance error:', error);
        res.status(500).json({ error: 'Failed to mark attendance' });
    }
});

app.get('/api/staff', authenticateToken, async (req, res) => {
    try {
        const { department, role, search, limit = 50, offset = 0 } = req.query;
        
        let query = `
            SELECT s.*, COUNT(ss.id) as scheduled_shifts
            FROM staff s
            LEFT JOIN staff_schedules ss ON s.id = ss.staff_id AND ss.date >= CURRENT_DATE
            WHERE 1=1
        `;
        const params = [];
        
        if (department) {
            params.push(department);
            query += ` AND s.department = $${params.length}`;
        }
        
        if (role) {
            params.push(role);
            query += ` AND s.role = $${params.length}`;
        }
        
        if (search) {
            params.push(`%${search}%`);
            query += ` AND (s.name ILIKE $${params.length} OR s.email ILIKE $${params.length})`;
        }
        
        query += ` GROUP BY s.id ORDER BY s.name LIMIT ${limit} OFFSET ${offset}`;
        
        const result = await pool.query(query, params);
        res.json({ success: true, staff: result.rows });
    } catch (error) {
        console.error('Staff fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch staff' });
    }
});

// ============ BED MANAGEMENT ============
app.post('/api/beds/admission', authenticateToken, async (req, res) => {
    try {
        const { patient_id, bed_id, ward_id, admission_reason, expected_discharge } = req.body;
        
        // Check bed availability
        const bedCheck = await pool.query('SELECT * FROM beds WHERE id = $1 AND status = $2', [bed_id, 'available']);
        
        if (bedCheck.rows.length === 0) {
            return res.status(400).json({ error: 'Bed not available' });
        }
        
        // Create admission
        const result = await pool.query(
            `INSERT INTO admissions (patient_id, bed_id, ward_id, admission_reason, admission_date, expected_discharge, status)
             VALUES ($1, $2, $3, $4, NOW(), $5, 'active')
             RETURNING *`,
            [patient_id, bed_id, ward_id, admission_reason, expected_discharge]
        );
        
        // Update bed status
        await pool.query('UPDATE beds SET status = $1, current_patient_id = $2 WHERE id = $3', ['occupied', patient_id, bed_id]);
        
        broadcast('admission_created', result.rows[0]);
        res.json({ success: true, admission: result.rows[0] });
    } catch (error) {
        console.error('Admission error:', error);
        res.status(500).json({ error: 'Failed to create admission' });
    }
});

app.get('/api/beds/available', authenticateToken, async (req, res) => {
    try {
        const { ward_id, bed_type } = req.query;
        
        let query = `
            SELECT b.*, w.name as ward_name
            FROM beds b
            LEFT JOIN wards w ON b.ward_id = w.id
            WHERE b.status = 'available'
        `;
        const params = [];
        
        if (ward_id) {
            params.push(ward_id);
            query += ` AND b.ward_id = $${params.length}`;
        }
        
        if (bed_type) {
            params.push(bed_type);
            query += ` AND b.bed_type = $${params.length}`;
        }
        
        query += ` ORDER BY w.name, b.bed_number`;
        
        const result = await pool.query(query, params);
        res.json({ success: true, beds: result.rows });
    } catch (error) {
        console.error('Available beds error:', error);
        res.status(500).json({ error: 'Failed to fetch available beds' });
    }
});

app.post('/api/beds/discharge/:admissionId', authenticateToken, async (req, res) => {
    try {
        const { admissionId } = req.params;
        const { discharge_notes, follow_up_date } = req.body;
        
        // Get admission details
        const admission = await pool.query('SELECT * FROM admissions WHERE id = $1 AND status = $2', [admissionId, 'active']);
        
        if (admission.rows.length === 0) {
            return res.status(404).json({ error: 'Active admission not found' });
        }
        
        const admissionData = admission.rows[0];
        
        // Update admission
        const result = await pool.query(
            `UPDATE admissions 
             SET status = 'discharged', discharge_date = NOW(), discharge_notes = $1, follow_up_date = $2
             WHERE id = $3 RETURNING *`,
            [discharge_notes, follow_up_date, admissionId]
        );
        
        // Free the bed
        await pool.query('UPDATE beds SET status = $1, current_patient_id = NULL WHERE id = $2', ['available', admissionData.bed_id]);
        
        broadcast('patient_discharged', result.rows[0]);
        res.json({ success: true, admission: result.rows[0] });
    } catch (error) {
        console.error('Discharge error:', error);
        res.status(500).json({ error: 'Failed to discharge patient' });
    }
});

app.get('/api/beds', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                w.name as ward_name,
                COUNT(b.id) as total_beds,
                COUNT(CASE WHEN b.status = 'available' THEN 1 END) as available_beds,
                COUNT(CASE WHEN b.status = 'occupied' THEN 1 END) as occupied_beds,
                ROUND(COUNT(CASE WHEN b.status = 'occupied' THEN 1 END)::numeric / COUNT(b.id) * 100, 2) as occupancy_rate
            FROM wards w
            LEFT JOIN beds b ON w.id = b.ward_id
            GROUP BY w.id, w.name
            ORDER BY w.name
        `);
        
        res.json({ success: true, wards: result.rows });
    } catch (error) {
        console.error('Bed stats error:', error);
        res.status(500).json({ error: 'Failed to fetch bed statistics' });
    }
});

// ============ ANALYTICS DASHBOARD ============
app.get('/api/analytics/dashboard', authenticateToken, async (req, res) => {
    try {
        // Get multiple metrics in parallel
        const [
            patientCount,
            activeAdmissions,
            todayAppointments,
            monthlyRevenue,
            bedOccupancy,
            lowStockItems,
            staffOnDuty
        ] = await Promise.all([
            pool.query('SELECT COUNT(*) as count FROM patients'),
            pool.query('SELECT COUNT(*) as count FROM admissions WHERE status = $1', ['active']),
            pool.query('SELECT COUNT(*) as count FROM appointments WHERE DATE(appointment_date) = CURRENT_DATE'),
            pool.query(`
                SELECT SUM(paid_amount) as total 
                FROM invoices 
                WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)
            `),
            pool.query(`
                SELECT 
                    COUNT(CASE WHEN status = 'occupied' THEN 1 END)::float / NULLIF(COUNT(*), 0) * 100 as occupancy_rate
                FROM beds
            `),
            pool.query('SELECT COUNT(*) as count FROM inventory WHERE quantity <= reorder_level'),
            pool.query(`
                SELECT COUNT(*) as count 
                FROM staff_schedules 
                WHERE date = CURRENT_DATE 
                AND CURRENT_TIME BETWEEN shift_start AND shift_end
            `)
        ]);
        
        // Get department-wise patient distribution
        const departmentStats = await pool.query(`
            SELECT 
                d.name as department,
                COUNT(a.id) as patient_count
            FROM departments d
            LEFT JOIN appointments a ON d.id = a.department_id AND DATE(a.appointment_date) = CURRENT_DATE
            GROUP BY d.id, d.name
            ORDER BY patient_count DESC
        `);
        
        // Get daily revenue trend (last 7 days)
        const revenueTrend = await pool.query(`
            SELECT 
                DATE(created_at) as date,
                SUM(paid_amount) as revenue
            FROM invoices
            WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
            GROUP BY DATE(created_at)
            ORDER BY date
        `);
        
        res.json({
            success: true,
            metrics: {
                totalPatients: patientCount.rows[0].count,
                activeAdmissions: activeAdmissions.rows[0].count,
                todayAppointments: todayAppointments.rows[0].count,
                monthlyRevenue: monthlyRevenue.rows[0].total || 0,
                bedOccupancy: Math.round(bedOccupancy.rows[0].occupancy_rate || 0),
                lowStockItems: lowStockItems.rows[0].count,
                staffOnDuty: staffOnDuty.rows[0].count,
                departmentStats: departmentStats.rows,
                revenueTrend: revenueTrend.rows
            }
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard metrics' });
    }
});

app.get('/api/analytics/report', authenticateToken, async (req, res) => {
    try {
        const { type = 'summary', start_date, end_date } = req.query;
        
        let dateFilter = '';
        const params = [];
        
        if (start_date) {
            params.push(start_date);
            dateFilter += ` AND created_at >= $${params.length}`;
        }
        
        if (end_date) {
            params.push(end_date);
            dateFilter += ` AND created_at <= $${params.length}`;
        }
        
        const report = {};
        
        if (type === 'summary' || type === 'financial') {
            const financial = await pool.query(`
                SELECT 
                    COUNT(*) as total_invoices,
                    SUM(total_amount) as total_billed,
                    SUM(paid_amount) as total_collected,
                    SUM(balance) as total_outstanding,
                    AVG(total_amount) as average_invoice_amount
                FROM invoices
                WHERE 1=1 ${dateFilter}
            `, params);
            report.financial = financial.rows[0];
        }
        
        if (type === 'summary' || type === 'operational') {
            const operational = await pool.query(`
                SELECT 
                    (SELECT COUNT(*) FROM appointments WHERE 1=1 ${dateFilter}) as total_appointments,
                    (SELECT COUNT(*) FROM admissions WHERE 1=1 ${dateFilter}) as total_admissions,
                    (SELECT COUNT(*) FROM lab_results WHERE 1=1 ${dateFilter}) as total_lab_tests,
                    (SELECT COUNT(*) FROM prescriptions WHERE 1=1 ${dateFilter}) as total_prescriptions
            `, params);
            report.operational = operational.rows[0];
        }
        
        if (type === 'summary' || type === 'inventory') {
            const inventory = await pool.query(`
                SELECT 
                    COUNT(*) as total_items,
                    COUNT(CASE WHEN quantity <= reorder_level THEN 1 END) as low_stock_items,
                    SUM(quantity * unit_price) as total_inventory_value
                FROM inventory
            `);
            report.inventory = inventory.rows[0];
        }
        
        res.json({ success: true, report });
    } catch (error) {
        console.error('Report generation error:', error);
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

// ============ PATIENTS ============
app.post('/api/patients', authenticateToken, async (req, res) => {
    try {
        const { name, email, phone, date_of_birth, gender, address, emergency_contact } = req.body;
        
        const result = await pool.query(
            `INSERT INTO patients (name, email, phone, date_of_birth, gender, address, emergency_contact, registered_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             RETURNING *`,
            [name, email, phone, date_of_birth, gender, address, JSON.stringify(emergency_contact)]
        );
        
        broadcast('patient_registered', result.rows[0]);
        res.json({ success: true, patient: result.rows[0] });
    } catch (error) {
        console.error('Patient registration error:', error);
        res.status(500).json({ error: 'Failed to register patient' });
    }
});

app.get('/api/patients', authenticateToken, async (req, res) => {
    try {
        const { search, limit = 50, offset = 0 } = req.query;
        
        let query = 'SELECT * FROM patients WHERE 1=1';
        const params = [];
        
        if (search) {
            params.push(`%${search}%`);
            query += ` AND (name ILIKE $${params.length} OR email ILIKE $${params.length} OR phone ILIKE $${params.length})`;
        }
        
        query += ` ORDER BY name LIMIT ${limit} OFFSET ${offset}`;
        
        const result = await pool.query(query, params);
        res.json({ success: true, patients: result.rows });
    } catch (error) {
        console.error('Patient fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch patients' });
    }
});

// ============ APPOINTMENTS ============
app.post('/api/appointments', authenticateToken, async (req, res) => {
    try {
        const { patient_id, doctor_id, appointment_date, appointment_time, department_id, reason, notes } = req.body;
        
        const result = await pool.query(
            `INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, department_id, reason, notes, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled', NOW())
             RETURNING *`,
            [patient_id, doctor_id, appointment_date, appointment_time, department_id, reason, notes]
        );
        
        broadcast('appointment_created', result.rows[0]);
        res.json({ success: true, appointment: result.rows[0] });
    } catch (error) {
        console.error('Appointment creation error:', error);
        res.status(500).json({ error: 'Failed to create appointment' });
    }
});

app.get('/api/appointments', authenticateToken, async (req, res) => {
    try {
        const { patient_id, doctor_id, date, status, limit = 50, offset = 0 } = req.query;
        
        let query = `
            SELECT a.*, p.name as patient_name, d.name as doctor_name, dept.name as department_name
            FROM appointments a
            LEFT JOIN patients p ON a.patient_id = p.id
            LEFT JOIN users d ON a.doctor_id = d.id
            LEFT JOIN departments dept ON a.department_id = dept.id
            WHERE 1=1
        `;
        const params = [];
        
        if (patient_id) {
            params.push(patient_id);
            query += ` AND a.patient_id = $${params.length}`;
        }
        
        if (doctor_id) {
            params.push(doctor_id);
            query += ` AND a.doctor_id = $${params.length}`;
        }
        
        if (date) {
            params.push(date);
            query += ` AND DATE(a.appointment_date) = $${params.length}`;
        }
        
        if (status) {
            params.push(status);
            query += ` AND a.status = $${params.length}`;
        }
        
        query += ` ORDER BY a.appointment_date DESC, a.appointment_time DESC LIMIT ${limit} OFFSET ${offset}`;
        
        const result = await pool.query(query, params);
        res.json({ success: true, appointments: result.rows });
    } catch (error) {
        console.error('Appointment fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch appointments' });
    }
});

// ============ LAB RESULTS ============
app.post('/api/lab-results', authenticateToken, async (req, res) => {
    try {
        const { patient_id, test_name, test_type, results, normal_range, notes } = req.body;
        
        const result = await pool.query(
            `INSERT INTO lab_results (patient_id, test_name, test_type, results, normal_range, notes, technician_id, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             RETURNING *`,
            [patient_id, test_name, test_type, JSON.stringify(results), normal_range, notes, req.user.id]
        );
        
        broadcast('lab_result_created', result.rows[0]);
        res.json({ success: true, labResult: result.rows[0] });
    } catch (error) {
        console.error('Lab result error:', error);
        res.status(500).json({ error: 'Failed to create lab result' });
    }
});

app.get('/api/lab-results', authenticateToken, async (req, res) => {
    try {
        const { patient_id, test_type, limit = 50, offset = 0 } = req.query;
        
        let query = `
            SELECT lr.*, p.name as patient_name, u.name as technician_name
            FROM lab_results lr
            LEFT JOIN patients p ON lr.patient_id = p.id
            LEFT JOIN users u ON lr.technician_id = u.id
            WHERE 1=1
        `;
        const params = [];
        
        if (patient_id) {
            params.push(patient_id);
            query += ` AND lr.patient_id = $${params.length}`;
        }
        
        if (test_type) {
            params.push(test_type);
            query += ` AND lr.test_type = $${params.length}`;
        }
        
        query += ` ORDER BY lr.created_at DESC LIMIT ${limit} OFFSET ${offset}`;
        
        const result = await pool.query(query, params);
        res.json({ success: true, labResults: result.rows });
    } catch (error) {
        console.error('Lab results fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch lab results' });
    }
});

// ============ PRESCRIPTIONS ============
app.post('/api/prescriptions', authenticateToken, async (req, res) => {
    try {
        const { patient_id, medications, instructions } = req.body;
        
        const result = await pool.query(
            `INSERT INTO prescriptions (patient_id, doctor_id, medications, instructions, status, created_at)
             VALUES ($1, $2, $3, $4, 'active', NOW())
             RETURNING *`,
            [patient_id, req.user.id, JSON.stringify(medications), instructions]
        );
        
        broadcast('prescription_created', result.rows[0]);
        res.json({ success: true, prescription: result.rows[0] });
    } catch (error) {
        console.error('Prescription error:', error);
        res.status(500).json({ error: 'Failed to create prescription' });
    }
});

app.get('/api/prescriptions', authenticateToken, async (req, res) => {
    try {
        const { patient_id, doctor_id, status, limit = 50, offset = 0 } = req.query;
        
        let query = `
            SELECT pr.*, p.name as patient_name, d.name as doctor_name
            FROM prescriptions pr
            LEFT JOIN patients p ON pr.patient_id = p.id
            LEFT JOIN users d ON pr.doctor_id = d.id
            WHERE 1=1
        `;
        const params = [];
        
        if (patient_id) {
            params.push(patient_id);
            query += ` AND pr.patient_id = $${params.length}`;
        }
        
        if (doctor_id) {
            params.push(doctor_id);
            query += ` AND pr.doctor_id = $${params.length}`;
        }
        
        if (status) {
            params.push(status);
            query += ` AND pr.status = $${params.length}`;
        }
        
        query += ` ORDER BY pr.created_at DESC LIMIT ${limit} OFFSET ${offset}`;
        
        const result = await pool.query(query, params);
        res.json({ success: true, prescriptions: result.rows });
    } catch (error) {
        console.error('Prescription fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch prescriptions' });
    }
});

// ============ DIGITAL SOURCING & PARTNER ONBOARDING ============
app.post('/api/onboarding/application', upload.array('documents', 10), async (req, res) => {
    try {
        const { hospital_name, owner_name, owner_email, owner_phone, address, bed_capacity, specialties } = req.body;
        
        // Create application
        const application = await pool.query(
            `INSERT INTO hospital_applications (hospital_name, owner_name, owner_email, owner_phone, address, bed_capacity, specialties, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NOW())
             RETURNING *`,
            [hospital_name, owner_name, owner_email, owner_phone, address, bed_capacity, JSON.stringify(specialties)]
        );
        
        const applicationId = application.rows[0].id;
        
        // Save documents
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                await pool.query(
                    `INSERT INTO application_documents (application_id, document_type, file_path, file_name, uploaded_at)
                     VALUES ($1, $2, $3, $4, NOW())`,
                    [applicationId, file.fieldname, file.path, file.originalname]
                );
            }
        }
        
        // Create initial onboarding progress
        await pool.query(
            `INSERT INTO onboarding_progress (application_id, step, status, updated_at)
             VALUES ($1, 'application_submitted', 'completed', NOW())`,
            [applicationId]
        );
        
        broadcast('application_received', application.rows[0]);
        res.json({ success: true, application: application.rows[0] });
    } catch (error) {
        console.error('Application submission error:', error);
        res.status(500).json({ error: 'Failed to submit application' });
    }
});

app.post('/api/onboarding/evaluate/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { scores, comments } = req.body;
        
        // Calculate total score
        let totalScore = 0;
        let maxScore = 0;
        
        // Get evaluation criteria
        const criteria = await pool.query('SELECT * FROM evaluation_criteria');
        
        for (const criterion of criteria.rows) {
            const score = scores[criterion.id] || 0;
            totalScore += score * (criterion.weight / 100);
            maxScore += criterion.max_score * (criterion.weight / 100);
        }
        
        const finalScore = (totalScore / maxScore) * 100;
        const status = finalScore >= 70 ? 'approved' : 'rejected';
        
        // Save evaluation
        const evaluation = await pool.query(
            `INSERT INTO application_evaluations (application_id, evaluator_id, scores, total_score, comments, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             RETURNING *`,
            [id, req.user.id, JSON.stringify(scores), finalScore, comments, status]
        );
        
        // Update application status
        await pool.query(
            'UPDATE hospital_applications SET status = $1, score = $2 WHERE id = $3',
            [status, finalScore, id]
        );
        
        // Update onboarding progress
        await pool.query(
            `INSERT INTO onboarding_progress (application_id, step, status, updated_at)
             VALUES ($1, 'evaluation_completed', 'completed', NOW())`,
            [id]
        );
        
        broadcast('application_evaluated', evaluation.rows[0]);
        res.json({ success: true, evaluation: evaluation.rows[0] });
    } catch (error) {
        console.error('Evaluation error:', error);
        res.status(500).json({ error: 'Failed to evaluate application' });
    }
});

app.post('/api/onboarding/generate-contract/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { template_id, custom_terms } = req.body;
        
        // Get application details
        const application = await pool.query('SELECT * FROM hospital_applications WHERE id = $1', [id]);
        
        if (application.rows.length === 0) {
            return res.status(404).json({ error: 'Application not found' });
        }
        
        const appData = application.rows[0];
        
        // Generate contract PDF
        const doc = new PDFDocument();
        const contractPath = `contracts/contract_${id}_${Date.now()}.pdf`;
        
        // Create contracts directory if it doesn't exist
        if (!fs.existsSync('contracts')) {
            fs.mkdirSync('contracts');
        }
        
        doc.pipe(fs.createWriteStream(contractPath));
        
        doc.fontSize(20).text('Hospital Partnership Contract', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12);
        doc.text(`Hospital: ${appData.hospital_name}`);
        doc.text(`Owner: ${appData.owner_name}`);
        doc.text(`Date: ${new Date().toLocaleDateString()}`);
        doc.moveDown();
        doc.text('Terms and Conditions:', { underline: true });
        doc.text(custom_terms || 'Standard partnership terms apply.');
        doc.moveDown(2);
        doc.text('Signature: _______________________');
        doc.text('Date: _______________________');
        
        doc.end();
        
        // Save contract record
        const contract = await pool.query(
            `INSERT INTO contracts (hospital_id, application_id, contract_path, terms, status, created_at)
             VALUES ($1, $2, $3, $4, 'pending', NOW())
             RETURNING *`,
            [appData.id, id, contractPath, custom_terms]
        );
        
        // Update onboarding progress
        await pool.query(
            `INSERT INTO onboarding_progress (application_id, step, status, updated_at)
             VALUES ($1, 'contract_generated', 'completed', NOW())`,
            [id]
        );
        
        broadcast('contract_generated', contract.rows[0]);
        res.json({ success: true, contract: contract.rows[0] });
    } catch (error) {
        console.error('Contract generation error:', error);
        res.status(500).json({ error: 'Failed to generate contract' });
    }
});

app.post('/api/onboarding/sign-contract/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { signature_data } = req.body;
        
        // Update contract with signature
        const result = await pool.query(
            `UPDATE contracts 
             SET status = 'signed', signature_data = $1, signed_at = NOW()
             WHERE id = $2
             RETURNING *`,
            [signature_data, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Contract not found' });
        }
        
        const contract = result.rows[0];
        
        // Create hospital record
        const application = await pool.query('SELECT * FROM hospital_applications WHERE id = $1', [contract.application_id]);
        
        if (application.rows.length > 0) {
            const appData = application.rows[0];
            
            await pool.query(
                `INSERT INTO hospitals (name, owner_id, address, bed_capacity, specialties, contract_id, status, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW())`,
                [appData.hospital_name, appData.owner_id, appData.address, appData.bed_capacity, appData.specialties, id]
            );
            
            // Update application status
            await pool.query('UPDATE hospital_applications SET status = $1 WHERE id = $2', ['completed', contract.application_id]);
            
            // Update onboarding progress
            await pool.query(
                `INSERT INTO onboarding_progress (application_id, step, status, updated_at)
                 VALUES ($1, 'onboarding_completed', 'completed', NOW())`,
                [contract.application_id]
            );
        }
        
        broadcast('contract_signed', contract);
        res.json({ success: true, contract });
    } catch (error) {
        console.error('Contract signing error:', error);
        res.status(500).json({ error: 'Failed to sign contract' });
    }
});

app.get('/api/onboarding/applications', authenticateToken, async (req, res) => {
    try {
        const { status, limit = 50, offset = 0 } = req.query;
        
        let query = `
            SELECT ha.*, 
                   COUNT(ad.id) as document_count,
                   MAX(op.step) as current_step
            FROM hospital_applications ha
            LEFT JOIN application_documents ad ON ha.id = ad.application_id
            LEFT JOIN onboarding_progress op ON ha.id = op.application_id
            WHERE 1=1
        `;
        const params = [];
        
        if (status) {
            params.push(status);
            query += ` AND ha.status = $${params.length}`;
        }
        
        query += ` GROUP BY ha.id ORDER BY ha.created_at DESC LIMIT ${limit} OFFSET ${offset}`;
        
        const result = await pool.query(query, params);
        res.json({ success: true, applications: result.rows });
    } catch (error) {
        console.error('Applications fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch applications' });
    }
});

app.get('/api/onboarding/progress/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        const progress = await pool.query(
            `SELECT * FROM onboarding_progress 
             WHERE application_id = $1 
             ORDER BY updated_at ASC`,
            [id]
        );
        
        const checklist = await pool.query(
            `SELECT * FROM onboarding_checklist 
             ORDER BY sequence ASC`
        );
        
        res.json({
            success: true,
            progress: progress.rows,
            checklist: checklist.rows
        });
    } catch (error) {
        console.error('Progress fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch onboarding progress' });
    }
});

// ============ HEALTH & STATUS ============
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        timestamp: new Date(),
        services: {
            database: 'connected',
            websocket: wsClients.size > 0 ? 'active' : 'ready'
        }
    });
});

app.get('/api/status', authenticateToken, async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM patients) as total_patients,
                (SELECT COUNT(*) FROM users) as total_users,
                (SELECT COUNT(*) FROM appointments WHERE DATE(appointment_date) = CURRENT_DATE) as today_appointments,
                (SELECT COUNT(*) FROM admissions WHERE status = 'active') as active_admissions
        `);
        
        res.json({
            success: true,
            stats: stats.rows[0],
            server: {
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                connections: wsClients.size
            }
        });
    } catch (error) {
        console.error('Status error:', error);
        res.status(500).json({ error: 'Failed to fetch status' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 5700;
server.listen(PORT, () => {
    console.log(`Hospital Management System Backend running on port ${PORT}`);
    console.log(`WebSocket server ready for connections`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing server...');
    server.close(() => {
        pool.end();
        process.exit(0);
    });
});
