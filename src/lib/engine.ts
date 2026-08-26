/* ============================================================
   MISSION ENGINE — numerical simulation core.
   Restricted N-body gravity (Sun + planets + Moon), finite
   thrust rocket burns, Tsiolkovsky mass flow, phase state
   machine, landing sim, scoring, what-if shadow runs.
   Nothing here is predetermined — outcomes emerge from the
   integration.
   ============================================================ */
import {
  AU, DAY, EARTH, G0, MARS, MOON, MU_SUN, PLANETS, Vec3,
  clamp, fmtDuration, v3, vAdd, vCross, vDot, vLen, vNorm, vScale, vSub,
} from "./constants";
import {
  OrbitParams, circularVelocity, courseCorrection, escapeVelocity, hohmann,
  injectionBurn, launchWindow, mechanicalEnergy, orbitFromState, rocketDv,
} from "./orbital";

export type Phase =
  | "PLANNING" | "COUNTDOWN" | "ASCENT" | "EARTH_ORBIT" | "EARTH_ESCAPE"
  | "TRANSFER" | "MARS_APPROACH" | "MARS_ORBIT" | "LANDED"
  | "FAILED" | "FREEFLIGHT";

export interface StageCfg { name: string; dryMass: number; fuelMass: number; thrust: number; isp: number }
export interface WhatIfFlags { earthMass: number; marsMass: number; sunMass: number; craftMass: number; fuel: number; vel: number }
export type Emergency = "none" | "fuel-leak" | "engine-failure" | "wrong-course" | "low-fuel";

export interface MissionConfig {
  launchDay: number;            // days from epoch
  payload: number;              // kg
  stages: [StageCfg, StageCfg, StageCfg];
  azimuth: number;              // deg, 90 = east / prograde
  pitch: number;                // deg from vertical
  targetMarsOrbitKm: number;    // target circular orbit altitude
  difficulty: "STUDENT" | "ENGINEER" | "MISSION CONTROL";
  emergency: Emergency;
  whatIf: WhatIfFlags;
  landingMode: "ORBIT_ONLY" | "LANDING";
}

export interface HistorySample {
  t: number; v: number; alt: number; fuel: number; dE: number; dM: number;
  acc: number; energy: number; dv: number;
}
export interface GameEvent { type: string; text: string; level: "info" | "warn" | "alert" | "success" }
export interface MissionResult {
  outcome: "SUCCESS" | "FAILED" | "PARTIAL";
  title: string; reason: string;
  travelTime: number; fuelUsedPct: number; fuelRemainingKg: number;
  corrections: number; score: number; grade: "S" | "A" | "B" | "C" | "FAILED";
  breakdown: { label: string; value: number }[];
  finalOrbit: string;
}
export interface Recommendation {
  type: "TMI" | "MCC" | "MOI" | "CIRC" | "LANDING" | "NONE";
  label: string; detail: string; dv: number; dir: Vec3 | null;
}

export const DEFAULT_STAGES: [StageCfg, StageCfg, StageCfg] = [
  { name: "STAGE 1 · BOOSTER", dryMass: 26000, fuelMass: 180000, thrust: 3100000, isp: 290 },
  { name: "STAGE 2 · ORBITAL", dryMass: 5000, fuelMass: 46000, thrust: 620000, isp: 355 },
  { name: "STAGE 3 · NUCLEAR TRANSFER", dryMass: 4000, fuelMass: 26000, thrust: 150000, isp: 900 },
];

export const defaultConfig = (): MissionConfig => ({
  launchDay: 35, payload: 4000, stages: JSON.parse(JSON.stringify(DEFAULT_STAGES)),
  azimuth: 90, pitch: 82, targetMarsOrbitKm: 4000, difficulty: "STUDENT",
  emergency: "none", whatIf: { earthMass: 1, marsMass: 1, sunMass: 1, craftMass: 1, fuel: 1, vel: 1 },
  landingMode: "ORBIT_ONLY",
});

interface BodyState { pos: Vec3; vel: Vec3 }

const EARTH_SOI = 9.24e8;
const MARS_SOI = 5.77e8;

export class MissionEngine {
  cfg: MissionConfig = defaultConfig();
  mode: "mission" | "orbitlab" | "sandbox" = "mission";
  phase: Phase = "PLANNING";
  t = 0;                 // sim seconds since T-0
  countdown = 10;
  paused = false;

  craft = { pos: v3(), vel: v3(), mass: 0, attitude: v3(0, 1, 0), throttle: 0, burning: false, burnMode: "attitude" as string, burnVec: v3() };
  stages: StageCfg[] = [];
  stageFuel: number[] = [];
  activeStage = 0;
  separated: boolean[] = [];
  debris: { pos: Vec3; vel: Vec3; spin: number }[] = [];

  history: HistorySample[] = [];
  trail: Vec3[] = [];
  rec: { t: number; p: Vec3 }[] = [];
  private replayBackup: { pos: Vec3; vel: Vec3 } | null = null;
  prediction: { points: Vec3[]; marsT: number; marsDist: number } | null = null;
  ghostTrail: Vec3[] = [];
  ghost: BodyState | null = null;

  events: GameEvent[] = [];
  corrections = 0;
  burnsUsed = 0;
  maxHeat = 0;
  minMarsDist = Infinity;
  result: MissionResult | null = null;
  achievements = new Set<string>();

  landing: {
    alt: number; vel: number; mass: number; fuel: number; chute: boolean;
    throttle: number; heat: number; phase: "ENTRY" | "CHUTE" | "DESCENT" | "TOUCHDOWN" | "CRASH"; angle: number;
  } | null = null;

  private lastSample = -1e9;
  private lastTrail = v3();
  private lastPred = 0;
  private failReason = "";
  private whatIfOn = false;
  pendingGhost = false;

  /* ---------------- planet ephemeris (circular, ecliptic) ---------------- */
  muOf(id: string): number {
    const p = PLANETS.find((b) => b.id === id);
    if (!p) return 0;
    let m = 1;
    if (id === "earth") m = this.cfg.whatIf.earthMass;
    if (id === "mars") m = this.cfg.whatIf.marsMass;
    return p.mu * m;
  }
  planetState(id: string, t: number): BodyState {
    const p = PLANETS.find((b) => b.id === id)!;
    const th = p.phase0 + (2 * Math.PI * t) / (p.periodDays * DAY);
    const r = p.a * AU;
    const x = Math.cos(th) * r, z = -Math.sin(th) * r;
    const y = Math.sin(th) * Math.sin(p.incl) * r * 0.15;
    const v = (2 * Math.PI * r) / (p.periodDays * DAY);
    return {
      pos: v3(x, y, z),
      vel: v3(-Math.sin(th) * v, Math.cos(th) * Math.sin(p.incl) * v * 0.15, -Math.cos(th) * v),
    };
  }
  angleOf(id: string, t: number): number {
    const p = PLANETS.find((b) => b.id === id)!;
    return p.phase0 + (2 * Math.PI * (this.cfg.launchDay * DAY + t)) / (p.periodDays * DAY);
  }

