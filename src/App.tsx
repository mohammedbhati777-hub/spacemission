import { useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { SolarSystem } from "./three/SolarSystemScene";
import { engine, defaultConfig, ACHIEVEMENTS } from "./lib/engine";
import { useSim, useTele } from "./store";
import { sound } from "./lib/audio";
import { HUD } from "./components/HUD";
import { Intro } from "./components/Intro";
import { PlannerPanel } from "./components/PlannerPanel";
import { TelemetryPanel, GraphsPanel, EnergyPanel } from "./components/DataPanels";
import { DrawerHost, PhysicsPanel, OrbitPanel, ComparePanel, SettingsPanel, ResultOverlay } from "./components/InfoPanels";
import { DAY, PLANETS, clamp, vCross, vNorm, vScale, vSub } from "./lib/constants";
import { launchWindow } from "./lib/orbital";

const angleAt = (id: string, day: number) => {
  const p = PLANETS.find((b) => b.id === id)!;
  return p.phase0 + (2 * Math.PI * day) / p.periodDays;
};
const optimalDay = (() => {
  let best = 35, bq = -1;
  for (let d = 0; d <= 1600; d += 2) {
    const w = launchWindow(angleAt("earth", d), angleAt("mars", d));
    if (w.quality > bq) { bq = w.quality; best = d; }
  }
  return best;
})();

/* expo sequencer state (module level — survives re-renders) */
const expo = { stage: "", t: 0, tmi: false, skip: false, moi: false };

export default function App() {
  const quality = useSim((s) => s.quality);
  const introDone = useSim((s) => s.introDone);
  const [dismissed, setDismissed] = useState(false);
  const replayRef = useRef(0);
  const recordedResult = useRef(false);
  const teleSet = useTele((s) => s.set);

  /* ---------------- main loop ---------------- */
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let lastStep = useSim.getState().stepTick;
    const keys = new Set<string>();
    const kd = (e: KeyboardEvent) => keys.add(e.key.toLowerCase());
    const ku = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      keys.delete(k);
      if (k === " ") engine.stopBurn();
    };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const rdt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const st = useSim.getState();

      /* manual flight steering */
      if (st.manual && !st.replay) {
        const c = engine.craft;
        const rate = 1.6 * rdt;
        const att = { ...c.attitude };
        const up = vNorm(att);
        const right = vNorm(vCross(up, { x: 0, y: 1, z: 0.0001 }));
        const fwd = vNorm(vCross(right, up));
        let a = { ...att };
        if (keys.has("w")) a = vSub(a, vScale(fwd, rate));
        if (keys.has("s")) a = { x: a.x + fwd.x * rate, y: a.y + fwd.y * rate, z: a.z + fwd.z * rate };
        if (keys.has("a")) a = vSub(a, vScale(right, rate));
        if (keys.has("d")) a = { x: a.x + right.x * rate, y: a.y + right.y * rate, z: a.z + right.z * rate };
        c.attitude = vNorm(a);
        if (keys.has("z")) c.throttle = clamp(c.throttle + rdt, 0, 1);
        if (keys.has("x")) c.throttle = clamp(c.throttle - rdt, 0, 1);
        if (keys.has(" ") && !c.burning) engine.startBurn("attitude", null, Math.max(c.throttle, 0.6));
      }

      /* step frame */
      if (st.stepTick !== lastStep) {
        lastStep = st.stepTick;
        engine.update(1 / 30, 30, false);
      }

      /* replay playback */
      if (st.replay) {
        if (st.replayPlaying) {
          replayRef.current += rdt * 0.045;
          if (replayRef.current >= 1) {
            replayRef.current = 1;
            st.setReplay(true, false);
          }
          engine.setReplayT(replayRef.current);
        }
      } else if (introDone) {
        engine.update(rdt, st.multiplier, st.paused);
      }

      /* events → alerts / sound / achievements */
      for (const ev of engine.drainEvents()) {
        st.pushAlert(ev.text, ev.level);
        if (ev.level === "alert") sound.alarm();
        else if (ev.level === "success") sound.chime();
      }
      for (const a of engine.achievements) {
        const name = ACHIEVEMENTS[a];
        if (name && !st.achievements.includes(name)) st.pushAchievement(name);
      }

      /* engine audio */
      const burning = engine.craft.burning && engine.stageFuel[engine.activeStage] > 0;
      sound.engine(burning ? 0.25 + engine.craft.throttle * 0.75 : 0, 1);

      /* throttled snapshot + sequencers */
      acc += rdt;
      if (acc > 0.12) {
        acc = 0;
        const snap = engine.snapshot();
        teleSet(snap);
        if (snap.phase !== st.phase) st.setPhase(snap.phase);
        engine.setMultiplier(st.multiplier);

        /* record attempt once per mission */
        if (snap.result && !recordedResult.current) {
          recordedResult.current = true;
          st.pushAttempt({
            id: st.attempts.length + 1,
            outcome: snap.result.outcome,
            grade: snap.result.grade,
            fuelUsedPct: snap.result.fuelUsedPct,
            timeDays: snap.result.travelTime / DAY,
            corrections: snap.result.corrections,
            score: snap.result.score,
          });
        }
        if (!snap.result) recordedResult.current = false;

        /* expo sequencer */
        if (st.expo) stepExpo(st, snap.phase);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); };
  }, [introDone, teleSet]);

  const result = useTele((s) => s.s?.result ?? null);
  const phaseNow = useTele((s) => s.s?.phase ?? "");
  const replay = useSim((s) => s.replay);
  const replayPlaying = useSim((s) => s.replayPlaying);
  const setReplay = useSim((s) => s.setReplay);
  const showResult = !!result && !dismissed && ["FAILED", "MARS_ORBIT", "LANDED"].includes(phaseNow);

  return (
    <div className="w-full h-full relative" style={{ background: "var(--bg)" }}>
      <Canvas
        dpr={quality === "CINEMATIC" ? [1, 2] : quality === "BALANCED" ? [1, 1.5] : [1, 1]}
        camera={{ fov: 50, near: 0.05, far: 40000, position: [0, 240, 560] }}
        gl={{ antialias: quality !== "PERFORMANCE", powerPreference: "high-performance" }}
      >
        <color attach="background" args={["#020409"]} />
        <SolarSystem />
      </Canvas>

      {/* cinematic veils */}
      <div className="absolute inset-0 overlay-vignette z-10" />
      {quality === "CINEMATIC" && <div className="absolute inset-0 overlay-grid z-10" />}

      {!introDone && <Intro />}
      <HUD />
      <DrawerHost>
        {useSim.getState().panel === "planner" && <PlannerPanel />}
        {useSim.getState().panel === "telemetry" && <TelemetryPanel />}
        {useSim.getState().panel === "graphs" && <GraphsPanel />}
        {useSim.getState().panel === "energy" && <EnergyPanel />}
        {useSim.getState().panel === "physics" && <PhysicsPanel />}
        {useSim.getState().panel === "orbit" && <OrbitPanel />}
        {useSim.getState().panel === "compare" && <ComparePanel />}
        {useSim.getState().panel === "settings" && <SettingsPanel />}
      </DrawerHost>

      {/* replay bar */}
      {replay && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 mc-panel mc-corner px-4 py-2.5 flex items-center gap-3 pointer-events-auto">
          <span className="mc-label pulse-soft" style={{ color: "var(--red)" }}>● REPLAY</span>
          <button className="mc-btn !p-1.5" onClick={() => { sound.click(); setReplay(true, !replayPlaying); }}>
            {replayPlaying ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M5 4h5v16H5zm9 0h5v16h-5z" /></svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l14 8-14 8z" /></svg>
            )}
          </button>
          <div className="w-44 h-[3px]" style={{ background: "rgba(126,160,200,0.15)" }}>
            <div className="h-full" style={{ width: `${replayRef.current * 100}%`, background: "var(--red)" }} />
          </div>
          <button className="mc-btn !py-1 !px-2" onClick={() => { sound.click(); engine.endReplay(); setReplay(false, false); replayRef.current = 0; }}>EXIT</button>
        </div>
      )}

      {showResult && <ResultOverlay onDismiss={() => setDismissed(true)} />}
      {dismissed && result && ["FAILED", "MARS_ORBIT", "LANDED"].includes(phaseNow) && (
        <button className="absolute top-16 right-3 z-30 mc-btn" onClick={() => setDismissed(false)}>MISSION REPORT</button>
      )}

      {/* touch burn control */}
      <TouchBurn />
    </div>
  );
}

