import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type IntentAction =
  | "generate_video_outline"
  | "regenerate_video_outline"
  | "add_scene"
  | "delete_scene"
  | "regenerate_scene"
  | "unsupported";

export type IntentAnalysis = {
  action: IntentAction;
  reason: string;
  targetScene?: number | null;
};

export type VideoMode = "slideshow" | "html";

export type VideoOutlineScene = {
  sceneNumber: number;
  title: string;
  narration: string;
  visualPrompt: string;
};

export type VideoOutline = {
  title: string;
  summary: string;
  fullScript: string;
  mode: VideoMode;
  promptKind: "image" | "html";
  globalVisualStylePrompt?: string;
  scenes: VideoOutlineScene[];
};

const supportedActions: IntentAction[] = [
  "generate_video_outline",
  "regenerate_video_outline",
  "add_scene",
  "delete_scene",
  "regenerate_scene",
  "unsupported",
];

const intentSystemPrompt = `你是一个视频创作助手，需要先判断用户输入对应的操作意图。
请只从以下 action 中选择一个最合适的值返回：
1. generate_video_outline：生成完整视频大纲，包括完整逐字稿和分镜列表。
2. regenerate_video_outline：重新生成整个视频大纲。
3. add_scene：新增一个分镜。
4. delete_scene：删除一个分镜。
5. regenerate_scene：重新生成某个分镜。
6. unsupported：其他暂不支持的指令。
只返回 JSON，不要返回 Markdown，不要包裹代码块。
reason 使用简短中文解释判断原因。
如果没有明确分镜序号，targetScene 返回 null。
示例：
{
  "action": "regenerate_scene",
  "reason": "用户明确要求重做第3个分镜",
  "targetScene": 3
}`;

function buildOutlineSystemPrompt(mode: VideoMode) {
  const promptRule =
    mode === "slideshow"
      ? "你必须先根据整支视频脚本选择一组统一的全局图像风格提示词，并输出到 globalVisualStylePrompt。它需要概括整组画面的时代气质、摄影语言、色调、光线、材质、镜头、画幅、质感与审美方向。随后每个分镜的 visualPrompt 都必须以前置这组全局风格提示词开头，再补充分镜自己的主体、场景、动作、构图和细节，使整组画面风格保持一致。"
      : "visualPrompt 必须是 HTML 网页动画提示词，强调页面结构、组件布局、动效、转场、数据可视化、交互表现和动画节奏，适合后续生成网页动画。";

  return `你是一个专业的视频策划与分镜编导助手。
请根据用户输入，先生成一份完整的视频脚本逐字稿，再将这份逐字稿拆分为 6 到 30 个分镜。
当前视频模式是：${mode === "slideshow" ? "图片轮播视频" : "HTML 动画视频"}。
${promptRule}

请确保输出满足以下要求：
1. 整体内容完整、自然，可直接进入后续视频制作。
2. 分镜数量必须在 6 到 30 个之间。
3. 每个分镜都必须包含：sceneNumber、title、narration、visualPrompt。
4. narration 是该分镜的中文旁白逐字稿，要求自然、口语化、适合配音。
5. 当模式为 slideshow 时，必须额外输出 globalVisualStylePrompt，并确保每个 visualPrompt 都以前置这组全局风格提示词开头。
6. visualPrompt 必须和当前模式严格匹配，不能混用图片提示词与 HTML 动画提示词。
7. sceneNumber 从 1 开始连续递增。
8. title、summary、fullScript、scenes 都必须有内容。
只返回 JSON，不要返回 Markdown，不要包裹代码块。
返回结构：
{
  "title": "视频标题",
  "summary": "视频概述",
  "fullScript": "完整逐字稿",
  "mode": "${mode}",
  "promptKind": "${mode === "slideshow" ? "image" : "html"}",
  "globalVisualStylePrompt": "${mode === "slideshow" ? "统一的全局图像风格提示词" : ""}",
  "scenes": [
    {
      "sceneNumber": 1,
      "title": "分镜标题",
      "narration": "分镜旁白",
      "visualPrompt": "用于后续生成画面或网页动画的提示词"
    }
  ]
}`;
}

let cachedDotEnvValues: Record<string, string> | null = null;

