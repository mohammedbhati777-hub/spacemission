import { useEffect, useRef, useState } from "react";
import { useTele } from "../store";
import { engine, HistorySample } from "../lib/engine";
import { fmt, fmtSI } from "../lib/constants";
import { mechanicalEnergy } from "../lib/orbital";
import { MU_SUN, vLen } from "../lib/constants";
import { Row, SectionTitle } from "./ui";

/* ---------------- physics inspector ---------------- */
export function TelemetryPanel() {
  const snap = useTele((s) => s.s);
  const [, force] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => force((x) => x + 1), 250);
    return () => clearInterval(iv);
  }, []);
  const f = engine.accelForDisplay();
  const m = snap?.mass || 1;
  const axis = (v: { x: number; y: number; z: number }, digits = 1, scale = 1) =>
    `${(v.x * scale).toFixed(digits)} · ${(v.y * scale).toFixed(digits)} · ${(v.z * scale).toFixed(digits)}`;
  if (!snap) return null;
  return (
    <div className="px-4 pb-6">
      <SectionTitle>STATE VECTORS · HELIOCENTRIC</SectionTitle>
      <Row label="POSITION X·Y·Z" value={<span style={{ fontSize: 10 }}>{axis(snap.pos, 2, 1 / 1e9)} Gm</span>} />
      <Row label="VELOCITY X·Y·Z" value={<span style={{ fontSize: 10 }}>{axis(snap.vel, 3, 1 / 1000)} km/s</span>} />
      <Row label="ACCEL X·Y·Z" value={<span style={{ fontSize: 10 }}>{axis(snap.acc, 6)} m/s²</span>} />
      <Row label="|VELOCITY|" value={`${fmt(snap.speed / 1000, 3)} km/s`} color="var(--blue)" />
      <SectionTitle>FORCE DECOMPOSITION</SectionTitle>
      <Row label="NET FORCE" value={`${fmt(vLen(f.net) * m / 1000, 2)} kN`} />
      <Row label="GRAVITY · SUN" value={`${fmt(vLen(f.sun) * m / 1000, 2)} kN`} color="var(--amber)" />
      <Row label="GRAVITY · EARTH" value={`${fmt(vLen(f.earth) * m / 1000, 3)} kN`} color="var(--blue)" />
      <Row label="GRAVITY · MARS" value={`${fmt(vLen(f.mars) * m / 1000, 3)} kN`} color="#e8926a" />
      <div className="mc-label mt-1.5" style={{ opacity: 0.65, textTransform: "none", letterSpacing: "0.04em" }}>
        a = F/m — thrust acceleration {snap.thrust > 0 ? fmt(snap.thrust / snap.mass, 2) + " m/s²" : "0 (coasting)"}
      </div>
      <SectionTitle>MASS & PROPULSION</SectionTitle>
      <Row label="TOTAL MASS" value={`${fmt(snap.mass, 0)} kg`} />
      <Row label="FUEL MASS" value={`${fmt(snap.fuelTotal, 0)} kg`} color="var(--amber)" />
      <Row label="Δv REMAINING" value={`${fmt(snap.dv, 0)} m/s`} color="var(--amber)" />
      <Row label="Δv = Isp·g₀·ln(m₀/mf)" value="Tsiolkovsky" />
      <SectionTitle>LOCAL ORBIT · {snap.nearestName}</SectionTitle>
      <Row label="ALTITUDE" value={fmtSI(Math.max(snap.altNearest, 0))} />
      <Row label="v CIRCULAR" value={`${fmt(snap.vCircLocal / 1000, 3)} km/s`} />
      <Row label="v ESCAPE" value={`${fmt(snap.vEscLocal / 1000, 3)} km/s`} color={snap.speedRelE > snap.vEscLocal ? "var(--red)" : "var(--green)"} />
      <Row label="REGIME" value={snap.speedRelE > snap.vEscLocal ? "HYPERBOLIC" : "BOUND"} color={snap.speedRelE > snap.vEscLocal ? "var(--red)" : "var(--green)"} />
    </div>
  );
}

