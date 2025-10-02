#!/usr/bin/env node

const axios = require('axios');

// Configuration
const API_URL = 'http://localhost:5700/api';
const FRONTEND_URL = 'http://localhost:8081';

// Test credentials
const credentials = {
    email: 'admin@hospital.com',
    password: 'admin123'
};

let authToken = '';
let testPatientId = null;
let testRecordId = null;
let testInvoiceId = null;

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

function log(message, color = colors.reset) {
    console.log(`${color}${message}${colors.reset}`);
}

function logSection(title) {
    console.log('\n' + '='.repeat(60));
    log(title, colors.bright + colors.blue);
    console.log('='.repeat(60));
}

async function test(name, fn) {
    try {
        await fn();
        log(`✓ ${name}`, colors.green);
        return true;
    } catch (error) {
        log(`✗ ${name}`, colors.red);
        log(`  Error: ${error.message}`, colors.red);
        return false;
    }
}

// API Helper
async function apiCall(endpoint, method = 'GET', data = null) {
    const config = {
        method,
        url: `${API_URL}${endpoint}`,
        headers: {
            'Content-Type': 'application/json'
        }
    };

    if (authToken) {
        config.headers['Authorization'] = `Bearer ${authToken}`;
    }

    if (data) {
        config.data = data;
    }

    try {
        const response = await axios(config);
        return response.data;
    } catch (error) {
        if (error.response) {
            throw new Error(error.response.data.error || error.response.statusText);
        }
        throw error;
    }
}

