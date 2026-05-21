import fs from "fs/promises";
import { readExternalImageApiConfig } from "@/lib/externalImageApiConfig";

export const BANANA2_TASK_PREFIX = "banana2:";

export type Banana2TaskState =
  | {
      taskId: string;
      status: "pending" | "running";
      progressPct: number | null;
      rawStatus: string;
      imageUrl: null;
      failReason: null;
    }
  | {
      taskId: string;
      status: "completed";
      progressPct: 100;
      rawStatus: string;
      imageUrl: string;
      failReason: null;
      cost?: number;
    }
  | {
      taskId: string;
      status: "failed";
      progressPct: number | null;
      rawStatus: string;
      imageUrl: null;
      failReason: string;
    };

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, "");
}

function toAspectRatio(sizeOrRatio: string) {
  const normalized = sizeOrRatio.trim().replace(/\s+/g, "");
  const ratioHit = normalized.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (ratioHit) return normalized;
  const sizeHit = normalized.match(/^(\d+)[xX](\d+)$/);
  if (sizeHit) {
    const width = Number(sizeHit[1]);
    const height = Number(sizeHit[2]);
    if (width > 0 && height > 0) {
      const pairs = [
        "1:1",
        "4:3",
        "3:4",
        "16:9",
        "9:16",
        "3:2",
        "2:3",
        "21:9",
        "7:1",
      ];
      let best = "1:1";
      let delta = Number.POSITIVE_INFINITY;
      for (const pair of pairs) {
        const [w, h] = pair.split(":").map(Number);
        const nextDelta = Math.abs(width / height - w / h);
        if (nextDelta < delta) {
          delta = nextDelta;
          best = pair;
        }
      }
      return best;
    }
  }
  return "1:1";
}

function toBananaSize(sizeOrResolution: string) {
  const value = sizeOrResolution.trim().toLowerCase();
  if (value === "1k") return "1K";
  if (value === "4k" || value === "gpt-4k") return "4K";
  return "2K";
}

function normalizeStatus(raw: unknown) {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw === 2) return "completed" as const;
    if (raw < 0) return "failed" as const;
    if (raw === 0) return "pending" as const;
    return "running" as const;
  }
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (
    value === "succeeded" ||
    value === "success" ||
    value === "completed" ||
    value === "done" ||
    value === "成功"
  ) {
    return "completed" as const;
  }
  if (
    value === "failed" ||
    value === "error" ||
    value === "cancelled" ||
    value === "canceled" ||
    value === "失败"
  ) {
    return "failed" as const;
  }
  if (value === "pending" || value === "queued" || value === "submitted") {
    return "pending" as const;
  }
  return "running" as const;
}

