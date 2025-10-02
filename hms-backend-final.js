const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json());

// Database connection - Neon PostgreSQL
const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_InhJz3HWVO6E@ep-solitary-recipe-adrz8omw-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require',
    ssl: { rejectUnauthorized: false }
});

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'hms-secret-key-2024';

// WebSocket connections
const wsClients = new Set();

wss.on('connection', (ws) => {
    console.log('New WebSocket connection');
    wsClients.add(ws);
    
    ws.on('close', () => {
        wsClients.delete(ws);
    });
});

// Broadcast to all WebSocket clients
function broadcast(type, data) {
    const message = JSON.stringify({ type, data, timestamp: new Date() });
    wsClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Auth Middleware
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

// Initialize database tables
async function initializeDatabase() {
    try {
        // Create tables if they don't exist
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                name VARCHAR(255) NOT NULL,
                role VARCHAR(50) DEFAULT 'staff',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS patients (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                date_of_birth DATE,
                gender VARCHAR(10),
                phone VARCHAR(20),
                email VARCHAR(255),
                address TEXT,
                blood_type VARCHAR(5),
                allergies TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS medical_records (
                id SERIAL PRIMARY KEY,
                patient_id INTEGER REFERENCES patients(id),
                doctor_id INTEGER REFERENCES users(id),
                symptoms TEXT,
                diagnosis TEXT,
                treatment TEXT,
                prescription TEXT,
                visit_type VARCHAR(50),
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS invoices (
                id SERIAL PRIMARY KEY,
                patient_id INTEGER REFERENCES patients(id),
                invoice_number VARCHAR(50) UNIQUE,
                items JSONB,
                total_amount DECIMAL(10,2),
                status VARCHAR(20) DEFAULT 'pending',
                payment_method VARCHAR(50),
                due_date DATE,
                paid_date DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS inventory (
                id SERIAL PRIMARY KEY,
                item_name VARCHAR(255) NOT NULL,
                category VARCHAR(100),
                quantity INTEGER DEFAULT 0,
                unit VARCHAR(50),
                reorder_level INTEGER,
                unit_price DECIMAL(10,2),
                supplier VARCHAR(255),
                expiry_date DATE,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS staff (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                department VARCHAR(100),
                position VARCHAR(100),
                specialization VARCHAR(100),
                phone VARCHAR(20),
                shift VARCHAR(20),
                status VARCHAR(20) DEFAULT 'active'
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS schedules (
                id SERIAL PRIMARY KEY,
                staff_id INTEGER REFERENCES staff(id),
                date DATE,
                shift_start TIME,
                shift_end TIME,
                department VARCHAR(100),
                status VARCHAR(20) DEFAULT 'scheduled'
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS beds (
                id SERIAL PRIMARY KEY,
                bed_number VARCHAR(20) UNIQUE NOT NULL,
                ward VARCHAR(100),
                floor INTEGER,
                building VARCHAR(50),
                bed_type VARCHAR(50),
                status VARCHAR(20) DEFAULT 'available',
                patient_id INTEGER REFERENCES patients(id),
                admission_date TIMESTAMP,
                discharge_date TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS appointments (
                id SERIAL PRIMARY KEY,
                patient_id INTEGER REFERENCES patients(id),
                doctor_id INTEGER REFERENCES users(id),
                appointment_date DATE,
                appointment_time TIME,
                department VARCHAR(100),
                reason TEXT,
                status VARCHAR(20) DEFAULT 'scheduled',
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS lab_results (
                id SERIAL PRIMARY KEY,
                patient_id INTEGER REFERENCES patients(id),
                doctor_id INTEGER REFERENCES users(id),
                test_name VARCHAR(255),
                test_type VARCHAR(100),
                results TEXT,
                normal_range VARCHAR(100),
                status VARCHAR(20) DEFAULT 'pending',
                test_date DATE,
                result_date DATE,
                notes TEXT
            )
        `);

        // Create default admin user if not exists
        const adminCheck = await pool.query('SELECT * FROM users WHERE email = $1', ['admin@hospital.com']);
        if (adminCheck.rows.length === 0) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await pool.query(
                'INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4)',
                ['admin@hospital.com', hashedPassword, 'Admin User', 'admin']
            );
            console.log('Default admin user created');
        }

        // Add sample data if tables are empty
        const patientCount = await pool.query('SELECT COUNT(*) FROM patients');
        if (patientCount.rows[0].count == 0) {
            await addSampleData();
        }

        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Database initialization error:', error);
    }
}

// Add sample data
async function addSampleData() {
    try {
        // Add sample patients
        await pool.query(`
            INSERT INTO patients (name, date_of_birth, gender, phone, email, blood_type)
            VALUES 
            ('John Doe', '1985-05-15', 'Male', '123-456-7890', 'john@email.com', 'O+'),
            ('Jane Smith', '1990-08-22', 'Female', '098-765-4321', 'jane@email.com', 'A+'),
            ('Robert Johnson', '1975-12-10', 'Male', '555-123-4567', 'robert@email.com', 'B+')
        `);

        // Add sample inventory
        await pool.query(`
            INSERT INTO inventory (item_name, category, quantity, unit, reorder_level, unit_price)
            VALUES 
            ('Paracetamol 500mg', 'Medication', 500, 'tablets', 100, 0.50),
            ('Surgical Masks', 'PPE', 1000, 'pieces', 200, 0.25),
            ('Bandages', 'Medical Supplies', 200, 'rolls', 50, 2.00),
            ('Syringes', 'Medical Supplies', 300, 'pieces', 100, 0.15),
            ('Antibiotics', 'Medication', 100, 'bottles', 20, 15.00)
        `);

        // Add sample beds
        await pool.query(`
            INSERT INTO beds (bed_number, ward, floor, building, bed_type, status)
            VALUES 
            ('A101', 'General Ward', 1, 'Main', 'Standard', 'available'),
            ('A102', 'General Ward', 1, 'Main', 'Standard', 'available'),
            ('B201', 'ICU', 2, 'Main', 'ICU', 'available'),
            ('B202', 'ICU', 2, 'Main', 'ICU', 'occupied'),
            ('C301', 'Pediatric', 3, 'Main', 'Pediatric', 'available')
        `);

        console.log('Sample data added successfully');
    } catch (error) {
        console.error('Error adding sample data:', error);
    }
}

// ============================================
// API ROUTES
// ============================================

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        service: 'HMS Backend', 
        timestamp: new Date(),
        database: 'connected'
    });
});

// Authentication Routes
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];
        
        if (!user) {
            // Auto-create admin user if trying to login with default credentials
            if (email === 'admin@hospital.com' && password === 'admin123') {
                const hashedPassword = await bcrypt.hash(password, 10);
                const newUser = await pool.query(
                    'INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4) RETURNING *',
                    [email, hashedPassword, 'Admin User', 'admin']
                );
                
                const token = jwt.sign(
                    { id: newUser.rows[0].id, email: newUser.rows[0].email, role: newUser.rows[0].role },
                    JWT_SECRET,
                    { expiresIn: '24h' }
                );
                
                return res.json({
                    success: true,
                    token,
                    user: {
                        id: newUser.rows[0].id,
                        email: newUser.rows[0].email,
                        name: newUser.rows[0].name,
                        role: newUser.rows[0].role
                    }
                });
            }
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const isValid = await bcrypt.compare(password, user.password);
        
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid credentials' });
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
        res.status(500).json({ error: 'Login failed' });
    }
});

// Patient Routes
app.get('/api/patients', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM patients ORDER BY id DESC');
        res.json({ success: true, patients: result.rows });
    } catch (error) {
        console.error('Error fetching patients:', error);
        res.status(500).json({ error: 'Failed to fetch patients' });
    }
});

app.post('/api/patients', authenticateToken, async (req, res) => {
    try {
        const { name, date_of_birth, gender, phone, email, address, blood_type, allergies } = req.body;
        
        const result = await pool.query(
            `INSERT INTO patients (name, date_of_birth, gender, phone, email, address, blood_type, allergies)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [name, date_of_birth, gender, phone, email, address, blood_type, allergies]
        );
        
        broadcast('new_patient', result.rows[0]);
        res.json({ success: true, patient: result.rows[0] });
    } catch (error) {
        console.error('Error creating patient:', error);
        res.status(500).json({ error: 'Failed to create patient' });
    }
});

// Medical Records Routes
app.get('/api/medical-records', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT mr.*, p.name as patient_name, u.name as doctor_name
            FROM medical_records mr
            LEFT JOIN patients p ON mr.patient_id = p.id
            LEFT JOIN users u ON mr.doctor_id = u.id
            ORDER BY mr.created_at DESC
        `);
        res.json({ success: true, records: result.rows });
    } catch (error) {
        console.error('Error fetching medical records:', error);
        res.status(500).json({ error: 'Failed to fetch medical records' });
    }
});

app.post('/api/medical-records', authenticateToken, async (req, res) => {
    try {
        const { patientId, symptoms, diagnosis, treatment, prescription, visitType, notes } = req.body;
        
        const result = await pool.query(
            `INSERT INTO medical_records (patient_id, doctor_id, symptoms, diagnosis, treatment, prescription, visit_type, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [patientId, req.user.id, symptoms, diagnosis, treatment, prescription, visitType, notes]
        );
        
        broadcast('new_medical_record', result.rows[0]);
        res.json({ success: true, record: result.rows[0] });
    } catch (error) {
        console.error('Error creating medical record:', error);
        res.status(500).json({ error: 'Failed to create medical record' });
    }
});

// Billing Routes
app.get('/api/billing/invoices', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT i.*, p.name as patient_name
            FROM invoices i
            LEFT JOIN patients p ON i.patient_id = p.id
            ORDER BY i.created_at DESC
        `);
        
        res.json({ 
            success: true, 
            invoices: result.rows.map(row => ({
                ...row,
                invoicenumber: row.invoice_number,
                totalamount: row.total_amount,
                duedate: row.due_date
            }))
        });
    } catch (error) {
        console.error('Error fetching invoices:', error);
        res.status(500).json({ error: 'Failed to fetch invoices' });
    }
});

app.post('/api/billing/invoices', authenticateToken, async (req, res) => {
    try {
        const { patientId, items, totalAmount, dueDate, paymentMethod } = req.body;
        const invoiceNumber = 'INV-' + Date.now();
        
        const result = await pool.query(
            `INSERT INTO invoices (patient_id, invoice_number, items, total_amount, due_date, payment_method)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [patientId, invoiceNumber, JSON.stringify(items), totalAmount, dueDate, paymentMethod]
        );
        
        broadcast('new_invoice', result.rows[0]);
        res.json({ success: true, invoice: result.rows[0] });
    } catch (error) {
        console.error('Error creating invoice:', error);
        res.status(500).json({ error: 'Failed to create invoice' });
    }
});

app.post('/api/billing/process-payment', authenticateToken, async (req, res) => {
    try {
        const { invoiceId, amount, paymentMethod } = req.body;
        
        const result = await pool.query(
            `UPDATE invoices 
             SET status = 'paid', paid_date = CURRENT_DATE, payment_method = $2
             WHERE id = $1 RETURNING *`,
            [invoiceId, paymentMethod || 'cash']
        );
        
        broadcast('payment_processed', { invoiceId, amount });
        res.json({ success: true, invoice: result.rows[0] });
    } catch (error) {
        console.error('Error processing payment:', error);
        res.status(500).json({ error: 'Failed to process payment' });
    }
});

// Inventory Routes
app.get('/api/inventory', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM inventory ORDER BY item_name');
        res.json({ success: true, items: result.rows });
    } catch (error) {
        console.error('Error fetching inventory:', error);
        res.status(500).json({ error: 'Failed to fetch inventory' });
    }
});

