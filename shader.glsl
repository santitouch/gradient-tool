precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;

// colors
uniform vec3 c1;
uniform vec3 c2;
uniform vec3 c3;
uniform vec3 c4;

// controls
uniform float u_noise;
uniform float u_speed;
uniform float u_grain;
uniform float u_mouseStrength;

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
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) +
         (c - a) * u.y * (1.0 - u.x) +
         (d - b) * u.x * u.y;
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  uv.x *= u_resolution.x / u_resolution.y;

  float t = u_time * u_speed;

  // large flowing warp
  vec2 flow = vec2(
    fbm(uv * 1.5 + t),
    fbm(uv * 1.5 - t)
  );

  uv += (flow - 0.5) * u_noise;

  // mouse influence (global push, not local lens)
  vec2 m = u_mouse - 0.5;
  uv += m * u_mouseStrength;

  // directional gradient bands
  float g1 = smoothstep(0.0, 0.6, uv.y);
  float g2 = smoothstep(0.2, 0.8, uv.x);
  float g3 = smoothstep(0.4, 1.0, uv.y + uv.x);

  vec3 col =
    mix(c1, c2, g1);
  col = mix(col, c3, g2);
  col = mix(col, c4, g3 * 0.8);

  // vignette
  vec2 p = uv - 0.5;
  col *= smoothstep(0.9, 0.3, dot(p, p));

  // grain
  float grain = hash(gl_FragCoord.xy + u_time) - 0.5;
  col += grain * u_grain;

  gl_FragColor = vec4(col, 1.0);
}
