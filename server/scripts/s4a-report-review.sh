#!/usr/bin/env bash
# S4A Bridge — reviewer agent reports review result through Paperclip.
#
# Usage:
#   bash server/scripts/s4a-report-review.sh <workflowId> approve|reject [caller]
#
# Examples:
#   bash server/scripts/s4a-report-review.sh slice-workflow-my-feature approve codex
#   bash server/scripts/s4a-report-review.sh slice-workflow-my-feature reject codex
#
# Requires: S4A_ORCHESTRATOR_BRIDGE=1 and Paperclip running on localhost:3100
#
# This is a thin convenience wrapper around the generic bridge POST.

set -euo pipefail

WF_ID="${1:?Usage: s4a-report-review.sh <workflowId> approve|reject [caller]}"
RESULT="${2:?Usage: s4a-report-review.sh <workflowId> approve|reject [caller]}"
CALLER="${3:-codex}"

PAPERCLIP_URL="${PAPERCLIP_URL:-http://localhost:3100}"
BRIDGE_URL="${PAPERCLIP_URL}/api/s4a-orchestrator"
REQ_ID="review-$(date +%s)-$$"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [ "$RESULT" = "approve" ]; then APPROVED="true"; else APPROVED="false"; fi

exec curl -s -X POST "$BRIDGE_URL" \
  -H 'Content-Type: application/json' \
  -d "{\"version\":\"1\",\"requestId\":\"$REQ_ID\",\"command\":\"reportReview\",\"payload\":{\"workflowId\":\"$WF_ID\",\"approved\":$APPROVED},\"caller\":\"$CALLER\",\"timestamp\":\"$TS\"}"
