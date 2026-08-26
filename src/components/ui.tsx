import { ReactNode } from "react";

export function SectionTitle({ children, accent }: { children: ReactNode; accent?: string }) {
  return (
    <div className="flex items-center gap-2 mt-4 mb-2 first:mt-0">
      <span className="w-1 h-3" style={{ background: accent || "var(--blue)" }} />
      <span className="mc-label" style={{ color: "var(--dim)" }}>{children}</span>
      <span className="flex-1 h-px" style={{ background: "var(--line)" }} />
    </div>
  );
}

export function Row({ label, value, color, warn }: { label: string; value: ReactNode; color?: string; warn?: boolean }) {
  return (
    <div className="tick-row">
      <span className="mc-label">{label}</span>
      <span className={`mc-value text-[11px] ${warn ? "pulse-warn" : ""}`} style={{ color: color || "var(--text)" }}>{value}</span>
    </div>
  );
}

export function Bar({ label, value, max, color, warn }: { label: string; value: number; max: number; color?: string; warn?: boolean }) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(max, 1e-9)) * 100));
  return (
    <div className="mb-1.5">
      <div className="flex justify-between items-baseline mb-0.5">
        <span className="mc-label">{label}</span>
        <span className="mc-value text-[10px]" style={{ color: color || "var(--text)" }}>{Math.round(pct)}%</span>
      </div>
      <div className={`h-[3px] w-full ${warn ? "pulse-warn" : ""}`} style={{ background: "rgba(126,160,200,0.12)" }}>
        <div className="h-full transition-all duration-300" style={{ width: `${pct}%`, background: color || "var(--blue)" }} />
      </div>
    </div>
  );
}

export function SliderRow(props: {
  label: string; value: number; min: number; max: number; step?: number;
  unit?: string; fmt?: (n: number) => string; amber?: boolean; onChange: (n: number) => void;
}) {
  const display = props.fmt ? props.fmt(props.value) : `${props.value}${props.unit || ""}`;
  return (
    <div className="mb-2.5">
      <div className="flex justify-between items-baseline">
        <span className="mc-label">{props.label}</span>
        <span className="mc-value text-[11px]" style={{ color: props.amber ? "var(--amber)" : "var(--blue)" }}>{display}</span>
      </div>
      <input
        type="range"
        className={`mc-range ${props.amber ? "amber" : ""}`}
        min={props.min} max={props.max} step={props.step || 1} value={props.value}
        onChange={(e) => props.onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

export function Btn(props: { children: ReactNode; onClick?: () => void; kind?: "" | "primary" | "danger" | "on"; disabled?: boolean; big?: boolean; title?: string }) {
  const cls = ["mc-btn", props.kind === "primary" ? "primary" : "", props.kind === "danger" ? "danger" : "", props.kind === "on" ? "on" : "", props.big ? "big" : ""].join(" ");
  return (
    <button className={cls} onClick={props.onClick} disabled={props.disabled} title={props.title}>
      {props.children}
    </button>
  );
}
