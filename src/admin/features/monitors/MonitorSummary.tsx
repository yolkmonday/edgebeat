import { Card } from "@/components/ui/card";
import { KeyValueList, type KeyValueItem } from "@/components/shared/KeyValueList";
import { useGroups } from "@/api/use-groups";
import { duration, intervalLabel, periodLabel } from "@/lib/format";
import type { Monitor } from "@shared/admin-api";

export const MonitorSummary = ({ monitor: m }: { monitor: Monitor }) => {
  const groups = useGroups();
  const group = m.groupId ? (groups.data?.find((g) => g.id === m.groupId)?.name ?? "—") : "No group";
  const tail: KeyValueItem[] = [
    { label: "Group", value: group },
    { label: "On status page", value: m.isPublic ? "Yes" : "No" },
  ];
  const items: KeyValueItem[] =
    m.type === "heartbeat"
      ? [
          { label: "Expected every", value: periodLabel(m.heartbeatPeriodS ?? 0), mono: true },
          { label: "Grace", value: periodLabel(m.heartbeatGraceS ?? 0), mono: true },
          ...tail,
        ]
      : m.type === "tcp"
        ? [
            { label: "Host", value: m.host ?? "—", mono: true },
            { label: "Port", value: m.port ?? "—", mono: true },
            { label: "Check every", value: intervalLabel(m.intervalMin), mono: true },
            { label: "Timeout", value: duration(m.timeoutMs / 1000), mono: true },
            { label: "Confirmations", value: m.confirmations, mono: true },
            ...tail,
          ]
        : [
            { label: "URL", value: <span className="break-all">{m.url ?? "—"}</span>, mono: true },
            { label: "Method", value: m.method, mono: true },
            { label: "Expected status", value: m.expectedStatus, mono: true },
            { label: "Check every", value: intervalLabel(m.intervalMin), mono: true },
            { label: "Timeout", value: duration(m.timeoutMs / 1000), mono: true },
            { label: "Confirmations", value: m.confirmations, mono: true },
            ...tail,
          ];
  return (
    <Card>
      <KeyValueList items={items} />
    </Card>
  );
};
