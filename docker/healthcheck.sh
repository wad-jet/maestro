#!/bin/bash
# Primary: HTTP check on /api/info
if curl -sf -u "opencode:${OPENCODE_PASSWORD}" http://127.0.0.1:4096/api/info >/dev/null 2>&1; then
  exit 0
fi
# Fallback: TCP connect (bash-specific /dev/tcp — requires bash, not sh/dash)
exec 3<>/dev/tcp/127.0.0.1/4096 2>/dev/null
exit $?
