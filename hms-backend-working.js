const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const WebSocket = require('ws');
const http = require('http');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database connection - Using Neon PostgreSQL
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
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Broadcast to all WebSocket clients
function broadcast(type, data) {
    const message = JSON.stringify({ type, data, timestamp: new Date() });
    wsClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(message);
            } catch (error) {
                console.error('Error broadcasting:', error);
            }
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
        console.log('Initializing database tables...');
        
        // Create users table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                name VARCHAR(255) NOT NULL,
                role VARCHAR(50) DEFAULT 'staff',
                department VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create patients table
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
                emergency_contact TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create medical records table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS medical_records (
                id SERIAL PRIMARY KEY,
                patient_id INTEGER REFERENCES patients(id),
                doctor_id INTEGER REFERENCES users(id),
                visit_date DATE DEFAULT CURRENT_DATE,
                diagnosis TEXT,
                symptoms TEXT,
                treatment TEXT,
                prescription TEXT,
                follow_up_date DATE,
                vital_signs JSONB,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create invoices table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS invoices (
                id SERIAL PRIMARY KEY,
                patient_id INTEGER REFERENCES patients(id),
                invoice_number VARCHAR(50) UNIQUE,
                date DATE DEFAULT CURRENT_DATE,
                due_date DATE,
                items JSONB,
                subtotal DECIMAL(10,2),
                tax DECIMAL(10,2),
                total DECIMAL(10,2),
                status VARCHAR(20) DEFAULT 'pending',
                payment_method VARCHAR(50),
                paid_date DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create inventory table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS inventory (
                id SERIAL PRIMARY KEY,
                item_name VARCHAR(255) NOT NULL,
                category VARCHAR(100),
                quantity INTEGER DEFAULT 0,
                unit VARCHAR(50),
                reorder_level INTEGER DEFAULT 10,
                unit_price DECIMAL(10,2),
                supplier VARCHAR(255),
                expiry_date DATE,
                location VARCHAR(100),
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create staff_schedules table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS staff_schedules (
                id SERIAL PRIMARY KEY,
                staff_id INTEGER REFERENCES users(id),
                date DATE NOT NULL,
                shift_start TIME,
                shift_end TIME,
                department VARCHAR(100),
                status VARCHAR(20) DEFAULT 'scheduled',
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create beds table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS beds (
                id SERIAL PRIMARY KEY,
                bed_number VARCHAR(20) UNIQUE NOT NULL,
                ward VARCHAR(100),
                room VARCHAR(50),
                status VARCHAR(20) DEFAULT 'available',
                patient_id INTEGER REFERENCES patients(id),
                admission_date TIMESTAMP,
                discharge_date TIMESTAMP,
                notes TEXT,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create appointments table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS appointments (
                id SERIAL PRIMARY KEY,
                patient_id INTEGER REFERENCES patients(id),
                doctor_id INTEGER REFERENCES users(id),
                appointment_date DATE,
                appointment_time TIME,
                duration INTEGER DEFAULT 30,
                status VARCHAR(20) DEFAULT 'scheduled',
                reason TEXT,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create lab_results table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS lab_results (
                id SERIAL PRIMARY KEY,
                patient_id INTEGER REFERENCES patients(id),
                test_name VARCHAR(255),
                test_date DATE DEFAULT CURRENT_DATE,
                results TEXT,
                normal_range VARCHAR(100),
                status VARCHAR(20) DEFAULT 'pending',
                ordered_by INTEGER REFERENCES users(id),
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create prescriptions table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS prescriptions (
                id SERIAL PRIMARY KEY,
                patient_id INTEGER REFERENCES patients(id),
                doctor_id INTEGER REFERENCES users(id),
                medication VARCHAR(255),
                dosage VARCHAR(100),
                frequency VARCHAR(100),
                duration VARCHAR(100),
                start_date DATE DEFAULT CURRENT_DATE,
                end_date DATE,
                instructions TEXT,
                status VARCHAR(20) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Insert sample admin user if not exists
        const adminCheck = await pool.query('SELECT * FROM users WHERE email = $1', ['admin@hospital.com']);
        if (adminCheck.rows.length === 0) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await pool.query(
                'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)',
                ['admin@hospital.com', hashedPassword, 'System Admin', 'admin']
            );
            console.log('Default admin user created');
        } else {
            // Update existing admin user password to ensure we can login
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await pool.query(
                'UPDATE users SET password_hash = $1 WHERE email = $2',
                [hashedPassword, 'admin@hospital.com']
            );
            console.log('Admin password updated');
        }

        // Insert sample data
        await insertSampleData();

        console.log('Database initialization complete');
    } catch (error) {
        console.error('Database initialization error:', error);
    }
}

// Insert sample data
async function insertSampleData() {
    try {
        // Check if we already have sample data
        const patientCheck = await pool.query('SELECT COUNT(*) FROM patients');
        if (parseInt(patientCheck.rows[0].count) > 0) {
            console.log('Sample data already exists');
            return;
        }

        // Insert sample patients
        await pool.query(`
            INSERT INTO patients (name, date_of_birth, gender, phone, email, blood_type, allergies)
            VALUES 
            ('John Doe', '1990-05-15', 'Male', '123-456-7890', 'john.doe@email.com', 'O+', 'None'),
            ('Jane Smith', '1985-08-22', 'Female', '987-654-3210', 'jane.smith@email.com', 'A+', 'Penicillin'),
            ('Bob Johnson', '1978-03-10', 'Male', '555-123-4567', 'bob.johnson@email.com', 'B+', 'Peanuts')
        `);

        // Insert sample inventory items
        await pool.query(`
            INSERT INTO inventory (item_name, category, quantity, unit, reorder_level, unit_price, supplier)
            VALUES 
            ('Paracetamol 500mg', 'Medication', 500, 'tablets', 100, 0.10, 'PharmaCo'),
            ('Surgical Gloves', 'Medical Supplies', 1000, 'pairs', 200, 0.50, 'MedSupply Inc'),
            ('Bandages', 'Medical Supplies', 300, 'rolls', 50, 2.00, 'MedSupply Inc'),
            ('Insulin', 'Medication', 50, 'vials', 20, 25.00, 'PharmaCo'),
            ('Face Masks', 'PPE', 2000, 'pieces', 500, 0.25, 'SafetyFirst'),
            ('Syringes', 'Medical Supplies', 500, 'pieces', 100, 0.30, 'MedSupply Inc'),
            ('Antibiotics', 'Medication', 5, 'bottles', 10, 15.00, 'PharmaCo'),
            ('Thermometer', 'Equipment', 3, 'pieces', 10, 35.00, 'MedTech')
        `);

        // Insert sample beds
        await pool.query(`
            INSERT INTO beds (bed_number, ward, room, status)
            VALUES 
            ('A101', 'General Ward', 'Room 101', 'available'),
            ('A102', 'General Ward', 'Room 101', 'available'),
            ('B201', 'ICU', 'Room 201', 'occupied'),
            ('B202', 'ICU', 'Room 201', 'available'),
            ('C301', 'Pediatric', 'Room 301', 'available'),
            ('C302', 'Pediatric', 'Room 301', 'maintenance')
        `);

        console.log('Sample data inserted successfully');
    } catch (error) {
        console.error('Error inserting sample data:', error);
    }
}

// ============================================
// AUTHENTICATION ENDPOINTS
// ============================================

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
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                department: user.department
            }
        });
        
        broadcast('user_login', { userName: user.name });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, name, role, department } = req.body;
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const result = await pool.query(
            'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role',
            [email, hashedPassword, name, role || 'staff']
        );
        
        res.json({
            success: true,
            user: result.rows[0]
        });
    } catch (error) {
        console.error('Registration error:', error);
        if (error.code === '23505') {
            res.status(400).json({ error: 'Email already exists' });
        } else {
            res.status(500).json({ error: 'Registration failed' });
        }
    }
});

