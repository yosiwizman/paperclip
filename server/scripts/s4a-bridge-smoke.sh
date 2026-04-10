#!/usr/bin/env bash
# S4A Orchestrator Bridge — Repeatable smoke proof.
#
# Tests both disabled and enabled modes against a running Paperclip instance.
#
# Prerequisites:
#   1. Temporal dev server running (temporal server start-dev)
#   2. Orchestrator worker running (node dist/worker.js in orchestrator repo)
#   3. Orchestrator built (pnpm build in orchestrator repo)
#
# Usage:
#   # Test disabled mode (Paperclip running normally):
#   bash server/scripts/s4a-bridge-smoke.sh disabled
#
#   # Test enabled mode (Paperclip running with S4A_ORCHESTRATOR_BRIDGE=1):
#   bash server/scripts/s4a-bridge-smoke.sh enabled
#
#   # Test both (runs disabled check, then enabled lifecycle):
#   bash server/scripts/s4a-bridge-smoke.sh both

set -euo pipefail

PAPERCLIP_URL="${PAPERCLIP_URL:-http://localhost:3100}"
BRIDGE_URL="${PAPERCLIP_URL}/api/s4a-orchestrator"
PASS=0
FAIL=0

ok() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

check_json() {
  local label="$1" field="$2" expected="$3" actual="$4"
  if [ "$actual" = "$expected" ]; then ok "$label ($field=$actual)"
  else fail "$label (expected $field=$expected, got $actual)"; fi
}

envelope() {
  local cmd="$1" payload="$2" caller="${3:-paperclip}"
  local reqId="smoke-$(date +%s)-$$-$RANDOM"
  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  echo "{\"version\":\"1\",\"requestId\":\"$reqId\",\"command\":\"$cmd\",\"payload\":$payload,\"caller\":\"$caller\",\"timestamp\":\"$ts\"}"
}

test_disabled() {
  echo "=== DISABLED MODE ==="
  local resp http_code
  resp=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BRIDGE_URL" \
    -H 'Content-Type: application/json' -d '{"command":"getState","payload":{}}')
  if [ "$resp" = "404" ]; then ok "Bridge route returns 404 (not mounted)"
  else fail "Expected 404, got $resp"; fi
}

