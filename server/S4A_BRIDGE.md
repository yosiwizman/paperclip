# S4A Slice Orchestrator Bridge

Opt-in integration between Paperclip and the S4A slice orchestrator.

## Status

| Field | Value |
|-------|-------|
| Branch | `s4a-orchestrator-bridge` (local + fork) |
| Fork | `yosiwizman/paperclip` (protection remote only) |
| Upstream | `paperclipai/paperclip` — **NOT modified** |
| Default behavior | **Unchanged** — bridge disabled unless env-gated on |

## Enable / Disable

| Env var | Value | Behavior |
|---------|-------|----------|
| `S4A_ORCHESTRATOR_BRIDGE` | unset (default) | Bridge not mounted. 404 on `/api/s4a-orchestrator`. Zero behavior change. |
| `S4A_ORCHESTRATOR_BRIDGE` | `1` | Bridge mounted. POST `/api/s4a-orchestrator` processes envelope requests. |

**Enable:** `S4A_ORCHESTRATOR_BRIDGE=1 pnpm dev`

**Disable:** Normal `pnpm dev` (no env var)

## Files

| File | Purpose |
|------|---------|
| `server/src/services/s4a-orchestrator-bridge.ts` | Bridge service: config, subprocess execution, error builder |
| `server/src/routes/s4a-orchestrator.ts` | Thin POST route, delegates to service |
| `server/src/app.ts` | Conditional mount (2 lines: import + `if (isOrchestratorBridgeEnabled())`) |
| `server/scripts/s4a-bridge-smoke.sh` | Repeatable smoke proof |
| `server/S4A_BRIDGE.md` | This file |

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `S4A_ORCHESTRATOR_BRIDGE` | unset | `1` to enable bridge |
| `S4A_BRIDGE_AUTO_ASSIGN` | unset | `1` to enable auto-assign after createSlice |
| `S4A_DEFAULT_BUILDER` | `opencode` | Builder agentId for auto-assign |
| `S4A_WRAPPER_PATH` | `~/projects/s4a-slice-orchestrator/dist/wrapper.js` | Orchestrator wrapper path |
| `S4A_BRIDGE_TIMEOUT_MS` | `45000` | Subprocess timeout (ms) |

## Smoke proof

```bash
# Disabled mode (Paperclip running normally):
bash server/scripts/s4a-bridge-smoke.sh disabled

# Enabled mode (S4A_ORCHESTRATOR_BRIDGE=1):
bash server/scripts/s4a-bridge-smoke.sh enabled

# Both:
bash server/scripts/s4a-bridge-smoke.sh both

# Auto-assign tests (requires S4A_BRIDGE_AUTO_ASSIGN=1 for enabled test):
bash server/scripts/s4a-bridge-smoke.sh autoassign-off    # env gate off, opt-in present
bash server/scripts/s4a-bridge-smoke.sh autoassign-on     # env gate on, opt-in present
bash server/scripts/s4a-bridge-smoke.sh autoassign-noop   # env gate on, opt-in absent

# All tests:
bash server/scripts/s4a-bridge-smoke.sh all
```

Prerequisites: Temporal dev server + orchestrator worker running. See orchestrator repo `docs/PAPERCLIP_BRIDGE.md`.

## Auto-assign (Phase 10)

When both the env gate AND request opt-in are active, `createSlice` automatically calls `assignBuilder` with the default builder.

**Gating model (three gates, all required):**
1. `S4A_ORCHESTRATOR_BRIDGE=1` — bridge must be enabled
2. `S4A_BRIDGE_AUTO_ASSIGN=1` — auto-assign env gate must be on
3. `payload.autoAssign: true` — request must explicitly opt in

If any gate is off, `createSlice` behaves exactly as before.

**Default builder:** `opencode` (per SSOT AGENT_ROLE_MATRIX.md and DELIVERY_PIPELINE.md)

**Request example (with auto-assign):**
```json
{
  "version": "1",
  "requestId": "req-001",
  "command": "createSlice",
  "payload": {
    "sliceId": "my-feature",
    "description": "Build login page",
    "autoAssign": true
  },
  "caller": "paperclip",
  "timestamp": "2026-04-09T12:00:00Z"
}
```

**Response (when auto-assign fires):**
```json
{
  "ok": true,
  "data": {
    "workflowId": "slice-workflow-my-feature",
    "sliceId": "my-feature",
    "state": "SCOPED",
    "autoAssign": {
      "ok": true,
      "agentId": "opencode",
      "state": "BUILDING"
    }
  }
}
```

**Scope limit:** This phase only supports default-builder auto-assign. No escalation logic, no Claude Code routing, no heuristics.

