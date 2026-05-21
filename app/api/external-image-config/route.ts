import {
  getDefaultExternalImageApiConfig,
  getExternalImageApiProviderMetaList,
  readExternalImageApiConfig,
  sanitizeExternalImageApiConfigForClient,
  writeExternalImageApiConfig,
} from "@/lib/externalImageApiConfig";
import { isExternalImageApiProviderId } from "@/lib/externalImageApiShared";

export const runtime = "nodejs";

export async function GET() {
  const config = sanitizeExternalImageApiConfigForClient(
    await readExternalImageApiConfig()
  );
  const providers = getExternalImageApiProviderMetaList().map((provider) => ({
    ...provider,
    label:
      typeof config.providers[provider.id]?.displayName === "string" &&
      config.providers[provider.id]!.displayName!.trim()
        ? config.providers[provider.id]!.displayName!.trim()
        : provider.label,
  }));
  return Response.json(
    {
      ok: true,
      config,
      defaults: sanitizeExternalImageApiConfigForClient(
        getDefaultExternalImageApiConfig()
      ),
      providers,
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
      activeProviderId: string;
      displayName: string;
      baseUrl: string;
      apiKey: string;
      imageModel: string;
      textModel: string;
      imageCostPerGeneration: number | string | null;
      imageCostCurrency: string | null;
    }> | null;
    const config = await writeExternalImageApiConfig({
      ...(body ?? {}),
      activeProviderId: isExternalImageApiProviderId(body?.activeProviderId)
        ? body.activeProviderId
        : undefined,
    });
    return Response.json({
      ok: true,
      config: sanitizeExternalImageApiConfigForClient(config),
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "保存失败" },
      { status: 400 }
    );
  }
}
