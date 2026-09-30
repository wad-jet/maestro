# Spec: скилл `maestro-memory` — канон промтов команд `@maestro-memory*` (4.15.0)

**Дата:** 2026-09-30 · **Ветка:** `feature/maestro-memory-skill` (от `e346a23`, 4.14.1)
**Категория:** Средняя · **Режим:** auto-ai · **Дизайн:** утверждён HITL (plan mode: структура «ядро + 5 references», версия 4.15.0) + Opus-ревью GO WITH FIXES (коррективы I-1…I-4, M-1…M-7 встроены)

## Контекст / проблема

Промты 5 команд memory layer (`@maestro-memory` — 141, `-report` — 225, `-prune` — 41,
`-reindex` — 81, `-backup` — 39 строк) лежат в `commands/maestro-memory*.md`. Самая
динамичная (часто переписывавшаяся) часть — гейт доступности (классификация
`disabled_reason`, `memory_probe`-
диагностика, bash-fallback запрещён) — размазана: полная копия в `maestro-memory.md`
(шаг 1.2), частичная реимплементация в `-report` (шаг 1), а в `-prune`/`-reindex`/
`-backup` — **висячие ссылки** «см. `@maestro-memory`»: команду нельзя «загрузить»
внутри другой, поэтому агент в off-состоянии импровизирует.

## Решение

Новый скилл `maestro-memory` (паттерн `maestro-benchmark`: тонкая команда → скилл;
референсы — паттерн скелета `skills/maestro/` с 4.14.0):

1. **`skills/maestro-memory/SKILL.md` — ядро** (бюджет ≤ 120 строк, гвард в тесте):
   - frontmatter: `name: maestro-memory`, description **нейтральный к автозагрузке**
     (анти-триггер, прецедент OP-5): «Канон промтов команд `@maestro-memory*`
     (статус/отчёт/prune/reindex/backup). Загружается командами; из пайплайна
     maestro не загружается»
   - язык-правило (все сообщения пользователю — русский)
   - **«Гейт доступности»** — одна канон-копия с **устойчивой нумерацией пунктов
     (1.1, 1.2, …)** = якорь для references: `maestro_config`-гейт (недоступен →
     «Перезапустите opencode / обновите плагин maestro-bootstrap (≥ 4.9.0)»,
     дистинкция по `.maestro/plugin-version`; **конфиг НЕ читать — bash-fallback
     запрещён**), секция `memory` читается **один раз, union полей:
     `memory.enabled`, `memory.storage.type`, `memory.module_dir`** (module_dir —
     для sqlite-fallback отчёта). **Порядок гейта — config-first (как в report):**
     `maestro_config`-гейт → union-чтение секции `memory` → проба
     `memory_stats_detail`. `references/status.md` шаг 2 переформулируется: «из секции, прочитанной
     гейтом» (повторное чтение конфига запрещено — один `ask` в happy-path);
     таблица дефолтов остаётся в status.md. Полная классификация `disabled_reason`,
     `memory_probe`-диагностика (off-состояние при `embedder_probe_hard_fail`
     и по `FAIL` в статусе)
   - **Порядок: гейт до reference-флоу** (fail-fast): память off → основной
     reference-флоу **не выполняется**; из `references/<x>.md` читается **только
     off-секция**. Конвенция: **off-секция — первая секция каждого reference**
     («Если память off / плагин недоступен»), до основных шагов
   - **off-сообщения НЕ в ядре:** ядро определяет состояние (enabled/disabled +
     reason-код), финальное off-сообщение выводит **off-секция reference** своей
     команды. Для status/report — текущая формулировка (вывод не меняется;
     расхождение формулировок между ними сохраняется как есть — Non-goals).
     Для prune/reindex/backup (текущей формулировки нет) — шаблон: «выведи
     причину по reason-коду из гейта + рекомендацию по исправлению (включая
     `memory_probe`-диагностику при `embedder_probe_hard_fail`)»
   - SEC-4b — одно общее правило (агрегаты-only); enforcement-детали остаются в
     `references/report.md` (без дубля)
   - таблица указателей: команда → `references/<файл>.md` + правило «тела команд —
     тонкие лоадеры, канон в командах не дублируется»
