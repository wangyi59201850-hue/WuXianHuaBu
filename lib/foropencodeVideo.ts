import fs from "fs/promises";
import os from "os";
import path from "path";
import { readExternalVideoApiConfig } from "@/lib/externalVideoApiConfig";
import {
  clampVideoDurationForModel,
  normalizeVideoRatioForModel,
  normalizeVideoResolutionForModel,
} from "@/lib/cliVideoModels";

const DEFAULT_TASK_BASE_URL = "https://grok2api.mengjun.bond/v1/tasks";

export type ForopencodeVideoTaskState =
  | {
      taskId: string;
      status: "pending" | "running";
      progressPct: number | null;
      rawStatus: string;
      videoUrl: null;
      failReason: null;
    }
  | {
      taskId: string;
      status: "completed";
      progressPct: 100;
      rawStatus: string;
      videoUrl: string;
      failReason: null;
    }
  | {
      taskId: string;
      status: "failed";
      progressPct: number | null;
      rawStatus: string;
      videoUrl: null;
      failReason: string;
    };

type ChatCompletionResponse = {
  id?: string;
  task_id?: string;
  taskId?: string;
  submit_id?: string;
  submitId?: string;
  task_url?: string;
  taskUrl?: string;
  url?: string;
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  error?: {
    message?: string;
  };
};

function normalizeAssistantContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
      return "";
    })
    .join("")
    .trim();
}

function taskBaseUrl() {
  return process.env.FOROPENCODE_GROK_TASK_BASE_URL?.trim() || DEFAULT_TASK_BASE_URL;
}

function deriveTaskIdFromUrl(taskUrl: string | null | undefined) {
  if (typeof taskUrl !== "string" || !taskUrl.trim()) return null;
  try {
    const url = new URL(taskUrl.trim());
    const last = url.pathname.split("/").filter(Boolean).pop()?.trim() || "";
    return /^[a-z0-9_-]{6,}$/i.test(last) ? last : null;
  } catch {
    const last = taskUrl.trim().split("/").filter(Boolean).pop()?.trim() || "";
    return /^[a-z0-9_-]{6,}$/i.test(last) ? last : null;
  }
}

function taskUrlForId(taskId: string, taskUrl?: string | null) {
  if (typeof taskUrl === "string" && taskUrl.trim()) return taskUrl.trim();
  return `${taskBaseUrl().replace(/\/+$/, "")}/${encodeURIComponent(taskId)}`;
}

