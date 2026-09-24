---
description: Сгенерировать статический HTML-отчёт по memory layer (агрегаты, гистограмма, кластеры, commit-граф, SEC-4b)
---

# @maestro-memory-report

Сгенерируй **самодостаточный статический HTML-отчёт** по memory layer плагина `maestro-bootstrap`.

**Язык:** все сообщения пользователю — только на русском.

**SEC-4b (обязательно):** При `include_text: false` (по умолчанию) НЕ включать в HTML никакие тексты: ни заголовки (titles), ни summary, ни решения. Только агрегаты: числа, имена авторов, даты, размеры кластеров, aggregate-label тем, ID сессий в графе, head-хеши commit, имена веток, тиры (git-метаданные). При `include_text: true` допускается вставка замаскированных заголовков и summary (документированное понижение безопасности).

## Шаг 1. Получить детальную статистику памяти

1. **Гейт `maestro_config`:** если плагин-тул `maestro_config` **недоступен** →
   вывод «Перезапустите opencode / обновите плагин maestro-bootstrap (≥ 4.9.0)»
   (дистинкция по `.maestro/plugin-version` как в `@maestro-memory` шаг 1.2) —
   завершение. **Конфиг НЕ читать (bash-fallback запрещён).** Если доступен →
   прочитай секцию `memory` через тул (`section: "memory"`): `memory.enabled`,
   `memory.storage.type`, `memory.module_dir`.
2. Ветвление:
   - `memory.enabled: false` → выведи «Память maestro выключена — включите в maestro.json:
     memory.enabled: true» (текущее сообщение; fallback НЕ запускать).
   - `memory.enabled: true` + конфиг-невалиден (нет/невалиден `namespace`, внешний
     embedder без api_key_env и т.п. — disabled_reason из `@maestro-memory`) → выведи
     честную причину по `disabled_reason` (классификация как в `@maestro-memory` шаг 1.2),
     НЕ «перезапустите opencode» (нужно чинить конфиг).
   - `memory.enabled: true` + `storage.type` не sqlite (qdrant/pgvector) + инструмент
     недоступен → выведи «Плагин maestro-bootstrap недоступен; бэкенд централизованный —
     fallback невозможен; перезапустите opencode». НЕ «память выключена».
   - `memory.enabled: true` + `storage.type: sqlite` + инструмент недоступен → шаг 1a
     (fallback sqlite).
3. Вызови инструмент `memory_stats_detail` (без параметров). Если доступен — продолжи
   обычным путём (сохрани данные, guard на «Узлы графа», шаг 2). Если недоступен — по
   ветвлению выше.
4. **Проверь полноту данных (guard):** в выводе должна присутствовать секция
   `Узлы графа (M):`. Если её НЕТ — работающий плагин старше фичи commit-графа
   (`memory-report-commit-nodes`): выведи предупреждение
   «Плагин maestro-bootstrap устарел для commit-графа — отчёт будет упрощён
   (session-level граф). Перезапустите opencode после обновления» и в Шаге 3.5
   используй **fallback: session-level граф** из секции `Граф (рёбер: N):`
   (рёбра между `session_id`, узлы — сессии). НЕ рендерь молча несогласованный
   отчёт (пустой commit-граф / неверный формат).

## Шаг 1a. Fallback: прямое чтение sqlite (только при sqlite-бэкенде, плагин
загружен/актуален, но `memory_stats_detail` временно недоступен)

1. Резолв данных (через provisioned-код module_dir, НЕ дублируя логику):
   - `<data-dir>`: вычисли из XDG/`~/Library/Application Support` (maestro).
   - module_dir: `memory.module_dir` (из секции `memory`, прочитанной в шаге 1
     плагин-тулом `maestro_config`), иначе `<data-dir>/maestro/memory/module`.
   - `<key>`: импортируй `resolveEffectiveKey`/`sanitizeDirName` из
     `<module_dir>/config.js` и `deriveProjectKey` из `<module_dir>/project.js`
     через dynamic import (ESM). projectHash вычисли как
     `deriveProjectKey({ gitRemote, absPath }).hash` (gitRemote — из
     `git remote get-url origin` в корне проекта, absPath — корень проекта;
     зеркалит логику плагина index.js). Затем
     `effectiveKey = resolveEffectiveKey({ projectHash, namespace })` — при
     валидном конфиге (namespace задан) это просто namespace. Путь БД:
     `<data-dir>/maestro/memory/<sanitizeDirName(effectiveKey)>/memory.db`.
   - better-sqlite3: `createRequire` из `<module_dir>/package.json` (CJS).
