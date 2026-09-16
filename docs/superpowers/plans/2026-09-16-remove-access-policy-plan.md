# Remove access_policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Полное удаление `access_policy` из `maestro.json` и плагина `maestro-bootstrap`; защита `maestro.json`/`.maestro/**` переносится в нативный permission-слой opencode.

**Architecture:** Плагин перестаёт перехватывать `read`. Вместо этого нативные permissions (`.opencode/opencode.json`) получают read/glob/grep-deny на `maestro.json`/`.maestro/**` + edit-ask на `maestro.json`. `confidential` (trusted-канал) и sanitizer остаются в плагине без изменений.

**Tech Stack:** Node.js ESM, opencode plugin, нативный permission-конфиг `.opencode/opencode.json`, markdown-скиллы/доки.

**Спека:** `docs/superpowers/specs/2026-09-16-remove-access-policy-design.md` (approved, 3 раунда ревью). **Порядок I6: сначала Task 4 (maestro.json), затем Task 3 (.opencode deny)** — иначе edit `maestro.json` будет гейтиться нативным ask.

**Важно для SDD:** скиллы/команды читают `maestro.json`/`.maestro/**` через **bash** (не `read`) — нативный deny блокирует read-тул. Правочка `maestro.json` — через нативный `edit ask` (HITL) или bash.

---

## File Structure

- `plugins/maestro-bootstrap/core.js` — удаление access_policy-логики (Task 1)
- `plugins/maestro-bootstrap/index.test.js` — удаление/чистка тестов (Task 1)
- `plugins/maestro-bootstrap/index.js` — правка комментариев (Task 1)
- `maestro.json` — удаление секции (Task 4)
- `.opencode/opencode.json` — нативные deny (Task 3)
- `skills/maestro-assistant/SKILL.md`, `skills/maestro-setup/SKILL.md`, `skills/maestro-setup/init-context.md`, `skills/maestro/SKILL.md`, `skills/maestro/invariants.md`, `skills/maestro-feedback-report/SKILL.md`, `skills/maestro-design/SKILL.md`, `agents/sanitizer.md` — скиллы/агенты (Task 5)
- `commands/*.md` — команды (Task 5)
- `SECURITY.md`, `manual_docs/**`, `README.md`, `AGENTS.md`, `docs/project-context.md`, `plugins/maestro-bootstrap/README.md`, `docs/testing/maestro-sandbox-checklist.md`, `maestro-sandbox.sh`, `.sandbox/maestro.json` — доки/прочее (Task 6)
- `regression/entries/*.md`, `manual_docs/overview/changelog.md` — регрессия/логи (Task 7)

---

### Task 1: Плагин — удалить access_policy-логику (core.js + тесты + index.js)

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js`
- Modify: `plugins/maestro-bootstrap/index.test.js`
- Modify: `plugins/maestro-bootstrap/index.js`

- [ ] **Step 1: Удалить `loadAccessPolicy` из core.js**

Удалить блок (строки ~446–463):
```js
// --- File access control ---------------------------------------------------

/**
 * Extract the access policy from a parsed maestro config.
 * ...
 */
export function loadAccessPolicy(config) {
  const section = config?.access_policy;
  if (!section || typeof section !== "object") {
    // Секции нет → политика не enforced (fail-open).
    return { exists: false, default: "ask", allow: [], ask: [], deny: [] };
  }
  return {
    exists: true,
    default: section.default === "allow" ? "allow" : "ask",
    allow: Array.isArray(section.allow) ? section.allow : [],
    ask: Array.isArray(section.ask) ? section.ask : [],
    deny: Array.isArray(section.deny) ? section.deny : [],
  };
}
```
(оставить пустую строку/разделитель между соседними секциями).

- [ ] **Step 2: Удалить `globMatch` из core.js**

Удалить функцию `globMatch` (строки ~583–609):
```js
/**
 * @returns {boolean}
 */
