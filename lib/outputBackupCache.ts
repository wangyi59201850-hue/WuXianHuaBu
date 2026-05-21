/**
 * 将当前节点的成片备份到磁盘输出目录：`generated/.backup/{nodeId}/{时间戳_随机}/`
 * 通过服务端复制同目录下的源文件，不经过浏览器再上传；多节点按 nodeId 分子目录。
 */

function toPublicGeneratedPath(u: string): string | null {
  const s = u.trim();
  if (!s) return null;
  try {
    if (s.startsWith("http://") || s.startsWith("https://")) {
      const url = new URL(s);
      if (url.pathname === "/api/generated/file") {
        const n = url.searchParams.get("name")?.trim();
        return n ? `/outputs/generated/${n}` : null;
      }
      const p = url.pathname.split("?")[0].split("#")[0];
      if (p.startsWith("/outputs/generated/")) return p;
      return null;
    }
  } catch {
    return null;
  }
  if (s.startsWith("/api/generated/file?name=")) {
    const q = s.slice("/api/generated/file?name=".length).trim();
    if (!q) return null;
    try {
      return `/outputs/generated/${decodeURIComponent(q)}`;
    } catch {
      return `/outputs/generated/${q}`;
    }
  }
  const pathname = s.split("?")[0].split("#")[0];
  if (!pathname.startsWith("/outputs/generated/")) return null;
  return pathname;
}

export async function backupGeneratedMediaToCache(
  nodeId: string,
  _kind: "image" | "video",
  urls: string[]
): Promise<
  { ok: true; backupKey: string; files: string[] } | { ok: false; message: string }
> {
  const clean = urls.map((u) => u.trim()).filter(Boolean);
  if (clean.length === 0) {
    return { ok: false, message: "没有可备份的成片地址" };
  }

  const paths: string[] = [];
  for (const u of clean) {
    const p = toPublicGeneratedPath(u);
    if (!p) {
      return {
        ok: false,
        message: `仅支持备份本站输出路径 /outputs/generated/ 下的文件：${u.slice(0, 80)}`,
      };
    }
    paths.push(p);
  }

  try {
    const res = await fetch("/api/backup-output", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId, paths }),
    });
    const j = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      backupKey?: string;
      files?: string[];
      error?: string;
    };
    if (!res.ok || !j.ok) {
      return { ok: false, message: j.error || `备份失败（HTTP ${res.status}）` };
    }
    if (typeof j.backupKey !== "string" || !j.backupKey) {
      return { ok: false, message: "备份接口未返回 backupKey" };
    }
    return {
      ok: true,
      backupKey: j.backupKey,
      files: Array.isArray(j.files) ? j.files.filter((x): x is string => typeof x === "string") : [],
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `备份请求失败：${msg}` };
  }
}
