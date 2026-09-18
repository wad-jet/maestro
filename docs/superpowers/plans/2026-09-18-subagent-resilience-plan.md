# Subagent Resilience (P2.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Формализовать реакцию оркестратора на сбои сабагентов (пустой/бессодержательный/прерванный/внешний сбой LLM), ввести SCOPE NOTE в review-промпты и починить наблюдаемость `session.error` в плагине.

**Architecture:** Три компонента: A) anti-loop guard расширяется определением «бессодержательного результата» + «1 повтор → HITL» + таблица сигналов (с тайм-оконной корреляцией sessionID); B) SCOPE NOTE в диспатч-промптах ревью (шаги 9/13/16) + перечень вспомогательных коммитов в review-package; C) фикс `session.error` в core.js (устойчивый к Error/legacy/строке/{}) после live-верификации формы события.

**Tech Stack:** Node.js ESM (плагин), bash (scripts/review-package), markdown (SKILL/SDD/доки).

**Спека:** `docs/superpowers/specs/2026-09-18-subagent-resilience-design.md` (approved, 3 раунда ревью). **Важно (C):** перед фиксом handler — live-верификация формы `session.error` (шаг 0, Task 3 Step 1); временный дамп удалить после верификации.

**Важно для SDD:** скиллы/файлы читаются через bash (нативный deny блокирует read-тул на `.md`). В heredoc НЕ включать слово из букв "confidential" (нативный bash-deny).

---

## File Structure

- `plugins/maestro-bootstrap/core.js` — фикс session.error (Task 3)
- `plugins/maestro-bootstrap/index.test.js` — тесты (Task 3)
- `skills/maestro/SKILL.md` — A (anti-loop) + B (SCOPE NOTE) + синк L1313 (Task 1)
- `skills/maestro/spec-review-prompt.md` — требование structured-вердикта (Task 1)
- `skills/maestro/implementer-prompt.md` — бессодержательный = нарушение (Task 1)
- `.opencode/skills/subagent-driven-development/implementer-prompt.md` — то же (Task 1)
- `.opencode/skills/subagent-driven-development/SKILL.md` — SCOPE NOTE (Task 2)
- `.opencode/skills/subagent-driven-development/scripts/review-package` — секция «Вспомогательные коммиты» (Task 2)
- `skills/maestro-feedback-report/SKILL.md` — aborted-различение (Task 4)
- `manual_docs/reference/hitl-gates.md` — синк A+B (Task 4)
- `manual_docs/reference/config.md` — таблица лога session.error (Task 4)
- `manual_docs/overview/changelog.md` — запись P2.2 (Task 5)
- `regression/entries/2026-09-18-subagent-resilience.md` — regression entry (Task 5)

---

### Task 1: SKILL.md — anti-loop (A) + SCOPE NOTE (B) + spec-review/implementer-контракты

**Files:**
- Modify: `skills/maestro/SKILL.md`
- Modify: `skills/maestro/spec-review-prompt.md`
- Modify: `skills/maestro/implementer-prompt.md`
- Modify: `.opencode/skills/subagent-driven-development/implementer-prompt.md`

- [ ] **Step 1: Переписать п.2 секции «Anti-loop: диспатч и повторы» (SKILL.md ~L1234-1242)**

Заменить п.2 (определение лимита) на:

