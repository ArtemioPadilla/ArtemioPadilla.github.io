import { useState, useEffect, useRef, useCallback } from "preact/hooks";

// -----------------------------------------------------------------
// Types
// -----------------------------------------------------------------

const FRACTAL_MANDELBROT = 0;
const FRACTAL_JULIA = 1;
const FRACTAL_BURNING_SHIP = 2;
const FRACTAL_TRICORN = 3;

type FractalType = 0 | 1 | 2 | 3;

interface FractalPreset {
  name: string;
  centerX: number;
  centerY: number;
  zoom: number;
  maxIter: number;
  fractalType: FractalType;
  juliaR?: number;
  juliaI?: number;
}

interface Palette {
  name: string;
  id: number;
}

// -----------------------------------------------------------------
// Presets
// -----------------------------------------------------------------

const PRESETS: FractalPreset[] = [
  {
    name: "Full Mandelbrot",
    centerX: -0.5,
    centerY: 0.0,
    zoom: 1.2,
    maxIter: 200,
    fractalType: FRACTAL_MANDELBROT,
  },
  {
    name: "Seahorse Valley",
    centerX: -0.745,
    centerY: 0.186,
    zoom: 180.0,
    maxIter: 500,
    fractalType: FRACTAL_MANDELBROT,
  },
  {
    name: "Elephant Valley",
    centerX: 0.2815,
    centerY: 0.0085,
    zoom: 80.0,
    maxIter: 400,
    fractalType: FRACTAL_MANDELBROT,
  },
  {
    name: "Mini-brot",
    centerX: -1.7686,
    centerY: 0.00176,
    zoom: 2400.0,
    maxIter: 800,
    fractalType: FRACTAL_MANDELBROT,
  },
  {
    name: "Spiral",
    centerX: -0.7463,
    centerY: 0.1102,
    zoom: 6000.0,
    maxIter: 1000,
    fractalType: FRACTAL_MANDELBROT,
  },
  {
    name: "Julia Dendrite",
    centerX: 0.0,
    centerY: 0.0,
    zoom: 1.2,
    maxIter: 300,
    fractalType: FRACTAL_JULIA,
    juliaR: -0.8,
    juliaI: 0.156,
  },
  {
    name: "Julia Spiral",
    centerX: 0.0,
    centerY: 0.0,
    zoom: 1.2,
    maxIter: 300,
    fractalType: FRACTAL_JULIA,
    juliaR: -0.4,
    juliaI: 0.6,
  },
  {
    name: "Burning Ship",
    centerX: -0.4,
    centerY: -0.6,
    zoom: 1.5,
    maxIter: 300,
    fractalType: FRACTAL_BURNING_SHIP,
  },
  {
    name: "Tricorn",
    centerX: -0.3,
    centerY: 0.0,
    zoom: 1.2,
    maxIter: 300,
    fractalType: FRACTAL_TRICORN,
  },
];

const PALETTES: Palette[] = [
  { name: "Classic", id: 0 },
  { name: "Fire", id: 1 },
  { name: "Ocean", id: 2 },
  { name: "Rainbow", id: 3 },
  { name: "Grayscale", id: 4 },
];

const FRACTAL_NAMES: Record<FractalType, string> = {
  [FRACTAL_MANDELBROT]: "Mandelbrot",
  [FRACTAL_JULIA]: "Julia Set",
  [FRACTAL_BURNING_SHIP]: "Burning Ship",
  [FRACTAL_TRICORN]: "Tricorn",
};

// -----------------------------------------------------------------
// Shaders
// -----------------------------------------------------------------

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_resolution;
uniform vec2 u_center;
uniform float u_zoom;
uniform int u_maxIter;
uniform int u_fractalType;
uniform vec2 u_juliaC;
uniform int u_palette;
uniform float u_colorOffset;

