# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

static HTML/CSS/JS (no build step) — deploys directly to GitHub Pages. Chosen over a framework because the surface is a short linear wizard (~6-8 screens), not a large app with reusable component needs; a build step (React/Vite + GitHub Actions) would add deploy risk without current benefit.

## Users

Non-technical customers of Tasker (a personal AI assistant product) who are setting it up for the first time. They open this Mini App from the concierge Telegram bot's menu button and are walked through: choosing a tariff (PRO/4GB vs Crazy/8GB), selecting optional add-on skills, creating their own Telegram bot via BotFather, buying/providing their own VPS credentials, and waiting through install + Claude login — ideally without ever opening a terminal themselves.

## Product Purpose

Tasker is a personal AI assistant — markdown-based personality/memory files plus a Telegram bot — that each customer runs on their own VPS with their own Claude subscription. This project (`tasker-app`) is the onboarding front-end for that setup: a guided, Telegram-native wizard that replaces/augments the existing chat-only onboarding bot (`concierge-bot`) with a proper visual UI, while the same backend (SSH provisioning, install.sh, Claude auth relay) does the real work behind it.

## Positioning

Unlike shared/multi-tenant AI assistant services, each customer's agent runs on infrastructure and a Claude subscription they alone own and control (Anthropic's terms require this — no shared backend). The onboarding app's distinguishing mechanism is that it automates *real* server provisioning (SSH, install, Claude auth) behind a guided wizard — it is not marketing copy about a product the user would still have to set up manually.

## Operating Context

Opened as a Telegram Mini App from the concierge bot's menu button; runs inside Telegram's in-app browser (mobile and desktop clients). Must integrate the official `telegram-web-app.js` SDK and respect Telegram's theme (light/dark) via its CSS variables, and use native patterns (MainButton) where they fit the flow.

A separate backend API (Node, on the existing concierge VPS in Moscow) will eventually receive form submissions, validate Telegram `initData`, and perform the actual provisioning — mirroring what `concierge-bot/index.js` already does over chat. That backend/domain/HTTPS wiring is a later phase; this phase is frontend screens only, deployed to the default GitHub Pages URL (no custom domain yet).

No hard deadline currently. A ~1000-person product demo was previously targeted in ~3 weeks; that pressure has since eased significantly, so pacing favors getting the increment right over shipping fast.

## Capabilities and Constraints

- Flow mirrors the existing chat-only bot (`concierge-bot/index.js`) step order: intro → tariff select (PRO/Crazy) → add-ons → BotFather bot creation → server IP/port/password entry → install progress → done. Confirm exact screen breakdown per screen as each is built rather than fixing it all now.
- Root/server password entry should happen through this web form (HTTPS POST straight to backend) rather than as a Telegram chat message the bot has to delete after reading — a deliberate security improvement over the current chat flow, to design toward even before the backend exists.
- Video instructions are a planned future addition (plain `<video>` or an embedded player) — no constraint from the chosen static stack, add when footage exists.
- No domain/backend wiring yet in this phase — screens can assume the eventual API shape but must not block on it existing.

## Brand Commitments

None confirmed as final — see Evidence on Hand. The existing chat bot's intro persona text calls itself "Инструктор По Подключению Вашего Агента (ИппвА)"; not confirmed as binding for this surface, treat as prior art/reference only unless reused deliberately.

## Evidence on Hand

- `DAAAAM.jpg` (in the sibling `concierge-bot/assets`) is an explicit joke placeholder photo, not real brand material — do not read it as visual direction.
- User referenced a competitor Telegram Mini App, "Flowbit" (branded hero card, welcome text, language-selector buttons), as a UX reference point for what this category of app looks like — not a visual world to copy.
- No real logo, color palette, or photography exists yet. User confirmed: everything is placeholder for now.

## Product Principles

1. Zero-terminal: every step must be completable without the user opening a command line — the north star of the whole onboarding effort, not just this app.
2. Self-hosted, not shared: each customer's agent runs on their own server and subscription; there is no shared backend serving multiple customers, and the product must never imply otherwise.
3. Telegram-native feel: the app only ever opens inside Telegram, so it should look and behave like it belongs there (theme-aware, familiar patterns) rather than like a generic external website.
4. Placeholder-honest: nothing here is final brand/content yet — build structure and flow now in a way that swaps in real assets later without fighting the layout.
