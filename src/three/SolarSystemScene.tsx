/* ============================================================
   3D SOLAR SYSTEM — everything visual lives here.
   Planets ephemeris-driven, spacecraft from the integrator,
   trails emergent, camera cinematic.
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree, ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import {
  AU, EARTH, MARS, MOON, PLANETS, PlanetDef, Vec3,
  localScaleFor, realScale, scaleRadius, vLen, vSub,
} from "../lib/constants";
import { engine } from "../lib/engine";
import { hohmannPoints } from "../lib/orbital";
import { useSim, FocusTarget } from "../store";
import { sound } from "../lib/audio";

/* invisible raycast target — generous, so small planets stay clickable */
function HitSphere({ r, onPick, onHover }: { r: number; onPick: () => void; onHover?: (h: boolean) => void }) {
  const [hov, setHov] = useState(false);
  useEffect(() => () => { document.body.style.cursor = ""; }, []);
  return (
    <mesh
      onClick={(e: ThreeEvent<MouseEvent>) => { if (e.delta < 6) { e.stopPropagation(); sound.click(); onPick(); } }}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setHov(true); onHover?.(true); document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { setHov(false); onHover?.(false); document.body.style.cursor = ""; }}
    >
      <sphereGeometry args={[r, 12, 12]} />
      <meshBasicMaterial transparent opacity={hov ? 0.07 : 0} depthWrite={false} color="#8fc3ff" />
    </mesh>
  );
}
import {
  atmosphereFrag, exhaustFrag, exhaustVert, planetFrag, planetVert,
  ringFrag, ringVert, starFrag, starVert, sunFrag,
} from "./shaders";

type ScaleMode = "presentation" | "realistic";

function helioToRender(pos: Vec3, mode: ScaleMode): THREE.Vector3 {
  const len = Math.max(vLen(pos), 1);
  const s = scaleRadius(len, mode) / len;
  return new THREE.Vector3(pos.x * s, pos.y * s, pos.z * s);
}

function craftRenderInfo(pos: Vec3, mode: ScaleMode): { p: THREE.Vector3; region: PlanetDef | null; regionPos: THREE.Vector3 | null } {
  const tAbs = engine.absTime();
  for (const id of ["earth", "mars"]) {
    const st = engine.planetState(id, tAbs);
    const d = vLen(vSub(pos, st.pos));
    const def = id === "earth" ? EARTH : MARS;
    if (d < def.radius * 16) {
      const rp = helioToRender(st.pos, mode);
      const ls = localScaleFor(def);
      const off = vSub(pos, st.pos);
      return {
        p: new THREE.Vector3(rp.x + (off.x / 1e6) * ls, rp.y + (off.y / 1e6) * ls, rp.z + (off.z / 1e6) * ls),
        region: def, regionPos: rp,
      };
    }
  }
  return { p: helioToRender(pos, mode), region: null, regionPos: null };
}

const hexToV3 = (h: string) => {
  const c = new THREE.Color(h);
  return new THREE.Vector3(c.r, c.g, c.b);
};

/* ---------------- starfield ---------------- */
function Starfield() {
  const quality = useSim((s) => s.quality);
  const ref = useRef<THREE.Points>(null);
  const { gl } = useThree();
  const count = quality === "CINEMATIC" ? 7000 : quality === "BALANCED" ? 4200 : 2000;

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    const tint = [new THREE.Color("#cfe2ff"), new THREE.Color("#ffffff"), new THREE.Color("#ffe9c8"), new THREE.Color("#a8c8ff"), new THREE.Color("#ffd2a8")];
    for (let i = 0; i < count; i++) {
      const rr = 3200 + Math.random() * 5200;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = rr * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = rr * Math.cos(ph) * 0.9;
      pos[i * 3 + 2] = rr * Math.sin(ph) * Math.sin(th);
      const c = tint[Math.floor(Math.random() * tint.length)];
      const b = 0.35 + Math.random() * 0.65;
      col[i * 3] = c.r * b; col[i * 3 + 1] = c.g * b; col[i * 3 + 2] = c.b * b;
      size[i] = 0.6 + Math.pow(Math.random(), 2.5) * 2.6;
      phase[i] = Math.random() * 100;
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    g.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    return g;
  }, [count]);

  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: starVert, fragmentShader: starFrag,
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }), []);

  useFrame((_, dt) => {
    mat.uniforms.uTime.value += dt;
    mat.uniforms.uPixelRatio.value = gl.getPixelRatio();
    if (ref.current) ref.current.rotation.y += dt * 0.0016;
  });

  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  return <points ref={ref} geometry={geo} material={mat} frustumCulled={false} />;
}

