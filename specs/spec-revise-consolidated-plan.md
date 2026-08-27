# План: Revise-правки spec через оркестратора по замечаниям untrusted opus

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> Статус: **зафиксирован (все HITL-решения OQ-1…OQ-11 приняты; блокеры сняты), реализация НЕ начата**.
> Дата: 2026-08-26. Репо: `maestro-agent` (authoring).
>
> **Решения HITL (полный свод):**
> - **Вариант A** — opus остаётся `edit: deny`, правки в spec применяет **оркестратор**.
> - opus **untrusted** — работает строго с очищенным spec, без доступа к конфиденциальным данным.
> - **OQ-1** — маркировка provenance + условный HITL по формальным индикаторам.
> - **OQ-2** — повторный полный 8.6 только при вовлечении trusted-контура (на opus-циклах не выполняется).
> - **OQ-3** — Слой 5 = process + accepted risk; `.env`/ключи → built-in confidential (deny для primary, реализуется в этом плане — Task 2b, решение B).
> - **OQ-4** — guard сходимости «2 раунда без новых Critical/Important → HITL».
> - **OQ-5** — spec-follow-up через flow шага 8.5 → план (шаг 11).
> - **Brainstorm** — superpowers:brainstorming у primary (только primary, интерактивные/диалоговые скилы), пути Spike/Bounded/Architectural (spec только при Architectural), без draft, spec пишет primary; `design` переименован в `custodian` (trusted Q/A-брокер по confidential), маркировка provenance на primary, лимит по сходимости.

**Goal:** На Revise-цикле (шаг 10b) отказаться от полного переписывания спецификации доверенным агентом (в прежней модели — `design`, после рефейма — декомпозиция «primary brainstorm + `custodian` Q/A + primary пишет spec»). Вместо этого untrusted `opus` выдаёт структурированные правки, а оркестратор (primary) применяет их к spec инкрементально (Edit), прогоняя через Ур.1 (Слой 5). Обеспечить гарантию отсутствия доступа `opus` и оркестратора к конфиденциальным данным (Слои 2/3 + built-in confidential `.env`/ключи). Для особого случая (правке/вопросу нужен confidential-контекст) — HITL-эскалация с выбором (a) перепоручить trusted `custodian` (Q/A-брокер, отвечает агрегатами без значений) / (b) follow-up.

**Architecture:** На Revise-цикле (шаг 10 = Revise) НЕ выполняется полное переписывание spec доверенным агентом (в прежней модели — `design`, после рефейма — декомпозиция «primary brainstorm + `custodian` Q/A + primary пишет spec»). Оркестратор re-dispatch'ит `opus` (untrusted, `edit: deny`) с обратной связью: предыдущий вердикт + список замечаний + текущий очищенный spec. opus возвращает **структурированные правки** (что заменить/добавить/удалить, ссылки на секции). Оркестратор прогоняет текст правок через Ур.1 (regex-sanitizer плагина, Слой 5) и **инкрементально применяет их к spec** (Edit). На обычных opus-циклах повторный 8.6 **не выполняется** — opus видит только очищенный spec; полный повторный прогон sanitizer нужен **только при вовлечении trusted-контура** (особый случай (a) → правку готовит trusted `custodian` по Q/A-агрегатам, без значений; применяет primary; opus-trusted по B-5) (OQ-2). Если правке/вопросу нужен confidential-контекст (opus не видит его) → по формальным индикаторам (маркировка provenance OQ-1, пометка opus, выход за scope) → HITL: (a) решает trusted `custodian` (Q/A-агрегат) / (b) follow-up / (c) отмена.

**Tech Stack:** Markdown (skill), YAML-frontmatter (agents) + **Node/ESM (плагин `maestro-bootstrap` — built-in confidential, Task 2b), `node:test` (плагнные тесты).**

---

## Файлы

- `skills/maestro/SKILL.md` — шаг 10b (Revise), шаг 8.6 (перезапуск), Trust-матрица/Model Selection (формат правок opus), подписи spec-файла (п.5), Обработка сбоев (строки 1304/1307), HITL Gate Protocol (список gates), добавление HITL-эскалации для особого случая.
- `skills/maestro/spec-review-prompt.md` — формат вывода: структурированные правки + ввод предыдущего вердикта; ограничение opus только очищенным spec.
- `skills/maestro/design-prompt.md` → `custodian-prompt.md` — Q/A-брокер по confidential: отвечает primary агрегатами (без значений) по запросу (первичная подготовка spec, особый случай на Revise). `custodian` НЕ пишет spec (`edit: deny`).
- `agents/design.md` → rename в `agents/custodian.md` (trusted Q/A-брокер).
- `agents/opus.md` — **НЕ меняется** (остаётся `edit: deny`). Пометка-комментарий о роли на Revise (необязательно).
- `plugins/maestro-bootstrap/core.js` + `index.test.js` + `README.md` — **built-in confidential** (`.env`/ключи deny, OQ-3, Task 2b).
- `maestro-sandbox.sh` — скрипт подготовки песочницы (корень репо, коммитится); при `create` выводит путь к чеклисту.
- `docs/testing/maestro-sandbox-checklist.md` — автономный чеклист QA (Фаза 9, вариант b).
- `manual_docs/` — синхронизация по правилу (SKILL.md-изменения → manual_docs).

> Остальные сабагенты (`custodian`, `sanitizer`) — без изменений пермишенов (trusted).

---

## Зафиксированная схема (C/A/D свёрнуто)

База (D) — opus по умолчанию работает только с очищенным spec, без доступа к confidential.
Исключение (C+A) — оркестратор применяет правки молча, если они синтаксически согласованы со spec и не затрагивают **помеченные confidential-фрагменты**; иначе → один простой HITL-выбор:
- (a) правку готовит **trusted `custodian`** (отвечает по confidential агрегатами, без значений), применяет оркестратор (primary) — безопасный путь;
- (b) следствия: **follow-up** на spec-уровне (решать на имплементации) / пропустить;
- (c) отмена.

**Маркировка provenance (OQ-1/OQ-10):** **primary** (а не design) при записи spec помечает фрагменты, основанные на confidential-источнике, **бинарным маркером `из confidential`** (без категории/значений); пометки приходят от trusted `custodian` в Q/A-ответах. Это даёт оркестратору формальный индикатор «правка/вопрос по этой секции требует уточнения» — без знания самих confidential-данных. Маркер ставит primary; sanitizer не вычищает его (не значение).

**Повторный 8.6 (OQ-2):** на обычных opus-циклах (правки untrusted opus + применение оркестратором) повторный полный прогон sanitizer НЕ выполняется — opus видит только очищенный spec. Полный повторный 8.6 нужен только при вовлечении trusted-контура (особый случай (a) → trusted `custodian`; opus-trusted B-5).

Гарантия доступа (зафиксирована, см. анализ):
- Слой 1 — профилактика на источнике (custodian отвечает на Q/A без значений; primary пишет spec; sanitizer помечает).
- Слой 2 — плагин маскирует промпт при диспатче в untrusted (Ур.1, `core.js:1002`).
- Слой 3 — `confidential: deny` для read/write/edit по **всем** `confidential.paths` (не только `docs/confidential/**`; `core.js:932`, `resolveConfidentialAction` → не-trusted всегда deny) **+ built-in набор** (OQ-3): `.env`, `.env.*`, приватные ключи (`*.pem`/`*.key`/`*.crt`/`*.p12`/`*.pfx`) — deny для primary и non-trusted независимо от конфига. `confidential.paths` **расширяет**, а не заменяет built-in.
- Слой 4 — access_policy для `read` вне confidential.
- Слой 5 (НОВОЕ) — оркестратор прогоняет текст правок opus через Ур.1 перед Edit в spec. **OQ-3:** process-требование, enforcement отсутствует; accepted risk при пропуске. Основная защита — Слои 2/3 + built-in confidential (`.env`/ключи — deny для primary).
- Слой 6 — HITL-мост для особого случая (единственный легитимный путь из confidential-контура).

---

## Обоснование

- `custodian` (trusted, бывший `design`) видит полный контекст и отвечает на Q/A по confidential безопасно; spec пишет primary. re-dispatch custodian на каждом Revise вовлекает trusted-контур (полный контекст) на каждой итерации и не нужен, когда замечания правятся из очищенного spec.
- `opus` (untrusted) не должен видеть confidential; правки — через оркестратора (Вариант A), что сохраняет `edit: deny`.
- **О честной оценке стоимости:** на каждом opus-Revise выполняется opus (правки) + opus (повторное ревью); полный повторный sanitizer (8.6) НЕ выполняется (OQ-2) — на чистых opus-циклах на один Ур.2-вызов меньше, чем ранее. Выгода — не в радикальном снижении числа вызовов, а в том, что итерации идут **без вовлечения trusted-контура (custodian) и с контролируемым составом правок** (оркестратор применяет точечные правки opus, а не полную перезапись spec). Стоимость спеки-цикла не должна заявляться как «сильно дешевле».
- Особая необходимость confidential-контекста — не «технический доступ», а процессный мост через HITL: либо перепоручить trusted `custodian`, либо follow-up.
- **S3 (accepted risk):** primary пишет spec из агрегатов custodian, не видя raw-confidential → теоретический риск искажения смысла агрегата при записи. Принят как accepted risk: агрегаты просты (тип/ограничение/чувствительность), искажение маловероятно; контроль — sanitizer (8.6) + маркер provenance. Полная обратная сверка custodian'ом не вводится (перегруз).

