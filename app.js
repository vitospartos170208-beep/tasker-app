// Визард PROha, 8 разделов (тариф выбирать больше не нужно — один
// серверный вариант на всех; раздел «РАСХОДЫ» — статичное
// объяснение модели цен перед списком функций; раздел «Выберите ИИ для
// агента» — перед оплатой, чтобы клиент видел, на чём работает агент, до
// суммы; раздел «Оплата» — промежуточный экран с итоговой суммой, сама
// оплата (Продамус) подключена на бэкенде и происходит позже: ссылку
// присылает бот в чат уже после того, как анкета отправлена целиком —
// см. renderPaymentScreen() ниже и handleProdamusWebhook в
// concierge-bot/index.js). Последний раздел («Что произойдёт дальше») —
// честный фолбэк на случай, если отправка данных бэкенду не закрывает
// Mini App сама (см. PROVISION_ENDPOINT и обработчик #server-next-btn ниже).

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
//
// Кнопок в разметке девять — по одной внутри бренд-марки каждого экрана
// (сразу справа от слова «PROha», не отдельным плавающим слоем), но
// видна всегда только одна: остальные восемь сидят в [hidden]-секциях.
// Панель документов при этом одна общая на всех — id, не класс.
const appMenuTriggers = document.querySelectorAll('.app-menu-trigger');
const appMenuPanel = document.getElementById('app-menu-panel');

function closeAppMenu() {
  appMenuPanel.hidden = true;
  appMenuTriggers.forEach((btn) => btn.setAttribute('aria-expanded', 'false'));
}

function toggleAppMenu() {
  const willOpen = appMenuPanel.hidden;
  appMenuPanel.hidden = !willOpen;
  appMenuTriggers.forEach((btn) => btn.setAttribute('aria-expanded', String(willOpen)));
}

appMenuTriggers.forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleAppMenu();
  });
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
  // Заполняются кнопкой "Оплатить" на экране "Оплата" (см. paymentPayBtn
  // ниже) — orderId уходит в финальную анкету (#server-next-btn), чтобы
  // бэкенд знал, к какому уже созданному заказу её прикрепить. paymentUrl
  // хранится, чтобы повторный клик на "Оплатить" просто открывал ту же
  // ссылку, а не плодил новый заказ на каждое нажатие.
  orderId: null,
  paymentUrl: null,
  // Какой заказ сейчас висит: 'base' — обычное подключение, 'assistant' —
  // с живым помощником (база + наценка одним платежом). Переключение
  // кнопки на экране «Оплата» пересоздаёт заказ, как и смена набора ИИ.
  orderKind: null,
  // Оплачено ли сопровождение помощником (через кнопку на «Оплате» или
  // доплатой на экранах инструкции). Гейтит апселл-блок на botfather/server.
  assistant: false,
  // Подтверждена ли оплата. Ставится ТОЛЬКО по ответу бэкенда на
  // /order-status — то есть по order.paid, который в свою очередь ставит
  // только вебхук Продамуса со сошедшейся HMAC-подписью. Визард ничего не
  // решает сам: он показывает то же, от чего зависит запуск установки.
  // Здесь это чисто отображение — установку гейтит бэкенд, и подделка
  // этого флага в браузере ничего не даёт.
  paid: false,
};

// ─── Ставки ──────────────────────────────────────────────────────────────
// Экран «ВСЁ ВКЛЮЧЕНО» и модель «клиент платит только нам, сервер и
// подписка внутри ежемесячного платежа» — убраны по прямому решению
// владельца продукта (сервер/подписка снова расходы клиента напрямую
// хостеру/разработчику ИИ, не через нас — см. renderServerScreen ниже и
// PRODUCT.md: «each customer runs on their own VPS with their own Claude
// subscription»; «всё включено» этому прямо противоречило).
//
// SETUP_FEE — разовая оплата за подключение под ключ, включает и
// поддержку (отдельно её больше докупить нельзя и не нужно — раньше
// такая возможность была, теперь целиком внутри этой суммы).
// KIMI_ONLY_SETUP_FEE — скидка для тех, кто ставит агента только на
// Kimi: его подписка для клиента ощутимо дешевле Claude/ChatGPT, и
// разница отражена уже на этапе подключения, а не только в ежемесячных
// расходах клиента (см. текст на экране «РАСХОДЫ»).
// MONTHLY_DISPLAY — не наш платёж и не число, которое где-то считается:
// сервер (VPS) клиент покупает и оплачивает сам напрямую хостеру
// (см. renderServerScreen), подписку на ИИ — сам себе у разработчика
// модели. Строка только объясняет это на экранах «РАСХОДЫ» и «Оплата».
//
// Суммы продублированы текстом на экранах «РАСХОДЫ» и «Оплата» — меняете
// здесь, правьте и разметку, иначе визард покажет разные цифры рядом.
const SETUP_FEE = 30000;
const KIMI_ONLY_SETUP_FEE = 10000;
const MONTHLY_DISPLAY = '≈400 ₽/мес + подписка(и) на ИИ';

