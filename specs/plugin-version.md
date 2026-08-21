# Спецификация: определение версии подключённого плагина maestro-bootstrap

## Проблема

Версия плагина `maestro-bootstrap` (корневой `package.json` репозитория →
`version`, сейчас `1.1.0`) нигде не экспонируется в рантайме. При диагностике
нельзя понять, какая версия реально загружена в сессии OpenCode, нет версии в
аудит-логе, и нет способа сообщить пользователю активную версию. OpenCode не
даёт нативного способа запросить версию загруженного плагина (`opencode debug
config` показывает только plugin-спецификацию, для git-установки версия в спеке
отсутствует).

## Цели

1. **Диагностика/отладка** — возможность узнать версию реально загруженного
   плагина.
2. **Аудит-лог** — версия пишется при инициализации плагина.
3. **Информирование пользователя** — команда `/maestro-version`.

Проверка совместимости версий (со скиллом/конфигом) — **вне области** (снята).

## Подход (утверждён: B)

Плагин при `init` пишет версию в стабильный файл `.maestro/plugin-version`,
который читают команда и диагностика. Версия также дублируется в аудит-лог
(`plugin initialized`). Единый источник версии — **корневой** `package.json`
репозитория (плагин устанавливается из git через `main` → `plugins/maestro-bootstrap/index.js`).

## Архитектура

### 1. Источник версии — `readPluginVersion()` (core.js)

Новая функция `readPluginVersion()`:
- Резолвит путь к **корневому** `package.json` через `import.meta.url` относительно
  `core.js` (`plugins/maestro-bootstrap/` → `../../package.json`, фиксированная
  глубина макета репо).
- Читает и парсит, на ошибку возвращает `undefined` (fail-soft: версия не критична).
- Единственная точка определения версии — используется и для файла, и для лога.

### 2. Файл версии — `writePluginVersionFile(dir, version)` (core.js)

- Путь: `path.join(dir, ".maestro/plugin-version")` (каталог `.maestro/` создаётся
  неявно, как для логов).
- Содержимое: одна строка с версией (например `1.1.0`).
- Перезаписывается при каждом `init` → всегда отражает загруженную версию.
- Запись обёрнута в `try/catch`: провал не должен ронять плагин (инвариант
  «logging must never break the session»).

Вызов из `MaestroBootstrapPlugin({ directory })`: `writePluginVersionFile(root, version)`.

### 3. Аудит-лог

В строку `plugin initialized` (`core.js`) добавляется поле `version`.

### 4. Команда `/maestro-version`

- Файл: `commands/maestro-version.md` (frontmatter `description`; привязки к агенту
  нет, поле `agent:` не указывается).
- Директива: прочитать `<project>/.maestro/plugin-version` и сообщить пользователю
  версию подключённого плагина.
- **Явный путь «не инициализировано»**: если файла нет — сообщить
  «плагин maestro-bootstrap не инициализирован или версия неизвестна» (диагностика
  сбоя init: файл пишется только при успешном `init`).
- Все сообщения — только на русском.

### 5. `.gitignore` (application repo)

`.maestro/plugin-version` — эфемерное (перезаписывается), не коммитится.

## Синхронизация (AGENTS.md)

- `commands/maestro-version.md` → зеркалируется в `.opencode/commands/maestro-version.md`.
- `manual_docs/reference/commands.md` — добавить раздел про `/maestro-version`
  (все команды документируются).
- `skills/maestro-init/SKILL.md` — в фиксированный список `.gitignore`
  (`.maestro/sdd/`, `.maestro/last-run.md`, `.maestro/logs/`,
  `.maestro/feedback-reports/`) добавить `.maestro/plugin-version`. Иначе новые
  проекты через `/maestro-init` не получат этот путь в `.gitignore`.

## Обработка ошибок

- Ошибка чтения `package.json` → `readPluginVersion()` возвращает `undefined`,
  файл не пишется, в `plugin initialized` поле `version` отсутствует.
- Ошибка записи файла → silent (`try/catch`), плагин продолжает работу.
- Сбой `init` плагина (уже обрабатывается в `index.js`) → файл не пишется;
  команда `/maestro-version` сообщает о неинициализированном плагине (не тихо).

## Тестирование

- Тесты плагина (`index.test.js`): `readPluginVersion()` возвращает версию из
  `package.json`; `writePluginVersionFile()` создаёт файл с корректным
  содержимым и не падает на отсутствующем каталоге/ошибке записи.
- Ручная проверка: запустить opencode с плагином → убедиться, что
  `.maestro/plugin-version` создан и `/maestro-version` возвращает версию.

## Затрагиваемые файлы

- `plugins/maestro-bootstrap/core.js` — `readPluginVersion`, `writePluginVersionFile`, поле `version` в `plugin initialized`.
- `plugins/maestro-bootstrap/index.test.js` — тесты.
- `commands/maestro-version.md` — новая команда.
- `.opencode/commands/maestro-version.md` — runtime-копия команды.
- `manual_docs/reference/commands.md` — документация команды.
- `skills/maestro-init/SKILL.md` — `.gitignore`: добавить `.maestro/plugin-version`.