/* ---------------- expo sequencer ---------------- */
function stepExpo(st: ReturnType<typeof useSim.getState>, phase: string) {
  const now = performance.now();
  if (expo.stage !== phase) {
    expo.stage = phase; expo.t = now;
    if (phase === "PLANNING") { expo.tmi = false; expo.skip = false; expo.moi = false; }
    return;
  }
  const waited = (now - expo.t) / 1000;
  switch (phase) {
    case "PLANNING":
      if (waited > 1.2) {
        const cfg = defaultConfig();
        cfg.launchDay = optimalDay;
        st.setConfig(cfg);
        engine.configure(cfg, "mission");
        st.setMultiplier(1);
        st.setFocus("craft");
        st.setPanel(null);
        engine.startCountdown();
        st.pushAlert("EXPO · OPTIMAL WINDOW SELECTED — DAY " + optimalDay, "info");
      }
      break;
    case "ASCENT":
      st.setMultiplier(engine.activeStage === 0 ? 20 : engine.activeStage === 1 ? 60 : 250);
      break;
    case "EARTH_ORBIT":
      if (waited > 2.4 && !expo.tmi) {
        expo.tmi = true;
        engine.executeRecommended();
        st.setMultiplier(2000);
        st.setFocus("cinematic");
        st.pushAlert("EXPO · TRANSMARS INJECTION UNDERWAY", "info");
      }
      break;
    case "TRANSFER":
      if (waited > 2.0 && !expo.skip) {
        expo.skip = true;
        engine.skipToEvent(700);
        st.setMultiplier(10000);
        st.pushAlert("EXPO · TIME COMPRESSION — CRUISE TO MARS", "info");
      }
      break;
    case "MARS_APPROACH":
      st.setMultiplier(100);
      st.setFocus("mars");
      if (waited > 2.5 && !expo.moi) {
        expo.moi = true;
        engine.executeRecommended();
        st.pushAlert("EXPO · MARS ORBIT INSERTION — BURN QUEUED FOR PERIAPSIS", "info");
      }
      break;
    case "MARS_ORBIT":
      if (waited > 2) {
        st.setMultiplier(100);
        st.setFocus("cinematic");
        st.setExpo(false);
      }
      break;
    case "FAILED":
      st.setExpo(false);
      break;
    default:
      break;
  }
}

/* ---------------- mobile burn button ---------------- */
function TouchBurn() {
  const manual = useSim((s) => s.manual);
  const isTouch = typeof window !== "undefined" && "ontouchstart" in window;
  if (!isTouch || !manual || !introDoneLite()) return null;
  return (
    <button
      className="absolute bottom-24 right-4 z-30 mc-btn primary !px-6 !py-5 !text-sm pointer-events-auto"
      style={{ borderRadius: "50%", width: 74, height: 74 }}
      onPointerDown={() => engine.startBurn("attitude", null, Math.max(engine.craft.throttle, 0.8))}
      onPointerUp={() => engine.stopBurn()}
      onPointerLeave={() => engine.stopBurn()}
    >
      BURN
    </button>
  );
}
function introDoneLite() {
  return useSim.getState().introDone && useSim.getState().phase !== "PLANNING";
}
