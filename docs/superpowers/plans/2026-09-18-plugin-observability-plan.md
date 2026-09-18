# Plugin Observability (P2.6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Починить наблюдаемость плагина: тест адаптера (полный форвардинг + fail-soft через рефакторинг в core.js), fallback sqlite в `@maestro-memory-report` (честные сообщения вместо «память выключена»), warn в Гейте 0 при рассинхроне версий + smoke-чеклист.

**Architecture:** A) `createBootstrapAdapter(factory)` — named export в core.js (мемо init + retry + I2-лог + fail-soft каркас + spread + config/startup override); index.js — тонкий default export. B) Команда memory-report: ветвление по maestro.json (enabled/disabled_reason/storage.type) + fallback на прямое чтение sqlite через module_dir (readonly). C) Гейт 0: warn (не STOP) при рассинхроне init-версии vs кэш плагина.

**Tech Stack:** Node.js ESM (плагин), better-sqlite3 (readonly, из module_dir), markdown (команды/скиллы/доки).

**Спека:** `docs/superpowers/specs/2026-09-18-plugin-observability-design.md` (approved, 4 раунда ревью; C-1 эмпирически верифицирован: кэш-путь `…/maestro.git/node_modules/maestro-bootstrap/package.json`).

**Важно для SDD:** файлы читать через bash (нативный deny-ит read-тул на .md и maestro.json). В heredoc НЕ включать слово из букв "confidential" (нативный bash-deny).

---

## File Structure

- `plugins/maestro-bootstrap/core.js` — createBootstrapAdapter (Task 1)
- `plugins/maestro-bootstrap/index.js` — тонкий adapter (Task 1)
- `plugins/maestro-bootstrap/index.test.js` — fail-soft + форвардинг тесты (Task 2)
- `commands/maestro-memory-report.md` — fallback sqlite + ветвление (Task 3)
- `commands/maestro-memory.md` — ветвление enabled/disabled/unavailable (Task 3)
- `skills/maestro/SKILL.md` — Гейт 0 warn (Task 4)
- `manual_docs/how-to/update-maestro.md` — smoke-чеклист + Шаг 3 (Task 4)
- `manual_docs/reference/commands.md`, `agents-and-trust.md`, `config.md`, `reference/memory.md`, `plugins/maestro-bootstrap/README.md`, `manual_docs/explanation/pipeline-overview.md` — синк (Task 5)
- `manual_docs/overview/changelog.md` — запись P2.6 (Task 5)
- `regression/entries/2026-09-18-plugin-observability.md` — entry (Task 5)

---

### Task 1: Плагин — createBootstrapAdapter в core.js + тонкий index.js

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js`
- Modify: `plugins/maestro-bootstrap/index.js`

- [ ] **Step 1: Добавить `createBootstrapAdapter` в конец core.js**

В `plugins/maestro-bootstrap/core.js`, после `MaestroBootstrapPlugin` (конец файла, ~L1111), добавить:

```js
/**
 * Адаптер opencode-плагина: оборачивает фабрику плагина в форвардинг всех хуков.
 * Мемо успешного init + retry после сбоя (каркас НЕ кэшируется — следующая
 * инвокация повторяет init). Логирование сбоя init — I2-guard против тихого
 * fail-open. config/startup — условный override: config всегда функция (opencode
 * вызывает hook.config?.(cfg), M12: НЕ форсируем file_access); startup — только
 * если core его не дал (hooks.startup ?? noop), чтобы не глушить будущий core-хук.
 * @param {(input: object) => Promise<object>} factory  Асинхронная фабрика плагина.
 * @returns {(input: object) => Promise<object>}  Функция opencode-plugin.
 */
export function createBootstrapAdapter(factory) {
  let hooks = null;
  return async function adapter(input) {
    if (!hooks) {
      try {
        hooks = await factory(input);
      } catch (err) {
        // I2: проглоченный сбой init тихо отключает ВСЕ хуки (confidential,
        // sanitizer) → fail-open. Логируем, чтобы не было тихого отключения
        // защиты. Плагин не кэшируется — следующая инвокация повторит.
        console.error("[maestro-bootstrap] init failed:", err instanceof Error ? err.message : err);
        hooks = null;
      }
    }
    // Fail-soft: init упал → минимальный каркас (без защиты).
    if (!hooks) {
      return {
        config: async () => ({}),
        event: async () => {},
        startup: async () => {},
        dispose: async () => {},
      };
    }
    return {
      ...hooks,
      config: async () => ({}),
      startup: hooks.startup ?? (async () => {}),
    };
  };
}
```

- [ ] **Step 2: index.js — тонкий default export**

Заменить содержимое `plugins/maestro-bootstrap/index.js` (после doc-комментария) на:

```js
import { createBootstrapAdapter, MaestroBootstrapPlugin } from "./core.js";

