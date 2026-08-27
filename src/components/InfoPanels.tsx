import { ReactNode, useEffect, useRef, useState } from "react";
import { useSim, useTele } from "../store";
import { engine } from "../lib/engine";
import { AU, DAY, EARTH, G, MU_SUN, fmt, fmtDuration } from "../lib/constants";
import { circularVelocity, escapeVelocity, hohmann, rocketDv } from "../lib/orbital";
import { sound } from "../lib/audio";
import { Btn, Row, SectionTitle, SliderRow } from "./ui";

/* ---------------- drawer host ---------------- */
const TITLES: Record<string, string> = {
  planner: "MISSION PLANNER", telemetry: "SPACECRAFT TELEMETRY", graphs: "FLIGHT RECORDERS",
  energy: "ENERGY LABORATORY", physics: "PHYSICS LABORATORY", orbit: "ORBIT — FLIGHT ASSISTANT",
  compare: "MISSION ATTEMPTS", settings: "SYSTEMS & MODES",
};
export function DrawerHost({ children }: { children: ReactNode }) {
  const panel = useSim((s) => s.panel);
  const setPanel = useSim((s) => s.setPanel);
  if (!panel) return null;
  return (
    <div className="absolute top-14 left-14 bottom-16 z-30 w-[330px] max-md:left-2 max-md:right-2 max-md:w-auto max-md:top-2 max-md:bottom-24 pointer-events-auto fade-in">
      <div className="mc-panel mc-corner h-full flex flex-col">
        <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: "1px solid var(--line)" }}>
          <span className="mc-label" style={{ color: "var(--blue)" }}>{TITLES[panel]}</span>
          <button className="mc-btn !p-1" onClick={() => { sound.click(); setPanel(null); }}>
            <svg width="11" height="11" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M5 5l14 14M19 5L5 19" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/* ---------------- physics lab ---------------- */
