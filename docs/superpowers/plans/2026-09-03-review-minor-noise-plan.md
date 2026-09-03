# Review Minor Noise (P1.1+P1.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Жёсткое правило «Minor никогда не обосновывает blocking-вердикт» в трёх ревью-контурах (P1.1) + оркестраторный fast-path Approve при только-Minor контрольном ревью на шаге 10 (P1.2).

**Architecture:** Правки промптов и орке­страционных правил маэстро-скилла: spec-reviewer prompt (вердикт-семантика), task-reviewer диспатч (вердикт-калибровка), code-reviewer агент, блок OQ-4 шага 10 (fast-path + плато), синхронные правки (8.5, gates list, «Обработка сбоев», Example Workflow) + обязательный синк `manual_docs/`. Плагин не затрагивается.

**Tech Stack:** Markdown-промпты OpenCode-скиллов; без кода и автотестов (верификация — grep-якоря + перечитывание).

**Spec:** `docs/superpowers/specs/2026-09-03-review-minor-noise-design.md`

## Global Constraints

- Язык: русский для `skills/maestro/SKILL.md`, `agents/code-reviewer.md`, `manual_docs/**`; английский — только для вставок в `skills/maestro/spec-review-prompt.md` и диспатч-инструкции task-reviewer (спека, решение 6).
- Плагин (`plugins/**`) и внешние файлы пакета superpowers (`.opencode/skills/**`) не правятся.
- НЕ коммитить: `CLAUDE-REVIEW-TASKS.md` (untracked, временный), `TODO.md` (gitignored).
- Коммиты: conventional commits; `git add` только конкретных файлов задачи.
- Regression entry не создаётся (нет сигналов миграции/breaking/public API — промптовые правки).

---

### Task 1: spec-review-prompt.md — «Minor ⇏ revise» (P1.1, spec-контур)

**Files:**
- Modify: `skills/maestro/spec-review-prompt.md` (секция Calibration, после бакета Minor ~строка 47; секция Rules, после строки `revise` ~строка 91)

**Interfaces:** нет (правка промпта).

- [ ] **Step 1: Calibration — добавить правило после описания бакета Minor**

После строки:
```
- **Minor (Nice to Have):** polish, clarity, non-blocking suggestions.
```
добавить:
```
Minor findings **never justify verdict `revise`**: a spec whose open findings
are all Minor must receive verdict `approve`.
```

- [ ] **Step 2: Rules — ограничить обоснование `revise`**

После строки:
```
- "revise" = spec needs changes before planning (list issues).
```
добавить:
```
- `revise` is justified **only** by Critical/Important findings.
```

- [ ] **Step 3: Верификация**

Run: `grep -n "never justify verdict" skills/maestro/spec-review-prompt.md && grep -n "only.* by Critical/Important" skills/maestro/spec-review-prompt.md`
Expected: обе строки найдены; бакеты Critical/Important/Minor не тронуты; чек-лист Review Checklist не изменён (конвенции/паттерны остаются областью ревью).

- [ ] **Step 4: Commit**

```bash
git add skills/maestro/spec-review-prompt.md
git commit -m "feat(review): minor findings never justify verdict revise — spec reviewer prompt (P1.1)"
```

### Task 2: agents/code-reviewer.md + Example Workflow (P1.1, финальный контур)

**Files:**
- Modify: `agents/code-reviewer.md` (тело агента, ~строка 11)
- Modify: `skills/maestro/SKILL.md` (Example Workflow, фрагмент шага 16–17, ~строки 1711–1714)

**Interfaces:** нет.

- [ ] **Step 1: code-reviewer.md — дополнить тело агента**

После предложения «Вердикт: Approved / Needs fixes / Reject.» добавить:
```
Minor-замечания — в подсекции Minor; вердикт «Needs fixes» обосновывается
только Critical/Important — если все открытые замечания Minor, вердикт Approved.
```

- [ ] **Step 2: SKILL.md — переписать фрагмент Example Workflow (шаги 16–17)**

