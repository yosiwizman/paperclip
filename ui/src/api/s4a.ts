/**
 * S4A Slice Orchestrator API — wraps the bridge endpoint.
 * Read-only: getStatus + getHistory only.
 */

const BRIDGE = "/api/s4a-orchestrator";

interface BridgeResponse {
  ok: boolean;
  version: string;
  requestId: string;
  command: string;
  data?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
  timestamp: string;
}

function envelope(command: string, payload: Record<string, unknown>): object {
  return {
    version: "1",
    requestId: `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    command,
    payload,
    caller: "paperclip-ui",
    timestamp: new Date().toISOString(),
  };
}

async function bridgePost(command: string, payload: Record<string, unknown>): Promise<BridgeResponse> {
  const res = await fetch(BRIDGE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(envelope(command, payload)),
  });
  return res.json();
}

export interface SliceStatus {
  state: string;
  builderAgentId: string | null;
  buildFailCount: number;
}

export interface TransitionRecord {
  from: string;
  to: string;
  timestamp: string;
  cedarDecision: string;
  evidencePath: string;
}

export const s4aApi = {
  async getStatus(workflowId: string): Promise<SliceStatus & { workflowId: string }> {
    const r = await bridgePost("getStatus", { workflowId });
    if (!r.ok) throw new Error(r.error ?? "getStatus failed");
    return r.data as unknown as SliceStatus & { workflowId: string };
  },

  async getHistory(workflowId: string): Promise<TransitionRecord[]> {
    const r = await bridgePost("getHistory", { workflowId });
    if (!r.ok) throw new Error(r.error ?? "getHistory failed");
    return (r.data as unknown as { history: TransitionRecord[] }).history;
  },
};
