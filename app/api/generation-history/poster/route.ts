export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { posterDataUrl?: unknown }
    | null;
  const posterUrl =
    typeof body?.posterDataUrl === "string" ? body.posterDataUrl.trim() : "";
  if (!posterUrl) {
    return Response.json(
      { ok: false, error: "missing posterDataUrl" },
      { status: 400 }
    );
  }
  return Response.json({ ok: true, posterUrl, cloudPassthrough: true });
}
