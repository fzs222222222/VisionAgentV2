"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Code2,
  FileText,
  FolderKanban,
  Grid2x2,
  Image as ImageIcon,
  Library,
  Loader2,
  Music4,
  PenSquare,
  Play,
  Sparkles,
  Upload,
  UserCircle2,
  Volume2,
} from "lucide-react";
import { useAuthSession } from "@/app/lib/useAuthSession";

type NavKey = "home" | "projects" | "templates" | "assets" | "help";
type ModeKey = "slideshow" | "html";

const navItems: Array<{ key: NavKey; label: string; icon: typeof Grid2x2 }> = [
  { key: "home", label: "首页", icon: Grid2x2 },
  { key: "projects", label: "项目", icon: FolderKanban },
  { key: "templates", label: "模板", icon: Library },
  { key: "assets", label: "素材", icon: ImageIcon },
  { key: "help", label: "帮助", icon: CircleHelp },
];

const modes = [
  {
    key: "slideshow" as ModeKey,
    title: "图片轮播模式",
    description: "AI 生成分镜图片\n多图轮播合成视频",
    detail: "系统调用文生图 AI 模型生成图片，多个图片轮播形成视频。",
    feature: "适合产品宣传、知识科普、品牌故事等图文叙事视频。",
    icon: ImageIcon,
  },
  {
    key: "html" as ModeKey,
    title: "HTML 视频模式",
    description: "AI 生成网页动画\n多段动画合成视频",
    detail: "系统调用 AI 生成网页动画，多个网页动画片段合成视频。",
    feature: "适合数据演示、技术讲解、动态交互类视觉内容。",
    icon: Code2,
  },
];

const workflow = [
  { title: "选择创作模式", icon: Grid2x2 },
  { title: "输入提示词", icon: PenSquare },
  { title: "脚本生成", icon: FileText },
  { title: "分镜拆分", icon: Grid2x2 },
  { title: "分镜画面生成", icon: ImageIcon },
  { title: "旁白语音生成", icon: Volume2 },
  { title: "背景音乐选择", icon: Music4 },
  { title: "播放预览", icon: Play },
  { title: "录屏导出视频", icon: Upload },
];

const advantages = [
  "AI 全流程自动化，降低创作门槛",
  "支持两种创作模式，满足多样化需求",
  "云端存储与协作，随时随地创作",
  "一键导出，快速产出高质量视频",
];

const navMessage: Record<NavKey, string> = {
  home: "当前位于首页，可选择创作模式开始制作。",
  projects: "项目中心占位，后续可接入历史项目、项目管理与检索。",
  templates: "模板中心占位，后续可接入行业模板与创意模板库。",
  assets: "素材中心占位，后续可接入图片、音频、字幕等素材管理。",
  help: "帮助中心占位，后续可接入操作指南、FAQ 与客服支持。",
};