// Скидка применяется, только если Kimi — вообще единственная выбранная
// модель: смешанный выбор (Kimi + что-то ещё) всё равно ставит и
// более дорогую модель тоже, и её реальная стоимость подписки никуда не
// девается — скидывать цену подключения в этом случае неверно.
//
// На экране «Функции Ассистента» модель ещё не выбрана (тот экран раньше
// в screenOrder, чем «ai-model»), поэтому сумму там больше и не
// показываем — она считается на экране «Оплата», когда выбор уже сделан
// (см. renderPaymentScreen).
function computeSetupFee() {
  const onlyKimi = wizardState.aiModels.size === 1 && wizardState.aiModels.has('kimi');
  return onlyKimi ? KIMI_ONLY_SETUP_FEE : SETUP_FEE;
}

// Наценка за подключение с живым помощником — человек проводит клиента по
// шагам (BotFather, покупка сервера). Автоустановка при этом не меняется,
// это доплата за сопровождение. Держать в паре с ASSISTANT_SURCHARGE* в
// concierge-bot/index.js — сумму к оплате всё равно считает бэкенд, тут
// число нужно только для подписи на кнопке.
const ASSISTANT_SURCHARGE = 20000;
const ASSISTANT_SURCHARGE_KIMI = 5000;
function computeAssistantSurcharge() {
  const onlyKimi = wizardState.aiModels.size === 1 && wizardState.aiModels.has('kimi');
  return onlyKimi ? ASSISTANT_SURCHARGE_KIMI : ASSISTANT_SURCHARGE;
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

// Создаёт заказ + ссылку на оплату (кнопка "Оплатить" на экране "Оплата",
// см. paymentPayBtn ниже) — тот же бэкенд, соседний путь. Принимает
// { initData, addons }, отдаёт { ok, orderId, paymentUrl, amount }.
const CREATE_PAYMENT_ENDPOINT = 'https://api.proha.site/create-payment';

// Статус оплаты по уже созданному заказу. Спросить Продамус напрямую отсюда
// нельзя: для его API нужен секретный ключ, а всё, что попадает в Mini App,
// доступно клиенту. Поэтому спрашиваем свой бэкенд — он отдаёт order.paid,
// тот самый флаг, по которому запускается установка. Принимает
// { initData, orderId }, отдаёт { ok, found, paid, amount }.
const ORDER_STATUS_ENDPOINT = 'https://api.proha.site/order-status';

// Опрос статуса: раз в 4 секунды, но не дольше 15 минут — платёж, который
// не подтвердился за это время, скорее всего не состоялся, и крутить опрос
// бесконечно незачем. Лимит на бэкенде 60 запросов в минуту на IP (отдельный
// от общего, см. RATE_LIMIT_MAX_STATUS в concierge-bot/index.js), так что
// 15 опросов в минуту оставляют запас и не мешают отправке анкеты.
const PAYMENT_POLL_MS = 4000;
const PAYMENT_POLL_MAX_MS = 15 * 60 * 1000;

function formatRub(n) {
  return `${n.toLocaleString('ru-RU')} ₽`;
}

// ─── Router между разделами ─────────────────────────────────────────────
// Разделы переключаются через [hidden], а не через отдельные страницы —
// внутри Telegram Mini App это ощущается как один непрерывный документ,
// а не серия перезагрузок. Порядок здесь совпадает с шагами из
// concierge-bot/index.js и PRODUCT.md → Capabilities and Constraints.

const screenOrder = ['intro', 'risks', 'pricing', 'addons', 'ai-model', 'payment', 'botfather', 'server', 'done'];
let currentIndex = 0;

// Некоторые разделы зависят от состояния, накопленного раньше (тариф из
// раздела 2), поэтому перерисовываются заново при каждом входе — не только
// при первой сборке DOM.
const onEnter = {
  payment: renderPaymentScreen,
  botfather: () => renderAssistantUpsell('botfather'),
  server: () => {
    renderServerScreen();
    renderAssistantUpsell('server');
  },
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
  goToScreenByName('risks');
});

