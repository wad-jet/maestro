# Parallel First Review Implementation Plan (#95)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** параллельное первое финальное ревью (code-reviewer + sonnet) с правилом
активации, guard «одна модель», M3-арбитражем и переформулировкой промпта
ревью — по спеке `docs/superpowers/specs/2026-09-25-parallel-first-review-design.md`.

**Architecture:** 0 кода — изменения только в промптах/инструкциях скилла
(`skills/maestro/SKILL.md`, `agents/code-reviewer.md`) + синхронизация
manual_docs/project-context/roadmap/changelog + regression entry. Конфиг-ключ
`review.parallel` потребляется skill-логикой (оркестратор читает `maestro_config`
на шаге 0) — плагин `maestro-bootstrap` не меняется.

**Tech Stack:** Markdown (скилл/агенты/доки), grep-ассерты для верификации,
`node --test` (regression-guard плагина).

**Spec-follow-up (из контрольного spec review, не блокировал Approve):**
- FU1 — судьба C/I-находок при невалидном «Approved» ревьюера → зашито в
  Task 2, случай A: «находки ревьюера с вердиктом Approved (в т.ч. C/I —
  невалидная комбинация по P1.1) — всегда в follow-up, не молчаливо».
- FU2 — трактовка source-границы в docs-репо → зашито в Task 2, условие 2:
  «source = любой трекаемый файл вне исключений; для docs-репо — в т.ч.
  `SECURITY.md`, `package.json`, корневые `*.sh`».
- FU3 — охват guard по frontmatter-моделям → зашито в Task 2, guard п.1:
  «frontmatter-модели `agents/*.md` вне scope — канон merge-config».
- FU4 — `Approved`+`Approved` без fix-loop → зашито в Task 2, «Совпало»:
  «при `Approved`+`Approved` fix-loop не запускается, union (Minor) → follow-up».

**Коммит spec+plan:** после аппрува плана (гейт 12) — ОДИН коммит
`docs: design + plan for parallel-first-review` (spec + этот план).
Таск-коммиты ниже — реализация.

---

### Task 1: Переформулировка `agents/code-reviewer.md`

**Files:**
- Modify: `agents/code-reviewer.md` (весь файл — замена)

- [ ] **Step 1: Заменить содержимое файла**

Файл `agents/code-reviewer.md` — полный новый текст (frontmatter без изменений,
тело — замена):

```markdown
---
description: Финальное code review ветки: git diff, история коммитов, анализ кода
mode: subagent
hidden: false
permission:
  edit: deny
  bash: allow
  task: deny
---

Ты — Code Reviewer для финального ревью ветки перед merge.

## Что уже проверено (контекст — не переоценивай)

- Task-ревью пройдены: spec compliance + code quality проверены на каждую
  задачу — локальные детали отдельных задач не переосмысливать.
- Спека утверждена на гейте 10.
- Тесты прогнаны на шаге 15 (результаты передаются в промпте диспатча).
- **Secret-scan (SEC-3) — в твоём scope:** проверь диф ветки на хардкод-
  секреты (`sk-`, `AKIA[0-9A-Z]{16}`, `-----BEGIN`, `client_secret`,
  `token=`/`key=`) и на коммит `.env*`/`*.pem/key/cert` — 0 находок, иначе
  критическое issue (блокирует merge).

## Твой фокус (в порядке приоритета)

1. **Кросс-тасковые проблемы:** взаимодействие изменённых модулей — то, что
   per-task ревью по определению не видит.
2. **Соответствие спеке:** реализация выполняет требования утверждённой
   спеки.
3. **Архитектура/целостность:** конвенции проекта (Project Context),
   архитектурные границы.
4. **Test coverage:** новое поведение покрыто тестами.
5. **Риск регрессии:** что может сломаться в ранее работавшем поведении.

## Вердикт

- Анализируй diff всей ветки через git diff/show/log.
- Severity-бакеты: Critical / Important / Minor.
- Вердикт: `Approved` / `Needs fixes` / `Reject`.
- «Needs fixes» обосновывается только открытыми Critical/Important: если все
  открытые замечания Minor — вердикт `Approved` (Minor — в подсекции Minor,
  не теряются).
- Не мутируй код и файлы — верни только отчёт ревью.

> Этот текст — канон инструкции финального ревью: при параллельном первом
> ревью (шаг 16) оркестратор копирует канон дословно в промпт диспатча
> `sonnet` (self-contained) + обёртку «не мутируй код и файлы — верни только
> отчёт ревью».
```

