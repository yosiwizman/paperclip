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
| `S4A_ORCHESTRATOR_BRIDGE` | unset | `1` to enable |
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
```

Prerequisites: Temporal dev server + orchestrator worker running. See orchestrator repo `docs/PAPERCLIP_BRIDGE.md`.

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