  /* ---------------- configuration ---------------- */
  configure(cfg: MissionConfig, mode: "mission" | "orbitlab" | "sandbox") {
    this.cfg = JSON.parse(JSON.stringify(cfg));
    this.mode = mode;
    this.phase = "PLANNING";
    this.t = 0; this.countdown = 10;
    this.result = null; this.corrections = 0; this.burnsUsed = 0;
    this.history = []; this.trail = []; this.rec = []; this.ghostTrail = []; this.ghost = null;
    this.replayBackup = null;
    this.pendingGhost = false;
    this.stopWhatIf();
    this.debris = []; this.landing = null; this.prediction = null;
    this.failReason = ""; this.minMarsDist = Infinity; this.maxHeat = 0;
    this.lastSample = -1e9; this.paused = false;

    const fm = this.cfg.whatIf.fuel * (this.cfg.emergency === "low-fuel" ? 0.6 : 1);
    this.stages = this.cfg.stages.map((s) => ({ ...s, fuelMass: s.fuelMass * fm }));
    this.stageFuel = this.stages.map((s) => s.fuelMass);
    this.separated = this.stages.map(() => false);
    this.activeStage = 0;

    const earth = this.planetState("earth", 0);
    const cm = this.cfg.whatIf.craftMass;
    if (mode === "orbitlab") {
      const r = EARTH.radius + 300e3;
      const up = vNorm(v3(0.35, 0, 0.94));
      this.craft.pos = vAdd(earth.pos, vScale(up, r));
      this.craft.vel = vAdd(earth.vel, vScale(vNorm(vCross(up, v3(0, 1, 0))), circularVelocity(EARTH.mu * cfg.whatIf.earthMass, r)));
      this.craft.mass = (cfg.payload + this.stages[2].dryMass + this.stageFuel[2]) * cm;
      this.separated = [true, true, false];
      this.activeStage = 2;
      this.phase = "EARTH_ORBIT";
    } else if (mode === "sandbox") {
      const r = EARTH.radius + 500e3;
      const up = vNorm(v3(0.35, 0, 0.94));
      this.craft.pos = vAdd(earth.pos, vScale(up, r));
      this.craft.vel = vAdd(earth.vel, vScale(vNorm(vCross(up, v3(0, 1, 0))), circularVelocity(EARTH.mu * cfg.whatIf.earthMass, r) * 1.0));
      this.craft.mass = (cfg.payload + this.stages[2].dryMass + this.stageFuel[2]) * cm;
      this.separated = [true, true, false];
      this.activeStage = 2;
      this.phase = "FREEFLIGHT";
    } else {
      const up = vNorm(v3(0.35, 0.02, 0.94));
      this.craft.pos = vAdd(earth.pos, vScale(up, EARTH.radius + 5));
      this.craft.vel = { ...earth.vel };
      this.craft.mass = (cfg.payload + this.stages.reduce((s, x) => s + x.dryMass + x.fuelMass, 0)) * cm;
      this.craft.throttle = 0; this.craft.burning = false;
    }
    this.craft.attitude = v3(0, 1, 0);
    this.lastTrail = { ...this.craft.pos };
  }

  totalMass(): number {
    let m = this.cfg.payload * this.cfg.whatIf.craftMass;
    this.stages.forEach((s, i) => { if (!this.separated[i]) m += s.dryMass + this.stageFuel[i]; });
    return m;
  }
  dvRemaining(): number {
    let dv = 0;
    let mBelow = this.cfg.payload * this.cfg.whatIf.craftMass;
    for (let i = this.stages.length - 1; i >= 0; i--) {
      if (this.separated[i]) continue;
      const mf = mBelow + this.stages[i].dryMass;
      dv += rocketDv(this.stages[i].isp, mf + this.stageFuel[i], mf);
      mBelow = mf + this.stageFuel[i];
    }
    return dv;
  }

  /* ---------------- launch frame ---------------- */
  private enu(): { up: Vec3; east: Vec3; north: Vec3 } {
    const earth = this.planetState("earth", this.tSim());
    const rel = vSub(this.craft.pos, earth.pos);
    const up = vLen(rel) > 1000 ? vNorm(rel) : v3(0.35, 0.02, 0.94);
    const east = vNorm(vCross(v3(0, 1, 0), up));
    const north = vNorm(vCross(up, east));
    return { up, east, north };
  }
  private tSim(): number { return this.cfg.launchDay * DAY + this.t; }
  absTime(): number { return this.tSim(); }

  launchDirection(): Vec3 {
    const { up, east, north } = this.enu();
    const az = (this.cfg.azimuth * Math.PI) / 180; // compass convention: 0=N, 90=E
    const pit = (this.cfg.pitch * Math.PI) / 180;
    const horiz = vAdd(vScale(east, Math.sin(az)), vScale(north, Math.cos(az)));
    return vNorm(vAdd(vScale(up, Math.cos(pit)), vScale(horiz, Math.sin(pit))));
  }

  startCountdown() {
    if (this.phase !== "PLANNING") return;
    this.phase = "COUNTDOWN";
    this.countdown = 10;
    this.emit("info", "COUNTDOWN INITIATED — ALL STATIONS GO");
  }

  /* ---------------- burns ---------------- */
  startBurn(mode: string, dir: Vec3 | null = null, throttle = 1) {
    const st = this.stages[this.activeStage];
    if (!st || this.separated[this.activeStage] || this.stageFuel[this.activeStage] <= 0) {
      this.emit("warn", "NO PROPELLANT IN ACTIVE STAGE");
      return;
    }
    let emerg = 1;
    if (this.cfg.emergency === "engine-failure" && this.activeStage === 2) emerg = 0.5;
    this.craft.burning = true;
    this.craft.burnMode = mode;
    this.craft.burnVec = dir ? vNorm(dir) : v3(0, 1, 0);
    this.craft.throttle = clamp(throttle, 0, 1) * emerg;
    this.burnsUsed++;
  }
  stopBurn() { this.craft.burning = false; this.craft.throttle = 0; }
  setThrottle(x: number) { this.craft.throttle = clamp(x, 0, 1); }

  separateStage() {
    const i = this.activeStage;
    if (i >= this.stages.length - 1 || this.separated[i]) return;
    this.separated[i] = true;
    this.debris.push({ pos: { ...this.craft.pos }, vel: vAdd(this.craft.vel, vScale(this.craft.attitude, -12)), spin: Math.random() * 3 });
    if (this.debris.length > 6) this.debris.shift();
    this.activeStage = i + 1;
    this.craft.mass = this.totalMass();
    this.emit("info", `STAGE SEPARATION — ${this.stages[i].name} AWAY`);
    this.unlock("SEPARATION");
  }

  /* fixed-Δv impulse burn (orbit lab / sandbox probes) */
  impulse(dir: Vec3, dv: number) {
    this.startBurn("vec", dir, 1);
    this.targetDv = dv;
    this.burnDvAccum = 0;
  }

