CREATE TABLE projects (
  uuid CHAR(36) NOT NULL COMMENT '项目 UUID',
  title VARCHAR(255) NOT NULL COMMENT '项目标题',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  type ENUM('slideshow', 'html') NOT NULL COMMENT '项目类型：slideshow=图片轮播，html=HTML动画',
  outline_content LONGTEXT NULL COMMENT '完整的分镜大纲内容',
  video_source LONGTEXT NULL COMMENT '视频源码',
  PRIMARY KEY (uuid),
  KEY idx_created_at (created_at),
  KEY idx_type_created_at (type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='视频创作项目表';
