const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const WebSocket = require('ws');
const http = require('http');
const PDFDocument = require('pdfkit');

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

const JWT_SECRET = 'hms-secret-key-2024';
const wsClients = new Set();

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

// ============ PATIENTS ============
app.get('/api/patients', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                id::text as id,
                CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, '')) as name,
                first_name, last_name, date_of_birth, gender, phone, email,
                address, blood_group as blood_type, allergies,
                emergency_contact_name as emergency_contact
            FROM patients 
            ORDER BY first_name, last_name
        `);
        res.json({ success: true, patients: result.rows });
    } catch (error) {
        console.error('Error fetching patients:', error);
        res.status(500).json({ error: 'Failed to fetch patients' });
    }
});

app.post('/api/patients', authenticateToken, async (req, res) => {
    try {
        const { name, dateOfBirth, gender, phone, email, address, bloodType, allergies, emergencyContact } = req.body;
        const nameParts = (name || '').split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';
        
        const result = await pool.query(`
            INSERT INTO patients (first_name, last_name, date_of_birth, gender, phone, email, address, blood_group, allergies, emergency_contact_name)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id::text as id, CONCAT(first_name, ' ', last_name) as name, *`,
            [firstName, lastName, dateOfBirth, gender, phone, email, address, bloodType, allergies, emergencyContact]
        );
        
        broadcast('new_patient', { patientName: name });
        res.json({ success: true, patient: result.rows[0] });
    } catch (error) {
        console.error('Error creating patient:', error);
        res.status(500).json({ error: 'Failed to create patient' });
    }
});

// ============ MEDICAL RECORDS (FIXED) ============
app.post('/api/emr/records', authenticateToken, async (req, res) => {
    try {
        const { patientId, diagnosis, symptoms, treatment, prescription, followUpDate, vitalSigns, notes } = req.body;
        
        // Use patient_uuid for UUID patients
        const result = await pool.query(`
            INSERT INTO medical_records 
            (patient_uuid, doctor_id, diagnosis, symptoms, treatment, prescription, follow_up_date, vital_signs, notes)
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *`,
            [patientId, req.user.id, diagnosis, symptoms, treatment, prescription, followUpDate, vitalSigns, notes]
        );
        
        broadcast('new_medical_record', { patientId });
        res.json({ success: true, record: result.rows[0] });
    } catch (error) {
        console.error('Error creating medical record:', error);
        res.status(500).json({ error: 'Failed to create medical record' });
    }
});

app.get('/api/emr/records', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                mr.*,
                p.first_name || ' ' || p.last_name as patient_name,
                u.name as doctor_name
            FROM medical_records mr
            LEFT JOIN patients p ON mr.patient_uuid = p.id OR mr.patient_id = uuid_to_int(p.id)
            LEFT JOIN users u ON mr.doctor_id = u.id
            ORDER BY mr.created_at DESC
            LIMIT 100
        `);
        res.json({ success: true, records: result.rows });
    } catch (error) {
        console.error('Error fetching medical records:', error);
        res.status(500).json({ error: 'Failed to fetch medical records' });
    }
});

// ============ BILLING (FIXED) ============
app.post('/api/billing/create-invoice', authenticateToken, async (req, res) => {
    try {
        const { patientId, items, dueDate, paymentMethod } = req.body;
        const invoiceNumber = 'INV-' + Date.now();
        
        let subtotal = 0;
        items.forEach(item => {
            subtotal += item.quantity * item.price;
        });
        const tax = subtotal * 0.1;
        const total = subtotal + tax;
        
        const result = await pool.query(`
            INSERT INTO invoices (patient_uuid, invoice_number, due_date, items, subtotal, tax, total, payment_method, status)
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, 'pending')
            RETURNING *`,
            [patientId, invoiceNumber, dueDate, JSON.stringify(items), subtotal, tax, total, paymentMethod]
        );
        
        broadcast('new_invoice', { invoiceNumber, total });
        res.json({ success: true, invoice: result.rows[0] });
    } catch (error) {
        console.error('Error creating invoice:', error);
        res.status(500).json({ error: 'Failed to create invoice' });
    }
});