/* ---------------- sun ---------------- */
function Sun() {
  const mode = useSim((s) => s.scaleMode);
  const quality = useSim((s) => s.quality);
  const setFocus = useSim((s) => s.setFocus);
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const coronaRef = useRef<THREE.Sprite>(null);
  const r = mode === "presentation" ? 9 : 1.4;

  const coronaTex = useMemo(() => {
    const cv = document.createElement("canvas");
    cv.width = 256; cv.height = 256;
    const ctx = cv.getContext("2d")!;
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, "rgba(255,196,110,0.85)");
    g.addColorStop(0.25, "rgba(255,150,50,0.32)");
    g.addColorStop(0.6, "rgba(255,110,30,0.08)");
    g.addColorStop(1, "rgba(255,90,20,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(cv);
    return t;
  }, []);

  useFrame((_, dt) => {
    if (matRef.current) matRef.current.uniforms.uTime.value += dt;
    if (coronaRef.current) {
      const s = (mode === "presentation" ? 92 : 16) * (1 + Math.sin(matRef.current?.uniforms.uTime.value * 0.8 || 0) * 0.02);
      coronaRef.current.scale.set(s, s, 1);
    }
  });
  useEffect(() => () => coronaTex.dispose(), [coronaTex]);

  return (
    <group>
      <mesh>
        <sphereGeometry args={[r, 48, 48]} />
        <shaderMaterial ref={matRef} vertexShader={planetVert} fragmentShader={sunFrag} uniforms={{ uTime: { value: 0 } }} />
      </mesh>
      {quality !== "PERFORMANCE" && (
        <sprite ref={coronaRef} scale={[92, 92, 1]} raycast={() => null}>
          <spriteMaterial map={coronaTex} blending={THREE.AdditiveBlending} depthWrite={false} transparent opacity={0.9} />
        </sprite>
      )}
      <pointLight color="#fff1da" intensity={2.8} decay={0} distance={0} />
      <HitSphere r={r * 1.55} onPick={() => setFocus("sun")} />
    </group>
  );
}

/* ---------------- label sprite ---------------- */
function makeLabelTexture(text: string): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = 256; cv.height = 64;
  const ctx = cv.getContext("2d")!;
  ctx.font = "500 26px 'IBM Plex Mono', monospace";
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(170,200,235,0.8)";
  ctx.fillText(text, 128, 40);
  return new THREE.CanvasTexture(cv);
}

function Label({ text, y, scale = 7, bright = false }: { text: string; y: number; scale?: number; bright?: boolean }) {
  const tex = useMemo(() => makeLabelTexture(text), [text]);
  const mat = useRef<THREE.SpriteMaterial>(null);
  useEffect(() => () => tex.dispose(), [tex]);
  useFrame((_, dt) => {
    if (mat.current) mat.current.opacity = THREE.MathUtils.damp(mat.current.opacity, bright ? 1 : 0.75, 8, dt);
  });
  return (
    <sprite position={[0, y, 0]} scale={[scale, scale * 0.25, 1]} raycast={() => null}>
      <spriteMaterial ref={mat} map={tex} transparent depthWrite={false} opacity={0.75} color={bright ? "#d5e8ff" : "#ffffff"} />
    </sprite>
  );
}

