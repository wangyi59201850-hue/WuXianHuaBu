import type { Edge, Node } from "reactflow";
import type { PromptNodeData } from "@/components/nodes/PromptNode";
import type { VideoNodeData } from "@/components/nodes/VideoNode";
import type { TextBoxNodeData } from "@/components/nodes/TextBoxNode";
import type { LocalImageNodeData } from "@/components/nodes/LocalImageNode";
import type { GroupNodeData } from "@/components/nodes/GroupNode";

type AppNodeData =
  | PromptNodeData
  | VideoNodeData
  | TextBoxNodeData
  | LocalImageNodeData
  | GroupNodeData;

const DB_NAME = "jimengpro-canvas";
const STORE = "imageBlobs";
export const CANVAS_GRAPH_LS_KEY = "jimengpro-canvas-graph-v1";
const LEGACY_COLLIDING_NODE_IDS = new Set([
  "prompt-1",
  "prompt2-1",
  "video-1",
  "text-1",
  "img-1",
  "image-1",
  "group-1",
]);

export function createCanvasNodeId(prefix: string): string {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, "") || "node";
  return `${safePrefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createCanvasGraphId(): string {
  return `canvas-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function remapNodeIdList(value: unknown, idMap: Map<string, string>): unknown {
  if (!Array.isArray(value)) return value;
  let changed = false;
  const next = value.map((item) => {
    if (typeof item !== "string") return item;
    const mapped = idMap.get(item) ?? item;
    if (mapped !== item) changed = true;
    return mapped;
  });
  return changed ? next : value;
}

function remapNodeDataRefs(
  value: Record<string, unknown> | undefined,
  idMap: Map<string, string>
): Record<string, unknown> | undefined {
  if (!value || idMap.size === 0) return value;
  const next: Record<string, unknown> = { ...value };

  next.imageOrder = remapNodeIdList(next.imageOrder, idMap);
  next.videoOrder = remapNodeIdList(next.videoOrder, idMap);
  next.materialOrder = remapNodeIdList(next.materialOrder, idMap);

  if (typeof next.resumeGenSourceNodeId === "string") {
    next.resumeGenSourceNodeId =
      idMap.get(next.resumeGenSourceNodeId) ?? next.resumeGenSourceNodeId;
  }
  if (typeof next.generatedSpillPromptId === "string") {
    next.generatedSpillPromptId =
      idMap.get(next.generatedSpillPromptId) ?? next.generatedSpillPromptId;
  }

  const spill =
    next.canvasImageSpill && typeof next.canvasImageSpill === "object"
      ? (next.canvasImageSpill as Record<string, unknown>)
      : null;
  if (spill) {
    next.canvasImageSpill = {
      ...spill,
      imageNodeIds: remapNodeIdList(spill.imageNodeIds, idMap),
    };
  }

  return next;
}

function migrateLegacyCollidingNodeIds(
  rawNodes: Record<string, unknown>[],
  rawEdges: Edge[]
): {
  nodes: Record<string, unknown>[];
  edges: Edge[];
  migrated: boolean;
} {
  const takenIds = new Set<string>();
  for (const rawNode of rawNodes) {
    if (typeof rawNode.id === "string" && rawNode.id) takenIds.add(rawNode.id);
  }

  const idMap = new Map<string, string>();
  for (const rawNode of rawNodes) {
    const currentId = typeof rawNode.id === "string" ? rawNode.id : "";
    if (!LEGACY_COLLIDING_NODE_IDS.has(currentId) || idMap.has(currentId)) continue;
    const type = typeof rawNode.type === "string" ? rawNode.type : "";
    const prefix =
      type === "prompt2"
        ? "prompt2"
        : type === "prompt"
          ? "prompt"
          : type === "video"
            ? "video"
            : type === "text"
              ? "text"
              : type === "group"
                ? "group"
                : "img";
    let nextId = createCanvasNodeId(prefix);
    while (takenIds.has(nextId)) {
      nextId = createCanvasNodeId(prefix);
    }
    takenIds.add(nextId);
    idMap.set(currentId, nextId);
  }

  if (idMap.size === 0) {
    return { nodes: rawNodes, edges: rawEdges, migrated: false };
  }

  return {
    nodes: rawNodes.map((rawNode) => {
      const currentId = typeof rawNode.id === "string" ? rawNode.id : "";
      const data =
        rawNode.data && typeof rawNode.data === "object"
          ? (rawNode.data as Record<string, unknown>)
          : undefined;
      return {
        ...rawNode,
        id: idMap.get(currentId) ?? currentId,
        ...(data ? { data: remapNodeDataRefs(data, idMap) } : {}),
      };
    }),
    edges: rawEdges.map((edge) => ({
      ...edge,
      source: idMap.get(edge.source) ?? edge.source,
      target: idMap.get(edge.target) ?? edge.target,
    })),
    migrated: true,
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
  });
}