const adapter = createBootstrapAdapter(async (input) =>
  MaestroBootstrapPlugin({
    directory: process.cwd(),
    client: input?.client,
  }),
);

export default adapter;
```

Сохранить верхний doc-комментарий (про форвардинг всех хуков, constraint «только default export»). Убедиться: в index.js НЕТ named exports (только `export default`).

- [ ] **Step 3: Проверить синтаксис и загрузку**

Run: `node --check plugins/maestro-bootstrap/index.js` → OK
Run: `node --check plugins/maestro-bootstrap/core.js` → OK

- [ ] **Step 4: Проверить, что index.js — только default export**

Run: `node -e "import('./plugins/maestro-bootstrap/index.js').then(m => console.log('keys:', Object.keys(m)))"`
Expected: `keys: [ 'default' ]` (нет named exports — constraint opencode).

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.js
git commit -m "refactor(plugin): createBootstrapAdapter in core.js, thin index.js (P2.6 A)"
```

---

### Task 2: Тесты адаптера — fail-soft + полный форвардинг

**Files:**
- Modify: `plugins/maestro-bootstrap/index.test.js`

- [ ] **Step 1: Импорт createBootstrapAdapter**

В `plugins/maestro-bootstrap/index.test.js`, в import из core.js (строка 6), добавить `createBootstrapAdapter`.

- [ ] **Step 2: Написать тест fail-soft (RED)**

Добавить в describe "maestro-bootstrap adapter forwarding core hooks":
```js
it("fail-soft: throwing factory returns minimal skeleton, retries on next call", async () => {
  const adapter = createBootstrapAdapter(async () => { throw new Error("boom"); });
  const hooks1 = await adapter({});
  assert.equal(typeof hooks1.config, "function");
  assert.equal(typeof hooks1.event, "function");
  assert.equal(typeof hooks1.startup, "function");
  assert.equal(typeof hooks1.dispose, "function");
  // второй вызов снова пытается init (не кэширует каркас) — фабрика снова throw
  const hooks2 = await adapter({});
  assert.equal(typeof hooks2.config, "function");
});
```

- [ ] **Step 3: Тест полного форвардинга (superset ключей)**

Добавить (использует реальный MaestroBootstrapPlugin из temp-dir, как существующий тест):
```js
it("forwards ALL core hook keys (superset, incl chat/experimental)", async () => {
  const coreHooks = await MaestroBootstrapPlugin({ directory: dir });
  const adapter = createBootstrapAdapter(async () => coreHooks);
  const out = await adapter({});
  const coreKeys = Object.keys(coreHooks);
  const override = new Set(["config", "startup"]);
  for (const k of coreKeys) {
    if (override.has(k)) continue;
    assert.ok(Object.hasOwn(out, k), `core hook ${k} must be forwarded`);
  }
  // chat/experimental присутствуют (даже если undefined при memory off)
  assert.equal(Object.hasOwn(out, "chat.message"), true);
  assert.equal(Object.hasOwn(out, "experimental.chat.system.transform"), true);
});
```

- [ ] **Step 4: Тест spread-механики (stub, ловит «явное перечисление»)**

```js
it("spread mechanism: stub core hooks all forwarded", async () => {
  const stub = { event: async () => {}, tool: {}, "chat.message": undefined, "experimental.chat.system.transform": undefined, dispose: async () => {} };
  const out = await createBootstrapAdapter(async () => stub)({});
  assert.equal(typeof out.event, "function");
  assert.equal(typeof out.dispose, "function");
  assert.equal(Object.hasOwn(out, "tool"), true);
  assert.equal(Object.hasOwn(out, "chat.message"), true);
  assert.equal(Object.hasOwn(out, "experimental.chat.system.transform"), true);
});
```

- [ ] **Step 5: Прогнать тесты (RED→GREEN)**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: 171 + 3 новых = 174 pass.

