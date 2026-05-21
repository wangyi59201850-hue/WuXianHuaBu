import { AIWANWU_DEFAULT_IMAGE_MODEL, generateAiwanwuImage, resolveAiwanwuImageSize } from "@/lib/aiwanwu";
import { isExternalImageApiProviderId } from "@/lib/externalImageApiShared";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | {
          prompt?: string;
          model?: string;
          size?: string;
          providerId?: string;
          imageDataUrls?: string[];
        }
      | null;

    const prompt = body?.prompt?.trim() || "";
    if (!prompt) {
      return Response.json({ ok: false, error: "`prompt` 不能为空" }, { status: 400 });
    }

    const model = body?.model?.trim() || AIWANWU_DEFAULT_IMAGE_MODEL;
    const result = await generateAiwanwuImage({
      prompt,
      model,
      size: resolveAiwanwuImageSize(model, body?.size?.trim() || "1024x1024"),
      providerId: isExternalImageApiProviderId(body?.providerId)
        ? body.providerId
        : undefined,
      imageDataUrls: Array.isArray(body?.imageDataUrls)
        ? body.imageDataUrls
        : undefined,
    });

    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image generation failed";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
