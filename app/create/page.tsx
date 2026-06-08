"use client";

import type { CSSProperties, FormEvent } from "react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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
  Palette,
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
import { DEFAULT_HTML_VIDEO_STYLE_ID, getHtmlVideoStyle, HTML_VIDEO_STYLES, HtmlVideoStyleId } from "@/app/lib/htmlVideoStyles";
import { beginHtmlMp4Recording, isHtmlMp4RecordingSupported, triggerMp4Download } from "@/app/lib/htmlVideoMp4Recorder";
import { useAuthSession } from "@/app/lib/useAuthSession";
import { getSceneAudioMap, getSceneHtmlMap, getSceneImageMap } from "@/app/lib/videoSource";

type ModeKey = "slideshow" | "html";
type ChatRole = "user" | "assistant";

type SceneOutline = {
  sceneNumber: number;
  title: string;
  narration: string;
  visualPrompt: string;
};

type SceneHtml = {
  sceneNumber: number;
  title: string;
  prompt: string;
  html: string;
  createdAt: string;
};

type VideoOutline = {
  title: string;
  summary: string;
  fullScript: string;
  mode: ModeKey;
  promptKind: "image" | "html";
  globalVisualStylePrompt?: string;
  htmlVideoStyleId?: HtmlVideoStyleId;
  htmlVideoStyleName?: string;
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
  startMs: number;
  endMs: number;
};

type AssistantPayload = {
  intent?: {
    action: string;
    reason: string;
    targetScene?: number | null;
  } | null;
  outline?: VideoOutline | null;
  confirmation?: {
    type: "regenerate_video_outline";
    originalPrompt: string;
    revisionRequest: string;
  } | null;
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

type ExportPhase = "idle" | "requesting" | "capturing" | "encoding" | "finalizing" | "downloading";

const EMPTY_SCENES: SceneOutline[] = [];

const modeCopy = {
  slideshow: {
    label: "图片轮播模式",
    prompt: "输入你的创作指令，例如：生成一条新能源产品介绍视频",
    assistant: "建议按图片轮播模式生成，我会输出完整逐字稿、图片分镜和后续可继续出图的提示词。",
  },
  html: {
    label: "HTML 动画模式",
    prompt: "输入你的创作指令，例如：生成一条数据可视化风格的储能方案动画视频",
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

function getDisplayGlobalStylePrompt(outline: VideoOutline | null) {
  if (!outline?.globalVisualStylePrompt) {
    return "";
  }

  if (outline.promptKind !== "html") {
    return outline.globalVisualStylePrompt;
  }

  return getHtmlVideoStyle(outline.htmlVideoStyleId).displayPromptZh || outline.globalVisualStylePrompt;
}

function shortenNarration(value: string, maxLength = 42) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

function renderSceneHtmlFrame(sceneHtml: SceneHtml, title: string, className: string) {
  return (
    <iframe
      aria-label={title}
      className={className}
      sandbox="allow-scripts"
      scrolling="no"
      srcDoc={sceneHtml.html}
      title={title}
    />
  );
}

function renderStylePreviewFrame(styleId: HtmlVideoStyleId, className: string) {
  const style = getHtmlVideoStyle(styleId);
  return (
    <iframe
      aria-label={`${style.nameZh} demo`}
      className={className}
      sandbox="allow-scripts"
      scrolling="no"
      srcDoc={style.demoHtml}
      title={`${style.name} demo`}
    />
  );
}

function normalizeSubtitleSentence(value: string) {
  return value.replace(/[锛屻€傦紒锛燂紱锛?.!?;:\s]+$/g, "").trim();
}

function splitNarrationIntoSubtitles(narration: string) {
  return buildSubtitleSegments(narration, resolveSubtitleTimelineDurationMs({ narration }));

  const parts = narration
    .split(/[锛屻€傦紒锛燂紱锛?.!?;\n\r]+/g)
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
      startMs: 0,
      endMs: 0,
    };
  });
}

function splitNarrationIntoSubtitleParts(narration: string) {
  return narration
    .split(/[閿涘被鈧偊绱掗敍鐕傜幢閿?.!?;\n\r]+/g)
    .map(normalizeSubtitleSentence)
    .filter(Boolean);
}

function buildSubtitleSegments(
  narration: string,
  totalDurationMs: number,
  pauseCandidatesMs?: number[],
) {
  const parts = splitNarrationIntoSubtitleParts(narration);

  if (!parts.length) {
    return [] as SubtitleSegment[];
  }

  const targetDurationMs = Math.max(1, Math.round(totalDurationMs));
  const totalCharacters = parts.reduce((sum, part) => sum + part.length, 0) || parts.length;
  const minGapMs = Math.min(160, Math.max(80, Math.round(targetDurationMs / Math.max(parts.length * 6, 10))));
  const targetBoundaries = parts.slice(0, -1).map((_, index) => {
    const consumedCharacters = parts.slice(0, index + 1).reduce((sum, part) => sum + part.length, 0);
    return (consumedCharacters / totalCharacters) * targetDurationMs;
  });
  const normalizedPauseCandidates = (pauseCandidatesMs ?? [])
    .filter((value) => Number.isFinite(value) && value > minGapMs && value < targetDurationMs - minGapMs)
    .sort((left, right) => left - right);

  const resolvedBoundaries = targetBoundaries.map((target, index) => {
    const previousBoundary = index === 0 ? 0 : targetBoundaries[index - 1];
    const remainingBoundaries = targetBoundaries.length - index - 1;
    const minAllowed = previousBoundary + minGapMs;
    const maxAllowed = targetDurationMs - minGapMs * (remainingBoundaries + 1);
    const toleranceMs = Math.max(260, Math.round(targetDurationMs * 0.12));
    const nearestPause = normalizedPauseCandidates.find(
      (candidate) => candidate >= minAllowed && candidate <= maxAllowed && Math.abs(candidate - target) <= toleranceMs,
    );

    return Math.max(minAllowed, Math.min(nearestPause ?? target, maxAllowed));
  });

  let previousEndMs = 0;

  return parts.map((part, index) => {
    const startMs = previousEndMs;
    const endMs =
      index === parts.length - 1
        ? targetDurationMs
        : Math.max(startMs + minGapMs, Math.round(resolvedBoundaries[index] ?? targetDurationMs));
    previousEndMs = endMs;

    return {
      text: part,
      startRatio: startMs / targetDurationMs,
      endRatio: endMs / targetDurationMs,
      startMs,
      endMs,
    };
  });
}