2. **`skills/maestro-memory/references/`** — 5 файлов из тел команд:
   `status.md`, `report.md`, `prune.md`, `reindex.md`, `backup.md`. Правила переноса:
   - **внутренняя нумерация шагов в каждом файле сохраняется** (валидность ссылок
     «Шаг 1a», «в Шаге 3.5», «Шаг 5/6» внутри report.md) — перенумерация запрещена
   - **переприцелинка:** «@maestro-memory шаг 1.2» / «как в @maestro-memory» →
     «Гейт доступности, п. 1.2 (ядро скилла)»; «см. `@maestro-memory`» (prune/
     reindex/backup) → «гейт доступности (ядро скилла)»; «@maestro-memory
     показал…» → «команда `@maestro-memory` показала…»
   - **квалификация имени везде:** «команда `@maestro-memory*`» vs «скилл
     `maestro-memory`» (имя получает 4-е значение в репо: команда, скилл,
     сервис-сессия `[maestro-memory]`, модуль плагина)
3. **5 `commands/maestro-memory*.md` → тонкие лоадеры** (~10 строк, паттерн
   `commands/maestro-benchmark.md`): frontmatter **без изменений** (description
   — имя/вывод не меняется); тело — императив: «Загрузи skill `maestro-memory`
   (tool: skill). Сначала — гейт доступности (ядро). Затем читай и следуй
   `references/<x>.md` из каталога скилла» — **свой** references-файл называется
   явно в теле команды (минус один хоп через таблицу ядра).
4. **Доставка + гварды:**
   - `maestro-install/agpack.yml` + корневой `agpack.yml`: `path: skills/maestro-memory`
   - **targeted-тест** — `maestro-install/commands-skill-coverage.test.mjs`
     (в `npm test`): каждая из 5 команд содержит `maestro-memory` (скилл) + свой
     `references/<x>.md` (файл существует) + скилл зарегистрирован в обоих
     agpack.yml (без общего резолвера «любая команда → любой скилл»). Маппинг:
     `maestro-memory` → `status.md`, `maestro-memory-report` → `report.md`,
     `maestro-memory-prune` → `prune.md`, `maestro-memory-reindex` → `reindex.md`,
     `maestro-memory-backup` → `backup.md`
   - **мини-guard** — `skills/maestro-memory/references-coverage.test.mjs`
     (в `npm test`, аналог `skills/maestro/references-coverage.test.mjs`):
     указатели ядра резолвятся (5 references существуют), сирот нет, ядро
     ≤ 120 строк
   - `package.json` — оба новых теста добавить в список `scripts.test`
5. **Доки:**
   - `manual_docs/reference/commands.md` — 5 секций: +пометка «реализация — скилл
     `maestro-memory`, `references/<x>.md`» (формулировка по прецеденту
     `@maestro-assistant`, commands.md:132)
   - `AGENTS.md` — линия `skills/maestro-memory/` по образцу `maestro-benchmark`
   - `manual_docs/overview/changelog.md` — 4.15.0, **честная формулировка:**
     «единый канон-гейт доступности + резолвимые кросс-ссылки + дедуп» (НЕ
     «меньше контекста» — per-invocation контекст команды РАСТЁТ на ядро;
     выигрыш — относительно наивного единого SKILL.md ~570 строк и дедуп
     самого динамичного гейта)
   - TODO/roadmap: при закрытии п.81 — пометка, что #107 (review-by-artifact-type)
     сдвигается на следующую минорную (4.16.0)
