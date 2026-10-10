import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CalendarDays,
  CalendarCheck,
  GraduationCap,
  KeyRound,
  Loader2,
  LogOut,
  Maximize,
  RefreshCw,
  Search,
  Monitor,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { HttpError } from '../api/httpClient';
import {
  clearRectorToken,
  fetchFilters,
  loadRectorToken,
  rectorLogin,
  type ReportFilters,
} from './rectorApi';
import ControlReport from './ControlReport';
import PlatformHome from './PlatformHome';
import PlatformPage from './PlatformPage';
import { MetricProvider } from './RectorMetric';
import { TeacherProfileProvider } from './TeacherProfile';
import { StudentProfileProvider } from './StudentProfile';
import { monthEnd, monthStart, shiftDays } from './rectorDates';

const AUTO_REFRESH_MS = 60_000;





const QUICK_RANGES: Array<{ label: string; from: () => string; to: () => string }> = [
  { label: 'Bugun', from: () => shiftDays(0), to: () => shiftDays(0) },
  { label: 'Kecha', from: () => shiftDays(-1), to: () => shiftDays(-1) },
  { label: '7 kun', from: () => shiftDays(-6), to: () => shiftDays(0) },
  { label: '30 kun', from: () => shiftDays(-29), to: () => shiftDays(0) },
  { label: 'Bu oy', from: () => monthStart(0), to: () => shiftDays(0) },
  { label: 'O‘tgan oy', from: () => monthStart(-1), to: () => monthEnd(-1) },
];

