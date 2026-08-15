// Визард «Паспорт изделия», все 6 разделов построены. Раздел 6 (установка)
// намеренно остаётся документацией «что произойдёт», а не фейковым живым
// прогрессом — бэкенда, который реально ставит сервер, здесь ещё нет, и
// притворяться, что он есть, было бы менее честно, чем прямо это сказать
// (см. PRODUCT.md → Product Principles → Placeholder-honest).

const tg = window.Telegram && window.Telegram.WebApp;

if (tg) {
  tg.ready();
  tg.expand();

  // Мир страницы — крафт-бумага, вне зависимости от темы Telegram (см.
  // контракт направления в index.html) — но шапка/фон вокруг вьюпорта
  // должны совпасть, чтобы не было чужеродной рамки другого цвета.
  const paper = '#EDE6D6';
  try {
    tg.setHeaderColor(paper);
    tg.setBackgroundColor(paper);
  } catch (err) {
    // Старые клиенты Telegram могут не поддерживать эти вызовы — не критично.
  }
}

// ─── Общее состояние визарда ─────────────────────────────────────────────
// Ничего отсюда пока никуда не отправляется (backend не существует — см.
// PRODUCT.md → Operating Context) — но копится по-настоящему, чтобы разделы
// друг на друга ссылались (допы читают plan, сервер — тариф для подсказки)
// и чтобы будущему backend-подключению не пришлось переписывать форму.
const wizardState = {
  plan: null, // 'PRO' | 'CRAZY' | 'PREMIUM'
  addons: new Set(),
  botToken: null,
  server: { ip: null, port: null, password: null },
};

const PLAN_INFO = {
  PRO: { ram: '4 ГБ', price: 500 },
  CRAZY: { ram: '8 ГБ', price: 700 },
  PREMIUM: { ram: '8 ГБ', price: 3990 },
};

const TOKEN_RE = /^\d+:[A-Za-z0-9_-]+$/;
const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const PORT_RE = /^\d{1,5}$/;

function formatRub(n) {
  return `${n.toLocaleString('ru-RU')} ₽`;
}

// ─── Router между разделами ─────────────────────────────────────────────
// Разделы переключаются через [hidden], а не через отдельные страницы —
// внутри Telegram Mini App это ощущается как один непрерывный документ,
// а не серия перезагрузок. Порядок здесь совпадает с шагами из
// concierge-bot/index.js и PRODUCT.md → Capabilities and Constraints.

const screenOrder = ['intro', 'plan', 'addons', 'botfather', 'server', 'done'];
let currentIndex = 0;

// Некоторые разделы зависят от состояния, накопленного раньше (тариф из
// раздела 2), поэтому перерисовываются заново при каждом входе — не только
// при первой сборке DOM.
const onEnter = {
  addons: renderAddonsScreen,
  server: renderServerScreen,
};

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((el) => {
    el.hidden = el.dataset.screen !== name;
  });
  if (onEnter[name]) onEnter[name]();
  if (tg && tg.BackButton) {
    if (name === 'intro') {
      tg.BackButton.hide();
    } else {
      tg.BackButton.show();
    }
  }
  window.scrollTo(0, 0);
}

function goToScreen(index) {
  currentIndex = index;
  showScreen(screenOrder[currentIndex]);
}

function goToScreenByName(name) {
  goToScreen(screenOrder.indexOf(name));
}

if (tg && tg.BackButton) {
  tg.BackButton.onClick(() => {
    if (currentIndex > 0) {
      goToScreen(currentIndex - 1);
    }
  });
}

function tap() {
  if (tg && tg.HapticFeedback) {
    tg.HapticFeedback.impactOccurred('light');
  }
}

// ─── Раздел 1: знакомство ────────────────────────────────────────────────

document.getElementById('start-btn').addEventListener('click', () => {
  tap();
  goToScreenByName('plan');
});

// ─── Раздел 2: тариф ─────────────────────────────────────────────────────
// Копия и цены зеркалят concierge-bot/index.js (PLANS.PRO / PLANS.CRAZY).
// «Премиум» — не отдельный серверный тариф, а маркетинговый пакет: под
// капотом это тот же Crazy (8 ГБ, все допы требуют именно его), но со всеми
// 9 допфункциями включёнными сразу — раздел допфункций читает
// wizardState.plan === 'PREMIUM' и сразу отмечает все допы вместо того,
// чтобы заставлять премиум-покупателя выбирать их вручную.

const planNextBtn = document.getElementById('plan-next-btn');

document.querySelectorAll('input[name="plan"]').forEach((input) => {
  input.addEventListener('change', () => {
    wizardState.plan = input.value;
    document.querySelectorAll('.plan-option').forEach((option) => {
      option.classList.toggle('plan-option--selected', option.querySelector('input').checked);
    });
    planNextBtn.disabled = false;
    if (tg && tg.HapticFeedback) tg.HapticFeedback.selectionChanged();
  });
});

planNextBtn.addEventListener('click', () => {
  if (planNextBtn.disabled) return;
  tap();
  goToScreenByName('addons');
});

// ─── Раздел 3: допфункции ────────────────────────────────────────────────
// Все 9 функций в concierge-bot/index.js требуют тариф Crazy (requiresCrazy:
// true у каждой) — на PRO они видны, но заблокированы; на «Премиум» уже
// включены и заблокированы в другую сторону (нечего выбирать, всё есть).

const addonsNote = document.getElementById('addons-note');
const totalPriceEl = document.getElementById('total-price');
const addonsNextBtn = document.getElementById('addons-next-btn');

