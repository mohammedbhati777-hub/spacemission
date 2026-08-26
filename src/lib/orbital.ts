/* ============================================================
   Orbital mechanics toolkit — the math the mission runs on.
   Hohmann transfers, Lambert targeting, launch windows, energy.
   ============================================================ */
import {
  AU, DAY, MU_SUN, Vec3, vAdd, vCross, vDot, vLen, vNorm, vScale, vSub, v3, clamp,
} from "./constants";

/* circular orbital velocity v = sqrt(mu/r) */
export const circularVelocity = (mu: number, r: number): number => Math.sqrt(mu / Math.max(r, 1));

/* escape velocity v = sqrt(2mu/r) */
export const escapeVelocity = (mu: number, r: number): number => Math.sqrt((2 * mu) / Math.max(r, 1));

/* specific orbital energy  E = v^2/2 - mu/r  (J/kg) */
export const specificEnergy = (mu: number, r: number, v: number): number => (v * v) / 2 - mu / Math.max(r, 1);

export interface OrbitParams {
  energy: number; a: number; e: number; peri: number; apo: number;
  period: number; sma: number; type: "ELLIPSE" | "ESCAPE" | "PARABOLIC";
}

/* full orbital elements from relative state vectors */
export function orbitFromState(mu: number, rVec: Vec3, vVec: Vec3): OrbitParams {
  const r = vLen(rVec), v = vLen(vVec);
  const energy = specificEnergy(mu, r, v);
  if (Math.abs(energy) < 1e-12) return { energy, a: Infinity, e: 1, peri: r, apo: Infinity, period: Infinity, sma: Infinity, type: "PARABOLIC" };
  const a = -mu / (2 * energy);
  const hVec = vCross(rVec, vVec);
  const h2 = vDot(hVec, hVec);
  const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h2) / (mu * mu)));
  const peri = a * (1 - e);
  const apo = energy < 0 ? a * (1 + e) : Infinity;
  const period = energy < 0 ? 2 * Math.PI * Math.sqrt((a * a * a) / mu) : Infinity;
  return { energy, a, e, peri, apo, period, sma: a, type: energy < 0 ? "ELLIPSE" : "ESCAPE" };
}

/* ---------- Hohmann transfer (educational approximation) ---------- */
export interface HohmannResult {
  dv1: number;      // departure burn (heliocentric, m/s)
  dv2: number;      // arrival capture burn (m/s)
  tof: number;      // time of flight (s)
  r1: number; r2: number; aT: number;
  vDep: number; vArr: number;
}
export function hohmann(mu: number, r1: number, r2: number): HohmannResult {
  const R1 = Math.max(r1, 1e6), R2 = Math.max(r2, 1e6);
  const aT = (R1 + R2) / 2;
  const v1 = circularVelocity(mu, R1);
  const v2 = circularVelocity(mu, R2);
  const vDep = Math.sqrt((2 * mu * R2) / (R1 * (R1 + R2)));
  const vArr = Math.sqrt((2 * mu * R1) / (R2 * (R1 + R2)));
  return {
    dv1: Math.abs(vDep - v1), dv2: Math.abs(v2 - vArr), tof: Math.PI * Math.sqrt((aT * aT * aT) / mu),
    r1: R1, r2: R2, aT, vDep, vArr,
  };
}

/* burn needed at a circular parking orbit around a planet to inject onto
   a hyperbola with v_inf  (dv = sqrt(vInf^2 + 2mu/r) - vCirc) */
export function injectionBurn(mu: number, rPark: number, vInf: number): { dv: number; vHyper: number } {
  const vCirc = circularVelocity(mu, rPark);
  const vHyper = Math.sqrt(vInf * vInf + (2 * mu) / rPark);
  return { dv: vHyper - vCirc, vHyper };
}

/* ---------- launch window (phase-angle method) ---------- */
export interface WindowResult {
  phaseDeg: number;      // current Earth→Mars lead angle
  requiredDeg: number;   // ideal phase angle for Hohmann
  quality: number;       // 0..1
  label: "OPTIMAL WINDOW" | "POSSIBLE" | "POOR WINDOW";
  daysToOptimal: number;
  color: string;
}
export function launchWindow(earthAngle: number, marsAngle: number, r1 = AU, r2 = 1.5237 * AU): WindowResult {
  const h = hohmann(MU_SUN, r1, r2);
  const required = Math.PI - Math.sqrt(Math.pow((r1 + r2) / (2 * r2), 3)) * (Math.PI); // rad Mars sweeps during transfer
  // classical result ≈ 44.3°
  let phase = marsAngle - earthAngle;
  while (phase > Math.PI) phase -= 2 * Math.PI;
  while (phase < -Math.PI) phase += 2 * Math.PI;
  const phaseDeg = (phase * 180) / Math.PI;
  const reqDeg = (required * 180) / Math.PI;
  const err = Math.abs(phaseDeg - reqDeg);
  const quality = clamp(1 - err / 55, 0, 1);
  const label = quality > 0.72 ? "OPTIMAL WINDOW" : quality > 0.38 ? "POSSIBLE" : "POOR WINDOW";
  // synodic motion: mars lags earth by (wE - wM)
  const wE = (2 * Math.PI) / (365.25 * DAY);
  const wM = (2 * Math.PI) / (686.98 * DAY);
  let delta = required - phase;
  while (delta < 0) delta += 2 * Math.PI;
  const daysToOptimal = delta / (wE - wM) / DAY;
  return { phaseDeg, requiredDeg: reqDeg, quality, label, daysToOptimal, color: quality > 0.72 ? "#57d99a" : quality > 0.38 ? "#ffb454" : "#ff5c49" };
}

