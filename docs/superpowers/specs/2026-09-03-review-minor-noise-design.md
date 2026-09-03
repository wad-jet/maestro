# Спека: анти-over-engineering ревьюеров + fast-path Approve при только-Minor (P1.1+P1.2)

- **Дата:** 2026-09-03
- **Ветка:** `feature/review-minor-noise`
- **Категория:** Сложная фича (полный pipeline)
- **Источник:** TODO п.59 («сократить повторные ревью до 1–3 проходов»); дельта с
  best practices Claude Code (код-ревьюер, которого просят искать дыры, найдёт их
  даже в хорошей работе; погоня за каждым файндингом ведёт к over-engineering).

## 1. Проблема

Две причины лишних раундов ревью:

1. **Minor-шум.** Ревьюеры (spec review, task review, финальное code review)
   возвращают Minor-замечания наравне с существенными; каждое — потенциальный
   повод для Revise-цикла. Генератор повторных ревью спеки (TODO п.59).
2. **Отсутствие раннего выхода.** Даже когда контрольное ревью закрыло все
   Critical/Important и осталось только Minor, ревьюер может вернуть вердикт
   `revise`, обоснованный только Minor, — и новый полный раунд запускается
   выбором пользователя (b) Revise на гейте 10; плато-guard срабатывает
   только после 2 раундов.

## 2. Зафиксированные решения (сессия 2026-09-03)

| # | Решение |
|---|---|
| 1 | Полная связка: промпты трёх ревью-контуров + оркестраторный fast-path |
| 2 | Правило для ревьюеров — **жёсткое**: Minor никогда не обосновывает verdict `revise`/`Needs fixes`; только-Minor-ревью обязано вернуть approve |
| 3 | Fast-path триггер: контрольное ревью закрыло все прошлые Critical/Important, новых нет, находки только Minor → дефолт-предложение Approve, БЕЗ нового раунда |
| 4 | Незакрытые повторяющиеся Critical/Important — НЕ «только Minor»: плато-guard (2 раунда) сохраняется без изменений |
| 5 | Minor-список → spec-follow-up (механизм OQ-5, «не блокирует Approve»), показывается пользователю на гейте |
| 6 | Язык вставок — по языку файла: английский в `spec-review-prompt.md` и диспатч-инструкции task-reviewer; русский в `agents/code-reviewer.md` и тексте SKILL.md |

## 3. Изменения по файлам

### 3.1. `skills/maestro/spec-review-prompt.md` — Calibration + Rules

**Calibration** (секция с бакетами) — добавить после описания бакетов:

> Minor findings **never justify verdict `revise`**: a spec whose open
> findings are all Minor must receive verdict `approve`.

**Rules** (определения вердиктов) — дополнить строку `revise`:

> `revise` is justified **only** by Critical/Important findings.

Существующее «A stated rationale ("kept it simple", "YAGNI") never downgrades a
finding's severity» — сохраняется без изменений (не конфликтует: правило про
классификацию замечаний, новое — про связь находок и вердикта).

### 3.2. `skills/maestro/SKILL.md` — шаг 13d (диспатч task-reviewer)

После строки «Task review: `subagent_type=sonnet`…» добавить:

> При диспатче task-reviewer оркестратор добавляет в промпт (англ., в тон
> task-reviewer-prompt.md) **только калибровку вердикта**: «Minor items are
> never grounds for "Needs fixes"; a task whose open findings are all Minor
> must be reported Approved.»

Вставка **не подавляет находки**: формулировки класса «flag only …» / «at most
Minor» запрещены анти-pre-judging правилом диспатча внешнего SDD-скилла
(`subagent-driven-development`: «never instruct a reviewer to ignore or not
flag a specific issue»). Внешний fix-loop и так срабатывает только на spec ❌,
Critical/Important и подтверждённые ⚠️ — Minor-находки в него не попадают;
вставка выравнивает семантику вердикта, а не фильтрует находки.

