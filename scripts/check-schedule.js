// Guard rail for the nightly rebuild.
//
// The dangerous failure is not a crash - it is a build that succeeds while
// quietly returning far less than it should, because a source changed shape.
// That would publish a gutted calendar without anyone noticing. This compares
// the fresh build against the version already committed and fails loudly if it
// looks wrong.
//
// Run: node scripts/check-schedule.js <previous-schedule.json>
// Exits non-zero to stop the workflow before anything is committed.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const fresh = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'schedule.json'), 'utf8'));

const MIN_GAMES = 2000;          // a real season is many thousands
const MIN_SOURCES_OK = 35;       // of 39; a couple of schools may legitimately fail
const MAX_DROP = 0.30;           // vs the previous build

const problems = [];
const notes = [];

const games = fresh.counts ? fresh.counts.deduped : (fresh.games || []).length;
const okSources = (fresh.sources || []).filter(s => s.ok).length;
const totalSources = (fresh.sources || []).length;

notes.push(`games ${games}, sources ok ${okSources}/${totalSources}`);

if (games < MIN_GAMES) {
    problems.push(`only ${games} games - expected at least ${MIN_GAMES}`);
}
if (okSources < MIN_SOURCES_OK) {
    const failed = (fresh.sources || []).filter(s => !s.ok).map(s => s.school);
    problems.push(`only ${okSources}/${totalSources} sources returned data; failed: ${failed.join(', ')}`);
}

// compare against whatever was committed before this run
const prevPath = process.argv[2];
if (prevPath && fs.existsSync(prevPath)) {
    try {
        const prev = JSON.parse(fs.readFileSync(prevPath, 'utf8'));
        const prevGames = prev.counts ? prev.counts.deduped : (prev.games || []).length;
        if (prevGames > 0) {
            const drop = (prevGames - games) / prevGames;
            notes.push(`previous build had ${prevGames}`);
            if (drop > MAX_DROP) {
                problems.push(`games fell ${(drop * 100).toFixed(0)}% (${prevGames} -> ${games}), more than the ${MAX_DROP * 100}% allowed`);
            }
        }
    } catch (e) {
        notes.push(`could not read previous build for comparison: ${e.message}`);
    }
} else {
    notes.push('no previous build to compare against');
}

// every game needs the fields the calendar renders
const sample = (fresh.games || []).slice(0, 500);
const malformed = sample.filter(g => !g.date || !g.school || !g.sport);
if (malformed.length) {
    problems.push(`${malformed.length} of the first ${sample.length} games are missing date, school or sport`);
}

notes.forEach(n => console.log(`  ${n}`));

if (problems.length) {
    console.error('\nSCHEDULE CHECK FAILED:');
    problems.forEach(p => console.error(`  - ${p}`));
    console.error('\nNothing committed. Investigate before publishing.');
    process.exit(1);
}
console.log('  checks passed');
