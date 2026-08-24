# План: конфигурация моделей тиров агентов — без корневого opencode.json и git-истории (без обратной совместимости)

> Статус: **утверждено, реализация не начата**.
> Репо: `maestro-agent` (authoring). Целевое применение — целевое приложение.
> Дата: 2026-08-24.
> Правило: планируем и реализуем **без обратной совместимости** с прежним
> вариантом (корневой `opencode.json`, git-история). Исторические spec-планы не
> трогаем; живой код и `manual_docs` приводим к единому целевому паттерну.

## Постановка

В текущей архитектуре конфигурация моделей агентов в целевом приложении привязана
к **корневому `opencode.json`** («Регистрация плагина + модели сабагентов», в git:
Да — `manual_docs/reference/config.md:553`), а каскад предложения в M1
(`/maestro-init`) содержит источник «git-история» (`skills/maestro-init/SKILL.md:158`).

Анализ:

1. **Git-история — мёртвый источник.** Модели агентов — персональное предпочтение
   (`manual_docs/tutorials/setup-project.md:214`); в целевой модели они не
   коммитятся → в истории никогда нет `agent.*` → источник исключается из M1.
2. **Корневой `opencode.json` избыточен.** Плагин живёт глобально; модели —
   локально или глобально. Корневой файл не нужен.
3. **`.opencode/` — вне git.** Доставка скилов/агентов/команд не через git
   (`skills/maestro/SKILL.md:1456` — вручную/agpack) → `.opencode/` целиком в
   `.gitignore` (аналог `.maestro/`, `config.md:561`). gitignore не влияет на
   чтение скилов в рантайме.

## Целевая модель (целевое приложение) — единственный паттерн

- **Корневой `opencode.json` = НЕТ** (`/maestro-init` не создаёт; не упоминается
  как источник).
- **Плагин `maestro-bootstrap` → глобальный** `~/.config/opencode/opencode.json`
  (**рекомендуемый**); допустим также `.opencode/opencode.json` (`.opencode/`
  гитignore'd — плагин там не воспроизводимая опция, поэтому global в
  приоритете). Гейт не зависит от места плагина.
- **Модели тиров агентов →** локально `.opencode/opencode.json` (gitignored)
  **или** глобально — оба легитимны.
- **`.opencode/` целиком — в `.gitignore`** приложения.
- **`maestro.json` — в git** (маркер гейта; не гитignore). При gitignored
  `maestro.json` гейт бы не срабатывал (маркер отсутствует → пропуск → fail-open),
  поэтому он остаётся в репозитории (N10).
- **Global-конфиг обязателен** для воспроизводимого D2/M1 в клоне (локальные
  модели gitignored; `provider.*.models` и `agent.*` иначе недоступны).

**Итоговый каскад M1:**
```
.opencode/opencode.json (project) → global (~/.config/opencode/opencode.json) → tier-подсказка
```
(«git-история» удалена. Корневой `opencode.json` не участвует.)

## Ревью-решения (2026-08-24)

Решения сгруппированы по темам. Оригинальные коды (C/V/N/P/Q) сохранены для
трассируемости.

### Группа A — Место конфигурации (где живут модели/плагин)

- **C1.** Конфиг моделей — в `.opencode/opencode.json` **или** глобально
  (не в корневом `opencode.json`).
- **N1.** Плагин — global (**рекомендуемый**), допустим также
  `.opencode/opencode.json`; гейт не зависит от места (снимает противоречие C2/I1).
- **I1.** Для проверки плагина искать его в **merge-конфиге**
  (`~/.config/opencode/opencode.json` → `.opencode/opencode.json`) — но решение
  принимает **только** `.maestro/logs`.
- **I2.** Модели сабагентов резолвит opencode из merge-конфига при Task-dispatch;
  файлы (`SKILL.md:815-821`) — документация для справки, а не источник чтения.
- **N10.** `maestro.json` — маркер гейта — **коммитится в git** (не гитignore).
  При gitignored `maestro.json` гейт бы не срабатывал (маркер отсутствует →
  пропуск → fail-open).

### Группа B — Плагин-гейт

- **C2.** Гейт опирается **только на `.maestro/logs`** (свежесть записи
  `plugin initialized` ≤ 24ч) — без проверки файла-конфига. Устойчив к любому
  месту плагина.
- **V1.** Гейт продублирован в трёх скиллах (`maestro/SKILL.md:14-29`,
  `maestro-design/SKILL.md:14-36`, `maestro-feedback-report/SKILL.md:14-41`).
  C2 применяется **ко всем трём** (шаг 2 «проверка файла» убрать, оставить
  шаг 3 `.maestro/logs`).
