# Спека: наблюдаемость плагина (P2.6)

- **Дата:** 2026-09-18
- **Ветка:** `feature/plugin-observability`
- **Категория:** Сложная фича (полный pipeline), 7+ файлов, cross-layer (плагин + команды + тесты + доки)
- **Источник:** Волна P2.6 (ретроспектива `.maestro/feedback-reports`): отчёт 09-09 (адаптер терял хуки 3 недели, найдено случайно; fail-soft ветка не покрыта тестом; memory-report врал «память выключена»), 09-07 (E2E-долги), наблюдение 09-18 (runtime 4.1.0 vs repo 4.2.0 — рассинхрон версий после бампа).

## 1. Проблема

Три класса дефектов наблюдаемости плагина `maestro-bootstrap`:

1. **Потеря форвардинга хуков (09-09, 3 недели):** адаптер `index.js` (commit c9e558e)
   возвращал opencode только `{config, event, startup, dispose}`, выбрасывая `tool`
   (memory-инструменты), `tool.execute.before/after` (sanitizer/confidential),
   `chat.message` + `experimental.chat.system.transform` (auto_recall). Защита и память
   молча не работали. Найдено случайно. Существующий форвардинг-тест (L2099) проверяет
   7 ключей вручную и **пропускает** `chat.message` + `experimental.chat.system.transform`
   (проверено: core.js:1094-1096 их выставляет) — новый core-хук может потеряться
   незамеченным. Fail-soft ветка (init-сбой → минимальный каркас) — без теста.
2. **Команды врут при недоступном плагине (09-09):** `@maestro-memory-report` и
   `@maestro-memory` при недоступном `memory_stats_detail` выводят «Память выключена»
   (неверно для включённой памяти). Fallback на прямое чтение sqlite не формализован
   (делалось руками).
3. **Рассинхрон версий (наблюдение 09-18):** runtime-версия плагина (из init-лога) может
   отставать от версии репо (кэш плагина не обновляется до рестарта). Гейт 0 проверяет
   только свежесть init, не версию. Пользователь видит старую версию без предупреждения.

## 2. Решение

### A. Тест адаптера (форвардинг + fail-soft)

**Исследование (09-18):** вся init-цепочка плагина fail-soft (makeLogger/loadMaestroConfig/
writePluginVersionFile/readPluginVersion/memory-import — все в try/catch). Реальный сбой
init (битый конфиг, недоступная папка) невозможен — catch-ветка в `index.js` почти
недостижима. `mock.module` (node:test) доступен только с экспериментальным флагом
`--experimental-test-module-mocks` — отвергнут (хрупко, требует смены TEST_COMMAND).

**Решение — рефакторинг адаптера в core.js + два теста:**

1. **`core.js`: вынести адаптер-логику** в named export `createBootstrapAdapter(factory)`:
   принимает фабрику (`async (input) => hooks`), возвращает **функцию** `(input) => hooks`.
   Внутри — **мемоизация успешного init + retry после сбоя** (сбой → hooks остаётся null,
   каркас НЕ кэшируется; следующая инвокация повторяет init) — эквивалент текущего
   `_mbHooks` в index.js. **Логирование сбоя init сохраняется** (console.error
   «[maestro-bootstrap] init failed: …» — I2-guard против тихого fail-open, эквивалент
   index.js:40). `index.js` — тонкий, только default export:
   ```js
   import { createBootstrapAdapter } from "./core.js";
   const adapter = createBootstrapAdapter(async (input) => MaestroBootstrapPlugin({
     directory: process.cwd(), client: input?.client,
   }));
   export default adapter;
   ```
   Адаптер создаётся **один раз на уровне модуля** (мемо сохраняется между инвокациями),
   фабрика принимает `input`. Ограничение «index.js — только default export» сохраняется.
   **Override config/startup — условный:** `config: async () => ({})`, а `startup` —
   `hooks.startup ?? noop` (не глушить будущий core-startup-хук). Возвращаемая адаптер-
   функция — async (как текущий default export).
