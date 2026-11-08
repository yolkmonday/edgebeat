import { connect } from "cloudflare:sockets";
import type { CheckResult, ErrorClass } from "@/core/types";

export type TcpMonitor = { id: string; host: string; port: number };

export const runTcpCheck = async (m: TcpMonitor, timeoutMs: number): Promise<CheckResult> => {
  const fail = (error: ErrorClass, latencyMs: number | null): CheckResult => ({
    monitorId: m.id,
    ok: false,
    latencyMs,
    code: null,
    error,
  });

  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let socket: ReturnType<typeof connect> | undefined;
  try {
    socket = connect({ hostname: m.host, port: m.port });
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    const opened = socket.opened.then(() => "opened" as const);
    opened.catch(() => {});
    const outcome = await Promise.race([opened, timeout]);
    if (outcome === "timeout") return fail("timeout", null);
    return { monitorId: m.id, ok: true, latencyMs: Date.now() - started, code: null, error: null };
  } catch {
    return fail("connect", null);
  } finally {
    clearTimeout(timer);
    try {
      await socket?.close();
    } catch {
      // already closed or never opened
    }
  }
};
