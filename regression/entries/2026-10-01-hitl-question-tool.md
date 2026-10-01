# Regression — hitl-question-tool (4.20.0)

- **version:** 1
- **feature:** вопрос-тул (question tool) для всех выбор-гейтов (#87, 4.20.0): «Правило вопросов (UX)» — все HITL-гейты с **закрытым набором вариантов** подаются через панель (decision 2/7/10/12/17, контентные вкл. 7b без (Recommended), предпочтения 0/1/1.5, security 8.6/Точка 2, D5/гейт 16, 13f, docs-расхождение 14, Tier 3, 15/15a, 9-offer, spike-гейты); текст — free input; fallback (harness без тула/сбой) — (a)/(b)/(c) текстом; пакет 3–4 — один multi-question вызов; 13f batch — multi-question (вопрос на каждое расхождение); варианты-со-значением — двухшагово. Каноны доков; плагин, SKILL.md (скелет), конфиг не затронуты
- **added:** 2026-10-01
- **status:** active
- **risk:** LOW (каноны доков: глава `skills/maestro/references/hitl-gate-protocol.md` + `manual_docs/reference/hitl-gates.md`; плагин, конфиг, pipeline-код не затронуты; fallback сохраняет предыдущее поведение в harness'ах без тула)
- **category:** `skills/maestro/references/hitl-gate-protocol.md` («Правило вопросов (UX)», п. 3а), `manual_docs/reference/hitl-gates.md` (п. 6 + fix дрейфа гейта 16)
- **scenarios:**
  - **(auto) `npm test`:** зелёный — 266/266; drift-тест D4: «Выполнено (4.20.0, …)» в roadmap и «реализовано (2026-10-01, 4.20.0, #87)» в TODO ↔ changelog 4.20.0 согласовано; `changelog.md` исключён из D1c (история версий); D1a/D1b — bump 4.20.0 в package.json/project-context/AGENTS — на merge.
  - **[Manual] HITL-гейт в OpenCode:** выбор-гейт (напр. 10/12/17, 7b, плато, 13f) подаётся через question tool — выбор варианта панели (label + description) / Escape (закрытие без выбора) / авто-опция «ввести свой ответ» (free-form в панели); recommended (3а) — первый вариант + «(Recommended)» в label + «потому что Y» в description; пакет 3–4 связанных закрытых вопросов — один multi-question вызов (навигация между вопросами до submit); 13f batch — вопрос на каждое расхождение (options a/b/c).
  - **[Manual] harness без тула (Claude Code и др.) или сбой тула:** (a)/(b)/(c) текстом в сообщении (предыдущее поведение); 13f batch — текст-fallback со списком расхождений.
- **regressions:** ⚑1–4 не затрагиваются; плагин, конфиг и SKILL.md (скелет) не изменены;
  - (a) **ослабление «подтверждения только явным выбором»** — нет: клик по варианту панели = явная буква (в т.ч. ⚑2 гейт 10 — «явная команда»: выбор (a) Approve); в панели нет варианта «молчание/continue-по-умолчанию»; Escape/нет ответа = «нет ответа» → STOP, пауза (п. 3) — **не** recommended-дефолт; «continue»/«ок» — по п. 3 (1 шаг, не цепочка); введённый в авто-опцию ответ — по п. 3/3а;
  - (b) **сбой тула** — деградация на текст-fallback (a)/(b)/(c), гейт не теряется.
- **links:** changelog `[2026-10-01]` (4.20.0) | `manual_docs/reference/hitl-gates.md` | спека `docs/superpowers/specs/2026-10-01-hitl-question-tool-design.md` | план `docs/superpowers/plans/2026-10-01-hitl-question-tool-plan.md`

## Follow-up

— (FU из спеки нет; known — «(Recommended)» как конвенция тула OpenCode — зафиксирован в каноне и changelog)

## Dogfooding

Spike-сессия 2026-09-30 → 10-01: вопрос-тул использован ~10 раз (гейты
10/17 ×4, дизайн-вопросы #85/#97/#103, 13f-HITL) — все отработали, **в т.ч.
free-form**: на дизайн-вопросе #103 пользователь ответил текстом через
авто-опцию «ввести свой ответ» → панель не лишает возможности отказаться от
вариантов. С dogfood-merge все HITL-гейты подаются через панель по новому
правилу (само подтверждение фичи).