---

### Task 1: SKILL.md — шаг 10b (Revise)

**Files:**
- Modify: `skills/maestro/SKILL.md`

- [ ] **Step 1:** Заменить блок шага 10, вариант (b) Revise (строки 343-347).
  Текущий текст:
  ```
  (b) Revise — вернуться к шагу 8, доработать spec, **повторить шаг 8.6
      (security review)**, затем повторный review. Подписи становятся
      stale (hash меняется) → 8.6 и 9 перезапускаются автоматически.
      Перед ре-диспатчем `design` оркестратор вырезает существующие
      `maestro:*` блоки из spec файла (см. «Подписи spec-файла», правило 5).
  ```
  Заменить на:
  ```
(b) Revise — вернуться к шагу 9 (повторный Spec Review); НЕ выполняется полное
    переписывание spec доверенным агентом (в новой модели — декомпозиция
    design→custodian+primary; custodian — Q/A-брокер, не переписыватель).
    Оркестратор re-dispatch'ит `opus` (untrusted) с обратной связью:
    предыдущий вердикт + список замечаний + текущий очищенный spec.
    opus возвращает структурированные правки (заменить/добавить/удалить,
    ссылки на секции). Оркестратор прогоняет текст правок через Ур.1
    (regex-sanitizer плагина, Слой 5) и инкрементально применяет их к spec (Edit).
    Повторный 8.6 на обычном opus-цикле НЕ выполняется (OQ-2): opus видит
    только очищенный spec; полный повторный 8.6 нужен только при вовлечении
    trusted-контура (особый случай (a) → правку готовит trusted `custodian`
    по Q/A-агрегатам, без значений, применяет primary; opus-trusted B-5).
    Затем — повторный Spec Review (шаг 9).
    Подписи становятся stale (hash меняется) → при необходимости 8.6/9
    перезапускаются.
    Если для правки требуется confidential-контекст (opus не видит его) →
    HITL-эскалация (см. ниже «Особый случай»).
  ```

- [ ] **Step 2:** Добавить в шаг 10 (после вариантов) блок **«Особый случай (правка требует confidential-контекста)»**:
  ```
  Оркестратор применяет правки opus молча, если они синтаксически согласованы
  со spec И не затрагивают помеченные confidential-фрагменты. HITL ставится при:
    (1) правка/вопрос затрагивает секцию, помеченную `из confidential`;
    (2) opus явно пометил «требует уточнения контекста»;
    (3) правка ссылается на отсутствующие в spec сущности/поля (выход за scope).
  Вопросы opus обрабатываются отдельно от правок (по паттерну шага 8):
  оркестратор сначала отвечает на те, что покрыты spec; остальные → HITL.
Варианты HITL (и для правок, и для вопросов):
  (a) правку/вопрос решает trusted `custodian` (отвечает по confidential агрегатами,
      без значений; на основе его Q/A оркестратор применяет правку), затем 8.6 + 9;
  (b) зафиксировать как follow-up на spec-уровне (решать на шаге 11/13);
  (c) отмена.
opus и оркестратор НЕ получают confidential-данных; маркер provenance — метаданные
без значений; единственный мост из confidential-контура — вызов trusted `custodian`
(a) по Q/A или HITL-решение (b).
  ```

### Task 2: SKILL.md — шаг 8.6 (перезапуск)

**Files:**
- Modify: `skills/maestro/SKILL.md`

- [ ] **Step 1:** В строке 306-308 «Перезапуск на каждый Revise-цикл» уточнить (OQ-2):
  - 8.6 запускается на **первой** итерации (после первичной записи spec; spec пишет primary по результатам brainstorm + Q/A `custodian`) — полный прогон.
  - На повторных **opus-циклах** (правки untrusted opus + применение оркестратором) 8.6 **НЕ выполняется** — opus видит только очищенный spec, новые real-значения неоткуда; остаётся Ур.1 (Слой 5) при применении правки.
  - Полный повторный 8.6 выполняется **только при вовлечении trusted-контура**: особый случай (a) → trusted `custodian` (мог вновь занести confidential) или opus-trusted (B-5, защита untrusted снята).
  - Формулировка правила подписей/перезапуска приводится в соответствие (не утверждать, что 8.6 всегда перезапускается на любом Revise).
- [ ] **Step 2:** Уточнить поведение sanitizer (Ур.2, trusted-сабагент):
  - Полный формат пометок (`location: <секция/строка>`) используется только в случаях вовлечения trusted (полный 8.6).
  - На обычных opus-циклах Ур.2-сабагент не запускается; защита — Ур.1 (Слой 5) + маскирование входа (Слой 2). Вопрос «полный vs diff» снимается (на opus-циклах прогона нет).

### Task 2b: Плагin — built-in confidential (`.env`/ключи deny, OQ-3, решение B)

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js`
- Test: `plugins/maestro-bootstrap/index.test.js`
- Modify: `plugins/maestro-bootstrap/README.md`

- [ ] **Step 1:** В `core.js` добавить **built-in confidential-набор** по умолчанию (независимо от `confidential.paths`): `{ ".env", ".env.*", "*.pem", "*.key", "*.crt", "*.p12", "*.pfx" }` → `read/write/edit` deny для primary и non-trusted. `confidential.paths` **расширяет**, а не заменяет built-in.
- [ ] **Step 2:** Добавить тесты в `index.test.js`: built-in deny `.env`/ключей; `confidential.paths` расширяет built-in (не заменяет); маркер `из confidential` не маскируется sanitize (S10).
- [ ] **Step 3:** Обновить `README.md` плагина (built-in секция) и `manual_docs/reference/config.md` (при затрагивании).

### Task 3: SKILL.md — Trust-матрица / Model Selection (формат правок opus)

**Files:**
- Modify: `skills/maestro/SKILL.md`

- [ ] **Step 1:** В строке 783 (таблица Tier → тип задачи, строка opus) и строке 794 (step_to_tier, `spec_review`) добавить уточнение: opus на Revise-цикле **выдаёт правки**, а не пишет в файл (`edit: deny` сохраняется).
- [ ] **Step 2:** В строке 826-830 (раздел permissions) подтвердить: opus остаётся `edit: deny`; правки применяет оркестратор.
- [ ] **Step 3:** Оговорить поведение, если `opus` указан **trusted** в `maestro.json` (`trust.opus: true`):
  - В этом случае Слои 2 (маскирование промпта) и 3-5 (confidential-deny/access_policy/Ур.1) **не действуют** для opus (trusted → skip sanitize + skip file access control; SKILL.md:956). opus получает промпт как есть и доступ к файлам по конфигу.
  - Это **осознанное решение конфигурации** (пользователь расширил доверие). План не запрещает, но должен явно отметить: при trusted-opus гарантия «opus не видит confidential» снимается. Рекомендация для безопасности — не помечать opus trusted; при необходимости — фиксировать в maestro.json с пониманием последствий.

### Task 4: SKILL.md — Подписи spec-файла (п.5) и Обработка сбоев

**Files:**
- Modify: `skills/maestro/SKILL.md`

- [ ] **Step 1:** Строка 1270, п.5 «Stale-клир»: переформулировать — вырезание `maestro:*` блоков актуально только при первичном Q/A-вызове `custodian` (шаг 8) и при особом случае (a); на обычном Revise-цикле ре-диспатч `custodian` не происходит.
- [ ] **Step 2:** Строки 1304 и 1307 (Обработка сбоев «Spec gate: revise» / «Spec review: revise»): заменить «re-dispatch `design`» на «re-dispatch `opus` для правок, оркестратор применяет их; при необходимости confidential-контекста — HITL (a) trusted custodian / (b) follow-up».
- [ ] **Step 3:** Проверить стыковку с fast-track (шаг 7d) и правилами подписей 5-6 (SKILL.md:1266-1274):
  - **Fast-track re-entry:** правило 3 (Stale-детект) остаётся рабочим для новой схемы — любая правка spec (через opus+оркестратора) меняет hash → подпись stale → при повторном входе в maestro (re-entry) 8.6/9 перезапускаются. Это ОК и не требует изменения правила 3; зафиксировать в плане, что новая схема совместима с re-entry.
  - **Правило 5 (Stale-клир)** — уже покрыто Step 1: вырезание `maestro:*` перед Q/A-вызовом `custodian` остаётся только для первичного формирования spec и особого случая (a); на обычном Revise opus-цикле не применяется.
  - **Правило 6 (Revise-loop)** — формулировка «spec правится → подписи stale → 8.6 и 9 перезапускаются» остаётся валидной; правка spec теперь идёт через opus+оркестратора, а не через custodian. Убедиться, что текст правила 6 не противоречит новой схеме (дополнить упоминанием оркестратора как исполнителя правок).
  - В строке 243-248 (fast-track, проверка подписей): не менять логику, но убедиться, что описание не противоречит новой схеме — при необходимости добавить пометку «review-подпись ставится при Approve (шаг 10), правки до этого — через opus+оркестратора».

### Task 5: SKILL.md — HITL Gate Protocol (список gates)

**Files:**
- Modify: `skills/maestro/SKILL.md`

- [ ] **Step 1:** В перечень gates (строки 585-596, feature) добавить гейт «Особый случай Revise (необходимость confidential-контекста)» с вариантами (a)/(b)/(c).

### Task 5b: SKILL.md — guard сходимости Revise (OQ-4)

**Files:**
- Modify: `skills/maestro/SKILL.md`

- [ ] **Step 1:** Добавить в шаг 10 (после вариантов Revise) правило сходимости:
  - Оркестратор ведёт счётчик раундов Revise и список новых Critical/Important на каждом (на базе `previous_findings`, см. B-7 / Task 6 Step 1b).
  - Если **2 последовательных раунда** opus не добавили ни одного **нового** Critical/Important (только повторяют/уточняют прошлые) → оркестратор поднимает HITL: «Достигнуто плато: 2 раунда без новых Critical/Important. (a) Approve spec / (b) продолжить ещё / (c) follow-up оставшиеся».
  - Новый Critical/Important обнуляет счётчик «2 раунда».
  - Повторяющиеся не-закрытые замечания не считаются «новыми».
- [ ] **Step 2:** Отметить гейт сходимости в HITL Gate Protocol (строки 585-596, feature) как отдельный гейт «Сходимость Revise (плато)» с вариантами (a)/(b)/(c).

### Task 5c: SKILL.md — маршрут Spike + простая фича ↔ Bounded (OQ-6)

**Files:**
- Modify: `skills/maestro/SKILL.md`

- [ ] **Step 1:** В шаг 1 (выбор маршрута) добавить третий вариант **«Spike»** (feasibility/ресеч/прототип), рядом с feature/bugfix:
  - Spike-маршрут: короткий ресеч кода/прототип → вывод-рекомендация; **без spec/plan/мержа**; код — throwaway (не коммитится как фича).
  - Использует Spike-path скилла brainstorming.
  - **Flow (OQ-9):** изоляция НЕ требуется (опц. временный worktree для прототипа, НЕ мержится/удаляется); pre-flight — минимум (`git status` только); артефакты — рекомендация в ответе primary (не в spec-файле), throwaway-код не коммитить/удалить; исследователь — primary (при необходимости `haiku`); HITL-gates: шаг 1 (spike) + nod на план + финальный «принять/продолжить/отмена»; Spike ≠ bugfix (debug sub-pipeline не применяется); шаги 11-18 не выполняются; выход — HITL решает оформить как feature/bugfix/завершить.
- [ ] **Step 2:** Простая фича (шаг 7b) перевести на **Bounded-логику**:
  - Короткий дизайн в чате → approval → SDD; **без формального plan-документа** (шаг 11 для простой — короткий дизайн, не полный writing-plans).
- [ ] **Step 3:** Зафиксировать маппинг: Spike→(ресеч, без spec), Bounded→простая (без spec), Architectural→сложная/архитектурная (spec), bugfix→debug sub-pipeline (systematic-debugging, НЕ Spike).

### Task 6: spec-review-prompt.md

**Files:**
- Modify: `skills/maestro/spec-review-prompt.md`

- [ ] **Step 1:** В `## Inputs` (строки 14-18) добавить `{previous_verdict}` и `{previous_findings}` (только очищенные) — для подтверждения закрытия прошлых замечаний.
- [ ] **Step 1b:** Определить, где оркестратор хранит `previous_verdict`/`previous_findings` между итерациями и как связывает с подписями:
  - Хранить как **orchestral-состояние сессии** (по аналогии с pending context/cross-cutting changes на шаге 8.5), а не в spec-файле (не загрязнять spec и подписи).
  - `previous_verdict`/`previous_findings` — это **очищенные** результаты прошлого ревью opus (proшли Ур.1). Передаются в следующий диспатч opus вместе с актуальным очищенным spec.
  - Связь с подписями: подписи `maestro:review`/`maestro:sanitize` отвечают за **стабильность содержимого** (hash), а `previous_verdict` — за **историю ревью** в пределах сессии; это разные механизмы, не смешивать.
  - При повторном входе (re-entry) через fast-track `previous_verdict` сессии не сохраняется (новая сессия) — opus-ревью стартует с чистого состояния; это допустимо и согласуется с правилом 3 (Stale-детект).
