# Memory Layer v3 — Branch-aware Memory (контекст ветки)

## 1. Обзор

**Проблема:** память проекта сейчас плоская (один key на репозиторий, без привязки к веткам/мержам).
Информация из незавершённых/отклонённых фич попадает в общий контекст с полным весом и не различается
от принятой. Recall не отличает «истину в main» от «опыта неслитой ветки».

**Цель:** контекст памяти привязывается к git-истории. Каждая запись несёт git-метаданные
(`branch`/`head`/`merged`); **идентичность записи — по коммиту (`head`)**, имя ветки — только display.
Recall по умолчанию **commit-scoped**: общий (mainline) контекст + собственный «опыт» (неслитые коммиты,
достижимые из checkout); чужие unmerged-коммиты не попадают в контекст. Слияние работы в mainline
промоутирует её записи в общий контекст.

**Категория:** Архитектурная (default-on; обязательный Spec Review). **Обратная совместимость конфигураций и
данных НЕ требуется (HITL):** публичных релизов v1/v2/v3a не было (память не использовалась) — схема конфига
и хранения может меняться свободно (удаление `centralized_confidential`, дефолты, колонки, тиры) без
миграций и совместимостных заглушек. Для существующих dev-БД — аддитивная гигиена (§3/§6.2), не миграция.
legacy-тир отсутствует (§2).

**Связь с диалогом:** модель, сформулированная пользователем — «каждая ветка обладает своим актуальным
контекстом, наполняемым по мере слияния с другими ветками»; контекст = функция от git-истории, пополняемая
в точках слияний.

## 2. Модель и термины

- **mainline** — основная ветка проекта. Детект из git (§5/§8): конфиг `memory.mainline` → remote HEAD →
  `init.defaultBranch` → резерв `main`/`master`/`develop`. Имя ветки не имеет значения (`dev`/`trunk`/`stage`/…).
- **Идентичность записи — по коммиту (`head`), НЕ по имени ветки (решение HITL).** Имя ветки —
  переиспользуемая метка (Dev B позже создаёт ветку с именем, идентичным ветке Dev A, но другую задачу) —
  матчинг по имени контаминирует контекст и промоцию. `branch` — только display/stats (§3); принадлежность
  определяется достижимостью `head` в git-истории.
- **General tier (актуальный контекст):** `merged = 1` ИЛИ `head` достижим из mainline
  (`head ∈ rev-list <mainline>`). Знание вошло в mainline.
- **Experience tier (опыт) — commit-based (решение HITL):** `merged = 0` И `head ∈ expSet`, где
  `expSet = rev-list HEAD \ rev-list <mainline>` (коммиты в истории текущего checkout, ещё не в mainline).
  Охватывает: собственную работу (head — предок HEAD), ответвления/стеки (v1→v2→v3a видят базу), ветки,
  git-мерженные в текущую. Несвязанные коммиты — вне опыта. Это «контекст = функция от git-истории»
  (модель пользователя) дословно.
- **Чужие unmerged коммиты (недостижимые из HEAD):** НЕ входят в recall по умолчанию (структурная изоляция).
- **Переиспользование имени ветки (вскрытый сценарий):** решено head-based матчингом — записи Dev A
  (старые `head`) не входят в контекст Dev B (новой ветки с тем же именем), т.к. их коммиты не в его истории;
  промоция тоже по `head`, не по имени.
- **Удаление ветки без мержа (решение HITL, вариант A):** записи остаются (`merged=0`, данные живы), но их
  `head` перестаёт быть достижимым → контекст «умирает» (невидим в branch-scoped recall, доступен через
  `scope: project` / re-import). Не-деструктивно. **Авто-вычистка отклонена** (транзитность reachability;
  необратимость; пользы нет — мёртвый контекст и так невидим; гигиена — `retention_days` + `memory_forget`).
  **Ручная очистка мёртвых данных — требование на будущее** → §12 (v4-бэклог; примитив `memory_forget` есть).
