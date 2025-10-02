const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 4001;

// Serve static files
app.use(express.static(__dirname));

// Serve the HMS frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'hms-frontend-full.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`HMS Frontend Server running on port ${PORT}`);
    console.log(`Access the HMS at http://localhost:${PORT}`);
});