2. **Тест fail-soft:** `createBootstrapAdapter(async () => { throw new Error("boom") })()`
   → каркас `{config, event, startup, dispose}` (все — функции); второй вызов повторяет
   init (не кэширует каркас).
3. **Тест полного форвардинга (на реальных core-хуках):** temp-dir + `MaestroBootstrapPlugin`
   напрямую (как сейчас L2099), результат через `createBootstrapAdapter` → набор ключей
   результата ⊇ набор ключей core-плагина (кроме override config/startup). Это ловит
   потерю `chat.message`/`experimental.chat.system.transform`/любого нового хука.
   Плюс stub-тест (`() => coreHooks`) пиннит spread-механику (ловит регрессию «явное
   перечисление ключей»).

### B. Fallback в `@maestro-memory-report` (прямое чтение sqlite)

**Исследование (09-18):** схема sqlite (`memory`: session_id, key, title, summary,
decisions, artifacts, embedding, author, time_first/last, branch, head, merged, ...).
Прямой reading через node + `better-sqlite3` из **module_dir** (self-provisioned:
`<data-dir>/maestro/memory/module/node_modules`) даёт: записи/авторы/даты/ветки/merged
(SQL GROUP BY) + head-узлы (GROUP BY head). НЕ даёт: кластеры/темы/граф рёбер (нужны
embeddings+cosine), тиры experience/dead (нужна git-логика).

**Решение:** в шаг 1 команды `@maestro-memory-report`:
- **Ветвление по `maestro.json`:** команда читает конфиг на шаге 2 — перенести чтение
  `memory.enabled`/`storage.type`/`disabled_reason` в шаг 1:
  - `memory.enabled: false` → текущее «Память выключена» (честно, fallback не запускать);
  - `enabled: true`, конфиг-невалиден (`disabled_reason` — namespace_missing,
    embedding_api_key_env_missing и т.п., tool не регистрируется) → своя честная
    формулировка по `disabled_reason` (классификация из `@maestro-memory` шаг 1.2),
    НЕ «перезапустите opencode» (рестарт не поможет — конфиг надо чинить);
  - `enabled: true` + `memory_stats_detail` недоступен + `storage.type: sqlite` →
    **fallback** на прямое чтение sqlite;
  - `enabled: true` + tool недоступен + qdrant/pgvector → честное «Плагин недоступен;
    бэкенд централизованный — fallback невозможен; перезапустите opencode».
- **Резолвинг БД:** не дублировать логику `resolveEffectiveKey`/`sanitizeDirName` — через
  **provisioned-код из module_dir**. **Механика загрузки (важно):** module_dir — ESM
  (`"type": "module"`), а better-sqlite3 — CJS. `createRequire(join(moduleDir,"package.json"))`
  — **только** для better-sqlite3 (CJS-зависимость, паттерн memory/index.js:441-444);
  ESM-файлы (`config.js` — resolveEffectiveKey/sanitizeDirName, `project.js` —
  deriveProjectKey) — через dynamic `import()`; `require()` ESM даст ERR_REQUIRE_ESM.
  `defaultDataDir()` не импортируется из module_dir (копия memory/index.js в module_dir
  есть, но её `import "../core.js"` не резолвится — копия неимпортируема): вычислить
  `<data-dir>` из XDG/`~/Library/Application Support` (3 строки) или перенести экспорт
  в config.js в рамках этой фичи. Открыть БД **readonly** (`better-sqlite3`
  `{readonly: true}`); учесть `memory.module_dir` override.
- **Упрощённый HTML-отчёт** + плашка «Плагин недоступен — отчёт упрощён (без
  кластеров/графа/тиров); перезапустите opencode».
- **Degrade-пути fallback:** БД-файл отсутствует (ENOENT) → «нет данных / память пуста»;
  readonly-open сбой на **существующей** БД (WAL recovery после жёсткого kill — readonly
  не может восстановить) → честное «не удалось открыть БД (readonly)», НЕ «память пуста»;
  better-sqlite3 не установлен в module_dir → честное «недоступно», без падения.
- **SEC-4b:** fallback всегда aggregates-only; title/summary/decisions НЕ выбираются из
  SQL; `include_text` в fallback не поддерживается (всегда false).
