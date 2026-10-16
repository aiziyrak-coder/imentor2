/**
 * Rektor hisobotining vizual qurilmalari (2026-10-15).
 *
 * Rektor: "infografika, ranglar, effektlar yo'q — zamonaviy, jozibador
 * qiling". Bu yerda hamma sahifa ishlatadigan bo'laklar: halqa diagramma,
 * ko'rsatkich kartasi, o'sish belgisi, gradientli yo'lak, ustunli grafik,
 * avatar va baho nishoni. Tashqi kutubxona yo'q — faqat SVG va CSS.
 *
 * Rang sinflari TO'LIQ yozilgan: Tailwind `bg-${tone}-500` kabi yasalgan
 * nomlarni yig'maydi.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Lightbulb, Minus, type LucideIcon } from 'lucide-react';
import './rector.css';

export type Tone = 'indigo' | 'violet' | 'sky' | 'emerald' | 'amber' | 'orange' | 'rose' | 'slate' | 'teal';

/** Har rang uchun to'liq sinflar. */
export const TONE: Record<
  Tone,
  { chip: string; soft: string; text: string; bar: string; ring: [string, string]; dot: string }
> = {
  indigo: {
    chip: 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-indigo-500/30',
    soft: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
    text: 'text-indigo-700',
    bar: 'bg-gradient-to-r from-indigo-500 to-violet-500',
    ring: ['#6366f1', '#8b5cf6'],
    dot: 'bg-indigo-500',
  },
  violet: {
    chip: 'bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-violet-500/30',
    soft: 'bg-violet-50 text-violet-700 ring-violet-200',
    text: 'text-violet-700',
    bar: 'bg-gradient-to-r from-violet-500 to-fuchsia-500',
    ring: ['#8b5cf6', '#d946ef'],
    dot: 'bg-violet-500',
  },
  sky: {
    chip: 'bg-gradient-to-br from-sky-400 to-blue-600 text-white shadow-sky-500/30',
    soft: 'bg-sky-50 text-sky-700 ring-sky-200',
    text: 'text-sky-700',
    bar: 'bg-gradient-to-r from-sky-400 to-blue-500',
    ring: ['#38bdf8', '#2563eb'],
    dot: 'bg-sky-500',
  },
  teal: {
    chip: 'bg-gradient-to-br from-teal-400 to-cyan-600 text-white shadow-teal-500/30',
    soft: 'bg-teal-50 text-teal-700 ring-teal-200',
    text: 'text-teal-700',
    bar: 'bg-gradient-to-r from-teal-400 to-cyan-500',
    ring: ['#2dd4bf', '#0891b2'],
    dot: 'bg-teal-500',
  },
  emerald: {
    chip: 'bg-gradient-to-br from-emerald-400 to-green-600 text-white shadow-emerald-500/30',
    soft: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    text: 'text-emerald-700',
    bar: 'bg-gradient-to-r from-emerald-400 to-green-500',
    ring: ['#34d399', '#16a34a'],
    dot: 'bg-emerald-500',
  },
  amber: {
    chip: 'bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-amber-500/30',
    soft: 'bg-amber-50 text-amber-800 ring-amber-200',
    text: 'text-amber-700',
    bar: 'bg-gradient-to-r from-amber-400 to-orange-500',
    ring: ['#fbbf24', '#f97316'],
    dot: 'bg-amber-500',
  },
  orange: {
    chip: 'bg-gradient-to-br from-orange-400 to-red-500 text-white shadow-orange-500/30',
    soft: 'bg-orange-50 text-orange-800 ring-orange-200',
    text: 'text-orange-700',
    bar: 'bg-gradient-to-r from-orange-300 to-orange-500',
    ring: ['#fdba74', '#f97316'],
    dot: 'bg-orange-400',
  },
  rose: {
    chip: 'bg-gradient-to-br from-rose-500 to-pink-600 text-white shadow-rose-500/30',
    soft: 'bg-rose-50 text-rose-700 ring-rose-200',
    text: 'text-rose-700',
    bar: 'bg-gradient-to-r from-rose-500 to-pink-500',
    ring: ['#f43f5e', '#db2777'],
    dot: 'bg-rose-500',
  },
  slate: {
    chip: 'bg-gradient-to-br from-slate-500 to-slate-700 text-white shadow-slate-500/30',
    soft: 'bg-slate-100 text-slate-700 ring-slate-200',
    text: 'text-slate-700',
    bar: 'bg-gradient-to-r from-slate-400 to-slate-500',
    ring: ['#94a3b8', '#475569'],
    dot: 'bg-slate-400',
  },
};

