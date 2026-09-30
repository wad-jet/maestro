# Plan: скилл `maestro-memory` (4.15.0)

**Спека:** `docs/superpowers/specs/2026-09-30-maestro-memory-skill-design.md` (принята гейтом 10)
**Ветка:** `feature/maestro-memory-skill` (от `e346a23`) · **Режим:** auto-ai · **Средняя**

## Задачи (SDD: implementer + task-reviewer per task)

### T1 — скилл: ядро + 5 references (sonnet)
1. `skills/maestro-memory/SKILL.md` (ядро, **≤120 строк**):
   - frontmatter: `name: maestro-memory`; description: «Канон промтов команд `@maestro-memory*`
     (статус/отчёт/prune/reindex/backup). Загружается командами; из пайплайна maestro
     не загружается»
   - язык-правило (русский)
   - «Гейт доступности» — устойчивая нумерация **1.1/1.2/1.3…**, порядок
     **config-first**: 1.1 `maestro_config`-гейт (недоступен → «Перезапустите
     opencode / обновите плагин maestro-bootstrap (≥ 4.9.0)», дистинкция по
     `.maestro/plugin-version`; конфиг НЕ читать — bash-fallback запрещён);
     1.2 union-чтение секции `memory` **однажды**: `memory.enabled`,
     `memory.storage.type`, `memory.module_dir`; 1.3 классификация
     `disabled_reason` (полный список кодов — дословно из `commands/maestro-memory.md`
     шаг 1.2); 1.4 `memory_probe`-диагностика (off-состояние при
     `embedder_probe_hard_fail` + по `FAIL` в статусе)
   - **финальные off-сообщения НЕ в ядре** (ядро даёт состояние + reason-код;
     сообщение выводит off-секция reference)
   - порядок: **гейт до reference-флоу**; off → читается только off-секция
     `references/<x>.md` (конвенция: off-секция — первая секция каждого reference)
   - SEC-4b — одно общее правило (enforcement-детали — в report.md)
   - таблица указателей: `@maestro-memory` → `references/status.md`,
     `@maestro-memory-report` → `references/report.md`, `@maestro-memory-prune` →
     `references/prune.md`, `@maestro-memory-reindex` → `references/reindex.md`,
     `@maestro-memory-backup` → `references/backup.md` + правило «тела команд —
     тонкие лоадеры, канон в командах не дублируется»
2. `skills/maestro-memory/references/` — 5 файлов из тел команд (источник —
   `e346a23:commands/maestro-memory*.md`):
   - **правила:** off-секция — первая секция; внутренняя нумерация шагов
     сохраняется (в report.md «Шаг 1a»/«3.5»/«5»/«6» — без перенумерации);
     переприцелинка: «@maestro-memory шаг 1.2»/«как в @maestro-memory» → «Гейт
     доступности, п. 1.2 (ядро скилла `maestro-memory`)»; «см. `@maestro-memory`» →
     «гейт доступности (ядро скилла)»; квалификация «команда `@…`»/«скилл
     `…»` — везде
   - `status.md` (из maestro-memory.md): off-секция = текущее off-сообщение status
     («Память maestro выключена — включите memory.enabled: true» и ветвления);
     шаг 1.2 → в ядро (не дублировать); **шаг 2 переформулирован:** «из секции
     `memory`, прочитанной гейтом» (повторное чтение запрещено; таблица дефолтов —
     здесь); шаг 3 отчёт (шаблон, диагностика, не-индексированные сессии,
     audit-log, «(см. Шаг 1)» → «(см. Гейт доступности, ядро)»)
   - `report.md` (из maestro-memory-report.md): off-секция = текущее
     off-сообщение report; шаг 1 — только ветвления (маestro_config-гейт и
     классификация → ядро; union-поля — уже от гейта); Шаг 1a (sqlite-fallback,
     `module_dir` — от гейта), шаг 2, 3 (3.1–3.7), 4, 5, 6 — дословно; ссылки
     «как в `@maestro-memory` шаг 1.2» → «Гейт доступности, п. 1.2 (ядро)»
   - `prune.md` / `reindex.md` / `backup.md`: off-секция = шаблон («выведи
     причину по reason-коду из гейта + рекомендацию по исправлению (включая
     `memory_probe`-диагностику при `embedder_probe_hard_fail`)»); тела — дословно,
     «см. `@maestro-memory`» → «гейт доступности (ядро скилла)»
