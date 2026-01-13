// Interactive Gradient Tool (WebGL)
// - Drag points on canvas
// - Add/remove points
// - Grain (noise) toggle + amount
// - Warp + speed + softness controls
// - Export PNG + copy JSON settings

const canvas = document.getElementById("c");
const panel = document.getElementById("panel");

const ui = {
  togglePanel: document.getElementById("togglePanel"),
  noiseEnabled: document.getElementById("noiseEnabled"),
  grain: document.getElementById("grain"),
  grainVal: document.getElementById("grainVal"),
  warp: document.getElementById("warp"),
  warpVal: document.getElementById("warpVal"),
  speed: document.getElementById("speed"),
  speedVal: document.getElementById("speedVal"),
  softness: document.getElementById("softness"),
  softnessVal: document.getElementById("softnessVal"),
  pointsList: document.getElementById("pointsList"),
  addPoint: document.getElementById("addPoint"),
  removePoint: document.getElementById("removePoint"),
  downloadPng: document.getElementById("downloadPng"),
  copyJson: document.getElementById("copyJson"),
  randomize: document.getElementById("randomize"),
};

const MAX_POINTS = 6;

const defaultPoints = [
  { x: 0.22, y: 0.30, color: "#ff3bff" },
  { x: 0.78, y: 0.28, color: "#00d1ff" },
  { x: 0.70, y: 0.78, color: "#7bff7a" },
  { x: 0.28, y: 0.76, color: "#ffe66d" },
];

const state = {
  points: structuredClone(defaultPoints),
  selected: 0,
  dragging: false,
  dragOffset: { x: 0, y: 0 },
  mouse: { x: 0.5, y: 0.5 },
  noiseEnabled: true,
  grainAmount: parseFloat(ui.grain.value),
  warp: parseFloat(ui.warp.value),
  speed: parseFloat(ui.speed.value),
  softness: parseFloat(ui.softness.value),
};

ui.togglePanel.addEventListener("click", () => {
  panel.classList.toggle("collapsed");
});

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function hexToRgb01(hex) {
  const h = hex.replace("#", "").trim();
  const bigint = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return [r / 255, g / 255, b / 255];
}

function randomHex() {
  const r = Math.floor(60 + Math.random() * 195);
  const g = Math.floor(60 + Math.random() * 195);
  const b = Math.floor(60 + Math.random() * 195);
  return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
}

/* -------------------- WebGL setup -------------------- */

const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false });
if (!gl) throw new Error("WebGL not supported");

