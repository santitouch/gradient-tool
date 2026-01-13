/*  Gradient Tool
   - Directional band gradients + slow flow warp
   - Focused  "pressure" (localized) + subtle swirl
   - Static grain (pinned to pixels; no movement)
   - Minimal UI hooks + embed snippet generator (uses embed.js)
*/

(function () {
  const canvas = document.getElementById("bg");
  const overlay = document.getElementById("fatalOverlay");

  const ui = {
    panel: document.getElementById("panel"),
    togglePanel: document.getElementById("togglePanel"),

    c1: document.getElementById("c1"),
    c2: document.getElementById("c2"),
    c3: document.getElementById("c3"),
    c4: document.getElementById("c4"),

    noise: document.getElementById("noise"),
    noiseVal: document.getElementById("noiseVal"),

    speed: document.getElementById("speed"),
    speedVal: document.getElementById("speedVal"),

    Strength: document.getElementById("Strength"),
    StrengthVal: document.getElementById("StrengthVal"),

    Radius: document.getElementById("Radius"),
    RadiusVal: document.getElementById("RadiusVal"),

    banding: document.getElementById("banding"),
    bandingVal: document.getElementById("bandingVal"),

    grain: document.getElementById("grain"),
    grainVal: document.getElementById("grainVal"),
    grainEnabled: document.getElementById("grainEnabled"),

    randomize: document.getElementById("randomize"),

    embedSelector: document.getElementById("embedSelector"),
    generateEmbed: document.getElementById("generateEmbed"),
    copyEmbed: document.getElementById("copyEmbed"),
    embedOut: document.getElementById("embedOut"),
  };

  function fatal(msg) {
    if (!overlay) {
      alert(msg);
      return;
    }
    overlay.hidden = false;
    overlay.textContent = msg;
  }

  if (!canvas) {
    fatal("Canvas #bg not found. Check index.html.");
    return;
  }

  // ---- Panel toggle
  if (ui.togglePanel && ui.panel) {
    ui.togglePanel.addEventListener("click", () => ui.panel.classList.toggle("collapsed"));
  }

  // ---- WebGL setup
  const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false });
  if (!gl) {
    fatal("WebGL not supported or blocked.\nTry another browser or disable GPU-blocking extensions.");
    return;
  }

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  }
  window.addEventListener("resize", resize);
  resize();

  // ---- Shaders
  const vertSrc = `
    attribute vec2 a_pos;
    varying vec2 v_uv;
    void main(){
      v_uv = a_pos * 0.5 + 0.5;
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;

  // Static grain: uses ONLY gl_FragCoord.xy (no time)
  // Focused : gaussian falloff around pointer + small swirl
  const fragSrc = `
precision highp float;
varying vec2 v_uv;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_;

uniform vec3 c1;
uniform vec3 c2;
uniform vec3 c3;
uniform vec3 c4;

uniform float u_noise;
uniform float u_speed;
uniform float u_grain;
uniform float u_grainEnabled;

uniform float u_Strength; // "Focus"
uniform float u_Radius;   // radius
uniform float u_banding;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f*f*(3.0 - 2.0*f);
  return mix(a, b, u.x) +
         (c - a) * u.y * (1.0 - u.x) +
         (d - b) * u.x * u.y;
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i=0; i<5; i++){
    v += a * noise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}

// Soft falloff with no “edge”
float falloff(vec2 p, vec2 c, float r){
  float d = distance(p, c);
  float f = smoothstep(r, 0.0, d);   // 1 at center -> 0 at radius
  // soften further so it doesn't read like a spotlight
  return f * f * (3.0 - 2.0 * f);    // smootherstep
}

