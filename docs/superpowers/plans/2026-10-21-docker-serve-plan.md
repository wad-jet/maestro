# Dockerized `opencode serve` for maestro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать полностью рабочий Docker-образ для запуска `opencode serve` — изолированный, воспроизводимый runtime с двумя режимами (self-contained + live-mount), security baseline через managed config, healthcheck, docker-compose, документация.

**Architecture:** Многоступенчатый Dockerfile (maestro-base + per-project), entrypoint.sh с автодетектом режима (A/B), managed config layer (/etc/opencode/) с permissions+policies, env-driven конфигурация через `OC_*_MODEL` переменные и `OC_PROVIDERS_JSON`. Всё — из репо maestro, без внешних зависимостей кроме Docker.

**Tech Stack:** Docker (Dockerfile, docker-compose.yml, entrypoint.sh), bash, Node.js (opencode CLI), maestro skills/commands/agents/plugins.

**Spec:** `docs/superpowers/specs/2026-10-20-docker-serve-design.md`

## Global Constraints

- Версия Maestro: 6.5.0 (текущая, minor bump до 6.6.0 при merge)
- Базовый образ: `node:20-slim` (Debian)
- Entrypoint работает от root → chown volumes → `gosu <UID>:<GID>` drop
- Режим A (self-contained): автоклон из REPO_URL + GIT_TOKEN, tmpfs credentials
- Режим B (live-mount): mount существующего дерева, REPO_URL НЕ задавать
- All env vars: `{env:VAR}` in config, never plaintext
- Dockerfile build: MAESTRO_SHA build-arg (required), SUPERPOWERS_SHA env (pinned SHA)
- Permissions baseline: deny for sensitive paths in `/etc/opencode/` (managed layer)
- Policies: deny plugin:* + allow maestro-bootstrap/superpowers; deny mcp:*; deny webfetch/websearch; deny provider:* + allowlist from OC_*_MODEL
- Healthcheck: HTTP /api/info + TCP fallback, password from env (not compose interpolation)
- Port: 127.0.0.1:4096:4096 default (localhost only)
- .confidential/ — gitignored, readonly bind-mount in mode A, in-tree in mode B
- XDG_DATA_HOME=/data, XDG_CACHE_HOME=/cache
- Log retention: 30 days for bootstrap log, 90 days for audit log

## Review Focus

1. **Entrypoint mode detection** — REPO_URL presence → mode A; `.git` in /workspace → mode B. Wrong detection = wrong behavior. Test: entrypoint mode detection logic with edge cases (empty REPO_URL, missing .git).
2. **Config substitution scope** — `{env:}` in committed opencode.json may read process env. Test: verify v2.0.32 binary behavior for {env:} scope.
3. **Provider allowlist enforcement** — `provider.use: deny` must remove provider from catalog before npm.load. Test: verify deny removes from catalog.
4. **Plugin allowlist** — `deny plugin:*` + allowlist must not break core plugins (Console, policy). Test: allowlist doesn't break existing plugins.
5. **Git token hygiene** — GIT_TOKEN must be written to tmpfs credential-store then unset from process env. Test: verify unset happens.

---

## Phase 0: Foundation — docker/ directory and skeleton config files

### Task 1: docker/etc-opencode.json — security baseline (managed layer)

**Files:**
- Create: `docker/etc-opencode.json`
- Modify: `docs/superpowers/specs/2026-10-20-docker-serve-design.md` (update §2.8.1 code snippet to match)

**Interfaces:**
- Consumes: none (new file)
- Produces: `/etc/opencode/opencode.json` in the Docker image — permissions + policies baseline

**Steps:**

- [ ] **Step 1: Read spec §2.8.1 code snippet for the exact permissions+policies structure**

Read the spec at `docs/superpowers/specs/2026-10-20-docker-serve-design.md` sections §2.8.1 (lines ~196–281) — extract the full JSON structure for `/etc/opencode/opencode.json`.

- [ ] **Step 2: Create `docker/etc-opencode.json` with exact permissions + policies**