// ============================================
// ELECTRONIC MEDICAL RECORDS ENDPOINTS
// ============================================

app.post('/api/emr/records', authenticateToken, async (req, res) => {
    try {
        const {
            patientId,
            diagnosis,
            symptoms,
            treatment,
            prescription,
            followUpDate,
            vitalSigns,
            notes
        } = req.body;

        const result = await pool.query(`
            INSERT INTO medical_records 
            (patient_id, doctor_id, diagnosis, symptoms, treatment, prescription, follow_up_date, vital_signs, notes)
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *`,
            [patientId, req.user.id, diagnosis, symptoms, treatment, prescription, followUpDate, vitalSigns, notes]
        );

        broadcast('new_medical_record', {
            patientId,
            doctorName: req.user.name
        });

        res.json({
            success: true,
            record: result.rows[0]
        });
    } catch (error) {
        console.error('Error creating medical record:', error);
        res.status(500).json({ error: 'Failed to create medical record' });
    }
});

app.get('/api/emr/records', authenticateToken, async (req, res) => {
    try {
        const { patientId } = req.query;
        
        let query = `
            SELECT mr.*, p.name as patient_name, u.name as doctor_name 
            FROM medical_records mr
            LEFT JOIN patients p ON mr.patient_id = p.id
            LEFT JOIN users u ON mr.doctor_id = u.id
            WHERE 1=1
        `;
        const params = [];
        
        if (patientId) {
            params.push(patientId);
            query += ` AND mr.patient_id = $${params.length}`;
        }
        
        query += ' ORDER BY mr.created_at DESC LIMIT 100';
        
        const result = await pool.query(query, params);
        
        res.json({
            success: true,
            records: result.rows
        });
    } catch (error) {
        console.error('Error fetching medical records:', error);
        res.status(500).json({ error: 'Failed to fetch medical records' });
    }
});

