import type { GenerateStreamProgressEvent } from "@/lib/generateStreamProgress";

type QueueInfo = {
  queue_idx?: number;
  queue_length?: number;
  queue_status?: string;
};

function queueRemainFromIdx(idx: number | null | undefined, len: number | null | undefined) {
  if (typeof idx !== "number" || typeof len !== "number" || len <= 0) return null;
  return Math.min(100, Math.max(0, Math.round(((idx - 1) / len) * 100)));
}

function isOngoingGenStatus(status: string) {
  const s = status.trim().toLowerCase();
  return (
    s === "querying" ||
    s === "queue" ||
    s === "running" ||
    s === "pending" ||
    s === "processing" ||
    s === "init" ||
    s === "submitted" ||
    s === "submit_success" ||
    s === "wait" ||
    s === "loading"
  );
}

function inferRenderPhase(
  genStatus: string,
  queueRemainPct: number | null,
  qi: QueueInfo | undefined
): "queue" | "rendering" | "unknown" {
  const raw = String(genStatus || "").trim();
  const st = raw.toLowerCase();
  if (st.includes("run") || st === "processing" || st === "loading") return "rendering";

  const atQueueFront =
    qi &&
    typeof qi.queue_idx === "number" &&
    typeof qi.queue_length === "number" &&
    qi.queue_length > 0 &&
    qi.queue_idx <= 1;

  if (atQueueFront && isOngoingGenStatus(raw)) return "rendering";
  if (queueRemainPct === 0 && isOngoingGenStatus(raw)) return "rendering";
  if (typeof queueRemainPct === "number" && queueRemainPct > 0) return "queue";
  if (
    st === "queue" ||
    st === "pending" ||
    st === "wait" ||
    st === "submitted" ||
    st === "querying" ||
    st === "init" ||
    st === "submit_success"
  ) {
    return "queue";
  }
  return "unknown";
}

export function queryTaskJsonToProgressEvent(
  submitId: string,
  data: Record<string, unknown>
): GenerateStreamProgressEvent {
  const genStatus = typeof data.gen_status === "string" ? data.gen_status : null;
  const qi = data.queue_info as QueueInfo | undefined;
  const queueRemainPct = queueRemainFromIdx(qi?.queue_idx, qi?.queue_length);
  const renderPhase = genStatus
    ? inferRenderPhase(genStatus, queueRemainPct, qi)
    : ("unknown" as const);

  return {
    submitId,
    genStatus,
    queueLength: typeof qi?.queue_length === "number" ? qi.queue_length : null,
    queueIdx: typeof qi?.queue_idx === "number" ? qi.queue_idx : null,
    queueStatus: typeof qi?.queue_status === "string" ? qi.queue_status : null,
    waitedMs: undefined,
    progressPct:
      typeof data.progress_pct === "number" && Number.isFinite(data.progress_pct)
        ? data.progress_pct
        : null,
    queueRemainPct,
    renderPhase,
  };
}

export function isTerminalQueryFailure(data: Record<string, unknown>) {
  return data.terminal === true;
}
