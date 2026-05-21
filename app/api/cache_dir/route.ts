import { getGeneratedDirConfig } from "@/lib/generatedDir";

export const runtime = "nodejs";

export async function GET() {
  const config = await getGeneratedDirConfig();
  return Response.json({
    ok: true,
    ...config,
    cloudDisabled: true,
  });
}

export async function POST() {
  return Response.json(
    {
      ok: false,
      cloudDisabled: true,
      error: "云端版不支持修改本地缓存目录。",
    },
    { status: 400 }
  );
}
