
/* eslint-disable @next/next/no-img-element */
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type NodeProps, useReactFlow } from "reactflow";
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Boxes, Eraser, Expand, Image as ImageIcon, ImageUpscale,
  ChevronDown, Loader2, Move, RotateCcw, Scissors, Sparkles, Trash2, WandSparkles, X, ZoomIn, ZoomOut,
} from "lucide-react";
import { MagneticHandleSource, MagneticHandleTarget } from "./MagneticHandle";
import { withGeneratedMediaCacheBust } from "@/lib/generatedUrl";
import {
  externalImageModelFallbacksForProvider,
  type ExternalImageApiProviderId,
} from "@/lib/externalImageApiShared";

export type ImageProcessOperation = "outpaint" | "upscale" | "retouch" | "multiview" | "cutout";
export type ImageProcessOperationOutputState = {
  imageUrls?: string[] | null;
  outputSlots?: Array<string | null>;
  activeOutputSlot?: number;
};
type ProcessConnectedInput = {
  id: string;
  url: string;
  label: string;
  cacheBustKey?: string | number | null;
};
type ProcessRunArgs = {
  nodeId: string;
  operation: ImageProcessOperation;
  prompt: string;
  imageFile: File;
  maskFile?: File | null;
  size?: string;
  modelVersion?: string;
  providerId?: ExternalImageApiProviderId;
  imageQuality?: "standard" | "high" | "hd";
  imageFormat?: "jpg" | "png";
};
type ProcessResult = { imageUrls: string[]; usage?: { total_tokens?: number; input_tokens?: number; output_tokens?: number } | null };
type MaskPoint = { x: number; y: number };
type MaskStroke = { sizeRatio: number; points: MaskPoint[]; erase?: boolean; sourceUrl: string };
type RetouchTool = "paint" | "erase" | "pan";
type MultiviewControlMode = "orbit" | "pan" | "dolly";
type MultiAngleOption =
  | "custom"
  | "front"
  | "front_left"
  | "front_right"
  | "left"
  | "right"
  | "back_left"
  | "back"
  | "back_right"
  | "top_left"
  | "top"
  | "top_right";
type CutoutBackground = "checker" | "light" | "dark" | "violet";
type ViewState = { sourceUrl: string; zoom: number; panX: number; panY: number };
type OutpaintInsets = { top: number; right: number; bottom: number; left: number };
type DragEdge = "top" | "right" | "bottom" | "left" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type ImageProcessNodeData = {
  nodeName?: string;
  operation?: ImageProcessOperation;
  panelOpen?: boolean;
  promptEditorOpen?: boolean;
  advancedSettingsOpen?: boolean;
  outputShelfOpen?: boolean;
  referenceShelfOpen?: boolean;
  zoomLevel?: number;
  modelVersion?: string;
  providerId?: ExternalImageApiProviderId;
  imageQuality?: "standard" | "high" | "hd";
  imageFormat?: "jpg" | "png";
  availableModels?: string[];
  promptText?: string;
  expandDirection?: "all" | "left" | "right" | "top" | "bottom";
  expandPercent?: number;
  expandInsets?: OutpaintInsets;
  upscaleFactor?: 2 | 4;
  operationOutputState?: Partial<Record<ImageProcessOperation, ImageProcessOperationOutputState>>;
  imageUrls?: string[] | null;
  outputSlots?: Array<string | null>;
  activeOutputSlot?: number;
  outputMediaVersion?: string | number | null;
  error?: string | null;
  isLoading?: boolean;
  maskBrushSize?: number;
  multiviewAngle?: MultiAngleOption;
  multiviewYaw?: number;
  multiviewPitch?: number;
  multiviewZoom?: number;
  multiviewShiftX?: number;
  multiviewShiftY?: number;
  cutoutBackground?: CutoutBackground;
  cutoutFeather?: number;
  usage?: { total_tokens?: number; input_tokens?: number; output_tokens?: number } | null;
  connectedInput?: ProcessConnectedInput | null;
  onRunProcess?: (args: ProcessRunArgs) => Promise<ProcessResult>;
  onImportOutputsAsMaterials?: () => Promise<void> | void;
  onDataChange?: (patch: Partial<ImageProcessNodeData>) => void;
};

const TOOLBAR = [
  { value: "outpaint", label: "扩图", icon: Expand },
  { value: "upscale", label: "图片放大", icon: ImageUpscale },
  { value: "retouch", label: "修复", icon: WandSparkles },
  { value: "multiview", label: "多角度", icon: Boxes },
  { value: "cutout", label: "智能抠图", icon: Scissors },
] as const;
const DIRECTIONS = [
  { value: "top", icon: ArrowUp }, { value: "left", icon: ArrowLeft }, { value: "all", icon: Expand }, { value: "right", icon: ArrowRight }, { value: "bottom", icon: ArrowDown },
] as const;
const OUTPAINT_RATIO_PRESETS = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"] as const;
const ANGLES = [
  { value: "front_left", label: "左前", yaw: -28, pitch: 8 },
  { value: "front", label: "正面", yaw: 0, pitch: 0 },
  { value: "front_right", label: "右前", yaw: 28, pitch: 8 },
  { value: "left", label: "左侧", yaw: -52, pitch: 0 },
  { value: "right", label: "右侧", yaw: 52, pitch: 0 },
  { value: "top_left", label: "左俯视", yaw: -24, pitch: 62 },
  { value: "top", label: "顶部", yaw: 0, pitch: 88 },
  { value: "top_right", label: "右俯视", yaw: 24, pitch: 62 },
] as const;
const CUTOUT_BACKGROUNDS = [
  { value: "checker", label: "透明格", cls: "bg-zinc-800" },
  { value: "light", label: "浅灰", cls: "bg-zinc-100" },
  { value: "dark", label: "深灰", cls: "bg-zinc-950" },
  { value: "violet", label: "暗紫", cls: "bg-[radial-gradient(circle_at_50%_35%,rgba(212,212,216,0.22),transparent_58%),linear-gradient(180deg,#18181b,#09090b)]" },
] as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const OUTPAINT_MAX_INSET = 100;
const PROCESS_TOOLBAR_BUTTON_W = 64;
const PROCESS_TOOLBAR_GAP = 6;
const PROCESS_TOOLBAR_PAD_X = 12;
const PROCESS_TOOLBAR_TOTAL_W =
  PROCESS_TOOLBAR_PAD_X * 2 + PROCESS_TOOLBAR_BUTTON_W * TOOLBAR.length + PROCESS_TOOLBAR_GAP * (TOOLBAR.length - 1);
const PROCESS_INPUT_PIN_X = 0;
const PROCESS_INPUT_PIN_Y = 34;
const PROCESS_OUTPUT_PIN_Y = 34;
const pinXForSlot = (slot: number) =>
  PROCESS_TOOLBAR_PAD_X + PROCESS_TOOLBAR_BUTTON_W / 2 + slot * (PROCESS_TOOLBAR_BUTTON_W + PROCESS_TOOLBAR_GAP);
const computeEditSize = (w: number, h: number) => `${Math.max(256, Math.round(w))}x${Math.max(256, Math.round(h))}`;
const defaultPrompt = (op: ImageProcessOperation, factor: 2 | 4) => op === "retouch" ? "修复被涂抹区域，使其与周围画面自然融合。" : op === "upscale" ? `做 ${factor}x 高清增强，提升细节和边缘质量。` : op === "multiview" ? "保持主体一致，生成相同物体的不同视角版本。" : op === "cutout" ? "识别主体边缘并抠除背景，尽量保留细节过渡。" : "补全扩展出来的空白区域，保持主体一致与透视自然。";
const ALL_DEFAULT_PROCESS_PROMPTS = [
  defaultPrompt("outpaint", 2),
  defaultPrompt("retouch", 2),
  defaultPrompt("multiview", 2),
  defaultPrompt("cutout", 2),
  defaultPrompt("upscale", 2),
  defaultPrompt("upscale", 4),
] as const;
const EMPTY_PROCESS_OUTPUT_SLOTS = [null, null, null, null, null] as Array<string | null>;
const FALLBACK_PROCESS_MODELS = Array.from(
  new Set([
    ...externalImageModelFallbacksForProvider("default_gpt"),
    ...externalImageModelFallbacksForProvider("foropencode"),
    ...externalImageModelFallbacksForProvider("google"),
    "gpt-image-1.5",
    "gpt-image-1",
  ])
);
const nextViewState = (prev: ViewState, sourceUrl: string): ViewState => !sourceUrl ? { sourceUrl: "", zoom: 1, panX: 0, panY: 0 } : prev.sourceUrl === sourceUrl ? prev : { sourceUrl, zoom: 1, panX: 0, panY: 0 };
const compactProcessUrls = (...groups: Array<Array<string | null | undefined> | undefined>) => {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const group of groups) {
    for (const value of group ?? []) {
      const url = typeof value === "string" ? value.trim() : "";
      if (!url || seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
};
const normalizeInsets = (input?: Partial<OutpaintInsets> | null): OutpaintInsets => ({ top: clamp(input?.top ?? 0, 0, OUTPAINT_MAX_INSET), right: clamp(input?.right ?? 0, 0, OUTPAINT_MAX_INSET), bottom: clamp(input?.bottom ?? 0, 0, OUTPAINT_MAX_INSET), left: clamp(input?.left ?? 0, 0, OUTPAINT_MAX_INSET) });
const buildOutpaintInsets = (
  direction: NonNullable<ImageProcessNodeData["expandDirection"]>,
  percent: number
): OutpaintInsets => {
  const value = clamp(percent, 0, OUTPAINT_MAX_INSET);
  return {
    top: direction === "all" || direction === "top" ? value : 0,
    right: direction === "all" || direction === "right" ? value : 0,
    bottom: direction === "all" || direction === "bottom" ? value : 0,
    left: direction === "all" || direction === "left" ? value : 0,
  };
};
const ratioToAspect = (ratio: string) => {
  const [w, h] = ratio.split(":").map((value) => Number(value));
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? w / h : null;
};
const buildOutpaintInsetsForAspect = (sourceAspect: number, targetAspect: number): OutpaintInsets => {
  if (!Number.isFinite(sourceAspect) || sourceAspect <= 0 || !Number.isFinite(targetAspect) || targetAspect <= 0) {
    return buildOutpaintInsets("all", 0);
  }
  if (targetAspect >= sourceAspect) {
    const sideInset = clamp(((targetAspect / sourceAspect - 1) * 100) / 2, 0, OUTPAINT_MAX_INSET);
    return { top: 0, right: sideInset, bottom: 0, left: sideInset };
  }
  const verticalInset = clamp(((sourceAspect / targetAspect - 1) * 100) / 2, 0, OUTPAINT_MAX_INSET);
  return { top: verticalInset, right: 0, bottom: verticalInset, left: 0 };
};
const outpaintAspectFromInsets = (sourceAspect: number, insets: OutpaintInsets) => {
  const widthFactor = 1 + (insets.left + insets.right) / 100;
  const heightFactor = 1 + (insets.top + insets.bottom) / 100;
  return sourceAspect * (widthFactor / Math.max(0.01, heightFactor));
};
const inferDirectionAndPercent = (insets: OutpaintInsets) => {
  const active = ([ ["top", insets.top], ["right", insets.right], ["bottom", insets.bottom], ["left", insets.left] ] as const).filter((item) => item[1] > 0.5);
  if (active.length >= 3) return { expandDirection: "all" as const, expandPercent: Math.round((insets.top + insets.right + insets.bottom + insets.left) / 4) };
  if (active.length === 1) return { expandDirection: active[0][0], expandPercent: Math.round(active[0][1]) };
  return { expandDirection: "all" as const, expandPercent: Math.round(Math.max(insets.top, insets.right, insets.bottom, insets.left)) };
};
const isDefaultProcessPrompt = (text: string) => {
  const normalized = text.trim();
  return normalized.length === 0 || ALL_DEFAULT_PROCESS_PROMPTS.some((item) => item === normalized) || normalized.startsWith("淇濇寔涓讳綋涓€鑷达紝杈撳嚭鍚屼竴涓讳綋鐨勪吉 3D 瑙嗚");
};

export function getProcessOperationOutputState(
  data: Pick<ImageProcessNodeData, "operationOutputState" | "imageUrls" | "outputSlots" | "activeOutputSlot">,
  operation: ImageProcessOperation,
  options?: { fallbackToTopLevel?: boolean }
): { imageUrls: string[]; outputSlots: Array<string | null>; activeOutputSlot: number } {
  const hasScopedOutputState =
    !!data.operationOutputState && Object.keys(data.operationOutputState).length > 0;
  const scoped = data.operationOutputState?.[operation];
  const imageUrls = Array.isArray(scoped?.imageUrls)
    ? scoped.imageUrls.filter((url): url is string => typeof url === "string" && url.trim().length > 0)
    : [];
  const outputSlots = Array.from({ length: 5 }, (_, index) => scoped?.outputSlots?.[index] ?? null);
  const activeOutputSlot = clamp(scoped?.activeOutputSlot ?? 0, 0, 4);
  if (imageUrls.length > 0 || outputSlots.some(Boolean)) {
    return { imageUrls, outputSlots, activeOutputSlot };
  }
  const shouldFallbackToTopLevel =
    options?.fallbackToTopLevel ?? !hasScopedOutputState;
  if (!shouldFallbackToTopLevel) {
    return { imageUrls: [], outputSlots: [...EMPTY_PROCESS_OUTPUT_SLOTS], activeOutputSlot: 0 };
  }
  const fallbackUrls = Array.isArray(data.imageUrls)
    ? data.imageUrls.filter((url): url is string => typeof url === "string" && url.trim().length > 0)
    : [];
  const fallbackSlots = Array.from({ length: 5 }, (_, index) => data.outputSlots?.[index] ?? null);
  return {
    imageUrls: fallbackUrls,
    outputSlots: fallbackSlots,
    activeOutputSlot: clamp(data.activeOutputSlot ?? 0, 0, 4),
  };
}

export function buildProcessOperationOutputPatch(
  data: ImageProcessNodeData,
  operation: ImageProcessOperation,
  patch: Partial<ImageProcessOperationOutputState>,
  options?: { mirrorTopLevel?: boolean; fallbackToTopLevel?: boolean }
): Partial<ImageProcessNodeData> {
  const current = getProcessOperationOutputState(data, operation, {
    fallbackToTopLevel: options?.fallbackToTopLevel,
  });
  const nextScoped: ImageProcessOperationOutputState = {
    imageUrls: patch.imageUrls ?? current.imageUrls,
    outputSlots: patch.outputSlots ?? current.outputSlots,
    activeOutputSlot: patch.activeOutputSlot ?? current.activeOutputSlot,
  };
  return {
    operationOutputState: {
      ...(data.operationOutputState ?? {}),
      [operation]: nextScoped,
    },
    ...(options?.mirrorTopLevel === false
      ? {}
      : {
          imageUrls: nextScoped.imageUrls ?? [],
          outputSlots: nextScoped.outputSlots ?? EMPTY_PROCESS_OUTPUT_SLOTS,
          activeOutputSlot: nextScoped.activeOutputSlot ?? 0,
        }),
  };
}

function buildMultiviewPrompt(yaw: number, pitch: number, zoom: number, shiftX = 0, shiftY = 0) {
  const yawLabel = yaw === 0 ? "正面" : yaw > 0 ? `向右 ${Math.abs(Math.round(yaw))}°` : `向左 ${Math.abs(Math.round(yaw))}°`;
  const pitchLabel = pitch === 0 ? "平视" : pitch > 0 ? `俯视 ${Math.abs(Math.round(pitch))}°` : `仰视 ${Math.abs(Math.round(pitch))}°`;
  const shiftLabelX =
    Math.abs(shiftX) < 1 ? "" : shiftX > 0 ? `，构图向右平移 ${Math.round(Math.abs(shiftX))}` : `，构图向左平移 ${Math.round(Math.abs(shiftX))}`;
  const shiftLabelY =
    Math.abs(shiftY) < 1 ? "" : shiftY > 0 ? `，构图向下平移 ${Math.round(Math.abs(shiftY))}` : `，构图向上平移 ${Math.round(Math.abs(shiftY))}`;
  return `保持主体一致，输出同一主体的伪 3D 视角，镜头 ${yawLabel}，${pitchLabel}，主体大小 ${Math.round(zoom)}%${shiftLabelX}${shiftLabelY}，补足被遮挡细节，保持结构、材质与光影自然。`;
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = src;
  });
}

