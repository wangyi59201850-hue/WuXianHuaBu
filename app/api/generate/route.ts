import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { findNewestMediaUnderDir } from "@/lib/scanGeneratedMedia";
import { unlinkCliArtifactAfterCopy } from "@/lib/unlinkCliArtifactAfterCopy";
import { generateAiwanwuImage, generateAiwanwuImageEdit, resolveAiwanwuImageSize } from "@/lib/aiwanwu";
import {
  clampVideoDurationForModel,
  canonicalizeVideoModelValue,
  getVideoModelMaxCount,
  isForopencodeVideoModel,
  mapUiVideoModelToCliModelVersion,
  normalizeVideoRatioForModel,
  normalizeVideoResolutionForModel,
  toExternalVideoSubmitId,
} from "@/lib/cliVideoModels";
import {
  queryBanana2ImageTask,
  submitBanana2ImageTask,
  toBanana2SubmitId,
} from "@/lib/banana2Image";
import {
  downloadForopencodeVideoToPath,
  submitForopencodeVideoTask,
  waitForopencodeVideoTask,
} from "@/lib/foropencodeVideo";
import {
  isExternalImageApiProviderId,
  defaultExternalImageModelForProvider,
  supportsExternalImageEditEndpoint,
  type ExternalImageApiProviderId,
} from "@/lib/externalImageApiShared";
import { readExternalImageApiConfig } from "@/lib/externalImageApiConfig";
import { resolveGeneratedDir, toGeneratedUrl } from "@/lib/generatedDir";
import { getProtectedMediaRefs } from "@/lib/protectedMedia";
import { resolveConfiguredExternalImageTaskCost } from "@/lib/externalImageTaskCost";
import {
  snapshotGeneratedOutputForTask,
  upsertGenerationTask,
} from "@/lib/generationTaskLedger";
import { isCloudDeployment, isRemoteMediaUrl } from "@/lib/cloudDeployment";

export const runtime = "nodejs";

type GenerateRequest = {
  prompt: string;
  nodeId: string;
  provider?: "dreamina" | "aiwanwu";
  modelVersion?: string;
  ratio?: string;
  resolutionType?: string;
  count?: number;
  mode?: "image" | "video";
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_CONCURRENT_IMAGE_GENERATIONS = 4;

function outputFileNameFromRef(raw: string) {
  const text = raw.trim();
  if (!text) return "media";
  if (/^data:image\//i.test(text)) return "inline-image.png";
  if (/^data:video\//i.test(text)) return "inline-video";
  if (isRemoteMediaUrl(text)) {
    try {
      const url = new URL(text);
      const base = path.posix.basename(url.pathname);
      return base || "remote-media";
    } catch {
      return "remote-media";
    }
  }
  return path.posix.basename(text.replace(/\\/g, "/")) || "media";
}

async function recordCompletedGenerationTask(input: {
  submitId: string;
  sourceNodeId: string;
  index: number;
  mediaType: "image" | "video";
  fileName: string;
}) {
  const snap = await snapshotGeneratedOutputForTask({
    submitId: input.submitId,
    outputRelPath: input.fileName,
  }).catch(() => null);
  await upsertGenerationTask({
    submitId: input.submitId,
    sourceNodeId: input.sourceNodeId,
    index: input.index,
    mediaType: input.mediaType,
    status: "completed",
    outputUrl: snap?.outputUrl ?? toGeneratedUrl(input.fileName),
    fileName: snap?.fileName ?? outputFileNameFromRef(input.fileName),
  });
}

async function runIndexedTaskPool<T>(options: {
  total: number;
  concurrency?: number;
  worker: (index: number) => Promise<T>;
  onResolved?: (value: T, index: number) => void | Promise<void>;
}) {
  const total = Math.max(0, options.total);
  if (total === 0) return [] as T[];
  const concurrency = Math.max(
    1,
    Math.min(total, options.concurrency ?? MAX_CONCURRENT_IMAGE_GENERATIONS)
  );
  const results = new Array<T>(total);
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= total) return;
      const value = await options.worker(index);
      results[index] = value;
      await options.onResolved?.(value, index);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
  return results;
}

function sanitizeNodeId(nodeId: string) {
  return nodeId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function makeExternalImageTaskId(safeNodeId: string, index: number) {
  return `api_${safeNodeId}_${Date.now()}_${index}_${crypto.randomBytes(3).toString("hex")}`;
}

function normalizeUsageForTask(
  usage: { total_tokens?: number; input_tokens?: number; output_tokens?: number; cost?: number; currency?: string } | null | undefined
) {
  if (!usage) return undefined;
  const normalized = {
    total_tokens: typeof usage.total_tokens === "number" ? usage.total_tokens : undefined,
    input_tokens: typeof usage.input_tokens === "number" ? usage.input_tokens : undefined,
    output_tokens: typeof usage.output_tokens === "number" ? usage.output_tokens : undefined,
    cost: typeof usage.cost === "number" ? usage.cost : undefined,
    currency: typeof usage.currency === "string" && usage.currency.trim() ? usage.currency.trim() : undefined,
  };
  return Object.values(normalized).some((value) => value !== undefined) ? normalized : undefined;
}

function resolveCliBin() {
  const fromEnv = process.env.JIMENG_CLI_BIN?.trim();
  if (fromEnv) return fromEnv;

  if (process.platform === "win32") {
    // 常见安装位置：~\bin\dreamina.exe（即梦 CLI 脚本安装日志里提示的目录）
    const candidate = path.join(os.homedir(), "bin", "dreamina.exe");
    return candidate;
  }

  return "dreamina";
}

async function fileExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** dreamina text2video / multimodal2video 支持的宽高比（CLI --help） */
const TEXT2VIDEO_RATIOS = new Set(["1:1", "3:4", "16:9", "4:3", "9:16", "21:9"]);

/** `dreamina text2video -h` / `multimodal2video -h` 列出的 model_version */
const TEXT2VIDEO_MODELS = new Set([
  "seedance2.0",
  "seedance2.0fast",
  "seedance2.0_vip",
  "seedance2.0fast_vip",
]);

/** `dreamina image2video -h` 列出的 model_version（下划线形式在入参前已由 canonicalize 归一） */
const IMAGE2VIDEO_MODELS = new Set([
  "3.0",
  "3.0fast",
  "3.0pro",
  "3.5pro",
  "seedance2.0",
  "seedance2.0fast",
  "seedance2.0_vip",
  "seedance2.0fast_vip",
]);

function normalizeRatioForText2Video(ratio: string) {
  const r = ratio.trim();
  return TEXT2VIDEO_RATIOS.has(r) ? r : "16:9";
}

/** 将画布 id 映射为当前 CLI 接受的 model_version（含 seedance1.x → 3.x） */
function normalizeVideoModelVersion(raw: string, hasReferenceImages: boolean) {
  const ui = canonicalizeVideoModelValue(raw);
  let v = mapUiVideoModelToCliModelVersion(ui);
  const legacy: Record<string, string> = {
    "wan-2.6": "3.0fast",
    "wan-2.2": "3.0fast",
    "wan-2": "3.0fast",
    "hailuo-02": "3.0fast",
  };
  v = legacy[v] ?? legacy[v.toLowerCase()] ?? v;
  if (!hasReferenceImages) {
    if (TEXT2VIDEO_MODELS.has(v)) return v;
    return "seedance2.0fast";
  }
  if (IMAGE2VIDEO_MODELS.has(v)) return v;
  if (TEXT2VIDEO_MODELS.has(v)) return v;
  return "3.0fast";
}

/** 返回传给 CLI 的 --video_resolution（小写 720p / 1080p） */
/** 文生 / 多模态视频：CLI 4–15s */
function clampDurationText2Multimodal(requested: number | undefined): number {
  const def = Number(process.env.JIMENG_VIDEO_DURATION_SEC?.trim() || "5") || 5;
  const r = Number.isFinite(requested) ? Number(requested) : def;
  return Math.min(15, Math.max(4, r));
}

/** 图生视频：按 model_version 与 CLI 说明钳制 */
function clampDurationImage2Video(modelVersion: string, requested: number | undefined): number {
  const def = Number(process.env.JIMENG_VIDEO_DURATION_SEC?.trim() || "5") || 5;
  const r = Number.isFinite(requested) ? Number(requested) : def;
  const mv = modelVersion.trim().toLowerCase();
  if (mv.startsWith("seedance")) return Math.min(15, Math.max(4, r));
  if (mv.startsWith("3.5")) return Math.min(12, Math.max(4, r));
  return Math.min(10, Math.max(3, r));
}

/** 双图首尾帧 multiframe2video：CLI 2–8s */
function clampDurationMultiframe(requested: number | undefined): number {
  const def = Number(process.env.JIMENG_MULTIFRAME_DURATION?.trim() || "3") || 3;
  const r = Number.isFinite(requested) ? Number(requested) : def;
  return Math.min(8, Math.max(2, r));
}

/** 去掉画布侧已写的英/中标记，避免与 withAudio 重复拼接 */
function stripClientVideoPromptTags(raw: string): string {
  return raw
    .replace(/\s*\[audio:(on|off)\]/gi, "")
    .replace(/\s*\[音频:[^\]]+\]/g, "")
    .replace(/\s*\[duration:\s*\d+s\]/gi, "")
    .replace(/\s*\[时长:\s*\d+秒\]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * text2video / image2video：与 multimodal 一致使用英文 [audio:on|off]。
 * 中文 [音频:开/关] 在部分接口上与 multimodal 相同会导致任务不落库、官网无记录。
 */
function augmentVideoPromptForCli(prompt: string, withAudio: boolean | undefined): string {
  const p = stripClientVideoPromptTags(prompt).trim();
  if (withAudio === true) return `${p} [audio:on]`.trim();
  if (withAudio === false) return `${p} [audio:off]`.trim();
  return p;
}

/** multimodal2video：支持 seedance2.0 / seedance2.0fast 及 VIP 通道 */
function modelVersionForMultimodalCli(
  modelVersion: string
): "seedance2.0" | "seedance2.0fast" | "seedance2.0_vip" | "seedance2.0fast_vip" {
  const v = normalizeVideoModelVersion(modelVersion, true);
  if (v === "seedance2.0fast_vip") return "seedance2.0fast_vip";
  if (v === "seedance2.0_vip") return "seedance2.0_vip";
  return v === "seedance2.0fast" ? "seedance2.0fast" : "seedance2.0";
}

/** multimodal2video 侧用英文 audio 标记（与 CLI 示例一致），避免中文标记导致任务未落库 */
function buildMultimodalCliPrompt(raw: string, withAudio: boolean | undefined): string {
  const p = stripClientVideoPromptTags(raw).trim();
  if (withAudio === true) return `${p} [audio:on]`.trim();
  if (withAudio === false) return `${p} [audio:off]`.trim();
  return p;
}

function throwIfDreaminaCliSubmitRejected(combined: string) {
  const t = combined;
  if (/AigcComplianceConfirmationRequired|合规|compliance.*confirm/i.test(t)) {
    throw new Error(
      "即梦要求先在网页端完成模型/内容安全授权（AigcComplianceConfirmationRequired）。请打开即梦网页完成确认后重试。\n" +
        clipText(t, 800)
    );
  }
}

function parseDurationSeconds(raw: unknown): number | undefined {
  const n = typeof raw === "string" ? Number(raw.trim()) : Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function parseWithAudioFlag(raw: unknown): boolean | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === "boolean") return raw;
  const s = String(raw).trim().toLowerCase();
  if (s === "1" || s === "true" || s === "on" || s === "yes" || s === "开") return true;
  if (s === "0" || s === "false" || s === "off" || s === "no" || s === "关") return false;
  return undefined;
}

function extractAiwanwuImagePromptDirectives(rawPrompt: string) {
  let wantsTransparentBackground = false;
  const prompt = rawPrompt
    .replace(/(?:^|\r?\n)\s*background\s*:\s*transparent\s*(?=$|\r?\n)/gi, (match) => {
      wantsTransparentBackground = true;
      return match.startsWith("\n") || match.startsWith("\r") ? "\n" : "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return {
    prompt,
    imageFormat: wantsTransparentBackground ? ("png" as const) : undefined,
  };
}

function normalizeVideoResolutionForCli(modelVersion: string, requested: string) {
  const m = modelVersion.trim().toLowerCase();
  const r = requested.trim().toLowerCase();
  const wants1080 = r === "1080p" || r === "4k" || r === "2k";
  /** Seedance 2.0 系（含 fast / vip）CLI 侧均为 720p */
  if (m.startsWith("seedance2.0")) return "720p";
  if (m === "3.0pro" || m === "3.0_pro") return "1080p";
  if (wants1080 && (m === "3.0" || m === "3.0fast" || m === "3.0_fast" || m === "3.5pro" || m === "3.5_pro")) {
    return "1080p";
  }
  if (m === "3.0" || m === "3.0fast" || m === "3.0_fast" || m === "3.5pro" || m === "3.5_pro") {
    return r === "1080p" ? "1080p" : "720p";
  }
  return "720p";
}

function extractSubmitId(text: string) {
  // 兜底：匹配 submit_id / submitId / submit-id
  const patterns = [
    /submit[_-]?id["']?\s*[:=]\s*["']?([a-zA-Z0-9_-]+)/i,
    /submitId["']?\s*[:=]\s*["']?([a-zA-Z0-9_-]+)/i,
    /"submit_id"\s*:\s*"([^"]+)"/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

async function runCli(bin: string, args: string[], timeoutMs: number) {
  return await new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    const child = spawn(bin, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      cwd:
        process.env.JIMENG_CLI_CWD?.trim() ||
        process.env.JIMENG_APP_ROOT?.trim() ||
        process.cwd(),
    });

    let stdout = "";
    let stderr = "";

    const t = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
    }, timeoutMs);

    child.stdout?.on("data", (d) => (stdout += d.toString("utf8")));
    child.stderr?.on("data", (d) => (stderr += d.toString("utf8")));

    child.on("error", (err) => {
      clearTimeout(t);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code, stdout, stderr });
    });
  });
}

