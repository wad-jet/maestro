# План: установка maestro в сам авторский репозиторий (dogfooding)

## Цель

Сделать этот репозиторий (`maestro-agent`, `wad-jet/maestro`) полноценным **целевым
проектом** для скилла `maestro`, чтобы `@maestro`, `/maestro-init`, `/maestro-design`,
`/maestro-assistant` и плагин `maestro-bootstrap` работали прямо здесь — maestro
разрабатывает сам себя.

## Разграничение авторский-репо vs целевой-проект

AGENTS.md гласит: «это authoring-репо, не целевое приложение; не запускать pipeline
здесь». Пользователь **явно переопределяет** это ради dogfooding (высший приоритет —
прямое указание пользователя). Наш объём — сделать этот репозиторий функциональным
целевым проектом; содержимое `skills/`, `agents/`, `commands/`, `SECURITY.md`,
`manual_docs/`, `specs/` остаётся авторской разработкой, над которой работает maestro.

### Решения (согласованы с пользователем)

- **Доставка скиллов/агентов/команд в `.opencode/`**: `agpack` из GitHub
  (`wad-jet/maestro`). Подтверждено: GitHub main `1761b6e` === локальный `main`
  `1761b6e` — deploy идентичен текущему состоянию.
- **Плагин**: проектный `.opencode/opencode.json`, локальный путь
  `./plugins/maestro-bootstrap/index.js` (разрабатываем здесь).
- **Целевые артефакты**: создать и закоммитить (project-context.md, maestro.json,
  regression/, .gitignore `.maestro/`).
- **Модели агентов**: tier-маппинг по канону, на доступных моделях global-конфига.

## Предпосылки (подтверждены)

- `git remote origin` = `wad-jet/maestro`; branch `main`; HEAD `1761b6e`.
- `agpack` CLI установлен: `~/.local/bin/agpack`.
- `.opencode/` существует, gitignored, содержит superpowers skills (из agpack),
  `.opencode/opencode.json` отсутствует.
- Global `~/.config/opencode/opencode.json`: superpowers plugin, провайдер `akash`
  (модели: `deepseek-ai/DeepSeek-V4-Flash-0731`, `openai/gpt-oss-120b`,
  `Qwen/Qwen3.6-35B-A3B`, `zai-org/GLM-5.2`). Maestro plugin НЕ зарегистрирован.
- `.gitignore` имеет `.opencode/`, `.sandbox/`, `.worktrees/`, `.agpack.lock.yml`,
  `TODO.md`; **нет `.maestro/`**.
- Нет `docs/project-context.md`, `maestro.json`, `regression/`.

---

## Задача 1. `agpack.yml` — включить зависимости maestro и развернуть в `.opencode/`

**Файл:** корневой `agpack.yml` (сейчас maestro-зависимости закомментированы).

1. Раскомментировать/добавить зависимости maestro по манифесту **с 6 скиллами**
   (url `wad-jet/maestro`):
   - `skills`: `skills/maestro`, `skills/maestro-init`, `skills/maestro-design`,
     `skills/maestro-assistant`, `skills/maestro-feedback-report`,
     `skills/manual-docs`;
   - `commands`: `commands`;
   - `agents`: `agents`.
   - superpowers остаётся (уже активен).
2. `agpack sync` → развернёт `skills/maestro*`, `commands/`, `agents/` в `.opencode/`
   рядом с существующими superpowers.
3. Проверка: `.opencode/skills/{maestro,maestro-init,maestro-design,maestro-assistant,
   maestro-feedback-report,manual-docs}`,
   `.opencode/agents/{custodian,sanitizer,opus,sonnet,haiku,fable,code-reviewer}.md`,
   `.opencode/commands/{maestro,maestro-init,maestro-design,...}.md` существуют.

> **Почему 6 скиллов, а не 4 (канонических):** `/maestro-init` содержит жёсткий
> CRIT-2 gate — probe скилла `maestro-assistant` через `skill` tool; при его
> отсутствии **hard abort** всего init (`skills/maestro-init/SKILL.md:121-126`).
> Оркестратор `@maestro` также грузит `maestro-assistant` через `skill` tool по ходу
> пайплайна (`skills/maestro/SKILL.md:874-875`). Команда `/maestro-feedback-report`
> вызывает `skill maestro-feedback-report` (`commands/maestro-feedback-report.md`).
> `skill` tool находит скиллы только в `.opencode/skills/`. Канонический манифест
> (4 скилла) — разрыв в доках продукта; для dogfooding он обязан включать
> `maestro-assistant` и `maestro-feedback-report`. Канон чиним отдельно (см. Задача 1b).

