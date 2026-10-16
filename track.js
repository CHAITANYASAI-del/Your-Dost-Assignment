/* Anonymous reading analytics for the case study.
   Per visit: who/where (server side, no IP stored), then per session: how far they scrolled,
   engaged time, seconds spent in each section, seconds each block (card, table row, list item)
   was on screen, and which links they clicked. Nothing personal is collected; no cookies.
   ?me on the URL switches tracking off in this browser, ?notme switches it back on. */
(function () {
  'use strict';
  var q = new URLSearchParams(location.search), me = false, vid, sid, first = true, returning = false;
  var rid = function () { return Math.random().toString(36).slice(2, 12); };
  try {
    if (q.has('me')) localStorage.setItem('yd-me', '1');
    if (q.has('notme')) localStorage.removeItem('yd-me');
    me = !!localStorage.getItem('yd-me');
    vid = localStorage.getItem('yd-vid'); returning = !!vid; if (!vid) { vid = rid(); localStorage.setItem('yd-vid', vid); }
    sid = sessionStorage.getItem('yd-sid'); first = !sid; if (!sid) { sid = rid(); sessionStorage.setItem('yd-sid', sid); }
  } catch (e) { sid = sid || rid(); vid = vid || rid(); }
  if (me || location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;

  var SECTIONS = ['hero', 'summary', 'task1', 'task2', 'process', 'next', 'contact'];
  var secEls = SECTIONS.map(function (id) { return document.getElementById(id); });
  var blocks = [].slice.call(document.querySelectorAll('[data-b]'));
  var dwell = SECTIONS.map(function () { return 0; });     // seconds per section
  var bdwell = blocks.map(function () { return 0; });      // seconds per block
  var clicks = {};                                          // event code -> true
  var taps = {};                                            // scoped tap label -> count (every button / link / tappable thing)
  var tapN = 0;
  var maxD = 0, maxS = 0, active = 0, vis = !document.hidden, lastInput = Date.now(), dirty = false, lastSent = '';
  var inView = {};                                          // block index -> true while >=55% visible

  function post(body, beacon) {
    var payload = JSON.stringify(body);
    if (beacon && navigator.sendBeacon) { navigator.sendBeacon('/api/hit', new Blob([payload], { type: 'application/json' })); return; }
    fetch('/api/hit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(function () {});
  }

  if (first) post({
    type: 'visit', ref: document.referrer, vid: vid, sid: sid, ret: returning ? 1 : 0, vw: innerWidth,
    utm: { source: q.get('utm_source'), medium: q.get('utm_medium'), campaign: q.get('utm_campaign'), content: q.get('utm_content') }
  });

  /* which section is under the reading line (40% down the viewport) */
  function curSection() {
    var y = innerHeight * 0.4, cur = 0;
    for (var i = 0; i < secEls.length; i++) { if (secEls[i] && secEls[i].getBoundingClientRect().top <= y) cur = i; }
    var f = document.querySelector('footer');
    if (f && f.getBoundingClientRect().top <= y) cur = SECTIONS.length - 1;
    return cur;
  }
  function measure() {
    var h = document.documentElement;
    var d = Math.round((window.scrollY + window.innerHeight) / h.scrollHeight * 100);
    if (d > maxD) { maxD = Math.min(100, d); dirty = true; }
    var s = curSection(); if (s > maxS) { maxS = s; dirty = true; }
  }

  /* blocks currently on screen, judged by how much of the block (or of the viewport) it fills */
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var i = +e.target.getAttribute('data-i'), h = Math.min(e.boundingClientRect.height || 1, innerHeight);
        if (e.isIntersecting && e.intersectionRect.height / h >= 0.55) inView[i] = true; else delete inView[i];
      });
    }, { threshold: [0, .25, .55, .8, 1] });
    blocks.forEach(function (el, i) { el.setAttribute('data-i', i); io.observe(el); });
  }

  /* one-second heartbeat: only counts while the tab is visible and the person is interacting */
  setInterval(function () {
    var engaged = vis && Date.now() - lastInput < 30000;
    if (!engaged) return;
    active++; dirty = true;
    dwell[curSection()]++;
    for (var k in inView) bdwell[k]++;
    measure();
  }, 1000);
  ['scroll', 'mousemove', 'keydown', 'touchstart', 'click', 'wheel'].forEach(function (t) {
    addEventListener(t, function () { lastInput = Date.now(); }, { passive: true });
  });
  addEventListener('scroll', measure, { passive: true });
  setTimeout(measure, 600);

  /* clicks: anything tagged data-ev (nav, CTAs, contact links, open full screen) */
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-ev]');
    if (a) { clicks[a.getAttribute('data-ev')] = true; dirty = true; send(true); }
  }, true);
  /* the prototypes live in iframes, so clicks inside don't bubble up; focus moving into one means the person used it */
  addEventListener('blur', function () {
    setTimeout(function () {
      var f = document.activeElement;
      if (f && f.tagName === 'IFRAME') { var c = 'use' + f.getAttribute('data-fr'); if (!clicks[c]) { clicks[c] = true; dirty = true; } }
    }, 0);
  });


  /* every tap on anything tappable, on the page and inside both prototypes (same-origin iframes).
     "Tappable" = a link/button/control, or anything the browser shows a pointer cursor on. */
  function slug(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 26); }
  function tapLabel(el) {
    var node = el, hops = 0, view = (el.ownerDocument && el.ownerDocument.defaultView) || window;
    while (node && node.nodeType === 1 && hops < 6) {
      var tag = node.tagName, cs = view.getComputedStyle(node);
      if (/^(A|BUTTON|SUMMARY|SELECT|INPUT|LABEL)$/.test(tag) || node.getAttribute('role') === 'button' || node.getAttribute('role') === 'tab' || cs.cursor === 'pointer') {
        var raw = node.getAttribute('data-ev') || node.getAttribute('aria-label') || node.getAttribute('title') || (node.innerText || node.textContent || '').trim().split('\n')[0] || (node.className && String(node.className.baseVal != null ? node.className.baseVal : node.className).split(' ')[0]) || tag;
        return slug(raw) || slug(tag);
      }
      node = node.parentNode; hops++;
    }
    return null;
  }
  function onTap(scope) {
    return function (e) {
      lastInput = Date.now();
      var l = e.target && e.target.nodeType === 1 ? tapLabel(e.target) : null;
      if (!l) return;
      var k = scope + '_' + l;
      if (!(k in taps) && Object.keys(taps).length >= 40) return;
      taps[k] = (taps[k] || 0) + 1; tapN++; dirty = true;
      clearTimeout(onTap.t); onTap.t = setTimeout(function () { send(false); }, 5000);
    };
  }
  document.addEventListener('click', onTap('pg'), true);
  [].slice.call(document.querySelectorAll('iframe[data-fr]')).forEach(function (f) {
    var scope = f.getAttribute('data-fr');
    function hook() { try { f.contentDocument.addEventListener('click', onTap(scope), true); } catch (e) {} }
    f.addEventListener('load', hook); try { if (f.contentDocument && f.contentDocument.readyState === 'complete') hook(); } catch (e) {}
  });

  var b36 = function (n) { return Math.min(n, 46655).toString(36); };
  function trim(arr) { var n = arr.length; while (n > 0 && !arr[n - 1]) n--; return arr.slice(0, n).map(b36).join('.') || '0'; }
  function tapString() {   /* most-tapped first, trimmed to fit the server's 320-char limit */
    var out = [], len = 0;
    Object.keys(taps).sort(function (a, b) { return taps[b] - taps[a]; }).forEach(function (k) {
      var part = k + '__x' + taps[k];
      if (len + part.length + 1 <= 310) { out.push(part); len += part.length + 1; }
    });
    return out.join('.') || '0';
  }
  function send(beacon) {
    var body = {
      type: 'read', sid: sid, depth: maxD, secs: active, sec: maxS,
      d: trim(dwell), b: trim(bdwell), c: Object.keys(clicks).join('.') || '0',
      t: tapString()
    };
    var sig = JSON.stringify(body);
    if (sig === lastSent) return; lastSent = sig; dirty = false;
    post(body, beacon);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { send(true); vis = false; } else { lastInput = Date.now(); vis = true; }
  });
  addEventListener('pagehide', function () { send(true); });
  setInterval(function () { if (dirty && vis) send(false); }, 45000);
})();
