# План: Тесты и предупреждения для un-trusted custodian/sanitizer

> **Статус:** зафиксирован 2026-08-27. Репо: `maestro-agent` (authoring).
> **Источник:** анализ расхождения промпт ↔ enforcement: промпты агентов
> заявляют «Ты trusted» как факт, но доверие определяется только плагином по
> `maestro.json`. Снятие `trust.custodian: false` / `trust.sanitizer: false`
> делает агентов **неработоспособными** (не «менее доверенными»), но это нигде
> не протестировано и не предупреждено.

## Проблема

Trust — runtime-решение плагина (`core.js:383 loadTrustConfig`), не свойство
агента. Цепочка при `trust.custodian: false` / `trust.sanitizer: false`:

1. `loadTrustConfig` не включает агента в `trustedAgents` Set.
2. Dispatch prompt sanitize (`core.js:1029`): `!trustedAgents.has(agent)` →
   промпт **санизируется** (Ур.1 маскирует sensitive-данные).
3. Confidential read (`core.js:958-966`): `resolveIsTrustedSubagent` →
   `trusted: false` → `resolveConfidentialAction` → **`"deny"`**.
4. Built-in `.env`/ключи — тоже deny (тот же путь).
5. File access control — агент подпадает под `access_policy` (ask/deny).

**Особый случай — sanitizer:** санизация промпта диспатча создаёт **рекурсию** —
sanitizer должен видеть raw-данные, чтобы их пометить, но Ур.1 маскирует их до
того, как sanitizer их увидит. Поэтому SKILL.md (`:975`) говорит «промпт не
санизируется — рекурсии нет» — это работает **только когда sanitizer trusted**.

**Промпты лгут агенту:** `agents/custodian.md:18` и `agents/sanitizer.md:17`
заявляют «Ты **trusted**» как абсолютный факт, не упоминая, что доверие
определяется конфигом и может быть снято. Это fail-closed (безопасно — доступ
блокируется), но промпт вводит агента в заблуждение.

---

## Task 1 — Юнит-тесты плагина: un-trusted custodian/sanitizer enforcement

**Файлы:**
- Modify: `plugins/maestro-bootstrap/index.test.js`

**Структура:** разбить на **два describe-блока** (разные конфиги + разная
инфраструктура mock). Существующий тест L597 (`"skips sanitize for trusted
subagent (sanitizer)"`) уже покрывает trusted-sanitizer → промпт не санизируется;
новые тесты добавляют trusted-custodian контроль и un-trusted сценарии.

### Блок 1: `"un-trusted custodian/sanitizer: confidential deny"`

Использует паттерн из `"confidential enforcement"` (L1084): `makeClient` mock с
сессиями, `maestro.json` с `trust: { custodian: false }`, секция
`confidential.paths` присутствует.

- [ ] **Step 1:** Создать describe-блок + before/after (по паттерну L1084):
  `trust: { custodian: false }`, `confidential: { paths: ["docs/confidential/**"] }`.
  Сессии: `childUntrusted` (mode: custodian — агент с именем custodian, но не в
  trust-сете).

- [ ] **Step 2:** Тест: **un-trusted custodian — confidential read deny.**
  Сессия `childUntrusted` (mode: custodian). Диспатч `read` →
  `docs/confidential/secrets.md` → `rejects /confidential:deny/`.
  Проверяет: агент с именем custodian, но не в trust-сете → deny (не trusted
  по имени, а по `maestro.json`).

- [ ] **Step 3:** Тест: **un-trusted custodian — `.env` deny (built-in).**
  Тот же конфиг. Диспатч `read` → `.env` → `rejects /confidential:deny/`.
  Проверяет: built-in deny работает для un-trusted custodian.

### Блок 2: `"un-trusted custodian/sanitizer: prompt sanitize"`

Использует паттерн из `"trusted skip"` (L560, БЕЗ client mock — `task`-sanitize
проверяет `trustedAgents.has(subagent_type)` без session resolution). Несколько
конфигов — через inline temp dirs (по паттерну L1158 `dir2`).

