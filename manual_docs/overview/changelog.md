# Журнал изменений

[Назад к оглавлению](../index.md)

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.0.0/).

> Хронология составлена по истории authoring-репо `maestro-agent`. Даты
> приблизительные (по коммитам).

## [2026-08-27]

### Изменено
- **Рефакторинг: сабагент `design` → `custodian`.** Прежний trusted-сабагент
  `design` (писал spec) перепрофилирован в trusted **Q/A-брокера по
  confidential** `custodian`: отвечает primary только **агрегатами** (без
  значений), `permission` — `edit: deny`. Spec теперь пишет **primary** через
  superpowers:brainstorming, опираясь на Q/A от `custodian`. Имя команд/скиллов
  `/maestro-design` и `skills/maestro-design`, а также соглашение об имени
  spec-файла `YYYY-MM-DD-<project>-design.md` **не меняются**.
- **Цикл Revise через `opus` + оркестратор**: при `Revise` на spec-гейте
  переработка spec выполняется primary совместно с ревью `opus`-агента и
  оркестратора (без trusted-райтера).
- **Маршрут Spike (3-й в шаге 1)**: feasibility/исследование — **без**
  spec/plan/merge; throwaway-код для проверки подхода; ветка не мержится,
  результат — вывод, а не артефакт.
- **Built-in confidential (OQ-3)**: помимо `confidential.paths`, плагин
  закрывает по умолчанию `.env`, `.env.*`, `*.pem`, `*.key`, `*.crt`, `*.p12`,
  `*.pfx` — deny для `read`/`write`/`edit` для primary и non-trusted независимо
  от конфига; `confidential.paths` расширяет, а не заменяет built-in.

## [2026-08-25]

### Добавлено
- **Скрипт `maestro-init.sh`** — простая установка maestro в новый/существующий
  проект: проверяет предусловия (git, python3 ≥ 3.11), устанавливает `agpack`,
  создаёт `agpack.yml`, запускает `agpack sync`, подключает плагин
  `maestro-bootstrap` (в `.opencode/opencode.json` или `--global`) и выдаёт
  инструкцию для `/maestro-init`. Содержимое `agpack.yml` встроено в скрипт
  (самодостаточен); коммиченный `maestro-init/agpack.yml` — справочная копия.
- **Быстрый старт в README** через `maestro-init.sh` (curl + bash) как простой
  альтернативный способ установки + блок «Способ 0» в
  `manual_docs/how-to/install-maestro.md`.

## [2026-08-24]

### Добавлено
- **How-to-документ «Обновление maestro»** (`manual_docs/how-to/update-maestro.md`):
  доставка новой версии скиллов и плагина, контроль версии через `/maestro-version`.
  Зафиксировано правило: версия скилов и плагина — единая (корневой `package.json`).
- **Смена `.gitignore` для `.maestro/`**: вместо конкретных путей (sdd/, last-run,
  logs/, feedback-reports/, plugin-version) — весь каталог `.maestro/` в `.gitignore`.
  Конфиг проекта — `maestro.json` в корне.

## [2026-08-21]

### Добавлено
- **Отдельный аудит-лог** `.maestro/logs/maestro-audit-<дата>.log`:
  security-фактура доступа к confidential (`confidential.access`, allow/deny с
  именем trusted-агента) и блокировок `access_policy` (`access_policy.blocked`).
  В записи — только `basename` пути (SEC-5), без содержимого confidential-данных.
- **Без дублирования логов**: security-события пишутся **только** в аудит-лог;
  `confidential.blocked` удалён, `access_policy.blocked` больше не пишется в
  bootstrap-лог (тот — чисто observability).
- **Аудит-лог всегда активен**: не подчиняется `MAESTRO_BOOTSTRAP_LOG_MASK`/
  `LOG_LEVEL`. Каталог — `MAESTRO_AUDIT_LOG_DIR`. Сбой записи аудита логируется
  в `console.error`.
- **Имя trusted-агента** резолвится из сообщений сессии (`resolveIsTrustedSubagent`
  возвращает `{ trusted, agent }`) и фиксируется в аудит-записи.
- **Документация формата/структуры записей** всех логов (bootstrap + audit) — в
  `manual_docs/reference/config.md` («Логи плагина»).

## [2026-08-19]

### Изменено
- **Разделение `/maestro-init` и `/maestro-design`**: `/maestro-init` — только
  setup (контекст, конфиг `maestro.json`/`opencode.json`/`.gitignore`, каталоги,
  проверки superpowers и плагина). Дизайн, scaffold и roadmap вынесены в новую
  команду `/maestro-design` (скилл `maestro-design`).
