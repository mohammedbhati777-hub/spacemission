/* ============================================================
   GLSL — procedural planet surfaces, sun, atmospheres,
   starfield, engine exhaust, ring system.
   ============================================================ */

export const NOISE_GLSL = /* glsl */ `
  float hash(vec3 p) {
    p = fract(p * vec3(127.1, 311.7, 74.7));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }
  float noise(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.07; a *= 0.5; }
    return v;
  }
`;

export const planetVert = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const planetFrag = /* glsl */ `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform vec3 uSunDir;
  uniform vec3 uAtmo;
  uniform float uAtmoStrength;
  uniform float uBands;
  uniform float uSeed;
  uniform float uOcean;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec3 vLocal;
  ${NOISE_GLSL}
  void main() {
    vec3 n = normalize(vNormalW);
    vec3 p = vLocal * 2.6 + vec3(uSeed);
    float f1 = fbm(p);
    float f2 = fbm(p * 2.7 + 4.7);

    vec3 base;
    if (uBands > 0.5) {
      // gas giant — latitudinal bands sheared by turbulence
      float lat = vLocal.y * 6.0 + f1 * 1.9;
      float band = sin(lat * 3.1) * 0.5 + 0.5;
      float band2 = sin(lat * 7.3 + 2.0) * 0.5 + 0.5;
      base = mix(uColorC, uColorB, smoothstep(0.25, 0.75, band));
      base = mix(base, uColorA, smoothstep(0.55, 0.9, band2) * 0.45);
      // storms
      float storm = smoothstep(0.62, 0.78, fbm(p * 3.2 + 9.0));
      base = mix(base, uColorA * 1.25, storm * 0.4);
    } else {
      // rocky — crust noise, optional oceans + polar caps
      float cont = fbm(p * 1.15 + 2.2);
      base = mix(uColorC, uColorB, smoothstep(0.3, 0.68, cont));
      float hi = smoothstep(0.55, 0.8, f2);
      base = mix(base, uColorA, hi * 0.85);
      if (uOcean > 0.5) {
        float landMask = smoothstep(0.5, 0.545, cont);
        vec3 ocean = mix(vec3(0.016, 0.09, 0.26), vec3(0.04, 0.24, 0.5), f2);
        base = mix(ocean, base, landMask);
        float cap = smoothstep(0.72, 0.86, abs(vLocal.y) * 1.15 + f1 * 0.22);
        base = mix(base, vec3(0.92, 0.95, 0.99), cap);
        float cloud = smoothstep(0.55, 0.8, fbm(p * 2.2 + vec3(uSeed * 3.1, 0.0, uSeed)));
        base = mix(base, vec3(0.95, 0.97, 1.0), cloud * 0.55 * landMask + cloud * 0.35);
      }
    }

    // sunlight
    vec3 sd = normalize(uSunDir);
    float ndl = dot(n, sd);
    float day = smoothstep(-0.12, 0.35, ndl);
    vec3 lit = base * (0.028 + day * 1.18);
    // warm terminator
    lit += uColorA * 0.16 * smoothstep(0.18, 0.0, abs(ndl)) * day;

    // atmospheric rim
    vec3 viewDir = normalize(cameraPosition - vPosW);
    float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 2.6);
    lit += uAtmo * fres * uAtmoStrength * (0.25 + day * 0.85);

    gl_FragColor = vec4(lit, 1.0);
  }
`;

export const atmosphereFrag = /* glsl */ `
  uniform vec3 uAtmo;
  uniform vec3 uSunDir;
  uniform float uStrength;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vec3 n = normalize(vNormalW);
    vec3 viewDir = normalize(cameraPosition - vPosW);
    float rim = pow(1.0 - abs(dot(n, viewDir)), 3.0);
    float day = smoothstep(-0.35, 0.4, dot(n, normalize(uSunDir)));
    vec3 col = uAtmo * rim * (0.3 + day) * uStrength;
    gl_FragColor = vec4(col, rim * uStrength * (0.2 + day * 0.8));
  }
`;

