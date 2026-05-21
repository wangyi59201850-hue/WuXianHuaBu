export const runtime = "nodejs";

export async function POST() {
  return Response.json({ ok: true, cloudDisabled: true });
}
