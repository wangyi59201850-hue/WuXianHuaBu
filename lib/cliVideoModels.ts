export type VideoResolutionOption = "480p" | "720p" | "1080p";
export type VideoReferenceModeSupport = "general" | "headtail" | "none";
export type VideoModelProvider = "dreamina" | "foropencode";

export type CliVideoModelRow = {
  value: string;
  title: string;
  time: string;
  desc: string;
  badge?: string;
  disabled?: boolean;
  provider: VideoModelProvider;
  ratioOptions: string[];
  resolutionOptions: VideoResolutionOption[];
  durationRange: {
    min: number;
    max: number;
  };
  defaultRatio: string;
  defaultResolution: VideoResolutionOption;
  defaultDuration: number;
  maxCount: number;
  supportsAudioToggle: boolean;
  referenceSupport: VideoReferenceModeSupport;
};

const DREAMINA_TEXT_RATIOS = ["1:1", "3:4", "16:9", "4:3", "9:16", "21:9"] as const;
const GROK_TEXT_RATIOS = ["1:1", "3:4", "16:9", "4:3", "9:16", "3:2", "2:3"] as const;

const UI_IMAGE_MODEL_TO_CLI: Record<string, string> = {
  "seedance1.0fast": "3.0fast",
  "seedance1.0": "3.0",
  "seedance1.0pro": "3.0pro",
  "seedance1.5pro": "3.5pro",
};

const LEGACY_CLI_IMAGE_MODEL_TO_UI: Record<string, string> = {
  "3.0fast": "seedance1.0fast",
  "3.0": "seedance1.0",
  "3.0pro": "seedance1.0pro",
  "3.5pro": "seedance1.5pro",
  "3.0_fast": "seedance1.0fast",
  "3.0_pro": "seedance1.0pro",
  "3.5_pro": "seedance1.5pro",
};

const TYPO_SEEDANCE_2X: Record<string, string> = {
  "seedance2.0faseVIP": "seedance2.0fast_vip",
  "seedance2.0vip": "seedance2.0_vip",
  "seedance2.0fastvip": "seedance2.0fast_vip",
  "seedance2.0_fastvip": "seedance2.0fast_vip",
};

export const GROK_VIDEO_TASK_PREFIX = "grok:";
export const EXTERNAL_VIDEO_TASK_URL_PREFIX = "videoapi:";

function buildGenericExternalVideoCapability(modelValue: string): CliVideoModelRow {
  return {
    value: modelValue.trim(),
    title: modelValue.trim(),
    time: "about 30-90s",
    desc: "External video API model.",
    provider: "foropencode",
    ratioOptions: [...GROK_TEXT_RATIOS],
    resolutionOptions: ["480p", "720p"],
    durationRange: { min: 1, max: 15 },
    defaultRatio: "16:9",
    defaultResolution: "720p",
    defaultDuration: 5,
    maxCount: 1,
    supportsAudioToggle: false,
    referenceSupport: "headtail",
  };
}

export function getExternalVideoModelFallbackCapability(modelValue: string) {
  return buildGenericExternalVideoCapability(modelValue);
}

