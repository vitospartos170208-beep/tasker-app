// Визард PROha, 8 разделов (тариф выбирать больше не нужно — один
// серверный вариант на всех; раздел «РАСХОДЫ» — статичное
// объяснение модели цен перед выбором допфункций; раздел «Выберите ИИ для
// агента» — перед оплатой, чтобы клиент видел, на чём работает агент, до
// суммы; раздел «Оплата» пока заглушка, реальный приём платежей ещё не
// подключён). Последний раздел («Что произойдёт дальше») — честный фолбэк
// на случай, если отправка данных бэкенду не закрывает Mini App сама
// (см. PROVISION_ENDPOINT и обработчик #server-next-btn ниже).

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

// ─── Меню документов — политика ПДн / публичная оферта ───────────────────
// Раньше пробовали встроить пункт в нативное меню Telegram (SettingsButton
// из Web App API) вместо своей кнопки — не прижилось: на Telegram Desktop
// SettingsButton ненадёжен (известный баг клиента, см. tdesktop#29513),
// значок либо не появляется, либо не кликается, и часть пользователей
// вообще не могла открыть документы. Своя кнопка работает предсказуемо
// везде — вернулись к ней насовсем, без ветвления по клиенту.
const appMenuTrigger = document.getElementById('app-menu-trigger');
const appMenuPanel = document.getElementById('app-menu-panel');

function closeAppMenu() {
  appMenuPanel.hidden = true;
  appMenuTrigger.setAttribute('aria-expanded', 'false');
}

function toggleAppMenu() {
  const willOpen = appMenuPanel.hidden;
  appMenuPanel.hidden = !willOpen;
  appMenuTrigger.setAttribute('aria-expanded', String(willOpen));
}

appMenuTrigger.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleAppMenu();
});

// Закрыть при клике вне меню или по Escape — обычное поведение выпадашки.
document.addEventListener('click', (e) => {
  if (!appMenuPanel.hidden && !appMenuPanel.contains(e.target)) closeAppMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAppMenu();
});

// ─── Общее состояние визарда ─────────────────────────────────────────────
// Копится по-настоящему на всех разделах, но реально уходит наружу только
// на последнем шаге (см. PROVISION_ENDPOINT ниже и обработчик
// #server-next-btn) — и только когда бэкенд для приёма этой формы
// действительно развёрнут.
//
// plan зафиксирован на CRAZY — раздел выбора тарифа убран (у продукта
// теперь один серверный вариант, каждый клиент покупает его), но само
// поле в payload осталось: concierge-bot/index.js по-прежнему валидирует
// plan через ['PRO','CRAZY','PREMIUM'].includes(...), значение 'CRAZY'
// для него — обычный валидный тариф, менять бота не пришлось.
const wizardState = {
  plan: 'CRAZY',
  addons: new Set(),
  aiModels: new Set(),
  botToken: null,
  server: { ip: null, port: null, password: null },
};

// ─── Ставки ──────────────────────────────────────────────────────────────
// Модель «всё включено» (экран data-screen="included"): клиент платит
// рублями только нам, отдельных счетов у него нет.
//
// SETUP_FEE — разовая оплата за подключение под ключ.
// MONTHLY_FEE — единственный регулярный платёж; внутри него сервер,
// оплата подписки клиента на ИИ и поддержка. В отличие от прежней модели
// это НАШИ деньги, из которых мы сами платим хостеру и разработчику ИИ,
// поэтому здесь есть себестоимость: при пересмотре цены сначала считать
// её (аренда VPS + фактический тариф подписки), а не менять число тут.
//
// Обе константы продублированы текстом на трёх экранах — «ВСЁ ВКЛЮЧЕНО»,
// «РАСХОДЫ» и «Оплата». Меняете здесь — правьте и разметку, иначе визард
// начнёт показывать разные цифры на соседних экранах.
const SETUP_FEE = 20000;
const MONTHLY_FEE = 10000;

// Ставка едина для всех ИИ-моделей. Раньше здесь была вилка
// 20 000 / 100 000 ₽ (скидка, если выбран только DeepSeek) — она убрана
// вместе с переходом на «всё включено»: разброс цены втрое на экране,
// который клиент видит ДО выбора модели, делал предварительный итог
// бессмысленным. Если понадобится вернуть зависимость от модели —
// восстанавливать здесь, вызов computeSetupFee() менять не придётся.
function computeSetupFee() {
  return SETUP_FEE;
}