- [ ] **Step 4:** Тест: **un-trusted custodian — dispatch prompt sanitized.**
  Inline temp dir с `trust: {}` (пустой). Диспатч `task` с
  `subagent_type: "custodian"` и промптом `POSTGRES_PASSWORD=s3cr3t`. Проверить:
  `output.args.prompt` не содержит `s3cr3t` (или содержит `<redacted>`).
  Без проверки лога — по паттерну L603-606.

- [ ] **Step 5:** Тест: **un-trusted sanitizer — dispatch prompt sanitized (рекурсия).**
  Inline temp dir с `trust: { custodian: true }` (sanitizer не в trust). Диспатч
  `task` с `subagent_type: "sanitizer"` и промптом `POSTGRES_PASSWORD=s3cr3t`.
  Проверить: `output.args.prompt` не содержит `s3cr3t`. Проверяет: промпт
  sanitizer санизируется (рекурсия — sanitizer не видит raw для пометки).

- [ ] **Step 6:** Тест: **trusted custodian — dispatch prompt NOT sanitized (контроль).**
  Inline temp dir с `trust: { custodian: true }`. Диспатч `task` с
  `subagent_type: "custodian"` и промптом `POSTGRES_PASSWORD=s3cr3t`. Проверить:
  промпт **не изменён** (содержит `s3cr3t`). Проверяет: trusted → skip sanitize.
  (Существующий L597 покрывает trusted-sanitizer; этот тест добавляет
  trusted-custodian для полноты.)

**Проверка:** `npm test` — все тесты зелёные (ожидается 166 + ~6 новых = ~172).

---

## Task 2 — Чеклист песочницы: сценарии un-trusted custodian/sanitizer

**Файлы:**
- Modify: `docs/testing/maestro-sandbox-checklist.md`

- [ ] **Step 1:** Добавить в секцию **D. Безопасность** (после D6) два сценария:
  - `D7` | Un-trusted custodian: `trust.custodian: false` → confidential deny | ❌ |
    custodian не читает `docs/confidential/**` и `.env`; промпт санизируется;
    агент non-functional (не fallback). Проверить audit-лог `confidential:deny`.
  - `D8` | Un-trusted sanitizer: `trust.sanitizer: false` → промпт санизируется | ❌ |
    промпт sanitizer маскируется Ур.1 (рекурсия) → не видит raw для пометки;
    агент non-functional. Проверить `sanitizer.redacted` в логе.

- [ ] **Step 2:** Добавить в секцию **A. Базовые / конфигурационные** один сценарий:
  - `A7` | Un-trusted custodian/sanitizer — юнит-тесты плагина | ✅ |
    `npm test` покрывает `trust.custodian: false` / `trust.sanitizer: false`
    (Task 1, Step 2–5).

**Проверка:** чеклист содержит D7/D8 и A7; формулировки согласованы с D5
(trusted-opus).

---

## Task 3 — Промпты агентов: предупреждение о зависимости trust от конфига

**Файлы:**
- Modify: `agents/custodian.md`
- Modify: `agents/sanitizer.md`

- [ ] **Step 1:** `agents/custodian.md` — раздел «Контекст доверия» (L16-20).
  Текущий текст: «Ты **trusted** (отмечен в `maestro.json` → секция `trust`).»
  Уточнить: «Ты предполагаешься **trusted** по умолчанию (по роли; `maestro.json`
  → `trust.custodian: true`). Если `trust.custodian: false` или absent — ты
  **untrusted**: твои попытки читать confidential будут заблокированы плагином,
  промпт диспатча санизируется, и ты не сможешь выполнить свою роль. Доверие
  определяется конфигом, не этим промптом.»