// Test Suite
async function runTests() {
    const results = {
        total: 0,
        passed: 0,
        failed: 0
    };

    // Health Check
    logSection('1. HEALTH CHECK');
    
    results.total++;
    if (await test('API Health Check', async () => {
        const health = await apiCall('/health');
        if (!health.status === 'healthy') throw new Error('API not healthy');
    })) results.passed++; else results.failed++;

    results.total++;
    if (await test('Frontend Accessibility', async () => {
        const response = await axios.get(FRONTEND_URL);
        if (response.status !== 200) throw new Error('Frontend not accessible');
    })) results.passed++; else results.failed++;

    // Authentication
    logSection('2. AUTHENTICATION MODULE');
    
    results.total++;
    if (await test('User Login', async () => {
        const response = await apiCall('/auth/login', 'POST', credentials);
        if (!response.success || !response.token) throw new Error('Login failed');
        authToken = response.token;
    })) results.passed++; else results.failed++;

    results.total++;
    if (await test('Verify Token', async () => {
        const response = await apiCall('/auth/verify');
        if (!response.success) throw new Error('Token verification failed');
    })) results.passed++; else results.failed++;

    // Electronic Medical Records
    logSection('3. ELECTRONIC MEDICAL RECORDS');

    results.total++;
    if (await test('Create Patient', async () => {
        const patient = {
            name: `Test Patient ${Date.now()}`,
            email: `test${Date.now()}@example.com`,
            phone: '1234567890',
            date_of_birth: '1990-01-01',
            gender: 'male',
            address: '123 Test Street'
        };
        const response = await apiCall('/patients', 'POST', patient);
        if (!response.success || !response.patient) throw new Error('Patient creation failed');
        testPatientId = response.patient.id;
    })) results.passed++; else results.failed++;

    results.total++;
    if (await test('List Patients', async () => {
        const response = await apiCall('/patients');
        if (!response.success || !Array.isArray(response.patients)) throw new Error('Failed to list patients');
    })) results.passed++; else results.failed++;

    results.total++;
    if (await test('Create Medical Record', async () => {
        const record = {
            patient_id: testPatientId,
            symptoms: 'Test symptoms',
            diagnosis: 'Test diagnosis',
            treatment: 'Test treatment',
            prescription: 'Test prescription',
            visit_type: 'consultation'
        };
        const response = await apiCall('/medical-records', 'POST', record);
        if (!response.success || !response.record) throw new Error('Medical record creation failed');
        testRecordId = response.record.id;
    })) results.passed++; else results.failed++;

    results.total++;
    if (await test('View Medical Records', async () => {
        const response = await apiCall('/medical-records');
        if (!response.success || !Array.isArray(response.records)) throw new Error('Failed to fetch medical records');
    })) results.passed++; else results.failed++;

    // Billing & Revenue
    logSection('4. BILLING & REVENUE');

    results.total++;
    if (await test('Create Invoice', async () => {
        const invoice = {
            patient_id: testPatientId,
            items: [
                { description: 'Consultation', quantity: 1, unit_price: 100 },
                { description: 'Lab Test', quantity: 1, unit_price: 50 }
            ],
            payment_method: 'cash',
            insurance_provider: 'None'
        };
        const response = await apiCall('/invoices', 'POST', invoice);
        if (!response.success || !response.invoice) throw new Error('Invoice creation failed');
        testInvoiceId = response.invoice.id;
    })) results.passed++; else results.failed++;

    results.total++;
    if (await test('List Invoices', async () => {
        const response = await apiCall('/invoices');
        if (!response.success || !Array.isArray(response.invoices)) throw new Error('Failed to list invoices');
    })) results.passed++; else results.failed++;

    results.total++;
    if (await test('Update Invoice Payment', async () => {
        const response = await apiCall(`/invoices/${testInvoiceId}/payment`, 'POST', {
            amount_paid: 150
        });
        if (!response.success) throw new Error('Payment update failed');
    })) results.passed++; else results.failed++;

    // Inventory Management
    logSection('5. INVENTORY MANAGEMENT');

    results.total++;
    if (await test('Add Stock Entry', async () => {
        const stock = {
            item_name: `Test Medicine ${Date.now()}`,
            category: 'medicine',
            quantity: 100,
            unit: 'tablets',
            unit_price: 5,
            expiry_date: '2026-12-31'
        };
        const response = await apiCall('/inventory', 'POST', stock);
        if (!response.success) throw new Error('Stock entry failed');
    })) results.passed++; else results.failed++;

    results.total++;
    if (await test('View Inventory', async () => {
        const response = await apiCall('/inventory');
        if (!response.success || !Array.isArray(response.items)) throw new Error('Failed to fetch inventory');
    })) results.passed++; else results.failed++;

    results.total++;
    if (await test('Check Low Stock Alerts', async () => {
        const response = await apiCall('/inventory/low-stock');
        if (!response.success || !Array.isArray(response.items)) throw new Error('Failed to fetch low stock items');
    })) results.passed++; else results.failed++;

    // Staff Management
    logSection('6. STAFF MANAGEMENT');

    results.total++;
    if (await test('Add Staff Schedule', async () => {
        const schedule = {
            staff_name: 'Dr. Test',
            department: 'General',
            shift_start: '08:00',
            shift_end: '16:00',
            date: new Date().toISOString().split('T')[0]
        };
        const response = await apiCall('/schedules', 'POST', schedule);
        if (!response.success) throw new Error('Schedule creation failed');
    })) results.passed++; else results.failed++;

    results.total++;
    if (await test('View Roster', async () => {
        const response = await apiCall('/schedules');
        if (!response.success || !Array.isArray(response.schedules)) throw new Error('Failed to fetch roster');
    })) results.passed++; else results.failed++;

    // Bed Management
    logSection('7. BED MANAGEMENT');

    results.total++;
    if (await test('Create Admission', async () => {
        const admission = {
            patient_id: testPatientId,
            ward: 'General Ward',
            bed_number: `B${Date.now() % 100}`,
            admission_reason: 'Test admission',
            doctor_name: 'Dr. Test'
        };
        const response = await apiCall('/admissions', 'POST', admission);
        if (!response.success) throw new Error('Admission creation failed');
    })) results.passed++; else results.failed++;

    results.total++;
    if (await test('View Available Beds', async () => {
        const response = await apiCall('/beds/available');
        if (!response.success || !response.beds) throw new Error('Failed to fetch available beds');
    })) results.passed++; else results.failed++;

    results.total++;
    if (await test('View Bed Occupancy', async () => {
        const response = await apiCall('/beds/occupancy');
        if (!response.success || typeof response.occupancy_rate !== 'number') throw new Error('Failed to fetch occupancy');
    })) results.passed++; else results.failed++;

    // Analytics Dashboard
    logSection('8. ANALYTICS DASHBOARD');

    results.total++;
    if (await test('Fetch Dashboard Metrics', async () => {
        const response = await apiCall('/analytics/dashboard');
        if (!response.success || !response.metrics) throw new Error('Failed to fetch dashboard metrics');
    })) results.passed++; else results.failed++;

    results.total++;
    if (await test('Revenue Analytics', async () => {
        const response = await apiCall('/analytics/revenue');
        if (!response.success || !response.data) throw new Error('Failed to fetch revenue analytics');
    })) results.passed++; else results.failed++;

    results.total++;
    if (await test('Patient Flow Analytics', async () => {
        const response = await apiCall('/analytics/patient-flow');
        if (!response.success || !response.data) throw new Error('Failed to fetch patient flow data');
    })) results.passed++; else results.failed++;

    // Frontend Functionality Tests
    logSection('9. FRONTEND FUNCTIONALITY');

    results.total++;
    if (await test('Frontend Contains All Modules', async () => {
        const response = await axios.get(FRONTEND_URL);
        const html = response.data;
        
        const modules = [
            'Electronic Medical Records',
            'Billing & Revenue',
            'Inventory Management',
            'Staff Management',
            'Bed Management',
            'Analytics Dashboard'
        ];
        
        for (const module of modules) {
            if (!html.includes(module)) {
                throw new Error(`Module "${module}" not found in frontend`);
            }
        }
    })) results.passed++; else results.failed++;

    results.total++;
    if (await test('Frontend Has Functional Buttons', async () => {
        const response = await axios.get(FRONTEND_URL);
        const html = response.data;
        
        const handlers = [
            'showMedicalRecords',
            'showNewMedicalRecordForm',
            'showInvoices',
            'showCreateInvoiceForm',
            'showLowStock',
            'showStockEntryForm',
            'showRoster',
            'showAddScheduleForm',
            'showAvailableBeds',
            'showAdmissionForm',
            'showAnalyticsDashboard',
            'showExportReportForm'
        ];
        
        for (const handler of handlers) {
            if (!html.includes(`onclick="${handler}()"`)) {
                throw new Error(`Handler "${handler}" not found in frontend`);
            }
        }
    })) results.passed++; else results.failed++;

    results.total++;
    if (await test('Frontend API Configuration Correct', async () => {
        const response = await axios.get(FRONTEND_URL);
        const html = response.data;
        
        if (!html.includes('localhost:5700')) {
            throw new Error('Frontend not configured with correct API port (5700)');
        }
    })) results.passed++; else results.failed++;

    // Summary
    logSection('TEST SUMMARY');
    log(`Total Tests: ${results.total}`, colors.bright);
    log(`Passed: ${results.passed}`, colors.green);
    log(`Failed: ${results.failed}`, results.failed > 0 ? colors.red : colors.green);
    log(`Success Rate: ${((results.passed / results.total) * 100).toFixed(1)}%`, colors.cyan);

    if (results.failed === 0) {
        log('\n✨ All modules are fully functional!', colors.bright + colors.green);
    } else {
        log('\n⚠️  Some modules need attention', colors.yellow);
    }

    return results;
}

// Main execution
async function main() {
    log('\n🏥 HOSPITAL MANAGEMENT SYSTEM - COMPREHENSIVE TEST SUITE\n', colors.bright + colors.cyan);
    
    try {
        const results = await runTests();
        
        if (results.failed > 0) {
            process.exit(1);
        }
    } catch (error) {
        log(`\nFatal error: ${error.message}`, colors.red);
        process.exit(1);
    }
}

// Run tests
main();
