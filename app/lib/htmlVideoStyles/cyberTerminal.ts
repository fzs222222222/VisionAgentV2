import { HtmlVideoStyle } from "./types";

export const cyberTerminalStyle: HtmlVideoStyle = {
  id: "cyber-terminal",
  name: "Cyber Quantum Terminal",
  nameZh: "量子赛博终端",
  tagline: "霓虹青紫科技面板、非对称信息布局、持续运动的终端感动画。",
  stylePrompt:
    "HTML video visual style baseline: Cyber Quantum Terminal. Use a strict obsidian-black background (#060713) with crisp neon cyan indicators (#00F2FE), fluorescent violet accents (#E040FB), and pure white primary text. Typography should feel like a futuristic dashboard, using bold sans or monospace display text with strong scale contrast. Build layouts with asymmetric technical panels, 1px reticles, telemetry crosshairs, and clean safe-area framing instead of decorative PPT boxes. Motion should stay rhythmic and fast: snap reveals, character-by-character typing, expanding wireframe paths, and constant-speed orbital rotations. Keep the scene loop-friendly, high contrast, and suitable for alpha-overlay video compositing. Prefer concise on-screen copy, one dominant message at a time, and graphic-led communication over dense subtitle paragraphs. Keep a clean subtitle-safe area in the bottom 18% of the frame and avoid pushing key text into that region unless a lower-third is explicitly required.",
  displayPromptZh:
    "HTML 视频视觉基线：量子赛博终端。整体使用曜石黑背景（#060713），搭配高亮霓虹青指示线（#00F2FE）、荧光紫强调色（#E040FB）和纯白主文字。排版应像未来数据驾驶舱，适合粗黑无衬线或等宽字体，并通过强烈的字号对比建立层级。画面构图采用非对称技术面板、1 像素准线、遥测十字线和清晰安全框，不要做成传统 PPT 盒子。动画节奏要利落而持续，可使用快速揭示、逐字打字、线框扩展和恒速轨道旋转，整体保持高对比、可循环，并适合做透明叠加视频合成。",
  demoHtml: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #060713; color: #fff; font-family: "Segoe UI", "Courier New", monospace; }
  body {
    position: relative;
    background:
      linear-gradient(rgba(0,242,254,.08) 1px, transparent 1px),
      linear-gradient(90deg, rgba(0,242,254,.08) 1px, transparent 1px),
      #060713;
    background-size: 36px 36px, 36px 36px, auto;
  }
  .reticle { position: absolute; inset: 12px; border: 1px solid rgba(0,242,254,.35); }
  .reticle::before, .reticle::after {
    content: "";
    position: absolute;
    width: 24px;
    height: 24px;
    border-top: 2px solid #00F2FE;
    border-left: 2px solid #00F2FE;
  }
  .reticle::after { right: 0; bottom: 0; transform: rotate(180deg); }
  .reticle::before { left: 0; top: 0; }
  .panel {
    position: absolute;
    left: 8%;
    top: 18%;
    width: 48%;
    padding: 18px 20px;
    border: 1px solid rgba(0,242,254,.35);
    background: rgba(8,12,28,.72);
    box-shadow: 0 0 30px rgba(0,242,254,.08);
  }
  .kicker {
    font-size: 10px;
    letter-spacing: .28em;
    color: #00F2FE;
    opacity: .9;
  }
  .title {
    margin-top: 12px;
    font-size: 34px;
    font-weight: 900;
    line-height: 1;
  }
  .cursor {
    display: inline-block;
    width: 10px;
    height: 28px;
    margin-left: 6px;
    background: #E040FB;
    vertical-align: middle;
    animation: blink .8s steps(1) infinite;
  }
  .diag {
    position: absolute;
    right: 8%;
    top: 16%;
    width: 24%;
    height: 68%;
    border: 1px solid rgba(224,64,251,.3);
    padding: 14px;
  }
  .row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 14px;
    font-size: 10px;
    color: rgba(255,255,255,.7);
    letter-spacing: .16em;
  }
  .bar {
    height: 6px;
    margin-top: 8px;
    background: rgba(255,255,255,.08);
    overflow: hidden;
  }
  .bar > span {
    display: block;
    height: 100%;
    width: 60%;
    background: linear-gradient(90deg, #00F2FE, #E040FB);
    animation: load 2.2s infinite ease-in-out;
  }
  .radar {
    position: absolute;
    right: 12%;
    bottom: 12%;
    width: 110px;
    height: 110px;
    border-radius: 50%;
    border: 1px solid rgba(0,242,254,.35);
  }
  .radar::before, .radar::after {
    content: "";
    position: absolute;
    inset: 14px;
    border-radius: 50%;
    border: 1px solid rgba(0,242,254,.16);
  }
  .sweep {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 2px;
    height: 44px;
    transform-origin: center bottom;
    background: linear-gradient(180deg, rgba(0,242,254,0), #00F2FE);
    animation: spin 2.6s linear infinite;
  }
  @keyframes blink { 50% { opacity: 0; } }
  @keyframes load { 0%,100% { transform: translateX(-60%); } 50% { transform: translateX(55%); } }
  @keyframes spin { from { transform: translate(-50%,-100%) rotate(0deg); } to { transform: translate(-50%,-100%) rotate(360deg); } }
</style>
</head>
<body>
  <div class="reticle"></div>
  <div class="panel">
    <div class="kicker">SYSTEM VISUAL // LIVE DATA</div>
    <div class="title">FUTURE SIGNAL<span class="cursor"></span></div>
  </div>
  <div class="diag">
    <div class="row"><span>CORE</span><span>92%</span></div>
    <div class="bar"><span></span></div>
    <div class="row"><span>NODE</span><span>SYNC</span></div>
    <div class="bar"><span style="animation-delay:-.6s"></span></div>
    <div class="row"><span>ARRAY</span><span>READY</span></div>
    <div class="bar"><span style="animation-delay:-1.1s"></span></div>
  </div>
  <div class="radar"><div class="sweep"></div></div>
</body>
</html>`,
};
