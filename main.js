const canvas = document.getElementById("c");
const panel = document.getElementById("panel");

const ui = {
  togglePanel: document.getElementById("togglePanel"),

  grainEnabled: document.getElementById("grainEnabled"),
  grain: document.getElementById("grain"),
  grainVal: document.getElementById("grainVal"),

  flow: document.getElementById("flow"),
  flowVal: document.getElementById("flowVal"),

  speed: document.getElementById("speed"),
  speedVal: document.getElementById("speedVal"),

  softness: document.getElementById("softness"),
  softnessVal: document.getElementById("softnessVal"),

  lensSize: document.getElementById("lensSize"),
  lensSizeVal: document.getElementById("lensSizeVal"),

  lensPower: document.getElementById("lensPower"),
  lensPowerVal: document.getElementById("lensPowerVal"),

  lensRim: document.getElementById("lensRim"),
  lensRimVal: document.getElementById("lensRimVal"),

  pointsList: document.getElementById("pointsList"),
  addPoint: document.getElementById("addPoint"),
  removePoint: document.getElementById("removePoint"),

  downloadPng: document.getElementById("downloadPng"),
  copyJson: document.getElementById("copyJson"),
  randomize: document.getElementById("randomize"),
};

ui.togglePanel.addEventListener("click", () => panel.classList.toggle("collapsed"));

const MAX_POINTS = 6;

const defaultPoints = [
  { x: 0.20, y: 0.22, color: "#2b3a87" }, // deep blue
  { x: 0.74, y: 0.18, color: "#111018" }, // near-black
  { x: 0.70, y: 0.78, color: "#1b2669" }, // blue-ish
  { x: 0.28, y: 0.74, color: "#c4573a" }, // warm orange
];

const state = {
  points: structuredClone(defaultPoints),
  selected: 0,

  // pointer smoothing (important to feel like Monopo)
  mouse: { x: 0.45, y: 0.55 },
  mouseTarget: { x: 0.45, y: 0.55 },

  dragging: false,
  dragOffset: { x: 0, y: 0 },

  grainEnabled: ui.grainEnabled.checked,
  grainAmount: parseFloat(ui.grain.value),

  flowStrength: parseFloat(ui.flow.value),
  flowSpeed: parseFloat(ui.speed.value),
  softness: parseFloat(ui.softness.value),

  lensSize: parseFloat(ui.lensSize.value),
  lensPower: parseFloat(ui.lensPower.value),
  lensRim: parseFloat(ui.lensRim.value),
};

function clamp01(v){ return Math.max(0, Math.min(1, v)); }

function hexToRgb01(hex) {
  const h = hex.replace("#", "").trim();
  const bigint = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return [r/255, g/255, b/255];
}
function randomHex(){
  const r = Math.floor(40 + Math.random()*215);
  const g = Math.floor(40 + Math.random()*215);
  const b = Math.floor(40 + Math.random()*215);
  return "#" + [r,g,b].map(v=>v.toString(16).padStart(2,"0")).join("");
}

/* -------------------- WebGL -------------------- */

const gl = canvas.getContext("webgl", { antialias:false, premultipliedAlpha:false });
if (!gl) throw new Error("WebGL not supported");

