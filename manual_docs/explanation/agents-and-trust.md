# Агенты и модель доверия

[Назад к оглавлению](../index.md)

## 🎯 Назначение

Как устроены роли агентов и модель доверия в скилле `maestro`: почему субагенты
по умолчанию untrusted, как работает security review (sanitizer) и file access
control.

## 📖 Роли агентов

Оркестрация — через скилл `maestro` в любой primary-сессии (вход `/maestro`);
отдельного primary-агента `maestro` нет. Субагенты (вызываются через `task`):

| Агент | Роль | Изменяет файлы? |
|---|---|---|
| `design` | Spec formation: brainstorming, дизайн-решения, написание spec | да (spec файл) |
| `haiku` | Механические задачи + bash-скрипты | да |
| `sonnet` | Интеграционные задачи | да |
| `opus` | Архитектурные решения, Spec Review | нет (read-only) |
| `fable` | Примеры, метафоры | нет (read-only) |
| `code-reviewer` | Финальное ревью ветки | нет (только git diff/log) |
| `sanitizer` | Security review — поиск и пометка чувствительных данных | нет (read-only) |

## 📖 Модель доверия

Оркестратор работает в сессии дефолтной модели — считается **доверенным**.
Любой субагент — отдельный инференс/сессия; данные покидают контекст
оркестратора. Поэтому **по умолчанию все субагенты untrusted** (кроме `design`
и `sanitizer`).

Trust-статус управляет **двумя** измерениями защиты:

| Уровень | Sanitize промпта | File access control |
|---|---|---|
| **trusted** (`maestro.json` → `trust` = `true`) | **skip** | **skip** (без ограничений по `access_policy`); доступ к `confidential` — по `confidential.trusted.<tool>` |
| **untrusted** (default) | Security Review (Ур.1 + Ур.2) | перехват `read` по access-policy (ask → блок); доступ к `confidential` — **всегда deny** |

> File access control применяется ко всем сабагентам; trusted-skip для file
> access — ограничен (требует верификации перехвата child-сессий, C2).

### trust-config → maestro.json

Файл `maestro.json` в корне проекта (рядом с `opencode.json`) — консолидированный
конфиг с четырьмя секциями: `trust`, `access_policy`, `confidential`,
`sanitizer_whitelist`. Секция
`trust` перечисляет **только trusted** сабагентов. Всё, чего нет в файле —
untrusted. Если файла нет — все untrusted.

`maestro.json` **генерируется `/maestro-init`** (задача «Конфигурация maestro»)
и коммитится в git. `design` и `sanitizer` — trusted по роли; модели у них
**независимые** (trusted — атрибут безопасности, не мощность).

```json
{
  "trust": {
    "design": true,
    "sanitizer": true
  }
}
```

- Ключ в `trust` — имя сабагента; значение только `true` = trusted.
- Файл коммитится в git — trust-level policy проекта.
- Оркестратор читает его один раз на шаге 0 и кэширует.
- `design` — trusted по роли (видит полный контекст для качественного spec).
- `sanitizer` — trusted по роли (видит сырые данные, чтобы пометить).
- `maestro.json` — единственный источник конфигурации. Старые `trust-config.json`
  и отдельные файлы в `.maestro/` больше не читаются плагином.

## 📖 Security Review (двухуровневая защита)

Защита чувствительных данных перед диспатчем в untrusted сабагенты + file
access control. Два уровня + HITL-гейт:

```
untrusted диспатч →
  [Ур.1] плагин maestro-bootstrap — авто-маскирование промпта, без HITL
  [Ур.2] сабагент sanitizer (trusted, read-only) — пометки, не вычищает
  пометки есть → HITL: (a) вычистить и продолжить / (b) продолжить как есть / (c) стоп
  → во время работы: file access control (перехват file-тулов по access-policy.json)
```

**Роль сабагента `sanitizer`:** trusted, read-only. Находит и **помечает**
чувствительные данные (где, что, почему) — не вычищает. Оркестратор вычищает
по пометкам. Выход — structured-блок `SANITIZER FINDINGS` + `STATUS: CLEAN |
FINDINGS_FOUND`. Также генерирует/поддерживает секцию `access_policy` в `maestro.json`
(файл правил доступа по структуре проекта/стеку).

**Trusted skip:** если сабагент в `maestro.json` → `trust` = `true` — sanitize промпта
и file access control **не применяются** (данные передаются как есть, доступ к
файлам свободен).

