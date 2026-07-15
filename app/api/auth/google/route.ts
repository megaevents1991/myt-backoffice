import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const response = { cookies: [] as { name: string; value: string; options: object }[] };

  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet: { name: string; value: string; options: CookieOptions }[]) => {
          toSet.forEach(({ name, value, options }) =>
            response.cookies.push({ name, value, options })
          );
        },
      },
    }
  );

  // Determine the public origin deterministically. In serverless,
  // new URL(request.url).origin can resolve to an internal host, which makes
  // Supabase reject the redirect_to and fall back to its (dev) Site URL.
  // Prefer an explicit env, then the proxy's forwarded host.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    (forwardedHost ? `${forwardedProto}://${forwardedHost}` : new URL(request.url).origin);

  const { data, error } = await supabaseAuth.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${origin}/api/auth/callback` },
  });

  if (error || !data.url) {
    console.error("Google OAuth init error:", error);
    return NextResponse.redirect(new URL("/auth/login?error=oauth", request.url));
  }

  const redirect = NextResponse.redirect(data.url);
  // Persist the PKCE code-verifier cookies Supabase generated.
  response.cookies.forEach(({ name, value, options }) =>
    redirect.cookies.set(name, value, options as Parameters<typeof redirect.cookies.set>[2])
  );
  return redirect;
}
