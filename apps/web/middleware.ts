import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const formatLog = (payload: object) => {
  const spacing = process.env.NODE_ENV === "development" ? 2 : 0;
  return JSON.stringify(payload, null, spacing);
};

export function middleware(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const path = request.nextUrl.pathname;
  const isDev = process.env.NODE_ENV === "development";

  const logPayload = {
    ts: new Date().toISOString(),
    service: "web",
    scope: "next.proxy",
    requestId,
    method: request.method,
    path,
    level: isDev ? "debug" : "info",
    msg: "edge.request",
    search: request.nextUrl.search || undefined,
    userAgent: request.headers.get("user-agent") || undefined,
  };

  console.log(formatLog(logPayload));

  const res = NextResponse.next();
  res.headers.set("x-request-id", requestId);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
