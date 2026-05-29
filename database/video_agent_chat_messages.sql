CREATE TABLE video_agent_chat_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键 ID',
  project_id VARCHAR(64) NOT NULL COMMENT '历史项目 ID',
  role ENUM('user', 'assistant') NOT NULL COMMENT '消息角色',
  content TEXT NOT NULL COMMENT '消息内容',
  intent_action VARCHAR(64) NULL COMMENT 'AI 识别的意图 action，仅系统消息可能有值',
  intent_reason TEXT NULL COMMENT 'AI 识别意图的理由，仅系统消息可能有值',
  intent_payload JSON NULL COMMENT 'AI 意图分析原始结构化结果',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  KEY idx_project_created_at (project_id, created_at),
  KEY idx_project_intent_action (project_id, intent_action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='视频创作 Agent 对话历史消息表';
