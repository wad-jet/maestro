# Роадмап maestro-agent

**Текущая версия:** `5.0.0`
**Дата обновления:** 2026-10-04

> Архив закрытых волн и детализированная история — в `git log` и `manual_docs/overview/changelog.md`.

---

## Активные задачи

### Приоритет P0 (закрыто)

~~1. **Баг: `maestro-install.sh` — ошибка при ответе `yes` на вопрос memory layer**~~
   - ✅ **решено (2026-10-04):** `== "y"` → `== y*` (maestro-install.sh:222)

~~2. **Feedback-report: U2 + U3 — починить метрики (разделить active/wait + само-валидация)**~~
   - ✅ **решено (2026-10-04):** `timeline.mjs`: `formatMs()`, `machineActiveMs`, `hitlWaitMs`, `userIdleMs`, `validation` блок; SKILL.md: таблица split active time, self-validation, единый humanizer

~~3. **Feedback-report: U6 + U8 — машиночитаемый слой + сводная таблица ревью-вердиктов**~~
   - ✅ **решено (2026-10-04):** `timeline.mjs`: `reviewCycles[]` (structured: round/titleShort/sessionId); SKILL.md: таблица ревью-вердиктов вместо нарратива, рендер из history.jsonl

### Приоритет P1 (частично закрыто)

4. ~~**Spike: Уточнение `maestro-setup` scope**~~
   - ✅ **решено (2026-10-04):** SKILL.md 545→119 строк, context optional, soft warning вместо HITL, pipeline step 0 не-блокирующий

5. ~~**Feature: `maestro-feedback-report` — U1: пересоздавать отчёт по sessionID**~~
   - ✅ **решено (2026-10-04):** одна сессия = один файл, archive+superseded, пользовательский фидбек verbatim, slice numbering

6. ~~**Feedback-report: U9 — модель агента в таблицах + предупреждение одинаковых моделей**~~
   - ✅ **решено (2026-10-04):** normalizeModel(), models[] per agent, history.jsonl sessionModel/agentsModels, колонки Модель, warnings (наследование, shared model, P4-gigiena)

7. **Feedback-report: U5 — heartbeat аудит-лога (нет событий vs файл не создан)**
   - Impact: HIGH | Feasibility: MEDIUM | Sec: MEDIUM
   - Обоснование: «аудит-лог отсутствует» ≠ «чисто»; ретроспектива confidential не отличает сломано от безопасно
   - Status: spike

8. **Feedback-report: U4 — небlocking фидбек-гейт в auto-режиме**
   - Impact: MEDIUM | Feasibility: HIGH | Sec: —
   - Обоснование: одна строка в шаге 18.5; исторически 3 фидбека трижды меняли продукт, сейчас — 0 после auto-режима
   - Status: spike

9. **Feedback-report: U10 — TL;DR-блок + дедупликация фактуры между секциями**
   - Impact: MEDIUM | Feasibility: HIGH | Sec: —
   - Обоснование: 10-02 — 335 строк; одни и те же 3 бага в 3 секциях; выжимка есть в HITL команды, не в файле
   - Status: spike

### Приоритет P2 (средний)

10. **Spike: Оценка задач в майках (XS–3XL) + токены**
    - TODO.md line 27
    - Impact: MEDIUM | Feasibility: MEDIUM | Sec: —
    - Задача: система оценки размера задачи + контроль расхода токенов + отклонения для feedback-report. Правила оценки — в project-context.md.
    - Status: open

11. **Spike: Пилот миграции существующего проекта**
    - TODO.md line 37
    - Impact: HIGH | Feasibility: LOW | Sec: HIGH
    - Задача: процесс безопасной миграции в confidential/migration для trusted-агентов. Касается maestro-init.sh и команды maestro-init.
    - Status: open

12. **Spike: lite/pro режимы работы**
    - TODO.md line 41
    - Impact: MEDIUM | Feasibility: MEDIUM | Sec: LOW
    - Задача: минимизация участия HITL без потери качества. `communication` (plain/professional) уже решает ~80%.
    - Status: open

