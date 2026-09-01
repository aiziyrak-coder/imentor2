import { useCallback, useEffect, useState } from 'react';
import { GraduationCap, LogOut, Loader2, Lock, Phone, ShieldCheck, User } from 'lucide-react';
import {
  clearOnlineSession,
  loadOnlineSession,
  loginStudent,
  loginTeacher,
  type OnlineSession,
} from './onlineAuth';
import OnlineTeacherCabinet from './OnlineTeacherCabinet';
import OnlineStudentCabinet from './OnlineStudentCabinet';

/**
 * Online ta'lim portali — `onlinetalim.fermi.uz`.
 *
 * Bu daraxt hozirgi iMentor `App` dan BUTUNLAY ajratilgan: alohida seans
 * kaliti, alohida API marshrutlari, alohida komponentlar va alohida
 * konteyner (`frontend_online`) — iMentor bilan faqat bitta backend
 * orqali bog'liq.
 */

type Mode = 'teacher' | 'student';

function errText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/"detail"\s*:\s*"([^"]+)"/);
  if (m) return m[1];
  if (/401|Unauthorized/i.test(msg)) return "Login yoki parol noto'g'ri.";
  return msg || 'Xatolik yuz berdi.';
}

function LoginScreen({ onDone }: { onDone: (s: OnlineSession) => void }) {
  const [mode, setMode] = useState<Mode>('student');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const session =
        mode === 'teacher'
          ? await loginTeacher(login.replace(/\D/g, ''), password)
          : await loginStudent(login.trim(), password);
      onDone(session);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800">
            <GraduationCap size={24} className="text-white" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">Online ta'lim</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">
            6-kurs masofaviy ta'lim portali
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
            {(['student', 'teacher'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError('');
                }}
                className={`rounded-lg py-2 text-[13px] font-semibold transition ${
                  mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
              >
                {m === 'student' ? 'Talaba' : "O'qituvchi"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {mode === 'student' ? 'Talaba ID' : 'Telefon raqam'}
              </span>
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 focus-within:border-slate-400">
                {mode === 'student' ? (
                  <User size={16} className="shrink-0 text-slate-400" />
                ) : (
                  <Phone size={16} className="shrink-0 text-slate-400" />
                )}
                <input
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder={mode === 'student' ? '123456' : '998901112233'}
                  autoComplete="username"
                  className="w-full bg-transparent py-2.5 text-[14px] outline-none"
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Parol
              </span>
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 focus-within:border-slate-400">
                <Lock size={16} className="shrink-0 text-slate-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="w-full bg-transparent py-2.5 text-[14px] outline-none"
                />
              </div>
            </label>

            {error && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !login.trim() || !password}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 py-3 text-[14px] font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
            >
              {busy ? <Loader2 size={18} className="animate-spin" /> : null}
              Kirish
            </button>
          </form>

          <p className="mt-3 text-center text-[11.5px] text-slate-400">
            {mode === 'student'
              ? "OnlineTest tizimidagi ID va parolingiz bilan kiring."
              : "iMentor'dagi telefon raqamingiz va parolingiz bilan kiring."}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function OnlineApp() {
  const [session, setSession] = useState<OnlineSession | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSession(loadOnlineSession());
    setReady(true);
  }, []);

  const logout = useCallback(() => {
    clearOnlineSession();
    setSession(null);
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        <Loader2 size={22} className="animate-spin" />
      </div>
    );
  }

  if (!session) return <LoginScreen onDone={setSession} />;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800">
              <GraduationCap size={17} className="text-white" />
            </div>
            <div className="leading-tight">
              <p className="text-[13.5px] font-bold text-slate-900">Online ta'lim</p>
              <p className="text-[11px] text-slate-500">
                {session.role === 'teacher' ? "O'qituvchi" : 'Talaba'} · {session.displayName}
                {session.role === 'student' && session.groupName ? ` · ${session.groupName}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12.5px] font-medium text-slate-600 hover:bg-slate-50"
          >
            <LogOut size={14} />
            Chiqish
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5">
        {session.role === 'teacher' ? (
          <OnlineTeacherCabinet onUnauthorized={logout} />
        ) : (
          <OnlineStudentCabinet displayName={session.displayName} />
        )}
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-6 text-center text-[11.5px] text-slate-400">
        <ShieldCheck size={12} className="mr-1 inline" />
        Farg'ona jamoat salomatligi tibbiyot instituti
      </footer>
    </div>
  );
}