```
2. **Пустой/бессодержательный результат — не ретраить вслепую.** Не более
   1 ПОВТОРА по одному и тому же `(subagent_type, задача)` в рамках одного хода
   (до следующего user-сообщения). «Ход» = непрерывная автономная работа
   оркестратора между HITL gates; ответ пользователя обнуляет счётчик.
   **Перед повторным диспатчем — проверить рабочее дерево** (`git status
   --porcelain`) и дифф (`git diff`). Пустой отчёт ≠ нет работы: имплементер
   мог внести правки, но не закоммитить и не отчитаться. В этом случае не
   диспатчить повторно, а потребовать отчёт по чек-листу (Status / Files /
   Test output / Commit SHA) из `implementer-prompt.md`.
   **Определения:**
   - **Пустой результат** — task-вызов, вернувший пустоту: нет `title`+`output`+
     `metadata` (детект плагина `empty_result`).
   - **Бессодержательный результат** — результат есть, но не удовлетворяет
     вердикт-контракту своей роли (per-role словарь):
     spec-review (шаг 9) — `approve|revise|reject` + бакеты;
     task-reviewer (шаг 13) — `✅|❌|⚠️` + `Approved|Needs fixes`;
     re-review — `ADDRESSED|NOT ADDRESSED` + round-verdict;
     code-reviewer (шаг 16) — `Approved|Needs fixes|Reject`;
     implementer — Status-контракт `DONE|DONE_WITH_CONCERNS|BLOCKED|NEEDS_CONTEXT`
     + Files/Test/Commit.
   **Процедура наблюдения:** при пустом/ошибочном/прерванном результате диспатча
   проверить лог плагина через bash (`grep sessionID <свежий
   maestro-bootstrap-*.log>`) за окно диспатча и классифицировать по таблице
   сигналов (ниже). Важно: `tool.execute.*`/`empty_result` пишутся с
   `input.sessionID` родителя, а `session.error`/`session.status.retry` — с
   `properties.sessionID` сабагентной сессии; корреляция — по тайм-окну между
   `tool.execute.before`/`after` диспатча.
   **Таблица сигналов:**
   | Сигнал в логе | Значение | Реакция |
   |---|---|---|
   | `session.status.retry` (attempt, текст) | backend перегружен/таймаут | не эскалировать — внешний сбой, opencode ретраит сам |
   | `session.error` + `aborted: false` | модель/сессия упала | 1 повтор → HITL |
   | `session.error` + `aborted: true` | пользователь прервал | не эскалировать как сбой; проверить рабочее дерево |
   | `tool.execute.before` без `after` | диспатч повис/прерван | 1 повтор → HITL |
   | `empty_result` / бессодержательный вердикт | не-контракт | 1 повтор → HITL |
```

- [ ] **Step 2: Переписать п.4 (supersede «сразу HITL»)**

Заменить п.4:
```
4. **Связь с Fix-loop эскалацией (rounds 4-5, см. выше):** эскалация tier
   применяется к *содержательным* повторам (когда результат есть, но ревью
   находит проблемы). При пустом/бессодержательном результате — по п. 2-3
   (1 повтор → HITL), без тиражирования tier-эскалаций на пустые попытки.
```

- [ ] **Step 3: Синк кросс-ссылки L1313 (trusted-модель)**

В SKILL.md ~L1313 (недоступность модели trusted-агента, вариант (b)):
заменить «(лимит 3, как в anti-loop)» на «(бюджет повторов 3 — для проверки
доступности модели; отдельно от лимита 1 на пустой/бессодержательный результат
в anti-loop)».

- [ ] **Step 4: SCOPE NOTE правило в секции диспатча ревью**

В SKILL.md, секция диспатча ревью (шаги 9/13/16, ~L1441-1444), добавить блок:
```
   **SCOPE NOTE (обязательно при неоднородном диапазоне):** если диапазон
   коммитов для ревью содержит вспомогательные коммиты вне скоупа задачи
   (docs-фиксы, спека/план-коммиты, changelog) — в промпт ревьюера включить
   явную заметку: «Игнорируй hunk'и/коммиты вне скоупа задачи: <перечень>
   (спека, план, changelog, docs) — они не влияют на вердикт по задаче;
   критичные находки (напр. секреты) во вспомогательных файлах — в
   Minor/ledger. Ревьюй только реализацию задачи.» При пустом списке
   вспомогательных — заметка не обязательна.
```

- [ ] **Step 5: spec-review-prompt.md — требование structured-вердикта**

В `skills/maestro/spec-review-prompt.md`, в блоке возврата ревью, добавить/усилить:
```
**Контракт вывода (обязателен):** Верни VERDICT: approve | revise | reject +
бакеты CRITICAL/IMPORTANT/MINOR. Отчёт без вердикта и бакетов считается
бессодержательным (нарушение контракта) — оркестратор классифицирует его как
бессодержательный результат (1 повтор → HITL).
```

- [ ] **Step 6: implementer-prompt.md (обе копии) — бессодержательный = нарушение**