const TOKEN_RE = /^\d+:[A-Za-z0-9_-]+$/;
const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const PORT_RE = /^\d{1,5}$/;

// Адрес бэкенда, который должен принять форму (включая root-пароль) HTTPS
// POST'ом напрямую с телефона клиента — минуя Telegram-канал сообщений
// боту целиком. Пока backend не развёрнут (см. PRODUCT.md → Operating
// Context) — намеренно null: обработчик #server-next-btn тогда падает
// обратно на старый sendData()-путь (через сообщение боту), который
// работает уже сейчас с существующим concierge-bot. Как только бэкенд
// поднят на реальном домене — вписать сюда его URL, и форма сама
// переключится на HTTPS-путь без чтения пароля Telegram-каналом сообщений.
//
// Задачи на стороне бэкенда (concierge-bot, не в этом репозитории):
// 1. Принять POST { initData, plan, addons, aiModels, botToken, server }.
// 2. Провалидировать initData — подписанную строку из tg.initData,
//    проверяется HMAC-SHA256 секретом бота (см. Telegram-доки
//    «Validating data received via the Mini App»); отклонить, если подпись
//    не сходится или auth_date старше нескольких минут (replay-защита).
// 3. Вызвать тот же provisionServer(), что и раньше — payload идентичен.
// 4. Вернуть 200 с JSON { ok: true } на успех, иначе код ошибки + текст.
const PROVISION_ENDPOINT = 'https://api.proha.site/provision';

function formatRub(n) {
  return `${n.toLocaleString('ru-RU')} ₽`;
}

// ─── Router между разделами ─────────────────────────────────────────────
// Разделы переключаются через [hidden], а не через отдельные страницы —
// внутри Telegram Mini App это ощущается как один непрерывный документ,
// а не серия перезагрузок. Порядок здесь совпадает с шагами из
// concierge-bot/index.js и PRODUCT.md → Capabilities and Constraints.

const screenOrder = ['intro', 'included', 'pricing', 'addons', 'ai-model', 'payment', 'botfather', 'server', 'done'];
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
  goToScreenByName('included');
});

// ─── Раздел 2: «Всё включено» ────────────────────────────────────────────
// Снимает главное возражение (нужна зарубежная карта для подписки и свой
// сервер) до первой суммы. Статический экран, ничего не считает —
// цифры в разметке, см. SETUP_FEE/MONTHLY_FEE.

document.getElementById('included-next-btn').addEventListener('click', () => {
  tap();
  goToScreenByName('pricing');
});

// ─── Раздел 3: как это оплачивается (объяснение, без сумм визарда) ───────
// Статический экран — ничего не считает и не зависит от выбора допфункций
// на следующем шаге, просто раскладывает ту же модель по полочкам:
// разовая оплата (подключение + допфункции) и один ежемесячный платёж.

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
// оплачивается»), поэтому складываются в одну сумму. Цена аренды сервера
// (см. экран «РАСХОДЫ», статичный текст в index.html) сюда
// по-прежнему не входит — это ежемесячный
// платёж мимо нас (клиент платит хостеру напрямую), к разовой сумме
// отношения не имеет.
function computeTotal() {
  let addonsSum = 0;
  document.querySelectorAll('.addon-option__input:checked').forEach((input) => {
    addonsSum += Number(input.closest('.addon-option').dataset.price);
  });
  return computeSetupFee() + addonsSum;
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
  goToScreenByName('ai-model');
});

// ─── Раздел 4: выбор ИИ-модели(ей) ────────────────────────────────────────
// Мультивыбор (чекбокс, как у допфункций, не radio) — агент можно поставить
// сразу на нескольких моделях; какой пользоваться прямо сейчас, клиент
// переключает позже в самом боте (/settings), без переустановки. Раскрытие
// карточки — тот же паттерн, что у допфункций: клик по названию раскрывает
// панель, клик по чекбоксу выбирает модель, независимо друг от друга.
// Хотя бы одна модель обязательна — кнопка «Далее» заблокирована, пока
// список пуст.

