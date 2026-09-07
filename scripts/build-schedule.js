// Build data/schedule.json - every North Jersey Interscholastic Conference game we can reach,
// sorted by date then time, de-duplicated so a fixture listed by both schools
// appears once.
//
// Run: node scripts/build-schedule.js [startDate] [endDate]
// Dates are M/D-tolerant strings in the form YYYY-M-D.
//
// Covers all 41 member schools on DigitalSports (ds-schools.json).
// All schools confirmed on DigitalSports as of 2026-08; update ds-schools.json
// if any school migrates to a different platform.
//
// Athletic events only. Practices, scrimmages, transport, club meetings,
// facility bookings and school holidays are all excluded, as are non-athletic
// activities that travel like marching band.

const fs = require('fs');
const path = require('path');
const arbiter = require('./sources/arbiter');
const digitalsports = require('./sources/digitalsports');
const DS_SCHOOLS = require('./ds-schools.json');
const ical = require('./sources/ical');

// No NJIC schools use iCal feeds - all 35 are on DigitalSports.
// Leave ICS_SCHOOLS empty; update if a school is found to use an iCal feed instead.
const ICS_SCHOOLS = [];

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'schedule.json');
const PAUSE_MS = 1200;          // be a good citizen: one school at a time

// No NJIC schools are on ArbiterLive - all 35 use DigitalSports.
const ARBITER_SCHOOLS = [];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PAD = n => '  ' + String(n).padStart(4);

// A single network blip should not drop a whole school from the calendar -
// Randolph failed once with "fetch failed" and succeeded immediately after.
async function withRetry(label, fn, attempts = 3) {
    let last;
    for (let i = 1; i <= attempts; i++) {
        try { return await fn(); } catch (err) {
            last = err;
            if (i < attempts) {
                console.log(`         retry ${i}/${attempts - 1} for ${label}: ${err.message}`);
                await sleep(2500 * i);
            }
        }
    }
    throw last;
}

function defaultRange() {
    // the school year the season is currently in: Aug 1 through Jul 31
    const now = new Date();
    const y = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
    return [`${y}-8-1`, `${y + 1}-7-31`];
}

// Some non-athletic activities are scheduled as home/away events because they
// travel to competitions - marching band is the main one. They are not games,
// so they do not belong on an athletics calendar. Cheerleading and Unified
// Sports are athletics and stay.
const NOT_ATHLETIC = /^(band|marching band|concert band|jazz band|choir|chorus|orchestra|drama|debate|robotics|model un|mock trial|science olympiad)$/i;

function isAthletic(e) {
    return !NOT_ATHLETIC.test(String(e.sport || '').trim());
}

// The three sources name several sports differently, which matters twice over:
// the same fixture fails to de-duplicate, and the sport filter on the calendar
// would list one sport under two names. Mapped to a single spelling here rather
// than in each source, so there is one place to look.
const SPORT_ALIASES = {
    'hockey': 'Ice Hockey',
    'track and field': 'Track and Field',
    'lacrosse - boys': 'Lacrosse',
    'lacrosse - girls': 'Lacrosse',
    'unified coed soccer': 'Unified Sports Soccer',
    'unified sports soccer': 'Unified Sports Soccer',
};

function canonicalSport(e) {
    const key = String(e.sport || '').trim().toLowerCase();
    const mapped = SPORT_ALIASES[key];
    if (mapped) return { ...e, sport: mapped };
    return e;
}

// Some feeds put the venue where the opponent belongs, which reads as a school
// playing itself: "Randolph High School vs Randolph High School Main Gym".
// Blank the opponent only when the text BOTH begins with this school's own name
// AND ends in a venue word. Either test alone is unsafe - a co-op opponent like
// "Hanover Park/VWA" also starts with the school's name and is perfectly real,
// and plenty of genuine schools carry a venue-ish word (Asbury Park, Park Ridge).
const VENUE_TAIL = /\b(gym(nasium)?|field(s| ?house)?|courts?|turf|stadium|room|pool|track|rink|lanes|arena|diamond)\s*$/i;

// Midnight is not a kick-off time, it is a school leaving the time blank.
// 12:00 and 12:01 AM together account for 42 of the 57 pre-dawn fixtures in
// the feeds, across both platforms and fifteen schools - so it is a habit of
// the people entering them, not a fault in one parser. Publishing "12:00 AM"
// states something false; TBA states what is actually known.
//
// The other fifteen - 4:00 AM, 5:30 AM and so on - are most likely AM/PM slips
// at source. They are left alone, because correcting them would mean guessing
// at what was meant, and a wrong time is worse than an odd one.
function blankPlaceholderTime(e) {
    if (e.time !== '00:00' && e.time !== '00:01') return e;
    return { ...e, time: '', timeLabel: '' };
}

