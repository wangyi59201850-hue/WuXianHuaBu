import React, { useEffect, useMemo, useRef, useState } from "react";
import { type NodeProps } from "reactflow";
import { MagneticHandleSource } from "./MagneticHandle";
import { Image as ImageIcon, Loader2, Star, Trash2, Upload, X } from "lucide-react";
import { JIMENG_CLOSE_MEDIA_LIGHTBOX_EVENT } from "@/lib/uiEvents";
import { CanvasMaterialVideo } from "@/components/CanvasMaterialVideo";
import {
  isLocalBridgeMediaUrl,
  useLocalBridgeMediaUrl,
} from "@/lib/localBridgeMedia";

export type LocalImageNodeData = {
  imagePreviewUrl?: string | null;
  imageFile?: File | null;
  materialIsVideo?: boolean;
  refIndex?: number | null;
  persistedImage?: boolean;
  tileWidth?: number;
  tileHeight?: number;
  zoomLevel?: number;
  generatedSpillPromptId?: string;
  generatedSpillUrlIndex?: number;
  generatedSpillIsPrimary?: boolean;
  onSetPrimaryGeneratedOutput?: () => void;
  generatedSpillPending?: boolean;
  generatedSpillFetchToken?: string;
  generatedSpillSwapCover?: boolean;
  generatedSpillCollapseRotateDeg?: number;
  generatedSpillCollapseScale?: number;
  generatedSpillCollapseAlpha?: number;
  generatedSpillExpandWobbleX?: number;
  generatedSpillExpandWobbleY?: number;
  generatedSpillExpandWobbleTick?: number;
  onDelete?: () => void;
  onLoadImage?: (file: File) => void;
};

