export const runtime = "nodejs";

export async function POST() {
  return Response.json(
    {
      ok: false,
      cloudDisabled: true,
      error: "云端版不支持导入本地登录响应。",
    },
    { status: 400 }
  );
}
