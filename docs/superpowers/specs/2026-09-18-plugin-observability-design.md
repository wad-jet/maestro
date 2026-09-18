# Спека: наблюдаемость плагина (P2.6)

- **Дата:** 2026-09-18
- **Ветка:** `feature/plugin-observability`
- **Категория:** Сложная фича (полный pipeline), 6+ файлов, cross-layer (плагин + команды + тесты + доки)
- **Источник:** Волна P2.6 (ретроспектива `.maestro/feedback-reports`): отчёт 09-09 (адаптер терял хуки 3 недели, найдено случайно; fail-soft ветка не покрыта тестом; memory-report врал «память выключена»), 09-07 (E2E-долги), наблюдение 09-18 (runtime 4.1.0 vs repo 4.2.0 — рассинхрон версий после бампа).

## 1. Проблема

Три класса дефектов наблюдаемости плагина `maestro-bootstrap`:

1. **Потеря форвардинга хуков (09-09, 3 недели):** адаптер `index.js` (commit c9e558e)
   возвращал opencode только `{config, event, startup, dispose}`, выбрасывая `tool`
   (memory-инструменты), `tool.execute.before/after` (sanitizer/confidential),
   `chat.message` + `experimental.chat.system.transform` (auto_recall). Защита и память
   молча не работали. Найдено случайно. Существующий форвардинг-тест (L2099) проверяет
   7 ключей вручную, но НЕ сверяет набор ключей системно — новый core-хук может
   потеряться незамеченным. Fail-soft ветка (init-сбой → минимальный каркас) — без теста.
2. **Команда врёт при недоступном плагине (09-09):** `@maestro-memory-report` при
   недоступном `memory_stats_detail` выводит «Память выключена» (неверно) и не создаёт
   отчёт. Fallback на прямое чтение sqlite не формализован (делалось руками).
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
   принимает фабрику плагина (async `(ctx) => hooks`), возвращает opencode-хуки
   (spread + config/startup override + fail-soft каркас). `index.js` — только вызов:
   ```js
   export default async function opencodePlugin(input) {
     return createBootstrapAdapter(async () => MaestroBootstrapPlugin({
       directory: process.cwd(), client: input?.client,
     }))();
   }
   ```
   Ограничение «index.js — только default export» сохраняется (constraint opencode).
2. **Тест fail-soft:** `createBootstrapAdapter(async () => { throw new Error("boom") })()`
   → возвращает каркас `{config, event, startup, dispose}` (все — функции).
3. **Тест полного форвардинга:** `createBootstrapAdapter(() => coreHooks)()` → набор
   ключей результата ⊇ набор ключей coreHooks (кроме override config/startup). Плюс
   существующий тест L2099 дополняется сверкой ключей.

### B. Fallback в `@maestro-memory-report` (прямое чтение sqlite)

**Исследование (09-18):** схема sqlite (`memory`: session_id, key, title, summary,
decisions, artifacts, embedding, author, time_first/last, branch, head, merged, ...).
Прямой reading через node + `better-sqlite3` из **module_dir** (self-provisioned:
`<data-dir>/maestro/memory/module/node_modules`) даёт: записи/авторы/даты/ветки/merged
(SQL GROUP BY) + head-узлы (GROUP BY head). НЕ даёт: кластеры/темы/граф рёбер (нужны
embeddings+cosine), тиры experience/dead (нужна git-логика).

**Решение:** в шаг 1 команды `@maestro-memory-report`, при недоступности
`memory_stats_detail`:
- **только для `storage.type: sqlite`:** запустить node-скрипт с `better-sqlite3` из
  module_dir, собрать агрегаты (записи, по авторам, по датам, по веткам, merged,
  head-узлы: head/branch/sessions/first/last) → упрощённый HTML-отчёт + плашка
  «Плагин недоступен — отчёт упрощён (без кластеров/графа/тиров); перезапустите opencode».
