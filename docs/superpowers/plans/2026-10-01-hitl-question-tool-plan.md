# HITL Question Tool (#87, 4.20.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** «Правило вопросов (UX)» — вопрос-тул (панель) для всех выбор-гейтов; текст — free input и fallback.

**Architecture:** правка канона `references/hitl-gate-protocol.md` (правило вопросов + 3a) + sync `manual_docs/reference/hitl-gates.md` (+ fix дрейфа). SKILL.md и плагин не трогаются.

**Tech Stack:** markdown-каноны, `npm test` (docs-drift).

---

### Task 1: Глава `hitl-gate-protocol.md` — переписать «Правило вопросов (UX)»

**Files:**
- Modify: `skills/maestro/references/hitl-gate-protocol.md` (L9–18 правило; L83–101 п.3а; L25–27 «Оркестратор ОБЯЗАН»)

- [ ] **Step 1:** Прочитать главу полностью + спеку `docs/superpowers/specs/2026-10-01-hitl-question-tool-design.md` (D1–D5).
- [ ] **Step 2:** Заменить «Правило вопросов (UX)» (L9–18) на (стиль главы, ~25–35 строк; пометка «(#87, 4.20.0)»):
  - **Панель (question tool)** — все гейты с закрытым набором вариантов: decision (2/7/10/12/17, когда HITL), контентные (7b — без (Recommended); brainstorm Q/A с вариантами; D2/D6/D7; сходимость/плато; особый случай 10; custodian-сходимость; 8.6/Точка 2; D5; 13f; docs-расхождение 14; Tier 3; 15/15a; 9-offer; spike), предпочтения (0/1/1.5). Перечень иллюстративный — полнота: «Полный перечень gates» + never-auto + inline-гейты SKILL.md.
  - **Текст** — чистый свободный ввод (описание фичи, открытые вопросы, свободные имена).
  - **Fallback** — harness без question tool (Claude Code и др.) или сбой тула: (a)/(b)/(c) текстом в сообщении.
  - **Формат:** контекст (п.1) — в сообщении до панели; варианты — options с description; recommended (3а) — первый вариант + «(Recommended)» в label + «потому что Y» в description; пакет 3–4 связанных закрытых вопросов — один multi-question вызов (тул: навигация между вопросами до submit); варианты-со-значением (Tier 3 «указать вручную», гейт 0 «создать») — двухшагово: буква в панели, значение — follow-up текстом; панель — только для HITL-вопросов (авто-принятия 3в и auto-ai — не панелью).
  - **Без ослабления:** клик по варианту = явная буква (в т.ч. ⚑2 гейт 10: «явная команда»); в панели нет варианта «молчание/continue-по-умолчанию»; Escape/нет ответа = «нет ответа» → STOP/пауза (п.3), не recommended-дефолт; «continue»/«ок» — по п.3.
  - **13f batch** (несколько расхождений, «один гейт на все entries»): multi-question вызов (вопрос на каждое расхождение, options a/b/c); сбой тула — текст-fallback со списком.
  - **Spike-основание (2–3 строки):** 2026-10-01 — возможности тула (options, recommended-конвенция, авто-опция «ввести свой ответ») + dogfooding ~10 гейтов вкл. free-form через авто-опцию → панель не лишает отказа от вариантов.
- [ ] **Step 3:** П.3а — в пункт «Структурированные варианты (a)/(b)/(c) сохраняются…» добавить пометку: «На панели (question tool) — первый вариант + „(Recommended)“ в label (конвенция тула)».
- [ ] **Step 4:** Проверка: `grep -c "question" skills/maestro/references/hitl-gate-protocol.md` ≥3; нумерация пунктов 0–4/3а/3в не сдвинута (grep «^0\. \|^1\. \|^2\. \|^3\. \|^3а\.\|^3в\.\|^4\. »); npm test → 266/266; рост ≤ ~40 строк.
- [ ] **Step 5:** Коммит: `git add skills/maestro/references/hitl-gate-protocol.md && git commit -m "docs: #87 T1 — hitl-gate-protocol: вопрос-тул для всех выбор-гейтов (UX-правило, 3a recommended, 13f multi-question)"`

### Task 2: `manual_docs/reference/hitl-gates.md` — sync + fix дрейфа

**Files:**
- Modify: `manual_docs/reference/hitl-gates.md` (п.6 ~L24; L95 «recommended (a)» гейт 16)

- [ ] **Step 1:** Прочитать файл + новое правило из T1 (Step 2).
- [ ] **Step 2:** П.6 «Правило вопросов (UX)» — переписать синхронно с главой (сжатая форма, стиль страницы: без проза-стен; R1–R6 `skills/manual-docs/SKILL.md`).
- [ ] **Step 3:** L95 (гейт 16/D5): убрать пометку «рекомендуемый вариант — (a)» (противоречие 3а: дефолты только на 5 decision gates) — оставить нейтральное описание вариантов (a)/(b)/(c).
- [ ] **Step 4:** Проверка: `node /tmp/wall-scan.mjs manual_docs/reference/hitl-gates.md` → 0 стен (методика: 600 знаков, fences off, таблицы/списки построчно, проза-блоки; воссоздать, если нет); npm test → 266/266; git status — только этот файл.
- [ ] **Step 5:** Коммит: `git add manual_docs/reference/hitl-gates.md && git commit -m "docs: #87 T2 — hitl-gates.md: sync UX-правила + fix дрейфа recommended (гейт 16)"`

### Task 3: Синхронизация (changelog/roadmap/regression entry/TODO)

**Files:**
- Modify: `manual_docs/overview/changelog.md`, `docs/roadmap.md`, `TODO.md` (gitignored)
- Create: `regression/entries/2026-10-01-hitl-question-tool.md`

- [ ] **Step 1:** Changelog `## [2026-10-01]` — `> **Версия 4.20.0** — Minor-релиз: …`: Добавлено (вопрос-тул для всех выбор-гейтов: формат, пакетность multi-question, варианты-со-значением, 13f batch); Изменено (UX-правило: содержательные гейты — на панель; текст — free input + fallback; без ослабления: клик = явная буква, Escape = STOP; known: «(Recommended)» — конвенция тула OpenCode).
- [ ] **Step 2:** Roadmap #87 (L37–40, Волна 1 «Параллельно»): → «**Выполнено (4.20.0, 2026-10-01):** спайк — „хватает“ (возможности тула + dogfooding ~10 гейтов вкл. free-form); правки — вопрос-тул для всех выбор-гейтов (UX-правило, пакетность, 13f multi-question); без ослабления закрытого перечня (клик = явная буква; Escape = STOP). Осознанное отклонение от «4.7.x/4.8.x»: minor — меняется подача всех HITL-гейтов.» + regression-ссылка. L94 (Волна 3 «#87 (правки)») — пометка «выполнено в 4.20.0» (или сноска к L37).
- [ ] **Step 3:** Regression entry (формат соседей): risk LOW (каноны доков, плагин не затронут); scenarios: [Manual] HITL-гейт в OpenCode — подаётся через question tool (выбор/Escape/custom), пакет 3–4 — один multi-question вызов; [Manual] harness без тула — текст (a)/(b)/(c); regressions: ослабление «явного выбора» — нет (клик = буква, Escape = STOP, continue по п.3); links: changelog, спека.
- [ ] **Step 4:** TODO.md строка 15 (radio/checkbox UI) → `[x]` + «реализовано (2026-10-01, 4.20.0, #87): вопрос-тул для всех выбор-гейтов» (формат соседних; gitignored).
- [ ] **Step 5:** Проверка: npm test → 266/266 (drift D4: «Выполнено (4.20.0)» ↔ changelog; D1a/D1b — НЕ ТРОГАТЬ, bump на merge); git status — 3 файла + 1 новый.
- [ ] **Step 6:** Коммит: `git add manual_docs/overview/changelog.md docs/roadmap.md regression/entries/2026-10-01-hitl-question-tool.md && git commit -m "docs: #87 T3 — changelog 4.20.0, roadmap #87, regression entry"`

---

## Верификация (после T3, перед финальным ревью)

- npm test — 266/266; критерии приёмки спеки 1–4.
- Финальное ревью (шаг 16): тип {docs} → одиночный `reviewer`, критерии docs + §9.
- Merge → bump 4.20.0 (package.json, project-context §3, AGENTS-метка) → push → agpack sync → feedback-отчёт (auto).
- **Dogfood:** начиная с этого merge, все HITL-гейты этой сессии подаются через question tool по новому правилу (панель для выбор-гейтов) — само подтверждение фичи.
