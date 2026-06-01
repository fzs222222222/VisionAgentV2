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
  Pause,
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
import { getSceneAudioMap, getSceneImageMap } from "@/app/lib/videoSource";

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
  globalVisualStylePrompt?: string;
  scenes: SceneOutline[];
};

type Project = {
  uuid: string;
  title: string;
  type: ModeKey;
  outlineContent: string;
  videoSource: string;
  createdAt: string;
};

type SceneAudio = {
  sceneNumber: number;
  title: string;
  narration: string;
  voice: string;
  filename: string;
  relativePath: string;
  publicUrl: string;
  durationMs?: number;
  createdAt: string;
};

type SubtitleSegment = {
  text: string;
  startRatio: number;
  endRatio: number;
};

type ExportFormat = {
  extension: "mp4" | "webm";
  mimeType: string;
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

function normalizeSubtitleSentence(value: string) {
  return value.replace(/[，。！？；：,.!?;:\s]+$/g, "").trim();
}

function splitNarrationIntoSubtitles(narration: string) {
  const parts = narration
    .split(/[，。！？；：,.!?;\n\r]+/g)
    .map(normalizeSubtitleSentence)
    .filter(Boolean);

  if (!parts.length) {
    return [] as SubtitleSegment[];
  }

  const totalCharacters = parts.reduce((sum, part) => sum + part.length, 0) || parts.length;
  let accumulatedRatio = 0;

  return parts.map((part, index) => {
    const ratio = part.length / totalCharacters;
    const startRatio = accumulatedRatio;
    const endRatio = index === parts.length - 1 ? 1 : Math.min(accumulatedRatio + ratio, 1);
    accumulatedRatio = endRatio;

    return {
      text: part,
      startRatio,
      endRatio,
    };
  });
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function pickExportFormat() {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return null;
  }

  const candidates: ExportFormat[] = [
    { extension: "mp4", mimeType: 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"' },
    { extension: "webm", mimeType: 'video/webm;codecs="vp9,opus"' },
    { extension: "webm", mimeType: 'video/webm;codecs="vp8,opus"' },
    { extension: "webm", mimeType: "video/webm" },
  ];

  return candidates.find((item) => MediaRecorder.isTypeSupported(item.mimeType)) ?? null;
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`图片加载失败: ${url}`));
    image.src = url;
  });
}

function drawImageCover(context: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number, zoom = 1) {
  const imageRatio = image.width / image.height;
  const canvasRatio = width / height;

  let drawWidth = width;
  let drawHeight = height;

  if (imageRatio > canvasRatio) {
    drawHeight = height;
    drawWidth = height * imageRatio;
  } else {
    drawWidth = width;
    drawHeight = width / imageRatio;
  }

  drawWidth *= zoom;
  drawHeight *= zoom;

  const offsetX = (width - drawWidth) / 2;
  const offsetY = (height - drawHeight) / 2;
  context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
}

