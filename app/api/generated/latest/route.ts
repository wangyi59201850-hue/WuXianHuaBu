import { findGenerationTasksForSource } from "@/lib/generationTaskLedger";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const sourceNodeId = new URL(req.url).searchParams.get("sourceNodeId")?.trim();
  if (!sourceNodeId) {
    return Response.json({ error: "missing sourceNodeId" }, { status: 400 });
  }

  const tasks = await findGenerationTasksForSource(sourceNodeId);
  const urls = tasks
    .filter((task) => task.status === "completed" && typeof task.outputUrl === "string")
    .sort((a, b) => a.index - b.index)
    .map((task) => task.outputUrl!)
    .filter(Boolean);
  const activeTasks = tasks
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
    tasks: activeTasks,
    submitIds: activeTasks.map((task) => task.submitId),
  });
}
