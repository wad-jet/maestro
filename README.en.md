# maestro

Orchestration system for end-to-end feature and bugfix implementation in a target application via OpenCode. Pipeline from design to merge: ** brainstorm → spec → plan → SDD → review → docs ** —
with HITL gates at key checkpoints.

> This is an **authoring repository** (source of skills, agents, commands). There is no application —
> install via `maestro-install.sh` (global or project mode; see
> [Documentation](manual_docs/index.md)).

## What is maestro

| Component | Description |
|---|---|
| **`maestro` skill** | Pipeline specification (features / bugfixes / bug-debug) — `skills/maestro/SKILL.md` |
| **`/maestro-init` command** | Pipeline entry point — loads the skill and starts the pipeline |
| **Subagents** | `custodian`, `haiku`, `sonnet`, `opus`, `fable`, `reviewer`, `sanitizer` |
| **Plugin** | `maestro-bootstrap` — prompt sanitization, audit logs |
| **Memory (optional)** | Plugin memory layer — vector session memory (`memory_search`, auto-recall); enabled via `memory` section in `maestro.json` |
| **Commands** | `/maestro-init`, `/maestro-setup`, `/maestro-design`, `/regression`, `/test-agents` |

## Maestro vs superpowers directly

`maestro` is an **orchestrator on top of [superpowers](https://github.com/obra/superpowers) skills**: it connects them into a single
pipeline with HITL gates, without replacing the skills themselves. The choice between `maestro` and
using superpowers directly is a choice between "all-inclusive" and "manual assembly".

| Aspect | Maestro (`/maestro-init`) | Superpowers directly |
|---|---|---|
| **Scope** | Full feature cycle: design → spec → plan → SDD → review → docs | Individual stage (plan, implementation, review, etc.) |
| **Orchestration** | Automatic: orchestrator dispatches subagents along the route | Manual: you decide which skill to call and when |
| **HITL gates** | Built-in at key points (category, spec, plan, pre-PR) | None — each skill works according to its own scheme |
| **Spec / Spec Review** | Automatic for complex/architectural features | You call manually (`brainstorming`, `writing-plans`) |
| **Security** | Built-in sanitizer + native OpenCode permissions (deny/ask) | None (you rely on OpenCode permissions) |
| **Regression** | Risk registry + `/regression` | None |
| **When to use** | End-to-end feature/bugfix from start to finish | One specific step, manual control of each step |

**Example using superpowers directly** — implement a plan without the rest of the pipeline:

```
/brainstorming  →  /writing-plans  →  subagent-driven-development  →  /requesting-code-review
```

The same skills are used inside `maestro`: `writing-plans`,
`subagent-driven-development`, `test-driven-development`, `using-git-worktrees`,
`requesting-code-review`, `finishing-a-development-branch`, `systematic-debugging` —
but the orchestrator connects them into a single managed process.

## Quick Start

### 1. Set up the project

**The easiest way is the `maestro-install.sh` script** (new or existing
project, where maestro has not been applied before). **Global mode** (recommended)
deploys skills/commands/agents and the plugin across the entire machine — no
maestro file ends up in the project git:

```bash
curl -fsSL https://raw.githubusercontent.com/wad-jet/maestro/main/maestro-install.sh -o maestro-install.sh
bash maestro-install.sh --global    # options: --pin <sha>, --dry-run, --migrate, --help
```

> Prerequisites: bash (macOS/Linux), git, curl/wget, python3 (any version —
> only for plugin JSON registration), network.
> Windows — run via WSL or Git Bash. After the script — restart
> OpenCode and run `/maestro-setup` (see step 3 below).

Project mode (skills/commands/agents in the project's `.opencode/`) —
`bash maestro-install.sh --project`. Both modes use the same delivery mechanism:
`git clone` (https-only, shallow) + **wholesale copy** of all `skills/`,
`commands/`, `agents/` (including superpowers) + manifest. Detailed instructions
with a path map and manual plugin connection —
[First maestro installation](manual_docs/how-to/install-maestro.md).

### 2. Connect the plugin

The `maestro-bootstrap` plugin (prompt sanitization, audit logs)
must be connected **before** running the pipeline. The installation script connects it
**automatically** in both modes (idempotent, de-dup: only "our" entries in
`plugins`): global — in `~/.config/opencode/opencode.json`, project — in
`.opencode/opencode.json`. The plugin is delivered from the git repository
`wad-jet/maestro` (npm publishing is not used); manual connection
(including from local sources) — in
[First maestro installation](manual_docs/how-to/install-maestro.md).

> **Plugin version.** The only source of version is the root `package.json`
> of the repository (current — from it). `readPluginVersion()` resolves it relative
> to `core.js` (`plugins/maestro-bootstrap/` → `../../package.json`, fixed
> repo layout depth). Do not copy the plugin folder separately from the repository —
> the version will not be resolved (`/maestro-version` will report "not initialized").

### 2.5. How to update maestro

The version of **both the plugin and the skills is unified** (root `package.json → version`).

- **Global update — `maestro-update.sh --global`:** one command
  updates skills/commands/agents and the plugin across the entire machine (clone → manifest
  diff → prune HITL → wholesale copy → plugin cache cleanup → re-reg).
  Service restart — HITL with warning "will interrupt all projects". Optionally
  `--pin <sha>` (maestro and superpowers on the same commit).
- **Project update — `maestro-update.sh` (default `--project`):** the same
  mechanism for a single project (``.opencode/` + project manifest).
- **Plugin:** cached in `~/.cache/opencode/npm/git-maestro-*` (V2-layout) and NOT
  updated on OpenCode restart — restart alone will not pull the new
  version. The cache is cleared by `maestro-update.sh`; for manual update — clear the cache
  manually (`rm -rf ~/.cache/opencode/npm/git-maestro-*`) + restart.
  To pin a commit — `--pin <sha>` (registration `spec#sha`). Registration —
  `plugins` key (V2; do not mix legacy `plugin` — double registration).
- **Version check:** `/maestro-version` — shows the actual plugin
  version (`.maestro/plugin-version`).

Details — [Updating maestro](manual_docs/how-to/update-maestro.md).

### 3. Initialize the project

In the target OpenCode session:

| Command | For whom | What it does |
|---|---|---|
| `/maestro-setup` | New and existing | Creates `project-context.md`, `maestro.json`, `.gitignore`, `.maestro/` and `regression/` directories; for existing — detects context and merges configs |
| `/maestro-design` | New (optional) | Design + spec + scaffold + roadmap |

- **New project:** `/maestro-setup` → `/maestro-design` → `/maestro-init`
- **Existing project:** `/maestro-setup` → `/maestro-init`

> **Note (v2.0.0):** `/maestro-init` is now the **feature pipeline entry**
> (formerly bootstrap). New project bootstrap — `/maestro-setup`. Old `/maestro`
> command removed. For pre-reform installs — migration
> `maestro-install.sh --global --migrate` (or `--project --migrate`).

Details — [Project setup](manual_docs/tutorials/setup-project.md).

#### Model configuration note

The full model tier configuration (tier mapping, trust model, agent model assignments,
`temperature` defaults, and configuration cascade) is too detailed for this README.
For model configuration details, see [Model Selection](manual_docs/reference/model-selection.md).

### 4. Run the pipeline

In any OpenCode session:

```bash
/maestro-init "Implement CSV export with pagination"
/maestro-init --auto-answer "..."   # auto-answer (-aa): full flow, recommendations at routine gates — automatic
/maestro-init --auto-ai "..."       # auto-ai (-ai): AI decides itself with additional analysis (ralph loop; Phase 2)
```

The orchestrator will guide you through HITL gates: context → pre-flight → feature category → spec (if complex) → plan → implementation → review → merge.
Gates 10 (spec) and 17 (merge) are always confirmed by a human — in any mode.

### Quick route for simple features

For small tasks on 1-2 files, the spec can be skipped: **simple** category
→ route `0→6→7(b)→11→13→16→18`. The condensed path skips steps 14/15/15a for
brevity — **step 14 (user documentation update) is mandatory**
for all categories (for simple features, only steps 8-10 are skipped).

## Maestro Memory (optional module)

The `maestro-bootstrap` plugin contains an optional **memory layer** — vector
session memory (local and centralized): auto-summarization of completed
sessions, semantic search (`memory_search`, hybrid search on all backends —
sqlite FTS5, pg tsvector, qdrant payload full-text, RRF fusion) and auto-recall
of relevant context in new sessions. **Not included in the standard installation**
(zero footprint by default); enabled via the `memory` section in `maestro.json`
(`enabled: true`). Backends: local sqlite (default) or centralized
qdrant/pgvector. Management: `memory_forget`, `memory_export`/`memory_import`
(migration between backends), `memory_recall_preview` (dry-run tuning),
`memory_stats_detail`; commands `@maestro-memory` (status) and
`@maestro-memory-report` (HTML report, aggregates only). More —
[How to enable memory](manual_docs/how-to/enable-memory.md) and
[Maestro memory (reference)](manual_docs/reference/memory.md).

## Documentation

Full `maestro` skill documentation — in the [Diátaxis reference](manual_docs/index.md).

## Structure

```
agents/            — subagent configs (custodian, haiku, sonnet, opus, fable, reviewer, sanitizer)
commands/          — @command configs (/maestro-init, /maestro-setup, /regression, /test-agents)
plugins/           — maestro-bootstrap (ESM plugin: sanitize, observability)
skills/            — skills (maestro, maestro-setup, maestro-design, manual-docs — generic user-docs)
specs/             — design specs and plans for this repo (never in root!)
manual_docs/       — skill user documentation (Diátaxis)
maestro-install.sh — installation script (global/project mode, 6.3.0)
maestro-update.sh  — update script (global/project mode, 6.3.0)
maestro-install/   — deterministic tests (docs-drift, test-coverage)
```

## Plugin Tests

```bash
node --test plugins/maestro-bootstrap/index.test.js
# or:
npm test
```

---

> **Russian — working language.** All HITL gates, user messages, and
> documentation are in Russian. New content follows this convention.
