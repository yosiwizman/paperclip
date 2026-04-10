/**
 * S4A Slice Orchestrator API — wraps the bridge endpoint.
 * Queries: getStatus, getHistory
 * Mutations: createSlice, assignBuilder, retry, rollback, approve, deploy
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

export interface CreateResult {
  workflowId: string;
  sliceId: string;
  state: string;
}

export interface ActionResult {
  ok: boolean;
  state?: string;
  error?: string;
}

export interface WorkflowListItem {
  workflowId: string;
  status: string;
  startTime: string | null;
  closeTime: string | null;
}

export const s4aApi = {
  // --- Queries ---
  async listWorkflows(limit = 20): Promise<WorkflowListItem[]> {
    const r = await bridgePost("listWorkflows", { limit });
    if (!r.ok) throw new Error(r.error ?? "listWorkflows failed");
    return (r.data as unknown as { workflows: WorkflowListItem[] }).workflows;
  },

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

  // --- Mutations ---
  async createSlice(description: string, sliceId?: string): Promise<CreateResult> {
    const payload: Record<string, unknown> = { description };
    if (sliceId) payload.sliceId = sliceId;
    const r = await bridgePost("createSlice", payload);
    if (!r.ok) throw new Error(r.error ?? "createSlice failed");
    return r.data as unknown as CreateResult;
  },

  async assignBuilder(workflowId: string, agentId: string): Promise<ActionResult> {
    const r = await bridgePost("assignBuilder", { workflowId, agentId });
    return { ok: r.ok, state: (r.data as unknown as { state?: string })?.state, error: r.error };
  },

  async retry(workflowId: string): Promise<ActionResult> {
    const r = await bridgePost("retry", { workflowId });
    return { ok: r.ok, state: (r.data as unknown as { state?: string })?.state, error: r.error };
  },

  async rollback(workflowId: string): Promise<ActionResult> {
    const r = await bridgePost("rollback", { workflowId });
    return { ok: r.ok, state: (r.data as unknown as { state?: string })?.state, error: r.error };
  },

  async approve(workflowId: string): Promise<ActionResult> {
    const r = await bridgePost("approve", { workflowId });
    return { ok: r.ok, state: (r.data as unknown as { state?: string })?.state, error: r.error };
  },

  async deploy(workflowId: string): Promise<ActionResult> {
    const r = await bridgePost("deploy", { workflowId });
    return { ok: r.ok, state: (r.data as unknown as { state?: string })?.state, error: r.error };
  },
};
