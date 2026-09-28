import { Fragment, useMemo, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, ArrowUpDown, ChevronDown, Loader2 } from 'lucide-react';

/**
 * Rektor hisobotining umumiy qismlari.
 *
 * Bo'limlar ham, ko'rsatkich oynasi ham shu yerdagi jadval va kartalarni
 * ishlatadi. Alohida fayl — chunki oyna bo'limlardan, bo'limlar oynadan
 * foydalanadi; umumiylari o'rtada turmasa, aylanma import chiqadi.
 */

const NARROW_QUERY = '(max-width: 639px)';

function subscribeNarrow(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  try {
    const mq = window.matchMedia(NARROW_QUERY);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  } catch {
    return () => {};
  }
}

function narrowSnapshot(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia(NARROW_QUERY).matches;
  } catch {
    return false;
  }
}

/**
 * Ekran tormi? Bu yerda qurilma turi emas, aynan KENGLIK muhim: rektor
 * hisobotni telefonda ham ochadi, 11 ustunli jadval esa 375px ekranda
 * o'qilmaydi — yonlama siljitib yurishga majbur qiladi.
 */
export function useNarrowScreen(): boolean {
  return useSyncExternalStore(subscribeNarrow, narrowSnapshot, () => false);
}

export function Spinner() {
  return (
    <div className="flex justify-center py-16 text-slate-400">
      <Loader2 size={22} className="animate-spin" />
    </div>
  );
}

export function ErrorBox({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
      <AlertTriangle size={17} className="mt-0.5 shrink-0" />
      {text}
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-4 py-14 text-center text-[13px] text-slate-500">
      {text}
    </div>
  );
}

/**
 * Ko'rsatkich kartasi.
 *
 * `onClick` berilsa karta bosiladigan bo'ladi — rektor raqamni bosib,
 * uning ortidagi ro'yxatni ko'radi. Raqamning o'zi hech narsani
 * isbotlamaydi; tekshirib bo'lmaydigan hisobot — hisobot emas.
 */
export function Stat({
  label,
  value,
  hint,
  tone = 'slate',
  status,
  onClick,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'slate' | 'emerald' | 'amber' | 'rose' | 'sky';
  /** Svetofor: berilsa, kartaning chap cheti va raqami shu rangda bo'ladi. */
  status?: Status;
  onClick?: () => void;
}) {
  const tones: Record<string, string> = {
    slate: 'text-slate-900',
    emerald: 'text-emerald-700',
    amber: 'text-amber-700',
    rose: 'text-rose-700',
    sky: 'text-sky-700',
  };
  const valueTone = status ? STATUS_VALUE[status] : tones[tone];
  const body = (
    <>
      {status && (
        <span
          title={STATUS_LABEL[status]}
          className={`absolute inset-y-0 left-0 w-1.5 ${STATUS_BAR[status]}`}
        />
      )}
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 text-[22px] font-bold tabular-nums ${valueTone}`}>{value}</p>
      {hint && <p className="text-[11.5px] text-slate-400">{hint}</p>}
    </>
  );

  const shell =
    'relative overflow-hidden rounded-xl border border-slate-200 bg-white py-3 pr-3.5 ' +
    (status ? 'pl-4' : 'pl-3.5');

  if (!onClick) return <div className={shell}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      title="Bosing — bu raqam nimadan iborat"
      className={`group text-left transition hover:border-slate-400 hover:shadow-sm ${shell}`}
    >
      {body}
      <span className="absolute right-2.5 top-2.5 text-[10px] font-bold text-slate-300 transition group-hover:text-slate-500">
        ?
      </span>
    </button>
  );
}

/* ==================== Svetofor ==================== */

/**
 * Holat rangi. Butun hisobot bo'ylab BITTA ma'no:
 *   yashil — joyida, sariq — e'tibor kerak, qizil — muammo,
 *   kulrang — ma'lumot yo'q (bu nol degani EMAS).
 *
 * Rektor raqamni o'qib, keyin uni o'zi baholab o'tirmasligi kerak: rang
 * darrov aytadi qayerga qarash kerakligini.
 */
/** Bo'lim sarlavhasi va uning ostidagi qisqa izoh. */
export function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-1">
      <h2 className="text-[13px] font-bold uppercase tracking-wide text-slate-500">{title}</h2>
      {hint && <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-500">{hint}</p>}
    </div>
  );
}

export type Status = 'good' | 'warn' | 'bad' | 'none';

/** Foizdan holat: 70 dan yuqorisi yashil, 40 dan pasti qizil. */
export function statusOf(value: number | null | undefined, good = 70, warn = 40): Status {
  if (value === null || value === undefined || Number.isNaN(value)) return 'none';
  if (value >= good) return 'good';
  if (value >= warn) return 'warn';
  return 'bad';
}

/** Kam bo'lgani yaxshi bo'lgan ko'rsatkich uchun (masalan "kirmaganlar"). */
export function statusOfLow(value: number | null | undefined, good = 10, warn = 30): Status {
  if (value === null || value === undefined || Number.isNaN(value)) return 'none';
  if (value <= good) return 'good';
  if (value <= warn) return 'warn';
  return 'bad';
}

export const STATUS_LABEL: Record<Status, string> = {
  good: 'Joyida',
  warn: 'E’tibor kerak',
  bad: 'Muammo',
  none: 'Ma’lumot yo‘q',
};

export const STATUS_CHIP: Record<Status, string> = {
  good: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  warn: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
  bad: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
  none: 'bg-slate-100 text-slate-400 ring-1 ring-slate-200',
};

export const STATUS_BAR: Record<Status, string> = {
  good: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-rose-500',
  none: 'bg-slate-300',
};

export const STATUS_VALUE: Record<Status, string> = {
  good: 'text-emerald-700',
  warn: 'text-amber-700',
  bad: 'text-rose-700',
  none: 'text-slate-900',
};

/** Rangli yorliq — jadval katakchasida. */
export function StatusChip({
  status,
  children,
  title,
}: {
  status: Status;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title || STATUS_LABEL[status]}
      className={`inline-block rounded px-1.5 py-0.5 text-[11.5px] font-semibold tabular-nums ${STATUS_CHIP[status]}`}
    >
      {children}
    </span>
  );
}

/** Rangli nuqta — qator boshida "qanday ketyapti" belgisi. */
export function StatusDot({ status, title }: { status: Status; title?: string }) {
  return (
    <span
      title={title || STATUS_LABEL[status]}
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_BAR[status]}`}
    />
  );
}

