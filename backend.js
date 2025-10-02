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
const WebSocket = require('ws');
const http = require('http');

// Database configuration
const DATABASE_URL = 'postgresql://neondb_owner:npg_lIeD35dukpfC@ep-steep-river-ad25brti-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require';

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const app = express();
const PORT = process.env.PORT || 5500;

// Create HTTP server for WebSocket
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// WebSocket connections
const wsClients = new Set();

wss.on('connection', (ws) => {
    wsClients.add(ws);
    console.log('New WebSocket connection established');
    
    ws.on('close', () => {
        wsClients.delete(ws);
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        wsClients.delete(ws);
    });
});

// Broadcast function for real-time updates
function broadcast(data) {
    const message = JSON.stringify(data);
    wsClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Middleware
app.use(cors({
    origin: '*',
    credentials: true
}));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Create uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

const upload = multer({ 
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }
});

// JWT Secret
const JWT_SECRET = 'hms-secret-key-2024';

// Email configuration (using mock for now)
const emailTransporter = {
    sendMail: async (options) => {
        console.log('Email would be sent:', options);
        return { messageId: uuidv4() };
    }
};

// Authentication Middleware
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

// Initialize Complete Database Schema
async function initializeDatabase() {
    try {
        // Drop and recreate schema for clean installation
        await pool.query(`DROP SCHEMA IF EXISTS hms CASCADE`);
        await pool.query(`CREATE SCHEMA hms`);
        
        // Users table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(50) NOT NULL,
                department VARCHAR(100),
                specialization VARCHAR(100),
                license_number VARCHAR(100),
                phone VARCHAR(20),
                address TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
                city VARCHAR(100),
                state VARCHAR(100),
                zip_code VARCHAR(20),
                blood_group VARCHAR(10),
                emergency_contact_name VARCHAR(200),
                emergency_contact_phone VARCHAR(20),
                emergency_contact_relationship VARCHAR(100),
                insurance_provider VARCHAR(200),
                insurance_policy_number VARCHAR(100),
                insurance_group_number VARCHAR(100),
                allergies TEXT[],
                chronic_conditions TEXT[],
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Medical Records table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.medical_records (
                id SERIAL PRIMARY KEY,
                record_id VARCHAR(50) UNIQUE NOT NULL,
                patient_id INTEGER REFERENCES hms.patients(id),
                doctor_id INTEGER REFERENCES hms.users(id),
                visit_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                visit_type VARCHAR(50),
                chief_complaint TEXT,
                history_of_present_illness TEXT,
                physical_examination TEXT,
                vital_signs JSONB,
                assessment TEXT,
                plan TEXT,
                follow_up_date DATE,
                status VARCHAR(50) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Diagnoses table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.diagnoses (
                id SERIAL PRIMARY KEY,
                record_id INTEGER REFERENCES hms.medical_records(id),
                icd_code VARCHAR(20),
                description TEXT,
                severity VARCHAR(50),
                date_diagnosed DATE DEFAULT CURRENT_DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Prescriptions table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.prescriptions (
                id SERIAL PRIMARY KEY,
                record_id INTEGER REFERENCES hms.medical_records(id),
                patient_id INTEGER REFERENCES hms.patients(id),
                doctor_id INTEGER REFERENCES hms.users(id),
                medication_name VARCHAR(200),
                dosage VARCHAR(100),
                frequency VARCHAR(100),
                duration VARCHAR(100),
                instructions TEXT,
                refills INTEGER DEFAULT 0,
                status VARCHAR(50) DEFAULT 'active',
                prescribed_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expiry_date DATE
            )
        `);

        // Lab Results table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.lab_results (
                id SERIAL PRIMARY KEY,
                record_id INTEGER REFERENCES hms.medical_records(id),
                patient_id INTEGER REFERENCES hms.patients(id),
                test_name VARCHAR(200),
                test_category VARCHAR(100),
                result_value TEXT,
                reference_range VARCHAR(100),
                unit VARCHAR(50),
                status VARCHAR(50),
                notes TEXT,
                ordered_by INTEGER REFERENCES hms.users(id),
                test_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                result_date TIMESTAMP,
                file_path TEXT
            )
        `);

        // Invoices table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.invoices (
                id SERIAL PRIMARY KEY,
                invoice_number VARCHAR(50) UNIQUE NOT NULL,
                patient_id INTEGER REFERENCES hms.patients(id),
                total_amount DECIMAL(10, 2),
                paid_amount DECIMAL(10, 2) DEFAULT 0,
                discount_amount DECIMAL(10, 2) DEFAULT 0,
                tax_amount DECIMAL(10, 2) DEFAULT 0,
                payment_status VARCHAR(50) DEFAULT 'pending',
                payment_method VARCHAR(50),
                insurance_claim_id VARCHAR(100),
                billing_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                due_date DATE,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Invoice Items table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.invoice_items (
                id SERIAL PRIMARY KEY,
                invoice_id INTEGER REFERENCES hms.invoices(id),
                description VARCHAR(500),
                category VARCHAR(100),
                quantity INTEGER DEFAULT 1,
                unit_price DECIMAL(10, 2),
                total_price DECIMAL(10, 2),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Payments table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.payments (
                id SERIAL PRIMARY KEY,
                invoice_id INTEGER REFERENCES hms.invoices(id),
                amount DECIMAL(10, 2),
                payment_method VARCHAR(50),
                transaction_id VARCHAR(100),
                payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                notes TEXT,
                created_by INTEGER REFERENCES hms.users(id)
            )
        `);

        // Insurance Claims table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.insurance_claims (
                id SERIAL PRIMARY KEY,
                claim_number VARCHAR(100) UNIQUE NOT NULL,
                patient_id INTEGER REFERENCES hms.patients(id),
                invoice_id INTEGER REFERENCES hms.invoices(id),
                insurance_provider VARCHAR(200),
                policy_number VARCHAR(100),
                claim_amount DECIMAL(10, 2),
                approved_amount DECIMAL(10, 2),
                status VARCHAR(50) DEFAULT 'pending',
                submission_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                approval_date TIMESTAMP,
                denial_reason TEXT,
                notes TEXT
            )
        `);

        // Inventory Items table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.inventory_items (
                id SERIAL PRIMARY KEY,
                item_code VARCHAR(100) UNIQUE NOT NULL,
                name VARCHAR(200) NOT NULL,
                category VARCHAR(100),
                unit VARCHAR(50),
                current_stock INTEGER DEFAULT 0,
                minimum_stock INTEGER DEFAULT 10,
                maximum_stock INTEGER DEFAULT 1000,
                reorder_level INTEGER DEFAULT 20,
                unit_price DECIMAL(10, 2),
                expiry_date DATE,
                manufacturer VARCHAR(200),
                supplier_id INTEGER,
                location VARCHAR(100),
                status VARCHAR(50) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Stock Movements table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.stock_movements (
                id SERIAL PRIMARY KEY,
                item_id INTEGER REFERENCES hms.inventory_items(id),
                movement_type VARCHAR(50),
                quantity INTEGER,
                reference_number VARCHAR(100),
                reason TEXT,
                performed_by INTEGER REFERENCES hms.users(id),
                movement_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Purchase Orders table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.purchase_orders (
                id SERIAL PRIMARY KEY,
                order_number VARCHAR(100) UNIQUE NOT NULL,
                supplier_name VARCHAR(200),
                order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expected_delivery DATE,
                total_amount DECIMAL(10, 2),
                status VARCHAR(50) DEFAULT 'pending',
                created_by INTEGER REFERENCES hms.users(id),
                approved_by INTEGER REFERENCES hms.users(id),
                notes TEXT
            )
        `);

        // Purchase Order Items table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.purchase_order_items (
                id SERIAL PRIMARY KEY,
                order_id INTEGER REFERENCES hms.purchase_orders(id),
                item_id INTEGER REFERENCES hms.inventory_items(id),
                quantity INTEGER,
                unit_price DECIMAL(10, 2),
                total_price DECIMAL(10, 2)
            )
        `);

        // Staff table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.staff (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES hms.users(id),
                employee_id VARCHAR(100) UNIQUE NOT NULL,
                designation VARCHAR(100),
                department VARCHAR(100),
                date_of_joining DATE,
                employment_type VARCHAR(50),
                shift VARCHAR(50),
                salary DECIMAL(10, 2),
                bank_account VARCHAR(100),
                emergency_contact JSONB,
                qualifications TEXT[],
                status VARCHAR(50) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Schedules table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.schedules (
                id SERIAL PRIMARY KEY,
                staff_id INTEGER REFERENCES hms.staff(id),
                date DATE,
                shift_start TIME,
                shift_end TIME,
                department VARCHAR(100),
                status VARCHAR(50) DEFAULT 'scheduled',
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Attendance table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.attendance (
                id SERIAL PRIMARY KEY,
                staff_id INTEGER REFERENCES hms.staff(id),
                date DATE,
                check_in TIME,
                check_out TIME,
                status VARCHAR(50),
                overtime_hours DECIMAL(4, 2),
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Payroll table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.payroll (
                id SERIAL PRIMARY KEY,
                staff_id INTEGER REFERENCES hms.staff(id),
                pay_period_start DATE,
                pay_period_end DATE,
                basic_salary DECIMAL(10, 2),
                overtime_pay DECIMAL(10, 2),
                deductions DECIMAL(10, 2),
                net_pay DECIMAL(10, 2),
                payment_date DATE,
                payment_method VARCHAR(50),
                status VARCHAR(50) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Wards table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.wards (
                id SERIAL PRIMARY KEY,
                ward_number VARCHAR(50) UNIQUE NOT NULL,
                name VARCHAR(100),
                floor INTEGER,
                total_beds INTEGER,
                occupied_beds INTEGER DEFAULT 0,
                ward_type VARCHAR(100),
                status VARCHAR(50) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Beds table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.beds (
                id SERIAL PRIMARY KEY,
                bed_number VARCHAR(50) UNIQUE NOT NULL,
                ward_id INTEGER REFERENCES hms.wards(id),
                bed_type VARCHAR(50),
                status VARCHAR(50) DEFAULT 'available',
                patient_id INTEGER REFERENCES hms.patients(id),
                last_cleaned TIMESTAMP,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Admissions table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.admissions (
                id SERIAL PRIMARY KEY,
                admission_number VARCHAR(100) UNIQUE NOT NULL,
                patient_id INTEGER REFERENCES hms.patients(id),
                bed_id INTEGER REFERENCES hms.beds(id),
                ward_id INTEGER REFERENCES hms.wards(id),
                doctor_id INTEGER REFERENCES hms.users(id),
                admission_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expected_discharge DATE,
                actual_discharge TIMESTAMP,
                admission_type VARCHAR(50),
                diagnosis TEXT,
                status VARCHAR(50) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Bed Transfers table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hms.bed_transfers (
                id SERIAL PRIMARY KEY,
                admission_id INTEGER REFERENCES hms.admissions(id),
                from_bed_id INTEGER REFERENCES hms.beds(id),
                to_bed_id INTEGER REFERENCES hms.beds(id),
                transfer_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                reason TEXT,
                authorized_by INTEGER REFERENCES hms.users(id)
            )
        `);

        // Create default admin user if not exists
        const adminCheck = await pool.query(
            'SELECT id FROM hms.users WHERE username = $1',
            ['admin']
        );
        
        if (adminCheck.rows.length === 0) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await pool.query(
                `INSERT INTO hms.users (username, email, password, role, department) 
                 VALUES ($1, $2, $3, $4, $5)`,
                ['admin', 'admin@hms.local', hashedPassword, 'admin', 'Administration']
            );
            console.log('Default admin user created (username: admin, password: admin123)');
        }

        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Database initialization error:', error);
        throw error;
    }
}

// ==================== AUTHENTICATION ENDPOINTS ====================

app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password, role, department, specialization, license_number } = req.body;
        
        // Check if user exists
        const userCheck = await pool.query(
            'SELECT id FROM hms.users WHERE username = $1 OR email = $2',
            [username, email]
        );
        
        if (userCheck.rows.length > 0) {
            return res.status(400).json({ error: 'User already exists' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const result = await pool.query(
            `INSERT INTO hms.users (username, email, password, role, department, specialization, license_number) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, username, email, role`,
            [username, email, hashedPassword, role, department, specialization, license_number]
        );
        
        const token = jwt.sign(
            { id: result.rows[0].id, username, role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.json({ 
            message: 'User registered successfully',
            user: result.rows[0],
            token 
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const result = await pool.query(
            'SELECT id, username, email, password, role, department FROM hms.users WHERE username = $1 OR email = $1',
            [username]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password);
        
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        delete user.password;
        
        res.json({ 
            message: 'Login successful',
            user,
            token 
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// ==================== PATIENT MANAGEMENT ENDPOINTS ====================

app.post('/api/patients', authenticateToken, async (req, res) => {
    try {
        const patientData = req.body;
        const patientId = 'PAT-' + uuidv4().substring(0, 8).toUpperCase();
        
        const result = await pool.query(
            `INSERT INTO hms.patients (
                patient_id, first_name, last_name, date_of_birth, gender,
                phone, email, address, city, state, zip_code, blood_group,
                emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
                insurance_provider, insurance_policy_number, insurance_group_number,
                allergies, chronic_conditions
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
            RETURNING *`,
            [
                patientId, patientData.first_name, patientData.last_name, patientData.date_of_birth,
                patientData.gender, patientData.phone, patientData.email, patientData.address,
                patientData.city, patientData.state, patientData.zip_code, patientData.blood_group,
                patientData.emergency_contact_name, patientData.emergency_contact_phone,
                patientData.emergency_contact_relationship, patientData.insurance_provider,
                patientData.insurance_policy_number, patientData.insurance_group_number,
                patientData.allergies || [], patientData.chronic_conditions || []
            ]
        );
        
        broadcast({ type: 'patient_added', data: result.rows[0] });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error creating patient:', error);
        res.status(500).json({ error: 'Failed to create patient' });
    }
});

app.get('/api/patients', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM hms.patients ORDER BY created_at DESC'
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching patients:', error);
        res.status(500).json({ error: 'Failed to fetch patients' });
    }
});

app.get('/api/patients/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM hms.patients WHERE id = $1',
            [req.params.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error fetching patient:', error);
        res.status(500).json({ error: 'Failed to fetch patient' });
    }
});

app.put('/api/patients/:id', authenticateToken, async (req, res) => {
    try {
        const patientData = req.body;
        const result = await pool.query(
            `UPDATE hms.patients SET 
                first_name = $1, last_name = $2, phone = $3, email = $4,
                address = $5, emergency_contact_name = $6, emergency_contact_phone = $7,
                insurance_provider = $8, insurance_policy_number = $9,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $10 RETURNING *`,
            [
                patientData.first_name, patientData.last_name, patientData.phone,
                patientData.email, patientData.address, patientData.emergency_contact_name,
                patientData.emergency_contact_phone, patientData.insurance_provider,
                patientData.insurance_policy_number, req.params.id
            ]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }
        
        broadcast({ type: 'patient_updated', data: result.rows[0] });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating patient:', error);
        res.status(500).json({ error: 'Failed to update patient' });
    }
});

// ==================== MEDICAL RECORDS ENDPOINTS ====================

app.post('/api/medical-records', authenticateToken, async (req, res) => {
    try {
        const recordData = req.body;
        const recordId = 'REC-' + uuidv4().substring(0, 8).toUpperCase();
        
        const result = await pool.query(
            `INSERT INTO hms.medical_records (
                record_id, patient_id, doctor_id, visit_type, chief_complaint,
                history_of_present_illness, physical_examination, vital_signs,
                assessment, plan, follow_up_date
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *`,
            [
                recordId, recordData.patient_id, req.user.id, recordData.visit_type,
                recordData.chief_complaint, recordData.history_of_present_illness,
                recordData.physical_examination, recordData.vital_signs,
                recordData.assessment, recordData.plan, recordData.follow_up_date
            ]
        );
        
        // Add diagnoses if provided
        if (recordData.diagnoses && recordData.diagnoses.length > 0) {
            for (const diagnosis of recordData.diagnoses) {
                await pool.query(
                    `INSERT INTO hms.diagnoses (record_id, icd_code, description, severity)
                     VALUES ($1, $2, $3, $4)`,
                    [result.rows[0].id, diagnosis.icd_code, diagnosis.description, diagnosis.severity]
                );
            }
        }
        
        // Add prescriptions if provided
        if (recordData.prescriptions && recordData.prescriptions.length > 0) {
            for (const prescription of recordData.prescriptions) {
                await pool.query(
                    `INSERT INTO hms.prescriptions (
                        record_id, patient_id, doctor_id, medication_name,
                        dosage, frequency, duration, instructions
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [
                        result.rows[0].id, recordData.patient_id, req.user.id,
                        prescription.medication_name, prescription.dosage,
                        prescription.frequency, prescription.duration, prescription.instructions
                    ]
                );
            }
        }
        
        broadcast({ type: 'medical_record_created', data: result.rows[0] });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error creating medical record:', error);
        res.status(500).json({ error: 'Failed to create medical record' });
    }
});

app.get('/api/medical-records', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT mr.*, p.first_name, p.last_name, p.patient_id as patient_code,
                   u.username as doctor_name
            FROM hms.medical_records mr
            JOIN hms.patients p ON mr.patient_id = p.id
            JOIN hms.users u ON mr.doctor_id = u.id
            ORDER BY mr.visit_date DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching medical records:', error);
        res.status(500).json({ error: 'Failed to fetch medical records' });
    }
});

app.get('/api/medical-records/:id', authenticateToken, async (req, res) => {
    try {
        const recordResult = await pool.query(`
            SELECT mr.*, p.first_name, p.last_name, p.patient_id as patient_code,
                   u.username as doctor_name
            FROM hms.medical_records mr
            JOIN hms.patients p ON mr.patient_id = p.id
            JOIN hms.users u ON mr.doctor_id = u.id
            WHERE mr.id = $1
        `, [req.params.id]);
        
        if (recordResult.rows.length === 0) {
            return res.status(404).json({ error: 'Medical record not found' });
        }
        
        // Get diagnoses
        const diagnosesResult = await pool.query(
            'SELECT * FROM hms.diagnoses WHERE record_id = $1',
            [req.params.id]
        );
        
        // Get prescriptions
        const prescriptionsResult = await pool.query(
            'SELECT * FROM hms.prescriptions WHERE record_id = $1',
            [req.params.id]
        );
        
        // Get lab results
        const labResultsResult = await pool.query(
            'SELECT * FROM hms.lab_results WHERE record_id = $1',
            [req.params.id]
        );
        
        const record = recordResult.rows[0];
        record.diagnoses = diagnosesResult.rows;
        record.prescriptions = prescriptionsResult.rows;
        record.lab_results = labResultsResult.rows;
        
        res.json(record);
    } catch (error) {
        console.error('Error fetching medical record:', error);
        res.status(500).json({ error: 'Failed to fetch medical record' });
    }
});

app.get('/api/medical-records/patient/:patientId', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT mr.*, u.username as doctor_name
            FROM hms.medical_records mr
            JOIN hms.users u ON mr.doctor_id = u.id
            WHERE mr.patient_id = $1
            ORDER BY mr.visit_date DESC
        `, [req.params.patientId]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching patient records:', error);
        res.status(500).json({ error: 'Failed to fetch patient records' });
    }
});

// Lab Results endpoints
app.post('/api/lab-results', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        const labData = req.body;
        const filePath = req.file ? req.file.path : null;
        
        const result = await pool.query(
            `INSERT INTO hms.lab_results (
                record_id, patient_id, test_name, test_category,
                result_value, reference_range, unit, status,
                notes, ordered_by, file_path
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *`,
            [
                labData.record_id, labData.patient_id, labData.test_name,
                labData.test_category, labData.result_value, labData.reference_range,
                labData.unit, labData.status || 'pending', labData.notes,
                req.user.id, filePath
            ]
        );
        
        broadcast({ type: 'lab_result_added', data: result.rows[0] });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error creating lab result:', error);
        res.status(500).json({ error: 'Failed to create lab result' });
    }
});

app.put('/api/lab-results/:id/update', authenticateToken, async (req, res) => {
    try {
        const { result_value, status } = req.body;
        
        const result = await pool.query(
            `UPDATE hms.lab_results 
             SET result_value = $1, status = $2, result_date = CURRENT_TIMESTAMP
             WHERE id = $3 RETURNING *`,
            [result_value, status, req.params.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Lab result not found' });
        }
        
        broadcast({ type: 'lab_result_updated', data: result.rows[0] });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating lab result:', error);
        res.status(500).json({ error: 'Failed to update lab result' });
    }
});

// ==================== BILLING & REVENUE ENDPOINTS ====================

app.post('/api/invoices', authenticateToken, async (req, res) => {
    try {
        const invoiceData = req.body;
        const invoiceNumber = 'INV-' + Date.now();
        
        // Calculate totals
        let subtotal = 0;
        if (invoiceData.items && invoiceData.items.length > 0) {
            subtotal = invoiceData.items.reduce((sum, item) => 
                sum + (item.quantity * item.unit_price), 0
            );
        }
        
        const taxAmount = subtotal * (invoiceData.tax_rate || 0.1);
        const discountAmount = invoiceData.discount_amount || 0;
        const totalAmount = subtotal + taxAmount - discountAmount;
        
        // Create invoice
        const invoiceResult = await pool.query(
            `INSERT INTO hms.invoices (
                invoice_number, patient_id, total_amount, tax_amount,
                discount_amount, payment_status, payment_method,
                due_date, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *`,
            [
                invoiceNumber, invoiceData.patient_id, totalAmount, taxAmount,
                discountAmount, 'pending', invoiceData.payment_method,
                invoiceData.due_date, invoiceData.notes
            ]
        );
        
        const invoice = invoiceResult.rows[0];
        
        // Add invoice items
        if (invoiceData.items && invoiceData.items.length > 0) {
            for (const item of invoiceData.items) {
                await pool.query(
                    `INSERT INTO hms.invoice_items (
                        invoice_id, description, category, quantity,
                        unit_price, total_price
                    ) VALUES ($1, $2, $3, $4, $5, $6)`,
                    [
                        invoice.id, item.description, item.category,
                        item.quantity, item.unit_price,
                        item.quantity * item.unit_price
                    ]
                );
            }
        }
        
        broadcast({ type: 'invoice_created', data: invoice });
        res.json(invoice);
    } catch (error) {
        console.error('Error creating invoice:', error);
        res.status(500).json({ error: 'Failed to create invoice' });
    }
});

app.get('/api/invoices', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT i.*, p.first_name, p.last_name, p.patient_id as patient_code
            FROM hms.invoices i
            JOIN hms.patients p ON i.patient_id = p.id
            ORDER BY i.created_at DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching invoices:', error);
        res.status(500).json({ error: 'Failed to fetch invoices' });
    }
});

app.get('/api/invoices/:id', authenticateToken, async (req, res) => {
    try {
        const invoiceResult = await pool.query(`
            SELECT i.*, p.first_name, p.last_name, p.patient_id as patient_code,
                   p.email, p.phone, p.address
            FROM hms.invoices i
            JOIN hms.patients p ON i.patient_id = p.id
            WHERE i.id = $1
        `, [req.params.id]);
        
        if (invoiceResult.rows.length === 0) {
            return res.status(404).json({ error: 'Invoice not found' });
        }
        
        const itemsResult = await pool.query(
            'SELECT * FROM hms.invoice_items WHERE invoice_id = $1',
            [req.params.id]
        );
        
        const paymentsResult = await pool.query(
            'SELECT * FROM hms.payments WHERE invoice_id = $1',
            [req.params.id]
        );
        
        const invoice = invoiceResult.rows[0];
        invoice.items = itemsResult.rows;
        invoice.payments = paymentsResult.rows;
        
        res.json(invoice);
    } catch (error) {
        console.error('Error fetching invoice:', error);
        res.status(500).json({ error: 'Failed to fetch invoice' });
    }
});

app.put('/api/invoices/:id/payment', authenticateToken, async (req, res) => {
    try {
        const { amount, payment_method, transaction_id, notes } = req.body;
        
        // Record payment
        await pool.query(
            `INSERT INTO hms.payments (invoice_id, amount, payment_method, transaction_id, notes, created_by)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [req.params.id, amount, payment_method, transaction_id, notes, req.user.id]
        );
        
        // Update invoice paid amount and status
        const result = await pool.query(
            `UPDATE hms.invoices 
             SET paid_amount = paid_amount + $1,
                 payment_status = CASE 
                     WHEN paid_amount + $1 >= total_amount THEN 'paid'
                     WHEN paid_amount + $1 > 0 THEN 'partial'
                     ELSE 'pending'
                 END,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $2 RETURNING *`,
            [amount, req.params.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Invoice not found' });
        }
        
        broadcast({ type: 'payment_recorded', data: result.rows[0] });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error recording payment:', error);
        res.status(500).json({ error: 'Failed to record payment' });
    }
});

app.post('/api/insurance-claims', authenticateToken, async (req, res) => {
    try {
        const claimData = req.body;
        const claimNumber = 'CLM-' + Date.now();
        
        const result = await pool.query(
            `INSERT INTO hms.insurance_claims (
                claim_number, patient_id, invoice_id, insurance_provider,
                policy_number, claim_amount, status, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *`,
            [
                claimNumber, claimData.patient_id, claimData.invoice_id,
                claimData.insurance_provider, claimData.policy_number,
                claimData.claim_amount, 'pending', claimData.notes
            ]
        );
        
        // Update invoice with claim ID
        if (claimData.invoice_id) {
            await pool.query(
                'UPDATE hms.invoices SET insurance_claim_id = $1 WHERE id = $2',
                [claimNumber, claimData.invoice_id]
            );
        }
        
        broadcast({ type: 'insurance_claim_submitted', data: result.rows[0] });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error submitting insurance claim:', error);
        res.status(500).json({ error: 'Failed to submit insurance claim' });
    }
});

app.get('/api/revenue-reports', authenticateToken, async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        
        let dateFilter = '';
        const params = [];
        
        if (start_date && end_date) {
            dateFilter = 'WHERE i.billing_date BETWEEN $1 AND $2';
            params.push(start_date, end_date);
        }
        
        const revenueResult = await pool.query(`
            SELECT 
                COUNT(*) as total_invoices,
                SUM(total_amount) as total_billed,
                SUM(paid_amount) as total_collected,
                SUM(total_amount - paid_amount) as outstanding_amount,
                AVG(total_amount) as average_invoice_amount
            FROM hms.invoices i
            ${dateFilter}
        `, params);
        
        const paymentMethodsResult = await pool.query(`
            SELECT 
                payment_method,
                COUNT(*) as count,
                SUM(amount) as total
            FROM hms.payments
            GROUP BY payment_method
        `);
        
        const insuranceClaimsResult = await pool.query(`
            SELECT 
                status,
                COUNT(*) as count,
                SUM(claim_amount) as total_claimed,
                SUM(approved_amount) as total_approved
            FROM hms.insurance_claims
            GROUP BY status
        `);
        
        res.json({
            summary: revenueResult.rows[0],
            payment_methods: paymentMethodsResult.rows,
            insurance_claims: insuranceClaimsResult.rows
        });
    } catch (error) {
        console.error('Error generating revenue report:', error);
        res.status(500).json({ error: 'Failed to generate revenue report' });
    }
});

// ==================== INVENTORY MANAGEMENT ENDPOINTS ====================

app.post('/api/inventory/items', authenticateToken, async (req, res) => {
    try {
        const itemData = req.body;
        const itemCode = 'ITM-' + uuidv4().substring(0, 8).toUpperCase();
        
        const result = await pool.query(
            `INSERT INTO hms.inventory_items (
                item_code, name, category, unit, current_stock,
                minimum_stock, maximum_stock, reorder_level,
                unit_price, expiry_date, manufacturer, location
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *`,
            [
                itemCode, itemData.name, itemData.category, itemData.unit,
                itemData.current_stock || 0, itemData.minimum_stock || 10,
                itemData.maximum_stock || 1000, itemData.reorder_level || 20,
                itemData.unit_price, itemData.expiry_date,
                itemData.manufacturer, itemData.location
            ]
        );
        
        // Record initial stock movement
        if (itemData.current_stock > 0) {
            await pool.query(
                `INSERT INTO hms.stock_movements (item_id, movement_type, quantity, reason, performed_by)
                 VALUES ($1, $2, $3, $4, $5)`,
                [result.rows[0].id, 'initial_stock', itemData.current_stock, 'Initial stock entry', req.user.id]
            );
        }
        
        broadcast({ type: 'inventory_item_added', data: result.rows[0] });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error adding inventory item:', error);
        res.status(500).json({ error: 'Failed to add inventory item' });
    }
});

app.get('/api/inventory', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM hms.inventory_items ORDER BY name'
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching inventory:', error);
        res.status(500).json({ error: 'Failed to fetch inventory' });
    }
});

