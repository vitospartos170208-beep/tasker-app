// Визард PROha, 7 разделов (тариф выбирать больше не нужно — один
// серверный вариант на всех; раздел «Как это оплачивается» — статичное
// объяснение модели цен перед выбором допфункций; раздел «Оплата» пока
// заглушка, реальный приём платежей ещё не подключён). Последний раздел
// («Что произойдёт дальше»)
// в реальном Telegram почти никто не увидит: sendData() закрывает Mini App
// сразу после отправки формы, и дальше идёт настоящая установка через
// concierge-bot (SSH, provisionServer()) — этот раздел виден только как
// честный фолбэк вне Telegram, где sendData недоступен (см. ниже).

const tg = window.Telegram && window.Telegram.WebApp;

if (tg) {
  tg.ready();
  tg.expand();

  // Фон страницы — холодно-белый (--paper в style.css), вне зависимости
  // от темы Telegram (см. контракт направления в index.html) — но шапка/фон
  // вокруг вьюпорта должны совпасть, чтобы не было чужеродной рамки
  // другого цвета. Раньше здесь стоял цвет старой крафт-бумажной системы
  // (#EDE6D6) — не тронутый при редизайне на PROha, из-за чего шапка/фон
  // Telegram вокруг вьюпорта были бежевыми, а сама страница — сине-белой.
  const paper = '#F4F7FC';
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
// друг на друга ссылались и чтобы будущему backend-подключению не пришлось
// переписывать форму.
//
// plan зафиксирован на CRAZY — раздел выбора тарифа убран (у продукта
// теперь один серверный вариант, каждый клиент покупает его), но само
// поле в payload осталось: concierge-bot/index.js по-прежнему валидирует
// plan через ['PRO','CRAZY','PREMIUM'].includes(...), значение 'CRAZY'
// для него — обычный валидный тариф, менять бота не пришлось.
const wizardState = {
  plan: 'CRAZY',
  addons: new Set(),
  botToken: null,
  server: { ip: null, port: null, password: null },
};

const PLAN_INFO = {
  // price здесь — оценка ежемесячной аренды VPS, которую клиент покупает
  // САМ у стороннего хостера (см. экран «Сервер»: поля IP/порт/пароль от
  // уже существующего сервера клиента) — это не наша выручка, деньги идут
  // мимо нас. Использовать только для информационного текста (экран «Как
  // это оплачивается»), не складывать с BASE_SETUP_FEE или допфункциями.
  CRAZY: { ram: '8 ГБ', price: 700 },
};

// Разовая ставка за помощь с подключением — реальная выручка, в отличие
// от PLAN_INFO.price выше. Библиотеки навыков клиенту передаются «под
// ключ» (готовые, не шаблонные), отсюда и ставка выше рыночной за
// типовую настройку личного ИИ-агента.
const BASE_SETUP_FEE = 100000;

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

const screenOrder = ['intro', 'pricing', 'addons', 'payment', 'botfather', 'server', 'done'];
let currentIndex = 0;

// Некоторые разделы зависят от состояния, накопленного раньше (тариф из
// раздела 2), поэтому перерисовываются заново при каждом входе — не только
// при первой сборке DOM.
const onEnter = {
  addons: renderAddonsScreen,
  payment: renderPaymentScreen,
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
  goToScreenByName('pricing');
});

// ─── Раздел 2: как это оплачивается (объяснение, без сумм визарда) ───────
// Статический экран — ничего не считает и не зависит от выбора допфункций
// на следующем шаге, просто объясняет модель до того, как человек начнёт
// выбирать: разовая оплата (допфункции) отдельно от двух ежемесячных
// платежей (сервер — нам, подписка на ИИ — напрямую её разработчику).

document.getElementById('pricing-next-btn').addEventListener('click', () => {
  tap();
  goToScreenByName('addons');
});

// ─── Раздел 3: допфункции ────────────────────────────────────────────────
// Тариф больше не выбирается (один серверный вариант на всех, см.
// wizardState.plan) — значит, допфункции никогда не блокируются и не
// включаются автоматически, всегда обычный чекбокс-список.

const addonsNote = document.getElementById('addons-note');
const totalPriceEl = document.getElementById('total-price');
const addonsNextBtn = document.getElementById('addons-next-btn');

