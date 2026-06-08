import { NextRequest, NextResponse } from "next/server";
import { createSessionCookieValue, getSessionCookieName, hashPassword } from "@/app/lib/auth";
import { createUser, findUserByUsername } from "@/app/lib/userStore";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (username.length < 3 || username.length > 32) {
    return NextResponse.json({ error: "用户名长度需要在 3 到 32 个字符之间" }, { status: 400 });
  }

  if (!/^[\w\u4e00-\u9fa5-]+$/u.test(username)) {
    return NextResponse.json({ error: "用户名仅支持中文、字母、数字、下划线和短横线" }, { status: 400 });
  }

  if (password.length < 6 || password.length > 64) {
    return NextResponse.json({ error: "密码长度需要在 6 到 64 个字符之间" }, { status: 400 });
  }

  try {
    const existingUser = await findUserByUsername(username);
    if (existingUser) {
      return NextResponse.json({ error: "用户名已存在" }, { status: 409 });
    }

    const user = await createUser({
      username,
      passwordHash: hashPassword(password),
    });

    if (!user) {
      return NextResponse.json({ error: "注册失败" }, { status: 500 });
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
    console.error("register failed", error);
    return NextResponse.json({ error: "注册失败" }, { status: 500 });
  }
}
