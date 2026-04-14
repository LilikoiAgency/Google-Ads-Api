import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

export async function middleware(request) {
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  const email = token?.email?.toLowerCase() || "";
  const isAllowedUser = email.endsWith("@lilikoiagency.com");

  if (!isAllowedUser) {
    const loginUrl = new URL("/", request.url);
    loginUrl.searchParams.set("callbackUrl", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  // ── Fire-and-forget page view logging ──────────────────────────────────
  // Skip Next.js internal requests (prefetches, RSC, static assets)
  const pathname = request.nextUrl.pathname;
  const isPageVisit =
    !request.nextUrl.search.includes("_rsc") &&
    !pathname.includes("_next") &&
    !pathname.startsWith("/api/") &&
    request.method === "GET";

  if (isPageVisit && email) {
    const logUrl = new URL("/api/admin/usage", request.url);
    fetch(logUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, path: pathname }),
    }).catch(() => {}); // non-blocking — never delay page load
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/report/:path*", "/report"],
};
