# Pipeline Retro Improvements (P1–P7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Внедрить 7 процессных улучшений пайплайна maestro из ретроспективы docker-serve (авто-зона вопросов, push≠merge, статус-дисциплина, batched task-review, git-гигиена, 18.5-auto, полный диф на гейте 17).

**Architecture:** Все изменения — канонические Markdown-правки (LLM-исполняемый канон): `skills/maestro/SKILL.md` + `skills/maestro/references/hitl-gate-protocol.md` + `manual_docs/`. Плагин и механические тесты не меняются (enforcement остаётся: merge-guard, head-pin, pipeline-status tool). Housekeeping: закоммитить пропущенный план docker-serve.

**Tech Stack:** Markdown (канон скиллов), grep-верификация, `npm test` (docs-drift).

**Spec:** `docs/superpowers/specs/2026-10-21-retro-pipeline-improvements-design.md`

## Global Constraints

- Русский — рабочий язык канона (все правки SKILL.md/references — по-русски).
- Правки компактные: блоки + анти-паттерн-строки; НЕ дублировать never-auto список текстом (баннеры/правила ссылаются на п. 3в).
- Версия: 6.6.0 → 6.7.0 — bump НЕ в этой ветке задачами; решение на гейте 17, исполнение на шаге 18 (канон).
- Changelog — только секция `## [Unreleased]` (без строки версии — она на шаге 18).
- manual_docs sync — критерий приёмки (AGENTS.md).
- Плагин (`plugins/maestro-bootstrap/`) — НЕ трогать.
- Точность формулировок: спека — source of truth; цитировать её формулировки, не переизобретать.

## Review Focus

1. **Авто-зона P1 слишком широка** (запрещает легитимные вопросы) → правило должно содержать случай «условие-источник enumerated авто-гейта не выполнено → HITL» — проверяется grep'ом формулировки в Task 1.
2. **Batching P4 легализован без ruling** (молчаливый пропуск под видом режима) → Task 3 обязан требовать ruling с 3 полями; анти-паттерн «Пропускать task-review» усиливается.
3. **Keyword-матчинг P2 ложно срабатывает** («не мержи, просто пушни» = approval) → Task 2 обязан фиксировать приоритет панели и неоднозначность→HITL.
4. **Полный диф P7 не показывается на больших дифах** → Task 4 обязан описать порог (~300 строк) и секционный fallback.
5. **Дрейф manual_docs** → Task 7 синхронизирует; `npm test` (docs-drift) зелёный в Task 8.

---

### Task 1: hitl-gate-protocol.md — авто-зона контракта (P1)

**Files:**
- Modify: `skills/maestro/references/hitl-gate-protocol.md` (после блока «Никогда не авто…», ~строка 183, перед «**Ручное в manual / auto-answer**»)

**Interfaces:**
- Consumes: формулировки спеки §4.1.
- Produces: блок «Авто-зона (обратная сторона контракта)» — на него ссылаются SKILL.md anti-pattern (Task 6) и manual_docs (Task 7).

- [ ] **Step 1: Вставить блок «Авто-зона (обратная сторона контракта)»**

Точное место: сразу после абзаца «**Никогда не авто (все режимы, включая auto-ai):** …» и перед «**Ручное в manual / auto-answer**». Содержимое по спеке §4.1:

- В -aa/-ai вопрос пользователю допустим ТОЛЬКО если: (1) пункт входит в never-auto список / «Ручное в manual/auto-answer»; (2) условие-источник enumerated авто-гейта (таблица выше) не выполнено — вопрос остаётся HITL в любом режиме; (3) блокер — нет информации/доступа для продолжения и консервативный дефолт невозможен.
- Всё вне этих условий — авто-решение: одна строка в чат `[auto-answer] шаг N: <решение> — <краткое обоснование>` (формат авто-принятий 3в) + запись в журнал решений (auto-ai).
- Рутинные технические выборы — всегда авто в -aa/-ai (перечень-ориентир): execution approach после шага 12, режим review-batching (шаг 13 SKILL.md), модель для диспатча ревью, sandbox vs real при низком риске. Перечень иллюстративный.
- Запрещены вопросы-подтверждения продолжения («продолжаю?», «подтверждаешь?», «продолжаем шаги X–Y?») между шагами/фазами — ответ определён контрактом режима; такой вопрос — процессное нарушение (фиксируется в feedback report).

