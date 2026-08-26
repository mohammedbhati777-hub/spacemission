/* ============================================================
   SPACE MISSION SIMULATOR — physical constants & solar system
   All simulation is done in SI units (m, kg, s).
   ============================================================ */

export const G = 6.674e-11;          // gravitational constant
export const G0 = 9.80665;           // standard gravity
export const AU = 1.495978707e11;    // astronomical unit (m)
export const MU_SUN = 1.32712440018e20;
export const DAY = 86400;
export const EARTH_YEAR = 365.25 * DAY;

export interface Vec3 { x: number; y: number; z: number }
export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const vAdd = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const vSub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const vScale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const vDot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const vCross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x,
});
export const vLen = (a: Vec3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const vNorm = (a: Vec3): Vec3 => { const l = vLen(a); return l > 1e-12 ? vScale(a, 1 / l) : v3(1, 0, 0); };

export interface PlanetDef {
  id: string;
  name: string;
  mu: number;            // m^3/s^2
  radius: number;        // m
  a: number;             // semi-major axis, AU
  periodDays: number;
  phase0: number;        // rad at t=0
  incl: number;          // rad — slight tilt for depth
  colors: [string, string, string]; // shader palette
  atmosphere: string | null;
  rings?: boolean;
  renderR: number;       // presentation-scale visual radius (scene units)
}

const P = (
  id: string, name: string, mu: number, radiusKm: number, aAU: number,
  phase0: number, inclDeg: number, colors: [string, string, string],
  atmosphere: string | null, renderR: number, rings = false,
): PlanetDef => ({
  id, name, mu, radius: radiusKm * 1000, a: aAU,
  periodDays: 365.25 * Math.pow(aAU, 1.5),
  phase0, incl: (inclDeg * Math.PI) / 180,
  colors, atmosphere, renderR, rings,
});

export const PLANETS: PlanetDef[] = [
  P("mercury", "MERCURY", 2.2032e13, 2439.7, 0.387, 4.4, 7.0, ["#8a7f72", "#5c534a", "#3a332c"], null, 0.85),
  P("venus", "VENUS", 3.24859e14, 6051.8, 0.723, 2.2, 3.4, ["#e8c98f", "#c49a5c", "#8a6a3c"], "#e8d9a8", 1.35),
  P("earth", "EARTH", 3.986004418e14, 6371, 1.0, 0.0, 0.0, ["#2f6fd0", "#1d3f7d", "#0d1f42"], "#6fb8ff", 1.5),
  P("mars", "MARS", 4.282837e13, 3389.5, 1.5237, 1.1, 1.85, ["#c96b42", "#9c4a2c", "#5e2a18"], "#e8a87f", 1.15),
  P("jupiter", "JUPITER", 1.26686534e17, 69911, 5.2044, 3.8, 1.3, ["#d8b98f", "#b08d62", "#7d5f42"], "#e8d4b0", 4.4),
  P("saturn", "SATURN", 3.7931187e16, 58232, 9.5826, 5.5, 2.49, ["#e3d0a8", "#c4a978", "#8f7a52"], "#f0e2bc", 3.7, true),
  P("uranus", "URANUS", 5.793939e15, 25362, 19.218, 0.8, 0.77, ["#9fd4d8", "#6faab4", "#4a7d8a"], "#b8e8ec", 2.3),
  P("neptune", "NEPTUNE", 6.836529e15, 24622, 30.11, 2.6, 1.77, ["#4f7fd0", "#3558a8", "#1d3570"], "#7fb0ff", 2.25),
];

export const EARTH = PLANETS[2];
export const MARS = PLANETS[3];

export const MOON = { mu: 4.9028e12, radius: 1737.4e3, a: 3.844e8, period: 27.32 * DAY };

export const getPlanet = (id: string): PlanetDef => PLANETS.find((p) => p.id === id) || EARTH;

/* ---------- presentation scaling ----------
   Distances compressed with a power law so the whole system is
   readable; clearly labelled in the UI. "realistic" mode keeps
   true distance ratios (planet sizes still exaggerated & labelled). */

export const presScale = (r_m: number): number => 60 * Math.pow(Math.max(r_m, 1e6) / AU, 0.62);
export const realScale = (r_m: number): number => r_m / 4.2e9;

export const scaleRadius = (r_m: number, mode: "presentation" | "realistic"): number =>
  mode === "presentation" ? presScale(r_m) : realScale(r_m);

/* local exaggeration near a planet: units per 1000 km */
export const localScaleFor = (p: PlanetDef): number => p.renderR / (p.radius / 1e6);

/* ---------- formatting ---------- */
export const fmt = (n: number, digits = 1): string => {
  if (!isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(digits) + "T";
  if (a >= 1e9) return (n / 1e9).toFixed(digits) + "G";
  if (a >= 1e6) return (n / 1e6).toFixed(digits) + "M";
  if (a >= 1e4) return (n / 1e3).toFixed(digits) + "k";
  if (a >= 100) return n.toFixed(0);
  if (a >= 1) return n.toFixed(digits);
  return n.toFixed(digits + 1);
};

export const fmtSI = (n: number, unit = "m"): string => {
  if (!isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + " G" + unit;
  if (a >= 1e6) return (n / 1e6).toFixed(2) + " M" + unit;
  if (a >= 1e3) return (n / 1e3).toFixed(1) + " k" + unit;
  return n.toFixed(1) + " " + unit;
};

export const fmtDuration = (s: number): string => {
  if (!isFinite(s) || s < 0) return "—";
  const d = Math.floor(s / DAY);
  const h = Math.floor((s % DAY) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${Math.floor(s % 60)}s`;
};

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const damp = (a: number, b: number, lambda: number, dt: number): number =>
  lerp(a, b, 1 - Math.exp(-lambda * dt));