function clipText(input: string, max = 1200) {
  if (!input) return "";
  return input.length <= max ? input : `${input.slice(0, max)}...<truncated>`;
}

const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"];
const VIDEO_EXTS = [".mp4", ".webm", ".mov", ".mkv", ".m4v"];

function escapeReForPath(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function preserveProtectedOutputIfNeeded(
  outDir: string,
  fileName: string,
  bucket: string
) {
  if (isCloudDeployment()) return false;
  const refs = await getProtectedMediaRefs(fileName).catch(() => []);
  if (!Array.isArray(refs) || refs.length === 0) return false;
  const srcAbs = path.join(outDir, fileName);
  try {
    const st = await fs.stat(srcAbs);
    if (!st.isFile()) return false;
  } catch {
    return false;
  }
  const session = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const backupDir = path.join(outDir, ".backup", "protected-auto", bucket, session);
  await fs.mkdir(backupDir, { recursive: true });
  await fs.copyFile(srcAbs, path.join(backupDir, path.basename(fileName)));
  return true;
}

/** 仅删除某一序号上的成片（写入新文件前调用，避免整批生成一开始就删掉上一版） */
async function cleanOutputSlot(outDir: string, safeNodeId: string, index: number) {
  if (isCloudDeployment()) return;
  const entries = await fs.readdir(outDir, { withFileTypes: true });
  const stem = `${safeNodeId}_${index}.`;
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const name = ent.name;
    if (!name.startsWith(stem)) continue;
    const lower = name.toLowerCase();
    if (![...IMAGE_EXTS, ...VIDEO_EXTS].some((ext) => lower.endsWith(ext))) continue;
    await preserveProtectedOutputIfNeeded(outDir, name, safeNodeId).catch(() => {});
    await fs.rm(path.join(outDir, name), { force: true });
  }
}

/** 本批只生成 count 条时，删掉 sourceNodeId_{count} 及更大序号上的旧文件，避免 latest 扫到多余条 */
async function cleanOutputSlotsFromIndex(outDir: string, safeNodeId: string, fromIndex: number) {
  if (isCloudDeployment()) return;
  const entries = await fs.readdir(outDir, { withFileTypes: true });
  const re = new RegExp(`^${escapeReForPath(safeNodeId)}_(\\d+)\\.`, "i");
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const m = ent.name.match(re);
    if (!m) continue;
    const idx = Number(m[1]);
    if (!Number.isFinite(idx) || idx < fromIndex) continue;
    const lower = ent.name.toLowerCase();
    if (![...IMAGE_EXTS, ...VIDEO_EXTS].some((ext) => lower.endsWith(ext))) continue;
    const refs = await getProtectedMediaRefs(ent.name).catch(() => []);
    if (Array.isArray(refs) && refs.length > 0) continue;
    await fs.rm(path.join(outDir, ent.name), { force: true });
  }
}

function foropencodeRenderPhaseFromStatus(status: string) {
  const normalized = status.trim().toLowerCase();
  if (
    normalized === "queued" ||
    normalized === "queue" ||
    normalized === "pending" ||
    normalized === "submitted"
  ) {
    return "queue" as const;
  }
  if (
    normalized === "running" ||
    normalized === "processing" ||
    normalized === "loading" ||
    normalized === "rendering"
  ) {
    return "rendering" as const;
  }
  return "unknown" as const;
}

async function saveForopencodeVideoToOutput(options: {
  outDir: string;
  safeNodeId: string;
  index: number;
  videoUrl: string;
}) {
  if (isCloudDeployment()) {
    return options.videoUrl.trim();
  }
  const targetPath = path.join(options.outDir, `${options.safeNodeId}_${options.index}.mp4`);
  await cleanOutputSlot(options.outDir, options.safeNodeId, options.index);
  await downloadForopencodeVideoToPath(options.videoUrl, targetPath);
  return path.basename(targetPath);
}

async function fileToDataUrl(file: File) {
  const mime = typeof file.type === "string" && file.type.trim() ? file.type.trim() : "image/png";
  const arr = await file.arrayBuffer();
  return `data:${mime};base64,${Buffer.from(arr).toString("base64")}`;
}

async function runForopencodeText2Video(options: {
  prompt: string;
  nodeId: string;
  modelVersion: string;
  ratio: string;
  resolutionType: string;
  count: number;
  durationSeconds?: number;
  outDir: string;
  referenceMode?: "general" | "headtail";
  referenceImageFiles?: File[];
  abortSignal?: AbortSignal;
  onPollProgress?: (progress: {
    submitId: string;
    genStatus?: string;
    progressPct?: number | null;
    renderPhase?: "queue" | "rendering" | "unknown" | null;
  }) => void;
}) {
  const safeNodeId = sanitizeNodeId(options.nodeId.trim());
  const normalizedModel = canonicalizeVideoModelValue(options.modelVersion);
  const normalizedRatio = normalizeVideoRatioForModel(normalizedModel, options.ratio);
  const normalizedResolution = normalizeVideoResolutionForModel(
    normalizedModel,
    options.resolutionType
  );
  const safeDuration = clampVideoDurationForModel(normalizedModel, options.durationSeconds);
  const safeCount = Math.min(getVideoModelMaxCount(normalizedModel), Math.max(1, options.count));
  const referenceImageFiles = Array.isArray(options.referenceImageFiles)
    ? options.referenceImageFiles.filter((file) => file.type.startsWith("image/"))
    : [];
  const referenceImageDataUrls =
    referenceImageFiles.length > 0
      ? await Promise.all(referenceImageFiles.map((file) => fileToDataUrl(file)))
      : [];
  const urls: string[] = [];

  for (let index = 0; index < safeCount; index += 1) {
    const submitted = await submitForopencodeVideoTask({
      prompt: options.prompt,
      model: normalizedModel,
      ratio: normalizedRatio,
      resolutionType: normalizedResolution,
      durationSeconds: safeDuration,
      referenceMode: options.referenceMode,
      imageDataUrls: referenceImageDataUrls,
    });
    const submitId = toExternalVideoSubmitId({
      taskId: submitted.taskId,
      taskUrl: submitted.taskUrl,
    });
    await upsertGenerationTask({
      submitId,
      sourceNodeId: safeNodeId,
      index,
      mediaType: "video",
      provider: "external_video_api",
      upstreamId: submitted.taskId,
      upstreamTaskUrl: submitted.taskUrl ?? undefined,
      status: "submitted",
      promptText: options.prompt,
      modelVersion: normalizedModel,
      ratio: normalizedRatio,
      resolutionType: normalizedResolution,
      count: safeCount,
      durationSeconds: safeDuration,
      videoProvider: "external_api",
      referenceMode: options.referenceMode,
      events: [{ at: Date.now(), level: "info", message: `已提交到外部视频 API：${submitted.taskId}` }],
    });
    options.onPollProgress?.({
      submitId,
      genStatus: "submitted",
      progressPct: 0,
      renderPhase: "queue",
    });

    const done = await waitForopencodeVideoTask({
      taskId: submitted.taskId,
      taskUrl: submitted.taskUrl,
      abortSignal: options.abortSignal,
      onProgress: (state) => {
        options.onPollProgress?.({
          submitId,
          genStatus: state.rawStatus,
          progressPct: state.progressPct,
          renderPhase: foropencodeRenderPhaseFromStatus(state.rawStatus),
        });
      },
    });

    if (done.status === "failed") {
      await upsertGenerationTask({
        submitId,
        sourceNodeId: safeNodeId,
        index,
        mediaType: "video",
        status: "failed",
        failReason: done.failReason || "ForOpenCode video generation failed.",
        events: [
          {
            at: Date.now(),
            level: "error",
            message: "外部视频 API 失败",
            detail: done.failReason || "ForOpenCode video generation failed.",
          },
        ],
      });
      throw new Error(done.failReason || "ForOpenCode video generation failed.");
    }

    const fileName = await saveForopencodeVideoToOutput({
      outDir: options.outDir,
      safeNodeId,
      index,
      videoUrl: done.videoUrl,
    });
    await recordCompletedGenerationTask({
      submitId,
      sourceNodeId: safeNodeId,
      index,
      mediaType: "video",
      fileName,
    });
    urls.push(toGeneratedUrl(fileName));
  }

  if (safeCount > 0) {
    await cleanOutputSlotsFromIndex(options.outDir, safeNodeId, safeCount);
  }

  return urls;
}

function banana2SizeFromResolutionType(resolutionType: string) {
  const value = resolutionType.trim().toLowerCase();
  if (value === "1k") return "1K";
  if (value === "4k" || value === "gpt-4k") return "4K";
  return "2K";
}

async function waitBanana2ImageTaskWithBackgroundFallback(input: {
  taskId: string;
  abortSignal?: AbortSignal;
  onProgress?: (state: Awaited<ReturnType<typeof queryBanana2ImageTask>>) => void;
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
      return { state, backgroundSyncPending: false as const };
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
  return { state: null, backgroundSyncPending: true as const };
}

async function runBanana2Text2ImageBatch(options: {
  prompt: string;
  nodeId: string;
  ratio: string;
  resolutionType: string;
  count: number;
  outDir: string;
  onEachImage?: (url: string) => void;
  referenceImageFiles?: File[];
  referenceImageDataUrls?: string[];
  onTaskProgress?: (progress: {
    submitId: string;
    genStatus?: string;
    progressPct?: number | null;
    renderPhase?: "queue" | "rendering" | "unknown" | null;
  }) => void;
  abortSignal?: AbortSignal;
}) {
  const safeNodeId = sanitizeNodeId(options.nodeId.trim());
  const externalImageConfig = await readExternalImageApiConfig();
  const provider = externalImageConfig.providers.banana2;
  const explicitReferenceImageDataUrls = Array.isArray(options.referenceImageDataUrls)
    ? options.referenceImageDataUrls
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value): value is string => /^https?:\/\//i.test(value) || /^data:image\//i.test(value))
    : [];
  const normalizedReferenceImageFiles = Array.isArray(options.referenceImageFiles)
    ? options.referenceImageFiles.filter(
        (file): file is File => file instanceof File && file.size > 0
      )
    : [];
  const fileReferenceImageDataUrls =
    normalizedReferenceImageFiles.length > 0
      ? await Promise.all(
          normalizedReferenceImageFiles.map((file) => fileToDataUrl(file))
        )
      : [];
  const referenceImageDataUrls = Array.from(
    new Set([...explicitReferenceImageDataUrls, ...fileReferenceImageDataUrls])
  );
  const configuredPricing = resolveConfiguredExternalImageTaskCost({
    perGenerationCost: provider?.imageCostPerGeneration,
    currency: provider?.imageCostCurrency,
    count: 1,
  });
  const urls: string[] = [];
  let backgroundSyncPending = false;
  for (let index = 0; index < options.count; index += 1) {
    const submitted = await submitBanana2ImageTask({
      prompt: options.prompt,
      size: banana2SizeFromResolutionType(options.resolutionType),
      ratio: options.ratio,
      imageUrls: referenceImageDataUrls,
    });
    const submitId = toBanana2SubmitId(submitted.taskId);
    await upsertGenerationTask({
      submitId,
      sourceNodeId: safeNodeId,
      index,
      mediaType: "image",
      provider: "external_image_api",
      upstreamId: submitted.taskId,
      upstreamProviderId: "banana2",
      upstreamImageSize: banana2SizeFromResolutionType(options.resolutionType),
      promptText: options.prompt,
      ratio: options.ratio,
      resolutionType: options.resolutionType,
      count: options.count,
      status: "submitted",
      upstreamCost: submitted.cost ?? configuredPricing?.perImage,
      upstreamCostCurrency: provider?.imageCostCurrency ?? "$",
      upstreamCostSource:
        typeof submitted.cost === "number" ? "exact" : configuredPricing?.source,
      events: [
        {
          at: Date.now(),
          level: "info",
          message: `已提交香蕉生图任务：${submitted.taskId}`,
          detail: `请求 ${banana2SizeFromResolutionType(options.resolutionType)} · 比例 ${options.ratio}`,
        },
      ],
    });
    options.onTaskProgress?.({
      submitId,
      genStatus: "submitted",
      progressPct: 0,
      renderPhase: "queue",
    });
    const waitResult = await waitBanana2ImageTaskWithBackgroundFallback({
      taskId: submitted.taskId,
      abortSignal: options.abortSignal,
      onProgress: (state) =>
        options.onTaskProgress?.({
          submitId,
          genStatus: state.rawStatus,
          progressPct: state.progressPct ?? null,
          renderPhase: state.status === "pending" ? "queue" : "rendering",
        }),
    });
    if (waitResult.backgroundSyncPending) {
      backgroundSyncPending = true;
      await upsertGenerationTask({
        submitId,
        sourceNodeId: safeNodeId,
        index,
        mediaType: "image",
        status: "submitted",
        events: [
          {
            at: Date.now(),
            level: "info",
            message: "本地等待超时，转入后台继续同步",
            detail: `taskId=${submitted.taskId}`,
          },
        ],
      });
      options.onTaskProgress?.({
        submitId,
        genStatus: "submitted",
        progressPct: null,
        renderPhase: "rendering",
      });
      break;
    }
    const done = waitResult.state!;
    if (done.status === "failed") {
      await upsertGenerationTask({
        submitId,
        sourceNodeId: safeNodeId,
        index,
        mediaType: "image",
        status: "failed",
        failReason: done.failReason || "香蕉生图失败。",
        events: [
          {
            at: Date.now(),
            level: "error",
            message: "香蕉生图任务失败",
            detail: done.failReason || "香蕉生图失败。",
          },
        ],
      });
      throw new Error(done.failReason || "香蕉生图失败。");
    }
    const fileName = await saveAiwanwuImageToOutput({
      outDir: options.outDir,
      safeNodeId,
      index,
      image: { url: done.imageUrl },
    });
    const outputUrl = toGeneratedUrl(fileName);
    await recordCompletedGenerationTask({
      submitId,
      sourceNodeId: safeNodeId,
      index,
      mediaType: "image",
      fileName,
    });
    urls.push(outputUrl);
    options.onEachImage?.(outputUrl);
  }
  if (options.count > 0) {
    await cleanOutputSlotsFromIndex(options.outDir, safeNodeId, options.count);
  }
  return {
    imageUrls: urls,
    usage: undefined as undefined,
    backgroundSyncPending,
  };
}

