import { readExternalImageApiConfig } from "@/lib/externalImageApiConfig";
import {
  externalImageModelFallbacksForProvider,
  googleImageSizeFromRatio,
  defaultExternalImageModelForProvider,
  isGoogleExternalImageModel,
  isGoogleExternalImageProvider,
  looksLikeExternalImageModel,
  looksLikeExternalTextModel,
  type ExternalImageApiProviderId,
} from "@/lib/externalImageApiShared";
import {
  queryBanana2ImageTask,
  submitBanana2ImageTask,
  waitBanana2ImageTask,
} from "@/lib/banana2Image";

export const AIWANWU_DEFAULT_TEXT_MODEL = "gpt-5.4";
export const AIWANWU_DEFAULT_IMAGE_MODEL = "gpt-image-2-c";

const FALLBACK_TEXT_MODELS = [
  "gpt-4o-mini",
  "gpt-4.1",
  "gpt-5.4",
  "gpt-5.5",
  "o3",
] as const;

const AIWANWU_DEFAULT_TIMEOUT_MS = 90_000;
const AIWANWU_IMAGE_GEN_TIMEOUT_MS = 240_000;
const AIWANWU_TEXT_TIMEOUT_MS = 120_000;

const FOROPENCODE_IMAGE_MODEL_ALIASES: Record<string, string> = {
  "gpt-draw-2048x2048": "gpt-image-2",
  "gpt-draw-3840x2160": "gpt-image-2",
};

const FOROPENCODE_3840_SAFE_SIZES: Record<string, string> = {
  "1:1": "2480x2480",
  "16:9": "3328x1872",
  "9:16": "1872x3328",
  "4:3": "2880x2160",
  "3:4": "2160x2880",
  "3:2": "3056x2032",
  "2:3": "2032x3056",
  "5:4": "2784x2224",
  "4:5": "2224x2784",
  "21:9": "3808x1632",
  "7:1": "3808x544",
};

type AiwanwuUsage = {
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  cost?: number;
  currency?: string;
};

type AiwanwuImageResult = {
  id?: string;
  model?: string;
  created?: number;
  usage?: AiwanwuUsage;
  data?: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
};

function timeoutMsForPath(
  pathname: string,
  providerId?: ExternalImageApiProviderId
) {
  const path = pathname.trim().toLowerCase();
  if (path === "/models") return AIWANWU_DEFAULT_TIMEOUT_MS;
  if (path.startsWith("/v1beta/models/")) return AIWANWU_IMAGE_GEN_TIMEOUT_MS;
  if (path.includes("/images/generations") || path.includes("/images/edits")) {
    return AIWANWU_IMAGE_GEN_TIMEOUT_MS;
  }
  if (path.includes("/chat/completions")) {
    return providerId === "google"
      ? AIWANWU_IMAGE_GEN_TIMEOUT_MS
      : AIWANWU_TEXT_TIMEOUT_MS;
  }
  return AIWANWU_DEFAULT_TIMEOUT_MS;
}

function isBanana2ExternalImageProvider(
  providerId: ExternalImageApiProviderId | null | undefined
) {
  return providerId === "banana2";
}

function isBanana2ExternalImageModel(model: string | null | undefined) {
  const value = typeof model === "string" ? model.trim().toLowerCase() : "";
  return value === "banana2";
}

function banana2SizeFromResolution(size: string) {
  const value = size.trim().toLowerCase();
  if (value === "1k") return "1K";
  if (value === "4k" || value === "gpt-4k") return "4K";
  return "2K";
}