const vertSrc = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main(){
  v_uv = a_pos*0.5 + 0.5;
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
uniform float u_flow;
uniform float u_speed;

uniform float u_grain;
uniform float u_grainEnabled;

uniform vec2 u_mouse;     // smoothed mouse in 0..1
uniform float u_lensSize; // radius in uv units
uniform float u_lensPower;
uniform float u_lensRim;

// ---- noise helpers ----
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
  for(int i=0;i<5;i++){
    v += a * noise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}

vec2 flowWarp(vec2 uv, float t){
  // big, smooth “smoke” flow
  float n1 = fbm(uv*2.2 + vec2(0.0, t*0.12));
  float n2 = fbm(uv*2.2 + vec2(12.0, -t*0.10));
  vec2 w = vec2(n1, n2) - 0.5;
  return uv + w * (u_flow * 0.22);
}

vec3 gradientField(vec2 uv, float t){
  vec3 col = vec3(0.0);
  float wsum = 0.0;

  // metaball-ish blending
  for(int i=0;i<${MAX_POINTS};i++){
    if(i >= u_count) break;

    vec2 p = u_pts[i];

    // very subtle point drift (gives the background that “alive” feel)
    float j = fbm(p*5.0 + t*0.20);
    vec2 pj = p + (j - 0.5) * 0.018 * smoothstep(0.0, 1.0, u_flow);

    float d = distance(uv, pj);
    float w = exp(-d * u_softness * 3.2);

    col += u_cols[i] * w;
    wsum += w;
  }

  col /= max(0.0001, wsum);

  // a slightly “milky” tonemap (helps look like the recorded Monopo background)
  col = pow(col, vec3(0.95));
  col = col * 1.02;

  return col;
}

void main(){
  vec2 uv = v_uv;
  float t = u_time * max(0.0001, u_speed);

  // flow warp first (affects whole background)
  vec2 uvFlow = flowWarp(uv, t);

  // mouse lens: refracts UV locally
  vec2 m = u_mouse;
  float d = distance(uv, m);
  float r = u_lensSize;

  // inside lens: push UV outward a bit (refraction)
  // stronger near center, fades to edge
  float inside = 1.0 - smoothstep(r*0.85, r, d);
  vec2 dir = normalize(uv - m + 1e-6);
  float bulge = (1.0 - (d / max(1e-6, r)));
  float refr = inside * bulge * u_lensPower * 0.10;

  vec2 uvLens = uvFlow + dir * refr;

  // sample field
  vec3 col = gradientField(uvLens, t);

  // vignette-ish depth (Monopo has subtle depth at corners)
  vec2 p = uv - 0.5;
  float vig = smoothstep(0.95, 0.25, dot(p,p));
  col *= mix(0.85, 1.0, vig);

  // lens rim highlight (faint ring + fresnel)
  float rimBand = smoothstep(r, r*0.92, d) * smoothstep(r*0.78, r*0.90, d);
  float rim = rimBand * u_lensRim;

  // a slightly “glass” edge: brighten + tiny desat
  col += vec3(1.0) * rim * 0.22;
  col = mix(col, vec3(dot(col, vec3(0.333))), rim * 0.08);

  // grain on top
  if (u_grainEnabled > 0.5){
    float g = (hash21(gl_FragCoord.xy + fract(u_time)*1000.0) - 0.5);
    col += g * u_grain;
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(type, src){
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){
    const msg = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(msg);
  }
  return s;
}
function createProgram(vs, fs){
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if(!gl.getProgramParameter(p, gl.LINK_STATUS)){
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
  -1,-1,  1,-1, -1, 1,
  -1, 1,  1,-1,  1, 1
]), gl.STATIC_DRAW);

const loc = {
  a_pos: gl.getAttribLocation(prog, "a_pos"),
  u_res: gl.getUniformLocation(prog, "u_res"),
  u_time: gl.getUniformLocation(prog, "u_time"),
  u_count: gl.getUniformLocation(prog, "u_count"),
  u_pts: gl.getUniformLocation(prog, "u_pts[0]"),
  u_cols: gl.getUniformLocation(prog, "u_cols[0]"),

  u_softness: gl.getUniformLocation(prog, "u_softness"),
  u_flow: gl.getUniformLocation(prog, "u_flow"),
  u_speed: gl.getUniformLocation(prog, "u_speed"),

  u_grain: gl.getUniformLocation(prog, "u_grain"),
  u_grainEnabled: gl.getUniformLocation(prog, "u_grainEnabled"),

  u_mouse: gl.getUniformLocation(prog, "u_mouse"),
  u_lensSize: gl.getUniformLocation(prog, "u_lensSize"),
  u_lensPower: gl.getUniformLocation(prog, "u_lensPower"),
  u_lensRim: gl.getUniformLocation(prog, "u_lensRim"),
};

function resize(){
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.floor(innerWidth * dpr);
  const h = Math.floor(innerHeight * dpr);
  if(canvas.width !== w || canvas.height !== h){
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0,0,w,h);
  }
}
addEventListener("resize", resize);
resize();

