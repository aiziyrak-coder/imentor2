import { useCallback, useEffect, useState } from 'react';
import { Bug, CheckCircle2, ChevronDown, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { httpJson } from '../../api/httpClient';
import { getBackendAccessToken } from '../../utils/backendAuth';

/**
 * Sayt xatolari (2026-09-24): o'qituvchi/talaba brauzerida yuz bergan xatolar.
 * Bir xil xato bitta qator — necha marta, nechta foydalanuvchida, qaysi brauzerda.
 */
type ClientError = {
  id: number;
  message: string;
  source: string;
  stack: string;
  page: string;
  user_agent: string;
  username: string;
  users: string[];
  user_count: number;
  app_version: string;
  count: number;
  first_seen: string | null;
  last_seen: string | null;
  resolved: boolean;
};

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

async function headers(): Promise<Record<string, string>> {
  const token = await getBackendAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function when(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('uz-UZ')} ${d.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}`;
}

/** "Chrome/80.0" → "Chrome 80" — eski brauzer muammolarini tez ko'rish uchun. */
function browser(ua: string): string {
  const m =
    ua.match(/(SamsungBrowser|YaBrowser|OPR|Edg|Firefox|Chrome|Version)\/(\d+)/) ||
    ua.match(/(Safari)\/(\d+)/);
  if (!m) return ua.slice(0, 30) || '—';
  const name = { OPR: 'Opera', Edg: 'Edge', Version: 'Safari' }[m[1]] || m[1];
  return `${name} ${m[2]}${/Android|iPhone|Mobile/.test(ua) ? ' · telefon' : ''}`;
}

export default function AdminClientErrors() {
  const [days, setDays] = useState(7);
  const [showResolved, setShowResolved] = useState(false);
  const [items, setItems] = useState<ClientError[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await httpJson<{ items: ClientError[] }>(
        `${apiBaseUrl()}/v1/admin/client-errors/?days=${days}&include_resolved=${showResolved}`,
        { headers: await headers() },
      );
      setItems(res.items);
    } catch {
      setError('Ro‘yxatni yuklab bo‘lmadi.');
    } finally {
      setLoading(false);
    }
  }, [days, showResolved]);

  useEffect(() => {
    void load();
  }, [load]);

  const resolve = async (id: number) => {
    setBusy(id);
    try {
      const row = await httpJson<ClientError>(`${apiBaseUrl()}/v1/admin/client-errors/${id}/resolve/`, {
        method: 'POST',
        headers: await headers(),
      });
      setItems((prev) => (showResolved ? prev.map((x) => (x.id === id ? row : x)) : prev.filter((x) => x.id !== id)));
    } catch {
      setError('Belgilab bo‘lmadi.');
    } finally {
      setBusy(null);
    }
  };

  const totalEvents = items.reduce((n, x) => n + x.count, 0);
  const affected = new Set(items.flatMap((x) => x.users)).size;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <Bug size={20} className="text-rose-600" /> Sayt xatolari
          </h1>
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-slate-500">
            O‘qituvchi yoki talaba brauzerida chiqqan xatolar o‘zi shu yerga yoziladi — skrinshot kutish shart emas.
            Bir xil xato bitta qator bo‘lib yig‘iladi. Tuzatilgach «Hal qilindi» deb belgilang: xato yana chiqsa, ro‘yxatga
            qaytadi.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5"
          >
            <option value={1}>Oxirgi 1 kun</option>
            <option value={7}>Oxirgi 7 kun</option>
            <option value={30}>Oxirgi 30 kun</option>
            <option value={90}>Oxirgi 90 kun</option>
          </select>
          <label className="flex items-center gap-1.5 text-slate-600">
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
            Hal qilinganlar ham
          </label>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Yangilash
          </button>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-2 sm:max-w-xl">
        {[
          ['Turli xato', items.length],
          ['Jami holat', totalEvents],
          ['Foydalanuvchi', affected],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
            <p className="text-[11.5px] text-slate-500">{label}</p>
            <p className="text-lg font-bold tabular-nums text-slate-900">{value}</p>
          </div>
        ))}
      </div>

      {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}

      {loading && !items.length ? (
        <div className="flex justify-center py-10 text-slate-400">
          <Loader2 className="animate-spin" />
        </div>
      ) : !items.length ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-6 text-center text-[13.5px] font-medium text-emerald-800">
          Bu oraliqda ochiq xato yo‘q.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((x) => (
            <li key={x.id} className={`rounded-xl border bg-white ${x.resolved ? 'border-slate-200 opacity-60' : 'border-slate-200'}`}>
              <div className="flex items-start gap-3 px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => setOpen(open === x.id ? null : x.id)}
                  className="mt-0.5 text-slate-400 hover:text-slate-700"
                  aria-label="Batafsil"
                >
                  {open === x.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="break-words font-mono text-[13px] font-semibold text-slate-900">{x.message}</p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-slate-500">
                    <span>
                      <b className="tabular-nums text-slate-700">{x.count}</b> marta
                    </span>
                    <span>{x.user_count ? `${x.user_count} foydalanuvchi` : 'kirmagan foydalanuvchi'}</span>
                    <span>{browser(x.user_agent)}</span>
                    <span>oxirgi: {when(x.last_seen)}</span>
                    {x.page && <span className="truncate">sahifa: {x.page}</span>}
                  </p>
                </div>
                {!x.resolved && (
                  <button
                    type="button"
                    disabled={busy === x.id}
                    onClick={() => void resolve(x.id)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[12px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                  >
                    {busy === x.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                    Hal qilindi
                  </button>
                )}
              </div>
              {open === x.id && (
                <div className="space-y-2 border-t border-slate-100 px-10 py-3 text-[12px] text-slate-600">
                  <p>
                    <b>Birinchi marta:</b> {when(x.first_seen)} · <b>Versiya:</b> {x.app_version || '—'}
                  </p>
                  {x.users.length > 0 && (
                    <p className="break-words">
                      <b>Foydalanuvchilar:</b> {x.users.join(', ')}
                    </p>
                  )}
                  <p className="break-words">
                    <b>Brauzer:</b> {x.user_agent || '—'}
                  </p>
                  {x.source && (
                    <p className="break-words font-mono">
                      <b className="font-sans">Joyi:</b> {x.source}
                    </p>
                  )}
                  {x.stack && (
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2 font-mono text-[11px] text-slate-700">
                      {x.stack}
                    </pre>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