app.get('/api/billing/invoices', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                i.*,
                p.first_name || ' ' || p.last_name as patient_name
            FROM invoices i
            LEFT JOIN patients p ON i.patient_uuid = p.id OR i.patient_id = uuid_to_int(p.id)
            ORDER BY i.created_at DESC
            LIMIT 100
        `);
        res.json({ success: true, invoices: result.rows });
    } catch (error) {
        console.error('Error fetching invoices:', error);
        res.status(500).json({ error: 'Failed to fetch invoices' });
    }
});

app.post('/api/billing/pay-invoice/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { paymentMethod } = req.body;
        
        const result = await pool.query(`
            UPDATE invoices 
            SET status = 'paid', paid_date = CURRENT_DATE, payment_method = $1
            WHERE id = $2
            RETURNING *`,
            [paymentMethod, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Invoice not found' });
        }
        
        broadcast('invoice_paid', { invoiceId: id });
        res.json({ success: true, invoice: result.rows[0] });
    } catch (error) {
        console.error('Error paying invoice:', error);
        res.status(500).json({ error: 'Failed to process payment' });
    }
});

// ============ INVENTORY ============
app.post('/api/inventory/add-stock', authenticateToken, async (req, res) => {
    try {
        const { itemName, category, quantity, unit, reorderLevel, unitPrice, supplier, expiryDate } = req.body;
        
        const existing = await pool.query('SELECT * FROM inventory WHERE item_name = $1', [itemName]);
        
        if (existing.rows.length > 0) {
            const result = await pool.query(`
                UPDATE inventory 
                SET quantity = quantity + $1, last_updated = CURRENT_TIMESTAMP
                WHERE item_name = $2
                RETURNING *`,
                [quantity, itemName]
            );
            res.json({ success: true, item: result.rows[0] });
        } else {
            const result = await pool.query(`
                INSERT INTO inventory (item_name, category, quantity, unit, reorder_level, unit_price, supplier, expiry_date)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *`,
                [itemName, category, quantity, unit, reorderLevel, unitPrice, supplier, expiryDate]
            );
            res.json({ success: true, item: result.rows[0] });
        }
    } catch (error) {
        console.error('Error adding stock:', error);
        res.status(500).json({ error: 'Failed to add stock' });
    }
});

app.get('/api/inventory/low-stock', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM inventory 
            WHERE quantity <= reorder_level
            ORDER BY (quantity::float / NULLIF(reorder_level, 0)) ASC
        `);
        res.json({ success: true, items: result.rows });
    } catch (error) {
        console.error('Error fetching low stock items:', error);
        res.status(500).json({ error: 'Failed to fetch low stock items' });
    }
});

app.get('/api/inventory', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM inventory ORDER BY item_name');
        res.json({ success: true, items: result.rows });
    } catch (error) {
        console.error('Error fetching inventory:', error);
        res.status(500).json({ error: 'Failed to fetch inventory' });
    }
});

app.post('/api/inventory/use-item', authenticateToken, async (req, res) => {
    try {
        const { itemId, quantity } = req.body;
        
        const result = await pool.query(`
            UPDATE inventory 
            SET quantity = quantity - $1, last_updated = CURRENT_TIMESTAMP
            WHERE id = $2 AND quantity >= $1
            RETURNING *`,
            [quantity, itemId]
        );
        
        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Insufficient quantity' });
        }
        
        const item = result.rows[0];
        if (item.quantity <= item.reorder_level) {
            broadcast('low_stock_alert', { itemName: item.item_name });
        }
        
        res.json({ success: true, item: result.rows[0] });
    } catch (error) {
        console.error('Error using inventory item:', error);
        res.status(500).json({ error: 'Failed to use inventory item' });
    }
});

