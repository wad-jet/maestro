# Model Selection (глава)

> Канон: model-selection. Грузится из `skills/maestro/SKILL.md` перед первым task-диспатчем (Overview, шаги 13/16).
> Читается оркестратором (имеющим SKILL.md в контексте); внутри главы
> допускаются ссылки «см. SKILL.md, <секция скелета>» и на другие главы.

## Model Selection

Модели настраиваются пользователем. Выбор делает оркестратор по tier-правилам
ниже. Способ диспатча зависит от харнеса:

- **Claude Code:** параметр `model` у Agent tool (алиасы `haiku`/`sonnet`/`opus`/`fable`)
- **OpenCode:** диспатч **именованного сабагента** через `task` tool с
  `subagent_type` = `haiku` | `sonnet` | `opus`. Модель жёстко привязана к
  сабагенту в merge-конфиге (`agent.{haiku,sonnet,opus}.model` в
  `.opencode/opencode.json` или global). Task tool
  не поддерживает per-dispatch выбор модели — поэтому для OpenCode оркестратор
  выбирает **сабагента**, а не модель.

### Tier → тип задачи

| Tier | Когда использовать | OpenCode сабагент |
|---|---|---|
| **Haiku** (Быстрая/дешёвая) | Механические task-и: 1-2 файла, полный spec, трансляция+тесты | `haiku` |
| **Sonnet** (средняя/сбалансированная) | Интеграционные task-и: multi-file, pattern matching, debugging | `sonnet` |
| **Opus** (наиболее мощная) | Архитектура, spec formation, design judgment, final whole-branch review | `custodian` (Q/A по confidential), `opus` (spec review), `code-reviewer` (code review). На Revise (шаг 10b) `opus` **выдаёт структурированные правки**, а не пишет в файл (`edit: deny` сохраняется) |
| **Fable** (креативная) | Примеры, метафоры, аналогии, пояснения в стиле историй | `fable` |

### Шаг → Tier (встроенный `step_to_tier`)

| Шаг | Tier | OpenCode сабагент |
|---|---|---|
| `spec_formation` (шаг 8) | opus | `custodian` (trusted, Q/A по confidential) |
| `spec_review` (шаг 9) | opus | `opus` (untrusted; на Revise-цикле выдаёт правки, применяет оркестратор) |
| `security_review` (шаг 8.6) | sanitizer | `sanitizer` (trusted) |
| `task_reviewer` (шаг 13, per-task) | sonnet | `sonnet` |
| `code_review` (шаг 16) | opus | `code-reviewer` |
| `implementer_mechanical` (шаг 13, 1-2 файла) | haiku | `haiku` |
| `implementer_integration` (шаг 13, multi-file) | sonnet | `sonnet` |
| `explain` (по запросу, примеры/метафоры) | fable | `fable` |
| `decision_medium` (auto-ai, средние решения) | sonnet | `sonnet` (батч вопросов, промпт `auto-ai-decision-prompt.md`) |
| `decision_complex` (auto-ai, сложные решения) | opus | `opus` (батч вопросов, промпт `auto-ai-decision-prompt.md`) |

**Decision → Tier (auto-ai, п. 3в):** механические авто-принятия (набор auto-answer:
источник-условие P1.3/matrix/guard) и security-дефолты (risk-reducing) применяет
**оркестратор сам, без диспатча** — решение уже обосновано источником. Сужденческие
решения — диспатч **батчами** (несколько вопросов — один промпт) через
`auto-ai-decision-prompt.md`: `sonnet` (средние: маршрут при неоднозначности, имя
ветки, Spec Review offer, docs-шаг, project-context обновление/пересборка, D6/D7,
custodian-сходимость) · `opus` (сложные: brainstorm Q/A по архитектуре/design, D2,
spec-уровневые). **Эскалация:** sonnet вернулся `low` (неуверенность) → повторный
диспатч `opus`. **`HITL_REQUIRED` по hard-rule** (⚑4 контракты, security-риск-
принятие, инвариантные гейты) — сразу к человеку, БЕЗ эскалации (hard rules у
sonnet и opus идентичны, повторный диспатч не изменит вердикт). **Fallback:** opus
тоже неуверен → консервативный выбор (более
полный путь), фиксируется в журнал решений. Confidential-зависимые вопросы — trusted
`custodian` (шаг 8). Перед untrusted-диспатчем — sanitize (Точка 2); decision-агент
read-only, применяет оркестратор.