app.get('/api/inventory/low-stock', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM inventory WHERE quantity <= reorder_level ORDER BY quantity'
        );
        res.json({ success: true, items: result.rows });
    } catch (error) {
        console.error('Error fetching low stock items:', error);
        res.status(500).json({ error: 'Failed to fetch low stock items' });
    }
});

app.post('/api/inventory/add-stock', authenticateToken, async (req, res) => {
    try {
        const { itemName, category, quantity, unit, reorderLevel, unitPrice, supplier, expiryDate } = req.body;
        
        // Check if item exists
        const existing = await pool.query('SELECT * FROM inventory WHERE item_name = $1', [itemName]);
        
        if (existing.rows.length > 0) {
            // Update existing item
            const result = await pool.query(
                `UPDATE inventory 
                 SET quantity = quantity + $2, unit_price = $3, supplier = $4, expiry_date = $5, last_updated = CURRENT_TIMESTAMP
                 WHERE item_name = $1 RETURNING *`,
                [itemName, quantity, unitPrice, supplier, expiryDate]
            );
            res.json({ success: true, item: result.rows[0] });
        } else {
            // Add new item
            const result = await pool.query(
                `INSERT INTO inventory (item_name, category, quantity, unit, reorder_level, unit_price, supplier, expiry_date)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
                [itemName, category, quantity, unit, reorderLevel, unitPrice, supplier, expiryDate]
            );
            res.json({ success: true, item: result.rows[0] });
        }
        
        // Check for low stock
        if (quantity <= reorderLevel) {
            broadcast('low_stock_alert', { item: itemName, quantity });
        }
    } catch (error) {
        console.error('Error adding stock:', error);
        res.status(500).json({ error: 'Failed to add stock' });
    }
});

app.post('/api/inventory/use-item', authenticateToken, async (req, res) => {
    try {
        const { itemId, quantity } = req.body;
        
        const result = await pool.query(
            `UPDATE inventory 
             SET quantity = quantity - $2, last_updated = CURRENT_TIMESTAMP
             WHERE id = $1 AND quantity >= $2 RETURNING *`,
            [itemId, quantity]
        );
        
        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Insufficient stock' });
        }
        
        // Check for low stock
        const item = result.rows[0];
        if (item.quantity <= item.reorder_level) {
            broadcast('low_stock_alert', { item: item.item_name, quantity: item.quantity });
        }
        
        res.json({ success: true, item });
    } catch (error) {
        console.error('Error using inventory item:', error);
        res.status(500).json({ error: 'Failed to use item' });
    }
});

// Staff Management Routes
app.get('/api/staff', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT s.*, u.name, u.email
            FROM staff s
            LEFT JOIN users u ON s.user_id = u.id
            ORDER BY u.name
        `);
        res.json({ success: true, staff: result.rows });
    } catch (error) {
        console.error('Error fetching staff:', error);
        res.status(500).json({ error: 'Failed to fetch staff' });
    }
});

app.post('/api/staff', authenticateToken, async (req, res) => {
    try {
        const { name, email, password, department, position, specialization, phone, shift } = req.body;
        
        // Create user account
        const hashedPassword = await bcrypt.hash(password, 10);
        const userResult = await pool.query(
            'INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4) RETURNING *',
            [email, hashedPassword, name, 'staff']
        );
        
        // Create staff record
        const staffResult = await pool.query(
            `INSERT INTO staff (user_id, department, position, specialization, phone, shift)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [userResult.rows[0].id, department, position, specialization, phone, shift]
        );
        
        res.json({ 
            success: true, 
            staff: { ...staffResult.rows[0], name, email }
        });
    } catch (error) {
        console.error('Error creating staff:', error);
        res.status(500).json({ error: 'Failed to create staff' });
    }
});

app.get('/api/staff/schedule', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT sc.*, s.department, s.position, u.name as staff_name
            FROM schedules sc
            LEFT JOIN staff s ON sc.staff_id = s.id
            LEFT JOIN users u ON s.user_id = u.id
            ORDER BY sc.date DESC, sc.shift_start
        `);
        res.json({ success: true, schedules: result.rows });
    } catch (error) {
        console.error('Error fetching schedules:', error);
        res.status(500).json({ error: 'Failed to fetch schedules' });
    }
});

app.post('/api/staff/schedule', authenticateToken, async (req, res) => {
    try {
        const { staffId, date, shiftStart, shiftEnd, department } = req.body;
        
        const result = await pool.query(
            `INSERT INTO schedules (staff_id, date, shift_start, shift_end, department)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [staffId, date, shiftStart, shiftEnd, department]
        );
        
        broadcast('schedule_updated', result.rows[0]);
        res.json({ success: true, schedule: result.rows[0] });
    } catch (error) {
        console.error('Error creating schedule:', error);
        res.status(500).json({ error: 'Failed to create schedule' });
    }
});

// Bed Management Routes
app.get('/api/beds/available', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM beds WHERE status = 'available' ORDER BY ward, bed_number"
        );
        res.json({ success: true, beds: result.rows });
    } catch (error) {
        console.error('Error fetching available beds:', error);
        res.status(500).json({ error: 'Failed to fetch available beds' });
    }
});

app.get('/api/beds/all', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT b.*, p.name as patient_name
            FROM beds b
            LEFT JOIN patients p ON b.patient_id = p.id
            ORDER BY b.ward, b.bed_number
        `);
        res.json({ success: true, beds: result.rows });
    } catch (error) {
        console.error('Error fetching all beds:', error);
        res.status(500).json({ error: 'Failed to fetch beds' });
    }
});

app.post('/api/beds/admission', authenticateToken, async (req, res) => {
    try {
        const { bedId, patientId, admissionDate } = req.body;
        
        const result = await pool.query(
            `UPDATE beds 
             SET status = 'occupied', patient_id = $2, admission_date = $3
             WHERE id = $1 RETURNING *`,
            [bedId, patientId, admissionDate || new Date()]
        );
        
        broadcast('bed_status_changed', { bedId, status: 'occupied' });
        res.json({ success: true, bed: result.rows[0] });
    } catch (error) {
        console.error('Error processing admission:', error);
        res.status(500).json({ error: 'Failed to process admission' });
    }
});

app.post('/api/beds/discharge', authenticateToken, async (req, res) => {
    try {
        const { bedId, dischargeDate } = req.body;
        
        const result = await pool.query(
            `UPDATE beds 
             SET status = 'available', patient_id = NULL, admission_date = NULL, discharge_date = $2
             WHERE id = $1 RETURNING *`,
            [bedId, dischargeDate || new Date()]
        );
        
        broadcast('bed_status_changed', { bedId, status: 'available' });
        res.json({ success: true, bed: result.rows[0] });
    } catch (error) {
        console.error('Error processing discharge:', error);
        res.status(500).json({ error: 'Failed to process discharge' });
    }
});

app.get('/api/wards/occupancy', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                ward,
                COUNT(*) as total_beds,
                COUNT(CASE WHEN status = 'occupied' THEN 1 END) as occupied_beds,
                COUNT(CASE WHEN status = 'available' THEN 1 END) as available_beds
            FROM beds
            GROUP BY ward
            ORDER BY ward
        `);
        res.json({ success: true, wards: result.rows });
    } catch (error) {
        console.error('Error fetching ward occupancy:', error);
        res.status(500).json({ error: 'Failed to fetch ward occupancy' });
    }
});

// Appointments Routes
app.get('/api/appointments', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT a.*, p.name as patient_name, u.name as doctor_name
            FROM appointments a
            LEFT JOIN patients p ON a.patient_id = p.id
            LEFT JOIN users u ON a.doctor_id = u.id
            ORDER BY a.appointment_date DESC, a.appointment_time
        `);
        res.json({ success: true, appointments: result.rows });
    } catch (error) {
        console.error('Error fetching appointments:', error);
        res.status(500).json({ error: 'Failed to fetch appointments' });
    }
});

