import { useMemo, useState } from "react";
import { useSim } from "../store";
import { engine, MissionConfig } from "../lib/engine";
import { AU, DAY, EARTH, MU_SUN, PLANETS } from "../lib/constants";
import { hohmann, injectionBurn, launchWindow, rocketDv } from "../lib/orbital";
import { sound } from "../lib/audio";
import { Btn, SectionTitle, SliderRow } from "./ui";

const angleAt = (id: string, day: number) => {
  const p = PLANETS.find((b) => b.id === id)!;
  return p.phase0 + (2 * Math.PI * day) / p.periodDays;
};
const findOptimalDay = (from = 0, span = 1600) => {
  let best = from, bestQ = -1;
  for (let d = from; d <= from + span; d += 2) {
    const w = launchWindow(angleAt("earth", d), angleAt("mars", d));
    if (w.quality > bestQ) { bestQ = w.quality; best = d; }
  }
  return best;
};
const dvBudget = (cfg: MissionConfig) => {
  let dv = 0, mBelow = cfg.payload;
  for (let i = 2; i >= 0; i--) {
    const s = cfg.stages[i];
    dv += rocketDv(s.isp, mBelow + s.dryMass + s.fuelMass, mBelow + s.dryMass);
    mBelow += s.dryMass + s.fuelMass;
  }
  return dv;
};

function AlignmentDiagram({ day }: { day: number }) {
  const thE = angleAt("earth", day);
  const thM = angleAt("mars", day);
  const deg = (thE * 180) / Math.PI;
  const mx = 90 + 66 * Math.cos(thM - thE);
  const my = 90 + 66 * Math.sin(thM - thE);
  return (
    <svg width="100%" viewBox="0 0 180 180" className="mt-2">
      <circle cx="90" cy="90" r="44" fill="none" stroke="rgba(126,160,200,0.25)" strokeDasharray="2 3" />
      <circle cx="90" cy="90" r="66" fill="none" stroke="rgba(126,160,200,0.25)" strokeDasharray="2 3" />
      <circle cx="90" cy="90" r="6" fill="#ffb454" />
      <g transform={`rotate(${deg} 90 90)`}>
        <ellipse cx="77.5" cy="90" rx="53.5" ry="52.4" fill="none" stroke="rgba(87,217,154,0.7)" strokeDasharray="5 4" strokeWidth="1.2" className="dash-anim" style={{ strokeDashoffset: 0 }} />
        <circle cx="24" cy="90" r="4" fill="none" stroke="#57d99a" strokeDasharray="2 2" />
        <text x="24" y="78" textAnchor="middle" fontSize="6.5" fill="#57d99a" fontFamily="IBM Plex Mono">MARS @ ARRIVAL</text>
      </g>
      <circle cx={90 + 44 * Math.cos(thE)} cy={90 + 44 * Math.sin(thE)} r="4" fill="#59b7ff" />
      <circle cx={mx} cy={my} r="3.5" fill="#e8926a" />
      <text x={90 + 52 * Math.cos(thE)} y={90 + 52 * Math.sin(thE) - 5} fontSize="7" fill="#59b7ff" fontFamily="IBM Plex Mono">EARTH</text>
      <text x={mx + 6} y={my + 3} fontSize="7" fill="#e8926a" fontFamily="IBM Plex Mono">MARS</text>
    </svg>
  );
}

