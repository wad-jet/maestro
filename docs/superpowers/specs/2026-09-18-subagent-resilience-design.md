# Спека: отказоустойчивость сабагентов (P2.2)

- **Дата:** 2026-09-18
- **Ветка:** `feature/subagent-resilience`
- **Категория:** Сложная фича (полный pipeline), 12 файлов, cross-layer (плагин + скиллы + доки)
- **Источник:** Волна P2.2 (ретроспектива `.maestro/feedback-reports`): отчёты 09-01 (haiku пустой, sonnet overloaded), 09-04 (opus 3× пустых), 09-13 (re-review зациклен 78 мин); эксперимент 09-18 (живой прогон opus + анализ логов: `session.error` теряет детали)

## 1. Проблема

Отказоустойчивость диспатчей сабагентов не формализована. Наблюдаемые сбои:

- **Пустой/бессодержательный результат** (09-04): opus 3× подряд вернул текст без
  structured-вердикта (`approve|revise|reject` + бакеты Critical/Important/Minor) —
  эскалация только с 3-й попытки. Текущий anti-loop guard (`SKILL.md:1225-1251`)
  допускает до 3 попыток и определяет «пустой» узко (полностью пустой task).
- **Зацикливание ревью** (09-13): re-review 78 минут — дифф диапазона содержал
  вспомогательные коммиты (спека/план/docs), промпт противоречил («spec patch
  excluded» при реальном диффе), субагент ревьюил не то. Детект пустоты не ловит.
- **Ошибка LLM/прерывание неразличимы** (эксперимент 09-18): в 66+ продовых
  записях `session.error` (08-30…09-17) нет ни одного `errorType`/`errorMessage` —
  плагин (`core.js:889-894`) читает `properties?.error?.type`/`?.message`, но
  реальная форма события не подтверждена (error может сериализоваться в `{}`,
  отсутствовать или иметь иную форму). Признак отмены пользователем
  (`MessageAbortedError`) не фиксируется.

Цель: формализовать реакцию оркестратора на каждый класс сбоя (пустой /
бессодержательный / прерванный / внешний сбой LLM) и починить наблюдаемость
`session.error` на основе **верифицированной** формы события.

## 2. Решение

Три компонента:

### A. Правило эскалации по сигналам (SKILL.md)

Расширить секцию «Anti-loop: диспатч и повторы» (`SKILL.md:1225-1251`):

**Определения:**
- **«Пустой результат»** — task-вызов, вернувший пустоту: нет `title`+`output`+
  `metadata` (детект плагина `empty_result`, `core.js:1037`).
- **«Бессодержательный результат»** — результат есть, но не удовлетворяет
  контракту роли:
  - ревьюер — нет вердикт-контракта **своей роли** (per-role словарь): spec-review
    (шаг 9) — `approve|revise|reject` + бакеты; task-reviewer (шаг 13) —
    `✅|❌|⚠️` + `Approved|Needs fixes`; re-review — `ADDRESSED|NOT ADDRESSED` +
    round-verdict; code-reviewer (шаг 16) — `Approved|Needs fixes|Reject`.
    Отчёт без вердикт-контракта своей роли считается бессодержательным;
  - implementer — нет Status-контракта `DONE|DONE_WITH_CONCERNS|BLOCKED|
    NEEDS_CONTEXT` + Files/Test/Commit (из `implementer-prompt.md`).

**Правило:** пустой/бессодержательный результат → **1 повтор** (после проверки
рабочего дерева: пустой отчёт ≠ нет работы) → **HITL** (варианты (a) продолжить /
(b) изменить формулировку / (c) отменить). **Supersede:** п.4 anti-loop
(«при пустом — сразу HITL», фикс 09-04) заменяется — смягчение до «1 повтор»
обосновано проверкой рабочего дерева (пустой отчёт ≠ нет работы). Кросс-ссылка
«лимит 3, как в anti-loop» (SKILL.md:1313, недоступность trusted-модели) —
синхронизировать (разграничить: для trusted-агентов бюджет повторов остаётся
3, как правило проверки доступности модели; для пустого/бессодержательного —
1 повтор).

**Механизм наблюдения сигналов (процедура оркестратора):** при пустом/ошибочном/
прерванном результате диспатча оркестратор проверяет лог плагина через bash
(`grep sessionID <свежий maestro-bootstrap-*.log>`) за окно диспатча и классифицирует
по таблице сигналов. **Важно:** `tool.execute.*`/`empty_result` пишутся с
`input.sessionID` **родителя** (`core.js:1038`), а `session.error` и
`session.status.retry` — с `properties.sessionID` **сабагентной сессии**
(`core.js:890-898`), которая оркестратору неизвестна. Корреляция — по
**тайм-окну**: записи `session.error`/`session.status.retry`
между `tool.execute.before`/`after` диспатча (по timestamp) относятся к этому
диспатчу.

