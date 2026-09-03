# HITL-Gate Defaults (P1.3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Рекомендуемый вариант по умолчанию (с обоснованием) на HITL decision gates (шаги 2, 7, 10, 12, 17) в протоколе maestro, при сохранении структурированных вариантов (a)/(b)/(c) и без дефолтов на гейтах-предпочтениях/контентных/security.

**Architecture:** Правка протокола HITL в `skills/maestro/SKILL.md` (заголовок секции + новый пункт 3а) + синхронизация `manual_docs/` (hitl-gates.md заголовок + пункт 4а; примеры и туториалы; changelog). Плагин не затрагивается.

**Tech Stack:** Markdown-промпты OpenCode-скиллов; без кода/автотестов (верификация — grep + перечитывание).

**Spec:** `docs/superpowers/specs/2026-09-03-hitl-gate-defaults-design.md`

## Global Constraints

- Русский язык (все файлы русскоязычные).
- Плагин (`plugins/**`) и внешние пакеты superpowers (`.opencode/skills/**`) не правятся.
- Термин «decision gates» унифицируется: шаги 2, 7, 10, 12, 17 (в SKILL.md и hitl-gates.md).
- «continue»/«давай»/«ок» НЕ подтверждают дефолт — только явная буква варианта.
- Дефолт предлагается ТОЛЬКО при выполненном условии-источнике; иначе вопрос остаётся открытым.
- НЕ коммитить: `CLAUDE-REVIEW-TASKS.md`, `TODO.md`.
- Regression entry не создаётся (нет сигналов миграции/breaking/API).

---

### Task 1: SKILL.md — HITL Gate Protocol (заголовок + пункт 3а)

**Files:**
- Modify: `skills/maestro/SKILL.md` (заголовок секции «HITL Gate Protocol», ~строка 722; вставка пункта 3а после строки 776, перед пунктом 4)

**Interfaces:** нет.

- [ ] **Step 1: Заменить заголовочную строку секции «HITL Gate Protocol»**

Заменить:
```
Decision gates (шаги 10, 12, 17) — явный вопрос с вариантами (a)/(b)/(c).
Остальные gates в pipeline (шаги 1, 2, 7, D2, D6, D7) следуют тому же
протоколу, но с вариантами, специфичными для каждого gate (см. inline-описание
в pipeline). Оркестратор ОБЯЗАН следовать этому протоколу для всех gates:
```
на:
```
Decision gates (шаги 2, 7, 10, 12, 17) — явный вопрос с вариантами (a)/(b)/(c),
сопровождаемый рекомендуемым дефолтом (п. 3а). Остальные gates в pipeline
(шаги 0, 1, 1.5, D2, D6, D7, а также плато и особый случай на шаге 10 и
security-гейты 8.6 / Security Review Точка 2 / File access control) следуют
тому же протоколу, но без дефолтов и с вариантами, специфичными для каждого
gate (см. inline-описание в pipeline). Оркестратор ОБЯЗАН следовать этому
протоколу для всех gates:
```

- [ ] **Step 2: Вставить пункт 3а (после пункта 3, перед пунктом 4)**

Между строкой «Если ответа нет → STOP, pipeline на паузе» (конец пункта 3) и строкой «4. **После ответа:**» вставить:
```
3а. **Дефолты в decision gates (P1.3):**
   - Для decision gates (шаги 2, 7, 10, 12, 17) оркестратор сопровождает вопрос
     рекомендуемым вариантом по умолчанию с кратким обоснованием:
     «рекомендую (a) X, потому что Y — подтвердите или выберите иное».
   - HITL подтверждает дефолт ТОЛЬКО явной буквой варианта (или явно выбирает
     иное); «continue»/«давай»/«ок» дефолт НЕ подтверждают (см. пункт 3).
   - Структурированные варианты (a)/(b)/(c) сохраняются — дефолт помечает
     рекомендованный вариант, не заменяет меню.
   - Дефолт предлагается ТОЛЬКО на этих пяти вопросах; все прочие HITL-вопросы —
     гейты 0, 1, 1.5 (предпочтения), D2/D6/D7 (контентные), плато и особый
     случай confidential на шаге 10, security-гейты (8.6, Security Review
     Точка 2, File access control) — дефолтов НЕ имеют.
   - Если условие-источник дефолта НЕ выполнено — дефолт НЕ предлагается,
     вопрос остаётся открытым, без рекомендации.
   - Источники дефолтов: шаг 2 — маршрут и режим только что выбраны (1/1.5);
     шаг 7 — категория по матрице сигналов; шаг 10 — вердикт ревью approve /
     fast-path (P1.2); шаг 12 — quality-проверки плана (шаг 11) пройдены;
     шаг 17 — только follow-up issues («не блокирует»), тесты зелёные,
     secret-scan (SEC-3) — 0 находок.
```

- [ ] **Step 3: Верификация**