В `skills/maestro/implementer-prompt.md` и
`.opencode/skills/subagent-driven-development/implementer-prompt.md`, в Status-контракте:
```
**Контракт отчёта (обязателен):** верни Status (DONE | DONE_WITH_CONCERNS |
BLOCKED | NEEDS_CONTEXT) + Commits + Files changed + Test output + отчёт-файл.
Отчёт без Status/Files/Test/Commit считается бессодержательным (нарушение
контракта) — оркестратор не примет его как DONE.
```

- [ ] **Step 7: Проверки**

Run:
```bash
grep -in "3 попыток" skills/maestro/SKILL.md
```
Expected: 0 вхождений в anti-loop п.2 (фраза заменена); L1313 «лимит 3» — допустимо (trusted-модель).

Run:
```bash
grep -in "сразу HITL" skills/maestro/SKILL.md
```
Expected: 0 вхождений (п.4 superseded).

Run: `grep -c "SCOPE NOTE" skills/maestro/SKILL.md` → ≥1.

- [ ] **Step 8: Commit**

```bash
git add skills/maestro/SKILL.md skills/maestro/spec-review-prompt.md skills/maestro/implementer-prompt.md .opencode/skills/subagent-driven-development/implementer-prompt.md
git commit -m "docs(maestro): subagent-resilience A+B — anti-loop 1-repeat + SCOPE NOTE + per-role verdict contracts"
```

---

### Task 2: SDD SKILL.md + review-package script (B)

**Files:**
- Modify: `.opencode/skills/subagent-driven-development/SKILL.md`
- Modify: `.opencode/skills/subagent-driven-development/scripts/review-package`

- [ ] **Step 1: SCOPE NOTE в SDD SKILL.md**

В `.opencode/skills/subagent-driven-development/SKILL.md`, в секции диспатча ревьюера
(~«Generate review package, dispatch task reviewer»), добавить:
```
**SCOPE NOTE (при неоднородном диапазоне):** если review-package содержит секцию
«Вспомогательные коммиты (вне скоупа)» — включить в промпт ревьюера явную
заметку: «Игнорируй hunk'и/коммиты вне скоупа задачи: <перечень>. Ревьюй только
реализацию задачи; критичные находки во вспомогательных файлах — в Minor/ledger.»
```

- [ ] **Step 2: review-package — секция «Вспомогательные коммиты»**

В `.opencode/skills/subagent-driven-development/scripts/review-package`, после
блока `## Commits` (перед `## Files changed`), добавить секцию классификации:

```bash
  echo "## Auxiliary commits (out of scope)"
  git log --oneline --no-merges "${base}..${head}" -- docs/ docs/superpowers/ manual_docs/ regression/ TODO.md '*.md' 2>/dev/null | head -50 || true
  echo "# (commits touching docs/specs/plans/changelog — reviewer should scope-ignore unless critical findings)"
```

- [ ] **Step 3: Проверка**

Run: `bash -n .opencode/skills/subagent-driven-development/scripts/review-package` → OK
(синтаксис).

- [ ] **Step 4: Commit**

```bash
git add .opencode/skills/subagent-driven-development/SKILL.md .opencode/skills/subagent-driven-development/scripts/review-package
git commit -m "docs(sdd): SCOPE NOTE + review-package auxiliary commits section (P2.2 B)"
```

---