const aiModelNextBtn = document.getElementById('ai-model-next-btn');

document.querySelectorAll('.ai-option__input').forEach((input) => {
  input.addEventListener('change', () => {
    const option = input.closest('.ai-option');
    option.classList.toggle('ai-option--selected', input.checked);
    if (input.checked) {
      wizardState.aiModels.add(input.value);
    } else {
      wizardState.aiModels.delete(input.value);
    }
    aiModelNextBtn.disabled = wizardState.aiModels.size === 0;
    if (tg && tg.HapticFeedback) tg.HapticFeedback.selectionChanged();
  });
});

document.querySelectorAll('.ai-option__toggle').forEach((toggle) => {
  toggle.addEventListener('click', () => {
    const option = toggle.closest('.ai-option');
    const panel = document.getElementById(toggle.getAttribute('aria-controls'));
    const willExpand = panel.hidden;

    document.querySelectorAll('.ai-option--expanded').forEach((other) => {
      if (other === option) return;
      other.classList.remove('ai-option--expanded');
      const otherToggle = other.querySelector('.ai-option__toggle');
      const otherPanel = document.getElementById(otherToggle.getAttribute('aria-controls'));
      otherToggle.setAttribute('aria-expanded', 'false');
      otherPanel.hidden = true;
    });

    option.classList.toggle('ai-option--expanded', willExpand);
    toggle.setAttribute('aria-expanded', String(willExpand));
    panel.hidden = !willExpand;
    if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
  });
});

aiModelNextBtn.addEventListener('click', () => {
  if (aiModelNextBtn.disabled) return;
  tap();
  goToScreenByName('payment');
});

// ─── Раздел 5: оплата (заглушка) ─────────────────────────────────────────
// Реального приёма платежей ещё нет — экран честно помечен «скоро»
// (см. .payment-stub в index.html). Сумма пересчитывается из тех же
// допфункций, что и на предыдущем экране, кнопка «Далее» просто ведёт
// дальше по визарду, ничего не списывая.

const paymentTotalEl = document.getElementById('payment-total');
const paymentMonthlyEl = document.getElementById('payment-monthly');
const paymentNextBtn = document.getElementById('payment-next-btn');

function renderPaymentScreen() {
  // Две строки, а не одна сумма: разовое (подключение + допфункции) и
  // ежемесячное «всё включено». Ежемесячное от выбора допфункций не
  // зависит — оно фиксированное, поэтому просто константа.
  paymentTotalEl.textContent = formatRub(computeTotal());
  paymentMonthlyEl.textContent = formatRub(MONTHLY_FEE);
}

paymentNextBtn.addEventListener('click', () => {
  tap();
  goToScreenByName('botfather');
});

// ─── Раздел 6: свой бот через BotFather ───────────────────────────────────

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

// ─── Раздел 7: сервер ────────────────────────────────────────────────────

const ipInput = document.getElementById('ip-input');
const ipError = document.getElementById('ip-error');
const portInput = document.getElementById('port-input');
const portError = document.getElementById('port-error');
const passwordInput = document.getElementById('password-input');
const pdnConsentInput = document.getElementById('pdn-consent-input');
const serverIntroText = document.getElementById('server-intro-text');
const serverNextBtn = document.getElementById('server-next-btn');
const serverNextBtnLabel = document.getElementById('server-next-btn-label');
const serverSubmitError = document.getElementById('server-submit-error');

// Текст статичен (один серверный вариант на всех, см. wizardState.plan) —
// раньше подставлялся динамически из PLAN_INFO по тарифу, сейчас просто
// захардкожен здесь же, рядом со статичным фолбэком в index.html.
//
// ПРОТИВОРЕЧИЕ, НЕ ЗАКРЫТО НАМЕРЕННО. Строка ниже просит клиента купить
// VPS самому — это прямо противоречит экрану «ВСЁ ВКЛЮЧЕНО», где сервер
// входит в MONTHLY_FEE. Оставлено как есть, потому что это единственный
// рабочий путь провижининга сегодня: concierge-bot → provisionServer()
// заходит по SSH ровно по введённым здесь IP/порту/паролю, и подменить
// текст, не заменив механику, значит сломать установку.
// Чем это станет, зависит от выбранного способа выдачи серверов (API
// хостера против ручного создания) — решение за владельцем продукта.
// До тех пор этот экран нельзя показывать клиенту, купившему «всё
// включено».
function renderServerScreen() {
  serverIntroText.textContent =
    'Купите сервер (VPS): 8 ГБ ОЗУ, обязательно Ubuntu 24, локация любая. ' +
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

  const valid = ipValid && portValid && passwordValid && pdnConsentInput.checked;
  serverNextBtn.disabled = !valid;
  return valid;
}

