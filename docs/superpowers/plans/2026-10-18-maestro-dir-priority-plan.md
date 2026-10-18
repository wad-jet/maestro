# Maestro dir-priority (6.1.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Свап приоритета проектных слоёв резолва `maestro.json`: `.maestro/maestro.json` (layer 2) выше корневого `maestro.json` (layer 3) — жёстко, без новых ключей конфига.

**Architecture:** Единственная логическая точка изменения — `resolveConfigFile` в `plugins/maestro-bootstrap/core.js` (порядок `candidates`-массива). `backup-cli.js` делегирует резолв в `core.js` — меняются только display-строки. Семантика «первый парсируемый слой» (fail-soft), `memory.*` soft-merge с global-базой и `MAESTRO_CONFIG`-override — без изменений. Остальные задачи — синхронизация живых документов, warn в `/maestro-setup` и детерминированная D9-проверка порядка в docs-drift.

**Tech Stack:** Node.js ESM (без зависимостей), Node built-in test runner, markdown-доки.

**Spec:** `docs/superpowers/specs/2026-10-18-maestro-dir-priority-design.md`

## Global Constraints

- **Язык:** весь user-facing текст (warn-строки, доки, комментарии в доках) — русский.
- **Без новых ключей конфига:** порядок слоёв хардкодится в резолвере (spec Q2).
- **Исторические документы НЕ трогаем:** `manual_docs/overview/changelog.md` (запись 6.0.0), `docs/superpowers/specs/**`, `docs/superpowers/plans/**` (кроме этого плана), `specs/**`, `TODO.md`, `docs/roadmap.md`. Старый порядок в них — осознанный снимок.
- **Версия 6.1.0 + changelog-запись** — шаг 18 пайплайна (пост-merge), **вне этого плана**.
- **Команды:** task-уровень `node --test plugins/maestro-bootstrap/index.test.js`; полный прогон `npm test` (plugin tests + docs-drift + coverage). known-red: `npm run test:memory` (100 pre-existing fails, summarize-mock drift) — НЕ регрессия.
- **D9 scope:** отрицательная часть D9 — строго whitelist из 8 файлов (набор spec §3.6-2); regex — строго три формы: цепочки `→`, цепочки `>`, нумерованные списки (не сканировать свободную прозу). Исторические файлы с цепочкой старого порядка не сканируются (whitelist-механика, не exclusion).
- **Commit style:** Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`) — как в истории ветки.

## Review Focus

1. **Оба проектных файла с конфликтующими `trust.*` ключами** → `.maestro/` выигрывает (источник trust-политики) — тест с trust-ключом в Task 1.
2. **Активный `.maestro/` без `memory.namespace`, в root есть** → `merged.memory.namespace === null` (память disabled, `namespace_missing`; без краха) — тест в Task 1.
3. **Сломанный JSON в `.maestro/`** → fail-soft fallback на root + warning (не падение плагина) — тест в Task 1.
4. **`MAESTRO_CONFIG` задан** → полный override, проектные слои не читаются (regression нетронутого механизма) — тест в Task 1.
5. **Дрейф цепочки старого порядка в живом доке** → D9 fails; цепочка старого порядка в историческом файле (changelog/roadmap) → D9 не срабатывает (whitelist) — fixture-тесты в Task 4.

---

### Task 1: Свап резолвера (`core.js`) + display-parity (`backup-cli.js`) + тесты (TDD)

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js` (блок-комментарий ~185–196, `resolveConfigFile` ~225–243, `isMaestroConfigPath` ~498–513)
- Modify: `plugins/maestro-bootstrap/memory/backup-cli.js` (HELP-текст ~57–58, комментарий ~219–221, `checked`-список ~225–229)
- Test: `plugins/maestro-bootstrap/index.test.js` (точки: ~2620/2623 header-комментарий, ~2680 «root beats .maestro and global», ~2734 «broken root JSON → .maestro», ~2769 header, ~2899 fallback `loadMaestroConfig`)

**Interfaces:**
- Produces: `resolveConfigFile(root, globalDir)` — поведение: первый парсируемый из `[".maestro/maestro.json", "maestro.json", "<globalDir>/maestro.json"]` (env — early return). Имя/сигнатура не меняются.

- [ ] **Step 1: Написать новые failing-тесты в `index.test.js`**

