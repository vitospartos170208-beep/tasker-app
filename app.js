// Визард «Паспорт изделия». Экраны 1–2 из 6 построены (знакомство, тариф);
// разделы 3–6 (допы, BotFather, сервер, установка) ещё не существуют —
// поэтому их CTA-кнопки честно сообщают об этом, а не притворяются рабочим
// переходом (см. PRODUCT.md → Product Principles → Placeholder-honest).

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

// ─── Router между разделами ─────────────────────────────────────────────
// Разделы переключаются через [hidden], а не через отдельные страницы —
// внутри Telegram Mini App это ощущается как один непрерывный документ,
// а не серия перезагрузок. Порядок здесь совпадает с шагами из
// concierge-bot/index.js и PRODUCT.md → Capabilities and Constraints.

const screenOrder = ['intro', 'plan'];
let currentIndex = 0;

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((el) => {
    el.hidden = el.dataset.screen !== name;
  });
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

if (tg && tg.BackButton) {
  tg.BackButton.onClick(() => {
    if (currentIndex > 0) {
      goToScreen(currentIndex - 1);
    }
  });
}

// Временная заглушка для CTA раздела, за которым пока ничего не построено —
// честно гаснет обратно вместо притворного перехода в никуда.
function flashComingSoon(button) {
  const label = button.querySelector('span');
  const original = label.textContent;
  button.disabled = true;
  label.textContent = 'СЛЕДУЮЩИЙ РАЗДЕЛ В РАБОТЕ';
  window.setTimeout(() => {
    label.textContent = original;
    button.disabled = false;
  }, 1800);
}

// ─── Раздел 1: знакомство ────────────────────────────────────────────────

const startBtn = document.getElementById('start-btn');

startBtn.addEventListener('click', () => {
  if (tg && tg.HapticFeedback) {
    tg.HapticFeedback.impactOccurred('light');
  }
  goToScreen(screenOrder.indexOf('plan'));
});

// ─── Раздел 2: тариф ─────────────────────────────────────────────────────
// Копия и цены зеркалят concierge-bot/index.js (PLANS.PRO / PLANS.CRAZY) —
// это не новая цена, это тот же тариф, показанный формой вместо чата.

const planInputs = document.querySelectorAll('input[name="plan"]');
const planNextBtn = document.getElementById('plan-next-btn');

planInputs.forEach((input) => {
  input.addEventListener('change', () => {
    document.querySelectorAll('.plan-option').forEach((option) => {
      const checked = option.querySelector('input').checked;
      option.classList.toggle('plan-option--selected', checked);
    });
    planNextBtn.disabled = false;
    if (tg && tg.HapticFeedback) {
      tg.HapticFeedback.selectionChanged();
    }
  });
});

planNextBtn.addEventListener('click', () => {
  if (planNextBtn.disabled) return;
  if (tg && tg.HapticFeedback) {
    tg.HapticFeedback.impactOccurred('light');
  }
  flashComingSoon(planNextBtn);
});