export const CLI_VIDEO_MODEL_CATALOG: CliVideoModelRow[] = [
  {
    value: "grok-imagine-video",
    title: "grok-imagine-video",
    time: "about 30-90s",
    desc: "ForOpenCode Grok text-to-video. Current integration is prompt-only.",
    badge: "New",
    provider: "foropencode",
    ratioOptions: [...GROK_TEXT_RATIOS],
    resolutionOptions: ["480p", "720p"],
    durationRange: { min: 1, max: 15 },
    defaultRatio: "16:9",
    defaultResolution: "720p",
    defaultDuration: 5,
    maxCount: 1,
    supportsAudioToggle: false,
    referenceSupport: "headtail",
  },
  {
    value: "grok-imagine-1.0-video",
    title: "grok-imagine-1.0-video",
    time: "about 30-90s",
    desc: "ForOpenCode Grok legacy text-to-video entry. Current integration is prompt-only.",
    provider: "foropencode",
    ratioOptions: [...GROK_TEXT_RATIOS],
    resolutionOptions: ["480p", "720p"],
    durationRange: { min: 1, max: 15 },
    defaultRatio: "16:9",
    defaultResolution: "720p",
    defaultDuration: 5,
    maxCount: 1,
    supportsAudioToggle: false,
    referenceSupport: "headtail",
  },
  {
    value: "seedance2.0fast_vip",
    title: "seedance2.0fast_vip",
    time: "about 4-5s",
    desc: "Dreamina VIP fast lane, 720p, multimodal video.",
    badge: "New",
    provider: "dreamina",
    ratioOptions: [...DREAMINA_TEXT_RATIOS],
    resolutionOptions: ["720p"],
    durationRange: { min: 4, max: 15 },
    defaultRatio: "16:9",
    defaultResolution: "720p",
    defaultDuration: 5,
    maxCount: 2,
    supportsAudioToggle: true,
    referenceSupport: "general",
  },
  {
    value: "seedance2.0_vip",
    title: "seedance2.0_vip",
    time: "about 4-5s",
    desc: "Dreamina VIP lane, 720p, multimodal video.",
    badge: "New",
    provider: "dreamina",
    ratioOptions: [...DREAMINA_TEXT_RATIOS],
    resolutionOptions: ["720p"],
    durationRange: { min: 4, max: 15 },
    defaultRatio: "16:9",
    defaultResolution: "720p",
    defaultDuration: 5,
    maxCount: 2,
    supportsAudioToggle: true,
    referenceSupport: "general",
  },
  {
    value: "seedance2.0fast",
    title: "seedance2.0fast",
    time: "about 4-5s",
    desc: "Dreamina fast multimodal video, 720p.",
    provider: "dreamina",
    ratioOptions: [...DREAMINA_TEXT_RATIOS],
    resolutionOptions: ["720p"],
    durationRange: { min: 4, max: 15 },
    defaultRatio: "16:9",
    defaultResolution: "720p",
    defaultDuration: 5,
    maxCount: 2,
    supportsAudioToggle: true,
    referenceSupport: "general",
  },
  {
    value: "seedance2.0",
    title: "seedance2.0",
    time: "about 4-5s",
    desc: "Dreamina multimodal video, 720p.",
    provider: "dreamina",
    ratioOptions: [...DREAMINA_TEXT_RATIOS],
    resolutionOptions: ["720p"],
    durationRange: { min: 4, max: 15 },
    defaultRatio: "16:9",
    defaultResolution: "720p",
    defaultDuration: 5,
    maxCount: 2,
    supportsAudioToggle: true,
    referenceSupport: "general",
  },
  {
    value: "seedance1.0fast",
    title: "seedance1.0fast",
    time: "about 3-10s",
    desc: "Dreamina image-to-video fast lane, 720p/1080p.",
    provider: "dreamina",
    ratioOptions: [...DREAMINA_TEXT_RATIOS],
    resolutionOptions: ["720p", "1080p"],
    durationRange: { min: 3, max: 10 },
    defaultRatio: "16:9",
    defaultResolution: "720p",
    defaultDuration: 5,
    maxCount: 2,
    supportsAudioToggle: true,
    referenceSupport: "headtail",
  },
  {
    value: "seedance1.0",
    title: "seedance1.0",
    time: "about 3-10s",
    desc: "Dreamina image-to-video standard lane, 720p/1080p.",
    provider: "dreamina",
    ratioOptions: [...DREAMINA_TEXT_RATIOS],
    resolutionOptions: ["720p", "1080p"],
    durationRange: { min: 3, max: 10 },
    defaultRatio: "16:9",
    defaultResolution: "720p",
    defaultDuration: 5,
    maxCount: 2,
    supportsAudioToggle: true,
    referenceSupport: "headtail",
  },
  {
    value: "seedance1.0pro",
    title: "seedance1.0pro",
    time: "about 3-10s",
    desc: "Dreamina image-to-video pro lane, 1080p.",
    provider: "dreamina",
    ratioOptions: [...DREAMINA_TEXT_RATIOS],
    resolutionOptions: ["1080p"],
    durationRange: { min: 3, max: 10 },
    defaultRatio: "16:9",
    defaultResolution: "1080p",
    defaultDuration: 5,
    maxCount: 2,
    supportsAudioToggle: true,
    referenceSupport: "headtail",
  },
  {
    value: "seedance1.5pro",
    title: "seedance1.5pro",
    time: "about 4-12s",
    desc: "Dreamina image-to-video 3.5 pro lane, 720p/1080p.",
    provider: "dreamina",
    ratioOptions: [...DREAMINA_TEXT_RATIOS],
    resolutionOptions: ["720p", "1080p"],
    durationRange: { min: 4, max: 12 },
    defaultRatio: "16:9",
    defaultResolution: "720p",
    defaultDuration: 5,
    maxCount: 2,
    supportsAudioToggle: true,
    referenceSupport: "headtail",
  },
];

