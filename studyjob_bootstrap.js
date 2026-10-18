// Study Job v11.20.06 web bootstrap.
// Kept as an external script so the production CSP does not need unsafe-inline
// for JavaScript. Supabase auth localStorage is intentionally preserved.
(function () {
  'use strict';

  window.addEventListener('flutter-first-frame', function () {
    const loader = document.getElementById('studyjob-web-loader');
    if (!loader) return;
    loader.classList.add('done');
    window.setTimeout(function () {
      loader.remove();
    }, 320);
  });

  async function startFlutter() {
    // IMPORTANT: bump this marker for every production web release that must
    // invalidate Flutter/Service Worker assets. Auth localStorage is preserved.
    const build = 'studyjob-v42-e5080d6e-20260902';
    const key = 'studyjob_active_web_build';
    const previous = window.localStorage.getItem(key);

    if (previous !== build) {
      try {
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map(function (registration) {
            return registration.unregister();
          }));
        }
        if ('caches' in window) {
          const names = await caches.keys();
          await Promise.all(names.map(function (name) {
            return caches.delete(name);
          }));
        }
      } catch (error) {
        // Do not include credentials/tokens in this message.
        console.warn('Study Job web cache reset failed.');
      }
      window.localStorage.setItem(key, build);
    }

    const script = document.createElement('script');
    script.src = 'flutter_bootstrap.js?v=e5080d6e';
    script.async = true;
    document.body.appendChild(script);
  }

  startFlutter();
})();