Заменить:
```
Шаг 16: [agent] requesting-code-review -> final review (opus)
        - Reviewer: 2 minor findings (naming, error message)
        - [agent] dispatch ONE fix-субагента с обоими findings -> fix -> approved
Шаг 17: -- HITL: pre-PR, пользователь approves merge --
```
на:
```
Шаг 16: [agent] requesting-code-review -> final review (opus)
        - Reviewer: 2 minor findings (naming, error message) -> approved
          (только-Minor — вердикт Approved без fix-диспатча); findings ->
          follow-up (non-blocking)
Шаг 17: -- HITL: pre-PR (follow-up-список: 2 Minor, не блокирует merge),
        пользователь approves merge --
```
(второй Example Workflow «Багфикс» и интерактивный пример не содержат Minor-фрагментов — не трогать).

- [ ] **Step 3: Верификация**

Run: `grep -n "подсекции Minor" agents/code-reviewer.md && grep -n "approved (только-Minor" skills/maestro/SKILL.md`
Expected: обе находки; старый анти-паттерн «dispatch ONE fix-субагента с обоими findings» в Example Workflow отсутствует: `grep -c "fix-субагента с обоими findings" skills/maestro/SKILL.md` → 0 (в Example Workflow; строка может остаться в шаге 13 легаси-описаниях — не менять).

- [ ] **Step 4: Commit**

```bash
git add agents/code-reviewer.md skills/maestro/SKILL.md
git commit -m "feat(review): minor never justifies Needs fixes — code reviewer agent + workflow example (P1.1)"
```

### Task 3: SKILL.md шаг 10 — fast-path + синхронные правки (P1.2)

**Files:**
- Modify: `skills/maestro/SKILL.md`: блок «Сходимость Revise (OQ-4)» (~строки 447–455); конец варианта (b) шага 10 (~строка 425); шаг 8.5, Spec-follow-up (~строки 319–321); перечень гейтов «HITL Gate Protocol» (~строки 708–709); таблица «Обработка сбоев», строки «Spec gate: revise (10b)» и «Spec review: revise» (~строки 1433, 1436)

**Interfaces:** нет.

- [ ] **Step 1: Переработать блок «Сходимость Revise (OQ-4, guard плато)»**

Заменить целиком:
```
        **Сходимость Revise (OQ-4, guard плато).** Оркестратор ведёт счётчик
        раундов Revise и список новых Critical/Important на каждом (на базе
        `previous_findings`, см. шаг 9 / spec-review-prompt). Если **2
        последовательных раунда** opus не добавили ни одного **нового**
        Critical/Important (только повторяют/уточняют прошлые) → оркестратор
        поднимает HITL: «Достигнуто плато: 2 раунда без новых Critical/Important.
        (a) Approve spec / (b) продолжить ещё / (c) follow-up оставшиеся».
        Новый Critical/Important **обнуляет** счётчик «2 раунда». Повторяющиеся
        не-закрытые замечания НЕ считаются «новыми».
```
на:
```
        **Сходимость Revise (OQ-4): fast-path и плато.** Оркестратор ведёт
        счётчик раундов Revise и список новых Critical/Important на каждом
        (на базе `previous_findings`, см. шаг 9 / spec-review-prompt).

        **Fast-path (только-Minor):** триггер — пустые бакеты Critical и
        Important в контрольном ревью (контрольное ревью — ревью после
        применения правок; пустые C/I-бакеты означают: все прошлые
        Critical/Important закрыты, новых нет, открытые находки — только
        Minor) → новый раунд ревью НЕ запускается. Оркестратор сразу выводит
        гейт 10 с дефолт-предложением **(a) Approve**; Minor-список
        показывается пользователю и фиксируется как **spec-follow-up**
        (OQ-5, шаг 8.5: «не блокирует Approve» → транслируется в задачи
        плана на шаге 11). Minor-список фиксируется по последнему
        контрольному ревью, с дедупликацией против уже зафиксированных
        follow-up.

        **Расхождение вердикта и бакетов.** Правила для LLM — не гарантия:
        если вердикт контрольного ревью — `revise`, но бакеты
        Critical/Important пусты, источник истины — бакеты → fast-path всё
        равно срабатывает (гейт 10 с дефолтом (a) Approve) с пометкой
        пользователю о расхождении.

        **Плато (незакрытые повторяющиеся).** Если **2 последовательных
        раунда** opus не добавили ни одного **нового** Critical/Important,
        но прошлые остались незакрытыми → оркестратор поднимает HITL:
        «Достигнуто плато: 2 раунда без новых Critical/Important.
        (a) Approve spec / (b) продолжить ещё / (c) follow-up оставшиеся».
        Новый Critical/Important **обнуляет** счётчик «2 раунда». Повторяющиеся
        не-закрытые замечания НЕ считаются «новыми».
```