export function resolveAiwanwuImageSize(
  model: string | undefined,
  ratioOrSize: string,
  resolutionType?: string | null
) {
  const mv = typeof model === "string" ? model.trim().toLowerCase() : "";
  if (isGoogleExternalImageModel(mv)) {
    return googleImageSizeFromRatio(ratioOrSize, resolutionType);
  }
  if (mv === "gpt-draw-2048x2048") return "2048x2048";
  if (mv === "gpt-draw-3840x2160") {
    const normalized = ratioOrSize.trim().replace(/\s+/g, "");
    const directHit = FOROPENCODE_3840_SAFE_SIZES[normalized];
    if (directHit) return directHit;

    const parsed = normalized.match(/^(\d+(?:\.\d+)?)(?::|[xX×])(\d+(?:\.\d+)?)$/);
    if (!parsed) return ratioOrSize;

    const width = Number(parsed[1]);
    const height = Number(parsed[2]);
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return ratioOrSize;
    }

    const targetAspect = width / height;
    let bestSize = "3328x1872";
    let bestDelta = Number.POSITIVE_INFINITY;

    for (const safeSize of Object.values(FOROPENCODE_3840_SAFE_SIZES)) {
      const sizeMatch = safeSize.match(/^(\d+)[xX](\d+)$/);
      if (!sizeMatch) continue;
      const safeWidth = Number(sizeMatch[1]);
      const safeHeight = Number(sizeMatch[2]);
      if (
        !Number.isFinite(safeWidth) ||
        !Number.isFinite(safeHeight) ||
        safeWidth <= 0 ||
        safeHeight <= 0
      ) {
        continue;
      }
      const delta = Math.abs(targetAspect - safeWidth / safeHeight);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestSize = safeSize;
      }
    }

    return bestSize;
  }
  return ratioOrSize;
}

function resolveAiwanwuImageRequestModel(
  model: string | undefined,
  providerImageModel: string | undefined
) {
  const raw =
    typeof model === "string" && model.trim()
      ? model.trim()
      : typeof providerImageModel === "string" && providerImageModel.trim()
        ? providerImageModel.trim()
        : AIWANWU_DEFAULT_IMAGE_MODEL;
  const mv = raw.toLowerCase();
  if (FOROPENCODE_IMAGE_MODEL_ALIASES[mv]) {
    return FOROPENCODE_IMAGE_MODEL_ALIASES[mv]!;
  }
  return raw;
}

async function buildAiwanwuUrl(
  pathname: string,
  providerId?: ExternalImageApiProviderId
) {
  const config = await readExternalImageApiConfig();
  const resolvedProviderId =
    providerId && config.providers[providerId]
      ? providerId
      : config.activeProviderId;
  const provider = config.providers[resolvedProviderId];
  const baseUrl =
    pathname.startsWith("/v1beta/") && /\/v1$/i.test(provider.baseUrl)
      ? provider.baseUrl.replace(/\/v1$/i, "")
      : provider.baseUrl;
  return `${baseUrl}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

async function readErrorBody(resp: Response) {
  const text = await resp.text().catch(() => "");
  if (!text.trim()) return `Upstream request failed with status ${resp.status}`;
  if (/<html/i.test(text) || /<!doctype html/i.test(text)) {
    return `aiwanwu upstream request failed with status ${resp.status}`;
  }
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: string };
      message?: string;
    };
    return parsed.error?.message || parsed.message || text;
  } catch {
    return text;
  }
}

function summarizeUpstreamBody(text: string, limit = 180) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}...`;
}

async function readJsonBody<T>(resp: Response, context: string) {
  const text = await resp.text().catch(() => "");
  if (!text.trim()) {
    throw new Error(
      `${context} 返回为空，请检查 API 地址是否指向兼容 OpenAI 的 /v1 服务。`
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `${context} 返回的不是 JSON，请检查 API 地址是否正确。响应片段：${summarizeUpstreamBody(
        text
      )}`
    );
  }
}