/** Svetofor izohi — rang nimani bildirishini bir marta aytib qo'yadi. */
export function StatusLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-slate-500">
      {(['good', 'warn', 'bad', 'none'] as Status[]).map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${STATUS_BAR[s]}`} />
          {STATUS_LABEL[s]}
        </span>
      ))}
    </div>
  );
}

/** Foiz rangi — butun hisobotda bir xil shkala. */
export function pctTone(p: number | null | undefined): string {
  // Institutning baho shkalasi: 71% dan — yashil, 56% dan — sariq, pasti — qizil.
  return STATUS_CHIP[statusOf(p, 71, 56)];
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('uz-UZ', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export function fmtMinutes(m: number): string {
  if (!m) return '—';
  if (m < 60) return `${m} daq`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} soat ${rest} daq` : `${h} soat`;
}

export type Column<T> = {
  key: string;
  label: string;
  align?: 'left' | 'right';
  width?: string;
  value: (row: T) => string | number | null;
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
};

/**
 * Saralanadigan jadval.
 *
 * Keng ekranda — oddiy jadval. Telefonda — har qator kartochka: bitta
 * ustun sarlavha bo'ladi, qolganlari "nom: qiymat" yorliqlariga aylanadi.
 * Ustunlar ta'rifi bitta, shuning uchun ikkala ko'rinish bir manbadan
 * chiziladi va biri yangilanib, ikkinchisi eskirib qolmaydi.
 */
