import { AIWANWU_DEFAULT_TEXT_MODEL, generateAiwanwuText } from "@/lib/aiwanwu";
import { isExternalImageApiProviderId } from "@/lib/externalImageApiShared";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | {
          prompt?: string;
          model?: string;
          systemPrompt?: string;
          imageDataUrls?: string[];
          providerId?: string;
        }
      | null;

    const prompt = body?.prompt?.trim() || "";
    if (!prompt) {
      return Response.json({ ok: false, error: "`prompt` 不能为空" }, { status: 400 });
    }

    const result = await generateAiwanwuText({
      prompt,
      model: body?.model?.trim() || AIWANWU_DEFAULT_TEXT_MODEL,
      systemPrompt: body?.systemPrompt,
      imageDataUrls: Array.isArray(body?.imageDataUrls) ? body.imageDataUrls : undefined,
      providerId: isExternalImageApiProviderId(body?.providerId)
        ? body.providerId
        : undefined,
    });

    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Text generation failed";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
