export const runtime = "nodejs";

export async function POST() {
  return Response.json({
    ok: false,
    launched: false,
    cloudDisabled: true,
    error: "云端版不支持本地 dreamina 登录流程。",
  });
}
