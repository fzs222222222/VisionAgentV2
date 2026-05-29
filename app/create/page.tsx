"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  Captions,
  Code2,
  Download,
  Expand,
  Image as ImageIcon,
  Loader2,
  MessageSquareText,
  Music,
  PanelLeft,
  Play,
  Plus,
  Send,
  Sparkles,
  Trash2,
  User,
  Video,
  Volume2,
  X,
} from "lucide-react";

type ModeKey = "slideshow" | "html";
type ChatRole = "user" | "assistant";

type SceneOutline = {
  sceneNumber: number;
  title: string;
  narration: string;
  visualPrompt: string;
};

type VideoOutline = {
  title: string;
  summary: string;
  fullScript: string;
  mode: ModeKey;
  promptKind: "image" | "html";
  scenes: SceneOutline[];
};

type Project = {
  uuid: string;
  title: string;
  type: ModeKey;
  outlineContent: string;
  createdAt: string;
};

type AssistantPayload = {
  intent?: {
    action: string;
    reason: string;
    targetScene?: number | null;
  } | null;
  outline?: VideoOutline | null;
};

type ChatMessage = {
  id: string;
  projectId: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  intentAction?: string | null;
  intentPayload?: AssistantPayload | null;
};

const modeCopy = {
  slideshow: {
    label: "图片轮播模式",
    prompt: "输入创作指令，例如：生成一条新能源产品介绍视频",
    assistant: "建议按图片轮播模式生成，我会输出完整逐字稿、图片分镜和后续可继续出图的提示词。",
  },
  html: {
    label: "HTML 动画模式",
    prompt: "输入创作指令，例如：生成一条数据可视化风格的储能方案动画视频",
    assistant: "建议按 HTML 动画模式生成，我会输出完整逐字稿、动画分镜和后续可继续生成网页动画的提示词。",
  },
};

