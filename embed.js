/* 
   Usage:
     MonopoGradient.mount("#el", { colors:[...], noise, speed, grain, grainEnabled, mouseStrength, banding })
*/
(function () {
  function clamp01(v){ return Math.max(0, Math.min(1, v)); }

  function hexToRgb01(hex) {
    const h = String(hex || "#000000").replace("#","").trim();
    const bigint = parseInt(h.length === 3 ? h.split("").map(c=>c+c).join("") : h, 16);
    return [((bigint>>16)&255)/255, ((bigint>>8)&255)/255, (bigint&255)/255];
  }

  function mount(selector, config) {
    const host = document.querySelector(selector);
    if (!host) throw new Error("MonopoGradient: mount element not found: " + selector);

    const cfg = Object.assign({
      colors: ["#223BFF","#FF6A2B","#0B0B10","#9CB6C7"],
      noise: 0.48,
      speed: 0.35,
      mouseStrength: 0.16,
      banding: 1.15,
      grain: 0.08,
      grainEnabled: true,
    }, config || {});

    // host styling (safe defaults)
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    if (!host.style.height) host.style.height = "100vh";
    host.style.overflow = "hidden";

    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    host.appendChild(canvas);

    const gl = canvas.getContext("webgl", { antialias:false, premultipliedAlpha:false });
    if (!gl) throw new Error("MonopoGradient: WebGL not supported");

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
        vec2 uv = v_uv;
        float aspect = u_resolution.x / u_resolution.y;
        uv.x *= aspect;

        float t = u_time * u_speed;

        vec2 flow = vec2(
          fbm(uv * 1.35 + vec2(0.0, t * 0.18)),
          fbm(uv * 1.35 + vec2(10.0, -t * 0.16))
        );
        uv += (flow - 0.5) * u_noise;

        vec2 m = u_mouse;
        m.x *= aspect;
        vec2 mcenter = m - vec2(0.5 * aspect, 0.5);
        uv += mcenter * u_mouseStrength;

        float g1 = smoothstep(0.0, 1.0, uv.y);
        float g2 = smoothstep(0.0, 1.0, uv.x / aspect);
        float g3 = smoothstep(0.0, 1.0, (uv.y + (uv.x / aspect)) * 0.5);

        g1 = pow(g1, u_banding);
        g2 = pow(g2, u_banding * 0.92);
        g3 = pow(g3, u_banding * 1.05);

        vec3 col = mix(c1, c2, g1);
        col = mix(col, c3, g2 * 0.85);
        col = mix(col, c4, g3 * 0.80);

        col = pow(col, vec3(0.96));
        col *= 1.03;

        vec2 p = (v_uv - 0.5);
        float vig = smoothstep(0.95, 0.25, dot(p,p));
        col *= mix(0.80, 1.0, vig);

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

    const prog = link(compile(gl.VERTEX_SHADER, vertSrc), compile(gl.FRAGMENT_SHADER, fragSrc));

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1,  -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);

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

    const mouse = { x: 0.5, y: 0.5 };
    const mouseT = { x: 0.5, y: 0.5 };

    host.addEventListener("mousemove", (e) => {
      const r = host.getBoundingClientRect();
      mouseT.x = clamp01((e.clientX - r.left) / r.width);
      mouseT.y = clamp01(1.0 - (e.clientY - r.top) / r.height);
    });

    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = host.getBoundingClientRect();
      const w = Math.max(2, Math.floor(r.width * dpr));
      const h = Math.max(2, Math.floor(r.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    }

    const [r1,g1,b1] = hexToRgb01(cfg.colors[0]);
    const [r2,g2,b2] = hexToRgb01(cfg.colors[1]);
    const [r3,g3,b3] = hexToRgb01(cfg.colors[2]);
    const [r4,g4,b4] = hexToRgb01(cfg.colors[3]);

    function frame(ms) {
      resize();

      mouse.x += (mouseT.x - mouse.x) * 0.08;
      mouse.y += (mouseT.y - mouse.y) * 0.08;

      gl.useProgram(prog);

      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(loc.a_pos);
      gl.vertexAttribPointer(loc.a_pos, 2, gl.FLOAT, false, 0, 0);

      gl.uniform2f(loc.u_resolution, canvas.width, canvas.height);
      gl.uniform1f(loc.u_time, ms * 0.001);
      gl.uniform2f(loc.u_mouse, mouse.x, mouse.y);

      gl.uniform3f(loc.c1, r1,g1,b1);
      gl.uniform3f(loc.c2, r2,g2,b2);
      gl.uniform3f(loc.c3, r3,g3,b3);
      gl.uniform3f(loc.c4, r4,g4,b4);

      gl.uniform1f(loc.u_noise, Number(cfg.noise));
      gl.uniform1f(loc.u_speed, Number(cfg.speed));
      gl.uniform1f(loc.u_mouseStrength, Number(cfg.mouseStrength));
      gl.uniform1f(loc.u_banding, Number(cfg.banding));
      gl.uniform1f(loc.u_grain, Number(cfg.grain));
      gl.uniform1f(loc.u_grainEnabled, cfg.grainEnabled ? 1.0 : 0.0);

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);

    return {
      canvas,
      destroy() { canvas.remove(); },
    };
  }

  window.MonopoGradient = { mount };
})();
