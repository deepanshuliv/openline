"use client";

import type { TransferState } from "@/lib/deriveCallState";
import { departmentLabel } from "@/lib/format";
import { AGENT_NAME } from "@/lib/shared";

export function TransferBanner({ transfer }: { transfer: TransferState }) {
  if (transfer.status === "none") return null;
  const dept = departmentLabel(transfer.department).toLowerCase();
  const staff = transfer.staffName ?? "A staff member";

  const copy: Record<Exclude<TransferState["status"], "none">, { dot: string; title: string; body: string }> = {
    requested: { dot: "pending pulse", title: `Connecting you to the ${dept}`, body: transfer.reason ?? "Please stay on the line." },
    accepted: { dot: "pending pulse", title: `${staff} is joining`, body: `${AGENT_NAME} is briefing them.` },
    completed: { dot: "pulse", title: `You're with ${staff}`, body: `${AGENT_NAME} has left the call.` },
    timed_out: { dot: "off", title: `The ${dept} didn't pick up`, body: `${AGENT_NAME} is back with you.` },
  };
  const c = copy[transfer.status];

  return (
    <div className="transfer" role="status">
      <span className={`liveDot ${c.dot}`} aria-hidden="true" />
      <strong>{c.title}</strong>
      <span className="muted">{c.body}</span>
    </div>
  );
}