app.put('/api/inventory/:id/stock', authenticateToken, async (req, res) => {
    try {
        const { quantity, movement_type, reason } = req.body;
        
        // Get current stock
        const currentResult = await pool.query(
            'SELECT current_stock FROM hms.inventory_items WHERE id = $1',
            [req.params.id]
        );
        
        if (currentResult.rows.length === 0) {
            return res.status(404).json({ error: 'Item not found' });
        }
        
        const currentStock = currentResult.rows[0].current_stock;
        let newStock = currentStock;
        
        if (movement_type === 'in' || movement_type === 'purchase' || movement_type === 'return') {
            newStock += quantity;
        } else if (movement_type === 'out' || movement_type === 'usage' || movement_type === 'disposal') {
            newStock -= quantity;
        }
        
        if (newStock < 0) {
            return res.status(400).json({ error: 'Insufficient stock' });
        }
        
        // Update stock
        const updateResult = await pool.query(
            `UPDATE hms.inventory_items 
             SET current_stock = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2 RETURNING *`,
            [newStock, req.params.id]
        );
        
        // Record movement
        await pool.query(
            `INSERT INTO hms.stock_movements (item_id, movement_type, quantity, reason, performed_by)
             VALUES ($1, $2, $3, $4, $5)`,
            [req.params.id, movement_type, quantity, reason, req.user.id]
        );
        
        broadcast({ type: 'stock_updated', data: updateResult.rows[0] });
        res.json(updateResult.rows[0]);
    } catch (error) {
        console.error('Error updating stock:', error);
        res.status(500).json({ error: 'Failed to update stock' });
    }
});

