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
