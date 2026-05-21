export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    ok: true,
    cliReady: false,
    version: null,
    docsUrl: "",
    docsUrlAlt: "",
    loggedIn: false,
    totalCredit: null,
    cloudDisabled: true,
    message: "云端版未启用本地 dreamina CLI。",
  });
}