export function PhysicsPanel() {
  const [altKm, setAltKm] = useState(400);
  const [m0, setM0] = useState(50000);
  const [fuel, setFuel] = useState(38000);
  const [isp, setIsp] = useState(348);
  const [r2AU, setR2AU] = useState(1.524);
  const [gm, setGm] = useState(5.97e24);
  const [gr, setGr] = useState(6771);
  const r = EARTH.radius + altKm * 1000;
  const hoh = hohmann(MU_SUN, AU, r2AU * AU);
  return (
    <div className="px-4 pb-6">
      <SectionTitle>ORBITAL VELOCITY</SectionTitle>
      <SliderRow label="ALTITUDE ABOVE EARTH" value={altKm} min={200} max={42000} step={50} fmt={(n) => `${Math.round(n)} km`} onChange={setAltKm} />
      <Row label="v = √(GM/r)" value={`${fmt(circularVelocity(EARTH.mu, r) / 1000, 3)} km/s`} color="var(--blue)" />
      <Row label="v ESC = √(2GM/r)" value={`${fmt(escapeVelocity(EARTH.mu, r) / 1000, 3)} km/s`} color="var(--amber)" />
      <Row label="PERIOD T = 2π√(r³/GM)" value={fmtDuration(2 * Math.PI * Math.sqrt((r * r * r) / EARTH.mu))} />
      <svg width="100%" viewBox="0 0 220 74" className="mt-1">
        <circle cx="37" cy="37" r="22" fill="none" stroke="rgba(89,183,255,0.5)" />
        <circle cx="37" cy="37" r="12" fill="#1d3f7d" />
        <circle cx={37 + (22 + altKm / 1900)} cy="37" r="3" fill="#ffb454" />
        <line x1={37 + (22 + altKm / 1900)} y1="37" x2={37 + (22 + altKm / 1900) + 22} y2="37" stroke="#59b7ff" strokeWidth="1.4" markerEnd="url(#ar)" />
        <defs><marker id="ar" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#59b7ff" /></marker></defs>
        <text x="70" y="20" fontSize="8" fill="#8fa3bd" fontFamily="IBM Plex Mono">tangential v keeps the craft falling</text>
        <text x="70" y="31" fontSize="8" fill="#8fa3bd" fontFamily="IBM Plex Mono">around Earth instead of into it</text>
      </svg>

      <SectionTitle accent="var(--amber)">ROCKET EQUATION</SectionTitle>
      <SliderRow label="WET MASS m₀" value={m0} min={10000} max={200000} step={1000} fmt={(n) => `${(n / 1000).toFixed(0)} t`} onChange={setM0} />
      <SliderRow label="PROPELLANT" value={Math.min(fuel, m0 - 1000)} min={1000} max={150000} step={1000} fmt={(n) => `${(n / 1000).toFixed(0)} t`} amber onChange={setFuel} />
      <SliderRow label="Isp" value={isp} min={220} max={470} fmt={(n) => `${n} s`} onChange={setIsp} />
      <Row label="Δv = Isp·g₀·ln(m₀/mf)" value={`${fmt(rocketDv(isp, m0, Math.max(m0 - Math.min(fuel, m0 - 1000), 100)) / 1000, 3)} km/s`} color="var(--amber)" />

      <SectionTitle accent="var(--green)">HOHMANN TRANSFER</SectionTitle>
      <SliderRow label="TARGET ORBIT RADIUS" value={r2AU} min={0.4} max={9.6} step={0.01} fmt={(n) => `${n.toFixed(2)} AU`} onChange={setR2AU} />
      <Row label="Δv₁ DEPARTURE" value={`${fmt(hoh.dv1 / 1000, 3)} km/s`} color="var(--green)" />
      <Row label="Δv₂ ARRIVAL" value={`${fmt(hoh.dv2 / 1000, 3)} km/s`} color="var(--green)" />
      <Row label="TRANSFER TIME ½T" value={`${(hoh.tof / DAY).toFixed(0)} days`} />
      <svg width="100%" viewBox="0 0 220 90" className="mt-1">
        <circle cx="30" cy="45" r="7" fill="#ffb454" />
        <circle cx="30" cy="45" r="26" fill="none" stroke="rgba(89,183,255,0.45)" strokeDasharray="3 3" />
        <circle cx="30" cy="45" r={Math.min(78, r2AU * 26)} fill="none" stroke="rgba(232,146,106,0.45)" strokeDasharray="3 3" />
        <ellipse cx={30 + (Math.min(78, r2AU * 26) - 26) / 2} cy="45" rx={(26 + Math.min(78, r2AU * 26)) / 2} ry={Math.sqrt(Math.max(1, ((26 + Math.min(78, r2AU * 26)) / 2) ** 2 - ((Math.min(78, r2AU * 26) - 26) / 2) ** 2))} fill="none" stroke="#57d99a" strokeDasharray="6 4" className="dash-anim" />
        <text x="128" y="14" fontSize="8" fill="#57d99a" fontFamily="IBM Plex Mono">transfer ellipse — tangent to both orbits</text>
      </svg>

      <SectionTitle>NEWTONIAN GRAVITY</SectionTitle>
      <SliderRow label="BODY MASS" value={Math.log10(gm)} min={22} max={30.2} step={0.05} fmt={(n) => `${(10 ** n / 1e24).toFixed(2)}×10²⁴ kg`} onChange={(n) => setGm(10 ** n)} />
      <SliderRow label="DISTANCE" value={gr} min={3000} max={400000} step={100} fmt={(n) => `${fmt(n, 0)} km`} onChange={setGr} />
      <Row label="F = GMm/r² (on 1 t)" value={`${fmt((G * gm * 1000) / (gr * 1000) ** 2, 1)} N`} color="var(--blue)" />
      <div className="mc-label mt-3" style={{ opacity: 0.75, textTransform: "none", letterSpacing: "0.04em", lineHeight: 1.6 }}>
        Every number in this simulator flows from these four relations, integrated step by step (RK4) over the mission. No splines, no scripts — change an input and the trajectory genuinely changes.
      </div>
    </div>
  );
}

