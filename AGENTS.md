# AGENTS.md

## What this repo is

This is the **authoring repo** for the OpenCode `maestro` system (the "maestro" agent that orchestrates feature/bugfix implementation in a target application). It is **not** the application repo — there is no application code here.

- `skills/maestro/SKILL.md` — authoritative pipeline spec (feature/bugfix orchestration, HITL gates, regression registry). Read it before touching anything in `skills/`.
- `agents/*.md` — OpenCode agent configs (`mode`, `permission`, `hidden`, `description` in YAML frontmatter). `maestro.md` is `mode: primary`; the rest (`haiku`, `sonnet`, `opus`, `fable`, `code-reviewer`, `sanitizer`) are subagents. `sanitizer` is trusted by default (security review).
- `commands/*.md` — `@command` configs (frontmatter `agent:` field).
- `skills/maestro/{implementer-prompt.md,spec-review-prompt.md,stack-detection.md}` — support files referenced by SKILL.md.
- `skills/init/{SKILL.md,init-context.md}` — `/maestro-init` skill for bootstrapping new projects (project-context.md 14 categories, architecture design, scaffold, roadmap).
- `skills/manual-docs/SKILL.md` — user-docs skill for `manual_docs/` (Diátaxis).
- `plugins/maestro-bootstrap/` — ESM OpenCode plugin.

## Gotchas

- **No git repo here.** `git`, `opencode.json`, `docs/project-context.md`, `regression/`, `.opencode/` all belong to the target application repo, not this one. Git commands fail here — don't run the pipeline steps here. **Exception:** `manual_docs/` *does* live here — it documents the maestro skill itself (user-facing docs for developers of the target app); the target app has its own `manual_docs/` for its own product.
- **`opencode.json` doesn't exist here.** The plugin README says it is registered there; that registration lives in the application repo's `opencode.json`.
- **Agent was renamed `feature-agent` → `maestro` (2026-08-03).** The application repo must be updated in lockstep: `opencode.json` keys `agent.feature-agent` → `agent.maestro` and plugin path `plugins/feature-agent-bootstrap/index.js` → `plugins/maestro-bootstrap/index.js`, `.opencode/` mirrors (`agents/maestro.md`, `skills/maestro/`), and `.gitignore` entry `.feature-agent/` → `.maestro/`.
- **Russian is the working language.** All HITL gates, user messages, agent descriptions, and docs are in Russian. Match it in new content.

## Скиллы / Skills (sync rule)

`skills/` here is the source of truth; OpenCode loads runtime copies from the application repo. When you edit a source file, update the runtime copy too:

- `agents/*.md` → `.opencode/agents/*.md`
- `commands/*.md` → `.opencode/commands/*.md`
- any skill under `skills/` → `.opencode/skills/<name>/SKILL.md` (see `skills/manual-docs/SKILL.md` → Правило 5)
- **Changes to `skills/maestro/SKILL.md`, `commands/*.md` or `agents/*.md` must also be reflected in `manual_docs/`** (user-facing docs for the maestro skill). Keeping `manual_docs/` in sync is part of the acceptance criteria for skill changes — see `manual_docs/how-to/keep-docs-up-to-date.md`.

SKILL.md files are read by the orchestrator agent; `implementer-prompt.md` is self-contained and must stay loadable without the `skill` tool.

## Plugin

Test (Node built-in test runner, no deps):

```bash
node --test plugins/maestro-bootstrap/index.test.js
# or: cd plugins/maestro-bootstrap && npm test
```

- Injects a bootstrap directive with marker `FMAESTRO_BOOTSTRAP_V1` into the first user message of `maestro` sessions via `experimental.chat.messages.transform`; other agents are untouched.
- Logs JSONL to `.maestro/maestro-bootstrap-<date>.log` (one file per day). Env: `MAESTRO_BOOTSTRAP_LOG_LEVEL` (default `debug`), `MAESTRO_BOOTSTRAP_LOG_DIR` (default `<project>/.maestro`).
- All hooks are `try/catch`-guarded and scoped to `maestro` sessions — keep that invariant when modifying.
