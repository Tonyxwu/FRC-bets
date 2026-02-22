(function () {
  var path = window.location.pathname || '';
  var hasLeaderboard = /frontend\.html$|\/$/.test(path) || path === '' || /event\.html/.test(path) || /market\.html/.test(path) || /match\.html/.test(path) || /auth\.html/.test(path);
  var leaderboardHtml = hasLeaderboard
    ? '<button type="button" id="btnLeaderboard" class="leaderboard-open" title="Toggle leaderboard">Leaderboard</button>'
    : '<a href="/frontend.html" title="View leaderboard">Leaderboard</a>';

  var style = document.createElement('style');
  style.textContent = [
    '/* Universal top bar - same on every page */',
    '.top-bar-sticky { position: sticky; top: 0; z-index: 1000; }',
    '.top-bar { width: 100%; flex-shrink: 0; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; padding: 14px 20px; background: #161a22; border-bottom: 1px solid #2a3142; }',
    '.top-bar .brand { margin: 0; }',
    '.top-bar .brand a { color: #e6e9f0; text-decoration: none; font-size: 1.25rem; font-weight: 700; }',
    '.top-bar .brand a:hover { color: #3b82f6; }',
    '.top-bar .brand .sub { font-size: 0.85rem; margin: 2px 0 0; color: #8b92a5; }',
    '.top-bar-nav { display: flex; align-items: center; gap: 14px; font-size: 0.9rem; }',
    '.top-bar-nav a { color: #3b82f6; text-decoration: none; }',
    '.top-bar-nav a:hover { text-decoration: underline; }',
    '.top-bar-nav .balance { color: #22c55e; font-family: "JetBrains Mono", monospace; font-weight: 600; }',
    '.top-bar-nav button { background: transparent; border: 1px solid #2a3142; color: #8b92a5; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-family: inherit; font-size: 0.9rem; }',
    '.top-bar-nav button:hover { color: #e6e9f0; }',
    '.top-bar-nav button.leaderboard-open { border-color: #3b82f6; color: #3b82f6; }',
    'body.leaderboard-closed #leaderboardSidebar, body.leaderboard-closed #leaderboardResizer, body.leaderboard-closed #resizer { display: none !important; }',
    '',
    '/* Default scrollbars (main content, events, market, etc.) */',
    'html, body { scrollbar-width: thin; scrollbar-color: #2a3142 #0d0f14; }',
    '.events-column, .event-main, .market-page-wrap, .auth-center, .page-wrap { scrollbar-width: thin; scrollbar-color: #2a3142 #0d0f14; }',
    '*::-webkit-scrollbar { width: 10px; height: 10px; }',
    '*::-webkit-scrollbar-track { background: #0d0f14; }',
    '*::-webkit-scrollbar-thumb { background: #2a3142; border-radius: 5px; border: 2px solid #0d0f14; }',
    '*::-webkit-scrollbar-thumb:hover { background: #3a4255; }',
    '*::-webkit-scrollbar-corner { background: #0d0f14; }',
    '',
    '/* Leaderboard sidebar scrollbar - distinct look */',
    '.leaderboard-sidebar { scrollbar-width: thin; scrollbar-color: #3b82f6 #1a1f2e; }',
    '.leaderboard-sidebar::-webkit-scrollbar { width: 8px; }',
    '.leaderboard-sidebar::-webkit-scrollbar-track { background: #1a1f2e; border-radius: 4px; }',
    '.leaderboard-sidebar::-webkit-scrollbar-thumb { background: #3b82f6; border-radius: 4px; border: 1px solid #1a1f2e; }',
    '.leaderboard-sidebar::-webkit-scrollbar-thumb:hover { background: #60a5fa; }',
    '.leaderboard-sidebar::-webkit-scrollbar-corner { background: #1a1f2e; }'
  ].join('\n');
  document.head.appendChild(style);

  var bar = document.createElement('header');
  bar.className = 'top-bar top-bar-sticky';
  bar.id = 'app-top-bar';
  bar.innerHTML = [
    '<div class="brand">',
    '  <h1 class="brand" style="margin: 0;"><a href="/frontend.html">FRC Match Markets</a></h1>',
    '  <p class="sub" style="margin: 2px 0 0;">Watch the stream and bet on matches. New users get $100.</p>',
    '</div>',
    '<nav class="top-bar-nav" id="authBar">',
    '  ' + leaderboardHtml,
    '  <a href="/frontend.html">Home</a>',
    '  <a href="/bets.html" id="linkBets" style="display: none;">My bets</a>',
    '  <a href="/auth.html" id="linkLogin">Sign in</a>',
    '  <span class="sim-clock" id="simClock" style="display: none;"><span class="label">Sim time</span><span id="simClockTime">—</span></span>',
    '  <span id="userBalance" class="balance" style="display: none;"></span>',
    '  <span id="userName" style="display: none;"></span>',
    '  <button type="button" id="btnLogout" style="display: none;">Log out</button>',
    '</nav>'
  ].join('\n');

  var placeholder = document.getElementById('top-bar-placeholder');
  if (placeholder) {
    placeholder.parentNode.replaceChild(bar, placeholder);
  } else {
    document.body.insertBefore(bar, document.body.firstChild);
  }

  function renderAuth() {
    var user = typeof auth !== 'undefined' ? auth.getUser() : null;
    var linkBets = document.getElementById('linkBets');
    var linkLogin = document.getElementById('linkLogin');
    var userBalance = document.getElementById('userBalance');
    var userName = document.getElementById('userName');
    var btnLogout = document.getElementById('btnLogout');
    if (linkBets) linkBets.style.display = user ? 'inline' : 'none';
    if (linkLogin) linkLogin.style.display = user ? 'none' : 'inline';
    if (userBalance) { userBalance.style.display = user ? 'inline' : 'none'; if (user) userBalance.textContent = '$' + Number(user.balance).toFixed(2); }
    if (userName) { userName.style.display = user ? 'inline' : 'none'; if (user) userName.textContent = user.username; }
    if (btnLogout) {
      btnLogout.style.display = user ? 'inline' : 'none';
      btnLogout.onclick = function () {
        if (typeof auth !== 'undefined') auth.logout();
        renderAuth();
        document.dispatchEvent(new CustomEvent('auth-state-changed'));
      };
    }
  }

  if (hasLeaderboard) {
    var OPEN_KEY = 'appLeaderboardOpen';
    var LEGACY_KEY = 'frontendLeaderboardOpen';
    function isOpen() {
      var v = localStorage.getItem(OPEN_KEY);
      if (v === null) {
        var legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy !== null) {
          var open = legacy === '1' || legacy === 'true';
          localStorage.setItem(OPEN_KEY, open ? '1' : '0');
          return open;
        }
      }
      return v === null || v === '1' || v === 'true';
    }
    function setOpen(open) {
      localStorage.setItem(OPEN_KEY, open ? '1' : '0');
      document.body.classList.toggle('leaderboard-closed', !open);
      var btn = document.getElementById('btnLeaderboard');
      if (btn) btn.classList.toggle('leaderboard-open', open);
    }
    var initialState = isOpen();
    document.body.classList.toggle('leaderboard-closed', !initialState);
    var btn = document.getElementById('btnLeaderboard');
    if (btn) {
      btn.classList.toggle('leaderboard-open', initialState);
      btn.addEventListener('click', function () { setOpen(!isOpen()); });
    }
  }

  if (typeof auth !== 'undefined') {
    auth.fetchMe().then(renderAuth);
  } else {
    renderAuth();
  }
})();
