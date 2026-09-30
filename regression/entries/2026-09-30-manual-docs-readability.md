# Regression — manual-docs-readability (4.18.0)

- **version:** 1
- **feature:** читабельность manual_docs + правила в скилле `manual-docs` (4.18.0): секция «Читабельность» в `skills/manual-docs/SKILL.md` (правила R1–R6 + before/after-пример, пункт в «Правило 3») + реформат 7 страниц `manual_docs/` (структура: лиды/списки/разбиение стен; факты дословно; заголовки не тронуты). Плагин и пайплайн — без изменений
- **added:** 2026-09-30
- **status:** active
- **risk:** LOW (только доки: секция в скилле + 7 страниц manual_docs; плагин, конфиг, pipeline не затронуты; смысл и факты — дословно, структура не меняет поведение)
- **category:** `skills/manual-docs/SKILL.md` (секция «Читабельность» + пункт «Правило 3»), 7 страниц `manual_docs/`
- **scenarios:**
  - **wall-scan (методика D4.1) по 7 файлам → 0 стен, exit 0:**
    `node /tmp/wall-scan.mjs manual_docs/explanation/agents-and-trust.md manual_docs/how-to/enable-memory.md manual_docs/tutorials/setup-project.md manual_docs/how-to/choose-models.md manual_docs/how-to/choose-embedding-model.md manual_docs/explanation/pipeline-overview.md manual_docs/how-to/keep-docs-up-to-date.md`
    (скрипт одноразовый, в `/tmp`, НЕ коммитится — постоянный чек это FU2;
    логика: fenced code blocks исключаются, списки/таблицы — построчно после
    очистки префиксов, проза — блоком, «стена» > 600 знаков)
  - **blindspot-scan (мультистрочные буллеты) по тем же 7 файлам → 0, exit 0:**
    `node /tmp/blindspot-scan.mjs <те же 7 файлов>` — ловит blind-spot
    построчного скана: буллет, где каждая физическая строка < 600, но
    логическая сумма > 600.
  - **факт-сверка:** `git diff main...HEAD -- 'manual_docs/**' 'skills/manual-docs/**'` —
    только перестройка (списки/таблицы/лиды/акценты/подзаголовки); факты
    (inline-code spans, пути, команды, ключи, версии, имена) — без
    удалений/замен (на реформате проверялось multiset'ом inline-code spans
    до/после); заголовки страниц не переименованы (anchor-ссылки целы).
  - **(auto) `npm test`:** зелёный — 266/266; drift-тест: `changelog.md`
    исключён из D1c (история версий), D4 — «Выполнено (4.18.0, …)» ↔
    changelog согласовано, STALE_NAMES отсутствуют.
- **regressions:** ⚑1–4 не затрагиваются; плагин и конфиг не изменены;
  - (a) **blind-spot построчного wall-scan:** мультистрочный буллет-«стена»
    (каждая физ. строка < 600, логическая сумма > 600) не детектируется —
    найден в T4 в `enable-memory.md` (813 знаков); защита: ручной
    blindspot-скан при реформате + FU2 (перманентный wall-check в `npm test`
    по проза-блокам и суммарной длине буллетов);
  - (b) **R4-раскрытия** — новые скобочные вставки при первом вхождении
    аббревиатуры (HITL, RBAC и т.п.) — добавление без перестройки
    предложения (граница с D3);
  - (c) **факт-чек при реформате** — multiset inline-code spans до/после по
    каждому файлу (защита от потери фактов при переносе в структуру).
- **links:** changelog `[2026-09-30]` (4.18.0) | `manual_docs/how-to/keep-docs-up-to-date.md` | спека `docs/superpowers/specs/2026-09-30-manual-docs-readability-design.md`

## Follow-up

- FU1: reference-страницы вне скоупа 4.18.0 — `reference/memory.md` (35 стен), `config.md` (13), `hitl-gates.md` (6), `model-selection.md` (6), `commands.md` (5) — отдельным пасом; правила R1–R6 применяются, R4 — per-раздел (non-linear чтение). Числа — из первичного грубого блочного скана (спека, «Контекст»); при старте FU1 перемерить по методике D4.1 (счёт будет ниже — как на страницах 4.18.0: грубый 100 → D4.1 9).
- FU2: перманентный wall-check в `npm test` (методика D4.1: проза-блоки + суммарная длина буллетов; закрывает blind-spot построчного скана). **Зависимость (спека D6): реализация — после FU1** (иначе baseline красный: в `reference/` ещё есть «стены»); открытый вопрос D6: включать ли `manual_docs/examples/` в чек.

## Dogfooding

Baseline (main, методика D4.1): wall-scan — 9 стен (agents-and-trust 6:
905/1763/973/1214/651/1197; pipeline-overview 2: таблица 683 + проза 659;
keep-docs 1: 717); blindspot-scan — 15 (те же 9 + 5 мультистрочных буллетов в
agents-and-trust: 655/769/637/767/800; enable-memory 1: 813). После реформата —
0/0 по всем 7 файлам (2026-09-30). `choose-models.md` / `choose-embedding-model.md`
— комплаентны без правок (проверены).
