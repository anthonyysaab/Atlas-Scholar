import { useCallback, useEffect, useState } from "react";
import type { HealthCheck, HealthReport } from "@shared/types";
import { Icon } from "@renderer/components/Icon";
import { Button, Section } from "./fields";
import { toast } from "@renderer/state/toastStore";

const STATE_STYLE: Record<HealthCheck["state"], string> = {
  ok: "text-anno-green",
  degraded: "text-anno-yellow",
  down: "text-danger",
  unconfigured: "text-text-weak"
};

const STATE_LABEL: Record<HealthCheck["state"], string> = {
  ok: "OK",
  degraded: "Degraded",
  down: "Down",
  unconfigured: "Setup needed"
};

function CheckCard({ check }: { check: HealthCheck }) {
  return (
    <div className="rounded-md border border-border bg-bg-subtle p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-text">{check.label}</span>
        <span className={`inline-flex items-center gap-1 text-[11px] ${STATE_STYLE[check.state]}`}>
          {check.state === "ok" ? <Icon name="check" className="h-3 w-3" /> : <Icon name="alert" className="h-3 w-3" />}
          {STATE_LABEL[check.state]}
        </span>
      </div>
      <p className="mt-1 text-xs text-text-weak">{check.detail}</p>
      {check.remediation ? (
        <p className="mt-1 leading-relaxed text-[11px] text-text-weak">
          <span className="text-text">Fix:</span> {check.remediation}
        </p>
      ) : null}
    </div>
  );
}

export function HealthSection() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    try {
      setReport(await window.api.health.check());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <Section
      title="Health"
      description="Verifies the chat provider and embedding provider are reachable, with hints to fix problems."
    >
      <div className="space-y-2">
        {report ? (
          <>
            <CheckCard check={report.chat} />
            <CheckCard check={report.embedding} />
          </>
        ) : (
          <p className="text-xs text-text-weak">{busy ? "Running checks…" : "No results yet."}</p>
        )}
      </div>
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => void run()} disabled={busy}>
          Run checks
        </Button>
      </div>
      {report ? (
        <p className="text-[11px] text-text-weak">Last checked {new Date(report.checkedAt).toLocaleTimeString()}</p>
      ) : null}
    </Section>
  );
}
