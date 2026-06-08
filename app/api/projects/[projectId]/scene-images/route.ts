import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_HTML_VIDEO_STYLE_ID, getHtmlVideoStyle } from "@/app/lib/htmlVideoStyles";
import { getProject, updateProject } from "@/app/lib/projectStore";
import {
  getSceneAudioMap,
  getSceneHtmlMap,
  getSceneImageMap,
  SceneAudioSource,
  SceneHtmlSource,
  SceneImageSource,
  shiftSceneNumbersAfterInsertion,
  upsertSceneAudioSource,
  upsertSceneHtmlSource,
  upsertSceneImageSource,
} from "@/app/lib/videoSource";
import { generateSceneHtmlCode, generateSceneHtmlRevision, reviseSceneVisualPrompt, VideoOutline } from "@/app/lib/videoAgent";

type OutlineScene = {
  sceneNumber: number;
  title: string;
  narration: string;
  visualPrompt: string;
};

type OutlinePayload = {
  promptKind: "image" | "html";
  scenes: OutlineScene[];
} & Pick<VideoOutline, "title" | "summary" | "fullScript" | "globalVisualStylePrompt" | "htmlVideoStyleId" | "htmlVideoStyleName">;

function parseOutline(content: string) {
  if (!content) {
    return null;
  }

  try {
    const parsed = JSON.parse(content) as OutlinePayload;
    if (!Array.isArray(parsed?.scenes) || (parsed.promptKind !== "image" && parsed.promptKind !== "html")) {
      return null;
    }

    return {
      title: typeof parsed.title === "string" ? parsed.title : "",
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      fullScript: typeof parsed.fullScript === "string" ? parsed.fullScript : "",
      globalVisualStylePrompt: typeof parsed.globalVisualStylePrompt === "string" ? parsed.globalVisualStylePrompt : "",
      htmlVideoStyleId: typeof parsed.htmlVideoStyleId === "string" ? parsed.htmlVideoStyleId : undefined,
      htmlVideoStyleName: typeof parsed.htmlVideoStyleName === "string" ? parsed.htmlVideoStyleName : undefined,
      promptKind: parsed.promptKind,
      scenes: parsed.scenes,
    };
  } catch {
    return null;
  }
}

export async function regenerateSceneVisualByInstruction(input: {
  projectId: string;
  projectVideoSource: string;
  outline: OutlinePayload;
  sceneNumber: number;
  revisionRequest: string;
  htmlVideoStyleId?: string;
}) {
  const scene = input.outline.scenes.find((item) => item.sceneNumber === input.sceneNumber);
  if (!scene) {
    throw new Error("TARGET_SCENE_NOT_FOUND");
  }

  const selectedHtmlStyle =
    input.outline.promptKind === "html"
      ? getHtmlVideoStyle(input.htmlVideoStyleId || input.outline.htmlVideoStyleId || DEFAULT_HTML_VIDEO_STYLE_ID)
      : null;

  const existingImageMap = getSceneImageMap(input.projectVideoSource);
  const existingHtmlMap = getSceneHtmlMap(input.projectVideoSource);
  const currentSceneHtml = existingHtmlMap[input.sceneNumber]?.html ?? null;
  let currentVideoSource = input.projectVideoSource;
  const signal = new AbortController().signal;

  if (input.outline.promptKind === "image") {
    const revisedVisualPrompt = await reviseSceneVisualPrompt({
      scene,
      revisionRequest: input.revisionRequest,
      currentSceneHtml: null,
    });
    const imageResult = await createImage(revisedVisualPrompt, signal);
    const fileInfo = await saveRemoteImage(input.projectId, input.sceneNumber, imageResult.imageUrl, signal);
    const sceneImage: SceneImageSource = {
      sceneNumber: input.sceneNumber,
      title: scene.title,
      prompt: imageResult.usedPrompt,
      filename: fileInfo.filename,
      relativePath: fileInfo.relativePath,
      publicUrl: fileInfo.publicUrl,
      createdAt: new Date().toISOString(),
    };
    currentVideoSource = upsertSceneImageSource(currentVideoSource, sceneImage);
    const updatedProject = await updateProject({
      uuid: input.projectId,
      videoSource: currentVideoSource,
    });

    return {
      updatedProject,
      sceneImage,
      sceneHtml: null,
      usedVisualPrompt: revisedVisualPrompt,
    };
  }

  const revisedVisualPrompt = await reviseSceneVisualPrompt({
    scene,
    revisionRequest: input.revisionRequest,
    currentSceneHtml,
  });
  const previousSceneHtml = input.sceneNumber > 1 ? existingHtmlMap[input.sceneNumber - 1]?.html ?? null : null;
  const htmlResult = await generateSceneHtmlRevision({
    outline: {
      title: input.outline.title,
      summary: input.outline.summary,
      fullScript: input.outline.fullScript,
      mode: "html",
      promptKind: "html",
      globalVisualStylePrompt: selectedHtmlStyle?.stylePrompt ?? input.outline.globalVisualStylePrompt,
      htmlVideoStyleId: selectedHtmlStyle?.id ?? input.outline.htmlVideoStyleId,
      htmlVideoStyleName: selectedHtmlStyle?.nameZh ?? input.outline.htmlVideoStyleName,
      scenes: input.outline.scenes,
    },
    scene: {
      ...scene,
      visualPrompt: revisedVisualPrompt,
    },
    currentSceneHtml,
    revisionRequest: input.revisionRequest,
    previousSceneHtml,
  });

  const sceneHtml: SceneHtmlSource = {
    sceneNumber: input.sceneNumber,
    title: scene.title,
    prompt: revisedVisualPrompt,
    html: htmlResult.html,
    createdAt: new Date().toISOString(),
  };
  currentVideoSource = upsertSceneHtmlSource(currentVideoSource, sceneHtml);
  const updatedProject = await updateProject({
    uuid: input.projectId,
    videoSource: currentVideoSource,
  });

  return {
    updatedProject,
    sceneImage: null,
    sceneHtml,
    usedVisualPrompt: revisedVisualPrompt,
  };
}

