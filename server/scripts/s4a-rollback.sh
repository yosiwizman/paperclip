#!/usr/bin/env bash
# S4A Bridge — rollback a slice through Paperclip.
#
# Usage:
#   bash server/scripts/s4a-rollback.sh <workflowId> [caller]
#
# Effect: ANY non-terminal state (except DRAFT) → ROLLED_BACK (terminal)
# Supported source states: SCOPED, BUILDING, REVIEWING, VERIFYING,
#   AWAITING_APPROVAL, APPROVED, BLOCKED, RETRY_PENDING, FAILED
# NOT supported from: DRAFT, DEPLOYED, ROLLED_BACK
#
# After rollback, the workflow is terminal — no further commands are accepted.
#
# Requires: S4A_ORCHESTRATOR_BRIDGE=1 and Paperclip running on localhost:3100

set -euo pipefail

WF_ID="${1:?Usage: s4a-rollback.sh <workflowId> [caller]}"
CALLER="${2:-ceo}"

PAPERCLIP_URL="${PAPERCLIP_URL:-http://localhost:3100}"
BRIDGE_URL="${PAPERCLIP_URL}/api/s4a-orchestrator"
REQ_ID="rollback-$(date +%s)-$$"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

exec curl -s -X POST "$BRIDGE_URL" \
  -H 'Content-Type: application/json' \
  -d "{\"version\":\"1\",\"requestId\":\"$REQ_ID\",\"command\":\"rollback\",\"payload\":{\"workflowId\":\"$WF_ID\"},\"caller\":\"$CALLER\",\"timestamp\":\"$TS\"}"