**File access control (реализован в плагине):** untrusted сабагент при попытке
`read` ask/deny-файла → блокировка плагином `maestro-bootstrap` по
`maestro.json` → `access_policy` (`allow` → пропуск, `ask` → блок с HITL-сигналом,
`deny` → жёсткий блок; приоритет deny > ask > allow). Покрывается только `read`;
bash/glob/grep — нативные permissions. Файл `maestro.json` (секция `access_policy`)
формирует сабагент `sanitizer` или вручную; если файла нет — плагин не блокирует (fail-open).

### Защищённая папка `docs/confidential`

Секция `confidential` в `maestro.json` закрывает конфиденциальные пути
(по умолчанию `docs/confidential/**`) для чтения и записи всем, кроме trusted-
субагентов (имена из секции `trust`). Primary-сессия и untrusted-субагенты —
жёсткий `deny` (не конфигурируется). Trusted-субагент читает по умолчанию
(`trusted.read: allow`), а запись/редактирование по умолчанию запрещены
(`trusted.write`/`trusted.edit: deny`) и выдаются явно.

**Известное ограничение (риск обхода):** плагин перехватывает только
`read`/`write`/`edit`. Содержимое confidential можно вытащить через
`bash cat`, `grep -r`, `glob` — эти тулы плагином не покрываются (пути из
bash-команд ненадёжно извлекаются).

**Рекомендуемый 2-й эшелон защиты — нативные permissions OpenCode**
(`opencode.json`), чтобы закрыть `bash`/`glob`/`grep` для confidential-путей:

```json
{
  "permission": {
    "bash": {
      "*cat*confidential*": "deny",
      "*grep*confidential*": "deny",
      "*ls*confidential*": "deny",
      "*glob*confidential*": "deny"
    }
  }
}
```

Два слоя работают независимо: плагин закрывает `read/write/edit`, native
permissions OpenCode закрывают `bash/glob/grep`. При настройке вынесите
`docs/confidential/**` из `access_policy.allow`, чтобы избежать путаницы
(confidential технически выигрывает, но явная настройка читается яснее).

**Прочее:**
- **Смена `maestro.json`** — требует рестарта opencode (конфиг читается при
  старте плагина).
- **Trust не наследуется** вложенными субагентами: даже если trusted-субагент
  диспатчит вложенного, вложенный оценивается по своему имени и получает deny,
  если не в `trust`.
- **Пути нормализуются** перед матчингом: absolute / `./` / relative / `..`
  сводятся к каноническому проект-относительному виду, поэтому
  `/abs/.../docs/confidential/x.md`, `./docs/confidential/x.md` и
  `docs/Confidential/...` (case-вариант) блокируются наравне с
  `docs/confidential/...`. Листинг самой директории `docs/confidential` тоже
  блокируется. `bash`/`glob`/`grep` по-прежнему не покрываются плагином —
  используйте нативные permissions OpenCode (2-й эшелон).

> **⚠️ Риск: данные confidential открыты при отключённом плагине.** Вся защита
> `confidential` (как и `access_policy` и sanitizer) реализована в плагине
> `maestro-bootstrap` и **не является файловой защитой ОС (не chmod/ACL)**. Это
> fail-open: при отключённом или незагруженном плагине `read`/`write`/`edit` в
> `docs/confidential/**` выполняются без ограничений. Если данные в
> `docs/confidential/` действительно конфиденциальны и их раскрытие недопустимо
> даже без плагина — это **не** достаточный барьер: дополнительно ограничьте
> права каталога средствами ОС (read-only / владелец) или репозитория (git-crypt,
> отдельный приватный submodule/remote). Confidential — это защита от untrusted-
> агентов **при работающем плагине**, не универсальная защита данных.

**⚠️ Чего делать НЕ надо — НЕ добавлять рабочие spec/plan пути в `paths`.**
Каталоги `docs/superpowers/specs/**` и `docs/superpowers/plans/**` являются
**двухролевыми**: генерируются trusted `design` (пишет spec/plan) и читаются
trusted `sanitizer`, но **потребляются untrusted**-субагентами — `opus` (spec
review, шаг 9), implementer (`haiku`/`sonnet`, шаг 13), `code-reviewer` (шаг 16).
Если добавить эти пути в `confidential.paths`, untrusted-субагенты и primary
получат жёсткий deny на чтение spec/plan, и **процесс планирования/реализации
остановится** (untrusted не смогут читать исходники для своей работы). Защита
confidential-ДАННЫХ обеспечивается иначе: spec/plan **очищаются** sanitizer
(шаг 8.6 pipeline, «Подписи spec-файла») и лежат **вне** `docs/confidential/`;
untrusted работают по очищенным артефактам, а доступ к исходным confidential-
файлам им закрыт. Confidential покрывает **исходные данные**, а не очищенные
артефакты на их основе.

