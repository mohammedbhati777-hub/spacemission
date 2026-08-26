import { useEffect, useState } from "react";
import { useSim, useTele, PanelId, FocusTarget } from "../store";
import { engine } from "../lib/engine";
import { fmt, fmtDuration, fmtSI, vNorm, vScale, vSub } from "../lib/constants";
import { sound } from "../lib/audio";
import { Btn, Bar, SliderRow } from "./ui";

/* ---------------- icon rail ---------------- */
const ICONS: { id: PanelId; label: string; d: string }[] = [
  { id: "planner", label: "MISSION PLANNER", d: "M3 3h18v4H3zM3 10h12v4H3zM3 17h18v4H3z" },
  { id: "telemetry", label: "TELEMETRY", d: "M2 12h4l3-8 4 16 3-8h6" },
  { id: "graphs", label: "LIVE GRAPHS", d: "M3 3v18h18M7 15l4-5 3 3 5-7" },
  { id: "energy", label: "ENERGY LAB", d: "M13 2 4 14h6l-1 8 9-12h-6l1-8z" },
  { id: "physics", label: "PHYSICS LAB", d: "M9 3h6v5l5 9a3 3 0 0 1-2.6 4.5H6.6A3 3 0 0 1 4 17l5-9V3z" },
  { id: "orbit", label: "ORBIT ASSISTANT", d: "M12 3a9 9 0 1 0 9 9M12 7v5l3 3" },
  { id: "compare", label: "ATTEMPTS", d: "M4 20V10m6 10V4m6 16v-7m6 7V8" },
  { id: "settings", label: "SYSTEMS", d: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8 4a8 8 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a8 8 0 0 0-2-1.2L15 3h-6l-.6 2.7a8 8 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A8 8 0 0 0 4 12" },
];

function Rail() {
  const panel = useSim((s) => s.panel);
  const setPanel = useSim((s) => s.setPanel);
  return (
    <div className="absolute left-3 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-1.5 max-md:bottom-16 max-md:top-auto max-md:translate-y-0 max-md:flex-row max-md:left-1/2 max-md:-translate-x-1/2">
      {ICONS.map((ic) => (
        <button
          key={ic.id}
          title={ic.label}
          onClick={() => { sound.click(); setPanel(ic.id); }}
          className="mc-btn !p-2 !rounded-sm"
          style={panel === ic.id ? { color: "var(--blue)", borderColor: "rgba(89,183,255,0.6)", boxShadow: "0 0 12px rgba(89,183,255,0.2)" } : {}}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d={ic.d} />
          </svg>
        </button>
      ))}
    </div>
  );
}

/* ---------------- top-left brand ---------------- */
function Brand() {
  const snap = useTele((s) => s.s);
  const phase = snap?.phase || "PLANNING";
  const difficulty = useSim((s) => s.config.difficulty);
  const mode = useSim((s) => s.mode);
  const phaseColor = phase === "FAILED" ? "var(--red)" : phase === "MARS_ORBIT" || phase === "LANDED" ? "var(--green)" : "var(--amber)";
  return (
    <div className="mc-panel mc-corner px-4 py-3 pointer-events-auto max-md:hidden">
      <div className="font-display font-bold text-[13px] tracking-[0.22em]" style={{ color: "var(--text)" }}>
        SPACE MISSION SIMULATOR
      </div>
      <div className="flex items-center gap-3 mt-1.5">
        <span className="mc-label">MISSION 01 · {mode === "mission" ? "EARTH → MARS" : mode === "orbitlab" ? "ORBIT LAB" : "SANDBOX"}</span>
        <span className="mc-value text-[10px] px-1.5 py-0.5" style={{ color: phaseColor, border: `1px solid ${phaseColor}44`, letterSpacing: "0.12em" }}>
          {phase.replace("_", " ")}
        </span>
      </div>
      <div className="mc-label mt-1" style={{ opacity: 0.65 }}>COMMANDER PROFILE · {difficulty}</div>
    </div>
  );
}

/* ---------------- top-right clock ---------------- */
function Clock() {
  const snap = useTele((s) => s.s);
  const soundOn = useSim((s) => s.sound);
  const toggleSound = useSim((s) => s.toggleSound);
  const scaleMode = useSim((s) => s.scaleMode);
  const t = snap?.t || 0;
  const day = Math.floor(t / 86400);
  return (
    <div className="mc-panel mc-corner px-4 py-3 pointer-events-auto text-right">
      <div className="mc-label mb-1" style={{ color: scaleMode === "realistic" ? "var(--amber)" : "var(--faint)", opacity: 0.9 }}>
        {scaleMode === "realistic" ? "SCALE · TRUE DISTANCES — SIZES EXAGGERATED" : "SCALE · PRESENTATION (r^0.62 COMPRESSION)"}
      </div>
      <div className="mc-label">MISSION TIME</div>
      <div className="font-display font-semibold text-xl mt-0.5" style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
        T+ {fmtDuration(t)}
      </div>
      <div className="flex items-center justify-end gap-3 mt-1">
        <span className="mc-value text-[10px]" style={{ color: "var(--dim)" }}>DAY {String(day).padStart(3, "0")}</span>
        <span className="mc-value text-[10px]" style={{ color: "var(--blue)" }}>
          SIG DELAY {snap ? (snap.signalDelay < 1 ? `${(snap.signalDelay * 1000).toFixed(0)}ms` : `${snap.signalDelay.toFixed(1)}s`) : "—"}
        </span>
        <button className="mc-btn !p-1.5" title="SOUND" onClick={() => { toggleSound(); sound.setEnabled(!soundOn); }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            {soundOn ? <path d="M11 5 6 9H2v6h4l5 4V5zm4.5 2.5a5 5 0 0 1 0 9M18 5a9 9 0 0 1 0 14" /> : <path d="M11 5 6 9H2v6h4l5 4V5zm11 4-6 6m0-6 6 6" />}
          </svg>
        </button>
      </div>
    </div>
  );
}

/* ---------------- time controls ---------------- */
const MULTS = [1, 10, 100, 1000, 10000];
function TimeControls() {
  const multiplier = useSim((s) => s.multiplier);
  const setMultiplier = useSim((s) => s.setMultiplier);
  const paused = useSim((s) => s.paused);
  const togglePause = useSim((s) => s.togglePause);
  const requestStep = useSim((s) => s.requestStep);
  const snap = useTele((s) => s.s);
  const canSkip = snap && (snap.phase === "TRANSFER");
  const resetMission = () => {
    sound.click();
    const st = useSim.getState();
    engine.configure(st.config, st.mode);
    st.setPhase("PLANNING");
    st.setMultiplier(10);
    st.setPanel("planner");
    st.setFocus("craft");
  };
  return (
    <div className="mc-panel mc-corner px-3 py-2 pointer-events-auto flex items-center gap-2 max-md:flex-wrap max-md:justify-center">
      <button className={`mc-btn !p-2 ${paused ? "on" : ""}`} title={paused ? "PLAY" : "PAUSE"} onClick={() => { sound.click(); togglePause(); }}>
        {paused ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l14 8-14 8z" /></svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M5 4h5v16H5zm9 0h5v16h-5z" /></svg>
        )}
      </button>
      <button className="mc-btn !p-2" title="STEP FRAME (+1s)" onClick={() => { sound.click(); requestStep(); }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M5 4l10 8-10 8zM17 4h3v16h-3z" /></svg>
      </button>
      <button className="mc-btn !p-2" title="RESET MISSION" onClick={resetMission}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" /></svg>
      </button>
      <span className="w-px h-5" style={{ background: "var(--line)" }} />
      {MULTS.map((m) => (
        <button
          key={m}
          className={`mc-btn !px-2.5 ${multiplier === m ? "on" : ""}`}
          onClick={() => { sound.click(); setMultiplier(m); engine.setMultiplier(m); }}
        >
          {m >= 1000 ? `${m / 1000}k` : m}×
        </button>
      ))}
      <span className="w-px h-5" style={{ background: "var(--line)" }} />
      <button
        className="mc-btn !px-2.5"
        disabled={!canSkip}
        title="Compress time until next event"
        onClick={() => { sound.click(); engine.skipToEvent(); }}
      >
        SKIP ▸▸ EVENT
      </button>
    </div>
  );
}

/* ---------------- camera presets ---------------- */
function CameraPresets() {
  const focus = useSim((s) => s.focus);
  const setFocus = useSim((s) => s.setFocus);
  const presets: { id: FocusTarget; label: string }[] = [
    { id: "craft", label: "FOLLOW CRAFT" },
    { id: "earth", label: "EARTH" },
    { id: "mars", label: "MARS" },
    { id: "sun", label: "SUN" },
    { id: "top", label: "TOP-DOWN" },
    { id: "cinematic", label: "CINEMATIC" },
    { id: "free", label: "FREE" },
  ];
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex gap-1 max-md:hidden">
      {presets.map((p) => (
        <button key={p.id} className={`mc-btn !py-1 !px-2 !text-[9px] ${focus === p.id ? "on" : ""}`} style={{ background: "rgba(9,14,23,0.7)" }} onClick={() => { sound.click(); setFocus(p.id); }}>
          {p.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- spacecraft status ---------------- */
function CraftStatus() {
  const snap = useTele((s) => s.s);
  const manual = useSim((s) => s.manual);
  const setManual = useSim((s) => s.setManual);
  const [showAll, setShowAll] = useState(true);
  if (!snap) return null;
  return (
    <div className="mc-panel mc-corner px-4 py-3 pointer-events-auto w-[248px] max-md:w-[200px]">
      <div className="flex items-center justify-between cursor-pointer" onClick={() => setShowAll(!showAll)}>
        <span className="mc-label" style={{ color: "var(--dim)" }}>SPACECRAFT STATUS</span>
        <span className="mc-label">{showAll ? "–" : "+"}</span>
      </div>
      {showAll && (
        <>
          <div className="mt-2">
            {snap.stageFuel.map((f: number, i: number) => (
              <Bar
                key={i}
                label={`${engine.stages[i]?.name.split("·")[0] || "STG " + i} ${snap.separated[i] ? "· SEP" : ""}`}
                value={f}
                max={engine.stages[i]?.fuelMass || 1}
                color={snap.separated[i] ? "var(--faint)" : snap.activeStage === i ? "var(--amber)" : "var(--blue)"}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-x-3 mt-1">
            <div className="tick-row !border-0 !py-0.5"><span className="mc-label">MASS</span><span className="mc-value text-[11px]">{fmt(snap.mass, 1)} kg</span></div>
            <div className="tick-row !border-0 !py-0.5"><span className="mc-label">Δv REM</span><span className="mc-value text-[11px]" style={{ color: "var(--amber)" }}>{fmt(snap.dv, 0)} m/s</span></div>
            <div className="tick-row !border-0 !py-0.5"><span className="mc-label">THRUST</span><span className="mc-value text-[11px]" style={{ color: snap.burning ? "var(--amber)" : "var(--text)" }}>{snap.burning ? fmt(snap.thrust / 1000, 0) + " kN" : "IDLE"}</span></div>
            <div className="tick-row !border-0 !py-0.5"><span className="mc-label">FUEL</span><span className="mc-value text-[11px]">{fmt(snap.fuelTotal / 1000, 1)} t</span></div>
          </div>
          <div className="flex gap-1.5 mt-2.5">
            <Btn onClick={() => { sound.click(); engine.separateStage(); }} disabled={snap.activeStage >= 2}>SEP</Btn>
            <Btn kind={manual ? "on" : ""} onClick={() => { sound.click(); setManual(!manual); }} title="WASD steer · SPACE burn · Z/X throttle">MANUAL</Btn>
            <Btn kind="danger" onClick={() => { sound.click(); engine.stopBurn(); }} disabled={!snap.burning}>CUT</Btn>
          </div>
          {manual && (
            <div className="mt-2">
              <Bar label="THROTTLE" value={snap.throttle * 100} max={100} color="var(--amber)" />
              <div className="mc-label" style={{ opacity: 0.7 }}>WASD STEER · HOLD SPACE BURN · Z / X THROTTLE</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------- navigation computer ---------------- */
function NavComputer() {
  const snap = useTele((s) => s.s);
  const [showAll, setShowAll] = useState(true);
  const [, force] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => force((x) => x + 1), 400);
    return () => clearInterval(iv);
  }, []);
  if (!snap) return null;
  const rec = engine.recommendation();
  const orb = snap.orbit;
  return (
    <div className="mc-panel mc-corner px-4 py-3 pointer-events-auto w-[262px] max-md:w-[210px]">
      <div className="flex items-center justify-between cursor-pointer" onClick={() => setShowAll(!showAll)}>
        <span className="mc-label" style={{ color: "var(--dim)" }}>NAVIGATION COMPUTER</span>
        <span className="mc-label">{showAll ? "–" : "+"}</span>
      </div>
      {showAll && (
        <>
          <div className="mt-1.5">
            <div className="tick-row"><span className="mc-label">TARGET</span><span className="mc-value text-[11px]" style={{ color: "#e8926a" }}>MARS</span></div>
            <div className="tick-row"><span className="mc-label">DIST · MARS</span><span className="mc-value text-[11px]">{fmtSI(snap.dMars)}</span></div>
            <div className="tick-row"><span className="mc-label">DIST · EARTH</span><span className="mc-value text-[11px]">{fmtSI(snap.dEarth)}</span></div>
            <div className="tick-row"><span className="mc-label">VEL · HELIO</span><span className="mc-value text-[11px]">{fmt(snap.speed / 1000, 2)} km/s</span></div>
            <div className="tick-row"><span className="mc-label">VEL · REL</span><span className="mc-value text-[11px]">{fmt(snap.speedRelE / 1000, 2)} km/s</span></div>
            {snap.prediction && snap.phase !== "MARS_ORBIT" && snap.phase !== "LANDED" && (
              <div className="tick-row">
                <span className="mc-label">PREDICTED MISS</span>
                <span className="mc-value text-[11px]" style={{ color: snap.prediction.marsDist < 5.77e8 ? "var(--green)" : "var(--red)" }}>
                  {fmtSI(snap.prediction.marsDist)}
                </span>
              </div>
            )}
            <div className="tick-row"><span className="mc-label">ORBIT · {snap.nearestName}</span><span className="mc-value text-[11px]" style={{ color: orb.type === "ELLIPSE" ? "var(--green)" : "var(--red)" }}>{orb.type}</span></div>
            {orb.type === "ELLIPSE" && (
              <>
                <div className="tick-row"><span className="mc-label">PERIAPSIS</span><span className="mc-value text-[11px]">{fmt((orb.peri - (snap.nearestName === "EARTH" ? 6371e3 : 3389.5e3)) / 1000, 0)} km</span></div>
                <div className="tick-row"><span className="mc-label">APOAPSIS</span><span className="mc-value text-[11px]">{isFinite(orb.apo) ? fmt((orb.apo - (snap.nearestName === "EARTH" ? 6371e3 : 3389.5e3)) / 1000, 0) + " km" : "∞"}</span></div>
              </>
            )}
            <div className="tick-row"><span className="mc-label">v ESCAPE · LOCAL</span><span className="mc-value text-[11px]">{fmt(snap.vEscLocal / 1000, 2)} km/s</span></div>
          </div>

          {rec.type !== "NONE" && rec.type !== "LANDING" && (
            <div className="mt-2.5 p-2" style={{ border: "1px solid rgba(255,180,84,0.35)", background: "rgba(255,180,84,0.05)" }}>
              <div className="flex justify-between items-baseline">
                <span className="mc-label" style={{ color: "var(--amber)" }}>{rec.label}</span>
                <span className="mc-value text-[11px]" style={{ color: "var(--amber)" }}>Δv {fmt(rec.dv, 0)} m/s</span>
              </div>
              <div className="mc-label mt-1 normal-case" style={{ letterSpacing: "0.04em", opacity: 0.85 }}>{rec.detail}</div>
              <div className="flex gap-1.5 mt-2">
                <Btn kind="primary" onClick={() => { sound.chime(); engine.executeRecommended(); }}>EXECUTE BURN</Btn>
                <WhyBtn kind={rec.type} />
              </div>
            </div>
          )}
          {snap.mode !== "mission" && (
            <div className="mt-2 p-2" style={{ border: "1px solid var(--line)" }}>
              <div className="mc-label mb-1.5">IMPULSE PROBES · 200 m/s EACH</div>
              <div className="flex gap-1.5">
                <Btn onClick={() => { sound.click(); const e = engine.planetState("earth", engine.absTime()); engine.impulse(vNorm(vSub(engine.craft.vel, e.vel)), 200); }}>PROGRADE</Btn>
                <Btn onClick={() => { sound.click(); const e = engine.planetState("earth", engine.absTime()); engine.impulse(vScale(vNorm(vSub(engine.craft.vel, e.vel)), -1), 200); }}>RETRO</Btn>
                <Btn onClick={() => { sound.click(); const e = engine.planetState("earth", engine.absTime()); engine.impulse(vNorm(vSub(engine.craft.pos, e.pos)), 200); }}>RADIAL</Btn>
              </div>
            </div>
          )}
          {snap.phase === "MARS_ORBIT" && useSim.getState().config.landingMode === "LANDING" && !snap.landing && (
            <div className="mt-2.5">
              <SliderRow label="ENTRY ANGLE" value={engine.entryAngle} min={6} max={26} fmt={(n) => `${Math.round(n)}°`} amber onChange={(n) => engine.setEntryAngle(n)} />
              <div className="mc-label" style={{ opacity: 0.7, textTransform: "none", letterSpacing: "0.04em" }}>
                &lt; 6° SKIPS OFF THE ATMOSPHERE · &gt; 20° EXCEEDS THERMAL LIMIT
              </div>
            </div>
          )}
          {rec.type === "LANDING" && useSim.getState().config.landingMode === "LANDING" && (
            <div className="mt-2.5">
              <Btn kind="primary" onClick={() => { sound.chime(); engine.startLanding(); }}>BEGIN LANDING SEQUENCE</Btn>
            </div>
          )}

          {snap.landing && snap.landing.phase !== "TOUCHDOWN" && snap.landing.phase !== "CRASH" && (
            <div className="mt-2.5 p-2" style={{ border: "1px solid rgba(255,92,73,0.4)", background: "rgba(255,92,73,0.05)" }}>
              <div className="mc-label" style={{ color: "var(--red)" }}>ATMOSPHERIC ENTRY · {snap.landing.phase}</div>
              <div className="grid grid-cols-2 gap-x-3 mt-1">
                <div className="tick-row !border-0 !py-0.5"><span className="mc-label">ALT</span><span className="mc-value text-[11px]">{fmt(snap.landing.alt / 1000, 1)} km</span></div>
                <div className="tick-row !border-0 !py-0.5"><span className="mc-label">V·VERT</span><span className="mc-value text-[11px]">{fmt(snap.landing.vel, 0)} m/s</span></div>
              </div>
              <Bar label="HEAT LOAD" value={snap.landing.heat} max={1} color="var(--red)" warn={snap.landing.heat > 0.75} />
              <Bar label="DESCENT FUEL" value={snap.landing.fuel} max={engine.stages[2]?.fuelMass || 26000} color="var(--amber)" />
              <div className="flex gap-1.5 mt-1.5 items-center">
                <Btn kind="danger" onClick={() => { sound.click(); engine.deployChute(); }} disabled={snap.landing.chute}>DEPLOY CHUTE</Btn>
                <input type="range" className="mc-range amber flex-1" min={0} max={100} value={snap.landing.throttle * 100}
                  onChange={(e) => engine.setLandingThrottle(parseInt(e.target.value) / 100)} />
              </div>
              <div className="mc-label mt-1" style={{ opacity: 0.75 }}>LANDING THRUST {Math.round(snap.landing.throttle * 100)}%</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function WhyBtn({ kind }: { kind: string }) {
  const setPanel = useSim((s) => s.setPanel);
  return <Btn onClick={() => { sound.click(); setPanel("physics"); }} title="Show the physics">WHY?</Btn>;
}

/* ---------------- alerts ---------------- */
function Alerts() {
  const alerts = useSim((s) => s.alerts);
  const dropAlert = useSim((s) => s.dropAlert);
  useEffect(() => {
    if (!alerts.length) return;
    const t = setTimeout(() => dropAlert(alerts[0].id), 4600);
    return () => clearTimeout(t);
  }, [alerts, dropAlert]);
  return (
    <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-1.5 pointer-events-none w-[min(560px,90vw)]">
      {alerts.map((a) => (
        <div
          key={a.id}
          className="toast-in mc-panel px-4 py-2 w-full text-center"
          style={{
            borderColor: a.level === "alert" ? "rgba(255,92,73,0.5)" : a.level === "warn" ? "rgba(255,180,84,0.45)" : a.level === "success" ? "rgba(87,217,154,0.45)" : "var(--line)",
          }}
        >
          <span
            className={`mc-value text-[10px] tracking-[0.14em] ${a.level === "alert" ? "pulse-warn" : ""}`}
            style={{ color: a.level === "alert" ? "var(--red)" : a.level === "warn" ? "var(--amber)" : a.level === "success" ? "var(--green)" : "var(--blue)" }}
          >
            {a.text}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------------- countdown overlay ---------------- */
function Countdown() {
  const snap = useTele((s) => s.s);
  if (!snap || snap.phase !== "COUNTDOWN") return null;
  const n = Math.ceil(engine.countdown);
  if (n <= 0) return null;
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center pointer-events-none">
      <div className="mc-label tracking-[0.5em] mb-3" style={{ color: "var(--amber)" }}>IGNITION SEQUENCE</div>
      <div className="font-display font-bold text-8xl" style={{ color: "var(--text)", textShadow: "0 0 40px rgba(255,180,84,0.4)", fontVariantNumeric: "tabular-nums" }}>
        T−{Math.max(n, 0)}
      </div>
      <div className="mc-label mt-4">ALL SYSTEMS NOMINAL · GUIDANCE INTERNAL</div>
    </div>
  );
}

export function HUD() {
  const introDone = useSim((s) => s.introDone);
  if (!introDone) return null;
  return (
    <div className="absolute inset-0 z-20 pointer-events-none select-none">
      <Rail />
      <CameraPresets />
      <Alerts />
      <Countdown />
      <div className="absolute top-3 left-3"><Brand /></div>
      <div className="absolute top-3 right-3"><Clock /></div>
      <div className="absolute bottom-3 left-3"><CraftStatus /></div>
      <div className="absolute bottom-3 right-3"><NavComputer /></div>
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 max-md:bottom-3 max-md:w-[94vw] max-md:flex max-md:justify-center"><TimeControls /></div>
    </div>
  );
}
