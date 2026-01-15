import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Routes that don't require authentication
const publicRoutes = ['/login', '/register', '/'];
const authRoutes = ['/login', '/register'];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Check if this is a protected route (not public)
  const isPublicRoute = publicRoutes.some(route => pathname === route || pathname.startsWith(route));
  const isAuthRoute = authRoutes.some(route => pathname.startsWith(route));
  
  // Check for NextAuth session cookie (works in Edge runtime)
  const sessionToken = request.cookies.get('next-auth.session-token')?.value || 
                       request.cookies.get('__Secure-next-auth.session-token')?.value;
  
  const hasSession = !!sessionToken;
  
  // Check if cookies are working by looking for cookie header
  const cookieHeader = request.headers.get('cookie');
  const hasCookieSupport = cookieHeader !== null || request.cookies.size > 0;
  
  // If user has a session token but no cookie support, cookies were disabled
  if (hasSession && !hasCookieSupport) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('error', 'cookies_disabled');
    const response = NextResponse.redirect(loginUrl);
    
    // Clear any existing cookies
    response.cookies.delete('next-auth.session-token');
    response.cookies.delete('__Secure-next-auth.session-token');
    
    return response;
  }
  
  // If accessing protected route without session, redirect to login
  if (!isPublicRoute && !hasSession) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }
  
  // If accessing auth routes while logged in, redirect to home
  if (isAuthRoute && hasSession) {
    return NextResponse.redirect(new URL('/home', request.url));
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public folder)
     * - api routes (handled separately)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
