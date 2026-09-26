# Skillmd References Reorg Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Разложить `skills/maestro/SKILL.md` (2400 строк) на скелет (~1180) + 10 глав `skills/maestro/references/*.md` — чистый перенос, поведение конвейера не меняется.

**Architecture:** Главы создаются дословно (per-section extraction + шапка); из скелета секции удаляются и на их место ставятся строки-указатели в точках использования. Целостность — детерминированные guards: one-shot паритет-скрипт (5.1b), перманентный тест ссылок, sweep кросс-ссылок по 28 кандидатам, regression entry.

**Tech Stack:** Markdown, Node test runner (0 зависимостей), bash/git. Плагин не меняется (0 строк кода).

**Spec:** `docs/superpowers/specs/2026-09-26-skillmd-references-reorg-design.md` (approved, opus, 2026-09-26; hash `ee0201ee…`)

## Global Constraints

- **Чистый перенос:** тело глав — дословно из SKILL.md@base (`0709e92`). Без переписывания/сжатия/переформулировок. Допустимые отличия — только: строки-указатели (spec 4.1), шапки глав (spec 4.2), замена «см. секцию X» → указатель, перелинковка ссылок внутри глав (spec 4.2).
- **SKILL.md ≤ 1300 строк** после разложения (spec 5.1-4).
- **Плагин:** `git diff --stat -- 'plugins/**/*.js'` — пусто. README плагина — ровно одна ссылка по sweep (строка 32).
- **Исторические документы не трогать:** `specs/**`, `docs/superpowers/**`, `regression/**` (кроме нового entry), changelog-записи про старые версии.
- **Язык:** русский во всех изменяемых текстах (working language).
- **Формат указателя (spec 4.1):** `— **<Тема>:** читать `references/<file>.md` из каталога скилла maestro (канон).`
- **Формат шапки главы (spec 4.2):** `# <Тема> (глава)` + строка `> Канон: <тема>. Грузится из skills/maestro/SKILL.md на <точки чтения>.` + строка «Читается оркестратором (имеющим SKILL.md в контексте)».
- **Base-коммит для паритета:** `0709e92` (HEAD main до ветки).

## Review Focus