Тесты (стиль существующих блок-тестов резолва):
1. `both project files → .maestro/ wins (non-memory replace)`: tmp-dir с root `maestro.json` (`{"trust":{"by_agent":{}},"memory":{...}}` — отличающийся non-memory ключ, например `feedback_report: "auto"`) и `.maestro/maestro.json` (`feedback_report: "manual"`) → `loadMaestroConfig` → `feedback_report === "manual"`; активный путь = `.maestro/maestro.json`.
2. `trust keys from .maestro/ win`: root `trust.sanitizer: false`, `.maestro/` `trust.sanitizer: true` → merged `trust.sanitizer === true`.
3. `both files, different memory.namespace → .maestro/ wins`: root `memory.namespace: "a.b.c"`, `.maestro/` `memory.namespace: "x.y.z"` → merged `memory.namespace === "x.y.z"`.
4. `.maestro/` active без `memory.namespace`, в root есть → `merged.memory.namespace === null` (namespace — только из активного файла; без ошибки).
5. `broken .maestro/ JSON + valid root → root active + warning`: `.maestro/maestro.json` = `"{broken"` → активен root.
6. `both project broken + valid global → global active`: оба проектных `"{broken"` → активен global.
7. `MAESTRO_CONFIG set → full override, project layers not read`: env-путь на tmp-файл с уникальным ключом → merged из него; проектные файлы не влияют (regression).

- [ ] **Step 2: Запустить тесты — убедиться, что новые FAIL**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: новые тесты 1–4 FAIL (root пока выигрывает); 5–7 могут PASS/FAIL частично — главное: 1–4 красные.

- [ ] **Step 3: Обновить существующие тесты под новый порядок**

- ~2680: переименовать/переписать «root beats .maestro and global» → «.maestro/ beats root and global» (ассерт: активен `.maestro/`).
- ~2734: «broken root JSON → .maestro» → теперь `.maestro/` валидный — primary-хит (не fallback); если тест специально ломает root — инвертировать: ломать `.maestro/`, ждать root.
- ~2899 (fallback `loadMaestroConfig`): преамбула «fallback» устарела — результат `.maestro/` теперь primary-хит; переписать преамбулу/название.
- Header-комментарии ~2620/2769 — новый порядок слоёв.

- [ ] **Step 4: Свап в `core.js`**

- `resolveConfigFile` (~230–234): `candidates` = `[path.join(root, ".maestro", "maestro.json"), path.join(root, "maestro.json"), path.join(globalDir ?? resolveGlobalDir(), "maestro.json")]`.
- Блок-комментарий ~187–191: новый порядок слоёв с подписями: 2 — «локальные дополнения (вне git; более специфичный — приоритетнее, аналогия `.opencode/` > корневой конфиг)», 3 — «командная фиксация (в git)».
- `isMaestroConfigPath` (~498–513): порядок `candidates`-массива + комментарий «MAESTRO_CONFIG > .maestro > root > global» (поведение не меняется — membership-проверка).
- `loadMaestroConfig` — не менять.

- [ ] **Step 5: Display-parity `backup-cli.js`**

Новый порядок в: HELP-тексте (~57–58), комментарии (~219–221) и `checked`-списке error «не найден ни в одном слое» (~225–229): `MAESTRO_CONFIG (env) > <root>/.maestro/maestro.json > <root>/maestro.json > <global>/maestro.json`.

- [ ] **Step 6: Запустить тесты — все зелёные**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS (новые + обновлённые + весь остальной набор).

- [ ] **Step 7: V7-smoke (ручной)**

Запустить `node plugins/maestro-bootstrap/memory/backup-cli.js --help` (или dry-run без конфигов в пустом tmp-каталоге) — в выводе порядок слоёв новый.

