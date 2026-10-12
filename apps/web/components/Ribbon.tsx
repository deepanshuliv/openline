"use client";

import { useEffect, useRef, useState } from "react";

// Full-bleed hero ribbon: a smooth twisted band travelling left to right,
// rendered by a small WebGL fragment shader so every pixel is shaded at full
// resolution. Per column the twist angle sets the band's projected width (it
// pinches to an edge where it turns over) and a deep-to-light gradient slides
// with the turn. What makes it Openline's:
// - colours come from the active palette (--ribbon-* CSS variables);
// - it breathes like a voice: the band swells in travelling, speech-like pulses;
// - satin texture: fine grooves run along the band, like woven fabric;
// - a pearlescent sheen line with a slow iridescent shift rides the turn;
// - a soft tinted shadow underneath lifts it off the page;
// - an occasional thin accent streak hugs one edge, and faint film grain keeps
//   it from looking digital.
// Motion pauses off-screen; reduced motion renders a single still frame; no
// WebGL falls back to a static CSS band.

const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAGMENT = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uDpr;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uLight;
uniform vec3 uAccent;

const float TAU = 6.28318530718;
const vec3 PAPER = vec3(0.965, 0.961, 0.945);

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  float x = gl_FragCoord.x / uRes.x;
  float y = uRes.y - gl_FragCoord.y;
  float H = uRes.y;

  // Subtracting time moves the shape toward +x (left to right).
  float phi = x * 2.05 * TAU - uTime * 0.42;

  // Irregular centreline and twist: incommensurate sines so lobes vary.
  float cy = H * (0.5
    + 0.12 * sin(phi * 0.83 + 0.6)
    + 0.06 * sin(phi * 1.71 + 1.4)
    + 0.04 * sin(phi * 0.37 - 0.9));
  float twist = phi * 1.02 + 0.85 * sin(phi * 0.41 + 0.3);
  float c = cos(twist);
  float s = sin(twist);
  float open = abs(c);

  // Speech-like swell: pulses travel along the band and come in phrases.
  float syllable = 0.5 + 0.5 * sin(phi * 0.9 - uTime * 2.1);
  float phrase = 0.6 + 0.4 * sin(uTime * 0.73 + phi * 0.2);
  float voice = syllable * syllable * phrase;
  float thick = H * (0.21 + 0.05 * sin(phi * 0.53 + 2.0)) * (0.9 + 0.22 * voice);
  float halfW = thick * (0.025 + 0.975 * open);
  float lean = thick * 0.28 * s;
  float top = cy - halfW + lean;
  float bottom = cy + halfW + lean;

  // Anti-aliased coverage across ~1.5 device pixels at each edge.
  float aa = 1.2 * uDpr;
  float cover = smoothstep(top - aa, top + aa * 0.5, y) * (1.0 - smoothstep(bottom - aa * 0.5, bottom + aa, y));
  if (cover <= 0.0) {
    // Soft tinted shadow below the band, strongest where it faces the viewer.
    float d = (y - bottom) / (H * 0.07);
    float shadow = d > 0.0 ? exp(-d * d) * (0.05 + 0.07 * open) : 0.0;
    gl_FragColor = vec4(uDeep * 0.55 * shadow, shadow);
    return;
  }

  float v = clamp((y - top) / max(bottom - top, 0.001), 0.0, 1.0);

  // Deepest along a line that slides across the band as it turns.
  float darkAt = 0.5 - 0.36 * s;
  float l = smoothstep(0.0, 0.7, abs(v - darkAt));
  vec3 col = mix(uDeep, uMid, smoothstep(0.0, 0.35, l));
  col = mix(col, uLight, smoothstep(0.3, 1.0, l));

  // Satin grooves running along the band, fading where it turns edge-on.
  float groove = sin((v + 0.08 * s) * 120.0);
  col *= 1.0 - 0.035 * groove * open;

  // Side-on slices wash out toward paper, like light glancing off the edge.
  float wash = 1.0 - smoothstep(0.04, 0.55, open);
  col = mix(col, PAPER, wash * 0.65);

  // Pearlescent sheen: a thin highlight with a slow iridescent shift.
  float sheenAt = 0.5 + 0.42 * c;
  float sheen = smoothstep(0.07, 0.0, abs(v - sheenAt)) * smoothstep(0.15, 0.8, open);
  vec3 pearl = mix(vec3(1.0), 0.5 + 0.5 * cos(TAU * (phi * 0.06 - uTime * 0.05 + vec3(0.0, 0.33, 0.67))), 0.22);
  col = mix(col, pearl, sheen * 0.6);

  // A thin accent streak hugging one edge, only in some stretches of the band.
  float gate = smoothstep(0.62, 0.92, 0.5 + 0.5 * sin(phi * 0.47 + 1.1));
  float accentAt = 0.5 + 0.4 * s;
  float streak = smoothstep(0.14, 0.0, abs(v - accentAt)) * gate * smoothstep(-0.2, 0.6, -c + 0.25);
  col = mix(col, uAccent, clamp(streak * 0.9, 0.0, 1.0));

  // Faint film grain: luminance jitter, a touch stronger near the edges.
  float n = hash(gl_FragCoord.xy) - 0.5;
  float edge = 1.0 - smoothstep(0.0, 0.07, min(v, 1.0 - v));
  col += n * (0.022 + 0.03 * edge);

  float alpha = cover;
  // Slightly dissolve the outermost fringe with the same grain.
  alpha *= 1.0 - edge * 0.18 * step(0.2, n + 0.5);
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

const MAX_DPR = 2;

// Lagoon, used if the CSS variables are missing.
const FALLBACK = {
  deep: [0.165, 0.561, 0.576],
  mid: [0.553, 0.827, 0.812],
  light: [0.902, 0.961, 0.953],
  accent: [0.482, 0.549, 1.0],
} as const;

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255] : null;
}
const STILL_TIME_S = 3.2;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function Ribbon() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, antialias: false, alpha: true });
    const vs = gl && compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = gl && compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl && vs && fs ? gl.createProgram() : null;
    if (!gl || !vs || !fs || !program) {
      setFallback(true);
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      setFallback(true);
      return;
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(program, "uRes");
    const uTime = gl.getUniformLocation(program, "uTime");
    const uDpr = gl.getUniformLocation(program, "uDpr");
    const colorUniforms = (["Deep", "Mid", "Light", "Accent"] as const).map((n) => gl.getUniformLocation(program, `u${n}`));

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let dpr = 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      // Palette colours from CSS, so the ribbon follows the active theme.
      const style = getComputedStyle(canvas);
      (["deep", "mid", "light", "accent"] as const).forEach((n, i) => {
        const [r, g, b] = hexToRgb(style.getPropertyValue(`--ribbon-${n}`).trim()) ?? FALLBACK[n];
        gl.uniform3f(colorUniforms[i]!, r, g, b);
      });
    };

    const draw = (timeS: number) => {
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, timeS);
      gl.uniform1f(uDpr, dpr);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    resize();
    const start = performance.now();
    let raf = 0;
    let visible = true;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden) return;
      draw((now - start) / 1000);
    };
    if (reduceMotion) draw(STILL_TIME_S);
    else raf = requestAnimationFrame(loop);

    const resizeObserver = new ResizeObserver(() => {
      resize();
      if (reduceMotion) draw(STILL_TIME_S);
    });
    resizeObserver.observe(canvas);
    const visibility = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    visibility.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      visibility.disconnect();
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, []);

  return (
    <div className={fallback ? "ribbon ribbonFallback" : "ribbon"} aria-hidden="true">
      {!fallback && <canvas ref={canvasRef} />}
    </div>
  );
}
