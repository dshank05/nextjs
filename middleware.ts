import { withAuth } from 'next-auth/middleware'

export default withAuth(
  // Middleware function
  function middleware(req) {
    // This function runs after authentication
    // You can add additional logic here if needed
  },
  {
    callbacks: {
      authorized: ({ token }) => {
        // Return true if the user should be able to access the page
        // Return false to redirect to login
        return !!token
      },
    },
  }
)

// Configure which routes should be protected
export const config = {
  // Protect all routes except login and static assets
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/auth (NextAuth.js endpoints)
     * - auth/signin (login page)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - assets (static assets)
     */
    '/((?!api/auth|auth/signin|_next/static|_next/image|favicon.ico|assets).*)',
  ],
}