// Smooth coloring palettes
vec3 palette_classic(float t) {
  t = fract(t);
  float r = 0.5 + 0.5 * cos(6.28318 * (t + 0.0));
  float g = 0.5 + 0.5 * cos(6.28318 * (t + 0.33));
  float b = 0.5 + 0.5 * cos(6.28318 * (t + 0.67));
  return vec3(r * 0.8, g * 0.85, b);
}

vec3 palette_fire(float t) {
  t = fract(t);
  float r = clamp(t * 3.0, 0.0, 1.0);
  float g = clamp(t * 3.0 - 1.0, 0.0, 1.0);
  float b = clamp(t * 3.0 - 2.0, 0.0, 1.0);
  return vec3(r, g * 0.7, b * 0.4);
}

vec3 palette_ocean(float t) {
  t = fract(t);
  return vec3(
    0.1 + 0.3 * sin(6.28318 * t + 4.0),
    0.2 + 0.5 * sin(6.28318 * t + 2.0),
    0.4 + 0.6 * sin(6.28318 * t)
  );
}

vec3 palette_rainbow(float t) {
  t = fract(t);
  return vec3(
    0.5 + 0.5 * cos(6.28318 * (t + 0.0)),
    0.5 + 0.5 * cos(6.28318 * (t + 0.333)),
    0.5 + 0.5 * cos(6.28318 * (t + 0.667))
  );
}

vec3 palette_grayscale(float t) {
  t = fract(t);
  float v = 0.5 + 0.5 * cos(6.28318 * t);
  return vec3(v);
}

vec3 getColor(float t) {
  t = t + u_colorOffset;
  if (u_palette == 0) return palette_classic(t);
  if (u_palette == 1) return palette_fire(t);
  if (u_palette == 2) return palette_ocean(t);
  if (u_palette == 3) return palette_rainbow(t);
  return palette_grayscale(t);
}

