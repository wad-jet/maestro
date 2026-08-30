# Дизайн: доработка процесса обновления maestro

Дата: 2026-08-30
Статус: черновик (approved на brainstorm; revise после Spec Review)
Категория: Сложная/Архитектурная

## Проблема

Обновление maestro в целевом проекте непрозрачно и хрупко:

1. Документация утверждает «перезапуск OpenCode подтянет последнюю версию плагина» —
   это **неверно**. Git-плагин `maestro-bootstrap@git+...` клонируется в кэш
   `~/.cache/opencode/packages/` **один раз** и не обновляется при перезапуске.
   Кэш зафиксирован на момент первичной установки. Плагин мог месяцами держать
   старую версию, пока кэш не очищен вручную.
2. `agpack sync` обновляет только скилы/команды/агенты в `.opencode/`, но **не
   трогает плагин** (он живёт отдельно в кэше). Пользователь думает, что обновил всё,
   а плагин остался старым.
3. Нет единой команды обновления — процесс размазан по нескольким ручным шагам
   (agpack + очистка кэша + рестарт + проверка).
4. Нет видимости рассинхрона версий: пользователь замечает проблему только вручную
   через `/maestro-version` (и то не всегда понимает причину).

## Цель

Сделать обновление maestro одной простой операцией и сделать застрявший кэш/рассинхрон
версий видимым и объяснимым.

## Не-цели

- Не вводить нативный механизм OpenCode для установки скилов (его не существует —
  проверено: OpenCode загружает скилы/команды/агентов только из файловых путей
  `.opencode/` и `~/.config/opencode/`; `opencode plugin` управляет только плагинами).
- Не менять `maestro-init.sh` (его задачи — первичная установка).
- Не делать проверку «последней версии из GitHub» через сеть в рантайме плагина
  (оффлайн-неустойчиво, конфликтует с пином `#<sha>`).
- Не делать жёсткого блока при рассинхроне версий (это деградация, не failure;
  см. Risks — устаревший security-слой).

## Решение

### 1. `maestro.json` — поле `expected_version`

Опциональное поле в каноне конфигурации:

```json
{
  "trust": { "custodian": true, "sanitizer": true },
  "expected_version": "1.2.0",
  "access_policy": { ... },
  "confidential": { ... },
  "sanitizer_whitelist": { ... }
}
```

- **Семантика:** версия дистрибутива maestro, до которой проект ожидает быть
  обновлённым.
- **Кто пишет:**
  - `maestro-update.sh` — при каждом обновлении (из `package.json` HEAD или пина).
  - `/maestro-init` скилл — при первичной установке: пишет **актуальную версию
    дистрибутива** из HEAD авторского репо `wad-jet/maestro` (сеть), **не** версию
    из кэша. Обоснование: кэш плагина глобален на пользователя и может быть
    устаревшим; если `/maestro-init` запишет фактическую (устаревшую) версию кэша,
    то `actual == expected` и предупреждение о застрявшем кэше не сработает никогда —
    целевой сценарий фичи будет побеждён. Сеть при init допустима (одноразовая).
  - `maestro-init.sh` **не пишет** `expected_version`: он выполняется до создания
    `maestro.json` (тот создаёт скилл `/maestro-init` внутри opencode).
- **Опционально:** отсутствие поля → плагин не предупреждает (обратная совместимость).

**Разделение источников версии:**

| Роль | Источник | Комментарий |
|---|---|---|
| Фактическая версия (что загружено) | `package.json` плагина в кэше (`readPluginVersion`) | Версия фактически работающего плагина |
| Ожидаемая версия (что проект хочет) | `expected_version` в `maestro.json` | Пишется скриптом обновления / скиллом init |

Фактическую версию плагин читает из своего же `package.json`; ожидаемую — из
`maestro.json`. Это разные сущности: плагин не может узнать «желаемую» версию из
своего `package.json`, потому что последний и отражает «застрявшее» состояние.

### 2. Проверка версии в плагине (`plugins/maestro-bootstrap/core.js`)

В `MaestroBootstrapPlugin` при init:

1. Фактическая версия = `readPluginVersion()`.
2. `expected_version` = `loadMaestroConfig(...).expected_version`.
3. **Зеркалирование `expected_version` в метафайл:** плагин при init пишет
   `expected_version` в `.maestro/expected-version` (рядом с уже существующим
   `.maestro/plugin-version`). Плагин уже читает `maestro.json` нативно через
   `loadMaestroConfig` (fs без access-гейта), поэтому **не требуется** выносить
   `maestro.json` из-под `access_policy` — это устраняет ИБ-риск экспозиции
   `sanitizer_whitelist.patterns` untrusted-сабагентам и не обходит
   confidential-границу.