  /* ---------------- guidance / recommendations ---------------- */
  recommendation(): Recommendation {
    const earth = this.planetState("earth", this.tSim());
    const mars = this.planetState("mars", this.tSim());
    const relE = vSub(this.craft.pos, earth.pos);
    const velE = vSub(this.craft.vel, earth.vel);
    if (this.phase === "EARTH_ORBIT") {
      const r = vLen(relE);
      const h = hohmann(MU_SUN * this.cfg.whatIf.sunMass, earth.pos && 1.0 * AU, 1.5237 * AU);
      const inj = injectionBurn(this.muOf("earth"), r, h.dv1);
      return {
        type: "TMI", label: "TRANSMARS INJECTION",
        detail: `Prograde burn · raise heliocentric apoapsis to Mars orbit`,
        dv: inj.dv, dir: vNorm(earth.vel),
      };
    }
    if (this.phase === "TRANSFER") {
      const orb = orbitFromState(MU_SUN * this.cfg.whatIf.sunMass, this.craft.pos, this.craft.vel);
      let tof = orb.period > 0 && isFinite(orb.period) ? Math.max(orb.period * 0.35, 60 * DAY) : 200 * DAY;
      if (this.prediction && this.prediction.marsT - this.tSim() > 2 * DAY) {
        tof = clamp(this.prediction.marsT - this.tSim(), 2 * DAY, 700 * DAY);
      }
      const cc = courseCorrection(this.craft.pos, this.craft.vel, (tt) => this.planetState("mars", tt).pos, this.tSim(), tof);
      if (cc && vLen(cc.dv) > 3) {
        return {
          type: "MCC", label: "COURSE CORRECTION",
          detail: `Predicted miss ${Math.round(cc.missKm).toLocaleString()} km — patch trajectory`,
          dv: vLen(cc.dv), dir: vNorm(cc.dv),
        };
      }
      return { type: "NONE", label: "CRUISE", detail: "On transfer trajectory — monitor miss distance", dv: 0, dir: null };
    }
    if (this.phase === "MARS_APPROACH") {
      const relM = vSub(this.craft.pos, mars.pos);
      const velM = vSub(this.craft.vel, mars.vel);
      const r = vLen(relM), v = vLen(velM);
      const muM = this.muOf("mars");
      const rTarget = MARS.radius + this.cfg.targetMarsOrbitKm * 1000;
      // capture burn is queued for periapsis — size it for a low periapsis pass
      const peri = MARS.radius + 300e3;
      const vPeri = Math.sqrt(v * v + 2 * muM * (1 / peri - 1 / Math.max(r, 1)));
      const aT = (peri + rTarget) / 2;
      const vCap = Math.sqrt(Math.max(0.1, 2 * muM / peri - muM / aT));
      const dv = Math.max(0, vPeri - vCap);
      return {
        type: "MOI", label: "MARS ORBIT INSERTION",
        detail: `Retrograde burn · capture into ${Math.round(this.cfg.targetMarsOrbitKm)} km orbit`,
        dv, dir: vScale(vNorm(velM), -1),
      };
    }
    if (this.phase === "MARS_ORBIT") {
      return { type: "LANDING", label: "MARS LANDING", detail: "Deorbit and begin entry sequence", dv: 0, dir: null };
    }
    void relE; void velE;
    return { type: "NONE", label: "—", detail: "", dv: 0, dir: null };
  }

  executeRecommended() {
    const rec = this.recommendation();
    if (rec.type === "NONE") return;
    if (rec.type === "LANDING") { this.startLanding(); return; }
    if (rec.type === "MOI") { this.queueMOI(rec.dv); return; }
    if (!rec.dir) return;
    if (this.mode === "orbitlab") { this.impulse(rec.dir, Math.min(rec.dv, 400)); return; }
    if (rec.type === "MCC") this.corrections++;
    this.startBurn("vec", rec.dir, 1);
    this.emit("info", `${rec.label} BURN — ${Math.round(rec.dv)} m/s COMMANDED`);
    // finite burn auto-cut when Δv delivered (integrated in step())
    this.targetDv = rec.dv;
    this.burnDvAccum = 0;
  }
  private targetDv = 0;
  private burnDvAccum = 0;
  private pendingMOI: number | null = null;
  private prevDM = Infinity;
  private entryWarned = false;

  /* queue the capture burn — it fires automatically at periapsis, where
     the Oberth effect makes every m/s count (this is real mission practice) */
  queueMOI(dv: number) {
    this.pendingMOI = dv;
    this.prevDM = Infinity;
    this.emit("info", "MOI QUEUED — RETROGRADE BURN WILL FIRE AT PERIAPSIS");
  }

  /* ---------------- landing ---------------- */
  entryAngle = 12;
  setEntryAngle(a: number) { this.entryAngle = clamp(a, 2, 30); }
  startLanding() {
    if (this.phase !== "MARS_ORBIT") return;
    const mars = this.planetState("mars", this.tSim());
    const relM = vSub(this.craft.pos, mars.pos);
    const velM = vSub(this.craft.vel, mars.vel);
    this.landing = {
      alt: 80e3,
      vel: clamp(vLen(velM) * 1.06, 2600, 5600),
      mass: this.totalMass(),
      fuel: this.stageFuel[2] ?? 0,
      chute: false, throttle: 0, heat: 0, phase: "ENTRY", angle: this.entryAngle,
    };
    this.entryWarned = false;
    this.emit("info", `DEORBIT COMPLETE — ENTRY INTERFACE 80 km · ANGLE ${this.entryAngle.toFixed(0)}°`);
  }
  deployChute() {
    const L = this.landing;
    if (!L || L.chute) return;
    if (L.vel > 460) { this.failMission("CHUTE SHREDDED — DEPLOYED ABOVE 460 m/s"); return; }
    if (L.alt > 14e3) { this.emit("warn", "TOO HIGH — CHUTE INEFFECTIVE UP HERE"); return; }
    L.chute = true;
    this.emit("success", "PARACHUTE DEPLOYED");
  }
  setLandingThrottle(x: number) { if (this.landing) this.landing.throttle = clamp(x, 0, 1); }

