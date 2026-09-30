# Regression — docs-drift-test (4.17.0)

- **version:** 1
- **feature:** детерминированный дрейф-чекер доков `maestro-install/docs-drift.test.mjs` в `npm test` (4.17.0): 4 проверочных сценария (D1 версии, D2 stale-имена, D3 счётчики строк, D4 статусы roadmap/TODO ↔ changelog). Плагин — без изменений
- **added:** 2026-09-30
- **status:** active
- **risk:** LOW (тест-инфраструктура + 1 правило-строка в AGENTS.md и несколько строк в keep-docs/changelog; плагин не затронут)
- **category:** тест `maestro-install/docs-drift.test.mjs` (в `npm test`), правило в AGENTS.md + keep-docs-up-to-date.md
- **scenarios:**
  - **(auto) `npm test`:** зелёный — `changelog.md` исключён из D1c целиком (история версий); новый текст в `AGENTS.md` не попадает в D1c (AGENTS.md вне D1c-поверхности; D1a — только label-паттерн), STALE_NAMES отсутствуют.
  - **Сценарии детекта (drift planted в fixture):**
    | Сценарий | Механика | Ожидание |
    |---|---|---|
    | D1a — версия в AGENTS.md | метка `(~N строк, X.Y.Z)` в `AGENTS.md` vs version `package.json` | violation (exit 1) |
    | D1b — версия в project-context.md | строка `` `X.Y.Z` (единая для скиллов и плагина`` в `docs/project-context.md` vs version | violation |
    | D1c — stale-версия в manual_docs/README | semver-скан `manual_docs/**` (кроме `changelog.md`) + `README.md` по строкам + allowlist-категории («Миграция (»/«(ex », «не переименовывается», даты «(ГГГГ-ММ», IP, «пример/закрыл/устаревший», скобки-атрибуция, blockquote `^>`) | violation (3 planted в fixture: README 7.7.7, how-to 6.6.6, reference 5.5.5) |
    | D2 — stale-имя поверх | контентный скан STALE_NAMES (`code-reviewer`, `maestro-new`, `maestro-init.sh`, `feature-agent`, `feature-agent-bootstrap`) по строкам поверхностей + allowlist-категории; поиск по именам файлов НЕТ | violation при найденном stale-имени |
    | D3 — счётчик «~N строк» | метка «~N строк» vs `wc -l` ±50 | violation при расхождении |
    | D4 — статус roadmap ↔ changelog | «Выполнено/реализовано (X.Y.Z)» roadmap/TODO ↔ версии changelog | violation при найденном stale-статусе |
  - **реальное репо → 0 plants** — тест зелёный, дрейфа нет
- **regressions:** ⚑1–4 не затрагиваются; тест самодостаточен (0 LLM, детерминирован)
- **links:** changelog `[2026-09-30]` (4.17.0) | AGENTS.md (Gotchas — Docs drift)

## Follow-up

- FU1: семантический дрейф (описание поведения, которого нет в коде) не покрывается — механика только фактические метрики. По первому реальному случаю — эскалация в ручной чек-лист.
- FU2: расширение STALE_NAMES при каждом rename — комментарий в тесте + напоминание в changelog/доках (уже в AGENTS.md Gotchas).
- FU3: D1c маскирует версии в blockquote (`^>`) и скобках-атрибуции (класс реального дрейфа «(сейчас 3.2.0)» не детектируется) — сузить правила или задокументировать ограничение в keep-docs.
- FU4: версии с v-префиксом (`v4.5.0`) невидимы сканеру D1c (`\b` не матчит цифру после `v` — класс FN); D2-категория `→` маскирует строки «старое имя → новое» (осознанно: migration-маркер).

## Dogfooding

Реальный дрейф «сейчас 3.2.0» (README строка 80, при факте 4.16.0) найден при
разработке: task-ревью первого прохода (IMPORTANT) поймало, что черновая
allowlist-категория «сейчас » подгонялась под эту строку (в коммиты не
попала — удалена), версия убрана из README (de0568b). Дрейф-чекер этот
кейс **не** детектирует: строка маскируется allowlist-правилами `^>` (blockquote)
и скобок-атрибуции — подтверждено экспериментом (base-README + HEAD-тест → 0
нарушений). См. FU3.