- **R2.** Единая формулировка свежести (≤24ч) в переформулировке гейта во всех
  местах (3 скилла + `agents-and-trust.md:188-190`).

### Группа C — ИБ

- **I4.** ИБ-принципы (`SECURITY.md`): fail-closed, trust по имени, P1-P5
  **не меняются**; ИБ-инвариант «без плагина confidential fail-open» сохраняется
  (жёсткий STOP при неактивном плагине).
- **P1.** Фактологическая ссылка `SECURITY.md:21` на `opencode.json →
  agent.{name}.model` → переформулировать на merge-конфиг (`.opencode/opencode.json`
  или global); суть ИБ не трогая.
- **N11.** На клоне без плагина: жёсткий STOP остаётся. Новый разработчик **обязан
  установить плагин** до работы; вариант «без плагина» не допускается.

### Группа D — Bootstrap/клонирование

- **N9.** `agpack sync` покрывает только скиллы/команды/агенты и **НЕ доставляет**
  плагин и конфиги (`maestro.json`, `.opencode/opencode.json`, `.gitignore`) —
  обязателен `/maestro-init`. Порядок: «клонировал → agpack sync → `/maestro-init`».
- **M4.** При отсутствии доступных моделей на клоне (нет global, локальные
  gitignored): **soft** — HITL-предупреждение + ручной ввод ID. Не блокирует.
  Защита от невалидных ID — «плейсхолдеры запрещены» (`SKILL.md:141`).
- **V6.** D2: для клона нужен global с `provider.*.models` (иначе кандидатов нет,
  D2 → ручной ввод, согласуется с M4-soft). Уточнить в SKILL.md D2.

### Группа E — Скоуп правок (живые файлы)

- **V2.** `maestro-design/SKILL.md:91,155` — наследование/настройка моделей.
- **V3.** `manual_docs/explanation/agents-and-trust.md:47,120,190`.
- **V4.** `manual_docs/how-to/update-maestro.md:22`.
- **N2.** STOP-сообщение «добавить spec в `opencode.json`» (`maestro/SKILL.md:35`,
  `maestro-design/SKILL.md:35`, `maestro-feedback-report/SKILL.md:35`).
- **N3.** `maestro/SKILL.md:776` (как справка, аналогично `:900`).
- **N4.** `setup-project.md:211` (temperature).
- **N5.** `model-selection.md:8,57,68`.
- **P2.** `plugins/maestro-bootstrap/README.md:287` — установка плагина.
- **P3.** `AGENTS.md:22`.
- **P4.** `manual_docs/reference/commands.md:37,50,84`.
- **P5.** `manual_docs/overview/quick-start.md:17`.
- **P6.** `README.md:109`.
- **P7.** `skills/maestro-init/init-context.md:145`.
- **Q1.** `commands/test-agents.md:16` — упрощение (убрать `opencode.json`,
  оставить `maestro.json`).
- **Q4.** `AGENTS.md:23` (историч. gotcha rename) → merge-конфиг.
- **R1.** `plugins/maestro-bootstrap/README.md` — править секцию установки
  **целиком** (`:282-325`), не только `:287-295`.
- **R4.** `manual_docs/tutorials/setup-project.md` — прогонять **весь файл** на
  `opencode.json` при реализации, не только перечисленные строки.

### Группа F — JSON-код-блоки и фактология

- **Q2.** JSON-блоки установки плагина (`plugin README:287-295`,
  `config.md:353-374`): переформулировать с явным целевым файлом (global —
  реком. / `.opencode/opencode.json`), не только окружающий текст.
- **Q3.** `config.md:353-374` — то же (целевой файл в `{"plugin":[...]}`).
- **Q5.** `plugins/maestro-bootstrap/core.js`, `index.js` **не изменяются** —
  плагин `opencode.json` не читает (`core.js:291-301`; читает только
  `maestro.json`).

### Группа G — Исторические/исключения

- **P8.** `manual_docs/overview/changelog.md` — историческая фиксация: **не
  правим**, в исключения grep-проверки.
- **R3.** `TODO.md:27` — открытая задача (не историческая): добавить в исключения
  grep-проверки (решается этим планом).

## Объём правок

### Часть 1 — удалить «git-история» из каскада M1

1. `skills/maestro-init/SKILL.md:155-158` — убрать `git-история →`; каскад
   `project (.opencode/opencode.json) → global → tier`.
2. `manual_docs/reference/model-selection.md:80-81` — то же в user-facing описании.
3. `manual_docs/tutorials/setup-project.md:82-83, 94-97` — убрать git-историю в
   Варианте B (особенности + шаги); перенумеровать оставшиеся два.