- [ ] **Step 2: Верификация grep'ом**

Run: `grep -c "Авто-зона (обратная сторона контракта)" skills/maestro/references/hitl-gate-protocol.md`
Expected: `1`

Run: `grep -c "условие-источник enumerated авто-гейта" skills/maestro/references/hitl-gate-protocol.md`
Expected: `1` (или больше — если упоминается и в SKILL-части; в этом файле ровно 1)

- [ ] **Step 3: Commit**

```bash
git add skills/maestro/references/hitl-gate-protocol.md
git commit -m "feat(maestro): авто-зона контракта вопросов в -aa/-ai (P1, retro)"
```

### Task 2: hitl-gate-protocol.md — push≠merge (P2) + принцип полноты/hard-floor (P4)

**Files:**
- Modify: `skills/maestro/references/hitl-gate-protocol.md` (3 точки: новый блок в «Merge-scope protocol», ~строка 281; «принцип полноты» в 3в, ~строка 135; hard floor в 3в, ~строка 141)

**Interfaces:**
- Consumes: спека §4.2 (P2), §4.4 «Согласование с контрактом авто-режимов».
- Produces: блок «Семантика push ≠ merge approval»; обновлённые формулировки «принципа полноты» и hard floor.

- [ ] **Step 1: Вставить блок «Семантика push ≠ merge approval» в конец секции Merge-scope protocol** (после абзаца про механический контур/branch-base guard, ~строка 281):

По спеке §4.2: (1) «пуш»/«push» = только push feature-ветки в remote, НЕ approval гейта 17; (2) маркер гейта 17 — только после явного ответа с семантикой мержа: первичен структурированный выбор (a) на панели; для свободной реплики — fallback keyword-матчинг («мерж»/«merge»/«approve») с требованием однозначной семантики (вложенные/отрицательные вхождения — НЕ approval; неоднозначность → HITL-гейт); вывод approval из «пуш»/контекста/молчания — нарушение ⚑1; (3) push ветки до гейта не сокращает гейт 17; (4) `head` в маркере — снимок HEAD ПОСЛЕ ответа (порядок: ответ → head-снимок → маркер).

- [ ] **Step 2: Обновить «принцип полноты» auto-answer (3в, ~строка 135)**

Было: «сама работа (шаги, pre-flight, baseline, Spec Review, task-review, docs, финальные проверки) выполняется в полном объёме. Любое сокращение процесса — вне auto-answer».
Стало: то же + оговорка: task-review исполняется в полном объёме **по покрытию** (каждый task покрыт ревью до гейта 16 — инвариант без исключений); batching (шаг 13 SKILL.md) меняет **гранулярность** (per-task → батч), не факт покрытия — это не «сокращение процесса» в смысле принципа, а легальный режим с ruling.

- [ ] **Step 3: Обновить hard floor auto-ai (3в, ~строка 141)**

Было: «Жёсткий пол (никогда не пропускается): TDD, task-review, SEC-3, шаг 15 (тесты для гейта 17), security-гейты, инварианты ⚑1–4.»
Стало: «Жёсткий пол (никогда не пропускается): TDD, task-review (per-task или batched с ruling — см. шаг 13 SKILL.md; молчаливый пропуск — нет), SEC-3, шаг 15 (тесты для гейта 17), security-гейты, инварианты ⚑1–4.»

- [ ] **Step 4: Верификация grep'ом**