app.get('/api/patients', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                id::text as id,
                CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, '')) as name,
                first_name,
                last_name,
                date_of_birth,
                gender,
                phone,
                email,
                address,
                blood_group as blood_type,
                allergies,
                emergency_contact_name as emergency_contact
            FROM patients 
            ORDER BY first_name, last_name
        `);
        res.json({
            success: true,
            patients: result.rows
        });
    } catch (error) {
        console.error('Error fetching patients:', error);
        res.status(500).json({ error: 'Failed to fetch patients' });
    }
});

app.post('/api/patients', authenticateToken, async (req, res) => {
    try {
        const { name, dateOfBirth, gender, phone, email, address, bloodType, allergies, emergencyContact } = req.body;
        
        // Split name into first and last name
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
        
        res.json({
            success: true,
            patient: result.rows[0]
        });
    } catch (error) {
        console.error('Error creating patient:', error);
        res.status(500).json({ error: 'Failed to create patient' });
    }
});

// ============================================
// BILLING & REVENUE ENDPOINTS
// ============================================

app.post('/api/billing/create-invoice', authenticateToken, async (req, res) => {
    try {
        const { patientId, items, dueDate, paymentMethod } = req.body;
        
        // Generate invoice number
        const invoiceNumber = 'INV-' + Date.now();
        
        // Calculate totals
        let subtotal = 0;
        items.forEach(item => {
            subtotal += item.quantity * item.price;
        });
        const tax = subtotal * 0.1; // 10% tax
        const total = subtotal + tax;
        
        const result = await pool.query(`
            INSERT INTO invoices (patient_id, invoice_number, due_date, items, subtotal, tax, total, payment_method)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *`,
            [patientId, invoiceNumber, dueDate, JSON.stringify(items), subtotal, tax, total, paymentMethod]
        );
        
        broadcast('new_invoice', {
            invoiceNumber,
            total
        });
        
        res.json({
            success: true,
            invoice: result.rows[0]
        });
    } catch (error) {
        console.error('Error creating invoice:', error);
        res.status(500).json({ error: 'Failed to create invoice' });
    }
});

app.get('/api/billing/invoices', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT i.*, p.name as patient_name 
            FROM invoices i
            LEFT JOIN patients p ON i.patient_id = p.id
            ORDER BY i.created_at DESC
            LIMIT 100
        `);
        
        res.json({
            success: true,
            invoices: result.rows
        });
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
        
        broadcast('invoice_paid', {
            invoiceId: id,
            invoiceNumber: result.rows[0].invoice_number
        });
        
        res.json({
            success: true,
            invoice: result.rows[0]
        });
    } catch (error) {
        console.error('Error paying invoice:', error);
        res.status(500).json({ error: 'Failed to process payment' });
    }
});

