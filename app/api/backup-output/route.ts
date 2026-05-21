export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { nodeId?: unknown; paths?: unknown }
    | null;
  const paths = Array.isArray(body?.paths)
    ? body.paths.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

  return Response.json({
    ok: true,
    backupKey: typeof body?.nodeId === "string" && body.nodeId.trim() ? body.nodeId.trim() : "cloud-pass",
    files: paths,
    cloudPassthrough: true,
  });
}
