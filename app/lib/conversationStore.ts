import { ResultSetHeader, RowDataPacket } from "mysql2";
import { getMysqlPool } from "@/app/lib/db";
import type { IntentAnalysis, VideoOutline } from "@/app/lib/videoAgent";

export type AssistantPayload = {
  intent?: IntentAnalysis | null;
  outline?: VideoOutline | null;
  confirmation?: {
    type: "regenerate_video_outline";
    originalPrompt: string;
    revisionRequest: string;
  } | null;
};

export type ConversationMessage = {
  id: string;
  projectId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  intentAction?: string | null;
  intentReason?: string | null;
  intentPayload?: AssistantPayload | null;
};

type ConversationRow = RowDataPacket & {
  id: number;
  project_id: string;
  role: "user" | "assistant";
  content: string;
  intent_action: string | null;
  intent_reason: string | null;
  intent_payload: AssistantPayload | string | null;
  created_at: Date;
};

function mapConversationRow(row: ConversationRow): ConversationMessage {
  let intentPayload: AssistantPayload | null = null;

  if (typeof row.intent_payload === "string") {
    try {
      intentPayload = JSON.parse(row.intent_payload) as AssistantPayload;
    } catch {
      intentPayload = null;
    }
  } else if (row.intent_payload && typeof row.intent_payload === "object") {
    intentPayload = row.intent_payload as AssistantPayload;
  }

  return {
    id: String(row.id),
    projectId: row.project_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at.toISOString(),
    intentAction: row.intent_action,
    intentReason: row.intent_reason,
    intentPayload,
  };
}

export async function getMessageById(id: string) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId < 1) {
    return null;
  }

  const pool = getMysqlPool();
  const [rows] = await pool.execute<ConversationRow[]>(
    `SELECT id, project_id, role, content, intent_action, intent_reason, intent_payload, created_at
     FROM video_agent_chat_messages
     WHERE id = :id
     LIMIT 1`,
    { id: numericId },
  );

  return rows[0] ? mapConversationRow(rows[0]) : null;
}

export async function listMessages(projectId: string) {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<ConversationRow[]>(
    `SELECT id, project_id, role, content, intent_action, intent_reason, intent_payload, created_at
     FROM video_agent_chat_messages
     WHERE project_id = :projectId
     ORDER BY created_at ASC, id ASC`,
    { projectId },
  );

  return rows.map(mapConversationRow);
}

export async function addMessage(input: {
  projectId: string;
  role: "user" | "assistant";
  content: string;
  intentAction?: string | null;
  intentReason?: string | null;
  intentPayload?: AssistantPayload | null;
}) {
  const pool = getMysqlPool();
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO video_agent_chat_messages (
      project_id,
      role,
      content,
      intent_action,
      intent_reason,
      intent_payload
    ) VALUES (
      :projectId,
      :role,
      :content,
      :intentAction,
      :intentReason,
      :intentPayload
    )`,
    {
      projectId: input.projectId,
      role: input.role,
      content: input.content,
      intentAction: input.intentAction ?? null,
      intentReason: input.intentReason ?? null,
      intentPayload: input.intentPayload ? JSON.stringify(input.intentPayload) : null,
    },
  );

  const [rows] = await pool.execute<ConversationRow[]>(
    `SELECT id, project_id, role, content, intent_action, intent_reason, intent_payload, created_at
     FROM video_agent_chat_messages
     WHERE id = :id
     LIMIT 1`,
    { id: result.insertId },
  );

  return rows[0] ? mapConversationRow(rows[0]) : null;
}