// ============================================
// INVENTORY MANAGEMENT ENDPOINTS
// ============================================

app.post('/api/inventory/add-stock', authenticateToken, async (req, res) => {
    try {
        const { itemName, category, quantity, unit, reorderLevel, unitPrice, supplier, expiryDate } = req.body;
        
        // Check if item exists
        const existing = await pool.query('SELECT * FROM inventory WHERE item_name = $1', [itemName]);
        
        if (existing.rows.length > 0) {
            // Update existing item
            const result = await pool.query(`
                UPDATE inventory 
                SET quantity = quantity + $1, last_updated = CURRENT_TIMESTAMP
                WHERE item_name = $2
                RETURNING *`,
                [quantity, itemName]
            );
            
            broadcast('inventory_updated', {
                itemName,
                newQuantity: result.rows[0].quantity
            });
            
            res.json({
                success: true,
                item: result.rows[0]
            });
        } else {
            // Insert new item
            const result = await pool.query(`
                INSERT INTO inventory (item_name, category, quantity, unit, reorder_level, unit_price, supplier, expiry_date)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *`,
                [itemName, category, quantity, unit, reorderLevel, unitPrice, supplier, expiryDate]
            );
            
            broadcast('new_inventory_item', {
                itemName,
                quantity
            });
            
            res.json({
                success: true,
                item: result.rows[0]
            });
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
        
        res.json({
            success: true,
            items: result.rows
        });
    } catch (error) {
        console.error('Error fetching low stock items:', error);
        res.status(500).json({ error: 'Failed to fetch low stock items' });
    }
});

app.get('/api/inventory', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM inventory ORDER BY item_name');
        
        res.json({
            success: true,
            items: result.rows
        });
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
            return res.status(400).json({ error: 'Insufficient quantity or item not found' });
        }
        
        // Check if low stock
        const item = result.rows[0];
        if (item.quantity <= item.reorder_level) {
            broadcast('low_stock_alert', {
                itemName: item.item_name,
                currentQuantity: item.quantity,
                reorderLevel: item.reorder_level
            });
        }
        
        res.json({
            success: true,
            item: result.rows[0]
        });
    } catch (error) {
        console.error('Error using inventory item:', error);
        res.status(500).json({ error: 'Failed to use inventory item' });
    }
});

// ============================================
// STAFF MANAGEMENT ENDPOINTS
// ============================================

app.post('/api/staff/schedule', authenticateToken, async (req, res) => {
    try {
        const { staffId, date, shiftStart, shiftEnd, department, notes } = req.body;
        
        const result = await pool.query(`
            INSERT INTO staff_schedules (staff_id, date, shift_start, shift_end, department, notes)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *`,
            [staffId, date, shiftStart, shiftEnd, department, notes]
        );
        
        broadcast('new_schedule', {
            staffId,
            date
        });
        
        res.json({
            success: true,
            schedule: result.rows[0]
        });
    } catch (error) {
        console.error('Error creating schedule:', error);
        res.status(500).json({ error: 'Failed to create schedule' });
    }
});

app.get('/api/staff/schedule', authenticateToken, async (req, res) => {
    try {
        const { date, staffId } = req.query;
        
        let query = `
            SELECT s.*, u.name as staff_name, u.department
            FROM staff_schedules s
            LEFT JOIN users u ON s.staff_id = u.id
            WHERE 1=1
        `;
        const params = [];
        
        if (date) {
            params.push(date);
            query += ` AND s.date = $${params.length}`;
        }
        
        if (staffId) {
            params.push(staffId);
            query += ` AND s.staff_id = $${params.length}`;
        }
        
        query += ' ORDER BY s.date DESC, s.shift_start ASC LIMIT 100';
        
        const result = await pool.query(query, params);
        
        res.json({
            success: true,
            schedules: result.rows
        });
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
        
        res.json({
            success: true,
            staff: result.rows
        });
    } catch (error) {
        console.error('Error fetching staff:', error);
        res.status(500).json({ error: 'Failed to fetch staff' });
    }
});