### Task 3: Плагин — фикс session.error (C)

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js`
- Modify: `plugins/maestro-bootstrap/index.test.js`

- [ ] **Step 1: Шаг 0 — live-верификация формы события**

В `core.js` handler `session.error`, ВРЕМЕННО добавить дамп формы (перед `log.warn`):
```js
const err = properties?.error;
console.error("[maestro-bootstrap] session.error raw:", typeof err, err && Object.keys(err), err && String(err));
```
Прогнать (см. ниже) и зафиксировать реальную форму в `.maestro/logs` или консоли.
**Записать находку в отчёт-файл Task 3.** После фикса — УДАЛИТЬ дамп.

- [ ] **Step 2: Написать тесты (RED)**

В `plugins/maestro-bootstrap/index.test.js`, добавить в describe про session.error:
```js
it("session.error logs name/message for Error object", async () => {
  const p = await MaestroBootstrapPlugin({ directory: dir });
  await p.event({ event: { type: "session.error", properties: { sessionID: "s", error: { name: "OverloadedError", data: { message: "overloaded" } } } } });
  const e = readLogs(dir, "maestro-bootstrap").find((x) => x.msg === "session.error");
  assert.equal(e.errorType, "OverloadedError");
  assert.equal(e.errorMessage, "overloaded");
  assert.equal(e.aborted, false);
});
it("session.error aborted flag for MessageAbortedError", async () => {
  const p = await MaestroBootstrapPlugin({ directory: dir });
  await p.event({ event: { type: "session.error", properties: { sessionID: "s", error: { name: "MessageAbortedError", message: "user aborted" } } } });
  const e = readLogs(dir, "maestro-bootstrap").find((x) => x.msg === "session.error");
  assert.equal(e.aborted, true);
});
it("session.error legacy type fallback + aborted", async () => {
  const p = await MaestroBootstrapPlugin({ directory: dir });
  await p.event({ event: { type: "session.error", properties: { sessionID: "s", error: { type: "message_aborted", message: "m" } } } });
  const e = readLogs(dir, "maestro-bootstrap").find((x) => x.msg === "session.error");
  assert.equal(e.errorType, "message_aborted");
  assert.equal(e.aborted, true);
});
it("session.error string error", async () => {
  const p = await MaestroBootstrapPlugin({ directory: dir });
  await p.event({ event: { type: "session.error", properties: { sessionID: "s", error: "boom" } } });
  const e = readLogs(dir, "maestro-bootstrap").find((x) => x.msg === "session.error");
  assert.equal(e.errorType, "boom");
});
it("session.error empty error object", async () => {
  const p = await MaestroBootstrapPlugin({ directory: dir });
  await p.event({ event: { type: "session.error", properties: { sessionID: "s", error: {} } } });
  const e = readLogs(dir, "maestro-bootstrap").find((x) => x.msg === "session.error");
  assert.ok(e, "entry exists");
});
```
(Проверить `dir`/`readLogs` — использовать существующий helper из соседних тестов.)

- [ ] **Step 3: Прогнать тесты (проверить RED)**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: новые тесты FAIL (старый handler не пишет errorType/aborted корректно).

- [ ] **Step 4: Реализовать фикс handler**

В `core.js:889-894`, заменить блок `session.error` на:
```js
if (type === "session.error") {
  const err = properties?.error;
  const errName = typeof err === "string" ? err : err?.name ?? err?.type;
  const errMessage = typeof err === "string" ? undefined
    : err?.data?.message ?? err?.message;
  log.warn("session.error", {
    sessionID,
    errorType: errName,
    errorMessage: errMessage,
    aborted: errName === "MessageAbortedError" || err?.type === "message_aborted",
  });
}
```
(Скорректировать под факт live-верификации из Step 1, если форма отличается.)

- [ ] **Step 5: Убрать временный дамп (Step 1)**

Удалить `console.error("[maestro-bootstrap] session.error raw:", ...)` из handler.

- [ ] **Step 6: Прогнать тесты (GREEN)**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: все проходят (163 + ~5 новых = 168).

- [ ] **Step 7: Проверка чистоты**

Run: `grep -n "session.error raw" plugins/maestro-bootstrap/core.js` → 0 (дамп удалён).

- [ ] **Step 8: Commit**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js
git commit -m "fix(plugin): session.error logs errorType/errorMessage/aborted (robust to Error/legacy/string)"
```

---

### Task 4: feedback-report + manual_docs (A+B+C синк)

**Files:**
- Modify: `skills/maestro-feedback-report/SKILL.md`
- Modify: `manual_docs/reference/hitl-gates.md`
- Modify: `manual_docs/reference/config.md`

- [ ] **Step 1: feedback-report — aborted-различение**

В `skills/maestro-feedback-report/SKILL.md`, шаг 3a (агрегация session.error), изменить:
```
- **`session.error`** — ошибки сессии (отдельно: `aborted: true` — прерывания
  пользователем, НЕ сбой; в общий счётчик ошибок не включаются).
```

- [ ] **Step 2: hitl-gates.md — синк A+B**

В `manual_docs/reference/hitl-gates.md`:
- гейт/секция про повторы: заменить «до 3 попыток» на «не более 1 повтора для
  пустого/бессодержательного результата (anti-loop)»;
- добавить SCOPE NOTE упоминание в раздел про ревью (если есть).

- [ ] **Step 3: config.md — таблица лога session.error**