/* ---------------- planet ---------------- */
function Planet({ def }: { def: PlanetDef }) {
  const mode = useSim((s) => s.scaleMode);
  const showOrbits = useSim((s) => s.showOrbits);
  const setFocus = useSim((s) => s.setFocus);
  const [hovered, setHovered] = useState(false);
  const group = useRef<THREE.Group>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const ringMatRef = useRef<THREE.ShaderMaterial>(null);
  const atmoMatRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(() => ({
    uColorA: { value: hexToV3(def.colors[0]) },
    uColorB: { value: hexToV3(def.colors[1]) },
    uColorC: { value: hexToV3(def.colors[2]) },
    uSunDir: { value: new THREE.Vector3(-1, 0, 0) },
    uAtmo: { value: hexToV3(def.atmosphere || "#88aacc") },
    uAtmoStrength: { value: def.atmosphere ? (def.id === "earth" ? 0.85 : 0.55) : 0.12 },
    uBands: { value: ["jupiter", "saturn", "uranus", "neptune"].includes(def.id) ? 1 : 0 },
    uSeed: { value: def.phase0 * 13.7 + 2.1 },
    uOcean: { value: def.id === "earth" ? 1 : 0 },
  }), [def]);

  const orbitGeo = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 256; i++) {
      const a = (i / 256) * Math.PI * 2;
      const rr = scaleRadius(def.a * AU, mode);
      pts.push(new THREE.Vector3(Math.cos(a) * rr, 0, -Math.sin(a) * rr));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [def, mode]);

  useFrame((_, dt) => {
    const st = engine.planetState(def.id, engine.absTime());
    const rp = helioToRender(st.pos, mode);
    if (group.current) {
      group.current.position.copy(rp);
      group.current.rotation.y += dt * 0.06;
    }
    const sunDir = rp.clone().normalize().multiplyScalar(-1);
    if (matRef.current) matRef.current.uniforms.uSunDir.value.copy(sunDir);
    if (ringMatRef.current) ringMatRef.current.uniforms.uSunDir.value.copy(sunDir);
    if (atmoMatRef.current) atmoMatRef.current.uniforms.uSunDir.value.copy(sunDir);
  });

  useEffect(() => () => orbitGeo.dispose(), [orbitGeo]);
  const visR = mode === "realistic" ? Math.max(def.renderR * 0.32, 0.22) : def.renderR;

  const orbitLine = useMemo(() => {
    const l = new THREE.Line(orbitGeo, new THREE.LineBasicMaterial({ color: "#3d5a80", transparent: true, opacity: 0.22 }));
    l.frustumCulled = false;
    return l;
  }, [orbitGeo]);
  useEffect(() => () => { (orbitLine.material as THREE.Material).dispose(); }, [orbitLine]);
  useFrame(() => { orbitLine.visible = showOrbits; });

  return (
    <group>
      <primitive object={orbitLine} />
      <group ref={group}>
        <HitSphere r={Math.max(visR * 2.3, 2.4)} onPick={() => setFocus(def.id as FocusTarget)} onHover={setHovered} />
        <mesh>
          <sphereGeometry args={[visR, 44, 44]} />
          <shaderMaterial ref={matRef} vertexShader={planetVert} fragmentShader={planetFrag} uniforms={uniforms} />
        </mesh>
        {def.atmosphere && (
          <mesh scale={1.055}>
            <sphereGeometry args={[visR, 32, 32]} />
            <shaderMaterial
              ref={atmoMatRef} vertexShader={planetVert} fragmentShader={atmosphereFrag}
              uniforms={{ uAtmo: uniforms.uAtmo, uSunDir: uniforms.uSunDir, uStrength: { value: def.id === "earth" ? 1.0 : 0.6 } }}
              transparent blending={THREE.AdditiveBlending} side={THREE.BackSide} depthWrite={false}
            />
          </mesh>
        )}
        {def.rings && (
          <mesh rotation={[Math.PI / 2 - 0.35, 0, 0.1]}>
            <ringGeometry args={[visR * 1.35, visR * 2.35, 128, 1]} />
            <shaderMaterial
              ref={ringMatRef} vertexShader={ringVert} fragmentShader={ringFrag}
              uniforms={{ uSunDir: uniforms.uSunDir }}
              transparent side={THREE.DoubleSide} depthWrite={false}
            />
          </mesh>
        )}
        <Label text={def.name} y={visR + 1.5} bright={hovered} />
      </group>
    </group>
  );
}

/* ---------------- moon ---------------- */
function Moon() {
  const mode = useSim((s) => s.scaleMode);
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const tAbs = engine.absTime();
    const e = engine.planetState("earth", tAbs);
    const erp = helioToRender(e.pos, mode);
    const th = (2 * Math.PI * tAbs) / MOON.period;
    const off = mode === "presentation" ? 3.4 : realScale(MOON.a);
    if (ref.current) ref.current.position.set(erp.x + Math.cos(th) * off, erp.y, erp.z - Math.sin(th) * off);
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[mode === "presentation" ? 0.42 : 0.12, 20, 20]} />
      <meshStandardMaterial color="#9a9a94" roughness={0.95} />
    </mesh>
  );
}

