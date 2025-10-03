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

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// Ensure contracts directory exists
if (!fs.existsSync('contracts')) {
    fs.mkdirSync('contracts');
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use('/contracts', express.static('contracts'));

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

// ============ DIGITAL SOURCING & PARTNER ONBOARDING (FIXED) ============
app.post('/api/onboarding/application', upload.array('documents', 10), async (req, res) => {
    try {
        const { hospital_name, owner_name, owner_email, owner_phone, address, bed_capacity, specialties } = req.body;
        
        // Use simple_hospital_applications table
        const application = await pool.query(
            `INSERT INTO simple_hospital_applications (hospital_name, owner_name, owner_email, owner_phone, address, bed_capacity, specialties, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NOW())
             RETURNING *`,
            [hospital_name, owner_name, owner_email, owner_phone, address, bed_capacity, 
             typeof specialties === 'string' ? specialties : JSON.stringify(specialties || [])]
        );
        
        const applicationId = application.rows[0].id;
        
        // Save documents if uploaded
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                await pool.query(
                    `INSERT INTO simple_application_documents (application_id, document_type, file_path, file_name, uploaded_at)
                     VALUES ($1, $2, $3, $4, NOW())`,
                    [applicationId, file.fieldname || 'document', file.path, file.originalname]
                );
            }
        }
        
        // Create initial onboarding progress
        await pool.query(
            `INSERT INTO onboarding_progress (application_id, step, status, updated_at)
             VALUES ($1, 'application_submitted', 'completed', NOW())
             ON CONFLICT DO NOTHING`,
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
        
        // Calculate total score with weighted average
        let totalScore = 0;
        let scoreCount = 0;
        
        if (typeof scores === 'object') {
            const scoreValues = Object.values(scores);
            scoreCount = scoreValues.length;
            totalScore = scoreCount > 0 ? scoreValues.reduce((a, b) => a + Number(b), 0) / scoreCount : 0;
        }
        
        const status = totalScore >= 70 ? 'approved' : 'rejected';
        
        // Generate evaluator_id as UUID (convert from integer if needed)
        const evaluatorId = `00000000-0000-0000-0000-${String(req.user.id || 1).padStart(12, '0')}`;
        
        // Save evaluation using simple table
        const evaluation = await pool.query(
            `INSERT INTO simple_application_evaluations (application_id, evaluator_id, scores, total_score, comments, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             RETURNING *`,
            [id, evaluatorId, JSON.stringify(scores), totalScore, comments, status]
        );
        
        // Update application status
        await pool.query(
            'UPDATE simple_hospital_applications SET status = $1, score = $2 WHERE id = $3',
            [status, totalScore, id]
        );
        
        // Update onboarding progress
        await pool.query(
            `INSERT INTO onboarding_progress (application_id, step, status, updated_at)
             VALUES ($1, 'evaluation_completed', 'completed', NOW())
             ON CONFLICT DO NOTHING`,
            [id]
        );
        
        broadcast('application_evaluated', evaluation.rows[0]);
        res.json({ success: true, evaluation: evaluation.rows[0] });
    } catch (error) {
        console.error('Evaluation error:', error);
        res.status(500).json({ error: 'Failed to evaluate application: ' + error.message });
    }
});

