// Append this run to the rolling refresh log.
//
// Every run appends, including one whose build failed, because this records that
// a check HAPPENED - not that the data changed. That distinction is the whole
// point: the site can then show the real cadence instead of a single relative
// timestamp that only moves when a game actually changes.
//
// Run: node scripts/log-refresh.js [success|failure]

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'refresh-log.json');
const KEEP = 72;                       // ~3 days at the cadence we ask for
const ok = (process.argv[2] || 'success') === 'success';

let log = {};
try { log = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* first run */ }
const checks = Array.isArray(log.checks) ? log.checks : [];

checks.unshift({ at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), ok });

fs.writeFileSync(FILE, JSON.stringify({
    _comment: 'Rolling log of schedule-refresh runs, newest first. ok=false means the run happened but the build failed, so the data is unchanged.',
    checks: checks.slice(0, KEEP),
}, null, 2) + '\n');

console.log(`logged a ${ok ? 'successful' : 'failed'} check; ${Math.min(checks.length, KEEP)} retained`);