function renderAddonsScreen() {
  document.querySelectorAll('.addon-option').forEach((option) => {
    const input = option.querySelector('.addon-option__input');
    const priceEl = option.querySelector('.addon-option__price');
    input.disabled = false;
    option.classList.toggle('addon-option--selected', input.checked);
    priceEl.textContent = formatRub(Number(option.dataset.price));
  });

  updateTotal();
}

function updateTotal() {
  totalPriceEl.textContent = formatRub(computeTotal());
}

// Базовая ставка + допфункции — обе части разовые (см. экран «Как это
// оплачивается»), поэтому складываются в одну сумму. PLAN_INFO.CRAZY.price
// сюда по-прежнему не входит — это цена аренды сервера, ежемесячный
// платёж мимо нас (клиент платит хостеру напрямую), к разовой сумме
// отношения не имеет.
function computeTotal() {
  let addonsSum = 0;
  document.querySelectorAll('.addon-option__input:checked').forEach((input) => {
    addonsSum += Number(input.closest('.addon-option').dataset.price);
  });
  return BASE_SETUP_FEE + addonsSum;
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

// Раскрытие карточки (видео + описание функции) — отдельное от выбора
// действие: клик по названию/цене раскрывает панель, клик по чекбоксу
// (внутри .addon-option__select) выбирает функцию и не вызывает
// раскрытие. Одновременно раскрыта только одна карточка — открытие новой
// закрывает предыдущую, чтобы список не растягивался бесконечно.
document.querySelectorAll('.addon-option__toggle').forEach((toggle) => {
  toggle.addEventListener('click', () => {
    const option = toggle.closest('.addon-option');
    const panel = document.getElementById(toggle.getAttribute('aria-controls'));
    const willExpand = panel.hidden;

    document.querySelectorAll('.addon-option--expanded').forEach((other) => {
      if (other === option) return;
      other.classList.remove('addon-option--expanded');
      const otherToggle = other.querySelector('.addon-option__toggle');
      const otherPanel = document.getElementById(otherToggle.getAttribute('aria-controls'));
      otherToggle.setAttribute('aria-expanded', 'false');
      otherPanel.hidden = true;
    });

    option.classList.toggle('addon-option--expanded', willExpand);
    toggle.setAttribute('aria-expanded', String(willExpand));
    panel.hidden = !willExpand;
    if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
  });
});

addonsNextBtn.addEventListener('click', () => {
  tap();
  goToScreenByName('payment');
});

// ─── Раздел 4: оплата (заглушка) ─────────────────────────────────────────
// Реального приёма платежей ещё нет — экран честно помечен «скоро»
// (см. .payment-stub в index.html). Сумма пересчитывается из тех же
// допфункций, что и на предыдущем экране, кнопка «Далее» просто ведёт
// дальше по визарду, ничего не списывая.

const paymentTotalEl = document.getElementById('payment-total');
const paymentNextBtn = document.getElementById('payment-next-btn');

function renderPaymentScreen() {
  paymentTotalEl.textContent = formatRub(computeTotal());
}

paymentNextBtn.addEventListener('click', () => {
  tap();
  goToScreenByName('botfather');
});

// ─── Раздел 5: свой бот через BotFather ───────────────────────────────────

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

// ─── Раздел 6: сервер ────────────────────────────────────────────────────

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
    `Купите сервер (VPS) под тариф: ${info.ram} ОЗУ, обязательно Ubuntu 24, локация любая. ` +
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

  // sendData() закрывает Mini App немедленно — это поведение платформы, не
  // баг: после вызова управление возвращается в чат с ботом, и дальнейший
  // прогресс установки идёт уже там (bot.on('message:web_app_data', ...)
  // подхватывает эти же данные и запускает provisionServer()). Раздел
  // «Что произойдёт дальше» в реальном Telegram поэтому не увидят — он
  // остаётся как честный фолбэк для проверки визарда вне Telegram (в
  // обычном браузере), где sendData недоступен.
  if (tg && typeof tg.sendData === 'function') {
    const payload = {
      plan: wizardState.plan,
      addons: [...wizardState.addons],
      botToken: wizardState.botToken,
      server: wizardState.server,
    };
    tg.sendData(JSON.stringify(payload));
  } else {
    goToScreenByName('done');
  }

  // Пароль был нужен только для передачи дальше — не оставляем его в поле
  // формы дольше, чем до перехода/отправки.
  passwordInput.value = '';
});
