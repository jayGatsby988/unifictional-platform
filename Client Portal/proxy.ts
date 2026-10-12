import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// /api/sync, /api/health, /api/ops and /api/autopilot/run check their own CRON_SECRET (Vercel Cron) or an admin session, and
// /api/autopilot/feed is a public read-only feed, so the login redirect must not intercept them.
const PUBLIC = ["/login", "/auth", "/signup", "/report", "/guide", "/voice", "/hero", "/api/audit", "/api/signup", "/api/sync", "/api/health", "/api/ops", "/api/autopilot/run", "/api/autopilot/feed"];

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const demo = process.env.PORTAL_DEMO === "true" || !url || !key;

  let response = NextResponse.next({ request });
  if (demo) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Refreshes the session cookie when needed. Never remove this call.
  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = path === "/" || PUBLIC.some((p) => path.startsWith(p));

  if (!user && !isPublic) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.searchParams.set("next", path);
    return NextResponse.redirect(login);
  }
  if (user && path === "/login") {
    const home = request.nextUrl.clone();
    home.pathname = "/overview";
    home.search = "";
    return NextResponse.redirect(home);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|mp3|wav|m4a|mp4|webm|woff2?|txt|xml)$).*)"],
};