async function fetchImageFileFromUrl(url: string, name: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("读取输入素材失败");
  const blob = await response.blob();
  return new File([blob], name, { type: blob.type || "image/png" });
}

function canvasToFile(canvas: HTMLCanvasElement, fileName: string) {
  return new Promise<File>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("导出图片失败"));
      resolve(new File([blob], fileName, { type: blob.type || "image/png" }));
    }, "image/png");
  });
}

async function buildOutpaintPayload(sourceUrl: string, insets: OutpaintInsets) {
  const image = await loadImageElement(sourceUrl);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const left = Math.round(width * (insets.left / 100));
  const right = Math.round(width * (insets.right / 100));
  const top = Math.round(height * (insets.top / 100));
  const bottom = Math.round(height * (insets.bottom / 100));
  const outWidth = width + left + right;
  const outHeight = height + top + bottom;
  const imageCanvas = document.createElement("canvas");
  imageCanvas.width = outWidth;
  imageCanvas.height = outHeight;
  const imageCtx = imageCanvas.getContext("2d");
  if (!imageCtx) throw new Error("创建扩图画布失败");
  imageCtx.drawImage(image, left, top, width, height);
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = outWidth;
  maskCanvas.height = outHeight;
  const maskCtx = maskCanvas.getContext("2d");
  if (!maskCtx) throw new Error("创建扩图遮罩失败");
  maskCtx.fillStyle = "#ffffff";
  maskCtx.fillRect(0, 0, outWidth, outHeight);
  if (left > 0) maskCtx.clearRect(0, 0, left, outHeight);
  if (right > 0) maskCtx.clearRect(outWidth - right, 0, right, outHeight);
  if (top > 0) maskCtx.clearRect(0, 0, outWidth, top);
  if (bottom > 0) maskCtx.clearRect(0, outHeight - bottom, outWidth, bottom);
  return {
    imageFile: await canvasToFile(imageCanvas, "editorb-outpaint-source.png"),
    maskFile: await canvasToFile(maskCanvas, "editorb-outpaint-mask.png"),
    size: computeEditSize(outWidth, outHeight),
  };
}

