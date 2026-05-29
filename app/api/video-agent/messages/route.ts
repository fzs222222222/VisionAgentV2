import { NextRequest, NextResponse } from "next/server";
import { addMessage, listMessages } from "@/app/lib/conversationStore";
import { getProject, updateProject } from "@/app/lib/projectStore";
import { analyzeUserIntent, generateVideoOutline, runIntentAction, VideoMode } from "@/app/lib/videoAgent";

const projectModes: VideoMode[] = ["slideshow", "html"];

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json({ error: "缺少 projectId" }, { status: 400 });
  }

  return NextResponse.json({ messages: await listMessages(projectId) });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  const mode = typeof body?.mode === "string" ? body.mode : "";

  if (!projectId || !content) {
    return NextResponse.json({ error: "projectId 和 content 不能为空" }, { status: 400 });
  }

  if (!projectModes.includes(mode as VideoMode)) {
    return NextResponse.json({ error: "mode 不正确" }, { status: 400 });
  }

  const currentProject = await getProject(projectId);
  if (!currentProject) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  await addMessage({ projectId, role: "user", content });

  try {
    const intent = await analyzeUserIntent(content);
    let assistantContent = runIntentAction(intent);
    let updatedProject = currentProject;
    let outline = null;

    if (intent.action === "generate_video_outline" || intent.action === "regenerate_video_outline") {
      outline = await generateVideoOutline(content, mode as VideoMode);
      assistantContent = `已生成视频大纲，共 ${outline.scenes.length} 个分镜。你可以先在卡片里快速浏览，再查看完整大纲内容。`;

      updatedProject =
        (await updateProject({
          uuid: projectId,
          type: mode as VideoMode,
          outlineContent: JSON.stringify(outline),
        })) ?? currentProject;
    } else if (currentProject.type !== mode) {
      updatedProject =
        (await updateProject({
          uuid: projectId,
          type: mode as VideoMode,
        })) ?? currentProject;
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
    console.error("处理视频创作消息失败", error);
    const details = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "处理视频创作消息失败", details }, { status: 500 });
  }
}