- [ ] **Step 2:** В `## Rules` (строки 76-86) добавить:
  - На Revise-цикле opus работает **только с очищенным spec**; не допускать/не передавать конфиденциальные данные.
  - Для каждого замечания `Critical`/`Important` при verdict `revise` — выдавать **конкретную правку** (что заменить/добавить/удалить, ссылку на секцию).
  - Не расширять scope: opus не видит project codebase и правит только то, что упомянуто в его замечаниях/спецификации.
  - Правку, для которой не хватает контекста, явно помечать **«требует уточнения контекста»** (не молча додумывать) — это один из формальных индикаторов для HITL (Task 1 Step 2).
  - Вопросы задавать **только если блокируют правку** и **всегда с предлагаемым дефолтом** (по паттерну шага 8); не задавать вопросы, ответ на которые есть в spec.
  - Маркер provenance (`из confidential`) в spec — это **метаданные**, не данные; учитывать при пометке «требует уточнения», но не раскрывать/не переносить значение.

### Task 7: design-prompt.md → custodian-prompt.md (Q/A-брокер)

**Files:**
- Modify: `skills/maestro/design-prompt.md` → rename `custodian-prompt.md`

- [ ] **Step 1:** Переименовать `design-prompt.md` в `custodian-prompt.md`, переписать под роль Q/A-брокера по confidential:
  - `custodian` (trusted) читает confidential-источники, НЕ пишет spec (`edit: deny`), НЕ ведёт brainstorm.
  - Отвечает на вопросы primary, **агрегируя**: тип поля, ограничение, чувствительность, связь — **без передачи raw-значений/токенов/номеров**.
  - Помечает в ответах, какой фрагмент основан на confidential (для маркировки provenance primary-ом).
  - Не задаёт вопросов пользователю; только отвечает primary.
- [ ] **Step 2:** Убрать embedded-секцию `## Brainstorming Workflow (embedded)` (16-43) — brainstorm теперь у primary (superpowers:brainstorming).
- [ ] **Step 3:** Добавить **регламент агрегации** (что можно передавать primary, что никогда — никогда raw-значения/секреты).

### Task 7b: Инвентарь рефейма design → custodian + `/maestro-design` (OQ-7/OQ-8)

**Files:**
- Modify: `agents/design.md` → `agents/custodian.md`, `skills/maestro/design-prompt.md` → `custodian-prompt.md`
- Modify: `skills/maestro/SKILL.md` (шаг 8)
- Modify: `skills/maestro-design/SKILL.md` (шаг (a)) — переработка на новый флоу
- Modify: `commands/maestro-design.md` (строка 14)
- Modify: `plugins/maestro-bootstrap/index.test.js` (trust/Set/agent)
- Modify: `manual_docs/` (agents-and-trust, model-selection)

- [ ] **Step 1:** Создать `agents/custodian.md` (Q/A-брокер, `edit: deny`, trusted), удалить/заменить `agents/design.md`.
- [ ] **Step 2:** Создать `skills/maestro/custodian-prompt.md` (регламент агрегации), заменить `design-prompt.md`.
- [ ] **Step 3:** Обновить `skills/maestro/SKILL.md` шаг 8: `design` → primary brainstorm + custodian Q/A + primary пишет spec (45 упоминаний). **НЕ трогать** `...-design.md` (имя spec-файла) и скилл/команду `/maestro-design`.
- [ ] **Step 4:** Переработать `skills/maestro-design/SKILL.md` шаг (a) и `commands/maestro-design.md`: заменить «диспатч design → spec» на новый флоу (primary brainstorm + custodian + primary writes). Скилл/команда `/maestro-design` НЕ переименовываются.
- [ ] **Step 5:** Обновить `plugins/maestro-bootstrap/index.test.js`: `trust: { design }` → `custodian`, `Set(["design"])` → `["custodian"]`, `res.agent === "design"` → `"custodian"`.
- [ ] **Step 6:** Обновить `maestro.json`/app-конфиг (отдельная доставка): `trust.design`→`trust.custodian`, `agent.design.model`→`agent.custodian.model`. **Порядок (OQ-8):** trust-конфиг обновить ДО/вместе с включением custodian, иначе custodian untrusted.
- [ ] **Step 7:** Обновить `manual_docs/` (agents-and-trust, model-selection): design→custodian role.

### Task 8: agents/opus.md (опционально)

**Files:**
- Modify: `agents/opus.md` (пермишены НЕ меняются)

- [ ] **Step 1:** Добавить комментарий-описание: роль opus на Revise-цикле — выдавать структурированные правки по замечаниям; правки применяет оркестратор (`edit: deny` сохраняется).

### Task 8.5: SKILL.md — spec-follow-up через шаг 8.5 (OQ-5)

**Files:**
- Modify: `skills/maestro/SKILL.md`

- [ ] **Step 1:** Расширить шаг 8.5 (оценка изменений контекста) обработкой **spec-follow-up** из особого случая шага 10b (вариант (b)) и плато OQ-4 (вариант (c)):
  - Оркестратор фиксирует spec-follow-up как **отдельный pending-список** (рядом с `pending context changes` / `pending cross-cutting changes`), с пометкой причины (по какой ветке OQ-1: «не хватает контекста» / «несущественно/scope»).
  - Каждый follow-up помечается **«не блокирует Approve»** (по аналогии с шагом 16).
  - Хранение — orchestral-состояние сессии, **не в spec-файле** (не загрязнять spec/подписи).