- [ ] **Step 8: Commit**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/memory/backup-cli.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat(plugin): .maestro/maestro.json above root in 4-layer resolution (6.1.0)"
```

---

### Task 2: Warn в `/maestro-setup` (project-режим) + формулировка namespace

**Files:**
- Modify: `skills/maestro-setup/SKILL.md` (~124 — формулировка namespace; проект-режим — добавить warn-шаг перед записью root конфига)

**Interfaces:**
- Produces: текст warn-строки (канон):
  > `⚠ .maestro/maestro.json существует — имеет приоритет над root (с 6.1.0): non-memory ключи (включая trust/confidential/sanitizer_whitelist) и memory.namespace берутся из него. Если в .maestro/ нет memory.namespace, а в root есть — память будет выключена (reason: namespace_missing).`

- [ ] **Step 1: Изменить формулировку namespace (~124)**

«Если namespace уже задан в `root/maestro.json` — не перезаписывает» → «Если namespace уже задан явно в любом проектном слое (`.maestro/maestro.json` или root) — не перезаписывает».

- [ ] **Step 2: Добавить warn-шаг в project-режим**

В секцию project-режима (создание root `maestro.json`) — шаг: перед записью root конфига проверить существование `<root>/.maestro/maestro.json`; если существует — вывести warn-строку из Interfaces (не блокирует, далее по setup как есть).

- [ ] **Step 3: Проверка**

Run: `grep -n "имеет приоритет над root" skills/maestro-setup/SKILL.md`
Expected: 1+ совпадений с warn-текстом; таблица режимов (root vs .maestro/ — место записи) без изменений.

- [ ] **Step 4: Commit**

```bash
git add skills/maestro-setup/SKILL.md
git commit -m "feat(skills): /maestro-setup warn on existing .maestro/maestro.json (6.1.0)"
```

---

### Task 3: Синхронизация 7 живых документов

**Files:**
- Modify: `manual_docs/reference/config.md` (таблица ~17–28, блок «порядок 2 → 3 → 4» ~24–28, таблица путей ~950–952)
- Modify: `manual_docs/explanation/agents-and-trust.md` (таблица ~70–72, «root выигрывает» ~75, trust-семантика ~105–106, «слой 3» ~113)
- Modify: `skills/maestro/SKILL.md` (Gate 0 ~10–15)
- Modify: `plugins/maestro-bootstrap/README.md` (нумерованный список ~190–196, перечисление ~558–559)
- Modify: `manual_docs/explanation/plain-language.md` (цепочка ~16)
- Modify: `manual_docs/how-to/memory-backup-restore.md` (цепочка ~99–102)
- Modify: `manual_docs/how-to/customize-maestro.md` (цепочка ~24–27)

**Interfaces:**
- Consumes: новый порядок слоёв (Task 1): 2 = `.maestro/maestro.json` (вне git, более специфичный — приоритетнее), 3 = root `maestro.json` (в git). Номера слоёв 2/3 сохраняются; меняется только их содержимое/места в цепочках.

- [ ] **Step 1: `config.md`**

Таблица 4 слоёв: строка 2 = `Проектный (локальный) | <project>/.maestro/maestro.json | вне git (.maestro/ в .gitignore) — более специфичный, приоритетнее (аналогия .opencode/ > корневой)`, строка 3 = `Проектный (командный) | <project>/maestro.json | в git — командная фиксация`. Блок «Активный файл = ПЕРВЫЙ ПАРСИРУЕМЫЙ слой (порядок 2 → 3 → 4)» — без изменений (номера). Таблица путей (~950–952): перенумерация (`.maestro/maestro.json` → слой 2; root `maestro.json` → слой 3).

- [ ] **Step 2: `agents-and-trust.md`**

- Таблица слоёв (~70–72): строки 2/3 — свап (как в config.md).
- ~75 «root выигрывает» → «`.maestro/` выигрывает (если существует)».
- ~105–106: «Проектный слой (root `maestro.json`) коммитится в git — trust-level policy проекта» → переформулировать: источник эффективной trust-политики — активный проектный слой; с 6.1.0 это `.maestro/maestro.json` (вне git), если существует, иначе root (в git); коммит в git — больше не фактор приоритета.
- ~113: «`.maestro/maestro.json` — слой 3» → «слой 2».

- [ ] **Step 3: `skills/maestro/SKILL.md` Gate 0 (~10–15)**

Цепочка: `<root>/.maestro/maestro.json` (не в git, более специфичный) → `<root>/maestro.json` (в git, командная фиксация) → глобальный → `MAESTRO_CONFIG` env (без изменений, debug-override).

- [ ] **Step 4: `plugins/maestro-bootstrap/README.md`**

Нумерованный список «Разрешение конфигов» (~190–196): пункты 2/3 — свап (2 = `.maestro/`, 3 = root) с новыми подписями. Перечисление (~558–559): «(`<project>/.maestro/maestro.json`, `<project>/maestro.json`) имеют приоритет».

- [ ] **Step 5: `plain-language.md` (~16)**

Цепочка активного файла: «`.maestro/` → root → global» (старое: «root → .maestro/ → global»).

- [ ] **Step 6: `memory-backup-restore.md` (~99–102)**

Цепочка: `MAESTRO_CONFIG` env > `<root>/.maestro/maestro.json` > `<root>/maestro.json` > глобальный.

- [ ] **Step 7: `customize-maestro.md` (~24–27)**

Цепочка 4 слоёв: `MAESTRO_CONFIG` env (debug-only) → `<project>/.maestro/maestro.json` (вне git) → `<project>/maestro.json` (в git) → глобальный.

- [ ] **Step 8: Проверка + commit**

Run: `grep -rn "root/maestro.json.*→.*\.maestro\|root.*maestro.json.*>.*\.maestro" manual_docs/ skills/maestro/SKILL.md plugins/maestro-bootstrap/README.md || echo CLEAN`
Expected: `CLEAN` (цепочек старого порядка в живых доках нет).

```bash
git add manual_docs/reference/config.md manual_docs/explanation/agents-and-trust.md manual_docs/explanation/plain-language.md manual_docs/how-to/memory-backup-restore.md manual_docs/how-to/customize-maestro.md skills/maestro/SKILL.md plugins/maestro-bootstrap/README.md
git commit -m "docs: layer order .maestro/ above root across live docs (6.1.0)"
```

---

### Task 4: D9-проверка docs-drift (порядок слоёв) + fixture self-тесты

**Files:**
- Modify: `maestro-install/docs-drift.test.mjs` (новая проверка D9 после D8; fixture-блок — по прецеденту D6–D8 ~661–727)

**Interfaces:**
- Consumes: Task 3 (живые доки уже в новом порядке — live-прогон D9 должен быть зелёным).
- Produces: D9 в `npm test`: drift порядка = failing test.

- [ ] **Step 1: Fixture self-тесты (TDD)**

По прецеденту D6–D8 (fixture-блок): кейсы —
1. Таблица с верным порядком (слой 2 = `.maestro/`, слой 3 = root) → PASS.
2. Таблица с неверным порядком (root = слой 2) → FAIL.
3. Цепочка старого порядка в «живом» доке (whitelist-файл) → FAIL.
4. Цепочка старого порядка в «историческом» файле (не в whitelist, например changelog) → PASS (не сканируется).

- [ ] **Step 2: Реализация D9**

1. **Положительная** (таблицы): в `manual_docs/reference/config.md` и `manual_docs/explanation/agents-and-trust.md` — строка слоя 2 таблицы 4 слоёв содержит `.maestro/maestro.json`; строка слоя 3 — корневой `maestro.json` (без префикса `.maestro/`).
2. **Отрицательная** (проза): whitelist из 8 файлов (набор spec §3.6-2: config.md, agents-and-trust.md, plain-language.md, customize-maestro.md, memory-backup-restore.md, plugins/maestro-bootstrap/README.md, skills/maestro/SKILL.md, skills/maestro-setup/SKILL.md). Паттерны — строго три формы: цепочка `→` с root-слоем ПЕРЕД `.maestro/`-слоем; цепочка `>` с тем же; нумерованный список с root-пунктом перед `.maestro/`-пунктом. Свободная проза и непрайоритетные перечисления (например, таблица режимов в maestro-setup — место записи) не сканируются.

- [ ] **Step 3: Запустить `npm test`**

Run: `npm test`
Expected: PASS (plugin tests + docs-drift (включая D9 + self-тесты) + coverage). known-red `test:memory` — не запускать/игнорировать (pre-existing).

- [ ] **Step 4: Commit**

```bash
git add maestro-install/docs-drift.test.mjs
git commit -m "test(docs-drift): D9 layer-order check with fixture self-tests (6.1.0)"
```

---

## Spec Coverage Matrix

| Spec | Task |
|---|---|
| Q1 (диапазон свапа: только проектные слои) | T1 (Step 4) |
| Q2 (жёстко, без ключей) | T1 (Step 4) |
| Q3 (parse-error fallback, новый порядок warning-ов) | T1 (Step 1: 5/6, Step 4) |
| Q4 (memory soft-merge без изменений; namespace — активный) | T1 (Step 1: 3/4 — regression) |
| Q5 (warn в setup + формулировка namespace) | T2 |
| Q6 (D9) | T4 |
| Q7 (версия 6.1.0) | шаг 18 пайплайна (вне плана) |
| §3.1 (core.js: resolveConfigFile + isMaestroConfigPath + комментарий) | T1 (Step 4) |
| §3.2 (backup-cli display) | T1 (Step 5) |
| §3.3 (тесты 1–7 + обновление существующих) | T1 (Step 1–3) |
| §3.4 (warn + namespace в maestro-setup) | T2 |
| §3.5 (7 живых доков; maestro-setup — в T2) | T3 (Step 1–7) |
| §3.6 (D9: positive + negative + fixtures) | T4 |
| §5 V1–V5 | T1 (Step 1) |
| §5 V6 (паритет core/backup-cli) | T1 (Step 5) + Task-review |
| §5 V7 (CLI smoke) | T1 (Step 7) |
| §5 V8 (8 живых доков + D9) | T3 + T4 |
| §5 V9 (npm test green) | T4 (Step 3) |
| §5 V10 (setup warn, manual) | T2 (Step 3) + final checks (шаг 15) |
| §6 (риски: trust-инверсия, memory-bucket) | T1 (Step 1: 2/3/4 — поведенческие тесты), T2 (warn), changelog — шаг 18 |

**Regression-риски плана:** миграция БД — нет; public API — нет; breaking в release-смысле — нет (minor, задокументировано). Regression-реестр: вход не требуется (по P-матрице: нет миграции/breaking/public API).
