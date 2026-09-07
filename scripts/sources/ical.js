// Generic iCal source, used for schools that publish a calendar feed rather
// than running ArbiterLive or DigitalSports.
//
// Two things make this messier than the other two sources. A general school
// calendar carries far more than games - practices, "Training Room CLOSED",
// days off - so only events that name an opponent are kept. And DTSTART is in
// UTC, so it must be converted to Eastern or every time is hours out.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TZ = 'America/New_York';

const LEVELS = [
    ['Junior Varsity', 'Junior Varsity'], ['Jr. Varsity', 'Junior Varsity'], ['JV', 'Junior Varsity'],
    ['Varsity', 'Varsity'], ['V', 'Varsity'], ['Freshman', 'Freshman'],
    ['Middle School', 'Middle School'], ['MS', 'Middle School'],
];
const GENDERS = ['Boys/Girls', 'Boys', 'Girls', 'Boy', 'Girl', 'Coed', 'Co-Ed'];

function unfold(text) {
    return text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
}

function icalUnescape(s) {
    return String(s || '')
        .replace(/\\n/gi, ' ')
        .replace(/\\,/g, ',')
        .replace(/\\;/g, ';')
        .replace(/\\\\/g, '\\')
        .replace(/\s+/g, ' ')
        .trim();
}

// 20260914T213000Z (UTC) -> Eastern date/time parts
function toEastern(stamp) {
    const m = String(stamp || '').match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
    if (!m) return null;
    const [, y, mo, d, hh, mm, ss, z] = m;
    if (!hh) return { date: `${y}-${mo}-${d}`, time: '', label: '' };   // all-day

    // Floating (no Z) times are already local; UTC ones need converting.
    const dt = z
        ? new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm, +(ss || 0)))
        : new Date(+y, +mo - 1, +d, +hh, +mm, +(ss || 0));

    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(dt).reduce((a, p) => (a[p.type] = p.value, a), {});

    const H = parts.hour === '24' ? '00' : parts.hour;
    const h12 = (Number(H) % 12) === 0 ? 12 : Number(H) % 12;
    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        time: `${H}:${parts.minute}`,
        label: `${h12}:${parts.minute} ${Number(H) >= 12 ? 'PM' : 'AM'}`,
    };
}