2. Открой БД readonly: `new Database(dbPath, { readonly: true })`.
   - ENOENT (файла нет) → «Память пуста / нет данных».
   - open-сбой на существующем файле (WAL recovery) → «Не удалось открыть БД (readonly);
     перезапустите opencode».
   - better-sqlite3 не установлен → «Плагин недоступен для fallback; перезапустите opencode».
3. Собери агрегаты (SEC-4b — только числа/авторы/даты/ветки/merged/head; title/summary/
   decisions/embedding НЕ выбирать). **`include_text` в fallback не поддерживается —
   всегда `false`:** даже при `memory.report.include_text: true` упрощённый отчёт
   содержит только агрегаты, без title/summary/decisions (fallback не читает
   текстовые поля записей):
   - `SELECT COUNT(*) FROM memory WHERE key = ?`
   - `SELECT author, COUNT(*) ... GROUP BY author`
   - `SELECT date(time_last/1000,'unixepoch','localtime') AS day, COUNT(*) c ... GROUP BY day`
   - `SELECT branch, COUNT(*) ... GROUP BY branch`
   - `SELECT head, COUNT(*) sessions, MIN(time_first) first, MAX(time_last) last
      ... GROUP BY head`
   - `SELECT COUNT(*) FROM memory WHERE merged = 1`
4. Сформируй упрощённый HTML-отчёт (те же секции, что обычный, но без кластеров/графа/
   тиров) + плашка: «Плагин maestro-bootstrap недоступен — отчёт упрощён (без кластеров,
   графа, тиров). Перезапустите opencode после обновления».

## Шаг 2. Прочитать конфигурацию

1. Извлеки `memory.report.include_text` из уже прочитанной в шаге 1 секции
   `memory` (плагин-тул `maestro_config` — `read`-тул нативно denied,
   bash-чтение запрещено). Если отсутствует → `false` (по умолчанию).

## Шаг 3. Сформировать статический HTML

Создай **один HTML-файл** (inline CSS, inline JS, **никаких внешних** зависимостей, шрифтов, CDN).

Используй данные из `memory_stats_detail`. Структура:

### 3.1 Summary (верх страницы)

- **Бэкенд:** `<sqlite | qdrant | pgvector>`
- **Модель:** `<provider>: <model>` (для `openai` — `openai: <model>@<base_url>`; для `local` — имя ONNX-модели)
- **Всего записей:** `<N>`
- **Активный key:** `<key из отчёта>`

### 3.2 Timeline histogram (by_date)

Горизонтальная столбчатая диаграмма (canvas или inline SVG) по дню: каждая ось X — дата, высота — count. Только даты и числа — **никаких текстов заголовков при `include_text: false`**.

### 3.3 Кластеры

- Таблица: `cluster_id`, size, theme (aggregate-label).
- При `include_text: false` — только aggregate-label тем (без раскрытия содержимого).
- При `include_text: true` — aggregate-label + замаскированный preview темы.

### 3.4 Авторы

Список авторов и количество записей: `author_name: N`. Только имена — без привязки к текстовому контенту.

### 3.5 Similarity graph (commit nodes)

- Секции для парсинга: `Узлы графа (M):` и `Граф (рёбер: N):` из вывода `memory_stats_detail`.
  - Поля строки узла: `head=`/`ses=`, `branch=`, `sessions=`, `tier=`, `first=`,
    `last=`, `clusters=` (ID кластеров, `cluster-N`), `session_ids=`. Темы кластеров
    для отображения берутся из секции `Кластеры:` по `cluster-N`.
  - **Узел — commit (`head`)**; сессии одного `head` — один узел. Записи без `head`
  (ключ `ses:`) — unattributed-узлы (по сессии).
- Рендер SVG-графа:
  - узел-круг; подпись — компактный ключ (`h:<12 hex>` / `s:<12 символов session_id>`);
  - под узлом — ветка (merged-узлы: имя mainline; невлитые (tier ≠ merged):
    своя рабочая ветка) и бейдж `×N` (число сессий);
  - цвет по тиру: merged `#22c55e`, experience `#3b82f6`, unknown `#f59e0b`,
    dead `#ef4444`; unattributed-узлы окрашиваются по тиру как обычно и
    дополнительно помечаются серым контуром;
  - ребро — линия, opacity пропорциональна весу.
- Легенда тиров + таблица узлов: полный `head` (или `ses:<session_id>`), ветка,
  sessions, tier, активность (first–last), кластеры (темы из секции «Кластеры»,
  сопоставление по `cluster-N`), session_ids. Пустые `first`/`last`/`clusters`
  (нет времени у записи / сессии без эмбеддингов) — отображай как «—».
- Если в выводе есть строка `…(+N узлов ещё)` или ребро ссылается на компактный ключ
  вне списка `Узлы графа` — покажи такой узел отдельной записью (подпись — компактный
  ключ; ветка/sessions/tier неизвестны).