// ─── Раздел 1.5: риски (утечка данных со своего сервера, блокировки ИИ
// в РФ) — до РАСХОДОВ намеренно: решение о рисках принимается раньше, чем
// человек увидит сумму и психологически "уже вложился". Кнопка заблокирована
// до чекбокса — тот же принцип, что и pdn-consent-input на экране "server":
// явное подтверждение, а не текст, который можно проскроллить не читая.
const risksConsentInput = document.getElementById('risks-consent-input');
const risksNextBtn = document.getElementById('risks-next-btn');

risksConsentInput.addEventListener('change', () => {
  risksNextBtn.disabled = !risksConsentInput.checked;
});

risksNextBtn.addEventListener('click', () => {
  if (risksNextBtn.disabled) return;
  tap();
  goToScreenByName('pricing');
});

// ─── Раздел 2: как это оплачивается (объяснение, без сумм визарда) ───────
// Статический экран — ничего не считает, просто раскладывает модель по
// полочкам: одна разовая оплата за подключение (библиотеки навыков в неё
// входят) и один ежемесячный платёж мимо нас.

document.getElementById('pricing-next-btn').addEventListener('click', () => {
  tap();
  goToScreenByName('addons');
});

// ─── Раздел 3: функции Ассистента ────────────────────────────────────────
// Функции больше не продаются поштучно. Всё, что есть в списке, входит в
// разовую оплату подключения и ставится всем сразу — выбирать нечего,
// экран стал информационным: карточки только раскрываются (описание и
// видео), цен и чекбоксов на нём нет, итоговая сумма показывается на
// экране «Оплата», когда уже известна выбранная ИИ-модель.

const addonsNextBtn = document.getElementById('addons-next-btn');

// Набор для install.sh собирается прямо из разметки: data-addon у каждой
// .addon-option — тот же ключ, что в ADDON_NAMES бэкенда. Заполняем сразу
// при загрузке, а не по входу на экран: клиент может проскочить дальше
// быстрее, чем сработает рендер, а в /create-payment и в анкету набор
// обязан уйти полным. Бэкенд всё равно подставляет полный список сам
// (см. handleProvision в concierge-bot) — это страховка от закэшированного
// Mini App, а не единственный источник правды.
document.querySelectorAll('.addon-option').forEach((option) => {
  wizardState.addons.add(option.dataset.addon);
});

// Разовая оплата — это только подключение под ключ: библиотеки навыков
// входят в него и своей цены больше не имеют. Аренда сервера (см. экран
// «РАСХОДЫ», статичный текст в index.html) сюда по-прежнему не входит —
// это ежемесячный платёж мимо нас, клиент платит хостеру напрямую.
function computeTotal() {
  return computeSetupFee();
}

// Раскрытие карточки (видео + описание функции): одновременно раскрыта
// только одна — открытие новой закрывает предыдущую, чтобы список не
// растягивался бесконечно.
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
// Мультивыбор (чекбокс, не radio) — агент можно поставить сразу на
// нескольких моделях; какой пользоваться прямо сейчас, клиент переключает
// позже в самом боте (/settings), без переустановки. Раскрытие карточки —
// тот же паттерн, что в списке функций: клик по названию раскрывает
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
    // От набора моделей зависит цена подключения (скидка, когда выбран
    // только Kimi — см. computeSetupFee), и это теперь единственное,
    // что на неё влияет. Значит уже созданный заказ посчитан по старому
    // набору и дальше не годится. Без этого сброса визард показывал бы
    // «оплата подтверждена» для набора, за который заплачено не было, а
    // бэкенд отклонил бы анкету с ai_models_changed в самом конце — то есть
    // человек упёрся бы в тупик, уже введя доступы к серверу.
    wizardState.orderId = null;
    wizardState.paymentUrl = null;
    wizardState.paid = false;
    wizardState.orderKind = null;
    wizardState.assistant = false;
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

