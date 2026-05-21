import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import {
  computeProgressFromStreamEvent,
  formatGenerateProgressLine,
  isProgressQueuePhase,
  type GenerateStreamProgressEvent,
} from "@/lib/generateStreamProgress";
import {
  isTerminalQueryFailure,
  queryTaskJsonToProgressEvent,
} from "@/lib/queryTaskToProgress";
import { type NodeProps, useReactFlow } from "reactflow";
import {
  BrainCircuit,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUp,
  Copy,
  LayoutGrid,
  Loader2,
  Maximize2,
  Sparkles,
  Image as ImageIcon,
  Film,
  ImagePlus,
  RefreshCw,
  TriangleAlert,
  X,
  Download,
  Volume2,
  VolumeX,
  Server,
} from "lucide-react";
import { MagneticHandleSource, MagneticHandleTarget } from "./MagneticHandle";
import { JIMENG_CLOSE_MEDIA_LIGHTBOX_EVENT } from "@/lib/uiEvents";
import {
  CLI_VIDEO_MODEL_CATALOG,
  canonicalizeVideoModelValue,
  clampVideoDurationForModel,
  defaultReferenceModeForVideoModel,
  getExternalVideoModelFallbackCapability,
  getVideoDurationRange,
  getVideoModelDefaultSelection,
  getVideoModelMaxCount,
  isForopencodeVideoModel,
  normalizeVideoRatioForModel,
  normalizeVideoResolutionForModel,
  videoModelSupportsAnyReference,
  videoModelSupportsAudioToggle,
  videoModelSupportsGeneralReference,
  videoRatiosForModel,
  videoResolutionsForModel,
} from "@/lib/cliVideoModels";
import {
  MaterialThumbHoverPreview,
  useThumbHoverPreviewState,
} from "@/components/MaterialThumbHoverPreview";
import { CanvasMaterialVideo } from "@/components/CanvasMaterialVideo";
import { GeneratedMediaPreviewModal } from "@/components/GeneratedMediaPreviewModal";
import { withGeneratedMediaCacheBust } from "@/lib/generatedUrl";
import {
  computePromptPreviewShellDimensions,
  MAGNETIC_HANDLE_EDGE_OUTSET,
} from "@/lib/promptPreviewShell";
import {
  defaultExternalImageModelForProvider,
  externalImageModelFallbacksForProvider,
  normalizeExternalImageApiProviderId,
  type ExternalImageApiProviderId,
} from "@/lib/externalImageApiShared";
import { useLocalBridgeMediaUrl } from "@/lib/localBridgeMedia";

function mediaExtFromUrl(url: string) {
  const t = url.trim();
  if (!t) return "";
  try {
    const u = new URL(t, "http://localhost");
    const fromName = u.searchParams.get("name")?.trim();
    const source = fromName || u.pathname;
    const m = source.toLowerCase().match(/\.([a-z0-9]{2,6})$/);
    return m?.[1] ?? "";
  } catch {
    const base = t.split("#")[0];
    const m = base.toLowerCase().match(/\.([a-z0-9]{2,6})(?:\?|$)/);
    return m?.[1] ?? "";
  }
}

function urlLooksLikeVideoFile(url: string) {
  const ext = mediaExtFromUrl(url);
  return /^(mp4|webm|mov|m4v|mkv)$/.test(ext);
}

function inferExtFromUrl(url: string) {
  return mediaExtFromUrl(url) || "png";
}

function trimRenderableUrl(url: string | null | undefined) {
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

function panelResultSig(urlsRaw: unknown, firstRaw: unknown) {
  const urls = Array.isArray(urlsRaw)
    ? urlsRaw.filter((url): url is string => typeof url === "string" && url.trim().length > 0)
    : [];
  const first =
    typeof firstRaw === "string" && firstRaw.trim().length > 0 ? firstRaw.trim() : null;
  return JSON.stringify({ u: urls, f: urls.length > 0 ? null : first });
}

function downloadMediaUrls(urls: string[], filePrefix: string) {
  const list = urls.filter((u) => typeof u === "string" && u.trim().length > 0);
  for (let i = 0; i < list.length; i++) {
    const raw = list[i]!;
    const url = raw.trim();
    const ext = inferExtFromUrl(url);
    const name = filePrefix + "-" + String(i + 1).padStart(2, "0") + "." + ext;
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

/** 閻㈢喐鍨氱紒鎾寸亯閸欘垵鍏橀弰?mp4 缁涘顫嬫０?URL閿涙氨鏁ら懛顏勭暰娑斿甯舵禒璁圭礄閹剙浠犻弰楣冩閿涘绱濋崟璺ㄦ暏閸樼喓鏁?controls閿涙稑銇戠拹銉ュ晙閸ョ偤鈧偓 img */
function PromptResultMedia({
  src,
  cacheBustKey,
  className = "",
  objectFit = "cover",
  fillContainer = true,
  compact = false,
  showVideoControls = true,
  videoSurfaceAction = "togglePlay",
  autoPlayWhenReady = false,
  suspendPlayback = false,
  onVideoSurfaceClick,
  onVideoSurfaceDoubleClick,
}: {
  src: string;
  cacheBustKey?: string | number | null;
  className?: string;
  objectFit?: "cover" | "contain";
  fillContainer?: boolean;
  /** 閺嶇厧鐡欓崘鍛毈妫板嫯顫嶉悽銊ф彛閸戞垶甯舵禒?*/
  compact?: boolean;
  showVideoControls?: boolean;
  videoSurfaceAction?: "togglePlay" | "none";
  autoPlayWhenReady?: boolean;
  suspendPlayback?: boolean;
  /** 鐟欏棝顣堕敍姘礋閸戣瀵岄悽濠氭桨閹垫挸绱戦弬鍥ㄦ拱闂堛垺婢樼粵澶涚幢閹绘劒绶甸弮鍓佹暰闂堛垹宕熼崙璁崇瑝閸愬秴鍨忛幑銏℃尡閺€?*/
  onVideoSurfaceClick?: () => void;
  /** 鐟欏棝顣堕敍姘蓟閸戣瀵岄悽濠氭桨閸忋劌鐫嗘０鍕潔 */
  onVideoSurfaceDoubleClick?: () => void;
}) {
  const [useImg, setUseImg] = useState(false);
  const rawDisplaySrc = useMemo(
    () => withGeneratedMediaCacheBust(src, cacheBustKey),
    [src, cacheBustKey]
  );
  const displaySrc = useLocalBridgeMediaUrl(rawDisplaySrc) || rawDisplaySrc;
  useEffect(() => {
    // src 閺囧瓨鏌婇崥搴ㄥ櫢缂冾喖娲栭柅鈧悩鑸碘偓渚婄窗闁灝鍘ら弮褌绔村▎鈥冲鏉炶棄銇戠拹銉﹀Ω閸氬海鐢荤憴鍡涱暥娑撯偓閻╁瓨瀵?<img> 濞撳弶鐓?    setUseImg(false);
  }, [displaySrc]);
  const isVideo = urlLooksLikeVideoFile(rawDisplaySrc);
  const fit = objectFit === "contain" ? "object-contain" : "object-cover";
  const box = fillContainer ? "h-full w-full " + fit : fit;
  if (useImg) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={displaySrc} alt="" className={(box + " " + className).trim()} draggable={false} />
    );
  }
  if (isVideo) {
    const inner = (
      <CanvasMaterialVideo
        src={displaySrc}
        className={fillContainer ? "h-full min-h-0 w-full" : className}
        objectFit={objectFit}
        compact={compact}
        showControls={showVideoControls}
        surfaceAction={onVideoSurfaceClick ? "none" : videoSurfaceAction}
        onSurfaceClick={
          onVideoSurfaceClick
            ? () => {
                onVideoSurfaceClick();
              }
            : undefined
        }
        onSurfaceDoubleClick={
          onVideoSurfaceDoubleClick
            ? () => {
                onVideoSurfaceDoubleClick();
              }
            : undefined
        }
        onMediaError={() => setUseImg(true)}
        autoPlayWhenReady={autoPlayWhenReady}
        suspendPlayback={suspendPlayback}
      />
    );
    if (fillContainer) {
      return <div className={("flex h-full min-h-0 w-full flex-col " + className).trim()}>{inner}</div>;
    }
    return inner;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={displaySrc} alt="" className={(box + " " + className).trim()} draggable={false} />
  );
}

/** 妫板嫯顫嶉弽?/ 婢瑰啿鍞撮妴灞捐閺屾挷鑵戦妴宥忕窗绾俱劎鐖為幍顐㈠帨 + 娑擃厼绺鹃崗澶嬫櫏閿涘牐顫?globals.css閿?*/
function JimengRenderStatusShell({
  compact,
  children,
  videoEdgeFlow,
  backgroundSrc,
  backgroundCacheBustKey,
  backgroundPlaybackSuspended,
  errorMessage,
}: {
  compact?: boolean;
  children: React.ReactNode;
  /** 鐟欏棝顣堕悽鐔稿灇閼哄倻鍋ｉ敍姘閺屾挸宕版担宥嗙壐鏉堝湱绱ù浣稿З妤傛ê鍘?*/
  videoEdgeFlow?: boolean;
  backgroundSrc?: string | null;
  backgroundCacheBustKey?: string | number | null;
  backgroundPlaybackSuspended?: boolean;
  errorMessage?: string | null;
}) {
  const hasBackground = trimRenderableUrl(backgroundSrc);
  return (
    <div
      className={[
        "jimeng-render-status-fx",
        compact ? "jimeng-render-status-fx--compact" : "",
        videoEdgeFlow ? "jimeng-render-status-fx--video-edgeflow" : "",
        hasBackground ? "jimeng-render-status-fx--with-media" : "jimeng-render-status-fx--chromatic",
        errorMessage ? "jimeng-render-status-fx--error" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {hasBackground ? (
        <div className="jimeng-render-status-media-backdrop" aria-hidden>
          <PromptResultMedia
            src={hasBackground}
            cacheBustKey={backgroundCacheBustKey}
            className="pointer-events-none"
            objectFit="cover"
            compact
            showVideoControls={false}
            videoSurfaceAction="none"
            autoPlayWhenReady={urlLooksLikeVideoFile(hasBackground)}
            suspendPlayback={backgroundPlaybackSuspended}
          />
        </div>
      ) : null}
      <span className="jimeng-render-color-wash" aria-hidden />
      <span className="jimeng-render-orbit-glow" aria-hidden />
      <span className="jimeng-render-frost-bands" aria-hidden />
      <span className="jimeng-render-prism-beam" aria-hidden />
      <div className="relative z-[1] flex h-full w-full flex-col items-center justify-center gap-1 px-1">
        {children}
      </div>
    </div>
  );
}

export type PromptNodeData = {
  imageProvider?: "dreamina" | "aiwanwu";
  videoProvider?: "dreamina" | "external_api";
  externalApiProviderId?: ExternalImageApiProviderId;
  externalApiProviderLabel?: string;
  externalVideoProviderLabel?: string;
  imageQuality?: "standard" | "high" | "hd";
  promptText?: string;
  /** 閺堚偓鏉╂垳绔村▎鈩冨灇閸旂喓鏁撻幋鎰閸愯崵绮ㄦ稉瀣降閻?prompt閿涘瞼鏁ゆ禍搴″坊閸欐彃鎻╅悡褔浼╅崗宥堫潶閸氬海鐢婚懡澶岊焾缂傛牞绶憰鍡欐磰 */
  lastRenderedPromptText?: string;
  modelVersion?: string;
  ratio?: string;
  resolutionType?: string;
  count?: number;
  /** 鐟欏棝顣堕敍姘鳖潡閺佸府绱濋張宥呭缁旑垱瀵滃Ο鈥崇€锋稉?CLI 閼煎啫娲块柦鍐插煑 */
  durationSeconds?: number;
  /** 鐟欏棝顣堕敍姘Ц閸氾箑婀?prompt 娑擃參妾崝?[audio:on] / [audio:off]閿涘牅绗?VideoNode 娑撯偓閼疯揪绱?*/
  withAudio?: boolean;
  generationMode?: "image" | "video";
  referenceMode?: "general" | "headtail";
  lastCostPerImage?: number | null;
  lastTaskCost?: number | null;
  lastTaskOutputCount?: number | null;
  lastUsageTokens?: number | null;
  lastGeneratedAt?: number | null;
  panelOpen?: boolean;
  onOpenPanel?: () => void;
  onClosePanel?: () => void;
  panelDisplayMode?: "floating" | "dock-right";
  onPanelDisplayModeChange?: (mode: "floating" | "dock-right") => void;
  dockPanelMode?: "compact" | "expanded";
  onDockPanelModeChange?: (mode: "compact" | "expanded") => void;
  outputMediaVersion?: string | number | null;
  imageOrder?: string[];
  videoOrder?: string[];
  materialOrder?: string[];
  onAddImageNode?: (file: File) => void;
  connectedImages?: Array<{
    id: string;
    url: string;
    refIndex: number;
    refType?: "image" | "video";
    isVideo?: boolean;
    cacheBustKey?: string | number | null;
  }>;
  onDisconnectImage?: (imageNodeId: string) => void;
  /** 娑撳骸缍嬮崜宥堢箾缁惧潡娉﹂崥鍫滅閼峰娈戦崗銊ョ碍閿涘牊瀚嬮崝銊х級閻ｃ儱娴橀崥搴″晸閸忋儻绱?*/
  onReorderConnectedImages?: (newOrder: string[]) => void;
  /** 鏉╂稑鍙嗛妴灞肩矤閻㈣绔烽悙褰掆偓澶嬫拱閸︽澘娴橀悧鍥Ν閻愬箍鈧秷绻涚痪鎸幠佸蹇ョ礄閻?Canvas 婢跺嫮鎮婃妯瑰瘨娑撳海鍋ｉ崙浼欑礆 */
  onRequestPickCanvasImage?: () => void;
  isPickingCanvasImage?: boolean;
  canPickCanvasImage?: boolean;
  onGenerate?: (args: {
    prompt: string;
    nodeId: string;
    imageProvider?: "dreamina" | "aiwanwu";
    externalApiProviderId?: ExternalImageApiProviderId;
    imageQuality?: "standard" | "high" | "hd";
    videoProvider?: "dreamina" | "external_api";
    modelVersion: string;
    ratio: string;
    resolutionType: string;
    count: number;
    durationSeconds?: number;
    withAudio?: boolean;
    onEachImage?: (url: string) => void;
    onStreamProgress?: (e: GenerateStreamProgressEvent) => void;
  }) => Promise<{
    creditsAfter?: number | null;
    costPerImage?: number | null;
    firstImageUrl?: string | null;
    imageUrls?: string[];
    backgroundSyncPending?: boolean;
  }>;

  // Callback used by Canvas nodes when prompt text changes, including paste/restore flows.
  onPromptTextChange?: (text: string) => void;
  onPromptSettingsChange?: (patch: {
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
    lastTaskCost?: number | null;
    lastTaskOutputCount?: number | null;
    lastUsageTokens?: number | null;
  }) => void;
  promptIndex?: number;
  nodeName?: string;
  zoomLevel?: number;
  /** 鐟欏棝顣堕悽鐔稿灇娑擃厾娈戞潻鎰攽閺冨墎濮搁幀渚婄礉閸愭瑥娲栭懞鍌滃仯閺佺増宓侀崥搴″讲鐠恒劑顩绘い闈涘瀼閹广垺浠径?*/
  isLoading?: boolean;
  error?: string | null;
  streamStatusLine?: string | null;
  streamProgressPct?: number;
  streamInQueue?: boolean;
  lastSubmitId?: string | null;
  resumeGenSourceNodeId?: string | null;
  /** 闂呭繒鏁剧敮?JSON 閹镐椒绠欓崠鏍电窗闂堛垺婢橀悽鐔稿灇缂佹挻鐏夐敍鍫滅瑢 prompt-node-state LS 娴滄帊璐熸径鍥﹀敜閿?*/
  persistedPanelImageUrls?: string[];
  persistedPanelFirstImageUrl?: string | null;
  /** Canvas 閺€鎯版崳鐏炴洖绱戠純鎴炵壐閸氬氦瀚㈤弮瀣祮娴?URL 妞ゅ搫绨崚娆撯偓鎺戭杻閿涘奔绶甸棃銏℃緲閹峰缍堥張顒€婀?resultImageUrls */
  panelUrlsNormalizeRev?: number;
  onPersistPanelOutput?: (payload: { urls: string[]; firstUrl: string | null }) => void;
  onRuntimeStateChange?: (patch: {
    isLoading?: boolean;
    error?: string | null;
    streamStatusLine?: string | null;
    streamProgressPct?: number;
    streamInQueue?: boolean;
    lastSubmitId?: string | null;
    resumeGenSourceNodeId?: string | null;
  }) => void;
  /** Canvas 娴?localStorage 鏉炶棄鍙嗛崶鎯ф倵闁帒顤冮敍宀€鏁ゆ禍搴㈠Ω閸ラ箖鍣烽惃?persisted 娴溠冨毉閸愭瑥娲栭棃銏℃緲 */
  canvasGraphEpoch?: number;
  /** 婢舵艾娴樼仦鏇炵磻閸掓壆鏁剧敮鍐跨窗娑撳瓨妞傞悽鐔稿灇閻ㄥ嫭婀伴崷鏉挎禈閼哄倻鍋?id 娑撳孩鏁圭挧閿嬫閹垹顦查惃鍕綏閺?*/
  canvasImageSpill?: {
    savedPosition: { x: number; y: number };
    imageNodeIds: string[];
    /** 娑撳海缍夐弽鐓庡灙鐎规垝绔撮懛杈剧礉閻劋绨棃銏℃緲閸愬懏鏋冮張顒€灏仦鍛厬閺€鍓佺崕 */
    panelMaxWidthPx?: number;
    /** 濞搭喖濮╅弬鍥ㄦ拱閺嶅繒娴夌€电濡悙閫涜厬韫囧啴顤傛径鏍ч挬缁変紮绱檖x閿涘绱濇担鑳潒鐟欏绗傜€靛綊缍堢純鎴炵壐濮樻潙閽╂稉顓炵妇 */
    panelCenterOffsetX?: number;
    /** 鐏炴洖绱戦弮璺烘倗娑撳鐖?URL 韫囶偆鍙庨敍灞肩┒娴滃海鏁撻幋鎰厬濞翠礁绱￠崙鍝勬禈閺冭泛锝為崗鍛窗娴ｅ秴宕?*/
    hydrationUrlSnapshot?: string[];
    /** 閺€璺烘礀鐏炴洖绱戠純鎴炵壐閸斻劎鏁炬稉顓ㄧ窗Canvas 閹额剟鐝?Prompt 婢?z-index閿涘矂顥ｉ崶鐐插幢閻楀洤甯囨担?*/
    collapseAnim?: boolean;
    collapseStackAlpha?: number;
    collapseOpenReady?: boolean;
  };
  /** 閻㈣绔?闂堛垺婢橀崗杈╂暏閻ㄥ嫨鈧矂銆婇崶淇扁偓宥囩波閺嬫粈绗呴弽鍥风礄娑?resultImageUrls 鐎靛綊缍堥敍?*/
  promptPanelPrimaryImageIndex?: number;
  onPanelPrimaryImageIndexChange?: (index: number) => void;
  /** 鐏忓棗缍嬮崜宥咁樋閸ュ墽绮ㄩ弸婊勫瘻缂冩垶鐗搁幗濠傚煂閻㈣绔烽敍鍫熸拱閼哄倻鍋ｉ崡鐘辩閺嶉棿璐熸い璺烘禈閿涘苯鍙炬担娆忔禈閸氬嫪绔撮弽闂寸瑝闁插秴顦查敍?*/
  onExpandImageResultsToCanvas?: (payload: {
    urls: string[];
    ratio: string;
    primaryIndex: number;
    /** 閻㈢喐鍨氭稉顓犳畱閹绱堕弫甯窗閺堫亜鍤崶鐐娑旂喎褰查崗鍫ユ懙瀵偓缂冩垶鐗搁崡鐘辩秴 */
    expectedTileCount?: number;
  }) => void;
  /** 閺€璺烘礀閻㈣绔烽幗濠傜磻閻ㄥ嫬娴橀懞鍌滃仯楠炶埖浠径宥嗘拱閼哄倻鍋ｆ担宥囩枂 */
  onCollapseImageResultsFromCanvas?: () => void;
};

type MentionPos = { left: number; top: number };

type PromptSeg =
  | { type: "text"; text: string }
  | { type: "ref"; refType: "image" | "video"; refIndex: number };

function parsePrompt(prompt: string): PromptSeg[] {
  const segs: PromptSeg[] = [];
  const re = /@(图片|视频)(\d+)/g;
  let last = 0;
  for (const m of prompt.matchAll(re)) {
    const start = m.index ?? 0;
    if (start > last) segs.push({ type: "text", text: prompt.slice(last, start) });
    const refType = m[1] === "视频" ? "video" : "image";
    const idx = Number(m[2]);
    if (Number.isFinite(idx) && idx >= 1) segs.push({ type: "ref", refType, refIndex: idx });
    last = start + (m[0]?.length ?? 0);
  }
  if (last < prompt.length) segs.push({ type: "text", text: prompt.slice(last) });
  if (segs.length === 0) segs.push({ type: "text", text: "" });
  return segs;
}

function buildPromptFromDom(editor: HTMLDivElement | null): string {
  if (!editor) return "";
  let out = "";
  const visit = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      out += (n.textContent ?? "").replace(/\u200B/g, "");
      return;
    }
    if (n.nodeType === Node.ELEMENT_NODE) {
      const el = n as HTMLElement;
      const ref = el.getAttribute("data-ref-index");
      const refType = el.getAttribute("data-ref-type") === "video" ? "视频" : "图片";
      if (ref) {
      out += "@" + refType + String(ref);
      } else {
        for (const child of Array.from(el.childNodes)) visit(child);
      }
    }
  };
  for (const child of Array.from(editor.childNodes)) visit(child);
  return out;
}

function clampMentionPos(pos: MentionPos) {
  return {
    left: Math.max(6, pos.left),
    top: Math.max(6, pos.top),
  };
}

function getFloatingPanelPos(options: {
  hostRect: DOMRect;
  rangeRect: DOMRect;
  panelWidth: number;
  panelHeight: number;
}) {
  const { hostRect, rangeRect, panelWidth, panelHeight } = options;
  const leftLocal = rangeRect.left - hostRect.left - 6;
  const topLocal = rangeRect.bottom - hostRect.top + 6;
  return clampMentionPos({
    left: Math.max(6, Math.min(leftLocal, hostRect.width - panelWidth - 8)),
    top: Math.max(6, Math.min(topLocal, hostRect.height - panelHeight - 8)),
  });
}

function getRangeRect(range: Range): DOMRect | null {
  const rect = range.getBoundingClientRect();
  if (rect && (rect.width > 0 || rect.height > 0)) return rect;
  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  marker.style.position = "relative";
  marker.style.display = "inline-block";
  marker.style.width = "1px";
  marker.style.height = "1em";
  const r = range.cloneRange();
  r.insertNode(marker);
  const mr = marker.getBoundingClientRect();
  marker.remove();
  return mr;
}

function placeCaretAroundElement(el: HTMLElement, before: boolean) {
  const sel = window.getSelection();
  if (!sel) return null;
  const r = document.createRange();
  if (before) r.setStartBefore(el);
  else r.setStartAfter(el);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  return r;
}

const GPT_DRAW_3840_MODEL = "gpt-draw-3840x2160";
const GPT_DRAW_3840_RESOLUTION_TYPE = "gpt-4k";

/** 缂冩垿銆夋笟褌绡勯幆顖樷偓?K / 3K閵嗗稄绱盋LI 娴犲懏鏁幐?2k / 4k閿涘瞼鏅棃顫偓?K閵嗗秴顕惔?--resolution_type=4k */
function formatResolutionUiLabel(resolutionType: string) {
  const t = resolutionType.trim().toLowerCase();
  if (t === GPT_DRAW_3840_RESOLUTION_TYPE) return "4K";
  if (t === "4k") return "3K";
  if (t === "1k") return "1K";
  return "2K";
}

function formatBanana2ResolutionLabel(resolutionType: string) {
  const t = resolutionType.trim().toLowerCase();
  if (t === "1k") return "1K";
  if (t === "4k") return "4K";
  return "2K";
}

function formatGoogleResolutionLabel(resolutionType: string) {
  const t = resolutionType.trim().toLowerCase();
  if (t === "1k") return "1K";
  if (t === "4k" || t === GPT_DRAW_3840_RESOLUTION_TYPE) return "4K";
  return "2K";
}

function formatVideoQualityLabel(resolutionType: string) {
  return resolutionType.trim().toLowerCase();
}

async function blobToDataUrl(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("无法读取图片内容"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
    reader.readAsDataURL(blob);
  });
}

function normalizeAssistantPromptText(text: string) {
  const withoutFence = text
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return withoutFence
    .replace(/^(?:Prompt|prompt)\s*[:：]?\s*/i, "")
    .replace(/^["'`\s]+|["'`\s]+$/g, "")
    .trim();
}

function modelSupportsVideoMultimodal(modelValue: string) {
  return videoModelSupportsGeneralReference(modelValue);
}

function pickNearestVideoRatioByAspect(aspect: number, ratioOptions?: readonly string[]): string {
  if (!Number.isFinite(aspect) || aspect <= 0) return "16:9";
  const options =
    Array.isArray(ratioOptions) && ratioOptions.length > 0
      ? ratioOptions
      : ["1:1", "3:4", "16:9", "4:3", "9:16", "21:9"];
  let best = "16:9";
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const r of options) {
    const [w, h] = r.split(":").map(Number);
    if (!Number.isFinite(w) || !Number.isFinite(h) || h <= 0) continue;
    const d = Math.abs(w / h - aspect);
    if (d < bestDelta) {
      bestDelta = d;
      best = r;
    }
  }
  return best;
}

function formatSizeLabel(ratio: string, resolutionType: string, mode: "image" | "video", modelValue?: string) {
  if (mode === "video") {
    return ratio + " " + formatVideoQualityLabel(resolutionType).toUpperCase();
  }
  if (typeof modelValue === "string" && modelValue.trim().toLowerCase() === "banana2") {
    return ratio + " " + formatBanana2ResolutionLabel(resolutionType);
  }
  if (typeof modelValue === "string" && isGoogleImageModelValue(modelValue)) {
    return ratio + " " + formatGoogleResolutionLabel(resolutionType);
  }
  const lockedRatio = typeof modelValue === "string" ? lockedRatioForExternalDrawModel(modelValue) : null;
  if (lockedRatio) return lockedRatio;
  return ratio + " " + formatResolutionUiLabel(resolutionType).toUpperCase();
}

function nearestVideoRatioLabel(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "16:9";
  }
  return pickNearestVideoRatioByAspect(width / height, [
    "1:1",
    "3:4",
    "4:3",
    "16:9",
    "9:16",
    "21:9",
    "3:2",
    "2:3",
  ]);
}

const SIZE_PANEL_RATIOS_ROW1 = ["4:3", "3:4", "16:9", "9:16"] as const;
const SIZE_PANEL_RATIOS_ROW2 = ["3:2", "2:3", "21:9"] as const;
const SIZE_PANEL_RATIOS_ROW3 = ["7:1"] as const;