Run: `grep -c "Семантика push ≠ merge approval" skills/maestro/references/hitl-gate-protocol.md` → Expected: `1`
Run: `grep -c "per-task или batched с ruling" skills/maestro/references/hitl-gate-protocol.md` → Expected: `≥1`
Run: `grep -c "по покрытию" skills/maestro/references/hitl-gate-protocol.md` → Expected: `≥1`

- [ ] **Step 5: Commit**

```bash
git add skills/maestro/references/hitl-gate-protocol.md
git commit -m "feat(maestro): push≠merge семантика + принцип полноты по покрытию (P2/P4, retro)"
```

### Task 3: SKILL.md — шаг 13: режимы task-review + ruling (P4)

**Files:**
- Modify: `skills/maestro/SKILL.md` (шаг 13, после строки 883 «Каждый task после DONE проходит task-reviewer… Пропуск task review — anti-pattern.»)

**Interfaces:**
- Consumes: спека §4.4 (таблица режимов + ruling-требования + согласование контракта).
- Produces: блок режимов task-review — на него ссылаются формулировки Task 2 (hard floor) и manual_docs (Task 7).

- [ ] **Step 1: Вставить блок «Режимы task-review» после строки 883**

Содержимое: таблица режимов (per-task = канон/default + fallback если условия ниже не выполнены; phase-batched = план с 5+ задачами, задачи группируются в фазы; final-only = план с ≤3 задачами), решения: -aa/-ai — авто-выбор с ruling; manual — HITL-предложение. Требования к ruling (3 обязательных поля, запись в ledger/журнал решений): (1) выбранный режим + причина (cost: N диспатчей vs M); (2) состав батча; (3) принятый риск: отклонения обнаруживаются позже → дороже фиксы (прецедент: docker-serve И-3 — healthcheck-bashism известен с Task 7, исправлен на финальном ревью). Ruling включается в сводку журнала на гейте 17 (auto-ai). Молчаливый пропуск — анти-паттерн; единственный легальный путь отклонения от per-task — явный ruling.

- [ ] **Step 2: Усилить анти-паттерн «Пропускать task-review при SDD» (таблица Anti-patterns, ~строка 1339)**

Было: «Без review имплементация отклоняется от спецификации незаметно. Каждый task — review.»
Стало: добавить: «Единственное легальное отклонение от per-task — batched с ruling (шаг 13); пропуск "ради темпа" без ruling — нарушение в любом режиме.»

- [ ] **Step 3: Верификация grep'ом**

Run: `grep -c "Режимы task-review" skills/maestro/SKILL.md` → Expected: `1`
Run: `grep -c "phase-batched" skills/maestro/SKILL.md` → Expected: `≥2` (блок + анти-паттерн)

- [ ] **Step 4: Commit**

```bash
git add skills/maestro/SKILL.md
git commit -m "feat(maestro): batched task-review с ruling в шаге 13 (P4, retro)"
```

### Task 4: SKILL.md — шаг 17: push-семантика + полный диф (P2/P7)

**Files:**
- Modify: `skills/maestro/SKILL.md` (шаг 17: строка 1114 «Не выполнять merge/push до явного ответа…»; блок «Оркестратор ПОКАЗЫВАЕТ», строки 1115-1116)

**Interfaces:**
- Consumes: спека §4.2 (п. 2), §4.7 (п. 1).
- Produces: правила показа на гейте 17 — используются manual_docs (Task 7).

- [ ] **Step 1: Добавить push-семантику в шапку гейта 17 (после строки 1114)**

Строка: «Команда пользователя "пуш"/"push" означает только push feature-ветки — НЕ approval этого гейта (маркер — только после явного (a); канон: `references/hitl-gate-protocol.md`, "Семантика push ≠ merge approval").»

- [ ] **Step 2: Добавить полный диф в блок «Оркестратор ПОКАЗЫВАЕТ» (строки 1115-1116)**

