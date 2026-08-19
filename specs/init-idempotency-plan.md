# План: идемпотентная генерация конфигов в `/maestro-init`

> Статус: **зафиксирован, реализация частично выполнена**.
> Дата: 2026-08-19. Репо: `maestro-agent` (authoring).
> Решения: opencode.json — merge через HITL; `.opencode/` зеркала — вне скоупа;
> конфиги консолидированы в `maestro.json` (backward compat НЕ требуется).
>
> **Выполнено:** плагин `maestro-bootstrap` переведён на `maestro.json`
> (loadMaestroConfig + секции trust/access_policy/sanitizer_whitelist), старые
> файлы удалены из поддержки, тесты 63/63, пример `maestro.example.json` создан.
> **Осталось:** шаг 1.5 в `skills/init/SKILL.md`, init-context.md, manual_docs.

## Постановка

`/maestro-init` — bootstrap нового проекта для работы скилла `maestro`. Команда
должна быть **идемпотентной**: повторный запуск безопасен, существующие файлы
детектятся и обновляются через HITL (с diff), а не перезаписываются молча.

**Текущий разрыв:** `/maestro-init` создаёт только `docs/project-context.md`,
spec, scaffold и `docs/roadmap.md`. Конфиги, которые мастер-система ожидает
(см. плагин `maestro-bootstrap`, `skills/maestro/SKILL.md`), **не генерируются**:

| Файл | Путь | Назначение | Поведение при отсутствии |
|---|---|---|---|
| `opencode.json` | корень | регистрация плагина + модели агентов | плагин не подключён |
| `maestro.json` | корень | консолидированный конфиг: `trust`, `access_policy`, `sanitizer_whitelist` | fail-open: все untrusted, дефолтные правила |
| `.gitignore` | корень | `.maestro/` эфемерное в ignore | эфемерные файлы коммитятся |

Плагин (index.js) — все конфиги **fail-open**: система работает без них,
но со слабой безопасностью. `maestro.json` коммитится в git (project policy);
`.maestro/` содержит только эфемерные файлы (логи, sdd/, last-run).

## Принцип идемпотентности

1. **Детект** — какие конфиги уже существуют.
2. **Вычислить «желаемое» состояние** из контекста (14 категорий).
3. **HITL-гейт по каждому файлу** — создать / обновить (показать diff) / пропустить / отмена.
4. **Никогда не перезаписывать молча** — только через HITL.
5. **Merge сохраняет пользовательские правки** — не удаляем ключи, добавленные
   пользователем; показываем diff «желаемое vs текущее».

## Новый шаг в `skills/init/SKILL.md`: «Шаг 1.5. Конфигурация maestro»

Размещается между «Шаг 1. Сбор контекста» и «Шаг (a). Дизайн»:
- Нужен контекст (14 категорий) для вывода параметров.
- Конфиги независимы от дизайна/scaffold/roadmap — могут генерироваться раньше.

**C1 (критично):** Шаг 1.5 выполняется в **обоих** путях предусловия 2:
- Новый проект (файла нет): Шаг 1 (сбор контекста) → **Шаг 1.5** → (a)+(b)+(c)
- Существующий проект (option a): загрузка контекста из файла → **Шаг 1.5**
  → (a)+(c)

Предусловие 2 option (a) обновить: «перейти к Шагу 1.5, затем к (a)+(c)»
(вместо «сразу к (a)+(c)»).

**Подготовка каталогов (I1, M1):** перед генерацией конфигов:
- `mkdir -p .maestro/` (для логов плагина и `last-run.md`)
- `mkdir -p docs/superpowers/specs docs/superpowers/plans` (для шага (a))
- Идемпотентно (`mkdir -p` безопасен при существовании).

### Алгоритм (общий для всех файлов)

```
для каждого файла из матрицы (A–E):
  exists = test -f <path>
  desired = вычислить_желаемое(контекст)
  если не exists:
    HITL: создать (desired) / пропустить / отмена
  иначе:
    current = прочитать(current)
    diff = вычислить_diff(current, desired)
    если diff пустой → skip (актуально)
    иначе HITL: (a) обновить до desired (показать diff) /
                (b) пропустить (оставить текущее) /
                (c) отмена
```

### Матрица конфигов и вывод параметров

#### A. `maestro.json` (корень) — консолидированный конфиг

Три секции в одном файле (коммитится в git):

