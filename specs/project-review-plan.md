# План: разбор находок полного ревью проекта maestro-agent

> Статус: **зафиксирован (review), исправления не начаты**.
> Дата: 2026-08-19. Репо: `maestro-agent` (authoring).
> Метод: полное ревью скилла (SKILL.md), скиллов init/design + команд, плагина
> maestro-bootstrap, документации manual_docs + AGENTS.md + specs.
>
> **Дополнено (2026-08-19):** отдельный security-фокус — утечка чувствительных
> данных (часть 1А ниже). Результат: найден **1 CRITICAL** (sanitizer пропускает
> однословные секрет-keyword и JSON/colon-форматы) и несколько HIGH (промпт vs
> файл-артефакт, нет guard против коммита секретов, логирование title субагента,
> feedback-reports вне gitignore).

## Сводка

| Область | CRITICAL | HIGH | MEDIUM | LOW |
|---------|----------|------|--------|-----|
| Скилл maestro (SKILL.md) | 0 | 2 | 5 | 5 |
| init/design + команды | 0 | 1 | 6 | 6 |
| Плагин maestro-bootstrap | 0 | 0 | 2 | 7 |
| Документация + AGENTS.md + specs | 0 | 1 | 4 | 2 |
| Security (часть 1А, утечка данных) | **1** | 4 | 4 | 3 |
| **Итого** | **1** | **8** | **21** | **23** |

**Крит замечаний: 1 (SEC-1 — sanitizer пропускает однословные секрет-keyword).**
Прочее — 8 HIGH + 21 MEDIUM + 23 LOW (в основном док-расхождения, устаревшие
ссылки и устаревшие статусы specs; security-находки выделены в части 1А).

---

## ЧАСТЬ 1. Находки

### Скилл maestro (SKILL.md)

#### HIGH
- **H1.** `skills/maestro/SKILL.md:446-447` — шаг 15 (final checks) условно
  зависит от результата шага 16 (requesting-code-review), который выполняется
  ПОЗЖЕ. Условие «если шаг 16 не выявил critical issues» не вычислимо на шаге 15.
  **Fix:** оценивать скип после шага 16, или убрать прямую ссылку.
- **H2.** `skills/maestro/SKILL.md:176,609-611,1197` — шаг 2 (interactive) опция
  «skip → D1» переводит feature-маршрут в bugfix debug sub-pipeline (D1 =
  systematic-debugging). Для feature это бессмысленно. **Fix:** квалифицировать
  «skip → D1» как bugfix-only, либо задать target для feature (шаги 5-6).

#### MEDIUM
- **M1.** `SKILL.md:734-735` vs `agents/code-reviewer.md:4` — «Все под-агенты
  hidden:true» противоречит code-reviewer hidden:false (и model-selection.md:51).
- **M2.** `SKILL.md:703-711` vs `manual_docs/reference/model-selection.md:31` —
  в `step_to_tier` нет строки `security_review → sanitizer` (есть в manual_docs).
- **M3.** `SKILL.md:1341` — «cleanup по строке 348» указывает на строку про
  regression-entry (12a), а не на cleanup ветки/worktree (реально на строке 1204).
- **M4.** `SKILL.md:302` vs `:324-330` — fast-track (7d) пропускает шаг 8.5, но
  план (шаг 11) зависит от 8.5 (context/cross-cutting). Не ясно, выполняется ли
  8.5 на fast-track.
- **M5.** `SKILL.md:1197` — строка «Обработка сбоев» озаглавлена «отмена старта»,
  но описывает (b) «skip → D1» (не отмену).

#### LOW
- **L1.** `SKILL.md:200-205` vs `:1200` — «внешний spec невалидный» не выведен в
  гейт шага 7 (есть только в таблице сбоев).
- **L2.** `SKILL.md:813-819` — «OpenCode Dispatch Override» неполный (нет
  spec_formation→design, explain→fable, security_review→sanitizer).
- **L3.** `plugins/maestro-bootstrap/examples/maestro.example.json:31-47` —
  `sanitizer_whitelist.rules`/`by_agent` не описаны в разделе Context Sanitizer
  (`SKILL.md:906-990`).
- **L4.** `SKILL.md:503` — список gates опускает шаги 0, 1.5, 8.6.
- **L5.** `SKILL.md:348` — ref на «строку 348» хрупок (line-number дрейф).

### init/design + команды

#### HIGH
- **H3.** `specs/init-idempotency-plan.md:49-54,227-229` — post-config flow всё ещё
  описывает «(a)+(b)+(c)» (design/scaffold/roadmap) как часть `/maestro-init`,
  хотя они вынесены в `/maestro-design`. План написан до сплита, не обновлён.

