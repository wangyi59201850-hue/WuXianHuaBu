export const EXTERNAL_IMAGE_API_PROVIDER_IDS = [
  "default_gpt",
  "foropencode",
  "google",
  "banana2",
] as const;

export type ExternalImageApiProviderId =
  (typeof EXTERNAL_IMAGE_API_PROVIDER_IDS)[number];

const IMAGE_MODEL_FALLBACKS: Record<ExternalImageApiProviderId, string[]> = {
  default_gpt: ["gpt-image-2-c"],
  foropencode: ["gpt-image-2", "gpt-draw-2048x2048", "gpt-draw-3840x2160"],
  google: ["nano-banana-2", "gemini-3.1-flash-image-preview-c"],
  banana2: ["banana2"],
};

const GOOGLE_KNOWN_SIZES_BY_RESOLUTION: Record<string, Record<string, string>> = {
  "1k": {
    "1:1": "1024x1024",
    "4:3": "1184x896",
    "3:4": "896x1184",
    "16:9": "1376x768",
    "9:16": "768x1376",
    "3:2": "1248x832",
    "2:3": "832x1248",
    "21:9": "1584x672",
    "7:1": "1568x224",
  },
  "2k": {
    "1:1": "2048x2048",
    "4:3": "2368x1776",
    "3:4": "1776x2368",
    "16:9": "2560x1440",
    "9:16": "1440x2560",
    "3:2": "2496x1664",
    "2:3": "1664x2496",
    "21:9": "2560x1088",
    "7:1": "3584x512",
  },
  "4k": {
    "1:1": "2880x2880",
    "4:3": "3328x2496",
    "3:4": "2496x3328",
    "16:9": "3840x2160",
    "9:16": "2160x3840",
    "3:2": "3520x2336",
    "2:3": "2336x3520",
    "21:9": "4096x1760",
    "7:1": "4096x576",
  },
};

const GOOGLE_RESOLUTION_TARGETS: Record<string, { area: number; maxDimension: number }> = {
  "1k": { area: 1_048_576, maxDimension: 1584 },
  "2k": { area: 4_194_304, maxDimension: 2560 },
  "4k": { area: 8_294_400, maxDimension: 4096 },
};
const GOOGLE_SIZE_STEP = 32;

export function isExternalImageApiProviderId(
  value: unknown
): value is ExternalImageApiProviderId {
  return (
    typeof value === "string" &&
    (EXTERNAL_IMAGE_API_PROVIDER_IDS as readonly string[]).includes(value)
  );
}

export function normalizeExternalImageApiProviderId(
  value: unknown,
  fallback: ExternalImageApiProviderId = "default_gpt"
) {
  return isExternalImageApiProviderId(value) ? value : fallback;
}

export function externalImageModelFallbacksForProvider(
  providerId: ExternalImageApiProviderId
) {
  return [...IMAGE_MODEL_FALLBACKS_SAFE(providerId)];
}

function IMAGE_MODEL_FALLBACKS_SAFE(providerId: ExternalImageApiProviderId) {
  return IMAGE_MODEL_FALLBACKS[providerId] ?? IMAGE_MODEL_FALLBACKS.default_gpt;
}

export function defaultExternalImageModelForProvider(
  providerId: ExternalImageApiProviderId
) {
  return IMAGE_MODEL_FALLBACKS_SAFE(providerId)[0] ?? "gpt-image-2-c";
}

export function isGoogleExternalImageProvider(
  providerId: ExternalImageApiProviderId | null | undefined
) {
  return providerId === "google";
}

export function isGoogleExternalImageModel(model: string | null | undefined) {
  const value = typeof model === "string" ? model.trim().toLowerCase() : "";
  return (
    value === "nano-banana-2" ||
    value === "gemini-3.1-flash-image-preview-c"
  );
}