6. **Валидация:**
   - `npm test` (258 + новые тесты)
   - **one-shot парити-скрипт** (эфемерный, `.maestro/parity/parity-check.mjs`,
     не коммитится; методология 4.14.0): **base = `e346a23:commands/maestro-memory*.md`**
     (5 файлов), **target = ядро ∪ 5 references ∪ 5 лоадеров**; классификация
     MISSING-строк: (1) гейт→ядро; (2) переприцеленные ссылки; (3) шапки/
     frontmatter → лоадеры; (4) glue-строки тонких лоадеров; (5) дедуп в ядро
     (язык-правило ×5 → 1 строка; повторное чтение секции `memory` в status шаг 2
     → single-read гейта); (6) нормализация нумерации гейта «1./1.2./3.» →
     «1.1/1.2/1.3»; **0 ошибок**; результат (N base-строк, M исключений, 0
     ошибок) фиксируется в regression entry
   - **`[Manual]` dogfood (обязателен до закрытия TODO:81):** post-merge + push +
     `agpack sync` — ≥2 команды (status + report), включая off-путь (ветвление
     гейта на практике)
7. **Regression entry** `regression/entries/2026-09-30-maestro-memory-skill.md`:
   риск LOW; file-в-файл маппинг; результат паритета; примечание: grep-цель
   no-bash-fallback сценария `2026-09-24-maestro-config-read-tool.md` смещается с
   `commands/*.md` на `skills/maestro-memory/**` (для будущих прогонов `@regression`)

## Known cross-skill dependency (осознанная)

`references/report.md` (шаг preview) использует `skills/maestro/preview-http-server.cjs`
(дуальная резолция `.opencode/skills/…` / `skills/…` уже реализована). Оба скилла
доставляются из одного источника одним sync.

## Non-goals

- Изменения плагина (`plugins/maestro-bootstrap/`), инструментов памяти — НЕТ
- Изменения пайплайна maestro (`skills/maestro/SKILL.md`, `references/memory-layer.md`),
  SECURITY.md, permissions — НЕТ
- Изменения имён команд, frontmatter, **выводных форматов** — НЕТ (off-сообщения
  status/report сохраняют текущие формулировки в своих references)
- Починка дрейфа доков (`manual_docs/reference/memory.md:801` обещает строку
  «Каталог данных: <path>» в выводе `@maestro-memory`, которой нет в шаблоне) —
  переносим как есть; починка — отдельной задачей
- Переименования/алиасы — НЕТ

## Риски и митигации (из Opus-ревью)

| Риск | Митигация |
|---|---|
| Комплаенс-потеря (агент не прочитает reference) | явный императив в теле команды + «свой файл» назван прямо (прецедент benchmark отработан) |
| Ядро раздувается | бюджет ≤120 строк — детерминированный guard в `npm test` |
| Сломанные cross-refs при переносе | устойчивая нумерация гейта (якорь) + запрет перенумерации внутри references + переприцелинка + парити-скрипт |
| sqlite-fallback отчёта сломается (module_dir) | гейт читает union полей {enabled, storage.type, module_dir} |
| Команда → несуществующий скилл (инцидент-класс 4.13.0, зеркало) | targeted-тест в `npm test` |
| Окно push→sync в целевых | доставка атомарна (одна синка); до sync работают старые самодостаточные команды |

## Версионный bump (шаг 18)

`4.14.1 → 4.15.0` (minor: новый компонент — скилл; прецеденты maestro-benchmark
4.13.0, memory-backup 4.7.0). Файлы: `package.json`, `package-lock.json`,
`docs/project-context.md` §3, `manual_docs/overview/changelog.md` (секция 4.15.0).
`AGENTS.md:7` («~1160 строк, 4.14.1») — **НЕ менять** (исторический маркер
состояния скелета maestro, а не версия проекта). Конфликта версий нет
(grep «4.15» по репо пуст); #107 получает 4.16.0.

## Sweep кросс-ссылок (чек-лист)

После переезда: `grep -rn 'см. \`@maestro-memory\`\|@maestro-memory шаг' commands/
skills/` (кроме 5 лоадеров) → **0 живых** (исторические `docs/superpowers/**`,
`specs/` не трогаются по канону). README.md список скиллов — НЕ расширять
(исторически неполный: без assistant/feedback-report/benchmark) — non-goal.