**Fix-loop эскалация (rounds 4-5):** минимум на tier выше предыдущей попытки.

> Без явного выбора tier сабагент наследует модель сессии (часто самую дорогую)
> — это молча разрушает экономику tier-выбора. Всегда диспатчить сабагента
> нужного tier'а.

### OpenCode: именованные сабагенты

Сабагенты объявлены в `.opencode/agents/` как markdown-файлы. Модели
настраиваются в `.opencode/opencode.json` или global (merge), пермишены — в
`.opencode/agents/*.md`:

| Сабагент | Файл конфигурации |
|---|---|
| `haiku` | `.opencode/agents/haiku.md` + `agent.haiku.model` (`.opencode/opencode.json`/global) |
| `sonnet` | `.opencode/agents/sonnet.md` + `agent.sonnet.model` (`.opencode/opencode.json`/global) |
| `opus` | `.opencode/agents/opus.md` + `agent.opus.model` (`.opencode/opencode.json`/global) |
| `custodian` | `.opencode/agents/custodian.md` + `agent.custodian.model` (`.opencode/opencode.json`/global) |
| `code-reviewer` | `.opencode/agents/code-reviewer.md` + `agent.code-reviewer.model` (`.opencode/opencode.json`/global) |
| `fable` | `.opencode/agents/fable.md` + `agent.fable.model` (`.opencode/opencode.json`/global) |
| `sanitizer` | `.opencode/agents/sanitizer.md` + `agent.sanitizer.model` (`.opencode/opencode.json`/global) |

Все под-агенты, кроме `code-reviewer`, объявлены `hidden: true` — не показываются
в `@`-меню, вызываются только программно через `task` tool. `code-reviewer`
(`hidden: false`) виден в `@`-меню — standalone-ревью доступно напрямую.

- `permission` — `haiku`/`sonnet` могут редактировать файлы и запускать bash
  (имплементация), `opus`/`fable`/`sanitizer` — read-only без bash (ревью,
  объяснения, security-пометки). **`opus` сохраняет `edit: deny` на Revise-цикле:
  он выдаёт структурированные правки, а применяет их к spec оркестратор**,
  `code-reviewer` — `bash: allow` (git
  diff/log/show), `edit: deny` (без мутаций), `custodian` — `edit: deny`
  (Q/A-брокер, не пишет spec), `bash: deny` (без запуска команд), `task: deny`
  (без вложенных сабагентов).
- `task: deny` — агенты не диспатчат вложенные под-агенты
  (один уровень вложенности).

**При диспатче:** оркестратор по таблице «Шаг → Tier» определяет нужный tier,
маппит tier → имя агента (`haiku`/`sonnet`/`opus`/`custodian`/`code-reviewer`/`fable`/`sanitizer`),
диспатчит через `task` tool с `subagent_type` = имени агента. Доступность модели
обеспечивает провайдер OpenCode — отдельная проверка не требуется.

**Trust check перед диспатчем (два измерения):** оркестратор проверяет
`maestro.json` (загружен на шаге 0). Trust-статус управляет **двумя**
измерениями защиты:

| Trust | Sanitize промпта | Файл-доступ |
|---|---|---|
| **trusted** (`true` в `maestro.json`) | **skip** | по нативным permissions opencode (без дополнительных ограничений сверх нативных) |
| **untrusted** (default) | Уровень 1 + Уровень 2 (`references/trust-and-security.md`) | нативный permission-слой opencode |

- **Sanitize промпта:** для untrusted — прогон через Security Review (`references/trust-and-security.md`). Для trusted — промпт уходит как есть.
- **Файл-доступ:** нативный permission-слой opencode (`.opencode/opencode.json`
  или global): `read`/`glob`/`grep` deny `maestro.json`/`.maestro/**`,
  `edit`-ask `maestro.json`, confidential-deny — см. канон нативных permissions
  в `maestro-assistant`. Плагин `maestro-bootstrap` file-доступ не перехватывает.