function tryParseJson(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function aiwanwuImageSizeFromRatio(
  ratio: string,
  providerId?: ExternalImageApiProviderId,
  resolutionType?: string
) {
  const sizes: Record<string, string> = {
    "1:1": "1024x1024",
    "4:3": "1408x1056",
    "3:4": "1056x1408",
    "16:9": "1536x864",
    "9:16": "864x1536",
    "3:2": "1536x1024",
    "2:3": "1024x1536",
    "21:9": "1536x658",
    "7:1": "3808x544",
  };
  if (providerId === "google") {
    return resolveAiwanwuImageSize("nano-banana-2", ratio.trim(), resolutionType);
  }
  return sizes[ratio.trim()] ?? "1024x1024";
}

async function saveAiwanwuImageToOutput(options: {
  outDir: string;
  safeNodeId: string;
  index: number;
  image: { url?: string; b64_json?: string };
}) {
  if (isCloudDeployment()) {
    if (typeof options.image.url === "string" && options.image.url.trim()) {
      return options.image.url.trim();
    }
    if (typeof options.image.b64_json === "string" && options.image.b64_json.trim()) {
      return `data:image/png;base64,${options.image.b64_json.trim()}`;
    }
    throw new Error("aiwanwu did not return image data");
  }
  const targetPath = path.join(options.outDir, `${options.safeNodeId}_${options.index}.png`);
  await cleanOutputSlot(options.outDir, options.safeNodeId, options.index);
  if (typeof options.image.b64_json === "string" && options.image.b64_json.trim()) {
    const buf = Buffer.from(options.image.b64_json.trim(), "base64");
    await fs.writeFile(targetPath, buf);
    return path.basename(targetPath);
  }
  if (typeof options.image.url === "string" && options.image.url.trim()) {
    const resp = await fetch(options.image.url.trim(), { cache: "no-store" });
    if (!resp.ok) throw new Error(`Failed to download aiwanwu image: ${resp.status}`);
    const arr = await resp.arrayBuffer();
    await fs.writeFile(targetPath, Buffer.from(arr));
    return path.basename(targetPath);
  }
  throw new Error("aiwanwu did not return image data");
}

async function* iterateAiwanwuText2Image(options: {
  prompt: string;
  nodeId: string;
  modelVersion: string;
  ratio: string;
  count: number;
  outDir: string;
}) {
  const safeNodeId = sanitizeNodeId(options.nodeId.trim());
  for (let i = 0; i < options.count; i += 1) {
    const result = await generateAiwanwuImage({
      prompt: options.prompt,
      model: options.modelVersion,
      size: resolveAiwanwuImageSize(options.modelVersion, aiwanwuImageSizeFromRatio(options.ratio)),
    });
    const first = result.data?.[0];
    if (!first) {
      throw new Error("aiwanwu image generation returned no images");
    }
    const fileName = await saveAiwanwuImageToOutput({
      outDir: options.outDir,
      safeNodeId,
      index: i,
      image: first,
    });
    yield toGeneratedUrl(fileName);
  }
  if (options.count > 0) {
    await cleanOutputSlotsFromIndex(options.outDir, safeNodeId, options.count);
  }
}

async function runAiwanwuText2ImageBatch(options: {
  prompt: string;
  nodeId: string;
  modelVersion: string;
  ratio: string;
  resolutionType: string;
  count: number;
  outDir: string;
  onEachImage?: (url: string) => void;
  referenceImageFiles?: File[];
  referenceImageDataUrls?: string[];
  providerId?: ExternalImageApiProviderId;
  imageQuality?: "standard" | "high" | "hd";
  imageFormat?: "jpg" | "png";
  onTaskProgress?: (progress: {
    submitId: string;
    genStatus?: string;
    progressPct?: number | null;
    renderPhase?: "queue" | "rendering" | "unknown" | null;
  }) => void;
}) {
  const safeNodeId = sanitizeNodeId(options.nodeId.trim());
  const imageUrls: string[] = [];
  let totalTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const normalizedReferenceImageFiles = Array.isArray(options.referenceImageFiles)
    ? options.referenceImageFiles.filter(
        (file): file is File => file instanceof File && file.size > 0
      )
    : [];
  const explicitReferenceImageDataUrls = Array.isArray(options.referenceImageDataUrls)
    ? options.referenceImageDataUrls
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value): value is string => Boolean(value))
    : [];
  const fileReferenceImageDataUrls =
    normalizedReferenceImageFiles.length > 0
      ? await Promise.all(
          normalizedReferenceImageFiles.map((file) => fileToDataUrl(file))
        )
      : [];
  const referenceImageDataUrls = Array.from(
    new Set([...explicitReferenceImageDataUrls, ...fileReferenceImageDataUrls])
  );
  const externalImageConfig = await readExternalImageApiConfig();
  const resolvedProviderId =
    options.providerId && externalImageConfig.providers[options.providerId]
      ? options.providerId
      : externalImageConfig.activeProviderId;
  const resolvedProviderConfig = externalImageConfig.providers[resolvedProviderId];
  const requestedSize = resolveAiwanwuImageSize(
    options.modelVersion,
    aiwanwuImageSizeFromRatio(options.ratio, resolvedProviderId, options.resolutionType),
    options.resolutionType
  );
  const configuredPricing = resolveConfiguredExternalImageTaskCost({
    perGenerationCost: resolvedProviderConfig?.imageCostPerGeneration,
    currency: resolvedProviderConfig?.imageCostCurrency,
    count: 1,
  });

  const settled = await runIndexedTaskPool({
    total: options.count,
    concurrency: MAX_CONCURRENT_IMAGE_GENERATIONS,
    worker: async (index) => {
      const submitId = makeExternalImageTaskId(safeNodeId, index);
      await upsertGenerationTask({
        submitId,
        sourceNodeId: safeNodeId,
        index,
        mediaType: "image",
        provider: "external_image_api",
        upstreamProviderId: resolvedProviderId,
        upstreamImageSize: requestedSize,
        upstreamImageQuality: options.imageQuality,
        status: "submitted",
        promptText: options.prompt,
        modelVersion: options.modelVersion,
        ratio: options.ratio,
        count: options.count,
        events: [{ at: Date.now(), level: "info", message: "已提交到外部图片 API" }],
      });
      options.onTaskProgress?.({
        submitId,
        genStatus: "submitted",
        progressPct: 0,
        renderPhase: "queue",
      });
      const shouldUseEditEndpoint =
        referenceImageDataUrls.length > 0 &&
        explicitReferenceImageDataUrls.length === 0 &&
        normalizedReferenceImageFiles.length > 0 &&
        supportsExternalImageEditEndpoint(resolvedProviderId);
      try {
        await upsertGenerationTask({
          submitId,
          sourceNodeId: safeNodeId,
          index,
          mediaType: "image",
          status: "running",
          events: [{ at: Date.now(), level: "info", message: "外部图片 API 处理中" }],
        });
        options.onTaskProgress?.({
          submitId,
          genStatus: "processing",
          progressPct: 10,
          renderPhase: "rendering",
        });
        const result = shouldUseEditEndpoint
          ? await generateAiwanwuImageEdit({
              prompt: options.prompt,
              model: options.modelVersion,
              size: requestedSize,
              images: normalizedReferenceImageFiles,
              providerId: resolvedProviderId,
              quality: options.imageQuality,
              imageFormat: options.imageFormat,
            })
          : await generateAiwanwuImage({
              prompt: options.prompt,
              model: options.modelVersion,
              size: requestedSize,
              providerId: resolvedProviderId,
              quality: options.imageQuality,
              imageFormat: options.imageFormat,
              imageDataUrls:
                referenceImageDataUrls.length > 0
                  ? referenceImageDataUrls
                  : undefined,
            });
        const first = result.data?.[0];
        if (!first) {
          throw new Error("external image api returned no images");
        }
        const usage = normalizeUsageForTask(result.usage);
        await upsertGenerationTask({
          submitId,
          sourceNodeId: safeNodeId,
          index,
          mediaType: "image",
          status: "running",
          upstreamId: typeof result.id === "string" && result.id.trim() ? result.id.trim() : undefined,
          modelVersion: result.model || options.modelVersion,
          upstreamImageSize: requestedSize,
          upstreamImageQuality: options.imageQuality,
          usage,
          upstreamCost: configuredPricing?.amount,
          upstreamCostCurrency: configuredPricing?.currency,
          upstreamCostSource: configuredPricing?.source,
          events: [
            {
              at: Date.now(),
              level: "info",
              message: result.id ? `上游返回 ID：${result.id}` : "上游已返回结果",
            },
          ],
        });
        const fileName = await saveAiwanwuImageToOutput({
          outDir: options.outDir,
          safeNodeId,
          index,
          image: first,
        });
        await recordCompletedGenerationTask({
          submitId,
          sourceNodeId: safeNodeId,
          index,
          mediaType: "image",
          fileName,
        });
        await upsertGenerationTask({
          submitId,
          sourceNodeId: safeNodeId,
          index,
          mediaType: "image",
          status: "completed",
          events: [{ at: Date.now(), level: "info", message: "已保存生成结果" }],
        });
        return {
          index,
          url: toGeneratedUrl(fileName),
          upstreamId: result.id,
          usage: {
            total_tokens: result.usage?.total_tokens ?? 0,
            input_tokens:
              result.usage?.input_tokens ??
              (result.usage as { prompt_tokens?: number } | undefined)?.prompt_tokens ??
              0,
            output_tokens:
              result.usage?.output_tokens ??
              (result.usage as { completion_tokens?: number } | undefined)?.completion_tokens ??
              0,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await upsertGenerationTask({
          submitId,
          sourceNodeId: safeNodeId,
          index,
          mediaType: "image",
          status: "failed",
          failReason: message,
          events: [{ at: Date.now(), level: "error", message: "外部图片 API 失败", detail: clipText(message, 1200) }],
        });
        throw error;
      }
    },
    onResolved: ({ url }) => {
      options.onEachImage?.(url);
    },
  });

  for (const item of settled) {
    imageUrls.push(item.url);
    totalTokens += item.usage.total_tokens;
    inputTokens += item.usage.input_tokens;
    outputTokens += item.usage.output_tokens;
  }

  if (options.count > 0) {
    await cleanOutputSlotsFromIndex(options.outDir, safeNodeId, options.count);
  }

  return {
    imageUrls,
    usage: {
      total_tokens: totalTokens || undefined,
      input_tokens: inputTokens || undefined,
      output_tokens: outputTokens || undefined,
    },
  };
}

type QueryTaskPayload = {
  gen_status?: string;
  fail_reason?: string;
  queue_info?: {
    queue_idx?: number;
    queue_length?: number;
    queue_status?: string;
  };
};

export type DreaminaPollProgress = {
  submitId: string;
  genStatus?: string;
  queueLength?: number;
  queueIdx?: number;
  queueStatus?: string;
  waitedMs: number;
  /** 前方排队比例 0–100（由 queue_idx / queue_length 推算） */
  queueRemainPct?: number | null;
  renderPhase?: "queue" | "rendering" | "unknown";
};

function computeQueueRemainPctFromQi(qi: QueryTaskPayload["queue_info"]): number | null {
  if (
    !qi ||
    typeof qi.queue_idx !== "number" ||
    typeof qi.queue_length !== "number" ||
    qi.queue_length <= 0
  ) {
    return null;
  }
  return Math.min(100, Math.max(0, Math.round(((qi.queue_idx - 1) / qi.queue_length) * 100)));
}

function inferRenderPhase(
  payload: QueryTaskPayload,
  queueRemainPct: number | null
): "queue" | "rendering" | "unknown" {
  const raw = String(payload.gen_status || "").trim();
  const st = raw.toLowerCase();
  if (st.includes("run") || st === "processing" || st === "loading") return "rendering";

  const qi = payload.queue_info;
  const atQueueFront =
    qi &&
    typeof qi.queue_idx === "number" &&
    typeof qi.queue_length === "number" &&
    qi.queue_length > 0 &&
    qi.queue_idx <= 1;

  /** queue_remain 缺失但已在队首：与网页「开始渲染」对齐，避免客户端一直显示排队 */
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

/** 从 dreamina query_result 的 stdout/stderr 中解析 JSON（可能夹杂日志行） */
function extractQueryResultPayload(stdout: string, stderr: string): QueryTaskPayload | null {
  const combined = `${stdout}\n${stderr}`;
  const trimmed = combined.trim();
  const direct = tryParseJson(trimmed);
  if (direct && typeof direct === "object" && typeof (direct as QueryTaskPayload).gen_status === "string") {
    return direct as QueryTaskPayload;
  }
  for (const line of combined.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    const j = tryParseJson(t);
    if (j && typeof j === "object" && typeof (j as QueryTaskPayload).gen_status === "string") {
      return j as QueryTaskPayload;
    }
  }
  const brace = combined.indexOf("{");
  if (brace >= 0) {
    const j = tryParseJson(combined.slice(brace));
    if (j && typeof j === "object" && typeof (j as QueryTaskPayload).gen_status === "string") {
      return j as QueryTaskPayload;
    }
  }
  return null;
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

/** 与官网取消/失败等状态对齐：非 success 且非进行中 → 立即停止轮询 */
function throwIfTerminalDreaminaTask(payload: QueryTaskPayload | null) {
  if (!payload?.gen_status || !String(payload.gen_status).trim()) return;
  const raw = payload.gen_status.trim();
  const s = raw.toLowerCase();
  if (s === "success") return;
  if (isOngoingGenStatus(raw)) return;
  const reason =
    typeof payload.fail_reason === "string" && payload.fail_reason.trim()
      ? payload.fail_reason.trim()
      : raw;
  throw new Error(`即梦任务已结束（${raw}）${reason && reason !== raw ? `：${reason}` : ""}`);
}

async function pollDreaminaUntilMediaFile(options: {
  cliBin: string;
  submitId: string;
  outDir: string;
  sinceMs: number;
  safeNodeId: string;
  index: number;
  media: "image" | "video";
  defaultExt: string;
  timeoutMessage: string;
  abortSignal?: AbortSignal;
  onPollProgress?: (p: DreaminaPollProgress) => void;
}): Promise<string> {
  const {
    cliBin,
    submitId,
    outDir,
    sinceMs,
    safeNodeId,
    index,
    media,
    defaultExt,
    timeoutMessage,
    abortSignal,
    onPollProgress,
  } = options;

  const absOutDir = path.resolve(outDir);
  const mediaKind = media === "video" ? ("video" as const) : ("image" as const);
  /** 默认 24h：与官网长任务一致，可用 JIMENG_MAX_WAIT_MS 覆盖 */
  const maxWaitMs = Number(process.env.JIMENG_MAX_WAIT_MS?.trim() || String(24 * 60 * 60 * 1000));
  const intervalMs = Number(process.env.JIMENG_POLL_INTERVAL_MS?.trim() || "5000");

  /**
   * 多节点 / 多任务并行时，若共用同一 download_dir，findNewestMediaUnderDir 会在整目录里取「全局最新」文件，
   * 极易把其它任务的成片当成自己的（串图、覆盖、丢张）。每轮询任务使用独立子目录，仅扫描该目录。
   */
  const scratchId = `${safeNodeId}_${index}_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
  const downloadDirAbs = path.join(absOutDir, ".dl", scratchId);
  await fs.mkdir(downloadDirAbs, { recursive: true });

  const downloadArgsBase = [
    "query_result",
    `--submit_id=${submitId}`,
    `--download_dir=${downloadDirAbs}`,
  ];

  try {
    onPollProgress?.({
      submitId,
      genStatus: "submitted",
      waitedMs: 0,
      queueRemainPct: null,
      renderPhase: "queue",
    });
    while (Date.now() - sinceMs < maxWaitMs) {
      if (abortSignal?.aborted) {
        throw new Error("已取消（客户端断开或中止请求）");
      }

      const qr = await runCli(cliBin, downloadArgsBase, 60_000);
      const combined = qr.stdout + "\n" + qr.stderr;
      const payload = extractQueryResultPayload(qr.stdout, qr.stderr);
      if (onPollProgress && payload) {
        const qi = payload.queue_info;
        const queueRemainPct = computeQueueRemainPctFromQi(qi);
        const renderPhase = inferRenderPhase(payload, queueRemainPct);
        onPollProgress({
          submitId,
          genStatus: typeof payload.gen_status === "string" ? payload.gen_status : undefined,
          queueLength: typeof qi?.queue_length === "number" ? qi.queue_length : undefined,
          queueIdx: typeof qi?.queue_idx === "number" ? qi.queue_idx : undefined,
          queueStatus: typeof qi?.queue_status === "string" ? qi.queue_status : undefined,
          waitedMs: Date.now() - sinceMs,
          queueRemainPct,
          renderPhase,
        });
      }
      throwIfTerminalDreaminaTask(payload);

      if (qr.code !== 0 && /not found|record not found/i.test(combined)) {
        throw new Error(
          `任务不存在或已失效，无法继续轮询（若已在官网取消/删除，属正常情况）。\n${clipText(combined, 500)}`
        );
      }

      const hit = await findNewestMediaUnderDir(downloadDirAbs, 0, 4, mediaKind);
      if (hit) {
        const ext = path.extname(hit.full) || hit.ext || defaultExt;
        const targetPath = path.join(absOutDir, `${safeNodeId}_${index}${ext}`);
        await cleanOutputSlot(absOutDir, safeNodeId, index);
        await fs.copyFile(hit.full, targetPath);
        await unlinkCliArtifactAfterCopy({
          outDirAbs: absOutDir,
          downloadedPath: hit.full,
          finalPath: targetPath,
        });
        return path.basename(targetPath);
      }

      if (abortSignal?.aborted) {
        throw new Error("已取消（客户端断开或中止请求）");
      }
      await sleep(intervalMs);
    }

    throw new Error(timeoutMessage);
  } finally {
    try {
      await fs.rm(downloadDirAbs, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

async function getTotalCredit(cliBin: string) {
  const res = await runCli(cliBin, ["user_credit"], 30_000);
  const parsed = tryParseJson(res.stdout) ?? tryParseJson(res.stderr);
  const total =
    parsed && typeof parsed === "object"
      ? (parsed as { total_credit?: unknown }).total_credit
      : undefined;
  if (typeof total === "number") return total;
  return null;
}

async function generateOneText2Image(options: {
  cliBin: string;
  prompt: string;
  modelVersion: string;
  ratio: string;
  resolutionType: string;
  outDir: string;
  safeNodeId: string;
  index: number;
  abortSignal?: AbortSignal;
  onPollProgress?: (p: DreaminaPollProgress) => void;
}) {
  const {
    cliBin,
    prompt,
    modelVersion,
    ratio,
    resolutionType,
    outDir,
    safeNodeId,
    index,
    abortSignal,
    onPollProgress,
  } = options;

  const submit = await runCli(
    cliBin,
    [
      "text2image",
      "--prompt",
      prompt,
      "--model_version",
      modelVersion,
      "--ratio",
      ratio,
      "--resolution_type",
      resolutionType,
      "--poll",
      "0",
    ],
    60_000
  );

  if (submit.code !== 0) {
    throw new Error(
      `dreamina text2image failed. code=${submit.code}\nstdout=${submit.stdout}\nstderr=${submit.stderr}`
    );
  }

  const submitId = extractSubmitId(submit.stdout + "\n" + submit.stderr);
  if (!submitId) {
    throw new Error(
      `Cannot extract submit_id from dreamina output.\nstdout=${submit.stdout}\nstderr=${submit.stderr}`
    );
  }

  const sinceMs = Date.now();
  await upsertGenerationTask({
    submitId,
    sourceNodeId: safeNodeId,
    index,
    mediaType: "image",
    status: "submitted",
    promptText: prompt,
    modelVersion,
    ratio,
    resolutionType,
  });
  const fileName = await pollDreaminaUntilMediaFile({
    cliBin,
    submitId,
    outDir,
    sinceMs,
    safeNodeId,
    index,
    media: "image",
    defaultExt: ".png",
    timeoutMessage: `Timeout waiting for generated image #${index + 1}.`,
    abortSignal,
    onPollProgress,
  });
  await recordCompletedGenerationTask({
    submitId,
    sourceNodeId: safeNodeId,
    index,
    mediaType: "image",
    fileName,
  });
  return fileName;
}

async function* iterateDreaminaText2Image(options: {
  cliBin: string;
  prompt: string;
  nodeId: string;
  modelVersion: string;
  ratio: string;
  resolutionType: string;
  count: number;
  outDir: string;
  abortSignal?: AbortSignal;
  onPollProgress?: (p: DreaminaPollProgress) => void;
}) {
  const {
    cliBin,
    prompt,
    nodeId,
    modelVersion,
    ratio,
    resolutionType,
    count,
    outDir,
    abortSignal,
    onPollProgress,
  } = options;
  await fs.mkdir(outDir, { recursive: true });
  const safeNodeId = sanitizeNodeId(nodeId);
  for (let i = 0; i < count; i++) {
    const fileName = await generateOneText2Image({
      cliBin,
      prompt,
      modelVersion,
      ratio,
      resolutionType,
      outDir,
      safeNodeId,
      index: i,
      abortSignal,
      onPollProgress,
    });
    yield toGeneratedUrl(fileName);
  }
  if (count > 0) await cleanOutputSlotsFromIndex(outDir, safeNodeId, count);
}

async function runDreaminaText2ImageBatch(options: {
  cliBin: string;
  prompt: string;
  nodeId: string;
  modelVersion: string;
  ratio: string;
  resolutionType: string;
  count: number;
  outDir: string;
  abortSignal?: AbortSignal;
  onPollProgress?: (p: DreaminaPollProgress) => void;
  onEachImage?: (url: string) => void;
}) {
  const {
    cliBin,
    prompt,
    nodeId,
    modelVersion,
    ratio,
    resolutionType,
    count,
    outDir,
    abortSignal,
    onPollProgress,
    onEachImage,
  } = options;
  await fs.mkdir(outDir, { recursive: true });
  const safeNodeId = sanitizeNodeId(nodeId);
  const urls = await runIndexedTaskPool({
    total: count,
    concurrency: MAX_CONCURRENT_IMAGE_GENERATIONS,
    worker: async (index) => {
      const fileName = await generateOneText2Image({
        cliBin,
        prompt,
        modelVersion,
        ratio,
        resolutionType,
        outDir,
        safeNodeId,
        index,
        abortSignal,
        onPollProgress,
      });
      return toGeneratedUrl(fileName);
    },
    onResolved: (url) => {
      onEachImage?.(url);
    },
  });
  if (count > 0) await cleanOutputSlotsFromIndex(outDir, safeNodeId, count);
  return { imageUrls: urls };
}

async function generateViaDreaminaText2Image(options: {
  cliBin: string;
  prompt: string;
  nodeId: string;
  modelVersion: string;
  ratio: string;
  resolutionType: string;
  count: number;
  outDir: string;
  abortSignal?: AbortSignal;
  onPollProgress?: (p: DreaminaPollProgress) => void;
  onEachImage?: (url: string) => void;
}) {
  const {
    cliBin,
    prompt,
    nodeId,
    modelVersion,
    ratio,
    resolutionType,
    count,
    outDir,
    abortSignal,
    onPollProgress,
    onEachImage,
  } = options;

  const creditsBefore = await getTotalCredit(cliBin);
  const result = await runDreaminaText2ImageBatch({
    cliBin,
    prompt,
    nodeId,
    modelVersion,
    ratio,
    resolutionType,
    count,
    outDir,
    abortSignal,
    onPollProgress,
    onEachImage,
  });

  const creditsAfter = await getTotalCredit(cliBin);
  const costPerImage =
    typeof creditsBefore === "number" &&
    typeof creditsAfter === "number" &&
    count > 0
      ? (creditsBefore - creditsAfter) / count
      : null;
  return { imageUrls: result.imageUrls, creditsBefore, creditsAfter, costPerImage };
}

async function saveUploadedImageFile(file: File, safeNodeId: string) {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);

  const originalName = file.name || "";
  const extFromName = originalName.includes(".")
    ? originalName.slice(originalName.lastIndexOf("."))
    : "";
  const ext =
    extFromName ||
    (file.type === "image/png"
      ? ".png"
      : file.type === "image/jpeg"
        ? ".jpg"
        : file.type === "image/webp"
          ? ".webp"
          : ".png");

  const outPath = path.join(os.tmpdir(), `dreamina_${safeNodeId}_${Date.now()}${ext}`);
  await fs.writeFile(outPath, bytes);
  return outPath;
}

