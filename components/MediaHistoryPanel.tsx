"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckSquare,
  Download,
  Film,
  Image as ImageIcon,
  Pencil,
  RefreshCw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type { GenerationHistoryEntry } from "@/lib/generationHistoryTypes";
import { captureVideoPosterDataUrl } from "@/lib/videoPosterCapture";
import { batchDownloadAssets } from "@/lib/desktopBatchDownload";
import {
  HISTORY_ENTRY_DRAG_MIME,
  type HistoryEntryDragPayload,
} from "@/lib/historyEntryDrag";

function stripHashOnly(value: string) {
  const text = value.trim();
  const i = text.indexOf("#");
  return i >= 0 ? text.slice(0, i) : text;
}

function dateKeyLabel(ms: number) {
  try {
    const d = new Date(ms);
    return d.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return "\u672a\u77e5\u65e5\u671f";
  }
}

function groupByDate(entries: GenerationHistoryEntry[]) {
  const map = new Map<string, GenerationHistoryEntry[]>();
  for (const entry of entries) {
    const key = dateKeyLabel(entry.createdAt);
    const arr = map.get(key) ?? [];
    arr.push(entry);
    map.set(key, arr);
  }
  return Array.from(map.entries());
}

async function downloadEntries(entries: GenerationHistoryEntry[]) {
  return batchDownloadAssets(
    entries.map((entry) => ({
      url: stripHashOnly(entry.outputUrl),
      fileName: entry.fileName || "media",
      mediaType: entry.mediaType,
    }))
  );
}

type Tab = "image" | "video";
type SelectionRect = { left: number; top: number; width: number; height: number } | null;
type DeleteConfirmState = {
  entries: GenerationHistoryEntry[];
} | null;

