# Spec: шаг 16 — ревью по типу артефакта (#107, 4.16.0)

Статус: принята гейтом 10 (подписи: sanitize CLEAN + review approve)
Спека: `docs/superpowers/specs/2026-09-30-review-by-artifact-type-design.md`

**Редакция (2026-09-30, финальное ревью ветки — Needs fixes → fix-loop):**
D5 — в безрасширенный перечень добавлены `Dockerfile`, `Makefile`
(contradiction D5↔D2: файлы без точки проходили бинарный гейт вопреки
сценарию «Dockerfile → config»); `LICENSE.*` — name-паттерн, проверяется до
извлечения расширения (кромка `LICENSE.MIT`). D8 — sweep-исключения
дополнены (внешний superpowers-шаблон, stale-строки *.sh, §8 «(ex …)»).
Хэш в подписях stale — осознанно (изменение после принятия; документ
остается снимком решения + фиксацией фикса).

## Контекст / проблема

Шаг 16 (финальное ревью) имеет один унифицированный промпт «code review»
(`agents/code-reviewer.md`): фокус — кросс-тасковые проблемы, соответствие
спеке, архитектура, test coverage, риск регрессии. Профиль заточен под код.

`TODO.md` (строка 123): «Проект не всегда связан с кодом, это может быть любой
артефакт (документация, презентация, изображение и т.п.). В зависимости от типа
артефакта итоговых данных должно выбираться ревью. Под каждый тип данных — свои
требования к ревью, которые должны определяться ещё при подготовке или
обновлении `project-context.md`».

