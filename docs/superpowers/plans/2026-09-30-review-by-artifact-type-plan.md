# #107 «Ревью по типу артефакта» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** шаг 16 (финальное ревью) получает тип артефакта (code/docs/config/sql) с механическим детектом, критериями по типу (built-in + override §9) и переименованием агента `code-reviewer` → `reviewer`.

**Architecture:** процессная фича — плагин не меняется. Детали канона — новая глава `skills/maestro/references/artifact-review.md`; в скелет SKILL.md (шаг 16) — компактная механика + pointer (гигиена 4.14.x). Агенты по типам не плодимся: один `reviewer`, тип+критерии — в промпте диспатча.

**Tech Stack:** Markdown-скиллы/агенты/команды/доки, bash-скрипты (stale-очистка), Node test runner (npm test — регрессии + coverage-тесты).

**Spec:** `docs/superpowers/specs/2026-09-30-review-by-artifact-type-design.md` (подписана, принята гейтом 10; D1–D8)

## Global Constraints

- Язык контента: русский (рабочий язык репо); вставки в self-contained-промпты — по языку файла (русский в `agents/reviewer.md`, `SKILL.md`).
- Гигиена скелета: в `skills/maestro/SKILL.md` — только механика ~15–20 строк + pointer; таблицы — только в главе канона.
- Self-contained: `agents/reviewer.md` грузится без skill-тула; критерии типов в промпт НЕ встраиваются (их передаёт оркестратор в промпте диспатча).
- Non-goals (из спеки): verdict-формат, P1.1, M3-арбитраж, fix-loop, SEC-3, инварианты ⚑1–4 — не трогать; параллельное первое ревью (#95) — только `code`; процессные артефакты (спека/план/changelog/regression) — вне детекта (D2 п.6).
- Плагин `plugins/maestro-bootstrap/` НЕ меняется (в т.ч. тест-фикстура `index.test.js` со строковым ключом «code-reviewer» остаётся — это ключ sanitizer_whitelist, не реестр агентов).
- Исторические документы (`specs/`, `docs/superpowers/`, `regression/`, changelog-секции до 4.16.0) — не трогать.
- После каждого task: `npm test` зелёный (baseline 264/264).

## Review Focus

1. **Смешанный диф (code+docs+config):** ожидаемый набор типов + кодовый путь первичен, тип-критерии вторичны — закреплено тестом-сценарием в T2 (сценарии детекта, шаг T2.4).
2. **Файл без расширения (`LICENSE` vs случайный):** allowlist безрасширенных имён — T2 (сценарий `LICENSE` → текстовый; прочие → бинарный гейт).
3. **Процессные артефакты в дифе (`docs/superpowers/specs/*.md`):** не дают типов — T2 (сценарий D2 п.6).
4. **`*.test.json` в `tests/`:** code (не config) — T2 (сценарий fixture-правила).
5. **Guard «одна модель» после rename:** читает `agent.reviewer.model` — T1 (sweep + проверка строки в SKILL.md).

---

### Task 1: rename `code-reviewer` → `reviewer` (полная поверхность)

**Files:**
- Rename: `agents/code-reviewer.md` → `agents/reviewer.md` (git mv)
- Modify: `skills/maestro/SKILL.md` (шаг 16 + упоминание ~строка 461), `skills/maestro/references/model-selection.md`, `skills/maestro/references/trust-and-security.md`, `skills/maestro/references/spec-review.md`, `skills/maestro-setup/SKILL.md`, `skills/maestro-assistant/SKILL.md`, `commands/maestro-init.md`, `commands/test-agents.md`, `AGENTS.md` (перечень агентов, строка 9), `README.md`, `docs/project-context.md` (§4 строка 88, §8), `plugins/maestro-bootstrap/README.md`, `maestro.json` (by_agent), `maestro-install.sh` (секция 4a), `maestro-update.sh` (секция 3a)
- Modify (manual_docs): `explanation/agents-and-trust.md`, `explanation/pipeline-overview.md`, `reference/model-selection.md`, `reference/hitl-gates.md`, `reference/commands.md`, `reference/config.md`, `how-to/choose-models.md`, `how-to/customize-maestro.md`, `examples/example-feature.md`, `tutorials/setup-project.md`
- Локально (gitignored, не коммитить): `.opencode/opencode.json` (ключ `agent.code-reviewer.model` → `agent.reviewer.model`), зеркало `.opencode/agents/code-reviewer.md` → удалить (stale)

**Interfaces:**
- Produces: агент `reviewer` (frontmatter/permission — без изменений, только description); `subagent_type=reviewer` во всех диспатчах; `agent.reviewer.model` — каноничный ключ модели; `sanitizer_whitelist.by_agent.reviewer` в `maestro.json`.

- [ ] **Step 1: git mv + description**

```bash
git mv agents/code-reviewer.md agents/reviewer.md
```

`agents/reviewer.md`: description → «Финальное ревью ветки по типу артефакта: git diff, история коммитов, анализ (code/docs/config/sql)». Тело — без изменений (секция «Ревью по типу артефакта» — T2).

- [ ] **Step 2: замена имени по перечню (23 файла, аудит `grep -rln "code-reviewer"`)

Заменить `code-reviewer` → `reviewer` в перечисленных файлах T1; контекст-нюансы:
- `references/model-selection.md`: маппинг `code_review` → `reviewer`, ключ `agent.reviewer.model`, tier-маппинг, permissions.
- `skills/maestro-setup/SKILL.md`: генерация ключа **новым** проектам → `agent.reviewer.model`.
- `commands/test-agents.md`: диспатч → `reviewer`.
- `maestro.json`: `sanitizer_whitelist.by_agent` — ключ `code-reviewer` → `reviewer` (значение массива — без изменений).
- `SKILL.md` (шаг 16): `subagent_type=code-reviewer` → `reviewer`; guard «одна модель»: `agent.code-reviewer.model` → `agent.reviewer.model`.
- Не трогать: `plugins/maestro-bootstrap/index.test.js` (строковый ключ), `docs/superpowers/**`, `specs/`, `regression/`, changelog-секции до 4.16.0.

- [ ] **Step 3: скрипты — stale-очистка (HITL-решение (a) спеки)**

`maestro-install.sh` (секция 4a «Очистка stale-артефактов») и `maestro-update.sh` (секция 3a): добавить в списки stale-путей `agents/code-reviewer.md` (`.opencode/agents/code-reviewer.md`) с комментарием-основанием (rename 4.16.0). Паттерн — существующие строки stale-очистки в тех же секциях (rename-прецедент maestro-new→setup).

- [ ] **Step 4: sweep-проверка**

Run: `grep -rn "code-reviewer" skills/ commands/ agents/ manual_docs/ README.md AGENTS.md docs/project-context.md maestro.json plugins/maestro-bootstrap/README.md *.sh`
Expected: 0 строк (исторические каталоги в sweep не входят).

- [ ] **Step 5: npm test + локальный dogfood-конфиг**

Run: `npm test` → Expected: 264 pass / 0 fail (фикстура плагина не тронута).
Локально (без коммита): `.opencode/opencode.json` — ключ `agent.code-reviewer.model` → `agent.reviewer.model`; удалить stale `.opencode/agents/code-reviewer.md` (если есть).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(agent): rename code-reviewer → reviewer (поверхность: 23 файла, скрипты stale-очистка)"
```

---

### Task 2: глава канона `artifact-review.md` + SKILL.md шаг 16 + промпт `reviewer` + протокол гейтов

**Files:**
- Create: `skills/maestro/references/artifact-review.md`
- Modify: `skills/maestro/SKILL.md` (шаг 16, ~строка 864), `agents/reviewer.md` (новый раздел), `skills/maestro/references/hitl-gate-protocol.md` (регистрация гейта), `skills/maestro/references/spec-review.md` (одна строка)

**Interfaces:**
- Consumes: агент `reviewer` (T1), `PROJECT_CONTEXT` §9 (шаг 0), `review.parallel` (шаг 0).
- Produces: канон типов/детекта/критериев (одна точка правды); pointer в SKILL.md `references/artifact-review.md`; гейт D5 в перечне `hitl-gate-protocol.md`; поле промпта диспатча «Тип артефакта: …; Активные критерии: …».

- [ ] **Step 1: создать `skills/maestro/references/artifact-review.md`**

Формат под существующие тесты (`references-coverage.test.mjs`): заголовок `# … (глава)`, строка «Канон:», упоминание в SKILL.md (anti-orphan). Контент — дословно по спеке D1–D6:
1. Типы: `code`/`docs`/`config`/`sql` (тип — свойство дифа; набор типов).
2. Детект: закрытые списки (таблица D2), порядок проверки `sql` → `config` → `docs` → `code`, правила 1–6 (включая: вне детекта — `docs/superpowers/specs/**`, `docs/superpowers/plans/**`, changelog, `regression/**`; порядок бинарность→гейт→детект).
3. Критерии: built-in по типу (code — 5 пунктов фокуса из `agents/reviewer.md` + SEC-3; docs/config/sql — по спеке D3) + правило override (по-пунктный merge, приоритет §9) + мини-пример из спеки.
4. Бинарные: allowlist текстовых расширений (закрытый, по спеке D5) + безрасширенные имена (LICENSE, LICENSE.*, Gemfile, Rakefile, Procfile, Jenkinsfile) + deny-by-default + текст гейта (без «recommended» в опции; recommended — только auto-ai-fallback) + семантика вариантов (a)/(b)/(c).
5. Диспатч-матрица: набор с `code` → логика #95 без изменений; ⊆ {docs,config,sql} → одиночное (code-reviewer→`reviewer`) независимо от `review.parallel`; анонс «Тип артефакта: …» + «Параллельное ревью: да/нет — причина: …».
6. Версионность/история: 4.16.0, прецеденты #95/P1.1.

- [ ] **Step 2: SKILL.md — шаг 16, компактная механика**

В начале шага 16 (до «Параллельное первое ревью») — блок ~15–20 строк:
- детект типов по главе канона (строка-ссылка на правило);
- порядок: бинарность (D5-гейт) → детект → анонс «Тип артефакта: <набор>»;
- выбор dispatch: `code` в наборе → параллельное (#95, как ниже); ⊆ {docs,config,sql} → одиночное независимо от `review.parallel` (корректировать существующий блок активации одной строкой-исключением, не переписывая);
- активные критерии (built-in | §9-override) — блоком в промпт диспатча;
- pointer: «— **Ревью по типу артефакта:** читать `references/artifact-review.md` из каталога скилла maestro (канон).»

Существующая механика #95 (guard «одна модель», M3, fix-loop, SEC-3) — без изменений.

- [ ] **Step 3: `agents/reviewer.md` — раздел «Ревью по типу артефакта»**

Короткий раздел (5–8 строк), после «Твой фокус»: «Ревью ведётся по типу/набору типов и критериям, переданным в промпте диспатча (блок «Тип артефакта: …; Активные критерии: …», канон — `references/artifact-review.md`). Если блок не передан — тип `code`, критерии раздела «Твой фокус» (текущее поведение). Secret-scan (SEC-3) — для всех типов.» Self-contained сохранён (таблицы НЕ встраивать).

- [ ] **Step 4: `hitl-gate-protocol.md` — регистрация гейта D5**

В полный перечень гейтов добавить: «HITL: нетекстовые артефакты в дифе (D5, #107) — контентный; manual/auto-answer — HITL; auto-ai — решение ИИ с журналом (fallback (a))». Поведение по режимам — по главе.

- [ ] **Step 5: `spec-review.md` — строка в «Границах ревью»**

Одна строка: «Первое ревью шага 16 — параллельно только для типа `code` (#107, 4.16.0; канон — `references/artifact-review.md`)».

- [ ] **Step 6: сценарии детекта (детерминированная сверка)**

Таблица (в чат implementer'у, не в файлы): `*.md` → docs · `*.sql` → sql · `maestro.json` → config · `Dockerfile` → config · `*.test.json` в `tests/` → code · `LICENSE` → текстовый (не бинарный) · `foo.bin` → бинарный гейт · `docs/superpowers/specs/x.md` → вне детекта · смешанный → набор · пустой → code. Сверить каждое правило по тексту созданной главы.

- [ ] **Step 7: npm test**

Run: `npm test` → Expected: ≥264 pass / 0 fail (references-coverage: заголовок/«Канон:»/anti-orphan/указатели — зелёные; лимит скелета — не превышен).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(review): ревью по типу артефакта — глава канона + шаг 16 + промпт reviewer + гейт D5"
```

---

### Task 3: setup-шаблон + доки + AGENTS + roadmap + regression entry

**Files:**
- Modify: `skills/maestro-setup/init-context.md` (категория 9 — подсекция; категория 3 — слот миграций), `AGENTS.md` (список глав канона 10 → 11), `docs/project-context.md` (§8 — строка о процессе ревью; §9 — собственная подсекция критериев), `docs/roadmap.md` (#107 → выполнено, 4.16.0)
- Modify (manual_docs): `explanation/pipeline-overview.md` (шаг 16 по типам), `reference/hitl-gates.md` (гейт D5), `reference/config.md` (переопределение `review.parallel: always` для не-code), `explanation/project-context.md` (категории 3/9), `how-to/update-maestro.md` (строка миграции `agent.code-reviewer.model` → `agent.reviewer.model`), `overview/changelog.md` (секция 4.16.0)
- Create: `regression/entries/2026-09-30-review-by-artifact-type.md`

**Interfaces:**
- Consumes: T1 (имя `reviewer`), T2 (глава канона, гейт D5).
- Produces: sync-поверхность (критерий приёмки AGENTS.md), regression entry.

- [ ] **Step 1: `init-context.md`**

Категория 9 («Критерии приёмки качества»): подсекция «Критерии ревью по типу артефакта (опц.): для типов code/docs/config/sql — свои критерии шага 16; без указания — built-in-дефолты (канон скилла maestro `references/artifact-review.md`); пункт заменяет соответствующий built-in-пункт (по-пунктный merge)».
Категория 3 («Стек технологий»): опциональная строка «Миграции (каталоги): <пути>» (вход детекта `sql`).

- [ ] **Step 2: `AGENTS.md` — список глав канона**

В описании `skills/maestro/references/` добавить `artifact-review.md` (10 → 11 глав).

- [ ] **Step 3: `docs/project-context.md`**

§8: строка о процессе ревью (dogfooding-авторинг: «С 4.16.0 (#107): шаг 16 — по типу артефакта (code/docs/config/sql), канон `references/artifact-review.md`; agent `reviewer` (ex code-reviewer)»).
§9: собственная подсекция критериев для ≥1 типа (живая проверка override-пути; например, для `docs` — «указатели/ссылки в manual_docs резолвятся по имени файла»).

- [ ] **Step 4: `docs/roadmap.md`**

#107 (Волна 2, п.3) — пометка «**Выполнено (4.16.0, 2026-09-30)**» + ссылка на спеку.

- [ ] **Step 5: manual_docs**

- `explanation/pipeline-overview.md`: шаг 16 — тип артефакта, детект, критерии, параллельное только `code`, бинарный гейт.
- `reference/hitl-gates.md`: гейт D5 (контентный, режимы).
- `reference/config.md`: `review.parallel` — уточнение: применяется только к типу `code` (docs/config/sql — всегда одиночное, 4.16.0).
- `reference/model-selection.md`: строка — параллельное первое ревью шага 16 — только для типа `code` (4.16.0).
- `explanation/project-context.md`: категории 3 (слот миграций) и 9 (критерии по типу) — строки.
- `how-to/update-maestro.md`: строка «4.16.0: агент `code-reviewer` → `reviewer`; обновите `agent.code-reviewer.model` в merge-config и `by_agent` в `maestro.json`; stale-зеркало `.opencode/agents/code-reviewer.md` — скрипт очистит».
- `overview/changelog.md`: буллиты `[Unreleased]` (если есть) + секция `## [2026-09-30]` c `> **Версия 4.16.0** — …` (формат blockquote+bold как у существующих): ревью по типу артефакта (типы/детект/критерии/override), rename `code-reviewer` → `reviewer` + **migration note** (stale `agent.code-reviewer.model`), переопределение `review.parallel: always` для не-code.

- [ ] **Step 6: regression entry**

`regression/entries/2026-09-30-review-by-artifact-type.md`: риск LOW; сценарии детекта (таблица T2 Step 6); known follow-ups: расширение allowlist бинарных по реальным прогонам; dogfooding-факт (добавляется оркестратором после шага 16: анонс/диспатч/критерии).

- [ ] **Step 7: npm test + док-сверка**

Run: `npm test` → 0 fail. Ручно: `grep -rn "code-reviewer" manual_docs/ README.md AGENTS.md docs/project-context.md` → 0 (кроме migration-note-упоминаний нового вида «code-reviewer → reviewer» в changelog/update-maestro — допустимы как исторические).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "docs(review-by-type): init-context/AGENTS/project-context/roadmap/manual_docs/regression (4.16.0)"
```

---

## После SDD (оркестратор, не SDD-задачи)

- **Шаг 16 (dogfooding, основная верификация):** финальное ревью этой фичи по новым правилам — ожидается анонс «Тип артефакта: code+config+docs» (диф: md + json + *.sh; спека/план/changelog/regression вне детекта) + параллельный путь #95 (guard «одна модель» — по merge-config) + блок активных критерий в промптах. Факт → regression entry.
- **Гейт 17:** sweep `grep -rn "code-reviewer"` по живым поверхностям — 0 (кроме исторических и migration-notes).
- **Шаг 18:** merge + bump **4.16.0** (`package.json`, `package-lock.json`, `docs/project-context.md` §3) + push.
- **TODO.md** (строка 123) — отметка при merge.
- `[Manual]` после merge+push+`agpack sync`: перезапуск opencode (агент `reviewer`), `@test-agents` (проверка rename), прогон `@maestro-memory`-dogfood 4.15.0 (оставшийся).
