import {
  removeProtectedMediaSource,
  syncProtectedMediaSources,
  type ProtectedMediaSourceInput,
} from "@/lib/protectedMedia";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { sources?: unknown; replaceGroup?: unknown }
      | null;
    const replaceGroup =
      typeof body?.replaceGroup === "string" && body.replaceGroup.trim()
        ? body.replaceGroup.trim()
        : undefined;
    const sources: ProtectedMediaSourceInput[] = Array.isArray(body?.sources)
      ? body.sources.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const row = item as Record<string, unknown>;
          return [
            {
              sourceId: typeof row.sourceId === "string" ? row.sourceId : "",
              label: typeof row.label === "string" ? row.label : undefined,
              kind:
                row.kind === "current" || row.kind === "recent"
                  ? row.kind
                  : undefined,
              paths: Array.isArray(row.paths)
                ? row.paths.filter((entry): entry is string => typeof entry === "string")
                : [],
            },
          ];
        })
      : [];

    const result = await syncProtectedMediaSources({ sources, replaceGroup });
    return Response.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { sourceId?: unknown } | null;
    const sourceId = typeof body?.sourceId === "string" ? body.sourceId.trim() : "";
    if (!sourceId) {
      return Response.json({ ok: false, error: "missing sourceId" }, { status: 400 });
    }
    await removeProtectedMediaSource(sourceId);
    return Response.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
