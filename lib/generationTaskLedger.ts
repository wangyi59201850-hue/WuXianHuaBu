import path from "path";
import { extractGeneratedFileName } from "@/lib/generatedDir";
import type { GenerationHistoryMediaType } from "@/lib/generationHistoryTypes";
import type { ExternalImageTaskCostSource } from "@/lib/externalImageTaskCost";

export type GenerationTaskStatus = "submitted" | "running" | "completed" | "failed";
export type GenerationTaskProvider = "dreamina" | "external_image_api" | "external_video_api";

export type GenerationTaskUsage = {
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  cost?: number;
  currency?: string;
};

export type GenerationTaskLogEntry = {
  at: number;
  level: "info" | "error";
  message: string;
  detail?: string;
};

export type GenerationTaskRecord = {
  submitId: string;
  sourceNodeId: string;
  index: number;
  mediaType: GenerationHistoryMediaType;
  status: GenerationTaskStatus;
  createdAt: number;
  updatedAt: number;
  provider?: GenerationTaskProvider;
  upstreamId?: string;
  upstreamTaskUrl?: string;
  upstreamProviderId?: string;
  upstreamImageSize?: string;
  upstreamImageQuality?: string;
  outputUrl?: string;
  fileName?: string;
  promptText?: string;
  modelVersion?: string;
  ratio?: string;
  resolutionType?: string;
  count?: number;
  usage?: GenerationTaskUsage;
  upstreamCost?: number;
  upstreamCostCurrency?: string;
  upstreamCostSource?: ExternalImageTaskCostSource;
  upstreamBalanceBefore?: number;
  upstreamBalanceAfter?: number;
  durationSeconds?: number;
  withAudio?: boolean;
  videoProvider?: "dreamina" | "external_api";
  referenceMode?: "general" | "headtail";
  failReason?: string;
  events?: GenerationTaskLogEntry[];
};

const MAX_TASKS = 1000;
const STORE_KEY = "__WUXIANHUABU_CLOUD_TASKS__";

