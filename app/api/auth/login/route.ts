import { NextRequest, NextResponse } from "next/server";
import { createSessionCookieValue, getSessionCookieName, verifyPassword } from "@/app/lib/auth";
import { findUserByUsername } from "@/app/lib/userStore";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!username || !password) {
    return NextResponse.json({ error: "请输入用户名和密码" }, { status: 400 });
  }

  try {
    const user = await findUserByUsername(username);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
    }

    const response = NextResponse.json({
      session: {
        userId: user.id,
        username: user.username,
      },
    });
    response.cookies.set(getSessionCookieName(), createSessionCookieValue({ userId: user.id, username: user.username }), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return response;
  } catch (error) {
    console.error("login failed", error);
    return NextResponse.json({ error: "登录失败" }, { status: 500 });
  }
}
