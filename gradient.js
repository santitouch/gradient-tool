const canvas = document.querySelector("canvas");
const gl = canvas.getContext("webgl");

function resize() {
  canvas.width = innerWidth * devicePixelRatio;
  canvas.height = innerHeight * devicePixelRatio;
  gl.viewport(0, 0, canvas.width, canvas.height);
}
resize();
addEventListener("resize", resize);

// compile helpers omitted for brevity (same as standard)

const uniforms = {
  u_time: 0,
  u_mouse: [0.5, 0.5],
};

addEventListener("mousemove", e => {
  uniforms.u_mouse[0] = e.clientX / innerWidth;
  uniforms.u_mouse[1] = 1.0 - e.clientY / innerHeight;
});

function loop(t) {
  uniforms.u_time = t * 0.001;

  // set uniforms here
  // draw fullscreen quad

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