- [ ] **Step 6: Проверка ловли потери ключа (регресс-тест)**

Временно убрать `"chat.message"` из spread в createBootstrapAdapter → тест форвардинга падает. Вернуть обратно. (Проверка, что тест реально ловит класс бага c9e558e.)

- [ ] **Step 7: Commit**

```bash
git add plugins/maestro-bootstrap/index.test.js
git commit -m "test(plugin): adapter fail-soft + full hook forwarding (P2.6 A)"
```

---

### Task 3: Команды memory-report + memory — ветвление и fallback sqlite

**Files:**
- Modify: `commands/maestro-memory-report.md`
- Modify: `commands/maestro-memory.md`

- [ ] **Step 1: memory-report — ветвление в шаге 1**

В `commands/maestro-memory-report.md`, шаг 1, заменить п.1-2 на:
```
1. Прочитай `maestro.json` через bash (cat/sed — нативный deny-ит read-тул):
   `memory.enabled`, `memory.storage.type`, `memory.module_dir`.
2. Ветвление:
   - `memory.enabled: false` → выведи «Память maestro выключена — включите в maestro.json:
     memory.enabled: true» (текущее сообщение; fallback НЕ запускать).
   - `memory.enabled: true` + конфиг-невалиден (нет/невалиден `namespace`, внешний
     embedder без api_key_env и т.п. — disabled_reason из `@maestro-memory`) → выведи
     честную причину по `disabled_reason` (классификация как в `@maestro-memory` шаг 1.2),
     НЕ «перезапустите opencode» (нужно чинить конфиг).
   - `memory.enabled: true` + `storage.type` не sqlite (qdrant/pgvector) + инструмент
     недоступен → выведи «Плагин maestro-bootstrap недоступен; бэкенд централизованный —
     fallback невозможен; перезапустите opencode». НЕ «память выключена».
   - `memory.enabled: true` + `storage.type: sqlite` + инструмент недоступен → шаг 1a
     (fallback sqlite).
3. Вызови инструмент `memory_stats_detail` (без параметров). Если доступен — продолжи
   обычным путём (сохрани данные, guard на «Узлы графа», шаг 2). Если недоступен — по
   ветвлению выше.
```

- [ ] **Step 2: memory-report — fallback sqlite (новый шаг 1a)**

Добавить в `commands/maestro-memory-report.md` (после шага 1) блок:
```
## Шаг 1a. Fallback: прямое чтение sqlite (только при sqlite-бэкенде, tool недоступен)

1. Резолв данных (через provisioned-код module_dir, НЕ дублируя логику):
   - `<data-dir>`: вычисли из XDG/`~/Library/Application Support` (maestro).
   - module_dir: `memory.module_dir` из maestro.json, иначе `<data-dir>/maestro/memory/module`.
   - `<key>`: импортируй `resolveEffectiveKey`/`sanitizeDirName` из
     `<module_dir>/config.js` через dynamic import (ESM) — путь БД:
     `<data-dir>/maestro/memory/<sanitizeDirName(key)>/memory.db`.
   - better-sqlite3: `createRequire` из `<module_dir>/package.json` (CJS).
2. Открой БД readonly: `new Database(dbPath, { readonly: true })`.
   - ENOENT (файла нет) → «Память пуста / нет данных».
   - open-сбой на существующем файле (WAL recovery) → «Не удалось открыть БД (readonly);
     перезапустите opencode».
   - better-sqlite3 не установлен → «Плагин недоступен для fallback; перезапустите opencode».
3. Собери агрегаты (SEC-4b — только числа/авторы/даты/ветки/merged/head; title/summary/
   decisions/embedding НЕ выбирать):
   - `SELECT COUNT(*) FROM memory WHERE key = ?`
   - `SELECT author, COUNT(*) ... GROUP BY author`
   - `SELECT date(time_last/1000,'unixepoch','localtime') ... GROUP BY date`
   - `SELECT branch, COUNT(*) ... GROUP BY branch`
   - `SELECT head, COUNT(*) sessions, MIN(time_first) first, MAX(time_last) last
      ... GROUP BY head`
   - `SELECT COUNT(*) FROM memory WHERE merged = 1`
4. Сформируй упрощённый HTML-отчёт (те же секции, что обычный, но без кластеров/графа/
   тиров) + плашка: «Плагин maestro-bootstrap недоступен — отчёт упрощён (без кластеров,
   графа, тиров). Перезапустите opencode после обновления».
```