/* ---------------- canvas micro-graph ---------------- */
function MiniGraph({ title, series, color, unit, scale = 1 }: {
  title: string; series: number[]; color: string; unit: string; scale?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    if (series.length < 2) {
      ctx.fillStyle = "rgba(91,108,130,0.7)";
      ctx.font = "10px IBM Plex Mono";
      ctx.fillText("AWAITING TELEMETRY…", 8, H / 2);
      return;
    }
    let min = Infinity, max = -Infinity;
    for (const v of series) { if (v < min) min = v; if (v > max) max = v; }
    if (max - min < 1e-9) { max = min + 1; }
    // grid
    ctx.strokeStyle = "rgba(126,160,200,0.12)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(0, (H / 4) * i); ctx.lineTo(W, (H / 4) * i); ctx.stroke();
    }
    // line
    ctx.beginPath();
    for (let i = 0; i < series.length; i++) {
      const x = (i / (series.length - 1)) * W;
      const y = H - 4 - ((series[i] - min) / (max - min)) * (H - 10);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // fill
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    ctx.fillStyle = color + "14";
    ctx.fill();
    // hover
    if (hover != null) {
      const i = Math.round((hover / W) * (series.length - 1));
      const x = (i / (series.length - 1)) * W;
      const y = H - 4 - ((series[i] - min) / (max - min)) * (H - 10);
      ctx.strokeStyle = "rgba(232,238,247,0.5)";
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill();
    }
  }, [series, color, hover]);

  const val = hover != null && series.length > 1 ? series[Math.round((hover / 200) * (series.length - 1))] : null;
  return (
    <div className="mb-2.5">
      <div className="flex justify-between items-baseline">
        <span className="mc-label">{title}</span>
        <span className="mc-value text-[10px]" style={{ color }}>
          {val != null ? fmt(val * scale, 2) + " " + unit : fmt((series[series.length - 1] || 0) * scale, 2) + " " + unit}
        </span>
      </div>
      <canvas
        ref={ref} width={200} height={62} className="w-full mt-0.5 cursor-crosshair"
        style={{ height: 62, background: "rgba(126,160,200,0.04)", border: "1px solid var(--line)" }}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(((e.clientX - r.left) / r.width) * 200);
        }}
        onMouseLeave={() => setHover(null)}
      />
    </div>
  );
}

export function GraphsPanel() {
  const [, force] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => force((x) => x + 1), 900);
    return () => clearInterval(iv);
  }, []);
  const h: HistorySample[] = engine.history;
  const col = (fn: (s: HistorySample) => number) => h.map(fn);
  return (
    <div className="px-4 pb-6">
      <SectionTitle>LIVE FLIGHT RECORDERS</SectionTitle>
      <div className="mc-label mb-2" style={{ opacity: 0.65, textTransform: "none", letterSpacing: "0.04em" }}>
        Hover any recorder to inspect a sample. Data is the integrator's own history — nothing synthetic.
      </div>
      <MiniGraph title="VELOCITY vs TIME" series={col((s) => s.v)} color="#59b7ff" unit="km/s" scale={0.001} />
      <MiniGraph title="ALTITUDE vs TIME" series={col((s) => s.alt)} color="#57d99a" unit="km" />
      <MiniGraph title="FUEL MASS vs TIME" series={col((s) => s.fuel)} color="#ffb454" unit="t" scale={0.001} />
      <MiniGraph title="DIST · EARTH vs TIME" series={col((s) => s.dE)} color="#7fb0ff" unit="Mm" scale={1e-6} />
      <MiniGraph title="DIST · MARS vs TIME" series={col((s) => s.dM)} color="#e8926a" unit="Mm" scale={1e-6} />
      <MiniGraph title="ACCELERATION vs TIME" series={col((s) => s.acc)} color="#c9a0ff" unit="m/s²" />
      <MiniGraph title="SPECIFIC ENERGY vs TIME" series={col((s) => s.energy)} color="#ffd27a" unit="MJ/kg" scale={1e-6} />
      <MiniGraph title="Δv REMAINING vs TIME" series={col((s) => s.dv)} color="#ff9d5c" unit="km/s" scale={0.001} />
    </div>
  );
}