#### MEDIUM
- **M6.** `skills/maestro-init/init-context.md:43` — «шаг (a) `/maestro-init`» устарел →
  должен быть `/maestro-design`.
- **M7.** `specs/init-idempotency-plan.md:42,48` — нумерация «Шаг 1/1.5/(a)» не
  совпадает с SKILL.md («Задача 2/3/3а»).
- **M8.** `specs/init-idempotency-plan.md:3` vs `:327` — противоречивый статус
  («частично выполнена» vs «реализация ещё не начата»).
- **M9.** `specs/init-idempotency-plan.md:190` — тесты «59/59» устарели (актуально
  63/63).
- **M10.** `commands/maestro-feedback-report.md:49,91-92` + `init-idempotency-plan.md:31` —
  `.maestro/feedback-reports/` не покрыт specific-paths `.gitignore` (в gitignore
  только sdd/, last-run.md, maestro-bootstrap-*.log), но заявлен «эфемерным».
- **M11.** `specs/init-idempotency-plan.md:84` — trust отнесён только к §12, хотя
  фактически из §3/§5/§12 (минорная неточность атрибуции).

#### LOW
- L6. `init-context.md:159-163` — M1 в init-context thin (делегирует в SKILL.md) —
  приемлемо, отметить.
- L7. `maestro-init/SKILL.md:16-18`, `commands/maestro-init.md:7` — корректно исключают
  design/scaffold/roadmap (проверено, согласовано).

### Плагин maestro-bootstrap

#### MEDIUM
- **M12.** `plugins/maestro-bootstrap/index.js:31` — `config: () => ({ file_access: "allow" })`
  безусловно форсит file_access:allow на уровне opencode, что противоречит README
  (native permissions для bash/glob/grep) и подрывает fail-open posture.
  **Fix:** убрать/ограничить override, задокументировать в README.
- **M13.** README не упоминает config-хук `file_access:"allow"` (см. M12) —
  единственное существенное расхождение README/кода.

#### LOW
- L8. `core.js:102-105` — false positive «monkey=value» → redacted (i-флаг +
  substring KEY). Шире, чем задокументировано.
- L9. `core.js:88-91` — `amountless` → redacted (документированный tradeoff).
- L10. `core.js:146` — AUTH_HEADER `[^\s,;]+` — частичный JWT остаётся незамаскирован.
- L11. `core.js:381` — `"default":"deny"` молча коэрсится в `ask` (loadAccessPolicy).
- L12. `core.js:546` — источник filePath для read: `output?.args` — надо проверить
  реальный контракт opencode hook (не верифицирован).
- L13. `index.js:19-28` — singleton `_mbHooks`; при ошибке инициализации — silent
  no-op на весь процесс (нет retry).
- L14. `index.js` adapter (default export, config-хук, startup, error-swallow) —
  **0 прямых тестов** (тестируются только core.js exports); `ledger_entry` no-op
  тоже не протестирован.

#### ОК (подтверждено)
- 63/63 тестов проходят (заявленное число верно).
- Sanitizer: нет двойного счёта (последовательные replace), whitelist-protection
  корректна.
- Access policy: приоритет deny>ask>allow>default верен; fail-open при отсутствии
  секции — по README.
- Logging: mask ∩ threshold корректно, invalid level → fallback debug.
- Trust/config: строго `value === true`; старые конфиги не читаются (по README).

### Документация + AGENTS.md + specs

#### HIGH
- **H4.** `AGENTS.md:43` — устаревшее утверждение про инжекцию директивы
  `FMAESTRO_BOOTSTRAP_V1` через `experimental.chat.messages.transform` (удалена
  2026-08-18; тест проверяет `transform === undefined`). **Fix:** заменить на
  текущее «глобальная observability».
- **H4a.** `AGENTS.md:45` — «scoped to maestro sessions» устарело (плагин глобальный,
  не привязан к агенту) — часть H4.

#### MEDIUM
- **M14.** `AGENTS.md:18` — «No git repo here. Git commands fail here» — неточно:
  это git-репозиторий (git log работает). **Fix:** уточнить gotcha.
- **M15.** `specs/maestro-init-tasks-plan.md:3` — статус «зафиксирован (design),
  реализация не начата» — устарел (реализовано).
- **M16.** `specs/init-idempotency-plan.md:11` — «Осталось: шаг 1.5...» — устарело
  (шаг 1.5 реализован как «Задача 3»).