Шаблон `task-reviewer-prompt.md` (внешний пакет superpowers) — **не правится**:
правило живёт в SKILL.md и добавляется при диспатче.

### 3.3. `agents/code-reviewer.md` — тело агента

Дополнить абзац:

> Minor-замечания — в подсекции Minor; вердикт «Needs fixes» обосновывается
> только Critical/Important — если все открытые замечания Minor, вердикт
> Approved.

### 3.4. `skills/maestro/SKILL.md` — шаг 10, блок «Сходимость Revise (OQ-4)»

Блок перерабатывается на два правила:

**Fast-path (только-Minor):** триггер — **пустые бакеты Critical и Important
в контрольном ревью** (контрольное ревью — ревью после применения правок;
пустые C/I-бакеты означают: все прошлые Critical/Important закрыты, новых
нет, открытые находки — только Minor) → новый раунд ревью НЕ запускается.
Оркестратор сразу выводит гейт 10 с дефолт-предложением **(a) Approve**;
Minor-список показывается пользователю и фиксируется как **spec-follow-up**
(OQ-5, шаг 8.5: «не блокирует Approve» → транслируется в задачи плана на
шаге 11). Minor-список фиксируется по последнему контрольному ревью
(актуальное состояние spec), с дедупликацией повторов против уже
зафиксированных follow-up.

**Расхождение вердикта и бакетов.** Правила для LLM — не гарантия: если
вердикт контрольного ревью — `revise`, но бакеты Critical/Important пусты,
источник истины — бакеты → fast-path всё равно срабатывает (гейт 10 с
дефолтом (a) Approve) с пометкой пользователю о расхождении (вердикт
`revise` при пустых C/I-бакетах — источником истины приняты бакеты).

**Плато (незакрытые повторяющиеся):** без изменений — 2 последовательных раунда
без новых Critical/Important при незакрытых повторяющихся → HITL: «Достигнуто
плато: 2 раунда без новых Critical/Important. (a) Approve spec / (b) продолжить
ещё / (c) follow-up оставшиеся». Новый Critical/Important обнуляет счётчик.

Синхронные правки тех же формулировок:
- шаг 10 (b) Revise — пометка о fast-path после контрольного ревью;
- шаг 8.5 (Spec-follow-up, OQ-5) — расширить перечень источников spec-follow-up
  («из особого случая шага 10b (вариант (b)) и плато OQ-4 (вариант (c))»)
  Minor-находками fast-path;
- перечень гейтов в «HITL Gate Protocol» (строка «Сходимость Revise»);
- таблица «Обработка сбоев» — ДВЕ строки Revise-цикла («Spec gate: revise
  (10b)» и «Spec review: revise»): обновить обе — добавить fast-path (пустые
  C/I-бакеты контрольного ревью → без нового раунда, гейт 10 с дефолтом
  (a) Approve) — либо консолидировать в одну строку с тем же содержанием;
- Example Workflow, фрагмент шага 16 («Reviewer: 2 minor findings (naming,
  error message)» / «[agent] dispatch ONE fix-субагента с обоими findings ->
  fix -> approved») — переписать: текущий фрагмент демонстрирует
  анти-паттерн, который убирает эта фича. Новый фрагмент:

  ```
  Шаг 16: [agent] requesting-code-review -> final review (opus)
           - Reviewer: 2 minor findings (naming, error message) -> approved
             (только-Minor — вердикт Approved без fix-диспатча); findings ->
             follow-up (non-blocking)
  Шаг 17: -- HITL: pre-PR (follow-up-список: 2 Minor, не блокирует merge),
           пользователь approves merge --
  ```

### 3.5. `manual_docs/` — синхронизация

- `reference/hitl-gates.md` — строка «Сходимость Revise» (шаг 10): fast-path
  (только-Minor → дефолт Approve, Minor → follow-up) + плато (без изменений);
