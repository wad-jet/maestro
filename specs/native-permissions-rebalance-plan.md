# Plan: Нативный permission-бастион OpenCode при init maestro (Этап A)

## Контекст

Реализация Этапа A из `specs/native-permissions-rebalance.md` (v2): R1/R2-конфиг/
R4/R5/R6/R8/R10 — нативный fail-closed baseline + per-agent trusted-исключения +
2-й эшелон + policies для P4 + native-канон + документирование + синхронизация
доков. **Ноль изменений кода плагина** (`core.js`/`index.js` не трогаются).
R2-enforcement/R3/R7/R9 — отложены (Этап B, после V1).

Scope-решение HITL (2026-09-02): низкорисковая фаза — только skill-инструкции +
канон + docs, доставляемые в целевое приложение. **R2-конфиг включён в Этап A
после Spec Review C1** (без него нативный deny ломает trusted-канал custodian/
sanitizer).

## Критерий готовности

1. `/maestro-new` (задача 3) инструктирует писать нативные deny-baseline
   (read/edit) + 2-й эшелон (bash/glob/grep) + policies для confidential/P4.
2. `maestro-assistant` содержит native-permission канон (порядок last-match-wins,
   `*`-семантика, перевод access_policy→permission.read, 2-й эшелон).
3. `model-selection.md` документирует policies для P4.
4. `agents-and-trust.md`/`config.md` документируют doom_loop + @-invocation caveat;
   «2-й эшелон» переведён из рекомендации в стандарт init.
5. `SECURITY.md` §4/§5 отражают нативный baseline (fail-open смягчён); P6 (plugin-version)
   не меняется (R7 в Этапе B).
6. Сравнение-черновик (`.maestro/security-comparison-draft.md`) и changelog синхронизированы.
7. `custodian`/`sanitizer` имеют per-agent `read`/`glob`/`grep` allow для confidential
   (frontmatter + init-конфиг) — trusted-канал не ломается нативным deny (R2-конфиг).

## Задачи

### Task 1 — Native deny-baseline + 2-й эшелон в `/maestro-new` (R1+R4)
**Файл:** `skills/maestro-new/SKILL.md`, секция «Задача 3 → Плагин + модели агентов».

Добавить шаг генерации нативного permission-конфига в merge-config
(`.opencode/opencode.json` или global), идемпотентно, не перезаписывая существующее:

- `permission.read` deny: `docs/confidential/*` + `*.env`, `*.env.*`, `*.pem`,
  `*.key`, `*.crt`, `*.p12`, `*.pfx` (паритет built-in confidential).
- `permission.edit` deny: те же пути.
- `permission.bash` deny (2-й эшелон): `*cat*confidential*`, `*grep*confidential*`,
  `*ls*confidential*`, `*glob*confidential*`.
- `permission.glob` / `permission.grep` deny: `docs/confidential/*`.
- Правило порядка: catch-all `"*": "ask"`/`"allow"` первым, специфичные deny после
  (last-match-wins).

**Note (V3):** opencode `*` пересекает `/`, поэтому `docs/confidential/*` покрывает
вложенные (в отличие от сегментного `confGlobMatch`).

### Task 2 — Policies для P4 в `/maestro-new` (R5)
**Файл:** `skills/maestro-new/SKILL.md`, та же секция.

Добавить опциональный шаг (HITL): если пользователь хочет **enforce** P4
(trusted-агенты на изолированных моделях) — записать `experimental.policies`:
`provider.use` deny для не-одобренных / allow только разрешённых провайдеров
(global-config приоритетнее project; не перезаписывать существующее).

### Task 3 — Native-permission канон в maestro-assistant (R6)
**Файл:** `skills/maestro-assistant/SKILL.md`, новая секция после «Канон maestro.json».

Добавить канон нативного permission-слоя OpenCode (как и для maestro.json — inline):
- Глобальные deny (read/edit/bash/glob/grep для confidential + built-in).
- Per-agent exceptions: **reference** (реализация trusted-исключений нативно — Этап B,
  V1; пока оставить `confidential.trusted` плагина как канон доступа по данным).