/* ---------------- energy lab ---------------- */
export function EnergyPanel() {
  const snap = useTele((s) => s.s);
  const [, force] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => force((x) => x + 1), 400);
    return () => clearInterval(iv);
  }, []);
  if (!snap) return null;
  const v = snap.speed;
  const r = snap.dSun;
  const E = mechanicalEnergy(snap.mass, v, MU_SUN, r);
  const keMJ = E.ke / 1e6, peMJ = E.pe / 1e6, toMJ = E.total / 1e6;
  const scaleMax = Math.max(Math.abs(keMJ), Math.abs(peMJ), 1);
  const bar = (label: string, val: number, color: string, formula: string) => (
    <div className="mb-3">
      <div className="flex justify-between items-baseline">
        <span className="mc-label">{label}</span>
        <span className="mc-value text-[11px]" style={{ color }}>{fmt(val / 1000, 2)} GJ</span>
      </div>
      <div className="relative h-[5px] mt-1" style={{ background: "rgba(126,160,200,0.1)" }}>
        <div className="absolute left-1/2 top-[-2px] bottom-[-2px] w-px" style={{ background: "rgba(232,238,247,0.35)" }} />
        <div
          className="absolute top-0 bottom-0 transition-all duration-300"
          style={{
            background: color,
            left: val >= 0 ? "50%" : `${50 - (Math.min(Math.abs(val), scaleMax) / scaleMax) * 50}%`,
            width: `${(Math.min(Math.abs(val), scaleMax) / scaleMax) * 50}%`,
          }}
        />
      </div>
      <div className="mc-label mt-0.5" style={{ opacity: 0.55 }}>{formula}</div>
    </div>
  );
  return (
    <div className="px-4 pb-6">
      <SectionTitle accent="var(--amber)">MECHANICAL ENERGY · HELIOCENTRIC</SectionTitle>
      {bar("KINETIC ½mv²", keMJ, "#59b7ff", `½ · ${fmt(snap.mass, 0)} kg · (${fmt(v / 1000, 2)} km/s)²`)}
      {bar("POTENTIAL −μm/r", peMJ, "#e8926a", `−μ☉m / ${fmt(r / 1e9, 2)} Gm`)}
      {bar("TOTAL E", toMJ, E.total < 0 ? "#57d99a" : "#ff5c49", E.total < 0 ? "E < 0 — BOUND TO THE SUN" : "E ≥ 0 — ESCAPE TRAJECTORY")}
      <SectionTitle>INTERPRETATION</SectionTitle>
      <div className="mc-label" style={{ opacity: 0.85, textTransform: "none", letterSpacing: "0.04em", lineHeight: 1.6 }}>
        While coasting, total energy stays constant — kinetic and potential trade as the craft falls toward or climbs from the Sun.
        Every engine burn adds energy (ΔE = F·v·Δt). A gravity assist swaps momentum with a planet, changing heliocentric E without spending fuel.
        {E.total < 0
          ? ` Currently bound: semi-major axis ${fmt(-MU_SUN * snap.mass / (2 * E.total) / 1.496e11, 2)} AU.`
          : " Currently unbound: the craft will not return without a retrograde burn."}
      </div>
      <SectionTitle>RECORDER</SectionTitle>
      <MiniGraph title="TOTAL ENERGY vs TIME" series={engine.history.map((s) => s.energy)} color="#ffd27a" unit="MJ/kg" scale={1e-6} />
    </div>
  );
}
