import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { extractGeneratedFileName, resolveGeneratedDir, toGeneratedUrl } from "@/lib/generatedDir";

function normalizeMediaRelPath(raw: string): string | null {
  const rel = extractGeneratedFileName(raw);
  if (!rel || rel.startsWith(".")) return null;
  return rel;
}

function posterStemForRel(relPath: string) {
  return crypto.createHash("sha1").update(relPath).digest("hex");
}

async function posterAbsPathForRel(relPath: string, ext: string) {
  const generatedRoot = await resolveGeneratedDir();
  return path.join(generatedRoot, ".history", "posters", `${posterStemForRel(relPath)}${ext}`);
}

export async function saveHistoryPosterFromDataUrl(rawMediaUrl: string, posterDataUrl: string) {
  const mediaRel = normalizeMediaRelPath(rawMediaUrl);
  if (!mediaRel) return null;
  const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i.exec(posterDataUrl.trim());
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const base64 = match[2];
  const ext = mime.includes("png") ? ".png" : mime.includes("webp") ? ".webp" : ".jpg";
  const abs = await posterAbsPathForRel(mediaRel, ext);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, Buffer.from(base64, "base64"));
  return toGeneratedUrl(path.posix.join(".history", "posters", path.basename(abs)));
}

export async function getHistoryPosterUrl(rawMediaUrl: string): Promise<string | null> {
  const mediaRel = normalizeMediaRelPath(rawMediaUrl);
  if (!mediaRel) return null;
  for (const ext of [".jpg", ".png", ".webp"]) {
    const abs = await posterAbsPathForRel(mediaRel, ext);
    try {
      const st = await fs.stat(abs);
      if (!st.isFile()) continue;
      return toGeneratedUrl(path.posix.join(".history", "posters", path.basename(abs)));
    } catch {
      /* ignore */
    }
  }
  return null;
}

export async function deleteHistoryPoster(rawMediaUrl: string): Promise<void> {
  const mediaRel = normalizeMediaRelPath(rawMediaUrl);
  if (!mediaRel) return;
  await Promise.all(
    [".jpg", ".png", ".webp"].map(async (ext) => {
      const abs = await posterAbsPathForRel(mediaRel, ext);
      try {
        await fs.unlink(abs);
      } catch {
        /* ignore */
      }
    })
  );
}