  private stepLanding(dt: number) {
    const L = this.landing;
    if (!L || L.phase === "TOUCHDOWN" || L.phase === "CRASH") return;
    const g = 3.71;
    const rho = 0.02 * Math.exp(-L.alt / 9400);
    const v = L.vel;
    let acc = g;
    const CdA = L.chute ? 260 : 9;
    acc -= (0.5 * rho * v * v * CdA) / L.mass;
    L.heat = clamp(((rho * v * v * v) / 1.4e6) * clamp(L.angle / 12, 0.55, 2.4), 0, 1.8);
    if (L.heat > 1.4) { this.failMission("THERMAL LIMIT EXCEEDED — ENTRY TOO STEEP, SPACECRAFT BURNED UP"); return; }
    if (L.angle < 6 && L.alt < 55e3 && v > 2400) { this.failMission("ATMOSPHERIC SKIP-OUT — ENTRY ANGLE TOO SHALLOW, BOUNCED OFF THE AIR"); return; }
    this.maxHeat = Math.max(this.maxHeat, L.heat);
    if (L.throttle > 0 && L.fuel > 0) {
      const T = 112000 * L.throttle * (this.cfg.emergency === "engine-failure" ? 0.5 : 1);
      acc -= T / L.mass;
      L.fuel -= (T / (310 * G0)) * dt;
      if (L.fuel < 0) L.fuel = 0;
    }
    L.vel += acc * dt;
    L.alt -= L.vel * dt;
    // pin the 3-D craft to the descending corridor so the camera can follow
    const marsP = this.planetState("mars", this.tSim());
    const relN = vNorm(vSub(this.craft.pos, marsP.pos));
    this.craft.pos = vAdd(marsP.pos, vScale(relN, MARS.radius + Math.max(L.alt, 0)));
    this.craft.vel = { ...marsP.vel };
    if (L.vel > 900 && L.phase === "ENTRY" && !this.entryWarned) {
      this.entryWarned = true;
      this.emit("warn", "ENTRY VELOCITY HIGH — HEAT RISING");
    }
    if (L.phase === "ENTRY" && L.alt < 12e3 && L.vel < 460 && !L.chute) L.phase = "CHUTE";
    if (L.chute && L.alt < 1500) { L.chute = false; this.emit("info", "CHUTE JETTISON — POWERED DESCENT"); L.phase = "DESCENT"; }
    if (L.alt <= 0) {
      L.alt = 0;
      if (L.vel < 6 && L.fuel > 0) {
        L.phase = "TOUCHDOWN";
        this.phase = "LANDED";
        this.emit("success", "TOUCHDOWN CONFIRMED — WELCOME TO MARS");
        this.unlock("LANDER");
        this.finishMission(true, "MARS LANDING SUCCESS");
      } else if (L.vel < 6) {
        L.phase = "TOUCHDOWN";
        this.phase = "LANDED";
        this.emit("success", "TOUCHDOWN — HARD BUT INTACT (0.4 m/s OVER LIMIT)");
        this.finishMission(true, "MARS LANDING SUCCESS");
      } else {
        L.phase = "CRASH";
        this.failMission(`IMPACT AT ${Math.round(L.vel)} m/s — LANDING FAILED`);
      }
    }
  }

  /* ---------------- main integration ---------------- */
  private gravity(pos: Vec3, ghost = false): Vec3 {
    const tAbs = this.tSim();
    let ax = 0, ay = 0, az = 0;
    // ghost integrates the BASELINE universe (what-if factors removed)
    const wf = ghost ? { sunMass: 1, earthMass: 1, marsMass: 1 } : this.cfg.whatIf;
    const muS = MU_SUN * wf.sunMass;
    const r2 = pos.x * pos.x + pos.y * pos.y + pos.z * pos.z;
    const r = Math.sqrt(r2);
    const f = -muS / (r2 * r);
    ax += pos.x * f; ay += pos.y * f; az += pos.z * f;
    for (const p of PLANETS) {
      let mu = p.mu;
      if (p.id === "earth") mu *= wf.earthMass;
      if (p.id === "mars") mu *= wf.marsMass;
      const th = p.phase0 + (2 * Math.PI * tAbs) / (p.periodDays * DAY);
      const R = p.a * AU;
      const px = Math.cos(th) * R, pz = -Math.sin(th) * R;
      const py = Math.sin(th) * Math.sin(p.incl) * R * 0.15;
      const dx = px - pos.x, dy = py - pos.y, dz = pz - pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const d = Math.sqrt(d2);
      const fp = mu / (d2 * d);
      ax += dx * fp; ay += dy * fp; az += dz * fp;
    }
    if (!ghost) {
      const e = this.planetState("earth", tAbs);
      const mth = (2 * Math.PI * tAbs) / MOON.period;
      const mx = e.pos.x + Math.cos(mth) * MOON.a, mz = e.pos.z - Math.sin(mth) * MOON.a;
      const dx = mx - pos.x, dy = e.pos.y - pos.y, dz = mz - pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const d = Math.sqrt(d2);
      const fp = MOON.mu / (d2 * d);
      ax += dx * fp; ay += dy * fp; az += dz * fp;
    }
    return v3(ax, ay, az);
  }

  accelForDisplay(): { net: Vec3; sun: Vec3; earth: Vec3; mars: Vec3 } {
    const pos = this.craft.pos;
    const muS = MU_SUN * this.cfg.whatIf.sunMass;
    const r2 = vDot(pos, pos);
    const r = Math.sqrt(r2);
    const fs = -muS / (r2 * r);
    const sun = v3(pos.x * fs, pos.y * fs, pos.z * fs);
    const pull = (b: BodyState, mu: number): Vec3 => {
      const d = vSub(b.pos, pos);
      const l = vLen(d);
      const f = mu / (l * l * l);
      return v3(d.x * f, d.y * f, d.z * f);
    };
    const e = this.planetState("earth", this.tSim());
    const m = this.planetState("mars", this.tSim());
    return { net: this.gravity(pos), sun, earth: pull(e, this.muOf("earth")), mars: pull(m, this.muOf("mars")) };
  }

  private accel(pos: Vec3, thrustDir: Vec3 | null, mass: number): Vec3 {
    const g = this.gravity(pos);
    if (!thrustDir) return g;
    const st = this.stages[this.activeStage];
    const T = st.thrust * this.craft.throttle;
    return vAdd(g, vScale(thrustDir, T / mass));
  }

