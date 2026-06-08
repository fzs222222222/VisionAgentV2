import { NextRequest, NextResponse } from "next/server";
import { addMessage, getMessageById, listMessages } from "@/app/lib/conversationStore";
import { insertGeneratedSceneAndAssets, regenerateSceneVisualByInstruction } from "@/app/api/projects/[projectId]/scene-images/route";
import { DEFAULT_HTML_VIDEO_STYLE_ID, getHtmlVideoStyle, type HtmlVideoStyleId } from "@/app/lib/htmlVideoStyles";
import { buildProjectTitleFromPrompt, getProject, updateProject } from "@/app/lib/projectStore";
import {
  analyzeUserIntent,
  generateInsertedScene,
  generateVideoOutline,
  runIntentAction,
  type IntentAnalysis,
  type VideoOutline,
  type VideoMode,
} from "@/app/lib/videoAgent";
import { getSceneAudioMap, getSceneHtmlMap, getSceneImageMap } from "@/app/lib/videoSource";

type OutlineScene = {
  sceneNumber: number;
  title: string;
  narration: string;
  visualPrompt: string;
};

type StoredOutline = {
  title: string;
  summary: string;
  fullScript: string;
  mode: VideoMode;
  promptKind: "image" | "html";
  globalVisualStylePrompt?: string;
  htmlVideoStyleId?: string;
  htmlVideoStyleName?: string;
  scenes: OutlineScene[];
};

const projectModes: VideoMode[] = ["slideshow", "html"];

function parseOutlineContent(content: string) {
  if (!content.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(content) as StoredOutline;
    return Array.isArray(parsed?.scenes) ? parsed : null;
  } catch {
    return null;
  }
}

function hasGeneratedSceneAssets(videoSource: string) {
  return (
    Object.keys(getSceneImageMap(videoSource)).length > 0 ||
    Object.keys(getSceneHtmlMap(videoSource)).length > 0 ||
    Object.keys(getSceneAudioMap(videoSource)).length > 0
  );
}

function hasExplicitSceneReference(content: string) {
  const normalized = content.replace(/\s+/g, "");
  return /(第?[0-9一二三四五六七八九十百两]+个?(分镜|镜头|场景|画面|页面|片段))/.test(normalized);
}

function parseChineseNumber(value: string): number | null {
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }

  const digitMap: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };

  if (normalized === "十") {
    return 10;
  }

  const hundredIndex = normalized.indexOf("百");
  if (hundredIndex >= 0) {
    const hundreds = digitMap[normalized.slice(0, hundredIndex)] ?? 1;
    const remainder = parseChineseNumber(normalized.slice(hundredIndex + 1));
    return hundreds * 100 + (remainder || 0);
  }

  const tenIndex = normalized.indexOf("十");
  if (tenIndex >= 0) {
    const tensPrefix = normalized.slice(0, tenIndex);
    const onesSuffix = normalized.slice(tenIndex + 1);
    const tens = tensPrefix ? digitMap[tensPrefix] ?? 0 : 1;
    const ones = onesSuffix ? digitMap[onesSuffix] ?? 0 : 0;
    return tens * 10 + ones;
  }

  return digitMap[normalized] ?? null;
}

