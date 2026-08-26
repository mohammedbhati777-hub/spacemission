import { useEffect, useState } from "react";
import { useSim } from "../store";
import { engine } from "../lib/engine";
import { sound } from "../lib/audio";

const STEPS = [
  { at: 0.7, key: "online" },
  { at: 2.6, key: "dest" },
  { at: 4.6, key: "obj" },
  { at: 6.6, key: "title" },
  { at: 7.6, key: "btn" },
];

export function Intro() {
  const begin = useSim((s) => s.begin);
  const setFocus = useSim((s) => s.setFocus);
  const setPanel = useSim((s) => s.setPanel);
  const [elapsed, setElapsed] = useState(0);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      setElapsed((performance.now() - t0) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const show = (key: string) => elapsed >= (STEPS.find((s) => s.key === key)?.at || 0);

  const start = () => {
    sound.click();
    setLeaving(true);
    setTimeout(() => {
      begin();
      setFocus("craft");
      setPanel("planner");
    }, 1100);
  };

  if (elapsed > 20 && leaving) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center transition-opacity duration-1000"
      style={{ background: "radial-gradient(ellipse at 50% 60%, #060a12 0%, #020306 70%)", opacity: leaving ? 0 : 1, pointerEvents: leaving ? "none" : "auto" }}
      onClick={() => !show("btn") && setElapsed(8)}
    >
      {/* faint star specks above the canvas veil */}
      <div className="absolute inset-0 overflow-hidden" style={{ opacity: Math.min(1, elapsed / 2.4) }}>
        {Array.from({ length: 70 }).map((_, i) => (
          <span
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              left: `${(i * 37.7) % 100}%`, top: `${(i * 61.3) % 100}%`,
              width: i % 7 === 0 ? 2 : 1, height: i % 7 === 0 ? 2 : 1,
              opacity: 0.15 + ((i * 13) % 50) / 100,
              animation: `pulseSoft ${2 + (i % 5)}s ease-in-out ${i * 0.13}s infinite`,
            }}
          />
        ))}
        <div
          className="absolute rounded-full"
          style={{
            left: "50%", top: "64%", width: 340, height: 340, transform: "translate(-50%,-50%)",
            background: "radial-gradient(circle, rgba(255,170,70,0.5) 0%, rgba(255,120,40,0.12) 35%, transparent 65%)",
            opacity: Math.min(1, Math.max(0, (elapsed - 1.2) / 2)),
            filter: "blur(6px)",
          }}
        />
      </div>

      <div className="relative text-center px-6" style={{ minHeight: 340 }}>
        {show("online") && (
          <div className="fade-up mb-10">
            <div className="mc-label tracking-[0.4em]" style={{ color: "var(--blue)" }}>MISSION CONTROL ONLINE</div>
            <div className="mt-2 mx-auto w-40 h-px" style={{ background: "linear-gradient(90deg, transparent, var(--blue), transparent)" }} />
          </div>
        )}
        {show("dest") && (
          <div className="fade-up mb-8">
            <div className="mc-label mb-2">DESTINATION</div>
            <div className="font-display font-bold text-4xl md:text-5xl" style={{ color: "#e8926a", letterSpacing: "0.24em" }}>MARS</div>
          </div>
        )}
        {show("obj") && (
          <div className="fade-up mb-12">
            <div className="mc-label mb-2">MISSION OBJECTIVE</div>
            <div className="font-display text-lg md:text-xl font-light" style={{ color: "var(--text)", letterSpacing: "0.14em" }}>ESTABLISH A STABLE ORBIT</div>
          </div>
        )}
        {show("title") && (
          <div className="fade-up">
            <h1 className="letter-in font-display font-bold text-3xl md:text-5xl" style={{ color: "var(--text)" }}>
              SPACE MISSION SIMULATOR
            </h1>
            <div className="mt-3 mc-value text-xs md:text-sm" style={{ color: "var(--dim)", letterSpacing: "0.3em" }}>
              PLAN. LAUNCH. NAVIGATE. SURVIVE.
            </div>
          </div>
        )}
        {show("btn") && (
          <div className="fade-up mt-10 flex flex-col items-center gap-4">
            <button className="mc-btn primary big" onClick={start}>BEGIN MISSION</button>
            <div className="mc-label" style={{ opacity: 0.7 }}>
              A REAL-PHYSICS ORBITAL MECHANICS SIMULATION
            </div>
          </div>
        )}
      </div>
      {!show("btn") && (
        <div className="absolute bottom-10 mc-label blink" style={{ opacity: 0.5 }}>CLICK TO SKIP SEQUENCE</div>
      )}
    </div>
  );
}

export function beginMissionExternal() {
  engine.startCountdown();
}
