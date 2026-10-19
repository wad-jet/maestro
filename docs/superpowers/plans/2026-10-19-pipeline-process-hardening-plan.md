# Pipeline Process Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Укрепить процесс пайплайна maestro: late-entry протокол, баннер-контракт режима, progression-guard статуса, commit-guard в mainline, дисциплины ревью/версии.

**Architecture:** Два контура: (1) канон — точечные вставки в `skills/maestro/SKILL.md` + `references/hitl-gate-protocol.md` (R1/R2/R5/R6) с производными в manual_docs и feedback-report; (2) плагин — чистые функции в `pipeline-status.js`/`merge-guard.js` + интеграция в `core.js` (R3/R4), TDD.

**Tech Stack:** Node.js ESM, Node built-in test runner (`node --test`), без новых зависимостей.

**Spec:** `docs/superpowers/specs/2026-10-19-pipeline-process-hardening-design.md`

## Global Constraints

- Инварианты ⚑1–4 не ослабляются; merge-guard — fail-closed (аномалия проверки → deny в deny-механиках).
- Все хуки плагина — `try/catch`-guarded, глобальные (не scoped к maestro-сессиям).
- Без новых npm-зависимостей; git — `child_process.execFileSync` (timeout 3000 ms).
- Рабочий язык доков/сообщений — русский.
- Docs-drift (`maestro-install/docs-drift.test.mjs`, в `npm test`) — зелёный.
- Bump версии (6.1.0 → 6.2.0) — НЕ в этом плане: выполняется на шаге 18 после merge.

## Review Focus

- `git checkout main && git commit -am "…"` one-shot → commit-guard срабатывает (effective=mainline) — тест в Task 2.
- git-исключение/таймаут в deny-режиме → `guard_error` deny (fail-closed); в warn — allow+log — тест в Task 2.
- Старый неполный маркер `{sessionID, ts}` (без `gate`/`decision`) → `marker_incomplete` deny для merge/push/commit — тест в Task 2.
- Forward-прыжок 0→14 → warning с полным каноническим skipped-списком; backward/повтор/clear — без warning — тесты в Task 1.
- Неизвестный шаг (напр. `13z`) → без warning + log, lastStep не обновляется — тест в Task 8 (SF-1).

---

### Task 1: R3 — progression warning в pipeline-status (key-совместимый, sonnet)

**Files:**
- Modify: `plugins/maestro-bootstrap/pipeline-status.js`
- Test: `plugins/maestro-bootstrap/pipeline-status.test.js`

**Interfaces:**
- Produces: `setPipelineStatus({step, totalSteps, description})` — как есть, НО state дополнительно хранит `lastStep` (normalized) и `firstAfterClear`; ответ тула `set` — JSON `{ok:true}` или `{ok:true, warning:"step_jump", skipped:[...]}` (skipped — строки канонической последовательности). `clear` сбрасывает lastStep (первый set после clear — без warning).
- Тул-схема: `step: {type:["number","string"]}` (поддерживает «7b», «18.5», «-1»).

- [ ] **Step 1: Write the failing tests** (`pipeline-status.test.js`, suite «progression warning»):
  - `jump 0→14 warns with full canonical skipped list`: set 0, set 14 → result JSON `warning==="step_jump"`, `skipped` = CANON_STEPS между «0» и «14» (строки, включ. «7b»/«7d»/«10b»/«12a»/«13f», НЕ включ. «0»/«14»).
  - `consecutive forward (0→1) — no warning`: `JSON.parse` ответа — нет поля `warning`.
  - `backward (13→10) — no warning`; `repeat (10→10) — no warning`.
  - `clear resets tracker`: set 5 → clear → set 14 → нет warning (первый после clear).
  - `substep adjacency (7→7b) — no warning`.
  - `string steps work`: set "1.5" → set "2" → нет warning (normalization «1.5»).