- **Head-based ограничения (документируются; under-inclusion — безопасное направление):**
  (a) **rebase/squash переписывают sha** → старые `head` становятся dangling → записи **«не в контексте»**
  (dead; видимы только `scope: project`); git сам теряет pre-rebase идентичность — memory честно отражает это.
  Config-guidance: rebase/squash-heavy флоу → `branch_context: false`;
  (b) **merge-then-revert** — head слитой ветки достижим из mainline → general, хотя контент откачён revert'ом;
  (c) детached-запись (head записан) атрибутируется по head.
- **Нет legacy-тира (решение HITL):** maestro memory ещё не публиковалась и не использовалась (v1/v2/v3a не
  замержены) — обратная совместимость не предусматривается; старые dev-строки (head='', merged=0) —
  unattributed (только `scope: project`).
- **`branch = ''`** — detached/нерезолвнутая ветка (display); head всё равно записывается — атрибуция по head.
- **Промоция:** `merged 0→1` при `head ∈ rev-list <mainline>` (детект — §5).
- **Инвариант (custodian):** recall-тиры — механизм **области видимости**, НЕ clearance/доверия.

## 3. Метаданные и схема

Запись расширяется тремя **git-структурными** полями (исключение из маскирования — см. §9):

| Поле | Тип | Семантика |
|---|---|---|
| `branch` | `TEXT NOT NULL DEFAULT ''` | имя ветки на момент конца сессии; **display/stats только** (НЕ критерий матчинга, §2); `''` = detached/unknown |
| `head` | `TEXT NOT NULL DEFAULT ''` | commit sha на момент конца сессии — **идентичность записи** (критерий матчинга/промоции, §2/§5/§6.1); `''` = unattributed |
| `merged` | `INT NOT NULL DEFAULT 0` | 1 = промотировано (head достижим из mainline на момент проверки) |

- **Единая семантика `''`:** `head=''`/`branch=''` = unattributed/detached — видимы только в `scope: project`
  (без NULL-специфики qdrant/pg; `is_empty(head)` для старых dev-точек).
- **sqlite (dev-гигиена):** если таблица существует (старая dev-БД v1/v2) — `ALTER TABLE memory ADD COLUMN
  branch TEXT NOT NULL DEFAULT ''`, `head TEXT NOT NULL DEFAULT ''`, `merged INTEGER NOT NULL DEFAULT 0` —
  аддитивно, идемпотентно (guard `PRAGMA table_info(memory)`). Старые строки получают `head=''`, `merged=0` —
  unattributed (видны только в `scope: project`); **не мигрируются** (нет публичных данных).
  FTS5 **не** индексирует branch/head.
- **pgvector:** `ADD COLUMN IF NOT EXISTS branch TEXT NOT NULL DEFAULT ''`, `head TEXT NOT NULL DEFAULT ''`,
  `merged INT NOT NULL DEFAULT 0` — старые строки → unattributed (как выше).
- **qdrant:** payload-поля `branch`/`head`/`merged` на каждой точке (всегда присутствуют; detached → `''`).
  Отсутствующие поля на старых dev-точках → `is_empty(head)` трактуется как `''` (unattributed).
  Опционально: payload-индекс на `head` (производительность кандидат-фильтра; на корректность не влияет).
- **scan/export:** `branch`/`head`/`merged` включаются в SCAN_FIELDS (легитимные метаданные, не derived-текст);
  экспорт/импорт (v2 JSONL) переносят их (опционально — отсутствуют → `branch=''`, `merged=0` → unknown).
- **import:** поля опциональны (нет → `branch=''`, `merged=0` → unknown); при импорте сохраняются как есть
  (не re-классифицируются).

## 4. Запись (indexer + git-резолв)

