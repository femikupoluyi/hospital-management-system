const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = 8081;

// Serve static files
app.use(express.static(__dirname));

// Proxy API requests to backend
app.use('/api', createProxyMiddleware({
    target: 'http://localhost:5700',
    changeOrigin: true
}));

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'comprehensive-frontend.html'));
});

app.listen(PORT, () => {
    console.log(`Frontend server running on port ${PORT}`);
    console.log(`Access the app at http://localhost:${PORT}`);
});
