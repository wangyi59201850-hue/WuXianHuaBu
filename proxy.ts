import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const p = request.nextUrl.pathname;
  if (!p.startsWith("/outputs/generated/")) {
    return NextResponse.next();
  }
  const name = p.slice("/outputs/generated/".length);
  if (!name || name.includes("..")) {
    return NextResponse.next();
  }
  const url = request.nextUrl.clone();
  url.pathname = "/api/generated/file";
  url.search = `?name=${encodeURIComponent(name)}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/outputs/generated/:path*"],
};
