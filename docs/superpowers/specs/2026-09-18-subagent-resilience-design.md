# Спека: отказоустойчивость сабагентов (P2.2)

- **Дата:** 2026-09-18
- **Ветка:** `feature/subagent-resilience`
- **Категория:** Сложная фича (полный pipeline), 7 файлов, cross-layer (плагин + скиллы + доки)
- **Источник:** Волна P2.2 (ретроспектива `.maestro/feedback-reports`): отчёты 09-01 (haiku пустой, sonnet overloaded), 09-04 (opus 3× пустых), 09-13 (re-review зациклен 78 мин); эксперимент 09-18 (живой прогон opus + анализ логов: `session.error` теряет детали)

## 1. Проблема

Отказоустойчивость диспатчей сабагентов не формализована. Наблюдаемые сбои:

- **Пустой/бессодержательный результат** (09-04): opus 3× подряд вернул текст без
  structured-вердикта (`approve|revise|reject` + бакеты Critical/Important/Minor) —
  эскалация только с 3-й попытки. Текущий anti-loop guard (`SKILL.md:1225-1249`)
  допускает до 3 попыток и определяет «пустой» узко (полностью пустой task).
- **Зацикливание ревью** (09-13): re-review 78 минут — дифф диапазона содержал
  вспомогательные коммиты (спека/план/docs), промпт противоречил («spec patch
  excluded» при реальном диффе), субагент ревьюил не то. Детект пустоты не ловит.
- **Ошибка LLM/прерывание неразличимы** (эксперимент 09-18, код `core.js:889-893`):
  opencode шлёт `session.error` с `properties.error` как Error-объект
  (`name`/`message`), плагин читает `error.type` (несуществующее поле) → в лог
  пишется только `sessionID`, без `errorType`/`errorMessage`. Признак отмены
  пользователем (`MessageAbortedError`) не фиксируется.

Цель: формализовать реакцию оркестратора на каждый класс сбоя (пустой /
бессодержательный / прерванный / внешний сбой LLM) и починить наблюдаемость
`session.error`.

## 2. Решение

Три компонента:

### A. Правило эскалации по сигналам (SKILL.md)

Расширить секцию «Anti-loop: диспатч и повторы» (`SKILL.md:1225-1249`):

**Определения:**
- **«Пустой результат»** — task-вызов, вернувший пустоту: нет `title`+`output`+
  `metadata` (детект плагина `empty_result`, core.js:1036).
- **«Бессодержательный результат»** — результат есть, но не удовлетворяет
  контракту роли:
  - ревьюер (spec-review/code-review) — нет structured-вердикта `approve|revise|
    reject` + бакетов Critical/Important/Minor;
  - implementer — нет Status-контракта `DONE|DONE_WITH_CONCERNS|BLOCKED|
    NEEDS_CONTEXT` + Files/Test/Commit (из `implementer-prompt.md`).

**Правило:** пустой/бессодержательный результат → **1 повтор** (после проверки
рабочего дерева: пустой отчёт ≠ нет работы) → **HITL** (варианты (a) продолжить /
(b) изменить формулировку / (c) отменить). Заменить «не более 3 попыток» на
«не более 1 повтора» для этого класса.

**Таблица сигналов (реакция оркестратора):**

| Сигнал в логе | Значение | Реакция |
|---|---|---|
| `session.status.retry` (attempt, текст) | backend перегружен/таймаут (`queue_timeout`) | **не эскалировать** — внешний сбой, opencode сам ретраит |
| `session.error` + `error.name != MessageAbortedError` | модель/сессия упала | 1 повтор → HITL |
| `session.error` + `error.name == MessageAbortedError` | **пользователь прервал** | не эскалировать как сбой; проверить рабочее дерево (работа могла быть частично сделана) |
| `tool.execute.before` без `after` | диспатч повис/прерван | 1 повтор → HITL |
| `empty_result` / бессодержательный вердикт | субагент вернул не-контракт | 1 повтор → HITL |

### B. SCOPE NOTE стандарт (SKILL.md + SDD)

В секцию диспатча ревью (шаги 9/13/16) и в контракт SDD review-package добавить:

