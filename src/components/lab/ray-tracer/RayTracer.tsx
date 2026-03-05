import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ================================================================
   Vec3 — 3D vector math (pure functions, no dependencies)
   ================================================================ */

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function mul(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function mulV(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x * b.x, y: a.y * b.y, z: a.z * b.z };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function length(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

function normalize(a: Vec3): Vec3 {
  const len = length(a);
  return len > 0 ? mul(a, 1 / len) : vec3(0, 0, 0);
}

function reflect(incident: Vec3, normal: Vec3): Vec3 {
  return sub(incident, mul(normal, 2 * dot(incident, normal)));
}

function refract(incident: Vec3, normal: Vec3, eta: number): Vec3 | null {
  const cosI = -dot(incident, normal);
  const sin2T = eta * eta * (1 - cosI * cosI);
  if (sin2T > 1) return null;
  const cosT = Math.sqrt(1 - sin2T);
  return add(mul(incident, eta), mul(normal, eta * cosI - cosT));
}

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return add(mul(a, 1 - t), mul(b, t));
}

function clampV(v: Vec3): Vec3 {
  return {
    x: Math.max(0, Math.min(1, v.x)),
    y: Math.max(0, Math.min(1, v.y)),
    z: Math.max(0, Math.min(1, v.z)),
  };
}

/* ================================================================
   Ray, Material, Scene definitions
   ================================================================ */

interface Ray {
  origin: Vec3;
  direction: Vec3;
}

type MaterialType = "diffuse" | "reflective" | "refractive" | "emissive";

interface Material {
  type: MaterialType;
  color: Vec3;
  specular: number;
  shininess: number;
  reflectivity: number;
  ior: number;
  emission: number;
}

interface Sphere {
  kind: "sphere";
  center: Vec3;
  radius: number;
  material: Material;
  id: number;
}

interface Plane {
  kind: "plane";
  point: Vec3;
  normal: Vec3;
  material: Material;
  checkerboard: boolean;
  checkerColor2: Vec3;
  checkerScale: number;
  id: number;
}

type SceneObject = Sphere | Plane;

interface PointLight {
  position: Vec3;
  color: Vec3;
  intensity: number;
}

interface Camera {
  position: Vec3;
  lookAt: Vec3;
  fov: number;
}

interface Scene {
  objects: SceneObject[];
  lights: PointLight[];
  camera: Camera;
  bgColor: Vec3;
  bgColor2: Vec3;
  bgGradient: boolean;
}

interface HitRecord {
  t: number;
  point: Vec3;
  normal: Vec3;
  material: Material;
  objectId: number;
}

/* ================================================================
   Default materials
   ================================================================ */

function makeDiffuse(color: Vec3): Material {
  return { type: "diffuse", color, specular: 0.3, shininess: 32, reflectivity: 0, ior: 1, emission: 0 };
}

function makeReflective(color: Vec3, reflectivity = 0.9): Material {
  return { type: "reflective", color, specular: 1, shininess: 256, reflectivity, ior: 1, emission: 0 };
}

function makeRefractive(color: Vec3, ior = 1.5): Material {
  return { type: "refractive", color, specular: 1, shininess: 256, reflectivity: 0.1, ior, emission: 0 };
}

function makeEmissive(color: Vec3, emission = 2): Material {
  return { type: "emissive", color, specular: 0, shininess: 1, reflectivity: 0, ior: 1, emission };
}

/* ================================================================
   Intersection tests
   ================================================================ */

function intersectSphere(ray: Ray, sphere: Sphere): number | null {
  const oc = sub(ray.origin, sphere.center);
  const a = dot(ray.direction, ray.direction);
  const b = 2 * dot(oc, ray.direction);
  const c = dot(oc, oc) - sphere.radius * sphere.radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const sqrtD = Math.sqrt(discriminant);
  let t = (-b - sqrtD) / (2 * a);
  if (t < 0.001) {
    t = (-b + sqrtD) / (2 * a);
    if (t < 0.001) return null;
  }
  return t;
}

function intersectPlane(ray: Ray, plane: Plane): number | null {
  const denom = dot(plane.normal, ray.direction);
  if (Math.abs(denom) < 1e-6) return null;
  const t = dot(sub(plane.point, ray.origin), plane.normal) / denom;
  return t > 0.001 ? t : null;
}

function getPlaneColor(plane: Plane, point: Vec3): Vec3 {
  if (!plane.checkerboard) return plane.material.color;
  const s = plane.checkerScale;
  const u = Math.floor(point.x * s);
  const v = Math.floor(point.z * s);
  return (u + v) % 2 === 0 ? plane.material.color : plane.checkerColor2;
}

function findClosestHit(ray: Ray, objects: SceneObject[]): HitRecord | null {
  let closest: HitRecord | null = null;
  for (const obj of objects) {
    if (obj.kind === "sphere") {
      const t = intersectSphere(ray, obj);
      if (t !== null && (closest === null || t < closest.t)) {
        const point = add(ray.origin, mul(ray.direction, t));
        const normal = normalize(sub(point, obj.center));
        closest = { t, point, normal, material: obj.material, objectId: obj.id };
      }
    } else {
      const t = intersectPlane(ray, obj);
      if (t !== null && (closest === null || t < closest.t)) {
        const point = add(ray.origin, mul(ray.direction, t));
        const color = getPlaneColor(obj, point);
        const mat = { ...obj.material, color };
        closest = { t, point, normal: obj.normal, material: mat, objectId: obj.id };
      }
    }
  }
  return closest;
}

/* ================================================================
   Shading — Phong model + shadows
   ================================================================ */

const SHADOW_SOFTNESS = 0.15;

function computeShadow(
  point: Vec3,
  lightPos: Vec3,
  objects: SceneObject[],
  softSamples: number,
): number {
  if (softSamples <= 1) {
    const toLight = sub(lightPos, point);
    const dist = length(toLight);
    const dir = normalize(toLight);
    const shadowRay: Ray = { origin: add(point, mul(dir, 0.01)), direction: dir };
    const hit = findClosestHit(shadowRay, objects);
    return hit !== null && hit.t < dist ? 0 : 1;
  }
  let lit = 0;
  for (let i = 0; i < softSamples; i++) {
    const jitter = vec3(
      (Math.random() - 0.5) * SHADOW_SOFTNESS,
      (Math.random() - 0.5) * SHADOW_SOFTNESS,
      (Math.random() - 0.5) * SHADOW_SOFTNESS,
    );
    const jitteredPos = add(lightPos, jitter);
    const toLight = sub(jitteredPos, point);
    const dist = length(toLight);
    const dir = normalize(toLight);
    const shadowRay: Ray = { origin: add(point, mul(dir, 0.01)), direction: dir };
    const hit = findClosestHit(shadowRay, objects);
    if (hit === null || hit.t >= dist) lit++;
  }
  return lit / softSamples;
}

function shade(
  hit: HitRecord,
  ray: Ray,
  lights: PointLight[],
  objects: SceneObject[],
  shadowSamples: number,
): Vec3 {
  const mat = hit.material;
  const ambient = mul(mat.color, 0.08);
  let result = ambient;

  for (const light of lights) {
    const shadow = computeShadow(hit.point, light.position, objects, shadowSamples);
    if (shadow <= 0) continue;

    const toLight = normalize(sub(light.position, hit.point));
    const diffuseStrength = Math.max(0, dot(hit.normal, toLight));
    const diffuse = mulV(mul(mat.color, diffuseStrength * light.intensity), light.color);

    const viewDir = normalize(sub(ray.origin, hit.point));
    const halfDir = normalize(add(toLight, viewDir));
    const specStrength = Math.pow(Math.max(0, dot(hit.normal, halfDir)), mat.shininess);
    const specular = mul(light.color, specStrength * mat.specular * light.intensity);

    result = add(result, mul(add(diffuse, specular), shadow));
  }

  return result;
}

/* ================================================================
   Trace ray (recursive with reflections/refractions)
   ================================================================ */

function traceRay(
  ray: Ray,
  scene: Scene,
  depth: number,
  maxDepth: number,
  shadowSamples: number,
  raysRef: { count: number },
): Vec3 {
  raysRef.count++;

  const hit = findClosestHit(ray, scene.objects);
  if (!hit) {
    if (scene.bgGradient) {
      const t = 0.5 * (ray.direction.y + 1);
      return lerp3(scene.bgColor, scene.bgColor2, t);
    }
    return scene.bgColor;
  }

  const mat = hit.material;

  if (mat.type === "emissive") {
    return mul(mat.color, mat.emission);
  }

  let color = shade(hit, ray, scene.lights, scene.objects, shadowSamples);

  if (depth >= maxDepth) return clampV(color);

  if (mat.type === "reflective" && mat.reflectivity > 0) {
    const reflDir = reflect(ray.direction, hit.normal);
    const reflRay: Ray = { origin: add(hit.point, mul(reflDir, 0.01)), direction: reflDir };
    const reflColor = traceRay(reflRay, scene, depth + 1, maxDepth, shadowSamples, raysRef);
    color = add(mul(color, 1 - mat.reflectivity), mul(reflColor, mat.reflectivity));
  }

  if (mat.type === "refractive") {
    const isEntering = dot(ray.direction, hit.normal) < 0;
    const normal = isEntering ? hit.normal : mul(hit.normal, -1);
    const eta = isEntering ? 1 / mat.ior : mat.ior;

    const refracted = refract(ray.direction, normal, eta);
    if (refracted) {
      const refrDir = normalize(refracted);
      const refrRay: Ray = { origin: add(hit.point, mul(refrDir, 0.02)), direction: refrDir };
      const refrColor = traceRay(refrRay, scene, depth + 1, maxDepth, shadowSamples, raysRef);

      const cosI = Math.abs(dot(ray.direction, hit.normal));
      const r0 = ((1 - mat.ior) / (1 + mat.ior)) ** 2;
      const fresnel = r0 + (1 - r0) * Math.pow(1 - cosI, 5);

      const reflDir = reflect(ray.direction, normal);
      const reflRay: Ray = { origin: add(hit.point, mul(reflDir, 0.01)), direction: reflDir };
      const reflColor = traceRay(reflRay, scene, depth + 1, maxDepth, shadowSamples, raysRef);

      color = add(mul(reflColor, fresnel), mulV(mul(refrColor, 1 - fresnel), mat.color));
    } else {
      const reflDir = reflect(ray.direction, normal);
      const reflRay: Ray = { origin: add(hit.point, mul(reflDir, 0.01)), direction: reflDir };
      color = traceRay(reflRay, scene, depth + 1, maxDepth, shadowSamples, raysRef);
    }
  }

  return clampV(color);
}

/* ================================================================
   Camera — generate rays
   ================================================================ */

function buildCameraFrame(cam: Camera) {
  const forward = normalize(sub(cam.lookAt, cam.position));
  const right = normalize(cross(forward, vec3(0, 1, 0)));
  const up = cross(right, forward);
  return { forward, right, up };
}

function getCameraRay(
  cam: Camera,
  frame: { forward: Vec3; right: Vec3; up: Vec3 },
  x: number,
  y: number,
  width: number,
  height: number,
): Ray {
  const aspect = width / height;
  const fovScale = Math.tan((cam.fov * Math.PI) / 360);
  const px = (2 * ((x + 0.5) / width) - 1) * aspect * fovScale;
  const py = (1 - 2 * ((y + 0.5) / height)) * fovScale;
  const direction = normalize(
    add(add(frame.forward, mul(frame.right, px)), mul(frame.up, py)),
  );
  return { origin: cam.position, direction };
}

/* ================================================================
   Scene presets
   ================================================================ */

let nextId = 1;
function uid(): number {
  return nextId++;
}

function makeClassicSpheres(): Scene {
  return {
    objects: [
      { kind: "sphere", center: vec3(-1.2, 0.5, -1), radius: 0.5, material: makeDiffuse(vec3(0.9, 0.2, 0.2)), id: uid() },
      { kind: "sphere", center: vec3(0, 0.5, 0), radius: 0.5, material: makeReflective(vec3(0.8, 0.8, 0.9)), id: uid() },
      { kind: "sphere", center: vec3(1.2, 0.5, -0.5), radius: 0.5, material: makeDiffuse(vec3(0.2, 0.3, 0.9)), id: uid() },
      {
        kind: "plane", point: vec3(0, 0, 0), normal: vec3(0, 1, 0),
        material: makeDiffuse(vec3(0.9, 0.9, 0.9)), checkerboard: true,
        checkerColor2: vec3(0.3, 0.3, 0.3), checkerScale: 1, id: uid(),
      },
    ],
    lights: [
      { position: vec3(-3, 5, 2), color: vec3(1, 1, 1), intensity: 0.9 },
      { position: vec3(2, 4, -1), color: vec3(0.8, 0.9, 1), intensity: 0.5 },
    ],
    camera: { position: vec3(0, 2, 4), lookAt: vec3(0, 0.3, 0), fov: 60 },
    bgColor: vec3(0.05, 0.05, 0.1),
    bgColor2: vec3(0.3, 0.5, 0.8),
    bgGradient: true,
  };
}

function makeGlassMetal(): Scene {
  return {
    objects: [
      { kind: "sphere", center: vec3(-1, 0.6, 0), radius: 0.6, material: makeRefractive(vec3(0.95, 0.95, 1), 1.52), id: uid() },
      { kind: "sphere", center: vec3(1, 0.6, -0.3), radius: 0.6, material: makeReflective(vec3(1, 0.85, 0.6), 0.95), id: uid() },
      { kind: "sphere", center: vec3(0, 0.3, 1.5), radius: 0.3, material: makeDiffuse(vec3(0.9, 0.1, 0.3)), id: uid() },
      { kind: "sphere", center: vec3(-0.3, 0.2, 2), radius: 0.2, material: makeEmissive(vec3(0.3, 0.9, 0.4), 3), id: uid() },
      {
        kind: "plane", point: vec3(0, 0, 0), normal: vec3(0, 1, 0),
        material: makeDiffuse(vec3(0.85, 0.85, 0.85)), checkerboard: true,
        checkerColor2: vec3(0.25, 0.25, 0.3), checkerScale: 1, id: uid(),
      },
    ],
    lights: [
      { position: vec3(-2, 6, 3), color: vec3(1, 1, 1), intensity: 0.8 },
      { position: vec3(3, 3, -2), color: vec3(1, 0.8, 0.6), intensity: 0.5 },
    ],
    camera: { position: vec3(0, 2.5, 5), lookAt: vec3(0, 0.3, 0), fov: 55 },
    bgColor: vec3(0.02, 0.02, 0.05),
    bgColor2: vec3(0.15, 0.2, 0.4),
    bgGradient: true,
  };
}

function makeCornellBox(): Scene {
  const white = makeDiffuse(vec3(0.73, 0.73, 0.73));
  const red = makeDiffuse(vec3(0.65, 0.05, 0.05));
  const green = makeDiffuse(vec3(0.12, 0.45, 0.15));
  const boxSize = 3;
  return {
    objects: [
      { kind: "plane", point: vec3(0, 0, 0), normal: vec3(0, 1, 0), material: white, checkerboard: false, checkerColor2: vec3(0, 0, 0), checkerScale: 1, id: uid() },
      { kind: "plane", point: vec3(0, boxSize, 0), normal: vec3(0, -1, 0), material: white, checkerboard: false, checkerColor2: vec3(0, 0, 0), checkerScale: 1, id: uid() },
      { kind: "plane", point: vec3(0, 0, -boxSize), normal: vec3(0, 0, 1), material: white, checkerboard: false, checkerColor2: vec3(0, 0, 0), checkerScale: 1, id: uid() },
      { kind: "plane", point: vec3(-boxSize / 2, 0, 0), normal: vec3(1, 0, 0), material: red, checkerboard: false, checkerColor2: vec3(0, 0, 0), checkerScale: 1, id: uid() },
      { kind: "plane", point: vec3(boxSize / 2, 0, 0), normal: vec3(-1, 0, 0), material: green, checkerboard: false, checkerColor2: vec3(0, 0, 0), checkerScale: 1, id: uid() },
      { kind: "sphere", center: vec3(-0.5, 0.5, -1.5), radius: 0.5, material: makeReflective(vec3(0.9, 0.9, 0.9), 0.85), id: uid() },
      { kind: "sphere", center: vec3(0.5, 0.35, -0.8), radius: 0.35, material: makeRefractive(vec3(1, 1, 1), 1.5), id: uid() },
    ],
    lights: [
      { position: vec3(0, 2.8, -1.5), color: vec3(1, 0.95, 0.85), intensity: 1.2 },
    ],
    camera: { position: vec3(0, 1.5, 2.5), lookAt: vec3(0, 1, -1), fov: 60 },
    bgColor: vec3(0, 0, 0),
    bgColor2: vec3(0, 0, 0),
    bgGradient: false,
  };
}

function makeSolarSystem(): Scene {
  return {
    objects: [
      { kind: "sphere", center: vec3(0, 0.8, -2), radius: 0.8, material: makeEmissive(vec3(1, 0.9, 0.3), 3), id: uid() },
      { kind: "sphere", center: vec3(1.8, 0.3, -0.5), radius: 0.3, material: makeDiffuse(vec3(0.7, 0.3, 0.1)), id: uid() },
      { kind: "sphere", center: vec3(-1.5, 0.4, 0.5), radius: 0.4, material: makeDiffuse(vec3(0.2, 0.5, 0.8)), id: uid() },
      { kind: "sphere", center: vec3(2.5, 0.25, 1), radius: 0.25, material: makeDiffuse(vec3(0.8, 0.4, 0.3)), id: uid() },
      { kind: "sphere", center: vec3(-2.2, 0.5, -1), radius: 0.5, material: makeDiffuse(vec3(0.9, 0.7, 0.4)), id: uid() },
      {
        kind: "plane", point: vec3(0, 0, 0), normal: vec3(0, 1, 0),
        material: makeDiffuse(vec3(0.15, 0.15, 0.2)), checkerboard: false,
        checkerColor2: vec3(0, 0, 0), checkerScale: 1, id: uid(),
      },
    ],
    lights: [
      { position: vec3(0, 0.8, -2), color: vec3(1, 0.9, 0.5), intensity: 1.5 },
      { position: vec3(-5, 8, 5), color: vec3(0.3, 0.3, 0.5), intensity: 0.3 },
    ],
    camera: { position: vec3(0, 3, 6), lookAt: vec3(0, 0.3, -0.5), fov: 60 },
    bgColor: vec3(0.01, 0.01, 0.03),
    bgColor2: vec3(0.05, 0.05, 0.15),
    bgGradient: true,
  };
}

interface PresetDef {
  name: string;
  build: () => Scene;
}

const PRESETS: PresetDef[] = [
  { name: "Classic Spheres", build: makeClassicSpheres },
  { name: "Glass & Metal", build: makeGlassMetal },
  { name: "Cornell Box", build: makeCornellBox },
  { name: "Solar System", build: makeSolarSystem },
];

/* ================================================================
   Progressive renderer (renders in scanline chunks)
   ================================================================ */

interface RenderState {
  width: number;
  height: number;
  currentY: number;
  done: boolean;
  totalRays: number;
  startTime: number;
  pixels: Uint8ClampedArray;
  scene: Scene;
  maxBounces: number;
  aaSamples: number;
  shadowSamples: number;
}

function initRenderState(
  scene: Scene,
  width: number,
  height: number,
  maxBounces: number,
  aaSamples: number,
  shadowSamples: number,
): RenderState {
  return {
    width,
    height,
    currentY: 0,
    done: false,
    totalRays: 0,
    startTime: performance.now(),
    pixels: new Uint8ClampedArray(width * height * 4),
    scene,
    maxBounces,
    aaSamples,
    shadowSamples,
  };
}

function renderChunk(state: RenderState, linesPerChunk: number): void {
  const { width, height, scene, maxBounces, aaSamples, shadowSamples } = state;
  const frame = buildCameraFrame(scene.camera);
  const raysRef = { count: 0 };
  const endY = Math.min(state.currentY + linesPerChunk, height);

  for (let y = state.currentY; y < endY; y++) {
    for (let x = 0; x < width; x++) {
      let color = vec3(0, 0, 0);

      if (aaSamples <= 1) {
        const ray = getCameraRay(scene.camera, frame, x, y, width, height);
        color = traceRay(ray, scene, 0, maxBounces, shadowSamples, raysRef);
      } else {
        for (let s = 0; s < aaSamples; s++) {
          const jx = x + (Math.random() - 0.5);
          const jy = y + (Math.random() - 0.5);
          const ray = getCameraRay(scene.camera, frame, jx, jy, width, height);
          color = add(color, traceRay(ray, scene, 0, maxBounces, shadowSamples, raysRef));
        }
        color = mul(color, 1 / aaSamples);
      }

      const gamma = (v: number) => Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2) * 255;
      const idx = (y * width + x) * 4;
      state.pixels[idx] = gamma(color.x);
      state.pixels[idx + 1] = gamma(color.y);
      state.pixels[idx + 2] = gamma(color.z);
      state.pixels[idx + 3] = 255;
    }
  }

  state.totalRays += raysRef.count;
  state.currentY = endY;
  if (endY >= height) {
    state.done = true;
  }
}

