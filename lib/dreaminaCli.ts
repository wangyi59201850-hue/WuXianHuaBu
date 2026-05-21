import { spawn } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

/**
 * 即梦 CLI 官方说明入口（文档若有迁移，请设置环境变量 JIMENG_CLI_DOCS_URL 覆盖）
 * 备用同页（部分网络环境可访问其一）：larkoffice / feishu 域名可能互通
 */
export const JIMENG_CLI_DOCS_URL =
  process.env.JIMENG_CLI_DOCS_URL?.trim() ||
  "https://bytedance.larkoffice.com/wiki/FVTwwm0bGiishxkKOoScdHR2nsg";

/** 与 JIMENG_CLI_DOCS_URL 二选一备用（仅用于前端「CLI 文档」链接尝试，主链仍用上面常量） */
export const JIMENG_CLI_DOCS_URL_ALT =
  "https://bytedance.feishu.cn/wiki/FVTwwm0bGiishxkKOoScdHR2nsg";

export function resolveDreaminaCliBin(): string {
  const fromEnv = process.env.JIMENG_CLI_BIN?.trim();
  if (fromEnv) return fromEnv;
  if (process.platform === "win32") {
    return path.join(os.homedir(), "bin", "dreamina.exe");
  }
  return "dreamina";
}

export async function dreaminaFileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function runDreaminaCli(
  bin: string,
  args: string[],
  timeoutMs: number
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    const t = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
    }, timeoutMs);

    child.stdout?.on("data", (d) => (stdout += d.toString("utf8")));
    child.stderr?.on("data", (d) => (stderr += d.toString("utf8")));

    child.on("error", (err) => {
      clearTimeout(t);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code, stdout, stderr });
    });
  });
}

export function tryParseJson(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function extractJsonObject(text: string): Record<string, unknown> | null {
  const direct = tryParseJson(text);
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct as Record<string, unknown>;
  }
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const j = tryParseJson(text.slice(first, last + 1));
    if (j && typeof j === "object" && !Array.isArray(j)) return j as Record<string, unknown>;
  }
  return null;
}

export function extractJsonArray(text: string): unknown[] | null {
  const direct = tryParseJson(text);
  if (Array.isArray(direct)) return direct;
  const first = text.indexOf("[");
  const last = text.lastIndexOf("]");
  if (first >= 0 && last > first) {
    const j = tryParseJson(text.slice(first, last + 1));
    if (Array.isArray(j)) return j;
  }
  return null;
}

export async function resolveRunnableDreaminaBin(): Promise<string> {
  const candidate = resolveDreaminaCliBin();
  if ((await dreaminaFileExists(candidate)) || candidate === "dreamina") return candidate;
  return "dreamina";
}

/** 内置 dreamina.exe 可能路径（Electron 下 cwd 常不是应用根目录） */
async function resolveBundledDreaminaExePath(): Promise<string | null> {
  const roots = new Set<string>();
  const fromEnv = process.env.JIMENG_APP_ROOT?.trim();
  if (fromEnv) roots.add(fromEnv);
  roots.add(process.cwd());
  const resPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resPath) {
    roots.add(path.join(resPath, "app"));
  }
  for (const root of roots) {
    if (!root) continue;
    const p = path.join(root, "public", "tools", "dreamina.exe");
    if (await dreaminaFileExists(p)) return p;
  }
  return null;
}

export async function autoInstallDreaminaCli(): Promise<{
  ok: boolean;
  bin: string;
  message: string;
  detail?: string;
}> {
  if (process.platform !== "win32") {
    return { ok: false, bin: resolveDreaminaCliBin(), message: "当前仅支持 Windows 自动安装 CLI。" };
  }

  const downloadUrl = process.env.JIMENG_CLI_DOWNLOAD_URL?.trim();
  const targetBin = path.join(os.homedir(), "bin", "dreamina.exe");
  const bundledCandidate = await resolveBundledDreaminaExePath();

  try {
    await fs.mkdir(path.dirname(targetBin), { recursive: true });
    if (bundledCandidate) {
      await fs.copyFile(bundledCandidate, targetBin);
    } else {
      if (!downloadUrl) {
        return {
          ok: false,
          bin: targetBin,
          message: "未配置 JIMENG_CLI_DOWNLOAD_URL，且未找到内置 dreamina.exe。",
        };
      }
      const res = await fetch(downloadUrl, { redirect: "follow" });
      if (!res.ok) {
        return {
          ok: false,
          bin: targetBin,
          message: `CLI 下载失败：HTTP ${res.status}`,
        };
      }

      const ab = await res.arrayBuffer();
      const tmp = `${targetBin}.download`;
      await fs.writeFile(tmp, Buffer.from(ab));
      await fs.rename(tmp, targetBin);
    }

    const vr = await runDreaminaCli(targetBin, ["version"], 20_000);
    if (vr.code !== 0) {
      return {
        ok: false,
        bin: targetBin,
        message: "CLI 文件已下载，但启动校验失败。",
        detail: (vr.stderr || vr.stdout || "").slice(0, 400),
      };
    }

    return { ok: true, bin: targetBin, message: "CLI 自动安装成功。" };
  } catch (e: unknown) {
    return {
      ok: false,
      bin: targetBin,
      message: "CLI 自动安装异常。",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}
