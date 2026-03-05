import { useState, useEffect, useRef, useCallback } from "preact/hooks";

// -----------------------------------------------------------------
// Types
// -----------------------------------------------------------------

interface ShaderError {
  line: number;
  message: string;
}

interface ShaderPreset {
  name: string;
  code: string;
}

// -----------------------------------------------------------------
// Vertex shader (fixed fullscreen quad)
// -----------------------------------------------------------------

const VERTEX_SHADER = `attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

// -----------------------------------------------------------------
// Preset fragment shaders
// -----------------------------------------------------------------

const PRESET_SHADERS: ShaderPreset[] = [
  {
    name: "Gradient",
    code: `precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
varying vec2 v_uv;

void main() {
  vec2 uv = v_uv;
  vec3 col = 0.5 + 0.5 * cos(u_time + uv.xyx + vec3(0, 2, 4));
  gl_FragColor = vec4(col, 1.0);
}`,
  },
  {
    name: "Plasma",
    code: `precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
varying vec2 v_uv;

void main() {
  vec2 uv = v_uv * 8.0;
  float t = u_time * 0.8;

  float v1 = sin(uv.x + t);
  float v2 = sin(uv.y + t);
  float v3 = sin(uv.x + uv.y + t);
  float v4 = sin(length(uv - 4.0) + 1.5 * t);

  float v = v1 + v2 + v3 + v4;

  vec3 col = vec3(
    sin(v * 3.14159) * 0.5 + 0.5,
    sin(v * 3.14159 + 2.094) * 0.5 + 0.5,
    sin(v * 3.14159 + 4.189) * 0.5 + 0.5
  );

  gl_FragColor = vec4(col, 1.0);
}`,
  },
  {
    name: "Raymarched Sphere",
    code: `precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
varying vec2 v_uv;

float sdSphere(vec3 p, float r) {
  return length(p) - r;
}

float scene(vec3 p) {
  return sdSphere(p, 1.0);
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.001, 0.0);
  return normalize(vec3(
    scene(p + e.xyy) - scene(p - e.xyy),
    scene(p + e.yxy) - scene(p - e.yxy),
    scene(p + e.yyx) - scene(p - e.yyx)
  ));
}

void main() {
  vec2 uv = v_uv * 2.0 - 1.0;
  uv.x *= u_resolution.x / u_resolution.y;

  vec3 ro = vec3(0.0, 0.0, 3.0);
  vec3 rd = normalize(vec3(uv, -1.5));

  float t = 0.0;
  float d;
  for (int i = 0; i < 64; i++) {
    vec3 p = ro + rd * t;
    d = scene(p);
    if (d < 0.001) break;
    t += d;
    if (t > 20.0) break;
  }

  vec3 col = vec3(0.05, 0.05, 0.1);

  if (d < 0.001) {
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p);
    vec3 light = normalize(vec3(sin(u_time), 1.0, cos(u_time)));
    float diff = max(dot(n, light), 0.0);
    float spec = pow(max(dot(reflect(-light, n), -rd), 0.0), 32.0);
    vec3 baseCol = vec3(0.3, 0.5, 0.9);
    col = baseCol * (0.15 + 0.85 * diff) + vec3(1.0) * spec * 0.5;
  }

  gl_FragColor = vec4(col, 1.0);
}`,
  },
  {
    name: "Fire",
    code: `precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
varying vec2 v_uv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = rot * p * 2.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = v_uv;
  uv.x *= u_resolution.x / u_resolution.y;

  float t = u_time * 1.5;
  vec2 q = vec2(
    fbm(uv + vec2(0.0, t * 0.7)),
    fbm(uv + vec2(5.2, t * 0.4))
  );
  float f = fbm(uv + 4.0 * q);

  float fire = f * (1.0 - uv.y);
  fire = clamp(fire * 2.5, 0.0, 1.0);

  vec3 col = mix(
    vec3(0.1, 0.0, 0.0),
    vec3(1.0, 0.3, 0.0),
    fire
  );
  col = mix(col, vec3(1.0, 0.9, 0.4), pow(fire, 3.0));

  gl_FragColor = vec4(col, 1.0);
}`,
  },
  {
    name: "Waves",
    code: `precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