function drawSubtitleCard(context: CanvasRenderingContext2D, text: string, width: number, height: number) {
  if (!text) {
    return;
  }

  const maxTextWidth = Math.min(width * 0.8, 920);
  const fontSize = Math.max(28, Math.min(46, Math.round(width / 28)));
  context.font = `800 ${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;

  const words = Array.from(text);
  const lines: string[] = [];
  let currentLine = "";

  words.forEach((character) => {
    const nextLine = currentLine + character;
    if (context.measureText(nextLine).width > maxTextWidth && currentLine) {
      lines.push(currentLine);
      currentLine = character;
      return;
    }
    currentLine = nextLine;
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  const lineHeight = Math.round(fontSize * 1.38);
  const cardHeight = lines.length * lineHeight + 28;
  const boxY = height - 170 - cardHeight;
  const boxWidth = Math.min(
    maxTextWidth + 64,
    Math.max(...lines.map((line) => context.measureText(line).width), 0) + 64,
  );
  const boxX = (width - boxWidth) / 2;

  context.save();
  context.fillStyle = "rgba(20, 29, 45, 0.55)";
  context.beginPath();
  context.roundRect(boxX, boxY, boxWidth, cardHeight, 20);
  context.fill();
  context.shadowColor = "rgba(0, 0, 0, 0.72)";
  context.shadowBlur = 18;
  context.fillStyle = "#ffffff";
  context.textAlign = "center";
  context.textBaseline = "middle";

  lines.forEach((line, index) => {
    const y = boxY + 14 + lineHeight / 2 + index * lineHeight;
    context.fillText(line, width / 2, y);
  });
  context.restore();
}

const DEFAULT_SCENE_DURATION_MS = 3000;

function estimateNarrationDurationMs(narration: string) {
  const trimmed = narration.trim();
  if (!trimmed) {
    return DEFAULT_SCENE_DURATION_MS;
  }

  const compactText = trimmed.replace(/\s+/g, "");
  const pauseCount = (trimmed.match(/[，。！？；：,.!?;:]/g) ?? []).length;
  const estimatedMs = Math.round((compactText.length / 4.2) * 1000 + pauseCount * 180);
  return Math.max(2500, estimatedMs);
}

export default function CreatePage() {
  const shellRef = useRef<HTMLElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const playbackSceneRef = useRef<number | null>(null);
  const playbackSceneTimeoutRef = useRef<number | null>(null);
  const sceneGenerationAbortRef = useRef<AbortController | null>(null);
  const stopSceneGenerationRef = useRef(false);
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
  const [isGeneratingSceneImages, setIsGeneratingSceneImages] = useState(false);
  const [generatingSceneNumber, setGeneratingSceneNumber] = useState<number | null>(null);
  const [sceneGenerationError, setSceneGenerationError] = useState("");
  const [playingSceneNumber, setPlayingSceneNumber] = useState<number | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [currentPlaybackMs, setCurrentPlaybackMs] = useState(0);
  const [sceneDurationMap, setSceneDurationMap] = useState<Record<number, number>>({});
  const [sceneActionLoadingMap, setSceneActionLoadingMap] = useState<Record<string, boolean>>({});
  const [isExportingVideo, setIsExportingVideo] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportMessage, setExportMessage] = useState("");

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

  useEffect(() => {
    return () => {
      stopSceneGenerationRef.current = true;
      sceneGenerationAbortRef.current?.abort();
      if (playbackSceneTimeoutRef.current !== null) {
        window.clearTimeout(playbackSceneTimeoutRef.current);
      }
      previewAudioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    stopSceneGenerationRef.current = true;
    sceneGenerationAbortRef.current?.abort();
    setIsGeneratingSceneImages(false);
    setGeneratingSceneNumber(null);
    setSceneGenerationError("");
    setIsPreviewPlaying(false);
    setCurrentPlaybackMs(0);
    setSceneActionLoadingMap({});
    setIsExportingVideo(false);
    setExportProgress(0);
    setExportMessage("");
    previewAudioRef.current?.pause();
  }, [activeProjectId]);

  const currentProject = useMemo(
    () => projects.find((project) => project.uuid === activeProjectId) ?? null,
    [activeProjectId, projects],
  );

  const currentOutline = useMemo(
    () => parseOutlineContent(currentProject?.outlineContent ?? ""),
    [currentProject?.outlineContent],
  );

  const visibleScenes = currentOutline?.scenes ?? [];
  const sceneImageMap = useMemo(() => getSceneImageMap(currentProject?.videoSource ?? ""), [currentProject?.videoSource]);
  const sceneAudioMap = useMemo(() => getSceneAudioMap(currentProject?.videoSource ?? ""), [currentProject?.videoSource]);
  const sceneTimeline = useMemo(
    () =>
      visibleScenes.map((scene, index) => {
        const durationMs =
          sceneAudioMap[scene.sceneNumber]?.durationMs ??
          sceneDurationMap[scene.sceneNumber] ??
          estimateNarrationDurationMs(scene.narration);
        const startMs =
          index === 0
            ? 0
            : visibleScenes
                .slice(0, index)
                .reduce(
                  (sum, previousScene) =>
                    sum +
                    (sceneAudioMap[previousScene.sceneNumber]?.durationMs ??
                      sceneDurationMap[previousScene.sceneNumber] ??
                      estimateNarrationDurationMs(previousScene.narration)),
                  0,
                );

        return {
          sceneNumber: scene.sceneNumber,
          startMs,
          endMs: startMs + durationMs,
          durationMs,
        };
      }),
    [sceneAudioMap, sceneDurationMap, visibleScenes],
  );
  const totalPlaybackDurationMs = useMemo(
    () => sceneTimeline[sceneTimeline.length - 1]?.endMs ?? 0,
    [sceneTimeline],
  );
  const displaySceneIndex = activeScene;
  const activeOutlineScene = visibleScenes[displaySceneIndex] ?? null;
  const activeSceneImage = activeOutlineScene ? sceneImageMap[activeOutlineScene.sceneNumber] ?? null : null;
  const activeSceneAudio = activeOutlineScene ? sceneAudioMap[activeOutlineScene.sceneNumber] ?? null : null;
  const canGenerateSceneImages = currentOutline?.promptKind === "image" && visibleScenes.length > 0;
  const generatedSceneCount = useMemo(
    () => visibleScenes.filter((scene) => Boolean(sceneImageMap[scene.sceneNumber] && sceneAudioMap[scene.sceneNumber])).length,
    [sceneAudioMap, sceneImageMap, visibleScenes],
  );
  const activePlaybackSegment = sceneTimeline[displaySceneIndex] ?? null;
  const activeScenePlaybackProgress =
    isPreviewPlaying && activePlaybackSegment
      ? Math.min(
          Math.max((currentPlaybackMs - activePlaybackSegment.startMs) / Math.max(activePlaybackSegment.durationMs, 1), 0),
          1,
        )
      : 0;
  const playbackProgressPercent = totalPlaybackDurationMs > 0 ? Math.min((currentPlaybackMs / totalPlaybackDurationMs) * 100, 100) : 0;
  const activeSubtitleSegments = useMemo(
    () => (activeOutlineScene ? splitNarrationIntoSubtitles(activeOutlineScene.narration) : []),
    [activeOutlineScene],
  );
  const activeSubtitleText = useMemo(() => {
    if (!activeSubtitleSegments.length) {
      return "";
    }

    const matchedSegment =
      activeSubtitleSegments.find(
        (segment) => activeScenePlaybackProgress >= segment.startRatio && activeScenePlaybackProgress < segment.endRatio,
      ) ?? activeSubtitleSegments[activeSubtitleSegments.length - 1];

    return matchedSegment?.text ?? "";
  }, [activeScenePlaybackProgress, activeSubtitleSegments]);
  const displaySubtitleText = activeSubtitleText || activeSubtitleSegments[0]?.text || "";

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

  useEffect(() => {
    if (!visibleScenes.length) {
      setSceneDurationMap({});
      return;
    }

    let ignore = false;
    const nextDurations: Record<number, number> = {};
    const tasks = visibleScenes.map((scene) => {
      const storedDuration = sceneAudioMap[scene.sceneNumber]?.durationMs;
      if (typeof storedDuration === "number" && storedDuration > 0) {
        nextDurations[scene.sceneNumber] = storedDuration;
        return Promise.resolve();
      }

      const sceneAudio = sceneAudioMap[scene.sceneNumber];
      if (!sceneAudio?.publicUrl) {
        nextDurations[scene.sceneNumber] = estimateNarrationDurationMs(scene.narration);
        return Promise.resolve();
      }

      return new Promise<void>((resolve) => {
        const probe = new Audio();
        probe.preload = "metadata";
        probe.src = sceneAudio.publicUrl;

        const finalize = (durationMs: number) => {
          nextDurations[scene.sceneNumber] = durationMs;
          probe.src = "";
          resolve();
        };

        probe.onloadedmetadata = () => {
          const durationMs =
            Number.isFinite(probe.duration) && probe.duration > 0
              ? Math.round(probe.duration * 1000)
              : estimateNarrationDurationMs(scene.narration);
          finalize(durationMs);
        };
        probe.onerror = () => finalize(estimateNarrationDurationMs(scene.narration));
      });
    });

    void Promise.all(tasks).then(() => {
      if (!ignore) {
        setSceneDurationMap(nextDurations);
      }
    });

    return () => {
      ignore = true;
    };
  }, [sceneAudioMap, visibleScenes]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleEnded = () => setPlayingSceneNumber(null);
    const handlePause = () => {
      if (!audio.ended) {
        setPlayingSceneNumber(null);
      }
    };

    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("pause", handlePause);

    return () => {
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("pause", handlePause);
    };
  }, []);

  useEffect(() => {
    if (playingSceneNumber !== null && !sceneAudioMap[playingSceneNumber]) {
      audioRef.current?.pause();
      setPlayingSceneNumber(null);
    }
  }, [playingSceneNumber, sceneAudioMap]);

  useEffect(() => {
    if (!isPreviewPlaying || !activeOutlineScene) {
      if (playbackSceneTimeoutRef.current !== null) {
        window.clearTimeout(playbackSceneTimeoutRef.current);
        playbackSceneTimeoutRef.current = null;
      }
      previewAudioRef.current?.pause();
      playbackSceneRef.current = null;
      return;
    }

    if (playbackSceneRef.current === activeOutlineScene.sceneNumber) {
      return;
    }

    playbackSceneRef.current = activeOutlineScene.sceneNumber;
    const previewAudio = previewAudioRef.current;
    const sceneAudio = sceneAudioMap[activeOutlineScene.sceneNumber];
    const activeSegment = sceneTimeline[activeScene];

    if (!activeSegment) {
      stopPreviewPlayback();
      return;
    }

    if (playbackSceneTimeoutRef.current !== null) {
      window.clearTimeout(playbackSceneTimeoutRef.current);
      playbackSceneTimeoutRef.current = null;
    }

    setCurrentPlaybackMs(activeSegment.startMs);

    const advanceToNextScene = () => {
      if (playbackSceneTimeoutRef.current !== null) {
        window.clearTimeout(playbackSceneTimeoutRef.current);
        playbackSceneTimeoutRef.current = null;
      }

      const nextSceneIndex = activeScene + 1;
      if (nextSceneIndex < visibleScenes.length) {
        setActiveScene(nextSceneIndex);
        return;
      }

      stopPreviewPlayback();
      setCurrentPlaybackMs(totalPlaybackDurationMs);
      setActiveScene(Math.max(visibleScenes.length - 1, 0));
    };

    if (!previewAudio || !sceneAudio?.publicUrl) {
      if (previewAudio) {
        previewAudio.pause();
        previewAudio.removeAttribute("src");
        previewAudio.load();
      }
      playbackSceneTimeoutRef.current = window.setTimeout(() => {
        setCurrentPlaybackMs(activeSegment.endMs);
        advanceToNextScene();
      }, activeSegment.durationMs);
      return;
    }

    previewAudio.pause();
    previewAudio.src = sceneAudio.publicUrl;
    previewAudio.currentTime = 0;
    previewAudio.onloadedmetadata = () => {
      const actualDurationMs =
        Number.isFinite(previewAudio.duration) && previewAudio.duration > 0
          ? Math.round(previewAudio.duration * 1000)
          : estimateNarrationDurationMs(activeOutlineScene.narration);
      setSceneDurationMap((current) => ({
        ...current,
        [activeOutlineScene.sceneNumber]: Math.max(current[activeOutlineScene.sceneNumber] ?? 0, actualDurationMs),
      }));
    };
    previewAudio.ontimeupdate = () => {
      setCurrentPlaybackMs(Math.min(activeSegment.startMs + previewAudio.currentTime * 1000, totalPlaybackDurationMs));
    };
    previewAudio.onended = () => {
      setCurrentPlaybackMs(activeSegment.endMs);
      advanceToNextScene();
    };
    previewAudio.onerror = () => {
      setCurrentPlaybackMs(activeSegment.endMs);
      advanceToNextScene();
    };
    void previewAudio.play().catch((error) => {
      console.error("播放视频分镜音频失败", error);
      stopPreviewPlayback();
    });
  }, [activeOutlineScene, activeScene, isPreviewPlaying, sceneAudioMap, sceneTimeline, totalPlaybackDurationMs, visibleScenes.length]);

  function syncProject(nextProject: Project) {
    setProjects((current) => {
      const exists = current.some((item) => item.uuid === nextProject.uuid);
      return exists
        ? current.map((item) => (item.uuid === nextProject.uuid ? nextProject : item))
        : [nextProject, ...current];
    });
  }

  function selectProject(project: Project) {
    stopPreviewPlayback(true);
    setActiveProjectId(project.uuid);
    setSelectedMode(project.type);
    setActiveScene(0);
    setIsOutlineModalOpen(false);
    window.history.replaceState(null, "", `/create?projectId=${encodeURIComponent(project.uuid)}&mode=${project.type}`);
  }

  function handleModeChange(mode: ModeKey) {
    stopPreviewPlayback(true);
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

  function handleStopSceneGeneration() {
    stopSceneGenerationRef.current = true;
    sceneGenerationAbortRef.current?.abort();
  }

  function stopPreviewPlayback(resetToStart = false) {
    if (playbackSceneTimeoutRef.current !== null) {
      window.clearTimeout(playbackSceneTimeoutRef.current);
      playbackSceneTimeoutRef.current = null;
    }

    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.onloadedmetadata = null;
      previewAudioRef.current.ontimeupdate = null;
      previewAudioRef.current.onended = null;
      previewAudioRef.current.onerror = null;
      previewAudioRef.current.removeAttribute("src");
      previewAudioRef.current.load();
    }
    playbackSceneRef.current = null;
    setIsPreviewPlaying(false);

    if (resetToStart) {
      setCurrentPlaybackMs(0);
      setActiveScene(0);
    }
  }

  function startPreviewPlayback() {
    if (!visibleScenes.length || totalPlaybackDurationMs <= 0) {
      return;
    }

    audioRef.current?.pause();
    setPlayingSceneNumber(null);
    setCurrentPlaybackMs(0);
    setActiveScene(0);
    playbackSceneRef.current = null;
    setIsPreviewPlaying(true);
  }

  function handleTogglePreviewPlayback() {
    if (isPreviewPlaying) {
      stopPreviewPlayback();
      return;
    }

    startPreviewPlayback();
  }

  async function handlePlaySceneAudio(audio: SceneAudio, event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    stopPreviewPlayback();

    const player = audioRef.current;
    if (!player) return;

    if (playingSceneNumber === audio.sceneNumber && !player.paused) {
      player.pause();
      setPlayingSceneNumber(null);
      return;
    }

    player.src = audio.publicUrl;

    try {
      await player.play();
      setPlayingSceneNumber(audio.sceneNumber);
    } catch (error) {
      console.error("播放分镜音频失败", error);
      setPlayingSceneNumber(null);
    }
  }

  function setSceneActionLoading(actionKey: string, loading: boolean) {
    setSceneActionLoadingMap((current) => {
      if (loading) {
        return {
          ...current,
          [actionKey]: true,
        };
      }

      const next = { ...current };
      delete next[actionKey];
      return next;
    });
  }

  async function requestSceneMediaGeneration(
    sceneNumber: number,
    options?: {
      regenerateImage?: boolean;
      regenerateAudio?: boolean;
      actionKey?: string;
    },
  ) {
    if (!activeProjectId) {
      return;
    }

    const actionKey = options?.actionKey;
    if (actionKey) {
      setSceneActionLoading(actionKey, true);
    }

    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(activeProjectId)}/scene-images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sceneNumber,
          regenerateImage: options?.regenerateImage ?? false,
          regenerateAudio: options?.regenerateAudio ?? false,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.details ?? data.error ?? "生成分镜资源失败");
      }

      if (data.project?.uuid) {
        syncProject(data.project);
      }
    } finally {
      if (actionKey) {
        setSceneActionLoading(actionKey, false);
      }
    }
  }

  async function handleGenerateSceneImages() {
    if (!activeProjectId || !canGenerateSceneImages || isGeneratingSceneImages) return;

    const completedScenes = new Set(
      visibleScenes
        .filter((scene) => Boolean(sceneImageMap[scene.sceneNumber] && sceneAudioMap[scene.sceneNumber]))
        .map((scene) => scene.sceneNumber),
    );
    stopSceneGenerationRef.current = false;
    setSceneGenerationError("");
    setIsGeneratingSceneImages(true);

    try {
      for (const scene of visibleScenes) {
        if (stopSceneGenerationRef.current) break;
        if (completedScenes.has(scene.sceneNumber)) continue;

        setGeneratingSceneNumber(scene.sceneNumber);
        const controller = new AbortController();
        sceneGenerationAbortRef.current = controller;

        try {
          const response = await fetch(`/api/projects/${encodeURIComponent(activeProjectId)}/scene-images`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sceneNumber: scene.sceneNumber }),
            signal: controller.signal,
          });

          const data = await response.json().catch(() => ({}));

          if (response.status === 499 || data.aborted || stopSceneGenerationRef.current) {
            break;
          }

          if (!response.ok) {
            throw new Error(data.details ?? data.error ?? "生成分镜图片失败");
          }

          if (data.project?.uuid) {
            syncProject(data.project);
          }

          completedScenes.add(scene.sceneNumber);
        } finally {
          sceneGenerationAbortRef.current = null;
          setGeneratingSceneNumber(null);
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError" && stopSceneGenerationRef.current) {
        return;
      }

      const message = error instanceof Error ? error.message : "生成分镜图片失败";
      setSceneGenerationError(message);
    } finally {
      setIsGeneratingSceneImages(false);
      setGeneratingSceneNumber(null);
      sceneGenerationAbortRef.current = null;
      stopSceneGenerationRef.current = false;
    }
  }

  async function handleRegenerateSceneImage(sceneNumber: number, event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    setSceneGenerationError("");

    try {
      await requestSceneMediaGeneration(sceneNumber, {
        regenerateImage: true,
        actionKey: `image-${sceneNumber}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "重新生成画面失败";
      setSceneGenerationError(message);
    }
  }

  async function handleRegenerateSceneAudio(sceneNumber: number, event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    setSceneGenerationError("");

    try {
      await requestSceneMediaGeneration(sceneNumber, {
        regenerateAudio: true,
        actionKey: `audio-${sceneNumber}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "重新生成旁白失败";
      setSceneGenerationError(message);
    }
  }

  async function handleExportVideo() {
    if (!activeProjectId || !currentOutline || currentOutline.promptKind !== "image" || !visibleScenes.length || isExportingVideo) {
      return;
    }

    const exportFormat = pickExportFormat();
    if (!exportFormat) {
      setExportMessage("当前浏览器不支持视频导出格式");
      return;
    }

    const exportScenes = visibleScenes.map((scene, index) => {
      const sceneImage = sceneImageMap[scene.sceneNumber];
      const segment = sceneTimeline[index];
      return {
        scene,
        image: sceneImage,
        audio: sceneAudioMap[scene.sceneNumber] ?? null,
        segment,
        subtitles: splitNarrationIntoSubtitles(scene.narration),
      };
    });

    if (exportScenes.some((item) => !item.image || !item.segment)) {
      setExportMessage("请先为所有分镜生成图片后再导出");
      return;
    }

    stopPreviewPlayback();
    audioRef.current?.pause();
    setPlayingSceneNumber(null);
    setExportMessage("");
    setExportProgress(0);
    setIsExportingVideo(true);

    const canvas = document.createElement("canvas");
    const width = 1280;
    const height = 720;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");

    if (!context) {
      setIsExportingVideo(false);
      setExportMessage("导出画布初始化失败");
      return;
    }

    const audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();
    const fps = 30;
    const stream = canvas.captureStream(fps);
    destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));

    let animationFrameId = 0;
    let recorderStopTimer = 0;
    let startedAt = 0;

    try {
      const [loadedImages, decodedAudios] = await Promise.all([
        Promise.all(exportScenes.map(async (item) => [item.scene.sceneNumber, await loadImage(item.image!.publicUrl)] as const)),
        Promise.all(
          exportScenes.map(async (item) => {
            if (!item.audio?.publicUrl) {
              return [item.scene.sceneNumber, null] as const;
            }

            const response = await fetch(item.audio.publicUrl);
            if (!response.ok) {
              throw new Error(`分镜 ${item.scene.sceneNumber} 音频加载失败`);
            }

            const bytes = await response.arrayBuffer();
            const buffer = await audioContext.decodeAudioData(bytes.slice(0));
            return [item.scene.sceneNumber, buffer] as const;
          }),
        ),
      ]);

      const imageMap = Object.fromEntries(loadedImages) as Record<number, HTMLImageElement>;
      const audioBufferMap = Object.fromEntries(decodedAudios) as Record<number, AudioBuffer | null>;
      const recorderChunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream, {
        mimeType: exportFormat.mimeType,
        videoBitsPerSecond: 6_000_000,
      });

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recorderChunks.push(event.data);
        }
      };

      const recorderStopped = new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          resolve(new Blob(recorderChunks, { type: exportFormat.mimeType }));
        };
      });

      await audioContext.resume();
      startedAt = performance.now();

      exportScenes.forEach((item) => {
        const buffer = audioBufferMap[item.scene.sceneNumber];
        if (!buffer || !item.segment) {
          return;
        }

        const source = audioContext.createBufferSource();
        const gainNode = audioContext.createGain();
        source.buffer = buffer;
        source.connect(gainNode);
        gainNode.connect(destination);
        source.start(audioContext.currentTime + item.segment.startMs / 1000);
      });

      const renderFrame = () => {
        const elapsed = Math.min(performance.now() - startedAt, totalPlaybackDurationMs);
        const activeIndex =
          exportScenes.findIndex((item) => item.segment && elapsed >= item.segment.startMs && elapsed < item.segment.endMs) >= 0
            ? exportScenes.findIndex((item) => item.segment && elapsed >= item.segment.startMs && elapsed < item.segment.endMs)
            : Math.max(exportScenes.length - 1, 0);
        const activeItem = exportScenes[activeIndex];
        const activeSegment = activeItem?.segment;
        const activeImage = imageMap[activeItem.scene.sceneNumber];

        context.clearRect(0, 0, width, height);
        if (activeImage) {
          drawImageCover(context, activeImage, width, height, 1.015);
        } else {
          context.fillStyle = "#0d1426";
          context.fillRect(0, 0, width, height);
        }

        context.fillStyle = "rgba(9, 20, 46, 0.24)";
        context.fillRect(0, 0, width, height);
        context.fillStyle = "rgba(9, 20, 46, 0.28)";
        context.fillRect(0, height - 130, width, 130);

        const sceneProgress = activeSegment ? Math.min(Math.max((elapsed - activeSegment.startMs) / Math.max(activeSegment.durationMs, 1), 0), 1) : 0;
        const subtitle =
          activeItem.subtitles.find((segment) => sceneProgress >= segment.startRatio && sceneProgress < segment.endRatio)?.text ??
          activeItem.subtitles[activeItem.subtitles.length - 1]?.text ??
          "";
        drawSubtitleCard(context, subtitle, width, height);

        setExportProgress(totalPlaybackDurationMs > 0 ? elapsed / totalPlaybackDurationMs : 0);

        if (elapsed < totalPlaybackDurationMs) {
          animationFrameId = requestAnimationFrame(renderFrame);
        }
      };

      renderFrame();
      recorder.start(250);

      recorderStopTimer = window.setTimeout(() => {
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
      }, totalPlaybackDurationMs + 220);

      const blob = await recorderStopped;
      cancelAnimationFrame(animationFrameId);
      window.clearTimeout(recorderStopTimer);

      const formData = new FormData();
      formData.append("file", new File([blob], `${activeProjectId}.${exportFormat.extension}`, { type: exportFormat.mimeType }));

      const response = await fetch(`/api/projects/${encodeURIComponent(activeProjectId)}/export-video`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.publicUrl) {
        throw new Error(data.error ?? "视频保存失败");
      }

      const link = document.createElement("a");
      link.href = data.publicUrl;
      link.download = data.filename ?? `${activeProjectId}.${exportFormat.extension}`;
      link.click();

      setExportProgress(1);
      setExportMessage(`导出成功，已保存到 /public/${data.relativePath}`);
    } catch (error) {
      cancelAnimationFrame(animationFrameId);
      window.clearTimeout(recorderStopTimer);
      const message = error instanceof Error ? error.message : "导出视频失败";
      setExportMessage(message);
    } finally {
      stream.getTracks().forEach((track) => track.stop());
      void audioContext.close().catch(() => undefined);
      setIsExportingVideo(false);
    }
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
              <button className="export-video-button" disabled={isExportingVideo || selectedMode !== "slideshow"} onClick={() => void handleExportVideo()} type="button">
                {isExportingVideo ? <Loader2 size={17} /> : <Download size={17} />} {isExportingVideo ? "导出中" : "导出视频"}
              </button>
              <button className="solid" type="button">
                <Play size={17} fill="currentColor" /> 预览
              </button>
            </div>
          </div>

          {isExportingVideo || exportMessage ? (
            <div className="export-status-banner">
              <strong>{isExportingVideo ? `正在导出视频 ${Math.round(exportProgress * 100)}%` : "视频导出结果"}</strong>
              <span>{isExportingVideo ? "请保持当前页面打开，导出完成后会自动下载并保存到项目视频目录" : exportMessage}</span>
            </div>
          ) : null}

          <div className={`video-stage compact-stage ${activeOutlineScene ? "has-outline" : "is-empty"}`}>
            {currentOutline && activeOutlineScene ? (
              <>
                <div className="stage-visual stage-visual-outline">
                  {currentOutline.promptKind === "image" && activeSceneImage ? (
                    <div className="stage-preview-media">
                      <img
                        alt={activeOutlineScene.title}
                        className={`stage-preview-image ${isPreviewPlaying ? "playing" : ""}`}
                        key={`stage-${activeOutlineScene.sceneNumber}`}
                        src={activeSceneImage.publicUrl}
                        style={{ transform: `scale(${1 + activeScenePlaybackProgress * 0.015})` }}
                      />
                    </div>
                  ) : (
                    <div className="stage-preview-placeholder">
                      {currentOutline.promptKind === "image" ? <ImageIcon size={42} /> : <Code2 size={42} />}
                      <strong>画面预览占位区</strong>
                      <small>{currentOutline.promptKind === "image" ? "图片生成完成后会在这里展示当前分镜画面" : "后续展示 HTML 动画效果"}</small>
                    </div>
                  )}
                  <div className={`stage-subtitle ${displaySubtitleText ? "visible" : ""}`}>
                    <span>{displaySubtitleText}</span>
                  </div>
                </div>
                <div className="player-controls">
                  <Play size={18} fill="currentColor" />
                  <Volume2 size={18} />
                  <span>
                    分镜 {activeOutlineScene.sceneNumber} / {visibleScenes.length}
                  </span>
                  <span>{activeSceneAudio ? "旁白已生成" : "暂无旁白"}</span>
                  <span className="progress">
                    <i style={{ width: `${(activeOutlineScene.sceneNumber / visibleScenes.length) * 100}%` }} />
                  </span>
                </div>
                <div className="player-controls player-controls-live">
                  <button className="player-play-button" onClick={handleTogglePreviewPlayback} type="button">
                    {isPreviewPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
                  </button>
                  <Volume2 size={18} />
                  <span className="player-time">{formatDuration(currentPlaybackMs)}/{formatDuration(totalPlaybackDurationMs)}</span>
                  <span className="progress">
                    <i style={{ width: `${playbackProgressPercent}%` }} />
                  </span>
                </div>
              </>
            ) : (
              <div className="preview-empty-state">
                <div className="preview-empty-icon">{selectedMode === "slideshow" ? <ImageIcon size={36} /> : <Code2 size={36} />}</div>
                <strong>这里还没有分镜内容</strong>
                <p>先在右侧输入创作指令，生成视频大纲后，这里会自动加载分镜预览。</p>
              </div>
            )}
          </div>

          <div className="scene-header compact-scene-header">
            <strong>分镜列表</strong>
            <small>
              共 {visibleScenes.length} 个分镜{canGenerateSceneImages ? ` · 已生成 ${generatedSceneCount}/${visibleScenes.length}` : ""}
            </small>
            {canGenerateSceneImages ? <span className="scene-generation-tip">支持跳过已生成分镜</span> : null}
            {canGenerateSceneImages ? (
              <>
                <button disabled={isGeneratingSceneImages || generatedSceneCount === visibleScenes.length} onClick={() => void handleGenerateSceneImages()} type="button">
                  {isGeneratingSceneImages ? <Loader2 size={16} /> : <ImageIcon size={16} />} 一键生成
                </button>
                <button disabled={!isGeneratingSceneImages} onClick={handleStopSceneGeneration} type="button">
                  <X size={16} /> 中断生成
                </button>
              </>
            ) : null}
            <button disabled type="button">
              <Plus size={16} /> 添加分镜
            </button>
          </div>
          {sceneGenerationError ? <p className="scene-generation-error">{sceneGenerationError}</p> : null}
          <div className="scene-board">
            {visibleScenes.length > 0 ? (
              <div className="scene-strip compact-scene-strip">
                {visibleScenes.map((scene, index) => {
                  const sceneImage = sceneImageMap[scene.sceneNumber];
                  const sceneAudio = sceneAudioMap[scene.sceneNumber];
                  const isAudioPlayable = Boolean(sceneAudio);
                  const isPlaying = playingSceneNumber === scene.sceneNumber;

                  return (
                    <div
                      className={`scene-card ${selectedMode === "html" ? "violet" : "sky"} ${activeScene === index ? "active" : ""}`}
                      key={`${scene.sceneNumber}-${scene.title}`}
                      onClick={() => setActiveScene(index)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setActiveScene(index);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div className={`scene-thumb ${sceneImage ? "has-image" : ""}`}>
                        <span className="scene-number">{String(scene.sceneNumber).padStart(2, "0")}</span>
                        {sceneImage ? (
                          <img alt={scene.title} className="scene-thumb-image" src={sceneImage.publicUrl} />
                        ) : selectedMode === "html" ? (
                          <Video size={24} />
                        ) : (
                          <ImageIcon size={24} />
                        )}
                      </div>
                      <div className="scene-card-head compact">
                        <strong>{scene.title}</strong>
                        <button
                          aria-label={isAudioPlayable ? `播放${scene.title}旁白` : `${scene.title}暂无旁白`}
                          className={`scene-audio-button ${isAudioPlayable ? "enabled" : "disabled"} ${isPlaying ? "playing" : ""}`}
                          disabled={!sceneAudio}
                          onClick={(event) => {
                            if (!sceneAudio) {
                              event.stopPropagation();
                              return;
                            }

                            void handlePlaySceneAudio(sceneAudio, event);
                          }}
                          type="button"
                        >
                          <Volume2 size={14} />
                        </button>
                      </div>
                      <p className="scene-card-outline">{shortenNarration(scene.narration, 24)}</p>
                      <em className="scene-card-status">
                        {sceneImage ? "已出图" : generatingSceneNumber === scene.sceneNumber ? "生成中" : selectedMode === "html" ? "HTML" : "待出图"}
                      </em>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="scene-board-empty">
                <strong>暂无分镜</strong>
                <p>大纲生成完成后，分镜会在这里动态出现。</p>
              </div>
            )}
          </div>
        </section>

        <button aria-label="调整预览和对话面板宽度" className="panel-resizer" onMouseDown={handleResizeStart} type="button" />

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
              <button className={selectedMode === "html" ? "mode-choice active" : "mode-choice"} onClick={() => handleModeChange("html")} type="button">
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
            {currentOutline.promptKind === "image" && currentOutline.globalVisualStylePrompt ? (
              <div className="outline-modal-script">
                <strong>全局画面风格提示词</strong>
                <p>{currentOutline.globalVisualStylePrompt}</p>
              </div>
            ) : null}
            <div className="outline-scene-grid">
              {currentOutline.scenes.map((scene) => {
                const sceneImage = sceneImageMap[scene.sceneNumber];
                const sceneAudio = sceneAudioMap[scene.sceneNumber];
                const isPlaying = playingSceneNumber === scene.sceneNumber;
                const isImageRegenerating = Boolean(sceneActionLoadingMap[`image-${scene.sceneNumber}`]);
                const isAudioRegenerating = Boolean(sceneActionLoadingMap[`audio-${scene.sceneNumber}`]);

                return (
                  <article className="outline-scene-detail-card" key={`detail-${scene.sceneNumber}`}>
                    <div className="outline-scene-preview">
                      {currentOutline.promptKind === "image" && sceneImage ? (
                        <img alt={scene.title} className="outline-scene-image" src={sceneImage.publicUrl} />
                      ) : (
                        <>
                          {currentOutline.promptKind === "image" ? <ImageIcon size={28} /> : <Code2 size={28} />}
                          <span>画面预览占位</span>
                        </>
                      )}
                    </div>
                    <div className="outline-scene-actions">
                      <button
                        aria-label={sceneAudio ? `播放${scene.title}旁白` : `${scene.title}暂无旁白`}
                        className={`scene-audio-button outline-scene-audio-button ${sceneAudio ? "enabled" : "disabled"} ${isPlaying ? "playing" : ""}`}
                        disabled={!sceneAudio}
                        onClick={(event) => {
                          if (!sceneAudio) {
                            event.stopPropagation();
                            return;
                          }

                          void handlePlaySceneAudio(sceneAudio, event);
                        }}
                        type="button"
                      >
                        <Volume2 size={16} />
                      </button>
                      <button disabled={isImageRegenerating} onClick={(event) => void handleRegenerateSceneImage(scene.sceneNumber, event)} type="button">
                        {isImageRegenerating ? <Loader2 size={14} /> : <ImageIcon size={14} />} 重新生成画面
                      </button>
                      <button disabled={isAudioRegenerating} onClick={(event) => void handleRegenerateSceneAudio(scene.sceneNumber, event)} type="button">
                        {isAudioRegenerating ? <Loader2 size={14} /> : <Volume2 size={14} />} 重新生成旁白
                      </button>
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
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
      <audio ref={audioRef} preload="none" />
      <audio ref={previewAudioRef} preload="auto" />
    </main>
  );
}
