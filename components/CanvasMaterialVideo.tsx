"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import {
  isLocalBridgeMediaUrl,
  useLocalBridgeMediaUrl,
} from "@/lib/localBridgeMedia";

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type Props = {
  src: string;
  className?: string;
  objectFit?: "cover" | "contain";
  /** 较矮控件，用于节点内小块预览 */
  compact?: boolean;
  /** 为 false 时不显示底部自定义条（仅保留点击区域行为），用于极窄素材条 */
  showControls?: boolean;
  surfaceAction?: "expand" | "togglePlay" | "none";
  onSurfaceAction?: () => void;
  onMediaError?: () => void;
  /** 挂载/卸载时传出内部 `<video>`，用于多实例间同步进度 */
  videoRefCallback?: (el: HTMLVideoElement | null) => void;
  /** 首次可播放时尝试自动播放（静音策略仍由 muted 状态决定） */
  autoPlayWhenReady?: boolean;
  /** 为 true 时强制暂停（例如已打开全屏放大层，避免双路声音） */
  suspendPlayback?: boolean;
  /** 若提供，单击画面时优先调用（用于打开节点文本面板等），不再执行 expand/togglePlay */
  onSurfaceClick?: (e: React.MouseEvent) => void;
  /** 双击画面（如 Prompt 预览内放大）；与 surfaceAction=expand 并存时优先本回调 */
  onSurfaceDoubleClick?: (e: React.MouseEvent) => void;
  /** 进度条右侧放大/收缩：false=显示放大，true=显示收缩（如已处于全屏层） */
  toolbarExpandExpanded?: boolean;
  /** 点击进度条旁放大图标时回调（由父级切换全屏层） */
  onToolbarExpandToggle?: () => void;
};

type Slot = 0 | 1;

