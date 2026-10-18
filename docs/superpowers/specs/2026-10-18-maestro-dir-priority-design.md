# Spec: приоритет `.maestro/maestro.json` выше корневого `maestro.json` (свап слоёв 2/3 резолва)

**Основание:** пользователь (Plan mode + `@maestro-init -aa`, 2026-10-17/18): «У конфигурации
`maestro.json` в папке `.maestro/` приоритет должен быть выше, чем у конфига в корне проекта» +
«по аналогии с конфигурацией `opencode.json`» (иерархия OpenCode: `.opencode/` — project-level —
приоритетнее корневого конфига) + «жестко» (без новых ключей конфига).

## 1. Контекст и проблема

### 1.1 Текущее состояние (6.0.0)

Резолв `maestro.json` — 4 слоя (канон: `manual_docs/reference/config.md`, реализация:
`plugins/maestro-bootstrap/core.js` → `resolveConfigFile`/`loadMaestroConfig`, зеркало в
`plugins/maestro-bootstrap/memory/backup-cli.js`):

| # | Слой | Путь |
|---|---|---|
| 1 | `MAESTRO_CONFIG` (env) | произвольный путь — **debug-only**, полный override, другие слои не проверяются |
| 2 | Проектный (командный) | `<project>/maestro.json` — в git |
| 3 | Проектный (локальный) | `<project>/.maestro/maestro.json` — вне git |
| 4 | Глобальный (машинный) | `~/.config/opencode/.maestro/maestro.json` — XDG-aware |

Активный файл = **первый парсируемый** среди 2 → 3 → 4 (сломанный JSON слоя → warning + переход
к следующему, fail-soft). Non-`memory` ключи — **replace** из активного файла (файлы не
мержатся); `memory.*` — **soft-merge** активного с глобальным слоем (база merge — всегда global).

Историческое обоснование порядка (spec 2026-10-16, Q3): «root = зафиксированное в репозитории —
самое приоритетное. Улучшает предсказуемость для команд: "что в git — то и действует"».

### 1.2 Боль

Порядок «root выше `.maestro/`» противоречит иерархии, к которой разработчик привык по
OpenCode: более глубокий/специфичный каталог (`.opencode/`) имеет приоритет над корневым
конфигом. Для `maestro` это означает: локальный (per-machine, вне git) файл `.maestro/`
должен переопределять командную фиксацию в корне — «своё локальное победляет
закоммиченное».

### 1.3 Цель

Свапать приоритет проектных слоёв: `.maestro/maestro.json` > `<project>/maestro.json`.
Слои env (1) и global (4) — без изменений. Семантика «первый парсируемый» и hybrid-merge
(non-memory replace / `memory.*` soft-merge с global) — без изменений.

### 1.4 Границы

- **В scope:** свап порядка в резолвере (`core.js`; `backup-cli.js` — только display-строки,
  логика делегирована) + тесты + синхронизация 8 живых документов + warn в `/maestro-setup`
  (project-режим) + D-проверка порядка слоёв в `docs-drift.test.mjs` + версия 6.1.0
  (bump на шаге 18).
- **Out of scope:** мерж проектных файлов (replace сохраняется); новые ключи конфига;
  смена мест записи `/maestro-setup`; изменение `memory.*`-merge с global; исторические
  документы (changelog-записи прошлых версий, `docs/superpowers/specs/**`, `specs/**`,
  `TODO.md`) — не переписываются; конфиги `opencode.json` (это OpenCode, не maestro).

## 2. Дизайн-решения