export async function generateSceneAssetsForScene(input: {
  projectId: string;
  videoSource: string;
  outline: OutlinePayload;
  scene: OutlineScene;
  htmlVideoStyleId?: string;
}) {
  const selectedHtmlStyle =
    input.outline.promptKind === "html"
      ? getHtmlVideoStyle(input.htmlVideoStyleId || input.outline.htmlVideoStyleId || DEFAULT_HTML_VIDEO_STYLE_ID)
      : null;

  const existingHtmlMap = getSceneHtmlMap(input.videoSource);
  let currentVideoSource = input.videoSource;
  let sceneImage: SceneImageSource | null = null;
  let sceneHtml: SceneHtmlSource | null = null;
  let sceneAudio: SceneAudioSource | null = null;

  if (input.outline.promptKind === "image") {
    const imageResult = await createImage(input.scene.visualPrompt, inputSignal);
    const fileInfo = await saveRemoteImage(input.projectId, input.scene.sceneNumber, imageResult.imageUrl, inputSignal);
    sceneImage = {
      sceneNumber: input.scene.sceneNumber,
      title: input.scene.title,
      prompt: imageResult.usedPrompt,
      filename: fileInfo.filename,
      relativePath: fileInfo.relativePath,
      publicUrl: fileInfo.publicUrl,
      createdAt: new Date().toISOString(),
    };
    currentVideoSource = upsertSceneImageSource(currentVideoSource, sceneImage);
  } else {
    const previousSceneHtml = input.scene.sceneNumber > 1 ? existingHtmlMap[input.scene.sceneNumber - 1]?.html ?? null : null;
    const htmlResult = await generateSceneHtmlCode({
      outline: {
        title: input.outline.title,
        summary: input.outline.summary,
        fullScript: input.outline.fullScript,
        mode: "html",
        promptKind: "html",
        globalVisualStylePrompt: selectedHtmlStyle?.stylePrompt ?? input.outline.globalVisualStylePrompt,
        htmlVideoStyleId: selectedHtmlStyle?.id ?? input.outline.htmlVideoStyleId,
        htmlVideoStyleName: selectedHtmlStyle?.nameZh ?? input.outline.htmlVideoStyleName,
        scenes: input.outline.scenes,
      },
      scene: input.scene,
      previousSceneHtml,
    });
    sceneHtml = {
      sceneNumber: input.scene.sceneNumber,
      title: input.scene.title,
      prompt: input.scene.visualPrompt,
      html: htmlResult.html,
      createdAt: new Date().toISOString(),
    };
    currentVideoSource = upsertSceneHtmlSource(currentVideoSource, sceneHtml);
  }

  const tts = await createSceneAudio(input.scene, inputSignal);
  const audioFileInfo = await saveSceneAudio(input.projectId, input.scene.sceneNumber, tts.bytes, tts.extension);
  const durationMs = getAudioDurationMs(tts.bytes, tts.extension);
  sceneAudio = {
    sceneNumber: input.scene.sceneNumber,
    title: input.scene.title,
    narration: input.scene.narration,
    voice: tts.voice,
    filename: audioFileInfo.filename,
    relativePath: audioFileInfo.relativePath,
    publicUrl: audioFileInfo.publicUrl,
    durationMs,
    createdAt: new Date().toISOString(),
  };
  currentVideoSource = upsertSceneAudioSource(currentVideoSource, sceneAudio);

  const updatedProject = await updateProject({
    uuid: input.projectId,
    videoSource: currentVideoSource,
  });

  return {
    updatedProject,
    videoSource: currentVideoSource,
    sceneImage,
    sceneHtml,
    sceneAudio,
  };
}