app.get('/api/inventory/low-stock', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM hms.inventory_items 
             WHERE current_stock <= reorder_level 
             ORDER BY (current_stock::float / NULLIF(reorder_level, 0)) ASC`
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching low stock items:', error);
        res.status(500).json({ error: 'Failed to fetch low stock items' });
    }
});

app.get('/api/inventory/expiring', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM hms.inventory_items 
             WHERE expiry_date IS NOT NULL 
             AND expiry_date <= CURRENT_DATE + INTERVAL '30 days'
             ORDER BY expiry_date ASC`
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching expiring items:', error);
        res.status(500).json({ error: 'Failed to fetch expiring items' });
    }
});

app.post('/api/inventory/orders', authenticateToken, async (req, res) => {
    try {
        const orderData = req.body;
        const orderNumber = 'PO-' + Date.now();
        
        // Calculate total
        const totalAmount = orderData.items.reduce((sum, item) => 
            sum + (item.quantity * item.unit_price), 0
        );
        
        // Create purchase order
        const orderResult = await pool.query(
            `INSERT INTO hms.purchase_orders (
                order_number, supplier_name, expected_delivery,
                total_amount, status, created_by, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *`,
            [
                orderNumber, orderData.supplier_name, orderData.expected_delivery,
                totalAmount, 'pending', req.user.id, orderData.notes
            ]
        );
        
        const order = orderResult.rows[0];
        
        // Add order items
        for (const item of orderData.items) {
            await pool.query(
                `INSERT INTO hms.purchase_order_items (
                    order_id, item_id, quantity, unit_price, total_price
                ) VALUES ($1, $2, $3, $4, $5)`,
                [
                    order.id, item.item_id, item.quantity,
                    item.unit_price, item.quantity * item.unit_price
                ]
            );
        }
        
        broadcast({ type: 'purchase_order_created', data: order });
        res.json(order);
    } catch (error) {
        console.error('Error creating purchase order:', error);
        res.status(500).json({ error: 'Failed to create purchase order' });
    }
});