  private rk4Step(dt: number, ghost = false) {
    if (ghost && this.ghost) {
      const g = this.ghost;
      const a1 = this.gravity(g.pos, true);
      const p2 = vAdd(g.pos, vScale(g.vel, dt / 2));
      const a2 = this.gravity(p2, true);
      const p3 = vAdd(g.pos, vScale(vAdd(g.vel, vScale(a1, dt / 2)), dt / 2));
      const a3 = this.gravity(p3, true);
      const p4 = vAdd(g.pos, vScale(vAdd(g.vel, vScale(a2, dt / 2)), dt));
      const a4 = this.gravity(p4, true);
      g.pos = vAdd(g.pos, vScale(vAdd(vAdd(g.vel, vScale(a1, dt / 2)), vAdd(vScale(a2, dt / 2), vAdd(vScale(a3, dt / 2), vScale(a4, dt / 6)))), dt));
      g.vel = vAdd(g.vel, vScale(vAdd(vAdd(a1, vScale(a2, 2)), vAdd(vScale(a3, 2), a4)), dt / 6));
      return;
    }
    const c = this.craft;
    const thrusting = c.burning && this.stageFuel[this.activeStage] > 0;
    let dir: Vec3 | null = null;
    if (thrusting) {
      if (c.burnMode === "attitude") dir = c.attitude;
      else if (c.burnMode === "prograde") dir = vNorm(vSub(c.vel, this.planetState("earth", this.tSim()).vel));
      else dir = c.burnVec;
    }
    const m0 = c.mass;
    const a1 = this.accel(c.pos, dir, m0);
    const p2 = vAdd(c.pos, vScale(c.vel, dt / 2));
    const vl2 = vAdd(c.vel, vScale(a1, dt / 2));
    const a2 = this.accel(p2, dir, m0);
    const p3 = vAdd(c.pos, vScale(vl2, dt / 2));
    const a3 = this.accel(p3, dir, m0);
    const p4 = vAdd(c.pos, vScale(vAdd(c.vel, vScale(a2, dt / 2)), dt));
    const a4 = this.accel(p4, dir, m0);
    c.pos = vAdd(c.pos, vScale(vAdd(vAdd(c.vel, vScale(a1, dt / 2)), vAdd(vScale(a2, dt / 2), vAdd(vScale(a3, dt / 2), vScale(a4, dt / 6)))), dt));
    c.vel = vAdd(c.vel, vScale(vAdd(vAdd(a1, vScale(a2, 2)), vAdd(vScale(a3, 2), a4)), dt / 6));

    // mass flow (Tsiolkovsky)
    if (thrusting && dir) {
      const st = this.stages[this.activeStage];
      const mdot = (st.thrust * c.throttle) / (st.isp * G0);
      this.stageFuel[this.activeStage] = Math.max(0, this.stageFuel[this.activeStage] - mdot * dt);
      c.mass = this.totalMass();
      if (this.stageFuel[this.activeStage] <= 0) {
        c.burning = false; c.throttle = 0;
        this.emit("warn", `${st.name} — PROPELLANT DEPLETED`);
        if (this.cfg.emergency === "fuel-leak") this.emit("alert", "FUEL LEAK — REMAINING PROPELLANT VENTING");
      }
      if (this.targetDv > 0) {
        this.burnDvAccum += (st.thrust * c.throttle / c.mass) * dt;
        if (this.burnDvAccum >= this.targetDv) { this.stopBurn(); this.targetDv = 0; this.burnDvAccum = 0; }
      }
    }
  }

  private chooseDt(): number {
    const earth = this.planetState("earth", this.tSim());
    const mars = this.planetState("mars", this.tSim());
    const dE = vLen(vSub(this.craft.pos, earth.pos));
    const dM = vLen(vSub(this.craft.pos, mars.pos));
    const dS = vLen(this.craft.pos);
    const d = Math.min(dE, dM, dS * 0.4);
    const vr = Math.max(vLen(this.craft.vel), 10);
    let dt = clamp(0.02 * (d / vr) * 10, 0.5, 900);
    if (dE < 1.5e8) dt = Math.min(dt, 30);
    if (dE < 3e7) dt = Math.min(dt, 4);
    if (this.craft.burning) dt = Math.min(dt, 2.5);
    return dt;
  }

  update(realDt: number, multiplier: number, paused: boolean) {
    if (this.phase === "PLANNING" || this.phase === "FAILED" || this.phase === "LANDED") return;
    if (this.phase === "COUNTDOWN") {
      if (paused) return;
      this.countdown -= realDt;
      if (this.countdown <= 0) {
        this.phase = "ASCENT";
        this.t = 0;
        this.emit("success", "IGNITION — LIFTOFF");
        this.unlock("LAUNCH");
        this.startBurn("vec", this.launchDirection(), 1);
        this.craft.burnMode = "ascent";
      }
      return;
    }
    if (paused) return;
    let simDt = realDt * multiplier;
    const dt = this.chooseDt();
    let steps = Math.ceil(simDt / dt);
    if (steps > 4000) steps = 4000; // leftover handled by next frame
    for (let i = 0; i < steps; i++) {
      this.stepOnce(Math.min(dt, simDt - i * dt));
      const ph = this.phase as string;
      if (ph === "FAILED" || ph === "LANDED") break;
    }
    // 1-D entry/descent simulation runs alongside the N-body world
    if (this.landing && (this.phase as string) === "MARS_ORBIT") {
      let rem = Math.min(simDt, 40);
      while (rem > 1e-6 && (this.phase as string) === "MARS_ORBIT") {
        const dts = Math.min(0.25, rem);
        this.stepLanding(dts);
        rem -= dts;
      }
    }
    this.t += simDt;
    if (this.whatIfOn) {
      if (!this.ghost) this.ghost = { pos: { ...this.craft.pos }, vel: { ...this.craft.vel } };
      const gdt = dt * 3;
      for (let i = 0; i < Math.ceil(simDt / gdt); i++) this.rk4Step(Math.min(gdt, simDt), true);
      if (vLen(vSub(this.ghost.pos, this.ghostTrail[this.ghostTrail.length - 1] || this.ghost.pos)) > 4e8) {
        this.ghostTrail.push({ ...this.ghost.pos });
        if (this.ghostTrail.length > 4000) this.ghostTrail = this.ghostTrail.filter((_, k) => k % 2 === 0);
      }
    }
    this.sampleHistory();
    this.maybePredict();
  }

  private stepOnce(dt: number) {
    if (dt <= 0) return;
    // fuel leak emergency
    if (this.cfg.emergency === "fuel-leak" && this.stageFuel[this.activeStage] > 0) {
      this.stageFuel[this.activeStage] = Math.max(0, this.stageFuel[this.activeStage] - 2.4 * dt);
    }
    // ascent gravity-turn steering
    if (this.craft.burning && this.craft.burnMode === "ascent") {
      const up = vNorm(vSub(this.craft.pos, this.planetState("earth", this.tSim()).pos));
      const velRel = vSub(this.craft.vel, this.planetState("earth", this.tSim()).vel);
      const prog = vNorm(velRel.x === 0 && velRel.z === 0 ? this.launchDirection() : velRel);
      const turn = clamp((vLen(velRel) - 150) / 6200, 0, 1);
      this.craft.burnVec = vNorm(vAdd(vScale(up, 1 - turn), vScale(prog, turn)));
    }
    this.rk4Step(dt);
    this.checkNaN();
    this.checkEvents();
  }

  private checkNaN() {
    const c = this.craft;
    if (!isFinite(c.pos.x) || !isFinite(c.vel.x) || !isFinite(c.mass)) {
      this.failMission("NUMERICAL DIVERGENCE — SIMULATION SAFETY HALT");
    }
  }