- **Bash-чтение maestro.json в шаге 1** (нативный deny-ит read-тул) — перенести вместе
  с чтением конфига из шага 2.

### C. Smoke-чеклист + warn в Гейте 0

1. **`manual_docs/how-to/update-maestro.md`:** smoke-чеклист после обновления: (1) версия
   в init-логе = версия из кэша плагина; (2) memory-инструмент доступен (`@maestro-memory`);
   (3) `@maestro-memory-report` собирает отчёт; порядок rollout (push → кэш → рестарт) —
   закрепить.
2. **`skills/maestro/SKILL.md` Гейт 0:** **warn (не STOP)** при рассинхроне версий.
   **Компаратор (важно для целевых приложений):** НЕ корневой package.json маэстро (его там
   нет) — сравнивать `"version"` из init-лога с `package.json` из **кэша плагина**.
   **Lookup-рецепт (нормализация пути, эмпирически проверен):** реальный кэш —
   `~/.cache/opencode/packages/maestro-bootstrap@git+https:/github.com/wad-jet/maestro.git/`
   (первый сегмент — `maestro-bootstrap@git+https:`; внутри `github.com/wad-jet/maestro.git/`).
   `package.json` в корне иерархии — **синтетический манифест opencode** без поля `version`;
   реальный источник версии — `…/maestro.git/node_modules/maestro-bootstrap/package.json`
   (его же читает `readPluginVersion()` runtime). **Рецепт:** glob
   `~/.cache/opencode/packages/maestro-bootstrap@git+*/github.com/wad-jet/maestro.git/
   node_modules/maestro-bootstrap/package.json` (или рекурсивный поиск файла, где есть
   `version` и `main` = `plugins/maestro-bootstrap/index.js`). Сравнение — **semver-
   осознанное** (не строковое: «4.10.0» vs «4.9.0»); нераспарсиваемая версия → молча.
   Если кэш/файл не найден (в т.ч. `#sha`-pin) или runtime **новее** кэша — **молча
   пропустить warn**, не выдумывать источник. Warn-текст:
   «версия плагина (A) отстаёт от кэша (B) — runtime-правки не активны до перезапуска».
   После warn — продолжить (не блокировать). Граница: warn срабатывает только когда
   локальный кэш опережает загруженный runtime; сценарий «runtime vs repo» при устаревшем
   кэше локально не детектируем (нужна сеть — правильно исключено), остаётся на
   smoke-чеклисте.
   Гейт 0 STOP для случая «нет init-строки» — сохраняется.

## 3. Изменения

### 3.1. `plugins/maestro-bootstrap/core.js`
- Добавить `createBootstrapAdapter(factory)` (named export): мемо init + retry после сбоя +
  fail-soft каркас + spread + config/startup override. Адаптер-логика из index.js.

### 3.2. `plugins/maestro-bootstrap/index.js`
- Стать тонким: `const adapter = createBootstrapAdapter(factory); export default adapter;`
  (адаптер — один на модуль, мемо сохраняется). Только default export (constraint).

### 3.3. `plugins/maestro-bootstrap/index.test.js`
- Тест fail-soft (throwing factory → каркас; второй вызов повторяет init).
- Тест полного форвардинга на реальных core-хуках (temp-dir) + stub-тест (spread-механика).
- Существующий тест L2099: дополнить сверкой наборов ключей (вкл. chat.message/
  experimental.chat.system.transform).

### 3.4. `commands/maestro-memory-report.md`
- Шаг 1: ветвление по maestro.json (enabled / storage.type); fallback sqlite (readonly,
  через module_dir) + упрощённый HTML + плашка; qdrant/pgvector — честное «недоступно».
- SEC-4b: aggregates-only всегда; include_text не поддерживается в fallback.

### 3.5. `commands/maestro-memory.md`
- I-4: шаг 1.2 — различать «память выключена» (enabled: false) vs «плагин недоступен»
  (enabled: true + tool недоступен → «перезапустите opencode») vs «конфиг-невалиден»
  (disabled_reason → классификация из шага 1.2 @maestro-memory). Проверить sibling-команды
  (`@maestro-memory-reindex`, `@maestro-memory-prune` — делегируют формулировку
  `@maestro-memory`, правка транзитивна) на ту же формулировку.

