import { extractBanana2TaskId, queryBanana2ImageTask } from "@/lib/banana2Image";
import { extractExternalVideoTaskRef } from "@/lib/cliVideoModels";
import { queryForopencodeVideoTask } from "@/lib/foropencodeVideo";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const submitId = url.searchParams.get("submit_id")?.trim();
  if (!submitId) {
    return Response.json({ ok: false, error: "missing submit_id" }, { status: 400 });
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

  return Response.json({
    ok: false,
    terminal: true,
    submitId,
    error: "云端版不支持查询 dreamina 本地任务。",
  });
}