> **SCOPE NOTE (обязательно при неоднородном диапазоне):** если диапазон коммитов
> для ревью содержит вспомогательные коммиты вне скоупа задачи (docs-фиксы,
> спека/план-коммиты, changelog) — в промпт ревьюера включается явная заметка:
> «Игнорируй hunk'и/коммиты вне скоупа задачи: `<перечень>` (спека, план,
> changelog, docs). Ревьюй только реализацию задачи.» При пустом списке
> вспомогательных — заметка не обязательна.

В SDD review-package — указывать перечень вспомогательных коммитов (docs/спека/
plan/changelog) отдельной строкой, чтобы оркестратор строил SCOPE NOTE без
ручного разбора диффа.

### C. Фикс `session.error` (плагин)

**Корень (эксперимент 09-18):** opencode шлёт `properties.error` как Error-объект
(`name`/`message`), плагин читает `error.type` → undefined. Плюс не различает
`MessageAbortedError` (отмена пользователем).

**Изменение `core.js:889-893`:**
```js
if (type === "session.error") {
  const err = properties?.error;
  log.warn("session.error", {
    sessionID,
    errorType: err?.name ?? err?.type,     // Error: name; fallback type
    errorMessage: err?.message,
    aborted: err?.name === "MessageAbortedError",
  });
}
```

## 3. Изменения

### 3.1. `skills/maestro/SKILL.md`
- A: переписать п.2 секции «Anti-loop: диспатч и повторы» (определения + «1 повтор
  → HITL» вместо «до 3 попыток»); добавить таблицу сигналов.
- B: в секции диспатча ревью (шаги 9/13/16) — SCOPE NOTE правило.

### 3.2. `skills/maestro/spec-review-prompt.md`
- A: уточнить требование structured-вердикта: «Верни VERDICT: approve | revise |
  reject + бакеты CRITICAL/IMPORTANT/MINOR. Отчёт без вердикта и бакетов считается
  бессодержательным (нарушение контракта)».

### 3.3. `.opencode/skills/subagent-driven-development/implementer-prompt.md`
- A: в Status-контракт добавить: «Отчёт без Status/Files/Test/Commit считается
  бессодержательным (нарушение контракта) — оркестратор не примет его как DONE».

### 3.4. `.opencode/skills/subagent-driven-development/SKILL.md`
- B: в контракт review-package добавить перечень вспомогательных коммитов
  (docs/спека/plan/changelog) отдельной строкой; в диспатч ревьюера — SCOPE NOTE
  при неоднородном диапазоне.

### 3.5. `plugins/maestro-bootstrap/core.js`
- C: фикс `session.error` (см. §2-C).

### 3.6. `plugins/maestro-bootstrap/index.test.js`
- C: тесты: (1) `session.error` с Error-объектом `{name, message}` → в логе
  `errorType: name`, `errorMessage: message`; (2) `error.name === "MessageAbortedError"`
  → `aborted: true`; (3) fallback `error.type` при отсутствии `name`.

### 3.7. Документация (AGENTS.md sync-правило)
- `manual_docs/reference/hitl-gates.md`: синк A (правило повторов) + B (SCOPE NOTE).
- `manual_docs/overview/changelog.md`: запись P2.2.

### 3.8. `specs/*` и исторические файлы
- НЕ трогаем (исторический архив).

## 4. Критерии приёмки

1. `node --test plugins/maestro-bootstrap/index.test.js` — зелёный (163 + ~3 новых
   теста = 166).
2. Плагин: `session.error` логирует `errorType`/`errorMessage`/`aborted`.
3. `grep -n "не более 3 попыток"` в `skills/maestro/SKILL.md` → 0 (заменено на
   «не более 1 повтора» для пустого/бессодержательного).
4. В `skills/maestro/SKILL.md` и SDD SKILL.md есть SCOPE NOTE правило.
5. Changelog + manual_docs синхронизированы (AGENTS.md).
6. Экспериментальная проверка: диспатч opus → в логе `tool.execute.before` +
   `tool.execute.after` (титул); при сбое — `session.error` с деталями.

## 5. Regression

- Фикс `session.error` меняет формат лога (добавляет поля) — **не breaking**
  (аддитивное изменение; существующие поля `sessionID` сохраняются). Regression
  entry: LOW.
- Правило «1 повтор → HITL» — меняет поведение оркестратора (строже текущего);
  влияет на процесс, не на данные. Regression entry: LOW.