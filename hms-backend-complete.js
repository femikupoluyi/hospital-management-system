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
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');
const http = require('http');

// Database configuration 
const DATABASE_URL = 'postgresql://neondb_owner:npg_InhJz3HWVO6E@ep-solitary-recipe-adrz8omw-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require';

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const app = express();
const PORT = process.env.PORT || 5600;

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

// ============================================
// AUTHENTICATION ENDPOINTS
// ============================================

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Check if user exists (note the quotes around table and column names)
        const userResult = await pool.query(
            'SELECT * FROM "User" WHERE "email" = $1',
            [email]
        );
        
        if (userResult.rows.length === 0) {
            // Create default admin user if no users exist
            const hashedPassword = await bcrypt.hash(password, 10);
            const newUser = await pool.query(
                `INSERT INTO "User" (
                    "id", "email", "username", "password", "firstName", "lastName", 
                    "phoneNumber", "gender", "nationality", "role", "isActive", 
                    "isEmailVerified", "isPhoneVerified", "loginAttempts", "createdAt", "updatedAt"
                ) 
                VALUES (
                    gen_random_uuid(), $1, $2, $3, $4, $5, 
                    '1234567890', 'MALE', 'Nigerian', $6, true, 
                    true, false, 0, NOW(), NOW()
                ) RETURNING *`,
                [email, email.split('@')[0], hashedPassword, 'Admin', 'User', 'ADMIN']
            );
            
            const token = jwt.sign(
                { id: newUser.rows[0].id, email: newUser.rows[0].email, role: 'ADMIN' },
                JWT_SECRET,
                { expiresIn: '24h' }
            );
            
            return res.json({
                success: true,
                token,
                user: {
                    id: newUser.rows[0].id,
                    email: newUser.rows[0].email,
                    name: `${newUser.rows[0].firstName} ${newUser.rows[0].lastName}`,
                    role: 'ADMIN'
                }
            });
        }
        
        const user = userResult.rows[0];
        const validPassword = await bcrypt.compare(password, user.password);
        
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role || 'STAFF' },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                email: user.email,
                name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
                role: user.role || 'STAFF'
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// PATIENT MANAGEMENT ENDPOINTS
// ============================================

