# Maestro Sandbox — Checklist тестирования

Ручной QA-чеклист для прогона сценариев в песочнице (`.sandbox/`). Сгенерировано `maestro-sandbox.sh create`.

**Источник:** Приложение A в `specs/spec-revise-consolidated-plan.md` (этот файл — автономная копия для QA).

**Порядок:** по возрастанию сложности (A → E). Отмечайте результат: ✅ прошёл · ❌ не прошёл · ⚠️ риск-контроль (не assert).

**Обозначения:** ✅ позитив · ❌ негатив/альтернатива · ⚠️ probe/risk.

---

## A. Базовые / конфигурационные
| # | Сценарий | Тип | Проверка | Результат |
|---|---|---|---|---|
| A1 | Рефейм: custodian существует, design отсутствует | ✅ | `agents/custodian.md` есть; `rg "design"` в субагент-контекстах = 0 | |
| A2 | Юнит-тесты плагина | ✅ | `npm test` зелёные (после рефейма) | |
| A3 | Built-in confidential: `.env` deny | ✅ | primary/non-trusted не читают `.env`/ключей (юнит-тест Task 2b) | |
| A4 | Built-in: `confidential.paths` расширяет built-in | ✅ | пользовательский путь не заменяет built-in | |
| A5 | Маркер `из confidential` не маскируется sanitizer | ✅ | тест в index.test.js (S10) | |
| A6 | Маркер не ломает sanitize (не ложное срабатывание) | ❌ | маркер не вызывает false-positive маскирование | |
| A7 | Un-trusted custodian/sanitizer — юнит-тесты плагина | ✅ | `npm test` покрывает `trust.custodian: false` / `trust.sanitizer: false` (confidential deny + prompt sanitize). Парный с D7/D8 | |

## B. Подготовка спецификации / brainstorm
| # | Сценарий | Тип | Проверка | Результат |
|---|---|---|---|---|
| B1 | Brainstorm Architectural: primary грузит superpowers:brainstorming | ✅ | канон (вопросы/подходы/дизайн→approval), пишет spec | |
| B2 | Custodian отвечает по confidential агрегатами | ✅ | тип/ограничение/чувствительность, без значений | |
| B3 | Custodian НЕ раскрывает raw-значения | ❌ | «какой пароль?» → агрегат, не значение | |
| B4 | Маркер `из confidential` ставится primary | ✅ | primary помечает секции (по пометкам custodian) | |
| B5 | **S3 риск-контроль:** primary искажает агрегат custodian | ⚠️ | **НЕ тест, а риск-контроль** (детерминизм LOW): проверить отсутствие обратной сверки custodian + sane spec; документированный accepted risk | |
| B6 | Brainstorm: пользователь управляет длиной | ✅ | продолжить/упростить/стоп (OQ-11, без жёсткого потолка) | |
| B7 | Простая фича ↔ Bounded | ✅ | короткий дизайн в чате → SDD без plan-дока | |
| B8 | Spike: feasibility | ✅ | рекомендация, throwaway-код, mini-pre-flight, без spec/plan/мержа | |