- [ ] **Step 2: Вариант (b) шага 10 — пометка о fast-path**

После предложения «Если для правки требуется confidential-контекст (opus не видит его) → HITL-эскалация (см. ниже «Особый случай»).» добавить:
```
            **После контрольного ревью:** пустые бакеты Critical/Important
            (только Minor) → fast-path — см. «Сходимость Revise» ниже.
```

- [ ] **Step 3: Шаг 8.5 — расширить источники spec-follow-up**

Заменить:
```
        — **Spec-follow-up (OQ-5):** оркестратор фиксирует spec-follow-up из
          особого случая шага 10b (вариант (b)) и плато OQ-4 (вариант (c)) как
```
на:
```
        — **Spec-follow-up (OQ-5):** оркестратор фиксирует spec-follow-up из
          особого случая шага 10b (вариант (b)), плато OQ-4 (вариант (c)) и
          Minor-находок fast-path (шаг 10) как
```

- [ ] **Step 4: Перечень гейтов — строка «Сходимость Revise»**

Заменить:
```
- Шаг 10 — **Сходимость Revise** (плато: 2 раунда без новых Critical/Important):
  (a) Approve spec / (b) продолжить ещё / (c) follow-up оставшиеся (см. шаг 10b)
```
на:
```
- Шаг 10 — **Сходимость Revise** (fast-path: пустые C/I-бакеты контрольного
  ревью → дефолт (a) Approve, Minor → follow-up; плато: 2 раунда без новых
  Critical/Important при незакрытых повторах → (a) Approve / (b) продолжить /
  (c) follow-up оставшиеся) (см. шаг 10b)
```

- [ ] **Step 5: «Обработка сбоев» — обе строки Revise-цикла**

Строку:
```
| **Spec gate: revise (10b)** | re-dispatch `opus` (untrusted) для правок, оркестратор применяет их к spec (Ур.1, Слой 5); повторный Spec Review (шаг 9). При необходимости confidential-контекста — HITL: (a) trusted `custodian` (Q/A-агрегат) / (b) follow-up. Повторный 8.6 только при вовлечении trusted-контура (OQ-2). |
```
заменить на:
```
| **Spec gate: revise (10b)** | re-dispatch `opus` (untrusted) для правок, оркестратор применяет их к spec (Ур.1, Слой 5); повторный Spec Review (шаг 9); после контрольного ревью с пустыми C/I-бакетами (только Minor) — fast-path: гейт 10 с дефолтом (a) Approve без нового раунда (Minor → spec-follow-up). При необходимости confidential-контекста — HITL: (a) trusted `custodian` (Q/A-агрегат) / (b) follow-up. Повторный 8.6 только при вовлечении trusted-контура (OQ-2). |
```
Строку:
```
| **Spec review: revise** | re-dispatch `opus` для правок, оркестратор применяет их (Ур.1); при необходимости confidential-контекста — HITL: (a) trusted `custodian` / (b) follow-up. Повторить review (шаг 9); 8.6 только при trusted-контуре (OQ-2). |
```
заменить на:
```
| **Spec review: revise** | re-dispatch `opus` для правок, оркестратор применяет их (Ур.1); повторить review (шаг 9); после контрольного ревью с пустыми C/I-бакетами (только Minor) — fast-path: гейт 10 с дефолтом (a) Approve (Minor → spec-follow-up); 8.6 только при trusted-контуре (OQ-2). |
```

- [ ] **Step 6: Верификация**

Run: `grep -c "Fast-path (только-Minor)" skills/maestro/SKILL.md && grep -c "guard плато" skills/maestro/SKILL.md`
Expected: `3` (OQ-4 блок, 10b-пометка не содержит — проверить: grep "После контрольного ревью" → ≥2 вхождения: 10b + Обработка сбоев) и `0` (старый заголовок блока удалён).
Дополнительно: `grep -n "Minor-находок fast-path" skills/maestro/SKILL.md` → 1 вхождение (шаг 8.5).

- [ ] **Step 7: Commit**

```bash
git add skills/maestro/SKILL.md
git commit -m "feat(review): fast-path approve on only-minor control review — step 10 + sync points (P1.2)"
```

### Task 4: SKILL.md шаг 13d — калибровка вердикта task-reviewer (P1.1, task-контур)

