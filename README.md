# VisionAgentV2

VisionAgentV2 是一个基于 Next.js 15 构建的 AI 视频创作应用，面向“脚本生成 + 分镜规划 + 素材组织 + 页面式视频展示”的创作流程。项目目前同时支持图片轮播视频模式和 HTML 动画视频模式，并包含基础的用户注册、登录与会话能力。

## 项目特点

- 支持两种创作模式：
  - `slideshow`：图片轮播模式
  - `html`：HTML 动画模式
- 支持创建视频项目，并保存项目标题、分镜大纲和视频源数据
- 支持 AI 对话式驱动创作流程
- 支持按项目保存对话历史和意图分析结果
- 支持用户注册、登录、退出和会话校验
- 支持多种 HTML 视频风格模板
- 支持前端录制 HTML 动画并导出 MP4

## 技术栈

- Next.js 15
- React 19
- TypeScript
- MySQL
- `mysql2`
- `lucide-react`
- `mp4-muxer`

## 当前目录结构

```text
.
├─ app/
│  ├─ api/
│  │  ├─ auth/                         # 登录、注册、退出、会话接口
│  │  ├─ projects/                     # 项目创建、查询、删除接口
│  │  └─ video-agent/messages/         # AI 对话消息接口
│  ├─ create/                          # 创作工作台页面
│  ├─ lib/
│  │  ├─ auth.ts                       # 密码哈希、会话签名
│  │  ├─ db.ts                         # MySQL 连接池
│  │  ├─ htmlVideoMp4Recorder.ts       # HTML 视频导出
│  │  ├─ htmlVideoStyles/              # HTML 视频风格模板
│  │  ├─ projectStore.ts               # 项目数据读写
│  │  ├─ conversationStore.ts          # 对话历史读写
│  │  ├─ userStore.ts                  # 用户数据读写
│  │  ├─ videoAgent.ts                 # 视频 Agent 相关逻辑
│  │  └─ videoSource.ts                # 分镜素材映射
│  ├─ page.tsx                         # 首页
│  └─ globals.css                      # 全局样式
├─ database/
│  ├─ projects.sql
│  ├─ users.sql
│  └─ video_agent_chat_messages.sql
├─ package.json
└─ README.md
```

## 环境要求

- Node.js 18.18+ 或 20+
- npm 9+
- MySQL 8.x

## 环境变量

在项目根目录创建 `.env` 文件，至少配置以下内容：

```env
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=vision_agent

AUTH_SECRET=replace_with_a_long_random_secret
```

说明：

- `MYSQL_*` 用于服务端连接 MySQL
- `AUTH_SECRET` 用于签名登录态 Cookie
- 如果未设置 `AUTH_SECRET`，代码会退回到开发默认值，不建议在线上环境使用

## 数据库初始化

1. 创建数据库，例如：

```sql
CREATE DATABASE vision_agent CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

2. 依次执行以下 SQL 文件：

- [database/projects.sql](/E:/project/VisionAgentV2/database/projects.sql)
- [database/users.sql](/E:/project/VisionAgentV2/database/users.sql)
- [database/video_agent_chat_messages.sql](/E:/project/VisionAgentV2/database/video_agent_chat_messages.sql)

## 本地启动

1. 安装依赖

```bash
npm install
```

2. 启动开发环境

```bash
npm run dev
```

3. 打开浏览器访问：

```text
http://localhost:3000
```

## 可用脚本

```bash
npm run dev
npm run build
npm run start
npm run lint
```

## 主要页面与能力

### 首页

- 选择创作模式
- 发起项目创建
- 用户登录 / 注册 / 退出

### 创作工作台

- 基于文本提示生成视频大纲
- 展示完整脚本、分镜、旁白与素材信息
- 支持 HTML 视频风格选择
- 支持项目内对话式迭代修改
- 支持导出 HTML 动画视频

## API 概览

目前仓库中已包含以下主要接口：

- `GET /api/projects`：获取项目列表
- `POST /api/projects`：创建项目
- `DELETE /api/projects?projectId=...`：删除项目
- `GET /api/video-agent/messages?projectId=...`：获取项目消息
- `POST /api/video-agent/messages`：发送创作消息并驱动 Agent
- `POST /api/auth/register`：注册
- `POST /api/auth/login`：登录
- `POST /api/auth/logout`：退出登录
- `GET /api/auth/session`：获取当前会话

## 注意事项

- 当前仓库已包含 `node_modules` 和 `.next` 目录，但正常协作时通常不建议提交这些构建产物或依赖目录
- 项目中的部分文案和逻辑仍在持续迭代，README 会随着功能完善继续更新
- 如果后续接入外部 AI 模型服务，建议在 README 中补充对应的模型配置和调用说明

## 后续可补充内容

- 部署说明
- 生产环境配置建议
- AI 模型接入方式
- 截图 / 演示视频
- 接口鉴权与错误码说明
