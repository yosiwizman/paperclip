#!/usr/bin/env bash
# S4A Bridge — builder agent reports test results through Paperclip.
#
# Usage:
#   bash server/scripts/s4a-report-tests.sh <workflowId> pass|fail [caller]
#
# Examples:
#   bash server/scripts/s4a-report-tests.sh slice-workflow-my-feature pass opencode
#   bash server/scripts/s4a-report-tests.sh slice-workflow-my-feature fail claude-code
#
# Requires: S4A_ORCHESTRATOR_BRIDGE=1 and Paperclip running on localhost:3100
#
# This is a thin convenience wrapper around the generic bridge POST.
# The exact same result can be achieved by POSTing a reportTests envelope directly.

set -euo pipefail

WF_ID="${1:?Usage: s4a-report-tests.sh <workflowId> pass|fail [caller]}"
RESULT="${2:?Usage: s4a-report-tests.sh <workflowId> pass|fail [caller]}"
CALLER="${3:-opencode}"

PAPERCLIP_URL="${PAPERCLIP_URL:-http://localhost:3100}"
BRIDGE_URL="${PAPERCLIP_URL}/api/s4a-orchestrator"
REQ_ID="report-$(date +%s)-$$"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [ "$RESULT" = "pass" ]; then PASS="true"; else PASS="false"; fi

exec curl -s -X POST "$BRIDGE_URL" \
  -H 'Content-Type: application/json' \
  -d "{\"version\":\"1\",\"requestId\":\"$REQ_ID\",\"command\":\"reportTests\",\"payload\":{\"workflowId\":\"$WF_ID\",\"pass\":$PASS,\"commit\":true},\"caller\":\"$CALLER\",\"timestamp\":\"$TS\"}"
