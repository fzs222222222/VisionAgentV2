"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
    detail: "系统调用 AI 生成网页动画，多个网页动画形成视频。",
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
  const [activeNav, setActiveNav] = useState<NavKey>("home");
  const [statusText, setStatusText] = useState(navMessage.home);
  const [notifyOn, setNotifyOn] = useState(true);
  const [creatingMode, setCreatingMode] = useState<ModeKey | null>(null);

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
                className={notifyOn ? "icon-button active" : "icon-button"}
                onClick={() => setNotifyOn((value) => !value)}
                type="button"
                aria-label="通知开关"
              >
                <Bell size={18} />
              </button>
              <button
                className="icon-button"
                onClick={() => setStatusText("个人中心占位，后续可接入账号信息、偏好设置与团队空间。")}
                type="button"
                aria-label="个人中心"
              >
                <UserCircle2 size={22} />
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
                  <button className="art-arrow left" aria-label="上一张" type="button">
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
                    <button className="art-arrow right" aria-label="下一张" type="button">
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
                {index < workflow.length - 1 ? <ArrowRight size={18} className="workflow-arrow" /> : null}
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
    </main>
  );
}