/** 保存参考图或参考视频到临时文件（multimodal2video 的 --image / --video） */
async function saveUploadedMediaFile(file: File, safeNodeId: string) {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  const originalName = file.name || "";
  const extFromName = originalName.includes(".")
    ? originalName.slice(originalName.lastIndexOf("."))
    : "";
  const mime = file.type || "";
  const ext =
    extFromName ||
    (mime === "video/mp4" || mime.includes("mp4")
      ? ".mp4"
      : mime.includes("webm")
        ? ".webm"
        : mime.includes("video/")
          ? ".mp4"
          : mime === "image/png"
            ? ".png"
            : mime === "image/jpeg"
              ? ".jpg"
              : mime === "image/webp"
                ? ".webp"
                : ".bin");
  const outPath = path.join(os.tmpdir(), `dreamina_${safeNodeId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  await fs.writeFile(outPath, bytes);
  return outPath;
}

async function generateOneImage2Image(options: {
  cliBin: string;
  prompt: string;
  imagePaths: string[];
  modelVersion: string;
  ratio: string;
  resolutionType: string;
  outDir: string;
  safeNodeId: string;
  index: number;
  abortSignal?: AbortSignal;
  onPollProgress?: (p: DreaminaPollProgress) => void;
}) {
  const {
    cliBin,
    prompt,
    imagePaths,
    modelVersion,
    ratio,
    resolutionType,
    outDir,
    safeNodeId,
    index,
    abortSignal,
    onPollProgress,
  } = options;

  if (imagePaths.length === 0) {
    throw new Error("imagePaths must not be empty for image2image.");
  }

  const submit = await runCli(
    cliBin,
    [
      "image2image",
      `--images=${imagePaths.join(",")}`,
      "--prompt",
      prompt,
      "--model_version",
      modelVersion,
      "--ratio",
      ratio,
      "--resolution_type",
      resolutionType,
      "--poll",
      "0",
    ],
    120_000
  );

  if (submit.code !== 0) {
    throw new Error(
      `dreamina image2image failed. code=${submit.code}\nstdout=${submit.stdout}\nstderr=${submit.stderr}`
    );
  }

  const submitId = extractSubmitId(submit.stdout + "\n" + submit.stderr);
  if (!submitId) {
    throw new Error(
      `Cannot extract submit_id from dreamina output.\nstdout=${submit.stdout}\nstderr=${submit.stderr}`
    );
  }

  const sinceMs = Date.now();
  await upsertGenerationTask({
    submitId,
    sourceNodeId: safeNodeId,
    index,
    mediaType: "image",
    status: "submitted",
    promptText: prompt,
    modelVersion,
    ratio,
    resolutionType,
  });
  const fileName = await pollDreaminaUntilMediaFile({
    cliBin,
    submitId,
    outDir,
    sinceMs,
    safeNodeId,
    index,
    media: "image",
    defaultExt: ".png",
    timeoutMessage: `Timeout waiting for generated image #${index + 1}.`,
    abortSignal,
    onPollProgress,
  });
  await recordCompletedGenerationTask({
    submitId,
    sourceNodeId: safeNodeId,
    index,
    mediaType: "image",
    fileName,
  });
  return fileName;
}

