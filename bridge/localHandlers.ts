import fs from "fs/promises";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { GET as generatedFileGet } from "@/app/api/generated/file/route";
import { POST as generatePost } from "@/app/api/generate/route";
import {
  autoInstallDreaminaCli,
  extractJsonArray,
  extractJsonObject,
  JIMENG_CLI_DOCS_URL,
  JIMENG_CLI_DOCS_URL_ALT,
  resolveRunnableDreaminaBin,
  runDreaminaCli,
} from "@/lib/dreaminaCli";
import { listInstalledBrowsers, resolveBrowserBinById } from "@/lib/browserDetect";
import {
  downloadBanana2ImageToPath,
  extractBanana2TaskId,
  queryBanana2ImageTask,
} from "@/lib/banana2Image";
import { extractExternalVideoTaskRef } from "@/lib/cliVideoModels";
import {
  downloadForopencodeVideoToPath,
  queryForopencodeVideoTask,
} from "@/lib/foropencodeVideo";
import { findNewestMediaUnderDir } from "@/lib/scanGeneratedMedia";
import { unlinkCliArtifactAfterCopy } from "@/lib/unlinkCliArtifactAfterCopy";
import { resolveGeneratedDir, toGeneratedUrl } from "@/lib/generatedDir";
import {
  findGenerationTasksForSource,
  readGenerationTasks,
  snapshotGeneratedOutputForTask,
  type GenerationTaskRecord,
  upsertGenerationTask,
} from "@/lib/generationTaskLedger";
import { rewriteBridgeResponse } from "@/bridge/shared";

const MIN_CREDENTIAL_SIZE_BYTES = 3 * 1024;

function clipText(input: string, max = 900) {
  const text = input.trim();
  return text.length <= max ? text : `${text.slice(0, max)}...<truncated>`;
}

