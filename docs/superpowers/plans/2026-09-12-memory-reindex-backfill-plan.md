# Memory Reindex & History Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HITL-инструмент `memory_reindex` + команда `@maestro-memory-reindex`: бэкфилл `artifacts[]` по старым записям (light-путь, 0 LLM) и синтез записей памяти из git-истории по спекам (LLM-summarize).

**Architecture:** новый модуль `memory/backfill.js` (три экспорта с инжекцией зависимостей: light-путь, git-перепись, синтез записи); инструмент регистрируется в `registerMemoryHooks` (паттерн `memory_prune`: list → снапшот → run); конфиг-ключ `memory.history_globs` (inherit `artifact_globs`); `indexer.js` и схема записей НЕ меняются (spec G4).

**Tech Stack:** ESM JavaScript, node:test (co-located), без сборки; git-хелперы `git.js`/`core.js` (`isAncestor`, `revList`, `confGlobMatch`).

**Spec:** `docs/superpowers/specs/2026-09-12-memory-reindex-backfill-design.md`

## Global Constraints

- 0 миграций схемы записей; 0 изменений `indexer.js` (spec G4).
- RI-3/RI-4: light-путь меняет только `artifacts`+`version`, не пишет в `state`, не трогает head/branch/merged/embedding/контент.
- RI-5: list и run(sessions) — 0 LLM-вызовов; run(git) — ≤N summarize + ≤N embed; cap `max` (default 20) на источник за вызов.
- RI-6: спека маскируется до summarize (raw-набор); LLM-вывод re-mask'ится (maskEntry) ДО embed и upsert; artifacts — resolved-набор + existsSync + repo-relative; кандидат под resolved confidential → `skip_confidential`; `author: "git-backfill"`.
- RI-7: идемпотентность — `already_indexed` / `no_change` (без upsert).
- RI-1: `session_id = "git-" + sha256(key + "|" + commitSha + "|" + specPath).slice(0,12)` (обновлено: key-review T4, 2026-09-12 — `key` = effectiveKey, локализация по namespace).
- Телеметрия — aggregates-only (SEC-4b); новые event-имена в whitelist.
- Docs — русский; канон `history_globs` идентичен в 3 местах (config.js ↔ maestro-assistant ↔ manual_docs/reference/memory.md).
- Тесты: `npm test` (плагиновый) и `npm run test:memory`; conventional commits.

---

## Task 1: Конфиг `history_globs`

Файлы: `plugins/maestro-bootstrap/memory/config.js`, `config.test.js`.

1. Failing-тесты (`config.test.js`):
   - `DEFAULTS.history_globs === null` (absent → inherit на use-site);
   - `resolveHistoryGlobs(config)`: absent/null → возвращает `config.artifact_globs` (fallback=false);
     валидный array → trim + unique (fallback=false); `[]` → `[]` (off);
     non-array (string/number) → `artifact_globs` + fallback=true;
     array с не-строками → `artifact_globs` + fallback=true; >16 элементов → fallback=true.
2. Реализация (`config.js`):
   - `DEFAULTS.history_globs = null`;
   - `export function resolveHistoryGlobs(config)` → `{ value: string[], fallback: boolean }`
     (логика валидации — как `artifactGlobsValid`, но без disabled-семантики:
     невалидное → inherit; spec §4.1, RI-8);
   - `mergedConfig`: `history_globs` нормализует trim + unique только если array,
     иначе сохраняет null.
3. Green: `npm run test:memory` (config-подмножество) + `npm test`.
4. Коммит: `feat(memory): add history_globs config (reindex backfill, 3.5.0)`.

## Task 2: Light-путь — `reindexSessionArtifacts`

Файлы: создаёт `plugins/maestro-bootstrap/memory/backfill.js`, `backfill.test.js`.

**Interfaces:**
- Consumes: `extractArtifacts` (artifacts.js), `maskEntry` (mask.js), `SESSIONS` (summarize.js), `storage.scan/get/upsert`.
- Produces: `export async function reindexSessionArtifacts(deps, sessionID)` →
  `{ status, artifacts }`; status enum: `updated | no_change | skip_no_record |
  skip_model_mismatch | skip_messages_unavailable | skip_no_embedding | skip_service`.
  deps: `{ client, storage, root, key, artifactGlobs, artifactConfidentialPatterns
  (resolved), confidentialPatterns (raw), embedModelId }`.