// ============ STAFF MANAGEMENT (FIXED) ============
app.post('/api/staff/schedule', authenticateToken, async (req, res) => {
    try {
        const { staffId, date, shiftStart, shiftEnd, department, notes } = req.body;
        
        const result = await pool.query(`
            INSERT INTO staff_schedules (staff_id, date, shift_start, shift_end, department, notes)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *`,
            [staffId, date, shiftStart, shiftEnd, department, notes]
        );
        
        broadcast('new_schedule', { staffId, date });
        res.json({ success: true, schedule: result.rows[0] });
    } catch (error) {
        console.error('Error creating schedule:', error);
        res.status(500).json({ error: 'Failed to create schedule' });
    }
});

app.get('/api/staff/schedule', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                s.*,
                u.name as staff_name
            FROM staff_schedules s
            LEFT JOIN users u ON s.staff_id = u.id
            ORDER BY s.date DESC, s.shift_start ASC
            LIMIT 100
        `);
        res.json({ success: true, schedules: result.rows });
    } catch (error) {
        console.error('Error fetching schedules:', error);
        res.status(500).json({ error: 'Failed to fetch schedules' });
    }
});

app.get('/api/staff', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, name, email, role
            FROM users 
            WHERE role IN ('doctor', 'nurse', 'staff', 'admin')
            ORDER BY name
        `);
        res.json({ success: true, staff: result.rows });
    } catch (error) {
        console.error('Error fetching staff:', error);
        res.status(500).json({ error: 'Failed to fetch staff' });
    }
});

// ============ BED MANAGEMENT (FIXED) ============
app.post('/api/beds/admit', authenticateToken, async (req, res) => {
    try {
        const { bedId, patientId, notes } = req.body;
        
        const result = await pool.query(`
            UPDATE beds 
            SET status = 'occupied', 
                patient_uuid = $1::uuid, 
                admission_date = CURRENT_TIMESTAMP, 
                notes = $2
            WHERE id = $3 AND status = 'available'
            RETURNING *`,
            [patientId, notes, bedId]
        );
        
        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Bed not available' });
        }
        
        broadcast('bed_admission', { bedNumber: result.rows[0].bed_number });
        res.json({ success: true, bed: result.rows[0] });
    } catch (error) {
        console.error('Error admitting patient:', error);
        res.status(500).json({ error: 'Failed to admit patient' });
    }
});

app.get('/api/beds/available', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM beds 
            WHERE status = 'available'
            ORDER BY ward, bed_number
        `);
        res.json({ success: true, beds: result.rows });
    } catch (error) {
        console.error('Error fetching available beds:', error);
        res.status(500).json({ error: 'Failed to fetch available beds' });
    }
});

app.get('/api/beds', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                b.*,
                p.first_name || ' ' || p.last_name as patient_name
            FROM beds b
            LEFT JOIN patients p ON b.patient_uuid = p.id OR b.patient_id = uuid_to_int(p.id)
            ORDER BY b.ward, b.bed_number
        `);
        res.json({ success: true, beds: result.rows });
    } catch (error) {
        console.error('Error fetching beds:', error);
        res.status(500).json({ error: 'Failed to fetch beds' });
    }
});

