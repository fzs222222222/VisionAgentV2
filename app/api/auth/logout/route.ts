import { NextResponse } from "next/server";
import { getSessionCookieName } from "@/app/lib/auth";

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(getSessionCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  return response;
}