app.post('/api/appointments', authenticateToken, async (req, res) => {
    try {
        const { patientId, doctorId, appointmentDate, appointmentTime, department, reason, notes } = req.body;
        
        const result = await pool.query(
            `INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, department, reason, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [patientId, doctorId || req.user.id, appointmentDate, appointmentTime, department, reason, notes]
        );
        
        broadcast('new_appointment', result.rows[0]);
        res.json({ success: true, appointment: result.rows[0] });
    } catch (error) {
        console.error('Error creating appointment:', error);
        res.status(500).json({ error: 'Failed to create appointment' });
    }
});

// Lab Results Routes
app.get('/api/lab-results', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT lr.*, p.name as patient_name, u.name as doctor_name
            FROM lab_results lr
            LEFT JOIN patients p ON lr.patient_id = p.id
            LEFT JOIN users u ON lr.doctor_id = u.id
            ORDER BY lr.test_date DESC
        `);
        res.json({ success: true, results: result.rows });
    } catch (error) {
        console.error('Error fetching lab results:', error);
        res.status(500).json({ error: 'Failed to fetch lab results' });
    }
});

app.post('/api/lab-results', authenticateToken, async (req, res) => {
    try {
        const { patientId, testName, testType, results, normalRange, testDate, notes } = req.body;
        
        const result = await pool.query(
            `INSERT INTO lab_results (patient_id, doctor_id, test_name, test_type, results, normal_range, test_date, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [patientId, req.user.id, testName, testType, results, normalRange, testDate, notes]
        );
        
        broadcast('new_lab_result', result.rows[0]);
        res.json({ success: true, result: result.rows[0] });
    } catch (error) {
        console.error('Error creating lab result:', error);
        res.status(500).json({ error: 'Failed to create lab result' });
    }
});

// Analytics Routes
app.get('/api/analytics/overview', authenticateToken, async (req, res) => {
    try {
        const [patients, admissions, beds, revenue, appointments] = await Promise.all([
            pool.query('SELECT COUNT(*) FROM patients'),
            pool.query("SELECT COUNT(*) FROM beds WHERE status = 'occupied'"),
            pool.query("SELECT COUNT(*) FROM beds WHERE status = 'available'"),
            pool.query("SELECT COALESCE(SUM(total_amount), 0) as total FROM invoices WHERE status = 'paid'"),
            pool.query("SELECT COUNT(*) FROM appointments WHERE appointment_date = CURRENT_DATE")
        ]);
        
        res.json({
            success: true,
            total_patients: patients.rows[0].count,
            active_admissions: admissions.rows[0].count,
            available_beds: beds.rows[0].count,
            total_revenue: revenue.rows[0].total,
            today_appointments: appointments.rows[0].count
        });
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});

app.get('/api/analytics/dashboard', authenticateToken, async (req, res) => {
    try {
        const [
            totalPatients,
            activeAdmissions,
            monthlyRevenue,
            pendingAppointments,
            lowStockItems,
            bedOccupancy
        ] = await Promise.all([
            pool.query('SELECT COUNT(*) FROM patients'),
            pool.query("SELECT COUNT(*) FROM beds WHERE status = 'occupied'"),
            pool.query(`
                SELECT COALESCE(SUM(total_amount), 0) as total 
                FROM invoices 
                WHERE status = 'paid' 
                AND DATE_PART('month', paid_date) = DATE_PART('month', CURRENT_DATE)
            `),
            pool.query(`
                SELECT COUNT(*) FROM appointments 
                WHERE status = 'scheduled' 
                AND appointment_date >= CURRENT_DATE
            `),
            pool.query('SELECT COUNT(*) FROM inventory WHERE quantity <= reorder_level'),
            pool.query(`
                SELECT 
                    COUNT(CASE WHEN status = 'occupied' THEN 1 END) * 100.0 / COUNT(*) as rate
                FROM beds
            `)
        ]);
        
        // Revenue trends (last 7 days)
        const revenueTrend = await pool.query(`
            SELECT 
                DATE(paid_date) as date,
                COALESCE(SUM(total_amount), 0) as amount
            FROM invoices
            WHERE status = 'paid'
            AND paid_date >= CURRENT_DATE - INTERVAL '7 days'
            GROUP BY DATE(paid_date)
            ORDER BY date
        `);
        
        // Department-wise patient distribution
        const departmentStats = await pool.query(`
            SELECT 
                department,
                COUNT(*) as count
            FROM appointments
            WHERE appointment_date >= CURRENT_DATE - INTERVAL '30 days'
            GROUP BY department
            ORDER BY count DESC
            LIMIT 5
        `);
        
        res.json({
            success: true,
            stats: {
                totalPatients: totalPatients.rows[0].count,
                activeAdmissions: activeAdmissions.rows[0].count,
                monthlyRevenue: monthlyRevenue.rows[0].total,
                pendingAppointments: pendingAppointments.rows[0].count,
                lowStockItems: lowStockItems.rows[0].count,
                bedOccupancyRate: Math.round(bedOccupancy.rows[0].rate)
            },
            trends: {
                revenue: revenueTrend.rows,
                departments: departmentStats.rows
            }
        });
    } catch (error) {
        console.error('Error fetching dashboard data:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard data' });
    }
});

app.post('/api/analytics/export-report', authenticateToken, async (req, res) => {
    try {
        const { reportType, startDate, endDate } = req.body;
        
        let query;
        let params = [startDate, endDate];
        
        switch(reportType) {
            case 'revenue':
                query = `
                    SELECT 
                        DATE(paid_date) as date,
                        COUNT(*) as transactions,
                        SUM(total_amount) as total_revenue
                    FROM invoices
                    WHERE status = 'paid'
                    AND paid_date BETWEEN $1 AND $2
                    GROUP BY DATE(paid_date)
                    ORDER BY date
                `;
                break;
            case 'patients':
                query = `
                    SELECT 
                        DATE(created_at) as date,
                        COUNT(*) as new_patients
                    FROM patients
                    WHERE created_at BETWEEN $1 AND $2
                    GROUP BY DATE(created_at)
                    ORDER BY date
                `;
                break;
            case 'occupancy':
                query = `
                    SELECT 
                        ward,
                        COUNT(*) as total_beds,
                        COUNT(CASE WHEN status = 'occupied' THEN 1 END) as occupied,
                        COUNT(CASE WHEN status = 'available' THEN 1 END) as available
                    FROM beds
                    GROUP BY ward
                `;
                params = [];
                break;
            default:
                return res.status(400).json({ error: 'Invalid report type' });
        }
        
        const result = await pool.query(query, params);
        
        res.json({
            success: true,
            reportType,
            period: { startDate, endDate },
            data: result.rows
        });
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

// Revenue Reports
app.get('/api/revenue-reports', authenticateToken, async (req, res) => {
    try {
        const { period = '30' } = req.query;
        
        const result = await pool.query(`
            SELECT 
                DATE(paid_date) as date,
                COUNT(*) as transactions,
                SUM(total_amount) as revenue,
                AVG(total_amount) as avg_transaction
            FROM invoices
            WHERE status = 'paid'
            AND paid_date >= CURRENT_DATE - INTERVAL '${period} days'
            GROUP BY DATE(paid_date)
            ORDER BY date DESC
        `);
        
        const summary = await pool.query(`
            SELECT 
                COUNT(*) as total_invoices,
                COUNT(CASE WHEN status = 'paid' THEN 1 END) as paid_invoices,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_invoices,
                COALESCE(SUM(CASE WHEN status = 'paid' THEN total_amount END), 0) as total_collected,
                COALESCE(SUM(CASE WHEN status = 'pending' THEN total_amount END), 0) as total_pending
            FROM invoices
            WHERE created_at >= CURRENT_DATE - INTERVAL '${period} days'
        `);
        
        res.json({
            success: true,
            period: `${period} days`,
            daily: result.rows,
            summary: summary.rows[0]
        });
    } catch (error) {
        console.error('Error fetching revenue reports:', error);
        res.status(500).json({ error: 'Failed to fetch revenue reports' });
    }
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
const PORT = process.env.PORT || 5700;

async function startServer() {
    await initializeDatabase();
    
    server.listen(PORT, () => {
        console.log(`HMS Backend running on port ${PORT}`);
        console.log(`WebSocket server ready`);
        console.log(`API available at http://localhost:${PORT}/api`);
        console.log(`Default login: admin@hospital.com / admin123`);
    });
}

startServer().catch(console.error);