const inputSignal = new AbortController().signal;

export async function insertGeneratedSceneAndAssets(input: {
  projectId: string;
  videoSource: string;
  outline: OutlinePayload;
  newScene: OutlineScene;
  insertAfterScene: number;
  htmlVideoStyleId?: string;
}) {
  const shiftedVideoSource = shiftSceneNumbersAfterInsertion(input.videoSource, input.insertAfterScene);
  return generateSceneAssetsForScene({
    projectId: input.projectId,
    videoSource: shiftedVideoSource,
    outline: input.outline,
    scene: input.newScene,
    htmlVideoStyleId: input.htmlVideoStyleId,
  });
}

function getConfigValue(name: string) {
  return process.env[name]?.trim() || "";
}

function getAiServiceConfig() {
  return {
    baseUrl: getConfigValue("AI_BASE_URL") || getConfigValue("OPENAI_BASE_URL"),
    apiKey: getConfigValue("AI_API_KEY") || getConfigValue("OPENAI_API_KEY"),
    model: getConfigValue("OPENAI_MODEL") || "gemini-3.1-pro-preview",
    voice: getConfigValue("QWEN_TTS_VOICE") || "Cherry",
  };
}

function getImageServiceConfig() {
  return {
    baseUrl: getConfigValue("AI_BASE_URL") || getConfigValue("OPENAI_BASE_URL"),
    apiKey: getConfigValue("AI_API_KEY") || getConfigValue("OPENAI_API_KEY"),
    model: getConfigValue("IMAGE_MODEL") || "qwen-image",
    qwenModel: getConfigValue("QWEN_IMAGE_MODEL") || "qwen-image-plus",
    size: getConfigValue("IMAGE_SIZE") || "1024x1024",
  };
}

function inferImageExtension(contentType: string | null, sourceUrl: string) {
  if (contentType?.includes("png")) return ".png";
  if (contentType?.includes("jpeg") || contentType?.includes("jpg")) return ".jpg";
  if (contentType?.includes("webp")) return ".webp";

  try {
    const pathname = new URL(sourceUrl).pathname.toLowerCase();
    const extension = path.extname(pathname);
    if (extension === ".png" || extension === ".jpg" || extension === ".jpeg" || extension === ".webp") {
      return extension === ".jpeg" ? ".jpg" : extension;
    }
  } catch {
    return ".png";
  }

  return ".png";
}

function inferAudioExtension(contentType: string | null) {
  if (contentType?.includes("mpeg") || contentType?.includes("mp3")) return ".mp3";
  if (contentType?.includes("wav")) return ".wav";
  if (contentType?.includes("ogg")) return ".ogg";
  if (contentType?.includes("aac")) return ".aac";
  if (contentType?.includes("flac")) return ".flac";
  return ".mp3";
}

function syncSafeDurationMs(durationMs: number | undefined) {
  return typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : undefined;
}