1. Failing-тесты (`backfill.test.js`, fake client/storage):
   - **updated**: извлекаемые пути + union с `existing.artifacts` (cap 8,
     case-insensitive, extracted-first); `maskEntry` перед upsert (stale-путь из
     existing, матчащий resolved-набор, дропается); сохранение embedding/
     model_id/head/branch/merged/title/summary/decisions/time_*; version =
     existing.version+1; upsert вызван 1 раз с корректной записью.
   - **no_change**: union case-insensitively равен existing → upsert НЕ вызван
     (spy).
   - skip-ветки: `skip_no_record` (scan пуст), `skip_model_mismatch`
     (model_id ≠ embedModelId), `skip_messages_unavailable` (client бросает),
     `skip_no_embedding` (embedding пустой), `skip_service` (sessionID ∈
     `SESSIONS` — добавить id в SESSIONS в тесте).
   - embedding из scan — Buffer → Float32Array (нормализация; сравнение по
     значениям).
2. Реализация (`backfill.js`): пайплайн spec §4.2.1 (шаги 1-9). Локальный
   хелпер `toF32` (Buffer/Uint8Array → `new Float32Array(buf.buffer,
   buf.byteOffset, buf.byteLength/4)`; Float32Array/Array — passthrough) —
   дублируется локально, без рефакторинга `index.js` (spec §4.2.1 п.2).
   Источник записи — `storage.scan({ key, fields: [session_id, head, branch,
   time_last, author, artifacts, model_id, embedding] })` (C1: `get` затирает
   embedding) + filter по session_id.
3. Green: `npm run test:memory` (backfill-подмножество) + `npm test`.
4. Коммит: `feat(memory): light-path artifacts backfill (reindexSessionArtifacts)`.

## Task 3: Git-история — `scanHistory` + `synthesizeGitEntry`

Файлы: `backfill.js`, `backfill.test.js`.

**Interfaces:**
- Produces:
  - `export function isPlanPath(p)` — basename `-plan.md` ИЛИ parent-каталог `plans`.
  - `export function gitFeatureSessionId(key, commitSha, specPath)` → RI-1 (обновлено: key-review T4, 2026-09-12).
  - `export async function scanHistory({ root, historyGlobs, git, mainline, records, artifactConfidentialPatterns })`
    → `{ features, considered, covered: { by_artifacts, not_in_git, skip_confidential, plan_excluded }, gitErrors }`;
    feature: `{ specPath, planPath|null, commitSha, branch, merged, title, timeFirst, timeLast, artifacts }`.
  - `export async function synthesizeGitEntry(deps, feature, llm)` →
    `{ status: "indexed" | "already_indexed", session_id }`; deps:
    `{ storage, root, key, projectHash, originRemote, embedModelId, embeddings,
    confidentialPatterns (raw), artifactConfidentialPatterns (resolved) }`;
    `llm = { summary, decisions }` (результат summarize, аргумент — не зависимость).
1. Failing-тесты:
   - `gitFeatureSessionId`: детерминированность; spec и plan одного коммита →
     разные ID; формат: `git-` + 12 hex (sha256-hex, `.slice(0,12)`).
   - `isPlanPath`: `docs/superpowers/plans/x-plan.md` → true; `docs/superpowers/specs/x-design.md` → false; legacy `specs/x-plan.md` → true.
   - `scanHistory` (fake git + tmp tree): glob-матчинг; plan-исключение из
     кандидатов (`plan_excluded` счётчик); **skip_confidential на resolved-наборе
     при ПУСТОМ user-`confidential.paths`** (default `docs/confidential/**`
     срабатывает) + builtin `*.env`; coverage by artifacts (record.artifacts
     содержит путь → covered, в features не входит); not_in_git (git log → []);
     plan-ассоциация конвенция (`specs/X-design.md` → `plans/X-plan.md`) и
     same-commit только plan-подобные; >1 plan-подобного в коммите →
     planPath=null; title из первой H1; merged по `isAncestor` (yes/no/null→0);
     time из `%ct` (×1000); git-сбой → fail-soft (gitErrors, features без фичи).
   - `synthesizeGitEntry`: `already_indexed` (storage.get по session_id —
     без upsert); форма записи (все поля, `author: "git-backfill"`,
     `version: 1`, `prefixes: prefixesOf(key)`, `merged` из feature);
     artifacts-фильтр (existsSync=false → дроп; resolved-матч → дроп; cap 8;
     dedup lowercase); **re-mask LLM-вывода до embed**: llm.summary с
     confidential-матчащей строкой (raw-набор) → embed-вызов получил
     ЗАМАСКИРОВАННЫЙ текст (спай embed-функции, сравнение входа);
     embed-вход = `title + "\n" + summary + "\n" + decisions.join("\n")`.