- **Конфигурация maestro генерируется `/maestro-init`**: `maestro.json`
  (trust/access_policy/sanitizer_whitelist), `opencode.json` (plugin + модели
  агентов M1), `.gitignore` (конкретные пути), `regression/` структура.
- **Модели агентов (M1)**: 7 отдельных HITL-вопросов; оси Tier и Trust
  ортогональны; `design` и `sanitizer` — trusted, но разные модели. Доступные
  модели — D2 (из `provider.models` по всем уровням конфигурации).
- **Fix `.gitignore` (C2/M3)**: конкретные пути (`.maestro/sdd/`,
  `.maestro/last-run.md`, `.maestro/logs/`) вместо всего `.maestro/`;
  конкретизация gitignore-указаний в `.maestro/logs` из `.maestro/`
  `.maestro/` — в `AGENTS.md` и `plugins/maestro-bootstrap/README.md`.
- **Утечка данных (security-хардненинг)**: sanitizer маскирует однословные
  секрет-keyword (`TOKEN=`/`KEY=`/`SECRET=`/`AUTH=`/`CREDENTIAL=`), colon/JSON-
  секреты, URI с анонимным user, http(s)/standalone-JWT; санитизация `title`
  субагента в логах учитывает конфигурацию sanitizer (extra_fields и др.);
  `access_policy.blocked` логирует только basename; `.maestro/feedback-reports/`
  в gitignore.
- **Pipeline (SKILL.md)**: шаг 15 — условный пропуск `$TEST_COMMAND` больше не
  зависит от шага 16 (решение на шаге 15); «skip → D1» на шаге 2 — только для
  bugfix (feature → шаг 5); шаг 8.5 явно выполняется на fast-track; secret-scan
  в чек-лист implementer + scope ревью шага 16 + pre-PR grep (шаг 17);
  `security_review → sanitizer` добавлен в `step_to_tier`; spec/plan/diff под
  `ask` для untrusted + Level-1 проверка содержимого spec перед `CLEAN`.
- **Плагин**: убран `config.file_access:"allow"` (нативные permissions OpenCode
  сохраняются); предупреждения при whitelist-`patterns`, похожих на секреты
  (SEC-6), и при полном off правил Level-1 для untrusted (SEC-7).
- **Переименование скиллов**: `init` → `maestro-init`, `design` → `maestro-design`
  (одноимённо с командами); обновлены команды, AGENTS.md, manual_docs, specs.

### Добавлено
- **Гайд «Настройка проекта для maestro»** (`tutorials/setup-project.md`) —
  пошаговая подготовка проекта через `/maestro-init` и `/maestro-design`
  (новый и существующий проект) + настройка моделей по тирам (механика и пример).
- **Команда `@maestro-feedback-report`** — сбор фактуры по процессам maestro в
  текущей сессии для ретроспективы (хорошо/плохо/проблемы). Отчёт в
  `.maestro/feedback-reports/report-<Session ID>-<YYYY-MM-DD>.md`; основной
  источник — диалог сессии, дополняется логами плагина при наличии.

## [2026-08-18]

### Изменено
- Скилл `maestro`: применены уроки ретроспективы feature-pipeline:
  - чек-лист отчёта имплементера (`TEST_OUTPUT` в `implementer-prompt.md`);
  - правило «build перед тестами» при тестах против артефактов сборки;
  - фиксация отклонений от плана в момент выявления (шаг 13d);
  - запрет `git stash` в manual-проверках оркестратора;
  - учёт всех моделей контура при подсчёте LLM-вызовов в псевдокоде тестов;
  - проверка `git status`/`git diff` при пустом отчёте субагента до редиспатча.
- Добавлена пользовательская документация `manual_docs/` по использованию скилла.

## [Unreleased]

### Добавлено
- **Команда и скилл `/maestro-assistant`**: консультации и настройка maestro-конфигурации
  (`maestro.json`, `opencode.json`), структуры каталогов и `project-context.md` в течение жизни
  проекта. Общий источник правил конфигурации (self-contained канон в `skills/maestro-assistant/SKILL.md`),
  доступный init (задачи 2/3/3а), maestro (по ходу pipeline) и HITL-консультациям. Плагин-гейт
  не требуется; доступ к `docs/confidential/**` закрыт (primary deny); правка `confidential.paths`
  — жёсткий контроль (снятие с защиты — блок по умолчанию, merge — консервативное дополнение).
  После правки `maestro.json` — уведомление о необходимости перезапуска opencode (изменения
  вступают в силу при старте плагина).