function renderAddonsScreen() {
  const plan = wizardState.plan || 'CRAZY';

  document.querySelectorAll('.addon-option').forEach((option) => {
    const input = option.querySelector('.addon-option__input');
    const priceEl = option.querySelector('.addon-option__price');
    const lockEl = option.querySelector('.addon-option__lock');
    const basePrice = Number(option.dataset.price);

    option.classList.remove('addon-option--locked', 'addon-option--included');
    lockEl.hidden = true;

    if (plan === 'PREMIUM') {
      input.checked = true;
      input.disabled = true;
      wizardState.addons.add(input.value);
      option.classList.add('addon-option--included', 'addon-option--selected');
      priceEl.textContent = 'Включено';
    } else if (plan === 'PRO') {
      input.checked = false;
      input.disabled = true;
      wizardState.addons.delete(input.value);
      option.classList.add('addon-option--locked');
      option.classList.remove('addon-option--selected');
      lockEl.hidden = false;
      priceEl.textContent = formatRub(basePrice);
    } else {
      input.disabled = false;
      option.classList.toggle('addon-option--selected', input.checked);
      priceEl.textContent = formatRub(basePrice);
    }
  });

  if (plan === 'PRO') {
    addonsNote.textContent =
      'Эти функции требуют тариф «Активное использование». На вашем текущем тарифе их можно посмотреть, но не подключить — вернитесь на предыдущий раздел, чтобы сменить тариф.';
  } else if (plan === 'PREMIUM') {
    addonsNote.textContent = 'Все функции уже включены в «Премиум» — здесь нечего выбирать, просто справочный список.';
  } else {
    addonsNote.textContent = 'Выберите любые функции — они добавятся к ежемесячной оплате тарифа «Активное использование».';
  }

  updateTotal();
}

function updateTotal() {
  const plan = wizardState.plan || 'CRAZY';
  const base = PLAN_INFO[plan]?.price ?? 0;
  let addonsSum = 0;
  if (plan === 'CRAZY') {
    document.querySelectorAll('.addon-option__input:checked').forEach((input) => {
      addonsSum += Number(input.closest('.addon-option').dataset.price);
    });
  }
  totalPriceEl.textContent = formatRub(base + addonsSum);
}

document.querySelectorAll('.addon-option__input').forEach((input) => {
  input.addEventListener('change', () => {
    const option = input.closest('.addon-option');
    option.classList.toggle('addon-option--selected', input.checked);
    if (input.checked) {
      wizardState.addons.add(input.value);
    } else {
      wizardState.addons.delete(input.value);
    }
    if (tg && tg.HapticFeedback) tg.HapticFeedback.selectionChanged();
    updateTotal();
  });
});

addonsNextBtn.addEventListener('click', () => {
  tap();
  goToScreenByName('botfather');
});

// ─── Раздел 4: свой бот через BotFather ──────────────────────────────────

const tokenInput = document.getElementById('token-input');
const tokenField = document.getElementById('token-field');
const tokenError = document.getElementById('token-error');
const botfatherNextBtn = document.getElementById('botfather-next-btn');

tokenInput.addEventListener('input', () => {
  const value = tokenInput.value.trim();
  const valid = TOKEN_RE.test(value);
  const dirty = value.length > 0;
  tokenField.classList.toggle('field--invalid', dirty && !valid);
  tokenError.hidden = !(dirty && !valid);
  botfatherNextBtn.disabled = !valid;
  wizardState.botToken = valid ? value : null;
});

botfatherNextBtn.addEventListener('click', () => {
  if (botfatherNextBtn.disabled) return;
  tap();
  goToScreenByName('server');
});

// ─── Раздел 5: сервер ────────────────────────────────────────────────────

const ipInput = document.getElementById('ip-input');
const ipError = document.getElementById('ip-error');
const portInput = document.getElementById('port-input');
const portError = document.getElementById('port-error');
const passwordInput = document.getElementById('password-input');
const serverIntroText = document.getElementById('server-intro-text');
const serverNextBtn = document.getElementById('server-next-btn');

function renderServerScreen() {
  const plan = wizardState.plan || 'CRAZY';
  const info = PLAN_INFO[plan] ?? PLAN_INFO.CRAZY;
  serverIntroText.textContent =
    `Купите сервер (VPS) под тариф — ${info.ram} ОЗУ, обязательно Ubuntu 24, локация любая. ` +
    'Когда сервер готов, впишите его данные из панели хостинга ниже.';
  validateServerForm();
}

function validateServerForm() {
  const ip = ipInput.value.trim();
  const port = portInput.value.trim();
  const password = passwordInput.value;

  const ipValid = IP_RE.test(ip);
  const portValid = port === '' || PORT_RE.test(port);
  const passwordValid = password.length > 0;

  ipInput.closest('.field').classList.toggle('field--invalid', ip.length > 0 && !ipValid);
  ipError.hidden = !(ip.length > 0 && !ipValid);

  portInput.closest('.field').classList.toggle('field--invalid', port.length > 0 && !portValid);
  portError.hidden = !(port.length > 0 && !portValid);

  const valid = ipValid && portValid && passwordValid;
  serverNextBtn.disabled = !valid;
  return valid;
}

[ipInput, portInput, passwordInput].forEach((el) => {
  el.addEventListener('input', validateServerForm);
});

serverNextBtn.addEventListener('click', () => {
  if (!validateServerForm()) return;
  wizardState.server = {
    ip: ipInput.value.trim(),
    port: Number(portInput.value.trim() || 22),
    password: passwordInput.value,
  };
  tap();
  goToScreenByName('done');
  // Пароль был нужен только для передачи дальше — не оставляем его в поле
  // формы дольше, чем до перехода на следующий раздел.
  passwordInput.value = '';
});
