(function () {
  'use strict';

  const SUPABASE_URL = 'https://ppciitxcvoettvpnierk.supabase.co';
  const PUBLISHABLE_KEY = 'sb_publishable_y16MCgx7Nc2eUnD-dQ6Ewg_InP1loHH';
  const MINIAPP_ENDPOINT = SUPABASE_URL + '/functions/v1/telegram-miniapp';
  const LINK_ENDPOINT = SUPABASE_URL + '/functions/v1/telegram-link';
  const SSO_ENDPOINT = SUPABASE_URL + '/functions/v1/telegram-sso';
  const TURNSTILE_SITE_KEY = '0x4AAAAAAESvTkcXIZCdiO_k';
  const BOT_USERNAME = 'studyjob_app_bot';

  function safe(fn, fallback) {
    try { return fn(); } catch (_) { return fallback; }
  }

  const telegram = safe(function () {
    return window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  }, null);

  if (!telegram) return;

  safe(function () { telegram.ready(); }, null);
  safe(function () { telegram.expand(); }, null);
  safe(function () { telegram.setHeaderColor('#0f1117'); }, null);
  safe(function () { telegram.setBackgroundColor('#0f1117'); }, null);

  function readParam(name) {
    const locations = [
      String(window.location.hash || '').replace(/^#/, ''),
      String(window.location.search || '').replace(/^\?/, ''),
    ];
    for (const raw of locations) {
      try {
        const value = new URLSearchParams(raw).get(name);
        if (value) return value;
      } catch (_) {}
    }
    return '';
  }

  function hasSupabaseAuthCallback() {
    const hash = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
    return Boolean(hash.get('access_token') && hash.get('refresh_token'));
  }

  if (hasSupabaseAuthCallback()) return;

  const initData = String(safe(function () { return telegram.initData || ''; }, '') || readParam('tgWebAppData'));
  if (!initData) return;

  const tgUser = safe(function () {
    return telegram.initDataUnsafe && telegram.initDataUnsafe.user ? telegram.initDataUnsafe.user : null;
  }, null);

  let turnstileId = null;
  let captchaToken = '';
  let busy = false;

  function api(url, body, accessToken) {
    return fetch(url, {
      method: 'POST',
      cache: 'no-store',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'apikey': PUBLISHABLE_KEY,
      }, accessToken ? { 'Authorization': 'Bearer ' + accessToken } : {}),
      body: JSON.stringify(body),
    }).then(async function (response) {
      let data = {};
      try { data = await response.json(); } catch (_) {}
      if (!response.ok || data.ok !== true) {
        const error = new Error(errorText(data.error || 'network_error'));
        error.code = data.error || 'network_error';
        throw error;
      }
      return data;
    });
  }

  function errorText(code) {
    const map = {
      telegram_init_data_expired: 'Сессия Telegram устарела. Закрой Mini App и открой его снова.',
      telegram_init_data_invalid: 'Telegram не подтвердил запуск Mini App.',
      telegram_user_missing: 'Telegram не передал данные пользователя.',
      telegram_not_linked: 'Telegram ещё не привязан к Study Job.',
      telegram_account_already_linked: 'Этот Telegram уже привязан к другому аккаунту Study Job.',
      studyjob_account_already_linked: 'К этому аккаунту Study Job уже привязан другой Telegram.',
      student_verification_required: 'Сначала нужно подтвердить студента в Study Job.',
      account_blocked: 'Аккаунт Study Job заблокирован.',
      invalid_credentials: 'Неверная почта или пароль Study Job.',
      captcha_failed: 'Проверка Cloudflare не пройдена.',
      telegram_sso_failed: 'Не удалось выполнить автоматический вход через Telegram.',
      studyjob_auth_user_missing: 'Не удалось найти аккаунт Study Job для этой привязки.',
      network_error: 'Ошибка сети. Проверь подключение и повтори.',
    };
    return map[code] || 'Не удалось выполнить действие.';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function displayName() {
    if (!tgUser) return 'Telegram';
    const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ').trim();
    return name || (tgUser.username ? '@' + tgUser.username : 'Telegram');
  }

  function avatarMarkup() {
    const photo = tgUser && tgUser.photo_url ? String(tgUser.photo_url) : '';
    if (photo) {
      return '<img class="sj-tg-avatar" src="' + escapeHtml(photo) + '" alt="">';
    }
    const initial = escapeHtml((displayName().replace(/^@/, '').trim().charAt(0) || 'T').toUpperCase());
    return '<div class="sj-tg-avatar sj-tg-avatar-fallback">' + initial + '</div>';
  }

  function installStyles() {
    if (document.getElementById('sj-tg-gate-style')) return;
    const style = document.createElement('style');
    style.id = 'sj-tg-gate-style';
    style.textContent = `
      #sj-tg-gate{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:22px max(18px,env(safe-area-inset-right)) max(22px,env(safe-area-inset-bottom)) max(18px,env(safe-area-inset-left));overflow:auto;background:radial-gradient(circle at 50% 10%,rgba(76,92,255,.18),transparent 34%),linear-gradient(180deg,#11141c 0%,#0c0f15 100%);color:#f7f8fc;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
      #sj-tg-gate *{box-sizing:border-box}
      .sj-tg-shell{width:min(100%,430px);margin:auto;padding:8px 0}
      .sj-tg-brand{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:22px;color:#fff;font-weight:800;font-size:17px;letter-spacing:-.02em}
      .sj-tg-brand img{width:34px;height:34px;border-radius:10px;box-shadow:0 8px 28px rgba(40,103,255,.25)}
      .sj-tg-card{position:relative;overflow:hidden;border:1px solid rgba(255,255,255,.09);border-radius:28px;padding:22px;background:rgba(25,29,39,.86);box-shadow:0 24px 70px rgba(0,0,0,.34);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px)}
      .sj-tg-card:before{content:"";position:absolute;width:170px;height:170px;border-radius:50%;right:-80px;top:-90px;background:radial-gradient(circle,rgba(65,92,255,.25),transparent 68%);pointer-events:none}
      .sj-tg-kicker{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:999px;background:rgba(72,102,255,.13);border:1px solid rgba(99,124,255,.2);color:#aebdff;font-size:11px;font-weight:750}
      .sj-tg-title{margin:16px 0 8px;font-size:27px;line-height:1.08;font-weight:850;letter-spacing:-.035em;color:#fff}
      .sj-tg-subtitle{margin:0;color:#9ca5b4;font-size:13px;line-height:1.5}
      .sj-tg-person{display:flex;align-items:center;gap:11px;margin:18px 0 4px;padding:11px 12px;border-radius:17px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.065)}
      .sj-tg-avatar{width:38px;height:38px;border-radius:50%;object-fit:cover;flex:0 0 auto}
      .sj-tg-avatar-fallback{display:grid;place-items:center;background:linear-gradient(135deg,#4c6fff,#31a8ff);color:#fff;font-weight:850}
      .sj-tg-person-copy{min-width:0;flex:1}.sj-tg-person-name{font-size:13px;font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sj-tg-person-meta{margin-top:2px;color:#7f8998;font-size:10.5px}
      .sj-tg-label{display:block;margin:13px 0 6px;color:#9aa4b3;font-size:11px;font-weight:700}
      .sj-tg-input{width:100%;height:46px;border:1px solid rgba(255,255,255,.095);border-radius:14px;padding:0 14px;background:rgba(9,12,17,.5);color:#fff;font-size:14px;outline:none;transition:.16s ease}
      .sj-tg-input:focus{border-color:#6078ff;box-shadow:0 0 0 3px rgba(83,106,255,.12)}
      .sj-tg-input::placeholder{color:#5f6876}
      #sj-tg-turnstile{min-height:68px;display:flex;align-items:center;justify-content:center;margin:14px 0 2px;overflow:hidden}
      .sj-tg-btn{width:100%;min-height:47px;border:0;border-radius:14px;margin-top:10px;padding:11px 14px;font-size:13px;font-weight:800;cursor:pointer;transition:transform .12s ease,opacity .12s ease,background .12s ease}
      .sj-tg-btn:active{transform:scale(.985)}.sj-tg-btn:disabled{opacity:.52;cursor:default;transform:none}
      .sj-tg-btn-primary{background:linear-gradient(135deg,#6377ff,#4c5ef1);color:#fff;box-shadow:0 10px 26px rgba(67,84,231,.24)}
      .sj-tg-btn-secondary{background:rgba(255,255,255,.055);color:#dce2ec;border:1px solid rgba(255,255,255,.07)}
      .sj-tg-note{margin:13px 2px 0;text-align:center;color:#717b89;font-size:10.5px;line-height:1.4}
      .sj-tg-message{display:none;margin:12px 0 0;padding:10px 12px;border-radius:12px;font-size:11.5px;line-height:1.4;background:rgba(255,71,87,.1);border:1px solid rgba(255,82,98,.16);color:#ffc4cb}
      .sj-tg-message.show{display:block}
      .sj-tg-progress{display:flex;flex-direction:column;align-items:center;text-align:center;padding:18px 4px 8px}
      .sj-tg-spinner{width:42px;height:42px;border:3px solid rgba(255,255,255,.11);border-top-color:#7082ff;border-radius:50%;animation:sj-tg-spin .8s linear infinite}
      .sj-tg-progress-title{margin-top:17px;font-size:18px;font-weight:820}.sj-tg-progress-sub{margin-top:7px;color:#8e98a8;font-size:12px;line-height:1.45;max-width:300px}
      @keyframes sj-tg-spin{to{transform:rotate(360deg)}}
      @media(max-width:480px){#sj-tg-gate{align-items:flex-end;padding:12px 10px max(10px,env(safe-area-inset-bottom))}.sj-tg-shell{width:100%}.sj-tg-brand{margin-bottom:12px}.sj-tg-card{border-radius:26px;padding:20px}.sj-tg-title{font-size:25px}}
    `;
    document.head.appendChild(style);
  }

  function ensureGate() {
    installStyles();
    let gate = document.getElementById('sj-tg-gate');
    if (gate) return gate;
    gate = document.createElement('div');
    gate.id = 'sj-tg-gate';
    gate.innerHTML = '<div class="sj-tg-shell"><div class="sj-tg-brand"><img src="/icons/Icon-192.png" alt=""><span>Study Job</span></div><div class="sj-tg-card" id="sj-tg-card"></div></div>';
    document.body.appendChild(gate);
    return gate;
  }

  function setMessage(text) {
    const node = document.getElementById('sj-tg-message');
    if (!node) return;
    node.textContent = text || '';
    node.classList.toggle('show', Boolean(text));
  }

  function setBusy(value) {
    busy = Boolean(value);
    document.querySelectorAll('#sj-tg-gate button,#sj-tg-gate input').forEach(function (node) {
      node.disabled = busy;
    });
  }

  function showProgress(title, subtitle) {
    ensureGate();
    const card = document.getElementById('sj-tg-card');
    card.innerHTML = '<div class="sj-tg-progress"><div class="sj-tg-spinner"></div><div class="sj-tg-progress-title">' + escapeHtml(title) + '</div><div class="sj-tg-progress-sub">' + escapeHtml(subtitle) + '</div></div>';
  }

  function showError(title, text) {
    ensureGate();
    const card = document.getElementById('sj-tg-card');
    card.innerHTML = `
      <span class="sj-tg-kicker">Telegram Mini App</span>
      <h1 class="sj-tg-title">${escapeHtml(title)}</h1>
      <p class="sj-tg-subtitle">${escapeHtml(text)}</p>
      <button class="sj-tg-btn sj-tg-btn-primary" id="sj-tg-retry" type="button">Повторить</button>
      <button class="sj-tg-btn sj-tg-btn-secondary" id="sj-tg-normal" type="button">Войти обычным способом</button>`;
    document.getElementById('sj-tg-retry').onclick = boot;
    document.getElementById('sj-tg-normal').onclick = leaveGate;
  }

  function leaveGate() {
    const gate = document.getElementById('sj-tg-gate');
    if (gate) gate.remove();
  }

  function loadScript(src, test) {
    if (test()) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.defer = true;
      script.onload = function () { test() ? resolve() : reject(new Error('script_load_failed')); };
      script.onerror = function () { reject(new Error('script_load_failed')); };
      document.head.appendChild(script);
    });
  }

  async function loadTurnstile() {
    try {
      await loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', function () { return Boolean(window.turnstile); });
      const host = document.getElementById('sj-tg-turnstile');
      if (!host || turnstileId !== null) return;
      turnstileId = window.turnstile.render(host, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: 'dark',
        callback: function (token) { captchaToken = token; setMessage(''); },
        'expired-callback': function () { captchaToken = ''; },
      });
    } catch (_) {
      setMessage('Не удалось загрузить проверку Cloudflare.');
    }
  }

  function showConnect() {
    ensureGate();
    const card = document.getElementById('sj-tg-card');
    card.innerHTML = `
      <span class="sj-tg-kicker">Telegram Mini App</span>
      <h1 class="sj-tg-title">Один вход — и готово</h1>
      <p class="sj-tg-subtitle">Привяжи существующий аккаунт Study Job к Telegram один раз. После этого Mini App будет входить автоматически.</p>
      <div class="sj-tg-person">${avatarMarkup()}<div class="sj-tg-person-copy"><div class="sj-tg-person-name">${escapeHtml(displayName())}</div><div class="sj-tg-person-meta">Этот Telegram будет привязан к Study Job</div></div></div>
      <label class="sj-tg-label" for="sj-tg-email">Почта Study Job</label>
      <input class="sj-tg-input" id="sj-tg-email" type="email" autocomplete="username" placeholder="name@example.com">
      <label class="sj-tg-label" for="sj-tg-password">Пароль</label>
      <input class="sj-tg-input" id="sj-tg-password" type="password" autocomplete="current-password" placeholder="••••••••">
      <div id="sj-tg-turnstile"></div>
      <div class="sj-tg-message" id="sj-tg-message"></div>
      <button class="sj-tg-btn sj-tg-btn-primary" id="sj-tg-link" type="button">Продолжить через Telegram</button>
      <button class="sj-tg-btn sj-tg-btn-secondary" id="sj-tg-normal" type="button">Войти обычным способом</button>
      <p class="sj-tg-note">Пароль нужен только для первой привязки и не сохраняется в Telegram.</p>`;
    turnstileId = null;
    captchaToken = '';
    document.getElementById('sj-tg-link').onclick = connect;
    document.getElementById('sj-tg-normal').onclick = leaveGate;
    loadTurnstile();
  }

  async function passwordLogin(email, password) {
    const response = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'apikey': PUBLISHABLE_KEY },
      body: JSON.stringify({
        email: email,
        password: password,
        gotrue_meta_security: { captcha_token: captchaToken },
      }),
    });
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok || !data.access_token) {
      const raw = String(data.error_description || data.msg || data.message || '').toLowerCase();
      const code = raw.includes('captcha') ? 'captcha_failed' : 'invalid_credentials';
      const error = new Error(errorText(code));
      error.code = code;
      throw error;
    }
    return String(data.access_token);
  }

  async function requestWriteAccessSoft() {
    if (!telegram || typeof telegram.requestWriteAccess !== 'function') return false;
    return await new Promise(function (resolve) {
      try {
        telegram.requestWriteAccess(function (granted) { resolve(Boolean(granted)); });
      } catch (_) {
        resolve(false);
      }
    });
  }

  async function connect() {
    if (busy) return;
    const emailNode = document.getElementById('sj-tg-email');
    const passNode = document.getElementById('sj-tg-password');
    const email = String(emailNode && emailNode.value || '').trim();
    const password = String(passNode && passNode.value || '');
    if (!email || !password) { setMessage('Введи почту и пароль Study Job.'); return; }
    if (!captchaToken) { setMessage('Сначала пройди проверку Cloudflare.'); return; }

    setBusy(true);
    setMessage('');
    try {
      const accessToken = await passwordLogin(email, password);
      await api(LINK_ENDPOINT, { action: 'link', init_data: initData }, accessToken);
      const granted = await requestWriteAccessSoft();
      if (granted) {
        try { await api(MINIAPP_ENDPOINT, { action: 'confirm_write_access', init_data: initData }); } catch (_) {}
      }
      showProgress('Telegram подключён', 'Открываем твой аккаунт Study Job…');
      await startSso();
    } catch (error) {
      setBusy(false);
      setMessage(error && error.message ? error.message : errorText('network_error'));
      if (window.turnstile && turnstileId !== null) {
        safe(function () { window.turnstile.reset(turnstileId); }, null);
        captchaToken = '';
      }
    }
  }

  async function startSso() {
    const data = await api(SSO_ENDPOINT, { init_data: initData });
    if (!data.linked || !data.action_link) {
      showConnect();
      return;
    }
    window.location.replace(String(data.action_link));
  }

  async function boot() {
    showProgress('Входим через Telegram', 'Проверяем безопасную привязку с Study Job…');
    try {
      const status = await api(MINIAPP_ENDPOINT, { action: 'status', init_data: initData });
      if (!status.linked) {
        showConnect();
        return;
      }
      await startSso();
    } catch (error) {
      showError('Не удалось войти', error && error.message ? error.message : errorText('network_error'));
    }
  }

  boot();
})();
