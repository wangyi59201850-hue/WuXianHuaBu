import { queryExternalImageApiBalance } from "@/lib/externalImageApiBalance";

export const runtime = "nodejs";

export async function GET() {
  const result = await queryExternalImageApiBalance();
  if (result.ok) {
    return Response.json(result);
  }
  return Response.json(result, { status: 502 });
}