> `agpack.yml` — коммитится (в отличие от `.opencode/`, который gitignored).
> `.agpack.lock.yml` — gitignored (уже в `.gitignore`).

## Задача 1b. Исправить канонический манифест (правка продукта maestro)

Разрыв: `maestro-init/agpack.yml` и `manual_docs/how-to/install-maestro.md` перечисляют
только 4 скилла maestro, но `maestro-assistant` (CRIT-2 gate, пайплайн) и
`maestro-feedback-report` (команда) обязательны для работы. Исправить канон:

1. `maestro-init/agpack.yml` — дополнить `skills` до 6: добавить
   `skills/maestro-assistant` и `skills/maestro-feedback-report`.
2. `manual_docs/how-to/install-maestro.md` — синхронно обновить манифест в документе
   (секция «Вариант A — через agpack») до 6 скиллов.

> Это изменение продукта maestro, вынесено отдельной задачей (не только для догфуда).

> **Caveat для живого развития:** agpack-from-git разворачивает **опубликованную**
> копию, не рабочую. Правки в `skills/`/`agents/`/`commands/` не подхватываются до
> `agpack sync` (или перехода на локальный путь/symlink). Для разработки
> maestro-на-maestro это приемлемо на текущем шаге; при необходимости перейти на
> локальный источник — отдельный шаг позже.

## Задача 2. `.opencode/opencode.json` — плагин + модели агентов

Создать `.opencode/opencode.json` (gitignored). Не перезаписывать существующее
(файла нет — создаём).

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "maestro-bootstrap@git+https://github.com/wad-jet/maestro.git"
  ],
  "agent": {
    "custodian":      { "model": "akash/zai-org/GLM-5.2", "temperature": 0.1 },
    "sanitizer":      { "model": "akash/Qwen/Qwen3.6-35B-A3B", "temperature": 0.0 },
    "opus":           { "model": "akash/zai-org/GLM-5.2", "temperature": 0.1 },
    "code-reviewer":  { "model": "akash/deepseek-ai/DeepSeek-V4-Flash-0731", "temperature": 0.2 },
    "sonnet":         { "model": "akash/deepseek-ai/DeepSeek-V4-Flash-0731", "temperature": 0.1 },
    "haiku":          { "model": "akash/Qwen/Qwen3.6-35B-A3B", "temperature": 0.0 },
    "fable":          { "model": "akash/deepseek-ai/DeepSeek-V4-Flash-0731", "temperature": 0.7 }
  }
}
```

Обоснование tier → модель (доступные в global `akash`):
- opus-tier (`custodian`, `opus`): `akash/zai-org/GLM-5.2`.
- code-reviewer (opus): `akash/deepseek-ai/DeepSeek-V4-Flash-0731`.
- sonnet-tier (`sonnet`): `akash/deepseek-ai/DeepSeek-V4-Flash-0731`.
- haiku-tier (`haiku`): `akash/Qwen/Qwen3.6-35B-A3B`.
- fable: `akash/deepseek-ai/DeepSeek-V4-Flash-0731`.
- sanitizer (своя, temp 0.0): `akash/Qwen/Qwen3.6-35B-A3B`.

> `temperature` берём дефолт по tier (M1). Модели — реальные ID global-конфига,
> плейсхолдеры запрещены.

> **Источник плагина — GitHub (устранено).** Плагин в этом репо подключён **из внешнего
> git-репозитория** `wad-jet/maestro`:
> ```json
> "plugin": ["maestro-bootstrap@git+https://github.com/wad-jet/maestro.git"]
> ```
> Проверено: `opencode debug config` показывает git-источник; `.maestro/plugin-version`
> = `1.1.0`; строка `plugin initialized` от git-плагина в `.maestro/logs/` свежая.
> **Следствие:** правки в локальном `plugins/` этого репо НЕ подхватываются — тестируется
> опубликованная версия с GitHub. Для разработки плагина — временно вернуть локальный
> путь (см. ниже).
>
> **Путь плагина (диагностика и отклонение).** Промежуточно использовался локальный
> путь `file:///.../plugins/maestro-bootstrap/index.js`. Причина: относительный
> `./plugins/maestro-bootstrap/index.js` в `.opencode/opencode.json` резолвится
> **относительно `.opencode/`** (а не корня проекта) → `.opencode/plugins/...`, которого
> нет → silent fail (`.maestro/logs/` не создаётся; подтверждено через `opencode debug
> config`, `plugin_origins.source` = `.opencode/opencode.json`). Локальный путь рабочий,
> но по решению пользователя финализирован git-источник `wad-jet/maestro` (штатный способ
> установки плагина). Локальный `file://` путь — запасной вариант для разработки плагина
> с подхватом правок.

