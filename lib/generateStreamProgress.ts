export type GenerateStreamProgressEvent = {
  submitId?: string | null;
  genStatus?: string | null;
  queueLength?: number | null;
  queueIdx?: number | null;
  queueStatus?: string | null;
  waitedMs?: number;
  progressPct?: number | null;
  queueRemainPct?: number | null;
  renderPhase?: "queue" | "rendering" | "unknown" | null;
};

function queueRemainFromIdx(idx: number | null | undefined, len: number | null | undefined) {
  if (typeof idx !== "number" || typeof len !== "number" || len <= 0) return null;
  return Math.min(100, Math.max(0, Math.round(((idx - 1) / len) * 100)));
}

const DEFAULT_SEC_PER_QUEUE_SLOT = 120;

function formatQueueRemainDuration(ev: GenerateStreamProgressEvent) {
  const idx = ev.queueIdx;
  const len = ev.queueLength;
  if (typeof idx === "number" && typeof len === "number" && len > 0) {
    const ahead = Math.max(0, idx - 1);
    if (ahead <= 0) return "Queue almost finished";
    const sec = Math.max(30, ahead * DEFAULT_SEC_PER_QUEUE_SLOT);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m <= 0) return `Queue about ${s}s left`;
    return s > 0 ? `Queue about ${m}m ${s}s left` : `Queue about ${m}m left`;
  }
  if (typeof ev.waitedMs === "number" && ev.waitedMs > 15_000) {
    return "Still in queue";
  }
  return null;
}

export function isProgressQueuePhase(ev: GenerateStreamProgressEvent) {
  if (ev.renderPhase === "rendering") return false;
  if (ev.renderPhase === "queue") return true;

  let qRem = ev.queueRemainPct;
  if (qRem == null) qRem = queueRemainFromIdx(ev.queueIdx ?? null, ev.queueLength ?? null);
  if (qRem === 0) return false;

  const idx = ev.queueIdx;
  const len = ev.queueLength;
  if (typeof idx === "number" && typeof len === "number" && len > 0 && idx <= 1) {
    return false;
  }

  if (typeof qRem === "number" && qRem > 0) return true;
  const st = (ev.genStatus || "").toLowerCase();
  return st === "queue" || st === "pending" || st === "submitted" || st === "wait" || st === "init";
}

export function formatGenerateProgressLine(ev: GenerateStreamProgressEvent) {
  const parts: string[] = [];

  if (isProgressQueuePhase(ev)) {
    parts.push(formatQueueRemainDuration(ev) || "Queued");
    if (typeof ev.queueIdx === "number" && typeof ev.queueLength === "number") {
      parts.push(`Position ${ev.queueIdx}/${ev.queueLength}`);
    } else if (typeof ev.queueLength === "number") {
      parts.push(`Queue ${ev.queueLength}`);
    }
    if (ev.queueStatus) parts.push(String(ev.queueStatus));
    if (ev.submitId) parts.push(`Task ${String(ev.submitId).slice(0, 12)}...`);
    return parts.join(" · ");
  }

  const st = (ev.genStatus || "").toLowerCase();
  if (ev.renderPhase === "rendering" || st.includes("run") || st === "processing" || st === "loading") {
    parts.push("Rendering");
  }
  if (typeof ev.progressPct === "number" && Number.isFinite(ev.progressPct)) {
    parts.push(`Progress ${Math.min(100, Math.max(0, Math.round(ev.progressPct)))}%`);
  }
  if (ev.genStatus) parts.push(String(ev.genStatus));
  if (ev.submitId) parts.push(`Task ${String(ev.submitId).slice(0, 12)}...`);
  return parts.join(" · ") || "Generating";
}

export function computeProgressFromStreamEvent(ev: GenerateStreamProgressEvent, prev: number) {
  if (isProgressQueuePhase(ev)) return 0;

  if (typeof ev.progressPct === "number" && Number.isFinite(ev.progressPct)) {
    const raw = Math.min(100, Math.max(0, ev.progressPct));
    if (raw >= 100) return 96;
    return Math.max(prev, Math.max(4, Math.round(raw * 0.92)));
  }

  const st = (ev.genStatus || "").toLowerCase();
  let qRem = ev.queueRemainPct;
  if (qRem == null) qRem = queueRemainFromIdx(ev.queueIdx ?? null, ev.queueLength ?? null);

  const phase = ev.renderPhase;
  const isRendering =
    phase === "rendering" ||
    st.includes("run") ||
    st === "processing" ||
    st === "loading" ||
    (qRem === 0 && phase !== "queue" && st !== "success");

  if (isRendering || qRem === 0) {
    const base = prev <= 0 ? 0 : prev;
    const step = Math.max(2, Math.min(8, Math.ceil((92 - base) / 8)));
    return Math.min(92, Math.max(base + step, 4));
  }
  return Math.max(prev, 4);
}
