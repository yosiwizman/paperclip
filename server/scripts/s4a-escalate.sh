#!/usr/bin/env bash
# S4A Bridge — escalate a blocked slice from OpenCode to Claude Code.
#
# This is an explicit manual escalation action, not automatic policy enforcement.
# The current orchestrator does not track cross-retry attempt counts, so the
# "2 tries then Claude" policy (DEC-003) must be enforced by the caller.
#
# Effect: retry (BLOCKED → SCOPED) + assignBuilder(claude-code) (SCOPED → BUILDING)
#
# Usage:
#   bash server/scripts/s4a-escalate.sh <workflowId> [caller]
#
# Examples:
#   bash server/scripts/s4a-escalate.sh slice-workflow-my-feature ceo
#   bash server/scripts/s4a-escalate.sh slice-workflow-my-feature
#
# Prerequisites:
#   - Slice must be in BLOCKED state (e.g., after reportTests(fail))
#   - S4A_ORCHESTRATOR_BRIDGE=1 and Paperclip running on localhost:3100

set -euo pipefail

WF_ID="${1:?Usage: s4a-escalate.sh <workflowId> [caller]}"
CALLER="${2:-ceo}"

PAPERCLIP_URL="${PAPERCLIP_URL:-http://localhost:3100}"
BRIDGE_URL="${PAPERCLIP_URL}/api/s4a-orchestrator"

post() {
  local reqId="esc-$(date +%s)-$RANDOM"
  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local cmd="$1" payload="$2" caller="$3"
  curl -s -X POST "$BRIDGE_URL" -H 'Content-Type: application/json' \
    -d "{\"version\":\"1\",\"requestId\":\"$reqId\",\"command\":\"$cmd\",\"payload\":$payload,\"caller\":\"$caller\",\"timestamp\":\"$ts\"}"
}

echo "=== S4A ESCALATION: OpenCode → Claude Code ==="
echo "Workflow: $WF_ID"

# 1. Check current state
echo "--- checking state ---"
STATE=$(post getState "{\"workflowId\":\"$WF_ID\"}" "$CALLER" | jq -r '.data.state')
echo "  Current state: $STATE"

if [ "$STATE" != "BLOCKED" ]; then
  echo "  ERROR: Slice must be in BLOCKED state for escalation. Current: $STATE"
  exit 1
fi

# 2. Retry: BLOCKED → SCOPED
echo "--- retry: BLOCKED → SCOPED ---"
R1=$(post retry "{\"workflowId\":\"$WF_ID\"}" "$CALLER")
S1=$(echo "$R1" | jq -r '.data.state')
echo "  State after retry: $S1"

if [ "$S1" != "SCOPED" ]; then
  echo "  ERROR: Expected SCOPED after retry, got $S1"
  echo "$R1" | jq .
  exit 1
fi

# 3. Assign Claude Code: SCOPED → BUILDING
echo "--- assignBuilder: claude-code ---"
R2=$(post assignBuilder "{\"workflowId\":\"$WF_ID\",\"agentId\":\"claude-code\"}" "$CALLER")
S2=$(echo "$R2" | jq -r '.data.state')
AGENT=$(echo "$R2" | jq -r '.data.agentId')
echo "  State after assign: $S2"
echo "  Builder: $AGENT"

if [ "$S2" = "BUILDING" ] && [ "$AGENT" = "claude-code" ]; then
  echo ""
  echo "=== ESCALATION: PASS — now assigned to claude-code in BUILDING ==="
  exit 0
else
  echo ""
  echo "=== ESCALATION: FAIL ==="
  exit 1
fi