export function looksLikeExternalImageModel(id: string) {
  const value = id.toLowerCase();
  return (
    value.includes("image") ||
    value.includes("draw") ||
    value.includes("seedream") ||
    value.includes("dall-e") ||
    value.includes("flux") ||
    value.includes("midjourney") ||
    value.includes("recraft") ||
    value.startsWith("nano-banana") ||
    value.includes("image-preview") ||
    value.includes("banana2")
  );
}

export function looksLikeExternalTextModel(id: string) {
  const value = id.toLowerCase();
  return (
    !looksLikeExternalImageModel(id) &&
    !value.includes("audio") &&
    !value.includes("realtime") &&
    !value.includes("video")
  );
}

export function supportsMultiReferenceImagesForProvider(
  providerId: ExternalImageApiProviderId | null | undefined
) {
  return providerId === "google" || providerId === "banana2";
}

export function supportsExternalImageEditEndpoint(
  providerId: ExternalImageApiProviderId | null | undefined
) {
  return providerId !== "google" && providerId !== "banana2";
}

function toRoundedGoogleSize(width: number, height: number) {
  const roundedWidth = Math.max(
    256,
    Math.round(width / GOOGLE_SIZE_STEP) * GOOGLE_SIZE_STEP
  );
  const roundedHeight = Math.max(
    256,
    Math.round(height / GOOGLE_SIZE_STEP) * GOOGLE_SIZE_STEP
  );
  return `${roundedWidth}x${roundedHeight}`;
}

function normalizeGoogleResolutionType(resolutionType: string | null | undefined) {
  const value = typeof resolutionType === "string" ? resolutionType.trim().toLowerCase() : "";
  if (value === "1k") return "1k";
  if (value === "4k" || value === "gpt-4k") return "4k";
  return "2k";
}

function parseDirectImageSize(value: string) {
  const normalized = value.trim().replace(/\s+/g, "");
  const match = normalized.match(/^(\d{3,5})[xX脳](\d{3,5})$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 256 ||
    height < 256 ||
    width > 8192 ||
    height > 8192
  ) {
    return null;
  }
  return `${Math.round(width)}x${Math.round(height)}`;
}

function approximateGoogleSizeForAspect(aspect: number, resolutionType?: string | null) {
  const normalizedResolution = normalizeGoogleResolutionType(resolutionType);
  const target = GOOGLE_RESOLUTION_TARGETS[normalizedResolution] ?? GOOGLE_RESOLUTION_TARGETS["2k"];
  if (!Number.isFinite(aspect) || aspect <= 0) {
    return GOOGLE_KNOWN_SIZES_BY_RESOLUTION[normalizedResolution]?.["1:1"] ?? "2048x2048";
  }

  let width = Math.sqrt(target.area * aspect);
  let height = width / aspect;

  const maxSide = Math.max(width, height);
  if (maxSide > target.maxDimension) {
    const scale = target.maxDimension / maxSide;
    width *= scale;
    height *= scale;
  }

  return toRoundedGoogleSize(width, height);
}

function parseAspect(value: string) {
  const normalized = value.trim().replace(/\s+/g, "");
  const match = normalized.match(/^(\d+(?:\.\d+)?)(?::|[xX×])(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return width / height;
}

export function googleImageSizeFromRatio(
  ratioOrSize: string,
  resolutionType?: string | null
) {
  const normalized = ratioOrSize.trim().replace(/\s+/g, "");
  const directSize = parseDirectImageSize(normalized);
  if (directSize) return directSize;

  const normalizedResolution = normalizeGoogleResolutionType(resolutionType);
  const known = GOOGLE_KNOWN_SIZES_BY_RESOLUTION[normalizedResolution]?.[normalized];
  if (known) return known;

  const aspect = parseAspect(normalized);
  if (aspect === null) {
    return GOOGLE_KNOWN_SIZES_BY_RESOLUTION[normalizedResolution]?.["1:1"] ?? "2048x2048";
  }
  return approximateGoogleSizeForAspect(aspect, normalizedResolution);
}