app.post('/api/beds/discharge/:bedId', authenticateToken, async (req, res) => {
    try {
        const { bedId } = req.params;
        
        const result = await pool.query(`
            UPDATE beds 
            SET status = 'available', 
                patient_id = NULL,
                patient_uuid = NULL,
                discharge_date = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING *`,
            [bedId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Bed not found' });
        }
        
        broadcast('bed_discharge', { bedNumber: result.rows[0].bed_number });
        res.json({ success: true, bed: result.rows[0] });
    } catch (error) {
        console.error('Error discharging patient:', error);
        res.status(500).json({ error: 'Failed to discharge patient' });
    }
});

// ============ APPOINTMENTS (FIXED) ============
app.post('/api/appointments', authenticateToken, async (req, res) => {
    try {
        const { patientId, doctorId, appointmentDate, appointmentTime, duration, reason, notes } = req.body;
        
        const result = await pool.query(`
            INSERT INTO appointments 
            (patient_uuid, doctor_id, appointment_date, appointment_time, duration, reason, notes)
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
            RETURNING *`,
            [patientId, doctorId || req.user.id, appointmentDate, appointmentTime, duration || 30, reason, notes]
        );
        
        broadcast('new_appointment', { patientId, date: appointmentDate });
        res.json({ success: true, appointment: result.rows[0] });
    } catch (error) {
        console.error('Error creating appointment:', error);
        res.status(500).json({ error: 'Failed to create appointment' });
    }
});

app.get('/api/appointments', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                a.*,
                p.first_name || ' ' || p.last_name as patient_name,
                u.name as doctor_name
            FROM appointments a
            LEFT JOIN patients p ON a.patient_uuid = p.id OR a.patient_id = uuid_to_int(p.id)
            LEFT JOIN users u ON a.doctor_id = u.id
            ORDER BY a.appointment_date, a.appointment_time
        `);
        res.json({ success: true, appointments: result.rows });
    } catch (error) {
        console.error('Error fetching appointments:', error);
        res.status(500).json({ error: 'Failed to fetch appointments' });
    }
});

// ============ LAB RESULTS (FIXED) ============
app.post('/api/lab-results', authenticateToken, async (req, res) => {
    try {
        const { patientId, testName, results, normalRange, notes } = req.body;
        
        const result = await pool.query(`
            INSERT INTO lab_results 
            (patient_uuid, test_name, results, normal_range, ordered_by, notes, status)
            VALUES ($1::uuid, $2, $3, $4, $5, $6, 'completed')
            RETURNING *`,
            [patientId, testName, results, normalRange, req.user.id, notes]
        );
        
        broadcast('lab_results_ready', { patientId, testName });
        res.json({ success: true, labResult: result.rows[0] });
    } catch (error) {
        console.error('Error creating lab results:', error);
        res.status(500).json({ error: 'Failed to create lab results' });
    }
});

app.get('/api/lab-results', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                lr.*,
                p.first_name || ' ' || p.last_name as patient_name,
                u.name as ordered_by_name
            FROM lab_results lr
            LEFT JOIN patients p ON lr.patient_uuid = p.id OR lr.patient_id = uuid_to_int(p.id)
            LEFT JOIN users u ON lr.ordered_by = u.id
            ORDER BY lr.test_date DESC
        `);
        res.json({ success: true, results: result.rows });
    } catch (error) {
        console.error('Error fetching lab results:', error);
        res.status(500).json({ error: 'Failed to fetch lab results' });
    }
});

// ============ PRESCRIPTIONS (FIXED) ============
app.post('/api/prescriptions', authenticateToken, async (req, res) => {
    try {
        const { patientId, medication, dosage, frequency, duration, startDate, endDate, instructions } = req.body;
        
        const result = await pool.query(`
            INSERT INTO prescriptions 
            (patient_uuid, doctor_id, medication, dosage, frequency, duration, start_date, end_date, instructions)
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *`,
            [patientId, req.user.id, medication, dosage, frequency, duration, startDate, endDate, instructions]
        );
        
        broadcast('new_prescription', { patientId, medication });
        res.json({ success: true, prescription: result.rows[0] });
    } catch (error) {
        console.error('Error creating prescription:', error);
        res.status(500).json({ error: 'Failed to create prescription' });
    }
});