export default function Home() {
  const router = useRouter();
  const { session, isLoading: isLoadingSession, refreshSession, setSession } = useAuthSession();
  const [activeNav, setActiveNav] = useState<NavKey>("home");
  const [statusText, setStatusText] = useState(navMessage.home);
  const [notifyOn, setNotifyOn] = useState(true);
  const [creatingMode, setCreatingMode] = useState<ModeKey | null>(null);
  const [isAuthDialogOpen, setIsAuthDialogOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);

  useEffect(() => {
    if (session?.username) {
      setStatusText(`当前登录用户：${session.username}，可选择创作模式开始制作。`);
    }
  }, [session?.username]);

  const userInitial = session?.username?.trim().slice(0, 1).toUpperCase() ?? "U";

  function openAuthDialog(mode: "login" | "register") {
    setAuthMode(mode);
    setAuthError("");
    setAuthPassword("");
    setIsAuthDialogOpen(true);
  }

  async function createProject(mode: ModeKey) {
    if (creatingMode) return;
    setCreatingMode(mode);
    setStatusText("正在创建项目，请稍候...");

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: mode }),
      });
      const data = await response.json();

      if (!response.ok || !data.project?.uuid) {
        throw new Error(data.error ?? "创建项目失败");
      }

      router.push(`/create?projectId=${encodeURIComponent(data.project.uuid)}&mode=${mode}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "创建项目失败";
      setStatusText(message);
      setCreatingMode(null);
    }
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmittingAuth) return;

    setIsSubmittingAuth(true);
    setAuthError("");

    try {
      const response = await fetch(`/api/auth/${authMode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: authUsername.trim(),
          password: authPassword,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        session?: { userId: number; username: string } | null;
      };

      if (!response.ok || !data.session) {
        throw new Error(data.error ?? `${authMode === "login" ? "登录" : "注册"}失败`);
      }

      setSession(data.session);
      setIsAuthDialogOpen(false);
      setAuthPassword("");
      setStatusText(`欢迎回来，${data.session.username}。现在可以继续与 VisionAgent 协作创作。`);
      await refreshSession();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "认证失败");
    } finally {
      setIsSubmittingAuth(false);
    }
  }

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setSession(null);
      setIsAuthDialogOpen(false);
      setStatusText(navMessage[activeNav]);
    } catch {
      setStatusText("退出登录失败，请稍后重试。");
    }
  }

  return (
    <main className="landing-page">
      <section className="landing-shell wide">
        <section className="landing-card expanded">
          <div className="landing-ribbon">首页（选择创作模式）</div>

          <header className="landing-topbar spacious">
            <div className="landing-brand">
              <span className="landing-logo">
                <Play size={16} fill="currentColor" />
              </span>
              <strong>VisionAgent</strong>
            </div>

            <nav className="landing-nav roomy" aria-label="主导航">
              {navItems.map((item) => (
                <button
                  key={item.key}
                  className={activeNav === item.key ? "nav-button active" : "nav-button"}
                  onClick={() => {
                    setActiveNav(item.key);
                    setStatusText(navMessage[item.key]);
                  }}
                  type="button"
                >
                  <item.icon size={14} />
                  {item.label}
                </button>
              ))}
            </nav>

            <div className="landing-actions">
              <button
                aria-label="通知开关"
                className={notifyOn ? "icon-button active" : "icon-button"}
                onClick={() => setNotifyOn((value) => !value)}
                type="button"
              >
                <Bell size={18} />
              </button>
              <button
                aria-label={session ? "当前用户" : "登录或注册"}
                className={`icon-button ${session ? "is-authenticated" : ""}`}
                onClick={() => {
                  if (session) {
                    setIsAuthDialogOpen(true);
                    setAuthError("");
                    return;
                  }
                  openAuthDialog("login");
                }}
                type="button"
              >
                {session ? <span className="user-chip">{userInitial}</span> : <UserCircle2 size={22} />}
              </button>
            </div>
          </header>

          <div className="landing-statusbar">{statusText}</div>

          <section className="landing-hero large">
            <div className="landing-spark spark-left">
              <Sparkles size={18} />
            </div>
            <div className="landing-spark spark-right">
              <Sparkles size={18} />
            </div>
            <h1>欢迎使用 VisionAgent</h1>
            <p>选择创作模式，快速生成视频</p>
          </section>

          <section className="landing-mode-grid bigger">
            {modes.map((mode, index) => (
              <article className={`landing-mode-card ${mode.key}`} key={mode.key}>
                <div className="landing-mode-art">
                  <button aria-label="上一张" className="art-arrow left" type="button">
                    <ChevronLeft size={18} />
                  </button>
                  <div className="art-stack">
                    <span className="art-panel back-left" />
                    <span className="art-panel main">
                      <mode.icon size={42} />
                    </span>
                    <span className="art-panel back-right" />
                  </div>
                  <button className="art-play" aria-label={`${mode.title} 预览`} type="button">
                    <Play size={18} fill="currentColor" />
                  </button>
                  {index === 0 ? (
                    <button aria-label="下一张" className="art-arrow right" type="button">
                      <ChevronRight size={18} />
                    </button>
                  ) : null}
                </div>

                <h2>{mode.title}</h2>
                <p className="landing-mode-desc">
                  {mode.description.split("\n").map((line) => (
                    <span key={line}>
                      {line}
                      <br />
                    </span>
                  ))}
                </p>
                <div className="landing-mode-divider" />
                <p className="landing-mode-detail">{mode.detail}</p>

                <button
                  className={`landing-mode-button ${mode.key}`}
                  disabled={creatingMode !== null}
                  onClick={() => createProject(mode.key)}
                  type="button"
                >
                  {creatingMode === mode.key ? (
                    <>
                      <Loader2 size={18} /> 创建中
                    </>
                  ) : (
                    <>
                      立即创作 <ChevronRight size={18} />
                    </>
                  )}
                </button>
              </article>
            ))}
          </section>
        </section>

        <section className="workflow-showcase">
          <div className="showcase-side-tag">完整创作流程</div>
          <div className="workflow-track">
            {workflow.map((item, index) => (
              <div className="workflow-step-card" key={item.title}>
                <item.icon size={20} />
                <span>{item.title}</span>
                {index < workflow.length - 1 ? <ArrowRight className="workflow-arrow" size={18} /> : null}
              </div>
            ))}
          </div>
        </section>

        <section className="feature-showcase-grid">
          <div className="showcase-side-tag secondary">两种模式定义</div>

          <article className="feature-panel">
            <h3>图片轮播模式</h3>
            <p>{modes[0].feature}</p>
            <div className="mode-demo-strip image">
              <span />
              <ArrowRight size={18} />
              <span />
              <ArrowRight size={18} />
              <span />
              <ArrowRight size={18} />
              <span className="play-tile">
                <Play size={18} fill="currentColor" />
              </span>
            </div>
          </article>

          <article className="feature-panel">
            <h3>HTML 视频模式</h3>
            <p>{modes[1].feature}</p>
            <div className="mode-demo-strip html">
              <span />
              <ArrowRight size={18} />
              <span />
              <ArrowRight size={18} />
              <span className="play-tile">
                <Play size={18} fill="currentColor" />
              </span>
            </div>
          </article>

          <article className="feature-panel advantages">
            <h3>平台特点</h3>
            <ul>
              {advantages.map((item) => (
                <li key={item}>
                  <Check size={16} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </article>
        </section>
      </section>

      {isAuthDialogOpen ? (
        <div className="auth-dialog-backdrop" onClick={() => setIsAuthDialogOpen(false)} role="presentation">
          <section aria-label="用户登录与注册" className="auth-dialog" onClick={(event) => event.stopPropagation()}>
            {session ? (
              <>
                <div className="auth-dialog-head">
                  <div>
                    <strong>当前账号</strong>
                    <small>已登录，可继续与 AI 助手协作。</small>
                  </div>
                  <button className="ghost-button" onClick={() => setIsAuthDialogOpen(false)} type="button">
                    关闭
                  </button>
                </div>
                <div className="auth-session-card">
                  <span className="auth-session-avatar">{userInitial}</span>
                  <div>
                    <strong>{session.username}</strong>
                    <small>{isLoadingSession ? "同步登录状态中..." : "登录状态已生效"}</small>
                  </div>
                </div>
                <div className="auth-dialog-actions">
                  <button className="auth-primary-button secondary" onClick={handleLogout} type="button">
                    退出登录
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="auth-dialog-head">
                  <div>
                    <strong>{authMode === "login" ? "用户登录" : "新用户注册"}</strong>
                    <small>{authMode === "login" ? "输入账号密码继续创作。" : "注册后会自动登录当前设备。"}</small>
                  </div>
                  <div className="auth-switch">
                    <button className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")} type="button">
                      登录
                    </button>
                    <button className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")} type="button">
                      注册
                    </button>
                  </div>
                </div>
                <form className="auth-form" onSubmit={handleAuthSubmit}>
                  <label>
                    用户名
                    <input
                      autoFocus
                      maxLength={32}
                      onChange={(event) => setAuthUsername(event.target.value)}
                      placeholder="请输入用户名"
                      value={authUsername}
                    />
                  </label>
                  <label>
                    密码
                    <input
                      maxLength={64}
                      minLength={6}
                      onChange={(event) => setAuthPassword(event.target.value)}
                      placeholder="请输入密码"
                      type="password"
                      value={authPassword}
                    />
                  </label>
                  {authError ? <p className="auth-error-text">{authError}</p> : null}
                  <div className="auth-dialog-actions">
                    <button className="auth-primary-button" disabled={isSubmittingAuth} type="submit">
                      {isSubmittingAuth ? <Loader2 size={16} /> : null}
                      {authMode === "login" ? "登录并继续" : "注册并登录"}
                    </button>
                    <button
                      className="auth-primary-button secondary"
                      onClick={() => openAuthDialog(authMode === "login" ? "register" : "login")}
                      type="button"
                    >
                      {authMode === "login" ? "新用户注册" : "已有账号去登录"}
                    </button>
                  </div>
                </form>
              </>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}
