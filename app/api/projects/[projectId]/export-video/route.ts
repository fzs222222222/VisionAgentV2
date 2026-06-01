import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/app/lib/projectStore";

function sanitizeSegment(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim();
}

function inferExtension(filename: string, mimeType: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".mp4")) return ".mp4";
  if (lower.endsWith(".webm")) return ".webm";
  if (mimeType.includes("mp4")) return ".mp4";
  return ".webm";
}

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  if (!projectId) {
    return NextResponse.json({ error: "projectId 不正确" }, { status: 400 });
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少导出视频文件" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!bytes.length) {
    return NextResponse.json({ error: "导出视频为空" }, { status: 400 });
  }

  const extension = inferExtension(file.name, file.type);
  const safeProjectTitle = sanitizeSegment(project.title || project.uuid) || project.uuid;
  const filename = `${safeProjectTitle}-${Date.now()}${extension}`;
  const projectDir = path.join(process.cwd(), "public", "generated-videos", projectId);
  const absolutePath = path.join(projectDir, filename);
  const relativePath = path.posix.join("generated-videos", projectId, filename);

  await mkdir(projectDir, { recursive: true });
  await writeFile(absolutePath, bytes);

  return NextResponse.json({
    filename,
    relativePath,
    publicUrl: `/${relativePath}`,
    mimeType: file.type || (extension === ".mp4" ? "video/mp4" : "video/webm"),
    size: bytes.length,
  });
}