const VIDEO_MODEL_LOOKUP = new Map(
  CLI_VIDEO_MODEL_CATALOG.map((row) => [row.value.toLowerCase(), row])
);

export function canonicalizeVideoModelValue(raw: string): string {
  const t = raw.trim();
  const tl = t.toLowerCase();

  if (TYPO_SEEDANCE_2X[t]) return TYPO_SEEDANCE_2X[t];
  for (const [k, v] of Object.entries(TYPO_SEEDANCE_2X)) {
    if (k.toLowerCase() === tl) return v;
  }

  if (LEGACY_CLI_IMAGE_MODEL_TO_UI[t]) return LEGACY_CLI_IMAGE_MODEL_TO_UI[t];
  if (LEGACY_CLI_IMAGE_MODEL_TO_UI[tl]) return LEGACY_CLI_IMAGE_MODEL_TO_UI[tl];

  const hit = VIDEO_MODEL_LOOKUP.get(tl);
  return hit?.value ?? t;
}

export function mapUiVideoModelToCliModelVersion(ui: string): string {
  return UI_IMAGE_MODEL_TO_CLI[ui] ?? ui;
}

export function getVideoModelCapability(modelValue: string): CliVideoModelRow | null {
  const canonical = canonicalizeVideoModelValue(modelValue).toLowerCase();
  const hit = VIDEO_MODEL_LOOKUP.get(canonical);
  if (hit) return hit;
  if (canonical.includes("video")) {
    return buildGenericExternalVideoCapability(modelValue.trim());
  }
  return null;
}

export function getVideoModelCatalog() {
  return [...CLI_VIDEO_MODEL_CATALOG];
}

export function isForopencodeVideoModel(modelValue: string) {
  return getVideoModelCapability(modelValue)?.provider === "foropencode";
}

export function isDreaminaVideoModel(modelValue: string) {
  return getVideoModelCapability(modelValue)?.provider === "dreamina";
}

export function videoRatiosForModel(modelValue: string): string[] {
  return getVideoModelCapability(modelValue)?.ratioOptions ?? [...DREAMINA_TEXT_RATIOS];
}

export function normalizeVideoRatioForModel(modelValue: string, ratio: string | undefined): string {
  const caps = getVideoModelCapability(modelValue);
  const options = caps?.ratioOptions ?? [...DREAMINA_TEXT_RATIOS];
  const value = typeof ratio === "string" ? ratio.trim() : "";
  return options.includes(value) ? value : (caps?.defaultRatio ?? "16:9");
}

export function videoResolutionsForModel(modelValue: string): VideoResolutionOption[] {
  return getVideoModelCapability(modelValue)?.resolutionOptions ?? ["720p", "1080p"];
}

