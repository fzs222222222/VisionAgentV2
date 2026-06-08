import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getHtmlVideoStyle, HtmlVideoStyleId } from "@/app/lib/htmlVideoStyles";

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
  htmlVideoStyleId?: HtmlVideoStyleId;
  htmlVideoStyleName?: string;
  scenes: VideoOutlineScene[];
};

export type InsertedSceneDraft = {
  insertAfterScene: number;
  title: string;
  narration: string;
  visualPrompt: string;
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
const intentPromptSupplement = `For action "add_scene", targetScene means the scene number after which the new scene should be inserted. If the user did not specify a position, return 0.
For action "regenerate_scene", targetScene must be the single scene number the user wants to modify.`;

function buildOutlineSystemPrompt(mode: VideoMode) {
  if (mode === "html") {
    return `你是一个网页动画视频设计工程师，同时也是资深的视频分镜设计师。
请根据用户输入，先生成完整的视频脚本逐字稿，再将脚本拆分为 6 到 30 个网页动画分镜。
当前视频模式是：HTML 动画视频。

请严格遵守以下要求：
1. 每个分镜都必须包含 sceneNumber、title、narration、visualPrompt。
2. visualPrompt 必须是网页动画工程提示词，而不是图片生成提示词。
3. visualPrompt 需要明确该分镜如何通过 HTML、CSS、JavaScript、SVG、Canvas 等技术实现。
4. visualPrompt 需要描述页面结构、布局层次、主视觉元素、文字动画、图形动画、数据可视化、镜头感和转场氛围。
5. 所有分镜要保持统一的视觉语言、色彩体系、品牌调性和动效气质。
6. narration 是自然、口语化、适合中文配音的逐字稿。
7. 分镜数量必须在 6 到 30 个之间，sceneNumber 从 1 开始连续递增。
8. title、summary、fullScript、scenes 都必须有内容。
9. 只返回 JSON，不要返回 Markdown，不要包裹代码块。

返回结构：
{
  "title": "视频标题",
  "summary": "视频概述",
  "fullScript": "完整逐字稿",
  "mode": "html",
  "promptKind": "html",
  "scenes": [
    {
      "sceneNumber": 1,
      "title": "分镜标题",
      "narration": "分镜旁白",
      "visualPrompt": "用于后续生成网页动画代码的工程提示词"
    }
  ]
}`;
  }

  return `你是一个专业的视频策划与分镜编导助手。
请根据用户输入，先生成一份完整的视频脚本逐字稿，再将这份逐字稿拆分为 6 到 30 个分镜。
当前视频模式是：图片轮播视频。

请严格遵守以下要求：
1. 你必须先根据整支视频脚本选择一组统一的全局图像风格提示词，并输出到 globalVisualStylePrompt。
2. globalVisualStylePrompt 需要概括整组画面的时代气质、摄影语言、色调、光线、材质、镜头、画幅、质感与审美方向。
3. 每个分镜的 visualPrompt 都必须以前置这组全局风格提示词开头，再补充分镜自己的主体、场景、动作、构图和细节。
4. narration 是自然、口语化、适合中文配音的逐字稿。
5. 分镜数量必须在 6 到 30 个之间，sceneNumber 从 1 开始连续递增。
6. title、summary、fullScript、scenes 都必须有内容。
7. 只返回 JSON，不要返回 Markdown，不要包裹代码块。

返回结构：
{
  "title": "视频标题",
  "summary": "视频概述",
  "fullScript": "完整逐字稿",
  "mode": "slideshow",
  "promptKind": "image",
  "globalVisualStylePrompt": "统一的全局图像风格提示词",
  "scenes": [
    {
      "sceneNumber": 1,
      "title": "分镜标题",
      "narration": "分镜旁白",
      "visualPrompt": "用于后续生成图片的提示词"
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
    model: getConfigValue("OPENAI_MODEL") ?? "gemini-3.1-pro-preview",
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
  return value.replace(/\s+/g, " ").replace(/^[,\s]+|[,\s]+$/g, "").trim();
}

function sanitizeNarrationLead(value: string) {
  return value
    .replace(/^(大家好[，,！!。.\s]*)+/u, "")
    .replace(/^(今天(我们|给大家)?(来|将|先)?(一起)?来?[，,：:\s]*)/u, "")
    .replace(/^(这节课|这一节|接下来(我们)?)[，,！!。.\s]*/u, "")
    .trim();
}

function sanitizeFullScriptLead(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => sanitizeNarrationLead(line))
    .join("\n")
    .trim();
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
    (typeof record.targetScene !== "number" || !Number.isInteger(record.targetScene) || record.targetScene < 0)
  ) {
    throw new Error("AI returned an invalid targetScene");
  }

  return {
    action: record.action as IntentAction,
    reason: record.reason.trim(),
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
      narration: sanitizeNarrationLead(item.narration.trim()),
      visualPrompt,
    };
  });

  return {
    title: record.title.trim(),
    summary: record.summary.trim(),
    fullScript: sanitizeFullScriptLead(record.fullScript.trim()),
    mode: record.mode,
    promptKind: record.promptKind,
    globalVisualStylePrompt,
    htmlVideoStyleId: typeof record.htmlVideoStyleId === "string" ? (record.htmlVideoStyleId as HtmlVideoStyleId) : undefined,
    htmlVideoStyleName: typeof record.htmlVideoStyleName === "string" ? record.htmlVideoStyleName.trim() : undefined,
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
      const payload = await requestChatJson(
        endpoint,
        apiKey,
        model,
        `${intentSystemPrompt}\n\n${intentPromptSupplement}`,
        userPrompt,
        0.1,
        enforceJson,
      );
      return validateIntentAnalysis(payload);
    } catch (error) {
      lastError = error;
      console.error("AI intent analysis attempt failed", { enforceJson, error });
    }
  }

  throw lastError instanceof Error ? lastError : new Error("AI intent analysis failed");
}

export async function generateVideoOutline(
  userPrompt: string,
  mode: VideoMode,
  options?: { htmlVideoStyleId?: HtmlVideoStyleId },
): Promise<VideoOutline> {
  const { baseUrl, apiKey, model } = getModelConfig();

  if (!baseUrl || !apiKey) {
    throw new Error("Missing OPENAI_BASE_URL or OPENAI_API_KEY");
  }

  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const payload = await requestChatJson(endpoint, apiKey, model, buildOutlineSystemPrompt(mode), userPrompt, 0.4, true);
  const outline = validateVideoOutline(payload);

  if (mode === "html") {
    const selectedStyle = getHtmlVideoStyle(options?.htmlVideoStyleId);
    return {
      ...outline,
      globalVisualStylePrompt: selectedStyle.stylePrompt,
      htmlVideoStyleId: selectedStyle.id,
      htmlVideoStyleName: selectedStyle.nameZh,
    };
  }

  return outline;
}

export async function generateSceneHtmlCode(input: {
  outline: VideoOutline;
  scene: VideoOutlineScene;
  previousSceneHtml?: string | null;
}) {
  const { baseUrl, apiKey, model } = getModelConfig();

  if (!baseUrl || !apiKey) {
    throw new Error("Missing OPENAI_BASE_URL or OPENAI_API_KEY");
  }

  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const systemPrompt = `You are an expert HTML motion designer building one standalone 16:9 animated scene for a video.
Return JSON only in the shape {"html":"full html","summary":"short summary"}.

Hard requirements:
1. Return one complete standalone HTML document with <html>, <head>, <body>, <style>, and any needed <script>.
2. Implement the scene directly from the current visualPrompt using HTML/CSS/JavaScript/SVG/Canvas.
3. The scene must fit a 1280x720 frame with no browser scrollbars and no external network resources.
4. All visible copy should default to Chinese when text is needed.
5. Autoplay the motion on load and make the scene feel complete within the scene duration.
6. If previous scene HTML is provided, preserve the same visual language, rhythm, component style, and palette.

Text-density rules:
7. Prefer graphics, layout, icons, shapes, counters, charts, labels, and short kinetic phrases over large subtitle blocks.
8. Never place a long paragraph on screen. On-screen Chinese copy should usually stay within 8-20 characters per text group and within 2 short lines.
9. If the narration is long, extract only the key phrase, key number, or key conclusion for the screen. Do not paste the full narration onto the canvas.
10. Reserve a clean subtitle-safe area in the bottom 18% of the frame. Keep the main subject and any built-in text above that area unless the visualPrompt explicitly requires a lower-third module.
11. Avoid stacking multiple dense text modules in the same scene. One primary headline plus one small supporting label is preferred.
12. If information is complex, split it into beats, highlights, or sequential reveals instead of showing everything at once.

Output rules:
13. Do not return markdown.
14. summary should briefly explain the visual approach in one sentence.`;

  const previousHtmlSection = input.previousSceneHtml?.trim()
    ? `上一分镜 HTML 代码如下，请用于保持视觉一致性参考：
${input.previousSceneHtml}`
    : "当前没有上一分镜 HTML 代码可参考，请自行建立统一且可延展的视觉语言。";

  const userPrompt = `视频标题：${input.outline.title}
视频概述：${input.outline.summary}
完整逐字稿：${input.outline.fullScript}
当前分镜编号：${input.scene.sceneNumber}
当前分镜标题：${input.scene.title}
当前分镜旁白：${input.scene.narration}
当前分镜网页动画提示词：${input.scene.visualPrompt}

${previousHtmlSection}`;

  const payload = (
    await requestChatJson(
      endpoint,
      apiKey,
      model,
      `${systemPrompt}

褰撳墠鍏ㄥ眬瑙嗚椋庢牸鍚嶇О锛?${input.outline.htmlVideoStyleName ?? ""}
褰撳墠鍏ㄥ眬瑙嗚椋庢牸鎻愮ず璇嶏細${input.outline.globalVisualStylePrompt ?? ""}`,
      userPrompt,
      0.35,
      true,
    )
  ) as Record<string, unknown>;
  const html = typeof payload.html === "string" ? payload.html.trim() : "";

  if (!html || !html.includes("<html")) {
    throw new Error("AI returned invalid HTML scene code");
  }

  return {
    html,
    summary: typeof payload.summary === "string" ? payload.summary.trim() : "",
  };
}

export async function reviseSceneVisualPrompt(input: {
  scene: VideoOutlineScene;
  revisionRequest: string;
  currentSceneHtml?: string | null;
}) {
  const { baseUrl, apiKey, model } = getModelConfig();

  if (!baseUrl || !apiKey) {
    throw new Error("Missing OPENAI_BASE_URL or OPENAI_API_KEY");
  }

  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const payload = await requestChatJson(
    endpoint,
    apiKey,
    model,
    `You revise a single video scene visual prompt.
Return JSON only in the shape {"visualPrompt":"..."}.
Requirements:
1. Revise only one scene and keep the same scene goal.
2. Apply the user's change request to the new visual prompt.
3. If current HTML exists, keep the prompt suitable for regenerating that HTML animation scene.
4. Do not return markdown.`,
    `Scene title: ${input.scene.title}
Scene narration: ${input.scene.narration}
Original visual prompt: ${input.scene.visualPrompt}
Current scene HTML:
${input.currentSceneHtml?.trim() || "N/A"}

User revision request:
${input.revisionRequest}`,
    0.3,
    true,
  );

  const visualPrompt = typeof payload.visualPrompt === "string" ? payload.visualPrompt.trim() : "";
  if (!visualPrompt) {
    throw new Error("AI returned an empty revised visualPrompt");
  }

  return visualPrompt;
}

export async function generateSceneHtmlRevision(input: {
  outline: VideoOutline;
  scene: VideoOutlineScene;
  currentSceneHtml?: string | null;
  revisionRequest: string;
  previousSceneHtml?: string | null;
}) {
  const { baseUrl, apiKey, model } = getModelConfig();

  if (!baseUrl || !apiKey) {
    throw new Error("Missing OPENAI_BASE_URL or OPENAI_API_KEY");
  }

  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const payload = await requestChatJson(
    endpoint,
    apiKey,
    model,
    `You revise one HTML animated video scene.
Return JSON only in the shape {"html":"full html","summary":"short summary"}.
Requirements:
1. Return one complete standalone HTML document.
2. Keep 16:9 layout and avoid any external network resources.
3. Use the current scene narration, original visual prompt, existing HTML, and user revision request together.
4. Preserve the overall visual language of the video.
5. Reduce on-screen text density: prefer short phrases, keyword highlights, and sequential reveals instead of long subtitle paragraphs.
6. Keep a clean subtitle-safe area in the bottom 18% of the frame unless the revision explicitly asks for a lower-third layout.
7. If current HTML already contains too much copy, simplify it rather than preserving that density.
8. Do not return markdown.`,
    `Video title: ${input.outline.title}
Video summary: ${input.outline.summary}
Full script: ${input.outline.fullScript}
Scene number: ${input.scene.sceneNumber}
Scene title: ${input.scene.title}
Scene narration: ${input.scene.narration}
Original visual prompt: ${input.scene.visualPrompt}
Previous scene HTML:
${input.previousSceneHtml?.trim() || "N/A"}

Current scene HTML:
${input.currentSceneHtml?.trim() || "N/A"}

User revision request:
${input.revisionRequest}`,
    0.35,
    true,
  );

  const html = typeof payload.html === "string" ? payload.html.trim() : "";
  if (!html || !html.includes("<html")) {
    throw new Error("AI returned invalid revised HTML scene code");
  }

  return {
    html,
    summary: typeof payload.summary === "string" ? payload.summary.trim() : "",
  };
}

export async function generateInsertedScene(input: {
  mode: VideoMode;
  fullScript: string;
  scenes: VideoOutlineScene[];
  userRequest: string;
  insertAfterScene?: number;
  globalVisualStylePrompt?: string;
  htmlVideoStyleName?: string;
}) {
  const { baseUrl, apiKey, model } = getModelConfig();

  if (!baseUrl || !apiKey) {
    throw new Error("Missing OPENAI_BASE_URL or OPENAI_API_KEY");
  }

  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const sceneList = input.scenes
    .map((scene) => `Scene ${scene.sceneNumber}\nTitle: ${scene.title}\nNarration: ${scene.narration}\nVisual: ${scene.visualPrompt}`)
    .join("\n\n");

  const payload = await requestChatJson(
    endpoint,
    apiKey,
    model,
    `You create one new scene to insert into an existing video outline.
Return JSON only in the shape {"insertAfterScene":0,"title":"","narration":"","visualPrompt":""}.
Requirements:
1. Generate exactly one new scene.
2. insertAfterScene must be an integer between 0 and the current scene count.
3. If the caller already gives a non-zero insertAfterScene, keep that exact position.
4. narration should be natural Chinese voice-over text.
5. visualPrompt should match the current video mode. For html mode, write it as an HTML animation implementation prompt. For slideshow mode, write it as an image-generation prompt.
6. For html mode, prefer concise on-screen copy, clear subtitle-safe space near the bottom, and key-message extraction instead of pasting long narration into the frame.
7. Keep the new scene coherent with the existing script and scene flow.`,
    `Video mode: ${input.mode}
Current full script:
${input.fullScript}

Current scene outline:
${sceneList}

Global visual style:
${input.globalVisualStylePrompt ?? "N/A"}

HTML style name:
${input.htmlVideoStyleName ?? "N/A"}

Requested insertAfterScene:
${typeof input.insertAfterScene === "number" ? input.insertAfterScene : 0}

User request for the new scene:
${input.userRequest}`,
    0.35,
    true,
  );

  const insertAfterScene =
    typeof payload.insertAfterScene === "number" && Number.isInteger(payload.insertAfterScene) && payload.insertAfterScene >= 0
      ? payload.insertAfterScene
      : 0;
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const narration = typeof payload.narration === "string" ? payload.narration.trim() : "";
  const visualPrompt = typeof payload.visualPrompt === "string" ? payload.visualPrompt.trim() : "";

  if (!title || !narration || !visualPrompt) {
    throw new Error("AI returned an invalid inserted scene payload");
  }

  return {
    insertAfterScene,
    title,
    narration: sanitizeNarrationLead(narration),
    visualPrompt,
  } satisfies InsertedSceneDraft;
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
