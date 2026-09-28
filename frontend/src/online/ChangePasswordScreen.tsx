import { useState } from 'react';
import { KeyRound, Loader2, Lock, LogOut } from 'lucide-react';
import { changePassword, type OnlineSession } from './onlineAuth';
import { errText } from './onlineError';

/**
 * Parolni almashtirish.
 *
 * Majburiy rejim: hisob boshqa odam bergan parol bilan yaratilgan —
 * tinglovchida pasport raqami, o'qituvchida hammaga bir xil boshlang'ich
 * parol. Ikkalasi ham boshqalarga ma'lum, shuning uchun portal o'z parolini
 * qo'ymaguncha ochilmaydi (server ham shunday qiladi).
 */

const MIN = 6;

/** Server bilan bir xil erkin taqqoslash: "AD 2383789" = "ad2383789". */
function loose(value: string): string {
  return value.replace(/[^0-9a-z]/gi, '').toUpperCase();
}

export default function ChangePasswordScreen({
  session,
  forced,
  knownPassword = '',
  brandTitle,
  onDone,
  onCancel,
  onLogout,
}: {
  session: OnlineSession;
  forced: boolean;
  /** Kirishda terilgan parol — "hozirgi parol"ni qayta so'ramaslik uchun. */
  knownPassword?: string;
  brandTitle: string;
  onDone: () => void;
  onCancel: () => void;
  onLogout: () => void;
}) {
  const [current, setCurrent] = useState(knownPassword);
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Hozirgi parol maydoni faqat kerak bo'lsa ko'rinadi.
  const askCurrent = !knownPassword || /joriy parol/i.test(error);

  const problem =
    next && next.length < MIN
      ? `Kamida ${MIN} ta belgi bo‘lsin.`
      : next && loose(next) === loose(session.username)
        ? 'Parol loginingiz bilan bir xil bo‘lmasin.'
        : again && next !== again
          ? 'Takroriy parol mos emas.'
          : '';
  const canSubmit = Boolean(current) && next.length >= MIN && next === again && !problem && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      await changePassword(current, next);
      onDone();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
    autoComplete: string,
    autoFocus = false,
  ) => (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 focus-within:border-slate-400">
        <Lock size={16} className="shrink-0 text-slate-400" />
        <input
          type="password"
          value={value}
          onChange={(e) => set(e.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          className="w-full bg-transparent py-2.5 text-[14px] outline-none"
        />
      </div>
    </label>
  );

  return (
    <div className="online-root online-safe-top online-safe-bottom flex min-h-[100dvh] items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800">
            <KeyRound size={22} className="text-white" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">
            {forced ? 'O‘z parolingizni qo‘ying' : 'Parolni almashtirish'}
          </h1>
          <p className="mx-auto mt-1 max-w-xs text-[13px] leading-relaxed text-slate-500">
            {forced
              ? `Boshlang‘ich parol boshqalarga ham ma’lum. ${brandTitle} portaliga kirishdan oldin faqat o‘zingiz biladigan parol qo‘ying.`
              : 'Yangi parol keyingi kirishdan boshlab ishlaydi.'}
          </p>
        </div>

        <form
          onSubmit={submit}
          className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">
            Login: <span className="font-mono font-semibold text-slate-900">{session.username}</span>
          </p>

          {askCurrent && field('Hozirgi parol', current, setCurrent, 'current-password')}
          {field('Yangi parol', next, setNext, 'new-password', !askCurrent)}
          {field('Yangi parolni takrorlang', again, setAgain, 'new-password')}

          <p className={`text-[12px] ${problem ? 'text-rose-600' : 'text-slate-400'}`}>
            {problem || `Kamida ${MIN} ta belgi. Harf va raqamni aralashtirsangiz yaxshi.`}
          </p>

          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{error}</p>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 py-3 text-[14px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {busy && <Loader2 size={18} className="animate-spin" />}
            {forced ? 'Saqlash va davom etish' : 'Saqlash'}
          </button>

          <button
            type="button"
            onClick={forced ? onLogout : onCancel}
            className="flex w-full items-center justify-center gap-1.5 py-1 text-[13px] font-medium text-slate-500 hover:text-slate-800"
          >
            {forced ? (
              <>
                <LogOut size={14} />
                Chiqish
              </>
            ) : (
              'Bekor qilish'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
