import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "path";
import { Readable } from "node:stream";
import { resolveGeneratedDir } from "@/lib/generatedDir";
import { logMediaDebug } from "@/lib/mediaPathDebug";

export const runtime = "nodejs";

function contentTypeFor(name: string) {
  const n = name.toLowerCase();
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".gif")) return "image/gif";
  if (n.endsWith(".bmp")) return "image/bmp";
  if (n.endsWith(".mp4")) return "video/mp4";
  if (n.endsWith(".webm")) return "video/webm";
  if (n.endsWith(".mov")) return "video/quicktime";
  if (n.endsWith(".mkv")) return "video/x-matroska";
  if (n.endsWith(".m4v")) return "video/x-m4v";
  return "application/octet-stream";
}

function parseRange(rangeHeader: string | null, size: number): { start: number; end: number } | null {
  if (!rangeHeader) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!m) return null;
  const a = m[1];
  const b = m[2];
  let start: number;
  let end: number;
  if (a === "" && b === "") return null;
  if (a === "" && b !== "") {
    const suffix = parseInt(b, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else if (a !== "" && b === "") {
    start = parseInt(a, 10);
    if (!Number.isFinite(start) || start < 0) return null;
    end = size - 1;
  } else {
    start = parseInt(a, 10);
    end = parseInt(b, 10);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return null;
  }
  if (start >= size) return null;
  end = Math.min(end, size - 1);
  return { start, end };
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = u.searchParams.get("name")?.trim();
  if (!q) return new Response("missing name", { status: 400 });
  const root = await resolveGeneratedDir();
  const relName = q.replace(/\\/g, "/").replace(/^\/+/, "");
  const abs = path.resolve(root, relName);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return new Response("forbidden", { status: 403 });
  }
  const nameForType = path.basename(relName);

  let st;
  try {
    st = await stat(abs);
  } catch {
    logMediaDebug("GET /api/generated/file: not found", {
      relName,
      abs,
      root,
      cwd: process.cwd(),
      jimengAppRoot: process.env.JIMENG_APP_ROOT ?? null,
      jimengGeneratedDir: process.env.JIMENG_GENERATED_DIR ?? null,
    });
    return new Response("not found", { status: 404 });
  }
  if (!st.isFile()) {
    logMediaDebug("GET /api/generated/file: not a file", {
      relName,
      abs,
      root,
      isDirectory: st.isDirectory(),
    });
    return new Response("not found", { status: 404 });
  }

  const size = st.size;
  const ctype = contentTypeFor(nameForType);
  const range = parseRange(req.headers.get("range"), size);

  if (range) {
    const { start, end } = range;
    const len = end - start + 1;
    const nodeStream = createReadStream(abs, { start, end });
    const web = Readable.toWeb(nodeStream);
    return new Response(web as unknown as BodyInit, {
      status: 206,
      headers: {
        "Content-Type": ctype,
        "Content-Length": String(len),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache",
      },
    });
  }

  const nodeStream = createReadStream(abs);
  const web = Readable.toWeb(nodeStream);
  return new Response(web as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": ctype,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache",
    },
  });
}