/* -------------------- UI wiring -------------------- */

function hookSlider(slider, out, key, fmt=(v)=>v.toFixed(2)){
  const update = () => {
    const v = parseFloat(slider.value);
    state[key] = v;
    out.textContent = fmt(v);
  };
  slider.addEventListener("input", update);
  update();
}

ui.grainEnabled.addEventListener("change", () => { state.grainEnabled = ui.grainEnabled.checked; });

hookSlider(ui.grain, ui.grainVal, "grainAmount", v=>v.toFixed(2));
hookSlider(ui.flow, ui.flowVal, "flowStrength", v=>v.toFixed(2));
hookSlider(ui.speed, ui.speedVal, "flowSpeed", v=>v.toFixed(2));
hookSlider(ui.softness, ui.softnessVal, "softness", v=>v.toFixed(2));

hookSlider(ui.lensSize, ui.lensSizeVal, "lensSize", v=>v.toFixed(2));
hookSlider(ui.lensPower, ui.lensPowerVal, "lensPower", v=>v.toFixed(2));
hookSlider(ui.lensRim, ui.lensRimVal, "lensRim", v=>v.toFixed(2));

/* -------------------- Points list -------------------- */

function renderPointsList(){
  ui.pointsList.innerHTML = "";
  state.points.forEach((pt, i) => {
    const row = document.createElement("div");
    row.className = "point" + (i===state.selected ? " selected" : "");
    row.addEventListener("click", () => { state.selected = i; renderPointsList(); });

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
    title.textContent = `Point ${i+1}`;

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = (i===state.selected) ? "selected" : "click";
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
  if(state.points.length >= MAX_POINTS) return;
  state.points.push({
    x: Math.random()*0.6 + 0.2,
    y: Math.random()*0.6 + 0.2,
    color: randomHex(),
  });
  state.selected = state.points.length - 1;
  renderPointsList();
});

ui.removePoint.addEventListener("click", () => {
  if(state.points.length <= 2) return;
  state.points.splice(state.selected, 1);
  state.selected = Math.max(0, state.selected - 1);
  renderPointsList();
});

ui.randomize.addEventListener("click", () => {
  state.points.forEach(p => {
    p.x = clamp01(0.12 + Math.random()*0.76);
    p.y = clamp01(0.12 + Math.random()*0.76);
    p.color = randomHex();
  });
  state.grainAmount = Math.random() * 0.18;
  ui.grain.value = String(state.grainAmount);
  ui.grain.dispatchEvent(new Event("input"));
  renderPointsList();
});

ui.copyJson.addEventListener("click", async () => {
  const payload = {
    points: state.points,
    grainEnabled: state.grainEnabled,
    grainAmount: state.grainAmount,
    flowStrength: state.flowStrength,
    flowSpeed: state.flowSpeed,
    softness: state.softness,
    lensSize: state.lensSize,
    lensPower: state.lensPower,
    lensRim: state.lensRim,
  };
  try{
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    ui.copyJson.textContent = "Copied!";
    setTimeout(() => ui.copyJson.textContent = "Copy settings JSON", 900);
  } catch {
    alert("Clipboard blocked. Copy from console.");
    console.log(payload);
  }
});

ui.downloadPng.addEventListener("click", () => {
  draw(performance.now() * 0.001);
  const a = document.createElement("a");
  a.download = "gradient.png";
  a.href = canvas.toDataURL("image/png");
  a.click();
});

/* -------------------- Mouse + dragging -------------------- */

function getUV(e){
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  return { x: clamp01(x), y: clamp01(y) };
}
function pickNearest(uv){
  let bestI=0, bestD=Infinity;
  for(let i=0;i<state.points.length;i++){
    const p = state.points[i];
    const dx=p.x-uv.x, dy=p.y-uv.y;
    const d = dx*dx + dy*dy;
    if(d<bestD){ bestD=d; bestI=i; }
  }
  return { index: bestI, dist2: bestD };
}

canvas.addEventListener("pointermove", (e) => {
  const uv = getUV(e);

  // target mouse for lens (smoothed in loop)
  state.mouseTarget.x = uv.x;
  state.mouseTarget.y = 1.0 - uv.y;

  if(state.dragging){
    const p = state.points[state.selected];
    p.x = clamp01(uv.x - state.dragOffset.x);
    p.y = clamp01(uv.y - state.dragOffset.y);
    renderPointsList();
  }
});

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  const uv = getUV(e);
  const pick = pickNearest(uv);

  // if close enough: drag point; otherwise just move lens only (still feels good)
  if(pick.dist2 < 0.020){
    state.selected = pick.index;
    const p = state.points[state.selected];
    state.dragOffset.x = uv.x - p.x;
    state.dragOffset.y = uv.y - p.y;
    state.dragging = true;
    renderPointsList();
  }
});

