import {
  fetchAiwanwuModels,
  filterAiwanwuImageModels,
  filterAiwanwuTextModels,
  getFallbackImageModels,
  getSupplementalImageModels,
  getFallbackTextModels,
} from "@/lib/aiwanwu";
import { readExternalImageApiConfig } from "@/lib/externalImageApiConfig";
import {
  isExternalImageApiProviderId,
} from "@/lib/externalImageApiShared";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = (url.searchParams.get("kind") || "all").trim().toLowerCase();
  const providerIdRaw = (url.searchParams.get("providerId") || "").trim();
  const explicitProviderId = isExternalImageApiProviderId(providerIdRaw)
    ? providerIdRaw
    : undefined;
  const config = await readExternalImageApiConfig();
  const providerId = explicitProviderId ?? config.activeProviderId;

  try {
    const models = await fetchAiwanwuModels(providerId);
    const filtered =
      kind === "text"
        ? filterAiwanwuTextModels(models)
        : kind === "image"
          ? filterAiwanwuImageModels(models)
          : models;
    const merged =
      kind === "image"
        ? Array.from(new Set([...getSupplementalImageModels(providerId), ...filtered]))
        : filtered;
    if (kind === "text" && filtered.length === 0) {
      return Response.json(
        {
          ok: true,
          models: getFallbackTextModels(),
          fallback: true,
        },
        {
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate",
          },
        }
      );
    }
    if (kind === "image" && filtered.length === 0) {
      return Response.json(
        {
          ok: true,
          models: getFallbackImageModels(providerId),
          fallback: true,
        },
        {
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate",
          },
        }
      );
    }
    return Response.json(
      { ok: true, models: merged },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load models";
    if (kind === "text") {
      return Response.json(
        {
          ok: true,
          models: getFallbackTextModels(),
          fallback: true,
          message,
        },
        {
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate",
          },
        }
      );
    }
    if (kind === "image") {
      return Response.json(
        {
          ok: true,
          models: getFallbackImageModels(providerId),
          fallback: true,
          message,
        },
        {
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate",
          },
        }
      );
    }
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