| # | Вопрос | Решение | Обоснование |
|---|---|---|---|
| Q1 | Диапазон свапа | Только проектные слои: `.maestro/` ↔ root. Env — остаётся высшим (полный override), global — остаётся низшим (база memory-merge) | Пользователь: «приоритет выше, чем у конфига в корне проекта» — только пара root/.maestro/; env/global — отдельные механизмы (debug override / машинные дефолты) |
| Q2 | Механизм | Жёстко в резолвере: переупорядочивание `candidates`-массива. Без ключей конфига | Пользователь: «жестко» (аналогия с OpenCode, где иерархия зашита) |
| Q3 | Parse-error fallback | Механика без изменений: цепочка теперь `.maestro/` → root → global; warning на каждый сломанный слой, порядок warning-ов следует новому порядку | Сохраняет fail-soft-поведение 6.0.0; только порядок проверки меняется |
| Q4 | `memory.*` soft-merge | Без изменений: база merge — глобальный слой; `enabled`/`embedding.model` — активный ?? глобальный ?? default; `namespace` — только активный (project-слой) | Глобальный слой остаётся самым низким; механизм ортогонален порядку проектных слоёв |
| Q5 | `/maestro-setup` (project-режим) при существующем `.maestro/maestro.json` | **Warn-строка** в выводе setup (не блокирует): «`.maestro/maestro.json` существует — имеет приоритет над root (с 6.1.0): non-memory ключи (включая trust/confidential/sanitizer_whitelist) и memory.namespace берутся из него; если в `.maestro/` нет namespace, а в root есть — память будет выключена (namespace_missing)». Плюс уточнение формулировки «namespace уже задан» → «в любом проектном слое» | HITL-решение (a) на brainstorm: защита от «тихой» потери эффекта записанных в root ключей (включая trust-политику и namespace памяти), без extra-гейта |
| Q6 | Guard против дрейфа порядка в доках | Новая D-проверка в `maestro-install/docs-drift.test.mjs` (следующий номер после D8): порядок строк таблицы слоёв в `manual_docs/reference/config.md` и `manual_docs/explanation/agents-and-trust.md` — строка слоя 2 содержит `.maestro/maestro.json`, строка слоя 3 — корневой путь | HITL-решение (a) на brainstorm; прецедент D6–D8 (6.0.0): детерминированный контроль докового дрейфа в `npm test` |
| Q7 | Версия | **minor 6.1.0** (bump на шаге 18 после merge) | Правила версионирования `project-context.md` §3: новая фича / процессное правило — minor; breaking major не требуется (semver: изменение порядка конфига задокументировано, минор) |

## 3. Дизайн

### 3.1 Резолвер (`plugins/maestro-bootstrap/core.js`)

`resolveConfigFile(root, globalDir)` — основная точка изменения:

```js
const candidates = [
  path.join(root, ".maestro", "maestro.json"),  // слой 2 (был 3): локальный, вне git
  path.join(root, "maestro.json"),              // слой 3 (был 2): командная фиксация, в git
  path.join(globalDir ?? resolveGlobalDir(), "maestro.json"), // слой 4 — без изменений
];
```

- `MAESTRO_CONFIG` (env) — early return без изменений (верхний слой, полный replace).
- Цикл `tryReadJson` (первый парсируемый + warning при сломанном JSON) — без изменений.
- `loadMaestroConfig` — **без изменений** (active + `globalBase` + `memory.*` merge).
- Блоком-комментарий над резолвером (слои «от высшего к низшему») обновить на новый порядок
  с новыми подписями: 2 — «локальные дополнения (вне git; более специфичный — приоритетнее,
  аналогия `.opencode/` > корневой конфиг)», 3 — «командная фиксация (в git)».
- **`isMaestroConfigPath` (core.js ~498–513)** — второй `candidates`-массив с тем же
  порядком + комментарий «MAESTRO_CONFIG > root > .maestro > global». Поведение НЕ меняется
  (membership-проверка пути, не приоритет), но порядок массива и комментарий обновить на
  новый — чтобы не задрейфил (находка spec review).

### 3.2 Зеркало (`plugins/maestro-bootstrap/memory/backup-cli.js`)

Резолв **делегирован** `resolveConfigFile` из `core.js` (строка ~222) — логических изменений
НЕ требуется. Меняются только display-поверхности, где порядок зашит текстом: HELP-текст
(~57–58), комментарий (~219–221) и `checked`-список в error «не найден ни в одном слое»
(~225–229). Паритет порядка с `core.js` — обязательный инвариант фичи (CLI и плагин должны
резолвить одинаково; прецедент 6.0.0: «4-слойный резолв, синхронный с плагином»).

### 3.3 Тесты (`plugins/maestro-bootstrap/index.test.js`)