- **для qdrant/pgvector:** честное «Плагин недоступен; бэкенд централизованный — fallback
  невозможен; перезапустите opencode» (без лжи про «память выключена»).
- SEC-4b сохраняется (только агрегаты; при sqlite-fallback — без summary/decisions).

### C. Smoke-чеклист + warn в Гейте 0

1. **`manual_docs/how-to/update-maestro.md`:** после обновления добавить smoke-чеклист
   (уже есть «/maestro-version после перезапуска» — расширить): (1) версия в init-логе =
   версия репо; (2) memory-инструмент доступен (напр. `@maestro-memory`); (3)
   `@maestro-memory-report` собирает отчёт; порядок rollout (push → кэш → рестарт) —
   закрепить как чек-лист.
2. **`skills/maestro/SKILL.md` Гейт 0:** добавить **warn (не STOP)** при рассинхроне
   версий: init-строка содержит `"version":"X.Y.Z"` — сверить с корневым package.json;
   при несовпадении вывести предупреждение «версия плагина (A) отстаёт от репо (B) —
   runtime-правки не активны до перезапуска» и **продолжить** (не блокировать: после
   бампа до рестарта рассинхрон штатен).

## 3. Изменения

### 3.1. `plugins/maestro-bootstrap/core.js`
- Добавить `createBootstrapAdapter(factory)` (named export): адаптер-логика из index.js
  (try/catch init, fail-soft каркас, spread + config/startup override).

### 3.2. `plugins/maestro-bootstrap/index.js`
- Стать тонким: `export default async (input) => createBootstrapAdapter(...)()`. Только
  default export (constraint сохраняется). Импорт `createBootstrapAdapter` из core.js.

### 3.3. `plugins/maestro-bootstrap/index.test.js`
- Тест fail-soft: throwing factory → каркас `{config, event, startup, dispose}`.
- Тест полного форвардинга: ключи результата ⊇ ключи core (кроме override).
- Существующий тест L2099: дополнить сверкой наборов ключей.

### 3.4. `commands/maestro-memory-report.md`
- Шаг 1: fallback на прямое чтение sqlite (только sqlite-бэкенд) + упрощённый HTML +
  плашка; qdrant/pgvector — честное «недоступно». SEC-4b.

### 3.5. `manual_docs/how-to/update-maestro.md`
- Smoke-чеклист после обновления (3 пункта) + закрепить порядок rollout.

### 3.6. `skills/maestro/SKILL.md`
- Гейт 0: warn (не STOP) при рассинхроне версий.

### 3.7. Синк (AGENTS.md)
- `manual_docs/explanation/pipeline-overview.md` — при необходимости.
- `manual_docs/overview/changelog.md` — запись P2.6.

### 3.8. `specs/*` — НЕ трогаем (исторический архив).

## 4. Критерии приёмки

1. `node --test plugins/maestro-bootstrap/index.test.js` — зелёный (171 + ~3 новых = 174);
   форвардинг-тест ловит потерю ключа (проверка: удалить ключ из spread → тест падает).
2. Fail-soft тест: throwing factory → каркас; index.js остаётся только default export.
3. `@maestro-memory-report` при недоступном плагине (sqlite) — упрощённый HTML с плашкой,
   НЕ «память выключена».
4. Гейт 0: при рассинхроне версий — warn, не STOP (проверка grep формулировки).
5. update-maestro.md содержит smoke-чеклист.
6. Changelog + manual_docs синхронизированы.

## 5. Regression

- Рефакторинг адаптера (createBootstrapAdapter) — поведение index.js не меняется
  (spread+override те же); риск — нарушение constraint «только default export» →
  проверяется тестом/загрузкой. Regression entry: LOW.
- Fallback в memory-report — только дополнение (новый путь при недоступности tool);
  существующий путь не меняется. LOW.
- Гейт 0 warn — не блокирует, только предупреждает. LOW.