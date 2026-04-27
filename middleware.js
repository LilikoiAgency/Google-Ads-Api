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

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/report/:path*", "/report"],
};