// A single-sex school has no reason to write the gender into its own fixture
// titles, and Delbarton does not: none of its 134 events name one. Its whole
// programme is boys', so the gender is known even though the feed never says
// it. This is a fact about the school rather than a guess about a fixture, so
// it belongs in a list of one rather than in a parser.
//
// Morristown Beard is co-educational and names a gender in most of its titles
// but not all. The ones it omits stay unknown, because there is nothing to
// read them from.
const SCHOOL_GENDER = {
    'Delbarton School': 'Boys',
};

function schoolGender(e) {
    if (e.gender) return e;
    const g = SCHOOL_GENDER[e.school];
    return g ? { ...e, gender: g } : e;
}

// Boys' and girls' soccer are two different sports to anyone looking for one
// of them, and lumping them together made the largest entry in every filter a
// mixture of both. A sport is split wherever the season actually has more than
// one gender playing it - which is eleven of them - and left alone where it
// does not, so football does not become boys' football and field hockey does
// not become girls' field hockey.
//
// Worked out from the fixtures rather than from a hard-coded list, so a sport
// that gains or loses a programme is handled without anyone remembering to
// come back here.
function computeSplitSet(games) {
    const genders = {};
    for (const g of games) {
        if (!g.gender) continue;
        (genders[g.sport] = genders[g.sport] || new Set()).add(g.gender);
    }
    return new Set(Object.keys(genders).filter(s => genders[s].size > 1));
}

// Apply a known split set to games - used by the hourly refresh, which reuses
// the split the last full rebuild worked out rather than recomputing it from a
// three-day window that may only ever see one gender play a sport.
function applySplit(games, split) {
    return games.map(g => (g.gender && split.has(g.sport))
        ? { ...g, sport: g.gender + ' ' + g.sport }
        : g);
}

function splitByGender(games) {
    const split = computeSplitSet(games);
    return { games: applySplit(games, split), split: [...split].sort() };
}

function stripSelfVenue(e) {
    const opp = String(e.opponent || '').trim();
    if (!opp) return e;

    // A team never plays itself. An exact name match is the feed repeating the
    // school where the opponent belongs - compared literally, not normalised,
    // so two genuinely different schools can never collide here.
    if (opp.toLowerCase() === String(e.school || '').trim().toLowerCase()) return { ...e, opponent: '' };

    if (!VENUE_TAIL.test(opp)) return e;
    const mine = norm(e.school), theirs = norm(opp);
    if (!mine || !theirs.startsWith(mine)) return e;
    return { ...e, opponent: '' };
}

// A fixture listed by both schools is one game. Prefer the richer record -
// the one that knows whether it is home, and names an opponent.
function score(e) {
    return (e.home !== null ? 2 : 0) + (e.opponent ? 1 : 0) + (e.time ? 1 : 0);
}

// Reduce a school name to its distinguishing word so "Morris Hills High School"
// and "Morris Hills HS" compare equal.
function norm(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/\b(high school|high|school|township|regional|academy|hs)\b/g, '')
        .replace(/[^a-z]/g, '');
}

function merge(target, e) {
    if (!target.schools.includes(e.school)) target.schools.push(e.school);
    return score(e) > score(target) ? { ...e, schools: target.schools } : target;
}

function dedupe(events) {
    // Pass 1: the shared ArbiterLive game id, which covers most of it.
    const byId = new Map();
    for (const e of events) {
        const prev = byId.get(e.id);
        byId.set(e.id, prev ? merge(prev, e) : { ...e, schools: [e.school] });
    }

    // Pass 2: a handful of fixtures carry a different id at each school - a
    // reschedule, or separately entered. The same two schools meeting in the
    // same sport, level and gender at the same moment is one game, so match on
    // that instead. The school pair is sorted, so home and away agree.
    const byFixture = new Map();
    const out = [];
    for (const e of byId.values()) {
        const pair = [norm(e.school), norm(e.opponent)].sort().join('~');
        const key = [e.date, e.time, norm(e.sport), norm(e.level), norm(e.gender), pair].join('|');
        if (!e.opponent || !e.time) { out.push(e); continue; }   // too thin to match safely
        const prev = byFixture.get(key);
        if (prev) { byFixture.set(key, merge(prev, e)); continue; }
        byFixture.set(key, e);
    }
    return out.concat([...byFixture.values()]);
}

