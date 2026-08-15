// Экран 1 из визарда — знакомство. Остальные разделы «паспорта» пока не
// построены, поэтому CTA ниже намеренно не никуда не ведёт: он честно
// говорит об этом, а не притворяется рабочим переходом.

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

const startBtn = document.getElementById('start-btn');

startBtn.addEventListener('click', () => {
  if (tg && tg.HapticFeedback) {
    tg.HapticFeedback.impactOccurred('light');
  }

  startBtn.disabled = true;
  startBtn.querySelector('span').textContent = 'СЛЕДУЮЩИЙ РАЗДЕЛ В РАБОТЕ';

  window.setTimeout(() => {
    startBtn.disabled = false;
    startBtn.querySelector('span').textContent = 'НАЧАТЬ НАСТРОЙКУ';
  }, 1800);
});
