import { NextResponse } from "next/server";

// Auth is enforced client-side (pages) + via Bearer tokens on API routes.
// We keep middleware as a no-op to avoid relying on cookie-based session checks.
export function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