// ============================================
// BED MANAGEMENT ENDPOINTS
// ============================================

app.post('/api/beds/admit', authenticateToken, async (req, res) => {
    try {
        const { bedId, patientId, notes } = req.body;
        
        const result = await pool.query(`
            UPDATE beds 
            SET status = 'occupied', patient_id = $1, admission_date = CURRENT_TIMESTAMP, notes = $2
            WHERE id = $3 AND status = 'available'
            RETURNING *`,
            [patientId, notes, bedId]
        );
        
        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Bed not available' });
        }
        
        broadcast('bed_admission', {
            bedNumber: result.rows[0].bed_number,
            patientId
        });
        
        res.json({
            success: true,
            bed: result.rows[0]
        });
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
        
        res.json({
            success: true,
            beds: result.rows
        });
    } catch (error) {
        console.error('Error fetching available beds:', error);
        res.status(500).json({ error: 'Failed to fetch available beds' });
    }
});

app.get('/api/beds', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT b.*, p.name as patient_name 
            FROM beds b
            LEFT JOIN patients p ON b.patient_id = p.id
            ORDER BY b.ward, b.bed_number
        `);
        
        res.json({
            success: true,
            beds: result.rows
        });
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
            SET status = 'available', patient_id = NULL, discharge_date = CURRENT_TIMESTAMP, last_updated = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING *`,
            [bedId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Bed not found' });
        }
        
        broadcast('bed_discharge', {
            bedNumber: result.rows[0].bed_number
        });
        
        res.json({
            success: true,
            bed: result.rows[0]
        });
    } catch (error) {
        console.error('Error discharging patient:', error);
        res.status(500).json({ error: 'Failed to discharge patient' });
    }
});

// ============================================
// ANALYTICS ENDPOINTS
// ============================================

