#!/usr/bin/env bash
# S4A Bridge — end-to-end happy-path lifecycle through Paperclip.
#
# Runs the complete slice lifecycle in one command:
#   createSlice → assignBuilder → reportTests(pass) → reportReview(approve)
#   → approve → deploy → DEPLOYED
#
# Usage:
#   bash server/scripts/s4a-happy-path.sh [description] [sliceId]
#
# Examples:
#   bash server/scripts/s4a-happy-path.sh "Build login page"
#   bash server/scripts/s4a-happy-path.sh "Fix bug #42" my-bugfix
#
# Requires:
#   - S4A_ORCHESTRATOR_BRIDGE=1 and Paperclip running on localhost:3100
#   - Temporal dev server + orchestrator worker running

set -euo pipefail

DESCRIPTION="${1:-Happy path end-to-end proof}"
SLICE_ID="${2:-happy-$(date +%s)}"
PAPERCLIP_URL="${PAPERCLIP_URL:-http://localhost:3100}"
BRIDGE_URL="${PAPERCLIP_URL}/api/s4a-orchestrator"

PASS=0
FAIL=0
ok() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

post() {
  local reqId="hp-$(date +%s)-$RANDOM"
  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local cmd="$1" payload="$2" caller="${3:-paperclip}"
  curl -s -X POST "$BRIDGE_URL" -H 'Content-Type: application/json' \
    -d "{\"version\":\"1\",\"requestId\":\"$reqId\",\"command\":\"$cmd\",\"payload\":$payload,\"caller\":\"$caller\",\"timestamp\":\"$ts\"}"
}

echo "=== S4A HAPPY PATH: $DESCRIPTION ==="
echo "Slice ID: $SLICE_ID"
echo ""

# 1. createSlice
echo "--- 1. createSlice ---"
R=$(post createSlice "{\"sliceId\":\"$SLICE_ID\",\"description\":\"$DESCRIPTION\"}")
WF_ID=$(echo "$R" | jq -r '.data.workflowId')
STATE=$(echo "$R" | jq -r '.data.state')
if [ "$(echo "$R" | jq -r '.ok')" = "true" ]; then
  ok "createSlice → $STATE (workflow: $WF_ID)"
else
  fail "createSlice: $(echo "$R" | jq -r '.error')"
  echo ""; echo "=== ABORTED: $PASS passed, $FAIL failed ==="; exit 1
fi

# 2. assignBuilder
echo "--- 2. assignBuilder ---"
R=$(post assignBuilder "{\"workflowId\":\"$WF_ID\",\"agentId\":\"opencode\"}")
STATE=$(echo "$R" | jq -r '.data.state')
if [ "$STATE" = "BUILDING" ]; then ok "assignBuilder → $STATE (agent: opencode)"
else fail "assignBuilder: expected BUILDING, got $STATE"; fi

# 3. reportTests (pass)
echo "--- 3. reportTests (pass) ---"
R=$(post reportTests "{\"workflowId\":\"$WF_ID\",\"pass\":true,\"commit\":true}" opencode)
STATE=$(echo "$R" | jq -r '.data.state')
if [ "$STATE" = "REVIEWING" ]; then ok "reportTests(pass) → $STATE"
else fail "reportTests: expected REVIEWING, got $STATE"; fi

# 4. reportReview (approve)
echo "--- 4. reportReview (approve) ---"
R=$(post reportReview "{\"workflowId\":\"$WF_ID\",\"approved\":true}" codex)
STATE=$(echo "$R" | jq -r '.data.state')
if [ "$STATE" = "AWAITING_APPROVAL" ]; then ok "reportReview(approve) → $STATE"
else fail "reportReview: expected AWAITING_APPROVAL, got $STATE"; fi

# 5. approve
echo "--- 5. approve ---"
R=$(post approve "{\"workflowId\":\"$WF_ID\"}" ceo)
STATE=$(echo "$R" | jq -r '.data.state')
if [ "$STATE" = "APPROVED" ]; then ok "approve → $STATE"
else fail "approve: expected APPROVED, got $STATE"; fi

# 6. deploy
echo "--- 6. deploy ---"
R=$(post deploy "{\"workflowId\":\"$WF_ID\"}" ceo)
DEPLOY_OK=$(echo "$R" | jq -r '.ok')
if [ "$DEPLOY_OK" = "true" ]; then ok "deploy → DEPLOYED"
else fail "deploy: $(echo "$R" | jq -r '.error')"; fi

# 7. Evidence check
echo "--- 7. evidence ---"
EVIDENCE_DIR="$HOME/projects/s4a-slice-orchestrator/evidence/$SLICE_ID"
if [ -d "$EVIDENCE_DIR" ]; then
  COUNT=$(ls "$EVIDENCE_DIR" | wc -l)
  HAS_DEPLOY=$(ls "$EVIDENCE_DIR" | grep -c "DEPLOYED" || true)
  if [ "$HAS_DEPLOY" -ge 1 ]; then ok "Deploy evidence: $COUNT total packets, DEPLOYED packet exists"
  else fail "No DEPLOYED evidence packet"; fi
else fail "Evidence directory not found: $EVIDENCE_DIR"; fi

# Summary
echo ""
echo "=== RESULT ==="
echo "  Slice ID:    $SLICE_ID"
echo "  Workflow ID: $WF_ID"
echo "  Final state: DEPLOYED"
echo "  Evidence:    $EVIDENCE_DIR ($COUNT packets)"
echo "  Passed:      $PASS"
echo "  Failed:      $FAIL"
echo ""
[ "$FAIL" -eq 0 ] && echo "  HAPPY PATH: PASS" && exit 0 || echo "  HAPPY PATH: FAIL" && exit 1
