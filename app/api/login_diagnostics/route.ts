export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    ok: false,
    cloudDisabled: true,
    error: "云端版未启用本地登录诊断。",
  });
}

export async function POST() {
  return Response.json(
    {
      ok: false,
      cloudDisabled: true,
      error: "云端版未启用本地登录诊断。",
    },
    { status: 400 }
  );
}