void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = v_uv - 0.5;
  uv.x *= aspect;

  // Map pixel to complex plane
  vec2 c = uv / u_zoom + u_center;

  vec2 z;
  if (u_fractalType == 1) {
    // Julia: z starts at pixel, c is fixed
    z = c;
    c = u_juliaC;
  } else {
    z = vec2(0.0);
  }

  float iter = 0.0;
  float maxF = float(u_maxIter);
  float escape = 256.0;

  for (int i = 0; i < 2000; i++) {
    if (i >= u_maxIter) break;

    float x2 = z.x * z.x;
    float y2 = z.y * z.y;

    if (x2 + y2 > escape) break;

    float newX, newY;

    if (u_fractalType == 2) {
      // Burning Ship: z = (|Re(z)| + i|Im(z)|)^2 + c
      float ax = abs(z.x);
      float ay = abs(z.y);
      newX = ax * ax - ay * ay + c.x;
      newY = 2.0 * ax * ay + c.y;
    } else if (u_fractalType == 3) {
      // Tricorn: z = conj(z)^2 + c
      newX = x2 - y2 + c.x;
      newY = -2.0 * z.x * z.y + c.y;
    } else {
      // Mandelbrot & Julia: z = z^2 + c
      newX = x2 - y2 + c.x;
      newY = 2.0 * z.x * z.y + c.y;
    }

    z = vec2(newX, newY);
    iter += 1.0;
  }

  if (iter >= maxF) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // Smooth iteration count (normalized)
  float log2Val = log(z.x * z.x + z.y * z.y) * 0.5;
  float nu = log(log2Val / log(2.0)) / log(2.0);
  float smooth_iter = iter + 1.0 - nu;

  float t = smooth_iter / 60.0;
  vec3 col = getColor(t);

  fragColor = vec4(col, 1.0);
}`;

// -----------------------------------------------------------------
// WebGL helpers
// -----------------------------------------------------------------

function createShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("Shader compile error:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(
  gl: WebGL2RenderingContext,
  vs: WebGLShader,
  fs: WebGLShader,
): WebGLProgram | null {
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Program link error:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

// -----------------------------------------------------------------
// Component
// -----------------------------------------------------------------

export default function FractalExplorer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const uniformsRef = useRef<Record<string, WebGLUniformLocation | null>>({});
  const rafRef = useRef<number>(0);

  const [webglSupported, setWebglSupported] = useState(true);
  const [centerX, setCenterX] = useState(-0.5);
  const [centerY, setCenterY] = useState(0.0);
  const [zoom, setZoom] = useState(1.2);
  const [maxIter, setMaxIter] = useState(200);
  const [fractalType, setFractalType] = useState<FractalType>(FRACTAL_MANDELBROT);
  const [juliaR, setJuliaR] = useState(-0.8);
  const [juliaI, setJuliaI] = useState(0.156);
  const [paletteId, setPaletteId] = useState(0);
  const [colorOffset, setColorOffset] = useState(0.0);
  const [cycleColors, setCycleColors] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mouseComplex, setMouseComplex] = useState<{ r: number; i: number } | null>(null);
  const [showControls, setShowControls] = useState(true);

  // Dragging state — refs for performance (avoid re-renders during drag)
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const dragCenter = useRef({ x: -0.5, y: 0.0 });

  const containerRef = useRef<HTMLDivElement>(null);

  // ---------------------------------------------------------------
  // Initialize WebGL
  // ---------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    if (!gl) {
      setWebglSupported(false);
      return;
    }
    glRef.current = gl;

    const vs = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vs || !fs) return;

    const program = createProgram(gl, vs, fs);
    if (!program) return;
    programRef.current = program;

    // Fullscreen quad
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const posLoc = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.useProgram(program);

    // Cache uniforms
    const names = [
      "u_resolution",
      "u_center",
      "u_zoom",
      "u_maxIter",
      "u_fractalType",
      "u_juliaC",
      "u_palette",
      "u_colorOffset",
    ];
    const u: Record<string, WebGLUniformLocation | null> = {};
    for (const n of names) {
      u[n] = gl.getUniformLocation(program, n);
    }
    uniformsRef.current = u;

    // Cleanup
    return () => {
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buffer);
    };
  }, []);

  // ---------------------------------------------------------------
  // Render loop
  // ---------------------------------------------------------------
  const render = useCallback(() => {
    const gl = glRef.current;
    const canvas = canvasRef.current;
    const program = programRef.current;
    const u = uniformsRef.current;
    if (!gl || !canvas || !program) return;

    // Resize canvas to display size
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = canvas.clientWidth * dpr;
    const h = canvas.clientHeight * dpr;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);

    gl.useProgram(program);
    gl.uniform2f(u.u_resolution, canvas.width, canvas.height);
    gl.uniform2f(u.u_center, centerX, centerY);
    gl.uniform1f(u.u_zoom, zoom);
    gl.uniform1i(u.u_maxIter, maxIter);
    gl.uniform1i(u.u_fractalType, fractalType);
    gl.uniform2f(u.u_juliaC, juliaR, juliaI);
    gl.uniform1i(u.u_palette, paletteId);
    gl.uniform1f(u.u_colorOffset, colorOffset);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }, [centerX, centerY, zoom, maxIter, fractalType, juliaR, juliaI, paletteId, colorOffset]);

  // Color cycle animation
  useEffect(() => {
    if (!cycleColors) return;
    let offset = colorOffset;
    let frame = 0;
    const animate = () => {
      offset += 0.002;
      setColorOffset(offset);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [cycleColors]);

  // Trigger render on state change
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  }, [render]);

  // ---------------------------------------------------------------
  // Mouse interactions
  // ---------------------------------------------------------------

  const pixelToComplex = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { r: 0, i: 0 };
      const rect = canvas.getBoundingClientRect();
      const aspect = rect.width / rect.height;
      const uvX = (clientX - rect.left) / rect.width - 0.5;
      const uvY = (clientY - rect.top) / rect.height - 0.5;
      return {
        r: (uvX * aspect) / zoom + centerX,
        i: -(uvY / zoom) + centerY,
      };
    },
    [zoom, centerX, centerY],
  );

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const pt = pixelToComplex(e.clientX, e.clientY);

      // Zoom centered on mouse
      const newZoom = zoom * factor;
      const newCenterX = pt.r + (centerX - pt.r) / factor;
      const newCenterY = pt.i + (centerY - pt.i) / factor;

      setZoom(newZoom);
      setCenterX(newCenterX);
      setCenterY(newCenterY);
    },
    [zoom, centerX, centerY, pixelToComplex],
  );

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (e.button !== 0) return;
      isDragging.current = true;
      dragStart.current = { x: e.clientX, y: e.clientY };
      dragCenter.current = { x: centerX, y: centerY };
    },
    [centerX, centerY],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      // Update complex coords display
      const c = pixelToComplex(e.clientX, e.clientY);
      setMouseComplex(c);

      if (!isDragging.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const aspect = rect.width / rect.height;
      const dx = (e.clientX - dragStart.current.x) / rect.width;
      const dy = (e.clientY - dragStart.current.y) / rect.height;

      setCenterX(dragCenter.current.x - (dx * aspect) / zoom);
      setCenterY(dragCenter.current.y + dy / zoom);
    },
    [zoom, pixelToComplex],
  );

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleCanvasClick = useCallback(
    (e: MouseEvent) => {
      // If we were dragging, don't treat as click
      const dx = Math.abs(e.clientX - dragStart.current.x);
      const dy = Math.abs(e.clientY - dragStart.current.y);
      if (dx > 3 || dy > 3) return;

      // On Mandelbrot: click sets Julia c parameter
      if (fractalType === FRACTAL_MANDELBROT) {
        const c = pixelToComplex(e.clientX, e.clientY);
        setJuliaR(c.r);
        setJuliaI(c.i);
        setFractalType(FRACTAL_JULIA);
        setCenterX(0);
        setCenterY(0);
        setZoom(1.2);
      }
    },
    [fractalType, pixelToComplex],
  );

  // Attach wheel listener (non-passive for preventDefault)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // ---------------------------------------------------------------
  // Presets & reset
  // ---------------------------------------------------------------

  const applyPreset = useCallback((p: FractalPreset) => {
    setCenterX(p.centerX);
    setCenterY(p.centerY);
    setZoom(p.zoom);
    setMaxIter(p.maxIter);
    setFractalType(p.fractalType);
    if (p.juliaR !== undefined) setJuliaR(p.juliaR);
    if (p.juliaI !== undefined) setJuliaI(p.juliaI);
  }, []);

  const resetView = useCallback(() => {
    applyPreset(PRESETS[0]);
    setColorOffset(0);
    setCycleColors(false);
  }, [applyPreset]);

  // ---------------------------------------------------------------
  // Fullscreen
  // ---------------------------------------------------------------

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // ---------------------------------------------------------------
  // Format numbers for display
  // ---------------------------------------------------------------

  const fmtNum = (n: number, digits: number = 8) => {
    if (Math.abs(n) < 0.0001 && n !== 0) return n.toExponential(4);
    return n.toFixed(digits);
  };

  const fmtZoom = (z: number) => {
    if (z >= 1e6) return z.toExponential(2) + "x";
    return z.toFixed(1) + "x";
  };

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  if (!webglSupported) {
    return (
      <div
        class="rounded-xl border p-8 text-center"
        style="border-color: var(--color-border); background: var(--color-surface); color: var(--color-text-muted);"
      >
        <p class="text-lg font-semibold" style="color: var(--color-heading);">
          WebGL 2.0 Required
        </p>
        <p class="mt-2 text-sm">
          Your browser or device does not support WebGL 2.0, which is needed for GPU-accelerated
          fractal rendering. Please try a modern desktop browser.
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} class="fractal-explorer" style="background: var(--color-bg);">
      {/* Canvas area */}
      <div class="fractal-canvas-wrapper">
        <canvas
          ref={canvasRef}
          class="fractal-canvas"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={handleCanvasClick}
          style={`cursor: ${fractalType === FRACTAL_MANDELBROT ? "crosshair" : isDragging.current ? "grabbing" : "grab"};`}
        />

        {/* Info overlay */}
        <div class="fractal-info-overlay">
          <span>Zoom: {fmtZoom(zoom)}</span>
          <span>
            Center: {fmtNum(centerX, 6)} {centerY >= 0 ? "+" : ""}
            {fmtNum(centerY, 6)}i
          </span>
          {mouseComplex && (
            <span>
              Cursor: {fmtNum(mouseComplex.r, 6)} {mouseComplex.i >= 0 ? "+" : ""}
              {fmtNum(mouseComplex.i, 6)}i
            </span>
          )}
          <span>Iterations: {maxIter}</span>
        </div>

        {/* Fractal type badge */}
        <div class="fractal-type-badge">{FRACTAL_NAMES[fractalType]}</div>

        {/* Toggle controls button */}
        <button
          class="fractal-toggle-controls"
          onClick={() => setShowControls(!showControls)}
          title={showControls ? "Hide controls" : "Show controls"}
        >
          {showControls ? "\u2715" : "\u2699"}
        </button>
      </div>

      {/* Controls panel */}
      {showControls && (
        <div class="fractal-controls">
          {/* Fractal Type */}
          <div class="fractal-control-group">
            <label class="fractal-label">Fractal Type</label>
            <div class="fractal-type-buttons">
              {([FRACTAL_MANDELBROT, FRACTAL_JULIA, FRACTAL_BURNING_SHIP, FRACTAL_TRICORN] as FractalType[]).map(
                (t) => (
                  <button
                    key={t}
                    class={`fractal-type-btn ${fractalType === t ? "active" : ""}`}
                    onClick={() => {
                      setFractalType(t);
                      if (t !== FRACTAL_JULIA) {
                        setCenterX(t === FRACTAL_BURNING_SHIP ? -0.4 : t === FRACTAL_TRICORN ? -0.3 : -0.5);
                        setCenterY(t === FRACTAL_BURNING_SHIP ? -0.6 : 0.0);
                        setZoom(1.2);
                      } else {
                        setCenterX(0);
                        setCenterY(0);
                        setZoom(1.2);
                      }
                    }}
                  >
                    {FRACTAL_NAMES[t]}
                  </button>
                ),
              )}
            </div>
          </div>

          {/* Max Iterations */}
          <div class="fractal-control-group">
            <label class="fractal-label">
              Max Iterations: <span class="fractal-value">{maxIter}</span>
            </label>
            <input
              type="range"
              min="50"
              max="2000"
              step="10"
              value={maxIter}
              onInput={(e) => setMaxIter(parseInt((e.target as HTMLInputElement).value))}
              class="fractal-slider"
            />
          </div>

          {/* Julia C parameter (visible when Julia) */}
          {fractalType === FRACTAL_JULIA && (
            <div class="fractal-control-group">
              <label class="fractal-label">
                Julia c: {fmtNum(juliaR, 4)} {juliaI >= 0 ? "+" : ""}
                {fmtNum(juliaI, 4)}i
              </label>
              <div class="fractal-julia-sliders">
                <div>
                  <span class="fractal-sublabel">Real</span>
                  <input
                    type="range"
                    min="-2"
                    max="2"
                    step="0.001"
                    value={juliaR}
                    onInput={(e) => setJuliaR(parseFloat((e.target as HTMLInputElement).value))}
                    class="fractal-slider"
                  />
                </div>
                <div>
                  <span class="fractal-sublabel">Imaginary</span>
                  <input
                    type="range"
                    min="-2"
                    max="2"
                    step="0.001"
                    value={juliaI}
                    onInput={(e) => setJuliaI(parseFloat((e.target as HTMLInputElement).value))}
                    class="fractal-slider"
                  />
                </div>
              </div>
            </div>
          )}

          {fractalType === FRACTAL_MANDELBROT && (
            <div class="fractal-hint">
              Click on the fractal to explore its Julia set at that point.
            </div>
          )}

          {/* Color Palette */}
          <div class="fractal-control-group">
            <label class="fractal-label">Color Palette</label>
            <div class="fractal-palette-buttons">
              {PALETTES.map((p) => (
                <button
                  key={p.id}
                  class={`fractal-palette-btn ${paletteId === p.id ? "active" : ""}`}
                  onClick={() => setPaletteId(p.id)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* Color Offset */}
          <div class="fractal-control-group">
            <label class="fractal-label">
              Color Offset: <span class="fractal-value">{colorOffset.toFixed(2)}</span>
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={colorOffset % 1}
              onInput={(e) => setColorOffset(parseFloat((e.target as HTMLInputElement).value))}
              class="fractal-slider"
            />
          </div>

          {/* Cycle colors toggle */}
          <div class="fractal-control-group fractal-row">
            <label class="fractal-label">Cycle Colors</label>
            <button
              class={`fractal-toggle-btn ${cycleColors ? "active" : ""}`}
              onClick={() => setCycleColors(!cycleColors)}
            >
              {cycleColors ? "On" : "Off"}
            </button>
          </div>

          {/* Presets */}
          <div class="fractal-control-group">
            <label class="fractal-label">Presets</label>
            <div class="fractal-presets">
              {PRESETS.map((p, i) => (
                <button key={i} class="fractal-preset-btn" onClick={() => applyPreset(p)}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* Action buttons */}
          <div class="fractal-actions">
            <button class="fractal-action-btn" onClick={resetView}>
              Reset View
            </button>
            <button class="fractal-action-btn" onClick={toggleFullscreen}>
              {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            </button>
          </div>
        </div>
      )}

      <style>{`
        .fractal-explorer {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          border-radius: 0.75rem;
          border: 1px solid var(--color-border);
          overflow: hidden;
        }

        .fractal-canvas-wrapper {
          position: relative;
          width: 100%;
          aspect-ratio: 16 / 10;
          min-height: 320px;
          background: #000;
        }

        .fractal-canvas {
          width: 100%;
          height: 100%;
          display: block;
        }

        .fractal-info-overlay {
          position: absolute;
          bottom: 0.5rem;
          left: 0.5rem;
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem 1rem;
          padding: 0.4rem 0.6rem;
          border-radius: 0.375rem;
          font-size: 0.7rem;
          font-family: var(--font-mono, monospace);
          color: rgba(255, 255, 255, 0.85);
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(4px);
          pointer-events: none;
          user-select: none;
        }

        .fractal-type-badge {
          position: absolute;
          top: 0.5rem;
          left: 0.5rem;
          padding: 0.25rem 0.6rem;
          border-radius: 0.375rem;
          font-size: 0.7rem;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.9);
          background: rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(4px);
          pointer-events: none;
        }

        .fractal-toggle-controls {
          position: absolute;
          top: 0.5rem;
          right: 0.5rem;
          width: 2rem;
          height: 2rem;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 0.375rem;
          border: none;
          cursor: pointer;
          font-size: 1rem;
          color: rgba(255, 255, 255, 0.9);
          background: rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(4px);
          transition: background 0.2s;
        }

        .fractal-toggle-controls:hover {
          background: rgba(0, 0, 0, 0.7);
        }

        .fractal-controls {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          padding: 1rem;
          border-top: 1px solid var(--color-border);
        }

        .fractal-control-group {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }

        .fractal-control-group.fractal-row {
          flex-direction: row;
          align-items: center;
          justify-content: space-between;
        }

        .fractal-label {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--color-text-muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .fractal-sublabel {
          font-size: 0.65rem;
          color: var(--color-text-muted);
        }

        .fractal-value {
          color: var(--color-heading);
          font-family: var(--font-mono, monospace);
        }

        .fractal-slider {
          width: 100%;
          height: 4px;
          appearance: none;
          -webkit-appearance: none;
          border-radius: 2px;
          background: var(--color-border);
          outline: none;
          cursor: pointer;
        }

        .fractal-slider::-webkit-slider-thumb {
          appearance: none;
          -webkit-appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--color-primary);
          cursor: pointer;
          border: 2px solid var(--color-bg);
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }

        .fractal-slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--color-primary);
          cursor: pointer;
          border: 2px solid var(--color-bg);
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }

        .fractal-type-buttons,
        .fractal-palette-buttons {
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem;
        }

        .fractal-type-btn,
        .fractal-palette-btn {
          padding: 0.3rem 0.6rem;
          border-radius: 0.375rem;
          border: 1px solid var(--color-border);
          background: transparent;
          color: var(--color-text-muted);
          font-size: 0.7rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s;
        }

        .fractal-type-btn:hover,
        .fractal-palette-btn:hover {
          border-color: var(--color-primary);
          color: var(--color-primary);
        }

        .fractal-type-btn.active,
        .fractal-palette-btn.active {
          border-color: var(--color-primary);
          background: color-mix(in srgb, var(--color-primary) 15%, transparent);
          color: var(--color-primary);
        }

        .fractal-julia-sliders {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }

        .fractal-julia-sliders > div {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .fractal-julia-sliders .fractal-slider {
          flex: 1;
        }

        .fractal-hint {
          font-size: 0.7rem;
          color: var(--color-text-muted);
          font-style: italic;
          padding: 0.35rem 0.5rem;
          border-radius: 0.375rem;
          background: color-mix(in srgb, var(--color-surface) 80%, transparent);
          border: 1px solid var(--color-border);
        }

        .fractal-presets {
          display: flex;
          flex-wrap: wrap;
          gap: 0.3rem;
        }

        .fractal-preset-btn {
          padding: 0.25rem 0.5rem;
          border-radius: 0.375rem;
          border: 1px solid var(--color-border);
          background: transparent;
          color: var(--color-text-muted);
          font-size: 0.65rem;
          cursor: pointer;
          transition: all 0.15s;
        }

        .fractal-preset-btn:hover {
          border-color: var(--color-accent);
          color: var(--color-accent);
        }

        .fractal-toggle-btn {
          padding: 0.25rem 0.7rem;
          border-radius: 0.375rem;
          border: 1px solid var(--color-border);
          background: transparent;
          color: var(--color-text-muted);
          font-size: 0.7rem;
          cursor: pointer;
          transition: all 0.15s;
          min-width: 3rem;
        }

        .fractal-toggle-btn.active {
          border-color: var(--color-accent);
          background: color-mix(in srgb, var(--color-accent) 15%, transparent);
          color: var(--color-accent);
        }

        .fractal-actions {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
        }

        .fractal-action-btn {
          flex: 1;
          padding: 0.5rem 0.75rem;
          border-radius: 0.5rem;
          border: 1px solid var(--color-border);
          background: transparent;
          color: var(--color-text);
          font-size: 0.75rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s;
        }

        .fractal-action-btn:hover {
          border-color: var(--color-primary);
          color: var(--color-primary);
        }

        /* Fullscreen styles */
        .fractal-explorer:fullscreen {
          border: none;
          border-radius: 0;
        }

        .fractal-explorer:fullscreen .fractal-canvas-wrapper {
          aspect-ratio: auto;
          min-height: auto;
          flex: 1;
        }

        .fractal-explorer:fullscreen {
          display: flex;
          flex-direction: row;
          height: 100vh;
        }

        .fractal-explorer:fullscreen .fractal-controls {
          border-top: none;
          border-left: 1px solid var(--color-border);
          width: 280px;
          overflow-y: auto;
          flex-shrink: 0;
        }

        @media (max-width: 640px) {
          .fractal-info-overlay {
            font-size: 0.6rem;
            gap: 0.25rem 0.5rem;
          }

          .fractal-controls {
            padding: 0.75rem;
          }
        }
      `}</style>
    </div>
  );
}
