#!/usr/bin/env node

// This script fixes the remaining database schema issues and creates compatibility functions

const { Pool } = require('pg');

const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_InhJz3HWVO6E@ep-solitary-recipe-adrz8omw-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require',
    ssl: { rejectUnauthorized: false }
});

async function fixDatabaseSchema() {
    console.log('Starting database schema fixes...\n');
    
    try {
        // 1. Create a function to convert UUID to a numeric ID for compatibility
        console.log('1. Creating UUID to Integer conversion function...');
        await pool.query(`
            CREATE OR REPLACE FUNCTION uuid_to_int(uuid_val UUID)
            RETURNS INTEGER AS $$
            BEGIN
                RETURN ('x' || substr(md5(uuid_val::text), 1, 8))::bit(32)::int;
            END;
            $$ LANGUAGE plpgsql IMMUTABLE;
        `);
        console.log('✅ UUID conversion function created');

        // 2. Create patient_int view for integer-based access
        console.log('\n2. Creating patient compatibility view...');
        await pool.query(`
            CREATE OR REPLACE VIEW patients_int AS
            SELECT 
                uuid_to_int(id) as id,
                id as uuid_id,
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
                emergency_contact_name as emergency_contact,
                created_at
            FROM patients;
        `);
        console.log('✅ Patient compatibility view created');

        // 3. Create or update medical_records to work with both UUID and INT
        console.log('\n3. Fixing medical_records table...');
        await pool.query(`
            ALTER TABLE medical_records 
            ADD COLUMN IF NOT EXISTS patient_uuid UUID;
        `);
        
        await pool.query(`
            CREATE OR REPLACE FUNCTION get_patient_int_id(p_uuid UUID)
            RETURNS INTEGER AS $$
            BEGIN
                RETURN uuid_to_int(p_uuid);
            END;
            $$ LANGUAGE plpgsql IMMUTABLE;
        `);
        console.log('✅ Medical records compatibility added');

        // 4. Fix invoices table structure
        console.log('\n4. Fixing invoices table...');
        await pool.query(`
            ALTER TABLE invoices 
            ADD COLUMN IF NOT EXISTS patient_uuid UUID,
            ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'cash';
        `);
        console.log('✅ Invoices table fixed');

        // 5. Fix beds table for admissions
        console.log('\n5. Fixing beds table...');
        await pool.query(`
            ALTER TABLE beds 
            ADD COLUMN IF NOT EXISTS patient_uuid UUID,
            ADD COLUMN IF NOT EXISTS admission_date TIMESTAMP,
            ADD COLUMN IF NOT EXISTS discharge_date TIMESTAMP,
            ADD COLUMN IF NOT EXISTS notes TEXT;
        `);
        console.log('✅ Beds table fixed');

        // 6. Fix appointments table
        console.log('\n6. Fixing appointments table...');
        await pool.query(`
            ALTER TABLE appointments 
            ADD COLUMN IF NOT EXISTS patient_uuid UUID,
            ADD COLUMN IF NOT EXISTS duration INTEGER DEFAULT 30;
        `);
        console.log('✅ Appointments table fixed');

        // 7. Fix lab_results table
        console.log('\n7. Fixing lab_results table...');
        await pool.query(`
            ALTER TABLE lab_results 
            ADD COLUMN IF NOT EXISTS patient_uuid UUID,
            ADD COLUMN IF NOT EXISTS results TEXT,
            ADD COLUMN IF NOT EXISTS normal_range VARCHAR(255),
            ADD COLUMN IF NOT EXISTS ordered_by INTEGER,
            ADD COLUMN IF NOT EXISTS test_date DATE DEFAULT CURRENT_DATE;
        `);
        console.log('✅ Lab results table fixed');

        // 8. Fix prescriptions table
        console.log('\n8. Fixing prescriptions table...');
        await pool.query(`
            ALTER TABLE prescriptions 
            ADD COLUMN IF NOT EXISTS patient_uuid UUID,
            ADD COLUMN IF NOT EXISTS medication VARCHAR(255),
            ADD COLUMN IF NOT EXISTS dosage VARCHAR(100),
            ADD COLUMN IF NOT EXISTS frequency VARCHAR(100),
            ADD COLUMN IF NOT EXISTS duration VARCHAR(100),
            ADD COLUMN IF NOT EXISTS start_date DATE DEFAULT CURRENT_DATE,
            ADD COLUMN IF NOT EXISTS end_date DATE,
            ADD COLUMN IF NOT EXISTS instructions TEXT,
            ADD COLUMN IF NOT EXISTS doctor_id INTEGER,
            ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';
        `);
        console.log('✅ Prescriptions table fixed');

        // 9. Create trigger functions to sync UUID and INT IDs
        console.log('\n9. Creating sync triggers...');
        await pool.query(`
            CREATE OR REPLACE FUNCTION sync_patient_ids()
            RETURNS TRIGGER AS $$
            BEGIN
                IF NEW.patient_uuid IS NOT NULL THEN
                    NEW.patient_id = uuid_to_int(NEW.patient_uuid);
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `);

        // Apply triggers to all relevant tables
        const tables = ['medical_records', 'appointments', 'invoices', 'beds', 'lab_results', 'prescriptions'];
        for (const table of tables) {
            await pool.query(`
                DROP TRIGGER IF EXISTS sync_${table}_patient_id ON ${table};
                CREATE TRIGGER sync_${table}_patient_id
                BEFORE INSERT OR UPDATE ON ${table}
                FOR EACH ROW EXECUTE FUNCTION sync_patient_ids();
            `);
            console.log(`✅ Trigger created for ${table}`);
        }

        // 10. Insert sample data for testing
        console.log('\n10. Adding sample data...');
        
        // Get a patient UUID for testing
        const patientResult = await pool.query('SELECT id FROM patients LIMIT 1');
        if (patientResult.rows.length > 0) {
            const patientUuid = patientResult.rows[0].id;
            
            // Add sample medical record
            await pool.query(`
                INSERT INTO medical_records (patient_uuid, doctor_id, diagnosis, symptoms, treatment)
                VALUES ($1, 1, 'Sample diagnosis', 'Sample symptoms', 'Sample treatment')
                ON CONFLICT DO NOTHING
            `, [patientUuid]);
            
            // Add sample appointment
            await pool.query(`
                INSERT INTO appointments (patient_uuid, doctor_id, appointment_date, appointment_time)
                VALUES ($1, 1, CURRENT_DATE + INTERVAL '7 days', '14:00')
                ON CONFLICT DO NOTHING
            `, [patientUuid]);
            
            console.log('✅ Sample data added');
        }

        console.log('\n✅ All database fixes completed successfully!');
        
        // Test the fixes
        console.log('\n11. Testing fixes...');
        
        // Test patient view
        const testPatients = await pool.query('SELECT * FROM patients_int LIMIT 1');
        console.log(`✅ Patient view works: ${testPatients.rows.length} records`);
        
        // Test UUID conversion
        const testConversion = await pool.query(`SELECT uuid_to_int(gen_random_uuid()) as test_id`);
        console.log(`✅ UUID conversion works: ${testConversion.rows[0].test_id}`);
        
        console.log('\n🎉 Database schema fixes completed successfully!');
        
    } catch (error) {
        console.error('❌ Error fixing database:', error.message);
        console.error(error);
    } finally {
        await pool.end();
    }
}

// Run the fixes
fixDatabaseSchema();