## Build-result reporting (Phase 11)

Builder agents report test results through the existing generic bridge. **No new env gate is needed** — `reportTests` is already a supported command when `S4A_ORCHESTRATOR_BRIDGE=1`.

**Canonical `reportTests` envelope:**
```json
{
  "version": "1",
  "requestId": "req-builder-001",
  "command": "reportTests",
  "payload": {
    "workflowId": "slice-workflow-my-feature",
    "pass": true,
    "commit": true
  },
  "caller": "opencode",
  "timestamp": "2026-04-09T12:00:00Z"
}
```

**State transitions:**
| Result | `pass` | Resulting state | Explanation |
|--------|--------|----------------|-------------|
| Pass | `true` | `REVIEWING` | Tests passed + commit exists → Cedar allows → enters review |
| Fail | `false` | `BLOCKED` | Tests failed → Cedar denies BUILDING→REVIEWING → enters BLOCKED |

**Convenience helper:**
```bash
bash server/scripts/s4a-report-tests.sh <workflowId> pass|fail [caller]
```

Default caller: `opencode`. The helper POSTs the canonical envelope through the bridge.

**Smoke proof:**
```bash
bash server/scripts/s4a-bridge-smoke.sh report-pass   # pass → REVIEWING
bash server/scripts/s4a-bridge-smoke.sh report-fail    # fail → BLOCKED
bash server/scripts/s4a-bridge-smoke.sh report          # both
```

## Reviewer-result reporting (Phase 12)

Reviewer agents (Codex) report review results through the existing generic bridge. **No new env gate is needed** — `reportReview` is already a supported command when `S4A_ORCHESTRATOR_BRIDGE=1`.

**Canonical `reportReview` envelope:**
```json
{
  "version": "1",
  "requestId": "req-review-001",
  "command": "reportReview",
  "payload": {
    "workflowId": "slice-workflow-my-feature",
    "approved": true
  },
  "caller": "codex",
  "timestamp": "2026-04-09T12:00:00Z"
}
```

**State transitions:**
| Result | `approved` | Resulting state | Explanation |
|--------|-----------|----------------|-------------|
| Approve | `true` | `AWAITING_APPROVAL` | Review approved → Cedar allows → VERIFYING (auto) → AWAITING_APPROVAL |
| Reject | `false` | `REVIEWING` | Review not approved → workflow stays in REVIEWING, awaiting new review |

**Convenience helper:**
```bash
bash server/scripts/s4a-report-review.sh <workflowId> approve|reject [caller]
```

Default caller: `codex`. The helper POSTs the canonical envelope through the bridge.

**Smoke proof:**
```bash
bash server/scripts/s4a-bridge-smoke.sh review-approve   # approve → AWAITING_APPROVAL
bash server/scripts/s4a-bridge-smoke.sh review-reject     # reject → stays REVIEWING
bash server/scripts/s4a-bridge-smoke.sh review             # both
```

## CEO approval (Phase 13)

The CEO grants final approval through the existing generic bridge. **No new env gate is needed** — `approve` is already a supported command when `S4A_ORCHESTRATOR_BRIDGE=1`.

**Canonical `approve` envelope:**
```json
{
  "version": "1",
  "requestId": "req-ceo-001",
  "command": "approve",
  "payload": {
    "workflowId": "slice-workflow-my-feature"
  },
  "caller": "ceo",
  "timestamp": "2026-04-09T12:00:00Z"
}
```

**State transition:**
| From state | To state | Mechanism |
|-----------|----------|-----------|
| `AWAITING_APPROVAL` | `APPROVED` | Cedar `approval_required` policy checks `approvalGranted=true` |

**Convenience helper:**
```bash
bash server/scripts/s4a-approve.sh <workflowId> [caller]
```

Default caller: `ceo`. The helper POSTs the canonical envelope through the bridge.

**Smoke proof:**
```bash
bash server/scripts/s4a-bridge-smoke.sh approve   # AWAITING_APPROVAL → APPROVED
```

## Deploy (Phase 14)

The CEO triggers deploy through the existing generic bridge. **No new env gate is needed** — `deploy` is already a supported command when `S4A_ORCHESTRATOR_BRIDGE=1`.

**Canonical `deploy` envelope:**
```json
{
  "version": "1",
  "requestId": "req-deploy-001",
  "command": "deploy",
  "payload": {
    "workflowId": "slice-workflow-my-feature"
  },
  "caller": "ceo",
  "timestamp": "2026-04-09T12:00:00Z"
}
```

