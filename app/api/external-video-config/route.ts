import {
  getDefaultExternalVideoApiConfig,
  readExternalVideoApiConfig,
  sanitizeExternalVideoApiConfigForClient,
  writeExternalVideoApiConfig,
} from "@/lib/externalVideoApiConfig";

export const runtime = "nodejs";

export async function GET() {
  const config = sanitizeExternalVideoApiConfigForClient(
    await readExternalVideoApiConfig()
  );
  return Response.json(
    {
      ok: true,
      config,
      defaults: sanitizeExternalVideoApiConfigForClient(
        getDefaultExternalVideoApiConfig()
      ),
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Partial<{
      displayName: string;
      baseUrl: string;
      apiKey: string;
      model: string;
    }> | null;
    const config = await writeExternalVideoApiConfig(body ?? {});
    return Response.json({
      ok: true,
      config: sanitizeExternalVideoApiConfigForClient(config),
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "保存失败" },
      { status: 400 }
    );
  }
}
