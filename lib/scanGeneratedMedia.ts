import fs from "fs/promises";
import path from "path";

const VIDEO_EXTS = [".mp4", ".webm", ".mov", ".mkv", ".m4v"];
const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"];

export type MediaKind = "video" | "image" | "any";

function mediaExtForName(name: string, kind: MediaKind): string | null {
  const lower = name.toLowerCase();
  if (kind === "video" || kind === "any") {
    const v = VIDEO_EXTS.find((e) => lower.endsWith(e));
    if (v) return v;
  }
  if (kind === "image" || kind === "any") {
    const i = IMAGE_EXTS.find((e) => lower.endsWith(e));
    if (i) return i;
  }
  return null;
}

/**
 * 在目录内（含子目录，默认 4 层）查找 mtime >= sinceMs 的最新媒体文件。
 * CLI 偶发把成片下到 download_dir 子文件夹，仅扫一层会漏检。
 */
export async function findNewestMediaUnderDir(
  rootDir: string,
  sinceMs: number,
  maxDepth = 4,
  kind: MediaKind = "any"
): Promise<{ full: string; ext: string; mtimeMs: number } | null> {
  const hits: Array<{ full: string; ext: string; mtimeMs: number }> = [];

  async function walk(dir: string, depth: number): Promise<void> {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const full = path.join(dir, name);
      let st: Awaited<ReturnType<typeof fs.stat>>;
      try {
        st = await fs.stat(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (depth < maxDepth) await walk(full, depth + 1);
        continue;
      }
      const ext = mediaExtForName(name, kind);
      if (!ext) continue;
      if (st.mtimeMs >= sinceMs) {
        hits.push({ full, ext, mtimeMs: st.mtimeMs });
      }
    }
  }

  await walk(rootDir, 0);
  hits.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return hits[0] ?? null;
}