2. Реализация: алгоритмы spec §4.2.2-4.2.3. git-вызовы:
   `git log --diff-filter=A --format="%H %ct" --reverse -- <path>` (первая
   строка); ancestor-множества НЕ строятся (C2: coverage только по artifacts).
3. Green: `npm run test:memory` + `npm test`.
4. Коммит: `feat(memory): git-history scan + synthetic entry synthesis (backfill)`.

## Task 4: Инструмент `memory_reindex` + summarize `instructions`

Файлы: `plugins/maestro-bootstrap/memory/index.js` (`registerMemoryHooks`),
`index.test.js`, `summarize.js`, `summarize.test.js`.

**Interfaces:**
- Tool `memory_reindex` (permission: ask, description: «HITL-бэкфилл памяти:
  dry-run листинг на индексацию (sessions + git-история) → run по явным ID
  или всё по снапшоту, cap 20/вызов (permission: ask).»); args:
  `action: "list"|"run"`, `source: "sessions"|"git"` (run), `session_ids:
  string?`, `all_empty: boolean?`, `specs: string?` (repo-relative, запятая),
  `all: boolean?`, `max: number?` (default 20).
- `summarizeSession` — новый опциональный параметр `instructions` (string):
  дописывается в промпт ДО строки «Ответь строго JSON»; без параметра промпт
  побайтово неизменён.
1. Failing-тесты:
   - `summarize.test.js`: без `instructions` — промпт побайтово как сейчас
     (regression: фиксированная expected-строка начала/конца); с
     `instructions` — строка присутствует; в git-инструкциях — контракт
     `"title": ""`.
   - `index.test.js` (паттерн тестов memory_prune в этом файле):
     - list: секция A — кандидаты с пустыми artifacts + dry-run превью путей
       (0 LLM: summarize не вызван) + флаги `model_mismatch`/
       `messages_unavailable`; секция B — scanHistory + флаг
       `summarizer_model_missing` (конфиг null); снапшот создаётся.
     - run sessions: явные `session_ids` (снапшот не нужен); `all_empty` без
       снапшота → отказ-сообщение; cap `max`: при большем выборе берутся
       первые `max`, в ответе — пометка «cap»;
     - run git: явные `specs`; `all` по снапшоту; **hard guard** при
       `summarizer_model: null` → actionable-сообщение, 0 summarize;
       summarize-fail на одной фиче → skip с причиной, партия продолжается;
       `already_indexed` в агрегатах;
     - service-session guard (`SESSIONS.has(ctx.sessionID)`);
     - телеметрия: `memory:reindex.sessions` / `memory:reindex.git` —
       aggregates-only поля (selected/updated|indexed/no_change|
       already_indexed/skipped).
2. Реализация:
   - `index.js`: регистрация инструмента в `registerMemoryHooks` (рядом с
     `memory_prune`); снапшот — per-init переменная (перезапись каждым list,
     как `pruneSnapshot`); deps-сборка: resolved confidential-набор
     (`loadConfidentialConfig` → paths+builtin), raw-набор, `resolveHistoryGlobs`
     (Task 1) + warn `memory:config_fallback` при fallback (однократно при
     регистрации); git-инструкция для summarize: «текст — спецификация фичи, а
     не транскрипт сессии; извлеки summary (≤150 слов) и decisions (ключевые
     решения из секции решений/инвариантов); верни `"title": ""` — title задан
     отдельно и не извлекается».
   - `summarize.js`: параметр `instructions` (конкатенация до JSON-строки).
3. Green: `npm test` + `npm run test:memory`.
4. Коммит: `feat(memory): memory_reindex tool (list→run, sessions + git sources)`.

## Task 5: Команда `@maestro-memory-reindex`