- [ ] **Step 2: Run to verify fail**: `node --test plugins/maestro-bootstrap/pipeline-status.test.js` — FAIL (нет warning-механики).
- [ ] **Step 3: Implement** в `pipeline-status.js`:
  - `const CANON_STEPS = ["-1","0","1","1.5","2","3","4","5","6","7","7b","7d","8","8.5","8.6","9","10","10b","11","12","12a","13","13f","14","15","15a","16","17","18","18.5"];`
  - `normalizeStep(step)`: `String(step).trim()` (числа/строки → единая строка; `18.5` → `"18.5"`).
  - `parentStep(s)`: `7b|7d → "7"`, `10b → "10"`, `12a → "12"`, иначе `s` (только для сравнения позиций).
  - position = `CANON_STEPS.indexOf(parentStep(s))`; неизвестный шаг (position === -1) → **без warning, log.info("pipeline_status:unknown_step"), lastStep НЕ обновляется**.
  - В `setPipelineStatus`: если lastStep установлен (не firstAfterClear) и pos(next) > pos(last) и `pos(next) > pos(last) + 1` → `warning: "step_jump"`, `skipped = CANON_STEPS.slice(CANON_STEPS.indexOf(lastStep) + 1, pos(next))`; результат warning возвращается через сохранённый `lastWarning` (сбрасывается на следующий set) — `getPipelineStatus()`/тул читает его. Backward/равный → warning нет, lastStep обновляется.
  - Тул `makePipelineStatusTool`: ответ `set` — `JSON.stringify({ok:true})` или `JSON.stringify({ok:true, warning, skipped})`; description тула добавить: «Forward-прыжок через канонические шаги возвращает warning step_jump — отреагируй одной строкой в чат (обоснование skip-path или откат)».
- [ ] **Step 4: Run to verify pass**: `node --test plugins/maestro-bootstrap/pipeline-status.test.js` — PASS (всё + существующие тесты).
- [ ] **Step 5: Commit**: `git add plugins/maestro-bootstrap/pipeline-status.js plugins/maestro-bootstrap/pipeline-status.test.js && git commit -m "feat(pipeline-status): step-jump progression warning (R3)"`

### Task 2: R4 — commit-guard + валидация маркера (KEY TASK → opus)

**Files:**
- Modify: `plugins/maestro-bootstrap/merge-guard.js`
- Modify: `plugins/maestro-bootstrap/core.js` (merge-guard hook-блок ~L909–929; новый context-hook для notice)
- Test: `plugins/maestro-bootstrap/merge-guard.test.js`, `plugins/maestro-bootstrap/index.test.js`

**Interfaces:**
- Produces:
  - `detectCommitCommand(command: string): boolean` — `true` при `/git\s+commit(\s|$)/` (НЕ матчит `git commit-graph`/`git commit-tree`); команда, начинающаяся с `echo` → `false`.
  - `hasMainlineSwitch(command: string): boolean` — `true` при `/git\s+(checkout|switch)\b[\s\S]*?\b(main|master)\b/` (substring-конвенция merge-ветки; false-positive `git checkout main -- path` задокументирован).
  - `checkCommitGuard(command, workdir, root, sessionID, nowMs, conf, mode): {allow, reason}` — Reasons: `not_mainline | branch_unknown | guard_error | marker_ok | no_marker | marker_bad_json | marker_session_mismatch | marker_expired | marker_incomplete`. Логика: `hasMainlineSwitch` → ветка=mainline; иначе `execFileSync("git", ["-C", workdir, "branch", "--show-current"], {timeout: 3000})`: exit 0 + пустой (trim) → `branch_unknown` allow; exit 0 + main/master → `checkMergeMarker`; иная ветка → `not_mainline` allow; **исключение/таймаут** → `mode === "deny"` ? `{allow:false, reason:"guard_error"}` : `{allow:true, reason:"guard_error"}`.
  - `checkMergeMarker` — после проверки `sessionID`/`ts` добавить: `if (data.gate !== 17 || data.decision !== "a") return { allow: false, reason: "marker_incomplete" };` (до TTL-проверки).
  - `resolveMergeGuardConf` — возвращает `{enabled, ttlSec, commitGuard}`; `commitGuard`: валидные `"warn"|"deny"|"off"`, иначе soft-fallback `"warn"`.
- Consumes: существующий `checkMergeMarker(root, sessionID, nowMs, conf)` (расширенный), `detectGuardCommand`.