/* ---------------- trails ---------------- */
function makeLine(color: string, opacity: number, maxPts: number) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(maxPts * 3), 3));
  geo.setDrawRange(0, 0);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  return { line, geo, attr: geo.getAttribute("position") as THREE.BufferAttribute };
}

function Trails() {
  const mode = useSim((s) => s.scaleMode);
  const panel = useSim((s) => s.panel);
  const phase = useSim((s) => s.phase);
  const cruise = useMemo(() => makeLine("#59b7ff", 0.45, 9000), []);
  const pred = useMemo(() => makeLine("#ffb454", 0.4, 500), []);
  const ghost = useMemo(() => makeLine("#ff9d5c", 0.5, 4200), []);
  const local = useMemo(() => makeLine("#a8d4ff", 0.85, 1600), []);
  const hoh = useMemo(() => makeLine("#57d99a", 0.35, 260), []);
  const localPts = useRef<Vec3[]>([]);
  const localRegion = useRef<string | null>(null);
  const frame = useRef(0);

  useEffect(() => {
    const objs = [cruise, pred, ghost, local, hoh];
    objs.forEach((o) => o.line.removeFromParent());
    return () => objs.forEach((o) => { o.geo.dispose(); (o.line.material as THREE.Material).dispose(); });
  }, [cruise, pred, ghost, local, hoh]);

  useFrame(() => {
    frame.current++;
    /* cruise trail */
    let n = 0;
    for (const p of engine.trail) {
      const v = helioToRender(p, mode);
      cruise.attr.setXYZ(n++, v.x, v.y, v.z);
    }
    cruise.attr.needsUpdate = true;
    cruise.geo.setDrawRange(0, n);

    /* prediction */
    const pr = engine.prediction;
    if (pr) {
      let m = 0;
      for (const p of pr.points) {
        const v = helioToRender(p, mode);
        pred.attr.setXYZ(m++, v.x, v.y, v.z);
      }
      pred.attr.needsUpdate = true;
      pred.geo.setDrawRange(0, m);
      pred.line.visible = true;
    } else pred.line.visible = false;

    /* ghost */
    let g = 0;
    for (const p of engine.ghostTrail) {
      const v = helioToRender(p, mode);
      ghost.attr.setXYZ(g++, v.x, v.y, v.z);
    }
    ghost.attr.needsUpdate = true;
    ghost.geo.setDrawRange(0, g);
    ghost.line.visible = g > 1;

    /* local orbit trail */
    const info = craftRenderInfo(engine.craft.pos, mode);
    const regionId = info.region ? info.region.id : null;
    if (regionId !== localRegion.current) {
      localRegion.current = regionId;
      localPts.current = [];
    }
    if (info.region && info.regionPos) {
      const ls = localScaleFor(info.region);
      const last = localPts.current[localPts.current.length - 1];
      if (!last || vLen(vSub(engine.craft.pos, last)) * ls / 1e6 > 0.05) {
        localPts.current.push({ ...engine.craft.pos });
        if (localPts.current.length > 1500) localPts.current = localPts.current.filter((_, i) => i % 2 === 0);
      }
      const st = engine.planetState(info.region.id, engine.absTime());
      let k = 0;
      for (const p of localPts.current) {
        const off = vSub(p, st.pos);
        local.attr.setXYZ(k++, info.regionPos.x + (off.x / 1e6) * ls, info.regionPos.y + (off.y / 1e6) * ls, info.regionPos.z + (off.z / 1e6) * ls);
      }
      local.attr.needsUpdate = true;
      local.geo.setDrawRange(0, k);
      local.line.visible = k > 1;
    } else local.line.visible = false;

    /* hohmann preview while planning */
    const showHoh = panel === "planner" || phase === "PLANNING";
    if (showHoh && frame.current % 20 === 0) {
      const earthAng = engine.angleOf("earth", engine.t);
      const pts = hohmannPoints(AU, 1.5237 * AU, earthAng, (r) => scaleRadius(r, mode), 240);
      let h = 0;
      for (const p of pts) hoh.attr.setXYZ(h++, p.x, p.y, p.z);
      hoh.attr.needsUpdate = true;
      hoh.geo.setDrawRange(0, h);
    }
    hoh.line.visible = showHoh;
  });

  return (
    <group>
      <primitive object={cruise.line} />
      <primitive object={pred.line} />
      <primitive object={ghost.line} />
      <primitive object={local.line} />
      <primitive object={hoh.line} />
    </group>
  );
}