function readDotEnvValues() {
  if (cachedDotEnvValues) {
    return cachedDotEnvValues;
  }

  const envPath = path.join(process.cwd(), ".env");
  if (!existsSync(envPath)) {
    cachedDotEnvValues = {};
    return cachedDotEnvValues;
  }

  const values: Record<string, string> = {};
  const content = readFileSync(envPath, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    const inlineCommentIndex = value.search(/\s+#/);
    if (inlineCommentIndex >= 0) {
      value = value.slice(0, inlineCommentIndex).trim();
    }

    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  cachedDotEnvValues = values;
  return values;
}

function getConfigValue(name: string) {
  return readDotEnvValues()[name] ?? process.env[name];
}

function getModelConfig() {
  return {
    baseUrl: getConfigValue("OPENAI_BASE_URL"),
    apiKey: getConfigValue("OPENAI_API_KEY"),
    model: getConfigValue("OPENAI_MODEL") ?? "gpt-4o-mini",
  };
}

function parseJsonObject(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const raw = fenced?.[1] ?? trimmed;
  return JSON.parse(raw);
}

function extractMessageContent(content: unknown) {
  if (typeof content === "string") {
    return content;
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

async function requestChatJson(
  endpoint: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  temperature: number,
  enforceJson: boolean,
) {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature,
  };

  if (enforceJson) {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`AI request failed (${response.status}): ${raw}`);
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`AI response was not valid JSON: ${raw}`);
  }

  const content = extractMessageContent(data?.choices?.[0]?.message?.content);
  if (!content) {
    throw new Error(`AI response content was empty: ${raw}`);
  }

  return parseJsonObject(content);
}

function normalizePromptSegment(value: string) {
  return value.replace(/\s+/g, " ").replace(/^[,，;；:：\s]+|[,，;；:：\s]+$/g, "").trim();
}

function mergeGlobalStylePrompt(globalStylePrompt: string, scenePrompt: string) {
  const normalizedGlobal = normalizePromptSegment(globalStylePrompt);
  const normalizedScene = normalizePromptSegment(scenePrompt);

  if (!normalizedGlobal) {
    return normalizedScene;
  }

  if (!normalizedScene) {
    return normalizedGlobal;
  }

  if (normalizedScene.startsWith(normalizedGlobal)) {
    return normalizedScene;
  }

  return `${normalizedGlobal}, ${normalizedScene}`;
}

export function validateIntentAnalysis(value: unknown): IntentAnalysis {
  if (!value || typeof value !== "object") {
    throw new Error("AI returned a non-object JSON payload");
  }

  const record = value as Record<string, unknown>;
  if (typeof record.action !== "string" || !supportedActions.includes(record.action as IntentAction)) {
    throw new Error("AI returned an unsupported action");
  }

  if (typeof record.reason !== "string" || !record.reason.trim()) {
    throw new Error("AI returned an empty reason");
  }

  if (
    record.targetScene !== undefined &&
    record.targetScene !== null &&
    (typeof record.targetScene !== "number" || !Number.isInteger(record.targetScene) || record.targetScene < 1)
  ) {
    throw new Error("AI returned an invalid targetScene");
  }

  return {
    action: record.action as IntentAction,
    reason: record.reason,
    targetScene: typeof record.targetScene === "number" ? record.targetScene : null,
  };
}

export function validateVideoOutline(value: unknown): VideoOutline {
  if (!value || typeof value !== "object") {
    throw new Error("AI returned a non-object outline payload");
  }

  const record = value as Record<string, unknown>;
  const scenes = Array.isArray(record.scenes) ? record.scenes : null;

  if (typeof record.title !== "string" || !record.title.trim()) {
    throw new Error("AI returned an empty outline title");
  }

  if (typeof record.summary !== "string" || !record.summary.trim()) {
    throw new Error("AI returned an empty outline summary");
  }

  if (typeof record.fullScript !== "string" || !record.fullScript.trim()) {
    throw new Error("AI returned an empty fullScript");
  }

  if (record.mode !== "slideshow" && record.mode !== "html") {
    throw new Error("AI returned an invalid outline mode");
  }

  if (record.promptKind !== "image" && record.promptKind !== "html") {
    throw new Error("AI returned an invalid promptKind");
  }

  const globalVisualStylePrompt =
    typeof record.globalVisualStylePrompt === "string" ? normalizePromptSegment(record.globalVisualStylePrompt) : "";

  if (record.promptKind === "image" && !globalVisualStylePrompt) {
    throw new Error("AI returned an empty globalVisualStylePrompt for slideshow mode");
  }

  if (!scenes || scenes.length < 6 || scenes.length > 30) {
    throw new Error("AI returned an invalid scene count");
  }

  const normalizedScenes = scenes.map((scene, index) => {
    if (!scene || typeof scene !== "object") {
      throw new Error(`AI returned an invalid scene at index ${index}`);
    }

    const item = scene as Record<string, unknown>;
    const sceneNumber = item.sceneNumber;

    if (typeof sceneNumber !== "number" || !Number.isInteger(sceneNumber) || sceneNumber !== index + 1) {
      throw new Error(`AI returned an invalid sceneNumber at index ${index}`);
    }

    if (typeof item.title !== "string" || !item.title.trim()) {
      throw new Error(`AI returned an empty scene title at index ${index}`);
    }

    if (typeof item.narration !== "string" || !item.narration.trim()) {
      throw new Error(`AI returned an empty scene narration at index ${index}`);
    }

    if (typeof item.visualPrompt !== "string" || !item.visualPrompt.trim()) {
      throw new Error(`AI returned an empty visualPrompt at index ${index}`);
    }

    const visualPrompt =
      record.promptKind === "image"
        ? mergeGlobalStylePrompt(globalVisualStylePrompt, item.visualPrompt.trim())
        : item.visualPrompt.trim();

    return {
      sceneNumber,
      title: item.title.trim(),
      narration: item.narration.trim(),
      visualPrompt,
    };
  });

  return {
    title: record.title.trim(),
    summary: record.summary.trim(),
    fullScript: record.fullScript.trim(),
    mode: record.mode,
    promptKind: record.promptKind,
    globalVisualStylePrompt,
    scenes: normalizedScenes,
  };
}

export async function analyzeUserIntent(userPrompt: string): Promise<IntentAnalysis> {
  const { baseUrl, apiKey, model } = getModelConfig();

  if (!baseUrl || !apiKey) {
    throw new Error("Missing OPENAI_BASE_URL or OPENAI_API_KEY");
  }

  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  let lastError: unknown = null;

  for (const enforceJson of [true, false]) {
    try {
      const payload = await requestChatJson(endpoint, apiKey, model, intentSystemPrompt, userPrompt, 0.1, enforceJson);
      return validateIntentAnalysis(payload);
    } catch (error) {
      lastError = error;
      console.error("AI intent analysis attempt failed", { enforceJson, error });
    }
  }

  throw lastError instanceof Error ? lastError : new Error("AI intent analysis failed");
}

export async function generateVideoOutline(userPrompt: string, mode: VideoMode): Promise<VideoOutline> {
  const { baseUrl, apiKey, model } = getModelConfig();

  if (!baseUrl || !apiKey) {
    throw new Error("Missing OPENAI_BASE_URL or OPENAI_API_KEY");
  }

  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const payload = await requestChatJson(endpoint, apiKey, model, buildOutlineSystemPrompt(mode), userPrompt, 0.4, true);

  return validateVideoOutline(payload);
}

export function runIntentAction(intent: IntentAnalysis): string {
  const handlers: Record<IntentAction, (analysis: IntentAnalysis) => string> = {
    generate_video_outline: (analysis) => `已识别意图：生成视频大纲。原因：${analysis.reason}`,
    regenerate_video_outline: (analysis) => `已识别意图：重新生成视频大纲。原因：${analysis.reason}`,
    add_scene: (analysis) => `已识别意图：新增一个分镜。原因：${analysis.reason}`,
    delete_scene: (analysis) => `已识别意图：删除一个分镜。原因：${analysis.reason}`,
    regenerate_scene: (analysis) =>
      `已识别意图：重新生成${analysis.targetScene ? `第 ${analysis.targetScene} 个` : "某个"}分镜。原因：${analysis.reason}`,
    unsupported: (analysis) => `已识别意图：其他暂不支持的指令。原因：${analysis.reason}`,
  };

  return handlers[intent.action](intent);
}