- [ ] **Step 2:** В шаге 11 (writing-plans) добавить: spec-follow-up транслируется в задачи плана (или секцию плана) наравне с context/cross-cutting changes.

### Task 9: Синхронизация manual_docs

**Files:**
- Modify: `manual_docs/` (по правилу синхронизации SKILL.md-изменений)

- [ ] **Step 1:** Отразить изменение шага 10b (Revise) в `manual_docs/how-to/` или `manual_docs/explanation/` (по текущей структуре manual_docs).
- [ ] **Step 2:** Обновить `manual_docs/reference/config.md` (если затрагивается) и `manual_docs/explanation/agents-and-trust.md` (роль opus на Revise, гарантия доступа).

---

## Критерии приёмки

- На Revise-цикле (шаг 10b) НЕ происходит re-dispatch `custodian` (кроме особого случая (a)).
- `opus` не получает доступа к confidential: работает только с очищенным spec; `edit: deny` сохранён.
- Оркестратор применяет правки opus к spec через Ур.1-фильтр перед Edit (Слой 5; process-требование, enforcement отсутствует, accepted risk при пропуске; основная защита — Слои 2/3 + built-in confidential `.env`/ключи, см. OQ-3).
- Особый случай (нужен confidential-контекст) → HITL (a)/(b)/(c), без раскрытия данных opus/оркестратору.
- Подписи `maestro:review`/`maestro:sanitize` инвалидируются по hash и перезапускают 8.6/9 корректно; новая схема совместима с fast-track re-entry (правила 3/5/6 подписей) (см. Task 4, Step 3).
- Повторный 8.6 (OQ-2): на обычных opus-циклах полный повторный прогон sanitizer НЕ выполняется; выполняется только при вовлечении trusted-контура (особый случай (a) → trusted `custodian`; opus-trusted B-5) (см. Task 1, Task 2).
- Поведение при trusted opus в `maestro.json` явно оговорено (Слои 2-5 не действуют) (см. Task 3, Step 3).
- `previous_verdict`/`previous_findings` хранятся как orchestral-состояние сессии и передаются в следующий диспатч opus; не смешиваются с подписями spec (см. Task 6, Step 1b).
- Маркировка provenance: **primary** (по пометкам `custodian`) помечает confidential-фрагменты **бинарным маркером `из confidential`** (без категории/значений); sanitizer не вычищает маркер (не значение); правка/вопрос по помеченной секции → HITL (см. Task 1 Step 2, Task 7 Step 3).
- Сходимость Revise (OQ-4): guard «2 раунда без новых Critical/Important → HITL (Approve/продолжить/follow-up)» реализован на базе `previous_findings` (см. Task 5b, Task 6 Step 1b).
- Spec-follow-up (OQ-5): фиксируется как отдельный pending-список на шаге 8.5 и транслируется в план (шаг 11); помечается «не блокирует Approve» (см. Task 8.5).
- Совместимость с superpowers: скилы superpowers НЕ изменены; maestro работает как обёртка — гейты HITL на стыках скиллов (CR-B1), защита через плагин (не primary-распознавание, CR-B2), dispatch субагентов через Слой 2 sanitize (CR-B3), вопросы confidential решаются custodian/HITL, не primary (CR-B4); форматы ревью транслируются на границе (RP-2), ledger SDD следует за скриптами superpowers (RP-5), commit spec/переход к writing-plans через maestro-гейт (RP-6/7).
- Маршрут Spike (OQ-6): третий вариант в шаге 1 (feasibility/ресеч, без spec/plan/мержа); простая фича ↔ Bounded (без plan-дока); сложная/арх ↔ Architectural; bugfix ↔ debug sub-pipeline (см. Task 5c).
- **Все блокеры решены (OQ-1…OQ-11):** инвентарь рефейма (OQ-7), порядок доставки (OQ-8), Spike-flow (OQ-9), бинарный маркер без категории (OQ-10), жёсткий потолок brainstorm не вводится (OQ-11). Реализация может быть начата.
- **Built-in confidential (решение B, Task 2b):** `.env`/ключи deny для primary/non-trusted по умолчанию реализован в плагине; `confidential.paths` расширяет built-in.
- **S-решения:** S1 (текст Файлов под custodian), S2 (доставка в app-репо — подэтап Фазы 1), S3 (accepted risk сверки агрегата), S6 (User Review Gate = шаг 10, не дублировать).
- manual_docs синхронизированы с SKILL.md.

## Не входит в scope

- Изменение пермишенов `opus` (остаётся `edit: deny`).
- Дельта-санитизация (явно отклонено HITL).
- Изменение плагина `maestro-bootstrap` (Слой 5 реализуется инструкцией оркестратору + существующим Ур.1, не кодом плагина) — **кроме built-in confidential (Task 2b, в scope)**.
- **Модификация сторонних скиллов superpowers (SDD/writing-plans/review/brainstorming)** — **запрещена**; они не меняются. Изменения только в maestro (обёртки: гейты HITL, sanitize на dispatch, трансляция форматов, ledger). Адаптация описана в разделе «Совместимость с superpowers».
- **Built-in confidential-набор (`.env`/ключа deny, OQ-3) — В SCOPE этого плана** (решение B): реализуется в Task 2b (Фаза 2) в `plugins/maestro-bootstrap/core.js` + тесты.
- Новые confidential.paths по умолчанию (конфигурация не меняется) — за исключением built-in набора (см. выше).
- **Debug sub-pipeline (шаги D1-D7) не затрагивается:** в багфикс-маршруте spec (шаги 8-10) пропускаются, Spec Review не выполняется, поэтому изменение Revise-цикла к debug-маршруту не применяется. Пометка сделана для явности — исключает путаницу при ревью.

---

## Порядок реализации (этапы)

Принцип: сначала то, что влияет на всё остальное и ломается без него (рефейм), затем безопасность, затем ядро процесса, затем контроль, затем маршруты/обёртки/полировка. **Каждая фаза проверяется перед переходом к следующей.** Допустимо параллелить фазы, отмеченные как независимые.

### Фаза 1 — Рефейм design → custodian (блокер)
**Task 7, Task 7b, OQ-8.** Обязателен первым: меняет имя/роль повсюду; без него последующие шаги ломают тесты плагина.
Порядок внутри:
1. Обновить `maestro.json`/app-конфиг (`trust.custodian`, `agent.custodian.model`) — **сначала** (иначе custodian untrusted).
2. Создать `agents/custodian.md` + `custodian-prompt.md`, заменить design.
3. Обновить `plugins/maestro-bootstrap/index.test.js` (design→custodian).
4. Обновить `skills/maestro/SKILL.md` шаг 8 (design→custodian).
5. Переработать `skills/maestro-design/SKILL.md` шаг (a) + `commands/maestro-design.md`.
6. Прогон тестов плагина (`node --test`).
7. **S2 — доставка в целевое app-репо (явный подэтап):** синхронизировать изменения в целевом приложении — `agent.custodian.model`, `trust.custodian`, `.opencode/agents/custodian.md`, загрузка обновлённых скиллов (стандартным механизмом: remote/agpack). **До этой доставки изменения не работают в целевом приложении.** Также обновлённый плагin (built-in confidential, Фаза 2) включается в доставку.
**Проверка:** тесты зелёные, рефейм чист (`rg "design"` в субагент-контекстах = 0), доставка в app согласована.

### Фаза 2 — Безопасность и модель доступа + built-in confidential
**OQ-10, OQ-1, OQ-3, CR-B2/B3, Task 2b.** Маркировка provenance, HITL по формальным индикаторам, защита через плагин.
**OQ-3 (built-in confidential `.env`/ключи) — реализуется В ЭТОМ ПЛАНЕ (решение B), не отдельным планом.**
**Task 2b:** `plugins/maestro-bootstrap/core.js` — built-in набор `{ ".env", ".env.*", "*.pem", "*.key", "*.crt", "*.p12", "*.pfx" }` как deny по умолчанию для read/write/edit (primary + non-trusted); `confidential.paths` расширяет built-in. + тесты в `index.test.js` + README плагина (built-in секция).
**Проверка:** маркировка работает, HITL на помеченные секции, защита согласована; primary/non-trusted не читают `.env`/ключей по умолчанию (юнит-тест).

### Фаза 3 — Ядро процесса Revise
**Task 1, Task 2, Task 5.** opus-правки + primary применяет; повторный 8.6 только при trusted; гейт особого случая. Зависит от Фаз 1-2.
**Проверка:** Revise-цикл по схеме opus+primary, перезапуск 8.6 корректен.

### Фаза 4 — Контроль циклов и follow-up
**Task 5b, Task 6 Step 1b, Task 8.5.** Guard сходимости (плато), хранение `previous_findings`, spec-follow-up. Зависит от Фазы 3.
**Проверка:** Revise не зацикливается, follow-up не теряются.

### Фаза 5 — Классификация маршрутов
**Task 5c.** Маршрут Spike (OQ-6/OQ-9), простая ↔ Bounded, маппинг путей brainstorm. Независима от Фаз 3-4 — **можно параллелить** с Фазами 3-4 (после Фаз 1-2).
**Проверка:** маршруты feature/bugfix/spike классифицируются корректно.

