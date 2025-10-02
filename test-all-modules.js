#!/usr/bin/env node

const fetch = require('node-fetch');

const API_URL = 'https://hms-backend-final-morphvm-mkofwuzh.http.cloud.morph.so/api';
let authToken = '';

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m'
};

function log(message, color = colors.reset) {
    console.log(`${color}${message}${colors.reset}`);
}

async function testEndpoint(name, method, endpoint, body = null) {
    try {
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            }
        };
        
        if (body) {
            options.body = JSON.stringify(body);
        }
        
        const response = await fetch(`${API_URL}${endpoint}`, options);
        const data = await response.json();
        
        if (response.ok && (data.success || data.status)) {
            log(`✓ ${name}`, colors.green);
            return data;
        } else {
            log(`✗ ${name}: ${data.error || 'Failed'}`, colors.red);
            return null;
        }
    } catch (error) {
        log(`✗ ${name}: ${error.message}`, colors.red);
        return null;
    }
}

async function runTests() {
    log('\n=== HOSPITAL MANAGEMENT SYSTEM - COMPREHENSIVE MODULE TEST ===\n', colors.blue);
    
    // 1. Test Health Check
    log('1. HEALTH CHECK', colors.yellow);
    await testEndpoint('API Health', 'GET', '/health');
    
    // 2. Test Authentication
    log('\n2. AUTHENTICATION', colors.yellow);
    const loginResult = await testEndpoint('Login', 'POST', '/auth/login', {
        email: 'admin@hospital.com',
        password: 'admin123'
    });
    
    if (loginResult && loginResult.token) {
        authToken = loginResult.token;
        log(`  Token acquired: ${authToken.substring(0, 20)}...`);
    } else {
        log('  Failed to get auth token - stopping tests', colors.red);
        return;
    }
    
    // 3. Test Patient Management
    log('\n3. PATIENT MANAGEMENT', colors.yellow);
    await testEndpoint('Get Patients', 'GET', '/patients');
    const newPatient = await testEndpoint('Create Patient', 'POST', '/patients', {
        name: 'Test Patient ' + Date.now(),
        date_of_birth: '1990-01-01',
        gender: 'Male',
        phone: '123-456-7890',
        email: 'test@email.com',
        blood_type: 'O+',
        allergies: 'None'
    });
    
    // 4. Test Medical Records
    log('\n4. MEDICAL RECORDS', colors.yellow);
    await testEndpoint('Get Medical Records', 'GET', '/medical-records');
    if (newPatient && newPatient.patient) {
        await testEndpoint('Create Medical Record', 'POST', '/medical-records', {
            patientId: newPatient.patient.id,
            symptoms: 'Headache, fever',
            diagnosis: 'Common cold',
            treatment: 'Rest and fluids',
            prescription: 'Paracetamol 500mg',
            visitType: 'consultation',
            notes: 'Follow up in 3 days'
        });
    }
    
    // 5. Test Billing
    log('\n5. BILLING & REVENUE', colors.yellow);
    await testEndpoint('Get Invoices', 'GET', '/billing/invoices');
    if (newPatient && newPatient.patient) {
        const invoice = await testEndpoint('Create Invoice', 'POST', '/billing/invoices', {
            patientId: newPatient.patient.id,
            items: [
                { description: 'Consultation', quantity: 1, unitPrice: 100, total: 100 },
                { description: 'Blood Test', quantity: 1, unitPrice: 50, total: 50 }
            ],
            totalAmount: 150,
            dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        });
        
        if (invoice && invoice.invoice) {
            await testEndpoint('Process Payment', 'POST', '/billing/process-payment', {
                invoiceId: invoice.invoice.id,
                amount: 150,
                paymentMethod: 'cash'
            });
        }
    }
    
    // 6. Test Inventory
    log('\n6. INVENTORY MANAGEMENT', colors.yellow);
    await testEndpoint('Get Inventory', 'GET', '/inventory');
    await testEndpoint('Get Low Stock Items', 'GET', '/inventory/low-stock');
    await testEndpoint('Add Stock', 'POST', '/inventory/add-stock', {
        itemName: 'Test Medicine ' + Date.now(),
        category: 'Medication',
        quantity: 100,
        unit: 'tablets',
        reorderLevel: 20,
        unitPrice: 1.50,
        supplier: 'Test Supplier',
        expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    });
    
    // 7. Test Staff Management
    log('\n7. STAFF MANAGEMENT', colors.yellow);
    await testEndpoint('Get Staff', 'GET', '/staff');
    await testEndpoint('Get Staff Schedule', 'GET', '/staff/schedule');
    await testEndpoint('Create Schedule', 'POST', '/staff/schedule', {
        staffId: 1,
        date: new Date().toISOString().split('T')[0],
        shiftStart: '08:00',
        shiftEnd: '16:00',
        department: 'General Ward'
    });
    
    // 8. Test Bed Management
    log('\n8. BED MANAGEMENT', colors.yellow);
    await testEndpoint('Get Available Beds', 'GET', '/beds/available');
    await testEndpoint('Get All Beds', 'GET', '/beds/all');
    await testEndpoint('Get Ward Occupancy', 'GET', '/wards/occupancy');
    
    // 9. Test Appointments
    log('\n9. APPOINTMENTS', colors.yellow);
    await testEndpoint('Get Appointments', 'GET', '/appointments');
    if (newPatient && newPatient.patient) {
        await testEndpoint('Create Appointment', 'POST', '/appointments', {
            patientId: newPatient.patient.id,
            appointmentDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            appointmentTime: '14:00',
            department: 'General Medicine',
            reason: 'Follow-up consultation',
            notes: 'Patient requested afternoon slot'
        });
    }
    
    // 10. Test Lab Results
    log('\n10. LAB RESULTS', colors.yellow);
    await testEndpoint('Get Lab Results', 'GET', '/lab-results');
    if (newPatient && newPatient.patient) {
        await testEndpoint('Create Lab Result', 'POST', '/lab-results', {
            patientId: newPatient.patient.id,
            testName: 'Complete Blood Count',
            testType: 'Blood Test',
            results: 'Normal',
            normalRange: 'WBC: 4-11, RBC: 4.5-5.5',
            testDate: new Date().toISOString().split('T')[0],
            notes: 'All parameters within normal range'
        });
    }
    
    // 11. Test Analytics
    log('\n11. ANALYTICS', colors.yellow);
    await testEndpoint('Get Analytics Overview', 'GET', '/analytics/overview');
    await testEndpoint('Get Analytics Dashboard', 'GET', '/analytics/dashboard');
    await testEndpoint('Export Report', 'POST', '/analytics/export-report', {
        reportType: 'revenue',
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0]
    });
    await testEndpoint('Get Revenue Reports', 'GET', '/revenue-reports?period=30');
    
    log('\n=== TEST SUMMARY ===\n', colors.blue);
    log('All core modules have been tested!', colors.green);
    log('\nFrontend URL: https://hms-frontend-final-morphvm-mkofwuzh.http.cloud.morph.so', colors.blue);
    log('Backend API: https://hms-backend-final-morphvm-mkofwuzh.http.cloud.morph.so/api', colors.blue);
    log('\nDefault Login:', colors.yellow);
    log('  Email: admin@hospital.com');
    log('  Password: admin123');
}

// Run tests
runTests().catch(console.error);
