# AGENTS.md

## What this repo is

This is the **authoring repo** for the OpenCode `maestro` system (the "maestro" skill that orchestrates feature/bugfix implementation in a target application). It is **not** the application repo — there is no application code here.

- `skills/maestro/SKILL.md` — authoritative pipeline spec (feature/bugfix orchestration, HITL gates, regression registry). Read it before touching anything in `skills/`.
- `agents/*.md` — OpenCode agent configs (`mode`, `permission`, `hidden`, `description` in YAML frontmatter). All are subagents (`custodian`, `haiku`, `sonnet`, `opus`, `fable`, `code-reviewer`, `sanitizer`). `custodian` and `sanitizer` are trusted by default (custodian: Q/A по confidential; sanitizer: security review). There is **no primary `maestro` agent** — entry is via the `@maestro-init` command (skill).
- `commands/*.md` — `@command` configs (frontmatter `agent:` field; `@maestro-init` is the entry point).
- `skills/maestro/{custodian-prompt.md,implementer-prompt.md,spec-review-prompt.md,stack-detection.md,auto-ai-decision-prompt.md}` — support files referenced by SKILL.md.
- `skills/maestro-setup/{SKILL.md,init-context.md}` — `/maestro-setup` skill for initializing new or existing projects (project-context.md 14 categories, maestro config, dirs, checks; design/scaffold/roadmap are in `/maestro-design`).
- `skills/maestro-design/SKILL.md` — `/maestro-design` skill for design + spec (via primary brainstorm + custodian Q/A), code scaffold (TDD), and roadmap.
- `skills/maestro-assistant/SKILL.md` — `/maestro-assistant` skill: consultation & config/structure/context organization for maestro (single source of config rules). Self-contained; loaded by `/maestro-setup` (tasks 2/3/3a) and `/maestro-init` (pipeline config questions).
- `skills/manual-docs/SKILL.md` — generic user-docs skill (доки целевого приложения, Diátaxis), загружается на шаге 14 пайплайна maestro. Отдельно от правила синхронизации `manual_docs/` самого maestro (ниже).
- `plugins/maestro-bootstrap/` — ESM OpenCode plugin. Contains an **optional memory module** (`plugins/maestro-bootstrap/memory/` — vector session memory: sqlite/qdrant/pgvector backends, embeddings, summarizer, recall, `memory_search` + management tools `memory_forget`/`memory_export`/`memory_import`/`memory_recall_preview`/`memory_stats_detail`, FTS5 hybrid search). Branch-aware (v3): commit-based record identity (`head`), commit-scoped recall (general/experience tiers), key-scoped promotion via `is-ancestor(head, mainline)`, mainline auto-detect (`branch_context`/`mainline` config keys). Branch-governed lifecycle (v5): идентичность записи (matching/промоция) — по `head`; ключ хранения — `session_id`; жизненный цикл — по git-ветке; `delete_on_session_delete` (default off); `/maestro-memory-prune`. Namespace-identity (v5.1): обязательный `memory.namespace` (формат `a.b.c`, 1–3 сегмента, lowercase, нормализация trim+lowercase; отсутствует → disabled `namespace_missing`), домены (авто-related родитель+братья, merged-only; `domain_recall` off-switch), `related` (кросс-доменные namespace-префиксы, merged-only, ≤16), `memory_migrate` (пере-keying from: auto|namespace|hash), поля записей `origin_remote`/`prefixes`. Artifact-links (v5.2): поле записей `artifacts[]` — repo-relative пути спек/планов из tool-частей сессии (`write`/`edit`), allowlist `memory.artifact_globs` (default маэстро-набор), рендер в recall-блоке/`memory_search`/`memory_recall_preview`. Reindex & history backfill (v3.5.0): HITL-инструмент `memory_reindex` (permission ask; light-путь sessions — 0 LLM; git-история — LLM-summarize спек, синтетические записи `author: "git-backfill"`), ключ `memory.history_globs` (default null → inherit `artifact_globs`; `[]` = off; невалидное → soft fallback + warn `memory:config_fallback`, память не отключается), команда `@maestro-memory-reindex`. Not part of the standard install; enabled via the `memory` section in `maestro.json` (see `manual_docs/reference/memory.md`). Commands `@maestro-memory` (status), `@maestro-memory-report` (HTML aggregates), `@maestro-memory-prune` (HITL) and `@maestro-memory-reindex` (HITL backfill) live in `commands/`. Summarizer model resolution (4.0.0, zero-key): `small_model → model → agent.maestro/build` из opencode-конфига, без ключа `summarizer_model`; fail-closed guard на git-пути `memory_reindex`.
- `specs/*.md` — **legacy** design specs and implementation plans for past work on this repo (kebab-case: `<topic>.md` for spec, `<topic>-plan.md` for plan). **New work (2026-09-02):** design docs are no longer created here. For **future** features/bugfixes on this repo, produce spec + plan via the **brainstorming skill** into `docs/superpowers/` (spec: `docs/superpowers/specs/YYYY-MM-DD-<feature-name>-design.md`; plan: `docs/superpowers/plans/YYYY-MM-DD-<feature-name>-plan.md`), never in the repo root or `specs/`. Keep `specs/` as historical record; do not add new files to it.
- `skills/maestro/invariants.md` — **канон инвариантов ⚑1–4** (ключевые правила-постулаты, которые ИИ нарушать нельзя; основа всех процессов и доработок maestro). Обязательный ориентир при любых доработках; изменения — только явное HITL-решение. Доставляется со скиллом в целевые приложения; SKILL.md ссылается на него при старте пайплайна.
- `SECURITY.md` — **internal security (ИБ) standard** for the maestro skill (trust model, ИБ requirements P1–P5, invariants, testing). Not part of `manual_docs/`. It is the source of truth for security decisions; specs/plans reference it.

