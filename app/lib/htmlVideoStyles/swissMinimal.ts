import { HtmlVideoStyle } from "./types";

export const swissMinimalStyle: HtmlVideoStyle = {
  id: "swiss-minimal",
  name: "Swiss High-Contrast Kinetic",
  nameZh: "瑞士高对比动效",
  tagline: "暖白纸感底色、黑橙几何排版、克制但有力量的 kinetic typography。",
  stylePrompt:
    "HTML video visual style baseline: Swiss High-Contrast Kinetic. Use a matte warm-sand background (#F6F5F0), charcoal-black typography and structural lines (#0C0C0C), and safety orange highlights (#FF5E1E). Avoid gradients, glow, soft shadows, glass effects, or visual clutter. Typography should be bold, tightly tracked, and scale-dominant, with strong hierarchy and generous negative space. Compose scenes with asymmetric Swiss or Bauhaus-inspired geometry, solid blocks, thick rules, numeric anchors, and masked text containers rather than decorative cards. Motion should rely on premium masked slide-ups, brisk spring-like offsets, fast line scaling, hold-and-snap loops, and a clean editorial rhythm. Keep copy editorial and restrained: one headline, one short support line, and strong empty space are preferred over multiple dense text modules. Preserve a clean subtitle-safe band in the bottom 18% of the frame unless a deliberate lower-third composition is required.",
  displayPromptZh:
    "HTML 视频视觉基线：瑞士高对比动势排版。整体采用温暖砂岩白背景（#F6F5F0）、炭黑文字与结构线（#0C0C0C），再用安全橙（#FF5E1E）做强调。避免渐变、发光、柔和阴影、玻璃质感和多余装饰。排版要大胆、紧凑、尺度感强，通过清晰层级和大面积留白建立高级感。构图可参考瑞士平面或包豪斯几何，使用实色块、粗线、数字锚点和遮罩文字容器，而不是常规卡片。动画应以干净利落的遮罩滑入、轻弹位移、快速线条伸展和停顿后再收束的节奏为主，整体呈现克制、理性、编辑感强的动态视觉。",
  demoHtml: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #F6F5F0; color: #0C0C0C; font-family: "Segoe UI", Arial, sans-serif; }
  body { position: relative; }
  .line {
    position: absolute;
    left: 7%;
    right: 7%;
    top: 16%;
    height: 6px;
    background: #0C0C0C;
    transform-origin: left center;
    animation: grow 2.8s infinite cubic-bezier(.2,.8,.2,1);
  }
  .serial {
    position: absolute;
    left: 7%;
    bottom: 12%;
    font-size: 70px;
    font-weight: 900;
    color: #FF5E1E;
    line-height: 1;
  }
  .mask {
    position: absolute;
    left: 7%;
    top: 26%;
    width: 62%;
    height: 92px;
    overflow: hidden;
  }
  .title {
    font-size: 54px;
    font-weight: 900;
    line-height: .95;
    transform: translateY(100%);
    animation: rise 2.8s infinite cubic-bezier(.2,.8,.2,1);
  }
  .sub {
    position: absolute;
    left: 7%;
    top: 61%;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: .28em;
  }
  .sub::before {
    content: "";
    width: 58px;
    height: 8px;
    background: #FF5E1E;
  }
  .block {
    position: absolute;
    right: 8%;
    top: 24%;
    width: 16%;
    height: 52%;
    background: #0C0C0C;
  }
  .dot {
    position: absolute;
    right: 8%;
    bottom: 16%;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #FF5E1E;
    animation: pulse 1.4s infinite;
  }
  @keyframes grow { 0%,100% { transform: scaleX(.18); } 35%,70% { transform: scaleX(1); } }
  @keyframes rise { 0%,18% { transform: translateY(100%); } 30%,72% { transform: translateY(0); } 100% { transform: translateY(-2%); } }
  @keyframes pulse { 50% { transform: scale(1.2); } }
</style>
</head>
<body>
  <div class="line"></div>
  <div class="mask"><div class="title">DESIGN<br/>SYSTEM</div></div>
  <div class="block"></div>
  <div class="sub">EDITORIAL MOTION</div>
  <div class="serial">01</div>
  <div class="dot"></div>
</body>
</html>`,
};
