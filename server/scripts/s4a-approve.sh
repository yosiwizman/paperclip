#!/usr/bin/env bash
# S4A Bridge — CEO approval through Paperclip.
#
# Usage:
#   bash server/scripts/s4a-approve.sh <workflowId> [caller]
#
# Examples:
#   bash server/scripts/s4a-approve.sh slice-workflow-my-feature ceo
#   bash server/scripts/s4a-approve.sh slice-workflow-my-feature
#
# Requires: S4A_ORCHESTRATOR_BRIDGE=1 and Paperclip running on localhost:3100
#
# This is a thin convenience wrapper around the generic bridge POST.

set -euo pipefail

WF_ID="${1:?Usage: s4a-approve.sh <workflowId> [caller]}"
CALLER="${2:-ceo}"

PAPERCLIP_URL="${PAPERCLIP_URL:-http://localhost:3100}"
BRIDGE_URL="${PAPERCLIP_URL}/api/s4a-orchestrator"
REQ_ID="approve-$(date +%s)-$$"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

exec curl -s -X POST "$BRIDGE_URL" \
  -H 'Content-Type: application/json' \
  -d "{\"version\":\"1\",\"requestId\":\"$REQ_ID\",\"command\":\"approve\",\"payload\":{\"workflowId\":\"$WF_ID\"},\"caller\":\"$CALLER\",\"timestamp\":\"$TS\"}"