### Фаза 6 — Спецификация промптов ревьюера
**Task 6.** `spec-review-prompt.md`: `previous_verdict`/`previous_findings` в inputs, правки + ограничение opus, маркер. Использует результат Фазы 4 (previous). Можно частично параллелить с Фазой 4.
**Проверка:** промпт ревьюера консистентен.

### Фаза 7 — Обёртки superpowers
**CR-B1..B4, RP-1..7.** maestro-обёртки вокруг скиллов superpowers (гейты HITL на стыках, защита через плагин, sanitize на dispatch, трансляция форматов, ledger, позиционирование Revise как User Review Gate). Зависит от Фаз 3/6.
**Проверка:** скиллы superpowers не изменены, обёртки работают.

### Фаза 8 — Полировка и документация
**Task 9, manual_docs.** Синхронизация документации, финальная проверка, прогон тестов.
**Проверка:** manual_docs актуальны, полный прогон тестов.

### Фаза 9 — Тестирование изменений (после всех фаз)

**9.0. Песочница (фикстура) через `maestro-sandbox.sh`.**
- Скрипт `maestro-sandbox.sh` в корне репо (коммитится); генерирует `.sandbox/` (в `.gitignore` корня, не коммитится).
- Структура `.sandbox/`:
  - `docs/project-context.md` (14 категорий, фиктивный проект);
  - `docs/confidential/` — **фиктивные** конфиденциальные данные: `pricing-schema.md`, `customer-contract.md`, `onboarding-flows.md`;
  - `maestro.json` (`trust: { custodian: true, sanitizer: true }`, `access_policy`, `confidential.paths`);
  - `.env` — **фиктивные** секреты (`SANDBOX_DUMMY_PASSWORD`, `SANDBOX_FAKE_API_KEY`, `SANDBOX_FAKE_CARD`); **закрыт built-in confidential (Фаза 2)** — конфиг не нужен;
  - `secrets/other.conf` — фиктивный секрет вне confidential; закрывается через `confidential.paths`/`access_policy.deny` в `maestro.json` (не входит в built-in);
  - `src/`, `tests/` — минимальный код-скелет (TS, 1-2 модуля + тесты) для debug/bugfix;
  - `docs/superpowers/{specs,plans}/` — каталоги для spec/plan.
- Флаги скрипта: `create` (создать/пересоздать), `--reset` (полный сброс), `--clean` (удалить `.sandbox/`). Идемпотентен.
- **Maestro-сценарии запускаются с `workdir` = корень `.sandbox/`** (песочница имитирует целевое приложение), НЕ в корне authoring (AGENTS.md).
- **Чеклист тестирования — отдельный файл** `docs/testing/maestro-sandbox-checklist.md` (вынесен из Приложения A, вариант b). **`maestro-sandbox.sh create` выводит путь к чеклисту** (единая точка входа для QA): при `create`/`--reset` скрипт печатает «Песочница готова. Чеклист: docs/testing/maestro-sandbox-checklist.md». QA открывает чеклист, прогоняет сценарии (A→E), отмечает ✅/❌/⚠️, затем `--clean`.

**9.1. Юнит-тесты плагина.** `npm test` в `plugins/maestro-bootstrap/`. После рефейма: custodian trusted, opus untrusted, confidential deny `.env`/ключей, sanitize не вычищает маркер `из confidential`.

**9.2. Статическая сверка (grep-чеки).**
- `rg "design"` в субагент-контекстах (SKILL.md/agents/maestro-design) = 0 (рефейм чист);
- `git status` на `.opencode/skills/` (скиллы superpowers не изменены);
- custodian упомянут в нужных местах (SKILL.md, agents, maestro-design, app-конфиг).

**9.3. Smoke-сценарии maestro (ручные, в `.sandbox/`).** Проверить результат:
- **Рефейм:** custodian trusted, design удалён.
- **Brainstorm (Architectural):** primary грузит `superpowers:brainstorming`, custodian отвечает по `docs/confidential/` агрегатами (без значений), primary пишет spec, маркер `из confidential` ставится.
- **Revise:** opus ревьюит очищенный spec → правки → primary применяет (Ур.1) → повторное ревью → плато (2 раунда) → HITL approve.
- **Особый случай:** правка по помеченной секции → HITL (custodian Q/A агрегатом → primary применяет / follow-up).
- **Spike:** feasibility по project-context → рекомендация, mini-pre-flight (`git status`), throwaway-код, без spec/plan/мержа.
- **Простая ↔ Bounded:** короткий дизайн в чате → SDD без plan-дока.
- **`/maestro-design`:** шаг (a) → primary brainstorm + custodian + primary пишет spec.
- **Подписи/hash:** после правок spec подписи stale → 8.6/9 перезапуск.

**9.4. Security-чеклист (выделенный, критичный).** Аудит-лог плагина + доп. проверки:
- opus (untrusted) в запросе не получает raw-confidential;
- primary не читает `.env`/`secrets/` (confidential deny);
- custodian в ответах содержит только агрегаты (тип/ограничение/чувствительность), **без** значений/токенов/номеров;
- маркер `из confidential` не маскируется sanitizer, но правка по нему → HITL;
- **утечки через bash/glob/grep** (плагин не покрывает) — гейт-0 активен, bash-permissions корректны;
- trusted-opus (B-5): при `trust.opus=true` — предупреждение о снятии гарантий;
- `.env`/ключи built-in (реализован в Фазе 2): primary/non-trusted не читают `.env`/ключей по умолчанию (проверяется юнит-тестом Task 2b и песочницей); `secrets/other.conf` закрыт через конфиг песочницы.

**9.5. Консистентность доков.** SKILL.md, custodian-prompt, spec-review-prompt, manual_docs согласованы (grep-сверка терминов: custodian, маркер, Revise).

**Проверка:** все smoke-сценарии проходят, security-чеклист чист, песочница воспроизводима (`--reset`).

### Критический путь и параллельность
- **Критический путь:** Фаза 1 → Фаза 2 → Фаза 3 → Фаза 4 → Фаза 6 → Фаза 7 → Фаза 8 → Фаза 9 (тестирование).
- **Параллельные:** Фаза 5 (после Фаз 1-2, параллельно Фазам 3-4); частично Фаза 6 (с Фазой 4).
- **Точка останова после каждой фазы:** проверка (тесты/рефейм-чистота) перед следующей. Обязательна после Фазы 1.
- **Фаза 9 — после всех фаз** (тестирование не может идти раньше готовности изменений).

---

## Приложение A — Чеклист тестирования в песочнице (Фаза 9)

**Полный чеклист вынесен в отдельный файл `docs/testing/maestro-sandbox-checklist.md`** (вариант b, автономная копия для QA). `maestro-sandbox.sh create` выводит путь к нему. Здесь — сводка категорий и сценариев (детали — в отдельном файле).

Полный чеклист smoke/security-сценариев в `.sandbox/` (позитивные и негативные), по возрастанию сложности. Обозначения: ✅ позитив · ❌ негатив/альтернатива · ⚠️ probe (accepted risk).

### A. Базовые / конфигурационные
| # | Сценарий | Тип | Проверка |
|---|---|---|---|
| A1 | Рефейм: custodian существует, design отсутствует | ✅ | `agents/custodian.md` есть; `rg "design"` в субагент-контекстах = 0 |
| A2 | Юнит-тесты плагина | ✅ | `npm test` зелёные (после рефейма) |
| A3 | Built-in confidential: `.env` deny | ✅ | primary/non-trusted не читают `.env`/ключей (юнит-тест Task 2b) |
| A4 | Built-in: `confidential.paths` расширяет built-in | ✅ | пользовательский путь не заменяет built-in |
| A5 | Маркер `из confidential` не маскируется sanitizer | ✅ | тест в index.test.js (S10) |
| A6 | Маркер не ломает sanitize (не ложное срабатывание) | ❌ | маркер не вызывает false-positive маскирование |

### B. Подготовка спецификации / brainstorm
| # | Сценарий | Тип | Проверка |
|---|---|---|---|
| B1 | Brainstorm Architectural: primary грузит superpowers:brainstorming | ✅ | канон (вопросы/подходы/дизайн→approval), пишет spec |
| B2 | Custodian отвечает по confidential агрегатами | ✅ | тип/ограничение/чувствительность, без значений |
| B3 | Custodian НЕ раскрывает raw-значения | ❌ | «какой пароль?» → агрегат, не значение |
| B4 | Маркер `из confidential` ставится primary | ✅ | primary помечает секции (по пометкам custodian) |
| B5 | **S3 риск-контроль:** primary искажает агрегат custodian | ⚠️ | **НЕ тест, а риск-контроль** (детерминизм LOW): проверить отсутствие обратной сверки custodian + sane spec при записи; документированный accepted risk |
| B6 | Brainstorm: пользователь управляет длиной | ✅ | продолжить/упростить/стоп (OQ-11, без жёсткого потолка) |
| B7 | Простая фича ↔ Bounded | ✅ | короткий дизайн в чате → SDD без plan-дока |
| B8 | Spike: feasibility | ✅ | рекомендация, throwaway-код, mini-pre-flight, без spec/plan/мержа |