- Обновить существующие ассерты порядка резолва (там, где зашит старый порядок root → .maestro/;
  точки: тест «root beats .maestro and global» (~2680), тест «broken root JSON → .maestro»
  (~2734), header-комментарии ~2620/2769, тест fallback `loadMaestroConfig` ~2899 — его
  преамбула устареет: результат остаётся `.maestro/`, но это уже primary-хит, а не fallback).
- Новые/дополненные unit-кейсы:
  1. Оба проектных файла существуют (разные значения non-memory ключа) → активен `.maestro/`,
     ключ из `.maestro/`.
  2. Только root → активен root.
  3. Только `.maestro/` → активен `.maestro/`.
  4. `.maestro/` со сломанным JSON + валидный root → активен root + warning (fail-soft).
  5. Оба сломаны + валидный global → активен global + warning-ы на оба проектных слоя.
  6. `MAESTRO_CONFIG` задан → полный override, проектные слои не читаются (regression-проверка
     нетронутого механизма).
  7. `memory.*` soft-merge с global-базой — без изменений (regression-проверка).
- Parity `backup-cli.js`: в `backup-cli.test.js` есть тест «не найден ни в одном слое»
  (~27–43) — ассерты там order-независимы (`includes`); оставляем как regression без
  изменений (CLI покрывается V7 вручную).

### 3.4 `/maestro-setup` (project-режим) — warn при обоих файлах

- Перед созданием/записью root `maestro.json` (project-режим): если существует
  `<root>/.maestro/maestro.json` — вывести одну warn-строку (русский, не блокирует):
  > `⚠ .maestro/maestro.json существует — имеет приоритет над root (с 6.1.0): non-memory ключи
  > (включая trust/confidential/sanitizer_whitelist) и memory.namespace берутся из него.
  > Если в .maestro/ нет memory.namespace, а в root есть — память будет выключена
  > (reason: namespace_missing).`
- Уточнить формулировку пункта про namespace: «Если namespace уже задан в
  `root/maestro.json` — не перезаписывает» → «Если namespace уже задан явно в любом
  проектном слое (`.maestro/maestro.json` или root) — не перезаписывает».

### 3.5 Документация (8 живых файлов)

Все изменения — свап порядка/номера слоёв 2↔3, формулировки-подписи («локальный, вне git —
приоритетнее: более специфичный каталог» / «командная фиксация, в git»):

| # | Файл | Что менять |
|---|---|---|
| 1 | `manual_docs/reference/config.md` | Таблица 4 слоёв: строки 2/3 меняются местами (номера сохраняются: 2 = `.maestro/`, 3 = root); блок «Активный файл = ПЕРВЫЙ ПАРСИРУЕМЫЙ слой (порядок 2 → 3 → 4)» — без изменений (номера); таблица путей (~950–952: строка root — перенумерация) |
| 2 | `manual_docs/explanation/agents-and-trust.md` | Таблица слоёв (строки 2/3) — свап; «`.maestro/maestro.json` — слой 3» (~113) → «слой 2»; «root выигрывает» (~75) — свап формулировки; trust-семантика (~105): «Проектный слой (root `maestro.json`) коммитится в git — trust-level policy проекта» → переформулировать: источник эффективной trust-политики — **активный проектный слой**; с 6.1.0 это `.maestro/maestro.json` (вне git), если он существует, иначе root (в git); коммит в git — больше не фактор приоритета |
| 3 | `skills/maestro/SKILL.md` | Gate 0: порядок цепочки `root → .maestro/ → global` → `.maestro/ → root → global`; подписи слоёв |
| 4 | `plugins/maestro-bootstrap/README.md` | «Разрешение конфигов (resolution order, 4 слоя)»: нумерованный список — свап пунктов 2/3; перечисление (~558–559) «(`<project>/maestro.json`, `<project>/.maestro/maestro.json`) имеют приоритет» — косметический свап (`.maestro/` первым) |
| 5 | `manual_docs/how-to/memory-backup-restore.md` | Цепочка `env > root > .maestro/ > global` → `env > .maestro/ > root > global` |
| 6 | `manual_docs/how-to/customize-maestro.md` | Цепочка 4 слоёв — свап |
| 7 | `skills/maestro-setup/SKILL.md` | Уточнение формулировки namespace (3.4); таблица режимов (root vs .maestro/) — без изменений (место записи) |
| 8 | `manual_docs/explanation/plain-language.md` | Прозаическая цепочка активного файла (~16): «root → `.maestro/` → global» → «`.maestro/` → root → global» (находка builder check) |

