import React, { useMemo, useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { type NodeProps, useReactFlow } from "reactflow";
import type { GenerateStreamProgressEvent } from "@/lib/generateStreamProgress";
import { MagneticHandleTarget } from "./MagneticHandle";
import { MAGNETIC_HANDLE_EDGE_OUTSET } from "@/lib/promptPreviewShell";
import { Loader2, TriangleAlert, Film, LayoutGrid, X, Download, Maximize2 } from "lucide-react";
import { JIMENG_CLOSE_MEDIA_LIGHTBOX_EVENT } from "@/lib/uiEvents";
import { CanvasMaterialVideo } from "@/components/CanvasMaterialVideo";
import { GeneratedMediaPreviewModal } from "@/components/GeneratedMediaPreviewModal";

export type VideoNodeData = {
  promptText?: string;
  modelVersion?: string;
  resolutionType?: string;
  count?: number;
  panelOpen?: boolean;
  onOpenPanel?: () => void;
  onClosePanel?: () => void;
  onPromptTextChange?: (text: string) => void;
  onPromptSettingsChange?: (patch: {
    modelVersion?: string;
    ratio?: string;
    resolutionType?: string;
    count?: number;
    durationSeconds?: number;
    withAudio?: boolean;
  }) => void;
  onGenerate?: (args: {
    prompt: string;
    nodeId: string;
    modelVersion: string;
    ratio: string;
    resolutionType: string;
    count: number;
    onEachImage?: (url: string) => void;
    onStreamProgress?: (e: GenerateStreamProgressEvent) => void;
  }) => Promise<{
    creditsAfter?: number | null;
    costPerImage?: number | null;
    firstImageUrl?: string | null;
    imageUrls?: string[];
  }>;
  imageUrls?: string[] | null;
  connectedImages?: Array<{
    id: string;
    url: string;
    refIndex: number;
    refType?: "image" | "video";
    isVideo?: boolean;
  }>;
  onDisconnectImage?: (imageNodeId: string) => void;
  onReorderConnectedImages?: (newOrder: string[]) => void;
  onRequestPickCanvasImage?: () => void;
  canPickCanvasImage?: boolean;
  imageOrder?: string[];
  videoOrder?: string[];
  materialOrder?: string[];
  zoomLevel?: number;
  isLoading?: boolean;
  error?: string | null;
  expectedCount?: number;
  ratio?: string;
  durationSeconds?: number;
  withAudio?: boolean;
  lastGeneratedAt?: number | null;
  /** 涓?Canvas handleGenerate 瀵归綈锛岀敤浜庡拷鐣ュ凡杩囨湡鐨?setNodes 鏇存柊 */
  generationSession?: number;
  streamStatusLine?: string | null;
  streamProgressPct?: number;
  streamInQueue?: boolean;
  /** 鏈€杩戜竴娆¤繘搴﹂噷鐨?submit_id锛屽埛鏂板悗鍙仮澶嶈疆璇?*/
  lastSubmitId?: string | null;
  /** 鍙戣捣 /api/generate 鏃剁殑 nodeId锛坧rompt / 瑙嗛鑺傜偣锛夛紝鐢ㄤ簬鎷兼帴杈撳嚭鏂囦欢鍚?*/
  resumeGenSourceNodeId?: string | null;
};

function inferExtFromUrl(url: string) {
  const t = url.trim();
  if (!t) return "mp4";
  let source = t;
  try {
    const u = new URL(t, "http://localhost");
    source = u.searchParams.get("name")?.trim() || u.pathname;
  } catch {
    source = t.split("#")[0];
  }
  const m = source.toLowerCase().match(/\.([a-z0-9]{2,6})(?:\?|$)/);
  return m?.[1] ?? "mp4";
}

function downloadMediaUrls(urls: string[], filePrefix: string) {
  const list = urls.filter((u) => typeof u === "string" && u.trim().length > 0);
  for (let i = 0; i < list.length; i++) {
    const raw = list[i]!;
    const url = raw.trim();
    const ext = inferExtFromUrl(url);
    const name = `${filePrefix}-${String(i + 1).padStart(2, "0")}.${ext}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

/** 瑙嗛鑺傜偣浜у嚭锛氬崟鍑荤敾闈㈡墦寮€鏂囨湰闈㈡澘锛涙斁澶?鏀剁缉闈犺繘搴︽潯鍙充晶鍥炬爣 */
function GeneratedOutputVideo({
  src,
  label,
  onOpenTextPanel,
  videoRefCallback,
  toolbarExpandExpanded,
  onToolbarExpandToggle,
}: {
  src: string;
  label: string;
  onOpenTextPanel?: () => void;
  videoRefCallback?: (el: HTMLVideoElement | null) => void;
  toolbarExpandExpanded: boolean;
  onToolbarExpandToggle: () => void;
}) {
  return (
    <div className="h-full min-h-0 w-full" aria-label={label}>
      <CanvasMaterialVideo
        src={src}
        compact
        surfaceAction="none"
        onSurfaceClick={() => {
          onOpenTextPanel?.();
        }}
        toolbarExpandExpanded={toolbarExpandExpanded}
        onToolbarExpandToggle={onToolbarExpandToggle}
        videoRefCallback={videoRefCallback}
      />
    </div>
  );
}

export function VideoNode({ id, data, selected }: NodeProps<VideoNodeData>) {
  const { setNodes } = useReactFlow();
  const outputRestoredRef = useRef(false);
  const inflightRestoredRef = useRef(false);
  const [expandedVideoSrc, setExpandedVideoSrc] = useState<string | null>(null);
  const [gridReviewOpen, setGridReviewOpen] = useState(false);
  const [magneticReveal, setMagneticReveal] = useState(false);
  const videoElsBySrcRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const expandedVideoRef = useRef<HTMLVideoElement | null>(null);
  const expandPlaybackRef = useRef({ time: 0, paused: true });
  const wasLoadingRef = useRef(data.isLoading);
  const lastAutoplaySigRef = useRef<string | null>(null);

  const registerTileVideo = useCallback((srcKey: string, el: HTMLVideoElement | null) => {
    const m = videoElsBySrcRef.current;
    if (!el) {
      m.delete(srcKey);
      return;
    }
    m.set(srcKey, el);
  }, []);

  const openSingleExpand = useCallback((srcKey: string) => {
    const ce = videoElsBySrcRef.current.get(srcKey);
    expandPlaybackRef.current = {
      time: ce?.currentTime ?? 0,
      paused: ce?.paused ?? true,
    };
    ce?.pause();
    setGridReviewOpen(false);
    setExpandedVideoSrc(srcKey);
  }, []);

  const closeExpanded = useCallback(() => {
    const ev = expandedVideoRef.current;
    const srcKey = expandedVideoSrc;
    const ce = srcKey ? videoElsBySrcRef.current.get(srcKey) : undefined;
    if (ev && ce) {
      ce.currentTime = ev.currentTime;
      if (!ev.paused) void ce.play().catch(() => {});
    }
    setExpandedVideoSrc(null);
  }, [expandedVideoSrc]);

  useLayoutEffect(() => {
    if (!expandedVideoSrc) return;
    const ev = expandedVideoRef.current;
    if (!ev) return;
    const snap = expandPlaybackRef.current;
    const apply = () => {
      try {
        ev.currentTime = snap.time;
        if (!snap.paused) void ev.play().catch(() => {});
      } catch {
        /* ignore */
      }
    };
    if (ev.readyState >= 1) apply();
    else {
      ev.addEventListener("loadedmetadata", apply, { once: true });
      return () => ev.removeEventListener("loadedmetadata", apply);
    }
  }, [expandedVideoSrc]);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    if (inflightRestoredRef.current) return;
    const d = data;
    if (
      d.isLoading &&
      typeof d.lastSubmitId === "string" &&
      d.lastSubmitId.trim() &&
      typeof d.resumeGenSourceNodeId === "string" &&
      d.resumeGenSourceNodeId.trim()
    ) {
      inflightRestoredRef.current = true;
      return;
    }
    const urls = d.imageUrls ?? [];
    if (urls.length > 0) {
      inflightRestoredRef.current = true;
      return;
    }
    type InflightLs = {
      lastSubmitId?: string;
      resumeGenSourceNodeId?: string;
      streamStatusLine?: string | null;
      streamProgressPct?: number;
      streamInQueue?: boolean;
      generationSession?: number;
      expectedCount?: number;
    };
    let parsed: InflightLs | null = null;
    try {
      const raw = localStorage.getItem(`video-node-inflight-v1:${id}`);
      if (raw) parsed = JSON.parse(raw) as InflightLs;
    } catch {
      parsed = null;
    }
    const sid = parsed?.lastSubmitId?.trim();
    const src = parsed?.resumeGenSourceNodeId?.trim();
    if (!parsed || !sid || !src) {
      inflightRestoredRef.current = true;
      return;
    }
    const snap = parsed;
    inflightRestoredRef.current = true;
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== id) return n;
        const dn = n.data as VideoNodeData;
        return {
          ...n,
          data: {
            ...dn,
            isLoading: true,
            lastSubmitId: sid,
            resumeGenSourceNodeId: src,
            streamStatusLine:
              typeof snap.streamStatusLine === "string"
                ? snap.streamStatusLine
                : "恢复任务追踪中...",
            streamProgressPct:
              typeof snap.streamProgressPct === "number"
                ? snap.streamProgressPct
                : (dn.streamProgressPct ?? 0),
            streamInQueue: snap.streamInQueue !== false,
            generationSession:
              typeof snap.generationSession === "number"
                ? snap.generationSession
                : dn.generationSession,
            expectedCount:
              typeof snap.expectedCount === "number"
                ? snap.expectedCount
                : dn.expectedCount,
          },
        };
      })
    );
  }, [
    id,
    data.isLoading,
    data.lastSubmitId,
    data.resumeGenSourceNodeId,
    data.imageUrls,
    setNodes,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const d = data;
    const busy =
      Boolean(d.isLoading) &&
      typeof d.lastSubmitId === "string" &&
      Boolean(d.lastSubmitId.trim()) &&
      typeof d.resumeGenSourceNodeId === "string" &&
      Boolean(d.resumeGenSourceNodeId.trim());
    try {
      if (!busy) {
        localStorage.removeItem(`video-node-inflight-v1:${id}`);
        return;
      }
      localStorage.setItem(
        `video-node-inflight-v1:${id}`,
        JSON.stringify({
          lastSubmitId: d.lastSubmitId,
          resumeGenSourceNodeId: d.resumeGenSourceNodeId,
          streamStatusLine: d.streamStatusLine ?? null,
          streamProgressPct: d.streamProgressPct ?? 0,
          streamInQueue: d.streamInQueue ?? false,
          generationSession: d.generationSession,
          expectedCount: d.expectedCount,
        })
      );
    } catch {
      /* ignore */
    }
  }, [
    id,
    data.isLoading,
    data.lastSubmitId,
    data.resumeGenSourceNodeId,
    data.streamStatusLine,
    data.streamProgressPct,
    data.streamInQueue,
    data.generationSession,
    data.expectedCount,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (outputRestoredRef.current) return;
    if (data.isLoading) return;
    if (typeof data.error === "string" && data.error.trim()) {
      outputRestoredRef.current = true;
      return;
    }
    const urls = data.imageUrls ?? [];
    if (urls.length > 0) {
      outputRestoredRef.current = true;
      return;
    }
    let parsed: { imageUrls?: string[]; ratio?: string } | null = null;
    try {
      const raw = localStorage.getItem(`video-node-output-v1:${id}`);
      if (raw) parsed = JSON.parse(raw) as { imageUrls?: string[]; ratio?: string };
    } catch {
      parsed = null;
    }
    const fromLs = (parsed?.imageUrls ?? []).filter((u) => typeof u === "string" && u.length > 0);
    if (fromLs.length === 0) {
      outputRestoredRef.current = true;
      return;
    }
    outputRestoredRef.current = true;
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== id) return n;
        const d = n.data as VideoNodeData;
        return {
          ...n,
          data: {
            ...d,
            imageUrls: fromLs,
            ...(parsed?.ratio ? { ratio: parsed.ratio } : {}),
          },
        };
      })
    );
  }, [id, data.imageUrls, data.isLoading, data.error, setNodes]);

  useEffect(() => {
    const urls = data.imageUrls ?? [];
    if (urls.length === 0) {
      if (!data.isLoading) {
        try {
          localStorage.removeItem(`video-node-output-v1:${id}`);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    try {
      localStorage.setItem(
        `video-node-output-v1:${id}`,
        JSON.stringify({ imageUrls: urls, ratio: data.ratio ?? "16:9" })
      );
    } catch {
      /* quota or private mode */
    }
  }, [id, data.imageUrls, data.ratio, data.isLoading]);

  useEffect(() => {
    if (!expandedVideoSrc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeExpanded();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedVideoSrc, closeExpanded]);

  useEffect(() => {
    const close = () => {
      setGridReviewOpen(false);
      closeExpanded();
    };
    window.addEventListener(JIMENG_CLOSE_MEDIA_LIGHTBOX_EVENT, close);
    return () => window.removeEventListener(JIMENG_CLOSE_MEDIA_LIGHTBOX_EVENT, close);
  }, [closeExpanded]);

  const srcs = data.imageUrls ?? [];
  const currentDisplayUrl = useMemo(() => {
    const u = srcs.find((x) => typeof x === "string" && x.trim().length > 0);
    return u?.trim() ?? null;
  }, [srcs]);
  const previewPromptText = (data.promptText || "").trim();
  const previewModelLabel =
    data.lastGeneratedAt &&
    typeof data.modelVersion === "string" &&
    data.modelVersion.trim().length > 0
      ? data.modelVersion.trim()
      : null;
  const previewRatioLabel = (data.ratio || "16:9").trim();
  const previewResolutionLabel = (data.resolutionType || "").trim();

  useEffect(() => {
    if (srcs.length === 0) {
      setExpandedVideoSrc((current) => (current ? null : current));
      setGridReviewOpen((current) => (current ? false : current));
    }
  }, [srcs.length]);
  const expectedCount = data.expectedCount ?? 0;
  const n = srcs.length || expectedCount;

  useEffect(() => {
    if (wasLoadingRef.current && !data.isLoading && srcs.length > 0) {
      const sig = srcs.join("\0");
      if (lastAutoplaySigRef.current !== sig) {
        lastAutoplaySigRef.current = sig;
        requestAnimationFrame(() => {
          const el = videoElsBySrcRef.current.get(srcs[0]!);
          void el?.play().catch(() => {});
        });
      }
    }
    wasLoadingRef.current = data.isLoading;
  }, [data.isLoading, srcs]);

  const aspect = useMemo(() => {
    const ratio = data.ratio || "16:9";
    const [w, h] = ratio.split(":").map((v) => Number(v));
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 16 / 9;
    return w / h;
  }, [data.ratio]);

  const overlay = useMemo(() => {
    if (!data.isLoading) return null;
    const line =
      typeof data.streamStatusLine === "string" && data.streamStatusLine.trim()
        ? data.streamStatusLine.trim()
        : "生成中...";
    const pct =
      typeof data.streamProgressPct === "number" && !Number.isNaN(data.streamProgressPct)
        ? Math.min(100, Math.max(0, data.streamProgressPct))
        : 0;
    const inQueuePhase = data.streamInQueue === true;
    return (
      <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-zinc-800">
        <div className="max-w-[min(260px,92%)] px-2 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-zinc-200" />
          <div className="mt-2 text-xs font-semibold leading-snug text-zinc-100">{line}</div>
          {!inQueuePhase ? (
            <div className="mx-auto mt-2 h-1.5 w-[88%] overflow-hidden rounded-full bg-zinc-600">
              <div
                className="h-full rounded-full bg-zinc-200/90 transition-[width] duration-500 ease-out"
                style={{ width: `${Math.max(8, pct)}%` }}
              />
            </div>
          ) : (
            <div className="mt-1 text-[11px] leading-snug text-zinc-400">
              当前任务采用异步排队模式，排到后会继续显示下方渲染进度。
            </div>
          )}
        </div>
      </div>
    );
  }, [data.isLoading, data.streamInQueue, data.streamProgressPct, data.streamStatusLine]);

  const gridCols = useMemo(() => {
    if (n <= 1) return "grid-cols-1";
    if (n === 2) return "grid-cols-2";
    if (n === 3) return "grid-cols-3";
    if (n === 4) return "grid-cols-2";
    return "grid-cols-3";
  }, [n]);

  /** 缃戞牸寮瑰眰锛氱敓鎴愪腑鎸?expectedCount 琛ュ崰浣嶏紝涓庝富棰勮鏍兼暟涓€鑷?*/
  const gridReviewSlotCount = data.isLoading
    ? Math.max(srcs.length, expectedCount, 1)
    : Math.max(srcs.length, 1);

  const gridReviewCols = useMemo(() => {
    const c = gridReviewSlotCount;
    if (c <= 1) return "grid-cols-1";
    if (c === 2) return "grid-cols-2";
    if (c === 3) return "grid-cols-3";
    if (c === 4) return "grid-cols-2";
    return "grid-cols-3";
  }, [gridReviewSlotCount]);

  const selectThisNode = useCallback(
    (e: React.PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("button,video,a,[contenteditable='true']")) return;
      const multi = e.shiftKey || e.metaKey || e.ctrlKey;
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id !== id) {
            if (multi) return node;
            return { ...node, selected: false };
          }
          return { ...node, selected: true };
        })
      );
    },
    [id, setNodes]
  );

  const canvasNodePointerInsideRef = useRef(false);

  return (
    <div
      className="group/video-node relative w-[368px] overflow-visible"
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
            "nodrag nopan pointer-events-auto absolute right-2 z-[40] flex size-7 items-center justify-center rounded-md text-zinc-100 shadow-sm ring-1 ring-inset backdrop-blur-sm transition-all",
            "bg-zinc-950/45 ring-white/[0.08]",
            "hover:bg-zinc-800/70",
            selected ? "opacity-100" : "pointer-events-none opacity-0",
          ].join(" ")}
          style={{ top: -30 }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            window.dispatchEvent(new Event(JIMENG_CLOSE_MEDIA_LIGHTBOX_EVENT));
            openSingleExpand(currentDisplayUrl);
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

      <div
        className={[
          "jimeng-canvas-node-drag-handle pointer-events-auto relative cursor-grab overflow-visible rounded-xl border border-zinc-700 bg-zinc-800 text-white shadow-[0_10px_30px_rgba(0,0,0,0.62)] active:cursor-grabbing",
          selected
            ? "z-[2] ring-1 ring-zinc-300/90 ring-offset-2 ring-offset-black shadow-[0_10px_32px_rgba(0,0,0,0.52),0_0_12px_rgba(255,255,255,0.06)]"
            : "",
        ].join(" ")}
        onPointerDown={(e) => {
          selectThisNode(e);
        }}
      >
      <div className="p-2">
        {data.error ? (
          <div className="mb-2 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-2 py-1.5 text-xs text-red-200">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="whitespace-pre-wrap leading-snug">任务已终止：{data.error}</div>
          </div>
        ) : null}

        <div
          className={[
            "relative h-60 w-full cursor-pointer overflow-hidden rounded-lg bg-zinc-800 shadow-[0_8px_22px_rgba(0,0,0,0.42)] ring-1 ring-inset ring-white/[0.09]",
            data.isLoading ? "jimeng-prompt-shell-rendering" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("button")) return;
            data.onOpenPanel?.();
          }}
        >
          {currentDisplayUrl ? (
            <button
              type="button"
              title="下载视频"
              className={[
                "nodrag nopan absolute top-1.5 z-[21] flex size-7 items-center justify-center rounded-md text-zinc-100 shadow-sm ring-1 ring-inset backdrop-blur-sm transition-all",
                "left-1.5 bg-zinc-950/45 ring-white/[0.08]",
                "opacity-0 hover:bg-zinc-800/70 group-hover/video-node:opacity-100 group-focus-within/video-node:opacity-100",
                selected ? "opacity-100" : "",
              ].join(" ")}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                downloadMediaUrls([currentDisplayUrl], `video-${id}`);
              }}
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {srcs.length > 1 || (data.isLoading && expectedCount > 1) ? (
            <button
              type="button"
              title={
                data.isLoading
                  ? "展开网格查看各格进度"
                  : "展开网格查看全部成片"
              }
              className={[
                "absolute right-1.5 top-1.5 z-20 flex size-7 items-center justify-center rounded-md text-zinc-100 shadow-sm ring-1 ring-inset backdrop-blur-sm transition-colors",
                data.isLoading
                  ? "bg-zinc-950/88 ring-zinc-400/30 hover:bg-zinc-800/95"
                  : "bg-zinc-950/78 ring-white/[0.1] hover:bg-zinc-800/95",
              ].join(" ")}
              onClick={(e) => {
                e.stopPropagation();
                setGridReviewOpen(true);
              }}
            >
              <LayoutGrid className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          ) : null}
          <div className="flex h-full min-h-0 w-full flex-col">
            {srcs.length === 0 && expectedCount === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center px-2 text-center">
                <Film className="mx-auto h-9 w-9 text-zinc-500" strokeWidth={1.15} aria-hidden />
                <div className="mt-1.5 text-[11px] text-zinc-300">等待视频结果</div>
                <div className="mt-0.5 text-[10px] text-zinc-500">连接生成节点后，这里会显示最新视频输出与渲染状态。</div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden p-1">
                {srcs.length === 0 ? (
                  <div className={`grid min-h-0 gap-1 ${gridCols}`}>
                    {Array.from({ length: expectedCount }).map((_, idx) => (
                      <div
                        key={idx}
                        className="min-h-0 rounded-[4px] bg-zinc-800 ring-1 ring-inset ring-white/[0.06]"
                        style={{ aspectRatio: `${aspect}` }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className={`grid min-h-0 gap-1 ${gridCols}`}>
                    {srcs.map((src, idx) => (
                      <div
                        key={src + idx}
                        className="min-h-0 overflow-hidden rounded-[4px] bg-zinc-800 ring-1 ring-inset ring-white/[0.07]"
                        style={{ aspectRatio: `${aspect}` }}
                      >
                        <GeneratedOutputVideo
                          src={src}
                          label={`生成视频 ${idx + 1}`}
                          onOpenTextPanel={data.onOpenPanel}
                          videoRefCallback={(el) => registerTileVideo(src, el)}
                          toolbarExpandExpanded={expandedVideoSrc === src}
                          onToolbarExpandToggle={() => {
                            if (expandedVideoSrc === src) closeExpanded();
                            else openSingleExpand(src);
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {overlay}
        </div>
      </div>

      <MagneticHandleTarget
        id="input"
        magneticVisible={magneticReveal && !gridReviewOpen}
        horizontalEdgeOutset={MAGNETIC_HANDLE_EDGE_OUTSET}
      />
      <MagneticHandleTarget
        id="image_input"
        magneticVisible={magneticReveal && !gridReviewOpen}
        horizontalEdgeOutset={MAGNETIC_HANDLE_EDGE_OUTSET}
      />
      </div>

      {expandedVideoSrc ? (
        <GeneratedMediaPreviewModal
          mediaUrl={expandedVideoSrc}
          mediaKind="video"
          promptText={previewPromptText}
          modelLabel={previewModelLabel}
          ratioLabel={previewRatioLabel}
          resolutionLabel={previewResolutionLabel}
          generatedAt={data.lastGeneratedAt ?? null}
          onClose={() => {
            setGridReviewOpen(false);
            closeExpanded();
          }}
        >
          <div className="h-full w-full">
            <div className="relative flex h-[min(85vh,calc(100vh-48px))] w-[min(92vw,calc(100vw-24px))] max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl">
              <button
                type="button"
                aria-label="关闭预览"
                className="absolute right-2 top-2 z-[25] flex h-10 w-10 items-center justify-center rounded-full bg-zinc-950/90 text-zinc-100 ring-1 ring-zinc-600 backdrop-blur-sm transition-colors hover:bg-zinc-800 hover:ring-zinc-500"
                onClick={(e) => {
                  e.stopPropagation();
                  closeExpanded();
                }}
              >
                <X className="h-5 w-5" strokeWidth={2} />
              </button>
              <CanvasMaterialVideo
                src={expandedVideoSrc}
                objectFit="contain"
                surfaceAction="togglePlay"
                toolbarExpandExpanded
                onToolbarExpandToggle={closeExpanded}
                videoRefCallback={(el) => {
                  expandedVideoRef.current = el;
                }}
              />
            </div>
          </div>
        </GeneratedMediaPreviewModal>
      ) : null}

      {gridReviewOpen ? (
        <div
          className="pointer-events-auto nopan nodrag fixed inset-0 z-[92] flex items-center justify-center bg-zinc-950/92 p-3 sm:p-4"
          onClick={() => {
            setGridReviewOpen(false);
            setExpandedVideoSrc(null);
          }}
        >
          <div
            className="relative max-h-[min(92vh,calc(100vh-32px))] w-[min(96vw,920px)] overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="关闭网格"
              className="absolute right-2 top-2 z-[25] flex h-9 w-9 items-center justify-center rounded-full bg-zinc-950/90 text-zinc-100 ring-1 ring-zinc-600 backdrop-blur-sm hover:bg-zinc-800"
              onClick={() => setGridReviewOpen(false)}
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
            <div className="mb-2 pr-10 text-sm font-medium text-zinc-200">
              {data.isLoading ? "生成进度（各格）" : "全部成片"}
            </div>
            <div className={`grid max-h-[min(78vh,720px)] gap-2 overflow-y-auto ${gridReviewCols}`}>
              {Array.from({ length: gridReviewSlotCount }, (_, idx) => {
                const src = srcs[idx];
                const hasSrc = typeof src === "string" && src.trim().length > 0;
                if (hasSrc) {
                  return (
                    <div
                      key={src + idx}
                      className="min-h-[120px] overflow-hidden rounded-lg border border-zinc-700/80 bg-zinc-950/40"
                      style={{ aspectRatio: `${aspect}` }}
                    >
                      <CanvasMaterialVideo
                        src={src}
                        compact
                        objectFit="cover"
                        surfaceAction="togglePlay"
                      />
                    </div>
                  );
                }
                return (
                  <div
                    key={`grid-pending-${idx}`}
                    className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-lg border border-zinc-700/60 bg-zinc-800/80"
                    style={{ aspectRatio: `${aspect}` }}
                  >
                    <Loader2 className="h-8 w-8 animate-spin text-zinc-200/80" strokeWidth={2} />
                    <span className="text-[11px] text-zinc-400">生成中...</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