/* ---------- Lambert solver (universal variables, Bate–Mueller–White) ----------
   Solves for heliocentric departure velocity from r1 to r2 in time tof.
   Returns null if it fails to converge — caller falls back gracefully. */
export function lambert(r1: Vec3, r2: Vec3, tof: number, mu = MU_SUN, prograde = true): { v1: Vec3; v2: Vec3 } | null {
  const rm1 = vLen(r1), rm2 = vLen(r2);
  let cosNu = vDot(r1, r2) / (rm1 * rm2);
  cosNu = clamp(cosNu, -1, 1);
  const cr = vCross(r1, r2);
  const sign = prograde ? (cr.y >= 0 ? 1 : -1) : cr.y >= 0 ? -1 : 1;
  let nu = Math.acos(cosNu);
  if (sign < 0) nu = 2 * Math.PI - nu;
  const A = Math.sin(nu) * Math.sqrt((rm1 * rm2) / (1 - cosNu || 1e-9));
  if (Math.abs(A) < 1e-6) return null;

  const C2 = (psi: number) => (psi > 1e-6 ? (1 - Math.cos(Math.sqrt(psi))) / psi : psi < -1e-6 ? (1 - Math.cosh(Math.sqrt(-psi))) / psi : 1 / 2);
  const C3 = (psi: number) => (psi > 1e-6 ? (Math.sqrt(psi) - Math.sin(Math.sqrt(psi))) / Math.pow(psi, 1.5) : psi < -1e-6 ? (Math.sqrt(-psi) - Math.sinh(Math.sqrt(-psi))) / Math.pow(-psi, 1.5) : 1 / 6);

  let psi = 0.0, psiUp = 4 * Math.PI * Math.PI, psiLow = -4 * Math.PI;
  let y = 0, t = 0;
  for (let i = 0; i < 80; i++) {
    const c2 = C2(psi), c3 = C3(psi);
    y = rm1 + rm2 + A * ((psi * c3 - 1) / Math.sqrt(Math.max(c2, 1e-9)));
    if (A > 0 && y < 0) { // keep y positive
      psiLow = psi; psi = psi * 0.4 - 0.4; continue;
    }
    t = Math.sqrt(Math.pow(Math.max(y, 0), 3) / Math.max(mu, 1)) * c2 * Math.sqrt(Math.max(y, 0)) * c3 + A * Math.sqrt(Math.max(y, 0)) / Math.sqrt(Math.max(mu, 1));
    t = (Math.pow(Math.max(y, 1), 1.5) * c3 + A * Math.sqrt(Math.max(y, 1))) / Math.sqrt(mu);
    if (Math.abs(t - tof) < 0.5) break;
    if (t < tof) psiLow = psi; else psiUp = psi;
    psi = (psiLow + psiUp) / 2;
  }
  if (!isFinite(y) || y < 0) return null;
  const c2 = C2(psi), c3 = C3(psi);
  const f = 1 - y / rm1;
  const g = A * Math.sqrt(Math.max(y, 0) / mu);
  const gdot = 1 - y / rm2;
  const v1 = vScale(vSub(v3(r2.x, r2.y, r2.z), vScale(r1, f)), 1 / Math.max(g, 1e-6));
  const v2 = vScale(vSub(vScale(r2, gdot), r1), 1 / Math.max(g, 1e-6));
  if (!isFinite(v1.x) || !isFinite(v1.y) || !isFinite(v1.z)) return null;
  return { v1, v2 };
}

/* course-correction suggestion: small Lambert patch from current state to
   predicted Mars position. Returns the Δv vector to apply. */
export function courseCorrection(
  pos: Vec3, vel: Vec3, marsPosAt: (t: number) => Vec3, now: number, currentTof: number, strength = 0.65,
): { dv: Vec3; missKm: number } | null {
  const tof = clamp(currentTof, 2 * DAY, 500 * DAY);
  const target = marsPosAt(now + tof);
  const sol = lambert(pos, target, tof, MU_SUN);
  if (!sol) return null;
  const dvFull = vSub(sol.v1, vel);
  const miss = vLen(vSub(target, vAdd(pos, vScale(vel, tof))));
  return { dv: vScale(dvFull, strength), missKm: miss / 1000 };
}

/* ---------- energy bookkeeping ---------- */
export interface EnergyState { ke: number; pe: number; total: number }
export function mechanicalEnergy(m: number, v: number, mu: number, r: number): EnergyState {
  const ke = 0.5 * m * v * v;
  const pe = (-mu * m) / Math.max(r, 1);
  return { ke, pe, total: ke + pe };
}

/* Tsiolkovsky:  Δv = Isp · g0 · ln(m0 / mf) */
export const rocketDv = (isp: number, m0: number, mf: number): number =>
  mf > 0 && m0 > 0 ? isp * 9.80665 * Math.log(m0 / mf) : 0;

/* Hohmann ellipse points in the ecliptic plane for visualization */
export function hohmannPoints(r1: number, r2: number, earthAngle: number, scale: (r: number) => number, n = 220): Vec3[] {
  const aT = (r1 + r2) / 2;
  const e = (r2 - r1) / (r2 + r1);
  const pts: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const th = (Math.PI * i) / n;
    const rr = (aT * (1 - e * e)) / (1 + e * Math.cos(th));
    const ang = earthAngle + th;
    const s = scale(rr);
    pts.push(v3(Math.cos(ang) * s, 0, -Math.sin(ang) * s));
  }
  return pts;
}

/* synodic period in days */
export const synodicDays = (p1: number, p2: number): number => Math.abs((p1 * p2) / (p2 - p1));
