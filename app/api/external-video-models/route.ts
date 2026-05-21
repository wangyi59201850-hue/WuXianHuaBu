import {
  fetchExternalVideoModels,
  getFallbackExternalVideoModels,
} from "@/lib/externalVideoApi";

export const runtime = "nodejs";

export async function GET() {
  try {
    const models = await fetchExternalVideoModels();
    return Response.json(
      { ok: true, models },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error) {
    return Response.json(
      {
        ok: true,
        models: getFallbackExternalVideoModels(),
        fallback: true,
        message: error instanceof Error ? error.message : "读取外部生视频模型失败",
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  }
}