app.post('/api/onboarding/generate-contract/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { template_id, custom_terms } = req.body;
        
        // Get application details
        const application = await pool.query('SELECT * FROM simple_hospital_applications WHERE id = $1', [id]);
        
        if (application.rows.length === 0) {
            return res.status(404).json({ error: 'Application not found' });
        }
        
        const appData = application.rows[0];
        
        // Generate contract PDF
        const doc = new PDFDocument();
        const contractFilename = `contract_${id}_${Date.now()}.pdf`;
        const contractPath = path.join('contracts', contractFilename);
        
        doc.pipe(fs.createWriteStream(contractPath));
        
        // Generate contract content
        doc.fontSize(20).text('Hospital Partnership Contract', { align: 'center' });
        doc.moveDown();
        doc.fontSize(14).text('GrandPro HMSO Partnership Agreement', { align: 'center' });
        doc.moveDown(2);
        
        doc.fontSize(12);
        doc.text(`Agreement Date: ${new Date().toLocaleDateString()}`, { align: 'left' });
        doc.moveDown();
        
        doc.text('PARTIES:', { underline: true });
        doc.text('1. GrandPro HMSO (The Company)');
        doc.text(`2. ${appData.hospital_name} (The Hospital)`);
        doc.moveDown();
        
        doc.text('HOSPITAL DETAILS:', { underline: true });
        doc.text(`Hospital: ${appData.hospital_name}`);
        doc.text(`Owner: ${appData.owner_name}`);
        doc.text(`Email: ${appData.owner_email}`);
        doc.text(`Phone: ${appData.owner_phone}`);
        doc.text(`Address: ${appData.address}`);
        doc.text(`Bed Capacity: ${appData.bed_capacity}`);
        doc.moveDown();
        
        doc.text('TERMS AND CONDITIONS:', { underline: true });
        doc.text(custom_terms || `
1. Partnership Duration: This agreement shall be valid for 5 years from the date of signing.

2. Services Provided: GrandPro HMSO will provide comprehensive hospital management services including:
   - Electronic Medical Records System
   - Billing and Revenue Management
   - Inventory Management
   - Staff Management Systems
   - Analytics and Reporting
   - Technical Support and Training

3. Revenue Sharing: The parties agree to a revenue sharing model as follows:
   - Hospital: 70% of net revenue
   - GrandPro HMSO: 30% of net revenue

4. Compliance: Both parties agree to comply with all applicable healthcare regulations.

5. Data Protection: All patient data shall be handled in accordance with HIPAA/GDPR standards.

6. Termination: Either party may terminate this agreement with 90 days written notice.
        `);
        
        doc.moveDown(3);
        doc.text('SIGNATURES:', { underline: true });
        doc.moveDown();
        doc.text('For GrandPro HMSO:');
        doc.text('_______________________');
        doc.text('Authorized Signatory');
        doc.text(`Date: ${new Date().toLocaleDateString()}`);
        doc.moveDown(2);
        doc.text('For ' + appData.hospital_name + ':');
        doc.text('_______________________');
        doc.text(appData.owner_name);
        doc.text('Date: _______________________');
        
        doc.end();
        
        // Save contract record
        const contract = await pool.query(
            `INSERT INTO simple_contracts (application_id, contract_path, terms, status, created_at)
             VALUES ($1, $2, $3, 'pending', NOW())
             RETURNING *`,
            [id, contractPath, custom_terms]
        );
        
        // Update onboarding progress
        await pool.query(
            `INSERT INTO onboarding_progress (application_id, step, status, updated_at)
             VALUES ($1, 'contract_generated', 'completed', NOW())
             ON CONFLICT DO NOTHING`,
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
            `UPDATE simple_contracts 
             SET status = 'signed', signature_data = $1, signed_at = NOW()
             WHERE id = $2
             RETURNING *`,
            [signature_data, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Contract not found' });
        }
        
        const contract = result.rows[0];
        
        // Update application status
        await pool.query(
            'UPDATE simple_hospital_applications SET status = $1 WHERE id = $2',
            ['completed', contract.application_id]
        );
        
        // Update onboarding progress
        await pool.query(
            `INSERT INTO onboarding_progress (application_id, step, status, updated_at)
             VALUES ($1, 'onboarding_completed', 'completed', NOW())
             ON CONFLICT DO NOTHING`,
            [contract.application_id]
        );
        
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
            SELECT a.*, 
                   COUNT(DISTINCT d.id) as document_count,
                   COUNT(DISTINCT p.id) as progress_count
            FROM simple_hospital_applications a
            LEFT JOIN simple_application_documents d ON a.id = d.application_id
            LEFT JOIN onboarding_progress p ON a.id = p.application_id
            WHERE 1=1
        `;
        const params = [];
        
        if (status) {
            params.push(status);
            query += ` AND a.status = $${params.length}`;
        }
        
        query += ` GROUP BY a.id ORDER BY a.created_at DESC LIMIT ${limit} OFFSET ${offset}`;
        
        const result = await pool.query(query, params);
        
        // Get current step for each application
        for (let app of result.rows) {
            const progress = await pool.query(
                'SELECT step FROM onboarding_progress WHERE application_id = $1 ORDER BY updated_at DESC LIMIT 1',
                [app.id]
            );
            app.current_step = progress.rows[0]?.step || 'application_submitted';
        }
        
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
        
        const checklist = [
            { step: 'application_submitted', name: 'Application Submitted', sequence: 1 },
            { step: 'documents_uploaded', name: 'Documents Uploaded', sequence: 2 },
            { step: 'evaluation_completed', name: 'Evaluation Completed', sequence: 3 },
            { step: 'contract_generated', name: 'Contract Generated', sequence: 4 },
            { step: 'contract_signed', name: 'Contract Signed', sequence: 5 },
            { step: 'onboarding_completed', name: 'Onboarding Complete', sequence: 6 }
        ];
        
        res.json({
            success: true,
            progress: progress.rows,
            checklist: checklist
        });
    } catch (error) {
        console.error('Progress fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch onboarding progress' });
    }
});

// ============ HEALTH CHECK ============
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

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 5701;
server.listen(PORT, () => {
    console.log(`Onboarding Backend (Fixed) running on port ${PORT}`);
    console.log(`WebSocket server ready for connections`);
});
