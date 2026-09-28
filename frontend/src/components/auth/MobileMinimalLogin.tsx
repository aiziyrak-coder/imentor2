import React, { useState } from 'react';
import { Loader2, Lock, Phone } from 'lucide-react';
import { isValidStaffLogin } from '../../utils/localStaffAuth';
import {
  getBackendAccessToken,
  loginStaffWithBackendFallback,
  syncSessionRoleFromServer,
} from '../../utils/backendAuth';
import { HttpError } from '../../api/httpClient';
import { useUiText } from '../../i18n/useUiText';

type Props = {
  onSwitchToRegister?: () => void;
  /** Yuz orqali kirish ekraniga qaytish. */
  onUseFace?: () => void;
};

/**
 * Telefon uchun soddalashtirilgan kirish ekrani.
 *
 * Faqat xodim (o'qituvchi): telefon raqami yoki Xodim ID (tabel raqami) va
 * parol. Talaba kirishi olib tashlangan — talabalar uchun iMentor'da ish yo'q.
 */
export default function MobileMinimalLogin({ onSwitchToRegister, onUseFace }: Props) {
  const { t } = useUiText();
  const [staffLogin, setStaffLogin] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isValidStaffLogin(staffLogin)) {
      setError(t('auth.staffLoginRequired'));
      return;
    }
    if (!password.trim()) {
      setError(t('auth.mobileLogin.passwordRequired'));
      return;
    }
    setLoading(true);
    try {
      await loginStaffWithBackendFallback(staffLogin, password);
      await getBackendAccessToken();
      await syncSessionRoleFromServer();
    } catch (err) {
      if (err instanceof HttpError && (err.status === 0 || err.message.includes('abort'))) {
        setError(t('auth.mobileLogin.connectionError'));
      } else if (err instanceof Error && err.message === 'account-disabled') {
        setError((err as { detail?: string }).detail || t('auth.accountDisabled'));
      } else {
        setError(t('auth.mobileLogin.wrongCredentials'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-[100dvh] flex flex-col justify-center px-6 py-10 bg-[#f8fafc]"
      style={{ paddingTop: 'max(2rem, env(safe-area-inset-top))', paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}
    >
      <div className="w-full max-w-[340px] mx-auto">
        <div className="flex justify-center mb-8">
          <img
            src="/imentor-logo.png"
            alt="iMentor"
            className="w-20 h-20 rounded-[22px] object-cover shadow-lg border border-white"
          />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input
              type="text"
              inputMode="text"
              autoComplete="username"
              value={staffLogin}
              onChange={(e) => setStaffLogin(e.target.value)}
              placeholder={t('auth.staffLoginLabel')}
              className="w-full h-14 rounded-2xl border border-slate-200 bg-white pl-12 pr-4 text-[17px] text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
            />
          </div>

          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('auth.mobileLogin.passwordLabel')}
              className="w-full h-14 rounded-2xl border border-slate-200 bg-white pl-12 pr-4 text-[17px] text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
            />
          </div>

          <p className="text-center text-[13px] leading-relaxed text-slate-500">
            {t('auth.staffLoginPlaceholder')}
          </p>

          {error && (
            <p className="text-center text-[14px] text-rose-600 font-medium">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-14 rounded-2xl bg-sky-600 text-white text-[17px] font-semibold shadow-lg shadow-sky-600/25 active:scale-[0.98] transition disabled:opacity-60 flex items-center justify-center"
          >
            {loading ? <Loader2 className="animate-spin" size={24} /> : t('auth.mobileLogin.submit')}
          </button>

          {onUseFace && (
            <button
              type="button"
              onClick={onUseFace}
              className="w-full h-12 rounded-2xl bg-white text-[15px] font-semibold text-sky-700 ring-1 ring-slate-200"
            >
              {t('auth.face.useFace')}
            </button>
          )}

          {onSwitchToRegister && (
            <p className="text-center text-[14px] text-slate-500 pt-2">
              {t('auth.mobileLogin.noAccount')}{' '}
              <button
                type="button"
                onClick={onSwitchToRegister}
                className="font-semibold text-sky-700 underline underline-offset-2"
              >
                {t('auth.mobileLogin.register')}
              </button>
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