/* ================================================================
   Object picking (for click+drag interaction)
   ================================================================ */

function pickSphere(scene: Scene, cam: Camera, nx: number, ny: number, w: number, h: number): number | null {
  const frame = buildCameraFrame(cam);
  const ray = getCameraRay(cam, frame, nx, ny, w, h);
  let closestT = Infinity;
  let closestId: number | null = null;
  for (const obj of scene.objects) {
    if (obj.kind !== "sphere") continue;
    const t = intersectSphere(ray, obj);
    if (t !== null && t < closestT) {
      closestT = t;
      closestId = obj.id;
    }
  }
  return closestId;
}

/* ================================================================
   Preact Component
   ================================================================ */

const BASE_WIDTH = 480;
const BASE_HEIGHT = 320;
const LINES_PER_CHUNK = 4;

export default function RayTracer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderStateRef = useRef<RenderState | null>(null);
  const rafRef = useRef<number>(0);
  const needsRenderRef = useRef(true);

  const [preset, setPreset] = useState(0);
  const [scene, setScene] = useState<Scene>(() => makeClassicSpheres());
  const [resScale, setResScale] = useState(0.5);
  const [maxBounces, setMaxBounces] = useState(3);
  const [aaSamples, setAaSamples] = useState(1);
  const [shadowSamples, setShadowSamples] = useState(1);

  const [renderTime, setRenderTime] = useState(0);
  const [rayCount, setRayCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isRendering, setIsRendering] = useState(false);

  const [dragId, setDragId] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isOrbiting, setIsOrbiting] = useState(false);
  const [lastMouse, setLastMouse] = useState<{ x: number; y: number } | null>(null);

  const [selectedObjectId, setSelectedObjectId] = useState<number | null>(null);

  const startRender = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    cancelAnimationFrame(rafRef.current);

    const w = Math.max(16, Math.round(BASE_WIDTH * resScale));
    const h = Math.max(16, Math.round(BASE_HEIGHT * resScale));
    canvas.width = w;
    canvas.height = h;

    const state = initRenderState(scene, w, h, maxBounces, aaSamples, shadowSamples);
    renderStateRef.current = state;
    setIsRendering(true);
    setProgress(0);
    setRenderTime(0);
    setRayCount(0);

    const tick = () => {
      if (state.done) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const imgData = ctx.createImageData(w, h);
          imgData.data.set(state.pixels);
          ctx.putImageData(imgData, 0, 0);
        }
        setIsRendering(false);
        setRenderTime(performance.now() - state.startTime);
        setRayCount(state.totalRays);
        setProgress(100);
        return;
      }

      renderChunk(state, LINES_PER_CHUNK);

      const ctx = canvas.getContext("2d");
      if (ctx) {
        const imgData = ctx.createImageData(w, h);
        imgData.data.set(state.pixels);
        ctx.putImageData(imgData, 0, 0);
      }

      setProgress(Math.round((state.currentY / h) * 100));
      setRayCount(state.totalRays);

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [scene, resScale, maxBounces, aaSamples, shadowSamples]);

  useEffect(() => {
    if (needsRenderRef.current) {
      needsRenderRef.current = false;
      startRender();
    }
  }, [startRender]);

  const triggerRender = useCallback(() => {
    needsRenderRef.current = true;
    startRender();
  }, [startRender]);

  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const handlePresetChange = useCallback((idx: number) => {
    nextId = 1;
    setPreset(idx);
    const newScene = PRESETS[idx].build();
    setScene(newScene);
    setSelectedObjectId(null);
    needsRenderRef.current = true;
  }, []);

  useEffect(() => {
    if (needsRenderRef.current) {
      startRender();
      needsRenderRef.current = false;
    }
  }, [scene, startRender]);

  /* ---------- Mouse interaction ---------- */

  const getCanvasCoords = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const handleMouseDown = useCallback((e: MouseEvent) => {
    e.preventDefault();
    const coords = getCanvasCoords(e);
    const canvas = canvasRef.current;
    if (!canvas) return;

    const sphereId = pickSphere(scene, scene.camera, coords.x, coords.y, canvas.width, canvas.height);

    if (sphereId !== null) {
      setDragId(sphereId);
      setIsDragging(true);
      setSelectedObjectId(sphereId);
    } else {
      setIsOrbiting(true);
      setSelectedObjectId(null);
    }
    setLastMouse({ x: e.clientX, y: e.clientY });
  }, [scene, getCanvasCoords]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!lastMouse) return;
    const dx = e.clientX - lastMouse.x;
    const dy = e.clientY - lastMouse.y;
    setLastMouse({ x: e.clientX, y: e.clientY });

    if (isDragging && dragId !== null) {
      setScene((prev) => {
        const cam = prev.camera;
        const frame = buildCameraFrame(cam);
        const moveScale = 0.01;
        const objects = prev.objects.map((obj) => {
          if (obj.id !== dragId || obj.kind !== "sphere") return obj;
          const right = mul(frame.right, dx * moveScale);
          const up = mul(frame.up, -dy * moveScale);
          return { ...obj, center: add(add(obj.center, right), up) };
        });
        return { ...prev, objects };
      });
      needsRenderRef.current = true;
    }

    if (isOrbiting) {
      setScene((prev) => {
        const cam = prev.camera;
        const offset = sub(cam.position, cam.lookAt);
        const r = length(offset);
        const theta = Math.atan2(offset.x, offset.z) - dx * 0.005;
        const phi = Math.acos(Math.max(-0.99, Math.min(0.99, offset.y / r))) + dy * 0.005;
        const clampedPhi = Math.max(0.1, Math.min(Math.PI - 0.1, phi));
        const newPos = add(cam.lookAt, vec3(
          r * Math.sin(clampedPhi) * Math.sin(theta),
          r * Math.cos(clampedPhi),
          r * Math.sin(clampedPhi) * Math.cos(theta),
        ));
        return { ...prev, camera: { ...cam, position: newPos } };
      });
      needsRenderRef.current = true;
    }
  }, [lastMouse, isDragging, isOrbiting, dragId]);

  const handleMouseUp = useCallback(() => {
    if (isDragging || isOrbiting) {
      setIsDragging(false);
      setIsOrbiting(false);
      setDragId(null);
      setLastMouse(null);
      triggerRender();
    }
  }, [isDragging, isOrbiting, triggerRender]);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    setScene((prev) => {
      const cam = prev.camera;
      const dir = normalize(sub(cam.position, cam.lookAt));
      const zoomAmount = e.deltaY * 0.005;
      const dist = length(sub(cam.position, cam.lookAt));
      const newDist = Math.max(1, Math.min(20, dist + zoomAmount));
      const newPos = add(cam.lookAt, mul(dir, newDist));
      return { ...prev, camera: { ...cam, position: newPos } };
    });
    needsRenderRef.current = true;
    triggerRender();
  }, [triggerRender]);

  /* ---------- Selected object editing ---------- */

  const selectedObject = selectedObjectId !== null
    ? scene.objects.find((o) => o.id === selectedObjectId) ?? null
    : null;

  const updateSelectedObject = useCallback((updater: (obj: SceneObject) => SceneObject) => {
    if (selectedObjectId === null) return;
    setScene((prev) => ({
      ...prev,
      objects: prev.objects.map((o) => (o.id === selectedObjectId ? updater(o) : o)),
    }));
    needsRenderRef.current = true;
  }, [selectedObjectId]);

  /* ---------- Render UI ---------- */

  const inputClass =
    "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none";
  const labelClass = "block text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)] mb-0.5";
  const btnClass =
    "rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)]";
  const btnActiveClass =
    "rounded border border-[var(--color-primary)] bg-[var(--color-primary)] px-3 py-1.5 text-xs font-medium text-white";

  return (
    <div class="flex flex-col gap-4">
      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-2">
        {/* Presets */}
        <div class="flex flex-wrap gap-1">
          {PRESETS.map((p, i) => (
            <button
              key={p.name}
              class={i === preset ? btnActiveClass : btnClass}
              onClick={() => handlePresetChange(i)}
            >
              {p.name}
            </button>
          ))}
        </div>

        <div class="ml-auto flex items-center gap-2">
          <button
            class={btnClass}
            onClick={triggerRender}
            disabled={isRendering}
          >
            {isRendering ? "Rendering..." : "Re-render"}
          </button>
        </div>
      </div>

      {/* Main layout */}
      <div class="flex flex-col gap-4 lg:flex-row">
        {/* Canvas area */}
        <div class="flex-1">
          <div
            class="overflow-hidden rounded-lg border border-[var(--color-border)]"
            style={{ background: "var(--color-bg)" }}
          >
            <canvas
              ref={canvasRef}
              width={BASE_WIDTH}
              height={BASE_HEIGHT}
              style={{
                width: "100%",
                height: "auto",
                display: "block",
                imageRendering: resScale < 0.75 ? "pixelated" : "auto",
                cursor: isDragging ? "grabbing" : isOrbiting ? "grabbing" : "grab",
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onWheel={handleWheel}
            />
          </div>

          {/* Progress bar */}
          {isRendering && (
            <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface)]">
              <div
                class="h-full rounded-full transition-all"
                style={{
                  width: `${progress}%`,
                  background: "var(--color-primary)",
                }}
              />
            </div>
          )}

          {/* Stats */}
          <div class="mt-2 flex flex-wrap gap-4 text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
            <span>
              Resolution: {Math.round(BASE_WIDTH * resScale)}x{Math.round(BASE_HEIGHT * resScale)}
            </span>
            <span>Rays: {rayCount.toLocaleString()}</span>
            <span>Time: {(renderTime / 1000).toFixed(2)}s</span>
            <span>Progress: {progress}%</span>
          </div>

          {/* Interaction hint */}
          <p class="mt-1 text-[10px] text-[var(--color-text-muted)]">
            Click + drag spheres to move them. Drag background to orbit camera. Scroll to zoom.
          </p>
        </div>

        {/* Controls panel */}
        <div
          class="flex w-full shrink-0 flex-col gap-3 rounded-lg border border-[var(--color-border)] p-4 lg:w-64"
          style={{ background: "var(--color-surface)" }}
        >
          <h3 class="text-xs font-bold uppercase tracking-wider text-[var(--color-heading)]">
            Render Settings
          </h3>

          {/* Resolution */}
          <div>
            <label class={labelClass}>
              Resolution ({Math.round(resScale * 100)}%)
            </label>
            <input
              type="range"
              min="0.25"
              max="1"
              step="0.05"
              value={resScale}
              onInput={(e) => setResScale(parseFloat((e.target as HTMLInputElement).value))}
              class="w-full accent-[var(--color-primary)]"
            />
          </div>

          {/* Max bounces */}
          <div>
            <label class={labelClass}>Max Bounces ({maxBounces})</label>
            <input
              type="range"
              min="1"
              max="5"
              step="1"
              value={maxBounces}
              onInput={(e) => setMaxBounces(parseInt((e.target as HTMLInputElement).value))}
              class="w-full accent-[var(--color-primary)]"
            />
          </div>

          {/* AA Samples */}
          <div>
            <label class={labelClass}>AA Samples ({aaSamples})</label>
            <input
              type="range"
              min="1"
              max="4"
              step="1"
              value={aaSamples}
              onInput={(e) => setAaSamples(parseInt((e.target as HTMLInputElement).value))}
              class="w-full accent-[var(--color-primary)]"
            />
          </div>

          {/* Shadow Samples */}
          <div>
            <label class={labelClass}>Shadow Samples ({shadowSamples})</label>
            <input
              type="range"
              min="1"
              max="8"
              step="1"
              value={shadowSamples}
              onInput={(e) => setShadowSamples(parseInt((e.target as HTMLInputElement).value))}
              class="w-full accent-[var(--color-primary)]"
            />
          </div>

          <hr class="border-[var(--color-border)]" />

          {/* Background */}
          <h3 class="text-xs font-bold uppercase tracking-wider text-[var(--color-heading)]">
            Background
          </h3>
          <div class="flex items-center gap-2">
            <label class="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)]">
              <input
                type="checkbox"
                checked={scene.bgGradient}
                onChange={(e) => {
                  setScene((prev) => ({ ...prev, bgGradient: (e.target as HTMLInputElement).checked }));
                  needsRenderRef.current = true;
                }}
              />
              Gradient
            </label>
          </div>

          <hr class="border-[var(--color-border)]" />

          {/* Selected Object */}
          <h3 class="text-xs font-bold uppercase tracking-wider text-[var(--color-heading)]">
            Selected Object
          </h3>
          {selectedObject === null ? (
            <p class="text-[10px] text-[var(--color-text-muted)]">
              Click a sphere to select it
            </p>
          ) : selectedObject.kind === "sphere" ? (
            <div class="flex flex-col gap-2">
              <p class="text-[10px] text-[var(--color-text-muted)]">
                Sphere (r={selectedObject.radius.toFixed(2)})
              </p>

              {/* Material type */}
              <div>
                <label class={labelClass}>Material</label>
                <select
                  class={inputClass}
                  value={selectedObject.material.type}
                  onChange={(e) => {
                    const t = (e.target as HTMLSelectElement).value as MaterialType;
                    updateSelectedObject((obj) => {
                      if (obj.kind !== "sphere") return obj;
                      const c = obj.material.color;
                      let mat: Material;
                      switch (t) {
                        case "diffuse": mat = makeDiffuse(c); break;
                        case "reflective": mat = makeReflective(c); break;
                        case "refractive": mat = makeRefractive(c); break;
                        case "emissive": mat = makeEmissive(c); break;
                        default: mat = makeDiffuse(c);
                      }
                      return { ...obj, material: mat };
                    });
                  }}
                >
                  <option value="diffuse">Diffuse</option>
                  <option value="reflective">Reflective</option>
                  <option value="refractive">Refractive</option>
                  <option value="emissive">Emissive</option>
                </select>
              </div>

              {/* Color */}
              <div>
                <label class={labelClass}>Color</label>
                <input
                  type="color"
                  value={vecToHex(selectedObject.material.color)}
                  onInput={(e) => {
                    const hex = (e.target as HTMLInputElement).value;
                    const c = hexToVec(hex);
                    updateSelectedObject((obj) => {
                      if (obj.kind !== "sphere") return obj;
                      return { ...obj, material: { ...obj.material, color: c } };
                    });
                  }}
                  class="h-7 w-full cursor-pointer rounded border border-[var(--color-border)]"
                />
              </div>

              {/* Radius */}
              <div>
                <label class={labelClass}>Radius ({selectedObject.radius.toFixed(2)})</label>
                <input
                  type="range"
                  min="0.1"
                  max="2"
                  step="0.05"
                  value={selectedObject.radius}
                  onInput={(e) => {
                    const r = parseFloat((e.target as HTMLInputElement).value);
                    updateSelectedObject((obj) => {
                      if (obj.kind !== "sphere") return obj;
                      return { ...obj, radius: r };
                    });
                  }}
                  class="w-full accent-[var(--color-primary)]"
                />
              </div>

              {/* IOR for refractive */}
              {selectedObject.material.type === "refractive" && (
                <div>
                  <label class={labelClass}>
                    IOR ({selectedObject.material.ior.toFixed(2)})
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="2.5"
                    step="0.05"
                    value={selectedObject.material.ior}
                    onInput={(e) => {
                      const ior = parseFloat((e.target as HTMLInputElement).value);
                      updateSelectedObject((obj) => {
                        if (obj.kind !== "sphere") return obj;
                        return { ...obj, material: { ...obj.material, ior } };
                      });
                    }}
                    class="w-full accent-[var(--color-primary)]"
                  />
                </div>
              )}

              {/* Reflectivity for reflective */}
              {selectedObject.material.type === "reflective" && (
                <div>
                  <label class={labelClass}>
                    Reflectivity ({selectedObject.material.reflectivity.toFixed(2)})
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={selectedObject.material.reflectivity}
                    onInput={(e) => {
                      const r = parseFloat((e.target as HTMLInputElement).value);
                      updateSelectedObject((obj) => {
                        if (obj.kind !== "sphere") return obj;
                        return { ...obj, material: { ...obj.material, reflectivity: r } };
                      });
                    }}
                    class="w-full accent-[var(--color-primary)]"
                  />
                </div>
              )}

              {/* Emission for emissive */}
              {selectedObject.material.type === "emissive" && (
                <div>
                  <label class={labelClass}>
                    Emission ({selectedObject.material.emission.toFixed(1)})
                  </label>
                  <input
                    type="range"
                    min="0.5"
                    max="5"
                    step="0.5"
                    value={selectedObject.material.emission}
                    onInput={(e) => {
                      const em = parseFloat((e.target as HTMLInputElement).value);
                      updateSelectedObject((obj) => {
                        if (obj.kind !== "sphere") return obj;
                        return { ...obj, material: { ...obj.material, emission: em } };
                      });
                    }}
                    class="w-full accent-[var(--color-primary)]"
                  />
                </div>
              )}

              <button
                class={btnClass + " mt-1 w-full text-center"}
                onClick={triggerRender}
              >
                Apply & Re-render
              </button>
            </div>
          ) : (
            <p class="text-[10px] text-[var(--color-text-muted)]">
              Plane (not editable)
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   Color conversion helpers
   ================================================================ */

function vecToHex(v: Vec3): string {
  const toHex = (n: number) =>
    Math.round(Math.max(0, Math.min(1, n)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(v.x)}${toHex(v.y)}${toHex(v.z)}`;
}

function hexToVec(hex: string): Vec3 {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return vec3(r, g, b);
}
