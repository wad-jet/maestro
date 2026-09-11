# Commit-узлы в графе отчёта памяти — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Узлы графа в `@maestro-memory-report` и `memory_stats_detail` идентифицируют commit (`head`), а не сессию, с метаданными head/ветка/число сессий/тир.

**Architecture:** `memory_stats_detail` (tool) группирует строки scan по `head` в commit-узлы (центроид эмбеддингов группы), считает рёбра по центроидам и отдаёт секции `Узлы графа:` + `Граф:` (компактные ключи). Команда `@maestro-memory-report` рендерит commit-граф по этим секциям. `@maestro-memory` не меняется (читает только счётчики). SEC-4b: только агрегаты.

**Tech Stack:** Node.js (ESM), встроенный test runner (`node --test`), git.

**Spec:** `docs/superpowers/specs/2026-09-11-memory-report-commit-nodes-design.md`

---

### Task 1: Commit-node helpers в `memory/index.js`

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/index.js` (после `buildGraph`, ~стр. 253)

- [ ] **Step 1: Добавить helpers `centroid`, `TIER_PRIORITY`, `buildCommitNodes`, `nodeTier`**

Вставь после функции `buildGraph` (строки 233–253):

```js
/**
 * Unit-norm centroid of a set of normalized vectors (mean, renormalized).
 * @param {Float32Array[]} vectors
 * @returns {Float32Array|null}  null when vectors is empty.
 */
function centroid(vectors) {
  if (!vectors.length) return null;
  const dim = vectors[0].length;
  const sum = new Float32Array(dim);
  for (const v of vectors) for (let i = 0; i < dim; i++) sum[i] += v[i];
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += sum[i] * sum[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) sum[i] /= norm;
  return sum;
}

/**
 * Node tier priority: dead > unknown > experience > merged (most restrictive wins).
 */
const TIER_PRIORITY = { dead: 3, unknown: 2, experience: 1, merged: 0 };

/**
 * Commit-graph nodes from scan rows: sessions grouped by head (record identity
 * in memory v3+); head='' → unattributed node per session (key ses:<sid>).
 * Node embedding = centroid of member embeddings (subset with valid embedding);
 * node without any embedding is isolated (present, but no edges).
 * @param {Array<object>} rows  scan rows (session_id, head, branch, merged,
 *   time_last, embedding)
 * @returns {Array<object>} nodes
 */
function buildCommitNodes(rows) {
  const groups = new Map();
  for (const r of rows) {
    const head = r.head ?? "";
    const key = head ? `head:${head}` : `ses:${r.session_id}`;
    let node = groups.get(key);
    if (!node) {
      node = { key, head, ses: head ? "" : r.session_id, branch: "", sessions: 0, session_ids: [], vectors: [], lastTime: -Infinity };
      groups.set(key, node);
    }
    node.sessions++;
    node.session_ids.push(r.session_id);
    const ts = r.time_last ?? 0;
    if (ts >= node.lastTime) {
      node.lastTime = ts;
      node.branch = r.branch ?? "";
    }
    if (r.embedding) node.vectors.push(r.embedding);
  }
  const nodes = [];
  for (const node of groups.values()) {
    node.compact = node.head ? `h:${node.head.slice(0, 12)}` : `s:${node.ses.slice(0, 12)}`;
    node.embedding = centroid(node.vectors);
    delete node.vectors;
    nodes.push(node);
  }
  return nodes;
}

/**
 * Node tier = most restrictive member tier (dead > unknown > experience > merged).
 * Missing per-session tier → unknown.
 * @param {{session_ids: string[]}} node
 * @param {Map<string,string>} tierBySession
 * @returns {string}
 */
function nodeTier(node, tierBySession) {
  let prio = -1;
  let tier = "merged";
  for (const sid of node.session_ids) {
    const t = tierBySession.get(sid) ?? "unknown";
    const p = TIER_PRIORITY[t] ?? 1;
    if (p > prio) { prio = p; tier = t; }
  }
  return tier;
}
```

- [ ] **Step 2: Обобщить `buildGraph` параметром `idFn`**

Замени подпись и строку `edges.push` в функции `buildGraph` (строки 241–253):

```js
function buildGraph(entries, threshold, cap = 500, idFn = (e) => e.session_id) {
  const edges = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const score = cosine(entries[i].embedding, entries[j].embedding);
      if (score > threshold) {
        edges.push([idFn(entries[i]), idFn(entries[j]), score]);
        if (edges.length >= cap) return edges;
      }
    }
  }
  return edges;
}
```

- [ ] **Step 3: Прогнать тесты — зелёные (поведение не менялось)**

Run: `node --test plugins/maestro-bootstrap/memory/index.test.js`
Expected: PASS (existing tests, 121 tests; helpers не вызываются)

- [ ] **Step 4: Commit**

```bash
git add plugins/maestro-bootstrap/memory/index.js
git commit -m "feat(memory): commit-node helpers for stats graph (centroid, grouping, tier)"
```

---

### Task 2: Интеграция commit-графа в `memory_stats_detail`

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/index.js` (функция `memory_stats_detail`, ~стр. 1150–1248)