## C. Revise-цикл
| # | Сценарий | Тип | Проверка | Результат |
|---|---|---|---|---|
| C1 | opus (untrusted) ревьюит очищенный spec | ✅ | не получает raw-confidential | |
| C2 | opus-правки → primary применяет (Edit, Ур.1 Слой 5) | ✅ | правка применяется, Ур.1 фильтрует | |
| C3 | opus не читает confidential | ❌ | нативный deny (read/glob/grep) + audit-лог `confidential.access` | |
| C4 | Повторный 8.6 НЕ запускается на opus-цикле (OQ-2) | ✅ | полный прогон sanitizer не повторяется | |
| C5 | Повторный 8.6 при trusted-контуре (особый случай a) | ✅ | custodian-участие → полный 8.6 | |
| C6 | **Особый случай (маркер):** правка по `из confidential`-секции → HITL → custodian | ✅ | **уточнение по маркированным данным через custodian, не primary**. Парный с D6 (обязательный security-набор). Маркер-детект формален, не эвристика | |
| C7 | Плато «2 раунда без новых Critical/Important → HITL» | ✅ | OQ-4 сходимость | |
| C8 | Новая Critical на 3-м раунде обнуляет плато | ✅ | счётчик сбрасывается | |
| C9 | Повторяющиеся не-закрытые замечания не «новые» | ✅ | плато наступает при повторах | |
| C10 | HITL Approve → writing-plans (шаг 11) | ✅ | после подтверждения → план | |
| C11 | HITL Revise → снова opus-правки; Reject → стоп | ❌/граница | ветки гейта шага 10 | |
| C12 | Подписи stale после правок → 8.6/9 перезапуск | ✅ | hash-инвалидация, re-entry | |
| C13 | fast-track re-entry (7d-вход): 8.6 выполняется всегда; 9 предлагается всегда через HITL (a)/(b); HITL-заверение → skip 8.6 только при валидной `CLEAN`; `FINDINGS_ACCEPTED` → 8.6 всегда | ✅ | подпись = рекомендация, не авто-пропуск | |

## D. Безопасность (выделенный)
| # | Сценарий | Тип | Проверка | Результат |
|---|---|---|---|---|
| D1 | opus не получает raw-confidential в запросе | ✅ | Слой 2 маскирование + audit-лог | |
| D2 | primary не читает `.env`/`secrets/` | ✅ | confidential deny (built-in + конфиг) | |
| D3 | custodian агрегаты без значений/токенов/номеров | ✅ | assert/audit | |
| D4 | Утечка через bash/glob/grep | ❌ | гейт-0, bash-permissions (плагин не покрывает — ручная проверка) | |
| D5 | trusted-opus (B-5): гарантии сняты → предупреждение | ❌ | при `trust.opus=true` — предупреждение | |
| D6 | **Маркер-driven (негатив):** правка по `из confidential`-секции НЕ применяется молча | ❌ | обязателен HITL (не silent). Парный с C6. Маркер-детект формален, не эвристика, не обходится «синтаксической согласованностью» | |
| D7 | Un-trusted custodian: `trust.custodian: false` → confidential deny | ❌ | custodian не читает `docs/confidential/**` и `.env`; промпт санизируется; агент **non-functional** (не fallback). Проверить audit-лог `confidential:deny`. Юнит-тест: Task 1, Step 2-4 | |
| D8 | Un-trusted sanitizer: `trust.sanitizer: false` → промпт санизируется (рекурсия) | ❌ | промпт sanitizer маскируется Ур.1 до него → не видит raw для пометки; агент **non-functional**. Проверить `sanitizer.redacted` в логе. Юнит-тест: Task 1, Step 5 | |

## E. Интеграция команд/скилов
| # | Сценарий | Тип | Проверка | Результат |
|---|---|---|---|---|
| E1 | `/maestro-design`: шаг (a) → primary brainstorm + custodian + primary пишет spec | ✅ | переработанный флоу | |
| E2 | **S6:** User Review Gate = шаг 10 (не двойное одобрение) | ✅ | **проверка документации/порядка шагов** (структурная, не поведенческий smoke) | |
| E3 | Доставка в app-репо (S2) | ✅ | custodian/trust/model в целевом приложении | |
| E4 | superpowers-скиллы не изменены | ✅ | `git status` на `.opencode/skills/` чист | |
| E5 | Memory layer smoke | ✅ | `- [ ] Memory layer smoke: unit-тесты памяти зелёные (sqlite backend, memory_search tool, session.idle → storage; интеграция registerMemoryHooks).` | |

## F. Memory layer — реальный прогон (Bun/opencode)

> Ручная проверка в реальном opencode-сессии с включённой памятью. Все шаги — в sandbox-проекте. Отметьте результат: ✅ прошёл · ❌ не прошёл · ⚠️ риск-контроль (не assert).