**Таблица сигналов (реакция оркестратора):**

| Сигнал в логе | Значение | Реакция |
|---|---|---|
| `session.status.retry` (attempt, текст) | backend перегружен/таймаут (`queue_timeout`) | **не эскалировать** — внешний сбой, opencode сам ретраит |
| `session.error` + `aborted: false` (error.name != MessageAbortedError) | модель/сессия упала | 1 повтор → HITL |
| `session.error` + `aborted: true` (error.name == MessageAbortedError) | **пользователь прервал** | не эскалировать как сбой; проверить рабочее дерево (работа могла быть частично сделана) |
| `tool.execute.before` без `after` | диспатч повис/прерван | 1 повтор → HITL |
| `empty_result` / бессодержательный вердикт | субагент вернул не-контракт | 1 повтор → HITL |

### B. SCOPE NOTE стандарт (SKILL.md + SDD)

В секцию диспатча ревью (шаги 9/13/16) и в контракт SDD review-package добавить:

> **SCOPE NOTE (обязательно при неоднородном диапазоне):** если диапазон коммитов
> для ревью содержит вспомогательные коммиты вне скоупа задачи (docs-фиксы,
> спека/план-коммиты, changelog) — в промпт ревьюера включается явная заметка:
> «Игнорируй hunk'и/коммиты вне скоупа задачи: `<перечень>` (спека, план,
> changelog, docs) — они не влияют на вердикт по задаче; критичные находки
> (напр. секреты) во вспомогательных файлах — в Minor/ledger. Ревьюй только
> реализацию задачи.» При пустом списке вспомогательных — заметка не обязательна.

**Источник перечня вспомогательных коммитов:** правка скрипта
`.opencode/skills/subagent-driven-development/scripts/review-package` — добавить
секцию «Вспомогательные коммиты (вне скоупа)» с классификацией по путям
(docs/, спека/план, changelog) + включить файл в список изменений. Иначе —
вывод списка оркестратором из commit-list (без «отдельной строки» в пакете).

### C. Фикс `session.error` (плагин)

**Корень (C1, требует верификации):** плагин читает `properties?.error?.type`/
`?.message`, но продовая форма события не подтверждена (66+ записей без деталей).
Юнит-тесты (синтетические) не доказывают прод-поведение.

**Шаг 0 (верификация формы) — обязателен до фикса:** live-прогон с дампом
raw-объекта ошибки. В `core.js` handler временно добавить логирование формы:
`typeof err`, `Object.keys(err ?? {})`, `String(err)` (debug-уровень, или через
`console.error` на один прогон). Диспатчить сабагента до сбоя (или дождаться
естественного сбоя LLM) → зафиксировать реальную форму `properties.error` в
`.maestro/logs`. **После верификации — временный дамп УДАЛИТЬ** (зависивший
`console.error` с `String(err)` идёт мимо маскирующего логгера — обход
маскирования; уборка фиксируется в §3.5 и критерии №2).

**Изменение `core.js:889-894` (устойчивое к фактической схеме opencode — верифицировано
09-18 по бинарю: `error = {name, data:{message}}`, fallback legacy `{type,message}`, строка, `{}`):**
```js
if (type === "session.error") {
  const err = properties?.error;
  const errName = typeof err === "string" ? "Error" : err?.name ?? err?.type;
  const errMessage = typeof err === "string" ? err
    : err?.data?.message ?? err?.message;
  log.warn("session.error", {
    sessionID,
    errorType: errName,
    errorMessage: errMessage,
    aborted: errName === "MessageAbortedError" || err?.type === "message_aborted",
  });
}
```
(Обрабатывает фактическую форму opencode `{name, data.message}` (верифицирована),
legacy `{type, message}`, строку, `{}`/undefined. После live-верификации формы —
скорректировать под факт. Строковый кейс — ruling 09-18: errorType="Error" +
errorMessage = строка.)

## 3. Изменения

### 3.1. `skills/maestro/SKILL.md`
- A: переписать п.2 секции «Anti-loop: диспатч и повторы» (определения + «1 повтор
  → HITL» вместо «до 3 попыток» для пустого/бессодержательного); **supersede п.4**
  («при пустом — сразу HITL»); синк кросс-ссылки L1313 (trusted-модель: бюджет 3
  остаётся); добавить таблицу сигналов + процедуру наблюдения (bash-grep лога по
  sessionID).
