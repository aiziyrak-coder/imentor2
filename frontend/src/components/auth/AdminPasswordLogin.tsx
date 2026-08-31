import React, { useState } from 'react';
import { ArrowLeft, AlertCircle, Loader2, Lock, Phone, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import {
  isValidPhoneDigits,
  normalizePhoneDigits,
  normalizeUserRole,
  logoutLocalStaff,
} from '../../utils/localStaffAuth';
import {
  getBackendAccessToken,
  loginStaffWithBackendFallback,
  syncSessionRoleFromServer,
} from '../../utils/backendAuth';
import { useUiText } from '../../i18n/useUiText';

interface AdminPasswordLoginProps {
  onBack: () => void;
}

/** Faqat administrator uchun telefon+parol bilan kirish — hodim shu ekrandan
 * kira olmaydi (kompyuterda faqat QR orqali kiradi), agar hodim telefoni
 * kiritilsa xatolik chiqadi. QR ekranidan "Boshqa rollar" orqali ochiladi. */
export default function AdminPasswordLogin({ onBack }: AdminPasswordLoginProps) {
  const { t } = useUiText();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = async (phoneVal: string, passwordVal: string) => {
    setError(null);
    const digits = normalizePhoneDigits(phoneVal);
    if (!isValidPhoneDigits(digits)) {
      setError(t('auth.phoneRequired'));
      return;
    }
    setLoading(true);
    try {
      const u = await loginStaffWithBackendFallback(phoneVal, passwordVal);
      if (normalizeUserRole(u) === 'hodim') {
        setError(t('auth.hodimDesktopRestriction'));
        logoutLocalStaff();
        return;
      }
      await getBackendAccessToken();
      await syncSessionRoleFromServer();
    } catch (err: unknown) {
      const code = err instanceof Error ? err.message : '';
      setError(code === 'user-not-found' || code === 'wrong-password' ? t('auth.wrongCredentials') : t('auth.loginError'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void login(phone, password);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-md mx-auto"
    >
      <div className="ios-glass rounded-[2rem] border border-white/60 shadow-xl p-8 md:p-10">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-[12px] font-semibold text-sky-700 hover:text-sky-800 mb-5"
        >
          <ArrowLeft size={14} />
          {t('auth.backButton')}
        </button>

        <div className="text-center mb-6">
          <div className="mx-auto w-11 h-11 rounded-2xl bg-slate-800 text-white flex items-center justify-center shadow-lg mb-3">
            <ShieldCheck size={22} />
          </div>
          <h1 className="text-xl font-bold text-black/90 tracking-tight">{t('auth.adminLoginTitle')}</h1>
          <p className="text-[12px] text-black/45 mt-1 font-medium">{t('auth.adminLoginSubtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-black/55 uppercase tracking-wide">{t('auth.phoneLabel')}</label>
            <div className="relative">
              <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-black/35" size={18} />
              <input
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white/70 py-3.5 pl-12 pr-4 text-[15px] font-medium text-black/90 outline-none focus:ring-2 focus:ring-blue-500/40"
                placeholder="+998 90 123 45 67"
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
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-slate-800 py-3.5 text-[15px] font-semibold text-white shadow-md shadow-slate-800/25 transition hover:bg-slate-700 disabled:opacity-60"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : null}
            {t('auth.submitLogin')}
          </button>
        </form>
      </div>
    </motion.div>
  );
}