/* ---------------- spacecraft ---------------- */
const EX_MAX = 320;
function Spacecraft() {
  const mode = useSim((s) => s.scaleMode);
  const setFocus = useSim((s) => s.setFocus);
  const group = useRef<THREE.Group>(null);
  const s1 = useRef<THREE.Mesh>(null);
  const s2 = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Sprite>(null);
  const pts = useRef<THREE.Points>(null);
  const { gl } = useThree();

  const ex = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(EX_MAX * 3);
    const life = new Float32Array(EX_MAX);
    const size = new Float32Array(EX_MAX);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aLife", new THREE.BufferAttribute(life, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: exhaustVert, fragmentShader: exhaustFrag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const vel = new Float32Array(EX_MAX * 3);
    return { geo, mat, vel, cursor: 0 };
  }, []);

  const debrisMats = useMemo(() => new THREE.MeshStandardMaterial({ color: "#7d8794", roughness: 0.8, metalness: 0.4 }), []);
  const debrisGroup = useRef<THREE.Group>(null);
  const debrisMeshes = useMemo(() => {
    const arr: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 2.6, 10), debrisMats);
      m.visible = false;
      arr.push(m);
    }
    return arr;
  }, [debrisMats]);

  const glowTex = useMemo(() => {
    const cv = document.createElement("canvas");
    cv.width = 64; cv.height = 64;
    const ctx = cv.getContext("2d")!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,220,160,1)");
    g.addColorStop(0.4, "rgba(255,150,60,0.6)");
    g.addColorStop(1, "rgba(255,100,30,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  }, []);

  useFrame((state, dt) => {
    const c = engine.craft;
    const info = craftRenderInfo(c.pos, mode);
    if (!group.current) return;
    group.current.position.copy(info.p);

    /* attitude */
    const burning = c.burning && engine.stageFuel[engine.activeStage] > 0;
    const dirAtt = burning && c.burnMode !== "attitude" && c.burnMode !== "ascent"
      ? c.burnVec
      : burning && c.burnMode === "ascent" ? c.burnVec : c.attitude;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dirAtt.x, dirAtt.y, dirAtt.z).normalize());
    group.current.quaternion.slerp(q, Math.min(1, dt * 4));

    /* scale by context */
    const targetScale = info.region ? 0.3 : mode === "presentation" ? 1 : 1.5;
    const cs = THREE.MathUtils.damp(group.current.scale.x, targetScale, 3, dt);
    group.current.scale.set(cs, cs, cs);

    /* stage visibility */
    if (s1.current) s1.current.visible = !engine.separated[0];
    if (s2.current) s2.current.visible = !engine.separated[1];
    if (glow.current) glow.current.visible = burning;

    /* exhaust particles */
    const posAttr = ex.geo.getAttribute("position") as THREE.BufferAttribute;
    const lifeAttr = ex.geo.getAttribute("aLife") as THREE.BufferAttribute;
    const sizeAttr = ex.geo.getAttribute("aSize") as THREE.BufferAttribute;
    if (burning && phaseAllowsExhaust(engine.phase)) {
      const nozzle = new THREE.Vector3(0, -2.4, 0).applyQuaternion(group.current.quaternion).multiplyScalar(cs).add(info.p);
      const back = new THREE.Vector3(dirAtt.x, dirAtt.y, dirAtt.z).normalize().multiplyScalar(-1);
      for (let e = 0; e < 7; e++) {
        const i = ex.cursor;
        ex.cursor = (ex.cursor + 1) % EX_MAX;
        posAttr.setXYZ(i, nozzle.x + (Math.random() - 0.5) * 0.12, nozzle.y + (Math.random() - 0.5) * 0.12, nozzle.z + (Math.random() - 0.5) * 0.12);
        const sp = (7 + Math.random() * 6) * (info.region ? 0.5 : 1);
        ex.vel[i * 3] = back.x * sp + (Math.random() - 0.5) * 1.2;
        ex.vel[i * 3 + 1] = back.y * sp + (Math.random() - 0.5) * 1.2;
        ex.vel[i * 3 + 2] = back.z * sp + (Math.random() - 0.5) * 1.2;
        lifeAttr.setX(i, 1);
        sizeAttr.setX(i, 0.7 + Math.random() * 0.9);
      }
    }
    for (let i = 0; i < EX_MAX; i++) {
      let l = lifeAttr.getX(i);
      if (l <= 0) continue;
      l = Math.max(0, l - dt * 1.9);
      lifeAttr.setX(i, l);
      if (l > 0) {
        posAttr.setXYZ(i,
          posAttr.getX(i) + ex.vel[i * 3] * dt,
          posAttr.getY(i) + ex.vel[i * 3 + 1] * dt,
          posAttr.getZ(i) + ex.vel[i * 3 + 2] * dt);
      }
    }
    posAttr.needsUpdate = true;
    lifeAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;

    /* debris */
    debrisMeshes.forEach((m, i) => {
      const d = engine.debris[i];
      if (!d) { m.visible = false; return; }
      m.visible = true;
      const di = craftRenderInfo(d.pos, mode);
      m.position.copy(di.p);
      m.rotation.x += dt * d.spin * 0.4;
      m.rotation.z += dt * d.spin * 0.3;
      const ds = di.region ? 0.3 : 1;
      m.scale.set(ds, ds, ds);
    });
    void state; void gl;
  });

  return (
    <group>
      <group ref={group}>
        <HitSphere r={4.2} onPick={() => setFocus("craft")} />
        {/* stage 1 booster */}
        <mesh ref={s1} position={[0, -1.55, 0]}>
          <cylinderGeometry args={[0.5, 0.56, 3.1, 14]} />
          <meshStandardMaterial color="#c8ccd2" roughness={0.42} metalness={0.72} />
        </mesh>
        {/* stage 2 */}
        <mesh ref={s2} position={[0, 0.62, 0]}>
          <cylinderGeometry args={[0.46, 0.5, 1.5, 14]} />
          <meshStandardMaterial color="#aeb6bf" roughness={0.4} metalness={0.65} />
        </mesh>
        {/* stage 3 / transfer stage */}
        <mesh position={[0, 1.7, 0]}>
          <cylinderGeometry args={[0.42, 0.46, 0.9, 14]} />
          <meshStandardMaterial color="#8f98a3" roughness={0.45} metalness={0.6} />
        </mesh>
        {/* payload + nose */}
        <mesh position={[0, 2.45, 0]}>
          <cylinderGeometry args={[0.4, 0.42, 0.6, 14]} />
          <meshStandardMaterial color="#e8e4d8" roughness={0.5} metalness={0.25} />
        </mesh>
        <mesh position={[0, 3.0, 0]}>
          <coneGeometry args={[0.4, 0.72, 14]} />
          <meshStandardMaterial color="#e8e4d8" roughness={0.5} metalness={0.25} />
        </mesh>
        {/* solar panels */}
        {[-1, 1].map((sgn) => (
          <mesh key={sgn} position={[sgn * 1.15, 1.7, 0]} rotation={[0, 0, sgn * 0.06]}>
            <boxGeometry args={[1.4, 0.05, 0.55]} />
            <meshStandardMaterial color="#1d3a6e" roughness={0.3} metalness={0.7} emissive="#122750" emissiveIntensity={0.5} />
          </mesh>
        ))}
        {/* engine glow */}
        <sprite ref={glow} position={[0, -3.3, 0]} scale={[2.6, 3.4, 1]} raycast={() => null}>
          <spriteMaterial map={glowTex} blending={THREE.AdditiveBlending} depthWrite={false} transparent />
        </sprite>
      </group>
      <points ref={pts} geometry={ex.geo} material={ex.mat} frustumCulled={false} />
      <group ref={debrisGroup}>{debrisMeshes.map((m, i) => <primitive key={i} object={m} />)}</group>
    </group>
  );
}
const phaseAllowsExhaust = (p: string) => p !== "PLANNING";