**Не трогать** (историческая запись): `specs/maestro-init-tasks-plan.md`,
`specs/global-tier-models-plan.md`, `manual_docs/overview/changelog.md` (P8).

### Часть 2 — отказ от корневого `opencode.json`

| Файл:строка | Сейчас | Станет |
|---|---|---|
| `skills/maestro-init/SKILL.md:135-141` | init регистрирует плагин в корневой `opencode.json` | Плагин — глобально; корневой `opencode.json` не создавать |
| `SKILL.md:155-158` (M1) | `project opencode.json → global` | `project = .opencode/opencode.json` |
| `SKILL.md:193-199` (D2) | уровни: `opencode.json (project)` | переформулировать; отметить: для клона нужен global с `provider.*.models`, иначе ручной ввод (V6) |
| `SKILL.md:201-210` (.gitignore) | игнорировать `.maestro/` | + `.opencode/` целиком |
| `SKILL.md:209` | `maestro.json` «рядом с opencode.json» | «в корне проекта» |
| `skills/maestro/SKILL.md:14, 19-22` | гейт: шаг 2 читает `opencode.json → plugin`, шаг 3 — `.maestro/logs` | гейт = **только** шаг 3 (`.maestro/logs`, свежесть `plugin initialized` ≤ 24ч); шаг 2 (проверка файла) убрать |
| `skills/maestro/SKILL.md:35`, `skills/maestro-design/SKILL.md:35`, `skills/maestro-feedback-report/SKILL.md:35` | STOP-сообщение «добавить spec в opencode.json» | «в global `~/.config/opencode/opencode.json` (или `.opencode/opencode.json`)» (N2) |
| `skills/maestro-design/SKILL.md:14-36`, `skills/maestro-feedback-report/SKILL.md:14-41` | тот же гейт (дубль шага 2 «проверка файла») | то же, что для `maestro/SKILL.md`: шаг 2 убрать, оставить `.maestro/logs` (V1) |
| `skills/maestro/SKILL.md:776, 810-821, 900, 974` | `opencode.json → agent.*.model` | пометить как справку: модель резолвится opencode из merge (`.opencode/opencode.json` или global) (N3: +776) |
| `skills/maestro-design/SKILL.md:91, 155` | «модели наследуются из `opencode.json`» / «настроить agent.* в opencode.json» | «из `.opencode/opencode.json` или global» (V2) |
| `skills/maestro-assistant/SKILL.md:26, 128` | редактирует `opencode.json` | источник = `.opencode/opencode.json` или global |
| `skills/maestro-init/SKILL.md:248-253` (Задача 5) | «плагин подключён в `opencode.json` и загружается» | «подключён в merge-конфиге (global / `.opencode/opencode.json`)» (V5) |
| `plugins/maestro-bootstrap/README.md:282-325` | секция установки: «Добавьте spec в `opencode.json`» (корневой) + JSON-блок `{"plugin":[...]}` + «перезапустите opencode» | секция целиком: «в global `~/.config/opencode/opencode.json` (реком.) или `.opencode/opencode.json`»; JSON-блок с явным целевым файлом (P2, Q2, R1) |
| `AGENTS.md:22, 23` | «registration lives in app's `opencode.json`»; историч. gotcha про rename (`opencode.json keys`) | plugin — global / `.opencode/opencode.json`; корневой `opencode.json` отсутствует; :23 — на «`agent.*.model` в merge-конфиге» (P3, Q4) |
| `SECURITY.md:21` | «Модель — атрибут имени (`opencode.json → agent.{name}.model`)» | «(`agent.*.model` в merge-конфиге: `.opencode/opencode.json` или global)» (P1) |
| `skills/maestro-init/init-context.md:145` | «`opencode.json` → `agent.*` (модели, M1)» | синхронизировать с SKILL.md M1 (P7) |
| `commands/maestro-init.md:13`, `maestro-assistant.md:12`, `maestro-design.md:8` | упоминания `opencode.json` (плагин/модели/«наследует из opencode.json») | синхронизировать: плагин → global; модели → `.opencode/opencode.json`/global; `/maestro-design` «наследует из `.opencode/opencode.json` или global» |
| `commands/test-agents.md:16` | «Не читай конфиги (`opencode.json`, `maestro.json`)» | упростить: убрать `opencode.json` из списка, оставить `maestro.json` (файл-не источник) (Q1) |
| `manual_docs/reference/config.md:7, 346, 353-374, 553` | «opencode.json: плагин+модели, git: Да»; JSON-блоки `{"plugin":[...]}` | → «.opencode/opencode.json (или global): плагин+модели; git: Нет»; корневой `opencode.json` отсутствует; JSON-блоки с явным целевым файлом (Q3) |
| `config.md:382-394` (гейт) | `opencode.json → plugin` + `.maestro/logs` | гейт = **только** `.maestro/logs` (свежесть `plugin initialized` ≤ 24ч); зависимость от файла-конфига снять |
| `config.md:480-492` (D2) | уровни | под новую структуру |
| `manual_docs/explanation/agents-and-trust.md:47, 120, 190` | «maestro.json рядом с opencode.json» / пермишены / «гейт: наличие в opencode.json → plugin» | «в корне»; пермишены в `.opencode/agents/*.md`; гейт = только `.maestro/logs` (V3) |
| `manual_docs/how-to/update-maestro.md:22` | «agpack не покрывает конфиги (maestro.json, opencode.json)» | «не покрывает плагин и конфиги (maestro.json; модели — `.opencode/opencode.json`/global)» (V4) |
| `manual_docs/reference/commands.md:37, 50, 84` | `opencode.json` (плагин/модели/структура) | переформулировать под новый паттерн (P4) |
| `manual_docs/overview/quick-start.md:17` | «Модели агентов настроены в `opencode.json`» | «в `.opencode/opencode.json` или global» (P5) |
| `README.md:109` | «agpack не покрывает конфиги (…, opencode.json, …)» | «не покрывает плагин и конфиги (maestro.json; модели — `.opencode/opencode.json`/global)» (P6) |
| `manual_docs/tutorials/setup-project.md` | примеры корневого `opencode.json`; :211 «нет значения в opencode.json» | примеры `.opencode/opencode.json` + global; `.gitignore` включает `.opencode/`; :211 переформулировать; **весь файл** прогнать на `opencode.json` (N4, R4) |
| `manual_docs/reference/model-selection.md` | «project opencode.json» (:8, :57, :68, :80-81) | переформулировать все вхождения (N5) |

