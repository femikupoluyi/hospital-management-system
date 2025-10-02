const axios = require('axios');

const API_URL = 'http://localhost:4000/api';
let authToken = '';

async function testHMS() {
    console.log('Testing Hospital Management System...\n');
    
    try {
        // 1. Test Health Check
        console.log('1. Testing Health Check...');
        const health = await axios.get(`${API_URL}/health`);
        console.log('✅ Health Check:', health.data.status);
        
        // 2. Seed Initial Data
        console.log('\n2. Seeding Initial Data...');
        const seed = await axios.post(`${API_URL}/system/seed`);
        console.log('✅ Initial data seeded');
        
        // 3. Test Authentication
        console.log('\n3. Testing Authentication...');
        const login = await axios.post(`${API_URL}/auth/login`, {
            email: 'admin@hospital.com',
            password: 'password123'
        });
        authToken = login.data.token;
        console.log('✅ Login successful, token received');
        
        const config = { headers: { 'Authorization': `Bearer ${authToken}` } };
        
        // 4. Create a Patient
        console.log('\n4. Creating a Patient...');
        const patient = await axios.post(`${API_URL}/patients`, {
            first_name: 'John',
            last_name: 'Doe',
            date_of_birth: '1980-05-15',
            gender: 'Male',
            phone: '123-456-7890',
            email: 'john.doe@email.com',
            address: '123 Main St, City',
            blood_group: 'O+',
            emergency_contact: 'Jane Doe: 098-765-4321'
        }, config);
        console.log('✅ Patient created:', patient.data.patient.patient_id);
        const patientId = patient.data.patient.id;
        
        // 5. Create Medical Record
        console.log('\n5. Creating Medical Record...');
        const record = await axios.post(`${API_URL}/medical-records`, {
            patient_id: patientId,
            doctor_id: 1,
            chief_complaint: 'Headache and fever',
            diagnosis: 'Viral infection',
            treatment_plan: 'Rest and medication',
            prescriptions: JSON.stringify([{ medication: 'Paracetamol', dosage: '500mg', frequency: 'Twice daily' }]),
            vitals: JSON.stringify({ temperature: '38.5°C', bp: '120/80', pulse: '72' })),
            notes: 'Patient advised to rest and stay hydrated'
        }, config);
        console.log('✅ Medical record created');
        
        // 6. Create Invoice
        console.log('\n6. Creating Invoice...');
        const invoice = await axios.post(`${API_URL}/invoices`, {
            patient_id: patientId,
            items: [
                { description: 'Consultation', amount: 50 },
                { description: 'Lab Tests', amount: 75 },
                { description: 'Medication', amount: 25 }
            ],
            total_amount: 150,
            payment_method: 'cash',
            due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        }, config);
        console.log('✅ Invoice created:', invoice.data.invoice.invoice_number);
        
        // 7. Test Inventory
        console.log('\n7. Testing Inventory Management...');
        const inventory = await axios.post(`${API_URL}/inventory`, {
            item_code: 'TEST001',
            item_name: 'Test Medicine',
            category: 'Medicine',
            unit: 'Box',
            quantity: 50,
            reorder_level: 10,
            unit_price: 12.50,
            supplier: 'Test Supplier'
        }, config);
        console.log('✅ Inventory item added');
        
        // Check low stock
        const lowStock = await axios.get(`${API_URL}/inventory/low-stock`, config);
        console.log('✅ Low stock items:', lowStock.data.items.length);
        
        // 8. Test Staff Schedule
        console.log('\n8. Testing Staff Management...');
        const schedule = await axios.post(`${API_URL}/staff-schedules`, {
            staff_id: 2,
            date: new Date().toISOString().split('T')[0],
            shift: 'morning',
            start_time: '06:00',
            end_time: '14:00',
            department: 'Emergency'
        }, config);
        console.log('✅ Staff schedule created');
        
        // 9. Test Bed Management
        console.log('\n9. Testing Bed Management...');
        const beds = await axios.get(`${API_URL}/beds/available`, config);
        console.log('✅ Available beds:', beds.data.beds.length);
        
        if (beds.data.beds.length > 0) {
            const admission = await axios.post(`${API_URL}/beds/admit`, {
                bed_id: beds.data.beds[0].id,
                patient_id: patientId,
                expected_discharge: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
            }, config);
            console.log('✅ Patient admitted to bed:', beds.data.beds[0].bed_number);
        }
        
        // 10. Test Appointments
        console.log('\n10. Testing Appointments...');
        const appointment = await axios.post(`${API_URL}/appointments`, {
            patient_id: patientId,
            doctor_id: 2,
            appointment_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            reason: 'Follow-up consultation'
        }, config);
        console.log('✅ Appointment scheduled');
        
        // 11. Test Lab Results
        console.log('\n11. Testing Lab Results...');
        const labResult = await axios.post(`${API_URL}/lab-results`, {
            patient_id: patientId,
            test_name: 'Complete Blood Count',
            result_value: 'Normal ranges',
            normal_range: '4.5-11 x10^9/L',
            status: 'Normal',
            technician_id: 4,
            doctor_id: 2
        }, config);
        console.log('✅ Lab result recorded');
        
        // 12. Test Prescriptions
        console.log('\n12. Testing Prescriptions...');
        const prescription = await axios.post(`${API_URL}/prescriptions`, {
            patient_id: patientId,
            doctor_id: 2,
            medication_name: 'Amoxicillin',
            dosage: '250mg',
            frequency: 'Three times daily',
            duration: '7 days',
            instructions: 'Take after meals'
        }, config);
        console.log('✅ Prescription created');
        
        // 13. Test Analytics Dashboard
        console.log('\n13. Testing Analytics Dashboard...');
        const dashboard = await axios.get(`${API_URL}/analytics/dashboard`, config);
        console.log('✅ Dashboard Stats:');
        console.log('   - Total Patients:', dashboard.data.stats.totalPatients);
        console.log('   - Appointments Today:', dashboard.data.stats.appointmentsToday);
        console.log('   - Low Stock Items:', dashboard.data.stats.lowStockItems);
        console.log('   - Staff on Duty:', dashboard.data.stats.staffOnDuty);
        
        // 14. Test Revenue Analytics
        console.log('\n14. Testing Revenue Analytics...');
        const revenue = await axios.get(`${API_URL}/analytics/revenue`, config);
        console.log('✅ Revenue data retrieved:', revenue.data.data.length, 'records');
        
        // 15. Test Occupancy Analytics
        console.log('\n15. Testing Occupancy Analytics...');
        const occupancy = await axios.get(`${API_URL}/analytics/occupancy`, config);
        console.log('✅ Occupancy by ward:');
        occupancy.data.data.forEach(ward => {
            console.log(`   - ${ward.ward}: ${ward.occupied_beds}/${ward.total_beds} (${ward.occupancy_rate}%)`);
        });
        
        // 16. Process Payment on Invoice
        console.log('\n16. Testing Payment Processing...');
        const payment = await axios.post(`${API_URL}/invoices/${invoice.data.invoice.id}/payment`, {
            amount: 100,
            payment_method: 'card'
        }, config);
        console.log('✅ Payment processed, invoice status:', payment.data.invoice.status);
        
        // 17. Test System Info
        console.log('\n17. Testing System Info...');
        const sysInfo = await axios.get(`${API_URL}/system/info`, config);
        console.log('✅ System Info:');
        console.log('   - Version:', sysInfo.data.info.version);
        console.log('   - Tables:', sysInfo.data.info.tables);
        console.log('   - Users:', sysInfo.data.info.users);
        console.log('   - Patients:', sysInfo.data.info.patients);
        
        console.log('\n✅✅✅ ALL HMS FEATURES TESTED SUCCESSFULLY! ✅✅✅');
        console.log('\nThe Hospital Management System is fully functional with:');
        console.log('- Patient Management');
        console.log('- Electronic Medical Records');
        console.log('- Billing & Invoicing');
        console.log('- Inventory Management');
        console.log('- Staff Scheduling');
        console.log('- Bed Management');
        console.log('- Appointments');
        console.log('- Lab Results');
        console.log('- Prescriptions');
        console.log('- Analytics & Reporting');
        console.log('- Payment Processing');
        
    } catch (error) {
        console.error('❌ Test failed:', error.response?.data || error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
    }
}

// Run the tests
testHMS();