const UZ_MONTHS = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'];

/**
 * "2026-10-15" yoki to'liq vaqt → "15-okt".
 *
 * Brauzerlarning `uz-UZ` qisqa oy nomlari yo'q: Chrome "M10 15" deb
 * chiqaradi (2026-10-15 harness'da ko'rildi), shuning uchun oy nomlari
 * shu yerda.
 */
export function uzDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()}-${UZ_MONTHS[d.getMonth()]}`;
}

/** Foizga qarab rang: 70+ yashil, 40+ sariq, qolgani qizil. */
export function toneOf(percent: number | null | undefined, good = 70, warn = 40): Tone {
  if (percent === null || percent === undefined) return 'slate';
  if (percent >= good) return 'emerald';
  if (percent >= warn) return 'amber';
  return 'rose';
}

/** Testlarda animatsiya yo'q: raqam darhol oxirgi qiymatda turadi. */
const ANIMATE =
  import.meta.env.MODE !== 'test' &&
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Raqam 0 dan qiymatigacha "sanab" chiqadi. */
export function CountUp({
  value,
  suffix = '',
  duration = 900,
  format = (n: number) => n.toLocaleString('ru-RU').replace(/,/g, ' '),
}: {
  value: number;
  suffix?: string;
  duration?: number;
  format?: (n: number) => string;
}) {
  const [shown, setShown] = useState(ANIMATE ? 0 : value);
  const from = useRef(0);
  useEffect(() => {
    if (!ANIMATE) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const base = from.current;
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(base + (value - base) * eased));
      if (t < 1) frame = requestAnimationFrame(step);
      else from.current = value;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return (
    <>
      {format(shown)}
      {suffix}
    </>
  );
}

/** Halqa diagramma — foiz gradient bilan to'ladi. */
export function Ring({
  value,
  size = 132,
  stroke = 12,
  tone = 'indigo',
  track = 'rgba(148,163,184,0.18)',
  children,
}: {
  value: number | null;
  size?: number;
  stroke?: number;
  tone?: Tone;
  track?: string;
  children?: ReactNode;
}) {
  const id = useId().replace(/:/g, '');
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value ?? 0));
  const [drawn, setDrawn] = useState(ANIMATE ? 0 : pct);
  useEffect(() => {
    if (!ANIMATE) {
      setDrawn(pct);
      return;
    }
    const t = window.setTimeout(() => setDrawn(pct), 60);
    return () => window.clearTimeout(t);
  }, [pct]);
  const [a, b] = TONE[tone].ring;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={`rx-ring-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={a} />
            <stop offset="100%" stopColor={b} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#rx-ring-${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - drawn / 100)}
          style={{ transition: 'stroke-dashoffset 1100ms cubic-bezier(0.2,0.8,0.2,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

/** O'tgan davrga nisbatan o'zgarish: ↑ +12 / ↓ −5. */
export function Delta({
  now,
  before,
  unit = '',
  invert = false,
  dark = false,
  title,
}: {
  now: number | null | undefined;
  before: number | null | undefined;
  unit?: string;
  /** `true` — kamayish yaxshi (masalan, xavf ostidagilar soni). */
  invert?: boolean;
  dark?: boolean;
  title?: string;
}) {
  if (now === null || now === undefined || before === null || before === undefined) return null;
  const diff = Math.round(now - before);
  const good = invert ? diff < 0 : diff > 0;
  const Icon = diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : Minus;
  const cls =
    diff === 0
      ? dark
        ? 'bg-white/10 text-slate-200'
        : 'bg-slate-100 text-slate-600'
      : good
        ? dark
          ? 'bg-emerald-400/15 text-emerald-300'
          : 'bg-emerald-50 text-emerald-700'
        : dark
          ? 'bg-rose-400/15 text-rose-300'
          : 'bg-rose-50 text-rose-700';
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold rx-num ${cls}`}
    >
      <Icon size={12} strokeWidth={2.6} />
      {diff > 0 ? '+' : diff < 0 ? '−' : ''}
      {Math.abs(diff).toLocaleString('ru-RU')}
      {unit}
    </span>
  );
}

/** Ko'rsatkich kartasi: rangli ikonka, katta raqam, izoh va o'zgarish. */
export function KpiCard({
  icon: Icon,
  tone = 'indigo',
  label,
  value,
  sub,
  delta,
  onClick,
  delay = 0,
  title,
}: {
  icon: LucideIcon;
  tone?: Tone;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  delta?: ReactNode;
  onClick?: () => void;
  delay?: number;
  title?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className={`flex h-10 w-10 items-center justify-center rounded-2xl shadow-lg ${TONE[tone].chip}`}>
          <Icon size={19} strokeWidth={2.2} />
        </span>
        {delta}
      </div>
      <p className="mt-3 text-[12px] font-semibold text-slate-500">{label}</p>
      <p className="mt-0.5 text-[28px] font-extrabold leading-none text-slate-900 rx-num">{value}</p>
      {sub && <p className="mt-1.5 text-[11.5px] leading-snug text-slate-400">{sub}</p>}
    </>
  );
  const cls = `rx-card rx-rise block w-full p-4 text-left ${onClick ? 'rx-lift cursor-pointer' : ''}`;
  const style = { ['--rx-delay' as string]: `${delay}ms` } as React.CSSProperties;
  return onClick ? (
    <button type="button" onClick={onClick} className={cls} style={style} title={title}>
      {body}
    </button>
  ) : (
    <div className={cls} style={style} title={title}>
      {body}
    </div>
  );
}

/** Bo'lim kartasi: rangli ikonka, sarlavha, izoh va o'ng tomonda amallar. */
export function Panel({
  icon: Icon,
  tone = 'indigo',
  title,
  hint,
  actions,
  children,
  className = '',
  bodyClassName = '',
  delay = 0,
  id,
}: {
  icon?: LucideIcon;
  tone?: Tone;
  title: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  delay?: number;
  /** Xulosadan shu bo'limga sakrash uchun. */
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`rx-card rx-rise scroll-mt-24 overflow-hidden ${className}`}
      style={{ ['--rx-delay' as string]: `${delay}ms` } as React.CSSProperties}
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3.5 sm:px-5">
        {Icon && (
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-md ${TONE[tone].chip}`}>
            <Icon size={17} strokeWidth={2.2} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-[14.5px] font-bold text-slate-900">{title}</h2>
          {hint && <p className="mt-0.5 text-[12px] leading-snug text-slate-500">{hint}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** Gradientli yo'lak — chapdan o'sib chiqadi. */
export function Meter({
  value,
  max = 100,
  tone,
  height = 8,
  delay = 0,
  label,
}: {
  value: number | null;
  max?: number;
  tone?: Tone;
  height?: number;
  delay?: number;
  label?: ReactNode;
}) {
  const pct = value === null || !max ? 0 : Math.max(0, Math.min(100, (100 * value) / max));
  const t = tone ?? toneOf(value === null ? null : (100 * value) / (max || 1));
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="w-full min-w-[56px] overflow-hidden rounded-full bg-slate-100" style={{ height }}>
        <div
          className={`rx-bar h-full rounded-full ${TONE[t].bar}`}
          style={{ width: `${Math.max(value ? 3 : 0, pct)}%`, ['--rx-delay' as string]: `${delay}ms` } as React.CSSProperties}
        />
      </div>
      {label !== undefined && (
        <span className={`w-11 shrink-0 text-right text-[12.5px] font-bold rx-num ${TONE[t].text}`}>{label}</span>
      )}
    </div>
  );
}

/** Ustunli grafik: kun bo'yicha faollik va shunga o'xshashlar. */
export function Columns({
  items,
  height = 120,
  tone = 'indigo',
  onPick,
}: {
  items: Array<{ key: string; label: string; value: number; caption?: ReactNode; sub?: ReactNode; title?: string; tone?: Tone; muted?: boolean }>;
  height?: number;
  tone?: Tone;
  onPick?: (key: string) => void;
}) {
  const peak = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="flex items-end gap-1.5 sm:gap-2">
      {items.map((item, idx) => {
        const h = item.value ? Math.max(4, (item.value / peak) * 100) : 2;
        const t = TONE[item.tone ?? tone];
        const col = (
          <>
            <span className="text-[11px] font-bold text-slate-700 rx-num">{item.caption ?? item.value}</span>
            <div className="flex w-full items-end justify-center" style={{ height }}>
              <div
                className={`rx-col w-full max-w-[44px] rounded-t-xl ${item.muted ? 'bg-slate-200' : `bg-gradient-to-t ${t.bar.replace('bg-gradient-to-r', '')}`}`}
                style={{ height: `${h}%`, ['--rx-delay' as string]: `${idx * 40}ms` } as React.CSSProperties}
              />
            </div>
            <span className="text-[10.5px] font-medium text-slate-400">{item.label}</span>
            {item.sub !== undefined && <span className="text-[10px] text-slate-400 rx-num">{item.sub}</span>}
          </>
        );
        return onPick ? (
          <button
            key={item.key}
            type="button"
            title={item.title}
            onClick={() => onPick(item.key)}
            className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg py-1 transition hover:bg-slate-50"
          >
            {col}
          </button>
        ) : (
          <div key={item.key} title={item.title} className="flex min-w-0 flex-1 flex-col items-center gap-1 py-1">
            {col}
          </div>
        );
      })}
    </div>
  );
}

/** Bir-birini qoplamaydigan ulushlar chizig'i (100% gacha). */
export function StackBar({
  parts,
  height = 12,
}: {
  parts: Array<{ key: string; value: number; tone: Tone; title?: string }>;
  height?: number;
}) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div className="flex w-full overflow-hidden rounded-full bg-slate-100" style={{ height }}>
      {parts.map((p, i) =>
        p.value ? (
          <div
            key={p.key}
            title={p.title}
            className={`rx-bar h-full ${TONE[p.tone].bar} ${i ? 'border-l-2 border-white' : ''}`}
            style={{ width: `${(100 * p.value) / total}%`, ['--rx-delay' as string]: `${i * 90}ms` } as React.CSSProperties}
          />
        ) : null,
      )}
    </div>
  );
}

