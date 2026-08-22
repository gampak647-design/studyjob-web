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

  function queryParam(name) {
    for (const raw of [
      String(location.hash || '').replace(/^#/, ''),
      String(location.search || '').replace(/^\?/, ''),
    ]) {
      try {
        const value = new URLSearchParams(raw).get(name);
        if (value) return value;
      } catch (_) {}
    }
    return '';
  }

  function isAuthCallback() {
    const hash = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
    return Boolean(hash.get('access_token') && hash.get('refresh_token'));
  }

  // On the same-origin callback Flutter/Supabase must be the only code handling
  // the session. In particular, do not start another Telegram SSO round here.
  if (isAuthCallback()) return;

  const telegram = safe(function () {
    return window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  }, null);
  if (!telegram) return;

  safe(function () { telegram.ready(); }, null);
  safe(function () { telegram.expand(); }, null);
  safe(function () { telegram.setHeaderColor('#101216'); }, null);
  safe(function () { telegram.setBackgroundColor('#101216'); }, null);

  let initData = '';
  let captchaToken = '';
  let turnstileId = null;
  let busy = false;

  function readInitData() {
    return String(safe(function () { return telegram.initData || ''; }, '') || queryParam('tgWebAppData') || '');
  }

  function telegramUser() {
    return safe(function () {
      return telegram.initDataUnsafe && telegram.initDataUnsafe.user
        ? telegram.initDataUnsafe.user
        : null;
    }, null);
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
    const user = telegramUser();
    if (!user) return 'Telegram';
    const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
    return full || (user.username ? '@' + user.username : 'Telegram');
  }

  function avatarMarkup() {
    const user = telegramUser();
    const photo = user && user.photo_url ? String(user.photo_url) : '';
    if (photo) return '<img class="sj-tg-avatar" src="' + escapeHtml(photo) + '" alt="">';
    const initial = escapeHtml((displayName().replace(/^@/, '').trim().charAt(0) || 'T').toUpperCase());
    return '<div class="sj-tg-avatar sj-tg-avatar-fallback">' + initial + '</div>';
  }

  function errorText(code) {
    const map = {
      telegram_init_data_expired: 'Сессия Telegram устарела. Закрой Mini App и открой его снова.',
      telegram_init_data_invalid: 'Telegram не подтвердил безопасный запуск Mini App.',
      telegram_user_missing: 'Telegram не передал данные пользователя.',
      telegram_account_already_linked: 'Этот Telegram уже привязан к другому аккаунту Study Job.',
      studyjob_account_already_linked: 'К этому аккаунту Study Job уже привязан другой Telegram.',
      student_verification_required: 'Сначала нужно подтвердить статус студента в Study Job.',
      account_blocked: 'Доступ к этому аккаунту Study Job ограничен.',
      invalid_credentials: 'Неверная почта или пароль Study Job.',
      captcha_failed: 'Проверка Cloudflare не пройдена.',
      telegram_sso_failed: 'Не удалось создать безопасную сессию Study Job.',
      telegram_sso_token_missing: 'Не удалось подготовить одноразовый вход Study Job.',
      telegram_sso_exchange_failed: 'Не удалось завершить безопасный вход Study Job.',
      studyjob_auth_user_missing: 'Не удалось найти аккаунт Study Job для этой привязки.',
      network_error: 'Ошибка сети. Проверь подключение и повтори.',
    };
    return map[code] || 'Не удалось выполнить действие. Повтори ещё раз.';
  }

  async function api(url, body, accessToken) {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        cache: 'no-store',
        headers: Object.assign({
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'apikey': PUBLISHABLE_KEY,
        }, accessToken ? { 'Authorization': 'Bearer ' + accessToken } : {}),
        body: JSON.stringify(body),
      });
    } catch (_) {
      const error = new Error(errorText('network_error'));
      error.code = 'network_error';
      throw error;
    }

    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok || data.ok !== true) {
      const code = data.error || 'network_error';
      const error = new Error(errorText(code));
      error.code = code;
      throw error;
    }
    return data;
  }

  function installStyles() {
    if (document.getElementById('sj-tg-gate-style')) return;
    const style = document.createElement('style');
    style.id = 'sj-tg-gate-style';
    style.textContent = `
      #sj-tg-gate{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:22px max(18px,env(safe-area-inset-right)) max(22px,env(safe-area-inset-bottom)) max(18px,env(safe-area-inset-left));overflow:auto;background:radial-gradient(circle at 50% 8%,rgba(94,111,255,.17),transparent 33%),linear-gradient(180deg,#11141c 0%,#0d1016 100%);color:#f7f8fc;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
      #sj-tg-gate *{box-sizing:border-box}
      .sj-tg-shell{width:min(100%,430px);margin:auto;padding:8px 0}
      .sj-tg-brand{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:20px;color:#fff;font-size:17px;font-weight:820;letter-spacing:-.02em}
      .sj-tg-brand img{width:34px;height:34px;border-radius:10px;box-shadow:0 10px 30px rgba(43,103,255,.24)}
      .sj-tg-card{position:relative;overflow:hidden;border:1px solid rgba(255,255,255,.09);border-radius:28px;padding:22px;background:rgba(25,29,39,.88);box-shadow:0 24px 70px rgba(0,0,0,.34);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px)}
      .sj-tg-card:before{content:"";position:absolute;width:170px;height:170px;border-radius:50%;right:-80px;top:-92px;background:radial-gradient(circle,rgba(78,101,255,.25),transparent 68%);pointer-events:none}
      .sj-tg-kicker{display:inline-flex;align-items:center;height:28px;padding:0 10px;border-radius:999px;background:rgba(81,105,255,.12);border:1px solid rgba(104,126,255,.2);color:#b6c1ff;font-size:11px;font-weight:760}
      .sj-tg-title{margin:16px 0 8px;font-size:27px;line-height:1.08;font-weight:860;letter-spacing:-.035em;color:#fff}
      .sj-tg-subtitle{margin:0;color:#9ca5b4;font-size:13px;line-height:1.5}
      .sj-tg-person{display:flex;align-items:center;gap:11px;margin:18px 0 5px;padding:11px 12px;border-radius:17px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.065)}
      .sj-tg-avatar{width:38px;height:38px;border-radius:50%;object-fit:cover;flex:0 0 auto}
      .sj-tg-avatar-fallback{display:grid;place-items:center;background:linear-gradient(135deg,#6578ff,#31a8ff);color:#fff;font-weight:850}
      .sj-tg-person-copy{min-width:0;flex:1}.sj-tg-person-name{font-size:13px;font-weight:760;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sj-tg-person-meta{margin-top:2px;color:#7f8998;font-size:10.5px}
      .sj-tg-label{display:block;margin:13px 0 6px;color:#a1aab8;font-size:11px;font-weight:700}
      .sj-tg-input{width:100%;height:47px;border:1px solid rgba(255,255,255,.095);border-radius:14px;padding:0 14px;background:rgba(9,12,17,.52);color:#fff;font-size:14px;outline:none;transition:.16s ease}
      .sj-tg-input:focus{border-color:#6f80ff;box-shadow:0 0 0 3px rgba(91,110,255,.12)}.sj-tg-input::placeholder{color:#5f6876}
      #sj-tg-turnstile{min-height:68px;display:flex;align-items:center;justify-content:center;margin:14px 0 2px;overflow:hidden}
      .sj-tg-btn{width:100%;min-height:47px;border:0;border-radius:14px;margin-top:10px;padding:11px 14px;font-size:13px;font-weight:810;cursor:pointer;transition:transform .12s ease,opacity .12s ease}
      .sj-tg-btn:active{transform:scale(.985)}.sj-tg-btn:disabled{opacity:.5;cursor:default;transform:none}
      .sj-tg-btn-primary{background:linear-gradient(135deg,#687aff,#5062ef);color:#fff;box-shadow:0 10px 26px rgba(67,84,231,.24)}
      .sj-tg-btn-secondary{background:rgba(255,255,255,.055);color:#dce2ec;border:1px solid rgba(255,255,255,.07)}
      .sj-tg-note{margin:13px 2px 0;text-align:center;color:#747e8d;font-size:10.5px;line-height:1.45}
      .sj-tg-message{display:none;margin:12px 0 0;padding:10px 12px;border-radius:12px;font-size:11.5px;line-height:1.4;background:rgba(255,71,87,.1);border:1px solid rgba(255,82,98,.16);color:#ffc4cb}.sj-tg-message.show{display:block}
      .sj-tg-progress{display:flex;flex-direction:column;align-items:center;text-align:center;padding:19px 4px 9px}
      .sj-tg-spinner{width:43px;height:43px;border:3px solid rgba(255,255,255,.11);border-top-color:#7586ff;border-radius:50%;animation:sj-tg-spin .8s linear infinite}
      .sj-tg-progress-title{margin-top:17px;font-size:18px;font-weight:830}.sj-tg-progress-sub{margin-top:7px;color:#909aa9;font-size:12px;line-height:1.45;max-width:310px}
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

  function showProgress(title, subtitle) {
    ensureGate();
    document.getElementById('sj-tg-card').innerHTML =
      '<div class="sj-tg-progress"><div class="sj-tg-spinner"></div><div class="sj-tg-progress-title">' +
      escapeHtml(title) + '</div><div class="sj-tg-progress-sub">' + escapeHtml(subtitle) + '</div></div>';
  }

  function showError(title, text) {
    ensureGate();
    document.getElementById('sj-tg-card').innerHTML = `
      <span class="sj-tg-kicker">Telegram Mini App</span>
      <h1 class="sj-tg-title">${escapeHtml(title)}</h1>
      <p class="sj-tg-subtitle">${escapeHtml(text)}</p>
      <button class="sj-tg-btn sj-tg-btn-primary" id="sj-tg-retry" type="button">Повторить</button>
      <button class="sj-tg-btn sj-tg-btn-secondary" id="sj-tg-normal" type="button">Войти обычным способом</button>`;
    document.getElementById('sj-tg-retry').onclick = boot;
    document.getElementById('sj-tg-normal').onclick = removeGate;
  }

  function removeGate() {
    const gate = document.getElementById('sj-tg-gate');
    if (gate) gate.remove();
  }

  function setBusy(value) {
    busy = Boolean(value);
    document.querySelectorAll('#sj-tg-gate button,#sj-tg-gate input').forEach(function (node) {
      node.disabled = busy;
    });
  }

  function setMessage(text) {
    const node = document.getElementById('sj-tg-message');
    if (!node) return;
    node.textContent = text || '';
    node.classList.toggle('show', Boolean(text));
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
      await loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', function () {
        return Boolean(window.turnstile);
      });
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
    captchaToken = '';
    turnstileId = null;
    const username = safe(function () { return telegramUser().username || ''; }, '');
    document.getElementById('sj-tg-card').innerHTML = `
      <span class="sj-tg-kicker">Первый запуск</span>
      <h1 class="sj-tg-title">Один вход — и готово</h1>
      <p class="sj-tg-subtitle">Привяжи существующий аккаунт Study Job к Telegram один раз. При следующих запусках вход будет автоматическим.</p>
      <div class="sj-tg-person">${avatarMarkup()}<div class="sj-tg-person-copy"><div class="sj-tg-person-name">${escapeHtml(displayName())}</div><div class="sj-tg-person-meta">${username ? '@' + escapeHtml(username) : '@' + BOT_USERNAME}</div></div></div>
      <div id="sj-tg-message" class="sj-tg-message"></div>
      <label class="sj-tg-label" for="sj-tg-email">Почта Study Job</label>
      <input id="sj-tg-email" class="sj-tg-input" type="email" autocomplete="username" placeholder="name@example.com">
      <label class="sj-tg-label" for="sj-tg-password">Пароль</label>
      <input id="sj-tg-password" class="sj-tg-input" type="password" autocomplete="current-password" placeholder="Пароль">
      <div id="sj-tg-turnstile"></div>
      <button id="sj-tg-connect" class="sj-tg-btn sj-tg-btn-primary" type="button">Подключить Telegram</button>
      <button id="sj-tg-normal" class="sj-tg-btn sj-tg-btn-secondary" type="button">Войти обычным способом</button>
      <p class="sj-tg-note">Пароль используется только для подтверждения существующего аккаунта и не сохраняется Telegram-слоем.</p>`;

    document.getElementById('sj-tg-connect').onclick = connectAccount;
    document.getElementById('sj-tg-normal').onclick = removeGate;
    void loadTurnstile();
  }

  async function passwordLogin(email, password) {
    const response = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'apikey': PUBLISHABLE_KEY,
      },
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

  async function requestWritePermission() {
    if (typeof telegram.requestWriteAccess !== 'function') return false;
    return await new Promise(function (resolve) {
      let finished = false;
      const done = function (value) {
        if (finished) return;
        finished = true;
        resolve(Boolean(value));
      };
      try {
        const maybePromise = telegram.requestWriteAccess(function (allowed) { done(allowed); });
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(done).catch(function () { done(false); });
        }
        setTimeout(function () { done(false); }, 12000);
      } catch (_) {
        done(false);
      }
    });
  }

  async function connectAccount() {
    if (busy) return;
    const email = String(document.getElementById('sj-tg-email').value || '').trim();
    const password = String(document.getElementById('sj-tg-password').value || '');
    if (!email || !password) {
      setMessage('Введи почту и пароль Study Job.');
      return;
    }
    if (!captchaToken) {
      setMessage('Сначала пройди проверку Cloudflare.');
      return;
    }

    setBusy(true);
    setMessage('');
    try {
      const accessToken = await passwordLogin(email, password);
      await api(LINK_ENDPOINT, { action: 'link', init_data: initData }, accessToken);

      showProgress('Telegram подключён', 'Настраиваем автоматический вход и уведомления…');
      const allowed = await requestWritePermission();
      if (allowed) {
        try {
          await api(MINIAPP_ENDPOINT, { action: 'confirm_write_access', init_data: initData });
        } catch (_) {}
      }
      await startSso();
    } catch (error) {
      showConnect();
      setMessage(error && error.message ? error.message : errorText('network_error'));
      try {
        if (window.turnstile && turnstileId !== null) window.turnstile.reset(turnstileId);
      } catch (_) {}
      captchaToken = '';
    } finally {
      setBusy(false);
    }
  }

  async function startSso() {
    const data = await api(SSO_ENDPOINT, { init_data: initData });
    if (!data.linked) {
      showConnect();
      return;
    }
    if (!data.access_token || !data.refresh_token) {
      const error = new Error(errorText('telegram_sso_failed'));
      error.code = 'telegram_sso_failed';
      throw error;
    }

    // Same-origin implicit callback. No Supabase /verify page is opened in the
    // Telegram WebView, so legacy campusgo:// redirect settings cannot block it.
    const hash = new URLSearchParams({
      access_token: String(data.access_token),
      refresh_token: String(data.refresh_token),
      expires_in: String(data.expires_in || 3600),
      token_type: String(data.token_type || 'bearer'),
      type: 'magiclink',
    }).toString();
    window.location.replace('/telegram/#' + hash);
  }

  async function waitForInitData() {
    for (let i = 0; i < 24; i++) {
      const value = readInitData();
      if (value) return value;
      await new Promise(function (resolve) { setTimeout(resolve, 125); });
    }
    return readInitData();
  }

  async function boot() {
    showProgress('Входим через Telegram', 'Проверяем безопасную привязку с Study Job…');
    try {
      initData = await waitForInitData();
      if (!initData) {
        showError('Не получили данные Telegram', 'Закрой Mini App и открой его ещё раз через @' + BOT_USERNAME + '.');
        return;
      }
      await startSso();
    } catch (error) {
      showError('Не удалось войти', error && error.message ? error.message : errorText('network_error'));
    }
  }

  void boot();
})();
