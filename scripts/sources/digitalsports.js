// DigitalSports (Vantage) source.
//
// Each school has its own subdomain. The schedule page runs FullCalendar,
// which POSTs to /pages/schedule/schedule-json.php with an entityId and a
// start/end unix range and gets clean JSON back.
//
// The range is honoured for ONE MONTH ONLY. A multi-month range does not
// error - it silently returns just part of the first month, which is why this
// walks month by month instead of asking for a year.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const LEVELS = { V: 'Varsity', JV: 'Junior Varsity', FR: 'Freshman', F: 'Freshman', MS: 'Middle School' };

// "Girls (V) Tennis [A]"  ->  gender, level, sport, marker
//
// The trailing marker says what kind of entry this is, and it is NOT always a
// single letter:
//   H  home game        A  away game       S  scrimmage
//   P  practice         T  transport       TE team event / club
//   FE facility event   SE school event (holidays, testing, prom)
// It has to be lifted off before anything else, because a title that does not
// match the "(V)" shape would otherwise carry the marker into the sport name
// and slip past the games-only filter - which is how proms and board meetings
// ended up on the calendar.
function parseTitle(title) {
    let raw = String(title || '').replace(/\s+/g, ' ').trim();

    let marker = '';
    const mk = raw.match(/\[([A-Za-z]{1,2})\]$/);
    if (mk) { marker = mk[1].toUpperCase(); raw = raw.slice(0, mk.index).trim(); }

    const m = raw.match(/^(Boys|Girls|Coed|Co-Ed|Mixed|Boys and girls)?\s*\(([A-Za-z/-]{1,12})\)\s*(.*)$/i);
    if (!m) return { gender: '', level: '', sport: raw, marker };
    return {
        gender: m[1] ? (/^(co|mixed|boys and)/i.test(m[1]) ? 'Coed' : m[1]) : '',
        level: LEVELS[(m[2] || '').toUpperCase()] || m[2] || '',
        sport: (m[3] || '').trim(),
        marker,
    };
}

// "3:00PM @ Villa Walsh Academy - VWA Tennis Courts -"  ->  opponent, venue, home
//
// The shape is TIME then "Vs"/"@" then opponent, then " - " and the venue, and
// usually a trailing " -". Two variants break a naive parse: the time can be a
// range ("6:30PM - 9:30PM @ ..."), whose separator looks like the venue
// separator, and "TBA" appears where a time should be. Rather than assume the
// marker is at the front, find it wherever it is and read from there.
function parseDescription(desc) {
    const txt = String(desc || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, ' ')
        .trim();

    const m = txt.match(/(?:^|\s)(@|Vs\.?)\s+(.+)$/i);
    if (!m) return { opponent: '', venue: '', home: null };

    const home = /^vs/i.test(m[1]);
    const parts = m[2].split(' - ');
    const clean = s => String(s || '')
        .replace(/^[\s\-–—]+/, '')      // a leading dash left by a time range
        .replace(/[\s\-–—]+$/, '')      // the trailing " -" the feed always adds
        .trim();

    return { opponent: clean(parts[0]), venue: clean(parts[1]), home };
}

// "2026-08-24 15:00:00" -> { date, time, label }
function parseStamp(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    if (!m) return null;
    const [, y, mo, d, hh, mm] = m;
    const date = `${y}-${mo}-${d}`;
    if (hh === undefined) return { date, time: '', label: '' };
    const h = Number(hh);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return { date, time: `${hh}:${mm}`, label: `${h12}:${mm} ${ampm}` };
}

// ArbiterLive wants "2026-8-1"; Date() will not parse that. Pad before use so
// both sources can be driven from the same range strings.
function isoPad(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return s;
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

function monthsBetween(start, end) {
    const out = [];
    const d = new Date(isoPad(start) + 'T00:00:00Z');
    const last = new Date(isoPad(end) + 'T00:00:00Z');
    if (isNaN(d) || isNaN(last)) throw new Error(`unparseable range ${start} .. ${end}`);
    while (d <= last) {
        const y = d.getUTCFullYear(), m = d.getUTCMonth();
        const first = new Date(Date.UTC(y, m, 1));
        const final = new Date(Date.UTC(y, m + 1, 0));
        out.push([Math.floor(first / 1000), Math.floor(final.setUTCHours(23, 59, 59) / 1000),
                  `${y}-${String(m + 1).padStart(2, '0')}`]);
        d.setUTCMonth(m + 1);
    }
    return out;
}

// The schedule page carries the FullCalendar config, which names the entityId.
async function discoverEntity(origin) {
    const url = `${origin}/pages/schedule/schedule.php`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`schedule page ${res.status}`);
    const html = await res.text();
    const id = (html.match(/entityId:\s*'(\d+)'/) || [])[1];
    const type = (html.match(/entityType:\s*'(\d+)'/) || [])[1] || '3';
    if (!id) throw new Error('entityId not found on schedule page');
    return { entityId: id, entityType: type };
}

async function fetchSchool(school, startDate, endDate, opts = {}) {
    const pause = opts.pauseMs == null ? 700 : opts.pauseMs;
    const origin = new URL(school.url).origin;
    const { entityId, entityType } = await discoverEntity(origin);

    const events = [];
    for (const [start, end, label] of monthsBetween(startDate, endDate)) {
        const res = await fetch(`${origin}/pages/schedule/schedule-json.php`, {
            method: 'POST',
            headers: {
                'User-Agent': UA,
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': `${origin}/pages/schedule/schedule.php`,
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            },
            body: new URLSearchParams({ entityId, entityType, start: String(start), end: String(end) }).toString(),
        });
        if (!res.ok) throw new Error(`${label}: events endpoint ${res.status}`);

        let rows;
        try { rows = await res.json(); } catch { throw new Error(`${label}: response was not JSON`); }
        if (!Array.isArray(rows)) throw new Error(`${label}: unexpected payload`);

        for (const e of rows) {
            const t = parseTitle(e.title);
            // Allow-list rather than deny-list. H and A are fixtures and S is a
            // scrimmage - all three are competitive events against an opponent
            // and belong on the calendar. Everything else the feed carries -
            // practices, transport, club meetings, facility bookings, school
            // holidays - is excluded, including any marker not seen before.
            const isGame = t.marker === 'H' || t.marker === 'A';
            const isScrimmage = t.marker === 'S';
            if (!isGame && !isScrimmage) continue;
            const when = parseStamp(e.start);
            if (!when) continue;
            const d = parseDescription(e.description);

            events.push({
                id: `ds:${entityId}:${e.id}`,
                date: when.date,
                time: when.time,
                timeLabel: when.label,
                sport: t.sport,
                level: t.level,
                gender: t.gender,
                school: school.name,
                opponent: d.opponent,
                // a scrimmage carries no H/A marker, so read the side from the
                // "@ X" / "Vs X" in the description instead
                home: t.marker === 'H' ? true : t.marker === 'A' ? false : d.home,
                kind: isScrimmage ? 'Scrimmage' : 'Game',
                status: '',
                source: 'digitalsports',
            });
        }
        if (pause) await new Promise(r => setTimeout(r, pause));
    }
    return events;
}

module.exports = { fetchSchool, parseTitle, parseDescription, parseStamp, monthsBetween, discoverEntity };