// Fetches every school across all sources for the given range. Shared by the
// full nightly rebuild and the hourly lightweight refresh (update-recent.js),
// which just asks for a much narrower range.
async function fetchRaw(start, end) {
    const all = [];
    const report = [];

    for (const school of ARBITER_SCHOOLS) {
        try {
            const events = await withRetry(school.name, () => arbiter.fetchSchool(school, start, end));
            all.push(...events);
            report.push({ school: school.name, source: 'arbiterlive', games: events.length, ok: events.length > 0 });
            console.log(`  ${String(events.length).padStart(4)} games  ${school.name}`);
        } catch (err) {
            report.push({ school: school.name, source: 'arbiterlive', games: 0, ok: false, error: err.message });
            console.log(`  FAILED         ${school.name}: ${err.message}`);
        }
        await sleep(PAUSE_MS);
    }

    for (const school of DS_SCHOOLS) {
        try {
            const events = await withRetry(school.name, () => digitalsports.fetchSchool(school, start, end, { pauseMs: 600 }));
            all.push(...events);
            report.push({ school: school.name, source: 'digitalsports', games: events.length, ok: events.length > 0 });
            console.log(`  ${String(events.length).padStart(4)} games  ${school.name}`);
        } catch (err) {
            report.push({ school: school.name, source: 'digitalsports', games: 0, ok: false, error: err.message });
            console.log(`  FAILED         ${school.name}: ${err.message}`);
        }
        await sleep(PAUSE_MS);
    }

    for (const school of ICS_SCHOOLS) {
        try {
            const events = await withRetry(school.name, () => ical.fetchSchool(school, start, end));
            all.push(...events);
            report.push({ school: school.name, source: 'ical', games: events.length, ok: events.length > 0 });
            console.log(PAD(events.length) + ' games  ' + school.name);
        } catch (err) {
            report.push({ school: school.name, source: 'ical', games: 0, ok: false, error: err.message });
            console.log('  FAILED         ' + school.name + ': ' + err.message);
        }
        await sleep(PAUSE_MS);
    }

    return { all, report };
}

async function main() {
    const [start, end] = process.argv[2] && process.argv[3]
        ? [process.argv[2], process.argv[3]]
        : defaultRange();

    console.log(`range ${start} .. ${end}`);
    const { all, report } = await fetchRaw(start, end);

    const normalised = all.map(canonicalSport).map(schoolGender)
        .map(stripSelfVenue).map(blankPlaceholderTime).filter(isAthletic);

    // Split before de-duplication, so a boys' and a girls' fixture between the
    // same two schools at the same hour can never be mistaken for one another.
    const { games: athletic, split } = splitByGender(normalised);
    console.log('  split by gender: ' + split.join(', '));
    const dropped = all.length - athletic.length;

    // An unknown time sorts to the end of the day rather than to midnight,
    // where it would sit above every real fixture.
    const byTime = (a, b) => (a.time || '99:99').localeCompare(b.time || '99:99');
    const games = dedupe(athletic).sort((a, b) =>
        a.date === b.date ? byTime(a, b) : a.date.localeCompare(b.date));

    const byDate = {};
    for (const g of games) (byDate[g.date] = byDate[g.date] || []).push(g);

    // A school that returns nothing is far more likely to be a broken fetch than
    // a school with no games all year, so surface it rather than silently
    // publishing a thinner calendar.
    const empty = report.filter(r => !r.ok);

    fs.writeFileSync(OUT, JSON.stringify({
        _comment: 'Generated by scripts/build-schedule.js - do not edit by hand. Covers all 35 NJIC member schools on DigitalSports. Games only - practices are filtered out. Sorted by date then start time, de-duplicated so a fixture listed by both schools appears once. Cancelled games are kept and carry status.',
        generated: new Date().toISOString(),
        range: { start, end },
        sources: report,
        coverage: { schoolsFetched: report.length, schoolsInConference: 35, complete: report.length >= 35 },
        counts: { raw: all.length, nonAthleticDropped: dropped, deduped: games.length, dates: Object.keys(byDate).length },
        // The sports that needed a gender prefix this run, e.g. "Tennis" ->
        // "Boys Tennis" / "Girls Tennis". Persisted so the hourly refresh
        // (update-recent.js) applies the same naming to a short window.
        splitSports: split,
        games,
    }, null, 2) + '\n');

    console.log(`\n  raw ${all.length} -> ${games.length} after de-duplication`);
    console.log(`  ${Object.keys(byDate).length} dates covered`);
    console.log(`  written ${path.relative(ROOT, OUT)}`);
    if (empty.length) {
        console.log(`\n  WARNING - ${empty.length} source(s) returned nothing:`);
        empty.forEach(r => console.log(`    ${r.school}${r.error ? ' - ' + r.error : ''}`));
    }
}

if (require.main === module) {
    main().catch(e => { console.error('FAILED:', e); process.exit(1); });
}

module.exports = {
    fetchRaw, canonicalSport, schoolGender, stripSelfVenue, blankPlaceholderTime,
    isAthletic, dedupe, splitByGender, applySplit, computeSplitSet,
    ARBITER_SCHOOLS, DS_SCHOOLS, ICS_SCHOOLS, defaultRange,
};