После «git log, test results, coverage status и список открытых issues…» добавить: полный `git diff <mainline>...HEAD`: до ~300 строк — полностью в чате; больше — по файлам/секциям с заголовками (и/или выгрузка в файл с путём в чате) + предложение показать конкретные файлы по запросу. Обоснование: гейт 17 — единственная точка approval merge; человек видит весь объём изменений до попадания в main.

- [ ] **Step 3: Верификация grep'ом**

Run: `grep -c "Семантика push ≠ merge approval" skills/maestro/SKILL.md` → Expected: `1`
Run: `grep -c "полный .git diff <mainline>...HEAD\|полный \\\`git diff" skills/maestro/SKILL.md` → Expected: `≥1` (или проверка маркера «до ~300 строк»)

- [ ] **Step 4: Commit**

```bash
git add skills/maestro/SKILL.md
git commit -m "feat(maestro): push-семантика + полный диф на гейте 17 (P2/P7, retro)"
```

### Task 5: SKILL.md — статус-дисциплина (P3) + сверка коммита шага 12 (P7) + 18.5 auto (P6)

**Files:**
- Modify: `skills/maestro/SKILL.md` (секция «Pipeline status indication», строки 219-225; шаг 12, строки 830-832; шаг 18.5, строки 1197-1208)

**Interfaces:**
- Consumes: спека §4.3 (P3: get/resume + критерий выбора скилла), §4.7 п. 2 (P7: сверка staging), §4.6 (P6).
- Produces: правила resume/статуса — используются manual_docs/reference/pipeline-status.md (Task 7).

- [ ] **Step 1: Дополнить «Pipeline status indication» (после строки 225)**

Три правила: (1) `get` перед анонсом следующего шага — сверка фактического статуса (исключает рассинхрон нумерации); (2) Resume-протокол после компакции/обрыва: положение восстанавливается через `get` + ledger (план/SDD) + `git log`, не по памяти сессии; (3) однострочное правило выбора скилла по фактическому состоянию: `step < 13` → канон (скилл загрузится точкой использования); `step 13` при неполном ledger → executing-plans/subagent-driven по признаку «живые task-строки без DONE»; `step > 13` → финализация (никаких execution-скиллов).

- [ ] **Step 2: Добавить сверку состава коммита шага 12 (после строки 830-832)**

После «Оркестратор коммитит spec, plan, изменения контекста и entry одним коммитом» добавить: перед коммитом — сверка staging (`git diff --cached --stat`): оба файла (spec и plan) в staging; каноническое имя `docs: design + plan for <feature-name>`. Прецедент: docker-serve (6.6.0) — план остался untracked, коммит содержал только spec.

- [ ] **Step 3: Дополнить режим `auto` шага 18.5 (после строк 1197-1208)**

После fail-soft-правила добавить: молчаливый пропуск 18.5 в режиме `auto` (без строки «Отчёт не сгенерирован: <причина>») — процессное нарушение, фиксируется в следующем feedback report; осознанный пропуск (не сбой) требует ruling-строки в чат с причиной.

- [ ] **Step 4: Верификация grep'ом**

Run: `grep -c "Resume-протокол" skills/maestro/SKILL.md` → Expected: `1`
Run: `grep -c "сверка staging\|git diff --cached --stat" skills/maestro/SKILL.md` → Expected: `≥1`
Run: `grep -c "молчаливый пропуск 18.5" skills/maestro/SKILL.md` → Expected: `1`

- [ ] **Step 5: Commit**

```bash
git add skills/maestro/SKILL.md
git commit -m "feat(maestro): статус-дисциплина + сверка коммита 12 + 18.5 auto ruling (P3/P7/P6, retro)"
```

### Task 6: SKILL.md — Anti-patterns (6 строк) + блок git-гигиены (P5)

**Files:**
- Modify: `skills/maestro/SKILL.md` (таблица Anti-patterns, строки 1330-1349; новый блок «Git-гигиена оркестратора» — в конец секции «Обработка сбоев», ~строка 1281-1330)

