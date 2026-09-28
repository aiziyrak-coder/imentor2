import { useCallback, useEffect, useState } from 'react';
import {
  GraduationCap,
  IdCard,
  KeyRound,
  LogOut,
  Loader2,
  Lock,
  Phone,
  ScanFace,
  ShieldCheck,
  User,
} from 'lucide-react';
import {
  clearOnlineSession,
  loadOnlineSession,
  loginListener,
  loginStudent,
  loginTeacher,
  loginWithFace,
  refreshOnlineAccess,
  type OnlineSession,
} from './onlineAuth';
import { setHttpTokenRefresher } from '../api/httpClient';
import { errText } from './onlineError';
import { BRAND, type Program } from './program';
import ChangePasswordScreen from './ChangePasswordScreen';
import FaceLogin from '../components/auth/FaceLogin';
import MalakaStudentCabinet from './MalakaStudentCabinet';
import OnlineTeacherCabinet from './OnlineTeacherCabinet';
import OnlineStudentCabinet from './OnlineStudentCabinet';
import './online.css';

/**
 * Online ta'lim portali — `onlinetalim.fermi.uz` va `malaka.fermi.uz`.
 *
 * Bu daraxt hozirgi iMentor `App` dan BUTUNLAY ajratilgan: alohida seans
 * kaliti, alohida API marshrutlari, alohida komponentlar va alohida
 * konteyner (`frontend_online`) — iMentor bilan faqat bitta backend
 * orqali bog'liq.
 *
 * Bitta portal — ikki dastur (`program`): 6-kurs masofaviy ta'lim va
 * malaka oshirish. Farqi kirishda (tinglovchi pasport bilan kiradi),
 * o'quvchi kabinetida va o'qituvchining imkoniyatlarida.
 */

type Mode = 'teacher' | 'student';

/** Kirish oynasida 401 — bu "parol xato", "seans tugadi" emas. */
function loginErrText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/401|Unauthorized/i.test(msg) && !/"detail"/.test(msg)) {
    return "Login yoki parol noto'g'ri.";
  }
  return errText(e);
}

const LOGIN_COPY: Record<Program, Record<Mode, { label: string; placeholder: string; hint: string }>> = {
  online: {
    student: {
      label: 'Talaba ID',
      placeholder: '123456',
      hint: 'OnlineTest tizimidagi ID va parolingiz bilan kiring.',
    },
    teacher: {
      label: 'Telefon raqam',
      placeholder: '998901112233',
      hint: "iMentor'dagi telefon raqamingiz va parolingiz bilan kiring.",
    },
  },
  malaka: {
    student: {
      label: 'Pasport seriyasi va raqami',
      placeholder: 'AD 1234567',
      hint: 'Birinchi kirishda login ham, parol ham — pasport seriyasi va raqamingiz. Keyin o‘z parolingizni qo‘yasiz.',
    },
    teacher: {
      label: 'Login',
      placeholder: 'oqituvchi1',
      hint: 'Fakultet bergan login va parol bilan kiring.',
    },
  },
};

function LoginScreen({
  program,
  onDone,
}: {
  program: Program;
  onDone: (s: OnlineSession, password: string) => void;
}) {
  const brand = BRAND[program];
  const [mode, setMode] = useState<Mode>('student');
  // Avval yuz orqali; yuzi ro'yxatda yo'q bo'lsa FaceLogin ostida ro'yxatdan o'tish havolasi bor.
  const [useFace, setUseFace] = useState(true);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const copy = LOGIN_COPY[program][mode];
  const FieldIcon =
    mode === 'teacher' ? (program === 'online' ? Phone : User) : program === 'malaka' ? IdCard : User;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      let session: OnlineSession;
      if (mode === 'teacher') {
        // Online portalda o'qituvchi telefon raqami bilan kiradi; malakada —
        // fakultet bergan login bilan (server uni o'zi normallashtiradi).
        session = await loginTeacher(
          program === 'online' ? login.replace(/\D/g, '') : login.trim(),
          password,
        );
      } else if (program === 'malaka') {
        session = await loginListener(login.trim(), password);
      } else {
        session = await loginStudent(login.trim(), password);
      }
      onDone(session, password);
    } catch (err) {
      setError(loginErrText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="online-root online-safe-top online-safe-bottom flex min-h-[100dvh] items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800">
            <GraduationCap size={24} className="text-white" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">{brand.title}</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">{brand.subtitle}</p>
        </div>

        {useFace ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-6 shadow-sm">
            <FaceLogin
              onUsePassword={() => setUseFace(false)}
              submitFrames={async (frames) => {
                const session = await loginWithFace(frames);
                onDone(session, '');
              }}
            />
          </div>
        ) : (
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
                {m === 'student' ? brand.learner : "O'qituvchi"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {copy.label}
              </span>
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 focus-within:border-slate-400">
                <FieldIcon size={16} className="shrink-0 text-slate-400" />
                <input
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder={copy.placeholder}
                  autoComplete="username"
                  autoCapitalize={program === 'malaka' && mode === 'student' ? 'characters' : 'none'}
                  autoCorrect="off"
                  spellCheck={false}
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
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{error}</p>
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

          <p className="mt-3 text-center text-[11.5px] leading-relaxed text-slate-400">{copy.hint}</p>
          <button
            type="button"
            onClick={() => setUseFace(true)}
            className="mt-2 flex w-full items-center justify-center gap-2 py-2 text-[13px] font-semibold text-slate-500 hover:text-slate-800"
          >
            <ScanFace size={16} />
            Yuz orqali kirish
          </button>
        </div>
        )}
      </div>
    </div>
  );
}