`docs/roadmap.md` (Волна 2, #107, M4): требования на тип — в
`project-context.md`; **привязать к существующим 14 категориям, не плодить
параллельную схему**.

#95 (4.12.0) уже переделал шаг 16: параллельное первое ревью
(`code-reviewer` + `sonnet`, `review.parallel`, guard «одна модель»), M3-
арбитраж, P1.1 (Minor не блокируют). #107 — надстройка, не замена: verdict-
формат, P1.1, M3, fix-loop — не меняются.

Spike (эта сессия, 2026-09-30) — дизайн-решения зафиксированы HITL:

- **R1.** Четыре типа артефакта: `code` / `docs` / `config` / `sql`.
- **R2.** Тип детектируется **механически** (оркестратор, не HITL) по дифу.
- **R3.** Критерии ревью по типу — в `project-context.md` (§9 «Критерии
  приёмки качества» — существующая 9-я категория, M4).
- **R4.** Агенты те же (`code-reviewer` senior; `sonnet` в параллельном
  первом) — тип + активные критерии передаются в промпт диспатча.
- **R5.** Бинарные/нетекстовые артефакты (презентации, изображения) — без
  авто-детекта: HITL-выбор режима ревью.
- **R6.** Параллельное первое ревью (#95) — только для типа `code`.
- **R7.** Встроенные (built-in) критерии по типу + override из
  `project-context.md` (проектные критерии приоритетнее).

## Решение

### D1. Типы артефакта

`code` / `docs` / `config` / `sql`. Тип — свойство **дифа ветки** (набора
изменённых файлов против базы), не фичи: диф может дать **набор** типов.

### D2. Механическое детектирование (оркестратор, до диспатча, анонс в чат)

Определение типов по детерминированным правилам (канон — новая глава
`references/artifact-review.md`):

Закрытые детерминированные списки (никаких «и т.п.»); приоритет проверки:
`sql` → `config` → `docs` → `code` (файл попадает в первый подходящий тип).

| Тип | Правило (закрытые списки) |
|---|---|
| `sql` | `*.sql`; каталоги миграций: слот «Миграции (каталоги): <пути> (опц.)» в `project-context.md` §3, если задан; иначе дефолт-глобы `**/migrations/**`, `**/db/migrate/**` |
| `config` | `*.json` (кроме test-фикстур: путь содержит `/test/`, `/tests/`, `/__tests__/`, `/fixtures/`, `/__snapshots__/` или имя `*.test.json` → `code`); `*.yml`, `*.yaml`, `*.lock`, `*.toml`, `*.ini`, `*.cfg`, `*.conf`; файлы: `Dockerfile`, `Makefile`, `.gitignore`, `.gitattributes`, `.editorconfig`, `.env.example`, `agpack.yml` |
| `docs` | **все** `*.md` в репо (любой путь — `.md` есть документация, включая `src/**/*.md`) |
| `code` | любой трекаемый файл, не попавший в три типа выше (source, тесты, тест-фикстуры, скрипты `*.sh`, `plugins/**`) |

Правила:

1. Диф пуст/неопределим → `code` (консервативный дефолт — строгий путь).
2. Смешанный диф → **набор** типов (дедуп); приоритета у типов нет (приоритет
   выше — только порядок применения правила к одному файлу).
3. Наличие `code` в наборе → ревью по кодовому пути (строгому); критерии
   docs/config/sql — добавляются в промпт как вторичные фокусы (файлы
   этих типов в дифе проверяются по своим критериям).
4. Детект — механический, не HITL; оркестратор анонсирует строкой:
   «Тип артефакта: <набор> (правило: <сводно>)». Расхождение с ожиданиями —
   HITL-коррекция возможна **до** диспатча (контентный вопрос), после — нет.
5. Порядок с D5: **сначала** проверка бинарных файлов (D5, allowlist
   текстовых расширений) → при наличии — HITL-гейт D5; **затем** детект типов
   по оставшейся (текстовой) части дифа → анонс.
6. **Вне детекта — вспомогательные артефакты процесса maestro** (список
   зеркалит SCOPE NOTE `references/spec-review.md`): `docs/superpowers/
   specs/**`, `docs/superpowers/plans/**`, changelog (`manual_docs/overview/
   changelog.md`), `regression/**`. Они не дают типов, не попадают в анонс,
   критерии типов к ним не применяются. `docs/**` (кроме superpowers) и
   `manual_docs/**` остаются в детекте — поставляемые артефакты (шаг 14).

### D3. Критерии ревью по типу (built-in + override)

- **Built-in** (канон `references/artifact-review.md`, таблица «Критерии по
  типу»):
  - `code` — текущий канон `agents/code-reviewer.md` (5 пунктов фокуса,
    secret-scan SEC-3).
  - `docs` — согласованность с фактическим состоянием (код/конфиги),
    полнота (нет обещаний несуществующих фич), ссылки/указатели резолвятся,
    терминология согласована с `manual_docs`-конвенциями, формат (Diátaxis —
    секция по типу контента).
  - `config` — схема/формат валиден, дефолты заданы, синхронизация доков
    (ключ описан там, где описаны другие ключи), доставка (регистрация в
    `agpack.yml` — при новых компонентах), backward-compat (удаляемые/
    переименованные ключи — migration notes).
  - `sql` — reversibility/направление миграции, потеря данных (DROP/ALTER
    NOT NULL на живых колонках), индексы/производительность на больших
    таблицах, согласованность со стеком (§3: ORM/драйвер), именование по
    конвенциям проекта (§4/§5, §9).
- **Override — единое правило (по-пунктный merge, приоритет §9):** пункт §9,
  покрывающий тип, **заменяет соответствующий** built-in-пункт; built-in-
  пункты без аналога в §9 **остаются**. Замена на уровне пункта, не типа.
  Мини-пример (в главе канона): built-in `config` = [валидность, дефолты,
  синк доков, доставка, compat]; §9 проекта: «для `config` проверять
  additionally: feature-флаги задокументированы» → активные критерии =
  built-in (5 пунктов) + пункт §9.
- Источник §9 читается на шаге 0 (PROJECT_CONTEXT) — повторного чтения нет.

### D4. Агенты и промпты

- Агенты (по ролям) не меняются: senior-ревьюер (opus-тир) — `reviewer`
  (переименование — D8); `sonnet` — параллельное первое (только `code`, D6).
- `agents/code-reviewer.md`: новый короткий раздел «Ревью по типу
  артефакта»: ревью ведётся по типу/набору типов и критериям, **переданным в
  промпте диспатча**; если поле не передано — тип `code`, built-in-критерии
  (совместимость с текущим поведением). Формат вердикта, P1.1, secret-scan —
  без изменений. Промпт остаётся self-contained (таблица критериев в промпт
  НЕ встраивается — передаёт оркестратор из канона/reference).
- Диспатч: оркестратор добавляет блок «Тип артефакта: …; Активные критерии:
  … (built-in | project-context §9: <цитата пунктов>)» в промпт
  code-reviewer и sonnet (sonnet — дословный канон + этот блок).

### D5. Бинарные/нетекстовые артефакты

- Авто-детект **неприменим** (LLM не читает бинары надёжно).
- **Allowlist текстовых расширений** (закрытый список, канон —
  `references/artifact-review.md`): `md`, `markdown`, `txt`, `json`, `jsonc`,
  `yml`, `yaml`, `js`, `mjs`, `cjs`, `ts`, `tsx`, `jsx`, `css`, `scss`, `html`,
  `htm`, `xml`, `svg`, `sql`, `sh`, `bash`, `zsh`, `py`, `rb`, `go`, `rs`,
  `java`, `kt`, `c`, `h`, `cpp`, `hpp`, `cs`, `php`, `toml`, `ini`, `cfg`,
  `conf`, `lock`, `env`, `example`, `gitignore`, `gitattributes`,
  `editorconfig`, `dockerfile`, `makefile`; **безрасширенные имена**
  (закрытый перечень; проверяются **до** извлечения расширения — имя файла
  без точки целиком): `LICENSE`, `LICENSE.*` (name-паттерн: любое расширение
  после `LICENSE.`, напр. `LICENSE.MIT`), `Gemfile`, `Rakefile`, `Procfile`,
  `Jenkinsfile`, `Dockerfile`, `Makefile`. **Всё, что вне allowlist (в т.ч.
  прочие файлы без расширения) → бинарный** (deny-by-default: неизвестный
  формат не проходит молча). Расширение списка — по мере реальных прогонов
  (канон-глава).
- Порядок: проверка бинарности → HITL-гейт (если есть) → детект типов по
  текстовой части (D2) → анонс (зафиксировано в D2 п.5).
- HITL-гейт (контентный; поведение по режимам: **manual / auto-answer —
  HITL**; **auto-ai — решение ИИ** с журналом решений, recommended (a);
  registered в `references/hitl-gate-protocol.md`):
  > «В дифе нетекстовые артефакты: <список>. (a) ИИ-ревью текстовой части
  > дифа, бинарные — за вами (ручное) / (b) ИИ-ревью всего дифа по кодовому
  > канону, бинарные игнорируются / (c) стоп».
- Семантика вариантов: **(a)** — стандартный путь D2→D4 (детект типов по
  текстовой части, тип-критерии в промпт); **(b)** — текстовая часть
  ревьюится **только по кодовому канону**: типы анонсируются, но тип-
  критерии в промпт не добавляются; **(c)** — стоп.
- «recommended» — только как fallback-маркер auto-ai (решение ИИ с журналом,
  fallback (a)); в тексте гейта для manual/auto-answer пометки нет (правило
  3а `hitl-gate-protocol.md`: дефолты — только на 5 decision-гейтах).
- Рекомендуемый вариант — (a): ИИ ревьюит текстовую часть дифа по типовым
  критериям, бинарные артефакты человек проверяет сам (фиксируется в отчёте
  гейта 17: «бинарные артефакты — ручное ревью HITL»).
- В типовую таблицу (D1) бинарный тип **не входит** — это режим ревью,
  не тип артефакта.

### D6. Параллельное первое ревью — только `code`

- Набор типов содержит `code` → логика #95 **без изменений**
  (`review.parallel` auto/always/off, guard «одна модель», M3-арбитраж).
- Набор типов ⊆ {docs, config, sql} → **всегда одиночное**
  (`code-reviewer`), независимо от `review.parallel` (малые дифы,
  параллельность неоправданна; guard «одна модель» не применяется).
- Анонс строкой: «Параллельное ревью: да/нет — причина: <…>» (формат #95
  сохраняется, добавляется причина «тип артефакта: docs-only»).

### D7. Канон и поверхности изменений

| Файл | Изменение |
|---|---|
| `skills/maestro/references/artifact-review.md` | **новая** глава канона: типы, правила детекта (D2), built-in критерии (D3) + мини-пример override, allowlist текстовых расширений (D5), диспатч-матрица (D4/D6). Формат под существующие тесты: заголовок `# … (глава)`, строка «Канон:», упоминание в SKILL.md (anti-orphan) |
| `skills/maestro/SKILL.md` (шаг 16) | компактная механика: детект → анонс → выбор dispatch (parallel/single) → критерии → pointer на reference (~15–20 строк, без дублирования таблиц) |
| `agents/code-reviewer.md` → `agents/reviewer.md` | **rename** (git mv, D8) + новый description + раздел «Ревью по типу артефакта» (D4) |
| `.opencode/opencode.json` (dogfood, gitignored) | ключ модели: `agent.code-reviewer.model` → `agent.reviewer.model` |
| `skills/maestro-setup/init-context.md` | категория 9: подсекция «критерии ревью по типу артефакта (опц.; built-in-дефолты — канон maestro `references/artifact-review.md`)» (M4); категория 3: опциональный слот «Миграции (каталоги): <пути>» (вход детекта `sql`, D2) |
| `skills/maestro/references/hitl-gate-protocol.md` | регистрация нового гейта (D5) в полном перечне + поведение по режимам (manual/auto-answer — HITL; auto-ai — ИИ с журналом, recommended (a)) |
| `skills/maestro/references/spec-review.md` | одна строка в «Границах ревью»: первое ревью шага 16 — параллельно только для типа `code` |
| `AGENTS.md` | список глав канона: 10 → 11 (`artifact-review.md`) |
| `manual_docs/` | `explanation/pipeline-overview.md` (шаг 16 + rename), `reference/hitl-gates.md` (HITL бинарных + rename), `reference/config.md` (переопределение `review.parallel: always` для не-code типов), `reference/model-selection.md` (строка + rename), `explanation/agents-and-trust.md` (rename), `explanation/project-context.md` (категории 3/9), `how-to/update-maestro.md` (строка миграции `agent.code-reviewer.model` → `agent.reviewer.model`), `overview/changelog.md` (4.16.0: буллит переопределения `always` + migration note rename) |
| `docs/project-context.md` | §4 (строка перечня агентов) + §8 — строка о процессе ревью (dogfooding-авторинг), §9 — собственная подсекция критериев (живая проверка override-пути) |
| `maestro-install.sh` / `maestro-update.sh` | секции 4a/3a — stale-очистка `.opencode/agents/code-reviewer.md` (D8) |
| `docs/roadmap.md` | #107 → выполнено (версия 4.16.0) |
| `regression/entries/2026-09-30-review-by-artifact-type.md` | entry (риск LOW, сценарии детекта, FU) |
| `TODO.md` (строка 123) | отметка при merge |

### D8. Переименование агента `code-reviewer` → `reviewer`

Обоснование: после #107 агент ревьюит все типы артефакта (code/docs/config/
sql) — имя `code-reviewer` вводит в заблуждение. Агентов по типам **не
плодится**: один нейтральный агент, тип + критерии — в промпте диспатча (D4).

Поверхность rename (полный перечень, аудит `grep -rln "code-reviewer"`):

- `agents/code-reviewer.md` → `agents/reviewer.md` (git mv; description:
  «Финальное ревью ветки по типу артефакта: git diff, история коммитов,
  анализ (code/docs/config/sql)»).
- `skills/maestro/SKILL.md` (шаг 16 + упоминание ~строка 461 вне шага):
  `subagent_type=code-reviewer` → `reviewer`; guard «одна модель» (D6/#95)
  читает `agent.reviewer.model` (вместо `agent.code-reviewer.model`).
- Канон-главы: `skills/maestro/references/model-selection.md` (маппинг
  `code_review` → `reviewer`, ключ `agent.reviewer.model`, tier-маппинг,
  permissions), `skills/maestro/references/trust-and-security.md`
  (trust-таблица + Точка 2), `skills/maestro/references/spec-review.md`
  (упоминания + новая строка D7).
- `skills/maestro-setup/SKILL.md` — генерация ключа **новым** проектам:
  `agent.code-reviewer.model` → `agent.reviewer.model` (иначе guard
  «одна модель» никогда не сработает в новых установках).
- `skills/maestro-assistant/SKILL.md` (пример JSON-канона `by_agent`),
  `commands/maestro-init.md`, `commands/test-agents.md` (иначе `@test-agents`
  диспатчит несуществующего агента → гарантированный FAIL).
- `maestro.json` (dogfood): `sanitizer_whitelist.by_agent.code-reviewer` →
  `reviewer` (stale-ключ ИБ-контура).
- `AGENTS.md` (перечень агентов, строка 9), `README.md`,
  `docs/project-context.md` §4 (строка 88) + §8 (процесс ревью),
  `plugins/maestro-bootstrap/README.md` (примеры `by_agent`).
- `manual_docs/`: `explanation/agents-and-trust.md`, `reference/
  model-selection.md`, `explanation/pipeline-overview.md`, `reference/
  hitl-gates.md`, `reference/commands.md`, `reference/config.md`,
  `how-to/choose-models.md`, `how-to/customize-maestro.md`,
  `examples/example-feature.md`, `tutorials/setup-project.md`.
- **Миграция целевых проектов:**
  - **Скриптовая (HITL-решение (a)):** `maestro-install.sh` (секция 4a) и
    `maestro-update.sh` (секция 3a) — stale-очистка
    `.opencode/agents/code-reviewer.md` (детерминированный путь, прецедент
    3a/4a rename-миграций).
  - **Ручная (migration notes, прецедент `feature-agent` → `maestro` —
    lockstep):** ключи `agent.code-reviewer.model` в merge-config
    (`.opencode/opencode.json` / global `opencode.json`) и
    `sanitizer_whitelist.by_agent.code-reviewer` в `maestro.json` — скрипты
    их не трогают (вне их scope). Митигация: migration note в changelog
    4.16.0 + строка в `manual_docs/how-to/update-maestro.md`. Dogfood-репо:
    обновить локальный merge-config + `maestro.json`.
 - Критерий приёмки (сweep): `grep -rn "code-reviewer"` по живым поверхностям
   (skills/, commands/, agents/, manual_docs/, plugins/maestro-bootstrap/
   README.md, README.md, AGENTS.md, docs/project-context.md, maestro.json,
   *.sh) — **0 попаданий**, кроме: исторических (`specs/`,
   `docs/superpowers/`, `regression/`, changelog-секции до 4.16.0);
   тест-фикстуры `plugins/maestro-bootstrap/index.test.js` (строковый ключ,
   плагин не меняется); migration-note-упоминаний вида «code-reviewer →
   reviewer» (changelog 4.16.0, `update-maestro.md`, `docs/project-context.md`
   §8 «(ex code-reviewer)»); stale-очистки в `maestro-install.sh`/
   `maestro-update.sh` (по дизайн (a)); ссылки на **внешний** шаблон
   superpowers `requesting-code-review/code-reviewer.md`
   (`references/model-selection.md` — pre-existing, файл внешнего пакета,
   не переименовывается).

Изменений в плагине **нет** (процессная фича: скиллы/агенты/доки).

## Non-goals

- Новая параллельная схема типов/категорий вне 14 категорий
  `project-context.md` (M4).
- LLM-ревью содержимого бинарных файлов (изображения/презентации) — только
  ручное HITL.
- Новые конфиг-ключи: `review.parallel` сохранён, применяется только к
  `code`; детект типов — процессный канон, не конфиг.
- Изменения spec review (шаг 9), task review (13d), debug sub-pipeline (D-
  flow) — #107 касается только шага 16.
- Изменения verdict-формата, P1.1 (Minor не блокируют), M3-арбитража,
  fix-loop, secret-scan SEC-3.
- Миграция существующих `project-context.md` (подсекция §9 — опциональная;
  старые проекты работают по built-in).

## Риски и митигации

| Риск | Митигация |
|---|---|
| Неверный тип → не тот фокус ревью | набор типов (не один); дефолт `code` (строгий); закрытые детерминированные списки в каноне; анонс в чат до диспатча; HITL-коррекция до диспатча |
| Раздувание скелета SKILL.md (урок 4.14.x) | таблицы критериев/правил — только в reference; в скелете ~15–20 строк механики + pointer |
| Смешанный диф: критерии размываются | `code` в наборе → строгий кодовый путь первичен; типовые критерии — вторичные фокусы |
| Self-contained-промпт code-reviewer ломается | раздел D4 — короткий, без встраивания таблиц; критерии — в промпте диспатча |
| Дрейф built-in критериев vs §9 | precedence задокументирован (override); built-in — канон reference (одна точка) |
| Крупный docs/config-only диф — одиночное ревью, одна слепая зона | §9-override (проект может ужесточить), `Reject`-эскалация, HITL-коррекция типа до диспатча; обоснование D6 — не только «малые дифы», но и отсутствие кодовой слепой зоны для таких типов |
| Rename: `agent.code-reviewer.model` в merge-config целевых проектов молча отваливается | скрипт-очистка stale-зеркала (4a/3a) + migration notes; dogfood-репо — обновить локально; sweep-критерий приёмки (grep по живым поверхностям — 0) |
| Ложные бинарные гейты на текстовых безрасширенных файлах | закрытый allowlist безрасширенных имён (D5); остаточный шум принимается (один (a)-ответ); расширение списка — по реальным прогонам |

## Тесты и критерии приёмки

- **Dogfooding (основная верификация, прецедент #95):** финальное ревью
  **этой** фичи (шаг 16) выполняется по новым правилам: собственный диф
  (SKILL.md/references/agents/commands/manual_docs/AGENTS.md/README.md/
  maestro.json/package.json + `*.sh` от D8) — набор {docs, config, code}
  (спека/план/changelog/regression — вне детекта, D2 п.6), ожидается: анонс
  «Тип артефакта: code+config+docs», параллельный путь #95 (категория
  Сложная + `code`; guard «одна модель» применяется по merge-config), блок
  активных критерий в промптах. Фиксируется в regression entry.
- Детерминированные сценарии детекта (таблица в плане, прогон оркестратором
  на реальных дифах при dogfooding + regression-сценариях): `*.md` → docs;
  `*.sql` → sql; `maestro.json` → config; `*.test.json` в `tests/` → code;
  `Dockerfile` → config; `LICENSE` → текстовый (allowlist D5); файл без
  расширения (прочие) → бинарный гейт (D5); `docs/superpowers/specs/*.md` →
  вне детекта (D2 п.6, не влияет на набор); смешанный → набор; пустой → code.
- `AGENTS.md` — 11 глав: **ручная** проверка (автоматических sweep-тестов по
  перечню глав AGENTS.md нет).
- Pointers: `SKILL.md → references/artifact-review.md` резолвится
  (anti-orphan покрывают существующие тесты главы).
- `agents/code-reviewer.md` — self-contained (грузится без skill-тула),
  раздел D4 присутствует, формат вердикта не изменён.
- `manual_docs` sync (pipeline-overview, hitl-gates, config.md,
  model-selection.md, explanation/project-context.md, changelog) — критерий
  приёмки (AGENTS.md).
- `npm test` — без регрессий (264/264 baseline).
- regression entry (риск LOW + сценарии + dogfooding-факт).

## Версионный bump (шаг 18)

**4.16.0** (minor: новое процессное правило скилла + rename агента).
Breaking-аспект: ключ merge-config `agent.code-reviewer.model` → stale
(override молча отваливается) — **migration notes** в changelog 4.16.0 +
строка в `update-maestro.md` (D8). Бамп: `package.json`, `package-lock.json`,
`docs/project-context.md` §3 (строка версии).

<!-- maestro:sanitize
status: CLEAN
date: 2026-09-30
hash: f506fbfc345a36dc2677ce2bb29acce8cc080c1022f320de6718080ab0f06f69
-->
<!-- maestro:review
reviewer: opus
date: 2026-09-30
verdict: approve
hash: f506fbfc345a36dc2677ce2bb29acce8cc080c1022f320de6718080ab0f06f69
-->
