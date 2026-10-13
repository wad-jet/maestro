# Design: индикатор использования пайплайна maestro

**Дата:** 2026-10-13
**Автор:** primary (orchestrator)
**Маршрут:** feature — сложная фича

---

## Intent и зачем это нужно

Пользователь не знает, запущен ли пайплайн maestro прямо сейчас, и на каком шаге находится.
Оркестратор пишет шаги в чат, но это видно только по ходу диалога — нет ни persistent-индикатора,
ни возможности запросить состояние в любой момент.

Эта фича добавляет **видимый индикатор** текущего состояния пайплайна: «пайплайн активен, шаг X/Y».

## Goals

- Пользователь видит, что пайплайн активен, и какой шаг выполняется.
- Индикатор обновляется при каждом шаге пайплайна.
- Пользователь может запросить текущее состояние в любой момент.

## Non-goals

- UI-индикатор в интерфейсе OpenCode (бейдж, статус-бар) — нет API для этого.
- История шагов (таймлайн): только текущий шаг.
- Пауза/продолжение пайплайна из статуса (уже есть через HITL gates).

## Anti-goals

- Не добавлять спам в чат (каждый шаг не должен создавать видимое сообщение пользователю,
  если оркестратор уже анонсирует его текстом).
- Не нарушать существующий флоу HITL gates.

## Constraints

- **Канал коммуникации:** OpenCode V2 plugin API — единственный канал от плагина к пользователю.
  Доступные механизмы:
  - `ctx.session.hook("context", ...)` — инъекция в system prompt агента (не видно пользователю напрямую).
  - `ctx.tool.transform(...)` — регистрация пользовательских инструментов.
  - `ctx.event.subscribe(...)` — подписка на события (read-only, нельзя писать в чат).
  - **Нативных нотификаций/toast/popup нет.**
- **Решение:** гибридный подход
  1. **Пассивный:** статус-блок в system prompt (через context hook) — виден агенту, агент может
     упомянуть его в ответе. Используется существующий паттерн из `communication.js`
     (plain language directive injection).
  2. **Активный:** инструмент `maestro_pipeline_status` — оркестратор вызывает для регистрации шага,
     пользователь может вызвать для запроса текущего статуса.

## Архитектура решения

### 1. Плагин: модуль pipeline status

Новый модуль `plugins/maestro-bootstrap/pipeline-status.js` (аналог `communication.js`):

```js
// Состояние пайплайна
let state = { active: false, step: null, description: '' };

export function setPipelineStatus({ step, totalSteps, description }) {
  state = { active: true, step, totalSteps, description };
}

export function clearPipelineStatus() {
  state = { active: false, step: null, totalSteps: null, description: '' };
}

export function getPipelineStatus() {
  return { ...state };
}

// Инъекция в system prompt (через context hook)
export function registerPipelineStatusHooks({ client, config, log }) {
  const registration = await client.session.hook('context', async (event) => {
    // ... injection logic
  });
  return { dispose: () => registration?.dispose?.() };
}
```

**Формат статус-блока в system prompt:**

```
## maestro pipeline: active (step 7/18.5, Feature Classification)
## Current state: waiting for user confirmation at HITL gate 7
```

При `active: false` блок не инжектится (или показывается `maestro pipeline: idle`).

### 2. Инструмент `maestro_pipeline_status`

Регистрируется через `ctx.tool.transform(...)` в `createBootstrapPlugin`.

**Параметры ввода:**

| Параметр | Тип | Описание |
|---|---|---|
| `action` | enum | `set` / `clear` / `get` |
| `step` | int (для `set`) | Текущий шаг пайплайна |
| `totalSteps` | int/string (для `set`) | Общее число шагов (может быть дробным: `"18.5"`) |
| `description` | string (для `set`) | Описание текущего шага |

**Guard:** `set`/`clear` — только из top-level primary-сессий (no `parentID`). `get` — всем. Guard реализован через guard-функцию (аналог `maestro_config` guard), fail-closed: если проверка не удалась — deny с текстом «инструмент недоступен в этом контексте».

**Поведение:**
- `set`: записывает состояние, возвращает `ok: true`.
- `clear`: сбрасывает в idle, возвращает `ok: true`.
- `get`: возвращает текущее состояние JSON.

**Примеры вызова:**

```
# Оркестратор (после анонса шага):
maestro_pipeline_status(action: "set", step: 7, totalSteps: 18, description: "Feature Classification")

# Пользователь (для запроса статуса):
maestro_pipeline_status(action: "get")
→ { active: true, step: 7, totalSteps: 18, description: "Feature Classification" }

# Оркестратор (после завершения):
maestro_pipeline_status(action: "clear")
```

### 3. Оркестратор: вызов статуса на каждом шаге

`SKILL.md` обновляется: после каждого анонса шага (например, «🟡 7. -- HITL GATE: ...»)
оркестратор вызывает `maestro_pipeline_status(action: "set", ...)`.

После завершения пайплайна — `action: "clear"`.

### 4. Персистентность

Состояние хранится в памяти процесса плагина (ESM-модуль с module-level variable).
Это допустимо: пайплайн — per-session операция, состояние актуально пока сессия жива.
При перезапуске opencode — сброс.

## Безопасность

- Статус-блок содержит только технические данные (номер шага, описание): **SEC-4b не нарушается**.
- Нет доступа к confidential-данным.
- Инструмент доступен всем (не только maestro-сессиям), но возвращает idle, если пайплайн не активен.

## Документация

- `manual_docs/reference/pipeline-status.md` — описание механизма.
- `SKILL.md` — вызов инструмента на каждом шаге.
- `SECURITY.md` — упоминание в разделе доверенных инструментов (если нужно).

## Тесты

- Unit-тесты для `pipeline-status.js`: set/clear/get.
- Интеграция: context hook injects block; tool returns correct state.
- Edge cases: multiple sets, clear while idle, concurrent access.

## Builder decisions (выбрано при review)

- **totalSteps**: передаётся оркестратором как аргумент `set`. Оркестратор знает
  структуру пайплайна (SKILL.md, ~19 шагов включая дробные 18.5). Плагин не считает
  шаги — он только хранит и отображает переданные значения. При изменении числа шагов
  в SKILL.md — обновление вызовов на каждом шаге (часть имплементации).

- **totalSteps format**: отображается как есть (`totalSteps` — string в выводе).
  Формат `7/18` или `7/18.5` определяется значением, переданным оркестратором.
  Статус-блок показывает `step X/Y` — Y это `totalSteps`.

- **Guard**: `set`/`clear` разрешены только из top-level primary-сессий
  (проверка `parentID === undefined` через `client.session.get`). `get` — всем.
  Guard: fail-closed, deny при ошибке проверки.

- **Статус-блок**: контекст-хук активируется при старте плагина. Блок всегда
  присутствует: `idle` (пока `set` не вызван) → `active (step X/Y, ...)` (после `set`).
  Это гарантирует, что агент всегда видит статус-блок, даже если оркестратор ещё
  не сделал первый `set`.

- **Персистентность**: module-level state (один объект в процессе).
  Параллельные пайплайны в разных сессиях перезаписывают друг друга (single-session
  usage model — типичный сценарий). Если потребуется per-session storage —
  `Map<sessionID, state>`.

## Что остаётся на builder

- Точный формат статус-блока (можно уточнить при реализации).
- Расположение файла `pipeline-status.js` (рядом с `communication.js` или новый каталог).
- Конкретные шаги в `SKILL.md` (какие именно вызовы добавлять).