function sanitizeNodeId(nodeId: string) {
  return nodeId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function taskSubmitId(row: unknown) {
  if (!row || typeof row !== "object") return "";
  const obj = row as Record<string, unknown>;
  return (
    (typeof obj.submit_id === "string" && obj.submit_id.trim()) ||
    (typeof obj.submitId === "string" && obj.submitId.trim()) ||
    ""
  );
}

function localTaskToApiRow(task: GenerationTaskRecord) {
  return {
    source: "local_bridge",
    submit_id: task.submitId,
    submitId: task.submitId,
    gen_status: task.status,
    status: task.status,
    gen_task_type: task.mediaType,
    task_type: task.mediaType,
    provider:
      task.provider ??
      (task.videoProvider === "external_api" ? "external_video_api" : "dreamina"),
    upstream_id: task.upstreamId,
    request_id: task.upstreamId,
    upstream_task_url: task.upstreamTaskUrl,
    upstream_provider_id: task.upstreamProviderId,
    upstream_image_size: task.upstreamImageSize,
    upstream_image_quality: task.upstreamImageQuality,
    usage: task.usage,
    upstream_cost: task.upstreamCost,
    upstream_cost_currency: task.upstreamCostCurrency,
    upstream_cost_source: task.upstreamCostSource,
    fail_reason: task.failReason,
    prompt: task.promptText,
    model_version: task.modelVersion,
    ratio: task.ratio,
    resolution_type: task.resolutionType,
    count: task.count,
    media_type: task.mediaType,
    output_url: task.outputUrl,
    file_name: task.fileName,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    events: task.events ?? [],
  };
}

async function hasLocalCredential() {
  const file = path.join(os.homedir(), ".dreamina_cli", "credential.json");
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function launchWindowsOfficialLogin(cliBin: string, browserBin: string | null) {
  spawn(cliBin, ["login"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: false,
    env: browserBin ? { ...process.env, BROWSER: browserBin } : process.env,
  }).unref();
}

function launchPosixOfficialLogin(cliBin: string, browserBin: string | null) {
  spawn("sh", ["-lc", `"${cliBin}" login`], {
    detached: true,
    stdio: "ignore",
    shell: false,
    env: browserBin ? { ...process.env, BROWSER: browserBin } : process.env,
  }).unref();
}

export async function healthHandler() {
  return Response.json({
    ok: true,
    mode: "local-bridge",
    platform: process.platform,
    generatedDir: await resolveGeneratedDir(),
  });
}

export async function cliBootstrapHandler() {
  let cliBin = await resolveRunnableDreaminaBin();
  try {
    await runDreaminaCli(cliBin, ["version"], 10_000);
    return Response.json({
      ok: true,
      installed: false,
      cliBin,
      message: "CLI 已就绪。",
    });
  } catch {
    // continue
  }

  if (process.platform !== "win32") {
    return Response.json({
      ok: false,
      installed: false,
      cliBin,
      message: "当前平台不支持自动安装 CLI。",
    });
  }

  const auto = await autoInstallDreaminaCli();
  if (!auto.ok) {
    return Response.json({
      ok: false,
      installed: false,
      cliBin: auto.bin || cliBin,
      message: auto.message || "CLI 自动安装失败。",
      detail: auto.detail || "",
    });
  }

  cliBin = auto.bin;
  return Response.json({
    ok: true,
    installed: true,
    cliBin,
    message: "已自动安装 CLI，请继续登录。",
  });
}

export async function cliMetaHandler() {
  try {
    const cliBin = await resolveRunnableDreaminaBin();
    const res = await runDreaminaCli(cliBin, ["version"], 12_000);
    if (res.code !== 0) {
      return Response.json({
        ok: false,
        cliReady: false,
        error: (res.stderr || res.stdout || "CLI version failed").slice(0, 400),
        docsUrl: JIMENG_CLI_DOCS_URL,
        docsUrlAlt: JIMENG_CLI_DOCS_URL_ALT,
        version: null,
        loggedIn: false,
        totalCredit: null,
      });
    }
    const combined = `${res.stdout}\n${res.stderr}`.trim();
    const versionLine = combined.split("\n").filter(Boolean)[0] ?? null;
    let userCredit: number | null = null;
    try {
      const creditRes = await runDreaminaCli(cliBin, ["user_credit"], 20_000);
      const parsed =
        extractJsonObject(creditRes.stdout) ??
        extractJsonObject(`${creditRes.stdout}\n${creditRes.stderr}`);
      const value = parsed?.total_credit;
      if (typeof value === "number") userCredit = value;
    } catch {
      // ignore
    }
    return Response.json({
      ok: true,
      cliReady: true,
      version: versionLine,
      docsUrl: JIMENG_CLI_DOCS_URL,
      docsUrlAlt: JIMENG_CLI_DOCS_URL_ALT,
      loggedIn: typeof userCredit === "number",
      totalCredit: userCredit,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({
      ok: false,
      cliReady: false,
      error: message,
      docsUrl: JIMENG_CLI_DOCS_URL,
      docsUrlAlt: JIMENG_CLI_DOCS_URL_ALT,
      version: null,
      loggedIn: false,
      totalCredit: null,
    });
  }
}

export async function creditHandler() {
  try {
    const cliBin = await resolveRunnableDreaminaBin();
    const credentialFound = await hasLocalCredential();
    const res = await runDreaminaCli(cliBin, ["user_credit"], 30_000);
    const parsed =
      extractJsonObject(res.stdout) ??
      extractJsonObject(`${res.stdout}\n${res.stderr}`);
    const totalCredit =
      typeof parsed?.total_credit === "number" ? parsed.total_credit : null;
    return Response.json({
      totalCredit,
      ok: typeof totalCredit === "number",
      credentialFound,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to query credit";
    return Response.json(
      { error: message, ok: false, credentialFound: false },
      { status: 500 }
    );
  }
}

export async function loginHandler(req: Request) {
  try {
    let browserId: string | null = null;
    try {
      const body = (await req.json()) as { browserId?: string };
      browserId =
        body && typeof body.browserId === "string" ? body.browserId.trim() || null : null;
    } catch {
      // ignore
    }
    const browserBin = resolveBrowserBinById(browserId);
    let cliBin = await resolveRunnableDreaminaBin();

    try {
      await runDreaminaCli(cliBin, ["version"], 10_000);
    } catch (error) {
      if (process.platform === "win32") {
        const auto = await autoInstallDreaminaCli();
        if (auto.ok) {
          cliBin = auto.bin;
        } else {
          return Response.json({
            ok: false,
            launched: false,
            error: "未检测到可用的即梦 CLI（dreamina），且自动安装失败。",
            detail: auto.detail || (error instanceof Error ? error.message : String(error)),
            docsUrl: JIMENG_CLI_DOCS_URL,
            autoInstallMessage: auto.message,
          });
        }
      } else {
        return Response.json({
          ok: false,
          launched: false,
          error: "未检测到可用的即梦 CLI（dreamina）。请先安装后再登录。",
          detail: error instanceof Error ? error.message : String(error),
          docsUrl: JIMENG_CLI_DOCS_URL,
        });
      }
    }

    try {
      const creditRes = await runDreaminaCli(cliBin, ["user_credit"], 25_000);
      const parsed =
        extractJsonObject(creditRes.stdout) ??
        extractJsonObject(`${creditRes.stdout}\n${creditRes.stderr}`);
      if (typeof parsed?.total_credit === "number") {
        return Response.json({
          ok: true,
          alreadyLoggedIn: true,
          launched: false,
          message: "当前已登录即梦 CLI，无需重复登录。",
          totalCredit: parsed.total_credit,
          cliBin,
        });
      }
    } catch {
      // continue to login
    }

    if (process.platform === "win32") {
      launchWindowsOfficialLogin(cliBin, browserBin);
    } else {
      launchPosixOfficialLogin(cliBin, browserBin);
    }

    return Response.json({
      ok: true,
      launched: true,
      mode: "terminal",
      message: "已启动 dreamina login，请在弹出的终端中完成登录。",
      cliBin,
      docsUrl: JIMENG_CLI_DOCS_URL,
      browserId: browserId ?? "system",
      browserApplied: Boolean(browserId && browserBin),
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "login launch failed" },
      { status: 500 }
    );
  }
}

export async function logoutHandler() {
  try {
    const cliBin = await resolveRunnableDreaminaBin();
    const res = await runDreaminaCli(cliBin, ["logout"], 20_000).catch(() => null);
    return Response.json({
      ok: res ? res.code === 0 : true,
      message: res?.code === 0 ? "已退出 dreamina CLI。" : "已请求退出 dreamina CLI。",
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "logout failed" },
      { status: 500 }
    );
  }
}

export async function browsersHandler() {
  try {
    return Response.json({ ok: true, options: listInstalledBrowsers() });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        options: [],
      },
      { status: 500 }
    );
  }
}

export async function credentialHealthHandler() {
  try {
    const credentialPath = path.join(os.homedir(), ".dreamina_cli", "credential.json");
    let exists = false;
    let sizeBytes = 0;
    try {
      const st = await fs.stat(credentialPath);
      exists = st.isFile();
      sizeBytes = exists ? Number(st.size || 0) : 0;
    } catch {
      // ignore
    }
    return Response.json({
      ok: true,
      exists,
      sizeBytes,
      minBytes: MIN_CREDENTIAL_SIZE_BYTES,
      tooSmall: exists && sizeBytes > 0 && sizeBytes < MIN_CREDENTIAL_SIZE_BYTES,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        exists: false,
        sizeBytes: 0,
        tooSmall: false,
      },
      { status: 500 }
    );
  }
}

export async function generatedLatestHandler(req: Request) {
  const sourceNodeId = new URL(req.url).searchParams.get("sourceNodeId")?.trim();
  if (!sourceNodeId) {
    return Response.json({ error: "missing sourceNodeId" }, { status: 400 });
  }
  const safe = sanitizeNodeId(sourceNodeId);
  const dir = await resolveGeneratedDir();
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    names = [];
  }
  const re = new RegExp(`^${safe}_(\\d+)\\.(mp4|webm|mov|mkv|m4v|png|jpe?g|webp|bmp|gif)$`, "i");
  const hits = names
    .map((name) => {
      const match = name.match(re);
      return match ? { name, idx: Number(match[1]) } : null;
    })
    .filter((item): item is { name: string; idx: number } => Boolean(item))
    .sort((a, b) => a.idx - b.idx);
  const urls = hits.map((hit) => toGeneratedUrl(hit.name));
  const tasks = (await findGenerationTasksForSource(sourceNodeId))
    .filter((task) => task.status === "submitted" || task.status === "running")
    .slice(0, 20)
    .map((task) => ({
      submitId: task.submitId,
      mediaType: task.mediaType,
      index: task.index,
      status: task.status,
      updatedAt: task.updatedAt,
    }));
  return Response.json({
    urls,
    tasks,
    submitIds: tasks.map((task) => task.submitId),
  });
}

export async function generatedSyncHandler(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { submitId?: string; sourceNodeId?: string; index?: number }
    | null;
  const submitId = body?.submitId?.trim();
  const sourceNodeId = body?.sourceNodeId?.trim();
  const index = typeof body?.index === "number" && body.index >= 0 ? body.index : 0;
  if (!submitId || !sourceNodeId) {
    return Response.json({ error: "missing submitId or sourceNodeId" }, { status: 400 });
  }

  const outDir = await resolveGeneratedDir();
  await fs.mkdir(outDir, { recursive: true });
  const safeNodeId = sanitizeNodeId(sourceNodeId);

  const banana2TaskId = extractBanana2TaskId(submitId);
  if (banana2TaskId) {
    const state = await queryBanana2ImageTask(banana2TaskId);
    if (state.status !== "completed") {
      return Response.json({
        ok: false,
        urls: [],
        error:
          state.status === "failed"
            ? state.failReason || "banana2 image task failed."
            : "banana2 image task is still running.",
      });
    }
    const targetPath = path.join(outDir, `${safeNodeId}_${index}.png`);
    await downloadBanana2ImageToPath(state.imageUrl, targetPath);
    const targetName = path.basename(targetPath);
    const snap = await snapshotGeneratedOutputForTask({
      submitId,
      outputRelPath: targetName,
    }).catch(() => null);
    await upsertGenerationTask({
      submitId,
      sourceNodeId: safeNodeId,
      index,
      mediaType: "image",
      status: "completed",
      outputUrl: snap?.outputUrl ?? toGeneratedUrl(targetName),
      fileName: snap?.fileName ?? targetName,
    });
    return Response.json({ ok: true, urls: [toGeneratedUrl(targetName)] });
  }

  const videoTaskRef = extractExternalVideoTaskRef(submitId);
  if (videoTaskRef) {
    const state = await queryForopencodeVideoTask(videoTaskRef.taskId, videoTaskRef.taskUrl);
    if (state.status !== "completed") {
      return Response.json({
        ok: false,
        urls: [],
        error:
          state.status === "failed"
            ? state.failReason || "ForOpenCode video generation failed."
            : "ForOpenCode video task is still running.",
      });
    }
    const targetPath = path.join(outDir, `${safeNodeId}_${index}.mp4`);
    await downloadForopencodeVideoToPath(state.videoUrl, targetPath);
    const targetName = path.basename(targetPath);
    const snap = await snapshotGeneratedOutputForTask({
      submitId,
      outputRelPath: targetName,
    }).catch(() => null);
    await upsertGenerationTask({
      submitId,
      sourceNodeId: safeNodeId,
      index,
      mediaType: "video",
      status: "completed",
      outputUrl: snap?.outputUrl ?? toGeneratedUrl(targetName),
      fileName: snap?.fileName ?? targetName,
    });
    return Response.json({ ok: true, urls: [toGeneratedUrl(targetName)] });
  }

  const sinceMs = Date.now() - 5000;
  let cliBin: string;
  try {
    cliBin = await resolveRunnableDreaminaBin();
  } catch (error) {
    return Response.json(
      { ok: false, urls: [], error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }

  const queryResult = await runDreaminaCli(
    cliBin,
    ["query_result", `--submit_id=${submitId}`, `--download_dir=${outDir}`],
    120_000
  ).catch((error) => {
    throw new Error(error instanceof Error ? error.message : String(error));
  });

  let hit = await findNewestMediaUnderDir(outDir, sinceMs, 4, "any");
  if (!hit) {
    hit = await findNewestMediaUnderDir(outDir, Date.now() - 120_000, 4, "any");
  }
  if (!hit) {
    return Response.json({
      ok: false,
      urls: [],
      error: "下载后仍未在输出目录中检测到新媒体文件。",
      cliCode: queryResult.code,
      cliPreview: clipText(`${queryResult.stdout}\n${queryResult.stderr}`),
    });
  }

  const targetPath = path.join(outDir, `${safeNodeId}_${index}${hit.ext}`);
  await fs.copyFile(hit.full, targetPath);
  await unlinkCliArtifactAfterCopy({
    outDirAbs: outDir,
    downloadedPath: hit.full,
    finalPath: targetPath,
  });
  const name = path.basename(targetPath);
  const snap = await snapshotGeneratedOutputForTask({
    submitId,
    outputRelPath: name,
  }).catch(() => null);
  await upsertGenerationTask({
    submitId,
    sourceNodeId: safeNodeId,
    index,
    mediaType: /\.(mp4|webm|mov|mkv|m4v)$/i.test(name) ? "video" : "image",
    status: "completed",
    outputUrl: snap?.outputUrl ?? toGeneratedUrl(name),
    fileName: snap?.fileName ?? name,
  });
  return Response.json({ ok: true, urls: [toGeneratedUrl(name)] });
}

export async function tasksHandler(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? 30) || 30));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
    const genStatus = url.searchParams.get("gen_status")?.trim();
    const genTaskType = url.searchParams.get("gen_task_type")?.trim();
    const submitId = url.searchParams.get("submit_id")?.trim();

    const localRows = (await readGenerationTasks())
      .filter((task) => (submitId ? task.submitId === submitId || task.upstreamId === submitId : true))
      .filter((task) => (genStatus ? task.status === genStatus : true))
      .filter((task) => (genTaskType ? task.mediaType === genTaskType : true))
      .slice(offset, offset + limit)
      .map(localTaskToApiRow);

    let cliRows: unknown[] = [];
    let code: number | null = null;
    let hint: string | undefined;
    let rawPreview: string | undefined;

    try {
      const cliBin = await resolveRunnableDreaminaBin();
      const args = ["list_task", "--limit", String(limit), "--offset", String(offset)];
      if (genStatus) args.push("--gen_status", genStatus);
      if (genTaskType) args.push("--gen_task_type", genTaskType);
      if (submitId) args.push("--submit_id", submitId);

      const res = await runDreaminaCli(cliBin, args, 45_000);
      code = res.code;
      const combined = `${res.stdout}\n${res.stderr}`;
      const parsed = extractJsonArray(res.stdout) ?? extractJsonArray(combined);
      if (Array.isArray(parsed)) {
        cliRows = parsed;
      } else {
        hint = "无法解析 dreamina list_task 输出。";
        rawPreview = combined.slice(0, 800);
      }
    } catch (error) {
      hint = error instanceof Error ? error.message : String(error);
    }

    const bySubmitId = new Map<string, Record<string, unknown>>();
    for (const row of localRows) {
      bySubmitId.set(String(row.submit_id), row);
    }
    for (const row of cliRows) {
      const sid = taskSubmitId(row);
      if (!sid) continue;
      const prev = bySubmitId.get(sid);
      bySubmitId.set(sid, {
        ...(row as Record<string, unknown>),
        ...(prev ?? {}),
        source: prev ? "local_bridge+dreamina_cli" : "dreamina_cli",
        dreamina_cli: row,
      });
    }

    const tasks = Array.from(bySubmitId.values()).sort((a, b) => {
      const au =
        typeof a.updated_at === "number"
          ? a.updated_at
          : typeof a.created_at === "number"
            ? a.created_at
            : 0;
      const bu =
        typeof b.updated_at === "number"
          ? b.updated_at
          : typeof b.created_at === "number"
            ? b.created_at
            : 0;
      return bu - au;
    });

    return Response.json({
      ok: !hint || tasks.length > 0,
      code,
      tasks,
      hint,
      rawPreview,
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error), tasks: [] },
      { status: 500 }
    );
  }
}

