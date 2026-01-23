import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const protectedPaths = ["/dashboard", "/monitors", "/reports", "/settings"];
const authRoutes = ["/login", "/signup", "/reset-password"];

function hasSession(request: NextRequest) {
  const accessToken = request.cookies.get("sb-access-token")?.value;
  return Boolean(accessToken);
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const sessionExists = hasSession(request);

  if (authRoutes.includes(pathname)) {
    if (sessionExists) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  if (protectedPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    if (!sessionExists) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