function sanitizeNodeId(nodeId: string) {
  return nodeId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function taskStore() {
  const globalMap = globalThis as typeof globalThis & {
    [STORE_KEY]?: GenerationTaskRecord[];
  };
  if (!Array.isArray(globalMap[STORE_KEY])) {
    globalMap[STORE_KEY] = [];
  }
  return globalMap[STORE_KEY]!;
}

function normalizeTaskEvents(input: unknown): GenerationTaskLogEntry[] {
  if (!Array.isArray(input)) return [];
  const events: GenerationTaskLogEntry[] = [];
  for (const row of input) {
    if (!row || typeof row !== "object") continue;
    const obj = row as Partial<GenerationTaskLogEntry>;
    const at = typeof obj.at === "number" && Number.isFinite(obj.at) ? obj.at : Date.now();
    const level = obj.level === "error" ? "error" : "info";
    const message = typeof obj.message === "string" ? obj.message.trim() : "";
    if (!message) continue;
    const detail =
      typeof obj.detail === "string" && obj.detail.trim() ? obj.detail.trim() : undefined;
    events.push({ at, level, message, detail });
  }
  return events;
}

function mergeTaskEvents(
  prev: GenerationTaskLogEntry[] | undefined,
  next: GenerationTaskLogEntry[] | undefined
) {
  const merged = [...normalizeTaskEvents(prev), ...normalizeTaskEvents(next)];
  if (merged.length === 0) return undefined;
  return merged.sort((a, b) => a.at - b.at).slice(-40);
}

export async function readGenerationTasks(): Promise<GenerationTaskRecord[]> {
  return taskStore()
    .slice()
    .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
}

export async function upsertGenerationTask(
  patch: Partial<GenerationTaskRecord> & {
    submitId: string;
    sourceNodeId: string;
    mediaType: GenerationHistoryMediaType;
  }
) {
  const submitId = patch.submitId.trim();
  if (!submitId) return;
  const now = Date.now();
  const rows = taskStore();
  const idx = rows.findIndex((row) => row.submitId === submitId);
  const prev = idx >= 0 ? rows[idx] : null;
  const outputRel =
    typeof patch.outputUrl === "string" ? extractGeneratedFileName(patch.outputUrl) : null;
  const next: GenerationTaskRecord = {
    submitId,
    sourceNodeId: sanitizeNodeId(patch.sourceNodeId),
    index:
      typeof patch.index === "number" && Number.isFinite(patch.index)
        ? patch.index
        : prev?.index ?? 0,
    mediaType: patch.mediaType,
    status: patch.status ?? prev?.status ?? "submitted",
    createdAt: prev?.createdAt ?? patch.createdAt ?? now,
    updatedAt: now,
    provider: patch.provider ?? prev?.provider,
    upstreamId: patch.upstreamId ?? prev?.upstreamId,
    upstreamTaskUrl: patch.upstreamTaskUrl ?? prev?.upstreamTaskUrl,
    upstreamProviderId: patch.upstreamProviderId ?? prev?.upstreamProviderId,
    upstreamImageSize: patch.upstreamImageSize ?? prev?.upstreamImageSize,
    upstreamImageQuality: patch.upstreamImageQuality ?? prev?.upstreamImageQuality,
    outputUrl: patch.outputUrl ?? prev?.outputUrl,
    fileName: outputRel ? path.posix.basename(outputRel) : patch.fileName ?? prev?.fileName,
    promptText: patch.promptText ?? prev?.promptText,
    modelVersion: patch.modelVersion ?? prev?.modelVersion,
    ratio: patch.ratio ?? prev?.ratio,
    resolutionType: patch.resolutionType ?? prev?.resolutionType,
    count: patch.count ?? prev?.count,
    usage: patch.usage ?? prev?.usage,
    upstreamCost: patch.upstreamCost ?? prev?.upstreamCost,
    upstreamCostCurrency: patch.upstreamCostCurrency ?? prev?.upstreamCostCurrency,
    upstreamCostSource: patch.upstreamCostSource ?? prev?.upstreamCostSource,
    upstreamBalanceBefore: patch.upstreamBalanceBefore ?? prev?.upstreamBalanceBefore,
    upstreamBalanceAfter: patch.upstreamBalanceAfter ?? prev?.upstreamBalanceAfter,
    durationSeconds: patch.durationSeconds ?? prev?.durationSeconds,
    withAudio: patch.withAudio ?? prev?.withAudio,
    videoProvider: patch.videoProvider ?? prev?.videoProvider,
    referenceMode: patch.referenceMode ?? prev?.referenceMode,
    failReason: patch.failReason ?? prev?.failReason,
    events: mergeTaskEvents(prev?.events, patch.events),
  };
  const deduped = idx >= 0 ? rows.filter((_, i) => i !== idx) : rows.slice();
  const sorted = [next, ...deduped]
    .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
    .slice(0, MAX_TASKS);
  rows.splice(0, rows.length, ...sorted);
}

export async function snapshotGeneratedOutputForTask(_input: {
  submitId: string;
  outputRelPath: string;
}): Promise<{
  outputUrl: string;
  fileName: string;
  relPath: string;
} | null> {
  return null;
}

export async function findGenerationTasksForSource(sourceNodeId: string) {
  const safe = sanitizeNodeId(sourceNodeId);
  const rows = await readGenerationTasks();
  return rows.filter((row) => sanitizeNodeId(row.sourceNodeId) === safe);
}

export async function findGenerationTaskByOutput(outputUrlOrRel: string) {
  const rel = extractGeneratedFileName(outputUrlOrRel) || outputUrlOrRel;
  const base = path.posix.basename(rel.replace(/\\/g, "/"));
  if (!base) return null;
  const rows = await readGenerationTasks();
  return (
    rows.find((row) => row.fileName === base) ??
    rows.find((row) => {
      const rowRel = row.outputUrl ? extractGeneratedFileName(row.outputUrl) : null;
      return rowRel ? path.posix.basename(rowRel) === base : false;
    }) ??
    null
  );
}
