"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CanvasMaterialVideo } from "@/components/CanvasMaterialVideo";
import {
  isLocalBridgeMediaUrl,
  useLocalBridgeMediaUrl,
} from "@/lib/localBridgeMedia";

type AnchorRect = Pick<DOMRect, "left" | "top" | "width">;

/**
 * 悬停在素材小缩略图上时，在其上方显示放大预览（fixed + portal，不受条形容器 overflow 裁剪）
 */
export function MaterialThumbHoverPreview({
  url,
  isVideo,
  anchorRect,
  visible,
}: {
  url: string;
  isVideo?: boolean;
  anchorRect: AnchorRect | null;
  visible: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  const bridgeResolvedUrl = useLocalBridgeMediaUrl(url);
  const resolvedUrl =
    bridgeResolvedUrl || (isLocalBridgeMediaUrl(url) ? "" : url);
  useEffect(() => setMounted(true), []);

  if (!mounted || !visible || !anchorRect || !resolvedUrl) return null;

  const cx = anchorRect.left + anchorRect.width / 2;
  const top = anchorRect.top;

  const shell = (
    <div
      className={[
        "fixed z-[300] max-h-[min(280px,37vh)] max-w-[min(348px,55vw)] overflow-hidden rounded-xl border border-zinc-600 bg-zinc-800 shadow-[0_12px_40px_rgba(0,0,0,0.55)]",
        isVideo ? "pointer-events-auto" : "pointer-events-none",
      ].join(" ")}
      style={{
        left: cx,
        top,
        transform: "translate(-50%, calc(-100% - 10px))",
      }}
    >
      {isVideo ? (
        <div className="h-[min(280px,37vh)] w-[min(348px,55vw)] min-h-[120px]">
          <CanvasMaterialVideo
            src={resolvedUrl}
            className="h-full min-h-0 w-full"
            objectFit="contain"
            compact
            surfaceAction="togglePlay"
          />
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={resolvedUrl}
          alt=""
          className="block max-h-[min(280px,37vh)] max-w-[min(348px,55vw)] object-contain"
          draggable={false}
        />
      )}
    </div>
  );

  return createPortal(shell, document.body);
}

export function useThumbHoverPreviewState() {
  const [preview, setPreview] = useState<{
    thumbId: string;
    url: string;
    isVideo: boolean;
    rect: AnchorRect;
  } | null>(null);

  const bindHandlers = (thumbId: string, url: string, isVideo: boolean, dragging: boolean) => ({
    onPointerEnter: (e: React.PointerEvent) => {
      if (dragging || !url) return;
      if ((e.target as HTMLElement).closest("button")) return;
      const el = e.currentTarget as HTMLElement;
      const r = el.getBoundingClientRect();
      setPreview({
        thumbId,
        url,
        isVideo,
        rect: { left: r.left, top: r.top, width: r.width },
      });
    },
    onPointerLeave: () => setPreview(null),
    onPointerDownCapture: (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      setPreview(null);
    },
  });

  return { preview, setPreview, bindHandlers };
}
