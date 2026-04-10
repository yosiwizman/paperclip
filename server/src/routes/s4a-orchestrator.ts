/**
 * S4A Slice Orchestrator bridge route — thin POST handler.
 *
 * Gated behind S4A_ORCHESTRATOR_BRIDGE=1 env var.
 * All subprocess + config logic lives in services/s4a-orchestrator-bridge.ts.
 *
 * See: s4a-slice-orchestrator/docs/ENVELOPE_CONTRACT.md
 */

import { Router } from "express";
import {
  type BridgeConfig,
  resolveBridgeConfig,
  executeViaWrapper,
  autoAssignAfterCreate,
  errorEnvelope,
} from "../services/s4a-orchestrator-bridge.js";

/**
 * Check whether the bridge is enabled (reads env at call time).
 */
export function isOrchestratorBridgeEnabled(): boolean {
  return resolveBridgeConfig().enabled;
}

/**
 * Create the orchestrator bridge routes.
 * Only call this when isOrchestratorBridgeEnabled() returns true.
 */
export function s4aOrchestratorRoutes() {
  const router = Router();
  const config: BridgeConfig = resolveBridgeConfig();

  router.post("/", (req, res) => {
    const envelope = req.body;

    // Basic shape validation — the wrapper does full validation
    if (!envelope || typeof envelope !== "object" || !envelope.command) {
      const resp = errorEnvelope(
        envelope?.requestId ?? "",
        envelope?.command ?? "",
        "Request body must be a JSON envelope with at least a 'command' field",
        "ENVELOPE_VALIDATION",
      );
      res.status(400).json(resp);
      return;
    }

    const response = executeViaWrapper(envelope, config);

    // Auto-assign after successful createSlice (if env + request opt-in)
    if (envelope.command === "createSlice" && response.ok) {
      const assignResult = autoAssignAfterCreate(response, envelope, config);
      if (assignResult) {
        // Merge auto-assign info into the create response
        const enriched = {
          ...response,
          data: {
            ...response.data,
            autoAssign: {
              ok: assignResult.ok,
              agentId: config.defaultBuilder,
              state: assignResult.data?.state ?? null,
              error: assignResult.error ?? null,
            },
          },
        };
        res.status(200).json(enriched);
        return;
      }
    }

    res.status(response.ok ? 200 : 422).json(response);
  });

  return router;
}