- **M17.** `specs/init-idempotency-plan.md:327` — «Реализация ещё не начата» —
  устарело.

#### LOW
- L15. `AGENTS.md:44` — default `MAESTRO_BOOTSTRAP_LOG_LEVEL` = `debug`, фактически
  `info` (core.js:424, README:187).
- L16. `README.md:54` — «запись `.maestro/` в `.gitignore`» (всю папку) — устарело,
  теперь specific paths.

#### ОК (подтверждено)
- Все ссылки в manual_docs резолвятся (0 битых ссылок).
- Все команды в commands.md существуют; агенты согласованы с model-selection.md.
- setup-project.md точно описывает init/design/@maestro.

---

## ЧАСТЬ 1А. Security-ревью: утечка чувствительных данных

> Метод: live-тесты sanitize() на реальных форматах секретов + ревью плагин-логов,
> промптов (design/implementer/spec-review), trust-модели, config (.gitignore,
> feedback-report). Все подсчёты подтверждены live-прогоном.

### Сводка (security)

| Severity | Кол-во | Кратко |
|----------|--------|--------|
| **CRITICAL** | 1 | sanitizer пропускает однословные секрет-keyword и colon/JSON-форматы |
| **HIGH** | 4 | промпт vs файл-артефакт; нет guard против коммита секретов; title субагента в лог; feedback-reports вне gitignore |
| **MEDIUM** | 4 | access_policy.blocked логирует путь; whitelist-patterns footgun; disable правил; TEST_OUTPUT радиодиff |
| **LOW** | 3 | errorMessage/message; probe-сниппеты; терминальные echo |

### CRITICAL

**SEC-1. Sanitizer пропускает однословные секрет-keyword (regex-баг) и common-форматы токенов**
`plugins/maestro-bootstrap/core.js:100-105` — live-подтверждено:
- **LEAK:** `TOKEN=abc`, `KEY=abc`, `SECRET=abc`, `AUTH=abc`, `CREDENTIAL=abc` —
  когда секрет-keyword начинается с начала имени переменной.
- **MASK:** `API_KEY=`, `DB_PASSWORD=`, `ACCESS_TOKEN=`, `JWT_SECRET=`, `PASSWORD=`.
- **Причина:** `ENV_ASSIGN` = `\b[A-Z][A-Z0-9_]*(?:KEYWORD)[A-Z0-9_]*\s*=` — ведущий
  `[A-Z][A-Z0-9_]*` жадный; при keyword-в-префиксе потребляет его начало → alternation
  не совпадает. Воспроизводится на `TOKEN/KEY/SECRET/AUTH/CREDENTIAL` (но не на
  `PASSWORD` — длина/оверлепп разные). Это прямое имя множества реальных секретов.
- **Mitigation:** исправить regex — поставить `\b` прямо перед группой keyword
  (`(?:\b(?:TOKEN|KEY|...))`) или сделать префикс нежадным/атомарным, +
  добавить unit-тесты на `TOKEN=`, `KEY=`, `SECRET=`, `AUTH=`, `CREDENTIAL=`,
  `API_KEY=`, `POSTGRES_PASSWORD=`.

Дополнительно live-подтверждены **форматы-утечки** (не covered):
- `secret:{value}` (brace), `password: value` / `API_KEY: value` (colon, не `=`),
  `{"client_secret": "..."}`, `{"apiKey": ..., "password": ...}` (JSON-ключи без `=`),
  `postgres://:pass@host` (URI с анонимным user — regex требует `user:pass@`),
  `Bearer <jwt>` / `token=<jwt>` вне заголовка, `session=<jwt>`,
  `redis://:mypass@host` (схема с паролем без user), `password is hunter2` (preposition).

### HIGH

**SEC-2. Промпт санитизируется, а файл-артефакт (spec/plan/diff) читается untrusted напрямую через `read`**
`skills/maestro/SKILL.md:280-284` (Точка 2), `core.js:571-575` (санитизация
`output.args.prompt`), `spec-review-prompt.md:16` (`{spec_path}`).
- Шаг 9 диспатчит opus с `{spec_path}` в промпте; Точка 2 санитизирует **промпт**,
  не содержимое файла. opus читает spec-файл через `read` (не промпт), санитизатор
  и file-access-control на него не действуют (`.md`-spec не в deny). Если секрет
  попал в spec (design не замаскировал — мягкое правило design-prompt.md:82), он
  достигает untrusted opus.