## Gotchas

- **This IS a git repo** (authoring). `opencode.json`, `docs/project-context.md`, `regression/`, `.opencode/` belong to the target application repo, not this one. Don't run the maestro pipeline steps (`/maestro-setup`, `/maestro-design`, `@maestro-init`) here — they target the app repo. **Exception:** `manual_docs/` *does* live here — it documents the maestro skill itself (user-facing docs for developers of the target app); the target app has its own `manual_docs/` for its own product.
- **No root `opencode.json` here** (this is the authoring repo). The plugin is registered in the **local gitignored** `.opencode/opencode.json` on the target app (pointing to `maestro-bootstrap` from `git+https://github.com/wad-jet/maestro.git`) or in the global `~/.config/opencode/opencode.json`. The local `.opencode/opencode.json` (merge-config) is the usual registration point for development against this repo.
- **Agent was renamed `feature-agent` → `maestro` (2026-08-03).** The application repo must be updated in lockstep: `agent.*.model` keys in the merge-config (`agent.feature-agent` → `agent.maestro` in `.opencode/opencode.json` or global) and plugin path `plugins/feature-agent-bootstrap/index.js` → `plugins/maestro-bootstrap/index.js`, `.opencode/` mirrors (`agents/maestro.md`, `skills/maestro/`), and `.gitignore` entry `.feature-agent/` → **`.maestro/`** (весь каталог — только эфемерное; конфиг `maestro.json` в корне, см. `skills/maestro/SKILL.md`).
- **Russian is the working language.** All HITL gates, user messages, agent descriptions, and docs are in Russian. Match it in new content.

## Скиллы / Skills (доставка в целевое приложение)

`skills/` here is the source of truth. OpenCode loads skills/commands/agents from the **target application** repo (`.opencode/`). Delivery of changes to the target application is done via the **standard mechanism**: manually from the remote repository or through `agpack`. **Separate `.opencode/`-mirroring is NOT required** — the authoring repo is the single copy, published to the target application via repo/`agpack`.

- **Changes to `skills/maestro/SKILL.md`, `commands/*.md` or `agents/*.md` must also be reflected in `manual_docs/`** (user-facing docs for the maestro skill). Keeping `manual_docs/` in sync is part of the acceptance criteria for skill changes — see `manual_docs/how-to/keep-docs-up-to-date.md`.
- **Changes to `SECURITY.md` (ИБ principles) must also be reflected in `manual_docs/`** — `explanation/agents-and-trust.md`, `reference/model-selection.md`, `reference/config.md` (same rule as for `SKILL.md`). `SECURITY.md` is the root-level source of truth, outside `manual_docs/`.

SKILL.md files are read by the orchestrator agent; `implementer-prompt.md` is self-contained and must stay loadable without the `skill` tool.

## Plugin

Test (Node built-in test runner, no deps):

```bash
node --test plugins/maestro-bootstrap/index.test.js
# or: npm test
```

Memory module tests (optional deps in devDependencies):

```bash
npm run test:memory
```

- Global observability (not bound to any agent): logs key events for all sessions — `session.error`, `task` dispatch (`tool.execute.before`/`tool.execute.after`, sanitized title), empty subagent result, access-policy blocks. Sanitizes `task` prompts (Level 1 Security Review) before untrusted subagents. The old bootstrap-directive injection via `experimental.chat.messages.transform` was removed — `transform` must stay `undefined`.
- Logs JSONL to `.maestro/logs/maestro-bootstrap-<date>.log` (one file per day). Env: `MAESTRO_BOOTSTRAP_LOG_LEVEL` (default `info`), `MAESTRO_BOOTSTRAP_LOG_DIR` (default `<project>/.maestro/logs`).
- All hooks are `try/catch`-guarded and global (not scoped to `maestro` sessions) — keep that invariant when modifying.