- [ ] **Step 1: Write the failing tests** (`merge-guard.test.js`):
  - `detectCommitCommand`: `"git commit -m x"` → true; `"git commit-graph verify"` → false; `"git commit-tree"` → false; `"echo git commit"` → false; `"npm run x"` → false.
  - `hasMainlineSwitch`: `"git checkout main && git commit -am x"` → true; `"git switch master && git commit"` → true; `"git checkout feature/x && git commit"` → false; `"git checkout main -- path"` → true (false-positive, зафиксировано).
  - `checkCommitGuard` (git-вызов — инжект через `opts.exec` или шим модульного execFileSync — реализоватьDI-параметр `execGit`, по дефолту реальный): not-mainline → allow/not_mainline; mainline+valid marker → allow/marker_ok; mainline+no marker, mode "warn" → allow + reason `no_marker` (caller логирует); mode "deny" → allow=false; detached (execGit → `""`) → allow/branch_unknown; execGit throw, deny → allow=false/guard_error; execGit throw, warn → allow/guard_error.
  - `checkMergeMarker`: маркер `{sessionID, ts}` (без gate/decision) → `marker_incomplete`; `{sessionID, ts, gate:17, decision:"a"}` → `marker_ok`; `gate: 12` → `marker_incomplete`.
  - `resolveMergeGuardConf`: `{merge_guard:{commit_guard:"deny"}}` → `commitGuard "deny"`; `"off"` → `"off"`; `"bogus"` → `"warn"`; отсутствует → `"warn"`.