- **Mitigation:** санитизировать **файл** перед очисткой-подписью (`verifiable_clean`
  gate): после 8.6 прогнать Level-1 regex по содержимому и требовать 0 находок
  перед `status: CLEAN`; держать spec/plan/diff под `ask` для untrusted (не `allow`).

**SEC-3. Нет guard против коммита секретов (hardcoded keys, fixtures, `.env`)**
`skills/maestro/SKILL.md:477-482,493` (steps 16/18), `implementer-prompt.md:80-92`.
- Пайплайн не запрещает хардкод секрета в код/конфиг, не проверяет pre-merge diff
  на секреты; sanitizer намеренно не маскирует «код и конфиги» (SKILL.md:958);
  фикстуры (implementer-prompt.md:23) — классический вектор секрет-в-репо. Merge идёт
  сразу после поведенческого code-review (шаг 18).
- **Mitigation:** в чек-лист implementer + scope ревью шага 16 добавить secret-scan
  (grep `sk-`, `AKIA`, `BEGIN`, `client_secret`, `token=`/`key=` в diff), 0 находок
  или HITL перед шагом 18; отрицательный grep по `.env*`, `*.pem/key` в коммите.

### MEDIUM

**SEC-4. `access_policy.blocked` логирует полный путь файла**
`core.js:555` — `target` (filePath) в лог. Раскрывает структуру/чувствительные
имена файлов. **Mitigation:** логировать `basename` или нормализованный путь.

**SEC-5. whitelist-`patterns` может исключить реальный секрет из ЛЮБЫХ правил**
`core.js:172,180-185` — `patterns` (ставить в init, чтобы не over-redact) исключает
литеральные значения из всех правил. Оператор может случайно занести реальный
секрет. **Mitigation:** запретить в `patterns` значения, матчащиеся по safety-regex;
логировать предупреждение.

**SEC-6. `rules: {...false}` / `by_agent` снижают Level-1 для untrusted**
`core.js:168-171,283-297` — глобальный disable категорий правил или per-agent
снижает regex-защиту; при `hybrid`-mode Level-2 запускается только если Level-1
что-то нашёл (SKILL.md:1059) → сниженный Level-1 может пропустить Level-2.
**Mitigation:** treat `hybrid` + полностью off-правила как ошибку; предупреждение.

**SEC-7. `TEST_OUTPUT` отчёт реализатора (unredacted) в progress-леджер и re-dispatch**
`implementer-prompt.md:74`; `SKILL.md:398,380-383`. Тестовый stderr (строки
подключений, PII, конфиг-дамп) попадает в `.maestro/sdd/progress.md` и в
последующие untrusted-промпты. **Mitigation:** в отчёте — только pass/fail-count +
класс фейла, не raw stderr; обрезать/редиактить `TEST_OUTPUT`.

### LOW

- **SEC-8.** `session.error`/`session.status.retry` — free-form `errorMessage`/`message`
  без санитизации (`core.js:519,525`). Минимизировать/обернуть.
- **SEC-9.** D3 probe-сниппеты (`SKILL.md:566-575`) могут содержать хардкод-секрет
  в `.probe-changes.md` (gitignored, локально). Redact'ить.
- **SEC-10.** `git log --oneline` / тест-вывод на терминал (шаг 17) — только
  локально, оператор-видимо. Covered правилом коммит-сообщений.

### OK (подтверждено, утечки нет)

- **`sanitizer.redacted`** логирует только `res.count`, не текст (`core.js:578-584`). ✅
- **Env-значения** НЕ логируются — только `logDir/level/mask` (`core.js:499-503`);
  `maestro.json` содержимое и `MAESTRO_CONFIG` путь в лог не попадают. ✅
- **`MAESTRO_BOOTSTRAP_LOG_LEVEL=debug`/широкий mask** не расширяют утечку (нет
  `log.debug`-вызовов с данными; mask гейтится порогом). ✅
- `.maestro/maestro-bootstrap-*.log`, `sdd/`, `last-run.md` — в specific-paths
  `.gitignore`. ✅ (но `feedback-reports/` — НЕ покрыт, см. SEC-3/M10.)

---

## ЧАСТЬ 2. План к разбору (порядок устранения)

### Приоритет 1 — Крит / HIGH (исправления кода/спеки)
1. **H1** — переработать шаг 15/16 в SKILL.md (условие скипа после step 16).
2. **H2** — квалифицировать «skip → D1» в шаге 2 (bugfix-only / feature-target).
3. **H3** — обновить `init-idempotency-plan.md` под сплит (убрать (a)+(b)+(c) из init).
4. **H4/H4a** — исправить `AGENTS.md:43,45` (инжекция удалена, плагин глобальный).