**Files:**
- Modify: `skills/maestro/SKILL.md` (~строка 550, после строки «Task review: `subagent_type=sonnet` (OpenCode) / `model=sonnet` (Claude Code)»)

**Interfaces:** нет.

- [ ] **Step 1: Добавить блок калибровки**

После строки:
```
         — Task review: `subagent_type=sonnet` (OpenCode) / `model=sonnet` (Claude Code)
```
добавить:
```
          — **Калибровка вердикта при диспатче task-reviewer:** оркестратор
            добавляет в промпт (англ., в тон task-reviewer-prompt.md):
            «Minor items are never grounds for "Needs fixes"; a task whose
            open findings are all Minor must be reported Approved.» Вставка —
            только семантика вердикта; формулировки класса «flag only …» /
            «at most Minor» запрещены анти-pre-judging правилом внешнего
            SDD-скилла (не подавлять находки). Внешний fix-loop срабатывает
            только на spec ❌ / Critical/Important и подтверждённые ⚠️ —
            Minor-находки в него не попадают.
```

- [ ] **Step 2: Верификация**

Run: `grep -n "never grounds for" skills/maestro/SKILL.md`
Expected: 1 вхождение (шаг 13d); текст на английском (вставка-цитата), обёртка на русском.

- [ ] **Step 3: Commit**

```bash
git add skills/maestro/SKILL.md
git commit -m "feat(review): minor-never-blocks verdict calibration for task-reviewer dispatch (P1.1)"
```

### Task 5: manual_docs — синк (P1.1+P1.2)

**Files:**
- Modify: `manual_docs/reference/hitl-gates.md` (~строка 34)
- Modify: `manual_docs/explanation/pipeline-overview.md` (~строка 46)
- Modify: `manual_docs/explanation/agents-and-trust.md` (секция «Revise-цикл», после ~строки 135)
- Modify: `manual_docs/overview/changelog.md` (новая запись `[2026-09-03]` перед `[2026-09-02]`)
- Проверено, правка не требуется (решение зафиксировано): `tutorials/run-first-feature.md` (варианты гейта 10 не меняются), `overview/quick-start.md` (упоминаний ревью-раундов/Minor нет)

**Interfaces:** нет.

- [ ] **Step 1: hitl-gates.md — строка «Сходимость Revise»**

Заменить:
```
| 10 | Сходимость Revise (плато: 2 раунда без новых Critical/Important) | (a) Approve spec · (b) продолжить ещё · (c) follow-up оставшиеся |
```
на:
```
| 10 | Сходимость Revise — fast-path (контрольное ревью закрыло все Critical/Important, только Minor → дефолт (a) Approve, Minor → follow-up) · плато (2 раунда без новых Critical/Important при незакрытых повторах) | (a) Approve · (b) продолжить ещё · (c) follow-up оставшиеся |
```

- [ ] **Step 2: pipeline-overview.md — строка шага 10**

Заменить:
```
| 10 | Spec gate | Approve → к плану · Revise → правки opus + оркестратор применяет (Ур.1), повторный review; 8.6 только при trusted-контуре · Reject → стоп. Особый случай (нужен confidential) → HITL custodian/follow-up |
```
на:
```
| 10 | Spec gate | Approve → к плану · Revise → правки opus + оркестратор применяет (Ур.1), повторный review; после контрольного ревью с пустыми C/I-бакетами (только Minor) — fast-path: дефолт (a) Approve, Minor → follow-up; 8.6 только при trusted-контуре · Reject → стоп. Особый случай (нужен confidential) → HITL custodian/follow-up |
```

- [ ] **Step 3: agents-and-trust.md — дополнить секцию «Revise-цикл»**

После предложения «…выполняется только при вовлечении trusted-контура (правка готовится `custodian` по Q/A-агрегатам).» добавить:
```
После контрольного ревью: если бакеты Critical/Important пусты (открытые
находки — только Minor), срабатывает fast-path — гейт 10 с дефолтом (a)
Approve, Minor → spec-follow-up (не блокирует).
```

- [ ] **Step 4: changelog.md — запись [2026-09-03]**

