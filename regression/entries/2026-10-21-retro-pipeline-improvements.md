# Regression — Retro Pipeline Improvements (P1–P7)

- **version:** 1
- **feature:** процессные улучшения из ретроспективы docker-serve: авто-зона вопросов в -aa/-ai (P1), семантика push≠merge (P2), статус-дисциплина pipeline (P3), batched task-review с ruling (P4), git-гигиена оркестратора (P5), 18.5 auto без молчаливого пропуска (P6), полный диф на гейте 17 + сверка коммита шага 12 (P7)
- **added:** 2026-10-21
- **anchor:** 5cdee45710e0781930b695b06a4734f5809dd03 (HEAD при записи)
- **status:** active
- **risk:** MEDIUM — канонные правила без механического enforcement (LLM-исполняемые): дрейф исполнения (вопросы-подтверждения возвращаются, push снова трактуется как approval, ревью пропускаются молча); ослабление hard-floor формулировки task-review (batching) при отсутствии ruling-дисциплины
- **category:** process canon (auto-modes, gates 12/17/18.5, SDD review modes, git hygiene)
- **scenarios:**
  - **unit:** `npm test` — все PASS (docs-drift: версии/имена синхронны; плагин не менялся)
  - **grep:** `grep -c "Авто-зона (обратная сторона контракта)" skills/maestro/references/hitl-gate-protocol.md` → 1
  - **grep:** `grep -c "Семантика push ≠ merge approval" skills/maestro/references/hitl-gate-protocol.md` → 1
  - **grep:** `grep -c "Режимы task-review" skills/maestro/SKILL.md` → 1 (ruling-требования присутствуют)
  - **[Manual] retro-P1:** следующий прогон в -aa/-ai задаёт вопросы только на named-гейтах (10/17) + security при FINDINGS; «продолжаю?»-вопросы отсутствуют; авто-решения — строками `[auto-answer]`/`[auto-ai]`
  - **[Manual] retro-P2:** после команды «пуш» гейт 17 остаётся обязательным; маркер создаётся только после явного (a)/семантики мержа; keyword-матчинг неоднозначной реплики → HITL
  - **[Manual] retro-P4:** batched-режим всегда с ruling (причина/состав/риск) в ledger; молчаливый пропуск отсутствует
  - **[Manual] retro-P7:** гейт 17 показывает полный `git diff <mainline>...HEAD` (не только --stat); коммит шага 12 содержит и spec, и plan (сверка staging)
  - **[Manual] retro-P3/P5:** resume после компакции — через pipeline status get + ledger + git log; stash-drop только после осмотра
