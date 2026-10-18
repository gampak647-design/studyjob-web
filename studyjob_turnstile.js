(() => {
  let apiPromise = null;
  let activePromise = null;

  function hasApi() {
    return Boolean(
      globalThis.turnstile &&
      typeof globalThis.turnstile.render === 'function',
    );
  }

  function waitForApi(timeoutMs = 12000) {
    if (hasApi()) return Promise.resolve(globalThis.turnstile);
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (hasApi()) {
          clearInterval(timer);
          resolve(globalThis.turnstile);
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          clearInterval(timer);
          reject(new Error('turnstile_api_timeout'));
        }
      }, 50);
    });
  }

  function loadApi() {
    if (hasApi()) return Promise.resolve(globalThis.turnstile);
    if (apiPromise) return apiPromise;

    apiPromise = new Promise((resolve, reject) => {
      let script = document.querySelector(
        'script[data-studyjob-turnstile-api="1"]',
      );

      if (!script) {
        script = document.createElement('script');
        script.src =
          'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.dataset.studyjobTurnstileApi = '1';
        script.onerror = () => reject(new Error('turnstile_api_load_failed'));
        document.head.appendChild(script);
      }

      waitForApi().then(resolve, reject);
    }).catch((error) => {
      apiPromise = null;
      throw error;
    });

    return apiPromise;
  }

  function normalizeAction(action) {
    const value = String(action || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_')
      .slice(0, 32);
    return value || 'auth';
  }

  function createOverlay() {
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Проверка безопасности Study Job');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 'max(20px, env(safe-area-inset-top)) 20px max(20px, env(safe-area-inset-bottom))',
      boxSizing: 'border-box',
      background: 'rgba(0, 0, 0, 0.38)',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
    });

    const card = document.createElement('div');
    Object.assign(card.style, {
      width: 'min(420px, 100%)',
      boxSizing: 'border-box',
      padding: '20px',
      borderRadius: '22px',
      background: '#ffffff',
      color: '#17171b',
      boxShadow: '0 22px 70px rgba(0,0,0,.28)',
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
    });

    const title = document.createElement('div');
    title.textContent = 'Проверка безопасности';
    Object.assign(title.style, {
      fontSize: '20px',
      lineHeight: '1.25',
      fontWeight: '800',
      marginBottom: '8px',
    });

    const description = document.createElement('div');
    description.textContent =
      'Study Job проверяет, что запрос отправляет человек. Обычно это занимает несколько секунд.';
    Object.assign(description.style, {
      fontSize: '14px',
      lineHeight: '1.45',
      color: '#65656f',
      marginBottom: '16px',
    });

    const hostWrap = document.createElement('div');
    Object.assign(hostWrap.style, {
      width: '100%',
      minHeight: '68px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      borderRadius: '14px',
    });

    const host = document.createElement('div');
    host.style.width = '100%';
    hostWrap.appendChild(host);

    const status = document.createElement('div');
    status.textContent = 'Запускаем проверку…';
    Object.assign(status.style, {
      marginTop: '12px',
      minHeight: '20px',
      fontSize: '13px',
      lineHeight: '1.4',
      color: '#73737d',
      textAlign: 'center',
    });

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Отмена';
    Object.assign(cancel.style, {
      display: 'block',
      width: '100%',
      marginTop: '12px',
      padding: '11px 14px',
      border: '0',
      borderRadius: '12px',
      background: '#f0f0f4',
      color: '#27272c',
      fontSize: '15px',
      fontWeight: '700',
      cursor: 'pointer',
    });

    card.appendChild(title);
    card.appendChild(description);
    card.appendChild(hostWrap);
    card.appendChild(status);
    card.appendChild(cancel);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    return { overlay, host, status, cancel };
  }

  async function requestTokenInternal(siteKey, action) {
    const key = String(siteKey || '').trim();
    if (!key) return '';

    let api;
    try {
      api = await loadApi();
    } catch (_) {
      return '';
    }

    const ui = createOverlay();

    return new Promise((resolve) => {
      let settled = false;
      let widgetId = null;
      let errorCount = 0;

      const finish = (token) => {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimeout);
        try {
          if (widgetId != null && typeof api.remove === 'function') {
            api.remove(widgetId);
          }
        } catch (_) {}
        try {
          ui.overlay.remove();
        } catch (_) {}
        resolve(String(token || '').trim());
      };

      ui.cancel.addEventListener('click', () => finish(''), { once: true });

      const hardTimeout = setTimeout(() => finish(''), 90000);

      try {
        widgetId = api.render(ui.host, {
          sitekey: key,
          action: normalizeAction(action),
          theme: 'auto',
          language: 'ru',
          size: window.innerWidth < 390 ? 'compact' : 'flexible',
          retry: 'auto',
          'retry-interval': 2500,
          'refresh-expired': 'auto',
          callback(token) {
            ui.status.textContent = 'Проверка пройдена.';
            finish(token);
          },
          'error-callback'(errorCode) {
            errorCount += 1;
            ui.status.textContent =
              'Проверка не прошла. Cloudflare повторяет попытку…';
            if (errorCount >= 3) {
              setTimeout(() => finish(''), 900);
            }
            return true;
          },
          'expired-callback'() {
            ui.status.textContent = 'Проверка обновляется…';
            try {
              if (widgetId != null && typeof api.reset === 'function') {
                api.reset(widgetId);
              }
            } catch (_) {}
          },
          'timeout-callback'() {
            ui.status.textContent = 'Проверка заняла слишком много времени. Повторяем…';
            try {
              if (widgetId != null && typeof api.reset === 'function') {
                api.reset(widgetId);
              }
            } catch (_) {}
          },
          'unsupported-callback'() {
            ui.status.textContent =
              'Этот браузер не поддерживает проверку безопасности.';
            setTimeout(() => finish(''), 900);
          },
        });
        ui.status.textContent = 'Выполняем проверку…';
      } catch (_) {
        finish('');
      }
    });
  }

  globalThis.StudyJobTurnstileWeb = {
    requestToken(siteKey, action) {
      if (activePromise) return activePromise;
      activePromise = requestTokenInternal(siteKey, action).finally(() => {
        activePromise = null;
      });
      return activePromise;
    },
  };
})();
