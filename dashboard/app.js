// RADAR-3 dashboard. Reads window.RADAR (written by main.ts from the sealed
// snapshot) and renders the board, the fitted model, its validations, and the
// netted farm plans. No network: every byte shown is in data.js.
//
// THE MODEL, in one function — the page recomputes each row from the snapshot
// figures and checks it against board.json, so screenshots and code agree:
//   impliedOf(row) = exp(fitA + fitB * ln(TVL)) * growth * maturity * breadth
//   growth   = 1 + clamp(change_7d, -60, 120) / 100 * 0.5   (null change -> 0)
//   maturity = 0.6 + min(age_days, 1095) / 1095 * 0.4        (unknown age -> 365d)
//   breadth  = 1 + 0.05 * min(chains - 1, 4)
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) return;
  var rows = D.rows, live = D.live, excl = D.excluded;

  function impliedOf(r) {
    var base = Math.exp(r.fit_a + r.fit_b * Math.log(r.tvl_usd));
    var ch = r.change_7d === null ? 0 : Math.min(120, Math.max(-60, r.change_7d));
    var growth = 1 + (ch / 100) * 0.5;
    var age = r.age_days === null ? 365 : r.age_days;
    var maturity = 0.6 + (Math.min(age, 1095) / 1095) * 0.4;
    var breadth = 1 + 0.05 * Math.min(Math.max(r.chains.length - 1, 0), 4);
    return { implied: Math.max(1, Math.min(1e14, Math.round(base * growth * maturity * breadth))),
      base: base, growth: growth, maturity: maturity, breadth: breadth };
  }
  // Agreement check: recompute every row; the footer shows the mismatch count.
  var mismatches = 0;
  for (var mi = 0; mi < rows.length; mi++) if (impliedOf(rows[mi]).implied !== rows[mi].implied_value_usd) mismatches++;

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function money(n) { if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M'; if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K'; return '$' + (Math.round(n * 100) / 100).toFixed(2); }
  function fmtPct(n) { if (n === null || n === undefined) return 'n/a'; return (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
  function fmtAge(d) { if (d === null || d === undefined) return 'unknown'; if (d >= 365) return (d / 365).toFixed(1) + 'y'; return d + 'd'; }
  function fmtPct1(n) { if (n === null || n === undefined) return 'n/a'; return (n * 100).toFixed(1) + '%'; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function $(id) { return document.getElementById(id); }

  // ---- header KPIs ---------------------------------------------------------
  $('kpis').innerHTML =
    '<div class="kpi"><b>' + D.meta.watchlist_count + '</b><span>watchlist</span></div>' +
    '<div class="kpi"><b>' + D.meta.ranked_count + '</b><span>ranked pre-token</span></div>' +
    '<div class="kpi"><b>' + D.meta.anchor_count + '</b><span>anchors fitted</span></div>' +
    '<div class="kpi"><b>' + D.meta.total_protocols + '</b><span>protocols accounted</span></div>' +
    '<div class="kpi"><b>' + esc(D.meta.as_of) + '</b><span>snapshot date</span></div>';

  // ---- methodology ---------------------------------------------------------
  var v = D.validation;
  function valLine(label, m) {
    if (!m || m.mape === null) return '<p><b>' + label + ':</b> ' + esc(m ? m.note : 'not run') + ' — no numbers invented.</p>';
    return '<p><b>' + label + ':</b> MAPE ' + fmtPct1(m.mape) + ', median error ' + fmtPct1(m.median_ape) +
      ', Spearman ' + (m.spearman === null ? 'n/a' : m.spearman.toFixed(3)) +
      ' (' + m.n_train + ' train / ' + m.n_test + ' test).</p>';
  }
  var fitRows = D.category_fits.map(function (f) {
    return '<tr><td>' + esc(f.category) + '</td><td>' + f.a.toFixed(3) + '</td><td>' + f.b.toFixed(3) + '</td><td>' + f.r2.toFixed(3) + '</td><td>' + f.n + '</td></tr>';
  }).join('');
  $('method-body').innerHTML =
    '<p><b>Formula.</b> <code>implied = exp(a + b &middot; ln(TVL)) &times; growth &times; maturity &times; breadth</code>, where ' +
    '<code>growth = 1 + clamp(change_7d, -60, 120)/100 &times; 0.5</code> (no 7d figure &rarr; 0), ' +
    '<code>maturity = 0.6 + min(age_days, 1095)/1095 &times; 0.4</code> (unknown listing date &rarr; 365d), ' +
    '<code>breadth = 1 + 0.05 &times; min(chains - 1, 4)</code>. Age is days from <code>listed_at</code> to the snapshot date ' + esc(D.meta.as_of) + '.</p>' +
    '<p><b>Fitted, not hardcoded.</b> The curve is ordinary least squares on <code>log(market cap) = a + b &middot; log(TVL)</code> over ' +
    D.meta.anchor_count + ' traded-token anchors (one per ticker, highest TVL kept). Per category when it has &ge; 5 anchors, else the global fit. ' +
    'No protocol name is special-cased anywhere: the same arithmetic prices every row, and the page recomputes it in <code>impliedOf(row)</code>.</p>' +
    '<table><thead><tr><th>Fit</th><th>a</th><th>b</th><th>R&sup2;</th><th>anchors</th></tr></thead><tbody>' +
    '<tr><td><b>Global</b></td><td>' + D.global_fit.a.toFixed(3) + '</td><td>' + D.global_fit.b.toFixed(3) + '</td><td>' + D.global_fit.r2.toFixed(3) + '</td><td>' + D.global_fit.n + '</td></tr>' +
    fitRows + '</tbody></table>' +
    '<p><b>Validation (computed at build time, deterministic).</b></p>' +
    valLine('Blind holdout (70/30 by hash of slug)', v.blind) +
    valLine('Walk-forward (fit older listings, test newer)', v.walk_forward) +
    '<p><b>Leave-one-out:</b> refit without each anchor in turn — mean absolute % error ' +
    (v.loo_mean_ape === null ? 'n/a' : fmtPct1(v.loo_mean_ape)) + ' over ' + v.loo_n + ' anchors.</p>' +
    '<p><b>Bootstrap:</b> ' + v.bootstrap_iters + ' refits resampling anchors with replacement (fixed-seed LCG); ' +
    'global slope mean ' + (v.bootstrap_slope_mean === null ? 'n/a' : v.bootstrap_slope_mean.toFixed(3)) +
    ' (p10 ' + (v.bootstrap_slope_p10 === null ? 'n/a' : v.bootstrap_slope_p10.toFixed(3)) +
    ', p90 ' + (v.bootstrap_slope_p90 === null ? 'n/a' : v.bootstrap_slope_p90.toFixed(3)) + '). ' +
    'Each protocol\'s detail view shows its rank range p10–p90 across the refits.</p>' +
    '<p><b>Farm plans are netted.</b> Expected value = 5% of implied value &minus; total gas (assumes 5% of implied value reaches farmers). ' +
    'Gas: ' + D.gas_table.map(function (g) { return esc(g.chain) + ' ' + money(g.usd_per_tx) + '/tx'; }).join(', ') +
    '; 8 transactions per farm. Capital by TVL: $250 at $5B+, $150 at $1B+, $100 at $100M+, $50 below. ' +
    'Verdict FARM if EV &gt; $50, THIN if $0 &lt; EV &le; $50, SKIP if EV &le; $0. Break-even implied value = gas &divide; 5%.</p>' +
    '<p><b>Coverage.</b> ' + D.meta.total_protocols + ' protocols accounted for: ' + D.meta.ranked_count + ' ranked pre-token + ' +
    D.meta.traded_count + ' traded (live tokens, separate tab) + ' + D.meta.excluded_count +
    ' excluded (wrapped / staked / bridged products, versioned names, exchange names, CEX / bridge / liquid-staking categories).</p>' +
    '<p><b>Honesty note.</b> A protocol "records no token" when its DefiLlama record carries no gecko id and no symbol — that is not proof it has no token. ' +
    'Implied value is this radar\'s own claim from the snapshot figures; it does not predict whether or when a token is issued. Source: ' + esc(D.meta.source) + '.</p>';

  // ---- filters + table -------------------------------------------------------
  var state = { q: '', cat: 'all', chain: 'all', minTvl: 0, watchOnly: false, sort: 'rank', dir: 1, tab: 'board' };
  var cats = [], chains = [];
  rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  $('cat').innerHTML = '<option value="all">All categories</option>' + cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
  $('chain').innerHTML = '<option value="all">All chains</option>' + chains.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');

  function filtered() {
    var q = state.q.toLowerCase();
    return rows.filter(function (r) {
      if (state.watchOnly && !r.watchlist) return false;
      if (state.cat !== 'all' && r.category !== state.cat) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (q && (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0)) return false;
      return true;
    });
  }
  function sortRows(list) {
    var k = state.sort, d = state.dir;
    function num(a, b) { return (a - b) * d; }
    list.sort(function (a, b) {
      if (k === 'rank') return num(a.rank, b.rank);
      if (k === 'implied') return num(a.implied_value_usd, b.implied_value_usd);
      if (k === 'tvl') return num(a.tvl_usd, b.tvl_usd);
      if (k === 'change') return num(a.change_7d === null ? -1e9 : a.change_7d, b.change_7d === null ? -1e9 : b.change_7d);
      if (k === 'age') return num(a.age_days === null ? -1 : a.age_days, b.age_days === null ? -1 : b.age_days);
      if (k === 'name') return (a.name < b.name ? -1 : 1) * d;
      if (k === 'category') return ((a.category || '') < (b.category || '') ? -1 : 1) * d;
      return 0;
    });
    return list;
  }
  function renderBoard() {
    var list = sortRows(filtered());
    $('count').textContent = list.length + ' of ' + rows.length + ' shown';
    $('rows').innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"><td>' + r.rank + '</td>' +
        '<td><b>' + esc(r.name) + '</b>' + (r.watchlist ? ' <span class="badge watch">WATCH</span>' : '') + '<br><span class="note">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td><td class="num">' + fmtPct(r.change_7d) + '</td>' +
        '<td>' + fmtAge(r.age_days) + '</td><td class="num"><b>' + fmtUsd(r.implied_value_usd) + '</b></td>' +
        '<td class="verdict-' + r.verdict + '"><b>' + r.verdict + '</b></td></tr>';
    }).join('');
  }
  function renderLive() {
    $('live-rows').innerHTML = live.map(function (p) {
      return '<tr><td><b>' + esc(p.name) + '</b><br><span class="note">' + esc(p.slug) + '</span></td><td>' + esc(p.symbol) + '</td>' +
        '<td>' + esc(p.category || '—') + '</td><td class="num">' + fmtUsd(p.tvl_usd) + '</td>' +
        '<td class="num">' + fmtUsd(p.mcap_usd) + '</td><td class="num">' + (p.mcap_per_tvl === null ? 'n/a' : p.mcap_per_tvl.toFixed(2) + 'x') + '</td></tr>';
    }).join('');
  }
  function renderAccounted() {
    $('accounting-line').textContent = D.meta.total_protocols + ' protocols accounted for: ' + D.meta.ranked_count +
      ' ranked pre-token + ' + D.meta.traded_count + ' traded (live tokens) + ' + D.meta.excluded_count + ' excluded. ' +
      D.accounting.map(function (a) { return a.count + ' × ' + a.reason; }).join('; ') + '.';
    $('excluded-rows').innerHTML = excl.map(function (e) {
      return '<tr><td><b>' + esc(e.name) + '</b><br><span class="note">' + esc(e.slug) + '</span></td><td>' + esc(e.category || '—') + '</td><td>' + esc(e.reason) + '</td></tr>';
    }).join('');
  }

  // ---- detail drawer ---------------------------------------------------------
  function openDetail(slug) {
    var r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) { r = rows[i]; break; }
    var dr = $('drawer');
    if (!r) { dr.classList.add('hidden'); return; }
    var c = impliedOf(r);
    dr.innerHTML =
      '<button class="close" id="drawer-close">Close ✕</button>' +
      '<h2>' + esc(r.name) + '</h2><p class="note">Rank #' + r.rank + ' · ' + esc(r.slug) + ' · ' + esc(r.category || 'uncategorised') +
      (r.watchlist ? ' · <span class="badge watch">WATCHLIST</span>' : '') + '</p>' +
      '<h3>Implied value — factor breakdown</h3><dl>' +
      '<dt>Implied value</dt><dd><b>' + fmtUsd(r.implied_value_usd) + '</b></dd>' +
      '<dt>Fitted curve value</dt><dd>' + fmtUsd(r.base_value_usd) + '</dd>' +
      '<dt>Growth ×' + r.growth_mult.toFixed(3) + '</dt><dd>' + fmtPct(r.change_7d) + ' over 7d</dd>' +
      '<dt>Maturity ×' + r.maturity_mult.toFixed(3) + '</dt><dd>' + fmtAge(r.age_days) + ' old</dd>' +
      '<dt>Breadth ×' + r.breadth_mult.toFixed(3) + '</dt><dd>' + r.chains.length + ' chain(s): ' + esc(r.chains.join(', ')) + '</dd>' +
      '<dt>TVL</dt><dd>' + fmtUsd(r.tvl_usd) + '</dd>' +
      '<dt>Recomputed by page</dt><dd>' + fmtUsd(c.implied) + (c.implied === r.implied_value_usd ? ' ✓ agrees' : ' ✗ MISMATCH') + '</dd>' +
      '</dl>' +
      '<h3>Comps used</h3><p>' + (r.fit_category === 'global' ? 'Global fit (no category fit with ≥ 5 anchors).' : 'Category fit: ' + esc(r.fit_category) + '.') +
      ' log(mcap) = ' + r.fit_a.toFixed(3) + ' + ' + r.fit_b.toFixed(3) + ' · log(TVL), R² ' + r.fit_r2.toFixed(3) + ', ' + r.fit_anchors + ' anchors. ' +
      'Global R² ' + D.global_fit.r2.toFixed(3) + ' over ' + D.global_fit.n + ' anchors.</p>' +
      '<p><b>Rank stability (bootstrap, 200 refits):</b> rank p10–p90 = #' + r.rank_p10 + '–#' + r.rank_p90 + '.</p>' +
      '<h3>Netted farm plan — verdict ' + r.verdict + '</h3><dl>' +
      '<dt>Capital</dt><dd>' + money(r.capital_usd) + '</dd>' +
      '<dt>Gas</dt><dd>' + money(r.gas_total_usd) + ' (' + money(r.gas_per_tx_usd) + '/tx × 8)</dd>' +
      '<dt>Expected value</dt><dd><b>' + money(r.expected_value_usd) + '</b> (5% of implied, less gas)</dd>' +
      '<dt>Break-even implied</dt><dd>' + fmtUsd(r.break_even_implied_usd) + '</dd>' +
      '<dt>Hold</dt><dd>' + r.hold_days + ' days</dd></dl>' +
      '<ol>' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    dr.classList.remove('hidden');
    $('drawer-close').addEventListener('click', function () { setHash({ detail: null }); });
  }

  // ---- tabs, filters, sorting, hash state ------------------------------------
  function setTab(tab) {
    state.tab = tab;
    var btns = document.querySelectorAll('#tabs button');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', btns[i].getAttribute('data-tab') === tab);
    $('board-panel').classList.toggle('hidden', tab !== 'board');
    $('live-panel').classList.toggle('hidden', tab !== 'live');
    $('accounted-panel').classList.toggle('hidden', tab !== 'accounted');
    if (tab === 'live') renderLive();
    if (tab === 'accounted') renderAccounted();
  }
  function setHash(patch) {
    var h = {};
    var cur = location.hash.replace(/^#/, '');
    cur.split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) h[p[0]] = decodeURIComponent(p[1] || ''); });
    Object.keys(patch).forEach(function (k) { if (patch[k] === null || patch[k] === '' || patch[k] === 'all' || patch[k] === false) delete h[k]; else h[k] = String(patch[k]); });
    var s = Object.keys(h).map(function (k) { return k + '=' + encodeURIComponent(h[k]); }).join('&');
    history.replaceState(null, '', s ? '#' + s : location.pathname + location.search);
  }
  function readHash() {
    var h = {};
    location.hash.replace(/^#/, '').split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) h[p[0]] = decodeURIComponent(p[1] || ''); });
    if (h.q !== undefined) { state.q = h.q; $('q').value = h.q; }
    if (h.cat !== undefined) { state.cat = h.cat; $('cat').value = h.cat; }
    if (h.chain !== undefined) { state.chain = h.chain; $('chain').value = h.chain; }
    if (h.watch === '1') { state.watchOnly = true; $('watchOnly').checked = true; }
    if (h.minTvl !== undefined) { state.minTvl = Number(h.minTvl) || 0; $('minTvl').value = String(state.minTvl); }
    if (h.tab) setTab(h.tab);
    if (h.detail) openDetail(h.detail); else $('drawer').classList.add('hidden');
    renderBoard();
  }
  document.querySelectorAll('#tabs button').forEach(function (b) {
    b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); setHash({ tab: b.getAttribute('data-tab') === 'board' ? null : b.getAttribute('data-tab') }); });
  });
  document.querySelectorAll('#board th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = k === 'name' || k === 'category' ? 1 : -1; }
      renderBoard();
    });
  });
  $('q').addEventListener('input', function () { state.q = $('q').value; setHash({ q: state.q }); renderBoard(); });
  $('cat').addEventListener('change', function () { state.cat = $('cat').value; setHash({ cat: state.cat }); renderBoard(); });
  $('chain').addEventListener('change', function () { state.chain = $('chain').value; setHash({ chain: state.chain }); renderBoard(); });
  $('minTvl').addEventListener('change', function () { state.minTvl = Number($('minTvl').value); setHash({ minTvl: state.minTvl || null }); renderBoard(); });
  $('watchOnly').addEventListener('change', function () { state.watchOnly = $('watchOnly').checked; setHash({ watch: state.watchOnly ? '1' : null }); renderBoard(); });
  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) { openDetail(tr.getAttribute('data-slug')); setHash({ detail: tr.getAttribute('data-slug') }); }
  });
  window.addEventListener('hashchange', readHash);

  $('foot').textContent = 'RADAR-3 · model radar-3 · snapshot ' + D.meta.as_of + ' · ' + D.meta.ranked_count + ' ranked, ' +
    D.meta.anchor_count + ' anchors, ' + D.meta.total_protocols + ' accounted · page recompute check: ' +
    (mismatches === 0 ? 'all ' + rows.length + ' rows agree with board.json ✓' : mismatches + ' MISMATCHES') +
    ' · records no token ≠ has no token.';
  readHash();
  renderBoard();
})();
