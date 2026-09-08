// NJIC Conference Schedule — loads the split month files, renders an Upcoming
// agenda and a searchable Full Schedule, filters client-side, and wires the
// subscribe / export (.ics) + RSS actions to the static feeds. Standalone site,
// so selectors are unscoped.
(function () {
  'use strict';
  var DATA = 'data/schedule/', FEEDS = 'feeds/';
  var ALL = [];
  var INDEX = null, FEEDMAN = null, SCHOOL_PATH = {}, SPORT_BY_SLUG = {};
  var TEAMS = null, TEAMS_BY_SLUG = {};
  var CONF = 'North Jersey Interscholastic Conference';
  var state = { view: 'upcoming', sport: '', school: '', level: '', date: '', q: '', days: 10 };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

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
  function initialDays() { return state.view === 'full' ? 40 : 10; }
  function byDateTime(a, b) { return a.date === b.date ? (a.time || '99:99').localeCompare(b.time || '99:99') : a.date.localeCompare(b.date); }

  function loadJSON(u) { return fetch(u, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); }); }
  function init() {
    Promise.all([
      loadJSON(DATA + 'index.json').catch(function () { return null; }),
      loadJSON(FEEDS + 'index.json').catch(function () { return null; }),
      loadJSON(FEEDS + 'teams.json').catch(function () { return null; }),
    ]).then(function (res) {
      INDEX = res[0]; FEEDMAN = res[1]; TEAMS = res[2];
      if (!INDEX) { showError(); return; }
      CONF = (FEEDMAN && FEEDMAN.conference) || CONF;
      var months = INDEX.months || [];
      return Promise.all(months.map(function (m) { return loadJSON(DATA + m + '.json').then(function (d) { return d.games || []; }).catch(function () { return []; }); }))
        .then(function (lists) {
          lists.forEach(function (g) { ALL = ALL.concat(g); });
          fillStats();
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
    if (state.date && g.date !== state.date) return false;
    if (state.q) { var q = state.q.toLowerCase(); if ((g.school || '').toLowerCase().indexOf(q) < 0 && (g.opponent || '').toLowerCase().indexOf(q) < 0) return false; }
    return true;
  }
  function hasFilter() { return !!(state.sport || state.school || state.level || state.date || state.q); }

  // ---- render ----
  function render() {
    $('.filter-clear').hidden = !hasFilter();
    if (state.view === 'upcoming') renderUpcoming(); else renderFull();
  }
  function teamHtml(name, logo, isHome) {
    return '<span class="team' + (isHome ? ' home' : '') + '">' +
      (logo ? '<img class="team-logo" src="images/logos/optimized/' + logo + '.png" alt="" loading="lazy" onerror="this.remove()">' : '') +
      '<span class="team-name">' + esc(name) + '</span></span>';
  }
  function gameEl(g, past) {
    var el = document.createElement('div');
    el.className = 'game' + (g.status ? ' is-off' : '') + (past ? ' is-past' : '');
    // Always render Away @ Home; neutral-site games use "vs" with original order.
    var isAway = g.home === false, isHome = g.home === true, neutral = !isAway && !isHome;
    var teamA, logoA, teamB, logoB, sep;
    if (isAway) {
      teamA = g.school;            logoA = g.schoolLogo;
      teamB = g.opponent || 'TBD'; logoB = g.oppLogo; sep = '@';
    } else if (isHome) {
      teamA = g.opponent || 'TBD'; logoA = g.oppLogo;
      teamB = g.school;            logoB = g.schoolLogo; sep = '@';
    } else {
      teamA = g.school;            logoA = g.schoolLogo;
      teamB = g.opponent || 'TBD'; logoB = g.oppLogo; sep = 'vs';
    }
    el.innerHTML =
      '<div class="game-time">' + (g.timeLabel ? esc(g.timeLabel) : 'TBA') + '</div>' +
      '<div class="game-match"><div class="game-teams">' +
      teamHtml(teamA, logoA, false) +
      '<span class="vs">' + sep + '</span>' +
      teamHtml(teamB, logoB, false) + '</div>' +
      '<div class="game-meta">' +
      '<span class="pill pill--sport">' + esc([g.gender, g.sport].filter(Boolean).join(' ')) + '</span>' +
      (g.level ? '<span class="pill">' + esc(g.level) + '</span>' : '') +
      (g.status ? '<span class="pill pill--off">' + esc(g.status) + '</span>' : '') +
      '</div></div>';
    return el;
  }
  function renderAgenda(wrap, games) {
    var agenda = $('.agenda', wrap), empty = $('.empty', wrap), more = $('.load-more', wrap);
    agenda.innerHTML = '';
    if (!games.length) { empty.hidden = false; more.hidden = true; return; }
    empty.hidden = true;
    var byDate = groupBy(games, 'date');
    var dates = Object.keys(byDate).sort();
    var shown = dates.slice(0, state.days);
    shown.forEach(function (d) {
      var lab = dayLabel(d), past = d < TODAY;
      var h = document.createElement('div'); h.className = 'day-head' + (lab.today ? ' is-today' : '') + (past ? ' is-past' : '');
      h.innerHTML = '<b>' + esc(lab.big) + '</b><span>' + esc(lab.sub) + '</span><em>' + byDate[d].length + ' game' + (byDate[d].length > 1 ? 's' : '') + '</em>';
      agenda.appendChild(h);
      byDate[d].forEach(function (g) { agenda.appendChild(gameEl(g, past)); });
    });
    more.hidden = shown.length >= dates.length;
  }
  function renderUpcoming() {
    var games = state.date
      ? ALL.filter(function (g) { return match(g); })
      : ALL.filter(function (g) { return g.date >= TODAY && match(g); });
    renderAgenda($('.view-upcoming'), games.sort(byDateTime));
  }
  function renderFull() {
    var wrap = $('.view-full'), hint = $('.full-hint', wrap);
    if (hint) hint.hidden = hasFilter();
    renderAgenda(wrap, ALL.filter(match).sort(byDateTime));
  }
  function groupBy(arr, k) { var o = {}; arr.forEach(function (x) { (o[x[k]] = o[x[k]] || []).push(x); }); return o; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // ---- subscribe / export ----
  function absUrl(rel) { return location.origin.replace(/\/$/, '') + '/' + rel.replace(/^\//, ''); }
  function allFeed() { return (FEEDMAN && FEEDMAN.all) || 'feeds/all.ics'; }
  function slug(s) { return String(s == null ? '' : s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  function buildSubscribe() {
    var scope = $('#sub-scope');
    if (!scope) return;
    if (FEEDMAN) {
      var sg = $('optgroup[data-group="schools"]', scope), pg = $('optgroup[data-group="sports"]', scope);
      (FEEDMAN.schools || []).forEach(function (s) { SCHOOL_PATH[s.slug] = s; var o = document.createElement('option'); o.value = 'school:' + s.slug; o.textContent = s.name; sg.appendChild(o); });
      (FEEDMAN.sports || []).forEach(function (s) { SPORT_BY_SLUG[s.slug] = s; var o = document.createElement('option'); o.value = 'sport:' + s.slug; o.textContent = s.name; pg.appendChild(o); });
    }
    if (TEAMS && TEAMS.schools) TEAMS.schools.forEach(function (s) { TEAMS_BY_SLUG[s.slug] = s; });
    scope.addEventListener('change', onScope);
    var tsp = $('#sub-tsport'); if (tsp) tsp.addEventListener('change', onTsport);
    var lvl = $('#sub-level'); if (lvl) lvl.addEventListener('change', updateLinks);
    onScope();
  }
  function fillLevels(sel, levelNames) {
    if (!sel) return;
    sel.innerHTML = '<option value="">All levels</option>';
    levelNames.forEach(function (n) { var o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o); });
  }
  function onScope() {
    var v = $('#sub-scope').value;
    var isSchool = v.indexOf('school:') === 0, isSport = v.indexOf('sport:') === 0;
    var tsp = $('#sub-tsport'), lvl = $('#sub-level'), tspWrap = $('.sub-tsport'), lvlWrap = $('.sub-level');
    if (tspWrap) tspWrap.hidden = !isSchool;
    if (isSchool && tsp) {
      var t = TEAMS_BY_SLUG[v.slice(7)];
      tsp.innerHTML = '<option value="">All sports (whole school)</option>';
      if (t) t.sports.forEach(function (sp) { var o = document.createElement('option'); o.value = sp.slug; o.textContent = sp.name; tsp.appendChild(o); });
      if (lvlWrap) lvlWrap.hidden = true;
      if (lvl) lvl.innerHTML = '<option value="">All levels</option>';
    } else if (isSport) {
      var sp2 = SPORT_BY_SLUG[v.slice(6)], order = ['Varsity', 'Junior Varsity', 'Freshman', 'Middle School'];
      var levels = uniq((FEEDMAN.sportLevels || []).filter(function (x) { return sp2 && x.sport === sp2.name; }).map(function (x) { return x.level; })).sort(function (a, b) { return (order.indexOf(a) + 1 || 9) - (order.indexOf(b) + 1 || 9); });
      fillLevels(lvl, levels);
      if (lvlWrap) lvlWrap.hidden = false;
    } else if (lvlWrap) { lvlWrap.hidden = true; }
    updateLinks();
  }
  function onTsport() {
    var v = $('#sub-scope').value; if (v.indexOf('school:') !== 0) { updateLinks(); return; }
    var t = TEAMS_BY_SLUG[v.slice(7)], spSlug = $('#sub-tsport').value, lvl = $('#sub-level'), lvlWrap = $('.sub-level');
    var sp = t && t.sports.filter(function (x) { return x.slug === spSlug; })[0];
    if (sp && sp.levels.length) { fillLevels(lvl, sp.levels.map(function (l) { return l.name; })); if (lvlWrap) lvlWrap.hidden = false; }
    else { if (lvl) lvl.innerHTML = '<option value="">All levels</option>'; if (lvlWrap) lvlWrap.hidden = true; }
    updateLinks();
  }
  function currentFeed(kind) {
    var v = $('#sub-scope').value, key = kind === 'rss' ? 'rss' : 'path';
    var fb = kind === 'rss' ? ((FEEDMAN && FEEDMAN.rss) || 'feeds/rss.xml') : allFeed();
    if (v.indexOf('school:') === 0) {
      var s = v.slice(7), sc = SCHOOL_PATH[s];
      var tsp = $('#sub-tsport'), spSlug = tsp ? tsp.value : '', lvName = $('#sub-level').value;
      if (spSlug) {
        if (kind === 'rss') return (sc && sc.rss) || fb;
        var base = (TEAMS && TEAMS.base) || 'feeds/teams';
        return base + '/' + s + '/' + spSlug + (lvName ? '--' + slug(lvName) : '') + '.ics';
      }
      return sc ? (sc[key] || sc.path) : fb;
    }
    if (v.indexOf('sport:') === 0) {
      var sp2 = SPORT_BY_SLUG[v.slice(6)], lv2 = $('#sub-level').value;
      if (sp2 && lv2) { var mm = (FEEDMAN.sportLevels || []).filter(function (x) { return x.sport === sp2.name && x.level === lv2; })[0]; if (mm) return mm[key] || mm.path; }
      return sp2 ? (sp2[key] || sp2.path) : fb;
    }
    return fb;
  }
  function updateLinks() {
    var path = currentFeed('ics'), https = absUrl(path), webcal = https.replace(/^https?:/, 'webcal:');
    $('[data-sub="apple"]').href = webcal;
    $('[data-sub="outlook"]').href = 'https://outlook.live.com/calendar/0/addfromweb?url=' + encodeURIComponent(https) + '&name=' + encodeURIComponent(CONF);
    $('[data-sub="google"]').href = 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(webcal);
    $('[data-sub="download"]').href = path;
    $('.sub-url').value = https;
    var rssIn = $('.sub-rss-url'); if (rssIn) rssIn.value = absUrl(currentFeed('rss'));
  }

  // ---- print (mirrors the active view) ----
  function printView() {
    var full = state.view === 'full';
    var games = ALL.filter(function (g) { return (full || g.date >= TODAY) && match(g); }).sort(byDateTime);
    var scope = [state.school, state.sport, state.level].filter(Boolean).join(' · ') || 'All schools · all sports';
    var byDate = groupBy(games, 'date');
    var gen = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    var kind = full ? 'full schedule' : 'upcoming';
    var html = '<div class="print-head"><h1>' + esc(CONF) + '</h1>' +
      '<h2>' + esc(scope) + '</h2><p>' + games.length + ' ' + kind + ' game' + (games.length !== 1 ? 's' : '') + ' · as of ' + gen + '</p></div>';
    Object.keys(byDate).sort().forEach(function (d) {
      var lab = dayLabel(d);
      html += '<h3 class="print-day">' + esc((lab.today ? 'Today — ' : '') + DOW[parseDate(d).getDay()] + ', ' + lab.sub.replace(/^[A-Za-z]+ · /, '')) + '</h3><table class="print-tbl"><tbody>';
      byDate[d].forEach(function (g) {
        var tA, tB, sep;
        if (g.home === false) { tA = g.school; tB = g.opponent || 'TBD'; sep = '@'; }
        else if (g.home === true) { tA = g.opponent || 'TBD'; tB = g.school; sep = '@'; }
        else { tA = g.school; tB = g.opponent || 'TBD'; sep = 'vs'; }
        html += '<tr><td class="pt-time">' + esc(g.timeLabel || 'TBA') + '</td><td class="pt-match">' + esc(tA) + ' <span>' + sep + '</span> ' + esc(tB) + '</td><td class="pt-meta">' + esc([g.level, g.gender, g.sport].filter(Boolean).join(' ')) + (g.status ? ' — ' + esc(g.status) : '') + '</td></tr>';
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
        state.days = initialDays();
        $('.view-upcoming').hidden = state.view !== 'upcoming';
        $('.view-full').hidden = state.view !== 'full';
        render();
      });
    });
    $$('[data-filter]').forEach(function (el) {
      var ev = el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(ev, function () { state[el.dataset.filter] = el.value; state.days = initialDays(); render(); });
    });
    $('[data-clear]').addEventListener('click', function () {
      state.sport = state.school = state.level = state.date = state.q = ''; state.days = initialDays();
      ['#f-sport', '#f-school', '#f-level', '#f-date', '#f-search'].forEach(function (s) { var el = $(s); if (el) el.value = ''; });
      render();
    });
    $$('.load-more').forEach(function (b) { b.addEventListener('click', function () { state.days += 20; render(); }); });
    $$('[data-print-view]').forEach(function (b) { b.addEventListener('click', printView); });
    // subscribe drawer
    $$('[data-open-subscribe]').forEach(function (b) { b.addEventListener('click', openSub); });
    $('[data-close-subscribe]').addEventListener('click', closeSub);
    $('.sub-backdrop').addEventListener('click', function (e) { if (e.target === this) closeSub(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSub(); });
    var cp = $('[data-copy-url]');
    if (cp) cp.addEventListener('click', function () { copyFrom($('.sub-url'), this, 'Copy link'); });
    var cr = $('[data-copy-rss]');
    if (cr) cr.addEventListener('click', function () { copyFrom($('.sub-rss-url'), this, 'Copy RSS'); });
    var fy = $('.foot-year'); if (fy) fy.textContent = new Date().getFullYear();
  }
  function copyFrom(input, btn, label) {
    input.select();
    navigator.clipboard ? navigator.clipboard.writeText(input.value) : document.execCommand('copy');
    btn.textContent = 'Copied!'; setTimeout(function () { btn.textContent = label; }, 1600);
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