В `manual_docs/reference/config.md`, таблица событий лога, строка `session.error`:
```
| `session.error` | warn | `sessionID`, `errorType` (`name ?? type`), `errorMessage` (при объектной форме), `aborted` (true = прерывание пользователем) |
```

- [ ] **Step 4: Commit**

```bash
git add skills/maestro-feedback-report/SKILL.md manual_docs/reference/hitl-gates.md manual_docs/reference/config.md
git commit -m "docs(maestro): feedback-report aborted distinction, hitl-gates/config sync (P2.2)"
```

---

### Task 5: Changelog + regression entry + финальная верификация

**Files:**
- Modify: `manual_docs/overview/changelog.md`
- Create: `regression/entries/2026-09-18-subagent-resilience.md`

- [ ] **Step 1: Changelog**

В `manual_docs/overview/changelog.md`, секция `[Unreleased]` / `### Изменено`:
```
- **Отказоустойчивость сабагентов (P2.2):** anti-loop guard — не более 1 повтора
  для пустого/бессодержательного результата (per-role вердикт-контракты),
  таблица сигналов сбоев + тайм-оконная корреляция sessionID; SCOPE NOTE в
  review-промптах при неоднородном диапазоне; `session.error` логирует
  `errorType`/`errorMessage`/`aborted` (прерывание пользователем различается).
  Для «пустого» правило смягчено (1 повтор vs сразу HITL), для
  «бессодержательного» — ужесточено (1 vs 3). Regression: LOW.
```

- [ ] **Step 2: Regression entry**

Создать `regression/entries/2026-09-18-subagent-resilience.md` (по шаблону соседей):
```markdown
# Regression — отказоустойчивость сабагентов (2026-09-18)

- **version:** 1
- **feature:** feature/subagent-resilience
- **added:** 2026-09-18
- **status:** active
- **risk:** LOW
- **scenarios:**
  - **session.error с деталями:** (core.js):
    - run: форсированное прерывание диспатча (Esc) → `.maestro/logs` содержит `session.error` с `aborted: true`
    - run: `node --test plugins/maestro-bootstrap/index.test.js` → 168 pass
  - **anti-loop 1 повтор:** (SKILL.md):
    - run: grep -in "3 попыток" skills/maestro/SKILL.md → 0 (кроме L1313 trusted)
    - run: grep -in "сразу HITL" skills/maestro/SKILL.md → 0
  - **SCOPE NOTE:** (SDD SKILL.md + review-package):
    - run: review-package выводит секцию "Auxiliary commits (out of scope)"
  - **feedback-report:** aborted-прерывания не в счётчике ошибок
```

- [ ] **Step 3: Финальный grep-контроль**

Run:
```bash
grep -rn "не более 3 попыток" skills/ manual_docs/ | grep -v changelog
```
Expected: 0 (или только changelog-история).

Run: `node --test plugins/maestro-bootstrap/index.test.js` → 168 pass.

Run: `grep -n "Auxiliary commits" .opencode/skills/subagent-driven-development/scripts/review-package` → ≥1.

- [ ] **Step 4: Commit**

```bash
git add manual_docs/overview/changelog.md regression/entries/2026-09-18-subagent-resilience.md
git commit -m "docs(changelog): subagent-resilience (P2.2); regression entry LOW"
```

---

## Self-Review

- **Spec coverage:** §2-A→Task 1 (SKILL.md anti-loop, таблица, процедура), §3.2→Task 1 (spec-review-prompt), §3.3→Task 1 (обе implementer-prompt), §3.4→Task 2 (SDD+review-package), §3.5/3.6→Task 3 (core.js+тесты), §3.7→Task 4 (feedback-report), §3.8→Task 4 (hitl-gates/config), changelog/regression→Task 5. §2-B→Task 1+2.
- **C-важно:** Task 3 Step 1 (live-верификация формы) обязателен ДО фикса; дамп удаляется в Step 5; критерий «grep session.error raw → 0».
- **Placeholder scan:** нет TODO/TBD; код и команды конкретны.
- **Type/имя-консистентность:** `errName`/`aborted` согласованы в handler, тестах и config.md; per-role словарь — с реальными контрактами (проверено ревью).
- **Порядок:** Task 3 (плагин) независим; Task 1-2 (скиллы) независимы; Task 4-5 после.