# AGENTS.md

## What this repo is

This is the **authoring repo** for the OpenCode `maestro` system (the "maestro" skill that orchestrates feature/bugfix implementation in a target application). It is **not** the application repo — there is no application code here.

- `skills/maestro/SKILL.md` — authoritative pipeline spec (feature/bugfix orchestration, HITL gates, regression registry). Read it before touching anything in `skills/`.
- `agents/*.md` — OpenCode agent configs (`mode`, `permission`, `hidden`, `description` in YAML frontmatter). All are subagents (`design`, `haiku`, `sonnet`, `opus`, `fable`, `code-reviewer`, `sanitizer`). `design` and `sanitizer` are trusted by default (spec formation, security review). There is **no primary `maestro` agent** — entry is via the `@maestro` command (skill).
- `commands/*.md` — `@command` configs (frontmatter `agent:` field; `@maestro` is the entry point).
- `skills/maestro/{design-prompt.md,implementer-prompt.md,spec-review-prompt.md,stack-detection.md}` — support files referenced by SKILL.md.
- `skills/maestro-init/{SKILL.md,init-context.md}` — `/maestro-init` skill for bootstrapping new projects (project-context.md 14 categories, architecture design, scaffold, roadmap).
- `skills/maestro-design/SKILL.md` — `/maestro-design` skill for design + spec (via `design` agent), code scaffold (TDD), and roadmap.
- `skills/maestro-assistant/SKILL.md` — `/maestro-assistant` skill: consultation & config/structure/context organization for maestro (single source of config rules). Self-contained; loaded by init (tasks 2/3/3a) and maestro (pipeline config questions).
- `skills/manual-docs/SKILL.md` — user-docs skill for `manual_docs/` (Diátaxis).
- `plugins/maestro-bootstrap/` — ESM OpenCode plugin.
- `specs/*.md` — design specs and implementation plans for work on this repo (kebab-case: `<topic>.md` for spec, `<topic>-plan.md` for plan). **Rule: all feature/bugfix design docs (specs AND plans) must be created in `specs/`, never in the repo root.**
- `SECURITY.md` — **internal security (ИБ) standard** for the maestro skill (trust model, ИБ requirements P1–P5, invariants, testing). Not part of `manual_docs/`. It is the source of truth for security decisions; specs/plans reference it.

## Gotchas

- **This IS a git repo** (authoring). `opencode.json`, `docs/project-context.md`, `regression/`, `.opencode/` belong to the target application repo, not this one. Don't run the maestro pipeline steps (`/maestro-init`, `/maestro-design`, `@maestro`) here — they target the app repo. **Exception:** `manual_docs/` *does* live here — it documents the maestro skill itself (user-facing docs for developers of the target app); the target app has its own `manual_docs/` for its own product.
- **`opencode.json` doesn't exist here.** The plugin README says it is registered there; that registration lives in the application repo's `opencode.json`.
- **Agent was renamed `feature-agent` → `maestro` (2026-08-03).** The application repo must be updated in lockstep: `opencode.json` keys `agent.feature-agent` → `agent.maestro` and plugin path `plugins/feature-agent-bootstrap/index.js` → `plugins/maestro-bootstrap/index.js`, `.opencode/` mirrors (`agents/maestro.md`, `skills/maestro/`), and `.gitignore` entry `.feature-agent/` → **specific paths** (`.maestro/sdd/`, `.maestro/last-run.md`, `.maestro/logs/maestro-bootstrap-*.log` — НЕ весь `.maestro/`, см. `skills/maestro/SKILL.md`).
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

- Global observability (not bound to any agent): logs key events for all sessions — `session.error`, `task` dispatch (`tool.execute.before`/`tool.execute.after`, sanitized title), empty subagent result, access-policy blocks. Sanitizes `task` prompts (Level 1 Security Review) before untrusted subagents. The old bootstrap-directive injection via `experimental.chat.messages.transform` was removed — `transform` must stay `undefined`.
- Logs JSONL to `.maestro/logs/maestro-bootstrap-<date>.log` (one file per day). Env: `MAESTRO_BOOTSTRAP_LOG_LEVEL` (default `info`), `MAESTRO_BOOTSTRAP_LOG_DIR` (default `<project>/.maestro/logs`).
- All hooks are `try/catch`-guarded and global (not scoped to `maestro` sessions) — keep that invariant when modifying.