> **Подготовка qdrant-проекта:** пересоздайте песочницу с флагом qdrant:
> `./maestro-sandbox.sh --reset --qdrant` (создаст `.sandbox/docker-compose.yml`,
> настроит `memory.storage.type: "qdrant"` + `namespace`/`identity` в sandbox
> `maestro.json`, ключ `MAESTRO_MEMORY_QDRANT_KEY` в `.env`). Затем поднимите
> бэкенд: `cd .sandbox && docker compose up -d`; в `module_dir` памяти выполните
> `npm install` (добавляет `@qdrant/js-client-rest`) и перезапустите opencode (OP-1).
> Остановка: `docker compose down` (данные сохранены в volume `qdrant_data`).

| # | Сценарий | Тип | Проверка | Результат |
|---|---|---|---|---|
| F1 | `maestro.json` → `memory.enabled: true` | ✅ | в sandbox `maestro.json` есть `memory.enabled: true`; `memory.storage.type: "sqlite"` (или задан qdrant/pgvector); `module_dir` указан или резолвится | |
| F2 | deps установлены в `module_dir` | ✅ | в `module_dir` есть `node_modules` с `better-sqlite3` (или `@qdrant/js-client-rest` / `pg`); `npm install` выполнен без ошибок | |
| F3 | opencode сессия → запрос | ✅ | запущен `bun opencode` в sandbox; пользователь сделал запрос (например, «напомни, о чём мы говорили»); сессия не упала с error memory | |
| F4 | `memory.db` создан | ✅ | `<data-dir>/maestro/memory/<key-hash>/memory.db` существует; `sqlite3 memory.db ".tables"` показывает `memory` | |
| F5 | `memory_search` возвращает результат | ✅ | вызов `memory_search` (или через `@maestro-memory`) возвращает записи (или «Ничего не найдено» — если база пуста); без crash | |
| F6 | `@maestro-memory` показывает статус | ✅ | вызов `@maestro-memory` возвращает статус памяти (число записей, кластеры и т.д.); без crash | |
| F7 | `memory_forget` триггерит ask-подтверждение | ✅ | вызов `memory_forget` вызывает ask-gate (в TUI появляется запрос подтверждения); permission `ask` запрашивается через merge-config | |
| F8 | `@maestro-memory-report` генерирует HTML-агрегаты | ✅ | вызов отчёта памяти возвращает агрегированный HTML/текст с кластерами, статистикой, графом; без crash | |
| F9 | pgvector hybrid | ✅ | pgvector-проект в sandbox; `memory_search` с текстовым `query` возвращает лексические совпадения (ts_rank); без crash | |
| F10 | qdrant hybrid | ✅ | qdrant-проект в sandbox (`--reset --qdrant` + `docker compose up -d`); `memory_search` с `query` возвращает full-text совпадения через RRF; без crash | |
| F11 | sqlite cross-project | ✅ | sqlite-проект; `memory_search { project: <сосед> }` возвращает записи соседа read-only; `origin_project_hash` в выдаче (провенанс); без crash | |
| F12 | commit-scoped recall | ✅ | стек веток видит базу; переиспользование имени ветки НЕ контаминирует контекст; без crash | |
| F13 | промоция после мержа | ✅ | ветка влита в mainline + `git pull` → записи становятся general (merged=1) на следующем init | |
| F14 | scope=project override | ✅ | `memory_search { scope: "project" }` возвращает все записи ключа (плоско) | |
| F15 | мульти-проект на centralized | ✅ | промоция одного проекта НЕ затрагивает записи другого (key-scoped) | |
| F16 | heal (mainline_unresolved окно) | ✅ | записи транка, написанные при нерезолвнутом mainline, промоутятся после резолва | |

---

## Завершение QA
- [ ] Все сценарии A–E отмечены.
- [ ] Security-проверки (D) чистые.
- [ ] `./maestro-sandbox.sh --clean` (удаление `.sandbox/` с фиктивными данными).