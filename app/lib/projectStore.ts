import { ResultSetHeader, RowDataPacket } from "mysql2";
import { getMysqlPool } from "@/app/lib/db";

export type ProjectType = "slideshow" | "html";

export type Project = {
  uuid: string;
  title: string;
  type: ProjectType;
  outlineContent: string;
  videoSource: string;
  createdAt: string;
};

type ProjectRow = RowDataPacket & {
  uuid: string;
  title: string;
  type: ProjectType;
  outline_content: string | null;
  video_source: string | null;
  created_at: Date;
};

const typeTitle: Record<ProjectType, string> = {
  slideshow: "图片轮播视频项目",
  html: "HTML 动画视频项目",
};

function mapProject(row: ProjectRow): Project {
  return {
    uuid: row.uuid,
    title: row.title,
    type: row.type,
    outlineContent: row.outline_content ?? "",
    videoSource: row.video_source ?? "",
    createdAt: row.created_at.toISOString(),
  };
}

export async function createProject(type: ProjectType) {
  const uuid = crypto.randomUUID();
  const title = `${typeTitle[type]} ${new Date().toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })}`;

  const pool = getMysqlPool();
  await pool.execute<ResultSetHeader>(
    `INSERT INTO projects (uuid, title, type, outline_content, video_source)
     VALUES (:uuid, :title, :type, '', '')`,
    { uuid, title, type },
  );

  return getProject(uuid);
}

export async function getProject(uuid: string) {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<ProjectRow[]>(
    `SELECT uuid, title, type, outline_content, video_source, created_at
     FROM projects
     WHERE uuid = :uuid
     LIMIT 1`,
    { uuid },
  );

  return rows[0] ? mapProject(rows[0]) : null;
}

export async function listProjects() {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<ProjectRow[]>(
    `SELECT uuid, title, type, outline_content, video_source, created_at
     FROM projects
     ORDER BY created_at DESC`,
  );

  return rows.map(mapProject);
}

export async function deleteProject(uuid: string) {
  const pool = getMysqlPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await connection.execute<ResultSetHeader>(
      `DELETE FROM video_agent_chat_messages
       WHERE project_id = :uuid`,
      { uuid },
    );
    const [result] = await connection.execute<ResultSetHeader>(
      `DELETE FROM projects
       WHERE uuid = :uuid
       LIMIT 1`,
      { uuid },
    );
    await connection.commit();

    return result.affectedRows > 0;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function updateProject(input: {
  uuid: string;
  type?: ProjectType;
  outlineContent?: string;
  videoSource?: string;
}) {
  const fields: string[] = [];
  const params: Record<string, string> = { uuid: input.uuid };

  if (input.type !== undefined) {
    fields.push("type = :type");
    params.type = input.type;
  }

  if (input.outlineContent !== undefined) {
    fields.push("outline_content = :outlineContent");
    params.outlineContent = input.outlineContent;
  }

  if (input.videoSource !== undefined) {
    fields.push("video_source = :videoSource");
    params.videoSource = input.videoSource;
  }

  if (fields.length === 0) {
    return getProject(input.uuid);
  }

  const pool = getMysqlPool();
  await pool.execute(
    `UPDATE projects
     SET ${fields.join(", ")}
     WHERE uuid = :uuid
     LIMIT 1`,
    params,
  );

  return getProject(input.uuid);
}