/* ---------------- ORBIT assistant ---------------- */
interface ChatMsg { who: "user" | "orbit"; text: string }
function answer(q: string): string {
  const s = engine.snapshot();
  const ql = q.toLowerCase();
  const rec = engine.recommendation();
  if (/(why|fail|crash|lost)/.test(ql)) {
    if (s.result) return `MISSION VERDICT: ${s.result.reason}. ` + explainWhy(s.result.reason);
    if (s.phase === "EARTH_ORBIT") return "You are in a stable Earth orbit — nothing has failed yet. The risk now is timing: burn TMI when your Δv budget exceeds " + fmt(9400 + rec.dv, 0) + " m/s total used.";
    return `Current status: ${s.phase.replace("_", " ")}. No failure recorded. If you suspect a bad trajectory, check the predicted miss distance in NAVIGATION.`;
  }
  if (/(miss|mars.*(reach|hit)|intercept)/.test(ql)) {
    if (s.prediction) {
      const hit = s.prediction.marsDist < 5.77e8;
      return `Propagating your current state forward, closest Mars approach is ${fmt(s.prediction.marsDist / 1e6, 1)} million km ${hit ? "— inside the sphere of influence. You WILL encounter Mars." : "— a miss."} ` + (hit ? "Prepare the MOI retrograde burn." : `Execute the course-correction burn (~${fmt(rec.dv, 0)} m/s) to bend the ellipse onto Mars.`);
    }
    return "Not enough trajectory data yet — prediction starts once you are coasting.";
  }
  if (/(dv|delta)/.test(ql)) {
    return `Remaining Δv: ${fmt(s.dv, 0)} m/s across live stages. ` + (rec.type !== "NONE" ? `Next maneuver ${rec.label} needs ≈ ${fmt(rec.dv, 0)} m/s, leaving ${fmt(s.dv - rec.dv, 0)} m/s margin.` : "");
  }
  if (/(fuel|save)/.test(ql)) {
    return `Fuel remaining: ${fmt(s.fuelTotal / 1000, 1)} t. To save it: burn prograde at periapsis (Oberth effect), split large corrections into one early MCC rather than many late ones, and never burn radial — it changes the orbit shape but wastes Δv.`;
  }
  if (/(when|burn|tmi|moi|inject)/.test(ql)) {
    if (rec.type === "NONE") return "No burn advised right now — you are coasting on a computed trajectory.";
    return `Recommended: ${rec.label} — ${rec.detail}. Δv ≈ ${fmt(rec.dv, 0)} m/s. The EXECUTE button performs it as a real finite burn with real propellant flow.`;
  }
  if (/(window|launch date|when.*launch)/.test(ql)) {
    return `Launch window quality now: ${s.win.label} (phase angle ${s.win.phaseDeg.toFixed(1)}°, need ${s.win.requiredDeg.toFixed(1)}°). Mars must lead Earth by ~44° so the transfer ellipse meets Mars 259 days later.`;
  }
  if (/(gravity assist|slingshot|venus)/.test(ql)) {
    return "Gravity assist: flying behind a moving planet, the craft steals a little of the planet's orbital momentum — heliocentric speed rises with zero fuel. Watch the energy lab: E jumps at flyby while onboard fuel is untouched. Try a low Venus or Jupiter periapsis in SANDBOX.";
  }
  return `STATUS ${s.phase.replace("_", " ")} · v ${fmt(s.speed / 1000, 1)} km/s · Mars ${fmt(s.dMars / 1e9, 2)} Gm · fuel ${fmt(s.fuelTotal / 1000, 1)} t · Δv ${fmt(s.dv, 0)} m/s. Ask me about Δv, the miss distance, burns, fuel, launch windows or gravity assists.`;
}
function explainWhy(reason: string): string {
  if (/PERIAPSIS.*INSIDE|ORBIT FAILED/i.test(reason)) {
    const s = engine.snapshot();
    return `Physics: orbital velocity was below circular velocity at that altitude (v < √(GM/r) = ${fmt(s.vCircLocal / 1000, 2)} km/s), so the ellipse's low point dipped into the atmosphere. More prograde Δv on stage 2 fixes it.`;
  }
  if (/ESCAPE/.test(reason)) return "Physics: relative velocity exceeded v_esc = √(2GM/r). Specific energy E = v²/2 − GM/r became positive — the orbit opened into a hyperbola. Burn less, or retrograde to re-close it.";
  if (/IMPACT/.test(reason)) return "Physics: the trajectory's periapsis was below the body's radius — the conic section intersects the surface. A retrograde burn before periapsis raises the opposite side… you needed a shallower approach or an earlier capture burn.";
  if (/FLYBY/.test(reason)) return "Physics: at closest approach your Mars-relative speed stayed above local escape speed, so E > 0 and Mars could not hold you. MOI needs a harder retrograde burn at periapsis.";
  return "The integrator resolved the outcome from F = GMm/r² and your burns — replay the mission and watch the energy graph at the critical moment.";
}