export async function idbPutImage(nodeId: string, blob: Blob): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).put(blob, nodeId);
    });
  } finally {
    db.close();
  }
}

export async function idbGetImage(nodeId: string): Promise<Blob | undefined> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).get(nodeId);
      r.onsuccess = () => resolve(r.result as Blob | undefined);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}

export async function idbDeleteImage(nodeId: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).delete(nodeId);
    });
  } finally {
    db.close();
  }
}

function stripNodeData(type: string | undefined, data: AppNodeData): Record<string, unknown> {
  const src = data as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  let persistedImage = false;
  for (const [k, v] of Object.entries(src)) {
    if (typeof v === "function") continue;
    if (k === "canvasImageSpill") continue;
    if (k === "generatedSpillPromptId") continue;
    if (k === "generatedSpillUrlIndex") continue;
    if (k === "spillDragArmed") continue;
    if (k === "canvasPanelDragArmed") continue;
    if (k === "groupCanvasDragArmed") continue;
    if (k === "generatedSpillIsPrimary") continue;
    if (k === "generatedSpillPending") continue;
    if (k === "generatedSpillFetchToken") continue;
    if (k === "generatedSpillSwapTick") continue;
    if (k === "generatedSpillSwapDir") continue;
    if (k === "generatedSpillSwapCover") continue;
    if (k === "generatedSpillSwapOverlayUrl") continue;
    if (k === "generatedSpillSwapUnderlayUrl") continue;
    if (k === "promptPrimaryShellFlashTick") continue;
    if (k === "promptShellSwapOverlayUrl") continue;
    if (k === "imageFile") continue;
    if (k === "imagePreviewUrl") {
      if (typeof v === "string" && v.startsWith("blob:")) {
        persistedImage = true;
        continue;
      }
    }
    out[k] = v;
  }
  if (type === "image" && persistedImage) {
    out.persistedImage = true;
  }
  return out;
}

export function serializeNodeForStorage(n: Node<AppNodeData>): Record<string, unknown> {
  return {
    id: n.id,
    type: n.type,
    position: { ...n.position },
    data: stripNodeData(n.type, n.data as AppNodeData),
    ...(typeof n.width === "number" ? { width: n.width } : {}),
    ...(typeof n.height === "number" ? { height: n.height } : {}),
    ...(typeof n.zIndex === "number" ? { zIndex: n.zIndex } : {}),
  };
}

/** 画布「展开到网格」的临时图节点 id；不应写入持久化（与 strip 掉 canvasImageSpill 一致）。 */
function collectCanvasSpillImageNodeIds(nodes: Node<AppNodeData>[]): Set<string> {
  const out = new Set<string>();
  for (const n of nodes) {
    if (n.type !== "prompt" && n.type !== "prompt2") continue;
    const spill = (n.data as PromptNodeData).canvasImageSpill;
    const ids = spill?.imageNodeIds;
    if (!Array.isArray(ids)) continue;
    for (const id of ids) {
      if (typeof id === "string" && id) out.add(id);
    }
  }
  return out;
}

export async function saveCanvasGraph(nodes: Node<AppNodeData>[], edges: Edge[]): Promise<void> {
  const spillImageIds = collectCanvasSpillImageNodeIds(nodes);
  const nodesToPersist = nodes.filter((n) => !spillImageIds.has(n.id));
  const edgesToPersist = edges.filter(
    (e) => !spillImageIds.has(e.source) && !spillImageIds.has(e.target)
  );

  try {
    let earlyCanvasId = createCanvasGraphId();
    const prevRaw = localStorage.getItem(CANVAS_GRAPH_LS_KEY);
    if (prevRaw) {
      const prev = JSON.parse(prevRaw) as { canvasId?: unknown };
      if (typeof prev?.canvasId === "string" && prev.canvasId.trim()) {
        earlyCanvasId = prev.canvasId.trim();
      }
    }
    localStorage.setItem(
      CANVAS_GRAPH_LS_KEY,
      JSON.stringify({
        v: 1,
        canvasId: earlyCanvasId,
        savedAt: Date.now(),
        edges: edgesToPersist,
        nodes: nodesToPersist.map((n) => serializeNodeForStorage(n)),
      })
    );
  } catch {
    /* ignore */
  }

  for (const node of nodesToPersist) {
    if (node.type !== "image") continue;
    const d = node.data as LocalImageNodeData;
    try {
      if (d.imageFile) {
        await idbPutImage(node.id, d.imageFile);
      } else if (d.imagePreviewUrl?.startsWith("blob:")) {
        const res = await fetch(d.imagePreviewUrl);
        const blob = await res.blob();
        await idbPutImage(node.id, blob);
      }
    } catch {
      // 单张失败不影响整图保存
    }
  }

  let canvasId = createCanvasGraphId();
  try {
    const prevRaw = localStorage.getItem(CANVAS_GRAPH_LS_KEY);
    if (prevRaw) {
      const prev = JSON.parse(prevRaw) as { canvasId?: unknown };
      if (typeof prev?.canvasId === "string" && prev.canvasId.trim()) {
        canvasId = prev.canvasId.trim();
      }
    }
  } catch {
    /* ignore */
  }

  const payload = {
    v: 1,
    canvasId,
    savedAt: Date.now(),
    edges: edgesToPersist,
    nodes: nodesToPersist.map((n) => serializeNodeForStorage(n)),
  };
  localStorage.setItem(CANVAS_GRAPH_LS_KEY, JSON.stringify(payload));
}

