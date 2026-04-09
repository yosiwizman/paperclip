/**
 * S4A Slice Orchestrator bridge — opt-in route for Paperclip.
 *
 * Gated behind S4A_ORCHESTRATOR_BRIDGE=1 env var.
 * When enabled, POST /api/s4a-orchestrator accepts an envelope JSON body,
 * spawns the orchestrator wrapper as a subprocess (stdin pipe),
 * and returns the response envelope as JSON.
 *
 * When disabled (default): this route is never mounted. Zero behavior change.
 *
 * Subprocess boundary: Paperclip → wrapper (stdin) → harness → adapter-core → Temporal
 * Paperclip never imports orchestrator code directly.
 *
 * See: s4a-slice-orchestrator/docs/ENVELOPE_CONTRACT.md
 */

import { Router } from "express";
import { execSync } from "node:child_process";
import path from "node:path";

/** Default path to the orchestrator wrapper. Override with S4A_WRAPPER_PATH. */
const DEFAULT_WRAPPER_PATH = path.resolve(
  process.env.HOME ?? "/home/ai-desktop",
  "projects/s4a-slice-orchestrator/dist/wrapper.js",
);

const TIMEOUT_MS = parseInt(process.env.S4A_BRIDGE_TIMEOUT_MS ?? "", 10) || 45_000;

interface ResponseEnvelope {
  ok: boolean;
  version: string;
  requestId: string;
  command: string;
  data?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
  timestamp: string;
  retryAttempt?: number;
}

/**
 * Check whether the bridge is enabled.
 */
export function isOrchestratorBridgeEnabled(): boolean {
  return process.env.S4A_ORCHESTRATOR_BRIDGE === "1";
}

/**
 * Create the orchestrator bridge routes.
 * Only call this when isOrchestratorBridgeEnabled() returns true.
 */
export function s4aOrchestratorRoutes() {
  const router = Router();
  const wrapperPath = process.env.S4A_WRAPPER_PATH ?? DEFAULT_WRAPPER_PATH;

  router.post("/", (req, res) => {
    const envelope = req.body;

    // Basic validation — the wrapper does full validation, but catch obvious issues early
    if (!envelope || typeof envelope !== "object" || !envelope.command) {
      res.status(400).json({
        ok: false,
        version: "1",
        requestId: envelope?.requestId ?? "",
        command: envelope?.command ?? "",
        error: "Request body must be a JSON envelope with at least a 'command' field",
        errorCode: "ENVELOPE_VALIDATION",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const envelopeJson = JSON.stringify(envelope);

    try {
      const stdout = execSync(
        `echo '${envelopeJson.replace(/'/g, "'\\''")}' | node ${wrapperPath}`,
        {
          cwd: path.dirname(path.dirname(wrapperPath)), // orchestrator project root
          encoding: "utf-8",
          timeout: TIMEOUT_MS,
          stdio: ["pipe", "pipe", "pipe"],
          shell: "/bin/bash",
        },
      );

      const response: ResponseEnvelope = JSON.parse(stdout.trim());
      res.status(response.ok ? 200 : 422).json(response);
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; killed?: boolean };

      // Try to parse structured output from the wrapper
      if (execErr.stdout) {
        try {
          const response: ResponseEnvelope = JSON.parse(execErr.stdout.trim());
          res.status(422).json(response);
          return;
        } catch {
          // stdout not parseable — fall through
        }
      }

      // Timeout
      if (execErr.killed) {
        res.status(504).json({
          ok: false,
          version: "1",
          requestId: envelope.requestId ?? "",
          command: envelope.command ?? "",
          error: `Orchestrator wrapper timed out after ${TIMEOUT_MS}ms`,
          errorCode: "TIMEOUT",
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Unknown error
      res.status(500).json({
        ok: false,
        version: "1",
        requestId: envelope.requestId ?? "",
        command: envelope.command ?? "",
        error: (err as Error).message?.slice(0, 500) ?? "Unknown bridge error",
        errorCode: "INTERNAL_ERROR",
        timestamp: new Date().toISOString(),
      });
    }
  });

  return router;
}
