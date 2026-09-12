# Plan: artifact-links в memory layer (v5.2)

Spec: `docs/superpowers/specs/2026-09-11-memory-artifact-links-design.md`
(опрошена: verdict approve, подписи `maestro:sanitize` + `maestro:review`).

- Категория: архитектурная → SDD tier **Opus** (реализация).
- Ветка: `feature/memory-artifact-links` (создана, main @ ec503d8).
- Базовый зелёный: `npm test` 176 pass / `npm run test:memory` 496 pass (2 skip).
- Тесты: node:test, co-located (`*.test.js` рядом с модулем).
- Discipline: TDD — в каждом task сначала failing-тест, затем реализация.

## Переносные находки контрольного ревью (Minor, встроены в план)

- **CR-1**: в `manual_docs/reference/memory.md` — заметка B2 (remote-less репо /
  смена remote-URL → свои записи «чужого» origin → артефакты молча скрыты).
- **CR-2**: симметрия extract⇄import — на извлечении те же по-элементные
  ограничения, что на импорте: путь >512 символов или с control chars → skip
  (иначе органическая запись ломает собственный export→import round-trip, G4).
- **CR-3**: на импорте `artifacts` фильтруется локальным resolved
  confidential-набором (как на извлечении): матчащие элементы **отбрасываются**
  (drop, не reject — parity с extract-skip; reject всей записи не нужен).

## Task 1: Конфиг `artifact_globs`

Файлы: `plugins/maestro-bootstrap/memory/config.js`, `config.test.js`.

1. Failing-тесты (`config.test.js`):
   - default: без ключа → `config.artifact_globs` =
     `["docs/superpowers/specs/**", "docs/superpowers/plans/**"]`;
   - валидный список проходит gate; `[]` (off) валиден;
   - невалидные (не-массив, элемент не-строка, пустая строка) →
     `classifyMemoryConfig` → `disabled_reason: "artifact_globs_invalid"`;
   - `mergedConfig`: trim + dedup элементов.
2. Реализация (`config.js`, паттерн `similarityThresholdValid`):
   - `DEFAULTS.artifact_globs = ["docs/superpowers/specs/**", "docs/superpowers/plans/**"]`;
   - `function artifactGlobsValid(m)`: `m?.artifact_globs == null` → true;
     иначе `Array.isArray` && length ≤ 16 && каждый элемент — непустая строка;
   - `classifyMemoryConfig`: проверка в цепочке (рядом с `similarityThresholdValid`)
     → `disabled_reason: "artifact_globs_invalid"`;
   - `mergedConfig`: `artifact_globs` — trim + dedup
     (`[...new Set((m.artifact_globs ?? DEFAULTS.artifact_globs).map(s => s.trim()).filter(Boolean))]`).
3. Green: `npm run test:memory` (подмножество config) + `npm test`.

## Task 2: Извлечение — новый `memory/artifacts.js`

Файлы: `plugins/maestro-bootstrap/memory/artifacts.js` (новый),
`artifacts.test.js` (новый).

1. Failing-тесты (`artifacts.test.js`) — контракт §4.2:
   - write/edit часть со `status: "completed"` → путь извлечён;
   - write/edit `status: "error"`/`"pending"` → нет (M2);
   - `read`-часть → нет (D3);
   - absolute → repo-relative; `/var` vs `/private/var` (realpath кейс —
     tmpdir через symlink или фиксированный префикс);
   - путь не существует на момент извлечения (ENOENT) → skip пути,
     остальные извлекаются (I1);
   - путь вне root → skip; сегмент `..` → skip;
   - glob-miss → skip; case-insensitivity `confGlobMatch`;
   - resolved-набор confidential: путь `docs/confidential/x.md` при глобе
     `docs/**` → skip (в т.ч. default `docs/confidential/**` без секции
     + built-in `*.env` — I2);
   - CR-2: путь >512 символов / с control chars → skip;
   - dedup (first-seen); cap 8; пустые глобы → `[]`;
   - root недоступен → `[]` (без throw).
2. Реализация (`artifacts.js`):
   - `export function extractArtifacts(messages, { root, globs, confidentialPatterns })`;
   - шаг 1: части `part.type === "tool"`, `part.tool` ∈ {`write`,`edit`},
     `part.state?.status === "completed"`, путь — `part.state?.input?.filePath`
     (контракт `filePathOf`, core.js:789);
   - шаг 2: `realpathSync(root)` один раз на вызов (fail → `[]`); per-path
     `realpathSync` в try/catch (ENOENT → skip пути);
     `path.relative(rootReal, pathReal)`;
   - шаг 3 фильтры: вне root / `..`-сегмент → skip; glob-miss → skip
     (`confGlobMatch`, core.js:632); resolved confidential-матч → skip (Z4);
     CR-2: длина >512 / control chars → skip;
   - шаг 4: dedup first-seen, cap 8.
   - Invariants: без LLM; throw не покидает функцию.