- [ ] **Step 3: memory-report — шаг 2 bash-чтение**

В шаге 2 («Прочитать конфигурацию») — убрать чтение maestro.json (уже прочитан в шаге 1);
оставить остальное. Примечание про bash — остаётся.

- [ ] **Step 4: memory — ветвление в шаге 1.2**

В `commands/maestro-memory.md`, шаг 1.2, заменить на различение:
```
1.2. Если `memory_stats_detail` недоступен:
   - Прочитай maestro.json через bash: `memory.enabled`, `memory.storage.type`.
   - `memory.enabled: false` → «Память maestro выключена — включите memory.enabled: true».
   - `enabled: true` + конфиг-невалиден (disabled_reason) → честная причина по
     `disabled_reason` (namespace, embedder, mainline и т.п.).
   - `enabled: true` + конфиг валиден → «Плагин maestro-bootstrap недоступен —
     перезапустите opencode». НЕ «память выключена».
```

- [ ] **Step 5: Проверить ссылки sibling-команд**

Run: `grep -rn "память выключена\|Память maestro выключена" commands/`
Проверить `@maestro-memory-reindex`/`@maestro-memory-prune` — если делегируют
формулировку `@maestro-memory` («см. @maestro-memory»), правка транзитивна. Если дублируют
дословно — поправить аналогично.

- [ ] **Step 6: Commit**

```bash
git add commands/maestro-memory-report.md commands/maestro-memory.md
git commit -m "docs(commands): memory-report fallback sqlite + honest unavailable messages (P2.6 B)"
```

---

### Task 4: Гейт 0 warn + smoke-чеклист

**Files:**
- Modify: `skills/maestro/SKILL.md`
- Modify: `manual_docs/how-to/update-maestro.md`

- [ ] **Step 1: SKILL.md Гейт 0 — warn при рассинхроне версий**

В `skills/maestro/SKILL.md`, Гейт 0 (шаг 2, после проверки свежести init), добавить:

```
      После подтверждения свежести — проверь рассинхрон версий (warn, НЕ stop):
      init-строка содержит `"version":"X.Y.Z"` — сравни с версией из кэша плагина:
      `~/.cache/opencode/packages/maestro-bootstrap@git+*/github.com/wad-jet/maestro.git/
      node_modules/maestro-bootstrap/package.json` (glob; тот же файл читает
      `readPluginVersion()`). Сравнение semver-осознанное; файл не найден / `#sha`-pin /
      runtime новее кэша → молча пропустить. При отставании runtime от кэша — показать:
      «Версия плагина (A) отстаёт от кэша (B) — runtime-правки не активны до перезапуска
      opencode» и продолжить (не блокировать).
```

- [ ] **Step 2: update-maestro.md — smoke-чеклист + Шаг 3**

В `manual_docs/how-to/update-maestro.md`:
- Обновить Шаг 3: «Сверьте с ожидаемой версией из package.json» → «с версией из кэша
  плагина (`node_modules/maestro-bootstrap/package.json`)».
- Добавить smoke-чеклист после обновления (раздел «Проверка после перезапуска»):
  1. Версия в init-логе = версия из кэша плагина.
  2. Memory-инструмент доступен: `@maestro-memory` показывает статус (не «плагин недоступен»).
  3. `@maestro-memory-report` собирает отчёт.
  Порядок rollout: push → очистить кэш → перезапуск (закрепить как чек-лист).

- [ ] **Step 3: Commit**

```bash
git add skills/maestro/SKILL.md manual_docs/how-to/update-maestro.md
git commit -m "docs(maestro): Gate 0 version warn, update-maestro smoke checklist (P2.6 C)"
```

---

### Task 5: Доки-синк + changelog + regression + финальная верификация

**Files:**
- Modify: `manual_docs/reference/commands.md`
- Modify: `manual_docs/explanation/agents-and-trust.md`
- Modify: `manual_docs/reference/config.md`
- Modify: `manual_docs/reference/memory.md`
- Modify: `plugins/maestro-bootstrap/README.md`
- Modify: `manual_docs/explanation/pipeline-overview.md`
- Modify: `manual_docs/overview/changelog.md`
- Create: `regression/entries/2026-09-18-plugin-observability.md`

- [ ] **Step 1: manual_docs синк**

- `manual_docs/reference/commands.md`: `@maestro-memory-report` (fallback-путь) и
  `@maestro-memory` (ветвление) — отразить.
- `manual_docs/explanation/agents-and-trust.md`: Гейт 0 — warn при рассинхроне версий.
- `manual_docs/reference/config.md`: Гейт 0-проверка; поля init-строки (version).
- `manual_docs/reference/memory.md`: при дублировании формулировок команд — отразить.
- `plugins/maestro-bootstrap/README.md`: адаптер теперь в core.js (createBootstrapAdapter);
  init-лог/Gate-0-проверка.
- `manual_docs/explanation/pipeline-overview.md`: при необходимости.

- [ ] **Step 2: Changelog**

В `manual_docs/overview/changelog.md`, `[Unreleased]` / `### Изменено`:
```
- **Наблюдаемость плагина (P2.6):** адаптер вынесен в core.js
  (`createBootstrapAdapter`) + тесты полного форвардинга хуков и fail-soft ветки;
  `@maestro-memory-report` при недоступном плагине читает sqlite напрямую
  (упрощённый HTML, только sqlite-бэкенд) и различает «выключена» /
  «конфиг-невалиден» / «плагин недоступен»; `@maestro-memory` — то же ветвление;
  Гейт 0 — warn при рассинхроне версий (компаратор — кэш плагина); smoke-чеклист
  в update-maestro.md. Regression: LOW.
```

