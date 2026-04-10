#!/usr/bin/env bash
# S4A Bridge — policy-aware builder routing after BLOCKED failure.
#
# Implements the approved escalation policy (DEC-003, DELIVERY_PIPELINE.md):
#   - OpenCode tries first (up to 2 build failures)
#   - After 2 failures, escalate to Claude Code
#
# Uses the orchestrator's getStatus query (Phase 18) to read buildFailCount
# and make a safe, data-driven routing decision.
#
# Usage:
#   bash server/scripts/s4a-policy-route.sh <workflowId> [caller]
#
# Prerequisites:
#   - Slice must be in BLOCKED state
#   - S4A_ORCHESTRATOR_BRIDGE=1 and Paperclip running
#   - Temporal + orchestrator worker running
#
# Policy:
#   buildFailCount < 2 → retry + assign opencode (try again)
#   buildFailCount >= 2 → retry + assign claude-code (escalate)

set -euo pipefail

WF_ID="${1:?Usage: s4a-policy-route.sh <workflowId> [caller]}"
CALLER="${2:-ceo}"
MAX_OPENCODE_FAILURES=2

PAPERCLIP_URL="${PAPERCLIP_URL:-http://localhost:3100}"
BRIDGE_URL="${PAPERCLIP_URL}/api/s4a-orchestrator"

post() {
  local reqId="pol-$(date +%s)-$RANDOM"
  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local cmd="$1" payload="$2" caller="$3"
  curl -s -X POST "$BRIDGE_URL" -H 'Content-Type: application/json' \
    -d "{\"version\":\"1\",\"requestId\":\"$reqId\",\"command\":\"$cmd\",\"payload\":$payload,\"caller\":\"$caller\",\"timestamp\":\"$ts\"}"
}

echo "=== S4A POLICY ROUTING ==="
echo "Workflow: $WF_ID"
echo "Policy: OpenCode for first $MAX_OPENCODE_FAILURES failures, then Claude Code"

# 1. Get status — check state + buildFailCount
echo "--- getStatus ---"
STATUS=$(post getStatus "{\"workflowId\":\"$WF_ID\"}" "$CALLER")
STATE=$(echo "$STATUS" | jq -r '.data.state')
FAIL_COUNT=$(echo "$STATUS" | jq -r '.data.buildFailCount')

echo "  State: $STATE"
echo "  Build fail count: $FAIL_COUNT"

if [ "$STATE" != "BLOCKED" ]; then
  echo "  ERROR: Slice must be in BLOCKED state. Current: $STATE"
  exit 1
fi

# 2. Apply policy
if [ "$FAIL_COUNT" -lt "$MAX_OPENCODE_FAILURES" ]; then
  BUILDER="opencode"
  echo "  Decision: retry with OpenCode (fail $FAIL_COUNT < $MAX_OPENCODE_FAILURES)"
else
  BUILDER="claude-code"
  echo "  Decision: escalate to Claude Code (fail $FAIL_COUNT >= $MAX_OPENCODE_FAILURES)"
fi

# 3. Retry: BLOCKED → SCOPED
echo "--- retry ---"
R1=$(post retry "{\"workflowId\":\"$WF_ID\"}" "$CALLER")
S1=$(echo "$R1" | jq -r '.data.state')
echo "  State after retry: $S1"

if [ "$S1" != "SCOPED" ]; then
  echo "  ERROR: Expected SCOPED, got $S1"
  exit 1
fi

# 4. Assign chosen builder: SCOPED → BUILDING
echo "--- assignBuilder: $BUILDER ---"
R2=$(post assignBuilder "{\"workflowId\":\"$WF_ID\",\"agentId\":\"$BUILDER\"}" "$CALLER")
S2=$(echo "$R2" | jq -r '.data.state')
AGENT=$(echo "$R2" | jq -r '.data.agentId')
echo "  State after assign: $S2"
echo "  Builder: $AGENT"

if [ "$S2" = "BUILDING" ] && [ "$AGENT" = "$BUILDER" ]; then
  echo ""
  echo "=== POLICY ROUTING: PASS — assigned to $BUILDER (buildFailCount=$FAIL_COUNT) ==="
  # Output machine-friendly result
  echo "{\"ok\":true,\"builder\":\"$BUILDER\",\"buildFailCount\":$FAIL_COUNT,\"state\":\"$S2\",\"policy\":\"$([ "$BUILDER" = "opencode" ] && echo "retry" || echo "escalate")\"}"
  exit 0
else
  echo ""
  echo "=== POLICY ROUTING: FAIL ==="
  exit 1
fi