**State transition:**
| From state | To state | Mechanism |
|-----------|----------|-----------|
| `APPROVED` | `DEPLOYED` | Deploy signal → evidence packet emitted → workflow completes (terminal) |

**Evidence:** Deploy emits an evidence packet with `fromState: "APPROVED"`, `toState: "DEPLOYED"`, persisted to `evidence/<sliceId>/`.

**Convenience helper:**
```bash
bash server/scripts/s4a-deploy.sh <workflowId> [caller]
```

Default caller: `ceo`.

**Smoke proof:**
```bash
bash server/scripts/s4a-bridge-smoke.sh deploy   # APPROVED → DEPLOYED + evidence check
```

## End-to-end happy path (Phase 15)

One script runs the complete slice lifecycle through the bridge:

```bash
bash server/scripts/s4a-happy-path.sh "Build login page"
bash server/scripts/s4a-happy-path.sh "Fix bug #42" my-bugfix
```

**No new env gate needed** — uses `S4A_ORCHESTRATOR_BRIDGE=1` only.

**Lifecycle stages executed:**
1. `createSlice` → SCOPED
2. `assignBuilder` (opencode) → BUILDING
3. `reportTests` (pass) → REVIEWING
4. `reportReview` (approve) → AWAITING_APPROVAL
5. `approve` → APPROVED
6. `deploy` → DEPLOYED (terminal)
7. Evidence check: verifies DEPLOYED evidence packet exists

**Output:** sliceId, workflowId, stage-by-stage PASS/FAIL, evidence summary.

**Smoke proof:**
```bash
bash server/scripts/s4a-bridge-smoke.sh happy-path
```

## Failure-path recovery: retry (Phase 16)

After a failed `reportTests(pass:false)` moves the slice to `BLOCKED`, the `retry` command recovers it. **No new env gate needed** — `retry` is already a supported command when `S4A_ORCHESTRATOR_BRIDGE=1`. **No new orchestrator code was needed** — the retry signal and BLOCKED→SCOPED transition were implemented in Phase 6D.

**Recovery flow:**
```
BUILDING → reportTests(fail) → BLOCKED → retry → SCOPED → assignBuilder → BUILDING (re-try)
```

**Canonical `retry` envelope:**
```json
{
  "version": "1",
  "requestId": "req-retry-001",
  "command": "retry",
  "payload": {
    "workflowId": "slice-workflow-my-feature"
  },
  "caller": "ceo",
  "timestamp": "2026-04-09T12:00:00Z"
}
```

**State transition:**
| From state | To state | Effect |
|-----------|----------|--------|
| `BLOCKED` | `SCOPED` | retryCount reset to 0, builder cleared, tests cleared. Slice can be re-assigned. |

**Post-recovery:** After retry, the slice is back in SCOPED — a new `assignBuilder` can be issued, and the build/test/review cycle restarts.

**Convenience helper:**
```bash
bash server/scripts/s4a-retry.sh <workflowId> [caller]
```

Default caller: `ceo`.

**Smoke proof:**
```bash
bash server/scripts/s4a-bridge-smoke.sh retry   # fail → BLOCKED → retry → SCOPED → reassign
```

**Alternative recovery:** `rollback` (BLOCKED → ROLLED_BACK, terminal). Use when the slice should be abandoned rather than retried.

## Escalation: OpenCode → Claude Code (Phase 17)

When OpenCode fails and the slice enters BLOCKED, the CEO can escalate to Claude Code using the explicit escalation helper. **This is a manual escalation action, not automatic policy enforcement** — the current orchestrator does not track cross-retry attempt counts, so the "2 tries then Claude" policy (DEC-003) must be enforced by the caller.

**Escalation flow:**
```
BUILDING(opencode) → reportTests(fail) → BLOCKED → escalate → retry → SCOPED → assignBuilder(claude-code) → BUILDING(claude-code)
```

**Convenience helper:**
```bash
bash server/scripts/s4a-escalate.sh <workflowId> [caller]
```

Default caller: `ceo`. The helper:
1. Checks the slice is in BLOCKED
2. Issues `retry` → SCOPED
3. Issues `assignBuilder` with `agentId: claude-code` → BUILDING
4. Verifies the result

**No new env gate needed** — uses existing bridge commands.
**No new orchestrator code** — uses existing `retry` + `assignBuilder`.

**Note:** The explicit escalation helper (Phase 17) remains available for manual use. The policy-aware helper (Phase 18, below) supersedes it for automated routing.

**Smoke proof:**
```bash
bash server/scripts/s4a-bridge-smoke.sh escalate   # opencode fail → BLOCKED → escalate → claude-code BUILDING
```