function formatTime(value: string) {
  const date = new Date(value);
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatProjectTime(value: string) {
  const date = new Date(value);
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseOutlineContent(content: string) {
  if (!content) return null;

  try {
    const parsed = JSON.parse(content) as VideoOutline;
    return Array.isArray(parsed?.scenes) ? parsed : null;
  } catch {
    return null;
  }
}

function shortenNarration(value: string, maxLength = 42) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

export default function CreatePage() {
  const shellRef = useRef<HTMLElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const [selectedMode, setSelectedMode] = useState<ModeKey>("slideshow");
  const [activeScene, setActiveScene] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState("");
  const [isDeleteSelecting, setIsDeleteSelecting] = useState(false);
  const [chatPanelWidth, setChatPanelWidth] = useState(380);
  const [isOutlineModalOpen, setIsOutlineModalOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode") === "html" ? "html" : "slideshow";
    const projectId = params.get("projectId") ?? "";
    setSelectedMode(mode);
    setActiveProjectId(projectId);
  }, []);

  useEffect(() => {
    let ignore = false;
    setIsLoadingProjects(true);

    fetch("/api/projects")
      .then((response) => response.json())
      .then((data) => {
        if (ignore) return;

        const nextProjects = Array.isArray(data.projects) ? data.projects : [];
        setProjects(nextProjects);

        if (!activeProjectId && nextProjects[0]?.uuid) {
          setActiveProjectId(nextProjects[0].uuid);
          setSelectedMode(nextProjects[0].type);
        }
      })
      .catch((error) => {
        console.error("加载项目列表失败", error);
        if (!ignore) setProjects([]);
      })
      .finally(() => {
        if (!ignore) setIsLoadingProjects(false);
      });

    return () => {
      ignore = true;
    };
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProjectId) {
      setMessages([]);
      return;
    }

    let ignore = false;
    setIsLoadingMessages(true);

    fetch(`/api/video-agent/messages?projectId=${encodeURIComponent(activeProjectId)}`)
      .then((response) => response.json())
      .then((data) => {
        if (!ignore) setMessages(Array.isArray(data.messages) ? data.messages : []);
      })
      .catch((error) => {
        console.error("加载历史对话失败", error);
        if (!ignore) setMessages([]);
      })
      .finally(() => {
        if (!ignore) setIsLoadingMessages(false);
      });

    return () => {
      ignore = true;
    };
  }, [activeProjectId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isSending]);

  const currentProject = useMemo(
    () => projects.find((project) => project.uuid === activeProjectId) ?? null,
    [activeProjectId, projects],
  );

  const currentOutline = useMemo(
    () => parseOutlineContent(currentProject?.outlineContent ?? ""),
    [currentProject?.outlineContent],
  );

  const visibleScenes = currentOutline?.scenes ?? [];
  const activeOutlineScene = visibleScenes[activeScene] ?? null;

  useEffect(() => {
    if (currentProject?.type) {
      setSelectedMode(currentProject.type);
    }
  }, [currentProject?.type]);

  useEffect(() => {
    if (activeScene > Math.max(visibleScenes.length - 1, 0)) {
      setActiveScene(0);
    }
  }, [activeScene, visibleScenes.length]);

  function syncProject(nextProject: Project) {
    setProjects((current) => {
      const exists = current.some((item) => item.uuid === nextProject.uuid);
      return exists
        ? current.map((item) => (item.uuid === nextProject.uuid ? nextProject : item))
        : [nextProject, ...current];
    });
  }

  function selectProject(project: Project) {
    setActiveProjectId(project.uuid);
    setSelectedMode(project.type);
    setActiveScene(0);
    setIsOutlineModalOpen(false);
    window.history.replaceState(null, "", `/create?projectId=${encodeURIComponent(project.uuid)}&mode=${project.type}`);
  }

  function handleModeChange(mode: ModeKey) {
    setSelectedMode(mode);
    if (!activeProjectId) {
      window.history.replaceState(null, "", `/create?mode=${mode}`);
    }
  }

  function handleResizeStart(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();

    const onMouseMove = (moveEvent: MouseEvent) => {
      const shell = shellRef.current;
      if (!shell) return;

      const rect = shell.getBoundingClientRect();
      const available = rect.width - 300 - 8 - 16 * 3;
      const minChat = 320;
      const maxChat = Math.max(minChat, Math.min(Math.floor(available / 2), available - 360));
      const nextWidth = rect.right - moveEvent.clientX;

      setChatPanelWidth(Math.min(Math.max(nextWidth, minChat), maxChat));
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  async function handleCreateProject() {
    if (isCreatingProject) return;
    setIsCreatingProject(true);

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: selectedMode }),
      });
      const data = await response.json();

      if (!response.ok || !data.project?.uuid) {
        throw new Error(data.error ?? "创建项目失败");
      }

      syncProject(data.project);
      selectProject(data.project);
    } catch (error) {
      console.error("创建项目失败", error);
    } finally {
      setIsCreatingProject(false);
    }
  }

  async function handleDeleteProject(project: Project) {
    if (deletingProjectId) return;

    const confirmed = window.confirm(`确认删除项目“${project.title}”吗？该项目的对话记录也会一起删除。`);
    if (!confirmed) return;

    setDeletingProjectId(project.uuid);

    try {
      const response = await fetch(`/api/projects?projectId=${encodeURIComponent(project.uuid)}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error ?? "删除项目失败");
      }

      const nextProjects = projects.filter((item) => item.uuid !== project.uuid);
      setProjects(nextProjects);

      if (project.uuid === activeProjectId) {
        const nextProject = nextProjects[0];

        if (nextProject) {
          selectProject(nextProject);
        } else {
          setActiveProjectId("");
          setMessages([]);
          window.history.replaceState(null, "", `/create?mode=${selectedMode}`);
        }
      }

      setIsDeleteSelecting(false);
    } catch (error) {
      console.error("删除项目失败", error);
    } finally {
      setDeletingProjectId("");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = prompt.trim();

    if (!content || isSending || !activeProjectId) return;

    const optimisticMessage: ChatMessage = {
      id: `optimistic-${Date.now()}`,
      projectId: activeProjectId,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };

    setPrompt("");
    setIsSending(true);
    setMessages((current) => [...current, optimisticMessage]);

    try {
      const response = await fetch("/api/video-agent/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: activeProjectId, content, mode: selectedMode }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "发送失败");
      }

      if (data.project?.uuid) {
        syncProject(data.project);
      }

      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setActiveScene(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : "发送失败";
      setMessages((current) => [
        ...current,
        {
          id: `error-${Date.now()}`,
          projectId: activeProjectId,
          role: "assistant",
          content: `处理失败：${message}`,
          createdAt: new Date().toISOString(),
          intentAction: "unsupported",
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <main className="studio-page studio-viewport">
      <header className="studio-topbar">
        <Link className="brand" href="/">
          <span className="logo-mark">
            <Play size={24} fill="currentColor" />
          </span>
          <span>
            <strong>VisionAgent</strong>
            <small>视频制作 Agent</small>
          </span>
        </Link>
        <div className="studio-topbar-actions">
          <Link className="back-home" href="/">
            <ArrowLeft size={18} />
            返回首页
          </Link>
        </div>
      </header>

      <section
        className="studio-shell tight-studio-shell resizable-studio-shell"
        ref={shellRef}
        style={{ gridTemplateColumns: `300px minmax(360px, 1fr) 8px ${chatPanelWidth}px` }}
      >
        <aside className="history-panel compact-panel">
          <div className="panel-title">
            <span>
              <PanelLeft size={18} />
              历史项目
            </span>
            <div className="panel-actions">
              <button
                className="mini-button mini-button-danger"
                disabled={projects.length === 0 || Boolean(deletingProjectId)}
                onClick={() => setIsDeleteSelecting((value) => !value)}
                type="button"
              >
                {Boolean(deletingProjectId) ? <Loader2 size={16} /> : <Trash2 size={16} />}
                {isDeleteSelecting ? "取消删除" : "删除"}
              </button>
              <button className="mini-button" disabled={isCreatingProject} onClick={() => void handleCreateProject()} type="button">
                {isCreatingProject ? <Loader2 size={16} /> : <Plus size={16} />}
                新建
              </button>
            </div>
          </div>
          {isDeleteSelecting ? <p className="history-delete-tip">请选择一个历史项目进行删除</p> : null}
          <div className="project-list compact-scroll">
            {isLoadingProjects ? <p className="empty-text">正在加载项目...</p> : null}
            {!isLoadingProjects && projects.length === 0 ? <p className="empty-text">暂无历史项目</p> : null}
            {projects.map((project, index) => (
              <div
                className={`project-item ${project.uuid === activeProjectId ? "selected" : ""} ${isDeleteSelecting ? "delete-selecting" : ""}`}
                key={project.uuid}
              >
                <button
                  className="project-select"
                  onClick={() => {
                    if (isDeleteSelecting) {
                      void handleDeleteProject(project);
                      return;
                    }

                    selectProject(project);
                  }}
                  type="button"
                >
                  <span className={`thumb t${(index % 5) + 1}`} />
                  <span className="project-meta">
                    <strong>{project.title}</strong>
                    <small>{formatProjectTime(project.createdAt)}</small>
                  </span>
                </button>
              </div>
            ))}
          </div>
          <button className="secondary-action" type="button">
            查看全部项目
          </button>
        </aside>

        <section className="preview-panel compact-panel">
          <div className="preview-toolbar">
            <div className="mode-badge">
              <Sparkles size={18} />
              {modeCopy[selectedMode].label}
            </div>
            <div className="tool-actions">
              <button type="button">
                <Captions size={17} /> 字幕
              </button>
              <button type="button">
                <Expand size={17} /> 全屏
              </button>
              <button type="button">
                <Download size={17} /> 导出视频
              </button>
              <button className="solid" type="button">
                <Play size={17} fill="currentColor" /> 预览
              </button>
            </div>
          </div>

          <div className={`video-stage compact-stage ${activeOutlineScene ? "has-outline" : "is-empty"}`}>
            {currentOutline && activeOutlineScene ? (
              <>
                <div className="stage-copy stage-copy-dynamic">
                  <span className="stage-kicker">
                    {currentOutline.promptKind === "image" ? "图片分镜预览" : "HTML 动画分镜预览"}
                  </span>
                  <h1>{currentOutline.title}</h1>
                  <p>{activeOutlineScene.title}</p>
                  <div className="stage-summary">
                    <strong>旁白</strong>
                    <span>{activeOutlineScene.narration}</span>
                  </div>
                </div>
                <div className="stage-visual stage-visual-outline">
                  <div className="stage-preview-placeholder">
                    {currentOutline.promptKind === "image" ? <ImageIcon size={42} /> : <Code2 size={42} />}
                    <strong>画面预览预留区</strong>
                    <small>{currentOutline.promptKind === "image" ? "后续展示 AI 生成图片" : "后续展示 HTML 动画效果"}</small>
                  </div>
                </div>
                <div className="player-controls">
                  <Play size={18} fill="currentColor" />
                  <Volume2 size={18} />
                  <span>
                    分镜 {activeOutlineScene.sceneNumber} / {visibleScenes.length}
                  </span>
                  <span className="progress">
                    <i style={{ width: `${(activeOutlineScene.sceneNumber / visibleScenes.length) * 100}%` }} />
                  </span>
                </div>
              </>
            ) : (
              <div className="preview-empty-state">
                <div className="preview-empty-icon">
                  {selectedMode === "slideshow" ? <ImageIcon size={36} /> : <Code2 size={36} />}
                </div>
                <strong>这里还没有分镜内容</strong>
                <p>先在右侧输入创作指令，生成视频大纲后，这里会自动加载分镜预览。</p>
              </div>
            )}
          </div>

          <div className="scene-header compact-scene-header">
            <strong>分镜列表</strong>
            <small>共 {visibleScenes.length} 个分镜</small>
            <button disabled type="button">
              <Plus size={16} /> 添加分镜
            </button>
          </div>
          <div className="scene-board">
            {visibleScenes.length > 0 ? (
              <div className="scene-strip compact-scene-strip">
                {visibleScenes.map((scene, index) => (
                  <button
                    className={`scene-card ${selectedMode === "html" ? "violet" : "sky"} ${activeScene === index ? "active" : ""}`}
                    key={`${scene.sceneNumber}-${scene.title}`}
                    onClick={() => setActiveScene(index)}
                    type="button"
                  >
                    <span className="scene-number">{scene.sceneNumber}</span>
                    <span className="scene-thumb">
                      {selectedMode === "html" ? <Video size={28} /> : <ImageIcon size={28} />}
                    </span>
                    <strong>{scene.title}</strong>
                    <small>{shortenNarration(scene.narration)}</small>
                    <em>{selectedMode === "html" ? "HTML" : "图片"}</em>
                  </button>
                ))}
              </div>
            ) : (
              <div className="scene-board-empty">
                <strong>暂无分镜</strong>
                <p>大纲生成完成后，分镜会在这里动态出现。</p>
              </div>
            )}
          </div>
        </section>

        <button
          aria-label="调整预览和对话面板宽度"
          className="panel-resizer"
          onMouseDown={handleResizeStart}
          type="button"
        />

        <aside className="chat-panel compact-panel">
          <div className="panel-title">
            <span>
              <MessageSquareText size={18} />
              AI 创作对话
            </span>
            <button className="ghost-button" type="button">
              清空对话
            </button>
          </div>
          <div className="mode-hint-box">
            <strong>创作模式提示</strong>
            <p>输入你的创作指令，系统会先判断意图；如果识别为生成视频大纲，就会直接产出逐字稿与结构化分镜。</p>
            <div className="mode-choice-buttons">
              <button
                className={selectedMode === "slideshow" ? "mode-choice active" : "mode-choice"}
                onClick={() => handleModeChange("slideshow")}
                type="button"
              >
                <ImageIcon size={14} />
                图片轮播模式
              </button>
              <button
                className={selectedMode === "html" ? "mode-choice active" : "mode-choice"}
                onClick={() => handleModeChange("html")}
                type="button"
              >
                <Code2 size={14} />
                HTML 动画模式
              </button>
            </div>
          </div>
          <div className="chat-list compact-scroll">
            {isLoadingMessages ? (
              <div className="message assistant">
                <span className="avatar">
                  <Bot size={17} />
                </span>
                <div>
                  <div className="message-head">
                    <strong>AI 助手</strong>
                    <small>加载中</small>
                  </div>
                  <p>正在加载历史对话...</p>
                </div>
              </div>
            ) : null}
            {!isLoadingMessages && messages.length === 0 ? (
              <div className="message assistant">
                <span className="avatar">
                  <Bot size={17} />
                </span>
                <div>
                  <div className="message-head">
                    <strong>AI 助手</strong>
                    <small>现在</small>
                  </div>
                  <p>{activeProjectId ? modeCopy[selectedMode].assistant : "请先在首页创建一个项目。"}</p>
                </div>
              </div>
            ) : null}
            {messages.map((message) => {
              const outline = message.intentPayload?.outline ?? null;

              return (
                <div className={`message ${message.role}`} key={message.id}>
                  <span className="avatar">
                    {message.role === "user" ? <User size={17} /> : <Bot size={17} />}
                  </span>
                  <div>
                    <div className="message-head">
                      <strong>{message.role === "user" ? "用户" : "AI 助手"}</strong>
                      <small>{formatTime(message.createdAt)}</small>
                    </div>
                    <p>{message.content}</p>
                    {outline ? (
                      <div className="outline-card">
                        <div className="outline-card-head">
                          <strong>{outline.title}</strong>
                          <small>
                            {outline.promptKind === "image" ? "图片分镜" : "HTML 动画分镜"} · {outline.scenes.length} 个分镜
                          </small>
                        </div>
                        <p className="outline-summary">{outline.summary}</p>
                        <div className="outline-table-wrap">
                          <table className="outline-table">
                            <thead>
                              <tr>
                                <th>编号</th>
                                <th>标题</th>
                                <th>旁白</th>
                              </tr>
                            </thead>
                            <tbody>
                              {outline.scenes.map((scene) => (
                                <tr key={`${message.id}-${scene.sceneNumber}`}>
                                  <td>{scene.sceneNumber}</td>
                                  <td>{scene.title}</td>
                                  <td>{shortenNarration(scene.narration, 56)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="outline-card-footer">
                          <button onClick={() => setIsOutlineModalOpen(true)} type="button">
                            查看完整大纲内容
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {isSending ? (
              <div className="message assistant">
                <span className="avatar">
                  <Bot size={17} />
                </span>
                <div>
                  <div className="message-head">
                    <strong>AI 助手</strong>
                    <small>分析中</small>
                  </div>
                  <p className="typing-row">
                    <Loader2 size={15} /> 正在分析用户意图并生成内容...
                  </p>
                </div>
              </div>
            ) : null}
            <div ref={chatEndRef} />
          </div>
          <form className="prompt-box" onSubmit={handleSubmit}>
            <button aria-label="选择背景音乐" type="button">
              <Music size={18} />
            </button>
            <input
              disabled={!activeProjectId}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={modeCopy[selectedMode].prompt}
              value={prompt}
            />
            <button className="send" aria-label="发送" disabled={isSending || !prompt.trim() || !activeProjectId} type="submit">
              {isSending ? <Loader2 size={18} /> : <Send size={18} />}
            </button>
          </form>
        </aside>
      </section>

      {isOutlineModalOpen && currentOutline ? (
        <div className="outline-modal-backdrop" onClick={() => setIsOutlineModalOpen(false)} role="presentation">
          <div className="outline-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="outline-modal-head">
              <div>
                <strong>{currentOutline.title}</strong>
                <small>{currentOutline.summary}</small>
              </div>
              <button className="outline-modal-close" onClick={() => setIsOutlineModalOpen(false)} type="button">
                <X size={18} />
              </button>
            </div>
            <div className="outline-modal-script">
              <strong>完整逐字稿</strong>
              <p>{currentOutline.fullScript}</p>
            </div>
            <div className="outline-scene-grid">
              {currentOutline.scenes.map((scene) => (
                <article className="outline-scene-detail-card" key={`detail-${scene.sceneNumber}`}>
                  <div className="outline-scene-preview">
                    {currentOutline.promptKind === "image" ? <ImageIcon size={28} /> : <Code2 size={28} />}
                    <span>画面预览预留</span>
                  </div>
                  <div className="outline-scene-meta">
                    <strong>
                      {scene.sceneNumber}. {scene.title}
                    </strong>
                    <p>
                      <span>分镜旁白</span>
                      {scene.narration}
                    </p>
                    <p>
                      <span>分镜提示词</span>
                      {scene.visualPrompt}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