- Только агрегаты (SEC-4b): хеши commit, имена веток, счётчики, тиры, session_id
  — разрешены; titles/summary/decisions — запрещены.

### 3.6 SEC-4b enforcement

**При `include_text: false`** (по умолчанию):
- **НЕ вставлять** заголовки (titles), summary, решения (decisions) **нигде** в HTML.
- Разрешено: count, author names, dates, cluster sizes, theme aggregate-labels,
  session_id (node IDs в графе), **head-хеши commit, имена веток, тиры** (git-метаданные,
  уже присутствующие в tool-выводе, — не текст записей).

**При `include_text: true`:**
- Допускается вставка замаскированных titles и summaries (понижение уровня защиты, задокументированное в секции).

### 3.7 Легенда / глоссарий терминов

Внизу HTML-страницы добавь блок-сноску «Легенда» с определениями терминов
(статические формулировки — НЕ текст записей, SEC-4b не нарушают):

- **Кластер** — тематическая группа сессий, сформированная по сходству эмбеддингов
  (cosine > порога); тема — представительный заголовок.
- **Размер** — число сессий в кластере.
- **Узел** — commit (`head`); сессии одного `head` объединяются в один узел;
  запись без `head` — unattributed-узел (ключ `ses:`).
- **Сессий (×N)** — число сессий opencode, ссылающихся на этот `head`.
- **Активность** — диапазон дат (first–last) сессий узла.
- **Кластеры узла** — темы, к которым относятся сессии узла (по `cluster-N`).
- **Тир** — статус влития в mainline: `merged` (в mainline) / `experience`
  (не влит, работа на ветке) / `unknown` (без `head`) / `dead` (вне контекста).
- **Ветка** — имя mainline для merged-узлов; рабочая ветка для невлитых (tier ≠ merged).
- **Рёбра** — сходство между commit-узлами (косинус центроидов эмбеддингов группы).
- **head** — хеш коммита на момент суммаризации (идентичность изменения).
- **session_id** — идентификатор opencode-сессии (запись памяти).

Формат: компактная таблица или список в футере страницы; только термины и
определения, без ссылок на конкретные записи.

## Шаг 4. Записать файл

1. Путь: `.maestro/memory-report-<YYYYMMDD-HHMMSS>.html`.
2. Используй текущую дату и время для уникальности имени файла (формат `YYYYMMDD-HHMMSS`).
3. Убедись, что каталог `.maestro/` существует; если нет — создай.
4. Если `.maestro/` недоступен (read-only fs) → запиши в текущий рабочий каталог.

## Шаг 5. Запустить локальный preview-сервер (просмотр в браузере)

При `memory.report.preview !== false` (по умолчанию `true`):

1. Найди скрипт превью-сервера через glob:
   - `.opencode/skills/maestro/preview-http-server.cjs` (зеркало — обычный случай в целевом приложении);
   - `skills/maestro/preview-http-server.cjs` (authoring-репо).
   Если скрипт не найден или `node` недоступен — выведи предупреждение
   «preview-сервер недоступен» и перейди к Шагу 6 (только путь к файлу).
2. Каталог для state/log — каталог HTML-файла (обозначим `<dir>`).
3. Запусти сервер в фоне (POSIX):
   ```
   nohup node <скрипт> <html-файл> --state-file <dir>/preview-server.json > <dir>/preview-server.log 2>&1 &
   ```
   Скрипт сам откроет браузер по умолчанию (macOS/Linux/Windows) и напечатает
   `PREVIEW: <url>`; bind — только `127.0.0.1`, порт — свободный (по умолчанию).
4. Дождись появления state-файла (поллинг с таймаутом ~10с):
   ```
   for i in $(seq 1 50); do [ -s <dir>/preview-server.json ] && break; sleep 0.2; done
   ```
   Затем прочитай `<dir>/preview-server.json` → возьми `url`.
5. Если state-файл не появился / запуск упал → выведи предупреждение и перейди
   к Шагу 6 (только путь к файлу).

При `memory.report.preview === false` — Шаг 5 пропускается (генерируется только HTML).

## Шаг 6. Вывести результат пользователю

```
HTML-отчёт сохранён: <путь к файлу>

Всего записей: <N>, бэкенд: <backend>, модель: <provider>: <model>
```

Если preview-сервер запущен (Шаг 5) — дополнительно:

```
Preview: <url из state-файла>
Остановить: node <скрипт> --stop <dir>/preview-server.json
Сервер остановится автоматически через <TTL> мин (по умолчанию 60; --ttl-min 0 — безлимит).
```

Ссылка на справку: `manual_docs/reference/memory.md`.