Create `docker/etc-opencode.json` as a JSON file (not JSONC — Docker COPY doesn't strip comments). The structure must match spec §2.8.1 exactly: permissions array (read/edit/glob/grep deny for confidential, maestro.json, .maestro, .env, *.pem/*.key/*.crt/*.p12/*.pfx) + policies (deny plugin:* + allow maestro-bootstrap and superpowers absolute paths, deny mcp:*, deny provider:* (allowlist generated at runtime), deny webfetch:*/websearch:*).

Important: Use a valid JSON file. The spec shows JSONC with comments — the actual file must be valid JSON (no comments). Comments belong in the spec, not in the delivered config.

- [ ] **Step 3: Verify JSON is valid**

Run: `python3 -c 'import json; json.load(open("docker/etc-opencode.json"))'`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add docker/etc-opencode.json
git commit -m "feat(docker): add security baseline /etc/opencode/opencode.json managed config"
```

### Task 2: docker/user-opencode.json — global skeleton

**Files:**
- Create: `docker/user-opencode.json`
- Modify: `docs/superpowers/specs/2026-10-20-docker-serve-design.md` (add sanitizer to skeleton)

**Interfaces:**
- Consumes: none (new file)
- Produces: `~/.config/opencode/opencode.json` in the Docker image — plugins, agents, worktree config

**Steps:**

- [ ] **Step 1: Read spec §2.8.2 code snippet for the skeleton structure**

Read the spec at `docs/superpowers/specs/2026-10-20-docker-serve-design.md` sections §2.8.2 (lines ~289–345) — extract the full JSON structure for the global skeleton.

- [ ] **Step 2: Create `docker/user-opencode.json`**

Create `docker/user-opencode.json` with the global skeleton from spec: `$schema`, `plugins` array (`/opt/maestro/plugins/maestro-bootstrap/index.js`, `/opt/superpowers`), `update: "disable"`, `default_agent: "build"`, `worktree: { directory: "./.worktrees" }`, `agents` object with:
  - `build`: model `{env:OC_BUILD_MODEL}`, permissions: `maestro_config: ask`
  - `plan`: model `{env:OC_PLAN_MODEL}`, permissions: `maestro_config: ask`
  - `custodian`: model `{env:OC_CUSTODIAN_MODEL}`, permissions (confidential read/glob/grep allow, edit/shell/subagent/maestro_config deny)
  - `sanitizer`: model `{env:OC_SANITIZER_MODEL}`, permissions (confidential read/glob/grep allow, edit/shell/subagent/maestro_config deny) — NOTE: sanitizer was missing from skeleton, now added per review finding (declaimed as actually present, but double-check).
  - `opus`: model `{env:OC_OPUS_MODEL}`
  - `sonnet`: model `{env:OC_SONNET_MODEL}`
  - `haiku`: model `{env:OC_HAIKU_MODEL}`
  - `fable`: model `{env:OC_FABLE_MODEL}`
  - `reviewer`: model `{env:OC_REVIEWER_MODEL}`

- [ ] **Step 3: Verify JSON is valid**

Run: `python3 -c 'import json; json.load(open("docker/user-opencode.json"))'`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add docker/user-opencode.json
git commit -m "feat(docker): add global skeleton ~/.config/opencode/opencode.json"
```

### Task 3: docker/README.md — hello world quick start

**Files:**
- Create: `docker/README.md`

**Interfaces:**
- Consumes: none
- Produces: Quick-start guide for docker/serve

**Steps:**

- [ ] **Step 1: Create `docker/README.md` with 4-step hello world**

Create `docker/README.md` based on spec §5.10 "Hello world (быстрый старт, 5 минут)":
- Step 1: `.env.docker` — one provider for all agents, minimal example
- Step 2: `docker run` command with all required volumes and env-file
- Step 3: TUI connection (`opencode --server`)
- Step 4: First task (`@maestro-init`)

Also include: port parameterization `${PROJECT_PORT}`, healthcheck usage, stop/start/reset commands.

- [ ] **Step 2: Verify content covers all 5 steps**

Check: README has .env.docker example, docker run command, TUI connect, first task, healthcheck, stop/start.

- [ ] **Step 3: Commit**

```bash
git add docker/README.md
git commit -m "docs(docker): add hello world quick start guide"
```

---

## Phase 1: Entrypoint — mode detection, clone, serve

### Task 4: docker/entrypoint.sh — mode detection and initialization

**Files:**
- Create: `docker/entrypoint.sh`

**Interfaces:**
- Consumes: none (new file)
- Produces: `/usr/local/bin/entrypoint.sh` — main orchestrator for mode A/B, clone, credential setup, config injection, provider allowlist, serve launch

**Steps:**

- [ ] **Step 1: Implement mode detection logic**

Create `docker/entrypoint.sh` (#!/bin/bash) with:
- Mode detection: if `$REPO_URL` is set → mode A; else if `.git` exists in `/workspace` → mode B; else error with help message
- Mode A: safe clone flow (see Task 5)
- Mode B: verify workspace has .git, check for .confidential mount (warn if missing)

- [ ] **Step 2: Implement tmpfs credential-store for mode A**

```bash
CRED=/dev/shm/git-credentials
printf 'https://oauth2:%s@%s\n' "$GIT_TOKEN" "$HOST" > "$CRED"
chmod 600 "$CRED"
git config --global credential.helper "store --file $CRED"
```

- [ ] **Step 3: Implement OPENCODE_CONFIG_CONTENT injection**

Parse env vars: `OC_*_MODEL` → `agents.*.model` partial JSON. `OC_PROVIDERS_JSON` → `providers` section. `OPENCODE_DEFAULT_AGENT` → `default_agent`. Inject via `OPENCODE_CONFIG_CONTENT` env var. **Strict contract:** only inject `agents.*.model` + `providers` + `default_agent`. Never inject `permissions`, `policies`, `plugins`, `instructions`.

- [ ] **Step 4: Implement provider allowlist generation**

Parse `OC_*_MODEL` env vars + `OC_PROVIDERS_JSON` → extract provider IDs → write allow entries to `/etc/opencode/opencode.json` (policies section, root-write before drop). Example: if `OC_BUILD_MODEL="akash/..."` → add `{ "action": "provider.use", "resource": "akash", "effect": "allow" }` to policies.

- [ ] **Step 5: Implement log retention (basic)**

Archive old logs → tar.gz in `/maestro/logs/archive/`, cleanup files older than N days (default 30). Audit log retention: 90 days. **Skip current day files.**

- [ ] **Step 6: Implement GIT_TOKEN cleanup**

After credential-store setup: `unset GIT_TOKEN`.

- [ ] **Step 7: Implement `core.hooksPath` disable**

```bash
mkdir -p /var/empty
git config --global core.hooksPath /var/empty
```

- [ ] **Step 8: Implement gosu drop + serve launch**

```bash
gosu "${UID:-1000}:${GID:-1000}" opencode serve
```

- [ ] **Step 9: Verify script is valid bash**

Run: `bash -n docker/entrypoint.sh`
Expected: No errors.

- [ ] **Step 10: Commit**

```bash
git add docker/entrypoint.sh
git commit -m "feat(docker): add main entrypoint.sh with mode detection, config injection, provider allowlist"
```

### Task 5: docker/entrypoint.sh — mode A safe clone (temp-clone + rsync)

**Files:**
- Modify: `docker/entrypoint.sh`

**Interfaces:**
- Consumes: Task 4 base entrypoint
- Produces: Mode A clone logic with temp-clone + rsync pattern

**Steps:**

- [ ] **Step 1: Add mode A clone logic to entrypoint.sh**

After credential setup, mode A clone:
1. `GIT_TERMINAL_PROMPT=0 git clone "$REPO_URL" /tmp/clone`
2. Determine repo name from URL (strip `.git`, last path component)
3. `rsync -a /tmp/clone/ /workspace/<repo>/`
4. `rm -rf /tmp/clone`

**Why full clone (not shallow):** `--depth=1` breaks ancestry features: merge-guard P9 (`git merge-base --is-ancestor`), branch-aware memory v3 (`is-ancestor(head, mainline)`), `memory_reindex` git-history.

- [ ] **Step 2: Add existing workspace update fallback**

If `/workspace/<repo>` already exists (previous run):
```bash
GIT_TERMINAL_PROMPT=0 git -C /workspace/<repo> fetch --all --prune
git -C /workspace/<repo> checkout -B main origin/main  # or GIT_BRANCH
git -C /workspace/<repo> clean -fd -e .confidential -e .opencode
```

- [ ] **Step 3: Add `-e .opencode` to git clean**

Defense-in-depth for bind-mounted `.opencode/` from host (mode A custom provider scenario).

- [ ] **Step 4: Verify syntax**

Run: `bash -n docker/entrypoint.sh`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add docker/entrypoint.sh
git commit -m "feat(docker): add mode A safe clone (temp-clone + rsync, workspace update fallback)"
```

### Task 6: docker/healthcheck.sh — HTTP + TCP health check

**Files:**
- Create: `docker/healthcheck.sh`

**Interfaces:**
- Consumes: none
- Produces: `/usr/local/bin/healthcheck.sh` — validates opencode server is running

**Steps:**

- [ ] **Step 1: Create healthcheck script**

```bash
#!/bin/sh
# Primary: HTTP check on /api/info
if curl -sf -u "opencode:${OPENCODE_PASSWORD}" http://127.0.0.1:4096/api/info >/dev/null 2>&1; then
  exit 0
fi
# Fallback: TCP connect
exec 3<>/dev/tcp/127.0.0.1/4096 2>/dev/null
exit $?
```

Note: `${OPENCODE_PASSWORD}` may have shell metacharacters in edge cases, but in practice the password comes from controlled `.env.docker` without metacharacters.

- [ ] **Step 2: Verify script**

Run: `bash -n docker/healthcheck.sh`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add docker/healthcheck.sh
git commit -m "feat(docker): add healthcheck.sh with HTTP + TCP fallback"
```

---

## Phase 2: Dockerfile — multi-stage build

### Task 7: Dockerfile stage 1 — maestro-base

**Files:**
- Create: `docker/Dockerfile` (Stage 1: maestro-base)

**Interfaces:**
- Consumes: Tasks 1-2 (config files), Task 6 (healthcheck)
- Produces: `maestro-base` image with opencode CLI, maestro skill files, superpowers, configs

**Steps:**

- [ ] **Step 1: Create Stage 1 of Dockerfile**

Create `docker/Dockerfile` with Stage 1 (`maestro-base`):
```dockerfile
FROM node:20-slim AS maestro-base
LABEL maintainer="maestro <maintainer@example.com>"

# Install dependencies for entrypoint
RUN apt-get update && apt-get install -y --no-install-recommends \
      git rsync gosu curl jq \
    && rm -rf /var/lib/apt/lists/*

# Install opencode CLI (pin version — matches v2.0.32 baseline from spec)
RUN npm install -g opencode@<pin-version>

# Copy maestro skill files (wholesale)
COPY maestro-install.sh /opt/maestro/maestro-install.sh
COPY skills/ /opt/maestro/skills/
COPY commands/ /opt/maestro/commands/
COPY agents/ /opt/maestro/agents/
COPY plugins/maestro-bootstrap/ /opt/maestro/plugins/maestro-bootstrap/

# Deploy maestro (requires MAESTRO_SHA build-arg)
ARG MAESTRO_SHA
RUN /bin/bash -c 'if [ -z "$MAESTRO_SHA" ]; then echo "ERROR: MAESTRO_SHA build-arg required"; exit 1; fi && cd /opt/maestro && bash maestro-install.sh --deploy --pin "$MAESTRO_SHA" --no-halt --skip-config 2>/dev/null || true'

# Clone superpowers plugin (pinned commit)
ENV SUPERPOWERS_SHA=<pinned-sha>
RUN git clone --depth 1 --no-single-branch "https://github.com/obra/superpowers.git#/opt/superpowers" && cd /opt/superpowers && git checkout $SUPERPOWERS_SHA

# Copy entrypoint and healthcheck
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY docker/healthcheck.sh /usr/local/bin/healthcheck.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/healthcheck.sh

# Copy managed config (security baseline, highest file precedence)
COPY docker/etc-opencode.json /etc/opencode/opencode.json

# Copy global skeleton
COPY docker/user-opencode.json ~/.config/opencode/opencode.json

# Create non-root user (but NOT set USER here — entrypoint runs as root for chown)
RUN adduser --disabled-password --gecos '' --uid 1000 opencode \
    && mkdir -p /workspace /data /cache /maestro \
    && chown -R opencode:opencode /workspace /data /cache /maestro

WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
```

**Key decisions:**
- `USER opencode` NOT set in Dockerfile — entrypoint must run as root for chown
- `SUPERPOWERS_SHA` env var set to `<pinned-sha>` placeholder (to be filled with actual SHA: `git ls-remote https://github.com/obra/superpowers.git HEAD | awk '{print $1}'`)
- `MAESTRO_SHA` build-arg required (not optional)
- `opencode@<pin-version>` — pin to v2.0.32 (or latest known-compatible version)
- `autoupdate: false` → `update: "disable"` (v2 format)
- `experimental.subagent_depth` → `subagent_depth` (v2 key)

- [ ] **Step 2: Create Stage 2 (optional per-project image)**

```dockerfile
FROM maestro-base:6.x AS myapp
# Per-project: opencode.json, instructions, etc.
# COPY opencode.json /workspace/opencode.json
```

- [ ] **Step 3: Verify Dockerfile syntax**

Run: `docker build -f docker/Dockerfile --check docker/ 2>&1 | head -20`
(or skip if docker not available — validate manually)

- [ ] **Step 4: Commit**

```bash
git add docker/Dockerfile
git commit -m "feat(docker): add multi-stage Dockerfile (maestro-base stage)"
```

### Task 8: docker-compose.yml — production-ready configuration

**Files:**
- Create: `docker-compose.yml`

**Interfaces:**
- Consumes: none (new file)
- Produces: Production docker-compose with volumes, ports, healthcheck, restart policy

**Steps:**

- [ ] **Step 1: Create docker-compose.yml based on spec §5.5**

```yaml
services:
  opencode:
    image: maestro-opencode:6.x
    env_file: .env.docker
    volumes:
      - oc-ws:/workspace
      - oc-data:/data
      - oc-cache:/cache
      - ${MAESTRO_STATE_DIR:-${HOME}/maestro-state}/${PROJECT_NAME}:/maestro
      - ${MAESTRO_CONF_DIR:-${HOME}/maestro-confidential}/${PROJECT_NAME}:/workspace/${REPO_NAME}/.confidential:ro
    ports:
      - "${PROJECT_PORT:-127.0.0.1:4096}:4096"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "/usr/local/bin/healthcheck.sh"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 120s

volumes:
  oc-ws:
    name: oc-ws-${PROJECT_NAME}
  oc-data:
    name: oc-data-${PROJECT_NAME}
  oc-cache:
    name: oc-cache-${PROJECT_NAME}
```

**Key decisions:**
- `start_period: 120s` — full clone can take minutes on large repos
- `${HOME}` used (not `~`) — Docker Compose doesn't expand `~`
- `env_file` not `environment:` — prevent empty string interpolation
- Port: `127.0.0.1:4096:4096` (localhost only) — parameterized via `${PROJECT_PORT}`
- Confidential: read-only bind-mount, `${MAESTRO_CONF_DIR}` default to `${HOME}/maestro-confidential`

- [ ] **Step 2: Verify YAML syntax**

Run: `python3 -c 'import yaml; yaml.safe_load(open("docker-compose.yml"))'`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(docker): add docker-compose.yml with volumes, healthcheck, restart policy"
```

---

## Phase 3: Plugin integration

### Task 9: Plugin — `confidential.tracked_in_git` check

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js` (or relevant bootstrap init file)

**Interfaces:**
- Consumes: none
- Produces: Bootstrap check that warns if `.confidential/` is tracked in git

**Steps:**

- [ ] **Step 1: Add git tracked check to bootstrap init**

In `plugins/maestro-bootstrap/core.js` bootstrap initialization:
```javascript
// Check if .confidential/ is tracked in git
const { execSync } = require('child_process');
try {
  const result = execSync('git ls-files .confidential/ 2>/dev/null || true', { encoding: 'utf-8' });
  if (result.trim()) {
    console.warn('confidential.tracked_in_git: .confidential/ appears to be tracked in git. This is a security risk — confidential data should NOT be in git. Fix: git rm -r --cached .confidential/ && git commit -m "remove .confidential from git tracking" && echo ".confidential/" >> .gitignore');
  }
} catch (e) {
  // git command failed — not a git repo, ignore
}
```

- [ ] **Step 2: Write unit test**

Create: `plugins/maestro-bootstrap/tests/confidential-git-check.test.mjs`

Test cases:
1. `.confidential/` NOT tracked → no warning
2. `.confidential/` IS tracked → warning message with fix instructions
3. Not a git repo → no error

- [ ] **Step 3: Run tests**

Run: `node --test plugins/maestro-bootstrap/tests/confidential-git-check.test.mjs`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/tests/confidential-git-check.test.mjs
git commit -m "feat(plugin): add confidential.tracked_in_git check at bootstrap init"
```

---

## Phase 4: maestro-setup integration

### Task 10: maestro-setup — dual default confidential.paths + .gitignore

**Files:**
- Modify: `skills/maestro-setup/` (relevent setup files — the actual implementation files depend on maestro-setup structure)

**Interfaces:**
- Consumes: none
- Produces: Updated `/maestro-setup` that writes dual default `confidential.paths` and adds `.confidential/` to `.gitignore`

**Steps:**

- [ ] **Step 1: Update `/maestro-setup` default for `confidential.paths`**

Change from single default `docs/confidential/**` to dual default:
- `docs/confidential/**`
- `.confidential/**`

This affects the `/maestro-setup` skill's config generation logic.

- [ ] **Step 2: Add `.confidential/` to `.gitignore`**

If `.gitignore` exists → add `.confidential/` line (if not already present).
If `.gitignore` doesn't exist → create with `.confidential/` line.

Note: Do NOT add `docs/confidential/` to `.gitignore` — that's the canonical git-tracked path.

- [ ] **Step 3: Verify changes**

Check that setup produces correct defaults:
- `confidential.paths` contains both `docs/confidential/**` and `.confidential/**`
- `.gitignore` contains `.confidential/`

- [ ] **Step 4: Commit**

```bash
git add skills/maestro-setup/
git commit -m "feat(maestro-setup): dual default confidential.paths + .gitignore for .confidential/"
```

---

## Phase 5: Documentation

### Task 11: manual_docs/how-to/docker-serve.md — comprehensive how-to

**Files:**
- Create: `manual_docs/how-to/docker-serve.md`

**Interfaces:**
- Consumes: spec §5 (How to sections), §5.5-5.14
- Produces: Extended how-to guide for Mac/Linux/VM

**Steps:**

- [ ] **Step 1: Create docker-serve.md**

Create `manual_docs/how-to/docker-serve.md` expanding spec §5 into a complete how-to:
- Prerequisites (Docker ≥ 24, token requirements, model env vars, API keys, password, host directories)
- Environment file creation (`.env.docker`)
- Mode A: self-contained (full docker run command with all volumes)
- Mode B: live-mount
- docker-compose usage
- TUI/Web/API connection
- Health check
- Stop/start/reset
- Backup/restore (cold + hot)
- Version update process
- Hardening options (--cap-drop, --security-opt, port binding)
- Debugging guide (logs, healthcheck, common issues)
- Scenarios ladder (0: hello world → 1: bugfix → 2: mixed providers → 3: custom provider → 4: confidential → 5: MCP → 6: parallel dev)

- [ ] **Step 2: Verify cross-references**

Check: all spec section references (§2.x, §5.x) resolve correctly.

- [ ] **Step 3: Commit**

```bash
git add manual_docs/how-to/docker-serve.md
git commit -m "docs: add docker-serve comprehensive how-to guide"
```

### Task 12: manual_docs — docker-mcp.md + residuals + config/memory updates

**Files:**
- Create: `manual_docs/how-to/docker-mcp.md`
- Create: `manual_docs/explanation/docker-residuals.md` (or add to existing)
- Modify: `manual_docs/reference/config.md`
- Modify: `manual_docs/reference/memory.md`

**Interfaces:**
- Consumes: spec §2.15 (operator customization), §3 (residuals), §2.11 (memory)
- Produces: MCP how-to, residuals doc, updated config/memory refs

**Steps:**

- [ ] **Step 1: Create docker-mcp.md**

How-to for connecting MCP servers in Docker:
- When MCP is needed/not needed (maestro pipeline doesn't require MCP)
- Declaration + allow in managed layer
- Name-hijack protection (same-name server override in /etc/opencode/)
- HTTP/SSE vs stdio (stdio runs as process in container — same class as plugin)
- Debug checklist

- [ ] **Step 2: Create docker-residuals.md**

Document docker-serve specific residuals:
- Config substitution scope and operator requirements
- Bash-env-access and PAT requirements
- Container-sandbox principle
- `docker exec opencode run` bypasses serve-only contract

- [ ] **Step 3: Update config.md and memory.md**

Update references:
- config.md: new env vars (`OC_*_MODEL`, `OC_PROVIDERS_JSON`, `OPENCODE_CONFIG_CONTENT`, `OPENCODE_DEFAULT_AGENT`, `OPENCODE_PASSWORD`)
- memory.md: memory MVP deferred, `memory.backup.path: "/maestro/memory/backup"`, note about `memory.data_dir`/`memory.cache_dir` being fictitious keys (future)

- [ ] **Step 4: Commit**

```bash
git add manual_docs/how-to/docker-mcp.md manual_docs/explanation/docker-residuals.md manual_docs/reference/config.md manual_docs/reference/memory.md
git commit -m "docs: add docker-mcp how-to, residuals doc, update config/memory references"
```

---

## Phase 6: Tests and verification

### Task 13: Tests — plugin verification + docker smoke

**Files:**
- Create: `plugins/maestro-bootstrap/tests/docker-verification.test.mjs`
- Create: `plugins/maestro-bootstrap/tests/entrypoint-verify.test.mjs`
- Modify: `maestro-sandbox.sh` (add `--docker` mode)

**Interfaces:**
- Consumes: Tasks 4, 6 (entrypoint, healthcheck)
- Produces: Verification tests for plugin and docker artifacts

**Steps:**

- [ ] **Step 1: Plugin verification tests**

Create `plugins/maestro-bootstrap/tests/docker-verification.test.mjs`:
- (a) `plugin:<path>` matching for absolute paths (allowlist doesn't break existing plugins)
- (b) Core plugins (Console, policy) not broken by `deny plugin:*`
- (c) `OPENCODE_CONFIG_CONTENT` anti-redirect: repo config cannot redirect `agents.*.model`

- [ ] **Step 2: Entrypoint verification**

Create `plugins/maestro-bootstrap/tests/entrypoint-verify.test.mjs`:
- (a) `XDG_CONFIG_HOME` respected by opencode server on Linux
- (b) `plugin:<absolute path>` matching in policy deny
- (c) Seed logic: config-volume empty on first run → entrypoint copies baked skeleton
- (d) `git clean -fd -e .opencode` doesn't delete mount point

- [ ] **Step 3: Add `--docker` mode to maestro-sandbox.sh**

Add smoke test mode for docker:
- Validate Dockerfile syntax
- Validate docker-compose.yml
- Validate entrypoint.sh syntax
- Validate etc-opencode.json and user-opencode.json are valid JSON
- Validate all COPY paths exist in repo

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: All existing tests pass + new docker verification tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/tests/docker-verification.test.mjs \
       plugins/maestro-bootstrap/tests/entrypoint-verify.test.mjs \
       maestro-sandbox.sh
git commit -m "test(docker): add verification tests for plugin, entrypoint, docker-compose"
```

---

## Implementation summary

**Total tasks: 13** (consolidated from 31 spec tasks — many spec tasks are documentation/config that map to single implementation tasks)

**Phase order:**
1. **Phase 0 (Tasks 1-3):** docker/ directory + config files — foundation, no dependencies
2. **Phase 1 (Tasks 4-5):** Entrypoint — core orchestration logic, depends on Phase 0 configs
3. **Phase 2 (Task 7):** Dockerfile — depends on Phase 0+1 artifacts
4. **Phase 2.5 (Task 8):** docker-compose — depends on Dockerfile
5. **Phase 3 (Task 9):** Plugin integration — independent, can run parallel to Phases 1-2
6. **Phase 4 (Task 10):** maestro-setup — independent
7. **Phase 5 (Tasks 11-12):** Documentation — can run parallel to all implementation
8. **Phase 6 (Task 13):** Tests — depends on implementation

**Priority mapping:**
- P0 (MVP): Tasks 1-5, 7, 8, 9, 10 — everything needed for a working docker-serve runtime
- P1 (Hardening): Task 13 (tests) — required for PR merge quality
- P2 (Docs): Tasks 11-12 — required for user-facing documentation

**Parallel execution:** Tasks 1-3 → Phase 1-2 can run parallel. Plugin (Task 9) and maestro-setup (Task 10) are fully independent. Docs (Tasks 11-12) can be done anytime after spec is stable.