## Задача 3. Целевые артефакты проекта

### 3a. `docs/project-context.md` — 14 категорий про этот репозиторий

Авторить по схеме `skills/maestro-init/init-context.md`. Обязательные секции:
1 (название/назначение), 2 (цели), 3 (стек), 4 (архитектура), 9 (критерии качества),
14 (Commands). Остальное по-минимуму.

- §1: `maestro` — система/скилл OpenCode для оркестрации фич/багфиксов (authoring-репо).
- §2: цели — корректная оркестрация, безопасность (SECURITY.md P1–P5), self-hosted.
- §3: стек — ESM Node.js plugin, OpenCode API, markdown skill-спеки, git/agpack.
- §4: архитектура — skills/, agents/, commands/, plugins/maestro-bootstrap/, SECURITY.md,
  manual_docs/, specs/. **Сосуществование путей spec/plan:** пайплайн maestro пишет в
  `docs/superpowers/specs/` (дефолт, `SKILL.md:264`), а авторские design-доки этого
  репо лежат в `specs/` (корень, правило AGENTS.md). Оба пути сосуществуют: пайплайн
  использует `docs/superpowers/{specs,plans}/`, ручные авторские доки — `specs/`.
  Зафиксировать это в §4, чтобы оркестратор не путал назначение путей.
- §9: критерии — `node --test plugins/maestro-bootstrap/index.test.js` (171 тест),
  manual_docs-синхронизация (AGENTS.md), specs/ для design-доков.
- §14 Commands:
  - `TEST_COMMAND`: `node --test plugins/maestro-bootstrap/index.test.js`
  - `BUILD_COMMAND`: `auto`
  - `E2E_COMMAND`: `./maestro-sandbox.sh` (QA-чеклист)
  - `LINT_COMMAND`: `none` (нет линтера)
  - `DOCS_COVERAGE_COMMAND` / `OBSERVABILITY_COVERAGE_COMMAND`: `none`

> Примечание: репозиторий уже имеет `docs/` (manual_docs, testing, specs, superpowers).
> `docs/project-context.md` — новый файл, не конфликтует.

### 3b. `maestro.json` — по канонам `maestro-assistant`

По inline-канону (`skills/maestro-assistant/SKILL.md` L47-69), адаптировать
`access_policy` под структуру репо:

```json
{
  "trust": { "custodian": true, "sanitizer": true },
  "access_policy": {
    "version": 1,
    "default": "ask",
    "allow": ["src/**", "test/**", "packages/**", "plugins/**", "skills/**", "agents/**", "commands/**", "specs/**", "*.{ts,js,py,go,rs}"],
    "ask": ["docs/**", "*.{md,mdx}", "*.config.*"],
    "deny": ["*.env", "*.env.*", "*.{pem,key,cert,secret}"]
  },
  "confidential": {
    "version": 1,
    "paths": ["docs/confidential/**"],
    "trusted": { "read": "allow", "write": "deny", "edit": "deny" }
  },
  "sanitizer_whitelist": {
    "rules": { "env_secret": true, "data_field": true, "env_file": true, "db_credential": true, "ledger_entry": true, "private_key": true, "auth_header": true },
    "by_agent": { "code-reviewer": [] },
    "patterns": [],
    "extra_fields": [],
    "extra_uri_schemes": []
  }
}
```

> **Обоснование `access_policy`:** управляет **только `read`** сабагентами (allow/ask/deny;
> deny > ask > allow > default; покрывает только `read`, не write/edit — README L14-16, L89,
> L98-99). `allow` для `plugins/** skills/** agents/** commands/** specs/**` — это «исходники»
> этого репо (аналог `src/**`); untrusted-сабагенты (haiku/sonnet) читают их постоянно при
> разработке. `ask` только для `docs/**` (manual_docs, project-context, testing) — реже
> читаются, безопаснее спросить. `manual_docs/**` отдельно не указываем — дублируется
> `docs/**`. Секреты — `deny`.
>
> **Запись/правка** (в т.ч. промптов агентов/скиллов untrusted-сабагентами) `access_policy`
> **не покрывает** — это нативные permissions OpenCode + frontmatter агентов (`permission.edit:
> allow`). Для dogfooding осознанно **не добавляем** HITL-гейт на запись (см. «Вне объёма»).