- **Защищённая папка `docs/confidential`**: секция `confidential` в `maestro.json`
  закрывает конфиденциальные пути (дефолт `docs/confidential/**`) для
  `read`/`write`/`edit` от всех, кроме trusted-субагентов. Primary/untrusted —
  жёсткий deny; trusted читает (по умолчанию), пишет только по явному
  `trusted.write`/`trusted.edit: allow`. Плагин определяет отправителя через
  `client.session.get` + `session.messages` (детект по `parentID` и имени агента).
  `/maestro-init` создаёт `docs/confidential/` и секцию `confidential`.
  Ограничение: `bash`/`glob`/`grep` не покрываются — рекомендован 2-й эшелон
  через native permissions OpenCode (`permission.bash`); при отключённом плагине
  защита не действует (fail-open).
- **Жёсткий гейт «плагин maestro-bootstrap работает»**: `@maestro`,
  `@maestro-design`, `@maestro-feedback-report` в maestro-проекте (`maestro.json`
  есть) при старте проверяют наличие `maestro-bootstrap` в `opencode.json` →
  `plugin` И свежую запись `plugin initialized` в логе плагина; при невыполнении —
  жёсткий STOP без «продолжить» (защита `docs/confidential/**` не действует при
  отключённом плагине). `@maestro-init` и `@regression` не гейтятся.
- **`@maestro-feedback-report`: пользовательский фидбек**: выделена логика
  генерации отчёта в скилл `skills/maestro-feedback-report/SKILL.md`
  (переиспользование в сабэджентах без HITL). Команда `@maestro-feedback-report`
  добавляет HITL-гейт запроса комментариев от пользователя — текст записывается
  в секцию `## Пользовательский фидбек` отчёта (Enter без ввода = пропуск).

### Изменено
- **Поддержка пользовательской документации в pipeline (шаг 14)**: шаг 14
  `manual-docs` стал обязательным для всех категорий фич. Оркестратор загружает
  скилл `manual-docs` через skill-инструмент (подпись `[skill]`, не субагент),
  выполняет diff-сверку кода с `manual_docs/`; HITL поднимается только при
  расхождении. Coverage-гейт (`DOCS_COVERAGE_COMMAND`) остаётся на шаге 15
  (без дублирования); если команда не задана — diff-сверка как fallback.
- **Скилл `manual-docs` сделан стек-агностичным**: убрана NestJS-специфика
  (`@Get/@Post`, `src/<module>/`, `Saga`/`ETL`) и API-центричный пример
  `api-endpoints.md` (заменён нейтральным `reference/configuration.md`).
  NestJS-детали — только как пример опционального coverage-теста.
- **Снятие требований `.opencode/`-зеркалирования**: скиллы/команды/агенты доставляются
  в целевое приложение штатным механизмом (вручную из удалённого репозитория или через
  `agpack`); отдельное `.opencode/`-зеркалирование не требуется. Обновлены AGENTS.md
  (правило доставки), `skills/manual-docs/SKILL.md` (Правило 5), `skills/maestro/SKILL.md`,
  `manual_docs/` (customize-maestro, what-is-maestro, quick-start, commands).
- **Haiku bash-скрипты:** в `agents/haiku.md` добавлена директива использовать bash для git, grep, запуск тестов/сборки; запрет деструктивных команд (git push, git reset --hard, mass-delete) без явного указания в spec/плане. `describe` обновлён. `manual_docs/` синхронизирован (model-selection, agents-and-trust).
- **Уход от агента `maestro`**: primary-агент удалён. Вход — команда `@maestro`
  в любой primary-сессии. `@regression`/`@maestro-init` больше не привязаны к
  агенту. Плагин `maestro-bootstrap` — глобальная observability (инжекция
  директивы и агент-фильтр удалены). `@test-maestro` удалён.
- **HITL-гейт шага 2 переформулирован**: «запустить pre-flight диагностику?»
  → «подтверждение старта (pre-flight)». Вопрос подтверждает продолжение/отмену
  работы, а не разрешение на диагностику (read-only); в текст добавлено
  пояснение, почему вопрос возник (последняя точка отмены до ветки, запуск
  baseline-тестов) и зачем нужна реакция HITL. Варианты ответов и их семантика
  не изменились (efficient: да/отмена→STOP; interactive: да/skip→D1/отмена).