4. **Доступность `.maestro/expected-version` для чтения:** `isPluginMetaFile`
   (core.js) делает **точное** сравнение только с `.maestro/plugin-version` (без
   wildcard) — исключения `.maestro/**` не существует. Поэтому требуется **явное
   расширение `isPluginMetaFile`** до набора `{".maestro/plugin-version",
   ".maestro/expected-version"}` (сохранить case-sensitive fail-closed семантику).
   Оба файла — semver-only, без чувствительного содержимого, поэтому вынос из
   `access_policy` безопасен. ИБ-тест: чтение `maestro.json` untrusted-агентом
   по-прежнему блокируется/требует gate.
5. Если фактическая и ожидаемая заданы и **не равны** (точное строковое сравнение) →
   `log.warn("plugin.version_mismatch", { current, expected })`. Работа НЕ блокируется.
6. **Дублировать предупреждение в stderr при init** (`console.warn`), по прецеденту
   `console.error` для audit-сбоев — чтобы оно было видно в терминале без чтения лога.
7. **Жизненный цикл зеркала:** при отсутствии `expected_version` в `maestro.json`
   плагин не пишет (или удаляет) `.maestro/expected-version` — иначе устаревшее
   зеркало даст вечный ложный mismatch в `/maestro-version`. В доке отметить, что
   зеркало актуально «на момент последнего init opencode».

**Ограничение:** плагин не имеет механизма «push-сообщение пользователю» в рантайме
(проверено: нет хука для этого). Поэтому видимость обеспечивается через stderr +
`/maestro-version`. Плагин НЕ персистит «флаг рассинхрона» в возвращаемый объект —
команда `/maestro-version` не имеет доступа к внутренностям плагина; сравнение делает
сама команда (см. §3).

### 3. `/maestro-version` — показ расхождения

Обновить `commands/maestro-version.md`: команда читает **два метафайла в `.maestro/`**
и сравнивает (оба защищены исключением `isPluginMetaFile`):

1. Фактическую версию из `.maestro/plugin-version`.
2. `expected_version` из `.maestro/expected-version` (зеркало, пишет плагин при init).

При расхождении выводит предупреждение с руководством к действию.

**Доступ:** команда не читает `maestro.json` напрямую (иначе упёрлась бы в
`access_policy` и рисковала бы экспозицией секретов в `sanitizer_whitelist.patterns`).
Вместо этого — исключительно `.maestro/`-метафайлы, защищённые расширенным
`isPluginMetaFile`. `expected-version` отсутствует → предупреждение не выводится
(обратная совместимость).

**Формулировка предупреждения — единое руководство** (два состояния неразличимы по
имеющимся источникам: в обоих `actual != expected`):
> «Плагин 1.1.0, ожидается 1.2.0. Выполните `maestro-update.sh` (или `git pull` в
> авторском репо при ручной установке), затем перезапустите opencode.»

### 4. `maestro-update.sh` — новый скрипт обновления

По образцу `maestro-init.sh`, но под обновление. Флаги: `--pin <sha>`, `--help`.

**Порядок шагов (сетевые read-only операции до мутаций):**

1. Проверка предусловий (git, python3, agpack).
2. **Определение целевой версии (сеть, read-only, до мутаций):**
   - источник — **явный URL** `https://github.com/wad-jet/maestro.git` (константа,
     по прецеденту `REPO_URL`/`PLUGIN_SPEC` в `maestro-init.sh`). **НЕ** `origin`
     целевого проекта — там remote может быть другим.
   - без `--pin`: temp-клон/fetch (`git clone --depth 1` в temp-каталог) → чтение
     `package.json → version` из HEAD;
   - с `--pin <sha>`: temp-fetch этого sha → `git show <sha>:package.json` →
     `version` этого коммита;
   - **temp-каталог удерживается до шага 3** (он содержит канонический
     `maestro-init/agpack.yml` для merge-add, см. шаг 3), очищается после.
3. `agpack sync` — обновление скилов/команд/агентов (**основной механизм**;
   нативного аналога в OpenCode нет).
   **Дрейф `agpack.yml` (Important-2):** `agpack sync` обновляет только
   перечисленное в `agpack.yml` проекта; если новый релиз добавил skill/command/
   agent, старый `agpack.yml` не получит новый компонент — рассинхрон версий при
   этом **не сигнализируется** (версия из `package.json` совпадает). **Решение:**
   скрипт делает **merge-add** канонических записей из `maestro-init/agpack.yml`
   (из удержанного temp-клона) в `agpack.yml` проекта — добавляет отсутствующие
   записи, не трогая пользовательские (существующие `dependencies.skills/commands/
   agents` по `url+path`), затем `agpack sync`. Если структура релиза совпадает —
   merge-add не меняет ничего (идемпотентно).
