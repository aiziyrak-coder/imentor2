import React, { useEffect, useState } from 'react';
import { Loader2, AlertCircle, Phone, Lock } from 'lucide-react';
import { motion } from 'motion/react';
import { ensureDefaultRoleDemosExist, isValidStaffLogin } from '../../utils/localStaffAuth';
import {
  FaceLoginError,
  getBackendAccessToken,
  isPinfl,
  loginStaffWithBackendFallback,
  loginWithPinfl,
  syncSessionRoleFromServer,
} from '../../utils/backendAuth';
import { useUiText } from '../../i18n/useUiText';

interface LoginPageProps {
  /** Kompyuterda QR ekraniga o'tish. */
  onWantsHodimQr?: () => void;
  /** Yuz orqali kirish ekraniga qaytish. */
  onWantsFace?: () => void;
}

/**
 * Login va parol bilan kirish.
 *
 * Kompyuterda bu oyna faqat `imentor.uz/admin` manzilida ochiladi; xodim
 * telefonda kiradi (joylashuv shu yerda qayd etiladi). Ro'yxatdan o'tish
 * havolasi olib tashlandi — hisob faqat administrator orqali ochiladi
 * (2026-10-02).
 */
export default function LoginPage({ onWantsHodimQr, onWantsFace }: LoginPageProps) {
  const { t } = useUiText();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureDefaultRoleDemosExist();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    // Xodim telefon raqami YOKI Xodim ID (tabel raqami) bilan kira oladi.
    if (!isValidStaffLogin(phone)) {
      setError(t('auth.staffLoginRequired'));
      return;
    }
    setLoading(true);
    try {
      // JSHSHIR va bo'sh parol — cam.fermi.uz tasdig'i bilan kirish. Parol yozilgan
      // bo'lsa avvalgidek: JSHSHIR/login + parol.
      if (isPinfl(phone) && !password) {
        await loginWithPinfl(phone);
      } else {
        await loginStaffWithBackendFallback(phone, password);
      }
      await getBackendAccessToken();
      await syncSessionRoleFromServer();
    } catch (err: unknown) {
      if (err instanceof FaceLoginError) {
        setError(err.detail || t('auth.loginError'));
        return;
      }
      const code = err instanceof Error ? err.message : '';
      if (code === 'user-not-found' || code === 'wrong-password') {
        setError(t('auth.wrongCredentialsRegister'));
      } else if (code === 'account-disabled') {
        const detail = (err as { detail?: string }).detail;
        setError(detail || t('auth.accountDisabled'));
      } else {
        setError(t('auth.loginError'));
        console.error(err);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-md"
    >
      <div className="ios-glass rounded-[2rem] border border-white/60 shadow-xl p-8 md:p-10">
        <div className="text-center mb-8">
          <img
            src="/imentor-logo.png"
            alt="iMentor"
            className="mx-auto w-16 h-16 rounded-2xl object-cover border border-white/70 shadow-lg mb-4 bg-white"
          />
          <h1 className="text-2xl font-bold text-black/90 tracking-tight">{t('auth.loginTitle')}</h1>
          <p className="text-[13px] text-black/50 mt-2 font-medium">{t('auth.loginSubtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-black/55 uppercase tracking-wide">
              {t('auth.staffLoginLabel')}
            </label>
            <div className="relative">
              <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-black/35" size={18} />
              <input
                type="text"
                inputMode="text"
                autoComplete="username"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white/70 py-3.5 pl-12 pr-4 text-[15px] font-medium text-black/90 outline-none focus:ring-2 focus:ring-blue-500/40"
                placeholder={t('auth.staffLoginPlaceholder')}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-black/55 uppercase tracking-wide">{t('auth.passwordLabel')}</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-black/35" size={18} />
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white/70 py-3.5 pl-12 pr-4 text-[15px] font-medium text-black/90 outline-none focus:ring-2 focus:ring-blue-500/40"
                placeholder={t('auth.passwordPlaceholder')}
              />
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-700">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600 py-3.5 text-[15px] font-semibold text-white shadow-md shadow-blue-600/25 transition hover:bg-blue-500 disabled:opacity-60"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : null}
            {t('auth.submitLogin')}
          </button>

          {onWantsFace && (
            <button
              type="button"
              onClick={onWantsFace}
              className="w-full text-center text-[12.5px] font-semibold text-blue-600 hover:underline"
            >
              {t('auth.face.useFace')}
            </button>
          )}

          {onWantsHodimQr && (
            <button
              type="button"
              onClick={onWantsHodimQr}
              className="w-full text-center text-[12.5px] font-semibold text-blue-600 hover:underline"
            >
              {t('auth.qrLoginLink')}
            </button>
          )}
        </form>

        <p className="mt-6 text-center text-[13px] text-black/50">{t('auth.accountsByAdmin')}</p>
      </div>
    </motion.div>
  );
}