- [ ] **Step 1: Заменить блок тиров/графа единым блоком**

В `memory_stats_detail` замени блок с `const threshold = ...; const clusters = clusterEntries(usable, threshold); const graph = buildGraph(usable, threshold, 500);` и последующий вывод графа (`out.push(\`Граф (рёбер: ${graph.length}):\`)` …), а также старый блок тиров (`const tierCounts = ...` … `branchCounts`), на:

```js
            const threshold = config.similarity_threshold ?? 0.7;
            const clusters = clusterEntries(usable, threshold);

            // commit-nodes: группировка по head (по всем строкам scan).
            // Тиры/ветки — единый membership-проход (tierBySession) для счётчиков
            // и узлов; fail-soft — merged-флаг.
            const nodes = buildCommitNodes(rows);
            const tierBySession = new Map();
            const tierCounts = { merged: 0, experience: 0, unknown: 0, dead: 0 };
            const branchCounts = new Map();
            let failSoft = false;
            const sets = computeBranchSets({ revList, detectMainline, root, mainlineOverride: config.mainline ?? null });
            failSoft = sets.failSoft;
            if (rows.length) {
              if (failSoft) {
                for (const row of rows) {
                  if (row.merged === 1) tierCounts.merged++;
                  tierBySession.set(row.session_id, row.merged === 1 ? "merged" : "unknown");
                }
              } else {
                const r = applyBranchScope(rows, sets);
                for (const row of rows) {
                  const sid = row.session_id;
                  let tier;
                  if (r.experience.has(sid)) { tierCounts.experience++; tier = "experience"; }
                  else if (r.inContext.has(sid)) { tierCounts.merged++; tier = "merged"; }
                  else if (r.unknown.has(sid)) { tierCounts.unknown++; tier = "unknown"; }
                  else { tierCounts.dead++; tier = "dead"; }
                  tierBySession.set(sid, tier);
                }
              }
              for (const row of rows) {
                const b = row.branch ?? "";
                branchCounts.set(b, (branchCounts.get(b) ?? 0) + 1);
              }
            }
            for (const n of nodes) n.tier = nodeTier(n, tierBySession);
            const nodeGraph = buildGraph(nodes, threshold, 500, (n) => n.compact);
```

- [ ] **Step 2: Заменить вывод графа на секции «Узлы графа» + «Граф»**

В том же месте, где раньше выводился граф (`out.push(\`Граф (рёбер: ${graph.length}):\`)` + цикл), теперь:

```js
            const sortedNodes = [...nodes].sort((a, b) => b.sessions - a.sessions).slice(0, 500);
            const extraNodes = nodes.length - sortedNodes.length;
            out.push(`Узлы графа (${nodes.length}):`);
            for (const n of sortedNodes) {
              out.push(`  ${n.head ? `head=${n.head}` : `ses=${n.ses}`} | branch=${n.branch} | sessions=${n.sessions} | tier=${n.tier} | session_ids=${n.session_ids.join(", ")}`);
            }
            if (extraNodes > 0) out.push(`  …(+${extraNodes} узлов ещё)`);
            out.push(`Граф (рёбер: ${nodeGraph.length}):`);
            for (const [a, b, s] of nodeGraph) out.push(`  ${a} <-> ${b}: ${s.toFixed(2)}`);
```

Секции Key/Бэкенд/Модель/Каталог/Записей/По авторам/По датам/Кластеры/Тиры/По веткам/Диагностики — остаются как есть (заголовок `Граф (рёбер: N):` сохранён → совместимость с `@maestro-memory`).

- [ ] **Step 3: Прогнать тесты — существующие зелёные**

Run: `node --test plugins/maestro-bootstrap/memory/index.test.js`
Expected: PASS (существующие тесты `memory_stats_detail` — кластеры/граф/тиры/fail-soft; ключи рёбер теперь `s:<prefix>`, но session_id встроен → регексы `/s1.*s2/` и т.п. продолжают совпадать)

- [ ] **Step 4: Commit**

```bash
git add plugins/maestro-bootstrap/memory/index.js
git commit -m "feat(memory): commit-node graph in memory_stats_detail (Узлы графа section)"
```