export const sunFrag = /* glsl */ `
  uniform float uTime;
  varying vec3 vLocal;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  ${NOISE_GLSL}
  void main() {
    vec3 p = vLocal * 2.4;
    float f = fbm(p + uTime * 0.06);
    float f2 = fbm(p * 3.1 - uTime * 0.04);
    vec3 deep = vec3(0.85, 0.28, 0.02);
    vec3 mid = vec3(1.0, 0.62, 0.12);
    vec3 hot = vec3(1.0, 0.93, 0.66);
    vec3 col = mix(deep, mid, smoothstep(0.25, 0.6, f));
    col = mix(col, hot, smoothstep(0.55, 0.85, f2));
    vec3 viewDir = normalize(cameraPosition - vPosW);
    float limb = pow(max(dot(normalize(vNormalW), viewDir), 0.0), 0.55);
    col *= 0.55 + 0.45 * limb;
    gl_FragColor = vec4(col * 1.35, 1.0);
  }
`;

export const starVert = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aPhase;
  uniform float uTime;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vTw;
  void main() {
    vColor = aColor;
    vTw = 0.72 + 0.28 * sin(uTime * (0.6 + fract(aPhase) * 1.6) + aPhase * 17.0);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio * (620.0 / -mv.z);
    gl_PointSize = clamp(gl_PointSize, 0.7, 7.0);
    gl_Position = projectionMatrix * mv;
  }
`;

export const starFrag = /* glsl */ `
  varying vec3 vColor;
  varying float vTw;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float a = smoothstep(0.5, 0.06, d) * vTw;
    gl_FragColor = vec4(vColor, a);
  }
`;

export const exhaustVert = /* glsl */ `
  attribute float aLife;
  attribute float aSize;
  varying float vLife;
  void main() {
    vLife = aLife;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (240.0 / -mv.z) * (0.4 + aLife);
    gl_PointSize = clamp(gl_PointSize, 0.5, 42.0);
    gl_Position = projectionMatrix * mv;
  }
`;

export const exhaustFrag = /* glsl */ `
  varying float vLife;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float a = smoothstep(0.5, 0.0, d) * vLife;
    vec3 col = mix(vec3(1.0, 0.42, 0.1), vec3(1.0, 0.85, 0.55), vLife);
    gl_FragColor = vec4(col, a * 0.85);
  }
`;

export const ringFrag = /* glsl */ `
  uniform vec3 uSunDir;
  varying vec2 vUv2;
  varying vec3 vNormalW;
  ${NOISE_GLSL}
  void main() {
    float r = length(vUv2 - 0.5) * 2.0; // 0..1 across ring
    float bands = sin(r * 78.0) * 0.5 + 0.5;
    float bands2 = sin(r * 23.0 + 4.0) * 0.5 + 0.5;
    float n = fbm(vec3(r * 26.0, 3.1, 7.7));
    float gap = smoothstep(0.42, 0.46, r) * (1.0 - smoothstep(0.52, 0.56, r)); // Cassini-ish
    float alpha = (0.25 + 0.5 * bands) * (0.4 + 0.6 * bands2) * (0.45 + 0.55 * n);
    alpha *= (1.0 - gap * 0.85);
    alpha *= smoothstep(0.0, 0.08, r) * (1.0 - smoothstep(0.9, 1.0, r));
    vec3 col = mix(vec3(0.55, 0.47, 0.36), vec3(0.85, 0.78, 0.62), bands2);
    float day = 0.35 + 0.65 * abs(dot(normalize(vNormalW), normalize(uSunDir)));
    gl_FragColor = vec4(col * day, alpha * 0.82);
  }
`;

export const ringVert = /* glsl */ `
  varying vec2 vUv2;
  varying vec3 vNormalW;
  void main() {
    vUv2 = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }
`;
