// ArbiterLive source.
//
// The school calendar page is an empty shell; its SchoolCalendar bundle calls
// POST /School/GetEventsByEntity/ with a date range and gets JSON back. The
// endpoint scopes results by the session established on that school's own
// calendar page, so each school needs its own cookie and Referer.
//
// This is undocumented. If a school suddenly returns zero games, treat it as a
// failure rather than an empty schedule - see the check in build-schedule.js.

const ORIGIN = 'https://www.arbiterlive.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// "Varsity Girls Field Hockey vs. Parsippany Hills"
// "Junior Varsity Boys Football at Fair Lawn High School"
const LEVELS = ['Junior Varsity', 'Varsity', 'Freshman', 'Sophomore', 'Middle School', 'Youth'];
const GENDERS = ['Boys', 'Girls', 'Coed', 'Co-Ed'];

function parseTitle(title) {
    const raw = String(title || '');

    // A cancelled or postponed game appends a status badge to the title:
    //   ...at Morris Hills High School<br />&nbsp;
    //   <span class="calPopOverGameStatus btn-danger">Canceled</span>
    // Capture it, then strip the markup so it does not end up in the opponent.
    let status = '';
    const sm = raw.match(/calPopOverGameStatus[^>]*>\s*([^<]+?)\s*</i);
    if (sm) status = sm[1].trim();

    let rest = raw
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')          // "Passaic Arts & Science" is a real name
        .replace(/&#0?39;|&apos;/gi, "'")
        .replace(/&quot;/gi, '"')
        .replace(/\s+/g, ' ')
        .trim();

    if (status) {
        const esc = status.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        rest = rest.replace(new RegExp('\\s*' + esc + '\\s*$', 'i'), '').trim();
    }

    let level = '';
    for (const l of LEVELS) {
        if (rest.toLowerCase().startsWith(l.toLowerCase() + ' ')) { level = l; rest = rest.slice(l.length).trim(); break; }
    }

    let gender = '';
    for (const g of GENDERS) {
        if (rest.toLowerCase().startsWith(g.toLowerCase() + ' ')) { gender = g === 'Co-Ed' ? 'Coed' : g; rest = rest.slice(g.length).trim(); break; }
    }

    // the opponent follows " vs. " (home) or " at " (away)
    let opponent = '', home = null;
    const m = rest.match(/^(.*?)\s+(vs\.?|at)\s+(.*)$/i);
    let sport = rest;
    if (m) {
        sport = m[1].trim();
        home = /^vs/i.test(m[2]);
        opponent = m[3].trim();
    }
    return { sport, level, gender, opponent, home, status };
}

// "8/31/2026 6:00 PM" -> { date: '2026-08-31', time: '18:00', label: '6:00 PM' }
function parseStamp(s) {
    const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?/i);
    if (!m) return null;
    const [, mo, da, yr, hh, mm, ap] = m;
    const pad = n => String(n).padStart(2, '0');
    const date = `${yr}-${pad(mo)}-${pad(da)}`;
    if (!hh) return { date, time: '', label: '' };
    let h = Number(hh) % 12;
    if (/pm/i.test(ap)) h += 12;
    return { date, time: `${pad(h)}:${mm}`, label: `${Number(hh)}:${mm} ${ap.toUpperCase()}` };
}