4. **Очистка кэша плагина** OpenCode:
   - имя каталога кэша — нормализованное `maestro-bootstrap@git+https:...` с
     **одинарным** слэшем (`github.com/wad-jet/maestro.git`);
   - учесть `XDG_CACHE_HOME` (не хардкодить `~/.cache`);
   - учитывать запиненные варианты (`#<sha>`) — отдельные записи кэша, чистить
     по префиксу `maestro-bootstrap@git+https:`;
   - если каталог не найден — `warn` (детект дрейфа layout), не тихий успех;
   - не падать при отсутствии каталога (идемпотентно).
5. Запись `expected_version` в `maestro.json` (идемпотентно, merge, сохраняя
   пользовательские правки других секций).
6. Флаг `--pin <sha>`: опционально зафиксировать версию плагина `#<sha>` в конфиге
   opencode. **По умолчанию (без `--pin`)** скрипт **переписывает registration-spec
   на вариант без фрагмента** (снимает существующий `#<sha>`) — иначе пин остаётся,
   а `expected_version` пишется из HEAD → вечный ложный mismatch (обратный сценарий
   замечания #3). 
   **Место регистрации:** учитывать `--global` (аналогично `maestro-init.sh`):
   если плагин зарегистрирован глобально (`~/.config/opencode/opencode.json`),
   пинить там, иначе в `.opencode/opencode.json` проекта. Не создавать дублей.
   **Семантика `--pin`:** целевая версия (шаг 2) читается из этого же коммита —
   иначе `expected_version` (HEAD) ≠ фактическая (пин) → вечный ложный mismatch.
7. Инструкция: перезапустить opencode + `/maestro-version`.

**Поведение при частичном отказе:** если сетевой шаг (2) не удался → остановиться
до мутаций (не чистить кэш, не менять конфиги), вывести ошибку. Если `agpack sync`
успешен, но дальше сбой → скилы уже обновлены, кэш/`expected_version` не тронуты —
сообщить о частичном обновлении.

**НЕ переиспользует `maestro-init.sh`** — тот для первичной установки (не чистит
кэш плагина, не перезаписывает `agpack.yml`).

### 5. Документация (док-синк по AGENTS.md)

- `manual_docs/how-to/update-maestro.md`: исправить ложное «перезапуск подтянет
  версию» → реальный процесс (очистка кэша); `maestro-update.sh` — основной способ;
  `maestro-init.sh` — пометить «только первичная установка».
- `manual_docs/how-to/install-maestro.md`: раздел про обновление (ссылка на
  `maestro-update.sh`).
- `README.md`: обновить раздел «Как обновить maestro».
- `manual_docs/overview/changelog.md`: записать фичу.
- `manual_docs/reference/commands.md`: отразить изменение поведения `/maestro-version`
  (показ расхождения).
- `manual_docs/reference/config.md`: документировать `expected_version` в `maestro.json`.
- `skills/maestro-assistant/SKILL.md`: добавить `expected_version` в канон `maestro.json`.
- `plugins/maestro-bootstrap/README.md`: новое warn-поведение (`plugin.version_mismatch`)
  и метафайл `.maestro/expected-version`.
- `SECURITY.md`: зафиксировать, что `maestro.json` (в т.ч. `sanitizer_whitelist.patterns`)
  НЕ выносится из-под `access_policy`; предупреждение о версии использует только
  `.maestro/`-метафайлы, без ослабления доступа к конфигу.
- `manual_docs/explanation/agents-and-trust.md`: синк с SECURITY.md (нет нового
  исключения для чтения `maestro.json`).

### 6. Тестирование

- **Плагин (юнит-тесты в `index.test.js`):**
  - mismatch (`current != expected`) → `warn("plugin.version_mismatch")` + stderr;
  - match → нет warn;
  - отсутствие `expected_version` → нет warn (обратная совместимость);
  - не-строковый `expected_version` / `readPluginVersion() === undefined` → нет warn;
  - зеркалирование: плагин пишет `.maestro/expected-version` при init;
  - **`maestro.json` НЕ исключается из `access_policy`** — тест, что чтение
    `maestro.json` untrusted-агентом по-прежнему блокируется/требует gate;
  - расширение `isPluginMetaFile`: `.maestro/expected-version` читаем без gate,
    `.maestro/logs/x.log` — нет (точная семантика, без wildcard);
  - зеркало удаляется при отсутствии `expected_version` в `maestro.json`.
- **`maestro-update.sh` (ручная проверка в песочнице):**
  - идемпотентность повторного запуска;
  - очистка кэша плагина (включая запиненные варианты, `XDG_CACHE_HOME`);
  - запись `expected_version` в `maestro.json` (merge, без потери других секций);
  - флаг `--pin <sha>` (версия из конкретного коммита; учёт `--global`);
  - запуск без `--pin` снимает существующий `#<sha>` в registration-spec.

## Файлы

| Файл | Изменение |
|---|---|
| `maestro.json` (канон) | + `expected_version` |
| `plugins/maestro-bootstrap/core.js` | проверка версии, зеркалирование `.maestro/expected-version`, расширение `isPluginMetaFile`, warn + stderr |
| `plugins/maestro-bootstrap/index.test.js` | юнит-тесты проверки версии |
| `commands/maestro-version.md` | показ расхождения (сравнение двух метафайлов) |
| `skills/maestro-init/SKILL.md` | запись `expected_version` при первичной установке (HEAD, сеть) |
| `maestro-update.sh` | **новый** скрипт обновления |
| `agpack.yml` (проект) | merge-add канонических записей из `maestro-init/agpack.yml` |
| `manual_docs/how-to/update-maestro.md` | исправить + добавить скрипт |
| `manual_docs/how-to/install-maestro.md` | раздел про обновление |
| `manual_docs/reference/commands.md` | поведение `/maestro-version` |
| `manual_docs/reference/config.md` | `expected_version` + метафайл `.maestro/expected-version` |
| `README.md` | раздел «Как обновить maestro» |
| `manual_docs/overview/changelog.md` | запись фичи |
| `skills/maestro-assistant/SKILL.md` | канон + `expected_version` |
| `plugins/maestro-bootstrap/README.md` | warn-поведение + метафайл |
| `SECURITY.md` | запрет ослабления `access_policy` для `maestro.json` |
| `manual_docs/explanation/agents-and-trust.md` | синк с SECURITY.md |

## Риски

- **Устаревший плагин = устаревший security-слой.** Плагин реализует Level-1
  sanitizer, confidential- и access-контроль (инварианты SECURITY.md). Проект с
  застрявшим плагином молча применяет старые правила. → Аргумент для видимости
  предупреждения (stderr + `/maestro-version`). Жёсткий блок не вводим (см. Не-цели).
- **Глобальный кэш на пользователя:** очистка затрагивает все проекты/сессии машины;
  гонка с параллельно стартующей сессией OpenCode в момент удаления. Запущенные
  сессии держат плагин в памяти (ok), но новая сессия в момент удаления может не
  догрузиться. → Документировать очистку кэша при закрытых сессиях.
- **`expected_version` коммитится в git** (канон: `maestro.json` в репо): churn и
  merge-конфликты при обновлениях у нескольких разработчиков. → Принимаем;
  `maestro.json` уже коммитится, поле опционально.
- **Premise — наблюдаемое поведение OpenCode, не контракт.** «Кэш git-плагина не
  обновляется при рестарте» проверено эмпирически (см. «Проблема»). Если OpenCode
  изменит резолвинг, очистка станет избыточной (безвредно). Семантика не ломается.
- **Skew скиллы/плагин при `--pin`:** плагин на `#<sha>`, скиллы — с HEAD
  (`agpack` не пинит) → рассинхрон двух частей дистрибутива. → Документировать, что
  `--pin` фиксирует плагин, а скиллы остаются на HEAD; для полной воспроизводимости
  пин использовать совместно с `agpack`-пином (если появится).
- **`expected_version` устаревает** при ручном обновлении (без скрипта) →
  документировать, что ожидаемая версия — результат последнего `maestro-update.sh`
  или `/maestro-init`.

## Инварианты

- **Каждое изменение дистрибутива maestro → bump версии** в корневом `package.json`.
  Без bump изменения скилов/плагина невидимы для `expected_version` (детект по версии,
  не по коммиту). Принимаем как конвенцию.

<!-- maestro:sanitize status: CLEAN date: 2026-08-30 hash: b9b761199bf85dbb -->
<!-- maestro:review reviewer: opus date: 2026-08-30 verdict: approve hash: b9b761199bf85dbb -->
