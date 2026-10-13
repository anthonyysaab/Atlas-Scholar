import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-border px-4 py-4 last:border-b-0">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-weak">{title}</h3>
        {description ? <p className="mt-1 text-xs leading-relaxed text-text-weak">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-4 text-xs">
      <span className="min-w-0">
        <span className="block text-text">{label}</span>
        {hint ? <span className="mt-0.5 block text-text-weak">{hint}</span> : null}
      </span>
      <span className="flex shrink-0 items-center gap-1">{children}</span>
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`rounded border border-border bg-bg-subtle px-2 py-1 text-xs text-text outline-none focus:border-accent ${
        props.className ?? ""
      }`}
    />
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(event) => {
        const next = Number(event.target.value);
        if (Number.isFinite(next)) onChange(next);
      }}
      className="w-24 rounded border border-border bg-bg-subtle px-2 py-1 text-right text-xs text-text outline-none focus:border-accent"
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`rounded border border-border bg-bg-subtle px-2 py-1 text-xs text-text outline-none focus:border-accent ${
        props.className ?? ""
      }`}
    />
  );
}

export function Button({
  variant = "default",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "danger" }) {
  const styles: Record<string, string> = {
    default: "border-border text-text hover:bg-bg-subtle",
    primary: "border-accent bg-accent/15 text-text hover:bg-accent/25",
    danger: "border-danger/50 text-danger hover:bg-danger/10"
  };
  return (
    <button
      {...props}
      className={`rounded border px-2 py-1 text-xs disabled:opacity-40 ${styles[variant]} ${props.className ?? ""}`}
    />
  );
}