export default function OnlineApp({ program = 'online' }: { program?: Program }) {
  const brand = BRAND[program];
  const [session, setSession] = useState<OnlineSession | null>(null);
  const [ready, setReady] = useState(false);
  // Kirishda terilgan parol — faqat xotirada, hech qayerga yozilmaydi.
  // Majburiy almashtirishda "hozirgi parol"ni qayta so'ramaslik uchun.
  const [typedPassword, setTypedPassword] = useState('');
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    setSession(loadOnlineSession());
    setReady(true);
  }, []);

  useEffect(() => {
    document.title = brand.title;
  }, [brand.title]);

  // 401 kelganda so'rovni tokenni yangilab qaytadan yuborish. Yangilab
  // bo'lmasa — seans haqiqatan tugagan, kirish oynasiga qaytaramiz. Ilgari
  // bu yo'q edi va foydalanuvchi "HTTP 401" yozuvi bilan qolib ketardi.
  useEffect(() => {
    setHttpTokenRefresher(async () => {
      const token = await refreshOnlineAccess();
      if (!token) setSession(null);
      return token;
    });
    return () => setHttpTokenRefresher(null);
  }, []);

  const logout = useCallback(() => {
    clearOnlineSession();
    setSession(null);
    setTypedPassword('');
    setChanging(false);
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center text-slate-400">
        <Loader2 size={22} className="animate-spin" />
      </div>
    );
  }

  if (!session) {
    return (
      <LoginScreen
        program={program}
        onDone={(s, password) => {
          setSession(s);
          setTypedPassword(password);
        }}
      />
    );
  }

  if (session.mustChangePassword || changing) {
    return (
      <ChangePasswordScreen
        session={session}
        forced={Boolean(session.mustChangePassword)}
        knownPassword={session.mustChangePassword ? typedPassword : ''}
        brandTitle={brand.title}
        onDone={() => {
          setSession(loadOnlineSession());
          setChanging(false);
          setTypedPassword('');
        }}
        onCancel={() => setChanging(false)}
        onLogout={logout}
      />
    );
  }

  // Parolni faqat mahalliy hisob almashtira oladi: 6-kurs talabasi
  // OnlineTest hisobi bilan kiradi va paroli o'sha tizimda.
  const canChangePassword = program === 'malaka' || session.role === 'teacher';

  return (
    <div className="online-root min-h-[100dvh] bg-slate-50">
      <header className="online-safe-top sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-2 sm:gap-3 sm:px-4 sm:py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800">
              <GraduationCap size={17} className="text-white" />
            </div>
            <div className="min-w-0 leading-tight">
              <p className="text-[13.5px] font-bold text-slate-900">{brand.title}</p>
              <p className="truncate text-[11px] text-slate-500">
                {session.displayName}
                {session.role === 'student' && session.groupName ? ` · ${session.groupName}` : ''}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold sm:px-2 sm:text-[11px] ${
                session.role === 'teacher'
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'bg-emerald-50 text-emerald-700'
              }`}
            >
              {session.role === 'teacher' ? "O'qituvchi" : brand.learner}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {canChangePassword && (
              <button
                type="button"
                onClick={() => setChanging(true)}
                title="Parolni almashtirish"
                aria-label="Parolni almashtirish"
                className="inline-flex items-center rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-800"
              >
                <KeyRound size={15} />
              </button>
            )}
            <button
              type="button"
              onClick={logout}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12.5px] font-medium text-slate-600 hover:bg-slate-50"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">Chiqish</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-5">
        {session.role === 'teacher' ? (
          <OnlineTeacherCabinet onUnauthorized={logout} program={program} />
        ) : program === 'malaka' ? (
          <MalakaStudentCabinet />
        ) : (
          <OnlineStudentCabinet displayName={session.displayName} />
        )}
      </main>

      <footer className="online-safe-bottom mx-auto max-w-6xl px-4 pb-6 text-center text-[11.5px] text-slate-400">
        <ShieldCheck size={12} className="mr-1 inline" />
        Farg'ona jamoat salomatligi tibbiyot instituti
      </footer>
    </div>
  );
}
