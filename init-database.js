const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Database connection
const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_InhJz3HWVO6E@ep-solitary-recipe-adrz8omw-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require',
    ssl: { rejectUnauthorized: false }
});

async function initializeDatabase() {
    console.log('Initializing HMS database...');
    
    try {
        // Create tables
        console.log('Creating users table...');
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

        console.log('Creating patients table...');
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

        console.log('Creating medical_records table...');
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

        console.log('Creating invoices table...');
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

        console.log('Creating inventory table...');
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

        console.log('Creating staff table...');
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

        console.log('Creating schedules table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS schedules (
                id SERIAL PRIMARY KEY,
                staff_id INTEGER,
                date DATE,
                shift_start TIME,
                shift_end TIME,
                department VARCHAR(100),
                status VARCHAR(20) DEFAULT 'scheduled'
            )
        `);

        console.log('Creating beds table...');
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

        console.log('Creating appointments table...');
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

        console.log('Creating lab_results table...');
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

        // Create default admin user
        console.log('Creating default admin user...');
        const adminCheck = await pool.query('SELECT * FROM users WHERE email = $1', ['admin@hospital.com']);
        if (adminCheck.rows.length === 0) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await pool.query(
                'INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4)',
                ['admin@hospital.com', hashedPassword, 'Admin User', 'admin']
            );
            console.log('Default admin user created');
        } else {
            console.log('Admin user already exists');
        }

        // Add sample data
        console.log('Adding sample patients...');
        const patientCount = await pool.query('SELECT COUNT(*) FROM patients');
        if (patientCount.rows[0].count == 0) {
            await pool.query(`
                INSERT INTO patients (name, date_of_birth, gender, phone, email, blood_type, address, allergies)
                VALUES 
                ('John Doe', '1985-05-15', 'Male', '123-456-7890', 'john.doe@email.com', 'O+', '123 Main St', 'None'),
                ('Jane Smith', '1990-08-22', 'Female', '098-765-4321', 'jane.smith@email.com', 'A+', '456 Oak Ave', 'Penicillin'),
                ('Robert Johnson', '1975-12-10', 'Male', '555-123-4567', 'robert.j@email.com', 'B+', '789 Pine Rd', 'None'),
                ('Maria Garcia', '1988-03-25', 'Female', '555-987-6543', 'maria.g@email.com', 'AB+', '321 Elm St', 'Latex'),
                ('William Brown', '1965-11-30', 'Male', '555-456-7890', 'william.b@email.com', 'O-', '654 Maple Dr', 'None')
            `);
            console.log('Sample patients added');
        }

        console.log('Adding sample inventory...');
        const inventoryCount = await pool.query('SELECT COUNT(*) FROM inventory');
        if (inventoryCount.rows[0].count == 0) {
            await pool.query(`
                INSERT INTO inventory (item_name, category, quantity, unit, reorder_level, unit_price, supplier)
                VALUES 
                ('Paracetamol 500mg', 'Medication', 500, 'tablets', 100, 0.50, 'MedSupply Co'),
                ('Surgical Masks', 'PPE', 1000, 'pieces', 200, 0.25, 'SafetyFirst Inc'),
                ('Bandages', 'Medical Supplies', 200, 'rolls', 50, 2.00, 'MedSupply Co'),
                ('Syringes 5ml', 'Medical Supplies', 300, 'pieces', 100, 0.15, 'MedEquip Ltd'),
                ('Antibiotics - Amoxicillin', 'Medication', 100, 'bottles', 20, 15.00, 'PharmaCare'),
                ('Gloves (L)', 'PPE', 50, 'boxes', 10, 8.00, 'SafetyFirst Inc'),
                ('IV Fluids', 'Medical Supplies', 150, 'bags', 30, 5.00, 'MedSupply Co'),
                ('Blood Pressure Monitor', 'Equipment', 10, 'units', 2, 150.00, 'MedEquip Ltd')
            `);
            console.log('Sample inventory added');
        }

        console.log('Adding sample beds...');
        const bedCount = await pool.query('SELECT COUNT(*) FROM beds');
        if (bedCount.rows[0].count == 0) {
            await pool.query(`
                INSERT INTO beds (bed_number, ward, floor, building, bed_type, status)
                VALUES 
                ('A101', 'General Ward', 1, 'Main', 'Standard', 'available'),
                ('A102', 'General Ward', 1, 'Main', 'Standard', 'available'),
                ('A103', 'General Ward', 1, 'Main', 'Standard', 'occupied'),
                ('B201', 'ICU', 2, 'Main', 'ICU', 'available'),
                ('B202', 'ICU', 2, 'Main', 'ICU', 'occupied'),
                ('B203', 'ICU', 2, 'Main', 'ICU', 'available'),
                ('C301', 'Pediatric', 3, 'Main', 'Pediatric', 'available'),
                ('C302', 'Pediatric', 3, 'Main', 'Pediatric', 'available'),
                ('D401', 'Maternity', 4, 'Main', 'Maternity', 'available'),
                ('D402', 'Maternity', 4, 'Main', 'Maternity', 'occupied')
            `);
            console.log('Sample beds added');
        }

        // Add some sample staff
        console.log('Adding sample staff...');
        const staffCount = await pool.query('SELECT COUNT(*) FROM staff');
        if (staffCount.rows[0].count == 0) {
            // Create doctor user
            const doctorCheck = await pool.query('SELECT * FROM users WHERE email = $1', ['doctor@hospital.com']);
            if (doctorCheck.rows.length === 0) {
                const hashedPassword = await bcrypt.hash('doctor123', 10);
                const doctor = await pool.query(
                    'INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4) RETURNING id',
                    ['doctor@hospital.com', hashedPassword, 'Dr. Smith', 'doctor']
                );
                
                await pool.query(
                    'INSERT INTO staff (user_id, department, position, specialization, phone, shift) VALUES ($1, $2, $3, $4, $5, $6)',
                    [doctor.rows[0].id, 'General Medicine', 'Senior Doctor', 'Internal Medicine', '555-0001', 'morning']
                );
            }

            // Create nurse user
            const nurseCheck = await pool.query('SELECT * FROM users WHERE email = $1', ['nurse@hospital.com']);
            if (nurseCheck.rows.length === 0) {
                const hashedPassword = await bcrypt.hash('nurse123', 10);
                const nurse = await pool.query(
                    'INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4) RETURNING id',
                    ['nurse@hospital.com', hashedPassword, 'Nancy Nurse', 'nurse']
                );
                
                await pool.query(
                    'INSERT INTO staff (user_id, department, position, specialization, phone, shift) VALUES ($1, $2, $3, $4, $5, $6)',
                    [nurse.rows[0].id, 'General Ward', 'Head Nurse', 'Critical Care', '555-0002', 'morning']
                );
            }
            console.log('Sample staff added');
        }

        console.log('Database initialization completed successfully!');
        console.log('\nYou can now login with:');
        console.log('  Admin: admin@hospital.com / admin123');
        console.log('  Doctor: doctor@hospital.com / doctor123');
        console.log('  Nurse: nurse@hospital.com / nurse123');
        
    } catch (error) {
        console.error('Error initializing database:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

// Run initialization
initializeDatabase().catch(console.error);