function normalizeUsage(raw: Record<string, unknown> | null | undefined) {
  if (!raw || typeof raw !== "object") return undefined;
  const total =
    typeof raw.total_tokens === "number"
      ? raw.total_tokens
      : typeof raw.totalTokenCount === "number"
        ? raw.totalTokenCount
        : undefined;
  const input =
    typeof raw.input_tokens === "number"
      ? raw.input_tokens
      : typeof raw.prompt_tokens === "number"
        ? raw.prompt_tokens
        : typeof raw.promptTokenCount === "number"
          ? raw.promptTokenCount
          : undefined;
  const output =
    typeof raw.output_tokens === "number"
      ? raw.output_tokens
      : typeof raw.completion_tokens === "number"
        ? raw.completion_tokens
        : typeof raw.candidatesTokenCount === "number"
          ? raw.candidatesTokenCount
          : undefined;
  const cost =
    typeof raw.cost === "number"
      ? raw.cost
      : typeof raw.total_cost === "number"
        ? raw.total_cost
        : typeof raw.totalCost === "number"
          ? raw.totalCost
          : undefined;
  const currency =
    typeof raw.currency === "string" && raw.currency.trim()
      ? raw.currency.trim()
      : typeof raw.cost_currency === "string" && raw.cost_currency.trim()
        ? raw.cost_currency.trim()
        : undefined;
  if (
    typeof total !== "number" &&
    typeof input !== "number" &&
    typeof output !== "number" &&
    typeof cost !== "number"
  ) {
    return undefined;
  }
  return {
    total_tokens: total,
    input_tokens: input,
    output_tokens: output,
    cost,
    currency,
  } satisfies AiwanwuUsage;
}

function normalizeUsageFromResponse(
  usage: Record<string, unknown> | null | undefined,
  response: Record<string, unknown> | null | undefined
) {
  const fromUsage = normalizeUsage(usage);
  const fromResponse = normalizeUsage(response);
  if (!fromUsage && !fromResponse) return undefined;
  return {
    ...fromResponse,
    ...fromUsage,
    cost: fromUsage?.cost ?? fromResponse?.cost,
    currency: fromUsage?.currency ?? fromResponse?.currency,
  } satisfies AiwanwuUsage;
}

export async function aiwanwuFetch(
  pathname: string,
  init?: RequestInit,
  providerId?: ExternalImageApiProviderId
) {
  const config = await readExternalImageApiConfig();
  const resolvedProviderId =
    providerId && config.providers[providerId]
      ? providerId
      : config.activeProviderId;
  const provider = config.providers[resolvedProviderId];
  const timeoutMs = timeoutMsForPath(pathname, resolvedProviderId);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal =
    init?.signal && typeof AbortSignal.any === "function"
      ? AbortSignal.any([init.signal, timeoutSignal])
      : init?.signal ?? timeoutSignal;

  try {
    return await fetch(await buildAiwanwuUrl(pathname, resolvedProviderId), {
      ...init,
      signal,
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      throw new Error(`外部 GPT 请求超时，${Math.round(timeoutMs / 1000)} 秒内未返回结果。`);
    }
    throw error;
  }
}

export async function fetchAiwanwuModels(providerId?: ExternalImageApiProviderId) {
  if (providerId === "banana2") {
    return [defaultExternalImageModelForProvider("banana2")];
  }
  const resp = await aiwanwuFetch("/models", undefined, providerId);
  if (!resp.ok) {
    throw new Error(await readErrorBody(resp));
  }
  const json = await readJsonBody<{
    data?: Array<{ id?: string }>;
  }>(resp, "模型列表接口");
  return (json.data ?? [])
    .map((item) => item.id?.trim())
    .filter((id): id is string => Boolean(id));
}

export function getFallbackTextModels() {
  return [...FALLBACK_TEXT_MODELS];
}

export function getFallbackImageModels(providerId?: ExternalImageApiProviderId) {
  return getSupplementalImageModels(providerId);
}

export function getSupplementalImageModels(providerId?: ExternalImageApiProviderId) {
  return externalImageModelFallbacksForProvider(providerId ?? "default_gpt");
}

export function filterAiwanwuTextModels(models: string[]) {
  return models.filter((id) => looksLikeExternalTextModel(id));
}

export function filterAiwanwuImageModels(models: string[]) {
  return models.filter((id) => looksLikeExternalImageModel(id));
}

function normalizeAssistantContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return part.text;
      }
      return "";
    })
    .join("")
    .trim();
}