**Секция `trust`** — из §12 Безопасность:
```json
"trust": {
  "design": true,
  "sanitizer": true
}
```
- `design`, `sanitizer` — trusted по роли (см. Trust Model в SKILL.md).
- HITL: если §12 допускает доверенные модели, предложить добавить `opus`, `haiku`
  и т.д. со значением `true`.
- Идемпотентность: merge сохраняет пользовательские trusted-агенты.

**Секция `access_policy`** — из §3 Стек + §5 Домены/модули + §12:
```json
"access_policy": {
  "version": 1,
  "default": "ask",
  "allow": ["src/**", "test/**", "packages/**", "*.{ts,js,py,go,rs}"],
  "ask": ["docs/**", "specs/**", "manual_docs/**", "*.{md,mdx}", "*.config.*"],
  "deny": ["*.env", "*.env.*", "*.{pem,key,cert,secret}"]
}
```
- Эталон: `plugins/maestro-bootstrap/examples/maestro.example.json`.

**Секция `sanitizer_whitelist`** — из §3 + §12:
```json
"sanitizer_whitelist": {
  "rules": { "env_secret": true, "data_field": true, ... },
  "by_agent": { "code-reviewer": [] },
  "patterns": [],
  "extra_fields": [<кастомные sensitive-поля из §12>],
  "extra_uri_schemes": [<URI-схемы из §3: redis, kafka, grpc>]
}
```

**Идемпотентность:** при существовании `maestro.json` — diff по каждой секции;
merge сохраняет пользовательские правки. Если файл отсутствует — создаётся
целиком. Эталон: `plugins/maestro-bootstrap/examples/maestro.example.json`.
`maestro.json` — единственный источник конфигурации (старые файлы не читаются).

#### B. `.gitignore` — конкретные пути, НЕ весь `.maestro/`

- Проверить наличие записей; добавить недостающие (не дублировать):
  ```
  .maestro/sdd/
  .maestro/last-run.md
  .maestro/maestro-bootstrap-*.log
  ```
- **НЕ** использовать `.maestro/` (весь каталог) — эфемерные файлы игнорируются
  точечно; конфиги теперь в `maestro.json` (корень). Соответствует
  `skills/maestro/SKILL.md:133`.
- Идемпотентность: если все три записи уже есть — skip.
- **Pre-existing fix (M3):** исправить `AGENTS.md:19` и
  `plugins/maestro-bootstrap/README.md` — заменить «`.maestro/`» на
  конкретные пути (см. C2 в ревью).

#### C. `opencode.json` (корень) — merge через HITL

- **Никогда не перезаписывать существующий контент.**
- Регистрация плагина: `"plugin": ["./plugins/maestro-bootstrap/index.js"]`.
  Если ключа `plugin` нет → добавить; если есть, но путь отсутствует →
  предложить дописать; если уже есть → skip.
- Записи `agent.*` (design, sanitizer, opus, haiku, sonnet, fable,
  code-reviewer) — **HITL-вопрос** для каждой: «Модель для `<agent>`?
  (введите ID / `auto` — дефолт OpenCode)». При `auto` — ключ `model` **не
  пишется** (OpenCode использует свой дефолт). Не выводятся из контекста —
  это preference. Если ключ `agent.<name>` уже есть → не трогать.
- **НЕ использовать плейсхолдеры** (`<выберите модель>`) — невалидный ID
  сломает загрузку агента (см. I2 в ревью).
- HITL: показать diff-merge (что будет добавлено), подтвердить.

#### D. `.opencode/` зеркала — ВНЕ СКОУПА

- Документировать как ручной шаг (по `AGENTS.md` — синхронизация из авторского
  репо разработчиком). Не генерировать, не проверять.

#### E. `regression/` структура каталогов (I3)

SKILL.md:135-137 ожидает `regression/entries/`, `regression/released/`,
`regression/cancelled-features.md` (через `.gitkeep`). `/maestro-init` создаёт:
```
regression/entries/.gitkeep
regression/released/.gitkeep
regression/cancelled-features.md   (пустой файл с заголовком)
```
- Идемпотентность: если структура существует — skip.
- Не входит в HITL-гейт (структурная необходимость, не preference).

## Обновления файлов (scope)