3. Green: `npm run test:memory`.

## Task 3: Индексатор — проводка извлечения

Файлы: `plugins/maestro-bootstrap/memory/indexer.js`, `indexer.test.js`.

1. Failing-тесты (`indexer.test.js`):
   - `entry.artifacts` — из messages с tool-частями (fake storage);
   - re-summarize: union с `existing.artifacts` (D6, Z1); cap 8;
   - инварианты: tool-части НЕ в транскрипте саммаризатора (indexer.js:217-219
     остаётся text-only) и `artifacts` НЕ в embed-входе (indexer.js:287 —
     title+summary+decisions).
2. Реализация (`indexer.js`):
   - конструктор: новые параметры `artifactGlobs` (default `[]` → off-поведение:
     без извлечения), `artifactConfidentialPatterns` (resolved-набор; НЕ
     переиспользовать `confidentialPatterns` маскирования — I2);
   - в точке сборки entry (после fetch `existing`, ~:236):
     `entry.artifacts = [...new Set([...extracted, ...(existing?.artifacts ?? [])])].slice(0, 8)`;
   - `extracted = extractArtifacts(messages, { root: this.root, globs: this.artifactGlobs, confidentialPatterns: this.artifactConfidentialPatterns })`.
3. Green: `npm run test:memory`.

## Task 4: Storage: sqlite

Файлы: `plugins/maestro-bootstrap/memory/storage/sqlite.js`,
`storage/sqlite.test.js`.

1. Failing-тесты:
   - round-trip `artifacts` (upsert → get/search/scan);
   - malformed JSON в колонке → `[]`;
   - старая схема (колонки нет) → ALTER идемпотентен + default `[]`;
   - `migrateKey`: запись с артефактами → после пере-keying поле на месте;
     source-бакет без колонки → `[]` (I3, явный перенос в `toUpsert`).
2. Реализация:
   - `SCAN_FIELDS` (:117/119): + `"artifacts"`;
   - миграция (паттерн branch/head/host, :225-231): `PRAGMA table_info` →
     `ALTER TABLE memory ADD COLUMN artifacts TEXT NOT NULL DEFAULT '[]'`;
   - upsert: `JSON.stringify(entry.artifacts ?? [])`; чтение: `JSON.parse`
     try/catch fallback `[]` (паттерн `decisions`);
   - `migrateKey` (:747-766): явный перенос `artifacts` в `toUpsert`
     (`JSON.parse` try/catch `[]` из source-строки после ALTER; без колонки → `[]`).
3. Green: `npm run test:memory`.

## Task 5: Storage: pgvector

Файлы: `plugins/maestro-bootstrap/memory/storage/pgvector.js`,
`storage/pgvector.test.js`.

1. Failing-тесты: round-trip; malformed JSON → `[]`; старая схема →
   `ADD COLUMN IF NOT EXISTS` идемпотентна + default `[]`.
2. Реализация: `SCAN_FIELDS` (:7) + `"artifacts"`;
   `ALTER TABLE … ADD COLUMN IF NOT EXISTS artifacts TEXT NOT NULL DEFAULT '[]'`
   (паттерн :80-85); SQL-параметр в upsert (:159); колонка в SELECT-списках;
   parse fallback `[]`.
3. Green: `npm run test:memory`.

## Task 6: Storage: qdrant

Файлы: `plugins/maestro-bootstrap/memory/storage/qdrant.js`,
`storage/qdrant.test.js`.

1. Failing-тесты: round-trip `artifacts` в payload; malformed JSON → `[]`;
   scan/search/candidates/get — поле на месте.
2. Реализация: `SCAN_FIELDS` (:8) + `"artifacts"`; payload-поле `artifacts`
   (JSON-строка, как `decisions`); guard-парсинг на всех entry-construction
   сайтах (get/search/scan/candidates).
3. Green: `npm run test:memory`.

## Task 7: Доставка: recall-блок + tools + export/import + проводка

Файлы: `recall.js`, `recall.test.js`, `index.js`, `index.test.js`.

1. Failing-тесты:
   - `recall.test.js`: строка с `Артефакты:`; пустые `decisions` →
     ` | Артефакты: …` сразу после summary (без «Решения»); existsSync-фильтр
     (файл удалён → нет); чужой origin → нет (в т.ч. коллизионный: путь
     существует в текущем репо, запись чужая → не рендерится); свой origin +
     файл существует → строка.
   - `index.test.js`:
     - `memory_search` / `memory_recall_preview`: строка `Артефакты: …`
       (origin-фильтр, без fs-фильтра);
     - export round-trip: с полем и без (старые записи);
     - import: невалидный `artifacts` → reject (не-массив; элемент >512 /
       control chars; >8 элементов; не repo-relative: ведущий `/`,
       `..`-сегмент, backslash, drive-letter); отсутствует → `[]`;
     - CR-3: import-запись с `origin_project_hash === ownHash` и
       `key === effectiveKey` + артефакт, матчащий resolved confidential →
       элемент отброшен (drop, запись импортируется).