function collectDataUrlsFromString(text: string) {
  const matches = text.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n-]+/g);
  if (!matches) return [];
  return matches.map((value) => value.replace(/\s+/g, ""));
}

function dataUrlToResult(url: string) {
  const match = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i);
  if (!match?.[2]) return null;
  return {
    b64_json: match[2].replace(/\s+/g, ""),
  };
}

function parseDataUrl(url: string) {
  const match = url.match(/^data:([^;,]+);base64,(.+)$/i);
  if (!match?.[1] || !match?.[2]) return null;
  return {
    mimeType: match[1].trim(),
    data: match[2].replace(/\s+/g, ""),
  };
}

function appendCollectedImage(
  output: Array<{ url?: string; b64_json?: string }>,
  seen: Set<string>,
  image: { url?: string; b64_json?: string } | null
) {
  if (!image) return;
  const key =
    typeof image.b64_json === "string" && image.b64_json.trim()
      ? `b64:${image.b64_json.trim().slice(0, 48)}`
      : typeof image.url === "string" && image.url.trim()
        ? `url:${image.url.trim()}`
        : "";
  if (!key || seen.has(key)) return;
  seen.add(key);
  output.push(image);
}

function collectImagesFromUnknown(
  value: unknown,
  output: Array<{ url?: string; b64_json?: string }>,
  seen: Set<string>,
  depth = 0
) {
  if (depth > 8 || output.length >= 8) return;

  if (typeof value === "string") {
    for (const match of collectDataUrlsFromString(value)) {
      appendCollectedImage(output, seen, dataUrlToResult(match));
    }
    return;
  }

  if (!value || typeof value !== "object") return;

  if (Array.isArray(value)) {
    for (const item of value.slice(0, 32)) {
      collectImagesFromUnknown(item, output, seen, depth + 1);
      if (output.length >= 8) break;
    }
    return;
  }

  const record = value as Record<string, unknown>;
  const inlineData =
    record.inlineData && typeof record.inlineData === "object"
      ? (record.inlineData as Record<string, unknown>)
      : null;
  if (
    inlineData &&
    typeof inlineData.mimeType === "string" &&
    inlineData.mimeType.startsWith("image/") &&
    typeof inlineData.data === "string" &&
    inlineData.data.trim()
  ) {
    appendCollectedImage(output, seen, {
      b64_json: inlineData.data.trim(),
    });
  }

  if (typeof record.url === "string" && record.url.startsWith("data:image/")) {
    appendCollectedImage(output, seen, dataUrlToResult(record.url));
  }

  if (
    record.image_url &&
    typeof record.image_url === "object" &&
    typeof (record.image_url as Record<string, unknown>).url === "string"
  ) {
    const imageUrl = (record.image_url as Record<string, unknown>).url as string;
    if (imageUrl.startsWith("data:image/")) {
      appendCollectedImage(output, seen, dataUrlToResult(imageUrl));
    } else {
      appendCollectedImage(output, seen, { url: imageUrl.trim() });
    }
  }

  for (const key of Object.keys(record).slice(0, 24)) {
    collectImagesFromUnknown(record[key], output, seen, depth + 1);
    if (output.length >= 8) break;
  }
}