// /Teams/Game/101941188/15188/4658917/93 -> 101941188
function gameIdFromUrl(url) {
    const m = String(url || '').match(/\/Teams\/Game\/(\d+)\//);
    return m ? m[1] : null;
}

// ArbiterLive's start/end pair is not a range so much as a starting point: the
// response stops after a while and the end date does not extend it. Asking for
// a year returns the first few weeks. So the range is walked a month at a time
// and the months are merged.
//
// endDate is EXCLUSIVE. Asking 2026-8-1..2026-8-31 returns nothing dated the
// 31st, which silently cost a day per window until it was measured: a year-long
// single request for Arts High School returned 147 games to the paged
// version's 139, and all 8 missing games fell on the last day of a month. Each
// window therefore asks up to the day AFTER its last day.
function monthWindows(startDate, endDate) {
    const p = d => { const [y, m, day] = String(d).split('-').map(Number); return new Date(y, m - 1, day); };
    const fmt = d => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    const a = p(startDate), b = p(endDate);
    const out = [];
    let y = a.getFullYear(), m = a.getMonth();
    while (y < b.getFullYear() || (y === b.getFullYear() && m <= b.getMonth())) {
        const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
        const lo = first < a ? a : first;
        const lastIncl = last > b ? b : last;
        // one day past the last date we actually want, because the end is exclusive
        const hi = new Date(lastIncl.getFullYear(), lastIncl.getMonth(), lastIncl.getDate() + 1);
        out.push([fmt(lo), fmt(hi)]);
        if (++m > 11) { m = 0; y++; }
    }
    return out;
}

function toEvents(detail, school) {
    const events = [];
    for (const e of detail) {
        // games only - the calendar also carries practices, and only some
        // schools publish them
        if (!/fc-event-type-Game/.test(e.className || '')) continue;

        const when = parseStamp(e.start);
        if (!when) continue;
        const t = parseTitle(e.title);

        events.push({
            // uniqueGameId is null on every record. The url is
            //   /Teams/Game/{gameId}/{entityId}/{teamId}/{sportId}
            // and that gameId IS shared by both schools in a fixture, which
            // makes it the key that collapses a game listed twice.
            id: gameIdFromUrl(e.url)
                ? `arb:${gameIdFromUrl(e.url)}`
                : `arb:${school.entityId}:${e.start}:${e.title}`,
            date: when.date,
            time: when.time,
            timeLabel: when.label,
            sport: t.sport,
            level: t.level,
            gender: t.gender,
            school: school.name,
            opponent: t.opponent,
            home: e.isAwayGame === true ? false : (t.home === null ? null : t.home),
            // ArbiterLive types events only as Game or Practice - there is no
            // scrimmage marker, so a scrimmage here is indistinguishable from a
            // game and is deliberately left untagged rather than guessed at.
            kind: 'Game',
            status: t.status || '',
            source: 'arbiterlive',
        });
    }
    return events;
}

async function fetchSchool(school, startDate, endDate, opts) {
    opts = opts || {};
    const pauseMs = opts.pauseMs == null ? 350 : opts.pauseMs;
    const calUrl = `${ORIGIN}/School/Calendar/${school.entityId}`;

    // 1. establish a session - the endpoint reads the school from it. One
    //    session serves every month window for this school.
    const seed = await fetch(calUrl, { headers: { 'User-Agent': UA } });
    if (!seed.ok) throw new Error(`calendar page ${seed.status}`);
    const cookie = (seed.headers.getSetCookie ? seed.headers.getSetCookie() : [])
        .map(c => c.split(';')[0]).join('; ');

    // 2. ask for the range, one month at a time
    const windows = monthWindows(startDate, endDate);
    const byId = new Map();
    const failures = [];

    for (const [lo, hi] of windows) {
        try {
            const res = await fetch(`${ORIGIN}/School/GetEventsByEntity/`, {
                method: 'POST',
                headers: {
                    'User-Agent': UA,
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': calUrl,
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    ...(cookie ? { Cookie: cookie } : {}),
                },
                body: new URLSearchParams({ startDate: lo, endDate: hi }).toString(),
            });
            if (!res.ok) throw new Error(`events endpoint ${res.status}`);
            const payload = await res.json();
            const detail = JSON.parse(payload.EventsFilteredDetailString || '[]');
            for (const ev of toEvents(detail, school)) {
                // A fixture can surface in two adjacent windows; keep one.
                if (!byId.has(ev.id)) byId.set(ev.id, ev);
            }
        } catch (err) {
            failures.push(`${lo}: ${err.message}`);
        }
        if (pauseMs) await new Promise(r => setTimeout(r, pauseMs));
    }

    // Every window failing is a broken fetch, not an empty season - let the
    // caller's ok-check see it. A few failing is worth saying out loud but is
    // not worth discarding the months that did come back.
    if (failures.length === windows.length) throw new Error(failures[0] || 'all windows failed');
    if (failures.length) console.log(`         ${school.name}: ${failures.length}/${windows.length} month windows failed`);

    return [...byId.values()];
}

module.exports = { fetchSchool, parseTitle, parseStamp, gameIdFromUrl, monthWindows };