function globMatch(pattern, value) {
  // {a,b,c} → (a|b|c), значения экранируются.
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "{") {
      const end = pattern.indexOf("}", i);
      if (end !== -1) {
        const alts = pattern
          .slice(i + 1, end)
          .split(",")
          .map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        out += `(?:${alts.join("|")})`;
        i = end + 1;
        continue;
      }
    }
    if (ch === "*") {
      out += ".*";
    } else if (ch === "?") {
      out += ".";
    } else {
      out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    i += 1;
  }
  return new RegExp(`^${out}$`).test(value);
}
```
ОБЯЗАТЕЛЬНО проверить: `globMatch` не используется нигде, кроме `resolveFileAccess` (`grep -n "globMatch" core.js` — только определение и строка в resolveFileAccess). `confGlobMatch` (confidential) — НЕ трогать.

- [ ] **Step 3: Удалить `resolveFileAccess` из core.js**

Удалить блок (строки ~748–776):
```js
/**
 * Resolve access action for a path against the policy. Priority:
 * deny > ask > allow > default (наиболее строгое выигрывает).
 * @param {object} policy  Parsed access policy.
 * @param {string} path    File path being accessed.
 * @returns {"allow"|"ask"|"deny"}
 */
export function resolveFileAccess(policy, filePath) {
  if (typeof filePath !== "string" || !filePath) return policy.default || "ask";
  const RANK = { deny: 3, ask: 2, allow: 1 };
  let best;
  let bestRank = 0;
  const consider = (patterns, action) => {
    const rank = RANK[action] ?? 0;
    if (rank <= bestRank) return;
    for (const p of patterns ?? []) {
      if (globMatch(p, filePath)) {
        best = action;
        bestRank = rank;
        return;
      }
    }
  };
  consider(policy.allow ?? [], "allow");
  consider(policy.ask ?? [], "ask");
  consider(policy.deny ?? [], "deny");
  return best ?? (policy.default || "ask");
}
```

- [ ] **Step 4: Убрать загрузку accessPolicy в `MaestroBootstrapPlugin`**

В `core.js` (~949): удалить строку
```js
  const accessPolicy = loadAccessPolicy(config);
```

- [ ] **Step 5: Удалить блок перехвата `read` в `tool.execute.before`**

В `core.js`, внутри `"tool.execute.before"`, удалить блок (строки ~1054–1085):
```js
        // File access control (Уровень 3): перехват file-тулов по
        // access-policy.json. `allow` → пропускаем, `ask` → блокируем с
        // сообщением (HITL решает оркестратор), `deny` → жёсткий блок.
        // Контролируется только `read` — у него чёткий filePath.
        // bash/glob/grep НЕ покрываются (bash-пути не извлекаются надёжно,
        // glob/grep работают с паттернами, не путями) — для них используйте
        // нативные permissions OpenCode (bash: ask и т.п.).
        const FILE_TOOLS = new Set(["read"]);
        if (accessPolicy.exists && FILE_TOOLS.has(input.tool) && !wasConfidential) {
          const target = filePathOf(input.tool, output?.args);
          if (target && !isPluginMetaFile(root, target)) {
            const action = resolveFileAccess(accessPolicy, target);
            if (action !== "allow") {
              auditLog.warn("access_policy.blocked", {
                sessionID: input.sessionID,
                callID: input.callID,
                tool: input.tool,
                action,
                target: path.basename(target),
              });
              const err = new Error(
                `[access-policy:${action}] Доступ к "${target}" требует подтверждения. ` +
                  `Правило: ${action}. Обратитесь к оркестратору за HITL-решением.`,
              );
              err.accessPolicy = true;
              throw err;
            }
          }
        }
