# План: скилл и команда `maestro-assistant`

> Статус: **согласовано (план утверждён, реализация НЕ начата)**.
> Дата: 2026-08-21. Репо: `maestro-agent` (authoring).
> Связь: дополняет `specs/maestro-init-tasks-plan.md` (init остаётся оркестратором
> setup); вводит общий источник правил конфигурации/процессов, доступный init,
> maestro и HITL-консультациям.
>
> **Поглощает `specs/mirror-removal-plan.md`** (Этап 0, CRIT-B): план удаления требований
> `.opencode/`-зеркалирования включён сюда как «Этап 0»; `mirror-removal-plan.md` удалён,
> контент перенесён ниже.

## Контекст

`/maestro-init` настраивает проект один раз при bootstrap. Но конфигурация и
контекст **не статичны**: в течение жизни проекта возникает точечная настройка
(`maestro.json`, доступ к папкам, trusted-агенты), актуализация `project-context.md`,
организация структуры каталогов и консультации по правилам работы maestro.
Раньше такие запросы не имели адресата — лезли в `@maestro` (тяжёлый фича-pipeline)
или разбирались вручную.

Вводится отдельный скилл `maestro-assistant` (+ команда `/maestro-assistant`):
общий источник правил конфигурации/процессов и лёгкая точка входа для
настройки/консультаций в течение жизни проекта.

## Цели (зачем это решение)

1. **Единый источник правил конфигурации** — семантика maestro.json (4 секции),
   opencode.json (модели/плагин), project-context (14 категорий), структура
   каталогов + `.gitignore`. Правка правила — в одном файле; init, docs и maestro
   ссылаются на него. Устранение дрейфа между «как init генерирует» и «как HITL
   настраивает вручную».
2. **init становится тоньше** — вынос правил наполнения из init в assistant
   оставляет init-у порядок, gates и состояние.
3. **Лёгкая точка входа для консультаций/настройки** без запуска фича-pipeline.
4. **Честная модель делегирования без агента** — знаниевый хендофф (init загружает
   assistant и следует его правилам), а не фиктивный subagent-dispatch.

## Не-цели (чего НЕ делает)

- **НЕ реализует фичи** — не запускает pipeline, не пишет spec/plan/код. Это
  `@maestro`, `/maestro-design`.
- **НЕ управляет trusted-сабагентами и не решает вопросы безопасности сам** —
  trust/access/confidential — только через HITL.
- **НЕ создаёт отдельного агента** (без отдельного execution-context «делегирование»
  было бы фикцией — та же сессия).

## Природа и форма

- **Команда + скилл, без агента** (выбрано HITL).
- `commands/maestro-assistant.md` — `/maestro-assistant <запрос>`: загружает скилл
  `maestro-assistant` (tool: skill) и применяет его к запросу HITL.
- `skills/maestro-assistant/SKILL.md` — база знаний: правила конфига/контекста/
  структуры + консультационные воркфлоу + границы + gates.

## Связи (односторонний поток исполнения)

```
HITL ──> /maestro-assistant (консультация/настройка)
init ──> загружает maestro-assistant (правила для задач 2/3/3а)
maestro ──> загружает maestro-assistant (консультации по конфигу по ходу pipeline)
assistant ─X─> НЕ запускает maestro/init/pipeline (обратной связи нет)
```

- **init → assistant**: init всегда загружает assistant на трёх делегируемых
  задачах (project-context, конфиг, структура) и следует его правилам. init
  владеет последовательностью, gates и состоянием.
- **maestro → assistant**: если по ходу pipeline возникает вопрос настройки
  конфигурации/процессов, maestro загружает assistant для консультации (единый
  источник). НЕ делегирует assistant исполнение фич.
- **assistant НЕ вызывает maestro/init** — односторонний поток, без циклов.

## Полномочия и границы assistant

- **Может напрямую редактировать** `maestro.json`, `project-context.md`, структуру
  каталогов по запросу HITL (это его рабочие артефакты). Идемпотентно, с
  HITL-гейтом на approve/правки/отмена и показом diff-merge перед записью.
- **Границы** (не реализует фичи / не spec/plan/код / trust+security только через
  HITL / единый источник правил с init).
- **Доступ к `docs/confidential/**` — закрыт.** `/maestro-assistant` выполняется в
  primary-сессии → по модели доверия **всегда deny** (инвариант primary, не конфигурируется).
  Assistant НЕ читает/не правит содержимое `docs/confidential/**`; запросы на работу
  с confidential-данными — только через допустимый канал (trusted-агент), не в обход.
  (см. «Ревью IMP-3»).
- **Правка `confidential.paths` — жёсткий контроль** (см. «Ревью IMP-3»): снятие с
  защиты — жёсткий блок по умолчанию; merge — только консервативное дополнение;
  адресный diff по `confidential.paths`.
- **Плагин-гейт: НЕ требуется** для самостоятельных консультаций (редактирует
  конфиг, не гоняет confidential через pipeline).