### 3.6. `manual_docs/how-to/update-maestro.md`
- Smoke-чеклист после обновления (3 пункта) + порядок rollout. **Обновить Шаг 3 документа:**
  «Сверьте с ожидаемой версией из package.json» → «с версией из кэша плагина
  (node_modules/maestro-bootstrap/package.json)» — иначе док противоречит §2.C.

### 3.7. `skills/maestro/SKILL.md`
- Гейт 0: warn (не STOP) при рассинхроне версий (компаратор — кэш плагина).

### 3.8. Синк (AGENTS.md)
- `manual_docs/reference/commands.md` — `@maestro-memory-report` (новый fallback-путь) и
  `@maestro-memory` (новое ветвление).
- `manual_docs/explanation/agents-and-trust.md` — Гейт 0: warn при рассинхроне версий.
- `manual_docs/reference/config.md` — Гейт 0-проверка; поля init-строки (version).
- `manual_docs/reference/memory.md` — при дублировании формулировок команд (L670).
- `plugins/maestro-bootstrap/README.md` — адаптер теперь в core.js (createBootstrapAdapter);
  init-лог/Gate-0-проверка.
- `manual_docs/explanation/pipeline-overview.md` — при необходимости.
- `manual_docs/overview/changelog.md` — запись P2.6.

### 3.9. `specs/*` — НЕ трогаем (исторический архив).

## 4. Критерии приёмки

1. `node --test plugins/maestro-bootstrap/index.test.js` — зелёный (171 + ~4 новых = 175,
   фактический счётчик сверить при реализации); форвардинг-тест ловит потерю ключа
   (проверка: удалить ключ из spread → тест падает); тест покрывает
   chat.message/experimental.chat.system.transform.
2. Fail-soft тест: throwing factory → каркас; повторный вызов повторяет init (мемо сбоя нет);
   index.js — только default export, адаптер один на модуль.
3. `@maestro-memory-report`: (а) enabled:false → «Память выключена»; (б) enabled+sqlite+tool
   недоступен → упрощённый HTML с плашкой; (в) enabled+qdrant/pgvector+tool недоступен →
   честное «недоступно»; (г) enabled+конфиг-невалиден (disabled_reason) → классификация,
   не «перезапустите». НЕ «память выключена» для (б)/(в)/(г).
   **Рецепт симуляции «tool недоступен при enabled:true»:** открыть opencode с
   memory.enabled:true, но плагин не загружен (сессия без плагина, module_dir цел) — для
   fallback-ветки (б); отдельно — удалить/сломать better-sqlite3 в module_dir → тест
   degrade-пути «недоступно» (не «упрощённый HTML»).
4. `@maestro-memory`: различает «выключена» vs «плагин недоступен».
5. Гейт 0: при рассинхроне (init-версия vs кэш) — warn, не STOP; кэш не найден → молча.
6. update-maestro.md содержит smoke-чеклист; manual_docs синхронизированы (по §3.8).
7. Changelog — запись P2.6.

## 5. Regression

- Рефакторинг адаптера (createBootstrapAdapter) — поведение index.js не меняется (тот же
  мемо+retry+spread+override), мемо сохраняется; риск — нарушение constraint «только default
  export» → проверяется тестом/загрузкой. Regression entry: LOW.
- Fallback в memory-report — только дополнение (новый путь при недоступности tool);
  существующий путь не меняется. LOW.
- Гейт 0 warn — не блокирует, только предупреждает; STOP для «нет init» сохраняется. LOW.
- @maestro-memory: честное «плагин недоступен» вместо ложного «выключена» — улучшение. LOW.
<!-- maestro:review
reviewer: opus
date: 2026-09-18
verdict: approve
hash: 7c2ad1f19fd766a8fb781181a1b2ae3beaa92c1f01e53034c6217ecc9c40aab1
-->