// "Volleyball Junior Varsity vs. Pequannock"  /  "MS Girls Soccer A @ Gill St. Bernard's"
function parseSummary(summary, stripPrefix) {
    let rest = icalUnescape(summary);

    // Sidearm prefixes every title with the school's own name:
    //   "Delbarton School  Varsity Football vs Irvington"
    if (stripPrefix) {
        const esc = stripPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        rest = rest.replace(new RegExp('^' + esc + '\\s*', 'i'), '').trim();
    }

    let status = '';
    const cm = rest.match(/^\s*(CANCELLED|CANCELED|POSTPONED)\s*:\s*/i);
    if (cm) { status = cm[1][0].toUpperCase() + cm[1].slice(1).toLowerCase(); rest = rest.slice(cm[0].length).trim(); }

    // A scrimmage is a competitive event against an opponent, so it belongs on
    // the calendar - but tagged, and with the word taken out of the sport name
    // so it does not become a sport called "Football Scrimmage".
    let kind = 'Game';
    if (/\bscrimmages?\b/i.test(rest)) {
        kind = 'Scrimmage';
        rest = rest.replace(/\bscrimmages?\b/gi, ' ').replace(/\s+/g, ' ').trim();
    }

    // a league or event code sometimes leads the title, e.g. "SBMSB: MS Boys..."
    rest = rest.replace(/^[A-Z]{3,8}:\s*/, '').trim();

    // An opponent marker is what makes this a game rather than a practice.
    // "at" matters as much as "@" - Sidearm writes away fixtures as
    // "Junior Varsity Soccer at Randolph", and omitting it drops every away
    // game while leaving the home ones, which looks like working data.
    // The negative lookahead matters: "Field Hockey V @ Hun" uses V for Varsity,
    // and without it the bare "v" alternative matches there, leaving the
    // opponent as "@ Hun". Refusing a marker that is followed by another marker
    // makes the match fall through to the real one.
    const m = rest.match(/^(.*?)\s+(vs\.?|@|at|v)\s+(?!@\s|at\s|vs?\.?\s)(.*)$/i);
    if (!m) return null;

    let head = m[1].trim();
    const opponent = m[3].replace(/\s+/g, ' ').trim();
    const home = /^v/i.test(m[2]);      // "vs." / "v" are home; "@" and "at" are away

    // "Varsity and JV" is one fixture covering both. Drop the trailing half
    // first, or the JV token matches before Varsity does and the sport name
    // ends up carrying the leftovers.
    head = head.replace(/\s+and\s+(JV|Junior Varsity)\b/i, '').trim();

    let level = '';
    for (const [needle, canonical] of LEVELS) {
        const re = new RegExp(`(^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'i');
        if (re.test(head)) { level = canonical; head = head.replace(re, ' ').trim(); break; }
    }

    let gender = '';
    for (const g of GENDERS) {
        const re = new RegExp(`(^|\\s)${g.replace(/\//g, '\\/')}(\\s|$)`, 'i');
        if (re.test(head)) { gender = g; head = head.replace(re, ' ').trim(); break; }
    }
    // the feed carries singular typos and a hyphenated spelling
    if (/^girl$/i.test(gender)) gender = 'Girls';
    if (/^boy$/i.test(gender)) gender = 'Boys';
    if (/^co-?ed$/i.test(gender)) gender = 'Coed';

    // A lone A or B is a team designation - "MS Girls Soccer A", "MS Boys A
    // Soccer" - and belongs to neither the sport nor the level.
    let sport = head
        .replace(/(^|\s)[AB](\s|$)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    // A second level word occasionally trails the sport where the first pass
    // already took one, e.g. "Tennis Varsity".
    sport = sport.replace(/\s+(Varsity|Junior Varsity|JV|Freshman)$/i, '').trim();

    // Typos and inconsistent naming in the source calendar. Only obvious
    // one-for-one corrections belong here - not guesses about event names.
    const FIXES = { basketbal: 'Basketball', hockey: 'Ice Hockey' };
    sport = FIXES[sport.toLowerCase()] || sport;

    if (!sport) return null;

    return { sport, level, gender, opponent, home, status, kind };
}

async function fetchSchool(school, startDate, endDate) {
    const res = await fetch(school.ics, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`ics ${res.status}`);
    const body = unfold(await res.text());
    if (!/BEGIN:VCALENDAR/.test(body)) throw new Error('response was not an iCalendar feed');

    const from = String(startDate).replace(/-(\d)(?!\d)/g, '-0$1');
    const to = String(endDate).replace(/-(\d)(?!\d)/g, '-0$1');

    const events = [];
    for (const chunk of body.split('BEGIN:VEVENT').slice(1)) {
        const field = k => {
            const m = chunk.match(new RegExp(`^${k}[^:\\r\\n]*:(.*)$`, 'm'));
            return m ? m[1].trim() : '';
        };
        const when = toEastern(field('DTSTART'));
        if (!when) continue;
        if (when.date < from || when.date > to) continue;

        const parsed = parseSummary(field('SUMMARY'), school.stripPrefix);
        if (!parsed) continue;                       // no opponent - not a game
        if (!when.time) continue;                    // all-day entries are not fixtures

        events.push({
            id: `ics:${school.name}:${field('UID') || when.date + when.time + parsed.sport}`,
            date: when.date,
            time: when.time,
            timeLabel: when.label,
            sport: parsed.sport,
            level: parsed.level,
            gender: parsed.gender,
            school: school.name,
            opponent: parsed.opponent,
            home: parsed.home,
            kind: parsed.kind || 'Game',
            status: parsed.status,
            source: 'ical',
        });
    }
    return events;
}

module.exports = { fetchSchool, parseSummary, toEastern };
