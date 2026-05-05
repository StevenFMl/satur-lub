import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decodeJwtPayload, type AccessClaims } from "@/lib/supabase/access-claims";

// Handles the OAuth / email-confirmation callback from Supabase.
// See: https://supabase.com/docs/guides/auth/server-side/nextjs
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (!code) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`
    );
  }

  let { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.redirect(`${origin}/login`);

  let claims = decodeJwtPayload<AccessClaims>(session.access_token);
  if (claims?.tenant_id) {
    return NextResponse.redirect(`${origin}${next}`);
  }

  const { data: refreshData } = await supabase.auth.refreshSession();
  if (refreshData.session) {
    claims = decodeJwtPayload<AccessClaims>(refreshData.session.access_token);
    if (claims?.tenant_id) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/onboarding`);
}
