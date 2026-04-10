import { useState, useEffect, useCallback, useRef } from "react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { s4aApi, type SliceStatus, type TransitionRecord, type WorkflowListItem } from "../api/s4a";
import { Search, Activity, AlertCircle, Plus, Play, RotateCcw, XCircle, CheckCircle, Rocket, RefreshCw, List } from "lucide-react";

const STATE_COLORS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  DRAFT: "outline", SCOPED: "secondary", BUILDING: "default", REVIEWING: "default",
  VERIFYING: "default", AWAITING_APPROVAL: "secondary", APPROVED: "default",
  DEPLOYED: "default", BLOCKED: "destructive", RETRY_PENDING: "destructive",
  FAILED: "destructive", ROLLED_BACK: "outline",
};

const ROLLBACK_STATES = new Set([
  "SCOPED", "BUILDING", "REVIEWING", "VERIFYING",
  "AWAITING_APPROVAL", "APPROVED", "BLOCKED", "RETRY_PENDING", "FAILED",
]);

export function SliceInspector() {
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => { setBreadcrumbs([{ label: "S4A Slice Inspector" }]); }, [setBreadcrumbs]);

  const [workflowId, setWorkflowId] = useState("");
  const [status, setStatus] = useState<(SliceStatus & { workflowId: string }) | null>(null);
  const [history, setHistory] = useState<TransitionRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createDesc, setCreateDesc] = useState("");
  const [createId, setCreateId] = useState("");

  // Workflow list
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([]);
  const [listLoading, setListLoading] = useState(false);

  const loadList = useCallback(async () => {
    setListLoading(true);
    try { setWorkflows(await s4aApi.listWorkflows(20)); } catch { /* bridge may be off */ }
    setListLoading(false);
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  // Auto-refresh polling
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const TERMINAL = new Set(["DEPLOYED", "ROLLED_BACK"]);
  const actingRef = useRef(acting);
  actingRef.current = acting;

  // Poll selected workflow status every 5s (skip if acting or terminal)
  useEffect(() => {
    const wfId = workflowId.trim();
    if (!wfId || !status) return;
    if (TERMINAL.has(status.state)) return;
    const timer = setInterval(async () => {
      if (actingRef.current) return;
      try {
        const [s, h] = await Promise.all([s4aApi.getStatus(wfId), s4aApi.getHistory(wfId)]);
        setStatus(s); setHistory(h); setLastRefresh(new Date());
      } catch { /* ignore poll errors silently */ }
    }, 5000);
    return () => clearInterval(timer);
  }, [workflowId, status?.state]);

  // Poll workflow list every 15s
  useEffect(() => {
    const timer = setInterval(() => { if (!actingRef.current) loadList(); }, 15000);
    return () => clearInterval(timer);
  }, [loadList]);

  const refresh = useCallback(async (wfId: string) => {
    try {
      const [s, h] = await Promise.all([s4aApi.getStatus(wfId), s4aApi.getHistory(wfId)]);
      setStatus(s);
      setHistory(h);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  async function inspect() {
    const wfId = workflowId.trim();
    if (!wfId) return;
    setLoading(true); setError(null); setActionMsg(null); setStatus(null); setHistory([]);
    await refresh(wfId);
    setLoading(false);
  }

  async function runAction(label: string, fn: () => Promise<{ ok: boolean; state?: string; error?: string }>) {
    setActing(true); setActionMsg(null); setError(null);
    try {
      const r = await fn();
      if (r.ok) {
        setActionMsg(`${label}: OK → ${r.state ?? "done"}`);
        if (workflowId.trim()) await refresh(workflowId.trim());
      } else {
        setError(`${label} failed: ${r.error ?? "unknown error"}`);
      }
    } catch (e) {
      setError(`${label} error: ${(e as Error).message}`);
    } finally {
      setActing(false);
    }
  }

  async function handleCreate() {
    if (!createDesc.trim()) return;
    setActing(true); setActionMsg(null); setError(null);
    try {
      const r = await s4aApi.createSlice(createDesc.trim(), createId.trim() || undefined);
      setWorkflowId(r.workflowId);
      setActionMsg(`Created: ${r.workflowId} → ${r.state}`);
      setShowCreate(false); setCreateDesc(""); setCreateId("");
      await refresh(r.workflowId);
      loadList();
    } catch (e) {
      setError(`Create failed: ${(e as Error).message}`);
    } finally {
      setActing(false);
    }
  }

  const st = status?.state ?? "";

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">S4A Slice Inspector</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Inspect and manage slice orchestrator workflows.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowCreate(!showCreate)}>
          <Plus className="h-4 w-4 mr-1" /> Create Slice
        </Button>
      </div>

      {/* Create form */}
      {showCreate && (
        <Card>
          <CardHeader><CardTitle className="text-base">Create New Slice</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              <Input placeholder="Description (required)" value={createDesc}
                onChange={(e) => setCreateDesc(e.target.value)} />
              <Input placeholder="Slice ID (optional, auto-generated if empty)" value={createId}
                onChange={(e) => setCreateId(e.target.value)} className="font-mono text-sm" />
              <div className="flex gap-2">
                <Button onClick={handleCreate} disabled={acting || !createDesc.trim()} size="sm">
                  <Plus className="h-4 w-4 mr-1" /> Create
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Inspect input */}
      <div className="flex gap-2">
        <Input placeholder="slice-workflow-..." value={workflowId}
          onChange={(e) => setWorkflowId(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && inspect()} className="font-mono text-sm" />
        <Button onClick={inspect} disabled={loading || !workflowId.trim()}>
          <Search className="h-4 w-4 mr-1" /> {loading ? "Loading..." : "Inspect"}
        </Button>
      </div>

      {/* Workflow list */}
      {workflows.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <List className="h-4 w-4" /> Recent Workflows
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={loadList} disabled={listLoading}>
                <RefreshCw className="h-3 w-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {workflows.map((wf) => (
                <button key={wf.workflowId} onClick={() => { setWorkflowId(wf.workflowId); setStatus(null); setHistory([]); setActionMsg(null); setError(null); refresh(wf.workflowId); }}
                  className={`w-full text-left px-3 py-2 rounded text-sm hover:bg-accent flex items-center justify-between gap-2 ${workflowId === wf.workflowId ? 'bg-accent' : ''}`}>
                  <span className="font-mono text-xs truncate">{wf.workflowId}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={wf.status === 'RUNNING' ? 'default' : 'outline'} className="text-xs">{wf.status}</Badge>
                    {wf.startTime && <span className="text-xs text-muted-foreground">{new Date(wf.startTime).toLocaleDateString()}</span>}
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Messages */}
      {actionMsg && (
        <div className="flex items-center gap-2 text-green-500 text-sm p-3 border border-green-800 rounded">
          <CheckCircle className="h-4 w-4" /> {actionMsg}
        </div>
      )}
      {error && (
        <Card><CardContent className="pt-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" /> <span className="text-sm">{error}</span>
          </div>
        </CardContent></Card>
      )}

      {/* Status card */}
      {status && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" /> Slice Status
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => refresh(workflowId.trim())} disabled={acting}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            <CardDescription className="font-mono text-xs flex items-center justify-between">
              <span>{status.workflowId}</span>
              {lastRefresh && !TERMINAL.has(st) && (
                <span className="text-xs text-muted-foreground ml-2">Auto-refresh · {lastRefresh.toLocaleTimeString()}</span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <div className="text-xs text-muted-foreground mb-1">State</div>
                <Badge variant={STATE_COLORS[st] ?? "outline"}>{st}</Badge>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Builder</div>
                <span className="text-sm font-mono">{status.builderAgentId ?? "—"}</span>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Build Failures</div>
                <span className="text-sm font-mono">{status.buildFailCount}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="border-t pt-4">
              <div className="text-xs text-muted-foreground mb-2">Actions</div>
              <div className="flex flex-wrap gap-2">
                {st === "SCOPED" && (
                  <>
                    <Button size="sm" disabled={acting} onClick={() =>
                      runAction("Assign OpenCode", () => s4aApi.assignBuilder(workflowId, "opencode"))}>
                      <Play className="h-3 w-3 mr-1" /> Assign OpenCode
                    </Button>
                    <Button size="sm" variant="secondary" disabled={acting} onClick={() =>
                      runAction("Assign Claude Code", () => s4aApi.assignBuilder(workflowId, "claude-code"))}>
                      <Play className="h-3 w-3 mr-1" /> Assign Claude Code
                    </Button>
                  </>
                )}
                {st === "BLOCKED" && (
                  <Button size="sm" disabled={acting} onClick={() =>
                    runAction("Retry", () => s4aApi.retry(workflowId))}>
                    <RotateCcw className="h-3 w-3 mr-1" /> Retry
                  </Button>
                )}
                {st === "AWAITING_APPROVAL" && (
                  <Button size="sm" disabled={acting} onClick={() =>
                    runAction("Approve", () => s4aApi.approve(workflowId))}>
                    <CheckCircle className="h-3 w-3 mr-1" /> Approve
                  </Button>
                )}
                {st === "APPROVED" && (
                  <Button size="sm" disabled={acting} onClick={() =>
                    runAction("Deploy", () => s4aApi.deploy(workflowId))}>
                    <Rocket className="h-3 w-3 mr-1" /> Deploy
                  </Button>
                )}
                {ROLLBACK_STATES.has(st) && (
                  <Button size="sm" variant="destructive" disabled={acting} onClick={() =>
                    runAction("Rollback", () => s4aApi.rollback(workflowId))}>
                    <XCircle className="h-3 w-3 mr-1" /> Rollback
                  </Button>
                )}
                {(st === "DEPLOYED" || st === "ROLLED_BACK") && (
                  <span className="text-xs text-muted-foreground italic">Terminal state — no actions available</span>
                )}
                {!st && <span className="text-xs text-muted-foreground">Load a workflow to see available actions</span>}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* History */}
      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Transition History</CardTitle>
            <CardDescription>{history.length} transitions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4">#</th>
                    <th className="pb-2 pr-4">From</th>
                    <th className="pb-2 pr-4">To</th>
                    <th className="pb-2 pr-4">Cedar</th>
                    <th className="pb-2">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((t, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-4 text-muted-foreground">{i + 1}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{t.from}</td>
                      <td className="py-2 pr-4 font-mono text-xs">
                        <Badge variant={STATE_COLORS[t.to] ?? "outline"} className="text-xs">{t.to}</Badge>
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant={t.cedarDecision === "ALLOW" ? "default" : "destructive"} className="text-xs">
                          {t.cedarDecision}
                        </Badge>
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">{new Date(t.timestamp).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
