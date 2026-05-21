"use client";

import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  SelectionMode,
  useEdgesState,
  useNodesState,
  addEdge,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeTypes,
  type EdgeTypes,
} from "reactflow";
import "reactflow/dist/style.css";
import { PromptNode, type PromptNodeData } from "./nodes/PromptNode";
import { VideoNode, type VideoNodeData } from "./nodes/VideoNode";
import { TextBoxNode, type TextBoxNodeData } from "./nodes/TextBoxNode";
import {
  buildProcessOperationOutputPatch,
  getProcessOperationOutputState,
  ImageProcessNode,
  type ImageProcessNodeData,
  type ImageProcessOperation,
} from "./nodes/ImageProcessNode";
import {
  LocalImageNode,
  type LocalImageNodeData,
} from "./nodes/LocalImageNode";
import { GroupNode, type GroupNodeData } from "./nodes/GroupNode";
import {
  Image as ImageIcon,
  Plus,
  Upload,
  LogIn,
  LogOut,
  Coins,
  LayoutGrid,
  Grid2X2,
  ZoomIn,
  ZoomOut,
  Scan,
  History,
  Images,
  BookOpen,
  RefreshCw,
  Loader2,
  X,
  MapPinned,
  LocateFixed,
  Layers,
  Settings,
  House,
  Video,
  MessageSquareText,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Download,
  Trash2,
} from "lucide-react";
import {
  type GenerateStreamProgressEvent,
  computeProgressFromStreamEvent,
  formatGenerateProgressLine,
  isProgressQueuePhase,
} from "@/lib/generateStreamProgress";
import {
  multimodalRefCountErrorMessage,
  multimodalRefVideoDurationErrorMessage,
  sumReferenceVideoDurationsSec,
} from "@/lib/videoMaterialLimits";
import { computeAutoLayoutPositions } from "@/lib/canvasAutoLayout";
import {
  isTerminalQueryFailure,
  queryTaskJsonToProgressEvent,
} from "@/lib/queryTaskToProgress";
import { dispatchCloseMediaLightbox } from "@/lib/uiEvents";
import { DeletableEdge } from "./edges/DeletableEdge";
import {
  saveCanvasGraph,
  loadCanvasGraph,
  idbDeleteImage,
  createCanvasNodeId,
} from "@/lib/canvasPersist";
import { extractGeneratedFileName } from "@/lib/generatedUrl";
import {
  PROMPT_PREVIEW_BAND_H,
  computePromptPreviewShellDimensions,
} from "@/lib/promptPreviewShell";
import {
  defaultExternalImageModelForProvider,
  externalImageModelFallbacksForProvider,
  isExternalImageApiProviderId,
  normalizeExternalImageApiProviderId,
  type ExternalImageApiProviderId,
} from "@/lib/externalImageApiShared";
import { JIMENG_RF_DRAG_HANDLE_SELECTOR } from "@/lib/canvasNodeLongPressDrag";
import { filesToJpegDataUrls } from "@/lib/referenceThumbnails";
import type { GenerationHistoryEntry } from "@/lib/generationHistoryTypes";
import { MediaHistoryPanel } from "@/components/MediaHistoryPanel";
import {
  CanvasAgentDock,
  CANVAS_AGENT_MEDIA_DRAG_MIME,
} from "@/components/CanvasAgentDock";
import { backupGeneratedMediaToCache } from "@/lib/outputBackupCache";
import { captureVideoPosterDataUrl } from "@/lib/videoPosterCapture";
import { batchDownloadAssets, type BatchDownloadAsset } from "@/lib/desktopBatchDownload";
import {
  HISTORY_ENTRY_DRAG_MIME,
  type HistoryEntryDragPayload,
} from "@/lib/historyEntryDrag";
import type {
  CanvasAgentAction,
  CanvasAgentCanvasEdgeSummary,
  CanvasAgentCanvasNodeSummary,
  CanvasAgentCanvasSummary,
  CanvasAgentHistoryMessage,
  CanvasAgentResponse,
} from "@/lib/canvasAgentTypes";

type AppNodeData =
  | PromptNodeData
  | VideoNodeData
  | TextBoxNodeData
  | ImageProcessNodeData
  | LocalImageNodeData
  | GroupNodeData;
type DragSpeedLevel = "normal" | "fast" | "extreme";
type BrowserOption = { id: string; name: string; bin: string | null };
type QuickCreateKind = "prompt" | "prompt2" | "process";
type SidebarCreateKind = "prompt" | "prompt2" | "text" | "process" | "material";
type SidebarMode = "compact" | "expanded";
type SidebarPanelKind = "create" | "materials" | "layout" | "settings";
type PromptPanelMode = "floating" | "dock-right";
type PromptDockMode = "compact" | "expanded";
type ExternalApiProviderUiConfig = {
  displayName?: string;
  baseUrl?: string;
  apiKey?: string;
  imageModel?: string;
  textModel?: string;
  imageCostPerGeneration?: number | null;
  imageCostCurrency?: string;
};
type QuickConnectDraft = {
  point: { x: number; y: number };
  startPoint: { x: number; y: number };
  source: string;
  sourceHandle: string | null;
};

function asTaskRecord(row: unknown): Record<string, unknown> {
  return row && typeof row === "object" ? (row as Record<string, unknown>) : {};
}

function taskString(row: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function taskNumber(row: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function formatTaskTime(value: unknown) {
  const ms = typeof value === "number" && Number.isFinite(value) ? value : null;
  if (ms === null) return "";
  return new Date(ms).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatMoney(value: number, currency = "$") {
  const prefix = currency === "$" ? "$" : `${currency} `;
  return `${prefix}${value.toFixed(6)}`;
}

function formatOptionalCostInput(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function parseOptionalCostInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

function optionalCostInputForConfig(value: string) {
  const parsed = parseOptionalCostInput(value);
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined;
}

function formatTaskCost(row: Record<string, unknown>) {
  const cost =
    taskNumber(row, "upstream_cost", "upstreamCost") ??
    taskNumber(row, "estimated_cost", "estimatedCost") ??
    taskNumber(row, "cost");
  if (cost === null) return "";
  const currency =
    taskString(row, "upstream_cost_currency", "upstreamCostCurrency") ||
    taskString(row, "estimated_cost_currency", "estimatedCostCurrency") ||
    taskString(row, "currency") ||
    "$";
  const source = taskString(row, "upstream_cost_source", "upstreamCostSource");
  const sourceLabel =
    source === "configured" ? "配置" : source === "exact" ? "实际" : "";
  return `${sourceLabel ? `${sourceLabel} ` : ""}${formatMoney(cost, currency)}`;
}

function formatTaskUsage(row: Record<string, unknown>) {
  const usage = row.usage && typeof row.usage === "object" ? (row.usage as Record<string, unknown>) : {};
  const total = taskNumber(usage, "total_tokens");
  const input = taskNumber(usage, "input_tokens", "prompt_tokens");
  const output = taskNumber(usage, "output_tokens", "completion_tokens");
  const parts: string[] = [];
  if (total !== null) parts.push(`Tokens ${total}`);
  if (input !== null || output !== null) parts.push(`输入 ${input ?? "-"} / 输出 ${output ?? "-"}`);
  return parts.join(" · ");
}

function generatedMediaCacheKeyFromSourceNode(
  node: Node<AppNodeData> | undefined
): string | number | null {
  if (!node) return null;
  if (node.type === "prompt") {
    return (node.data as PromptNodeData).outputMediaVersion ?? null;
  }
  if (node.type === "process") {
    return (node.data as ImageProcessNodeData).outputMediaVersion ?? null;
  }
  return null;
}

const EXTERNAL_BALANCE_LABEL = "GPT";
const SIDEBAR_NODE_DRAG_MIME = "application/x-jimeng-sidebar-create";
const SIDEBAR_CREATE_LABELS: Record<SidebarCreateKind, string> = {
  prompt: "生图节点",
  prompt2: "生视频节点",
  text: "文本节点",
  process: "编辑",
  material: "素材节点",
};

const DRAG_SPEED_PRESETS: Record<
  DragSpeedLevel,
  { label: string; panOnScrollSpeed: number; autoPanOnNodeDrag: boolean }
> = {
  normal: { label: "标准", panOnScrollSpeed: 2.2, autoPanOnNodeDrag: false },
  fast: { label: "快速", panOnScrollSpeed: 4.2, autoPanOnNodeDrag: true },
  extreme: { label: "极速", panOnScrollSpeed: 6.6, autoPanOnNodeDrag: true },
};
const MIN_CANVAS_ZOOM = 0.3;
const MAX_CANVAS_ZOOM = 2;
const WHEEL_ZOOM_SENSITIVITY = 0.0016;

function clampCanvasZoom(zoom: number) {
  return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, zoom));
}

function isSidebarCreateKind(value: string): value is SidebarCreateKind {
  return (
    value === "prompt" ||
    value === "prompt2" ||
    value === "text" ||
    value === "process" ||
    value === "material"
  );
}

function wheelShouldStayNative(
  target: EventTarget | null,
  boundary: HTMLElement | null,
  deltaX: number,
  deltaY: number
) {
  let el = target instanceof HTMLElement ? target : null;
  const primaryDelta = Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : deltaX;

  while (el && el !== boundary) {
    const style = window.getComputedStyle(el);
    const isTextEditor =
      el instanceof HTMLTextAreaElement ||
      ((el instanceof HTMLInputElement || el instanceof HTMLSelectElement) &&
        !["range", "checkbox", "radio", "button", "submit", "reset", "file", "color"].includes(
          el.type
        )) ||
      el.isContentEditable;
    const canScrollY =
      (((/(auto|scroll|overlay)/.test(style.overflowY) || isTextEditor) &&
        el.scrollHeight > el.clientHeight + 1) ||
        (el instanceof HTMLTextAreaElement && el.scrollHeight > el.clientHeight + 1));
    if (canScrollY) {
      const top = el.scrollTop <= 0;
      const bottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      if ((primaryDelta < 0 && !top) || (primaryDelta > 0 && !bottom)) {
        return true;
      }
    }

    const canScrollX =
      /(auto|scroll|overlay)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1;
    if (canScrollX) {
      const left = el.scrollLeft <= 0;
      const right = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
      if ((deltaX < 0 && !left) || (deltaX > 0 && !right)) {
        return true;
      }
    }

    el = el.parentElement;
  }

  return false;
}

function isEditableTextTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement &&
      !["range", "checkbox", "radio", "button", "submit", "reset", "file", "color"].includes(
        target.type
      ))
  ) {
    return true;
  }
  return Boolean(
    target.closest(
      'textarea, input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="file"]):not([type="color"]), [contenteditable="true"], [contenteditable="plaintext-only"]'
    )
  );
}

function getWheelZoomAnchorClientPosition(
  target: EventTarget | null,
  fallback: { x: number; y: number }
) {
  if (!(target instanceof HTMLElement)) return fallback;
  const cardEl = target.closest(".jimeng-canvas-node-drag-handle") as HTMLElement | null;
  if (!cardEl) return fallback;
  const rect = cardEl.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function isPromptLikeType(type: string | undefined) {
  return type === "prompt" || type === "prompt2";
}

function toCanvasAgentPendingAction(
  action:
    | Extract<CanvasAgentAction, { type: "ask_generation_path" }>
    | Extract<CanvasAgentAction, { type: "generate_image" | "generate_video" }>
): Extract<CanvasAgentAction, { type: "ask_generation_path" }> {
  if (action.type === "ask_generation_path") {
    return action;
  }
  if (action.type === "generate_video") {
    return {
      type: "ask_generation_path",
      target: "video",
      prompt: action.prompt,
      reply: action.reply,
      reasoningSummary: action.reasoningSummary,
      count: action.count,
      ratio: action.ratio,
      resolutionType: action.resolutionType,
      durationSeconds: action.durationSeconds,
      withAudio: action.withAudio,
      modelVersion: action.modelVersion,
      targetNodeId: action.targetNodeId,
      referenceNodeIds: action.referenceNodeIds,
    };
  }
  return {
    type: "ask_generation_path",
    target: "image",
    prompt: action.prompt,
    reply: action.reply,
    reasoningSummary: action.reasoningSummary,
    count: action.count,
    ratio: action.ratio,
    resolutionType: action.resolutionType,
    imageProvider: action.imageProvider,
    modelVersion: action.modelVersion,
    targetNodeId: action.targetNodeId,
    referenceNodeIds: action.referenceNodeIds,
  };
}

/** 閸ュ墽澧栭悽鐔稿灇閼哄倻鍋?閳?鐟欏棝顣堕悽鐔稿灇 / 鐟欏棝顣舵禍褍鍤?閻ㄥ嫬寮懓鍐箾缁?*/
function isImagePromptToVideoMaterialEdge(
  sourceType: string | undefined,
  targetType: string | undefined
): boolean {
  return sourceType === "prompt" && (targetType === "prompt2" || targetType === "video");
}

/** 娑撳簼瀵岄弰鍓с仛妞よ泛娴樻稉鈧懛杈剧窗persistedPanel + promptPanelPrimaryImageIndex */
function primaryDisplayImageUrlFromImagePrompt(
  node: Node<AppNodeData> | undefined
): string | null {
  if (!node || node.type !== "prompt") return null;
  const d = node.data as PromptNodeData;
  const urls = d.persistedPanelImageUrls ?? [];
  if (urls.length > 0) {
    const maxI = urls.length - 1;
    const pIdx =
      typeof d.promptPanelPrimaryImageIndex === "number" &&
      Number.isFinite(d.promptPanelPrimaryImageIndex) &&
      d.promptPanelPrimaryImageIndex >= 0 &&
      d.promptPanelPrimaryImageIndex <= maxI
        ? d.promptPanelPrimaryImageIndex
        : 0;
    const u = urls[pIdx];
    if (typeof u === "string" && u.trim()) return u.trim();
  }
  const first = d.persistedPanelFirstImageUrl;
  if (typeof first === "string" && first.trim()) return first.trim();
  return null;
}

function primaryDisplayImageUrlFromProcessNode(
  node: Node<AppNodeData> | undefined,
  sourceHandle?: string | null
): string | null {
  if (!node || node.type !== "process") return null;
  const d = node.data as ImageProcessNodeData;
  const operation = d.operation ?? "outpaint";
  const scoped = getProcessOperationOutputState(d, operation);
  const slotMatch =
    typeof sourceHandle === "string" ? sourceHandle.match(/^output-(\d+)$/i) : null;
  if (slotMatch) {
    const slotIndex = Number(slotMatch[1]) - 1;
    const slotUrl = scoped.outputSlots[slotIndex] ?? null;
    if (typeof slotUrl === "string" && slotUrl.trim()) return slotUrl.trim();
  }
  const activeSlot = scoped.outputSlots[scoped.activeOutputSlot] ?? null;
  if (typeof activeSlot === "string" && activeSlot.trim()) return activeSlot.trim();
  const urls = scoped.imageUrls;
  const first = urls.find((url) => typeof url === "string" && url.trim());
  return typeof first === "string" && first.trim() ? first.trim() : null;
}

function primaryDisplayImageUrlFromSourceNode(
  node: Node<AppNodeData> | undefined,
  sourceHandle?: string | null
): string | null {
  if (!node) return null;
  if (node.type === "prompt") return primaryDisplayImageUrlFromImagePrompt(node);
  if (node.type === "process") return primaryDisplayImageUrlFromProcessNode(node, sourceHandle);
  if (node.type === "image") {
    const d = node.data as LocalImageNodeData;
    return typeof d.imagePreviewUrl === "string" && d.imagePreviewUrl.trim()
      ? d.imagePreviewUrl.trim()
      : null;
  }
  return null;
}

function isEditorOutputHandle(sourceHandle: string | null | undefined) {
  if (sourceHandle === "output") return true;
  return typeof sourceHandle === "string" && /^output-\d+$/i.test(sourceHandle);
}

/** 閸欘垵绻涢崗銉ф窗閺嶅洩濡悙?image_input 閻ㄥ嫭绨猾璇茬€烽敍鍫滅瑢 onConnect / handleGenerate 娑撯偓閼疯揪绱?*/
function isIncomingImageInputSourceAllowed(
  sourceType: string | undefined,
  targetType: string | undefined,
  localImageType: string
): boolean {
  if (sourceType === localImageType) return true;
  if (isImagePromptToVideoMaterialEdge(sourceType, targetType)) return true;
  if (sourceType === "process" && (targetType === "prompt" || targetType === "prompt2" || targetType === "video" || targetType === "process")) {
    return true;
  }
  /** 閸ュ墽澧栭悽鐔稿灇閼哄倻鍋?閳?閸ュ墽澧栭悽鐔稿灇閼哄倻鍋ｉ敍姘Ω濠ф劘濡悙閫涘瘜妫板嫯顫嶉崶鍙ョ稊娑撳搫寮懓?*/
  if (sourceType === "prompt" && targetType === "prompt") return true;
  if (sourceType === "prompt" && targetType === "process") return true;
  return false;
}

/** 2鑴?閵?鑴?閿? 瀵媴绱氱粵澶涚窗ceil(閳) 閸掓绱濋懛顏冪瑓閼板奔绗傞妴浣风矤瀹革箑鍩岄崣鍐诧綖閺?*/
function squareishGridCols(n: number) {
  if (n <= 1) return 1;
  return Math.ceil(Math.sqrt(n));
}

/**
 * 瀹革缚绗呯憴鎺嶅瘜閺勫墽銇氶敍鍫熜?0閿涘鏁剧敮鍐х秴缂冾喖娴愮€规熬绱版禒搴＄秼閸撳秴锛撳锔跨瑐鐟欐帒鎮滈崣鐐解偓浣告倻娑撳﹥甯撶敮鍐跨幢
 * 閺傚洦婀伴弽蹇曟暏 panelCenterOffsetX 鐎靛綊缍堥弫瀵哥秹濮樻潙閽╂稉顓炵妇閵? */
function computeSpillExpandLayout(args: {
  promptPos: { x: number; y: number };
  handleRowW: number;
  previewBandH: number;
  shellW: number;
  shellH: number;
  gap: number;
  totalSlots: number;
}): {
  gridW: number;
  panelCenterOffsetX: number;
  slotPos: (slotIndex: number) => { left: number; top: number };
} | null {
  const { promptPos, handleRowW, previewBandH, shellW, shellH, gap, totalSlots } = args;
  if (totalSlots < 1) return null;
  const cols = squareishGridCols(totalSlots);
  const shellTopRef = promptPos.y + (previewBandH - shellH);
  const anchorLeft = promptPos.x + (handleRowW - shellW) / 2;

  const cellLeftTop = (slotIndex: number, aLeft: number) => {
    const rowFromBottom = Math.floor(slotIndex / cols);
    const col = slotIndex % cols;
    const top = shellTopRef - rowFromBottom * (shellH + gap);
    const left = aLeft + col * (shellW + gap);
    return { left, top };
  };

  let minX = Infinity;
  let maxX = -Infinity;
  for (let s = 0; s < totalSlots; s++) {
    const { left } = cellLeftTop(s, anchorLeft);
    minX = Math.min(minX, left);
    maxX = Math.max(maxX, left + shellW);
  }
  const gridCenterX = (minX + maxX) / 2;
  const panelCenterOffsetX = gridCenterX - (promptPos.x + handleRowW / 2);
  const gridW = cols * shellW + (cols - 1) * gap;

  const slotPos = (slotIndex: number) => cellLeftTop(slotIndex, anchorLeft);

  return { gridW, panelCenterOffsetX, slotPos };
}

const SPILL_EXPAND_LAYOUT_GAP_PX = 14;

function formatBalanceNumber(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "--";
  if (Math.abs(value) >= 1000) {
    return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
  }
  if (Number.isInteger(value)) {
    return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
  }
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(value);
}

const EXTERNAL_VIDEO_PROVIDER_OPTIONS = [
  { id: "foropencode", label: "ForOpenCode 视频" },
] as const;

function sameStringArray(a: string[] | undefined, b: string[] | undefined) {
  const left = Array.isArray(a) ? a : [];
  const right = Array.isArray(b) ? b : [];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

/** 鐏炴洖绱戦弮鍓佹畱 hydrationUrlSnapshot 閸︺劌鍤崶鎹愮箖缁嬪鑵戞稉宥勭窗闁劙銆嶉弴瀛樻煀閿涙稒瀵滃Σ鎴掔秴閸氬牆鑻?persisted閿涘牅绱崗鍫礆閹靛秳绗屾０鍕潔鐢妇缍夐弽闂寸閼?*/
function spillHydrationSourceUrlAtIndex(pd: PromptNodeData, urlIndex: number): string {
  const persisted = pd.persistedPanelImageUrls ?? [];
  const p = persisted[urlIndex];
  if (typeof p === "string" && p.trim()) return p.trim();
  const snap = pd.canvasImageSpill?.hydrationUrlSnapshot;
  const s = Array.isArray(snap) ? snap[urlIndex] : undefined;
  if (typeof s === "string" && s.trim()) return s.trim();
  return "";
}

function spillNodeForUrlIndex(
  nodes: Node<AppNodeData>[],
  promptId: string,
  urlIndex: number
): Node<AppNodeData> | undefined {
  return nodes.find((n) => {
    if (n.type !== "image") return false;
    const d = n.data as LocalImageNodeData;
    return d.generatedSpillPromptId === promptId && d.generatedSpillUrlIndex === urlIndex;
  });
}

function spillNodesForPrompt(
  nodes: Node<AppNodeData>[],
  promptId: string
): Node<AppNodeData>[] {
  const p = nodes.find((n) => n.id === promptId && isPromptLikeType(n.type));
  const ids = (p?.data as PromptNodeData | undefined)?.canvasImageSpill?.imageNodeIds ?? [];
  return ids
    .map((id) => nodes.find((x) => x.id === id && x.type === "image"))
    .filter(Boolean) as Node<AppNodeData>[];
}

/** 閻㈣绔风純鎴炵壐瀹告彃鐫嶅鈧稉鏃€婀崷銊︽暪鐠у嘲濮╅悽璁宠厬閿涙俺顕?prompt 娑撳骸鍙ч懕?spill 閸椻剝鏆ｆ担鎾剁枂妞?*/
function spillCanvasGridStackOnTop(pd: PromptNodeData | undefined): boolean {
  const s = pd?.canvasImageSpill;
  return Boolean(s?.imageNodeIds?.length && !s.collapseAnim);
}

const CANVAS_SPILL_GRID_Z_BOOST = 16000;

function spillUrlExtent(pd: PromptNodeData, spillNodes: Node<AppNodeData>[]): number {
  const spill = pd.canvasImageSpill;
  const snap = spill?.hydrationUrlSnapshot ?? [];
  const persisted = pd.persistedPanelImageUrls ?? [];
  let extent = Math.max(snap.length, persisted.length);
  if (extent < 2) {
    for (const sn of spillNodes) {
      const ix = (sn.data as LocalImageNodeData).generatedSpillUrlIndex;
      if (typeof ix === "number") extent = Math.max(extent, ix + 1);
    }
  }
  return extent;
}

/**
 * 娑撹娴橀崣顏勬躬妫板嫯顫嶆竟鍐茬潔缁€鐚寸幢閻㈣绔?spill 濮ｅ繐绱堕崡鈥崇箑妞よ顕惔鏂挎暜娑撯偓閵嗗矂娼稉璇叉禈閵嗗秳绗呴弽鍥モ偓? * 娑撳秴鍟€閻╁瓨甯撮崚鐘哄Ν閻愮櫢绱欐导姘辩壃閸у繑蝎娴ｅ秵鏆熼敍澶涚幢閹跺﹣绮涢弽鍥ㄥ灇娑撹娴樻稉瀣垼閻ㄥ嫬宕遍弨瑙勬烦閸掓壆宸辨径杈ㄐ担宥呰嫙濞撳懐鈹栧?hydration閵? */
function reconcileGeneratedSpillAfterPrimaryChange(
  nodes: Node<AppNodeData>[],
  promptId: string,
  primaryIx: number
): Node<AppNodeData>[] {
  const p = nodes.find((n) => n.id === promptId && isPromptLikeType(n.type));
  if (!p) return nodes;
  const pd = p.data as PromptNodeData;
  const spill = pd.canvasImageSpill;
  if (!spill?.imageNodeIds?.length) return nodes;

  const snap = spill.hydrationUrlSnapshot ?? [];
  const persisted = pd.persistedPanelImageUrls ?? [];
  let extent = Math.max(snap.length, persisted.length);
  if (extent < 2) {
    for (const id of spill.imageNodeIds) {
      const node = nodes.find((x) => x.id === id && x.type === "image");
      const ix = (node?.data as LocalImageNodeData | undefined)?.generatedSpillUrlIndex;
      if (typeof ix === "number") extent = Math.max(extent, ix + 1);
    }
  }
  if (extent < 2) return nodes;

  const needed = Array.from({ length: extent }, (_, i) => i).filter((i) => i !== primaryIx);

  const spillNodesOf = (ns: Node<AppNodeData>[]) => {
    const pr = ns.find((x) => x.id === promptId && isPromptLikeType(x.type));
    const sp = (pr?.data as PromptNodeData | undefined)?.canvasImageSpill;
    if (!sp)
      return [] as Node<AppNodeData>[];
    return sp.imageNodeIds
      .map((id) => ns.find((x) => x.id === id && x.type === "image"))
      .filter(Boolean) as Node<AppNodeData>[];
  };

  const revokeBlob = (url: string | null | undefined) => {
    if (typeof url === "string" && url.startsWith("blob:")) {
      queueMicrotask(() => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* ignore */
        }
      });
    }
  };

  let next = nodes;
  for (let guard = 0; guard < 8; guard++) {
    const sns = spillNodesOf(next);
    const present = new Map<number, Node<AppNodeData>>();
    for (const sn of sns) {
      const uix = (sn.data as LocalImageNodeData).generatedSpillUrlIndex;
      if (typeof uix === "number" && needed.includes(uix) && !present.has(uix)) {
        present.set(uix, sn);
      }
    }
    const missing = needed.filter((i) => !present.has(i)).sort((a, b) => a - b);
    const offender = sns.find(
      (sn) => (sn.data as LocalImageNodeData).generatedSpillUrlIndex === primaryIx
    );
    if (!offender || missing.length === 0) break;

    // 鍙ˉ榻愪竴涓己鍙ｏ紝閬垮厤涓€娆″垏涓诲浘鏃惰繛缁噸鎺掑涓崱鐗囪€屼骇鐢熼棯鍔ㄣ€?
    const missingIndex = missing[0];
    revokeBlob((offender.data as LocalImageNodeData).imagePreviewUrl);
    next = next.map((n) =>
      n.id === offender.id && n.type === "image"
        ? {
            ...n,
            data: {
              ...(n.data as LocalImageNodeData),
              generatedSpillUrlIndex: missingIndex,
              generatedSpillPending: true,
              imagePreviewUrl: null,
              imageFile: null,
            },
          }
        : n
    );
    break;
  }

  return next;
}

/** 閻㈣绔风仦鏇炵磻閸椔扳偓宀冾啎娑撹桨瀵岄弰鍓с仛閵嗗稄绱版禍銈嗗床缂傗晝鏆愰崶鎯ц嫙娴犲海鏁剧敮鍐╅梽銈勭瑢妞よ泛娴橀柌宥咁槻閻ㄥ嫰鍋呭鐘插幢 */
function runSpillSetPrimary(
  nodes: Node<AppNodeData>[],
  promptId: string,
  newPrimaryIx: number,
  setNodes: Dispatch<SetStateAction<Node<AppNodeData>[]>>
): Node<AppNodeData>[] {
  const p = nodes.find((n) => n.id === promptId && isPromptLikeType(n.type));
  if (!p) return nodes;
  const pd = p.data as PromptNodeData;
  const oldIx =
    typeof pd.promptPanelPrimaryImageIndex === "number" ? pd.promptPanelPrimaryImageIndex : 0;
  if (oldIx === newPrimaryIx) return nodes;

  const nodeNew = spillNodeForUrlIndex(nodes, promptId, newPrimaryIx);
  const nodeOld = spillNodeForUrlIndex(nodes, promptId, oldIx);
  const urls = pd.persistedPanelImageUrls ?? [];

  const patchPromptPrimary = (ns: Node<AppNodeData>[]) =>
    ns.map((n) =>
      n.id === promptId && isPromptLikeType(n.type)
        ? {
            ...n,
            data: {
              ...(n.data as PromptNodeData),
              promptPanelPrimaryImageIndex: newPrimaryIx,
            },
          }
        : n
    );

  const finish = (ns: Node<AppNodeData>[]) =>
    reconcileGeneratedSpillAfterPrimaryChange(ns, promptId, newPrimaryIx);

  if (!nodeNew) {
    return finish(patchPromptPrimary(nodes));
  }

  if ((nodeNew.data as LocalImageNodeData).generatedSpillPending) {
    return finish(patchPromptPrimary(nodes));
  }

  const dNew = { ...(nodeNew.data as LocalImageNodeData) };

  if (nodeOld) {
    const dOld = { ...(nodeOld.data as LocalImageNodeData) };
    let next = nodes.map((n) => {
      if (n.id === nodeNew.id) {
        return {
          ...n,
          data: {
            ...dNew,
            imagePreviewUrl: dOld.imagePreviewUrl,
            imageFile: dOld.imageFile,
            generatedSpillUrlIndex: oldIx,
            generatedSpillFetchToken: undefined,
          },
        };
      }
      if (n.id === nodeOld.id) {
        return {
          ...n,
          data: {
            ...dOld,
            imagePreviewUrl: dNew.imagePreviewUrl,
            imageFile: dNew.imageFile,
            generatedSpillUrlIndex: newPrimaryIx,
            generatedSpillFetchToken: undefined,
          },
        };
      }
      return n;
    });
    next = patchPromptPrimary(next);
    const pAfter = next.find((x) => x.id === promptId && isPromptLikeType(x.type));
    const pdAfter = pAfter?.data as PromptNodeData | undefined;
    if (pdAfter) {
      const sns = spillNodesForPrompt(next, promptId);
      const extent = spillUrlExtent(pdAfter, sns);
      const needed = Array.from({ length: extent }, (_, i) => i).filter((i) => i !== newPrimaryIx);
      const covered = new Set<number>();
      for (const sn of sns) {
        if (sn.id === nodeOld.id) continue;
        const uix = (sn.data as LocalImageNodeData).generatedSpillUrlIndex;
        if (typeof uix === "number" && uix !== newPrimaryIx && needed.includes(uix)) {
          covered.add(uix);
        }
      }
      const miss = needed.find((i) => !covered.has(i));
      if (miss !== undefined) {
        const oldBlob = (next.find((x) => x.id === nodeOld.id)?.data as LocalImageNodeData)
          ?.imagePreviewUrl;
        const missRaw = urls[miss];
        const missDisplay = spillImmediateDisplayUrl(missRaw);
        next = next.map((n) =>
          n.id === nodeOld.id && n.type === "image"
            ? {
                ...n,
                data: {
                  ...(n.data as LocalImageNodeData),
                  generatedSpillUrlIndex: miss,
                  generatedSpillPending: !missDisplay,
                  imagePreviewUrl: missDisplay,
                  imageFile: null,
                  materialIsVideo: urlStringLooksLikeVideoUrl(missRaw),
                  generatedSpillFetchToken: undefined,
                },
              }
            : n
        );
        if (typeof oldBlob === "string" && oldBlob.startsWith("blob:")) {
          queueMicrotask(() => {
            try {
              URL.revokeObjectURL(oldBlob);
            } catch {
              /* ignore */
            }
          });
        }
      }
    }
    return finish(next);
  }

  const urlOld = urls[oldIx];
  const revokeLater = dNew.imagePreviewUrl;
  const oldDisplay = spillImmediateDisplayUrl(urlOld);
  const fetchToken = createCanvasNodeId("spillfetch");
  const relabeled = patchPromptPrimary(
    nodes.map((n) =>
      n.id === nodeNew.id && n.type === "image"
        ? {
            ...n,
            data: {
              ...(n.data as LocalImageNodeData),
              generatedSpillUrlIndex: oldIx,
              generatedSpillPending: !oldDisplay,
              imagePreviewUrl: oldDisplay,
              imageFile: null,
              materialIsVideo: urlStringLooksLikeVideoUrl(
                typeof urlOld === "string" ? urlOld : undefined
              ),
              generatedSpillFetchToken: oldDisplay ? fetchToken : undefined,
            },
          }
        : n
    )
  );
  if (typeof revokeLater === "string" && revokeLater.startsWith("blob:")) {
    queueMicrotask(() => {
      try {
        URL.revokeObjectURL(revokeLater);
      } catch {
        /* ignore */
      }
    });
  }
  const syncOut = finish(relabeled);

  void (async () => {
    if (typeof urlOld !== "string" || !urlOld.trim()) return;
    try {
      const r = await fetch(urlOld.trim());
      if (!r.ok) return;
      const blob = await r.blob();
      const mime = blob.type || "";
      const isVid = mime.startsWith("video/");
      const ext = isVid
        ? ".mp4"
        : mime.includes("webp")
          ? ".webp"
          : mime.includes("jpeg")
            ? ".jpg"
            : ".png";
      const defaultType = isVid ? "video/mp4" : "image/png";
      const file = new File(
        [blob],
        `spill-slot-${oldIx}${ext}`,
        { type: mime || defaultType }
      );
      const obj = URL.createObjectURL(blob);
      setNodes((prev) =>
        finish(
          prev.map((n) => {
            if (n.id !== nodeNew.id || n.type !== "image") return n;
            const ld = n.data as LocalImageNodeData;
            if (
              ld.generatedSpillFetchToken !== fetchToken ||
              ld.generatedSpillUrlIndex !== oldIx
            ) {
              return n;
            }
            const { generatedSpillSwapCover: _cov, ...ldRest } = ld;
            return {
              ...n,
              data: {
                ...ldRest,
                generatedSpillUrlIndex: oldIx,
                imagePreviewUrl: obj,
                imageFile: file,
                generatedSpillPending: false,
                materialIsVideo: isVid || urlStringLooksLikeVideoUrl(urlOld),
                generatedSpillFetchToken: undefined,
              },
            };
          })
        )
      );
    } catch {
      /* ignore */
    }
  })();

  return syncOut;
}

/**
 * 娴犲懎缍?imageOrder 娑撳骸缍嬮崜宥呭弳鏉堢濡悙褰掓肠閸氬牆鐣崗銊ょ閼峰瓨妞傜憴鍡曡礋閻劍鍩涢幏鏍уЗ閸氬海娈戞い鍝勭碍閿? * 閸氾箑鍨幐?edges 閺佹壆绮嶆稉顓犳畱鏉╃偟鍤庨崗鍫濇倵閿涘牆鍘涙潻鐐垫畱鎼村繐褰块棃鐘插閿涘鈧? */
function fileLooksLikeVideo(f: File | null | undefined): boolean {
  if (!f) return false;
  if (f.type.startsWith("video/")) return true;
  return /\.(mp4|webm|mov|mkv|m4v)$/i.test(f.name || "");
}

function urlStringLooksLikeVideoUrl(url: string | undefined): boolean {
  if (typeof url !== "string" || !url.trim()) return false;
  const s = url.trim().split("?")[0].toLowerCase();
  return /\.(mp4|webm|mov|m4v|mkv)$/.test(s);
}

function stripHashOnly(url: string): string {
  const t = typeof url === "string" ? url.trim() : "";
  if (!t) return "";
  const i = t.indexOf("#");
  return i >= 0 ? t.slice(0, i) : t;
}

function normalizedGeneratedMediaUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const clean = stripHashOnly(raw);
  return extractGeneratedFileName(clean) ? clean : null;
}

function collectGeneratedMediaUrlsFromNodes(nodes: Node<AppNodeData>[]): string[] {
  const out = new Set<string>();
  const push = (value: unknown) => {
    const clean = normalizedGeneratedMediaUrl(value);
    if (clean) out.add(clean);
  };

  for (const node of nodes) {
    if (node.type === "prompt" || node.type === "prompt2") {
      const data = node.data as PromptNodeData;
      push(data.persistedPanelFirstImageUrl);
      for (const url of data.persistedPanelImageUrls ?? []) push(url);
      continue;
    }
    if (node.type === "video") {
      const data = node.data as VideoNodeData;
      for (const url of data.imageUrls ?? []) push(url);
      continue;
    }
    if (node.type === "image") {
      const data = node.data as LocalImageNodeData;
      push(data.imagePreviewUrl);
    }
  }

  return Array.from(out).sort();
}

function replaceGeneratedMediaUrlsInNodes(
  nodes: Node<AppNodeData>[],
  snapshotByRel: Map<string, string>
): Node<AppNodeData>[] {
  if (snapshotByRel.size === 0) return nodes;

  const replaceOne = (value: unknown) => {
    if (typeof value !== "string") return value;
    const rel = extractGeneratedFileName(value);
    if (!rel) return value;
    return snapshotByRel.get(rel) ?? value;
  };

  const replaceMany = (value: unknown) =>
    Array.isArray(value) ? value.map((item) => replaceOne(item)) : value;

  return nodes.map((node) => {
    if (node.type === "prompt" || node.type === "prompt2") {
      const data = node.data as PromptNodeData;
      return {
        ...node,
        data: {
          ...data,
          persistedPanelFirstImageUrl: replaceOne(data.persistedPanelFirstImageUrl) as
            | string
            | null
            | undefined,
          persistedPanelImageUrls: replaceMany(data.persistedPanelImageUrls) as string[] | undefined,
        },
      };
    }
    if (node.type === "video") {
      const data = node.data as VideoNodeData;
      return {
        ...node,
        data: {
          ...data,
          imageUrls: replaceMany(data.imageUrls) as string[] | null | undefined,
        },
      };
    }
    if (node.type === "image") {
      const data = node.data as LocalImageNodeData;
      return {
        ...node,
        data: {
          ...data,
          imagePreviewUrl: replaceOne(data.imagePreviewUrl) as string | null | undefined,
        },
      };
    }
    return node;
  });
}

function appendCbQuery(url: string, token: number | string): string {
  const base = stripHashOnly(url);
  if (!base) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}cb=${encodeURIComponent(String(token))}`;
}

function inferDownloadNameFromUrl(url: string, fallbackBase: string, mediaType: "image" | "video" | "file") {
  const clean = stripHashOnly(url);
  const rawExt = (() => {
    try {
      const parsed = new URL(clean, "http://localhost");
      const fromName = parsed.searchParams.get("name")?.trim() || parsed.pathname;
      const ext = fromName.match(/\.([a-z0-9]{2,6})(?:$|[?#])/i)?.[1];
      return ext ? `.${ext.toLowerCase()}` : "";
    } catch {
      const ext = clean.match(/\.([a-z0-9]{2,6})(?:$|[?#])/i)?.[1];
      return ext ? `.${ext.toLowerCase()}` : "";
    }
  })();
  const ext = rawExt || (mediaType === "video" ? ".mp4" : mediaType === "image" ? ".png" : ".bin");
  return `${fallbackBase}${ext}`;
}

/** 缂冩垶鐗?spill 閸椻€冲讲閻╁瓨甯存担?img/video src閿涘牓娼?blob閿涘绱濈拋鍙ュ瘜閺勭偓妞傛导妯哄帥閻劌鍙鹃柆鍨帳濞撳懐鈹?+ 缁绢垵澹婇柆顔惧兊闂傤亪绮?*/
function spillImmediateDisplayUrl(raw: string | undefined): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t || t.startsWith("blob:")) return null;
  if (t.startsWith("/") || t.startsWith("http://") || t.startsWith("https://")) return t;
  return null;
}

function isLocalMaterialVideo(node: Node<AppNodeData> | undefined): boolean {
  if (!node || node.type !== "image") return false;
  const d = node.data as LocalImageNodeData;
  if (fileLooksLikeVideo(d.imageFile)) return true;
  return d.materialIsVideo === true;
}

/** 娴?blob 妫板嫯顫嶉幁銏狀槻 File閿涘矂浼╅崗宥勭矌閺堝顣╃憴?URL 閺冭泛顦垮Ο鈩冣偓浣筋潒妫版垼顕Ч鍌涙弓鐢妇绀岄弶?*/
async function ensureLocalMaterialFile(
  node: Node<LocalImageNodeData>
): Promise<File | null> {
  const d = node.data as LocalImageNodeData;
  if (d.imageFile && d.imageFile.size > 0) return d.imageFile;
  const url = d.imagePreviewUrl;
  if (typeof url !== "string" || !url.startsWith("blob:")) return null;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const asVideo = isLocalMaterialVideo(node);
    const rawType = (blob.type || "").trim();
    const mime =
      rawType && rawType !== "application/octet-stream"
        ? rawType
        : asVideo
          ? "video/mp4"
          : "image/png";
    const ext = mime.startsWith("video/")
      ? ".mp4"
      : mime.includes("webp")
        ? ".webp"
        : mime.includes("jpeg")
          ? ".jpg"
          : asVideo
            ? ".mp4"
            : ".png";
    return new File([blob], `material${ext}`, { type: mime });
  } catch {
    return null;
  }
}

async function ensureImageFileFromImagePromptNode(
  node: Node<AppNodeData>
): Promise<File | null> {
  if (node.type !== "prompt") return null;
  const url = primaryDisplayImageUrlFromImagePrompt(node);
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const blob = await r.blob();
    const mime =
      blob.type && blob.type !== "application/octet-stream" ? blob.type : "image/png";
    const ext = mime.includes("webp") ? ".webp" : mime.includes("jpeg") ? ".jpg" : ".png";
    return new File([blob], `image-prompt-primary${ext}`, { type: mime });
  } catch {
    return null;
  }
}

async function ensureImageFileFromProcessNode(
  node: Node<AppNodeData>,
  sourceHandle?: string | null
): Promise<File | null> {
  if (node.type !== "process") return null;
  const url = primaryDisplayImageUrlFromProcessNode(node, sourceHandle);
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    const mime =
      blob.type && blob.type !== "application/octet-stream" ? blob.type : "image/png";
    const ext = mime.includes("webp") ? ".webp" : mime.includes("jpeg") ? ".jpg" : ".png";
    return new File([blob], `process-primary${ext}`, { type: mime });
  } catch {
    return null;
  }
}

async function ensureMaterialFileForVideoTarget(
  node: Node<AppNodeData>,
  localImageType: string,
  sourceHandle?: string | null
): Promise<File | null> {
  if (node.type === localImageType) {
    return ensureLocalMaterialFile(node as Node<LocalImageNodeData>);
  }
  if (node.type === "prompt") {
    return ensureImageFileFromImagePromptNode(node);
  }
  if (node.type === "process") {
    return ensureImageFileFromProcessNode(node, sourceHandle);
  }
  return null;
}

function orderedImageIdsForPrompt(
  incomingInEdgeOrder: string[],
  storedOrder: string[] | undefined
): string[] {
  if (incomingInEdgeOrder.length === 0) return [];
  const set = new Set(incomingInEdgeOrder);
  const order = storedOrder ?? [];
  const valid =
    order.length === incomingInEdgeOrder.length &&
    order.every((id) => set.has(id)) &&
    incomingInEdgeOrder.every((id) => order.includes(id));
  if (valid) return order.filter((id) => set.has(id));
  return [...incomingInEdgeOrder];
}

/** 娑?handleGenerate 娑撯偓閼疯揪绱版导妯哄帥 materialOrder閿涘苯鎯侀崚娆忔礀闁偓 imageOrder閿涘牊妫弫鐗堝祦閿?*/
function storedMaterialOrderForPrompt(d: PromptNodeData | VideoNodeData | undefined): string[] {
  if (!d) return [];
  return d.materialOrder && d.materialOrder.length > 0 ? d.materialOrder : (d.imageOrder ?? []);
}

/** 婢跺秴鍩楅懞鍌滃仯閺冭埖鐦℃稉顏勫閺堫兛濞囬悽銊у缁?blob URL閿涘矂浼╅崗?revoke 閻椾絻绻涢崗璺虹暊閼哄倻鍋?*/
function forkLocalImageNodeDataForDuplicate(data: LocalImageNodeData): LocalImageNodeData {
  const { generatedSpillSwapCover: _sc, ...rest } = data;
  const file = rest.imageFile ?? null;
  if (file) {
    return {
      ...rest,
      imagePreviewUrl: URL.createObjectURL(file),
      imageFile: file,
      materialIsVideo: fileLooksLikeVideo(file),
      refIndex: null,
    };
  }
  return {
    ...rest,
    materialIsVideo: rest.materialIsVideo,
    refIndex: null,
  };
}

/** 婢跺秴鍩?/ 缁鍒涢崥搴ｆ畱鐟欏棝顣堕懞鍌滃仯娑撳秴绨茬紒褎澹欓悽鐔稿灇娑擃厾濮搁幀渚婄礉闁灝鍘ゆ稉搴㈢爱閼哄倻鍋ｆ禒璇插娑撴彃褰?*/
function sanitizeVideoNodeDataForDuplicate(d: VideoNodeData): VideoNodeData {
  return {
    ...d,
    isLoading: false,
    error: null,
    imageUrls: null,
    expectedCount: undefined,
    generationSession: undefined,
    streamStatusLine: undefined,
    streamProgressPct: undefined,
    streamInQueue: undefined,
    lastSubmitId: undefined,
    resumeGenSourceNodeId: undefined,
  };
}

function sanitizePromptNodeDataForDuplicate(d: PromptNodeData): PromptNodeData {
  const {
    canvasImageSpill: _canvasImageSpill,
    persistedPanelImageUrls: _persistedPanelImageUrls,
    persistedPanelFirstImageUrl: _persistedPanelFirstImageUrl,
    promptPanelPrimaryImageIndex: _promptPanelPrimaryImageIndex,
    panelUrlsNormalizeRev: _panelUrlsNormalizeRev,
    outputMediaVersion: _outputMediaVersion,
    lastGeneratedAt: _lastGeneratedAt,
    lastRenderedPromptText: _lastRenderedPromptText,
    lastSubmitId: _lastSubmitId,
    resumeGenSourceNodeId: _resumeGenSourceNodeId,
    streamStatusLine: _streamStatusLine,
    streamProgressPct: _streamProgressPct,
    streamInQueue: _streamInQueue,
    isLoading: _isLoading,
    error: _error,
    ...rest
  } = d;
  return {
    ...rest,
    isLoading: false,
    error: null,
    lastSubmitId: undefined,
    resumeGenSourceNodeId: undefined,
    streamStatusLine: undefined,
    streamProgressPct: undefined,
    streamInQueue: undefined,
  };
}

function revokeBlobIfUnused(url: string | null | undefined, nodesAfterRemoval: Node<AppNodeData>[]) {
  if (!url || !url.startsWith("blob:")) return;
  const stillUsed = nodesAfterRemoval.some(
    (x) =>
      x.type === "image" && (x.data as LocalImageNodeData).imagePreviewUrl === url
  );
  if (stillUsed) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* ignore */
  }
}

function getAbsolutePosition(
  node: Node<AppNodeData>,
  byId: Map<string, Node<AppNodeData>>
): { x: number; y: number } {
  let x = node.position.x;
  let y = node.position.y;
  let parentId = (node as Node<AppNodeData> & { parentNode?: string }).parentNode;
  while (parentId) {
    const p = byId.get(parentId);
    if (!p) break;
    x += p.position.x;
    y += p.position.y;
    parentId = (p as Node<AppNodeData> & { parentNode?: string }).parentNode;
  }
  return { x, y };
}

const nodeTypes: NodeTypes = {
  prompt: PromptNode,
  prompt2: PromptNode,
  video: VideoNode,
  text: TextBoxNode,
  process: ImageProcessNode,
  image: LocalImageNode,
  group: GroupNode,
};

const edgeTypes: EdgeTypes = {
  deletable: DeletableEdge,
};

const CANVAS_EDGE_TYPE = "deletable";

const CANVAS_MINIMAP_LS = "jimeng-canvas-minimap-v1";
const CANVAS_SNAP_TO_GRID_LS = "jimeng-canvas-snap-to-grid-v1";
const CANVAS_UI_LS = "jimeng-canvas-ui-v1";

function createInitialNodes(): Node<AppNodeData>[] {
  return [
    {
      id: createCanvasNodeId("prompt"),
      type: "prompt",
      position: { x: 40, y: 220 },
      data: {
        promptText: "",
        modelVersion: "5.0",
        ratio: "16:9",
        resolutionType: "2k",
        count: 4,
      },
    },
  ];
}

const initialEdges: Edge[] = [];

export default function Canvas({
  autoRestore = true,
  onGoHome,
}: {
  autoRestore?: boolean;
  onGoHome?: () => void;
}) {
  const initialCanvasNodes = useMemo(() => createInitialNodes(), []);
  const [nodes, setNodes] = useNodesState<AppNodeData>(initialCanvasNodes);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => {
        const positionChanges = changes.filter(
          (ch): ch is Extract<NodeChange, { type: "position" }> =>
            ch.type === "position" && Boolean(ch.position)
        );
        if (positionChanges.length === 0) {
          return applyNodeChanges<AppNodeData>(changes, nds);
        }

        let byId: Map<string, Node<AppNodeData>> | null = null;
        const getPrevNode = (id: string) => {
          if (positionChanges.length === 1) return nds.find((n) => n.id === id);
          byId ??= new Map(nds.map((n) => [n.id, n]));
          return byId.get(id);
        };
        const promptMoves: { imageNodeIds: Set<string>; dx: number; dy: number }[] = [];
        for (const ch of positionChanges) {
          const position = ch.position;
          if (!position) continue;
          const prev = getPrevNode(ch.id);
          if (!prev || !isPromptLikeType(prev.type)) continue;
          const spill = (prev.data as PromptNodeData).canvasImageSpill;
          if (!spill?.imageNodeIds?.length) continue;
          const dx = position.x - prev.position.x;
          const dy = position.y - prev.position.y;
          if (dx === 0 && dy === 0) continue;
          promptMoves.push({ imageNodeIds: new Set(spill.imageNodeIds), dx, dy });
        }

        const next = applyNodeChanges<AppNodeData>(changes, nds);
        if (promptMoves.length === 0) return next;

        return next.map((n) => {
          for (const { imageNodeIds, dx, dy } of promptMoves) {
            if (imageNodeIds.has(n.id)) {
              return { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } };
            }
          }
          return n;
        });
      });
    },
    [setNodes]
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [activePanelNodeId, setActivePanelNodeId] = useState<string | null>(null);
  const [rf, setRf] = useState<any>(null);
  const flowHostRef = useRef<HTMLDivElement | null>(null);
  const [viewportShowsNodes, setViewportShowsNodes] = useState(true);
  const viewportCheckRafRef = useRef<number | null>(null);
  const [totalCredit, setTotalCredit] = useState<number | null>(null);
  const [creditLoading, setCreditLoading] = useState(false);
  const [creditMenuOpen, setCreditMenuOpen] = useState(false);
  const creditMenuRef = useRef<HTMLDivElement | null>(null);
  const [externalApiBalance, setExternalApiBalance] = useState<number | null>(null);
  const [externalApiBalanceText, setExternalApiBalanceText] = useState<string | null>(null);
  const [externalApiBalanceCurrency, setExternalApiBalanceCurrency] = useState<string | null>(null);
  const [externalApiBalanceError, setExternalApiBalanceError] = useState<string | null>(null);
  const [loginState, setLoginState] = useState<"checking" | "logged_in" | "logged_out">(
    "checking"
  );
  const [loginHint, setLoginHint] = useState<string>("");
  const [loginAuthUrl, setLoginAuthUrl] = useState<string | null>(null);
  const [loginAuthHasCallback, setLoginAuthHasCallback] = useState<boolean | null>(null);
  const [loginDebugPreview, setLoginDebugPreview] = useState<string>("");
  const [vipCredentialDialogOpen, setVipCredentialDialogOpen] = useState(false);
  const [vipCredentialSizeBytes, setVipCredentialSizeBytes] = useState<number | null>(null);
  const [browserPickerOpen, setBrowserPickerOpen] = useState(false);
  const [browserOptions, setBrowserOptions] = useState<BrowserOption[]>([]);
  const [browserPickerLoading, setBrowserPickerLoading] = useState(false);
  const [browserPickerErr, setBrowserPickerErr] = useState<string | null>(null);
  const loginRefreshTimerRef = useRef<number | null>(null);
  const [docsUrl, setDocsUrl] = useState<string | null>(null);
  const [cliVersion, setCliVersion] = useState<string | null>(null);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [mediaHistoryOpen, setMediaHistoryOpen] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("expanded");
  const [sidebarPanelKind, setSidebarPanelKind] = useState<SidebarPanelKind>("create");
  const [sidebarDragKind, setSidebarDragKind] = useState<SidebarCreateKind | null>(null);
  const [createPanelOpen, setCreatePanelOpen] = useState(false);
  const [createPanelAnchor, setCreatePanelAnchor] = useState<"button" | "context">("button");
  const [createPanelPoint, setCreatePanelPoint] = useState<{ x: number; y: number } | null>(null);
  const [quickConnectDraft, setQuickConnectDraft] = useState<QuickConnectDraft | null>(null);
  const createPanelHoverCloseRef = useRef<number | null>(null);
  const [cacheSettingsOpen, setCacheSettingsOpen] = useState(false);
  const [cacheDirInput, setCacheDirInput] = useState("");
  const [cacheDirCurrent, setCacheDirCurrent] = useState("");
  const [cacheDirDefault, setCacheDirDefault] = useState("");
  const [cacheDirBusy, setCacheDirBusy] = useState(false);
  const [cacheDirErr, setCacheDirErr] = useState<string | null>(null);
  const [externalApiProviderId, setExternalApiProviderId] =
    useState<ExternalImageApiProviderId>("default_gpt");
  const [externalApiConfigReady, setExternalApiConfigReady] = useState(false);
  const [externalApiProviders, setExternalApiProviders] = useState<
    Array<{
      id: ExternalImageApiProviderId;
      label: string;
      description: string;
    }>
  >([]);
  const [externalApiProviderConfigs, setExternalApiProviderConfigs] = useState<
    Partial<Record<ExternalImageApiProviderId, ExternalApiProviderUiConfig>>
  >({});
  const [externalApiBaseUrl, setExternalApiBaseUrl] = useState("");
  const [externalApiKey, setExternalApiKey] = useState("");
  const [externalApiDisplayName, setExternalApiDisplayName] = useState("");
  const [externalApiImageModel, setExternalApiImageModel] = useState("");
  const [externalApiTextModel, setExternalApiTextModel] = useState("");
  const [externalApiImageCost, setExternalApiImageCost] = useState("");
  const [externalApiImageCostCurrency, setExternalApiImageCostCurrency] = useState("$");
  const [externalApiModelOptions, setExternalApiModelOptions] = useState<string[]>([]);
  const [externalApiBusy, setExternalApiBusy] = useState(false);
  const [externalApiErr, setExternalApiErr] = useState<string | null>(null);
  const [externalApiDebugNote, setExternalApiDebugNote] = useState<string | null>(null);
  const [externalApiLastUsage, setExternalApiLastUsage] = useState<{
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    model?: string;
    at?: number;
  } | null>(null);
  const [externalVideoApiBaseUrl, setExternalVideoApiBaseUrl] = useState("");
  const [externalVideoApiKey, setExternalVideoApiKey] = useState("");
  const [externalVideoApiDisplayName, setExternalVideoApiDisplayName] = useState("");
  const [externalVideoApiModel, setExternalVideoApiModel] = useState("");
  const [externalVideoApiModelOptions, setExternalVideoApiModelOptions] = useState<string[]>([]);
  const [externalVideoApiBusy, setExternalVideoApiBusy] = useState(false);
  const [externalVideoApiErr, setExternalVideoApiErr] = useState<string | null>(null);
  const [externalVideoApiDebugNote, setExternalVideoApiDebugNote] = useState<string | null>(null);
  /** null閿涙艾鐨婚張顏呭閸欐牭绱眛rue閿涙碍澧﹂崠鍛妫ｆ牗顐奸棁鈧鍝勫煑闁绱︾€涙娲拌ぐ?*/
  const [packagedCacheOnboarding, setPackagedCacheOnboarding] = useState<boolean | null>(null);
  const [cacheOnboardingInput, setCacheOnboardingInput] = useState("");
  const [cacheOnboardingBusy, setCacheOnboardingBusy] = useState(false);
  const [cacheOnboardingErr, setCacheOnboardingErr] = useState<string | null>(null);
  /** 鐎瑰本鍨氶崥搴㈡Ц閸氾附绔婚悶?userData 娑撳绮拋?staging 娑?%TEMP% 鐠嬪啳鐦弮銉ョ箶 */
  const [cacheOnboardingClean, setCacheOnboardingClean] = useState(true);
  const [loginDiagOpen, setLoginDiagOpen] = useState(false);
  const [loginDiagData, setLoginDiagData] = useState<Record<string, unknown> | null>(
    null
  );
  const [loginDiagLoading, setLoginDiagLoading] = useState(false);
  const [loginDiagErr, setLoginDiagErr] = useState<string | null>(null);
  const [loginDiagBusy, setLoginDiagBusy] = useState<string | null>(null);
  /** 婢舵岸鈧?閳?閿涙碍绁︾粙瀣綏閺嶅洤瀵橀崶瀵告磪閿涘瞼鏁ゆ禍搴㈠Ω閵嗗本澧︾紒鍕┾偓宥夋嫟閸︺劍顢嬮柅澶婂隘閸╃喎褰告稉濠咁潡 */
  const [selectionBboxFlow, setSelectionBboxFlow] = useState<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } | null>(null);
  const [dragImportActive, setDragImportActive] = useState(false);
  /** 鐟欏棗褰涢獮宕囆?缂傗晜鏂侀崥搴″煕閺傜増澧︾紒鍕瘻闁筋喖鐫嗛獮鏇炴綏閺?*/
  const [viewportSeq, setViewportSeq] = useState(0);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [tasksRows, setTasksRows] = useState<unknown[]>([]);
  const [viewportZoom, setViewportZoom] = useState(1);
  const [dragSpeedLevel, setDragSpeedLevel] = useState<DragSpeedLevel>("fast");
  const [minimapVisible, setMinimapVisible] = useState(true);
  const [snapToGridEnabled, setSnapToGridEnabled] = useState(false);
  /** 娴?Prompt 鎼存洘鐖妴宀勨偓澶屾暰鐢啫娴橀悧鍥モ偓宥堢箻閸忋儻绱伴悙鐟板毊閺堫剙婀撮崶鍓у閼哄倻鍋ｉ崥搴ょ箾缁惧灝鍩屽?Prompt */
  const [pickImageForPromptId, setPickImageForPromptId] = useState<string | null>(null);
  /** 閺堚偓鏉╂垹鍋ｉ崙鏄忕箖閻ㄥ嫯濡悙鐧哥窗閻㈣绔烽悙閫涚娑撳绱伴崣鏍ㄧХ闁鑵戦敍灞肩稻娴犲秳绻氶幐浣筋嚉閼哄倻鍋?z 鎼村繒鐤嗘い璁圭礉閻╂潙鍩岄悙鐟板煂閸忚泛鐣犻懞鍌滃仯 */
  const [canvasStackFrontId, setCanvasStackFrontId] = useState<string | null>(null);
  const [agentMessages, setAgentMessages] = useState<CanvasAgentHistoryMessage[]>([]);
  const [agentDraft, setAgentDraft] = useState("");
  const [agentChatThinking, setAgentChatThinking] = useState(false);
  const [agentCanInterrupt, setAgentCanInterrupt] = useState(false);
  const agentCanInterruptRef = useRef(false);
  agentCanInterruptRef.current = agentCanInterrupt;
  const [agentModelLabel, setAgentModelLabel] = useState<string | null>(null);
  const [agentModelOptions, setAgentModelOptions] = useState<string[]>([
    "gpt-5.4",
    "gpt-5.5",
    "gpt-4.1",
    "gpt-4o-mini",
    "o3",
  ]);
  const [agentSelectedModel, setAgentSelectedModel] = useState("gpt-5.4");
  const [agentStatusLabel, setAgentStatusLabel] = useState<string | null>(null);
  const [agentAttachedImageDataUrls, setAgentAttachedImageDataUrls] = useState<string[]>([]);
  const [agentPendingAction, setAgentPendingAction] = useState<
    Extract<CanvasAgentAction, { type: "ask_generation_path" }> | null
  >(null);
  const [agentPendingRawMessage, setAgentPendingRawMessage] = useState<string | null>(null);
  const agentAbortRef = useRef<AbortController | null>(null);
  const agentChatIdleTimerRef = useRef<number | null>(null);
  const agentRequestSeqRef = useRef(0);
  const lastMouseClientPosRef = useRef<{ x: number; y: number } | null>(null);
  /** 娴犲懎婀悽璇茬缁岃櫣娅ч幋鏍Ν閻愰€涚瑐缁夎濮╅弮鑸垫纯閺傚府绱濋柆鍨帳閻愬綊銆婇柈銊ヤ紣閸忛攱鐖弮鑸靛Ω閼哄倻鍋ｅ鍝勫煂鐟欏棗褰涙い鍓侇伂 */
  const lastCanvasPointerClientPosRef = useRef<{ x: number; y: number } | null>(null);
  const selectionBboxFlowRef = useRef<typeof selectionBboxFlow>(null);
  selectionBboxFlowRef.current = selectionBboxFlow;
  const viewportSeqRafRef = useRef<number | null>(null);
  const spillHydratingRef = useRef<Set<string>>(new Set());
  /** 閺€鎯版崳 spill 閻ㄥ嫬娆㈡潻鐔告暪鐏忔拝绱扮仦鏇炵磻閸欘垰褰囧☉鍫礉闁灝鍘ら崡濠冩暪缂傗晜妞傞弮鐘崇《閸ョ偛鍩岀純鎴炵壐 */
  const spillCollapseFinalizeRef = useRef<Map<string, number>>(new Map());
  const spillCollapseStackRevealRef = useRef<Map<string, number>>(new Map());
  const spillCollapseOpenCtaRef = useRef<Map<string, number>>(new Map());
  const spillExpandStyleCleanupRef = useRef<Map<string, number>>(new Map());
  const spillLastExpandWasResumeRef = useRef(false);
  const handleGenerateRef = useRef<
    | ((
        args: {
          prompt: string;
          nodeId: string;
          imageProvider?: "dreamina" | "aiwanwu";
          videoProvider?: "dreamina" | "external_api";
          externalApiProviderId?: ExternalImageApiProviderId;
          imageQuality?: "standard" | "high" | "hd";
          modelVersion: string;
          ratio: string;
          resolutionType: string;
          count: number;
          durationSeconds?: number;
          withAudio?: boolean;
          onEachImage?: (url: string) => void;
          onStreamProgress?: (e: GenerateStreamProgressEvent) => void;
        }
      ) => Promise<{
        creditsAfter?: number | null;
        costPerImage?: number | null;
        firstImageUrl?: string | null;
        imageUrls?: string[];
        backgroundSyncPending?: boolean;
      }>)
    | null
  >(null);
  const pendingQuickConnectRef = useRef<{
    source: string;
    sourceHandle: string | null;
    startPoint: { x: number; y: number };
  } | null>(null);
  const completedQuickConnectRef = useRef(false);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const currentCanvasSnapshotSigRef = useRef<string>("");
  const clipboardRef = useRef<{
    nodes: Node<AppNodeData>[];
    edges: Edge[];
    bbox: { minX: number; minY: number };
  } | null>(null);
  const ctrlDragRef = useRef<null | {
    origIds: Set<string>;
    origPositions: Map<string, { x: number; y: number }>;
    dupByOrig: Map<string, string>; // orig -> dup
    dupEdgeCount: number;
  }>(null);
  const pendingFitAfterRestoreRef = useRef(false);
  /** 閸ュ彞绮犵壕浣烘磸鏉炶棄鍙嗛崥搴ㄢ偓鎺戭杻閿涘矁顔€ Prompt 閼哄倻鍋ｉ張澶嬫簚娴兼矮绮?data.persistedPanel* 閹峰娲栨禍褍鍤?*/
  const [canvasGraphEpoch, setCanvasGraphEpoch] = useState(0);
  const canvasSaveSkipRef = useRef(true);
  const undoStackRef = useRef<Array<{ nodes: Node<AppNodeData>[]; edges: Edge[] }>>([]);
  /** 閹稿鈧苯褰傜挧椋庢晸閹存劗娈戦懞鍌滃仯 id閵嗗秳鑵戝顫礉闁灝鍘ゆ径姘冲Ν閻愮懓鑻熼崣鎴炴娴滄帞娴?Abort 閹哄顕弬纭咁嚞濮?*/
  const generateAbortByNodeRef = useRef<Map<string, AbortController>>(new Map());
  /** 娴犲懐绮ㄩ弶鐔粹偓灞炬拱娴兼俺鐦介妴宥呮躬鐟欏棝顣舵潏鎾冲毉閼哄倻鍋ｆ稉濠勬畱 loading / 濞翠礁绱￠悩鑸碘偓渚婄礉闁灝鍘ゆ径姘冲Ν閻愮懓鑻熺悰宀€鏁撻幋鎰鞍閻╂瓕顩惄?*/
  const videoGenSessionRef = useRef(0);

  useEffect(() => {
    return () => {
      if (createPanelHoverCloseRef.current != null) {
        window.clearTimeout(createPanelHoverCloseRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
      }
    };
    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => window.removeEventListener("wheel", onWheel, true);
  }, []);

  useEffect(() => {
    try {
      const v = localStorage.getItem(CANVAS_MINIMAP_LS);
      if (v === "0") setMinimapVisible(false);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      const v = localStorage.getItem(CANVAS_SNAP_TO_GRID_LS);
      if (v === "1") setSnapToGridEnabled(true);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(CANVAS_MINIMAP_LS, minimapVisible ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [minimapVisible]);

  useEffect(() => {
    try {
      localStorage.setItem(CANVAS_SNAP_TO_GRID_LS, snapToGridEnabled ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [snapToGridEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem(
        CANVAS_UI_LS,
        JSON.stringify({
          activePanelNodeId,
        })
      );
    } catch {
      /* ignore */
    }
  }, [activePanelNodeId]);

  useEffect(() => {
    if (!autoRestore) return;
    let cancelled = false;
    (async () => {
      const g = await loadCanvasGraph();
      if (cancelled) return;
      if (g && g.nodes.length > 0) {
        setNodes(g.nodes);
        setEdges(g.edges);
        try {
          const rawUi = localStorage.getItem(CANVAS_UI_LS);
          if (rawUi) {
            const parsedUi = JSON.parse(rawUi) as { activePanelNodeId?: unknown };
            setActivePanelNodeId(
              typeof parsedUi?.activePanelNodeId === "string" &&
                g.nodes.some((node) => node.id === parsedUi.activePanelNodeId)
                ? parsedUi.activePanelNodeId
                : null
            );
          }
        } catch {
          /* ignore */
        }
        setCanvasGraphEpoch((e) => e + 1);
        pendingFitAfterRestoreRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setNodes, setEdges, autoRestore]);

  useEffect(() => {
    if (!rf || !pendingFitAfterRestoreRef.current) return;
    pendingFitAfterRestoreRef.current = false;
    requestAnimationFrame(() => {
      try {
        (rf as { fitView?: (o?: { padding?: number; duration?: number }) => void }).fitView?.({
          padding: 0.15,
          duration: 280,
        });
      } catch {
        /* ignore */
      }
    });
  }, [rf, nodes, edges]);

  useEffect(() => {
    if (canvasSaveSkipRef.current) {
      canvasSaveSkipRef.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      void saveCanvasGraph(nodes, edges);
    }, 300);
    return () => window.clearTimeout(t);
  }, [nodes, edges]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    const urls = collectGeneratedMediaUrlsFromNodes(nodes).filter((url) => {
      const rel = extractGeneratedFileName(url);
      return Boolean(rel && !rel.startsWith(".backup/") && !rel.startsWith(".history/"));
    });
    const sig = urls.join("\n");
    if (!sig || sig === currentCanvasSnapshotSigRef.current) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        const backup = await backupGeneratedMediaToCache(
          "current-canvas-protect",
          "image",
          urls
        ).catch(() => null);
        if (!backup?.ok || !Array.isArray(backup.files) || backup.files.length === 0) return;
        const snapshotByRel = new Map<string, string>();
        for (let i = 0; i < urls.length; i++) {
          const rel = extractGeneratedFileName(urls[i] ?? "");
          const snap = backup.files[i];
          if (!rel || typeof snap !== "string" || !snap.trim()) continue;
          snapshotByRel.set(rel, snap.trim());
        }
        if (snapshotByRel.size === 0) return;
        currentCanvasSnapshotSigRef.current = sig;
        setNodes((prev) => replaceGeneratedMediaUrlsInNodes(prev, snapshotByRel));
      })();
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [nodes, setNodes]);

  const currentCanvasProtectedUrlsSig = useMemo(
    () => collectGeneratedMediaUrlsFromNodes(nodes).join("\n"),
    [nodes]
  );

  useEffect(() => {
    const urls = currentCanvasProtectedUrlsSig
      ? currentCanvasProtectedUrlsSig.split("\n").filter(Boolean)
      : [];
    const timer = window.setTimeout(() => {
      void (async () => {
        if (urls.length === 0) {
          await fetch("/api/protected-media", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sourceId: "current:active" }),
          }).catch(() => {});
          return;
        }
        await fetch("/api/protected-media", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sources: [
              {
                sourceId: "current:active",
                label: "褰撳墠鐢诲竷",
                kind: "current",
                paths: urls,
              },
            ],
          }),
        }).catch(() => {});
      })();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [currentCanvasProtectedUrlsSig]);

  useEffect(() => {
    return () => {
      void fetch("/api/protected-media", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: "current:active" }),
      }).catch(() => {});
    };
  }, []);

  const canvasHeartbeatActive = useMemo(
    () =>
      nodes.some((node) => {
        if (node.type === "video") {
          return Boolean((node.data as VideoNodeData).isLoading);
        }
        if (isPromptLikeType(node.type)) {
          return Boolean((node.data as PromptNodeData).isLoading);
        }
        return false;
      }),
    [nodes]
  );

  useEffect(() => {
    if (!canvasHeartbeatActive) return;
    const iv = window.setInterval(() => {
      void saveCanvasGraph(nodesRef.current, edgesRef.current);
    }, 3500);
    return () => window.clearInterval(iv);
  }, [canvasHeartbeatActive]);

  /** 鐏炴洖绱戦崡鐘辩秴閸椻槄绱皃ersistedPanelImageUrls 閺?URL 閸氬孩濯洪崣鏍э綖閸?*/
  useEffect(() => {
    for (const n of nodes) {
      if (n.type !== "image") continue;
      const d = n.data as LocalImageNodeData;
      if (!d.generatedSpillPending || d.imagePreviewUrl) continue;
      if (spillHydratingRef.current.has(n.id)) continue;
      const pid = d.generatedSpillPromptId;
      if (!pid || typeof d.generatedSpillUrlIndex !== "number") continue;
      const prompt = nodes.find((p) => p.id === pid && isPromptLikeType(p.type));
      if (!prompt) continue;
      const pd = prompt.data as PromptNodeData;
      const url = spillHydrationSourceUrlAtIndex(pd, d.generatedSpillUrlIndex);
      if (!url) continue;

      spillHydratingRef.current.add(n.id);
      const nodeId = n.id;
      const ix = d.generatedSpillUrlIndex;
      const fetchToken = createCanvasNodeId("spillhydr");
      setNodes((prev) =>
        prev.map((node) => {
          if (node.id !== nodeId || node.type !== "image") return node;
          const ld = node.data as LocalImageNodeData;
          if (!ld.generatedSpillPending || ld.imagePreviewUrl) return node;
          return {
            ...node,
            data: {
              ...ld,
              generatedSpillFetchToken: fetchToken,
            },
          };
        })
      );
      void (async () => {
        try {
          const r = await fetch(url.trim());
          if (!r.ok) return;
          const blob = await r.blob();
          const mime = blob.type || "";
          const isVid = mime.startsWith("video/");
          const ext = isVid
            ? ".mp4"
            : mime.includes("webp")
              ? ".webp"
              : mime.includes("jpeg")
                ? ".jpg"
                : ".png";
          const defaultType = isVid ? "video/mp4" : "image/png";
          const file = new File([blob], `spill-hydr-${ix}${ext}`, { type: mime || defaultType });
          const objUrl = URL.createObjectURL(blob);
          setNodes((prev) =>
            prev.map((node) => {
              if (node.id !== nodeId || node.type !== "image") return node;
              const ld = node.data as LocalImageNodeData;
              if (
                !ld.generatedSpillPending ||
                ld.generatedSpillFetchToken !== fetchToken ||
                ld.generatedSpillUrlIndex !== ix
              ) {
                return node;
              }
              const { generatedSpillSwapCover: _c, ...ldRest } = ld;
              return {
                ...node,
                data: {
                  ...ldRest,
                  generatedSpillPending: false,
                  imagePreviewUrl: objUrl,
                  imageFile: file,
                  materialIsVideo: isVid || ld.materialIsVideo === true,
                  generatedSpillFetchToken: undefined,
                },
              };
            })
          );
        } catch {
          /* ignore */
        } finally {
          spillHydratingRef.current.delete(nodeId);
          setNodes((prev) =>
            prev.map((node) => {
              if (node.id !== nodeId || node.type !== "image") return node;
              const ld = node.data as LocalImageNodeData;
              if (ld.generatedSpillFetchToken !== fetchToken) return node;
              return {
                ...node,
                data: {
                  ...ld,
                  generatedSpillFetchToken: undefined,
                },
              };
            })
          );
        }
      })();
    }
  }, [nodes, setNodes]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    const flush = () => {
      void saveCanvasGraph(nodesRef.current, edgesRef.current);
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  /** 閸掗攱鏌婇崥搴划婢跺稄绱扮憴鍡涱暥閼哄倻鍋ｆ稉濠呭娴犲秵婀?isLoading + submitId閿涘苯鍨紒褏鐢绘潪顔款嚄娴犺濮熼惄纾嬪殾閹存劗澧栭幋鏍с亼鐠?*/
  const resumeVideoJobsSig = useMemo(() => {
    return nodes
      .filter((n) => n.type === "video")
      .map((n) => {
        const d = n.data as VideoNodeData;
        if (
          d.isLoading &&
          typeof d.resumeGenSourceNodeId === "string" &&
          d.resumeGenSourceNodeId.length > 0
        ) {
          return `${n.id}\0${d.lastSubmitId ?? ""}\0${d.resumeGenSourceNodeId}`;
        }
        return "";
      })
      .filter(Boolean)
      .sort()
      .join("|");
  }, [nodes]);

  useEffect(() => {
    if (!resumeVideoJobsSig) return;
    let cancelled = false;
    const fetchLatestVideoOutputs = async (
      sourceNodeId: string,
      retries = 20,
      waitMs = 900
    ) => {
      let urls: string[] = [];
      for (let k = 0; k < retries && urls.length === 0; k++) {
        const latestRes = await fetch(
          `/api/generated/latest?sourceNodeId=${encodeURIComponent(sourceNodeId)}`
        );
        const latestJson = (await latestRes.json()) as { urls?: string[] };
        urls = Array.isArray(latestJson.urls) ? latestJson.urls : [];
        if (urls.length > 0) break;
        if (k + 1 < retries) {
          await new Promise((res) => setTimeout(res, waitMs));
        }
      }
      return urls;
    };
    const fetchLatestVideoTaskId = async (sourceNodeId: string) => {
      const latestRes = await fetch(
        `/api/generated/latest?sourceNodeId=${encodeURIComponent(sourceNodeId)}`
      );
      const latestJson = (await latestRes.json()) as { submitIds?: string[] };
      const first = Array.isArray(latestJson.submitIds) ? latestJson.submitIds[0] : null;
      return typeof first === "string" && first.trim() ? first.trim() : null;
    };
    const tick = async () => {
      const list = nodesRef.current.filter((n) => n.type === "video");
      for (const snapNode of list) {
        const d = snapNode.data as VideoNodeData;
        if (!d.isLoading || typeof d.resumeGenSourceNodeId !== "string" || !d.resumeGenSourceNodeId) {
          continue;
        }
        const videoId = snapNode.id;
        const submitSnapshot =
          typeof d.lastSubmitId === "string" && d.lastSubmitId.trim() ? d.lastSubmitId.trim() : null;
        const sourceSnapshot = d.resumeGenSourceNodeId;
        const genSessionSnapshot = d.generationSession;
        const stillSameJob = (dn: VideoNodeData) => {
          if (!dn.isLoading) return false;
          if (dn.resumeGenSourceNodeId !== sourceSnapshot) return false;
          if (submitSnapshot && dn.lastSubmitId !== submitSnapshot) return false;
          if (
            typeof genSessionSnapshot === "number" &&
            dn.generationSession !== genSessionSnapshot
          )
            return false;
          return true;
        };
        try {
          if (!submitSnapshot) {
            const latestOnlyUrls = await fetchLatestVideoOutputs(sourceSnapshot, 1, 0);
            if (cancelled) return;
            if (latestOnlyUrls.length > 0) {
              const resumeDisplayUrls = latestOnlyUrls.map((u) =>
                isGeneratedMediaUrl(u) ? appendCbQuery(u, sourceSnapshot) : u
              );
              setNodes((prev) =>
                prev.map((node) => {
                  if (node.id !== videoId || node.type !== "video") return node;
                  const dn = node.data as VideoNodeData;
                  if (!stillSameJob(dn)) return node;
                  return {
                    ...node,
                    data: {
                      ...dn,
                      isLoading: false,
                      imageUrls: resumeDisplayUrls,
                      error: null,
                      expectedCount: dn.expectedCount ?? latestOnlyUrls.length,
                      lastSubmitId: undefined,
                      resumeGenSourceNodeId: undefined,
                      streamStatusLine: null,
                      streamProgressPct: undefined,
                      streamInQueue: undefined,
                      generationSession: undefined,
                    },
                  };
                })
              );
            } else {
              const recoveredSubmitId = await fetchLatestVideoTaskId(sourceSnapshot).catch(() => null);
              if (cancelled) return;
              if (recoveredSubmitId) {
                setNodes((prev) =>
                  prev.map((node) => {
                    if (node.id !== videoId || node.type !== "video") return node;
                    const dn = node.data as VideoNodeData;
                    if (!stillSameJob(dn)) return node;
                    return {
                      ...node,
                      data: {
                        ...dn,
                        lastSubmitId: recoveredSubmitId,
                        streamStatusLine: "已找回后台任务 ID，继续同步...",
                        streamInQueue: true,
                      },
                    };
                  })
                );
                continue;
              }
              setNodes((prev) =>
                prev.map((node) => {
                  if (node.id !== videoId || node.type !== "video") return node;
                  const dn = node.data as VideoNodeData;
                  if (!stillSameJob(dn) || dn.streamStatusLine) return node;
                  return {
                    ...node,
                    data: {
                      ...dn,
                      streamStatusLine: "后台任务仍在继续，等待状态同步...",
                      streamInQueue: true,
                    },
                  };
                })
              );
            }
            continue;
          }

          const r = await fetch(
            `/api/query_task?submit_id=${encodeURIComponent(submitSnapshot)}`
          );
          const j = (await r.json()) as Record<string, unknown>;
          if (cancelled) return;
          const st = String(j.gen_status || "").toLowerCase();
          if (st === "success") {
            let urls: string[] = await fetchLatestVideoOutputs(sourceSnapshot);
            if (!cancelled && urls.length === 0) {
              const syncRes = await fetch("/api/generated/sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  submitId: submitSnapshot,
                  sourceNodeId: sourceSnapshot,
                  index: 0,
                }),
              });
              const sj = (await syncRes.json()) as { urls?: string[] };
              if (Array.isArray(sj.urls) && sj.urls.length > 0) urls = sj.urls;
              if (urls.length === 0) {
                urls = await fetchLatestVideoOutputs(sourceSnapshot);
              }
            }
            if (cancelled) return;
            const bustResumeUrl = (u: string) => {
              if (!isGeneratedMediaUrl(u)) return u;
              return appendCbQuery(u, submitSnapshot);
            };
            const resumeDisplayUrls =
              urls.length > 0 ? urls.map(bustResumeUrl) : null;
            setNodes((prev) =>
              prev.map((node) => {
                if (node.id !== videoId || node.type !== "video") return node;
                const dn = node.data as VideoNodeData;
                if (!stillSameJob(dn)) return node;
                return {
                  ...node,
                  data: {
                    ...dn,
                    isLoading: false,
                    imageUrls: resumeDisplayUrls,
                    error:
                      urls.length > 0
                        ? null
                        : "Task finished but no output video file found. Please retry or check outputs.",
                    expectedCount: urls.length > 0 ? dn.expectedCount ?? urls.length : 0,
                    lastSubmitId: undefined,
                    resumeGenSourceNodeId: undefined,
                    streamStatusLine: null,
                    streamProgressPct: undefined,
                    streamInQueue: undefined,
                    generationSession: undefined,
                  },
                };
              })
            );
            continue;
          }
          if (isTerminalQueryFailure(j)) {
            const reason =
              typeof j.fail_reason === "string" && j.fail_reason.trim()
                ? j.fail_reason.trim()
                : "Task has ended (failed or cancelled).";
            if (cancelled) return;
            setNodes((prev) =>
              prev.map((node) => {
                if (node.id !== videoId || node.type !== "video") return node;
                const dn = node.data as VideoNodeData;
                if (!stillSameJob(dn)) return node;
                return {
                  ...node,
                  data: {
                    ...dn,
                    isLoading: false,
                    error: reason,
                    lastSubmitId: undefined,
                    resumeGenSourceNodeId: undefined,
                    streamStatusLine: null,
                    streamProgressPct: undefined,
                    streamInQueue: undefined,
                    generationSession: undefined,
                  },
                };
              })
            );
            continue;
          }
          const ev = queryTaskJsonToProgressEvent(submitSnapshot, j);
          const inQ = isProgressQueuePhase(ev);
          const line = formatGenerateProgressLine(ev);
          if (cancelled) return;
          setNodes((prev) =>
            prev.map((node) => {
              if (node.id !== videoId || node.type !== "video") return node;
              const dn = node.data as VideoNodeData;
              if (!stillSameJob(dn)) return node;
              const nextPct = computeProgressFromStreamEvent(ev, dn.streamProgressPct ?? 0);
              return {
                ...node,
                data: {
                  ...dn,
                  streamStatusLine: line,
                  streamProgressPct: nextPct,
                  streamInQueue: inQ,
                  lastSubmitId: submitSnapshot,
                },
              };
            })
          );
        } catch {
          /* ignore transient network errors */
        }
      }
    };
    void tick();
    const iv = window.setInterval(() => void tick(), 2200);
    return () => {
      cancelled = true;
      window.clearInterval(iv);
    };
  }, [resumeVideoJobsSig, setNodes]);

  const resumePromptJobsSig = useMemo(() => {
    return nodes
      .filter((n) => isPromptLikeType(n.type))
      .map((n) => {
        const d = n.data as PromptNodeData;
        if (
          d.isLoading &&
          typeof d.resumeGenSourceNodeId === "string" &&
          d.resumeGenSourceNodeId.length > 0
        ) {
          return `${n.id}\0${d.lastSubmitId ?? ""}\0${d.resumeGenSourceNodeId}`;
        }
        return "";
      })
      .filter(Boolean)
      .sort()
      .join("|");
  }, [nodes]);

  useEffect(() => {
    if (!resumePromptJobsSig) return;
    let cancelled = false;

    const fetchLatestPromptOutputs = async (
      sourceNodeId: string,
      retries = 20,
      waitMs = 900
    ) => {
      let urls: string[] = [];
      for (let k = 0; k < retries && urls.length === 0; k++) {
        const latestRes = await fetch(
          `/api/generated/latest?sourceNodeId=${encodeURIComponent(sourceNodeId)}`
        );
        const latestJson = (await latestRes.json()) as { urls?: string[] };
        urls = Array.isArray(latestJson.urls) ? latestJson.urls : [];
        if (urls.length > 0) break;
        if (k + 1 < retries) {
          await new Promise((res) => setTimeout(res, waitMs));
        }
      }
      return urls;
    };
    const fetchLatestPromptTaskId = async (sourceNodeId: string) => {
      const latestRes = await fetch(
        `/api/generated/latest?sourceNodeId=${encodeURIComponent(sourceNodeId)}`
      );
      const latestJson = (await latestRes.json()) as { submitIds?: string[] };
      const first = Array.isArray(latestJson.submitIds) ? latestJson.submitIds[0] : null;
      return typeof first === "string" && first.trim() ? first.trim() : null;
    };

    const tick = async () => {
      const list = nodesRef.current.filter((n) => isPromptLikeType(n.type));
      for (const snapNode of list) {
        const d = snapNode.data as PromptNodeData;
        if (
          !d.isLoading ||
          typeof d.resumeGenSourceNodeId !== "string" ||
          !d.resumeGenSourceNodeId
        ) {
          continue;
        }

        const promptId = snapNode.id;
        const sourceSnapshot = d.resumeGenSourceNodeId;
        const submitSnapshot =
          typeof d.lastSubmitId === "string" && d.lastSubmitId.trim() ? d.lastSubmitId.trim() : null;
        const generationMode = snapNode.type === "prompt2" ? "video" : "image";
        const stillSameJob = (dn: PromptNodeData) => {
          if (!dn.isLoading) return false;
          if (dn.resumeGenSourceNodeId !== sourceSnapshot) return false;
          if (submitSnapshot && dn.lastSubmitId !== submitSnapshot) return false;
          return true;
        };

        try {
          if (!submitSnapshot) {
            const latestOnlyUrls = await fetchLatestPromptOutputs(sourceSnapshot, 1, 0);
            if (cancelled) return;
            if (latestOnlyUrls.length > 0) {
              setNodes((prev) =>
                prev.map((node) => {
                  if (node.id !== promptId || !isPromptLikeType(node.type)) return node;
                  const dn = node.data as PromptNodeData;
                  if (!stillSameJob(dn)) return node;
                  return {
                    ...node,
                    data: {
                      ...dn,
                      isLoading: false,
                      error: null,
                      lastRenderedPromptText: dn.lastRenderedPromptText ?? dn.promptText,
                      lastGeneratedAt: Date.now(),
                      ...(generationMode === "image"
                        ? {
                            persistedPanelImageUrls: latestOnlyUrls,
                            persistedPanelFirstImageUrl:
                              latestOnlyUrls.length >= 2 ? null : (latestOnlyUrls[0] ?? null),
                            outputMediaVersion: Date.now(),
                          }
                        : {}),
                      lastSubmitId: undefined,
                      resumeGenSourceNodeId: undefined,
                      streamStatusLine: null,
                      streamProgressPct: undefined,
                      streamInQueue: undefined,
                    },
                  };
                })
              );
            } else {
              const recoveredSubmitId = await fetchLatestPromptTaskId(sourceSnapshot).catch(() => null);
              if (cancelled) return;
              if (recoveredSubmitId) {
                setNodes((prev) =>
                  prev.map((node) => {
                    if (node.id !== promptId || !isPromptLikeType(node.type)) return node;
                    const dn = node.data as PromptNodeData;
                    if (!stillSameJob(dn)) return node;
                    return {
                      ...node,
                      data: {
                        ...dn,
                        lastSubmitId: recoveredSubmitId,
                        streamStatusLine: "已找回后台任务 ID，继续同步...",
                        streamInQueue: true,
                      },
                    };
                  })
                );
                continue;
              }
              setNodes((prev) =>
                prev.map((node) => {
                  if (node.id !== promptId || !isPromptLikeType(node.type)) return node;
                  const dn = node.data as PromptNodeData;
                  if (!stillSameJob(dn) || dn.streamStatusLine) return node;
                  return {
                    ...node,
                    data: {
                      ...dn,
                      streamStatusLine: "后台任务仍在继续，等待状态同步...",
                      streamInQueue: true,
                    },
                  };
                })
              );
            }
            continue;
          }

          const r = await fetch(`/api/query_task?submit_id=${encodeURIComponent(submitSnapshot)}`);
          const j = (await r.json()) as Record<string, unknown>;
          if (cancelled) return;
          const st = String(j.gen_status || "").toLowerCase();
          if (st === "success") {
            let urls = await fetchLatestPromptOutputs(sourceSnapshot);
            if (!cancelled && urls.length === 0) {
              const syncRes = await fetch("/api/generated/sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  submitId: submitSnapshot,
                  sourceNodeId: sourceSnapshot,
                  index: 0,
                }),
              });
              const syncJson = (await syncRes.json()) as { urls?: string[] };
              if (Array.isArray(syncJson.urls) && syncJson.urls.length > 0) {
                urls = syncJson.urls;
              } else {
                urls = await fetchLatestPromptOutputs(sourceSnapshot);
              }
            }
            if (cancelled) return;
            const emptyMsg =
              generationMode === "video"
                ? "生成已结束，但未找到视频输出文件。请检查 CLI 输出后重试。"
                : "生成已结束，但未找到图片输出文件。请检查 CLI 输出后重试。";
            const emptyAfter = urls.length === 0;
            setNodes((prev) =>
              prev.map((node) => {
                if (node.id !== promptId || !isPromptLikeType(node.type)) return node;
                const dn = node.data as PromptNodeData;
                if (!stillSameJob(dn)) return node;
                return {
                  ...node,
                  data: {
                    ...dn,
                    isLoading: false,
                    error: emptyAfter ? emptyMsg : null,
                    lastRenderedPromptText: dn.lastRenderedPromptText ?? dn.promptText,
                    ...(!emptyAfter ? { lastGeneratedAt: Date.now() } : {}),
                    ...(generationMode === "image" && !emptyAfter
                      ? {
                          persistedPanelImageUrls: urls,
                          persistedPanelFirstImageUrl: urls.length >= 2 ? null : (urls[0] ?? null),
                          outputMediaVersion: submitSnapshot,
                        }
                      : {}),
                    lastSubmitId: undefined,
                    resumeGenSourceNodeId: undefined,
                    streamStatusLine: null,
                    streamProgressPct: undefined,
                    streamInQueue: undefined,
                  },
                };
              })
            );
            continue;
          }

          if (isTerminalQueryFailure(j)) {
            const reason =
              typeof j.fail_reason === "string" && j.fail_reason.trim()
                ? j.fail_reason.trim()
                : "Task has ended (failed or cancelled).";
            setNodes((prev) =>
              prev.map((node) => {
                if (node.id !== promptId || !isPromptLikeType(node.type)) return node;
                const dn = node.data as PromptNodeData;
                if (!stillSameJob(dn)) return node;
                return {
                  ...node,
                  data: {
                    ...dn,
                    isLoading: false,
                    error: reason,
                    lastSubmitId: undefined,
                    resumeGenSourceNodeId: undefined,
                    streamStatusLine: null,
                    streamProgressPct: undefined,
                    streamInQueue: undefined,
                  },
                };
              })
            );
            continue;
          }

          const ev = queryTaskJsonToProgressEvent(submitSnapshot, j);
          const line = formatGenerateProgressLine(ev);
          const inQ = isProgressQueuePhase(ev);
          setNodes((prev) =>
            prev.map((node) => {
              if (node.id !== promptId || !isPromptLikeType(node.type)) return node;
              const dn = node.data as PromptNodeData;
              if (!stillSameJob(dn)) return node;
              return {
                ...node,
                data: {
                  ...dn,
                  streamStatusLine: line,
                  streamProgressPct: computeProgressFromStreamEvent(
                    ev,
                    dn.streamProgressPct ?? 0
                  ),
                  streamInQueue: inQ,
                  lastSubmitId: submitSnapshot,
                },
              };
            })
          );
        } catch {
          /* ignore transient network errors */
        }
      }
    };

    void tick();
    const iv = window.setInterval(() => void tick(), 2200);
    return () => {
      cancelled = true;
      window.clearInterval(iv);
    };
  }, [resumePromptJobsSig, setNodes]);

  const screenToFlow = useCallback(
    (p: { x: number; y: number }) => {
      if (!rf) return { x: 400, y: 280 };
      if (typeof (rf as any).screenToFlowPosition === "function") {
        return (rf as any).screenToFlowPosition(p);
      }
      if (typeof (rf as any).project === "function") {
        return (rf as any).project(p);
      }
      return { x: 400, y: 280 };
    },
    [rf]
  );

  const getFlowPositionForNewNode = useCallback(() => {
    const client =
      lastCanvasPointerClientPosRef.current ??
      (() => {
        const el = flowHostRef.current;
        if (!el) {
          return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        }
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })();
    return screenToFlow(client);
  }, [screenToFlow]);

  const openCreatePanelAtClient = useCallback((clientX: number, clientY: number) => {
    dispatchCloseMediaLightbox();
    setActivePanelNodeId(null);
    setPickImageForPromptId(null);
    setSelectionBboxFlow(null);
    lastCanvasPointerClientPosRef.current = { x: clientX, y: clientY };
    setCreatePanelAnchor("context");
    setCreatePanelPoint({ x: clientX, y: clientY });
    setCreatePanelOpen(true);
  }, []);

  const runViewportVisibilityCheck = useCallback((flowApi?: { screenToFlowPosition?: (p: { x: number; y: number }) => { x: number; y: number } } | null) => {
    const inst = flowApi ?? rf;
    const host = flowHostRef.current;
    if (!inst || !host || typeof inst.screenToFlowPosition !== "function") {
      setViewportShowsNodes(true);
      return;
    }
    const rect = host.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) {
      setViewportShowsNodes(true);
      return;
    }
    const tl = inst.screenToFlowPosition({ x: rect.left, y: rect.top });
    const br = inst.screenToFlowPosition({ x: rect.right, y: rect.bottom });
    const vx0 = Math.min(tl.x, br.x);
    const vx1 = Math.max(tl.x, br.x);
    const vy0 = Math.min(tl.y, br.y);
    const vy1 = Math.max(tl.y, br.y);

    const list = nodesRef.current;
    if (list.length === 0) {
      setViewportShowsNodes(false);
      return;
    }

    const approxW = (n: Node<AppNodeData>) =>
      typeof n.width === "number" && n.width > 0
        ? n.width
        : n.type === "image"
          ? 320
          : n.type === "group"
            ? 280
            : 420;
    const approxH = (n: Node<AppNodeData>) =>
      typeof n.height === "number" && n.height > 0
        ? n.height
        : n.type === "image"
          ? 240
          : n.type === "group"
            ? 200
            : 460;

    let any = false;
    for (const n of list) {
      const x = n.position.x;
      const y = n.position.y;
      const w = approxW(n);
      const h = approxH(n);
      if (x + w > vx0 && x < vx1 && y + h > vy0 && y < vy1) {
        any = true;
        break;
      }
    }
    setViewportShowsNodes(any);
  }, [rf]);

  const scheduleViewportNodeCheck = useCallback(() => {
    if (viewportCheckRafRef.current != null) {
      cancelAnimationFrame(viewportCheckRafRef.current);
    }
    viewportCheckRafRef.current = requestAnimationFrame(() => {
      viewportCheckRafRef.current = null;
      runViewportVisibilityCheck();
    });
  }, [runViewportVisibilityCheck]);

  useEffect(() => {
    scheduleViewportNodeCheck();
  }, [nodes.length, scheduleViewportNodeCheck]);

  useEffect(
    () => () => {
      if (viewportCheckRafRef.current != null) {
        cancelAnimationFrame(viewportCheckRafRef.current);
      }
    },
    []
  );

  const outputNodeType = "video";
  const localImageNodeType = "image";

  const nodeById = useMemo(() => {
    const map = new Map<string, Node<AppNodeData>>();
    for (const n of nodes) map.set(n.id, n);
    return map;
  }, [nodes]);

  const onConnect = useCallback(
    (connection: Connection) => {
      completedQuickConnectRef.current = true;
      pendingQuickConnectRef.current = null;
      setQuickConnectDraft(null);
      setPickImageForPromptId(null);
      const { source, target, targetHandle, sourceHandle } = connection;

      if (!source || !target) return;
      if (targetHandle !== "image_input" || !isEditorOutputHandle(sourceHandle)) return;
      const targetNode = nodeById.get(target);
      setEdges((eds) => {
        const base =
          targetNode?.type === "process"
            ? eds.filter((edge) => !(edge.target === target && edge.targetHandle === "image_input"))
            : eds;
        return addEdge({ ...connection, type: CANVAS_EDGE_TYPE }, base);
      });

      setNodes((prev) => {
        const srcNode = prev.find((n) => n.id === source);
        const tgtNode = prev.find((n) => n.id === target);
        if (!srcNode || !tgtNode) return prev;
        if (!isPromptLikeType(tgtNode.type) && tgtNode.type !== "video" && tgtNode.type !== "process") {
          return prev;
        }
        if (
          !isIncomingImageInputSourceAllowed(
            srcNode.type,
            tgtNode.type,
            localImageNodeType
          )
        )
          return prev;
        if (tgtNode.type === "process") {
          return prev.map((n) =>
            n.id === target && n.type === "process"
              ? {
                  ...n,
                  data: {
                    ...(n.data as ImageProcessNodeData),
                    error: null,
                  },
                }
              : n
          );
        }
        return prev.map((n) => {
          if (n.id !== target || (!isPromptLikeType(n.type) && n.type !== "video")) return n;
          const d = n.data as PromptNodeData | VideoNodeData;
          const material = d.materialOrder ?? [];
          const nextMaterial = material.includes(source) ? material : [...material, source];
          if (srcNode.type === localImageNodeType) {
            const isVid = isLocalMaterialVideo(srcNode);
            if (isVid) {
              const cur = d.videoOrder ?? [];
              if (cur.includes(source)) return n;
              return {
                ...n,
                data: { ...d, materialOrder: nextMaterial, videoOrder: [...cur, source] },
              };
            }
            const cur = d.imageOrder ?? [];
            if (cur.includes(source)) return n;
            return {
              ...n,
              data: { ...d, materialOrder: nextMaterial, imageOrder: [...cur, source] },
            };
          }
          if (srcNode.type === "prompt" || srcNode.type === "process") {
            const cur = d.imageOrder ?? [];
            if (cur.includes(source)) return n;
            return {
              ...n,
              data: { ...d, materialOrder: nextMaterial, imageOrder: [...cur, source] },
            };
          }
          return n;
        });
      });
    },
    [setEdges, setNodes, localImageNodeType, nodeById]
  );

  const isValidConnection = useCallback(
    (connection: Connection) => {
      const { source, target, sourceHandle, targetHandle } = connection;
      if (!source || !target) return false;
      if (!isEditorOutputHandle(sourceHandle) || targetHandle !== "image_input") return false;
      const src = nodeById.get(source);
      const tgt = nodeById.get(target);
      if (!src || !tgt) return false;
      if (src.type === localImageNodeType) {
        if (tgt.type === "process") {
          return !isLocalMaterialVideo(src);
        }
        return isPromptLikeType(tgt.type) || tgt.type === outputNodeType;
      }
      if (src.type === "prompt" || src.type === "process") {
        return (
          tgt.type === "prompt" ||
          tgt.type === "prompt2" ||
          tgt.type === outputNodeType ||
          tgt.type === "process"
        );
      }
      return false;
    },
    [nodeById, localImageNodeType]
  );

  // Dragging an edge from prompt/video image input enters "pick local image node" mode.
  const onConnectStart = useCallback(
    (_event: any, params: { nodeId: string | null; handleId: string | null; handleType: any }) => {
      const nodeId = params.nodeId;
      const handleId = params.handleId;
      pendingQuickConnectRef.current = null;
      completedQuickConnectRef.current = false;
      if (nodeId && params.handleType === "source" && isEditorOutputHandle(handleId)) {
        const sourceNode = nodeById.get(nodeId);
        if (sourceNode?.type === localImageNodeType || sourceNode?.type === "prompt" || sourceNode?.type === "process") {
          const evt = _event as MouseEvent | TouchEvent | null | undefined;
          const target = evt?.target instanceof Element ? evt.target : null;
          const handleEl = target?.closest(".react-flow__handle") as HTMLElement | null | undefined;
          const rect = handleEl?.getBoundingClientRect();
          const eventPoint =
            evt && "changedTouches" in evt && evt.changedTouches.length > 0
              ? { x: evt.changedTouches[0]!.clientX, y: evt.changedTouches[0]!.clientY }
              : evt && "touches" in evt && evt.touches.length > 0
                ? { x: evt.touches[0]!.clientX, y: evt.touches[0]!.clientY }
                : evt && "clientX" in evt && "clientY" in evt
                  ? { x: evt.clientX, y: evt.clientY }
                  : { x: 0, y: 0 };
          const startPoint = rect
            ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
            : eventPoint;
          pendingQuickConnectRef.current = { source: nodeId, sourceHandle: handleId ?? "output", startPoint };
        }
        return;
      }
      if (!nodeId || handleId !== "image_input") return;
      const n = nodeById.get(nodeId);
      if (!isPromptLikeType(n?.type) && n?.type !== "video") return;
      setPickImageForPromptId(nodeId);
      setActivePanelNodeId(nodeId);
    },
    [localImageNodeType, nodeById]
  );

  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
    if (completedQuickConnectRef.current) {
      completedQuickConnectRef.current = false;
      pendingQuickConnectRef.current = null;
      return;
    }
    const pending = pendingQuickConnectRef.current;
    pendingQuickConnectRef.current = null;
    if (!pending) return;
    const point =
      "changedTouches" in event && event.changedTouches.length > 0
        ? { x: event.changedTouches[0]!.clientX, y: event.changedTouches[0]!.clientY }
        : "clientX" in event && "clientY" in event
          ? { x: event.clientX, y: event.clientY }
          : null;
    if (!point) return;
    const sourceNode = nodeById.get(pending.source);
    if (!sourceNode) return;
    dispatchCloseMediaLightbox();
    setActivePanelNodeId(null);
    setPickImageForPromptId(null);
    setSelectionBboxFlow(null);
    setCreatePanelOpen(false);
    lastCanvasPointerClientPosRef.current = point;
    setQuickConnectDraft({ point, startPoint: pending.startPoint, source: pending.source, sourceHandle: pending.sourceHandle });
  }, [nodeById]);

  const fitSelectionOrView = useCallback(() => {
    if (!rf) return;
    const selected = rf.getNodes().filter((n: Node<AppNodeData>) => n.selected);
    if (selected.length > 0) {
      rf.fitView({ nodes: selected, padding: 0.22, duration: 280 });
    } else {
      rf.fitView({ padding: 0.2, duration: 280 });
    }
  }, [rf]);

  const focusNodesByIds = useCallback(
    (ids: string[]) => {
      if (!rf || ids.length === 0) return;
      const idSet = new Set(ids);
      const selected = (rf.getNodes?.() ?? []).filter((node: Node<AppNodeData>) =>
        idSet.has(node.id)
      );
      if (selected.length === 0) return;
      try {
        if (selected.length === 1 && typeof rf.setCenter === "function") {
          const only = selected[0];
          const byId = new Map<string, Node<AppNodeData>>(
            ((rf.getNodes?.() ?? []) as Node<AppNodeData>[]).map((node) => [node.id, node])
          );
          const abs = getAbsolutePosition(only, byId);
          const width =
            typeof only.width === "number" && Number.isFinite(only.width) ? only.width : 420;
          const height =
            typeof only.height === "number" && Number.isFinite(only.height) ? only.height : 260;
          rf.setCenter(abs.x + width / 2, abs.y + height / 2, {
            zoom: Math.max(0.78, Math.min(1.02, rf.getZoom?.() ?? 0.88)),
            duration: 380,
          });
          return;
        }
        rf.fitView({ nodes: selected, padding: 0.26, duration: 380 });
      } catch {
        /* ignore */
      }
    },
    [rf]
  );

  const buildCanvasAgentSummary = useCallback((): CanvasAgentCanvasSummary => {
    const current = nodesRef.current;
    const currentEdges = edgesRef.current;
    const nodeTypeById = new Map(
      current.map((node) => [node.id, (node.type ?? "text") as CanvasAgentCanvasNodeSummary["type"]])
    );
    const incomingById = new Map<string, string[]>();
    const outgoingById = new Map<string, string[]>();
    for (const edge of currentEdges) {
      const incoming = incomingById.get(edge.target) ?? [];
      incoming.push(edge.source);
      incomingById.set(edge.target, incoming);
      const outgoing = outgoingById.get(edge.source) ?? [];
      outgoing.push(edge.target);
      outgoingById.set(edge.source, outgoing);
    }

    const summaries: CanvasAgentCanvasNodeSummary[] = current.map((node) => {
      const data = node.data as Partial<
        PromptNodeData &
          VideoNodeData &
          TextBoxNodeData &
          LocalImageNodeData &
          ImageProcessNodeData &
          GroupNodeData
      >;
      let label = "";
      if (typeof data.nodeName === "string" && data.nodeName.trim()) {
        label = data.nodeName.trim();
      } else if (typeof data.promptText === "string" && data.promptText.trim()) {
        label = data.promptText.trim().slice(0, 40);
      } else {
        label = node.type ?? "node";
      }

      const hasPromptMedia =
        Array.isArray(data.persistedPanelImageUrls) && data.persistedPanelImageUrls.length > 0;
      const hasVideoMedia = Array.isArray(data.imageUrls) && data.imageUrls.length > 0;
      const imagePreviewUrl =
        typeof (data as LocalImageNodeData).imagePreviewUrl === "string"
          ? (data as LocalImageNodeData).imagePreviewUrl ?? ""
          : "";
      const outputCount = Math.max(
        Array.isArray(data.persistedPanelImageUrls) ? data.persistedPanelImageUrls.length : 0,
        Array.isArray(data.imageUrls) ? data.imageUrls.length : 0
      );
      const runtimeError =
        typeof data.error === "string" && data.error.trim() ? data.error.trim() : null;
      const isRunning = data.isLoading === true;
      const status: CanvasAgentCanvasNodeSummary["status"] = isRunning
        ? "running"
        : runtimeError
          ? "error"
          : outputCount > 0 || Boolean(imagePreviewUrl.trim())
            ? "done"
            : "idle";
      return {
        id: node.id,
        type: (node.type ?? "text") as CanvasAgentCanvasNodeSummary["type"],
        selected: Boolean(node.selected),
        label,
        nodeName:
          typeof data.nodeName === "string" && data.nodeName.trim()
            ? data.nodeName.trim()
            : undefined,
        promptText:
          typeof data.promptText === "string" && data.promptText.trim()
            ? data.promptText.trim()
            : undefined,
        hasRenderableMedia: Boolean(
          hasPromptMedia || hasVideoMedia || imagePreviewUrl.trim()
        ),
        mediaKind:
          node.type === "prompt2" || node.type === "video"
            ? "video"
            : node.type === "prompt" || node.type === "image" || node.type === "process"
              ? "image"
              : null,
        canReference:
          node.type === "prompt" ||
          node.type === "process" ||
          node.type === "image" ||
          node.type === "video",
        status,
        error: runtimeError,
        modelVersion:
          typeof data.modelVersion === "string" && data.modelVersion.trim()
            ? data.modelVersion.trim()
            : undefined,
        imageProvider:
          data.imageProvider === "dreamina" || data.imageProvider === "aiwanwu"
            ? data.imageProvider
            : undefined,
        externalApiProviderId:
          isExternalImageApiProviderId(data.externalApiProviderId)
            ? data.externalApiProviderId
            : undefined,
        operation:
          typeof (data as ImageProcessNodeData).operation === "string"
            ? (data as ImageProcessNodeData).operation
            : undefined,
        ratio: typeof data.ratio === "string" && data.ratio.trim() ? data.ratio.trim() : undefined,
        resolutionType:
          typeof data.resolutionType === "string" && data.resolutionType.trim()
            ? data.resolutionType.trim()
            : undefined,
        count: typeof data.count === "number" ? data.count : undefined,
        durationSeconds:
          typeof data.durationSeconds === "number" ? data.durationSeconds : undefined,
        withAudio: typeof data.withAudio === "boolean" ? data.withAudio : undefined,
        referenceMode:
          data.referenceMode === "general" || data.referenceMode === "headtail"
            ? data.referenceMode
            : undefined,
        outputCount,
        incomingNodeIds: incomingById.get(node.id) ?? [],
        outgoingNodeIds: outgoingById.get(node.id) ?? [],
        connectedNodeIds: Array.from(
          new Set([...(incomingById.get(node.id) ?? []), ...(outgoingById.get(node.id) ?? [])])
        ),
        materialOrder: Array.isArray(data.materialOrder) ? [...data.materialOrder] : undefined,
        imageOrder: Array.isArray(data.imageOrder) ? [...data.imageOrder] : undefined,
        videoOrder: Array.isArray(data.videoOrder) ? [...data.videoOrder] : undefined,
        streamStatusLine:
          typeof data.streamStatusLine === "string" ? data.streamStatusLine : null,
        lastSubmitId:
          typeof data.lastSubmitId === "string" && data.lastSubmitId.trim()
            ? data.lastSubmitId.trim()
            : null,
      };
    });
    const edges: CanvasAgentCanvasEdgeSummary[] = currentEdges.map((edge) => ({
      id: edge.id,
      sourceId: edge.source,
      targetId: edge.target,
      sourceType: nodeTypeById.get(edge.source),
      targetType: nodeTypeById.get(edge.target),
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
    }));
    return {
      nodeCount: summaries.length,
      edgeCount: edges.length,
      selectedNodeIds: summaries.filter((item) => item.selected).map((item) => item.id),
      externalApiProviderId:
        isExternalImageApiProviderId(externalApiProviderId)
          ? externalApiProviderId
          : undefined,
      externalApiImageModel:
        typeof externalApiImageModel === "string" && externalApiImageModel.trim()
          ? externalApiImageModel.trim()
          : undefined,
      externalApiTextModel:
        typeof externalApiTextModel === "string" && externalApiTextModel.trim()
          ? externalApiTextModel.trim()
          : undefined,
      nodes: summaries,
      edges,
    };
  }, [externalApiImageModel, externalApiProviderId, externalApiTextModel]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          `/api/aiwanwu/models?kind=text&providerId=${encodeURIComponent(externalApiProviderId)}`,
          { cache: "no-store" }
        );
        const json = (await response.json().catch(() => null)) as
          | { models?: string[] }
          | null;
        const models =
          Array.isArray(json?.models) && json.models.length > 0
            ? json.models
            : ["gpt-5.4", "gpt-5.5", "gpt-4.1", "gpt-4o-mini", "o3"];
        if (cancelled) return;
        setAgentModelOptions(models);
        setAgentSelectedModel((prev) =>
          models.includes(prev)
            ? prev
            : typeof externalApiTextModel === "string" && models.includes(externalApiTextModel)
              ? externalApiTextModel
              : models[0] ?? "gpt-5.4"
        );
      } catch {
        if (cancelled) return;
        const fallback = ["gpt-5.4", "gpt-5.5", "gpt-4.1", "gpt-4o-mini", "o3"];
        setAgentModelOptions(fallback);
        setAgentSelectedModel((prev) => (fallback.includes(prev) ? prev : "gpt-5.4"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [externalApiProviderId, externalApiTextModel]);

  const pickAgentImages = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const picked = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (picked.length === 0) return;
    try {
      const urls = await filesToJpegDataUrls(picked, {
        max: 6,
        maxSide: 1600,
        quality: 0.9,
      });
      setAgentAttachedImageDataUrls((prev) => [...prev, ...urls].slice(0, 6));
    } catch {
      /* ignore */
    }
  }, []);

  const removeAgentImageAt = useCallback((index: number) => {
    setAgentAttachedImageDataUrls((prev) => prev.filter((_, idx) => idx !== index));
  }, []);

  const onZoomSlider = useCallback(
    (z: number) => {
      if (!rf || typeof rf.zoomTo !== "function") return;
      const clamped = clampCanvasZoom(z);
      rf.zoomTo(clamped, { duration: 0 });
      setViewportZoom(clamped);
      setViewportSeq((s) => s + 1);
    },
    [rf]
  );

  const createAgentPromptNode = useCallback(
    (action: Extract<CanvasAgentAction, { type: "generate_image" | "generate_video" }>) => {
      const isVideo = action.type === "generate_video";
      const promptId = createCanvasNodeId(isVideo ? "prompt2" : "prompt");
      const flowPos = getFlowPositionForNewNode();
      const referenceIds = Array.from(
        new Set(
          (action.referenceNodeIds ?? []).filter((id) =>
            nodesRef.current.some((node) => node.id === id)
          )
        )
      );

      const promptNode: Node<AppNodeData> = {
        id: promptId,
        type: isVideo ? "prompt2" : "prompt",
        position: flowPos,
        selected: true,
        data: isVideo
          ? ({
              nodeName: "视频生成节点",
              generationMode: "video",
              videoProvider: "external_api",
              referenceMode: "general",
              promptText: action.prompt,
              error: null,
              modelVersion: action.modelVersion || "seedance2.0fast",
              ratio: action.ratio || "16:9",
              resolutionType: action.resolutionType || "720p",
              count: action.count ?? 1,
              durationSeconds: action.durationSeconds ?? 5,
              withAudio: action.withAudio ?? false,
              materialOrder: referenceIds,
              imageOrder: referenceIds.filter((id) => {
                const sourceNode = nodesRef.current.find((node) => node.id === id);
                if (!sourceNode) return false;
                if (sourceNode.type === "prompt" || sourceNode.type === "process") return true;
                return (
                  sourceNode.type === localImageNodeType &&
                  !isLocalMaterialVideo(sourceNode as Node<AppNodeData>)
                );
              }),
              videoOrder: referenceIds.filter((id) => {
                const sourceNode = nodesRef.current.find((node) => node.id === id);
                return (
                  sourceNode?.type === localImageNodeType &&
                  isLocalMaterialVideo(sourceNode as Node<AppNodeData>)
                );
              }),
            } as PromptNodeData)
          : ({
              promptText: action.prompt,
              error: null,
              imageProvider: action.imageProvider ?? "aiwanwu",
              externalApiProviderId,
              imageQuality: "standard",
              modelVersion: action.modelVersion || "5.0",
              ratio: action.ratio || "16:9",
              resolutionType: action.resolutionType || "2k",
              count: action.count ?? 4,
              materialOrder: referenceIds,
              imageOrder: referenceIds.filter((id) => {
                const sourceNode = nodesRef.current.find((node) => node.id === id);
                if (!sourceNode) return false;
                if (sourceNode.type === "prompt" || sourceNode.type === "process") return true;
                return (
                  sourceNode.type === localImageNodeType &&
                  !isLocalMaterialVideo(sourceNode as Node<AppNodeData>)
                );
              }),
              videoOrder: referenceIds.filter((id) => {
                const sourceNode = nodesRef.current.find((node) => node.id === id);
                return (
                  sourceNode?.type === localImageNodeType &&
                  isLocalMaterialVideo(sourceNode as Node<AppNodeData>)
                );
              }),
            } as PromptNodeData),
      };

      const newEdges: Edge[] = referenceIds.map((sourceId, index) => ({
        id: `e-agent-${sourceId}-${promptId}-${Date.now()}-${index}`,
        source: sourceId,
        target: promptId,
        sourceHandle: "output",
        targetHandle: "image_input",
        type: CANVAS_EDGE_TYPE,
      }));

      setNodes((prev) => {
        const next = [
          ...prev.map((node) => ({ ...node, selected: false })),
          promptNode,
        ];
        nodesRef.current = next;
        return next;
      });
      setEdges((prev) => {
        const next = [...prev, ...newEdges];
        edgesRef.current = next;
        return next;
      });
      setActivePanelNodeId(promptId);
      setCanvasStackFrontId(promptId);

      return promptId;
    },
    [externalApiProviderId, getFlowPositionForNewNode, localImageNodeType, setEdges, setNodes]
  );

  const runAgentGenerateAction = useCallback(
    async (action: Extract<CanvasAgentAction, { type: "generate_image" | "generate_video" }>) => {
      setAgentStatusLabel("正在创建对应的画布节点...");
      const targetNodeId =
        action.targetNodeId &&
        nodesRef.current.some(
          (node) =>
            node.id === action.targetNodeId &&
            (action.type === "generate_video"
              ? node.type === "prompt2"
              : node.type === "prompt")
        )
          ? action.targetNodeId
          : createAgentPromptNode(action);

      setNodes((prev) => {
        const next = prev.map((node) => {
          if (node.id !== targetNodeId || !isPromptLikeType(node.type)) {
            return { ...node, selected: false };
          }
          const current = node.data as PromptNodeData;
          const nextData: PromptNodeData =
            action.type === "generate_video"
              ? {
                  ...current,
                  promptText: action.prompt,
                  generationMode: "video",
                  modelVersion: action.modelVersion || current.modelVersion || "seedance2.0fast",
                  ratio: action.ratio || current.ratio || "16:9",
                  resolutionType:
                    action.resolutionType || current.resolutionType || "720p",
                  count: action.count ?? current.count ?? 1,
                  durationSeconds:
                    action.durationSeconds ?? current.durationSeconds ?? 5,
                  withAudio: action.withAudio ?? current.withAudio ?? false,
                }
              : {
                  ...current,
                  promptText: action.prompt,
                  imageProvider: action.imageProvider ?? current.imageProvider ?? "aiwanwu",
                  externalApiProviderId:
                    isExternalImageApiProviderId(externalApiProviderId)
                      ? externalApiProviderId
                      : "default_gpt",
                  modelVersion: action.modelVersion || current.modelVersion || "5.0",
                  ratio: action.ratio || current.ratio || "16:9",
                  resolutionType:
                    action.resolutionType || current.resolutionType || "2k",
                  count: action.count ?? current.count ?? 4,
                };
          return {
            ...node,
            selected: true,
            data: nextData,
          };
        });
        nodesRef.current = next;
        return next;
      });

      setAgentStatusLabel("正在自动排布节点...");
      const nextPos = computeAutoLayoutPositions(nodesRef.current, edgesRef.current);
      setNodes((prev) => {
        const next = prev.map((node) => {
          const pos = nextPos.get(node.id);
          return pos ? { ...node, position: pos } : node;
        });
        nodesRef.current = next;
        return next;
      });

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          setAgentStatusLabel("正在把视角拉回渲染卡片...");
          focusNodesByIds([targetNodeId]);
          resolve();
        });
      });

      setAgentStatusLabel("节点已准备完成，正在启动渲染...");
      const nodeNow = nodesRef.current.find(
        (node) => node.id === targetNodeId && isPromptLikeType(node.type)
      ) as Node<PromptNodeData> | undefined;
      const data = nodeNow?.data;
      if (!nodeNow || !data) return;

      const triggerGenerate = handleGenerateRef.current;
      if (!triggerGenerate) return;

      await triggerGenerate({
        prompt: data.promptText?.trim() || action.prompt,
        nodeId: targetNodeId,
        imageProvider:
          action.type === "generate_image"
            ? action.imageProvider ?? data.imageProvider ?? "aiwanwu"
            : undefined,
        externalApiProviderId,
        imageQuality: action.type === "generate_image" ? data.imageQuality : undefined,
        modelVersion:
          action.modelVersion ||
          data.modelVersion ||
          (action.type === "generate_video" ? "seedance2.0fast" : "5.0"),
        ratio: data.ratio || (action.type === "generate_video" ? "16:9" : "16:9"),
        resolutionType:
          data.resolutionType ||
          (action.type === "generate_video" ? "720p" : "2k"),
        count:
          typeof data.count === "number"
            ? data.count
            : action.type === "generate_video"
              ? 1
              : 4,
        durationSeconds:
          action.type === "generate_video"
            ? data.durationSeconds ?? action.durationSeconds ?? 5
            : undefined,
        withAudio:
          action.type === "generate_video"
            ? data.withAudio ?? action.withAudio ?? false
            : undefined,
      });
    },
    [createAgentPromptNode, externalApiProviderId, focusNodesByIds, setNodes]
  );

  const onCanvasWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      lastCanvasPointerClientPosRef.current = { x: event.clientX, y: event.clientY };

      const inst = rf as
        | {
            getViewport?: () => { x: number; y: number; zoom: number };
            getZoom?: () => number;
            setViewport?: (
              viewport: { x: number; y: number; zoom: number },
              options?: { duration?: number }
            ) => void;
          }
        | null;

      if (!inst || typeof inst.setViewport !== "function") return;
      if (
        wheelShouldStayNative(
          event.target,
          flowHostRef.current,
          event.deltaX ?? 0,
          event.deltaY ?? 0
        )
      ) {
        return;
      }

      const rawDelta =
        Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (!Number.isFinite(rawDelta) || rawDelta === 0) return;

      const hostRect = flowHostRef.current?.getBoundingClientRect();
      if (!hostRect) return;

      event.preventDefault();
      event.stopPropagation();

      const viewport =
        typeof inst.getViewport === "function"
          ? inst.getViewport()
          : { x: 0, y: 0, zoom: typeof inst.getZoom === "function" ? inst.getZoom() : 1 };
      const nextZoom = clampCanvasZoom(viewport.zoom * Math.exp(-rawDelta * WHEEL_ZOOM_SENSITIVITY));
      if (Math.abs(nextZoom - viewport.zoom) < 0.0001) return;

      const pointerClient = { x: event.clientX, y: event.clientY };
      const anchorClient = getWheelZoomAnchorClientPosition(event.target, pointerClient);
      const anchorFlow = screenToFlow(anchorClient);
      const anchorWithinHost = {
        x: anchorClient.x - hostRect.left,
        y: anchorClient.y - hostRect.top,
      };

      inst.setViewport(
        {
          x: anchorWithinHost.x - anchorFlow.x * nextZoom,
          y: anchorWithinHost.y - anchorFlow.y * nextZoom,
          zoom: nextZoom,
        },
        { duration: 0 }
      );
      setViewportZoom(nextZoom);
      setViewportSeq((s) => s + 1);
      scheduleViewportNodeCheck();
    },
    [rf, scheduleViewportNodeCheck, screenToFlow]
  );

  const isGeneratedMediaUrl = useCallback((u: string) => {
    return (
      typeof u === "string" &&
      (
        u.startsWith("/outputs/generated/") ||
        u.startsWith("/api/generated/file?name=") ||
        /^https?:\/\//i.test(u) ||
        /^data:(image|video)\//i.test(u)
      )
    );
  }, []);

  const refreshCredit = useCallback(async () => {
    setCreditLoading(true);
    try {
      const [creditResult, metaResult, externalBalanceResult] = await Promise.allSettled([
        fetch("/api/credit"),
        fetch("/api/cli_meta"),
        fetch("/api/external-image-balance"),
      ]);

      if (metaResult.status === "fulfilled") {
        const meta = await metaResult.value.json().catch(() => ({}));
        if (typeof meta?.docsUrl === "string") setDocsUrl(meta.docsUrl);
        if (typeof meta?.version === "string") setCliVersion(meta.version);
        if (meta?.cliReady === false) {
          setLoginHint("CLI 未就绪。点击“登录”会自动检测并安装/修复 CLI。");
        }
      }

      if (creditResult.status === "fulfilled") {
        const res = creditResult.value;
        const json = await res.json().catch(() => ({}));
        if (res.ok && typeof json?.totalCredit === "number") {
          setTotalCredit(json.totalCredit);
          setLoginState("logged_in");
        } else if (res.ok && json?.credentialFound) {
          // Local credential exists; keep syncing instead of falling back to "logged_out" immediately.
          setTotalCredit(null);
          setLoginState("checking");
        } else {
          setTotalCredit(null);
          setLoginState("logged_out");
        }
      } else {
        setTotalCredit(null);
        setLoginState("logged_out");
      }

      if (externalBalanceResult.status === "fulfilled") {
        const res = externalBalanceResult.value;
        const json = await res.json().catch(() => ({}));
        if (res.ok && json?.ok && typeof json?.balance === "number") {
          setExternalApiBalance(json.balance);
          setExternalApiBalanceText(
            typeof json?.balanceText === "string" && json.balanceText.trim()
              ? json.balanceText
              : formatBalanceNumber(json.balance)
          );
          setExternalApiBalanceCurrency(
            typeof json?.currency === "string" && json.currency.trim() ? json.currency.trim() : null
          );
          setExternalApiBalanceError(null);
        } else {
          setExternalApiBalance(null);
          setExternalApiBalanceText(null);
          setExternalApiBalanceCurrency(null);
          setExternalApiBalanceError(
            typeof json?.error === "string" && json.error.trim() ? json.error : "读取 GPT 余额失败"
          );
        }
      } else {
        setExternalApiBalance(null);
        setExternalApiBalanceText(null);
        setExternalApiBalanceCurrency(null);
        setExternalApiBalanceError("读取 GPT 余额失败");
      }
    } catch {
      setTotalCredit(null);
      setLoginState("logged_out");
      setExternalApiBalance(null);
      setExternalApiBalanceText(null);
      setExternalApiBalanceCurrency(null);
      setExternalApiBalanceError("读取 GPT 余额失败");
    } finally {
      setCreditLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!creditMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && creditMenuRef.current && !creditMenuRef.current.contains(target)) {
        setCreditMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCreditMenuOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [creditMenuOpen]);

  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch {
      // ignore
    } finally {
      setTotalCredit(null);
      setLoginState("logged_out");
      setLoginAuthUrl(null);
      setLoginAuthHasCallback(null);
      setLoginDebugPreview("");
    }
  }, []);

  const openCacheSettings = useCallback(async () => {
    setCacheDirErr(null);
    setExternalApiErr(null);
    setExternalVideoApiErr(null);
    setExternalApiDebugNote(null);
    setExternalVideoApiDebugNote(null);
    setCacheDirBusy(true);
    setExternalApiBusy(true);
    setExternalVideoApiBusy(true);
    setExternalApiConfigReady(false);
    try {
      const [cacheRes, apiRes, videoApiRes] = await Promise.all([
        fetch("/api/cache_dir"),
        fetch("/api/external-image-config", { cache: "no-store" }),
        fetch("/api/external-video-config", { cache: "no-store" }),
      ]);
      const j = await cacheRes.json().catch(() => ({}));
      if (!cacheRes.ok || !j?.ok) {
        setCacheDirErr(typeof j?.error === "string" ? j.error : "读取缓存目录失败");
      } else {
        const cur = typeof j?.current === "string" ? j.current : "";
        const def = typeof j?.defaultDir === "string" ? j.defaultDir : "";
        setCacheDirCurrent(cur);
        setCacheDirDefault(def);
        setCacheDirInput(cur || def);
      }

      const apiJson = (await apiRes.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        config?: {
          activeProviderId?: string;
          baseUrl?: string;
          apiKey?: string;
          imageModel?: string;
          textModel?: string;
          imageCostPerGeneration?: number | null;
          imageCostCurrency?: string;
          providers?: Partial<
            Record<ExternalImageApiProviderId, ExternalApiProviderUiConfig>
          >;
        };
        providers?: Array<{
          id: ExternalImageApiProviderId;
          label: string;
          description: string;
        }>;
      };
      if (!apiRes.ok || !apiJson?.ok) {
        setExternalApiErr(typeof apiJson?.error === "string" ? apiJson.error : "读取外部图片 API 配置失败");
      } else {
        const cfg = apiJson.config ?? {};
        const providerId = normalizeExternalImageApiProviderId(
          cfg.activeProviderId
        );
        const providerConfigs: Partial<Record<ExternalImageApiProviderId, ExternalApiProviderUiConfig>> =
          cfg.providers && typeof cfg.providers === "object" ? cfg.providers : {};
        setExternalApiProviderId(providerId);
        setExternalApiProviders(
          Array.isArray(apiJson.providers)
            ? apiJson.providers.filter(
                (item): item is {
                  id: ExternalImageApiProviderId;
                  label: string;
                  description: string;
                } =>
                  !!item &&
                  typeof item === "object" &&
                  isExternalImageApiProviderId((item as { id?: unknown }).id) &&
                  typeof item.label === "string" &&
                  typeof item.description === "string"
              )
            : []
        );
        setExternalApiProviderConfigs(providerConfigs);
        const activeCfg = providerConfigs[providerId] ?? cfg;
        setExternalApiDisplayName(
          typeof providerConfigs[providerId]?.displayName === "string"
            ? providerConfigs[providerId]!.displayName!
            : Array.isArray(apiJson.providers)
              ? apiJson.providers.find((item) => item.id === providerId)?.label ?? ""
              : ""
        );
        setExternalApiBaseUrl(typeof activeCfg.baseUrl === "string" ? activeCfg.baseUrl : "");
        setExternalApiKey(typeof activeCfg.apiKey === "string" ? activeCfg.apiKey : "");
        setExternalApiImageModel(typeof activeCfg.imageModel === "string" ? activeCfg.imageModel : "");
        setExternalApiTextModel(typeof activeCfg.textModel === "string" ? activeCfg.textModel : "");
        setExternalApiImageCost(formatOptionalCostInput(activeCfg.imageCostPerGeneration));
        setExternalApiImageCostCurrency(
          typeof activeCfg.imageCostCurrency === "string" && activeCfg.imageCostCurrency.trim()
            ? activeCfg.imageCostCurrency.trim()
            : "$"
        );
        await loadExternalApiModelsForProvider(providerId);
        setExternalApiConfigReady(true);
      }

      const videoApiJson = (await videoApiRes.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        config?: {
          displayName?: string;
          baseUrl?: string;
          apiKey?: string;
          model?: string;
        };
      };
      if (!videoApiRes.ok || !videoApiJson?.ok) {
        setExternalVideoApiErr(
          typeof videoApiJson?.error === "string" ? videoApiJson.error : "读取外部生视频 API 配置失败"
        );
      } else {
        const videoCfg = videoApiJson.config ?? {};
        setExternalVideoApiDisplayName(
          typeof videoCfg.displayName === "string" ? videoCfg.displayName : "视频API"
        );
        setExternalVideoApiBaseUrl(typeof videoCfg.baseUrl === "string" ? videoCfg.baseUrl : "");
        setExternalVideoApiKey(typeof videoCfg.apiKey === "string" ? videoCfg.apiKey : "");
        setExternalVideoApiModel(typeof videoCfg.model === "string" ? videoCfg.model : "");
        await loadExternalVideoApiModels();
      }

      try {
        const raw = localStorage.getItem("jimengpro-external-image-api-last-usage-v1");
        if (raw) setExternalApiLastUsage(JSON.parse(raw));
        else setExternalApiLastUsage(null);
      } catch {
        setExternalApiLastUsage(null);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCacheDirErr(msg);
      setExternalApiErr(msg);
      setExternalVideoApiErr(msg);
      setExternalApiConfigReady(false);
    } finally {
      setCacheDirBusy(false);
      setExternalApiBusy(false);
      setExternalVideoApiBusy(false);
    }
  }, [loadExternalApiModelsForProvider]);

  const syncNodesToExternalApiConfig = useCallback(
    (
      providerId: ExternalImageApiProviderId,
      config: {
        imageModel?: string;
        textModel?: string;
      }
    ) => {
      const nextImageModel =
        typeof config.imageModel === "string" && config.imageModel.trim()
          ? config.imageModel.trim()
          : "";
      const nextTextModel =
        typeof config.textModel === "string" && config.textModel.trim()
          ? config.textModel.trim()
          : "";
      setNodes((prev) =>
        prev.map((node) => {
          if (node.type === "prompt") {
            const d = node.data as PromptNodeData;
            const promptProviderId = normalizeExternalImageApiProviderId(
              d.externalApiProviderId
            );
            if (d.imageProvider === "aiwanwu" && promptProviderId !== providerId) {
              return node;
            }
            const candidateModels = Array.from(
              new Set(
                [...externalImageModelFallbacksForProvider(providerId), nextImageModel]
                  .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
                  .map((value) => value.trim())
              )
            );
            const currentModelVersion =
              typeof d.modelVersion === "string" && d.modelVersion.trim() ? d.modelVersion.trim() : "";
            const currentModelSupported =
              currentModelVersion.length > 0 && candidateModels.includes(currentModelVersion);
            const defaultProviderModel =
              nextImageModel || candidateModels[0] || currentModelVersion;
            const nextModelVersion =
              d.imageProvider === "aiwanwu"
                ? currentModelSupported
                  ? currentModelVersion
                  : defaultProviderModel
                : currentModelVersion;
            if (
              promptProviderId === providerId &&
              nextModelVersion === d.modelVersion
            ) {
              return node;
            }
            return {
              ...node,
              data: {
                ...d,
                externalApiProviderId: promptProviderId,
                ...(nextModelVersion ? { modelVersion: nextModelVersion } : {}),
              },
            };
          }
          if (node.type === "text") {
            const d = node.data as TextBoxNodeData;
            const textProviderId = normalizeExternalImageApiProviderId(d.providerId);
            if (textProviderId !== providerId) {
              return node;
            }
            const nextModel = nextTextModel || d.model;
            if (d.providerId === providerId && nextModel === d.model) {
              return node;
            }
            return {
              ...node,
              data: {
                ...d,
                providerId,
                ...(nextModel ? { model: nextModel } : {}),
              },
            };
          }
          if (node.type === "process") {
            const d = node.data as ImageProcessNodeData;
            const processProviderId = normalizeExternalImageApiProviderId(d.providerId);
            if (processProviderId !== providerId) {
              return node;
            }
            const nextAvailableModels = Array.from(
              new Set([
                ...(Array.isArray(d.availableModels) ? d.availableModels : []),
                ...externalImageModelFallbacksForProvider(providerId),
                ...(nextImageModel ? [nextImageModel] : []),
              ].filter((value): value is string => typeof value === "string" && value.trim().length > 0))
            );
            const nextModelVersion =
              typeof nextImageModel === "string" && nextImageModel.trim()
                ? nextImageModel
                : d.modelVersion;
            if (
              d.providerId === providerId &&
              nextModelVersion === d.modelVersion &&
              sameStringArray(d.availableModels, nextAvailableModels)
            ) {
              return node;
            }
            return {
              ...node,
              data: {
                ...d,
                providerId,
                availableModels: nextAvailableModels,
                ...(nextModelVersion ? { modelVersion: nextModelVersion } : {}),
              },
            };
          }
          return node;
        })
      );
    },
    [setNodes]
  );

  const saveExternalApiConfig = useCallback(async () => {
    setExternalApiBusy(true);
    setExternalApiErr(null);
    setExternalApiDebugNote(null);
    try {
      const imageCostPerGeneration = parseOptionalCostInput(externalApiImageCost);
      if (Number.isNaN(imageCostPerGeneration)) {
        setExternalApiErr("生图单次花费必须是大于等于 0 的数字，留空则不显示花费");
        return;
      }
      const r = await fetch("/api/external-image-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activeProviderId: externalApiProviderId,
          displayName: externalApiDisplayName,
          baseUrl: externalApiBaseUrl,
          apiKey: externalApiKey,
          imageModel: externalApiImageModel,
          textModel: externalApiTextModel,
          imageCostPerGeneration,
          imageCostCurrency: externalApiImageCostCurrency.trim() || "$",
        }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        config?: {
          activeProviderId?: string;
          baseUrl?: string;
          apiKey?: string;
          imageModel?: string;
          textModel?: string;
          imageCostPerGeneration?: number | null;
          imageCostCurrency?: string;
          providers?: Partial<
            Record<ExternalImageApiProviderId, ExternalApiProviderUiConfig>
          >;
        };
      };
      if (!r.ok || !j?.ok) {
        setExternalApiErr(typeof j?.error === "string" ? j.error : "保存外部图片 API 配置失败");
        return;
      }
      const cfg = j.config ?? {};
      const nextProviderId = normalizeExternalImageApiProviderId(
        cfg.activeProviderId
      );
      const providerConfigs: Partial<Record<ExternalImageApiProviderId, ExternalApiProviderUiConfig>> =
        cfg.providers && typeof cfg.providers === "object" ? cfg.providers : {};
      setExternalApiProviderId(nextProviderId);
      setExternalApiProviderConfigs(providerConfigs);
      const activeCfg = providerConfigs[nextProviderId] ?? cfg;
      setExternalApiDisplayName(
        typeof providerConfigs[nextProviderId]?.displayName === "string"
          ? providerConfigs[nextProviderId]!.displayName!
          : externalApiDisplayName
      );
      setExternalApiBaseUrl(typeof activeCfg.baseUrl === "string" ? activeCfg.baseUrl : externalApiBaseUrl);
      setExternalApiKey(typeof activeCfg.apiKey === "string" ? activeCfg.apiKey : externalApiKey);
      setExternalApiImageModel(typeof activeCfg.imageModel === "string" ? activeCfg.imageModel : externalApiImageModel);
      setExternalApiTextModel(typeof activeCfg.textModel === "string" ? activeCfg.textModel : externalApiTextModel);
      setExternalApiImageCost(formatOptionalCostInput(activeCfg.imageCostPerGeneration));
      setExternalApiImageCostCurrency(
        typeof activeCfg.imageCostCurrency === "string" && activeCfg.imageCostCurrency.trim()
          ? activeCfg.imageCostCurrency.trim()
          : "$"
      );
      setExternalApiConfigReady(true);
      syncNodesToExternalApiConfig(nextProviderId, activeCfg);
      await loadExternalApiModelsForProvider(nextProviderId);
      window.dispatchEvent(new Event("jimengpro:external-api-config-changed"));
      void refreshCredit();
    } catch (e) {
      setExternalApiErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExternalApiBusy(false);
    }
  }, [externalApiBaseUrl, externalApiDisplayName, externalApiImageCost, externalApiImageCostCurrency, externalApiImageModel, externalApiKey, externalApiProviderId, externalApiTextModel, loadExternalApiModelsForProvider, refreshCredit, syncNodesToExternalApiConfig]);

  const saveExternalVideoApiConfig = useCallback(async () => {
    setExternalVideoApiBusy(true);
    setExternalVideoApiErr(null);
    setExternalVideoApiDebugNote(null);
    try {
      const r = await fetch("/api/external-video-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: externalVideoApiDisplayName,
          baseUrl: externalVideoApiBaseUrl,
          apiKey: externalVideoApiKey,
          model: externalVideoApiModel,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        config?: {
          displayName?: string;
          baseUrl?: string;
          apiKey?: string;
          model?: string;
        };
      };
      if (!r.ok || !j?.ok) {
        setExternalVideoApiErr(
          typeof j?.error === "string" ? j.error : "保存外部生视频 API 配置失败"
        );
        return;
      }
      const cfg = j.config ?? {};
      setExternalVideoApiDisplayName(
        typeof cfg.displayName === "string" ? cfg.displayName : externalVideoApiDisplayName
      );
      setExternalVideoApiBaseUrl(
        typeof cfg.baseUrl === "string" ? cfg.baseUrl : externalVideoApiBaseUrl
      );
      setExternalVideoApiKey(typeof cfg.apiKey === "string" ? cfg.apiKey : externalVideoApiKey);
      setExternalVideoApiModel(typeof cfg.model === "string" ? cfg.model : externalVideoApiModel);
      await loadExternalVideoApiModels();
      window.dispatchEvent(new Event("jimengpro:external-video-api-config-changed"));
    } catch (e) {
      setExternalVideoApiErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExternalVideoApiBusy(false);
    }
  }, [externalVideoApiBaseUrl, externalVideoApiDisplayName, externalVideoApiKey, externalVideoApiModel]);

  const saveCacheDir = useCallback(async () => {
    const next = cacheDirInput.trim();
    if (!next) {
      setCacheDirErr("缂傛挸鐡ㄩ惄顔肩秿娑撳秷鍏樻稉铏光敄");
      return;
    }
    setCacheDirBusy(true);
    setCacheDirErr(null);
    try {
      const r = await fetch("/api/cache_dir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set", dir: next }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        setCacheDirErr(typeof j?.error === "string" ? j.error : "娣囨繂鐡ㄦ径杈Е");
        return;
      }
      setCacheDirCurrent(typeof j?.dir === "string" ? j.dir : next);
      setCacheSettingsOpen(false);
      setLoginHint("Cache directory updated. Future read/write will use this path.");
    } catch (e) {
      setCacheDirErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCacheDirBusy(false);
    }
  }, [cacheDirInput]);

  const openCacheDirInExplorer = useCallback(async () => {
    setCacheDirBusy(true);
    try {
      await fetch("/api/cache_dir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "open" }),
      });
    } finally {
      setCacheDirBusy(false);
    }
  }, []);

  async function loadExternalApiModelsForProvider(
    providerId: ExternalImageApiProviderId
  ) {
    setExternalApiModelOptions(externalImageModelFallbacksForProvider(providerId));
    const modelRes = await fetch(
      `/api/aiwanwu/models?kind=image&providerId=${encodeURIComponent(providerId)}`,
      { cache: "no-store" }
    );
    const modelJson = await modelRes.json().catch(() => ({}));
    if (modelRes.ok && Array.isArray(modelJson?.models)) {
      setExternalApiModelOptions(modelJson.models);
    } else {
      setExternalApiModelOptions(externalImageModelFallbacksForProvider(providerId));
    }
  }

  async function loadExternalVideoApiModels() {
    setExternalVideoApiModelOptions(["grok-imagine-video", "grok-imagine-1.0-video"]);
    const modelRes = await fetch("/api/external-video-models", { cache: "no-store" });
    const modelJson = await modelRes.json().catch(() => ({}));
    if (modelRes.ok && Array.isArray(modelJson?.models)) {
      setExternalVideoApiModelOptions(
        modelJson.models.filter(
          (value: unknown): value is string => typeof value === "string" && value.trim().length > 0
        )
      );
    } else {
      setExternalVideoApiModelOptions(["grok-imagine-video", "grok-imagine-1.0-video"]);
    }
  }

  const switchExternalApiProvider = useCallback(
    async (providerId: ExternalImageApiProviderId) => {
      const nextCfg = externalApiProviderConfigs[providerId];
      setExternalApiProviderId(providerId);
      setExternalApiDisplayName(
        nextCfg?.displayName ??
          externalApiProviders.find((provider) => provider.id === providerId)?.label ??
          ""
      );
      setExternalApiBaseUrl(nextCfg?.baseUrl ?? "");
      setExternalApiKey(nextCfg?.apiKey ?? "");
      setExternalApiImageModel(nextCfg?.imageModel ?? "");
      setExternalApiTextModel(nextCfg?.textModel ?? "");
      setExternalApiImageCost(formatOptionalCostInput(nextCfg?.imageCostPerGeneration));
      setExternalApiImageCostCurrency(nextCfg?.imageCostCurrency?.trim() || "$");
      setExternalApiBusy(true);
      setExternalApiErr(null);
      setExternalApiDebugNote(null);
      try {
        const r = await fetch("/api/external-image-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            activeProviderId: providerId,
          }),
        });
        const j = (await r.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          config?: {
            activeProviderId?: string;
            providers?: Partial<Record<ExternalImageApiProviderId, ExternalApiProviderUiConfig>>;
          };
        };
        if (!r.ok || !j?.ok) {
          setExternalApiErr(typeof j?.error === "string" ? j.error : "切换 API 失败");
          return;
        }
        const cfg = j.config ?? {};
        const nextProviderId = normalizeExternalImageApiProviderId(
          cfg.activeProviderId
        );
        const providerConfigs =
          cfg.providers && typeof cfg.providers === "object" ? cfg.providers : {};
        setExternalApiProviderId(nextProviderId);
        setExternalApiProviderConfigs(providerConfigs);
        const activeCfg = providerConfigs[nextProviderId] ?? {};
        setExternalApiDisplayName(
          typeof providerConfigs[nextProviderId]?.displayName === "string"
            ? providerConfigs[nextProviderId]!.displayName!
            : ""
        );
        setExternalApiBaseUrl(typeof activeCfg.baseUrl === "string" ? activeCfg.baseUrl : "");
        setExternalApiKey(typeof activeCfg.apiKey === "string" ? activeCfg.apiKey : "");
        setExternalApiImageModel(
          typeof activeCfg.imageModel === "string" ? activeCfg.imageModel : ""
        );
        setExternalApiTextModel(
          typeof activeCfg.textModel === "string" ? activeCfg.textModel : ""
        );
        setExternalApiImageCost(formatOptionalCostInput(activeCfg.imageCostPerGeneration));
        setExternalApiImageCostCurrency(
          typeof activeCfg.imageCostCurrency === "string" && activeCfg.imageCostCurrency.trim()
            ? activeCfg.imageCostCurrency.trim()
            : "$"
        );
        setExternalApiConfigReady(true);
        syncNodesToExternalApiConfig(nextProviderId, activeCfg);
        await loadExternalApiModelsForProvider(nextProviderId);
        window.dispatchEvent(new Event("jimengpro:external-api-config-changed"));
      } catch (e) {
        setExternalApiErr(e instanceof Error ? e.message : String(e));
      } finally {
        setExternalApiBusy(false);
      }
    },
    [externalApiProviderConfigs, externalApiProviders, loadExternalApiModelsForProvider, syncNodesToExternalApiConfig]
  );

  const debugExternalApiConfig = useCallback(async () => {
    setExternalApiBusy(true);
    setExternalApiErr(null);
    setExternalApiDebugNote(null);
    try {
      const r = await fetch("/api/external-image-debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: externalApiProviderId,
          baseUrl: externalApiBaseUrl,
          apiKey: externalApiKey,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        models?: string[];
        imageModels?: string[];
        textModels?: string[];
        imageCapable?: boolean;
      };
      if (!r.ok || !j?.ok) {
        setExternalApiErr(typeof j?.error === "string" ? j.error : "检测图片 API 失败");
        return;
      }
      const allModels = Array.isArray(j.models)
        ? j.models.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [];
      const imageModels = Array.isArray(j.imageModels)
        ? j.imageModels.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [];
      const textModels = Array.isArray(j.textModels)
        ? j.textModels.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [];
      const nextImageOptions =
        imageModels.length > 0 ? imageModels : allModels.length > 0 ? allModels : externalImageModelFallbacksForProvider(externalApiProviderId);
      const nextImageModel = nextImageOptions.includes(externalApiImageModel)
        ? externalApiImageModel
        : (nextImageOptions[0] ?? "");
      const nextTextModel = textModels.includes(externalApiTextModel)
        ? externalApiTextModel
        : (textModels[0] ?? externalApiTextModel);
      setExternalApiModelOptions(nextImageOptions);
      if (nextImageModel) setExternalApiImageModel(nextImageModel);
      if (nextTextModel) setExternalApiTextModel(nextTextModel);
      setExternalApiProviderConfigs((prev) => ({
        ...prev,
        [externalApiProviderId]: {
          displayName: externalApiDisplayName,
          baseUrl: externalApiBaseUrl,
          apiKey: externalApiKey,
          imageModel: nextImageModel || prev[externalApiProviderId]?.imageModel || "",
          textModel: nextTextModel || prev[externalApiProviderId]?.textModel || "",
          imageCostPerGeneration: optionalCostInputForConfig(externalApiImageCost),
          imageCostCurrency: externalApiImageCostCurrency.trim() || "$",
        },
      }));
      if (nextImageModel || nextTextModel) {
        syncNodesToExternalApiConfig(externalApiProviderId, {
          imageModel: nextImageModel,
          textModel: nextTextModel,
        });
      }
      setExternalApiDebugNote(
        `检测到 ${allModels.length} 个模型，生图模型 ${imageModels.length} 个${
          j.imageCapable ? "，支持生图" : ""
        }`
      );
    } catch (e) {
      setExternalApiErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExternalApiBusy(false);
    }
  }, [
    externalApiBaseUrl,
    externalApiDisplayName,
    externalApiImageCost,
    externalApiImageCostCurrency,
    externalApiImageModel,
    externalApiKey,
    externalApiProviderId,
    externalApiTextModel,
    syncNodesToExternalApiConfig,
  ]);

  const debugExternalVideoApiConfig = useCallback(async () => {
    setExternalVideoApiBusy(true);
    setExternalVideoApiErr(null);
    setExternalVideoApiDebugNote(null);
    try {
      const r = await fetch("/api/external-video-debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: externalVideoApiBaseUrl,
          apiKey: externalVideoApiKey,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        models?: string[];
        videoModels?: string[];
        videoCapable?: boolean;
      };
      if (!r.ok || !j?.ok) {
        setExternalVideoApiErr(typeof j?.error === "string" ? j.error : "检测生视频 API 失败");
        return;
      }
      const allModels = Array.isArray(j.models)
        ? j.models.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [];
      const videoModels = Array.isArray(j.videoModels)
        ? j.videoModels.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [];
      const nextOptions =
        videoModels.length > 0
          ? videoModels
          : allModels.length > 0
            ? allModels
            : ["grok-imagine-video", "grok-imagine-1.0-video"];
      const nextModel = nextOptions.includes(externalVideoApiModel)
        ? externalVideoApiModel
        : (nextOptions[0] ?? "");
      setExternalVideoApiModelOptions(nextOptions);
      if (nextModel) setExternalVideoApiModel(nextModel);
      setExternalVideoApiDebugNote(
        `检测到 ${allModels.length} 个模型，生视频模型 ${videoModels.length} 个${
          j.videoCapable ? "，支持生视频" : ""
        }`
      );
    } catch (e) {
      setExternalVideoApiErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExternalVideoApiBusy(false);
    }
  }, [externalVideoApiBaseUrl, externalVideoApiKey, externalVideoApiModel]);

  const pickCacheDirBySystemDialog = useCallback(async () => {
    setCacheDirBusy(true);
    setCacheDirErr(null);
    try {
      const r = await fetch("/api/cache_dir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pick" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        if (j?.cancelled) return;
        setCacheDirErr(typeof j?.error === "string" ? j.error : "选择目录失败");
        return;
      }
      if (typeof j?.dir === "string" && j.dir.trim()) {
        setCacheDirInput(j.dir.trim());
      }
    } catch (e) {
      setCacheDirErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCacheDirBusy(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/cache_dir");
        const j = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok || !j?.ok) {
          setPackagedCacheOnboarding(false);
          return;
        }
        if (j.needsPackagedCacheOnboarding === true) {
          setPackagedCacheOnboarding(true);
          const ed = typeof j.effectiveDir === "string" ? j.effectiveDir : "";
          setCacheOnboardingInput(ed);
        } else {
          setPackagedCacheOnboarding(false);
        }
      } catch {
        if (!cancelled) setPackagedCacheOnboarding(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pickOnboardingCacheDir = useCallback(async () => {
    setCacheOnboardingBusy(true);
    setCacheOnboardingErr(null);
    try {
      const r = await fetch("/api/cache_dir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pick" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        if (j?.cancelled) return;
        setCacheOnboardingErr(typeof j?.error === "string" ? j.error : "选择目录失败");
        return;
      }
      if (typeof j?.dir === "string" && j.dir.trim()) {
        setCacheOnboardingInput(j.dir.trim());
      }
    } catch (e) {
      setCacheOnboardingErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCacheOnboardingBusy(false);
    }
  }, []);

  const completePackagedCacheOnboarding = useCallback(async () => {
    const next = cacheOnboardingInput.trim();
    if (!next) {
      setCacheOnboardingErr("鐠囩兘鈧瀚ㄩ幋鏍翻閸忋儳鏁ゆ禍搴濈箽鐎涙ɑ鍨氶悧鍥︾瑢閸樺棗褰剁槐銏犵穿閻ㄥ嫭鏋冩禒璺恒仚");
      return;
    }
    setCacheOnboardingBusy(true);
    setCacheOnboardingErr(null);
    try {
      const r = await fetch("/api/cache_dir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "complete_packaged_setup",
          dir: next,
          clearStaging: cacheOnboardingClean,
          clearDebugLogs: cacheOnboardingClean,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        setCacheOnboardingErr(typeof j?.error === "string" ? j.error : "娣囨繂鐡ㄦ径杈Е");
        return;
      }
      setPackagedCacheOnboarding(false);
      setLoginHint(
        "Cache directory configured. Preview and history will load from this path. You can change it later in settings."
      );
    } catch (e) {
      setCacheOnboardingErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCacheOnboardingBusy(false);
    }
  }, [cacheOnboardingInput, cacheOnboardingClean]);

  const loadLoginDiagnostics = useCallback(async () => {
    setLoginDiagLoading(true);
    setLoginDiagErr(null);
    try {
      const r = await fetch("/api/login_diagnostics");
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(typeof j?.error === "string" ? j.error : "设置缓存目录失败");
      }
      setLoginDiagData(j);
    } catch (e) {
      setLoginDiagErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoginDiagLoading(false);
    }
  }, []);

  const openLoginDiagFolder = useCallback(async (p: string) => {
    setLoginDiagBusy(`open:${p}`);
    try {
      const r = await fetch("/api/login_diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "open_folder", path: p }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setLoginDiagErr(typeof j?.error === "string" ? j.error : "读取诊断信息失败");
      }
    } catch (e) {
      setLoginDiagErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoginDiagBusy(null);
    }
  }, []);

  const captureLoginDebugToFile = useCallback(async () => {
    setLoginDiagBusy("capture");
    setLoginDiagErr(null);
    try {
      const r = await fetch("/api/login_diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "capture_debug" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setLoginDiagErr(typeof j?.error === "string" ? j.error : "执行诊断操作失败");
        return;
      }
      if (typeof j?.message === "string") {
        setLoginHint(j.message);
      }
      await loadLoginDiagnostics();
    } catch (e) {
      setLoginDiagErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoginDiagBusy(null);
    }
  }, [loadLoginDiagnostics]);

  useEffect(() => {
    if (loginDiagOpen) {
      void loadLoginDiagnostics();
    }
  }, [loginDiagOpen, loadLoginDiagnostics]);

  const triggerLoginFlow = useCallback(async (browserId?: string) => {
    try {
      setLoginAuthUrl(null);
      setLoginAuthHasCallback(null);
      setLoginDebugPreview("");
      const reqInit: RequestInit = { method: "POST" };
      if (browserId) {
        reqInit.headers = { "Content-Type": "application/json" };
        reqInit.body = JSON.stringify({ browserId });
      }
      const res = await fetch("/api/login", reqInit);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoginHint(json?.error || "读取登录状态失败");
        setLoginAuthUrl(null);
        setLoginAuthHasCallback(null);
        setLoginDebugPreview("");
        return;
      }
      if (json?.ok === false) {
        const extra = json?.autoInstallMessage ? `（${json.autoInstallMessage}）` : "";
        setLoginHint(json?.error ? `${json.error}${extra}` : `查询失败${extra}`);
        setLoginAuthUrl(null);
        setLoginAuthHasCallback(null);
        setLoginDebugPreview("");
        return;
      }
      if (json?.alreadyLoggedIn) {
        setLoginHint(json?.message || "请先安装并准备好 CLI");
        setLoginAuthUrl(null);
        setLoginAuthHasCallback(null);
        setLoginDebugPreview("");
        if (typeof json?.totalCredit === "number") {
          setTotalCredit(json.totalCredit);
          setLoginState("logged_in");
        } else {
          refreshCredit();
        }
        return;
      }
      if (typeof json?.authUrl === "string" && json.authUrl) {
        setLoginAuthUrl(json.authUrl);
      } else {
        setLoginAuthUrl(null);
      }
      if (typeof json?.authHasLocalCallback === "boolean") {
        setLoginAuthHasCallback(json.authHasLocalCallback);
      } else {
        setLoginAuthHasCallback(null);
      }
      if (typeof json?.debugPreview === "string") {
        setLoginDebugPreview(json.debugPreview);
      } else {
        setLoginDebugPreview("");
      }
      setLoginHint(json?.message || "登录流程已启动，网页完成登录后客户端会自动同步状态。");
      // Auto-refresh status for up to 10 minutes.
      if (loginRefreshTimerRef.current !== null) {
        clearInterval(loginRefreshTimerRef.current);
        loginRefreshTimerRef.current = null;
      }
      refreshCredit();
      let n = 0;
      const maxAttempts = 200;
      loginRefreshTimerRef.current = window.setInterval(() => {
        n += 1;
        refreshCredit();
        if (n >= maxAttempts && loginRefreshTimerRef.current !== null) {
          clearInterval(loginRefreshTimerRef.current);
          loginRefreshTimerRef.current = null;
        }
      }, 3000);
    } catch (e) {
      setLoginHint("登录流程启动失败");
      setLoginAuthUrl(null);
      setLoginAuthHasCallback(null);
      setLoginDebugPreview("");
    }
  }, [refreshCredit]);

  const loadBrowserOptions = useCallback(async () => {
    setBrowserPickerLoading(true);
    setBrowserPickerErr(null);
    try {
      const res = await fetch("/api/browsers", { method: "GET" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        const msg = json?.error || "无法读取本机浏览器列表";
        setBrowserPickerErr(msg);
        setLoginHint(`${msg}，将改用系统默认浏览器。`);
        await triggerLoginFlow("system");
        return;
      }
      const opts = Array.isArray(json?.options) ? (json.options as BrowserOption[]) : [];
      if (opts.length === 0) {
        setBrowserPickerErr("鏈娴嬪埌鍙敤娴忚鍣紝灏嗘敼鐢ㄧ郴缁熼粯璁ゆ祻瑙堝櫒");
        await triggerLoginFlow("system");
        return;
      }
      setBrowserOptions(opts);
      setBrowserPickerOpen(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setBrowserPickerErr(msg);
      setLoginHint(`${msg}，将改用系统默认浏览器。`);
      await triggerLoginFlow("system");
    } finally {
      setBrowserPickerLoading(false);
    }
  }, [triggerLoginFlow]);

  const checkVipCredentialGate = useCallback(async () => {
    try {
      const res = await fetch("/api/credential_health", { method: "GET" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) return false;
      const tooSmall = Boolean(json?.tooSmall);
      if (!tooSmall) return false;
      const size =
        typeof json?.sizeBytes === "number" && Number.isFinite(json.sizeBytes)
          ? json.sizeBytes
          : null;
      setVipCredentialSizeBytes(size);
      setVipCredentialDialogOpen(true);
      return true;
    } catch {
      return false;
    }
  }, []);

  const selectBrowserAndLogin = useCallback(
    async (browserId: string) => {
      setBrowserPickerOpen(false);
      await triggerLoginFlow(browserId);
    },
    [triggerLoginFlow]
  );

  useEffect(() => {
    return () => {
      if (loginRefreshTimerRef.current !== null) {
        clearInterval(loginRefreshTimerRef.current);
        loginRefreshTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const onFocusSync = () => {
      if (loginState !== "logged_in") {
        void refreshCredit();
      }
    };
    const onVisibilityChange = () => {
      if (!document.hidden) onFocusSync();
    };
    window.addEventListener("focus", onFocusSync);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", onFocusSync);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loginState, refreshCredit]);

  const handleLogin = useCallback(async () => {
    // Requirement: when not logged in, every click should trigger official login flow.
    if (loginState !== "logged_in") {
      const gated = await checkVipCredentialGate();
      if (gated) return;
      await loadBrowserOptions();
      return;
    }
    await refreshCredit();
    setLoginHint("当前已登录。");
  }, [checkVipCredentialGate, loadBrowserOptions, loginState, refreshCredit]);

  const continueLoginAfterVipGate = useCallback(async () => {
    setVipCredentialDialogOpen(false);
    await loadBrowserOptions();
  }, [loadBrowserOptions]);

  useEffect(() => {
    let cancelled = false;
    const bootstrapCli = async () => {
      try {
        const res = await fetch("/api/cli_bootstrap", { method: "POST" });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (json?.ok && json?.installed) {
          setLoginHint(json?.message || "CLI installed. Please click Login.");
          setLoginAuthUrl(null);
          setLoginAuthHasCallback(null);
          setLoginDebugPreview("");
        } else if (!json?.ok && typeof json?.message === "string") {
          // Show guidance only when auto-install failed.
          setLoginHint(`CLI auto install failed: ${json.message}`);
          setLoginAuthUrl(null);
          setLoginAuthHasCallback(null);
          setLoginDebugPreview("");
        }
      } catch {
        // ignore bootstrap network/runtime failure
      }
    };
    bootstrapCli();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    refreshCredit();
  }, [refreshCredit]);

  useEffect(() => {
    if (loginState === "logged_in" && loginHint) {
      setLoginHint("");
    }
  }, [loginState, loginHint]);

  const loadTaskHistory = useCallback(async () => {
    setTasksLoading(true);
    setTasksError(null);
    try {
      const res = await fetch("/api/tasks?limit=50");
      const json = await res.json().catch(() => ({}));
      if (!json?.ok && json?.hint) {
        setTasksError(String(json.hint));
        setTasksRows([]);
        return;
      }
      const rows = Array.isArray(json?.tasks) ? json.tasks : [];
      setTasksRows(rows);
      if (!json?.ok && rows.length === 0) {
        setTasksError(typeof json?.error === "string" ? json.error : "未找到任务，或任务数据解析失败。");
      }
    } catch (e) {
      setTasksError(e instanceof Error ? e.message : "閸旂姾娴囨径杈Е");
      setTasksRows([]);
    } finally {
      setTasksLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!tasksOpen) return;
    void loadTaskHistory();
    const timer = window.setInterval(() => {
      void loadTaskHistory();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [tasksOpen, loadTaskHistory]);

  function getCurrentCanvasSelectionForActions() {
    let selected = nodesRef.current.filter(
      (node) => (node as Node<AppNodeData> & { selected?: boolean }).selected
    );
    if (
      selected.length === 0 &&
      rf &&
      typeof (rf as { getNodes?: () => Node<AppNodeData>[] }).getNodes === "function"
    ) {
      try {
        selected = (rf as { getNodes: () => Node<AppNodeData>[] })
          .getNodes()
          .filter((node) => node?.selected);
      } catch {
        /* ignore */
      }
    }
    return selected;
  }

  function deleteSelectedCanvasItemsForActions() {
    const currentNodes = nodesRef.current;
    const currentEdges = edgesRef.current;
    const selectedNodes = getCurrentCanvasSelectionForActions();
    const selectedNodeIds = new Set(selectedNodes.map((node) => node.id));
    const selectedEdgeIds = new Set(
      currentEdges
        .filter((edge) => (edge as Edge & { selected?: boolean }).selected)
        .map((edge) => edge.id)
    );
    if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) return;

    undoStackRef.current.push({
      nodes: currentNodes.map((node) => ({ ...node, data: { ...(node.data as any) } as any })),
      edges: currentEdges.map((edge) => ({ ...edge })),
    });
    if (undoStackRef.current.length > 30) undoStackRef.current.shift();

    const removedNodes = currentNodes.filter((node) => selectedNodeIds.has(node.id));
    const nextNodes = currentNodes.filter((node) => !selectedNodeIds.has(node.id));
    setNodes(nextNodes);
    setEdges(
      currentEdges.filter(
        (edge) =>
          !selectedEdgeIds.has(edge.id) &&
          !selectedNodeIds.has(edge.source) &&
          !selectedNodeIds.has(edge.target)
      )
    );
    setSelectionBboxFlow(null);

    window.requestAnimationFrame(() => {
      for (const node of removedNodes) {
        if (node.type !== localImageNodeType) continue;
        const preview = (node.data as LocalImageNodeData).imagePreviewUrl;
        revokeBlobIfUnused(preview, nextNodes);
        void idbDeleteImage(node.id);
      }
    });
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase?.() ?? "";
      const isTyping = tag === "input" || tag === "textarea" || (el as any)?.isContentEditable;

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !isTyping && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveCanvasGraph(nodesRef.current, edgesRef.current);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !isTyping && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setNodes((prev) => prev.map((n) => ({ ...n, selected: true })));
        setEdges((prev) => prev.map((ed) => ({ ...ed, selected: true })));
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !isTyping && e.key.toLowerCase() === "c") {
        e.preventDefault();
        const currentNodes = nodesRef.current;
        const currentEdges = edgesRef.current;
        let selectedNodes = currentNodes.filter((n) => (n as any).selected);
        if (selectedNodes.length === 0 && rf && typeof (rf as any).getNodes === "function") {
          try {
            selectedNodes = (rf as any).getNodes().filter((n: any) => n?.selected);
          } catch {
            // ignore
          }
        }
        if (selectedNodes.length === 0) return;
        const selectedIds = new Set(selectedNodes.map((n) => n.id));
        const selectedEdges = currentEdges.filter(
          (ed) => selectedIds.has(ed.source) && selectedIds.has(ed.target)
        );
        const minX = Math.min(...selectedNodes.map((n) => n.position.x));
        const minY = Math.min(...selectedNodes.map((n) => n.position.y));

        clipboardRef.current = {
          nodes: selectedNodes.map((n) => ({ ...n, selected: false })),
          edges: selectedEdges.map((ed) => ({ ...ed })),
          bbox: { minX, minY },
        };
      }

      if ((e.ctrlKey || e.metaKey) && !isTyping && e.key.toLowerCase() === "v") {
        e.preventDefault();
        const clip = clipboardRef.current;
        if (!clip) return;
        const pointerFlow = getFlowPositionForNewNode();
        const dx = pointerFlow.x - clip.bbox.minX;
        const dy = pointerFlow.y - clip.bbox.minY;

        const idMap = new Map<string, string>();
        const stamp = Date.now();
        clip.nodes.forEach((n, idx) => {
          idMap.set(n.id, `${n.id}__p${stamp}_${idx}`);
        });
        const newNodes: Node<AppNodeData>[] = clip.nodes.map((n) => {
          const newId = idMap.get(n.id)!;
          let data: AppNodeData = n.data;
          if (n.type === "image") {
            data = forkLocalImageNodeDataForDuplicate(n.data as LocalImageNodeData);
          } else if (n.type === "video") {
            data = sanitizeVideoNodeDataForDuplicate(n.data as VideoNodeData);
          } else if (isPromptLikeType(n.type)) {
            const d = n.data as PromptNodeData;
            data = {
              ...sanitizePromptNodeDataForDuplicate(d),
              imageOrder: (d.imageOrder ?? []).map((oid) => idMap.get(oid) ?? oid),
              videoOrder: (d.videoOrder ?? []).map((oid) => idMap.get(oid) ?? oid),
              materialOrder: (d.materialOrder ?? []).map((oid) => idMap.get(oid) ?? oid),
            };
          }
          return {
            ...n,
            id: newId,
            data,
            position: { x: n.position.x + dx, y: n.position.y + dy },
            selected: true,
          };
        });

        const newEdges: Edge[] = clip.edges.map((ed, idx) => {
          const ns = idMap.get(ed.source as string);
          const nt = idMap.get(ed.target as string);
          if (!ns || !nt) return null;
          return {
            ...ed,
            id: `${ed.id}__p${stamp}_${idx}`,
            source: ns,
            target: nt,
            selected: false,
          } as Edge;
        }).filter(Boolean) as Edge[];

        setNodes((prev) => [
          ...prev.map((n) => ({ ...n, selected: false })),
          ...newNodes,
        ]);
        setEdges((prev) => [...prev, ...newEdges]);
      }

      if (!isTyping && (e.key === "Delete" || e.key === "Backspace")) {
        const selectedNodes = getCurrentCanvasSelectionForActions();
        const selectedNodeIds = new Set(selectedNodes.map((n) => n.id));
        const selectedEdgeIds = new Set(
          edgesRef.current.filter((ed) => (ed as Edge & { selected?: boolean }).selected).map((ed) => ed.id)
        );
        if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) return;
        e.preventDefault();
        deleteSelectedCanvasItemsForActions();
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !isTyping && e.key.toLowerCase() === "z") {
        const snap = undoStackRef.current.pop();
        if (!snap) return;
        e.preventDefault();
        setNodes(snap.nodes.map((n) => ({ ...n, data: { ...(n.data as any) } as any })));
        setEdges(snap.edges.map((ed) => ({ ...ed })));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [getFlowPositionForNewNode, setEdges, setNodes, rf]);

  const handleGenerate = useCallback(
    async ({
      prompt,
      nodeId,
      imageProvider,
      videoProvider,
      externalApiProviderId,
      imageQuality,
      modelVersion,
      ratio,
      resolutionType,
      count,
      durationSeconds: durationArg,
      withAudio: withAudioArg,
      onEachImage,
      onStreamProgress,
    }: {
      prompt: string;
      nodeId: string;
      imageProvider?: "dreamina" | "aiwanwu";
      videoProvider?: "dreamina" | "external_api";
      externalApiProviderId?: ExternalImageApiProviderId;
      imageQuality?: "standard" | "high" | "hd";
      modelVersion: string;
      ratio: string;
      resolutionType: string;
      count: number;
      durationSeconds?: number;
      withAudio?: boolean;
      onEachImage?: (url: string) => void;
      onStreamProgress?: (e: GenerateStreamProgressEvent) => void;
    }) => {
      const sourceNode = nodeById.get(nodeId);
      /** 婢舵矮閲滅憴鍡涱暥鏉堟挸鍤懞鍌滃仯閺冭埖瀵?id 閹烘帒绨敍灞肩瑢閹存劗澧栨稉瀣垼 0閵?閳ワ缚绔存稉鈧€电懓绨查敍宀勪缉閸忓秵鐦￠懞鍌滃仯闁姤妯夌粈鍝勫弿闁劌鍨庨梹?*/
      const connectedOutputIds =
        sourceNode?.type === "video"
          ? [nodeId]
          : [
              ...new Set(
                edges
                  .filter(
                    (e) => e.source === nodeId && nodeById.get(e.target)?.type === outputNodeType
                  )
                  .map((e) => e.target)
              ),
            ].sort((a, b) => a.localeCompare(b));

      const sourceData = sourceNode?.data as PromptNodeData | VideoNodeData | undefined;
      const generationMode = (
        sourceNode?.type === "prompt2" || sourceNode?.type === "video" ? "video" : "image"
      ) as "video" | "image";
      const activeImageProvider =
        generationMode === "image" && sourceNode?.type === "prompt"
          ? ((sourceData as PromptNodeData | undefined)?.imageProvider ??
            imageProvider ??
            "aiwanwu")
          : "aiwanwu";
      const activeVideoProvider =
        generationMode === "video" && sourceNode?.type === "prompt2"
          ? ((sourceData as PromptNodeData | undefined)?.videoProvider ??
            videoProvider ??
            "external_api")
          : "external_api";
      const activeExternalApiProviderId =
        generationMode === "image" && sourceNode?.type === "prompt"
          ? normalizeExternalImageApiProviderId(
              (sourceData as PromptNodeData | undefined)?.externalApiProviderId ??
                externalApiProviderId
            )
          : undefined;
      const activeImageQuality =
        generationMode === "image" && sourceNode?.type === "prompt"
          ? (imageQuality ?? (sourceData as PromptNodeData | undefined)?.imageQuality)
          : undefined;

      // 閸忋儴绔熼敍姘拱閸︽壆绀岄弶?+閿涘牅绮庣憴鍡涱暥閻㈢喐鍨氭笟褝绱氶崶鍓у閻㈢喐鍨氶懞鍌滃仯閿涘矂銆庢惔蹇庣瑢 materialOrder 娑撯偓閼?
      const incomingMaterialSourceIds = edges
        .filter((e) => {
          if (e.target !== nodeId || e.targetHandle !== "image_input") return false;
          const srcT = nodeById.get(e.source)?.type;
          return isIncomingImageInputSourceAllowed(
            srcT,
            sourceNode?.type,
            localImageNodeType
          );
        })
        .map((e) => e.source);

      const incomingLocalImageNodes = incomingMaterialSourceIds
        .map((id) => nodeById.get(id))
        .filter((x): x is Node<LocalImageNodeData> => x?.type === localImageNodeType);

      const orderedIds = orderedImageIdsForPrompt(
        incomingMaterialSourceIds,
        storedMaterialOrderForPrompt(sourceData)
      );
      const incomingImageMap = new Map(incomingLocalImageNodes.map((n) => [n.id, n]));
      /** 閸ュ墽鏁撻崶鎯у棘閼板喛绱伴張顒€婀撮崶鎹愬Ν閻?+ 閸忚泛鐣犻崶鍓у閻㈢喐鍨氶懞鍌滃仯閿涘牅瀵屾０鍕潔閸ユ拝绱?*/
      const orderedIncomingImageNodes = orderedIds
        .map((id) => nodeById.get(id))
        .filter((x): x is Node<AppNodeData> => {
          if (!x) return false;
          if (x.type === localImageNodeType && !isLocalMaterialVideo(x)) return true;
          if (x.type === "prompt") return true;
          if (x.type === "process") return true;
          return false;
        });
      const orderedIncomingMaterialLocalNodes = orderedIds
        .map((id) => incomingImageMap.get(id))
        .filter((x): x is Node<LocalImageNodeData> => Boolean(x));
      const orderedIncomingVideoNodes = orderedIncomingMaterialLocalNodes.filter((n) =>
        isLocalMaterialVideo(n)
      );
      /** 鐟欏棝顣舵笟?@閸?n閿涙氨顑?n 娑擃亗鈧苯娴橀悧鍥モ偓宥呭棘閼板喛绱欓崥顐㈡禈閻楀洨鏁撻幋鎰Ν閻愰€涘瘜閸ユ拝绱?*/
      const orderedVideoImageRefNodes = orderedIds
        .map((id) => {
          const n = nodeById.get(id);
          if (!n) return null;
          if (n.type === "prompt") return n as Node<AppNodeData>;
          if (n.type === "process") return n as Node<AppNodeData>;
          if (n.type === localImageNodeType && !isLocalMaterialVideo(n)) return n as Node<AppNodeData>;
          return null;
        })
        .filter((x): x is Node<AppNodeData> => x != null);
      const orderedMaterialNodesForVideo: Node<AppNodeData>[] = orderedIds
        .map((id) => nodeById.get(id))
        .filter((x): x is Node<AppNodeData> => Boolean(x));

      /** 娑?PromptNode.parsePrompt 娑撯偓閼疯揪绱癅閸ュ墽澧杗/@閸ョ穳 娑撹櫣顑?n 瀵姴娴橀敍瀛堢憴鍡涱暥n 娑撹櫣顑?n 娑擃亣顫嬫０?*/
      const typedRefs: Array<{ refType: "image" | "video"; idx: number }> = [];
      for (const m of prompt.matchAll(/@([IV])(\d+)/gi)) {
        const refType = String(m[1]).toUpperCase() === "V" ? "video" : "image";
        const idx = Number(m[2]);
        if (Number.isFinite(idx) && idx >= 1) typedRefs.push({ refType, idx });
      }
      const refKey = (r: { refType: string; idx: number }) => `${r.refType}:${r.idx}`;
      const uniqueTypedRefs = Array.from(
        new Map(typedRefs.map((r) => [refKey(r), r])).values()
      );

      let selectedImageMaterials: Node<AppNodeData>[] = [];
      if (uniqueTypedRefs.length > 0) {
        const imageIdxs = uniqueTypedRefs.filter((r) => r.refType === "image").map((r) => r.idx);
        selectedImageMaterials = imageIdxs
          .map((idx) => orderedIncomingImageNodes[idx - 1])
          .filter(Boolean) as Node<AppNodeData>[];
      }
      if (selectedImageMaterials.length === 0 && orderedIncomingImageNodes.length > 0) {
        selectedImageMaterials = [...orderedIncomingImageNodes];
      }

      const refMode =
        (sourceNode?.type === "prompt2"
          ? ((sourceData as PromptNodeData | undefined)?.referenceMode ?? "general")
          : "general") as "general" | "headtail";
      const durationSeconds =
        typeof durationArg === "number"
          ? durationArg
          : typeof sourceData?.durationSeconds === "number"
            ? sourceData.durationSeconds
            : 5;
      const withAudio =
        typeof withAudioArg === "boolean" ? withAudioArg : Boolean(sourceData?.withAudio);

      let selectedMaterialNodesForVideo: Array<Node<AppNodeData>> = [];
      if (uniqueTypedRefs.length > 0) {
        selectedMaterialNodesForVideo = uniqueTypedRefs
          .map((r) =>
            r.refType === "video"
              ? orderedIncomingVideoNodes[r.idx - 1]
              : orderedVideoImageRefNodes[r.idx - 1]
          )
          .filter(Boolean) as Array<Node<AppNodeData>>;
      }
      if (selectedMaterialNodesForVideo.length === 0 && orderedMaterialNodesForVideo.length > 0) {
        selectedMaterialNodesForVideo = [...orderedMaterialNodesForVideo];
      }
      if (generationMode === "video" && activeVideoProvider === "external_api") {
        selectedMaterialNodesForVideo = selectedMaterialNodesForVideo
          .filter((node) => {
            if (node.type === "prompt" || node.type === "process") return true;
            if (node.type === localImageNodeType) {
              return !isLocalMaterialVideo(node as Node<AppNodeData>);
            }
            return false;
          })
          .slice(0, 2);
      }
      if (generationMode === "video" && refMode === "headtail") {
        selectedMaterialNodesForVideo = selectedMaterialNodesForVideo.slice(0, 2);
      }

      const selectedFiles = (
        await Promise.all(
          selectedImageMaterials.map((n) => {
            const sourceHandle =
              edges.find(
                (edge) =>
                  edge.target === nodeId &&
                  edge.targetHandle === "image_input" &&
                  edge.source === n.id
              )?.sourceHandle ?? "output";
            return n.type === "prompt"
              ? ensureImageFileFromImagePromptNode(n)
              : n.type === "process"
                ? ensureImageFileFromProcessNode(n, sourceHandle)
                : ensureLocalMaterialFile(n as Node<LocalImageNodeData>);
          })
        )
      ).filter((f): f is File => f != null && f.type.startsWith("image/"));

      const videoPairs: { file: File; kind: "image" | "video" }[] = [];
      if (generationMode === "video") {
        for (const n of selectedMaterialNodesForVideo) {
          const sourceHandle =
            edges.find(
              (edge) =>
                edge.target === nodeId &&
                edge.targetHandle === "image_input" &&
                edge.source === n.id
            )?.sourceHandle ?? "output";
          const matFile = await ensureMaterialFileForVideoTarget(
            n,
            localImageNodeType,
            sourceHandle
          );
          if (!matFile) continue;
          videoPairs.push({
            file: matFile,
            kind: fileLooksLikeVideo(matFile) ? "video" : "image",
          });
        }
      }
      const videoMaterialFiles = videoPairs.map((p) => p.file);
      const videoMaterialOrder = videoPairs.map((p) => p.kind);
      const useVideoMaterialPayload =
        generationMode === "video" && videoMaterialFiles.length > 0;

      const historyRefFiles: File[] = [...selectedFiles];
      if (generationMode === "video") {
        for (const p of videoPairs) {
          if (p.kind === "image") historyRefFiles.push(p.file);
        }
      }
      const useBanana2ImageProvider =
        generationMode === "image" &&
        activeImageProvider === "aiwanwu" &&
        activeExternalApiProviderId === "banana2";
      const banana2ReferenceCompressionPresets =
        useBanana2ImageProvider && selectedFiles.length > 0
          ? [
              { max: 4, maxSide: 512, quality: 0.6 },
              { max: 3, maxSide: 384, quality: 0.52 },
              { max: 2, maxSide: 256, quality: 0.45 },
            ]
          : [];
      const banana2ReferenceImageVariants =
        banana2ReferenceCompressionPresets.length > 0
          ? await Promise.all(
              banana2ReferenceCompressionPresets.map((preset) =>
                filesToJpegDataUrls(selectedFiles, preset)
              )
            )
          : [[]];
      const banana2ReferenceImageDataUrls =
        banana2ReferenceImageVariants[0] ?? [];

      const patchSourcePromptRuntime = (
        prev: Node<AppNodeData>[],
        patch: Partial<PromptNodeData>
      ) =>
        prev.map((n) => {
          if (n.id !== nodeId || !isPromptLikeType(n.type)) return n;
          return {
            ...n,
            data: {
              ...(n.data as PromptNodeData),
              ...patch,
            },
          };
        });

      const setSourcePromptRuntime = (patch: Partial<PromptNodeData>) => {
        setNodes((prev) => patchSourcePromptRuntime(prev, patch));
      };

      /** 妫板嫭顥呴梼鑸殿唽閸曡儻顩惄鏍モ偓灞藉従娴犳牗绨妴宥嗩劀閸︺劌鍟撻崗銉ユ倱娑撯偓鐟欏棝顣舵潏鎾冲毉閼哄倻鍋ｉ惃鍕崲閸?*/
      const skipVideoOwnedByOtherSource = (dn: VideoNodeData) =>
        Boolean(
          dn.isLoading &&
            typeof dn.resumeGenSourceNodeId === "string" &&
            dn.resumeGenSourceNodeId !== "" &&
            dn.resumeGenSourceNodeId !== nodeId
        );

      const materialExpected =
        generationMode === "video" && orderedMaterialNodesForVideo.length > 0;
      if (materialExpected && videoMaterialFiles.length === 0) {
        const msg =
          "Reference material connected, but source file cannot be read. Please verify media and retry generation.";
        setSourcePromptRuntime({
          isLoading: false,
          error: msg,
          resumeGenSourceNodeId: undefined,
          lastSubmitId: undefined,
          streamStatusLine: null,
          streamProgressPct: undefined,
          streamInQueue: undefined,
        });
        setNodes((prev) =>
          prev.map((n) => {
            if (!connectedOutputIds.includes(n.id) || n.type !== "video") return n;
            const dn = n.data as VideoNodeData;
            if (skipVideoOwnedByOtherSource(dn)) return n;
            return {
              ...n,
              data: { ...dn, isLoading: false, error: msg, imageUrls: null, expectedCount: 0 },
            };
          })
        );
        return {
          creditsAfter: null,
          costPerImage: null,
          firstImageUrl: null,
          imageUrls: [] as string[],
        };
      }

      if (useVideoMaterialPayload) {
        const nImg = videoPairs.filter((p) => p.kind === "image").length;
        const nVid = videoPairs.filter((p) => p.kind === "video").length;
        const cntMsg = multimodalRefCountErrorMessage(nImg, nVid);
        if (cntMsg) {
          setSourcePromptRuntime({
            isLoading: false,
            error: cntMsg,
            resumeGenSourceNodeId: undefined,
            lastSubmitId: undefined,
            streamStatusLine: null,
            streamProgressPct: undefined,
            streamInQueue: undefined,
          });
          setNodes((prev) =>
            prev.map((n) => {
              if (!connectedOutputIds.includes(n.id) || n.type !== "video") return n;
              const dn = n.data as VideoNodeData;
              if (skipVideoOwnedByOtherSource(dn)) return n;
              return {
                ...n,
                data: {
                  ...dn,
                  isLoading: false,
                  error: cntMsg,
                  imageUrls: null,
                  expectedCount: 0,
                },
              };
            })
          );
          return {
            creditsAfter: null,
            costPerImage: null,
            firstImageUrl: null,
            imageUrls: [] as string[],
          };
        }
        const refVideoFiles = videoPairs.filter((p) => p.kind === "video").map((p) => p.file);
        if (refVideoFiles.length > 0) {
          const { total, unknownCount } = await sumReferenceVideoDurationsSec(refVideoFiles);
          if (unknownCount > 0) {
            const msg =
              "Some reference video durations could not be read. Export as standard MP4 (H.264) and retry.";
            setSourcePromptRuntime({
              isLoading: false,
              error: msg,
              resumeGenSourceNodeId: undefined,
              lastSubmitId: undefined,
              streamStatusLine: null,
              streamProgressPct: undefined,
              streamInQueue: undefined,
            });
            setNodes((prev) =>
              prev.map((n) => {
                if (!connectedOutputIds.includes(n.id) || n.type !== "video") return n;
                const dn = n.data as VideoNodeData;
                if (skipVideoOwnedByOtherSource(dn)) return n;
                return {
                  ...n,
                  data: {
                    ...dn,
                    isLoading: false,
                    error: msg,
                    imageUrls: null,
                    expectedCount: 0,
                  },
                };
              })
            );
            return {
              creditsAfter: null,
              costPerImage: null,
              firstImageUrl: null,
              imageUrls: [] as string[],
            };
          }
          const durMsg = multimodalRefVideoDurationErrorMessage(total);
          if (durMsg) {
            setSourcePromptRuntime({
              isLoading: false,
              error: durMsg,
              resumeGenSourceNodeId: undefined,
              lastSubmitId: undefined,
              streamStatusLine: null,
              streamProgressPct: undefined,
              streamInQueue: undefined,
            });
            setNodes((prev) =>
              prev.map((n) => {
                if (!connectedOutputIds.includes(n.id) || n.type !== "video") return n;
                const dn = n.data as VideoNodeData;
                if (skipVideoOwnedByOtherSource(dn)) return n;
                return {
                  ...n,
                  data: {
                    ...dn,
                    isLoading: false,
                    error: durMsg,
                    imageUrls: null,
                    expectedCount: 0,
                  },
                };
              })
            );
            return {
              creditsAfter: null,
              costPerImage: null,
              firstImageUrl: null,
              imageUrls: [] as string[],
            };
          }
        }
      }

      const genSession = ++videoGenSessionRef.current;
      const multiVideoOutputs = connectedOutputIds.length > 1;
      const expectedPerVideoNode = multiVideoOutputs ? 1 : count;
      const bustGenUrl = (u: string, token: number | string) => {
        if (!isGeneratedMediaUrl(u)) return u;
        return appendCbQuery(u, token);
      };
      const applyFinishToVideoOutputs = (
        prev: Node<AppNodeData>[],
        finalUrlsRaw: string[],
        emptyAfter: boolean,
        emptyMsg: string
      ) =>
        prev.map((n) => {
          if (!connectedOutputIds.includes(n.id) || n.type !== "video") return n;
          const dn = n.data as VideoNodeData;
          if (dn.generationSession !== genSession) return n;
          if (!multiVideoOutputs) {
            const displayUrls = emptyAfter ? null : finalUrlsRaw.map((u) => bustGenUrl(u, genSession));
            return {
              ...n,
              data: {
                ...dn,
                imageUrls: displayUrls,
                isLoading: false,
                error: emptyAfter ? emptyMsg : null,
                expectedCount: emptyAfter ? 0 : count,
                ratio,
                ...(!emptyAfter ? { lastGeneratedAt: Date.now() } : {}),
                generationSession: undefined,
                lastSubmitId: undefined,
                resumeGenSourceNodeId: undefined,
                streamStatusLine: null,
                streamProgressPct: undefined,
                streamInQueue: undefined,
              },
            };
          }
          const idx = connectedOutputIds.indexOf(n.id);
          const hasSlot = !emptyAfter && idx >= 0 && idx < finalUrlsRaw.length;
          const slotUrls = hasSlot ? [bustGenUrl(finalUrlsRaw[idx], genSession)] : null;
          const shortfall =
            !emptyAfter && idx >= finalUrlsRaw.length && idx < connectedOutputIds.length;
          return {
            ...n,
            data: {
              ...dn,
              imageUrls: slotUrls,
              isLoading: false,
              error: emptyAfter
                ? emptyMsg
                : shortfall
                  ? "This node has no assigned output (fewer generated items than output nodes)."
                  : null,
              expectedCount: slotUrls ? 1 : 0,
              ratio,
              ...(slotUrls ? { lastGeneratedAt: Date.now() } : {}),
              generationSession: undefined,
              lastSubmitId: undefined,
              resumeGenSourceNodeId: undefined,
              streamStatusLine: null,
              streamProgressPct: undefined,
              streamInQueue: undefined,
            },
          };
        });

      const applyFinishToSourcePrompt = (
        prev: Node<AppNodeData>[],
        finalUrlsRaw: string[],
        emptyAfter: boolean,
        emptyMsg: string
      ) =>
        patchSourcePromptRuntime(prev, {
          lastRenderedPromptText: prompt,
          isLoading: false,
          error: emptyAfter ? emptyMsg : null,
          ...(!emptyAfter ? { lastGeneratedAt: Date.now() } : {}),
          resumeGenSourceNodeId: undefined,
          lastSubmitId: undefined,
          streamStatusLine: null,
          streamProgressPct: undefined,
          streamInQueue: undefined,
          ...(generationMode === "image" && !emptyAfter
            ? {
                persistedPanelImageUrls: finalUrlsRaw,
                persistedPanelFirstImageUrl:
                  finalUrlsRaw.length >= 2 ? null : (finalUrlsRaw[0] ?? null),
                outputMediaVersion: genSession,
              }
            : {}),
        });

      setNodes((prev) => {
        const next = patchSourcePromptRuntime(
          prev.map((n) => {
            if (!connectedOutputIds.includes(n.id)) return n;
            if (n.type !== "video") return n;

            const dn = n.data as VideoNodeData;
            return {
              ...n,
              data: {
                ...dn,
                isLoading: true,
                error: null,
                expectedCount: expectedPerVideoNode,
                imageUrls: null,
                ratio,
                generationSession: genSession,
                resumeGenSourceNodeId: nodeId,
                lastSubmitId: undefined,
                streamStatusLine: null,
                streamProgressPct: 0,
                streamInQueue: true,
              },
            };
          }),
          {
            lastRenderedPromptText: prompt,
            isLoading: true,
            error: null,
            resumeGenSourceNodeId: nodeId,
            lastSubmitId: undefined,
            streamStatusLine: "任务已提交，等待状态同步...",
            streamProgressPct: 0,
            streamInQueue: true,
          }
        );
        nodesRef.current = next;
        void saveCanvasGraph(next, edgesRef.current);
        return next;
      });

      const streamHeaders = { "X-Jimeng-Stream": "1" };
      generateAbortByNodeRef.current.get(nodeId)?.abort();
      const ac = new AbortController();
      generateAbortByNodeRef.current.set(nodeId, ac);
      const isAbortErr = (e: unknown) =>
        (e instanceof DOMException && e.name === "AbortError") ||
        (e instanceof Error && e.name === "AbortError");

      const emptyGenResult = () =>
        ({
          creditsAfter: null,
          costPerImage: null,
          firstImageUrl: null,
          imageUrls: [] as string[],
          backgroundSyncPending: false,
        }) as const;

      const clearVideoLoading = (error: string | null) => {
        setNodes((prev) =>
          patchSourcePromptRuntime(
            prev.map((n) => {
              if (!connectedOutputIds.includes(n.id) || n.type !== "video") return n;
              const dn = n.data as VideoNodeData;
              if (dn.generationSession !== genSession) return n;
              return {
                ...n,
                data: {
                  ...dn,
                  isLoading: false,
                  error,
                  generationSession: undefined,
                  lastSubmitId: undefined,
                  resumeGenSourceNodeId: undefined,
                  streamStatusLine: null,
                  streamProgressPct: undefined,
                  streamInQueue: undefined,
                },
              };
            }),
            {
              isLoading: false,
              error,
              resumeGenSourceNodeId: undefined,
              lastSubmitId: undefined,
              streamStatusLine: null,
              streamProgressPct: undefined,
              streamInQueue: undefined,
            }
          )
        );
      };

      const preserveBackgroundSync = (statusLine: string, partialUrls?: string[]) => {
        setNodes((prev) =>
          patchSourcePromptRuntime(
            prev.map((n) => {
              if (!connectedOutputIds.includes(n.id) || n.type !== "video") return n;
              const dn = n.data as VideoNodeData;
              if (dn.generationSession !== genSession) return n;
              return {
                ...n,
                data: {
                  ...dn,
                  isLoading: true,
                  error: null,
                  imageUrls:
                    Array.isArray(partialUrls) && partialUrls.length > 0
                      ? partialUrls.map((u) => bustGenUrl(u, genSession))
                      : dn.imageUrls ?? null,
                  lastSubmitId: dn.lastSubmitId,
                  resumeGenSourceNodeId: nodeId,
                  streamStatusLine: statusLine,
                  streamInQueue: true,
                },
              };
            }),
            {
              isLoading: true,
              error: null,
              resumeGenSourceNodeId: nodeId,
              streamStatusLine: statusLine,
              streamInQueue: true,
            }
          )
        );
      };

      try {
      let res: Response;
      try {
        res = await (useBanana2ImageProvider
          ? (async () => {
              let lastResponse: Response | null = null;
              const variants =
                banana2ReferenceImageVariants.length > 0
                  ? banana2ReferenceImageVariants
                  : [banana2ReferenceImageDataUrls];
              for (let index = 0; index < variants.length; index += 1) {
                const variant = variants[index] ?? [];
                const attemptRes = await fetch("/api/generate", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    prompt,
                    nodeId,
                    imageProvider: activeImageProvider,
                    externalApiProviderId: activeExternalApiProviderId,
                    imageQuality: activeImageQuality,
                    modelVersion,
                    ratio,
                    resolutionType,
                    mode: generationMode,
                    count,
                    provider: activeImageProvider,
                    imageUrls: variant,
                  }),
                  signal: ac.signal,
                });
                lastResponse = attemptRes;
                if (attemptRes.ok) return attemptRes;
                if (index < variants.length - 1) {
                  const errorJson = (await attemptRes.clone().json().catch(() => null)) as
                    | { error?: string }
                    | null;
                  const errorText =
                    typeof errorJson?.error === "string" ? errorJson.error : "";
                  if (/香蕉生图任务创建失败|500/.test(errorText)) {
                    continue;
                  }
                }
                return attemptRes;
              }
              return lastResponse!;
            })()
          : selectedFiles.length > 0 || useVideoMaterialPayload
            ? (() => {
              const fd = new FormData();
              fd.append("prompt", prompt);
              fd.append("nodeId", nodeId);
              fd.append("modelVersion", modelVersion);
              fd.append("ratio", ratio);
              fd.append("resolutionType", resolutionType);
              fd.append("mode", generationMode);
              fd.append("count", String(count));
              if (generationMode === "image") {
                fd.append("provider", activeImageProvider);
                if (activeExternalApiProviderId) {
                  fd.append("providerId", activeExternalApiProviderId);
                }
                if (activeImageQuality) {
                  fd.append("imageQuality", activeImageQuality);
                }
              }
              if (generationMode === "video") {
                fd.append("videoProvider", activeVideoProvider);
                fd.append("referenceMode", refMode);
                fd.append("durationSeconds", String(durationSeconds));
                fd.append("withAudio", withAudio ? "1" : "0");
              }
              if (useVideoMaterialPayload) {
                fd.append("materialOrder", videoMaterialOrder.join(","));
                for (const f of videoMaterialFiles) fd.append("material", f, f.name);
              } else {
                for (const f of selectedFiles) fd.append("image", f, f.name);
              }
              return fetch("/api/generate", {
                method: "POST",
                body: fd,
                headers: streamHeaders,
                signal: ac.signal,
              });
            })()
            : fetch("/api/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...streamHeaders },
                body: JSON.stringify({
                  prompt,
                  nodeId,
                  imageProvider: activeImageProvider,
                  externalApiProviderId: activeExternalApiProviderId,
                  imageQuality: activeImageQuality,
                  modelVersion,
                  ratio,
                  resolutionType,
                  mode: generationMode,
                  count,
                  ...(generationMode === "image" ? { provider: activeImageProvider } : {}),
                  ...(generationMode === "video"
                    ? { videoProvider: activeVideoProvider, durationSeconds, withAudio }
                    : {}),
                }),
                signal: ac.signal,
              }));
      } catch (e: unknown) {
        if (isAbortErr(e)) {
          clearVideoLoading(null);
          return { ...emptyGenResult() };
        }
        throw e;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const details =
          err?.details && typeof err.details === "object"
            ? `\n${JSON.stringify(err.details)}`
            : "";
        const msg = (err?.error || `Request failed: ${res.status}`) + details;
        setNodes((prev) =>
          patchSourcePromptRuntime(
            prev.map((n) => {
              if (!connectedOutputIds.includes(n.id)) return n;
              if (n.type !== "video") return n;

              const dn = n.data as VideoNodeData;
              if (dn.generationSession !== genSession) return n;
              return {
                ...n,
                data: {
                  ...dn,
                  isLoading: false,
                  error: msg,
                  imageUrls: null,
                  generationSession: undefined,
                  lastSubmitId: undefined,
                  resumeGenSourceNodeId: undefined,
                  streamStatusLine: null,
                  streamProgressPct: undefined,
                  streamInQueue: undefined,
                },
              };
            }),
            {
              isLoading: false,
              error: msg,
              resumeGenSourceNodeId: undefined,
              lastSubmitId: undefined,
              streamStatusLine: null,
              streamProgressPct: undefined,
              streamInQueue: undefined,
            }
          )
        );
        return {
          creditsAfter: null,
          costPerImage: null,
          firstImageUrl: null,
          imageUrls: [],
        };
      }

      const contentType = res.headers.get("content-type") || "";
      let imageUrls: string[] = [];
      let finalOutputUrls: string[] = [];
      let backgroundSyncPending = false;
      let usageSummary:
        | {
            total_tokens?: number;
            input_tokens?: number;
            output_tokens?: number;
          }
        | null = null;
      let creditsAfter: number | null = null;
      let costPerImage: number | null = null;

      const flushGenerationHistory = async (urls: string[]) => {
        const clean = urls
          .map((u) => (typeof u === "string" ? stripHashOnly(u) : ""))
          .filter((u) => isGeneratedMediaUrl(u));
        if (clean.length === 0) return;
        let historyOutputUrls = clean;
        try {
          const backup = await backupGeneratedMediaToCache(nodeId, generationMode, clean);
          if (backup.ok && backup.files.length === clean.length) {
            historyOutputUrls = backup.files;
          }
        } catch {
          historyOutputUrls = clean;
        }
        let referenceThumbDataUrls: string[] | undefined;
        try {
          const thumbs = await filesToJpegDataUrls(historyRefFiles, {
            max: 3,
            maxSide: 120,
            quality: 0.68,
          });
          if (thumbs.length > 0) referenceThumbDataUrls = thumbs;
        } catch {
          referenceThumbDataUrls = undefined;
        }
        const posterDataByUrl = new Map<string, string>();
        if (generationMode === "video") {
          await Promise.all(
            historyOutputUrls.map(async (outputUrl) => {
              const posterDataUrl = await captureVideoPosterDataUrl(outputUrl, {
                width: 640,
                quality: 0.8,
                timeoutMs: 9000,
              }).catch(() => null);
              if (posterDataUrl) posterDataByUrl.set(outputUrl, posterDataUrl);
            })
          );
        }
        const entries = historyOutputUrls.map((outputUrl) => ({
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          mediaType: generationMode === "video" ? "video" : "image",
          outputUrl,
          fileName: outputUrl.split("/").pop() || "file",
          hasMeta: true,
          promptText: prompt,
          modelVersion,
          ratio,
          resolutionType,
          count,
          ...(generationMode === "video"
            ? {
                videoProvider: activeVideoProvider,
                durationSeconds,
                withAudio,
                referenceMode: refMode,
                ...(posterDataByUrl.get(outputUrl)
                  ? { posterDataUrl: posterDataByUrl.get(outputUrl) }
                  : {}),
              }
            : {}),
          referenceThumbDataUrls,
        }));
        try {
          await fetch("/api/generation-history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ entries }),
          });
        } catch {
          /* ignore */
        }
      };

      if (contentType.includes("ndjson")) {
        let sawTerminalStreamError = false;
        try {
          const reader = res.body?.getReader();
          if (!reader) throw new Error("无法读取生成流。");
          const decoder = new TextDecoder();
          let buffer = "";
          let streamImageSlot = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              const ev = JSON.parse(trimmed) as {
                event?: string;
                url?: string;
                message?: string;
                terminal?: boolean;
                creditsAfter?: number | null;
                costPerImage?: number | null;
                imageUrls?: string[];
                usage?: {
                  total_tokens?: number;
                  input_tokens?: number;
                  output_tokens?: number;
                };
                submitId?: string | null;
                genStatus?: string | null;
                queueLength?: number | null;
                queueIdx?: number | null;
                queueStatus?: string | null;
                waitedMs?: number;
                progressPct?: number | null;
                queueRemainPct?: number | null;
                renderPhase?: "queue" | "rendering" | "unknown" | null;
                backgroundSyncPending?: boolean;
              };
              if (ev.event === "progress") {
                const progressEv: GenerateStreamProgressEvent = {
                  submitId: ev.submitId ?? null,
                  genStatus: ev.genStatus ?? null,
                  queueLength: ev.queueLength ?? null,
                  queueIdx: ev.queueIdx ?? null,
                  queueStatus: ev.queueStatus ?? null,
                  waitedMs: ev.waitedMs,
                  progressPct: ev.progressPct ?? null,
                  queueRemainPct: ev.queueRemainPct ?? null,
                  renderPhase: ev.renderPhase ?? null,
                };
                onStreamProgress?.(progressEv);
                setNodes((prev) =>
                  patchSourcePromptRuntime(
                    prev.map((n) => {
                      if (!connectedOutputIds.includes(n.id) || n.type !== "video") return n;
                      const dn = n.data as VideoNodeData;
                      if (dn.generationSession !== genSession) return n;
                      const inQ = isProgressQueuePhase(progressEv);
                      const line = formatGenerateProgressLine(progressEv);
                      const nextPct = computeProgressFromStreamEvent(
                        progressEv,
                        dn.streamProgressPct ?? 0
                      );
                      return {
                        ...n,
                        data: {
                          ...dn,
                          streamStatusLine: line,
                          streamProgressPct: nextPct,
                          streamInQueue: inQ,
                          lastSubmitId:
                            ev.submitId != null && String(ev.submitId).trim()
                              ? String(ev.submitId).trim()
                              : dn.lastSubmitId,
                        },
                      };
                    }),
                    {
                      isLoading: true,
                      error: null,
                      streamStatusLine: formatGenerateProgressLine(progressEv),
                      streamProgressPct: computeProgressFromStreamEvent(progressEv, 0),
                      streamInQueue: isProgressQueuePhase(progressEv),
                      lastSubmitId:
                        ev.submitId != null && String(ev.submitId).trim()
                          ? String(ev.submitId).trim()
                          : undefined,
                      resumeGenSourceNodeId: nodeId,
                    }
                  )
                );
              }
              if (ev.event === "image" && ev.url) {
                imageUrls.push(ev.url);
                if (generationMode === "image") {
                  const urlsSnapshot = imageUrls.slice();
                  setNodes((prev) =>
                    prev.map((n) => {
                      if (n.id !== nodeId || !isPromptLikeType(n.type)) return n;
                      const d = n.data as PromptNodeData;
                      return {
                        ...n,
                        data: {
                          ...d,
                          persistedPanelImageUrls: urlsSnapshot,
                          persistedPanelFirstImageUrl:
                            urlsSnapshot.length >= 2 ? null : (urlsSnapshot[0] ?? null),
                          isLoading: true,
                          error: null,
                          streamProgressPct: 96,
                          streamInQueue: false,
                          outputMediaVersion: genSession,
                        },
                      };
                    })
                  );
                }
                onEachImage?.(ev.url);
                const urlForUi = bustGenUrl(ev.url, genSession);
                const slot = streamImageSlot++;
                setNodes((prev) =>
                  prev.map((n) => {
                    if (!connectedOutputIds.includes(n.id) || n.type !== "video") return n;
                    const dn = n.data as VideoNodeData;
                    if (dn.generationSession !== genSession) return n;
                    if (multiVideoOutputs) {
                      const outIdx = connectedOutputIds.indexOf(n.id);
                      if (outIdx !== slot) return n;
                      return {
                        ...n,
                        data: {
                          ...dn,
                          imageUrls: [urlForUi],
                          isLoading: true,
                          error: null,
                          expectedCount: 1,
                          ratio,
                          streamProgressPct: 96,
                          streamInQueue: false,
                        },
                      };
                    }
                    return {
                      ...n,
                      data: {
                        ...dn,
                        imageUrls: [...(dn.imageUrls ?? []), urlForUi],
                        isLoading: true,
                        error: null,
                        expectedCount: count,
                        ratio,
                        streamProgressPct: 96,
                        streamInQueue: false,
                      },
                    };
                  })
                );
              }
              if (ev.event === "done") {
                creditsAfter = ev.creditsAfter ?? null;
                costPerImage = typeof ev.costPerImage === "number" ? ev.costPerImage : null;
                usageSummary = ev.usage ?? null;
                backgroundSyncPending = ev.backgroundSyncPending === true;
                if (Array.isArray(ev.imageUrls) && ev.imageUrls.length > 0) {
                  imageUrls = ev.imageUrls;
                }
                if (backgroundSyncPending) {
                  finalOutputUrls = imageUrls;
                }
              }
              if (ev.event === "error") {
                sawTerminalStreamError = true;
                throw new Error(ev.message || "生成失败");
              }
            }
          }
            const emptyMsgAfterStream =
              generationMode === "video"
              ? "生成已结束，但未收到视频输出文件。请检查终端报错后重试。"
              : "生成已结束，但未收到图片输出文件。请检查终端报错后重试。";
          setNodes((prev) => {
            let finalUrls = imageUrls.length > 0 ? [...imageUrls] : [];
            if (finalUrls.length === 0) {
              if (multiVideoOutputs) {
                finalUrls = connectedOutputIds
                  .map((nid) => {
                    const nn = prev.find((x) => x.id === nid && x.type === "video");
                    const u = nn ? (nn.data as VideoNodeData).imageUrls?.[0] : undefined;
                    return typeof u === "string" ? stripHashOnly(u) : null;
                  })
                  .filter((x): x is string => Boolean(x));
              } else {
                const nn = prev.find(
                  (x) =>
                    connectedOutputIds.includes(x.id) &&
                    x.type === "video" &&
                    (x.data as VideoNodeData).generationSession === genSession
                );
                const inc = (nn?.data as VideoNodeData | undefined)?.imageUrls ?? [];
                finalUrls = inc
                  .map((u) => (typeof u === "string" ? stripHashOnly(u) : ""))
                  .filter(Boolean);
              }
            }
            const emptyAfter = finalUrls.length === 0;
            finalOutputUrls = finalUrls;
            return applyFinishToSourcePrompt(
              applyFinishToVideoOutputs(prev, finalUrls, emptyAfter, emptyMsgAfterStream),
              finalUrls,
              emptyAfter,
              emptyMsgAfterStream
            );
          });
        } catch (e: unknown) {
          if (isAbortErr(e)) {
            preserveBackgroundSync("当前页面连接已中断，后台任务仍在继续同步...", imageUrls);
            return {
              creditsAfter: null,
              costPerImage: null,
              firstImageUrl: imageUrls[0] ?? null,
              imageUrls,
            };
          }
          if (!sawTerminalStreamError) {
            preserveBackgroundSync("渲染连接已断开，后台任务仍在继续同步...", imageUrls);
            return {
              creditsAfter: null,
              costPerImage: null,
              firstImageUrl: imageUrls[0] ?? null,
              imageUrls,
            };
          }
          const msg = e instanceof Error ? e.message : "閻㈢喐鍨氭径杈Е";
          setNodes((prev) =>
            patchSourcePromptRuntime(
              prev.map((n) => {
                if (!connectedOutputIds.includes(n.id) || n.type !== "video") return n;
                const dn = n.data as VideoNodeData;
                if (dn.generationSession !== genSession) return n;
                if (multiVideoOutputs) {
                  return {
                    ...n,
                    data: {
                      ...dn,
                      isLoading: false,
                      error: msg,
                      imageUrls: null,
                      expectedCount: 0,
                      generationSession: undefined,
                      lastSubmitId: undefined,
                      resumeGenSourceNodeId: undefined,
                      streamStatusLine: null,
                      streamProgressPct: undefined,
                      streamInQueue: undefined,
                    },
                  };
                }
                const partial =
                  imageUrls.length > 0
                    ? imageUrls
                    : Array.isArray(dn.imageUrls) && dn.imageUrls.length > 0
                      ? dn.imageUrls
                      : null;
                return {
                  ...n,
                  data: {
                    ...dn,
                    isLoading: false,
                    error: msg,
                    imageUrls: partial,
                    generationSession: undefined,
                    lastSubmitId: undefined,
                    resumeGenSourceNodeId: undefined,
                    streamStatusLine: null,
                    streamProgressPct: undefined,
                    streamInQueue: undefined,
                  },
                };
              }),
              {
                isLoading: false,
                error: msg,
                resumeGenSourceNodeId: undefined,
                lastSubmitId: undefined,
                streamStatusLine: null,
                streamProgressPct: undefined,
                streamInQueue: undefined,
              }
            )
          );
          throw e;
        }
      } else {
        const jsonBody = (await res.json()) as {
          imageUrls: string[];
          usage?: {
            total_tokens?: number;
            input_tokens?: number;
            output_tokens?: number;
          };
          creditsAfter?: number | null;
          costPerImage?: number | null;
          backgroundSyncPending?: boolean;
        };
        imageUrls = jsonBody.imageUrls ?? [];
        finalOutputUrls = imageUrls;
        usageSummary = jsonBody.usage ?? null;
        creditsAfter = jsonBody.creditsAfter ?? null;
        costPerImage = jsonBody.costPerImage ?? null;
        backgroundSyncPending = jsonBody.backgroundSyncPending === true;
        for (const u of imageUrls) onEachImage?.(u);
        const emptyAfterJson = imageUrls.length === 0;
        const emptyMsgJson =
          generationMode === "video"
            ? "生成已结束，但未收到视频输出文件。请检查终端报错后重试。"
            : "生成已结束，但未收到图片输出文件。请检查终端报错后重试。";
        setNodes((prev) =>
          applyFinishToSourcePrompt(
            applyFinishToVideoOutputs(prev, imageUrls, emptyAfterJson, emptyMsgJson),
            imageUrls,
            emptyAfterJson,
            emptyMsgJson
          )
        );
      }

      const historyUrls = finalOutputUrls.length > 0 ? finalOutputUrls : imageUrls;
      if (historyUrls.length > 0) {
        setNodes((prev) =>
          prev.map((n) => {
            if (n.id !== nodeId || !isPromptLikeType(n.type)) return n;
            const d = n.data as PromptNodeData;
            return {
              ...n,
              data: {
                ...d,
                lastRenderedPromptText: prompt,
                lastGeneratedAt: Date.now(),
                ...(generationMode === "image"
                  ? {
                      persistedPanelImageUrls: historyUrls,
                      persistedPanelFirstImageUrl:
                        historyUrls.length >= 2 ? null : historyUrls[0] ?? null,
                      outputMediaVersion: genSession,
                    }
                  : {}),
              },
            };
          })
        );
      }

      void flushGenerationHistory(historyUrls);

      return {
        creditsAfter,
        costPerImage,
        firstImageUrl: historyUrls[0] ?? null,
        imageUrls: historyUrls,
        usage: usageSummary,
        backgroundSyncPending,
      };
      } finally {
        if (generateAbortByNodeRef.current.get(nodeId) === ac) {
          generateAbortByNodeRef.current.delete(nodeId);
        }
      }
    },
    [edges, nodeById, setNodes]
  );

  const handleProcess = useCallback(
    async ({
      nodeId,
      operation,
      prompt,
      imageFile,
      maskFile,
      size,
      modelVersion,
      providerId,
      imageQuality,
    }: {
      nodeId: string;
      operation: ImageProcessOperation;
      prompt: string;
      imageFile: File;
      maskFile?: File | null;
      size?: string;
      modelVersion?: string;
      providerId?: ExternalImageApiProviderId;
      imageQuality?: "standard" | "high" | "hd";
    }) => {
      const processOutputVersion = createCanvasNodeId("processout");
      setNodes((prev) =>
        prev.map((node) =>
          node.id === nodeId && node.type === "process"
            ? {
                ...node,
                data: {
                  ...(node.data as ImageProcessNodeData),
                  isLoading: true,
                  error: null,
                  promptText: prompt,
                  outputMediaVersion: processOutputVersion,
                },
              }
            : node
        )
      );

      try {
        const form = new FormData();
        form.append("nodeId", nodeId);
        form.append("operation", operation);
        form.append("prompt", prompt);
        form.append("image", imageFile, imageFile.name);
        if (maskFile) {
          form.append("mask", maskFile, maskFile.name);
        }
        if (size) {
          form.append("size", size);
        }
        if (typeof modelVersion === "string" && modelVersion.trim()) {
          form.append("modelVersion", modelVersion.trim());
        }
        if (isExternalImageApiProviderId(providerId)) {
          form.append("providerId", providerId);
        }
        if (
          imageQuality === "standard" ||
          imageQuality === "high" ||
          imageQuality === "hd"
        ) {
          form.append("imageQuality", imageQuality);
        }

        const response = await fetch("/api/process", {
          method: "POST",
          body: form,
        });
        const json = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          imageUrls?: string[];
          usage?: ImageProcessNodeData["usage"];
        };

        if (!response.ok || !json?.ok) {
          throw new Error(
            typeof json?.error === "string" && json.error.trim()
              ? json.error
              : "素材处理失败"
          );
        }

        const imageUrls = Array.isArray(json.imageUrls) ? json.imageUrls : [];
        const processNode = nodeById.get(nodeId);
        const inputSourceId =
          edges.find(
            (edge) =>
              edge.target === nodeId &&
              edge.targetHandle === "image_input" &&
              isIncomingImageInputSourceAllowed(
                nodeById.get(edge.source)?.type,
                "process",
                localImageNodeType
              )
          )?.source ?? null;
        const inputPreviewUrl = inputSourceId
          ? primaryDisplayImageUrlFromSourceNode(nodeById.get(inputSourceId), null)
          : null;
        setNodes((prev) =>
          prev.map((node) =>
            node.id === nodeId && node.type === "process"
              ? {
                  ...node,
                  data: (() => {
                    const currentData = node.data as ImageProcessNodeData;
                    return {
                      ...currentData,
                      ...buildProcessOperationOutputPatch(currentData, operation, { imageUrls }, {
                        mirrorTopLevel: false,
                        fallbackToTopLevel: false,
                      }),
                      isLoading: false,
                      error: null,
                      usage: json.usage ?? null,
                      outputMediaVersion: processOutputVersion,
                    };
                  })(),
                }
            : node
          )
        );

        const clean = imageUrls
          .map((url) => (typeof url === "string" ? stripHashOnly(url) : ""))
          .filter((url) => isGeneratedMediaUrl(url));
        if (clean.length > 0) {
          let historyOutputUrls = clean;
          try {
            const backup = await backupGeneratedMediaToCache(nodeId, "image", clean);
            if (backup.ok && backup.files.length === clean.length) {
              historyOutputUrls = backup.files;
            }
          } catch {
            historyOutputUrls = clean;
          }
          const entries = historyOutputUrls.map((outputUrl) => ({
            id: crypto.randomUUID(),
            createdAt: Date.now(),
            mediaType: "image" as const,
            sourceKind: "process" as const,
            processOperation: operation,
            outputUrl,
            fileName: outputUrl.split("/").pop() || "file",
            hasMeta: true,
            promptText: prompt,
            modelVersion: `缂栬緫B 路 ${operation}`,
            referenceThumbDataUrls: inputPreviewUrl ? [inputPreviewUrl] : undefined,
          }));
          try {
            await fetch("/api/generation-history", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ entries }),
            });
          } catch {
            /* ignore */
          }
        }

        return {
          imageUrls,
          usage: json.usage ?? null,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "绱犳潗澶勭悊澶辫触";
        setNodes((prev) =>
          prev.map((node) =>
            node.id === nodeId && node.type === "process"
              ? {
                  ...node,
                  data: {
                    ...(node.data as ImageProcessNodeData),
                    isLoading: false,
                    error: message,
                  },
                }
              : node
          )
        );
        throw error;
      }
    },
    [setNodes]
  );

  const onNodeDragStart = useCallback(
    (_e: any) => {
      if (!_e?.ctrlKey) return;
      const nodesBeingDragged = nodesRef.current.filter((n) => (n as any).selected);
      if (!nodesBeingDragged || nodesBeingDragged.length === 0) return;

      const stamp = Date.now();
      const origIds = new Set(nodesBeingDragged.map((n) => n.id));
      const origPositions = new Map<string, { x: number; y: number }>();
      for (const n of nodesBeingDragged) {
        origPositions.set(n.id, { x: n.position.x, y: n.position.y });
      }

      const dupByOrig = new Map<string, string>();
      nodesBeingDragged.forEach((n, idx) => {
        dupByOrig.set(n.id, `${n.id}__cd${stamp}_${idx}`);
      });
      const newNodes: Node<AppNodeData>[] = nodesBeingDragged.map((n) => {
        const newId = dupByOrig.get(n.id)!;
        let data: AppNodeData = n.data;
        if (n.type === "image") {
          data = forkLocalImageNodeDataForDuplicate(n.data as LocalImageNodeData);
        } else if (n.type === "video") {
          data = sanitizeVideoNodeDataForDuplicate(n.data as VideoNodeData);
        } else if (isPromptLikeType(n.type)) {
          const d = n.data as PromptNodeData;
          data = {
            ...sanitizePromptNodeDataForDuplicate(d),
            imageOrder: (d.imageOrder ?? []).map((oid) => dupByOrig.get(oid) ?? oid),
            videoOrder: (d.videoOrder ?? []).map((oid) => dupByOrig.get(oid) ?? oid),
            materialOrder: (d.materialOrder ?? []).map((oid) => dupByOrig.get(oid) ?? oid),
          };
        }
        return {
          ...n,
          id: newId,
          selected: false,
          data,
        };
      });

      const selectedEdges = edgesRef.current.filter(
        (ed) => origIds.has(ed.source as string) && origIds.has(ed.target as string)
      );

      const newEdges: Edge[] = selectedEdges.map((ed, idx) => {
        const ns = dupByOrig.get(ed.source as string);
        const nt = dupByOrig.get(ed.target as string);
        if (!ns || !nt) return ed;
        return {
          ...ed,
          id: `${ed.id}__cd${stamp}_${idx}`,
          source: ns,
          target: nt,
          selected: false,
        };
      });

      ctrlDragRef.current = { origIds, origPositions, dupByOrig, dupEdgeCount: newEdges.length };
      setNodes((prev) => [...prev, ...newNodes]);
      setEdges((prev) => [...prev, ...newEdges.filter(Boolean)]);
    },
    [setNodes, setEdges]
  );

  const onNodeDragStop = useCallback(
    (e: React.MouseEvent, node: Node, draggedNodes: Node[]) => {
      if (e?.ctrlKey) {
        const ctrlState = ctrlDragRef.current;
        if (!ctrlState) return;
        const nodesBeingDragged = nodesRef.current.filter((n) =>
          ctrlState.origIds.has(n.id)
        );
        if (!nodesBeingDragged || nodesBeingDragged.length === 0) return;

        const first = nodesBeingDragged[0];
        const origP = ctrlState.origPositions.get(first.id);
        if (!origP) return;
        const dx = first.position.x - origP.x;
        const dy = first.position.y - origP.y;

        const reverse = new Map<string, string>();
        for (const [origId, dupId] of ctrlState.dupByOrig.entries()) {
          reverse.set(dupId, origId);
        }

        setNodes((prev) =>
          prev.map((n) => {
            if (ctrlState.origIds.has(n.id)) {
              const p = ctrlState.origPositions.get(n.id);
              if (!p) return n;
              return { ...n, position: { ...p }, selected: false };
            }
            const origId = reverse.get(n.id);
            if (origId) {
              const p0 = ctrlState.origPositions.get(origId);
              if (!p0) return n;
              return {
                ...n,
                position: { x: p0.x + dx, y: p0.y + dy },
                selected: true,
              };
            }
            return { ...n, selected: false };
          })
        );

        ctrlDragRef.current = null;
        return;
      }

      const ids = new Set(
        (draggedNodes?.length ? draggedNodes : [node]).map((nd) => nd.id)
      );
      setNodes((prev) => {
        return prev.map((n) => {
          if (n.type === "group") {
            const d = n.data as GroupNodeData;
            if (!d.groupCanvasDragArmed || !ids.has(n.id)) return n;
            return {
              ...n,
              draggable: false,
              data: { ...d, groupCanvasDragArmed: false },
            };
          }
          return n;
        });
      });
    },
    [setNodes]
  );

  const addLocalImageNode = useCallback(
    (file: File, targetPromptNodeId: string) => {
      const promptNode = nodeById.get(targetPromptNodeId);
      if (!promptNode) return;

      const url = URL.createObjectURL(file);

      const existingCount = edges.filter(
        (e) =>
          e.target === targetPromptNodeId &&
          e.targetHandle === "image_input" &&
          nodeById.get(e.source)?.type === localImageNodeType
      ).length;

      const newId = createCanvasNodeId("img");
      const newX = (promptNode.position?.x ?? 0) - 260;
      const newY = (promptNode.position?.y ?? 0) + existingCount * 190;

      const newNode: Node<LocalImageNodeData> = {
        id: newId,
        type: localImageNodeType,
        position: { x: newX, y: newY },
        data: {
          imagePreviewUrl: url,
          imageFile: file,
          materialIsVideo: fileLooksLikeVideo(file),
          refIndex: null,
        },
      };

      const isVid = fileLooksLikeVideo(file);
      setNodes((prev) => {
        const appended = [...prev, newNode];
        return appended.map((n) => {
          if (n.id !== targetPromptNodeId || !isPromptLikeType(n.type)) return n;
          const d = n.data as PromptNodeData;
          const material = d.materialOrder ?? [];
          const nextMaterial = material.includes(newId) ? material : [...material, newId];
          if (isVid) {
            const order = d.videoOrder ?? [];
            return { ...n, data: { ...d, materialOrder: nextMaterial, videoOrder: [...order, newId] } };
          }
          const order = d.imageOrder ?? [];
          return { ...n, data: { ...d, materialOrder: nextMaterial, imageOrder: [...order, newId] } };
        });
      });
      setEdges((prev) =>
        addEdge(
          {
            id: `e-${newId}-${targetPromptNodeId}`,
            source: newId,
            target: targetPromptNodeId,
            sourceHandle: "output",
            targetHandle: "image_input",
            type: CANVAS_EDGE_TYPE,
          },
          prev
        )
      );
      setActivePanelNodeId(targetPromptNodeId);
    },
    [edges, nodeById, localImageNodeType, setEdges, setNodes]
  );

  const createCanvasMaterialNodeAt = useCallback(
    (file: File, flowPos: { x: number; y: number }, orderIndex = 0) => {
      const newId = createCanvasNodeId("img");
      const newNode: Node<LocalImageNodeData> = {
        id: newId,
        type: localImageNodeType,
        position: {
          x: flowPos.x + orderIndex * 34,
          y: flowPos.y + orderIndex * 34,
        },
        data: {
          imagePreviewUrl: URL.createObjectURL(file),
          imageFile: file,
          materialIsVideo: fileLooksLikeVideo(file),
          refIndex: null,
        },
      };
      setNodes((prev) => [...prev, newNode]);
    },
    [localImageNodeType, setNodes]
  );

  const importProcessOutputsAsMaterials = useCallback(
    async (processNodeId: string) => {
      const processNode = nodeById.get(processNodeId);
      if (!processNode || processNode.type !== "process") return;
      const processData = processNode.data as ImageProcessNodeData;
      const activeOperation = processData.operation ?? "outpaint";
      const scopedOutput = getProcessOperationOutputState(processData, activeOperation);
      const seenUrls = new Set<string>();
      const urls = [...scopedOutput.outputSlots, ...scopedOutput.imageUrls]
        .filter((url): url is string => {
          const cleanUrl = typeof url === "string" ? url.trim() : "";
          if (!cleanUrl || seenUrls.has(cleanUrl)) return false;
          seenUrls.add(cleanUrl);
          return true;
        });
      if (urls.length === 0) return;

      const files = await Promise.all(
        urls.map(async (url, index) => {
          try {
            const response = await fetch(url);
            if (!response.ok) return null;
            const blob = await response.blob();
            const mime = blob.type && blob.type !== "application/octet-stream" ? blob.type : "image/png";
            const ext = mime.includes("webp") ? ".webp" : mime.includes("jpeg") ? ".jpg" : ".png";
            return new File([blob], `process-${processNodeId}-${index + 1}${ext}`, { type: mime });
          } catch {
            return null;
          }
        })
      );

      const validFiles = files.filter((file): file is File => file != null);
      if (validFiles.length === 0) return;
      const baseX = (processNode.position?.x ?? 0) + 520;
      const baseY = processNode.position?.y ?? 0;
      const newNodes: Node<AppNodeData>[] = validFiles.map((file, index) => ({
        id: createCanvasNodeId("img"),
        type: localImageNodeType,
        position: {
          x: baseX + (index % 2) * 42,
          y: baseY + Math.floor(index / 2) * 188,
        },
        data: {
          imagePreviewUrl: URL.createObjectURL(file),
          imageFile: file,
          materialIsVideo: fileLooksLikeVideo(file),
          refIndex: null,
        } as LocalImageNodeData,
      }));
      setNodes((prev) => [...prev.map((node) => ({ ...node, selected: false })), ...newNodes]);
      setActivePanelNodeId(null);
    },
    [localImageNodeType, nodeById, setNodes]
  );

  const importFilesToCanvasAtClient = useCallback(
    (files: File[], client: { x: number; y: number }) => {
      const accepted = files.filter(
        (file) => file.type.startsWith("image/") || file.type.startsWith("video/")
      );
      if (accepted.length === 0) return;
      const base = screenToFlow(client);
      accepted.forEach((file, idx) => {
        createCanvasMaterialNodeAt(file, base, idx);
      });
      setCreatePanelOpen(false);
      setPickImageForPromptId(null);
      setActivePanelNodeId(null);
    },
    [createCanvasMaterialNodeAt, screenToFlow]
  );

  const loadLocalImageIntoNode = useCallback(
    (imageNodeId: string, file: File) => {
      setNodes((prev) => {
        const n = prev.find((node) => node.id === imageNodeId);
        if (!n || n.type !== localImageNodeType) return prev;
        const dn = n.data as LocalImageNodeData;
        const oldUrl = dn.imagePreviewUrl ?? null;
        const url = URL.createObjectURL(file);

        const next = prev.map((node) => {
          if (node.id !== imageNodeId) return node;
          return {
            ...node,
            data: {
              ...(node.data as LocalImageNodeData),
              imagePreviewUrl: url,
              imageFile: file,
              materialIsVideo: fileLooksLikeVideo(file),
            },
          };
        });

        revokeBlobIfUnused(oldUrl, next);
        return next;
      });
    },
    [localImageNodeType, setNodes]
  );

  const buildStandaloneCanvasNode = useCallback(
    (kind: SidebarCreateKind, flowPos: { x: number; y: number }) => {
      if (kind === "material") {
        const newId = createCanvasNodeId("img");
        const newNode: Node<AppNodeData> = {
          id: newId,
          type: localImageNodeType,
          position: { x: flowPos.x, y: flowPos.y },
          data: {
            imagePreviewUrl: null,
            imageFile: null,
            refIndex: null,
          } as LocalImageNodeData,
        };
        return { node: newNode, nextActivePanelNodeId: null as string | null };
      }

      if (kind === "text") {
        const textNodeId = createCanvasNodeId("text");
        const textNode: Node<AppNodeData> = {
          id: textNodeId,
          type: "text",
          position: { x: flowPos.x, y: flowPos.y },
          data: {
            nodeName: "文本编辑",
            promptText: "",
            model: externalApiTextModel || "gpt-5.4",
            providerId: externalApiProviderId,
            responseText: "",
            error: null,
            isLoading: false,
          } as TextBoxNodeData,
        };
        return { node: textNode, nextActivePanelNodeId: null as string | null };
      }

      if (kind === "process") {
        const processNodeId = createCanvasNodeId("process");
        const processNode: Node<AppNodeData> = {
          id: processNodeId,
          type: "process",
          position: { x: flowPos.x, y: flowPos.y },
          data: {
            nodeName: "编辑",
            operation: "outpaint",
            panelOpen: false,
            promptEditorOpen: false,
            advancedSettingsOpen: false,
            outputShelfOpen: false,
            referenceShelfOpen: false,
            providerId: externalApiProviderId,
            imageQuality: "standard",
            modelVersion:
              externalApiImageModel ||
              defaultExternalImageModelForProvider(externalApiProviderId),
            promptText: "",
            expandDirection: "all",
            expandPercent: 25,
            upscaleFactor: 2,
            imageUrls: [],
            outputSlots: [null, null, null, null, null],
            activeOutputSlot: 0,
            operationOutputState: {
              outpaint: {
                imageUrls: [],
                outputSlots: [null, null, null, null, null],
                activeOutputSlot: 0,
              },
            },
            error: null,
            isLoading: false,
            maskBrushSize: 24,
            multiviewYaw: 0,
            multiviewPitch: 0,
            multiviewZoom: 100,
            multiviewShiftX: 0,
            multiviewShiftY: 0,
          } as ImageProcessNodeData,
        };
        return { node: processNode, nextActivePanelNodeId: null as string | null };
      }

      if (kind === "prompt2") {
        const promptId = createCanvasNodeId("prompt2");
        const promptNode: Node<AppNodeData> = {
          id: promptId,
          type: "prompt2",
          position: { x: flowPos.x, y: flowPos.y },
          data: {
            nodeName: "视频生成节点",
            generationMode: "video",
            videoProvider: "external_api",
            referenceMode: "general",
            promptText: "",
            error: null,
            modelVersion: "seedance2.0fast",
            ratio: "16:9",
            resolutionType: "720p",
            count: 1,
            durationSeconds: 5,
            withAudio: false,
          } as PromptNodeData,
        };
        return { node: promptNode, nextActivePanelNodeId: promptId };
      }

      const promptId = createCanvasNodeId("prompt");
      const promptNode: Node<AppNodeData> = {
        id: promptId,
        type: "prompt",
        position: { x: flowPos.x, y: flowPos.y },
        data: {
          promptText: "",
          error: null,
          imageProvider: "aiwanwu",
          externalApiProviderId,
          imageQuality: "standard",
          modelVersion: "5.0",
          ratio: "16:9",
          resolutionType: "2k",
          count: 4,
        },
      };
      return { node: promptNode, nextActivePanelNodeId: promptId };
    },
    [externalApiImageModel, externalApiProviderId, localImageNodeType]
  );

  const appendStandaloneCanvasNode = useCallback(
    (
      kind: SidebarCreateKind,
      flowPos: { x: number; y: number },
      options?: { select?: boolean }
    ) => {
      const { node, nextActivePanelNodeId } = buildStandaloneCanvasNode(kind, flowPos);
      const shouldSelect = options?.select !== false;
      setNodes((prev) => [
        ...prev.map((item) => (shouldSelect ? { ...item, selected: false } : item)),
        shouldSelect ? { ...node, selected: true } : node,
      ]);
      setActivePanelNodeId(nextActivePanelNodeId);
      return node.id;
    },
    [buildStandaloneCanvasNode, setNodes]
  );

  const submitCanvasAgent = useCallback(async () => {
    const message = agentDraft.trim();
    if (!message) return;

    agentRequestSeqRef.current += 1;
    const requestSeq = agentRequestSeqRef.current;

    const nextHistory: CanvasAgentHistoryMessage[] = [
      ...agentMessages.map((item) =>
        item.isStreaming ? { ...item, isStreaming: false } : item
      ),
      { id: `user-${Date.now()}`, role: "user", text: message },
    ];
    setAgentMessages(nextHistory);
    setAgentDraft("");
    setAgentAttachedImageDataUrls([]);
    setAgentChatThinking(true);
    setAgentCanInterrupt(false);
    setAgentStatusLabel(null);
    setAgentPendingAction(null);
    setAgentPendingRawMessage(null);

    if (agentChatIdleTimerRef.current != null) {
      window.clearTimeout(agentChatIdleTimerRef.current);
      agentChatIdleTimerRef.current = null;
    }

    let handoffToCanvasGeneration = false;
    let agentAbort: AbortController | null = null;
    let requestIdleTimer: number | null = null;

    const clearRequestIdleTimer = () => {
      if (requestIdleTimer == null) return;
      window.clearTimeout(requestIdleTimer);
      if (agentChatIdleTimerRef.current === requestIdleTimer) {
        agentChatIdleTimerRef.current = null;
      }
      requestIdleTimer = null;
    };

    try {
      const streamingAssistantId = `assistant-stream-${Date.now()}`;
      agentAbortRef.current?.abort();
      agentAbort = new AbortController();
      agentAbortRef.current = agentAbort;
      setAgentMessages((prev) => [
        ...prev,
        {
          id: streamingAssistantId,
          role: "assistant",
          text: "",
          isStreaming: true,
        },
      ]);
      const sharedBody = JSON.stringify({
        message,
        history: nextHistory.slice(-10),
        canvasSummary: buildCanvasAgentSummary(),
        directImageDataUrls: agentAttachedImageDataUrls,
        defaults: {
          imageCount: 1,
          imageRatio: "16:9",
          imageResolution: "2k",
          videoCount: 1,
          videoRatio: "16:9",
          videoResolution: "720p",
          videoDurationSeconds: 5,
          videoWithAudio: false,
        },
        model: agentSelectedModel || externalApiTextModel || "gpt-5.4",
        providerId: externalApiProviderId,
      });

      const response = await fetch("/api/canvas-agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: agentAbort.signal,
        body: sharedBody,
      });

      if (!response.ok) {
        const json = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(
          typeof json?.error === "string" && json.error.trim()
            ? json.error.trim()
            : "智能体请求失败"
        );
      }

      const contentType = response.headers.get("content-type") || "";
      let finalChatReply = "";
      let finalChatModel: string | null = null;
      let finalPayload:
        | (CanvasAgentResponse & { ok?: boolean; error?: string })
        | null = null;

      if (contentType.includes("ndjson")) {
        if (!response.body) {
          throw new Error("智能体流返回为空。");
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let stagedReply = "";
        let flushTimer: number | null = null;

        const clearFlushTimer = () => {
          if (flushTimer == null) return;
          window.clearTimeout(flushTimer);
          flushTimer = null;
        };

        const armChatIdleTimer = () => {
          clearRequestIdleTimer();
          const timerId = window.setTimeout(() => {
            if (requestSeq !== agentRequestSeqRef.current) return;
            setAgentChatThinking(false);
            setAgentCanInterrupt(false);
            if (agentChatIdleTimerRef.current === timerId) {
              agentChatIdleTimerRef.current = null;
            }
            if (requestIdleTimer === timerId) {
              requestIdleTimer = null;
            }
          }, 240);
          requestIdleTimer = timerId;
          agentChatIdleTimerRef.current = timerId;
        };

        const flushReply = () => {
          if (requestSeq !== agentRequestSeqRef.current) return;
          if (!stagedReply) return;
          const nextText = stagedReply;
          if (!agentCanInterruptRef.current && nextText.trim()) {
            setAgentCanInterrupt(true);
          }
          setAgentMessages((prev) =>
            prev.map((item) =>
              item.id === streamingAssistantId
                ? {
                    ...item,
                    text: nextText,
                    isStreaming: true,
                  }
                : item
            )
          );
          armChatIdleTimer();
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (requestSeq !== agentRequestSeqRef.current) return;
            const trimmed = line.trim();
            if (!trimmed) continue;
            const event = JSON.parse(trimmed) as
              | { event?: "reply_delta"; reply?: string; chunk?: string }
              | {
                  event?: "done";
                  payload?: CanvasAgentResponse & { ok?: boolean; error?: string };
                }
              | { event?: "error"; message?: string };

            if (event.event === "reply_delta") {
              const nextReply =
                typeof event.reply === "string"
                  ? event.reply
                  : typeof event.chunk === "string"
                    ? stagedReply + event.chunk
                    : null;
              if (nextReply == null) continue;
              stagedReply = nextReply;
              if (flushTimer == null) {
                flushTimer = window.setTimeout(() => {
                  flushReply();
                  flushTimer = null;
                }, 120);
              }
              continue;
            }

            if (event.event === "done") {
              clearFlushTimer();
              flushReply();
              clearRequestIdleTimer();
              finalPayload = event.payload ?? finalPayload;
              finalChatReply =
                typeof event.payload?.reply === "string" ? event.payload.reply : finalChatReply;
              finalChatModel =
                typeof event.payload?.model === "string" ? event.payload.model : finalChatModel;
              continue;
            }

            if (event.event === "error") {
              throw new Error(event.message || "智能体请求失败");
            }
          }
        }

        clearFlushTimer();
        clearRequestIdleTimer();
      } else {
        finalPayload = (await response.json().catch(() => null)) as
          | (CanvasAgentResponse & { ok?: boolean; error?: string })
          | null;
      }

      if (requestSeq !== agentRequestSeqRef.current) return;
      setAgentChatThinking(false);
      setAgentCanInterrupt(false);

      const json = finalPayload;
      if (!json?.ok) {
        throw new Error(
          typeof json?.error === "string" && json.error.trim()
            ? json.error.trim()
            : "智能体请求失败"
        );
      }

      setAgentModelLabel(finalChatModel || (typeof json.model === "string" ? json.model : null));

      const reply =
        typeof finalChatReply === "string" && finalChatReply.trim()
          ? finalChatReply.trim()
          : typeof json.reply === "string" && json.reply.trim()
            ? json.reply.trim()
            : "我已经开始处理你的请求。";

      setAgentMessages((prev) =>
        prev.map((item) =>
          item.id === streamingAssistantId
            ? {
                ...item,
                text: reply,
                isStreaming: false,
                pendingAction:
                  json.action.type === "ask_generation_path" ||
                  json.action.type === "generate_image" ||
                  json.action.type === "generate_video"
                    ? toCanvasAgentPendingAction(
                        json.action as
                          | Extract<CanvasAgentAction, { type: "ask_generation_path" }>
                          | Extract<
                              CanvasAgentAction,
                              { type: "generate_image" | "generate_video" }
                            >
                      )
                    : undefined,
              }
            : item
        )
      );

      if (
        json.action.type === "ask_generation_path" ||
        json.action.type === "generate_image" ||
        json.action.type === "generate_video"
      ) {
        setAgentPendingAction(
          toCanvasAgentPendingAction(
            json.action as
              | Extract<CanvasAgentAction, { type: "ask_generation_path" }>
              | Extract<CanvasAgentAction, { type: "generate_image" | "generate_video" }>
          )
        );
        setAgentPendingRawMessage(message);
        setAgentStatusLabel("请选择生成方式");
      } else {
        setAgentStatusLabel(null);
      }
    } catch (error) {
      clearRequestIdleTimer();
      const text =
        error instanceof DOMException && error.name === "AbortError"
          ? "已中断当前回复。"
          : error instanceof Error
            ? error.message
            : "智能体执行失败，请稍后重试。";
      if (requestSeq !== agentRequestSeqRef.current) return;
      setAgentChatThinking(false);
      setAgentCanInterrupt(false);
      setAgentMessages((prev) => {
        const lastStreaming = [...prev].reverse().find((item) => item.isStreaming);
        if (!lastStreaming?.id) {
          return [
            ...prev,
            { id: `assistant-error-${Date.now()}`, role: "assistant", text },
          ];
        }
        return prev.map((item) =>
          item.id === lastStreaming.id
            ? { ...item, text, isStreaming: false }
            : item
        );
      });
      setAgentStatusLabel(null);
    } finally {
      clearRequestIdleTimer();
      if (agentAbortRef.current === agentAbort) {
        agentAbortRef.current = null;
      }
      if (requestSeq !== agentRequestSeqRef.current) return;
      setAgentChatThinking(false);
      setAgentCanInterrupt(false);
      if (!handoffToCanvasGeneration) {
        // no-op: chat button state is derived from message streaming only
      }
    }
  }, [
    agentDraft,
    agentMessages,
    buildCanvasAgentSummary,
    agentAttachedImageDataUrls,
    externalApiProviderId,
    agentSelectedModel,
    externalApiTextModel,
    runAgentGenerateAction,
  ]);

  const confirmAgentGenerationPath = useCallback(
    async (path: "canvas" | "chat") => {
      const pending = agentPendingAction;
      if (!pending) return;
      setAgentPendingAction(null);

      if (path === "canvas") {
        setAgentStatusLabel("已切换为画布模式，准备开始执行。");
        const rawPrompt =
          typeof agentPendingRawMessage === "string" && agentPendingRawMessage.trim()
            ? agentPendingRawMessage.trim()
            : pending.prompt;
        const nextAction: CanvasAgentAction =
          pending.target === "video"
            ? {
                type: "generate_video",
                prompt: rawPrompt,
                count: pending.count,
                ratio: pending.ratio as Extract<
                  CanvasAgentAction,
                  { type: "generate_video" }
                >["ratio"],
                resolutionType: pending.resolutionType as Extract<
                  CanvasAgentAction,
                  { type: "generate_video" }
                >["resolutionType"],
                durationSeconds: pending.durationSeconds,
                withAudio: pending.withAudio,
                modelVersion: pending.modelVersion,
                targetNodeId: pending.targetNodeId,
                referenceNodeIds: pending.referenceNodeIds,
              }
            : {
                type: "generate_image",
                prompt: rawPrompt,
                count: pending.count,
                ratio: pending.ratio as Extract<
                  CanvasAgentAction,
                  { type: "generate_image" }
                >["ratio"],
                resolutionType: pending.resolutionType as Extract<
                  CanvasAgentAction,
                  { type: "generate_image" }
                >["resolutionType"],
                imageProvider: pending.imageProvider,
                modelVersion: pending.modelVersion,
                targetNodeId: pending.targetNodeId,
                referenceNodeIds: pending.referenceNodeIds,
              };
        try {
          await runAgentGenerateAction(
            nextAction as Extract<CanvasAgentAction, { type: "generate_image" | "generate_video" }>
          );
          setAgentStatusLabel(
            pending.target === "video"
              ? "视频节点已启动渲染，视角已经拉回画布。"
              : "生图节点已启动渲染，视角已经拉回画布。"
          );
        } finally {
          setAgentPendingRawMessage(null);
        }
        return;
      }

      if (pending.target === "video") {
        setAgentMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text: "聊天窗口直生视频这版还没接通，我建议先走画布节点，这样任务状态和结果更稳定。",
          },
        ]);
        setAgentStatusLabel(null);
        setAgentPendingRawMessage(null);
        return;
      }

      setAgentStatusLabel("正在聊天窗口直接生成图片...");
      try {
        const chatImageModel =
          typeof externalApiImageModel === "string" && externalApiImageModel.trim()
            ? externalApiImageModel.trim()
            : defaultExternalImageModelForProvider(externalApiProviderId);
        const response = await fetch("/api/generate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Jimeng-Stream": "1",
          },
          body: JSON.stringify({
            prompt: pending.prompt,
            nodeId: `agent-chat-${Date.now()}`,
            mode: "image",
            provider: "aiwanwu",
            externalApiProviderId,
            modelVersion: chatImageModel,
            ratio: pending.ratio || "16:9",
            resolutionType: pending.resolutionType || "2k",
            count: pending.count ?? 1,
          }),
        });

        if (!response.ok) {
          const json = (await response.json().catch(() => null)) as
            | { error?: string; details?: { message?: string } }
            | null;
          throw new Error(
            json?.details?.message || json?.error || "聊天窗口直生图片失败"
          );
        }

        const contentType = response.headers.get("content-type") || "";
        let imageUrls: string[] = [];
        if (contentType.includes("ndjson")) {
          const reader = response.body?.getReader();
          if (!reader) throw new Error("无法读取图片生成流。");
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              const event = JSON.parse(trimmed) as {
                event?: string;
                url?: string;
                imageUrls?: string[];
                message?: string;
              };
              if (event.event === "image" && typeof event.url === "string") {
                imageUrls.push(event.url);
              }
              if (event.event === "done" && Array.isArray(event.imageUrls)) {
                imageUrls = event.imageUrls;
              }
              if (event.event === "error") {
                throw new Error(event.message || "聊天窗口直生图片失败");
              }
            }
          }
        } else {
          const json = (await response.json()) as { imageUrls?: string[] };
          imageUrls = Array.isArray(json.imageUrls) ? json.imageUrls : [];
        }

        if (imageUrls.length === 0) {
          throw new Error("图片任务已完成，但没有收到图片结果。");
        }

        setAgentMessages((prev) => [
          ...prev,
          {
            id: `assistant-media-${Date.now()}`,
            role: "assistant",
            text: "图片已经在聊天窗口生成完成。",
            mediaUrls: imageUrls,
            mediaKind: "image",
          },
        ]);
        setAgentStatusLabel("聊天窗口直生图片已完成。");
        setAgentPendingRawMessage(null);
      } catch (error) {
        setAgentMessages((prev) => [
          ...prev,
          {
            id: `assistant-error-${Date.now()}`,
            role: "assistant",
            text:
              error instanceof Error
                ? error.message
                : "聊天窗口直生图片失败，请稍后重试。",
          },
        ]);
        setAgentStatusLabel(null);
        setAgentPendingRawMessage(null);
      } finally {
        // chat send/interrupt state should not depend on background image generation
      }
    },
    [
      agentPendingAction,
      agentPendingRawMessage,
      externalApiImageModel,
      externalApiProviderId,
      runAgentGenerateAction,
    ]
  );

  const interruptCanvasAgent = useCallback(() => {
    agentAbortRef.current?.abort();
    agentAbortRef.current = null;
    if (agentChatIdleTimerRef.current != null) {
      window.clearTimeout(agentChatIdleTimerRef.current);
      agentChatIdleTimerRef.current = null;
    }
    setAgentChatThinking(false);
    setAgentCanInterrupt(false);
  }, []);

  const dragCreateFlowPositionForKind = useCallback(
    (kind: SidebarCreateKind, client: { x: number; y: number }) => {
      const flowPos = screenToFlow(client);

      if (kind === "material") {
        return { x: flowPos.x - 160, y: flowPos.y - 70 };
      }

      if (kind === "text") {
        return { x: flowPos.x - 210, y: flowPos.y - 120 };
      }

      if (kind === "process") {
        return { x: flowPos.x - 184, y: flowPos.y - 28 };
      }

      const { handleRowW, previewBandH } = computePromptPreviewShellDimensions("16:9");
      return {
        x: flowPos.x - handleRowW / 2,
        y: flowPos.y - previewBandH / 2,
      };
    },
    [screenToFlow]
  );

  const createStandaloneCanvasNodeAtClient = useCallback(
    (kind: SidebarCreateKind, client: { x: number; y: number }) => {
      appendStandaloneCanvasNode(kind, dragCreateFlowPositionForKind(kind, client));
    },
    [appendStandaloneCanvasNode, dragCreateFlowPositionForKind]
  );

  const createEmptyLocalImageNode = useCallback(() => {
    appendStandaloneCanvasNode("material", getFlowPositionForNewNode(), { select: false });
  }, [appendStandaloneCanvasNode, getFlowPositionForNewNode]);

  const connectCanvasImageToPrompt = useCallback(
    (imageNodeId: string, promptId: string) => {
      setEdges((prev) => {
        const exists = prev.some(
          (e) =>
            e.source === imageNodeId &&
            e.target === promptId &&
            e.targetHandle === "image_input"
        );
        if (exists) return prev;
        return addEdge(
          {
            id: `e-${imageNodeId}-${promptId}-imgpick`,
            source: imageNodeId,
            target: promptId,
            sourceHandle: "output",
            targetHandle: "image_input",
            type: CANVAS_EDGE_TYPE,
          },
          prev
        );
      });
      setNodes((prev) => {
        const srcNode = prev.find((x) => x.id === imageNodeId);
        const isVid = srcNode ? isLocalMaterialVideo(srcNode) : false;
        return prev.map((n) => {
          if (n.id !== promptId || (!isPromptLikeType(n.type) && n.type !== "video")) return n;
          const d = n.data as PromptNodeData | VideoNodeData;
          const material = d.materialOrder ?? [];
          const nextMaterial = material.includes(imageNodeId) ? material : [...material, imageNodeId];
          if (isVid) {
            const order = d.videoOrder ?? [];
            if (order.includes(imageNodeId)) return n;
            return { ...n, data: { ...d, materialOrder: nextMaterial, videoOrder: [...order, imageNodeId] } };
          }
          const order = d.imageOrder ?? [];
          if (order.includes(imageNodeId)) return n;
          return { ...n, data: { ...d, materialOrder: nextMaterial, imageOrder: [...order, imageNodeId] } };
        });
      });
    },
    [setEdges, setNodes]
  );

  const ungroupNode = useCallback(
    (groupId: string) => {
      setNodes((prev) => {
        const group = prev.find((n) => n.id === groupId);
        if (!group || group.type !== "group") return prev;
        const groupPos = { x: group.position.x, y: group.position.y };
        return prev
          .filter((n) => n.id !== groupId)
          .map((n) => {
            const parentNode = (n as Node<AppNodeData> & { parentNode?: string }).parentNode;
            if (parentNode !== groupId) return n;
            return {
              ...n,
              position: { x: n.position.x + groupPos.x, y: n.position.y + groupPos.y },
              parentNode: undefined,
              extent: undefined,
            } as Node<AppNodeData>;
          });
      });
    },
    [setNodes]
  );

  const groupSelectedNodes = useCallback(() => {
    const current = nodesRef.current;
    const selected = current.filter(
      (n) =>
        (n as any).selected &&
        n.type !== "group" &&
        !(n as Node<AppNodeData> & { parentNode?: string }).parentNode
    );
    if (selected.length < 2) return;
    const byId = new Map(current.map((n) => [n.id, n]));
    const absList = selected.map((n) => ({ n, p: getAbsolutePosition(n, byId) }));
    const minX = Math.min(...absList.map((x) => x.p.x));
    const minY = Math.min(...absList.map((x) => x.p.y));
    const maxX = Math.max(
      ...absList.map((x) => x.p.x + ((x.n.width as number | undefined) ?? 320))
    );
    const maxY = Math.max(
      ...absList.map((x) => x.p.y + ((x.n.height as number | undefined) ?? 200))
    );
    const padding = 28;
    const groupId = createCanvasNodeId("group");
    const groupPos = { x: minX - padding, y: minY - padding };
    const groupW = Math.max(240, maxX - minX + padding * 2);
    const groupH = Math.max(180, maxY - minY + padding * 2);

    const groupNode: Node<GroupNodeData> = {
      id: groupId,
      type: "group",
      position: groupPos,
      style: { width: groupW, height: groupH },
      data: { frameColor: "#52525b" },
      draggable: false,
      selectable: true,
    };

    const selectedIds = new Set(selected.map((n) => n.id));
    setNodes((prev) => {
      const next = prev.map((n) => {
        if (!selectedIds.has(n.id)) return { ...n, selected: false };
        const abs = getAbsolutePosition(n, new Map(prev.map((x) => [x.id, x])));
        return {
          ...n,
          parentNode: groupId,
          extent: "parent",
          position: { x: abs.x - groupPos.x, y: abs.y - groupPos.y },
          selected: false,
        } as Node<AppNodeData>;
      });
      return [...next, { ...groupNode, selected: true } as Node<AppNodeData>];
    });
    setSelectionBboxFlow(null);
  }, [setNodes]);

  const deleteLocalImageNode = useCallback(
    (imageNodeId: string) => {
      setNodes((prev) => {
        const n = prev.find((x) => x.id === imageNodeId);
        const preview = (n?.data as LocalImageNodeData | undefined)?.imagePreviewUrl ?? null;
        const filtered = prev.filter((x) => x.id !== imageNodeId);
        revokeBlobIfUnused(preview, filtered);
        return filtered.map((node) => {
          if (!isPromptLikeType(node.type) && node.type !== "video") return node;
          const d = node.data as PromptNodeData | VideoNodeData;
          return {
            ...node,
            data: {
              ...d,
              imageOrder: (d.imageOrder ?? []).filter((id) => id !== imageNodeId),
              videoOrder: (d.videoOrder ?? []).filter((id) => id !== imageNodeId),
              materialOrder: (d.materialOrder ?? []).filter((id) => id !== imageNodeId),
            },
          };
        });
      });
      setEdges((prev) =>
        prev.filter((e) => e.source !== imageNodeId && e.target !== imageNodeId)
      );
      void idbDeleteImage(imageNodeId);
    },
    [setNodes, setEdges]
  );

  const persistPromptPanelOutput = useCallback(
    (
      nodeId: string,
      payload: { urls: string[]; firstUrl: string | null }
    ) => {
      setNodes((prev) =>
        prev.map((x) => {
          if (x.id !== nodeId || !isPromptLikeType(x.type)) return x;
          const d = x.data as PromptNodeData;
          return {
            ...x,
            data: {
              ...d,
              persistedPanelImageUrls: payload.urls,
              persistedPanelFirstImageUrl: payload.firstUrl,
              promptPanelPrimaryImageIndex:
                payload.urls.length > 0
                  ? Math.min(
                      Math.max(0, d.promptPanelPrimaryImageIndex ?? 0),
                      payload.urls.length - 1
                    )
                  : 0,
            },
          };
        })
      );
    },
    [setNodes]
  );

  /** 閻㈣绔锋径姘禈鐏炴洖绱?閺€鎯版崳閿涙艾鑴婇幀褌缍呯粔浼欑礄閻ｃ儱鎻╅敍灞肩┒娴滃骸鎻╅柅鐔荤箻閸忋儳缍夐弽纭风礆 */
  const CANVAS_IMAGE_LAYOUT_EASE = "cubic-bezier(0.18, 1.24, 0.24, 1)";
  const CANVAS_IMAGE_COLLAPSE_TRANSITION =
    "transform 580ms cubic-bezier(0.18, 1.22, 0.24, 1), opacity 260ms ease-out";
  const PROMPT_PREVIEW_STACK_INSET = 3;
  const getCanvasImageLayoutDelay = (slotIndex: number) => `${Math.min(slotIndex, 3) * 22}ms`;
  const getCanvasImageLayoutTransitionStyle = (slotIndex: number) => {
    const delay = getCanvasImageLayoutDelay(slotIndex);
    return {
      transitionProperty: "transform, opacity",
      transitionDuration: "620ms, 220ms",
      transitionTimingFunction: `${CANVAS_IMAGE_LAYOUT_EASE}, ease-out`,
      transitionDelay: `${delay}, ${delay}`,
    } as const;
  };

  const collapsePromptImageCanvasSpill = useCallback(
    (promptId: string) => {
      const prevT = spillCollapseFinalizeRef.current.get(promptId);
      if (prevT != null) {
        clearTimeout(prevT);
        spillCollapseFinalizeRef.current.delete(promptId);
      }
      const prevRevealT = spillCollapseStackRevealRef.current.get(promptId);
      if (prevRevealT != null) {
        clearTimeout(prevRevealT);
        spillCollapseStackRevealRef.current.delete(promptId);
      }
      const prevOpenCtaT = spillCollapseOpenCtaRef.current.get(promptId);
      if (prevOpenCtaT != null) {
        clearTimeout(prevOpenCtaT);
        spillCollapseOpenCtaRef.current.delete(promptId);
      }
      setNodes((prev) => {
        const p = prev.find((x) => x.id === promptId);
        const spill = (p?.data as PromptNodeData | undefined)?.canvasImageSpill;
        if (!p || !spill) return prev;
        if (spill.collapseAnim) return prev;

        const ratio = (p.data as PromptNodeData).ratio ?? "16:9";
        const pd = p.data as PromptNodeData;
        const { shellW, shellH, handleRowW, previewBandH } =
          computePromptPreviewShellDimensions(ratio);
        const cur = p.position ?? { x: 0, y: 0 };
        const targetShellLeft =
          cur.x + (handleRowW - shellW) / 2 + PROMPT_PREVIEW_STACK_INSET;
        const targetShellTop =
          cur.y + (previewBandH - shellH) + PROMPT_PREVIEW_STACK_INSET;
        const extent = Math.max(
          1,
          Array.isArray(spill.hydrationUrlSnapshot) && spill.hydrationUrlSnapshot.length > 0
            ? spill.hydrationUrlSnapshot.length
            : spill.imageNodeIds.length + 1
        );
        const primaryIndex =
          typeof pd.promptPanelPrimaryImageIndex === "number" &&
          Number.isFinite(pd.promptPanelPrimaryImageIndex)
            ? Math.max(0, Math.min(extent - 1, pd.promptPanelPrimaryImageIndex))
            : 0;
        const collapseOrder = Array.from({ length: Math.max(0, extent - 1) }, (_, step) =>
          (primaryIndex + step + 1) % extent
        );
        const collapseOrderIndex = new Map(collapseOrder.map((urlIndex, index) => [urlIndex, index]));
        const collapseDeckCount = Math.min(3, collapseOrder.length);

        return prev.map((n) => {
          if (spill.imageNodeIds.includes(n.id)) {
            const nd = n.data as LocalImageNodeData;
            const collapseIdx = collapseOrderIndex.get(nd.generatedSpillUrlIndex ?? -1) ?? 999;
            const collapseLayer = Math.max(
              0,
              Math.min(collapseDeckCount - 1, collapseDeckCount - 1 - collapseIdx)
            );
            const stackVisible = collapseIdx < collapseDeckCount;
            const offsetX = stackVisible ? 10 + collapseLayer * 8 : 8 + collapseDeckCount * 8;
            const offsetY = stackVisible ? 2 + collapseLayer * 5 : 4 + collapseDeckCount * 5;
            const collapseRotateDeg = stackVisible ? 2.1 + collapseLayer * 1.45 : 0;
            return {
              ...n,
              position: { x: targetShellLeft + offsetX, y: targetShellTop + offsetY },
              data: {
                ...nd,
                generatedSpillCollapseRotateDeg: collapseRotateDeg,
                generatedSpillCollapseScale: stackVisible ? 0.996 : 0.992,
                generatedSpillCollapseAlpha: 0,
              },
              style: {
                ...(n.style as object),
                transition: CANVAS_IMAGE_COLLAPSE_TRANSITION,
                opacity: stackVisible ? 1 : 0,
              },
            };
          }
          if (n.id === promptId) {
            const d = n.data as PromptNodeData;
            return {
              ...n,
              data: {
                ...d,
                canvasImageSpill: {
                  ...spill,
                  panelCenterOffsetX: 0,
                  collapseAnim: true,
                  collapseStackAlpha: 0,
                  collapseOpenReady: false,
                },
              },
            };
          }
          return n;
        });
      });

      const revealTid = window.setTimeout(() => {
        spillCollapseStackRevealRef.current.delete(promptId);
        setNodes((prev) =>
          prev.map((n) => {
            if (n.id !== promptId) return n;
            const d = n.data as PromptNodeData;
            const liveSpill = d.canvasImageSpill;
            if (!liveSpill?.collapseAnim) return n;
            return {
              ...n,
              data: {
                ...d,
                canvasImageSpill: {
                  ...liveSpill,
                  collapseStackAlpha: 1,
                },
              },
            };
          })
        );
      }, 40);
      spillCollapseStackRevealRef.current.set(promptId, revealTid);

      const openCtaTid = window.setTimeout(() => {
        spillCollapseOpenCtaRef.current.delete(promptId);
        setNodes((prev) =>
          prev.map((n) => {
            if (n.id !== promptId) return n;
            const d = n.data as PromptNodeData;
            const liveSpill = d.canvasImageSpill;
            if (!liveSpill?.collapseAnim) return n;
            return {
              ...n,
              data: {
                ...d,
                canvasImageSpill: {
                  ...liveSpill,
                  collapseOpenReady: true,
                },
              },
            };
          })
        );
      }, 430);
      spillCollapseOpenCtaRef.current.set(promptId, openCtaTid);

      const finalizeTid = window.setTimeout(() => {
        spillCollapseFinalizeRef.current.delete(promptId);
        const revealT = spillCollapseStackRevealRef.current.get(promptId);
        if (revealT != null) {
          clearTimeout(revealT);
          spillCollapseStackRevealRef.current.delete(promptId);
        }
        const openCtaT = spillCollapseOpenCtaRef.current.get(promptId);
        if (openCtaT != null) {
          clearTimeout(openCtaT);
          spillCollapseOpenCtaRef.current.delete(promptId);
        }
        setNodes((prev) => {
          const p = prev.find((x) => x.id === promptId);
          const spill = (p?.data as PromptNodeData | undefined)?.canvasImageSpill;
          if (!spill) return prev;
          const pd = p?.data as PromptNodeData | undefined;
          const keepBlobs = new Set<string>();
          for (const u of pd?.persistedPanelImageUrls ?? []) {
            if (typeof u === "string" && u.startsWith("blob:")) keepBlobs.add(u);
          }
          const firstU = pd?.persistedPanelFirstImageUrl;
          if (typeof firstU === "string" && firstU.startsWith("blob:")) keepBlobs.add(firstU);
          const rm = new Set(spill.imageNodeIds);
          for (const id of spill.imageNodeIds) {
            const node = prev.find((x) => x.id === id);
            const u = (node?.data as LocalImageNodeData | undefined)?.imagePreviewUrl;
            if (typeof u === "string" && u.startsWith("blob:") && !keepBlobs.has(u)) {
              try {
                URL.revokeObjectURL(u);
              } catch {
                /* ignore */
              }
            }
          }
          return prev
            .filter((n) => !rm.has(n.id))
            .map((n) => {
              if (n.id !== promptId) return n;
              const d = n.data as PromptNodeData;
              const urls = d.persistedPanelImageUrls ?? [];
              const pi =
                typeof d.promptPanelPrimaryImageIndex === "number"
                  ? d.promptPanelPrimaryImageIndex
                  : 0;
              /** 閺€璺烘礀閸氬酣銆婇悧灞芥祼鐎规矮璐熼弫鎵矋妫ｆ牠銆嶉敍宀勪缉閸忓秵婀伴崷?state 娑撳氦濡悙?data 閻厽娈忔稉宥呮倱濮濄儲妞傛い璺烘禈闁挎瑦鐗?*/
              let nextUrls = urls;
              let nextPi = pi;
              const didRotate =
                urls.length >= 2 && pi > 0 && pi < urls.length;
              if (didRotate) {
                nextUrls = [...urls.slice(pi), ...urls.slice(0, pi)];
                nextPi = 0;
              }
              return {
                ...n,
                style: undefined,
                data: {
                  ...d,
                  canvasImageSpill: undefined,
                  persistedPanelImageUrls: nextUrls,
                  promptPanelPrimaryImageIndex: nextPi,
                  ...(nextUrls.length >= 2 ? { persistedPanelFirstImageUrl: null } : {}),
                  ...(didRotate
                    ? {
                        panelUrlsNormalizeRev: (d.panelUrlsNormalizeRev ?? 0) + 1,
                      }
                    : {}),
                },
              };
            });
        });
      }, 720);
      spillCollapseFinalizeRef.current.set(promptId, finalizeTid);
    },
    [setNodes]
  );

  useEffect(() => {
    if (!externalApiConfigReady) return;
    syncNodesToExternalApiConfig(externalApiProviderId, {
      imageModel: externalApiImageModel,
      textModel: externalApiTextModel,
    });
  }, [
    externalApiConfigReady,
    externalApiImageModel,
    externalApiProviderId,
    externalApiTextModel,
    nodes.length,
    syncNodesToExternalApiConfig,
  ]);

  useEffect(() => {
    void openCacheSettings();
  }, []);

  type ExpandImagePayload = {
    urls: string[];
    ratio: string;
    primaryIndex: number;
    expectedTileCount?: number;
  };

  const expandPromptImageResultsToCanvas = useCallback(
    (promptId: string, payload: ExpandImagePayload) => {
      const { urls, ratio, primaryIndex: primaryIdxRaw, expectedTileCount } = payload;
      /** 缂冩垶鐗稿Σ鑺ユ殶閿涙矮绱崗鍫㈡暏閼哄倻鍋ｆ稉濠傚嚒闁绱堕弫甯礄閻㈢喐鍨氭稉顓濈瘍娴兼矮绱?tilesCount=count閿涘绱濇稉搴″嚒閺?URL 閸欐牕銇囬敍灞拘担宥勭瑢娑撳鐖ｆ禒搴＄潔瀵偓鐠у嘲姘ㄩ崶鍝勭暰 */
      const countFromUi =
        typeof expectedTileCount === "number" && expectedTileCount > 0
          ? expectedTileCount
          : 0;
      const extent = Math.max(countFromUi || urls.length, urls.length);
      if (extent < 2) return;

      const paddedUrls = urls.slice();
      while (paddedUrls.length < extent) paddedUrls.push("");

      let pIdx = Math.min(Math.max(0, primaryIdxRaw), extent - 1);

      const otherUrlIndices = Array.from({ length: extent }, (_, i) => i).filter((i) => i !== pIdx);

      const { shellW, shellH, handleRowW, previewBandH } =
        computePromptPreviewShellDimensions(ratio);
      const gap = SPILL_EXPAND_LAYOUT_GAP_PX;

      const t0 = Date.now();
      type SpillEntry = { slotIndex: number; urlIndex: number; node: Node<LocalImageNodeData> };
      const spillEntries: SpillEntry[] = [];

      const makePlaceholderNode = (urlIndex: number, id: string): Node<LocalImageNodeData> => ({
        id,
        type: localImageNodeType,
        position: { x: 0, y: 0 },
        draggable: false,
        data: {
          imagePreviewUrl: null,
          imageFile: null,
          materialIsVideo: urlStringLooksLikeVideoUrl(paddedUrls[urlIndex]),
          refIndex: null,
          tileWidth: shellW,
          tileHeight: shellH,
          generatedSpillPromptId: promptId,
          generatedSpillUrlIndex: urlIndex,
          generatedSpillPending: true,
        },
      });

      let slot = 1;
      for (const urlIndex of otherUrlIndices) {
        spillEntries.push({
          slotIndex: slot,
          urlIndex,
          node: makePlaceholderNode(urlIndex, `img-spill-${promptId}-${urlIndex}-${t0}`),
        });
        slot += 1;
      }

      const spawnPhase = (prev: Node<AppNodeData>[]) => {
        const p0 = prev.find((x) => x.id === promptId);
        if (!p0 || !isPromptLikeType(p0.type)) return prev;

        const d0 = p0.data as PromptNodeData;
        const savedForSpill = d0.canvasImageSpill?.savedPosition ?? {
          ...(p0.position ?? { x: 0, y: 0 }),
        };

        let working = prev;
        const existingSpill = d0.canvasImageSpill;
        if (existingSpill) {
          const keepBlobs = new Set<string>();
          for (const u of d0.persistedPanelImageUrls ?? []) {
            if (typeof u === "string" && u.startsWith("blob:")) keepBlobs.add(u);
          }
          const firstKeep = d0.persistedPanelFirstImageUrl;
          if (typeof firstKeep === "string" && firstKeep.startsWith("blob:")) {
            keepBlobs.add(firstKeep);
          }
          const rm = new Set(existingSpill.imageNodeIds);
          for (const id of existingSpill.imageNodeIds) {
            const node = working.find((x) => x.id === id);
            const u = (node?.data as LocalImageNodeData | undefined)?.imagePreviewUrl;
            if (typeof u === "string" && u.startsWith("blob:") && !keepBlobs.has(u)) {
              try {
                URL.revokeObjectURL(u);
              } catch {
                /* ignore */
              }
            }
          }
          working = working
            .filter((n) => !rm.has(n.id))
            .map((n) => {
              if (n.id !== promptId) return n;
              const d = n.data as PromptNodeData;
              return {
                ...n,
                data: { ...d, canvasImageSpill: undefined },
                style: undefined,
              };
            });
        }

        const p = working.find((x) => x.id === promptId);
        if (!p) return prev;

        const pos = p.position ?? { x: 0, y: 0 };
        const totalSlots = 1 + spillEntries.length;
        const layout = computeSpillExpandLayout({
          promptPos: pos,
          handleRowW,
          previewBandH,
          shellW,
          shellH,
          gap,
          totalSlots,
        });
        if (!layout) return prev;

        const { gridW } = layout;

        const targetShellLeft =
          pos.x + (handleRowW - shellW) / 2 + PROMPT_PREVIEW_STACK_INSET;
        const targetShellTop =
          pos.y + (previewBandH - shellH) + PROMPT_PREVIEW_STACK_INSET;

        const spill = {
          savedPosition: savedForSpill,
          imageNodeIds: spillEntries.map((f) => f.node.id),
          panelMaxWidthPx: gridW,
          /** 娑?final 鐢傜鐠х柉绻冨〒鈥冲煂鐏炴洖绱戦崑蹇曅╅敍灞句划婢跺秵甯撴惔蹇撳З閻?*/
          panelCenterOffsetX: 0,
          hydrationUrlSnapshot: paddedUrls.slice(),
        };

        const spawnImages = spillEntries.map(({ node }) => ({
          ...node,
          data: {
            ...(node.data as LocalImageNodeData),
            generatedSpillCollapseAlpha: 1,
            generatedSpillCollapseRotateDeg: 0,
            generatedSpillCollapseScale: 1,
            generatedSpillExpandWobbleDeg: 2.6,
            generatedSpillExpandWobbleTick: Date.now(),
          },
          position: { x: targetShellLeft, y: targetShellTop },
          style: { transition: "none", opacity: 1 },
        }));

        return [
          ...working.map((n) => {
            if (n.id !== promptId) return n;
            const d = n.data as PromptNodeData;
            return {
              ...n,
              data: {
                ...d,
                canvasImageSpill: spill,
                promptPanelPrimaryImageIndex: pIdx,
              },
              style: undefined,
            };
          }),
          ...spawnImages,
        ];
      };

      const finalPhase = (prev: Node<AppNodeData>[]) => {
        const p = prev.find((x) => x.id === promptId);
        const spill = (p?.data as PromptNodeData | undefined)?.canvasImageSpill;
        if (!p || !isPromptLikeType(p.type) || !spill) return prev;

        const expectedSpillIds = new Set(spillEntries.map((e) => e.node.id));
        const currentSpillIds = spill.imageNodeIds ?? [];
        if (
          currentSpillIds.length !== expectedSpillIds.size ||
          currentSpillIds.some((id) => !expectedSpillIds.has(id))
        ) {
          return prev;
        }

        const pos = p.position ?? { x: 0, y: 0 };
        const totalSlots = 1 + spillEntries.length;
        const layout = computeSpillExpandLayout({
          promptPos: pos,
          handleRowW,
          previewBandH,
          shellW,
          shellH,
          gap,
          totalSlots,
        });
        if (!layout) return prev;

        const { gridW, panelCenterOffsetX, slotPos } = layout;
        const targetShellLeft =
          pos.x + (handleRowW - shellW) / 2 + PROMPT_PREVIEW_STACK_INSET;
        const targetShellTop =
          pos.y + (previewBandH - shellH) + PROMPT_PREVIEW_STACK_INSET;

        const placedImages = spillEntries.map(({ slotIndex, node }) => {
          const { left, top } = slotPos(slotIndex);
          const latest = prev.find((x) => x.id === node.id && x.type === localImageNodeType);
          const base = latest ?? node;
          const dx = left - targetShellLeft;
          const dy = top - targetShellTop;
          const wobbleX = Math.max(-16, Math.min(16, dx * 0.085));
          const wobbleY = Math.max(-10, Math.min(10, dy * 0.085));
          return {
            ...base,
            data: {
              ...((base.data as LocalImageNodeData) ?? {}),
              generatedSpillCollapseAlpha: 1,
              generatedSpillCollapseRotateDeg: 0,
              generatedSpillCollapseScale: 1,
              generatedSpillExpandWobbleX: wobbleX,
              generatedSpillExpandWobbleY: wobbleY,
              generatedSpillExpandWobbleTick: t0 + slotIndex,
            },
            position: { x: left, y: top },
            style: {
              ...getCanvasImageLayoutTransitionStyle(slotIndex),
              opacity: 1,
            },
          };
        });

        const nextIds = placedImages.map((n) => n.id);
        const { collapseAnim: _omitCollapse, ...spillRest } = spill;
        const nextSpill = {
          ...spillRest,
          imageNodeIds: nextIds,
          panelMaxWidthPx: gridW,
          panelCenterOffsetX,
          hydrationUrlSnapshot: paddedUrls.slice(),
        };
        const placedById = new Map(placedImages.map((x) => [x.id, x]));

        return prev.map((n) => {
          const hit = placedById.get(n.id);
          if (hit) return hit;
          if (n.id === promptId) {
            const d = n.data as PromptNodeData;
            return {
              ...n,
              data: {
                ...d,
                canvasImageSpill: nextSpill,
                promptPanelPrimaryImageIndex: pIdx,
              },
              style: undefined,
            };
          }
          return n;
        });
      };

      const resumeCollapsingSpillExpand = (
        prev: Node<AppNodeData>[]
      ): Node<AppNodeData>[] | null => {
        const p = prev.find((x) => x.id === promptId && isPromptLikeType(x.type));
        if (!p) return null;
        const spill = (p.data as PromptNodeData).canvasImageSpill;
        if (!spill?.imageNodeIds || spill.imageNodeIds.length === 0) return null;
        if (spill.imageNodeIds.length !== otherUrlIndices.length) return null;

        const pos = p.position ?? { x: 0, y: 0 };
        const totalSlots = 1 + otherUrlIndices.length;
        const layout = computeSpillExpandLayout({
          promptPos: pos,
          handleRowW,
          previewBandH,
          shellW,
          shellH,
          gap,
          totalSlots,
        });
        if (!layout) return null;
        const { gridW, panelCenterOffsetX, slotPos } = layout;
        const targetShellLeft =
          pos.x + (handleRowW - shellW) / 2 + PROMPT_PREVIEW_STACK_INSET;
        const targetShellTop =
          pos.y + (previewBandH - shellH) + PROMPT_PREVIEW_STACK_INSET;

        const slotForUrlIndex = new Map<number, number>();
        let s = 1;
        for (const urlIx of otherUrlIndices) {
          slotForUrlIndex.set(urlIx, s++);
        }

        const orderedIds = spill.imageNodeIds.slice().sort((a, b) => {
          const na = prev.find((n) => n.id === a);
          const nb = prev.find((n) => n.id === b);
          const ia = (na?.data as LocalImageNodeData | undefined)?.generatedSpillUrlIndex ?? -1;
          const ib = (nb?.data as LocalImageNodeData | undefined)?.generatedSpillUrlIndex ?? -1;
          return otherUrlIndices.indexOf(ia) - otherUrlIndices.indexOf(ib);
        });

        const placedById = new Map<string, Node<AppNodeData>>();
        for (const nid of orderedIds) {
          const node = prev.find((n) => n.id === nid);
          if (!node || node.type !== localImageNodeType) return null;
          const d = node.data as LocalImageNodeData;
          if (d.generatedSpillPromptId !== promptId) return null;
          const uix = d.generatedSpillUrlIndex;
          if (typeof uix !== "number") return null;
          const slotIndex = slotForUrlIndex.get(uix);
          if (slotIndex === undefined) return null;
          const { left, top } = slotPos(slotIndex);
          const dx = left - targetShellLeft;
          const dy = top - targetShellTop;
          const wobbleX = Math.max(-16, Math.min(16, dx * 0.085));
          const wobbleY = Math.max(-10, Math.min(10, dy * 0.085));
          placedById.set(nid, {
            ...node,
            data: {
              ...(node.data as LocalImageNodeData),
              generatedSpillCollapseAlpha: 1,
              generatedSpillCollapseRotateDeg: 0,
              generatedSpillCollapseScale: 1,
              generatedSpillExpandWobbleX: wobbleX,
              generatedSpillExpandWobbleY: wobbleY,
              generatedSpillExpandWobbleTick: Date.now() + slotIndex,
            },
            position: { x: left, y: top },
            style: {
              ...getCanvasImageLayoutTransitionStyle(slotIndex),
              opacity: 1,
            },
          });
        }

        const { collapseAnim: _omitResumeCollapse, ...spillResumeRest } = spill;
        const nextSpill = {
          ...spillResumeRest,
          imageNodeIds: orderedIds,
          panelMaxWidthPx: gridW,
          panelCenterOffsetX,
          hydrationUrlSnapshot: paddedUrls.slice(),
        };

        return prev.map((n) => {
          const hit = placedById.get(n.id);
          if (hit) return hit;
          if (n.id === promptId) {
            const d = n.data as PromptNodeData;
            return {
              ...n,
              data: {
                ...d,
                canvasImageSpill: nextSpill,
                promptPanelPrimaryImageIndex: pIdx,
              },
              style: undefined,
            };
          }
          return n;
        });
      };

      const prevCollapseT = spillCollapseFinalizeRef.current.get(promptId);
      if (prevCollapseT != null) {
        clearTimeout(prevCollapseT);
        spillCollapseFinalizeRef.current.delete(promptId);
      }
      const prevExpandClean = spillExpandStyleCleanupRef.current.get(promptId);
      if (prevExpandClean != null) {
        clearTimeout(prevExpandClean);
        spillExpandStyleCleanupRef.current.delete(promptId);
      }
      const prevCollapseRevealT = spillCollapseStackRevealRef.current.get(promptId);
      if (prevCollapseRevealT != null) {
        clearTimeout(prevCollapseRevealT);
        spillCollapseStackRevealRef.current.delete(promptId);
      }
      const prevCollapseOpenCtaT = spillCollapseOpenCtaRef.current.get(promptId);
      if (prevCollapseOpenCtaT != null) {
        clearTimeout(prevCollapseOpenCtaT);
        spillCollapseOpenCtaRef.current.delete(promptId);
      }

      const scheduleExpandStyleCleanup = () => {
        const prevCl = spillExpandStyleCleanupRef.current.get(promptId);
        if (prevCl != null) {
          clearTimeout(prevCl);
          spillExpandStyleCleanupRef.current.delete(promptId);
        }
        const tid = window.setTimeout(() => {
          spillExpandStyleCleanupRef.current.delete(promptId);
          setNodes((prev) => {
            const p = prev.find((x) => x.id === promptId);
            const spill = (p?.data as PromptNodeData | undefined)?.canvasImageSpill;
            const ids = spill?.imageNodeIds ?? [];
            return prev.map((n) => {
              if (n.id === promptId || ids.includes(n.id)) {
                return { ...n, style: undefined };
              }
              return n;
            });
          });
        }, 1120);
        spillExpandStyleCleanupRef.current.set(promptId, tid);
      };

      setNodes((prev) => {
        const resumed = resumeCollapsingSpillExpand(prev);
        if (resumed) {
          spillLastExpandWasResumeRef.current = true;
          return resumed;
        }
        spillLastExpandWasResumeRef.current = false;
        return spawnPhase(prev);
      });

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!spillLastExpandWasResumeRef.current) {
            setNodes((prev) => finalPhase(prev));
          }
          scheduleExpandStyleCleanup();
        });
      });
    },
    [localImageNodeType, setNodes]
  );

  const promptOrder = useMemo(() => nodes.filter((x) => isPromptLikeType(x.type)).map((x) => x.id), [nodes]);
  const promptIndexMap = useMemo(
    () => new Map(promptOrder.map((id, i) => [id, i + 1])),
    [promptOrder]
  );
  const getPromptDisplayIndex = useCallback(
    (nodeId: string) => promptIndexMap.get(nodeId) ?? 1,
    [promptIndexMap]
  );

  const nodesWithHandlers = useMemo(() => {
    return nodes.map((n) => {
      if (isPromptLikeType(n.type)) {
        const dn = n.data as PromptNodeData;

        const incomingImageNodes = edges
          .filter((e) => {
            if (e.target !== n.id || e.targetHandle !== "image_input") return false;
            return isIncomingImageInputSourceAllowed(
              nodeById.get(e.source)?.type,
              n.type,
              localImageNodeType
            );
          })
          .map((e) => e.source);

        const orderedDisplayIds = orderedImageIdsForPrompt(
          incomingImageNodes,
          dn.materialOrder && dn.materialOrder.length > 0 ? dn.materialOrder : (dn.imageOrder ?? [])
        );
        const connectedImages = (() => {
          let imgIdx = 0;
          let vidIdx = 0;
          const out: Array<{
            id: string;
            url: string;
            refIndex: number;
            refType: "image" | "video";
            isVideo: boolean;
            cacheBustKey?: string | number | null;
          }> = [];
          for (const id of orderedDisplayIds) {
            const srcNode = nodeById.get(id);
            if (!srcNode) continue;
            if (srcNode.type === "prompt" || srcNode.type === "process") {
              const sourceHandle =
                edges.find(
                  (edge) =>
                    edge.target === n.id &&
                    edge.targetHandle === "image_input" &&
                    edge.source === srcNode.id
                )?.sourceHandle ?? "output";
              const url = primaryDisplayImageUrlFromSourceNode(srcNode, sourceHandle) ?? "";
              const cacheBustKey = generatedMediaCacheKeyFromSourceNode(srcNode);
              if (!url) continue;
              imgIdx += 1;
              out.push({
                id: srcNode.id,
                url,
                refIndex: imgIdx,
                refType: "image",
                isVideo: false,
                cacheBustKey,
              });
              continue;
            }
            const imgNode = srcNode as Node<LocalImageNodeData>;
            if (imgNode.type !== localImageNodeType) continue;
            const d = imgNode.data;
            const isVideo = isLocalMaterialVideo(imgNode as Node<AppNodeData>);
            if (isVideo) vidIdx += 1;
            else imgIdx += 1;
            out.push({
              id: imgNode.id,
              url: d.imagePreviewUrl || "",
              refIndex: isVideo ? vidIdx : imgIdx,
              refType: isVideo ? "video" : "image",
              isVideo,
            });
          }
          return out.filter((x) => !!x.url);
        })();
        const connectedIdSet = new Set(orderedDisplayIds);
        const canPickCanvasImage = nodes.some((x) => {
          if (x.type !== localImageNodeType) return false;
          if (connectedIdSet.has(x.id)) return false;
          return !isLocalMaterialVideo(x as Node<AppNodeData>);
        });

        return {
          ...n,
          data: {
            ...dn,
            externalApiProviderId:
              isExternalImageApiProviderId(dn.externalApiProviderId)
                ? dn.externalApiProviderId
                : externalApiProviderId,
            externalApiProviderLabel:
              externalApiProviders.find(
                (provider) =>
                  provider.id ===
                  normalizeExternalImageApiProviderId(dn.externalApiProviderId)
              )?.label ??
              (normalizeExternalImageApiProviderId(dn.externalApiProviderId) === "foropencode"
                ? "ForOpenCode"
                : normalizeExternalImageApiProviderId(dn.externalApiProviderId) === "google"
                  ? "Google"
                  : normalizeExternalImageApiProviderId(dn.externalApiProviderId) === "banana2"
                    ? "香蕉生图"
                  : "默认 GPT"),
            externalVideoProviderLabel:
              externalVideoApiDisplayName.trim() || "视频API",
            canvasGraphEpoch,
            onExpandImageResultsToCanvas:
              isPromptLikeType(n.type)
                ? (payload: ExpandImagePayload) => {
                    void expandPromptImageResultsToCanvas(n.id, payload);
                  }
                : undefined,
            onCollapseImageResultsFromCanvas: isPromptLikeType(n.type)
              ? () => collapsePromptImageCanvasSpill(n.id)
              : undefined,
            onPanelPrimaryImageIndexChange: isPromptLikeType(n.type)
              ? (idx: number) => {
                  setNodes((prev) =>
                    prev.map((node) => {
                      if (node.id !== n.id || !isPromptLikeType(node.type)) return node;
                      return {
                        ...node,
                        data: {
                          ...(node.data as PromptNodeData),
                          promptPanelPrimaryImageIndex: idx,
                        },
                      };
                    })
                  );
                }
              : undefined,
            onPersistPanelOutput: (p: { urls: string[]; firstUrl: string | null }) =>
              persistPromptPanelOutput(n.id, p),
            onRuntimeStateChange: (patch: {
              isLoading?: boolean;
              error?: string | null;
              streamStatusLine?: string | null;
              streamProgressPct?: number;
              streamInQueue?: boolean;
              lastSubmitId?: string | null;
              resumeGenSourceNodeId?: string | null;
            }) =>
              setNodes((prev) =>
                {
                  let changed = false;
                  const next = prev.map((x) => {
                    if (x.id !== n.id || !isPromptLikeType(x.type)) return x;
                    const current = x.data as PromptNodeData;
                    if (
                      current.isLoading === patch.isLoading &&
                      (current.error ?? null) === (patch.error ?? null) &&
                      (current.streamStatusLine ?? null) === (patch.streamStatusLine ?? null) &&
                      current.streamProgressPct === patch.streamProgressPct &&
                      current.streamInQueue === patch.streamInQueue &&
                      (current.lastSubmitId ?? null) === (patch.lastSubmitId ?? null) &&
                      (current.resumeGenSourceNodeId ?? null) ===
                        (patch.resumeGenSourceNodeId ?? null)
                    ) {
                      return x;
                    }
                    changed = true;
                    return {
                      ...x,
                      data: {
                        ...current,
                        ...patch,
                      },
                    };
                  });
                  return changed ? next : prev;
                }
              ),
            onGenerate: handleGenerate,
            panelOpen: activePanelNodeId === n.id,
            onOpenPanel: () => setActivePanelNodeId(n.id),
            panelDisplayMode:
              dn.panelDisplayMode === "dock-right" ? "dock-right" : "floating",
            onPanelDisplayModeChange: (mode: PromptPanelMode) => {
              setNodes((prev) =>
                prev.map((x) => {
                  if (x.id !== n.id || !isPromptLikeType(x.type)) return x;
                  return {
                    ...x,
                    data: {
                      ...(x.data as PromptNodeData),
                      panelDisplayMode: mode,
                    },
                  };
                })
              );
            },
            dockPanelMode: dn.dockPanelMode === "compact" ? "compact" : "expanded",
            onDockPanelModeChange: (mode: PromptDockMode) => {
              setNodes((prev) =>
                prev.map((x) => {
                  if (x.id !== n.id || !isPromptLikeType(x.type)) return x;
                  return {
                    ...x,
                    data: {
                      ...(x.data as PromptNodeData),
                      dockPanelMode: mode,
                    },
                  };
                })
              );
            },
            onAddImageNode: (file: File) => addLocalImageNode(file, n.id),
            onPromptTextChange: (promptText: string) => {
              setNodes((prev) =>
                {
                  let changed = false;
                  const next = prev.map((x) => {
                    if (x.id !== n.id || !isPromptLikeType(x.type)) return x;
                    const current = x.data as PromptNodeData;
                    if (current.promptText === promptText) return x;
                    changed = true;
                    return { ...x, data: { ...current, promptText } };
                  });
                  return changed ? next : prev;
                }
              );
            },
            onPromptSettingsChange: (patch: {
              imageProvider?: "dreamina" | "aiwanwu";
              externalApiProviderId?: ExternalImageApiProviderId;
              imageQuality?: "standard" | "high" | "hd";
              videoProvider?: "dreamina" | "external_api";
              modelVersion?: string;
              ratio?: string;
              resolutionType?: string;
              count?: number;
              durationSeconds?: number;
              withAudio?: boolean;
              referenceMode?: "general" | "headtail";
              lastCostPerImage?: number | null;
            }) => {
              setNodes((prev) =>
                {
                  let changed = false;
                  const next = prev.map((x) => {
                    if (x.id !== n.id || !isPromptLikeType(x.type)) return x;
                    const current = x.data as PromptNodeData;
                    const nodeChanged = Object.keys(patch).some((key) => {
                      const field = key as keyof typeof patch & keyof PromptNodeData;
                      return current[field] !== patch[field];
                    });
                    if (!nodeChanged) return x;
                    changed = true;
                    return {
                      ...x,
                      data: {
                        ...current,
                        ...patch,
                      },
                    };
                  });
                  return changed ? next : prev;
                }
              );
            },
            promptIndex: getPromptDisplayIndex(n.id),
            generationMode: n.type === "prompt2" ? "video" : "image",
            nodeName:
              n.type === "prompt2"
                ? `视频节点${getPromptDisplayIndex(n.id)}`
                : `生图节点${getPromptDisplayIndex(n.id)}`,
            zoomLevel: viewportZoom,
            connectedImages,
            onDisconnectImage: (imageNodeId: string) => {
              setEdges((prev) =>
                prev.filter(
                  (e) =>
                    !(
                      e.source === imageNodeId &&
                      e.target === n.id &&
                      e.targetHandle === "image_input"
                    )
                )
              );
              setNodes((prev) =>
                prev.map((node) => {
                  if (node.id !== n.id || !isPromptLikeType(node.type)) return node;
                  const d = node.data as PromptNodeData;
                  return {
                    ...node,
                    data: {
                      ...d,
                      imageOrder: (d.imageOrder ?? []).filter((id) => id !== imageNodeId),
                      videoOrder: (d.videoOrder ?? []).filter((id) => id !== imageNodeId),
                      materialOrder: (d.materialOrder ?? []).filter((id) => id !== imageNodeId),
                    },
                  };
                })
              );
            },
            onReorderConnectedImages: (newOrder: string[]) => {
              setNodes((prev) =>
                prev.map((node) => {
                  if (node.id !== n.id || !isPromptLikeType(node.type)) return node;
                  const d = node.data as PromptNodeData;
                  const incoming = edges
                    .filter((ed) => {
                      if (ed.target !== n.id || ed.targetHandle !== "image_input") return false;
                      return isIncomingImageInputSourceAllowed(
                        nodeById.get(ed.source)?.type,
                        n.type,
                        localImageNodeType
                      );
                    })
                    .map((ed) => ed.source);
                  const setIncoming = new Set(incoming);
                  const nextMaterial = newOrder.filter((id) => setIncoming.has(id));
                  if (nextMaterial.length !== incoming.length) return node;
                  const nextImage = nextMaterial.filter((id) => {
                    const nn = nodeById.get(id);
                    if (!nn) return false;
                    if (nn.type === "prompt" || nn.type === "process") return true;
                    if (nn.type === localImageNodeType) return !isLocalMaterialVideo(nn);
                    return false;
                  });
                  const nextVideo = nextMaterial.filter(
                    (id) =>
                      nodeById.get(id)?.type === localImageNodeType &&
                      isLocalMaterialVideo(nodeById.get(id))
                  );
                  return {
                    ...node,
                    data: {
                      ...d,
                      materialOrder: nextMaterial,
                      imageOrder: nextImage,
                      videoOrder: nextVideo,
                    },
                  };
                })
              );
            },
            onRequestPickCanvasImage: () => {
              setPickImageForPromptId(n.id);
              setActivePanelNodeId(n.id);
            },
            isPickingCanvasImage: pickImageForPromptId === n.id,
            canPickCanvasImage,
          },
        };
      }
      if (n.type === "video") {
        const dn = n.data as VideoNodeData;
        const incomingImageNodes = edges
          .filter((e) => {
            if (e.target !== n.id || e.targetHandle !== "image_input") return false;
            return isIncomingImageInputSourceAllowed(
              nodeById.get(e.source)?.type,
              n.type,
              localImageNodeType
            );
          })
          .map((e) => e.source);
        const orderedDisplayIds = orderedImageIdsForPrompt(
          incomingImageNodes,
          dn.materialOrder && dn.materialOrder.length > 0 ? dn.materialOrder : (dn.imageOrder ?? [])
        );
        const connectedImages = (() => {
          let imgIdx = 0;
          let vidIdx = 0;
          const out: Array<{
            id: string;
            url: string;
            refIndex: number;
            refType: "image" | "video";
            isVideo: boolean;
            cacheBustKey?: string | number | null;
          }> = [];
          for (const id of orderedDisplayIds) {
            const srcNode = nodeById.get(id);
            if (!srcNode) continue;
            if (srcNode.type === "prompt" || srcNode.type === "process") {
              const sourceHandle =
                edges.find(
                  (edge) =>
                    edge.target === n.id &&
                    edge.targetHandle === "image_input" &&
                    edge.source === srcNode.id
                )?.sourceHandle ?? "output";
              const url = primaryDisplayImageUrlFromSourceNode(srcNode, sourceHandle) ?? "";
              const cacheBustKey = generatedMediaCacheKeyFromSourceNode(srcNode);
              if (!url) continue;
              imgIdx += 1;
              out.push({
                id: srcNode.id,
                url,
                refIndex: imgIdx,
                refType: "image",
                isVideo: false,
                cacheBustKey,
              });
              continue;
            }
            const imgNode = srcNode as Node<LocalImageNodeData>;
            if (imgNode.type !== localImageNodeType) continue;
            const d = imgNode.data;
            const isVideo = isLocalMaterialVideo(imgNode as Node<AppNodeData>);
            if (isVideo) vidIdx += 1;
            else imgIdx += 1;
            out.push({
              id: imgNode.id,
              url: d.imagePreviewUrl || "",
              refIndex: isVideo ? vidIdx : imgIdx,
              refType: isVideo ? "video" : "image",
              isVideo,
            });
          }
          return out.filter((x) => !!x.url);
        })();
        const connectedIdSet = new Set(orderedDisplayIds);
        const canPickCanvasImage = nodes.some((x) => {
          if (x.type !== localImageNodeType) return false;
          if (connectedIdSet.has(x.id)) return false;
          return !isLocalMaterialVideo(x as Node<AppNodeData>);
        });
        return {
          ...n,
          data: {
            ...dn,
            zoomLevel: viewportZoom,
            panelOpen: activePanelNodeId === n.id,
            onOpenPanel: () => setActivePanelNodeId(n.id),
            onClosePanel: () => {
              setActivePanelNodeId((prev) => (prev === n.id ? null : prev));
            },
            onPromptTextChange: (text: string) => {
              setNodes((prev) =>
                prev.map((node) => {
                  if (node.id !== n.id || node.type !== "video") return node;
                  const d = node.data as VideoNodeData;
                  return { ...node, data: { ...d, promptText: text } };
                })
              );
            },
            onPromptSettingsChange: (patch: {
              modelVersion?: string;
              ratio?: string;
              resolutionType?: string;
              count?: number;
              durationSeconds?: number;
              withAudio?: boolean;
            }) => {
              setNodes((prev) =>
                prev.map((node) => {
                  if (node.id !== n.id || node.type !== "video") return node;
                  const d = node.data as VideoNodeData;
                  return { ...node, data: { ...d, ...patch } };
                })
              );
            },
            onGenerate: handleGenerate,
            connectedImages,
            onDisconnectImage: (imageNodeId: string) => {
              setEdges((prev) =>
                prev.filter(
                  (e) =>
                    !(
                      e.source === imageNodeId &&
                      e.target === n.id &&
                      e.targetHandle === "image_input"
                    )
                )
              );
              setNodes((prev) =>
                prev.map((node) => {
                  if (node.id !== n.id || node.type !== "video") return node;
                  const d = node.data as VideoNodeData;
                  return {
                    ...node,
                    data: {
                      ...d,
                      imageOrder: (d.imageOrder ?? []).filter((id) => id !== imageNodeId),
                      videoOrder: (d.videoOrder ?? []).filter((id) => id !== imageNodeId),
                      materialOrder: (d.materialOrder ?? []).filter((id) => id !== imageNodeId),
                    },
                  };
                })
              );
            },
            onReorderConnectedImages: (newOrder: string[]) => {
              setNodes((prev) =>
                prev.map((node) => {
                  if (node.id !== n.id || node.type !== "video") return node;
                  const d = node.data as VideoNodeData;
                  const incoming = edges
                    .filter((ed) => {
                      if (ed.target !== n.id || ed.targetHandle !== "image_input") return false;
                      return isIncomingImageInputSourceAllowed(
                        nodeById.get(ed.source)?.type,
                        n.type,
                        localImageNodeType
                      );
                    })
                    .map((ed) => ed.source);
                  const setIncoming = new Set(incoming);
                  const nextMaterial = newOrder.filter((id) => setIncoming.has(id));
                  if (nextMaterial.length !== incoming.length) return node;
                  const nextImage = nextMaterial.filter((id) => {
                    const nn = nodeById.get(id);
                    if (!nn) return false;
                    if (nn.type === "prompt" || nn.type === "process") return true;
                    if (nn.type === localImageNodeType) return !isLocalMaterialVideo(nn);
                    return false;
                  });
                  const nextVideo = nextMaterial.filter(
                    (id) =>
                      nodeById.get(id)?.type === localImageNodeType &&
                      isLocalMaterialVideo(nodeById.get(id))
                  );
                  return {
                    ...node,
                    data: {
                      ...d,
                      materialOrder: nextMaterial,
                      imageOrder: nextImage,
                      videoOrder: nextVideo,
                    },
                  };
                })
              );
            },
            onRequestPickCanvasImage: () => {
              setPickImageForPromptId(n.id);
              setActivePanelNodeId(n.id);
            },
            canPickCanvasImage,
          },
        };
      }
      if (n.type === "process") {
        const dn = n.data as ImageProcessNodeData;
        const inputSourceId =
          edges.find(
            (edge) =>
              edge.target === n.id &&
              edge.targetHandle === "image_input" &&
              isIncomingImageInputSourceAllowed(
                nodeById.get(edge.source)?.type,
                n.type,
                localImageNodeType
              )
          )?.source ?? null;
        const inputNode = inputSourceId ? nodeById.get(inputSourceId) : null;
        const connectedInput =
          inputNode && primaryDisplayImageUrlFromSourceNode(inputNode)
            ? {
                id: inputNode.id,
                url: primaryDisplayImageUrlFromSourceNode(inputNode)!,
                cacheBustKey: generatedMediaCacheKeyFromSourceNode(inputNode),
                label:
                  inputNode.type === "prompt"
                    ? "生图结果"
                    : inputNode.type === "process"
                      ? "处理结果"
                      : "本地素材",
              }
            : null;

        return {
          ...n,
          data: {
            ...dn,
            zoomLevel: viewportZoom,
            connectedInput,
            onRunProcess: handleProcess,
            providerId: externalApiProviderId,
            modelVersion:
              typeof dn.modelVersion === "string" && dn.modelVersion.trim()
                ? dn.modelVersion
                : externalApiImageModel ||
                  defaultExternalImageModelForProvider(externalApiProviderId),
            availableModels: Array.from(
              new Set([
                ...(externalApiModelOptions.length > 0
                  ? externalApiModelOptions
                  : externalImageModelFallbacksForProvider(externalApiProviderId)),
                ...(typeof dn.modelVersion === "string" && dn.modelVersion.trim()
                  ? [dn.modelVersion.trim()]
                  : []),
                ...(externalApiImageModel ? [externalApiImageModel] : []),
              ])
            ),
            onImportOutputsAsMaterials: () => {
              void importProcessOutputsAsMaterials(n.id);
            },
            onDataChange: (patch: Partial<ImageProcessNodeData>) => {
              setNodes((prev) =>
                prev.map((node) =>
                  node.id === n.id && node.type === "process"
                    ? {
                        ...node,
                        data: {
                          ...(node.data as ImageProcessNodeData),
                          ...patch,
                        },
                      }
                    : node
                )
              );
            },
          },
        };
      }
      if (n.type === "group") {
        const dn = n.data as GroupNodeData;
        return {
          ...n,
          data: {
            ...dn,
            onUngroup: () => ungroupNode(n.id),
            onFrameColorChange: (hex: string) => {
              setNodes((prev) =>
                prev.map((x) =>
                  x.id === n.id && x.type === "group"
                    ? {
                        ...x,
                        data: { ...(x.data as GroupNodeData), frameColor: hex },
                      }
                    : x
                )
              );
            },
            onArmGroupCanvasDrag:
              !dn.groupCanvasDragArmed
                ? () => {
                    setNodes((prev) =>
                      prev.map((node) =>
                        node.id === n.id && node.type === "group"
                          ? {
                              ...node,
                              draggable: true,
                              data: {
                                ...(node.data as GroupNodeData),
                                groupCanvasDragArmed: true,
                              },
                            }
                          : node
                      )
                    );
                  }
                : undefined,
          },
        };
      }
      return n;
    });
  }, [
    nodes,
    edges,
    nodeById,
    handleGenerate,
    handleProcess,
    importProcessOutputsAsMaterials,
    activePanelNodeId,
    addLocalImageNode,
    localImageNodeType,
    setEdges,
    setNodes,
    pickImageForPromptId,
    ungroupNode,
    viewportZoom,
    canvasGraphEpoch,
    externalApiImageModel,
    externalApiModelOptions,
    externalApiProviderId,
    externalApiProviders,
    externalVideoApiDisplayName,
    persistPromptPanelOutput,
    collapsePromptImageCanvasSpill,
    expandPromptImageResultsToCanvas,
  ]);

  const nodesWithRefIndex = useMemo(() => {
    const refMap = new Map<string, number>();
    const promptNodes = nodes.filter((n) => isPromptLikeType(n.type));
    for (const p of promptNodes) {
      const incomingImageNodes = edges
        .filter(
          (e) =>
            e.target === p.id &&
            e.targetHandle === "image_input" &&
            nodeById.get(e.source)?.type === localImageNodeType
        )
        .map((e) => e.source);
      const pd = p.data as PromptNodeData | undefined;
      const orderedIds = orderedImageIdsForPrompt(
        incomingImageNodes,
        storedMaterialOrderForPrompt(pd)
      );
      let imageIdx = 0;
      let videoIdx = 0;
      orderedIds.forEach((id) => {
        if (refMap.has(id)) return;
        const isVideo = isLocalMaterialVideo(nodeById.get(id));
        if (isVideo) videoIdx += 1;
        else imageIdx += 1;
        refMap.set(id, isVideo ? videoIdx : imageIdx);
      });
    }
    return nodesWithHandlers.map((n) => {
      if (n.type !== localImageNodeType) return n;
      const refIndex = refMap.get(n.id) ?? null;
      const d = n.data as LocalImageNodeData;
      const spillPrompt = d.generatedSpillPromptId
        ? nodeById.get(d.generatedSpillPromptId)
        : undefined;
      const primaryIx = (spillPrompt?.data as PromptNodeData | undefined)
        ?.promptPanelPrimaryImageIndex;
      const isPrimarySpill =
        typeof d.generatedSpillUrlIndex === "number" && typeof primaryIx === "number"
          ? primaryIx === d.generatedSpillUrlIndex
          : false;
      return {
        ...n,
        data: {
          ...d,
          refIndex,
          generatedSpillIsPrimary: isPrimarySpill,
          zoomLevel: viewportZoom,
          onDelete: () => deleteLocalImageNode(n.id),
          onLoadImage: (file: File) => loadLocalImageIntoNode(n.id, file),
          onSetPrimaryGeneratedOutput:
            d.generatedSpillPromptId != null &&
            typeof d.generatedSpillUrlIndex === "number" &&
            !d.generatedSpillPending
              ? () => {
                  const pid = d.generatedSpillPromptId!;
                  const uix = d.generatedSpillUrlIndex!;
                  setNodes((prev) => runSpillSetPrimary(prev, pid, uix, setNodes));
                }
              : undefined,
        },
      };
    });
  }, [
    edges,
    nodesWithHandlers,
    nodeById,
    nodes,
    localImageNodeType,
    deleteLocalImageNode,
    loadLocalImageIntoNode,
    viewportZoom,
    setNodes,
  ]);

  const nodesForRf = useMemo(() => {
    const refById = new Map(nodesWithRefIndex.map((nd) => [nd.id, nd]));
    /** 閸氬瞼琚崹瀣Ν閻愮懓褰旈弨鎾呯窗閺佹壆绮嶆稉顓＄Ш闂堢姴鎮楅惃鍕Ш妤傛﹫绱遍柅澶夎厬閹存牓鈧本娓舵潻鎴犲仯閸戣崵鐤嗘い韬测偓宥呭晙婢堆冪畽閹额剟鐝?*/
    const layered = nodesWithRefIndex.map((n, i) => {
      const isTextPanelNode = isPromptLikeType(n.type) || n.type === "video";
      const isActive = activePanelNodeId === n.id;
      const onTop = Boolean(n.selected) || n.id === canvasStackFrontId;
      const stack = Math.min(i, 600);
      if (!isTextPanelNode) {
        let z = (n.type === "group" ? 42 : 80) + stack;
        let spillCollapsing = false;
        const spillLocal =
          n.type === localImageNodeType ? (n.data as LocalImageNodeData) : null;
        if (spillLocal) {
          const d = spillLocal;
          if (typeof d.generatedSpillUrlIndex === "number" && d.generatedSpillPromptId) {
            const pp = refById.get(d.generatedSpillPromptId);
            spillCollapsing = Boolean(
              (pp?.data as PromptNodeData | undefined)?.canvasImageSpill?.collapseAnim
            );
            if (spillCollapsing) {
              z = 38 + Math.min(stack, 160);
            }
          }
        }
        if (onTop && !spillCollapsing) z += 8000;
        if (spillLocal?.generatedSpillPromptId) {
          const parentPd = refById.get(spillLocal.generatedSpillPromptId)?.data as
            | PromptNodeData
            | undefined;
          const spillIds = parentPd?.canvasImageSpill?.imageNodeIds;
          if (
            spillCanvasGridStackOnTop(parentPd) &&
            Array.isArray(spillIds) &&
            spillIds.includes(n.id)
          ) {
            z += CANVAS_SPILL_GRID_Z_BOOST;
          }
        }
        const base = { ...n, zIndex: z };
        if (n.type === localImageNodeType) {
          const d = n.data as LocalImageNodeData;
          return {
            ...base,
            draggable: d.generatedSpillPending !== true,
            dragHandle: JIMENG_RF_DRAG_HANDLE_SELECTOR,
          };
        }
        if (n.type === "group") {
          const gd = n.data as GroupNodeData;
          return {
            ...base,
            draggable: gd.groupCanvasDragArmed === true,
          };
        }
        return base;
      }
      let z = 200 + stack;
      if (isActive) z += 700;
      if (onTop) z += 8000;
      if (isPromptLikeType(n.type)) {
        const pd = n.data as PromptNodeData;
        if (pd.canvasImageSpill?.collapseAnim) {
          z += 6500;
        }
        if (spillCanvasGridStackOnTop(pd)) {
          z += CANVAS_SPILL_GRID_Z_BOOST;
        }
        const prevStyle =
          typeof n.style === "object" && n.style ? n.style : undefined;
        const { handleRowW } = computePromptPreviewShellDimensions(pd.ratio ?? "16:9");
        /** 闁夸礁鐣?RF 閼哄倻鍋ｉ柌蹇旂ゴ濡楀棴绱伴柆鍨帳閻㈢喐鍨氭稉顓熷閸?濞翠礁鍘滈幘鎴︾彯 wrapper 鐎佃壈鍤ч弫鏉戝幢閿涘牆鎯堟稉濠氼暕鐟欏牞绱氱憴鍡氼潕娑撳﹣缍呯粔?*/
        return {
          ...n,
          zIndex: z,
          draggable: true,
          dragHandle: JIMENG_RF_DRAG_HANDLE_SELECTOR,
          style: {
            ...prevStyle,
            pointerEvents: "none" as const,
            width: handleRowW,
            height: PROMPT_PREVIEW_BAND_H,
          },
        };
      }
      if (n.type === "video") {
        const vd = n.data as VideoNodeData;
        const prevStyle =
          typeof n.style === "object" && n.style ? n.style : undefined;
        return {
          ...n,
          zIndex: z,
          draggable: true,
          dragHandle: JIMENG_RF_DRAG_HANDLE_SELECTOR,
          style: { ...prevStyle, pointerEvents: "none" as const },
        };
      }
      return { ...n, zIndex: z };
    });
    if (!pickImageForPromptId) return layered;
    const connectedToPrompt = new Set(
      edges
        .filter(
          (e) =>
            e.target === pickImageForPromptId &&
            e.targetHandle === "image_input" &&
            nodeById.get(e.source)?.type === localImageNodeType
        )
        .map((e) => e.source)
    );
    return layered.map((n) => {
      if (n.type === localImageNodeType) {
        const prev = n.className?.trim() ?? "";
        const isConnected = connectedToPrompt.has(n.id);
        const d = n.data as LocalImageNodeData;
        const hasPreview = Boolean(d.imagePreviewUrl);
        const isVideo = isLocalMaterialVideo(n as Node<AppNodeData>);
        const activeCandidate = !hasPreview && !isConnected && !isVideo;
        const blurState = !activeCandidate;
        const spillPick = {
          draggable: d.generatedSpillPending !== true,
          dragHandle: JIMENG_RF_DRAG_HANDLE_SELECTOR,
        };
        return {
          ...n,
          ...spillPick,
          className: prev
            ? `${prev} ${
                blurState
                  ? "canvas-pick-image-connected"
                  : "canvas-pick-image-flow"
              }`
            : blurState
              ? "canvas-pick-image-connected"
              : "canvas-pick-image-flow",
        };
      }
      if (n.id === pickImageForPromptId) return n;
      const prev = n.className?.trim() ?? "";
      return { ...n, className: prev ? `${prev} canvas-pick-dim` : "canvas-pick-dim" };
    });
  }, [
    nodesWithRefIndex,
    pickImageForPromptId,
    localImageNodeType,
    edges,
    nodeById,
    activePanelNodeId,
    canvasStackFrontId,
  ]);

  useEffect(() => {
    if (!canvasStackFrontId) return;
    if (!nodes.some((n) => n.id === canvasStackFrontId)) {
      setCanvasStackFrontId(null);
    }
  }, [nodes, canvasStackFrontId]);

  useEffect(() => {
    if (!pickImageForPromptId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPickImageForPromptId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickImageForPromptId]);

  const onNodeClickPickImage = useCallback(
    (evt: React.MouseEvent, node: Node<AppNodeData>) => {
      if (!pickImageForPromptId) {
        const multi = evt.ctrlKey || evt.metaKey;
        setNodes((prev) =>
          prev.map((n) =>
            n.id === node.id
              ? { ...n, selected: multi ? !Boolean((n as any).selected) : true }
              : multi
                ? n
                : { ...n, selected: false }
          )
        );
        return;
      }
      if (node.type !== localImageNodeType) {
        setPickImageForPromptId(null);
        return;
      }
      const d = node.data as LocalImageNodeData;
      if (isLocalMaterialVideo(node as Node<AppNodeData>)) {
        return;
      }
      const alreadyConnected = edges.some(
        (e) =>
          e.source === node.id &&
          e.target === pickImageForPromptId &&
          e.targetHandle === "image_input"
      );
      if (alreadyConnected) return;
      connectCanvasImageToPrompt(node.id, pickImageForPromptId);
      setPickImageForPromptId(null);
    },
    [pickImageForPromptId, localImageNodeType, connectCanvasImageToPrompt, edges, setNodes]
  );

  // 閺冄呮畱閳ユ粎娲块幒銉ょ瑐娴肩姭鈧繃绁︾粙瀣嚒閺囨寧宕叉稉鐚寸窗閻愮懓鍤崚娑樼紦缁岃櫣娅ч懞鍌滃仯閿涘苯寮婚崙鏄忓Ν閻愮懓鍞撮崝鐘烘祰閸ュ墽澧?
  const createPromptNodeWithOutput = useCallback(() => {
    appendStandaloneCanvasNode("prompt", getFlowPositionForNewNode());
  }, [appendStandaloneCanvasNode, getFlowPositionForNewNode]);

  const createPromptNode2WithOutput = useCallback(() => {
    appendStandaloneCanvasNode("prompt2", getFlowPositionForNewNode());
  }, [appendStandaloneCanvasNode, getFlowPositionForNewNode]);

  const createTextNode = useCallback(() => {
    appendStandaloneCanvasNode("text", getFlowPositionForNewNode());
  }, [appendStandaloneCanvasNode, getFlowPositionForNewNode]);

  const createProcessNode = useCallback(() => {
    appendStandaloneCanvasNode("process", getFlowPositionForNewNode());
  }, [appendStandaloneCanvasNode, getFlowPositionForNewNode]);

  const createQuickConnectedNode = useCallback((kind: QuickCreateKind) => {
    if (!quickConnectDraft) return;
    const sourceNode = nodeById.get(quickConnectDraft.source);
    if (!sourceNode) {
      setQuickConnectDraft(null);
      return;
    }
    const targetType = kind === "process" ? "process" : kind;
    const isVideoMaterial = sourceNode.type === localImageNodeType && isLocalMaterialVideo(sourceNode);
    if (kind === "process" && isVideoMaterial) {
      setQuickConnectDraft(null);
      return;
    }
    if (
      !isIncomingImageInputSourceAllowed(
        sourceNode.type,
        targetType,
        localImageNodeType
      )
    ) {
      setQuickConnectDraft(null);
      return;
    }

    const flowPos = screenToFlow(quickConnectDraft.point);
    const targetId = createCanvasNodeId(kind);
    const materialOrder = [quickConnectDraft.source];
    let newNode: Node<AppNodeData>;

    if (kind === "prompt") {
      newNode = {
        id: targetId,
        type: "prompt",
        position: flowPos,
        data: {
          promptText: "",
          imageProvider: "aiwanwu",
          externalApiProviderId,
          modelVersion: "5.0",
          ratio: "16:9",
          resolutionType: "2k",
          count: 4,
          materialOrder,
          imageOrder: isVideoMaterial ? [] : materialOrder,
          videoOrder: isVideoMaterial ? materialOrder : [],
        } as PromptNodeData,
      };
    } else if (kind === "prompt2") {
      newNode = {
        id: targetId,
        type: "prompt2",
        position: flowPos,
        data: {
          nodeName: "视频生成节点",
          generationMode: "video",
          videoProvider: "external_api",
          referenceMode: "general",
          promptText: "",
          modelVersion: "seedance2.0fast",
          ratio: "16:9",
          resolutionType: "720p",
          count: 1,
          durationSeconds: 5,
          withAudio: false,
          materialOrder,
          imageOrder: isVideoMaterial ? [] : materialOrder,
          videoOrder: isVideoMaterial ? materialOrder : [],
        } as PromptNodeData,
      };
    } else {
      newNode = {
        id: targetId,
        type: "process",
        position: flowPos,
        data: {
          nodeName: "编辑",
          operation: "outpaint",
          panelOpen: true,
          providerId: externalApiProviderId,
          modelVersion:
            externalApiImageModel ||
            defaultExternalImageModelForProvider(externalApiProviderId),
          promptText: "",
          expandDirection: "all",
          expandPercent: 25,
          upscaleFactor: 2,
          imageUrls: [],
          outputSlots: [null, null, null, null, null],
          activeOutputSlot: 0,
          operationOutputState: {
            outpaint: {
              imageUrls: [],
              outputSlots: [null, null, null, null, null],
              activeOutputSlot: 0,
            },
          },
          error: null,
          isLoading: false,
          maskBrushSize: 24,
          multiviewYaw: 0,
          multiviewPitch: 0,
          multiviewZoom: 100,
          multiviewShiftX: 0,
          multiviewShiftY: 0,
        } as ImageProcessNodeData,
      };
    }

    setNodes((prev) => [...prev.map((node) => ({ ...node, selected: false })), { ...newNode, selected: true }]);
    setEdges((prev) => {
      const base =
        kind === "process"
          ? prev.filter((edge) => !(edge.target === targetId && edge.targetHandle === "image_input"))
          : prev;
      return addEdge(
        {
          id: `e-${quickConnectDraft.source}-${targetId}-${Date.now()}`,
          source: quickConnectDraft.source,
          sourceHandle: quickConnectDraft.sourceHandle ?? "output",
          target: targetId,
          targetHandle: "image_input",
          type: CANVAS_EDGE_TYPE,
        },
        base
      );
    });
    setActivePanelNodeId(kind === "process" ? null : targetId);
    setQuickConnectDraft(null);
  }, [
    externalApiImageModel,
    externalApiProviderId,
    localImageNodeType,
    nodeById,
    quickConnectDraft,
    screenToFlow,
    setEdges,
    setNodes,
  ]);

  const loadHistoryEntryToCanvas = useCallback(
    (
      entry: GenerationHistoryEntry,
      options?: {
        flowPos?: { x: number; y: number };
        keepHistoryOpen?: boolean;
      }
    ) => {
      const flowPos = options?.flowPos ?? getFlowPositionForNewNode();
      const keepHistoryOpen = options?.keepHistoryOpen === true;
      if (entry.sourceKind === "process" && entry.mediaType === "image") {
        const imageNodeId = createCanvasNodeId("img");
        const cleanOut = stripHashOnly(entry.outputUrl);
        const imageNode: Node<AppNodeData> = {
          id: imageNodeId,
          type: localImageNodeType,
          position: { x: flowPos.x, y: flowPos.y },
          data: {
            imagePreviewUrl: cleanOut || null,
            imageFile: null,
            refIndex: null,
          } as LocalImageNodeData,
        };
        setNodes((prev) => [
          ...prev.map((n) => ({ ...n, selected: false })),
          { ...imageNode, selected: true },
        ]);
        setActivePanelNodeId(null);
        if (!keepHistoryOpen) {
          setMediaHistoryOpen(false);
        }
        return;
      }

      const baseX = flowPos.x;
      const baseY = flowPos.y;
      const isVideo = entry.mediaType === "video";
      const promptId = createCanvasNodeId(isVideo ? "prompt2" : "prompt");
      const videoNodeId = isVideo ? createCanvasNodeId("video") : null;

      const cleanOut = stripHashOnly(entry.outputUrl);
      const panelOut: Pick<
        PromptNodeData,
        "persistedPanelImageUrls" | "persistedPanelFirstImageUrl" | "promptPanelPrimaryImageIndex"
      > = {
        persistedPanelImageUrls: [cleanOut],
        persistedPanelFirstImageUrl: null,
        promptPanelPrimaryImageIndex: 0,
      };
      const refUrls = entry.referenceThumbDataUrls ?? [];
      const refIds = refUrls.map(() => createCanvasNodeId("img"));

      const refNodes: Node<AppNodeData>[] = refUrls.map((_, i) => ({
        id: refIds[i]!,
        type: localImageNodeType,
        position: { x: baseX - 200, y: baseY - 40 + i * 130 },
        data: {
          imagePreviewUrl: null,
          imageFile: null,
          refIndex: null,
        } as LocalImageNodeData,
      }));

      const promptNode: Node<AppNodeData> = isVideo
        ? {
            id: promptId,
            type: "prompt2",
            position: { x: baseX, y: baseY },
            data: {
              nodeName: "视频生成节点",
              generationMode: "video",
              videoProvider: entry.videoProvider === "external_api" ? "external_api" : "external_api",
              referenceMode: entry.referenceMode ?? "general",
              promptText: entry.promptText ?? "",
              modelVersion: entry.modelVersion ?? "seedance2.0fast",
              ratio: entry.ratio ?? "16:9",
              resolutionType: entry.resolutionType ?? "720p",
              count: typeof entry.count === "number" ? entry.count : 1,
              durationSeconds:
                typeof entry.durationSeconds === "number" ? entry.durationSeconds : 5,
              withAudio: entry.withAudio === true,
              materialOrder: refIds.length ? [...refIds] : [],
              imageOrder: refIds.length ? [...refIds] : [],
              videoOrder: [],
              ...panelOut,
            } as PromptNodeData,
          }
        : {
            id: promptId,
            type: "prompt",
            position: { x: baseX, y: baseY },
            data: {
              promptText: entry.promptText ?? "",
              modelVersion: entry.modelVersion ?? "5.0",
              ratio: entry.ratio ?? "16:9",
              resolutionType: entry.resolutionType ?? "2k",
              count: typeof entry.count === "number" ? entry.count : 4,
              materialOrder: refIds.length ? [...refIds] : [],
              imageOrder: refIds.length ? [...refIds] : [],
              ...panelOut,
            } as PromptNodeData,
          };

      const outputNode: Node<AppNodeData> | null =
        isVideo && videoNodeId
          ? ({
              id: videoNodeId,
              type: "video",
              position: { x: baseX + 520, y: baseY },
              data: {
                imageUrls: cleanOut ? [cleanOut] : [],
                isLoading: false,
                error: null,
                expectedCount: 1,
                ratio: entry.ratio ?? "16:9",
                durationSeconds:
                  typeof entry.durationSeconds === "number" ? entry.durationSeconds : 5,
                withAudio: entry.withAudio === true,
              } as VideoNodeData,
            } as Node<AppNodeData>)
          : null;

      setNodes((prev) => [
        ...prev.map((n) => ({ ...n, selected: false })),
        ...refNodes,
        promptNode,
        ...(outputNode ? [outputNode] : []),
      ]);

      setEdges((prev) => {
        let next = prev;
        for (const imgId of refIds) {
          next = addEdge(
            {
              id: `e-${imgId}-${promptId}-hist`,
              source: imgId,
              target: promptId,
              sourceHandle: "output",
              targetHandle: "image_input",
              type: CANVAS_EDGE_TYPE,
            },
            next
          );
        }
        if (isVideo && videoNodeId) {
          next = addEdge(
            {
              id: `e-${promptId}-${videoNodeId}-hist-output`,
              source: promptId,
              target: videoNodeId,
              sourceHandle: "output",
              targetHandle: "input",
              type: CANVAS_EDGE_TYPE,
            },
            next
          );
        }
        return next;
      });

      void (async () => {
        for (let i = 0; i < refUrls.length; i++) {
          const id = refIds[i];
          const u = refUrls[i];
          if (!id || !u) continue;
          try {
            const res = await fetch(u);
            const blob = await res.blob();
            const file = new File([blob], `hist-ref-${i}.jpg`, {
              type: blob.type && blob.type.startsWith("image/") ? blob.type : "image/jpeg",
            });
            loadLocalImageIntoNode(id, file);
          } catch {
            /* ignore */
          }
        }

        const rel = extractGeneratedFileName(cleanOut);
        if (!rel || rel.startsWith(".backup/")) return;
        const backup = await backupGeneratedMediaToCache(
          promptId,
          isVideo ? "video" : "image",
          [cleanOut]
        ).catch(() => null);
        const snapUrl =
          backup && backup.ok && Array.isArray(backup.files) && typeof backup.files[0] === "string"
            ? backup.files[0].trim()
            : "";
        if (!snapUrl) return;

        setNodes((prev) =>
          prev.map((node) => {
            if (node.id === promptId && isPromptLikeType(node.type)) {
              const data = node.data as PromptNodeData;
              return {
                ...node,
                data: {
                  ...data,
                  persistedPanelImageUrls: [snapUrl],
                  persistedPanelFirstImageUrl: null,
                  promptPanelPrimaryImageIndex: 0,
                },
              };
            }
            if (videoNodeId && node.id === videoNodeId && node.type === "video") {
              const data = node.data as VideoNodeData;
              return {
                ...node,
                data: {
                  ...data,
                  imageUrls: [snapUrl],
                },
              };
            }
            return node;
          })
        );
      })();

      setActivePanelNodeId(promptId);
      if (!keepHistoryOpen) {
        setMediaHistoryOpen(false);
      }
    },
    [
      getFlowPositionForNewNode,
      setNodes,
      setEdges,
      loadLocalImageIntoNode,
      localImageNodeType,
      setActivePanelNodeId,
      setMediaHistoryOpen,
    ]
  );
  const loadHistoryEntriesToCanvas = useCallback(
    (entries: GenerationHistoryEntry[]) => {
      const list = entries.filter(Boolean);
      if (list.length === 0) return;
      const start = getFlowPositionForNewNode();
      const colGap = 560;
      const rowGap = 360;
      const colCount = list.length >= 4 ? 2 : list.length >= 2 ? 2 : 1;
      list.forEach((entry, index) => {
        const col = index % colCount;
        const row = Math.floor(index / colCount);
        loadHistoryEntryToCanvas(entry, {
          flowPos: {
            x: start.x + col * colGap,
            y: start.y + row * rowGap,
          },
          keepHistoryOpen: index !== list.length - 1,
        });
      });
    },
    [getFlowPositionForNewNode, loadHistoryEntryToCanvas]
  );
  handleGenerateRef.current = handleGenerate;

  const autoLayoutNodes = useCallback(() => {
    const currentNodes = nodesRef.current;
    const currentEdges = edgesRef.current;
    const nextPos = computeAutoLayoutPositions(currentNodes, currentEdges);

    setNodes((prev) =>
      prev.map((n) => {
        const p = nextPos.get(n.id);
        if (!p) return n;
        return { ...n, position: p };
      })
    );
    requestAnimationFrame(() => {
      try {
        (rf as { fitView?: (o?: { padding?: number; duration?: number }) => void })?.fitView?.({
          padding: 0.12,
          duration: 320,
        });
      } catch {
        /* ignore */
      }
    });
  }, [setNodes, rf]);

  const onNodesDelete = useCallback((deleted: Node<AppNodeData>[]) => {
    window.requestAnimationFrame(() => {
      const rest = nodesRef.current;
      for (const n of deleted) {
        if (n.type !== "image") continue;
        const u = (n.data as LocalImageNodeData).imagePreviewUrl;
        revokeBlobIfUnused(u, rest);
        void idbDeleteImage(n.id);
      }
    });
  }, []);

  const getCanvasBatchDownloadAssets = useCallback(
    (targets: Node<AppNodeData>[]) => {
      const assets: BatchDownloadAsset[] = [];
      const seen = new Set<string>();
      const pushAsset = (
        url: string | null | undefined,
        fileName: string,
        mediaType: "image" | "video" | "file"
      ) => {
        const clean = stripHashOnly(typeof url === "string" ? url : "");
        if (!clean || seen.has(clean)) return;
        seen.add(clean);
        assets.push({ url: clean, fileName, mediaType });
      };

      for (const node of targets) {
        if (node.type === "prompt" || node.type === "prompt2") {
          const data = node.data as PromptNodeData;
          const urls =
            Array.isArray(data.persistedPanelImageUrls) && data.persistedPanelImageUrls.length > 0
              ? data.persistedPanelImageUrls
              : typeof data.persistedPanelFirstImageUrl === "string" &&
                  data.persistedPanelFirstImageUrl.trim().length > 0
                ? [data.persistedPanelFirstImageUrl]
                : [];
          urls.forEach((url, index) =>
            pushAsset(
              url,
              inferDownloadNameFromUrl(url, `${node.type}-${node.id}-${index + 1}`, "image"),
              "image"
            )
          );
          continue;
        }

        if (node.type === "process") {
          const data = node.data as ImageProcessNodeData;
          const operation = data.operation ?? "outpaint";
          const scoped = getProcessOperationOutputState(data, operation);
          const urls = scoped.imageUrls ?? data.imageUrls ?? [];
          urls.forEach((url, index) =>
            pushAsset(
              url,
              inferDownloadNameFromUrl(url, `process-${node.id}-${index + 1}`, "image"),
              "image"
            )
          );
          continue;
        }

        if (node.type === "video") {
          const data = node.data as VideoNodeData;
          const urls = data.imageUrls ?? [];
          urls.forEach((url, index) =>
            pushAsset(
              url,
              inferDownloadNameFromUrl(url, `video-${node.id}-${index + 1}`, "video"),
              "video"
            )
          );
          continue;
        }

        if (node.type === localImageNodeType) {
          const data = node.data as LocalImageNodeData;
          const clean = stripHashOnly(data.imagePreviewUrl ?? "");
          if (!clean) continue;
          const mediaType = isLocalMaterialVideo(node) ? "video" : "image";
          pushAsset(
            clean,
            inferDownloadNameFromUrl(clean, `material-${node.id}`, mediaType),
            mediaType
          );
        }
      }

      return assets;
    },
    [localImageNodeType]
  );

  const minimapNodeColor = useCallback((n: Node<AppNodeData>) => {
    switch (n.type) {
      case "prompt":
      case "prompt2":
        return "#52525b";
      case "video":
        return "#0e7490";
      case "image":
        return "#a16207";
      case "group": {
        const fc = (n.data as GroupNodeData)?.frameColor;
        return typeof fc === "string" && /^#[0-9A-Fa-f]{6}$/.test(fc) ? fc : "#737373";
      }
      default:
        return "#52525b";
    }
  }, []);

  // 閿涘牆缍嬮崜宥呭嚒閸掑洦宕叉稉琛♀偓婊冨灡瀵よ櫣鈹栭惂鍊熷Ν閻?+ 閸欏苯鍤崝鐘烘祰閳ユ繐绱濇稉宥呭晙娴ｈ法鏁ら惄瀛樺复娑撳﹣绱堕敍?
  const onFlowSelectionChange = useCallback(
    ({ nodes: sel }: { nodes: Node<AppNodeData>[]; edges: Edge[] }) => {
      const ungrouped = sel.filter(
        (n) =>
          n.type !== "group" &&
          !(n as Node<AppNodeData> & { parentNode?: string }).parentNode
      );
      if (ungrouped.length < 2) {
        setSelectionBboxFlow(null);
        return;
      }
      const current = nodesRef.current;
      const byId = new Map(current.map((n) => [n.id, n]));
      const absList = ungrouped.map((n) => ({
        n,
        p: getAbsolutePosition(n, byId),
      }));
      const minX = Math.min(...absList.map((x) => x.p.x));
      const minY = Math.min(...absList.map((x) => x.p.y));
      const maxX = Math.max(
        ...absList.map((x) => x.p.x + ((x.n.width as number | undefined) ?? 320))
      );
      const maxY = Math.max(
        ...absList.map((x) => x.p.y + ((x.n.height as number | undefined) ?? 200))
      );
      setSelectionBboxFlow({ minX, minY, maxX, maxY });
    },
    []
  );

  const selectionToolbarScreenPos = useMemo(() => {
    if (!selectionBboxFlow || !rf || typeof (rf as { flowToScreenPosition?: (p: { x: number; y: number }) => { x: number; y: number } }).flowToScreenPosition !== "function") {
      return null;
    }
    const gap = 8;
    const corner = (rf as { flowToScreenPosition: (p: { x: number; y: number }) => { x: number; y: number } }).flowToScreenPosition({
      x: selectionBboxFlow.maxX,
      y: selectionBboxFlow.minY,
    });
    return {
      x: Math.max(10, corner.x - gap),
      y: Math.max(6, corner.y + gap),
    };
  }, [selectionBboxFlow, rf, nodes, viewportSeq, viewportZoom]);
  const selectedCanvasNodesForToolbar = useMemo(
    () => nodes.filter((node) => (node as Node<AppNodeData> & { selected?: boolean }).selected),
    [nodes]
  );
  const selectedCanvasDownloadAssets = useMemo(
    () => getCanvasBatchDownloadAssets(selectedCanvasNodesForToolbar),
    [getCanvasBatchDownloadAssets, selectedCanvasNodesForToolbar]
  );
  const activeCanvasTasks = useMemo(() => {
    return nodes
      .filter((node) => {
        if (!(node.type === "prompt" || node.type === "prompt2" || node.type === "process")) {
          return false;
        }
        const data = node.data as
          | PromptNodeData
          | VideoNodeData
          | (ImageProcessNodeData & { isLoading?: boolean; error?: string | null; streamStatusLine?: string | null; lastSubmitId?: string | null });
        return data.isLoading === true;
      })
      .map((node) => {
        const data = node.data as
          | PromptNodeData
          | VideoNodeData
          | (ImageProcessNodeData & { isLoading?: boolean; error?: string | null; streamStatusLine?: string | null; lastSubmitId?: string | null });
        const defaultTitle =
          node.type === "prompt2"
            ? "视频生成"
            : node.type === "process"
              ? "图像处理"
              : "图片生成";
        const displayIndex = getPromptDisplayIndex(node.id);
        const title =
          typeof (data as PromptNodeData).nodeName === "string" &&
          (data as PromptNodeData).nodeName!.trim()
            ? (data as PromptNodeData).nodeName!.trim()
            : defaultTitle;
        const statusLine =
          typeof data.streamStatusLine === "string" && data.streamStatusLine.trim()
            ? data.streamStatusLine.trim()
            : "后台任务仍在继续同步...";
        const submitId =
          typeof data.lastSubmitId === "string" && data.lastSubmitId.trim()
            ? data.lastSubmitId.trim()
            : null;
        return {
          id: node.id,
          title: `${title} · ${displayIndex}`,
          statusLine,
          submitId,
          kind: node.type,
        };
      });
  }, [nodes, getPromptDisplayIndex]);
  const selectionToolbarCanGroup = useMemo(
    () =>
      selectedCanvasNodesForToolbar.filter(
        (node) =>
          node.type !== "group" &&
          !(node as Node<AppNodeData> & { parentNode?: string }).parentNode
      ).length >= 2,
    [selectedCanvasNodesForToolbar]
  );
  const selectionToolbarCanDelete = selectedCanvasNodesForToolbar.length > 0;
  const quickConnectSourceNode = quickConnectDraft ? nodeById.get(quickConnectDraft.source) : null;
  const quickConnectCanEdit =
    quickConnectSourceNode != null &&
    !(quickConnectSourceNode.type === localImageNodeType && isLocalMaterialVideo(quickConnectSourceNode));
  const quickConnectLineEnd = quickConnectDraft
    ? { x: quickConnectDraft.point.x + 4, y: quickConnectDraft.point.y + 14 }
    : null;
  const quickConnectLinePath =
    quickConnectDraft && quickConnectLineEnd
      ? `M ${quickConnectDraft.startPoint.x} ${quickConnectDraft.startPoint.y} C ${
          quickConnectDraft.startPoint.x + (quickConnectLineEnd.x - quickConnectDraft.startPoint.x) * 0.45
        } ${quickConnectDraft.startPoint.y}, ${
          quickConnectLineEnd.x - (quickConnectLineEnd.x - quickConnectDraft.startPoint.x) * 0.35
        } ${quickConnectLineEnd.y}, ${quickConnectLineEnd.x} ${quickConnectLineEnd.y}`
      : null;
  const handleSidebarGoHome = () => {
    void saveCanvasGraph(nodesRef.current, edgesRef.current).finally(() => onGoHome?.());
  };
  const openExpandedSidebarPanel = (panel: SidebarPanelKind) => {
    setSidebarMode("expanded");
    setSidebarPanelKind(panel);
    setCreatePanelOpen(false);
    if (panel === "settings") {
      void openCacheSettings();
    }
  };
  const openCompactCreateMenu = () => {
    setCreatePanelAnchor("button");
    setCreatePanelPoint(null);
    setCreatePanelOpen(true);
  };
  const sidebarPanelTitle =
    sidebarPanelKind === "create"
      ? "开启创作"
      : sidebarPanelKind === "materials"
        ? "素材"
        : sidebarPanelKind === "layout"
          ? "画布整理"
          : "画布设置";
  const sidebarPanelDescription =
    sidebarPanelKind === "create"
      ? "默认展开全部创作节点入口"
      : sidebarPanelKind === "materials"
        ? "查看历史素材与输出结果"
        : sidebarPanelKind === "layout"
          ? "自动整理节点与视图"
          : "缓存与交互参数";
  const isSidebarCreatePanel = sidebarPanelKind === "create";
  const isSidebarMaterialsPanel = sidebarPanelKind === "materials";
  const isSidebarLayoutPanel = sidebarPanelKind === "layout";
  const isSidebarSettingsPanel = sidebarPanelKind === "settings";
  const showSidebarEmbeddedMediaHistory =
    sidebarMode === "expanded" && isSidebarMaterialsPanel;
  const handleSidebarCreateDragStart = useCallback(
    (kind: SidebarCreateKind, event: React.DragEvent<HTMLButtonElement>) => {
      setSidebarDragKind(kind);
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData(SIDEBAR_NODE_DRAG_MIME, kind);
      event.dataTransfer.setData("text/plain", kind);
    },
    []
  );
  const handleSidebarCreateDragEnd = useCallback(() => {
    setSidebarDragKind(null);
  }, []);

  return (
    <div
      ref={flowHostRef}
      className="relative h-full w-full overflow-hidden bg-black"
      onContextMenuCapture={(e) => {
        if (!isEditableTextTarget(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onWheelCapture={onCanvasWheel}
      onMouseMove={(e) => {
        lastMouseClientPosRef.current = { x: e.clientX, y: e.clientY };
        lastCanvasPointerClientPosRef.current = { x: e.clientX, y: e.clientY };
      }}
      onDragOver={(e) => {
        const dragTypes = Array.from(e.dataTransfer?.types ?? []);
        if (dragTypes.includes(CANVAS_AGENT_MEDIA_DRAG_MIME)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          lastCanvasPointerClientPosRef.current = { x: e.clientX, y: e.clientY };
          return;
        }
        if (dragTypes.includes(SIDEBAR_NODE_DRAG_MIME)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          lastCanvasPointerClientPosRef.current = { x: e.clientX, y: e.clientY };
          return;
        }
        if (dragTypes.includes(HISTORY_ENTRY_DRAG_MIME)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          lastCanvasPointerClientPosRef.current = { x: e.clientX, y: e.clientY };
          return;
        }
        if (!dragTypes.includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!dragImportActive) setDragImportActive(true);
        lastCanvasPointerClientPosRef.current = { x: e.clientX, y: e.clientY };
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) return;
        setDragImportActive(false);
      }}
      onDrop={(e) => {
        const agentMediaText = e.dataTransfer?.getData(CANVAS_AGENT_MEDIA_DRAG_MIME) ?? "";
        if (agentMediaText) {
          e.preventDefault();
          void (async () => {
            try {
              const payload = JSON.parse(agentMediaText) as {
                url?: string;
                mediaKind?: "image" | "video";
              };
              const cleanUrl =
                typeof payload?.url === "string" ? payload.url.trim() : "";
              if (!cleanUrl) return;
              const res = await fetch(cleanUrl);
              const blob = await res.blob();
              const fallbackExt =
                payload?.mediaKind === "video"
                  ? "mp4"
                  : blob.type.includes("png")
                    ? "png"
                    : "jpg";
              const file = new File([blob], `agent-media-${Date.now()}.${fallbackExt}`, {
                type:
                  blob.type ||
                  (payload?.mediaKind === "video" ? "video/mp4" : "image/jpeg"),
              });
              createCanvasMaterialNodeAt(
                file,
                screenToFlow({ x: e.clientX, y: e.clientY })
              );
            } catch {
              /* ignore */
            }
          })();
          return;
        }
        const droppedCreateKind = e.dataTransfer?.getData(SIDEBAR_NODE_DRAG_MIME) ?? "";
        if (isSidebarCreateKind(droppedCreateKind)) {
          e.preventDefault();
          setSidebarDragKind(null);
          createStandaloneCanvasNodeAtClient(droppedCreateKind, {
            x: e.clientX,
            y: e.clientY,
          });
          return;
        }
        const droppedHistoryText = e.dataTransfer?.getData(HISTORY_ENTRY_DRAG_MIME) ?? "";
        if (droppedHistoryText) {
          e.preventDefault();
          const client = { x: e.clientX, y: e.clientY };
          const flowPos = screenToFlow(client);
          void (async () => {
            try {
              const payload = JSON.parse(droppedHistoryText) as HistoryEntryDragPayload;
              if (!payload?.id) return;
              const res = await fetch("/api/generation-history");
              const json = (await res.json().catch(() => null)) as
                | { entries?: GenerationHistoryEntry[]; error?: string }
                | null;
              if (!res.ok || !Array.isArray(json?.entries)) return;
              const entry = json.entries.find((item) => item.id === payload.id);
              if (!entry) return;
              loadHistoryEntryToCanvas(entry, { flowPos, keepHistoryOpen: true });
            } catch {
              /* ignore */
            }
          })();
          return;
        }
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length === 0) return;
        e.preventDefault();
        setDragImportActive(false);
        importFilesToCanvasAtClient(files, { x: e.clientX, y: e.clientY });
      }}
    >
      {sidebarDragKind ? (
        <div className="pointer-events-none absolute inset-0 z-[141] flex items-center justify-center">
          <div className="rounded-2xl border border-sky-300/25 bg-zinc-950/84 px-6 py-4 text-center shadow-2xl backdrop-blur-md">
            <div className="text-base font-semibold text-zinc-100">
              释放以创建{SIDEBAR_CREATE_LABELS[sidebarDragKind]}
            </div>
            <div className="mt-1 text-xs text-zinc-300/80">节点会直接落在当前鼠标位置</div>
          </div>
        </div>
      ) : null}
      {dragImportActive ? (
        <div className="pointer-events-none absolute inset-0 z-[140] flex items-center justify-center bg-white/8 backdrop-blur-[1px]">
          <div className="rounded-2xl border border-white/20 bg-zinc-900/78 px-6 py-4 text-center shadow-2xl backdrop-blur-md">
            <div className="text-base font-semibold text-zinc-100">释放文件以导入素材</div>
            <div className="mt-1 text-xs text-zinc-300/80">支持拖入图片和视频，自动生成素材节点</div>
          </div>
        </div>
      ) : null}
      {sidebarMode === "expanded" ? (
        <div className="absolute left-0 top-0 z-20 flex h-full overflow-hidden border-r border-white/8 bg-zinc-950/88 shadow-[0_18px_46px_rgba(0,0,0,0.34)] backdrop-blur-xl">
          <div className="flex w-[92px] flex-col items-center justify-between border-r border-white/8 px-3 py-5">
            <div className="flex w-full flex-col items-center gap-7 pt-1">
              <button
                type="button"
                className="flex w-full flex-col items-center gap-2 rounded-2xl px-2 py-1.5 text-zinc-300 transition-colors hover:bg-white/[0.04] hover:text-white"
                onClick={handleSidebarGoHome}
                title="返回首页"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-[18px] bg-white/[0.03] ring-1 ring-white/[0.06] transition-colors group-hover:bg-white/[0.06]">
                  <House className="h-[18px] w-[18px]" />
                </span>
                <span className="text-[11px] leading-none">首页</span>
              </button>
              <button
                type="button"
                className={[
                  "flex w-full flex-col items-center gap-2 rounded-2xl px-2 py-1.5 transition-colors",
                  isSidebarCreatePanel
                    ? "text-white"
                    : "text-zinc-300 hover:bg-white/[0.04] hover:text-white",
                ].join(" ")}
                onClick={() => openExpandedSidebarPanel("create")}
                title="开启创作"
              >
                <span
                  className={[
                    "flex h-11 w-11 items-center justify-center rounded-[18px] ring-1 transition-colors",
                    isSidebarCreatePanel
                      ? "bg-zinc-100 text-zinc-950 ring-white/50"
                      : "bg-white/[0.03] text-zinc-300 ring-white/[0.06]",
                  ].join(" ")}
                >
                  <Plus className="h-[18px] w-[18px]" strokeWidth={2.35} />
                </span>
                <span className="text-[11px] leading-none">创作</span>
              </button>
              <button
                type="button"
                className={[
                  "flex w-full flex-col items-center gap-2 rounded-2xl px-2 py-1.5 transition-colors",
                  isSidebarMaterialsPanel
                    ? "text-white"
                    : "text-zinc-300 hover:bg-white/[0.04] hover:text-white",
                ].join(" ")}
                onClick={() => openExpandedSidebarPanel("materials")}
                title="素材"
              >
                <span
                  className={[
                    "flex h-11 w-11 items-center justify-center rounded-[18px] ring-1 transition-colors",
                    isSidebarMaterialsPanel
                      ? "bg-white/12 text-white ring-white/18"
                      : "bg-white/[0.03] text-zinc-300 ring-white/[0.06]",
                  ].join(" ")}
                >
                  <Images className="h-[18px] w-[18px]" />
                </span>
                <span className="text-[11px] leading-none">素材</span>
              </button>
              <button
                type="button"
                className={[
                  "flex w-full flex-col items-center gap-2 rounded-2xl px-2 py-1.5 transition-colors",
                  isSidebarLayoutPanel
                    ? "text-white"
                    : "text-zinc-300 hover:bg-white/[0.04] hover:text-white",
                ].join(" ")}
                onClick={() => openExpandedSidebarPanel("layout")}
                title="画布整理"
              >
                <span
                  className={[
                    "flex h-11 w-11 items-center justify-center rounded-[18px] ring-1 transition-colors",
                    isSidebarLayoutPanel
                      ? "bg-white/12 text-white ring-white/18"
                      : "bg-white/[0.03] text-zinc-300 ring-white/[0.06]",
                  ].join(" ")}
                >
                  <LayoutGrid className="h-[18px] w-[18px]" />
                </span>
                <span className="text-[11px] leading-none">整理</span>
              </button>
              <button
                type="button"
                className={[
                  "flex w-full flex-col items-center gap-2 rounded-2xl px-2 py-1.5 transition-colors",
                  isSidebarSettingsPanel
                    ? "text-white"
                    : "text-zinc-300 hover:bg-white/[0.04] hover:text-white",
                ].join(" ")}
                onClick={() => openExpandedSidebarPanel("settings")}
                title="画布设置"
              >
                <span
                  className={[
                    "flex h-11 w-11 items-center justify-center rounded-[18px] ring-1 transition-colors",
                    isSidebarSettingsPanel
                      ? "bg-white/12 text-white ring-white/18"
                      : "bg-white/[0.03] text-zinc-300 ring-white/[0.06]",
                  ].join(" ")}
                >
                  <Settings className="h-[18px] w-[18px]" />
                </span>
                <span className="text-[11px] leading-none">设置</span>
              </button>
            </div>
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-[18px] text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-white"
              onClick={() => {
                setSidebarMode("compact");
                setCreatePanelOpen(false);
              }}
              title="切换为紧凑菜单"
            >
              <ChevronLeft className="h-[18px] w-[18px]" />
            </button>
          </div>
          <div className="flex w-[304px] flex-col pl-3 pr-2 py-5">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <div className="text-[20px] font-semibold text-white">{sidebarPanelTitle}</div>
                <div className="mt-1 text-[11px] text-zinc-500">{sidebarPanelDescription}</div>
              </div>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-white"
                onClick={() => {
                  setSidebarMode("compact");
                  setCreatePanelOpen(false);
                }}
                title="收起侧栏"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>

            <div
              className={[
                "min-h-0 flex-1",
                showSidebarEmbeddedMediaHistory
                  ? "overflow-hidden pr-1"
                  : "ui-gray-scrollbar ui-gray-scrollbar--sidebar overflow-y-auto pr-1",
              ].join(" ")}
            >
              {isSidebarCreatePanel ? (
                <div className="space-y-2.5">
                  <button type="button" draggable className="group flex w-full cursor-grab items-center gap-3 rounded-[18px] border border-white/10 bg-white/[0.04] px-3 py-3 text-left transition-colors hover:bg-white/[0.07] active:cursor-grabbing" onClick={() => createPromptNodeWithOutput()} onDragStart={(e) => handleSidebarCreateDragStart("prompt", e)} onDragEnd={handleSidebarCreateDragEnd}>
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-500/12 text-sky-300 ring-1 ring-sky-400/16"><ImageIcon className="h-4.5 w-4.5" /></span>
                    <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium text-white">生图节点</span><span className="mt-0.5 block text-[11px] text-zinc-500">创建图片生成卡片</span></span>
                  </button>
                  <button type="button" draggable className="group flex w-full cursor-grab items-center gap-3 rounded-[18px] border border-white/10 bg-white/[0.04] px-3 py-3 text-left transition-colors hover:bg-white/[0.07] active:cursor-grabbing" onClick={() => createPromptNode2WithOutput()} onDragStart={(e) => handleSidebarCreateDragStart("prompt2", e)} onDragEnd={handleSidebarCreateDragEnd}>
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-500/12 text-violet-300 ring-1 ring-violet-400/16"><Video className="h-4.5 w-4.5" /></span>
                    <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium text-white">生视频节点</span><span className="mt-0.5 block text-[11px] text-zinc-500">创建视频生成卡片</span></span>
                  </button>
                  <button type="button" draggable className="group flex w-full cursor-grab items-center gap-3 rounded-[18px] border border-white/10 bg-white/[0.04] px-3 py-3 text-left transition-colors hover:bg-white/[0.07] active:cursor-grabbing" onClick={() => createTextNode()} onDragStart={(e) => handleSidebarCreateDragStart("text", e)} onDragEnd={handleSidebarCreateDragEnd}>
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/12 text-amber-200 ring-1 ring-amber-400/16"><MessageSquareText className="h-4.5 w-4.5" /></span>
                    <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium text-white">文本节点</span><span className="mt-0.5 block text-[11px] text-zinc-500">放置说明、提示词或备注</span></span>
                  </button>
                  <button type="button" draggable className="group flex w-full cursor-grab items-center gap-3 rounded-[18px] border border-white/10 bg-white/[0.04] px-3 py-3 text-left transition-colors hover:bg-white/[0.07] active:cursor-grabbing" onClick={() => createProcessNode()} onDragStart={(e) => handleSidebarCreateDragStart("process", e)} onDragEnd={handleSidebarCreateDragEnd}>
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-300 ring-1 ring-emerald-400/16"><Sparkles className="h-4.5 w-4.5" /></span>
                    <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium text-white">编辑</span><span className="mt-0.5 block text-[11px] text-zinc-500">处理图像与二次编辑</span></span>
                  </button>
                  <button type="button" draggable className="group flex w-full cursor-grab items-center gap-3 rounded-[18px] border border-white/10 bg-white/[0.04] px-3 py-3 text-left transition-colors hover:bg-white/[0.07] active:cursor-grabbing" onClick={() => createEmptyLocalImageNode()} onDragStart={(e) => handleSidebarCreateDragStart("material", e)} onDragEnd={handleSidebarCreateDragEnd}>
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zinc-500/12 text-zinc-200 ring-1 ring-white/10"><Upload className="h-4.5 w-4.5" /></span>
                    <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium text-white">素材节点</span><span className="mt-0.5 block text-[11px] text-zinc-500">导入本地图片或视频素材</span></span>
                  </button>
                </div>
              ) : null}

              {isSidebarMaterialsPanel ? (
                showSidebarEmbeddedMediaHistory ? (
                  <div className="flex h-full min-h-0 flex-col gap-3">
                    <div className="flex items-center justify-end px-1">
                      <button
                        type="button"
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-[11px] text-zinc-200 transition-colors hover:bg-white/[0.08] hover:text-white"
                        onClick={() => setTasksOpen(true)}
                      >
                        <History className="h-3.5 w-3.5" />
                        <span>查看任务记录</span>
                      </button>
                    </div>
                    <MediaHistoryPanel
                      open
                      variant="embedded"
                      onClose={() => setSidebarPanelKind("create")}
                      onLoadToCanvas={loadHistoryEntryToCanvas}
                    />
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <button type="button" className="flex w-full items-center gap-3 rounded-[18px] border border-white/10 bg-white/[0.04] px-3 py-3 text-left transition-colors hover:bg-white/[0.07]" onClick={() => setMediaHistoryOpen(true)}>
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/[0.04] text-zinc-200 ring-1 ring-white/10"><Images className="h-4.5 w-4.5" /></span>
                      <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium text-white">打开历史素材</span><span className="mt-0.5 block text-[11px] text-zinc-500">浏览当前画布结果与素材记录</span></span>
                    </button>
                    <button type="button" className="flex w-full items-center gap-3 rounded-[18px] border border-white/10 bg-white/[0.04] px-3 py-3 text-left transition-colors hover:bg-white/[0.07]" onClick={() => setTasksOpen(true)}>
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/[0.04] text-zinc-200 ring-1 ring-white/10"><History className="h-4.5 w-4.5" /></span>
                      <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium text-white">查看任务记录</span><span className="mt-0.5 block text-[11px] text-zinc-500">快速检查生成任务与 submit id</span></span>
                    </button>
                  </div>
                )
              ) : null}

              {isSidebarLayoutPanel ? (
                <div className="space-y-2.5">
                  <button type="button" className="flex w-full items-center gap-3 rounded-[18px] border border-white/10 bg-white/[0.04] px-3 py-3 text-left transition-colors hover:bg-white/[0.07]" onClick={autoLayoutNodes}>
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/[0.04] text-zinc-200 ring-1 ring-white/10"><LayoutGrid className="h-4.5 w-4.5" /></span>
                    <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium text-white">自动排布节点</span><span className="mt-0.5 block text-[11px] text-zinc-500">重新整理当前画布节点布局</span></span>
                  </button>
                  <button type="button" className="flex w-full items-center gap-3 rounded-[18px] border border-white/10 bg-white/[0.04] px-3 py-3 text-left transition-colors hover:bg-white/[0.07]" onClick={fitSelectionOrView}>
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/[0.04] text-zinc-200 ring-1 ring-white/10"><Scan className="h-4.5 w-4.5" /></span>
                    <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium text-white">聚焦当前内容</span><span className="mt-0.5 block text-[11px] text-zinc-500">快速回到选中节点或全部节点</span></span>
                  </button>
                  <button type="button" className="flex w-full items-center gap-3 rounded-[18px] border border-white/10 bg-white/[0.04] px-3 py-3 text-left transition-colors hover:bg-white/[0.07]" onClick={() => setMinimapVisible((v) => !v)}>
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/[0.04] text-zinc-200 ring-1 ring-white/10"><MapPinned className="h-4.5 w-4.5" /></span>
                    <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium text-white">{minimapVisible ? "隐藏缩略图" : "显示缩略图"}</span><span className="mt-0.5 block text-[11px] text-zinc-500">控制左下角画布概览窗口</span></span>
                  </button>
                </div>
              ) : null}

              {isSidebarSettingsPanel ? (
                <div className="space-y-3">
                  <button type="button" className="flex w-full items-center gap-3 rounded-[18px] border border-white/10 bg-white/[0.04] px-3 py-3 text-left transition-colors hover:bg-white/[0.07]" onClick={() => setDragSpeedLevel((prev) => prev === "normal" ? "fast" : prev === "fast" ? "extreme" : "normal")}>
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/[0.04] text-zinc-200 ring-1 ring-white/10"><ChevronRight className="h-4.5 w-4.5" /></span>
                    <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium text-white">拖拽速度</span><span className="mt-0.5 block text-[11px] text-zinc-500">当前：{DRAG_SPEED_PRESETS[dragSpeedLevel].label}</span></span>
                  </button>
                  <div className="rounded-[18px] border border-white/10 bg-white/[0.04] px-2.5 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[13px] font-medium text-white">缓存路径与 API</div>
                        <div className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                          保存后会记住；当前修改中的模型与渠道会实时同步到节点显示。
                        </div>
                      </div>
                      <button
                        type="button"
                        className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] text-zinc-300 transition-colors hover:bg-white/[0.08] hover:text-white"
                        onClick={() => void openCacheSettings()}
                        disabled={cacheDirBusy || externalApiBusy}
                      >
                        刷新
                      </button>
                    </div>

                    <div className="mt-4 space-y-2">
                      <label className="block text-[11px] text-zinc-400">缓存目录</label>
                      <input
                        value={cacheDirInput}
                        onChange={(e) => setCacheDirInput(e.target.value)}
                        className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-2 font-mono text-[11px] text-zinc-200 outline-none ring-zinc-400/35 focus:ring"
                        placeholder={cacheDirDefault || "输入绝对路径"}
                        disabled={cacheDirBusy}
                      />
                      {cacheDirCurrent ? (
                        <p className="text-[11px] text-zinc-500">生效目录：{cacheDirCurrent}</p>
                      ) : null}
                      {cacheDirErr ? (
                        <p className="text-[11px] text-amber-300">{cacheDirErr}</p>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white hover:bg-white/10 disabled:opacity-50"
                          onClick={() => void pickCacheDirBySystemDialog()}
                          disabled={cacheDirBusy}
                        >
                          选择目录
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white hover:bg-white/10 disabled:opacity-50"
                          onClick={() => void openCacheDirInExplorer()}
                          disabled={cacheDirBusy}
                        >
                          打开目录
                        </button>
                        <button
                          type="button"
                          className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200 disabled:opacity-50"
                          onClick={() => void saveCacheDir()}
                          disabled={cacheDirBusy}
                        >
                          保存缓存路径
                        </button>
                      </div>
                    </div>

                    <div className="mt-5 border-t border-white/10 pt-4">
                      <h3 className="mb-2 text-sm font-medium text-white">外部图片 API</h3>
                      <div className="space-y-2">
                        <label className="block text-[11px] text-zinc-400">图片 API 渠道</label>
                        <select
                          value={externalApiProviderId}
                          onChange={(e) =>
                            void switchExternalApiProvider(
                              normalizeExternalImageApiProviderId(e.target.value)
                            )
                          }
                          className="h-8 w-full rounded-md border border-white/10 bg-zinc-950 px-2 text-[10px] text-zinc-200 outline-none ring-zinc-400/30 transition-colors focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/30"
                          disabled={externalApiBusy}
                        >
                          {externalApiProviders.map((provider) => (
                            <option key={provider.id} value={provider.id}>
                              {provider.label}
                            </option>
                          ))}
                        </select>
                        <p className="text-[11px] text-zinc-500">
                          选择厂商后，下方模型列表会切到该厂商的生图模型。
                        </p>
                        <label className="block text-[11px] text-zinc-400">API 名称</label>
                        <input
                          value={externalApiDisplayName}
                          onChange={(e) => {
                            const nextValue = e.target.value;
                            setExternalApiDisplayName(nextValue);
                            setExternalApiProviders((prev) =>
                              prev.map((provider) =>
                                provider.id === externalApiProviderId
                                  ? { ...provider, label: nextValue || provider.label }
                                  : provider
                              )
                            );
                            setExternalApiProviderConfigs((prev) => ({
                              ...prev,
                              [externalApiProviderId]: {
                                displayName: nextValue,
                                baseUrl: prev[externalApiProviderId]?.baseUrl ?? externalApiBaseUrl,
                                apiKey: prev[externalApiProviderId]?.apiKey ?? externalApiKey,
                                imageModel: prev[externalApiProviderId]?.imageModel ?? externalApiImageModel,
                                textModel: prev[externalApiProviderId]?.textModel ?? externalApiTextModel,
                                imageCostPerGeneration: optionalCostInputForConfig(externalApiImageCost),
                                imageCostCurrency: externalApiImageCostCurrency.trim() || "$",
                              },
                            }));
                          }}
                          className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-2 text-[11px] text-zinc-200 outline-none ring-zinc-400/35 focus:ring"
                          placeholder="例如 ForOpenCode 图片"
                          disabled={externalApiBusy}
                        />
                        <label className="block text-[11px] text-zinc-400">API 地址</label>
                        <input
                          value={externalApiBaseUrl}
                          onChange={(e) => {
                            const nextValue = e.target.value;
                            setExternalApiBaseUrl(nextValue);
                            setExternalApiProviderConfigs((prev) => ({
                              ...prev,
                              [externalApiProviderId]: {
                                displayName: prev[externalApiProviderId]?.displayName ?? externalApiDisplayName,
                                baseUrl: nextValue,
                                apiKey: prev[externalApiProviderId]?.apiKey ?? externalApiKey,
                                imageModel: prev[externalApiProviderId]?.imageModel ?? externalApiImageModel,
                                textModel: prev[externalApiProviderId]?.textModel ?? externalApiTextModel,
                                imageCostPerGeneration: optionalCostInputForConfig(externalApiImageCost),
                                imageCostCurrency: externalApiImageCostCurrency.trim() || "$",
                              },
                            }));
                          }}
                          className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-2 font-mono text-[11px] text-zinc-200 outline-none ring-zinc-400/35 focus:ring"
                          placeholder="例如 http://82.156.254.79:3000 或 http://82.156.254.79:3000/v1"
                          disabled={externalApiBusy}
                        />
                        <label className="block text-[11px] text-zinc-400">API 密钥</label>
                        <input
                          value={externalApiKey}
                          onChange={(e) => {
                            const nextValue = e.target.value;
                            setExternalApiKey(nextValue);
                            setExternalApiProviderConfigs((prev) => ({
                              ...prev,
                              [externalApiProviderId]: {
                                displayName: prev[externalApiProviderId]?.displayName ?? externalApiDisplayName,
                                baseUrl: prev[externalApiProviderId]?.baseUrl ?? externalApiBaseUrl,
                                apiKey: nextValue,
                                imageModel: prev[externalApiProviderId]?.imageModel ?? externalApiImageModel,
                                textModel: prev[externalApiProviderId]?.textModel ?? externalApiTextModel,
                                imageCostPerGeneration: optionalCostInputForConfig(externalApiImageCost),
                                imageCostCurrency: externalApiImageCostCurrency.trim() || "$",
                              },
                            }));
                          }}
                          className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-2 font-mono text-[11px] text-zinc-200 outline-none ring-zinc-400/35 focus:ring"
                          placeholder="sk-..."
                          disabled={externalApiBusy}
                        />
                        <label className="block text-[11px] text-zinc-400">图片模型</label>
                        <select
                          value={externalApiImageModel}
                          onChange={(e) => {
                            const nextValue = e.target.value;
                            setExternalApiImageModel(nextValue);
                            setExternalApiProviderConfigs((prev) => ({
                              ...prev,
                              [externalApiProviderId]: {
                                displayName: prev[externalApiProviderId]?.displayName ?? externalApiDisplayName,
                                baseUrl: prev[externalApiProviderId]?.baseUrl ?? externalApiBaseUrl,
                                apiKey: prev[externalApiProviderId]?.apiKey ?? externalApiKey,
                                imageModel: nextValue,
                                textModel: prev[externalApiProviderId]?.textModel ?? externalApiTextModel,
                                imageCostPerGeneration: optionalCostInputForConfig(externalApiImageCost),
                                imageCostCurrency: externalApiImageCostCurrency.trim() || "$",
                              },
                            }));
                            if (externalApiConfigReady) {
                              syncNodesToExternalApiConfig(externalApiProviderId, {
                                imageModel: nextValue,
                                textModel: externalApiTextModel,
                              });
                            }
                          }}
                          className="h-8 w-full rounded-md border border-white/10 bg-zinc-950 px-2 text-[10px] text-zinc-200 outline-none ring-zinc-400/30 transition-colors focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/30"
                          disabled={externalApiBusy}
                        >
                          {externalApiModelOptions.map((model) => (
                            <option key={model} value={model} />
                          ))}
                        </select>
                        <label className="block text-[11px] text-zinc-400">文本模型</label>
                        <input
                          value={externalApiTextModel}
                          onChange={(e) => {
                            const nextValue = e.target.value;
                            setExternalApiTextModel(nextValue);
                            setExternalApiProviderConfigs((prev) => ({
                              ...prev,
                              [externalApiProviderId]: {
                                displayName: prev[externalApiProviderId]?.displayName ?? externalApiDisplayName,
                                baseUrl: prev[externalApiProviderId]?.baseUrl ?? externalApiBaseUrl,
                                apiKey: prev[externalApiProviderId]?.apiKey ?? externalApiKey,
                                imageModel: prev[externalApiProviderId]?.imageModel ?? externalApiImageModel,
                                textModel: nextValue,
                                imageCostPerGeneration: optionalCostInputForConfig(externalApiImageCost),
                                imageCostCurrency: externalApiImageCostCurrency.trim() || "$",
                              },
                            }));
                            if (externalApiConfigReady) {
                              syncNodesToExternalApiConfig(externalApiProviderId, {
                                imageModel: externalApiImageModel,
                                textModel: nextValue,
                              });
                            }
                          }}
                          className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-2 font-mono text-[11px] text-zinc-200 outline-none ring-zinc-400/35 focus:ring"
                          placeholder="例如 gpt-image-2-c"
                          disabled={externalApiBusy}
                        />
                        <div className="grid grid-cols-[minmax(0,1fr)_72px] gap-2">
                          <label className="block text-[11px] text-zinc-400">
                            单次生图花费（可选）
                            <input
                              type="number"
                              min="0"
                              step="0.000001"
                              value={externalApiImageCost}
                              onChange={(e) => {
                                const nextValue = e.target.value;
                                setExternalApiImageCost(nextValue);
                                setExternalApiProviderConfigs((prev) => ({
                                  ...prev,
                                  [externalApiProviderId]: {
                                    displayName: prev[externalApiProviderId]?.displayName ?? externalApiDisplayName,
                                    baseUrl: prev[externalApiProviderId]?.baseUrl ?? externalApiBaseUrl,
                                    apiKey: prev[externalApiProviderId]?.apiKey ?? externalApiKey,
                                    imageModel: prev[externalApiProviderId]?.imageModel ?? externalApiImageModel,
                                    textModel: prev[externalApiProviderId]?.textModel ?? externalApiTextModel,
                                    imageCostPerGeneration: optionalCostInputForConfig(nextValue),
                                    imageCostCurrency: externalApiImageCostCurrency.trim() || "$",
                                  },
                                }));
                              }}
                              className="mt-1 w-full rounded-md border border-white/10 bg-black/40 px-2 py-2 font-mono text-[11px] text-zinc-200 outline-none ring-zinc-400/35 focus:ring"
                              placeholder="留空隐藏"
                              disabled={externalApiBusy}
                            />
                          </label>
                          <label className="block text-[11px] text-zinc-400">
                            货币
                            <input
                              value={externalApiImageCostCurrency}
                              onChange={(e) => {
                                const nextValue = e.target.value;
                                setExternalApiImageCostCurrency(nextValue);
                                setExternalApiProviderConfigs((prev) => ({
                                  ...prev,
                                  [externalApiProviderId]: {
                                    displayName: prev[externalApiProviderId]?.displayName ?? externalApiDisplayName,
                                    baseUrl: prev[externalApiProviderId]?.baseUrl ?? externalApiBaseUrl,
                                    apiKey: prev[externalApiProviderId]?.apiKey ?? externalApiKey,
                                    imageModel: prev[externalApiProviderId]?.imageModel ?? externalApiImageModel,
                                    textModel: prev[externalApiProviderId]?.textModel ?? externalApiTextModel,
                                    imageCostPerGeneration: optionalCostInputForConfig(externalApiImageCost),
                                    imageCostCurrency: nextValue.trim() || "$",
                                  },
                                }));
                              }}
                              className="mt-1 w-full rounded-md border border-white/10 bg-black/40 px-2 py-2 font-mono text-[11px] text-zinc-200 outline-none ring-zinc-400/35 focus:ring"
                              placeholder="$"
                              disabled={externalApiBusy}
                            />
                          </label>
                        </div>
                        <p className="text-[11px] text-zinc-500">
                          留空时任务记录不显示花费；填写后新任务会按每次生图写入日志。
                        </p>
                        {externalApiLastUsage ? (
                          <div className="rounded-md border border-white/12 bg-white/8 px-2 py-2 text-[11px] text-zinc-100">
                            最近一次消耗：
                            {externalApiLastUsage.total_tokens ?? "--"} 令牌
                            {typeof externalApiLastUsage.input_tokens === "number"
                              ? `（输入 ${externalApiLastUsage.input_tokens}`
                              : ""}
                            {typeof externalApiLastUsage.output_tokens === "number"
                              ? ` / 输出 ${externalApiLastUsage.output_tokens}`
                              : ""}
                            {typeof externalApiLastUsage.input_tokens === "number" ||
                            typeof externalApiLastUsage.output_tokens === "number"
                              ? "）"
                              : ""}
                            {externalApiLastUsage.model ? ` · 模型 ${externalApiLastUsage.model}` : ""}
                          </div>
                        ) : (
                          <div className="text-[11px] text-zinc-500">最近一次消耗：暂无</div>
                        )}
                        {externalApiErr ? (
                          <p className="text-[11px] text-amber-300">{externalApiErr}</p>
                        ) : null}
                        {externalApiDebugNote ? (
                          <p className="text-[11px] text-emerald-300">{externalApiDebugNote}</p>
                        ) : null}
                        <div className="flex justify-end gap-2 pt-1">
                          <button
                            type="button"
                            className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white hover:bg-white/10 disabled:opacity-50"
                            onClick={() => void debugExternalApiConfig()}
                            disabled={externalApiBusy}
                          >
                            调试模型
                          </button>
                          <button
                            type="button"
                            className="rounded-md bg-emerald-600/85 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500/90 disabled:opacity-50"
                            onClick={() => void saveExternalApiConfig()}
                            disabled={externalApiBusy}
                          >
                            保存 API 配置
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 border-t border-white/10 pt-4">
                      <h3 className="mb-2 text-sm font-medium text-white">外部生视频 API</h3>
                      <div className="space-y-2">
                        <label className="block text-[11px] text-zinc-400">视频 API 渠道</label>
                        <select
                          value="foropencode"
                          className="h-8 w-full rounded-md border border-white/10 bg-zinc-950 px-2 text-[10px] text-zinc-200 outline-none ring-zinc-400/30 transition-colors focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/30"
                          disabled
                        >
                          {EXTERNAL_VIDEO_PROVIDER_OPTIONS.map((provider) => (
                            <option key={provider.id} value={provider.id}>
                              {provider.label}
                            </option>
                          ))}
                        </select>
                        <label className="block text-[11px] text-zinc-400">API 名称</label>
                        <input
                          value={externalVideoApiDisplayName}
                          onChange={(e) => setExternalVideoApiDisplayName(e.target.value)}
                          className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-2 text-[11px] text-zinc-200 outline-none ring-zinc-400/35 focus:ring"
                          placeholder="例如 首尾帧"
                          disabled={externalVideoApiBusy}
                        />
                        <label className="block text-[11px] text-zinc-400">API 地址</label>
                        <input
                          value={externalVideoApiBaseUrl}
                          onChange={(e) => setExternalVideoApiBaseUrl(e.target.value)}
                          className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-2 font-mono text-[11px] text-zinc-200 outline-none ring-zinc-400/35 focus:ring"
                          placeholder="例如 https://www.foropencode.com/v1"
                          disabled={externalVideoApiBusy}
                        />
                        <label className="block text-[11px] text-zinc-400">API 密钥</label>
                        <input
                          value={externalVideoApiKey}
                          onChange={(e) => setExternalVideoApiKey(e.target.value)}
                          className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-2 font-mono text-[11px] text-zinc-200 outline-none ring-zinc-400/35 focus:ring"
                          placeholder="sk-..."
                          disabled={externalVideoApiBusy}
                        />
                        <label className="block text-[11px] text-zinc-400">默认视频模型</label>
                        <select
                          value={externalVideoApiModel}
                          onChange={(e) => setExternalVideoApiModel(e.target.value)}
                          className="h-8 w-full rounded-md border border-white/10 bg-zinc-950 px-2 text-[10px] text-zinc-200 outline-none ring-zinc-400/30 transition-colors focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/30"
                          disabled={externalVideoApiBusy}
                        >
                          {externalVideoApiModelOptions.map((model) => (
                            <option key={model} value={model}>
                              {model}
                            </option>
                          ))}
                        </select>
                        <p className="text-[11px] text-zinc-500">
                          生视频节点切到“视频API”后，会从这里读取模型列表和鉴权。
                        </p>
                        {externalVideoApiErr ? (
                          <p className="text-[11px] text-amber-300">{externalVideoApiErr}</p>
                        ) : null}
                        {externalVideoApiDebugNote ? (
                          <p className="text-[11px] text-sky-300">{externalVideoApiDebugNote}</p>
                        ) : null}
                        <div className="flex justify-end gap-2 pt-1">
                          <button
                            type="button"
                            className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white hover:bg-white/10 disabled:opacity-50"
                            onClick={() => void debugExternalVideoApiConfig()}
                            disabled={externalVideoApiBusy}
                          >
                            调试模型
                          </button>
                          <button
                            type="button"
                            className="rounded-md bg-sky-600/85 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500/90 disabled:opacity-50"
                            onClick={() => void saveExternalVideoApiConfig()}
                            disabled={externalVideoApiBusy}
                          >
                            保存生视频 API
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <ReactFlow
        nodes={nodesForRf}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onEdgeDoubleClick={(_, edge) => {
          setEdges((prev) => prev.filter((e) => e.id !== edge.id));
        }}
        onPaneClick={() => {
          dispatchCloseMediaLightbox();
          setActivePanelNodeId(null);
          setPickImageForPromptId(null);
          setSelectionBboxFlow(null);
          setCreatePanelOpen(false);
          setQuickConnectDraft(null);
          if (minimapVisible) setMinimapVisible(false);
        }}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          setQuickConnectDraft(null);
          openCreatePanelAtClient(e.clientX, e.clientY);
        }}
        onNodeContextMenu={(e) => {
          if (isEditableTextTarget(e.target)) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          e.preventDefault();
          setQuickConnectDraft(null);
          openCreatePanelAtClient(e.clientX, e.clientY);
        }}
        onEdgeContextMenu={(e) => {
          e.preventDefault();
          setQuickConnectDraft(null);
          openCreatePanelAtClient(e.clientX, e.clientY);
        }}
        onPaneMouseMove={(e) => {
          lastCanvasPointerClientPosRef.current = { x: e.clientX, y: e.clientY };
        }}
        onNodeMouseMove={(e) => {
          lastCanvasPointerClientPosRef.current = { x: e.clientX, y: e.clientY };
        }}
        onSelectionChange={onFlowSelectionChange}
        elevateNodesOnSelect
        onNodeClick={(e, node) => {
          setCanvasStackFrontId(node.id);
          dispatchCloseMediaLightbox();
          onNodeClickPickImage(e, node);
        }}
        onInit={(inst) => {
          setRf(inst);
          try {
            setViewportZoom(inst.getZoom());
          } catch {
            setViewportZoom(1);
          }
          requestAnimationFrame(() => runViewportVisibilityCheck(inst));
        }}
        onMove={(_, v) => {
          setViewportZoom(v.zoom);
          if (selectionBboxFlowRef.current) {
            if (viewportSeqRafRef.current == null) {
              viewportSeqRafRef.current = window.requestAnimationFrame(() => {
                viewportSeqRafRef.current = null;
                setViewportSeq((s) => s + 1);
              });
            }
          }
          scheduleViewportNodeCheck();
        }}
        onMoveEnd={() => {
          if (viewportSeqRafRef.current != null) {
            window.cancelAnimationFrame(viewportSeqRafRef.current);
            viewportSeqRafRef.current = null;
          }
          setViewportSeq((s) => s + 1);
          scheduleViewportNodeCheck();
        }}
        onNodesDelete={onNodesDelete}
        deleteKeyCode={["Delete", "Backspace"]}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{
          type: CANVAS_EDGE_TYPE,
          style: { strokeWidth: 1.55 },
        }}
        connectionRadius={88}
        autoPanOnConnect
        snapToGrid={snapToGridEnabled}
        nodeDragThreshold={0}
        connectionLineStyle={{
          stroke: "rgba(212, 212, 216, 0.82)",
          strokeWidth: 1.7,
        }}
        nodesDraggable
        nodesConnectable
        elementsSelectable
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        multiSelectionKeyCode="Shift"
        panOnDrag={[1]}
        autoPanOnNodeDrag={DRAG_SPEED_PRESETS[dragSpeedLevel].autoPanOnNodeDrag}
        minZoom={MIN_CANVAS_ZOOM}
        maxZoom={MAX_CANVAS_ZOOM}
        zoomOnScroll={false}
        panOnScroll={false}
        panOnScrollSpeed={DRAG_SPEED_PRESETS[dragSpeedLevel].panOnScrollSpeed}
        onlyRenderVisibleElements
        fitView
        fitViewOptions={{ minZoom: 0.45, maxZoom: 0.45, padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          className="canvas-dot-grid"
          variant={BackgroundVariant.Dots}
          gap={18}
          size={1.28}
          color="rgba(255,255,255,0.16)"
        />
        {minimapVisible ? (
          <MiniMap
            position="bottom-left"
            className="canvas-minimap !shadow-lg"
            style={{
              width: 200,
              height: 150,
              marginBottom: 88,
            }}
            nodeColor={minimapNodeColor}
            nodeStrokeColor="rgba(255,255,255,0.12)"
            maskColor="rgba(9, 9, 11, 0.78)"
            maskStrokeColor="rgba(212, 212, 216, 0.42)"
            maskStrokeWidth={2}
            pannable
            zoomable
            zoomStep={12}
            ariaLabel="画布缩略图：可拖拽平移视口，滚轮缩放"
          />
        ) : null}
        <Panel position="bottom-center" className="pointer-events-none z-[24] m-4 mb-6 flex justify-center">
          {nodes.length > 0 && !viewportShowsNodes ? (
            <div className="pointer-events-auto flex max-w-[min(92vw,520px)] items-center gap-3 rounded-full border border-white/14 bg-zinc-900/78 px-4 py-2 text-sm shadow-lg backdrop-blur-md ring-1 ring-white/[0.07]">
              <span className="min-w-0 flex-1 leading-snug text-zinc-300">
                当前视窗内看不到节点，可以点击按钮快速回到内容区域。
              </span>
              <button
                type="button"
                className="inline-flex h-8 shrink-0 items-center justify-center rounded-md bg-zinc-100 px-3 text-xs font-medium text-zinc-950 shadow transition-colors hover:bg-zinc-200"
                onClick={() => {
                  try {
                    (rf as { fitView?: (o?: { padding?: number; duration?: number }) => void })?.fitView?.({
                      padding: 0.2,
                      duration: 380,
                    });
                  } catch {
                    /* ignore */
                  }
                  requestAnimationFrame(() => scheduleViewportNodeCheck());
                }}
              >
                回到节点
              </button>
            </div>
          ) : null}
        </Panel>
      </ReactFlow>
      <div
        className="pointer-events-auto absolute z-[130] m-3 transition-[left] duration-300"
        style={{ left: sidebarMode === "expanded" ? 366 : 72, bottom: 0 }}
      >
        <div className="flex items-center gap-x-1.5">
          <div className="flex h-8 items-center justify-center rounded-xl border border-white/12 bg-zinc-900/68 px-1 shadow-[0_10px_24px_rgba(0,0,0,0.24)] backdrop-blur-md">
            <button
              type="button"
              title={minimapVisible ? "隐藏画布缩略图" : "显示画布缩略图"}
              aria-label={minimapVisible ? "隐藏画布缩略图" : "显示画布缩略图"}
              aria-pressed={minimapVisible}
              className={[
                "mr-0.5 flex aspect-square h-6 w-6 cursor-pointer items-center justify-center rounded-lg px-1 transition-colors duration-300",
                minimapVisible
                  ? "bg-white/15 text-zinc-100 hover:bg-white/25 hover:text-white"
                  : "text-zinc-500 hover:bg-zinc-700/58 hover:text-zinc-200",
              ].join(" ")}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMinimapVisible((v) => !v);
              }}
            >
              <MapPinned className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            <button
              type="button"
              title="缩小"
              className="mr-0.5 flex aspect-square h-6 w-6 cursor-pointer items-center justify-center rounded-lg text-zinc-400 transition-colors duration-300 hover:bg-zinc-700/58 hover:text-white"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (rf && typeof rf.zoomOut === "function") rf.zoomOut({ duration: 180 });
              }}
            >
              <ZoomOut className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            <button
              type="button"
              title="放大"
              className="flex aspect-square h-6 w-6 cursor-pointer items-center justify-center rounded-lg text-zinc-400 transition-colors duration-300 hover:bg-zinc-700/58 hover:text-white"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (rf && typeof rf.zoomIn === "function") rf.zoomIn({ duration: 180 });
              }}
            >
              <ZoomIn className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            <button
              type="button"
              title={`拖拽速度档位：${DRAG_SPEED_PRESETS[dragSpeedLevel].label}（点击切换）`}
              className="ml-1 inline-flex h-6 items-center justify-center rounded-lg border border-white/12 bg-zinc-800/48 px-1.5 text-[10px] font-medium text-zinc-200 transition-colors hover:bg-zinc-700/58 hover:text-zinc-100"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragSpeedLevel((prev) =>
                  prev === "normal" ? "fast" : prev === "fast" ? "extreme" : "normal"
                );
              }}
            >
              拖拽·{DRAG_SPEED_PRESETS[dragSpeedLevel].label}
            </button>
            <button
              type="button"
              title={snapToGridEnabled ? "关闭吸附" : "开启吸附"}
              aria-label={snapToGridEnabled ? "关闭吸附" : "开启吸附"}
              aria-pressed={snapToGridEnabled}
              className={[
                "flex aspect-square h-6 w-6 cursor-pointer items-center justify-center rounded-lg transition-colors duration-300",
                snapToGridEnabled
                  ? "bg-white/15 text-zinc-100 hover:bg-white/25 hover:text-white"
                  : "text-zinc-400 hover:bg-zinc-700/58 hover:text-white",
              ].join(" ")}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setSnapToGridEnabled((v) => !v);
              }}
            >
              <Grid2X2 className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            <button
              type="button"
              title="聚焦当前内容"
              className="flex aspect-square h-6 w-6 cursor-pointer items-center justify-center rounded-lg text-zinc-300 transition-colors duration-300 hover:bg-zinc-700/58 hover:text-white"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                fitSelectionOrView();
              }}
            >
              <Scan className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            <div
              className="flex h-6 min-w-[2.4rem] items-center justify-center rounded-lg bg-zinc-800/48 px-1.5 text-[10px] font-medium tabular-nums text-zinc-200 ring-1 ring-white/[0.06]"
              title="当前缩放比例"
            >
              {Math.round(viewportZoom * 100)}%
            </div>
            <div className="flex h-6 w-[86px] items-center gap-1 rounded-lg bg-zinc-800/48 px-1.5 ring-1 ring-white/[0.06]">
              <input
                type="range"
                min={MIN_CANVAS_ZOOM}
                max={MAX_CANVAS_ZOOM}
                step={0.02}
                value={viewportZoom}
                onChange={(e) => onZoomSlider(Number(e.target.value))}
                className="h-1.5 w-full cursor-pointer accent-zinc-300"
                aria-label="画布缩放"
              />
            </div>
          </div>
        </div>
      </div>
      {selectionToolbarScreenPos &&
      (selectionToolbarCanGroup ||
        selectionToolbarCanDelete ||
        selectedCanvasDownloadAssets.length > 0) ? (
        <div
          className="pointer-events-auto fixed z-[120] flex items-center gap-1 rounded-xl border border-white/18 bg-zinc-900/74 p-1.5 text-zinc-200 shadow-[0_10px_24px_rgba(0,0,0,0.30)] backdrop-blur-md"
          style={{ left: selectionToolbarScreenPos.x, top: selectionToolbarScreenPos.y }}
        >
          {selectionToolbarCanGroup ? (
            <button
              type="button"
              title="编组"
              className="flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-zinc-800/50 px-3 text-[12px] font-medium text-zinc-100 transition-colors hover:bg-zinc-700/70"
              onClick={() => groupSelectedNodes()}
            >
              <Layers className="h-4 w-4" strokeWidth={2} />
              <span>分组</span>
            </button>
          ) : null}
          {selectedCanvasDownloadAssets.length > 0 ? (
            <button
              type="button"
              title={`下载选中的 ${selectedCanvasDownloadAssets.length} 个素材`}
              className="flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-zinc-800/50 px-3 text-[12px] font-medium text-zinc-100 transition-colors hover:bg-zinc-700/70"
              onClick={() => {
                void batchDownloadAssets(selectedCanvasDownloadAssets);
              }}
            >
              <Download className="h-4 w-4" strokeWidth={2} />
              <span>下载</span>
            </button>
          ) : null}
          {selectionToolbarCanDelete ? (
            <button
              type="button"
              title="删除选中卡片"
              className="flex h-10 items-center gap-2 rounded-lg border border-red-400/20 bg-red-500/12 px-3 text-[12px] font-medium text-red-100 transition-colors hover:bg-red-500/20"
              onClick={() => deleteSelectedCanvasItemsForActions()}
            >
              <Trash2 className="h-4 w-4" strokeWidth={2} />
              <span>删除</span>
            </button>
          ) : null}
        </div>
      ) : null}
      {activeCanvasTasks.length > 0 ? (
        <div className="pointer-events-auto fixed bottom-4 right-4 z-[121] w-[min(92vw,420px)] rounded-2xl border border-sky-300/18 bg-zinc-950/88 p-2 shadow-[0_18px_42px_rgba(0,0,0,0.34)] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3 px-2 py-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-400/12 text-sky-200 ring-1 ring-sky-300/18">
                <Loader2 className="h-4 w-4 animate-spin" />
              </span>
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-white">
                  后台任务进行中
                </div>
                <div className="text-[11px] text-zinc-400">
                  当前 {activeCanvasTasks.length} 个任务仍在同步，不受节点是否在视野内影响
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/12 bg-zinc-800/56 px-2 text-[11px] text-zinc-200 transition-colors hover:border-white/20 hover:bg-zinc-700/62 hover:text-white"
                onClick={() => {
                  setTasksOpen(true);
                  void loadTaskHistory();
                }}
                title="打开任务记录"
              >
                <History className="h-3.5 w-3.5" />
                <span>任务记录</span>
              </button>
              <button
                type="button"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/12 bg-zinc-800/56 text-zinc-200 transition-colors hover:border-white/20 hover:bg-zinc-700/62 hover:text-white"
                onClick={() => void loadTaskHistory()}
                title="刷新后台任务状态"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="mt-1 space-y-1">
            {activeCanvasTasks.slice(0, 3).map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-medium text-zinc-100">
                    {task.title}
                  </div>
                  <div className="mt-0.5 text-[10px] text-zinc-500">
                    {task.kind === "prompt2" ? "视频节点" : "生图节点"}
                  </div>
                  <div className="truncate text-[11px] text-zinc-400">{task.statusLine}</div>
                  {task.submitId ? (
                    <div className="truncate text-[10px] text-zinc-500">
                      {task.submitId}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-800/56 px-2 text-[11px] text-zinc-100 transition-colors hover:bg-zinc-700/70"
                  onClick={() => focusNodesByIds([task.id])}
                  title="定位到任务节点"
                >
                  <LocateFixed className="h-3.5 w-3.5" />
                  <span>定位</span>
                </button>
              </div>
            ))}
            {activeCanvasTasks.length > 3 ? (
              <div className="px-2 pt-1 text-center text-[10px] text-zinc-500">
                还有 {activeCanvasTasks.length - 3} 个任务在后台继续运行
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="absolute right-3 top-3 z-20 flex items-center gap-1.5 rounded-xl border border-white/12 bg-zinc-900/68 p-1 shadow-[0_10px_26px_rgba(0,0,0,0.24)] backdrop-blur-md">
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/12 bg-zinc-800/48 px-2 text-[11px] text-zinc-200 transition-colors hover:border-white/20 hover:bg-zinc-700/58 hover:text-white"
          onClick={() => setTasksOpen(true)}
          title="查看任务记录（submit_id / list_task）"
        >
          <History className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">任务记录</span>
        </button>
        <button
          type="button"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/12 bg-zinc-800/48 text-zinc-200 transition-colors hover:border-white/20 hover:bg-zinc-700/58 hover:text-white"
          onClick={() => {
            refreshCredit();
            void loadTaskHistory();
          }}
          title="刷新积分、GPT 余额和任务状态"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/12 bg-zinc-800/48 px-2 text-[11px] text-zinc-200 transition-colors hover:border-white/20 hover:bg-zinc-700/58 hover:text-white disabled:opacity-60"
          onClick={handleLogin}
          disabled={browserPickerLoading}
          title="点击打开扫码登录"
        >
          <LogIn className="h-3.5 w-3.5" />
          <span className="whitespace-nowrap">
            {browserPickerLoading
              ? "检测浏览器..."
              : loginState === "logged_in"
                ? "已登录"
                : "未登录"}
          </span>
        </button>
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/12 bg-zinc-800/48 px-2 text-[11px] text-zinc-200 transition-colors hover:border-white/20 hover:bg-zinc-700/58 hover:text-white"
          onClick={handleLogout}
          title="退出即梦"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span>登出</span>
        </button>
        <div className="relative" ref={creditMenuRef}>
          <button
            type="button"
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-white/12 bg-zinc-800/48 px-2 text-[11px] text-zinc-200 transition-colors hover:border-white/20 hover:bg-zinc-700/58 hover:text-white"
            onClick={() => setCreditMenuOpen((open) => !open)}
            title={`查看即梦积分和 ${EXTERNAL_BALANCE_LABEL} 余额`}
          >
            <Coins className="h-3.5 w-3.5 text-zinc-200" />
            <span className="tabular-nums font-medium text-white/95">
              {creditLoading ? "..." : formatBalanceNumber(totalCredit)}
            </span>
            <span className="hidden text-[11px] text-zinc-300 lg:inline">
              {EXTERNAL_BALANCE_LABEL} {creditLoading ? "..." : externalApiBalanceText ?? "--"}
              {externalApiBalanceCurrency ? ` ${externalApiBalanceCurrency}` : ""}
            </span>
            <ChevronDown
              className={[
                "h-3.5 w-3.5 text-zinc-500 transition-transform",
                creditMenuOpen ? "rotate-180" : "",
              ].join(" ")}
            />
          </button>
          {creditMenuOpen ? (
            <div className="absolute right-0 top-[calc(100%+6px)] z-[70] w-[min(92vw,260px)] rounded-xl border border-white/12 bg-zinc-900/92 p-2 shadow-[0_16px_42px_rgba(0,0,0,0.36)] backdrop-blur-xl">
              <div className="mb-1.5 flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-medium text-white">余额详情</div>
                  <div className="text-[10px] text-zinc-500">随顶部刷新按钮同步更新</div>
                </div>
                <button
                  type="button"
                  className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-200 transition-colors hover:bg-white/10"
                  onClick={refreshCredit}
                >
                  刷新
                </button>
              </div>
              <div className="space-y-1.5">
                <div className="rounded-lg border border-white/10 bg-white/[0.05] px-2 py-1.5">
                  <div className="text-[10px] text-zinc-300/75">即梦积分</div>
                  <div className="mt-0.5 tabular-nums text-sm font-semibold text-white">
                    {creditLoading ? "..." : formatBalanceNumber(totalCredit)}
                  </div>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5">
                  <div className="text-[10px] text-zinc-400">{EXTERNAL_BALANCE_LABEL} 余额</div>
                  <div className="mt-0.5 tabular-nums text-sm font-semibold text-white">
                    {creditLoading
                      ? "..."
                      : externalApiBalanceText ?? formatBalanceNumber(externalApiBalance)}
                    {externalApiBalanceCurrency ? (
                      <span className="ml-1 text-[10px] font-medium text-zinc-400">
                        {externalApiBalanceCurrency}
                      </span>
                    ) : null}
                  </div>
                  {externalApiBalanceError ? (
                    <div className="mt-1 text-[10px] text-amber-300">{externalApiBalanceError}</div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
        {cliVersion ? (
          <span
            className="hidden max-w-[140px] truncate text-[10px] text-zinc-500 lg:inline"
            title={cliVersion}
          >
            {cliVersion}
          </span>
        ) : null}
      </div>
      <MediaHistoryPanel
        open={mediaHistoryOpen}
        variant="sheet"
        onClose={() => setMediaHistoryOpen(false)}
        onLoadToCanvas={loadHistoryEntryToCanvas}
        onLoadManyToCanvas={loadHistoryEntriesToCanvas}
      />
      {packagedCacheOnboarding === true ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="relative z-10 w-[min(92vw,560px)] rounded-xl border border-white/12 bg-zinc-950 p-5 shadow-2xl">
            <h2 className="text-base font-semibold text-white">请先设置成片缓存目录</h2>
            <p className="mt-2 text-xs leading-relaxed text-zinc-400">
              桌面版需要把图片和视频成片保存到
              <strong className="text-zinc-200">你有读写权限</strong>
              的文件夹中，不要选择安装目录或系统保护路径。设置完成后，画布预览和历史缩略图都会从这里读取。
            </p>
            <div className="mt-4 space-y-2">
              <label className="block text-[11px] text-zinc-400">缓存目录（绝对路径）</label>
              <input
                value={cacheOnboardingInput}
                onChange={(e) => setCacheOnboardingInput(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-2 font-mono text-[11px] text-zinc-200 outline-none ring-zinc-400/35 focus:ring"
                placeholder="点击“选择文件夹”或直接粘贴路径"
                disabled={cacheOnboardingBusy}
              />
              {cacheOnboardingErr ? (
                <p className="text-[11px] text-amber-300">{cacheOnboardingErr}</p>
              ) : null}
              <label className="flex cursor-pointer items-start gap-2 text-[11px] text-zinc-400">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={cacheOnboardingClean}
                  onChange={(e) => setCacheOnboardingClean(e.target.checked)}
                  disabled={cacheOnboardingBusy}
                />
                <span>
                  清理当前用户数据目录下的临时成片，并删除 `%TEMP%` 里的调试日志，给新环境一个干净起点。
                </span>
              </label>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white hover:bg-white/10 disabled:opacity-50"
                onClick={() => void pickOnboardingCacheDir()}
                disabled={cacheOnboardingBusy}
              >
                选择文件夹
              </button>
              <button
                type="button"
                className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200 disabled:opacity-50"
                onClick={() => void completePackagedCacheOnboarding()}
                disabled={cacheOnboardingBusy}
              >
                确认并开始使用
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {cacheSettingsOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-[2px]">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="关闭"
            onClick={() => setCacheSettingsOpen(false)}
          />
          <div className="relative z-10 w-[min(92vw,560px)] rounded-xl border border-white/10 bg-zinc-950/95 p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-white">缓存目录设置</h2>
              <button
                type="button"
                className="rounded-md p-1.5 text-zinc-400 hover:bg-white/5 hover:text-white"
                onClick={() => setCacheSettingsOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-2 text-xs text-zinc-400">
              桌面版默认使用应用用户数据目录下的可写文件夹；安装目录通常是只读的。你也可以随时改到其他磁盘。
            </p>
            <div className="space-y-2">
              <label className="block text-[11px] text-zinc-400">当前目录</label>
              <input
                value={cacheDirInput}
                onChange={(e) => setCacheDirInput(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-2 font-mono text-[11px] text-zinc-200 outline-none ring-zinc-400/35 focus:ring"
                placeholder={cacheDirDefault || "输入绝对路径"}
                disabled={cacheDirBusy}
              />
              {cacheDirCurrent ? (
                <p className="text-[11px] text-zinc-500">生效目录：{cacheDirCurrent}</p>
              ) : null}
              {cacheDirErr ? (
                <p className="text-[11px] text-amber-300">{cacheDirErr}</p>
              ) : null}
            </div>
            <div className="mt-5 border-t border-white/10 pt-4">
              <h3 className="mb-2 text-sm font-medium text-white">外部图片 API</h3>
              <div className="space-y-2">
                <label className="block text-[11px] text-zinc-400">图片 API 渠道</label>
                <select
                  value={externalApiProviderId}
                  onChange={(e) =>
                    void switchExternalApiProvider(
                      normalizeExternalImageApiProviderId(e.target.value)
                    )
                  }
                  className="h-8 w-full rounded-md border border-white/10 bg-zinc-950 px-2 text-[10px] text-zinc-200 outline-none ring-zinc-400/30 transition-colors focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/30"
                  disabled={externalApiBusy}
                >
                  {externalApiProviders.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-zinc-500">
                  选择厂商后，下方模型列表会切到该厂商的生图模型。
                </p>
                <label className="block text-[11px] text-zinc-400">API 名称</label>
                <input
                  value={externalApiDisplayName}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    setExternalApiDisplayName(nextValue);
                    setExternalApiProviders((prev) =>
                      prev.map((provider) =>
                        provider.id === externalApiProviderId
                          ? { ...provider, label: nextValue || provider.label }
                          : provider
                      )
                    );
                    setExternalApiProviderConfigs((prev) => ({
                      ...prev,
                      [externalApiProviderId]: {
                        displayName: nextValue,
                        baseUrl: prev[externalApiProviderId]?.baseUrl ?? externalApiBaseUrl,
                        apiKey: prev[externalApiProviderId]?.apiKey ?? externalApiKey,
                        imageModel: prev[externalApiProviderId]?.imageModel ?? externalApiImageModel,
                        textModel: prev[externalApiProviderId]?.textModel ?? externalApiTextModel,
                        imageCostPerGeneration: optionalCostInputForConfig(externalApiImageCost),
                        imageCostCurrency: externalApiImageCostCurrency.trim() || "$",
                      },
                    }));
                  }}
                  className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-2 text-[11px] text-zinc-200 outline-none ring-zinc-400/35 focus:ring"
                  placeholder="例如 ForOpenCode 图片"
                  disabled={externalApiBusy}
                />
                <label className="block text-[11px] text-zinc-400">API 地址</label>
                <input
                  value={externalApiBaseUrl}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    setExternalApiBaseUrl(nextValue);
                    setExternalApiProviderConfigs((prev) => ({
                      ...prev,
                      [externalApiProviderId]: {
                        displayName: prev[externalApiProviderId]?.displayName ?? externalApiDisplayName,
                        baseUrl: nextValue,
                        apiKey: prev[externalApiProviderId]?.apiKey ?? externalApiKey,
                        imageModel: prev[externalApiProviderId]?.imageModel ?? externalApiImageModel,
                        textModel: prev[externalApiProviderId]?.textModel ?? externalApiTextModel,
                        imageCostPerGeneration: optionalCostInputForConfig(externalApiImageCost),
                        imageCostCurrency: externalApiImageCostCurrency.trim() || "$",
                      },
                    }));
                  }}
                  className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-2 font-mono text-[11px] text-zinc-200 outline-none ring-zinc-400/35 focus:ring"
                  placeholder="例如 http://82.156.254.79:3000 或 http://82.156.254.79:3000/v1"
                  disabled={externalApiBusy}
                />
                <label className="block text-[11px] text-zinc-400">API 密钥</label>
                <input
                  value={externalApiKey}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    setExternalApiKey(nextValue);
                    setExternalApiProviderConfigs((prev) => ({
                      ...prev,
                      [externalApiProviderId]: {
                        displayName: prev[externalApiProviderId]?.displayName ?? externalApiDisplayName,
                        baseUrl: prev[externalApiProviderId]?.baseUrl ?? externalApiBaseUrl,
                        apiKey: nextValue,
                        imageModel: prev[externalApiProviderId]?.imageModel ?? externalApiImageModel,
                        textModel: prev[externalApiProviderId]?.textModel ?? externalApiTextModel,
                        imageCostPerGeneration: optionalCostInputForConfig(externalApiImageCost),
                        imageCostCurrency: externalApiImageCostCurrency.trim() || "$",
                      },
                    }));
                  }}
                  className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-2 font-mono text-[11px] text-zinc-200 outline-none ring-zinc-400/35 focus:ring"
                  placeholder="sk-..."
                  disabled={externalApiBusy}
                />
                <label className="block text-[11px] text-zinc-400">图片模型</label>
                <select
                  value={externalApiImageModel}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    setExternalApiImageModel(nextValue);
                    setExternalApiProviderConfigs((prev) => ({
                      ...prev,
                      [externalApiProviderId]: {
                        displayName: prev[externalApiProviderId]?.displayName ?? externalApiDisplayName,
                        baseUrl: prev[externalApiProviderId]?.baseUrl ?? externalApiBaseUrl,
                        apiKey: prev[externalApiProviderId]?.apiKey ?? externalApiKey,
                        imageModel: nextValue,
                        textModel: prev[externalApiProviderId]?.textModel ?? externalApiTextModel,
                        imageCostPerGeneration: optionalCostInputForConfig(externalApiImageCost),
                        imageCostCurrency: externalApiImageCostCurrency.trim() || "$",
                      },
                    }));
                  }}
                  className="h-8 w-full rounded-md border border-white/10 bg-zinc-950 px-2 text-[10px] text-zinc-200 outline-none ring-zinc-400/30 transition-colors focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/30"
                  disabled={externalApiBusy}
                >
                  {externalApiModelOptions.map((model) => (
                    <option key={model} value={model} />
                  ))}
                </select>
                <label className="block text-[11px] text-zinc-400">文本模型</label>
                <input
                  value={externalApiTextModel}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    setExternalApiTextModel(nextValue);
                    setExternalApiProviderConfigs((prev) => ({
                      ...prev,
                      [externalApiProviderId]: {
                        displayName: prev[externalApiProviderId]?.displayName ?? externalApiDisplayName,
                        baseUrl: prev[externalApiProviderId]?.baseUrl ?? externalApiBaseUrl,
                        apiKey: prev[externalApiProviderId]?.apiKey ?? externalApiKey,
                        imageModel: prev[externalApiProviderId]?.imageModel ?? externalApiImageModel,
                        textModel: nextValue,
                        imageCostPerGeneration: optionalCostInputForConfig(externalApiImageCost),
                        imageCostCurrency: externalApiImageCostCurrency.trim() || "$",
                      },
                    }));
                  }}
                  className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-2 font-mono text-[11px] text-zinc-200 outline-none ring-zinc-400/35 focus:ring"
                  placeholder="例如 gpt-image-2-c"
                  disabled={externalApiBusy}
                />
                <div className="grid grid-cols-[minmax(0,1fr)_72px] gap-2">
                  <label className="block text-[11px] text-zinc-400">
                    单次生图花费（可选）
                    <input
                      type="number"
                      min="0"
                      step="0.000001"
                      value={externalApiImageCost}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        setExternalApiImageCost(nextValue);
                        setExternalApiProviderConfigs((prev) => ({
                          ...prev,
                          [externalApiProviderId]: {
                            displayName: prev[externalApiProviderId]?.displayName ?? externalApiDisplayName,
                            baseUrl: prev[externalApiProviderId]?.baseUrl ?? externalApiBaseUrl,
                            apiKey: prev[externalApiProviderId]?.apiKey ?? externalApiKey,
                            imageModel: prev[externalApiProviderId]?.imageModel ?? externalApiImageModel,
                            textModel: prev[externalApiProviderId]?.textModel ?? externalApiTextModel,
                            imageCostPerGeneration: optionalCostInputForConfig(nextValue),
                            imageCostCurrency: externalApiImageCostCurrency.trim() || "$",
                          },
                        }));
                      }}
                      className="mt-1 w-full rounded-md border border-white/10 bg-black/40 px-2 py-2 font-mono text-[11px] text-zinc-200 outline-none ring-zinc-400/35 focus:ring"
                      placeholder="留空隐藏"
                      disabled={externalApiBusy}
                    />
                  </label>
                  <label className="block text-[11px] text-zinc-400">
                    货币
                    <input
                      value={externalApiImageCostCurrency}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        setExternalApiImageCostCurrency(nextValue);
                        setExternalApiProviderConfigs((prev) => ({
                          ...prev,
                          [externalApiProviderId]: {
                            displayName: prev[externalApiProviderId]?.displayName ?? externalApiDisplayName,
                            baseUrl: prev[externalApiProviderId]?.baseUrl ?? externalApiBaseUrl,
                            apiKey: prev[externalApiProviderId]?.apiKey ?? externalApiKey,
                            imageModel: prev[externalApiProviderId]?.imageModel ?? externalApiImageModel,
                            textModel: prev[externalApiProviderId]?.textModel ?? externalApiTextModel,
                            imageCostPerGeneration: optionalCostInputForConfig(externalApiImageCost),
                            imageCostCurrency: nextValue.trim() || "$",
                          },
                        }));
                      }}
                      className="mt-1 w-full rounded-md border border-white/10 bg-black/40 px-2 py-2 font-mono text-[11px] text-zinc-200 outline-none ring-zinc-400/35 focus:ring"
                      placeholder="$"
                      disabled={externalApiBusy}
                    />
                  </label>
                </div>
                <p className="text-[11px] text-zinc-500">
                  留空时任务记录不显示花费；填写后新任务会按每次生图写入日志。
                </p>
                {externalApiLastUsage ? (
                  <div className="rounded-md border border-white/12 bg-white/8 px-2 py-2 text-[11px] text-zinc-100">
                    最近一次消耗：
                    {externalApiLastUsage.total_tokens ?? "--"} 令牌
                    {typeof externalApiLastUsage.input_tokens === "number"
                      ? `（输入 ${externalApiLastUsage.input_tokens}`
                      : ""}
                    {typeof externalApiLastUsage.output_tokens === "number"
                      ? ` / 输出 ${externalApiLastUsage.output_tokens}`
                      : ""}
                    {typeof externalApiLastUsage.input_tokens === "number" ||
                    typeof externalApiLastUsage.output_tokens === "number"
                      ? "）"
                      : ""}
                    {externalApiLastUsage.model ? ` · 模型 ${externalApiLastUsage.model}` : ""}
                  </div>
                ) : (
                  <div className="text-[11px] text-zinc-500">最近一次消耗：暂无</div>
                )}
                {externalApiErr ? (
                  <p className="text-[11px] text-amber-300">{externalApiErr}</p>
                ) : null}
                {externalApiDebugNote ? (
                  <p className="text-[11px] text-emerald-300">{externalApiDebugNote}</p>
                ) : null}
              </div>
            </div>
            <div className="mt-5 border-t border-white/10 pt-4">
              <h3 className="mb-2 text-sm font-medium text-white">外部生视频 API</h3>
              <div className="space-y-2">
                <label className="block text-[11px] text-zinc-400">视频 API 渠道</label>
                <select
                  value="foropencode"
                  className="h-8 w-full rounded-md border border-white/10 bg-zinc-950 px-2 text-[10px] text-zinc-200 outline-none ring-zinc-400/30 transition-colors focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/30"
                  disabled
                >
                  {EXTERNAL_VIDEO_PROVIDER_OPTIONS.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </select>
                <label className="block text-[11px] text-zinc-400">API 名称</label>
                <input
                  value={externalVideoApiDisplayName}
                  onChange={(e) => setExternalVideoApiDisplayName(e.target.value)}
                  className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-2 text-[11px] text-zinc-200 outline-none ring-zinc-400/35 focus:ring"
                  placeholder="例如 首尾帧"
                  disabled={externalVideoApiBusy}
                />
                <label className="block text-[11px] text-zinc-400">API 地址</label>
                <input
                  value={externalVideoApiBaseUrl}
                  onChange={(e) => setExternalVideoApiBaseUrl(e.target.value)}
                  className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-2 font-mono text-[11px] text-zinc-200 outline-none ring-zinc-400/35 focus:ring"
                  placeholder="例如 https://www.foropencode.com/v1"
                  disabled={externalVideoApiBusy}
                />
                <label className="block text-[11px] text-zinc-400">API 密钥</label>
                <input
                  value={externalVideoApiKey}
                  onChange={(e) => setExternalVideoApiKey(e.target.value)}
                  className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-2 font-mono text-[11px] text-zinc-200 outline-none ring-zinc-400/35 focus:ring"
                  placeholder="sk-..."
                  disabled={externalVideoApiBusy}
                />
                <label className="block text-[11px] text-zinc-400">默认视频模型</label>
                <select
                  value={externalVideoApiModel}
                  onChange={(e) => setExternalVideoApiModel(e.target.value)}
                  className="h-8 w-full rounded-md border border-white/10 bg-zinc-950 px-2 text-[10px] text-zinc-200 outline-none ring-zinc-400/30 transition-colors focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/30"
                  disabled={externalVideoApiBusy}
                >
                  {externalVideoApiModelOptions.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-zinc-500">
                  生视频节点切到“视频API”后，会从这里读取模型列表和鉴权。
                </p>
                {externalVideoApiErr ? (
                  <p className="text-[11px] text-amber-300">{externalVideoApiErr}</p>
                ) : null}
                {externalVideoApiDebugNote ? (
                  <p className="text-[11px] text-sky-300">{externalVideoApiDebugNote}</p>
                ) : null}
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white hover:bg-white/10 disabled:opacity-50"
                onClick={() => void pickCacheDirBySystemDialog()}
                disabled={cacheDirBusy}
              >
                选择目录
              </button>
              <button
                type="button"
                className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white hover:bg-white/10 disabled:opacity-50"
                onClick={() => void openCacheDirInExplorer()}
                disabled={cacheDirBusy}
              >
                打开目录
              </button>
              <button
                type="button"
                className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200 disabled:opacity-50"
                onClick={() => void saveCacheDir()}
                disabled={cacheDirBusy}
              >
                保存并应用
              </button>
              <button
                type="button"
                className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white hover:bg-white/10 disabled:opacity-50"
                onClick={() => void debugExternalApiConfig()}
                disabled={externalApiBusy}
              >
                调试图片 API
              </button>
              <button
                type="button"
                className="rounded-md bg-emerald-600/85 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500/90 disabled:opacity-50"
                onClick={() => void saveExternalApiConfig()}
                disabled={externalApiBusy}
              >
                保存 API 配置
              </button>
              <button
                type="button"
                className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white hover:bg-white/10 disabled:opacity-50"
                onClick={() => void debugExternalVideoApiConfig()}
                disabled={externalVideoApiBusy}
              >
                调试视频 API
              </button>
              <button
                type="button"
                className="rounded-md bg-sky-600/85 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500/90 disabled:opacity-50"
                onClick={() => void saveExternalVideoApiConfig()}
                disabled={externalVideoApiBusy}
              >
                保存生视频 API
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {loginDiagOpen ? (
        <div className="fixed inset-0 z-[60] flex justify-end bg-black/50 backdrop-blur-[2px]">
          <button
            type="button"
            className="h-full flex-1 cursor-default"
            aria-label="关闭"
            onClick={() => setLoginDiagOpen(false)}
          />
          <div className="flex h-full w-full max-w-lg flex-col border-l border-white/10 bg-zinc-950/98 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <h2 className="text-sm font-medium text-white">登录诊断</h2>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="rounded-lg px-2 py-1 text-[11px] text-zinc-300 hover:bg-white/5 disabled:opacity-40"
                  onClick={() => void captureLoginDebugToFile()}
                  disabled={!!loginDiagBusy}
                  title="运行 dreamina login --debug，并把输出保存到 jimengpro-login-debug.log"
                >
                  捕获 debug 日志
                </button>
                <button
                  type="button"
                  className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-white"
                  title="刷新"
                  onClick={() => void loadLoginDiagnostics()}
                  disabled={loginDiagLoading}
                >
                  <RefreshCw className={`h-4 w-4 ${loginDiagLoading ? "animate-spin" : ""}`} />
                </button>
                <button
                  type="button"
                  className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-white"
                  title="关闭"
                  onClick={() => setLoginDiagOpen(false)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-xs text-zinc-300">
              {loginDiagBusy === "capture" ? (
                <p className="mb-2 text-amber-200/90">
                  正在运行 `dreamina login --debug`，完成后会把结果写入本地日志。
                </p>
              ) : null}
              {loginDiagErr ? (
                <p className="mb-2 rounded border border-red-500/30 bg-red-950/40 px-2 py-1 text-red-200">
                  {loginDiagErr}
                </p>
              ) : null}
              {!loginDiagData && loginDiagLoading ? (
                <p className="text-zinc-500">加载中...</p>
              ) : null}
              {loginDiagData ? (
                <>
                  <section className="mb-4">
                    <h3 className="mb-1 font-medium text-white">运行环境</h3>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-black/40 p-2 font-mono text-[10px] text-zinc-400">
                      {JSON.stringify(
                        {
                          platform: loginDiagData.platform,
                          pid: loginDiagData.pid,
                          nodeVersion: loginDiagData.nodeVersion,
                          userInfo: loginDiagData.userInfo,
                          nodeHomedir: loginDiagData.nodeHomedir,
                          cwd: loginDiagData.cwd,
                          cliBin: loginDiagData.cliBin,
                          cliOnDisk: loginDiagData.cliOnDisk,
                        },
                        null,
                        2
                      )}
                    </pre>
                  </section>
                  <section className="mb-4">
                    <h3 className="mb-1 font-medium text-white">环境变量快照</h3>
                    <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all rounded bg-black/40 p-2 font-mono text-[10px] text-zinc-400">
                      {JSON.stringify(
                        (loginDiagData.env as Record<string, unknown> | undefined) ?? {},
                        null,
                        2
                      )}
                    </pre>
                  </section>
                  <section className="mb-4">
                    <h3 className="mb-1 font-medium text-white">dreamina 版本</h3>
                    <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-black/40 p-2 font-mono text-[10px] text-zinc-400">
                      {String(loginDiagData.versionText ?? "")}
                    </pre>
                  </section>
                  <section className="mb-4">
                    <h3 className="mb-1 font-medium text-white">dreamina 积分</h3>
                    <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all rounded bg-black/40 p-2 font-mono text-[10px] text-zinc-400">
                      {String(loginDiagData.userCreditText ?? "")}
                    </pre>
                  </section>
                  <section className="mb-4">
                    <h3 className="mb-1 font-medium text-white">凭证目录状态</h3>
                    <ul className="space-y-1">
                      {Array.isArray(loginDiagData.credentialDirs)
                        ? (
                            loginDiagData.credentialDirs as Array<{
                              path: string;
                              exists: boolean;
                              entryCount?: number;
                            }>
                          ).map((row) => (
                            <li
                              key={row.path}
                              className="flex flex-wrap items-center gap-2 rounded border border-white/5 bg-black/25 px-2 py-1"
                            >
                              <span className="break-all font-mono text-[10px] text-zinc-400">
                                {row.path}
                              </span>
                              <span className={row.exists ? "text-emerald-400" : "text-zinc-600"}>
                                {row.exists
                                  ? `已找到${typeof row.entryCount === "number" ? `，共 ${row.entryCount} 项` : ""}`
                                  : "未找到"}
                              </span>
                              {row.exists ? (
                                <button
                                  type="button"
                                  className="text-[10px] text-zinc-300 hover:underline disabled:opacity-40"
                                  onClick={() => void openLoginDiagFolder(row.path)}
                                  disabled={!!loginDiagBusy}
                                >
                                  打开所在目录
                                </button>
                              ) : null}
                            </li>
                          ))
                        : null}
                    </ul>
                  </section>
                  <section className="mb-4">
                    <h3 className="mb-1 font-medium text-white">日志路径</h3>
                    <ul className="space-y-2 text-[11px] text-zinc-400">
                      {loginDiagData.paths &&
                      typeof loginDiagData.paths === "object" &&
                      loginDiagData.paths !== null ? (
                        <>
                          {typeof (loginDiagData.paths as { debugLogPath?: unknown }).debugLogPath === "string" ? (
                            <li className="flex flex-wrap items-center gap-2">
                              <span className="break-all font-mono text-[10px]">
                                {(loginDiagData.paths as { debugLogPath: string }).debugLogPath}
                              </span>
                              <button
                                type="button"
                                className="text-zinc-300 hover:underline disabled:opacity-40"
                                onClick={() =>
                                  void openLoginDiagFolder(
                                    (loginDiagData.paths as { debugLogPath: string }).debugLogPath
                                  )
                                }
                                disabled={!!loginDiagBusy}
                              >
                                打开日志目录
                              </button>
                            </li>
                          ) : null}
                          {typeof (loginDiagData.paths as { launchLogPath?: unknown }).launchLogPath === "string" ? (
                            <li className="flex flex-wrap items-center gap-2">
                              <span className="break-all font-mono text-[10px]">
                                {(loginDiagData.paths as { launchLogPath: string }).launchLogPath}
                              </span>
                              <button
                                type="button"
                                className="text-zinc-300 hover:underline disabled:opacity-40"
                                onClick={() =>
                                  void openLoginDiagFolder(
                                    (loginDiagData.paths as { launchLogPath: string }).launchLogPath
                                  )
                                }
                                disabled={!!loginDiagBusy}
                              >
                                打开日志目录
                              </button>
                            </li>
                          ) : null}
                        </>
                      ) : null}
                    </ul>
                  </section>
                  <section>
                    <h3 className="mb-1 font-medium text-white">提示</h3>
                    <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-zinc-400">
                      {Array.isArray(loginDiagData.hints)
                        ? (loginDiagData.hints as string[]).map((h) => (
                            <li key={h}>{h}</li>
                          ))
                        : null}
                    </ul>
                  </section>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {tasksOpen ? (
        <div className="fixed inset-0 z-[60] flex justify-end bg-black/50 backdrop-blur-[2px]">
          <button
            type="button"
            className="h-full flex-1 cursor-default"
            aria-label="关闭任务面板"
            onClick={() => setTasksOpen(false)}
          />
          <div className="flex h-full w-full max-w-xl flex-col border-l border-white/10 bg-zinc-950/98 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <h2 className="text-sm font-medium text-white">任务记录 / submit_id</h2>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-white"
                  title="刷新"
                  onClick={() => void loadTaskHistory()}
                  disabled={tasksLoading}
                >
                  <RefreshCw className={`h-4 w-4 ${tasksLoading ? "animate-spin" : ""}`} />
                </button>
                <button
                  type="button"
                  className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-white"
                  title="关闭"
                  onClick={() => setTasksOpen(false)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
              {tasksError ? (
                <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100/90">
                  {tasksError}
                </p>
              ) : null}
              {tasksRows.length === 0 && !tasksLoading && !tasksError ? (
                <p className="px-2 py-6 text-center text-xs text-zinc-500">暂无任务记录</p>
              ) : null}
              <ul className="flex flex-col gap-2 pb-8">
                {tasksRows.map((row, i) => {
                  const o = asTaskRecord(row);
                  const sid = taskString(o, "submit_id", "submitId");
                  const upstreamId = taskString(
                    o,
                    "request_id",
                    "requestId",
                    "upstream_id",
                    "upstreamId",
                    "task_id",
                    "taskId",
                    "id"
                  );
                  const upstreamUrl = taskString(o, "upstream_task_url", "task_url", "taskUrl");
                  const status = taskString(o, "gen_status", "status");
                  const typ = taskString(o, "gen_task_type", "task_type", "media_type");
                  const provider = taskString(o, "provider", "source");
                  const model = taskString(o, "model_version", "modelVersion", "model");
                  const requestedResolution = taskString(o, "resolution_type", "resolutionType");
                  const upstreamSize = taskString(o, "upstream_image_size", "upstreamImageSize", "size");
                  const upstreamQuality = taskString(o, "upstream_image_quality", "upstreamImageQuality", "quality");
                  const failReason = taskString(o, "fail_reason", "failReason", "error");
                  const costText = formatTaskCost(o);
                  const usageText = formatTaskUsage(o);
                  const updatedAt = formatTaskTime(o.updated_at ?? o.updatedAt ?? o.created_at ?? o.createdAt);
                  const events = Array.isArray(o.events) ? o.events.slice(-4) : [];
                  return (
                    <li
                      key={sid || `task-${i}`}
                      className="rounded-lg border border-white/10 bg-zinc-900/80 px-3 py-2 text-xs text-zinc-200"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        {status ? (
                          <span
                            className={[
                              "rounded px-1.5 py-0.5 text-[10px]",
                              status === "failed"
                                ? "bg-red-500/15 text-red-200"
                                : status === "completed"
                                  ? "bg-emerald-500/15 text-emerald-200"
                                  : "bg-sky-500/15 text-sky-200",
                            ].join(" ")}
                          >
                            {status}
                          </span>
                        ) : null}
                        {typ ? <span className="text-[10px] text-zinc-500">{typ}</span> : null}
                        {provider ? <span className="text-[10px] text-zinc-500">{provider}</span> : null}
                        {updatedAt ? <span className="ml-auto text-[10px] text-zinc-600">{updatedAt}</span> : null}
                      </div>
                      {model ? (
                        <div className="mt-1 truncate text-[10px] text-zinc-400">模型 {model}</div>
                      ) : null}
                      {requestedResolution ? (
                        <div className="mt-1 truncate text-[10px] text-zinc-500">
                          请求规格 {requestedResolution.toUpperCase()}
                        </div>
                      ) : null}
                      {upstreamSize || upstreamQuality ? (
                        <div className="mt-1 truncate text-[10px] text-zinc-500">
                          {upstreamSize ? `尺寸 ${upstreamSize}` : ""}
                          {upstreamSize && upstreamQuality ? " · " : ""}
                          {upstreamQuality ? `质量 ${upstreamQuality}` : ""}
                        </div>
                      ) : null}
                      {sid ? (
                        <div className="mt-1.5 flex items-center gap-2">
                          <span className="shrink-0 text-[10px] text-zinc-500">本地</span>
                          <code className="max-w-[min(100%,240px)] truncate font-mono text-[10px] text-zinc-400">
                            {sid}
                          </code>
                          <button
                            type="button"
                            className="shrink-0 text-[10px] text-zinc-300 hover:underline"
                            onClick={() => void navigator.clipboard?.writeText(sid)}
                          >
                            复制
                          </button>
                        </div>
                      ) : (
                        <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-zinc-500">
                          {JSON.stringify(row)}
                        </pre>
                      )}
                      {upstreamId && upstreamId !== sid ? (
                        <div className="mt-1.5 flex items-center gap-2">
                          <span className="shrink-0 text-[10px] text-zinc-500">Request ID</span>
                          <code className="max-w-[min(100%,240px)] truncate font-mono text-[10px] text-sky-200/90">
                            {upstreamId}
                          </code>
                          <button
                            type="button"
                            className="shrink-0 text-[10px] text-zinc-300 hover:underline"
                            onClick={() => void navigator.clipboard?.writeText(upstreamId)}
                          >
                            复制
                          </button>
                        </div>
                      ) : null}
                      {upstreamUrl ? (
                        <div className="mt-1 truncate font-mono text-[10px] text-zinc-500">{upstreamUrl}</div>
                      ) : null}
                      {costText ? (
                        <div className="mt-1.5 flex items-center gap-2">
                          <span className="shrink-0 text-[10px] text-zinc-500">花费</span>
                          <span className="rounded-md border border-emerald-400/20 bg-emerald-500/10 px-2 py-1 font-mono text-[10px] text-emerald-100">
                            {costText}
                          </span>
                        </div>
                      ) : null}
                      {usageText ? (
                        <div className="mt-1.5 rounded-md border border-white/8 bg-white/[0.03] px-2 py-1 text-[10px] text-zinc-300">
                          {usageText}
                        </div>
                      ) : null}
                      {failReason ? (
                        <div className="mt-1.5 rounded-md border border-red-400/20 bg-red-500/10 px-2 py-1 text-[10px] text-red-100">
                          {failReason}
                        </div>
                      ) : null}
                      {events.length > 0 ? (
                        <div className="mt-2 space-y-1 border-t border-white/8 pt-2">
                          {events.map((event, eventIndex) => {
                            const ev = asTaskRecord(event);
                            const level = taskString(ev, "level");
                            const message = taskString(ev, "message");
                            const detail = taskString(ev, "detail");
                            const at = formatTaskTime(ev.at);
                            if (!message) return null;
                            return (
                              <div key={`${sid || i}-event-${eventIndex}`} className="text-[10px] text-zinc-500">
                                <span className={level === "error" ? "text-red-300" : "text-zinc-400"}>
                                  {at ? `${at} ` : ""}
                                  {message}
                                </span>
                                {detail ? <div className="mt-0.5 break-all font-mono text-zinc-600">{detail}</div> : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      ) : null}
      {browserPickerOpen ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="关闭"
            onClick={() => setBrowserPickerOpen(false)}
          />
          <div className="relative z-10 w-[min(92vw,460px)] rounded-xl border border-white/10 bg-zinc-950/95 p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-white">选择登录浏览器</h2>
              <button
                type="button"
                className="rounded-md p-1.5 text-zinc-400 hover:bg-white/5 hover:text-white"
                onClick={() => setBrowserPickerOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {browserPickerErr ? (
              <p className="mb-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
                {browserPickerErr}
              </p>
            ) : null}
            <div className="space-y-2">
              {browserOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-zinc-900/80 px-3 py-2 text-left text-sm text-white transition-colors hover:bg-zinc-800/90"
                  onClick={() => void selectBrowserAndLogin(opt.id)}
                >
                  <span>{opt.name}</span>
                  <span className="text-[11px] text-zinc-400">
                    {opt.id === "system" ? "推荐" : "已安装"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {vipCredentialDialogOpen ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/65 backdrop-blur-[2px]">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="关闭"
            onClick={() => setVipCredentialDialogOpen(false)}
          />
          <div className="relative z-10 w-[min(92vw,460px)] rounded-xl border border-amber-400/30 bg-zinc-950/95 p-4 shadow-2xl">
            <h2 className="text-sm font-semibold text-amber-200">登录提示</h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-200">
              检测到本地凭证文件小于 3KB
              {typeof vipCredentialSizeBytes === "number"
                ? `（当前 ${Math.max(0, Math.round(vipCredentialSizeBytes / 1024))}KB）`
                : ""}
              ，可能是无效凭证。当前登录功能仅支持即梦高级会员账号，具体以官方开放 CLI 为准和画布维护状态。
            </p>
            <p className="mt-1 text-xs text-zinc-400">你可以取消本次登录，或继续打开官网登录流程。</p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white hover:bg-white/10"
                onClick={() => setVipCredentialDialogOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
                onClick={() => void continueLoginAfterVipGate()}
              >
                继续登录
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {loginHint ? (
        <div className="absolute top-14 right-4 z-20 max-w-sm rounded-lg border border-white/10 bg-zinc-900/90 px-3 py-2 text-xs text-white/80 backdrop-blur">
          <p className="whitespace-pre-wrap leading-relaxed">{loginHint}</p>
          {loginState !== "logged_in" && loginAuthHasCallback !== null ? (
            <p
              className={`mt-2 rounded px-2 py-1 text-[11px] ${
                loginAuthHasCallback
                  ? "bg-emerald-500/15 text-emerald-200"
                  : "bg-amber-500/15 text-amber-200"
              }`}
            >
              登录页会优先检查本地回调地址
              {loginAuthHasCallback
                ? "，当前已检测到 callback=127.0.0.1 配置"
                : "，当前未检测到本地 callback"}
            </p>
          ) : null}
          {loginAuthUrl ? (
            <div className="mt-2 rounded border border-white/10 bg-black/30 p-2">
              <p className="mb-1 text-[10px] text-zinc-400">当前登录地址</p>
              <code className="block max-h-24 overflow-auto break-all font-mono text-[10px] text-zinc-200">
                {loginAuthUrl}
              </code>
              <button
                type="button"
                className="mt-1 text-[10px] text-zinc-300 hover:underline"
                onClick={() => void navigator.clipboard?.writeText(loginAuthUrl)}
              >
                复制登录地址
              </button>
            </div>
          ) : null}
          {loginDebugPreview ? (
            <div className="mt-2 rounded border border-white/10 bg-black/30 p-2">
              <p className="mb-1 text-[10px] text-zinc-400">CLI 调试预览</p>
              <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-zinc-300">
                {loginDebugPreview}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
      {sidebarMode !== "expanded" ? (
        <div className="absolute left-3 top-3 z-20 flex w-12 flex-col items-center gap-2 rounded-[22px] border border-white/12 bg-zinc-900/76 p-2 shadow-[0_14px_32px_rgba(0,0,0,0.3)] backdrop-blur-md">
        <button
          className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-zinc-300 transition-colors hover:bg-zinc-800/72 hover:text-white"
          onClick={handleSidebarGoHome}
          title="返回首页"
          aria-label="返回首页"
        >
          <House className="h-4 w-4" />
        </button>
        <div className="relative">
          <button
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-zinc-950 transition-transform hover:scale-[1.03]"
            onClick={openCompactCreateMenu}
            title="新增"
            aria-label="新增"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-zinc-100 shadow-[0_5px_14px_rgba(0,0,0,0.28)] ring-1 ring-white/50 transition-colors hover:bg-white">
              <Plus className="h-4 w-4" strokeWidth={2.35} />
            </span>
          </button>
          {createPanelOpen && createPanelAnchor === "button" ? (
            <div
              className="absolute left-[calc(100%+10px)] top-0 z-30 w-[158px] rounded-xl border border-white/12 bg-zinc-900/94 p-1.5 shadow-[0_14px_36px_rgba(0,0,0,0.34)] backdrop-blur-md"
            >
              <div className="px-2 py-1 text-[10px] text-zinc-500">添加节点</div>
              <button
                className="group flex h-10 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[12px] text-zinc-200 transition-colors hover:bg-zinc-800/76 hover:text-white"
                onClick={() => {
                  createPromptNodeWithOutput();
                  setCreatePanelOpen(false);
                }}
                title="添加生图节点"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-800/72 text-zinc-300 transition-colors group-hover:bg-zinc-700/82 group-hover:text-white">
                  <ImageIcon className="h-3.5 w-3.5" />
                </span>
                <span>生图</span>
              </button>
              <button
                className="group flex h-10 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[12px] text-zinc-200 transition-colors hover:bg-zinc-800/76 hover:text-white"
                onClick={() => {
                  createPromptNode2WithOutput();
                  setCreatePanelOpen(false);
                }}
                title="添加生视频节点"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-800/72 text-zinc-300 transition-colors group-hover:bg-zinc-700/82 group-hover:text-white">
                  <Video className="h-3.5 w-3.5" />
                </span>
                <span>生视频</span>
              </button>
              <button
                className="group flex h-10 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[12px] text-zinc-200 transition-colors hover:bg-zinc-800/76 hover:text-white"
                onClick={() => {
                  createTextNode();
                  setCreatePanelOpen(false);
                }}
                title="添加文本节点"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-800/72 text-zinc-300 transition-colors group-hover:bg-zinc-700/82 group-hover:text-white">
                  <MessageSquareText className="h-3.5 w-3.5" />
                </span>
                <span>文本</span>
              </button>
              <button
                className="group flex h-10 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[12px] text-zinc-200 transition-colors hover:bg-zinc-800/76 hover:text-white"
                onClick={() => {
                  createProcessNode();
                  setCreatePanelOpen(false);
                }}
                title="添加编辑节点"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-800/72 text-zinc-300 transition-colors group-hover:bg-zinc-700/82 group-hover:text-white">
                  <Sparkles className="h-3.5 w-3.5" />
                </span>
                <span>编辑</span>
              </button>
              <button
                className="group flex h-10 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[12px] text-zinc-200 transition-colors hover:bg-zinc-800/76 hover:text-white"
                onClick={() => {
                  createEmptyLocalImageNode();
                  setCreatePanelOpen(false);
                }}
                title="添加素材节点"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-800/72 text-zinc-300 transition-colors group-hover:bg-zinc-700/82 group-hover:text-white">
                  <Upload className="h-3.5 w-3.5" />
                </span>
                <span>素材</span>
              </button>
            </div>
          ) : null}
        </div>
        <button
          className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-zinc-300 transition-colors hover:bg-zinc-800/72 hover:text-white"
          onClick={() => setMediaHistoryOpen(true)}
          title="打开历史素材"
          aria-label="打开历史素材"
        >
          <Images className="h-4 w-4" />
        </button>
        <button
          className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-zinc-300 transition-colors hover:bg-zinc-800/72 hover:text-white"
          onClick={autoLayoutNodes}
          title="自动排布节点"
          aria-label="自动排布节点"
        >
          <LayoutGrid className="h-4 w-4" />
        </button>
        <button
          className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-zinc-300 transition-colors hover:bg-zinc-800/72 hover:text-white"
          onClick={() => openExpandedSidebarPanel("settings")}
          title="画布设置"
          aria-label="画布设置"
        >
          <Settings className="h-4 w-4" />
        </button>
        <button
          className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-zinc-300 transition-colors hover:bg-zinc-800/72 hover:text-white"
          onClick={() => openExpandedSidebarPanel("create")}
          title="切换为展开菜单"
          aria-label="切换为展开菜单"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      ) : null}
      {createPanelOpen && createPanelAnchor === "context" && createPanelPoint ? (
        <div
          className="fixed z-40 w-[146px] rounded-xl border border-white/12 bg-zinc-900/94 p-1.5 shadow-[0_14px_36px_rgba(0,0,0,0.34)] backdrop-blur-md"
          style={{ left: `${createPanelPoint.x}px`, top: `${createPanelPoint.y}px` }}
        >
          <div className="px-2 py-1 text-[10px] text-zinc-500">添加节点</div>
          <button
            className="group flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[12px] text-zinc-200 transition-colors hover:bg-zinc-800/76 hover:text-white"
            onClick={() => {
              createPromptNodeWithOutput();
              setCreatePanelOpen(false);
            }}
            title="添加生图节点"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-300 transition-colors group-hover:bg-zinc-700/82 group-hover:text-white">
              <ImageIcon className="h-3.5 w-3.5" />
            </span>
            <span>生图</span>
          </button>
          <button
            className="group flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[12px] text-zinc-200 transition-colors hover:bg-zinc-800/76 hover:text-white"
            onClick={() => {
              createPromptNode2WithOutput();
              setCreatePanelOpen(false);
            }}
            title="添加生视频节点"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-300 transition-colors group-hover:bg-zinc-700/82 group-hover:text-white">
              <Video className="h-3.5 w-3.5" />
            </span>
            <span>生视频</span>
          </button>
          <button
            className="group flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[12px] text-zinc-200 transition-colors hover:bg-zinc-800/76 hover:text-white"
            onClick={() => {
              createTextNode();
              setCreatePanelOpen(false);
            }}
            title="添加文本节点"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-300 transition-colors group-hover:bg-zinc-700/82 group-hover:text-white">
              <MessageSquareText className="h-3.5 w-3.5" />
            </span>
            <span>文本</span>
          </button>
          <button
            className="group flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[12px] text-zinc-200 transition-colors hover:bg-zinc-800/76 hover:text-white"
            onClick={() => {
              createProcessNode();
              setCreatePanelOpen(false);
            }}
            title="添加编辑节点"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-300 transition-colors group-hover:bg-zinc-700/82 group-hover:text-white">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <span>编辑</span>
          </button>
          <button
            className="group flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[12px] text-zinc-200 transition-colors hover:bg-zinc-800/76 hover:text-white"
            onClick={() => {
              createEmptyLocalImageNode();
              setCreatePanelOpen(false);
            }}
            title="添加素材节点"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-300 transition-colors group-hover:bg-zinc-700/82 group-hover:text-white">
              <Upload className="h-3.5 w-3.5" />
            </span>
            <span>素材</span>
          </button>
        </div>
      ) : null}
      {quickConnectDraft ? (
        <svg className="pointer-events-none fixed inset-0 z-[49] h-screen w-screen" aria-hidden="true">
          {quickConnectLinePath ? (
            <path
              d={quickConnectLinePath}
              fill="none"
              stroke="rgba(212, 212, 216, 0.78)"
              strokeLinecap="round"
              strokeWidth={2.4}
            />
          ) : null}
          {quickConnectLineEnd ? (
            <circle cx={quickConnectLineEnd.x} cy={quickConnectLineEnd.y} r={3.5} fill="rgb(228,228,231)" />
          ) : null}
        </svg>
      ) : null}
      {quickConnectDraft ? (
        <div
          className="fixed z-50 w-[104px] rounded-xl border border-white/12 bg-zinc-900/94 p-1.5 shadow-[0_14px_36px_rgba(0,0,0,0.34)] backdrop-blur-md"
          style={{ left: `${quickConnectDraft.point.x}px`, top: `${quickConnectDraft.point.y}px` }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="grid grid-cols-3 gap-1">
            <button
              className="flex h-7 w-full items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-zinc-800/76 hover:text-white"
              onClick={() => createQuickConnectedNode("prompt")}
              title="新建生图并自动连接"
              aria-label="新建生图并自动连接"
            >
              <ImageIcon className="h-3.5 w-3.5" />
            </button>
            <button
              className="flex h-7 w-full items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-zinc-800/76 hover:text-white"
              onClick={() => createQuickConnectedNode("prompt2")}
              title="新建生视频并自动连接"
              aria-label="新建生视频并自动连接"
            >
              <Video className="h-3.5 w-3.5" />
            </button>
            {quickConnectCanEdit ? (
              <button
                className="flex h-7 w-full items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-zinc-800/76 hover:text-white"
                onClick={() => createQuickConnectedNode("process")}
                title="新建编辑并自动连接"
                aria-label="新建编辑并自动连接"
              >
                <Sparkles className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <button
              className="col-span-3 flex h-6 items-center justify-center rounded-lg text-[10px] text-zinc-500 transition-colors hover:bg-zinc-800/60 hover:text-zinc-200"
              onClick={() => setQuickConnectDraft(null)}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}
      <CanvasAgentDock
        messages={agentMessages}
        draft={agentDraft}
        onDraftChange={setAgentDraft}
        onSubmit={() => void submitCanvasAgent()}
        onInterrupt={interruptCanvasAgent}
        attachedImageDataUrls={agentAttachedImageDataUrls}
        onPickImages={(files) => void pickAgentImages(files)}
        onRemoveAttachedImage={removeAgentImageAt}
        modelOptions={agentModelOptions}
        selectedModel={agentSelectedModel}
        onSelectedModelChange={setAgentSelectedModel}
        busy={agentChatThinking}
        busyLabel={agentChatThinking ? "思考中..." : null}
        canInterrupt={agentCanInterrupt}
        statusLabel={agentStatusLabel}
        modelLabel={agentModelLabel}
      />
      {agentPendingAction ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="关闭生成方式选择"
            onClick={() => setAgentPendingAction(null)}
          />
          <div className="relative z-10 w-[min(92vw,320px)] rounded-[22px] border border-white/10 bg-zinc-950/96 p-3.5 shadow-[0_24px_60px_rgba(0,0,0,0.42)]">
            <h2 className="text-base font-semibold text-white">
              这次怎么生成？
            </h2>
            <div className="mt-3 grid gap-2">
              <button
                type="button"
                className="rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-3.5 py-3 text-left text-sm text-emerald-100 hover:bg-emerald-500/14"
                onClick={() => void confirmAgentGenerationPath("canvas")}
              >
                <div className="font-medium">走画布节点</div>
              </button>
              <button
                type="button"
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-3 text-left text-sm text-zinc-100 hover:bg-white/[0.06]"
                onClick={() => void confirmAgentGenerationPath("chat")}
              >
                <div className="font-medium">聊天窗口直生</div>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