- B: в секции диспатча ревью (шаги 9/13/16) — SCOPE NOTE правило.

### 3.2. `skills/maestro/spec-review-prompt.md`
- A: уточнить требование structured-вердикта: «Верни VERDICT: approve | revise |
  reject + бакеты CRITICAL/IMPORTANT/MINOR. Отчёт без вердикта и бакетов считается
  бессодержательным (нарушение контракта)».

### 3.3. Implementer-контракты (обе копии)
- `.opencode/skills/subagent-driven-development/implementer-prompt.md` **и**
  `skills/maestro/implementer-prompt.md` (пайплайн диспатчит implementer шага 13
  через эту копию):
  - A: в Status-контракт добавить: «Отчёт без Status/Files/Test/Commit считается
    бессодержательным (нарушение контракта) — оркестратор не примет его как DONE».

### 3.4. `.opencode/skills/subagent-driven-development/SKILL.md` + `scripts/review-package`
- B: в контракт review-package — секция «Вспомогательные коммиты (вне скоупа)»
  (правка скрипта `scripts/review-package`: классификация по путям docs/спека/план/
  changelog); в диспатч ревьюера — SCOPE NOTE при неоднородном диапазоне.

### 3.5. `plugins/maestro-bootstrap/core.js`
- C: шаг 0 (live-верификация формы события + **удаление временного дампа**) + фикс
  handler (см. §2-C).

### 3.6. `plugins/maestro-bootstrap/index.test.js`
- C: тесты: (1) Error-объект `{name, data:{message}}` → `errorType: name`, `errorMessage:
  data.message`, `aborted: false`; (2) `{name:"MessageAbortedError"}` → `aborted: true`;
  (3) legacy `{type:"message_aborted", message}` → `errorType: type`, `aborted: true`;
  (4) строка `"boom"` → `errorType: "Error"`, `errorMessage: "boom"`; (5) `{}`/undefined → поля undefined,
  entry существует.

### 3.7. `skills/maestro-feedback-report/SKILL.md`
- I4: в 3a агрегации `session.error` — различать `aborted: true` (прерывания
  пользователем, не сбой): считать отдельно, не в общий счётчик ошибок.

### 3.8. Документация (AGENTS.md sync-правило)
- `manual_docs/reference/hitl-gates.md`: синк A (правило повторов) + B (SCOPE NOTE).
- `manual_docs/reference/config.md`: таблица событий лога — `session.error`:
  добавить поле `aborted`, уточнить `errorType` (`name ?? type`, Error-объект).
- `manual_docs/overview/changelog.md`: запись P2.2.

### 3.9. `specs/*` и исторические файлы
- НЕ трогаем (исторический архив).

## 4. Критерии приёмки

1. `node --test plugins/maestro-bootstrap/index.test.js` — зелёный (163 + ~5 новых
   тестов = 168).
2. **Live-прогон:** после C реальная запись `session.error` в `.maestro/logs`
   содержит `errorType` и `aborted` (`errorMessage` — при объектной форме);
   временный дамп формы удалён (grep `String(err)` в core.js → 0). Юнит-тесты —
   только дополнение. Детерминированный путь live-проверки — форсированное
   прерывание (Esc) диспатча (без ожидания естественного сбоя LLM).
3. `grep -in "3 попыток"` в `skills/maestro/SKILL.md` → 0 в anti-loop п.2 (сейчас
   фраза разорвана переносом «Не более» / «3 попыток» — рабочая игла `3 попыток`;
   в L1313 trusted-модель — «лимит 3», не попадает); остатков «сразу HITL при
   пустом» (superseded) — 0.
4. В `skills/maestro/SKILL.md` и SDD SKILL.md есть SCOPE NOTE правило; review-package
   выводит «Вспомогательные коммиты (вне скоупа)».
5. `skills/maestro/implementer-prompt.md` содержит «бессодержательный = нарушение
   контракта»; `skills/maestro-feedback-report/SKILL.md` различает `aborted`.
6. Changelog + manual_docs синхронизированы (AGENTS.md).

## 5. Regression

- Фикс `session.error` меняет формат лога (аддитивно: `errorType`/`errorMessage`/
  `aborted`) — **не breaking**; для «пустого» правило **мягче** (1 повтор vs «сразу
  HITL» 09-04) — главный регрессионный вектор, назван явно; для «бессодержательного»
  — строже (1 vs 3). Regression entry: LOW.
<!-- maestro:review
reviewer: opus
date: 2026-09-18
verdict: approve
hash: f9c462f7e155e8aafeeca4dda83ca9a1446ec787a205b49abee797cedd10a811
-->