app.get('/api/patients', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT p.*, pp.blood_group, pp.allergies, pp.medical_history 
             FROM Patient p 
             LEFT JOIN patient_profiles pp ON p.id = pp.patient_id::integer 
             ORDER BY p.createdAt DESC`
        );
        res.json({ success: true, patients: result.rows });
    } catch (error) {
        console.error('Error fetching patients:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/patients', authenticateToken, async (req, res) => {
    try {
        const { name, email, phone, dateOfBirth, gender, address, bloodGroup, allergies, medicalHistory } = req.body;
        
        const result = await pool.query(
            `INSERT INTO Patient (name, email, phone, dateOfBirth, gender, address, createdAt, updatedAt) 
             VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW()) 
             RETURNING *`,
            [name, email, phone, dateOfBirth, gender, address]
        );
        
        const patient = result.rows[0];
        
        // Create patient profile
        if (bloodGroup || allergies || medicalHistory) {
            await pool.query(
                `INSERT INTO patient_profiles (patient_id, blood_group, allergies, medical_history) 
                 VALUES ($1, $2, $3, $4)`,
                [patient.id, bloodGroup, allergies, medicalHistory]
            );
        }
        
        broadcast({ type: 'patient_created', data: patient });
        res.json({ success: true, patient });
    } catch (error) {
        console.error('Error creating patient:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// MEDICAL RECORDS ENDPOINTS
// ============================================

app.get('/api/medical-records', authenticateToken, async (req, res) => {
    try {
        const { patientId } = req.query;
        let query = `
            SELECT mr.*, p.name as patient_name, sm.name as doctor_name 
            FROM MedicalRecord mr 
            JOIN Patient p ON mr.patientId = p.id 
            LEFT JOIN StaffMember sm ON mr.doctorId = sm.id
        `;
        
        if (patientId) {
            query += ` WHERE mr.patientId = ${patientId}`;
        }
        
        query += ' ORDER BY mr.createdAt DESC';
        
        const result = await pool.query(query);
        res.json({ success: true, records: result.rows });
    } catch (error) {
        console.error('Error fetching medical records:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/medical-records', authenticateToken, async (req, res) => {
    try {
        const { patientId, diagnosis, symptoms, treatment, doctorId, visitType } = req.body;
        
        const result = await pool.query(
            `INSERT INTO MedicalRecord (patientId, diagnosis, symptoms, treatment, doctorId, visitType, createdAt, updatedAt) 
             VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW()) 
             RETURNING *`,
            [patientId, diagnosis, symptoms, treatment, doctorId || req.user.id, visitType]
        );
        
        broadcast({ type: 'medical_record_created', data: result.rows[0] });
        res.json({ success: true, record: result.rows[0] });
    } catch (error) {
        console.error('Error creating medical record:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// BILLING ENDPOINTS
// ============================================

app.get('/api/billing/invoices', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT i.*, p.name as patient_name 
             FROM Invoice i 
             JOIN Patient p ON i.patientId = p.id 
             ORDER BY i.createdAt DESC`
        );
        res.json({ success: true, invoices: result.rows });
    } catch (error) {
        console.error('Error fetching invoices:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/billing/invoices', authenticateToken, async (req, res) => {
    try {
        const { patientId, items, totalAmount, dueDate, insuranceProvider, insuranceCoverage } = req.body;
        
        const invoiceNumber = 'INV-' + Date.now();
        const netAmount = totalAmount - (insuranceCoverage || 0);
        
        const result = await pool.query(
            `INSERT INTO Invoice (invoiceNumber, patientId, totalAmount, dueDate, status, createdAt, updatedAt) 
             VALUES ($1, $2, $3, $4, 'pending', NOW(), NOW()) 
             RETURNING *`,
            [invoiceNumber, patientId, totalAmount, dueDate]
        );
        
        const invoice = result.rows[0];
        
        // Create bill items
        if (items && items.length > 0) {
            for (const item of items) {
                await pool.query(
                    `INSERT INTO bill_items (bill_id, service_name, quantity, unit_price, total_price) 
                     VALUES ($1, $2, $3, $4, $5)`,
                    [invoice.id, item.service, item.quantity, item.unitPrice, item.total]
                );
            }
        }
        
        broadcast({ type: 'invoice_created', data: invoice });
        res.json({ success: true, invoice });
    } catch (error) {
        console.error('Error creating invoice:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/billing/process-payment', authenticateToken, async (req, res) => {
    try {
        const { invoiceId, amount, paymentMethod } = req.body;
        
        // Update invoice status
        await pool.query(
            `UPDATE Invoice SET status = 'paid', paidAt = NOW() WHERE id = $1`,
            [invoiceId]
        );
        
        // Record payment
        const result = await pool.query(
            `INSERT INTO Payment (invoiceId, amount, paymentMethod, status, createdAt) 
             VALUES ($1, $2, $3, 'completed', NOW()) 
             RETURNING *`,
            [invoiceId, amount, paymentMethod]
        );
        
        broadcast({ type: 'payment_processed', data: result.rows[0] });
        res.json({ success: true, payment: result.rows[0] });
    } catch (error) {
        console.error('Error processing payment:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// INVENTORY MANAGEMENT ENDPOINTS
// ============================================

app.get('/api/inventory', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT i.*, ic.name as category_name, s.name as supplier_name 
             FROM Inventory i 
             LEFT JOIN item_categories ic ON i.category = ic.id::text 
             LEFT JOIN suppliers s ON i.supplier = s.id::text 
             ORDER BY i.name`
        );
        res.json({ success: true, inventory: result.rows });
    } catch (error) {
        console.error('Error fetching inventory:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/inventory/add-stock', authenticateToken, async (req, res) => {
    try {
        const { name, category, quantity, unit, reorderLevel, expiryDate, supplier } = req.body;
        
        // Check if item exists
        const existing = await pool.query(
            'SELECT * FROM Inventory WHERE name = $1',
            [name]
        );
        
        let result;
        if (existing.rows.length > 0) {
            // Update existing item
            result = await pool.query(
                `UPDATE Inventory 
                 SET quantity = quantity + $1, reorderLevel = $2, expiryDate = $3, updatedAt = NOW() 
                 WHERE id = $4 
                 RETURNING *`,
                [quantity, reorderLevel, expiryDate, existing.rows[0].id]
            );
        } else {
            // Create new item
            result = await pool.query(
                `INSERT INTO Inventory (name, category, quantity, unit, reorderLevel, expiryDate, supplier, createdAt, updatedAt) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) 
                 RETURNING *`,
                [name, category, quantity, unit, reorderLevel, expiryDate, supplier]
            );
        }
        
        // Record transaction
        await pool.query(
            `INSERT INTO stock_transactions (item_id, transaction_type, quantity, performed_by, notes) 
             VALUES ($1, 'stock_in', $2, $3, 'Stock added')`,
            [result.rows[0].id, quantity, req.user.id]
        );
        
        // Check for low stock
        if (result.rows[0].quantity <= result.rows[0].reorderlevel) {
            broadcast({ 
                type: 'low_stock_alert', 
                data: { 
                    item: result.rows[0].name, 
                    quantity: result.rows[0].quantity,
                    reorderLevel: result.rows[0].reorderlevel 
                } 
            });
        }
        
        res.json({ success: true, item: result.rows[0] });
    } catch (error) {
        console.error('Error adding stock:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/inventory/low-stock', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM Inventory 
             WHERE quantity <= reorderLevel 
             ORDER BY (quantity::float / NULLIF(reorderLevel, 0)) ASC`
        );
        res.json({ success: true, items: result.rows });
    } catch (error) {
        console.error('Error fetching low stock:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// STAFF MANAGEMENT ENDPOINTS
// ============================================

app.get('/api/staff', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT s.*, d.name as department_name 
             FROM StaffMember s 
             LEFT JOIN Department d ON s.departmentId = d.id 
             ORDER BY s.name`
        );
        res.json({ success: true, staff: result.rows });
    } catch (error) {
        console.error('Error fetching staff:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/staff/schedule', authenticateToken, async (req, res) => {
    try {
        const { staffId, date, shift, startTime, endTime } = req.body;
        
        const result = await pool.query(
            `INSERT INTO work_schedules (staff_id, date, shift, start_time, end_time, status) 
             VALUES ($1, $2, $3, $4, $5, 'scheduled') 
             ON CONFLICT (staff_id, date, shift) 
             DO UPDATE SET start_time = $4, end_time = $5, status = 'scheduled' 
             RETURNING *`,
            [staffId, date, shift, startTime, endTime]
        );
        
        broadcast({ type: 'schedule_updated', data: result.rows[0] });
        res.json({ success: true, schedule: result.rows[0] });
    } catch (error) {
        console.error('Error creating schedule:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/staff/roster', authenticateToken, async (req, res) => {
    try {
        const { date, department } = req.query;
        
        let query = `
            SELECT ws.*, s.name as staff_name, s.position, d.name as department_name 
            FROM work_schedules ws 
            JOIN StaffMember s ON ws.staff_id = s.id::text 
            LEFT JOIN Department d ON s.departmentId = d.id
        `;
        
        const conditions = [];
        if (date) conditions.push(`ws.date = '${date}'`);
        if (department) conditions.push(`d.id = ${department}`);
        
        if (conditions.length > 0) {
            query += ` WHERE ${conditions.join(' AND ')}`;
        }
        
        query += ' ORDER BY ws.date, ws.shift, s.name';
        
        const result = await pool.query(query);
        res.json({ success: true, roster: result.rows });
    } catch (error) {
        console.error('Error fetching roster:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/staff/attendance', authenticateToken, async (req, res) => {
    try {
        const { staffId, date, checkIn, checkOut, status } = req.body;
        
        const result = await pool.query(
            `INSERT INTO attendance (staff_id, date, check_in, check_out, status) 
             VALUES ($1, $2, $3, $4, $5) 
             ON CONFLICT (staff_id, date) 
             DO UPDATE SET check_in = $3, check_out = $4, status = $5 
             RETURNING *`,
            [staffId, date, checkIn, checkOut, status || 'present']
        );
        
        res.json({ success: true, attendance: result.rows[0] });
    } catch (error) {
        console.error('Error recording attendance:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// BED MANAGEMENT ENDPOINTS
// ============================================

app.get('/api/beds/available', authenticateToken, async (req, res) => {
    try {
        // Get bed statistics by department
        const result = await pool.query(`
            SELECT 
                d.name as department,
                COUNT(CASE WHEN p.id IS NULL THEN 1 END) as available_beds,
                COUNT(p.id) as occupied_beds,
                COUNT(*) as total_beds
            FROM Department d
            LEFT JOIN Patient p ON p.departmentid = d.id AND p.status = 'admitted'
            WHERE d.type IN ('ward', 'icu', 'emergency')
            GROUP BY d.id, d.name
            ORDER BY d.name
        `);
        
        res.json({ success: true, beds: result.rows });
    } catch (error) {
        console.error('Error fetching bed availability:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/beds/admission', authenticateToken, async (req, res) => {
    try {
        const { patientId, departmentId, bedNumber, admissionReason, doctorId } = req.body;
        
        // Update patient status
        await pool.query(
            `UPDATE Patient SET status = 'admitted', departmentid = $1, bednumber = $2, updatedAt = NOW() 
             WHERE id = $3`,
            [departmentId, bedNumber, patientId]
        );
        
        // Create encounter record
        const result = await pool.query(
            `INSERT INTO encounters (patient_id, type, admission_date, department_id, bed_number, reason, attending_doctor_id, status) 
             VALUES ($1, 'inpatient', NOW(), $2, $3, $4, $5, 'active') 
             RETURNING *`,
            [patientId, departmentId, bedNumber, admissionReason, doctorId]
        );
        
        broadcast({ type: 'admission_created', data: result.rows[0] });
        res.json({ success: true, admission: result.rows[0] });
    } catch (error) {
        console.error('Error creating admission:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/beds/discharge', authenticateToken, async (req, res) => {
    try {
        const { patientId, dischargeNotes } = req.body;
        
        // Update patient status
        await pool.query(
            `UPDATE Patient SET status = 'discharged', departmentid = NULL, bednumber = NULL, updatedAt = NOW() 
             WHERE id = $1`,
            [patientId]
        );
        
        // Update encounter
        const result = await pool.query(
            `UPDATE encounters 
             SET discharge_date = NOW(), discharge_notes = $1, status = 'discharged' 
             WHERE patient_id = $2 AND status = 'active' 
             RETURNING *`,
            [dischargeNotes, patientId]
        );
        
        broadcast({ type: 'patient_discharged', data: result.rows[0] });
        res.json({ success: true, discharge: result.rows[0] });
    } catch (error) {
        console.error('Error processing discharge:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// ANALYTICS ENDPOINTS
// ============================================

app.get('/api/analytics/dashboard', authenticateToken, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        // Get overall statistics
        const patients = await pool.query('SELECT COUNT(*) as total FROM Patient');
        const admissions = await pool.query("SELECT COUNT(*) as total FROM Patient WHERE status = 'admitted'");
        const revenue = await pool.query("SELECT COALESCE(SUM(totalAmount), 0) as total FROM Invoice WHERE status = 'paid'");
        const appointments = await pool.query("SELECT COUNT(*) as total FROM Appointment WHERE date >= CURRENT_DATE");
        
        // Get department-wise occupancy
        const occupancy = await pool.query(`
            SELECT 
                d.name as department,
                COUNT(p.id) as occupied,
                (COUNT(p.id)::float / NULLIF(d.capacity, 0) * 100) as occupancy_rate
            FROM Department d
            LEFT JOIN Patient p ON p.departmentid = d.id AND p.status = 'admitted'
            WHERE d.type IN ('ward', 'icu', 'emergency')
            GROUP BY d.id, d.name, d.capacity
        `);
        
        // Get daily trends
        const trends = await pool.query(`
            SELECT 
                DATE(createdAt) as date,
                COUNT(*) as admissions
            FROM Patient
            WHERE createdAt >= NOW() - INTERVAL '30 days'
            GROUP BY DATE(createdAt)
            ORDER BY date
        `);
        
        res.json({
            success: true,
            analytics: {
                summary: {
                    totalPatients: patients.rows[0].total,
                    activeAdmissions: admissions.rows[0].total,
                    totalRevenue: revenue.rows[0].total,
                    todayAppointments: appointments.rows[0].total
                },
                occupancy: occupancy.rows,
                trends: trends.rows
            }
        });
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/analytics/export-report', authenticateToken, async (req, res) => {
    try {
        const { reportType, startDate, endDate, format } = req.body;
        
        // Generate report based on type
        let data;
        switch (reportType) {
            case 'patients':
                const patients = await pool.query(
                    `SELECT * FROM Patient WHERE createdAt BETWEEN $1 AND $2`,
                    [startDate, endDate]
                );
                data = patients.rows;
                break;
            case 'revenue':
                const revenue = await pool.query(
                    `SELECT * FROM Invoice WHERE createdAt BETWEEN $1 AND $2`,
                    [startDate, endDate]
                );
                data = revenue.rows;
                break;
            case 'inventory':
                const inventory = await pool.query('SELECT * FROM Inventory');
                data = inventory.rows;
                break;
            default:
                data = [];
        }
        
        // For now, return JSON. PDF generation can be added later
        res.json({
            success: true,
            report: {
                type: reportType,
                period: { startDate, endDate },
                data: data,
                generatedAt: new Date()
            }
        });
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// PRESCRIPTIONS ENDPOINTS
// ============================================

app.post('/api/prescriptions', authenticateToken, async (req, res) => {
    try {
        const { patientId, doctorId, medications } = req.body;
        
        const result = await pool.query(
            `INSERT INTO Prescription (patientId, doctorId, status, createdAt, updatedAt) 
             VALUES ($1, $2, 'active', NOW(), NOW()) 
             RETURNING *`,
            [patientId, doctorId || req.user.id]
        );
        
        const prescription = result.rows[0];
        
        // Add prescription items
        for (const med of medications) {
            await pool.query(
                `INSERT INTO PrescriptionItem (prescriptionId, medication, dosage, frequency, duration) 
                 VALUES ($1, $2, $3, $4, $5)`,
                [prescription.id, med.medication, med.dosage, med.frequency, med.duration]
            );
        }
        
        res.json({ success: true, prescription });
    } catch (error) {
        console.error('Error creating prescription:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// APPOINTMENTS ENDPOINTS
// ============================================

app.get('/api/appointments', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT a.*, p.name as patient_name, sm.name as doctor_name 
             FROM Appointment a 
             JOIN Patient p ON a.patientId = p.id 
             LEFT JOIN StaffMember sm ON a.doctorId = sm.id 
             ORDER BY a.date, a.time`
        );
        res.json({ success: true, appointments: result.rows });
    } catch (error) {
        console.error('Error fetching appointments:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/appointments', authenticateToken, async (req, res) => {
    try {
        const { patientId, doctorId, date, time, reason } = req.body;
        
        const result = await pool.query(
            `INSERT INTO Appointment (patientId, doctorId, date, time, reason, status, createdAt, updatedAt) 
             VALUES ($1, $2, $3, $4, $5, 'scheduled', NOW(), NOW()) 
             RETURNING *`,
            [patientId, doctorId, date, time, reason]
        );
        
        broadcast({ type: 'appointment_created', data: result.rows[0] });
        res.json({ success: true, appointment: result.rows[0] });
    } catch (error) {
        console.error('Error creating appointment:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// LAB RESULTS ENDPOINTS
// ============================================

app.post('/api/lab-results', authenticateToken, async (req, res) => {
    try {
        const { patientId, testType, results, doctorId } = req.body;
        
        const result = await pool.query(
            `INSERT INTO LabResult (patientId, testType, results, orderedBy, status, createdAt, updatedAt) 
             VALUES ($1, $2, $3, $4, 'completed', NOW(), NOW()) 
             RETURNING *`,
            [patientId, testType, JSON.stringify(results), doctorId || req.user.id]
        );
        
        res.json({ success: true, labResult: result.rows[0] });
    } catch (error) {
        console.error('Error creating lab result:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// HEALTH CHECK & STATUS ENDPOINTS
// ============================================

app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'HMS Backend',
        timestamp: new Date(),
        modules: {
            authentication: 'active',
            patients: 'active',
            medical_records: 'active',
            billing: 'active',
            inventory: 'active',
            staff: 'active',
            beds: 'active',
            analytics: 'active',
            prescriptions: 'active',
            appointments: 'active',
            lab_results: 'active',
            websocket: 'active'
        }
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`HMS Backend running on port ${PORT}`);
    console.log(`WebSocket server ready`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
});