function parseTaskIdFromText(text: string) {
  const direct = text.match(
    /(?:任务ID|task(?:[\s_-]*id)?|submit(?:[\s_-]*id)?)[:：=]?\s*["']?([a-z0-9_-]{6,})/i
  )?.[1];
  if (direct) return direct.trim();
  const fromUrl = text.match(/\/(?:v1\/)?tasks\/([a-z0-9_-]{6,})/i)?.[1];
  if (fromUrl) return fromUrl.trim();
  return null;
}

function parseTaskUrlFromText(text: string) {
  return (
    text.match(/https?:\/\/[^\s"'<>]+\/(?:v1\/)?tasks\/[a-z0-9_-]{6,}(?:[^\s"'<>]*)/i)?.[0]?.trim() ||
    null
  );
}

function parseTaskIdFromAnyText(text: string) {
  return (
    parseTaskIdFromText(text) ||
    text.match(/(?:任务ID|task(?:[\s_-]*id)?|submit(?:[\s_-]*id)?|request(?:[\s_-]*id)?|id)[:：=\s"']+([a-z0-9][a-z0-9_.:-]{5,})/i)?.[1]?.trim() ||
    text.match(/["'](?:task_id|taskId|submit_id|submitId|request_id|requestId|id)["']\s*:\s*["']([^"']{6,})["']/i)?.[1]?.trim() ||
    null
  );
}

function parseTaskUrlFromAnyText(text: string) {
  return (
    parseTaskUrlFromText(text) ||
    text.match(/["'](?:task_url|taskUrl|url|location)["']\s*:\s*["'](https?:\/\/[^"']+)["']/i)?.[1]?.trim() ||
    null
  );
}

function tryParseJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    /* continue */
  }
  for (const line of trimmed.split(/\r?\n/)) {
    const t = line.trim().replace(/^data:\s*/i, "");
    if (!t || t === "[DONE]") continue;
    try {
      return JSON.parse(t);
    } catch {
      /* continue */
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      /* continue */
    }
  }
  return null;
}

async function writeForopencodeDebug(label: string, payload: Record<string, unknown>) {
  try {
    const file = path.join(os.tmpdir(), "jimengpro-foropencode-video-debug.log");
    await fs.appendFile(
      file,
      JSON.stringify({ at: new Date().toISOString(), label, ...payload }) + "\n",
      "utf8"
    );
  } catch {
    /* ignore */
  }
}

function parseTaskIdFromChatId(chatId: string | undefined) {
  if (!chatId) return null;
  const trimmed = chatId.trim();
  if (!trimmed.toLowerCase().startsWith("chatcmpl-")) return null;
  const candidate = trimmed.slice("chatcmpl-".length).trim();
  return /^[a-z0-9_-]{8,}$/i.test(candidate) ? candidate : null;
}

function pickTaskMetaFromObject(input: unknown): { taskId: string | null; taskUrl: string | null } {
  const seen = new Set<unknown>();
  const stack: unknown[] = [input];
  let taskId: string | null = null;
  let taskUrl: string | null = null;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    for (const [rawKey, rawValue] of Object.entries(current as Record<string, unknown>)) {
      const key = rawKey.trim().toLowerCase();
      if (typeof rawValue === "string") {
        const value = rawValue.trim();
        if (!taskUrl && (key.includes("task") || key === "url" || key === "location")) {
          taskUrl = parseTaskUrlFromText(value) || (/^https?:\/\//i.test(value) ? value : null);
        }
        if (
          !taskId &&
          (key.includes("task") || key.includes("submit") || key === "id" || key.endsWith("_id"))
        ) {
          taskId =
            parseTaskIdFromText(value) ||
            deriveTaskIdFromUrl(value) ||
            (/^[a-z0-9_-]{6,}$/i.test(value) ? value : null);
        }
      } else if (rawValue && typeof rawValue === "object") {
        stack.push(rawValue);
      }
    }
  }

  if (!taskId && taskUrl) taskId = deriveTaskIdFromUrl(taskUrl);
  return { taskId, taskUrl };
}

function normalizeProgressPct(raw: unknown) {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.min(100, Math.max(0, Math.round(raw)));
  }
  if (typeof raw === "string") {
    const match = raw.trim().match(/(\d{1,3})(?:\.\d+)?%?/);
    if (match) {
      const num = Number(match[1]);
      if (Number.isFinite(num)) return Math.min(100, Math.max(0, Math.round(num)));
    }
  }
  return null;
}

function statusKindFromRaw(rawStatus: string, videoUrl: string | null, failReason: string | null) {
  const status = rawStatus.trim().toLowerCase();
  if (videoUrl || status === "completed" || status === "success" || status === "succeeded") {
    return "completed" as const;
  }
  if (
    failReason ||
    status === "failed" ||
    status === "error" ||
    status === "cancelled" ||
    status === "canceled" ||
    status === "expired"
  ) {
    return "failed" as const;
  }
  if (status === "queued" || status === "queue" || status === "pending" || status === "submitted") {
    return "pending" as const;
  }
  return "running" as const;
}

async function readForopencodeProvider() {
  const provider = await readExternalVideoApiConfig();
  if (!provider.baseUrl.trim()) {
    throw new Error("ForOpenCode base URL is not configured.");
  }
  if (!provider.apiKey.trim()) {
    throw new Error("ForOpenCode API key is not configured.");
  }
  return provider;
}

export function buildForopencodeVideoPrompt(input: {
  prompt: string;
  model: string;
  ratio: string;
  resolutionType: string;
  durationSeconds?: number;
  referenceMode?: "general" | "headtail";
  referenceImageCount?: number;
}) {
  const ratio = normalizeVideoRatioForModel(input.model, input.ratio);
  const resolutionType = normalizeVideoResolutionForModel(input.model, input.resolutionType);
  const durationSeconds = clampVideoDurationForModel(input.model, input.durationSeconds);
  const prompt = input.prompt.trim();
  const technicalBlock = [
    "Technical requirements:",
    `- Duration: ${durationSeconds} seconds`,
    `- Aspect ratio: ${ratio}`,
    `- Resolution: ${resolutionType.toUpperCase()}`,
    ...(typeof input.referenceImageCount === "number" && input.referenceImageCount > 0
      ? input.referenceMode === "headtail"
        ? [
            `- Reference images: ${input.referenceImageCount}`,
            "- Treat image 1 as the opening frame and image 2 as the ending frame.",
          ]
        : [`- Reference images: ${input.referenceImageCount}`]
      : []),
  ].join("\n");
  return `${prompt}\n\n${technicalBlock}`.trim();
}

export async function submitForopencodeVideoTask(input: {
  prompt: string;
  model: string;
  ratio: string;
  resolutionType: string;
  durationSeconds?: number;
  referenceMode?: "general" | "headtail";
  imageDataUrls?: string[];
}) {
  const provider = await readForopencodeProvider();
  const imageDataUrls = Array.isArray(input.imageDataUrls)
    ? input.imageDataUrls
        .map((url) => (typeof url === "string" ? url.trim() : ""))
        .filter((url): url is string => Boolean(url))
    : [];
  const userContent =
    imageDataUrls.length > 0
      ? [
          {
            type: "text" as const,
            text: buildForopencodeVideoPrompt({
              ...input,
              referenceImageCount: imageDataUrls.length,
            }),
          },
          ...imageDataUrls.map((url) => ({
            type: "image_url" as const,
            image_url: { url },
          })),
        ]
      : buildForopencodeVideoPrompt(input);
  const body = {
    model: input.model.trim() || provider.model.trim(),
    messages: [
      {
        role: "user",
        content: userContent,
      },
    ],
  };

  const resp = await fetch(`${provider.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const rawText = await resp.text().catch(() => "");
  const parsedJson = tryParseJsonFromText(rawText);
  const json =
    parsedJson && typeof parsedJson === "object" ? (parsedJson as ChatCompletionResponse) : null;
  const headerEntries = Array.from(resp.headers.entries());
  const headerText = headerEntries.map(([key, value]) => `${key}: ${value}`).join("\n");

  if (!resp.ok) {
    const message =
      json?.error?.message ||
      rawText.trim() ||
      `ForOpenCode video request failed with status ${resp.status}`;
    throw new Error(message);
  }
  if (json?.error?.message) {
    throw new Error(json.error.message);
  }

  const content = normalizeAssistantContent(json?.choices?.[0]?.message?.content) || rawText.trim();
  const headerTaskUrl =
    resp.headers.get("x-task-url")?.trim() ||
    resp.headers.get("x-upstream-task-url")?.trim() ||
    resp.headers.get("task-url")?.trim() ||
    resp.headers.get("upstream-task-url")?.trim() ||
    resp.headers.get("location")?.trim() ||
    null;
  const headerTaskId =
    resp.headers.get("x-task-id")?.trim() ||
    resp.headers.get("x-upstream-task-id")?.trim() ||
    resp.headers.get("task-id")?.trim() ||
    resp.headers.get("upstream-task-id")?.trim() ||
    resp.headers.get("x-submit-id")?.trim() ||
    resp.headers.get("submit-id")?.trim() ||
    resp.headers.get("x-request-id")?.trim() ||
    resp.headers.get("request-id")?.trim() ||
    null;
  const objectTaskMeta = pickTaskMetaFromObject(parsedJson);
  const taskUrl =
    headerTaskUrl ||
    objectTaskMeta.taskUrl ||
    parseTaskUrlFromAnyText(content) ||
    parseTaskUrlFromAnyText(rawText) ||
    parseTaskUrlFromAnyText(headerText);
  const taskId =
    headerTaskId ||
    objectTaskMeta.taskId ||
    parseTaskIdFromAnyText(content) ||
    parseTaskIdFromAnyText(rawText) ||
    parseTaskIdFromAnyText(headerText) ||
    deriveTaskIdFromUrl(taskUrl) ||
    parseTaskIdFromChatId(json?.id);
  if (!taskId) {
    const debugPayload = json ? JSON.stringify(json).slice(0, 1200) : "";
    void writeForopencodeDebug("missing-task-id", {
      status: resp.status,
      statusText: resp.statusText,
      headers: Object.fromEntries(headerEntries),
      content: content.slice(0, 4000),
      rawText: rawText.slice(0, 4000),
      json: debugPayload,
    });
    console.error("[foropencodeVideo] missing task id", {
      headerTaskId,
      headerTaskUrl,
      content,
      rawText: rawText.slice(0, 1200),
      json: debugPayload,
    });
    throw new Error(
      content
        ? `ForOpenCode video task id was not found. Response: ${content}${debugPayload ? ` | JSON: ${debugPayload}` : ""}`
        : `ForOpenCode video task id was not found.${rawText ? ` Response: ${rawText.slice(0, 1200)}` : ""}${debugPayload ? ` JSON: ${debugPayload}` : ""}`
    );
  }

  return {
    taskId,
    taskUrl,
    responseText: content,
  };
}

export async function queryForopencodeVideoTask(
  taskId: string,
  taskUrl?: string | null
): Promise<ForopencodeVideoTaskState> {
  const provider = await readForopencodeProvider();
  const resp = await fetch(taskUrlForId(taskId, taskUrl), {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    cache: "no-store",
  });

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => "");
    console.error("[foropencodeVideo] task query failed", {
      taskId,
      taskUrl: taskUrlForId(taskId, taskUrl),
      status: resp.status,
      body: errorText.slice(0, 1200),
    });
    throw new Error(`ForOpenCode task query failed with status ${resp.status}`);
  }

  const json = (await resp.json()) as {
    status?: string;
    progress?: string | number;
    video_url?: string;
    fail_reason?: string;
    remark?: string;
    error?: string;
  };

  const rawStatus = typeof json.status === "string" && json.status.trim() ? json.status.trim() : "pending";
  const videoUrl =
    typeof json.video_url === "string" && json.video_url.trim() ? json.video_url.trim() : null;
  const failReason =
    typeof json.fail_reason === "string" && json.fail_reason.trim()
      ? json.fail_reason.trim()
      : typeof json.error === "string" && json.error.trim()
        ? json.error.trim()
        : typeof json.remark === "string" && json.remark.trim()
          ? json.remark.trim()
          : null;
  const progressPct =
    statusKindFromRaw(rawStatus, videoUrl, failReason) === "completed"
      ? 100
      : normalizeProgressPct(json.progress);
  const status = statusKindFromRaw(rawStatus, videoUrl, failReason);

  if (status === "completed") {
    if (!videoUrl) {
      throw new Error("ForOpenCode task completed without a video URL.");
    }
    return {
      taskId,
      status,
      progressPct: 100,
      rawStatus,
      videoUrl,
      failReason: null,
    };
  }

  if (status === "failed") {
    return {
      taskId,
      status,
      progressPct,
      rawStatus,
      videoUrl: null,
      failReason: failReason || "ForOpenCode video generation failed.",
    };
  }

  return {
    taskId,
    status,
    progressPct,
    rawStatus,
    videoUrl: null,
    failReason: null,
  };
}

export async function waitForopencodeVideoTask(input: {
  taskId: string;
  taskUrl?: string | null;
  abortSignal?: AbortSignal;
  onProgress?: (state: Extract<ForopencodeVideoTaskState, { status: "pending" | "running" }>) => void;
  pollIntervalMs?: number;
  maxPolls?: number;
}) {
  const pollIntervalMs = Math.max(1500, input.pollIntervalMs ?? 3500);
  const maxPolls = Math.max(10, input.maxPolls ?? 120);

  for (let pollIndex = 0; pollIndex < maxPolls; pollIndex += 1) {
    if (input.abortSignal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    const state = await queryForopencodeVideoTask(input.taskId, input.taskUrl);
    if (state.status === "completed" || state.status === "failed") {
      return state;
    }
    input.onProgress?.(state);
    await new Promise<void>((resolve, reject) => {
      if (input.abortSignal?.aborted) {
        reject(new DOMException("The operation was aborted.", "AbortError"));
        return;
      }
      let settled = false;
      const cleanup = () => input.abortSignal?.removeEventListener("abort", onAbort);
      const timer = setTimeout(() => {
        settled = true;
        cleanup();
        resolve();
      }, pollIntervalMs);
      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        reject(new DOMException("The operation was aborted.", "AbortError"));
      };
      input.abortSignal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  throw new Error("ForOpenCode video generation timed out.");
}

export async function downloadForopencodeVideoToPath(videoUrl: string, targetPath: string) {
  const resp = await fetch(videoUrl, { cache: "no-store" });
  if (!resp.ok) {
    throw new Error(`Failed to download ForOpenCode video: ${resp.status}`);
  }
  const arr = await resp.arrayBuffer();
  await fs.writeFile(targetPath, Buffer.from(arr));
}