Run:
- `grep -n "Decision gates (шаги 2, 7, 10, 12, 17)" skills/maestro/SKILL.md` → найдено
- `grep -c "recommend.*Дефолты в decision gates" skills/maestro/SKILL.md` → hmm, use: `grep -n "Дефолты в decision gates (P1.3)" skills/maestro/SKILL.md` → 1
- `grep -n "continue»/«давай»/«ок» дефолт НЕ подтверждают" skills/maestro/SKILL.md` → найдено
- Убедиться, что существующий fast-path-дефолт P1.2 (шаг 10 «Сходимость Revise») НЕ зачищен: `grep -c "fast-path: пустые C/I-бакеты" skills/maestro/SKILL.md` → 1

- [ ] **Step 4: Commit**

```bash
git add skills/maestro/SKILL.md
git commit -m "feat(hitl): recommended defaults on decision gates 2/7/10/12/17 — protocol 3a (P1.3)"
```

### Task 2: manual_docs/reference/hitl-gates.md (заголовок + пункт 4а)

**Files:**
- Modify: `manual_docs/reference/hitl-gates.md` (строка 8; вставка пункта 4а после строки 15, перед пунктом 5)

**Interfaces:** нет.

- [ ] **Step 1: Заменить заголовочную строку**

Заменить:
```
Decision gates (шаги 10, 12, 17) — явный вопрос с вариантами (a)/(b)/(c).
```
на:
```
Decision gates (шаги 2, 7, 10, 12, 17) — явный вопрос с вариантами (a)/(b)/(c),
сопровождаемый рекомендуемым дефолтом (п. 4а).
```

- [ ] **Step 2: Вставить пункт 4а**

Между строкой «4. **Дождаться ответа** — молчание ≠ approval.» и строкой «5. **После ответа:** …» вставить:
```
4а. **Дефолты на decision gates (P1.3):** вопросы (a)/(b)/(c) на шагах 2, 7, 10,
    12, 17 сопровождаются рекомендуемым вариантом с обоснованием
    («рекомендую (a) X, потому что Y»). Подтверждение — только явной буквой;
    «continue»/«давай» дефолт НЕ подтверждают (п. 3). Прочие гейты (0, 1, 1.5,
    D2/D6/D7, плато/особый случай шага 10, security-гейты) — без дефолтов.
    Если условие-источник не выполнено — дефолт не предлагается.
```

- [ ] **Step 3: Верификация**

Run:
- `grep -n "Decision gates (шаги 2, 7, 10, 12, 17)" manual_docs/reference/hitl-gates.md` → найдено
- `grep -n "Дефолты на decision gates (P1.3)" manual_docs/reference/hitl-gates.md` → найдено

- [ ] **Step 4: Commit**

```bash
git add manual_docs/reference/hitl-gates.md
git commit -m "docs(hitl): sync gate-defaults protocol (4a) in hitl-gates.md (P1.3)"
```

### Task 3: manual_docs/examples/example-feature.md + overview/quick-start.md

**Files:**
- Modify: `manual_docs/examples/example-feature.md` (строки 21, 36, 42, 56)
- Modify: `manual_docs/overview/quick-start.md` (строки 41, 47, 57)

**Interfaces:** нет.

- [ ] **Step 1: example-feature.md — добавить рекомендуемые дефолты в формулировки гейтов**

Заменить (строка 21):
```
Шаг 2:  HITL: "Подтверждаем старт? (a) да — pre-flight и старт — (b) отмена"
```
на:
```
Шаг 2:  HITL: "Подтверждаем старт? Рекомендую (a) да, потому что маршрут и
        режим только что выбраны — (a) да — (b) отмена"
```

Заменить (строка 36):
```
Шаг 10: HITL: spec утверждён -> (a) Approve
```
на:
```
Шаг 10: HITL: рекомендую (a) Approve, потому что вердикт ревью approve
        -> (a) Approve
```

Заменить (строка 42):
```
Шаг 12: HITL: план утверждён -> (a) Approve
```
на:
```
Шаг 12: HITL: рекомендую (a) Approve, потому что quality-проверки плана
        пройдены -> (a) Approve
```

Заменить (строка 56):
```
Шаг 17: HITL: pre-PR -> (a) Approve merge
```
на:
```
Шаг 17: HITL: рекомендую (a) Approve merge, потому что только follow-up issues,
        тесты зелёные -> (a) Approve merge
```

- [ ] **Step 2: quick-start.md — шаги 12/17 + правило continue**

Заменить (строка 41):
```
- Шаг 12 — утвердите план `(a) Approve`.
```
на:
```
- Шаг 12 — утвердите план `(a) Approve` (оркестратор порекомендует его — подтвердите буквой).
```

Заменить (строка 47):
```
- Шаг 17 — `(a) Approve merge`.
```
на:
```
- Шаг 17 — `(a) Approve merge` (рекомендуемый дефолт при зелёных тестах и только follow-up issues).
```

