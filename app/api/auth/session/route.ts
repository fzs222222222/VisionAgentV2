import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSessionCookieName, parseSessionCookieValue } from "@/app/lib/auth";

export async function GET() {
  const cookieStore = await cookies();
  const session = parseSessionCookieValue(cookieStore.get(getSessionCookieName())?.value);

  return NextResponse.json({
    session: session
      ? {
          userId: session.userId,
          username: session.username,
        }
      : null,
  });
}