varying vec2 v_uv;

void main() {
  vec2 uv = v_uv;
  uv.x *= u_resolution.x / u_resolution.y;

  float t = u_time * 0.8;
  vec3 col = vec3(0.0);

  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    float freq = 1.5 + fi * 0.4;
    float amp = 0.06 / (fi * 0.3 + 1.0);
    float phase = fi * 0.7;

    float wave = sin(uv.x * freq * 6.2832 + t * (1.0 + fi * 0.2) + phase) * amp;
    float y = 0.15 + fi * 0.1 + wave;

    float d = abs(uv.y - y);
    float glow = 0.004 / (d + 0.002);

    vec3 c = 0.5 + 0.5 * cos(vec3(0, 2, 4) + fi * 0.5 + t * 0.3);
    col += c * glow;
  }

  col = clamp(col, 0.0, 1.0);
  gl_FragColor = vec4(col, 1.0);
}`,
  },
  {
    name: "Mandelbrot",
    code: `precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
varying vec2 v_uv;

void main() {
  vec2 uv = v_uv * 2.0 - 1.0;
  uv.x *= u_resolution.x / u_resolution.y;

  float zoom = 1.0 + sin(u_time * 0.15) * 0.5;
  vec2 center = vec2(-0.745, 0.186);
  vec2 c = center + uv / pow(2.0, zoom * 3.0 + 1.0);

  vec2 z = vec2(0.0);
  float iter = 0.0;
  const float maxIter = 128.0;

  for (float i = 0.0; i < 128.0; i++) {
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    if (dot(z, z) > 4.0) break;
    iter++;
  }

  float t = iter / maxIter;
  vec3 col = vec3(0.0);
  if (iter < maxIter) {
    float smooth_t = t + 1.0 - log(log(length(z))) / log(2.0);
    smooth_t = smooth_t / maxIter;
    col = 0.5 + 0.5 * cos(6.2832 * (smooth_t * 3.0 + vec3(0.0, 0.33, 0.67)));
  }

  gl_FragColor = vec4(col, 1.0);
}`,
  },
  {
    name: "Voronoi",
    code: `precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
varying vec2 v_uv;

vec2 hash2(vec2 p) {
  p = vec2(
    dot(p, vec2(127.1, 311.7)),
    dot(p, vec2(269.5, 183.3))
  );
  return fract(sin(p) * 43758.5453);
}

void main() {
  vec2 uv = v_uv * 5.0;
  vec2 ip = floor(uv);
  vec2 fp = fract(uv);

  float minDist = 1.0;
  vec2 minPoint = vec2(0.0);

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 neighbor = vec2(float(x), float(y));
      vec2 point = hash2(ip + neighbor);
      point = 0.5 + 0.5 * sin(u_time * 0.6 + 6.2832 * point);
      vec2 diff = neighbor + point - fp;
      float d = length(diff);
      if (d < minDist) {
        minDist = d;
        minPoint = point;
      }
    }
  }

  vec3 col = 0.5 + 0.5 * cos(vec3(0, 2, 4) + minPoint.x * 6.0 + u_time * 0.3);
  col *= 0.7 + 0.3 * smoothstep(0.0, 0.05, minDist);
  col += 0.15 * exp(-10.0 * minDist);

  gl_FragColor = vec4(col, 1.0);
}`,
  },
  {
    name: "Matrix Rain",
    code: `precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
varying vec2 v_uv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float char(vec2 uv, float seed) {
  vec2 grid = floor(uv * vec2(4.0, 5.0));
  float h = hash(grid + seed);
  return step(0.5, h);
}