[ipInput, portInput, passwordInput].forEach((el) => {
  el.addEventListener('input', validateServerForm);
});
pdnConsentInput.addEventListener('change', validateServerForm);

// Через HTTPS напрямую на PROVISION_ENDPOINT (когда он задан) — initData
// уходит вместе с формой, чтобы бэкенд мог проверить подпись Telegram
// перед тем как довериться содержимому. Бросает при сетевой ошибке или
// не-2xx ответе — вызывающий код решает, что показать пользователю.
async function submitProvisionRequest(payload) {
  const res = await fetch(PROVISION_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: tg.initData, ...payload }),
  });
  if (!res.ok) {
    throw new Error(`Провижининг-эндпоинт ответил ${res.status}`);
  }
}

serverNextBtn.addEventListener('click', async () => {
  if (!validateServerForm()) return;
  wizardState.server = {
    ip: ipInput.value.trim(),
    port: Number(portInput.value.trim() || 22),
    password: passwordInput.value,
  };
  tap();

  const payload = {
    plan: wizardState.plan,
    addons: [...wizardState.addons],
    aiModels: [...wizardState.aiModels],
    botToken: wizardState.botToken,
    server: wizardState.server,
    pdnConsent: pdnConsentInput.checked,
  };

  // Пароль не должен переживать саму отправку дольше необходимого — стираем
  // из поля формы сразу после того, как скопировали его в payload выше,
  // не дожидаясь исхода запроса.
  passwordInput.value = '';

  if (tg && PROVISION_ENDPOINT) {
    // HTTPS-путь: пароль идёт напрямую бэкенду, минуя канал сообщений
    // Telegram-боту целиком (см. комментарий у PROVISION_ENDPOINT выше).
    serverSubmitError.hidden = true;
    serverNextBtn.disabled = true;
    serverNextBtnLabel.textContent = 'ОТПРАВЛЯЕМ…';
    try {
      await submitProvisionRequest(payload);
      if (typeof tg.close === 'function') {
        tg.close();
      } else {
        goToScreenByName('done');
      }
    } catch (err) {
      serverSubmitError.hidden = false;
      serverNextBtn.disabled = false;
      serverNextBtnLabel.textContent = 'НАЧАТЬ УСТАНОВКУ';
    }
    return;
  }

  // Фолбэк, пока PROVISION_ENDPOINT не задан (бэкенд ещё не развёрнут) —
  // старый путь через sendData(). Закрывает Mini App немедленно — это
  // поведение платформы, не баг: управление возвращается в чат с ботом, и
  // дальнейший прогресс установки идёт уже там (bot.on('message:web_app_data',
  // ...) в concierge-bot/index.js подхватывает эти же данные и запускает
  // provisionServer()). Проверено на стороне бота: кнопка визарда — reply-
  // клавиатура с web_app (KeyboardButton), не menu-button, так что sendData()
  // доставляется гарантированно (см. комментарий над wizardKeyboard() в
  // concierge-bot/index.js). Пароль при этом идёт через сообщение боту —
  // concierge-bot удаляет его сразу после чтения (см. web_app_data-обработчик
  // там же), но полностью убрать его из канала сообщений может только
  // переход на PROVISION_ENDPOINT.
  if (tg && typeof tg.sendData === 'function') {
    tg.sendData(JSON.stringify(payload));
  } else {
    // Вне Telegram (обычный браузер, sendData и initData недоступны) —
    // честный фолбэк для проверки визарда, ничего никуда не уходит.
    goToScreenByName('done');
  }
});