  private checkEvents() {
    const c = this.craft;
    const earth = this.planetState("earth", this.tSim());
    const mars = this.planetState("mars", this.tSim());
    const relE = vSub(c.pos, earth.pos);
    const relM = vSub(c.pos, mars.pos);
    const dE = vLen(relE), dM = vLen(relM), dS = vLen(c.pos);

    // collisions
    if (dE < EARTH.radius + 30e3) { this.failMission("ATMOSPHERIC REENTRY — SPACECRAFT LOST OVER EARTH"); this.unlockCrash(); return; }
    if (dM < MARS.radius + 20e3 && this.phase !== "MARS_ORBIT") { this.failMission("UNCONTROLLED IMPACT ON MARS"); return; }
    for (const p of PLANETS) {
      if (p.id === "earth" || p.id === "mars") continue;
      const st = this.planetState(p.id, this.tSim());
      const dp = vLen(vSub(c.pos, st.pos));
      if (dp < p.radius + 50e3) { this.failMission(`IMPACT — ${p.name}`); return; }
      if (dp < p.radius * 6 && !this.achievements.has("ASSIST")) {
        this.unlock("ASSIST");
        this.emit("info", `GRAVITY ASSIST — ${p.name} FLYBY AT ${Math.max(1, Math.round(dp / p.radius))} PLANET RADII`);
      }
    }
    if (dS < 2e8) { this.failMission("SOLAR PERIAPSIS EXCEEDED — SPACECRAFT VAPORIZED"); return; }
    if (dS > 1.3e13) { this.failMission("LEFT THE SOLAR SYSTEM — INTERSTELLAR TRAJECTORY"); this.unlock("ESCAPE"); return; }

    // stage auto-separation when empty — next stage ignites along the current flight path
    if (this.phase === "ASCENT" && this.stageFuel[this.activeStage] <= 0 && this.activeStage < 2 && !c.burning) {
      const keep = { ...c.burnVec };
      this.separateStage();
      this.startBurn("ascent", keep, 1);
    }
    // assisted circularization: cut the engine the moment circular velocity is reached
    if (this.phase === "ASCENT" && c.burning && this.activeStage === 2 && this.cfg.difficulty === "STUDENT") {
      const vc = circularVelocity(this.muOf("earth"), dE);
      if (vLen(vSub(c.vel, earth.vel)) >= vc * 0.9995) {
        this.stopBurn();
        this.emit("success", "AUTO-MECO — CIRCULAR VELOCITY REACHED, ENGINE CUT");
      }
    }

    const orbE = orbitFromState(this.muOf("earth"), relE, vSub(c.vel, earth.vel));
    const orbS = orbitFromState(MU_SUN * this.cfg.whatIf.sunMass, c.pos, c.vel);

    if (this.phase === "ASCENT" && !c.burning && this.activeStage === 2) {
      if (orbE.type === "ELLIPSE" && orbE.peri > EARTH.radius + 90e3) {
        this.phase = "EARTH_ORBIT";
        this.emit("success", `ORBIT ACHIEVED — PERIAPSIS ${Math.round((orbE.peri - EARTH.radius) / 1000)} km`);
        this.unlock("ORBIT");
        if (this.pendingGhost) { this.pendingGhost = false; this.startWhatIf(); }
      } else if (orbE.type === "ESCAPE") {
        this.phase = "EARTH_ESCAPE";
        this.emit("alert", "EARTH ESCAPE — EXCEEDED ESCAPE VELOCITY WITHOUT TMI PROFILE");
        this.failMission(`EARTH ESCAPE — v ${Math.round(vLen(vSub(c.vel, earth.vel)))} m/s > v_esc ${Math.round(escapeVelocity(this.muOf("earth"), dE))} m/s`);
      } else {
        this.phase = "FAILED";
        this.failMission(`ORBIT FAILED — PERIAPSIS ${Math.round((orbE.peri - EARTH.radius) / 1000)} km INSIDE ATMOSPHERE (v too low)`);
      }
    }

    if (this.phase === "EARTH_ORBIT") {
      if (orbE.type === "ESCAPE" && dE > 1.5e8) {
        this.phase = "TRANSFER";
        if (this.mode === "orbitlab") {
          this.emit("success", "EARTH ESCAPE ACHIEVED — v REL EXCEEDED ESCAPE VELOCITY");
        } else {
          this.emit("info", "EARTH SPHERE OF INFLUENCE EXIT — HELIOCENTRIC TRANSFER");
          this.checkTransferQuality(orbS);
        }
      }
      if (orbE.type === "ELLIPSE" && orbE.peri < EARTH.radius + 85e3) {
        this.failMission("ORBIT DECAY — PERIAPSIS TOO LOW, REENTRY IMMINENT");
      }
    }

    if (this.phase === "TRANSFER") {
      if (dE < EARTH_SOI * 0.9 && this.t > 30 * DAY) {
        // fell back to Earth
      }
      if (dM < MARS_SOI) {
        this.phase = "MARS_APPROACH";
        this.emit("success", "MARS ENCOUNTER — SPHERE OF INFLUENCE ENTRY");
        this.unlock("MARS");
      } else if (dM < this.minMarsDist) {
        this.minMarsDist = dM;
      }
      if (orbS.type === "ESCAPE") {
        this.emit("alert", "SOLAR ESCAPE TRAJECTORY — EXCESS Δv APPLIED");
        this.unlock("SOLAR_ESCAPE");
        this.failMission("SOLAR ESCAPE — TRAJECTORY EXCEEDS SUN ESCAPE VELOCITY");
      }
    }

    if (this.phase === "MARS_APPROACH") {
      if (dM < this.minMarsDist) this.minMarsDist = dM;
      if (this.pendingMOI != null) {
        if (dM < this.prevDM) this.prevDM = dM;
        else if (dM > this.prevDM * 1.002 && dM < MARS_SOI * 1.3) {
          const dvQ = this.pendingMOI;
          this.pendingMOI = null;
          this.startBurn("vec", vScale(vNorm(vSub(c.vel, mars.vel)), -1), 1);
          this.targetDv = dvQ;
          this.burnDvAccum = 0;
          this.emit("info", `MOI BURN AT PERIAPSIS — ${Math.round(dvQ)} m/s RETROGRADE`);
        }
      } else this.prevDM = Infinity;
      const orbM = orbitFromState(this.muOf("mars"), relM, vSub(c.vel, mars.vel));
      if (orbM.type === "ELLIPSE" && dM > MARS.radius * 1.2) {
        if (orbM.peri > MARS.radius + 40e3) {
          this.phase = "MARS_ORBIT";
          this.emit("success", `MARS ORBIT INSERTION CONFIRMED — PERIAPSIS ${Math.round((orbM.peri - MARS.radius) / 1000)} km`);
          this.unlock("MARS_ORBIT");
          this.finishMission(true, "STABLE MARS ORBIT ESTABLISHED");
        } else {
          this.failMission(`MARS ORBIT UNSUSTAINABLE — PERIAPSIS ${Math.round((orbM.peri - MARS.radius) / 1000)} km BELOW SAFE ALTITUDE`);
        }
      } else if (orbM.type === "ESCAPE" && dM > MARS_SOI * 0.95 && this.burnsUsed > 1) {
        this.emit("alert", "MARS FLYBY — CAPTURE BURN INSUFFICIENT OR EXCESSIVE");
        this.failMission(`MARS FLYBY — HYPERBOLIC EXCESS ${Math.round(Math.sqrt(2 * orbM.energy))} m/s`);
      }
      if (dM > MARS_SOI * 1.1 && this.phase === "MARS_APPROACH" && this.t > 100 * DAY) {
        this.phase = "TRANSFER";
        this.emit("warn", "MARS SOI EXIT — RETURNING TO HELIOCENTRIC CRUISE");
      }
    }
  }