Заменить (строка 57, начало правила continue):
```
- `continue` / «давай» **не** являются подтверждением последующих гейтов —
```
на:
```
- `continue` / «давай» **не** являются подтверждением последующих гейтов, и НЕ
  подтверждают рекомендуемый дефолт — на гейтах с дефолтом подтверждение только
  явной буквой —
```

- [ ] **Step 3: Верификация**

Run:
- `grep -c "рекомендую (a)" manual_docs/examples/example-feature.md` → 3 (шаги 10, 12, 17; шаг 2 — «Рекомендую (a) да» заглавная — см. `grep -ci "рекомендую (a)"` → 4)
- `grep -c "порекомендует" manual_docs/overview/quick-start.md` → ≥1
- `grep -n "явной буквой" manual_docs/overview/quick-start.md` → найдено

- [ ] **Step 4: Commit**

```bash
git add manual_docs/examples/example-feature.md manual_docs/overview/quick-start.md
git commit -m "docs(hitl): align gate-default examples + continue rule (P1.3)"
```

### Task 4: changelog + pipeline-overview + run-first-feature

**Files:**
- Modify: `manual_docs/overview/changelog.md` (секция `[2026-09-03]`, «### Изменено»)
- Modify: `manual_docs/explanation/pipeline-overview.md` (проверить/выровнять формулировки гейтов 2/7/10/12/17)
- Modify: `manual_docs/tutorials/run-first-feature.md` (проверить/выровнять шаг 10)

**Interfaces:** нет.

- [ ] **Step 1: changelog.md — запись P1.3**

В секции `## [2026-09-03]`, в «### Изменено», после существующего пункта «- **Ревью: Minor больше не порождает циклы (P1.1+P1.2).** …» добавить новый пункт:
```
- **HITL: дефолты на decision gates (P1.3).** Гейты 2, 7, 10, 12, 17
  сопровождаются рекомендуемым вариантом с обоснованием («рекомендую (a) X,
  потому что Y»); HITL подтверждает только явной буквой или меняет выбор —
  «continue»/«давай» дефолт НЕ подтверждают. Дефолт предлагается только при
  выполненном условии-источнике; прочие HITL-вопросы (0/1/1.5, D2/D6/D7,
  плато и особый случай на шаге 10, security-гейты) — без дефолтов. Спека:
  `docs/superpowers/specs/2026-09-03-hitl-gate-defaults-design.md`.
```

- [ ] **Step 2: pipeline-overview.md — проверить формулировки гейтов 2/7/10/12/17**

Проверить, упоминаются ли в `manual_docs/explanation/pipeline-overview.md` гейты 2/7/10/12/17 с формулировками, противоречащими «рекомендую (a) X». Если упоминания носят справочный характер («Approve → к плану» и т.п.) — правка не требуется; зафиксировать решение в отчёте. Если есть явное «вопрос без рекомендации» — добавить слова о рекомендуемом дефолте.

- [ ] **Step 3: run-first-feature.md — проверить шаг 10**

Проверить строку про spec-гейт (шаг 10). Если там «(a) Approve → к плану · (b) Revise · (c) Reject» — варианты не меняются, дефолт не требует правки текста вариантов; при желании добавить «(оркестратор порекомендует (a) при approve-вердикте)». Зафиксировать решение в отчёте.

- [ ] **Step 4: Верификация**

Run:
- `grep -c "HITL: дефолты на decision gates (P1.3)" manual_docs/overview/changelog.md` → 1
- `grep -c "Decision gates" manual_docs/explanation/pipeline-overview.md` → зафиксировать найденное
- Отчёт: решения по pipeline-overview.md и run-first-feature.md (правка/не требуется + почему) — в отчёте задачи.

- [ ] **Step 5: Commit**

```bash
git add manual_docs/overview/changelog.md
git add manual_docs/explanation/pipeline-overview.md manual_docs/tutorials/run-first-feature.md  # если были правки
git commit -m "docs(hitl): changelog P1.3 + align gate-overview docs"
```
(если pipeline-overview/run-first-feature не менялись — `git add` только changelog).

## Проверки плана (self-review)

- Покрытие спеки: §4.1 → Task 1; §4.2 → Task 2; §4.3 → Task 4 (changelog); §4.4 → Task 4 (run-first-feature); §4.5 → Task 3 (example-feature, quick-start) + Task 4 (pipeline-overview); §5 критерии — покрыты задачами; §7 (бездефолтные) — в тексте 3а/4а.
- Follow-up из контрольного ревью: (1) полнота перечней бездефолтных — шаг 0 включён в 3а/4а; (2) лексика «continue/давай/ок» — включена в 3а; (3) fast-path P1.2 сохранён — верификация Step 3 Task 1; P3-телеметрия — примечание, вне задач.
- Placeholder-скан: все правки — точные old/new тексты; заглушек нет.
- Консистентность: термин «decision gates» унифицирован (2/7/10/12/17) во всех файлах; «continue/давай/ок не подтверждают дефолт» — единообразно.