const EXTERNAL_IMAGE_MODEL_CATALOG = [
  {
    value: "gpt-image-2-c",
    title: "gpt-image-2-c",
    time: "约 20 秒",
    desc: "GPT 图像模型",
  },
  {
    value: "gpt-draw-2048x2048",
    title: "gpt-draw-2048x2048",
    time: "约 25 秒",
    desc: "GPT 绘图模型",
  },
  {
    value: "gpt-draw-3840x2160",
    title: "gpt-draw-3840x2160",
    time: "约 35 秒",
    desc: "GPT 绘图模型",
  },
  {
    value: "gpt-image-2",
    title: "gpt-image-2",
    time: "约 20 秒",
    desc: "GPT 图像模型",
  },
  {
    value: "gpt-image-1.5",
    title: "gpt-image-1.5",
    time: "约 20 秒",
    desc: "GPT 图像模型",
  },
  {
    value: "gpt-image-1",
    title: "gpt-image-1",
    time: "约 20 秒",
    desc: "GPT 图像模型",
  },
  {
    value: "nano-banana-2",
    title: "nano-banana-2",
    time: "约 20 秒",
    desc: "Google 图像模型",
  },
  {
    value: "gemini-3.1-flash-image-preview-c",
    title: "gemini-3.1-flash-image-preview-c",
    time: "约 20 秒",
    desc: "Google 图像模型",
  },
  {
    value: "banana2",
    title: "banana2",
    time: "约 20-60 秒",
    desc: "香蕉生图异步模型",
  },
] as const;
const FOROPENCODE_IMAGE_QUALITY_MODELS = new Set([
  "gpt-image-2",
  "gpt-draw-2048x2048",
  "gpt-draw-3840x2160",
]);
const EXTERNAL_DRAW_MODEL_RATIO_MAP: Record<string, "1:1"> = {
  "gpt-draw-2048x2048": "1:1",
};
const EXTERNAL_DRAW_SAFE_SIZE_MODELS = new Set([GPT_DRAW_3840_MODEL]);

function lockedRatioForExternalDrawModel(modelValue: string) {
  return EXTERNAL_DRAW_MODEL_RATIO_MAP[modelValue.trim().toLowerCase()] ?? null;
}

function usesExternalDrawSafeSizeMap(modelValue: string) {
  return EXTERNAL_DRAW_SAFE_SIZE_MODELS.has(modelValue.trim().toLowerCase());
}

function isPromptNodeLegacyResolutionModel(modelValue: string) {
  return modelValue === "3.0" || modelValue === "3.1";
}

function isGoogleImageModelValue(modelValue: string) {
  const mv = modelValue.trim().toLowerCase();
  return mv === "nano-banana-2" || mv === "gemini-3.1-flash-image-preview-c";
}

function supportsThreeTierImageResolution(modelValue: string) {
  return modelValue.trim().toLowerCase() === "banana2" || isGoogleImageModelValue(modelValue);
}

function normalizeImageResolutionSelection(modelValue: string, resolutionType: string) {
  const mv = modelValue.trim().toLowerCase();
  const rt = resolutionType.trim().toLowerCase();
  if (mv === GPT_DRAW_3840_MODEL) {
    if (rt === GPT_DRAW_3840_RESOLUTION_TYPE || rt === "4k" || rt === "2k") return rt;
    return GPT_DRAW_3840_RESOLUTION_TYPE;
  }
  if (supportsThreeTierImageResolution(modelValue)) {
    if (rt === "1k" || rt === "2k" || rt === "4k") return rt;
    return "2k";
  }
  if (isPromptNodeLegacyResolutionModel(modelValue)) {
    return rt === "1k" ? "1k" : "2k";
  }
  return rt === "4k" ? "4k" : "2k";
}

const sizePanelShell =
  "w-[288px] max-w-[min(288px,90vw)] rounded-xl border border-zinc-800 bg-zinc-950 p-1 shadow-[0px_4px_16px_rgba(0,0,0,0.35)]";
const FALLBACK_ASSISTANT_MODELS = ["gpt-5.4", "gpt-5.5", "gpt-4.1", "o3"];
const GPT_TRANSPARENT_BG_DIRECTIVE = "background: transparent";
const GPT_DIRECTIVE_MENU_WIDTH = 248;
const GPT_DIRECTIVE_MENU_HEIGHT = 108;

function isCustomAspectRatio(value: string) {
  return (
    /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(value.trim()) ||
    /^\d{3,5}\s*[xX]\s*\d{3,5}$/.test(value.trim())
  );
}

/** blob 婢惰鲸鏅ラ幋鏍у鏉炶棄銇戠拹銉︽娑撳秵妯夌粈楦款棁閸ュ彞绗?alt 閸欑姴鐡?*/
function ConnectedImageThumb({
  url,
  isVideo,
  cacheBustKey,
}: {
  url: string;
  isVideo?: boolean;
  cacheBustKey?: string | number | null;
}) {
  const [failed, setFailed] = useState(false);
  const rawDisplayUrl = useMemo(
    () => withGeneratedMediaCacheBust(url, cacheBustKey),
    [url, cacheBustKey]
  );
  const displayUrl = useLocalBridgeMediaUrl(rawDisplayUrl) || rawDisplayUrl;
  useEffect(() => {
    setFailed(false);
  }, [displayUrl]);
  if (!displayUrl || failed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 bg-zinc-700 text-[8px] text-zinc-400">
        <ImageIcon className="h-4 w-4 text-zinc-500" aria-hidden />
      </div>
    );
  }
  if (isVideo) {
    return (
      <div className="h-full w-full min-h-0 overflow-hidden rounded-[inherit]">
        <CanvasMaterialVideo
          src={displayUrl}
          className="h-full min-h-0 w-full"
          objectFit="cover"
          compact
          showControls={false}
          surfaceAction="togglePlay"
          onMediaError={() => setFailed(true)}
        />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={displayUrl}
      alt=""
      className="pointer-events-none h-full w-full object-cover"
      onError={() => setFailed(true)}
      draggable={false}
    />
  );
}

