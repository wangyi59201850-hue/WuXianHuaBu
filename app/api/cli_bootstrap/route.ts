export const runtime = "nodejs";

export async function POST() {
  return Response.json({
    ok: false,
    installed: false,
    cloudDisabled: true,
    message: "云端版不支持自动安装本地 dreamina CLI。",
  });
}