async function analyzeAudioPauseCandidates(audioUrl: string) {
  const AudioContextClass =
    typeof window === "undefined"
      ? null
      : window.AudioContext ||
        ((window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? null);

  if (!AudioContextClass) {
    return [] as number[];
  }

  const response = await fetch(audioUrl);
  if (!response.ok) {
    throw new Error(`Failed to load audio for subtitle analysis: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const audioContext = new AudioContextClass();

  try {
    const decoded = await audioContext.decodeAudioData(buffer.slice(0));
    const frameMs = 32;
    const frameSize = Math.max(256, Math.round((decoded.sampleRate * frameMs) / 1000));
    const totalFrames = Math.max(1, Math.ceil(decoded.length / frameSize));
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
    const energy: number[] = [];

    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
      const start = frameIndex * frameSize;
      const end = Math.min(start + frameSize, decoded.length);
      let sumSquares = 0;
      let sampleCount = 0;

      for (const channel of channels) {
        for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
          const sample = channel[sampleIndex] ?? 0;
          sumSquares += sample * sample;
          sampleCount += 1;
        }
      }

      energy.push(sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0);
    }

    const peakEnergy = Math.max(...energy, 0);
    const averageEnergy = energy.reduce((sum, value) => sum + value, 0) / Math.max(energy.length, 1);
    const silenceThreshold = Math.max(averageEnergy * 0.55, peakEnergy * 0.12, 0.0025);
    const minSilenceFrames = Math.max(3, Math.round(160 / frameMs));
    const durationMs = Math.round(decoded.duration * 1000);
    const pauses: number[] = [];

    let silenceStart = -1;
    for (let index = 0; index < energy.length; index += 1) {
      const isSilent = energy[index] <= silenceThreshold;
      if (isSilent && silenceStart < 0) {
        silenceStart = index;
      }

      const isLastFrame = index === energy.length - 1;
      if ((!isSilent || isLastFrame) && silenceStart >= 0) {
        const silenceEnd = !isSilent ? index - 1 : index;
        const silenceLength = silenceEnd - silenceStart + 1;
        if (silenceLength >= minSilenceFrames) {
          const midpointMs = Math.round((silenceStart + silenceLength / 2) * frameMs);
          if (midpointMs > 180 && midpointMs < durationMs - 180) {
            pauses.push(midpointMs);
          }
        }
        silenceStart = -1;
      }
    }

    return pauses;
  } finally {
    void audioContext.close().catch(() => undefined);
  }
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function buildExportFilename(title: string | undefined, fallbackId: string) {
  const base = (title || fallbackId)
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "");

  return `${base || fallbackId}.mp4`;
}

const DEFAULT_SCENE_DURATION_MS = 3000;
const HTML_PREVIEW_MIN_SCENE_DURATION_MS = 5000;
const STAGE_TRANSITION_DURATION_MS = 520;
const PREVIEW_TRANSITION_LEAD_MS = 380;

function estimateNarrationDurationMs(narration: string) {
  const trimmed = narration.trim();
  if (!trimmed) {
    return DEFAULT_SCENE_DURATION_MS;
  }

  const compactText = trimmed.replace(/\s+/g, "");
  const pauseCount = (trimmed.match(/[锛屻€傦紒锛燂紱锛?.!?;:]/g) ?? []).length;
  const estimatedMs = Math.round((compactText.length / 4.2) * 1000 + pauseCount * 180);
  return Math.max(2500, estimatedMs);
}

function resolvePreviewSceneDurationMs(input: {
  narration: string;
  audioDurationMs?: number;
  isHtmlScene: boolean;
}) {
  const narrationEstimate = estimateNarrationDurationMs(input.narration);
  const audioDuration =
    typeof input.audioDurationMs === "number" && Number.isFinite(input.audioDurationMs) && input.audioDurationMs > 0
      ? Math.round(input.audioDurationMs)
      : 0;
  const minimumDuration = input.isHtmlScene ? HTML_PREVIEW_MIN_SCENE_DURATION_MS : DEFAULT_SCENE_DURATION_MS;

  if (audioDuration > 0) {
    const transitionBufferMs = input.isHtmlScene ? 140 : 220;
    const narrationGuardMs = input.isHtmlScene ? 260 : 420;
    const cappedNarrationDuration = Math.min(narrationEstimate, audioDuration + narrationGuardMs);
    return Math.max(audioDuration + transitionBufferMs, cappedNarrationDuration);
  }

  return Math.max(narrationEstimate, minimumDuration);
}

function resolveSubtitleTimelineDurationMs(input: {
  narration: string;
  audioDurationMs?: number;
}) {
  const narrationEstimate = estimateNarrationDurationMs(input.narration);
  const audioDuration =
    typeof input.audioDurationMs === "number" && Number.isFinite(input.audioDurationMs) && input.audioDurationMs > 0
      ? Math.round(input.audioDurationMs)
      : 0;

  return Math.max(audioDuration, Math.min(narrationEstimate, DEFAULT_SCENE_DURATION_MS));
}

export default function CreatePage() {
  const { session } = useAuthSession();
  const shellRef = useRef<HTMLElement | null>(null);
  const previewStageRef = useRef<HTMLDivElement | null>(null);
  const stagePreviewMediaRef = useRef<HTMLDivElement | null>(null);
  const stageSubtitleTextRef = useRef<HTMLSpanElement | null>(null);
  const exportProgressWindowRef = useRef<Window | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const playbackSceneRef = useRef<number | null>(null);
  const playbackSceneTimeoutRef = useRef<number | null>(null);
  const playbackAnimationFrameRef = useRef<number | null>(null);
  const stageTransitionTimeoutRef = useRef<number | null>(null);
  const previousActiveSceneIndexRef = useRef<number | null>(null);
  const skipNextSceneTransitionRef = useRef(false);
  const previewPlaybackCompletionResolverRef = useRef<(() => void) | null>(null);
  const previewPlaybackCompletionArmedRef = useRef(false);
  const sceneGenerationAbortRef = useRef<AbortController | null>(null);
  const stopSceneGenerationRef = useRef(false);
  const [selectedMode, setSelectedMode] = useState<ModeKey>("slideshow");
  const [activeScene, setActiveScene] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [selectedHtmlVideoStyleId, setSelectedHtmlVideoStyleId] = useState<HtmlVideoStyleId>(DEFAULT_HTML_VIDEO_STYLE_ID);
  const [isHtmlStyleModalOpen, setIsHtmlStyleModalOpen] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState("");
  const [isDeleteSelecting, setIsDeleteSelecting] = useState(false);
  const [chatPanelWidth, setChatPanelWidth] = useState(440);
  const [isOutlineModalOpen, setIsOutlineModalOpen] = useState(false);
  const [isGeneratingSceneImages, setIsGeneratingSceneImages] = useState(false);
  const [generatingSceneNumber, setGeneratingSceneNumber] = useState<number | null>(null);
  const [sceneGenerationError, setSceneGenerationError] = useState("");
  const [playingSceneNumber, setPlayingSceneNumber] = useState<number | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [currentPlaybackMs, setCurrentPlaybackMs] = useState(0);
  const [sceneDurationMap, setSceneDurationMap] = useState<Record<number, number>>({});
  const [subtitleSegmentMap, setSubtitleSegmentMap] = useState<Record<number, SubtitleSegment[]>>({});
  const [sceneActionLoadingMap, setSceneActionLoadingMap] = useState<Record<string, boolean>>({});
  const [isExportingVideo, setIsExportingVideo] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportMessage, setExportMessage] = useState("");
  const [exportPhase, setExportPhase] = useState<ExportPhase>("idle");
  const [exportDisplayName, setExportDisplayName] = useState("");
  const [didRestoreStudioFocus, setDidRestoreStudioFocus] = useState(false);
  const [isStageTransitioning, setIsStageTransitioning] = useState(false);
  const [transitionFromSceneIndex, setTransitionFromSceneIndex] = useState<number | null>(null);
  const [stageTransitionDirection, setStageTransitionDirection] = useState<1 | -1>(1);
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);
  const [stagePreviewScale, setStagePreviewScale] = useState(1);
  const [subtitleOverlayHeight, setSubtitleOverlayHeight] = useState(0);

  const closeExportProgressWindow = () => {
    const popup = exportProgressWindowRef.current;
    if (popup && !popup.closed) {
      popup.close();
    }
    exportProgressWindowRef.current = null;
  };

  const restoreStudioWindowFocus = () => {
    if (typeof window === "undefined") {
      return;
    }

    window.focus();
    document.body?.focus?.();
    window.setTimeout(() => {
      window.focus();
    }, 120);
  };

  const getStudioReturnUrl = () => {
    const params = new URLSearchParams();
    params.set("mode", selectedMode);
    if (activeProjectId) {
      params.set("projectId", activeProjectId);
    }
    return `/create?${params.toString()}`;
  };

  const returnToStudioFromPopup = () => {
    if (typeof window === "undefined") {
      return;
    }

    const returnUrl = getStudioReturnUrl();

    try {
      if (window.location.pathname === "/create") {
        window.history.replaceState(null, "", returnUrl);
      } else {
        window.location.href = returnUrl;
        return;
      }
    } catch (error) {
      window.location.href = returnUrl;
      return;
    }

    restoreStudioWindowFocus();
  };

  const openExportProgressWindow = () => {
    if (typeof window === "undefined") {
      return null;
    }

    const existingPopup = exportProgressWindowRef.current;
    if (existingPopup && !existingPopup.closed) {
      existingPopup.focus();
      return existingPopup;
    }

    const popup = window.open("", "visionagent-export-progress", "popup=yes,width=460,height=560,left=72,top=72");
    if (!popup) {
      return null;
    }

    popup.document.documentElement.innerHTML = `
      <head>
        <meta charset="utf-8" />
        <title>导出进度</title>
        <style>
          :root { color-scheme: light; font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
          * { box-sizing: border-box; }
          html, body { margin: 0; width: 100%; min-height: 100%; background: #e9eef7; }
          body { padding: 10px; overflow: auto; }
          .card { min-height: calc(100vh - 20px); overflow: hidden; border: 1px solid rgba(124, 143, 174, 0.26); border-radius: 16px; background: linear-gradient(180deg, #111a2d 0%, #0b1222 100%); box-shadow: 0 18px 40px rgba(15, 24, 42, 0.22); }
          .windowbar { display: flex; align-items: center; justify-content: space-between; padding: 9px 13px; color: #32435f; font-size: 12px; font-weight: 700; background: linear-gradient(180deg, #f8fbff 0%, #e6edf7 100%); border-bottom: 1px solid rgba(131, 147, 177, 0.22); }
          .windowdots { display: flex; gap: 6px; }
          .windowdots i { width: 8px; height: 8px; border-radius: 999px; background: rgba(145, 160, 189, 0.72); }
          .body { display: grid; gap: 12px; padding: 16px; }
          .statusline { display: flex; align-items: center; gap: 10px; }
          .dot { width: 10px; height: 10px; border-radius: 999px; background: #ff4d6d; box-shadow: 0 0 0 5px rgba(255, 77, 109, 0.14); }
          .dot.done { background: #63e6be; box-shadow: 0 0 0 5px rgba(99, 230, 190, 0.18); }
          .badge { padding: 4px 9px; border-radius: 999px; color: #91f2b3; background: rgba(61, 145, 93, 0.16); font-size: 11px; font-weight: 700; }
          .theme { padding: 9px 11px; border-radius: 12px; color: rgba(228, 236, 251, 0.96); background: rgba(123, 146, 198, 0.14); border: 1px solid rgba(123, 146, 198, 0.16); }
          .theme strong { display: block; margin-bottom: 3px; font-size: 11px; font-weight: 700; color: rgba(188, 205, 236, 0.7); }
          .theme span { display: block; font-size: 13px; font-weight: 700; line-height: 1.35; word-break: break-word; }
          .title { color: #f7fbff; font-size: 26px; font-weight: 800; line-height: 1.08; }
          .hint { min-height: 34px; color: rgba(223, 233, 248, 0.78); font-size: 12px; line-height: 1.5; }
          .progressbar { overflow: hidden; height: 8px; border-radius: 999px; background: rgba(123, 150, 199, 0.24); }
          .progressbar i { display: block; width: 0%; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #4f7cff 0%, #62e4ff 100%); transition: width 180ms ease; }
          .meta { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
          .percent { color: #f7fbff; font-size: 34px; font-weight: 800; line-height: 1; }
          .caption { color: rgba(213, 225, 245, 0.54); font-size: 12px; line-height: 1; }
          .completion { display: flex; align-items: flex-start; gap: 12px; padding: 12px; border-radius: 16px; color: #ecfff6; background: linear-gradient(180deg, rgba(70, 155, 113, 0.2) 0%, rgba(44, 101, 77, 0.2) 100%); border: 1px solid rgba(109, 224, 166, 0.24); box-shadow: inset 0 1px 0 rgba(255,255,255,0.04); cursor: pointer; transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease; }
          .completion:hover { transform: translateY(-1px); border-color: rgba(145, 245, 193, 0.42); box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 14px 28px rgba(21, 73, 52, 0.18); }
          .completion:focus-visible { outline: 2px solid rgba(149, 241, 193, 0.72); outline-offset: 2px; }
          .check { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 999px; color: #062516; background: linear-gradient(180deg, #b4ffe0 0%, #63e6be 100%); font-size: 16px; font-weight: 900; box-shadow: 0 8px 16px rgba(99, 230, 190, 0.24); flex: 0 0 auto; }
          .completion-copy { display: grid; gap: 4px; min-width: 0; }
          .completion-kicker { color: rgba(190, 245, 220, 0.72); font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
          .completion-theme { color: #f5fff9; font-size: 13px; font-weight: 800; line-height: 1.4; word-break: break-word; }
          .completion-note { font-size: 12px; line-height: 1.45; color: rgba(235, 255, 245, 0.92); }
          .actions { position: sticky; bottom: 0; display: flex; justify-content: flex-end; gap: 8px; margin-top: 2px; padding-top: 8px; background: linear-gradient(180deg, rgba(11, 18, 34, 0) 0%, rgba(11, 18, 34, 0.82) 24%, rgba(11, 18, 34, 1) 100%); }
          .action { display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 999px; padding: 10px 14px; font-size: 13px; font-weight: 700; cursor: pointer; text-decoration: none; }
          .action.secondary { color: #d9e7ff; background: rgba(115, 139, 179, 0.18); }
          .action.primary { color: #0f1b32; background: linear-gradient(180deg, #f6fbff 0%, #cfe3ff 100%); }
          .hidden { display: none; }
          .helper { color: rgba(194, 209, 232, 0.72); font-size: 11px; line-height: 1.45; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="windowbar">
            <span>导出进度</span>
            <div class="windowdots" aria-hidden="true"><i></i><i></i><i></i></div>
          </div>
          <div class="body">
            <div class="statusline">
             <div class="dot" id="export-phase-dot"></div>
              <span class="badge">MP4 (H.264)</span>
            </div>
            <div class="theme">
              <strong>导出主题</strong>
              <span id="export-theme-name">未命名视频</span>
            </div>
            <div class="title" id="export-phase-title">等待共享</div>
            <div class="hint" id="export-phase-hint">请选择当前标签页并确认共享</div>
            <div class="progressbar" id="export-phase-progressbar"><i id="export-phase-progressfill"></i></div>
            <div class="meta">
              <div class="caption" id="export-phase-caption">录制进度</div>
              <div class="percent" id="export-phase-progress">0%</div>
            </div>
            <div class="completion hidden" id="export-completion-card" role="button" tabindex="0" aria-label="回到创作页">
              <div class="check">✓</div>
              <div class="completion-copy">
                <div class="completion-kicker">Task Complete</div>
                <div class="completion-theme" id="export-completion-theme">《未命名视频》</div>
                <div class="completion-note" id="export-completion-text">视频已完成并开始下载</div>
              </div>
            </div>
            <div class="helper">下载完成后，可直接点击上方完成卡片或底部按钮回到创作页。</div>
            <div class="actions">
              <button class="action secondary hidden" id="export-close-button" type="button">关闭小窗</button>
              <a class="action primary hidden" id="export-return-button" href="/create" target="visionagent-studio">回到创作页</a>
            </div>
          </div>
        </div>
      </body>
    `;

    exportProgressWindowRef.current = popup;
    return popup;
  };

  const syncExportProgressWindow = () => {
    const popup = exportProgressWindowRef.current;
    if (!popup || popup.closed) {
      exportProgressWindowRef.current = null;
      return;
    }

    const doc = popup.document;
    const dotNode = doc.getElementById("export-phase-dot");
    const themeNameNode = doc.getElementById("export-theme-name");
    const titleNode = doc.getElementById("export-phase-title");
    const hintNode = doc.getElementById("export-phase-hint");
    const progressBarNode = doc.getElementById("export-phase-progressbar");
    const progressFillNode = doc.getElementById("export-phase-progressfill");
    const progressNode = doc.getElementById("export-phase-progress");
    const captionNode = doc.getElementById("export-phase-caption");
    const completionCardNode = doc.getElementById("export-completion-card");
    const completionThemeNode = doc.getElementById("export-completion-theme");
    const completionTextNode = doc.getElementById("export-completion-text");
    const returnButtonNode = doc.getElementById("export-return-button");
    const closeButtonNode = doc.getElementById("export-close-button");
    if (
      !dotNode ||
      !themeNameNode ||
      !titleNode ||
      !hintNode ||
      !progressBarNode ||
      !progressFillNode ||
      !progressNode ||
      !captionNode ||
      !completionCardNode ||
      !completionThemeNode ||
      !completionTextNode ||
      !returnButtonNode ||
      !closeButtonNode
    ) {
      return;
    }

    if ("dataset" in closeButtonNode && closeButtonNode.dataset.bound !== "true") {
      closeButtonNode.dataset.bound = "true";
      closeButtonNode.addEventListener("click", () => {
        closeExportProgressWindow();
      });
    }

    if ("dataset" in completionCardNode && completionCardNode.dataset.bound !== "true") {
      completionCardNode.dataset.bound = "true";
      const focusStudio = () => {
        returnToStudioFromPopup();
      };
      completionCardNode.addEventListener("click", focusStudio);
      completionCardNode.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          focusStudio();
        }
      });
    }

    const titleText =
      exportPhase === "requesting"
        ? "等待共享"
        : exportPhase === "capturing" || exportPhase === "encoding"
          ? "正在录制"
          : exportPhase === "finalizing"
            ? "正在封装"
            : exportPhase === "downloading"
              ? "下载完成"
              : "导出视频";
    const hintText =
      exportPhase === "requesting"
        ? "请选择当前标签页并确认共享"
        : exportPhase === "capturing" || exportPhase === "encoding"
          ? `正在录制当前全屏预览内容，已完成 ${Math.round(exportProgress * 100)}%`
          : exportPhase === "finalizing"
            ? "正在整理音视频并封装 MP4 文件"
            : exportPhase === "downloading"
              ? didRestoreStudioFocus
                ? "浏览器已开始保存视频文件，并且已回到创作页"
                : "浏览器已开始保存视频文件，正在返回创作页"
              : exportMessage;

    const normalizedProgress = Math.max(0, Math.min(exportProgress || 0, 1));
    const shouldShowProgress = exportPhase !== "requesting";
    const shouldShowReturnAction = exportPhase === "downloading" || exportPhase === "idle";
    const isCompleted = exportPhase === "downloading";

    themeNameNode.textContent = exportDisplayName || "未命名视频";
    titleNode.textContent = titleText;
    hintNode.textContent = hintText;
    progressFillNode.setAttribute("style", `width: ${Math.round(normalizedProgress * 100)}%`);
    progressNode.textContent = `${Math.round(exportProgress * 100)}%`;
    progressBarNode.classList.toggle("hidden", !shouldShowProgress);
    progressNode.classList.toggle("hidden", !shouldShowProgress);
    captionNode.classList.toggle("hidden", !shouldShowProgress);
    captionNode.textContent =
      exportPhase === "finalizing"
        ? "封装进度"
        : exportPhase === "downloading"
          ? "下载状态"
          : exportPhase === "requesting"
            ? "等待操作"
            : "录制进度";
    dotNode.classList.toggle("done", isCompleted);
    completionCardNode.classList.toggle("hidden", !isCompleted);
    completionThemeNode.textContent = `《${exportDisplayName || "未命名视频"}》`;
    completionTextNode.textContent = didRestoreStudioFocus
      ? "下载任务已完成，浏览器正在保存文件，且已回到创作页。"
      : "下载任务已完成，浏览器正在保存文件，正在返回创作页。";
    returnButtonNode.classList.toggle("hidden", !shouldShowReturnAction);
    closeButtonNode.classList.toggle("hidden", !shouldShowReturnAction);
    if ("setAttribute" in returnButtonNode) {
      returnButtonNode.setAttribute("href", getStudioReturnUrl());
      returnButtonNode.setAttribute("target", "visionagent-studio");
    }
    returnButtonNode.textContent = didRestoreStudioFocus ? "再次回到创作页" : "回到创作页";
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode") === "html" ? "html" : "slideshow";
    const projectId = params.get("projectId") ?? "";
    window.name = "visionagent-studio";
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
      resolvePreviewPlaybackCompletion();
      stopSceneGenerationRef.current = true;
      sceneGenerationAbortRef.current?.abort();
      if (playbackSceneTimeoutRef.current !== null) {
        window.clearTimeout(playbackSceneTimeoutRef.current);
      }
      if (stageTransitionTimeoutRef.current !== null) {
        window.clearTimeout(stageTransitionTimeoutRef.current);
      }
      previewAudioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      msFullscreenElement?: Element | null;
    };

    const handleFullscreenChange = () => {
      const fullscreenElement =
        doc.fullscreenElement ??
        doc.webkitFullscreenElement ??
        doc.msFullscreenElement ??
        null;
      setIsPreviewFullscreen(fullscreenElement === previewStageRef.current);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange as EventListener);
    document.addEventListener("MSFullscreenChange", handleFullscreenChange as EventListener);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange as EventListener);
      document.removeEventListener("MSFullscreenChange", handleFullscreenChange as EventListener);
    };
  }, []);

  useEffect(() => {
    stopSceneGenerationRef.current = true;
    sceneGenerationAbortRef.current?.abort();
    resolvePreviewPlaybackCompletion();
    setIsGeneratingSceneImages(false);
    setGeneratingSceneNumber(null);
    setSceneGenerationError("");
    setIsPreviewPlaying(false);
    setCurrentPlaybackMs(0);
    setSceneActionLoadingMap({});
    setIsExportingVideo(false);
    setExportProgress(0);
    setExportMessage("");
    setExportPhase("idle");
    setIsStageTransitioning(false);
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
  const selectedHtmlVideoStyle = useMemo(() => getHtmlVideoStyle(selectedHtmlVideoStyleId), [selectedHtmlVideoStyleId]);
  const isHtmlOutline = currentOutline?.promptKind === "html";
  const visibleScenes = useMemo(() => currentOutline?.scenes ?? EMPTY_SCENES, [currentOutline]);
  const sceneImageMap = useMemo(() => getSceneImageMap(currentProject?.videoSource ?? ""), [currentProject?.videoSource]);
  const sceneHtmlMap = useMemo(() => getSceneHtmlMap(currentProject?.videoSource ?? ""), [currentProject?.videoSource]);
  const sceneAudioMap = useMemo(() => getSceneAudioMap(currentProject?.videoSource ?? ""), [currentProject?.videoSource]);
  const sceneTimeline = useMemo(
    () =>
      visibleScenes.map((scene, index) => {
        const durationMs =
          resolvePreviewSceneDurationMs({
            narration: scene.narration,
            audioDurationMs: sceneAudioMap[scene.sceneNumber]?.durationMs ?? sceneDurationMap[scene.sceneNumber],
            isHtmlScene: isHtmlOutline,
          });
        const startMs =
          index === 0
            ? 0
            : visibleScenes
                .slice(0, index)
                .reduce(
                  (sum, previousScene) =>
                    sum +
                    resolvePreviewSceneDurationMs({
                      narration: previousScene.narration,
                      audioDurationMs:
                        sceneAudioMap[previousScene.sceneNumber]?.durationMs ?? sceneDurationMap[previousScene.sceneNumber],
                      isHtmlScene: isHtmlOutline,
                    }),
                  0,
                );

        return {
          sceneNumber: scene.sceneNumber,
          startMs,
          endMs: startMs + durationMs,
          durationMs,
        };
      }),
    [isHtmlOutline, sceneAudioMap, sceneDurationMap, visibleScenes],
  );
  const totalPlaybackDurationMs = useMemo(
    () => sceneTimeline[sceneTimeline.length - 1]?.endMs ?? 0,
    [sceneTimeline],
  );
  const displaySceneIndex = activeScene;
  const activeOutlineScene = visibleScenes[displaySceneIndex] ?? null;
  const activeSceneImage = activeOutlineScene ? sceneImageMap[activeOutlineScene.sceneNumber] ?? null : null;
  const activeSceneHtml = activeOutlineScene ? sceneHtmlMap[activeOutlineScene.sceneNumber] ?? null : null;
  const activeSceneAudio = activeOutlineScene ? sceneAudioMap[activeOutlineScene.sceneNumber] ?? null : null;
  const transitionFromScene = transitionFromSceneIndex !== null ? visibleScenes[transitionFromSceneIndex] ?? null : null;
  const transitionFromSceneImage = transitionFromScene ? sceneImageMap[transitionFromScene.sceneNumber] ?? null : null;
  const transitionFromSceneHtml = transitionFromScene ? sceneHtmlMap[transitionFromScene.sceneNumber] ?? null : null;
  const canGenerateSceneAssets = visibleScenes.length > 0;
  const generatedSceneCount = useMemo(
    () =>
      visibleScenes.filter((scene) =>
        currentOutline?.promptKind === "html"
          ? Boolean(sceneHtmlMap[scene.sceneNumber] && sceneAudioMap[scene.sceneNumber])
          : Boolean(sceneImageMap[scene.sceneNumber] && sceneAudioMap[scene.sceneNumber]),
      ).length,
    [currentOutline?.promptKind, sceneAudioMap, sceneHtmlMap, sceneImageMap, visibleScenes],
  );
  const latestMessageId = messages[messages.length - 1]?.id ?? "";
  const activePlaybackSegment = sceneTimeline[displaySceneIndex] ?? null;
  const activeSubtitleTimelineDurationMs = activeOutlineScene
    ? resolveSubtitleTimelineDurationMs({
        narration: activeOutlineScene.narration,
        audioDurationMs: activeSceneAudio?.durationMs ?? sceneDurationMap[activeOutlineScene.sceneNumber],
      })
    : 0;
  const activeScenePlaybackProgress =
    isPreviewPlaying && activePlaybackSegment
      ? Math.min(
          Math.max((currentPlaybackMs - activePlaybackSegment.startMs) / Math.max(activePlaybackSegment.durationMs, 1), 0),
          1,
        )
      : 0;
  const activeSubtitleElapsedMs =
    isPreviewPlaying && activePlaybackSegment
      ? Math.min(
          Math.max(currentPlaybackMs - activePlaybackSegment.startMs, 0),
          Math.max(activeSubtitleTimelineDurationMs, 0),
        )
      : 0;
  const playbackProgressPercent = totalPlaybackDurationMs > 0 ? Math.min((currentPlaybackMs / totalPlaybackDurationMs) * 100, 100) : 0;
  const activeSubtitleSegments = useMemo(
    () =>
      activeOutlineScene
        ? subtitleSegmentMap[activeOutlineScene.sceneNumber] ??
          buildSubtitleSegments(activeOutlineScene.narration, activeSubtitleTimelineDurationMs)
        : [],
    [activeOutlineScene, activeSubtitleTimelineDurationMs, subtitleSegmentMap],
  );
  const activeSubtitleText = useMemo(() => {
    if (!activeSubtitleSegments.length) {
      return "";
    }

    const matchedSegment =
      activeSubtitleSegments.find(
        (segment) => activeSubtitleElapsedMs >= segment.startMs && activeSubtitleElapsedMs < segment.endMs,
      ) ?? activeSubtitleSegments[activeSubtitleSegments.length - 1];

    return matchedSegment?.text ?? "";
  }, [activeSubtitleElapsedMs, activeSubtitleSegments]);
  const displaySubtitleText = activeSubtitleText || activeSubtitleSegments[0]?.text || "";
  const shouldRenderStageSubtitle = currentOutline?.promptKind !== "html" && Boolean(displaySubtitleText);
  const currentUsername = session?.username?.trim() || "当前用户";
  const currentUserInitial = currentUsername.slice(0, 1).toUpperCase();
  const activeSceneElapsedMs = activePlaybackSegment ? Math.max(currentPlaybackMs - activePlaybackSegment.startMs, 0) : 0;
  const activeSceneRemainingMs = activePlaybackSegment ? Math.max(activePlaybackSegment.durationMs - activeSceneElapsedMs, 0) : 0;
  const autoTransitionLeadMs = activePlaybackSegment
    ? Math.max(220, Math.min(PREVIEW_TRANSITION_LEAD_MS, Math.round(activePlaybackSegment.durationMs * 0.18)))
    : PREVIEW_TRANSITION_LEAD_MS;
  const isAutoStageTransitioning =
    isPreviewPlaying &&
    Boolean(activePlaybackSegment) &&
    activeScene < visibleScenes.length - 1 &&
    activeSceneRemainingMs <= autoTransitionLeadMs;
  const autoStageTransitionProgress = isAutoStageTransitioning
    ? Math.min(Math.max(1 - activeSceneRemainingMs / Math.max(autoTransitionLeadMs, 1), 0), 1)
    : 0;
  const autoTransitionScene = isAutoStageTransitioning ? visibleScenes[activeScene + 1] ?? null : null;
  const autoTransitionSceneImage = autoTransitionScene ? sceneImageMap[autoTransitionScene.sceneNumber] ?? null : null;
  const autoTransitionSceneHtml = autoTransitionScene ? sceneHtmlMap[autoTransitionScene.sceneNumber] ?? null : null;
  const effectiveStageTransitioning = isStageTransitioning;
  const effectiveTransitionDirection: 1 | -1 = stageTransitionDirection;
  const useLiveStageTransition = Boolean(isAutoStageTransitioning && autoTransitionScene && activeOutlineScene);

  useEffect(() => {
    if (!isExportingVideo || currentOutline?.promptKind !== "html" || !totalPlaybackDurationMs || !isPreviewPlaying) {
      return;
    }

    setExportProgress((current) => Math.max(current, Math.min(currentPlaybackMs / totalPlaybackDurationMs, 0.94)));
  }, [currentOutline?.promptKind, currentPlaybackMs, isExportingVideo, isPreviewPlaying, totalPlaybackDurationMs]);

  useEffect(() => {
    if (!isExportingVideo) {
      return;
    }

    if (exportPhase === "downloading" || exportPhase === "requesting") {
      return;
    }

    if (exportProgress >= 0.96) {
      setExportPhase("finalizing");
      return;
    }

    if (exportProgress >= 0.14) {
      setExportPhase("encoding");
      return;
    }

    if (exportProgress > 0) {
      setExportPhase("capturing");
    }
  }, [exportPhase, exportProgress, isExportingVideo]);

  useEffect(() => {
    if (!isExportingVideo && !exportMessage) {
      closeExportProgressWindow();
      return;
    }

    syncExportProgressWindow();
  }, [exportMessage, exportPhase, exportProgress, isExportingVideo]);

  useEffect(() => {
    return () => {
      closeExportProgressWindow();
    };
  }, []);

  useEffect(() => {
    const subtitleNode = stageSubtitleTextRef.current;
    if (!subtitleNode || !shouldRenderStageSubtitle) {
      setSubtitleOverlayHeight(0);
      return;
    }

    const updateHeight = () => {
      setSubtitleOverlayHeight(subtitleNode.getBoundingClientRect().height);
    };

    updateHeight();

    const observer = new ResizeObserver(() => {
      updateHeight();
    });
    observer.observe(subtitleNode);
    window.addEventListener("resize", updateHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [isPreviewFullscreen, shouldRenderStageSubtitle]);

  useEffect(() => {
    const container = stagePreviewMediaRef.current;
    if (!container) return;

    const baseWidth = 1280;
    const baseHeight = 720;

    const updateScale = () => {
      const { width, height } = container.getBoundingClientRect();
      if (!width || !height) return;
      const subtitleReserve = shouldRenderStageSubtitle && !isPreviewFullscreen ? Math.min(subtitleOverlayHeight + 28, height * 0.26) : 0;
      const availableHeight = Math.max(height - subtitleReserve, height * 0.6);
      setStagePreviewScale(Math.min(width / baseWidth, availableHeight / baseHeight));
    };

    updateScale();

    const observer = new ResizeObserver(() => {
      updateScale();
    });
    observer.observe(container);
    window.addEventListener("resize", updateScale);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateScale);
    };
  }, [activeProjectId, activeScene, isPreviewFullscreen, selectedMode, shouldRenderStageSubtitle, subtitleOverlayHeight]);

  useEffect(() => {
    if (currentProject?.type) {
      setSelectedMode(currentProject.type);
    }
  }, [currentProject?.type]);

  useEffect(() => {
    if (currentOutline?.promptKind === "html") {
      setSelectedHtmlVideoStyleId(getHtmlVideoStyle(currentOutline.htmlVideoStyleId).id);
      return;
    }

    if (currentProject?.type !== "html") {
      setSelectedHtmlVideoStyleId(DEFAULT_HTML_VIDEO_STYLE_ID);
      setIsHtmlStyleModalOpen(false);
    }
  }, [currentOutline?.htmlVideoStyleId, currentOutline?.promptKind, currentProject?.type]);

  useEffect(() => {
    if (!isPreviewPlaying || !activeOutlineScene) {
      previousActiveSceneIndexRef.current = activeOutlineScene ? activeScene : null;
      setTransitionFromSceneIndex(null);
      setIsStageTransitioning(false);
      return;
    }

    if (skipNextSceneTransitionRef.current) {
      skipNextSceneTransitionRef.current = false;
      previousActiveSceneIndexRef.current = activeScene;
      setTransitionFromSceneIndex(null);
      setIsStageTransitioning(false);
      return;
    }

    const previousSceneIndex = previousActiveSceneIndexRef.current;
    previousActiveSceneIndexRef.current = activeScene;

    if (previousSceneIndex === null || previousSceneIndex === activeScene) {
      setTransitionFromSceneIndex(null);
      setIsStageTransitioning(false);
      return;
    }

    setStageTransitionDirection(previousSceneIndex < activeScene ? 1 : -1);
    setTransitionFromSceneIndex(previousSceneIndex);
    setIsStageTransitioning(true);
    if (stageTransitionTimeoutRef.current !== null) {
      window.clearTimeout(stageTransitionTimeoutRef.current);
    }

    stageTransitionTimeoutRef.current = window.setTimeout(() => {
      setIsStageTransitioning(false);
      setTransitionFromSceneIndex(null);
      stageTransitionTimeoutRef.current = null;
    }, STAGE_TRANSITION_DURATION_MS);
  }, [activeOutlineScene, activeScene, isPreviewPlaying]);

  useEffect(() => {
    if (activeScene > Math.max(visibleScenes.length - 1, 0)) {
      setActiveScene(0);
    }
  }, [activeScene, visibleScenes.length]);

  useEffect(() => {
    if (!visibleScenes.length) {
      setSceneDurationMap((current) => (Object.keys(current).length ? {} : current));
      return;
    }

    let ignore = false;
    const nextDurations: Record<number, number> = {};
    const tasks = visibleScenes.map((scene) => {
      const storedDuration = sceneAudioMap[scene.sceneNumber]?.durationMs;
      if (typeof storedDuration === "number" && storedDuration > 0) {
        nextDurations[scene.sceneNumber] = resolvePreviewSceneDurationMs({
          narration: scene.narration,
          audioDurationMs: storedDuration,
          isHtmlScene: isHtmlOutline,
        });
        return Promise.resolve();
      }

      const sceneAudio = sceneAudioMap[scene.sceneNumber];
      if (!sceneAudio?.publicUrl) {
        nextDurations[scene.sceneNumber] = resolvePreviewSceneDurationMs({
          narration: scene.narration,
          isHtmlScene: isHtmlOutline,
        });
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
          const durationMs = resolvePreviewSceneDurationMs({
            narration: scene.narration,
            audioDurationMs: Number.isFinite(probe.duration) && probe.duration > 0 ? Math.round(probe.duration * 1000) : undefined,
            isHtmlScene: isHtmlOutline,
          });
          finalize(durationMs);
        };
        probe.onerror = () =>
          finalize(
            resolvePreviewSceneDurationMs({
              narration: scene.narration,
              isHtmlScene: isHtmlOutline,
            }),
          );
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
  }, [isHtmlOutline, sceneAudioMap, visibleScenes]);

  useEffect(() => {
    if (!visibleScenes.length) {
      setSubtitleSegmentMap((current) => (Object.keys(current).length ? {} : current));
      return;
    }

    let ignore = false;

    void Promise.all(
      visibleScenes.map(async (scene) => {
        const sceneAudio = sceneAudioMap[scene.sceneNumber];
        const subtitleDurationMs = resolveSubtitleTimelineDurationMs({
          narration: scene.narration,
          audioDurationMs: sceneAudio?.durationMs ?? sceneDurationMap[scene.sceneNumber],
        });
        const fallbackSegments = buildSubtitleSegments(scene.narration, subtitleDurationMs);

        if (!sceneAudio?.publicUrl) {
          return [scene.sceneNumber, fallbackSegments] as const;
        }

        try {
          const pauseCandidatesMs = await analyzeAudioPauseCandidates(sceneAudio.publicUrl);
          return [scene.sceneNumber, buildSubtitleSegments(scene.narration, subtitleDurationMs, pauseCandidatesMs)] as const;
        } catch {
          return [scene.sceneNumber, fallbackSegments] as const;
        }
      }),
    ).then((entries) => {
      if (ignore) {
        return;
      }

      setSubtitleSegmentMap(Object.fromEntries(entries) as Record<number, SubtitleSegment[]>);
    });

    return () => {
      ignore = true;
    };
  }, [sceneAudioMap, sceneDurationMap, visibleScenes]);

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
      if (playbackAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(playbackAnimationFrameRef.current);
        playbackAnimationFrameRef.current = null;
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
    if (playbackAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(playbackAnimationFrameRef.current);
      playbackAnimationFrameRef.current = null;
    }

    setCurrentPlaybackMs(activeSegment.startMs);

    const advanceToNextScene = () => {
      if (playbackSceneTimeoutRef.current !== null) {
        window.clearTimeout(playbackSceneTimeoutRef.current);
        playbackSceneTimeoutRef.current = null;
      }

      const nextSceneIndex = activeScene + 1;
      if (nextSceneIndex < visibleScenes.length) {
        skipNextSceneTransitionRef.current = isAutoStageTransitioning;
        setActiveScene(nextSceneIndex);
        return;
      }

      stopPreviewPlayback();
      setCurrentPlaybackMs(totalPlaybackDurationMs);
      setActiveScene(Math.max(visibleScenes.length - 1, 0));
    };

    const finishSceneAfter = (elapsedWithinSceneMs: number) => {
      const remainingMs = Math.max(activeSegment.durationMs - elapsedWithinSceneMs, 0);
      if (remainingMs <= 40) {
        setCurrentPlaybackMs(activeSegment.endMs);
        advanceToNextScene();
        return;
      }

      playbackSceneTimeoutRef.current = window.setTimeout(() => {
        setCurrentPlaybackMs(activeSegment.endMs);
        advanceToNextScene();
      }, remainingMs);
    };

    if (!previewAudio || !sceneAudio?.publicUrl) {
      if (previewAudio) {
        previewAudio.pause();
        previewAudio.removeAttribute("src");
        previewAudio.load();
      }
      const scenePlaybackStartAt = performance.now();
      const updatePlaybackFrame = () => {
        const elapsedWithinSceneMs = Math.min(performance.now() - scenePlaybackStartAt, activeSegment.durationMs);
        setCurrentPlaybackMs(Math.min(activeSegment.startMs + elapsedWithinSceneMs, totalPlaybackDurationMs));

        if (elapsedWithinSceneMs >= activeSegment.durationMs - 16) {
          playbackAnimationFrameRef.current = null;
          advanceToNextScene();
          return;
        }

        playbackAnimationFrameRef.current = window.requestAnimationFrame(updatePlaybackFrame);
      };

      playbackAnimationFrameRef.current = window.requestAnimationFrame(updatePlaybackFrame);
      return;
    }

    previewAudio.pause();
    previewAudio.src = sceneAudio.publicUrl;
    previewAudio.currentTime = 0;
    previewAudio.onloadedmetadata = () => {
      const actualDurationMs = resolvePreviewSceneDurationMs({
        narration: activeOutlineScene.narration,
        audioDurationMs:
          Number.isFinite(previewAudio.duration) && previewAudio.duration > 0 ? Math.round(previewAudio.duration * 1000) : undefined,
        isHtmlScene: isHtmlOutline,
      });
      setSceneDurationMap((current) => ({
        ...current,
        [activeOutlineScene.sceneNumber]: Math.max(current[activeOutlineScene.sceneNumber] ?? 0, actualDurationMs),
      }));
    };
    previewAudio.ontimeupdate = () => {
      setCurrentPlaybackMs(Math.min(activeSegment.startMs + previewAudio.currentTime * 1000, totalPlaybackDurationMs));
    };
    previewAudio.onended = () => {
      finishSceneAfter(Math.round(previewAudio.currentTime * 1000));
    };
    previewAudio.onerror = () => {
      finishSceneAfter(Math.round(previewAudio.currentTime * 1000));
    };
    void previewAudio.play().catch((error) => {
      console.error("播放视频分镜音频失败", error);
      stopPreviewPlayback();
    });
  }, [activeOutlineScene, activeScene, isAutoStageTransitioning, isHtmlOutline, isPreviewPlaying, sceneAudioMap, sceneTimeline, totalPlaybackDurationMs, visibleScenes.length]);

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
    if (mode !== "html") {
      setIsHtmlStyleModalOpen(false);
    }
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
    if (playbackAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(playbackAnimationFrameRef.current);
      playbackAnimationFrameRef.current = null;
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
    resolvePreviewPlaybackCompletion();

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

  function waitForPreviewPlaybackCompletion() {
    previewPlaybackCompletionArmedRef.current = true;

    return new Promise<void>((resolve) => {
      previewPlaybackCompletionResolverRef.current = resolve;
    });
  }

  function resolvePreviewPlaybackCompletion() {
    if (!previewPlaybackCompletionArmedRef.current || !previewPlaybackCompletionResolverRef.current) {
      previewPlaybackCompletionArmedRef.current = false;
      previewPlaybackCompletionResolverRef.current = null;
      return;
    }

    const resolve = previewPlaybackCompletionResolverRef.current;
    previewPlaybackCompletionResolverRef.current = null;
    previewPlaybackCompletionArmedRef.current = false;
    resolve();
  }

  function handleTogglePreviewPlayback() {
    if (isPreviewPlaying) {
      stopPreviewPlayback();
      return;
    }

    startPreviewPlayback();
  }

  async function handleTogglePreviewFullscreen() {
    const stage = previewStageRef.current;
    if (!stage) return;

    try {
      const doc = document as Document & {
        webkitExitFullscreen?: () => Promise<void> | void;
        msExitFullscreen?: () => Promise<void> | void;
        webkitFullscreenElement?: Element | null;
        msFullscreenElement?: Element | null;
      };
      const stageWithFullscreen = stage as HTMLDivElement & {
        webkitRequestFullscreen?: () => Promise<void> | void;
        msRequestFullscreen?: () => Promise<void> | void;
      };
      const fullscreenElement =
        doc.fullscreenElement ??
        doc.webkitFullscreenElement ??
        doc.msFullscreenElement ??
        null;

      if (fullscreenElement === stage) {
        if (doc.exitFullscreen) {
          await doc.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        } else if (doc.msExitFullscreen) {
          await doc.msExitFullscreen();
        }
      } else {
        if (stage.requestFullscreen) {
          await stage.requestFullscreen({ navigationUI: "hide" });
        } else if (stageWithFullscreen.webkitRequestFullscreen) {
          await stageWithFullscreen.webkitRequestFullscreen();
        } else if (stageWithFullscreen.msRequestFullscreen) {
          await stageWithFullscreen.msRequestFullscreen();
        } else {
          setIsPreviewFullscreen(true);
        }
      }
    } catch (error) {
      console.error("切换预览全屏失败", error);
    }
  }

  async function enterPreviewFullscreen() {
    if (isPreviewFullscreen) {
      return;
    }

    await handleTogglePreviewFullscreen();
  }

  async function exitPreviewFullscreen() {
    if (!isPreviewFullscreen) {
      return;
    }

    await handleTogglePreviewFullscreen();
  }

  function renderStagePreviewLayer(
    scene: SceneOutline,
    options: {
      image?: typeof activeSceneImage;
      html?: typeof activeSceneHtml;
      isActiveLayer: boolean;
      isExitingLayer?: boolean;
      layerStyle?: CSSProperties;
    },
  ) {
    const layerClassName = [
      "stage-preview-layer",
      options.isActiveLayer ? "is-active" : null,
      options.isExitingLayer ? "is-exiting" : "is-entering",
      effectiveStageTransitioning ? "is-transitioning" : null,
    ]
      .filter(Boolean)
      .join(" ");
    const transitionStyle = {
      "--stage-shift-x": `${effectiveTransitionDirection * 84}px`,
      "--stage-shift-x-exit": `${effectiveTransitionDirection * -64}px`,
      "--stage-shift-y": "0px",
      "--stage-shift-y-exit": "0px",
    } as CSSProperties & Record<"--stage-shift-x" | "--stage-shift-x-exit" | "--stage-shift-y" | "--stage-shift-y-exit", string>;

    const subtitleLiftOffset = shouldRenderStageSubtitle && !isPreviewFullscreen ? Math.min(subtitleOverlayHeight * 0.32, 28) : 0;

    if (currentOutline?.promptKind === "image" && options.image) {
      const motionScale = options.isActiveLayer && isPreviewPlaying ? 1 + activeScenePlaybackProgress * 0.015 : 1;
      const subtitleAwareScale = motionScale + subtitleLiftOffset / 420;
      return (
        <div className={layerClassName} key={`stage-layer-image-${scene.sceneNumber}`} style={{ ...transitionStyle, ...options.layerStyle }}>
          <img
            alt={scene.title}
            className={`stage-preview-image ${options.isActiveLayer && isPreviewPlaying ? "playing" : ""}`}
            src={options.image.publicUrl}
            style={{ transform: `translateY(-${subtitleLiftOffset}px) scale(${subtitleAwareScale})` }}
          />
        </div>
      );
    }

    if (currentOutline?.promptKind === "html" && options.html) {
      const scaledWidth = 1280 * stagePreviewScale;
      const scaledHeight = 720 * stagePreviewScale;
      const viewportOffset = shouldRenderStageSubtitle && !isPreviewFullscreen ? Math.min(subtitleOverlayHeight * 0.22, 18) : 0;

      return (
        <div className={`${layerClassName} stage-preview-html`} key={`stage-layer-html-${scene.sceneNumber}`} style={{ ...transitionStyle, ...options.layerStyle }}>
          <div
            className="stage-preview-html-viewport"
            style={{
              width: `${scaledWidth}px`,
              height: `${scaledHeight}px`,
              transform: `translateY(-${viewportOffset}px)`,
            }}
          >
            <div
              className="stage-preview-html-canvas"
              style={{
                width: "1280px",
                height: "720px",
                transform: `scale(${stagePreviewScale})`,
              }}
            >
              {renderSceneHtmlFrame(options.html, scene.title, "stage-preview-iframe")}
            </div>
          </div>
        </div>
      );
    }

    return null;
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
      regenerateHtml?: boolean;
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
          regenerateHtml: options?.regenerateHtml ?? false,
          regenerateAudio: options?.regenerateAudio ?? false,
          htmlVideoStyleId: isHtmlOutline ? selectedHtmlVideoStyleId : undefined,
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

  async function handleGenerateSceneAssets() {
    if (!activeProjectId || !canGenerateSceneAssets || isGeneratingSceneImages) return;

    const completedScenes = new Set(
      visibleScenes
        .filter((scene) =>
          isHtmlOutline
            ? Boolean(sceneHtmlMap[scene.sceneNumber] && sceneAudioMap[scene.sceneNumber])
            : Boolean(sceneImageMap[scene.sceneNumber] && sceneAudioMap[scene.sceneNumber])
        )
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
            body: JSON.stringify({
              sceneNumber: scene.sceneNumber,
              htmlVideoStyleId: isHtmlOutline ? selectedHtmlVideoStyleId : undefined,
            }),
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

  async function handleRegenerateSceneVisual(sceneNumber: number, event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    setSceneGenerationError("");

    try {
      await requestSceneMediaGeneration(sceneNumber, {
        regenerateImage: !isHtmlOutline,
        regenerateHtml: isHtmlOutline,
        actionKey: `${isHtmlOutline ? "html" : "image"}-${sceneNumber}`,
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

  async function handleExportPreviewVideo() {
    if (!activeProjectId || !currentOutline || !visibleScenes.length || isExportingVideo) {
      return;
    }

    const exportFilename = buildExportFilename(currentOutline.title, activeProjectId);

    if (!isHtmlMp4RecordingSupported()) {
      setExportMessage("当前浏览器不支持共享当前标签页并导出 H.264 MP4");
      return;
    }

    if (currentOutline.promptKind === "image" && visibleScenes.some((scene) => !sceneImageMap[scene.sceneNumber])) {
      setExportMessage("请先为所有分镜生成图片后再导出");
      return;
    }

    if (currentOutline.promptKind === "html" && visibleScenes.some((scene) => !sceneHtmlMap[scene.sceneNumber])) {
      setExportMessage("请先为所有分镜生成 HTML 画面后再导出");
      return;
    }

    stopPreviewPlayback(true);
    audioRef.current?.pause();
    setPlayingSceneNumber(null);
    setExportDisplayName(currentOutline.title?.trim() || exportFilename.replace(/\.mp4$/i, ""));
    setDidRestoreStudioFocus(false);
    setExportMessage("");
    setExportProgress(0);
    setExportPhase("requesting");
    setIsExportingVideo(true);
    openExportProgressWindow();

    let recording: Awaited<ReturnType<typeof beginHtmlMp4Recording>> | null = null;
    let didStartDownload = false;

    try {
      recording = await beginHtmlMp4Recording({
        filename: exportFilename,
        onStatusChange: (status) => {
          if (status === "requesting-capture") {
            setExportMessage("请选择当前标签页并确认共享，随后会自动全屏播放并开始录制");
          } else if (status === "capturing") {
            setExportMessage("共享成功，正在准备全屏录制");
            setExportProgress(0.08);
          } else if (status === "encoding") {
            setExportMessage("已开始录屏，正在编码 H.264 MP4");
            setExportProgress(0.14);
          } else if (status === "finalizing") {
            setExportMessage("录屏完成，正在封装 MP4 文件");
            setExportProgress(0.96);
          }
        },
      });

      await enterPreviewFullscreen();
      await new Promise((resolve) => window.setTimeout(resolve, 220));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      recording.start();
      const playbackDone = waitForPreviewPlaybackCompletion();
      startPreviewPlayback();

      const outcome = await Promise.race([
        playbackDone.then(() => ({ type: "playback-complete" as const })),
        recording.completion.then((result) => ({ type: "capture-ended" as const, result })),
      ]);

      const result =
        outcome.type === "playback-complete"
          ? await recording.stop()
          : outcome.result;

      if (outcome.type === "capture-ended") {
        stopPreviewPlayback();
      }

      setExportProgress(1);
      setExportPhase("downloading");
      triggerMp4Download(result);
      didStartDownload = true;
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      setExportMessage(`视频导出完成，已开始下载：${exportFilename}`);
    } catch (error) {
      stopPreviewPlayback();
      if (recording) {
        await recording.stop().catch(() => undefined);
      }
      const message =
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "你已取消共享当前标签页，视频导出已终止"
          : error instanceof Error
            ? error.message
            : "视频导出失败";
      setExportMessage(message);
    } finally {
        await exitPreviewFullscreen();
        restoreStudioWindowFocus();
        setDidRestoreStudioFocus(didStartDownload);
        setIsExportingVideo(false);
        setExportPhase(didStartDownload ? "downloading" : "idle");
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
        body: JSON.stringify({
          projectId: activeProjectId,
          content,
          mode: selectedMode,
          htmlVideoStyleId: selectedMode === "html" ? selectedHtmlVideoStyleId : undefined,
        }),
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

  async function handleConfirmOutlineRegeneration(message: ChatMessage) {
    if (!activeProjectId || isSending) return;

    setIsSending(true);

    try {
      const response = await fetch("/api/video-agent/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: activeProjectId,
          mode: selectedMode,
          htmlVideoStyleId: selectedMode === "html" ? selectedHtmlVideoStyleId : undefined,
          confirmationMessageId: message.id,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "确认重新生成失败");
      }

      if (data.project?.uuid) {
        syncProject(data.project);
      }

      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setActiveScene(0);
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "确认重新生成失败";
      setMessages((current) => [
        ...current,
        {
          id: `error-${Date.now()}`,
          projectId: activeProjectId,
          role: "assistant",
          content: `处理失败：${nextMessage}`,
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
          {session ? (
            <div className="studio-user-chip" title={currentUsername}>
              <span>{currentUserInitial}</span>
              <strong>{currentUsername}</strong>
            </div>
          ) : null}
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
                <span className="mini-button-label">{isDeleteSelecting ? "取消删除" : "删除项目"}</span>
              </button>
              <button className="mini-button" disabled={isCreatingProject} onClick={() => void handleCreateProject()} type="button">
                {isCreatingProject ? <Loader2 size={16} /> : <Plus size={16} />}
                <span className="mini-button-label">新建项目</span>
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
              <button onClick={() => void handleTogglePreviewFullscreen()} type="button">
                <Expand size={17} /> 全屏
              </button>
              <button className="export-video-button" disabled={isExportingVideo || !visibleScenes.length} onClick={() => void handleExportPreviewVideo()} type="button">
                {isExportingVideo ? <Loader2 size={17} /> : <Download size={17} />} {isExportingVideo ? "导出中" : "导出视频"}
              </button>
              <button className="solid" onClick={handleTogglePreviewPlayback} type="button">
                <Play size={17} fill="currentColor" /> 预览
              </button>
            </div>
          </div>

          {!isExportingVideo && exportMessage ? (
            <div className="export-status-banner">
              <strong>视频导出结果</strong>
              <span>{exportMessage}</span>
            </div>
          ) : null}

          <div
            className={`video-stage compact-stage ${activeOutlineScene ? "has-outline" : "is-empty"} ${isPreviewFullscreen ? "is-fullscreen" : ""}`}
            ref={previewStageRef}
          >
            {currentOutline && activeOutlineScene ? (
              <>
                <div className="stage-visual stage-visual-outline">
                  {(currentOutline.promptKind === "image" && activeSceneImage) || (currentOutline.promptKind === "html" && activeSceneHtml) ? (
                    <div className="stage-preview-media" ref={stagePreviewMediaRef}>
                      {useLiveStageTransition
                        ? renderStagePreviewLayer(activeOutlineScene, {
                            image: activeSceneImage,
                            html: activeSceneHtml,
                            isActiveLayer: false,
                            isExitingLayer: true,
                            layerStyle: {
                              opacity: 1 - autoStageTransitionProgress * 0.58,
                              transform: `translate3d(${-72 * autoStageTransitionProgress}px, 0, 0) scale(${1 - autoStageTransitionProgress * 0.035})`,
                            },
                          })
                        : transitionFromScene &&
                            isStageTransitioning &&
                            ((currentOutline.promptKind === "image" && transitionFromSceneImage) ||
                              (currentOutline.promptKind === "html" && transitionFromSceneHtml))
                          ? renderStagePreviewLayer(transitionFromScene, {
                              image: transitionFromSceneImage,
                              html: transitionFromSceneHtml,
                              isActiveLayer: false,
                              isExitingLayer: true,
                            })
                          : null}
                      {useLiveStageTransition
                        ? renderStagePreviewLayer(autoTransitionScene ?? activeOutlineScene, {
                            image: autoTransitionSceneImage,
                            html: autoTransitionSceneHtml,
                            isActiveLayer: true,
                            layerStyle: {
                              opacity: 0.42 + autoStageTransitionProgress * 0.58,
                              transform: `translate3d(${42 * (1 - autoStageTransitionProgress)}px, 0, 0) scale(${0.982 + autoStageTransitionProgress * 0.018})`,
                            },
                          })
                        : renderStagePreviewLayer(activeOutlineScene, {
                            image: activeSceneImage,
                            html: activeSceneHtml,
                            isActiveLayer: true,
                          })}
                    </div>
                  ) : (
                    <div className="stage-preview-placeholder">
                      {currentOutline.promptKind === "image" ? <ImageIcon size={42} /> : <Code2 size={42} />}
                      <strong>画面预览占位区</strong>
                      <small>{currentOutline.promptKind === "image" ? "图片生成完成后会在这里展示当前分镜画面" : "后续展示 HTML 动画效果"}</small>
                    </div>
                  )}
                  {shouldRenderStageSubtitle ? (
                    <div className={`stage-subtitle ${displaySubtitleText ? "visible" : ""}`}>
                      <span ref={stageSubtitleTextRef}>{displaySubtitleText}</span>
                    </div>
                  ) : null}
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
                {!isExportingVideo ? (
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
                ) : null}
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
            <div className="scene-header-main">
              <div className="scene-header-copy">
                <strong>分镜列表</strong>
                <small>
                  共 {visibleScenes.length} 个分镜
                  {canGenerateSceneAssets ? ` · 已生成 ${generatedSceneCount}/${visibleScenes.length}` : ""}
                </small>
              </div>
              <div className="scene-header-actions">
                {canGenerateSceneAssets ? <span className="scene-generation-tip">支持跳过已生成分镜</span> : null}
                <div className="scene-action-group">
                  {canGenerateSceneAssets ? (
                    <>
                      <button
                        className="scene-toolbar-button primary"
                        disabled={isGeneratingSceneImages || generatedSceneCount === visibleScenes.length}
                        onClick={() => void handleGenerateSceneAssets()}
                        type="button"
                      >
                        {isGeneratingSceneImages ? <Loader2 size={16} /> : <ImageIcon size={16} />} 一键生成
                      </button>
                      <button className="scene-toolbar-button" disabled={!isGeneratingSceneImages} onClick={handleStopSceneGeneration} type="button">
                        <X size={16} /> 中断生成
                      </button>
                    </>
                  ) : null}
                  <button className="scene-toolbar-button add-scene" disabled type="button">
                    <Plus size={16} /> 添加分镜
                  </button>
                </div>
              </div>
            </div>
          </div>
          {sceneGenerationError ? <p className="scene-generation-error">{sceneGenerationError}</p> : null}
          <div className="scene-board">
            {visibleScenes.length > 0 ? (
              <div className="scene-strip compact-scene-strip">
                {visibleScenes.map((scene, index) => {
                  const sceneImage = sceneImageMap[scene.sceneNumber];
                  const sceneHtml = sceneHtmlMap[scene.sceneNumber];
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
                      <div className={`scene-thumb ${sceneImage || sceneHtml ? "has-image" : ""}`}>
                        <span className="scene-number">{String(scene.sceneNumber).padStart(2, "0")}</span>
                        {sceneImage ? (
                          <img alt={scene.title} className="scene-thumb-image" src={sceneImage.publicUrl} />
                        ) : sceneHtml ? (
                          renderSceneHtmlFrame(sceneHtml, scene.title, "scene-thumb-iframe")
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
                        {sceneImage
                          ? "已出图"
                          : generatingSceneNumber === scene.sceneNumber
                            ? "生成中"
                            : selectedMode === "html"
                              ? "HTML"
                              : "待出图"}
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
            <div className="chat-title-meta">
              <small>{session ? `当前用户：${currentUsername}` : "未登录也可继续体验"}</small>
              <button className="ghost-button" type="button">
                清空对话
              </button>
            </div>
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
                <div className="message-body">
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
                <div className="message-body">
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
              const confirmation = message.intentPayload?.confirmation ?? null;
              const showConfirmationAction =
                confirmation?.type === "regenerate_video_outline" && message.id === latestMessageId;

              return (
                <div className={`message ${message.role}`} key={message.id}>
                  <span className={`avatar ${message.role === "user" ? "user-avatar" : ""}`}>
                    {message.role === "user" ? currentUserInitial : <Bot size={17} />}
                  </span>
                  <div className="message-body">
                    <div className="message-head">
                      <strong>{message.role === "user" ? currentUsername : "VisionAgent AI 助手"}</strong>
                      <small>{formatTime(message.createdAt)}</small>
                    </div>
                    <div className={`message-bubble ${message.role === "user" ? "user" : "assistant"}`}>
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
                    {showConfirmationAction ? (
                      <div className="outline-card">
                        <div className="outline-card-footer">
                          <button disabled={isSending} onClick={() => void handleConfirmOutlineRegeneration(message)} type="button">
                            {isSending ? <Loader2 size={14} /> : null}
                            确认重新生成大纲
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
                <div className="message-body">
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
          <form className={`prompt-box ${selectedMode === "html" ? "has-style" : ""}`} onSubmit={handleSubmit}>
            <button aria-label="选择背景音乐" type="button">
              <Music size={18} />
            </button>
            <input
              disabled={!activeProjectId}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={modeCopy[selectedMode].prompt}
              value={prompt}
            />
            {selectedMode === "html" ? (
              <button
                className="style-picker-trigger"
                disabled={!activeProjectId}
                onClick={() => setIsHtmlStyleModalOpen(true)}
                type="button"
              >
                <Palette size={16} />
                <span>{selectedHtmlVideoStyle.nameZh}</span>
              </button>
            ) : null}
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
            {currentOutline.globalVisualStylePrompt ? (
              <div className="outline-modal-script">
                <strong>全局画面风格提示词</strong>
                <p>{getDisplayGlobalStylePrompt(currentOutline)}</p>
              </div>
            ) : null}
            <div className="outline-scene-grid">
              {currentOutline.scenes.map((scene) => {
                const sceneImage = sceneImageMap[scene.sceneNumber];
                const sceneHtml = sceneHtmlMap[scene.sceneNumber];
                const sceneAudio = sceneAudioMap[scene.sceneNumber];
                const isPlaying = playingSceneNumber === scene.sceneNumber;
                const isImageRegenerating = Boolean(
                  sceneActionLoadingMap[`${currentOutline.promptKind === "html" ? "html" : "image"}-${scene.sceneNumber}`],
                );
                const isAudioRegenerating = Boolean(sceneActionLoadingMap[`audio-${scene.sceneNumber}`]);

                return (
                  <article className="outline-scene-detail-card" key={`detail-${scene.sceneNumber}`}>
                    <div className="outline-scene-preview">
                      {currentOutline.promptKind === "image" && sceneImage ? (
                        <img alt={scene.title} className="outline-scene-image" src={sceneImage.publicUrl} />
                      ) : currentOutline.promptKind === "html" && sceneHtml ? (
                        renderSceneHtmlFrame(sceneHtml, scene.title, "outline-scene-iframe")
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
                      <button disabled={isImageRegenerating} onClick={(event) => void handleRegenerateSceneVisual(scene.sceneNumber, event)} type="button">
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
      {isHtmlStyleModalOpen ? (
        <div className="outline-modal-backdrop" onClick={() => setIsHtmlStyleModalOpen(false)} role="presentation">
          <div className="html-style-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="outline-modal-head">
              <div>
                <strong>选择 HTML 视觉风格</strong>
                <small>未选择时默认使用第一套风格，后续生成 HTML 分镜会自动附带对应风格提示词。</small>
              </div>
              <button className="outline-modal-close" onClick={() => setIsHtmlStyleModalOpen(false)} type="button">
                <X size={18} />
              </button>
            </div>
            <div className="html-style-grid">
              {HTML_VIDEO_STYLES.map((style) => {
                const isActive = style.id === selectedHtmlVideoStyleId;

                return (
                  <button
                    className={`html-style-card ${isActive ? "active" : ""}`}
                    key={style.id}
                    onClick={() => {
                      setSelectedHtmlVideoStyleId(style.id);
                      setIsHtmlStyleModalOpen(false);
                    }}
                    type="button"
                  >
                    <div className="html-style-card-preview">{renderStylePreviewFrame(style.id, "html-style-card-iframe")}</div>
                    <div className="html-style-card-copy">
                      <strong>{style.nameZh}</strong>
                      <small>{style.name}</small>
                      <p>{style.tagline}</p>
                    </div>
                  </button>
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