**Interfaces:**
- Consumes: спека §4.5 (P5), §4.1/§4.2/§4.3/§4.7 (анти-паттерн-формулировки).
- Produces: анти-паттерн-строки (для feedback report) + блок git-гигиены.

- [ ] **Step 1: Добавить 6 строк в таблицу Anti-patterns**

1. `| **Вопрос-подтверждение продолжения между шагами/фазами в авто-режимах («продолжаю?», «подтверждаешь?») | Ответ определён контрактом режима: -aa/-ai дают предварительное согласие на весь прогон вне never-auto списка. Такой вопрос — шум, размывающий внимание HITL на инвариантных гейтах (10/17). Продолжать без вопроса; авто-решения — строкой в чат. |`
2. `| **Интерпретировать «пуш»/контекст как approval гейта 17** | ⚑1: merge — только явный ответ с семантикой мержа. «Пуш» = push feature-ветки, не более. Self-approve маркера (до явного ответа) — процессное нарушение даже при формально валидном маркере. |`
3. `| **Resume после компакции по памяти сессии (без get/ledger/git log)** | Память сессии ненадёжна после компакции: пропущенные пункты плана, ложный скилл, неверная нумерация. Восстанавливать положение инструментально: pipeline status get + ledger + git log. |`
4. `| **Blind stash drop (без git stash show -p и явного решения)** | В стэше могут быть незакоммиченные правки по брифу задачи (spec-sync и т.п.) — потеря данных (прецедент: docker-serve И-4). Осмотр обязателен; правки по брифу = незавершённая задача. |`
5. `| **Version bump на feature-ветке до merge** | Канон (шаг 18): bump — отдельный коммит на base-ветке после merge, до push base. Bump на feature-ветке создаёт ложный merge-scope и нарушает воспроизводимость релиза. |`
6. `| **Коммит шага 12 без сверки состава (plan/spec не в staging, неканоническое имя)** | Пропущенный артефакт пайплайна выпадает из merge-scope и истории (прецедент: docker-serve — план untracked). Сверка staging перед коммитом обязательна. |`

- [ ] **Step 2: Добавить блок «Git-гигиена оркестратора» в конец секции «Обработка сбоев»**

Содержимое по спеке §4.5: (1) Stash-drop с осмотром: `git stash` для разблокировки checkout — только с предварительным `git stash show -p` и явным решением «что в стэше»; содержимое, соответствующее брифу задачи — незавершённая задача: вернуть (`stash pop`) и завершить (commit), не выбрасывать; выбрасывание — только для однозначного мусора с фиксацией строкой в чат. (2) Version bump — только на base-ветке после merge (шаг 18), отсылка к анти-паттерну.

- [ ] **Step 3: Верификация grep'ом**

Run: `grep -c "Вопрос-подтверждение продолжения" skills/maestro/SKILL.md` → Expected: `1`
Run: `grep -c "Blind stash drop" skills/maestro/SKILL.md` → Expected: `1`
Run: `grep -c "Git-гигиена оркестратора" skills/maestro/SKILL.md` → Expected: `1`
Run: `grep -c "Version bump на feature-ветке" skills/maestro/SKILL.md` → Expected: `1`

- [ ] **Step 4: Commit**

```bash
git add skills/maestro/SKILL.md
git commit -m "feat(maestro): анти-паттерны ретро + блок git-гигиены (P5, retro)"
```

### Task 7: manual_docs — синхронизация (hitl-gates.md + pipeline-status.md)

**Files:**
- Modify: `manual_docs/reference/hitl-gates.md` (секции «🚀 Режимы запуска», описание гейта 17)
- Modify: `manual_docs/reference/pipeline-status.md`

**Interfaces:**
- Consumes: канонные правки Tasks 1-6 (final wording).
- Produces: user-facing документация, синхронная с каноном.

- [ ] **Step 1: Обновить hitl-gates.md — «Режимы запуска»**

