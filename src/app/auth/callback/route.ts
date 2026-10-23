import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const tokenType = request.nextUrl.searchParams.get("type");
  const destination =
    request.nextUrl.searchParams.get("next") === "/reset-password"
      ? "/reset-password"
      : "/dashboard";

  if (!isSupabaseConfigured()) {
    return NextResponse.redirect(new URL("/login?error=auth-callback", request.url));
  }

  const supabase = await createClient();
  const result =
    tokenHash && tokenType === "recovery"
      ? await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: "recovery",
        })
      : code
        ? await supabase.auth.exchangeCodeForSession(code)
        : null;

  if (!result || result.error) {
    const location =
      destination === "/reset-password"
        ? "/forgot-password?message=expired"
        : "/login?error=auth-callback";
    return NextResponse.redirect(new URL(location, request.url));
  }

  return NextResponse.redirect(
    new URL(tokenType === "recovery" ? "/reset-password" : destination, request.url),
  );
}
