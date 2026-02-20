import * as THREE from 'three'

type ThemeConfig = {
  id: number
  top: [number, number, number]
  mid: [number, number, number]
  bottom: [number, number, number]
  speed: number
}

const GRADIENT_COLORS: Record<string, ThemeConfig> = {
  sakura: { id: 0, top: [0.98, 0.82, 0.86], mid: [0.96, 0.72, 0.78], bottom: [0.92, 0.62, 0.72], speed: 0.09 },
  sunset: { id: 1, top: [1.0, 0.72, 0.48], mid: [0.94, 0.52, 0.38], bottom: [0.82, 0.38, 0.35], speed: 0.1 },
  ocean: { id: 2, top: [0.72, 0.87, 0.96], mid: [0.52, 0.74, 0.90], bottom: [0.38, 0.58, 0.77], speed: 0.075 },
  night: { id: 3, top: [0.21, 0.18, 0.34], mid: [0.14, 0.12, 0.24], bottom: [0.09, 0.08, 0.16], speed: 0.05 },
  forest: { id: 4, top: [0.84, 0.92, 0.76], mid: [0.62, 0.78, 0.56], bottom: [0.42, 0.60, 0.40], speed: 0.075 },
  lavender: { id: 5, top: [0.93, 0.86, 0.99], mid: [0.82, 0.72, 0.94], bottom: [0.67, 0.56, 0.82], speed: 0.09 },
  minimal: { id: 6, top: [0.94, 0.93, 0.91], mid: [0.91, 0.90, 0.88], bottom: [0.88, 0.87, 0.85], speed: 0.03 },
}

const DEFAULT_THEME = 'sakura'

let gradientMesh: THREE.Mesh | null = null
let gradientMaterial: THREE.ShaderMaterial | null = null
let currentScene: THREE.Scene | null = null

let transitionElapsed = 0
const transitionDuration = 1.0

const vertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const fragmentShader = `
varying vec2 vUv;

uniform float uTime;
uniform float uSpeed;
uniform vec3 uColorTop;
uniform vec3 uColorMid;
uniform vec3 uColorBottom;
uniform vec3 uTargetColorTop;
uniform vec3 uTargetColorMid;
uniform vec3 uTargetColorBottom;
uniform float uTheme;
uniform float uTargetTheme;
uniform float uBlend;

#define PI 3.141592653589793

vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 mod289(vec4 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 permute(vec4 x) {
  return mod289(((x * 34.0) + 1.0) * x);
}

vec4 taylorInvSqrt(vec4 r) {
  return 1.79284291400159 - 0.85373472095314 * r;
}

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(
    permute(
      permute(i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0)
    )
    + i.x + vec4(0.0, i1.x, i2.x, 1.0)
  );

  float n_ = 1.0 / 7.0;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

mat2 rot(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, -s, s, c);
}

float fbm(vec2 p, float t) {
  float f = 0.0;
  float a = 0.5;
  vec2 q = p;
  for (int i = 0; i < 3; i++) {
    f += a * snoise(vec3(q, t));
    q = rot(0.55) * q * 2.02 + vec2(1.7, -1.3);
    a *= 0.5;
  }
  return f;
}

float softCircle(vec2 uv, vec2 center, float radius, float blur) {
  float d = length(uv - center);
  return smoothstep(radius + blur, radius - blur, d);
}

vec3 renderTheme(float themeId, vec2 uv, float t, vec3 top, vec3 mid, vec3 bottom) {
  vec2 p = uv * 2.0 - 1.0;
  p.x *= 1.1;

  float flow = fbm(uv * vec2(2.3, 1.9), t * 0.117);
  float flow2 = fbm(uv * vec2(1.5, 2.8) + vec2(3.1, -1.7), t * 0.093);
  float gy = clamp(uv.y + flow * 0.03 + flow2 * 0.015, 0.0, 1.0);
  vec3 base = mix(bottom, mid, smoothstep(0.0, 0.55, gy));
  base = mix(base, top, smoothstep(0.45, 1.0, gy));

  vec3 color = base;

  if (themeId < 0.5) {
    float wc = fbm(uv * vec2(2.0, 1.6) + vec2(0.0, t * 0.06), t * 0.083);
    float wc2 = fbm(uv * vec2(3.8, 2.2) - vec2(t * 0.04, 0.0), t * 0.067);
    float stain = smoothstep(-0.45, 0.55, wc + wc2 * 0.6 + (uv.y - 0.5) * 0.35);
    color = mix(bottom, top * 0.98, stain);

    vec3 bokeh = vec3(0.0);
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      vec2 c = vec2(
        0.1 + hash21(vec2(fi, 1.0)) * 0.8 + sin(t * (0.06 + fi * 0.008) + fi * 2.7) * 0.14,
        0.15 + hash21(vec2(fi, 9.0)) * 0.7 + cos(t * (0.05 + fi * 0.01) + fi * 1.9) * 0.10
      );
      float r = 0.06 + hash21(vec2(fi, 5.0)) * 0.08;
      float orb = softCircle(uv, c, r, r * 0.85);
      bokeh += vec3(0.98, 0.78, 0.82) * orb * (0.05 + 0.04 * hash21(vec2(fi, 3.0)));
    }
    color += bokeh;
  } else if (themeId < 1.5) {
    // Pulsing sun glow
    float pulse = sin(t * 0.267) * 0.5 + 0.5;
    float pulse2 = sin(t * 0.433 + 1.5) * 0.5 + 0.5;
    float sunGlow = softCircle(uv, vec2(0.5, 0.65 + sin(t * 0.1) * 0.04), 0.35 + pulse * 0.08, 0.35);
    color += vec3(1.0, 0.85, 0.55) * sunGlow * (0.18 + pulse2 * 0.12);

    vec2 rayUv = rot(-0.55) * p;
    float ray = smoothstep(-0.4, 0.9, rayUv.x + fbm(vec2(rayUv.x * 1.8, rayUv.y * 0.6), t * 0.073) * 0.55);
    float band = sin(rayUv.x * 13.0 + t * 0.533 + fbm(rayUv * 1.4, t * 0.093) * 3.5) * 0.5 + 0.5;
    float rays = ray * band * smoothstep(-0.8, 0.3, rayUv.y);
    color += vec3(1.0, 0.8, 0.58) * rays * 0.32;

    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      vec2 c = vec2(0.15 + fi * 0.18 + sin(t * 0.067 + fi) * 0.08, 0.25 + hash21(vec2(fi, 7.0)) * 0.45);
      float orb = softCircle(uv, c, 0.13, 0.14);
      color += vec3(1.0, 0.74, 0.48) * orb * 0.12;
    }
  } else if (themeId < 2.5) {
    // Ocean wave undulation
    float wave1 = sin(uv.y * 8.0 + t * 0.6 + sin(uv.x * 4.0 + t * 0.3) * 1.2) * 0.5 + 0.5;
    float wave2 = sin(uv.y * 5.5 - t * 0.433 + cos(uv.x * 3.0 - t * 0.233) * 0.8) * 0.5 + 0.5;
    float wave3 = sin((uv.x + uv.y) * 6.0 + t * 0.367) * 0.5 + 0.5;
    float waveMix = wave1 * 0.45 + wave2 * 0.35 + wave3 * 0.2;
    color = mix(bottom, top * 1.08, waveMix);

    // Caustics overlay
    vec2 w = uv * 3.4;
    float c1 = sin((w.x + t * 0.4) * 3.2 + sin((w.y - t * 0.233) * 1.7));
    float c2 = sin((w.y - t * 0.333) * 3.7 + cos((w.x + t * 0.2) * 2.1));
    float c3 = sin((w.x + w.y + t * 0.283) * 2.9);
    float caustic = pow(clamp((c1 + c2 + c3) * 0.2 + 0.5, 0.0, 1.0), 2.0);
    color += vec3(0.98, 0.92, 0.75) * caustic * 0.08;
    color += vec3(0.75, 0.93, 1.0) * caustic * 0.05;
  } else if (themeId < 3.5) {
    color *= 0.85;
    for (int i = 0; i < 10; i++) {
      float fi = float(i);
      vec2 c = vec2(
        hash21(vec2(fi, 2.0)),
        hash21(vec2(fi, 4.0))
      );
      c += vec2(
        sin(t * (0.023 + fi * 0.003) + fi * 1.3) * 0.08,
        cos(t * (0.017 + fi * 0.004) + fi * 1.7) * 0.06
      );
      float r = 0.03 + hash21(vec2(fi, 8.0)) * 0.14;
      float orb = softCircle(uv, c, r, r * 1.4);
      vec3 warm = mix(vec3(1.0, 0.72, 0.45), vec3(1.0, 0.92, 0.68), hash21(vec2(fi, 6.0)));
      color += warm * orb * (0.11 + 0.07 * hash21(vec2(fi, 11.0)));
    }
  } else if (themeId < 4.5) {
    float canopy = fbm(uv * vec2(3.2, 2.6), t * 0.033);
    float canopy2 = fbm(uv * vec2(6.0, 4.2) + vec2(1.4, -0.8), t * 0.043);
    float leaves = smoothstep(-0.15, 0.55, canopy + canopy2 * 0.55);
    float sunDir = dot(normalize(vec2(0.7, 0.35)), p);
    float shafts = smoothstep(0.0, 0.9, sunDir + fbm(vec2(p.x * 1.4, p.y * 4.0), t * 0.027) * 0.45);
    color *= mix(0.78, 1.06, leaves);
    color += vec3(1.0, 0.9, 0.68) * shafts * 0.18;
    color -= vec3(0.08, 0.12, 0.06) * (1.0 - leaves) * 0.38;
  } else if (themeId < 5.5) {
    vec2 q = rot(0.35) * p;
    float fold1 = sin(q.x * 7.5 + t * 0.4 + fbm(q * 1.8, t * 0.073) * 3.5);
    float fold2 = sin(q.x * 3.2 - t * 0.267 + fbm(q * 2.5 + 3.0, t * 0.087) * 3.2);
    float silk = (fold1 * 0.55 + fold2 * 0.45) * 0.5 + 0.5;
    color = mix(bottom, top * 1.05, silk);
    color += vec3(1.0, 0.9, 0.98) * pow(silk, 4.0) * 0.14;
  } else {
    float breath = sin(t * 0.183 + uv.y * 1.8) * 0.5 + 0.5;
    float haze = fbm(uv * vec2(1.8, 1.4), t * 0.02) * 0.5 + 0.5;
    color = mix(bottom, top, 0.6 + breath * 0.06 + haze * 0.04);
    color += vec3(1.0, 0.97, 0.9) * (breath * 0.04);
  }

  float vignette = smoothstep(1.35, 0.3, length(p));
  color *= mix(0.92, 1.03, vignette);

  return color;
}

void main() {
  float t = uTime * uSpeed;
  vec3 fromTop = uColorTop;
  vec3 fromMid = uColorMid;
  vec3 fromBottom = uColorBottom;

  vec3 toTop = uTargetColorTop;
  vec3 toMid = uTargetColorMid;
  vec3 toBottom = uTargetColorBottom;

  vec3 cFrom = renderTheme(uTheme, vUv, t, fromTop, fromMid, fromBottom);
  vec3 cTo = renderTheme(uTargetTheme, vUv, t, toTop, toMid, toBottom);
  vec3 finalColor = mix(cFrom, cTo, smoothstep(0.0, 1.0, uBlend));

  gl_FragColor = vec4(finalColor, 1.0);
}
`