### 3c. `.gitignore` — добавить `.maestro/`

Идемпотентно добавить строку `.maestro/` (сейчас отсутствует — gap против AGENTS.md).
`.opencode/` уже есть.

### 3d. `regression/` — структура реестра рисков

```
regression/entries/.gitkeep
regression/released/.gitkeep
regression/cancelled-features.md   (заголовок)
```

### 3e. Каталоги

- `.maestro/` — создаётся плагином автоматически при логировании; вручную не обязательно,
  но `mkdir -p .maestro` для `last-run.md` корректен (gitignored).
- `docs/confidential/` — создаётся каталог (пустой) под `confidential.paths`.
- `docs/superpowers/specs/` и `docs/superpowers/plans/` — **создать** (в этом репо
  `docs/superpowers/` отсутствует). Это каталоги, куда пайплайн maestro пишет
  spec/plan (`docs/superpowers/specs/YYYY-MM-DD-<feature>-design.md`). Они сосуществуют
  с `specs/` (корень, авторские доки по AGENTS.md). Добавить `.gitkeep` для отслеживания.

> **Уточнение (реализация):** в исходном плане ошибочно предполагалось, что
> `docs/superpowers/` уже существует. Фактически в этом репо его нет (проверено:
> `docs/` содержит только `testing/`; design-доки лежат в `specs/`). Поэтому каталоги
> создаются заново.

## Задача 4. Проверка (верификация)

1. `.opencode/` содержит все скиллы/агентов/команды maestro + superpowers.
2. `.opencode/opencode.json` валиден (JSON), плагин-путь существует:
   `./plugins/maestro-bootstrap/index.js` резолвится от корня.
3. `node --test plugins/maestro-bootstrap/index.test.js` — 171/171 зелёные (регрессии нет).
4. `docs/project-context.md` — все 6 обязательных секций присутствуют.
5. `maestro.json` парсится плагином (правила `loadMaestroConfig`/`loadWhitelist`/
   `loadAccessPolicy`/`loadConfidentialConfig`) — на старте без ошибок.
6. `/maestro-version` (после перезапуска opencode) — отображает версию плагина.
7. (после перезапуска) `/test-agents` — все 7 сабагентов диспатчатся OK.

## Задача 5. Коммит

Закоммитить (только коммитируемые артефакты, не `.opencode/`/`.maestro/`):
- `agpack.yml` (манифест, 6 скиллов)
- `maestro-init/agpack.yml` (канон-фикс, Задача 1b)
- `manual_docs/how-to/install-maestro.md` (канон-фикс, Задача 1b)
- `docs/project-context.md`
- `maestro.json`
- `.gitignore` (строка `.maestro/`)
- `regression/**` (entries/.gitkeep, released/.gitkeep, cancelled-features.md)
- `specs/install-maestro-self-plan.md` (этот план)

Сообщение в стиле репо (русское, `feat(infra)`/`chore`):
`chore(infra): install maestro into own repo (dogfooding) — project-context, maestro.json, agpack manifest (6 skills), regression, .gitignore, canonical agpack fix`.

> Примечание: канон-фикс (Задача 1b) логически относится к продукту maestro
> (`docs(skills)`/`fix(install)`), но в рамках этого догфуд-коммита допускается включить
> в единый коммит инфраструктуры. При желании — вынести отдельным коммитом.

## Вне объёма (отложено)

- Запуск `/maestro-init` интерактивно в этой сессии (артефакты авторим напрямую;
  `/maestro-init` остаётся доступным для будущих сессий).
- `/maestro-design` scaffold/roadmap — отдельный шаг после успешной установки.
- Переход с agpack-from-git на локальный источник/symlink для живого развития — опционально позже.
- **HITL-гейт на запись** в `skills/**`/`agents/**`/`commands/**` для untrusted-сабагентов
  (permission-правила в `.opencode/opencode.json`) — осознанно НЕ добавляем: цель
  dogfooding — maestro свободно правит себя. При необходимости — отдельный шаг (через
  `permission` в opencode.json, не `access_policy`).
- Коммит не делается без явного запроса (по правилам); задача 5 — по запросу пользователя.