void main() {
  vec2 uv = v_uv;
  uv.x *= u_resolution.x / u_resolution.y;

  float cols = 30.0;
  vec2 cell = vec2(cols, cols * 1.5);
  vec2 id = floor(uv * cell);
  vec2 fc = fract(uv * cell);

  float colHash = hash(vec2(id.x, 0.0));
  float speed = 1.5 + colHash * 3.0;
  float drop = fract(colHash * 100.0 + u_time * speed * 0.2);

  float row = id.y / cell.y;
  float trail = fract(row + drop);
  float brightness = smoothstep(0.0, 0.4, trail) * smoothstep(1.0, 0.6, trail);

  float seed = hash(id + floor(u_time * speed * 0.5));
  float ch = char(fc, seed);

  vec3 col = vec3(0.1, 1.0, 0.3) * brightness * ch;

  float head = smoothstep(0.02, 0.0, abs(trail - 0.98));
  col += vec3(0.7, 1.0, 0.8) * head * ch;

  col *= 0.8 + 0.2 * sin(uv.y * 300.0);

  gl_FragColor = vec4(col, 1.0);
}`,
  },
  {
    name: "Noise Landscape",
    code: `precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
varying vec2 v_uv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 6; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = v_uv;
  uv.x *= u_resolution.x / u_resolution.y;

  float t = u_time * 0.1;
  float n = fbm(uv * 3.0 + vec2(t, 0.0));
  float terrain = smoothstep(0.3, 0.7, n);

  vec3 water = vec3(0.1, 0.2, 0.6) + 0.1 * sin(u_time + uv.x * 20.0);
  vec3 sand = vec3(0.76, 0.7, 0.5);
  vec3 grass = vec3(0.2, 0.5, 0.15);
  vec3 rock = vec3(0.4, 0.35, 0.3);
  vec3 snow = vec3(0.9, 0.92, 0.95);

  vec3 col = water;
  col = mix(col, sand, smoothstep(0.3, 0.35, n));
  col = mix(col, grass, smoothstep(0.4, 0.45, n));
  col = mix(col, rock, smoothstep(0.6, 0.65, n));
  col = mix(col, snow, smoothstep(0.75, 0.8, n));

  float contour = abs(fract(n * 10.0) - 0.5);
  col *= 0.9 + 0.1 * smoothstep(0.0, 0.05, contour);

  gl_FragColor = vec4(col, 1.0);
}`,
  },
  {
    name: "Circle SDF",
    code: `precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
varying vec2 v_uv;

float sdCircle(vec2 p, float r) {
  return length(p) - r;
}

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float opUnion(float d1, float d2) {
  return min(d1, d2);
}

float opSubtraction(float d1, float d2) {
  return max(-d1, d2);
}

float opSmoothUnion(float d1, float d2, float k) {
  float h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
  return mix(d2, d1, h) - k * h * (1.0 - h);
}