### Приоритет 1S — Security (CRITICAL/HIGH — чинить в первую очередь)
5. **SEC-1 (CRITICAL)** — исправить regex sanitizer: `\b` перед keyword-группой /
   нежадный префикс; + unit-тесты `TOKEN=`/`KEY=`/`SECRET=`/`AUTH=`/`CREDENTIAL=`;
   оценить покрытие colon/JSON/USERless-URI/Bearer-токенов.
6. **SEC-2 (HIGH)** — санитизировать **файл** spec/plan/diff (`verifiable_clean`),
   не только промпт; держать spec/plan/diff под `ask` для untrusted.
7. **SEC-3 (HIGH)** — добавить secret-scan в чек-лист implementer + scope ревью 16
   (grep `sk-`, `AKIA`, `BEGIN`, `client_secret`, `token=`/`key=`) + pre-PR grep.
8. **SEC-4 (HIGH)** — логировать `output.title` субагента через `sanitize()` или
   убрать title из лога.

### Приоритет 2 — MEDIUM (док-расхождения, согласование)
9. **M1** — согласовать `hidden` для code-reviewer в SKILL.md.
10. **M2** — добавить `security_review → sanitizer` в step_to_tier SKILL.md.
11. **M3** — починить ссылку «по строке 348» → на строку 1204 (или убрать line-ref).
12. **M4** — уточнить, выполняется ли 8.5 на fast-track.
13. **M5** — поправить label строки «Обработка сбоев» (отмена vs skip).
14. **M6** — `init-context.md:43` → `/maestro-design`.
15. **M7** — согласовать нумерацию (Шаг vs Задача) в init-idempotency-plan.
16. **M8/M15/M16/M17** — обновить статусы specs (реализовано / актуально).
17. **M9** — тесты 63/63 вместо 59/59.
18. **M10/SEC-4(feedback)** — добавить `.maestro/feedback-reports/` в specific-paths `.gitignore`;
    в feedback-report копировать только агрегаты/количества, не raw-строки логов/диалога.
19. **M11** — поправить атрибуцию trust (§12 vs §3/§5/§12).
20. **M12/M13** — убрать/ограничить `file_access:"allow"` в index.js + задокументировать.
21. **M14** — уточнить gotcha «no git repo» в AGENTS.md.

### Приоритет 2S — Security (MEDIUM)
22. **SEC-5** — `access_policy.blocked` логировать basename пути.
23. **SEC-6** — whitelist-`patterns` не должен принимать реальные секреты + warning.
24. **SEC-7** — `rules`/`by_agent` полный off + `hybrid`-mode → ошибка/предупреждение.
25. **SEC-8** — `TEST_OUTPUT` — только pass/fail-count, не raw stderr.

### Приоритет 3 — LOW (минорные)
26. L1-L5 (SKILL.md минорные), L6-L7 (init-context), L8-L14 (плагин LOW),
    L15-L16 (доки), SEC-9/10 (probe, терминальные echo).

### Приоритет 4 — Тесты (закрытие пробелов)
- Добавить тесты на `index.js` adapter (config-хук, startup, dispose, error-swallow).
- Тест на `ledger_entry` no-op.
- (Если решат) тест на false-positive «monkey»/`amountless` — как регрессия.
- **Security-регрессии (SEC-1):** `TOKEN=`/`KEY=`/`SECRET=`/`AUTH=`/`CREDENTIAL=`,
  JSON-ключи, colon-секреты, URI с анонимным user, Bearer/token JWT вне заголовка,
  `secret:{...}`. Плюс не-утечка: `sanitizer.redacted` не содержит текст; title-лог
  санитизирован.

### Вопросы для разбора
- **M12 (config `file_access:"allow"`)**: критично решить — это потенциальный
  security-риск. Убрать override совсем, или оставить и документировать?
- **H1 (шаг 15/16)**: как правильно переструктурировать — перенести финальные
  проверки после 16, или ввести шаг 16a?
- **Плагин LOW (monkey/amountless)**: нужен ли stricter regex (риск false
  negative у секретов), или принять tradeoff?
- **Сплит init/design**: устаревшие specs (init-idempotency) — чинить в них, или
  пометить deprecated и опираться на maestro-init-tasks-plan?

## Проверка
- После правок — `node --test plugins/maestro-bootstrap/index.test.js` (63/63).
- Ревью когерентности SKILL.md ↔ manual_docs ↔ commands (по keep-docs-up-to-date).
- Ссылки в manual_docs — без битых.