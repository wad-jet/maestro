---
description: Сгенерировать статический HTML-отчёт по memory layer (агрегаты, гистограмма, кластеры, граф, SEC-4b)
---

# @maestro-memory-report

Сгенерируй **самодостаточный статический HTML-отчёт** по memory layer плагина `maestro-bootstrap`.

**Язык:** все сообщения пользователю — только на русском.

**SEC-4b (обязательно):** При `include_text: false` (по умолчанию) НЕ включать в HTML никакие тексты: ни заголовки (titles), ни summary, ни решения. Только агрегаты: числа, имена авторов, даты, размеры кластеров, aggregate-label тем, ID сессий в графе. При `include_text: true` допускается вставка замаскированных заголовков и summary (документированное понижение безопасности).

## Шаг 1. Получить детальную статистику памяти

1. Вызови инструмент `memory_stats_detail` (без параметров).
2. Если вызов не удался / инструмент недоступен / память выключена → выведи:

    ```
    Память maestro выключена — включите в maestro.json:
    memory.enabled: true (см. manual_docs/how-to/enable-memory.md)
    ```

   Заметь: в отличие от `@maestro-memory`, команда завершается без создания отчёта.
3. Сохрани полученные данные для шага 2.

## Шаг 2. Прочитать конфигурацию

1. Прочитай `maestro.json` (файл в корне проекта) через `read`.
2. Извлеки `memory.report.include_text`. Если отсутствует → `false` (по умолчанию).

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

### 3.5 Similarity graph (session pairs above threshold)

Простая визуализация: список узлов (session_id) и рёбер (пары выше threshold). Можно в виде простого SVG с узлами-кружками или plain-text списка пар.

### 3.6 SEC-4b enforcement

**При `include_text: false`** (по умолчанию):
- **НЕ вставлять** заголовки (titles), summary, решения (decisions) **нигде** в HTML.
- Разрешено: count, author names, dates, cluster sizes, theme aggregate-labels, session_id (node IDs в графе).

**При `include_text: true`:**
- Допускается вставка замаскированных titles и summaries (понижение уровня защиты, задокументированное в секции).

## Шаг 4. Записать файл

1. Путь: `.maestro/memory-report-<YYYYMMDD-HHMMSS>.html`.
2. Используй текущую дату и время для уникальности имени файла (формат `YYYYMMDD-HHMMSS`).
3. Убедись, что каталог `.maestro/` существует; если нет — создай.
4. Если `.maestro/` недоступен (read-only fs) → запиши в текущий рабочий каталог.

## Шаг 5. Вывести результат пользователю

```
HTML-отчёт сохранён: <путь к файлу>

Всего записей: <N>, бэкенд: <backend>, модель: <provider>: <model>
```

Ссылка на справку: `manual_docs/reference/memory.md`.