function parseWavDurationMs(bytes: Buffer) {
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    return undefined;
  }

  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;

  while (offset + 8 <= bytes.length) {
    const chunkId = bytes.toString("ascii", offset, offset + 4);
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;

    if (chunkId === "fmt " && chunkSize >= 16 && chunkDataOffset + 16 <= bytes.length) {
      byteRate = bytes.readUInt32LE(chunkDataOffset + 8);
    }

    if (chunkId === "data") {
      dataSize = Math.min(chunkSize, Math.max(bytes.length - chunkDataOffset, 0));
      break;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (byteRate <= 0 || dataSize <= 0) {
    return undefined;
  }

  return syncSafeDurationMs((dataSize / byteRate) * 1000);
}

function parseMp3DurationMs(bytes: Buffer) {
  if (bytes.length < 4) {
    return undefined;
  }

  let offset = 0;
  if (bytes.toString("ascii", 0, 3) === "ID3" && bytes.length >= 10) {
    const tagSize =
      ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    const hasFooter = (bytes[5] & 0x10) !== 0;
    offset = 10 + tagSize + (hasFooter ? 10 : 0);
  }

  const bitrateByLayer: Record<number, number[][]> = {
    3: [
      [],
      [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
      [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0],
      [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0],
    ],
    2: [
      [],
      [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
      [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
      [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0],
    ],
  };
  const sampleRates: Record<number, number[]> = {
    0: [11025, 12000, 8000, 0],
    2: [22050, 24000, 16000, 0],
    3: [44100, 48000, 32000, 0],
  };

  let totalSamples = 0;
  let sampleRate = 0;
  let frames = 0;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) {
      offset += 1;
      continue;
    }

    const versionBits = (bytes[offset + 1] >> 3) & 0x03;
    const layerBits = (bytes[offset + 1] >> 1) & 0x03;
    const bitrateIndex = (bytes[offset + 2] >> 4) & 0x0f;
    const sampleRateIndex = (bytes[offset + 2] >> 2) & 0x03;
    const padding = (bytes[offset + 2] >> 1) & 0x01;

    if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
      offset += 1;
      continue;
    }

    const versionKey = versionBits === 3 ? 3 : 2;
    const layer = 4 - layerBits;
    const bitrate = bitrateByLayer[versionKey]?.[layer]?.[bitrateIndex] ?? 0;
    sampleRate = sampleRates[versionBits]?.[sampleRateIndex] ?? 0;

    if (!bitrate || !sampleRate) {
      offset += 1;
      continue;
    }

    let frameLength = 0;
    let samplesPerFrame = 0;

    if (layer === 1) {
      frameLength = Math.floor((12000 * bitrate) / sampleRate + padding) * 4;
      samplesPerFrame = 384;
    } else if (layer === 2) {
      frameLength = Math.floor((144000 * bitrate) / sampleRate) + padding;
      samplesPerFrame = 1152;
    } else {
      const isMpeg1 = versionBits === 3;
      frameLength = Math.floor(((isMpeg1 ? 144000 : 72000) * bitrate) / sampleRate) + padding;
      samplesPerFrame = isMpeg1 ? 1152 : 576;
    }

    if (frameLength <= 0 || offset + frameLength > bytes.length) {
      break;
    }

    totalSamples += samplesPerFrame;
    frames += 1;
    offset += frameLength;
  }

  if (!frames || !sampleRate || !totalSamples) {
    return undefined;
  }

  return syncSafeDurationMs((totalSamples / sampleRate) * 1000);
}

function parseOggDurationMs(bytes: Buffer) {
  if (bytes.length < 64 || bytes.toString("ascii", 0, 4) !== "OggS") {
    return undefined;
  }

  let offset = 0;
  let sampleRate = 0;
  let lastGranulePosition = BigInt(0);

  while (offset + 27 <= bytes.length && bytes.toString("ascii", offset, offset + 4) === "OggS") {
    const pageSegments = bytes[offset + 26];
    const segmentTableOffset = offset + 27;
    const pageSize = bytes.subarray(segmentTableOffset, segmentTableOffset + pageSegments).reduce((sum, value) => sum + value, 0);
    const pageDataOffset = segmentTableOffset + pageSegments;
    const nextOffset = pageDataOffset + pageSize;

    if (nextOffset > bytes.length) {
      break;
    }

    const granulePosition = bytes.readBigUInt64LE(offset + 6);
    if (granulePosition > BigInt(0)) {
      lastGranulePosition = granulePosition;
    }

    if (!sampleRate) {
      if (pageDataOffset + 19 <= bytes.length && bytes.toString("ascii", pageDataOffset, pageDataOffset + 8) === "OpusHead") {
        sampleRate = 48000;
      } else if (pageDataOffset + 16 <= bytes.length && bytes[pageDataOffset] === 1 && bytes.toString("ascii", pageDataOffset + 1, pageDataOffset + 7) === "vorbis") {
        sampleRate = bytes.readUInt32LE(pageDataOffset + 12);
      }
    }

    offset = nextOffset;
  }

  if (!sampleRate || lastGranulePosition <= BigInt(0)) {
    return undefined;
  }

  return syncSafeDurationMs((Number(lastGranulePosition) / sampleRate) * 1000);
}

function getAudioDurationMs(bytes: Buffer, extension: string) {
  const normalizedExtension = extension.toLowerCase();

  if (normalizedExtension === ".wav") {
    return parseWavDurationMs(bytes);
  }

  if (normalizedExtension === ".mp3") {
    return parseMp3DurationMs(bytes);
  }

  if (normalizedExtension === ".ogg") {
    return parseOggDurationMs(bytes);
  }

  return undefined;
}

async function backfillSceneAudioDuration(sceneAudio: SceneAudioSource) {
  if (typeof sceneAudio.durationMs === "number" && sceneAudio.durationMs > 0) {
    return sceneAudio;
  }

  const absolutePath = path.join(process.cwd(), "public", sceneAudio.relativePath.replaceAll("/", path.sep));
  const bytes = await readFile(absolutePath);
  const durationMs = getAudioDurationMs(bytes, path.extname(sceneAudio.filename || sceneAudio.relativePath));

  return durationMs
    ? {
        ...sceneAudio,
        durationMs,
      }
    : sceneAudio;
}

function createFilename(sceneNumber: number, extension: string) {
  const scenePart = String(sceneNumber).padStart(3, "0");
  return `scene-${scenePart}-${Date.now()}${extension}`;
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw new Error("SCENE_MEDIA_GENERATION_ABORTED");
  }
}