export function OrbitPanel() {
  const [msgs, setMsgs] = useState<ChatMsg[]>([{ who: "orbit", text: "ORBIT online. I read the live integrator — ask me about Δv, miss distance, burns, fuel or why something failed." }]);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);
  const ask = (q: string) => {
    if (!q.trim()) return;
    sound.click();
    setMsgs((m) => [...m, { who: "user", text: q }, { who: "orbit", text: answer(q) }]);
    setInput("");
  };
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
        {msgs.map((m, i) => (
          <div key={i} className={`fade-up text-[11px] leading-relaxed p-2.5 ${m.who === "user" ? "ml-6 text-right" : "mr-4"}`}
            style={{
              border: `1px solid ${m.who === "user" ? "rgba(89,183,255,0.35)" : "var(--line)"}`,
              background: m.who === "user" ? "rgba(38,66,98,0.25)" : "rgba(126,160,200,0.05)",
              color: m.who === "user" ? "var(--blue)" : "var(--text)",
            }}>
            {m.who === "orbit" && <span className="mc-label block mb-1" style={{ color: "var(--amber)" }}>ORBIT · FLIGHT ASSISTANT</span>}
            {m.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="px-4 pb-3 pt-2" style={{ borderTop: "1px solid var(--line)" }}>
        <div className="flex flex-wrap gap-1 mb-2">
          {["Why did I fail?", "How much Δv left?", "Will I miss Mars?", "When do I burn?", "How to save fuel?"].map((q) => (
            <button key={q} className="mc-btn !text-[9px] !px-2 !py-1" onClick={() => ask(q)}>{q}</button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask(input)}
            placeholder="ASK ORBIT…"
            className="flex-1 bg-transparent mc-value text-[11px] px-2 py-1.5 outline-none"
            style={{ border: "1px solid var(--line)" }}
          />
          <Btn kind="primary" onClick={() => ask(input)}>SEND</Btn>
        </div>
        <div className="mc-label mt-1.5" style={{ opacity: 0.55 }}>LOCAL PHYSICS GUIDANCE — NO EXTERNAL API, ALL ANSWERS DERIVED FROM SIMULATION STATE</div>
      </div>
    </div>
  );
}

/* ---------------- attempts comparison ---------------- */
export function ComparePanel() {
  const attempts = useSim((s) => s.attempts);
  return (
    <div className="px-4 pb-6">
      <SectionTitle>ATTEMPT LOG</SectionTitle>
      {attempts.length === 0 && <div className="mc-label" style={{ opacity: 0.7 }}>No attempts yet. Finish a mission — every run is logged here for comparison.</div>}
      <table className="w-full text-[10px] mt-2" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr className="mc-label" style={{ textAlign: "left" }}>
            <th className="py-1 pr-2 font-normal">#</th><th className="py-1 pr-2 font-normal">RESULT</th>
            <th className="py-1 pr-2 font-normal">GRADE</th><th className="py-1 pr-2 font-normal">FUEL USED</th>
            <th className="py-1 pr-2 font-normal">TIME</th><th className="py-1 pr-2 font-normal">MCC</th><th className="py-1 font-normal">SCORE</th>
          </tr>
        </thead>
        <tbody>
          {attempts.map((a) => (
            <tr key={a.id} style={{ borderTop: "1px solid var(--line)" }}>
              <td className="mc-value py-1.5 pr-2">{String(a.id).padStart(2, "0")}</td>
              <td className="mc-value py-1.5 pr-2" style={{ color: a.outcome === "SUCCESS" ? "var(--green)" : "var(--red)" }}>{a.outcome}</td>
              <td className="mc-value py-1.5 pr-2" style={{ color: a.grade === "S" ? "var(--amber)" : "var(--text)" }}>{a.grade}</td>
              <td className="mc-value py-1.5 pr-2">{a.fuelUsedPct.toFixed(0)}%</td>
              <td className="mc-value py-1.5 pr-2">{a.timeDays.toFixed(0)}d</td>
              <td className="mc-value py-1.5 pr-2">{a.corrections}</td>
              <td className="mc-value py-1.5">{a.score > 0 ? a.score + "%" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- settings ---------------- */
export function SettingsPanel() {
  const st = useSim();
  const snap = useTele((s) => s.s);
  return (
    <div className="px-4 pb-6">
      <SectionTitle>RENDER QUALITY</SectionTitle>
      <div className="flex gap-1.5">
        {(["CINEMATIC", "BALANCED", "PERFORMANCE"] as const).map((q) => (
          <Btn key={q} kind={st.quality === q ? "on" : ""} onClick={() => { sound.click(); st.setQuality(q); }}>{q}</Btn>
        ))}
      </div>
      <SectionTitle>SCALE MODE</SectionTitle>
      <div className="flex gap-1.5">
        <Btn kind={st.scaleMode === "presentation" ? "on" : ""} onClick={() => { sound.click(); st.setScaleMode("presentation"); }}>PRESENTATION</Btn>
        <Btn kind={st.scaleMode === "realistic" ? "on" : ""} onClick={() => { sound.click(); st.setScaleMode("realistic"); }}>REALISTIC</Btn>
      </div>
      <div className="mc-label mt-1.5" style={{ opacity: 0.7, textTransform: "none", letterSpacing: "0.04em", lineHeight: 1.55 }}>
        {st.scaleMode === "presentation"
          ? "PRESENTATION: distances compressed (r^0.62 power law) so the whole mission is visible. Planet sizes exaggerated. Physics unchanged — only the drawing scale."
          : "REALISTIC: true distance ratios (1 unit = 4,200 km). Planets rendered as enlarged markers — at true scale they would be sub-pixel. Distances are honest; sizes are not."}
      </div>
      <SectionTitle>DISPLAY</SectionTitle>
      <div className="flex flex-wrap gap-1.5">
        <Btn kind={st.showOrbits ? "on" : ""} onClick={() => { sound.click(); st.toggleOrbits(); }}>ORBIT PATHS</Btn>
        <Btn kind={st.showVectors ? "on" : ""} onClick={() => { sound.click(); st.toggleVectors(); }}>FORCE VECTORS</Btn>
        <Btn kind={st.observatory ? "on" : ""} onClick={() => { sound.click(); st.toggleObservatory(); }}>OBSERVATORY GRID</Btn>
        <Btn kind={st.sound ? "on" : ""} onClick={() => { sound.click(); st.toggleSound(); sound.setEnabled(!st.sound); }}>SOUND {st.sound ? "ON" : "OFF"}</Btn>
      </div>
      <SectionTitle accent="var(--amber)">PRESENTATION MODES</SectionTitle>
      <div className="flex flex-wrap gap-1.5">
        <Btn kind={st.expo ? "on" : ""} onClick={() => {
          sound.chime();
          st.setExpo(!st.expo);
          if (!st.expo) {
            st.setPanel(null);
            useSim.getState().pushAlert("EXPO MODE — AUTO-DEMONSTRATION RUNNING · TAKE CONTROL ANY TIME", "info");
          }
        }}>
          {st.expo ? "STOP EXPO MODE" : "START EXPO MODE"}
        </Btn>
        <Btn disabled={!engine.rec.length} onClick={() => {
          sound.click();
          if (engine.beginReplay()) { st.setReplay(true, true); st.setPanel(null); st.setFocus("cinematic"); st.setMultiplier(1000); }
        }}>
          REPLAY LAST MISSION
        </Btn>
      </div>
      <div className="mc-label mt-1.5" style={{ opacity: 0.7, textTransform: "none", letterSpacing: "0.04em" }}>
        EXPO runs the full Earth→Mars mission automatically for judges — pause or grab the controls at any moment.
      </div>
      <SectionTitle>SIMULATION</SectionTitle>
      <Row label="PHASE" value={snap?.phase || "—"} />
      <Row label="INTEGRATOR" value="RK4 · ADAPTIVE Δt" />
      <Row label="GRAVITY MODEL" value="SUN + 8 PLANETS + MOON" />
      <div className="mt-4 mc-label" style={{ opacity: 0.55, lineHeight: 1.7, textTransform: "none", letterSpacing: "0.04em" }}>
        SPACE MISSION SIMULATOR · a Skill Expo project demonstrating physics converted into an interactive numerical simulation. Plan. Launch. Navigate. Survive.
      </div>
    </div>
  );
}

/* ---------------- mission result overlay ---------------- */
export function ResultOverlay({ onDismiss }: { onDismiss: () => void }) {
  const snap = useTele((s) => s.s);
  const setPanel = useSim((s) => s.setPanel);
  const setReplay = useSim((s) => s.setReplay);
  const setFocus = useSim((s) => s.setFocus);
  const res = snap?.result;
  if (!res) return null;
  const ok = res.outcome === "SUCCESS";
  const gradeColor = res.grade === "S" ? "var(--amber)" : res.grade === "A" ? "var(--green)" : res.grade === "B" ? "var(--blue)" : res.grade === "FAILED" ? "var(--red)" : "var(--text)";
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center fade-in" style={{ background: "rgba(3,5,9,0.72)", backdropFilter: "blur(3px)" }}>
      <div className="mc-panel mc-corner px-8 py-7 w-[min(520px,92vw)] text-center fade-up">
        <div className="mc-label tracking-[0.4em]" style={{ color: ok ? "var(--green)" : "var(--red)" }}>
          {ok ? "MISSION ACCOMPLISHED" : "MISSION TERMINATED"}
        </div>
        <div className="font-display font-bold text-3xl md:text-4xl mt-3 tracking-[0.12em]">{ok ? "EARTH → MARS" : res.reason.split("—")[0]}</div>
        <div className="mc-value text-xs mt-2" style={{ color: "var(--dim)" }}>{res.title}</div>
        {ok ? (
          <>
            <div className="flex justify-center gap-8 mt-6">
              <div>
                <div className="mc-label">MISSION SCORE</div>
                <div className="font-display font-bold text-4xl mt-1" style={{ color: gradeColor }}>{res.score}%</div>
                <div className="font-display font-bold text-xl" style={{ color: gradeColor }}>{res.grade}</div>
              </div>
              <div className="text-left">
                <div className="tick-row"><span className="mc-label">TRAVEL TIME</span><span className="mc-value text-[11px]">{fmtDuration(res.travelTime)}</span></div>
                <div className="tick-row"><span className="mc-label">FUEL USED</span><span className="mc-value text-[11px]">{res.fuelUsedPct.toFixed(0)}%</span></div>
                <div className="tick-row"><span className="mc-label">FINAL ORBIT</span><span className="mc-value text-[11px]">{res.finalOrbit}</span></div>
                <div className="tick-row"><span className="mc-label">CORRECTIONS</span><span className="mc-value text-[11px]">{res.corrections}</span></div>
              </div>
            </div>
            <div className="mt-4 space-y-1">
              {res.breakdown.map((b: { label: string; value: number }) => (
                <div key={b.label} className="flex items-center gap-3">
                  <span className="mc-label w-40 text-right">{b.label}</span>
                  <div className="flex-1 h-[3px]" style={{ background: "rgba(126,160,200,0.12)" }}>
                    <div className="h-full" style={{ width: `${b.value}%`, background: gradeColor, animation: "barLoad 0.8s cubic-bezier(0.16,1,0.3,1) both" }} />
                  </div>
                  <span className="mc-value text-[10px] w-9">{b.value}%</span>
                </div>
              ))}
            </div>
            <div className="mt-6 font-display text-sm tracking-[0.3em]" style={{ color: "var(--amber)" }}>CALCULATED FROM PHYSICS</div>
            <div className="mc-label mt-1.5" style={{ opacity: 0.75 }}>“Physics turned into a mission.”</div>
          </>
        ) : (
          <div className="mt-5">
            <div className="mc-value text-[11px] leading-relaxed" style={{ color: "var(--dim)" }}>{res.reason}</div>
            <button className="mc-btn mt-4" onClick={() => { sound.click(); setPanel("orbit"); onDismiss(); }}>ASK ORBIT WHY</button>
          </div>
        )}
        <div className="flex justify-center gap-1.5 mt-6 flex-wrap">
          {engine.rec.length > 4 && (
            <Btn onClick={() => { sound.click(); if (engine.beginReplay()) { setReplay(true, true); setFocus("cinematic"); onDismiss(); } }}>REPLAY MISSION</Btn>
          )}
          <Btn onClick={() => { sound.click(); setPanel("compare"); onDismiss(); }}>COMPARE ATTEMPTS</Btn>
          <Btn kind="primary" onClick={() => {
            sound.click();
            const stt = useSim.getState();
            engine.configure(stt.config, "mission");
            stt.setPhase("PLANNING"); stt.setPanel("planner"); stt.setMultiplier(10); stt.setFocus("craft");
            onDismiss();
          }}>NEW MISSION</Btn>
          <Btn onClick={onDismiss}>CONTINUE</Btn>
        </div>
      </div>
    </div>
  );
}