export function normalizeVideoResolutionForModel(
  modelValue: string,
  resolution: string | undefined
): VideoResolutionOption {
  const caps = getVideoModelCapability(modelValue);
  const options = caps?.resolutionOptions ?? ["720p", "1080p"];
  const value = typeof resolution === "string" ? resolution.trim().toLowerCase() : "";
  const hit = options.find((option) => option.toLowerCase() === value);
  return hit ?? (caps?.defaultResolution ?? options[0] ?? "720p");
}

export function getVideoDurationRange(modelValue: string) {
  return getVideoModelCapability(modelValue)?.durationRange ?? { min: 4, max: 15 };
}

export function clampVideoDurationForModel(modelValue: string, duration: number | undefined) {
  const caps = getVideoModelCapability(modelValue);
  const range = caps?.durationRange ?? { min: 4, max: 15 };
  const fallback = caps?.defaultDuration ?? 5;
  const raw = Number.isFinite(duration) ? Number(duration) : fallback;
  return Math.min(range.max, Math.max(range.min, raw));
}

export function getVideoModelDefaultSelection(modelValue: string) {
  const caps = getVideoModelCapability(modelValue);
  return {
    ratio: caps?.defaultRatio ?? "16:9",
    resolutionType: caps?.defaultResolution ?? "720p",
    durationSeconds: caps?.defaultDuration ?? 5,
  };
}

export function getVideoModelMaxCount(modelValue: string) {
  return getVideoModelCapability(modelValue)?.maxCount ?? 2;
}

export function videoModelSupportsAudioToggle(modelValue: string) {
  return Boolean(getVideoModelCapability(modelValue)?.supportsAudioToggle);
}

export function videoModelSupportsGeneralReference(modelValue: string) {
  return getVideoModelCapability(modelValue)?.referenceSupport === "general";
}

export function videoModelSupportsAnyReference(modelValue: string) {
  return (getVideoModelCapability(modelValue)?.referenceSupport ?? "general") !== "none";
}

export function defaultReferenceModeForVideoModel(modelValue: string): "general" | "headtail" {
  const support = getVideoModelCapability(modelValue)?.referenceSupport ?? "general";
  return support === "headtail" ? "headtail" : "general";
}

export function toGrokVideoSubmitId(taskId: string) {
  return `${GROK_VIDEO_TASK_PREFIX}${taskId.trim()}`;
}

export function extractGrokVideoTaskId(submitId: string | null | undefined) {
  if (typeof submitId !== "string") return null;
  const trimmed = submitId.trim();
  if (!trimmed.toLowerCase().startsWith(GROK_VIDEO_TASK_PREFIX)) return null;
  const taskId = trimmed.slice(GROK_VIDEO_TASK_PREFIX.length).trim();
  return taskId || null;
}

export function toExternalVideoSubmitId(input: { taskId: string; taskUrl?: string | null }) {
  const taskUrl = typeof input.taskUrl === "string" ? input.taskUrl.trim() : "";
  if (taskUrl) {
    return `${EXTERNAL_VIDEO_TASK_URL_PREFIX}${encodeURIComponent(taskUrl)}`;
  }
  return toGrokVideoSubmitId(input.taskId);
}

export function extractExternalVideoTaskRef(submitId: string | null | undefined) {
  if (typeof submitId !== "string") return null;
  const trimmed = submitId.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase().startsWith(EXTERNAL_VIDEO_TASK_URL_PREFIX)) {
    const encoded = trimmed.slice(EXTERNAL_VIDEO_TASK_URL_PREFIX.length).trim();
    if (!encoded) return null;
    try {
      const taskUrl = decodeURIComponent(encoded);
      const taskId = taskUrl.split("/").pop()?.trim() || null;
      return taskId ? { taskId, taskUrl } : null;
    } catch {
      return null;
    }
  }
  const legacyTaskId = extractGrokVideoTaskId(trimmed);
  if (!legacyTaskId) return null;
  return { taskId: legacyTaskId, taskUrl: null };
}