function guessRatioLabelFromSize(size: string) {
  const parsed = size.match(/^(\d+)[xX](\d+)$/);
  if (!parsed) return "1:1";
  const width = Number(parsed[1]);
  const height = Number(parsed[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "1:1";
  }
  const aspect = width / height;
  const options = [
    { label: "1:1", aspect: 1 },
    { label: "4:3", aspect: 4 / 3 },
    { label: "3:4", aspect: 3 / 4 },
    { label: "16:9", aspect: 16 / 9 },
    { label: "9:16", aspect: 9 / 16 },
    { label: "3:2", aspect: 3 / 2 },
    { label: "2:3", aspect: 2 / 3 },
    { label: "21:9", aspect: 21 / 9 },
    { label: "7:1", aspect: 7 },
  ];
  let best = options[0]!;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const option of options) {
    const delta = Math.abs(aspect - option.aspect);
    if (delta < bestDelta) {
      best = option;
      bestDelta = delta;
    }
  }
  return best.label;
}

function buildGoogleImagePrompt(input: {
  prompt: string;
  size: string;
  imageFormat?: "jpg" | "png";
  quality?: "standard" | "high" | "hd";
}) {
  const ratio = guessRatioLabelFromSize(input.size);
  const qualityHint =
    input.quality === "hd"
      ? "高细节"
      : input.quality === "high"
        ? "高质量"
        : "标准质量";
  const backgroundHint =
    input.imageFormat === "png"
      ? "背景尽量透明，并输出 PNG。"
      : input.imageFormat === "jpg"
        ? "背景正常输出，并输出 JPG 或 PNG。"
        : "直接输出最终图片。";

  return [
    input.prompt.trim(),
    "",
    "【输出要求】",
    `- 画幅比例：${ratio}`,
    `- 目标尺寸：${input.size}（若不能精确指定，请保持相同比例）`,
    `- 质量偏好：${qualityHint}`,
    `- ${backgroundHint}`,
    "- 仅返回最终图片。",
  ].join("\n");
}

async function generateChatCompletionsImage(input: {
  prompt: string;
  model: string;
  size: string;
  providerId: ExternalImageApiProviderId;
  imageDataUrls?: string[];
  quality?: "standard" | "high" | "hd";
  imageFormat?: "jpg" | "png";
  contextLabel?: string;
}) {
  const trimmedImages = Array.isArray(input.imageDataUrls)
    ? input.imageDataUrls
        .map((url) => (typeof url === "string" ? url.trim() : ""))
        .filter((url): url is string => Boolean(url))
    : [];

  const userContent =
    trimmedImages.length > 0
      ? [
          {
            type: "text",
            text: buildGoogleImagePrompt({
              prompt: input.prompt,
              size: input.size,
              quality: input.quality,
              imageFormat: input.imageFormat,
            }),
          },
          ...trimmedImages.map((url) => ({
            type: "image_url" as const,
            image_url: { url },
          })),
        ]
      : buildGoogleImagePrompt({
          prompt: input.prompt,
          size: input.size,
          quality: input.quality,
          imageFormat: input.imageFormat,
        });

  const resp = await aiwanwuFetch(
    "/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        messages: [{ role: "user", content: userContent }],
      }),
    },
    input.providerId
  );

  if (!resp.ok) {
    throw new Error(await readErrorBody(resp));
  }

  const json = await readJsonBody<{
    id?: string;
    model?: string;
    usage?: Record<string, unknown>;
    choices?: Array<{
      message?: {
        content?: unknown;
      };
    }>;
  }>(resp, "Google 图片接口");

  const images: Array<{ url?: string; b64_json?: string }> = [];
  collectImagesFromUnknown(json.choices?.[0]?.message?.content, images, new Set());
  if (images.length === 0) {
    collectImagesFromUnknown(json, images, new Set());
  }
  if (images.length === 0) {
    throw new Error("Google 图片接口未返回图片内容。");
  }

  return {
    id: json.id,
    model: json.model || input.model,
    created: Math.floor(Date.now() / 1000),
    usage: normalizeUsageFromResponse(json.usage, json as Record<string, unknown>),
    data: images,
  } satisfies AiwanwuImageResult;
}

