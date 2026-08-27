/* ============================================================
   SOUND DESIGN — pure WebAudio synthesis. No samples.
   Engine rumble (filtered noise + detuned oscillators),
   UI ticks, alerts, control-room ambience bed.
   ============================================================ */

class SoundSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private ambGain: GainNode | null = null;
  private targetEngine = 0;
  enabled = true;

  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      try {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.55;
        this.master.connect(this.ctx.destination);
        this.startEngineBed();
        this.startAmbience();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  private noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private startEngineBed() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = 240;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, 2);
    src.loop = true;
    src.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    src.start();
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 46;
    const osc2 = ctx.createOscillator();
    osc2.type = "sawtooth";
    osc2.frequency.value = 47.3;
    const og = ctx.createGain(); og.gain.value = 0.4;
    osc.connect(og); osc2.connect(og);
    og.connect(this.engineFilter);
    osc.start(); osc2.start();
  }

  private startAmbience() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    this.ambGain = ctx.createGain();
    this.ambGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 180;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, 3);
    src.loop = true;
    src.connect(lp); lp.connect(this.ambGain);
    this.ambGain.connect(this.master);
    src.start();
    const hum = ctx.createOscillator();
    hum.type = "sine"; hum.frequency.value = 57;
    const hg = ctx.createGain(); hg.gain.value = 0.05;
    hum.connect(hg); hg.connect(this.ambGain);
    hum.start();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.55 : 0;
  }

  /* call every frame: level 0..1, speedFactor raises rumble pitch */
  engine(level: number, speedFactor = 1) {
    this.targetEngine = level;
    if (!this.ctx || !this.engineGain || !this.engineFilter) return;
    const t = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(level * 0.5, t, 0.12);
    this.engineFilter.frequency.setTargetAtTime(160 + level * 420 * speedFactor, t, 0.2);
    if (this.ambGain) this.ambGain.gain.setTargetAtTime(this.enabled ? 0.12 : 0, t, 0.5);
  }

  click() {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.enabled) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.value = 1900;
    g.gain.setValueAtTime(0.05, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.06);
    o.connect(g); g.connect(this.master);
    o.start(); o.stop(ctx.currentTime + 0.07);
  }

  chime() {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.enabled) return;
    [660, 990].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const t0 = ctx.currentTime + i * 0.09;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.07, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      o.connect(g); g.connect(this.master!);
      o.start(t0); o.stop(t0 + 0.55);
    });
  }

  alarm() {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.enabled) return;
    [0, 0.22].forEach((off) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(520, ctx.currentTime + off);
      o.frequency.linearRampToValueAtTime(330, ctx.currentTime + off + 0.18);
      g.gain.setValueAtTime(0.06, ctx.currentTime + off);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + off + 0.2);
      o.connect(g); g.connect(this.master!);
      o.start(ctx.currentTime + off); o.stop(ctx.currentTime + off + 0.22);
    });
  }

  countdownBeep(final: boolean) {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.enabled) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = final ? 880 : 440;
    g.gain.setValueAtTime(0.08, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (final ? 0.5 : 0.12));
    o.connect(g); g.connect(this.master);
    o.start(); o.stop(ctx.currentTime + (final ? 0.55 : 0.14));
  }
}

export const sound = new SoundSystem();