### C. Revise-цикл
| # | Сценарий | Тип | Проверка |
|---|---|---|---|
| C1 | opus (untrusted) ревьюит очищенный spec | ✅ | не получает raw-confidential |
| C2 | opus-правки → primary применяет (Edit, Ур.1 Слой 5) | ✅ | правка применяется, Ур.1 фильтрует |
| C3 | opus не читает confidential | ❌ | audit-лог `access_policy.blocked` |
| C4 | Повторный 8.6 НЕ запускается на opus-цикле (OQ-2) | ✅ | полный прогон sanitizer не повторяется |
| C5 | Повторный 8.6 при trusted-контуре (особый случай a) | ✅ | custodian-участие → полный 8.6 |
| C6 | **Особый случай (маркер):** правка по `из confidential`-секции → HITL → custodian | ✅ | **уточнение по маркированным данным через custodian, не primary**. Парный с D6 (обязательный security-набор). Маркер-детект формален, не эвристика |
| C7 | Плато «2 раунда без новых Critical/Important → HITL» | ✅ | OQ-4 сходимость |
| C8 | Новая Critical на 3-м раунде обнуляет плато | ✅ | счётчик сбрасывается |
| C9 | Повторяющиеся не-закрытые замечания не «новые» | ✅ | плато наступает при повторах |
| C10 | HITL Approve → writing-plans (шаг 11) | ✅ | после подтверждения → план |
| C11 | HITL Revise → снова opus-правки; Reject → стоп | ❌/граница | ветки гейта шага 10 |
| C12 | Подписи stale после правок → 8.6/9 перезапуск | ✅ | hash-инвалидация, re-entry |
| C13 | **fast-track re-entry (вариант b):** re-entry на изменённый spec → stale → 8.6/9 перезапуск | ✅ | варианты (a) валидная подпись, (c) FINDINGS_ACCEPTED — НЕ в scope этого ревью |

### D. Безопасность (выделенный)
| # | Сценарий | Тип | Проверка |
|---|---|---|---|
| D1 | opus не получает raw-confidential в запросе | ✅ | Слой 2 маскирование + audit-лог |
| D2 | primary не читает `.env`/`secrets/` | ✅ | confidential deny (built-in + конфиг) |
| D3 | custodian агрегаты без значений/токенов/номеров | ✅ | assert/audit |
| D4 | Утечка через bash/glob/grep | ❌ | гейт-0, bash-permissions (плагин не покрывает — ручная проверка) |
| D5 | trusted-opus (B-5): гарантии сняты → предупреждение | ❌ | при `trust.opus=true` — предупреждение |
| D6 | **Маркер-driven (негатив):** правка по `из confidential`-секции НЕ применяется молча | ❌ | обязателен HITL (не silent). Парный с C6. Проверить, что правка не обходится «синтаксической согласованностью» без HITL (маркер-детект формален, не эвристика) |

### E. Интеграция команд/скилов
| # | Сценарий | Тип | Проверка |
|---|---|---|---|
| E1 | `/maestro-design`: шаг (a) → primary brainstorm + custodian + primary пишет spec | ✅ | переработанный флоу |
| E2 | **S6:** User Review Gate = шаг 10 (не двойное одобрение) | ✅ | **проверка документации/порядка шагов** (структурная, не поведенческий smoke): один user-review-gate |
| E3 | Доставка в app-репо (S2) | ✅ | custodian/trust/model в целевом приложении |
| E4 | superpowers-скиллы не изменены | ✅ | `git status` на `.opencode/skills/` чист |

### Незакрытые сценарии (добавлены выше — B5, C6/C13, D6, E2)
- **B5 (S3 риск-контроль)** — искажение агрегата custodian: **не тест, а риск-контроль** (детерминизм LOW; отсутствие обратной сверки + sane spec).
- **C6** — уточнение по маркированным данным идёт через custodian (позитив); парный с D6.
- **C13** — fast-track re-entry: **только вариант (b)** — re-entry на изменённый spec → stale → 8.6/9 перезапуск. (a)/(c) — не в scope.
- **D6** — маркированная секция не применяется молча (негатив); парный с C6; маркер-детект формален, не обходится «синтаксической согласованностью».
- **E2** — User Review Gate = шаг 10: **проверка документации/порядка шагов** (структурная, не поведенческий smoke).

---

## Подготовка спецификации: superpowers:brainstorming (primary) + custodian (Q/A-брокер)

Зафиксировано HITL (выход из plan-mode). Относится к шагу 8 (spec formation), согласуется с правками Revise-цикла.

**0. Пути brainstorm → отображение на пайплайн.**
- `superpowers:brainstorming` имеет **3 пути: Spike / Bounded / Architectural**.
- Spec формируется **только при пути Architectural** (Checklist п.6 «Write design doc»). Spike — feasibility, вывод = рекомендация (без spec). Bounded — короткий дизайн в чате + реализация (без spec-файла, без plan-дока).
- Отображение на категории фич maestro (простая/сложная/архитектурная) и на маршруты (bugfix/spike) — уточнить на этапе реализации (см. «Открытые вопросы», OQ-6).

**1. Brainstorm выполняет primary (суперпауэрs-скилы — только primary, интерактивные/диалоговые).**
- primary грузит `superpowers:brainstorming` через `skill`-инструмент и ведёт brainstorm по канону скилла: классификация пути → вопросы по одному → подходы → секционный дизайн → approval.
- HITL-диалог напрямую с пользователем (primary), без редиспатчей субагента.

**2. `design` переименован в `custodian` (trusted Q/A-брокер по confidential).**
- `custodian` (бывший `design`) — **trusted**, читает confidential-источники.
- Роль: **отвечает на вопросы primary**, анализируя confidential-данные, **не раскрывая сами значения** (агрегирует: тип поля, ограничение, чувствительность, связь; НЕ отдаёт raw-значения/токены/номера).
- НЕ пишет spec (`edit: deny`), НЕ ведёт brainstorm. Пермишены: `read` (trusted, доступ к confidential), `edit: deny`, `bash: deny`, `task: deny`.
- Выход — агрегированные ответы, помечающие, какой фрагмент основан на confidential («эти данные из confidential», без категории/значений; для маркировки provenance, см. п.4).