Добавить в описание -aa/-ai: авто-зона контракта (вопросы только из never-auto / «иначе-HITL» / блокеров; всё остальное — авто-решение со строкой в чат), ссылка на полный контракт в каноне. Добавить в описание гейта 17: полный диф `git diff <mainline>...HEAD` в составе показа; семантика «пуш ≠ approval».

- [ ] **Step 2: Обновить pipeline-status.md**

Добавить: `get` перед анонсом шага; resume-протокол после компакции (get + ledger + git log, не по памяти); критерий выбора скилла (step < 13 / 13 / > 13).

- [ ] **Step 3: Верификация**

Run: `grep -c "авто-зона\|Авто-зона" manual_docs/reference/hitl-gates.md` → Expected: `≥1`
Run: `grep -c "resume\|Resume" manual_docs/reference/pipeline-status.md` → Expected: `≥1`

- [ ] **Step 4: Commit**

```bash
git add manual_docs/reference/hitl-gates.md manual_docs/reference/pipeline-status.md
git commit -m "docs: синхронизация manual_docs с P1-P7 (retro)"
```

### Task 8: Housekeeping + changelog + regression entry

**Files:**
- Create: `docs/superpowers/plans/2026-10-21-docker-serve-plan.md` (копия из main-checkout; путь-источник: `/Users/odemidov/dev/github/maestro-agent/docs/superpowers/plans/2026-10-21-docker-serve-plan.md` — untracked, 27 КБ)
- Modify: `manual_docs/overview/changelog.md` (секция `[Unreleased]`)
- Create: `regression/entries/2026-10-21-retro-pipeline-improvements.md`

**Interfaces:**
- Consumes: всё выше.
- Produces: закрытый housekeeping (план docker-serve в истории), changelog-буллиты, regression entry.

- [ ] **Step 1: Скопировать пропущенный план docker-serve в ветку**

`cp /Users/odemidov/dev/github/maestro-agent/docs/superpowers/plans/2026-10-21-docker-serve-plan.md docs/superpowers/plans/`

- [ ] **Step 2: Changelog — буллиты в `[Unreleased]`**

Секция `## [Unreleased]` (если нет — создать над последней релизной): 7 буллитов P1-P7 (кратко, по формату существующих).

- [ ] **Step 3: Regression entry**

`regression/entries/2026-10-21-retro-pipeline-improvements.md`: version 1, feature, added (7 пунктов), status: active, risk: канонные правила без enforcement — дрейф исполнения, scenarios: (1) прогон -aa/-ai: счёт вопросов = только named-гейты; (2) гейт 17 после пуша ветки: полный диф показан, маркер только после (a); (3) stash-операция оркестратора: осмотр перед drop. Поля `run:`/`workdir:` — по формату соседних entries.

- [ ] **Step 4: Финальная верификация**

Run: `npm test`
Expected: все тесты зелёные (docs-drift проверит синхронность версий/имён).

Run: `grep -c "2026-10-21-docker-serve-plan" <(git status --porcelain)` → файл закоммичен (не в выводе status).

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-10-21-docker-serve-plan.md manual_docs/overview/changelog.md regression/entries/2026-10-21-retro-pipeline-improvements.md
git commit -m "chore: docker-serve plan housekeeping + changelog [Unreleased] + regression entry (retro)"
```

## Regression Scenarios (для entry, шаг 11)

1. **Retro-P1:** прогон в -aa/-ai задаёт вопросы только на named-гейтах (10/17) + security при FINDINGS; «продолжаю?»-вопросы отсутствуют. Риск: дрейф исполнения (канон без enforcement).
2. **Retro-P2:** после команды «пуш» гейт 17 остаётся обязательным; маркер создаётся только после явного (a). Риск: keyword-матчинг в свободных репликах.
3. **Retro-P4:** batched-режим всегда с ruling в ledger; молчаливый пропуск отсутствует.
4. **Retro-P7:** гейт 17 показывает полный диф (не только --stat).