1. **Указатель в неправильной точке** (тема нужна на шаге X, а указатель стоит на шаге Y) — оркестратор не прочитает главу вовремя → проверка: указатели только в точках использования (см. таблицу в Task 2), task-reviewer сверяет по списку.
2. **Тихое переписывание при переносе** — канон (HITL-протокол, security-правила) изменён незаметно → паритет-скрипт Task 2 + сверка task-reviewer.
3. **Сирота-глава** (файл в references/, на который нет указателя) — глава никогда не читается → тест Task 3 (check 2).
4. **Битая кросс-ссылка в другом файле** (commands/, skills/*, manual_docs) — читатель по «секции X SKILL.md» не найдёт её → sweep Task 4 + финальный grep Task 6.
5. **Рассинхрон manual_docs-копий** (напр. `manual_docs/reference/hitl-gates.md` — синхронизированная копия протокола) — доки указывают на несуществующую секцию → sweep Task 4 покрывает manual_docs.

---

### Task 1: Главы — 10 файлов `references/*.md` (дословный перенос + шапки)

**Files:**
- Create: `skills/maestro/references/hitl-gate-protocol.md`
- Create: `skills/maestro/references/model-selection.md`
- Create: `skills/maestro/references/trust-and-security.md`
- Create: `skills/maestro/references/polyrepo.md`
- Create: `skills/maestro/references/example-workflow.md`
- Create: `skills/maestro/references/spec-review.md`
- Create: `skills/maestro/references/debug-subpipeline.md`
- Create: `skills/maestro/references/regression-registry.md`
- Create: `skills/maestro/references/memory-layer.md`
- Create: `skills/maestro/references/file-path-conventions.md`
- (SKILL.md в этом задании НЕ трогать)

**Interfaces:**
- Consumes: `skills/maestro/SKILL.md` @ HEAD (секции, границы — см. таблицу ниже).
- Produces: 10 файлов, на которые ссылаются Task 2 (указатели), Task 3 (тест), Task 4 (sweep).

**Соответствие секции → файл (границы по `##`-заголовкам SKILL.md@0709e92):**

| Файл | Секции (заголовки) |
|---|---|
| `hitl-gate-protocol.md` | `## HITL Gate Protocol` (1025–1218) |
| `model-selection.md` | `## Model Selection` (1410–1633, включая `###`-подсекции) |
| `trust-and-security.md` | `## Trust Model` (1634–1716) + `## Context Sanitizer (правила детекта)` (1717–1802) + `## Security Review` (1803–1903) — три секции в одном файле, порядок сохранён, между ними разделитель `---` |
| `polyrepo.md` | `## Polyrepo: когда фича затрагивает 2+ репозитория` (2185–2219, включая `###`-подсекции) |
| `example-workflow.md` | `## Example Workflow` (2236–2400) |
| `spec-review.md` | `## Spec Review (опционально)` (1904–1925) + `## Подписи spec-файла` (1926–1990) + `## Границы ревью` (1991–2022) — порядок сохранён, разделители `---` |
| `debug-subpipeline.md` | `## Debug Sub-pipeline (багфикс)` (1219–1273) |
| `regression-registry.md` | `## Regression Registry` (2064–2141, включая `###`-подсекции) |
| `memory-layer.md` | `## Memory layer (memory_search)` (1361–1409) |
| `file-path-conventions.md` | `## File Path Conventions` (2142–2174, включая `###`-подсекции) |

Шапки (spec 4.2), точки чтения:
- hitl-gate-protocol: «каждый HITL-гейт (Overview, Pipeline)»
- model-selection: «перед первым task-диспатчем (Overview, шаги 13/16)»
- trust-and-security: «security-точки: шаги 8.6, 9, 16; trusted/untrusted-диспатчи»
- polyrepo: «шаг 1 / старт, при 2+ репозиториях»
- example-workflow: «Overview (ориентация: первый запуск с проектом)»
- spec-review: «шаги 8.6/9/10/16»
- debug-subpipeline: «шаг 1, вариант (b) — маршрут bugfix»
- regression-registry: «шаги 0/15/17»
- memory-layer: «шаг 0 (старт Plan-фазы), D1–D2»
- file-path-conventions: «шаги 8/11 (создание spec/plan/регресс-артефактов)»

**Перелинковка внутри глав (spec 4.2):** после создания каждой главы — проход по её ссылкам:
- «см. <секция, оставшаяся в скелете>» → «см. SKILL.md, <секция>»;
- «см. <секция, ушедшая в references>» → «см. `references/<file>.md`»;
- ссылки на оставшиеся в скелете шаги («шаг 10» и т.п.) — оставляются как есть (скелет в контексте оркестратора).

- [ ] **Step 1: Создать каталог и 10 файлов**

Для каждого файла: `mkdir -p skills/maestro/references`; извлечь секцию(и) из SKILL.md **дословно** (строка за строкой, без переписывания — копировать, не перепечатывать), вставить шапку (формат выше), для trust-and-security.md и spec-review.md — сохранить порядок исходных секций с разделителем `---` между ними.

- [ ] **Step 2: Перелинковать внутри глав**

По каждой главе: `grep -n 'см\.\|секцию\|SKILL\.md' skills/maestro/references/<file>.md` → применить правило перелинковки выше. Записать число правок per-глава.

- [ ] **Step 3: Проверка дословности (spot-check + полный diff)**

```bash
# spot-check: первые 20 строк тела hitl-gate-protocol.md == строки 1025–1044 SKILL.md
diff <(sed -n '1025,1044p' skills/maestro/SKILL.md) <(sed -n '/^## HITL Gate Protocol/,$p' skills/maestro/references/hitl-gate-protocol.md | head -20)
# полный контроль паритета — в Task 2 (скрипт 5.1b); здесь:
for f in skills/maestro/references/*.md; do echo "== $f: $(wc -l < "$f") строк"; done
```

Ожидаемый размер (±5 строк): hitl 194+шапка, model-selection 224+шапка, trust-and-security 270+шапки/разделители, polyrepo 35+шапка, example-workflow 165+шапка, spec-review 119+шапки/разделители, debug 55+шапка, regression 78+шапка, memory 49+шапка, file-path 33+шапка.

- [ ] **Step 4: Commit**

```bash
git add skills/maestro/references/
git commit -m "docs(reorg): главы references/*.md — 10 файлов (дословный перенос + шапки, перелинковка)"
```

**Тир implementer:** haiku (механика: копирование + шапки). **Reviewer:** sonnet (сверка дословности по 3 главам наугад + полнота списка + шапки).

---

### Task 2: Скелет — SKILL.md (выносы, указатели, перелинковка, паритет)

**Files:**
- Modify: `skills/maestro/SKILL.md` (удалить 12 секций, добавить ~13 указателей, обновить внутренние ссылки)
- Create (эфемерный, НЕ коммитить): `.maestro/parity/parity-check.mjs` + результат в `.maestro/parity/parity-result.txt`

**Interfaces:**
- Consumes: 10 файлов Task 1.
- Produces: финальный SKILL.md ≤ 1300 строк; результат паритета (вход в regression entry Task 5 и DoD Task 6).

**Указатели (формат spec 4.1) — точное размещение:**

| Указатель | Где вставить |
|---|---|
| HITL Gate Protocol | Overview, блок «Mode protocol» → «3. Run modes» (после перечисления режимов) |
| Example Workflow | Overview, конец секции (после «REQUIRED SUB-SKILLS») |
| Memory layer | шаг 0, строка «Memory layer: старт Plan-фазы…» — заменить «канон — секция «Memory layer (memory_search)»» на указатель |
| Regression Registry | шаг 0, блок «Regression registry: разрешить REGISTRY_DIR» — в начало блока |
| Debug Sub-pipeline | шаг 1, вариант (b) — после «Debug Sub-pipeline (шаги D1–D7)» |
| Polyrepo | шаг 1, после выбора маршрута (строка про изоляцию) — «при 2+ репозиториях» |
| Model Selection | Overview, блок «REQUIRED SUB-SKILLS» (строка: перед любым task-диспатчем читать главу) |
| Spec Review | шаг 9, первая строка секции; шаг 10, блок «Подписи» (заменить «см. «Подписи spec-файла»») |
| Trust and Security | шаг 8.6 (строка про sanitizer-диспатч), шаг 9 «Точка 2», шаг 16 «Точка 2 Security Review» |
| File Path Conventions | шаг 8 (spec-путь), шаг 11 (plan-путь) |
| Regression Registry | шаг 15 (блок про regression entry), шаг 17 (блок про E2E/regression) |
| Spec Review (P1.1/Границы) | шаг 16, блок «Объединение вердиктов» — «П1.1» → «см. `references/spec-review.md`, Границы ревью» |
| Model Selection | шаг 13 (SDD, tier-выбор) |

**Перелинковка в скелете:** `grep -n 'см\.\|секцию\|«<ушедшая секция>»' skills/maestro/SKILL.md` → по каждой ссылке на ушедшую секцию: заменить на указатель формата 4.1 (если тема уже имеет указатель в шаге — ссылка «см. `references/<file>.md`»).

**Паритет (spec 5.1b)** — скрипт `.maestro/parity/parity-check.mjs`:

```js
import { readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
const base = execSync('git show 0709e92:skills/maestro/SKILL.md').toString().split('\n');
const files = ['skills/maestro/SKILL.md',
  ...readdirSync('skills/maestro/references').filter(x => x.endsWith('.md'))
    .map(x => `skills/maestro/references/${x}`)];
const union = new Set();
for (const f of files) for (const l of readFileSync(f, 'utf8').split('\n')) union.add(l);
// строки, заменённые указателями/шапками/перелинковкой — классифицируются вручную ниже
const missing = base.filter(l => l.trim() !== '' && !union.has(l));
console.log(`base-строк (непустых): ${base.filter(l => l.trim() !== '').length}; не найдено дословно: ${missing.length}`);
for (const l of missing) console.log('MISSING|' + l.slice(0, 120));
```

Каждая строка `MISSING|` классифицируется: `указатель` / `шапка` / `заменена-ссылка` / `ОШИБКА`. Любая `ОШИБКА` → вернуть в Task 1/2 исправить. Итог в `.maestro/parity/parity-result.txt`: `N base-строк, M исключений (K указателей, L шапок, P заменённых ссылок), 0 ошибок`.

- [ ] **Step 1: Удалить 12 секций из SKILL.md** (по границам Task 1; после удаления — нет «дыр» с двойными пустыми строками: нормализовать до одной)
- [ ] **Step 2: Вставить указатели** (таблица выше, точные места)
- [ ] **Step 3: Перелинковать скелет** (grep + замена по правилу)
- [ ] **Step 4: Прогнать паритет** (скрипт выше; классифицировать все MISSING; 0 ошибок)
- [ ] **Step 5: Проверить лимит** `wc -l skills/maestro/SKILL.md` → ≤ 1300
- [ ] **Step 6: Commit**

```bash
git add skills/maestro/SKILL.md
git commit -m "docs(reorg): SKILL.md — скелет: 12 секций → указатели, перелинковка, паритет 0 ошибок"
```

**Тир implementer:** sonnet (критичное задание: хирургия скелета + паритет). **Reviewer:** sonnet (сверить указатели с таблицей, прогнать паритет повторно, проверить `wc -l`).

---

### Task 3: Guards — `references-coverage.test.mjs` + `npm test`

**Files:**
- Create: `skills/maestro/references-coverage.test.mjs`
- Modify: `package.json` (script `test` — добавить файл теста)

**Interfaces:**
- Consumes: результат Task 1+2 (SKILL.md + references/).
- Produces: перманентный тест в `npm test`.

- [ ] **Step 1: Написать тест** (Node test runner, 0 зависимостей)

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url)); // skills/maestro/
const skill = readFileSync(join(dir, 'SKILL.md'), 'utf8');
const refNames = readdirSync(join(dir, 'references')).filter(f => f.endsWith('.md'));
const refs = Object.fromEntries(refNames.map(f => [f, readFileSync(join(dir, 'references', f), 'utf8')]));

test('указатели SKILL.md → references/*.md разрешаются', () => {
  const mentioned = [...skill.matchAll(/references\/([\w-]+\.md)/g)].map(m => m[1]);
  assert.ok(mentioned.length >= 10, `указателей: ${mentioned.length} (ожидаем >= 10)`);
  for (const n of new Set(mentioned)) assert.ok(existsSync(join(dir, 'references', n)), `нет файла: ${n}`);
});
test('нет сирот: каждый references/*.md упомянут в SKILL.md', () => {
  for (const n of refNames) assert.ok(skill.includes(`references/${n}`), `сирота: ${n}`);
});
test('шапки глав: заголовок и «Канон:»', () => {
  for (const [n, b] of Object.entries(refs)) {
    assert.match(b, /^# .*\(глава\)/m, `${n}: заголовок`);
    assert.ok(b.includes('Канон:'), `${n}: «Канон:»`);
  }
});
test('скелет ≤ 1300 строк', () => {
  const n = skill.split('\n').length;
  assert.ok(n <= 1300, `SKILL.md: ${n} строк`);
});
test('внутренние ссылки глав разрешаются', () => {
  for (const [n, b] of Object.entries(refs)) {
    for (const m of b.matchAll(/references\/([\w-]+\.md)/g))
      assert.ok(refNames.includes(m[1]), `${n} → ${m[1]}: нет файла`);
  }
});
```

- [ ] **Step 2: Прогнать тест — должен пройти** `node --test skills/maestro/references-coverage.test.mjs`
- [ ] **Step 3: Добавить в `npm test`** (`"test": "node --test plugins/maestro-bootstrap/index.test.js maestro-install/agpack-coverage.test.mjs skills/maestro/references-coverage.test.mjs"`)
- [ ] **Step 4: Полный прогон** `npm test` → зелёный
- [ ] **Step 5: Commit**

```bash
git add skills/maestro/references-coverage.test.mjs package.json
git commit -m "test(reorg): references-coverage — указатели/сироты/шапки/лимит/внутренние ссылки (npm test)"
```

**Тир implementer:** haiku. **Reviewer:** sonnet (прогнать `npm test`; проверить, что тест реально ловит битую ссылку — временная фикстура: переименовать временную копию указателя в SKILL.md → тест падает → откатить).

---

### Task 4: Sweep кросс-ссылок (28 кандидатов)

**Files:**
- Modify (по результату grep): AGENTS.md, SECURITY.md, commands/*.md, skills/maestro-setup/*, skills/maestro-assistant/SKILL.md, skills/manual-docs/SKILL.md, skills/maestro-feedback-report/SKILL.md, manual_docs/*.md, docs/project-context.md, agents/sanitizer.md, skills/maestro/invariants.md, plugins/maestro-bootstrap/README.md

**Interfaces:**
- Consumes: итог Task 2 (новые пути глав).
- Produces: 0 живых ссылок на «секцию X SKILL.md» для ушедших секций.

**Перечень ушедших названий для grep (12):** `HITL Gate Protocol`, `Model Selection`, `Trust Model`, `Context Sanitizer`, `Security Review`, `Debug Sub-pipeline`, `Regression Registry`, `Memory layer (memory_search)`, `File Path Conventions`, `Polyrepo`, `Spec Review`, `Подписи spec-файла`, `Границы ревью`, `Example Workflow`.

- [ ] **Step 1: Гrep кандидатов**

```bash
for t in "HITL Gate Protocol" "Model Selection" "Trust Model" "Context Sanitizer" "Security Review" "Debug Sub-pipeline" "Regression Registry" "Memory layer" "File Path Conventions" "Polyrepo" "Spec Review" "Подписи spec-файла" "Границы ревью" "Example Workflow"; do
  grep -rn "$t" AGENTS.md SECURITY.md commands/ skills/ manual_docs/ docs/project-context.md agents/ plugins/maestro-bootstrap/README.md 2>/dev/null
done | grep -v 'docs/superpowers\|^specs/\|regression/'
```

- [ ] **Step 2: Классифицировать и обновить** — по каждому совпадению: (а) ссылка на секцию **как на канон** («секция X SKILL.md», «см. SKILL.md, секция X», «канон — SKILL.md, …») → обновить на `skills/maestro/references/<file>.md`; (б) общее упоминание слова (напр. «security review» как процесс в тексте) → не трогать; (в) исторический документ (specs/**, docs/superpowers/**, regression/**, changelog про старые версии) → не трогать.
- [ ] **Step 3: Контрольный grep** — повторить Step 1: 0 ссылок-канонов на ушедшие секции (кроме исторических).
- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(reorg): sweep кросс-ссылок на перенесённые секции (commands/skills/manual_docs/AGENTS/SECURITY/plugin-README)"
```

**Тир implementer:** haiku. **Reviewer:** sonnet (выбрать 5 ссылок наугад, проверить, что обновлены именно ссылки-каноны, а не обычные слова; проверить, что исторические документы не задеты: `git diff --stat` по specs/ и docs/superpowers/ — пусто).

---

### Task 5: Документационная поверхность (AGENTS, changelog, roadmap, TODO, regression entry, manual_docs)

**Files:**
- Modify: `AGENTS.md` (буллит `skills/maestro/{…}` — добавить `references/` + пометку «главы канона, загружаются по указателям»; строка про SKILL.md — добавить «скелет, ~1180 строк; главы — `references/»`)
- Modify: `manual_docs/overview/changelog.md` (баннер `> **Версия 4.14.0** — SKILL.md → references/ (главы канона, −50% контекста запуска)` + буллиты: что/why/guards; `[Unreleased]`-буллиты переезжают в секцию релиза)
- Modify: `docs/roadmap.md:111` → `Выполнено (4.14.0, 2026-09-26), ожидает dogfood-смoke (первый прогон на новой структуре)`
- Modify: `TODO.md:168` → `- [x]` (конвенция отметки выполненного)
- Create: `regression/entries/2026-09-26-skillmd-references-reorg.md`
- Modify: `manual_docs/**` — только по остаткам sweep (Task 4 мог оставить синк-контент, не ссылки: pipeline-overview/hitl-gates/model-selection/memory — проверить актуальность описаний после разложения)

**Interfaces:**
- Consumes: результат Task 1–4 (факт разложения, число глав, результат паритета).
- Produces: полную документационную поверхность фичи.

**Формат regression entry (по шаблону `regression/entries/`):**

```markdown
# version: 1
# feature: skillmd-references-reorg (4.14.0)
# date: 2026-09-26
# spec: docs/superpowers/specs/2026-09-26-skillmd-references-reorg-design.md

## Риск
Оркестратор не читает главы по указателям (поведение пайплайна деградирует
тихо: ревью/security/memory-правила применяются по «памяти», а не по канону).

## Сценарии
- (auto) `npm test` — references-coverage зелёный (указатели/сироты/шапки/лимит ≤1300/внутренние ссылки).
- (auto) паритет: N base-строк, M исключений (указатели/шапки/заменённые ссылки), 0 ошибок
  (результат: .maestro/parity/parity-result.txt, зафиксирован в этой записи).
- [Manual] Первый прогон пайплайна на новой структуре: оркестратор читает главы в
  точках использования (гейты, security-точки, диспатчи); сабагент-промпты
  self-contained. **Обязателен до пометки roadmap-пункта «Выполнено»** (spec 7-6).

## Follow-up
- FU1: spec §8 «27 кандидатов» → 28 (cosmetic).
- FU2: spec §6 «12 секций» → «10 глав/файлов» (cosmetic).
- FU3: spec §3 trust-and-security 268 → 270 (cosmetic).
- FU4: spec «dogfood-смoke» mixed-script опечатка (cosmetic).
```

- [ ] **Step 1: AGENTS.md** (буллит + строка про SKILL.md)
- [ ] **Step 2: changelog** (баннер 4.14.0 + буллиты; формат — как у 4.12.0/4.13.x)
- [ ] **Step 3: roadmap:111 + TODO.md:168**
- [ ] **Step 4: regression entry** (с реальным числом паритета из Task 2)
- [ ] **Step 5: manual_docs** — пройти 4 файла (pipeline-overview, hitl-gates, model-selection, memory): описания актуальны после разложения? Если секция описана «как в SKILL.md» — добавить указатель на главу.
- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs(reorg): AGENTS/changelog/roadmap/TODO + regression entry + manual_docs-синк"
```

**Тир implementer:** haiku. **Reviewer:** sonnet (changelog-формат против прецедента 4.13.1; regression entry против шаблона; TODO/roadmap — ровно нужные строки).

---

### Task 6: DoD-верификация (spec §7)

**Files:** — (только проверка; фиксы при отклонениях)

**Interfaces:**
- Consumes: результат Task 1–5.
- Produces: подтверждённый DoD (вход в шаг 16/гейт 17).

- [ ] **Step 1:** `npm test` → зелёный (253 прежних + 5 новых)
- [ ] **Step 2:** `git diff --stat 0709e92..HEAD -- 'plugins/**/*.js'` → пусто
- [ ] **Step 3:** `wc -l skills/maestro/SKILL.md` → ≤ 1300; `wc -l skills/maestro/references/*.md` → суммарно ≈ 1220+шапки
- [ ] **Step 4:** контрольный sweep-grep (Task 4 Step 1) → 0 живых ссылок-канонов
- [ ] **Step 5:** паритет-результат на месте (`.maestro/parity/parity-result.txt`), 0 ошибок; число совпадает с regression entry
- [ ] **Step 6:** дым-прогон указателей: открыть 3 указателя в SKILL.md наугад → файл существует → шапка «Канон:» → тема на месте
- [ ] **Step 7:** `git diff --stat 0709e92..HEAD -- specs/ docs/superpowers/ regression/` → только новый entry и новые spec/plan (исторические не задеты)
- [ ] **Step 8:** при отклонениях — фикс-коммиты; итог доложить оркестратору

**Тир implementer:** haiku. **Reviewer:** sonnet.

---

## Последовательность и коммиты

1. T1 (haiku) → review (sonnet)
2. T2 (sonnet) → review (sonnet)
3. T3 (haiku) → review (sonnet)
4. T4 (haiku) → review (sonnet)
5. T5 (haiku) → review (sonnet)
6. T6 (haiku) → review (sonnet)

Коммиты: per-task (сообщения в шагах). Bump версии (package.json/package-lock/README/project-context) — **не в плане**: шаг 18 пайплайна после merge.
