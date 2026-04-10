/**
 * S4A Slice Orchestrator bridge service.
 *
 * Manages the subprocess boundary between Paperclip and the slice orchestrator.
 * The route layer (routes/s4a-orchestrator.ts) delegates to this service.
 *
 * Env vars:
 *   S4A_ORCHESTRATOR_BRIDGE   — enabled by default; set to "0" to disable
 *   S4A_WRAPPER_PATH          — path to orchestrator wrapper.js (default: ~/projects/s4a-slice-orchestrator/dist/wrapper.js)
 *   S4A_BRIDGE_TIMEOUT_MS     — subprocess timeout in ms (default: 45000)
 *   S4A_BRIDGE_AUTO_ASSIGN    — "1" to enable auto-assign after createSlice (default: disabled)
 *   S4A_DEFAULT_BUILDER       — builder agentId for auto-assign (default: "opencode")
 */

import { execSync } from "node:child_process";
import path from "node:path";

/** Response envelope from the orchestrator wrapper. */
export interface OrchestratorResponse {
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

/** Bridge configuration, resolved once from env. */
export interface BridgeConfig {
  enabled: boolean;
  autoAssignEnabled: boolean;
  defaultBuilder: string;
  wrapperPath: string;
  timeoutMs: number;
}

/**
 * Resolve bridge configuration from environment variables.
 */
export function resolveBridgeConfig(): BridgeConfig {
  const defaultWrapperPath = path.resolve(
    process.env.HOME ?? "/home/ai-desktop",
    "projects/s4a-slice-orchestrator/dist/wrapper.js",
  );

  return {
    enabled: process.env.S4A_ORCHESTRATOR_BRIDGE !== "0",
    autoAssignEnabled: process.env.S4A_BRIDGE_AUTO_ASSIGN === "1",
    defaultBuilder: process.env.S4A_DEFAULT_BUILDER ?? "opencode",
    wrapperPath: process.env.S4A_WRAPPER_PATH ?? defaultWrapperPath,
    timeoutMs: parseInt(process.env.S4A_BRIDGE_TIMEOUT_MS ?? "", 10) || 45_000,
  };
}

/**
 * Build an error response envelope.
 */
export function errorEnvelope(
  requestId: string,
  command: string,
  error: string,
  errorCode: string,
): OrchestratorResponse {
  return {
    ok: false,
    version: "1",
    requestId: requestId || "",
    command: command || "",
    error,
    errorCode,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Execute an orchestrator command by spawning the wrapper as a subprocess.
 *
 * Input:  envelope JSON object
 * Output: parsed OrchestratorResponse
 *
 * The wrapper is invoked via stdin pipe:
 *   echo '<envelope>' | node <wrapperPath>
 */
export function executeViaWrapper(
  envelope: Record<string, unknown>,
  config: BridgeConfig,
): OrchestratorResponse {
  const envelopeJson = JSON.stringify(envelope);

  try {
    const stdout = execSync(
      `echo '${envelopeJson.replace(/'/g, "'\\''")}' | node ${config.wrapperPath}`,
      {
        cwd: path.dirname(path.dirname(config.wrapperPath)),
        encoding: "utf-8",
        timeout: config.timeoutMs,
        stdio: ["pipe", "pipe", "pipe"],
        shell: "/bin/bash",
      },
    );

    return JSON.parse(stdout.trim()) as OrchestratorResponse;
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; killed?: boolean };

    // Try to parse structured output from the wrapper
    if (execErr.stdout) {
      try {
        return JSON.parse(execErr.stdout.trim()) as OrchestratorResponse;
      } catch {
        // stdout not parseable — fall through
      }
    }

    // Timeout
    if (execErr.killed) {
      return errorEnvelope(
        (envelope.requestId as string) ?? "",
        (envelope.command as string) ?? "",
        `Orchestrator wrapper timed out after ${config.timeoutMs}ms`,
        "TIMEOUT",
      );
    }

    // Unknown error
    return errorEnvelope(
      (envelope.requestId as string) ?? "",
      (envelope.command as string) ?? "",
      (err as Error).message?.slice(0, 500) ?? "Unknown bridge error",
      "INTERNAL_ERROR",
    );
  }
}

/**
 * Auto-assign default builder after a successful createSlice.
 *
 * Only called when:
 *   1. S4A_BRIDGE_AUTO_ASSIGN=1 env gate is on
 *   2. Request payload includes autoAssign: true
 *   3. createSlice response was ok: true with a workflowId
 *
 * Issues an assignBuilder envelope using the configured default builder.
 */
export function autoAssignAfterCreate(
  createResponse: OrchestratorResponse,
  originalEnvelope: Record<string, unknown>,
  config: BridgeConfig,
): OrchestratorResponse | null {
  if (!config.autoAssignEnabled) {
    return null;
  }

  const payload = originalEnvelope.payload as Record<string, unknown> | undefined;
  if (!payload?.autoAssign) {
    return null;
  }

  if (!createResponse.ok || !createResponse.data?.workflowId) {
    return null;
  }

  const assignEnvelope = {
    version: "1",
    requestId: `${originalEnvelope.requestId}-auto-assign`,
    command: "assignBuilder",
    payload: {
      workflowId: createResponse.data.workflowId,
      agentId: config.defaultBuilder,
    },
    caller: originalEnvelope.caller ?? "paperclip",
    timestamp: new Date().toISOString(),
  };

  return executeViaWrapper(assignEnvelope, config);
}
