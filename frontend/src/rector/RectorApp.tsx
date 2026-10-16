import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  KeyRound,
  Loader2,
  LogOut,
  Maximize,
  RefreshCw,
  Search,
  ShieldCheck,
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
import PlatformHome from './PlatformHome';
import StudentsReport from './StudentsReport';
import AudienceSwitch, { type Audience } from './AudienceSwitch';
import PlatformPage from './PlatformPage';
import { MetricProvider } from './RectorMetric';
import { TeacherProfileProvider } from './TeacherProfile';
import { StudentProfileProvider } from './StudentProfile';
import { monthEnd, monthStart, shiftDays } from './rectorDates';
import { uzDay } from './RectorViz';
import './rector.css';

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
    <div className="rx-header flex min-h-[100dvh] items-center justify-center p-4">
      <div className="w-full max-w-sm rx-rise">
        <div className="mb-7 text-center text-white">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-indigo-400 to-sky-500 shadow-2xl shadow-indigo-500/40">
            <ShieldCheck size={30} className="text-white" />
          </div>
          <h1 className="text-[26px] font-extrabold tracking-tight">Rektor hisoboti</h1>
          <p className="mt-1 text-[13.5px] text-indigo-200/80">Ustozlar va talabalar faoliyati nazorati</p>
        </div>

        <form onSubmit={submit} className="space-y-3.5 rounded-3xl bg-white p-6 shadow-2xl shadow-black/30">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">Login</span>
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 transition focus-within:border-indigo-400 focus-within:bg-white focus-within:ring-4 focus-within:ring-indigo-100">
              <ShieldCheck size={16} className="shrink-0 text-slate-400" />
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
                placeholder="Rektor uchun bo‘sh qoldiring, dekan uchun login"
                className="w-full bg-transparent py-3 text-[14.5px] outline-none"
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">Parol</span>
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 transition focus-within:border-indigo-400 focus-within:bg-white focus-within:ring-4 focus-within:ring-indigo-100">
              <KeyRound size={16} className="shrink-0 text-slate-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full bg-transparent py-3 text-[14.5px] outline-none"
              />
            </div>
          </label>

          {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700 ring-1 ring-rose-200">{error}</p>}

          <button
            type="submit"
            disabled={busy || !password.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 py-3.5 text-[15px] font-bold text-white shadow-lg shadow-indigo-500/30 transition hover:brightness-110 disabled:opacity-50"
          >
            {busy && <Loader2 size={18} className="animate-spin" />}
            Kirish
          </button>
        </form>
        <p className="mt-6 text-center text-[11.5px] text-indigo-200/60">
          Farg‘ona jamoat salomatligi tibbiyot instituti
        </p>
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
  // Guruh bilan cheklangan dekan (xalqaro fakultet): kafedra kesimida
  // ishlaydigan bo'limlar unga 403 qaytaradi, shuning uchun tugmasi ham
  // ko'rsatilmaydi (2026-10-11).
  const [wide, setWide] = useState(true);
  // Bosh sahifada platforma tanlanadi; `null` — tanlanmagan.
  const [platform, setPlatform] = useState<string | null>(null);
  /** Yuqori darajadagi sahifa: platformalar yoki talabalar. */
  const [topView, setTopView] = useState<Audience>('teachers');

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    fetchFilters()
      .then((f) => {
        if (!alive) return;
        setDepartments(f.departments || []);
        setWide((f.scope?.groups || []).length === 0);
      })
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
  const students = topView === 'students';
  // Sana tanlovi talabalar sahifasida ham kerak: ilgari u faqat platforma
  // ochilganda chiqardi va talabalar doim 7 kun bo'yicha ko'rinardi.
  const showFilters = students || platform !== null;

  if (!signedIn) return <LoginScreen onDone={() => setSignedIn(true)} />;

  return (
    <div className="rx-app">
      <header className="rx-header z-20 text-white sm:sticky sm:top-0">
        <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-3 px-3 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-sky-500 shadow-lg shadow-indigo-500/30">
              <ShieldCheck size={20} className="text-white" />
            </div>
            <div className="leading-tight">
              <p className="text-[16px] font-extrabold tracking-tight">Rektor hisoboti</p>
              <p className="flex items-center gap-1 text-[11.5px] text-indigo-200/80">
                <CalendarDays size={11} />
                {from === to ? uzDay(from) : `${uzDay(from)} — ${uzDay(to)}`}
                {activeRange ? ` · ${activeRange}` : ''}
              </p>
            </div>
          </div>

          <AudienceSwitch value={topView} onChange={setTopView} />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAuto((v) => !v)}
              title={auto ? 'Har daqiqada o‘zi yangilanadi — to‘xtatish' : 'Jonli yangilashni yoqish'}
              className="hidden items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-[12px] font-semibold ring-1 ring-white/15 transition hover:bg-white/15 sm:inline-flex"
            >
              <span className={`h-2 w-2 rounded-full ${auto ? 'rx-live bg-emerald-400' : 'bg-slate-400'}`} />
              {auto ? 'Jonli' : 'To‘xtatilgan'}
            </button>
            <button
              type="button"
              onClick={refreshNow}
              title={`Oxirgi yangilanish: ${syncedAt.toLocaleTimeString('uz-UZ')}`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-[12px] font-semibold ring-1 ring-white/15 transition hover:bg-white/15"
            >
              <RefreshCw size={14} />
              <span className="hidden rx-num sm:inline">
                {syncedAt.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </button>
            <button
              type="button"
              aria-label="To‘liq ekran"
              title="To‘liq ekran"
              className="rounded-xl bg-white/10 p-2 ring-1 ring-white/15 transition hover:bg-white/15"
              onClick={() => {
                void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
              }}
            >
              <Maximize size={16} />
            </button>
            <button
              type="button"
              onClick={signOut}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-[12px] font-semibold ring-1 ring-white/15 transition hover:bg-rose-500/80"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">Chiqish</span>
            </button>
          </div>
        </div>
      </header>

      {showFilters && (
        <div className="mx-auto w-full max-w-[1600px] px-3 pt-5 sm:px-6">
          <div className="rx-card flex flex-wrap items-center gap-2 p-2.5">
            <span className="ml-1 flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <CalendarDays size={16} />
            </span>
            <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
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
                    className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition ${
                      active
                        ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/25'
                        : 'text-slate-600 hover:bg-white hover:text-slate-900'
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
            <div className="flex w-full items-center gap-1.5 sm:w-auto">
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[12.5px] outline-none focus:border-indigo-400 sm:flex-none" />
              <span className="shrink-0 text-slate-400">—</span>
              <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[12.5px] outline-none focus:border-indigo-400 sm:flex-none" />
            </div>

            {/* Kafedra va o'qituvchi qidiruvi faqat ustozlar tomonida: talabalar
                sahifasining o'z filtri bor (fakultet, guruh, kurs, fan). */}
            {!students && (
              <>
                <div className="flex w-full min-w-0 flex-1 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 focus-within:border-indigo-400 sm:w-auto sm:min-w-[12rem]">
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
                {departments.length > 0 && (
                  <select
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full min-w-0 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[12.5px] outline-none focus:border-indigo-400 sm:w-auto sm:max-w-[22rem]"
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
                    className="rounded-xl px-3 py-1.5 text-[12.5px] font-semibold text-indigo-600 hover:bg-indigo-50"
                  >
                    Filtrlarni tozalash
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-[1600px] px-3 py-5 sm:px-6">
        <TeacherProfileProvider filters={filters} onUnauthorized={onUnauthorized}>
        <StudentProfileProvider filters={filters} onUnauthorized={onUnauthorized}>
        <MetricProvider filters={filters} onUnauthorized={onUnauthorized}>
          {/* Bosh sahifa — faqat tizim nomlari. Biri tanlangach, o'sha
              tizimning hisoboti O'Z sahifasida ochiladi (2026-10-08). */}
          <div className="space-y-5">
            {/* Tanlov headerdagi surmada: tasma olib tashlangan (2026-10-15). */}
            {students ? (
              <StudentsReport filters={filters} onUnauthorized={onUnauthorized} departments={departments} />
            ) : platform === null ? (
              <PlatformHome
                filters={filters}
                onUnauthorized={onUnauthorized}
                onOpen={setPlatform}
              />
            ) : (
              <PlatformPage
                platform={platform}
                filters={filters}
                wide={wide}
                onUnauthorized={onUnauthorized}
                onBack={() => setPlatform(null)}
              />
            )}
          </div>
        </MetricProvider>
        </StudentProfileProvider>
        </TeacherProfileProvider>
      </main>

      <footer className="mx-auto w-full px-4 pb-10 text-center text-[11.5px] text-slate-400">
        iMentor · Farg‘ona jamoat salomatligi tibbiyot instituti
      </footer>
    </div>
  );
}