async function requestJson(url: string, init: RequestInit, signal: AbortSignal) {
  const response = await fetch(url, { ...init, signal });
  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`Image provider request failed (${response.status}): ${raw}`);
  }

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Image provider response was not valid JSON: ${raw}`);
  }
}

function extractMessageContent(content: unknown) {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (!part || typeof part !== "object") {
          return "";
        }

        const record = part as Record<string, unknown>;
        return typeof record.text === "string" ? record.text : "";
      })
      .join("")
      .trim();

    return text || null;
  }

  return null;
}

async function requestChatText(
  endpoint: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  signal: AbortSignal,
) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
    }),
    signal,
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`AI rewrite request failed (${response.status}): ${raw}`);
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error(`AI rewrite response was not valid JSON: ${raw}`);
  }

  const content = extractMessageContent(payload?.choices?.[0]?.message?.content);
  if (!content) {
    throw new Error("AI rewrite response content was empty");
  }

  return content;
}

function extractGeneratedImageUrl(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;

  const data = Array.isArray(record.data) ? record.data : [];
  for (const item of data) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const imageRecord = item as Record<string, unknown>;
    if (typeof imageRecord.url === "string" && imageRecord.url.trim()) {
      return imageRecord.url.trim();
    }
  }

  const output = record.output;
  if (output && typeof output === "object") {
    const outputRecord = output as Record<string, unknown>;
    const choices: unknown[] = Array.isArray(outputRecord.choices) ? outputRecord.choices : [];
    for (const choice of choices) {
      if (!choice || typeof choice !== "object") {
        continue;
      }

      const message = (choice as Record<string, unknown>).message;
      if (!message || typeof message !== "object") {
        continue;
      }

      const messageRecord = message as Record<string, unknown>;
      const content: unknown[] = Array.isArray(messageRecord.content) ? messageRecord.content : [];
      for (const part of content) {
        if (!part || typeof part !== "object") {
          continue;
        }

        const imageUrl = (part as Record<string, unknown>).image;
        if (typeof imageUrl === "string" && imageUrl.trim()) {
          return imageUrl.trim();
        }
      }
    }
  }

  return null;
}

function inferAliImageSize(size: string) {
  return size.replace("x", "*");
}

function isImageSafetyErrorMessage(message: string) {
  return /DataInspectionFailed|inappropriate content|inappropriate-content|内容安全|违规|审核/i.test(message);
}

function sanitizeImagePromptHeuristically(prompt: string) {
  return prompt
    .replace(/毛泽东|邓小平|周恩来|蒋介石|习近平|马克思|列宁/gu, "时代人物")
    .replace(/共产党|党旗|国旗|红旗|政治口号|标语|领袖|主席台/gu, "时代符号")
    .replace(/天安门|人民大会堂|中南海/gu, "时代建筑")
    .replace(/文革|革命宣传|政治宣传/gu, "年代叙事")
    .replace(/\s+/g, " ")
    .trim();
}

async function rewriteImagePromptForSafety(originalPrompt: string, signal: AbortSignal) {
  const { baseUrl, apiKey, model } = getAiServiceConfig();
  if (!baseUrl || !apiKey) {
    return sanitizeImagePromptHeuristically(originalPrompt);
  }

  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const systemPrompt = `你是一个图像提示词安全重写助手。
