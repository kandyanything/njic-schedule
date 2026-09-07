// A plain static file server for looking at the site before it is published.
//
//   node scripts/preview-server.js [port]
//
// Serves the working tree as-is, so uncommitted changes show up immediately.
// Bound to localhost only - this is for looking at your own work, not for
// putting anything on a network. Ctrl-C to stop it.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.argv[2] || 8080);

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ics': 'text/calendar; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.pdf': 'application/pdf',
};

http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel.endsWith('/')) rel += 'index.html';

    // never serve anything outside the project directory
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }

    fs.readFile(file, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found: ' + rel);
            return;
        }
        res.writeHead(200, {
            'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
            // always fetch fresh, so a reload really shows the latest edit
            'Cache-Control': 'no-store',
        });
        res.end(data);
    });
}).listen(PORT, '127.0.0.1', () => {
    console.log('Preview running at http://localhost:' + PORT + '/');
    console.log('Serving ' + ROOT);
    console.log('Ctrl-C to stop.');
});
