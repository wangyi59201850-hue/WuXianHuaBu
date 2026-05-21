export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    ok: true,
    exists: false,
    sizeBytes: 0,
    minBytes: 3072,
    tooSmall: false,
    cloudDisabled: true,
  });
}