/* ---------------- vectors (observatory) ---------------- */
function PhysicsVectors() {
  const show = useSim((s) => s.showVectors);
  const mode = useSim((s) => s.scaleMode);
  const grp = useRef<THREE.Group>(null);
  const arrows = useRef<THREE.ArrowHelper[]>([]);

  useEffect(() => {
    const g = grp.current;
    if (!g) return;
    const defs = [
      { color: 0x59b7ff }, // velocity
      { color: 0xffb454 }, // net accel
      { color: 0xffffff }, // sun gravity
      { color: 0x7fb0ff }, // earth gravity
      { color: 0xff7a5c }, // mars gravity
    ];
    const arr = defs.map((d) => {
      const a = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 5, d.color, 0.9, 0.45);
      g.add(a);
      return a;
    });
    arrows.current = arr;
    return () => { arr.forEach((a) => { a.removeFromParent(); a.line.geometry.dispose(); a.cone.geometry.dispose(); }); };
  }, []);

  useFrame(() => {
    const vis = show && engine.phase !== "PLANNING";
    if (grp.current) grp.current.visible = vis;
    if (!vis) return;
    const info = craftRenderInfo(engine.craft.pos, mode);
    const c = engine.craft;
    const tAbs = engine.absTime();
    const earth = engine.planetState("earth", tAbs);
    const mars = engine.planetState("mars", tAbs);
    const dirScale = (v: Vec3, k: number) => {
      const l = vLen(v);
      return l > 1e-9 ? new THREE.Vector3(v.x / l, v.y / l, v.z / l).multiplyScalar(k) : new THREE.Vector3(0, 1, 0);
    };
    const set = (a: THREE.ArrowHelper | undefined, v: Vec3, len: number) => {
      if (!a) return;
      a.position.copy(info.p);
      a.setDirection(dirScale(v, 1).normalize());
      a.setLength(Math.max(len, 0.1), 0.5, 0.28);
    };
    const g = engine.accelForDisplay();
    set(arrows.current[0], c.vel, 4 + Math.min(10, vLen(c.vel) / 3000));
    set(arrows.current[1], g.net, 4 + Math.min(8, Math.log10(Math.max(vLen(g.net), 1e-8) + 1) * 3));
    set(arrows.current[2], g.sun, 5);
    set(arrows.current[3], vSub(earth.pos, c.pos), vLen(vSub(earth.pos, c.pos)) < 6e10 ? 5 : 2.5);
    set(arrows.current[4], vSub(mars.pos, c.pos), vLen(vSub(mars.pos, c.pos)) < 6e10 ? 5 : 2.5);
  });

  return <group ref={grp} />;
}