## Policy-aware builder routing (Phase 18)

The orchestrator now tracks `buildFailCount` — a durable counter that increments on every BUILDING→BLOCKED transition and does NOT reset on retry. A new `getStatus` query exposes this counter plus builder identity.

**Policy:** OpenCode for the first 2 failures, then Claude Code (per DEC-003, DELIVERY_PIPELINE.md).

**New orchestrator query: `getStatus`**
```json
{
  "command": "getStatus",
  "payload": { "workflowId": "slice-workflow-xyz" }
}
→ { "state": "BLOCKED", "builderAgentId": "opencode", "buildFailCount": 1 }
```

**Policy-aware helper:**
```bash
bash server/scripts/s4a-policy-route.sh <workflowId> [caller]
```

The helper:
1. Queries `getStatus` for `buildFailCount`
2. If `buildFailCount < 2` → retry + assign `opencode`
3. If `buildFailCount >= 2` → retry + assign `claude-code`
4. Outputs machine-friendly JSON result

**Smoke proof:**
```bash
bash server/scripts/s4a-bridge-smoke.sh policy-route   # 1st fail→opencode, 2nd fail→claude-code
```

## Rollback (Phase 19)

Rollback abandons a slice and moves it to the terminal `ROLLED_BACK` state. **No new env gate needed** — `rollback` is already a supported command when `S4A_ORCHESTRATOR_BRIDGE=1`. **No new orchestrator code.**

**Supported source states:** SCOPED, BUILDING, REVIEWING, VERIFYING, AWAITING_APPROVAL, APPROVED, BLOCKED, RETRY_PENDING, FAILED

**NOT supported from:** DRAFT (workflow hasn't started meaningful work), DEPLOYED (already terminal), ROLLED_BACK (already terminal)

**Canonical `rollback` envelope:**
```json
{
  "version": "1",
  "requestId": "req-rollback-001",
  "command": "rollback",
  "payload": {
    "workflowId": "slice-workflow-my-feature"
  },
  "caller": "ceo",
  "timestamp": "2026-04-09T12:00:00Z"
}
```

**State transition:**
| From state | To state | Behavior |
|-----------|----------|----------|
| Any supported | `ROLLED_BACK` | Terminal — workflow completes, no further commands accepted |

**Evidence:** Rollback emits an evidence packet with `toState: "ROLLED_BACK"`.

**Terminal behavior:** After rollback, the workflow is complete. Further commands (assignBuilder, reportTests, etc.) will fail because the workflow has finished.

**Convenience helper:**
```bash
bash server/scripts/s4a-rollback.sh <workflowId> [caller]
```

Default caller: `ceo`.

**Smoke proof:**
```bash
bash server/scripts/s4a-bridge-smoke.sh rollback   # BUILDING → rollback → ROLLED_BACK + evidence + terminal check
```

## Slice Inspector UI (Phase 20)

A read-only inspector page inside Paperclip for viewing slice orchestrator state.

**URL:** `http://localhost:3100/instance/settings/s4a-slices`

**Features:**
- Manual workflowId input
- Displays: state, builderAgentId, buildFailCount (via `getStatus`)
- Displays: full transition history table (via `getHistory`)
- Color-coded state badges
- Read-only — no mutation controls

**Files:**
- `ui/src/pages/SliceInspector.tsx` — the inspector page component
- `ui/src/api/s4a.ts` — API module wrapping bridge POST calls
- `ui/src/App.tsx` — route mount at `instance/settings/s4a-slices`

**No new backend code** — uses existing `/api/s4a-orchestrator` POST route.
**No new env gate** — available whenever Paperclip runs (bridge must be enabled for data).

## Branch / fork safety

- Bridge work lives on the `s4a-orchestrator-bridge` branch, NOT on `master`.
- The fork `yosiwizman/paperclip` exists as a **protection remote only** — it preserves the bridge branch off-machine.
- **Upstream `paperclipai/paperclip` has NOT been modified.** No commits, no PRs, no pushes.
- This fork does NOT replace the upstream dependency. Paperclip remains an upstream checkout per DEC-002.
- The fork is authorized under DEC-028 (SSOT) as a temporary protection measure only.

## Future evolution

1. **Upstream PR** — when the bridge is stable, submit to `paperclipai/paperclip` as an optional feature
2. **Default-on** — remove env gate after upstream acceptance or CEO approval
3. **Agent routing** — Paperclip task assignment auto-calls assignBuilder
4. **UI integration** — show slice status in Paperclip dashboard
5. **Remove fork** — once upstream accepts or bridge is removed, delete the protection fork