| # | Файл | Действие |
|---|---|---|
| 1 | `skills/init/SKILL.md` | Новый шаг 1.5; обновить предусловие 2 option (a) (C1); таблицу «Артефакты»; «Завершение»; «Обработка сбоев» |
| 2 | `skills/init/init-context.md` | Раздел «Вывод конфигурации из контекста» — правила для A–G |
| 3 | `commands/maestro-init.md` | Отразить шаг 1.5 в списке действий |
| 4 | `plugins/maestro-bootstrap/examples/maestro.example.json` | Эталон консолидированного конфига (создан) |
| 5 | `AGENTS.md` | Pre-existing fix (C2/M3): `.gitignore` — конкретные пути вместо `.maestro/` |
| 6 | `plugins/maestro-bootstrap/README.md` | Pre-existing fix (C2/M3): «каталог gitignored» → конкретные пути |
| 7 | `manual_docs/reference/commands.md` | Описание `/maestro-init` — упомянуть генерацию конфигов |
| 8 | `manual_docs/overview/changelog.md` | Entry: идемпотентная генерация конфигов + fix `.gitignore` |
| 9 | `manual_docs/how-to/customize-maestro.md` | Список артефактов `/maestro-init` (добавить конфиги + regression/) |
| 10 | `manual_docs/explanation/agents-and-trust.md` | `maestro.json` (trust/access_policy/sanitizer_whitelist) генерируется `/maestro-init` |
| 11 | `manual_docs/reference/model-selection.md` | opencode.json agent.* — упоминает генерацию через HITL |

## Проверка

- `node --test plugins/maestro-bootstrap/index.test.js` — 59/59 (плагин не
  меняется; конфиги fail-open совместимы). Проверка регрессии плагина.
- **Исполняемого теста для скилла `init` нет** (M2) — верификация = ревью доков
  на когерентность: SKILL.md ↔ init/SKILL.md ↔ init-context.md ↔ manual_docs.
- HITL-протокол и язык (русский) соблюдены.
- Идемпотентность: повторный запуск `/maestro-init` — все конфиги «актуальны»
  (skip без HITL, если diff пустой).

## Известные ограничения / open questions

- **opencode.json merge** — JSON merge семантически сложен (вложенные ключи,
  массивы). В плане — HITL с показом diff, не автоперезапись. Реализацию merge
  оркестратор делает через чтение → правку → запись (или `jq`), но всегда с
  показом diff пользователю.
- **Модели агентов** — preference пользователя; вводятся через HITL, при
  `auto` ключ `model` не пишется (I2 решён).
- **`extra_fields`/`extra_uri_schemes`** — выводятся из §3/§12, но могут быть
  неполными; пользователь докручивает вручную. `/maestro-init` даёт разумный
  дефолт.
- **Существующие пользовательские trusted-агенты** в секции `trust` файла
  `maestro.json` — не удаляются (merge сохраняет).

---

## Ревью планируемых изменений (2026-08-19)

### Critical

#### C1. Шаг 1.5 пропускается при повторном запуске (нарушение идемпотентности)

**Проблема:** Предусловие 2 (проверка `docs/project-context.md`) option (a):
«перечитать/восстановить контекст из него и перейти сразу к шагам (a)+(c)» —
**пропускает Шаг 1** и переходит к (a)+(c). Шаг 1.5 размещён ПОСЛЕ Шага 1 →
будет пропущен. Это именно случай повторного запуска (идемпотентности):
существующий проект, пользователь выбирает (a).

**Решение:** Шаг 1.5 должен выполняться в **обоих** путях:
- Новый проект: Шаг 1 (сбор контекста) → **Шаг 1.5** (конфиги) → (a)+(b)+(c)
- Существующий проект (option a): загрузка контекста из файла → **Шаг 1.5**
  (конфиги) → (a)+(c)

Реализация: обновить предусловие 2 option (a) — «перейти к Шагу 1.5, затем к
(a)+(c)». ИЛИ вынести Шаг 1.5 перед предусловиями (но тогда контекст может быть
недоступен). Корректное место — после загрузки контекста (любым путём), до (a).

#### C2. `.gitignore` для `.maestro/` — противоречие в существующих доках

**Проблема:** План говорит «добавить `.maestro/` в `.gitignore`». Но:
- `skills/maestro/SKILL.md:133` — «`.maestro/` в `.gitignore` — **только
  эфемерное** (sdd/, last-run, maestro-bootstrap-*.log); реестр в git»
- `AGENTS.md:19` — «`.gitignore` entry `.maestro/`» (весь каталог)
- `plugins/maestro-bootstrap/README.md:105` — «каталог gitignored» (весь)