- **`sanitizer` сабагент — trusted:** единственный, кому разрешено видеть сырые
  данные (чтобы пометить). Его собственный промпт при диспатче **не** санизируется
  (он доверенный) — рекурсии нет.

### Anti-loop: диспатч и повторы

Guard от петель диспатча (пустые/ошибочные результаты субагентов, текстовые
«нарративы диспатча» без реального вызова). Применяется ко всем диспатчам
субагентов (шаги 9, 13, 16):

1. **Диспатч — только через реальный `task` tool.** Не наррировать
   «Диспатчу Task N.» текстом без вызова `task` с `subagent_type`. Текст без
   вызова = петля, а не диспатч — так не делать.
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
      sonnet@16 (параллельное первое ревью) — `Approved|Needs fixes|Reject`
      + бакеты (как code-reviewer);
      арбитраж@16 (M3) — «валидна/невалидна» по каждой C/I-находке sonnet +
      итоговый вердикт;
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
3. **Превышение лимита → HITL:** пояснить пользователю статус (сколько попыток,
   последняя ошибка/пустой результат) и предложить варианты:
   (a) продолжить / (b) изменить формулировку / (c) отменить.
   Без ответа — STOP, ничего не диспатчить дальше.
4. **Связь с Fix-loop эскалацией (rounds 4-5, см. выше):** эскалация tier
   применяется к *содержательным* повторам (когда результат есть, но ревью
   находит проблемы). При пустом/бессодержательном результате — по п. 2-3
   (1 повтор → HITL), без тиражирования tier-эскалаций на пустые попытки.
5. **Отмена/прерывание диспатча ≠ отказ от ревью.** Обязательное ревью
   (spec-review для архитектурных — безусловно, task-review для каждой задачи,
   финальное code-review) возобновляется пере-диспатчем (см. п. 2-3; сигналы
   `aborted: true` / «повис» из таблицы выше — одна и та же реакция: возобновить).
   Единственный выход без прохождения обязательного ревью — отмена фичи целиком
   (существующие варианты (c) Reject / отмена); отдельных «скип-ответов» для
   обязательных ревью не существует («пользователь не может отказаться», шаг 9).
   Не переходить к плану/мержу с непройденным обязательным ревью.

### OpenCode Dispatch Override

SDD-шаблоны из superpowers (`implementer-prompt.md`, `task-reviewer-prompt.md`,
`code-reviewer.md`) используют Claude Code-конвенцию:
```
Subagent (general-purpose):
  model: haiku
  prompt: |
    ...
```

OpenCode `task` tool **не принимает** параметр `model` — модель жёстко
привязана к именованному сабагенту в merge-конфиге (`.opencode/opencode.json` или
global). Поэтому оркестратор
транслирует вызов по таблице «Шаг → Tier»:

| SDD-шаблон пишет | Шаг → Tier | OpenCode subagent_type |
|---|---|---|
| `Subagent (general-purpose): model: haiku` | `implementer_mechanical` | `haiku` |
| `Subagent (general-purpose): model: sonnet` | `implementer_integration` | `sonnet` |
| `Subagent (general-purpose): model: sonnet` | `task_reviewer` | `sonnet` |
| `Subagent (general-purpose): model: opus` (или без model) | `spec_review` | `opus` |
| `Subagent (general-purpose): model: opus` (или без model) | `code_review` | `code-reviewer` |

**Правила трансляции:**
1. Поле `model:` в SDD-шаблонах **игнорируется** — агент определяется по `step_to_tier`.
2. Имя `general-purpose` не регистрируется как сабагент — это артефакт
   Claude Code-конвенции. В OpenCode он транслируется в named-агента.
3. Prompt из шаблона передаётся как `prompt` в `task` tool без изменений.

Пример:
```
# Вместо SDD-нотации:
Subagent (general-purpose):
  model: haiku
  prompt: |  # implementer-prompt.md
    ...

# OpenCode-диспатч:
task(
  subagent_type="haiku",
  prompt="..."  # implementer-prompt.md
)
```
