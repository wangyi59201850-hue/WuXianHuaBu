import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  cloudGeneratedDir,
  isCloudDeployment,
  isRemoteMediaUrl,
} from "@/lib/cloudDeployment";
import { logMediaDebug } from "@/lib/mediaPathDebug";

type CacheSettings = {
  generatedDir?: string;
  cacheSetupCompleted?: boolean;
};

const LEGACY_URL_PREFIX = "/outputs/generated/";
const API_URL_PREFIX = "/api/generated/file?name=";

export function defaultGeneratedDir() {
  if (isCloudDeployment()) {
    return cloudGeneratedDir();
  }
  const appRoot = process.env.JIMENG_APP_ROOT?.trim();
  if (appRoot) {
    return path.join(appRoot, "public", "outputs", "generated");
  }
  return path.join(
    /*turbopackIgnore: true*/ process.cwd(),
    "public",
    "outputs",
    "generated"
  );
}

function settingsFilePath() {
  const fromEnv = process.env.JIMENG_SETTINGS_PATH?.trim();
  if (fromEnv) return fromEnv;
  return path.join(os.homedir(), ".jimengpro", "settings.json");
}

async function readSettings(): Promise<CacheSettings> {
  try {
    const raw = await fs.readFile(settingsFilePath(), "utf8");
    const parsed = JSON.parse(raw) as CacheSettings;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

let resolveGeneratedDirLogged = false;

export async function resolveGeneratedDir() {
  if (isCloudDeployment()) {
    const dir = cloudGeneratedDir();
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  const fromEnv = process.env.JIMENG_GENERATED_DIR?.trim();
  if (fromEnv) {
    const dir = path.resolve(fromEnv);
    await fs.mkdir(dir, { recursive: true });
    if (!resolveGeneratedDirLogged) {
      resolveGeneratedDirLogged = true;
      logMediaDebug("resolveGeneratedDir: using JIMENG_GENERATED_DIR", {
        dir,
        appRoot: process.env.JIMENG_APP_ROOT ?? null,
      });
    }
    return dir;
  }

  const settings = await readSettings();
  const configured =
    typeof settings.generatedDir === "string" ? settings.generatedDir.trim() : "";
  const dir = configured ? path.resolve(configured) : defaultGeneratedDir();
  await fs.mkdir(dir, { recursive: true });
  if (!resolveGeneratedDirLogged) {
    resolveGeneratedDirLogged = true;
    logMediaDebug("resolveGeneratedDir: using settings or default", {
      dir,
      configured: configured || null,
      defaultDir: defaultGeneratedDir(),
      appRoot: process.env.JIMENG_APP_ROOT ?? null,
    });
  }
  return dir;
}

export async function setGeneratedDir(absDir: string) {
  if (isCloudDeployment()) {
    const dir = cloudGeneratedDir();
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  const dir = path.resolve(absDir);
  await fs.mkdir(dir, { recursive: true });
  const file = settingsFilePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const current = await readSettings();
  const packaged = process.env.JIMENG_ELECTRON_PACKAGED === "1";
  const next: CacheSettings = {
    ...current,
    generatedDir: dir,
    ...(packaged ? { cacheSetupCompleted: true } : {}),
  };
  await fs.writeFile(file, JSON.stringify(next, null, 2), "utf8");
  process.env.JIMENG_GENERATED_DIR = dir;
  resolveGeneratedDirLogged = false;
  logMediaDebug("setGeneratedDir: updated JIMENG_GENERATED_DIR + settings", {
    dir,
  });
  return dir;
}

export async function getGeneratedDirConfig() {
  if (isCloudDeployment()) {
    const effectiveDir = await resolveGeneratedDir();
    return {
      configured: null,
      current: effectiveDir,
      defaultDir: effectiveDir,
      effectiveDir,
      fromEnv: null,
      needsPackagedCacheOnboarding: false,
      electronPackaged: false,
    };
  }

  const packaged = process.env.JIMENG_ELECTRON_PACKAGED === "1";
  let settings = await readSettings();
  if (packaged && settings.cacheSetupCompleted !== true) {
    const configured =
      typeof settings.generatedDir === "string" ? settings.generatedDir.trim() : "";
    if (configured) {
      const file = settingsFilePath();
      await fs.mkdir(path.dirname(file), { recursive: true });
      const next: CacheSettings = { ...settings, cacheSetupCompleted: true };
      await fs.writeFile(file, JSON.stringify(next, null, 2), "utf8");
      settings = next;
    }
  }
  const configured =
    typeof settings.generatedDir === "string" ? settings.generatedDir.trim() : "";
  const effectiveDir = await resolveGeneratedDir();
  return {
    configured: configured || null,
    current: configured ? path.resolve(configured) : defaultGeneratedDir(),
    defaultDir: defaultGeneratedDir(),
    effectiveDir,
    fromEnv: process.env.JIMENG_GENERATED_DIR?.trim() || null,
    needsPackagedCacheOnboarding:
      packaged && settings.cacheSetupCompleted !== true && !configured,
    electronPackaged: packaged,
  };
}

function normalizeGeneratedRelPath(raw: string): string | null {
  const text = raw.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!text) return null;
  const parts = text.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.some((part) => part === "." || part === "..")) return null;
  return parts.join("/");
}

export function toGeneratedUrl(name: string) {
  if (isRemoteMediaUrl(name)) return name.trim();
  const rel =
    normalizeGeneratedRelPath(name) ?? path.posix.basename(name.trim());
  return `${API_URL_PREFIX}${encodeURIComponent(rel)}`;
}

export function extractGeneratedFileName(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  try {
    if (text.startsWith("http://") || text.startsWith("https://")) {
      const url = new URL(text);
      if (url.pathname === "/api/generated/file") {
        const query = url.searchParams.get("name")?.trim();
        return query ? normalizeGeneratedRelPath(query) : null;
      }
      if (url.pathname.startsWith(LEGACY_URL_PREFIX)) {
        const rel = url.pathname.slice(LEGACY_URL_PREFIX.length).trim();
        return rel ? normalizeGeneratedRelPath(rel) : null;
      }
    }
  } catch {
    // fall through
  }

  if (text.startsWith(API_URL_PREFIX)) {
    const query = text.slice(API_URL_PREFIX.length).trim();
    if (!query) return null;
    try {
      return normalizeGeneratedRelPath(decodeURIComponent(query));
    } catch {
      return normalizeGeneratedRelPath(query);
    }
  }

  const pathname = text.split("?")[0].split("#")[0];
  if (pathname.startsWith(LEGACY_URL_PREFIX)) {
    const rel = pathname.slice(LEGACY_URL_PREFIX.length).trim();
    return rel ? normalizeGeneratedRelPath(rel) : null;
  }
  return null;
}