- **Триггер редиректа (MIN-4):** assistant обрабатывает конфигурацию maestro, структуру
  каталогов, актуализацию project-context и консультации по правилам. Если запрос требует
  изменения кода/spec/плана или запуска pipeline — редирект: `@maestro` (фича/багфикс/SDD),
  `/maestro-design` (дизайн/scaffold/roadmap), `@regression` (регрессия). (см. «Ревью минорных»).

## Правила конфигурации, переезжающие в assistant (источник истины)

| Область | Что переносится |
|---|---|
| `maestro.json` 4 секции | Семантика `trust`, `access_policy`, `confidential`, `sanitizer_whitelist` (полный JSON-канон — в `skills/maestro-assistant/SKILL.md`, см. «Ревью CRIT-1» ниже) |
| `opencode.json` | Регистрация плагина, модели/температура агентов (оси Tier/Trust), D2 (доступные модели) — как консультация и источник правил |
| `project-context.md` | Схема 14 категорий (schema остаётся в `init-context.md`; правила актуализации/наполнения — в assistant) + секция 14 Commands |
| Структура каталогов | `.maestro/`, `docs/superpowers/{specs,plans}/`, `docs/confidential/`, `regression/` + `.gitignore` конкретные пути |
| M1 (7 HITL-вопросов) | **Остаётся в init** (последовательный HITL-воркфлоу init); assistant объясняет семантику по запросу, но не ведёт M1-опрос |

## Ревью CRIT-1 — физическое место «единого источника правил» (решено)

**Проблема (из углублённого ревью):** `manual_docs/reference/config.md` уже является полным
справочником тех же правил (4 секции `maestro.json`, `opencode.json`, D2, env, пути).
Простой перенос правил «в assistant как источник» без решения о физическом месте породил бы
дублирование/дрейф с `config.md`. Дополнительно: скилл не должен зависеть от плагин-каталога
(`plugins/maestro-bootstrap/`), где сейчас живёт полный пример `examples/maestro.example.json`.

**Решение (гибрид, вариант C):**

1. **Канон полного `maestro.json` + правила вывода/семантика — в `skills/maestro-assistant/SKILL.md`.**
   Скилл самодостаточен: загружается в изоляции (консультации, init, maestro) и не зависит от
   плагин-каталога. Это снимает и CRIT-1 (единый канон), и возражение «скилл не должен
   зависеть от плагина».
2. **Разделение контента по назначению:**
   - В **скилл** — логика вывода конфига из контекста (§3/§5/§12), правила процесса,
     семантика ключей, примеры-фрагменты + ссылка на полный канон.
   - В **`config.md`** — field-таблицы для человека + сокращённые фрагменты; полный
     пример/процесс — **ссылка на `/maestro-assistant`** (или на скилл). НЕ дублирует полный JSON.
   - Направление ссылок только `docs → skill`; скилл не тянет manual_docs (снимает IMP-4).
3. **`init-context.md` + `skills/maestro-init/SKILL.md`:** логика вывода конфига вымрет
   как дубликат и станет ссылкой на assistant (это и есть задача 3 миграции). Скилл init
   сам секции конфига больше не описывает.
4. **`examples/maestro.example.json`** — НЕ тест-фикстура (подтверждено: тесты плагина
   используют inline-фикстуры, файл не читается `core.js`/`index.test.js`). Это чисто
   документация для README плагина → становится производным и **удаляется на этапе 2**.

**Этап 1 (этот план):** канон в скилле; `config.md` → таблицы + ссылка; init → ссылка на
assistant; `examples/maestro.example.json` остаётся как производное (синк конвенцией).

**Этап 2 (отдельная задача, см. «Ревью CRIT-1 — этап 2»):** удалить `examples/maestro.example.json`
и переадресовать активные ссылки.

## Ревью CRIT-1 — этап 2: удаление `examples/maestro.example.json`

Выделено отдельным этапом (вариант Y) — удаление производного примера + каскад ссылок.

**Удалить файл:** `plugins/maestro-bootstrap/examples/maestro.example.json`

**Переадресовать активные ссылки (обновить на канон в `skills/maestro-assistant/SKILL.md`):**
| # | Файл | Строка | Правка |
|---|------|--------|--------|
| 1 | `plugins/maestro-bootstrap/README.md` | 93, 138 | `examples/maestro.example.json` → `/maestro-assistant` (или канон скилла) |
| 2 | `skills/maestro-init/init-context.md` | 151 | `Эталон: …example.json` → `Эталон: канон в skills/maestro-assistant/SKILL.md` |
| 3 | `skills/maestro-init/SKILL.md` | 133 | то же |
| 4 | `agents/sanitizer.md` | (строка с примером) | то же |

**НЕ трогать (исторические, фиксируют факт на момент; правка исказит историю):**
- `specs/project-review-plan.md`, `specs/docs-alignment.md`, `specs/init-idempotency-plan.md`,
  `specs/docs-alignment-plan.md`
- `manual_docs/overview/changelog.md:215` (историческая запись)
- `specs/maestro-assistant-plan.md:84` (правка уже внесена в рамках CRIT-1)

**`config.md`** не ссылается на `example.json` по имени (у него инлайн-блоки) — этап 2 его
не затрагивает; приведение `config.md` к «таблицы + ссылка» делается на этапе 1.