**3. Spec пишет primary.**
- primary собирает результаты brainstorm (с пользователем) + Q/A-ответы `custodian` (по confidential-аспектам) → **пишет финальный spec** в `{spec_path}` / fast-track `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.
- primary не видит raw confidential — только агрегаты custodian → риск мал.
- Контроль — sanitizer (шаг 8.6) после записи (полный прогон на первичной записи).
- Слой 5 (Ур.1 при edit) применяется и к первичной записи primary (defense-in-depth).

**4. Маркировка provenance — на primary, бинарный маркер (OQ-1/OQ-10).**
- `custodian` в своих Q/A-ответах помечает, какие фрагменты основаны на confidential («эти данные из confidential»), без категории/значений; не вносит в файл.
- **primary** при записи spec переносит эти пометки в spec **бинарным маркером `из confidential`** (без категории).
- Маркер структурно безопасен (не чувствительное поле/значение); не вычищается sanitizer (единичная проверка в рамках 8.6).

**5. Лимит HITL-циклов brainstorm — по сходимости, НЕ жёсткое «max 3», потолок не вводится (OQ-11).**
- Текущее «Max 3 re-dispatch цикла» (SKILL.md:262) заменяется на **критерий сходимости** («за N раундов нет новых вопросов → HITL: (a) продолжить / (b) упростить scope / (c) стоп»), единый принцип с плато OQ-4.
- Для brainstorm у primary диалог натуральный (по одному вопросу за раз, как канон); жёсткий потолок НЕ нужен (OQ-11): brainstorm интерактивен с пользователем, который сам контролирует длину; автономного цикла нет. Достаточно сходимости как мягкого сигнала.
- Вопросы к `custodian` (по confidential) — отдельный контур, не смешивается с HITL-вопросами пользователю.

**6. Драфт-файл НЕ используется.**
- Промежуточный draft отклонён (скилл пишет финал сразу). Контекст re-dispatch для custodian — через промпт (вопросы+ответы), по механике B-7.

**7. Позиционирование Revise-цикла (шаги 9-10) относительно brainstorming.**
- Revise-цикл maestro (правки через untrusted `opus` + применение оркестратором) — это **расширение User Review Gate скилла brainstorming** (`.opencode/skills/brainstorming/SKILL.md:221-226`): после того как primary записал spec (Architectural-путь), maestro добавляет этап **технического ревью `opus`** (untrusted, по очищенному spec) перед финальным user-approve.
- **Применим ТОЛЬКО к Architectural-пути** (где есть spec-файл). Для Bounded (короткий дизайн в чате, без spec-файла) и Spike (feasibility, без spec) Revise через opus **НЕ используется** — там доработка через диалог с пользователем (Bounded) или отсутствует (Spike).
- Сам скил `brainstorming` НЕ изменяется: Revise добавляется как maestro-обёртка **вокруг** User Review Gate (этап opus-ревью → user-approve на шаге 10 → writing-plans на шаге 11).
- Опус-ревью не заменяет user-review; user-approve (шаг 10 HITL-gate) остаётся финальным (соответствует User Review Gate канона).
- **S6 (совпадение гейтов):** User Review Gate brainstorming СОВПАДАЕТ с шагом 10 maestro (spec-gate). Это **один и тот же HITL-гейт**, НЕ два отдельных одобрения. Отдельный «пользователь смотрит spec» после brainstorming не дублируется — им является шаг 10. Прямое следствие: не добавлять второй user-review-gate после brainstorm сверх шага 10.

**Связанные правки по Таскам (учтутся при реализации):**
- `agents/design.md` → rename в `custodian.md`: новая роль (Q/A-брокер, `edit: deny`), trusted.
- `skills/maestro/design-prompt.md` → `custodian-prompt.md`: регламент агрегации (тип/ограничение/чувствительность, без значений) + пометка provenance в ответах.
- `skills/maestro/SKILL.md:260-263` — заменить «Max 3 re-dispatch» на сходимость; обновить упоминания design→custodian (шаг 8, Trust-матрица, модель, подписи, audit-лог).
- `skills/maestro/SKILL.md` шаг 8 — primary грузит `superpowers:brainstorming`; reference на custodian вместо design.
- `maestro.json` — `trust: { custodian: true, ... }`.
- OQ-1/Task 7 — маркировка provenance ставится primary (не бывший `design`/`custodian`).

> Scope: решение затрагивает шаг 8 (spec formation) + ренейм design→custodian (сквозной по agents/maestro.json/SKILL.md/audit). Правки Revise-цикла (шаги 9-10) — как в Тасках 1-6. Реализация brainstorm-блока — отдельные правки в custodian-prompt.md/SKILL.md/agents.

---

## Совместимость с superpowers (obra/superpowers): maestro как обёртка

**Принцип:** сторонние скилы superpowers (`brainstorming`, `writing-plans`, `subagent-driven-development`, `requesting-code-review` и др., `.opencode/skills/`) **НЕ изменяются**. Maestro адаптируется под их поведение: определяет **где** скилл применяется и ставит **вокруг него** maestro-гейты/обёртки (HITL, sanitize, лимиты, транслирование форматов), не трогая внутреннюю логику скилла.

**Ключевой приём:** непрерывность/автономность superpowers внутри задачи допустима; maestro-гейты стоят **на стыках** (шаги 8→10, 10→11, 12→13, 13→16, 16→17), где SDD/скиллы обязаны уступить HITL.

### CR-B1. «continuous execution / rulings-not-stalls» (SDD) vs HITL-гейты maestro
- SDD (SKILL.md:17,21): «Do not pause between tasks», «Rulings, not stalls». Скилл менять нельзя.
- **Адаптация maestro:** maestro **класт «точки обязательного HITL»** (шаги 10/12/17, load-bearing решения по scope/трактовке спеки) как точки, которые SDD **не может пройти автономно**; внутри задачи SDD-флоу непрерывен (не меняем). Maestro размещает свои гейты на стыках скиллов, а не внутри.

### CR-B2. «security-sensitive → stop» (SDD) не срабатывает корректно (primary не видит confidential)
- SDD (SKILL.md:28): primary сам распознаёт «security-sensitive». Не работает: primary не видит confidential (Слой 3).
- **Адаптация maestro:** maestro **полагается на плагин** (Слои 2/3/confidential-deny) как единственный enforcement; Гейт 0 (проверка плагина) обязателен. SDD-«security фраза» не используется как механизм защиты — не дублируется, но и не требует правки скилла.

### CR-B3. Dispatch субагентов — Санitizация Слоя 2 (maestro-слой)
- SDD передаёт implementer/reviewer кратй + diff. Скилл менять нельзя.
- **Адаптация maestro:** перед диспатчем untrusted-субагента (шаг 13d/16) maestro-оркестратор прогоняет промпт/diff через Слой 2 sanitize (Точка 2) — независимо от SDD-шаблона. Это maestro-обёртка, не изменение скилла.

### CR-B4. Вопросы имплементера → primary; confidential → только HITL/custodian
- SDD/implementer: вопросы идут primary, primary отвечает. Не меняем.
- **Адаптация maestro:** для вопросов «кода» primary отвечает (как SDD). Для вопросов «требований/confidential» maestro **перехватывает**: primary не отвечает на то, чего не видит; направляет в custodian/HITL. Правило в maestro-оркестраторе.

### RP-1. Пути brainstorm (Spike/Bounded/Architectural) → категории фич maestro
- superpowers не меняем. maestro маппит свои категории на пути скилла: простая ↔ Bounded; сложная/арх ↔ Architectural; bugfix ↔ systematic-debugging (НЕ Spike). Spike → feasibility-вопрос (без spec). Отображение — см. OQ-6.

### RP-2. Форматы ревью — трансляция на границе, не унификация скиллов
- superpowers `spec-document-reviewer`/`code-reviewer` — свои форматы. maestro `spec-review-prompt`/`code-reviewer` — свои.
- **Адаптация maestro:** maestro **транслирует** свой вердикт в ожидаемый superpowers-формат при сборке dispatch-промпта ревьюера (и наоборот), не меняя скиллы. Источник вердикта — maestro-протокол (severity+verdict).

### RP-3. SDD fix-loop cap (5) — оставить, HITL на уровне maestro-гейта
- SDD cap 5 не меняем. **Адаптация maestro:** HITL добавляется **на уровне гейта maestro** (после SDD-цикла/на стыках), не внутри SDD. На load-bearing findings на стыке — HITL по maestro-правилам (плато OQ-4).

### RP-4. Model Selection custodian (tier) — конфиг maestro
- custodian — trusted, opus-tier (как был design). Это `maestro.json`/`agent.custodian.model` — конфиг maestro, не скилл.

### RP-5. Ledger-пути — maestro следует за SDD-скриптами
- SDD-scripts пишут в `.superpowers/sdd/<plan>/`. Скиллы/скрипты не меняем.
- **Адаптация maestro:** SDD-часть использует SDD-каталог (`.superpowers/sdd/<plan>/`), `.maestro/sdd/` — только для maestro-специфичных артефактов. Не переопределять SDD-скрипты.

### RP-6/7. Commit spec + writing-plans из brainstorm — обёртка вокруг канона
- brainstorm-канон велит commit spec и «invoke writing-plans». Не меняем скилл.
- **Адаптация maestro:** primary следует brainstorm-канону до «commit design doc», затем maestro **перехватывает**: sanitizer (8.6) → гейт (шаг 10) → и только после Approve — writing-plans (шаг 11). Commit spec — на шаге 12 maestro, а не дважды.

> Эти обёртки — часть критериев приёмки; реализуются в maestro (SKILL.md/оркестратор/промпты), скилы superpowers не модифицируются. OQ-6 (маппинг путей) остаётся открытым.

---

## Открытые вопросы

**Требуют решения HITL (не технические правки текста):**

- **OQ-1 (РЕШЕНО):** Критерий распознавания «правка/вопрос требует confidential-контекста».
  **Решение:** условный HITL на **формальных надёжных индикаторах**, без угадывания оркестратором. Два механизма:
  1. **Маркировка provenance в spec:** **primary** (а не design; design переименован в `custodian`) при записи spec помечает фрагменты, основанные на confidential-источнике, **бинарным маркером `из confidential`** (без категории/значений). Пометки приходят от `custodian` в Q/A-ответах. Маркер — это **факт происхождения**, не данные; его можно показывать opus/оркестратору.
  2. **Правило для оркестратора:** правка/вопрос opus, затрагивающая **помеченную** секцию → «требует уточнения» → HITL (a) применить / (b) перепоручить trusted `custodian` / (c) follow-up / (d) отмена. Правки по непомеченным секциям, синтаксически согласованные со spec, применяются молча.
  **Обработка вопросов opus:** отдельно от правок, по существующему паттерну шага 8 (open questions → HITL → re-dispatch). Оркестратор сначала отвечает на те, что покрыты spec; остальные → HITL.
  **Требования к маркировке:** ставит primary (по пометкам custodian); **бинарный маркер `из confidential`** (без категории/значений, OQ-10); точечно (минимизировать ложные срабатывания); sanitizer не считает маркер утечкой (не вычищать); решение о судьбе маркеров в плане/имплементации (шаг 11/13) — оставлять как метаданные.
- **OQ-6 (РЕШЕНО):** Отображение путей brainstorm (Spike/Bounded/Architectural) на категории/маршруты maestro.
  **Решение (по рекомендациям):**
  1. **Ввести маршрут «Spike»** (feasibility/ресеч/прототип) в шаг 1 как третий вариант рядом с feature/bugfix. Spike-маршрут: короткий ресеч кода/прототип → вывод-рекомендация; **без spec/plan/мержа**; код — throwaway. Spike использует Spike-path скилла brainstorming.
  2. **Простая фича ↔ Bounded:** простая фича ведётся по Bounded-логике (короткий дизайн в чате → approval → SDD), **без формального plan-документа** (шаг 11 — короткий дизайн, не полный writing-plans). Снижает артефакты, совпадает со superpowers.
  3. **Сложная/архитектурная ↔ Architectural:** полный spec (шаг 8) → review (9) → gate (10) → writing-plans (11). Обёртка maestro — гейты на стыках.
  4. **bugfix** — debug sub-pipeline (D1-D7, systematic-debugging), НЕ Spike.
  5. Матрица сигналов шага 7 (простая/сложная/архитектурная) сохраняется; отображается на пути brainstorm при выборе категории; Spike выносится в шаг 1 (до категоризации).
- **OQ-7 (РЕШЕНО):** Инвентарь рефейма `design` → декомпозиция «primary brainstorm + custodian Q/A + primary пишет spec». Решение (вариант A): `/maestro-design` унифицируется с новым флоу.
  **Инвентарь (по факту `rg "design"`):**
  - `agents/design.md` → rename в `agents/custodian.md` (Q/A-брокер, `edit: deny`).
  - `skills/maestro/design-prompt.md` → rename в `custodian-prompt.md`.
  - `skills/maestro/SKILL.md` (45 упоминаний `design`) — шаг 8: design→primary+custodian+primary writes; НЕ трогать `...-design.md` (имя spec-файла).
  - `skills/maestro-design/SKILL.md` (17) — шаг (a): design→новый флоу (primary brainstorm + custodian + primary writes); **это переработка, не rename**. Скилл/команда `/maestro-design` НЕ переименовываются.
  - `commands/maestro-design.md` (5) — строка 14: design→новый флоу.
  - `plugins/maestro-bootstrap/index.test.js` — `trust: { design }`, `Set(["design"])`, `res.agent === "design"` → `custodian` (иначе сломаются тесты плагина).
  - `maestro.json` (в целевом app-репо) — `trust.design`→`trust.custodian`, `agent.design.model`→`agent.custodian.model` (отдельная доставка).
  - `manual_docs/` (agents-and-trust, model-selection) — design→custodian role.
  - **НЕ рефеймится:** `commands/maestro-design.md`/`skills/maestro-design/SKILL.md` как скилл-команда (остаются `/maestro-design`), `...-design.md` (имя spec-файла).
  **custodian — единый Q/A-брокер по confidential** для основного pipeline и `/maestro-design`. Требует Task 7b.
- **OQ-8 (РЕШЕНО):** Порядок доставки рефейма vs конфиг `maestro.json`. custodian работает корректно (trusted, читает confidential) **только после** обновления `trust.custodian` / `agent.custodian.model` в конфиге. **Порядок:** (1) обновить `maestro.json`/app-конфиг (trust custodian) → (2) включить `agents/custodian.md` + `custodian-prompt.md` → (3) обновить `index.test.js` (тесты плагина) → (4) обновить SKILL.md/maestro-design/commands. **Блокер:** включение custodian без обновления trust-конфига делает его untrusted (не сможет читать confidential).
- **OQ-9 (РЕШЕНО):** Маршрут Spike — сквозной flow. Решение по рекомендациям:
  - **Изоляция НЕ требуется** (вывод не коммитится как фича); опционально — временный worktree для чистого прототипа, но **НЕ мержится и удаляется** после получения рекомендации.
  - **Pre-flight — минимум:** только `git status` (чтобы не наступить на чужие изменения). Baseline-тесты и полный pre-flight НЕ выполняются (feasibility не требует полного suite).
  - **Артефакты:** рекомендация — в ответе primary (не в spec-файле); throwaway-код — не коммитить (или удалить), не мержить в main.
  - **Канон Spike-path:** explore → вопрос + план (2-3 предложения) → HITL nod → исследование (дёшево) → рекомендация.
  - **Исследователь:** primary сам (feasibility — ресёрч, не код); при необходимости — диспатч `haiku` для прототипа.
  - **HITL-gates:** шаг 1 (выбор spike) + nod на план + финальный «принять/продолжить/отмена».
  - **Spike ≠ bugfix:** debug sub-pipeline (D1-D7) НЕ применяется (Spike — feasibility, не «почему сломано»).
  - **Выход:** после рекомендации HITL решает — оформить как feature / bugfix / завершить.
  - Шаги 11-18 (план/SDD/docs/review/merge) для Spike НЕ выполняются.
- **OQ-10 (РЕШЕНО):** Маркер provenance — **бинарный, без категории**.
  **Решение:** цель маркировки — формальный индикатор «секция основана на confidential» для HITL-решения (OQ-1). Категория не добавляет ценности для срабатывания HITL (custodian сам знает тип источника) и создаёт overhead (whitelist, валидация, риск совпадения с sanitizer). Поэтому:
  - **Формат маркера:** `из confidential` (без категории, без значений). Единый, строгий.
  - **Проверка:** маркер не вычищается sanitizer'ом (структурно безопасен — не чувствительное поле/значение); единичная проверка в рамках 8.6, без per-category валидации.
  - **Пометка custodian:** «эти данные из confidential» (без категории) → primary ставит маркер.
  - Снимается необходимость whitelist категорий и выбора категории.
- **OQ-11 (РЕШЕНО):** Жёсткий потолок brainstorm НЕ вводится. Причина: brainstorm у primary — **интерактив с пользователем** (primary↔HITL), пользователь — естественный контроллер длины (выбирает продолжить/упростить/стоп на любом раунде); автономного цикла без участия пользователя нет, поэтому предохранитель избыточен. Старый «max 3 re-dispatch» был нужен для субагентного brainstorm (автономки) — устранён переносом brainstorm на primary. Остаётся **«сходимость» как мягкий сигнал** (не жёсткий лимит): если вопросы перестали появляться → предложить HITL завершить. Если в будущем brainstorm вернётся в автономный контур — потолок вернуть; сейчас не нужно.
- **OQ-2 (РЕШЕНО):** Повторный прогон sanitizer (8.6) на Revise-цикле нужен **только при вовлечении trusted-контура** (особый случай (a) → trusted `custodian`; opus-trusted, B-5). На обычных opus-циклах (правки untrusted opus + применение оркестратором) повторный 8.6 **не нужен** — opus видит только очищенный spec (Слои 2/3), новые real-значения неоткуда; остаётся Ур.1 (Слой 5) при применении правки. Стоимость очистки снижается на чистых opus-циклах (B-3).
- **OQ-3 (РЕШЕНО):** Слой 5 — **process-требование с accepted risk, НЕ enforcement** (природа гарантии Слоя 5 — инструкция оркестратору, не код плагина). Обоснование усилено доверительной моделью:
  - **`.env`/приватные ключи → built-in confidential** (плагин, независимо от `confidential.paths`): `read/write/edit` для non-trusted и primary по `.env`, `.env.*`, `*.pem`, `*.key`, `*.crt`, `*.p12`, `*.pfx` → жёсткий deny (оформляется отдельным планом по плагину).
  - Primary поэтому **лишается доступа к `.env` и ключам** → основной риск «primary впишет секрет из .env в spec» снят.
  - Прочие секретные файлы (aws credentials, npmrc, netrc, kubeconfig, tfstate, docker config, нестандартные конфиги) — **в документации рекомендация** внести их в `confidential.paths`/`access_policy.deny` на этапе подготовки проекта.
  - Маскирование при edit primary (Ур.1) остаётся как **defense-in-depth** против просачивания секретов из не-confidential источников (вариант (a) — маскировать, не блокировать).
  - Требует отдельного плана по плагину (built-in confidential-набор) + фиксации в конфиге/документации.
- **OQ-4 (РЕШЕНО):** Лимит/критерий сходимости Revise-циклов через opus — **«плато замечаний» (вариант ii)**:
  - Если за **2 последовательных раунда** opus не добавил ни одного **нового** Critical/Important (только повторяет/уточняет прошлые) → оркестратор поднимает HITL: «Достигнуто плато: 2 раунда без новых Critical/Important. (a) Approve spec / (b) продолжить ещё / (c) follow-up оставшиеся».
  - Новый Critical/Important **обнуляет** счётчик «2 раунда».
  - Повторяющиеся не-закрытые замечания **не считаются** «новыми» → плато наступает.
  - Финальное решение — HITL; процесс сам сигнализирует зацикливание. Один принцип сходимости с brainstorm-лимитом (см. «Подготовка спецификации»). Требует новой задачи (guard сходимости) и гейта в HITL Gate Protocol.
- **OQ-5 (РЕШЕНО):** Механизм/формат spec-follow-up (из Особого случая шага 10b, вариант (b), и плато OQ-4, вариант (c)) — **переиспользуется flow шага 8.5 → план (шаг 11)**:
  - Оркестратор фиксирует spec-follow-up как **отдельный pending-список** (рядом с `pending context changes` / `pending cross-cutting changes`), с пометкой причины (по какой ветке OQ-1: «не хватает контекста» / «несущественно/scope»).
  - Каждый follow-up помечается **«не блокирует Approve»** (как в шаге 16).
  - На шаге 11 (writing-plans) spec-follow-up транслируется в задачи плана (или секцию плана).
  - Хранение — orchestral-состояние сессии, **не в spec-файле** (не загрязнять spec/подписи).
  - Единый путь с OQ-4 (плато: вариант (c) «follow-up оставшиеся»).
  - Требует новой задачи на расширение шага 8.5.

**Технические правки (внедрены в текст плана, B-1…B-7):**

- B-1: устранено внутреннее противоречие «полный цикл» vs «на diff»; формулировки приведены к нейтральному «полный прогон по актуальному содержимому» до решения OQ-2.
- B-2: добавлена проверка стыковки с fast-track (шаг 7d) и правилами подписей 5-6 (Task 4, Step 3).
- B-3: скорректировано «Обоснование» — честная оценка стоимости (не «дёшевле», а «без trusted-контура и с контролируемым составом правок»; на opus-циклах нет полного 8.6, ср. OQ-2).
- B-4: уточнено поведение sanitizer (Ур.2) на повторном 8.6 (Task 2, Step 2).
- B-5: оговорено поведение при trusted opus в maestro.json (Task 3, Step 3).
- B-6: помечено, что debug sub-pipeline (D1-D7) не затрагивается (Не входит в scope).
- B-7: определено хранение `previous_verdict`/`previous_findings` (orchestral-состояние, не в spec; связь с подписями) (Task 6, Step 1b).