- [ ] **Step 2: Верификация (grep-ассерты)**

```bash
grep -c "Что уже проверено" agents/code-reviewer.md          # → 1
grep -c "Кросс-тасковые проблемы" agents/code-reviewer.md    # → 1
grep -c "канон инструкции финального ревью" agents/code-reviewer.md  # → 1
grep -c "hidden: false" agents/code-reviewer.md              # → 1 (frontmatter сохранён)
```

Ожидание: все 4 команды → `1`.

- [ ] **Step 3: Commit**

```bash
git add agents/code-reviewer.md
git commit -m "feat(review): code-reviewer.md — переформулировка (фокус/уже проверено/P1.1)"
```

---

### Task 2: SKILL.md — шаг 16 (параллельное первое ревью)

**Files:**
- Modify: `skills/maestro/SKILL.md` (секция шага 16 — заголовок 🟡 16 и тело)

- [ ] **Step 1: Заменить тело шага 16**

Найти блок (начинается строкой `🟡 16. [agent] requesting-code-review -> финальное ревью`,
заканчивается строкой `merge), не молчаливо.` перед строкой `🟡 17.`) и заменить
весь блок (включая заголовок) на:

```
🟡 16. [agent] requesting-code-review -> финальное ревью
      — **Параллельное первое ревью** (ключ `maestro.json → review.parallel`,
        прочитан на шаге 0: `auto` дефолт при отсутствии; невалидное → soft
        fallback `auto` + пометка `review:config_fallback` в анонсе):
        - **Активация (только `auto`; решает оркестратор механически, НЕ
          HITL; анонс строкой в чат: «Параллельное ревью: да/нет — причина:
          <…>»):** ЛЮБОЕ из условий — (1) категория фичи ∈ {Сложная,
          Архитектурная} (назначена на шаге 7; bugfix D-flow шага 7 нет →
          условие = false); (2) диф ≥ 3 изменённых source-файлов
          (`git diff --name-only` против базы; source = любой трекаемый файл
          вне исключений — spec/plan-артефакты, `docs/**`, changelog,
          `regression/**`, `manual_docs/**`; для docs-репо — в т.ч.
          `SECURITY.md`, `package.json`, корневые `*.sh`); (3) cross-layer
          диф: изменённые source-файлы затрагивают ≥ 2 слоёв стек-профиля
          (`docs/project-context.md`, §3 «Стек технологий»); неопределимо →
          false. `always` — параллельно всегда; `off` — всегда одиночное.
        - **Guard «одна модель»** (действует при `auto` и `always`):
          срабатывает, если идентичность моделей доказуема → одиночное.
          Процедура (перед диспатчем): (1) каждый ключ `agent.sonnet.model` /
          `agent.code-reviewer.model` — из локального
          `.opencode/opencode.json`, при отсутствии локально — из global
          `~/.config/opencode/opencode.json` (frontmatter-модели
          `agents/*.md` вне scope — канон merge-config); (2) строгое
          строковое равенство; (3) guard срабатывает, если оба ключа
          резолвнуты и равны («модели идентичны») ИЛИ оба не резолвнуты
          (обе наследуют модель сессии: «модели не заданы — обе от сессии»);
          (4) не срабатывает, если различаются ИЛИ резолвнут ровно один
          («модель <агент> не задана»).
        - **Диспатч (параллельно):** два независимых диспатча —
          `code-reviewer` (opus-тир) + `sonnet`; формат вердикта у обоих —
          бакеты + `Approved|Needs fixes|Reject` (канон — `agents/code-reviewer.md`,
          копируется в промпт sonnet дословно, self-contained). Диспатч sonnet
          — стандартный untrusted-путь (Level 1, авто-санитизация плагином) +
          обёртка «не мутируй код и файлы — верни только отчёт ревью».
      — **Объединение вердиктов:**
        - **Совпало** (`Approved`+`Approved` / `Needs fixes`+`Needs fixes` /
          `Reject`+`Reject`) → union находок (дедупликация: совпадающие по
          файлу и сути — одна запись с пометкой источника `code-reviewer` /
          `sonnet` / `оба`) → fix-loop. При `Approved`+`Approved` fix-loop не
          запускается: union (Minor) → follow-up.
        - **Расхождение** (только `Approved` vs `Needs fixes`; `Reject` —
          ниже). По P1.1 `Needs fixes` обязан опираться на открытые C/I:
          - **Случай A (зеркальный): `code-reviewer` `Needs fixes` +
            `sonnet` `Approved`** — арбитраж не нужен: решение старшего по
            рангу стоит → `Needs fixes`, fix-loop по C/I-находкам
            code-reviewer; находки sonnet (если есть, в т.ч. C/I — невалидная
            комбинация по P1.1) — всегда в follow-up, не молчаливо.
          - **Случай B: `code-reviewer` `Approved` + `sonnet` `Needs fixes`:**
            - **Пре-фильтр P1.1:** C/I у sonnet на самом деле пусты (только
              Minor) → вердикт sonnet невалиден, арбитраж не запускается →
              `Approved`; Minor sonnet — в follow-up.
            - **Арбитраж (M3):** sonnet имеет открытые C/I → короткий
              арбитражный диспатч `code-reviewer` (opus): по каждой C/I-
              находке sonnet **заново** проверить код по дифу (инструкция в
              промпте: «проверяй каждую находку по дифу, цитируй hunk в
              заключении; не опирайся на первое чтение»), заключение «находка
              валидна / невалидна»; хотя бы одна валидна → `Needs fixes` +
              fix-loop по валидным; все невалидны → `Approved` (находки
              sonnet → follow-up). Арбитраж — третий диспатч, только в
              случае B при непустых C/I у sonnet.
        - **`Reject` любого ревьюера** (совпал ли вердикт или нет) →
          эскалация к пользователю (как сейчас: пересмотр требований или
          отмена).
      — **Контрольные раунды fix-loop:** ОДИН диспатч `code-reviewer` (opus)
        по union-списку с per-finding трекингом (fixed / open (blocking) /
        follow-up); sonnet в контрольных раундах не участвует (роль — только
        первое чтение); sonnet-only находки проверяются контрольным диспатчем
        наравне; цикл «правки → контрольный раунд» — по правилам текущего
        fix-loop (эскалация rounds 4–5 без изменений).
      — **Точка 2 Security Review:** перед диспатчем code-reviewer (untrusted)
        — прогон промпта через sanitize. Trusted code-reviewer → skip.
      — **Memory layer:** опциональный `memory_search` (похожие прошлые
        ревью/регрессии) — на усмотрение ИИ; см. «Memory layer (memory_search)».
      — **Secret-scan в scope ревью (SEC-3):** code-reviewer проверяет diff
        ветки на хардкод-секреты (`sk-`, `AKIA[0-9A-Z]{16}`, `-----BEGIN`,
        `client_secret`, `token=`/`key=`) и на коммит `.env*`/`*.pem/key/cert`.
        0 находок — иначе критическое issue (блокирует merge).
      — **Трекинг issues:** оркестратор ведёт fix-loop после code review и
        трекает состояние каждого issue: `fixed` / `open (blocking)` /
        `follow-up (non-blocking)`. Follow-up фиксируется отдельно (не
        блокирует merge), не молчаливо.
```

- [ ] **Step 2: Верификация (grep-ассерты)**

```bash
grep -c "Параллельное первое ревью" skills/maestro/SKILL.md            # → ≥1
grep -c "Случай A (зеркальный)" skills/maestro/SKILL.md                # → 1
grep -c "Арбитраж (M3)" skills/maestro/SKILL.md                        # → 1
grep -c "Контрольные раунды fix-loop" skills/maestro/SKILL.md          # → 1
grep -c "Guard «одна модель»" skills/maestro/SKILL.md                  # → 1
grep -c "review:config_fallback" skills/maestro/SKILL.md               # → 1
```

Ожидание: первые 6 → указанные числа (первая — ≥1).

- [ ] **Step 3: Commit**

```bash
git add skills/maestro/SKILL.md
git commit -m "feat(review): шаг 16 — параллельное первое ревью (активация/guard/M3/контрольные раунды)"
```

---

### Task 3: SKILL.md — шаг 0 + «Границы ревью» + per-role словарь

**Files:**
- Modify: `skills/maestro/SKILL.md` (3 точечные вставки)

- [ ] **Step 1: Шаг 0 — чтение `review.parallel`**

Найти в шаге 0 блок, начинающийся строкой
`      — **Версионирование:** если в §3 есть поле «Версионирование: да»`
и оканчивающийся строкой `        после merge — bump (см. гейт 17 / шаг 18)`
(один bullet). ПОСЛЕ этого bullet (перед строкой пустой + `**Regression
registry:**`) вставить:

```
      — **`review.parallel` (шаг 16):** `maestro.json → review.parallel`
        читается на шаге 0 плагин-тулом `maestro_config` (кэш в переменной
        сессии, паттерн PROJECT_CONTEXT); дефолт `auto` при отсутствии
        ключа; невалидное → soft fallback `auto` + пометка
        `review:config_fallback` в анонсе шага 16 (паттерн
        `communication:config_fallback`).
```

- [ ] **Step 2: «Границы ревью» — строка (c)**

Найти строку таблицы:

```
| **(c) requesting-code-review** | diff всей ветки | шаг 16, post-impl | авто | **opus** | бакеты + Yes/No/With fixes |
```

заменить на:

```
| **(c) requesting-code-review** | diff всей ветки | шаг 16, post-impl | авто (первое ревью — параллель: `code-reviewer` + `sonnet`, по правилу активации; контрольные раунды — только `code-reviewer`) | **opus** (+ sonnet, первый раунд) | бакеты + `Approved`/`Needs fixes`/`Reject` (sonnet@16 — тот же словарь; арбитраж M3 — «валидна/невалидна» по C/I-находке + итоговый вердикт) |
```

- [ ] **Step 3: per-role словарь вердиктов (anti-loop)**

Найти строку:

```
      code-reviewer (шаг 16) — `Approved|Needs fixes|Reject`;
```

заменить на:

```
      code-reviewer (шаг 16) — `Approved|Needs fixes|Reject`;
      sonnet@16 (параллельное первое ревью) — `Approved|Needs fixes|Reject`
      + бакеты (как code-reviewer);
      арбитраж@16 (M3) — «валидна/невалидна» по каждой C/I-находке sonnet +
      итоговый вердикт;
```

- [ ] **Step 4: Верификация**

```bash
grep -c "review.parallel" skills/maestro/SKILL.md              # → ≥2 (шаг 0 + шаг 16)
grep -c "sonnet@16" skills/maestro/SKILL.md                    # → ≥2 (таблица (c) + словарь)
grep -c "бакеты + Yes/No/With fixes" skills/maestro/SKILL.md   # → 0 (старая строка удалена)
grep -cF "бакеты + \`Approved\`/\`Needs fixes\`/\`Reject\`" skills/maestro/SKILL.md  # → 1
```

Ожидание: ≥2 / ≥2 / 0 / 1.

- [ ] **Step 5: Commit**

```bash
git add skills/maestro/SKILL.md
git commit -m "feat(review): SKILL.md — шаг 0 (review.parallel) + Границы ревью (c) + per-role словарь"
```

---

### Task 4: manual_docs — синхронизация

**Files:**
- Modify: `manual_docs/reference/config.md`
- Modify: `manual_docs/explanation/pipeline-overview.md`
- Modify: `manual_docs/reference/model-selection.md`
- Modify: `manual_docs/explanation/agents-and-trust.md`
- Modify: `manual_docs/examples/example-feature.md`

- [ ] **Step 1: `config.md` — новый ключ `review.parallel`**

(a) Строку 15 (перечень секций):

```
нескольких секций: `trust`, `confidential`, `sanitizer_whitelist`, `communication` (опц.), `feedback_report` (опц.), `memory` (опц.).
```

заменить на:

```
нескольких секций: `trust`, `confidential`, `sanitizer_whitelist`, `communication` (опц.), `feedback_report` (опц.), `review.parallel` (опц.), `memory` (опц.).
```

(b) ПОСЛЕ блока «Ключ `feedback_report`» (строка, оканчивающаяся
`   `communication`); директивы нет → `manual` (безопасный дефолт).`), перед
строкой `### Секция \`confidential\`` вставить:

```markdown
### Ключ `review.parallel` (параллельное первое ревью)

Режим финального ревью (шаг 16): параллельно ли первое ревью выполняется
двумя агентами (`code-reviewer` + `sonnet`).

| Значение | Поведение (шаг 16) |
|---|---|
| `"auto"` (или ключ отсутствует — **дефолт**) | параллельно, если: категория фичи ∈ {Сложная, Архитектурная} ИЛИ диф ≥ 3 source-файлов ИЛИ cross-layer диф (детекция — SKILL.md, шаг 16); иначе одиночное |
| `"always"` | параллельно всегда (кроме guard «одна модель») |
| `"off"` | всегда одиночное (поведение до 4.12.0) |

- Невалидное значение → soft fallback в `auto` + пометка
  `review:config_fallback` в анонсе шага 16.
- **Guard «одна модель»:** если модели `agent.sonnet.model` /
  `agent.code-reviewer.model` доказуемо идентичны (оба заданы и равны, либо
  оба не заданы) — второе чтение бессмысленно → одиночное (анонс с причиной).
- При расхождении вердиктов двух ревьюеров — арбитраж старшего (opus) по
  C/I-находкам (M3); контрольные раунды fix-loop — только `code-reviewer`.
- Область: только пайплайн (шаг 16; шаги 9/13 не затрагиваются).
- Чтец — оркестратор (шаг 0, `maestro_config`); плагин не меняется.

```

- [ ] **Step 2: `pipeline-overview.md` — шаг 16**

(a) Строку 53 таблицы:

```
| 16 | Code Review | Финальное ревью всей ветки (`code-reviewer`, opus-tier). Secret-scan diff. Трекинг issues: fixed / open + follow-up |
```

заменить на:

```
| 16 | Code Review | Финальное ревью всей ветки. Первое ревью — параллель: `code-reviewer` (opus-tier) + `sonnet` (по `review.parallel`, дефолт `auto`; guard «одна модель»). Secret-scan diff. Расхождение вердиктов — арбитраж M3 (старший). Контрольные раунды — только `code-reviewer`. Трекинг issues: fixed / open + follow-up |
```

(b) Строку 160:

```
- **Code Review (шаг 16):** финальный ревью всей ветки, ловит cross-task проблемы.
```

заменить на:

```
- **Code Review (шаг 16):** финальный ревью всей ветки, ловит cross-task
  проблемы. Первое ревью — параллель (`code-reviewer` + `sonnet`, правило
  активации + guard «одна модель»); при расхождении вердиктов — арбитраж
  старшего (M3); контрольные раунды — только `code-reviewer`.
```

- [ ] **Step 3: `model-selection.md` — таблица контуров**

Найти строку:

```
| `code_review` (шаг 16) | opus | `code-reviewer` |
```

заменить на:

```
| `code_review` (шаг 16) | opus (+ sonnet, первый раунд — параллель по `review.parallel`) | `code-reviewer` (+ `sonnet`) |
```

- [ ] **Step 4: `agents-and-trust.md` — упоминание контура**

Найти подстроку (строка 247 оканчивается ею):

```
`code-reviewer` (шаг 16).
```

и заменить подстроку `` `code-reviewer` (шаг 16). `` на
`` `code-reviewer` (+ `sonnet` в параллельном первом раунде, шаг 16). ``
(заменяется только хвост строки; начало строки не меняется).

- [ ] **Step 5: `example-feature.md` — три слоя ревью**

Найти строку 73:

```
- **Три слоя ревью**: spec review (шаг 9) → per-task (шаг 13) → final (шаг 16).
```

заменить на:

```
- **Три слоя ревью**: spec review (шаг 9) → per-task (шаг 13) → final (шаг 16; первое ревью — параллель: `code-reviewer` + `sonnet`).
```

- [ ] **Step 6: Верификация**

```bash
grep -c "review.parallel" manual_docs/reference/config.md                # → ≥2
grep -c "арбитраж M3" manual_docs/explanation/pipeline-overview.md       # → 1
grep -c "guard «одна модель»" manual_docs/reference/config.md            # → 1
grep -c "sonnet" manual_docs/examples/example-feature.md                 # ≥1
```

Ожидание: указанные значения.

- [ ] **Step 7: Commit**

```bash
git add manual_docs/
git commit -m "docs: manual_docs — review.parallel + параллельное первое ревью (синк #95)"
```

---

### Task 5: project-context + roadmap + changelog + regression entry

**Files:**
- Modify: `docs/project-context.md` (§8)
- Modify: `docs/roadmap.md` (#95)
- Modify: `manual_docs/overview/changelog.md` ([Unreleased])
- Create: `regression/entries/2026-09-25-parallel-first-review.md`

- [ ] **Step 1: `project-context.md` §8**

Найти в §8 блок (строка после «**Git flow:**»):

```
- **Ревью:** code review через `code-reviewer`/opus на ключевых шагах пайплайна.
  С 2026-09-03 (P1.1+P1.2): Minor-находки не обосновывают blocking-вердикт во
  всех трёх контурах; на spec-гейте контрольное ревью с пустыми
  Critical/Important бакетами → fast-path Approve (Minor → follow-up).
```

заменить на:

```
- **Ревью:** code review через `code-reviewer`/opus на ключевых шагах пайплайна.
  С 2026-09-03 (P1.1+P1.2): Minor-находки не обосновывают blocking-вердикт во
  всех трёх контурах; на spec-гейте контрольное ревью с пустыми
  Critical/Important бакетами → fast-path Approve (Minor → follow-up).
  С 4.12.0 (#95): финальное ревью (шаг 16) — параллельное первое
  (`code-reviewer` + `sonnet`, ключ `maestro.json → review.parallel`,
  дефолт `auto`; guard «одна модель»); расхождение вердиктов — арбитраж
  старшего (M3); контрольные раунды — только `code-reviewer`.
```

- [ ] **Step 2: `roadmap.md` — #95 выполнено**

Найти в Волне 2 блок:

```
2. **#95** — сокращение повторных ревью: переформулировка/расширение трактовки задачи
   ревью + параллельное первое ревью на 2 агентов (sonnet + opus, только при разных
   моделях). M3: определить tie-breaker при расхождении вердиктов.
```

заменить на:

```
2. **#95** — сокращение повторных ревью. **Выполнено (4.12.0, 2026-09-25)** —
   параллельное первое ревью (sonnet + code-reviewer, правило активации +
   guard «одна модель») + переформулировка задачи ревью (фокус/«что уже
   проверено»); M3 — арбитраж старшего по C/I-находкам. Spec
   `docs/superpowers/specs/2026-09-25-parallel-first-review-design.md`.
```

- [ ] **Step 3: `changelog.md` — [Unreleased]**

В секцию `[Unreleased]` (вверху файла, существующий формат) добавить буллит
(формат — как у соседних буллитов секции):

```
- **#95 — параллельное первое финальное ревью:** шаг 16 — два независимых
  диспатча (`code-reviewer` + `sonnet`) по правилу активации
  (`maestro.json → review.parallel: auto|always|off`, дефолт `auto`) и
  guard «одна модель»; расхождение вердиктов — арбитраж старшего (M3) по
  C/I-находкам; контрольные раунды fix-loop — только `code-reviewer`;
  переформулировка `agents/code-reviewer.md` (фокус/«что уже проверено»/
  порог P1.1). Плагин — без изменений.
```

- [ ] **Step 4: regression entry**

Создать `regression/entries/2026-09-25-parallel-first-review.md` (формат —
как у `regression/entries/2026-09-24-pipeline-metrics-effort.md`; прочитать
этот файл при выполнении и повторить структуру):

```markdown
# parallel-first-review (#95)

- **date:** 2026-09-25
- **status:** active
- **version:** 4.12.0
- **spec:** docs/superpowers/specs/2026-09-25-parallel-first-review-design.md
- **plan:** docs/superpowers/plans/2026-09-25-parallel-first-review-plan.md

## Что может сломаться

- **Дрейф промпта:** переформулированный `agents/code-reviewer.md` +
  скопированный канон в диспатч sonnet — расхождение формулировок при
  будущих правках (канон — `agents/code-reviewer.md`, пометка в SKILL.md).
- **Rule-регрессия активации:** условия (категория / 3+ source-файлов /
  cross-layer) — ошибка в механике детекта на шаге 16 (не HITL).
- **M3-арбитраж:** bias «подтвердить первое чтение» — митигация:
  перепроверка по дифу с цитированием hunk; пре-фильтр P1.1.
- **P1.1:** инвариант «Minor не обосновывает blocking» не должен быть
  нарушен новыми ветками (случай A/B, пре-фильтр).

## Проверки

- `node --test plugins/maestro-bootstrap/index.test.js` (250) — без
  регрессий (плагин не меняется).
- Dogfooding: собственный шаг 16 фичи — параллельное ревью (категория
  Сложная), анонс в чат, вердикт по правилу.
- Grep-инвариант: `skills/maestro/SKILL.md` содержит «Случай A (зеркальный)»,
  «Арбитраж (M3)», «Контрольные раунды fix-loop».

## Non-goals / границы

- Шаги 9/13 не тронуты; плагин — 0 строк; `references/`-реорганизация —
  отдельная фича; #107 — отдельная фича.
```

(если у прецедентной entry другой набор полей — сверить с
`2026-09-24-pipeline-metrics-effort.md` и привести к тому же формату)

- [ ] **Step 5: Верификация**

```bash
grep -c "4.12.0" docs/project-context.md                # → ≥1
grep -c "Выполнено (4.12.0, 2026-09-25)" docs/roadmap.md # → 1
grep -c "95" manual_docs/overview/changelog.md          # ≥1
test -f regression/entries/2026-09-25-parallel-first-review.md && echo ok  # → ok
```

Ожидание: указанные значения + `ok`.

- [ ] **Step 6: Commit**

```bash
git add docs/project-context.md docs/roadmap.md manual_docs/overview/changelog.md regression/entries/2026-09-25-parallel-first-review.md
git commit -m "docs: project-context/roadmap/changelog + regression entry (#95, 4.12.0)"
```

---

### Task 6: Финальная верификация (DoD волны)

**Files:** — (только проверки)

- [ ] **Step 1: Тесты плагина (regression-guard)**

```bash
node --test plugins/maestro-bootstrap/index.test.js 2>&1 | grep -E '^ℹ (tests|pass|fail)'
```

Ожидание: `tests 250` / `pass 250` / `fail 0`.

- [ ] **Step 2: Diff-сверка со спекой (Acceptance Criteria 1–7)**

```bash
grep -n "Случай A (зеркальный)\|Арбитраж (M3)\|Контрольные раунды fix-loop\|Guard «одна модель»" skills/maestro/SKILL.md
grep -n "Что уже проверено\|Кросс-тасковые проблемы\|канон инструкции" agents/code-reviewer.md
grep -n "review.parallel" manual_docs/reference/config.md
git diff main --stat
```

Сверить по списку AC спеки: (1) шаг 16 полный (активация/guard/объединение/
M3/контрольные раунды/анонс); (2) code-reviewer.md — 3 блока; (3) ключ
задокументирован; (4) плагин 0 изменений (`git diff main --stat` — без
`plugins/`); (5) DoD-файлы изменены; (7) «Границы ревью» строка (c) + P1.1.

- [ ] **Step 3: Итог**

Если всё зелёное — готово к финальному ревью (шаг 16 пайплайна — уже по
новым правилам: категория Сложная → параллельное). Доп. коммитов нет, если
верификация не выявила правок.