export function SortableTable<T>({
  rows,
  columns,
  initialSort,
  rowKey,
  onRowClick,
  expandedKey,
  renderExpanded,
  cardPrimary,
  cardSubtitle,
}: {
  rows: T[];
  columns: Array<Column<T>>;
  initialSort: { key: string; dir: 'asc' | 'desc' };
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  expandedKey?: string;
  renderExpanded?: (row: T) => React.ReactNode;
  /** Kartochka sarlavhasi uchun ustun kaliti (standart — birinchi ustun). */
  cardPrimary?: string;
  /** Sarlavha ostida to'liq kenglikda chiqadigan ustun. */
  cardSubtitle?: string;
}) {
  const [sort, setSort] = useState(initialSort);
  const narrow = useNarrowScreen();

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = col.value(a);
      const vb = col.value(b);
      const na = va === null || va === undefined ? -Infinity : va;
      const nb = vb === null || vb === undefined ? -Infinity : vb;
      if (typeof na === 'number' && typeof nb === 'number') {
        return sort.dir === 'asc' ? na - nb : nb - na;
      }
      const sa = String(na).toLowerCase();
      const sb = String(nb).toLowerCase();
      return sort.dir === 'asc' ? sa.localeCompare(sb, 'uz') : sb.localeCompare(sa, 'uz');
    });
    return copy;
  }, [rows, columns, sort]);

  const cell = (c: Column<T>, row: T) => (c.render ? c.render(row) : (c.value(row) ?? '—'));

  if (narrow) {
    const primary = columns.find((c) => c.key === cardPrimary) || columns[0];
    const subtitle = cardSubtitle ? columns.find((c) => c.key === cardSubtitle) : undefined;
    const rest = columns.filter((c) => c !== primary && c !== subtitle);
    const sortable = columns.filter((c) => c.sortable !== false);

    return (
      <div className="space-y-2">
        {sortable.length > 1 && (
          <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5">
            <ArrowUpDown size={13} className="shrink-0 text-slate-400" />
            <select
              aria-label="Saralash"
              value={sort.key}
              onChange={(e) => setSort((s) => ({ key: e.target.value, dir: s.dir }))}
              className="min-w-0 flex-1 bg-transparent text-[12.5px] font-semibold text-slate-700 outline-none"
            >
              {sortable.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label} bo‘yicha
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setSort((s) => ({ key: s.key, dir: s.dir === 'asc' ? 'desc' : 'asc' }))}
              className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-[11.5px] font-semibold text-slate-600"
            >
              {sort.dir === 'asc' ? 'kamdan' : 'ko‘pdan'}
            </button>
          </div>
        )}

        <ul className="space-y-2">
          {sorted.map((row) => {
            const key = rowKey(row);
            const expanded = expandedKey === key;
            // Qiymati yo'q ustun telefonda yorliq bo'lib chiqmaydi — aks
            // holda sillabusi yo'q kafedra yettita "—" bilan to'lib,
            // haqiqiy ma'lumot ko'rinmay qolardi.
            const chips = rest.filter((c) => {
              const v = c.value(row);
              return v !== null && v !== undefined && v !== '';
            });
            return (
              <li key={key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`px-3 py-2.5 ${onRowClick ? 'cursor-pointer' : ''}`}
                >
                  <div className="text-[13.5px] font-medium text-slate-900">
                    {cell(primary, row)}
                  </div>
                  {subtitle && <div className="mt-1 text-[12.5px]">{cell(subtitle, row)}</div>}
                  {chips.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {chips.map((c) => (
                        <span
                          key={c.key}
                          className="inline-flex items-center gap-1 rounded-lg bg-slate-50 px-2 py-1 text-[11.5px] text-slate-700"
                        >
                          <span className="text-slate-400">{c.label}</span>
                          <span className="font-semibold tabular-nums">{cell(c, row)}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {expanded && renderExpanded && (
                  <div className="border-t border-slate-100 bg-slate-50/60 px-3 py-3">
                    {renderExpanded(row)}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full min-w-[52rem] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80">
            {columns.map((c) => (
              <th
                key={c.key}
                style={c.width ? { width: c.width } : undefined}
                className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 ${
                  c.align === 'right' ? 'text-right' : 'text-left'
                }`}
              >
                {c.sortable === false ? (
                  c.label
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setSort((s) =>
                        s.key === c.key
                          ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
                          : { key: c.key, dir: 'desc' },
                      )
                    }
                    className={`inline-flex items-center gap-1 hover:text-slate-800 ${
                      sort.key === c.key ? 'text-slate-900' : ''
                    }`}
                  >
                    {c.label}
                    {sort.key === c.key && (
                      <ChevronDown
                        size={12}
                        className={sort.dir === 'asc' ? 'rotate-180 transition' : 'transition'}
                      />
                    )}
                  </button>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const key = rowKey(row);
            const expanded = expandedKey === key;
            return (
              <Fragment key={key}>
                <tr
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`border-b border-slate-100 last:border-0 ${
                    onRowClick ? 'cursor-pointer hover:bg-slate-50' : ''
                  } ${expanded ? 'bg-slate-50' : ''}`}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-3 py-2.5 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}
                    >
                      {cell(c, row)}
                    </td>
                  ))}
                </tr>
                {expanded && renderExpanded && (
                  <tr className="border-b border-slate-100 bg-slate-50/60">
                    <td colSpan={columns.length} className="px-3 py-3">
                      {renderExpanded(row)}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