- На момент саммаризации сессии резолвятся: `git branch --show-current` (ветка; detached HEAD → `''`),
  `git rev-parse HEAD` (head). Резолв — через **дедуп-хелпер** (паттерн `getGitConfig`: module-Map по root;
  значения НЕ кэшируются между вызовами — ветка/HEAD меняются). `head` устаревает после rebase
  (переписанные sha) — поле помечено debug/as-of, staleness документируется.
- `merged` при записи: `branch === mainline ? 1 : 0` (быстрый путь; точная атрибуция/промоция — по `head`, §5).
- **Sticky-атрибуция (re-summarize):** пользователь может `git switch` посреди живой сессии. `branch`/`head`
  резолвятся **на первой саммаризации сессии** и переиспользуются на `version++` (иначе re-summarize припишет
  контент сессии последнему checkout'у — вплоть до ложной атрибуции при переключении на main).
  Это аппроксимация: реальная сессия могла пересекать ветки; документируется.
- **Re-summarize не сбрасывает merged:** уже промоученная запись (`merged=1`) сохраняет merged при
  `version++` (коммит не может «разслиться»; окно до следующего init не создаёт деградации).
- detached HEAD → `branch=''` (display), `head` всё равно записывается (атрибуция по head, §2/§6.1;
  аппроксимация — в pipeline maestro ветки именованы).

## 5. Промоция (reconciliation)

- **На init** (паттерн fts_backfilled, но не одноразовый — состояние репо меняется): раз в init — head-based
  промоция. **Имя ветки в промоции НЕ участвует** (§2): переиспользование имён не контаминирует.
- **Предикат промоции — строго key-scoped** (shared-бэкенды qdrant/pg хранят записи многих проектов в одной
  коллекции/таблице):
  `key = :effectiveKey AND merged = 0 AND head != '' AND head ∈ rev-list <mainline>` → `merged = 1`.
  Реализация: `git merge-base --is-ancestor <head> <mainline>` для **уникальных head** (дедуп по head среди
  кандидатов ключа — N уникальных head = N subprocess, не N записей). Без key-фильтра git-факты текущего репо
  промоутили бы записи чужих проектов — тихая межпроектная порча tiers.
  **Heal-путь (окно `mainline_unresolved`):** записи транка, сделанные при нерезолвнутом mainline (merged=0,
  `branch === mainline` не проверялось), промоутятся на первом init с резолвнутым mainline — их `head` — предок
  mainline → `is-ancestor` true. Отдельной `branch != ''`-клаузы не нужно (гейт — `head != ''`).
  **Per-record fail-soft:** каждая проверка — в собственном guard; git-ошибка (exit > 1: dangling sha после
  rebase, невалидный объект) → skip записи + debug-лог, проход продолжается; **exit 1 — легитимный негатив**
  («не предок»). Одна плохая запись не обрушивает проход на каждом init.
- **«Init» здесь** — инициализация хранилища/плагина (по паттерну `fts_backfilled`), а не `@maestro-init`:
  промоция запускается на каждом старте сессии плагина.
- **Промоция — по ЛОКАЛЬНОМУ состоянию git:** после удалённого PR требуется локальный `git fetch`/`git pull`
  (обновление локальных refs/объектов), иначе промоция отложена до следующего fetch. Опыт-тир (recall) при
  этом виден сразу после pull (rev-list резолвится на каждый recall, §6.1); к general-тиру (merged=1) работа
  переходит на ближайшем init после fetch.
- **Мульти-клон + внешняя (centralized) БД — семантика:** `merged` монотонен (0→1, никогда не сбрасывается;
  §4 re-summarize тоже не сбрасывает). Любой клон, владеющий локальным git-доказательством (merge-коммит в
  локальном mainline), промоутирует запись в shared-БД → она остаётся general для всех клонов (конвергенция:
  «раз доказано — доказано навсегда»). Клон без доказательства (main позади / не fetch / объекты не принесены)
  НЕ промоутирует (fail-soft skip) — отложенность, не ошибка; сходится после fetch. Recall-опыт остаётся
  per-checkout (локальные объекты) — клон без fetch не «знает» мерж и не показывает его как слитый. `main`
  опережает текущую ветку → больше head достижимы из mainline (больше промоций), recall-опыт не зависит от
  опережения.
- **Mainline-резолв (§8) — детект из git, а не жёсткая цепочка имён** (команды используют `dev`/`trunk`/
  `stage`/`integration` — что угодно). Порядок на init:
1. **`memory.mainline` (конфиг)** — авторитетен; принимается только после `git rev-parse --verify
   refs/heads/<имя>^{commit}` (локальное существование); проверка не прошла → **шаг 5** (`mainline_unresolved`;
   override не падает в авто-детект);
2. **remote HEAD** — `git symbolic-ref refs/remotes/origin/HEAD` (полный вывод `refs/remotes/origin/<имя>`);
   нормализация: срезать литеральный префикс `refs/remotes/origin/` → **bare имя** (та же форма, что у
   `memory.mainline` и `git branch --show-current`); exit ≠ 0 / пустой вывод → шаг 3; **нормализованное имя
   принимается только после `git rev-parse --verify refs/heads/<имя>^{commit}` (локальное существование — как
   в шагах 1/3/4: имя из `origin/HEAD` может отсутствовать локально, напр. после `git clone -b <ветка>`);
   проверка не прошла → шаг 3** (верификация заодно отсекает патологический вывод symbolic-ref не из
   `refs/remotes/origin/`). origin — конвенция (форк-caveat: дефолтная ветка форка может отличаться от
   upstream — документируется в guidance);
3. **`git config --get init.defaultBranch`** (локальный дефолт) — **только после `git rev-parse --verify`**
   (глобальная настройка может именовать ветку, отсутствующую в этом репо — иначе silent-провал промоции
   без warn);
4. **резервная цепочка** `main` → `master` → `develop` (каждая — через `rev-parse --verify`; финальный резерв,
   если шаги 1–3 не дали подтверждённого имени);
5. ни один не прошёл проверку существования ИЛИ явный override именует несуществующую ветку → branch-context
   **эффективно off** (flat recall, идентично `branch_context: false`) + warn в лог (`mainline_unresolved`).
  Иначе записи на реальном транке получали бы `merged=0` и молча деградировали или исчезали из recall на
   фича-ветках (регресс v2 без диагностики). **При `mainline_unresolved` промоушен-проход пропускается** (нет резолвнутого
   mainline для `merge-base --is-ancestor <head> <mainline>` — предикат зависит от mainline; это безопасно:
   flat recall работает, промоции нет). В состоянии `mainline_unresolved` при явном `scope: "branch"` (параметр
   побеждает конфиг, §6.1) механика §6.1 сохраняется с `:mainlineSet = ∅`: **транк-префикс до fork-точки**
   (`head ∈ :ancestorSet`) деградирует до experience («⚠️ не в main») до резолва mainline; записи с
   `head ∉ :ancestorSet` (транк ушёл вперёд / чужие коммиты) невидимы — **единственная** диагностика:
   `mainline_unresolved` warn.
   Детект-значение mainline используется только в локальных git-командах, машину не покидает.
- **Gitflow-guidance (документируется):** в workflows `feature → develop → main` семантика mainline выбирается
  владельцем: `memory.mainline: "develop"` — общий контекст отражает интегрированную разработку (промоция на
  мерже фичи в develop); `"main"` — только выпущенную истину (промоция на релизном мерже develop→main).
  Без override детект (п.2/п.3) сам находит фактическую дефолтную ветку — имя ветки не имеет значения.
- **Ограничения (документируются):**
  - **Squash/rebase-мерж** — коммиты ветки не в истории mainline → запись остаётся в experience-тире с
    аннотацией «не в main», хотя работа фактически выпущена. Активное введение в заблуждение → документируется
    как известное ограничение. **Config-guidance:** squash-флоу → `branch_context: false`. Ручная промоция
    (tool) — клапан на будущее (вне scope v3).
  - **Ветка удалена после squash-мержа** — head-проверка бессильна (tip не предок mainline); не промоутится
    (squash-случай — выше).
  - **Ветка получила новые коммиты после мержа до следующего init** — tip перестаёт быть предком mainline,
    записи остаются experience-тиром до следующего мержа её tip (self-heal на merge+init; перманентно — только
    если ветка никогда не сливается снова). Тот же класс, что squash.
- Проверка только на init (не на каждый recall) — ограничение стоимости.

## 6. Recall

### 6.1 scope (default: `branch`)

`memory_search` получает опциональный параметр `scope: "branch" | "project"`.

**Членство записи (branch-скоп) — commit-based (§2):** на каждый recall вычисляются два набора (кэш — на
один recall, не сессию; §4: значения не кэшируются):

- `:ancestorSet` = `git rev-list HEAD` (вся история текущего checkout);
- `:mainlineSet` = `git rev-list <mainline>` (вся история mainline; mainline_unresolved → пусто);
- `:expSet` = `:ancestorSet \ :mainlineSet` (моя неслитая линия).

Членство записи (по `head`):

| Условие | Тир |
|---|---|
| `merged = 1` | general (без git-набора) |
| `merged = 0` И `head ∈ :mainlineSet` | general (окно pull → init-промоция; «раз доказано — general») |
| `merged = 0` И `head ∈ :expSet` | experience (аннотация «⚠️ не в main») |
| `merged = 0` И `head != ''` И `head ∉ :ancestorSet` И `head ∉ :mainlineSet` | не в контексте (чужая/удалённая/устаревшая работа; только `scope: project`) |
| `head = ''` | unattributed (только `scope: project`) |

Таблица оценивается **сверху вниз (первое совпадение)**. Реализация: запрос по ключу возвращает кандидатов
(`merged = 1 OR head != ''`), членство по наборам — фильтр в JS (память ограничена — записи-саммари).
Векторная/текстовая ветки (FTS5/tsvector/payload-fulltext) применяют один и тот же пре-фильтр кандидатов.

| scope | Значение |
|---|---|
| `branch` (default) | general + опыт (по таблице членства) |
| `project` | все записи ключа (плоское поведение) |

- **Git-ошибка резолва** (в т.ч. non-git каталог) → fail-soft коллапс: `:ancestorSet = []`,
  `:mainlineSet = []` → recall = только `merged = 1` + debug-лог (fail-soft, как §4/§5).
- **Стоимость:** два `git rev-list` (полные истории) на recall; кэш — на один recall (утечки нет: аллокация
  ограничена историей репо, GC каждый recall). Для целевого масштаба приемлемо. Монорепо 100k+ коммитов →
  документируемое ограничение (escape: `branch_context: false`). Опционально: `expSet` одной командой
  `git rev-list HEAD ^<mainline>` (меньше subprocess, исчезает race между двумя вызовами). **Shallow-clone**
  обрезает `ancestorSet` → старые записи выпадают в «не в контексте» (under-inclusion, безопасно;
  документируется).
- `memory.branch_context: false` (config) — **задаёт дефолтный scope = project**; явный `scope`-параметр
  всегда побеждает (конфиг задаёт дефолт, не запрет).
- Auto-recall (`systemBlock`) использует **дефолтный scope** (тот же, что у `memory_search`).

### 6.2 Кросс-проект (`project`-параметр)

Sibling (соседняя БД/ключ) ищется только в его **general-контексте** (`merged = 1`) —
unmerged-коммиты соседа не включаются (v3a read-only механика сохраняется; sibling-поиск без локального git —
только по флагу `merged`). Sibling-фильтр — строго `merged = 1` **при любом scope**: чужие записи не протекают
в чужой контекст. Sibling остаётся general-only даже при `scope: project` (перекрытие scope чужим ключом не
вводится). Транзиентное окно (коммит в mainline соседа, но ещё не промотирован его клоном) исключается до
промоции — конвергенция по §5.

**Pre-v3 sibling (dev-гигиена):** соседняя БД, ни разу не открытая под v3, не имеет колонок `branch`/`merged`
(read-only — никогда не ALTER'ится). sqlite/pg: отсутствие колонок → scope-фильтр дал бы SQL-ошибку →
**fail-soft skip всего sibling** + лог (ожидаемое поведение; предмет unit-теста). **qdrant:** pre-v3 точки
просто не имеют payload-поля `merged` → фильтр `merged = 1` молча возвращает пусто (без ошибки и лога) —
намеренное under-inclusion, закрепляется тестом. Публичных pre-v3 данных нет (§2).

### 6.3 Experience-тир: аннотация

- В выдаче general/experience различимы: experience помечается «⚠️ не в main» (по членству §6.1:
  `merged = 0 AND head ∈ :expSet`).
- Веса/скоры НЕ модифицируются (v1: только аннотация; ранжирование не искажается).
- Аннотация — prompt-level сигнал (как framing): смягчение, не гарантия (SEC §5a паттерн).

## 7. Инструменты / вывод

- `memory_search`: `scope`-параметр; entry-объекты несут `branch`/`head`/`merged`; вывод показывает
  `branch` и метку «⚠️ не в main» для experience.
- `memory_recall_preview`: тот же scope-логика + разбивка по тирам.
- `@maestro-memory` / `memory_stats_detail`: разбивка по веткам/тирам (сколько merged/experience/unknown).
- `memory_export`: поля включены (см. §3).

## 8. Конфигурация

| Ключ | Default | Семантика |
|---|---|---|
| `memory.branch_context` | `true` | включить branch-scoped recall (default-on, Архитектурная); `false` → flat project |
| `memory.mainline` | `null` | основная ветка для промоции; `null` → авто-детект из git (remote HEAD → `init.defaultBranch` → резерв `main`/`master`/`develop`); явный override авторитетен (несуществующее имя → `mainline_unresolved`, §5) |

Валидация в `classifyMemoryConfig` (zero-dep): `branch_context` — boolean; `mainline` — непустой string
(`/^[a-zA-Z0-9_\/.-]+$/`, длина ≤ 100) **или null**. Invalid → `disabled_reason` (`branch_context_invalid`/`mainline_invalid`)
(полное отключение памяти по конвенции; `disabled_reason` дублируется в выдаче `@maestro-memory` — диагностика
без логов).
Regex ограничивает ТОЛЬКО явный конфиг-override; авто-детектированные имена веток (любой юникод) — не проходят
валидацию конфига (источник — git).

## 9. Безопасность

- **Жёсткий инвариант (политика, HITL) — про КОНТЕНТ записей:** на удалённый сервер НЕ попадают **сырые
  confidential-данные и секреты из `title`/`summary`/`decisions`**. Гарантия — маскирование: двойное до/после
  LLM, re-mask на `memory_import`, дисциплина `maestro:sanitize` при формировании spec/план — в контент памяти
  raw-confidential не попадает в принципе (санизированные артефакты «не имеют полного контекста
  конфиденциальной части»). **Санизированные данные блокировать НЕ требуется** (политика: «санизированное
  может храниться/читаться где угодно»). **Явное исключение:** git-метаданные `branch`/`head`/`merged`
  не маскируются (см. ниже) — инвариант их не покрывает.
- **`centralized_confidential` УДАЛЁН (v3, cross-cutting, HITL).** Решение «локально vs удалённо» — только
  `storage.type` (`sqlite` = локально; `qdrant`/`pgvector` = удалённо). Отдельный ключ дублировал это решение;
  его назначение (страховка от утечки) обеспечено маскированием. Убираются: авто-failover (index.js I5),
  валидация ключа + `centralized_confidential_invalid` disabled_reason, документация. Память не публиковалась —
  удаление бесплатно (нет пользователей/миграций).
- **Unmasked git-метаданные** (`branch`/`head`/`merged`) — исключение из маскирования; строго git-структурные
  поля (имя ветки, sha, 0/1); произвольные лейблы не добавляются. Локальная сенситивность низкая
  (ветки/sha уже на машине). **Hashing-альтернатива отклонена:** рационал — читаемость + траст к серверу
  (сторонние серверы доверенные, равно локальному sqlite, уточнённая политика).
  **Документируемый риск (HITL):** unmasked-имена веток (free-text: коды/ticket-ID) на стороннем сервере при
  централизованном бэкенде — теперь **дефолт** для confidential-проектов. **Операционное предупреждение:**
  init-warn `unmasked_branch_metadata` при централизованном бэкенде + непустых `confidential.paths`
  (имя ветки, минующее `sanitize()`, уходит на сервер); warn дублируется в выдаче `@maestro-memory`
  (диагностика без логов, §10.4). `memory.mainline` — только локальные git-команды, машину не покидает.
- **Recall-тиры ≠ clearance:** видимость записи не становится механизмом доверия (SEC §5a).
- **`merged=0 AND head=''` (unattributed) не промоутируется** и виден только в `scope: project` (§2, §5, §6.1);
  quick-path запись на mainline с `head=''` легитимно является `merged=1`/general (строка 1 таблицы §6.1).
- **Squash/rebase-loss (dangling head)** — документированное ограничение (§2, §5).
- **Prompt-injection:** experience-записи проходят тот же framing; остаточный класс без дельты.
- **Промоция** не раскрывает raw-confidential: `merged` — бинарный project-state, производный от git-факта.

Инварианты сохраняются: маскирование контента (title/summary/decisions) до записи (raw-confidential никогда
не в памяти), key-scoping удалений, zero-dep гейт, `messages.transform === undefined`, hooks global try/catch,
derived-поля вне scan/export (branch/head/merged — легитимные метаданные, не derived). **`centralized_confidential`
удалён (v3 cross-cutting, §9) — `storage.type` = единственное решение локально/удалённо.**

## 10. Cross-cutting изменения (pending)

1. `manual_docs/reference/memory.md` — секция branch-aware memory (тиры, промоция, scope, squash-ограничение,
   риск unmasked-метаданных на centralized, **удаление `centralized_confidential`**, mainline авто-детект +
   `mainline_unresolved` диагностика + gitflow-guidance: override `memory.mainline` = develop/main + fork-caveat);
   **внутри: строка диагностики «Бэкенд недоступен (qdrant/pg) … не молчаливый fallback (кроме
   `centralized_confidential`)» — убрать последнюю оговорку**.
2. `manual_docs/reference/config.md` — ключи `branch_context`/`mainline` + **удаление `centralized_confidential`**.
3. `skills/maestro-assistant/SKILL.md` — config-канон (новые ключи + валидация + удаление ключа).
4. `manual_docs/how-to/enable-memory.md` — `disabled_reason` (`branch_context_invalid`/`mainline_invalid`;
   `centralized_confidential_invalid` убирается), описание тиров, **`mainline_unresolved`**
   (flat-fallback + warn + как диагностировать), **`unmasked_branch_metadata` warn продублирован в выдаче
   `@maestro-memory`** (диагностика без логов), **удаление `centralized_confidential`**.
5. `SECURITY.md` §5a — жёсткий инвариант «raw confidential + секреты не уходят на сервер»; санизированное не
   блокируется; **`storage.type` — единственное решение локально/удалённо; `centralized_confidential` удалён**;
   риск unmasked git-метаданных. **Внутри: второе упоминание в буллете `memory_export` («прецедент
   `centralized_confidential`: default stay-local») — переформулировать на инвариант §9.**
6. `manual_docs/overview/changelog.md` — запись v3 (включая config-guidance: squash-флоу → `branch_context: false`;
   **удаление `centralized_confidential`**).
7. `docs/testing/maestro-sandbox-checklist.md` — **F12** (commit-scoped recall: стек видит базу, имя-реюз не
   контаминирует), **F13** (промоция после мержа — head-based), **F14** (scope=project override), **F15**
   (мульти-проект на centralized: промоция одного проекта НЕ затрагивает другой — кейс Critical-1),
   **F16** (heal: mainline+merged=0 → merged=1 после резолва mainline). Pre-v3 sqlite sibling, mainline-unresolved
   flat+warn, **degraded-механика `mainline_unresolved` + явный `scope:"branch"`**, и **fallthrough шага 2
   (remote HEAD → локальное существование → шаг 3, кейс `git clone -b <ветка>`)** покрываются unit-тестами
   по образцу `storage.test.js`.
8. `docs/project-context.md` §5 — branch-aware модель + **явное «`centralized_confidential` удалён»**.
9. `plugins/maestro-bootstrap/README.md` + blurb в `AGENTS.md` — branch-aware (по конвенции v2/v3a);
   **внутри README: failover-строка лога, `centralized_confidential_invalid` в списке `disabled_reason`,
   ключ в примере конфига и буллет семантики ключа (failover + warning) — убираются**.
10. **`manual_docs/explanation/agents-and-trust.md`** — буллет «Гейт централизованных бэкендов
    (`centralized_confidential: forbid` … failover)» заменить формулировкой жёсткого инварианта §9:
    маскирование — гарантия (raw+секреты не на сервере); санизированное не блокируется; `storage.type` —
    единственное решение; риск unmasked git-метаданных (по AGENTS.md sync-правилу).
11. **`manual_docs/reference/model-selection.md`** — убрать упоминание `centralized_confidential` (~стр. 169;
    синхронно с §10.5).
12. **`skills/maestro-new/SKILL.md`** — удалить инструкцию «`centralized_confidential`: всегда `forbid`» —
    иначе maestro-new будет генерировать мёртвый ключ в `maestro.json` новых проектов.
13. **`commands/maestro-memory.md`** — шаблон вывода (разбивка по тирам §7; дублируемые диагностики
    `disabled_reason` §8 и `unmasked_branch_metadata` §9/§10.4). По AGENTS.md: изменение commands →
    sync в manual_docs (п.4).

## 11. Изменения контекста (pending)

`docs/project-context.md` §5 — описание branch-aware модели (тиры/промоция/scope). §14 не меняется.

## 12. Вне scope

- **Ручная очистка мёртвых данных (v4-бэклог, требование HITL):** команды «список устаревших данных по
  веткам» (dead: `merged=0` и `head` не достижим из HEAD и не из mainline — «не в контексте») и «удаление
  данных по ветке» (branch-фильтр для `memory_forget`/deleteByFilter). Примитив уже существует
  (`memory_forget` — deleteByFilter); в v3 не входит.
- **As-of запросы** («контекст на коммит Y») — требует хранения временной оси истории; v4-кандидат
  (head сохраняется, но не индексируется для as-of в v3).
- Автоматическая пометка squash-мержей (эвристика сверки) — неточная, отложена.
- Per-account RBAC — server-side, вне плагина (не меняется).
- Гранулярность decisions (отдельные вектора) — не связана, остаётся в бэклоге.

<!-- maestro:sanitize -->
status: CLEAN
date: 2026-09-07
hash: ad39d3dbff9a7ede685b7fa80d91aa5a1ed71fea977f74bb257c171cac2fd9e2

<!-- maestro:review -->
reviewer: opus
date: 2026-09-07
verdict: approve
hash: ad39d3dbff9a7ede685b7fa80d91aa5a1ed71fea977f74bb257c171cac2fd9e2