13. **Feedback-report: U11 — локальный агрегатор трендов (`@maestro-feedback-trends`)**
    - Impact: HIGH | Feasibility: MEDIUM | Sec: LOW
    - Обоснование: ручная ретроспектива (волны P2.x собирались руками по 36 файлам); агрегаты-only локально — не #99 (отправка отменена)
    - Status: spike

14. **Feedback-report: U7 — per-feature разрез мульти-фичевых сессий**
    - Impact: HIGH | Feasibility: MEDIUM | Sec: —
    - Обоснование: 10-02 — 15 фич в одном отчёте; стоимость фичи не выделяется; границы маркеруются по запускам @maestro-init
    - Status: spike

15. **Feedback-report: U14 — полный счётчик HITL-гейтов (question-тул + текстовые)**
    - Impact: MEDIUM | Feasibility: MEDIUM | Sec: —
    - Обоснование: 09-29: «question-гейтов 3; в диалоге — текстовые гейты B1–B4, гейт 10, #107 (6)» — счётчик занижает в разы
    - Status: spike

### Приоритет P3 (отложить)

16. **Spike: Векторная индексация скилла**
    - TODO.md line 43
    - Impact: HIGH | Feasibility: LOW | Sec: —
    - Задача: SKILL.md → краткий дескриптор; references → векторная БД; семантический поиск по фрагментам.
    - Status: open

17. **Spike: Метрика квалификации пользователя**
    - TODO.md line 35
    - Impact: MEDIUM | Feasibility: LOW | Sec: HIGH (M8 — конфиденциальность HITL)
    - Задача: оценка эффективности HITL по формулировкам, уточнениям, решениям. Требует отдельного spec и security review.
    - Status: open

18. **Feature: Рекомендация `/test-agents` после setup**
    - TODO.md line 23
    - Impact: MEDIUM | Feasibility: HIGH | Sec: —
    - Задача: после maestro-setup рекомендовать прогон теста, оформить в tool, запускать на шаге 0 maestro-init (HITL-разрешение).
    - Status: open

19. **Feedback-report: U12 — время на шаг пайплайна 0–18.5**
    - Impact: MEDIUM | Feasibility: LOW-M | Sec: —
    - Обоснование: нет маркеров шагов в данных; нужна телеметрия шагов (плагин/гейты) или эвристика по гейтам
    - Status: spike

20. **Feedback-report: U13 — уточнить reviewDispatches (child-сессии вместо regex)**
    - Impact: MEDIUM | Feasibility: MEDIUM | Sec: —
    - Обоснование: 09-25: механика 62 vs ~20 фактических; счёт систематически завышен
    - Status: spike

21. **Feedback-report: U15 — метаданные среза: версия/режим/номер**
    - Impact: MEDIUM | Feasibility: HIGH | Sec: —
    - Обоснование: тренды по версиям невозможны; рассинхроны 2.2.0/2.4.0, 4.1.0/4.2.0 в отчётах — ценный сигнал
    - Status: spike

22. **Feedback-report: U16 — дисциплина memory-логирования (канон-строка в момент обращения)**
    - Impact: MEDIUM | Feasibility: HIGH | Sec: —
    - Обоснование: 09-23: «не зафиксировано канон-строкой»; 10-03: обращения без привязки к точке
    - Status: spike

### Приоритет P4 (низкий / cosmetic)

23. **Spike: Команда `/maestro` shortcut**
    - TODO.md line 17
    - Impact: LOW | Feasibility: HIGH | Sec: —
    - Задача: аналог `/maestro-init` для сокращённого ввода.

24. **Spike: `/maestro-analysis` — команда анализа тем**
    - TODO.md line 19
    - Impact: MEDIUM | Feasibility: MEDIUM | Sec: —
    - Задача: анализ рисков, ревью, рекомендации. Режимы: opus solo / opus+sonnet parallel.

