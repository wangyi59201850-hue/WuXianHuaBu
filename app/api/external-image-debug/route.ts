import {
  type ExternalImageApiProviderId,
  looksLikeExternalImageModel,
  looksLikeExternalTextModel,
} from "@/lib/externalImageApiShared";

export const runtime = "nodejs";

function normalizeBaseUrl(input: string) {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/\/v1$/i.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

function summarize(text: string, limit = 180) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}...`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Partial<{
      providerId: ExternalImageApiProviderId;
      baseUrl: string;
      apiKey: string;
    }> | null;
    const rawBaseUrl = typeof body?.baseUrl === "string" ? body.baseUrl : "";
    const baseUrl = normalizeBaseUrl(rawBaseUrl);
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
    if (!rawBaseUrl.trim()) {
      return Response.json({ ok: false, error: "API 地址不能为空" }, { status: 400 });
    }
    if (!apiKey) {
      return Response.json({ ok: false, error: "API 密钥不能为空" }, { status: 400 });
    }

    if (body?.providerId === "banana2") {
      return Response.json(
        {
          ok: true,
          providerId: body.providerId,
          models: ["banana2"],
          imageModels: ["banana2"],
          textModels: [],
          imageCapable: true,
        },
        {
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate",
          },
        }
      );
    }

    const resp = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(90_000),
    });
    const text = await resp.text().catch(() => "");
    if (!resp.ok) {
      return Response.json(
        { ok: false, error: text.trim() ? summarize(text) : `模型检测失败：${resp.status}` },
        { status: 502 }
      );
    }
    let json: { data?: Array<{ id?: string }> };
    try {
      json = JSON.parse(text) as typeof json;
    } catch {
      return Response.json(
        { ok: false, error: `模型接口返回的不是 JSON：${summarize(text)}` },
        { status: 502 }
      );
    }
    const models = Array.from(
      new Set(
        (json.data ?? [])
          .map((item) => item.id?.trim())
          .filter((id): id is string => Boolean(id))
      )
    );
    const imageModels = models.filter((id) => looksLikeExternalImageModel(id));
    const textModels = models.filter((id) => looksLikeExternalTextModel(id));
    return Response.json(
      {
        ok: true,
        providerId: body?.providerId,
        models,
        imageModels,
        textModels,
        imageCapable: imageModels.length > 0,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "模型检测失败" },
      { status: 500 }
    );
  }
}
