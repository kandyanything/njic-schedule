// NJIC Conference Schedule — loads the split month files, renders an upcoming
// agenda and a month calendar, filters client-side, and wires the subscribe /
// export (.ics) actions to the static feeds.
(function () {
  'use strict';
  var DATA = 'data/schedule/', FEEDS = 'feeds/';
  var ALL = [];               // every loaded game
  var INDEX = null, FEEDMAN = null, SCHOOL_PATH = {}, SPORT_BY_SLUG = {};
  var state = { view: 'upcoming', sport: '', school: '', level: '', q: '', days: 10, calMonth: null, selDate: null };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // ---- dates ----
  function easternToday() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  var TODAY = easternToday();
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function parseDate(d) { return new Date(d + 'T12:00:00'); }
  function dayLabel(d) {
    var dt = parseDate(d);
    if (d === TODAY) return { big: 'Today', sub: DOW[dt.getDay()] + ' · ' + MON[dt.getMonth()].slice(0, 3) + ' ' + dt.getDate(), today: true };
    return { big: DOW[dt.getDay()], sub: MON[dt.getMonth()].slice(0, 3) + ' ' + dt.getDate() + ', ' + dt.getFullYear(), today: false };
  }
  function relTime(iso) {
    if (!iso) return '—';
    var mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 60) return Math.max(1, mins) + 'm ago';
    var h = Math.round(mins / 60); if (h < 24) return h + 'h ago';
    return Math.round(h / 24) + 'd ago';
  }

  // ---- load ----
  function loadJSON(u) { return fetch(u, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); }); }
  function init() {
    Promise.all([
      loadJSON(DATA + 'index.json').catch(function () { return null; }),
      loadJSON(FEEDS + 'index.json').catch(function () { return null; }),
    ]).then(function (res) {
      INDEX = res[0]; FEEDMAN = res[1];
      if (!INDEX) { showError(); return; }
      fillStats();
      var months = INDEX.months || [];
      return Promise.all(months.map(function (m) { return loadJSON(DATA + m + '.json').then(function (d) { return d.games || []; }).catch(function () { return []; }); }))
        .then(function (lists) {
          lists.forEach(function (g) { ALL = ALL.concat(g); });
          buildFilters();
          buildSubscribe();
          wire();
          render();
          maybeAutoSub();
        });
    });
  }
  function showError() { var a = $('.agenda'); if (a) a.innerHTML = '<p class="empty">The schedule could not be loaded. Please try again shortly.</p>'; }

  function fillStats() {
    var c = (INDEX.counts || {});
    setStat('games', (c.deduped || ALL.length || 0).toLocaleString());
    setStat('sports', (INDEX.sports || []).length || '—');
    setStat('updated', relTime(INDEX.generated));
    var fu = $('.foot-updated'); if (fu && INDEX.generated) fu.textContent = 'Last updated ' + relTime(INDEX.generated) + '.';
  }
  function setStat(k, v) { var el = $('[data-stat="' + k + '"]'); if (el) el.textContent = v; }

  // ---- filters ----
  function buildFilters() {
    var sports = INDEX.sports && INDEX.sports.length ? INDEX.sports : uniq(ALL.map(function (g) { return g.sport; })).sort();
    fillSelect($('#f-sport'), sports);
    var schools = (FEEDMAN && FEEDMAN.schools) ? FEEDMAN.schools.map(function (s) { return s.name; }) : uniq(ALL.map(function (g) { return g.school; })).sort();
    fillSelect($('#f-school'), schools);
    var order = ['Varsity', 'Junior Varsity', 'Freshman', 'Middle School'];
    var levels = uniq(ALL.map(function (g) { return g.level; }).filter(Boolean)).sort(function (a, b) { return (order.indexOf(a) + 1 || 9) - (order.indexOf(b) + 1 || 9); });
    fillSelect($('#f-level'), levels);
  }
  function fillSelect(sel, items) { if (!sel) return; items.forEach(function (v) { var o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); }); }
  function uniq(a) { return a.filter(function (v, i) { return v && a.indexOf(v) === i; }); }

  function match(g) {
    if (state.sport && g.sport !== state.sport) return false;
    if (state.level && g.level !== state.level) return false;
    if (state.school && g.school !== state.school && g.opponent !== state.school) return false;
    if (state.q) { var q = state.q.toLowerCase(); if ((g.school || '').toLowerCase().indexOf(q) < 0 && (g.opponent || '').toLowerCase().indexOf(q) < 0) return false; }
    return true;
  }

  // ---- render ----
  function render() {
    $('.filter-clear').hidden = !(state.sport || state.school || state.level || state.q);
    if (state.view === 'upcoming') renderUpcoming(); else renderCalendar();
  }

  function teamHtml(name, logo, isHome) {
    return '<span class="team' + (isHome ? ' home' : '') + '">' +
      (logo ? '<img class="team-logo" src="images/logos/optimized/' + logo + '.png" alt="" loading="lazy" onerror="this.remove()">' : '') +
      '<span class="team-name">' + esc(name) + '</span></span>';
  }
  function gameEl(g) {
    var el = document.createElement('div');
    el.className = 'game' + (g.status ? ' is-off' : '');
    var away = g.home === false;
    el.innerHTML =
      '<div class="game-time">' + (g.timeLabel ? esc(g.timeLabel) : 'TBA') + '<small>' + (away ? 'Away' : 'Home') + '</small></div>' +
      '<div class="game-match"><div class="game-teams">' +
      teamHtml(g.school, g.schoolLogo, !away) +
      '<span class="vs">' + (away ? 'at' : 'vs') + '</span>' +
      teamHtml(g.opponent || 'TBD', g.oppLogo, away) + '</div>' +
      '<div class="game-meta">' +
      '<span class="pill pill--sport">' + esc([g.gender, g.sport].filter(Boolean).join(' ')) + '</span>' +
      (g.level ? '<span class="pill">' + esc(g.level) + '</span>' : '') +
      (g.status ? '<span class="pill pill--off">' + esc(g.status) + '</span>' : '') +
      '</div></div>' +
      '<div class="game-side ' + (away ? '' : 'home') + '">' + (away ? '@ ' : 'vs ') + '</div>';
    return el;
  }

  function renderUpcoming() {
    var wrap = $('.view-upcoming'), agenda = $('.agenda', wrap), empty = $('.empty', wrap), more = $('.load-more', wrap);
    var games = ALL.filter(function (g) { return g.date >= TODAY && match(g); })
      .sort(function (a, b) { return a.date === b.date ? (a.time || '99:99').localeCompare(b.time || '99:99') : a.date.localeCompare(b.date); });
    agenda.innerHTML = '';
    if (!games.length) { empty.hidden = false; more.hidden = true; return; }
    empty.hidden = true;
    var byDate = groupBy(games, 'date');
    var dates = Object.keys(byDate).sort();
    var shown = dates.slice(0, state.days);
    shown.forEach(function (d) {
      var lab = dayLabel(d);
      var h = document.createElement('div'); h.className = 'day-head' + (lab.today ? ' is-today' : '');
      h.innerHTML = '<b>' + esc(lab.big) + '</b><span>' + esc(lab.sub) + '</span><em>' + byDate[d].length + ' game' + (byDate[d].length > 1 ? 's' : '') + '</em>';
      agenda.appendChild(h);
      byDate[d].forEach(function (g) { agenda.appendChild(gameEl(g)); });
    });
    more.hidden = shown.length >= dates.length;
  }

  function renderCalendar() {
    var wrap = $('.view-calendar');
    if (!state.calMonth) state.calMonth = (INDEX.months || []).filter(function (m) { return m >= TODAY.slice(0, 7); })[0] || (INDEX.months || [])[0] || TODAY.slice(0, 7);
    var m = state.calMonth, y = +m.slice(0, 4), mo = +m.slice(5, 7) - 1;
    $('.cal-title', wrap).textContent = MON[mo] + ' ' + y;
    var grid = $('.cal-grid', wrap); grid.innerHTML = '';
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(function (d) { var c = document.createElement('div'); c.className = 'cal-dow'; c.textContent = d; grid.appendChild(c); });
    var first = new Date(y, mo, 1).getDay(), days = new Date(y, mo + 1, 0).getDate();
    var counts = filteredDateCounts(m);
    for (var i = 0; i < first; i++) { var e = document.createElement('div'); e.className = 'cal-cell empty-cell'; grid.appendChild(e); }
    for (var d = 1; d <= days; d++) {
      var ds = m + '-' + String(d).padStart(2, '0');
      var n = counts[ds] || 0;
      var cell = document.createElement('div');
      cell.className = 'cal-cell' + (n ? ' has-games' : '') + (ds === TODAY ? ' is-today' : '') + (ds === state.selDate ? ' is-selected' : '');
      cell.innerHTML = '<span class="cal-num">' + d + '</span>' + (n ? '<span class="cal-count"><b>' + n + '</b> game' + (n > 1 ? 's' : '') + '</span>' : '');
      if (n) { cell.setAttribute('data-date', ds); cell.setAttribute('role', 'button'); cell.setAttribute('tabindex', '0'); }
      grid.appendChild(cell);
    }
    renderCalDay();
  }
  function filteredDateCounts(month) {
    var c = {};
    ALL.forEach(function (g) { if (g.date.slice(0, 7) === month && match(g)) c[g.date] = (c[g.date] || 0) + 1; });
    return c;
  }
  function renderCalDay() {
    var box = $('.cal-day');
    if (!state.selDate) { box.innerHTML = '<p class="cal-hint">Pick a date above to see that day&rsquo;s games.</p>'; return; }
    var games = ALL.filter(function (g) { return g.date === state.selDate && match(g); })
      .sort(function (a, b) { return (a.time || '99:99').localeCompare(b.time || '99:99'); });
    var lab = dayLabel(state.selDate);
    box.innerHTML = '';
    var h = document.createElement('div'); h.className = 'day-head' + (lab.today ? ' is-today' : '');
    h.innerHTML = '<b>' + esc(lab.big) + '</b><span>' + esc(lab.sub) + '</span><em>' + games.length + ' game' + (games.length !== 1 ? 's' : '') + '</em>';
    box.appendChild(h);
    if (!games.length) { box.insertAdjacentHTML('beforeend', '<p class="empty">No games match those filters on this day.</p>'); return; }
    games.forEach(function (g) { box.appendChild(gameEl(g)); });
  }

  function groupBy(arr, k) { var o = {}; arr.forEach(function (x) { (o[x[k]] = o[x[k]] || []).push(x); }); return o; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // ---- subscribe / export ----
  function absUrl(rel) { return location.origin.replace(/\/$/, '') + '/' + rel.replace(/^\//, ''); }
  function allFeed() { return (FEEDMAN && FEEDMAN.all) || 'feeds/all.ics'; }
  function buildSubscribe() {
    var scope = $('#sub-scope'), lvl = $('#sub-level');
    if (FEEDMAN) {
      var sg = $('optgroup[data-group="schools"]', scope), pg = $('optgroup[data-group="sports"]', scope);
      (FEEDMAN.schools || []).forEach(function (s) { SCHOOL_PATH[s.slug] = s; var o = document.createElement('option'); o.value = 'school:' + s.slug; o.textContent = s.name; sg.appendChild(o); });
      (FEEDMAN.sports || []).forEach(function (s) { SPORT_BY_SLUG[s.slug] = s; var o = document.createElement('option'); o.value = 'sport:' + s.slug; o.textContent = s.name; pg.appendChild(o); });
      var order = ['Varsity', 'Junior Varsity', 'Freshman', 'Middle School'];
      var levels = uniq((FEEDMAN.sportLevels || []).map(function (x) { return x.level; })).sort(function (a, b) { return (order.indexOf(a) + 1 || 9) - (order.indexOf(b) + 1 || 9); });
      fillSelect(lvl, levels);
    }
    scope.addEventListener('change', updateSubscribe);
    lvl.addEventListener('change', updateSubscribe);
    updateSubscribe();
  }
  function currentFeedPath() {
    var v = $('#sub-scope').value, lvl = $('#sub-level').value;
    if (v.indexOf('school:') === 0) { var sc = SCHOOL_PATH[v.slice(7)]; return sc ? sc.path : allFeed(); }
    if (v.indexOf('sport:') === 0) {
      var sp = SPORT_BY_SLUG[v.slice(6)];
      if (sp && lvl) { var mm = (FEEDMAN.sportLevels || []).filter(function (x) { return x.sport === sp.name && x.level === lvl; })[0]; if (mm) return mm.path; }
      return sp ? sp.path : allFeed();
    }
    return allFeed();
  }
  function updateSubscribe() {
    $('.sub-level').hidden = $('#sub-scope').value.indexOf('sport:') !== 0;
    var path = currentFeedPath(), https = absUrl(path), webcal = https.replace(/^https?:/, 'webcal:');
    $('[data-sub="apple"]').href = webcal;
    $('[data-sub="outlook"]').href = 'https://outlook.live.com/calendar/0/addfromweb?url=' + encodeURIComponent(https) + '&name=' + encodeURIComponent('NJIC');
    $('[data-sub="google"]').href = 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(webcal);
    $('[data-sub="download"]').href = path;
    $('.sub-url').value = https;
  }

  function icsFromGames(list, name) {
    var VTZ = ['BEGIN:VTIMEZONE', 'TZID:America/New_York',
      'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'TZNAME:EDT', 'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
      'BEGIN:STANDARD', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'TZNAME:EST', 'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD', 'END:VTIMEZONE'];
    var out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AthlitIQ//NJIC Schedule//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:' + name, 'X-WR-TIMEZONE:America/New_York'].concat(VTZ);
    var esc2 = function (s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); };
    list.forEach(function (g, i) {
      var ymd = g.date.replace(/-/g, ''), vs = g.home === false ? 'at' : 'vs';
      out.push('BEGIN:VEVENT', 'UID:njic-' + ymd + '-' + i + '@view', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '').slice(0, 15) + 'Z');
      if (g.time) {
        var hm = g.time.replace(':', '') + '00';
        var end = new Date(g.date + 'T' + g.time + ':00'); end.setHours(end.getHours() + 2);
        var eh = String(end.getHours()).padStart(2, '0') + String(end.getMinutes()).padStart(2, '0') + '00';
        out.push('DTSTART;TZID=America/New_York:' + ymd + 'T' + hm, 'DTEND;TZID=America/New_York:' + ymd + 'T' + eh);
      } else out.push('DTSTART;VALUE=DATE:' + ymd);
      out.push('SUMMARY:' + esc2(g.school + ' ' + vs + ' ' + (g.opponent || 'TBD') + ' (' + [g.level, g.gender, g.sport].filter(Boolean).join(' ') + ')'));
      if (g.status) out.push('STATUS:CANCELLED');
      out.push('END:VEVENT');
    });
    out.push('END:VCALENDAR');
    return out.join('\r\n');
  }
  function exportView() {
    var games = ALL.filter(function (g) { return g.date >= TODAY && match(g); })
      .sort(function (a, b) { return a.date === b.date ? (a.time || '99:99').localeCompare(b.time || '99:99') : a.date.localeCompare(b.date); });
    var name = 'NJIC' + (state.school ? ' — ' + state.school : '') + (state.sport ? ' — ' + state.sport : '');
    var blob = new Blob([icsFromGames(games, name)], { type: 'text/calendar' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'njic-schedule.ics'; document.body.appendChild(a); a.click(); a.remove();
  }

  function printView() {
    var games = ALL.filter(function (g) { return g.date >= TODAY && match(g); })
      .sort(function (a, b) { return a.date === b.date ? (a.time || '99:99').localeCompare(b.time || '99:99') : a.date.localeCompare(b.date); });
    var scope = [state.school, state.sport, state.level].filter(Boolean).join(' · ') || 'All schools · all sports';
    var byDate = groupBy(games, 'date');
    var gen = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    var html = '<div class="print-head"><h1>North Jersey Interscholastic Conference</h1>' +
      '<h2>' + esc(scope) + '</h2><p>' + games.length + ' upcoming game' + (games.length !== 1 ? 's' : '') + ' · as of ' + gen + '</p></div>';
    Object.keys(byDate).sort().forEach(function (d) {
      var lab = dayLabel(d);
      html += '<h3 class="print-day">' + esc((lab.today ? 'Today — ' : '') + DOW[parseDate(d).getDay()] + ', ' + lab.sub.replace(/^[A-Za-z]+ · /, '')) + '</h3><table class="print-tbl"><tbody>';
      byDate[d].forEach(function (g) {
        var vs = g.home === false ? 'at' : 'vs';
        html += '<tr><td class="pt-time">' + esc(g.timeLabel || 'TBA') + '</td><td class="pt-match">' + esc(g.school) + ' <span>' + vs + '</span> ' + esc(g.opponent || 'TBD') + '</td><td class="pt-meta">' + esc([g.level, g.gender, g.sport].filter(Boolean).join(' ')) + (g.status ? ' — ' + esc(g.status) : '') + '</td></tr>';
      });
      html += '</tbody></table>';
    });
    if (!games.length) html += '<p>No games match those filters.</p>';
    var area = document.getElementById('print-area');
    if (!area) { area = document.createElement('div'); area.id = 'print-area'; document.body.appendChild(area); }
    area.innerHTML = html;
    window.print();
  }

  // ---- wire ----
  function wire() {
    $$('.view-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('.view-btn').forEach(function (x) { x.classList.remove('is-on'); x.setAttribute('aria-selected', 'false'); });
        b.classList.add('is-on'); b.setAttribute('aria-selected', 'true');
        state.view = b.dataset.view;
        $('.view-upcoming').hidden = state.view !== 'upcoming';
        $('.view-calendar').hidden = state.view !== 'calendar';
        render();
      });
    });
    $$('[data-filter]').forEach(function (el) {
      var ev = el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(ev, function () { state[el.dataset.filter] = el.value; state.days = 10; state.selDate = null; render(); });
    });
    $('[data-clear]').addEventListener('click', function () {
      state.sport = state.school = state.level = state.q = ''; state.days = 10; state.selDate = null;
      $('#f-sport').value = ''; $('#f-school').value = ''; $('#f-level').value = ''; $('#f-search').value = '';
      render();
    });
    $('.load-more').addEventListener('click', function () { state.days += 10; renderUpcoming(); });
    $('[data-cal-prev]').addEventListener('click', function () { stepMonth(-1); });
    $('[data-cal-next]').addEventListener('click', function () { stepMonth(1); });
    $('.cal-grid').addEventListener('click', function (e) { var c = e.target.closest('[data-date]'); if (c) { state.selDate = c.dataset.date; render(); } });
    $('.cal-grid').addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset.date) { e.preventDefault(); state.selDate = e.target.dataset.date; render(); } });
    $('[data-export-view]').addEventListener('click', exportView);
    $('[data-print-view]').addEventListener('click', printView);
    // subscribe drawer
    $$('[data-open-subscribe]').forEach(function (b) { b.addEventListener('click', openSub); });
    $('[data-close-subscribe]').addEventListener('click', closeSub);
    $('.sub-backdrop').addEventListener('click', function (e) { if (e.target === this) closeSub(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSub(); });
    $('[data-copy-url]').addEventListener('click', function () {
      var u = $('.sub-url'); u.select();
      navigator.clipboard ? navigator.clipboard.writeText(u.value) : document.execCommand('copy');
      this.textContent = 'Copied!'; var t = this; setTimeout(function () { t.textContent = 'Copy link'; }, 1600);
    });
    $('.foot-year').textContent = new Date().getFullYear();
  }
  function stepMonth(dir) {
    var m = state.calMonth || TODAY.slice(0, 7), y = +m.slice(0, 4), mo = +m.slice(5, 7) - 1 + dir;
    var d = new Date(y, mo, 1); state.calMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); state.selDate = null; renderCalendar();
  }
  function maybeAutoSub() {
    var force = /[?&]sub\b/.test(location.search);
    var seen = false; try { seen = localStorage.getItem('njicSubSeen'); } catch (e) {}
    if (force || !seen) { try { localStorage.setItem('njicSubSeen', '1'); } catch (e) {} setTimeout(openSub, 650); }
  }
  function openSub() { $('.sub-backdrop').hidden = false; document.body.style.overflow = 'hidden'; }
  function closeSub() { $('.sub-backdrop').hidden = true; document.body.style.overflow = ''; }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