function LoginScreen({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setBusy(true);
    setError('');
    try {
      await rectorLogin(password.trim(), username.trim());
      onDone();
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) setError('Login yoki parol noto‘g‘ri.');
      else if (err instanceof HttpError && err.status === 503) setError('Hisobot paroli serverda sozlanmagan. Administratorga murojaat qiling.');
      else if (err instanceof HttpError && err.status === 429) setError('Juda ko‘p urinish. Bir daqiqa kutib, qayta urinib ko‘ring.');
      else setError('Kirishda xatolik. Birozdan keyin qayta urinib ko‘ring.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900">
            <ShieldCheck size={26} className="text-white" />
          </div>
          <h1 className="text-[22px] font-bold text-slate-900">Rektor hisoboti</h1>
          <p className="mt-1 text-[13px] text-slate-500">Monitor bandligi va foydalanish nazorati</p>
        </div>

        <form onSubmit={submit} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Login</span>
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 focus-within:border-slate-400">
              <ShieldCheck size={16} className="shrink-0 text-slate-400" />
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
                placeholder="Rektor uchun bo‘sh qoldiring, dekan uchun login"
                className="w-full bg-transparent py-3 text-[15px] outline-none"
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Parol</span>
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 focus-within:border-slate-400">
              <KeyRound size={16} className="shrink-0 text-slate-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full bg-transparent py-3 text-[15px] outline-none"
              />
            </div>
          </label>

          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{error}</p>}

          <button
            type="submit"
            disabled={busy || !password.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-[14.5px] font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {busy && <Loader2 size={18} className="animate-spin" />}
            Kirish
          </button>
        </form>
      </div>
    </div>
  );
}

export default function RectorApp() {
  const [signedIn, setSignedIn] = useState<boolean>(() => Boolean(loadRectorToken()));
  const [from, setFrom] = useState(() => shiftDays(-6));
  const [to, setTo] = useState(() => shiftDays(0));
  const [department, setDepartment] = useState('');
  const [queryText, setQueryText] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [auto, setAuto] = useState(true);
  const [syncedAt, setSyncedAt] = useState<Date>(() => new Date());
  const [departments, setDepartments] = useState<string[]>([]);
  // Bosh sahifada platforma tanlanadi; `null` — tanlanmagan.
  const [platform, setPlatform] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    fetchFilters()
      .then((f) => alive && setDepartments(f.departments || []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [signedIn]);

  const refreshNow = useCallback(() => {
    setRefreshKey((n) => n + 1);
    setSyncedAt(new Date());
  }, []);

  useEffect(() => {
    document.title = 'Rektor hisoboti — iMentor';
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(queryText.trim()), 300);
    return () => window.clearTimeout(t);
  }, [queryText]);

  useEffect(() => {
    if (!signedIn || !auto) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshNow();
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [signedIn, auto, refreshNow]);

  const signOut = useCallback(() => {
    clearRectorToken();
    setSignedIn(false);
  }, []);

  const onUnauthorized = useCallback(() => {
    clearRectorToken();
    setSignedIn(false);
  }, []);

  const filters: ReportFilters = useMemo(
    () => ({ from, to, department, q: debouncedQuery, refreshKey }),
    [from, to, department, debouncedQuery, refreshKey],
  );

  const activeRange = QUICK_RANGES.find((r) => r.from() === from && r.to() === to)?.label || '';

  if (!signedIn) return <LoginScreen onDone={() => setSignedIn(true)} />;

  return (
    <div className="min-h-[100dvh] bg-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full flex-wrap items-center justify-between gap-3 px-3 py-2.5 sm:px-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900">
              <ShieldCheck size={18} className="text-white" />
            </div>
            <div className="leading-tight">
              <p className="text-[14.5px] font-bold text-slate-900">Rektor hisoboti</p>
              <p className="text-[11.5px] text-slate-500">{`${from} — ${to}${activeRange ? ` · ${activeRange}` : ''}`}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="To‘liq ekran"
              title="To‘liq ekran"
              className="rounded-lg border border-slate-200 p-2"
              onClick={() => {
                void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
              }}
            >
              <Maximize size={16} />
            </button>
            <button
              type="button"
              onClick={refreshNow}
              title={`Oxirgi yangilanish: ${syncedAt.toLocaleTimeString('uz-UZ')}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw size={14} />
              <span className="hidden tabular-nums sm:inline">{syncedAt.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}</span>
            </button>
            <label className="hidden cursor-pointer items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-[12.5px] font-medium text-slate-700 sm:inline-flex">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              Jonli
            </label>
            <button
              type="button"
              onClick={signOut}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[12.5px] font-medium text-slate-600 hover:bg-slate-50"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">Chiqish</span>
            </button>
          </div>
        </div>
      </header>

      {platform && (
      <div className="mx-auto w-full px-3 pt-4 sm:px-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <CalendarDays size={15} className="mr-0.5 shrink-0 text-slate-400" />
            {QUICK_RANGES.map((r) => {
              const active = r.from() === from && r.to() === to;
              return (
                <button
                  key={r.label}
                  type="button"
                  onClick={() => {
                    setFrom(r.from());
                    setTo(r.to());
                  }}
                  className={`rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold transition ${active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  {r.label}
                </button>
              );
            })}
            <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:block" />
            <div className="flex w-full items-center gap-1.5 sm:w-auto">
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[12.5px] sm:flex-none" />
              <span className="shrink-0 text-slate-400">—</span>
              <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[12.5px] sm:flex-none" />
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {(
            <div className="flex w-full min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 sm:w-auto sm:min-w-[12rem]">
              <Search size={14} className="shrink-0 text-slate-400" />
              <input
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                placeholder="O‘qituvchi familiyasi yoki login"
                className="w-full bg-transparent py-1.5 text-[12.5px] outline-none"
              />
              {queryText && (
                <button type="button" onClick={() => setQueryText('')} aria-label="Tozalash">
                  <X size={13} className="text-slate-400" />
                </button>
              )}
            </div>
            )}
            {departments.length > 0 && (
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full min-w-0 rounded-lg border border-slate-200 px-2 py-1.5 text-[12.5px] sm:w-auto sm:max-w-[22rem]"
                aria-label="Kafedra"
              >
                <option value="">Barcha kafedralar</option>
                {departments.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            )}
            {(department || queryText) && (
              <button
                type="button"
                onClick={() => {
                  setDepartment('');
                  setQueryText('');
                }}
                className="rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-slate-500 hover:bg-slate-100"
              >
                Filtrlarni tozalash
              </button>
            )}
          </div>
        </div>
      </div>
      )}

      <main className="mx-auto w-full px-3 py-4 sm:px-5">
        <TeacherProfileProvider filters={filters} onUnauthorized={onUnauthorized}>
        <StudentProfileProvider filters={filters} onUnauthorized={onUnauthorized}>
        <MetricProvider filters={filters} onUnauthorized={onUnauthorized}>
          {/* Bosh sahifa — faqat tizim nomlari. Biri tanlangach, o'sha
              tizimning hisoboti O'Z sahifasida ochiladi (2026-10-08). */}
          <div className="space-y-5">
            {platform === null ? (
              <PlatformHome
                filters={filters}
                onUnauthorized={onUnauthorized}
                onOpen={setPlatform}
              />
            ) : (
              <PlatformPage
                platform={platform}
                filters={filters}
                onUnauthorized={onUnauthorized}
                onBack={() => setPlatform(null)}
              />
            )}
          </div>
        </MetricProvider>
        </StudentProfileProvider>
        </TeacherProfileProvider>
      </main>

      <footer className="mx-auto w-full px-4 pb-8 text-center text-[11.5px] text-slate-400">
        iMentor · Farg‘ona jamoat salomatligi tibbiyot instituti
      </footer>
    </div>
  );
}