// ─── Раздел 5: оплата ──────────────────────────────────────────────────
// Кнопка «Оплатить» реально создаёт заказ (POST /create-payment) и
// открывает ссылку Продамуса — сумма уже известна по ИИ-модели,
// выбранной на предыдущем экране, ждать конца анкеты не нужно. «Далее»
// рядом ведёт дальше по визарду независимо от того, нажали «Оплатить»
// или нет — бот-токен и данные сервера можно вводить и до оплаты, и
// после, оба порядка поддержаны бэкендом (см. handleCreatePayment /
// handleProdamusWebhook в concierge-bot/index.js: какое событие пришло
// вторым — отправленная анкета или подтверждение оплаты — то и
// запускает установку).

const paymentTotalEl = document.getElementById('payment-total');
const paymentMonthlyEl = document.getElementById('payment-monthly');
const paymentNextBtn = document.getElementById('payment-next-btn');
const paymentNextBtnLabel = document.getElementById('payment-next-btn-label');
const paymentPayBtn = document.getElementById('payment-pay-btn');
const paymentPayBtnLabel = document.getElementById('payment-pay-btn-label');
const paymentAssistantBtn = document.getElementById('payment-assistant-btn');
const paymentAssistantBtnLabel = document.getElementById('payment-assistant-btn-label');
const paymentPayError = document.getElementById('payment-pay-error');
const paymentStatusEl = document.getElementById('payment-status');

// ─── Живой статус оплаты ───────────────────────────────────────────────
// Раньше экран «Оплата» ничего не знал про исход платежа: человек мог уйти
// платить, вернуться, пройти визард до конца, ввести токен бота, IP и
// root-пароль — и только по кнопке «НАЧАТЬ УСТАНОВКУ» узнать, что оплата
// не прошла. Установку это не отдавало (бэкенд её и так не запускал), но
// выглядело как обход оплаты и заставляло вводить доступы впустую.
//
// Теперь визард спрашивает бэкенд о состоянии заказа и честно показывает
// одно из трёх: оплата не начата / ждём подтверждения / подтверждена.
//
// Гейт ЖЁСТКИЙ: без подтверждённой оплаты кнопка «Далее» заблокирована.
// Смысл не в защите денег — установку и так гейтит бэкенд, и подделка
// флага в браузере ничего не даст. Смысл в том, чтобы никто не вводил
// токен бота, IP и root-пароль от своего сервера, не зная, что платёж не
// прошёл. Доступы к чужой машине — не та вещь, которую стоит просить
// заранее и впустую.
//
// Исключение — открытие вне Telegram: там нет initData, оплатить нечем и
// установить тоже нечего (бэкенд отвергнет анкету без подписи), а визард
// должен оставаться проходимым в обычном браузере для проверки вёрстки.

let paymentPollTimer = null;
let paymentPollStartedAt = 0;
let paymentPollGaveUp = false;

// Внутри Telegram? Только там возможны и оплата, и установка.
function isInTelegram() {
  return Boolean(tg && tg.initData);
}

// Пускать ли дальше с экрана «Оплата».
function canPassPayment() {
  return wizardState.paid || !isInTelegram();
}

function stopPaymentPolling() {
  if (paymentPollTimer !== null) {
    clearInterval(paymentPollTimer);
    paymentPollTimer = null;
  }
}

function renderPaymentStatus() {
  // Кнопка «Далее» и текст статуса всегда описывают одно и то же состояние —
  // поэтому обновляются вместе, из одного места, а не двумя независимыми
  // ветками, которые однажды разойдутся.
  paymentNextBtn.disabled = !canPassPayment();
  paymentNextBtnLabel.textContent = canPassPayment() ? 'ДАЛЕЕ' : 'СНАЧАЛА ОПЛАТА';

  if (!paymentStatusEl) return;
  paymentStatusEl.hidden = false;
  paymentStatusEl.classList.toggle('payment-status--paid', wizardState.paid);

  if (wizardState.paid) {
    paymentStatusEl.textContent = 'Оплата подтверждена ✓ Можно продолжать.';
  } else if (!isInTelegram()) {
    paymentStatusEl.textContent =
      'Открыто вне Telegram — оплата и установка здесь недоступны, визард работает в режиме просмотра.';
  } else if (paymentPollGaveUp) {
    paymentStatusEl.textContent =
      'Подтверждение не пришло за 15 минут. Если вы платили — вернитесь на этот экран, проверка запустится снова.';
  } else if (wizardState.orderId) {
    paymentStatusEl.textContent =
      'Ждём подтверждения оплаты. Обычно приходит за минуту после платежа — кнопка «Далее» разблокируется сама.';
  } else {
    paymentStatusEl.textContent =
      'Оплата ещё не начата. Нажмите «Оплатить» — без подтверждённого платежа дальше не пройти.';
  }
}