// ==================== STAFF MANAGEMENT ENDPOINTS ====================

app.post('/api/staff', authenticateToken, async (req, res) => {
    try {
        const staffData = req.body;
        const employeeId = 'EMP-' + uuidv4().substring(0, 8).toUpperCase();
        
        const result = await pool.query(
            `INSERT INTO hms.staff (
                user_id, employee_id, designation, department,
                date_of_joining, employment_type, shift, salary,
                bank_account, emergency_contact, qualifications
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *`,
            [
                staffData.user_id, employeeId, staffData.designation,
                staffData.department, staffData.date_of_joining,
                staffData.employment_type, staffData.shift, staffData.salary,
                staffData.bank_account, staffData.emergency_contact,
                staffData.qualifications || []
            ]
        );
        
        broadcast({ type: 'staff_added', data: result.rows[0] });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error adding staff:', error);
        res.status(500).json({ error: 'Failed to add staff' });
    }
});

app.get('/api/staff', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT s.*, u.username, u.email, u.role
            FROM hms.staff s
            JOIN hms.users u ON s.user_id = u.id
            WHERE s.status = 'active'
            ORDER BY s.employee_id
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching staff:', error);
        res.status(500).json({ error: 'Failed to fetch staff' });
    }
});

app.post('/api/schedules', authenticateToken, async (req, res) => {
    try {
        const scheduleData = req.body;
        
        const result = await pool.query(
            `INSERT INTO hms.schedules (
                staff_id, date, shift_start, shift_end, department, notes
            ) VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *`,
            [
                scheduleData.staff_id, scheduleData.date, scheduleData.shift_start,
                scheduleData.shift_end, scheduleData.department, scheduleData.notes
            ]
        );
        
        broadcast({ type: 'schedule_created', data: result.rows[0] });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error creating schedule:', error);
        res.status(500).json({ error: 'Failed to create schedule' });
    }
});