  private checkTransferQuality(orbS: OrbitParams) {
    const a = orbS.a / AU;
    if (a > 1.15 && a < 1.9) this.emit("success", `TRANSFER TRAJECTORY GOOD — HELIOCENTRIC SMA ${a.toFixed(2)} AU`);
    else if (a >= 1.9) this.emit("warn", `HIGH-ENERGY TRANSFER — SMA ${a.toFixed(2)} AU, MARS INTERCEPT UNLIKELY`);
    else this.emit("warn", `WEAK TRANSFER — SMA ${a.toFixed(2)} AU BELOW MARS ORBIT`);
    if (this.cfg.emergency === "wrong-course") {
      const err = vScale(vNorm(vCross(this.craft.pos, v3(0, 1, 0))), 140);
      this.craft.vel = vAdd(this.craft.vel, err);
      this.emit("alert", "GUIDANCE ERROR DETECTED — UNCOMMANDED 140 m/s DEVIATION");
    }
  }

  private unlockCrash() { /* reserved */ }

  /* ---------------- prediction ---------------- */
  maybePredict() {
    if (this.phase !== "TRANSFER" && this.phase !== "EARTH_ORBIT" && this.phase !== "MARS_APPROACH" && this.phase !== "FREEFLIGHT") return;
    const now = performance.now();
    if (now - this.lastPred < 500) return;
    this.lastPred = now;
    const pts: Vec3[] = [];
    let pos = { ...this.craft.pos }, vel = { ...this.craft.vel };
    let tt = this.tSim();
    const dtP = 2.2 * DAY;
    let marsT = -1, marsDist = Infinity;
    for (let i = 0; i < 420; i++) {
      const g = this.gravity(pos, true);
      vel = vAdd(vel, vScale(g, dtP));
      pos = vAdd(pos, vScale(vel, dtP));
      tt += dtP;
      if (i % 2 === 0) pts.push({ ...pos });
      const mars = this.planetState("mars", tt);
      const d = vLen(vSub(pos, mars.pos));
      if (d < marsDist) { marsDist = d; marsT = tt; }
      if (vLen(pos) > 1.2e13) break;
    }
    this.prediction = { points: pts, marsT, marsDist };
  }

  private sampleHistory() {
    const interval = clamp(this.multiplierNow * 0.16, 0.5, 20000);
    if (this.t - this.lastSample < interval) return;
    this.lastSample = this.t;
    const earth = this.planetState("earth", this.tSim());
    const mars = this.planetState("mars", this.tSim());
    const dE = vLen(vSub(this.craft.pos, earth.pos));
    const dM = vLen(vSub(this.craft.pos, mars.pos));
    const g = this.gravity(this.craft.pos);
    const relE = vSub(this.craft.pos, earth.pos);
    const muE = this.muOf("earth");
    const alt = dE < vLen(relE) ? (dE - EARTH.radius) / 1000 : (vLen(this.craft.pos) - 0) / 1e6;
    const energy = mechanicalEnergy(this.craft.mass, vLen(this.craft.vel), MU_SUN, vLen(this.craft.pos));
    this.history.push({
      t: this.t, v: vLen(this.craft.vel), alt: dE < dM ? (dE - EARTH.radius) / 1000 : (dM - MARS.radius) / 1000,
      fuel: this.stageFuel.reduce((a, b) => a + b, 0), dE, dM,
      acc: vLen(g), energy: energy.total / Math.max(this.craft.mass, 1), dv: this.dvRemaining(),
    });
    if (this.history.length > 2600) this.history = this.history.filter((_, i) => i % 2 === 0);
    void muE;
    // trail
    const tp = this.craft.pos;
    if (vLen(vSub(tp, this.lastTrail)) > 3.5e8) {
      this.trail.push({ ...tp });
      this.rec.push({ t: this.t, p: { ...tp } });
      this.lastTrail = { ...tp };
      if (this.trail.length > 9000) {
        this.trail = this.trail.filter((_, i) => i % 2 === 0);
        this.rec = this.rec.filter((_, i) => i % 2 === 0);
      }
    }
  }
  private multiplierNow = 1;
  setMultiplier(m: number) { this.multiplierNow = m; }

  /* ---------------- skip / fast-forward ---------------- */
  skipToEvent(maxDays = 900) {
    const t0 = this.t;
    const guard = this.t + maxDays * DAY;
    let n = 0;
    const prevPhase: string = this.phase;
    while (this.t < guard && n < 60000 && (this.phase as string) === prevPhase && (this.phase as string) !== "FAILED") {
      const dt = this.chooseDt() * 6;
      this.stepOnce(Math.min(dt, 2.5 * DAY));
      this.t += Math.min(dt, 2.5 * DAY);
      n++;
      if (n % 500 === 0) this.sampleHistory();
    }
    this.sampleHistory();
    this.lastPred = 0;
    this.maybePredict();
    this.emit("info", `TIME COMPRESSION — ${fmtDuration(this.t - t0)} OF CRUISE COMPUTED INSTANTLY`);
  }

  /* ---------------- replay ---------------- */
  beginReplay(): boolean {
    if (this.rec.length < 4) return false;
    this.replayBackup = { pos: { ...this.craft.pos }, vel: { ...this.craft.vel } };
    this.stopBurn();
    return true;
  }
  setReplayT(frac: number) {
    if (this.rec.length < 2) return;
    const tMax = this.rec[this.rec.length - 1].t;
    const t = clamp(frac, 0, 1) * tMax;
    let i = 1;
    while (i < this.rec.length - 1 && this.rec[i].t < t) i++;
    const a = this.rec[i - 1], b = this.rec[i];
    const f = (t - a.t) / Math.max(b.t - a.t, 1e-6);
    this.craft.pos = v3(
      a.p.x + (b.p.x - a.p.x) * f,
      a.p.y + (b.p.y - a.p.y) * f,
      a.p.z + (b.p.z - a.p.z) * f,
    );
    const dt = Math.max(b.t - a.t, 1);
    this.craft.vel = v3((b.p.x - a.p.x) / dt, (b.p.y - a.p.y) / dt, (b.p.z - a.p.z) / dt);
  }
  endReplay() {
    if (this.replayBackup) {
      this.craft.pos = this.replayBackup.pos;
      this.craft.vel = this.replayBackup.vel;
      this.replayBackup = null;
    }
  }
  replayDuration(): number { return this.rec.length ? this.rec[this.rec.length - 1].t : 0; }