async function checkPaymentOnce() {
  if (wizardState.paid || !wizardState.orderId || !tg || !tg.initData) return;
  try {
    const res = await fetch(ORDER_STATUS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: tg.initData, orderId: wizardState.orderId }),
    });
    const data = await res.json().catch(() => null);
    // found: false — заказа нет: либо он уже отработан и удалён (оплата
    // пришла, анкета была на месте, установка пошла), либо протух.
    // Подтверждением оплаты это НЕ считаем, признак только один — paid.
    if (data && data.ok && data.found && data.paid) {
      wizardState.paid = true;
      stopPaymentPolling();
      renderPaymentStatus();
      if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    }
  } catch {
    // Связь моргнула — молча ждём следующей попытки. Показывать ошибку на
    // каждый неудачный опрос значило бы мигать тревогой на ровном месте.
  }
}

function startPaymentPolling() {
  stopPaymentPolling();
  if (wizardState.paid || !wizardState.orderId) return;
  // Возврат на экран или в приложение — повод дать проверке новый шанс,
  // даже если прошлая сдалась по таймауту. Иначе человек, у которого банк
  // тянул с подтверждением дольше пятнадцати минут, остался бы с
  // заблокированной кнопкой и без способа что-либо предпринять.
  paymentPollGaveUp = false;
  paymentPollStartedAt = Date.now();
  checkPaymentOnce();
  paymentPollTimer = setInterval(() => {
    if (Date.now() - paymentPollStartedAt > PAYMENT_POLL_MAX_MS) {
      stopPaymentPolling();
      paymentPollGaveUp = true;
      renderPaymentStatus();
      return;
    }
    checkPaymentOnce();
  }, PAYMENT_POLL_MS);
}

// Оплата происходит во внешнем окне: tg.openLink уводит человека из Mini
// App, и пока тот в фоне, браузер душит таймеры. Поэтому на возвращении
// спрашиваем статус сразу, не дожидаясь следующего тика — обычно именно в
// этот момент оплата уже и прошла.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (wizardState.paid || !wizardState.orderId) return;
  checkPaymentOnce();
  if (paymentPollTimer === null) startPaymentPolling();
});

function openExternal(url) {
  if (tg && typeof tg.openLink === 'function') {
    tg.openLink(url);
  } else {
    window.open(url, '_blank');
  }
}

function renderPaymentScreen() {
  // Две строки: разовое (подключение под ключ, реально взимается через
  // Продамус, см. startPayment ниже) и ежемесячное —
  // не платёж нам, просто напоминание о двух чужих счетах (VPS-хостер,
  // разработчик ИИ), поэтому текстовая константа, а не formatRub(число).
  const base = computeTotal();
  const withAssistant = base + computeAssistantSurcharge();
  paymentTotalEl.textContent = formatRub(wizardState.orderKind === 'assistant' ? withAssistant : base);
  paymentMonthlyEl.textContent = MONTHLY_DISPLAY;

  paymentPayError.hidden = true;
  paymentPayBtn.disabled = false;
  paymentAssistantBtn.disabled = false;

  // Обе кнопки создают заказ. Клик по той, что уже висит незакрытой
  // ссылкой, просто открывает её снова; клик по другой пересоздаёт заказ
  // на нужную сумму (см. startPayment). После оплаты — обе «Оплачено».
  if (wizardState.paid) {
    paymentPayBtnLabel.textContent = 'Оплачено';
    paymentAssistantBtnLabel.textContent = 'Оплачено';
    paymentPayBtn.disabled = true;
    paymentAssistantBtn.disabled = true;
  } else {
    const linkOpen = 'Открыть ссылку на оплату';
    paymentPayBtnLabel.textContent =
      wizardState.paymentUrl && wizardState.orderKind === 'base' ? linkOpen : `Оплатить ${formatRub(base)}`;
    paymentAssistantBtnLabel.textContent =
      wizardState.paymentUrl && wizardState.orderKind === 'assistant'
        ? linkOpen
        : `С помощником — ${formatRub(withAssistant)}`;
  }

  renderPaymentStatus();
  startPaymentPolling();
}

