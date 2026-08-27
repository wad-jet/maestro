# План: Исправления по итогам ревью рефейма design→custodian

> **Статус:** зафиксирован 2026-08-27. Репо: `maestro-agent` (authoring).
> **Источник:** итоговое ревью выполненных изменений (Фазы 1–9 плана `spec-revise-consolidated-plan.md`).

## Проблема

Рефейм `design` → `custodian` **не полный**: в нескольких файлах, которые генерируют/описывают
конфигурацию trusted-моделей, остался старый агент `design`. Это ломает суть рефейма (OQ-8):
при свежем `/maestro-init` / `/maestro-assistant` сгенерируется `trust.design`, а не
`trust.custodian` → custodian **untrusted** → не сможет читать confidential.

План `spec-revise-consolidated-plan.md` в OQ-7 перечислял `rg "design"` только по
`agents/design`, `design-prompt`, `SKILL.md`, `maestro-design`, `commands/maestro-design`,
`index.test.js`, `maestro.json`, `manual_docs` — и **не включил** `maestro-init`,
`maestro-assistant`, `test-agents`, `maestro`, `SECURITY.md`, `plugin README`. Это пробел
инвентаря, воспроизведённый в реализации.

Дополнительно: в `skills/maestro/SKILL.md` при редактировании потеряны ведущие отступы
в 4 строках (ломают вложенность markdown-списков шагов).

---

## Priority 1 (Critical) — завершить рефейм design→custodian

Цель: `rg "\bdesign\b"` в `skills/ commands/ agents/ SECURITY.md plugins/maestro-bootstrap/README.md`
= 0 (кроме легитимных: `/maestro-design`, `*-design.md`, «design judgment»,
«design → spec → plan» как фаза, «design + plan» как commit-сообщение, «to produce design»).

### Файл 1: `skills/maestro-init/SKILL.md` (7 правок)
- [ ] L131: `` `trust` — всегда `design: true`, `sanitizer: true` `` → `` `custodian: true` ``
- [ ] L154: `design→opus, opus→opus` → `custodian→opus, opus→opus`
- [ ] L156: `design ✅ + sanitizer ✅` → `custodian ✅ + sanitizer ✅`
- [ ] L158: `` `design` и `sanitizer` — **оба trusted** `` → `` `custodian` и `sanitizer` ``
- [ ] L167: `tier-подсказка (design→opus-модель;` → `custodian→opus-модель;`
- [ ] L188: `` | `design` | opus | 0.1 | `` → `` | `custodian` | opus | 0.1 | ``
- [ ] L197: `agent.{design,haiku,` → `agent.{custodian,haiku,`

### Файл 2: `skills/maestro-init/init-context.md` (1 правка)
- [ ] L136: `` `trust` — всегда `design: true`, `sanitizer: true` `` → `` `custodian: true` ``

### Файл 3: `skills/maestro-assistant/SKILL.md` (3 правки)
- [ ] L49: `"trust": { "design": true, "sanitizer": true }` → `"custodian": true`
- [ ] L74: `` `design` и `sanitizer` — trusted по роли `` → `` `custodian` и `sanitizer` ``
- [ ] L90: `` `trust`: всегда `design: true` `` → `` `custodian: true` ``

### Файл 4: `commands/test-agents.md` (3 правки)
- [ ] L4: `` `design`, `haiku`, `` → `` `custodian`, `haiku`, ``
- [ ] L23: `| design | OK / FAIL |` → `| custodian | OK / FAIL |`
- [ ] L50: `` trusted-агента (`design`, `sanitizer`) `` → `` (`custodian`, `sanitizer`) ``

### Файл 5: `commands/maestro.md` (1 правка; L2 «design → spec → plan» — легитимная фаза, НЕ трогать)
- [ ] L8: «Координируй субагентов (`design`, `haiku`, ...)» → `(`custodian`, `haiku`, ...)`

### Файл 6: `SECURITY.md` (2 правки — P1, P4)
- [ ] L28: `` trusted-агентам по имени (`design`, `sanitizer`) `` → `` (`custodian`, `sanitizer`) ``
- [ ] L37: `` trusted-агенты (`design`, `sanitizer`) `` → `` (`custodian`, `sanitizer`) ``

### Файл 7: `plugins/maestro-bootstrap/README.md` (1 правка)
- [ ] L168: `    "design": true,` → `    "custodian": true,`

**Проверка Priority 1:**
```bash
rg -n "\bdesign\b" skills/ commands/ agents/ SECURITY.md plugins/maestro-bootstrap/README.md \
  | rg -v "maestro-design|design-prompt|-design\.md|design judgment|design→custodian|design-документ|design review|design\+|design-|to produce design|Do NOT design|design risks|design: completeness|design follow|design →|design + plan|design+plan|design-диалог|Дизайн|дизайн"
# ожидается: пусто
npm test --prefix plugins/maestro-bootstrap
# ожидается: 166/166 pass
```

---

## Priority 2 (Important) — отступы в `skills/maestro/SKILL.md`

4 строки потеряли ведущие пробелы при редактировании (столбец 0/1 вместо 7–8).
Восстановить отступ соседних bullets.

- [ ] **L316** `— **HITL не требуется.** Изменения контекста будут зафиксированы` → +8 пробелов (как у L315).
- [ ] **L352** `— **Перезапуск 8.6 (OQ-2):** полный прогон` → +8–9 пробелов (как у L351).
- [ ] **L365** `Spec написан primary (шаг 8, brainstorm + custodian Q/A) или взят внешним` → +8–9 пробелов (как у L364); выровнять L366 `(fast-track, шаг 7d).`.
- [ ] **L384** `- Промпт ревьюера: \`spec-review-prompt.md\` из этого скилла` → 7 пробелов (как у L381).

**Проверка Priority 2:** прочитать L313–325, L349–366, L381–394 — списки визуально вложены корректно.

---

## Priority 3 (Minor)

- [ ] **3.1 — manual_docs-синхронизация с SECURITY.md:** после правки SECURITY.md (P1/P4)
  убедиться, что `manual_docs/explanation/agents-and-trust.md`, `reference/model-selection.md`,
  `reference/config.md` уже на `custodian` (обновлены в Фазе 8). Работы нет; только проверка:
  `rg "\`design\`" trusted` — пусто в этих 3 файлах.
- [ ] **3.2 — Changelog-формулировка (OQ-3 built-in):** в `manual_docs/overview/changelog.md`
  запись «Встроенный confidential» описывает секцию `docs/confidential/**`, а не **новый built-in
  набор** (`.env`/`*.pem`/...). Уточнить формулировку на «Built-in confidential (OQ-3):
  `.env`/`*.pem`/`*.key`/`*.crt`/`*.p12`/`*.pfx` — deny для primary/non-trusted по умолчанию,
  расширяет `confidential.paths`».
- [ ] **3.3 — Закрыть пробел инвентаря OQ-7:** в `specs/spec-revise-consolidated-plan.md` секцию
  OQ-7 дополнить явным списком (maestro-init, maestro-assistant, test-agents, maestro,
  SECURITY.md, plugin README), чтобы будущие рефеймы не повторили пробел.

---

## Порядок исполнения

1. Priority 1 (7 файлов, ~18 точечных замен) — блокер.
2. Priority 2 (4 отступа в SKILL.md).
3. Priority 3 (changelog + проверка manual_docs + инвентарь OQ-7).
4. Финальная проверка: `npm test` (166/166) + `rg "design"` глобально (кроме легитимных) = пусто.
5. Не коммитить без явного запроса.