3. Commit: `feat(memory-skill): T1 — скилл maestro-memory: ядро + 5 references`

### T2 — тонкие команды + доставка + тесты (haiku, TDD)
1. **Сначала тесты (красные):**
   - `maestro-install/commands-skill-coverage.test.mjs`: каждая из 5
     `commands/maestro-memory*.md` содержит `maestro-memory` (скилл) + свой
     `references/<x>.md` (маппинг: memory→status, report→report, prune→prune,
     reindex→reindex, backup→backup; файл существует) + `path: skills/maestro-memory`
     в обоих agpack.yml
   - `skills/maestro-memory/references-coverage.test.mjs` (по образцу
     `skills/maestro/references-coverage.test.mjs`): 5 указателей ядра резолвятся,
     сирот в `references/` нет, ядро ≤ 120 строк
   - `package.json` → оба файла в `scripts.test`
2. 5 `commands/maestro-memory*.md` → тонкие лоадеры (~10 строк, паттерн
   `commands/maestro-benchmark.md`): frontmatter **без изменений**; тело:
   «Загрузи skill `maestro-memory` (tool: skill). Сначала — гейт доступности
   (ядро). Затем читай и следуй `references/<x>.md` из каталога скилла.
   **Язык:** все сообщения пользователю — только на русском.» (+1 строка-напоминание
   сути команды по образцу benchmark-фаз)
3. `maestro-install/agpack.yml` + `agpack.yml`: `path: skills/maestro-memory`
4. `npm test` → зелёный (включая новые)
5. Commit: `feat(memory-skill): T2 — 5 тонких команд + доставка (agpack) + coverage-тесты`

### T3 — доки + паритет + regression (sonnet)
1. **Паритет (one-shot, эфемерный):** `.maestro/parity/parity-check.mjs` — base
   `e346a23:commands/maestro-memory*.md` (5 файлов), target = ядро ∪ 5 references
   ∪ 5 лоадеров; классы исключений: (1) гейт→ядро, (2) переприцеленные ссылки,
   (3) шапки/frontmatter→лоадеры, (4) glue лоадеров, (5) дедуп в ядро (язык ×5,
   повторное чтение конфига), (6) нормализация нумерации гейта; **0 ошибок**;
   результат (N base, M исключений) — в regression entry
2. `manual_docs/reference/commands.md` — 5 секций: +по строке «Реализация —
   скилл `maestro-memory`, `references/<x>.md`» (формулировка по commands.md:132)
3. `AGENTS.md` — линия `skills/maestro-memory/` (по образцу линии maestro-benchmark)
4. `manual_docs/overview/changelog.md` — секция 4.15.0 (честная формулировка:
   единый канон-гейт + резолвимые кросс-ссылки + дедуп; пер-инвокейшн контекст
   команды растёт на ядро — выигрыш относительно единого SKILL.md ~570 строк)
5. `regression/entries/2026-09-30-maestro-memory-skill.md`: риск LOW;
   file-в-файл маппинг; результат паритета; примечание про смещение grep-цели
   no-bash-fallback (entry 2026-09-24) на `skills/maestro-memory/**`
6. Sweep: `grep -rn 'см. \`@maestro-memory\`\|@maestro-memory шаг' commands/ skills/`
   (кроме 5 лоадеров) → 0 живых
7. Commit: `docs(memory-skill): T3 — доки (commands.md, AGENTS, changelog 4.15.0) + regression entry + паритет`

## После SDD
- Шаг 14: доки-сверка (в T3) — diff-verification
- Шаг 16: финальное ревью — 1 code-reviewer (Средняя, review.parallel → single)
- Гейт 17 (⚑1, HITL) → шаг 18: merge --no-ff, bump 4.15.0 (package.json,
  package-lock.json, project-context §3), push
- Шаг 18.5: feedback-отчёт (auto)
- TODO:81 закрывается **после** `[Manual]` dogfood (post-merge + push + agpack sync:
  status + report, включая off-путь)