const vertSrc = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main(){
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const fragSrc = `
precision highp float;

varying vec2 v_uv;

uniform vec2 u_res;
uniform float u_time;

uniform int u_count;
uniform vec2 u_pts[${MAX_POINTS}];
uniform vec3 u_cols[${MAX_POINTS}];

uniform float u_softness;
uniform float u_warp;
uniform float u_speed;

uniform float u_grain;
uniform float u_noiseEnabled;
uniform vec2 u_mouse;

// --- hash / noise helpers ---
float hash21(vec2 p){
  p = fract(p*vec2(123.34, 345.45));
  p += dot(p, p+34.345);
  return fract(p.x*p.y);
}

float noise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f*f*(3.0-2.0*f);
  return mix(a, b, u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
}

float fbm(vec2 p){
  float v = 0.0;
  float a = 0.5;
  for (int i=0; i<5; i++){
    v += a * noise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}

vec2 warp(vec2 uv, float t){
  // subtle organic flow
  float n1 = fbm(uv*3.0 + vec2(0.0, t*0.15));
  float n2 = fbm(uv*3.0 + vec2(10.0, -t*0.12));
  vec2 w = vec2(n1, n2) - 0.5;

  // small mouse-driven parallax push (kept tasteful)
  vec2 m = u_mouse - 0.5;
  vec2 mpush = m * 0.06;

  return uv + (w * u_warp * 0.18) + mpush;
}

void main(){
  vec2 uv = v_uv;

  float t = u_time * max(0.0001, u_speed);
  if (u_noiseEnabled > 0.5) {
    uv = warp(uv, t);
  }

  // Accumulate "soft blobs"
  vec3 col = vec3(0.0);
  float wsum = 0.0;

  for (int i=0; i<${MAX_POINTS}; i++){
    if (i >= u_count) break;

    vec2 p = u_pts[i];

    // animate points very gently
    float jitter = fbm(p*6.0 + t*0.25);
    vec2 pj = p + (jitter - 0.5) * 0.02 * u_noiseEnabled;

    float d = distance(uv, pj);

    // softness controls falloff
    float w = exp(-d * u_softness * 3.0);

    col += u_cols[i] * w;
    wsum += w;
  }

  col /= max(0.0001, wsum);

  // slight contrast curve for that "milky" depth
  col = pow(col, vec3(0.92));
  col = col * 1.03;

  // grain (film-like)
  float g = (hash21(gl_FragCoord.xy + fract(u_time)*1000.0) - 0.5);
  col += g * u_grain;

  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const msg = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(msg);
  }
  return s;
}

function createProgram(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const msg = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(msg);
  }
  return p;
}

const vs = compile(gl.VERTEX_SHADER, vertSrc);
const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
const prog = createProgram(vs, fs);

const quad = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quad);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  -1, -1,
   1, -1,
  -1,  1,
  -1,  1,
   1, -1,
   1,  1
]), gl.STATIC_DRAW);

const loc = {
  a_pos: gl.getAttribLocation(prog, "a_pos"),
  u_res: gl.getUniformLocation(prog, "u_res"),
  u_time: gl.getUniformLocation(prog, "u_time"),
  u_count: gl.getUniformLocation(prog, "u_count"),
  u_pts: gl.getUniformLocation(prog, "u_pts[0]"),
  u_cols: gl.getUniformLocation(prog, "u_cols[0]"),
  u_softness: gl.getUniformLocation(prog, "u_softness"),
  u_warp: gl.getUniformLocation(prog, "u_warp"),
  u_speed: gl.getUniformLocation(prog, "u_speed"),
  u_grain: gl.getUniformLocation(prog, "u_grain"),
  u_noiseEnabled: gl.getUniformLocation(prog, "u_noiseEnabled"),
  u_mouse: gl.getUniformLocation(prog, "u_mouse"),
};

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.floor(window.innerWidth * dpr);
  const h = Math.floor(window.innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = "100vw";
    canvas.style.height = "100vh";
    gl.viewport(0, 0, w, h);
  }
}
window.addEventListener("resize", resize);
resize();

/* -------------------- UI (points list) -------------------- */

function renderPointsList() {
  ui.pointsList.innerHTML = "";

  state.points.forEach((pt, i) => {
    const row = document.createElement("div");
    row.className = "point" + (i === state.selected ? " selected" : "");
    row.addEventListener("click", () => {
      state.selected = i;
      renderPointsList();
    });

    const sw = document.createElement("div");
    sw.className = "swatch";
    sw.style.background = pt.color;

    const color = document.createElement("input");
    color.type = "color";
    color.value = pt.color;
    color.addEventListener("input", (e) => {
      pt.color = e.target.value;
      sw.style.background = pt.color;
    });

    const meta = document.createElement("div");
    meta.className = "pointmeta";

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = `Point ${i + 1}`;

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = i === state.selected ? "selected" : "click";
    title.appendChild(badge);

    const sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = `x ${pt.x.toFixed(3)}  •  y ${pt.y.toFixed(3)}`;

    meta.appendChild(title);
    meta.appendChild(sub);

    row.appendChild(sw);
    row.appendChild(color);
    row.appendChild(meta);

    ui.pointsList.appendChild(row);
  });
}
renderPointsList();

ui.addPoint.addEventListener("click", () => {
  if (state.points.length >= MAX_POINTS) return;
  state.points.push({
    x: Math.random() * 0.6 + 0.2,
    y: Math.random() * 0.6 + 0.2,
    color: randomHex(),
  });
  state.selected = state.points.length - 1;
  renderPointsList();
});

ui.removePoint.addEventListener("click", () => {
  if (state.points.length <= 2) return;
  state.points.splice(state.selected, 1);
  state.selected = Math.max(0, state.selected - 1);
  renderPointsList();
});

function hookSlider(slider, out, key, fmt = (v) => v.toFixed(2)) {
  const update = () => {
    const v = parseFloat(slider.value);
    state[key] = v;
    out.textContent = fmt(v);
  };
  slider.addEventListener("input", update);
  update();
}
hookSlider(ui.grain, ui.grainVal, "grainAmount", v => v.toFixed(2));
hookSlider(ui.warp, ui.warpVal, "warp", v => v.toFixed(2));
hookSlider(ui.speed, ui.speedVal, "speed", v => v.toFixed(2));
hookSlider(ui.softness, ui.softnessVal, "softness", v => v.toFixed(2));

ui.noiseEnabled.addEventListener("change", () => {
  state.noiseEnabled = ui.noiseEnabled.checked;
});

ui.randomize.addEventListener("click", () => {
  state.points.forEach(p => {
    p.x = clamp01(0.15 + Math.random() * 0.7);
    p.y = clamp01(0.15 + Math.random() * 0.7);
    p.color = randomHex();
  });
  state.grainAmount = Math.random() * 0.20;
  ui.grain.value = String(state.grainAmount);
  ui.grain.dispatchEvent(new Event("input"));
  renderPointsList();
});

ui.copyJson.addEventListener("click", async () => {
  const payload = {
    points: state.points,
    noiseEnabled: state.noiseEnabled,
    grainAmount: state.grainAmount,
    warp: state.warp,
    speed: state.speed,
    softness: state.softness,
  };
  try {
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    ui.copyJson.textContent = "Copied!";
    setTimeout(() => (ui.copyJson.textContent = "Copy settings JSON"), 900);
  } catch {
    alert("Clipboard blocked. Copy manually from console.");
    console.log(payload);
  }
});

ui.downloadPng.addEventListener("click", () => {
  // ensure latest frame drawn
  draw(performance.now() * 0.001);

  const a = document.createElement("a");
  a.download = "gradient.png";
  a.href = canvas.toDataURL("image/png");
  a.click();
});

/* -------------------- Interaction (drag points) -------------------- */

function getUVFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;
  return { x: clamp01(x), y: clamp01(y) };
}

function pickNearest(uv) {
  let bestI = 0;
  let bestD = Infin