void main() {
  vec2 uv = v_uv * 2.0 - 1.0;
  uv.x *= u_resolution.x / u_resolution.y;

  float t = u_time * 0.5;

  float c1 = sdCircle(uv - vec2(sin(t) * 0.4, 0.0), 0.35);
  float c2 = sdCircle(uv - vec2(-sin(t) * 0.4, 0.0), 0.35);
  float b1 = sdBox(uv - vec2(0.0, sin(t * 1.3) * 0.3), vec2(0.2));

  float d = opSmoothUnion(c1, c2, 0.3);
  d = opSmoothUnion(d, b1, 0.2);

  vec3 col = vec3(0.95);

  float band = fract(d * 15.0);
  vec3 fieldCol = 0.5 + 0.5 * cos(vec3(0, 2, 4) + d * 8.0 + u_time);
  col = mix(fieldCol, vec3(0.0), smoothstep(0.48, 0.5, band) - smoothstep(0.5, 0.52, band));

  col = mix(col, vec3(0.0), 1.0 - smoothstep(0.0, 0.005, abs(d)));

  float inside = smoothstep(0.01, -0.01, d);
  col = mix(col, fieldCol * 0.6, inside * 0.3);

  gl_FragColor = vec4(col, 1.0);
}`,
  },
];

// -----------------------------------------------------------------
// WebGL helpers
// -----------------------------------------------------------------

function createShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    return shader;
  }
  return shader;
}

function createProgram(
  gl: WebGLRenderingContext,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader
): WebGLProgram | null {
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function parseShaderErrors(log: string): ShaderError[] {
  const errors: ShaderError[] = [];
  const lines = log.split("\n");
  for (const line of lines) {
    const match = line.match(/ERROR:\s*\d+:(\d+):\s*(.*)/);
    if (match) {
      errors.push({
        line: parseInt(match[1], 10),
        message: match[2].trim(),
      });
    }
  }
  if (errors.length === 0 && log.trim().length > 0) {
    errors.push({ line: 0, message: log.trim() });
  }
  return errors;
}

function setupQuadBuffer(gl: WebGLRenderingContext): WebGLBuffer | null {
  const buffer = gl.createBuffer();
  if (!buffer) return null;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  );
  return buffer;
}

// -----------------------------------------------------------------
// Component
// -----------------------------------------------------------------

export default function ShaderPlayground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const bufferRef = useRef<WebGLBuffer | null>(null);
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const timeRef = useRef<number>(0);
  const pausedTimeRef = useRef<number>(0);
  const mouseRef = useRef<[number, number]>([0.5, 0.5]);
  const fpsFramesRef = useRef<number[]>([]);
  const lastFpsUpdateRef = useRef<number>(0);

  const [code, setCode] = useState<string>(PRESET_SHADERS[0].code);
  const [errors, setErrors] = useState<ShaderError[]>([]);
  const [compiled, setCompiled] = useState<boolean>(true);
  const [paused, setPaused] = useState<boolean>(false);
  const [autoCompile, setAutoCompile] = useState<boolean>(true);
  const [fps, setFps] = useState<number>(0);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [selectedPreset, setSelectedPreset] = useState<number>(0);
  const [contextLost, setContextLost] = useState<boolean>(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const codeRef = useRef<string>(code);
  const fullscreenContainerRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  codeRef.current = code;

  // ----- Compile shader -----
  const compileShader = useCallback((source: string) => {
    const gl = glRef.current;
    if (!gl) return;

    const vertShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    if (!vertShader) return;

    if (!gl.getShaderParameter(vertShader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(vertShader) || "";
      setErrors([{ line: 0, message: "Vertex shader error: " + log }]);
      setCompiled(false);
      gl.deleteShader(vertShader);
      return;
    }

    const fragShader = createShader(gl, gl.FRAGMENT_SHADER, source);
    if (!fragShader) {
      gl.deleteShader(vertShader);
      return;
    }

    if (!gl.getShaderParameter(fragShader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(fragShader) || "";
      setErrors(parseShaderErrors(log));
      setCompiled(false);
      gl.deleteShader(vertShader);
      gl.deleteShader(fragShader);
      return;
    }

    const program = createProgram(gl, vertShader, fragShader);
    gl.deleteShader(vertShader);
    gl.deleteShader(fragShader);

    if (!program) {
      setErrors([{ line: 0, message: "Failed to link shader program" }]);
      setCompiled(false);
      return;
    }

    if (programRef.current) {
      gl.deleteProgram(programRef.current);
    }
    programRef.current = program;
    setErrors([]);
    setCompiled(true);
  }, []);

  // ----- Debounced auto-compile -----
  const scheduleCompile = useCallback(
    (source: string) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        compileShader(source);
      }, 300);
    },
    [compileShader]
  );

  // ----- Handle code change -----
  const handleCodeChange = useCallback(
    (newCode: string) => {
      setCode(newCode);
      if (autoCompile) {
        scheduleCompile(newCode);
      }
    },
    [autoCompile, scheduleCompile]
  );

  // ----- Render loop -----
  const render = useCallback(() => {
    const gl = glRef.current;
    const program = programRef.current;
    const canvas = canvasRef.current;

    if (!gl || !program || !canvas) {
      rafRef.current = requestAnimationFrame(render);
      return;
    }

    const now = performance.now();

    // FPS calculation (update display every 500ms to avoid excessive re-renders)
    fpsFramesRef.current.push(now);
    while (
      fpsFramesRef.current.length > 0 &&
      fpsFramesRef.current[0] < now - 1000
    ) {
      fpsFramesRef.current.shift();
    }
    if (now - lastFpsUpdateRef.current > 500) {
      setFps(fpsFramesRef.current.length);
      lastFpsUpdateRef.current = now;
    }

    // Time management
    if (!paused) {
      timeRef.current = (now - startTimeRef.current) / 1000 - pausedTimeRef.current;
    }

    // Resize canvas to match display size
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = canvas.clientWidth;
    const displayHeight = canvas.clientHeight;
    const drawWidth = Math.floor(displayWidth * dpr);
    const drawHeight = Math.floor(displayHeight * dpr);

    if (canvas.width !== drawWidth || canvas.height !== drawHeight) {
      canvas.width = drawWidth;
      canvas.height = drawHeight;
    }

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);

    // Set uniforms
    const uTime = gl.getUniformLocation(program, "u_time");
    const uRes = gl.getUniformLocation(program, "u_resolution");
    const uMouse = gl.getUniformLocation(program, "u_mouse");

    if (uTime) gl.uniform1f(uTime, timeRef.current);
    if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);
    if (uMouse) gl.uniform2f(uMouse, mouseRef.current[0], mouseRef.current[1]);

    // Bind buffer and draw
    const aPos = gl.getAttribLocation(program, "a_position");
    gl.bindBuffer(gl.ARRAY_BUFFER, bufferRef.current);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    rafRef.current = requestAnimationFrame(render);
  }, [paused]);

  // ----- Init WebGL -----
  useEffect(() => {
    if (typeof window === "undefined") return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
      cancelAnimationFrame(rafRef.current);
    };

    const handleContextRestored = () => {
      setContextLost(false);
      initWebGL();
    };

    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);

    function initWebGL() {
      if (!canvas) return;
      const gl = canvas.getContext("webgl", {
        alpha: false,
        antialias: false,
        preserveDrawingBuffer: true,
      });
      if (!gl) return;

      glRef.current = gl;
      bufferRef.current = setupQuadBuffer(gl);
      startTimeRef.current = performance.now();
      timeRef.current = 0;
      pausedTimeRef.current = 0;

      compileShader(codeRef.current);
      rafRef.current = requestAnimationFrame(render);
    }

    initWebGL();

    return () => {
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      cancelAnimationFrame(rafRef.current);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (programRef.current && glRef.current) {
        glRef.current.deleteProgram(programRef.current);
      }
      if (bufferRef.current && glRef.current) {
        glRef.current.deleteBuffer(bufferRef.current);
      }
    };
  }, [compileShader, render]);

  // ----- Restart render loop when paused changes -----
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (contextLost) return;

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(render);
  }, [render, contextLost]);

  // ----- Mouse tracking on canvas -----
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = [
        (e.clientX - rect.left) / rect.width,
        1.0 - (e.clientY - rect.top) / rect.height,
      ];
    },
    []
  );

  // ----- Pause / unpause time tracking -----
  const togglePause = useCallback(() => {
    setPaused((prev) => {
      if (!prev) {
        // Pausing: record where we stopped
        pausedTimeRef.current =
          (performance.now() - startTimeRef.current) / 1000 - timeRef.current;
      }
      return !prev;
    });
  }, []);

  const resetTime = useCallback(() => {
    startTimeRef.current = performance.now();
    timeRef.current = 0;
    pausedTimeRef.current = 0;
  }, []);

  // ----- Screenshot -----
  const takeScreenshot = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = "shader-screenshot.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, []);

  // ----- Fullscreen -----
  const toggleFullscreen = useCallback(() => {
    const container = fullscreenContainerRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  // ----- Preset selection -----
  const handlePresetChange = useCallback(
    (index: number) => {
      setSelectedPreset(index);
      const preset = PRESET_SHADERS[index];
      setCode(preset.code);
      compileShader(preset.code);
    },
    [compileShader]
  );

  // ----- Scroll sync between textarea and line numbers -----
  const handleEditorScroll = useCallback((e: Event) => {
    const textarea = e.target as HTMLTextAreaElement;
    if (gutterRef.current) {
      gutterRef.current.scrollTop = textarea.scrollTop;
    }
  }, []);

  // ----- Line numbers -----
  const lineCount = code.split("\n").length;

  // ----- Render -----
  return (
    <div class="flex flex-col gap-4">
      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-3">
        <select
          class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
          value={selectedPreset}
          onChange={(e) =>
            handlePresetChange(parseInt((e.target as HTMLSelectElement).value, 10))
          }
        >
          {PRESET_SHADERS.map((preset, i) => (
            <option key={i} value={i}>
              {preset.name}
            </option>
          ))}
        </select>

        <button
          class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)]"
          onClick={() => compileShader(code)}
          title="Compile shader"
        >
          Compile
        </button>

        <button
          class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)]"
          onClick={togglePause}
          title={paused ? "Resume" : "Pause"}
        >
          {paused ? "Play" : "Pause"}
        </button>

        <button
          class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)]"
          onClick={resetTime}
          title="Reset time to 0"
        >
          Reset
        </button>

        <button
          class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)]"
          onClick={takeScreenshot}
          title="Download screenshot"
        >
          Screenshot
        </button>

        <label class="flex items-center gap-1.5 text-sm text-[var(--color-text-muted)]">
          <input
            type="checkbox"
            checked={autoCompile}
            onChange={(e) =>
              setAutoCompile((e.target as HTMLInputElement).checked)
            }
            class="accent-[var(--color-primary)]"
          />
          Auto-compile
        </label>
      </div>

      {/* Main panels */}
      <div class="flex flex-col gap-4 lg:flex-row lg:gap-4" style={{ minHeight: "500px" }}>
        {/* Editor panel */}
        <div class="flex flex-col lg:w-1/2">
          <div
            class="relative flex-1 overflow-hidden rounded-lg border border-[var(--color-border)]"
            style={{ minHeight: "400px" }}
          >
            {/* Line numbers + textarea */}
            <div class="flex h-full">
              {/* Line numbers gutter */}
              <div
                ref={gutterRef}
                class="select-none border-r border-[var(--color-border)] py-3 text-right"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "13px",
                  lineHeight: "1.5",
                  width: "3rem",
                  color: "var(--color-text-muted)",
                  backgroundColor: "color-mix(in srgb, var(--color-surface) 80%, transparent)",
                  overflow: "hidden",
                }}
              >
                <div class="px-2">
                  {Array.from({ length: lineCount }, (_, i) => (
                    <div
                      key={i}
                      style={{
                        color: errors.some((e) => e.line === i + 1)
                          ? "#ef4444"
                          : undefined,
                        fontWeight: errors.some((e) => e.line === i + 1)
                          ? "bold"
                          : undefined,
                      }}
                    >
                      {i + 1}
                    </div>
                  ))}
                </div>
              </div>

              {/* Code textarea */}
              <textarea
                class="h-full flex-1 resize-none border-none bg-[var(--color-surface)] p-3 text-[var(--color-text)] outline-none"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "13px",
                  lineHeight: "1.5",
                  tabSize: 2,
                }}
                value={code}
                onInput={(e) =>
                  handleCodeChange((e.target as HTMLTextAreaElement).value)
                }
                onScroll={handleEditorScroll}
                spellcheck={false}
                autocapitalize="off"
                autocomplete="off"
              />
            </div>
          </div>

          {/* Status / errors */}
          <div class="mt-2 min-h-[2rem]">
            {errors.length > 0 ? (
              <div class="space-y-1">
                {errors.map((err, i) => (
                  <div
                    key={i}
                    class="rounded px-3 py-1 text-xs"
                    style={{
                      fontFamily: "var(--font-mono)",
                      color: "#ef4444",
                      backgroundColor: "color-mix(in srgb, #ef4444 10%, transparent)",
                    }}
                  >
                    {err.line > 0 ? `Line ${err.line}: ` : ""}
                    {err.message}
                  </div>
                ))}
              </div>
            ) : compiled ? (
              <div
                class="rounded px-3 py-1 text-xs"
                style={{
                  fontFamily: "var(--font-mono)",
                  color: "var(--color-accent)",
                }}
              >
                Compiled successfully
              </div>
            ) : null}
          </div>
        </div>

        {/* Canvas panel */}
        <div class="flex flex-col lg:w-1/2" ref={fullscreenContainerRef}>
          <div
            class="relative flex-1 overflow-hidden rounded-lg border border-[var(--color-border)]"
            style={{
              minHeight: "400px",
              backgroundColor: isFullscreen ? "#000" : undefined,
            }}
          >
            {contextLost ? (
              <div class="flex h-full items-center justify-center text-sm text-[var(--color-text-muted)]">
                WebGL context lost. Waiting for restoration...
              </div>
            ) : (
              <canvas
                ref={canvasRef}
                class="h-full w-full"
                style={{ display: "block" }}
                onMouseMove={handleMouseMove}
              />
            )}

            {/* FPS counter */}
            <div
              class="absolute right-2 bottom-2 rounded px-2 py-0.5 text-xs"
              style={{
                fontFamily: "var(--font-mono)",
                color: "var(--color-text-muted)",
                backgroundColor: "color-mix(in srgb, var(--color-bg) 80%, transparent)",
              }}
            >
              {fps} FPS
            </div>

            {/* Fullscreen toggle */}
            <button
              class="absolute right-2 top-2 rounded px-2 py-1 text-xs transition-colors hover:text-[var(--color-heading)]"
              style={{
                fontFamily: "var(--font-mono)",
                color: "var(--color-text-muted)",
                backgroundColor: "color-mix(in srgb, var(--color-bg) 80%, transparent)",
              }}
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? "Exit FS" : "Fullscreen"}
            </button>

            {/* Pause indicator */}
            {paused && (
              <div
                class="absolute left-2 bottom-2 rounded px-2 py-0.5 text-xs"
                style={{
                  fontFamily: "var(--font-mono)",
                  color: "#fbbf24",
                  backgroundColor: "color-mix(in srgb, var(--color-bg) 80%, transparent)",
                }}
              >
                PAUSED
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Uniforms reference */}
      <div
        class="rounded-lg border border-[var(--color-border)] p-4"
        style={{ backgroundColor: "color-mix(in srgb, var(--color-surface) 60%, transparent)" }}
      >
        <div class="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          Available Uniforms
        </div>
        <div class="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          <div style={{ fontFamily: "var(--font-mono)" }}>
            <span style={{ color: "var(--color-primary)" }}>uniform float</span>{" "}
            <span style={{ color: "var(--color-accent)" }}>u_time</span>
            <span class="text-[var(--color-text-muted)]"> — seconds since start</span>
          </div>
          <div style={{ fontFamily: "var(--font-mono)" }}>
            <span style={{ color: "var(--color-primary)" }}>uniform vec2</span>{" "}
            <span style={{ color: "var(--color-accent)" }}>u_resolution</span>
            <span class="text-[var(--color-text-muted)]"> — canvas size (px)</span>
          </div>
          <div style={{ fontFamily: "var(--font-mono)" }}>
            <span style={{ color: "var(--color-primary)" }}>uniform vec2</span>{" "}
            <span style={{ color: "var(--color-accent)" }}>u_mouse</span>
            <span class="text-[var(--color-text-muted)]"> — mouse position (0-1)</span>
          </div>
          <div style={{ fontFamily: "var(--font-mono)" }}>
            <span style={{ color: "var(--color-primary)" }}>varying vec2</span>{" "}
            <span style={{ color: "var(--color-accent)" }}>v_uv</span>
            <span class="text-[var(--color-text-muted)]"> — UV coordinates (0-1)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
