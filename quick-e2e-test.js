#!/usr/bin/env node

const axios = require('axios');

const URLS = {
    frontend: 'https://hms-frontend-final-morphvm-mkofwuzh.http.cloud.morph.so',
    backend: 'https://hms-backend-final-morphvm-mkofwuzh.http.cloud.morph.so/api',
};

async function quickTest() {
    console.log('🏥 QUICK END-TO-END TEST\n');
    
    let passed = 0;
    let failed = 0;
    
    // Test 1: Frontend
    try {
        const res = await axios.get(URLS.frontend, { timeout: 5000 });
        if (res.status === 200) {
            console.log('✅ Frontend: Accessible');
            passed++;
        }
    } catch (e) {
        console.log('❌ Frontend: Failed');
        failed++;
    }
    
    // Test 2: Backend Health
    try {
        const res = await axios.get(`${URLS.backend}/health`, { timeout: 5000 });
        if (res.data.status === 'healthy') {
            console.log('✅ Backend: Healthy');
            passed++;
        }
    } catch (e) {
        console.log('❌ Backend: Failed');
        failed++;
    }
    
    // Test 3: Authentication
    try {
        const res = await axios.post(`${URLS.backend}/auth/login`, {
            email: 'admin@hospital.com',
            password: 'admin123'
        }, { timeout: 5000 });
        if (res.data.success && res.data.token) {
            console.log('✅ Auth: Working');
            passed++;
            
            // Test 4: Protected Endpoint
            try {
                const patients = await axios.get(`${URLS.backend}/patients`, {
                    headers: { Authorization: `Bearer ${res.data.token}` },
                    timeout: 5000
                });
                if (patients.data.success) {
                    console.log('✅ API: Protected endpoints working');
                    passed++;
                }
            } catch (e) {
                console.log('❌ API: Protected endpoints failed');
                failed++;
            }
        }
    } catch (e) {
        console.log('❌ Auth: Failed');
        failed++;
    }
    
    // Results
    console.log('\n' + '='.repeat(40));
    console.log(`RESULTS: ${passed} passed, ${failed} failed`);
    console.log(`Success Rate: ${((passed/(passed+failed))*100).toFixed(0)}%`);
    
    if (passed >= 3) {
        console.log('✅ SYSTEM OPERATIONAL');
    } else {
        console.log('❌ SYSTEM NEEDS ATTENTION');
    }
}

quickTest().catch(console.error);