test_enabled() {
  echo "=== ENABLED MODE ==="
  local slice_id="smoke-$(date +%s)"
  local wf_id="slice-workflow-$slice_id"

  # 1. createSlice
  echo "--- createSlice ---"
  local r1
  r1=$(curl -s -X POST "$BRIDGE_URL" -H 'Content-Type: application/json' \
    -d "$(envelope createSlice "{\"sliceId\":\"$slice_id\",\"description\":\"Smoke test\"}")")
  check_json "createSlice" "ok" "true" "$(echo "$r1" | jq -r '.ok')"
  check_json "createSlice" "state" "SCOPED" "$(echo "$r1" | jq -r '.data.state')"

  # 2. getState
  echo "--- getState ---"
  local r2
  r2=$(curl -s -X POST "$BRIDGE_URL" -H 'Content-Type: application/json' \
    -d "$(envelope getState "{\"workflowId\":\"$wf_id\"}")")
  check_json "getState" "ok" "true" "$(echo "$r2" | jq -r '.ok')"
  check_json "getState" "state" "SCOPED" "$(echo "$r2" | jq -r '.data.state')"

  # 3. assignBuilder
  echo "--- assignBuilder ---"
  local r3
  r3=$(curl -s -X POST "$BRIDGE_URL" -H 'Content-Type: application/json' \
    -d "$(envelope assignBuilder "{\"workflowId\":\"$wf_id\",\"agentId\":\"opencode\"}")")
  check_json "assignBuilder" "state" "BUILDING" "$(echo "$r3" | jq -r '.data.state')"

  # 4. reportTests (agent)
  echo "--- reportTests ---"
  local r4
  r4=$(curl -s -X POST "$BRIDGE_URL" -H 'Content-Type: application/json' \
    -d "$(envelope reportTests "{\"workflowId\":\"$wf_id\",\"pass\":true,\"commit\":true}" opencode)")
  check_json "reportTests" "state" "REVIEWING" "$(echo "$r4" | jq -r '.data.state')"

  # 5. reportReview (agent)
  echo "--- reportReview ---"
  local r5
  r5=$(curl -s -X POST "$BRIDGE_URL" -H 'Content-Type: application/json' \
    -d "$(envelope reportReview "{\"workflowId\":\"$wf_id\",\"approved\":true}" codex)")
  check_json "reportReview" "state" "AWAITING_APPROVAL" "$(echo "$r5" | jq -r '.data.state')"

  # 6. approve
  echo "--- approve ---"
  local r6
  r6=$(curl -s -X POST "$BRIDGE_URL" -H 'Content-Type: application/json' \
    -d "$(envelope approve "{\"workflowId\":\"$wf_id\"}" ceo)")
  check_json "approve" "state" "APPROVED" "$(echo "$r6" | jq -r '.data.state')"

  # 7. deploy
  echo "--- deploy ---"
  local r7
  r7=$(curl -s -X POST "$BRIDGE_URL" -H 'Content-Type: application/json' \
    -d "$(envelope deploy "{\"workflowId\":\"$wf_id\"}" ceo)")
  check_json "deploy" "ok" "true" "$(echo "$r7" | jq -r '.ok')"

  # 8. Evidence check
  echo "--- evidence ---"
  local evidence_dir
  evidence_dir="$HOME/projects/s4a-slice-orchestrator/evidence/$slice_id"
  if [ -d "$evidence_dir" ]; then
    local count
    count=$(ls "$evidence_dir" | wc -l)
    if [ "$count" -ge 7 ]; then ok "Evidence packets: $count"
    else fail "Expected >=7 evidence packets, got $count"; fi
  else fail "Evidence directory not found: $evidence_dir"; fi
}

test_autoassign_disabled() {
  echo "=== AUTO-ASSIGN DISABLED (env gate off, request opt-in present) ==="
  local slice_id="smoke-aa-off-$(date +%s)"

  local r1
  r1=$(curl -s -X POST "$BRIDGE_URL" -H 'Content-Type: application/json' \
    -d "$(envelope createSlice "{\"sliceId\":\"$slice_id\",\"description\":\"Auto-assign disabled test\",\"autoAssign\":true}")")
  check_json "createSlice (aa disabled)" "ok" "true" "$(echo "$r1" | jq -r '.ok')"
  check_json "createSlice (aa disabled)" "state" "SCOPED" "$(echo "$r1" | jq -r '.data.state')"

  # autoAssign field should NOT be present when env gate is off
  local aa_present
  aa_present=$(echo "$r1" | jq -r '.data.autoAssign // "absent"')
  if [ "$aa_present" = "absent" ]; then
    ok "No autoAssign in response (env gate off)"
  else
    fail "autoAssign present unexpectedly: $aa_present"
  fi
}

test_autoassign_enabled() {
  echo "=== AUTO-ASSIGN ENABLED (env gate on, request opt-in present) ==="
  local slice_id="smoke-aa-on-$(date +%s)"

  local r1
  r1=$(curl -s -X POST "$BRIDGE_URL" -H 'Content-Type: application/json' \
    -d "$(envelope createSlice "{\"sliceId\":\"$slice_id\",\"description\":\"Auto-assign enabled test\",\"autoAssign\":true}")")
  check_json "createSlice (aa enabled)" "ok" "true" "$(echo "$r1" | jq -r '.ok')"

  # autoAssign field should be present with builder info
  local aa_ok aa_agent aa_state
  aa_ok=$(echo "$r1" | jq -r '.data.autoAssign.ok')
  aa_agent=$(echo "$r1" | jq -r '.data.autoAssign.agentId')
  aa_state=$(echo "$r1" | jq -r '.data.autoAssign.state')
  check_json "autoAssign" "ok" "true" "$aa_ok"
  check_json "autoAssign" "agentId" "opencode" "$aa_agent"
  check_json "autoAssign" "state" "BUILDING" "$aa_state"
}

test_autoassign_no_optin() {
  echo "=== AUTO-ASSIGN NO OPT-IN (env gate on, request opt-in absent) ==="
  local slice_id="smoke-aa-noop-$(date +%s)"

  local r1
  r1=$(curl -s -X POST "$BRIDGE_URL" -H 'Content-Type: application/json' \
    -d "$(envelope createSlice "{\"sliceId\":\"$slice_id\",\"description\":\"No opt-in test\"}")")
  check_json "createSlice (no opt-in)" "ok" "true" "$(echo "$r1" | jq -r '.ok')"
  check_json "createSlice (no opt-in)" "state" "SCOPED" "$(echo "$r1" | jq -r '.data.state')"

  # autoAssign field should NOT be present
  local aa_present
  aa_present=$(echo "$r1" | jq -r '.data.autoAssign // "absent"')
  if [ "$aa_present" = "absent" ]; then
    ok "No autoAssign in response (no opt-in)"
  else
    fail "autoAssign present unexpectedly: $aa_present"
  fi
}

test_report_pass() {
  echo "=== REPORT TESTS — PASS PATH ==="
  local slice_id="smoke-rpt-pass-$(date +%s)"
  local wf_id="slice-workflow-$slice_id"

  # Create + assign
  curl -s -X POST "$BRIDGE_URL" -H 'Content-Type: application/json' \
    -d "$(envelope createSlice "{\"sliceId\":\"$slice_id\",\"description\":\"Report pass test\"}")" > /dev/null
  curl -s -X POST "$BRIDGE_URL" -H 'Content-Type: application/json' \
    -d "$(envelope assignBuilder "{\"workflowId\":\"$wf_id\",\"agentId\":\"opencode\"}")" > /dev/null

  # Verify in BUILDING
  local pre
  pre=$(curl -s -X POST "$BRIDGE_URL" -H 'Content-Type: application/json' \
    -d "$(envelope getState "{\"workflowId\":\"$wf_id\"}")")
  check_json "pre-report state" "state" "BUILDING" "$(echo "$pre" | jq -r '.data.state')"

  # Report tests PASS
  local r1
  r1=$(curl -s -X POST "$BRIDGE_URL" -H 'Content-Type: application/json' \
    -d "$(envelope reportTests "{\"workflowId\":\"$wf_id\",\"pass\":true,\"commit\":true}" opencode)")
  check_json "reportTests(pass)" "ok" "true" "$(echo "$r1" | jq -r '.ok')"
  check_json "reportTests(pass)" "state" "REVIEWING" "$(echo "$r1" | jq -r '.data.state')"
  check_json "reportTests(pass)" "pass" "true" "$(echo "$r1" | jq -r '.data.pass')"
}

test_report_fail() {
  echo "=== REPORT TESTS — FAIL PATH ==="
  local slice_id="smoke-rpt-fail-$(date +%s)"
  local wf_id="slice-workflow-$slice_id"

  # Create + assign
  curl -s -X POST "$BRIDGE_URL" -H 'Content-Type: application/json' \
    -d "$(envelope createSlice "{\"sliceId\":\"$slice_id\",\"description\":\"Report fail test\"}")" > /dev/null
  curl -s -X POST "$BRIDGE_URL" -H 'Content-Type: application/json' \
    -d "$(envelope assignBuilder "{\"workflowId\":\"$wf_id\",\"agentId\":\"opencode\"}")" > /dev/null

  # Verify in BUILDING
  local pre
  pre=$(curl -s -X POST "$BRIDGE_URL" -H 'Content-Type: application/json' \
    -d "$(envelope getState "{\"workflowId\":\"$wf_id\"}")")
  check_json "pre-report state" "state" "BUILDING" "$(echo "$pre" | jq -r '.data.state')"

  # Report tests FAIL
  local r1
  r1=$(curl -s -X POST "$BRIDGE_URL" -H 'Content-Type: application/json' \
    -d "$(envelope reportTests "{\"workflowId\":\"$wf_id\",\"pass\":false,\"commit\":true}" opencode)")
  check_json "reportTests(fail)" "ok" "true" "$(echo "$r1" | jq -r '.ok')"

  # After fail report, workflow transitions: BUILDING→Cedar DENY→BLOCKED
  local post_state
  post_state=$(echo "$r1" | jq -r '.data.state')
  check_json "reportTests(fail)" "state" "BLOCKED" "$post_state"
  check_json "reportTests(fail)" "pass" "false" "$(echo "$r1" | jq -r '.data.pass')"
}

# --- Main ---
MODE="${1:-both}"

case "$MODE" in
  disabled)        test_disabled ;;
  enabled)         test_enabled ;;
  both)            test_disabled; echo; test_enabled ;;
  autoassign-off)  test_autoassign_disabled ;;
  autoassign-on)   test_autoassign_enabled ;;
  autoassign-noop) test_autoassign_no_optin ;;
  report-pass)     test_report_pass ;;
  report-fail)     test_report_fail ;;
  report)          test_report_pass; echo; test_report_fail ;;
  all)             test_disabled; echo; test_enabled; echo; test_autoassign_disabled; echo; test_autoassign_enabled; echo; test_autoassign_no_optin; echo; test_report_pass; echo; test_report_fail ;;
  *)               echo "Usage: $0 [disabled|enabled|both|autoassign-off|autoassign-on|autoassign-noop|report-pass|report-fail|report|all]"; exit 1 ;;
esac

echo ""
echo "=== SUMMARY: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