### Применение в целевых приложениях
- `.gitignore` проекта: добавить `.opencode/` (весь) — дополнительно к `.maestro/`.
  `maestro.json` — **в git** (не гитignore).
- Плагин: установить глобально.
- **Bootstrap-порядок (N9):** `agpack sync` → `/maestro-init` (создаёт
  `maestro.json`, `.opencode/opencode.json`, `.gitignore`, устанавливает плагин).
  `agpack sync` сам по себе НЕ достаточен для работы с maestro.
- **Клон без плагина (N11):** жёсткий STOP по гейту `.maestro/logs`;
  обязательная установка плагина до работы. Варианта «без плагина» нет.

## Проверка

- `grep -rn "git-история" skills/ manual_docs/` → ноль в файлах правки (кроме
  исторических spec-планов).
- `grep -rn "opencode.json → plugin"` и проверки гейта через файл-конфиг → ноль
  в живых файлах (гейт — только `.maestro/logs`), **во всех трёх скиллах**
  (`maestro`, `maestro-design`, `maestro-feedback-report`) и в `agents-and-trust.md`.
- `grep -rn "opencode.json" .` (весь репо) → ноль вхождений, где корневой
  `opencode.json` выступает **источником плагина/моделей** (кроме исторических).
  **Исторические исключения (не править):** `specs/*-plan.md`,
  `manual_docs/overview/changelog.md`, `TODO.md:27` (R3). **Допустимые
  generic-вхождения** (не источник, не правятся): YAML-описания
  команд/скиллов (`description:`), диагностика `config.md:180`,
  `config.md:398` («модель в opencode.json» как generic-термин), список-ссылки
  (`index.md:39`, `pipeline-overview.md:159`), `customize-maestro.md:52`. Перечень
  исключений — явно зафиксировать при реализации.
- `SECURITY.md` — ИБ-принципы не изменены; фактологическая ссылка `:21` обновлена
  под merge-конфиг (P1).
- Согласованность: каскад M1 (`.opencode/opencode.json → global → tier`),
  источники плагина/моделей, гейт по `.maestro/logs` во всех скиллах, **единая
  формулировка свежести (≤24ч)** во всех местах гейта (R2).
- `setup-project.md` — весь файл прогнан на `opencode.json` (R4).
- `maestro.json` — в git (не гитignore); при отсутствии гейт бы пропускался.
- Bootstrap-порядок: `agpack sync` → `/maestro-init`; agpack не покрывает
  плагин/конфиги (N9).
- `node --test plugins/maestro-bootstrap/index.test.js` (плагин не меняется,
  контрольный прогон).
- **Плагин `core.js`/`index.js` не изменяются** — `opencode.json` исходником не
  читается (подтверждено `core.js:291-301`; читает только `maestro.json`) (Q5).
- Ручной прогон `/maestro-init` на чистом проекте в `/tmp` (в т.ч. кейс
  «нет доступных моделей» → soft-HITL + ручной ввод).