请把用户提供的图片生成提示词改写成更容易通过图片内容审核的版本，同时尽量保留原本的主题、时代氛围、构图、光线、镜头、材质和美术风格。
要求：
1. 不要出现具体政治人物姓名、政治组织名称、旗帜、口号、敏感标识或容易触发审核的符号。
2. 改写为更抽象、更中性的时代场景、群像、建筑、会议、城市、生产、生活等表达。
3. 保留高质量图片生成提示词风格，适合静态分镜图。
4. 只返回改写后的提示词文本，不要解释。`;

  try {
    const rewritten = await requestChatText(endpoint, apiKey, model, systemPrompt, originalPrompt, signal);
    return rewritten.trim() || sanitizeImagePromptHeuristically(originalPrompt);
  } catch {
    return sanitizeImagePromptHeuristically(originalPrompt);
  }
}

async function createImageOnce(prompt: string, signal: AbortSignal) {
  const { baseUrl, apiKey, model, qwenModel, size } = getImageServiceConfig();
  if (!baseUrl || !apiKey) {
    throw new Error("Missing image generation service config");
  }

  let primaryError = "";

  try {
    const payload = await requestJson(
      `${baseUrl.replace(/\/$/, "")}/images/generations`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          prompt,
          n: 1,
          size,
          response_format: "url",
        }),
      },
      signal,
    );

    const imageUrl = extractGeneratedImageUrl(payload);
    if (imageUrl) {
      return {
        imageUrl,
        usedPrompt: prompt,
      };
    }
  } catch (error) {
    primaryError = error instanceof Error ? error.message : "Unknown image provider error";
  }

  const origin = new URL(baseUrl).origin;
  try {
    const qwenPayload = await requestJson(
      `${origin}/ali/api/v1/services/aigc/multimodal-generation/generation`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: qwenModel,
          input: {
            messages: [
              {
                role: "user",
                content: [{ text: prompt }],
              },
            ],
          },
          parameters: {
            watermark: false,
            prompt_extend: true,
            size: inferAliImageSize(size),
          },
        }),
      },
      signal,
    );

    const qwenImageUrl = extractGeneratedImageUrl(qwenPayload);
    if (!qwenImageUrl) {
      throw new Error("Qwen image API returned success but did not include an image URL");
    }

    return {
      imageUrl: qwenImageUrl,
      usedPrompt: prompt,
    };
  } catch (error) {
    const fallbackError = error instanceof Error ? error.message : "Unknown Qwen image provider error";
    throw new Error(primaryError ? `${primaryError}; fallback failed: ${fallbackError}` : fallbackError);
  }
}

async function createImage(prompt: string, signal: AbortSignal) {
  try {
    return await createImageOnce(prompt, signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown image provider error";
    if (!isImageSafetyErrorMessage(message)) {
      throw error;
    }

    const sanitizedPrompt = await rewriteImagePromptForSafety(prompt, signal);
    if (!sanitizedPrompt || sanitizedPrompt === prompt) {
      throw error;
    }

    return createImageOnce(sanitizedPrompt, signal);
  }
}

async function saveRemoteImage(projectId: string, sceneNumber: number, imageUrl: string, signal: AbortSignal) {
  throwIfAborted(signal);

  const response = await fetch(imageUrl, { signal });
  if (!response.ok) {
    throw new Error(`Failed to download generated image (${response.status})`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const extension = inferImageExtension(response.headers.get("content-type"), imageUrl);
  const filename = createFilename(sceneNumber, extension);
  const projectDir = path.join(process.cwd(), "public", "generated-images", projectId);
  const absolutePath = path.join(projectDir, filename);
  const relativePath = path.posix.join("generated-images", projectId, filename);

  await mkdir(projectDir, { recursive: true });
  await writeFile(absolutePath, bytes);

  return {
    filename,
    relativePath,
    publicUrl: `/${relativePath}`,
  };
}

function normalizeBase64Audio(value: string) {
  const trimmed = value.trim();
  const separatorIndex = trimmed.indexOf(",");
  if (trimmed.startsWith("data:") && separatorIndex >= 0) {
    return trimmed.slice(separatorIndex + 1);
  }
  return trimmed;
}

function extractAudioBuffer(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const candidates = [record.audio, record.audio_base64, record.audioBase64, record.data, record.output_audio, record.outputAudio];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return Buffer.from(normalizeBase64Audio(candidate), "base64");
    }

    if (candidate && typeof candidate === "object") {
      const nested = candidate as Record<string, unknown>;
      const nestedBase64 = nested.data ?? nested.base64 ?? nested.audio ?? nested.audio_base64;
      if (typeof nestedBase64 === "string" && nestedBase64.trim()) {
        return Buffer.from(normalizeBase64Audio(nestedBase64), "base64");
      }
    }
  }

  return null;
}

function extractAudioUrl(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const output = record.output;
  if (!output || typeof output !== "object") {
    return null;
  }

  const audio = (output as Record<string, unknown>).audio;
  if (!audio || typeof audio !== "object") {
    return null;
  }

  const url = (audio as Record<string, unknown>).url;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

function extractTopLevelAudioUrl(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const audio = (payload as Record<string, unknown>).audio;
  if (!audio || typeof audio !== "object") {
    return null;
  }

  const url = (audio as Record<string, unknown>).url;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

function buildQwenTtsFallbackEndpoints(baseUrl: string) {
  const normalized = baseUrl.replace(/\/$/, "");
  const endpoints = [`${normalized}/services/aigc/multimodal-generation/generation`];

  try {
    const url = new URL(normalized);
    if (url.pathname.endsWith("/v1")) {
      endpoints.push(`${url.origin}/api/v1/services/aigc/multimodal-generation/generation`);
    }
  } catch {
    return endpoints;
  }

  return [...new Set(endpoints)];
}

async function createSceneAudio(scene: OutlineScene, signal: AbortSignal) {
  const { baseUrl, apiKey, voice } = getAiServiceConfig();
  if (!baseUrl || !apiKey) {
    throw new Error("Missing AI service config for TTS");
  }

  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const primaryResponse = await fetch(`${normalizedBaseUrl}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "qwen3-tts-flash",
      voice,
      input: scene.narration,
      response_format: "mp3",
    }),
    signal,
  });

  if (primaryResponse.ok) {
    const contentType = primaryResponse.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      const payload = (await primaryResponse.json().catch(() => null)) as unknown;
      const bytes = extractAudioBuffer(payload);
      if (!bytes) {
        throw new Error("TTS response JSON did not contain audio data");
      }

      return {
        bytes,
        extension: ".mp3",
        voice,
      };
    }

    const bytes = Buffer.from(await primaryResponse.arrayBuffer());
    if (!bytes.length) {
      throw new Error("TTS response returned empty audio data");
    }

    return {
      bytes,
      extension: inferAudioExtension(contentType),
      voice,
    };
  }

  const primaryError = await primaryResponse.text().catch(() => "");

  const ttsResponse = await fetch(`${normalizedBaseUrl}/tts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "alibaba/qwen3-tts-flash",
      text: scene.narration,
      voice,
    }),
    signal,
  });

  const ttsRaw = await ttsResponse.text().catch(() => "");
  if (ttsResponse.ok) {
    try {
      const payload = JSON.parse(ttsRaw) as unknown;
      const audioUrl = extractTopLevelAudioUrl(payload);

      if (audioUrl) {
        const audioResponse = await fetch(audioUrl, { signal });
        if (!audioResponse.ok) {
          throw new Error(`Failed to download generated audio (${audioResponse.status})`);
        }

        const bytes = Buffer.from(await audioResponse.arrayBuffer());
        if (!bytes.length) {
          throw new Error("Generated audio download was empty");
        }

        return {
          bytes,
          extension: inferAudioExtension(audioResponse.headers.get("content-type")),
          voice,
        };
      }

      const bytes = extractAudioBuffer(payload);
      if (bytes?.length) {
        return {
          bytes,
          extension: ".wav",
          voice,
        };
      }
    } catch {
      // Continue to the official Qwen-compatible fallback below.
    }
  }

  for (const endpoint of buildQwenTtsFallbackEndpoints(baseUrl)) {
    const fallbackResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen3-tts-flash",
        input: {
          text: scene.narration,
          voice,
          language_type: "Chinese",
        },
      }),
      signal,
    });

    const raw = await fallbackResponse.text();
    if (!fallbackResponse.ok) {
      continue;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      continue;
    }
    const audioUrl = extractAudioUrl(payload);
    if (audioUrl) {
      const audioResponse = await fetch(audioUrl, { signal });
      if (!audioResponse.ok) {
        throw new Error(`Failed to download generated audio (${audioResponse.status})`);
      }

      const bytes = Buffer.from(await audioResponse.arrayBuffer());
      if (!bytes.length) {
        throw new Error("Generated audio download was empty");
      }

      return {
        bytes,
        extension: inferAudioExtension(audioResponse.headers.get("content-type")),
        voice,
      };
    }

    const bytes = extractAudioBuffer(payload);
    if (bytes?.length) {
      return {
        bytes,
        extension: ".wav",
        voice,
      };
    }
  }

  throw new Error(`TTS request failed (${primaryResponse.status}): ${primaryError || ttsRaw}`);
}

async function saveSceneAudio(projectId: string, sceneNumber: number, bytes: Buffer, extension: string) {
  const filename = createFilename(sceneNumber, extension);
  const projectDir = path.join(process.cwd(), "public", "generated-audio", projectId);
  const absolutePath = path.join(projectDir, filename);
  const relativePath = path.posix.join("generated-audio", projectId, filename);

  await mkdir(projectDir, { recursive: true });
  await writeFile(absolutePath, bytes);

  return {
    filename,
    relativePath,
    publicUrl: `/${relativePath}`,
  };
}

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  const body = await request.json().catch(() => null);
  const sceneNumber = typeof body?.sceneNumber === "number" ? body.sceneNumber : Number(body?.sceneNumber);
  const regenerateImage = Boolean(body && typeof body === "object" && (body as Record<string, unknown>).regenerateImage);
  const regenerateHtml = Boolean(body && typeof body === "object" && (body as Record<string, unknown>).regenerateHtml);
  const regenerateAudio = Boolean(body && typeof body === "object" && (body as Record<string, unknown>).regenerateAudio);
  const htmlVideoStyleId = typeof body?.htmlVideoStyleId === "string" ? body.htmlVideoStyleId.trim() : "";

  if (!projectId || !Number.isInteger(sceneNumber) || sceneNumber < 1) {
    return NextResponse.json({ error: "projectId 或 sceneNumber 不正确" }, { status: 400 });
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const outline = parseOutline(project.outlineContent);
  if (!outline) {
    return NextResponse.json({ error: "当前项目没有可用于生成分镜图片的图片大纲" }, { status: 400 });
  }

  const selectedHtmlStyle =
    outline.promptKind === "html"
      ? getHtmlVideoStyle(htmlVideoStyleId || outline.htmlVideoStyleId || DEFAULT_HTML_VIDEO_STYLE_ID)
      : null;

  const scene = outline.scenes.find((item) => item.sceneNumber === sceneNumber);
  if (!scene) {
    return NextResponse.json({ error: "分镜不存在" }, { status: 404 });
  }

  const existingImageMap = getSceneImageMap(project.videoSource);
  const existingHtmlMap = getSceneHtmlMap(project.videoSource);
  const existingAudioMap = getSceneAudioMap(project.videoSource);
  let sceneImage: SceneImageSource | null = regenerateImage ? null : existingImageMap[sceneNumber] ?? null;
  let sceneHtml: SceneHtmlSource | null = regenerateHtml ? null : existingHtmlMap[sceneNumber] ?? null;
  let sceneAudio: SceneAudioSource | null = regenerateAudio ? null : existingAudioMap[sceneNumber] ?? null;

  try {
    let currentVideoSource = project.videoSource;

    if (outline.promptKind === "image" && !sceneImage) {
      const imageResult = await createImage(scene.visualPrompt, request.signal);
      const fileInfo = await saveRemoteImage(projectId, sceneNumber, imageResult.imageUrl, request.signal);

      sceneImage = {
        sceneNumber,
        title: scene.title,
        prompt: imageResult.usedPrompt,
        filename: fileInfo.filename,
        relativePath: fileInfo.relativePath,
        publicUrl: fileInfo.publicUrl,
        createdAt: new Date().toISOString(),
      };

      currentVideoSource = upsertSceneImageSource(currentVideoSource, sceneImage);
    }

    if (outline.promptKind === "html" && !sceneHtml) {
      const previousSceneHtml = sceneNumber > 1 ? existingHtmlMap[sceneNumber - 1]?.html ?? null : null;
      const htmlResult = await generateSceneHtmlCode({
        outline: {
          title: outline.title,
          summary: outline.summary,
          fullScript: outline.fullScript,
          mode: "html",
          promptKind: "html",
          globalVisualStylePrompt: selectedHtmlStyle?.stylePrompt ?? outline.globalVisualStylePrompt,
          htmlVideoStyleId: selectedHtmlStyle?.id ?? outline.htmlVideoStyleId,
          htmlVideoStyleName: selectedHtmlStyle?.nameZh ?? outline.htmlVideoStyleName,
          scenes: outline.scenes,
        },
        scene,
        previousSceneHtml,
      });

      sceneHtml = {
        sceneNumber,
        title: scene.title,
        prompt: scene.visualPrompt,
        html: htmlResult.html,
        createdAt: new Date().toISOString(),
      };

      currentVideoSource = upsertSceneHtmlSource(currentVideoSource, sceneHtml);
    }

    if (!sceneAudio) {
      const tts = await createSceneAudio(scene, request.signal);
      const fileInfo = await saveSceneAudio(projectId, sceneNumber, tts.bytes, tts.extension);
      const durationMs = getAudioDurationMs(tts.bytes, tts.extension);

      sceneAudio = {
        sceneNumber,
        title: scene.title,
        narration: scene.narration,
        voice: tts.voice,
        filename: fileInfo.filename,
        relativePath: fileInfo.relativePath,
        publicUrl: fileInfo.publicUrl,
        durationMs,
        createdAt: new Date().toISOString(),
      };

      currentVideoSource = upsertSceneAudioSource(currentVideoSource, sceneAudio);
    } else if (!sceneAudio.durationMs) {
      sceneAudio = await backfillSceneAudioDuration(sceneAudio);
      currentVideoSource = upsertSceneAudioSource(currentVideoSource, sceneAudio);
    }

    const updatedProject = await updateProject({
      uuid: projectId,
      videoSource: currentVideoSource,
    });

    return NextResponse.json({
      skipped:
        outline.promptKind === "image"
          ? !regenerateImage && !regenerateAudio && Boolean(existingImageMap[sceneNumber] && existingAudioMap[sceneNumber])
          : !regenerateHtml && !regenerateAudio && Boolean(existingHtmlMap[sceneNumber] && existingAudioMap[sceneNumber]),
      sceneImage,
      sceneHtml,
      sceneAudio,
      project: updatedProject,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "SCENE_MEDIA_GENERATION_ABORTED") {
      return NextResponse.json({ aborted: true }, { status: 499 });
    }

    console.error("Generate scene media failed", error);
    const details = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "生成分镜图片或旁白音频失败", details }, { status: 500 });
  }
}
