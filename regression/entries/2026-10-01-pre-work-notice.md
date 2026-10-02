# Regression — pre-work-notice (4.22.0)

- **version:** 1
- **feature:** #117-решения §8.2–8.3 (pre-work notice + понимания-слой, 4.22.0): (а) на шаге 0, если `confidential.paths` непуст — одна строка о потоке данных (primary-модель: внешний API / локальная; сабагентам — только замаскированные тексты, Ур.1/2) + рекомендация про локальную (изолированную) модель; информационно — не гейт; (б) гейт 8.6 (FINDINGS_FOUND) — в сообщении гейта строка о потоке данных (N фрагментов, модель, замаскированное — Ур.1); (в) `manual_docs/reference/config.md` § `sanitizer_whitelist` — понимания-слой: назначение простыми словами + таблица «когда/зачем настраиваю» по 5 knobs с примерами + принципы (только ослабление, trusted-skip, Level-1 по форме, точность имени «whitelist» → 5.0). Docs-only: `skills/maestro/SKILL.md` (шаг 0), `skills/maestro/references/trust-and-security.md` (гейт 8.6), `manual_docs/{reference/config.md,explanation/pipeline-overview.md,reference/hitl-gates.md}`; плагин не затронут
- **added:** 2026-10-01
- **status:** active
- **risk:** LOW (каноны доков: SKILL.md-скелет + 1 reference-глава + 3 страницы manual_docs; плагин, конфиг, pipeline-логика не затронуты)
- **category:** `skills/maestro/SKILL.md` (шаг 0), `skills/maestro/references/trust-and-security.md` (гейт 8.6), `manual_docs/reference/config.md`, `manual_docs/explanation/pipeline-overview.md`, `manual_docs/reference/hitl-gates.md`
- **scenarios:**
  - **[Manual] pre-work notice:** проект с непустыми `confidential.paths` — на шаге 0 одна строка в сессию до начала работы (поток данных + рекомендация про локальную модель); не гейт — работа продолжается без подтверждения.
  - **[Manual] гейт 8.6 FINDINGS_FOUND:** при находках sanitizer в спеке — в сообщении гейта строка о потоке данных (N чувствительных фрагментов уйдут untrusted-сабагентам в замаскированном виде, модель — Ур.1); варианты (a)/(b)/(c) и порядок гейта не изменились.
  - **[Auto] `npm test`:** зелёный — 285/285; drift-тест D4: «выполнены (4.22.0, …)» в roadmap ↔ changelog 4.22.0 согласовано; D1a/D1b — bump 4.22.0 на merge.
- **regressions:** ⚑1–4 не затрагиваются;
  - (a) **гейты/нумерация SKILL.md не сдвинуты** — notice добавлен буллетом внутри шага 0 (без нового шага); информационный характер — не блокирует старт;
  - (b) **гейт 8.6** — только информационная строка в сообщении; варианты (a)/(b)/(c) и авто-политика security-гейтов без изменений;
  - (c) **config.md** — переписан только понимания-слой § `sanitizer_whitelist`; JSON-примеры и дефолты конфига без изменений (плагин не затронут).
- **links:** changelog `[2026-10-01]` (4.22.0) | анализ §8 `docs/superpowers/analysis/2026-10-01-sanitizer-whitelist.md` | `regression/entries/2026-10-01-sanitizer-hardening.md` (4.21.0)

## Follow-up

— (переименование `sanitizer_whitelist` (`sanitizer`/`allow_values`) — 5.0,
breaking, по §8 анализа; Level-2 — кандидаты 5.0)

## Dogfooding

— (первый живой прогон: следующий пайплайн в проекте с непустыми
`confidential.paths` — строка notice на шаге 0; гейт 8.6 — следующий
spec-цикл с findings sanitizer)