const AVATAR_TONES = [
  'from-indigo-500 to-violet-500',
  'from-sky-500 to-blue-600',
  'from-teal-400 to-cyan-600',
  'from-emerald-400 to-green-600',
  'from-amber-400 to-orange-500',
  'from-rose-400 to-pink-600',
  'from-fuchsia-500 to-purple-600',
];

/** Ism bosh harflari — rangi ismdan kelib chiqadi (har safar bir xil). */
export function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  const clean = (name || '?').replace(/[^\p{L}\s]/gu, ' ').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  const initials = ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
  let hash = 0;
  for (const ch of clean) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-bold text-white shadow-sm ${AVATAR_TONES[hash % AVATAR_TONES.length]}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {initials}
    </span>
  );
}

/** Kichik rangli yorliq. */
export function Pill({ tone = 'slate', children, className = '' }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${TONE[tone].soft} ${className}`}>
      {children}
    </span>
  );
}

const GRADE_TONE: Record<number, string> = {
  5: 'from-emerald-400 to-green-600',
  4: 'from-sky-400 to-blue-600',
  3: 'from-amber-400 to-orange-500',
  2: 'from-rose-500 to-pink-600',
};

/** 5 ballik baho nishoni. */
export function GradeBadge({ grade, size = 26 }: { grade: number | null | undefined; size?: number }) {
  if (!grade) return <span className="text-slate-300">—</span>;
  return (
    <span
      title={`${grade} baho`}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br font-extrabold text-white shadow-sm ${GRADE_TONE[grade] || GRADE_TONE[2]}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.52) }}
    >
      {grade}
    </span>
  );
}

/** Segmentli tanlov: bir nechta ko'rinish orasida. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T;
  options: Array<[T, ReactNode]>;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200/70">
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`rounded-lg font-semibold transition ${size === 'sm' ? 'px-2.5 py-1 text-[11.5px]' : 'px-3 py-1.5 text-[12.5px]'} ${
            value === key
              ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Yuklanayotganda — sahifa sakrab ketmasin. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`rx-skeleton rounded-2xl ${className}`} />;
}

