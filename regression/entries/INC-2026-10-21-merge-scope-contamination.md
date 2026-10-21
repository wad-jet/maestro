---
id: INC-2026-10-21-merge-scope-contamination
date: 2026-10-21
severity: medium
category: process
status: resolved
resolved_by: feature/pipeline-isolation-hardening
---
# Merge-scope contamination (2026-10-21)

**Суть:** merge в mainline протащил 3 чужих docker-serve коммита через
ошибочное ветвление от feature-ветки.

**Impact:** 1126 строк спеки в main (docker-serve v17 design) без своего гейта 17.

**Timeline:**
- 09:47 — merge guard approved (gate 17)
- 09:48 — merge fast-forward 906aadd→3b80b9e (4 коммита вместо 1)
- 11:00 — обнаружение через `git log main`

**Root cause:**
1. Workspace занят чужой фичей (feature/docker-serve-design), не детектируется
2. Ветка создана от feature HEAD, а не mainline
3. Merge-guard проверяет только наличие маркера, не содержимое merge

**Mitigation:** pipeline-isolation-hardening — branch-base guard,
head-pin marker, merge-scope review gate 17.