/* ---------------- observatory grid ---------------- */
function ObservatoryGrid() {
  const show = useSim((s) => s.observatory);
  const mode = useSim((s) => s.scaleMode);
  const geo = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    [0.5, 1, 1.5, 2, 3, 5.2, 9.6, 19.2, 30].forEach((au) => {
      const r = scaleRadius(au * AU, mode);
      for (let i = 0; i <= 128; i++) {
        const a = (i / 128) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * r, 0, -Math.sin(a) * r));
        if (i < 128) {
          const a2 = ((i + 1) / 128) * Math.PI * 2;
          pts.push(new THREE.Vector3(Math.cos(a2) * r, 0, -Math.sin(a2) * r));
        }
      }
    });
    const outer = scaleRadius(31 * AU, mode);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      pts.push(new THREE.Vector3(0, 0, 0));
      pts.push(new THREE.Vector3(Math.cos(a) * outer, 0, -Math.sin(a) * outer));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [mode]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <lineSegments geometry={geo} visible={show}>
      <lineBasicMaterial color="#3d5a80" transparent opacity={0.16} />
    </lineSegments>
  );
}

/* ---------------- camera rig ---------------- */
function CameraRig() {
  const focus = useSim((s) => s.focus);
  const mode = useSim((s) => s.scaleMode);
  const introDone = useSim((s) => s.introDone);
  const controls = useRef<any>(null);
  const cinemaT = useRef(0);

  useFrame((state, dt) => {
    const ctrl = controls.current;
    if (!ctrl) return;
    const tAbs = engine.absTime();
    let target = new THREE.Vector3(0, 0, 0);
    let desiredDist = -1;
    const pdef = PLANETS.find((p) => p.id === focus);
    if (pdef) {
      target = helioToRender(engine.planetState(pdef.id, tAbs).pos, mode);
      desiredDist = pdef.id === "earth" || pdef.id === "mars" ? 24 : Math.max(pdef.renderR * 9, 14);
    } else if (focus === "sun") { desiredDist = mode === "presentation" ? 200 : 90; }
    else if (focus === "craft") { target = craftRenderInfo(engine.craft.pos, mode).p; desiredDist = engine.craft.pos && isCraftLocal() ? 10 : 46; }
    else if (focus === "top") {
      const cam = state.camera;
      cam.position.x = THREE.MathUtils.damp(cam.position.x, 0, 2.5, dt);
      cam.position.z = THREE.MathUtils.damp(cam.position.z, 0.01, 2.5, dt);
      cam.position.y = THREE.MathUtils.damp(cam.position.y, mode === "presentation" ? 520 : 2400, 2.5, dt);
      ctrl.target.set(THREE.MathUtils.damp(ctrl.target.x, 0, 3, dt), 0, THREE.MathUtils.damp(ctrl.target.z, 0, 3, dt));
      ctrl.update();
      return;
    } else if (focus === "cinematic") {
      cinemaT.current += dt * 0.06;
      const local = isCraftLocal();
      const center = local || engine.phase === "ASCENT" || engine.phase === "COUNTDOWN"
        ? helioToRender(engine.planetState("earth", tAbs).pos, mode)
        : craftRenderInfo(engine.craft.pos, mode).p;
      const rr = engine.phase === "TRANSFER" ? 90 : local ? 14 : 60;
      const goal = new THREE.Vector3(
        center.x + Math.cos(cinemaT.current) * rr,
        center.y + rr * 0.32 + Math.sin(cinemaT.current * 0.6) * rr * 0.1,
        center.z + Math.sin(cinemaT.current) * rr,
      );
      state.camera.position.x = THREE.MathUtils.damp(state.camera.position.x, goal.x, 1.2, dt);
      state.camera.position.y = THREE.MathUtils.damp(state.camera.position.y, goal.y, 1.2, dt);
      state.camera.position.z = THREE.MathUtils.damp(state.camera.position.z, goal.z, 1.2, dt);
      ctrl.target.x = THREE.MathUtils.damp(ctrl.target.x, center.x, 2, dt);
      ctrl.target.y = THREE.MathUtils.damp(ctrl.target.y, center.y, 2, dt);
      ctrl.target.z = THREE.MathUtils.damp(ctrl.target.z, center.z, 2, dt);
      ctrl.update();
      return;
    } else {
      desiredDist = mode === "presentation" ? 300 : 1400;
    }

    ctrl.target.x = THREE.MathUtils.damp(ctrl.target.x, target.x, 3, dt);
    ctrl.target.y = THREE.MathUtils.damp(ctrl.target.y, target.y, 3, dt);
    ctrl.target.z = THREE.MathUtils.damp(ctrl.target.z, target.z, 3, dt);

    if (desiredDist > 0 && introDone) {
      const cam = state.camera;
      const off = new THREE.Vector3().subVectors(cam.position, ctrl.target);
      const d = off.length() || 1;
      const nd = THREE.MathUtils.damp(d, desiredDist, 1.4, dt);
      off.multiplyScalar(nd / d);
      const goal = new THREE.Vector3().addVectors(ctrl.target, off);
      cam.position.x = THREE.MathUtils.damp(cam.position.x, goal.x, 3, dt);
      cam.position.y = THREE.MathUtils.damp(cam.position.y, Math.max(goal.y, desiredDist * 0.12), 3, dt);
      cam.position.z = THREE.MathUtils.damp(cam.position.z, goal.z, 3, dt);
    }
    ctrl.update();
  });

  return (
    <OrbitControls
      ref={controls}
      enableDamping
      dampingFactor={0.08}
      minDistance={2.5}
      maxDistance={mode === "presentation" ? 2600 : 9000}
      zoomSpeed={0.9}
      rotateSpeed={0.75}
    />
  );
}
function isCraftLocal(): boolean {
  const tAbs = engine.absTime();
  for (const [id, def] of [["earth", EARTH], ["mars", MARS]] as const) {
    const st = engine.planetState(id, tAbs);
    if (vLen(vSub(engine.craft.pos, st.pos)) < def.radius * 16) return true;
  }
  return false;
}

/* ---------------- scene root ---------------- */
export function SolarSystem() {
  return (
    <group>
      <ambientLight color="#16233c" intensity={0.5} />
      <Starfield />
      <Sun />
      {PLANETS.map((p) => <Planet key={p.id} def={p} />)}
      <Moon />
      <Trails />
      <Spacecraft />
      <PhysicsVectors />
      <ObservatoryGrid />
      <CameraRig />
    </group>
  );
}