---

### Task 3: Тесты commit-графа

**Files:**
- Test: `plugins/maestro-bootstrap/memory/index.test.js` (добавить тесты после блока Task 8, после теста `memory_stats_detail graph edges above threshold`, ~стр. 1692)

- [ ] **Step 1: Написать падающие тесты**

Вставь после теста `"memory_stats_detail graph edges above threshold"` (строка 1692):

```js
test("memory_stats_detail: commit-node grouping by head (centroid edge + metadata)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-cn-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const storage = mkMockStorage();
    storage.stats = async () => ({ entries: 3 });
    // s1+s2 — один head (группа A); s3 — другой head (B). Центроид A
    // преодолевает порог к B, хотя ни s1, ни s2 по отдельности не преодолевают.
    storage.scan = async () => [
      { session_id: "s1", title: "T1", author: "a", time_last: 1000, origin_project_hash: "h", embedding: new Float32Array([1, 0, 0]), merged: 1, head: "aaaa0000aaaa", branch: "main" },
      { session_id: "s2", title: "T2", author: "a", time_last: 2000, origin_project_hash: "h", embedding: new Float32Array([0.9, 0.1, 0]), merged: 1, head: "aaaa0000aaaa", branch: "main" },
      { session_id: "s3", title: "T3", author: "b", time_last: 3000, origin_project_hash: "h", embedding: new Float32Array([0.7, 0.7, 0]), merged: 1, head: "bbbb0000bbbb", branch: "feature/x" },
    ];
    const git = {
      detectMainline: () => ({ name: "main" }),
      revList: () => new Set(),
      isAncestor: () => "no",
    };
    const hooks = await registerMemoryHooks({
      client: mkClient(),
      config: mkConfig(dir),
      log: silentLog,
      root: dir,
      deps: { storage, embeddings: mkMockEmbeddings(), git },
    });
    const res = await hooks.tool.memory_stats_detail.execute({}, { sessionID: "s1" });
    assert.match(res, /Узлы графа \(2\):/, "two unique heads → two nodes");
    assert.match(res, /head=aaaa0000aaaa \| branch=main \| sessions=2 \| tier=merged \| session_ids=s1, s2/, "grouped node metadata");
    assert.match(res, /head=bbbb0000bbbb \| branch=feature\/x \| sessions=1 \| tier=merged \| session_ids=s3/, "singleton node");
    // рёбро между commit-узлами существует ТОЛЬКО через центроид:
    // cos(s1,B)=0.7, cos(s2,B)=0.7 (не > 0.7), cos(centroidA,B)≈0.74
    assert.match(res, /h:aaaa0000aaaa <-> h:bbbb0000bbbb: 0\.7[0-9]/, "edge by centroid");
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("memory_stats_detail: unattributed (head='') node per session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-cn-unatt-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const storage = mkMockStorage();
    storage.stats = async () => ({ entries: 2 });
    storage.scan = async () => [
      { session_id: "u1", title: "T1", author: "a", time_last: 1000, origin_project_hash: "h", embedding: new Float32Array([1, 0, 0]), merged: 0, head: "", branch: "" },
      { session_id: "u2", title: "T2", author: "a", time_last: 2000, origin_project_hash: "h", embedding: new Float32Array([0.9, 0.1, 0]), merged: 0, head: "", branch: "" },
    ];
    const hooks = await registerMemoryHooks({
      client: mkClient(),
      config: mkConfig(dir),
      log: silentLog,
      root: dir,
      deps: { storage, embeddings: mkMockEmbeddings() },
    });
    const res = await hooks.tool.memory_stats_detail.execute({}, { sessionID: "s1" });
    assert.match(res, /Узлы графа \(2\):/, "two headless sessions → two unattributed nodes");
    assert.match(res, /ses=u1 \| branch= \| sessions=1 \| tier=unknown \| session_ids=u1/, "unattributed node u1");
    assert.match(res, /ses=u2 \| branch= \| sessions=1 \| tier=unknown \| session_ids=u2/, "unattributed node u2");
    assert.match(res, /s:u1 <-> s:u2/, "edge between unattributed nodes by ses key");
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("memory_stats_detail: isolated node when no member has embedding", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-cn-iso-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const storage = mkMockStorage();
    storage.stats = async () => ({ entries: 2 });
    storage.scan = async () => [
      { session_id: "e1", title: "T1", author: "a", time_last: 1000, origin_project_hash: "h", embedding: new Float32Array([1, 0, 0]), merged: 1, head: "eeee0000eeee", branch: "main" },
      { session_id: "e2", title: "T2", author: "a", time_last: 2000, origin_project_hash: "h", embedding: null, merged: 1, head: "eeee0000eeee", branch: "main" },
    ];
    const git = { detectMainline: () => ({ name: "main" }), revList: () => new Set(), isAncestor: () => "no" };
    const hooks = await registerMemoryHooks({
      client: mkClient(),
      config: mkConfig(dir),
      log: silentLog,
      root: dir,
      deps: { storage, embeddings: mkMockEmbeddings(), git },
    });
    const res = await hooks.tool.memory_stats_detail.execute({}, { sessionID: "s1" });
    assert.match(res, /Узлы графа \(1\):/, "node present even when embedding is null");
    assert.match(res, /head=eeee0000eeee \| branch=main \| sessions=2/, "node counts sessions without embedding");
    assert.match(res, /Граф \(рёбер: 0\):/, "isolated node → no edges");
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("memory_stats_detail: node tier = most restrictive member (merged vs experience)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-cn-tier-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const storage = mkMockStorage();
    storage.stats = async () => ({ entries: 2 });
    // hp: s1 merged=1 → merged; s2 merged=0, head∈ancestorSet(HEAD) но ∉ mainline
    // → experience. Один head → тир узла = experience (приоритет).
    storage.scan = async () => [
      { session_id: "s1", title: "T1", author: "a", time_last: 1000, origin_project_hash: "h", embedding: new Float32Array([1, 0, 0]), merged: 1, head: "hp", branch: "feature/p" },
      { session_id: "s2", title: "T2", author: "a", time_last: 2000, origin_project_hash: "h", embedding: new Float32Array([0.9, 0.1, 0]), merged: 0, head: "hp", branch: "feature/p" },
    ];
    const git = {
      detectMainline: () => ({ name: "main" }),
      revList: (root, ref) => (ref === "HEAD" ? new Set(["hp"]) : new Set()),
      isAncestor: () => "no",
    };
    const hooks = await registerMemoryHooks({
      client: mkClient(),
      config: mkConfig(dir),
      log: silentLog,
      root: dir,
      deps: { storage, embeddings: mkMockEmbeddings(), git },
    });
    const res = await hooks.tool.memory_stats_detail.execute({}, { sessionID: "s1" });
    assert.match(res, /head=hp \| branch=feature\/p \| sessions=2 \| tier=experience \| session_ids=s1, s2/, "node tier = experience (priority over merged)");
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Прогнать — новые падают (секции нет)**

Run: `node --test plugins/maestro-bootstrap/memory/index.test.js`
Expected: FAIL (нет секции `Узлы графа` / другая семантика) — но Task 2 уже внёс изменения, поэтому после Task 2 тесты должны проходить. Порядок задач в плане допускает реализацию Task 2 до Task 3; при SDD-исполнении Task 3 приходит первым → ожидаем FAIL на Step 2, затем Task 2 делает PASS.

- [ ] **Step 3: Прогнать весь memory-контур — зелёные**

Run: `node --test plugins/maestro-bootstrap/memory/index.test.js`
Expected: PASS (все новые + существующие)

- [ ] **Step 4: Commit**

```bash
git add plugins/maestro-bootstrap/memory/index.test.js
git commit -m "test(memory): commit-node graph tests (grouping, centroid, unattributed, isolated, tier)"
```

---

### Task 4: Команда `@maestro-memory-report` — рендер commit-графа

**Files:**
- Modify: `commands/maestro-memory-report.md`

- [ ] **Step 1: Переписать шаг 3.5 (граф)**

Замени текущий раздел `### 3.5 Similarity graph (session pairs above threshold)` на:

```markdown
### 3.5 Similarity graph (commit nodes)

- Секции для парсинга: `Узлы графа (M):` и `Граф (рёбер: N):` из вывода `memory_stats_detail`.
- **Узел — commit (`head`)**; сессии одного `head` — один узел. Записи без `head`
  (ключ `ses:`) — unattributed-узлы (по сессии).
- Рендер SVG-графа:
  - узел-круг; подпись — компактный ключ (`h:<12 hex>` / `s:<12 символов session_id>`);
  - под узлом — ветка (если есть) и бейдж `×N` (число сессий);
  - цвет по тиру: merged `#22c55e`, experience `#3b82f6`, unknown `#f59e0b`,
    dead `#ef4444`; unattributed — серый контур;
  - ребро — линия, opacity пропорциональна весу.
- Легенда тиров + таблица узлов: полный `head` (или `ses:<session_id>`), ветка,
  sessions, tier, session_ids.
- Только агрегаты (SEC-4b): хеши commit, имена веток, счётчики, тиры, session_id
  — разрешены; titles/summary/decisions — запрещены.
```

- [ ] **Step 2: Обновить whitelist шага 3.6**

В разделе `### 3.6 SEC-4b enforcement` при `include_text: false` в список разрешённого
добавь (после «session_id (node IDs в графе)»):