**Противоречие:** `access-policy.json` и `sanitizer-whitelist.json` живут в
`.maestro/`. Если весь `.maestro/` в gitignore — они **не коммитятся**, но это
project policy (должна быть общей для команды, как `trust-config.json`).

**Решение:** `.gitignore` должен использовать **конкретные пути**, не весь
каталог:
```
.maestro/sdd/
.maestro/last-run.md
.maestro/maestro-bootstrap-*.log
```
Это соответствует SKILL.md:133. Конфиги (`access-policy.json`,
`sanitizer-whitelist.json`) коммитятся. Заодно исправить AGENTS.md:19 и
plugins/maestro-bootstrap/README.md:105 (pre-existing inconsistency).

### Important

#### I1. `.maestro/` каталог может не существовать на свежем проекте

**Проблема:** План генерирует `.maestro/access-policy.json` и
`.maestro/sanitizer-whitelist.json`. На свежем проекте `.maestro/` может не
существовать (плагин создаёт его для логов при первом `task`-диспатче, но
`/maestro-init` может запускаться до этого).

**Решение:** Перед записью конфигов — `mkdir -p .maestro/`.

#### I2. `opencode.json` — плейсхолдеры моделей невалидны

**Проблема:** План предлагает модели как «плейсхолдеры (`<выберите модель>`)».
JSON не поддерживает комментарии; строка `<выберите модель>` как `model` —
невалидный ID, OpenCode упадёт при загрузке агента, если пользователь не
замменит.

**Решение:** Не писать плейсхолдеры. Варианты:
- (a) HITL-вопрос: «Модель для `<agent>`? (введите ID / `auto` — дефолт
  OpenCode)». При `auto` — ключ `model` не пишется (OpenCode использует свой
  дефолт).
- (b) Использовать разумные дефолты по tier (haiku → дешёвая, opus → дорогая),
  но это preference — лучше (a).

#### I3. `regression/` структура каталогов не создаётся

**Проблема:** SKILL.md:135-137 ожидает `regression/entries/`,
`regression/released/`, `regression/cancelled-features.md` (через `.gitkeep`).
`/maestro-init` этого не делает — bootstrap неполон.

**Решение:** Добавить в Шаг 1.5 (или отдельный шаг) создание структуры
`regression/` с `.gitkeep` — если отсутствует. Идемпотентно (skip если есть).

### Minor

#### M1. `docs/superpowers/{specs,plans}/` каталоги не гарантируются

Шаг (a) пишет spec в `docs/superpowers/specs/`. Если каталога нет — `write`
упадёт. `/maestro-init` должен `mkdir -p docs/superpowers/specs
docs/superpowers/plans` (или `design` сабагент делает это сам через bash — но
у `design` `bash: deny`). Решение: оркестратор создаёт каталоги до диспатча
`design`.

#### M2. Верификация ограничена

План говорит «`node --test` — 59/59», но плагин не меняется. Реальная
проверка — когерентность доков (SKILL.md, init, manual_docs). Исполняемого
теста для скилла `init` нет. Честно зафиксировать: верификация = ревью доков.

#### M3. Pre-existing inconsistency: AGENTS.md vs SKILL.md на `.gitignore`

Связано с C2. AGENTS.md:19 и plugins/README.md:105 говорят «весь `.maestro/`»,
SKILL.md:133 — «только эфемерное». Нужно привести к единому (specific paths)
в рамках этого изменения.

### Сводка решений по ревью

| # | Severity | Решение |
|---|---|---|
| C1 | Critical | Шаг 1.5 выполняется в обоих путях (новый + существующий проект); обновить предусловие 2 option (a) |
| C2 | Critical | `.gitignore` — конкретные пути (`.maestro/sdd/`, `.maestro/last-run.md`, `.maestro/maestro-bootstrap-*.log`); исправить AGENTS.md + plugins/README.md |
| I1 | Important | `mkdir -p .maestro/` перед записью конфигов |
| I2 | Important | opencode.json: HITL-вопрос для моделей; при `auto` — ключ `model` не пишется |
| I3 | Important | Создание `regression/` структуры с `.gitkeep` (если отсутствует) |
| M1 | Minor | `mkdir -p docs/superpowers/{specs,plans}` до диспатча `design` |
| M2 | Minor | Зафиксировать: верификация = ревью доков (не test) |
| M3 | Minor | Исправить pre-existing inconsistency (вместе с C2) |

**Все решения учтены в обновлённом плане (см. выше). Реализация ещё не начата.**
