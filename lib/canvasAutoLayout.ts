import type { Edge, Node } from "reactflow";

const GAP = 64;
const IMG = { w: 340, h: 220 };
const PROMPT = { w: 580, h: 420 };
const VIDEO = { w: 450, h: 640 };
const GROUP_PAD = 40;

type RFNode = Node;

function hasParent(n: RFNode) {
  return Boolean((n as RFNode & { parentNode?: string }).parentNode);
}

function isPromptLike(t: string | undefined) {
  return t === "prompt" || t === "prompt2";
}

/**
 * 根节点自动排版：左素材 → 中提示 → 右视频输出；多流水线纵向堆叠；未连线素材与组节点靠下排列，减少重叠。
 */
export function computeAutoLayoutPositions(
  nodes: RFNode[],
  edges: Edge[]
): Map<string, { x: number; y: number }> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const next = new Map<string, { x: number; y: number }>();

  const roots = nodes.filter((n) => !hasParent(n));
  const rootIds = new Set(roots.map((n) => n.id));

  const usedAsMaterial = new Set(
    edges.filter((e) => e.targetHandle === "image_input").map((e) => e.source)
  );

  const promptNodes = roots.filter((n) => isPromptLike(n.type));

  const videoFromPrompt = new Set(
    edges
      .filter((e) => e.sourceHandle === "output" && byId.get(e.target)?.type === "video")
      .map((e) => e.target)
  );

  const standaloneVideos = roots.filter(
    (n) => n.type === "video" && rootIds.has(n.id) && !videoFromPrompt.has(n.id)
  );

  let cursorY = 80;
  const startX = 80;

  const placePipeline = (
    images: RFNode[],
    prompt: RFNode | null,
    videos: RFNode[]
  ) => {
    let x = startX;
    let maxH = 0;

    if (images.length > 0) {
      const colW = IMG.w;
      let iy = cursorY;
      images.forEach((im, ii) => {
        next.set(im.id, { x, y: iy });
        iy += IMG.h + Math.min(GAP, 48);
        if (ii === images.length - 1) maxH = Math.max(maxH, iy - cursorY);
      });
      x += colW + GAP;
    }

    if (prompt) {
      const ph = images.length > 0 ? Math.max(PROMPT.h, maxH) : PROMPT.h;
      const py = cursorY + Math.max(0, (maxH - PROMPT.h) / 2);
      next.set(prompt.id, { x, y: py });
      x += PROMPT.w + GAP;
      maxH = Math.max(maxH, ph);
    }

    if (videos.length > 0) {
      const vh = VIDEO.h;
      videos.forEach((v, vi) => {
        const vx = x + vi * (VIDEO.w + GAP);
        const vy = cursorY + Math.max(0, (maxH - vh) / 2);
        next.set(v.id, { x: vx, y: vy });
      });
      const rowW = videos.length * VIDEO.w + (videos.length - 1) * GAP;
      maxH = Math.max(maxH, vh);
      x += rowW;
    }

    if (!prompt && videos.length > 0 && images.length > 0) {
      maxH = Math.max(maxH, VIDEO.h);
    }

    cursorY += maxH + GAP + 36;
  };

  const sortedPrompts = [...promptNodes].sort((a, b) => {
    const pa = a.position.y * 10000 + a.position.x;
    const pb = b.position.y * 10000 + b.position.x;
    return pa - pb;
  });

  for (const p of sortedPrompts) {
    const imgIds = edges
      .filter((e) => e.target === p.id && e.targetHandle === "image_input")
      .map((e) => e.source);
    const images = imgIds
      .map((id) => byId.get(id))
      .filter(
        (node): node is RFNode =>
          node != null && node.type === "image" && rootIds.has(node.id)
      );

    const vidIds = edges
      .filter((e) => e.source === p.id && e.sourceHandle === "output")
      .map((e) => e.target);
    const videos = vidIds
      .map((id) => byId.get(id))
      .filter(
        (node): node is RFNode =>
          node != null && node.type === "video" && rootIds.has(node.id)
      );

    placePipeline(images, p, videos);
  }

  for (const v of standaloneVideos) {
    const imgIds = edges
      .filter((e) => e.target === v.id && e.targetHandle === "image_input")
      .map((e) => e.source);
    const images = imgIds
      .map((id) => byId.get(id))
      .filter(
        (node): node is RFNode =>
          node != null && node.type === "image" && rootIds.has(node.id)
      );
    placePipeline(images, null, [v]);
  }

  const orphanImages = roots.filter(
    (n) => n.type === "image" && !usedAsMaterial.has(n.id) && !next.has(n.id)
  );
  if (orphanImages.length > 0) {
    let ox = startX;
    let oy = cursorY + 20;
    orphanImages.forEach((im) => {
      next.set(im.id, { x: ox, y: oy });
      ox += IMG.w + GAP;
      if (ox > startX + 4 * (IMG.w + GAP)) {
        ox = startX;
        oy += IMG.h + GAP;
      }
    });
    cursorY = oy + IMG.h + GAP;
  }

  const groups = roots.filter((n) => n.type === "group" && !next.has(n.id));
  let gx = startX;
  let gy = Math.max(cursorY, 120);
  for (const g of groups) {
    const w = typeof g.width === "number" ? g.width : 420;
    const h = typeof g.height === "number" ? g.height : 300;
    next.set(g.id, { x: gx, y: gy });
    gx += w + GROUP_PAD;
    if (gx > startX + 1600) {
      gx = startX;
      gy += h + GROUP_PAD;
    }
  }

  return next;
}