app.get('/api/analytics/dashboard', authenticateToken, async (req, res) => {
    try {
        // Get various metrics - using safe defaults for missing tables/columns
        const metrics = {};
        
        try {
            const totalPatients = await pool.query('SELECT COUNT(*) FROM patients');
            metrics.totalPatients = parseInt(totalPatients.rows[0].count);
        } catch (e) {
            metrics.totalPatients = 0;
        }
        
        try {
            const totalStaff = await pool.query('SELECT COUNT(*) FROM users');
            metrics.totalStaff = parseInt(totalStaff.rows[0].count);
        } catch (e) {
            metrics.totalStaff = 0;
        }
        
        try {
            const occupiedBeds = await pool.query('SELECT COUNT(*) FROM beds WHERE status = $1', ['occupied']);
            metrics.occupiedBeds = parseInt(occupiedBeds.rows[0].count);
        } catch (e) {
            metrics.occupiedBeds = 0;
        }
        
        try {
            const totalBeds = await pool.query('SELECT COUNT(*) FROM beds');
            metrics.totalBeds = parseInt(totalBeds.rows[0].count);
        } catch (e) {
            metrics.totalBeds = 0;
        }
        
        try {
            const pendingInvoices = await pool.query('SELECT COUNT(*) FROM invoices WHERE status = $1', ['pending']);
            metrics.pendingInvoices = parseInt(pendingInvoices.rows[0].count);
        } catch (e) {
            metrics.pendingInvoices = 0;
        }
        
        try {
            const totalRevenue = await pool.query('SELECT SUM(total) FROM invoices WHERE status = $1', ['paid']);
            metrics.totalRevenue = parseFloat(totalRevenue.rows[0].sum || 0);
        } catch (e) {
            metrics.totalRevenue = 0;
        }
        
        try {
            const lowStockItems = await pool.query('SELECT COUNT(*) FROM inventory WHERE quantity <= reorder_level');
            metrics.lowStockItems = parseInt(lowStockItems.rows[0].count);
        } catch (e) {
            metrics.lowStockItems = 0;
        }
        
        try {
            const todayAppointments = await pool.query('SELECT COUNT(*) FROM appointments WHERE DATE(created_at) = CURRENT_DATE');
            metrics.todayAppointments = parseInt(todayAppointments.rows[0].count);
        } catch (e) {
            metrics.todayAppointments = 0;
        }
        
        metrics.occupancyRate = metrics.totalBeds > 0 
            ? parseFloat((metrics.occupiedBeds / metrics.totalBeds * 100).toFixed(1))
            : 0;
        
        res.json({
            success: true,
            metrics
        });
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});

app.get('/api/analytics/export', authenticateToken, async (req, res) => {
    try {
        const { reportType } = req.query;
        
        // Create PDF report
        const doc = new PDFDocument();
        const filename = `report-${reportType}-${Date.now()}.pdf`;
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        doc.pipe(res);
        
        // Add content to PDF
        doc.fontSize(20).text('Hospital Management System Report', 50, 50);
        doc.fontSize(14).text(`Report Type: ${reportType || 'General'}`, 50, 80);
        doc.fontSize(12).text(`Generated: ${new Date().toLocaleString()}`, 50, 100);
        
        // Add report data based on type
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
        } else if (reportType === 'financial') {
            const revenue = await pool.query('SELECT SUM(total) as revenue, COUNT(*) as count FROM invoices WHERE status = $1', ['paid']);
            doc.fontSize(16).text('Financial Report', 50, 140);
            doc.fontSize(12).text(`Total Revenue: $${revenue.rows[0].revenue || 0}`, 50, 170);
            doc.fontSize(12).text(`Paid Invoices: ${revenue.rows[0].count}`, 50, 190);
        }
        
        doc.end();
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

// ============================================
// APPOINTMENTS ENDPOINTS
// ============================================

app.post('/api/appointments', authenticateToken, async (req, res) => {
    try {
        const { patientId, doctorId, appointmentDate, appointmentTime, duration, reason, notes } = req.body;
        
        const result = await pool.query(`
            INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, duration, reason, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *`,
            [patientId, doctorId, appointmentDate, appointmentTime, duration || 30, reason, notes]
        );
        
        broadcast('new_appointment', {
            patientId,
            doctorId,
            date: appointmentDate
        });
        
        res.json({
            success: true,
            appointment: result.rows[0]
        });
    } catch (error) {
        console.error('Error creating appointment:', error);
        res.status(500).json({ error: 'Failed to create appointment' });
    }
});

app.get('/api/appointments', authenticateToken, async (req, res) => {
    try {
        const { date, doctorId } = req.query;
        
        let query = `
            SELECT a.*, p.name as patient_name, u.name as doctor_name
            FROM appointments a
            LEFT JOIN patients p ON a.patient_id = p.id
            LEFT JOIN users u ON a.doctor_id = u.id
            WHERE 1=1
        `;
        const params = [];
        
        if (date) {
            params.push(date);
            query += ` AND a.appointment_date = $${params.length}`;
        }
        
        if (doctorId) {
            params.push(doctorId);
            query += ` AND a.doctor_id = $${params.length}`;
        }
        
        query += ' ORDER BY a.appointment_date, a.appointment_time';
        
        const result = await pool.query(query, params);
        
        res.json({
            success: true,
            appointments: result.rows
        });
    } catch (error) {
        console.error('Error fetching appointments:', error);
        res.status(500).json({ error: 'Failed to fetch appointments' });
    }
});

// ============================================
// LAB RESULTS ENDPOINTS
// ============================================

app.post('/api/lab-results', authenticateToken, async (req, res) => {
    try {
        const { patientId, testName, results, normalRange, notes } = req.body;
        
        const result = await pool.query(`
            INSERT INTO lab_results (patient_id, test_name, results, normal_range, ordered_by, notes, status)
            VALUES ($1, $2, $3, $4, $5, $6, 'completed')
            RETURNING *`,
            [patientId, testName, results, normalRange, req.user.id, notes]
        );
        
        broadcast('lab_results_ready', {
            patientId,
            testName
        });
        
        res.json({
            success: true,
            labResult: result.rows[0]
        });
    } catch (error) {
        console.error('Error creating lab results:', error);
        res.status(500).json({ error: 'Failed to create lab results' });
    }
});

app.get('/api/lab-results', authenticateToken, async (req, res) => {
    try {
        const { patientId } = req.query;
        
        let query = `
            SELECT lr.*, p.name as patient_name, u.name as ordered_by_name
            FROM lab_results lr
            LEFT JOIN patients p ON lr.patient_id = p.id
            LEFT JOIN users u ON lr.ordered_by = u.id
            WHERE 1=1
        `;
        const params = [];
        
        if (patientId) {
            params.push(patientId);
            query += ` AND lr.patient_id = $${params.length}`;
        }
        
        query += ' ORDER BY lr.test_date DESC';
        
        const result = await pool.query(query, params);
        
        res.json({
            success: true,
            results: result.rows
        });
    } catch (error) {
        console.error('Error fetching lab results:', error);
        res.status(500).json({ error: 'Failed to fetch lab results' });
    }
});

// ============================================
// PRESCRIPTIONS ENDPOINTS
// ============================================

app.post('/api/prescriptions', authenticateToken, async (req, res) => {
    try {
        const { patientId, medication, dosage, frequency, duration, startDate, endDate, instructions } = req.body;
        
        const result = await pool.query(`
            INSERT INTO prescriptions 
            (patient_id, doctor_id, medication, dosage, frequency, duration, start_date, end_date, instructions)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *`,
            [patientId, req.user.id, medication, dosage, frequency, duration, startDate, endDate, instructions]
        );
        
        broadcast('new_prescription', {
            patientId,
            medication
        });
        
        res.json({
            success: true,
            prescription: result.rows[0]
        });
    } catch (error) {
        console.error('Error creating prescription:', error);
        res.status(500).json({ error: 'Failed to create prescription' });
    }
});

app.get('/api/prescriptions', authenticateToken, async (req, res) => {
    try {
        const { patientId } = req.query;
        
        let query = `
            SELECT pr.*, p.name as patient_name, u.name as doctor_name
            FROM prescriptions pr
            LEFT JOIN patients p ON pr.patient_id = p.id
            LEFT JOIN users u ON pr.doctor_id = u.id
            WHERE 1=1
        `;
        const params = [];
        
        if (patientId) {
            params.push(patientId);
            query += ` AND pr.patient_id = $${params.length}`;
        }
        
        query += ' ORDER BY pr.created_at DESC';
        
        const result = await pool.query(query, params);
        
        res.json({
            success: true,
            prescriptions: result.rows
        });
    } catch (error) {
        console.error('Error fetching prescriptions:', error);
        res.status(500).json({ error: 'Failed to fetch prescriptions' });
    }
});

// ============================================
// HEALTH CHECK & STATUS ENDPOINTS
// ============================================

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
        res.status(500).json({
            status: 'error',
            database: 'disconnected',
            error: error.message
        });
    }
});

// ============================================
// SERVER INITIALIZATION
// ============================================

const PORT = process.env.PORT || 5700;

async function startServer() {
    try {
        await initializeDatabase();
        
        server.listen(PORT, () => {
            console.log(`\n========================================`);
            console.log(`Hospital Management System Backend`);
            console.log(`========================================`);
            console.log(`Server running on port ${PORT}`);
            console.log(`WebSocket server ready`);
            console.log(`Database connected to Neon PostgreSQL`);
            console.log(`\nDefault login credentials:`);
            console.log(`Email: admin@hospital.com`);
            console.log(`Password: admin123`);
            console.log(`========================================\n`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing server...');
    server.close(() => {
        pool.end();
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, closing server...');
    server.close(() => {
        pool.end();
        process.exit(0);
    });
});

// Start the server
startServer();

module.exports = app;
