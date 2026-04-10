#!/usr/bin/env bash
# S4A Bridge — retry a blocked slice through Paperclip.
#
# Usage:
#   bash server/scripts/s4a-retry.sh <workflowId> [caller]
#
# Examples:
#   bash server/scripts/s4a-retry.sh slice-workflow-my-feature ceo
#   bash server/scripts/s4a-retry.sh slice-workflow-my-feature
#
# Effect: BLOCKED → SCOPED (retryCount reset, builder cleared, tests cleared)
# The slice can then be re-assigned and rebuilt.
#
# Requires: S4A_ORCHESTRATOR_BRIDGE=1 and Paperclip running on localhost:3100

set -euo pipefail

WF_ID="${1:?Usage: s4a-retry.sh <workflowId> [caller]}"
CALLER="${2:-ceo}"

PAPERCLIP_URL="${PAPERCLIP_URL:-http://localhost:3100}"
BRIDGE_URL="${PAPERCLIP_URL}/api/s4a-orchestrator"
REQ_ID="retry-$(date +%s)-$$"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

exec curl -s -X POST "$BRIDGE_URL" \
  -H 'Content-Type: application/json' \
  -d "{\"version\":\"1\",\"requestId\":\"$REQ_ID\",\"command\":\"retry\",\"payload\":{\"workflowId\":\"$WF_ID\"},\"caller\":\"$CALLER\",\"timestamp\":\"$TS\"}"