- Правило порядка: last-match-wins, catch-all первым.
- Семантика `*`-кросс-`/` (отличие от сегментной `confGlobMatch`).
- Перевод `access_policy` → `permission.read` (когда R3 в Этапе B).
- 2-й эшелон bash/glob/grep.
- Идемпотентность, «не перезаписывать», OP-1 (рестарт).

### Task 4 — Policies в model-selection.md (R5-docs)
**Файл:** `manual_docs/reference/model-selection.md`.

Дополнить рекомендацию по локальной модели для trusted-агентов (P4): отметить
`experimental.policies` (`provider.use`) как опциональный enforced-механизм
(глобальный deny/allow провайдера в ядре), дополняющий рекомендацию.

### Task 5 — doom_loop + @-invocation caveat (R8)
**Файл:** `manual_docs/reference/config.md` + `manual_docs/explanation/agents-and-trust.md`.

- `doom_loop`: нативный guard (ask по умолчанию) при повторении одинакового вызова
  3 раза — взаимодействие с pipeline (не конфликтует; задокументировать).
- @-invocation: пользователь может вызвать любой сабагент напрямую через `@`, даже
  при `task: deny` (включая `@custodian` с доступом к confidential) — приемлемо,
  человек = источник доверия; задокументировать.

### Task 6 — SECURITY.md (R10)
**Файл:** `SECURITY.md`.

- §4 «Реализованные контрмеры»: добавить нативный permission-baseline (read/edit/
  bash/glob/grep deny для confidential при init) как часть многослойной обороны.
- §5 «Известные ограничения»: смягчить пункт fail-open — файловая защита более не
  зависит исключительно от плагина при настроенном нативном baseline; оставить, что
  sanitizer и enforcement плагина по-прежнему требуют плагина (P5-гейт сохраняется).
- P6 (plugin-version) — не менять (R7 в Этапе B).

### Task 7 — Сравнение-черновик (R10)
**Файл:** `.maestro/security-comparison-draft.md` (временный черновик исследования, не в git).

Добавить примечание о реализованном Этапе A (нативный baseline) со ссылкой на spec;
отметить, что вывод «fail-open» в §5 смягчён.

### Task 8 — agents-and-trust.md + changelog (R10)
**Файл:** `manual_docs/explanation/agents-and-trust.md`, `manual_docs/overview/changelog.md`.

- agents-and-trust.md: «2-й эшелон» — из рекомендации в стандарт init; упомянуть
  нативный baseline (read/edit) как часть стандартной конфигурации.
- changelog: запись об Этапе A.

### Task 9 — Per-agent trusted-исключения (R2-конфиг, C1)
**Файлы:** `agents/custodian.md`, `agents/sanitizer.md`, `skills/maestro-new/SKILL.md`,
`skills/maestro-assistant/SKILL.md`, `manual_docs/reference/config.md`,
`manual_docs/explanation/agents-and-trust.md`, `SECURITY.md`, сравнение-черновик
(`.maestro/security-comparison-draft.md`).

- `agents/custodian.md`, `agents/sanitizer.md`: добавить per-agent `read`/`glob`/`grep`
  `{"docs/confidential/*": "allow"}` (frontmatter).
- `skills/maestro-new/SKILL.md`: init генерирует `agent.<name>.permission` allow для
  custodian/sanitizer (необходимо поверх глобального deny — иначе trusted-канал ломается).
- `skills/maestro-assistant/SKILL.md` канон: per-agent exceptions (двухканально:
  frontmatter + merge-config); enforcement плагина остаётся defense-in-depth.
- Док-синк (config.md таблица, agents-and-trust.md модель доверия, SECURITY.md §4/§5,
  сравнение-черновик §5, changelog).
- V1 (merge agent-vs-global) — runtime-верификация pending (fixture-попытка 2026-09-02
  заблокирована недоступностью провайдера); fallback при провале — скоупить нативный
  confidential-deny из Этапа A.

## Проверка

- Консистентность: `skills/` ↔ `manual_docs/` ↔ `SECURITY.md` (правило AGENTS.md).
- Отсутствие изменений в `plugins/maestro-bootstrap/core.js`, `index.js` (Этап B).
- Trusted-исключения нативно присутствуют для `custodian`/`sanitizer` (R2-конфиг,
  Этап A); enforcement плагина НЕ удалён (R2-enforcement — Этап B, V1).
- Ссылки на секции не сломаны.