app.get('/api/prescriptions', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                pr.*,
                p.first_name || ' ' || p.last_name as patient_name,
                u.name as doctor_name
            FROM prescriptions pr
            LEFT JOIN patients p ON pr.patient_uuid = p.id OR pr.patient_id = uuid_to_int(p.id)
            LEFT JOIN users u ON pr.doctor_id = u.id
            ORDER BY pr.created_at DESC
        `);
        res.json({ success: true, prescriptions: result.rows });
    } catch (error) {
        console.error('Error fetching prescriptions:', error);
        res.status(500).json({ error: 'Failed to fetch prescriptions' });
    }
});

// ============ ANALYTICS ============
app.get('/api/analytics/dashboard', authenticateToken, async (req, res) => {
    try {
        const metrics = {};
        
        // Safe metric fetching with error handling
        const queries = [
            { key: 'totalPatients', query: 'SELECT COUNT(*) FROM patients' },
            { key: 'totalStaff', query: 'SELECT COUNT(*) FROM users' },
            { key: 'occupiedBeds', query: "SELECT COUNT(*) FROM beds WHERE status = 'occupied'" },
            { key: 'totalBeds', query: 'SELECT COUNT(*) FROM beds' },
            { key: 'pendingInvoices', query: "SELECT COUNT(*) FROM invoices WHERE status = 'pending'" },
            { key: 'totalRevenue', query: "SELECT COALESCE(SUM(total), 0) as sum FROM invoices WHERE status = 'paid'" },
            { key: 'lowStockItems', query: 'SELECT COUNT(*) FROM inventory WHERE quantity <= reorder_level' },
            { key: 'todayAppointments', query: 'SELECT COUNT(*) FROM appointments WHERE appointment_date = CURRENT_DATE' }
        ];
        
        for (const q of queries) {
            try {
                const result = await pool.query(q.query);
                if (q.key === 'totalRevenue') {
                    metrics[q.key] = parseFloat(result.rows[0].sum || 0);
                } else {
                    metrics[q.key] = parseInt(result.rows[0].count || 0);
                }
            } catch (e) {
                metrics[q.key] = 0;
            }
        }
        
        metrics.occupancyRate = metrics.totalBeds > 0 
            ? parseFloat((metrics.occupiedBeds / metrics.totalBeds * 100).toFixed(1))
            : 0;
        
        res.json({ success: true, metrics });
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});

app.get('/api/analytics/export', authenticateToken, async (req, res) => {
    try {
        const { reportType } = req.query;
        const doc = new PDFDocument();
        const filename = `report-${reportType}-${Date.now()}.pdf`;
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        doc.pipe(res);
        doc.fontSize(20).text('Hospital Management System Report', 50, 50);
        doc.fontSize(14).text(`Report Type: ${reportType || 'General'}`, 50, 80);
        doc.fontSize(12).text(`Generated: ${new Date().toLocaleString()}`, 50, 100);
        
        if (reportType === 'inventory') {
            const inventory = await pool.query('SELECT * FROM inventory ORDER BY item_name');
            doc.fontSize(16).text('Inventory Report', 50, 140);
            let y = 170;
            inventory.rows.forEach(item => {
                doc.fontSize(10).text(`${item.item_name}: ${item.quantity} ${item.unit}`, 50, y);
                y += 20;
                if (y > 700) {
                    doc.addPage();
                    y = 50;
                }
            });
        }
        
        doc.end();
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

// ============ HEALTH CHECK ============
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date(),
        uptime: process.uptime(),
        wsClients: wsClients.size
    });
});

app.get('/api/status', authenticateToken, async (req, res) => {
    try {
        const dbCheck = await pool.query('SELECT NOW()');
        res.json({
            status: 'operational',
            database: 'connected',
            timestamp: dbCheck.rows[0].now,
            wsClients: wsClients.size
        });
    } catch (error) {
        res.status(500).json({ status: 'error', database: 'disconnected' });
    }
});

// Initialize and start server
const PORT = process.env.PORT || 5700;

async function initializeDatabase() {
    try {
        console.log('Checking database connection...');
        await pool.query('SELECT NOW()');
        console.log('Database connected successfully');
        
        // Ensure admin user exists
        const adminCheck = await pool.query('SELECT * FROM users WHERE email = $1', ['admin@hospital.com']);
        if (adminCheck.rows.length === 0) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await pool.query(
                'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)',
                ['admin@hospital.com', hashedPassword, 'System Admin', 'admin']
            );
            console.log('Admin user created');
        }
    } catch (error) {
        console.error('Database initialization error:', error);
    }
}

server.listen(PORT, async () => {
    await initializeDatabase();
    console.log(`\n========================================`);
    console.log(`Hospital Management System - FIXED`);
    console.log(`========================================`);
    console.log(`Server running on port ${PORT}`);
    console.log(`All features now working with UUID compatibility`);
    console.log(`\nLogin: admin@hospital.com / admin123`);
    console.log(`========================================\n`);
});

process.on('SIGTERM', () => {
    server.close(() => {
        pool.end();
        process.exit(0);
    });
});

module.exports = app;
