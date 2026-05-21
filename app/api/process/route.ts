import { generateAiwanwuImageEdit, resolveAiwanwuImageSize } from "@/lib/aiwanwu";
import {
  type ExternalImageApiProviderId,
  isExternalImageApiProviderId,
  supportsExternalImageEditEndpoint,
} from "@/lib/externalImageApiShared";

export const runtime = "nodejs";

type ProcessOperation = "outpaint" | "upscale" | "retouch" | "multiview" | "cutout";

function normalizeOperation(raw: FormDataEntryValue | null): ProcessOperation {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value === "upscale") return "upscale";
  if (value === "retouch") return "retouch";
  if (value === "multiview") return "multiview";
  if (value === "cutout") return "cutout";
  return "outpaint";
}

function clampCount(raw: FormDataEntryValue | null) {
  const value = typeof raw === "string" ? Number(raw.trim()) : Number(raw);
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(4, Math.round(value)));
}

function defaultPromptForOperation(operation: ProcessOperation) {
  if (operation === "retouch") {
    return "修复遮罩区域，并保持主体、光影和质感自然衔接。";
  }
  if (operation === "upscale") {
    return "提升清晰度和纹理表现，保持原图主体与构图稳定。";
  }
  if (operation === "multiview") {
    return "基于原图生成同一主体的不同视角版本，保持风格和材质一致。";
  }
  if (operation === "cutout") {
    return "识别主体边缘并尽量去除背景，保留柔和干净的轮廓。";
  }
  return "扩展画面边界，并保持内容、光影和透视自然延续。";
}

function imageOutputUrl(image: { url?: string; b64_json?: string }) {
  if (typeof image.url === "string" && image.url.trim()) {
    return image.url.trim();
  }
  if (typeof image.b64_json === "string" && image.b64_json.trim()) {
    return `data:image/png;base64,${image.b64_json.trim()}`;
  }
  throw new Error("image process returned no image data");
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const image = form.get("image");
    const mask = form.get("mask");
    const promptRaw = form.get("prompt");
    const operation = normalizeOperation(form.get("operation"));
    const count = clampCount(form.get("count"));
    const sizeRaw = form.get("size");
    const modelRaw = form.get("modelVersion");
    const providerIdRaw = form.get("providerId");
    const imageQualityRaw = form.get("imageQuality");
    const imageFormatRaw = form.get("imageFormat");

    if (!(image instanceof File) || image.size <= 0) {
      return Response.json({ error: "`image` is required" }, { status: 400 });
    }

    const prompt =
      typeof promptRaw === "string" && promptRaw.trim()
        ? promptRaw.trim()
        : defaultPromptForOperation(operation);
    const modelVersion =
      typeof modelRaw === "string" && modelRaw.trim() ? modelRaw.trim() : undefined;
    const size =
      typeof sizeRaw === "string" && sizeRaw.trim()
        ? resolveAiwanwuImageSize(modelVersion, sizeRaw.trim())
        : undefined;
    const providerId: ExternalImageApiProviderId | undefined =
      isExternalImageApiProviderId(providerIdRaw) ? providerIdRaw : undefined;
    const imageQuality =
      imageQualityRaw === "standard" || imageQualityRaw === "high" || imageQualityRaw === "hd"
        ? imageQualityRaw
        : undefined;
    const imageFormat =
      imageFormatRaw === "png" ? "png" : imageFormatRaw === "jpg" ? "jpg" : undefined;

    if (operation === "retouch" && !(mask instanceof File)) {
      return Response.json({ error: "`mask` is required for retouch" }, { status: 400 });
    }
    if (!supportsExternalImageEditEndpoint(providerId)) {
      return Response.json(
        { error: "当前 provider 不支持编辑类图片处理，请切换到兼容的图片通道。" },
        { status: 400 }
      );
    }

    const imageUrls: string[] = [];
    let totalTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    for (let index = 0; index < count; index += 1) {
      const result = await generateAiwanwuImageEdit({
        prompt,
        image,
        mask: mask instanceof File ? mask : null,
        model: modelVersion,
        size,
        providerId,
        quality: imageQuality,
        imageFormat,
      });
      const first = result.data?.[0];
      if (!first) {
        throw new Error("image process returned no images");
      }
      imageUrls.push(imageOutputUrl(first));
      totalTokens += result.usage?.total_tokens ?? 0;
      inputTokens += result.usage?.input_tokens ?? 0;
      outputTokens += result.usage?.output_tokens ?? 0;
    }

    return Response.json({
      ok: true,
      imageUrls,
      usage: {
        total_tokens: totalTokens || undefined,
        input_tokens: inputTokens || undefined,
        output_tokens: outputTokens || undefined,
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "素材处理失败" },
      { status: 500 }
    );
  }
}
