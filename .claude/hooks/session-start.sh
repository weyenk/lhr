#!/bin/bash
set -euo pipefail

# Only needed in Claude Code on the web / cloud agent sessions — plugin
# installs there are per-container and don't persist between sessions.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

claude plugin marketplace add anthropics/claude-plugins-official
claude plugin install superpowers@claude-plugins-official