25. **Feedback-report: U17 — опечатка «Дольшие» → «Большие»**
    - TODO.md line 17 (в шаблоне SKILL.md)
    - Impact: LOW | Feasibility: HIGH | Sec: —
    - Обоснование: пропагирует во все отчёты с 4.5.0; ловится docs-drift при правке

26. **Feedback-report: U18 — cost: null рендерить «—» один раз или price-map**
    - Impact: LOW | Feasibility: HIGH | Sec: —
    - Обоснование: «cost: — (провайдер без прайсинга)» — мёртвая строка для текущего провайдера

27. **Feedback-report: U19 — канон каталогов external/ и archive/**
    - Impact: LOW | Feasibility: HIGH | Sec: LOW
    - Обоснование: конвенция существует де-факто, не задокументирована; external-отчёты переносились вручную

### Отложенные (backlog)

| Пункт | TODO | Статус |
|---|---|---|
| Гайд GLM/DeepSeek/Qwen | — | backlog |
| Манифест приоритетных технологий (#123) | line 39 | отложено |

### Отменённые

| Пункт | Причина |
|---|---|
| **#106 (5.1): trusted_paths** | value 0/10, не обосновано, revert (2026-10-03) |
| **#99: автоотправка feedback-reports** | небезопасно, перс-данные (2026-10-01) |
| **M1: регулярный memory_export** | нет необходимости (HITL) |

---

## Непокрытые пункты — статус зафиксирован

| TODO строка | Тема | Статус |
|---|---|---|
| 125 (lite/pro-режимы) | out-of-scope | подтвердить осознанно |
| 137 (гайд GLM/DeepSeek/Qwen) | backlog | |
| 154 (реорганизация SKILL.md → `references/*.md`) | **Выполнено** (4.14.0) | |
| 156 (векторная индексация скилла) | backlog | |

---

## Закрытые волны (архив)

### 5.0 (major) — чистка (C1)
- **#91** — back-compat cleanup, #117 simplification (ledger_entry → удалён, patterns → allow_values)
- **L7** — bash 3.2 совместимость (macOS)
- **L9** — `chmod +x` для `maestro-update.sh`
- **L15** — Code Review → Artifact Review (терминология)
- **Результат:** version 5.0.0, 285/285 tests, `npm test` зелёные

### 4.22.0 — sanitizer hardening (#117)
- fail-closed sanitize, валидация whitelist при init
- H-1/H-2/H-3 (3 формы Level-1), H-4/H-5 (fail-closed + валидация)
- pre-work notice, понимания-слой sanitizer_whitelist

### 4.20.0 — HITL question tool (#87)
- вопрос-тул для всех выбор-гейтов
- панель OpenCode (варианты / Escape / free-form)

### 4.19.0 — regression-entries freshness (#103)
- cross-entry reconciliation на шаге ревью

### 4.18.0 — manual_docs readability (#97)
- правила R1–R6, реформат 7 страниц

### 4.17.0 — docs-drift test (#85)
- детерминированный дрейф-чекер в `npm test`

### 4.16.0 — review by artifact type (#107)
- типы `code`/`docs`/`config`/`sql`
- rename `code-reviewer` → `reviewer`

### 4.12.0 — parallel first review (#95)
- sonnet + code-reviewer параллельно

### 4.10.0 — pipeline metrics (#109+#115)
- токены, cost, HITL, retry, Effort

### 4.8.0 — feedback-report modes (#113)
- режимы `auto/manual/disable` в `maestro.json`

### 4.7.1 — fail-loud memory (#77)
- уведомления при недоступности векторной БД

### 4.7.0 — memory backup/restore (#101)
- tools/команды, double-masking, retention

---

## DoD каждой волны

- manual_docs-синк + regression entry + changelog (правила AGENTS.md)
- `npm test` зелёные
- version bump в `package.json` + AGENTS.md + project-context.md