function extractTaskId(payload: Record<string, unknown>) {
  const nested =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : payload;
  const candidates = [
    nested.taskId,
    nested.task_id,
    payload.taskId,
    payload.task_id,
    nested.id,
    payload.id,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function extractTaskImageUrl(payload: Record<string, unknown>) {
  const nested =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : payload;
  const candidates = [
    nested.imageUrl,
    nested.image_url,
    nested.url,
    nested.output,
    Array.isArray(nested.images) ? nested.images[0] : undefined,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function extractTaskCost(payload: Record<string, unknown>) {
  const nested =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : payload;
  const candidates = [nested.price, nested.cost, payload.price, payload.cost];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function extractFailReason(payload: Record<string, unknown>) {
  const nested =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : payload;
  const candidates = [
    nested.error,
    nested.message,
    nested.msg,
    payload.error,
    payload.message,
    payload.msg,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

async function readBanana2Provider() {
  const config = await readExternalImageApiConfig();
  const provider = config.providers.banana2;
  if (!provider.baseUrl.trim()) {
    throw new Error("香蕉生图 API 地址未配置。");
  }
  if (!provider.apiKey.trim()) {
    throw new Error("香蕉生图 API 密钥未配置。");
  }
  return provider;
}

export function toBanana2SubmitId(taskId: string) {
  return `${BANANA2_TASK_PREFIX}${taskId.trim()}`;
}

export function extractBanana2TaskId(submitId: string | null | undefined) {
  if (typeof submitId !== "string") return null;
  const trimmed = submitId.trim();
  if (!trimmed.toLowerCase().startsWith(BANANA2_TASK_PREFIX)) return null;
  const taskId = trimmed.slice(BANANA2_TASK_PREFIX.length).trim();
  return taskId || null;
}

export async function submitBanana2ImageTask(input: {
  prompt: string;
  size: string;
  ratio: string;
  imageUrls?: string[];
}) {
  const provider = await readBanana2Provider();
  const resp = await fetch(`${normalizeBaseUrl(provider.baseUrl)}/api/banana2/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      apiKey: provider.apiKey,
      prompt: input.prompt.trim(),
      size: toBananaSize(input.size),
      aspectRatio: toAspectRatio(input.ratio),
      ...(Array.isArray(input.imageUrls) && input.imageUrls.length > 0
        ? { urls: input.imageUrls }
        : {}),
    }),
    cache: "no-store",
  });
  const payload = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
  if (!resp.ok || !payload) {
    throw new Error(`香蕉生图任务创建失败（${resp.status}）。`);
  }
  if (payload.success === false) {
    throw new Error(extractFailReason(payload) || "香蕉生图任务创建失败。");
  }
  const taskId = extractTaskId(payload);
  if (!taskId) {
    throw new Error(`香蕉生图未返回 taskId：${JSON.stringify(payload).slice(0, 800)}`);
  }
  return {
    taskId,
    cost: extractTaskCost(payload),
    raw: payload,
  };
}

export async function queryBanana2ImageTask(taskId: string): Promise<Banana2TaskState> {
  const provider = await readBanana2Provider();
  const resp = await fetch(
    `${normalizeBaseUrl(provider.baseUrl)}/api/banana2/query?taskId=${encodeURIComponent(taskId)}`,
    { cache: "no-store" }
  );
  const payload = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
  if (!resp.ok || !payload) {
    throw new Error(`香蕉生图任务查询失败：${resp.status}`);
  }

  const nested =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : payload;
  const rawStatusValue =
    nested.status ?? payload.status ?? nested.statusText ?? payload.statusText ?? "pending";
  const rawStatus =
    typeof rawStatusValue === "string" ? rawStatusValue : String(rawStatusValue);
  const status = normalizeStatus(rawStatusValue);
  const imageUrl = extractTaskImageUrl(payload);
  const failReason = extractFailReason(payload);
  const progressPct =
    status === "completed"
      ? 100
      : typeof payload.progress === "number"
        ? Math.max(0, Math.min(100, Math.round(payload.progress)))
        : null;

  if (status === "completed") {
    if (!imageUrl) {
      throw new Error("香蕉生图任务已完成，但未返回图片 URL。");
    }
    return {
      taskId,
      status,
      progressPct: 100,
      rawStatus,
      imageUrl,
      failReason: null,
      cost: extractTaskCost(payload),
    };
  }

  if (status === "failed") {
    return {
      taskId,
      status,
      progressPct,
      rawStatus,
      imageUrl: null,
      failReason: failReason || "香蕉生图任务失败。",
    };
  }

  return {
    taskId,
    status,
    progressPct,
    rawStatus,
    imageUrl: null,
    failReason: null,
  };
}

export async function waitBanana2ImageTask(input: {
  taskId: string;
  abortSignal?: AbortSignal;
  onProgress?: (state: Extract<Banana2TaskState, { status: "pending" | "running" }>) => void;
  pollIntervalMs?: number;
  maxPolls?: number;
}) {
  const pollIntervalMs = Math.max(2500, input.pollIntervalMs ?? 4000);
  const maxPolls = Math.max(10, input.maxPolls ?? 120);
  for (let index = 0; index < maxPolls; index += 1) {
    if (input.abortSignal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    const state = await queryBanana2ImageTask(input.taskId);
    if (state.status === "completed" || state.status === "failed") {
      return state;
    }
    input.onProgress?.(state);
    await new Promise<void>((resolve, reject) => {
      if (input.abortSignal?.aborted) {
        reject(new DOMException("The operation was aborted.", "AbortError"));
        return;
      }
      const timer = setTimeout(resolve, pollIntervalMs);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException("The operation was aborted.", "AbortError"));
      };
      input.abortSignal?.addEventListener("abort", onAbort, { once: true });
    });
  }
  throw new Error("香蕉生图任务等待超时。");
}

export async function downloadBanana2ImageToPath(imageUrl: string, targetPath: string) {
  const resp = await fetch(imageUrl, { cache: "no-store" });
  if (!resp.ok) {
    throw new Error(`香蕉生图下载失败：${resp.status}`);
  }
  const arr = await resp.arrayBuffer();
  await fs.writeFile(targetPath, Buffer.from(arr));
}