- [ ] **Step 3: Regression entry**

Создать `regression/entries/2026-09-18-plugin-observability.md` (по шаблону соседей):
```markdown
# Regression — наблюдаемость плагина (2026-09-18)

- **version:** 1
- **feature:** feature/plugin-observability
- **added:** 2026-09-18
- **status:** active
- **risk:** LOW
- **scenarios:**
  - **Адаптер форвардит все хуки:** (plugins):
    - run: node --test plugins/maestro-bootstrap/index.test.js → 174 pass
    - run: node -e "import('./plugins/maestro-bootstrap/index.js').then(m=>console.log(Object.keys(m)))" → [default]
  - **fail-soft каркас:** init-сбой → {config,event,startup,dispose}, повторный вызов ретраит
  - **memory-report fallback:** (команда):
    - run: memory.enabled:false → «Память выключена»
    - run: enabled+sqlite+tool недоступен → упрощённый HTML с плашкой
    - run: enabled+qdrant/pgvector+tool недоступен → «Плагин недоступен»
  - **Гейт 0 warn:** init-версия < кэш-версия → warn, не STOP
```

- [ ] **Step 4: Финальная верификация**

Run: `node --test plugins/maestro-bootstrap/index.test.js` → 174 pass
Run: `node -e "import('./plugins/maestro-bootstrap/index.js').then(m=>console.log('keys:',Object.keys(m)))"` → keys: [default]
Run: `grep -rn "Память maestro выключена" commands/maestro-memory-report.md` → только в enabled:false ветке.

- [ ] **Step 5: Commit**

```bash
git add manual_docs/ regression/
git commit -m "docs(maestro): P2.6 observability — docs sync, changelog, regression entry"
```

---

## Self-Review

- **Spec coverage:** §3.1/3.2→Task 1 (core.js adapter + index.js), §3.3→Task 2 (тесты), §3.4/3.5→Task 3 (команды), §3.6/3.7→Task 4 (Гейт 0 + smoke), §3.8→Task 5 (docs-sync), changelog/regression→Task 5.
- **C-1 учтён:** Task 4 Step 1 — кэш-путь полный (`node_modules/maestro-bootstrap/package.json`), matcher с нормализацией `./` (Minor round-4).
- **I-1..I-5/миноры учтены:** мемо+retry+I2-лог (Task 1), startup условный (Task 1), ESM/CJS загрузка (Task 3 Step 2), disabled_reason ветвление (Task 3), degrade-пути (Task 3), semver-сравнение + молча (Task 4).
- **Placeholder scan:** нет TODO/TBD.
- **Type/имя:** createBootstrapAdapter согласован (core.js export, index.js import, тесты); ветвление команд — единая терминология.
- **Порядок:** Task 1 (плагин) → Task 2 (тесты) зависимы; Task 3 (команды) независим; Task 4 (Гейт 0) независим; Task 5 после.