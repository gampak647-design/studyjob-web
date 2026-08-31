(function () {
  'use strict';

  const params = new URLSearchParams(String(location.search || '').replace(/^\?/, ''));
  if (params.get('existing') === '1') return;

  let applied = false;

  function makeText(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    return node;
  }

  function transformFirstLaunch() {
    if (applied) return;

    const card = document.getElementById('sj-tg-card');
    if (!card) return;

    const title = card.querySelector('.sj-tg-title');
    if (!title || String(title.textContent || '').trim() !== 'Привязать Study Job') {
      return;
    }

    const person = card.querySelector('.sj-tg-person');
    const personClone = person ? person.cloneNode(true) : null;

    card.replaceChildren();
    card.appendChild(makeText('span', 'sj-tg-kicker', 'Первый запуск'));
    card.appendChild(makeText('h1', 'sj-tg-title', 'Добро пожаловать в Study Job'));
    card.appendChild(makeText(
      'p',
      'sj-tg-subtitle',
      'Если аккаунта Study Job ещё нет — сначала создай его. Если аккаунт уже есть — привяжи его к Telegram один раз.',
    ));

    if (personClone) card.appendChild(personClone);

    const createButton = makeText(
      'button',
      'sj-tg-btn sj-tg-btn-primary',
      'Создать аккаунт Study Job',
    );
    createButton.type = 'button';
    createButton.addEventListener('click', function () {
      location.assign('/?tg_signup=1');
    });
    card.appendChild(createButton);

    const existingButton = makeText(
      'button',
      'sj-tg-btn',
      'У меня уже есть аккаунт',
    );
    existingButton.type = 'button';
    Object.assign(existingButton.style, {
      background: 'rgba(255,255,255,.055)',
      color: '#f5f7ff',
      border: '1px solid rgba(255,255,255,.1)',
    });
    existingButton.addEventListener('click', function () {
      const url = new URL('/telegram/', location.origin);
      url.searchParams.set('existing', '1');
      url.searchParams.set('retry', String(Date.now()));
      location.replace(url.pathname + '?' + url.searchParams.toString());
    });
    card.appendChild(existingButton);

    card.appendChild(makeText(
      'p',
      'sj-tg-note',
      'После регистрации и подтверждения почты снова открой Mini App и привяжи созданный аккаунт к Telegram.',
    ));

    applied = true;
  }

  const observer = new MutationObserver(transformFirstLaunch);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', transformFirstLaunch, { once: true });
  } else {
    transformFirstLaunch();
  }
})();
