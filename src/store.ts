import { create } from "zustand";
import { MissionConfig, Phase, defaultConfig } from "./lib/engine";

export type FocusTarget =
  | "sun" | "earth" | "mars" | "craft" | "free" | "top" | "cinematic"
  | "mercury" | "venus" | "jupiter" | "saturn" | "uranus" | "neptune";
export type PanelId = "planner" | "telemetry" | "graphs" | "energy" | "physics" | "orbit" | "compare" | "settings" | "flight" | null;

export interface AttemptSummary {
  id: number; outcome: string; grade: string; fuelUsedPct: number;
  timeDays: number; corrections: number; score: number;
}
export interface AlertMsg { id: number; text: string; level: "info" | "warn" | "alert" | "success" }

interface SimState {
  introDone: boolean;
  mode: "mission" | "orbitlab" | "sandbox";
  config: MissionConfig;
  multiplier: number;
  paused: boolean;
  quality: "CINEMATIC" | "BALANCED" | "PERFORMANCE";
  sound: boolean;
  scaleMode: "presentation" | "realistic";
  observatory: boolean;
  showOrbits: boolean;
  showVectors: boolean;
  focus: FocusTarget;
  panel: PanelId;
  phase: Phase;
  alerts: AlertMsg[];
  attempts: AttemptSummary[];
  achievements: string[];
  expo: boolean;
  replay: boolean;
  replayPlaying: boolean;
  mobileManual: boolean;
  manual: boolean;
  stepTick: number;

  begin: () => void;
  setConfig: (c: MissionConfig) => void;
  setMultiplier: (m: number) => void;
  togglePause: () => void;
  setPaused: (p: boolean) => void;
  setQuality: (q: "CINEMATIC" | "BALANCED" | "PERFORMANCE") => void;
  toggleSound: () => void;
  setScaleMode: (s: "presentation" | "realistic") => void;
  toggleObservatory: () => void;
  toggleOrbits: () => void;
  toggleVectors: () => void;
  setFocus: (f: FocusTarget) => void;
  setPanel: (p: PanelId) => void;
  setPhase: (p: Phase) => void;
  setMode: (m: "mission" | "orbitlab" | "sandbox") => void;
  pushAlert: (text: string, level: AlertMsg["level"]) => void;
  dropAlert: (id: number) => void;
  pushAttempt: (a: AttemptSummary) => void;
  pushAchievement: (a: string) => void;
  setExpo: (e: boolean) => void;
  setReplay: (r: boolean, playing?: boolean) => void;
  setMobileManual: (m: boolean) => void;
  setManual: (m: boolean) => void;
  requestStep: () => void;
}

let alertId = 1;

/* high-frequency telemetry channel (8-12 Hz) — kept separate so the
   HUD can refresh without touching low-frequency UI state */
export const useTele = create<{ s: any; set: (v: any) => void }>((set) => ({
  s: null,
  set: (v) => set({ s: v }),
}));

export const useSim = create<SimState>((set) => ({
  introDone: false,
  mode: "mission",
  config: defaultConfig(),
  multiplier: 10,
  paused: false,
  quality: "BALANCED",
  sound: true,
  scaleMode: "presentation",
  observatory: false,
  showOrbits: true,
  showVectors: false,
  focus: "free",
  panel: null,
  phase: "PLANNING",
  alerts: [],
  attempts: [],
  achievements: [],
  expo: false,
  replay: false,
  replayPlaying: true,
  mobileManual: false,
  manual: false,
  stepTick: 0,

  begin: () => set({ introDone: true }),
  setConfig: (c) => set({ config: c }),
  setMultiplier: (m) => set({ multiplier: m }),
  togglePause: () => set((s) => ({ paused: !s.paused })),
  setPaused: (p) => set({ paused: p }),
  setQuality: (q) => set({ quality: q }),
  toggleSound: () => set((s) => ({ sound: !s.sound })),
  setScaleMode: (sm) => set({ scaleMode: sm }),
  toggleObservatory: () => set((s) => ({ observatory: !s.observatory, showVectors: !s.observatory ? true : s.showVectors })),
  toggleOrbits: () => set((s) => ({ showOrbits: !s.showOrbits })),
  toggleVectors: () => set((s) => ({ showVectors: !s.showVectors })),
  setFocus: (f) => set({ focus: f }),
  setPanel: (p) => set((s) => ({ panel: s.panel === p ? null : p })),
  setPhase: (p) => set({ phase: p }),
  setMode: (m) => set({ mode: m }),
  pushAlert: (text, level) => set((s) => ({ alerts: [...s.alerts.slice(-4), { id: alertId++, text, level }] })),
  dropAlert: (id) => set((s) => ({ alerts: s.alerts.filter((a) => a.id !== id) })),
  pushAttempt: (a) => set((s) => ({ attempts: [...s.attempts, a] })),
  pushAchievement: (a) => set((s) => ({ achievements: s.achievements.includes(a) ? s.achievements : [...s.achievements, a] })),
  setExpo: (e) => set({ expo: e }),
  setReplay: (r, playing = true) => set({ replay: r, replayPlaying: playing }),
  setMobileManual: (m) => set({ mobileManual: m }),
  setManual: (m) => set({ manual: m }),
  requestStep: () => set((s) => ({ stepTick: s.stepTick + 1, paused: true })),
}));
