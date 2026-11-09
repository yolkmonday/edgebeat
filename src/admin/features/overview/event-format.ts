import { format, isSameDay, subDays } from "date-fns";
import type { StateEvent } from "@shared/admin-api";
import type { ErrorClass } from "../../../core/types";
import { ago, duration, errorLabel, stateLabel } from "@/lib/format";

/** "12 min ago" (< 1 h) | "Today 02:21" | "Yesterday 18:40" | "Nov 7" */
export const eventTime = (at: number, now: number): string => {
  if (now - at < 3_600_000) return ago(at, now);
  const date = new Date(at);
  if (isSameDay(date, now)) return `Today ${format(date, "HH:mm")}`;
  if (isSameDay(date, subDays(now, 1))) return `Yesterday ${format(date, "HH:mm")}`;
  return format(date, "MMM d");
};

/** "Down for 4 min · Timeout" | "Paused by admin" | "Resumed" */
export const eventDetail = (e: StateEvent): string => {
  if (e.reason === "paused") return "Paused by admin";
  if (e.reason === "unpaused") return "Resumed";
  const parts: string[] = [];
  if (e.prevDurationS !== null && e.from !== "up" && e.from !== "pending") {
    parts.push(`${stateLabel(e.from)} for ${duration(e.prevDurationS)}`);
  }
  if (e.reason !== "ok") parts.push(errorLabel(e.reason as ErrorClass) ?? e.reason);
  if (parts.length > 0) return parts.join(" · ");
  return e.to === "up" ? "Recovered" : `Changed to ${stateLabel(e.to).toLowerCase()}`;
};
