# План: режимы запуска `@maestro-init` (manual / auto-answer / auto-ai)

- **Дата:** 2026-09-15
- **Ветка:** `feature/maestro-run-modes`
- **Спека:** `docs/superpowers/specs/2026-09-15-maestro-init-run-modes-design.md`
- **Фазы:** Phase 1 (manual + auto-answer) · Phase 2 (auto-ai, ralph loop)

## Phase 1 — manual + auto-answer

### Задачи

1. **Spec + plan** (этот документ + спека). Commit: `docs: design + plan for run-modes`.
2. **`commands/maestro-init.md`** — таблица режимов, флаги `--auto-answer`/`-aa`,
   `--auto-ai`/`-ai`, `--no-auto`; правило парсинга (флаг убрать из текста задачи,
   передать режим в pipeline); bullet в «Ключевые правила».
3. **`skills/maestro/SKILL.md`**:
   - Mode protocol (Overview): подсекция «Режимы запуска» — философия manual /
     auto-answer / auto-ai, ссылка на инварианты ⚑1–4.
   - HITL Gate Protocol: новый пункт **3в «Режимы запуска»** — перечень авто-гейтов
     auto-answer, никогда-не-авто список, формат уведомления `[auto-answer] шаг N: …`,
     sensitivity guard, правило «нет рекомендации → HITL», авто-режимы не персистятся.
   - Инлайн-заметки на шагах: 0, 1, 1.5, 2, 7 (+7d), 9 (+дубль в «Подписи spec-файла»),
     12 (guard); на 10 и 17 — «всегда HITL, в т.ч. в авто-режимах (⚑2/⚑1)».
     На шаге 10 — формулировка ⚑2: «принятие спеки — только явная команда
     («спека принята» / буква варианта); «продолжай»/«ок»/молчание ≠ принятие;
     шаг 11 не начинается до явного принятия».
   - Anti-patterns: примечание к строке «Chain-approval» — явные флаги
     `--auto-answer`/`--auto-ai` — единственное санкционированное исключение,
     только для гейтов из перечня.
4. **`SECURITY.md`** — инвариант: авто-режимы (`--auto-answer`/`--auto-ai`) не
   распространяются на security-гейты (8.6, Точка 2, File access, P5), гейты 10
   (⚑2) и 17 (⚑1), и чувствительные изменения (⚑4).
5. **`manual_docs/reference/hitl-gates.md`** — секция «Режимы запуска»: таблица
   гейтов по режимам, never-список, sensitivity guard, инварианты ⚑1–4.
6. **`manual_docs/reference/commands.md`** — `/maestro-init` синтаксис с флагами.
7. **`manual_docs/explanation/pipeline-overview.md`** — 1–2 предложения в секции
   HITL-гейтов.
8. **`manual_docs/explanation/agents-and-trust.md`** — 1 строка (синх SECURITY.md).
9. **`README.md`** — пример использования с флагами режимов.
10. **`manual_docs/tutorials/run-first-feature.md`** — заметка о режимах (опц.).

### Верификация Phase 1

- grep-сверка перечней гейтов: SKILL.md ↔ hitl-gates.md ↔ commands.md.
- Инварианты ⚑1–4 и security-гейты в never-списке во всех трёх.
- Нет остаточных имён: `--solo`, `--autopilot`, `--manual` (как флага).
- Diff-сверка: каждое изменение поведения покрыто в `manual_docs/`.
- Язык — русский.

## Phase 2 — auto-ai (отдельный цикл)

- Интеграция ralph loop (state-файл, паузы на гейтах 10/17, `/cancel-ralph`,
  max-итерации) в SKILL.md.
- Правила доп. анализа: что ИИ решает сам (маршрут, project-context, контентные
  вопросы, Spec Review offer, docs-шаг), жёсткий пол (TDD, task-review, SEC-3,
  шаг 15, security, ⚑1–4), гибридные security-гейты, fallback неоднозначности.
- Security-усиления (спека §6): правило направления (только risk-reducing авто),
  механический пол не снимается; R1 прозрачность (журнал + сводка на гейтах
  10/17), R2 анти-тупик (deny не ретраится, контекст через промпт), R3 тревожная
  плотность findings → пауза с HITL, R4 P5 — предпосылка режима (fail-closed).
- **Модель принятия решений (спека §6):** decision-prompt-файл
  `skills/maestro/auto-ai-decision-prompt.md` (по аналогии с custodian/spec-review
  промптами; self-contained) для диспатча sonnet/opus; таблица «Decision → Tier»
  в Model Selection (SKILL.md) — механический уровень (оркестратор сам) /
  средний (`sonnet`, батчи) / сложный (`opus`) / эскалация sonnet→opus /
  fallback (консервативный путь); журнал решений (формат записи: решение +
  обоснование + confidence + источник); sanitize перед untrusted-диспатчем
  (Точка 2); confidential-зависимые вопросы → trusted `custodian`.
- Документация auto-ai в manual_docs + команды.

## TDD-замечание

Изменения — markdown-контент (промпты/доки), плагин не затрагивается:
автоматических тестов нет. Верификация — diff-сверка против спеки + grep-сверка
консистентности перечней.
