import { NextRequest, NextResponse } from "next/server";
import { createProject, deleteProject, listProjects, ProjectType } from "@/app/lib/projectStore";

const projectTypes: ProjectType[] = ["slideshow", "html"];

export async function GET() {
  try {
    const projects = await listProjects();
    return NextResponse.json({ projects });
  } catch (error) {
    console.error("加载项目列表失败", error);
    return NextResponse.json({ error: "加载项目列表失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const type = typeof body?.type === "string" ? body.type : "";

  if (!projectTypes.includes(type as ProjectType)) {
    return NextResponse.json({ error: "项目类型不正确" }, { status: 400 });
  }

  try {
    const project = await createProject(type as ProjectType);
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    console.error("创建项目失败", error);
    return NextResponse.json({ error: "创建项目失败" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId")?.trim() ?? "";

  if (!projectId) {
    return NextResponse.json({ error: "缺少 projectId" }, { status: 400 });
  }

  try {
    const deleted = await deleteProject(projectId);

    if (!deleted) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("删除项目失败", error);
    return NextResponse.json({ error: "删除项目失败" }, { status: 500 });
  }
}