**Механизм поддержания равенства (снимает дрейф канон↔производное):** конвенция в
`keep-docs-up-to-date.md` + этот план: «правка полного JSON-канона в
`skills/maestro-assistant/SKILL.md` → обновить производные (`config.md`, README плагина)».
**OP-3:** канон хранится **inline в `SKILL.md`**; авто-тест-guard НЕ добавляется (нет хрупкого
извлечения из md, `index.test.js` не трогаем). Контроль дрейфа канон↔плагин — **конвенцией**:
держать JSON-канон в `SKILL.md` синхронно с правилами парсинга плагина
(`loadMaestroConfig`/`loadWhitelist`/`loadAccessPolicy`/`loadConfidentialConfig`).
«Опциональный guard» (тест, что эталон парсится `loadMaestroConfig`) — **снят как решение**,
не оставлять обещание автотеста.

## Ревью CRIT-2 — жёсткое требование скилла assistant в `/maestro-init` (решено)

**Проблема (из углублённого ревью):** после CRIT-1 правила вывода конфига переезжают из
init в assistant. Если init «всегда загружает assistant» на задаче 3, а скилла нет —
init не сможет корректно сгенерировать конфиг. Нужен явный механизм (жёсткий vs мягкий).

**Решение (жёстко, по выбору HITL):**

1. **Проверка наличия скилла `maestro-assistant` — на задаче 3** (`/maestro-init`, генерация
   конфига `maestro.json` + `opencode.json`). Реализуется через probe через `skill` tool
   (как проверка superpowers на задаче 4).
2. **Если задача 3 должна выполниться, а скилла нет** → жёсткое прерывание: HITL-сообщение
   «необходимо установить скилл `maestro-assistant` для продолжения», **стоп задачи 3 и
   всего процесса `/maestro-init`** (не переходить к 4–5, без fallback-деградации к базовому
   дефолту). Это согласуется с CRIT-1: init не хранит своих правил конфига.
3. **Идемпотентность сохранена (общий принцип на все скилл-зависимые задачи init):**
   проверка скилла выполняется **только если задача реально выполняется** (создаёт/обновляет
   свои артефакты). Если задача пропускается по идемпотентности (артефакт уже есть,
   пользователь выбрал «оставить существующий»/не пересоздавать) — проверка скилла **не
   выполняется**, задача пропускается штатно.
4. Принцип из п.3 применим и к другим задачам init, требующим внешние скиллы (напр.
   superpowers — задача 4): проверка только при фактическом выполнении задачи.

**Отличие от superpowers (задача 4, fail-open):** assistant на задаче 3 — **жёсткий**;
superpowers — **мягкий** (не блокируют setup). Обоснование: без assistant задача 3 не может
корректно сгенерировать конфиг (канон в assistant), а superpowers-скилы нужны позже
(на SDD-этапах) и не блокируют генерацию конфига.

## Ревью IMP-1 — механика `.opencode/`-зеркала (решено)

**Проблема (из углублённого ревью):** исходный пункт «`.opencode/` зеркала» был неоднозначен —
не указано, в каком `.opencode/` (авторский репо или целевое приложение) и какие файлы
(команды и/или скиллы) зеркалировать. Факт репо: единственный `.opencode/commands/maestro-version.md`
был удалён (commit `18d1a49`), `.opencode/` в авторском репо отсутствует; AGENTS.md заявляет,
что `.opencode/` принадлежит целевому приложению, а не авторскому.

**Решение (по выбору HITL):**

1. **`.opencode/`-зеркалирование НЕ требуется** ни для авторского репо, ни для целевого
   приложения. Скиллы/команды/агенты доставляются в целевое приложение **штатным механизмом**
   — вручную из удалённого репозитория или через `agpack`.