export function PlannerPanel() {
  const cfg = useSim((s) => s.config);
  const setConfig = useSim((s) => s.setConfig);
  const [draft, setDraft] = useState<MissionConfig>(JSON.parse(JSON.stringify(cfg)));
  const [calced, setCalced] = useState(false);
  const [compare, setCompare] = useState(false);
  const upd = (fn: (d: MissionConfig) => void) => {
    const d = JSON.parse(JSON.stringify(draft)) as MissionConfig;
    fn(d);
    setDraft(d);
    setConfig(d);
  };

  const win = useMemo(() => launchWindow(angleAt("earth", draft.launchDay), angleAt("mars", draft.launchDay)), [draft.launchDay]);
  const hoh = useMemo(() => hohmann(MU_SUN, AU, 1.5237 * AU), []);
  const inj = useMemo(() => injectionBurn(EARTH.mu, EARTH.radius + 250e3, hoh.dv1), [hoh]);
  const budget = useMemo(() => dvBudget(draft), [draft]);
  const required = 9400 + inj.dv + hoh.dv2;
  const margin = ((budget - required) / required) * 100;
  const optimalDay = useMemo(() => findOptimalDay(0), []);
  const whatIfHot = Math.abs(draft.whatIf.earthMass - 1) > 0.01 || Math.abs(draft.whatIf.marsMass - 1) > 0.01 || Math.abs(draft.whatIf.sunMass - 1) > 0.01;

  const beginCountdown = () => {
    sound.chime();
    const st = useSim.getState();
    st.setConfig(draft);
    st.setMode("mission");
    engine.configure(draft, "mission");
    st.setPhase("PLANNING");
    st.setFocus("craft");
    st.setMultiplier(1);
    st.setPanel(null);
    engine.startCountdown();
  };
  const launchMode = (m: "orbitlab" | "sandbox") => {
    sound.chime();
    const st = useSim.getState();
    st.setConfig(draft);
    st.setMode(m);
    engine.configure(draft, m);
    st.setPhase(m === "orbitlab" ? "EARTH_ORBIT" : "FREEFLIGHT");
    st.setFocus("craft");
    st.setMultiplier(10);
    st.setPanel(null);
  };

  return (
    <div className="px-4 pb-6 text-left">
      <SectionTitle>MISSION OBJECTIVE</SectionTitle>
      <div className="flex items-center justify-between">
        <span className="font-display font-semibold text-lg tracking-[0.14em]">EARTH → MARS</span>
        <span className="mc-value text-[10px]" style={{ color: "var(--dim)" }}>HOHMANN CLASS</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 mt-2">
        {(["STUDENT", "ENGINEER", "MISSION CONTROL"] as const).map((d) => (
          <button key={d} className={`mc-btn ${draft.difficulty === d ? "on" : ""}`} onClick={() => { sound.click(); upd((x) => { x.difficulty = d; }); }}>{d}</button>
        ))}
        <button className={`mc-btn ${draft.landingMode === "LANDING" ? "on" : ""}`} onClick={() => { sound.click(); upd((x) => { x.landingMode = x.landingMode === "LANDING" ? "ORBIT_ONLY" : "LANDING"; }); }}>
          {draft.landingMode === "LANDING" ? "LAND ON MARS ✓" : "ORBIT ONLY"}
        </button>
      </div>
      <div className="mt-2">
        <div className="mc-label mb-1">EMERGENCY SCENARIO (OPTIONAL)</div>
        <select
          className="w-full bg-transparent mc-value text-[11px] p-1.5"
          style={{ border: "1px solid var(--line)" }}
          value={draft.emergency}
          onChange={(e) => { sound.click(); upd((x) => { x.emergency = e.target.value as MissionConfig["emergency"]; }); }}
        >
          <option value="none" className="bg-[#0a101b]">NONE — NOMINAL MISSION</option>
          <option value="fuel-leak" className="bg-[#0a101b]">FUEL LEAK — PROPELLANT VENTING</option>
          <option value="engine-failure" className="bg-[#0a101b]">ENGINE FAILURE — STAGE 3 AT 50% THRUST</option>
          <option value="wrong-course" className="bg-[#0a101b]">GUIDANCE ERROR — 140 m/s DEVIATION</option>
          <option value="low-fuel" className="bg-[#0a101b]">LOW FUEL — 60% PROPELLANT</option>
        </select>
      </div>

      <SectionTitle>LAUNCH WINDOW</SectionTitle>
      <SliderRow label="LAUNCH DATE" value={draft.launchDay} min={0} max={1600} unit="" fmt={(n) => `DAY ${String(Math.round(n)).padStart(3, "0")} · 2031+${Math.floor(n / 365)}y`} onChange={(n) => upd((x) => { x.launchDay = n; })} />
      <div className="flex items-center justify-between mt-1">
        <span className="mc-value text-[11px] font-semibold" style={{ color: win.color }}>● {win.label}</span>
        <span className="mc-label">PHASE {win.phaseDeg.toFixed(1)}° / REQ {win.requiredDeg.toFixed(1)}°</span>
      </div>
      <AlignmentDiagram day={draft.launchDay} />
      <div className="flex gap-1.5 mt-2">
        <Btn onClick={() => { sound.click(); upd((x) => { x.launchDay = optimalDay; }); }}>SHOW OPTIMAL WINDOW</Btn>
        <Btn onClick={() => { sound.click(); upd((x) => { x.launchDay = Math.max(0, optimalDay - 780); }); }}>PREV WINDOW</Btn>
      </div>
      <div className="mc-label mt-1.5" style={{ opacity: 0.7 }}>NEXT OPTIMAL IN ~{Math.max(0, win.daysToOptimal).toFixed(0)} d · SYNODIC PERIOD 780 d</div>

      <SectionTitle>LAUNCH VEHICLE</SectionTitle>
      <SliderRow label="PAYLOAD MASS" value={draft.payload} min={2000} max={20000} step={100} fmt={(n) => `${(n / 1000).toFixed(1)} t`} onChange={(n) => upd((x) => { x.payload = n; })} />
      {draft.stages.map((s, i) => (
        <div key={i} className="mt-1 p-2" style={{ border: "1px solid var(--line)" }}>
          <div className="mc-label mb-1.5" style={{ color: "var(--blue)" }}>{s.name}</div>
          <SliderRow label="FUEL" value={s.fuelMass} min={i === 0 ? 20000 : 4000} max={i === 0 ? 200000 : i === 1 ? 60000 : 40000} step={500} fmt={(n) => `${(n / 1000).toFixed(1)} t`} onChange={(n) => upd((x) => { x.stages[i].fuelMass = n; })} />
          <SliderRow label="THRUST" value={s.thrust} min={i === 0 ? 500000 : 20000} max={i === 0 ? 4000000 : i === 1 ? 900000 : 300000} step={10000} fmt={(n) => `${(n / 1000).toFixed(0)} kN`} amber onChange={(n) => upd((x) => { x.stages[i].thrust = n; })} />
          <SliderRow label="SPECIFIC IMPULSE" value={s.isp} min={250} max={i === 0 ? 340 : 470} step={1} fmt={(n) => `${n} s`} onChange={(n) => upd((x) => { x.stages[i].isp = n; })} />
          <div className="mc-label" style={{ opacity: 0.75 }}>STAGE Δv {Math.round(rocketDv(s.isp, draft.payload + draft.stages.reduce((a, b, k) => k >= i ? a + b.dryMass + b.fuelMass : a, 0), draft.payload + draft.stages.reduce((a, b, k) => k >= i ? a + b.dryMass + (k === i ? 0 : b.fuelMass) : a, 0)))} m/s</div>
        </div>
      ))}

      <SectionTitle>LAUNCH PROFILE</SectionTitle>
      <SliderRow label="AZIMUTH (90° = EAST)" value={draft.azimuth} min={0} max={360} fmt={(n) => `${n}°`} onChange={(n) => upd((x) => { x.azimuth = n; })} />
      <SliderRow label="PITCH FROM VERTICAL" value={draft.pitch} min={20} max={90} fmt={(n) => `${n}°`} onChange={(n) => upd((x) => { x.pitch = n; })} />
      <SliderRow label="TARGET MARS ORBIT" value={draft.targetMarsOrbitKm} min={400} max={20000} step={100} fmt={(n) => `${Math.round(n)} km`} onChange={(n) => upd((x) => { x.targetMarsOrbitKm = n; })} />

      <SectionTitle accent="var(--amber)">MISSION CALCULATIONS</SectionTitle>
      {!calced ? (
        <Btn kind="primary" onClick={() => { sound.chime(); setCalced(true); }}>CALCULATE MISSION</Btn>
      ) : (
        <div className="fade-up">
          <div className="tick-row"><span className="mc-label">REQUIRED Δv · LEO</span><span className="mc-value text-[11px]">≈ 9,400 m/s</span></div>
          <div className="tick-row"><span className="mc-label">REQUIRED Δv · TMI</span><span className="mc-value text-[11px]">{Math.round(inj.dv).toLocaleString()} m/s</span></div>
          <div className="tick-row"><span className="mc-label">REQUIRED Δv · MOI</span><span className="mc-value text-[11px]">{Math.round(hoh.dv2).toLocaleString()} m/s</span></div>
          <div className="tick-row"><span className="mc-label">VEHICLE Δv BUDGET</span><span className="mc-value text-[11px]" style={{ color: "var(--amber)" }}>{Math.round(budget).toLocaleString()} m/s</span></div>
          <div className="tick-row">
            <span className="mc-label">MARGIN</span>
            <span className="mc-value text-[11px]" style={{ color: margin > 5 ? "var(--green)" : "var(--red)" }}>{margin > 0 ? "+" : ""}{margin.toFixed(1)}%</span>
          </div>
          <div className="tick-row"><span className="mc-label">TRANSFER TIME</span><span className="mc-value text-[11px]">{(hoh.tof / DAY).toFixed(0)} days</span></div>
          <div className="tick-row"><span className="mc-label">EST. ARRIVAL</span><span className="mc-value text-[11px]">DAY {Math.round(draft.launchDay + hoh.tof / DAY)}</span></div>
          <div className="tick-row"><span className="mc-label">WINDOW QUALITY</span><span className="mc-value text-[11px]" style={{ color: win.color }}>{Math.round(win.quality * 100)}%</span></div>
        </div>
      )}
      <div className="mt-2">
        {!compare ? (
          <Btn onClick={() => { sound.click(); setCompare(true); }}>COMPARE WITH OPTIMAL</Btn>
        ) : (
          <div className="fade-up grid grid-cols-2 gap-2 text-[10px]">
            <div className="p-2" style={{ border: "1px solid var(--line)" }}>
              <div className="mc-label mb-1" style={{ color: "var(--blue)" }}>YOUR MISSION</div>
              <div className="mc-value">DAY {Math.round(draft.launchDay)}</div>
              <div className="mc-value" style={{ color: win.color }}>{win.label}</div>
              <div className="mc-value">Δv {Math.round(budget).toLocaleString()}</div>
              <div className="mc-value">~{Math.round(hoh.tof / DAY / Math.max(win.quality, 0.55))} d transit</div>
            </div>
            <div className="p-2" style={{ border: "1px solid rgba(87,217,154,0.4)" }}>
              <div className="mc-label mb-1" style={{ color: "var(--green)" }}>OPTIMAL</div>
              <div className="mc-value">DAY {optimalDay}</div>
              <div className="mc-value" style={{ color: "var(--green)" }}>OPTIMAL WINDOW</div>
              <div className="mc-value">Δv {Math.round(required).toLocaleString()}</div>
              <div className="mc-value">{(hoh.tof / DAY).toFixed(0)} d transit</div>
            </div>
          </div>
        )}
      </div>

      <SectionTitle accent="#ff9d5c">WHAT-IF ENGINE</SectionTitle>
      <SliderRow label="EARTH MASS ×" value={draft.whatIf.earthMass} min={0.5} max={3} step={0.05} fmt={(n) => n.toFixed(2) + "×"} onChange={(n) => upd((x) => { x.whatIf.earthMass = n; })} />
      <SliderRow label="MARS MASS ×" value={draft.whatIf.marsMass} min={0.5} max={3} step={0.05} fmt={(n) => n.toFixed(2) + "×"} onChange={(n) => upd((x) => { x.whatIf.marsMass = n; })} />
      <SliderRow label="SOLAR MASS ×" value={draft.whatIf.sunMass} min={0.5} max={2} step={0.05} fmt={(n) => n.toFixed(2) + "×"} onChange={(n) => upd((x) => { x.whatIf.sunMass = n; })} />
      <SliderRow label="SPACECRAFT MASS ×" value={draft.whatIf.craftMass} min={0.5} max={3} step={0.05} fmt={(n) => n.toFixed(2) + "×"} onChange={(n) => upd((x) => { x.whatIf.craftMass = n; })} />
      <SliderRow label="FUEL LOAD ×" value={draft.whatIf.fuel} min={0.5} max={2} step={0.05} fmt={(n) => n.toFixed(2) + "×"} onChange={(n) => upd((x) => { x.whatIf.fuel = n; })} />
      <div className="mc-label mb-2" style={{ opacity: 0.75, textTransform: "none", letterSpacing: "0.04em" }}>
        Planet factors reshape the gravity field for this run. Activate the shadow and the amber ghost flies the same mission under baseline physics — divergence is computed, not drawn.
      </div>
      <Btn
        kind={whatIfHot ? "on" : ""}
        onClick={() => {
          sound.click();
          if (engine.phase === "PLANNING" || engine.phase === "COUNTDOWN") {
            engine.pendingGhost = true;
            useSim.getState().pushAlert("WHAT-IF ARMED — GHOST WILL BRANCH AT EARTH ORBIT", "info");
          } else engine.startWhatIf();
        }}
      >
        ACTIVATE SHADOW TRAJECTORY
      </Btn>

      <SectionTitle accent="var(--green)">FLIGHT</SectionTitle>
      <div className="flex gap-1.5 flex-wrap">
        <Btn kind="primary" onClick={beginCountdown}>BEGIN COUNTDOWN</Btn>
        <Btn onClick={() => launchMode("orbitlab")}>ORBIT LAB</Btn>
        <Btn onClick={() => launchMode("sandbox")}>SANDBOX</Btn>
      </div>
      <div className="mc-label mt-2" style={{ opacity: 0.6, textTransform: "none", letterSpacing: "0.04em" }}>
        ORBIT LAB: probe Earth orbits — crash, orbit or escape. SANDBOX: free flight, no mission rules.
      </div>
    </div>
  );
}