- [ ] **Step 2: Run to verify fail**: `node --test plugins/maestro-bootstrap/merge-guard.test.js` — FAIL (exports нет).
- [ ] **Step 3: Implement** в `merge-guard.js` (чистые функции; `execGit` — DI-параметр `checkCommitGuard(command, workdir, root, sessionID, nowMs, conf, mode, {execGit} = {})`, дефолт `execFileSync`; header-комментарий файла дополнить commit-guard + marker schema).
- [ ] **Step 4: Integration in `core.js`** — после merge-guard-блока (~L929):
  ```js
  if (input.tool === "shell" && mergeGuardConf.enabled && mergeGuardConf.commitGuard !== "off") {
    const cmd = typeof event.input?.command === "string" ? event.input.command : "";
    if (detectCommitCommand(cmd)) {
      const res = checkCommitGuard(cmd, typeof event.input?.workdir === "string" ? event.input.workdir : root, root, input.sessionID, Date.now(), mergeGuardConf, mergeGuardConf.commitGuard);
      const base = { sessionID: input.sessionID, callID: input.callID, mode: mergeGuardConf.commitGuard, reason: res.reason };
      if (res.allow) {
        if (res.reason !== "not_mainline" && res.reason !== "branch_unknown") {
          // mainline-коммит без/с проблемным маркером — warn-путь
          log.warn("commit_guard", { action: "warn", ...base });
          warnedCommitSessions.add(input.sessionID);
        } else { log.debug?.("commit_guard", { action: "allow", ...base }); }
      } else {
        if (mergeGuardConf.commitGuard === "deny") {
          log.warn("commit_guard", { action: "deny", ...base });
          const err = new Error(`[commit-guard:deny] git commit в mainline заблокирован: нет явного HITL-аппрува гейта 17 (маркер). Обсуди гейт 17, после явного (a) создай маркер и повтори.`);
          err.mergeGuard = true;
          throw err;
        }
        log.warn("commit_guard", { action: "warn_guard_error", ...base });
        warnedCommitSessions.add(input.sessionID);
      }
    }
  }
  ```
  - `warnedCommitSessions` — `Set` в scope плагина (паттерн fail-loud memory #77): новый context-hook (аналог `registerPipelineStatusHooks`): если сессия в Set → `out.system.push({type:"text",text:"⚠️ [commit-guard] Зафиксирован git commit в mainline без маркера гейта 17 (инвариант ⚑1). Если это мерж maestro — пройди гейт 17 (явный (a)) и создай маркер .maestro/gates/merge-<sessionID>.json {\"sessionID\",\"ts\",\"gate\":17,\"decision\":\"a\"}. Если коммит вне maestro — проигнорируй (режим warn)."})` + удаление из Set (один notice на сессию).
- [ ] **Step 5: Integration tests** (`index.test.js`, паттерн существующих merge-guard-тестов): commit на main без маркера, mode warn → tool НЕ заблокирован + `log` содержит `commit_guard warn` + context-hook injects notice (один раз); mode deny → throw `[commit-guard:deny]`; mode off → детект не срабатывает; `git commit` в `workdir` feature-ветки (execGit-шим «feature/x») → allow без warn; `git checkout main && git commit` (текущая ветка feature) → warn (effective=mainline).
- [ ] **Step 6: Run full suite**: `node --test plugins/maestro-bootstrap/index.test.js` — PASS (все: 277+новые).
- [ ] **Step 7: Commit**: `git add plugins/maestro-bootstrap/ && git commit -m "feat(merge-guard): mainline commit guard + gate/decision marker validation (R4)"`

### Task 3: R1 — late-entry протокол (канон, sonnet)

**Files:**
- Modify: `skills/maestro/SKILL.md` (шаг 0, шаг 1, таблица Anti-patterns в конце)
- Modify: `skills/maestro/references/hitl-gate-protocol.md` (§3в)

**Interfaces:** — (канон-текст; точные вставки ниже — не перефразировать).

- [ ] **Step 1: SKILL.md шаг 0** — в конец блока шага 0 (до «Regression registry») добавить:
  ```
      — **Late-entry check (6.2.0, read-only, до шага 1):** триггер — ЛЮБОЙ сигнал:
        (a) `git status --short` не пуст; (b) `git log --oneline <mainline>..HEAD` не
        пуст (mainline = main/master); (c) реализация по задаче выполнялась в этой
        сессии ДО входа в пайплайн (саморефлексия оркестратора по контексту сессии;
        покрывает «коммит прямо в main, tree чист»). Сигнал (c) в одиночестве →
        строка в чат: «Late-entry: реализация задачи видна в контексте сессии».
        Вопрос НЕ задаётся на шаге 0 — только фиксация сигнала.
  ```
- [ ] **Step 2: SKILL.md шаг 1** — после «Выбор:»-блока (до «🟡 1.5») добавить:
  ```
      — **Late-entry-вопрос (6.2.0; если сигнал был на шаге 0):** пакетом с
        маршрутным вопросом (один вызов question tool; протокол «пакетов»):
        «Обнаружены уже выполненные изменения по задаче (N файлов / M коммитов до
        старта пайплайна). Пайплайн выполняется полностью; как поступить с готовой
        реализацией?» + маршрут-варианты +:
        (a) по маршруту: feature — полный проход с ретро-дизайном (классификация,
        дизайн/спека по факту, SDD = верификация существующей реализации, шаги
        14–18.5 как обычно) / bugfix — полный проход с ретро-анализом (D1–D7 по
        факту, план, SDD = верификация, шаги 14–18.5) / spike — завершить
        spike-проход с выводом по факту (throwaway не коммитится, мержа нет);
        (b) откатить изменения и пройти пайплайн с чистого листа;
        (c) явно продолжить без пайплайна (фиксация отказа в чате; работа вне
        pipeline).
        Режимы: manual и auto-answer — всегда HITL (контентный вопрос); auto-ai —
        консервативный дефолт (a) (журнал решений); (b)/(c) — только HITL.
        Момент: auto-режимы — сразу после авто-определения маршрута (вопрос в
        пакете с ним); manual — в том же question-вызове, что и маршрут.
  ```
- [ ] **Step 3: SKILL.md Anti-patterns** — в конец таблицы добавить строку:
  ```
  | **Вход в пайплайн post-factum с готовой реализацией и перескок к шагу 14** | Late-entry check (шаг 0) + late-entry-вопрос (шаг 1) обязательны; готовая реализация не отменяет шаги 0–13 (классификация, дизайн/спека по факту, SDD-верификация). Молчаливый перескок — нарушение полноты процесса во всех режимах |
  ```
- [ ] **Step 4: hitl-gate-protocol.md §3в** — в «Никогда не авто (все режимы…）」список добавить `late-entry-вопрос (шаг 1; контентный)`; после блока «Ручное в manual / auto-answer» — строка: «Late-entry-вопрос (шаг 1): контентный; в auto-ai — консервативный дефолт (a) (журнал решений), варианты (b)/(c) — HITL.»
- [ ] **Step 5: Verify** — `grep -n "Late-entry" skills/maestro/SKILL.md skills/maestro/references/hitl-gate-protocol.md` → 4+ строки; markdown-таблица Anti-patterns не сломана (2 колонки).
- [ ] **Step 6: Commit**: `git commit -am "docs(skill): late-entry protocol for pre-existing task work (R1)"`

### Task 4: R2 — баннер-контракт режима (канон, sonnet)

**Files:**
- Modify: `skills/maestro/SKILL.md` (шаг 1; п. 3 «Run modes» в Overview)
- Modify: `skills/maestro/references/hitl-gate-protocol.md` (§3в)

- [ ] **Step 1: SKILL.md шаг 1** — после late-entry-блока (Task 3) добавить:
  ```
      — **Run-mode contract banner (6.2.0):** если установлен флаг -aa/-ai — сразу
        после определения маршрута обязательная строка в чат (контракт режима).
        -aa: «[auto-answer] Контракт режима: все шаги выполняются полностью;
        авто-принятие — только гейты из перечня 3в (с условием-источником); всегда
        HITL — по перечню 3в «Никогда не авто» (+ 7b: аппрув короткого дизайна).
        Любое сокращение процесса — вне режима.»
        -ai: «[auto-ai] Контракт режима: все шаги выполняются полностью; ИИ решает
        маршрутные/контентные решения с доп. анализом (журнал решений, сводка на
        гейтах 10/17); жёсткий пол: TDD, task-review, SEC-3, тесты (шаг 15),
        security-гейты, ⚑1–4; всегда HITL — по перечню 3в «Никогда не авто»
        (+ late-entry (b)/(c) — только HITL). Консервативный fallback — более
        полный путь. Любое сокращение процесса — вне режима.»
        Оба баннера ссылаются на never-auto-список 3в, не дублируют его текстом.
        Отсутствие баннера при авто-флаге = процессное нарушение (фиксируется в
        feedback report).
  ```
- [ ] **Step 2: SKILL.md Overview п. 3** — в конец п. 3 (после строки «— **HITL Gate Protocol:**…») добавить: «При старте с -aa/-ai — обязательный контракт-баннер (шаг 1, 6.2.0); отсутствие баннера — нарушение, фиксируется в feedback report.»
- [ ] **Step 3: hitl-gate-protocol.md §3в** — новый подпункт после «Перечень авто-гейтов»-таблицы:
  ```
    **Контракт-баннер (6.2.0):** при старте с авто-флагом оркестратор обязан
    вывести строку-контракт режима (формат — SKILL.md, шаг 1; per-mode). Баннер
    ссылается на never-auto-список и перечень 3в, не дублирует текстом. Отсутствие
    баннера = процессное нарушение (типовой отклонение в feedback report).
  ```
- [ ] **Step 4: Verify** — `grep -n "Контракт режима" skills/maestro/SKILL.md` → 2+ (шаг 1 + overview).
- [ ] **Step 5: Commit**: `git commit -am "docs(skill): run-mode contract banner for -aa/-ai (R2)"`

### Task 5: R5 — достоверность финального ревью (канон, sonnet)

**Files:**
- Modify: `skills/maestro/SKILL.md` (шаг 16, таблица Anti-patterns)

- [ ] **Step 1: SKILL.md шаг 16** — в начало блока шага 16 (после заголовка) добавить:
  ```
       — **Достоверность ревью (6.2.0):** финальное ревью выполняет реальный
         `reviewer`-сабагент (и `sonnet` при параллельном) **с фактическим доступом
         к дифу и файлам ветки** (в промпте диспатча — `<base>..HEAD`; сабагент
         читает diff/файлы сам). Ревью по описанию оркестратора без чтения
         фактического дифа (в т.ч. с запретом читать файлы) **не является ревью**:
         вердикт недействителен → re-dispatch с доступом к дифу.
  ```
- [ ] **Step 2: Anti-patterns** — новая строка:
  ```
  | **Ревью по описанию: диспатч ревью-промпта без доступа сабагента к фактическому дифу/файлам (или с запретом читать файлы)** | Вердикт такого ревью не принимается на гейте 17 (issue «review невалиден»); re-dispatch реального reviewer-сабагента с доступом к дифу (6.2.0) |
  ```
- [ ] **Step 3: Verify** — `grep -n "Достоверность ревью" skills/maestro/SKILL.md` → 1.
- [ ] **Step 4: Commit**: `git commit -am "docs(skill): final review authenticity rule — reviewer with real diff access (R5)"`

### Task 6: R6 — дисциплина версии гейта 17/шага 18 (канон, sonnet)

**Files:**
- Modify: `skills/maestro/SKILL.md` (гейт 17 — блок «Версия…», шаг 18 — блок «Bump версии…», таблица Anti-patterns)

- [ ] **Step 1: Гейт 17** — заменить блок (текущий текст «**Версия (если в project context есть версионирование):** … строка не показывается.») на:
  ```
       **Строка версии (6.2.0, обязательна при §3 `Версионирование: да` И наличии
       правил версионирования в контексте):** показать строку `Версия: <текущая> →
       <предлагаемая> (правило: <тип изменения → уровень>)` по правилам из
       PROJECT_CONTEXT; bump выполняется на шаге 18 после merge. Вариант «без
       bump» фиксируется **на самом гейте** строкой `Версия: <текущая> → без bump
       (обоснование: <docs-only/beta-модуль/…>)` — решение принимает HITL как
       часть (a) Approve. При `Версионирование: да` БЕЗ правил в контексте —
       строка `Версия: <текущая> → без bump (обоснование: нет правил
       версионирования в контексте)`. Отсутствие строки при обязательном условии =
       неполный гейт (оркестратор возвращает подготовку гейта 17).
  ```
- [ ] **Step 2: Шаг 18** — в блок «Bump версии (если на гейте 17 была строка версии…)» после существующего текста добавить: «Решение о bump (вкл. «без bump» с обоснованием) принимается на гейте 17; шаг 18 исполняет его. «Bump пропущен без решения гейта 17» — процессное нарушение (фиксируется в feedback report).»
- [ ] **Step 3: Anti-patterns** — новая строка:
  ```
  | **Гейт 17 без строки версии при `Версионирование: да` (или bump пропущен без решения гейта)** | Строка версии и решение о bump — обязательный контент гейта 17 (6.2.0); «без bump» — только явная строка с обоснованием на гейте |
  ```
- [ ] **Step 4: Verify** — `grep -n "Строка версии (6.2.0" skills/maestro/SKILL.md` → 1.
- [ ] **Step 5: Commit**: `git commit -am "docs(skill): mandatory version line at gate 17, step 18 executes gate decision (R6)"`

### Task 7: Docs sync + feedback-report + status-блок (sonnet)

**Files:**
- Modify: `manual_docs/reference/hitl-gates.md` (секции: late-entry; контракт режима; строка версии гейта 17)
- Modify: `manual_docs/reference/pipeline-status.md` (progression warning + обязанность ответить)
- Modify: `manual_docs/reference/config.md` (ключ `merge_guard.commit_guard`)
- Modify: `manual_docs/explanation/pipeline-overview.md` (сверить строки про авто-режимы/пропуски — по факту наличия)
- Modify: `skills/maestro-feedback-report/SKILL.md` (типовые отклонения)
- Modify: `skills/maestro/SKILL.md` (блок «Pipeline status indication», ~L215)

- [ ] **Step 1: `hitl-gates.md`** — три дополнения в соответствующих секциях: (1) «Поздний вход в пайплайн (late-entry, 6.2.0)»: триггеры a/b/c, момент вопроса (пакет с маршрутом), варианты (a)/(b)/(c) по маршрутам, режимы; (2) «Контракт режима (баннер)»: per-mode строки, обязательность, нарушение; (3) гейт 17: строка версии обязательна при версионировании, «без bump» — на гейте.
- [ ] **Step 2: `pipeline-status.md`** — секция «Progression warning (6.2.0)»: семантика (non-blocking, full-canonical skipped), обязанность оркестратора — одна строка в чат, известные ограничения (глобальный трекер / параллельные сессии).
- [ ] **Step 3: `config.md`** — в секцию merge_guard: `commit_guard: "warn" | "deny" | "off"` (default `"warn"`); поведение: warn = log + system-notice (один на сессию), deny = блок commit-команды в mainline без маркера (fail-closed: git-сбой → deny), off = выключено; действует при `merge_guard.enabled: true`; заметка о глобальном действии (коммиты вне maestro — notice-шум в warn-режиме).
- [ ] **Step 4: `skills/maestro-feedback-report/SKILL.md`** — в секцию типовых нарушений/отклонений добавить 4 строки: молчаливый late-entry-перескок (R1); отсутствие баннера контракта режима (R2); «ревью по описанию» без доступа к дифу (R5); гейт 17 без строки версии / bump без решения гейта (R6).
- [ ] **Step 5: SKILL.md «Pipeline status indication»** (~L215) — дополнить: «Forward-прыжок через канонические шаги возвращает `warning: step_jump` — на warning обязательна одна строка в чат (обоснование skip-path по канону или откат к пропущенному шагу).»
- [ ] **Step 6: `pipeline-overview.md`** — grep «пропуск», «авто-режим», «17» — при наличии устаревших строк (пропуски шагов допустимы в -aa, версия опциональна) — поправить; если строк нет — ничего.
- [ ] **Step 7: Verify** — `npm test` (docs-drift + все) — PASS.
- [ ] **Step 8: Commit**: `git commit -am "docs: manual_docs + feedback-report + status-block sync for R1–R6"`

### Task 8: Regression entry + spec-follow-ups (sonnet)

**Files:**
- Create: `regression/entries/2026-10-19-pipeline-process-hardening.md`
- Modify: `plugins/maestro-bootstrap/pipeline-status.test.js` (SF-1)
- Modify: `docs/superpowers/specs/2026-10-19-pipeline-process-hardening-design.md` (SF-2 — только формулировку, НЕ подписи)

- [ ] **Step 1: SF-1 test** — в `pipeline-status.test.js`: `unknown step ("13z") → no warning, lastStep unchanged` (set 13 → set "13z" → нет warning; set 14 → skipped считается от 13, не от "13z"). Запустить: PASS.
- [ ] **Step 2: SF-2 spec-формулировка** — в R3-п.1 заменить «включая подшаги 7b/7d/10b/12a/15a как отдельные элементы» на «включая 7b/7d/10b/12a/13f/15a как отдельные элементы последовательности». ⚠️ Это меняет hash spec → перестампувать ОБЕ подписи (`maestro:sanitize`, `maestro:review`) новым hash по канону (script-паттерн: strip блоков → sha256 → append).
- [ ] **Step 3: Regression entry** — `regression/entries/2026-10-19-pipeline-process-hardening.md` по шаблону соседних entry: фича, коммит-якорь (HEAD при записи), риски/сценарии: (1) late-entry: tree с uncommitted → сигнал (a) + вопрос пакетом с маршрутом; (2) banner: -aa старт → строка контракта в чате; (3) step_jump: set 0 → set 14 → warning + строка в чат; (4) commit-guard warn: `git commit` на main без маркера → notice один раз; (5) commit-guard deny: то же → блок `[commit-guard:deny]`; (6) `git checkout main && git commit` → effective=mainline; (7) git-сбой в deny → fail-closed; (8) маркер без gate/decision → `marker_incomplete`; (9) negative: «ревью по описанию» → issue «review невалиден»; (10) negative: гейт 17 без строки версии → неполный гейт.
- [ ] **Step 4: Verify** — `node --test plugins/maestro-bootstrap/index.test.js` — PASS.
- [ ] **Step 5: Commit**: `git commit -am "docs: regression entry + spec follow-ups SF-1/SF-2 (pipeline-process-hardening)"`

---

## Post-merge (шаг 18, НЕ в SDD)

- Bump 6.1.0 → **6.2.0**: `package.json`, `docs/project-context.md` §3, `AGENTS.md`, `README.md` (строки с версией — D1c), `manual_docs/overview/changelog.md` — секция `## [2026-10-19]` + `> **Версия 6.2.0** — <кратко>` с ДВУМА группами записей: (1) доработки конфигурации моделей/агентов (ретро-запись за merge `e38ea1d`); (2) pipeline process hardening (R1–R6). Отдельный коммит `chore: bump version to 6.2.0 — late-entry, mode banner, guards, disciplines (changelog/version)`.
