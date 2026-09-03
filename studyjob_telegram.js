// Study Job Telegram Mini App bridge.
// This file exposes Telegram launch context to Dart. Authorization decisions
// must still be made server-side after validating initData.
(function () {
  'use strict';

  const SIGNED_OUT_KEY = 'studyjob_telegram_signed_out_user_v1';

  function currentTelegram() {
    try {
      return window.Telegram && window.Telegram.WebApp
        ? window.Telegram.WebApp
        : null;
    } catch (_) {
      return null;
    }
  }

  function safeString(value) {
    return typeof value === 'string' ? value : '';
  }

  function currentTelegramUserId() {
    const telegram = currentTelegram();
    try {
      const user = telegram && telegram.initDataUnsafe
        ? telegram.initDataUnsafe.user
        : null;
      const id = user ? Number(user.id) : 0;
      return Number.isSafeInteger(id) && id > 0 ? String(id) : '';
    } catch (_) {
      return '';
    }
  }

  function markSignedOut() {
    const id = currentTelegramUserId();
    if (!id) return false;
    try {
      window.localStorage.setItem(SIGNED_OUT_KEY, id);
      return true;
    } catch (_) {
      return false;
    }
  }

  function clearSignedOut() {
    const id = currentTelegramUserId();
    if (!id) return false;
    try {
      if (window.localStorage.getItem(SIGNED_OUT_KEY) === id) {
        window.localStorage.removeItem(SIGNED_OUT_KEY);
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function isSignedOut() {
    const id = currentTelegramUserId();
    if (!id) return false;
    try {
      return window.localStorage.getItem(SIGNED_OUT_KEY) === id;
    } catch (_) {
      return false;
    }
  }

  function prepareTelegram() {
    const telegram = currentTelegram();
    if (!telegram) return false;
    try {
      if (typeof telegram.ready === 'function') telegram.ready();
      if (typeof telegram.expand === 'function') telegram.expand();
      if (typeof telegram.disableVerticalSwipes === 'function') {
        telegram.disableVerticalSwipes();
      }
    } catch (_) {}
    return true;
  }

  function isMiniApp() {
    const telegram = currentTelegram();
    return Boolean(
      telegram &&
      typeof telegram.initData === 'string' &&
      telegram.initData.length > 0
    );
  }

  async function requestWriteAccess() {
    const telegram = currentTelegram();
    if (!telegram || typeof telegram.requestWriteAccess !== 'function') {
      return false;
    }
    return await new Promise(function (resolve) {
      try {
        telegram.requestWriteAccess(function (granted) {
          resolve(granted === true);
        });
      } catch (_) {
        resolve(false);
      }
    });
  }

  function openTelegramLink(url) {
    if (typeof url !== 'string' || !url.startsWith('https://t.me/')) return false;
    const telegram = currentTelegram();
    try {
      if (telegram && typeof telegram.openTelegramLink === 'function') {
        telegram.openTelegramLink(url);
        return true;
      }
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      return Boolean(opened);
    } catch (_) {
      return false;
    }
  }

  window.StudyJobTelegram = Object.freeze({
    isMiniApp: function () {
      prepareTelegram();
      return isMiniApp();
    },
    getInitData: function () {
      prepareTelegram();
      const telegram = currentTelegram();
      return telegram ? safeString(telegram.initData) : '';
    },
    getUserId: function () {
      prepareTelegram();
      return currentTelegramUserId();
    },
    getPlatform: function () {
      const telegram = currentTelegram();
      return telegram ? safeString(telegram.platform) : '';
    },
    getColorScheme: function () {
      const telegram = currentTelegram();
      return telegram ? safeString(telegram.colorScheme) : '';
    },
    getStartParam: function () {
      const telegram = currentTelegram();
      if (!telegram || !telegram.initDataUnsafe) return '';
      return safeString(telegram.initDataUnsafe.start_param);
    },
    markSignedOut: markSignedOut,
    clearSignedOut: clearSignedOut,
    isSignedOut: isSignedOut,
    requestWriteAccess: requestWriteAccess,
    openTelegramLink: openTelegramLink,
  });

  [0, 50, 150, 300, 600, 1000, 1600].forEach(function (delay) {
    window.setTimeout(function () {
      const available = prepareTelegram() && isMiniApp();
      window.dispatchEvent(new CustomEvent('studyjob-telegram-ready', {
        detail: { available: available },
      }));
    }, delay);
  });

  window.addEventListener('focus', prepareTelegram);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) prepareTelegram();
  });
})();