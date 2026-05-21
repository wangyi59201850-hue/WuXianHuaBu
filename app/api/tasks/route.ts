import {
  readGenerationTasks,
  type GenerationTaskRecord,
} from "@/lib/generationTaskLedger";

export const runtime = "nodejs";

function localTaskToApiRow(task: GenerationTaskRecord) {
  return {
    source: "cloud_memory",
    submit_id: task.submitId,
    submitId: task.submitId,
    gen_status: task.status,
    status: task.status,
    gen_task_type: task.mediaType,
    task_type: task.mediaType,
    provider:
      task.provider ??
      (task.videoProvider === "external_api" ? "external_video_api" : "external_image_api"),
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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.max(
    1,
    Math.min(100, Number(url.searchParams.get("limit") ?? 30) || 30)
  );
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
  const genStatus = url.searchParams.get("gen_status")?.trim();
  const genTaskType = url.searchParams.get("gen_task_type")?.trim();
  const submitId = url.searchParams.get("submit_id")?.trim();

  const tasks = (await readGenerationTasks())
    .filter((task) => (submitId ? task.submitId === submitId || task.upstreamId === submitId : true))
    .filter((task) => (genStatus ? task.status === genStatus : true))
    .filter((task) => (genTaskType ? task.mediaType === genTaskType : true))
    .slice(offset, offset + limit)
    .map(localTaskToApiRow);

  return Response.json({
    ok: true,
    tasks,
    hint: tasks.length === 0 ? "云端版没有可展示的本地 CLI 任务。" : undefined,
  });
}