app.get('/api/schedules/roster', authenticateToken, async (req, res) => {
    try {
        const { start_date, end_date, department } = req.query;
        
        let query = `
            SELECT sc.*, s.employee_id, u.username
            FROM hms.schedules sc
            JOIN hms.staff s ON sc.staff_id = s.id
            JOIN hms.users u ON s.user_id = u.id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (start_date && end_date) {
            params.push(start_date, end_date);
            query += ` AND sc.date BETWEEN $${params.length - 1} AND $${params.length}`;
        }
        
        if (department) {
            params.push(department);
            query += ` AND sc.department = $${params.length}`;
        }
        
        query += ' ORDER BY sc.date, sc.shift_start';
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching roster:', error);
        res.status(500).json({ error: 'Failed to fetch roster' });
    }
});

app.post('/api/attendance', authenticateToken, async (req, res) => {
    try {
        const { staff_id, date, check_in, check_out, status } = req.body;
        
        // Check if attendance already exists
        const existingCheck = await pool.query(
            'SELECT id FROM hms.attendance WHERE staff_id = $1 AND date = $2',
            [staff_id, date]
        );
        
        let result;
        
        if (existingCheck.rows.length > 0) {
            // Update existing attendance
            result = await pool.query(
                `UPDATE hms.attendance 
                 SET check_in = $1, check_out = $2, status = $3
                 WHERE id = $4 RETURNING *`,
                [check_in, check_out, status, existingCheck.rows[0].id]
            );
        } else {
            // Create new attendance
            result = await pool.query(
                `INSERT INTO hms.attendance (staff_id, date, check_in, check_out, status)
                 VALUES ($1, $2, $3, $4, $5) RETURNING *`,
                [staff_id, date, check_in, check_out, status]
            );
        }
        
        broadcast({ type: 'attendance_recorded', data: result.rows[0] });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error recording attendance:', error);
        res.status(500).json({ error: 'Failed to record attendance' });
    }
});

app.get('/api/payroll', authenticateToken, async (req, res) => {
    try {
        const { month, year } = req.query;
        
        const result = await pool.query(`
            SELECT p.*, s.employee_id, u.username
            FROM hms.payroll p
            JOIN hms.staff s ON p.staff_id = s.id
            JOIN hms.users u ON s.user_id = u.id
            WHERE EXTRACT(MONTH FROM p.pay_period_start) = $1
            AND EXTRACT(YEAR FROM p.pay_period_start) = $2
            ORDER BY s.employee_id
        `, [month || new Date().getMonth() + 1, year || new Date().getFullYear()]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching payroll:', error);
        res.status(500).json({ error: 'Failed to fetch payroll' });
    }
});

// ==================== BED MANAGEMENT ENDPOINTS ====================

app.post('/api/admissions', authenticateToken, async (req, res) => {
    try {
        const admissionData = req.body;
        const admissionNumber = 'ADM-' + Date.now();
        
        // Create admission
        const admissionResult = await pool.query(
            `INSERT INTO hms.admissions (
                admission_number, patient_id, bed_id, ward_id,
                doctor_id, expected_discharge, admission_type, diagnosis
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *`,
            [
                admissionNumber, admissionData.patient_id, admissionData.bed_id,
                admissionData.ward_id, req.user.id, admissionData.expected_discharge,
                admissionData.admission_type, admissionData.diagnosis
            ]
        );
        
        // Update bed status
        await pool.query(
            `UPDATE hms.beds 
             SET status = 'occupied', patient_id = $1
             WHERE id = $2`,
            [admissionData.patient_id, admissionData.bed_id]
        );
        
        // Update ward occupancy
        await pool.query(
            `UPDATE hms.wards 
             SET occupied_beds = occupied_beds + 1
             WHERE id = $1`,
            [admissionData.ward_id]
        );
        
        broadcast({ type: 'admission_created', data: admissionResult.rows[0] });
        res.json(admissionResult.rows[0]);
    } catch (error) {
        console.error('Error creating admission:', error);
        res.status(500).json({ error: 'Failed to create admission' });
    }
});

app.get('/api/beds/available', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT b.*, w.name as ward_name, w.ward_type
            FROM hms.beds b
            JOIN hms.wards w ON b.ward_id = w.id
            WHERE b.status = 'available'
            ORDER BY w.name, b.bed_number
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching available beds:', error);
        res.status(500).json({ error: 'Failed to fetch available beds' });
    }
});

app.put('/api/beds/:id/assign', authenticateToken, async (req, res) => {
    try {
        const { patient_id } = req.body;
        
        const result = await pool.query(
            `UPDATE hms.beds 
             SET status = 'occupied', patient_id = $1
             WHERE id = $2 RETURNING *`,
            [patient_id, req.params.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Bed not found' });
        }
        
        // Update ward occupancy
        await pool.query(
            `UPDATE hms.wards 
             SET occupied_beds = occupied_beds + 1
             WHERE id = (SELECT ward_id FROM hms.beds WHERE id = $1)`,
            [req.params.id]
        );
        
        broadcast({ type: 'bed_assigned', data: result.rows[0] });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error assigning bed:', error);
        res.status(500).json({ error: 'Failed to assign bed' });
    }
});

app.put('/api/beds/:id/release', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `UPDATE hms.beds 
             SET status = 'available', patient_id = NULL, last_cleaned = CURRENT_TIMESTAMP
             WHERE id = $1 RETURNING *`,
            [req.params.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Bed not found' });
        }
        
        // Update ward occupancy
        await pool.query(
            `UPDATE hms.wards 
             SET occupied_beds = occupied_beds - 1
             WHERE id = (SELECT ward_id FROM hms.beds WHERE id = $1)`,
            [req.params.id]
        );
        
        broadcast({ type: 'bed_released', data: result.rows[0] });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error releasing bed:', error);
        res.status(500).json({ error: 'Failed to release bed' });
    }
});

app.get('/api/wards/occupancy', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT w.*, 
                   ROUND((w.occupied_beds::numeric / NULLIF(w.total_beds, 0)) * 100, 2) as occupancy_rate
            FROM hms.wards w
            WHERE w.status = 'active'
            ORDER BY w.ward_number
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching ward occupancy:', error);
        res.status(500).json({ error: 'Failed to fetch ward occupancy' });
    }
});

app.post('/api/transfers', authenticateToken, async (req, res) => {
    try {
        const { admission_id, from_bed_id, to_bed_id, reason } = req.body;
        
        // Record transfer
        const transferResult = await pool.query(
            `INSERT INTO hms.bed_transfers (admission_id, from_bed_id, to_bed_id, reason, authorized_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [admission_id, from_bed_id, to_bed_id, reason, req.user.id]
        );
        
        // Get patient ID
        const patientResult = await pool.query(
            'SELECT patient_id FROM hms.beds WHERE id = $1',
            [from_bed_id]
        );
        
        const patient_id = patientResult.rows[0]?.patient_id;
        
        // Release old bed
        await pool.query(
            `UPDATE hms.beds 
             SET status = 'available', patient_id = NULL
             WHERE id = $1`,
            [from_bed_id]
        );
        
        // Assign new bed
        await pool.query(
            `UPDATE hms.beds 
             SET status = 'occupied', patient_id = $1
             WHERE id = $2`,
            [patient_id, to_bed_id]
        );
        
        // Update admission
        await pool.query(
            `UPDATE hms.admissions 
             SET bed_id = $1
             WHERE id = $2`,
            [to_bed_id, admission_id]
        );
        
        broadcast({ type: 'patient_transferred', data: transferResult.rows[0] });
        res.json(transferResult.rows[0]);
    } catch (error) {
        console.error('Error transferring patient:', error);
        res.status(500).json({ error: 'Failed to transfer patient' });
    }
});

// ==================== ANALYTICS ENDPOINTS ====================

app.get('/api/analytics/overview', authenticateToken, async (req, res) => {
    try {
        // Get multiple metrics in parallel
        const [
            patientsCount,
            admissionsCount,
            availableBedsCount,
            pendingInvoicesCount,
            totalRevenue,
            lowStockCount
        ] = await Promise.all([
            pool.query('SELECT COUNT(*) FROM hms.patients'),
            pool.query("SELECT COUNT(*) FROM hms.admissions WHERE status = 'active'"),
            pool.query("SELECT COUNT(*) FROM hms.beds WHERE status = 'available'"),
            pool.query("SELECT COUNT(*) FROM hms.invoices WHERE payment_status = 'pending'"),
            pool.query('SELECT SUM(paid_amount) FROM hms.invoices'),
            pool.query('SELECT COUNT(*) FROM hms.inventory_items WHERE current_stock <= reorder_level')
        ]);
        
        res.json({
            total_patients: parseInt(patientsCount.rows[0].count),
            active_admissions: parseInt(admissionsCount.rows[0].count),
            available_beds: parseInt(availableBedsCount.rows[0].count),
            pending_invoices: parseInt(pendingInvoicesCount.rows[0].count),
            total_revenue: parseFloat(totalRevenue.rows[0].sum) || 0,
            low_stock_items: parseInt(lowStockCount.rows[0].count)
        });
    } catch (error) {
        console.error('Error fetching analytics overview:', error);
        res.status(500).json({ error: 'Failed to fetch analytics overview' });
    }
});

app.get('/api/analytics/occupancy', authenticateToken, async (req, res) => {
    try {
        const { days = 30 } = req.query;
        
        const result = await pool.query(`
            SELECT 
                DATE(admission_date) as date,
                COUNT(*) as admissions,
                COUNT(CASE WHEN actual_discharge IS NOT NULL THEN 1 END) as discharges
            FROM hms.admissions
            WHERE admission_date >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY DATE(admission_date)
            ORDER BY date
        `);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching occupancy trends:', error);
        res.status(500).json({ error: 'Failed to fetch occupancy trends' });
    }
});

app.get('/api/analytics/revenue', authenticateToken, async (req, res) => {
    try {
        const { period = 'month' } = req.query;
        
        let groupBy = "DATE_TRUNC('month', billing_date)";
        if (period === 'week') {
            groupBy = "DATE_TRUNC('week', billing_date)";
        } else if (period === 'day') {
            groupBy = "DATE(billing_date)";
        }
        
        const result = await pool.query(`
            SELECT 
                ${groupBy} as period,
                SUM(total_amount) as total_billed,
                SUM(paid_amount) as total_collected,
                COUNT(*) as invoice_count,
                AVG(total_amount) as average_invoice
            FROM hms.invoices
            WHERE billing_date >= CURRENT_DATE - INTERVAL '6 months'
            GROUP BY period
            ORDER BY period DESC
        `);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching revenue analytics:', error);
        res.status(500).json({ error: 'Failed to fetch revenue analytics' });
    }
});

app.get('/api/analytics/patient-flow', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                EXTRACT(HOUR FROM visit_date) as hour,
                COUNT(*) as patient_count,
                AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/60) as avg_duration_minutes
            FROM hms.medical_records
            WHERE visit_date >= CURRENT_DATE - INTERVAL '7 days'
            GROUP BY hour
            ORDER BY hour
        `);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching patient flow:', error);
        res.status(500).json({ error: 'Failed to fetch patient flow' });
    }
});

app.get('/api/analytics/staff-performance', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                u.username,
                s.designation,
                s.department,
                COUNT(DISTINCT mr.id) as patients_seen,
                COUNT(DISTINCT a.date) as days_present,
                AVG(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) * 100 as attendance_rate
            FROM hms.staff s
            JOIN hms.users u ON s.user_id = u.id
            LEFT JOIN hms.medical_records mr ON mr.doctor_id = u.id
            LEFT JOIN hms.attendance a ON a.staff_id = s.id
            WHERE s.status = 'active'
            GROUP BY u.username, s.designation, s.department
            ORDER BY patients_seen DESC
        `);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching staff performance:', error);
        res.status(500).json({ error: 'Failed to fetch staff performance' });
    }
});