export function clearCanvasGraphStorage() {
  try {
    localStorage.removeItem(CANVAS_GRAPH_LS_KEY);
  } catch {
    /* ignore */
  }
}

export async function loadCanvasGraph(): Promise<{
  nodes: Node<AppNodeData>[];
  edges: Edge[];
} | null> {
  const raw = localStorage.getItem(CANVAS_GRAPH_LS_KEY);
  if (!raw) return null;
  let parsed: {
    v?: number;
    savedAt?: number;
    nodes: Record<string, unknown>[];
    edges: Edge[];
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;

  const migratedStored = migrateLegacyCollidingNodeIds(parsed.nodes, parsed.edges);

  const nodes: Node<AppNodeData>[] = [];
  for (const rawNode of migratedStored.nodes) {
    const id = String(rawNode.id ?? "");
    const type = rawNode.type as string | undefined;
    const position = rawNode.position as { x: number; y: number };
    const data = { ...(rawNode.data as Record<string, unknown>) } as unknown as AppNodeData;

    if (type === "image") {
      const d = data as LocalImageNodeData;
      const persisted = Boolean((rawNode.data as Record<string, unknown>)?.persistedImage);
      if (persisted) {
        const blob = await idbGetImage(id);
        if (blob) {
          const mime = blob.type || "image/png";
          const ext =
            mime.includes("video/mp4") || mime === "video/mp4"
              ? ".mp4"
              : mime.includes("webm")
                ? ".webm"
                : mime.includes("video/")
                  ? ".mp4"
                  : mime.includes("jpeg")
                    ? ".jpg"
                    : mime.includes("webp")
                      ? ".webp"
                      : ".png";
          const file = new File([blob], `reference${ext}`, {
            type: mime,
          });
          const imagePreviewUrl = URL.createObjectURL(blob);
          const materialIsVideo =
            mime.startsWith("video/") || mime.includes("video/mp4") || mime === "video/mp4";
          nodes.push({
            id,
            type: "image",
            position,
            data: {
              ...d,
              imagePreviewUrl,
              imageFile: file,
              materialIsVideo,
              persistedImage: false,
            },
          } as Node<AppNodeData>);
          continue;
        }
      }
      nodes.push({
        id,
        type: "image",
        position,
        data: {
          ...d,
          imagePreviewUrl: d.imagePreviewUrl ?? null,
          imageFile: d.imageFile ?? null,
        },
      } as Node<AppNodeData>);
      continue;
    }

    nodes.push({
      id,
      type: type as Node<AppNodeData>["type"],
      position,
      data,
      } as Node<AppNodeData>);
  }

  const sanitized = await sanitizeOrphanSpillImageNodes(nodes, migratedStored.edges);
  if (migratedStored.migrated) {
    try {
      localStorage.setItem(
        CANVAS_GRAPH_LS_KEY,
        JSON.stringify({
          v: typeof parsed.v === "number" ? parsed.v : 1,
          savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : Date.now(),
          edges: sanitized.edges,
          nodes: sanitized.nodes.map((node) => serializeNodeForStorage(node)),
        })
      );
    } catch {
      /* ignore */
    }
  }
  return sanitized;
}

/** 旧版曾把展开网格的 spill 节点写入存档；刷新后 prompt 无 canvasImageSpill，网格会残留在画布上。 */
const SPILL_IMAGE_NODE_ID_PREFIX = "img-spill-";

async function sanitizeOrphanSpillImageNodes(
  nodes: Node<AppNodeData>[],
  edges: Edge[]
): Promise<{ nodes: Node<AppNodeData>[]; edges: Edge[] }> {
  const removeIds = new Set(
    nodes
      .filter((n) => n.type === "image" && n.id.startsWith(SPILL_IMAGE_NODE_ID_PREFIX))
      .map((n) => n.id)
  );
  if (removeIds.size === 0) return { nodes, edges };

  for (const n of nodes) {
    if (!removeIds.has(n.id)) continue;
    const d = n.data as LocalImageNodeData;
    const u = d.imagePreviewUrl;
    if (typeof u === "string" && u.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(u);
      } catch {
        /* ignore */
      }
    }
    try {
      await idbDeleteImage(n.id);
    } catch {
      /* ignore */
    }
  }

  return {
    nodes: nodes.filter((n) => !removeIds.has(n.id)),
    edges: edges.filter((e) => !removeIds.has(e.source) && !removeIds.has(e.target)),
  };
}