// Общий путь для обеих кнопок оплаты и для доплаты за помощника на экранах
// инструкции. kind: 'base' | 'assistant'. topUpForOrder задаётся только для
// доплаты уже оплатившим базу — тогда заказ на одну наценку.
async function startPayment({ kind, topUpForOrder = null, onError }) {
  const isAssistant = kind === 'assistant';

  // Ссылка на ровно такой же заказ уже есть — просто открыть её снова.
  if (!topUpForOrder && wizardState.paymentUrl && wizardState.orderKind === kind) {
    openExternal(wizardState.paymentUrl);
    return true;
  }

  if (!tg || !tg.initData) {
    onError('Оплата доступна только внутри Telegram.');
    return false;
  }

  try {
    const body = {
      initData: tg.initData,
      addons: [...wizardState.addons],
      aiModels: [...wizardState.aiModels],
    };
    if (isAssistant) body.assistant = true;
    if (topUpForOrder) body.topUpForOrder = topUpForOrder;

    const res = await fetch(CREATE_PAYMENT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Сумму бэкенд считает сам — присланная отсюда его не интересует.
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.ok || !data.paymentUrl) {
      throw new Error(data && data.error ? data.error : `payment endpoint ${res.status}`);
    }

    if (topUpForOrder) {
      // Доплата: базовый заказ и его опрос не трогаем — открываем ссылку и
      // всё. Подтверждение приходит человеком в чат, не через визард.
      openExternal(data.paymentUrl);
      return true;
    }

    // Новый основной заказ — заменяет прежний (другая сумма/тип).
    wizardState.orderId = data.orderId;
    wizardState.paymentUrl = data.paymentUrl;
    wizardState.orderKind = kind;
    wizardState.assistant = isAssistant;
    openExternal(data.paymentUrl);
    renderPaymentStatus();
    startPaymentPolling();
    return true;
  } catch (err) {
    onError('Не удалось создать ссылку на оплату — проверьте связь и попробуйте ещё раз.');
    return false;
  }
}

paymentPayBtn.addEventListener('click', async () => {
  tap();
  paymentPayError.hidden = true;
  paymentPayBtn.disabled = true;
  paymentPayBtnLabel.textContent = 'Готовим ссылку…';
  await startPayment({
    kind: 'base',
    onError: (msg) => {
      paymentPayError.hidden = false;
      paymentPayError.textContent = msg;
    },
  });
  renderPaymentScreen();
});

paymentAssistantBtn.addEventListener('click', async () => {
  tap();
  paymentPayError.hidden = true;
  paymentAssistantBtn.disabled = true;
  paymentAssistantBtnLabel.textContent = 'Готовим ссылку…';
  await startPayment({
    kind: 'assistant',
    onError: (msg) => {
      paymentPayError.hidden = false;
      paymentPayError.textContent = msg;
    },
  });
  renderPaymentScreen();
});

