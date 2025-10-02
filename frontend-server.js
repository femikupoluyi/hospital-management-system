const express = require('express');
const path = require('path');

const app = express();
const PORT = 8081;

// Serve static files
app.use(express.static('.'));

// Main route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'hms-final-working.html'));
});

app.listen(PORT, () => {
    console.log(`Frontend server running on port ${PORT}`);
    console.log(`Access the HMS at http://localhost:${PORT}`);
});