  /* ---------------- mission end / scoring ---------------- */
  failMission(reason: string) {
    if (this.phase === "FAILED") return;
    this.phase = "FAILED";
    this.failReason = reason;
    this.stopBurn();
    this.emit("alert", reason);
    this.result = this.buildResult(false, reason);
  }
  finishMission(success: boolean, title: string) {
    this.stopBurn();
    this.result = this.buildResult(success, title);
    this.unlock("COMMANDER");
    if (success && this.result.fuelUsedPct < 62) this.unlock("FUEL_SAVER");
    this.emit("success", `MISSION COMPLETE — GRADE ${this.result.grade}`);
  }
  private buildResult(success: boolean, title: string): MissionResult {
    const fuelTotal0 = this.stages.reduce((s, x) => s + x.fuelMass, 0) * this.cfg.whatIf.fuel;
    const fuelLeft = this.stageFuel.reduce((a, b) => a + b, 0);
    const fuelUsedPct = clamp((1 - fuelLeft / Math.max(fuelTotal0, 1)) * 100, 0, 100);
    const h = hohmann(MU_SUN, AU, 1.5237 * AU);
    let score = 0;
    const breakdown: { label: string; value: number }[] = [];
    if (success) {
      const timeScore = clamp(1 - Math.abs(this.t - h.tof) / h.tof, 0, 1);
      const fuelScore = clamp(1 - fuelUsedPct / 100 + 0.25, 0, 1);
      const navScore = clamp(1 - this.corrections * 0.09, 0.3, 1);
      const safetyScore = this.maxHeat < 0.9 ? 1 : clamp(1.4 - this.maxHeat, 0, 1);
      const accScore = clamp(1 - (this.minMarsDist > 0 ? 0 : 0.2), 0.5, 1);
      breakdown.push(
        { label: "TRAJECTORY / TIME", value: Math.round(timeScore * 100) },
        { label: "FUEL EFFICIENCY", value: Math.round(fuelScore * 100) },
        { label: "NAVIGATION", value: Math.round(navScore * 100) },
        { label: "SAFETY", value: Math.round(safetyScore * 100) },
        { label: "COURSE CORRECTIONS", value: Math.round(accScore * 100) },
      );
      score = Math.round(timeScore * 25 + fuelScore * 25 + navScore * 20 + safetyScore * 15 + accScore * 15);
    }
    const grade = !success ? "FAILED" : score >= 90 ? "S" : score >= 78 ? "A" : score >= 62 ? "B" : "C";
    const orbM = orbitFromState(this.muOf("mars"), vSub(this.craft.pos, this.planetState("mars", this.tSim()).pos), vSub(this.craft.vel, this.planetState("mars", this.tSim()).vel));
    return {
      outcome: success ? "SUCCESS" : "FAILED", title, reason: success ? title : this.failReason || title,
      travelTime: this.t, fuelUsedPct, fuelRemainingKg: fuelLeft, corrections: this.corrections,
      score, grade, breakdown,
      finalOrbit: orbM.type === "ELLIPSE"
        ? `PERI ${Math.round((orbM.peri - MARS.radius) / 1000)} km · APO ${Math.round((orbM.apo - MARS.radius) / 1000)} km`
        : "—",
    };
  }

  /* ---------------- what-if ---------------- */
  startWhatIf() {
    this.whatIfOn = true;
    this.ghost = { pos: { ...this.craft.pos }, vel: { ...this.craft.vel } };
    this.ghostTrail = [{ ...this.craft.pos }];
    this.emit("info", "WHAT-IF SHADOW TRAJECTORY ACTIVE — DIVERGENCE PLOTTED IN AMBER");
  }
  stopWhatIf() { this.whatIfOn = false; this.ghost = null; this.ghostTrail = []; }
  get whatIfActive() { return this.whatIfOn; }

  /* ---------------- achievements ---------------- */
  private unlock(id: string) {
    if (this.achievements.has(id)) return;
    this.achievements.add(id);
    this.emit("success", `ACHIEVEMENT — ${ACHIEVEMENTS[id] || id}`);
  }

  /* ---------------- events ---------------- */
  private emit(level: GameEvent["level"], text: string) {
    this.events.push({ type: "evt", text, level });
    if (this.events.length > 40) this.events.shift();
  }
  drainEvents(): GameEvent[] { const e = this.events; this.events = []; return e; }

  /* ---------------- telemetry snapshot ---------------- */
  snapshot() {
    const c = this.craft;
    const earth = this.planetState("earth", this.tSim());
    const mars = this.planetState("mars", this.tSim());
    const relE = vSub(c.pos, earth.pos);
    const relM = vSub(c.pos, mars.pos);
    const dE = vLen(relE), dM = vLen(relM), dS = vLen(c.pos);
    const g = this.gravity(c.pos);
    const orbE = orbitFromState(this.muOf("earth"), relE, vSub(c.vel, earth.vel));
    const orbM = orbitFromState(this.muOf("mars"), relM, vSub(c.vel, mars.vel));
    const nearest = dE < dM ? { name: "EARTH", d: dE, orb: orbE, mu: this.muOf("earth") } : { name: "MARS", d: dM, orb: orbM, mu: this.muOf("mars") };
    const win = launchWindow(this.angleOf("earth", this.t), this.angleOf("mars", this.t));
    const st = this.stages[this.activeStage];
    return {
      phase: this.phase, mode: this.mode, t: this.t,
      pos: c.pos, vel: c.vel, acc: g,
      speed: vLen(c.vel), speedRelE: vLen(vSub(c.vel, earth.vel)),
      mass: c.mass, fuelTotal: this.stageFuel.reduce((a, b) => a + b, 0),
      stageFuel: [...this.stageFuel], separated: [...this.separated], activeStage: this.activeStage,
      dv: this.dvRemaining(), thrust: c.burning ? (st ? st.thrust * c.throttle : 0) : 0, throttle: c.throttle, burning: c.burning,
      dSun: dS, dEarth: dE, dMars: dM,
      altNearest: nearest.d - (nearest.name === "EARTH" ? EARTH.radius : MARS.radius),
      nearestName: nearest.name, orbit: nearest.orb,
      vEscLocal: escapeVelocity(nearest.mu, nearest.d), vCircLocal: circularVelocity(nearest.mu, nearest.d),
      signalDelay: dE / 299792458,
      win, landing: this.landing ? { ...this.landing } : null,
      result: this.result, corrections: this.corrections,
      prediction: this.prediction ? { marsDist: this.prediction.marsDist, marsEta: this.prediction.marsT - this.tSim() } : null,
      ghostActive: this.whatIfOn,
      energy: mechanicalEnergy(c.mass, vLen(c.vel), MU_SUN, dS),
    };
  }
}

export const ACHIEVEMENTS: Record<string, string> = {
  LAUNCH: "FIRST LAUNCH", ORBIT: "EARTH ORBIT", MARS: "MARS REACHED",
  MARS_ORBIT: "PERFECT TRANSFER", LANDER: "MARS LANDER", SOLAR_ESCAPE: "SOLAR ESCAPE",
  ESCAPE: "INTERSTELLAR", COMMANDER: "MISSION COMMANDER", SEPARATION: "STAGECRAFT",
  FUEL_SAVER: "FUEL SAVER", ASSIST: "GRAVITY ASSIST",
};

export const engine = new MissionEngine();