2. Реализация:
   - `recall.js`:
     - конструктор (:6): + `projectHash = null` → `this.projectHash`;
     - `systemBlock` (:138): сегменты независимы — базовая строка +
       ` | Решения: …` (при непустых decisions) + ` | Артефакты: p1; p2`
       (единый лейбл 1..N, при непустом отфильтрованном списке);
       фильтр: `h.entry.origin_project_hash === this.projectHash` (D4) →
       `existsSync(join(this.root, p))` (G3) → рендер.
   - `index.js` `registerMemoryHooks`:
     - resolved confidential-набор для артефактов (I2):
       `const conf = loadConfidentialConfig(maestroConfig);`
       `const artifactConfidentialPatterns = [...conf.paths, ...conf.builtin];`
       (NE raw `confidentialPaths` :699 — он для маскирования);
     - `Indexer` (:748): + `artifactGlobs: config.artifact_globs`,
       `artifactConfidentialPatterns`;
     - `Recall` (:788): + `projectHash: ownHash` (:488);
     - `memory_search` (:819) и `memory_recall_preview` (~:1184): в блоке хита
       строка `Артефакты: …` (raw, origin-фильтр `entry.origin_project_hash
       === ownHash`);
     - `memory_export` field-list (:1104-1112): + `artifacts` (B1);
     - `validateImportEntry` (:355): опциональное `artifacts` — массив строк,
       каждая ≤512 симв., без control chars, ≤8 элементов; reject записи при
       не-массиве/нарушениях; repo-relative форма: reject при ведущем `/`,
       `..`-сегменте, backslash, drive-letter; CR-3 — после валидации:
       drop элементов, матчащих resolved confidential-набор.
3. Green: `npm test` + `npm run test:memory`.

## Task 8: Версия плагина

Файл: `plugins/maestro-bootstrap/package.json` (3.3.3 → **3.4.0**).
Проверка: `npm test` (test на provision/version, если есть).

## Task 9: Маэстро-слой (skills/commands/docs)

Чек-лист (Z6 — канон не дрейфует: `DEFAULTS` ↔ `maestro-assistant` SKILL.md ↔
`manual_docs/reference/memory.md` — все три перечисляют тот же default):

1. `skills/maestro-assistant/SKILL.md` — inline-канон `memory`:
   `artifact_globs` (default маэстро-набор D2, `[]` = off, ≤16 строк,
   невалидный → память off `artifact_globs_invalid`, restart OP-1).
2. `skills/maestro-setup/SKILL.md` — упоминание ключа в задаче memory-секции.
3. `AGENTS.md` — строка описания memory-модуля: +v5.2 (artifact-links).
4. `SECURITY.md` — пункт «рассмотрено, принято» (Z3): prompt-injection через
   artifact-файл; инкрементальный риск низкий (файл в git, двухролевой,
   allowlist-глобы, framing-строка recall-блока).
5. `manual_docs/explanation/agents-and-trust.md` — mirror Z3-пункта
   (правило AGENTS.md).
6. `manual_docs/reference/memory.md` — ключ в справочнике + под-секция
   «Зачем» (память = индекс, спеки = источник истины; O(1) из recall-хита
   вместо O(N) glob-перебора; **акцент: эффект растёт с масштабом — для
   больших проектов с большой историей и числом спецификаций выигрыш
   максимален**) + **CR-1**: заметка B2 (remote-less / смена remote-URL →
   артефакты молча скрыты, graceful).
7. `manual_docs/reference/config.md` — строка `artifact_globs` в таблице
   ключей секции `memory`.
8. `manual_docs/how-to/enable-memory.md` — упоминание в аргументации
   «зачем включать» (тезис о больших проектах).
9. `commands/maestro-memory.md` — если статус печатает конфиг-ключи, +
   `artifact_globs`.
10. `manual_docs/overview/changelog.md` — запись 3.4.0 (v5.2 artifact-links).

Примечание: чтение/письмо `manual_docs/**` и `.opencode/**` под
access-policy `ask` — HITL-подтверждения на лету.

## Финальная верификация

1. `npm test` — 0 fail (база 176 + новые).
2. `npm run test:memory` — 0 fail (база 496 + новые).
3. Z6-чек: default `artifact_globs` идентичен в `DEFAULTS` (config.js),
   `maestro-assistant/SKILL.md`, `manual_docs/reference/memory.md`.
4. Regression-registry: запись в `regression/` (новая фича memory v5.2).
5. Diff-verification: `git diff --stat` по плану; нет случайных изменений
   (transform hook остаётся `undefined`; hooks try/catch-гардированы).