canvas.addEventListener("pointerup", (e) => {
  state.dragging = false;
  try{ canvas.releasePointerCapture(e.pointerId); } catch {}
});

/* -------------------- Render loop -------------------- */

function draw(t){
  resize();

  // smooth mouse (this is what makes it feel “premium” like the ref)
  const lerp = 0.08;
  state.mouse.x += (state.mouseTarget.x - state.mouse.x) * lerp;
  state.mouse.y += (state.mouseTarget.y - state.mouse.y) * lerp;

  gl.useProgram(prog);

  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(loc.a_pos);
  gl.vertexAttribPointer(loc.a_pos, 2, gl.FLOAT, false, 0, 0);

  gl.uniform2f(loc.u_res, canvas.width, canvas.height);
  gl.uniform1f(loc.u_time, t);

  gl.uniform1i(loc.u_count, state.points.length);

  const pts = new Float32Array(MAX_POINTS * 2);
  for(let i=0;i<MAX_POINTS;i++){
    const p = state.points[i] || state.points[state.points.length-1];
    pts[i*2+0] = p.x;
    pts[i*2+1] = p.y;
  }
  gl.uniform2fv(loc.u_pts, pts);

  const cols = new Float32Array(MAX_POINTS * 3);
  for(let i=0;i<MAX_POINTS;i++){
    const p = state.points[i] || state.points[state.points.length-1];
    const [r,g,b] = hexToRgb01(p.color);
    cols[i*3+0]=r; cols[i*3+1]=g; cols[i*3+2]=b;
  }
  gl.uniform3fv(loc.u_cols, cols);

  gl.uniform1f(loc.u_softness, state.softness);
  gl.uniform1f(loc.u_flow, state.flowStrength);
  gl.uniform1f(loc.u_speed, state.flowSpeed);

  gl.uniform1f(loc.u_grain, state.grainAmount);
  gl.uniform1f(loc.u_grainEnabled, state.grainEnabled ? 1.0 : 0.0);

  gl.uniform2f(loc.u_mouse, state.mouse.x, state.mouse.y);
  gl.uniform1f(loc.u_lensSize, state.lensSize);
  gl.uniform1f(loc.u_lensPower, state.lensPower);
  gl.uniform1f(loc.u_lensRim, state.lensRim);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  requestAnimationFrame((ms) => draw(ms * 0.001));
}
requestAnimationFrame((ms) => draw(ms * 0.001));
