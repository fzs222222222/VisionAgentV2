import { HtmlVideoStyle } from "./types";

export const retroAnalogStyle: HtmlVideoStyle = {
  id: "retro-analog",
  name: "CRT Analog Vector Radar",
  nameZh: "复古 CRT 雷达",
  tagline: "磷光绿黑底、扫描线与雷达扇区、强终端质感的复古监测界面。",
  stylePrompt:
    "HTML video visual style baseline: CRT Analog Vector Radar. Use a deep phosphorus green-black background (#010902) with luminous phosphor green lines and text (#39FF14) and amber alert accents (#FFB000). Typography should feel like a readable system terminal or vector monitor, using monospace emphasis and compact telemetry labeling. Add CRT scanlines, subtle radial distortion, vector circles, dashed monitor borders, and corner caps to evoke vintage radar or oscilloscope equipment. Motion should mimic analog sweep behavior with phosphor persistence, slow decay trails, blink-rate warnings, instant micro-glitches, and stable loop timing. Keep the result grounded, high-contrast, and unmistakably retro-electronic. Prefer sparse tactical labels, brief alert phrases, and data-glyph communication instead of long body copy. Keep the bottom 18% of the frame relatively clean as subtitle-safe space unless the composition explicitly calls for a controlled lower-third strip.",
  displayPromptZh:
    "HTML 视频视觉基线：复古 CRT 模拟矢量雷达。整体使用磷光绿黑背景（#010902），搭配明亮的磷光绿色线条与文字（#39FF14），并用琥珀橙（#FFB000）做告警强调。排版应像可读性很强的系统终端或矢量显示器，适合使用等宽字体和紧凑的遥测标签。画面可加入 CRT 扫描线、轻微径向畸变、矢量圆环、虚线边框和角标结构，唤起老式雷达或示波器设备的感觉。动画要模拟模拟电子设备的扫描与余辉，包括缓慢衰减拖尾、闪烁警示、瞬时微故障和稳定循环节奏，整体保持高对比、落地且具有强烈复古电子质感。",
  demoHtml: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #010902; color: #39FF14; font-family: Consolas, "Courier New", monospace; }
  body::before {
    content: "";
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(180deg, rgba(57,255,20,.08) 0 1px, transparent 1px 4px);
    pointer-events: none;
  }
  .frame {
    position: absolute;
    inset: 12px;
    border: 1px dashed rgba(57,255,20,.45);
  }
  .frame::before, .frame::after {
    content: "";
    position: absolute;
    width: 14px;
    height: 14px;
    border: 2px solid #39FF14;
  }
  .frame::before { left: 10px; top: 10px; border-right: 0; border-bottom: 0; }
  .frame::after { right: 10px; bottom: 10px; border-left: 0; border-top: 0; }
  .radar {
    position: absolute;
    left: 12%;
    top: 18%;
    width: 160px;
    height: 160px;
    border-radius: 50%;
    border: 1px solid rgba(57,255,20,.4);
    box-shadow: 0 0 20px rgba(57,255,20,.15);
  }
  .radar::before, .radar::after {
    content: "";
    position: absolute;
    inset: 26px;
    border-radius: 50%;
    border: 1px solid rgba(57,255,20,.16);
  }
  .radar::after { inset: 52px; }
  .sweep {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 78px;
    height: 2px;
    transform-origin: left center;
    background: linear-gradient(90deg, rgba(57,255,20,.9), rgba(57,255,20,0));
    animation: spin 2.5s linear infinite;
    box-shadow: 0 0 12px rgba(57,255,20,.45);
  }
  .title {
    position: absolute;
    right: 10%;
    top: 24%;
    font-size: 28px;
    letter-spacing: .14em;
    text-shadow: 0 0 8px rgba(57,255,20,.75);
  }
  .alert {
    position: absolute;
    right: 10%;
    top: 42%;
    color: #FFB000;
    font-size: 12px;
    letter-spacing: .3em;
    animation: blink .9s steps(1) infinite;
  }
  .scan {
    position: absolute;
    left: 10%;
    right: 10%;
    bottom: 22%;
    height: 38px;
    border: 1px solid rgba(57,255,20,.3);
    overflow: hidden;
  }
  .scan::before {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent, rgba(57,255,20,.55), transparent);
    animation: pass 2s infinite linear;
  }
  .meta {
    position: absolute;
    left: 10%;
    bottom: 14%;
    font-size: 11px;
    letter-spacing: .18em;
  }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  @keyframes pass { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
  @keyframes blink { 50% { opacity: .15; } }
</style>
</head>
<body>
  <div class="frame"></div>
  <div class="radar"><div class="sweep"></div></div>
  <div class="title">VECTOR RADAR</div>
  <div class="alert">TRACKING</div>
  <div class="scan"></div>
  <div class="meta">SIGNAL // 1984 // ONLINE</div>
</body>
</html>`,
};