void main(){
  vec2 uv = v_uv;

  float aspect = u_resolution.x / u_resolution.y;

  // aspect space
  vec2 uva = uv;
  uva.x *= aspect;

  float t = u_time * u_speed;

  // Global slow flow warp
  vec2 flow = vec2(
    fbm(uva * 1.35 + vec2(0.0, t * 0.18)),
    fbm(uva * 1.35 + vec2(10.0, -t * 0.12))
  );
  uva += (flow - 0.5) * u_noise;

  //  (aspect space)
  vec2 ma = u_;
  ma.x *= aspect;

  // Localized "pressure" — NO radial push (avoids cone look)
  float f = falloff(uva, ma, u_Radius);

  // Two noise samples create a soft vector field around the cursor
  // This looks like liquid displacement rather than a beam
  vec2 field;
  field.x = fbm(uva * 2.20 + ma * 2.0 + vec2( 0.0, t * 0.35)) - 0.5;
  field.y = fbm(uva * 2.20 + ma * 2.0 + vec2(12.3, -t * 0.30)) - 0.5;

  // Strength scaled smoothly by f
  float amt = u_Strength * 0.10 * f;
  uva += field * amt;

  // Directional band gradients
  float g1 = smoothstep(0.0, 1.0, uva.y);
  float g2 = smoothstep(0.0, 1.0, uva.x / aspect);
  float g3 = smoothstep(0.0, 1.0, (uva.y + (uva.x / aspect)) * 0.5);

  g1 = pow(g1, u_banding);
  g2 = pow(g2, u_banding * 0.92);
  g3 = pow(g3, u_banding * 1.05);

  vec3 col = mix(c1, c2, g1);
  col = mix(col, c3, g2 * 0.85);
  col = mix(col, c4, g3 * 0.80);

  // subtle softness/contrast
  col = pow(col, vec3(0.96));
  col *= 1.03;

  // vignette
  vec2 p = (uv - 0.5);
  float vig = smoothstep(0.95, 0.25, dot(p,p));
  col *= mix(0.80, 1.0, vig);

  // STATIC grain (no time input)
  if (u_grainEnabled > 0.5) {
    float g = hash(gl_FragCoord.xy) - 0.5;
    col += g * u_grain;
  }

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

  function link(vs, fs) {
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

  let prog;
  try {
    const vs = compile(gl.VERTEX_SHADER, vertSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
    prog = link(vs, fs);
  } catch (e) {
    fatal("Shader compile/link failed:\n\n" + String(e));
    return;
  }

  // Fullscreen quad
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1,-1, 1,-1, -1,1,  -1,1, 1,-1, 1,1]),
    gl.STATIC_DRAW
  );

  const loc = {
    a_pos: gl.getAttribLocation(prog, "a_pos"),

    u_resolution: gl.getUniformLocation(prog, "u_resolution"),
    u_time: gl.getUniformLocation(prog, "u_time"),
    u_: gl.getUniformLocation(prog, "u_"),

    c1: gl.getUniformLocation(prog, "c1"),
    c2: gl.getUniformLocation(prog, "c2"),
    c3: gl.getUniformLocation(prog, "c3"),
    c4: gl.getUniformLocation(prog, "c4"),

    u_noise: gl.getUniformLocation(prog, "u_noise"),
    u_speed: gl.getUniformLocation(prog, "u_speed"),
    u_grain: gl.getUniformLocation(prog, "u_grain"),
    u_grainEnabled: gl.getUniformLocation(prog, "u_grainEnabled"),

    u_Strength: gl.getUniformLocation(prog, "u_Strength"),
    u_Radius: gl.getUniformLocation(prog, "u_Radius"),
    u_banding: gl.getUniformLocation(prog, "u_banding"),
  };

  // ---- Helpers
  function hexToRgb01(hex) {
    const h = String(hex || "#000000").replace("#", "").trim();
    const v = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }

  function hookSlider(slider, out, decimals = 2) {
    if (!slider || !out) return;
    const update = () => (out.textContent = Number(slider.value).toFixed(decimals));
    slider.addEventListener("input", update);
    update();
  }

  hookSlider(ui.noise, ui.noiseVal);
  hookSlider(ui.speed, ui.speedVal);
  hookSlider(ui.Strength, ui.StrengthVal);
  hookSlider(ui.Radius, ui.RadiusVal);
  hookSlider(ui.banding, ui.bandingVal);
  hookSlider(ui.grain, ui.grainVal);

  function randomPalette() {
    // "Monopo-ish": deep, warm, near-black, cool
    const deep = ["#1E2BFF","#223BFF","#2032C8","#1A2C8F"][Math.floor(Math.random()*4)];
    const warm = ["#FF6A2B","#FF5B1F","#E85B2F","#D85A38"][Math.floor(Math.random()*4)];
    const dark = ["#0B0B10","#0E0E12","#0A0A0E","#0D0D12"][Math.floor(Math.random()*4)];
    const cool = ["#9CB6C7","#A7C1D1","#8FA7C7","#B1C9D5"][Math.floor(Math.random()*4)];
    ui.c1.value = deep;
    ui.c2.value = warm;
    ui.c3.value = dark;
    ui.c4.value = cool;
  }

  if (ui.randomize) ui.randomize.addEventListener("click", randomPalette);

  // ----  smoothing
  const  = { x: 0.5, y: 0.5 };
  const T = { x: 0.5, y: 0.5 };

  window.addEventListener("move", (e) => {
    T.x = e.clientX / window.innerWidth;
    T.y = 1.0 - (e.clientY / window.innerHeight);
  });

  // ---- Embed generator
  function currentConfig() {
    return {
      colors: [ui.c1.value, ui.c2.value, ui.c3.value, ui.c4.value],
      noise: Number(ui.noise.value),
      speed: Number(ui.speed.value),
      Strength: Number(ui.Strength.value),
      Radius: Number(ui.Radius.value),
      banding: Number(ui.banding.value),
      grain: Number(ui.grain.value),
      grainEnabled: ui.grainEnabled.checked,
    };
  }

  function generateEmbedSnippet() {
    const sel = (ui.embedSelector.value || "#my-gradient").trim();
    const cfg = currentConfig();

    // Normalize for <div id="">
    const id = sel.startsWith("#") ? sel.slice(1) : sel;

    return [
      `<!-- Gradient mount point -->`,
      `<div id="${id}"></div>`,
      ``,
      `<!-- Include embed runtime (host this file or change the src) -->`,
      `<script src="./embed.js"></script>`,
      ``,
      `<!-- Mount -->`,
      `<script>`,
      `  MonopoGradient.mount(${JSON.stringify(sel)}, ${JSON.stringify(cfg, null, 2)});`,
      `</script>`
    ].join("\n");
  }

  if (ui.embedOut) ui.embedOut.value = generateEmbedSnippet();

  if (ui.generateEmbed) {
    ui.generateEmbed.addEventListener("click", () => {
      ui.embedOut.value = generateEmbedSnippet();
    });
  }

  if (ui.copyEmbed) {
    ui.copyEmbed.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(ui.embedOut.value || generateEmbedSnippet());
        ui.copyEmbed.textContent = "Copied!";
        setTimeout(() => (ui.copyEmbed.textContent = "Copy"), 900);
      } catch {
        alert("Clipboard blocked. Copy manually from the textarea.");
      }
    });
  }

  // ---- Render loop
  function render(ms) {
    resize();

    // premium  smoothing
    .x += (T.x - .x) * 0.10;
    .y += (T.y - .y) * 0.10;

    gl.useProgram(prog);

    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(loc.a_pos);
    gl.vertexAttribPointer(loc.a_pos, 2, gl.FLOAT, false, 0, 0);

    gl.uniform2f(loc.u_resolution, canvas.width, canvas.height);
    gl.uniform1f(loc.u_time, ms * 0.001);
    gl.uniform2f(loc.u_, .x, .y);

    const [r1,g1,b1] = hexToRgb01(ui.c1.value);
    const [r2,g2,b2] = hexToRgb01(ui.c2.value);
    const [r3,g3,b3] = hexToRgb01(ui.c3.value);
    const [r4,g4,b4] = hexToRgb01(ui.c4.value);

    gl.uniform3f(loc.c1, r1,g1,b1);
    gl.uniform3f(loc.c2, r2,g2,b2);
    gl.uniform3f(loc.c3, r3,g3,b3);
    gl.uniform3f(loc.c4, r4,g4,b4);

    gl.uniform1f(loc.u_noise, Number(ui.noise.value));
    gl.uniform1f(loc.u_speed, Number(ui.speed.value));
    gl.uniform1f(loc.u_Strength, Number(ui.Strength.value));
    gl.uniform1f(loc.u_Radius, Number(ui.Radius.value));
    gl.uniform1f(loc.u_banding, Number(ui.banding.value));

    gl.uniform1f(loc.u_grain, Number(ui.grain.value));
    gl.uniform1f(loc.u_grainEnabled, ui.grainEnabled.checked ? 1.0 : 0.0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
})();