async function* iterateDreaminaImage2Image(options: {
  cliBin: string;
  prompt: string;
  nodeId: string;
  modelVersion: string;
  ratio: string;
  resolutionType: string;
  count: number;
  outDir: string;
  imageFiles: File[];
  abortSignal?: AbortSignal;
  onPollProgress?: (p: DreaminaPollProgress) => void;
}) {
  const {
    cliBin,
    prompt,
    nodeId,
    modelVersion,
    ratio,
    resolutionType,
    count,
    outDir,
    imageFiles,
    abortSignal,
    onPollProgress,
  } = options;

  await fs.mkdir(outDir, { recursive: true });
  const safeNodeId = sanitizeNodeId(nodeId);

  if (!imageFiles || imageFiles.length === 0) {
    throw new Error("imageFiles must not be empty for image2image.");
  }

  const savedImagePaths: string[] = [];
  for (const f of imageFiles) {
    savedImagePaths.push(await saveUploadedImageFile(f, safeNodeId));
  }

  try {
    for (let i = 0; i < count; i++) {
      const fileName = await generateOneImage2Image({
        cliBin,
        prompt,
        imagePaths: savedImagePaths,
        modelVersion,
        ratio,
        resolutionType,
        outDir,
        safeNodeId,
        index: i,
        abortSignal,
        onPollProgress,
      });
      yield toGeneratedUrl(fileName);
    }
    if (count > 0) await cleanOutputSlotsFromIndex(outDir, safeNodeId, count);
  } finally {
    try {
      for (const p of savedImagePaths) {
        await fs.rm(p, { force: true });
      }
    } catch {
      // ignore
    }
  }
}

async function runDreaminaImage2ImageBatch(options: {
  cliBin: string;
  prompt: string;
  nodeId: string;
  modelVersion: string;
  ratio: string;
  resolutionType: string;
  count: number;
  outDir: string;
  imageFiles: File[];
  abortSignal?: AbortSignal;
  onPollProgress?: (p: DreaminaPollProgress) => void;
  onEachImage?: (url: string) => void;
}) {
  const {
    cliBin,
    prompt,
    nodeId,
    modelVersion,
    ratio,
    resolutionType,
    count,
    outDir,
    imageFiles,
    abortSignal,
    onPollProgress,
    onEachImage,
  } = options;

  await fs.mkdir(outDir, { recursive: true });
  const safeNodeId = sanitizeNodeId(nodeId);

  if (!imageFiles || imageFiles.length === 0) {
    throw new Error("imageFiles must not be empty for image2image.");
  }

  const savedImagePaths: string[] = [];
  for (const f of imageFiles) {
    savedImagePaths.push(await saveUploadedImageFile(f, safeNodeId));
  }

  try {
    const urls = await runIndexedTaskPool({
      total: count,
      concurrency: MAX_CONCURRENT_IMAGE_GENERATIONS,
      worker: async (index) => {
        const fileName = await generateOneImage2Image({
          cliBin,
          prompt,
          imagePaths: savedImagePaths,
          modelVersion,
          ratio,
          resolutionType,
          outDir,
          safeNodeId,
          index,
          abortSignal,
          onPollProgress,
        });
        return toGeneratedUrl(fileName);
      },
      onResolved: (url) => {
        onEachImage?.(url);
      },
    });
    if (count > 0) await cleanOutputSlotsFromIndex(outDir, safeNodeId, count);
    return { imageUrls: urls };
  } finally {
    try {
      for (const p of savedImagePaths) {
        await fs.rm(p, { force: true });
      }
    } catch {
      // ignore
    }
  }
}

async function generateViaDreaminaImage2Image(options: {
  cliBin: string;
  prompt: string;
  nodeId: string;
  modelVersion: string;
  ratio: string;
  resolutionType: string;
  count: number;
  outDir: string;
  imageFiles: File[];
  abortSignal?: AbortSignal;
  onPollProgress?: (p: DreaminaPollProgress) => void;
  onEachImage?: (url: string) => void;
}) {
  const {
    cliBin,
    prompt,
    nodeId,
    modelVersion,
    ratio,
    resolutionType,
    count,
    outDir,
    imageFiles,
    abortSignal,
    onPollProgress,
    onEachImage,
  } = options;

  const creditsBefore = await getTotalCredit(cliBin);
  const result = await runDreaminaImage2ImageBatch({
    cliBin,
    prompt,
    nodeId,
    modelVersion,
    ratio,
    resolutionType,
    count,
    outDir,
    imageFiles,
    abortSignal,
    onPollProgress,
    onEachImage,
  });

  const creditsAfter = await getTotalCredit(cliBin);
  const costPerImage =
    typeof creditsBefore === "number" &&
    typeof creditsAfter === "number" &&
    count > 0
      ? (creditsBefore - creditsAfter) / count
      : null;
  return { imageUrls: result.imageUrls, creditsBefore, creditsAfter, costPerImage };
}

async function generateOneText2Video(options: {
  cliBin: string;
  prompt: string;
  modelVersion: string;
  ratio: string;
  resolutionType: string;
  outDir: string;
  safeNodeId: string;
  index: number;
  durationSeconds?: number;
  abortSignal?: AbortSignal;
  onPollProgress?: (p: DreaminaPollProgress) => void;
}) {
  const {
    cliBin,
    prompt,
    modelVersion,
    ratio,
    resolutionType,
    outDir,
    safeNodeId,
    index,
    durationSeconds,
    abortSignal,
    onPollProgress,
  } = options;
  const mv = normalizeVideoModelVersion(modelVersion, false);
  const ratioOk = normalizeRatioForText2Video(ratio);
  const videoRes = normalizeVideoResolutionForCli(mv, resolutionType);
  const duration = clampDurationText2Multimodal(durationSeconds);
  const submit = await runCli(
    cliBin,
    [
      "text2video",
      "--prompt",
      prompt,
      "--model_version",
      mv,
      "--ratio",
      ratioOk,
      "--video_resolution",
      videoRes,
      "--duration",
      String(duration),
      "--poll",
      "0",
    ],
    120_000
  );
  const submitCombinedT2v = `${submit.stdout}\n${submit.stderr}`;
  if (submit.code !== 0) {
    throw new Error(`dreamina text2video failed. code=${submit.code}\n${submitCombinedT2v}`);
  }
  throwIfDreaminaCliSubmitRejected(submitCombinedT2v);
  const submitId = extractSubmitId(submitCombinedT2v);
  if (!submitId) {
    throw new Error(`Cannot extract submit_id from dreamina output.\nstdout=${submit.stdout}\nstderr=${submit.stderr}`);
  }
  const sinceMs = Date.now();
  await upsertGenerationTask({
    submitId,
    sourceNodeId: safeNodeId,
    index,
    mediaType: "video",
    status: "submitted",
    promptText: prompt,
    modelVersion: mv,
    ratio: ratioOk,
    resolutionType: videoRes,
    durationSeconds: duration,
    videoProvider: "dreamina",
  });
  const fileName = await pollDreaminaUntilMediaFile({
    cliBin,
    submitId,
    outDir,
    sinceMs,
    safeNodeId,
    index,
    media: "video",
    defaultExt: ".mp4",
    timeoutMessage: `Timeout waiting for generated video #${index + 1}.`,
    abortSignal,
    onPollProgress,
  });
  await recordCompletedGenerationTask({
    submitId,
    sourceNodeId: safeNodeId,
    index,
    mediaType: "video",
    fileName,
  });
  return fileName;
}

async function* iterateDreaminaText2Video(options: {
  cliBin: string;
  prompt: string;
  nodeId: string;
  modelVersion: string;
  ratio: string;
  resolutionType: string;
  count: number;
  outDir: string;
  durationSeconds?: number;
  withAudio?: boolean;
  abortSignal?: AbortSignal;
  onPollProgress?: (p: DreaminaPollProgress) => void;
}) {
  const {
    cliBin,
    prompt,
    nodeId,
    modelVersion,
    ratio,
    resolutionType,
    count,
    outDir,
    durationSeconds,
    withAudio,
    abortSignal,
    onPollProgress,
  } = options;
  await fs.mkdir(outDir, { recursive: true });
  const safeNodeId = sanitizeNodeId(nodeId);
  const cliPrompt = augmentVideoPromptForCli(prompt, withAudio);
  /** 多条数时并行提交，缩短「两条一起排队」的总等待（各任务仍独立 poll） */
  const fileNames = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      generateOneText2Video({
        cliBin,
        prompt: cliPrompt,
        modelVersion,
        ratio,
        resolutionType,
        outDir,
        safeNodeId,
        index: i,
        durationSeconds,
        abortSignal,
        onPollProgress,
      })
    )
  );
  for (const fileName of fileNames) {
    yield toGeneratedUrl(fileName);
  }
  if (count > 0) await cleanOutputSlotsFromIndex(outDir, safeNodeId, count);
}

async function generateOneImage2Video(options: {
  cliBin: string;
  prompt: string;
  imagePath: string;
  modelVersion: string;
  resolutionType: string;
  outDir: string;
  safeNodeId: string;
  index: number;
  durationSeconds?: number;
  abortSignal?: AbortSignal;
  onPollProgress?: (p: DreaminaPollProgress) => void;
}) {
  const {
    cliBin,
    prompt,
    imagePath,
    modelVersion,
    resolutionType,
    outDir,
    safeNodeId,
    index,
    durationSeconds,
    abortSignal,
    onPollProgress,
  } = options;
  const mv = normalizeVideoModelVersion(modelVersion, true);
  const videoRes = normalizeVideoResolutionForCli(mv, resolutionType);
  const duration = clampDurationImage2Video(mv, durationSeconds);
  const submit = await runCli(
    cliBin,
    [
      "image2video",
      `--image=${imagePath}`,
      "--prompt",
      prompt,
      "--model_version",
      mv,
      "--video_resolution",
      videoRes,
      "--duration",
      String(duration),
      "--poll",
      "0",
    ],
    120_000
  );
  const submitCombinedI2v = `${submit.stdout}\n${submit.stderr}`;
  if (submit.code !== 0) {
    throw new Error(`dreamina image2video failed. code=${submit.code}\n${submitCombinedI2v}`);
  }
  throwIfDreaminaCliSubmitRejected(submitCombinedI2v);
  const submitId = extractSubmitId(submitCombinedI2v);
  if (!submitId) {
    throw new Error(`Cannot extract submit_id from dreamina output.\nstdout=${submit.stdout}\nstderr=${submit.stderr}`);
  }
  const sinceMs = Date.now();
  await upsertGenerationTask({
    submitId,
    sourceNodeId: safeNodeId,
    index,
    mediaType: "video",
    status: "submitted",
    promptText: prompt,
    modelVersion: mv,
    resolutionType: videoRes,
    durationSeconds: duration,
    videoProvider: "dreamina",
  });
  const fileName = await pollDreaminaUntilMediaFile({
    cliBin,
    submitId,
    outDir,
    sinceMs,
    safeNodeId,
    index,
    media: "video",
    defaultExt: ".mp4",
    timeoutMessage: `Timeout waiting for generated video #${index + 1}.`,
    abortSignal,
    onPollProgress,
  });
  await recordCompletedGenerationTask({
    submitId,
    sourceNodeId: safeNodeId,
    index,
    mediaType: "video",
    fileName,
  });
  return fileName;
}

