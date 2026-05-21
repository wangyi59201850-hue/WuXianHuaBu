"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type MediaKind = "image" | "video";

type MediaFacts = {
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
};

function formatBytes(sizeBytes: number | null) {
  if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes < 0) return "--";
  const units = ["B", "KB", "MB", "GB"];
  let value = sizeBytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const fixed = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(fixed)} ${units[unitIndex]}`;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x || 1;
}

function formatAspectRatio(width: number | null, height: number | null) {
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  const d = gcd(width, height);
  return `${Math.round(width / d)}:${Math.round(height / d)}`;
}

function formatDateTime(timestamp: number | null | undefined) {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp <= 0) return "--";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString("zh-CN");
  }
}

function inferFileNameFromUrl(url: string) {
  const raw = url.trim();
  if (!raw) return "未命名";
  try {
    const parsed = new URL(raw, "http://localhost");
    const fromQuery = parsed.searchParams.get("name")?.trim();
    if (fromQuery) return fromQuery;
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    return last || "未命名";
  } catch {
    const last = raw.split(/[?#]/)[0]?.split("/").filter(Boolean).pop();
    return last || "未命名";
  }
}

async function probeImageDimensions(src: string) {
  return await new Promise<{ width: number | null; height: number | null }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || null, height: img.naturalHeight || null });
    img.onerror = () => resolve({ width: null, height: null });
    img.src = src;
  });
}

async function probeVideoDimensions(src: string) {
  return await new Promise<{ width: number | null; height: number | null }>((resolve) => {
    const video = document.createElement("video");
    const cleanup = () => {
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
    };
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      const width = video.videoWidth || null;
      const height = video.videoHeight || null;
      cleanup();
      resolve({ width, height });
    };
    video.onerror = () => {
      cleanup();
      resolve({ width: null, height: null });
    };
    video.src = src;
  });
}

async function probeSizeBytes(src: string) {
  try {
    const head = await fetch(src, { method: "HEAD", cache: "no-store" });
    const contentLength = head.headers.get("content-length");
    if (contentLength) {
      const parsed = Number(contentLength);
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
  } catch {
    /* ignore */
  }
  try {
    const resp = await fetch(src, { cache: "no-store" });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return blob.size;
  } catch {
    return null;
  }
}

async function probeMediaFacts(src: string, kind: MediaKind): Promise<MediaFacts> {
  const [sizeBytes, dimensions] = await Promise.all([
    probeSizeBytes(src),
    kind === "video" ? probeVideoDimensions(src) : probeImageDimensions(src),
  ]);
  return {
    sizeBytes,
    width: dimensions.width,
    height: dimensions.height,
  };
}

export function GeneratedMediaPreviewModal({
  mediaUrl,
  mediaKind,
  promptText,
  modelLabel,
  ratioLabel,
  resolutionLabel,
  generatedAt,
  onClose,
  children,
}: {
  mediaUrl: string;
  mediaKind: MediaKind;
  promptText?: string | null;
  modelLabel?: string | null;
  ratioLabel?: string | null;
  resolutionLabel?: string | null;
  generatedAt?: number | null;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [portalReady, setPortalReady] = useState(false);
  const [facts, setFacts] = useState<MediaFacts>({
    width: null,
    height: null,
    sizeBytes: null,
  });
  const [factsLoading, setFactsLoading] = useState(true);

  useEffect(() => {
    setPortalReady(true);
    return () => setPortalReady(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setFactsLoading(true);
    setFacts({
      width: null,
      height: null,
      sizeBytes: null,
    });
    void probeMediaFacts(mediaUrl, mediaKind)
      .then((next) => {
        if (cancelled) return;
        setFacts(next);
      })
      .catch(() => {
        if (cancelled) return;
        setFacts({
          width: null,
          height: null,
          sizeBytes: null,
        });
      })
      .finally(() => {
        if (cancelled) return;
        setFactsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mediaKind, mediaUrl]);

  const actualRatio = useMemo(
    () => formatAspectRatio(facts.width, facts.height),
    [facts.height, facts.width]
  );
  const ratioDisplay = actualRatio || (ratioLabel?.trim() ? ratioLabel.trim() : "--");
  const resolutionDisplay =
    typeof facts.width === "number" &&
    typeof facts.height === "number" &&
    facts.width > 0 &&
    facts.height > 0
      ? `${facts.width} × ${facts.height}px`
      : factsLoading
        ? "读取中..."
        : "--";
  const sizeDisplay = factsLoading ? "读取中..." : formatBytes(facts.sizeBytes);
  const fileName = inferFileNameFromUrl(mediaUrl);

  if (!portalReady || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="pointer-events-auto fixed inset-0 z-[90] flex items-center justify-center bg-zinc-950/92 p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        className="relative flex h-[min(92vh,calc(100vh-24px))] w-[min(98vw,1640px)] flex-col overflow-hidden rounded-[24px] border border-white/10 bg-zinc-950 shadow-[0_28px_80px_rgba(0,0,0,0.52)] lg:flex-row"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label="关闭预览"
          className="absolute right-3 top-3 z-[30] flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-zinc-950/88 text-zinc-100 backdrop-blur-sm transition-colors hover:bg-zinc-800"
          onClick={onClose}
        >
          <X className="h-5 w-5" strokeWidth={2} />
        </button>

        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black/30 p-4 sm:p-6 lg:p-8">
          {children}
        </div>

        <aside className="flex w-full shrink-0 flex-col border-t border-white/8 bg-zinc-900/92 lg:w-[220px] lg:border-l lg:border-t-0 xl:w-[240px]">
          <div className="border-b border-white/8 px-5 py-4">
            <div className="text-sm font-semibold text-white">素材信息</div>
            <div className="mt-1 text-xs text-zinc-500">{mediaKind === "video" ? "视频预览" : "图片预览"}</div>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div className="space-y-2">
              <div className="text-[11px] font-medium text-zinc-500">提示词</div>
              <div className="max-h-[180px] overflow-y-auto whitespace-pre-wrap rounded-2xl border border-white/8 bg-black/20 px-3 py-3 text-sm leading-6 text-zinc-100">
                {promptText && promptText.trim() ? promptText.trim() : "未记录"}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-black/20 px-3 py-2.5">
                <span className="text-[11px] text-zinc-500">模型</span>
                <span className="max-w-[68%] break-all text-right text-sm text-zinc-100">
                  {modelLabel && modelLabel.trim() ? modelLabel.trim() : "暂无"}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-black/20 px-3 py-2.5">
                <span className="text-[11px] text-zinc-500">分辨率</span>
                <span className="text-right text-sm text-zinc-100">{resolutionDisplay}</span>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-black/20 px-3 py-2.5">
                <span className="text-[11px] text-zinc-500">比例</span>
                <span className="text-right text-sm text-zinc-100">{ratioDisplay}</span>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-black/20 px-3 py-2.5">
                <span className="text-[11px] text-zinc-500">尺寸档位</span>
                <span className="text-right text-sm text-zinc-100">
                  {resolutionLabel && resolutionLabel.trim() ? resolutionLabel.trim() : "--"}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-black/20 px-3 py-2.5">
                <span className="text-[11px] text-zinc-500">文件大小</span>
                <span className="text-right text-sm text-zinc-100">{sizeDisplay}</span>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-black/20 px-3 py-2.5">
                <span className="text-[11px] text-zinc-500">日期</span>
                <span className="text-right text-sm text-zinc-100">{formatDateTime(generatedAt)}</span>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-black/20 px-3 py-2.5">
                <span className="text-[11px] text-zinc-500">文件名</span>
                <span className="max-w-[68%] break-all text-right text-sm text-zinc-100">{fileName}</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>,
    document.body
  );
}