2. **Этот план не создаёт `.opencode/`-файлов.** Пункт скоупа «`.opencode/` зеркала» заменён
   на «Доставка в целевое приложение (штатный механизм)» (см. #18). Группа C «Применение»
   переименована в «Доставка».
3. **Обновлённые источники** `skills/maestro-assistant/SKILL.md`, `commands/maestro-assistant.md`,
   `skills/maestro-init/SKILL.md`, `skills/maestro/SKILL.md` становятся доступны целевому
   приложению тем же штатным механизмом; отдельный шаг синка в этом плане не нужен.

**Опциональный follow-up (вне этого плана):** `.opencode/commands/maestro-version.md` в авторском
репо — кандидат на удаление как непоследовательный артефакт (противоречит AGENTS.md: `.opencode/`
принадлежит целевому приложению; создан по явному решению `plugin-version-plan.md`, не подтверждён
другими командами). НЕ блокирует этот план.

## Ревью IMP-2 — полнота док-синка (решено)

**Проблема (из углублённого ревью):** правила `maestro.json`/trust/access_policy/sanitizer/
confidential/14 категорий затрагивают больше файлов manual_docs, чем было в исходном скоупе.
Проверка `rg`-списком файлов с этими правилами выявила два пропущенных «вторых источника».

**Решение (по выбору HITL):** добавить в док-синк два файла с типом «добавить ссылку на
`/maestro-assistant`» (НЕ перенос канона):

1. **`reference/model-selection.md`** (строки 66–108 дублируют M1/D2/tier-семантику):
   добавить ссылку на `/maestro-assistant` как консультанта по семантике моделей. M1/D2
   **остаются в `init`** (решённый CRIT-2) — НЕ переносятся в assistant; файл синкается
   с `init`, assistant — консультативная точка.
2. **`explanation/project-context.md`** (дублирует схему 14 категорий + §14 Commands):
   добавить ссылку на `/maestro-assistant` для актуализации/наполнения. Схема 14 категорий
   **остаётся в `init-context.md`** (CRIT-1), assistant — точка актуализации/наполнения.

**Не требуют правки (проверено, только факты/референсы):** `pipeline-overview.md`,
`tutorials/run-first-feature.md`, `reference/hitl-gates.md`, `examples/example-feature.md`,
`how-to/use-regression-registry.md`.

**Ключевой принцип (согласование с CRIT-1/CRIT-2):** в assistant переносятся только правила
наполнения (конфиг maestro.json, project-context, структура каталогов/.gitignore); поле-семантика
opencode.json/M1/D2 остаётся в init (CRIT-2) — поэтому `model-selection.md` и `setup-project.md`
не переносят M1/D2, лишь получают консультативную ссылку на `/maestro-assistant`.

## Ревью IMP-3 — доступ к confidential и контроль `confidential.paths` (решено)

**Проблема (из углублённого ревью + уточнение HITL):** два разных аспекта смешивались:
(1) доступ к содержимому `docs/confidential/**` и (2) правка `maestro.json` как конфигурации.
Риск: assistant мог бы молча исключить папку из `confidential.paths` (снять с защиты) без
уведомления пользователя.

**Решение (по выбору HITL; принцип «доступ к confidential только для trusted»):**

1. **Доступ к содержимому `docs/confidential/**` — жёстко закрыт для assistant.**
   `/maestro-assistant` выполняется в **primary-сессии** → по модели доверия **всегда deny**
   (жёсткий инвариант primary, не конфигурируется). Assistant НЕ читает/не правит содержимое
   `docs/confidential/**`; запросы на работу с confidential-данными — только через допустимый
   канал (trusted-агент), не в обход.

2. **Правка `confidential.paths` (список конфиденциальных папок) — жёсткий контроль:**
   - **Снятие с защиты (удаление пути из `confidential.paths`) — ЖЁСТКИЙ БЛОК по умолчанию.**
     Assistant не инициирует и не выполняет удаление/ослабление сам. Снятие — **только по
     явному запросу HITL** и при этом: (а) адресный diff «папка X будет исключена из
     `confidential.paths`, данные станут доступны untrusted/primary (с учётом fail-open)»;
     (б) явный отдельный approve HITL, иначе действие не выполняется.
   - **Merge `confidential.paths` — только консервативное дополнение.** При повторном
     прогоне/merge assistant может **только добавлять** пути, но не удалять/изменять
     существующие без явного HITL-гейта с дифф-показом. Пользовательские пути защищены от
     схлопывания/перезаписи.
   - **Адресный показ:** при любом изменении `confidential.paths` — отдельный diff по
     `confidential.paths` (стало vs было), не только общий diff-merge `maestro.json`.

3. **Информационная заметка о fail-open (второстепенно):** при правке security-секций
   `maestro.json` — напоминание, что защита `confidential`/`access_policy`/`sanitizer`
   реализована в плагине и **fail-open**: при выключенном плагине не действует; для реально
   конфиденциальных данных нужны также средства ОС/repo. Не блокирует, сохраняет «без гейта».

**Согласование с решённым:** дополняет «trust+security только через HITL» и «идемпотентно с
HITL-гейтом и показом diff-merge» специфическим требованием для `confidential.paths`
(жёсткий блок снятия, консервативный merge, адресный diff).

## Ревью IMP-4 — загрузка assistant из pipeline maestro (решено)

**Проблема (из углублённого ревью):** исходный пункт связи в `skills/maestro/SKILL.md`
(«по вопросам конфигурации — загрузить assistant») не уточнял механику загрузки и не
гарантировал, что загрузка assistant из pipeline не сломается о не-резолв внешних ссылок.

**Решение (вариант 1, по выбору HITL):**

1. **`skills/maestro/SKILL.md` — связь:** по вопросам настройки конфигурации/процессов по
   ходу pipeline maestro **загружает `maestro-assistant` через `skill` tool (полностью, как
   init)**, следует его правилам для задачи конфигурации, затем решает и **продолжает
   pipeline** (не входит в консультативную петлю). assistant консультирует — maestro исполняет.

2. **`skills/maestro-assistant/SKILL.md` — требование self-contained:** канон конфига/правил
   внутри скилла; **не ссылаться на `manual_docs/` для исполнения** (загрузка assistant из
   pipeline не должна ломаться о не-резолв внешних доков); кросс-ссылки на другие
   `skills/*` (`maestro-init/SKILL.md`, `init-context.md`) — только как **опциональная
   справка**, не блокирующая работу.

**Согласование:** самодостаточность — следствие CRIT-1 (канон в скилле, ссылки docs→skill);
механика загрузки — единообразна с init; односторонний поток сохранён (maestro → assistant,
assistant не запускает pipeline).

## Ревью минорных (MIN-1..4) (решено)

**MIN-1 — changelog entry:** по доминирующей конвенции `[Unreleased] → ### Добавлено` (см.
`changelog.md` и прецеденты `maestro-feedback-report-plan.md`, `preflight-hitl-wording-plan.md`);
записи: `### Добавлено` (команда/скилл `/maestro-assistant`), `### Изменено` (CRIT-1: канон
правил конфига в скилл; IMP-1: доставка через репо/`agpack`, снятие `.opencode/`-зеркалирования).

**MIN-2 — авто-тест convenience-скилла:** НЕ добавлять отдельный авто-тест (нет прецедента —
`index.test.js` плагина тестирует только код, не команды/скиллы; единственный механизм
проверки сабагентов — ручной `@test-agents`). Верификация — ревью когерентности доков +
ручной прогон `/maestro-assistant <запрос>` в `/tmp` (уже в «Проверке» плана).

**MIN-3 — `agent:`-поле команды:** `commands/maestro-assistant.md` **без `agent:`** в frontmatter
(ни одна команда `commands/*.md` не содержит `agent:`; упоминание в `reference/commands.md` —
описательное про субагента, а не обязательный frontmatter).

**MIN-4 — триггер редиректа `/maestro-assistant` vs `@maestro`:**
- **assistant обрабатывает:** конфигурация maestro (maestro.json/opencode.json/.gitignore),
  структура каталогов, актуализация project-context, консультации по правилам/процессам.
- **Редирект:** изменение кода/spec/плана или запуск pipeline → `@maestro` (фича/багфикс/SDD);
  `/maestro-design` (дизайн/scaffold/roadmap); `@regression` (регрессия).
- **Критерий:** работа меняет код/spec/план или запускает pipeline → редирект; только
  конфиг/структура/контекст/консультация → assistant. Отражено в «Полномочия и границы».

## Операционные риски и гарантии готового решения

Риски **при использовании** итогового решения (не связность планирования) и принятые гарантии.

**OP-1 — правки `maestro.json` не вступают в силу до перезапуска.**
Факт: `loadMaestroConfig` вызывается один раз при инициализации плагина (`core.js:792`);
`agents-and-trust.md:138`: «Смена `maestro.json` — требует рестарта opencode».
**Гарантия:** в скилл assistant — обязательное правило: после записи любых изменений
`maestro.json` сообщить HITL «изменения вступят в силу после перезапуска opencode» и
предложить рестарт/отложить. Критично для `trust`/`access_policy`/`confidential`/`sanitizer_whitelist`.

**OP-2/OP-6 — bootstrap-замкнутый круг (`/maestro-init` жёстко требует assistant).**
CRIT-2: задача 3 прерывается без скилла assistant. Но доставка в target — отдельный инкремент.
**Решение (в):** доставка `maestro-assistant` (команда + скилл) в целевое приложение — **предусловие**
первого `/maestro-init`. Зафиксировать как предусловие, сохранив жёсткость CRIT-2. Скоуп B
(миграция init на ссылки к assistant) **неразрывно** связан с доставкой assistant; нельзя
выпускать B в вакууме от C.

> **Follow-up (финальное ревью):** ручная доставка в target `.opencode/` — временная. Пока ветка
> `feature/maestro-assistant` не опубликована в remote `wad-jet/maestro` (и не в `main`), повторный
> `agpack install` в target перезапишет доставленные файлы обратно в старое состояние (без assistant).
> **Требуется публикация ветки/мерж в remote** для устойчивой доставки через `agpack`. Ручная доставка
> держит `/maestro-assistant` рабочим до первого `agpack`.

**OP-3 — канон `maestro.json` в `SKILL.md` (дрейф с плагином).**
Канон — артефакт описания формата, плагин его НЕ потребляет (парсит реальный `maestro.json`).
**Решение (C):** канон inline в `SKILL.md`; дрейф канон↔плагин — конвенцией (синхронно с
правилами `loadMaestroConfig`/`loadWhitelist`/`loadAccessPolicy`/`loadConfidentialConfig`);
авто-тест-guard не добавляется (см. CRIT-1/этап 2).

**OP-4 — правка `access_policy`/`sanitizer_whitelist` (security-слои).**
IMP-3 строго защищает `confidential.paths`; `access_policy`/`sanitizer_whitelist` тоже
security-критичны (fail-open). **Гарантия:** распространить адресный diff + явное HITL-подтверждение
на правку `access_policy.deny→allow` (ослабление) и `sanitizer_whitelist.rules→false`
(отключение защиты), по аналогии с `confidential.paths`.

**OP-5 — связь maestro→assistant зависит от наличия скилла в target.**
При отсутствии assistant загрузка через `skill` tool молча no-op. **Гарантия:** в
`skills/maestro/SKILL.md` при загрузке assistant — проверка наличия скилла (probe) + мягкое
предупреждение «assistant не установлен, правила конфигурации недоступны», не блокируя pipeline.

**OP-7 — граница «схема vs наполнение» в project-context.**
Схема 14 категорий — канон в `init-context.md`; assistant правит наполнение. В скилле assistant
явно различать: правка схемы (нельзя, схема в init-context) vs правка наполнения (можно).

**OP-8 — кросс-ссылки assistant на `init-context.md` (опыт).**
При доставке в target убедиться, что `init-context.md` доставлен, иначе опциональная справка
битая. Не блокирует.

**OP-9 — MIN-2: авто-тест convenience-скилла не добавляется.**
Остаётся решением (нет прецедента); дефект frontmatter команды/скилла не ловится автоматически —
верификация ревью + ручной прогон.

**OP-10 — changelog-запись увязать с фактическим разворачиванием.**
Entry `[Unreleased]` про `/maestro-assistant` ставить согласованно с доставкой в target,
чтобы не фиксировать «добавлен» до фактического наличия в целевом приложении.

## Этап 0 — Снятие требований `.opencode/`-зеркалирования

> Поглощено из `specs/mirror-removal-plan.md` (CRIT-B): этот план объединяет оба решения
> (снятие mirroring + assistant). `mirror-removal-plan.md` удалён.

**Контекст:** `maestro-agent` — authoring-репо, источник истины для скиллов/команд/агентов.
Общие правила (`AGENTS.md`, `manual_docs/`, `skills/manual-docs/SKILL.md`, `skills/maestro/SKILL.md`)
предписывают **синхронизировать runtime-копии в `.opencode/`** как способ доставки в целевое
приложение. Фактический механизм доставки (по IMP-1): **вручную из удалённого репозитория**
или через **`agpack`**. Отдельное `.opencode/`-зеркалирование **не требуется по умолчанию**.
Цель этапа 0 — убрать инструкции о поддержании `.opencode/`-зеркал, заменив их описанием
доставки штатным механизмом (репо/`agpack`), сохранив факт, что OpenCode *читает* файлы из
`.opencode/` целевого приложения в рантайме.

### Важное различение (что убираем vs что оставляем)

1. **Инструкции о зеркалировании/синхронизации** (убираем/заменяем) — «обновить runtime-копию
   в `.opencode/`». Примеры: AGENTS.md sync rule, `customize-maestro.md` Шаг 3,
   `manual-docs/SKILL.md` Правило 5, `skills/maestro/SKILL.md:1418–1420`.
2. **Факт рантайм-загрузки** (обновляем формулировку, сохраняем факт) — OpenCode читает из
   `.opencode/` целевого приложения. Примеры: `what-is-maestro.md:19–20`, `quick-start.md:12`,
   `commands.md:8`. Факт остаётся, добавляется указание на доставку (репо/`agpack`), не «синхронизацию».
3. **Не относится к зеркалированию — НЕ трогаем:**
   - `.opencode/opencode.json` (merge конфигурации) — `skills/maestro-init/SKILL.md:223`,
     `manual_docs/tutorials/setup-project.md:141`, `manual_docs/reference/config.md:454`.
   - `.opencode/skills/subagent-driven-development/scripts/...` — `skills/maestro/implementer-prompt.md:52,56,57,58`.
   - `.opencode/agents/<name>.md` как факт объявления сабагентов — `skills/maestro/SKILL.md:788–799`.
   - `AGENTS.md:19` («`.opencode/` принадлежит целевому приложению») — остаётся.

### Скоуп этапа 0 (файлы)

| # | Файл | Действие |
|---|------|----------|
| 0.1 | `AGENTS.md` | Переписать секцию «Скиллы / Skills (sync rule)»: убрать зеркалирование в `.opencode/`, описать доставку (репо/`agpack`); сохранить правило про `manual_docs/` |
| 0.2 | `skills/manual-docs/SKILL.md` | Правило 5: «runtime-копия в `.opencode/skills/manual-docs/SKILL.md`» → доставка штатным механизмом |
| 0.3 | `skills/maestro/SKILL.md` | Строки 1418–1420: «синхронизируются → `.opencode/`» → «доставляются штатным механизмом (репо/`agpack`)» (объединено с Этап 1 #5) |
| 0.4 | `manual_docs/how-to/customize-maestro.md` | Шаг 3 → «Доставьте в целевое приложение (репо/`agpack`)»; убрать таблицу Источник→Runtime-копия; переписать «Примеры» (48–51) (объединено с Этап 1 #12) |
| 0.5 | `manual_docs/overview/what-is-maestro.md` | Строки 17–20: дополнить способом доставки (репо/`agpack`) **+ упомянуть `/maestro-assistant` как консультативную точку по конфигурации** (IMP-A) |
| 0.6 | `manual_docs/overview/quick-start.md` | Строка 12: уточнить доставку из репо/через `agpack` **+ упомянуть `/maestro-assistant`** (IMP-A) |
| 0.7 | `manual_docs/reference/commands.md` | Строка 8: «runtime-копии — в `.opencode/commands/`» → «доставляются из репо/через `agpack`» (объединено с Этап 1 #7) |
| 0.8 | `manual_docs/how-to/keep-docs-up-to-date.md` | **Без изменений** — не содержит `.opencode/`-ссылок; синк `manual_docs/` сохраняется |
| 0.9 | `manual_docs/overview/changelog.md` | Entry: снятие `.opencode/`-зеркалирования, доставка через репо/`agpack` (объединено с Этап 1 #10) |

### Ключевые формулировки-замены

**Было (инструкция синка):**
> «Скиллы/агенты/команды загружаются из `.opencode/` целевого приложения. При правке
> источника обновите runtime-копию: `agents/*.md` → `.opencode/agents/*.md`, ...»

**Станет (доставка штатно):**
> «Скиллы/агенты/команды доставляются в целевое приложение из авторского репо вручную или
> через `agpack`. OpenCode загружает их из `.opencode/` целевого приложения. Отдельное
> зеркалирование не требуется: источник (authoring-репо) является единственной копией,
> публикуемой в целевое приложение через репо/`agpack`.»

### Проверка этапа 0

- После правок: ни один live-файл с `.opencode/` не содержит инструкций зеркалирования
  (только факты загрузки + доставка репо/`agpack`).
  `rg -n 'runtime-копия|runtime copy|зеркалирован|обновите и копию|Синхронизируйте runtime|→ \`\.opencode/'` — ожидаемо 0 совпадений.
- Live-файлы с `.opencode/` после правок — ровно: `AGENTS.md`, `skills/manual-docs/SKILL.md`,
  `skills/maestro/SKILL.md`, `skills/maestro-init/SKILL.md`, `skills/maestro/implementer-prompt.md`,
  `manual_docs/reference/config.md`, `manual_docs/reference/commands.md`,
  `manual_docs/overview/what-is-maestro.md`, `manual_docs/overview/quick-start.md`,
`manual_docs/overview/changelog.md`, `manual_docs/how-to/customize-maestro.md`,
   `manual_docs/tutorials/setup-project.md` (из них изменяются только перечисленные в скоупе 0.x).

### Не трогать (этап 0, исторические/не-зеркалирование)

- `.opencode/opencode.json` (merge конфигурации), `.opencode/skills/subagent-driven-development/scripts/...`,
  `skills/maestro/SKILL.md:788–799` (факт объявления сабагентов), `AGENTS.md:19` — факты, не инструкции синка.
- Исторические записи `changelog.md` (2026-08-19, 08-03) и исторические `specs/*`
  (`maestro-init-tasks-plan.md`, `plugin-presence-gate-plan.md`, `plugin-version.md`,
  `init-idempotency-plan.md`, `docs-alignment.md`, `plugin-version-plan.md`) — фиксируют
  факты/решения на момент, не переписываем.

## Скоуп реализации — Этап 1 и Этап 2

### Ядро (`maestro-agent/`)
| # | Файл | Действие |
|---|------|----------|
| 1 | `commands/maestro-assistant.md` | **новый** — `/maestro-assistant <запрос>`: загрузить скилл, применить к запросу HITL. Без `agent:` в frontmatter (MIN-3) |
| 2 | `skills/maestro-assistant/SKILL.md` | **новый** — база знаний: правила конфига/контекста/структуры, консультационные воркфлоу, полномочия, границы, связи, HITL-гейт. **Self-contained**: канон внутри, не ссылается на manual_docs для исполнения (IMP-4). **Операц. гарантии (OP)**: после правки `maestro.json` — сообщение о перезапуске (OP-1); адресный diff+HITL на `access_policy.deny→allow` и `sanitizer_whitelist.rules→false` (OP-4); граница схема/наполнение project-context (OP-7) |
| 3 | `skills/maestro-init/SKILL.md` | Мигрировать правила наполнения (задачи 2/3/3а) в ссылку на assistant; init остаётся оркестратором (порядок/gates/состояние); убрать дублирующие детали конфига |
| 4 | `skills/maestro-init/init-context.md` | Оставить схему 14 категорий; правила вывода конфигурации из контекста — ссылка на assistant |
| 5 | `skills/maestro/SKILL.md` | Добавить связь: по вопросам настройки конфигурации/процессов по ходу pipeline — загрузить `maestro-assistant` полностью через `skill` tool (как init), следовать его правилам, продолжить pipeline (IMP-4). При загрузке assistant — probe наличия скилла + мягкое предупреждение при отсутствии, не блокирует (OP-5) |

### Доки (`maestro-agent/`)
| # | Файл | Действие |
|---|------|----------|
| 6 | `specs/maestro-assistant-plan.md` | (этот файл) — зафиксировать решения |
| 7 | `manual_docs/reference/commands.md` | Добавить `/maestro-assistant` |
| 8 | `manual_docs/reference/config.md` | Привести к «таблицы + ссылка на `/maestro-assistant`» (этап 1, CRIT-1) |
| 9 | `manual_docs/explanation/agents-and-trust.md` | Правила конфига теперь sourced из assistant; упомянуть `/maestro-assistant` |
| 10 | `manual_docs/overview/changelog.md` | Entry (MIN-1): `[Unreleased] → ### Добавлено` (команда/скилл `/maestro-assistant`) + `### Изменено` (CRIT-1 канон, IMP-1 доставка/снятие зеркалирования) |
| 11 | `manual_docs/how-to/keep-docs-up-to-date.md` | Чек-лист: строка про assistant + строка про синк канона↔производные |
| 12 | `manual_docs/how-to/customize-maestro.md` | Упомянуть `/maestro-assistant` как точку настройки |
| 13 | `manual_docs/index.md` | Проверить ссылки |
| 14 | `manual_docs/tutorials/setup-project.md` | Обновить упоминания M1/D2/config (затрагивается переносом правил) — проверить на CRIT-1 |
| 15 | `manual_docs/reference/model-selection.md` | Добавить ссылку на `/maestro-assistant` как консультанта по семантике моделей; M1/D2 остаются с `init` (CRIT-2), не переносятся (см. «Ревью IMP-2») |
| 16 | `manual_docs/explanation/project-context.md` | Добавить ссылку на `/maestro-assistant` для актуализации/наполнения; схема 14 категорий остаётся с `init-context.md` (см. «Ревью IMP-2») |

### Этап 2 (отдельная задача, вариант Y)
| # | Файл | Действие |
|---|------|----------|
| 17 | `plugins/maestro-bootstrap/examples/maestro.example.json` | Удалить |
| 18 | `plugins/maestro-bootstrap/README.md` | Переадресовать ссылки (93, 138) на `/maestro-assistant` |
| 19 | `skills/maestro-init/init-context.md`, `skills/maestro-init/SKILL.md`, `agents/sanitizer.md` | Переадресовать ссылки «эталон» на канон в скилле |

### Применение
| # | Файл | Действие |
|---|------|----------|
| 20 | Доставка в целевое приложение | Штатный механизм (вручную из удалённого репо / `agpack`); `.opencode/`-зеркалирование НЕ требуется (см. «Ревью IMP-1»). **Предусловие первого `/maestro-init`** (OP-2/OP-6); неразрывно со скоупом B |

## Проверка

- `node --test plugins/maestro-bootstrap/index.test.js` — плагин не меняется (fail-open
  совместим), тесты должны остаться зелёными.
- Верификация — ревью когерентности доков (исполняемого теста для скилла
  `maestro-assistant` нет, как и для `maestro-init`).
- Ручной прогон `/maestro-assistant <запрос>` на тестовом проекте в `/tmp`:
  консультация, настройка `maestro.json`, актуализация project-context.
- **Этап 0:** проверка по `rg`-паттернам (см. «Проверка этапа 0») — 0 инструкций зеркалирования.

## Порядок исполнения

**Этап 0 (снятие `.opencode/`-зеркалирования):**
1. **Группа 0 — Правила:** `AGENTS.md` (sync rule), `skills/manual-docs/SKILL.md` (Правило 5),
   `skills/maestro/SKILL.md:1418–1420` — ядро правил.
2. **Группа 0 — manual_docs:** customize-maestro, what-is-maestro, quick-start, commands, changelog.
   (`keep-docs-up-to-date.md` — без изменений.)
3. **Группа 0 — Проверка:** `rg`-паттерны + ревью когерентности.

**Этап 1 (assistant):**
4. **Группа A — Ядро:** `skills/maestro-assistant/SKILL.md`, `commands/maestro-assistant.md`,
   миграция `skills/maestro-init/SKILL.md` + `init-context.md`, связь в `skills/maestro/SKILL.md`.
   `skills/maestro/SKILL.md`: выполнить **обе правки в одном проходе** — этап 0 #0.3 (стр.
   1418–1420, синк→доставка в «Ограничения») + этап 1 #5 (добавить связь загрузки assistant),
   не разделять на два несогласованных коммита (IMP-B). Проверка когерентности (единый
   источник, без дублирования).
5. **Группа B — Доки:** `specs/maestro-assistant-plan.md`, `manual_docs/`
   (включая `reference/config.md` → таблицы + ссылка на `/maestro-assistant`;
   `reference/model-selection.md` + `explanation/project-context.md` → ссылки на
   `/maestro-assistant`; объединить с Этап 0 #0.4/#0.7/#0.9 — одна правка на файл).
6. **Группа C — Доставка:** описание применения изменённых источников в целевом приложении
   через штатный механизм (репо/`agpack`); `.opencode/`-зеркалирование не выполняется.
7. **Группа D — Проверка:** `node --test` + ручной прогон в `/tmp`.

**Этап 2 (отдельная задача, после этапа 1):**
8. **Группа E — Удаление `examples/maestro.example.json`:** удалить файл, переадресовать
   активные ссылки (README плагина, init-context, init-SKILL, sanitizer.md). Проверка на
   битые ссылки по всему репо (кроме исторических spec/changelog).

## Open questions

- **Скоуп первого прохода: выбран B (ядро + доки).** Реализуется Этап 0 + Этап 1 (группы A–D).
  Группа C «Доставка» — документальная часть B. Этап 2 (удаление `examples/maestro.example.json`)
  и полное применение в целевом приложении — следующие инкременты (по итогам B).
- Запускать ли реализацию вообще — ждём команду HITL.