Файлы: создаёт `commands/maestro-memory-reindex.md`.

1. Файл по структуре `commands/maestro-memory-prune.md` (frontmatter
   `description: HITL-бэкфилл памяти — список на индексацию (dry-run превью) →
   выбор → reindex/синтез`):
   - Шаг 1. Доступность (память включена — статус `@maestro-memory`; плагин жив).
   - Шаг 2. `memory_reindex` `action: "list"` → показать обе секции.
   - Шаг 3. HITL-выбор: источник (sessions/git/оба), объём (всё/подмножество/
     отмена); рекомендованный порядок: сначала sessions (light), затем git
     (trade-off дублей — spec §7).
   - Шаг 4. `action: "run"` по выбору (cap 20/вызов; при большем списке —
     сериями, HITL между сериями).
   - Шаг 5. Отчёт (агрегаты; без раскрытия содержимого записей — SEC-4b).
   - Язык сообщений — русский.
2. Проверка: frontmatter парсится (YAML), шаги ссылаются на реальные args
   инструмента (action/source/session_ids/all_empty/specs/all/max).
3. Коммит: `docs: add @maestro-memory-reindex command (HITL backfill)`.

## Task 6: Docs (маэстро-слой)

Файлы: `manual_docs/reference/memory.md`, `manual_docs/reference/config.md`,
`manual_docs/reference/commands.md` (если существует),
`manual_docs/overview/changelog.md`, `skills/maestro-assistant/SKILL.md`,
`commands/maestro-memory.md`, `AGENTS.md`, `SECURITY.md`,
`manual_docs/explanation/agents-and-trust.md`.

1. Правки (spec §4.5 + §4.6):
   - `memory.md`: ключ `history_globs` + инструмент `memory_reindex` + секция
     «Бэкфилл» (light vs git-история, cost-модель RI-5, краткие инварианты).
   - `config.md`: строка `history_globs` в таблице секции `memory`.
   - `commands.md`: команда (если страница существует — проверить).
   - `changelog.md`: запись **3.5.0** (reindex & history backfill).
   - `maestro-assistant/SKILL.md`: канон `history_globs` — inherit-семантика
     (null → `artifact_globs`), `[]` = off, ≤16 строк, невалидное → fallback +
     warn (память не отключается).
   - `commands/maestro-memory.md`: `history_globs` в таблице дефолтов
     (inherit-пометка) + `memory_reindex` в списке инструментов, если список есть.
   - `AGENTS.md`: строка memory-модуля — +3.5.0 (reindex & history backfill).
   - `SECURITY.md`: пункт Z3-adjacent (summarize спеки — LLM-вызов по
     репозиторному файлу; pre-mask + re-mask до записи + `skip_confidential`
     resolved-набором + маркер `git-backfill`; риск низкий — принято) +
     SEC-4b whitelist: `memory:reindex.sessions`, `memory:reindex.git`,
     `memory:config_fallback`.
   - `agents-and-trust.md`: mirror SECURITY.md-пункта (правило AGENTS.md).
2. Проверка: inherit-семантика идентична в 3 канонах (config.js-комментарий/
   `resolveHistoryGlobs`, maestro-assistant, memory.md); `git grep
   history_globs` — все места согласованы; changelog 3.5.0 присутствует.
3. Коммит: `docs: reindex & history backfill v3.5.0 — maestro layer`.

## Task 7: Версия 3.5.0

Файлы: `package.json` (корневой — единственный источник версии).

1. `package.json`: `3.4.0` → `3.5.0`.
2. Green: `npm test` (version-тест читает значение динамически) +
   `npm run test:memory`.
3. Коммит: `chore: bump version to 3.5.0 (memory reindex & history backfill)`.

Regression entry создаётся на план-гейте (шаг 12a, с коммитом spec+plan).

---

## Финальная верификация

1. `npm test` — 0 fail.
2. `npm run test:memory` — 0 fail.
3. Канон: inherit-семантика `history_globs` идентична в config.js ↔
   `skills/maestro-assistant/SKILL.md` ↔ `manual_docs/reference/memory.md`.
4. RI-проверка по диффу: `indexer.js` неизменён; схема БД неизменена;
   transform hook `undefined`; hooks try/catch-гардированы.
5. Diff-verification: `git diff --stat` против плана — только файлы планa.