export function CanvasMaterialVideo({
  src,
  className = "",
  objectFit = "cover",
  compact = false,
  showControls = true,
  surfaceAction = "togglePlay",
  onSurfaceAction,
  onMediaError,
  videoRefCallback,
  autoPlayWhenReady = false,
  suspendPlayback = false,
  onSurfaceClick,
  onSurfaceDoubleClick,
  toolbarExpandExpanded = false,
  onToolbarExpandToggle,
}: Props) {
  const bridgeResolvedSrc = useLocalBridgeMediaUrl(src);
  const resolvedSrc =
    bridgeResolvedSrc || (isLocalBridgeMediaUrl(src) ? "" : src);
  const videoRefA = useRef<HTMLVideoElement | null>(null);
  const videoRefB = useRef<HTMLVideoElement | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const seekDraggingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [muted, setMuted] = useState(true);

  /** 双缓冲：换 src 时在非可见槽预加载，避免单 video 换源闪黑 */
  const [activeSlot, setActiveSlot] = useState<Slot>(0);
  const [slotUrls, setSlotUrls] = useState<[string, string]>(() => [resolvedSrc, ""]);

  const srcRef = useRef(src);
  const activeSlotRef = useRef(activeSlot);
  const slotUrlsRef = useRef(slotUrls);

  const loadGenRef = useRef(0);
  const pendingRef = useRef<{ gen: number; slot: Slot; target: string } | null>(null);
  const slotRecoverCountRef = useRef<[number, number]>([0, 0]);

  useEffect(() => {
    srcRef.current = resolvedSrc;
    activeSlotRef.current = activeSlot;
    slotUrlsRef.current = slotUrls;
  }, [resolvedSrc, activeSlot, slotUrls]);

  const getActiveEl = useCallback(() => (activeSlot === 0 ? videoRefA.current : videoRefB.current), [activeSlot]);
  const getSlotEl = useCallback((slot: Slot) => (slot === 0 ? videoRefA.current : videoRefB.current), []);

  const recoverSlot = useCallback(
    (slot: Slot) => {
      const el = getSlotEl(slot);
      const url = slotUrlsRef.current[slot]?.trim();
      if (!el || !url) return;
      const counts = slotRecoverCountRef.current;
      counts[slot] += 1;
      if (counts[slot] > 2) {
        counts[slot] = 0;
        pendingRef.current = null;
        onMediaError?.();
        return;
      }
      try {
        el.pause();
        el.load();
        if (slot === activeSlotRef.current && !suspendPlayback && autoPlayWhenReady) {
          window.setTimeout(() => {
            void el.play().catch(() => {});
          }, 120);
        }
      } catch {
        onMediaError?.();
      }
    },
    [autoPlayWhenReady, getSlotEl, onMediaError, suspendPlayback]
  );

  const commitActiveSlot = useCallback(
    (slot: Slot) => {
      pendingRef.current = null;
      slotRecoverCountRef.current[slot] = 0;
      setActiveSlot(slot);
      const other: Slot = slot === 0 ? 1 : 0;
      (other === 0 ? videoRefA.current : videoRefB.current)?.pause();
      const el = slot === 0 ? videoRefA.current : videoRefB.current;
      if (el && !suspendPlayback && autoPlayWhenReady) {
        void el.play().catch(() => {});
      }
    },
    [autoPlayWhenReady, suspendPlayback]
  );

  useEffect(() => {
    const t = resolvedSrc.trim();
    if (!t) {
      loadGenRef.current += 1;
      pendingRef.current = null;
      const raf = window.requestAnimationFrame(() => {
        setSlotUrls(["", ""]);
        setActiveSlot(0);
      });
      videoRefA.current?.pause();
      videoRefB.current?.pause();
      return () => window.cancelAnimationFrame(raf);
    }

    const vis = activeSlotRef.current === 0 ? slotUrlsRef.current[0] : slotUrlsRef.current[1];
    if (t === vis) {
      pendingRef.current = null;
      return;
    }

    const inactive: Slot = activeSlotRef.current === 0 ? 1 : 0;
    const inactiveUrl =
      (inactive === 0 ? slotUrlsRef.current[0] : slotUrlsRef.current[1]).trim();
    /**
     * 双缓冲复用：非可见槽里已是目标 URL 时，改 state 不会触发新 load → 没有 canplay。
     * 典型：A→B→A 设主显，主预览会卡在 B；须立刻切 active。
     */
    if (inactiveUrl === t) {
      loadGenRef.current += 1;
      const raf = window.requestAnimationFrame(() => {
        commitActiveSlot(inactive);
      });
      return () => window.cancelAnimationFrame(raf);
    }

    const gen = ++loadGenRef.current;
    pendingRef.current = { gen, slot: inactive, target: t };
    const raf = window.requestAnimationFrame(() => {
      setSlotUrls((prev) => {
        const next: [string, string] = [prev[0], prev[1]];
        next[inactive] = t;
        return next;
      });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [resolvedSrc, commitActiveSlot]);

  const onSlotCanPlay = useCallback(
    (slot: Slot) => {
      slotRecoverCountRef.current[slot] = 0;
      const p = pendingRef.current;
      const want = srcRef.current.trim();
      if (!want || !p || p.slot !== slot || p.target !== want) return;
      if (p.gen !== loadGenRef.current) return;

      commitActiveSlot(slot);
    },
    [commitActiveSlot]
  );

  const onSlotError = useCallback(
    (slot: Slot) => {
      const p = pendingRef.current;
      if (p && p.slot === slot) {
        pendingRef.current = null;
        loadGenRef.current += 1;
      }
      onMediaError?.();
    },
    [onMediaError]
  );

  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    const timeout = window.setTimeout(() => {
      const latest = pendingRef.current;
      if (!latest) return;
      if (latest.gen !== pending.gen || latest.slot !== pending.slot || latest.target !== pending.target) {
        return;
      }
      recoverSlot(pending.slot);
    }, 6500);
    return () => window.clearTimeout(timeout);
  }, [slotUrls, activeSlot, recoverSlot]);

  useEffect(() => {
    const a = videoRefA.current;
    const b = videoRefB.current;
    for (const v of [a, b]) {
      if (!v) continue;
      v.muted = muted;
      if (!muted && v.volume === 0) v.volume = 1;
    }
  }, [muted]);

  useEffect(() => {
    const el = getActiveEl();
    videoRefCallback?.(el ?? null);
    return () => {
      videoRefCallback?.(null);
    };
  }, [videoRefCallback, activeSlot, slotUrls, getActiveEl]);

  useEffect(() => {
    const a = videoRefA.current;
    const b = videoRefB.current;
    if (suspendPlayback) {
      a?.pause();
      b?.pause();
      return;
    }
    if (!autoPlayWhenReady) return;
    const el = getActiveEl();
    if (!el) return;
    const tryPlay = () => {
      void el.play().catch(() => {});
    };
    if (el.readyState >= 2) tryPlay();
    else el.addEventListener("canplay", tryPlay, { once: true });
    return () => el.removeEventListener("canplay", tryPlay);
  }, [activeSlot, slotUrls, autoPlayWhenReady, suspendPlayback, getActiveEl]);

  useEffect(() => {
    const el = getActiveEl();
    if (!el) {
      const raf = window.requestAnimationFrame(() => {
        setDuration(0);
        setCurrent(0);
        setPlaying(false);
      });
      return () => window.cancelAnimationFrame(raf);
    }
    const onMeta = () => setDuration(el.duration || 0);
    const onTime = () => setCurrent(el.currentTime || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onVolume = () => setMuted(el.muted);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("volumechange", onVolume);
    onMeta();
    onTime();
    onVolume();
    return () => {
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("volumechange", onVolume);
    };
  }, [activeSlot, slotUrls, getActiveEl]);

  const togglePlay = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const v = getActiveEl();
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  }, [getActiveEl]);

  const toggleMute = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const v = getActiveEl();
    if (!v) return;
    if (v.muted) {
      v.volume = 1;
      v.muted = false;
      setMuted(false);
    } else {
      v.muted = true;
      setMuted(true);
    }
  }, [getActiveEl]);

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      const v = getActiveEl();
      if (!el || !v || !duration) return;
      const r = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)));
      v.currentTime = x * duration;
    },
    [duration, getActiveEl]
  );

  const onTrackPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      seekDraggingRef.current = true;
      trackRef.current?.setPointerCapture(e.pointerId);
      seekFromClientX(e.clientX);
    },
    [seekFromClientX]
  );

  const onTrackPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!seekDraggingRef.current) return;
      seekFromClientX(e.clientX);
    },
    [seekFromClientX]
  );

  const onTrackPointerEnd = useCallback((e: React.PointerEvent) => {
    if (!seekDraggingRef.current) return;
    seekDraggingRef.current = false;
    try {
      trackRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const pct = duration > 0 ? (current / duration) * 100 : 0;

  const playBtnClass = compact ? "min-h-9 min-w-9 rounded-lg" : "min-h-11 min-w-11 rounded-xl";
  const playIconClass = compact ? "h-5 w-5" : "h-6 w-6";
  const volBtnClass = compact ? "min-h-9 min-w-9 rounded-lg" : "min-h-11 min-w-11 rounded-xl";
  const volIconClass = compact ? "h-4 w-4" : "h-5 w-5";

  const fitClass = objectFit === "contain" ? "object-contain" : "object-cover";

  const renderSlot = (slot: Slot) => {
    const u = slotUrls[slot].trim();
    const isTop = activeSlot === slot;
    return (
      <video
        key={slot}
        ref={(el) => {
          if (slot === 0) (videoRefA as React.MutableRefObject<HTMLVideoElement | null>).current = el;
          else (videoRefB as React.MutableRefObject<HTMLVideoElement | null>).current = el;
        }}
        src={u || undefined}
        muted={muted}
        controls={false}
        disablePictureInPicture
        playsInline
        preload="auto"
        loop
        className={`pointer-events-none absolute inset-0 h-full w-full ${fitClass} ${isTop ? "z-[1] opacity-100" : "z-0 opacity-0"}`}
        onCanPlay={() => onSlotCanPlay(slot)}
        onStalled={() => recoverSlot(slot)}
        onEmptied={() => recoverSlot(slot)}
        onError={() => onSlotError(slot)}
      />
    );
  };

  return (
    <div
      className={`group/vid relative flex h-full min-h-0 w-full flex-col bg-zinc-900 outline-none ${className}`.trim()}
    >
      <div className="relative min-h-0 flex-1">
        <div
          className="relative z-0 h-full min-h-0 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            if (onSurfaceClick) {
              onSurfaceClick(e);
              return;
            }
            if (surfaceAction === "expand") {
              onSurfaceAction?.();
              return;
            }
            if (surfaceAction === "togglePlay") {
              const v = getActiveEl();
              if (!v) return;
              if (v.paused) void v.play().catch(() => {});
              else v.pause();
            }
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (onSurfaceDoubleClick) {
              onSurfaceDoubleClick(e);
              return;
            }
            if (surfaceAction === "expand") {
              onSurfaceAction?.();
            }
          }}
        >
          <div className="absolute inset-0 overflow-hidden">
            {renderSlot(0)}
            {renderSlot(1)}
          </div>
        </div>

        {showControls ? (
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-[2] opacity-0 transition-opacity duration-200 ease-out group-hover/vid:opacity-100 group-focus-within/vid:opacity-100">
            <div className="pointer-events-none bg-gradient-to-t from-black/55 via-black/20 to-transparent px-2 pb-1.5 pt-10">
              <div
                className="pointer-events-none flex items-center gap-2 group-hover/vid:pointer-events-auto group-focus-within/vid:pointer-events-auto"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className={`flex shrink-0 items-center justify-center text-white/95 drop-shadow-md backdrop-blur-[2px] transition-colors hover:text-white ${playBtnClass}`}
                  aria-label={playing ? "暂停" : "播放"}
                  onClick={togglePlay}
                >
                  {playing ? (
                    <Pause className={playIconClass} strokeWidth={2.2} />
                  ) : (
                    <Play className={playIconClass} strokeWidth={2.2} />
                  )}
                </button>
                <div
                  ref={trackRef}
                  role="slider"
                  tabIndex={0}
                  aria-valuenow={Math.round(pct)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-1 min-h-[4px] min-w-0 flex-1 cursor-pointer rounded-full bg-white/30 shadow-inner backdrop-blur-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    seekFromClientX(e.clientX);
                  }}
                  onPointerDown={onTrackPointerDown}
                  onPointerMove={onTrackPointerMove}
                  onPointerUp={onTrackPointerEnd}
                  onPointerCancel={onTrackPointerEnd}
                  onKeyDown={(e) => {
                    const v = getActiveEl();
                    if (!v || !duration) return;
                    if (e.key === "ArrowLeft") {
                      e.preventDefault();
                      v.currentTime = Math.max(0, v.currentTime - 5);
                    } else if (e.key === "ArrowRight") {
                      e.preventDefault();
                      v.currentTime = Math.min(duration, v.currentTime + 5);
                    }
                  }}
                >
                  <div
                    className="pointer-events-none h-full rounded-full bg-white/90 shadow-[0_0_6px_rgba(255,255,255,0.35)]"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {onToolbarExpandToggle ? (
                  <button
                    type="button"
                    className={`flex shrink-0 items-center justify-center text-white/90 drop-shadow-md transition-colors hover:text-white ${compact ? "min-h-9 min-w-9 rounded-lg" : "min-h-11 min-w-11 rounded-xl"}`}
                    aria-label={toolbarExpandExpanded ? "退出放大" : "放大预览"}
                    title={toolbarExpandExpanded ? "退出放大" : "放大预览"}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToolbarExpandToggle();
                    }}
                  >
                    {toolbarExpandExpanded ? (
                      <Minimize2 className={volIconClass} strokeWidth={2.2} />
                    ) : (
                      <Maximize2 className={volIconClass} strokeWidth={2.2} />
                    )}
                  </button>
                ) : null}
                <span
                  className={`shrink-0 tabular-nums text-white/85 drop-shadow ${compact ? "text-[9px]" : "text-[11px]"}`}
                >
                  {formatTime(current)} / {formatTime(duration)}
                </span>
                <button
                  type="button"
                  className={`flex shrink-0 items-center justify-center text-white/90 drop-shadow-md transition-colors hover:text-white ${volBtnClass}`}
                  aria-label={muted ? "打开声音" : "静音"}
                  onClick={toggleMute}
                >
                  {muted ? (
                    <VolumeX className={volIconClass} strokeWidth={2.2} />
                  ) : (
                    <Volume2 className={volIconClass} strokeWidth={2.2} />
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