export function MediaHistoryPanel(props: {
  open: boolean;
  onClose: () => void;
  onLoadToCanvas: (entry: GenerationHistoryEntry) => void;
  onLoadManyToCanvas?: (entries: GenerationHistoryEntry[]) => void;
  variant?: "sheet" | "embedded";
}) {
  const { open, onClose, onLoadToCanvas, onLoadManyToCanvas, variant = "sheet" } = props;
  const [tab, setTab] = useState<Tab>("image");
  const [entries, setEntries] = useState<GenerationHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [hoverPreviewId, setHoverPreviewId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedEntry, setExpandedEntry] = useState<GenerationHistoryEntry | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [selectionRect, setSelectionRect] = useState<SelectionRect>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragSelectRef = useRef<null | { startX: number; startY: number }>(null);

  const filtered = useMemo(
    () =>
      entries.filter((entry) =>
        tab === "image" ? entry.mediaType === "image" : entry.mediaType === "video"
      ),
    [entries, tab]
  );

  const grouped = useMemo(() => groupByDate(filtered), [filtered]);
  const selectedEntries = useMemo(
    () => filtered.filter((entry) => selectedIds.includes(entry.id)),
    [filtered, selectedIds]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/generation-history");
      const json = (await res.json()) as { entries?: GenerationHistoryEntry[]; error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setEntries(Array.isArray(json.entries) ? json.entries : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => filtered.some((entry) => entry.id === id)));
  }, [filtered]);

  useEffect(() => {
    const videos = Array.from(
      document.querySelectorAll<HTMLVideoElement>("[data-history-video-id]")
    );
    for (const video of videos) {
      const id = video.dataset.historyVideoId;
      if (!id) continue;
      if (hoverPreviewId === id) {
        video.currentTime = 0;
        void video.play().catch(() => {});
      } else {
        video.pause();
        video.currentTime = 0;
      }
    }
  }, [hoverPreviewId, filtered]);

  useEffect(() => {
    if (!open) return;
    const pending = filtered
      .filter((entry) => entry.mediaType === "video" && !entry.posterUrl)
      .slice(0, 6);
    if (pending.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const entry of pending) {
        if (cancelled) return;
        const posterDataUrl = await captureVideoPosterDataUrl(stripHashOnly(entry.outputUrl), {
          width: 640,
          quality: 0.8,
          timeoutMs: 7000,
        }).catch(() => null);
        if (!posterDataUrl || cancelled) continue;
        const res = await fetch("/api/generation-history/poster", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ outputUrl: entry.outputUrl, posterDataUrl }),
        }).catch(() => null);
        if (!res || !res.ok || cancelled) continue;
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; posterUrl?: string }
          | null;
        if (!json?.ok || typeof json.posterUrl !== "string") continue;
        setEntries((prev) =>
          prev.map((row) => (row.id === entry.id ? { ...row, posterUrl: json.posterUrl! } : row))
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filtered, open]);

  const toggleSelect = useCallback((id: string, multi: boolean) => {
    setSelectedIds((prev) => {
      if (!multi) {
        return prev.length === 1 && prev[0] === id ? [] : [id];
      }
      return prev.includes(id) ? prev.filter((entryId) => entryId !== id) : [...prev, id];
    });
  }, []);

  const deleteEntries = useCallback(async (targets: GenerationHistoryEntry[]) => {
    if (targets.length === 0) return;
    setDeleteBusy(true);
    setError(null);
    try {
      for (const entry of targets) {
        const res = await fetch("/api/generation-history", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: entry.id, mode: "purge" }),
        });
        const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
        if (!res.ok || !json?.ok) {
          throw new Error(json?.error || `HTTP ${res.status}`);
        }
      }
      setEntries((prev) =>
        prev.filter((entry) => !targets.some((target) => target.id === entry.id))
      );
      setSelectedIds((prev) =>
        prev.filter((id) => !targets.some((target) => target.id === id))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleteBusy(false);
    }
  }, []);

  const referencedDeleteTargets = useMemo(
    () =>
      (deleteConfirm?.entries ?? []).filter(
        (entry) => entry.referencedInCurrentCanvas || (entry.referenceCount ?? 0) > 0
      ),
    [deleteConfirm]
  );

  const beginBoxSelect = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button,video,img,[data-history-card]")) return;
    dragSelectRef.current = { startX: event.clientX, startY: event.clientY };
    setSelectionRect({ left: event.clientX, top: event.clientY, width: 0, height: 0 });
  }, []);

  useEffect(() => {
    if (!selectionRect || !dragSelectRef.current) return;
    const onMove = (event: PointerEvent) => {
      const start = dragSelectRef.current;
      if (!start) return;
      const left = Math.min(start.startX, event.clientX);
      const top = Math.min(start.startY, event.clientY);
      const width = Math.abs(event.clientX - start.startX);
      const height = Math.abs(event.clientY - start.startY);
      const rect = { left, top, width, height };
      setSelectionRect(rect);
      const nextIds: string[] = [];
      for (const entry of filtered) {
        const el = cardRefs.current.get(entry.id);
        if (!el) continue;
        const box = el.getBoundingClientRect();
        const hit =
          rect.left <= box.right &&
          rect.left + rect.width >= box.left &&
          rect.top <= box.bottom &&
          rect.top + rect.height >= box.top;
        if (hit) nextIds.push(entry.id);
      }
      setSelectedIds(nextIds);
    };
    const onUp = () => {
      dragSelectRef.current = null;
      setSelectionRect(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [filtered, selectionRect]);

  const handleCardDragStart = useCallback(
    (entry: GenerationHistoryEntry, event: React.DragEvent<HTMLDivElement>) => {
      const payload: HistoryEntryDragPayload = { id: entry.id };
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData(HISTORY_ENTRY_DRAG_MIME, JSON.stringify(payload));
      event.dataTransfer.setData("text/plain", entry.fileName || entry.id);
    },
    []
  );

  if (!open) return null;
  const embedded = variant === "embedded";

  return (
    <div
      className={
        embedded
          ? "relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[16px]"
          : "fixed inset-0 z-[60] flex items-end bg-black/35 backdrop-blur-[2px]"
      }
    >
      {!embedded ? (
        <button
          type="button"
          className="absolute inset-0"
          aria-label="\u5173\u95ed"
          onClick={onClose}
        />
      ) : null}
      <div
        className={
          embedded
            ? "relative z-10 flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-[16px]"
            : "relative z-10 flex h-[84vh] w-full flex-col border-t border-white/10 bg-zinc-950/72 shadow-2xl backdrop-blur-xl"
        }
      >
        <div className="flex items-center justify-between border-b border-white/8 px-3 py-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-medium text-white">{"\u5386\u53f2\u7d20\u6750"}</h2>
            {selectedEntries.length > 0 ? (
              <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[11px] text-zinc-100">
                {`\u5df2\u9009 ${selectedEntries.length}`}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            {selectedEntries.length > 0 ? (
              <>
                <button
                  type="button"
                  className="rounded-lg p-2 text-zinc-300 hover:bg-white/5 hover:text-white"
                  title="载入选中素材到画布"
                  onClick={() => {
                    if (selectedEntries.length === 0) return;
                    if (onLoadManyToCanvas) {
                      onLoadManyToCanvas(selectedEntries);
                      return;
                    }
                    for (const entry of selectedEntries) onLoadToCanvas(entry);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="rounded-lg p-2 text-zinc-300 hover:bg-white/5 hover:text-white"
                  title="\u4e0b\u8f7d\u9009\u4e2d\u7d20\u6750"
                  onClick={() => {
                    void downloadEntries(selectedEntries);
                  }}
                >
                  <Download className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="rounded-lg p-2 text-zinc-300 hover:bg-white/5 hover:text-white disabled:opacity-50"
                  title="\u6c38\u4e45\u5220\u9664\u9009\u4e2d\u7d20\u6750"
                  onClick={() => setDeleteConfirm({ entries: selectedEntries })}
                  disabled={deleteBusy}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-white"
              title="\u5237\u65b0"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            {!embedded ? (
              <button
                type="button"
                className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-white"
                title="\u5173\u95ed"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex border-b border-white/8 px-2 py-2">
          <button
            type="button"
            className={[
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-colors",
              tab === "image"
                ? "bg-white/12 text-zinc-100"
                : "text-zinc-400 hover:bg-white/5 hover:text-white",
            ].join(" ")}
            onClick={() => setTab("image")}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            {"\u56fe\u7247"}
          </button>
          <button
            type="button"
            className={[
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-colors",
              tab === "video"
                ? "bg-white/12 text-zinc-100"
                : "text-zinc-400 hover:bg-white/5 hover:text-white",
            ].join(" ")}
            onClick={() => setTab("video")}
          >
            <Film className="h-3.5 w-3.5" />
            {"\u89c6\u9891"}
          </button>
        </div>

        <div
          className={[
            "ui-gray-scrollbar relative min-h-0 flex-1 overflow-y-auto px-1 pb-3 pt-2",
            embedded ? "pr-1" : "px-3 pb-6 pt-3",
          ].join(" ")}
          onPointerDown={beginBoxSelect}
        >
          {selectionRect ? (
            <div
              className="pointer-events-none fixed z-[80] border border-zinc-200/70 bg-white/10"
              style={{
                left: `${selectionRect.left}px`,
                top: `${selectionRect.top}px`,
                width: `${selectionRect.width}px`,
                height: `${selectionRect.height}px`,
              }}
            />
          ) : null}

          {error ? (
            <p className="mb-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100/90">
              {error}
            </p>
          ) : null}
          {!loading && !error && filtered.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs text-zinc-500">
              {`\u6682\u65e0${tab === "image" ? "\u56fe\u7247" : "\u89c6\u9891"}\u8bb0\u5f55`}
            </p>
          ) : null}

          <div className={embedded ? "flex flex-col gap-4 pb-3" : "flex flex-col gap-5 pb-8"}>
            {grouped.map(([dateLabel, rows]) => (
              <section key={dateLabel}>
                <div className="mb-2 px-1 text-[11px] font-medium text-zinc-500">{dateLabel}</div>
                <div
                  className={
                    embedded
                      ? "grid grid-cols-1 gap-2.5"
                      : "grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3"
                  }
                >
                  {rows.map((entry) => {
                    const src = stripHashOnly(entry.outputUrl);
                    const isVideo = entry.mediaType === "video";
                    const selected = selectedIds.includes(entry.id);
                    const showHover = hoverId === entry.id;
                    return (
                      <div
                        key={entry.id}
                        ref={(el) => {
                          if (el) cardRefs.current.set(entry.id, el);
                          else cardRefs.current.delete(entry.id);
                        }}
                        data-history-card
                        draggable
                        className={[
                          "group relative cursor-grab select-none rounded-[14px] border bg-white/[0.03] p-2 transition-colors active:cursor-grabbing",
                          selected
                            ? "border-zinc-200/85 shadow-[0_0_0_1px_rgba(228,228,231,0.42)]"
                            : "border-white/8 hover:border-white/14",
                        ].join(" ")}
                        onDragStart={(event) => handleCardDragStart(entry, event)}
                        onMouseEnter={() => {
                          setHoverId(entry.id);
                          if (isVideo) setHoverPreviewId(entry.id);
                        }}
                        onMouseLeave={() => {
                          setHoverId((prev) => (prev === entry.id ? null : prev));
                          if (isVideo) {
                            setHoverPreviewId((prev) => (prev === entry.id ? null : prev));
                          }
                        }}
                        onClick={(event) =>
                          toggleSelect(entry.id, event.ctrlKey || event.metaKey || event.shiftKey)
                        }
                        onDoubleClick={() => setExpandedEntry(entry)}
                        title="\u62d6\u62fd\u5230\u753b\u5e03\u53ef\u76f4\u63a5\u7f16\u8f91"
                      >
                        <div
                          className={[
                            "relative overflow-hidden rounded-[12px] bg-black/30",
                            embedded ? "aspect-[16/9]" : "aspect-[16/10]",
                          ].join(" ")}
                        >
                          {isVideo ? (
                            <>
                              {entry.posterUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={entry.posterUrl}
                                  alt=""
                                  className="h-full w-full object-cover"
                                  draggable={false}
                                />
                              ) : null}
                              <video
                                src={src}
                                data-history-video-id={entry.id}
                                className={[
                                  "absolute inset-0 h-full w-full object-cover transition-opacity",
                                  entry.posterUrl
                                    ? hoverPreviewId === entry.id
                                      ? "opacity-100"
                                      : "opacity-0"
                                    : "opacity-100",
                                ].join(" ")}
                                muted
                                playsInline
                                preload="metadata"
                                controls={false}
                              />
                            </>
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={src}
                              alt=""
                              className="h-full w-full object-cover"
                              draggable={false}
                            />
                          )}

                          <button
                            type="button"
                            title={
                              selected
                                ? "\u53d6\u6d88\u9009\u62e9"
                                : "\u9009\u62e9\u7d20\u6750"
                            }
                            className={[
                              "absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-md border border-white/18 bg-black/45 text-white/90 shadow-sm backdrop-blur transition-all",
                              showHover || selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                            ].join(" ")}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleSelect(entry.id, true);
                            }}
                          >
                            {selected ? (
                              <CheckSquare className="h-3 w-3" />
                            ) : (
                              <Square className="h-3 w-3" />
                            )}
                          </button>
                          <button
                            type="button"
                            title="\u8f7d\u5165\u753b\u5e03"
                            className={[
                              "absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md border border-white/18 bg-black/45 text-white/90 shadow-sm backdrop-blur transition-all",
                              showHover ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                            ].join(" ")}
                            onClick={(event) => {
                              event.stopPropagation();
                              onLoadToCanvas(entry);
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            title="\u4e0b\u8f7d"
                            className={[
                              "absolute right-10 top-2 flex h-6 w-6 items-center justify-center rounded-md border border-white/18 bg-black/45 text-white/90 shadow-sm backdrop-blur transition-all",
                              showHover ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                            ].join(" ")}
                            onClick={(event) => {
                              event.stopPropagation();
                              void downloadEntries([entry]);
                            }}
                          >
                            <Download className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            title="\u6c38\u4e45\u5220\u9664"
                            className={[
                              "absolute right-[66px] top-2 hidden h-6 w-6 items-center justify-center rounded-md border border-white/18 bg-black/45 text-white/90 shadow-sm backdrop-blur transition-all sm:flex",
                              showHover ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                            ].join(" ")}
                            onClick={(event) => {
                              event.stopPropagation();
                              setDeleteConfirm({ entries: [entry] });
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                          {entry.sourceKind === "process" ? (
                            <span className="absolute bottom-2 left-2 rounded-full border border-white/12 bg-black/45 px-2 py-0.5 text-[10px] text-zinc-100 backdrop-blur">
                              {"\u7f16\u8f91\u56fe"}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex items-center justify-between gap-2 px-1 pb-0.5 pt-2 text-[11px] text-zinc-400">
                          <span className="truncate">{entry.fileName}</span>
                          <span>
                            {new Date(entry.createdAt).toLocaleTimeString("zh-CN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>

        {expandedEntry ? (
          <div
            className="pointer-events-auto fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-4"
            onClick={() => setExpandedEntry(null)}
          >
            <div
              className="relative flex max-h-[92vh] w-[min(94vw,1200px)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-white">{expandedEntry.fileName}</div>
                  <div className="text-xs text-zinc-500">
                    {
                      "\u53cc\u51fb\u5361\u7247\u53ef\u653e\u5927\u67e5\u770b\uff0c\u64cd\u4f5c\u6309\u94ae\u60ac\u505c\u65f6\u663e\u793a"
                    }
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-white/10 bg-white/5 p-2 text-zinc-200 hover:bg-white/10"
                    onClick={() => {
                      void downloadEntries([expandedEntry]);
                    }}
                    title="\u4e0b\u8f7d"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-white/10 bg-white/5 p-2 text-zinc-200 hover:bg-white/10"
                    onClick={() => setExpandedEntry(null)}
                    title="\u5173\u95ed"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center bg-black">
                {expandedEntry.mediaType === "video" ? (
                  <video
                    src={stripHashOnly(expandedEntry.outputUrl)}
                    className="max-h-[82vh] max-w-full object-contain"
                    controls
                    autoPlay
                    playsInline
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={stripHashOnly(expandedEntry.outputUrl)}
                    alt=""
                    className="max-h-[82vh] max-w-full object-contain"
                    draggable={false}
                  />
                )}
              </div>
            </div>
          </div>
        ) : null}

        {deleteConfirm ? (
          <div className="pointer-events-auto fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-4">
            <div className="w-[min(92vw,460px)] rounded-2xl border border-white/10 bg-zinc-950 p-5 shadow-2xl">
              <div className="text-sm font-semibold text-white">{"\u786e\u8ba4\u5220\u9664\u7d20\u6750"}</div>
              <p className="mt-2 text-sm leading-relaxed text-zinc-300">
                {
                  `\u8fd9\u4f1a\u6c38\u4e45\u5220\u9664\u4f60\u9009\u4e2d\u7684 ${deleteConfirm.entries.length} \u4e2a\u7d20\u6750\uff0c\u4ee5\u53ca\u5bf9\u5e94\u7684\u5386\u53f2\u7f13\u5b58\u4e0e\u6d77\u62a5\u7f13\u5b58\u3002`
                }
              </p>
              {referencedDeleteTargets.length > 0 ? (
                <p className="mt-2 rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
                  {
                    `\u5176\u4e2d ${referencedDeleteTargets.length} \u4e2a\u7d20\u6750\u5df2\u7ecf\u88ab\u5f53\u524d\u753b\u5e03\u6216\u6700\u8fd1\u753b\u5e03\u5f15\u7528\u3002\u5220\u9664\u540e\uff0c\u8fd9\u4e9b\u4f4d\u7f6e\u53ef\u80fd\u4f1a\u53d8\u6210\u4e22\u5931\u72b6\u6001\u3002`
                  }
                  {referencedDeleteTargets[0]?.referenceLabels?.length
                    ? ` \u4f8b\u5982\uff1a${referencedDeleteTargets[0].referenceLabels!
                        .slice(0, 2)
                        .join("\u3001")}`
                    : ""}
                </p>
              ) : null}
              <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                {
                  "\u8fd9\u91cc\u53ea\u4f1a\u5220\u9664\u672c\u6b21\u9009\u4e2d\u7684\u7d20\u6750\u6587\u4ef6\uff0c\u4e0d\u4f1a\u8fde\u5e26\u5220\u9664\u540c\u4e00\u8282\u70b9\u751f\u6210\u7684\u5176\u4ed6\u7ed3\u679c\uff1b\u53ea\u8981\u5bf9\u5e94\u7684\u662f\u4e0d\u540c\u6587\u4ef6\uff0c\u5b83\u4eec\u4f1a\u7ee7\u7eed\u4fdd\u7559\u3002"
                }
              </p>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200 hover:bg-white/10"
                  onClick={() => setDeleteConfirm(null)}
                  disabled={deleteBusy}
                >
                  {"\u53d6\u6d88"}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-red-400/30 bg-red-500/15 px-3 py-2 text-sm text-red-100 hover:bg-red-500/20 disabled:opacity-60"
                  onClick={async () => {
                    const targets = deleteConfirm.entries;
                    setDeleteConfirm(null);
                    await deleteEntries(targets);
                  }}
                  disabled={deleteBusy}
                >
                  {"\u786e\u8ba4\u5220\u9664"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
