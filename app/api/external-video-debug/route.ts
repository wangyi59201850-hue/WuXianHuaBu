export const runtime = "nodejs";

function normalizeBaseUrl(input: string) {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/\/v1$/i.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

function looksLikeVideoModel(id: string) {
  const v = id.toLowerCase();
  return v.includes("video") || v.includes("imagine") || v.includes("seedance") || v.includes("kling") || v.includes("veo");
}

function summarize(text: string, limit = 180) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}...`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Partial<{
      baseUrl: string;
      apiKey: string;
    }> | null;
    const baseUrl = normalizeBaseUrl(typeof body?.baseUrl === "string" ? body.baseUrl : "");
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
    if (!baseUrl) return Response.json({ ok: false, error: "API 地址不能为空" }, { status: 400 });
    if (!apiKey) return Response.json({ ok: false, error: "API 密钥不能为空" }, { status: 400 });

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
    const videoModels = models.filter(looksLikeVideoModel);
    return Response.json(
      {
        ok: true,
        models,
        videoModels,
        videoCapable: videoModels.length > 0,
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