/** Ma'lumot yo'q holati. */
export function EmptyNote({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
        <Icon size={20} />
      </span>
      <p className="max-w-md text-[13px] text-slate-500">{children}</p>
    </div>
  );
}

/* ===================================================================== dinamika */

export type TrendSeries = {
  key: string;
  label: string;
  tone: Tone;
  /** Har nuqta uchun qiymat (0–100); `null` — o'sha hafta ma'lumot yo'q. */
  values: Array<number | null>;
};

/**
 * Chiziqli grafik: haftalar bo'yicha bir nechta ko'rsatkich (2026-10-15).
 *
 * Rektor bitta raqamni emas, yo'nalishni ko'rishi kerak. SVG — tashqi
 * kutubxonasiz; `viewBox` bilan har kenglikka moslashadi. Har nuqtaning
 * `title` i bor — sichqoncha ustiga borganda aniq qiymat chiqadi.
 */
export function TrendChart({
  labels,
  series,
  height = 240,
  unit = '%',
  max = 100,
}: {
  labels: string[];
  series: TrendSeries[];
  height?: number;
  unit?: string;
  max?: number;
}) {
  const id = useId().replace(/:/g, '');
  // Kenglik konteynerdan o'lchanadi: viewBox piksel bilan bir xil bo'lsa,
  // grafik keng ekranda haddan tashqari cho'zilmaydi, telefonda esa
  // yozuvlar mitti bo'lib qolmaydi.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = height;
  const pad = { l: 34, r: 18, t: 18, b: 30 };
  const n = Math.max(1, labels.length);
  const x = (i: number) => pad.l + (n === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (n - 1));
  const y = (v: number) => pad.t + (1 - Math.max(0, Math.min(max, v)) / max) * (H - pad.t - pad.b);
  const grid = [0, 25, 50, 75, 100].filter((g) => g <= max);

  return (
    <div ref={box} className="w-full">
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Haftalar bo‘yicha dinamika">
      <defs>
        {series.map((s) => (
          <linearGradient key={s.key} id={`rx-area-${id}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TONE[s.tone].ring[0]} stopOpacity="0.28" />
            <stop offset="100%" stopColor={TONE[s.tone].ring[0]} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>
      {grid.map((g) => (
        <g key={g}>
          <line x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} stroke="#e2e8f0" strokeDasharray={g ? '4 4' : undefined} />
          <text x={pad.l - 8} y={y(g) + 4} textAnchor="end" fontSize="10.5" fill="#94a3b8">
            {g}
          </text>
        </g>
      ))}
      {labels.map((label, i) => (
        <text key={label + i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10.5" fill="#94a3b8">
          {label}
        </text>
      ))}
      {series.map((s) => {
        const pts = s.values.map((v, i) => (v === null ? null : ([x(i), y(v)] as const)));
        const segs: Array<Array<readonly [number, number]>> = [];
        let cur: Array<readonly [number, number]> = [];
        for (const p of pts) {
          if (p) cur.push(p);
          else if (cur.length) {
            segs.push(cur);
            cur = [];
          }
        }
        if (cur.length) segs.push(cur);
        return (
          <g key={s.key}>
            {segs.map((seg, k) => {
              const line = seg.map(([px, py], j) => `${j ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
              const area = `${line} L${seg[seg.length - 1][0].toFixed(1)},${y(0).toFixed(1)} L${seg[0][0].toFixed(1)},${y(0).toFixed(1)} Z`;
              return (
                <g key={k}>
                  <path d={area} fill={`url(#rx-area-${id}-${s.key})`} />
                  <path d={line} fill="none" stroke={TONE[s.tone].ring[1]} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" className="rx-draw" />
                </g>
              );
            })}
            {s.values.map((v, i) =>
              v === null ? null : (
                <g key={i}>
                  <circle cx={x(i)} cy={y(v)} r="5" fill="#fff" stroke={TONE[s.tone].ring[1]} strokeWidth="2.5">
                    <title>{`${s.label}: ${v}${unit} (${labels[i]})`}</title>
                  </circle>
                  {i === s.values.length - 1 && (
                    <text x={x(i)} y={y(v) - 10} textAnchor="middle" fontSize="12" fontWeight="800" fill={TONE[s.tone].ring[1]}>
                      {v}
                      {unit}
                    </text>
                  )}
                </g>
              ),
            )}
          </g>
        );
      })}
    </svg>
    </div>
  );
}