```
НЕ удалять `wasConfidential`-переменную и confidential-блок выше (строки ~1005–1052) — они нужны. `filePathOf` остаётся (используется confidential-блоком на строке ~1019). `isPluginMetaFile` остаётся (confidential-исключение ~1020).

- [ ] **Step 6: Упростить catch-обработку `err?.accessPolicy`**

В `core.js` (~1130): заменить
```js
        if (err?.accessPolicy || err?.confidential) {
```
на
```js
        if (err?.confidential) {
```

- [ ] **Step 7: Обновить комментарии про access_policy в core.js**

Проверить `grep -n "access_policy" core.js` — удалить/переформулировать остаточные комментарии (строки ~341, ~485, ~620, ~708, ~1006-1007):
- ~341: упоминание в списке секций конфига — убрать `access_policy` из перечисления.
- ~485/1006-1007: «Строже access_policy» — переформулировать («Строже остального file-доступа» или просто убрать сравнение).
- ~620: комментарий о `globMatch` для access_policy — уже удалён с функцией.
- ~708: «под access_policy/confidential» — заменить на «под confidential».

- [ ] **Step 8: Удалить тесты access_policy из index.test.js**

В `index.test.js`:
- Из `import` (строка 6): убрать `loadAccessPolicy`, `resolveFileAccess` (оставить `filePathOf` — тест на него остаётся).
- Удалить тест `loadMaestroConfig` assert `access_policy.allow` (строки ~459/464): убрать секцию `access_policy` из fixture и строку `assert.deepEqual(config.access_policy.allow, ["src/**"])`.
- Удалить целиком describe `"maestro-bootstrap access policy (file access control)"` (строки ~616–...): тесты `loadAccessPolicy returns exists:false`, `loadAccessPolicy extracts...`, `resolveFileAccess allow-matches`, `resolveFileAccess ask-matches`, `resolveFileAccess deny always wins`, `resolveFileAccess falls back`. **ОСТАВИТЬ** тест `filePathOf extracts target for read/write/edit, not bash/glob/grep` (перенести его в describe `"maestro-bootstrap helpers"` или оставить в любом живом describe — просто сохранить тест).
- В hook-describe «allows code file reads / throws on ask / throws on deny» (строки ~678–715): удалить весь describe (fixture с access_policy + 3 теста: allow/ask/deny).
- confidential-тесты (~1200/1206/1209): в fixture убрать секцию `access_policy`; тест `ignores access_policy.allow on confidential path` — переименовать в `confidential wins over any allow` и убрать access_policy из fixture (оставить только `confidential`).
- ИБ-тест «read of maestro.json IS still blocked by restrictive access_policy» (~1565): **удалить** (после удаления access_policy такой тест невозможен — нативная блокировка тестируется вручную, AC5).
- describe `"maestro-bootstrap plugin version file access"` (~1580–1625): fixture содержит `access_policy: { default: "ask", ... }` — убрать access_policy из fixture (оставить пустой объект `{}`). Тесты `isPluginMetaFile identifies...`, `read of .maestro/plugin-version is NOT blocked`, `read of a normal file still blocked` — теперь не имеют смысла (нет access_policy, чтобы блокировать), **удалить** тест «read of a normal file still blocked»; тест «read of .maestro/plugin-version is NOT blocked» переименовать в «read of .maestro/plugin-version does not throw (no file-access gate)» и оставить (проверяет, что без access_policy read не блокируется). `isPluginMetaFile identifies` — оставить.
- audit-тест «logs access_policy.blocked only in audit log» (~1765–1783): **удалить** (событие больше не существует). В тесте ~1759 (проверка bootstrap-лога) убрать `access_policy.blocked` из списка проверяемых msg (оставить `confidential.access`/`confidential.blocked`).

- [ ] **Step 9: Обновить комментарии в index.js**

В `index.js` (строки 9, 38, 56):
- Строка 9: «санитайзер/access_policy/confidential» → «санитайзер/confidential».
- Строка 38 (fail-open комментарий): «confidential, sanitizer, access_policy» → «confidential, sanitizer»; переформулировать «(confidential, sanitizer, access_policy) → fail-open» → «(confidential, sanitizer) → fail-open».
- Строка 56: «(санитайзер/access_policy/confidential)» → «(санитайзер/confidential)».

- [ ] **Step 10: Прогнать тесты**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: все тесты проходят (176 − ~14 удалённых ≈ 162), confidential/sanitizer-тесты зелёные.

- [ ] **Step 11: Commit**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js plugins/maestro-bootstrap/index.js
git commit -m "refactor(plugin): remove access_policy file-access gate (R3/R9)"
```

---

### Task 2: Нативные permissions в .opencode/opencode.json (этот репо)

**Files:**
- Modify: `.opencode/opencode.json`

- [ ] **Step 1: Добавить read/glob/grep deny + edit ask**

В `.opencode/opencode.json`, в секцию `permission`:

`read` — добавить (после `"*": "allow"`, перед/после существующих deny; важен порядок: deny раньше, allow plugin-version после deny):
```json
    "read": {
      "*": "allow",
      "docs/confidential/*": "deny",
      "maestro.json": "deny",
      ".maestro/**": "deny",
      ".maestro/plugin-version": "allow",
      "*.env": "deny",
      "*.env.*": "deny",
      "*.env.example": "allow",
      "*.pem": "deny",
      "*.key": "deny",
      "*.crt": "deny",
      "*.p12": "deny",
      "*.pfx": "deny"
    },
```
`edit` — добавить `"maestro.json": "ask"`:
```json
    "edit": {
      "*": "allow",
      "docs/confidential/*": "deny",
      "maestro.json": "ask",
      "*.env": "deny",
      "*.env.*": "deny",
      "*.env.example": "allow",
      "*.pem": "deny",
      "*.key": "deny",
      "*.crt": "deny",
      "*.p12": "deny",
      "*.pfx": "deny"
    },
```
`glob` и `grep` — добавить deny:
```json
    "glob": {
      "*": "allow",
      "docs/confidential/*": "deny",
      "maestro.json": "deny",
      ".maestro/**": "deny"
    },
    "grep": {
      "*": "allow",
      "docs/confidential/*": "deny",
      "maestro.json": "deny",
      ".maestro/**": "deny"
    },
```

- [ ] **Step 2: Валидировать JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('.opencode/opencode.json','utf8')); console.log('valid')"`
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add .opencode/opencode.json
git commit -m "chore(dev): native deny for maestro.json/.maestro in local merge-config (P6 compensation)"
```
(Заметка: `.opencode/` в `.gitignore` — коммит, вероятно, не создастся. Тогда пропустить коммит, оставить правку на диске; отметить в changelog.)

---

### Task 3: maestro.json — удалить секцию access_policy (ПОСЛЕ Task 2)

**Files:**
- Modify: `maestro.json`

- [ ] **Step 1: Удалить секцию access_policy**

В `maestro.json` удалить секцию `"access_policy": { ... },` целиком (строки ~5–28). Итоговый файл:
```json
{
  "trust": {
    "custodian": true,
    "sanitizer": true
  },
  "confidential": {
    "version": 1,
    "paths": [
      "docs/confidential/**"
    ],
    "trusted": {
      "read": "allow",
      "write": "deny",
      "edit": "deny"
    }
  },
  "sanitizer_whitelist": {
    "rules": {
      "env_secret": true,
      "data_field": true,
      "env_file": true,
      "db_credential": true,
      "ledger_entry": true,
      "private_key": true,
      "auth_header": true
    },
    "by_agent": {
      "code-reviewer": []
    },
    "patterns": [],
    "extra_fields": [],
    "extra_uri_schemes": []
  },
  "memory": {
    "enabled": true,
    "namespace": "ai.opencode.maestro"
  }
}
```

- [ ] **Step 2: Валидировать JSON**

Run: `node -e "const c=JSON.parse(require('fs').readFileSync('maestro.json','utf8')); console.log(c.access_policy===undefined?'no access_policy':'FAIL')"`
Expected: `no access_policy`

- [ ] **Step 3: Commit**

```bash
git add maestro.json
git commit -m "chore(config): remove access_policy section from maestro.json"
```

---

### Task 4: Канон maestro-assistant + native permission канон

**Files:**
- Modify: `skills/maestro-assistant/SKILL.md`

- [ ] **Step 1: Убрать access_policy из JSON-канона**

В `skills/maestro-assistant/SKILL.md`, в блоке «Канон `maestro.json`» убрать секцию `access_policy` из JSON-примера (оставить `trust`, `confidential`, `sanitizer_whitelist`, `memory`).

- [ ] **Step 2: Убрать секцию «`access_policy`» из «Секции (семантика)»**

Удалить bullet про access_policy: «**`access_policy`** — file access control для untrusted через `read` ... Покрывает только `read`; bash/glob/grep — нативные permissions.».

- [ ] **Step 3: Убрать правила вывода access_policy**

Удалить из «Правила вывода»:
- «**`access_policy.allow`:** из §3 (стек) + §5 (домены)...»
- «**`access_policy.deny`:** секреты (`*.env`, `*.env.*`, `*.{pem,key,cert,secret}`).»
- «**`access_policy` → `permission.read`** (когда R3 в Этапе B): deny>ask>allow → last-match-wins с catch-all первым. Пока `access_policy` остаётся активным механизмом плагина; нативный слой — дополнение (bash/glob/grep + read-baseline).»
- «**Sync-правило двойного источника (I3):** ...`maestro.json → access_policy`...» — переформулировать: «confidential-пути живут в двух местах — `maestro.json → confidential.paths` (плагин) и нативные `permission.read`/`edit` deny (merge-config). Любое изменение `confidential.paths` зеркалируется в нативные deny и наоборот».

- [ ] **Step 4: Обновить «Операционные гарантии»**

- OP-1: убрать `access_policy` из «trust/access_policy/confidential/sanitizer_whitelist» → «trust/confidential/sanitizer_whitelist».
- OP-4: убрать `access_policy.deny→allow` — оставить только `sanitizer_whitelist.rules→false` и confidential.paths.

- [ ] **Step 5: Обновить канон нативных permissions (R6)**

В каноне нативных permissions (глобальные deny R1+R4) добавить:
- в `read`: `"maestro.json": "deny"`, `".maestro/**": "deny"`, `".maestro/plugin-version": "allow"`;
- в `edit`: `"maestro.json": "ask"`;
- в `glob`/`grep`: `"maestro.json": "deny"`, `".maestro/**": "deny"`.

- [ ] **Step 6: Проверить остаточные упоминания**

Run: `grep -n "access_policy" skills/maestro-assistant/SKILL.md`
Expected: 0 вхождений.

- [ ] **Step 7: Commit**

```bash
git add skills/maestro-assistant/SKILL.md
git commit -m "docs(maestro-assistant): drop access_policy canon, add native deny maestro.json/.maestro"
```

---

### Task 5: Скиллы (maestro-setup, maestro, invariants, feedback-report, design) + агенты + команды

**Files:**
- Modify: `skills/maestro-setup/SKILL.md`
- Modify: `skills/maestro-setup/init-context.md`
- Modify: `skills/maestro/SKILL.md`
- Modify: `skills/maestro/invariants.md`
- Modify: `skills/maestro-feedback-report/SKILL.md`
- Modify: `skills/maestro-design/SKILL.md`
- Modify: `agents/sanitizer.md`
- Modify: `commands/maestro-setup.md`
- Modify: `commands/maestro-assistant.md`
- Modify: `commands/maestro-feedback-report.md`
- Modify: `commands/maestro-memory.md`
- Modify: `commands/maestro-memory-report.md`
- Modify: `commands/maestro-design.md`

- [ ] **Step 1: `skills/maestro-setup/SKILL.md`**

- Убрать генерацию `access_policy` из задачи «Конфигурация maestro» (раздел про maestro.json): вместо access_policy — генерация нативных permissions (Task 4 канон §3.3): read/glob/grep deny `maestro.json`/`.maestro/**` + read-allow `.maestro/plugin-version` + edit-ask `maestro.json` в `.opencode/opencode.json`.
- Убрать упоминание `access_policy` из перечня секций конфига.
- Добавить: чтение текущего `maestro.json` на существующем проекте (сравнение секций) — через **bash** (не read).

- [ ] **Step 2: `skills/maestro-setup/init-context.md`**

- Убрать блок про генерацию `access_policy` (§«access_policy»: allow из §3/§5, deny из §12).
- Заменить на: нативные permissions генерируются в `.opencode/opencode.json` (read/glob/grep deny maestro.json/.maestro, edit ask).

- [ ] **Step 3: `skills/maestro/SKILL.md`**

Убрать все живые упоминания access_policy и пласт «File access control»:
- Таблицу trust (trusted → «без ограничений по access_policy») — убрать фразу.
- Гейт «File access control» в HITL-протоколе (L803/831/870/924) — удалить (нет (a)/(b)-флоу через плагин).
- Таблицу слоёв «Sanitize промпта | File access control» (L1210/1217) — переписать: file-доступ = нативный permission-слой opencode.
- L1559 (гейт read-блок access_policy при re-dispatch) — удалить.
- L1580 («File access control не enforced — закрыт») — удалить.
- Шаг 0: «Оркестратор читает maestro.json» — добавить «через bash (нативный deny блокирует read-тул)».
- L1705 («обновить конфиг и перезапустить») — примечание: правка maestro.json через нативный edit ask (HITL) или bash.
- Прочие упоминания (L23, 396, 964, 1323–1334, 1343–1366, 1459, 1544–1556, 1950) — вычистить.

- [ ] **Step 4: `skills/maestro/invariants.md`**

Инвариант L34 «read-блоки access_policy» → заменить на «read-блоки нативного permission-слоя». **HITL-гейт на формулировку** (правило AGENTS.md: инварианты — только явное HITL-решение): показать изменение пользователю, получить подтверждение формулировки.

- [ ] **Step 5: `skills/maestro-feedback-report/SKILL.md`**

- Шаг 3b: убрать «`access_policy.blocked` — блокировки доступа (количество + basename)» из агрегации аудит-лога.
- Шаблон отчёта (секция Безопасность): убрать строку `access_policy.blocked: <кол-во>`.
- Чтение `.maestro/logs/*` (L15/77/92): добавить явную инструкцию «через bash (cat/sed)».
- L23/99: убрать упоминания.
- Запись отчёта (L108): через write — работает (edit-правил на `.maestro/**` нет).

- [ ] **Step 6: `skills/maestro-design/SKILL.md`**

- Убрать упоминания access_policy.
- Чтение maestro.json/`.maestro/last-run.md` — через bash.

- [ ] **Step 7: `agents/sanitizer.md`**

- Убрать роль «генерирует/поддерживает секцию `access_policy` в `maestro.json`».

- [ ] **Step 8: Команды**

- `commands/maestro-setup.md`, `commands/maestro-assistant.md`: убрать access_policy из перечня обрабатываемых секций; добавить «чтение maestro.json — через bash».
- `commands/maestro-feedback-report.md` (L29): убрать `access_policy.blocked`.
- `commands/maestro-memory.md`, `commands/maestro-memory-report.md`: «Прочитай maestro.json через read» → «через bash»; чтение `.maestro/logs/*` — через bash.
- `commands/maestro-design.md` (L10–13, проверка признаков init): чтение maestro.json/`.maestro/last-run.md` — через bash.

- [ ] **Step 9: Проверить остаточные упоминания**

Run: `grep -rn "access_policy" skills/ commands/ agents/`
Expected: 0 вхождений.

- [ ] **Step 10: Commit**

```bash
git add skills/ commands/ agents/
git commit -m "docs(maestro): remove access_policy from skills/commands/agents, bash-read for maestro.json"
```

---

### Task 6: SECURITY.md + manual_docs + корневые доки

**Files:**
- Modify: `SECURITY.md`
- Modify: `manual_docs/reference/config.md`
- Modify: `manual_docs/explanation/agents-and-trust.md`
- Modify: `manual_docs/reference/hitl-gates.md`
- Modify: `manual_docs/tutorials/setup-project.md`
- Modify: `manual_docs/reference/commands.md`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/project-context.md`
- Modify: `plugins/maestro-bootstrap/README.md`
- Modify: `docs/testing/maestro-sandbox-checklist.md`
- Modify: `maestro-sandbox.sh`
- Modify: `.sandbox/maestro.json`

- [ ] **Step 1: `SECURITY.md`**

- **P6** переписать: «`maestro.json` (в т.ч. `sanitizer_whitelist.patterns`) защищается **нативно** — deny в `.opencode/opencode.json` (read/glob/grep) + edit-ask; не плагином. Residual risk: bash `cat` остаётся доступен untrusted (паритет с прежним access_policy). Tamper: `.opencode/opencode.json` редактируем untrusted (parity), усиление — вне scope».
- Убрать access_policy из контрмер (§4) и enforcement-слоёв (L65/73/103): «access_policy, confidential-deny» → «confidential-deny»; «access_policy, проверка trusted-канала» → «проверка trusted-канала».
- §5 fail-open-постура: «плагин выключен → файловая защита...» — уточнить: confidential/секреты защищены нативным deny (Этап A) независимо от плагина; maestro.json/.maestro — нативно.

- [ ] **Step 2: `manual_docs/reference/config.md`**

- Удалить секцию «Секция `access_policy`» (включая JSON-пример и таблицу ключей).
- Удалить «Разрешение конфликтов» (deny > ask > allow).
- Лог-таблица: удалить строку `access_policy.blocked`, из примера события убрать `access_policy.blocked` (L254/259/266/276).
- L40 («конфиг maestro.json остаётся под контролем доступа»): переформулировать под нативный deny.
- L204 (access_policy и sanitizer — в плагине): убрать access_policy.

- [ ] **Step 3: `manual_docs/explanation/agents-and-trust.md`**

- Таблица trust (L46): «skip (без ограничений по access_policy)» → «skip sanitize; file-доступ — нативный permission-слой».
- L117-119 (File access control реализован в плагине): переписать — «file-доступ — нативные permissions opencode (deny/ask в `.opencode/opencode.json`); плагин больше не блокирует read».
- L122 (P6-блок «maestro.json остаётся за access_policy»): убрать/переписать под нативный deny.
- L108 (sanitizer генерирует access_policy): убрать роль.
- L191 (confidential.paths из access_policy.allow): убрать/переформулировать.
- L226 (при отключённом плагине sanitizer и access_policy не работают): убрать access_policy.
- L44/49/115 (пласт File access control): переписать.

- [ ] **Step 4: `manual_docs/reference/hitl-gates.md`**

- L92 (гейт «File access control | untrusted читает файл вне scope | (a) разрешить (b) запретить»): удалить/заменить — нативный ask без (a)/(b)-флоу через плагин.

- [ ] **Step 5: `manual_docs/tutorials/setup-project.md`**

- L39/L93 (упоминания access_policy в конфиге): убрать.
- Добавить миграционную заметку: «после обновления maestro перезапустите `/maestro-setup` — генерирует нативные deny maestro.json/.maestro; кастомные access_policy-правила перенесите вручную в `.opencode/opencode.json` (deny → read/glob/grep deny)».

- [ ] **Step 6: `manual_docs/reference/commands.md`**

- L102: убрать access_policy из перечня обрабатываемых секций.

- [ ] **Step 7: `README.md` (корневой)**

- Убрать access_policy из перечня (L51 в AGENTS, L~readme): из списка возможностей/секций конфига.

- [ ] **Step 8: `AGENTS.md`**

- L51 («access-policy blocks»): убрать упоминание.

- [ ] **Step 9: `docs/project-context.md`**

- L22, L75, L187, §12: убрать access_policy из упоминаний (в §12 оставить только confidential/sanitizer; отметить, что file-доступ — нативный).

- [ ] **Step 10: `plugins/maestro-bootstrap/README.md`**

- Раздел «File access control»: удалить; JSON-канон (access_policy): убрать; лог-таблица `access_policy.blocked`: удалить строку; прочие ~15 упоминаний: вычистить.

- [ ] **Step 11: `docs/testing/maestro-sandbox-checklist.md`**

- L41 (access_policy.blocked): убрать/заменить.

- [ ] **Step 12: `maestro-sandbox.sh`**

- L256–257 (сценарий «секрет вне built-in закрывается через confidential.paths/**access_policy.deny**»): заменить опору на **confidential.paths**; убрать прочие упоминания access_policy; убрать access_policy из JSON-канона в скрипте.

- [ ] **Step 13: `.sandbox/maestro.json`**

- Убрать секцию access_policy.

- [ ] **Step 14: Проверить остаточные упоминания**

Run: `grep -rn "access_policy" SECURITY.md manual_docs/ README.md AGENTS.md docs/project-context.md plugins/maestro-bootstrap/README.md docs/testing/ maestro-sandbox.sh .sandbox/maestro.json`
Expected: 0 вхождений (кроме исторических записей changelog, если оставлены).

- [ ] **Step 15: Аудит парафразов**

Run: `grep -rnE "File access control|контрол[ьяе] доступа" skills/ commands/ agents/ manual_docs/ SECURITY.md README.md AGENTS.md docs/`
Expected: 0 живых вхождений (переписаны под нативный deny); исторические changelog-записи допустимы.

- [ ] **Step 16: Commit**

```bash
git add SECURITY.md manual_docs/ README.md AGENTS.md docs/ plugins/maestro-bootstrap/README.md maestro-sandbox.sh .sandbox/maestro.json
git commit -m "docs(security): P6 native, drop access_policy from docs/manual_docs/sandbox"
```

---

### Task 7: Changelog + regression entry + финальная верификация

**Files:**
- Modify: `manual_docs/overview/changelog.md`
- Create: `regression/entries/2026-09-16-remove-access-policy.md`

- [ ] **Step 1: Changelog**

В `manual_docs/overview/changelog.md` добавить запись (в `[Unreleased]`, секция «Изменено»/«Удалено»):
```
## [Unreleased]

### Удалено
- `access_policy` из `maestro.json` и плагина `maestro-bootstrap` (R3/R9 rebalance):
  плагин больше не блокирует `read`; защита `maestro.json`/`.maestro/**` — нативные
  permissions (`.opencode/opencode.json`): read/glob/grep deny + edit ask
  (`maestro.json`) + allow `.maestro/plugin-version`.
  **BREAKING:** секция `access_policy` в конфиге игнорируется/удаляется.
  **Миграция:** после обновления перезапустите `/maestro-setup` (генерирует нативные
  deny); кастомные access_policy-правила перенесите вручную в `.opencode/opencode.json`.
  В authoring-репо обновлены локальные `.opencode/skills/*`-зеркала не требуются
  (`.opencode/` gitignored, регенерация при установке).
```

- [ ] **Step 2: Regression entry**

Создать `regression/entries/2026-09-16-remove-access-policy.md` (по шаблону соседних entries):
```markdown
# Regression: удаление access_policy (2026-09-16)

- **Severity:** HIGH (для maestro.json/.maestro) + MEDIUM (для удаления секции)
- **Фича:** `feature/remove-access-policy`
- **Риски:**
  1. `maestro.json`/`.maestro/**` читаемы untrusted через `read` до перезапуска
     `/maestro-setup` (нативный deny) — окно между обновлением плагина и сетапа.
  2. Кастомные access_policy-правила не переносятся автоматически.
  3. Плагин перестаёт блокировать read — fail-open для не-deny путей (компенсация — нативный deny).
- **Сценарии проверки:**
  1. Read `maestro.json` через `read`-тул → блокируется нативно (deny).
  2. Read `.maestro/plugin-version` → работает (allow-исключение).
  3. `/maestro-version` работает после рестарта.
  4. `/maestro-feedback-report` пишет отчёт в `.maestro/feedback-reports/`.
  5. Confidential-доступ trusted-агентов (custodian/sanitizer) — работает.
  6. sanitizer (Ур.1/Ур.2) — маскирует промпты.
```

- [ ] **Step 3: Финальный grep-контроль по спеке**

Run:
```bash
grep -rn "access_policy" plugins/maestro-bootstrap/ skills/ commands/ agents/ manual_docs/ SECURITY.md maestro.json README.md AGENTS.md docs/ maestro-sandbox.sh .sandbox/maestro.json | grep -vE "specs/|docs/superpowers/|regression/|\.maestro/|\.opencode/"
```
Expected: 0 вхождений.

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: зелёный.

Run: `node -e "JSON.parse(require('fs').readFileSync('.opencode/opencode.json','utf8')); JSON.parse(require('fs').readFileSync('maestro.json','utf8')); console.log('JSON ok')"`
Expected: `JSON ok`

- [ ] **Step 4: Commit**

```bash
git add manual_docs/overview/changelog.md regression/entries/2026-09-16-remove-access-policy.md
git commit -m "docs(changelog): access_policy removal — BREAKING + migration note; regression entry HIGH"
```

---

## Self-Review

- **Spec coverage:** §3.1→Task 1 (core.js), §3.2→Task 1 (tests), §3.3→Task 2 (.opencode) + Task 4 (канон permissions), §3.4→Task 3 (maestro.json), §3.5→Task 5 (скиллы/команды/агенты), §3.6→Task 6 (SECURITY/manual_docs/корневые), §3.7→не трогаем, §4→Task 7 (критерии приёмки), §5→Task 7 (regression/migration).
- **Placeholder scan:** нет TODO/TBD; код и команды конкретны.
- **Type/имя-консистентность:** `loadAccessPolicy`/`resolveFileAccess`/`globMatch` удаляются согласованно (Task 1 Steps 1–3); `filePathOf`/`isPluginMetaFile`/`confGlobMatch` остаются (используются confidential).
- **Порядок I6:** Task 2 (.opencode deny) ДО Task 3 (maestro.json) — реализатор не гейтит сам себя (edit ask maestro.json). В Task 1 плагин уже без access_policy — порядок Task 1 ↔ Task 2 не критичен, но Task 3 строго после Task 2.