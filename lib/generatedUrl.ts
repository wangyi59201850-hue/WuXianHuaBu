const LEGACY_URL_PREFIX = "/outputs/generated/";
const API_URL_PREFIX = "/api/generated/file?name=";

function normalizeGeneratedRelPath(raw: string): string | null {
  const s = raw.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!s) return null;
  const parts = s.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.some((part) => part === "." || part === "..")) return null;
  return parts.join("/");
}

export function extractGeneratedFileName(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  try {
    if (s.startsWith("http://") || s.startsWith("https://")) {
      const u = new URL(s);
      if (u.pathname === "/api/generated/file") {
        const q = u.searchParams.get("name")?.trim();
        return q ? normalizeGeneratedRelPath(q) : null;
      }
      if (u.pathname.startsWith(LEGACY_URL_PREFIX)) {
        const rel = u.pathname.slice(LEGACY_URL_PREFIX.length).trim();
        return rel ? normalizeGeneratedRelPath(rel) : null;
      }
    }
  } catch {
    /* fall through */
  }

  if (s.startsWith(API_URL_PREFIX)) {
    const q = s.slice(API_URL_PREFIX.length).trim();
    if (!q) return null;
    try {
      return normalizeGeneratedRelPath(decodeURIComponent(q));
    } catch {
      return normalizeGeneratedRelPath(q);
    }
  }

  const pathname = s.split("?")[0].split("#")[0];
  if (pathname.startsWith(LEGACY_URL_PREFIX)) {
    const rel = pathname.slice(LEGACY_URL_PREFIX.length).trim();
    return rel ? normalizeGeneratedRelPath(rel) : null;
  }
  return null;
}

export function withGeneratedMediaCacheBust(
  raw: string,
  token: string | number | null | undefined
): string {
  const s = raw.trim();
  if (!s || token == null || token === "") return s;
  if (!extractGeneratedFileName(s)) return s;

  const hashless = s.split("#")[0] ?? s;
  const qIndex = hashless.indexOf("?");
  const pathname = qIndex >= 0 ? hashless.slice(0, qIndex) : hashless;
  const search = qIndex >= 0 ? hashless.slice(qIndex + 1) : "";
  const params = new URLSearchParams(search);
  params.set("cb", String(token));
  const nextSearch = params.toString();
  return nextSearch ? `${pathname}?${nextSearch}` : pathname;
}
