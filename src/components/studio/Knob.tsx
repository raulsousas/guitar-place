import { useId } from 'react';

interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Texto exibido abaixo do mostrador (ex.: "-12 dB"). */
  format: (v: number) => string;
  onChange: (v: number) => void;
  testId: string;
  disabled?: boolean;
}

/**
 * Controle giratório apenas visual: o controle real é um `<input type="range">` (teclado, leitor de
 * tela e toque funcionam como em qualquer slider). O mostrador mostra o mesmo valor, de -135 a +135 graus.
 */
export function Knob({ label, value, min, max, step, format, onChange, testId, disabled }: KnobProps) {
  const id = useId();
  const frac = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
  const angle = -135 + 270 * frac;
  const rad = ((angle - 90) * Math.PI) / 180;
  const cx = 28;
  const cy = 28;
  return (
    <div className={disabled ? 'knob disabled' : 'knob'} data-testid={`${testId}-knob`}>
      <svg viewBox="0 0 56 56" width={56} height={56} aria-hidden="true">
        <circle cx={cx} cy={cy} r={22} className="knob-body" />
        <circle cx={cx} cy={cy} r={25} className="knob-ring" strokeDasharray={`${frac * 118} 200`} transform="rotate(135 28 28)" />
        <line x1={cx} y1={cy} x2={cx + Math.cos(rad) * 17} y2={cy + Math.sin(rad) * 17} className="knob-pointer" />
      </svg>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        data-testid={testId}
      />
      <output data-testid={`${testId}-value`}>{format(value)}</output>
    </div>
  );
}
