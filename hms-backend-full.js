const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');

// Database configuration
const DATABASE_URL = 'postgresql://neondb_owner:npg_lIeD35dukpfC@ep-steep-river-ad25brti-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require';

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'hms-secret-key-2024';

// Initialize database tables
async function initializeDatabase() {
    try {
        // Create schema
        await pool.query(`CREATE SCHEMA IF NOT EXISTS hms`);
        
        // Users table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(50) NOT NULL,
                department VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Patients table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.patients (
                id SERIAL PRIMARY KEY,
                patient_id VARCHAR(50) UNIQUE NOT NULL,
                first_name VARCHAR(100) NOT NULL,
                last_name VARCHAR(100) NOT NULL,
                date_of_birth DATE NOT NULL,
                gender VARCHAR(20),
                phone VARCHAR(20),
                email VARCHAR(255),
                address TEXT,
                blood_group VARCHAR(10),
                emergency_contact VARCHAR(255),
                insurance_info JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Medical Records table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.medical_records (
                id SERIAL PRIMARY KEY,
                patient_id INTEGER REFERENCES hms.patients(id),
                doctor_id INTEGER REFERENCES hms.users(id),
                visit_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                chief_complaint TEXT,
                diagnosis TEXT,
                treatment_plan TEXT,
                prescriptions JSONB,
                lab_results JSONB,
                vitals JSONB,
                notes TEXT,
                attachments TEXT[],
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Appointments table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.appointments (
                id SERIAL PRIMARY KEY,
                patient_id INTEGER REFERENCES hms.patients(id),
                doctor_id INTEGER REFERENCES hms.users(id),
                appointment_date TIMESTAMP NOT NULL,
                status VARCHAR(50) DEFAULT 'scheduled',
                reason TEXT,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Invoices table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.invoices (
                id SERIAL PRIMARY KEY,
                invoice_number VARCHAR(50) UNIQUE NOT NULL,
                patient_id INTEGER REFERENCES hms.patients(id),
                items JSONB NOT NULL,
                total_amount DECIMAL(10,2) NOT NULL,
                paid_amount DECIMAL(10,2) DEFAULT 0,
                status VARCHAR(50) DEFAULT 'pending',
                payment_method VARCHAR(50),
                insurance_claim JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                due_date DATE,
                paid_date TIMESTAMP
            )
        `);

        // Inventory table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.inventory (
                id SERIAL PRIMARY KEY,
                item_code VARCHAR(100) UNIQUE NOT NULL,
                item_name VARCHAR(255) NOT NULL,
                category VARCHAR(100),
                unit VARCHAR(50),
                quantity INTEGER NOT NULL DEFAULT 0,
                reorder_level INTEGER DEFAULT 10,
                unit_price DECIMAL(10,2),
                expiry_date DATE,
                batch_number VARCHAR(100),
                supplier VARCHAR(255),
                location VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Staff Schedule table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.staff_schedules (
                id SERIAL PRIMARY KEY,
                staff_id INTEGER REFERENCES hms.users(id),
                date DATE NOT NULL,
                shift VARCHAR(50) NOT NULL,
                start_time TIME NOT NULL,
                end_time TIME NOT NULL,
                department VARCHAR(100),
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Beds table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.beds (
                id SERIAL PRIMARY KEY,
                bed_number VARCHAR(50) UNIQUE NOT NULL,
                ward VARCHAR(100) NOT NULL,
                floor INTEGER,
                status VARCHAR(50) DEFAULT 'available',
                patient_id INTEGER REFERENCES hms.patients(id),
                admission_date TIMESTAMP,
                expected_discharge TIMESTAMP,
                notes TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Lab Results table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.lab_results (
                id SERIAL PRIMARY KEY,
                patient_id INTEGER REFERENCES hms.patients(id),
                test_name VARCHAR(255) NOT NULL,
                test_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                result_value TEXT,
                normal_range VARCHAR(100),
                status VARCHAR(50),
                notes TEXT,
                technician_id INTEGER REFERENCES hms.users(id),
                doctor_id INTEGER REFERENCES hms.users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Prescriptions table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.prescriptions (
                id SERIAL PRIMARY KEY,
                patient_id INTEGER REFERENCES hms.patients(id),
                doctor_id INTEGER REFERENCES hms.users(id),
                medication_name VARCHAR(255) NOT NULL,
                dosage VARCHAR(100),
                frequency VARCHAR(100),
                duration VARCHAR(100),
                instructions TEXT,
                status VARCHAR(50) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('Database tables initialized successfully');
    } catch (error) {
        console.error('Database initialization error:', error);
    }
}

// Initialize database on startup
initializeDatabase();

// ===================== AUTHENTICATION ENDPOINTS =====================

// Register user
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password, role, department } = req.body;
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const result = await pool.query(
            'INSERT INTO hms.users (username, email, password, role, department) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, email, role',
            [username, email, hashedPassword, role, department]
        );
        
        const token = jwt.sign({ id: result.rows[0].id, role: result.rows[0].role }, JWT_SECRET);
        
        res.json({
            success: true,
            token,
            user: result.rows[0]
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const result = await pool.query('SELECT * FROM hms.users WHERE email = $1', [email]);
        
        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }
        
        const user = result.rows[0];
        const isValid = await bcrypt.compare(password, user.password);
        
        if (!isValid) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }
        
        const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET);
        
        res.json({
            success: true,
            token,
            user: { id: user.id, username: user.username, email: user.email, role: user.role }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================== PATIENT MANAGEMENT ENDPOINTS =====================

// Create new patient
app.post('/api/patients', async (req, res) => {
    try {
        const {
            first_name, last_name, date_of_birth, gender,
            phone, email, address, blood_group,
            emergency_contact, insurance_info
        } = req.body;
        
        const patient_id = 'PAT-' + uuidv4().substring(0, 8).toUpperCase();
        
        const result = await pool.query(
            `INSERT INTO hms.patients 
            (patient_id, first_name, last_name, date_of_birth, gender, phone, email, address, blood_group, emergency_contact, insurance_info)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *`,
            [patient_id, first_name, last_name, date_of_birth, gender, phone, email, address, blood_group, emergency_contact, insurance_info]
        );
        
        res.json({ success: true, patient: result.rows[0] });
    } catch (error) {
        console.error('Create patient error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

// Get all patients
app.get('/api/patients', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM hms.patients ORDER BY created_at DESC');
        res.json({ success: true, patients: result.rows });
    } catch (error) {
        console.error('Get patients error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get patient by ID
app.get('/api/patients/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM hms.patients WHERE id = $1', [req.params.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Patient not found' });
        }
        
        res.json({ success: true, patient: result.rows[0] });
    } catch (error) {
        console.error('Get patient error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update patient
app.put('/api/patients/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        // Build dynamic update query
        const fields = Object.keys(updates);
        const values = Object.values(updates);
        const setClause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
        
        const query = `UPDATE hms.patients SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`;
        const result = await pool.query(query, [id, ...values]);
        
        res.json({ success: true, patient: result.rows[0] });
    } catch (error) {
        console.error('Update patient error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

// ===================== MEDICAL RECORDS ENDPOINTS =====================

// Create medical record
app.post('/api/medical-records', async (req, res) => {
    try {
        const {
            patient_id, doctor_id, chief_complaint,
            diagnosis, treatment_plan, prescriptions,
            lab_results, vitals, notes
        } = req.body;
        
        const result = await pool.query(
            `INSERT INTO hms.medical_records 
            (patient_id, doctor_id, chief_complaint, diagnosis, treatment_plan, prescriptions, lab_results, vitals, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *`,
            [patient_id, doctor_id, chief_complaint, diagnosis, treatment_plan, prescriptions, lab_results, vitals, notes]
        );
        
        res.json({ success: true, record: result.rows[0] });
    } catch (error) {
        console.error('Create medical record error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

// Get patient medical records
app.get('/api/medical-records/patient/:patientId', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT mr.*, p.first_name, p.last_name, u.username as doctor_name
            FROM hms.medical_records mr
            JOIN hms.patients p ON mr.patient_id = p.id
            LEFT JOIN hms.users u ON mr.doctor_id = u.id
            WHERE mr.patient_id = $1
            ORDER BY mr.visit_date DESC`,
            [req.params.patientId]
        );
        
        res.json({ success: true, records: result.rows });
    } catch (error) {
        console.error('Get medical records error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Upload medical record attachment
app.post('/api/medical-records/:id/attachment', upload.single('file'), async (req, res) => {
    try {
        const { id } = req.params;
        const filePath = req.file.path;
        
        await pool.query(
            'UPDATE hms.medical_records SET attachments = array_append(attachments, $1) WHERE id = $2',
            [filePath, id]
        );
        
        res.json({ success: true, filePath });
    } catch (error) {
        console.error('Upload attachment error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

// ===================== BILLING & INVOICE ENDPOINTS =====================

// Create invoice
app.post('/api/invoices', async (req, res) => {
    try {
        const {
            patient_id, items, total_amount,
            payment_method, due_date, insurance_claim
        } = req.body;
        
        const invoice_number = 'INV-' + Date.now();
        
        const result = await pool.query(
            `INSERT INTO hms.invoices 
            (invoice_number, patient_id, items, total_amount, payment_method, due_date, insurance_claim)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *`,
            [invoice_number, patient_id, items, total_amount, payment_method, due_date, insurance_claim]
        );
        
        res.json({ success: true, invoice: result.rows[0] });
    } catch (error) {
        console.error('Create invoice error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

// Get all invoices
app.get('/api/invoices', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT i.*, p.first_name, p.last_name
            FROM hms.invoices i
            JOIN hms.patients p ON i.patient_id = p.id
            ORDER BY i.created_at DESC`
        );
        
        res.json({ success: true, invoices: result.rows });
    } catch (error) {
        console.error('Get invoices error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Process payment
app.post('/api/invoices/:id/payment', async (req, res) => {
    try {
        const { id } = req.params;
        const { amount, payment_method } = req.body;
        
        const result = await pool.query(
            `UPDATE hms.invoices 
            SET paid_amount = paid_amount + $1, 
                payment_method = $2,
                status = CASE 
                    WHEN paid_amount + $1 >= total_amount THEN 'paid'
                    WHEN paid_amount + $1 > 0 THEN 'partial'
                    ELSE 'pending'
                END,
                paid_date = CASE 
                    WHEN paid_amount + $1 >= total_amount THEN CURRENT_TIMESTAMP
                    ELSE paid_date
                END
            WHERE id = $3
            RETURNING *`,
            [amount, payment_method, id]
        );
        
        res.json({ success: true, invoice: result.rows[0] });
    } catch (error) {
        console.error('Process payment error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

// Generate invoice PDF
app.get('/api/invoices/:id/pdf', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT i.*, p.first_name, p.last_name, p.phone, p.email, p.address
            FROM hms.invoices i
            JOIN hms.patients p ON i.patient_id = p.id
            WHERE i.id = $1`,
            [req.params.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Invoice not found' });
        }
        
        const invoice = result.rows[0];
        const doc = new PDFDocument();
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=invoice-${invoice.invoice_number}.pdf`);
        
        doc.pipe(res);
        
        // Add invoice content
        doc.fontSize(20).text('HOSPITAL INVOICE', 50, 50);
        doc.fontSize(12).text(`Invoice Number: ${invoice.invoice_number}`, 50, 100);
        doc.text(`Date: ${new Date(invoice.created_at).toLocaleDateString()}`, 50, 120);
        doc.text(`Patient: ${invoice.first_name} ${invoice.last_name}`, 50, 140);
        doc.text(`Phone: ${invoice.phone}`, 50, 160);
        doc.text(`Email: ${invoice.email}`, 50, 180);
        
        // Add items
        doc.text('Items:', 50, 220);
        const items = invoice.items || [];
        let yPosition = 240;
        
        items.forEach(item => {
            doc.text(`${item.description} - $${item.amount}`, 70, yPosition);
            yPosition += 20;
        });
        
        doc.fontSize(14).text(`Total: $${invoice.total_amount}`, 50, yPosition + 20);
        doc.text(`Paid: $${invoice.paid_amount}`, 50, yPosition + 40);
        doc.text(`Status: ${invoice.status}`, 50, yPosition + 60);
        
        doc.end();
    } catch (error) {
        console.error('Generate PDF error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================== INVENTORY MANAGEMENT ENDPOINTS =====================

// Add inventory item
app.post('/api/inventory', async (req, res) => {
    try {
        const {
            item_code, item_name, category, unit,
            quantity, reorder_level, unit_price,
            expiry_date, batch_number, supplier, location
        } = req.body;
        
        const result = await pool.query(
            `INSERT INTO hms.inventory 
            (item_code, item_name, category, unit, quantity, reorder_level, unit_price, expiry_date, batch_number, supplier, location)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *`,
            [item_code, item_name, category, unit, quantity, reorder_level, unit_price, expiry_date, batch_number, supplier, location]
        );
        
        res.json({ success: true, item: result.rows[0] });
    } catch (error) {
        console.error('Add inventory error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

// Get all inventory items
app.get('/api/inventory', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM hms.inventory ORDER BY item_name');
        res.json({ success: true, items: result.rows });
    } catch (error) {
        console.error('Get inventory error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get low stock items
app.get('/api/inventory/low-stock', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM hms.inventory WHERE quantity <= reorder_level ORDER BY quantity ASC'
        );
        res.json({ success: true, items: result.rows });
    } catch (error) {
        console.error('Get low stock error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update inventory quantity
app.put('/api/inventory/:id/quantity', async (req, res) => {
    try {
        const { id } = req.params;
        const { quantity, operation } = req.body; // operation: 'add' or 'subtract'
        
        const query = operation === 'add'
            ? 'UPDATE hms.inventory SET quantity = quantity + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *'
            : 'UPDATE hms.inventory SET quantity = quantity - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *';
        
        const result = await pool.query(query, [Math.abs(quantity), id]);
        
        res.json({ success: true, item: result.rows[0] });
    } catch (error) {
        console.error('Update inventory error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

// ===================== STAFF MANAGEMENT ENDPOINTS =====================

// Create staff schedule
app.post('/api/staff-schedules', async (req, res) => {
    try {
        const {
            staff_id, date, shift,
            start_time, end_time, department, notes
        } = req.body;
        
        const result = await pool.query(
            `INSERT INTO hms.staff_schedules 
            (staff_id, date, shift, start_time, end_time, department, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *`,
            [staff_id, date, shift, start_time, end_time, department, notes]
        );
        
        res.json({ success: true, schedule: result.rows[0] });
    } catch (error) {
        console.error('Create schedule error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

// Get staff schedules
app.get('/api/staff-schedules', async (req, res) => {
    try {
        const { date, department } = req.query;
        let query = `
            SELECT ss.*, u.username, u.email, u.department as user_dept
            FROM hms.staff_schedules ss
            JOIN hms.users u ON ss.staff_id = u.id
            WHERE 1=1
        `;
        const params = [];
        
        if (date) {
            params.push(date);
            query += ` AND ss.date = $${params.length}`;
        }
        
        if (department) {
            params.push(department);
            query += ` AND ss.department = $${params.length}`;
        }
        
        query += ' ORDER BY ss.date, ss.start_time';
        
        const result = await pool.query(query, params);
        res.json({ success: true, schedules: result.rows });
    } catch (error) {
        console.error('Get schedules error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get staff roster
app.get('/api/staff-roster', async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        
        const result = await pool.query(
            `SELECT ss.*, u.username, u.email, u.department as user_dept
            FROM hms.staff_schedules ss
            JOIN hms.users u ON ss.staff_id = u.id
            WHERE ss.date BETWEEN $1 AND $2
            ORDER BY ss.date, u.department, ss.start_time`,
            [start_date || new Date(), end_date || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)]
        );
        
        res.json({ success: true, roster: result.rows });
    } catch (error) {
        console.error('Get roster error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================== BED MANAGEMENT ENDPOINTS =====================

// Get all beds
app.get('/api/beds', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT b.*, p.first_name, p.last_name
            FROM hms.beds b
            LEFT JOIN hms.patients p ON b.patient_id = p.id
            ORDER BY b.ward, b.bed_number`
        );
        res.json({ success: true, beds: result.rows });
    } catch (error) {
        console.error('Get beds error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get available beds
app.get('/api/beds/available', async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM hms.beds WHERE status = 'available' ORDER BY ward, bed_number"
        );
        res.json({ success: true, beds: result.rows });
    } catch (error) {
        console.error('Get available beds error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Admit patient
app.post('/api/beds/admit', async (req, res) => {
    try {
        const { bed_id, patient_id, expected_discharge } = req.body;
        
        const result = await pool.query(
            `UPDATE hms.beds 
            SET status = 'occupied', 
                patient_id = $1, 
                admission_date = CURRENT_TIMESTAMP,
                expected_discharge = $2,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
            RETURNING *`,
            [patient_id, expected_discharge, bed_id]
        );
        
        res.json({ success: true, bed: result.rows[0] });
    } catch (error) {
        console.error('Admit patient error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

// Discharge patient
app.post('/api/beds/:id/discharge', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query(
            `UPDATE hms.beds 
            SET status = 'available', 
                patient_id = NULL, 
                admission_date = NULL,
                expected_discharge = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING *`,
            [id]
        );
        
        res.json({ success: true, bed: result.rows[0] });
    } catch (error) {
        console.error('Discharge patient error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

// ===================== APPOINTMENTS ENDPOINTS =====================

// Create appointment
app.post('/api/appointments', async (req, res) => {
    try {
        const {
            patient_id, doctor_id, appointment_date,
            reason, notes
        } = req.body;
        
        const result = await pool.query(
            `INSERT INTO hms.appointments 
            (patient_id, doctor_id, appointment_date, reason, notes)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *`,
            [patient_id, doctor_id, appointment_date, reason, notes]
        );
        
        res.json({ success: true, appointment: result.rows[0] });
    } catch (error) {
        console.error('Create appointment error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

// Get appointments
app.get('/api/appointments', async (req, res) => {
    try {
        const { date, doctor_id, patient_id } = req.query;
        let query = `
            SELECT a.*, p.first_name as patient_name, p.last_name as patient_lastname,
                   u.username as doctor_name
            FROM hms.appointments a
            JOIN hms.patients p ON a.patient_id = p.id
            JOIN hms.users u ON a.doctor_id = u.id
            WHERE 1=1
        `;
        const params = [];
        
        if (date) {
            params.push(date);
            query += ` AND DATE(a.appointment_date) = $${params.length}`;
        }
        
        if (doctor_id) {
            params.push(doctor_id);
            query += ` AND a.doctor_id = $${params.length}`;
        }
        
        if (patient_id) {
            params.push(patient_id);
            query += ` AND a.patient_id = $${params.length}`;
        }
        
        query += ' ORDER BY a.appointment_date';
        
        const result = await pool.query(query, params);
        res.json({ success: true, appointments: result.rows });
    } catch (error) {
        console.error('Get appointments error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================== LAB RESULTS ENDPOINTS =====================

// Create lab result
app.post('/api/lab-results', async (req, res) => {
    try {
        const {
            patient_id, test_name, result_value,
            normal_range, status, notes,
            technician_id, doctor_id
        } = req.body;
        
        const result = await pool.query(
            `INSERT INTO hms.lab_results 
            (patient_id, test_name, result_value, normal_range, status, notes, technician_id, doctor_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *`,
            [patient_id, test_name, result_value, normal_range, status, notes, technician_id, doctor_id]
        );
        
        res.json({ success: true, labResult: result.rows[0] });
    } catch (error) {
        console.error('Create lab result error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

// Get patient lab results
app.get('/api/lab-results/patient/:patientId', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT lr.*, u1.username as technician_name, u2.username as doctor_name
            FROM hms.lab_results lr
            LEFT JOIN hms.users u1 ON lr.technician_id = u1.id
            LEFT JOIN hms.users u2 ON lr.doctor_id = u2.id
            WHERE lr.patient_id = $1
            ORDER BY lr.test_date DESC`,
            [req.params.patientId]
        );
        
        res.json({ success: true, results: result.rows });
    } catch (error) {
        console.error('Get lab results error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================== PRESCRIPTIONS ENDPOINTS =====================

// Create prescription
app.post('/api/prescriptions', async (req, res) => {
    try {
        const {
            patient_id, doctor_id, medication_name,
            dosage, frequency, duration, instructions
        } = req.body;
        
        const result = await pool.query(
            `INSERT INTO hms.prescriptions 
            (patient_id, doctor_id, medication_name, dosage, frequency, duration, instructions)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *`,
            [patient_id, doctor_id, medication_name, dosage, frequency, duration, instructions]
        );
        
        res.json({ success: true, prescription: result.rows[0] });
    } catch (error) {
        console.error('Create prescription error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

// Get patient prescriptions
app.get('/api/prescriptions/patient/:patientId', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT pr.*, u.username as doctor_name
            FROM hms.prescriptions pr
            JOIN hms.users u ON pr.doctor_id = u.id
            WHERE pr.patient_id = $1
            ORDER BY pr.created_at DESC`,
            [req.params.patientId]
        );
        
        res.json({ success: true, prescriptions: result.rows });
    } catch (error) {
        console.error('Get prescriptions error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================== ANALYTICS ENDPOINTS =====================

// Get dashboard statistics
app.get('/api/analytics/dashboard', async (req, res) => {
    try {
        const stats = {};
        
        // Get patient count
        const patientCount = await pool.query('SELECT COUNT(*) as count FROM hms.patients');
        stats.totalPatients = parseInt(patientCount.rows[0].count);
        
        // Get today's appointments
        const appointmentsToday = await pool.query(
            "SELECT COUNT(*) as count FROM hms.appointments WHERE DATE(appointment_date) = CURRENT_DATE"
        );
        stats.appointmentsToday = parseInt(appointmentsToday.rows[0].count);
        
        // Get bed occupancy
        const bedStats = await pool.query(
            "SELECT status, COUNT(*) as count FROM hms.beds GROUP BY status"
        );
        stats.bedOccupancy = bedStats.rows;
        
        // Get revenue stats
        const revenueStats = await pool.query(
            `SELECT 
                SUM(total_amount) as total_revenue,
                SUM(paid_amount) as collected_revenue,
                SUM(total_amount - paid_amount) as pending_revenue
            FROM hms.invoices`
        );
        stats.revenue = revenueStats.rows[0];
        
        // Get low stock items count
        const lowStockCount = await pool.query(
            'SELECT COUNT(*) as count FROM hms.inventory WHERE quantity <= reorder_level'
        );
        stats.lowStockItems = parseInt(lowStockCount.rows[0].count);
        
        // Get staff on duty
        const staffOnDuty = await pool.query(
            "SELECT COUNT(DISTINCT staff_id) as count FROM hms.staff_schedules WHERE date = CURRENT_DATE"
        );
        stats.staffOnDuty = parseInt(staffOnDuty.rows[0].count);
        
        res.json({ success: true, stats });
    } catch (error) {
        console.error('Get dashboard stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get revenue analytics
app.get('/api/analytics/revenue', async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        
        const result = await pool.query(
            `SELECT 
                DATE(created_at) as date,
                COUNT(*) as invoice_count,
                SUM(total_amount) as total_amount,
                SUM(paid_amount) as paid_amount,
                SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_count
            FROM hms.invoices
            WHERE created_at BETWEEN $1 AND $2
            GROUP BY DATE(created_at)
            ORDER BY date`,
            [start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), end_date || new Date()]
        );
        
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Get revenue analytics error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get occupancy analytics
app.get('/api/analytics/occupancy', async (req, res) => {
    try {
        const wardStats = await pool.query(
            `SELECT 
                ward,
                COUNT(*) as total_beds,
                SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) as occupied_beds,
                ROUND(SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END)::numeric / COUNT(*)::numeric * 100, 2) as occupancy_rate
            FROM hms.beds
            GROUP BY ward`
        );
        
        res.json({ success: true, data: wardStats.rows });
    } catch (error) {
        console.error('Get occupancy analytics error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Export analytics report
app.post('/api/analytics/export', async (req, res) => {
    try {
        const { type, start_date, end_date } = req.body;
        
        const doc = new PDFDocument();
        const filename = `analytics-report-${type}-${Date.now()}.pdf`;
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
        
        doc.pipe(res);
        
        doc.fontSize(20).text('Hospital Analytics Report', 50, 50);
        doc.fontSize(12).text(`Report Type: ${type}`, 50, 100);
        doc.text(`Period: ${start_date} to ${end_date}`, 50, 120);
        doc.text(`Generated: ${new Date().toLocaleString()}`, 50, 140);
        
        // Add report data based on type
        if (type === 'revenue') {
            const revenueData = await pool.query(
                `SELECT * FROM hms.invoices WHERE created_at BETWEEN $1 AND $2`,
                [start_date, end_date]
            );
            
            doc.text(`Total Invoices: ${revenueData.rows.length}`, 50, 180);
            // Add more revenue details...
        } else if (type === 'occupancy') {
            const occupancyData = await pool.query('SELECT * FROM hms.beds');
            const occupied = occupancyData.rows.filter(b => b.status === 'occupied').length;
            
            doc.text(`Total Beds: ${occupancyData.rows.length}`, 50, 180);
            doc.text(`Occupied Beds: ${occupied}`, 50, 200);
            doc.text(`Occupancy Rate: ${(occupied / occupancyData.rows.length * 100).toFixed(2)}%`, 50, 220);
        }
        
        doc.end();
    } catch (error) {
        console.error('Export report error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================== SYSTEM ENDPOINTS =====================

// Health check
app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ 
            success: true, 
            status: 'healthy',
            timestamp: new Date(),
            service: 'HMS Backend',
            version: '2.0.0'
        });
    } catch (error) {
        res.status(503).json({ 
            success: false, 
            status: 'unhealthy',
            error: error.message 
        });
    }
});

// Get system info
app.get('/api/system/info', async (req, res) => {
    try {
        const tableCount = await pool.query(
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'hms'"
        );
        
        const userCount = await pool.query('SELECT COUNT(*) FROM hms.users');
        const patientCount = await pool.query('SELECT COUNT(*) FROM hms.patients');
        
        res.json({
            success: true,
            info: {
                version: '2.0.0',
                database: 'PostgreSQL',
                tables: parseInt(tableCount.rows[0].count),
                users: parseInt(userCount.rows[0].count),
                patients: parseInt(patientCount.rows[0].count),
                uptime: process.uptime()
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Seed initial data
app.post('/api/system/seed', async (req, res) => {
    try {
        // Create sample users
        const hashedPassword = await bcrypt.hash('password123', 10);
        
        await pool.query(
            `INSERT INTO hms.users (username, email, password, role, department) 
            VALUES 
            ('admin', 'admin@hospital.com', $1, 'admin', 'Administration'),
            ('dr.smith', 'smith@hospital.com', $1, 'doctor', 'Cardiology'),
            ('nurse.jane', 'jane@hospital.com', $1, 'nurse', 'Emergency'),
            ('tech.john', 'john@hospital.com', $1, 'technician', 'Laboratory')
            ON CONFLICT (email) DO NOTHING`,
            [hashedPassword]
        );
        
        // Create sample beds
        await pool.query(
            `INSERT INTO hms.beds (bed_number, ward, floor, status) 
            VALUES 
            ('101', 'General', 1, 'available'),
            ('102', 'General', 1, 'available'),
            ('201', 'ICU', 2, 'available'),
            ('202', 'ICU', 2, 'available'),
            ('301', 'Pediatric', 3, 'available'),
            ('302', 'Pediatric', 3, 'available')
            ON CONFLICT (bed_number) DO NOTHING`
        );
        
        // Create sample inventory items
        await pool.query(
            `INSERT INTO hms.inventory (item_code, item_name, category, unit, quantity, reorder_level, unit_price) 
            VALUES 
            ('MED001', 'Paracetamol 500mg', 'Medicine', 'Box', 100, 20, 5.00),
            ('MED002', 'Amoxicillin 250mg', 'Medicine', 'Box', 50, 10, 15.00),
            ('SUP001', 'Surgical Gloves', 'Supplies', 'Box', 200, 50, 10.00),
            ('SUP002', 'Face Masks', 'Supplies', 'Box', 500, 100, 8.00),
            ('EQP001', 'Blood Pressure Monitor', 'Equipment', 'Unit', 10, 2, 150.00)
            ON CONFLICT (item_code) DO NOTHING`
        );
        
        res.json({ success: true, message: 'Initial data seeded successfully' });
    } catch (error) {
        console.error('Seed data error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`HMS Backend Server running on port ${PORT}`);
    console.log(`Access the API at http://localhost:${PORT}`);
});

// Export for testing
module.exports = app;