Перед `## [2026-09-02]` вставить:
```
## [2026-09-03]

### Изменено

- **Ревью: Minor больше не порождает циклы (P1.1+P1.2).** Во всех трёх
  контурах (spec review / task review / финальное code review) Minor-находки
  не обосновывают blocking-вердикт: `revise`/`Needs fixes` — только
  Critical/Important; только-Minor-ревью возвращает approve/Approved. Fast-path
  на шаге 10: контрольное ревью с пустыми C/I-бакетами → гейт 10 с дефолтом
  (a) Approve без нового раунда; Minor → spec-follow-up (не блокирует).
  Плато-guard для незакрытых повторяющихся C/I — без изменений (2 раунда).
  Спека: `docs/superpowers/specs/2026-09-03-review-minor-noise-design.md`.
```

- [ ] **Step 5: Верификация**

Run: `grep -c "fast-path" manual_docs/reference/hitl-gates.md manual_docs/explanation/pipeline-overview.md manual_docs/explanation/agents-and-trust.md manual_docs/overview/changelog.md`
Expected: каждый файл ≥1 вхождения.
Дополнительно: `grep -rn "dispatch ONE fix-субагента" manual_docs/` → 0 (анти-паттерн не должен остаться в доках; если найдётся в иных файлах — обновить по смыслу).

- [ ] **Step 6: Commit**

```bash
git add manual_docs/reference/hitl-gates.md manual_docs/explanation/pipeline-overview.md manual_docs/explanation/agents-and-trust.md manual_docs/overview/changelog.md
git commit -m "docs(review): sync manual_docs for minor-noise rule + fast-path (P1.1+P1.2)"
```

### Task 6: spec-follow-up — централизованный инвариант в «Границах ревью» + обобщение политики расхождения

**Origin:** Minor-находки контрольного ревью (spec-follow-up, «не блокирует Approve»): M3 (словари вердиктов «Границ ревью» vs агента) и M2 (политика расхождения только для контрольного ревью).

**Files:**
- Modify: `skills/maestro/SKILL.md`: секция «Границы ревью», после последнего bullet (~строка 1425); блок «Расхождение вердикта и бакетов» из Task 3 Step 1

**Interfaces:** нет.

- [ ] **Step 1: Инвариант в «Границах ревью»**

После строки:
```
- Концептуально пересекается только «correctness + test strategy», но на разных
  объектах (spec vs код). Реальное code-review-пересечение (b)+(c) — намеренное.
```
добавить:
```
**Инвариант вердиктов (P1.1):** во всех трёх контурах Minor-находки не
обосновывают blocking-вердикт (`revise` / `Needs fixes`); ревью с открытыми
находками только Minor возвращает approve/Approved. Словарь контура (c)
(Yes/No/With fixes) эквивалентен словарю агента `code-reviewer.md`
(Approved/Needs fixes/Reject).
```

- [ ] **Step 2: Обобщить политику расхождения (контрольное → любое spec-ревью)**

В блоке «Расхождение вердикта и бакетов» (вставлен Task 3 Step 1) заменить:
```
если вердикт контрольного ревью — `revise`, но бакеты
Critical/Important пусты, источник истины — бакеты
```
на:
```
если вердикт spec-ревью (первичного или контрольного) — `revise`, но бакеты
Critical/Important пусты, источник истины — бакеты
```

- [ ] **Step 3: Верификация**

Run: `grep -n "Инвариант вердиктов" skills/maestro/SKILL.md && grep -n "первичного или контрольного" skills/maestro/SKILL.md`
Expected: оба найдены.

- [ ] **Step 4: Commit**

```bash
git add skills/maestro/SKILL.md
git commit -m "feat(review): centralized verdict invariant + generalized mismatch policy (follow-up)"
```

## Post-implementation (локально, НЕ коммитить)

- [ ] TODO.md п.59 — пометить выполненным со ссылкой на спеку/ветку (файл в `.gitignore`).
- [ ] `CLAUDE-REVIEW-TASKS.md` — не трогать (временный вводный файл; волна P1 отслеживается спеками циклов).

## Проверки плана (self-review)

- Покрытие спеки: §3.1 → Task 1; §3.2 → Task 4; §3.3 → Task 2 (агент); §3.4 → Tasks 2 (Example), 3, 6; §3.5 → Task 5; §4 (инвариант) → Task 2/4/6 + существующие механизмы шага 16; §6 → критерии в задачах + верификация. Пропусков нет.
- Placeholder-скан: все правки — точные old/new тексты; TBD/TODO-заглушек нет.
- Консистентность формулировок: «пустые бакеты Critical и Important» единообразно; вставка task-reviewer идентична в спеке и плане; «dispatch ONE fix-субагента» удаляется только из Example Workflow.