**Не трогаем (исторические снимки):** `manual_docs/overview/changelog.md` (запись 6.0.0),
`docs/superpowers/specs/2026-10-16-maestro-global-install-design.md`, `specs/**`, `TODO.md`.
Новая запись changelog появится в секции 6.1.0 на шаге 18 (bump) — она обязана описать:
(a) новый порядок слоёв; (b) следствие: источник эффективной trust/confidential/sanitizer-
политики — теперь `.maestro/` (если существует); (c) `memory.namespace` — из активного
файла (если namespace в root, а в `.maestro/` нет — память выключена, `namespace_missing`).

### 3.6 D-проверка порядка слоёв (`maestro-install/docs-drift.test.mjs`)

Новая проверка (следующий свободный номер после D8; далее — «D9»). Две части:

1. **Положительная** (таблицы): для `manual_docs/reference/config.md` и
   `manual_docs/explanation/agents-and-trust.md` — в таблице 4 слоёв строка слоя 2 содержит
   `.maestro/maestro.json`, строка слоя 3 — корневой `maestro.json` (без префикса `.maestro/`).
   Механика — regex по строкам таблицы (аналог существующих D-проверок).
2. **Отрицательная** (проза): в живых доках, где порядок описан цепочкой, старый порядок
   «root выше `.maestro/`» не должен встречаться: в наборе
   {`manual_docs/reference/config.md`, `manual_docs/explanation/agents-and-trust.md`,
   `manual_docs/explanation/plain-language.md`, `manual_docs/how-to/customize-maestro.md`,
   `manual_docs/how-to/memory-backup-restore.md`, `plugins/maestro-bootstrap/README.md`,
   `skills/maestro/SKILL.md`, `skills/maestro-setup/SKILL.md`} — отсутствие паттерна цепочки,
   где корневой слой стоит ПЕРЕД `.maestro/` (формы: `root … → .maestro/`,
   `root … > .maestro/`, нумерованный список root-пункт перед .maestro/-пунктом).
   **Exclusion-list (исторические снимки):** `manual_docs/overview/changelog.md` (записи
   прошлых версий), `docs/superpowers/specs/**`, `specs/**`, `TODO.md`,
   `docs/superpowers/plans/**` — не проверяются.

3. **Self-тесты D9** (прецедент D6–D8, fixture-блок ~661–727): fixture-кейсы —
   положительный хит (таблица с верным порядком проходит; с неверным — fail) и
   отрицательный miss (цепочка старого порядка в живом доке → fail; та же цепочка в
   `changelog.md` (excluded) → pass).

Дрейф порядка = failing test в `npm test`.

> **Запись оркестратора (builder check):** `plain-language.md` найден проверкой и включён в
> scope (запись §3.5-8 + отрицательная часть D9) — решение оркестратора (minor-PILE: вытекает
> из целей V8/Q6 «не дать порядку задрейфить в живых доках»), не требовало HITL.

## 4. Файлы фичи (diff-поверхность)

1. `plugins/maestro-bootstrap/core.js` — свап candidates + комментарий
2. `plugins/maestro-bootstrap/memory/backup-cli.js` — display-строки (HELP, комментарии, `checked`-список)
3. `plugins/maestro-bootstrap/index.test.js` — тесты
4. `skills/maestro/SKILL.md` — Gate 0
5. `skills/maestro-setup/SKILL.md` — warn + формулировка namespace
6. `manual_docs/reference/config.md` — таблица слоёв + номера
7. `manual_docs/explanation/agents-and-trust.md` — таблица слоёв + «слой 3»→«слой 2»
8. `manual_docs/explanation/plain-language.md` — прозаическая цепочка активного файла
9. `plugins/maestro-bootstrap/README.md` — resolution order
10. `manual_docs/how-to/memory-backup-restore.md` — цепочка
11. `manual_docs/how-to/customize-maestro.md` — цепочка
12. `maestro-install/docs-drift.test.mjs` — D9

(12 файлов; changelog/version — на шаге 18, вне фичи-диффа.)

