export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    ok: true,
    entries: [],
    cloudDisabled: true,
  });
}

export async function DELETE() {
  return Response.json({ ok: true, cloudDisabled: true });
}
