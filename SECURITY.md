# Безопасность PROha — что сделано и что осталось кликнуть

Файл появился после разбора внешнего аудита от 22.08.2026. Здесь только
проверяемые вещи: что уже в репозитории, что нужно включить руками (кода не
требует) и почему некоторые «очевидные» рекомендации применять НЕЛЬЗЯ.

## Сделано в репозитории

- `Content-Security-Policy` и `Referrer-Policy` через `<meta>` в `index.html`,
  `offer.html`, `privacy.html`. На GitHub Pages это единственный доступный
  способ: Pages не даёт настраивать HTTP-заголовки.
- `robots.txt`, `sitemap.xml`, `.well-known/security.txt` (+ копия в корне).
- `.nojekyll` — без него Pages скрывает каталоги, начинающиеся с точки, и
  `.well-known/security.txt` отдавался бы 404.
- Формулировки про пароль в визарде, оферте и политике приведены в
  соответствие с фактической схемой (см. «Про пароль» ниже).

## Осталось включить руками

Порядок важен: HTTPS в GitHub включается ДО проксирования через Cloudflare.

### 1. GitHub → Enforce HTTPS (5 минут)

Settings → Pages → галочка **Enforce HTTPS**.

Сейчас `http://app.proha.site` отдаёт `200 OK` без редиректа — это главная
реальная претензия аудита по транспорту, и она закрывается одним чекбоксом.

### 2. Cloudflare → проксирование app.proha.site (10 минут)

Сейчас запись `app` стоит серым облаком: в ответе видно `Server: GitHub.com`
и Fastly, то есть трафик идёт мимо Cloudflare, и добавить заголовки некуда.

1. DNS → запись `app` → включить оранжевое облако.
2. SSL/TLS → режим **Full** (или Full strict). Режим Flexible даст петлю
   редиректов вместе с включённым на шаге 1 Enforce HTTPS.
3. SSL/TLS → Edge Certificates → **Always Use HTTPS: On**.

### 3. Cloudflare → Transform Rule с заголовками (15 минут)

Rules → Transform Rules → **Modify Response Header** → Create. Условие: все
запросы к `app.proha.site`. Добавить (Set static):

| Заголовок | Значение |
|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` |
| `Content-Security-Policy` | см. ниже |

Значение CSP (то же, что в `<meta>`, плюс `frame-ancestors` — через meta эта
директива браузерами игнорируется, работает только настоящим заголовком):

```
default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://api.proha.site; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org
```

⚠️ **НЕ ставить `X-Frame-Options: DENY` или `SAMEORIGIN`**, хотя все сканеры
и аудит этого требуют. Telegram Web (`web.telegram.org`) открывает Mini App
в iframe — этот заголовок сломает приложение у части клиентов. Защиту от
кликджекинга даёт `frame-ancestors` в CSP выше, и она умеет разрешить
именно Telegram. Это тот случай, когда буквальное следование сканеру портит
продукт.

### 4. Cloudflare → почтовые записи (10 минут)

Домен не защищён от подделки писем: DMARC-записи нет вообще, то есть письмо
«от PROha» сейчас может отправить кто угодно. Если почта с домена не ходит,
ставим жёсткий запрет — DNS → Records → Add:

| Тип | Имя | Значение |
|---|---|---|
| TXT | `@` | `v=spf1 -all` |
| TXT | `_dmarc` | `v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s` |
| MX | `@` | `.` с приоритетом `0` (null MX, RFC 7505) |

⚠️ Если когда-нибудь появится рассылка с домена (`@proha.site`), эти записи
надо будет ослабить ДО первой отправки, иначе письма будут отвергаться.

### 5. Cloudflare → DNSSEC (15 минут, из них 10 — ожидание)

DNS → Settings → DNSSEC → Enable. Скопировать выданную DS-запись в панель
REG.RU (управление доменом → DNSSEC). Проверить через `dnsviz.net`.

### 6. Роскомнадзор — уведомление об обработке ПДн

Единственный юридически обязательный пункт, который не закрывается кодом.
Подаётся бесплатно на портале РКН, самозанятый вправе быть оператором.
Реквизиты оператора уже есть в `privacy.html`.

## Про пароль — почему формулировки переписаны

Схема визарда: клиент вводит IP/порт/пароль root, форма шлёт их HTTPS-POST'ом
на `api.proha.site`, бэкенд заходит по SSH и ставит агента. Это осознанный
размен ради принципа «zero-terminal» (см. `PRODUCT.md`), а не ошибка.

Но текст на экране «ВАЖНО ПРОЧИТАТЬ» раньше утверждал «пароль от него знаете
только вы» — а это неправда, и на этой неправде держался пункт про
перекладывание рисков утечки на клиента. Дисклеймер, стоящий на ложной
посылке, не защищает, а создаёт риск. Теперь текст описывает схему как есть:
разовый доступ по SSH, пароль не сохраняется, после установки его надо
сменить — и тогда обещание «сервер только ваш» становится правдой.

Что осталось проверить на бэкенде (`concierge-bot`, другой репозиторий):
пароль не должен попадать в логи, в очередь задач или в БД — только жить в
памяти процесса на время установки.

Как убрать передачу пароля совсем: **cloud-init**. У Timeweb, Selectel,
Beget, REG.RU при создании VPS есть поле «скрипт при первом запуске» —
клиент вставляет туда одну строку, сервер ставит себя сам и стучится к нам.
Пароль не покидает клиента, zero-terminal сохраняется (копипаст в панель
хостера — не терминал).

## Проверка после включения

```sh
curl -I http://app.proha.site/          # ждём 301 на https
curl -I https://app.proha.site/ | grep -iE 'strict-transport|content-security|x-content-type|referrer|permissions'
curl -s https://app.proha.site/.well-known/security.txt
dig +short TXT proha.site; dig +short TXT _dmarc.proha.site
```

Затем прогнать заново `securityheaders.com` и Mozilla Observatory — ожидаемая
оценка A. И обязательно **открыть Mini App из бота** на телефоне и в Telegram
Desktop: CSP — единственная правка, способная сломать приложение молча.