// ─── Апселл «с персональным помощником» на экранах инструкции ──────────
// Виден только тому, кто оплатил базовую цену и не брал помощника (см.
// renderAssistantUpsell). Кнопка создаёт заказ на ОДНУ наценку
// (topUpForOrder) — подтверждение приходит человеком в чат, визард его
// не ждёт и по нему ничего не гейтит.
function setupAssistantUpsell(screen) {
  const box = document.getElementById(`assistant-upsell-${screen}`);
  if (!box) return;
  const btn = document.getElementById(`assistant-upsell-btn-${screen}`);
  const label = document.getElementById(`assistant-upsell-btn-${screen}-label`);
  const note = document.getElementById(`assistant-upsell-note-${screen}`);

  box._reset = () => {
    btn.disabled = false;
    label.textContent = `Подключить с помощником — доплатить ${formatRub(computeAssistantSurcharge())}`;
    note.hidden = true;
  };

  btn.addEventListener('click', async () => {
    tap();
    note.hidden = true;
    btn.disabled = true;
    label.textContent = 'Готовим ссылку…';
    const ok = await startPayment({
      kind: 'assistant',
      topUpForOrder: wizardState.orderId || 'unknown',
      onError: (msg) => {
        note.hidden = false;
        note.textContent = msg;
        btn.disabled = false;
        label.textContent = `Подключить с помощником — доплатить ${formatRub(computeAssistantSurcharge())}`;
      },
    });
    if (ok) {
      // Клиент отправлен на оплату наценки. Подтверждение визард не ждёт
      // (его принесёт человек в чат), но повторно предлагать доплату на
      // следующем экране инструкции уже не нужно.
      wizardState.assistant = true;
      label.textContent = 'Ссылка на оплату открыта';
      note.hidden = false;
      note.textContent = 'После оплаты помощник напишет вам в чат и проведёт по шагам подключения.';
    }
  });
}
['botfather', 'server'].forEach(setupAssistantUpsell);

function renderAssistantUpsell(screen) {
  const box = document.getElementById(`assistant-upsell-${screen}`);
  if (!box) return;
  const show = wizardState.paid && !wizardState.assistant;
  box.hidden = !show;
  if (show && typeof box._reset === 'function') box._reset();
}

paymentNextBtn.addEventListener('click', () => {
  // Кнопка и так заблокирована без оплаты (см. renderPaymentStatus), но
  // проверку дублируем: disabled снимается одной строкой в консоли, а
  // дальше по визарду идёт ввод root-пароля от чужого сервера.
  if (!canPassPayment()) return;
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
// Раньше это прямо противоречило экрану «ВСЁ ВКЛЮЧЕНО» (там сервер был
// внутри MONTHLY_FEE, здесь клиента просят купить VPS самому) — экран
// убран по решению владельца продукта именно из-за таких противоречий с
// тем, как provisionServer() в concierge-bot реально работает (заходит
// по SSH на сервер клиента ровно по введённым здесь IP/порту/паролю).
// Теперь во всём визарде одна история: клиент покупает VPS сам, см.
// MONTHLY_DISPLAY и текст экрана «РАСХОДЫ».
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
    // .code — код ошибки бэкенда (см. no_payment_order ниже), не просто
    // текст для лога: по нему решаем, какое сообщение показать человеку.
    const data = await res.json().catch(() => null);
    const err = new Error(`Провижининг-эндпоинт ответил ${res.status}`);
    err.code = data && data.error;
    throw err;
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
    // Заказ, созданный кнопкой «Оплатить» на экране «Оплата» — без него
    // бэкенд отклонит анкету (see no_payment_order ниже): оплата теперь
    // обязательна и создаётся раньше, отдельным действием, а не тут.
    orderId: wizardState.orderId,
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
      // bad_init_data — отдельная причина от сетевой: подпись Telegram
      // протухла (см. verifyInitData в concierge-bot/index.js), обычно
      // потому что визард держали открытым долго (например, ходили за
      // токеном к @BotFather). «Проверьте связь» тут вводит в заблуждение
      // — помогает только новое открытие Mini App, не повтор той же кнопки.
      if (err.code === 'no_payment_order') {
        serverSubmitError.textContent = 'Сначала оплатите — вернитесь на экран «Оплата» и нажмите «Оплатить».';
      } else if (err.code === 'ai_models_changed') {
        // Выбор ИИ-модели поменяли уже после оплаты, а от него зависит цена
        // подключения (см. computeSetupFee). Ставить не то, что оплачено, —
        // неправильно, поэтому просим вернуться и оплатить новый набор.
        serverSubmitError.textContent =
          'Выбор ИИ-модели изменился после оплаты, а от него зависит цена подключения. Вернитесь на экран «Оплата» и оплатите новый выбор.';
      } else if (err.code === 'bad_init_data') {
        serverSubmitError.textContent = 'Сессия устарела — закройте это окно и откройте установку заново из бота.';
      } else {
        serverSubmitError.textContent = 'Не получилось отправить данные — проверьте связь и попробуйте ещё раз.';
      }
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
