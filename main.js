/* fullscreen shader gradient + UI + embed generator
   - Directional gradient bands
   - Slow FBM flow warp
   - Mouse-driven global deformation
   - Grain toggle
   - Embeddable snippet generator (uses embed.js)
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

    mouseStrength: document.getElementById("mouseStrength"),
    mouseStrengthVal: document.getElementById("mouseStrengthVal"),

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

  ui.togglePanel.addEventListener("click", () => ui.panel.classList.toggle("collapsed"));

  function fatal(msg) {
    overlay.hidden = false;
    overlay.textContent = msg;
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

  // ---- Shader sources
  const vertSrc = `
    attribute vec2 a_pos;
    varying vec2 v_uv;
    void main(){
      v_uv = a_pos * 0.5 + 0.5;
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;

  // NOTE: arrays not needed; Monopo style is continuous fields + bands
  const fragSrc = `
    precision highp float;
    varying vec2 v_uv;

    uniform vec2 u_resolution;
    uniform float u_time;
    uniform vec2 u_mouse;

    uniform vec3 c1;
    uniform vec3 c2;
    uniform vec3 c3;
    uniform vec3 c4;

    uniform float u_noise;
    uniform float u_speed;
    uniform float u_grain;
    uniform float u_grainEnabled;
    uniform float u_mouseStrength;
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

    void main(){
      // aspect-correct uv for nicer diagonals
      vec2 uv = v_uv;
      float aspect = u_resolution.x / u_resolution.y;
      uv.x *= aspect;

      float t = u_time * u_speed;

      // Big, slow flow warp (very low frequency)
      vec2 flow = vec2(
        fbm(uv * 1.35 + vec2(0.0, t * 0.18)),
        fbm(uv * 1.35 + vec2(10.0, -t * 0.16))
      );

      uv += (flow - 0.5) * u_noise;

      // Mouse = global field push (Monopo feel)
      vec2 m = u_mouse; // 0..1
      m.x *= aspect;
      vec2 mcenter = m - vec2(0.5 * aspect, 0.5);

      uv += mcenter * u_mouseStrength;

      // Directional band gradients (the "large color ramps")
      // Adjust u_banding for tighter/looser transitions.
      float g1 = smoothstep(0.0, 1.0, uv.y);
      float g2 = smoothstep(0.0, 1.0, uv.x / aspect);
      float g3 = smoothstep(0.0, 1.0, (uv.y + (uv.x / aspect)) * 0.5);

      // extra shaping for that band look
      g1 = pow(g1, u_banding);
      g2 = pow(g2, u_banding * 0.92);
      g3 = pow(g3, u_banding * 1.05);

      vec3 col = mix(c1, c2, g1);
      col = mix(col, c3, g2 * 0.85);
      col = mix(col, c4, g3 * 0.80);

      // Subtle contrast / softness
      col = pow(col, vec3(0.96));
      col *= 1.03;

      // vignette (Monopo corners often darker)
      vec2 p = (v_uv - 0.5);
      float vig = smoothstep(0.95, 0.25, dot(p,p));
      col *= mix(0.80, 1.0, vig);

      // Grain
      if (u_grainEnabled > 0.5) {
        float g = hash(gl_FragCoord.xy + u_time*120.0) - 0.5;
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
    u_mouse: gl.getUniformLocation(prog, "u_mouse"),

    c1: gl.getUniformLocation(prog, "c1"),
    c2: gl.getUniformLocation(prog, "c2"),
    c3: gl.getUniformLocation(prog, "c3"),
    c4: gl.getUniformLocation(prog, "c4"),

    u_noise: gl.getUniformLocation(prog, "u_noise"),
    u_speed: gl.getUniformLocation(prog, "u_speed"),
    u_grain: gl.getUniformLocation(prog, "u_grain"),
    u_grainEnabled: gl.getUniformLocation(prog, "u_grainEnabled"),
    u_mouseStrength: gl.getUniformLocation(prog, "u_mouseStrength"),
    u_banding: gl.getUniformLocation(prog, "u_banding"),
  };

  // ---- State
  const state = {
    mouse: { x: 0.5, y: 0.5 },
    mouseTarget: { x: 0.5, y: 0.5 },
    time: 0,
  };

  window.addEventListener("mousemove", (e) => {
    state.mouseTarget.x = e.clientX / window.innerWidth;
    state.mouseTarget.y = 1.0 - (e.clientY / window.innerHeight);
  });

  function hexToRgb01(hex) {
    const h = hex.replace("#", "").trim();
    const bigint = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
    return [((bigint >> 16) & 255)/255, ((bigint >> 8) & 255)/255, (bigint & 255)/255];
  }

  function randomPalette() {
    // keep "Monopo-ish": one deep, one warm, one near-black, one cool
    const deep = ["#1E2BFF","#223BFF","#2032C8","#1A2C8F"][Math.floor(Math.random()*4)];
    const warm = ["#FF6A2B","#FF5B1F","#E85B2F","#D85A38"][Math.floor(Math.random()*4)];
    const dark = ["#0B0B10","#0E0E12","#0A0A0E","#0D0D12"][Math.floor(Math.random()*4)];
    const cool = ["#9CB6C7","#A7C1D1","#8FA7C7","#B1C9D5"][Math.floor(Math.random()*4)];
    ui.c1.value = deep;
    ui.c2.value = warm;
    ui.c3.value = dark;
    ui.c4.value = cool;
  }

  ui.randomize.addEventListener("click", randomPalette);

  function hookSlider(slider, out) {
    const update = () => (out.textContent = Number(slider.value).toFixed(2));
    slider.addEventListener("input", update);
    update();
  }

  hookSlider(ui.noise, ui.noiseVal);
  hookSlider(ui.speed, ui.speedVal);
  hookSlider(ui.mouseStrength, ui.mouseStrengthVal);
  hookSlider(ui.banding, ui.bandingVal);
  hookSlider(ui.grain, ui.grainVal);

  // ---- Embed generator
  function currentConfig() {
    return {
      colors: [ui.c1.value, ui.c2.value, ui.c3.value, ui.c4.value],
      noise: Number(ui.noise.value),
      speed: Number(ui.speed.value),
      mouseStrength: Number(ui.mouseStrength.value),
      banding: Number(ui.banding.value),
      grain: Number(ui.grain.value),
      grainEnabled: ui.grainEnabled.checked,
    };
  }

  function generateEmbedSnippet() {
    const sel = (ui.embedSelector.value || "#my-gradient").trim();
    const cfg = currentConfig();
    const json = JSON.stringify(cfg, null, 2);

    // embed.js must be hosted alongside, or from your CDN
    return [
      `<!-- Monopo-style gradient mount point -->`,
      `<div id="${sel.startsWith("#") ? sel.slice(1) : sel}"></div>`,
      ``,
      `<!-- Include the embed runtime -->`,
      `<script src="./embed.js"></script>`,
      ``,
      `<!-- Mount with config -->`,
      `<script>`,
      `  MonopoGradient.mount(${JSON.stringify(sel)}, ${json});`,
      `</script>`
    ].join("\n");
  }

  ui.generateEmbed.addEventListener("click", () => {
    ui.embedOut.value = generateEmbedSnippet();
  });

  ui.copyEmbed.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(ui.embedOut.value || generateEmbedSnippet());
      ui.copyEmbed.textContent = "Copied!";
      setTimeout(() => (ui.copyEmbed.textContent = "Copy"), 900);
    } catch {
      alert("Clipboard blocked. Copy manually from the textarea.");
    }
  });

  // initialize embed textarea
  ui.embedOut.value = generateEmbedSnippet();

  // ---- Render
  function render(ms) {
    resize();

    // smooth mouse to feel premium
    const lerp = 0.08;
    state.mouse.x += (state.mouseTarget.x - state.mouse.x) * lerp;
    state.mouse.y += (state.mouseTarget.y - state.mouse.y) * lerp;

    gl.useProgram(prog);

    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(loc.a_pos);
    gl.vertexAttribPointer(loc.a_pos, 2, gl.FLOAT, false, 0, 0);

    gl.uniform2f(loc.u_resolution, canvas.width, canvas.height);
    gl.uniform1f(loc.u_time, ms * 0.001);
    gl.uniform2f(loc.u_mouse, state.mouse.x, state.mouse.y);

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
    gl.uniform1f(loc.u_mouseStrength, Number(ui.mouseStrength.value));
    gl.uniform1f(loc.u_banding, Number(ui.banding.value));
    gl.uniform1f(loc.u_grain, Number(ui.grain.value));
    gl.uniform1f(loc.u_grainEnabled, ui.grainEnabled.checked ? 1.0 : 0.0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
})();
