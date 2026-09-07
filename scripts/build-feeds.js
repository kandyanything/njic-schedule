// Build subscribable calendar feeds + an RSS feed from data/schedule.json.
//
// Output (all under /feeds, served at stable URLs so calendars auto-refresh):
//   feeds/all.ics                 - the whole conference
//   feeds/schools/<slug>.ics      - one school's games (home & away)
//   feeds/sports/<slug>.ics       - one sport across the conference
//   feeds/rss.xml                 - upcoming games as RSS
//   feeds/index.json              - manifest the site uses to build the menus
//
// Run: node scripts/build-feeds.js   (after build-schedule.js)
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SCHOOLS = require('./ds-schools.json');
const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'schedule.json'), 'utf8'));
const games = doc.games || [];
const OUT = path.join(ROOT, 'feeds');
fs.mkdirSync(path.join(OUT, 'schools'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'sports'), { recursive: true });

const norm = s => String(s || '').toLowerCase().replace(/\b(high school|high|school|regional|jr sr|the|academy)\b/g, '').replace(/[^a-z0-9]/g, '');
const slugify = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const xml = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// America/New_York VTIMEZONE so timed events land at the right local hour year-round.
const VTZ = [
  'BEGIN:VTIMEZONE', 'TZID:America/New_York',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'TZNAME:EDT',
  'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'TZNAME:EST',
  'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];

const DTSTAMP = (doc.generated || new Date().toISOString()).replace(/[-:]/g, '').replace(/\.\d+/, '').slice(0, 15) + 'Z';

function vevent(g) {
  const ymd = g.date.replace(/-/g, '');
  const lines = ['BEGIN:VEVENT', `UID:${(g.id || (g.date + g.school + g.opponent)).replace(/[^\w:.-]/g, '')}@njicathletics`, `DTSTAMP:${DTSTAMP}`];
  if (g.time) {
    const hm = g.time.replace(':', '') + '00';
    const end = new Date(`${g.date}T${g.time}:00`); end.setHours(end.getHours() + 2);
    const endHm = String(end.getHours()).padStart(2, '0') + String(end.getMinutes()).padStart(2, '0') + '00';
    lines.push(`DTSTART;TZID=America/New_York:${ymd}T${hm}`, `DTEND;TZID=America/New_York:${ymd}T${endHm}`);
  } else {
    const nx = new Date(`${g.date}T12:00:00Z`); nx.setUTCDate(nx.getUTCDate() + 1);
    lines.push(`DTSTART;VALUE=DATE:${ymd}`, `DTEND;VALUE=DATE:${nx.toISOString().slice(0, 10).replace(/-/g, '')}`);
  }
  const vs = g.home === false ? 'at' : 'vs';
  const opp = g.opponent || 'TBD';
  const detail = [g.level, g.gender, g.sport].filter(Boolean).join(' ');
  let sum = `${g.school} ${vs} ${opp}`;
  if (detail) sum += ` (${detail})`;
  if (g.status) sum = `[${g.status}] ` + sum;
  lines.push(`SUMMARY:${esc(sum)}`);
  lines.push(`DESCRIPTION:${esc(detail + (g.home === false ? ' - Away' : ' - Home') + (g.timeLabel ? ' - ' + g.timeLabel : ''))}`);
  if (g.status) lines.push('STATUS:CANCELLED');
  lines.push('END:VEVENT');
  return lines;
}

function calendar(name, list) {
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AthlitIQ//NJIC Schedule//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(name)}`, 'X-WR-TIMEZONE:America/New_York', ...VTZ];
  for (const g of list) out.push(...vevent(g));
  out.push('END:VCALENDAR');
  // fold long lines to 75 octets per RFC 5545, and use CRLF
  return out.map(l => l.length <= 74 ? l : l.replace(/(.{73})/g, '$1\r\n ')).join('\r\n') + '\r\n';
}

// A conference school's feed = every game it plays, home or away.
function schoolGames(name) {
  const k = norm(name);
  return games.filter(g => norm(g.school) === k || norm(g.opponent) === k || (g.schools || []).some(s => norm(s) === k));
}

const CONF = 'North Jersey Interscholastic Conference';
const nowUTC = new Date().toUTCString();
// RSS for any slice of games (per school / sport / level, or the whole conference).
function rssFor(title, desc, list, days, cap) {
  const t0 = new Date().toISOString().slice(0, 10);
  const h = new Date(); h.setDate(h.getDate() + days);
  const t1 = h.toISOString().slice(0, 10);
  const up = list.filter(g => g.date >= t0 && g.date <= t1)
    .sort((a, b) => (a.date === b.date ? (a.time || '99:99').localeCompare(b.time || '99:99') : a.date.localeCompare(b.date)));
  const it = up.slice(0, cap).map(g => {
    const vs = g.home === false ? 'at' : 'vs';
    const line = `${g.school} ${vs} ${g.opponent || 'TBD'} — ${[g.level, g.gender, g.sport].filter(Boolean).join(' ')}`;
    const when = new Date(`${g.date}T${g.time || '00:00'}:00-04:00`).toUTCString();
    const d = `${g.date}${g.timeLabel ? ' ' + g.timeLabel : ''} — ${g.status || 'Scheduled'}`;
    return `    <item>\n      <title>${xml(line)}</title>\n      <description>${xml(d)}</description>\n      <pubDate>${when}</pubDate>\n      <guid isPermaLink="false">${xml(g.id || line)}</guid>\n    </item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>${xml(title)}</title>\n    <link>https://njicathletics.org/</link>\n    <description>${xml(desc)}</description>\n    <lastBuildDate>${nowUTC}</lastBuildDate>\n${it}\n  </channel>\n</rss>\n`;
}

// ---- write feeds ----
fs.writeFileSync(path.join(OUT, 'all.ics'), calendar('NJIC — Full Conference Schedule', games));

const schoolFeeds = [];
for (const s of SCHOOLS) {
  const list = schoolGames(s.name);
  fs.writeFileSync(path.join(OUT, 'schools', s.slug + '.ics'), calendar('NJIC — ' + s.name, list));
  fs.writeFileSync(path.join(OUT, 'schools', s.slug + '.xml'), rssFor(CONF + ' — ' + s.name, 'Upcoming games for ' + s.name + '.', list, 60, 200));
  schoolFeeds.push({ name: s.name, slug: s.slug, path: 'feeds/schools/' + s.slug + '.ics', rss: 'feeds/schools/' + s.slug + '.xml', games: list.length });
}

const sportSet = [...new Set(games.map(g => g.sport))].sort();
const sportFeeds = [];
for (const sport of sportSet) {
  const slug = slugify(sport);
  const list = games.filter(g => g.sport === sport);
  fs.writeFileSync(path.join(OUT, 'sports', slug + '.ics'), calendar('NJIC — ' + sport, list));
  fs.writeFileSync(path.join(OUT, 'sports', slug + '.xml'), rssFor(CONF + ' — ' + sport, 'Upcoming ' + sport + ' games across ' + CONF + '.', list, 60, 300));
  sportFeeds.push({ name: sport, slug, path: 'feeds/sports/' + slug + '.ics', rss: 'feeds/sports/' + slug + '.xml', games: list.length });
}

// per (sport + level) feeds, e.g. "Varsity Boys Soccer"
const sportLevelFeeds = [];
const combos = {};
for (const g of games) { if (g.level) { const k = g.sport + "||" + g.level; (combos[k] = combos[k] || []).push(g); } }
for (const k of Object.keys(combos).sort()) {
  const [sport, level] = k.split("||");
  const slug = slugify(level) + "--" + slugify(sport);
  fs.writeFileSync(path.join(OUT, "sports", slug + ".ics"), calendar("NJIC — " + level + " " + sport, combos[k]));
  fs.writeFileSync(path.join(OUT, "sports", slug + ".xml"), rssFor(CONF + " — " + level + " " + sport, "Upcoming " + level + " " + sport + " games.", combos[k], 60, 300));
  sportLevelFeeds.push({ sport, level, name: level + " " + sport, slug, path: "feeds/sports/" + slug + ".ics", rss: "feeds/sports/" + slug + ".xml", games: combos[k].length });
}

// ---- conference-wide RSS (upcoming ~21 days) ----
const today = new Date().toISOString().slice(0, 10);
const horizon = new Date(); horizon.setDate(horizon.getDate() + 21);
const upCount = games.filter(g => g.date >= today && g.date <= horizon.toISOString().slice(0, 10)).length;
fs.writeFileSync(path.join(OUT, 'rss.xml'), rssFor(CONF + ' — Upcoming Games', 'Upcoming games across all ' + CONF + ' schools.', games, 21, 600));

fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({
  conference: CONF, generated: doc.generated, all: 'feeds/all.ics', rss: 'feeds/rss.xml',
  schools: schoolFeeds, sports: sportFeeds, sportLevels: sportLevelFeeds,
}, null, 2) + '\n');

console.log(`feeds for ${CONF}: all.ics (${games.length} games), ${schoolFeeds.length} school feeds, ${sportFeeds.length} sport feeds, ${sportLevelFeeds.length} sport+level feeds, rss (${Math.min(upCount, 600)})`);