function parseExplicitSceneNumber(content: string) {
  const normalized = content.replace(/\s+/g, "");
  const matched = normalized.match(/第?([0-9一二三四五六七八九十百两]+)个?(分镜|镜头|场景|画面|页面|片段)/);
  if (!matched) {
    return null;
  }

  const value = parseChineseNumber(matched[1]);
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function parseExplicitInsertAfterScene(content: string) {
  const normalized = content.replace(/\s+/g, "");
  const matched = normalized.match(/第?([0-9一二三四五六七八九十百两]+)个?(分镜|镜头|场景|画面|页面|片段)(后面|后边|之后)/);
  if (!matched) {
    return null;
  }

  const value = parseChineseNumber(matched[1]);
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function insertSceneIntoOutlineScenes(scenes: OutlineScene[], insertAfterScene: number, nextScene: Omit<OutlineScene, "sceneNumber">) {
  const insertIndex = Math.max(0, Math.min(insertAfterScene, scenes.length));
  const items = scenes.map((scene) => ({ ...scene }));
  items.splice(insertIndex, 0, {
    sceneNumber: insertIndex + 1,
    title: nextScene.title,
    narration: nextScene.narration,
    visualPrompt: nextScene.visualPrompt,
  });

  return items.map((scene, index) => ({
    ...scene,
    sceneNumber: index + 1,
  }));
}

function shouldPromoteSceneRegenerationToOutline(content: string, intent: IntentAnalysis, hasOutline: boolean) {
  if (!hasOutline || intent.action !== "regenerate_scene") {
    return false;
  }

  if (hasExplicitSceneReference(content)) {
    return false;
  }

  const normalized = content.replace(/\s+/g, "");
  return /(开头|开场|前面|前半段|结尾|结局|整体|全片|大纲|脚本|旁白|口播|节奏|风格|结构|逻辑|主线|吸引力|短视频平台|前3秒|前三秒)/.test(
    normalized,
  );
}

function buildOutlineRegenerationPrompt(input: {
  originalPrompt: string;
  currentOutline: StoredOutline;
  revisionRequest: string;
}) {
  const scenesBlock = input.currentOutline.scenes
    .map((scene) =>
      [
        `分镜 ${scene.sceneNumber}: ${scene.title}`,
        `旁白：${scene.narration}`,
        `画面提示词：${scene.visualPrompt}`,
      ].join("\n"),
    )
    .join("\n\n");

  const globalStyleBlock = input.currentOutline.globalVisualStylePrompt?.trim()
    ? `当前全局视觉风格提示词：\n${input.currentOutline.globalVisualStylePrompt.trim()}\n\n`
    : "";

  return `你正在根据已有视频大纲进行整体改稿，请保留原始主题和核心目标，并重点落实新的修改需求。

原始用户提示词：
${input.originalPrompt}

当前已有视频大纲标题：
${input.currentOutline.title}

当前已有视频大纲概述：
${input.currentOutline.summary}

当前完整旁白稿：
${input.currentOutline.fullScript}

${globalStyleBlock}当前分镜大纲：
${scenesBlock}

用户这次提出的新修改需求：
${input.revisionRequest}`;
}

function getFirstUserPrompt(messages: Awaited<ReturnType<typeof listMessages>>, fallback: string) {
  return messages.find((message) => message.role === "user")?.content.trim() || fallback;
}

function resolveHtmlVideoStyleId(mode: VideoMode, currentOutline: StoredOutline | null, htmlVideoStyleId: string) {
  if (mode !== "html") {
    return undefined;
  }

  const preferredStyleId =
    (typeof currentOutline?.htmlVideoStyleId === "string" && currentOutline.htmlVideoStyleId) ||
    htmlVideoStyleId ||
    DEFAULT_HTML_VIDEO_STYLE_ID;

  return getHtmlVideoStyle(preferredStyleId).id;
}

async function finalizeOutlineUpdate(input: {
  projectId: string;
  currentProject: NonNullable<Awaited<ReturnType<typeof getProject>>>;
  mode: VideoMode;
  outlinePrompt: string;
  originalPrompt: string;
  htmlVideoStyleId: string;
  currentOutline: StoredOutline | null;
  successMessage: string;
}) {
  const outline = await generateVideoOutline(input.outlinePrompt, input.mode, {
    htmlVideoStyleId: resolveHtmlVideoStyleId(input.mode, input.currentOutline, input.htmlVideoStyleId),
  });

  const nextTitle =
    buildProjectTitleFromPrompt(input.originalPrompt, outline.title) ||
    buildProjectTitleFromPrompt(outline.title, input.currentProject?.title) ||
    input.currentProject?.title ||
    outline.title;

  const updatedProject =
    (await updateProject({
      uuid: input.projectId,
      title: nextTitle,
      type: input.mode,
      outlineContent: JSON.stringify(outline),
      videoSource: "",
    })) ?? input.currentProject;

  return {
    outline,
    updatedProject,
    assistantContent: input.successMessage.replace("{count}", String(outline.scenes.length)),
  };
}

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json({ error: "missing projectId" }, { status: 400 });
  }

  return NextResponse.json({ messages: await listMessages(projectId) });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  const mode = typeof body?.mode === "string" ? body.mode : "";
  const htmlVideoStyleId = typeof body?.htmlVideoStyleId === "string" ? body.htmlVideoStyleId.trim() : "";
  const confirmationMessageId = typeof body?.confirmationMessageId === "string" ? body.confirmationMessageId.trim() : "";

  if (!projectId || (!content && !confirmationMessageId)) {
    return NextResponse.json({ error: "projectId and request content are required" }, { status: 400 });
  }

  if (!projectModes.includes(mode as VideoMode)) {
    return NextResponse.json({ error: "invalid mode" }, { status: 400 });
  }

  const currentProject = await getProject(projectId);
  if (!currentProject) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  try {
    let intent: IntentAnalysis;
    let outline: VideoOutline | null = null;
    let updatedProject = currentProject;
    let assistantContent = "";

    if (confirmationMessageId) {
      const confirmationMessage = await getMessageById(confirmationMessageId);
      const confirmation = confirmationMessage?.intentPayload?.confirmation;
      const projectMessages = await listMessages(projectId);
      const latestMessageId = projectMessages[projectMessages.length - 1]?.id ?? "";

      if (
        !confirmationMessage ||
        confirmationMessage.projectId !== projectId ||
        confirmationMessage.role !== "assistant" ||
        confirmationMessage.id !== latestMessageId ||
        confirmation?.type !== "regenerate_video_outline" ||
        !confirmation.originalPrompt.trim() ||
        !confirmation.revisionRequest.trim()
      ) {
        return NextResponse.json({ error: "confirmation request is missing or expired" }, { status: 400 });
      }

      const currentOutline = parseOutlineContent(currentProject.outlineContent);
      if (!currentOutline) {
        return NextResponse.json({ error: "current project outline is missing" }, { status: 400 });
      }

      intent = {
        action: "regenerate_video_outline" as const,
        reason: "user confirmed replacing existing generated scene assets before regenerating the outline",
        targetScene: null,
      };

      const result = await finalizeOutlineUpdate({
        projectId,
        currentProject,
        mode: currentProject.type,
        outlinePrompt: buildOutlineRegenerationPrompt({
          originalPrompt: confirmation.originalPrompt,
          currentOutline,
          revisionRequest: confirmation.revisionRequest,
        }),
        originalPrompt: confirmation.originalPrompt,
        htmlVideoStyleId,
        currentOutline,
        successMessage: "已重新生成视频大纲，共 {count} 个分镜。原有分镜画面和旁白资源已按新大纲重置。",
      });

      outline = result.outline;
      updatedProject = result.updatedProject;
      assistantContent = result.assistantContent;
    } else {
      await addMessage({ projectId, role: "user", content });

      const analyzedIntent = await analyzeUserIntent(content);
      const shouldFallbackToGenerateOutline =
        analyzedIntent.action === "unsupported" &&
        !currentProject.outlineContent.trim() &&
        Boolean(content.trim());

      intent = shouldFallbackToGenerateOutline
        ? {
            action: "generate_video_outline" as const,
            reason: "current project has no outline yet, so treat this request as outline generation",
            targetScene: null,
          }
        : analyzedIntent;

      if (intent.action === "regenerate_scene" && !intent.targetScene) {
        const parsedSceneNumber = parseExplicitSceneNumber(content);
        if (parsedSceneNumber) {
          intent = {
            ...intent,
            targetScene: parsedSceneNumber,
          };
        }
      }

      if (intent.action === "add_scene") {
        const parsedInsertAfterScene = parseExplicitInsertAfterScene(content);
        intent = {
          ...intent,
          targetScene: parsedInsertAfterScene ?? (typeof intent.targetScene === "number" ? intent.targetScene : 0),
        };
      }

      const currentOutline = parseOutlineContent(currentProject.outlineContent);
      if (shouldPromoteSceneRegenerationToOutline(content, intent, currentOutline !== null)) {
        intent = {
          action: "regenerate_video_outline",
          reason: "request changes the opening or overall pacing/style without explicitly naming a single scene",
          targetScene: null,
        };
      }

      const existingMessages = await listMessages(projectId);
      const originalPrompt = getFirstUserPrompt(existingMessages, content);
      const needsRegenerateConfirmation =
        intent.action === "regenerate_video_outline" &&
        currentOutline !== null &&
        hasGeneratedSceneAssets(currentProject.videoSource);

      if (needsRegenerateConfirmation) {
        assistantContent = "当前已有部分分镜画面或旁白音频，重新生成视频大纲会覆盖这些已生成数据。确认后我再继续处理。";

        await addMessage({
          projectId,
          role: "assistant",
          content: assistantContent,
          intentAction: intent.action,
          intentReason: intent.reason,
          intentPayload: {
            intent,
            confirmation: {
              type: "regenerate_video_outline",
              originalPrompt,
              revisionRequest: content,
            },
          },
        });

        return NextResponse.json({
          messages: await listMessages(projectId),
          intent,
          project: updatedProject,
        });
      }

      assistantContent = shouldFallbackToGenerateOutline
        ? "已根据当前主题自动进入视频大纲生成流程。"
        : runIntentAction(intent);

      if (intent.action === "generate_video_outline" || intent.action === "regenerate_video_outline") {
        const result = await finalizeOutlineUpdate({
          projectId,
          currentProject,
          mode: mode as VideoMode,
          outlinePrompt:
            intent.action === "regenerate_video_outline" && currentOutline
              ? buildOutlineRegenerationPrompt({
                  originalPrompt,
                  currentOutline,
                  revisionRequest: content,
                })
              : content,
          originalPrompt,
          htmlVideoStyleId,
          currentOutline,
          successMessage:
            intent.action === "regenerate_video_outline"
              ? "已重新生成视频大纲，共 {count} 个分镜。你可以先在卡片里快速浏览，再查看完整大纲内容。"
              : "已生成视频大纲，共 {count} 个分镜。你可以先在卡片里快速浏览，再查看完整大纲内容。",
        });

        outline = result.outline;
        updatedProject = result.updatedProject;
        assistantContent = result.assistantContent;
      } else if (intent.action === "regenerate_scene") {
        if (!currentOutline) {
          throw new Error("current project outline is missing");
        }

        if (!intent.targetScene) {
          assistantContent = "请明确要调整的分镜编号，当前暂不支持一次调整多个分镜。";
        } else {
          const result = await regenerateSceneVisualByInstruction({
            projectId,
            projectVideoSource: currentProject.videoSource,
            outline: {
              title: currentOutline.title,
              summary: currentOutline.summary,
              fullScript: currentOutline.fullScript,
              globalVisualStylePrompt: currentOutline.globalVisualStylePrompt,
              htmlVideoStyleId: (currentOutline.htmlVideoStyleId as HtmlVideoStyleId | undefined) || undefined,
              htmlVideoStyleName: currentOutline.htmlVideoStyleName,
              promptKind: currentOutline.promptKind,
              scenes: currentOutline.scenes,
            },
            sceneNumber: intent.targetScene,
            revisionRequest: content,
            htmlVideoStyleId,
          });

          updatedProject = result.updatedProject ?? currentProject;
          assistantContent = `第 ${intent.targetScene} 个分镜画面已按你的要求重新生成完成。`;
        }
      } else if (intent.action === "add_scene") {
        if (!currentOutline) {
          throw new Error("current project outline is missing");
        }

        const generatedScene = await generateInsertedScene({
          mode: currentProject.type,
          fullScript: currentOutline.fullScript,
          scenes: currentOutline.scenes,
          userRequest: content,
          insertAfterScene: typeof intent.targetScene === "number" ? intent.targetScene : 0,
          globalVisualStylePrompt: currentOutline.globalVisualStylePrompt,
          htmlVideoStyleName: currentOutline.htmlVideoStyleName,
        });
        const resolvedInsertAfterScene =
          typeof intent.targetScene === "number" && intent.targetScene > 0 ? intent.targetScene : generatedScene.insertAfterScene;
        const boundedInsertAfterScene = Math.max(0, Math.min(resolvedInsertAfterScene, currentOutline.scenes.length));
        const nextScenes = insertSceneIntoOutlineScenes(currentOutline.scenes, boundedInsertAfterScene, {
          title: generatedScene.title,
          narration: generatedScene.narration,
          visualPrompt: generatedScene.visualPrompt,
        });
        const sceneNumber = boundedInsertAfterScene + 1;
        const nextOutline = {
          ...currentOutline,
          scenes: nextScenes,
        };
        const nextProject =
          (await updateProject({
            uuid: projectId,
            outlineContent: JSON.stringify(nextOutline),
          })) ?? currentProject;
        const insertedScene = nextScenes.find((scene) => scene.sceneNumber === sceneNumber);
        if (!insertedScene) {
          throw new Error("inserted scene was not created");
        }

        const assetResult = await insertGeneratedSceneAndAssets({
          projectId,
          videoSource: currentProject.videoSource,
          outline: {
            title: nextOutline.title,
            summary: nextOutline.summary,
            fullScript: nextOutline.fullScript,
            globalVisualStylePrompt: nextOutline.globalVisualStylePrompt,
            htmlVideoStyleId: (nextOutline.htmlVideoStyleId as HtmlVideoStyleId | undefined) || undefined,
            htmlVideoStyleName: nextOutline.htmlVideoStyleName,
            promptKind: nextOutline.promptKind,
            scenes: nextOutline.scenes,
          },
          newScene: insertedScene,
          insertAfterScene: boundedInsertAfterScene,
          htmlVideoStyleId,
        });

        updatedProject = assetResult.updatedProject ?? nextProject;
        outline = nextOutline as VideoOutline;
        assistantContent = `已新增第 ${sceneNumber} 个分镜，并完成画面与旁白生成。`;
      } else if (currentProject.type !== mode) {
        updatedProject =
          (await updateProject({
            uuid: projectId,
            type: mode as VideoMode,
          })) ?? currentProject;
      }
    }

    await addMessage({
      projectId,
      role: "assistant",
      content: assistantContent,
      intentAction: intent.action,
      intentReason: intent.reason,
      intentPayload: {
        intent,
        outline,
      },
    });

    return NextResponse.json({
      messages: await listMessages(projectId),
      intent,
      project: updatedProject,
    });
  } catch (error) {
    console.error("handle video agent message failed", error);
    const details = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "failed to process video agent message", details }, { status: 500 });
  }
}
