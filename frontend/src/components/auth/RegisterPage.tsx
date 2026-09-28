import React, { useEffect, useState } from 'react';
import { Loader2, AlertCircle, Phone, Lock, Building2, Users, BookOpen } from 'lucide-react';
import { motion } from 'motion/react';
import {
  isValidPhoneDigits,
  normalizePhoneDigits,
  isDemoAuthEnabled,
  TEST_STAFF_PHONE,
} from '../../utils/localStaffAuth';
import { registerStaffWithBackend } from '../../utils/backendAuth';
import { HttpError } from '../../api/httpClient';
import { useUiText } from '../../i18n/useUiText';
import { fetchPublicKafedralar, type PublicKafedra } from '../../utils/academicCatalogApi';

const emptyRegisterDefaults = {
  phone: '+998',
  password: '',
  confirmPassword: '',
  firstName: '',
  lastName: '',
  faculty: '',
  department: '',
  direction: '',
};

interface RegisterPageProps {
  onSwitchToLogin: () => void;
  onBackToQr?: () => void;
}

export default function RegisterPage({ onSwitchToLogin, onBackToQr }: RegisterPageProps) {
  const { t } = useUiText();
  const demoStaffPassword = (import.meta.env.VITE_DEMO_STAFF_PASSWORD || '').trim();
  // Faqat mahalliy dev: productionda forma test hisobining telefoni va paroli bilan
  // to'ldirilib kelardi va "Ro'yxatdan o'tish" bosilsa odam Test Hodim hisobiga kirib qolardi.
  const demoDefaults = import.meta.env.DEV && isDemoAuthEnabled() && demoStaffPassword.length >= 6
    ? {
        phone: TEST_STAFF_PHONE,
        password: demoStaffPassword,
        confirmPassword: demoStaffPassword,
        firstName: 'Test',
        lastName: 'Hodim',
        faculty: 'Tibbiyot fakulteti',
        department: 'Ichki kasalliklar kafedrasi',
        direction: "Terapiya yo'nalishi",
      }
    : emptyRegisterDefaults;
  const [phone, setPhone] = useState(demoDefaults.phone);
  const [password, setPassword] = useState(demoDefaults.password);
  const [confirmPassword, setConfirmPassword] = useState(demoDefaults.confirmPassword);
  const [firstName, setFirstName] = useState(demoDefaults.firstName);
  const [lastName, setLastName] = useState(demoDefaults.lastName);
  const [faculty, setFaculty] = useState(demoDefaults.faculty);
  const [department, setDepartment] = useState(demoDefaults.department);
  const [direction, setDirection] = useState(demoDefaults.direction);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kafedra ro'yxati backenddan keladi — xodim shundan tanlaydi.
  const [kafedralar, setKafedralar] = useState<PublicKafedra[]>([]);
  const [manualDepartment, setManualDepartment] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetchPublicKafedralar()
      .then((rows) => {
        if (!alive) return;
        setKafedralar(rows);
        if (rows.length === 0) setManualDepartment(true);
      })
      .catch(() => {
        if (alive) setManualDepartment(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const selectedKafedra = kafedralar.find((k) => k.name === department) || null;
  const directionOptions = selectedKafedra?.directions ?? [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!firstName.trim() || !lastName.trim()) {
      setError(t('auth.register.errorName'));
      return;
    }
    if (!faculty.trim() || !department.trim() || !direction.trim()) {
      setError(t('auth.register.errorFields'));
      return;
    }

    const digits = normalizePhoneDigits(phone);
    if (!isValidPhoneDigits(digits)) {
      setError(t('auth.register.errorPhone'));
      return;
    }
    if (password.length < 6) {
      setError(t('auth.register.errorPasswordShort'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('auth.register.errorPasswordMismatch'));
      return;
    }
    setLoading(true);
    try {
      await registerStaffWithBackend({
        phoneDisplay: phone.trim(),
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        faculty: faculty.trim(),
        department: department.trim(),
        direction: direction.trim(),
        role: 'hodim',
      });
    } catch (err: unknown) {
      const code = err instanceof Error ? err.message : '';
      if (err instanceof HttpError && err.status === 403) {
        setError(t('auth.register.errorDisabled'));
      } else if (err instanceof HttpError && err.status === 409) {
        setError(t('auth.register.errorExists'));
      } else if (code === 'already-exists') {
        setError(t('auth.register.errorExists'));
      } else if (code === 'weak-password') {
        setError(t('auth.register.errorWeak'));
      } else {
        setError(t('auth.register.errorGeneric'));
      }
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-lg"
    >
      <div className="ios-glass rounded-[2rem] border border-white/60 shadow-xl p-8 md:p-10 max-h-[90vh] overflow-y-auto scrollbar-hide">
        <div className="text-center mb-6">
          <img
            src="/imentor-logo.png"
            alt="iMentor"
            className="mx-auto w-16 h-16 rounded-2xl object-cover border border-white/70 shadow-lg mb-4 bg-white"
          />
          <h1 className="text-2xl font-bold text-black/90 tracking-tight">{t('auth.register.title')}</h1>
          <p className="text-[13px] text-black/50 mt-2 font-medium">
            {t('auth.register.subtitle')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-black/55">{t('auth.register.firstName')}</label>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white/70 px-4 py-3 text-[14px] font-medium outline-none focus:ring-2 focus:ring-emerald-500/35"
                placeholder={t('auth.register.firstName')}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-black/55">{t('auth.register.lastName')}</label>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white/70 px-4 py-3 text-[14px] font-medium outline-none focus:ring-2 focus:ring-emerald-500/35"
                placeholder={t('auth.register.lastName')}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-black/55 flex items-center gap-1">
              <Building2 size={12} /> {t('auth.register.faculty')}
            </label>
            <input
              value={faculty}
              onChange={(e) => setFaculty(e.target.value)}
              className="w-full rounded-xl border border-black/10 bg-white/70 px-4 py-3 text-[14px] font-medium outline-none focus:ring-2 focus:ring-emerald-500/35"
              placeholder={t('auth.register.facultyPlaceholder')}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-black/55 flex items-center gap-1">
              <Users size={12} /> {t('auth.register.department')}
            </label>
            {manualDepartment ? (
              <input
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white/70 px-4 py-3 text-[14px] font-medium outline-none focus:ring-2 focus:ring-emerald-500/35"
                placeholder={t('auth.register.departmentPlaceholder')}
              />
            ) : (
              <select
                value={department}
                onChange={(e) => {
                  if (e.target.value === '__manual__') {
                    setManualDepartment(true);
                    setDepartment('');
                    setDirection('');
                    return;
                  }
                  setDepartment(e.target.value);
                  setDirection('');
                }}
                className="w-full rounded-xl border border-black/10 bg-white/70 px-4 py-3 text-[14px] font-medium outline-none focus:ring-2 focus:ring-emerald-500/35"
              >
                <option value="">{t('auth.register.departmentSelect')}</option>
                {kafedralar.map((k) => (
                  <option key={k.name} value={k.name}>{k.name}</option>
                ))}
                <option value="__manual__">{t('auth.register.departmentManual')}</option>
              </select>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-black/55 flex items-center gap-1">
              <BookOpen size={12} /> {t('auth.register.direction')}
            </label>
            {directionOptions.length > 0 ? (
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white/70 px-4 py-3 text-[14px] font-medium outline-none focus:ring-2 focus:ring-emerald-500/35"
              >
                <option value="">{t('auth.register.directionSelect')}</option>
                {directionOptions.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            ) : (
              <input
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white/70 px-4 py-3 text-[14px] font-medium outline-none focus:ring-2 focus:ring-emerald-500/35"
                placeholder={t('auth.register.directionPlaceholder')}
              />
            )}
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-black/55">{t('auth.register.phoneNumber')}</label>
            <div className="relative">
              <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-black/35" size={18} />
              <input
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white/70 py-3 pl-12 pr-4 text-[14px] font-medium outline-none focus:ring-2 focus:ring-emerald-500/35"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-black/55">{t('auth.register.password')}</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-black/35" size={18} />
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-black/10 bg-white/70 py-3 pl-12 pr-4 text-[14px] font-medium outline-none focus:ring-2 focus:ring-emerald-500/35"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-black/55">{t('auth.register.confirmPassword')}</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-black/35" size={18} />
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-xl border border-black/10 bg-white/70 py-3 pl-12 pr-4 text-[14px] font-medium outline-none focus:ring-2 focus:ring-emerald-500/35"
                />
              </div>
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
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3.5 text-[15px] font-semibold text-white shadow-md transition hover:bg-emerald-500 disabled:opacity-60"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : null}
            {t('auth.register.submit')}
          </button>
        </form>

        <p className="mt-6 text-center text-[13px] text-black/50">
          {t('auth.register.hasAccount')}{' '}
          <button type="button" onClick={onSwitchToLogin} className="font-semibold text-blue-600 hover:underline">
            {t('auth.register.login')}
          </button>
        </p>
      </div>
    </motion.div>
  );
}