/** Grafik izohi: rang — ko'rsatkich. */
export function Legend({ items }: { items: Array<{ label: string; tone: Tone; value?: ReactNode }> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-slate-600">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className={`h-2.5 w-5 rounded-full ${TONE[it.tone].bar}`} />
          {it.label}
          {it.value !== undefined && <b className="text-slate-900 rx-num">{it.value}</b>}
        </span>
      ))}
    </div>
  );
}

/* ================================================================ xulosalar */

export type Insight = {
  key: string;
  tone: Tone;
  icon: LucideIcon;
  /** Asosiy gap — raqam bilan. */
  text: ReactNode;
  /** Bosilsa nima ochiladi (ro'yxat, filtr). */
  onClick?: () => void;
  action?: string;
};

/**
 * "Asosiy xulosalar" — sahifa tepasida rektor birinchi o'qiydigan 4–6 band
 * (2026-10-15). Har biri raqam bilan va bosiladi: nimaga qarash kerakligini
 * aytadi, qayerga borishni ham ko'rsatadi.
 */
export function Insights({ items, title = 'Asosiy xulosalar' }: { items: Insight[]; title?: string }) {
  if (!items.length) return null;
  return (
    <section className="rx-card rx-rise overflow-hidden">
      <header className="flex items-center gap-2.5 border-b border-slate-100 bg-gradient-to-r from-indigo-50/70 via-white to-sky-50/50 px-4 py-3 sm:px-5">
        <span className={`flex h-8 w-8 items-center justify-center rounded-xl shadow-md ${TONE.indigo.chip}`}>
          <Lightbulb size={16} />
        </span>
        <h2 className="text-[14.5px] font-bold text-slate-900">{title}</h2>
      </header>
      <ul className="grid sm:grid-cols-2 xl:grid-cols-3">
        {items.map((it, i) => {
          const body = (
            <>
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ${TONE[it.tone].soft}`}>
                <it.icon size={17} />
              </span>
              <span className="min-w-0 flex-1 text-[13px] leading-snug text-slate-700">{it.text}</span>
              {it.onClick && (
                <span className={`shrink-0 text-[11.5px] font-bold ${TONE[it.tone].text}`}>{it.action || 'Ko‘rish'} →</span>
              )}
            </>
          );
          return (
            <li
              key={it.key}
              className="rx-rise border-b border-slate-100 bg-white sm:border-r"
              style={{ ['--rx-delay' as string]: `${i * 60}ms` } as React.CSSProperties}
            >
              {it.onClick ? (
                <button type="button" onClick={it.onClick} className="flex h-full w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-slate-50 sm:px-5">
                  {body}
                </button>
              ) : (
                <div className="flex h-full items-center gap-3 px-4 py-3.5 sm:px-5">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