export function PromptNode({ id, data, selected }: NodeProps<PromptNodeData>) {
  const { setNodes } = useReactFlow();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const mentionHostRef = useRef<HTMLDivElement | null>(null);
  const lastRangeRef = useRef<Range | null>(null);
  const mentionRangeRef = useRef<Range | null>(null);
  const mentionPanelRef = useRef<HTMLDivElement | null>(null);
  const directiveRangeRef = useRef<Range | null>(null);
  const directivePanelRef = useRef<HTMLDivElement | null>(null);

  const storageKey = "prompt-node-state:" + id;

  const [imageProvider, setImageProvider] = useState<"dreamina" | "aiwanwu">(
    data.imageProvider ?? "aiwanwu"
  );
  const [videoProvider, setVideoProvider] = useState<"dreamina" | "external_api">(
    data.videoProvider ??
      (typeof data.modelVersion === "string" && isForopencodeVideoModel(data.modelVersion)
        ? "external_api"
        : "external_api")
  );
  const [externalImageModels, setExternalImageModels] = useState<string[]>([]);
  const [externalConfiguredImageModel, setExternalConfiguredImageModel] = useState("");
  const [externalVideoModels, setExternalVideoModels] = useState<string[]>([]);
  const [externalConfiguredVideoModel, setExternalConfiguredVideoModel] = useState("");
  const [modelVersion, setModelVersion] = useState(data.modelVersion ?? "5.0");
  const [imageQuality, setImageQuality] = useState<"standard" | "high" | "hd">(
    data.imageQuality ?? "standard"
  );
  const [ratio, setRatio] = useState(data.ratio ?? "16:9");
  const [resolutionType, setResolutionType] = useState(data.resolutionType ?? "2k");
  const [count, setCount] = useState(() => {
    const c = typeof data.count === "number" ? data.count : data.generationMode === "video" ? 1 : 4;
    return data.generationMode === "video" ? Math.min(2, Math.max(1, c)) : c;
  });
  const [durationSeconds, setDurationSeconds] = useState(
    typeof data.durationSeconds === "number" ? data.durationSeconds : 5
  );
  const [panelReady, setPanelReady] = useState(false);
  const [withAudio, setWithAudio] = useState(Boolean(data.withAudio));
  const isVideoPrompt = data.generationMode === "video";
  const referenceMode = data.referenceMode ?? "general";
  const panelScale = useMemo(() => {
    const z = data.zoomLevel ?? 1;
    if (!Number.isFinite(z) || z <= 0) return 1;
    return Math.round((1 / z) * 1000) / 1000;
  }, [data.zoomLevel]);

  const panelOpen = Boolean(data.panelOpen);
  const panelDisplayMode = data.panelDisplayMode === "dock-right" ? "dock-right" : "floating";
  const isDockedPanel = panelDisplayMode === "dock-right";
  const dockPanelMode = data.dockPanelMode === "compact" ? "compact" : "expanded";
  const isCompactDockedPanel = isDockedPanel && dockPanelMode === "compact";
  const dockPanelTitle =
    typeof data.nodeName === "string" && data.nodeName.trim()
      ? data.nodeName.trim()
      : isVideoPrompt
        ? `视频节点${data.promptIndex ?? 1}`
        : `生图节点${data.promptIndex ?? 1}`;

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [streamStatusLine, setStreamStatusLine] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [resultRenderError, setResultRenderError] = useState<string | null>(null);
  const [actualVideoMeta, setActualVideoMeta] = useState<{
    width: number;
    height: number;
    durationSeconds: number;
    ratioLabel: string;
    resolutionLabel: string;
  } | null>(null);
  const effectiveVideoRatioLabel =
    isVideoPrompt && videoProvider === "external_api" && actualVideoMeta
      ? actualVideoMeta.ratioLabel
      : ratio;
  const effectiveVideoResolutionLabel =
    isVideoPrompt && videoProvider === "external_api" && actualVideoMeta
      ? actualVideoMeta.resolutionLabel
      : formatVideoQualityLabel(resolutionType).toUpperCase();
  const effectiveVideoDurationLabel =
    isVideoPrompt && videoProvider === "external_api" && actualVideoMeta
      ? `${actualVideoMeta.durationSeconds.toFixed(1)}s`
      : `${durationSeconds}s`;
  const dockPanelMeta = isVideoPrompt
    ? videoProvider === "external_api"
      ? actualVideoMeta
        ? `${effectiveVideoRatioLabel} ${effectiveVideoResolutionLabel}  ${effectiveVideoDurationLabel}`
        : "首尾帧  自动"
      : formatSizeLabel(ratio, resolutionType, "video", modelVersion) + "  " + String(durationSeconds) + "s"
    : formatSizeLabel(ratio, resolutionType, "image", modelVersion) + "  " + String(count);

  const [resultImageUrl, setResultImageUrl] = useState<string | null>(null);
  const [resultImageUrls, setResultImageUrls] = useState<string[]>([]);
  const lastSettledResultImageUrlsRef = useRef<string[]>(
    Array.isArray(data.persistedPanelImageUrls) ? data.persistedPanelImageUrls.slice() : []
  );
  const [lastCostPerImage, setLastCostPerImage] = useState<number | null>(
    typeof data.lastCostPerImage === "number" ? data.lastCostPerImage : null
  );
  const [lastTaskCost, setLastTaskCost] = useState<number | null>(
    typeof data.lastTaskCost === "number" ? data.lastTaskCost : null
  );
  const [lastTaskOutputCount, setLastTaskOutputCount] = useState<number | null>(
    typeof data.lastTaskOutputCount === "number" ? data.lastTaskOutputCount : null
  );
  const [lastUsageTokens, setLastUsageTokens] = useState<number | null>(
    typeof data.lastUsageTokens === "number" ? data.lastUsageTokens : null
  );
  const [expandedResultUrl, setExpandedResultUrl] = useState<string | null>(null);
  /** 鐟欏棝顣堕崗銊ョ潌閺€鎯с亣閺冭埖娈忛崑婊冿紦閸愬懎鍙剧€瑰啳顫嬫０鎴礉闁灝鍘ら崣宀冪熅婢逛即鐓?*/
  const expandedVideoLightbox = Boolean(
    expandedResultUrl && urlLooksLikeVideoFile(expandedResultUrl)
  );
  /** 閸ュ墽澧栨径姘辩波閺嬫粣绱伴悽璇茬妫板嫯顫嶉崣鐘虫杹閺冨墎娈戦妴宀勩€婇悧灞烩偓宥囧偍瀵洩绱辩仦鏇炵磻缂冩垶鐗搁柌灞藉讲閺€?*/
  const [primaryImageResultIndex, setPrimaryImageResultIndex] = useState(0);

  /** 娑?Canvas 鐠佸彞瀵岄弰鎯ф倱娑撯偓鐢冾嚠姒绘劖婀伴崷鎵偍瀵洩绱濋柆鍨帳妞よ埖鐖妴灞藉棘閼板啫娴橀妴宥呭灲閺傤厺绗岄崣鐘靛妞よ泛娴樻禒宥囨暏閺冄傜瑓閺嶅洤顕遍懛纾嬵潒妫版垿妫?*/
  useLayoutEffect(() => {
    const ext = data.promptPanelPrimaryImageIndex;
    if (typeof ext !== "number" || ext < 0) return;
    setPrimaryImageResultIndex((prev) => (prev !== ext ? ext : prev));
  }, [data.promptPanelPrimaryImageIndex]);
  const [thumbDragDeltaX, setThumbDragDeltaX] = useState(0);
  const [showLoginModal, setShowLoginModal] = useState(false);

  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [sizeMenuOpen, setSizeMenuOpen] = useState(false);
  const [countMenuOpen, setCountMenuOpen] = useState(false);
  const [durationMenuOpen, setDurationMenuOpen] = useState(false);
  const [customRatioInput, setCustomRatioInput] = useState("");
  const floatMenusRef = useRef<HTMLDivElement>(null);
  const thumbDragRef = useRef<{ id: string; startX: number; dragged: boolean } | null>(null);
  const sawStreamProgressRef = useRef(false);
  const wasQueuePhaseRef = useRef(false);
  /** 閸氬矁濡悙鐟版彥闁喕绻涢悙瑙勫灗婢舵矮鎹㈤崝鈥叉唉闁挎瑦妞傞敍宀勪缉閸忓秵妫?Promise 閻?finally/閸ョ偠鐨熷〒鍛竴瑜版挸澧犻悽鐔稿灇 UI */
  const activeGenerateTokenRef = useRef(0);
  const localGenerateInFlightRef = useRef(false);
  const currentRunHasOutputRef = useRef(false);
  const generationStartOutputVersionRef = useRef<string | number | null | undefined>(null);
  const generationStartGeneratedAtRef = useRef<number | null | undefined>(null);
  const generationStartGraphResultSigRef = useRef("");
  const graphPanelOutputHydratedRef = useRef(false);
  const lastPanelPersistSigRef = useRef("");
  const lastPanelUrlsNormalizeRevRef = useRef(0);
  const persistPanelOutRef = useRef(data.onPersistPanelOutput);
  persistPanelOutRef.current = data.onPersistPanelOutput;
  const persistRuntimeRef = useRef(data.onRuntimeStateChange);
  persistRuntimeRef.current = data.onRuntimeStateChange;
  const promptSettingsChangeRef = useRef(data.onPromptSettingsChange);
  promptSettingsChangeRef.current = data.onPromptSettingsChange;
  const collapseImageResultsFromCanvasRef = useRef(data.onCollapseImageResultsFromCanvas);
  collapseImageResultsFromCanvasRef.current = data.onCollapseImageResultsFromCanvas;
  const prevCanvasEpochRef = useRef(data.canvasGraphEpoch ?? 0);
  if ((data.canvasGraphEpoch ?? 0) !== prevCanvasEpochRef.current) {
    prevCanvasEpochRef.current = data.canvasGraphEpoch ?? 0;
    graphPanelOutputHydratedRef.current = false;
  }
  const [sawStreamProgressEvent, setSawStreamProgressEvent] = useState(false);
  const [streamInQueue, setStreamInQueue] = useState(false);
  /** 閸掗攱鏌婇崥搴划婢跺秷顫嬫０鎴︻暕鐟欏牆灏潪顔款嚄 */
  const [videoResumeSubmitId, setVideoResumeSubmitId] = useState<string | null>(null);
  /** 娑?true 閺冩儼銆冪粈杞版崲閸斺剝娼甸懛顏勫煕閺傜増浠径宥忕礉闁灝鍘ゆ稉搴㈡拱濞嗭紕鍋ｉ崙鏄徯曢崣鎴犳畱 onGenerate 濞翠礁绱℃潻娑樺閸欏矂鍣告潪顔款嚄 */
  const [restoredVideoPolling, setRestoredVideoPolling] = useState(false);
  const lastRuntimePersistSigRef = useRef("");
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const modelVersionRef = useRef(modelVersion);
  modelVersionRef.current = modelVersion;

  /** 閹稿洭鎷￠弴鎹愮箻閸忋儲婀伴懞鍌滃仯婢舵牗顢嬮敍鍫濇儓妫板嫯顫嶆稉搴濈瑓閺傚綊娼伴弶鍨隘閸╃噦绱?*/
  const canvasNodePointerInsideRef = useRef(false);

  const handlePreviewPointerDown = useCallback(
    (e: React.PointerEvent) => {
      editorRef.current?.blur();
      const multi = e.shiftKey || e.metaKey || e.ctrlKey;
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== id) {
            if (multi) return n;
            return { ...n, selected: false };
          }
          return { ...n, selected: true };
        })
      );
    },
    [id, setNodes]
  );
  const thumbHoverRef = useRef<string | null>(null);
  const suppressThumbClickRef = useRef(false);
  const [thumbDropHoverId, setThumbDropHoverId] = useState<string | null>(null);
  const [draggingThumbId, setDraggingThumbId] = useState<string | null>(null);
  /** 姒х姵鐖ｉ崷銊ㄥΝ閻愯顢嬮崘鍛閺勫墽銇氭稉銈勬櫠绾句礁鎯涢悶鍐跨幢閻㈣绔风仦鏇炵磻缂冩垶鐗搁弮璺哄繁閸掓湹绗夐弰鍓с仛 */
  const [magneticReveal, setMagneticReveal] = useState(false);
  const {
    preview: thumbHoverPreview,
    setPreview: setThumbHoverPreview,
    bindHandlers: bindThumbHover,
  } = useThumbHoverPreviewState();

  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionPos, setMentionPos] = useState<MentionPos>({ left: 12, top: 80 });
  const [directiveMenuOpen, setDirectiveMenuOpen] = useState(false);
  const [directiveMenuPos, setDirectiveMenuPos] = useState<MentionPos>({ left: 12, top: 80 });
  const [editorText, setEditorText] = useState<string>(data.promptText ?? "");
  const [assistantModels, setAssistantModels] = useState<string[]>([]);
  const [assistantModel, setAssistantModel] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [assistantOutput, setAssistantOutput] = useState("");
  const [assistantOutputKind, setAssistantOutputKind] = useState<"analysis" | "prompt" | null>(null);
  const [assistantActionLabel, setAssistantActionLabel] = useState("");
  const latestEditorTextRef = useRef(editorText);
  latestEditorTextRef.current = editorText;
  const [initDone, setInitDone] = useState(false);

  type ModelRow = {
    value: string;
    title: string;
    time: string;
    desc: string;
    badge?: string;
    disabled?: boolean;
  };
  const currentExternalApiProviderId = normalizeExternalImageApiProviderId(
    data.externalApiProviderId
  );

  const modelCatalog = useMemo<ModelRow[]>(
    () =>
      isVideoPrompt
        ? (
            videoProvider === "external_api"
              ? (externalVideoModels.length > 0
                  ? externalVideoModels
                  : CLI_VIDEO_MODEL_CATALOG.filter((m) => m.provider === "foropencode").map(
                      (m) => m.value
                    )
                ).map((value) => {
                  const meta = CLI_VIDEO_MODEL_CATALOG.find((m) => m.value === value);
                  return {
                    value,
                    title: meta?.title ?? value,
                    time: meta?.time ?? "about 30-90s",
                    desc: meta?.desc ?? "External video API model.",
                    badge: meta?.badge,
                    disabled: meta?.disabled,
                  };
                })
              : CLI_VIDEO_MODEL_CATALOG.filter((m) => m.provider === "dreamina").map((m) => ({
                  value: m.value,
                  title: m.title,
                  time: m.time,
                  desc: m.desc,
                  badge: m.badge,
                  disabled: m.disabled,
                }))
          )
        : imageProvider === "aiwanwu"
          ? (
              externalImageModels.length > 0
                ? externalImageModels
                : externalImageModelFallbacksForProvider(currentExternalApiProviderId)
            ).map((value) => {
              const meta = EXTERNAL_IMAGE_MODEL_CATALOG.find((m) => m.value === value);
              return {
                value,
                title: meta?.title ?? value,
                time: meta?.time ?? "约 20 秒",
                desc: meta?.desc ?? "GPT 图像模型",
              };
            })
        : [
            {
              value: "5.0",
              title: "即梦 5.0 Lite",
              time: "约 1 分钟",
              desc: "轻量快速的通用生图模型。",
            },
            {
              value: "4.6",
              title: "Seedream 4.6",
              time: "约 1 分钟",
              desc: "细节与光影表现更强，适合精细成片。",
            },
            {
              value: "4.5",
              title: "Seedream 4.5",
              time: "约 1 分钟",
              desc: "速度与画质较均衡。",
            },
            {
              value: "4.1",
              title: "Seedream 4.1",
              time: "约 1 分钟",
              desc: "稳定的通用生图模型。",
            },
            {
              value: "4.0",
              title: "Seedream 4.0",
              time: "约 1 分钟",
              desc: "轻量快速的图像输出模型。",
            },
            {
              value: "tapnow",
              title: "TapNow Flash",
              time: "约 15 秒",
              desc: "超高速轻量模型，本地 CLI 集成暂未启用。",
              badge: "演示",
              disabled: true,
            },
            {
              value: "mj7",
              title: "MJ V7",
              time: "约 2 分钟",
              desc: "适合复杂场景的图像生成，本地 CLI 集成暂未启用。",
              disabled: true,
            },
            {
              value: "niji7",
              title: "MJ Niji7",
              time: "约 2 分钟",
              desc: "动漫风格模型，本地 CLI 集成暂未启用。",
              disabled: true,
            },
            {
              value: "recraft4",
              title: "Recraft V4",
              time: "约 1 分钟",
              desc: "适合设计工作流的图像生成，本地 CLI 集成暂未启用。",
              badge: "新",
              disabled: true,
            },
          ],
    [externalImageModels, externalVideoModels, imageProvider, isVideoPrompt, videoProvider]
  );

  const activeModels = useMemo(
    () => modelCatalog.filter((m) => !m.disabled),
    [modelCatalog]
  );

  const currentModelMeta = useMemo(() => {
    const hit = activeModels.find((m) => m.value === modelVersion);
    return hit ?? activeModels[0];
  }, [activeModels, modelVersion]);
  const externalVideoCapability = useMemo(
    () => getExternalVideoModelFallbackCapability(modelVersion || "grok-imagine-video"),
    [modelVersion]
  );
  const isForopencodeVideoPrompt = Boolean(isVideoPrompt && videoProvider === "external_api");
  const videoSupportsAnyReference = Boolean(
    isVideoPrompt &&
      (videoProvider === "external_api"
        ? externalVideoCapability.referenceSupport !== "none"
        : videoModelSupportsAnyReference(modelVersion))
  );
  const videoSupportsAudio = Boolean(
    isVideoPrompt &&
      (videoProvider === "external_api" ? false : videoModelSupportsAudioToggle(modelVersion))
  );
  const videoRatioOptions = useMemo(
    () =>
      isVideoPrompt
        ? videoProvider === "external_api"
          ? externalVideoCapability.ratioOptions
          : videoRatiosForModel(modelVersion)
        : [],
    [externalVideoCapability.ratioOptions, isVideoPrompt, modelVersion, videoProvider]
  );
  const previewPromptText =
    (data.lastRenderedPromptText || editorText || data.promptText || "").trim() || "";
  const previewModelLabel =
    data.lastGeneratedAt && typeof modelVersion === "string" && modelVersion.trim()
      ? currentModelMeta?.title ?? modelVersion.trim()
      : null;
  const previewRatioLabel =
    isVideoPrompt && videoProvider === "external_api" && actualVideoMeta
      ? actualVideoMeta.ratioLabel
      : ratio;
  const previewResolutionLabel = isVideoPrompt
    ? videoProvider === "external_api" && actualVideoMeta
      ? actualVideoMeta.resolutionLabel
      : formatVideoQualityLabel(resolutionType).toUpperCase()
    : formatResolutionUiLabel(resolutionType).toUpperCase();
  const isBanana2ImagePromptEarly =
    !isVideoPrompt &&
    imageProvider === "aiwanwu" &&
    currentExternalApiProviderId === "banana2" &&
    modelVersion.trim().toLowerCase() === "banana2";

  const promptModelHelpText = useMemo(() => {
    const modelTitle = (currentModelMeta?.title ?? modelVersion.trim()) || "当前模型";
    if (isVideoPrompt) {
      if (isForopencodeVideoPrompt) {
        return {
          title: "模型：" + modelTitle + "（视频）",
          hint: "当前接入走 ForOpenCode 视频任务，优先描述主体、镜头、动作、运镜，并用下方参数约束时长和画幅。",
        };
      }
      const mv = modelVersion.trim().toLowerCase();
      if (mv.startsWith("seedance2.0")) {
        return {
          title: "模型：" + modelTitle + "（视频）",
          hint: "支持多参考图和首尾帧，重点描述镜头运动、主体动作和场景层次。",
        };
      }
      if (mv === "seedance1.5pro" || mv.startsWith("3.5")) {
        return {
          title: "模型：" + modelTitle + "（视频）",
          hint: "当前模型会回退到首尾帧模式，重点描述转场和动作变化。",
        };
      }
        return {
          title: "模型：" + modelTitle + "（视频）",
          hint: "当前模型会自动使用首尾帧，请保持首帧与尾帧语义一致。",
        };
      }
    return {
      title: "模型：" + modelTitle + "（图片）",
      hint: isBanana2ImagePromptEarly
        ? "当前接入香蕉生图异步任务，支持自定义比例和参考图，建议先明确主体、风格与镜头感。"
        : "请描述主体、风格、构图和光线，也可以自然引用已连接的素材。",
    };
  }, [currentModelMeta?.title, isBanana2ImagePromptEarly, isForopencodeVideoPrompt, isVideoPrompt, modelVersion]);
  const effectiveExternalApiProviderId =
    !isVideoPrompt && imageProvider === "aiwanwu"
      ? normalizeExternalImageApiProviderId(data.externalApiProviderId)
      : undefined;
  const providerCatalog = isVideoPrompt
    ? [
        {
          value: "dreamina",
          title: "即梦生视频",
          desc: "Dreamina 视频模型",
          icon: "sparkles" as const,
        },
        {
          value: "external_api",
          title:
            typeof data.externalVideoProviderLabel === "string" &&
            data.externalVideoProviderLabel.trim()
              ? data.externalVideoProviderLabel.trim()
              : "视频API",
          desc: "外部视频模型",
          icon: "server" as const,
        },
      ]
    : [
        {
          value: "dreamina",
          title: "即梦生图",
          desc: "即梦图片模型",
          icon: "sparkles" as const,
        },
        {
          value: "default_gpt",
          title:
            currentExternalApiProviderId === "default_gpt" &&
            typeof data.externalApiProviderLabel === "string" &&
            data.externalApiProviderLabel.trim()
              ? data.externalApiProviderLabel.trim()
              : "默认 GPT",
          desc: "原有 GPT 图片通道",
          icon: "server" as const,
        },
        {
          value: "foropencode",
          title:
            currentExternalApiProviderId === "foropencode" &&
            typeof data.externalApiProviderLabel === "string" &&
            data.externalApiProviderLabel.trim()
              ? data.externalApiProviderLabel.trim()
              : "ForOpenCode",
          desc: "ForOpenCode 图片通道",
          icon: "server" as const,
        },
        {
          value: "google",
          title:
            currentExternalApiProviderId === "google" &&
            typeof data.externalApiProviderLabel === "string" &&
            data.externalApiProviderLabel.trim()
              ? data.externalApiProviderLabel.trim()
              : "Google",
          desc: "Google 图片通道",
          icon: "server" as const,
        },
        {
          value: "banana2",
          title:
            currentExternalApiProviderId === "banana2" &&
            typeof data.externalApiProviderLabel === "string" &&
            data.externalApiProviderLabel.trim()
              ? data.externalApiProviderLabel.trim()
              : "香蕉生图",
          desc: "banana2 异步生图通道",
          icon: "server" as const,
        },
      ];
  const currentProviderValue = isVideoPrompt
    ? videoProvider
    : imageProvider === "dreamina"
      ? "dreamina"
      : currentExternalApiProviderId;
  const currentProviderMeta =
    providerCatalog.find((item) => item.value === currentProviderValue) ?? providerCatalog[0];
  const isGptImagePromptModel =
    !isVideoPrompt && imageProvider === "aiwanwu" && /^gpt-/i.test(modelVersion.trim());
  const isGoogleImagePrompt =
    !isVideoPrompt &&
    imageProvider === "aiwanwu" &&
    currentExternalApiProviderId === "google";
  const supportsCustomImageRatio =
    !isVideoPrompt &&
    imageProvider === "aiwanwu" &&
    (currentExternalApiProviderId === "banana2" || currentExternalApiProviderId === "google");
  const isBanana2ImagePrompt =
    !isVideoPrompt &&
    imageProvider === "aiwanwu" &&
    currentExternalApiProviderId === "banana2" &&
    modelVersion.trim().toLowerCase() === "banana2";
  const banana2PriceLabel =
    resolutionType.trim().toLowerCase() === "1k"
      ? "$0.08"
      : resolutionType.trim().toLowerCase() === "4k"
        ? "$0.14"
        : "$0.09";
  const promptModelHelpTextDisplay = useMemo(() => {
    if (!isGptImagePromptModel) return promptModelHelpText;
    return {
      ...promptModelHelpText,
        hint: promptModelHelpText.hint + " 输入 / 可打开透明背景指令助手。",
    };
  }, [isGptImagePromptModel, promptModelHelpText]);
  const assistantImageRefs = useMemo(
    () =>
      (data.connectedImages ?? []).filter(
        (item) => !(item.refType === "video" || item.isVideo) && typeof item.url === "string" && item.url.trim()
      ),
    [data.connectedImages]
  );
  const assistantRefLabels = useMemo(
    () =>
      (data.connectedImages ?? []).map((item) =>
        "@" + (item.refType === "video" || item.isVideo ? "视频" : "图片") + String(item.refIndex)
      ),
    [data.connectedImages]
  );

  const loadAssistantModels = useCallback(async () => {
    const qs = new URLSearchParams({ kind: "text" });
    if (effectiveExternalApiProviderId) {
      qs.set("providerId", effectiveExternalApiProviderId);
    }
    const [modelsResp, configResp] = await Promise.all([
      fetch("/api/aiwanwu/models?" + qs.toString(), { cache: "no-store" }),
      fetch("/api/external-image-config", { cache: "no-store" }).catch(() => null),
    ]);
    const modelsJson = (await modelsResp.json().catch(() => null)) as
      | { models?: string[] }
      | null;
    const configJson = configResp
      ? ((await configResp.json().catch(() => null)) as
          | {
                config?: {
                  textModel?: string;
                  providers?: Partial<
                    Record<ExternalImageApiProviderId, { textModel?: string }>
                  >;
                };
            }
          | null)
      : null;
    const models = Array.isArray(modelsJson?.models)
      ? modelsJson.models.filter(
          (model): model is string => typeof model === "string" && model.trim().length > 0
        )
      : [];
    return {
      models: models.length > 0 ? models : FALLBACK_ASSISTANT_MODELS,
      configuredModel:
        effectiveExternalApiProviderId &&
        typeof configJson?.config?.providers?.[effectiveExternalApiProviderId]?.textModel === "string"
          ? configJson.config.providers[effectiveExternalApiProviderId]!.textModel!.trim()
          : typeof configJson?.config?.textModel === "string"
            ? configJson.config.textModel.trim()
            : "",
    };
  }, [effectiveExternalApiProviderId]);

  useEffect(() => {
    if (!panelOpen || !isDockedPanel) return;
    let cancelled = false;
    const syncAssistantModels = async () => {
      try {
        const { models, configuredModel } = await loadAssistantModels();
        if (cancelled) return;
        setAssistantModels(models);
        setAssistantModel((prev) => {
          if (configuredModel && models.includes(configuredModel)) return configuredModel;
          if (prev && models.includes(prev)) return prev;
          return models[0] ?? FALLBACK_ASSISTANT_MODELS[0];
        });
      } catch {
        if (cancelled) return;
        setAssistantModels(FALLBACK_ASSISTANT_MODELS);
        setAssistantModel((prev) =>
          prev && FALLBACK_ASSISTANT_MODELS.includes(prev) ? prev : FALLBACK_ASSISTANT_MODELS[0]
        );
      }
    };
    void syncAssistantModels();
    const onExternalConfigChanged = () => {
      void syncAssistantModels();
    };
    window.addEventListener("jimengpro:external-api-config-changed", onExternalConfigChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("jimengpro:external-api-config-changed", onExternalConfigChanged);
    };
  }, [panelOpen, isDockedPanel, loadAssistantModels]);

  const videoQualityOptions = useMemo(
    () =>
      isVideoPrompt
        ? videoProvider === "external_api"
          ? externalVideoCapability.resolutionOptions
          : videoResolutionsForModel(modelVersion)
        : [],
    [externalVideoCapability.resolutionOptions, isVideoPrompt, modelVersion, videoProvider]
  );
  const videoCountOptions = useMemo(() => {
    if (!isVideoPrompt) return [] as number[];
    const maxCount =
      videoProvider === "external_api" ? externalVideoCapability.maxCount : getVideoModelMaxCount(modelVersion);
    return Array.from({ length: maxCount }, (_, index) => index + 1);
  }, [externalVideoCapability.maxCount, isVideoPrompt, modelVersion, videoProvider]);
  const lockedExternalDrawRatio =
    !isVideoPrompt && imageProvider === "aiwanwu"
      ? lockedRatioForExternalDrawModel(modelVersion)
      : null;
  const legacyResolutionModel =
    !isVideoPrompt && isPromptNodeLegacyResolutionModel(modelVersion);
  const usesMappedExternalDrawSize =
    !isVideoPrompt && imageProvider === "aiwanwu" && usesExternalDrawSafeSizeMap(modelVersion);
  const supportsExternalDrawTrue4k =
    !isVideoPrompt && imageProvider === "aiwanwu" && modelVersion.trim().toLowerCase() === GPT_DRAW_3840_MODEL;
  const supportsExternalQuality =
    effectiveExternalApiProviderId === "foropencode" &&
    FOROPENCODE_IMAGE_QUALITY_MODELS.has(modelVersion);
  const externalQualityOptions = [
    { value: "standard", label: "标准" },
    { value: "high", label: "高清" },
    { value: "hd", label: "超清" },
  ] as const;
  const currentExternalQualityLabel =
    externalQualityOptions.find((item) => item.value === imageQuality)?.label ?? "标准";
  const isLockedExternalDrawRatioUnavailable = useCallback(
    (value: string) => !!lockedExternalDrawRatio && lockedExternalDrawRatio !== value,
    [lockedExternalDrawRatio]
  );
  const isExternalDrawTrue4kActive = resolutionType.trim().toLowerCase() === GPT_DRAW_3840_RESOLUTION_TYPE;
  const isFourToOneRatioUnavailable = useCallback(
    (value: string) =>
      value === "7:1" &&
      !(isGoogleImagePrompt || (supportsExternalDrawTrue4k && isExternalDrawTrue4kActive)),
    [isGoogleImagePrompt, supportsExternalDrawTrue4k, isExternalDrawTrue4kActive]
  );
  const isImageRatioUnavailable = useCallback(
    (value: string) => isLockedExternalDrawRatioUnavailable(value) || isFourToOneRatioUnavailable(value),
    [isLockedExternalDrawRatioUnavailable, isFourToOneRatioUnavailable]
  );
  const imageRatioDisabledTitle = useCallback(
    (value: string) => {
      if (isLockedExternalDrawRatioUnavailable(value)) {
        return "当前模型固定为 " + lockedExternalDrawRatio;
      }
      if (isFourToOneRatioUnavailable(value)) {
        return "仅 4K 页签可用";
      }
      return undefined;
    },
    [isFourToOneRatioUnavailable, isLockedExternalDrawRatioUnavailable, lockedExternalDrawRatio]
  );
  const imageResolutionOptions = useMemo(() => {
    if (isVideoPrompt) return [] as Array<{ value: string; label: string; disabled?: boolean; title?: string }>;
    if (isBanana2ImagePrompt) {
      return [
        { value: "1k", label: "1K" },
        { value: "2k", label: "2K" },
        { value: "4k", label: "4K" },
      ];
    }
    if (isGoogleImagePrompt) {
      return [
        { value: "1k", label: "1K" },
        { value: "2k", label: "2K" },
        { value: "4k", label: "4K" },
      ];
    }
    if (legacyResolutionModel) {
      return [
        { value: "1k", label: "1K" },
        { value: "2k", label: "2K" },
      ];
    }
    return [
      { value: "2k", label: "2K" },
      { value: "4k", label: "3K" },
      {
        value: GPT_DRAW_3840_RESOLUTION_TYPE,
        label: "4K",
        disabled: !supportsExternalDrawTrue4k,
        title: supportsExternalDrawTrue4k ? "当前模型可用" : "仅 gpt-draw-3840x2160 可用",
      },
    ];
  }, [isBanana2ImagePrompt, isGoogleImagePrompt, isVideoPrompt, legacyResolutionModel, supportsExternalDrawTrue4k]);

  /** 閸氬牆鑻?CLI 閸掝偄鎮曠悰灞芥倵閿涘本濡哥€涙ê鍋嶉柌宀€娈戦弮?value 瑜版帊绔撮崚鎵窗瑜版洑瀵岄柨?*/
  useEffect(() => {
    if (!isVideoPrompt) return;
    const canon = canonicalizeVideoModelValue(modelVersion);
    if (canon === modelVersion) return;
    setModelVersion(canon);
    const nextRes = normalizeVideoResolutionForModel(canon, resolutionType);
    if (nextRes !== resolutionType) setResolutionType(nextRes);
    data.onPromptSettingsChange?.({
      modelVersion: canon,
      ...(nextRes !== resolutionType ? { resolutionType: nextRes } : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVideoPrompt, modelVersion]);

  useEffect(() => {
    if (!isVideoPrompt) return;
    if (activeModels.some((m) => m.value === modelVersion && !m.disabled)) return;
    const fb =
      activeModels.find((m) => m.value === "seedance2.0fast")?.value ??
      activeModels[0]?.value ??
      "seedance2.0fast";
    setModelVersion(fb);
    data.onPromptSettingsChange?.({ modelVersion: fb });
    // 娴犲懏鐗庡锝夋姜濞?model閿涙卜nPromptSettingsChange 閻?Canvas 缁嬪啿鐣炬导鐘插弳
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVideoPrompt, modelVersion, activeModels]);

  useEffect(() => {
    if (!isVideoPrompt) return;
    const next = normalizeVideoResolutionForModel(modelVersion, resolutionType);
    if (next === resolutionType) return;
    setResolutionType(next);
    data.onPromptSettingsChange?.({ resolutionType: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVideoPrompt, modelVersion, resolutionType]);

  useEffect(() => {
    if (!isVideoPrompt) return;
    const fb = normalizeVideoRatioForModel(modelVersion, ratio);
    if (fb === ratio) return;
    setRatio(fb);
    data.onPromptSettingsChange?.({ ratio: fb });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVideoPrompt, modelVersion, ratio]);

  useEffect(() => {
    if (isVideoPrompt || !lockedExternalDrawRatio) return;
    if (ratio === lockedExternalDrawRatio) return;
    setRatio(lockedExternalDrawRatio);
    data.onPromptSettingsChange?.({ ratio: lockedExternalDrawRatio });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVideoPrompt, lockedExternalDrawRatio, ratio]);

  useEffect(() => {
    if (isVideoPrompt) return;
    const next = normalizeImageResolutionSelection(modelVersion, resolutionType);
    if (next === resolutionType) return;
    setResolutionType(next);
    data.onPromptSettingsChange?.({ resolutionType: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVideoPrompt, modelVersion, resolutionType]);

  useEffect(() => {
    if (isVideoPrompt) return;
    if (ratio !== "7:1") return;
    if (isGoogleImagePrompt || (supportsExternalDrawTrue4k && isExternalDrawTrue4kActive)) return;
    setRatio("16:9");
    data.onPromptSettingsChange?.({ ratio: "16:9" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVideoPrompt, ratio, isGoogleImagePrompt, supportsExternalDrawTrue4k, isExternalDrawTrue4kActive]);

  useEffect(() => {
    if (!isVideoPrompt) return;
    if (!videoSupportsAnyReference) {
      if (referenceMode !== "general") {
        data.onPromptSettingsChange?.({ referenceMode: "general" });
      }
      return;
    }
    if (referenceMode !== "general") return;
    if (modelSupportsVideoMultimodal(modelVersion)) return;
    data.onPromptSettingsChange?.({ referenceMode: "headtail" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVideoPrompt, modelVersion, referenceMode, videoSupportsAnyReference]);

  useEffect(() => {
    if (!isVideoPrompt) return;
    if (!videoSupportsAnyReference) return;
    if (referenceMode !== "headtail") return;
    const imagesOnly = (data.connectedImages ?? [])
      .filter((x) => !(x.refType === "video" || x.isVideo))
      .sort((a, b) => a.refIndex - b.refIndex);
    const first = imagesOnly[0];
    if (!first?.url) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const w = img.naturalWidth || 0;
      const h = img.naturalHeight || 0;
      if (w <= 0 || h <= 0) return;
      const next = pickNearestVideoRatioByAspect(w / h, videoRatioOptions);
      if (next === ratio) return;
      data.onPromptSettingsChange?.({ ratio: next });
    };
    img.onerror = () => {
      /* ignore */
    };
    img.src = first.url;
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.connectedImages, data.onPromptSettingsChange, isVideoPrompt, ratio, referenceMode, videoRatioOptions, videoSupportsAnyReference]);

  const ratioAspect = useMemo(() => {
    const [w, h] = ratio.trim().split(/[:xX]/).map((n) => Number(n));
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 16 / 9;
    return w / h;
  }, [ratio]);

  const showRenderProgressBar = loading && (sawStreamProgressEvent || streamInQueue) && !resultRenderError;
  const showRecoveryFallbackHint =
    isVideoPrompt &&
    !loading &&
    !resultImageUrl &&
    resultImageUrls.length === 0 &&
    typeof data.lastSubmitId === "string" &&
    data.lastSubmitId.trim().length > 0;
  const ownOutputCacheBustKey = data.outputMediaVersion ?? null;

  const connectedByRefIndex = useMemo(() => {
    const map = new Map<
      string,
      { id: string; url: string; refIndex: number; refType?: "image" | "video"; isVideo?: boolean }
    >();
    for (const img of (data.connectedImages ?? [])) {
      const refType = img.refType ?? (img.isVideo ? "video" : "image");
      map.set(refType + ":" + String(img.refIndex), img);
    }
    return map;
  }, [data.connectedImages]);
  const displayConnectedImages = useMemo(() => {
    const src = data.connectedImages ?? [];
    if (isVideoPrompt && !videoSupportsAnyReference) return [];
    if (!isVideoPrompt || referenceMode === "general") return src;
    const imagesOnly = src.filter((x) => !(x.refType === "video" || x.isVideo));
    return imagesOnly.slice(0, 2).map((x, idx) => ({
      ...x,
      frameLabel: idx === 0 ? "首帧" : "尾帧",
    }));
  }, [data.connectedImages, isVideoPrompt, referenceMode, videoSupportsAnyReference]);
  useEffect(() => {
    if (!thumbHoverPreview) return;
    if (draggingThumbId) {
      setThumbHoverPreview(null);
      return;
    }
    const stillExists = displayConnectedImages.some((img) => img.id === thumbHoverPreview.thumbId);
    if (!stillExists) setThumbHoverPreview(null);
  }, [displayConnectedImages, draggingThumbId, thumbHoverPreview, setThumbHoverPreview]);

  /** 娑?CLI 閸氬嫬鐡欓崨鎴掓姢 duration 閼煎啫娲跨€靛綊缍堥敍宀€鏁ゆ禍搴ㄦ桨閺夊灝褰查柅澶岊潡閺?*/
  const videoDurationRange = useMemo(() => {
    if (!isVideoPrompt) return { min: 4, max: 15 };
    const baseRange =
      videoProvider === "external_api"
        ? externalVideoCapability.durationRange
        : getVideoDurationRange(modelVersion);
    if (!videoSupportsAnyReference) return baseRange;
    const src = data.connectedImages ?? [];
    const headMaterials =
      referenceMode === "headtail"
        ? src.filter((x) => !(x.refType === "video" || x.isVideo)).slice(0, 2)
        : src;
    const n = headMaterials.length;
    const onlyImages = headMaterials.every((c) => !(c.refType === "video" || c.isVideo));
    if (referenceMode === "headtail" && n === 2 && onlyImages) {
      return { min: 2, max: 8 };
    }
    return baseRange;
  }, [
    data.connectedImages,
    externalVideoCapability.durationRange,
    isVideoPrompt,
    modelVersion,
    referenceMode,
    videoProvider,
    videoSupportsAnyReference,
  ]);

  const videoDurationOptions = useMemo(() => {
    const { min, max } = videoDurationRange;
    const out: number[] = [];
    for (let s = min; s <= max; s++) out.push(s);
    return out;
  }, [videoDurationRange]);

  const videoDurMin = videoDurationRange.min;
  const videoDurMax = videoDurationRange.max;

  useEffect(() => {
    if (!isVideoPrompt) return;
    const nextRatio =
      videoProvider === "external_api"
        ? videoRatioOptions.includes(ratio) ? ratio : externalVideoCapability.defaultRatio
        : normalizeVideoRatioForModel(modelVersion, ratio);
    const nextResolutionType =
      videoProvider === "external_api"
        ? videoQualityOptions.includes(
            resolutionType as (typeof videoQualityOptions)[number]
          )
          ? (resolutionType as (typeof videoQualityOptions)[number])
          : externalVideoCapability.defaultResolution
        : normalizeVideoResolutionForModel(modelVersion, resolutionType);
    const nextDurationSeconds =
      videoProvider === "external_api"
        ? Math.min(
            externalVideoCapability.durationRange.max,
            Math.max(
              externalVideoCapability.durationRange.min,
              Number.isFinite(durationSeconds)
                ? Number(durationSeconds)
                : externalVideoCapability.defaultDuration
            )
          )
        : clampVideoDurationForModel(modelVersion, durationSeconds);
    const maxCount =
      videoProvider === "external_api"
        ? externalVideoCapability.maxCount
        : getVideoModelMaxCount(modelVersion);
    const nextCount = Math.min(maxCount, Math.max(1, count));
    const nextWithAudio = videoSupportsAudio ? withAudio : false;
    const nextReferenceMode = !videoSupportsAnyReference
      ? "general"
      : referenceMode === "general" && !videoModelSupportsGeneralReference(modelVersion)
        ? "headtail"
        : referenceMode;
    if (
      nextRatio === ratio &&
      nextResolutionType === resolutionType &&
      nextDurationSeconds === durationSeconds &&
      nextCount === count &&
      nextWithAudio === withAudio &&
      nextReferenceMode === referenceMode
    ) {
      return;
    }
    if (nextRatio !== ratio) setRatio(nextRatio);
    if (nextResolutionType !== resolutionType) setResolutionType(nextResolutionType);
    if (nextDurationSeconds !== durationSeconds) setDurationSeconds(nextDurationSeconds);
    if (nextCount !== count) setCount(nextCount);
    if (nextWithAudio !== withAudio) setWithAudio(nextWithAudio);
    data.onPromptSettingsChange?.({
      ...(videoProvider !== data.videoProvider ? { videoProvider } : {}),
      ...(nextRatio !== ratio ? { ratio: nextRatio } : {}),
      ...(nextResolutionType !== resolutionType ? { resolutionType: nextResolutionType } : {}),
      ...(nextDurationSeconds !== durationSeconds ? { durationSeconds: nextDurationSeconds } : {}),
      ...(nextCount !== count ? { count: nextCount } : {}),
      ...(nextWithAudio !== withAudio ? { withAudio: nextWithAudio } : {}),
      ...(nextReferenceMode !== referenceMode ? { referenceMode: nextReferenceMode } : {}),
    });
  }, [
    count,
    data.onPromptSettingsChange,
    durationSeconds,
    externalVideoCapability,
    isVideoPrompt,
    modelVersion,
    ratio,
    referenceMode,
    resolutionType,
    videoProvider,
    videoSupportsAnyReference,
    videoSupportsAudio,
    videoQualityOptions,
    videoRatioOptions,
    withAudio,
  ]);

  const requestOpen = () => data.onOpenPanel?.();

  /** 妫板嫯顫嶉崠鍝勫敶瀹?CanvasMaterialVideo 娴?stopPropagation閿涘矂娓堕崷銊︻劃閻╁瓨甯撮幍鎾崇磻闂堛垺婢橀敍鍫濇儓鐟欏棝顣堕悽鐔稿灇 prompt2閿?*/
  const openPanelFromVideoPreviewClick = useCallback(() => {
    data.onOpenPanel?.();
  }, [data.onOpenPanel]);

  /** 鐟欏棝顣堕敍姘値楠炲墎鍩楃痪褍鎮撳銉ょ瑢閼煎啫娲块柦鍐插煑閿涙稐绶风挧鏍暏 min/max 閺嶅洭鍣洪敍宀勪缉閸?connectedImages 瀵洜鏁ら幎鏍уЗ鐎佃壈鍤?effect 閻欏倸鍩涢崡鈩冾劥妞ょ敻娼?*/
  useEffect(() => {
    if (!isVideoPrompt) return;
    const min = videoDurMin;
    const max = videoDurMax;
    const fromParent = typeof data.durationSeconds === "number" ? data.durationSeconds : null;
    setDurationSeconds((d) => {
      const raw = fromParent !== null ? fromParent : d;
      return Math.min(max, Math.max(min, raw));
    });
    if (fromParent !== null) {
      const clamped = Math.min(max, Math.max(min, fromParent));
      if (clamped !== fromParent) {
        data.onPromptSettingsChange?.({ durationSeconds: clamped });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVideoPrompt, videoDurMin, videoDurMax, data.durationSeconds]);

  useEffect(() => {
    if (isVideoPrompt) return;
    if (typeof data.durationSeconds === "number") setDurationSeconds(data.durationSeconds);
  }, [isVideoPrompt, data.durationSeconds]);

  useEffect(() => {
    setWithAudio(Boolean(data.withAudio));
  }, [data.withAudio]);

  useEffect(() => {
    if (!isVideoPrompt) return;
    if (videoSupportsAudio) return;
    if (!withAudio) return;
    setWithAudio(false);
    data.onPromptSettingsChange?.({ withAudio: false });
  }, [data.onPromptSettingsChange, isVideoPrompt, videoSupportsAudio, withAudio]);

  useEffect(() => {
    if (typeof data.count !== "number") return;
    setCount(
      isVideoPrompt
        ? Math.min(
            videoProvider === "external_api" ? externalVideoCapability.maxCount : getVideoModelMaxCount(modelVersion),
            Math.max(1, data.count)
          )
        : data.count
    );
  }, [data.count, externalVideoCapability.maxCount, isVideoPrompt, modelVersion, videoProvider]);

  useEffect(() => {
    if (data.isLoading === true) {
      setLoading((prev) => (prev ? prev : true));
      if (typeof data.streamStatusLine === "string") {
        setStreamStatusLine((prev) =>
          prev === data.streamStatusLine ? prev : data.streamStatusLine ?? null
        );
      }
      if (typeof data.streamProgressPct === "number") {
        setProgress((prev) => (prev === data.streamProgressPct ? prev : data.streamProgressPct ?? 0));
      }
      setStreamInQueue((prev) => (prev === (data.streamInQueue === true) ? prev : data.streamInQueue === true));
      if (typeof data.lastSubmitId === "string" && data.lastSubmitId.trim()) {
        setVideoResumeSubmitId((prev) =>
          prev === data.lastSubmitId!.trim() ? prev : data.lastSubmitId!.trim()
        );
      }
      if (
        typeof data.streamStatusLine === "string" ||
        typeof data.streamProgressPct === "number" ||
        data.streamInQueue === true
      ) {
        setSawStreamProgressEvent((prev) => (prev ? prev : true));
      }
      return;
    }

    if (data.isLoading === false) {
      const hasRuntimeError =
        typeof data.error === "string" && data.error.trim().length > 0;
      if (
        localGenerateInFlightRef.current &&
        loadingRef.current &&
        !currentRunHasOutputRef.current &&
        !hasRuntimeError
      ) {
        return;
      }
      setLoading((prev) => (prev ? false : prev));
      if ((data.streamStatusLine ?? null) === null) {
        setStreamStatusLine((prev) => (prev === null ? prev : null));
      }
      if (data.streamProgressPct == null) {
        setStreamInQueue((prev) => (prev ? false : prev));
      }
      if ((data.lastSubmitId ?? null) == null) {
        setVideoResumeSubmitId((prev) => (prev === null ? prev : null));
      }
    }
  }, [
    data.error,
    data.isLoading,
    data.lastSubmitId,
    data.streamInQueue,
    data.streamProgressPct,
    data.streamStatusLine,
  ]);

  useEffect(() => {
    setLastCostPerImage(typeof data.lastCostPerImage === "number" ? data.lastCostPerImage : null);
  }, [data.lastCostPerImage]);

  useEffect(() => {
    setLastTaskCost(typeof data.lastTaskCost === "number" ? data.lastTaskCost : null);
  }, [data.lastTaskCost]);

  useEffect(() => {
    setLastTaskOutputCount(
      typeof data.lastTaskOutputCount === "number" ? data.lastTaskOutputCount : null
    );
  }, [data.lastTaskOutputCount]);

  useEffect(() => {
    setLastUsageTokens(typeof data.lastUsageTokens === "number" ? data.lastUsageTokens : null);
  }, [data.lastUsageTokens]);

  useEffect(() => {
    if (data.imageProvider !== "dreamina" && data.imageProvider !== "aiwanwu") return;
    setImageProvider(data.imageProvider);
  }, [data.imageProvider]);

  useEffect(() => {
    if (data.videoProvider !== "dreamina" && data.videoProvider !== "external_api") return;
    setVideoProvider(data.videoProvider);
  }, [data.videoProvider]);

  useEffect(() => {
    if (typeof data.modelVersion !== "string" || !data.modelVersion.trim()) return;
    const nextModelVersion = isVideoPrompt
      ? canonicalizeVideoModelValue(data.modelVersion)
      : data.modelVersion.trim();
    setModelVersion((prev) => (prev === nextModelVersion ? prev : nextModelVersion));
  }, [data.modelVersion, isVideoPrompt]);

  useEffect(() => {
    if (typeof data.ratio !== "string" || !data.ratio.trim()) return;
    const nextRatio = isVideoPrompt
      ? videoProvider === "external_api"
        ? videoRatioOptions.includes(data.ratio.trim())
          ? data.ratio.trim()
          : externalVideoCapability.defaultRatio
        : normalizeVideoRatioForModel(modelVersion, data.ratio)
      : data.ratio.trim();
    setRatio((prev) => (prev === nextRatio ? prev : nextRatio));
  }, [data.ratio, externalVideoCapability.defaultRatio, isVideoPrompt, modelVersion, videoProvider, videoRatioOptions]);

  useEffect(() => {
    if (!supportsCustomImageRatio) {
      setCustomRatioInput("");
      return;
    }
    setCustomRatioInput((prev) => {
      if (isCustomAspectRatio(ratio)) {
        return prev === ratio ? prev : ratio;
      }
      return prev;
    });
  }, [ratio, supportsCustomImageRatio]);

  useEffect(() => {
    if (typeof data.resolutionType !== "string" || !data.resolutionType.trim()) return;
    const nextResolutionType = isVideoPrompt
      ? videoProvider === "external_api"
        ? videoQualityOptions.includes(data.resolutionType.trim() as (typeof videoQualityOptions)[number])
          ? (data.resolutionType.trim() as (typeof videoQualityOptions)[number])
          : externalVideoCapability.defaultResolution
        : normalizeVideoResolutionForModel(
            canonicalizeVideoModelValue(
              typeof data.modelVersion === "string" && data.modelVersion.trim()
                ? data.modelVersion
                : modelVersion
            ),
            data.resolutionType
          )
      : data.resolutionType.trim();
    setResolutionType((prev) => (prev === nextResolutionType ? prev : nextResolutionType));
  }, [
    data.modelVersion,
    data.resolutionType,
    externalVideoCapability.defaultResolution,
    isVideoPrompt,
    modelVersion,
    videoProvider,
    videoQualityOptions,
  ]);

  useEffect(() => {
    if (
      data.imageQuality === "standard" ||
      data.imageQuality === "high" ||
      data.imageQuality === "hd"
    ) {
      setImageQuality(data.imageQuality);
    }
  }, [data.imageQuality]);

  useEffect(() => {
    if (!supportsExternalQuality) {
      setQualityMenuOpen(false);
    }
  }, [supportsExternalQuality]);

  useEffect(() => {
    if (isVideoPrompt) return;
    let cancelled = false;
    const loadModels = async () => {
      try {
        const configResp = await fetch("/api/external-image-config", { cache: "no-store" }).catch(
          () => null
        );
        const configJson = configResp
          ? ((await configResp.json().catch(() => null)) as
              | {
                  config?: {
                    activeProviderId?: string;
                    imageModel?: string;
                    providers?: Partial<
                      Record<ExternalImageApiProviderId, { imageModel?: string }>
                    >;
                  };
                }
              | null)
          : null;
        const liveProviderId = currentExternalApiProviderId;
        const qs = new URLSearchParams({
          kind: "image",
          providerId: liveProviderId,
        });
        const resp = await fetch("/api/aiwanwu/models?" + qs.toString(), { cache: "no-store" });
        const json = (await resp.json().catch(() => null)) as { models?: string[] } | null;
        if (cancelled) return;
        const models = Array.isArray(json?.models) ? json.models.filter(Boolean) : [];
        setExternalImageModels(models);
        const configuredModel =
          typeof configJson?.config?.providers?.[liveProviderId]?.imageModel ===
            "string"
            ? configJson.config.providers[liveProviderId]!.imageModel!.trim()
            : typeof configJson?.config?.imageModel === "string"
              ? configJson.config.imageModel.trim()
              : "";
        setExternalConfiguredImageModel(configuredModel);
        if (imageProvider !== "aiwanwu") return;
        const currentModelVersion = modelVersionRef.current;
        const persistedModelVersion =
          typeof data.modelVersion === "string" ? data.modelVersion.trim() : "";
        const nextModel =
          models.length <= 0
            ? ""
            : models.includes(currentModelVersion)
              ? currentModelVersion
              : persistedModelVersion && models.includes(persistedModelVersion)
                ? persistedModelVersion
                : configuredModel && models.includes(configuredModel)
                  ? configuredModel
                  : models[0]!;
        if (nextModel && nextModel !== currentModelVersion) {
          setModelVersion(nextModel);
          promptSettingsChangeRef.current?.({ modelVersion: nextModel });
          return;
        }
        if (nextModel && nextModel !== persistedModelVersion) {
          promptSettingsChangeRef.current?.({ modelVersion: nextModel });
        }
      } catch {
        if (!cancelled) {
          const fallbackModels = EXTERNAL_IMAGE_MODEL_CATALOG.map((m) => m.value);
          setExternalImageModels(fallbackModels);
          setExternalConfiguredImageModel(
            defaultExternalImageModelForProvider(currentExternalApiProviderId)
          );
        }
      }
    };
    void loadModels();
    const onExternalConfigChanged = () => {
      void loadModels();
    };
    window.addEventListener("jimengpro:external-api-config-changed", onExternalConfigChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("jimengpro:external-api-config-changed", onExternalConfigChanged);
    };
  }, [
    isVideoPrompt,
    imageProvider,
    currentExternalApiProviderId,
    data.modelVersion,
  ]);

  useEffect(() => {
    if (!isVideoPrompt) return;
    let cancelled = false;
    const loadModels = async () => {
      try {
        const [configResp, modelsResp] = await Promise.all([
          fetch("/api/external-video-config", { cache: "no-store" }).catch(() => null),
          fetch("/api/external-video-models", { cache: "no-store" }),
        ]);
        const configJson = configResp
          ? ((await configResp.json().catch(() => null)) as
              | {
                  config?: {
                    model?: string;
                  };
                }
              | null)
          : null;
        const modelsJson = (await modelsResp.json().catch(() => null)) as
          | {
              models?: string[];
            }
          | null;
        if (cancelled) return;
        const models = Array.isArray(modelsJson?.models)
          ? modelsJson.models.filter(
              (value): value is string => typeof value === "string" && value.trim().length > 0
            )
          : [];
        setExternalVideoModels(models);
        const configuredModel =
          typeof configJson?.config?.model === "string" ? configJson.config.model.trim() : "";
        setExternalConfiguredVideoModel(configuredModel);
        if (videoProvider !== "external_api") return;
        const currentModelVersion = modelVersionRef.current;
        const persistedModelVersion =
          typeof data.modelVersion === "string" ? data.modelVersion.trim() : "";
        const nextModel =
          models.length <= 0
            ? ""
            : models.includes(currentModelVersion)
              ? currentModelVersion
              : persistedModelVersion && models.includes(persistedModelVersion)
                ? persistedModelVersion
                : configuredModel && models.includes(configuredModel)
                  ? configuredModel
                  : models[0]!;
        if (nextModel && nextModel !== currentModelVersion) {
          setModelVersion(nextModel);
          promptSettingsChangeRef.current?.({ modelVersion: nextModel, videoProvider: "external_api" });
          return;
        }
        if (nextModel && nextModel !== persistedModelVersion) {
          promptSettingsChangeRef.current?.({ modelVersion: nextModel, videoProvider: "external_api" });
        }
      } catch {
        if (!cancelled) {
          const fallbackModels = CLI_VIDEO_MODEL_CATALOG.filter((item) => item.provider === "foropencode").map(
            (item) => item.value
          );
          setExternalVideoModels(fallbackModels);
          setExternalConfiguredVideoModel("grok-imagine-video");
        }
      }
    };
    void loadModels();
    const onExternalVideoConfigChanged = () => {
      void loadModels();
    };
    window.addEventListener("jimengpro:external-video-api-config-changed", onExternalVideoConfigChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("jimengpro:external-video-api-config-changed", onExternalVideoConfigChanged);
    };
  }, [data.modelVersion, isVideoPrompt, videoProvider]);

  useEffect(() => {
    // init: load persisted editor + settings
    graphPanelOutputHydratedRef.current = false;
    lastPanelPersistSigRef.current = "";
    setInitDone(false);
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          editorText?: string;
          imageProvider?: "dreamina" | "aiwanwu";
          videoProvider?: "dreamina" | "external_api";
          imageQuality?: "standard" | "high" | "hd";
          modelVersion?: string;
          ratio?: string;
          resolutionType?: string;
          count?: number;
          durationSeconds?: number;
          withAudio?: boolean;
          resultImageUrl?: string | null;
          resultImageUrls?: string[];
        };
        if (typeof parsed.editorText === "string") setEditorText(parsed.editorText);
        if (parsed.imageProvider === "dreamina" || parsed.imageProvider === "aiwanwu") {
          setImageProvider(parsed.imageProvider);
        }
        if (parsed.videoProvider === "dreamina" || parsed.videoProvider === "external_api") {
          setVideoProvider(parsed.videoProvider);
        }
        if (typeof parsed.modelVersion === "string") {
          if (isVideoPrompt) {
            setModelVersion(canonicalizeVideoModelValue(parsed.modelVersion));
          } else {
            setModelVersion(parsed.modelVersion);
          }
        }
        if (
          parsed.imageQuality === "standard" ||
          parsed.imageQuality === "high" ||
          parsed.imageQuality === "hd"
        ) {
          setImageQuality(parsed.imageQuality);
        }
        if (typeof parsed.ratio === "string") {
          const nextRatio = isVideoPrompt
            ? normalizeVideoRatioForModel(modelVersion, parsed.ratio)
            : parsed.ratio;
          setRatio(nextRatio);
        }
        if (typeof parsed.resolutionType === "string") {
          const modelForInit =
            typeof parsed.modelVersion === "string"
              ? canonicalizeVideoModelValue(parsed.modelVersion)
              : canonicalizeVideoModelValue(modelVersion);
          setResolutionType(
            isVideoPrompt
              ? normalizeVideoResolutionForModel(modelForInit, parsed.resolutionType)
              : parsed.resolutionType
          );
        }
        if (typeof parsed.count === "number")
          setCount(
            isVideoPrompt
              ? Math.min(getVideoModelMaxCount(modelVersion), Math.max(1, parsed.count))
              : parsed.count
          );
        if (typeof parsed.durationSeconds === "number") setDurationSeconds(parsed.durationSeconds);
        if (typeof parsed.withAudio === "boolean") setWithAudio(parsed.withAudio);
        if (typeof parsed.resultImageUrl === "string") setResultImageUrl(parsed.resultImageUrl);
        else if (parsed.resultImageUrl === null) setResultImageUrl(null);
        if (Array.isArray(parsed.resultImageUrls)) setResultImageUrls(parsed.resultImageUrls);
        const lsHasResults =
          (Array.isArray(parsed.resultImageUrls) && parsed.resultImageUrls.length > 0) ||
          (typeof parsed.resultImageUrl === "string" && parsed.resultImageUrl.length > 0);
        if (!lsHasResults) {
          if (Array.isArray(data.persistedPanelImageUrls) && data.persistedPanelImageUrls.length > 0) {
            setResultImageUrls(data.persistedPanelImageUrls);
            setResultImageUrl(null);
          } else if (
            typeof data.persistedPanelFirstImageUrl === "string" &&
            data.persistedPanelFirstImageUrl.trim()
          ) {
            setResultImageUrl(data.persistedPanelFirstImageUrl.trim());
            setResultImageUrls([]);
          }
        }
        setInitDone(true);
        return;
      }
    } catch {
      // ignore
    }
    setEditorText(data.promptText ?? "");
    setImageProvider(data.imageProvider ?? "aiwanwu");
    if (Array.isArray(data.persistedPanelImageUrls) && data.persistedPanelImageUrls.length > 0) {
      setResultImageUrls(data.persistedPanelImageUrls);
      setResultImageUrl(null);
    } else if (
      typeof data.persistedPanelFirstImageUrl === "string" &&
      data.persistedPanelFirstImageUrl.trim()
    ) {
      setResultImageUrl(data.persistedPanelFirstImageUrl.trim());
      setResultImageUrls([]);
    }
    setInitDone(true);
    // 娴犲懘娈㈤懞鍌滃仯 id(storageKey) 閸掓繂顫愰崠鏍电幢娑撳秵濡?data.promptText 閸掓鍙嗘笟婵婄閿涘矂浼╅崗宥囧煑缁狙冩倱濮濄儲濡哥紓鏍帆濡楀棗鍞寸€圭懓鍟块幒?
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          editorText,
          imageProvider,
          videoProvider,
          modelVersion,
          imageQuality,
          ratio,
          resolutionType,
          count,
          durationSeconds,
          withAudio,
          resultImageUrl,
          resultImageUrls,
        })
      );
    } catch {
      // ignore
    }
  }, [
    editorText,
    imageProvider,
    videoProvider,
    modelVersion,
    imageQuality,
    ratio,
    resolutionType,
    count,
    durationSeconds,
    withAudio,
    resultImageUrl,
    resultImageUrls,
    storageKey,
  ]);

  useLayoutEffect(() => {
    if (!initDone || graphPanelOutputHydratedRef.current) return;
    if (loading) return;
    const hasLocal =
      resultImageUrls.length > 0 ||
      (typeof resultImageUrl === "string" && resultImageUrl.length > 0);
    if (hasLocal) {
      graphPanelOutputHydratedRef.current = true;
      lastPanelPersistSigRef.current = JSON.stringify({ u: resultImageUrls, f: resultImageUrl });
      return;
    }
    const urls = data.persistedPanelImageUrls;
    const first = data.persistedPanelFirstImageUrl;
    if (Array.isArray(urls) && urls.length > 0) {
      setResultImageUrls(urls);
      setResultImageUrl(null);
      lastPanelPersistSigRef.current = JSON.stringify({ u: urls, f: null });
    } else if (typeof first === "string" && first.trim()) {
      setResultImageUrl(first.trim());
      setResultImageUrls([]);
      lastPanelPersistSigRef.current = JSON.stringify({ u: [], f: first.trim() });
    }
    graphPanelOutputHydratedRef.current = true;
  }, [
    initDone,
    data.persistedPanelImageUrls,
    data.persistedPanelFirstImageUrl,
    data.canvasGraphEpoch,
    resultImageUrls,
    resultImageUrl,
    loading,
  ]);

  useEffect(() => {
    if (!initDone || !graphPanelOutputHydratedRef.current) return;
    const urls = resultImageUrls;
    const first = resultImageUrl;
    const sig = JSON.stringify({ u: urls, f: first });
    if (
      loading &&
      localGenerateInFlightRef.current &&
      !currentRunHasOutputRef.current &&
      urls.length === 0 &&
      !first
    ) {
      lastPanelPersistSigRef.current = sig;
      return;
    }
    if (sig === lastPanelPersistSigRef.current) return;
    const dSig = JSON.stringify({
      u: data.persistedPanelImageUrls ?? [],
      f:
        data.persistedPanelFirstImageUrl === undefined
          ? null
          : data.persistedPanelFirstImageUrl,
    });
    if (sig === dSig) {
      lastPanelPersistSigRef.current = sig;
      return;
    }
    lastPanelPersistSigRef.current = sig;
    persistPanelOutRef.current?.({ urls, firstUrl: first });
  }, [
    initDone,
    resultImageUrls,
    resultImageUrl,
    data.persistedPanelImageUrls,
    data.persistedPanelFirstImageUrl,
  ]);

  const hasRenderableOutput =
    resultImageUrls.length > 0 || (typeof resultImageUrl === "string" && resultImageUrl.trim().length > 0);
  const resolvedRuntimeError = (() => {
    if (loading || hasRenderableOutput) return null;
    if (typeof resultRenderError === "string" && resultRenderError.trim()) {
      return resultRenderError.trim();
    }
    if (typeof localError === "string" && localError.trim()) {
      return localError.trim();
    }
    if (typeof data.error === "string" && data.error.trim()) {
      return data.error.trim();
    }
    return null;
  })();

  useEffect(() => {
    const patch = {
      isLoading: loading,
      error: resolvedRuntimeError,
      streamStatusLine: loading ? streamStatusLine : null,
      streamProgressPct: loading ? progress : undefined,
      streamInQueue: loading ? streamInQueue : undefined,
      lastSubmitId:
        loading && videoResumeSubmitId && String(videoResumeSubmitId).trim()
          ? String(videoResumeSubmitId).trim()
          : null,
      resumeGenSourceNodeId: loading ? id : null,
    };
    const matchesPersistedRuntime =
      (data.isLoading === true) === patch.isLoading &&
      (data.error ?? null) === (patch.error ?? null) &&
      (data.streamStatusLine ?? null) === (patch.streamStatusLine ?? null) &&
      data.streamProgressPct === patch.streamProgressPct &&
      data.streamInQueue === patch.streamInQueue &&
      (data.lastSubmitId ?? null) === (patch.lastSubmitId ?? null) &&
      (data.resumeGenSourceNodeId ?? null) === (patch.resumeGenSourceNodeId ?? null);
    const sig = JSON.stringify(patch);
    if (matchesPersistedRuntime) {
      lastRuntimePersistSigRef.current = sig;
      return;
    }
    if (sig === lastRuntimePersistSigRef.current) return;
    lastRuntimePersistSigRef.current = sig;
    persistRuntimeRef.current?.(patch);
  }, [
    data.error,
    data.isLoading,
    data.lastSubmitId,
    data.resumeGenSourceNodeId,
    data.streamInQueue,
    data.streamProgressPct,
    data.streamStatusLine,
    hasRenderableOutput,
    id,
    loading,
    localError,
    progress,
    resolvedRuntimeError,
    resultRenderError,
    streamInQueue,
    streamStatusLine,
    videoResumeSubmitId,
  ]);

  useEffect(() => {
    if (loading) return;
    if (hasRenderableOutput) return;
    const nextError =
      typeof data.error === "string" && data.error.trim() ? data.error.trim() : null;
    if (!nextError) return;
    setLocalError((prev) => (prev === nextError ? prev : nextError));
    setResultRenderError((prev) => (prev === nextError ? prev : nextError));
  }, [data.error, hasRenderableOutput, loading]);

  useEffect(() => {
    if (!initDone) return;
    if (loading) return;
    const rev = data.panelUrlsNormalizeRev ?? 0;
    if (rev === 0 || rev === lastPanelUrlsNormalizeRevRef.current) return;
    lastPanelUrlsNormalizeRevRef.current = rev;
    const u = data.persistedPanelImageUrls ?? [];
    if (u.length > 0) {
      setResultImageUrls(u);
      setResultImageUrl(null);
      lastPanelPersistSigRef.current = JSON.stringify({ u, f: null });
    }
  }, [initDone, loading, data.panelUrlsNormalizeRev, data.persistedPanelImageUrls]);

  useEffect(() => {
    if (!initDone) return;
    const urls = Array.isArray(data.persistedPanelImageUrls)
      ? data.persistedPanelImageUrls.filter((url): url is string => typeof url === "string" && url.trim().length > 0)
      : [];
    const first =
      typeof data.persistedPanelFirstImageUrl === "string" && data.persistedPanelFirstImageUrl.trim()
        ? data.persistedPanelFirstImageUrl.trim()
        : null;
    if (urls.length === 0 && !first) return;

    const localSig = JSON.stringify({ u: resultImageUrls, f: resultImageUrl ?? null });
    const graphSig = panelResultSig(urls, first);
    if (localSig === graphSig) return;
    const graphVersionChangedAfterGenerationStart =
      data.outputMediaVersion !== generationStartOutputVersionRef.current ||
      data.lastGeneratedAt !== generationStartGeneratedAtRef.current;
    const graphChangedAfterGenerationStart =
      graphVersionChangedAfterGenerationStart ||
      graphSig !== generationStartGraphResultSigRef.current;
    if (
      loading &&
      localGenerateInFlightRef.current &&
      !currentRunHasOutputRef.current &&
      !graphVersionChangedAfterGenerationStart
    ) {
      return;
    }
    if (loading && !graphChangedAfterGenerationStart) return;

    if (graphVersionChangedAfterGenerationStart) {
      currentRunHasOutputRef.current = true;
    }
    if (urls.length > 0) {
      setResultImageUrls(urls);
      setResultImageUrl(null);
      lastPanelPersistSigRef.current = JSON.stringify({ u: urls, f: null });
    } else if (first) {
      setResultImageUrl(first);
      setResultImageUrls([]);
      lastPanelPersistSigRef.current = JSON.stringify({ u: [], f: first });
    }
    setLocalError(null);
    setResultRenderError(null);
    if (data.isLoading !== true) {
      localGenerateInFlightRef.current = false;
    }
    if (data.isLoading === false) {
      setLoading(false);
      setStreamStatusLine(null);
      setStreamInQueue(false);
    }
  }, [
    initDone,
    loading,
    data.persistedPanelImageUrls,
    data.persistedPanelFirstImageUrl,
    data.outputMediaVersion,
    data.lastGeneratedAt,
    data.isLoading,
    resultImageUrls,
    resultImageUrl,
  ]);

  useEffect(() => {
    if (
      !providerMenuOpen &&
      !modelMenuOpen &&
      !qualityMenuOpen &&
      !sizeMenuOpen &&
      !countMenuOpen &&
      !durationMenuOpen
    ) {
      return;
    }
    const close = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t || !(t instanceof Element)) return;
      const el = floatMenusRef.current;
      if (el?.contains(t)) return;
      setProviderMenuOpen(false);
      setModelMenuOpen(false);
      setQualityMenuOpen(false);
      setSizeMenuOpen(false);
      setCountMenuOpen(false);
      setDurationMenuOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [providerMenuOpen, modelMenuOpen, qualityMenuOpen, sizeMenuOpen, countMenuOpen, durationMenuOpen]);

  useEffect(() => {
    if (!expandedResultUrl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpandedResultUrl(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedResultUrl]);

  useEffect(() => {
    const close = () => setExpandedResultUrl(null);
    window.addEventListener(JIMENG_CLOSE_MEDIA_LIGHTBOX_EVENT, close);
    return () => window.removeEventListener(JIMENG_CLOSE_MEDIA_LIGHTBOX_EVENT, close);
  }, []);

  const renderEditorFromText = (text: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.innerHTML = "";
    const segs = parsePrompt(text);
    for (const seg of segs) {
      if (seg.type === "text") {
        if (seg.text.length > 0) editor.appendChild(document.createTextNode(seg.text));
        continue;
      }
      const refImg = connectedByRefIndex.get(seg.refType + ":" + String(seg.refIndex));
      const span = document.createElement("span");
      span.setAttribute("data-ref-index", String(seg.refIndex));
      span.setAttribute("data-ref-type", seg.refType);
      span.setAttribute("contenteditable", "false");
      span.className =
        "inline-flex items-center gap-1 px-1 py-0.5 rounded-md bg-zinc-700 border border-zinc-500 align-middle h-6 leading-6 select-none";

      if (refImg?.isVideo && refImg.url) {
        const vid = document.createElement("video");
        vid.className =
          "w-5 h-5 rounded-sm overflow-hidden border border-zinc-700 object-cover";
        vid.src = refImg.url;
        vid.muted = true;
        vid.playsInline = true;
        vid.preload = "metadata";
        span.appendChild(vid);
      } else {
        const img = document.createElement("img");
      img.alt = "图片" + String(seg.refIndex);
        img.className =
          "w-5 h-5 rounded-sm overflow-hidden border border-zinc-700 object-cover";
        img.src = refImg?.url ?? "";
        span.appendChild(img);
      }

      const label = document.createElement("span");
      label.textContent =
        (seg.refType === "video" ? "视频" : "图片") + String(seg.refIndex);
      label.className = "text-[11px] text-zinc-300";
      span.appendChild(label);

      const removeBtn = document.createElement("span");
      removeBtn.textContent = "×";
      removeBtn.className =
        "ml-1 cursor-pointer text-[12px] leading-4 text-red-200/55 hover:text-red-200/95 select-none";
      removeBtn.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        span.remove();
        editorRef.current?.focus();
        setTimeout(() => updateEditorTextFromDom(), 0);
      };
      span.appendChild(removeBtn);

      span.title =
        "引用 @" + (seg.refType === "video" ? "视频" : "图片") + String(seg.refIndex);
      span.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = span.getBoundingClientRect();
        const before = e.clientX < rect.left + rect.width / 2;
        const rr = placeCaretAroundElement(span, before);
        if (rr) lastRangeRef.current = rr;
        editorRef.current?.focus();
      };

      editor.appendChild(span);
      // 閸︺劎娴夐柇璇叉禈閺嶅洣绠ｉ梻瀛樺絹娓氭稑褰查悙鐟板毊閻ㄥ嫰娈ｈぐ銏犲帨閺嶅洦蝎娴?
      editor.appendChild(document.createTextNode("\u200B"));
    }
    // If empty, ensure caret can be placed at start
    if (editor.childNodes.length === 0) editor.appendChild(document.createTextNode(""));
  };

  useEffect(() => {
    if (!panelOpen || !initDone) return;
    if (isCompactDockedPanel) {
      setPanelReady(true);
      return;
    }
    setPanelReady(false);
    const text = latestEditorTextRef.current;
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (!editorRef.current) return;
        renderEditorFromText(text);
        setPanelReady(true);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      setPanelReady(false);
    };
    // renderEditorFromText 娓氭繆绂?connectedByRefIndex閿涙稑绱╅悽銊ユ健閻㈠崬褰熸稉鈧?effect 閸楁洜瀚弴瀛樻煀閿涘矂浼╅崗宥嗙槨濞喡ょ箾缁惧灝褰夐崠鏍ㄧ缁岃櫣绱潏鎴濆敶鐎?
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen, initDone, panelDisplayMode, dockPanelMode, isCompactDockedPanel]);

  useEffect(() => {
    if (!panelReady) return;
    // When local image URLs change (upload/delete/reorder), update thumbnail src without re-rendering DOM.
    const editor = editorRef.current;
    if (!editor) return;
    const spans = Array.from(editor.querySelectorAll("span[data-ref-index]")) as HTMLElement[];
    let changed = false;
    for (const span of spans) {
      const ref = span.getAttribute("data-ref-index");
      if (!ref) continue;
      const idx = Number(ref);
      const refType = span.getAttribute("data-ref-type") === "video" ? "video" : "image";
      const refImg = connectedByRefIndex.get(refType + ":" + String(idx));
      if (!refImg?.url) {
        span.remove();
        changed = true;
        continue;
      }
      const img = span.querySelector("img") as HTMLImageElement | null;
      const vid = span.querySelector("video") as HTMLVideoElement | null;
      if (refImg?.isVideo && refImg.url) {
        if (vid) {
          vid.src = refImg.url;
        } else if (img) {
          const v = document.createElement("video");
          v.className =
            "w-5 h-5 rounded-sm overflow-hidden border border-zinc-700 object-cover";
          v.src = refImg.url;
          v.muted = true;
          v.playsInline = true;
          v.preload = "metadata";
          img.replaceWith(v);
        }
      } else {
        if (img) {
          img.src = refImg?.url ?? "";
        } else if (vid) {
          const im = document.createElement("img");
        im.alt = "图片" + String(idx);
          im.className =
            "w-5 h-5 rounded-sm overflow-hidden border border-zinc-700 object-cover";
          im.src = refImg?.url ?? "";
          vid.replaceWith(im);
        }
      }
    }
    if (changed) setTimeout(() => updateEditorTextFromDom(), 0);
  }, [connectedByRefIndex, panelReady]);

  const updateEditorTextFromDom = () => {
    const prompt = buildPromptFromDom(editorRef.current);
    setEditorText(prompt);
    data.onPromptTextChange?.(prompt);
  };

  const insertPlainTextAtCaret = useCallback((text: string, preferredRange?: Range | null) => {
    const editor = editorRef.current;
    if (!editor) return false;
    editor.focus();
    const sel = window.getSelection();
    if (!sel) return false;
    let range =
      preferredRange?.cloneRange() ??
      (sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : lastRangeRef.current?.cloneRange() ?? null);
    if (!range || !editor.contains(range.startContainer)) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    const after = document.createRange();
    after.setStart(textNode, textNode.length);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);
    lastRangeRef.current = after.cloneRange();
    updateEditorTextFromDom();
    return true;
  }, []);

  const insertRefAtRange = (refType: "image" | "video", refIndex: number, range: Range | null) => {
    const editor = editorRef.current;
    if (!editor || !range) return;
    const sel = window.getSelection();
    if (!sel) return;

    // Replace the preceding '@' based on insertion range itself, not global selection.
    const targetRange = range.cloneRange();
    const anchor = targetRange.startContainer;
    const offset = targetRange.startOffset;
    if (anchor && anchor.nodeType === Node.TEXT_NODE && offset > 0) {
      const t = (anchor as Text).data;
      if (t[offset - 1] === "@") {
        const next = t.slice(0, offset - 1) + t.slice(offset);
        (anchor as Text).data = next;
        const newOffset = offset - 1;
        targetRange.setStart(anchor, Math.max(0, newOffset));
        targetRange.collapse(true);
        mentionRangeRef.current = targetRange.cloneRange();
        lastRangeRef.current = targetRange.cloneRange();
      }
    }

    const refImg = connectedByRefIndex.get(refType + ":" + String(refIndex));
    const span = document.createElement("span");
    span.setAttribute("data-ref-index", String(refIndex));
    span.setAttribute("data-ref-type", refType);
    span.setAttribute("contenteditable", "false");
    span.className =
      "inline-flex items-center gap-1 px-1 py-0.5 rounded-md bg-zinc-700 border border-zinc-500 align-middle h-6 leading-6 select-none";

    if (refImg?.isVideo && refImg.url) {
      const vid = document.createElement("video");
      vid.className =
        "w-5 h-5 rounded-sm overflow-hidden border border-zinc-700 object-cover";
      vid.src = refImg.url;
      vid.muted = true;
      vid.playsInline = true;
      vid.preload = "metadata";
      span.appendChild(vid);
    } else {
      const img = document.createElement("img");
    img.alt = "图片" + String(refIndex);
      img.className =
        "w-5 h-5 rounded-sm overflow-hidden border border-zinc-700 object-cover";
      img.src = refImg?.url ?? "";
      span.appendChild(img);
    }

    const label = document.createElement("span");
    label.textContent = (refType === "video" ? "视频" : "图片") + String(refIndex);
    label.className = "text-[11px] text-zinc-300";
    span.appendChild(label);

    const removeBtn = document.createElement("span");
    removeBtn.textContent = "×";
    removeBtn.className =
      "ml-1 cursor-pointer text-[12px] leading-4 text-red-200/55 hover:text-red-200/95 select-none";
    removeBtn.onmousedown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      span.remove();
      editorRef.current?.focus();
      setTimeout(() => updateEditorTextFromDom(), 0);
    };
    span.appendChild(removeBtn);

    span.title = "引用 @" + (refType === "video" ? "视频" : "图片") + String(refIndex);
    span.onmousedown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = span.getBoundingClientRect();
      const before = e.clientX < rect.left + rect.width / 2;
      const rr = placeCaretAroundElement(span, before);
      if (rr) lastRangeRef.current = rr;
      editorRef.current?.focus();
    };
    const r = targetRange.cloneRange();
    r.deleteContents();
    r.insertNode(span);
    // 閸ョ偓鐖ｉ崥搴ㄦ桨鐞涖儰绔存稉顏堟祩鐎硅棄褰茬紓鏍帆濡叉垝缍呴敍灞炬暜閹镐讲鈧粌娴橀弽鍥︾瑢閸ョ偓鐖ｆ稊瀣？閳ユ繃褰冪€?
    span.after(document.createTextNode("\u200B"));

    // Put caret after the span
    const after = document.createRange();
    if (span.nextSibling && span.nextSibling.nodeType === Node.TEXT_NODE) {
      const textNode = span.nextSibling as Text;
      after.setStart(textNode, textNode.length);
    } else {
      after.setStartAfter(span);
    }
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);
    lastRangeRef.current = after;

    // Ensure a trailing text node so user can keep typing
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parent: any = span.parentNode;
    if (parent && parent.childNodes && parent.childNodes.length > 0) {
      // no-op; browser keeps caret workable
    }
    setTimeout(() => updateEditorTextFromDom(), 0);
  };

  const openMentionFromSelection = () => {
    const editor = editorRef.current;
    const host = mentionHostRef.current;
    const sel = window.getSelection();
    if (!editor || !host || !sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const rect = getRangeRect(range);
    if (!rect) return;
    const hostRect = host.getBoundingClientRect();
    mentionRangeRef.current = range.cloneRange();
    setMentionPos(getFloatingPanelPos({ hostRect, rangeRect: rect, panelWidth: 112, panelHeight: 230 }));
    setMentionOpen(true);
  };

  const openDirectiveMenuFromSelection = useCallback(() => {
    const editor = editorRef.current;
    const host = mentionHostRef.current;
    const sel = window.getSelection();
    if (!editor || !host) return;
    const range =
      sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : lastRangeRef.current?.cloneRange() ?? null;
    if (!range) return;
    const rect = getRangeRect(range);
    if (!rect) return;
    const hostRect = host.getBoundingClientRect();
    directiveRangeRef.current = range.cloneRange();
    setDirectiveMenuPos(
      getFloatingPanelPos({
        hostRect,
        rangeRect: rect,
        panelWidth: GPT_DIRECTIVE_MENU_WIDTH,
        panelHeight: GPT_DIRECTIVE_MENU_HEIGHT,
      })
    );
    setDirectiveMenuOpen(true);
  }, []);

  const tryOpenMentionOnKeyUp = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((data.connectedImages?.length ?? 0) <= 0) return;
    if (e.key !== "@" && e.key !== "Process" && e.key !== "Unidentified") {
      // We only open on '@' or when IME commits '@' weirdly.
    }
    // check preceding char in current text node
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const anchor = sel.anchorNode;
    const offset = sel.anchorOffset;
    if (!anchor || anchor.nodeType !== Node.TEXT_NODE) return;
    if (offset <= 0) return;
    const textNode = anchor as Text;
    if (textNode.data[offset - 1] !== "@") return;
    openMentionFromSelection();
  };

  const applyAssistantPrompt = useCallback(
    (text: string) => {
      const next = normalizeAssistantPromptText(text);
      if (!next) return;
      setAssistantError(null);
      setEditorText(next);
      data.onPromptTextChange?.(next);
      if (editorRef.current) {
        renderEditorFromText(next);
        editorRef.current.focus();
      }
    },
    [data, renderEditorFromText]
  );

  const collectAssistantImageDataUrls = useCallback(async () => {
    const refs = assistantImageRefs.slice(0, 3);
    const output: string[] = [];
    for (const item of refs) {
      try {
        const resp = await fetch(item.url, { cache: "no-store" });
        if (!resp.ok) continue;
        const blob = await resp.blob();
        output.push(await blobToDataUrl(blob));
      } catch {
        /* ignore single image failure */
      }
    }
    return output;
  }, [assistantImageRefs]);

  const runPromptAssistant = useCallback(
    async (mode: "analyze" | "infer" | "optimize") => {
      const currentPrompt = latestEditorTextRef.current.trim();
      if (mode !== "optimize" && assistantImageRefs.length === 0) {
        setAssistantError("当前没有可供分析的参考图。");
        return;
      }
      if (mode === "optimize" && assistantImageRefs.length === 0 && !currentPrompt) {
        setAssistantError("请先输入提示词，或至少连接一张参考图。");
        return;
      }

      setAssistantBusy(true);
      setAssistantError(null);
      setAssistantOutput("");
      setAssistantOutputKind(null);
      setAssistantActionLabel(
        mode === "analyze"
          ? "分析参考图"
          : mode === "infer"
            ? "生成提示词"
            : "优化提示词"
      );

      try {
        const imageDataUrls = await collectAssistantImageDataUrls();
        const contextLines = [
          "任务类型: " + (isVideoPrompt ? "视频生成" : "图片生成"),
          "当前模型: " + (currentModelMeta?.title ?? modelVersion),
          "尺寸参数: " + formatSizeLabel(ratio, resolutionType, isVideoPrompt ? "video" : "image", modelVersion),
          isVideoPrompt ? "时长: " + durationSeconds + "s" : "张数: " + count,
          "参考模式: " + (referenceMode === "headtail" ? "首尾帧" : "通用参考"),
          assistantRefLabels.length > 0 ? "可用参考标签: " + assistantRefLabels.join(" ") : "可用参考标签: 无",
          currentPrompt ? "当前提示词: " + currentPrompt : "当前提示词: 空",
        ];

        const systemPrompt =
          mode === "analyze"
            ? [
                "You are a prompt analysis assistant inside a canvas node.",
                "Use the reference images and current generation context to analyze the scene and extract useful keywords.",
                "Reply in Simplified Chinese and structure the answer into four sections:",
                "1. 画面观察",
                "2. 可提炼关键词",
                "3. 优化建议",
                "4. 建议提示词",
                "Keep each section concise and do not output code blocks.",
              ].join("\n")
            : [
                "You are a prompt optimization assistant inside a canvas node.",
                "Return one final prompt that can be pasted directly into the input.",
                "Return only the prompt text, with no title, explanation, numbering, or code block.",
                "If the context contains tags like @图片N or @视频N, keep and use them naturally.",
                "Do not output model names, resolutions, counts, durations, or other UI settings.",
              ].join("\n");

        const prompt =
          mode === "analyze"
            ? [
                contextLines.join("\n"),
                "",
                "Please analyze these reference images together with the current settings, and help identify the subject, style, composition, motion, and scene priorities.",
              ].join("\n")
            : [
                contextLines.join("\n"),
                "",
                mode === "infer"
                  ? "Please infer one high-quality prompt that matches the current task based on the reference images."
                  : "Please optimize the current prompt and reference images into one clearer, more specific, and more usable final prompt.",
              ].join("\n");

        const resp = await fetch("/api/aiwanwu/text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            systemPrompt,
            model: assistantModel || "gpt-5.4",
            imageDataUrls,
          }),
        });
        const json = (await resp.json().catch(() => null)) as
          | {
              ok?: boolean;
              error?: string;
              text?: string;
            }
          | null;
        if (!resp.ok || !json?.ok || typeof json.text !== "string" || !json.text.trim()) {
          throw new Error(json?.error || "AI 助手暂时不可用。");
        }
        const nextText = json.text.trim();
        setAssistantOutput(nextText);
        setAssistantOutputKind(mode === "analyze" ? "analysis" : "prompt");
      } catch (error) {
        setAssistantError(
          error instanceof Error ? error.message : "AI 助手暂时不可用。"
        );
      } finally {
        setAssistantBusy(false);
      }
    },
    [
      assistantImageRefs.length,
      assistantModel,
      assistantRefLabels,
      collectAssistantImageDataUrls,
      count,
      currentModelMeta,
      durationSeconds,
      isVideoPrompt,
      modelVersion,
      ratio,
      referenceMode,
      resolutionType,
    ]
  );

  const onEditorMouseUpOrKeyUp = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    lastRangeRef.current = sel.getRangeAt(0).cloneRange();
  };

  useEffect(() => {
    if (!mentionOpen) return;
    const refreshPos = () => {
      const host = mentionHostRef.current;
      if (!host) return;
      const sel = window.getSelection();
      const range =
        sel && sel.rangeCount > 0
          ? sel.getRangeAt(0)
          : mentionRangeRef.current ?? lastRangeRef.current;
      if (!range) return;
      const rect = getRangeRect(range);
      if (!rect) return;
      const hostRect = host.getBoundingClientRect();
      mentionRangeRef.current = range.cloneRange();
      const leftLocal = rect.left - hostRect.left - 6;
      const topLocal = rect.bottom - hostRect.top + 6;
      setMentionPos(
        clampMentionPos({
          left: Math.max(6, Math.min(leftLocal, hostRect.width - 112)),
          top: Math.max(6, Math.min(topLocal, hostRect.height - 230)),
        })
      );
    };
    const onSel = () => refreshPos();
    const onScroll = () => refreshPos();
    document.addEventListener("selectionchange", onSel);
    window.addEventListener("scroll", onScroll, true);
    refreshPos();
    return () => {
      document.removeEventListener("selectionchange", onSel);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [mentionOpen]);

  useEffect(() => {
    if (!directiveMenuOpen) return;
    const refreshPos = () => {
      const host = mentionHostRef.current;
      const range = directiveRangeRef.current ?? lastRangeRef.current;
      if (!host || !range) return;
      const rect = getRangeRect(range);
      if (!rect) return;
      const hostRect = host.getBoundingClientRect();
      setDirectiveMenuPos(
        getFloatingPanelPos({
          hostRect,
          rangeRect: rect,
          panelWidth: GPT_DIRECTIVE_MENU_WIDTH,
          panelHeight: GPT_DIRECTIVE_MENU_HEIGHT,
        })
      );
    };
    const onSel = () => refreshPos();
    const onScroll = () => refreshPos();
    document.addEventListener("selectionchange", onSel);
    window.addEventListener("scroll", onScroll, true);
    refreshPos();
    return () => {
      document.removeEventListener("selectionchange", onSel);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [directiveMenuOpen]);

  useEffect(() => {
    if (!mentionOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (mentionPanelRef.current?.contains(t)) return;
      if (editorRef.current?.contains(t)) return;
      setMentionOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [mentionOpen]);

  useEffect(() => {
    if (!directiveMenuOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (directivePanelRef.current?.contains(t)) return;
      if (editorRef.current?.contains(t)) return;
      setDirectiveMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [directiveMenuOpen]);

  const runGenerateFlow = async () => {
    if (!data.onGenerate) return;
    const prompt = editorText.trim();
    if (!prompt) {
      setLocalError("提示词不能为空。");
      return;
    }
    const requiresJimengLogin =
      isVideoPrompt ? videoProvider !== "external_api" : imageProvider !== "aiwanwu";
    if (requiresJimengLogin) {
      try {
        const creditRes = await fetch("/api/credit");
        const creditJson = await creditRes.json().catch(() => ({}));
        if (!creditRes.ok || typeof creditJson?.totalCredit !== "number") {
          setShowLoginModal(true);
          return;
        }
      } catch {
        setShowLoginModal(true);
        return;
      }
    }

    const token = ++activeGenerateTokenRef.current;
    localGenerateInFlightRef.current = true;
    currentRunHasOutputRef.current = false;
    generationStartOutputVersionRef.current = data.outputMediaVersion;
    generationStartGeneratedAtRef.current = data.lastGeneratedAt;
    generationStartGraphResultSigRef.current = panelResultSig(
      data.persistedPanelImageUrls,
      data.persistedPanelFirstImageUrl
    );
    flushSync(() => {
      setRestoredVideoPolling(false);
      setLoading(true);
      setStreamStatusLine("提交任务中...");
      setResultImageUrl(null);
      setResultImageUrls([]);
      setPrimaryImageResultIndex(0);
      setLocalError(null);
      setResultRenderError(null);
      setSawStreamProgressEvent(false);
      setStreamInQueue(true);
      setProgress(0);
    });
    persistRuntimeRef.current?.({
      isLoading: true,
      error: null,
      streamStatusLine: "提交任务中...",
      streamProgressPct: 0,
      streamInQueue: true,
      lastSubmitId: null,
      resumeGenSourceNodeId: id,
    });
    data.onPanelPrimaryImageIndexChange?.(0);
    data.onCollapseImageResultsFromCanvas?.();
    sawStreamProgressRef.current = false;
    wasQueuePhaseRef.current = false;
    let sawImage = false;
    let keepBackgroundSyncAfterReturn = false;
    try {
    const result = await data.onGenerate({
      prompt,
      nodeId: id,
        imageProvider,
        videoProvider,
        externalApiProviderId: data.externalApiProviderId,
        imageQuality,
        modelVersion,
        ratio,
        resolutionType,
        count,
        ...(isVideoPrompt ? { durationSeconds, withAudio } : {}),
        onEachImage: (url) => {
          if (token !== activeGenerateTokenRef.current) return;
          sawImage = true;
          currentRunHasOutputRef.current = true;
          setResultImageUrl(null);
          /** 濞翠礁绱″В蹇撶炊娑撯偓閸戣櫣鐝涢崡铏絹娴?DOM閿涘矂浼╅崗宥勭瑢閻栧墎楠?setNodes 閸氬奔绔撮幍纭呯殶鎼达箑顕遍懛娣偓灞藉弿婵傝姤澧犻弰鍓с仛閵?*/
          flushSync(() => {
            setResultImageUrls((prev) => [...prev, url]);
          });
        },
        onStreamProgress: (ev) => {
          if (token !== activeGenerateTokenRef.current) return;
          sawStreamProgressRef.current = true;
          setSawStreamProgressEvent(true);
          const sid = ev.submitId != null && String(ev.submitId).trim() ? String(ev.submitId).trim() : null;
          if (sid) setVideoResumeSubmitId(sid);
          const inQ = isProgressQueuePhase(ev);
          if (wasQueuePhaseRef.current && !inQ) setProgress(0);
          wasQueuePhaseRef.current = inQ;
          setStreamInQueue(inQ);
          setStreamStatusLine(formatGenerateProgressLine(ev));
          setProgress((prev) => computeProgressFromStreamEvent(ev, prev));
        },
      });
      if (token !== activeGenerateTokenRef.current) return;
      setProgress(100);
      const urls = Array.isArray(result?.imageUrls) ? result.imageUrls : [];
      const completedOutputCount =
        urls.length > 0 ? urls.length : result?.firstImageUrl ? 1 : 0;
      if (typeof result?.costPerImage === "number") {
        const nextTaskCost =
          completedOutputCount > 0 ? result.costPerImage * completedOutputCount : result.costPerImage;
        const nextTaskOutputCount = completedOutputCount > 0 ? completedOutputCount : 1;
        setLastCostPerImage(result.costPerImage);
        setLastTaskCost(nextTaskCost);
        setLastTaskOutputCount(nextTaskOutputCount);
        setLastUsageTokens(null);
        data.onPromptSettingsChange?.({
          lastCostPerImage: result.costPerImage,
          lastTaskCost: nextTaskCost,
          lastTaskOutputCount: nextTaskOutputCount,
          lastUsageTokens: null,
        });
      } else {
        const usageTokens =
          typeof (result as { usage?: { total_tokens?: number | null } | null })?.usage?.total_tokens ===
          "number"
            ? (result as { usage?: { total_tokens?: number | null } | null }).usage?.total_tokens ?? null
            : null;
        setLastCostPerImage(null);
        setLastTaskCost(null);
        setLastTaskOutputCount(null);
        setLastUsageTokens(usageTokens);
        data.onPromptSettingsChange?.({
          lastCostPerImage: null,
          lastTaskCost: null,
          lastTaskOutputCount: null,
          lastUsageTokens: usageTokens,
        });
      }

      if (urls.length > 0) {
        currentRunHasOutputRef.current = true;
        setLocalError(null);
        setResultRenderError(null);
        setResultImageUrls((prev) => {
          if (sawImage && prev.length === urls.length && prev.length > 0) {
            const norm = (xs: string[]) =>
              [...xs]
                .map((x) => (typeof x === "string" ? x : ""))
                .filter((x) => x.length > 0)
                .sort()
                .join("\0");
            if (norm(prev) === norm(urls)) return prev;
          }
          return urls;
        });
        setResultImageUrl(null);
      } else if (result?.firstImageUrl && !sawImage) {
        currentRunHasOutputRef.current = true;
        setLocalError(null);
        setResultRenderError(null);
        setResultImageUrl(result.firstImageUrl);
        setResultImageUrls([]);
      } else if (!sawImage) {
        setResultImageUrl(null);
        setResultImageUrls([]);
      }
      if (result?.backgroundSyncPending || (!sawImage && urls.length === 0 && !result?.firstImageUrl)) {
        keepBackgroundSyncAfterReturn = true;
        setLocalError(
          result?.backgroundSyncPending && (urls.length > 0 || result?.firstImageUrl)
            ? isVideoPrompt
              ? "已收到部分结果，后台任务仍在继续同步剩余视频。"
              : "已收到部分结果，后台任务仍在继续同步剩余图片。"
            : isVideoPrompt
              ? "后台任务可能仍在继续，前端会继续等待视频结果同步。"
              : "后台任务可能仍在继续，前端会继续等待图片结果同步。"
        );
        setLoading(true);
        setRestoredVideoPolling(true);
        setSawStreamProgressEvent(true);
        setStreamInQueue(true);
        setStreamStatusLine(
          result?.backgroundSyncPending && (urls.length > 0 || result?.firstImageUrl)
            ? "已收到部分结果，后台任务仍在继续同步..."
            : "后台任务仍在继续，等待结果同步..."
        );
      }
      if (!keepBackgroundSyncAfterReturn) {
        localGenerateInFlightRef.current = false;
        setLoading(false);
      }
    } catch (e: unknown) {
      if (token === activeGenerateTokenRef.current) {
        localGenerateInFlightRef.current = false;
        const msg = e instanceof Error ? e.message : "生成失败";
        setLocalError(msg);
        setResultRenderError(msg);
      }
    } finally {
      if (token !== activeGenerateTokenRef.current) return;
      const keepBackgroundSync =
        keepBackgroundSyncAfterReturn ||
        restoredVideoPolling ||
        (videoResumeSubmitId != null && videoResumeSubmitId.trim().length > 0);
      if (!keepBackgroundSync) {
        localGenerateInFlightRef.current = false;
        setLoading(false);
        setVideoResumeSubmitId(null);
        setStreamStatusLine(null);
        setSawStreamProgressEvent(false);
        setStreamInQueue(false);
        wasQueuePhaseRef.current = false;
        setTimeout(() => setProgress(0), 400);
      }
    }
  };

  const beginGenerate = async () => {
    if (!data.onGenerate) return;
    const prompt = editorText.trim();
    if (!prompt) {
      setLocalError("提示词不能为空。");
      return;
    }
    await runGenerateFlow();
  };

  const handleInsertRefFromThumbnail = (refType: "image" | "video", refIndex: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    let range = lastRangeRef.current;
    if (!range) {
      const sel = window.getSelection();
      const r = document.createRange();
      r.selectNodeContents(editor);
      r.collapse(false);
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(r);
      }
      range = r;
      lastRangeRef.current = r;
    }
    insertRefAtRange(refType, refIndex, range);
  };

  const applyThumbReorder = useCallback(
    (dragId: string, hoverId: string) => {
      const connected = data.connectedImages ?? [];
      const ids = connected.map((c) => c.id);

      if (isVideoPrompt && referenceMode === "headtail") {
        const imageEntries = connected
          .map((c, i) => ({
            id: c.id,
            i,
            isVid: c.refType === "video" || c.isVideo,
          }))
          .filter((x) => !x.isVid);
        const frameEntries = imageEntries.slice(0, 2);
        if (frameEntries.length < 2) return;
        const w = frameEntries.map((x) => x.id);
        const from = w.indexOf(dragId);
        const to = w.indexOf(hoverId);
        if (from < 0 || to < 0 || from === to) return;
        const nextSlice = [...w];
        nextSlice.splice(from, 1);
        const newTo = from < to ? to - 1 : to;
        nextSlice.splice(newTo, 0, dragId);
        const nextFull = [...ids];
        nextFull[frameEntries[0].i] = nextSlice[0];
        nextFull[frameEntries[1].i] = nextSlice[1];
        data.onReorderConnectedImages?.(nextFull);
        return;
      }

      const from = ids.indexOf(dragId);
      const to = ids.indexOf(hoverId);
      if (from < 0 || to < 0 || from === to) return;
      const next = [...ids];
      next.splice(from, 1);
      const newTo = from < to ? to - 1 : to;
      next.splice(newTo, 0, dragId);
      data.onReorderConnectedImages?.(next);
    },
    [data.connectedImages, data.onReorderConnectedImages, isVideoPrompt, referenceMode]
  );

  const { shellW, shellH, handleRowW, previewBandH, handleGutter: HANDLE_GUTTER } = useMemo(
    () => computePromptPreviewShellDimensions(ratio),
    [ratio]
  );

  const handleLeftX = HANDLE_GUTTER - MAGNETIC_HANDLE_EDGE_OUTSET;
  const handleRightX = HANDLE_GUTTER + shellW + MAGNETIC_HANDLE_EDGE_OUTSET;
  const handleCenterY = previewBandH - shellH / 2;
  const settledTilesCount =
    resultImageUrls.length > 0
      ? resultImageUrls.length
      : typeof resultImageUrl === "string" && resultImageUrl.trim()
        ? 1
        : 0;
  const currentRunReadyCount =
    resultImageUrls.length > 0
      ? resultImageUrls.length
      : typeof resultImageUrl === "string" && resultImageUrl.trim()
        ? 1
        : 0;
  const shouldShowLoadingStack = loading && count > 1 && currentRunReadyCount > 0;
  const tilesCount = resultRenderError
    ? shouldShowLoadingStack
      ? Math.max(count, currentRunReadyCount)
      : settledTilesCount
    : shouldShowLoadingStack
      ? Math.max(count, currentRunReadyCount)
      : settledTilesCount;
  const showTiles =
    tilesCount > 0 &&
    (resultImageUrls.length > 0 || shouldShowLoadingStack || (!!resultRenderError && settledTilesCount > 1));
  const stackPreviewUrls =
    resultImageUrls.length > 0
      ? resultImageUrls
      : loading || !!resultRenderError
        ? lastSettledResultImageUrlsRef.current
        : [];

  const maxPrimaryI = Math.max(0, tilesCount - 1);
  /** 娴兼ê鍘涢悥鍓侀獓 data閿涘牏鏁剧敮鍐啎娑撶粯妯夐敍澶涚礉闁灝鍘?useState 閺呮矮绔寸敮褌绗岄崣鐘靛 pIdx 娑撳秳绔撮懛?*/
  const resolvedPrimaryIdx =
    tilesCount > 0 &&
    Number.isFinite(primaryImageResultIndex) &&
    primaryImageResultIndex >= 0 &&
    primaryImageResultIndex <= maxPrimaryI
      ? primaryImageResultIndex
      : typeof data.promptPanelPrimaryImageIndex === "number" &&
          Number.isFinite(data.promptPanelPrimaryImageIndex) &&
          data.promptPanelPrimaryImageIndex >= 0 &&
          data.promptPanelPrimaryImageIndex <= maxPrimaryI
        ? data.promptPanelPrimaryImageIndex
        : Math.min(Math.max(0, primaryImageResultIndex), maxPrimaryI);
  const settledPrimaryPreviewUrl =
    stackPreviewUrls.length > 0
      ? trimRenderableUrl(
          stackPreviewUrls[Math.min(resolvedPrimaryIdx, Math.max(0, stackPreviewUrls.length - 1))]
        )
      : null;
  const currentDisplayUrl = useMemo(() => {
    if (showTiles && resultImageUrls.length > 0) {
      const u = resultImageUrls[resolvedPrimaryIdx];
      if (typeof u === "string" && u.trim()) return u.trim();
    }
    if (typeof resultImageUrl === "string" && resultImageUrl.trim()) return resultImageUrl.trim();
    return null;
  }, [showTiles, resultImageUrls, resolvedPrimaryIdx, resultImageUrl]);
  useEffect(() => {
    if (!isVideoPrompt || videoProvider !== "external_api" || !currentDisplayUrl || !urlLooksLikeVideoFile(currentDisplayUrl)) {
      setActualVideoMeta(null);
      return;
    }
    if (typeof window === "undefined") return;
    let cancelled = false;
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    const handleLoaded = () => {
      if (cancelled) return;
      const width = Math.round(video.videoWidth || 0);
      const height = Math.round(video.videoHeight || 0);
      const durationSeconds = Number.isFinite(video.duration) ? Number(video.duration) : 0;
      if (width <= 0 || height <= 0 || durationSeconds <= 0) return;
      setActualVideoMeta({
        width,
        height,
        durationSeconds,
        ratioLabel: nearestVideoRatioLabel(width, height),
        resolutionLabel: `${width}×${height}`,
      });
    };
    const handleError = () => {
      if (!cancelled) setActualVideoMeta(null);
    };
    video.addEventListener("loadedmetadata", handleLoaded, { once: true });
    video.addEventListener("error", handleError, { once: true });
    video.src = withGeneratedMediaCacheBust(currentDisplayUrl, ownOutputCacheBustKey);
    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", handleLoaded);
      video.removeEventListener("error", handleError);
      video.src = "";
    };
  }, [currentDisplayUrl, isVideoPrompt, ownOutputCacheBustKey, videoProvider]);

  useEffect(() => {
    const maxIdx = Math.max(0, tilesCount - 1);
    setPrimaryImageResultIndex((i) => {
      if (!Number.isFinite(i)) return 0;
      const next = Math.min(Math.max(0, i), maxIdx);
      return next !== i ? next : i;
    });
  }, [tilesCount]);

  useEffect(() => {
    if (
      typeof data.promptPanelPrimaryImageIndex !== "number" ||
      !Number.isFinite(data.promptPanelPrimaryImageIndex)
    ) {
      return;
    }
    const maxIdx = Math.max(0, tilesCount - 1);
    const next = Math.min(Math.max(0, data.promptPanelPrimaryImageIndex), maxIdx);
    setPrimaryImageResultIndex((current) => (current === next ? current : next));
  }, [data.promptPanelPrimaryImageIndex, tilesCount]);

  useEffect(() => {
    if (loading) return;
    if (!data.canvasImageSpill || data.canvasImageSpill.collapseAnim) return;
    if (tilesCount > 1) return;
    collapseImageResultsFromCanvasRef.current?.();
  }, [loading, tilesCount, data.canvasImageSpill]);

  useEffect(() => {
    if (!hasRenderableOutput) return;
    setLocalError((prev) => (prev == null ? prev : null));
    setResultRenderError((prev) => (prev == null ? prev : null));
  }, [hasRenderableOutput]);

  useEffect(() => {
    if (loading) return;
    if (resultImageUrls.length > 0) {
      lastSettledResultImageUrlsRef.current = resultImageUrls.slice();
      return;
    }
    if (typeof resultImageUrl === "string" && resultImageUrl.trim()) {
      lastSettledResultImageUrlsRef.current = [resultImageUrl.trim()];
    }
  }, [loading, resultImageUrl, resultImageUrls]);

  const spillGridOpen = Boolean(data.canvasImageSpill);
  const magneticHandlesVisible = magneticReveal && !spillGridOpen;

  return (
    <div
      className="group/prompt-node relative max-w-[min(92vw,calc(100vw-24px))] overflow-visible text-white"
      style={{ width: handleRowW }}
      onPointerEnter={() => {
        setMagneticReveal(true);
        canvasNodePointerInsideRef.current = true;
      }}
      onPointerLeave={(e) => {
        if (e.buttons === 0) {
          setMagneticReveal(false);
          canvasNodePointerInsideRef.current = false;
        }
      }}
    >
      {currentDisplayUrl ? (
        <button
          type="button"
          title="全屏查看结果"
          className={[
            "nodrag nopan pointer-events-auto absolute z-[40] flex size-7 items-center justify-center rounded-lg text-zinc-100 shadow-sm ring-1 ring-inset backdrop-blur-sm transition-all",
            "bg-zinc-950/45 ring-white/[0.08]",
            "hover:bg-zinc-800/70",
            selected ? "opacity-100" : "pointer-events-none opacity-0",
          ].join(" ")}
          style={{
            top: Math.max(0, previewBandH - shellH) - 30,
            right: Math.max(0, (handleRowW - shellW) / 2) - 8,
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            window.dispatchEvent(new Event(JIMENG_CLOSE_MEDIA_LIGHTBOX_EVENT));
            setExpandedResultUrl(currentDisplayUrl);
          }}
          onPointerUp={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      ) : null}

      {/* 閸ュ搫鐣炬０鍕潔鐢箒顥嗛崜顏庣窗闁灝鍘ら悽鐔稿灇娑擃厽澧栭崙?濞翠礁鍘滈幘鎴濄亣閼哄倻鍋ｉ崠鍛纯閻╂帒顕遍懛瀛樻殻閸椔ゎ潒鐟欏缍呯粔?*/}
        <div
          className={[
            "relative pointer-events-none",
            selected || (showTiles && tilesCount > 1) ? "overflow-visible" : "overflow-hidden",
          ].join(" ")}
          style={{ height: previewBandH }}
        >
        <MagneticHandleTarget
          id="image_input"
          pinX={handleLeftX}
          pinY={handleCenterY}
          magneticVisible={magneticHandlesVisible}
        />

        {selected ? (
          <div
            className="pointer-events-none absolute left-1/2 z-[2] -translate-x-1/2 rounded-xl shadow-[0_0_0_2px_rgba(228,228,231,0.92),0_0_0_4px_rgba(0,0,0,0.96),0_0_14px_rgba(255,255,255,0.08)]"
            style={{
              width: shellW,
              height: shellH,
              bottom: 0,
            }}
            aria-hidden
          />
        ) : null}
        <div
          className="pointer-events-none absolute z-[28] inline-flex items-center gap-1 rounded-full border border-white/10 bg-zinc-950/78 px-2 py-0.5 text-[10px] font-medium text-zinc-200 shadow-[0_8px_20px_rgba(0,0,0,0.18)] backdrop-blur-sm"
          style={{
            top: Math.max(0, previewBandH - shellH) - 26,
            left: Math.max(0, (handleRowW - shellW) / 2) + 10,
          }}
          aria-hidden
        >
          <span>{isVideoPrompt ? "视频" : "生图"}</span>
          <span className="text-zinc-400">#{data.promptIndex ?? 1}</span>
        </div>

        <div
          className={[
            "jimeng-canvas-node-drag-handle pointer-events-auto absolute left-1/2 -translate-x-1/2 cursor-grab rounded-xl bg-zinc-800 ring-1 ring-inset ring-white/[0.09] shadow-[0_10px_32px_rgba(0,0,0,0.42)] active:cursor-grabbing",
            showTiles && tilesCount > 1
              ? loading
                ? "jimeng-prompt-shell-rendering overflow-visible"
                : "overflow-visible"
              : loading
                ? "jimeng-prompt-shell-rendering overflow-visible"
                : "overflow-hidden",
            /** 閻㈢喐鍨氭稉顓濈矤缁屽搫锛撻埆鎺戭樋閺?deck 閺冭泛瀣佺€?width/height/transform 閸?500ms 鏉╁洦娴敍灞芥儊閸掓瑨顫嬬憴澶夌瑐濡楀棔绱伴妴灞肩瑐缁夋眹鈧秳绗栨稉搴ｆ暰鐢啰缍夐弽鐓庡彆瀵繘鏁嬮悙閫涚瑝娑撯偓閼?*/
            loading
              ? "transition-[box-shadow,opacity] duration-300 ease-out"
              : "transition-[width,height,transform,box-shadow,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
            selected ? "z-[3] shadow-[0_10px_32px_rgba(0,0,0,0.52),0_0_12px_rgba(255,255,255,0.08)]" : "z-[1]",
          ]
            .filter(Boolean)
            .join(" ")}
          style={{
            width: shellW,
            height: shellH,
            bottom: 0,
          }}
          onPointerDown={(e) => {
            if (
              (e.target as HTMLElement).closest(
                "button, a, input, textarea, [contenteditable='true']"
              )
            ) {
              handlePreviewPointerDown(e);
              return;
            }
            handlePreviewPointerDown(e);
          }}
          onClick={() => {
            requestOpen();
          }}
        >
          {currentDisplayUrl ? (
            <button
              type="button"
              title="下载结果"
              className={[
                "nodrag nopan absolute top-1 z-[26] flex size-7 items-center justify-center rounded-lg text-zinc-100 shadow-sm ring-1 ring-inset backdrop-blur-sm transition-all",
                "left-1 bg-zinc-950/45 ring-white/[0.08]",
                "opacity-0 hover:bg-zinc-800/70 group-hover/prompt-node:opacity-100 group-focus-within/prompt-node:opacity-100",
                selected ? "opacity-100" : "",
              ].join(" ")}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                downloadMediaUrls([currentDisplayUrl], "prompt-" + id);
              }}
            >
              <Download className="h-4 w-4" />
            </button>
          ) : null}
          {(() => {
            const primarySlotUrl = showTiles ? resultImageUrls[resolvedPrimaryIdx] : undefined;
            const primaryHasLoadedImage =
              !isVideoPrompt &&
              ((typeof resultImageUrl === "string" && resultImageUrl.length > 0) ||
                (typeof primarySlotUrl === "string" && primarySlotUrl.length > 0));
            const primaryHasVideo =
              isVideoPrompt &&
              ((typeof resultImageUrl === "string" &&
                resultImageUrl.length > 0 &&
                urlLooksLikeVideoFile(resultImageUrl)) ||
                (typeof primarySlotUrl === "string" &&
                  primarySlotUrl.length > 0 &&
                  urlLooksLikeVideoFile(primarySlotUrl)));
            if (primaryHasLoadedImage || primaryHasVideo) return null;
            return (
              <button
                type="button"
                title="上传图片或参考图"
                className={[
                  "absolute bottom-2 left-2 z-[2] flex size-[34px] shrink-0 cursor-pointer items-center justify-center rounded-[10px] bg-zinc-800 transition-colors hover:bg-zinc-700 focus:outline-none",
                  selected ? "ring-1 ring-zinc-400" : "",
                ].join(" ")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                <ImageIcon className="h-4 w-4 text-zinc-100" />
              </button>
            );
          })()}
          <div
            className={[
              "relative h-full w-full rounded-[inherit]",
              showTiles && tilesCount > 1 ? "overflow-visible" : "overflow-hidden",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {showTiles ? (
              tilesCount > 1 ? (
                (() => {
                  const pIdx = resolvedPrimaryIdx;
                  const belowPrimary: number[] = [];
                  for (let step = 1; step < tilesCount; step++) {
                    belowPrimary.push((pIdx + step) % tilesCount);
                  }
                  const maxBack = Math.min(3, belowPrimary.length);
                  const backIndices = belowPrimary.slice(0, maxBack);
                  const showCollapsedDeckStack =
                    backIndices.length > 0 &&
                    (!data.canvasImageSpill || data.canvasImageSpill.collapseAnim === true);
                  const collapseStackAlpha =
                    data.canvasImageSpill?.collapseAnim === true
                      ? Math.max(0, Math.min(1, data.canvasImageSpill.collapseStackAlpha ?? 0))
                      : 1;
                  return (
                    <div className="nopan relative h-full min-h-0 w-full overflow-visible p-[1px]">
                      <div className="relative h-full w-full overflow-visible">
                        {showCollapsedDeckStack ? (
                          <div aria-hidden className="pointer-events-none absolute inset-0 z-[9]">
                            {backIndices
                              .slice()
                              .reverse()
                              .map((idx, reverseLayer) => {
                                const x = 8 + reverseLayer * 6;
                                const y = 4 + reverseLayer * 4.5;
                                const rot = 1.65 + reverseLayer * 1.15;
                                const op = 0.5 + reverseLayer * 0.1;
                                const startX = 0.4 + reverseLayer * 0.7;
                                const startY = 10 + reverseLayer * 2.8;
                                const startRot = 0.12 + reverseLayer * 0.12;
                                const overshootX = x + 2.2 + reverseLayer * 0.8;
                                const overshootY = y - 1.2 - reverseLayer * 0.38;
                                const overshootRot = rot + 0.42 + reverseLayer * 0.14;
                                const wobbleRot = 1.1 + reverseLayer * 0.34;
                                const swayX = 1.15 + reverseLayer * 0.42;
                                const swayY = 0.62 + reverseLayer * 0.22;
                                const layerDelay = 22 + reverseLayer * 86;
                                const layerDuration = 1280 - reverseLayer * 120;
                                return (
                                  <div
                                    key={"deck-back-" + idx}
                                    className={[
                                      "prompt-results-deck-back absolute inset-0 overflow-hidden rounded-[11px] border border-white/[0.16] bg-zinc-950/70 shadow-[0_28px_48px_rgba(0,0,0,0.42)]",
                                      data.canvasImageSpill?.collapseAnim
                                        ? "prompt-results-deck-back-reveal"
                                        : "",
                                    ]
                                      .filter(Boolean)
                                      .join(" ")}
                                    style={
                                      {
                                        ["--deck-x" as any]: String(x) + "px",
                                        ["--deck-y" as any]: String(y) + "px",
                                        ["--deck-rot" as any]: String(rot) + "deg",
                                        ["--deck-opacity" as any]: String(op * collapseStackAlpha),
                                        ["--deck-start-x" as any]: String(startX) + "px",
                                        ["--deck-start-y" as any]: String(startY) + "px",
                                        ["--deck-start-rot" as any]: String(startRot) + "deg",
                                        ["--deck-overshoot-x" as any]: String(overshootX) + "px",
                                        ["--deck-overshoot-y" as any]: String(overshootY) + "px",
                                        ["--deck-overshoot-rot" as any]:
                                          String(overshootRot) + "deg",
                                        ["--deck-wobble-rot" as any]:
                                          String(wobbleRot) + "deg",
                                        ["--deck-sway-x" as any]: String(swayX) + "px",
                                        ["--deck-sway-y" as any]: String(swayY) + "px",
                                        ["--deck-layer-delay" as any]:
                                          String(layerDelay) + "ms",
                                        ["--deck-layer-duration" as any]:
                                          String(layerDuration) + "ms",
                                        transformOrigin: "100% 50%",
                                      } as React.CSSProperties
                                    }
                                  >
                                    <div className="absolute inset-0 rounded-[inherit] bg-[linear-gradient(180deg,rgba(255,255,255,0.18),rgba(255,255,255,0.06)_24%,rgba(10,10,14,0.22)_58%,rgba(10,10,14,0.48))]" />
                                    <div className="absolute inset-[1px] rounded-[inherit] border border-white/[0.08]" />
                                    <div className="absolute inset-x-[10%] top-[6%] h-[20%] rounded-full bg-white/[0.14] blur-[12px]" />
                                    <div className="absolute inset-x-[14%] bottom-[10%] h-[16%] rounded-full bg-black/28 blur-[18px]" />
                                  </div>
                                );
                              })}
                          </div>
                        ) : null}
                        <div
                          className="group/image-deck prompt-results-deck-front absolute inset-0 z-[18] overflow-hidden rounded-[11px] bg-zinc-950/10 shadow-[0_8px_22px_rgba(0,0,0,0.34)] transition-[box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:shadow-[0_10px_26px_rgba(0,0,0,0.4)]"
                          style={{ transform: "none" }}
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            requestOpen();
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            const src = resultImageUrls[pIdx];
                            if (typeof src === "string" && src.length > 0) {
                              window.dispatchEvent(new Event(JIMENG_CLOSE_MEDIA_LIGHTBOX_EVENT));
                              setExpandedResultUrl(src);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              const src = resultImageUrls[pIdx];
                              if (typeof src === "string" && src.length > 0) {
                                window.dispatchEvent(new Event(JIMENG_CLOSE_MEDIA_LIGHTBOX_EVENT));
                                setExpandedResultUrl(src);
                              }
                            }
                          }}
                        >
                          {(() => {
                            const src = resultImageUrls[pIdx];
                            const isReady = typeof src === "string" && src.length > 0;
                            if (isReady) {
                              return (
                                <PromptResultMedia
                                  src={src}
                                  cacheBustKey={ownOutputCacheBustKey}
                                  objectFit="cover"
                                  compact
                                  suspendPlayback={expandedVideoLightbox}
                                  autoPlayWhenReady={
                                    isVideoPrompt && urlLooksLikeVideoFile(src)
                                  }
                                  onVideoSurfaceClick={openPanelFromVideoPreviewClick}
                                  onVideoSurfaceDoubleClick={() => {
                                    if (typeof src === "string" && src.length > 0) {
                                      window.dispatchEvent(new Event(JIMENG_CLOSE_MEDIA_LIGHTBOX_EVENT));
                                      setExpandedResultUrl(src);
                                    }
                                  }}
                                />
                              );
                            }
                            return resultRenderError ? (
                              <JimengRenderStatusShell
                                videoEdgeFlow={isVideoPrompt}
                                backgroundSrc={trimRenderableUrl(stackPreviewUrls[pIdx])}
                                backgroundCacheBustKey={ownOutputCacheBustKey}
                                backgroundPlaybackSuspended={expandedVideoLightbox}
                                errorMessage={resultRenderError}
                              >
                                <TriangleAlert className="h-5 w-5 text-red-200/95" />
                                <div className="rounded-full border border-red-300/30 bg-red-500/12 px-2 py-0.5 text-[10px] font-semibold tracking-[0.02em] text-red-100">
                                  程序报错
                                </div>
                                <div className="max-h-[48%] w-[90%] overflow-y-auto rounded-lg border border-red-300/16 bg-black/24 px-2 py-1.5 text-left text-[10px] leading-snug text-red-50/95 whitespace-pre-wrap break-words">
                                  {resultRenderError}
                                </div>
                              </JimengRenderStatusShell>
                            ) : (
                              <JimengRenderStatusShell
                                videoEdgeFlow={isVideoPrompt}
                                backgroundSrc={trimRenderableUrl(stackPreviewUrls[pIdx])}
                                backgroundCacheBustKey={ownOutputCacheBustKey}
                                backgroundPlaybackSuspended={expandedVideoLightbox}
                              >
                                <Loader2 className="h-5 w-5 animate-spin text-zinc-200/85" />
                                {showRenderProgressBar ? (
                                  <>
                                    <div className="jimeng-render-status-shine px-1 text-center text-xs font-semibold leading-5">
                                      生成中 {progress}%
                                    </div>
                                    <div className="jimeng-render-progress-track h-1.5 w-[min(88%,160px)] overflow-hidden rounded-full">
                                      <div
                                        className="jimeng-render-progress-fill h-full transition-all duration-300"
                                         style={{ width: String(progress) + "%" }}
                                      />
                                    </div>
                                  </>
                                ) : (
                                  <div className="jimeng-render-status-shine line-clamp-3 px-2 text-center text-[11px] font-medium leading-snug">
                                    {streamStatusLine ||
                                      (!sawStreamProgressEvent ? "提交任务中..." : "排队中...")}
                                  </div>
                                )}
                                {streamStatusLine && showRenderProgressBar ? (
                                  <div className="jimeng-render-status-shine--subtle line-clamp-2 max-w-[92%] text-center text-[10px] leading-4">
                                    {streamStatusLine}
                                  </div>
                                ) : null}
                              </JimengRenderStatusShell>
                            );
                          })()}
                          {tilesCount > 1 ? (
                            <button
                              type="button"
                              title="切换到下一张"
                              className={[
                                "nodrag nopan absolute bottom-1 left-1 z-[24] rounded-md px-1.5 py-0.5 text-[8px] font-medium shadow-sm ring-1",
                                data.canvasImageSpill
                                  ? "bg-zinc-950/85 text-zinc-200 ring-zinc-600/50"
                                  : "bg-zinc-950/80 text-zinc-300 opacity-0 ring-zinc-600/50 transition-opacity group-hover/image-deck:opacity-100",
                              ].join(" ")}
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                const n = (resolvedPrimaryIdx + 1) % tilesCount;
                                setPrimaryImageResultIndex(n);
                                data.onPanelPrimaryImageIndexChange?.(n);
                              }}
                            >
                              换主图
                            </button>
                          ) : null}
                          {tilesCount > 1 && data.canvasImageSpill ? (
                            data.canvasImageSpill.collapseAnim &&
                            data.canvasImageSpill.collapseOpenReady ? (
                              <button
                                type="button"
                                title="在画布上展开为网格"
                                className="nodrag nopan absolute right-1 top-1 z-[25] inline-flex h-8 items-center justify-center gap-1 rounded-[14px] border border-white/[0.1] bg-zinc-950/50 px-2 text-[11px] font-medium text-zinc-100 shadow-[0_8px_20px_rgba(0,0,0,0.24)] backdrop-blur-md transition-all duration-200 ease-out hover:bg-zinc-900/62 hover:text-white"
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  requestOpen();
                                  data.onExpandImageResultsToCanvas?.({
                                    urls: resultImageUrls.slice(),
                                    ratio,
                                    primaryIndex: resolvedPrimaryIdx,
                                    expectedTileCount: tilesCount,
                                  });
                                }}
                              >
                                <span className="tabular-nums text-[12px] leading-none text-zinc-100/92">
                                  {tilesCount}
                                </span>
                                <ChevronRight
                                  className="h-3.5 w-3.5 text-zinc-100/82"
                                  strokeWidth={2.25}
                                  aria-hidden
                                />
                              </button>
                            ) : (
                            <button
                              type="button"
                              title="收回画布排列"
                              className="nodrag nopan absolute right-1 top-1 z-[25] inline-flex h-8 items-center justify-center gap-1 rounded-[14px] border border-white/[0.1] bg-zinc-950/48 px-2 text-[11px] font-medium text-zinc-100 shadow-[0_8px_20px_rgba(0,0,0,0.24)] backdrop-blur-md transition-all duration-200 ease-out hover:bg-zinc-900/62 hover:text-white"
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                data.onCollapseImageResultsFromCanvas?.();
                              }}
                            >
                              <span className="tabular-nums text-[12px] leading-none text-zinc-100/92">
                                {tilesCount}
                              </span>
                              <ChevronsUp className="h-3.5 w-3.5 text-zinc-100/82" strokeWidth={2.25} />
                            </button>
                            )
                          ) : tilesCount > 1 ? (
                            <button
                              type="button"
                              title={
                                loading
                                  ? "在画布上展开为网格，可查看各格进度"
                                  : "在画布上展开为网格"
                              }
                              className={[
                                "nodrag nopan absolute right-1 top-1 z-[25] inline-flex h-8 items-center justify-center gap-1 rounded-[14px] border px-2 text-[11px] font-medium shadow-[0_8px_20px_rgba(0,0,0,0.22)] backdrop-blur-md transition-all duration-200 ease-out",
                                loading
                                  ? "translate-y-0 border-zinc-400/24 bg-zinc-950/54 text-zinc-100 opacity-100"
                                  : "translate-y-0 border-white/[0.08] bg-zinc-950/40 text-zinc-100/90 opacity-100 hover:border-zinc-400/28 hover:bg-zinc-900/56 hover:text-white focus-visible:border-zinc-400/28 focus-visible:bg-zinc-900/56 group-hover/image-deck:bg-zinc-900/52 group-focus-within/image-deck:bg-zinc-900/52",
                              ].join(" ")}
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                requestOpen();
                                data.onExpandImageResultsToCanvas?.({
                                  urls: resultImageUrls.slice(),
                                  ratio,
                                  primaryIndex: resolvedPrimaryIdx,
                                  expectedTileCount: tilesCount,
                                });
                              }}
                            >
                              <span className="tabular-nums text-[12px] leading-none text-current/95">
                                {tilesCount}
                              </span>
                              <ChevronRight className="h-3.5 w-3.5 text-current/80" strokeWidth={2.25} aria-hidden />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="relative h-full w-full">
                  <div className="grid h-full w-full grid-cols-1 gap-px p-px">
                    {Array.from({ length: tilesCount }, (_, i) => i).map((idx) => {
                      const src = resultImageUrls[idx];
                      const isReady = typeof src === "string" && src.length > 0;
                      if (isReady) {
                        return (
                          <div
                            key={"grid-cell-" + idx}
                            className="nopan overflow-hidden rounded-[11px] bg-transparent"
                            style={{ aspectRatio: String(ratioAspect) }}
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              requestOpen();
                            }}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              setExpandedResultUrl(src);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                e.stopPropagation();
                                setExpandedResultUrl(src);
                              }
                            }}
                          >
                            <div className="h-full w-full min-h-[48px] bg-transparent">
                              <PromptResultMedia
                                src={src}
                                cacheBustKey={ownOutputCacheBustKey}
                                objectFit="cover"
                                compact
                                suspendPlayback={expandedVideoLightbox}
                                autoPlayWhenReady={
                                  isVideoPrompt && urlLooksLikeVideoFile(src)
                                }
                                onVideoSurfaceClick={openPanelFromVideoPreviewClick}
                                onVideoSurfaceDoubleClick={() => setExpandedResultUrl(src)}
                              />
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div
                            key={"grid-pending-" + idx}
                          className="relative cursor-pointer overflow-hidden rounded-[11px] bg-zinc-800"
                            style={{ aspectRatio: String(ratioAspect) }}
                          onClick={(e) => {
                            e.stopPropagation();
                            requestOpen();
                          }}
                        >
                          {resultRenderError ? (
                            <JimengRenderStatusShell
                              compact
                              videoEdgeFlow={isVideoPrompt}
                              backgroundSrc={trimRenderableUrl(stackPreviewUrls[idx])}
                              backgroundCacheBustKey={ownOutputCacheBustKey}
                              backgroundPlaybackSuspended={expandedVideoLightbox}
                              errorMessage={resultRenderError}
                            >
                              <TriangleAlert className="h-4 w-4 text-red-200/95" />
                              <div className="rounded-full border border-red-300/30 bg-red-500/12 px-1.5 py-0.5 text-[9px] font-semibold text-red-100">
                                程序报错
                              </div>
                              <div className="max-h-[48%] w-[92%] overflow-y-auto rounded-md border border-red-300/14 bg-black/24 px-1.5 py-1 text-left text-[9px] leading-snug text-red-50/95 whitespace-pre-wrap break-words">
                                {resultRenderError}
                              </div>
                            </JimengRenderStatusShell>
                          ) : (
                            <JimengRenderStatusShell
                              compact
                              videoEdgeFlow={isVideoPrompt}
                              backgroundSrc={trimRenderableUrl(stackPreviewUrls[idx])}
                              backgroundCacheBustKey={ownOutputCacheBustKey}
                              backgroundPlaybackSuspended={expandedVideoLightbox}
                            >
                              <Loader2 className="h-4 w-4 animate-spin text-zinc-200/80" />
                              {showRenderProgressBar ? (
                                <>
                                  <div className="jimeng-render-status-shine px-1 text-center text-[11px] font-medium leading-4">
                                    生成中 {progress}%
                                  </div>
                                  <div className="jimeng-render-progress-track h-1 w-[min(88%,140px)] overflow-hidden rounded-full">
                                    <div
                                      className="jimeng-render-progress-fill h-full transition-all duration-300"
                                  style={{ width: String(progress) + "%" }}
                                    />
                                  </div>
                                </>
                              ) : (
                                <div className="jimeng-render-status-shine line-clamp-3 px-1 text-center text-[10px] font-medium leading-snug">
                                  {streamStatusLine ||
                                    (!sawStreamProgressEvent ? "提交任务中..." : "排队中...")}
                                </div>
                              )}
                              {streamStatusLine && showRenderProgressBar ? (
                                <div className="jimeng-render-status-shine--subtle line-clamp-2 px-1 text-center text-[9px] leading-3">
                                  {streamStatusLine}
                                </div>
                              ) : null}
                            </JimengRenderStatusShell>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )
            ) : resultImageUrl ? (
              <div
                className="h-full w-full"
                onClick={(e) => {
                  e.stopPropagation();
                  requestOpen();
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  window.dispatchEvent(new Event(JIMENG_CLOSE_MEDIA_LIGHTBOX_EVENT));
                  setExpandedResultUrl(resultImageUrl);
                }}
              >
                <PromptResultMedia
                  src={resultImageUrl}
                  cacheBustKey={ownOutputCacheBustKey}
                  objectFit="contain"
                  suspendPlayback={expandedVideoLightbox}
                  autoPlayWhenReady={
                    isVideoPrompt && urlLooksLikeVideoFile(resultImageUrl)
                  }
                  onVideoSurfaceClick={openPanelFromVideoPreviewClick}
                  onVideoSurfaceDoubleClick={() => {
                    window.dispatchEvent(new Event(JIMENG_CLOSE_MEDIA_LIGHTBOX_EVENT));
                    setExpandedResultUrl(resultImageUrl);
                  }}
                />
              </div>
            ) : (
              <div
                className="relative flex h-full w-full cursor-pointer flex-col items-center justify-center overflow-hidden"
                onClick={(e) => {
                  e.stopPropagation();
                  requestOpen();
                }}
              >
                {loading ? (
                  <JimengRenderStatusShell
                    videoEdgeFlow={isVideoPrompt}
                    backgroundSrc={settledPrimaryPreviewUrl}
                    backgroundCacheBustKey={ownOutputCacheBustKey}
                    backgroundPlaybackSuspended={expandedVideoLightbox}
                  >
                    <Loader2 className="h-7 w-7 animate-spin text-zinc-200/85" />
                    {showRenderProgressBar ? (
                      <>
                        <div className="jimeng-render-status-shine text-sm font-semibold">
                          生成中 {progress}%
                        </div>
                        {streamStatusLine ? (
                          <div className="jimeng-render-status-shine--subtle line-clamp-2 max-w-[90%] text-center text-[10px] leading-4">
                            {streamStatusLine}
                          </div>
                        ) : null}
                        <div className="jimeng-render-progress-track h-1.5 w-2/3 overflow-hidden rounded-full">
                          <div
                            className="jimeng-render-progress-fill h-full transition-all duration-300"
                                  style={{ width: String(progress) + "%" }}
                          />
                        </div>
                      </>
                    ) : (
                      <div className="jimeng-render-status-shine line-clamp-3 max-w-[90%] px-2 text-center text-[11px] font-medium leading-5">
                        {streamStatusLine ||
                          (!sawStreamProgressEvent ? "提交任务中..." : "排队中...")}
                      </div>
                    )}
                  </JimengRenderStatusShell>
                ) : (
                  <div className="relative flex h-full min-h-0 w-full flex-col items-center justify-center gap-2 text-zinc-500">
                    {isVideoPrompt ? (
                      <>
                        <Film className="h-12 w-12 text-zinc-500" strokeWidth={1.15} aria-hidden />
                        {showRecoveryFallbackHint ? (
                          <span className="max-w-[88%] text-center text-[10px] leading-4 text-amber-200/90">
                            任务已恢复，正在等待后台继续回传结果。
                          </span>
                        ) : null}
                        <span className="text-[11px] text-zinc-500">视频预览</span>
                      </>
                    ) : (
                      <>
                        <svg
                          width="48"
                          height="48"
                          viewBox="0 0 48 48"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          className="text-zinc-500"
                          aria-hidden
                        >
                          <rect
                            x="9"
                            y="13"
                            width="30"
                            height="24"
                            rx="4"
                            stroke="currentColor"
                            strokeWidth="1.5"
                          />
                          <circle cx="18" cy="22" r="2.5" fill="currentColor" />
                          <path
                            d="M9 33 L19 24 L27 29 L39 19"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                          />
                        </svg>
                        <span className="text-[11px] text-zinc-500">画布预览</span>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <MagneticHandleSource
          id="output"
          pinX={handleRightX}
          pinY={handleCenterY}
          magneticVisible={magneticHandlesVisible}
        />
      </div>

{panelOpen ? (
        (() => {
          const panelContent = (
            <>
              {isDockedPanel ? (
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="truncate text-[18px] font-semibold text-white">
                        {dockPanelTitle}
                      </div>
                      <span className="inline-flex shrink-0 items-center rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-zinc-300">
                        #{data.promptIndex ?? 1}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-500">
                      右侧停靠面板
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white"
                      onClick={() => data.onDockPanelModeChange?.("compact")}
                      title="收起右侧停靠"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="flex h-8 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-2.5 text-[11px] text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white"
                      onClick={() => data.onPanelDisplayModeChange?.("floating")}
                      title="切换为浮动面板"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      <span>浮动</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="absolute right-2 top-2 z-[30] flex items-center gap-2">
                  {isBanana2ImagePrompt ? (
                    <span className="inline-flex h-7 items-center justify-center rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-2 text-[10px] font-medium text-emerald-100 shadow-[0_8px_20px_rgba(0,0,0,0.16)] backdrop-blur-sm">
                      {banana2PriceLabel}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-transparent px-2 text-[10px] font-medium text-zinc-200 shadow-[0_8px_20px_rgba(0,0,0,0.16)] backdrop-blur-sm transition-colors hover:bg-white/[0.06] hover:text-white"
                    onClick={() => {
                      data.onDockPanelModeChange?.("expanded");
                      data.onPanelDisplayModeChange?.("dock-right");
                    }}
                    aria-label="打开智能停靠面板"
                    title="打开智能停靠面板"
                  >
                    <BrainCircuit className="h-3.5 w-3.5" />
                    <span>多模态</span>
                  </button>
                </div>
              )}
              <div
                className={
                  isDockedPanel
                    ? "overflow-visible bg-zinc-900"
                    : "overflow-visible rounded-t-[14px] bg-zinc-900"
                }
              >
                <div className="flex items-center gap-1 overflow-x-auto bg-zinc-900 px-2 py-2">
                {isVideoPrompt ? (
                  <div className="mr-2 flex items-center gap-1">
                    {videoSupportsAnyReference ? (
                      <button
                        type="button"
                        className={[
                          "h-7 shrink-0 rounded-lg px-2 text-[11px] font-medium transition-[color,background-color,border-color,box-shadow]",
                          referenceMode === "headtail"
                            ? "border-2 border-zinc-300 bg-zinc-600 text-white shadow-sm"
                            : "border border-zinc-700 bg-zinc-700 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-600 hover:text-zinc-100",
                        ].join(" ")}
                        onClick={() => data.onPromptSettingsChange?.({ referenceMode: "headtail" })}
                      >
                        首尾帧
                      </button>
                    ) : null}
                    {videoSupportsAnyReference && modelSupportsVideoMultimodal(modelVersion) ? (
                      <button
                        type="button"
                        className={[
                          "h-7 shrink-0 rounded-lg px-2 text-[11px] font-medium transition-[color,background-color,border-color,box-shadow]",
                          referenceMode === "general"
                            ? "border-2 border-zinc-300 bg-zinc-600 text-white shadow-sm"
                            : "border border-zinc-700 bg-zinc-700 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-600 hover:text-zinc-100",
                        ].join(" ")}
                        onClick={() => data.onPromptSettingsChange?.({ referenceMode: "general" })}
                      >
                        通用参考
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {displayConnectedImages.map((img, idx) => (
                  <React.Fragment key={img.id}>
                    <div
                      data-thumb-id={img.id}
                      className={[
                        "group relative h-8 w-8 shrink-0 cursor-grab overflow-hidden rounded-lg border border-zinc-700 transition-[transform,box-shadow,border-color] duration-200 ease-out active:cursor-grabbing",
                        thumbDropHoverId === img.id && draggingThumbId && draggingThumbId !== img.id
                          ? "border-zinc-400 ring-2 ring-zinc-400 ring-offset-2 ring-offset-zinc-900"
                          : "",
                        draggingThumbId === img.id ? "z-[4] shadow-xl" : "",
                      ].join(" ")}
                      style={{
                        borderColor: img.refIndex === undefined ? "rgba(255,255,255,0.1)" : undefined,
                        transform:
                          draggingThumbId === img.id
                            ? "translateX(" + String(thumbDragDeltaX) + "px) scale(1.08)"
                            : undefined,
                        transition: draggingThumbId === img.id ? "none" : undefined,
                      }}
                      title={
                        "拖动调整顺序，单击插入 @" +
                        (img.refType === "video" || img.isVideo ? "视频" : "图片") +
                        String(img.refIndex)
                      }
                      {...bindThumbHover(img.id, img.url, Boolean(img.isVideo), draggingThumbId !== null)}
                      onPointerDown={(e) => {
                        if ((e.target as HTMLElement).closest("button")) return;
                        e.preventDefault();
                        e.stopPropagation();
                        try {
                          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                        } catch {
                          /* ignore */
                        }
                        thumbDragRef.current = { id: img.id, startX: e.clientX, dragged: false };
                        suppressThumbClickRef.current = false;
                        setThumbDragDeltaX(0);
                        setDraggingThumbId(img.id);
                      }}
                      onPointerMove={(e) => {
                        const p = thumbDragRef.current;
                        if (!p || p.id !== img.id) return;
                        const dx = e.clientX - p.startX;
                        setThumbDragDeltaX(dx);
                        if (Math.abs(dx) > 3) p.dragged = true;
                        const under = document.elementFromPoint(e.clientX, e.clientY);
                        const hit = under?.closest("[data-thumb-id]") as HTMLElement | null;
                        const hid = hit?.getAttribute("data-thumb-id") ?? null;
                        const prevHover = thumbHoverRef.current;
                        thumbHoverRef.current = hid;
                        setThumbDropHoverId(hid);
                        if (p.dragged && hid && hid !== p.id && hid !== prevHover) {
                          applyThumbReorder(p.id, hid);
                          thumbDragRef.current = { id: hid, startX: e.clientX, dragged: true };
                        }
                      }}
                      onPointerUp={(e) => {
                        const p = thumbDragRef.current;
                        if (!p || p.id !== img.id) return;
                        try {
                          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
                        } catch {
                          /* ignore */
                        }
                        const hover = thumbHoverRef.current;
                        thumbDragRef.current = null;
                        thumbHoverRef.current = null;
                        setThumbDropHoverId(null);
                        setThumbDragDeltaX(0);
                        setDraggingThumbId(null);
                        if (p.dragged) {
                          suppressThumbClickRef.current = true;
                          if (hover && hover !== p.id) applyThumbReorder(p.id, hover);
                        }
                      }}
                      onPointerCancel={(e) => {
                        const p = thumbDragRef.current;
                        if (!p || p.id !== img.id) return;
                        try {
                          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
                        } catch {
                          /* ignore */
                        }
                        thumbDragRef.current = null;
                        thumbHoverRef.current = null;
                        setThumbDropHoverId(null);
                        setThumbDragDeltaX(0);
                        setDraggingThumbId(null);
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (suppressThumbClickRef.current) {
                          suppressThumbClickRef.current = false;
                          return;
                        }
                        handleInsertRefFromThumbnail(
                          img.refType === "video" ? "video" : "image",
                          img.refIndex
                        );
                      }}
                    >
                      <ConnectedImageThumb url={img.url} isVideo={img.isVideo} cacheBustKey={img.cacheBustKey} />
                      <div
                        className={[
                          "pointer-events-none absolute left-0.5 top-0.5 rounded bg-zinc-900/58 py-[1px] font-semibold leading-none tracking-tight text-zinc-100/72 ring-1 ring-zinc-700/50",
                          "px-1.5 text-[10px]",
                        ].join(" ")}
                      >
                        {isVideoPrompt && referenceMode === "headtail"
                          ? ((img as any).frameLabel ?? ((img.refType === "video" || img.isVideo ? "V" : "I") + img.refIndex))
                          : (img.refType === "video" || img.isVideo ? "V" : "I") + img.refIndex}
                      </div>
                      <button
                        type="button"
                        className="absolute right-0 top-0 z-[2] flex h-3.5 w-3.5 items-center justify-center rounded bg-zinc-900 text-[9px] text-zinc-100 opacity-0 transition-opacity hover:bg-red-900 group-hover:opacity-100"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          setThumbHoverPreview(null);
                          thumbHoverRef.current = null;
                          setThumbDropHoverId(null);
                          setDraggingThumbId(null);
                          setThumbDragDeltaX(0);
                          data.onDisconnectImage?.(img.id);
                        }}
                        title="移除引用并断开连接"
                      >
                        ×
                      </button>
                    </div>
                    {referenceMode !== "headtail" && idx < (displayConnectedImages.length ?? 0) - 1 ? (
                      <button
                        type="button"
                        title="与右侧素材交换位置"
                        className="group flex h-8 w-2 shrink-0 items-center justify-center rounded-sm bg-transparent"
                        onClick={(e) => {
                          e.stopPropagation();
                          const ids = (displayConnectedImages ?? []).map((c) => c.id);
                          const i = ids.indexOf(img.id);
                          if (i < 0 || i >= ids.length - 1) return;
                          const next = [...ids];
                          const tmp = next[i];
                          next[i] = next[i + 1];
                          next[i + 1] = tmp;
                          data.onReorderConnectedImages?.(next);
                        }}
                      >
                        <span className="h-4 w-px bg-zinc-600 transition-colors group-hover:bg-zinc-400" />
                      </button>
                    ) : null}
                  </React.Fragment>
                ))}
                <button
                  type="button"
                  title="从画布选择素材节点（仅图片可连接）"
                  disabled={data.canPickCanvasImage === false}
                  className={[
                    "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed transition-colors",
                    data.canPickCanvasImage === false
                      ? "cursor-not-allowed border-zinc-700 bg-zinc-900 text-zinc-500"
                      : "",
                    data.isPickingCanvasImage
                      ? "border-zinc-500 bg-zinc-600 text-zinc-100 ring-2 ring-zinc-500"
                      : "border-zinc-700 bg-zinc-700 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-600 hover:text-zinc-100",
                  ].join(" ")}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (data.canPickCanvasImage === false) {
                      setLocalError("没有可用的素材节点。");
                      return;
                    }
                    setLocalError(null);
                    data.onRequestPickCanvasImage?.();
                  }}
                >
                  <ImagePlus className="h-4 w-4" strokeWidth={2} />
                </button>
              </div>
              </div>

              <div className="bg-zinc-900 px-2 pt-1">
                <div
                  ref={mentionHostRef}
                  className="prompt-node-rich-text relative w-full rounded-xl bg-zinc-900 px-2 py-2 pb-9 nodrag nopan"
                  style={{ minHeight: 92 }}
                  onMouseDown={(e) => {
                    if (e.target === e.currentTarget) {
                      e.preventDefault();
                      editorRef.current?.focus();
                    }
                  }}
                >
                  <div
                    className="pointer-events-none absolute inset-x-2.5 top-2 text-[12px] font-medium text-zinc-400"
                    style={{ fontSize: 12, opacity: editorText.trim().length === 0 ? 1 : 0 }}
                  >
                    <div>{promptModelHelpTextDisplay.title}</div>
                    <div className="mt-0.5 text-[10px] font-medium text-zinc-500">
                      {promptModelHelpTextDisplay.hint}
                    </div>
                  </div>

                  <div
                    ref={editorRef}
                    className="cursor-text whitespace-pre-wrap text-[13px] font-medium leading-6 tracking-tight text-zinc-50 antialiased outline-none nodrag nopan [text-rendering:optimizeLegibility]"
                    style={{
                      minHeight: 62,
                      fontSize: 13,
                      lineHeight: "1.5rem",
                    }}
                    contentEditable
                    suppressContentEditableWarning
                    spellCheck={false}
                    onFocus={() => {
                      if (!editorRef.current) return;
                      setMentionOpen(false);
                      setDirectiveMenuOpen(false);
                      onEditorMouseUpOrKeyUp();
                      requestOpen();
                    }}
                    onMouseUp={() => onEditorMouseUpOrKeyUp()}
                    onKeyUp={(e) => {
                      onEditorMouseUpOrKeyUp();
                      updateEditorTextFromDom();
                      tryOpenMentionOnKeyUp(e);
                    }}
                    onInput={() => {
                      setDirectiveMenuOpen(false);
                      updateEditorTextFromDom();
                      const sel = window.getSelection();
                      if (sel && sel.rangeCount > 0) {
                        const anchor = sel.anchorNode;
                        const offset = sel.anchorOffset;
                        if (anchor && anchor.nodeType === Node.TEXT_NODE && offset > 0) {
                          const txt = anchor as Text;
                          if (txt.data[offset - 1] === "@") {
                            openMentionFromSelection();
                          }
                        }
                      }
                    }}
                    onKeyDown={(e) => {
                      if (
                        isGptImagePromptModel &&
                        !e.nativeEvent.isComposing &&
                        e.key === "/" &&
                        !e.ctrlKey &&
                        !e.metaKey &&
                        !e.altKey
                      ) {
                        e.preventDefault();
                        setMentionOpen(false);
                        setDirectiveMenuOpen(false);
                        onEditorMouseUpOrKeyUp();
                        openDirectiveMenuFromSelection();
                        return;
                      }
                      if (e.key === "Escape" && directiveMenuOpen) {
                        setDirectiveMenuOpen(false);
                        return;
                      }
                      if (e.key === "Escape" && mentionOpen) {
                        setMentionOpen(false);
                        return;
                      }
                    }}
                    onClick={() => {
                      setMentionOpen(false);
                      setDirectiveMenuOpen(false);
                      onEditorMouseUpOrKeyUp();
                    }}
                  />

                  {mentionOpen && (displayConnectedImages?.length ?? 0) > 0 ? (
                    <div
                      ref={mentionPanelRef}
                      className="absolute z-50 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 shadow-lg"
                      style={{ left: mentionPos.left, top: mentionPos.top }}
                    >
                      <div className="px-1 pb-1 text-[10px] text-zinc-500">插入已连接素材</div>
                      <div className="flex max-h-[200px] w-[92px] flex-col items-stretch gap-1 overflow-auto">
                        {displayConnectedImages.map((img) => (
                          <div
                            key={"mention-" + img.id}
                            className="flex w-full items-center gap-1"
                          >
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-center gap-1 rounded border border-zinc-700 bg-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:border-zinc-500 hover:bg-zinc-600"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                const sel = window.getSelection();
                                const liveRange =
                                  sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
                                insertRefAtRange(
                                  img.refType === "video" ? "video" : "image",
                                  img.refIndex,
                                  liveRange ?? mentionRangeRef.current ?? lastRangeRef.current
                                );
                                setMentionOpen(false);
                              }}
                            >
                              <span className="inline-flex h-4 w-4 overflow-hidden rounded border border-zinc-700">
                                <ConnectedImageThumb url={img.url} isVideo={img.isVideo} cacheBustKey={img.cacheBustKey} />
                              </span>
                              <span className="inline-flex min-w-0 items-center gap-1 truncate">
                                @{img.refType === "video" || img.isVideo ? "视频" : "图片"}
                                {img.refIndex}
                              </span>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {directiveMenuOpen ? (
                    <div
                      ref={directivePanelRef}
                      className="absolute z-50 w-[248px] rounded-xl border border-zinc-700 bg-zinc-900/98 p-2 shadow-[0_14px_36px_rgba(0,0,0,0.42)] backdrop-blur"
                      style={{ left: directiveMenuPos.left, top: directiveMenuPos.top }}
                    >
                      <div className="px-1 pb-2 text-[10px] font-medium text-zinc-500">
                        透明背景指令
                      </div>
                      <div className="space-y-1.5">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-3 rounded-lg border border-zinc-700 bg-zinc-800/90 px-2.5 py-2 text-left text-xs text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-700"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            insertPlainTextAtCaret(
                              GPT_TRANSPARENT_BG_DIRECTIVE,
                              directiveRangeRef.current ?? lastRangeRef.current
                            );
                            setDirectiveMenuOpen(false);
                          }}
                        >
                          <span className="truncate">{GPT_TRANSPARENT_BG_DIRECTIVE}</span>
                          <span className="shrink-0 text-[10px] text-zinc-400">插入</span>
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-center justify-center rounded-lg border border-zinc-800 bg-transparent px-2.5 py-1.5 text-[11px] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setDirectiveMenuOpen(false);
                            editorRef.current?.focus();
                          }}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              {localError ? (
                <div className="px-3 pb-1 text-xs whitespace-pre-wrap text-red-300">{localError}</div>
              ) : null}

              <div
                className="flex min-h-11 w-full items-center justify-between gap-1.5 rounded-b-[14px] bg-zinc-900 p-1.5 font-medium text-zinc-50 antialiased [text-rendering:optimizeLegibility]"
                data-testid="canvas-node-generation-action-bar"
              >
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      className="inline-flex h-7 max-w-[112px] items-center gap-1 overflow-hidden whitespace-nowrap rounded-lg border border-zinc-700 bg-zinc-800/80 px-1.5 text-[11px] font-medium text-zinc-100 hover:bg-zinc-700"
                      onClick={() => {
                        setProviderMenuOpen((v) => !v);
                        setModelMenuOpen(false);
                        setQualityMenuOpen(false);
                        setSizeMenuOpen(false);
                        setCountMenuOpen(false);
                        setDurationMenuOpen(false);
                      }}
                    >
                      {currentProviderMeta?.icon === "server" ? (
                        <Server className="h-3 w-3 shrink-0 text-zinc-300" />
                      ) : (
                        <Sparkles className="h-3 w-3 shrink-0 text-zinc-300" />
                      )}
                      <span className="truncate">{currentProviderMeta?.title ?? "分类"}</span>
                      <ChevronDown className="h-3 w-3 shrink-0 text-zinc-400" />
                    </button>
                    {providerMenuOpen ? (
                      <div className="jimeng-model-select-scroll jimeng-model-select-scroll--deep absolute bottom-full left-0 z-50 mb-1 max-h-[min(260px,42vh)] w-[min(280px,72vw)] overflow-y-auto overscroll-contain rounded-xl border border-zinc-800 bg-zinc-950 p-1 pr-0.5 shadow-2xl ring-1 ring-zinc-800">
                        {providerCatalog.map((item) => (
                          <button
                            key={item.value}
                            type="button"
                            className="w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-zinc-800"
                            onClick={() => {
                              setProviderMenuOpen(false);
                              setQualityMenuOpen(false);
                              if (isVideoPrompt) {
                                const nextVideoProvider =
                                  item.value === "external_api" ? "external_api" : "dreamina";
                                const nextModel =
                                  nextVideoProvider === "external_api"
                                    ? externalConfiguredVideoModel ||
                                      externalVideoModels[0] ||
                                      CLI_VIDEO_MODEL_CATALOG.find((row) => row.provider === "foropencode")?.value ||
                                      "grok-imagine-video"
                                    : CLI_VIDEO_MODEL_CATALOG.find((row) => row.provider === "dreamina")?.value ||
                                      "seedance2.0fast";
                                setVideoProvider(nextVideoProvider);
                                setModelVersion(nextModel);
                                data.onPromptSettingsChange?.({
                                  videoProvider: nextVideoProvider,
                                  modelVersion: nextModel,
                                });
                                return;
                              }

                              if (item.value === "dreamina") {
                                setImageProvider("dreamina");
                                setModelVersion("5.0");
                                data.onPromptSettingsChange?.({
                                  imageProvider: "dreamina",
                                  modelVersion: "5.0",
                                });
                                return;
                              }

                              const nextProviderId =
                                normalizeExternalImageApiProviderId(item.value);
                              const nextModel =
                                nextProviderId === currentExternalApiProviderId
                                  ? externalConfiguredImageModel ||
                                    externalImageModels[0] ||
                                    defaultExternalImageModelForProvider(nextProviderId)
                                  : defaultExternalImageModelForProvider(nextProviderId);
                              const nextResolutionType = normalizeImageResolutionSelection(
                                nextModel,
                                resolutionType
                              );
                              setImageProvider("aiwanwu");
                              setModelVersion(nextModel);
                              setResolutionType(nextResolutionType);
                              data.onPromptSettingsChange?.({
                                imageProvider: "aiwanwu",
                                externalApiProviderId: nextProviderId,
                                modelVersion: nextModel,
                                resolutionType: nextResolutionType,
                              });
                            }}
                          >
                            <div className="flex items-start gap-2">
                              <span className="mt-0.5 text-zinc-300">
                                {item.icon === "server" ? (
                                  <Server className="h-3.5 w-3.5" />
                                ) : (
                                  <Sparkles className="h-3.5 w-3.5" />
                                )}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="text-[12px] font-medium text-zinc-100">
                                  {item.title}
                                </div>
                                <div className="mt-0.5 text-[10px] leading-4 text-zinc-500">
                                  {item.desc}
                                </div>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      data-testid={
                        isVideoPrompt
                          ? "canvas-node-video-model-select"
                          : "canvas-node-image-model-select"
                      }
                      className="inline-flex h-7 max-w-[96px] items-center gap-1 overflow-hidden whitespace-nowrap rounded-lg border border-zinc-700 bg-zinc-800/80 px-1.5 text-[11px] font-medium text-zinc-100 hover:bg-zinc-700"
                      onClick={() => {
                        setProviderMenuOpen(false);
                        setModelMenuOpen((v) => !v);
                        setQualityMenuOpen(false);
                        setSizeMenuOpen(false);
                        setCountMenuOpen(false);
                        setDurationMenuOpen(false);
                      }}
                    >
                      <span className="truncate">{currentModelMeta?.title ?? "模型"}</span>
                      <ChevronDown className="h-3 w-3 shrink-0 text-zinc-400" />
                    </button>
                    {modelMenuOpen ? (
                      <div
                        data-testid={
                          isVideoPrompt
                            ? "canvas-node-video-model-select-dropdown"
                            : "canvas-node-image-model-select-dropdown"
                        }
                        className="jimeng-model-select-scroll jimeng-model-select-scroll--deep absolute bottom-full left-0 z-50 mb-1 max-h-[min(280px,46vh)] w-[min(300px,78vw)] overflow-y-auto overscroll-contain rounded-xl border border-zinc-800 bg-zinc-950 p-1 pr-0.5 shadow-2xl ring-1 ring-zinc-800"
                        tabIndex={-1}
                        onWheel={(e) => e.stopPropagation()}
                        onWheelCapture={(e) => e.stopPropagation()}
                      >
                        {modelCatalog.map((m) => (
                          <button
                            key={m.value}
                            type="button"
                            disabled={m.disabled}
                            className={[
                              "w-full rounded-lg px-2 py-2 text-left transition-colors",
                              m.disabled
                                ? "cursor-not-allowed text-zinc-500"
                                : "hover:bg-zinc-800",
                            ].join(" ")}
                            onClick={() => {
                              if (m.disabled) return;
                              setModelVersion(m.value);
                              if (isVideoPrompt) {
                                const defaults = getVideoModelDefaultSelection(m.value);
                                const nextRatio = normalizeVideoRatioForModel(m.value, ratio);
                                const nextRes = normalizeVideoResolutionForModel(m.value, resolutionType);
                                const nextDuration = clampVideoDurationForModel(
                                  m.value,
                                  durationSeconds
                                );
                                const nextCount = Math.min(
                                  getVideoModelMaxCount(m.value),
                                  Math.max(1, count)
                                );
                                const nextWithAudio = videoModelSupportsAudioToggle(m.value)
                                  ? withAudio
                                  : false;
                                const nextReferenceMode = videoModelSupportsAnyReference(m.value)
                                  ? videoModelSupportsGeneralReference(m.value)
                                    ? referenceMode
                                    : "headtail"
                                  : defaultReferenceModeForVideoModel(m.value);
                                setRatio(nextRatio || defaults.ratio);
                                setResolutionType(nextRes || defaults.resolutionType);
                                setDurationSeconds(nextDuration || defaults.durationSeconds);
                                setCount(nextCount);
                                setWithAudio(nextWithAudio);
                                data.onPromptSettingsChange?.({
                                  modelVersion: m.value,
                                  ratio: nextRatio || defaults.ratio,
                                  resolutionType: nextRes,
                                  durationSeconds: nextDuration || defaults.durationSeconds,
                                  count: nextCount,
                                  withAudio: nextWithAudio,
                                  referenceMode: nextReferenceMode,
                                });
                              } else {
                                const nextRes = m.value.trim().toLowerCase() === GPT_DRAW_3840_MODEL
                                  ? GPT_DRAW_3840_RESOLUTION_TYPE
                                  : normalizeImageResolutionSelection(m.value, resolutionType);
                                setResolutionType(nextRes);
                                data.onPromptSettingsChange?.({ modelVersion: m.value, resolutionType: nextRes });
                              }
                              setModelMenuOpen(false);
                            }}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-[12px] font-medium text-zinc-100">{m.title}</span>
                                  {m.badge ? (
                                    <span className="rounded bg-zinc-700 px-1 py-px text-[10px] text-zinc-300">
                                      {m.badge}
                                    </span>
                                  ) : null}
                                </div>
                                <p className="mt-0.5 text-[11px] leading-snug text-zinc-400">{m.desc}</p>
                              </div>
                              <span className="shrink-0 text-[10px] text-zinc-500">{m.time}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {supportsExternalQuality ? (
                    <div className="relative shrink-0">
                      <button
                        type="button"
                        className="inline-flex h-7 min-w-[56px] items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-zinc-700 bg-zinc-800/80 px-1.5 text-[11px] font-medium text-zinc-100 hover:bg-zinc-700"
                        onClick={() => {
                          setQualityMenuOpen((v) => !v);
                          setModelMenuOpen(false);
                          setSizeMenuOpen(false);
                          setCountMenuOpen(false);
                          setDurationMenuOpen(false);
                        }}
                      >
                        {currentExternalQualityLabel}
                        <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
                      </button>
                      {qualityMenuOpen ? (
                        <div className="absolute bottom-full left-0 z-50 mb-1 w-20 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 p-1 shadow-2xl ring-1 ring-zinc-800">
                          {externalQualityOptions.map((item) => (
                            <button
                              key={item.value}
                              type="button"
                              className={[
                                "w-full rounded-md px-2 py-1.5 text-left text-[11px] font-medium transition-colors",
                                imageQuality === item.value
                                  ? "bg-zinc-700 text-white"
                                  : "text-zinc-100 hover:bg-zinc-800",
                              ].join(" ")}
                              onClick={() => {
                                setImageQuality(item.value);
                                data.onPromptSettingsChange?.({ imageQuality: item.value });
                                setQualityMenuOpen(false);
                              }}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      className="inline-flex h-7 items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-zinc-700 bg-zinc-800/80 px-1.5 text-[11px] font-medium text-zinc-100 hover:bg-zinc-700"
                      onClick={() => {
                        setSizeMenuOpen((v) => !v);
                        setModelMenuOpen(false);
                        setQualityMenuOpen(false);
                        setCountMenuOpen(false);
                        setDurationMenuOpen(false);
                      }}
                    >
                      {formatSizeLabel(ratio, resolutionType, isVideoPrompt ? "video" : "image", modelVersion)}
                      <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
                    </button>
                    {sizeMenuOpen ? (
                      <div
                        data-testid="canvas-node-size-panel"
                        className={"absolute bottom-full right-0 z-[60] mb-1 " + sizePanelShell}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex flex-col gap-1 p-1.25">
                          {isVideoPrompt ? (
                            <>
                              <div className="px-1 text-[11px] font-medium text-zinc-400">画质</div>
                              <div className="relative flex rounded-lg bg-zinc-800/80 p-0.5">
                                {videoQualityOptions.map((q) => (
                                  <button
                                    key={q}
                                    type="button"
                                    data-testid={"canvas-node-size-video-quality-" + q}
                                    disabled={loading}
                                    title={"dreamina CLI閿?-video_resolution=" + q}
                                    className={[
                                      "relative z-10 flex-1 rounded-md border px-1.5 py-1 text-[11px] transition-colors duration-200 disabled:cursor-not-allowed",
                                      resolutionType.toLowerCase() === q
                                        ? "border-zinc-400 bg-zinc-600 text-white ring-1 ring-zinc-500"
                                        : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:bg-zinc-700 hover:text-zinc-100",
                                    ].join(" ")}
                                    onClick={() => {
                                      setResolutionType(q);
                                      data.onPromptSettingsChange?.({ resolutionType: q });
                                    }}
                                  >
                                    {q}
                                  </button>
                                ))}
                              </div>
                            </>
                          ) : lockedExternalDrawRatio ? (
                            <div className="rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-[10px] text-zinc-400">
                              当前 GPT 绘图模型使用固定输出尺寸和宽高比。
                            </div>
                          ) : (
                            <>
                              <div className="px-1 text-[11px] font-medium text-zinc-400">画质</div>
                              <div className="relative flex rounded-lg bg-zinc-800/80 p-0.5">
                                {imageResolutionOptions.map((option) => (
                                  <button
                                    key={option.value}
                                    type="button"
                                    data-testid={"canvas-node-size-quality-" + option.value.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}
                                    disabled={loading || option.disabled}
                                    title={option.title}
                                    className={[
                                      "relative z-10 flex-1 rounded-md border px-1.5 py-1 text-[11px] transition-colors duration-200 disabled:cursor-not-allowed",
                                      resolutionType === option.value
                                        ? "border-zinc-400 bg-zinc-600 text-white ring-1 ring-zinc-500"
                                        : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:bg-zinc-700 hover:text-zinc-100",
                                      option.disabled ? "opacity-45" : "",
                                    ].join(" ")}
                                    onClick={() => {
                                      if (option.disabled) return;
                                      setResolutionType(option.value);
                                      data.onPromptSettingsChange?.({ resolutionType: option.value });
                                    }}
                                  >
                                    {option.label}
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                          <p className="px-1 text-[9px] leading-tight text-zinc-500">
                            {isVideoPrompt
                              ? "视频画质会跟随当前视频模型。"
                              : lockedExternalDrawRatio
                                ? "当前 GPT 绘图模型使用固定比例和输出尺寸。"
                                : supportsCustomImageRatio
                                  ? isGoogleImagePrompt
                                    ? `Google 生图支持手动输入自定义比例或分辨率，例如 5:7、2.35:1、3840x2160。当前档位 ${formatGoogleResolutionLabel(resolutionType)}。`
                                    : `香蕉生图支持手动输入自定义比例，例如 5:7、2.35:1。当前档位 ${formatBanana2ResolutionLabel(resolutionType)}，约 ${banana2PriceLabel}/张。`
                                  : usesMappedExternalDrawSize
                                    ? supportsExternalDrawTrue4k
                                      ? "当前 GPT 绘图模型会按所选比例自动匹配安全分辨率，4K 页签含专属尺寸。"
                                    : "当前 GPT 绘图模型会按所选比例自动匹配安全分辨率。"
                                : "图片比例会跟随当前输出模式。"}
                          </p>
                        </div>

                        <div className="flex flex-col gap-1 p-1.5 pt-0">
                          <div className="flex items-center gap-1 px-1 text-[11px] font-medium text-zinc-400">
                            比例
                          </div>
                          <div className="relative flex gap-1.5 rounded-lg bg-zinc-800/80 p-0.5">
                            <button
                              type="button"
                              data-ratio="1:1"
                              data-testid="canvas-node-size-ratio-1-1"
                              disabled={
                                loading ||
                                (isVideoPrompt && !videoRatioOptions.includes("1:1")) ||
                                isImageRatioUnavailable("1:1")
                              }
                              title={
                                isVideoPrompt && !videoRatioOptions.includes("1:1")
                                  ? "当前视频模式不支持这个比例。"
                                  : imageRatioDisabledTitle("1:1")
                              }
                              className={[
                                "relative z-10 flex w-12 shrink-0 flex-col items-center justify-center gap-1 rounded-md border py-4 text-[11px] transition-colors duration-200 disabled:cursor-not-allowed",
                                ratio === "1:1"
                                  ? "border-zinc-400 bg-zinc-600 text-white ring-1 ring-zinc-500"
                                  : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:bg-zinc-700 hover:text-zinc-100",
                              ].join(" ")}
                              onClick={() => {
                                setRatio("1:1");
                                data.onPromptSettingsChange?.({ ratio: "1:1" });
                              }}
                            >
                              1:1
                            </button>
                            <div className="grid flex-1 grid-cols-4 gap-0.5">
                              {SIZE_PANEL_RATIOS_ROW1.map((r) => (
                                <button
                                  key={r}
                                  type="button"
                                  data-ratio={r}
                                  data-testid={"canvas-node-size-ratio-" + r.replace(":", "-")}
                                  disabled={
                                    loading ||
                                    (isVideoPrompt && !videoRatioOptions.includes(r)) ||
                                    isImageRatioUnavailable(r)
                                  }
                                  title={
                                    isVideoPrompt && !videoRatioOptions.includes(r)
                                      ? "当前视频模式不支持这个比例。"
                                      : imageRatioDisabledTitle(r)
                                  }
                                  className={[
                                    "relative z-10 flex flex-col items-center justify-center gap-0.5 rounded-md border py-1.5 text-[10px] transition-colors duration-200 disabled:cursor-not-allowed",
                                    ratio === r
                                      ? "border-zinc-400 bg-zinc-600 text-white ring-1 ring-zinc-500"
                                      : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:bg-zinc-700 hover:text-zinc-100",
                                  ].join(" ")}
                                  onClick={() => {
                                    setRatio(r);
                                    data.onPromptSettingsChange?.({ ratio: r });
                                  }}
                                >
                                  {r}
                                </button>
                              ))}
                              {SIZE_PANEL_RATIOS_ROW2.map((r) => (
                                <button
                                  key={r}
                                  type="button"
                                  data-ratio={r}
                                  data-testid={"canvas-node-size-ratio-" + r.replace(":", "-")}
                                  disabled={
                                    loading ||
                                    (isVideoPrompt && !videoRatioOptions.includes(r)) ||
                                    isImageRatioUnavailable(r)
                                  }
                                  title={
                                    isVideoPrompt && !videoRatioOptions.includes(r)
                                      ? "当前视频模式不支持这个比例。"
                                      : imageRatioDisabledTitle(r)
                                  }
                                  className={[
                                    "relative z-10 flex flex-col items-center justify-center gap-0.5 rounded-md border py-1.5 text-[10px] transition-colors duration-200 disabled:cursor-not-allowed",
                                    ratio === r
                                      ? "border-zinc-400 bg-zinc-600 text-white ring-1 ring-zinc-500"
                                      : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:bg-zinc-700 hover:text-zinc-100",
                                  ].join(" ")}
                                  onClick={() => {
                                    setRatio(r);
                                    data.onPromptSettingsChange?.({ ratio: r });
                                  }}
                                >
                                  {r}
                                </button>
                              ))}
                            </div>
                          </div>
                          {!isVideoPrompt && supportsExternalDrawTrue4k && isExternalDrawTrue4kActive ? (
                            <div className="flex flex-col gap-1 px-1.5 pb-1.5">
                              <div className="flex items-center gap-1 px-1 text-[11px] font-medium text-zinc-400">
                                舞美环屏专用
                              </div>
                              <div className="grid grid-cols-1 gap-0.5">
                                {SIZE_PANEL_RATIOS_ROW3.map((r) => (
                                  <button
                                    key={r}
                                    type="button"
                                    data-ratio={r}
                                    data-testid={"canvas-node-size-ratio-" + r.replace(":", "-")}
                                    disabled={loading}
                                    className={[
                                      "relative z-10 flex flex-col items-center justify-center gap-0.5 rounded-md border py-1.5 text-[10px] transition-colors duration-200 disabled:cursor-not-allowed",
                                      ratio === r
                                        ? "border-zinc-400 bg-zinc-600 text-white ring-1 ring-zinc-500"
                                        : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:bg-zinc-700 hover:text-zinc-100",
                                    ].join(" ")}
                                    onClick={() => {
                                      setRatio(r);
                                      data.onPromptSettingsChange?.({ ratio: r });
                                    }}
                                  >
                                    {r}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {supportsCustomImageRatio ? (
                            <div className="flex flex-col gap-1 px-1.5 pb-1.5">
                              <div className="px-1 text-[11px] font-medium text-zinc-400">
                                {isGoogleImagePrompt ? "自定义比例/分辨率" : "自定义比例"}
                              </div>
                              <div className="flex items-center gap-1">
                                <input
                                  value={customRatioInput}
                                  onChange={(e) => setCustomRatioInput(e.target.value)}
                                  placeholder={isGoogleImagePrompt ? "例如 5:7 或 3840x2160" : "例如 5:7"}
                                  className="h-8 min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-[11px] text-zinc-100 outline-none ring-zinc-500/30 focus:border-zinc-500 focus:ring-1"
                                />
                                <button
                                  type="button"
                                  className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-700 bg-zinc-800 px-2 text-[11px] font-medium text-zinc-100 transition-colors hover:bg-zinc-700"
                                  onClick={() => {
                                    const next = customRatioInput.trim();
                                    if (!isCustomAspectRatio(next)) return;
                                    setRatio(next);
                                    data.onPromptSettingsChange?.({ ratio: next });
                                  }}
                                >
                                  应用
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {isVideoPrompt ? (
                    <>
                      <>
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          title={`每次最多生成 ${videoCountOptions[videoCountOptions.length - 1] ?? 1} 条视频`}
                          className="inline-flex h-7 min-w-[44px] items-center justify-center gap-0.5 rounded-lg border border-zinc-700 bg-zinc-800/80 px-1.5 text-[11px] font-medium text-zinc-100 hover:bg-zinc-700"
                          onClick={() => {
                            setCountMenuOpen((v) => !v);
                            setModelMenuOpen(false);
                            setQualityMenuOpen(false);
                            setSizeMenuOpen(false);
                            setDurationMenuOpen(false);
                          }}
                        >
                        {count} 条
                          <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
                        </button>
                        {countMenuOpen ? (
                          <div className="absolute bottom-full left-0 z-50 mb-1 w-24 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 p-1 shadow-2xl ring-1 ring-zinc-800">
                            {videoCountOptions.map((n) => (
                              <button
                                key={n}
                                type="button"
                                className="w-full rounded-md px-2 py-1.5 text-left text-[11px] font-medium text-zinc-100 hover:bg-zinc-800"
                                onClick={() => {
                                  setCount(n);
                                  data.onPromptSettingsChange?.({ count: n });
                                  setCountMenuOpen(false);
                                }}
                              >
                                {n} 条
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          title={
                            "时长 " +
                            String(videoDurationRange.min) +
                            "-" +
                            String(videoDurationRange.max) +
                            "s"
                          }
                          className="inline-flex h-7 min-w-[48px] items-center justify-center gap-0.5 rounded-lg border border-zinc-700 bg-zinc-800/80 px-1.5 text-[11px] font-medium text-zinc-100 hover:bg-zinc-700"
                          onClick={() => {
                            setDurationMenuOpen((v) => !v);
                            setModelMenuOpen(false);
                            setQualityMenuOpen(false);
                            setSizeMenuOpen(false);
                            setCountMenuOpen(false);
                          }}
                        >
                          {durationSeconds}s
                          <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
                        </button>
                        {durationMenuOpen ? (
                          <div className="absolute bottom-full left-0 z-50 mb-1 max-h-40 w-20 overflow-y-auto overflow-x-hidden rounded-lg border border-zinc-800 bg-zinc-950 p-1 shadow-2xl ring-1 ring-zinc-800">
                            {videoDurationOptions.map((s) => (
                              <button
                                key={s}
                                type="button"
                                className="w-full rounded-md px-2 py-1.5 text-left text-[11px] font-medium text-zinc-100 hover:bg-zinc-800"
                                onClick={() => {
                                  setDurationSeconds(s);
                                  data.onPromptSettingsChange?.({ durationSeconds: s });
                                  setDurationMenuOpen(false);
                                }}
                              >
                                {s}s
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      </>
                      {videoSupportsAudio ? (
                        <button
                          type="button"
                          title={
                            withAudio
                              ? "提交时包含音频"
                              : "提交时不包含音频"
                          }
                          className={[
                            "inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border px-1.5 text-[11px] font-medium transition-colors",
                            withAudio
                              ? "border-zinc-400 bg-zinc-600 text-white"
                              : "border-zinc-700 bg-zinc-700 text-zinc-400 hover:bg-zinc-600 hover:text-zinc-200",
                          ].join(" ")}
                          onClick={() => {
                            const next = !withAudio;
                            setWithAudio(next);
                            data.onPromptSettingsChange?.({ withAudio: next });
                          }}
                        >
                          {withAudio ? (
                            <Volume2 className="h-3.5 w-3.5" />
                          ) : (
                            <VolumeX className="h-3.5 w-3.5 text-zinc-400" />
                          )}
                          音频
                        </button>
                      ) : isVideoPrompt ? (
                        <div className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-800/70 px-1.5 text-[11px] font-medium text-zinc-500">
                          <VolumeX className="h-3.5 w-3.5" />
                          音频固定
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="relative shrink-0">
                      <button
                        type="button"
                        className="inline-flex h-7 min-w-[44px] items-center justify-center gap-0.5 rounded-lg border border-zinc-700 bg-zinc-800/80 px-1.5 text-[11px] font-medium text-zinc-100 hover:bg-zinc-700"
                        onClick={() => {
                          setCountMenuOpen((v) => !v);
                          setModelMenuOpen(false);
                          setQualityMenuOpen(false);
                          setSizeMenuOpen(false);
                          setDurationMenuOpen(false);
                        }}
                      >
                        {count} 张
                        <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
                      </button>
                      {countMenuOpen ? (
                        <div className="absolute bottom-full left-0 z-50 mb-1 w-24 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 p-1 shadow-2xl ring-1 ring-zinc-800">
                          {[1, 2, 4, 6].map((n) => (
                            <button
                              key={n}
                              type="button"
                              className="w-full rounded-md px-2 py-1.5 text-left text-[11px] font-medium text-zinc-100 hover:bg-zinc-800"
                              onClick={() => {
                                setCount(n);
                                data.onPromptSettingsChange?.({ count: n });
                                setCountMenuOpen(false);
                              }}
                            >
                              {n} 张
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )}

                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {false ? (
                    <div className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-100">
                      单张消耗 {lastCostPerImage} 积分
                    </div>
                  ) : null}
                  {typeof lastTaskCost === "number" ? (
                    <div className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-1.5 py-1 text-[10px] font-medium tabular-nums text-emerald-100">
                      <span>消耗 {lastTaskCost} 积分</span>
                      {typeof lastCostPerImage === "number" ? (
                        <span className="text-emerald-200/80">
                          {lastCostPerImage}/张
                          {typeof lastTaskOutputCount === "number" && lastTaskOutputCount > 1
                            ? " x " + String(lastTaskOutputCount)
                            : ""}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {typeof lastTaskCost !== "number" && typeof lastUsageTokens === "number" ? (
                    <div className="inline-flex items-center whitespace-nowrap rounded-lg border border-white/12 bg-white/[0.06] px-1.5 py-1 text-[10px] font-medium tabular-nums text-zinc-100">
                      消耗 {lastUsageTokens} 令牌
                    </div>
                  ) : null}
                  <button
                    type="button"
                    title="生成"
                    disabled={loading}
                    onClick={(e) => {
                      e.stopPropagation();
                      void beginGenerate();
                    }}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-700 text-white shadow-md ring-1 ring-zinc-500 disabled:bg-zinc-900 disabled:text-zinc-500"
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </>
          );
          const dockedAssistantPanel = isDockedPanel ? (
            <div className="flex h-full min-h-0 flex-col bg-zinc-950/55">
              <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white">多模态分析</div>
                  <div className="mt-1 text-[11px] text-zinc-500">
                    分析参考图、生成提示词，或优化当前提示词。
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="inline-flex items-center rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] text-zinc-300">
                    推理模型
                  </div>
                  <select
                    className="rounded-lg border border-white/10 bg-zinc-900/90 px-2 py-1.5 text-[11px] text-zinc-100 outline-none"
                    value={assistantModel}
                    onChange={(e) => setAssistantModel(e.target.value)}
                  >
                    {(assistantModels.length > 0 ? assistantModels : ["gpt-5.4"]).map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 px-4 py-3">
                <button
                  type="button"
                  disabled={assistantBusy || assistantImageRefs.length === 0}
                  className="inline-flex items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[12px] font-medium text-zinc-100 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-45"
                  onClick={() => void runPromptAssistant("analyze")}
                >
                  {assistantBusy && assistantActionLabel === "分析参考图" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ImageIcon className="h-3.5 w-3.5" />
                  )}
                  分析参考图
                </button>
                <button
                  type="button"
                  disabled={assistantBusy || assistantImageRefs.length === 0}
                  className="inline-flex items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[12px] font-medium text-zinc-100 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-45"
                  onClick={() => void runPromptAssistant("infer")}
                >
                  {assistantBusy && assistantActionLabel === "生成提示词" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  生成提示词
                </button>
                <button
                  type="button"
                  disabled={assistantBusy || (!assistantImageRefs.length && !editorText.trim())}
                  className="inline-flex items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[12px] font-medium text-zinc-100 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-45"
                  onClick={() => void runPromptAssistant("optimize")}
                >
                  {assistantBusy && assistantActionLabel === "优化提示词" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  优化提示词
                </button>
              </div>

              <div className="flex items-center justify-between px-4 pb-2 text-[10px] text-zinc-500">
                <span>参考图：{assistantImageRefs.length}</span>
                {assistantRefLabels.length > 0 ? (
                  <span className="truncate">{assistantRefLabels.join(" ")}</span>
                ) : (
                  <span>暂无参考标签</span>
                )}
              </div>

              <div className="min-h-0 flex-1 px-4 pb-4">
                <div className="flex h-full min-h-[220px] flex-col overflow-hidden rounded-[20px] border border-white/8 bg-zinc-900/78">
                  <div className="flex items-center justify-between border-b border-white/8 px-4 py-2.5">
                    <div className="text-[12px] font-medium text-zinc-200">
                      {assistantActionLabel || "等待指令"}
                    </div>
                    {assistantOutputKind === "prompt" && assistantOutput.trim() ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-zinc-200 transition-colors hover:bg-white/[0.08]"
                          onClick={() => void navigator.clipboard?.writeText(normalizeAssistantPromptText(assistantOutput))}
                        >
                          <Copy className="h-3.5 w-3.5" />
                          复制
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-950 transition-colors hover:bg-zinc-200"
                          onClick={() => applyAssistantPrompt(assistantOutput)}
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          覆盖到提示词
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                    {assistantError ? (
                      <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                        {assistantError}
                      </div>
                    ) : assistantBusy ? (
                      <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-3 text-zinc-400">
                        <Loader2 className="h-6 w-6 animate-spin" />
                        <div className="text-sm">正在处理{assistantActionLabel || "请求"}...</div>
                      </div>
                    ) : assistantOutput.trim() ? (
                      assistantOutputKind === "analysis" ? (
                        <div className="whitespace-pre-wrap text-sm leading-7 text-zinc-100">
                          {assistantOutput}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="rounded-2xl border border-emerald-400/18 bg-emerald-500/8 px-3 py-2 text-[11px] text-emerald-200">
                            助手已生成一版可直接覆盖到上方输入框的提示词。
                          </div>
                          <div className="whitespace-pre-wrap rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-sm leading-7 text-zinc-100">
                            {normalizeAssistantPromptText(assistantOutput)}
                          </div>
                        </div>
                      )
                    ) : (
                      <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-3 text-center text-zinc-500">
                        <Sparkles className="h-6 w-6 text-zinc-600" />
                        <div className="max-w-[320px] text-sm leading-6">
                          这里会显示参考图分析结果，或一版可覆盖到上方输入框的优化提示词。
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : null;

          if (isDockedPanel && typeof document !== "undefined") {
            if (isCompactDockedPanel) {
              return createPortal(
                <div className="fixed right-3 top-16 z-[88]">
                  <div
                    aria-busy={!panelReady}
                    data-panel-ready={panelReady ? "1" : "0"}
                    ref={floatMenusRef}
                    className="pointer-events-auto flex w-[92px] flex-col items-center gap-4 rounded-[22px] border border-white/12 bg-zinc-950/92 px-3 py-4 shadow-[0_22px_54px_rgba(0,0,0,0.42)] backdrop-blur-xl"
                    data-testid="canvas-node-generation-input-bar"
                    onClick={(e) => e.stopPropagation()}
                    onWheelCapture={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="flex h-10 w-10 items-center justify-center rounded-[18px] border border-white/10 bg-white/[0.03] text-zinc-200 transition-colors hover:bg-white/[0.06] hover:text-white"
                      onClick={() => data.onDockPanelModeChange?.("expanded")}
                        title="展开右侧停靠"
                    >
                      <ChevronLeft className="h-[18px] w-[18px]" />
                    </button>

                    <div className="flex w-full flex-col items-center gap-2 text-center">
                      <span className="flex h-11 w-11 items-center justify-center rounded-[18px] bg-white/[0.03] text-zinc-200 ring-1 ring-white/[0.08]">
                        {isVideoPrompt ? (
                          <Film className="h-[18px] w-[18px]" />
                        ) : (
                          <ImageIcon className="h-[18px] w-[18px]" />
                        )}
                      </span>
                      <div className="text-[11px] font-medium leading-tight text-white">
                        {isVideoPrompt ? "视频" : "生图"}
                      </div>
                    </div>

                    <div className="w-full rounded-[18px] border border-white/10 bg-white/[0.03] px-2 py-2 text-center">
                      <div className="truncate text-[10px] font-medium text-zinc-100">
                        {modelVersion}
                      </div>
                      <div className="mt-1 text-[10px] leading-tight text-zinc-500">
                        {dockPanelMeta}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="flex h-10 w-10 items-center justify-center rounded-[18px] text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-white"
                      onClick={() => data.onPanelDisplayModeChange?.("floating")}
                        title="切换为浮动面板"
                    >
                      <ChevronsUp className="h-[18px] w-[18px]" />
                    </button>
                  </div>
                </div>,
                document.body
              );
            }
            return createPortal(
              <div className="fixed inset-y-0 right-0 z-[88] flex w-[min(94vw,480px)] max-w-[480px] px-3 pb-4 pt-16">
                <div
                  aria-busy={!panelReady}
                  data-panel-ready={panelReady ? "1" : "0"}
                  ref={floatMenusRef}
                  className="pointer-events-auto flex h-full w-full min-h-0 flex-col rounded-[22px] border border-white/10 bg-zinc-950/92 shadow-[0_22px_54px_rgba(0,0,0,0.42)] backdrop-blur-xl"
                  data-testid="canvas-node-generation-input-bar"
                  onClick={(e) => e.stopPropagation()}
                  onWheelCapture={(e) => e.stopPropagation()}
                >
                  <div className="prompt-node-panel-enter h-full">
                    <div className="relative flex h-full min-h-0 flex-col bg-zinc-900/0 shadow-none">
                      <div className="shrink-0">{panelContent}</div>
                      <div className="min-h-0 flex-1 border-t border-white/8">
                        {dockedAssistantPanel}
                      </div>
                    </div>
                  </div>
                </div>
              </div>,
              document.body
            );
          }

          return (
            <div
              aria-busy={!panelReady}
              data-panel-ready={panelReady ? "1" : "0"}
              ref={floatMenusRef}
              className={[
                "node-float-ui pointer-events-auto nodrag nopan absolute left-1/2 top-full z-20 mt-2 w-[min(88vw,520px)] max-w-[520px]",
                /** ???????spill ????????????????????????????????????Canvas CANVAS_IMAGE_LAYOUT ????????*/
                "motion-reduce:transition-none",
              ].join(" ")}
              style={{
                transform:
                  "translateX(calc(-50% + " +
                  String(
                    typeof data.canvasImageSpill?.panelCenterOffsetX === "number"
                      ? data.canvasImageSpill.panelCenterOffsetX
                      : 0
                  ) +
                  "px)) scale(" +
                  String(panelScale) +
                  ")",
                transformOrigin: "top center",
                maxWidth: "min(88vw, 520px)",
              }}
              data-testid="canvas-node-generation-input-bar"
              onClick={(e) => e.stopPropagation()}
              onWheelCapture={(e) => e.stopPropagation()}
            >
              <div className="prompt-node-panel-enter">
                <div className="relative rounded-[14px] bg-zinc-900 shadow-2xl">
                  {panelContent}
                </div>
              </div>
            </div>
          );
        })()
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          if (!f) return;
          setLocalError(null);
          data.onAddImageNode?.(f);
        }}
      />

      <MaterialThumbHoverPreview
        url={thumbHoverPreview?.url ?? ""}
        isVideo={thumbHoverPreview?.isVideo}
        anchorRect={thumbHoverPreview?.rect ?? null}
        visible={Boolean(thumbHoverPreview)}
      />

      {expandedResultUrl ? (
        <GeneratedMediaPreviewModal
          mediaUrl={expandedResultUrl}
          mediaKind={urlLooksLikeVideoFile(expandedResultUrl) ? "video" : "image"}
          promptText={previewPromptText}
          modelLabel={previewModelLabel}
          ratioLabel={previewRatioLabel}
          resolutionLabel={previewResolutionLabel}
          generatedAt={data.lastGeneratedAt ?? null}
          onClose={() => setExpandedResultUrl(null)}
        >
          {urlLooksLikeVideoFile(expandedResultUrl) ? (
            <div className="h-full w-full">
              <CanvasMaterialVideo
                src={withGeneratedMediaCacheBust(expandedResultUrl, ownOutputCacheBustKey)}
                className="h-full w-full"
                objectFit="contain"
                surfaceAction="togglePlay"
                autoPlayWhenReady
              />
            </div>
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <PromptResultMedia
                src={expandedResultUrl}
                cacheBustKey={ownOutputCacheBustKey}
                objectFit="contain"
                fillContainer={false}
                className="max-h-full max-w-full shadow-none outline-none ring-0"
              />
            </div>
          )}
        </GeneratedMediaPreviewModal>
      ) : null}

      {showLoginModal ? (
        <div className="pointer-events-auto fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-4 text-white shadow-xl">
            <div className="flex items-center gap-2">
              <TriangleAlert className="w-5 h-5 text-amber-300" />
              <div className="text-sm font-medium">需要登录即梦</div>
            </div>
            <div className="mt-2 text-sm text-zinc-300">
              当前操作使用的是即梦生成能力。请先完成即梦登录，再继续生成。
            </div>
            <div className="mt-4 flex justify-end">
              <button
                className="h-9 rounded-lg border border-zinc-700 bg-zinc-700 px-3 text-sm hover:bg-zinc-600"
                onClick={() => setShowLoginModal(false)}
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