- [ ] **Step 2:** `agents/sanitizer.md` — раздел «Контекст доверия» (L15-19).
  Текущий текст: «Ты **trusted** (отмечен в `maestro.json` → секция `trust`).»
  Уточнить аналогично + специфичное для sanitizer: «Если `trust.sanitizer: false`
  — промпт диспатча санизируется Ур.1 **до** того, как ты его увидишь: ты не
  сможешь пометить raw-данные (рекурсия). Sanitizer non-functional без trusted.»

**Проверка:** промпты корректно описывают зависимость доверия от конфига;
fail-closed поведение задокументировано.

---

## Task 4 — Документация: предупреждение о non-functional без trust

**Файлы:**
- Modify: `skills/maestro-assistant/SKILL.md` (trust-канон)
- Modify: `skills/maestro/SKILL.md` (Trust-матрица, примечание custodian/sanitizer)
- Modify: `SECURITY.md` (P1/P4 — инвариант non-functional)

- [ ] **Step 1:** `skills/maestro-assistant/SKILL.md` — секция trust (L74/L90).
  Добавить предупреждение после правил trust:
  «⚠️ Снятие `custodian`/`sanitizer` из `trust` (или `false`) делает агента
  **неработоспособным**: confidential-deny + sanitize промпта. Это не
  «понижение доверия» — агент не может выполнять свою роль. Для custodian:
  нет чтения confidential; для sanitizer: рекурсия (промпт санизируется до
  него). Не удаляйте их из trust без понимания последствий.»

- [ ] **Step 2:** `skills/maestro/SKILL.md` — Subagent Trust Matrix (примечание
  custodian/sanitizer). Добавить к строкам custodian/sanitizer:
  «Если `trust: false`/absent — агент non-functional (confidential deny + sanitize
  промпта); не fallback, а блокировка роли.»

- [ ] **Step 3:** `SECURITY.md` — P1/P4. Добавить инвариант:
  «Снятие `custodian`/`sanitizer` из `trust` → агент non-functional (не fallback):
  confidential-deny + sanitize промпта. Для sanitizer — рекурсия (Ур.1 маскирует
  raw до него). Это fail-closed по дизайну.»

- [ ] **Step 4:** Синхронизировать `manual_docs/explanation/agents-and-trust.md`
  (по правилу SECURITY.md → manual_docs): добавить предупреждение в секцию
  «Модель доверия» (L26) или «Роли агентов» (L11).

- [ ] **Step 5:** `skills/maestro/SKILL.md` — «Обработка сбоев» (после строки
  «Spec review: reject»). Добавить строку:
  «`custodian`/`sanitizer` вернул `confidential:deny` → проверить
  `maestro.json` → `trust`: если агент untrusted (absent/`false`) — он
  non-functional; предупредить пользователя: "custodian/sanitizer не trusted
  (проверьте `maestro.json` → `trust`), без доверия агент не может выполнять
  свою роль" → HITL: (a) обновить конфиг и перезапустить / (b) стоп. Не
  ретраить как обычную ошибку сабагента.»

**Проверка:** `rg "non-functional|неработоспособ" skills/ SECURITY.md manual_docs/`
находит предупреждения во всех 4 файлах; SKILL.md «Обработка сбоев» содержит
строку про `confidential:deny` от custodian/sanitizer.

---

## Порядок реализации

1. **Task 1** (юнит-тесты) — блокер; проверяет enforcement в коде.
2. **Task 2** (чеклист) — зависит от Task 1 (ссылается на юнит-тесты).
3. **Task 3** (промпты) — независимо; можно параллелить.
4. **Task 4** (документация) — после Task 3 (согласование формулировок).
5. Финальная проверка: `npm test` зелёные; `rg "non-functional|неработоспособ"`
   находит предупреждения; чеклист содержит D7/D8/A7.
6. Не коммитить без явного запроса.

## Не входит в scope

- Изменение логики плагина (fail-closed корректен; меняются только тесты + тексты).
- Изменение default trust (custodian/sanitizer остаются trusted по умолчанию).
- Запрет на снятие trust (пользователь имеет право; добавляется только
  предупреждение о последствиях).