function colorFromTuple(rgb: [number, number, number]) {
  return new THREE.Color(rgb[0], rgb[1], rgb[2])
}

function getTheme(theme: string) {
  return GRADIENT_COLORS[theme] ?? GRADIENT_COLORS[DEFAULT_THEME]
}

function isEmbedMode(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).has('embed')
}

export function initGradientBackground(scene: THREE.Scene, initialTheme?: string) {
  removeGradientBackground()
  currentScene = scene

  const defaultTheme = getTheme(initialTheme || DEFAULT_THEME)
  gradientMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSpeed: { value: defaultTheme.speed },
      uColorTop: { value: colorFromTuple(defaultTheme.top) },
      uColorMid: { value: colorFromTuple(defaultTheme.mid) },
      uColorBottom: { value: colorFromTuple(defaultTheme.bottom) },
      uTargetColorTop: { value: colorFromTuple(defaultTheme.top) },
      uTargetColorMid: { value: colorFromTuple(defaultTheme.mid) },
      uTargetColorBottom: { value: colorFromTuple(defaultTheme.bottom) },
      uTheme: { value: defaultTheme.id },
      uTargetTheme: { value: defaultTheme.id },
      uBlend: { value: 1 },
    },
    vertexShader,
    fragmentShader,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    transparent: false,
  })

  gradientMesh = new THREE.Mesh(new THREE.PlaneGeometry(64, 48), gradientMaterial)
  gradientMesh.name = 'gradient-background'
  gradientMesh.position.set(0, 1.1, -8)
  gradientMesh.renderOrder = -1000
  gradientMesh.frustumCulled = false
  scene.add(gradientMesh)
}

export function setGradientTheme(theme: string) {
  if (!gradientMaterial) return
  const next = getTheme(theme)
  const uniforms = gradientMaterial.uniforms

  ;(uniforms.uColorTop.value as THREE.Color).copy(uniforms.uTargetColorTop.value as THREE.Color)
  ;(uniforms.uColorMid.value as THREE.Color).copy(uniforms.uTargetColorMid.value as THREE.Color)
  ;(uniforms.uColorBottom.value as THREE.Color).copy(uniforms.uTargetColorBottom.value as THREE.Color)

  ;(uniforms.uTargetColorTop.value as THREE.Color).copy(colorFromTuple(next.top))
  ;(uniforms.uTargetColorMid.value as THREE.Color).copy(colorFromTuple(next.mid))
  ;(uniforms.uTargetColorBottom.value as THREE.Color).copy(colorFromTuple(next.bottom))

  uniforms.uTheme.value = uniforms.uTargetTheme.value
  uniforms.uTargetTheme.value = next.id
  uniforms.uSpeed.value = next.speed
  uniforms.uBlend.value = 0
  transitionElapsed = 0
}

export function updateGradientBackground(elapsed: number, delta: number) {
  if (!gradientMaterial) return
  const uniforms = gradientMaterial.uniforms
  uniforms.uTime.value = elapsed

  if (uniforms.uBlend.value < 1) {
    transitionElapsed += delta
    uniforms.uBlend.value = Math.min(1, transitionElapsed / transitionDuration)
  }
}

export function isGradientBackgroundActive(): boolean {
  return gradientMesh !== null
}

export function removeGradientBackground() {
  if (gradientMesh && currentScene) {
    currentScene.remove(gradientMesh)
    ;(gradientMesh.geometry as THREE.BufferGeometry).dispose()
  }
  if (gradientMaterial) {
    gradientMaterial.dispose()
  }

  gradientMesh = null
  gradientMaterial = null
}