async function generateReferenceChatImage(input: {
  prompt: string;
  model: string;
  size: string;
  providerId: ExternalImageApiProviderId;
  imageDataUrls: string[];
  quality?: "standard" | "high" | "hd";
  imageFormat?: "jpg" | "png";
}) {
  const trimmedImages = input.imageDataUrls
    .map((url) => (typeof url === "string" ? url.trim() : ""))
    .filter((url): url is string => Boolean(url));

  const userContent = [
    {
      type: "text",
      text: buildGoogleImagePrompt({
        prompt: input.prompt,
        size: input.size,
        quality: input.quality,
        imageFormat: input.imageFormat,
      }),
    },
    ...trimmedImages.map((url) => ({
      type: "image_url" as const,
      image_url: { url },
    })),
  ];

  const resp = await aiwanwuFetch(
    "/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        messages: [{ role: "user", content: userContent }],
      }),
    },
    input.providerId
  );

  if (!resp.ok) {
    throw new Error(await readErrorBody(resp));
  }

  const json = await readJsonBody<{
    id?: string;
    model?: string;
    usage?: Record<string, unknown>;
    choices?: Array<{
      message?: {
        content?: unknown;
      };
    }>;
  }>(resp, "多参考图图片接口");

  const images: Array<{ url?: string; b64_json?: string }> = [];
  collectImagesFromUnknown(json.choices?.[0]?.message?.content, images, new Set());
  if (images.length === 0) {
    collectImagesFromUnknown(json, images, new Set());
  }
  if (images.length === 0) {
    throw new Error("上游未返回图片内容。");
  }

  return {
    id: json.id,
    model: json.model || input.model,
    created: Math.floor(Date.now() / 1000),
    usage: normalizeUsageFromResponse(json.usage, json as Record<string, unknown>),
    data: images,
  } satisfies AiwanwuImageResult;
}

