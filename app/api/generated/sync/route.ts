import { extractBanana2TaskId, queryBanana2ImageTask } from "@/lib/banana2Image";
import { extractExternalVideoTaskRef } from "@/lib/cliVideoModels";
import { queryForopencodeVideoTask } from "@/lib/foropencodeVideo";
import { upsertGenerationTask } from "@/lib/generationTaskLedger";

export const runtime = "nodejs";

function sanitizeNodeId(nodeId: string) {
  return nodeId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { submitId?: string; sourceNodeId?: string; index?: number }
    | null;
  const submitId = body?.submitId?.trim();
  const sourceNodeId = body?.sourceNodeId?.trim();
  const index = typeof body?.index === "number" && body.index >= 0 ? body.index : 0;
  if (!submitId || !sourceNodeId) {
    return Response.json({ ok: false, error: "missing submitId or sourceNodeId" }, { status: 400 });
  }

  const banana2TaskId = extractBanana2TaskId(submitId);
  if (banana2TaskId) {
    const state = await queryBanana2ImageTask(banana2TaskId);
    if (state.status !== "completed") {
      return Response.json({
        ok: false,
        urls: [],
        error:
          state.status === "failed"
            ? state.failReason || "banana2 生图任务失败。"
            : "banana2 生图任务仍在运行中。",
      });
    }
    await upsertGenerationTask({
      submitId,
      sourceNodeId: sanitizeNodeId(sourceNodeId),
      index,
      mediaType: "image",
      status: "completed",
      outputUrl: state.imageUrl,
      fileName: `banana2-${banana2TaskId}.png`,
    });
    return Response.json({ ok: true, urls: [state.imageUrl] });
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
            ? state.failReason || "外部视频任务失败。"
            : "外部视频任务仍在运行中。",
      });
    }
    await upsertGenerationTask({
      submitId,
      sourceNodeId: sanitizeNodeId(sourceNodeId),
      index,
      mediaType: "video",
      status: "completed",
      outputUrl: state.videoUrl,
      fileName: `video-${videoTaskRef.taskId}.mp4`,
    });
    return Response.json({ ok: true, urls: [state.videoUrl] });
  }

  return Response.json({
    ok: false,
    urls: [],
    error: "云端版不支持同步 dreamina 本地任务。",
  });
}