export async function queryTaskHandler(req: Request) {
  try {
    const url = new URL(req.url);
    const submitId = url.searchParams.get("submit_id")?.trim();
    if (!submitId) {
      return Response.json({ error: "missing submit_id" }, { status: 400 });
    }

    const videoTaskRef = extractExternalVideoTaskRef(submitId);
    if (videoTaskRef) {
      const state = await queryForopencodeVideoTask(videoTaskRef.taskId, videoTaskRef.taskUrl);
      if (state.status === "completed") {
        return Response.json({
          ok: true,
          terminal: true,
          submitId,
          gen_status: "success",
          progress_pct: 100,
          video_url: state.videoUrl,
        });
      }
      if (state.status === "failed") {
        return Response.json({
          ok: false,
          terminal: true,
          submitId,
          gen_status: "failed",
          progress_pct: state.progressPct,
          fail_reason: state.failReason,
        });
      }
      return Response.json({
        ok: true,
        terminal: false,
        submitId,
        gen_status: state.rawStatus,
        progress_pct: state.progressPct,
      });
    }

    const banana2TaskId = extractBanana2TaskId(submitId);
    if (banana2TaskId) {
      const state = await queryBanana2ImageTask(banana2TaskId);
      if (state.status === "completed") {
        return Response.json({
          ok: true,
          terminal: true,
          submitId,
          gen_status: "success",
          progress_pct: 100,
          image_url: state.imageUrl,
        });
      }
      if (state.status === "failed") {
        return Response.json({
          ok: false,
          terminal: true,
          submitId,
          gen_status: "failed",
          progress_pct: state.progressPct,
          fail_reason: state.failReason,
        });
      }
      return Response.json({
        ok: true,
        terminal: false,
        submitId,
        gen_status: state.rawStatus,
        progress_pct: state.progressPct,
      });
    }

    const cliBin = await resolveRunnableDreaminaBin();
    const res = await runDreaminaCli(cliBin, ["query_result", "--submit_id", submitId], 60_000);
    const combined = `${res.stdout}\n${res.stderr}`;
    const payload = extractJsonObject(res.stdout) ?? extractJsonObject(combined);
    if (!payload) {
      return Response.json({
        ok: false,
        terminal: true,
        code: res.code,
        submitId,
        hint: "无法解析 query_result 输出",
        rawPreview: combined.slice(0, 1200),
      });
    }
    return Response.json({
      ok: res.code === 0,
      terminal: true,
      code: res.code,
      submitId,
      ...payload,
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function bridgeGenerateHandler(req: Request) {
  const response = await generatePost(req);
  return await rewriteBridgeResponse(response);
}

export async function bridgeGeneratedFileHandler(req: Request) {
  return await generatedFileGet(req);
}