## 5. V-критерии

| # | Критерий | Как проверяется |
|---|---|---|
| V1 | Оба проектных файла → активен `.maestro/` (non-memory replace) | unit (3.3-1) |
| V2 | Только root → root; только `.maestro/` → `.maestro/` | unit (3.3-2/3) |
| V3 | `MAESTRO_CONFIG` — полный override, без изменений | unit (3.3-6) |
| V4 | Parse-error fallback: `.maestro/` сломан → root; оба → global; warning-ы по порядку | unit (3.3-4/5) |
| V5 | `memory.*` soft-merge с global-базой — без изменений | unit (3.3-7) |
| V6 | Паритет резолва `backup-cli.js` с `core.js` (порядок слоёв) | код-сверка + V7 |
| V7 | `backup-cli.js`: порядок слоёв в error-сообщении «не найден ни в одном слое» и HELP-тексте — новый (ручной smoke: запустить CLI в каталоге без конфигов) | manual |
| V8 | 8 живых доков: во всех `.maestro/` выше root; D9 (положительная + отрицательная) green | `npm test` (docs-drift) |
| V9 | `npm test` зелёный (plugin tests + docs-drift + coverage) | `npm test` |
| V10 | `/maestro-setup` project-режим с существующим `.maestro/maestro.json` — warn-строка, не блокирует | manual/sandbox |

## 6. Риски и митигации

| Риск | Митигация |
|---|---|
| Проекты с обоими файлами и конфликтующими значениями получат другой эффективный конфиг | Это и есть цель фичи; minor-версия + changelog 6.1.0 с явным описанием нового порядка; warn в setup (Q5) снижает риск «тихой» потери |
| **Инверсия trust-модели:** источник `trust`/`confidential.paths`/`sanitizer_whitelist` смещается с git-tracked root на untracked `.maestro/` — локальный файл вне git может повысить untrusted-агента до trusted, изменить confidential-маски, ослабить sanitizer-whitelist — без следа в git-истории | Осознанное решение пользователя («жестко», аналогия OpenCode); прецедент: `MAESTRO_CONFIG` env уже давал локальный полный override. Митигации: явная changelog-запись (b); Q5 warn в setup (покрывает trust/confidential/sanitizer_whitelist — это non-memory ключи); переформулировка trust-семантики в agents-and-trust.md (§3.5-2). `SECURITY.md` — **не меняется**: он не кодирует порядок слоёв (P6 — маскирование активного пути, «любой из 4 слоёв» — остаётся верным) |
| **Смена memory-bucket:** если в двух проектных файлах разные `memory.namespace` — после свапа выигрывает namespace из `.maestro/` → `deriveProjectKey` даст другой ключ → существующие записи станут невидимы для recall; если в активном `.maestro/` нет `namespace`, а в root есть — эффективный namespace = null → память выключена (`namespace_missing`) | Changelog 6.1.0 с явным пунктом (c): «при наличии обоих файлов проверьте `memory.namespace` в `.maestro/maestro.json`»; Q5 warn в setup. Данные не теряются (старый бакет остаётся в БД) — только recall промахивается; восстановление — вернуть namespace в `.maestro/` |
| Дрейф порядка в одном из двух резолверов (core/backup-cli) | Паритет-тесты (V6) + code-review; оба резолвера меняются одной задачей плана |
| Дрейф порядка в документах (8 файлов) | D9 (Q6) — детерминированный guard в `npm test` |
| Исторические документы продолжают описывать старый порядок | Осознанно: снимки момента (changelog-записи, прошлые спеки); текущий порядок — в живых доках + changelog 6.1.0 |
| `isMaestroConfigPath` (P6 confidential) — зависит от порядка? | Нет: маска по резольвированному активному пути (любой слой) — порядок не влияет; regression-проверка тестами P6 (без изменений) |

<!-- maestro:sanitize
status: CLEAN
date: 2026-10-18
hash: ba1eb9b3a66e005a8436a165078f6ac9b64be1a98991dc49d415b474244e4750
-->

<!-- maestro:review
reviewer: opus
date: 2026-10-18
verdict: approve
hash: ba1eb9b3a66e005a8436a165078f6ac9b64be1a98991dc49d415b474244e4750
-->
