import { spawn } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  dreaminaFileExists,
  resolveRunnableDreaminaBin,
  runDreaminaCli,
} from "@/lib/dreaminaCli";

export type DirProbe = {
  path: string;
  exists: boolean;
  isDir?: boolean;
  entryCount?: number;
};

/** 常见凭证/配置目录（含用户提到的 ~/.jimeng 类路径；dreamina 官方安装脚本也会用 ~/.dreamina_cli）。 */
export function credentialDirCandidates(): string[] {
  const h = os.homedir();
  const uniq = new Set<string>();
  const add = (p: string) => {
    if (p) uniq.add(path.normalize(p));
  };
  add(path.join(h, ".jimeng"));
  add(path.join(h, ".dreamina"));
  add(path.join(h, ".dreamina_cli"));
  add(path.join(h, ".dreamina_cli", "dreamina"));
  add(path.join(h, "bin"));
  if (process.platform === "win32") {
    const roaming = process.env.APPDATA || path.join(h, "AppData", "Roaming");
    const local = process.env.LOCALAPPDATA || path.join(h, "AppData", "Local");
    add(path.join(roaming, "dreamina"));
    add(path.join(local, "dreamina"));
    add(path.join(roaming, "jimeng"));
    add(path.join(local, "jimeng"));
  }
  return [...uniq];
}

export async function probeDir(abs: string): Promise<DirProbe> {
  try {
    const st = await fs.stat(abs);
    if (!st.isDirectory()) {
      return { path: abs, exists: true, isDir: false, entryCount: 1 };
    }
    const entries = await fs.readdir(abs);
    return { path: abs, exists: true, isDir: true, entryCount: entries.length };
  } catch {
    return { path: abs, exists: false };
  }
}

export function isAllowedOpenPath(target: string): boolean {
  let resolved: string;
  try {
    resolved = path.resolve(target);
  } catch {
    return false;
  }
  const r = resolved.toLowerCase();
  const home = path.resolve(os.homedir()).toLowerCase();
  const tmp = path.resolve(os.tmpdir()).toLowerCase();
  const sep = path.sep;
  if (r === home || r.startsWith(home + sep)) return true;
  if (r === tmp || r.startsWith(tmp + sep)) return true;
  for (const c of credentialDirCandidates()) {
    const cc = path.resolve(c).toLowerCase();
    if (r === cc || r.startsWith(cc + sep)) return true;
  }
  return false;
}

export async function collectLoginDiagnostics(): Promise<Record<string, unknown>> {
  const homedir = os.homedir();
  let userInfo: { username: string; uid: number; gid: number; homedir: string };
  try {
    userInfo = os.userInfo();
  } catch {
    userInfo = {
      username: process.env.USERNAME || process.env.USER || "(unknown)",
      uid: -1,
      gid: -1,
      homedir,
    };
  }

  const cliBin = await resolveRunnableDreaminaBin();
  const cliOnDisk =
    cliBin === "dreamina" ? true : await dreaminaFileExists(cliBin);

  let versionText = "";
  try {
    const v = await runDreaminaCli(cliBin, ["version"], 15_000);
    versionText = [v.stdout, v.stderr].filter(Boolean).join("\n").trim();
    if (v.code !== 0 && !versionText) {
      versionText = `(exit ${v.code})`;
    }
  } catch (e) {
    versionText = e instanceof Error ? e.message : String(e);
  }

  let userCreditText = "";
  try {
    const c = await runDreaminaCli(cliBin, ["user_credit"], 25_000);
    userCreditText = [c.stdout, c.stderr].filter(Boolean).join("\n").trim();
    if (c.code !== 0 && !userCreditText) {
      userCreditText = `(exit ${c.code})`;
    }
  } catch (e) {
    userCreditText = e instanceof Error ? e.message : String(e);
  }

  const credentialDirs = await Promise.all(
    credentialDirCandidates().map((p) => probeDir(p))
  );

  const debugLogPath = path.join(homedir, "jimengpro-login-debug.log");
  const launchLogPath = path.join(os.tmpdir(), "jimengpro-launch.log");

  return {
    ok: true,
    platform: process.platform,
    pid: process.pid,
    nodeVersion: process.version,
    userInfo: {
      username: userInfo.username,
      uid: userInfo.uid,
      gid: userInfo.gid,
      homedir: userInfo.homedir,
    },
    env: {
      USERPROFILE: process.env.USERPROFILE,
      USERNAME: process.env.USERNAME,
      APPDATA: process.env.APPDATA,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      HOMEDRIVE: process.env.HOMEDRIVE,
      HOMEPATH: process.env.HOMEPATH,
      JIMENG_APP_ROOT: process.env.JIMENG_APP_ROOT,
      JIMENG_CLI_BIN: process.env.JIMENG_CLI_BIN,
    },
    nodeHomedir: homedir,
    cwd: process.cwd(),
    cliBin,
    cliOnDisk,
    versionText,
    userCreditText,
    credentialDirs,
    paths: {
      debugLogPath,
      launchLogPath,
    },
    hints: [
      "若「以管理员运行」与普通终端登录用户不同，凭证目录会不一致；请尽量用同一用户启动本应用。",
      "网页已登录 ≠ CLI 已登录；以 user_credit 能否解析出积分为准。",
      "回调被拦时可用 JSON 凭证 + dreamina import_login_response，或查看 jimengpro-login-debug.log。",
    ],
  };
}

/** 短时抓取 dreamina login --debug 输出到用户主目录日志（不长期占用端口监听进程由用户自行在终端完成）。 */
export async function captureLoginDebugLog(
  cliBin: string,
  maxMs: number
): Promise<{ ok: boolean; logPath: string; exitCode: number | null; error?: string }> {
  const logPath = path.join(os.homedir(), "jimengpro-login-debug.log");
  return new Promise((resolve) => {
    let settled = false;
    const chunks: string[] = [];
    const child = spawn(cliBin, ["login", "--debug"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });

    const finish = async (exitCode: number | null, err?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const header = `JiMengPro capture ${new Date().toISOString()} pid=${process.pid} exit=${exitCode ?? "timeout"}\n\n`;
      const body = chunks.join("");
      try {
        await fs.writeFile(logPath, header + body, "utf8");
        resolve({
          ok: !err,
          logPath,
          exitCode,
          error: err,
        });
      } catch (e) {
        resolve({
          ok: false,
          logPath,
          exitCode,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    };

    child.stdout?.on("data", (d) => chunks.push(d.toString("utf8")));
    child.stderr?.on("data", (d) => chunks.push(d.toString("utf8")));
    child.on("error", (e) => void finish(null, e instanceof Error ? e.message : String(e)));
    child.on("close", (code) => void finish(code));

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      void finish(null);
    }, maxMs);
  });
}

export function openPathInFileManager(dirOrFile: string): void {
  const resolved = path.resolve(dirOrFile);
  if (process.platform === "win32") {
    spawn("explorer.exe", [resolved], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    return;
  }
  if (process.platform === "darwin") {
    spawn("open", [resolved], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn("xdg-open", [resolved], { detached: true, stdio: "ignore" }).unref();
}
