"use client";

import { useEffect, useState } from "react";
import Canvas from "@/components/Canvas";
import { DesktopWindowFrame } from "@/components/DesktopWindowFrame";
import {
  CANVAS_GRAPH_LS_KEY,
  clearCanvasGraphStorage,
  createCanvasGraphId,
} from "@/lib/canvasPersist";
import { extractGeneratedFileName } from "@/lib/generatedUrl";
import { backupGeneratedMediaToCache } from "@/lib/outputBackupCache";
import { Check, Layers, Pencil, PlusSquare, Search, Trash2, X } from "lucide-react";

const RECENT_CANVAS_LS_KEY = "jimengpro-canvas-recents-v1";
const RECENT_CANVAS_SORT_LS_KEY = "jimengpro-canvas-sort-v1";
const MAX_RECENT_CANVAS = 24;
const STARTUP_HERO_VIDEO = "/startup/startup-hero.mp4";

type RecentCanvasEntry = {
  id: string;
  savedAt: number;
  title: string;
  thumbUrl: string | null;
  thumbCandidates?: string[];
  nodeCount: number;
  rawGraph: string;
};

type RecentCanvasSortMode = "canvas_id" | "saved_at";

function RecentCanvasThumb(props: { entry: RecentCanvasEntry; candidates: string[] }) {
  const { entry, candidates } = props;
  const [failedIndex, setFailedIndex] = useState(0);

  const src = candidates[failedIndex] ?? null;
  if (!src) {
    return (
      <div className="flex h-[72%] w-full items-center justify-center bg-zinc-800/80">
        <Layers className="h-8 w-8 text-zinc-500" />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className="h-[72%] w-full object-cover"
      onError={() => setFailedIndex((idx) => idx + 1)}
    />
  );
}

function safeParseRecents(): RecentCanvasEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_CANVAS_LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as RecentCanvasEntry[];
    if (!Array.isArray(arr)) return [];
    const valid = arr.filter(
      (x) =>
        x &&
        typeof x.id === "string" &&
        typeof x.savedAt === "number" &&
        typeof x.nodeCount === "number" &&
        typeof x.rawGraph === "string"
    );
    const deduped = new Map<string, RecentCanvasEntry>();
    for (const entry of valid.sort((a, b) => b.savedAt - a.savedAt)) {
      let key = entry.id;
      try {
        const parsed = JSON.parse(entry.rawGraph) as { canvasId?: unknown };
        if (typeof parsed?.canvasId === "string" && parsed.canvasId.trim()) {
          key = parsed.canvasId.trim();
        }
      } catch {
        key = entry.id;
      }
      if (!deduped.has(key)) deduped.set(key, entry);
    }
    return Array.from(deduped.values()).sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

function thumbCandidatesFromGraph(parsed: any): string[] {
  const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
  const out: string[] = [];
  for (const n of nodes) {
    const d = n?.data ?? {};
    const cands = [
      d.persistedPanelFirstImageUrl,
      Array.isArray(d.persistedPanelImageUrls) ? d.persistedPanelImageUrls[0] : null,
      Array.isArray(d.imageUrls) ? d.imageUrls[0] : null,
      d.imagePreviewUrl,
    ];
    for (const c of cands) {
      if (typeof c !== "string") continue;
      const u = c.trim();
      if (!u || u.startsWith("blob:")) continue;
      if (!out.includes(u)) out.push(u);
    }
  }
  return out;
}

function generatedRelPathNeedingSnapshot(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const rel = extractGeneratedFileName(raw);
  if (!rel || rel.startsWith(".backup/")) return null;
  return rel;
}

function collectGeneratedMediaUrlsFromGraph(parsed: any): string[] {
  const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
  const urls = new Set<string>();
  for (const node of nodes) {
    const data = node?.data ?? {};
    const candidates = [
      data.persistedPanelFirstImageUrl,
      ...(Array.isArray(data.persistedPanelImageUrls) ? data.persistedPanelImageUrls : []),
      ...(Array.isArray(data.imageUrls) ? data.imageUrls : []),
      data.imagePreviewUrl,
    ];
    for (const candidate of candidates) {
      if (typeof candidate !== "string" || !candidate.trim()) continue;
      if (!extractGeneratedFileName(candidate)) continue;
      urls.add(candidate.trim().split("#")[0]);
    }
  }
  return Array.from(urls).sort();
}

function collectGraphGeneratedUrlsForSnapshot(parsed: any): string[] {
  const byRel = new Map<string, string>();
  for (const candidate of collectGeneratedMediaUrlsFromGraph(parsed)) {
    const rel = generatedRelPathNeedingSnapshot(candidate);
    if (!rel || byRel.has(rel)) continue;
    byRel.set(rel, candidate.trim());
  }
  return Array.from(byRel.values());
}

function replaceGraphMediaUrlsWithSnapshots(parsed: any, snapshotByRel: Map<string, string>) {
  if (snapshotByRel.size === 0) return parsed;

  const replaceOne = (value: unknown) => {
    if (typeof value !== "string") return value;
    const rel = extractGeneratedFileName(value);
    if (!rel) return value;
    return snapshotByRel.get(rel) ?? value;
  };

  const replaceMany = (value: unknown) =>
    Array.isArray(value) ? value.map((item) => replaceOne(item)) : value;

  const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
  return {
    ...parsed,
    nodes: nodes.map((node: any) => {
      const data = node?.data && typeof node.data === "object" ? node.data : null;
      if (!data) return node;
      return {
        ...node,
        data: {
          ...data,
          persistedPanelFirstImageUrl: replaceOne(data.persistedPanelFirstImageUrl),
          persistedPanelImageUrls: replaceMany(data.persistedPanelImageUrls),
          imageUrls: replaceMany(data.imageUrls),
          imagePreviewUrl: replaceOne(data.imagePreviewUrl),
        },
      };
    }),
  };
}

async function snapshotGraphGeneratedMedia(parsed: any, archiveId: string) {
  const urls = collectGraphGeneratedUrlsForSnapshot(parsed);
  if (urls.length === 0) return parsed;
  try {
    const backup = await backupGeneratedMediaToCache(`canvas-${archiveId}`, "image", urls);
    if (!backup.ok || backup.files.length === 0) return parsed;
    const snapshotByRel = new Map<string, string>();
    for (let i = 0; i < urls.length; i++) {
      const rel = extractGeneratedFileName(urls[i] ?? "");
      const snap = backup.files[i];
      if (!rel || typeof snap !== "string" || !snap.trim()) continue;
      snapshotByRel.set(rel, snap.trim());
    }
    return replaceGraphMediaUrlsWithSnapshots(parsed, snapshotByRel);
  } catch {
    return parsed;
  }
}

function graphHasMeaningfulCanvas(parsed: any): boolean {
  const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
  if (nodes.length === 0) return false;
  if (nodes.length > 1) return true;
  const node = nodes[0] as { type?: string; data?: Record<string, unknown> } | undefined;
  if (!node) return false;
  if (node.type && node.type !== "prompt") return true;
  const d = node.data ?? {};
  return Boolean(
    (typeof d.promptText === "string" && d.promptText.trim()) ||
      (typeof d.persistedPanelFirstImageUrl === "string" && d.persistedPanelFirstImageUrl.trim()) ||
      (Array.isArray(d.persistedPanelImageUrls) && d.persistedPanelImageUrls.length > 0) ||
      (Array.isArray(d.imageOrder) && d.imageOrder.length > 0) ||
      (Array.isArray(d.videoOrder) && d.videoOrder.length > 0) ||
      (Array.isArray(d.materialOrder) && d.materialOrder.length > 0)
  );
}

function normalizeGraphForChangeDetect(parsed: any) {
  if (!parsed || typeof parsed !== "object") return null;
  const { savedAt: _savedAt, ...rest } = parsed as Record<string, unknown>;
  return rest;
}

function areCanvasGraphsEquivalent(rawA: string, rawB: string): boolean {
  try {
    const parsedA = JSON.parse(rawA);
    const parsedB = JSON.parse(rawB);
    return (
      JSON.stringify(normalizeGraphForChangeDetect(parsedA)) ===
      JSON.stringify(normalizeGraphForChangeDetect(parsedB))
    );
  } catch {
    return rawA === rawB;
  }
}

function countGraphInFlightTasks(parsed: any): number {
  const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
  let count = 0;
  for (const node of nodes) {
    const data = node?.data ?? {};
    if (data?.isLoading === true) count += 1;
  }
  return count;
}

function freezeGraphForRecentSnapshot(parsed: any) {
  const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
  const frozenNodes = nodes.map((node: any) => {
    const data = node?.data && typeof node.data === "object" ? node.data : null;
    if (!data) return node;
    const renderedText =
      typeof data.lastRenderedPromptText === "string" ? data.lastRenderedPromptText.trim() : "";
    if (!renderedText) return node;
    const hasOutput = Boolean(
      (typeof data.persistedPanelFirstImageUrl === "string" && data.persistedPanelFirstImageUrl.trim()) ||
        (Array.isArray(data.persistedPanelImageUrls) && data.persistedPanelImageUrls.length > 0) ||
        (Array.isArray(data.imageUrls) && data.imageUrls.length > 0)
    );
    if (!hasOutput) return node;
    return {
      ...node,
      data: {
        ...data,
        promptText: renderedText,
      },
    };
  });
  return {
    ...parsed,
    nodes: frozenNodes,
  };
}

function defaultCanvasTitle(parsed: any, savedAt: number) {
  const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
  for (const n of nodes) {
    const text = n?.data?.lastRenderedPromptText || n?.data?.promptText;
    if (typeof text === "string" && text.trim()) {
      return text.trim().slice(0, 20);
    }
  }
  return `画布 ${new Date(savedAt).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function pickRecentThumbUrl(candidates: string[], recents: RecentCanvasEntry[]) {
  if (candidates.length === 0) return null;
  const used = new Set(recents.map((x) => x.thumbUrl).filter(Boolean));
  const preferred = candidates.find((u) => !used.has(u));
  return preferred ?? candidates[0] ?? null;
}

function buildEmptyCanvasGraph(canvasId: string) {
  return JSON.stringify({
    v: 1,
    canvasId,
    savedAt: Date.now(),
    nodes: [],
    edges: [],
  });
}

function canvasIdFromRecentEntry(entry: RecentCanvasEntry): string {
  try {
    const parsed = JSON.parse(entry.rawGraph) as { canvasId?: unknown };
    if (typeof parsed?.canvasId === "string" && parsed.canvasId.trim()) {
      return parsed.canvasId.trim();
    }
  } catch {
    /* ignore */
  }
  return entry.id;
}

function canvasCreatedAtFromId(canvasId: string): number | null {
  const parts = canvasId.trim().split("-");
  if (parts.length < 3) return null;
  const stamp = parts[1];
  if (!stamp) return null;
  const n = parseInt(stamp, 36);
  return Number.isFinite(n) ? n : null;
}

function recentCanvasCreatedOrder(entry: RecentCanvasEntry): number {
  const fromCanvasId = canvasCreatedAtFromId(canvasIdFromRecentEntry(entry));
  if (fromCanvasId != null) return fromCanvasId;
  return entry.savedAt;
}

export default function Home() {
  const [showHeadline, setShowHeadline] = useState(true);
  const [mode, setMode] = useState<"landing" | "new" | "resume">("landing");
  const [canvasMounted, setCanvasMounted] = useState(false);
  const [canvasAutoRestore, setCanvasAutoRestore] = useState(true);
  const [canvasInstanceKey, setCanvasInstanceKey] = useState(0);
  const [currentCanvasTaskCount, setCurrentCanvasTaskCount] = useState(0);
  const [currentCanvasRawGraph, setCurrentCanvasRawGraph] = useState<string | null>(null);
  const [canvasEntryRaw, setCanvasEntryRaw] = useState<string | null>(null);
  const [activeRecentCanvasId, setActiveRecentCanvasId] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [hasSavedCanvas, setHasSavedCanvas] = useState(false);
  const [recentCanvases, setRecentCanvases] = useState<RecentCanvasEntry[]>([]);
  const [recentSortMode, setRecentSortMode] = useState<RecentCanvasSortMode>("canvas_id");
  const [recentSearch, setRecentSearch] = useState("");
  const [editingRecentId, setEditingRecentId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const heroVideoUrl = STARTUP_HERO_VIDEO;

  const refreshCurrentGraphState = () => {
    try {
      const raw = localStorage.getItem(CANVAS_GRAPH_LS_KEY);
      if (!raw) {
        setHasSavedCanvas(false);
        setSavedAt(null);
        setCurrentCanvasTaskCount(0);
        setCurrentCanvasRawGraph(null);
        return;
      }
      const parsed = JSON.parse(raw) as { canvasId?: string; nodes?: unknown[]; savedAt?: number };
      const meaningful = graphHasMeaningfulCanvas(parsed);
      setHasSavedCanvas(meaningful);
      setSavedAt(meaningful && typeof parsed?.savedAt === "number" ? parsed.savedAt : null);
      setCurrentCanvasTaskCount(countGraphInFlightTasks(parsed));
      setCurrentCanvasRawGraph(raw);
      setActiveRecentCanvasId(
        typeof parsed?.canvasId === "string" && parsed.canvasId.trim() ? parsed.canvasId.trim() : null
      );
    } catch {
      setHasSavedCanvas(false);
      setSavedAt(null);
      setCurrentCanvasTaskCount(0);
      setCurrentCanvasRawGraph(null);
    }
  };

  const refreshRecents = () => {
    setRecentCanvases(safeParseRecents());
  };

  const filteredRecentCanvases = [...recentCanvases]
    .sort((a, b) => {
      if (recentSortMode === "saved_at") return b.savedAt - a.savedAt;
      const aCanvasId = canvasIdFromRecentEntry(a);
      const bCanvasId = canvasIdFromRecentEntry(b);
      const aCreatedAt = recentCanvasCreatedOrder(a);
      const bCreatedAt = recentCanvasCreatedOrder(b);
      if (aCreatedAt !== bCreatedAt) return bCreatedAt - aCreatedAt;
      return bCanvasId.localeCompare(aCanvasId, "zh-CN", {
        numeric: true,
        sensitivity: "base",
      });
    })
    .filter((entry) => {
    const q = recentSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      entry.title.toLowerCase().includes(q) ||
      new Date(entry.savedAt).toLocaleString("zh-CN").toLowerCase().includes(q) ||
      canvasIdFromRecentEntry(entry).toLowerCase().includes(q)
    );
    });

  const parseGraphRaw = (raw: string | null) => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as { nodes?: unknown[]; savedAt?: number };
    } catch {
      return null;
    }
  };

  const graphHasCompletedOutputs = (parsed: any): boolean => {
    const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
    for (const node of nodes) {
      const data = node?.data ?? {};
      if (typeof data.persistedPanelFirstImageUrl === "string" && data.persistedPanelFirstImageUrl.trim()) {
        return true;
      }
      if (Array.isArray(data.persistedPanelImageUrls) && data.persistedPanelImageUrls.length > 0) {
        return true;
      }
      if (Array.isArray(data.imageUrls) && data.imageUrls.length > 0) {
        return true;
      }
      if (typeof data.imagePreviewUrl === "string" && data.imagePreviewUrl.trim() && !data.imagePreviewUrl.startsWith("blob:")) {
        return true;
      }
    }
    return false;
  };

  const graphStatusMeta = (parsed: any): { label: string; tone: string } | null => {
    if (!parsed) return null;
    const inFlight = countGraphInFlightTasks(parsed);
    if (inFlight > 0) {
      return { label: inFlight > 1 ? `进行中 ${inFlight}` : "进行中", tone: "amber" };
    }
    if (graphHasCompletedOutputs(parsed)) {
      return { label: "已完成", tone: "emerald" };
    }
    return null;
  };

  useEffect(() => {
    refreshCurrentGraphState();
    refreshRecents();
    try {
      const raw = localStorage.getItem(RECENT_CANVAS_SORT_LS_KEY);
      if (raw === "saved_at" || raw === "canvas_id") {
        setRecentSortMode(raw);
      }
    } catch {
      /* ignore */
    }
    setMode("landing");
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(RECENT_CANVAS_SORT_LS_KEY, recentSortMode);
    } catch {
      /* ignore */
    }
  }, [recentSortMode]);

  useEffect(() => {
    if (mode !== "landing") return;
    const iv = window.setInterval(() => {
      refreshCurrentGraphState();
    }, 1500);
    return () => window.clearInterval(iv);
  }, [mode]);

  const currentGraphParsed = parseGraphRaw(currentCanvasRawGraph);
  const displayGraphForEntry = (entry: RecentCanvasEntry) =>
    entry.id === activeRecentCanvasId ? currentGraphParsed : parseGraphRaw(entry.rawGraph);
  const displayStatusForEntry = (entry: RecentCanvasEntry) =>
    graphStatusMeta(displayGraphForEntry(entry));
  const displayThumbCandidatesForEntry = (entry: RecentCanvasEntry) => {
    const fromGraph = thumbCandidatesFromGraph(displayGraphForEntry(entry));
    const merged = [...fromGraph, ...(entry.thumbCandidates ?? []), ...(entry.thumbUrl ? [entry.thumbUrl] : [])];
    return Array.from(new Set(merged.filter(Boolean)));
  };

  useEffect(() => {
    if (mode !== "landing" || !activeRecentCanvasId || !currentCanvasRawGraph) return;
    const parsed = parseGraphRaw(currentCanvasRawGraph);
    if (!graphHasMeaningfulCanvas(parsed)) return;
    const next = safeParseRecents().map((entry) => {
      if (entry.id !== activeRecentCanvasId) return entry;
      const savedAt = typeof parsed?.savedAt === "number" ? parsed.savedAt : entry.savedAt;
      const thumbCandidates = thumbCandidatesFromGraph(parsed);
      return {
        ...entry,
        savedAt,
        title: entry.title || defaultCanvasTitle(parsed, savedAt),
        thumbUrl: thumbCandidates[0] ?? entry.thumbUrl,
        thumbCandidates,
        nodeCount: Array.isArray(parsed?.nodes) ? parsed.nodes.length : entry.nodeCount,
        rawGraph: currentCanvasRawGraph,
      };
    });
    localStorage.setItem(RECENT_CANVAS_LS_KEY, JSON.stringify(next));
    setRecentCanvases(next);
  }, [mode, activeRecentCanvasId, currentCanvasRawGraph]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const sources = recentCanvases.map((entry) => ({
        sourceId: `recent:${entry.id}`,
        label: `最近画布:${entry.title || entry.id}`,
        kind: "recent" as const,
        paths: collectGeneratedMediaUrlsFromGraph(parseGraphRaw(entry.rawGraph)),
      }));
      void fetch("/api/protected-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          replaceGroup: "recent",
          sources,
        }),
      }).catch(() => {});
    }, 600);
    return () => window.clearTimeout(timer);
  }, [recentCanvases]);

  const archiveCurrentCanvasToRecents = async (skipIfUnchanged = false) => {
    try {
      const raw = localStorage.getItem(CANVAS_GRAPH_LS_KEY);
      if (!raw) return;
      if (
        skipIfUnchanged &&
        canvasEntryRaw != null &&
        areCanvasGraphsEquivalent(raw, canvasEntryRaw)
      ) {
        return;
      }
      const parsed = JSON.parse(raw) as { canvasId?: string; nodes?: unknown[]; savedAt?: number };
      if (!graphHasMeaningfulCanvas(parsed)) return;
      const archiveId =
        (typeof parsed?.canvasId === "string" && parsed.canvasId.trim()) ||
        activeRecentCanvasId ||
        createCanvasGraphId();
      const snapshottedParsed = await snapshotGraphGeneratedMedia(parsed, archiveId);
      const frozenParsed = freezeGraphForRecentSnapshot(snapshottedParsed);
      const frozenWithCanvasId = {
        ...frozenParsed,
        canvasId: archiveId,
      };
      const frozenRaw = JSON.stringify(frozenWithCanvasId);
      const recents = safeParseRecents();
      const existing =
        (activeRecentCanvasId
          ? recents.find((x) => x.id === activeRecentCanvasId)
          : null) ??
        recents.find((x) => x.id === archiveId) ??
        recents.find((x) => {
          try {
            const parsedRecent = JSON.parse(x.rawGraph) as { canvasId?: unknown };
            return parsedRecent?.canvasId === archiveId;
          } catch {
            return false;
          }
        });
      const nextRecents = recents.filter((x) => x.id !== archiveId);
      const savedAt =
        typeof frozenWithCanvasId?.savedAt === "number" ? frozenWithCanvasId.savedAt : Date.now();
      const thumbCandidates = thumbCandidatesFromGraph(frozenWithCanvasId);
      const next: RecentCanvasEntry = {
        id: archiveId,
        savedAt,
        title: existing?.title || defaultCanvasTitle(frozenWithCanvasId, savedAt),
        thumbUrl: pickRecentThumbUrl(thumbCandidates, nextRecents),
        thumbCandidates,
        nodeCount: Array.isArray(frozenWithCanvasId?.nodes) ? frozenWithCanvasId.nodes.length : 0,
        rawGraph: frozenRaw,
      };
      localStorage.setItem(
        RECENT_CANVAS_LS_KEY,
        JSON.stringify([next, ...nextRecents].slice(0, MAX_RECENT_CANVAS))
      );
      setCanvasEntryRaw(raw);
      refreshRecents();
    } catch {
      /* ignore */
    }
  };

  const chooseNewCanvas = async () => {
    await archiveCurrentCanvasToRecents(true);
    const nextCanvasId = createCanvasGraphId();
    clearCanvasGraphStorage();
    try {
      localStorage.setItem(CANVAS_GRAPH_LS_KEY, buildEmptyCanvasGraph(nextCanvasId));
    } catch {
      /* ignore */
    }
    setCanvasEntryRaw(null);
    setActiveRecentCanvasId(nextCanvasId);
    setCanvasMounted(true);
    setCanvasAutoRestore(false);
    setCanvasInstanceKey((k) => k + 1);
    refreshCurrentGraphState();
    setMode("new");
  };

  const chooseResumeCanvas = () => {
    if (!canvasMounted) {
      setCanvasMounted(true);
      setCanvasAutoRestore(true);
      setCanvasInstanceKey((k) => k + 1);
      try {
        setCanvasEntryRaw(localStorage.getItem(CANVAS_GRAPH_LS_KEY));
      } catch {
        setCanvasEntryRaw(null);
      }
    }
    setMode("resume");
  };

  const openRecentCanvas = async (entry: RecentCanvasEntry) => {
    if (entry.id === activeRecentCanvasId && canvasMounted) {
      setMode("resume");
      return;
    }
    await archiveCurrentCanvasToRecents(true);
    const rawGraphToOpen =
      entry.id === activeRecentCanvasId && currentCanvasRawGraph
        ? currentCanvasRawGraph
        : entry.rawGraph;
    try {
      localStorage.setItem(CANVAS_GRAPH_LS_KEY, rawGraphToOpen);
    } catch {
      /* ignore */
    }
    setCanvasEntryRaw(rawGraphToOpen);
    setActiveRecentCanvasId(entry.id);
    setCanvasMounted(true);
    setCanvasAutoRestore(true);
    setCanvasInstanceKey((k) => k + 1);
    refreshCurrentGraphState();
    setMode("resume");
  };

  const removeRecentCanvas = (id: string) => {
    const next = safeParseRecents().filter((x) => x.id !== id);
    localStorage.setItem(RECENT_CANVAS_LS_KEY, JSON.stringify(next));
    setRecentCanvases(next);
    if (id === activeRecentCanvasId && currentCanvasRawGraph) {
      try {
        const parsed = JSON.parse(currentCanvasRawGraph) as Record<string, unknown>;
        const nextCanvasId = createCanvasGraphId();
        const nextRaw = JSON.stringify({
          ...parsed,
          canvasId: nextCanvasId,
        });
        localStorage.setItem(CANVAS_GRAPH_LS_KEY, nextRaw);
        setCurrentCanvasRawGraph(nextRaw);
        setCanvasEntryRaw(nextRaw);
        setActiveRecentCanvasId(nextCanvasId);
      } catch {
        setActiveRecentCanvasId(null);
      }
    }
  };

  const renameRecentCanvas = (id: string, title: string) => {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    const next = safeParseRecents().map((x) => (x.id === id ? { ...x, title: nextTitle } : x));
    localStorage.setItem(RECENT_CANVAS_LS_KEY, JSON.stringify(next));
    setRecentCanvases(next);
    setEditingRecentId(null);
    setEditingTitle("");
  };

  const goHomeLanding = async () => {
    await archiveCurrentCanvasToRecents(true);
    refreshCurrentGraphState();
    refreshRecents();
    setMode("landing");
  };

  const refreshLandingCanvases = () => {
    refreshCurrentGraphState();
    refreshRecents();
  };

  const openHeroCanvas = async () => {
    await archiveCurrentCanvasToRecents(true);
    const now = Date.now();
    const promptId = `prompt2-${now}`;
    const videoId = `video-${now}`;
    const graphRaw = JSON.stringify({
      v: 1,
      canvasId: createCanvasGraphId(),
      savedAt: now,
      nodes: [
        {
          id: promptId,
          type: "prompt2",
          position: { x: 120, y: 220 },
          data: {
            nodeName: "视频生成节点",
            generationMode: "video",
            referenceMode: "general",
            promptText: "小猫游泳，电影感镜头，水花细节，稳定运镜",
            modelVersion: "seedance2.0fast_vip",
            ratio: "16:9",
            resolutionType: "720p",
            count: 1,
            durationSeconds: 5,
            withAudio: false,
            persistedPanelImageUrls: [heroVideoUrl],
            persistedPanelFirstImageUrl: null,
            promptPanelPrimaryImageIndex: 0,
          },
        },
        {
          id: videoId,
          type: "video",
          position: { x: 600, y: 220 },
          data: {
            imageUrls: [heroVideoUrl],
            isLoading: false,
            expectedCount: 1,
            ratio: "16:9",
            durationSeconds: 5,
            withAudio: false,
          },
        },
      ],
      edges: [
        {
          id: `e-${promptId}-${videoId}-startup`,
          source: promptId,
          target: videoId,
          sourceHandle: "output",
          targetHandle: "input",
          type: "default",
        },
      ],
    });
    try {
      localStorage.setItem(CANVAS_GRAPH_LS_KEY, graphRaw);
    } catch {
      /* ignore */
    }
    setCanvasEntryRaw(graphRaw);
    setActiveRecentCanvasId(null);
    setCanvasMounted(true);
    setCanvasAutoRestore(true);
    setCanvasInstanceKey((k) => k + 1);
    refreshCurrentGraphState();
    setMode("resume");
  };

  return (
    <div className="flex h-screen w-full flex-col bg-[#141416] text-white">
      <DesktopWindowFrame />
      <div className="relative min-h-0 flex-1">
        <header className="pointer-events-none absolute left-0 right-0 top-0 z-20">
          {showHeadline ? (
            <div className="pointer-events-auto mx-auto flex max-w-6xl items-center justify-center gap-2 border-b border-white/10 bg-zinc-900/52 px-4 py-3 backdrop-blur-md">
              <div className="headline-shine text-center text-base font-semibold leading-tight md:text-lg">
                优先体验即梦节点式创作流程，多任务并发，全面支持 Seedance 2.0
              </div>
              <button
                type="button"
                className="rounded-full border border-white/15 bg-white/8 px-2 py-0.5 text-[10px] text-white/75 hover:bg-white/14"
                onClick={() => setShowHeadline(false)}
                title="关闭标语"
              >
                关闭
              </button>
            </div>
          ) : null}
        </header>

        <div
          className={
            mode === "landing" ? "h-full pt-0" : showHeadline ? "h-full pt-14" : "h-full pt-0"
          }
        >
        {mode === "landing" ? (
          <div className="flex h-full justify-center px-0 pt-0">
            <div className="flex w-full max-w-none flex-col gap-4">
              <button
                type="button"
                className={[
                  "relative h-64 w-full overflow-hidden border-b border-white/12 bg-zinc-900/62 text-left",
                  "cursor-pointer hover:border-white/28",
                ].join(" ")}
                onClick={openHeroCanvas}
              >
                <video
                  src={heroVideoUrl}
                  className="h-full w-full object-cover"
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="metadata"
                />
              </button>
              <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-4 px-6 md:grid-cols-[minmax(280px,1fr)_minmax(0,2.1fr)]">
                <button
                  type="button"
                  className="start-create-card group relative flex h-64 flex-col items-center justify-center overflow-hidden rounded-2xl border border-white/18 bg-zinc-900/62 p-6 text-center shadow-[0_18px_40px_rgba(0,0,0,0.22)] backdrop-blur-xl hover:border-white/30 hover:bg-zinc-800/58"
                  onClick={chooseNewCanvas}
                >
                  <span className="start-create-card-glow" aria-hidden="true" />
                  <div className="relative z-[1] flex flex-col items-center">
                    <PlusSquare className="mb-3 h-12 w-12 text-zinc-100" />
                    <div className="text-lg font-semibold">开始创作</div>
                    <div className="mt-2 text-xs text-zinc-400">从空白开始创建新的节点流程</div>
                  </div>
                </button>
                <div className="flex h-64 min-h-0 flex-col rounded-2xl border border-white/12 bg-zinc-900/64 p-3 shadow-[0_18px_40px_rgba(0,0,0,0.20)] backdrop-blur-xl">
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <Layers className="h-4 w-4 text-zinc-200" />
                    <div className="text-sm font-semibold">最近保存画布</div>
                    <button
                      type="button"
                      className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white"
                      onClick={refreshLandingCanvases}
                      title="刷新画布列表"
                    >
                      <svg
                        viewBox="0 0 20 20"
                        fill="none"
                        className="h-3.5 w-3.5"
                        aria-hidden="true"
                      >
                        <path
                          d="M16.667 10a6.667 6.667 0 1 1-1.953-4.714"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                        />
                        <path
                          d="M16.667 3.333v4.286h-4.286"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    {currentCanvasTaskCount > 0 ? (
                      <div className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-200">
                        当前有 {currentCanvasTaskCount} 个任务进行中
                      </div>
                    ) : null}
                    {savedAt ? (
                      <div className="ml-auto text-[10px] text-zinc-500">
                        当前保存于 {new Date(savedAt).toLocaleString("zh-CN")}
                      </div>
                    ) : null}
                  </div>
                  {recentCanvases.length > 0 ? (
                    <div className="mb-2 px-1">
                      <div className="flex items-center gap-2 rounded-lg border border-white/12 bg-zinc-800/38 px-2 py-1.5">
                        <Search className="h-3.5 w-3.5 text-zinc-500" />
                        <input
                          value={recentSearch}
                          onChange={(e) => setRecentSearch(e.target.value)}
                          placeholder="搜索画布名称"
                          className="w-full bg-transparent text-[12px] text-zinc-200 outline-none placeholder:text-zinc-500"
                        />
                        <select
                          value={recentSortMode}
                          onChange={(e) =>
                            setRecentSortMode(e.target.value as RecentCanvasSortMode)
                          }
                          className="rounded-md border border-white/12 bg-zinc-900/84 px-2 py-1 text-[11px] text-zinc-200 outline-none"
                          title="排序方式"
                        >
                          <option value="canvas_id">按画布创建顺序</option>
                          <option value="saved_at">按最后编辑</option>
                        </select>
                        {recentSearch ? (
                          <button
                            type="button"
                            className="flex h-5 w-5 items-center justify-center rounded text-zinc-400 hover:bg-white/10 hover:text-white"
                            onClick={() => setRecentSearch("")}
                            title="清空搜索"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  {recentCanvases.length === 0 ? (
                    <button
                      type="button"
                      className={[
                        "flex min-h-0 flex-1 w-full flex-col items-center justify-center rounded-xl border border-dashed border-white/10",
                        hasSavedCanvas ? "hover:bg-zinc-900/62" : "cursor-not-allowed opacity-45",
                      ].join(" ")}
                      onClick={() => void chooseResumeCanvas()}
                      disabled={!hasSavedCanvas}
                    >
                      <div className="text-xs text-zinc-400">
                        {hasSavedCanvas ? "点击打开当前保存画布" : "当前暂无自动保存记录"}
                      </div>
                      {currentCanvasTaskCount > 0 ? (
                        <div className="mt-2 text-[11px] text-amber-200">
                          后台仍有任务在继续渲染
                        </div>
                      ) : null}
                    </button>
                  ) : filteredRecentCanvases.length === 0 ? (
                    <div className="flex min-h-0 flex-1 w-full flex-col items-center justify-center rounded-xl border border-dashed border-white/10 text-xs text-zinc-500">
                      没找到匹配的历史画布
                    </div>
                  ) : (
                    <div className="ui-gray-scrollbar flex min-h-0 flex-1 gap-2 overflow-x-auto pb-1">
                      {filteredRecentCanvases.map((entry) => (
                        <div
                          key={entry.id}
                          className="group relative h-full w-44 shrink-0 overflow-hidden rounded-xl border border-white/12 bg-zinc-800/42 text-left hover:border-white/28 hover:bg-zinc-800/48"
                          onClick={() => void openRecentCanvas(entry)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              void openRecentCanvas(entry);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          title={`保存于 ${new Date(entry.savedAt).toLocaleString("zh-CN")}`}
                        >
                          <RecentCanvasThumb
                            key={`${entry.id}:${displayThumbCandidatesForEntry(entry).join("|")}`}
                            entry={entry}
                            candidates={displayThumbCandidatesForEntry(entry)}
                          />
                          {(() => {
                            const status = displayStatusForEntry(entry);
                            if (!status || status.tone !== "amber") return null;
                            return (
                              <div
                                className="absolute left-2 top-2 z-10 inline-flex items-center gap-1.5 rounded-full border border-amber-400/35 bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-200 shadow-sm backdrop-blur"
                              >
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-300 animate-pulse" />
                                {status.label}
                              </div>
                            );
                          })()}
                          <div className="px-2 py-1.5 text-[11px] text-zinc-300">
                            {editingRecentId === entry.id ? (
                              <div
                                className="flex items-center gap-1"
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => e.stopPropagation()}
                              >
                                <input
                                  value={editingTitle}
                                  onChange={(e) => setEditingTitle(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      renameRecentCanvas(entry.id, editingTitle);
                                    }
                                    if (e.key === "Escape") {
                                      e.preventDefault();
                                      setEditingRecentId(null);
                                      setEditingTitle("");
                                    }
                                  }}
                                  className="min-w-0 flex-1 rounded border border-white/12 bg-zinc-900/84 px-1.5 py-1 text-[11px] text-white outline-none ring-zinc-400/35 focus:ring"
                                  autoFocus
                                />
                                <button
                                  type="button"
                                  className="flex h-6 w-6 items-center justify-center rounded bg-emerald-600/80 text-white hover:bg-emerald-500"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    renameRecentCanvas(entry.id, editingTitle);
                                  }}
                                  title="保存名称"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  className="flex h-6 w-6 items-center justify-center rounded bg-white/10 text-zinc-200 hover:bg-white/20"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingRecentId(null);
                                    setEditingTitle("");
                                  }}
                                  title="取消"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1">
                                <div className="min-w-0 flex-1 truncate font-medium text-white/95">
                                  {entry.title || "未命名画布"}
                                </div>
                                <button
                                  type="button"
                                  className="ml-auto flex h-5 w-5 items-center justify-center rounded text-zinc-400 hover:bg-white/10 hover:text-white"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingRecentId(entry.id);
                                    setEditingTitle(entry.title || "");
                                  }}
                                  title="重命名"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                              </div>
                            )}
                            <div>{new Date(entry.savedAt).toLocaleString("zh-CN")}</div>
                            <div className="text-zinc-500">{entry.nodeCount} 个节点</div>
                          </div>
                          <button
                            type="button"
                            className="absolute right-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-md bg-zinc-900/72 text-zinc-200 opacity-0 transition-opacity hover:bg-red-600/80 group-hover:opacity-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeRecentCanvas(entry.id);
                            }}
                            title="删除该画布记录"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}
        {canvasMounted && mode !== "landing" ? (
          <div className="h-full">
            <Canvas
              key={canvasInstanceKey}
              autoRestore={canvasAutoRestore}
              onGoHome={goHomeLanding}
            />
          </div>
        ) : null}
      </div>
      </div>
    </div>
  );
}