async function generateOneMultiframe2Video(options: {
  cliBin: string;
  prompt: string;
  imagePathA: string;
  imagePathB: string;
  outDir: string;
  safeNodeId: string;
  index: number;
  durationSeconds?: number;
  abortSignal?: AbortSignal;
  onPollProgress?: (p: DreaminaPollProgress) => void;
}) {
  const {
    cliBin,
    prompt,
    imagePathA,
    imagePathB,
    outDir,
    safeNodeId,
    index,
    durationSeconds,
    abortSignal,
    onPollProgress,
  } = options;
  const imagesArg = `${imagePathA},${imagePathB}`;
  const dur = clampDurationMultiframe(durationSeconds);
  const submit = await runCli(
    cliBin,
    [
      "multiframe2video",
      "--images",
      imagesArg,
      "--prompt",
      prompt,
      "--duration",
      String(dur),
      "--poll",
      "0",
    ],
    120_000
  );
  const submitCombinedMf = `${submit.stdout}\n${submit.stderr}`;
  if (submit.code !== 0) {
    throw new Error(`dreamina multiframe2video failed. code=${submit.code}\n${submitCombinedMf}`);
  }
  throwIfDreaminaCliSubmitRejected(submitCombinedMf);
  const submitId = extractSubmitId(submitCombinedMf);
  if (!submitId) {
    throw new Error(`Cannot extract submit_id from dreamina output.\nstdout=${submit.stdout}\nstderr=${submit.stderr}`);
  }
  const sinceMs = Date.now();
  await upsertGenerationTask({
    submitId,
    sourceNodeId: safeNodeId,
    index,
    mediaType: "video",
    status: "submitted",
    promptText: prompt,
    durationSeconds: dur,
    videoProvider: "dreamina",
    referenceMode: "headtail",
  });
  const fileName = await pollDreaminaUntilMediaFile({
    cliBin,
    submitId,
    outDir,
    sinceMs,
    safeNodeId,
    index,
    media: "video",
    defaultExt: ".mp4",
    timeoutMessage: `Timeout waiting for generated video #${index + 1}.`,
    abortSignal,
    onPollProgress,
  });
  await recordCompletedGenerationTask({
    submitId,
    sourceNodeId: safeNodeId,
    index,
    mediaType: "video",
    fileName,
  });
  return fileName;
}

async function generateOneMultimodal2Video(options: {
  cliBin: string;
  prompt: string;
  materials: Array<{ path: string; kind: "image" | "video" }>;
  modelVersion: string;
  ratio: string;
  resolutionType: string;
  outDir: string;
  safeNodeId: string;
  index: number;
  durationSeconds?: number;
  withAudio?: boolean;
  abortSignal?: AbortSignal;
  onPollProgress?: (p: DreaminaPollProgress) => void;
}) {
  const {
    cliBin,
    prompt,
    materials,
    modelVersion,
    ratio,
    resolutionType,
    outDir,
    safeNodeId,
    index,
    durationSeconds,
    withAudio,
    abortSignal,
    onPollProgress,
  } = options;
  if (materials.length === 0) {
    throw new Error("multimodal2video requires at least one reference image or video file.");
  }
  const mv = modelVersionForMultimodalCli(modelVersion);
  const ratioOk = normalizeRatioForText2Video(ratio);
  const videoRes = normalizeVideoResolutionForCli(mv, resolutionType);
  const duration = clampDurationText2Multimodal(durationSeconds);
  const promptForCli = buildMultimodalCliPrompt(prompt, withAudio);
  const args: string[] = ["multimodal2video"];
  for (const m of materials) {
    if (m.kind === "image") args.push("--image", m.path);
    else args.push("--video", m.path);
  }
  args.push(
    "--prompt",
    promptForCli,
    "--duration",
    String(duration),
    "--ratio",
    ratioOk,
    "--video_resolution",
    videoRes,
    "--model_version",
    mv,
    "--poll",
    "0"
  );
  const submit = await runCli(cliBin, args, 120_000);
  const submitCombined = `${submit.stdout}\n${submit.stderr}`;
  if (submit.code !== 0) {
    throw new Error(`dreamina multimodal2video failed. code=${submit.code}\n${submitCombined}`);
  }
  throwIfDreaminaCliSubmitRejected(submitCombined);
  const submitId = extractSubmitId(submitCombined);
  if (!submitId) {
    throw new Error(`Cannot extract submit_id from dreamina output.\nstdout=${submit.stdout}\nstderr=${submit.stderr}`);
  }
  const sinceMs = Date.now();
  await upsertGenerationTask({
    submitId,
    sourceNodeId: safeNodeId,
    index,
    mediaType: "video",
    status: "submitted",
    promptText: prompt,
    modelVersion: mv,
    ratio: ratioOk,
    resolutionType: videoRes,
    durationSeconds: duration,
    withAudio,
    videoProvider: "dreamina",
  });
  const fileName = await pollDreaminaUntilMediaFile({
    cliBin,
    submitId,
    outDir,
    sinceMs,
    safeNodeId,
    index,
    media: "video",
    defaultExt: ".mp4",
    timeoutMessage: `Timeout waiting for generated video #${index + 1}.`,
    abortSignal,
    onPollProgress,
  });
  await recordCompletedGenerationTask({
    submitId,
    sourceNodeId: safeNodeId,
    index,
    mediaType: "video",
    fileName,
  });
  return fileName;
}

async function* iterateDreaminaImage2Video(options: {
  cliBin: string;
  prompt: string;
  nodeId: string;
  modelVersion: string;
  ratio: string;
  resolutionType: string;
  count: number;
  outDir: string;
  materialFiles: File[];
  materialKinds: Array<"image" | "video">;
  referenceMode?: "general" | "headtail";
  durationSeconds?: number;
  withAudio?: boolean;
  abortSignal?: AbortSignal;
  onPollProgress?: (p: DreaminaPollProgress) => void;
}) {
  const {
    cliBin,
    prompt,
    nodeId,
    modelVersion,
    ratio,
    resolutionType,
    count,
    outDir,
    materialFiles,
    materialKinds,
    referenceMode = "general",
    durationSeconds,
    withAudio,
    abortSignal,
    onPollProgress,
  } = options;
  if (materialFiles.length !== materialKinds.length) {
    throw new Error("materialFiles and materialKinds must have the same length.");
  }
  await fs.mkdir(outDir, { recursive: true });
  const safeNodeId = sanitizeNodeId(nodeId);
  const cliPrompt = augmentVideoPromptForCli(prompt, withAudio);
  const saved: Array<{ kind: "image" | "video"; path: string }> = [];
  for (let i = 0; i < materialFiles.length; i++) {
    const path = await saveUploadedMediaFile(materialFiles[i]!, safeNodeId);
    saved.push({ kind: materialKinds[i]!, path });
  }
  try {
    for (let i = 0; i < count; i++) {
      let fileName: string;
      const n = saved.length;
      const onlyImages = saved.every((s) => s.kind === "image");
      if (referenceMode === "headtail" && n === 2 && onlyImages) {
        fileName = await generateOneMultiframe2Video({
          cliBin,
          prompt: cliPrompt,
          imagePathA: saved[0]!.path,
          imagePathB: saved[1]!.path,
          outDir,
          safeNodeId,
          index: i,
          durationSeconds,
          abortSignal,
          onPollProgress,
        });
      } else if (referenceMode === "headtail" && n === 2) {
        fileName = await generateOneMultimodal2Video({
          cliBin,
          prompt,
          withAudio,
          materials: saved,
          modelVersion,
          ratio,
          resolutionType,
          outDir,
          safeNodeId,
          index: i,
          durationSeconds,
          abortSignal,
          onPollProgress,
        });
      } else if (referenceMode === "general" && n >= 2) {
        fileName = await generateOneMultimodal2Video({
          cliBin,
          prompt,
          withAudio,
          materials: saved,
          modelVersion,
          ratio,
          resolutionType,
          outDir,
          safeNodeId,
          index: i,
          durationSeconds,
          abortSignal,
          onPollProgress,
        });
      } else if (n === 1 && saved[0]!.kind === "image") {
        fileName = await generateOneImage2Video({
          cliBin,
          prompt: cliPrompt,
          imagePath: saved[0]!.path,
          modelVersion,
          resolutionType,
          outDir,
          safeNodeId,
          index: i,
          durationSeconds,
          abortSignal,
          onPollProgress,
        });
      } else {
        fileName = await generateOneMultimodal2Video({
          cliBin,
          prompt,
          withAudio,
          materials: saved,
          modelVersion,
          ratio,
          resolutionType,
          outDir,
          safeNodeId,
          index: i,
          durationSeconds,
          abortSignal,
          onPollProgress,
        });
      }
      yield toGeneratedUrl(fileName);
    }
    if (count > 0) await cleanOutputSlotsFromIndex(outDir, safeNodeId, count);
  } finally {
    try {
      for (const s of saved) await fs.rm(s.path, { force: true });
    } catch {
      // ignore
    }
  }
}