```markdown
- Разрешено: count, author names, dates, cluster sizes, theme aggregate-labels,
  session_id (node IDs в графе), **head-хеши commit, имена веток, тиры** (git-метаданные,
  уже присутствующие в tool-выводе, — не текст записей).
```

- [ ] **Step 3: Сверка секций — формат цел**

Проверь, что секции 3.1–3.4 и шаги 1–5 команды не задеты (diff только в 3.5/3.6).

- [ ] **Step 4: Commit**

```bash
git add commands/maestro-memory-report.md
git commit -m "feat(commands): @maestro-memory-report renders commit-node graph (SEC-4b whitelist + head/branch/tier)"
```

---

### Task 5: Синхронизация `manual_docs/`

**Files:**
- Modify: `manual_docs/reference/memory.md` (секции `memory_stats_detail` ~стр. 515–527 и `@maestro-memory-report` ~стр. 571–587)
- Modify: `manual_docs/reference/commands.md` (секция `@maestro-memory-report`, ~стр. 103–107)

- [ ] **Step 1: Обновить секцию `memory_stats_detail` в memory.md**

В описании `memory_stats_detail` (строки 515–527) замени пункт про граф:

```markdown
- Агрегатная статистика активного `key`: число записей, по авторам, по датам,
  **кластеры тем** (greedy-кластеризация по cosine > `similarity_threshold`;
  тема = представительный title), **граф похожести по commit-узлам** (узлы — коммиты
  `head`, сессии одного `head` группируются; вес ребра — косинус между **центроидами**
  эмбеддингов группы, порог `similarity_threshold`, cap 500 рёбер; записи без `head`
  — unattributed-узлы по сессии; узел без эмбеддингов — изолированный). Секции вывода:
  `Узлы графа (M):` (head/`ses`, branch, sessions, tier, session_ids) и `Граф (рёбер: N):`
  (компактные ключи `h:<12 hex>` / `s:<12 символов>`). Кластеризация и pairwise-cosine
  вычисляются в инструменте (O(n²) по `scan(key)`), не в LLM. Для `@maestro-memory`
  «количество связей» означает число commit-рёбер; `similarity_threshold` применяется
  к центроидной похожести.
```

- [ ] **Step 2: Обновить секцию `@maestro-memory-report` в memory.md**

В секции `@maestro-memory-report` (строки 571–587) замени упоминание «граф похожести»
и whitelist:

```markdown
…кластеры, авторы, **граф похожести по commit-узлам** (head-хеши, ветки, тиры,
число сессий; компактные ключи `h:`/`s:`; легенда тиров + таблица узлов).
**Только агрегаты (SEC-4b):** при `report.include_text: false` (default) в HTML не
попадают никакие тексты (ни title, ни summary, ни decisions) — только числа, имена
авторов, даты, размеры кластеров, aggregate-label тем, session_id в графе,
**head-хеши commit, имена веток, тиры** (git-метаданные, не текст записей).
```

- [ ] **Step 3: Обновить `@maestro-memory-report` в commands.md**

В секции `@maestro-memory-report` (строки 103–107) замени «кластеры, граф» на
«кластеры, commit-граф»:

```markdown
(агрегаты, timeline-гистограмма, кластеры, commit-граф по head с тирами; SEC-4b) в
```

- [ ] **Step 4: Проверка diff-сверки**

Run: `git diff manual_docs/ | head -80`
Expected: только описанные изменения; обновлены все места, где упоминается «граф похожести».

- [ ] **Step 5: Commit**

```bash
git add manual_docs/reference/memory.md manual_docs/reference/commands.md
git commit -m "docs(memory): commit-node graph semantics in manual_docs (memory_stats_detail, @maestro-memory-report)"
```

---

### Task 6: Полный прогон + план-гейт (шаг 12 maestro)

- [ ] **Step 1: Полный тест-контур**

Run: `npm run test:memory`
Expected: PASS
Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS (176 тестов, без регрессий)

- [ ] **Step 2: Manual-проверка вывода**

Запусти `@maestro-memory` и `@maestro-memory-report` на реальных данных (7 записей):
ожидаем секции `Узлы графа (6):` + `Граф (рёбер: …):`; в отчёте — commit-узлы с
ветками/бейджами/тирами; `@maestro-memory` продолжает показывать счётчики.
```