async function buildUpscalePayload(sourceUrl: string, factor: 2 | 4) {
  const image = await loadImageElement(sourceUrl);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const maxSide = 2048;
  const rawWidth = width * factor;
  const rawHeight = height * factor;
  const scale = Math.min(1, maxSide / Math.max(rawWidth, rawHeight));
  const outWidth = Math.max(width, Math.round(rawWidth * scale));
  const outHeight = Math.max(height, Math.round(rawHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("创建放大画布失败");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, outWidth, outHeight);
  return { imageFile: await canvasToFile(canvas, "editorb-upscale-source.png"), size: computeEditSize(outWidth, outHeight) };
}

async function buildRetouchMask(sourceUrl: string, strokes: MaskStroke[]) {
  const image = await loadImageElement(sourceUrl);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("创建修复遮罩失败");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#ffffff";
  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    ctx.globalCompositeOperation = stroke.erase ? "source-over" : "destination-out";
    ctx.lineWidth = Math.max(8, stroke.sizeRatio * Math.min(width, height));
    ctx.beginPath();
    const first = stroke.points[0]!;
    ctx.moveTo(first.x * width, first.y * height);
    for (const point of stroke.points.slice(1)) ctx.lineTo(point.x * width, point.y * height);
    ctx.stroke();
  }
  return canvasToFile(canvas, "editorb-retouch-mask.png");
}
export function ImageProcessNode({ id, data, selected }: NodeProps<ImageProcessNodeData>) {
  const { setNodes } = useReactFlow();
  const [strokes, setStrokes] = useState<MaskStroke[]>([]);
  const [painting, setPainting] = useState(false);
  const [retouchTool, setRetouchTool] = useState<RetouchTool>("paint");
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [previewBoxSize, setPreviewBoxSize] = useState({ width: 0, height: 0 });
  const [viewState, setViewState] = useState<ViewState>({ sourceUrl: "", zoom: 1, panX: 0, panY: 0 });
  const [cursor, setCursor] = useState({ visible: false, x: 0, y: 0 });
  const [expandedUrl, setExpandedUrl] = useState<string | null>(null);
  const [multiviewControlMode, setMultiviewControlMode] = useState<MultiviewControlMode | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const strokeRef = useRef<MaskStroke | null>(null);
  const panRef = useRef<{ clientX: number; clientY: number; panX: number; panY: number } | null>(null);
  const outpaintDragRef = useRef<{ edge: DragEdge; startX: number; startY: number; startInsets: OutpaintInsets } | null>(null);
  const multiviewDragRef = useRef<{
    mode: MultiviewControlMode;
    startX: number;
    startY: number;
    yaw: number;
    pitch: number;
    zoom: number;
    shiftX: number;
    shiftY: number;
  } | null>(null);
  const previousDefaultPromptRef = useRef<string>("");
  const [magneticReveal, setMagneticReveal] = useState(false);

  const operation = data.operation ?? "outpaint";
  const panelOpen = data.panelOpen ?? false;
  const panelScale = useMemo(() => {
    const z = data.zoomLevel ?? 1;
    if (!Number.isFinite(z) || z <= 0) return 1;
    return Math.round((1 / z) * 1000) / 1000;
  }, [data.zoomLevel]);
  const magneticHandlesVisible = !panelOpen && (magneticReveal || selected);
  const expandDirection = data.expandDirection ?? "all";
  const expandPercent = data.expandPercent ?? 25;
  const upscaleFactor = data.upscaleFactor ?? 2;
  const brushSize = data.maskBrushSize ?? 24;
  const connectedInput = data.connectedInput ?? null;
  const draftPrompt = data.promptText ?? "";
  const scopedOutputState = getProcessOperationOutputState(data, operation);
  const outputSlots = scopedOutputState.outputSlots;
  const activeOutputSlot = scopedOutputState.activeOutputSlot;
  const currentImageUrls = scopedOutputState.imageUrls;
  const outputPreviewUrl = outputSlots[activeOutputSlot] ?? currentImageUrls[0] ?? null;
  const outputMediaCacheKey = data.outputMediaVersion ?? null;
  const connectedInputDisplayUrl = useMemo(() => {
    if (!connectedInput?.url) return null;
    return withGeneratedMediaCacheBust(connectedInput.url, connectedInput.cacheBustKey);
  }, [connectedInput?.url, connectedInput?.cacheBustKey]);
  const outputPreviewDisplayUrl = useMemo(() => {
    if (!outputPreviewUrl) return null;
    return withGeneratedMediaCacheBust(outputPreviewUrl, outputMediaCacheKey);
  }, [outputPreviewUrl, outputMediaCacheKey]);
  const assignedOutputCount = outputSlots.filter(Boolean).length;
  const referenceThumbs = currentImageUrls.slice(0, 5);
  const hasGeneratedOutputs = assignedOutputCount > 0 || currentImageUrls.length > 0;
  const availableModels = useMemo(
    () =>
      Array.from(
        new Set(
          (Array.isArray(data.availableModels) && data.availableModels.length > 0
            ? data.availableModels
            : [...FALLBACK_PROCESS_MODELS]
          ).filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        )
      ),
    [data.availableModels]
  );
  const selectedModelVersion =
    typeof data.modelVersion === "string" && data.modelVersion.trim()
      ? data.modelVersion.trim()
      : availableModels[0] ?? "gpt-image-2-c";
  const imageQuality =
    data.imageQuality === "high" || data.imageQuality === "hd" || data.imageQuality === "standard"
      ? data.imageQuality
      : "standard";
  const imageFormat =
    data.imageFormat === "png" ? "png" : "jpg";
  const supportsExternalQuality = data.providerId === "foropencode";
  const supportsExternalFormat = data.providerId === "foropencode";
  const externalQualityOptions = [
    { value: "standard", label: "standard" },
    { value: "high", label: "high" },
    { value: "hd", label: "hd" },
  ] as const;
  const externalFormatOptions = [
    { value: "jpg", label: "JPG" },
    { value: "png", label: "PNG" },
  ] as const;
  const activeOperationLabel = TOOLBAR.find((item) => item.value === operation)?.label ?? "编辑";
  const multiviewAngle = data.multiviewAngle ?? "front";
  const multiviewYaw = data.multiviewYaw ?? 0;
  const multiviewPitch = data.multiviewPitch ?? 0;
  const multiviewZoom = data.multiviewZoom ?? 100;
  const multiviewShiftX = data.multiviewShiftX ?? 0;
  const multiviewShiftY = data.multiviewShiftY ?? 0;
  const cutoutBackground = data.cutoutBackground ?? "checker";
  const cutoutFeather = data.cutoutFeather ?? 16;
  const inputSignature = connectedInput?.url ?? "";
  const defaultPromptText = operation === "multiview"
    ? buildMultiviewPrompt(multiviewYaw, multiviewPitch, multiviewZoom, multiviewShiftX, multiviewShiftY)
    : defaultPrompt(operation, upscaleFactor);
  const promptIsCustomized =
    draftPrompt.trim().length > 0 && draftPrompt.trim() !== defaultPromptText.trim();
  const promptSummary = promptIsCustomized ? draftPrompt.trim() : defaultPromptText.trim();
  const promptEditorOpen = Boolean(data.promptEditorOpen);
  const advancedSettingsOpen = Boolean(data.advancedSettingsOpen);
  const outputShelfOpen = Boolean(data.outputShelfOpen);
  const referenceShelfOpen = Boolean(data.referenceShelfOpen);
  const promptEditorVisible = promptEditorOpen;
  const outputShelfVisible = outputShelfOpen;
  const referenceShelfVisible = referenceShelfOpen;
  const settingsSummary = [
    selectedModelVersion,
    supportsExternalQuality ? imageQuality : null,
    supportsExternalFormat ? imageFormat.toUpperCase() : null,
  ].filter(Boolean).join(" 路 ");
  const activeView = viewState.sourceUrl === inputSignature ? viewState : nextViewState(viewState, inputSignature);
  const activeStrokes = useMemo(() => strokes.filter((stroke) => stroke.sourceUrl === inputSignature), [inputSignature, strokes]);
  const multiviewTransform = useMemo(
    () =>
      `translate3d(${multiviewShiftX}px, ${multiviewShiftY}px, 0) perspective(1500px) rotateX(${-multiviewPitch}deg) rotateY(${multiviewYaw}deg) scale(${multiviewZoom / 100})`,
    [multiviewPitch, multiviewShiftX, multiviewShiftY, multiviewYaw, multiviewZoom]
  );
  const cutoutBgClass = CUTOUT_BACKGROUNDS.find((item) => item.value === cutoutBackground)?.cls ?? CUTOUT_BACKGROUNDS[0].cls;
  const insets = normalizeInsets(data.expandInsets ?? buildOutpaintInsets(expandDirection, expandPercent));
  const insetTop = insets.top;
  const insetRight = insets.right;
  const insetBottom = insets.bottom;
  const insetLeft = insets.left;
  const sourceAspect = naturalSize && naturalSize.width > 0 && naturalSize.height > 0
    ? naturalSize.width / naturalSize.height
    : 1;
  const outpaintSelectionAspect = outpaintAspectFromInsets(sourceAspect, insets);
  const outpaintGeometry = useMemo(() => {
    const previewWidth = Math.max(1, previewBoxSize.width || 1);
    const previewHeight = Math.max(1, previewBoxSize.height || 1);
    const safeAspect = Number.isFinite(sourceAspect) && sourceAspect > 0 ? sourceAspect : 1;
    const outerAspect = outpaintAspectFromInsets(safeAspect, insets);
    const canvasPadding = 26;
    const handlePadding = 8;
    const defaultMaterialFill = 0.5;
    const fitMaxWidth = Math.max(1, previewWidth - canvasPadding * 2);
    const fitMaxHeight = Math.max(1, previewHeight - canvasPadding * 2);
    let outerWidth = fitMaxWidth;
    let outerHeight = outerWidth / outerAspect;
    if (outerHeight > fitMaxHeight) {
      outerHeight = fitMaxHeight;
      outerWidth = outerHeight * outerAspect;
    }
    const maxMaterialWidth = outerWidth * defaultMaterialFill;
    const maxMaterialHeight = outerHeight * defaultMaterialFill;
    let materialWidth = maxMaterialWidth;
    let materialHeight = materialWidth / safeAspect;
    if (materialHeight > maxMaterialHeight) {
      materialHeight = maxMaterialHeight;
      materialWidth = materialHeight * safeAspect;
    }
    const leftInset = (materialWidth * insetLeft) / 100;
    const rightInset = (materialWidth * insetRight) / 100;
    const topInset = (materialHeight * insetTop) / 100;
    const bottomInset = (materialHeight * insetBottom) / 100;
    const contentWidth = materialWidth + leftInset + rightInset;
    const contentHeight = materialHeight + topInset + bottomInset;
    const centeredOffsetX = Math.max(0, (outerWidth - contentWidth) / 2);
    const centeredOffsetY = Math.max(0, (outerHeight - contentHeight) / 2);
    return {
      materialStyle: {
        left: `${centeredOffsetX + leftInset}px`,
        top: `${centeredOffsetY + topInset}px`,
        width: `${materialWidth}px`,
        height: `${materialHeight}px`,
      },
      outerStyle: {
        width: `${outerWidth}px`,
        height: `${outerHeight}px`,
      },
      handlePadding,
      canvasPadding,
      materialWidth,
      materialHeight,
      outerWidth,
      outerHeight,
      previewWidth,
      previewHeight,
    };
  }, [insets, insetBottom, insetLeft, insetRight, insetTop, previewBoxSize.height, previewBoxSize.width, sourceAspect]);
  const outpaintMaxPercent = useMemo(() => {
    const geometryWidth = Math.max(1, outpaintGeometry.materialWidth);
    const geometryHeight = Math.max(1, outpaintGeometry.materialHeight);
    const maxHorizontal = Math.max(0, ((outpaintGeometry.outerWidth - geometryWidth) / geometryWidth) * 50);
    const maxVertical = Math.max(0, ((outpaintGeometry.outerHeight - geometryHeight) / geometryHeight) * 50);
    if (expandDirection === "left" || expandDirection === "right") return Math.max(1, Math.round(maxHorizontal || 0));
    if (expandDirection === "top" || expandDirection === "bottom") return Math.max(1, Math.round(maxVertical || 0));
    return Math.max(1, Math.round(Math.min(maxHorizontal || 0, maxVertical || 0)));
  }, [expandDirection, outpaintGeometry.materialHeight, outpaintGeometry.materialWidth, outpaintGeometry.outerHeight, outpaintGeometry.outerWidth]);
  const handlePadding = outpaintGeometry.handlePadding;
  const outpaintPercent = clamp(Math.round(expandPercent), 0, outpaintMaxPercent);
  const multiviewPresetAngles = useMemo(
    () => [
      { value: "front_left", label: "左前", yaw: -28, pitch: 8 },
      { value: "front", label: "正面", yaw: 0, pitch: 0 },
      { value: "front_right", label: "右前", yaw: 28, pitch: 8 },
      { value: "left", label: "左侧", yaw: -52, pitch: 0 },
      { value: "right", label: "右侧", yaw: 52, pitch: 0 },
      { value: "back_left", label: "后左", yaw: -24, pitch: 62 },
      { value: "back", label: "后方", yaw: 0, pitch: 88 },
      { value: "back_right", label: "后右", yaw: 24, pitch: 62 },
    ] as const,
    []
  );
  const multiviewCameraOverlay = useMemo(() => {
    const boxWidth = 220;
    const boxHeight = 248;
    const centerX = boxWidth / 2 + multiviewShiftX * 0.75;
    const centerY = boxHeight / 2 + multiviewShiftY * 0.75;
    const yawRad = (multiviewYaw * Math.PI) / 180;
    const pitchRad = (multiviewPitch * Math.PI) / 180;
    const orbitDistance = 92 - (multiviewZoom - 100) * 0.74;
    const cameraX = centerX + Math.sin(yawRad) * orbitDistance;
    const cameraY = centerY - Math.sin(pitchRad) * 42 - Math.cos(yawRad) * 16;
    return { centerX, centerY, cameraX, cameraY };
  }, [multiviewPitch, multiviewShiftX, multiviewShiftY, multiviewYaw, multiviewZoom]);

  const patchNodeData = useCallback((patch: Partial<ImageProcessNodeData>) => {
    if (data.onDataChange) return data.onDataChange(patch);
    setNodes((nodes) => nodes.map((node) => node.id === id ? { ...node, data: { ...(node.data as ImageProcessNodeData), ...patch } } : node));
  }, [data, id, setNodes]);

  useEffect(() => {
    if (availableModels.length === 0) return;
    if (availableModels.includes(selectedModelVersion)) return;
    patchNodeData({ modelVersion: availableModels[0] });
  }, [availableModels, patchNodeData, selectedModelVersion]);

  const patchLatestOperationOutputState = useCallback((patch: Partial<ImageProcessOperationOutputState>) => {
    setNodes((nodes) =>
      nodes.map((node) => {
        if (node.id !== id) return node;
        const currentData = node.data as ImageProcessNodeData;
        return {
          ...node,
          data: {
            ...currentData,
            ...buildProcessOperationOutputPatch(currentData, operation, patch, {
              mirrorTopLevel: false,
              fallbackToTopLevel: false,
            }),
          },
        };
      })
    );
  }, [id, operation, setNodes]);

  useEffect(() => {
    if (operation === "multiview") {
      if (draftPrompt !== defaultPromptText) patchNodeData({ promptText: defaultPromptText });
      return;
    }
    const previousDefault = previousDefaultPromptRef.current;
    previousDefaultPromptRef.current = defaultPromptText;
    if (draftPrompt.trim().length === 0 || draftPrompt.trim() === previousDefault.trim()) {
      if (draftPrompt !== defaultPromptText) patchNodeData({ promptText: defaultPromptText });
    }
  }, [defaultPromptText, draftPrompt, operation, patchNodeData]);

  useEffect(() => {
    if (!panelOpen || !promptEditorVisible) return;
    requestAnimationFrame(() => {
      promptRef.current?.focus({ preventScroll: true });
      promptRef.current?.setSelectionRange?.(promptRef.current.value.length, promptRef.current.value.length);
    });
  }, [panelOpen, promptEditorVisible]);

  useEffect(() => {
    const synced = getProcessOperationOutputState(data, operation, {
      fallbackToTopLevel: false,
    });
    const topImageUrls = Array.isArray(data.imageUrls)
      ? data.imageUrls.filter((url): url is string => typeof url === "string" && url.trim().length > 0)
      : [];
    const topOutputSlots = Array.from({ length: 5 }, (_, index) => data.outputSlots?.[index] ?? null);
    const topActiveSlot = clamp(data.activeOutputSlot ?? 0, 0, 4);
    const imageMismatch =
      topImageUrls.length !== synced.imageUrls.length ||
      topImageUrls.some((url, index) => url !== synced.imageUrls[index]);
    const slotMismatch = topOutputSlots.some((value, index) => value !== synced.outputSlots[index]);
    if (imageMismatch || slotMismatch || topActiveSlot !== synced.activeOutputSlot) {
      patchNodeData({
        imageUrls: synced.imageUrls,
        outputSlots: synced.outputSlots,
        activeOutputSlot: synced.activeOutputSlot,
      });
    }
  }, [data, operation, patchNodeData]);

  useEffect(() => {
    if (!connectedInput?.url) return;
    let active = true;
    void loadImageElement(connectedInput.url).then((image) => {
      if (!active) return;
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      setNaturalSize(width > 0 && height > 0 ? { width, height } : null);
    }).catch(() => {
      if (!active) return;
      setNaturalSize(null);
    });
    return () => { active = false; };
  }, [connectedInput?.url]);

  useEffect(() => {
    const host = previewRef.current;
    if (!host) return;
    const update = () => {
      const rect = host.getBoundingClientRect();
      setPreviewBoxSize({
        width: Math.max(0, rect.width),
        height: Math.max(0, rect.height),
      });
    };
    update();
    const observer = new ResizeObserver(() => update());
    observer.observe(host);
    return () => observer.disconnect();
  }, [panelOpen, operation]);

  const pointFromEvent = useCallback((event: React.PointerEvent) => {
    const host = previewRef.current;
    if (!host) return null;
    const rect = host.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return { x: clamp((event.clientX - rect.left - activeView.panX) / (rect.width * activeView.zoom), 0, 1), y: clamp((event.clientY - rect.top - activeView.panY) / (rect.height * activeView.zoom), 0, 1) };
  }, [activeView.panX, activeView.panY, activeView.zoom]);

  const updateCursor = useCallback((event: React.PointerEvent) => {
    const host = previewRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    setCursor({ visible: true, x: clamp(event.clientX - rect.left, 0, rect.width), y: clamp(event.clientY - rect.top, 0, rect.height) });
  }, []);

  const zoomPreview = useCallback((nextZoom: number) => {
    setViewState((prev) => ({ ...nextViewState(prev, inputSignature), zoom: clamp(nextZoom, 1, 4) }));
  }, [inputSignature]);
  const resetView = useCallback(() => setViewState({ sourceUrl: inputSignature, zoom: 1, panX: 0, panY: 0 }), [inputSignature]);
  const assignPreviewToSlot = (slotIndex: number, url: string | null) => {
    const nextSlots = [...outputSlots];
    nextSlots[slotIndex] = url;
    patchLatestOperationOutputState({
      imageUrls: compactProcessUrls(nextSlots, currentImageUrls),
      outputSlots: nextSlots,
      activeOutputSlot: slotIndex,
    });
  };
  const assignGeneratedResultToSlot = useCallback((
    preferredSlot: number,
    urls: string[],
    usage: ProcessResult["usage"] = null
  ) => {
    setNodes((nodes) =>
      nodes.map((node) => {
        if (node.id !== id) return node;
        const currentData = node.data as ImageProcessNodeData;
        const current = getProcessOperationOutputState(currentData, operation, {
          fallbackToTopLevel: false,
        });
        const nextSlots = [...current.outputSlots];
        const cleanUrls = compactProcessUrls(urls);
        const primaryUrl = cleanUrls[0] ?? null;
        let targetSlot = clamp(preferredSlot, 0, 4);
        if (primaryUrl) {
          const existingIndex = nextSlots.findIndex((slot) => slot === primaryUrl);
          if (existingIndex >= 0) {
            targetSlot = existingIndex;
          } else if (nextSlots[targetSlot]) {
            const nextEmptySlot = Array.from({ length: 5 }, (_, offset) => (targetSlot + offset + 1) % 5)
              .find((index) => !nextSlots[index]);
            if (typeof nextEmptySlot === "number") targetSlot = nextEmptySlot;
          }
          nextSlots[targetSlot] = primaryUrl;
        }
        return {
          ...node,
          data: {
            ...currentData,
            ...buildProcessOperationOutputPatch(currentData, operation, {
              imageUrls: compactProcessUrls(cleanUrls, nextSlots, current.imageUrls),
              outputSlots: nextSlots,
              activeOutputSlot: targetSlot,
            }, {
              mirrorTopLevel: false,
              fallbackToTopLevel: false,
            }),
            isLoading: false,
            error: null,
            usage,
          },
        };
      })
    );
  }, [id, operation, setNodes]);
  const applyOutpaintInsets = useCallback((nextInsets: OutpaintInsets) => {
    const normalized = normalizeInsets(nextInsets);
    const inferred = inferDirectionAndPercent(normalized);
    patchNodeData({ expandInsets: normalized, expandDirection: inferred.expandDirection, expandPercent: inferred.expandPercent });
  }, [patchNodeData]);
  const applyOutpaintPreset = useCallback((direction: NonNullable<ImageProcessNodeData["expandDirection"]>, percent: number) => {
    const clampedPercent = clamp(percent, 0, outpaintMaxPercent);
    const normalized = normalizeInsets(buildOutpaintInsets(direction, clampedPercent));
    patchNodeData({
      expandInsets: normalized,
      expandDirection: direction,
      expandPercent: clampedPercent,
    });
  }, [outpaintMaxPercent, patchNodeData]);
  const applyOutpaintRatioPreset = useCallback((ratio: string) => {
    const targetAspect = ratioToAspect(ratio);
    if (!targetAspect) return;
    const normalized = normalizeInsets(buildOutpaintInsetsForAspect(sourceAspect, targetAspect));
    const inferred = inferDirectionAndPercent(normalized);
    patchNodeData({
      expandInsets: normalized,
      expandDirection: inferred.expandDirection,
      expandPercent: inferred.expandPercent,
    });
  }, [patchNodeData, sourceAspect]);
  const selectOperation = useCallback((nextOperation: ImageProcessOperation) => {
    if (nextOperation === operation) {
      patchNodeData({ panelOpen: !panelOpen });
      return;
    }
    const nextDefaultPrompt = nextOperation === "multiview"
      ? buildMultiviewPrompt(multiviewYaw, multiviewPitch, multiviewZoom, multiviewShiftX, multiviewShiftY)
      : defaultPrompt(nextOperation, upscaleFactor);
    const nextPatch: Partial<ImageProcessNodeData> = {
      operation: nextOperation,
      panelOpen: true,
      ...buildProcessOperationOutputPatch(data, nextOperation, {}, { fallbackToTopLevel: false }),
    };
    if (isDefaultProcessPrompt(draftPrompt)) nextPatch.promptText = nextDefaultPrompt;
    patchNodeData(nextPatch);
  }, [data, draftPrompt, multiviewPitch, multiviewShiftX, multiviewShiftY, multiviewYaw, multiviewZoom, operation, panelOpen, patchNodeData, upscaleFactor]);
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = outpaintDragRef.current;
      if (!drag) return;
      const dxPct = ((event.clientX - drag.startX) / Math.max(1, outpaintGeometry.materialWidth)) * 100;
      const dyPct = ((event.clientY - drag.startY) / Math.max(1, outpaintGeometry.materialHeight)) * 100;
      const next = { ...drag.startInsets };
      if (drag.edge.includes("left")) next.left = clamp(drag.startInsets.left - dxPct, 0, outpaintMaxPercent);
      if (drag.edge.includes("right")) next.right = clamp(drag.startInsets.right + dxPct, 0, outpaintMaxPercent);
      if (drag.edge.includes("top")) next.top = clamp(drag.startInsets.top - dyPct, 0, outpaintMaxPercent);
      if (drag.edge.includes("bottom")) next.bottom = clamp(drag.startInsets.bottom + dyPct, 0, outpaintMaxPercent);
      applyOutpaintInsets(next);
    };
    const onUp = () => { outpaintDragRef.current = null; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [applyOutpaintInsets, outpaintGeometry.materialHeight, outpaintGeometry.materialWidth, outpaintMaxPercent]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = multiviewDragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (drag.mode === "orbit") {
        patchNodeData({
          multiviewAngle: "custom",
          multiviewYaw: clamp(drag.yaw + dx * 0.34, -82, 82),
          multiviewPitch: clamp(drag.pitch - dy * 0.24, -48, 88),
        });
        return;
      }
      if (drag.mode === "dolly") {
        patchNodeData({
          multiviewAngle: "custom",
          multiviewZoom: clamp(drag.zoom - dy * 0.28 + dx * 0.04, 64, 165),
        });
        return;
      }
      const panScale = clamp(100 / Math.max(64, drag.zoom), 0.62, 1.35);
      patchNodeData({
        multiviewAngle: "custom",
        multiviewShiftX: clamp(drag.shiftX + dx * 0.36 * panScale, -78, 78),
        multiviewShiftY: clamp(drag.shiftY + dy * 0.36 * panScale, -68, 68),
      });
    };
    const onUp = () => {
      multiviewDragRef.current = null;
      setMultiviewControlMode(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [patchNodeData]);

  const beginPan = useCallback((event: React.PointerEvent) => {
    if (!connectedInput?.url) return;
    event.preventDefault();
    panRef.current = { clientX: event.clientX, clientY: event.clientY, panX: activeView.panX, panY: activeView.panY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setRetouchTool("pan");
  }, [activeView.panX, activeView.panY, connectedInput?.url]);

  const beginPaint = useCallback((event: React.PointerEvent) => {
    if (operation !== "retouch" || !connectedInput?.url || retouchTool === "pan") return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    const rect = previewRef.current?.getBoundingClientRect();
    const nextStroke: MaskStroke = { sizeRatio: rect && rect.width > 0 && rect.height > 0 ? brushSize / Math.min(rect.width, rect.height) : 0.08, points: [point], erase: retouchTool === "erase", sourceUrl: inputSignature };
    strokeRef.current = nextStroke;
    setPainting(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setStrokes((prev) => [...prev, nextStroke]);
  }, [brushSize, connectedInput?.url, inputSignature, operation, pointFromEvent, retouchTool]);

  const movePreview = useCallback((event: React.PointerEvent) => {
    updateCursor(event);
    if (retouchTool === "pan" && panRef.current) {
      setViewState({ sourceUrl: inputSignature, zoom: activeView.zoom, panX: panRef.current.panX + (event.clientX - panRef.current.clientX), panY: panRef.current.panY + (event.clientY - panRef.current.clientY) });
      return;
    }
    if (!painting || operation !== "retouch") return;
    const point = pointFromEvent(event);
    const stroke = strokeRef.current;
    if (!point || !stroke) return;
    stroke.points.push(point);
    setStrokes((prev) => prev.length === 0 ? prev : [...prev.slice(0, -1), { ...stroke, points: [...stroke.points] }]);
  }, [activeView.zoom, inputSignature, operation, painting, pointFromEvent, retouchTool, updateCursor]);

  const endInteraction = useCallback((event?: React.PointerEvent) => {
    strokeRef.current = null;
    panRef.current = null;
    setPainting(false);
    event?.currentTarget.releasePointerCapture?.(event.pointerId);
  }, []);

  const startOutpaintDrag = useCallback((edge: DragEdge, event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    outpaintDragRef.current = {
      edge,
      startX: event.clientX,
      startY: event.clientY,
      startInsets: { top: insetTop, right: insetRight, bottom: insetBottom, left: insetLeft },
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [insetBottom, insetLeft, insetRight, insetTop]);

  const beginMultiviewControl = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!connectedInput?.url) return;
    event.preventDefault();
    const nextMode: MultiviewControlMode =
      event.button === 2 || event.altKey || event.ctrlKey
        ? "dolly"
        : event.button === 1 || event.shiftKey || event.metaKey
          ? "pan"
          : "orbit";
    setMultiviewControlMode(nextMode);
    multiviewDragRef.current = {
      mode: nextMode,
      startX: event.clientX,
      startY: event.clientY,
      yaw: multiviewYaw,
      pitch: multiviewPitch,
      zoom: multiviewZoom,
      shiftX: multiviewShiftX,
      shiftY: multiviewShiftY,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [connectedInput?.url, multiviewPitch, multiviewShiftX, multiviewShiftY, multiviewYaw, multiviewZoom]);

  const resetMultiviewCamera = useCallback(() => {
    patchNodeData({
      multiviewAngle: "front",
      multiviewYaw: 0,
      multiviewPitch: 0,
      multiviewZoom: 100,
      multiviewShiftX: 0,
      multiviewShiftY: 0,
    });
  }, [patchNodeData]);

  const runProcess = async () => {
    if (!connectedInput?.url || !data.onRunProcess) {
      patchNodeData({ error: "请先连接一张输入图片。" });
      return;
    }
    try {
      patchNodeData({ error: null, promptText: draftPrompt });
      let imageFile: File;
      let maskFile: File | null | undefined;
      let size: string | undefined;
      if (operation === "outpaint") {
        const payload = await buildOutpaintPayload(connectedInput.url, insets);
        imageFile = payload.imageFile; maskFile = payload.maskFile; size = payload.size;
      } else if (operation === "upscale") {
        const payload = await buildUpscalePayload(connectedInput.url, upscaleFactor);
        imageFile = payload.imageFile; size = payload.size;
      } else {
        const source = await loadImageElement(connectedInput.url);
        imageFile = await fetchImageFileFromUrl(connectedInput.url, `editorb-${operation}-source.png`);
        size = computeEditSize(source.naturalWidth, source.naturalHeight);
        if (operation === "retouch") {
          if (activeStrokes.length === 0) { patchNodeData({ error: "请先在输入图上涂抹或擦除遮罩区域。" }); return; }
          maskFile = await buildRetouchMask(connectedInput.url, activeStrokes);
        }
      }
      const result = await data.onRunProcess({
        nodeId: id,
        operation,
        prompt: draftPrompt.trim() || defaultPromptText,
        imageFile,
        maskFile,
        size,
        modelVersion: selectedModelVersion,
        providerId: data.providerId,
        imageQuality,
        imageFormat,
      });
      assignGeneratedResultToSlot(activeOutputSlot, result.imageUrls, result.usage ?? null);
    } catch (error) {
      patchNodeData({ isLoading: false, error: error instanceof Error ? error.message : "素材处理失败" });
    }
  };
  /*
  return (
    <>
      <div className="group/process-node pointer-events-none relative inline-flex flex-col items-center overflow-visible">
        <div
          className={[
            "pointer-events-auto relative w-[320px] rounded-2xl border border-white/10 bg-zinc-950/95 p-3 text-white shadow-[0_18px_42px_rgba(0,0,0,0.42)] backdrop-blur-xl",
            selected
              ? "ring-1 ring-zinc-300/90 ring-offset-2 ring-offset-black shadow-[0_10px_32px_rgba(0,0,0,0.52),0_0_12px_rgba(255,255,255,0.06)]"
              : "",
          ].join(" ")}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-zinc-100">{activeOperationLabel}</div>
              <div className="text-[11px] text-zinc-500">鍥惧儚澶勭悊鑺傜偣鍏煎妯″紡</div>
            </div>
            <button
              type="button"
              className="nodrag nopan inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-zinc-100 px-3 text-[11px] font-medium text-zinc-950 hover:bg-white disabled:opacity-60"
              onClick={() => void runProcess()}
              disabled={Boolean(data.isLoading) || !connectedInput?.url}
            >
              {data.isLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              <span>{data.isLoading ? "处理中..." : "开始处理"}</span>
            </button>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-2">
            {connectedInput?.url ? (
              <div className="flex h-[200px] items-center justify-center overflow-hidden rounded-lg bg-zinc-950/80">
                <img
                  src={outputPreviewDisplayUrl || connectedInputDisplayUrl || connectedInput.url}
                  alt=""
                  className="max-h-full max-w-full object-contain"
                  draggable={false}
                />
              </div>
            ) : (
              <div className="flex h-[200px] items-center justify-center rounded-lg border border-dashed border-white/10 text-[11px] text-zinc-500">
                杩炴帴绱犳潗鍚庡紑濮嬬紪杈?              </div>
            )}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-zinc-400">
            <div className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-2">
              妯″瀷锛歿selectedModelVersion}
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-2">
              杈撳嚭锛歿currentImageUrls.length} 寮?            </div>
          </div>
          {data.error ? (
            <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {data.error}
            </div>
          ) : null}
          {Array.from({ length: 5 }, (_, index) => (
            <MagneticHandleSource
              key={index}
              id={`output-${index + 1}`}
              pinX={pinXForSlot(index)}
              pinY={PROCESS_OUTPUT_PIN_Y}
              magneticVisible={magneticHandlesVisible}
              className="z-[30]"
            />
          ))}
          <MagneticHandleTarget
            id="image_input"
            pinX={PROCESS_INPUT_PIN_X}
            pinY={PROCESS_INPUT_PIN_Y}
            magneticVisible
            className="z-[30]"
          />
        </div>
      </div>
      {expandedUrl ? (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setExpandedUrl(null)}
        >
          <div
            className="relative flex h-[min(92vh,calc(100vh-40px))] w-[min(92vw,calc(100vw-40px))] items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-zinc-950"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="absolute right-5 top-5 z-10 rounded-full bg-black/50 p-2 text-white"
              onClick={() => setExpandedUrl(null)}
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex h-full w-full items-center justify-center bg-transparent">
              <img
                src={withGeneratedMediaCacheBust(expandedUrl, outputMediaCacheKey)}
                alt=""
                className="block max-h-full max-w-full object-contain bg-transparent"
                draggable={false}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
  */
  return (
    <>
      <div
        className="group/process-node pointer-events-none relative inline-flex flex-col items-center overflow-visible"
        onPointerEnter={() => {
          if (!panelOpen) setMagneticReveal(true);
        }}
        onPointerLeave={(event) => {
          if (event.buttons === 0) setMagneticReveal(false);
        }}
      >
        <div
          className="relative overflow-visible text-white"
        >
          <div
            className={[
              "pointer-events-auto relative z-10 mb-0 w-fit rounded-xl border border-white/10 bg-zinc-950/95 px-3.5 py-2 shadow-[0_12px_28px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl",
              selected
                ? "ring-1 ring-zinc-300/90 ring-offset-2 ring-offset-black shadow-[0_10px_32px_rgba(0,0,0,0.52),0_0_12px_rgba(255,255,255,0.06)]"
                : "",
            ].join(" ")}
            style={{ width: `${PROCESS_TOOLBAR_TOTAL_W}px` }}
          >
            <MagneticHandleTarget
              id="image_input"
              pinX={PROCESS_INPUT_PIN_X}
              pinY={PROCESS_INPUT_PIN_Y}
              magneticVisible
              className="z-[40]"
            />
            <div className="flex w-fit items-center gap-2">
              {TOOLBAR.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  title={label}
                  className={[
                    "nodrag nopan flex h-[46px] w-[64px] flex-col items-center justify-center rounded-md border transition-all",
                    operation === value
                      ? "border-zinc-100/70 bg-zinc-800 text-white shadow-[0_0_0_1px_rgba(244,244,245,0.18)]"
                      : "border-white/10 bg-zinc-900 text-zinc-300 hover:border-white/20 hover:bg-zinc-800",
                  ].join(" ")}
                    onClick={() => selectOperation(value)}
                >
                  <Icon className="h-4 w-4" />
                  <span className="mt-0.5 text-[9px] font-medium leading-none text-zinc-200">{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div
            className={[
              "pointer-events-auto absolute left-1/2 top-full z-20 w-[min(94vw,820px)] max-w-[820px] origin-top overflow-hidden transition-[max-height,opacity,transform] duration-380 ease-[cubic-bezier(0.2,1.18,0.32,1)]",
              panelOpen ? "mt-2 max-h-[76vh] opacity-100" : "pointer-events-none mt-0 max-h-0 opacity-0",
          ].join(" ")}
          style={{
              transform: panelOpen
                ? `translateX(-50%) scale(${panelScale})`
                : `translateX(-50%) translateY(-12px) scale(${Math.max(0.94, panelScale * 0.972)})`,
              transformOrigin: "top center",
            }}
            onPointerEnter={() => setMagneticReveal(false)}
          >
            <div className="relative rounded-xl border border-white/10 bg-zinc-950/98 p-2.5 shadow-[0_18px_42px_rgba(0,0,0,0.46),inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-xl">
              <button
                type="button"
                aria-label="收起"
                className="absolute right-3 top-3 rounded-md p-1.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
                onClick={() => patchNodeData({ panelOpen: false })}
              >
                <ChevronDown className="h-4 w-4" />
              </button>
              <div className="mb-1.5 flex items-center gap-2 pr-8">
                <div className="text-[13px] font-semibold text-zinc-100">{activeOperationLabel}</div>
                <div className="rounded-md border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-200">
                  开发中，功能未接通
                </div>
              </div>

              <div className="max-h-[calc(76vh-54px)] overflow-y-auto pr-1">
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
                <div className="min-w-0 rounded-lg border border-white/10 bg-zinc-900/90 p-2">
                  {operation === "retouch" ? (
                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                      {([
                        ["paint", Eraser, "涂抹"],
                        ["erase", WandSparkles, "擦除"],
                        ["pan", Move, "拖动"],
                      ] as const).map(([tool, Icon, label]) => (
                        <button
                          key={tool}
                          type="button"
                          className={[
                            "nodrag nopan inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-[10px]",
                            retouchTool === tool ? "border-zinc-100/60 bg-zinc-700 text-white" : "border-white/10 bg-white/5 text-zinc-300",
                          ].join(" ")}
                          onClick={() => setRetouchTool(tool)}
                        >
                          <Icon className="h-3 w-3" />
                          <span>{label}</span>
                        </button>
                      ))}
                      <button type="button" title="缩小" aria-label="缩小" className="nodrag nopan inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-white/5 text-zinc-300" onClick={() => zoomPreview(activeView.zoom - 0.25)}>
                        <ZoomOut className="h-3 w-3" />
                      </button>
                      <button type="button" title="还原" aria-label="还原" className="nodrag nopan inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-white/5 text-zinc-300" onClick={resetView}>
                        <RotateCcw className="h-3 w-3" />
                      </button>
                      <button type="button" title="放大" aria-label="放大" className="nodrag nopan inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-white/5 text-zinc-300" onClick={() => zoomPreview(activeView.zoom + 0.25)}>
                        <ZoomIn className="h-3 w-3" />
                      </button>
                    </div>
                  ) : null}

                  <div
                    ref={previewRef}
                    className={[
                      "nodrag nopan relative w-full overflow-hidden rounded-lg border border-white/10 bg-black/30",
                      operation === "outpaint" ? "h-[clamp(200px,24vh,260px)]" : "h-[176px]",
                    ].join(" ")}
                    onWheel={(event) => {
                      if (operation !== "retouch") return;
                      event.preventDefault();
                      zoomPreview(activeView.zoom + (event.deltaY < 0 ? 0.2 : -0.2));
                    }}
                    onPointerDown={(event) => {
                      if (operation === "retouch" && (retouchTool === "pan" || event.button === 1)) {
                        beginPan(event);
                        return;
                      }
                      beginPaint(event);
                    }}
                    onPointerMove={movePreview}
                    onPointerUp={(event) => endInteraction(event)}
                    onPointerCancel={(event) => endInteraction(event)}
                    onPointerLeave={(event) => {
                      setCursor((prev) => ({ ...prev, visible: false }));
                      endInteraction(event);
                    }}
                  >
                    {operation === "multiview" ? (
                      outputPreviewDisplayUrl ? (
                        <div className="flex h-full w-full items-center justify-center overflow-hidden bg-zinc-950/70">
                          <img src={outputPreviewDisplayUrl} alt="" className="max-h-full max-w-full object-contain bg-transparent" draggable={false} />
                        </div>
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:22px_22px] px-6 text-center">
                          <div className="rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] text-zinc-300">多角度渲染输出</div>
                          <div className="text-[10px] leading-relaxed text-zinc-500">当前槽位为空，生成完成后会在这里显示结果。</div>
                        </div>
                      )
                    ) : connectedInput?.url ? (
                      operation === "outpaint" ? (
                        <div className="absolute inset-0 overflow-hidden">
                          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(244,244,245,0.06),transparent_46%),linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:auto,24px_24px,24px_24px]" />
                          <div className="absolute inset-0 flex items-center justify-center p-6">
                            <div className="relative h-full w-full overflow-visible border border-white/10 bg-zinc-950/62">
                              <div
                                className="absolute left-1/2 top-1/2 rounded-lg border border-dashed border-zinc-100/85 bg-white/[0.035] shadow-[0_0_0_1px_rgba(244,244,245,0.14),0_16px_32px_rgba(0,0,0,0.24)] transition-[width,height] duration-200"
                                style={{
                                  ...outpaintGeometry.outerStyle,
                                  transform: "translate(-50%, -50%)",
                                }}
                              >
                                <div className="absolute inset-0 rounded-lg bg-[linear-gradient(45deg,rgba(255,255,255,0.045)_25%,transparent_25%,transparent_75%,rgba(255,255,255,0.045)_75%),linear-gradient(45deg,rgba(255,255,255,0.045)_25%,transparent_25%,transparent_75%,rgba(255,255,255,0.045)_75%)] bg-[length:18px_18px] bg-[position:0_0,9px_9px]" />
                                {insets.top > 0 ? <div className="absolute left-1/2 top-2 z-30 -translate-x-1/2 rounded-md border border-white/10 bg-black/60 px-2 py-1 text-[10px] text-zinc-200">+{Math.round(insets.top)}%</div> : null}
                                {insets.right > 0 ? <div className="absolute right-2 top-1/2 z-30 -translate-y-1/2 rounded-md border border-white/10 bg-black/60 px-2 py-1 text-[10px] text-zinc-200">+{Math.round(insets.right)}%</div> : null}
                                {insets.bottom > 0 ? <div className="absolute bottom-2 left-1/2 z-30 -translate-x-1/2 rounded-md border border-white/10 bg-black/60 px-2 py-1 text-[10px] text-zinc-200">+{Math.round(insets.bottom)}%</div> : null}
                                {insets.left > 0 ? <div className="absolute left-2 top-1/2 z-30 -translate-y-1/2 rounded-md border border-white/10 bg-black/60 px-2 py-1 text-[10px] text-zinc-200">+{Math.round(insets.left)}%</div> : null}
                                {(["top", "right", "bottom", "left", "top-left", "top-right", "bottom-left", "bottom-right"] as const).map((edge) => {
                                  const base = "absolute z-20 rounded-full border border-zinc-100/90 bg-zinc-950 shadow-[0_0_0_3px_rgba(244,244,245,0.12)]";
                                  const positionStyle: React.CSSProperties =
                                    edge === "top"
                                      ? { left: "50%", top: 0, transform: `translate(-50%, -${handlePadding}px)` }
                                      : edge === "bottom"
                                        ? { left: "50%", bottom: 0, transform: `translate(-50%, ${handlePadding}px)` }
                                        : edge === "left"
                                          ? { left: 0, top: "50%", transform: `translate(-${handlePadding}px, -50%)` }
                                          : edge === "right"
                                            ? { right: 0, top: "50%", transform: `translate(${handlePadding}px, -50%)` }
                                            : edge === "top-left"
                                              ? { left: 0, top: 0, transform: `translate(-${handlePadding}px, -${handlePadding}px)` }
                                              : edge === "top-right"
                                                ? { right: 0, top: 0, transform: `translate(${handlePadding}px, -${handlePadding}px)` }
                                                : edge === "bottom-left"
                                                  ? { left: 0, bottom: 0, transform: `translate(-${handlePadding}px, ${handlePadding}px)` }
                                                  : { right: 0, bottom: 0, transform: `translate(${handlePadding}px, ${handlePadding}px)` };
                                  const sizeClass =
                                    edge === "top" || edge === "bottom"
                                      ? "h-4 w-8 cursor-ns-resize"
                                      : edge === "left" || edge === "right"
                                        ? "h-8 w-4 cursor-ew-resize"
                                        : edge === "top-left" || edge === "bottom-right"
                                          ? "h-4 w-4 cursor-nwse-resize"
                                          : "h-4 w-4 cursor-nesw-resize";
                                  return <button key={edge} type="button" className={`${base} ${sizeClass}`} style={positionStyle} onPointerDown={(event) => startOutpaintDrag(edge, event)} />;
                                })}
                              </div>
                              <div className="absolute overflow-hidden border border-white/15 bg-zinc-950/95" style={outpaintGeometry.materialStyle}>
                                <img src={connectedInputDisplayUrl || connectedInput.url} alt="" className="block h-full w-full object-cover" draggable={false} />
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div
                          className="absolute inset-0"
                          style={{
                            transform: `translate(${activeView.panX}px, ${activeView.panY}px) scale(${activeView.zoom})`,
                            transformOrigin: "top left",
                          }}
                        >
                          <div className="flex h-full w-full items-center justify-center overflow-hidden">
                            <img src={connectedInputDisplayUrl || connectedInput.url} alt="" className="max-h-full max-w-full object-contain bg-transparent" draggable={false} />
                          </div>
                          {operation === "retouch" ? (
                            <div className="absolute inset-0">
                              <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none">
                                {activeStrokes.map((stroke, index) => (
                                  <polyline
                                    key={`${index}-${stroke.points.length}`}
                                    points={stroke.points.map((point) => `${point.x * 100},${point.y * 100}`).join(" ")}
                                    fill="none"
                                    stroke={stroke.erase ? "rgba(161,161,170,0.92)" : "rgba(244,244,245,0.92)"}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={Math.max(1.8, stroke.sizeRatio * 100)}
                                  />
                                ))}
                              </svg>
                            </div>
                          ) : null}
                        </div>
                      )
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-center text-zinc-500">
                        <ImageIcon className="h-7 w-7 text-zinc-600" strokeWidth={1.6} aria-hidden />
                        <div className="text-[10px] leading-4">连接素材后开始编辑</div>
                      </div>
                    )}
                    {operation === "retouch" && cursor.visible && connectedInput?.url ? (
                      <div
                        className={["pointer-events-none absolute rounded-full border", retouchTool === "erase" ? "border-zinc-400/90 bg-zinc-300/10" : "border-zinc-100/90 bg-zinc-100/10"].join(" ")}
                        style={{ width: brushSize, height: brushSize, left: cursor.x - brushSize / 2, top: cursor.y - brushSize / 2 }}
                      />
                    ) : null}
                  </div>

                  {operation === "multiview" ? (
                    <div className="mt-1.5 rounded-lg border border-white/10 bg-black/20 p-1.5">
                      <div className="mb-1 flex items-center justify-between text-[10px] text-zinc-500">
                        <span>{activeOperationLabel}输出槽</span>
                        <span>当前槽位 {activeOutputSlot + 1}</span>
                      </div>
                      <div className="grid grid-cols-5 gap-1">
                        {outputSlots.map((slot, index) => (
                          <button
                            key={index}
                            type="button"
                            aria-label={`output-${index + 1}`}
                            className={[
                              "nodrag nopan relative h-8 overflow-hidden rounded-md border bg-zinc-950/80 text-[10px] text-zinc-500 transition-all",
                              activeOutputSlot === index ? "border-zinc-100 shadow-[0_0_0_2px_rgba(244,244,245,0.16)]" : "border-white/10 hover:border-white/25",
                            ].join(" ")}
                            onClick={() => patchLatestOperationOutputState({ activeOutputSlot: index })}
                          >
                            {slot ? (
                              <img src={withGeneratedMediaCacheBust(slot, outputMediaCacheKey)} alt="" className="h-full w-full object-cover" draggable={false} />
                            ) : (
                              <span className="flex h-full w-full items-center justify-center">{index + 1}</span>
                            )}
                            <span className={["absolute bottom-0 left-0 right-0 h-0.5", activeOutputSlot === index ? "bg-zinc-100" : "bg-white/10"].join(" ")} />
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {operation === "outpaint" ? (
                    <div className="mt-2 grid grid-cols-[82px_1fr] gap-2">
                      <div className="grid h-[82px] w-[82px] grid-cols-3 grid-rows-3 gap-1">
                        {DIRECTIONS.map(({ value, icon: Icon }) => (
                          <button
                            key={value}
                            type="button"
                            className={[
                              "nodrag nopan flex items-center justify-center rounded-md border",
                              expandDirection === value ? "border-zinc-100/60 bg-zinc-700 text-white" : "border-white/10 bg-white/5 text-zinc-300",
                            ].join(" ")}
                            onClick={() => applyOutpaintPreset(value, expandPercent)}
                          >
                            <Icon className="h-3.5 w-3.5" />
                          </button>
                        ))}
                      </div>
                      <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                        <div className="flex items-center justify-between text-[11px] text-zinc-400">
                          <span>扩展范围</span>
                          <span>{outpaintPercent}% / {outpaintMaxPercent}%</span>
                        </div>
                          <input type="range" min="0" max={outpaintMaxPercent} step="1" value={outpaintPercent} className="nodrag nopan mt-2 w-full accent-zinc-200" onChange={(event) => applyOutpaintPreset(expandDirection, Number(event.target.value))} />
                          <div className="mt-2 flex flex-wrap gap-1">
                          {[0, 10, 20, 25, 35, 50].map((value) => (
                            <button
                              key={value}
                              type="button"
                              className={[
                                "nodrag nopan rounded-md border px-1.5 py-1 text-[9px]",
                                outpaintPercent === value ? "border-zinc-100/60 bg-zinc-700 text-white" : "border-white/10 bg-white/5 text-zinc-300",
                              ].join(" ")}
                              onClick={() => applyOutpaintPreset(expandDirection, value)}
                            >
                              {value}%
                            </button>
                          ))}
                        </div>
                        <div className="mt-2 border-t border-white/10 pt-2">
                          <div className="mb-1.5 flex items-center justify-between text-[10px] text-zinc-500">
                            <span>选区比例</span>
                            <span>{outpaintSelectionAspect.toFixed(2)}:1</span>
                          </div>
                          <div className="grid grid-cols-4 gap-1">
                            {OUTPAINT_RATIO_PRESETS.map((ratio) => {
                              const targetAspect = ratioToAspect(ratio) ?? 1;
                              const active = Math.abs(outpaintSelectionAspect - targetAspect) < 0.035;
                              return (
                                <button
                                  key={ratio}
                                  type="button"
                                  className={[
                                    "nodrag nopan rounded-md border px-1 py-1 text-[9px]",
                                    active ? "border-zinc-100/60 bg-zinc-700 text-white" : "border-white/10 bg-white/5 text-zinc-300",
                                  ].join(" ")}
                                  onClick={() => applyOutpaintRatioPreset(ratio)}
                                >
                                  {ratio}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {operation === "upscale" ? (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {([2, 4] as const).map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={[
                            "nodrag nopan rounded-lg border p-2.5 text-left",
                            upscaleFactor === value ? "border-zinc-100/60 bg-zinc-700 text-white" : "border-white/10 bg-black/20 text-zinc-300",
                          ].join(" ")}
                          onClick={() => patchNodeData({ upscaleFactor: value })}
                        >
                          <div className="text-[13px] font-semibold">{value}x 放大</div>
                          <div className="mt-1 text-[10px] text-zinc-400">
                            {naturalSize ? `${naturalSize.width * value} × ${naturalSize.height * value}` : "按原图比例放大"}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {operation === "retouch" ? (
                    <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-2">
                      <div className="flex items-center justify-between text-[11px] text-zinc-400">
                        <span>画笔大小</span>
                        <span>{brushSize}px</span>
                      </div>
                      <input type="range" min="12" max="72" step="2" value={brushSize} className="nodrag nopan mt-2 w-full accent-zinc-200" onChange={(event) => patchNodeData({ maskBrushSize: Number(event.target.value) })} />
                      <button type="button" className="nodrag nopan mt-2 inline-flex h-7 items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 text-[11px] text-zinc-200" onClick={() => setStrokes((prev) => prev.filter((stroke) => stroke.sourceUrl !== inputSignature))}>
                        <Trash2 className="h-3 w-3" />
                        <span>清空遮罩</span>
                      </button>
                    </div>
                  ) : null}

                  {operation === "multiview" ? (
                    <div className="mt-1.5 rounded-lg border border-white/10 bg-black/20 p-2">
                      <div className="grid grid-cols-8 gap-1">
                        {multiviewPresetAngles.map((angle) => (
                          <button
                            key={angle.value}
                            type="button"
                            className={[
                              "nodrag nopan overflow-hidden rounded-md border p-0.5",
                              multiviewAngle === angle.value ? "border-zinc-100/60 bg-zinc-700" : "border-white/10 bg-white/[0.03]",
                            ].join(" ")}
                            onClick={() => patchNodeData({
                              multiviewAngle: angle.value,
                              multiviewYaw: angle.yaw,
                              multiviewPitch: angle.pitch,
                              multiviewZoom: 100,
                              multiviewShiftX: 0,
                              multiviewShiftY: 0,
                            })}
                            title={angle.label}
                          >
                              <div className="relative h-7 overflow-hidden bg-zinc-950">
                              {connectedInput?.url ? (
                                <div className="flex h-full w-full items-center justify-center [transform-style:preserve-3d]">
                                  <img
                                    src={connectedInputDisplayUrl || connectedInput.url}
                                    alt=""
                                    className="max-h-full max-w-full object-contain transition-transform duration-200"
                                    style={{ transform: `perspective(1200px) rotateX(${-angle.pitch}deg) rotateY(${angle.yaw}deg) scale(0.82)` }}
                                    draggable={false}
                                  />
                                </div>
                              ) : null}
                            </div>
                            <div className="mt-0.5 truncate text-[9px] leading-none text-zinc-300">{angle.label}</div>
                          </button>
                        ))}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-x-2 gap-y-1 rounded-lg border border-white/10 bg-zinc-950/70 p-1.5 text-[10px] text-zinc-400">
                        <div className="grid grid-cols-[28px_1fr_34px] items-center gap-1.5">
                          <span>环绕</span>
                          <input
                            type="range"
                            min="-82"
                            max="82"
                            step="1"
                            value={multiviewYaw}
                            className="nodrag nopan w-full accent-zinc-200"
                            onChange={(event) => patchNodeData({ multiviewAngle: "custom", multiviewYaw: Number(event.target.value) })}
                          />
                          <span className="text-right text-zinc-200">{Math.round(multiviewYaw)}°</span>
                        </div>
                        <div className="grid grid-cols-[28px_1fr_34px] items-center gap-1.5">
                          <span>俯仰</span>
                          <input
                            type="range"
                            min="-48"
                            max="88"
                            step="1"
                            value={multiviewPitch}
                            className="nodrag nopan w-full accent-zinc-200"
                            onChange={(event) => patchNodeData({ multiviewAngle: "custom", multiviewPitch: Number(event.target.value) })}
                          />
                          <span className="text-right text-zinc-200">{Math.round(multiviewPitch)}°</span>
                        </div>
                        <div className="grid grid-cols-[28px_1fr_34px] items-center gap-1.5">
                          <span>焦距</span>
                          <input
                            type="range"
                            min="64"
                            max="165"
                            step="1"
                            value={multiviewZoom}
                            className="nodrag nopan w-full accent-zinc-200"
                            onChange={(event) => patchNodeData({ multiviewAngle: "custom", multiviewZoom: Number(event.target.value) })}
                          />
                          <span className="text-right text-zinc-200">{Math.round(multiviewZoom)}%</span>
                        </div>
                        <div className="grid grid-cols-[28px_1fr_42px] items-center gap-1.5">
                          <span>平移</span>
                          <input
                            type="range"
                            min="-78"
                            max="78"
                            step="1"
                            value={multiviewShiftX}
                            className="nodrag nopan w-full accent-zinc-200"
                            onChange={(event) => patchNodeData({ multiviewAngle: "custom", multiviewShiftX: Number(event.target.value) })}
                          />
                          <span className="text-right text-zinc-200">{Math.round(multiviewShiftX)}</span>
                        </div>
                        <div className="grid grid-cols-[28px_1fr_42px] items-center gap-1.5">
                          <span>升降</span>
                          <input
                            type="range"
                            min="-68"
                            max="68"
                            step="1"
                            value={multiviewShiftY}
                            className="nodrag nopan w-full accent-zinc-200"
                            onChange={(event) => patchNodeData({ multiviewAngle: "custom", multiviewShiftY: Number(event.target.value) })}
                          />
                          <span className="text-right text-zinc-200">{Math.round(multiviewShiftY)}</span>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {operation === "cutout" ? (
                    <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-2">
                      <div className="mb-2 text-[11px] text-zinc-400">背景预设</div>
                      <div className="grid grid-cols-4 gap-2">
                        {CUTOUT_BACKGROUNDS.map((bg) => (
                          <button
                            key={bg.value}
                            type="button"
                            className={[
                              "nodrag nopan rounded-lg border p-1 text-left",
                              cutoutBackground === bg.value ? "border-zinc-100/60 bg-zinc-700" : "border-white/10 bg-white/[0.03]",
                            ].join(" ")}
                            onClick={() => patchNodeData({ cutoutBackground: bg.value })}
                          >
                            <div className={`h-7 rounded-md border border-white/10 ${bg.cls}`} />
                            <div className="mt-1 text-[10px] text-zinc-300">{bg.label}</div>
                          </button>
                        ))}
                      </div>
                      <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-2">
                        <div className="flex items-center justify-between text-[11px] text-zinc-400">
                          <span>杈圭紭缇藉寲</span>
                          <span>{cutoutFeather}</span>
                        </div>
                        <input type="range" min="0" max="32" step="1" value={cutoutFeather} className="nodrag nopan mt-2 w-full accent-zinc-200" onChange={(event) => patchNodeData({ cutoutFeather: Number(event.target.value) })} />
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="min-w-0 rounded-lg border border-white/10 bg-zinc-900/90 p-2">
                  <div className="mb-2 flex items-center justify-between text-[11px] text-zinc-400">
                    <span>{operation === "multiview" ? "相机控制" : "最终效果"}</span>
                    <span>{operation === "multiview" ? "轨道视角" : `${activeOperationLabel}独立输出`}</span>
                  </div>
                  <div
                    className={[
                      "relative w-full overflow-hidden rounded-lg border border-white/10 bg-black/30",
                      data.isLoading ? "jimeng-process-output-rendering" : "",
                      operation === "multiview" ? "h-[176px]" : "h-[176px]",
                    ].join(" ")}
                  >
                    {operation === "multiview" && connectedInput?.url ? (
                      <div
                        className={[
                          "relative h-full w-full overflow-hidden bg-[radial-gradient(circle_at_50%_46%,rgba(255,255,255,0.08),transparent_42%),linear-gradient(180deg,rgba(39,39,42,0.98),rgba(9,9,11,1))]",
                          multiviewControlMode ? "cursor-grabbing" : "cursor-grab",
                        ].join(" ")}
                        onContextMenu={(event) => event.preventDefault()}
                        onPointerDown={beginMultiviewControl}
                        onPointerUp={(event) => {
                          setMultiviewControlMode(null);
                          event.currentTarget.releasePointerCapture?.(event.pointerId);
                        }}
                        onPointerCancel={(event) => {
                          setMultiviewControlMode(null);
                          event.currentTarget.releasePointerCapture?.(event.pointerId);
                        }}
                        onDoubleClick={() => resetMultiviewCamera()}
                        onWheel={(event) => {
                          event.preventDefault();
                          patchNodeData({
                            multiviewAngle: "custom",
                            multiviewZoom: clamp(multiviewZoom + (event.deltaY < 0 ? 6 : -6), 64, 165),
                          });
                        }}
                      >
                        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:22px_22px] opacity-40" />
                        <div className="absolute inset-x-0 bottom-0 h-[42%] bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:28px_18px] opacity-40 [transform:perspective(320px)_rotateX(62deg)_scale(1.42)] [transform-origin:50%_100%]" />
                        <div className="pointer-events-none absolute inset-5 rounded-[10px] border border-white/10 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.35)]" />
                        <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/12">
                          <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/12" />
                          <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-white/12" />
                        </div>
                        <div className="absolute inset-x-3 top-3 z-20 flex items-center justify-between">
                          <div className="rounded-md border border-white/10 bg-black/55 px-2 py-1 text-[10px] text-zinc-200 shadow-[0_8px_20px_rgba(0,0,0,0.28)]">
                            {multiviewControlMode === "pan" ? "平移构图" : multiviewControlMode === "dolly" ? "推拉镜头" : multiviewControlMode === "orbit" ? "环绕视角" : "轨道相机"}
                          </div>
                          <button
                            type="button"
                            className="nodrag nopan rounded-md border border-white/10 bg-black/55 px-2 py-1 text-[10px] text-zinc-200 shadow-[0_8px_20px_rgba(0,0,0,0.28)] hover:bg-zinc-800"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={resetMultiviewCamera}
                          >
                            复位
                          </button>
                        </div>
                        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 220 248" preserveAspectRatio="none">
                          <ellipse cx={multiviewCameraOverlay.centerX} cy={multiviewCameraOverlay.centerY} rx="92" ry="42" fill="none" stroke="rgba(244,244,245,0.2)" strokeWidth="1.3" />
                          <ellipse cx={multiviewCameraOverlay.centerX} cy={multiviewCameraOverlay.centerY} rx="66" ry="30" fill="none" stroke="rgba(244,244,245,0.16)" strokeWidth="1.1" />
                          <ellipse cx={multiviewCameraOverlay.centerX} cy={multiviewCameraOverlay.centerY} rx="38" ry="17" fill="none" stroke="rgba(244,244,245,0.12)" />
                          <line x1={multiviewCameraOverlay.cameraX} y1={multiviewCameraOverlay.cameraY} x2={multiviewCameraOverlay.centerX} y2={multiviewCameraOverlay.centerY} stroke="rgba(244,244,245,0.68)" strokeDasharray="4 4" />
                          <circle cx={multiviewCameraOverlay.centerX} cy={multiviewCameraOverlay.centerY} r="3" fill="rgba(255,255,255,0.88)" />
                        </svg>
                        <div
                          className="pointer-events-none absolute z-[12] h-8 w-8 rounded-full border border-zinc-100/35 bg-zinc-950/70 shadow-[0_10px_24px_rgba(0,0,0,0.42),0_0_0_6px_rgba(244,244,245,0.08)]"
                          style={{
                            left: `${(multiviewCameraOverlay.cameraX / 220) * 100}%`,
                            top: `${(multiviewCameraOverlay.cameraY / 248) * 100}%`,
                            transform: "translate(-50%, -50%)",
                          }}
                        >
                          <span className="absolute inset-[7px] rounded-full bg-zinc-100 shadow-[0_0_16px_rgba(244,244,245,0.45)]" />
                          <span className="absolute left-1/2 top-1/2 h-12 w-px -translate-x-1/2 -translate-y-1/2 bg-zinc-100/20" />
                          <span className="absolute left-1/2 top-1/2 h-px w-12 -translate-x-1/2 -translate-y-1/2 bg-zinc-100/20" />
                        </div>
                        <div className="absolute inset-0 flex items-center justify-center overflow-hidden [perspective:1400px]">
                          <img
                            src={connectedInputDisplayUrl || connectedInput.url}
                            alt=""
                            className={[
                              "max-h-[58%] max-w-[58%] object-contain drop-shadow-[0_18px_30px_rgba(0,0,0,0.36)] will-change-transform",
                              multiviewControlMode ? "transition-none" : "transition-transform duration-200 ease-out",
                            ].join(" ")}
                            style={{ transform: multiviewTransform, transformStyle: "preserve-3d" }}
                            draggable={false}
                          />
                        </div>
                        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 grid grid-cols-4 gap-1 text-[9px]">
                          <div className="rounded-md border border-white/10 bg-black/55 px-1.5 py-0.5 text-zinc-300">
                            <span className="text-zinc-500">偏航</span> {Math.round(multiviewYaw)}°
                          </div>
                          <div className="rounded-md border border-white/10 bg-black/55 px-1.5 py-0.5 text-zinc-300">
                            <span className="text-zinc-500">俯仰</span> {Math.round(multiviewPitch)}°
                          </div>
                          <div className="rounded-md border border-white/10 bg-black/55 px-1.5 py-0.5 text-zinc-300">
                            <span className="text-zinc-500">焦距</span> {Math.round(multiviewZoom)}%
                          </div>
                          <div className="rounded-md border border-white/10 bg-black/55 px-1.5 py-0.5 text-zinc-300">
                            <span className="text-zinc-500">位移</span> {Math.round(multiviewShiftX)}/{Math.round(multiviewShiftY)}
                          </div>
                        </div>
                      </div>
                    ) : outputPreviewDisplayUrl ? (
                      <div className={operation === "cutout" ? `h-full p-3 ${cutoutBgClass}` : "flex h-full w-full items-center justify-center overflow-hidden bg-zinc-950/70"}>
                        <div className="flex h-full w-full items-center justify-center overflow-hidden">
                          <img src={outputPreviewDisplayUrl} alt="" className="max-h-full max-w-full object-contain bg-transparent" draggable={false} />
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:22px_22px] px-6 text-center">
                        <div className="rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] text-zinc-300">{activeOperationLabel}预览输出</div>
                        <div className="text-[10px] leading-relaxed text-zinc-500">当前槽位为空，生成完成后会在这里显示结果。</div>
                      </div>
                    )}
                  </div>
                  {operation !== "multiview" ? (
                    <div className="mt-2">
                      <button
                        type="button"
                        className="nodrag nopan inline-flex h-7 items-center gap-1.5 rounded-md border border-white/10 bg-black/20 px-2.5 text-[10px] text-zinc-300 hover:bg-white/5"
                        onClick={() =>
                          patchNodeData({ outputShelfOpen: !outputShelfOpen })
                        }
                      >
                        <span>{activeOperationLabel}输出槽</span>
                        <span className="text-zinc-500">{assignedOutputCount}/5</span>
                        <ChevronDown className={["h-3 w-3 text-zinc-500 transition-transform", outputShelfVisible ? "rotate-180" : ""].join(" ")} />
                      </button>
                      {outputShelfVisible ? (
                    <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-2">
                      <div className="mb-1.5 flex items-center justify-between text-[10px] text-zinc-500">
                        <span>{activeOperationLabel}输出槽位</span>
                        <span>当前槽位 {activeOutputSlot + 1}</span>
                      </div>
                      <div className="grid grid-cols-5 gap-1.5">
                        {outputSlots.map((slot, index) => (
                          <button
                            key={index}
                            type="button"
                            aria-label={`output-${index + 1}`}
                            className={[
                              "nodrag nopan relative h-8 overflow-hidden rounded-md border bg-zinc-950/80 text-[9px] text-zinc-500 transition-all",
                              activeOutputSlot === index ? "border-zinc-100 shadow-[0_0_0_2px_rgba(244,244,245,0.16)]" : "border-white/10 hover:border-white/25",
                            ].join(" ")}
                            onClick={() => patchLatestOperationOutputState({ activeOutputSlot: index })}
                          >
                            {slot ? (
                              <img src={withGeneratedMediaCacheBust(slot, outputMediaCacheKey)} alt="" className="h-full w-full object-cover" draggable={false} />
                            ) : (
                              <span className="flex h-full w-full items-center justify-center">{index + 1}</span>
                            )}
                            <span className={["absolute bottom-0 left-0 right-0 h-0.5", activeOutputSlot === index ? "bg-zinc-100" : "bg-white/10"].join(" ")} />
                          </button>
                        ))}
                      </div>
                    </div>
                      ) : null}
                    </div>
                  ) : null}
                  {operation !== "multiview" && referenceThumbs.length > 0 ? (
                    <div className="mt-2">
                      <button
                        type="button"
                        className="nodrag nopan inline-flex h-7 items-center gap-1.5 rounded-md border border-white/10 bg-black/20 px-2.5 text-[10px] text-zinc-300 hover:bg-white/5"
                        onClick={() =>
                          patchNodeData({ referenceShelfOpen: !referenceShelfOpen })
                        }
                      >
                        <span>引用缩略图</span>
                        <span className="text-zinc-500">{referenceThumbs.length}/5</span>
                        <ChevronDown className={["h-3 w-3 text-zinc-500 transition-transform", referenceShelfVisible ? "rotate-180" : ""].join(" ")} />
                      </button>
                      {referenceShelfVisible ? (
                    <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-2">
                      <div className="mb-1.5 flex items-center justify-between text-[10px] text-zinc-500">
                            <span>引用缩略图</span>
                        <span>{currentImageUrls.slice(0, 5).length}/5</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {referenceThumbs.map((url, index) => (
                          <button key={`${url}-${index}`} type="button" className="overflow-hidden rounded-md border border-white/10 bg-zinc-950 shadow-sm" onClick={() => assignPreviewToSlot(activeOutputSlot, url)}>
                            <img src={withGeneratedMediaCacheBust(url, outputMediaCacheKey)} alt="" className="h-10 w-10 object-cover" draggable={false} />
                          </button>
                        ))}
                      </div>
                    </div>
                      ) : null}
                    </div>
                  ) : null}
                  {hasGeneratedOutputs ? (
                  <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-2">
                    <div className="mb-1.5 flex items-center justify-between text-[10px] text-zinc-500">
                      <span>底部操作</span>
                      <span>生成 / 导出</span>
                    </div>
                    <button type="button" className="nodrag nopan inline-flex h-7 w-full items-center justify-center gap-1 rounded-md border border-white/10 bg-white/5 text-[10px] text-zinc-200 hover:bg-white/10" onClick={() => void data.onImportOutputsAsMaterials?.()}>
                      <Sparkles className="h-3 w-3" />
                      <span>释放为素材卡片</span>
                    </button>
                  </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-2 rounded-xl border border-white/12 bg-zinc-950/92 p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[10px] font-medium tracking-[0.08em] text-zinc-500 uppercase">编辑提示词</div>
                  <button type="button" className="nodrag nopan rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-zinc-300 hover:bg-white/10 hover:text-white" onClick={() => patchNodeData({ promptText: defaultPromptText })}>
                    使用默认
                  </button>
                </div>
                <button
                  type="button"
                  className="nodrag nopan w-full rounded-lg border border-white/10 bg-zinc-900/65 px-2.5 py-2 text-left text-[11px] text-zinc-300 hover:bg-zinc-900/90"
                  onClick={() =>
                    patchNodeData({ promptEditorOpen: !promptEditorOpen })
                  }
                >
                  <div className="truncate">{promptSummary}</div>
                </button>
                {promptEditorVisible ? (
                <textarea
                  ref={promptRef}
                  className="nodrag nopan mt-2 min-h-[64px] w-full resize-y rounded-lg border border-white/10 bg-zinc-900/92 px-2.5 py-2 text-[11px] leading-relaxed text-white outline-none ring-zinc-300/30 placeholder:text-zinc-500 focus:ring"
                  placeholder={defaultPromptText}
                  value={draftPrompt}
                  onChange={(event) => patchNodeData({ promptText: event.target.value })}
                />
                ) : null}
                {promptEditorVisible ? (
                  <div className="mt-2 text-[10px] text-zinc-500">{promptIsCustomized ? "已自定义" : "当前为默认提示词"}</div>
                ) : null}
              </div>

              <div className="mt-2 rounded-xl border border-white/12 bg-zinc-950/92 p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <div className="mb-2 flex items-center justify-between text-[10px] text-zinc-500">
                  <span>输出与模型</span>
                  <span>{activeOperationLabel} 路 {selectedModelVersion}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] text-zinc-300">{settingsSummary}</div>
                  </div>
                  <button
                    type="button"
                    className="nodrag nopan inline-flex h-7 items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 text-[10px] text-zinc-300 hover:bg-white/10"
                    onClick={() =>
                      patchNodeData({ advancedSettingsOpen: !advancedSettingsOpen })
                    }
                  >
                    <span>{advancedSettingsOpen ? "收起设置" : "更多设置"}</span>
                    <ChevronDown className={["h-3 w-3 transition-transform", advancedSettingsOpen ? "rotate-180" : ""].join(" ")} />
                  </button>
                  <button
                    type="button"
                    className="nodrag nopan inline-flex h-7 min-w-[108px] items-center justify-center gap-1 rounded-lg bg-zinc-100 px-2.5 text-[11px] font-medium text-zinc-950 hover:bg-white disabled:opacity-60"
                    onClick={() => void runProcess()}
                    disabled={Boolean(data.isLoading)}
                  >
                    {data.isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    <span>{data.isLoading ? "处理中..." : operation === "multiview" ? "生成更多" : operation === "cutout" ? "应用抠图" : "开始处理"}</span>
                  </button>
                  <button
                    type="button"
                    className="nodrag nopan inline-flex h-7 min-w-[88px] items-center justify-center rounded-lg border border-white/10 bg-white/5 px-2.5 text-[11px] text-zinc-200 hover:bg-white/10 disabled:opacity-50"
                    onClick={() => outputPreviewUrl && setExpandedUrl(outputPreviewUrl)}
                    disabled={!outputPreviewUrl}
                  >
                    查看大图
                  </button>
                </div>
                {advancedSettingsOpen ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {supportsExternalQuality ? (
                    <label className="relative shrink-0">
                      <select
                        className="nodrag nopan h-7 min-w-[56px] appearance-none rounded-lg border border-white/10 bg-white/5 px-2 pr-6 text-[11px] font-medium text-zinc-100 outline-none ring-zinc-300/30 transition-colors hover:bg-white/10 focus:ring"
                        value={imageQuality}
                        onChange={(event) =>
                          patchNodeData({
                            imageQuality:
                              event.target.value === "high" || event.target.value === "hd"
                                ? event.target.value
                                : "standard",
                          })
                        }
                      >
                        {externalQualityOptions.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-500" />
                    </label>
                  ) : null}
                  {supportsExternalFormat ? (
                    <label className="relative shrink-0">
                      <select
                        className="nodrag nopan h-7 min-w-[60px] appearance-none rounded-lg border border-white/10 bg-white/5 px-2 pr-6 text-[11px] font-medium text-zinc-100 outline-none ring-zinc-300/30 transition-colors hover:bg-white/10 focus:ring"
                        value={imageFormat}
                        onChange={(event) =>
                          patchNodeData({
                            imageFormat: event.target.value === "png" ? "png" : "jpg",
                          })
                        }
                      >
                        {externalFormatOptions.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-500" />
                    </label>
                  ) : null}
                  <label className="relative min-w-[180px] flex-1">
                    <select
                      className="nodrag nopan h-7 w-full appearance-none rounded-lg border border-white/10 bg-white/5 px-2 pr-7 text-[11px] text-zinc-200 outline-none ring-zinc-300/30 transition-colors hover:bg-white/10 focus:ring"
                      value={selectedModelVersion}
                      onChange={(event) => patchNodeData({ modelVersion: event.target.value })}
                    >
                      {availableModels.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-500" />
                  </label>
                  <button
                    type="button"
                    className="nodrag nopan inline-flex h-7 min-w-[108px] items-center justify-center gap-1 rounded-lg bg-zinc-100 px-2.5 text-[11px] font-medium text-zinc-950 hover:bg-white disabled:opacity-60"
                    onClick={() => void runProcess()}
                    disabled={Boolean(data.isLoading)}
                  >
                    {data.isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    <span>{data.isLoading ? "处理中..." : operation === "multiview" ? "生成更多" : operation === "cutout" ? "应用抠图" : "开始处理"}</span>
                  </button>
                  <button
                    type="button"
                    className="nodrag nopan inline-flex h-7 min-w-[88px] items-center justify-center rounded-lg border border-white/10 bg-white/5 px-2.5 text-[11px] text-zinc-200 hover:bg-white/10 disabled:opacity-50"
                    onClick={() => outputPreviewUrl && setExpandedUrl(outputPreviewUrl)}
                    disabled={!outputPreviewUrl}
                  >
                    查看大图
                  </button>
                </div>
                ) : null}
                {data.error ? (
                  <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                    {data.error}
                  </div>
                ) : null}
              </div>
              </div>
          </div>
          {Array.from({ length: 5 }, (_, index) => (
            <MagneticHandleSource
              key={index}
              id={`output-${index + 1}`}
              pinX={pinXForSlot(index)}
              pinY={PROCESS_OUTPUT_PIN_Y}
              magneticVisible={magneticHandlesVisible}
              className="z-[30]"
            />
          ))}
        </div>
      </div>
      </div>
      {expandedUrl ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/80 p-4" onClick={() => setExpandedUrl(null)}>
          <div
            className="relative flex h-[min(92vh,calc(100vh-40px))] w-[min(92vw,calc(100vw-40px))] items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-zinc-950"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="absolute right-5 top-5 z-10 rounded-full bg-black/50 p-2 text-white"
              onClick={() => setExpandedUrl(null)}
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex h-full w-full items-center justify-center bg-transparent">
              <img
                src={withGeneratedMediaCacheBust(expandedUrl, outputMediaCacheKey)}
                alt=""
                className="block max-h-full max-w-full object-contain bg-transparent"
                draggable={false}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
