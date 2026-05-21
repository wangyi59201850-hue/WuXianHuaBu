import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

export type BrowserOption = {
  id: string;
  name: string;
  bin: string | null;
};

type BrowserDef = {
  id: string;
  name: string;
  exe: string;
  candidates: string[];
};

function firstExistingPath(paths: string[]): string | null {
  for (const p of paths) {
    if (!p) continue;
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

function resolveFromPath(exe: string): string | null {
  try {
    const r = spawnSync("where", [exe], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 3000,
    });
    if (r.status !== 0) return null;
    const out = `${r.stdout || ""}`
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    return out[0] || null;
  } catch {
    return null;
  }
}

function windowsBrowserDefs(): BrowserDef[] {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const pf = process.env.ProgramFiles || "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

  return [
    {
      id: "edge",
      name: "Microsoft Edge",
      exe: "msedge.exe",
      candidates: [
        path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
        path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
      ],
    },
    {
      id: "chrome",
      name: "Google Chrome",
      exe: "chrome.exe",
      candidates: [
        path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
      ],
    },
    {
      id: "firefox",
      name: "Mozilla Firefox",
      exe: "firefox.exe",
      candidates: [
        path.join(pf, "Mozilla Firefox", "firefox.exe"),
        path.join(pf86, "Mozilla Firefox", "firefox.exe"),
      ],
    },
    {
      id: "brave",
      name: "Brave",
      exe: "brave.exe",
      candidates: [
        path.join(pf, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        path.join(pf86, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        path.join(local, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      ],
    },
  ];
}

function resolveWindowsBrowsers(): BrowserOption[] {
  const options: BrowserOption[] = [
    { id: "system", name: "系统默认浏览器", bin: null },
  ];

  for (const def of windowsBrowserDefs()) {
    const direct = firstExistingPath(def.candidates);
    const fromPath = direct ? null : resolveFromPath(def.exe);
    const bin = direct || fromPath;
    if (!bin) continue;
    options.push({ id: def.id, name: def.name, bin });
  }

  return options;
}

export function listInstalledBrowsers(): BrowserOption[] {
  if (process.platform === "win32") {
    return resolveWindowsBrowsers();
  }
  return [{ id: "system", name: "System Default Browser", bin: null }];
}

export function resolveBrowserBinById(browserId?: string | null): string | null {
  if (!browserId || browserId === "system") return null;
  const options = listInstalledBrowsers();
  const found = options.find((o) => o.id === browserId);
  return found?.bin || null;
}