function ndjsonStreamResponse(
  run: (send: (obj: Record<string, unknown>) => void) => Promise<void>
): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (obj: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          closed = true;
        }
      };
      try {
        await run(send);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        send({ event: "error", message: msg, terminal: true });
      } finally {
        if (!closed) {
          try {
            controller.close();
          } catch {
            closed = true;
          }
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      /** 减少反向代理/中间层缓冲整段响应，便于客户端尽快收到每条 image 事件 */
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") || "";

  try {
    const cliBinCandidate = resolveCliBin();
    const cliBin =
      (await fileExists(cliBinCandidate)) || cliBinCandidate === "dreamina"
        ? cliBinCandidate
        : "dreamina";

    const outDir = await resolveGeneratedDir();
    const wantsStream = req.headers.get("x-jimeng-stream") === "1";
    const abortSignal = req.signal;

    // multipart: reference image + prompt (图生图)
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const prompt = form.get("prompt");
      const nodeId = form.get("nodeId");
      const modelVersion = form.get("modelVersion");
      const ratio = form.get("ratio");
      const resolutionType = form.get("resolutionType");
      const providerRaw = form.get("provider");
      const providerIdRaw = form.get("providerId");
      const videoProviderRaw = form.get("videoProvider");
      const modeRaw = form.get("mode");
      const countRaw = form.get("count");
      const referenceModeRaw = form.get("referenceMode");
      const imageQualityRaw = form.get("imageQuality");
      const images = form.getAll("image");
      const materialOrderRaw = form.get("materialOrder");
      const materialParts = form.getAll("material");
      const isVideoMode = typeof modeRaw === "string" && modeRaw.trim().toLowerCase() === "video";
      const provider =
        !isVideoMode && typeof providerRaw === "string" && providerRaw.trim() === "aiwanwu"
          ? ("aiwanwu" as const)
          : ("dreamina" as const);
      const videoProvider =
        isVideoMode && typeof videoProviderRaw === "string" && videoProviderRaw.trim() === "external_api"
          ? ("external_api" as const)
          : ("dreamina" as const);
      const providerId = isExternalImageApiProviderId(providerIdRaw)
        ? providerIdRaw
        : undefined;
      const imageQuality =
        imageQualityRaw === "standard" || imageQualityRaw === "high" || imageQualityRaw === "hd"
          ? imageQualityRaw
          : undefined;
      const videoReferenceMode =
        typeof referenceModeRaw === "string" && referenceModeRaw.trim() === "headtail"
          ? ("headtail" as const)
          : ("general" as const);
      const videoDurationSeconds = isVideoMode ? parseDurationSeconds(form.get("durationSeconds")) : undefined;
      const videoWithAudio = isVideoMode ? parseWithAudioFlag(form.get("withAudio")) ?? false : undefined;

      if (typeof prompt !== "string" || prompt.trim().length < 1) {
        return new Response(
          JSON.stringify({ error: "`prompt` must be a non-empty string" }),
          { status: 400 }
        );
      }
      if (typeof nodeId !== "string" || nodeId.trim().length < 1) {
        return new Response(
          JSON.stringify({ error: "`nodeId` must be a non-empty string" }),
          { status: 400 }
        );
      }
      const imageFiles = images.filter(
        (v) => v && typeof (v as { arrayBuffer?: unknown }).arrayBuffer === "function"
      ) as unknown as File[];

      let videoMaterialFiles: File[] = [];
      let videoMaterialKinds: Array<"image" | "video"> = [];
      if (
        isVideoMode &&
        typeof materialOrderRaw === "string" &&
        materialOrderRaw.trim() &&
        materialParts.length > 0
      ) {
        const kinds = materialOrderRaw.split(",").map((s) => s.trim());
        const mfiles = materialParts.filter(
          (v) => v && typeof (v as { arrayBuffer?: unknown }).arrayBuffer === "function"
        ) as unknown as File[];
        if (kinds.length === mfiles.length && kinds.every((k) => k === "image" || k === "video")) {
          videoMaterialFiles = mfiles;
          videoMaterialKinds = kinds as Array<"image" | "video">;
        }
      }
      const hasVideoOrderedMaterials = isVideoMode && videoMaterialFiles.length > 0;

      if (hasVideoOrderedMaterials) {
        const nV = videoMaterialKinds.filter((k) => k === "video").length;
        const nI = videoMaterialKinds.filter((k) => k === "image").length;
        if (nV > 3) {
          return new Response(
            JSON.stringify({
              error: "参考视频最多 3 条（即梦 multimodal2video 限制），请减少连线素材。",
            }),
            { status: 400 }
          );
        }
        if (nI > 9) {
          return new Response(
            JSON.stringify({
              error: "参考图片最多 9 张（即梦 multimodal2video 限制），请减少连线素材。",
            }),
            { status: 400 }
          );
        }
      }

      if (!isVideoMode && provider !== "aiwanwu" && imageFiles.length === 0) {
        return new Response(
          JSON.stringify({ error: "At least one `image` file is required for image2image" }),
          { status: 400 }
        );
      }

      const safeNodeId = sanitizeNodeId(nodeId.trim());
      const modelVersionStr =
        typeof modelVersion === "string" && modelVersion.trim()
          ? modelVersion.trim()
          : isVideoMode
            ? (process.env.JIMENG_VIDEO_MODEL_VERSION?.trim() || "seedance2.0fast")
            : (process.env.JIMENG_MODEL_VERSION?.trim() || "5.0");
      const ratioStr =
        typeof ratio === "string" && ratio.trim()
          ? ratio.trim()
          : (process.env.JIMENG_DEFAULT_RATIO?.trim() || "16:9");
      const resolutionTypeStr =
        typeof resolutionType === "string" && resolutionType.trim()
          ? resolutionType.trim()
          : isVideoMode
            ? (process.env.JIMENG_VIDEO_DEFAULT_RESOLUTION_TYPE?.trim() || "720p")
            : (process.env.JIMENG_DEFAULT_RESOLUTION_TYPE?.trim() || "2k");

      const count = Number(countRaw ?? 1);
      const safeCount = Number.isFinite(count)
        ? isVideoMode
          ? Math.max(1, Math.min(getVideoModelMaxCount(modelVersionStr), count))
          : Math.max(1, Math.min(8, count))
        : 1;
      const usesForopencodeVideo =
        isVideoMode && (videoProvider === "external_api" || isForopencodeVideoModel(modelVersionStr));

      if (isCloudDeployment()) {
        if (!isVideoMode && provider !== "aiwanwu") {
          return new Response(
            JSON.stringify({
              error: "云端版仅保留外部图片通道，请将图片 provider 切换为 GPT/aiwanwu。",
            }),
            { status: 400 }
          );
        }
        if (isVideoMode && !usesForopencodeVideo) {
          return new Response(
            JSON.stringify({
              error: "云端版不支持 dreamina 本地视频链路，请切换到外部视频 provider。",
            }),
            { status: 400 }
          );
        }
      }

      if (!isVideoMode && provider === "aiwanwu") {
        const aiwanwuPrompt = extractAiwanwuImagePromptDirectives(prompt.trim());
        if (!aiwanwuPrompt.prompt) {
          return new Response(
            JSON.stringify({ error: "透明背景指令之外，还需要输入实际提示词。" }),
            { status: 400 }
          );
        }
        if (false) {
          return new Response(
            JSON.stringify({ error: "GPT 图片模型当前最多支持 1 张参考图。请减少素材后再试。" }),
            { status: 400 }
          );
        }
        const referenceImageFiles = imageFiles;
        if (providerId === "banana2") {
          if (wantsStream) {
            return ndjsonStreamResponse(async (send) => {
              const result = await runBanana2Text2ImageBatch({
                prompt: aiwanwuPrompt.prompt,
                nodeId: nodeId.trim(),
                ratio: ratioStr,
                resolutionType: resolutionTypeStr,
                count: safeCount,
                outDir,
                onEachImage: (url) => send({ event: "image", url }),
                referenceImageFiles,
                abortSignal,
                onTaskProgress: (progress) =>
                  send({
                    event: "progress",
                    submitId: progress.submitId,
                    genStatus: progress.genStatus ?? null,
                    progressPct: progress.progressPct ?? null,
                    renderPhase: progress.renderPhase ?? null,
                  }),
              });
              send({
                event: "done",
                creditsAfter: null,
                costPerImage: null,
                imageUrls: result.imageUrls,
                backgroundSyncPending: result.backgroundSyncPending === true,
              });
            });
          }

          const result = await runBanana2Text2ImageBatch({
            prompt: aiwanwuPrompt.prompt,
            nodeId: nodeId.trim(),
            ratio: ratioStr,
            resolutionType: resolutionTypeStr,
            count: safeCount,
            outDir,
            referenceImageFiles,
            abortSignal,
          });
          return new Response(
            JSON.stringify({
              imageUrls: result.imageUrls,
              creditsBefore: null,
              creditsAfter: null,
              costPerImage: null,
              backgroundSyncPending: result.backgroundSyncPending === true,
            }),
            { status: 200 }
          );
        }
        if (wantsStream) {
          return ndjsonStreamResponse(async (send) => {
            const result = await runAiwanwuText2ImageBatch({
              prompt: aiwanwuPrompt.prompt,
              nodeId: nodeId.trim(),
              modelVersion: modelVersionStr,
              ratio: ratioStr,
              resolutionType: resolutionTypeStr,
              count: safeCount,
              outDir,
              onEachImage: (url) => send({ event: "image", url }),
              referenceImageFiles,
              providerId,
              imageQuality,
              imageFormat: aiwanwuPrompt.imageFormat,
              onTaskProgress: (progress) =>
                send({
                  event: "progress",
                  submitId: progress.submitId,
                  genStatus: progress.genStatus ?? null,
                  progressPct: progress.progressPct ?? null,
                  renderPhase: progress.renderPhase ?? null,
                }),
            });
            send({
              event: "done",
              creditsAfter: null,
              costPerImage: null,
              imageUrls: result.imageUrls,
              usage: result.usage,
            });
          });
        }

        const result = await runAiwanwuText2ImageBatch({
          prompt: aiwanwuPrompt.prompt,
          nodeId: nodeId.trim(),
          modelVersion: modelVersionStr,
          ratio: ratioStr,
          resolutionType: resolutionTypeStr,
          count: safeCount,
          outDir,
          referenceImageFiles,
          providerId,
          imageQuality,
          imageFormat: aiwanwuPrompt.imageFormat,
        });
        return new Response(
          JSON.stringify({
            imageUrls: result.imageUrls,
            usage: result.usage,
            creditsBefore: null,
            creditsAfter: null,
            costPerImage: null,
          }),
          { status: 200 }
        );
      }

      if (usesForopencodeVideo) {
        const referenceImageFiles = hasVideoOrderedMaterials
          ? videoMaterialFiles.filter((_, index) => videoMaterialKinds[index] === "image")
          : imageFiles.filter((file) => file.type.startsWith("image/"));
        const hasReferenceVideos = hasVideoOrderedMaterials
          ? videoMaterialKinds.some((kind) => kind === "video")
          : false;
        if (referenceImageFiles.length > 2) {
          return new Response(
            JSON.stringify({
              error: "外部视频 API 当前最多支持 2 张图片作为首尾帧。",
            }),
            { status: 400 }
          );
        }
        if (hasReferenceVideos) {
          return new Response(
            JSON.stringify({
              error: "外部视频 API 当前仅验证了图片参考，不支持参考视频素材。",
            }),
            { status: 400 }
          );
        }
        if (wantsStream) {
          return ndjsonStreamResponse(async (send) => {
            const urls = await runForopencodeText2Video({
              prompt: prompt.trim(),
              nodeId: nodeId.trim(),
              modelVersion: modelVersionStr,
              ratio: ratioStr,
              resolutionType: resolutionTypeStr,
              count: safeCount,
              durationSeconds: videoDurationSeconds,
              outDir,
              referenceMode: videoReferenceMode,
              referenceImageFiles,
              abortSignal,
              onPollProgress: (progress) =>
                send({
                  event: "progress",
                  submitId: progress.submitId,
                  genStatus: progress.genStatus ?? null,
                  progressPct: progress.progressPct ?? null,
                  renderPhase: progress.renderPhase ?? null,
                }),
            });
            for (const url of urls) send({ event: "image", url });
            send({
              event: "done",
              creditsAfter: null,
              costPerImage: null,
              imageUrls: urls,
            });
          });
        }

        const imageUrls = await runForopencodeText2Video({
          prompt: prompt.trim(),
          nodeId: nodeId.trim(),
          modelVersion: modelVersionStr,
          ratio: ratioStr,
          resolutionType: resolutionTypeStr,
          count: safeCount,
          durationSeconds: videoDurationSeconds,
          outDir,
          referenceMode: videoReferenceMode,
          referenceImageFiles,
          abortSignal,
        });

        return new Response(
          JSON.stringify({
            imageUrls,
            creditsBefore: null,
            creditsAfter: null,
            costPerImage: null,
          }),
          { status: 200 }
        );
      }

      if (wantsStream) {
        return ndjsonStreamResponse(async (send) => {
          const onPollProgress = (p: DreaminaPollProgress) => {
            send({
              event: "progress",
              submitId: p.submitId,
              genStatus: p.genStatus ?? null,
              queueLength: p.queueLength ?? null,
              queueIdx: p.queueIdx ?? null,
              queueStatus: p.queueStatus ?? null,
              waitedMs: p.waitedMs,
              queueRemainPct: p.queueRemainPct ?? null,
              renderPhase: p.renderPhase ?? null,
            });
          };
          if (isVideoMode) {
            const creditsBefore = await getTotalCredit(cliBin);
            const urls: string[] = [];
            const iterator = hasVideoOrderedMaterials
              ? iterateDreaminaImage2Video({
                    cliBin,
                    prompt: prompt.trim(),
                    nodeId: nodeId.trim(),
                    modelVersion: modelVersionStr,
                    ratio: ratioStr,
                    resolutionType: resolutionTypeStr,
                    count: safeCount,
                    outDir,
                    materialFiles: videoMaterialFiles,
                    materialKinds: videoMaterialKinds,
                    referenceMode: videoReferenceMode,
                    durationSeconds: videoDurationSeconds,
                    withAudio: videoWithAudio,
                    abortSignal,
                    onPollProgress,
                  })
              : imageFiles.length > 0
                ? iterateDreaminaImage2Video({
                      cliBin,
                      prompt: prompt.trim(),
                      nodeId: nodeId.trim(),
                      modelVersion: modelVersionStr,
                      ratio: ratioStr,
                      resolutionType: resolutionTypeStr,
                      count: safeCount,
                      outDir,
                      materialFiles: imageFiles,
                      materialKinds: imageFiles.map(() => "image" as const),
                      referenceMode: videoReferenceMode,
                      durationSeconds: videoDurationSeconds,
                      withAudio: videoWithAudio,
                      abortSignal,
                      onPollProgress,
                    })
                : iterateDreaminaText2Video({
                    cliBin,
                    prompt: prompt.trim(),
                    nodeId: nodeId.trim(),
                    modelVersion: modelVersionStr,
                    ratio: ratioStr,
                    resolutionType: resolutionTypeStr,
                    count: safeCount,
                    outDir,
                    durationSeconds: videoDurationSeconds,
                    withAudio: videoWithAudio,
                    abortSignal,
                    onPollProgress,
                  })
            ;
            for await (const url of iterator) {
              urls.push(url);
              send({ event: "image", url });
            }
            const creditsAfter = await getTotalCredit(cliBin);
            const costPerImage =
              typeof creditsBefore === "number" &&
              typeof creditsAfter === "number" &&
              safeCount > 0
                ? (creditsBefore - creditsAfter) / safeCount
                : null;
            send({ event: "done", creditsAfter, costPerImage, imageUrls: urls });
            return;
          }
          const result = await generateViaDreaminaImage2Image({
            cliBin,
            prompt: prompt.trim(),
            nodeId: nodeId.trim(),
            modelVersion: modelVersionStr,
            ratio: ratioStr,
            resolutionType: resolutionTypeStr,
            count: safeCount,
            outDir,
            imageFiles,
            abortSignal,
            onPollProgress,
            onEachImage: (url) => send({ event: "image", url }),
          });
          send({
            event: "done",
            creditsAfter: result.creditsAfter,
            costPerImage: result.costPerImage,
            imageUrls: result.imageUrls,
          });
        });
      }

      if (isVideoMode) {
        const creditsBefore = await getTotalCredit(cliBin);
        const imageUrls: string[] = [];
        const iterator = hasVideoOrderedMaterials
          ? iterateDreaminaImage2Video({
                cliBin,
                prompt,
                nodeId: safeNodeId,
                modelVersion: modelVersionStr,
                ratio: ratioStr,
                resolutionType: resolutionTypeStr,
                count: safeCount,
                outDir,
                materialFiles: videoMaterialFiles,
                materialKinds: videoMaterialKinds,
                referenceMode: videoReferenceMode,
                durationSeconds: videoDurationSeconds,
                withAudio: videoWithAudio,
                abortSignal,
              })
          : imageFiles.length > 0
            ? iterateDreaminaImage2Video({
                  cliBin,
                  prompt,
                  nodeId: safeNodeId,
                  modelVersion: modelVersionStr,
                  ratio: ratioStr,
                  resolutionType: resolutionTypeStr,
                  count: safeCount,
                  outDir,
                  materialFiles: imageFiles,
                  materialKinds: imageFiles.map(() => "image" as const),
                  referenceMode: videoReferenceMode,
                  durationSeconds: videoDurationSeconds,
                  withAudio: videoWithAudio,
                  abortSignal,
                })
            : iterateDreaminaText2Video({
                cliBin,
                prompt,
                nodeId: safeNodeId,
                modelVersion: modelVersionStr,
                ratio: ratioStr,
                resolutionType: resolutionTypeStr,
                count: safeCount,
                outDir,
                durationSeconds: videoDurationSeconds,
                withAudio: videoWithAudio,
                abortSignal,
            });
        for await (const url of iterator) imageUrls.push(url);
        const creditsAfter = await getTotalCredit(cliBin);
        const costPerImage =
          typeof creditsBefore === "number" &&
          typeof creditsAfter === "number" &&
          safeCount > 0
            ? (creditsBefore - creditsAfter) / safeCount
            : null;

        return new Response(
          JSON.stringify({ imageUrls, creditsBefore, creditsAfter, costPerImage }),
          { status: 200 }
        );
      }

      const result = await generateViaDreaminaImage2Image({
        cliBin,
        prompt,
        nodeId: safeNodeId,
        modelVersion: modelVersionStr,
        ratio: ratioStr,
        resolutionType: resolutionTypeStr,
        count: safeCount,
        outDir,
        imageFiles,
        abortSignal,
      });

      return new Response(
        JSON.stringify(result),
        { status: 200 }
      );
    }

    // JSON fallback: text2image
    const body = await req.json().catch(() => null);
    const prompt = body?.prompt;
    const nodeId = body?.nodeId;
    if (typeof prompt !== "string" || prompt.trim().length < 1) {
      return new Response(
        JSON.stringify({ error: "`prompt` must be a non-empty string" }),
        { status: 400 }
      );
    }
    if (typeof nodeId !== "string" || nodeId.trim().length < 1) {
      return new Response(
        JSON.stringify({ error: "`nodeId` must be a non-empty string" }),
        { status: 400 }
      );
    }

    const safeNodeId = sanitizeNodeId(nodeId.trim());
    const isVideoMode = String(body?.mode || "").toLowerCase() === "video";
    const provider =
      !isVideoMode && String(body?.provider || "").trim().toLowerCase() === "aiwanwu"
        ? ("aiwanwu" as const)
        : ("dreamina" as const);
    const videoProvider =
      isVideoMode && String(body?.videoProvider || "").trim().toLowerCase() === "external_api"
        ? ("external_api" as const)
        : ("dreamina" as const);
    const videoDurationSecondsJson = isVideoMode ? parseDurationSeconds(body?.durationSeconds) : undefined;
    const videoWithAudioJson = isVideoMode ? parseWithAudioFlag(body?.withAudio) ?? false : undefined;
    const modelVersion =
      typeof body.modelVersion === "string" && body.modelVersion.trim()
        ? body.modelVersion.trim()
        : isVideoMode
          ? (process.env.JIMENG_VIDEO_MODEL_VERSION?.trim() || "seedance2.0fast")
          : (process.env.JIMENG_MODEL_VERSION?.trim() || "5.0");
    const ratio =
      typeof body.ratio === "string" && body.ratio.trim()
        ? body.ratio.trim()
        : (process.env.JIMENG_DEFAULT_RATIO?.trim() || "16:9");
    const resolutionType =
      typeof body.resolutionType === "string" && body.resolutionType.trim()
        ? body.resolutionType.trim()
        : isVideoMode
          ? (process.env.JIMENG_VIDEO_DEFAULT_RESOLUTION_TYPE?.trim() || "720p")
          : (process.env.JIMENG_DEFAULT_RESOLUTION_TYPE?.trim() || "2k");
    const count = Number(body.count ?? 1);
    const safeCount = Number.isFinite(count)
      ? isVideoMode
        ? Math.max(1, Math.min(getVideoModelMaxCount(modelVersion), count))
        : Math.max(1, Math.min(8, count))
      : 1;
    const bodyProviderId = isExternalImageApiProviderId(body?.externalApiProviderId)
      ? body.externalApiProviderId
      : undefined;
    const rawBodyImageUrls = (body as { imageUrls?: unknown } | null)?.imageUrls;
    const bodyImageUrls = Array.isArray(rawBodyImageUrls)
      ? rawBodyImageUrls
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter((value): value is string => Boolean(value))
      : undefined;
    const usesForopencodeVideo =
      isVideoMode && (videoProvider === "external_api" || isForopencodeVideoModel(modelVersion));

    if (isCloudDeployment()) {
      if (!isVideoMode && provider !== "aiwanwu") {
        return new Response(
          JSON.stringify({
            error: "云端版仅保留外部图片通道，请将图片 provider 切换为 GPT/aiwanwu。",
          }),
          { status: 400 }
        );
      }
      if (isVideoMode && !usesForopencodeVideo) {
        return new Response(
          JSON.stringify({
            error: "云端版不支持 dreamina 本地视频链路，请切换到外部视频 provider。",
          }),
          { status: 400 }
        );
      }
    }

    if (!isVideoMode && provider === "aiwanwu") {
      const aiwanwuPrompt = extractAiwanwuImagePromptDirectives(prompt.trim());
      if (!aiwanwuPrompt.prompt) {
        return new Response(
          JSON.stringify({ error: "透明背景指令之外，还需要输入实际提示词。" }),
          { status: 400 }
        );
      }
      if (false) {
        return new Response(
          JSON.stringify({ error: "GPT 图片模型当前最多支持 1 张参考图。请减少素材后再试。" }),
          { status: 400 }
        );
      }
      if (wantsStream) {
        return ndjsonStreamResponse(async (send) => {
          const result = await runAiwanwuText2ImageBatch({
            prompt: aiwanwuPrompt.prompt,
            nodeId: nodeId.trim(),
            modelVersion,
            ratio,
            resolutionType,
            count: safeCount,
            outDir,
            onEachImage: (url) => send({ event: "image", url }),
            referenceImageDataUrls: bodyImageUrls,
            providerId: bodyProviderId,
            imageQuality:
              body.imageQuality === "standard" || body.imageQuality === "high" || body.imageQuality === "hd"
                ? body.imageQuality
                : undefined,
            imageFormat: aiwanwuPrompt.imageFormat,
            onTaskProgress: (progress) =>
              send({
                event: "progress",
                submitId: progress.submitId,
                genStatus: progress.genStatus ?? null,
                progressPct: progress.progressPct ?? null,
                renderPhase: progress.renderPhase ?? null,
              }),
          });
          send({
            event: "done",
            creditsAfter: null,
            costPerImage: null,
            imageUrls: result.imageUrls,
            usage: result.usage,
          });
        });
      }

      const result = await runAiwanwuText2ImageBatch({
        prompt: aiwanwuPrompt.prompt,
        nodeId: nodeId.trim(),
        modelVersion,
        ratio,
        resolutionType,
        count: safeCount,
        outDir,
        referenceImageDataUrls: bodyImageUrls,
        providerId: bodyProviderId,
        imageQuality:
          body.imageQuality === "standard" || body.imageQuality === "high" || body.imageQuality === "hd"
            ? body.imageQuality
            : undefined,
        imageFormat: aiwanwuPrompt.imageFormat,
      });

      return new Response(
        JSON.stringify({
          imageUrls: result.imageUrls,
          usage: result.usage,
          creditsBefore: null,
          creditsAfter: null,
          costPerImage: null,
        }),
        { status: 200 }
      );
    }

    if (usesForopencodeVideo) {
      if (bodyImageUrls && bodyImageUrls.length > 0) {
        return new Response(
          JSON.stringify({
            error: "Grok 视频模型当前接入仅支持文生视频，不支持参考图、参考视频或首尾帧素材。",
          }),
          { status: 400 }
        );
      }
      if (wantsStream) {
        return ndjsonStreamResponse(async (send) => {
          const urls = await runForopencodeText2Video({
            prompt: prompt.trim(),
            nodeId: nodeId.trim(),
            modelVersion,
            ratio,
            resolutionType,
            count: safeCount,
            durationSeconds: videoDurationSecondsJson,
            outDir,
            abortSignal,
            onPollProgress: (progress) =>
              send({
                event: "progress",
                submitId: progress.submitId,
                genStatus: progress.genStatus ?? null,
                progressPct: progress.progressPct ?? null,
                renderPhase: progress.renderPhase ?? null,
              }),
          });
          for (const url of urls) send({ event: "image", url });
          send({
            event: "done",
            creditsAfter: null,
            costPerImage: null,
            imageUrls: urls,
          });
        });
      }

      const imageUrls = await runForopencodeText2Video({
        prompt: prompt.trim(),
        nodeId: nodeId.trim(),
        modelVersion,
        ratio,
        resolutionType,
        count: safeCount,
        durationSeconds: videoDurationSecondsJson,
        outDir,
        abortSignal,
      });

      return new Response(
        JSON.stringify({
          imageUrls,
          creditsBefore: null,
          creditsAfter: null,
          costPerImage: null,
        }),
        { status: 200 }
      );
    }

    if (wantsStream) {
      return ndjsonStreamResponse(async (send) => {
        const onPollProgress = (p: DreaminaPollProgress) => {
          send({
            event: "progress",
            submitId: p.submitId,
            genStatus: p.genStatus ?? null,
            queueLength: p.queueLength ?? null,
            queueIdx: p.queueIdx ?? null,
            queueStatus: p.queueStatus ?? null,
            waitedMs: p.waitedMs,
            queueRemainPct: p.queueRemainPct ?? null,
            renderPhase: p.renderPhase ?? null,
          });
        };
        if (isVideoMode) {
          const creditsBefore = await getTotalCredit(cliBin);
          const urls: string[] = [];
          const iterator = iterateDreaminaText2Video({
              cliBin,
              prompt: prompt.trim(),
              nodeId: nodeId.trim(),
              modelVersion,
              ratio,
              resolutionType,
              count: safeCount,
              outDir,
              durationSeconds: videoDurationSecondsJson,
              withAudio: videoWithAudioJson,
              abortSignal,
              onPollProgress,
            })
          ;
          for await (const url of iterator) {
            urls.push(url);
            send({ event: "image", url });
          }
          const creditsAfter = await getTotalCredit(cliBin);
          const costPerImage =
            typeof creditsBefore === "number" &&
            typeof creditsAfter === "number" &&
            safeCount > 0
              ? (creditsBefore - creditsAfter) / safeCount
              : null;
          send({ event: "done", creditsAfter, costPerImage, imageUrls: urls });
          return;
        }
        const result = await generateViaDreaminaText2Image({
          cliBin,
          prompt: prompt.trim(),
          nodeId: nodeId.trim(),
          modelVersion,
          ratio,
          resolutionType,
          count: safeCount,
          outDir,
          abortSignal,
          onPollProgress,
          onEachImage: (url) => send({ event: "image", url }),
        });
        send({
          event: "done",
          creditsAfter: result.creditsAfter,
          costPerImage: result.costPerImage,
          imageUrls: result.imageUrls,
        });
      });
    }

    if (isVideoMode) {
      const creditsBefore = await getTotalCredit(cliBin);
      const imageUrls: string[] = [];
      const iterator = iterateDreaminaText2Video({
          cliBin,
          prompt,
          nodeId: safeNodeId,
          modelVersion,
          ratio,
          resolutionType,
          count: safeCount,
          outDir,
          durationSeconds: videoDurationSecondsJson,
          withAudio: videoWithAudioJson,
          abortSignal,
        })
      ;
      for await (const url of iterator) imageUrls.push(url);
      const creditsAfter = await getTotalCredit(cliBin);
      const costPerImage =
        typeof creditsBefore === "number" &&
        typeof creditsAfter === "number" &&
        safeCount > 0
          ? (creditsBefore - creditsAfter) / safeCount
          : null;

      return new Response(
        JSON.stringify({ imageUrls, creditsBefore, creditsAfter, costPerImage }),
        { status: 200 }
      );
    }

    const result = await generateViaDreaminaText2Image({
      cliBin,
      prompt,
      nodeId: safeNodeId,
      modelVersion,
      ratio,
      resolutionType,
      count: safeCount,
      outDir,
      abortSignal,
    });

    return new Response(
      JSON.stringify(result),
      { status: 200 }
    );
  } catch (e: unknown) {
    const raw = e instanceof Error ? e.message : "Generation failed";
    const details = {
      type: e instanceof Error ? e.name : "Error",
      message: clipText(String(raw), 2000),
    };
    return new Response(
      JSON.stringify({ error: "Generation failed", details }),
      { status: 500 }
    );
  }
}