- **Fast-track: внешний spec для сложных фич (шаг 7d)**: если в
  `docs/superpowers/specs/` есть готовый spec (`YYYY-MM-DD-<feature>-design.md`),
  maestro предлагает (d) использовать его (fast-track) / (e) создать заново.
  Шаг 8 (design) пропускается; шаги 8.6/9/10 становятся условными.
- **Подписи spec-файла**: `<!-- maestro:review -->` / `<!-- maestro:sanitize -->`
  — HTML-комментарии в конце spec, ставятся оркестратором (trusted). Детект
  отревьюенности/санизированности внешнего spec: валидная подпись (hash sha256
  содержимого без `maestro:*` блоков) → гейт пропускается; нет подписи →
  вариант B ((a) пропустить / (b) прогнать). Любая правка spec инвалидирует
  подписи (stale); на Revise 8.6 и 9 перезапускаются автоматически.
  Закрывает жалобу фидбека на повторные подтверждения при уже-отревьюенном spec.
- **Процессные улучшения (фидбек #3–#7):**
  - **#3 Лимит размера задачи (шаг 11):** задача > ~8–10 файлов разбивается
    на подзадачи; guidance, не жёсткий лимит.
  - **#4 Compile-time-ассерты (шаг 15):** если тесты содержат статические
    ассерты (`@ts-expect-error`, `satisfies`, `assert_type`, ...) и раннер не
    выполняет статанализ — проверить, что файлы в scope инструмента
    статанализа; иначе — follow-up, не allow silent pass.
  - **#5 Дублирование spec (шаг 11):** план ссылается на секции spec по имени,
    не переписывает требования дословно.
  - **#6 Cross-cutting scan (шаг 8.5):** при изменении конфиг-схемы/ключей —
    grep по `examples/`, конфигам, докам; найденные файлы — задачи плана.
  - **#7 Умный pre-PR gate (шаги 16–17):** трекинг issues
    (`fixed`/`open`/`follow-up`); gate показывает список открытых issues с
    severity; при отсутствии открытых — (b) помечается «только follow-up».

### Добавлено
- **Security Review** (Этап 1): сабагент `sanitizer` (trusted, read-only) —
  поиск и пометка чувствительных данных в spec/промпте перед диспатчем в
  untrusted сабагенты.
  - Spec security review (шаг 8.6) для фич со spec; перезапуск на каждый Revise-цикл.
  - Проверка диспатча untrusted (шаги 9/13/16) — всегда.
  - HITL-гейт при находке (Трактовка Y): (a) вычистить и продолжить /
    (b) продолжить как есть (принять риск) / (c) стоп.
  - Trusted skip: trusted сабагенты пропускают sanitize и file access control.
  - File access control для untrusted (на Этапе 1 — инструктивно в промпте;
    enforcement — плагин на Этапе 2).
- **Security Review (Этап 2):** реализация в плагине `maestro-bootstrap`:
  - **Уровень 1** — санитайзинг промптов `task` (маскирование env-secrets,
    полей данных, `.env`, DB/SFTP credentials, ledger) по правилам Context
    Sanitizer + whitelist (`sanitizer-whitelist.json`).
  - **File access control** — перехват `read` по `.maestro/access-policy.json`
    (`allow`/`ask`/`deny`; приоритет deny > ask > allow). Файл формирует
    сабагент `sanitizer` или вручную.
  - **Trusted skip** — плагин читает `trust-config.json`, trusted сабагенты
    пропускают sanitize промпта.
- **Ревью Этапа 2 (2026-08-18):** исправлены замечания ревью — access-policy
  покрывает только `read` (bash/glob/grep — нативные permissions), приоритет
  `resolveFileAccess` исправлен (deny > ask > allow), удалён мёртвый код,
  аудит-лог — в общем bootstrap-логе.
- **Расширение покрытия sanitize (2026-08-19):** регулярные выражения
  Уровня 1 закрывают заметно больше кейсов:
  - `data_field` — расширенный список полей (финансовые + PII + бизнес),
    суффиксы (`amountValue`, `amount_value`), camelCase-варианты snake-полей
    (`cardNumber`), расширяемость через `extra_fields` в whitelist;
  - `db_credential` — больше URI-схем (`ssh`, `ldap`, `clickhouse`, ...) +
    connection-string params (`password=...`, `pwd=...`), расширяемость через
    `extra_uri_schemes`;
  - `env_secret` — case-insensitive (`apiKey`, `api_key`) + keywords
    (`DSN`, `CERT`, `SALT`, `SIGNATURE`, `NONCE`);
  - новые правила `private_key` (PEM-блоки) и `auth_header`
    (`Authorization: Bearer ...`, `X-API-Key: ...`);
  - `ledger_entry` — маркер (покрывается `data_field`, дублирование убрано);
  - детект регистронезависим по всем правилам (`Amount`, `POSTGRES://`,
    `-----BEGIN rsa private key-----`);
  - документированы ограничения regex-детекта (multi-line, camelCase-префиксы;
    остальное ловит Ур.2-сабагент).
- **Команда `@test-sanitizer`:** проверка доступности сабагента `sanitizer` +
  `agent.sanitizer` из `opencode.json` и trusted-статуса в `trust-config.json`
  (по аналогии с `@test-code-reviewer`, плюс trusted-проверка).
- **Сабагент `design` (spec formation, шаг 8):** новый trusted-сабагент,
  формирующий спецификацию (brainstorming → spec) вместо оркестратора.
  - `design` — trusted по умолчанию (в `trust-config.json`), видит полный
    контекст (user story + project context) для качественного spec.
  - Промпт `design-prompt.md` — self-contained, brainstorming workflow embedded
    (сабагент НЕ загружает скиллы).
  - `permission`: `edit: allow` (пишет spec файл), `bash: deny`, `task: deny`.
  - Шаг 8: оркестратор диспатчит `design` с user story + context + spec_path;
    `design` возвращает summary + открытые вопросы (HITL → re-dispatch, max 3).
  - Spec Review (шаг 9) остаётся за `opus` (untrusted, независимый) — исключает
    self-review. Trust-уровни: `design` (trusted) ≠ `opus` (untrusted).
  - Команда `@test-design` — проверка `agent.design` + trusted-статуса.
- **Консолидация конфигов в `maestro.json`:** три отдельных файла
  (`trust-config.json`, `.maestro/access-policy.json`,
  `.maestro/sanitizer-whitelist.json`) объединены в один `maestro.json` в корне
  проекта (секции `trust`, `access_policy`, `sanitizer_whitelist`). Файл
  коммитится в git; `.maestro/` — только эфемерные файлы (логи, sdd/, last-run).
  Старые файлы **не поддерживаются** (backward compat удалён).
  - Новый `loadMaestroConfig()` в плагине — единственный загрузчик; секции
    извлекаются из него (`loadTrustConfig`/`loadWhitelist`/`loadAccessPolicy`
    принимают распарсенный config).
  - Env `MAESTRO_CONFIG` — путь к `maestro.json` (override). Убраны
    `MAESTRO_SANITIZER_WHITELIST`, `MAESTRO_ACCESS_POLICY` и standalone-примеры
    `access-policy.example.json`/`sanitizer-whitelist.example.json`.
  - Пример: `plugins/maestro-bootstrap/examples/maestro.example.json`.
  - 63/63 теста (переработаны под секции `maestro.json`).
- **Проверка скилов superpowers в `/maestro-init`:** новый pre-flight шаг 4 —
  runtime-пробник через `skill` tool (bogus-name → список доступных скилов).
  Если все 7 REQUIRED SUB-SKILLS (`writing-plans`, `subagent-driven-development`,
  `test-driven-development`, `using-git-worktrees`, `requesting-code-review`,
  `finishing-a-development-branch`, `systematic-debugging`) не найдены —
  HITL-предложение установки (`opencode plugin ...`, глобально или в проект).
  При отказе — init продолжается с предупреждением (fail-open).
- **AGENTS.md:** правило синхронизации `manual_docs/` при изменениях скилла.

## [2026-08-03]

### Изменено
- Переименование агента `feature-agent` → `maestro` (обновляются ключи
  `opencode.json`, пути плагина, зеркала `.opencode/`, записи `.gitignore`).

## [2026-08-17]

### Добавлено
- Anti-loop guard для диспатча субагентов (пустые/ошибочные результаты).

## [Ранее]

### Добавлено
- Команда `/maestro-init` и скилл `maestro-init` (bootstrap новых проектов).
- Соглашение об именовании веток (`feature/`, `fix/`, `hotfix/`).
- Плагин `maestro-bootstrap` (ESM, встраивание bootstrap-директивы).
- Настройки уровня лога плагина (`MAESTRO_BOOTSTRAP_LOG_LEVEL`,
  `MAESTRO_BOOTSTRAP_LOG_MASK`).

---

## 🔗 Связанные разделы

- [Что такое maestro](what-is-maestro.md)
- [Поддержание документации в актуальном состоянии](../how-to/keep-docs-up-to-date.md)