async function generateGoogleGeminiNativeImage(input: {
  prompt: string;
  model: string;
  size: string;
  providerId: ExternalImageApiProviderId;
  imageDataUrls?: string[];
  quality?: "standard" | "high" | "hd";
  imageFormat?: "jpg" | "png";
}) {
  const parts: Array<Record<string, unknown>> = [
    {
      text: buildGoogleImagePrompt({
        prompt: input.prompt,
        size: input.size,
        quality: input.quality,
        imageFormat: input.imageFormat,
      }),
    },
  ];

  for (const url of input.imageDataUrls ?? []) {
    const parsed = parseDataUrl(url);
    if (!parsed) continue;
    parts.push({
      inlineData: {
        mimeType: parsed.mimeType,
        data: parsed.data,
      },
    });
  }

  const resp = await aiwanwuFetch(
    `/v1beta/models/${encodeURIComponent(input.model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
        },
      }),
    },
    input.providerId
  );

  if (!resp.ok) {
    throw new Error(await readErrorBody(resp));
  }

  const json = await readJsonBody<Record<string, unknown>>(
    resp,
    "Gemini 原生图片接口"
  );

  const images: Array<{ url?: string; b64_json?: string }> = [];
  collectImagesFromUnknown(json, images, new Set());
  if (images.length === 0) {
    throw new Error("Gemini 原生图片接口未返回图片内容。");
  }

  return {
    id:
      typeof json.responseId === "string"
        ? json.responseId
        : typeof json.id === "string"
          ? json.id
          : undefined,
    model: input.model,
    created: Math.floor(Date.now() / 1000),
    usage: normalizeUsageFromResponse(json.usageMetadata as Record<string, unknown> | undefined, json),
    data: images,
  } satisfies AiwanwuImageResult;
}

export async function generateAiwanwuText(input: {
  prompt: string;
  model?: string;
  systemPrompt?: string;
  providerId?: ExternalImageApiProviderId;
  imageDataUrls?: string[];
}) {
  const config = await readExternalImageApiConfig();
  const resolvedProviderId =
    input.providerId && config.providers[input.providerId]
      ? input.providerId
      : config.activeProviderId;
  const provider = config.providers[resolvedProviderId];
  const trimmedImages = Array.isArray(input.imageDataUrls)
    ? input.imageDataUrls
        .map((url) => (typeof url === "string" ? url.trim() : ""))
        .filter((url): url is string => Boolean(url))
    : [];
  const userContent =
    trimmedImages.length > 0
      ? [
          { type: "text", text: input.prompt.trim() },
          ...trimmedImages.map((url) => ({
            type: "image_url" as const,
            image_url: { url },
          })),
        ]
      : input.prompt.trim();
  const body = {
    model: input.model?.trim() || provider.textModel || AIWANWU_DEFAULT_TEXT_MODEL,
    messages: [
      ...(input.systemPrompt?.trim()
        ? [{ role: "system", content: input.systemPrompt.trim() }]
        : []),
      { role: "user", content: userContent },
    ],
  };

  const resp = await aiwanwuFetch(
    "/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    resolvedProviderId
  );

  if (!resp.ok) {
    throw new Error(await readErrorBody(resp));
  }

  const json = await readJsonBody<{
    model?: string;
    choices?: Array<{
      message?: { content?: unknown };
    }>;
    usage?: Record<string, unknown>;
  }>(resp, "文本推理接口");

  return {
    model: json.model || body.model,
    text: normalizeAssistantContent(json.choices?.[0]?.message?.content),
    usage: json.usage ?? null,
  };
}

export async function generateAiwanwuImage(input: {
  prompt: string;
  model?: string;
  size?: string;
  providerId?: ExternalImageApiProviderId;
  quality?: "standard" | "high" | "hd";
  imageFormat?: "jpg" | "png";
  imageDataUrls?: string[];
}) {
  const config = await readExternalImageApiConfig();
  const resolvedProviderId =
    input.providerId && config.providers[input.providerId]
      ? input.providerId
      : config.activeProviderId;
  const provider = config.providers[resolvedProviderId];
  const requestModel = resolveAiwanwuImageRequestModel(
    input.model,
    provider.imageModel
  );
  const requestSize = resolveAiwanwuImageSize(
    requestModel,
    input.size?.trim() || "1024x1024"
  );
  const hasReferenceImages =
    Array.isArray(input.imageDataUrls) && input.imageDataUrls.length > 0;

  if (
    isGoogleExternalImageProvider(resolvedProviderId) ||
    isGoogleExternalImageModel(requestModel)
  ) {
    try {
      return await generateChatCompletionsImage({
        prompt: input.prompt,
        model: requestModel,
        size: requestSize,
        providerId: resolvedProviderId,
        imageDataUrls: input.imageDataUrls,
        quality: input.quality,
        imageFormat: input.imageFormat,
      });
    } catch (error) {
      if (requestModel.trim().toLowerCase() === "gemini-3.1-flash-image-preview-c") {
        return await generateGoogleGeminiNativeImage({
          prompt: input.prompt,
          model: requestModel,
          size: requestSize,
          providerId: resolvedProviderId,
          imageDataUrls: input.imageDataUrls,
          quality: input.quality,
          imageFormat: input.imageFormat,
        });
      }
      throw error;
    }
  }

  if (
    isBanana2ExternalImageProvider(resolvedProviderId) ||
    isBanana2ExternalImageModel(requestModel)
  ) {
    const submitted = await submitBanana2ImageTask({
      prompt: input.prompt,
      size: banana2SizeFromResolution(input.size?.trim() || "2k"),
      ratio: input.size?.trim() || "1:1",
      imageUrls: Array.isArray(input.imageDataUrls)
        ? input.imageDataUrls
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .filter((value): value is string => /^https?:\/\//i.test(value) || /^data:image\//i.test(value))
        : undefined,
    });
    const done = await waitBanana2ImageTask({
      taskId: submitted.taskId,
    });
    if (done.status === "failed") {
      throw new Error(done.failReason || "香蕉生图失败。");
    }
    return {
      id: submitted.taskId,
      model: requestModel,
      created: Math.floor(Date.now() / 1000),
      usage: submitted.cost
        ? {
            cost: submitted.cost,
            currency: "$",
          }
        : undefined,
      data: [
        {
          url: done.imageUrl,
        },
      ],
    } satisfies AiwanwuImageResult;
  }

  if (hasReferenceImages) {
    return await generateReferenceChatImage({
      prompt: input.prompt,
      model: requestModel,
      size: requestSize,
      providerId: resolvedProviderId,
      imageDataUrls: input.imageDataUrls!,
      quality: input.quality,
      imageFormat: input.imageFormat,
    });
  }

  if (false) {
    throw new Error("当前图片通道不支持多参考图，请切换到 Google 通道。");
  }

  const body = {
    model: requestModel,
    prompt: input.prompt.trim(),
    size: requestSize,
    ...(input.quality ? { quality: input.quality } : {}),
    ...(input.imageFormat === "png"
      ? { background: "transparent" }
      : input.imageFormat === "jpg"
        ? { background: "opaque" }
        : {}),
  };

  const resp = await aiwanwuFetch(
    "/images/generations",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    resolvedProviderId
  );

  if (!resp.ok) {
    throw new Error(await readErrorBody(resp));
  }

  const json = (await resp.json()) as AiwanwuImageResult & Record<string, unknown>;
  return {
    ...json,
    usage: normalizeUsageFromResponse(
      json.usage as Record<string, unknown> | undefined,
      json
    ),
  };
}

export async function generateAiwanwuImageEdit(input: {
  prompt: string;
  image?: File;
  images?: File[];
  mask?: File | null;
  model?: string;
  size?: string;
  providerId?: ExternalImageApiProviderId;
  quality?: "standard" | "high" | "hd";
  imageFormat?: "jpg" | "png";
}) {
  const config = await readExternalImageApiConfig();
  const resolvedProviderId =
    input.providerId && config.providers[input.providerId]
      ? input.providerId
      : config.activeProviderId;
  const provider = config.providers[resolvedProviderId];
  const requestModel = resolveAiwanwuImageRequestModel(
    input.model,
    provider.imageModel
  );
  const inputImages = Array.isArray(input.images)
    ? input.images.filter((file): file is File => file instanceof File && file.size > 0)
    : input.image instanceof File && input.image.size > 0
      ? [input.image]
      : [];

  if (
    isGoogleExternalImageProvider(resolvedProviderId) ||
    isGoogleExternalImageModel(requestModel)
  ) {
    throw new Error("Google 图像通道当前不支持编辑端点，请改用生图节点的参考图模式。");
  }

  const fd = new FormData();
  fd.append("model", requestModel);
  fd.append("prompt", input.prompt.trim());
  fd.append("size", input.size?.trim() || "1024x1024");
  if (input.quality) {
    fd.append("quality", input.quality);
  }
  if (input.imageFormat === "png") {
    fd.append("background", "transparent");
  } else if (input.imageFormat === "jpg") {
    fd.append("background", "opaque");
  }
  if (inputImages.length === 0) {
    throw new Error("`image` is required for image edit");
  }
  for (const image of inputImages) {
    fd.append("image", image, image.name || "reference.png");
  }
  if (input.mask) {
    fd.append("mask", input.mask, input.mask.name || "mask.png");
  }

  const resp = await aiwanwuFetch(
    "/images/edits",
    {
      method: "POST",
      body: fd,
    },
    resolvedProviderId
  );

  if (!resp.ok) {
    throw new Error(await readErrorBody(resp));
  }

  const json = (await resp.json()) as AiwanwuImageResult & Record<string, unknown>;
  return {
    ...json,
    usage: normalizeUsageFromResponse(
      json.usage as Record<string, unknown> | undefined,
      json
    ),
  };
}
