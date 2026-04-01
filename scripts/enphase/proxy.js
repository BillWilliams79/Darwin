#!/usr/bin/env node
/**
 * proxy.js — Local CORS proxy for Enphase IQ Gateway
 *
 * The Enphase gateway doesn't send CORS headers, so browsers can't call it
 * directly from Darwin (https://www.darwin.one). This proxy:
 *   - Adds CORS headers to all responses
 *   - Forwards requests to the gateway with the JWT token
 *   - Runs on your local machine (home network required)
 *
 * Usage:
 *   node proxy.js [--port 8089] [--token-file ./enphase_token.txt]
 *
 * Then Darwin can call: http://localhost:8089/enphase/api/v1/production
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Config
const GATEWAY_IP = '192.168.50.236';
const DEFAULT_PORT = 8089;
const DEFAULT_TOKEN_FILE = path.join(__dirname, 'enphase_token.txt');

// Parse args
const args = process.argv.slice(2);
let port = DEFAULT_PORT;
let tokenFile = DEFAULT_TOKEN_FILE;
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') port = parseInt(args[i + 1], 10);
    if (args[i] === '--token-file') tokenFile = args[i + 1];
}

// Load token
if (!fs.existsSync(tokenFile)) {
    console.error(`ERROR: Token file not found: ${tokenFile}`);
    console.error('Run get-token.sh first to obtain a JWT token.');
    process.exit(1);
}
const TOKEN = fs.readFileSync(tokenFile, 'utf8').trim();
console.log(`Token loaded: ${TOKEN.substring(0, 20)}... (${TOKEN.length} chars)`);

// Start proxy server
const server = http.createServer((req, res) => {
    // CORS headers — allow Darwin and localhost
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // Strip /enphase prefix from path
    const gatewayPath = req.url.replace(/^\/enphase/, '') || '/home.json';

    console.log(`[${new Date().toISOString()}] ${req.method} ${gatewayPath}`);

    const options = {
        hostname: GATEWAY_IP,
        port: 443,
        path: gatewayPath,
        method: req.method,
        headers: {
            'Authorization': `Bearer ${TOKEN}`,
            'Accept': 'application/json',
        },
        rejectUnauthorized: false, // self-signed cert on gateway
    };

    const proxyReq = https.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, {
            'Content-Type': proxyRes.headers['content-type'] || 'application/json',
            'Access-Control-Allow-Origin': '*',
        });
        proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
        console.error(`Gateway error: ${err.message}`);
        res.writeHead(502);
        res.end(JSON.stringify({ error: 'Gateway unreachable', detail: err.message }));
    });

    proxyReq.end();
});

server.listen(port, '127.0.0.1', () => {
    console.log(`\nEnphase CORS proxy running at http://localhost:${port}`);
    console.log(`Gateway: https://${GATEWAY_IP}`);
    console.log('\nEndpoints (from Darwin):');
    console.log(`  http://localhost:${port}/enphase/api/v1/production`);
    console.log(`  http://localhost:${port}/enphase/api/v1/production/inverters`);
    console.log(`  http://localhost:${port}/enphase/production.json`);
    console.log(`  http://localhost:${port}/enphase/ivp/meters/readings`);
    console.log(`  http://localhost:${port}/enphase/home.json`);
    console.log('\nPress Ctrl+C to stop.\n');
});
