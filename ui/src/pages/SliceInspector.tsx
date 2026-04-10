import { useState, useEffect } from "react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { s4aApi, type SliceStatus, type TransitionRecord } from "../api/s4a";
import { Search, Activity, AlertCircle } from "lucide-react";

const STATE_COLORS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  DRAFT: "outline",
  SCOPED: "secondary",
  BUILDING: "default",
  REVIEWING: "default",
  VERIFYING: "default",
  AWAITING_APPROVAL: "secondary",
  APPROVED: "default",
  DEPLOYED: "default",
  BLOCKED: "destructive",
  RETRY_PENDING: "destructive",
  FAILED: "destructive",
  ROLLED_BACK: "outline",
};

export function SliceInspector() {
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => {
    setBreadcrumbs([{ label: "S4A Slice Inspector" }]);
  }, [setBreadcrumbs]);

  const [workflowId, setWorkflowId] = useState("");
  const [status, setStatus] = useState<(SliceStatus & { workflowId: string }) | null>(null);
  const [history, setHistory] = useState<TransitionRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function inspect() {
    const wfId = workflowId.trim();
    if (!wfId) return;
    setLoading(true);
    setError(null);
    setStatus(null);
    setHistory([]);
    try {
      const [s, h] = await Promise.all([
        s4aApi.getStatus(wfId),
        s4aApi.getHistory(wfId),
      ]);
      setStatus(s);
      setHistory(h);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">S4A Slice Inspector</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Read-only view of slice orchestrator state. Enter a workflow ID to inspect.
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="slice-workflow-..."
          value={workflowId}
          onChange={(e) => setWorkflowId(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && inspect()}
          className="font-mono text-sm"
        />
        <Button onClick={inspect} disabled={loading || !workflowId.trim()}>
          <Search className="h-4 w-4 mr-1" />
          {loading ? "Loading..." : "Inspect"}
        </Button>
      </div>

      {error && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">{error}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {status && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Slice Status
            </CardTitle>
            <CardDescription className="font-mono text-xs">
              {status.workflowId}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-xs text-muted-foreground mb-1">State</div>
                <Badge variant={STATE_COLORS[status.state] ?? "outline"}>
                  {status.state}
                </Badge>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Builder</div>
                <span className="text-sm font-mono">
                  {status.builderAgentId ?? "—"}
                </span>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Build Failures</div>
                <span className="text-sm font-mono">{status.buildFailCount}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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
                        <Badge variant={STATE_COLORS[t.to] ?? "outline"} className="text-xs">
                          {t.to}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant={t.cedarDecision === "ALLOW" ? "default" : "destructive"} className="text-xs">
                          {t.cedarDecision}
                        </Badge>
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {new Date(t.timestamp).toLocaleString()}
                      </td>
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