### Жёсткий гейт «плагин работает»

Чтобы пользователь не работал с confidential-данными при отключённом плагине,
на входе `@maestro`, `@maestro-design`, `@maestro-feedback-report` (в maestro-
проекте с `maestro.json`) выполняется гейт: наличие `maestro-bootstrap` в
`opencode.json → plugin` И свежая запись `plugin initialized` в логе плагина.
При невыполнении — жёсткий стоп без «продолжить» (только подключить+перезапуск
или отмена).

**Ограничения гейта:**
- **Не OS-барьер.** Гейт — инструкция в `SKILL.md`, исполняемая оркестратором
  (LLM). Нативного opencode-механизма «нет плагина → запретить» не существует.
  Пользователь технически может обойти гейт (новый запрос, правка скилла) —
  это осознанное ограничение.
- **Косвенный сигнал.** `plugin initialized` в логе пишется при успешной
  инициализации плагина (установке хуков) — это надёжный признак работы, но не
  абсолютная гарантия.
- **Кросс-полуночная сессия.** В долгоживущем процессе через полночь запись
  `plugin initialized` может быть старше 24ч → возможен ложный стоп. Порог
  настраивается, но гейт по умолчанию использует 24ч.

**Точки встраивания:**
- **Spec security review** (шаг 8.6) — для фич со spec (сложные/архитектурные),
  до Spec Review и планирования. Перезапуск на каждый Revise-цикл.
- **Перед диспатчем untrusted** (шаги 9/13/16) — всегда.

**Правила детекта (Context Sanitizer):**
1. **Secrets из окружения** — имена (любой регистр) с `SECRET`, `KEY`, `TOKEN`,
   `PASSWORD`, `CREDENTIAL`, `PASS`, `AUTH`, `DSN`, `CERT`, `SALT`,
   `SIGNATURE`, `NONCE` → `<redacted:env.NAME>`.
2. **Чувствительные поля данных** — финансовые (`amount`, `salary`, `iban`,
   `card_number`, `cvv`, `vat`, `total_amount`, ...), PII (`phone`, `email`,
   `inn`, `snils`, `passport`, ...), бизнес-поля → `<redacted>`. Детект
   регистронезависим; суффиксы (`amountValue`, `amount_value`) и camelCase-
   варианты snake-полей (`cardNumber`) покрываются; список расширяем через
   `extra_fields` в whitelist.
3. **Файлы .env / .env.\*** → `<redacted:.env file>`.
4. **SFTP/DB credentials** — URI-схемы (`sftp://`, `postgresql://`, `mysql://`,
   `ssh://`, `ldap://`, `clickhouse://`, ..., регистронезависимо) с credentials
   и connection-string params (`password=...`, `pwd=...`) →
   `<redacted:connection>`. Схемы расширяемы через `extra_uri_schemes`.
5. **Private keys** — PEM-блоки `-----BEGIN ... PRIVATE KEY-----`
   (регистронезависимо) → `<redacted>`.
6. **Auth headers** — `Authorization: Bearer ...`, `X-API-Key: ...` → `<redacted>`.
7. **Raw ledger entries** → маскинг полей из п.2.

Что **не** фильтруется: агрегированные данные, схемы БД без данных, код и
конфиги (кроме `.env`), имена таблиц/колонок.

**Аудит-лог:** плагин пишет события sanitizer в
`.maestro/logs/maestro-bootstrap-<date>.log` с маркерами `sanitizer.redacted`
(что замаскировано, без содержимого) и `access_policy.blocked` (файл-доступ).

## 🔗 Связанные разделы

- [Выбор моделей](../reference/model-selection.md)
- [Справочник HITL-гейтов](../reference/hitl-gates.md)
- [Устройство pipeline](pipeline-overview.md)
- [Кастомизация скилла](../how-to/customize-maestro.md)