app.post('/api/analytics/export', authenticateToken, async (req, res) => {
    try {
        const { report_type, format = 'pdf' } = req.body;
        
        // This would generate actual reports in production
        // For now, we'll return a mock response
        const reportId = 'RPT-' + Date.now();
        
        res.json({
            report_id: reportId,
            status: 'generated',
            download_url: `/api/reports/${reportId}/download`,
            format: format
        });
    } catch (error) {
        console.error('Error exporting report:', error);
        res.status(500).json({ error: 'Failed to export report' });
    }
});

// ==================== HEALTH CHECK ====================

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        service: 'HMS Backend',
        timestamp: new Date().toISOString(),
        modules: {
            authentication: 'active',
            patients: 'active',
            medical_records: 'active',
            billing: 'active',
            inventory: 'active',
            staff: 'active',
            beds: 'active',
            analytics: 'active',
            websocket: 'active'
        }
    });
});

// ==================== SEED DATA FOR TESTING ====================

app.post('/api/seed-data', async (req, res) => {
    try {
        // Create sample wards
        const wardData = [
            ['W001', 'General Ward', 1, 20, 0, 'General'],
            ['W002', 'ICU', 2, 10, 0, 'Intensive Care'],
            ['W003', 'Pediatric Ward', 1, 15, 0, 'Pediatric'],
            ['W004', 'Maternity Ward', 2, 12, 0, 'Maternity']
        ];
        
        for (const ward of wardData) {
            await pool.query(
                `INSERT INTO hms.wards (ward_number, name, floor, total_beds, occupied_beds, ward_type)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (ward_number) DO NOTHING`,
                ward
            );
        }
        
        // Create sample beds
        const wardResult = await pool.query('SELECT id, ward_number FROM hms.wards');
        
        for (const ward of wardResult.rows) {
            const bedCount = ward.ward_number === 'W001' ? 20 : 
                           ward.ward_number === 'W002' ? 10 :
                           ward.ward_number === 'W003' ? 15 : 12;
            
            for (let i = 1; i <= bedCount; i++) {
                const bedNumber = `${ward.ward_number}-${i.toString().padStart(3, '0')}`;
                await pool.query(
                    `INSERT INTO hms.beds (bed_number, ward_id, bed_type, status)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (bed_number) DO NOTHING`,
                    [bedNumber, ward.id, 'Standard', 'available']
                );
            }
        }
        
        res.json({ message: 'Seed data created successfully' });
    } catch (error) {
        console.error('Error creating seed data:', error);
        res.status(500).json({ error: 'Failed to create seed data' });
    }
});

// Start server
async function startServer() {
    try {
        await initializeDatabase();
        
        server.listen(PORT, () => {
            console.log(`HMS Backend running on port ${PORT}`);
            console.log(`WebSocket server running on ws://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();

module.exports = app;