- `overview/changelog.md` — запись о поведенческом изменении;
- `explanation/pipeline-overview.md`, `tutorials/run-first-feature.md`,
  `overview/quick-start.md` — проверить описания ревью-раундов, обновить при
  упоминании Minor/Revise-циклов (решение по quick-start.md: проверен на этом
  ревью — упоминаний ревью-раундов/Minor нет (только перечень шагов 14–18),
  правка не ожидается; файл остаётся в списке проверки).

## 4. Семантика Minor-находок (инвариант)

Minor не игнорируются и не теряются:

1. Ревьюер обязан выводить их в подсекции Minor своего выходного формата (P1.1).
2. Spec review: Minor → spec-follow-up (OQ-5) → опциональные задачи плана (шаг 11).
3. Code review (шаг 16): существующий трекинг `fixed / open (blocking) /
   follow-up (non-blocking)` — Minor → follow-up, фиксируется явно; pre-PR гейт
   (шаг 17) показывает follow-up-список с severity.
4. HITL — арбитр: пользователь на любом гейте вправе выбрать Revise, не
   согласившись со статусом замечания. Меняется дефолт предложения, не наличие гейта.

## 5. Взаимодействие с существующими механизмами

- **`previous_findings` (шаг 9):** fast-path опирается на подтверждение ревьюером
  закрытия прошлых Critical/Important — формат уже передаётся на Revise-цикле.
- **OQ-5 / spec-follow-up (шаг 8.5):** Minor-список — новый источник follow-up
  наравне с особым случаем 10b(b) и плато (c); тот же pending-механизм, то же
  правило «не блокирует Approve».
- **OQ-2 (повторный 8.6):** не затрагивается — fast-path меняет поведение после
  ревью, не контур санитизации.
- **Fast-track (7d) re-entry:** без изменений; review-подпись ставится при
  Approve на шаге 10 как раньше.

## 6. Критерии приёмки

- [ ] Правки §3 применены; во всех трёх ревью-контурах Minor не обосновывает
      blocking-вердикт.
- [ ] Fast-path на шаге 10: сценарий «контрольное ревью закрыло все C/I,
      осталось только Minor → дефолт Approve без нового раунда» описан в SKILL.md
      и hitl-gates.md.
- [ ] Плато-guard для незакрытых повторов — формулировки сохранены.
- [ ] `manual_docs/` синхронизирован (чек-лист `keep-docs-up-to-date.md`),
      changelog пополнен.
- [ ] Язык: русский в SKILL.md/agents/manual_docs; английские вставки — в
      spec-review-prompt.md и диспатч-инструкции task-reviewer.
- [ ] Тесты плагина не требуются (плагин не затрагивается).
- [ ] TODO п.59 — локальная пометка со ссылкой на реализацию (TODO.md в
      .gitignore, не коммитится).

## 7. Верификация

Автоматических тестов нет (правки промптов/доков). Верификация:
- прочтение диффа против этой спеки на ревью;
- dogfooding: следующие фичи в этом репо исполняют обновлённые правила
  (эмпирическая проверка снижения раундов — цель TODO п.59).

## 8. Out of scope

- P1.3 (дефолты HITL-гейтов), P1.4 (эвристика «диф одним предложением» +
  проектная матрица), P1.5 (evidence pre-PR), P1.6 (гигиена project-context) —
  отдельные циклы волны P1.
- Параллельное двойное ревью спеки (TODO п.59, вторая половина) — P2.
- Правки внешнего пакета superpowers (`task-reviewer-prompt.md`).

<!-- maestro:sanitize
status: CLEAN
date: 2026-09-03
hash: f1a52448766265b5e38417f951fc7e5fcee2bd9aee668e25a429bb1e52c01036
-->

<!-- maestro:review
reviewer: opus
date: 2026-09-03
verdict: approve
hash: f1a52448766265b5e38417f951fc7e5fcee2bd9aee668e25a429bb1e52c01036
-->