export function LocalImageNode({ data, selected }: NodeProps<LocalImageNodeData>) {
  const rawSrc = data.imagePreviewUrl ?? null;
  const bridgeSrc = useLocalBridgeMediaUrl(rawSrc);
  const src = bridgeSrc || (isLocalBridgeMediaUrl(rawSrc) ? null : rawSrc);
  const refIndex = data.refIndex ?? null;
  const onDelete = data.onDelete;
  const onLoadImage = data.onLoadImage;
  const zoomAwareBigLabel = (data.zoomLevel ?? 1) < 0.72;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasNodePointerInsideRef = useRef(false);

  const isVideo =
    Boolean(data.imageFile?.type?.startsWith("video/")) || Boolean(data.materialIsVideo);
  const [expandedSrc, setExpandedSrc] = useState<string | null>(null);
  const [magneticReveal, setMagneticReveal] = useState(false);
  const expandedBridgeSrc = useLocalBridgeMediaUrl(expandedSrc);
  const displayExpandedSrc =
    expandedBridgeSrc || (isLocalBridgeMediaUrl(expandedSrc) ? null : expandedSrc);

  const [aspect, setAspect] = useState<number | null>(null);
  const frameW = typeof data.tileWidth === "number" && data.tileWidth > 0 ? data.tileWidth : 320;
  const fixedH =
    typeof data.tileHeight === "number" && data.tileHeight > 0 ? data.tileHeight : null;
  const height = useMemo(() => {
    if (fixedH != null) return Math.round(fixedH);
    if (!aspect || aspect <= 0) return 140;
    return Math.round(frameW / aspect);
  }, [aspect, frameW, fixedH]);

  const badge = useMemo(() => {
    if (!refIndex) return null;
    return (
      <div
        className={[
          "pointer-events-none absolute left-2 top-2 z-20 flex items-center justify-center rounded-full bg-zinc-900 font-semibold text-zinc-100 ring-1 ring-zinc-600",
          zoomAwareBigLabel ? "h-7 min-w-7 px-1.5 text-[13px]" : "h-6 min-w-6 px-1 text-[12px]",
        ].join(" ")}
      >
        {refIndex}
      </div>
    );
  }, [refIndex, zoomAwareBigLabel]);

  useEffect(() => {
    if (!src) return;
    if (isVideo) {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.src = src;
      v.onloadedmetadata = () => {
        const vw = v.videoWidth;
        const vh = v.videoHeight;
        if (vw > 0 && vh > 0) setAspect(vw / vh);
      };
      return;
    }
    const img = new Image();
    img.src = src;
    img.onload = () => {
      const a = img.naturalWidth / img.naturalHeight;
      if (Number.isFinite(a) && a > 0) setAspect(a);
    };
  }, [src, isVideo]);

  useEffect(() => {
    if (!expandedSrc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpandedSrc(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedSrc]);

  useEffect(() => {
    const close = () => setExpandedSrc(null);
    window.addEventListener(JIMENG_CLOSE_MEDIA_LIGHTBOX_EVENT, close);
    return () => window.removeEventListener(JIMENG_CLOSE_MEDIA_LIGHTBOX_EVENT, close);
  }, []);

  const isGenSpill = Boolean(data.generatedSpillPromptId);
  const spillPending = Boolean(data.generatedSpillPending);
  const showSetPrimarySpill =
    Boolean(data.onSetPrimaryGeneratedOutput) &&
    !data.generatedSpillIsPrimary &&
    !spillPending;
  const collapseRotateDeg =
    typeof data.generatedSpillCollapseRotateDeg === "number"
      ? data.generatedSpillCollapseRotateDeg
      : 0;
  const collapseScale =
    typeof data.generatedSpillCollapseScale === "number" ? data.generatedSpillCollapseScale : 1;
  const collapseAlpha =
    typeof data.generatedSpillCollapseAlpha === "number" ? data.generatedSpillCollapseAlpha : 1;
  const expandWobbleX =
    typeof data.generatedSpillExpandWobbleX === "number" ? data.generatedSpillExpandWobbleX : 0;
  const expandWobbleY =
    typeof data.generatedSpillExpandWobbleY === "number" ? data.generatedSpillExpandWobbleY : 0;
  const expandWobbleTick =
    typeof data.generatedSpillExpandWobbleTick === "number" ? data.generatedSpillExpandWobbleTick : 0;

  const mediaShellClass = [
    "absolute inset-0 z-[1] flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[inherit] bg-zinc-800 [contain:paint]",
  ].join(" ");

  return (
    <div
      className={[
        "jimeng-canvas-node-drag-handle group relative cursor-grab overflow-visible rounded-xl shadow-[0_10px_32px_rgba(0,0,0,0.5)] active:cursor-grabbing",
        isGenSpill && expandWobbleTick > 0 ? "jimeng-spill-expand-wobble" : "",
        selected
          ? "ring-1 ring-zinc-300/90 ring-offset-2 ring-offset-black shadow-[0_10px_32px_rgba(0,0,0,0.52),0_0_12px_rgba(255,255,255,0.06)]"
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        width: frameW,
        height,
        opacity: collapseAlpha,
        ["--spill-wobble-x" as any]: String(expandWobbleX) + "px",
        ["--spill-wobble-y" as any]: String(expandWobbleY) + "px",
        transition: isGenSpill ? "opacity 320ms ease-out" : undefined,
      }}
      onPointerEnter={() => {
        setMagneticReveal(true);
        canvasNodePointerInsideRef.current = true;
      }}
      onPointerLeave={(ev) => {
        if (ev.buttons === 0) {
          setMagneticReveal(false);
          canvasNodePointerInsideRef.current = false;
        }
      }}
    >
      <div
        className={[
          "relative overflow-visible rounded-xl bg-zinc-800 ring-1 ring-inset ring-white/[0.09]",
          spillPending ? "jimeng-prompt-shell-rendering" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{
          width: "100%",
          height: "100%",
          transform:
            "rotate(" + String(collapseRotateDeg) + "deg) scale(" + String(collapseScale) + ")",
          transformOrigin: "100% 50%",
          transition: isGenSpill
            ? "transform 580ms cubic-bezier(0.18, 1.22, 0.24, 1)"
            : undefined,
        }}
        onClick={(e) => {
          if (src || isGenSpill) return;
          e.stopPropagation();
          fileInputRef.current?.click();
        }}
        onDoubleClick={(e) => {
          if (!src) return;
          e.stopPropagation();
          setExpandedSrc(src);
        }}
      >
        {badge}
        {showSetPrimarySpill ? (
          <button
            type="button"
            title="设为主显示图"
            className="nodrag nopan absolute right-2 top-2 z-30 flex size-8 items-center justify-center rounded-lg border border-zinc-600/60 bg-zinc-950/70 text-amber-200/90 shadow-md ring-1 ring-zinc-700/40 backdrop-blur-sm opacity-0 transition-all duration-300 ease-[cubic-bezier(0.22,1.12,0.36,1)] hover:scale-105 hover:border-amber-500/40 hover:opacity-100 hover:ring-amber-400/25 group-hover:opacity-90"
            onClick={(e) => {
              e.stopPropagation();
              data.onSetPrimaryGeneratedOutput?.();
            }}
          >
            <Star className="h-4 w-4" strokeWidth={2} />
          </button>
        ) : null}
        <div className={mediaShellClass}>
          {!src ? (
            <div
              className={[
                "flex h-full flex-col items-center justify-center gap-2 px-4",
                isGenSpill || spillPending ? "cursor-default" : "cursor-pointer",
              ].join(" ")}
            >
              {spillPending ? (
                data.generatedSpillSwapCover ? (
                  <div
                    className="h-full min-h-[48px] w-full flex-1 rounded-[inherit] bg-zinc-800"
                    aria-hidden
                  />
                ) : (
                  <div className="relative h-full min-h-[48px] w-full flex-1 overflow-hidden rounded-[inherit]">
                    <div className="jimeng-render-status-fx jimeng-render-status-fx--compact">
                      <span className="jimeng-render-orbit-glow" aria-hidden />
                      <span className="jimeng-render-frost-bands" aria-hidden />
                      <div className="relative z-[1] flex h-full w-full flex-col items-center justify-center gap-2 px-2">
                        <Loader2 className="h-7 w-7 animate-spin text-zinc-200/85" strokeWidth={2} />
                        <div className="jimeng-render-status-shine text-center text-[10px] font-medium">
                          加载中...
                        </div>
                      </div>
                    </div>
                  </div>
                )
              ) : (
                <>
                  <ImageIcon className="h-8 w-8 text-zinc-500" strokeWidth={1.25} />
                  <div className="text-center text-xs text-zinc-400">
                    {isGenSpill ? "结果图加载中..." : "点击加载图片或视频"}
                  </div>
                </>
              )}
            </div>
          ) : isVideo ? (
            <>
              <CanvasMaterialVideo
                src={src}
                surfaceAction="expand"
                onSurfaceAction={() => setExpandedSrc(src)}
                suspendPlayback={Boolean(expandedSrc)}
              />
              {!isGenSpill ? (
                <button
                  type="button"
                  title="替换素材"
                  className="nodrag nopan absolute top-2 right-2 z-30 flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-zinc-600 bg-zinc-800 text-zinc-100 opacity-0 shadow-lg transition-[opacity,colors] group-hover:opacity-100 hover:border-zinc-300 hover:bg-zinc-700"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                >
                  <Upload className="h-5 w-5" strokeWidth={2} />
                </button>
              ) : null}
            </>
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-full w-full object-cover" draggable={false} />
              {!isGenSpill ? (
                <button
                  type="button"
                  title="替换素材"
                  className="nodrag nopan absolute top-2 right-2 z-30 flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-zinc-600 bg-zinc-800 text-zinc-100 opacity-0 shadow-lg transition-[opacity,colors] group-hover:opacity-100 hover:border-zinc-300 hover:bg-zinc-700"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                >
                  <Upload className="h-5 w-5" strokeWidth={2} />
                </button>
              ) : null}
            </>
          )}
        </div>

        <button
          type="button"
          className="nodrag nopan absolute right-2 bottom-2 z-30 flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-zinc-100 ring-1 ring-zinc-600 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-900 hover:ring-red-600"
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.();
          }}
          title={isGenSpill ? "移除结果卡片" : "删除节点"}
        >
          <Trash2 className="h-4 w-4" strokeWidth={2} />
        </button>

        {!isGenSpill ? (
          <MagneticHandleSource
            id="output"
            pinX={frameW}
            pinY={height / 2}
            magneticVisible={magneticReveal}
            visualOffsetX={0}
          />
        ) : null}
      </div>

      {!isGenSpill ? (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            if (!f) return;
            onLoadImage?.(f);
            e.currentTarget.value = "";
          }}
        />
      ) : null}

      {displayExpandedSrc ? (
        <div
          className="nopan nodrag fixed inset-0 z-[90] flex items-center justify-center bg-zinc-950/90 p-2 sm:p-3"
          onClick={() => setExpandedSrc(null)}
        >
          <div
            className="relative max-h-[calc(100vh-16px)] max-w-[calc(100vw-16px)]"
            onClick={(e) => e.stopPropagation()}
          >
            {isVideo ? (
              <div className="relative flex h-[min(85vh,calc(100vh-48px))] w-[min(92vw,calc(100vw-24px))] max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl">
                <button
                  type="button"
                  aria-label="关闭"
                  className="absolute right-2 top-2 z-[25] flex h-10 w-10 items-center justify-center rounded-full bg-zinc-950/90 text-zinc-100 ring-1 ring-zinc-600 backdrop-blur-sm transition-colors hover:bg-zinc-800 hover:ring-zinc-500"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedSrc(null);
                  }}
                >
                  <X className="h-5 w-5" strokeWidth={2} />
                </button>
                <CanvasMaterialVideo src={displayExpandedSrc} objectFit="contain" surfaceAction="togglePlay" />
              </div>
            ) : (
              <div className="relative inline-block">
                <button
                  type="button"
                  aria-label="关闭"
                  className="absolute right-2 top-2 z-[25] flex h-10 w-10 items-center justify-center rounded-full bg-zinc-950/90 text-zinc-100 ring-1 ring-zinc-600 backdrop-blur-sm transition-colors hover:bg-zinc-800 hover:ring-zinc-500"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedSrc(null);
                  }}
                >
                  <X className="h-5 w-5" strokeWidth={2} />
                </button>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={displayExpandedSrc}
                  alt=""
                  draggable={false}
                  className="max-h-[calc(100vh-16px)] max-w-[calc(100vw-16px)] object-contain shadow-none outline-none ring-0"
                />
              </div>
            )}
          </div>
        </div>
      ) : null}

    </div>
  );
}
