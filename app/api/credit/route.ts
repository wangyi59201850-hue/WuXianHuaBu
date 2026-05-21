export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    ok: false,
    totalCredit: null,
    credentialFound: false,
    cloudDisabled: true,
    error: "云端版未启用本地 dreamina 积分查询。",
  });
}
