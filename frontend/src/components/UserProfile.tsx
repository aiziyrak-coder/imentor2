import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import {
  User, 
  Mail, 
  Phone, 
  Lock, 
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  Camera,
  LogOut,
  Save,
  GraduationCap,
  Pencil,
} from 'lucide-react';
import StaffTeachingSubjectsPicker from './staff/StaffTeachingSubjectsPicker';
import { fetchMyCourseSelections, type CourseSyllabusRow } from '../utils/syllabusApi';
import { localizedProfileValue } from '../utils/demoProfileI18n';
import { localizedSubjectName } from '../utils/syllabusI18n';
import { cacheSyllabusRows } from '../utils/syllabusRowCache';
import {
  getCurrentLocalUser,
  logoutLocalStaff,
  subscribeLocalAuth,
  updateCurrentLocalUser,
  normalizeUserRole,
  type LocalStaffUser,
} from '../utils/localStaffAuth';
import {
  clearBackendAuthTokens,
  syncCurrentUserPasswordToBackend,
} from '../utils/backendAuth';
import { roleLabel as translateRoleLabel } from '../i18n/translations';
import { useUiText } from '../i18n/useUiText';
import { HttpError } from '../api/httpClient';
import StaffPageLayout from './staff/StaffPageLayout';
import { staffBtnPrimary, STAFF_HEADING } from './staff/staffUi';
import { AVATAR_ACCEPT, fileToAvatarBlob } from '../utils/profilePhoto';
import {
  deleteStaffAvatarOnServer,
  resolveProfilePhotoUrl,
  uploadStaffAvatar,
} from '../utils/profilePhotoApi';

/** Serverning haqiqiy sababini ko'rsatadi — umumiy "xatolik" emas. */
function passwordErrorText(err: unknown, t: (k: string) => string): string {
  if (err instanceof Error && err.message === 'no-backend-token') {
    return t('profile.passwordSessionExpired');
  }
  if (err instanceof HttpError) {
    const detail = (err.body as { detail?: string } | null)?.detail;
    if (typeof detail === 'string' && detail.trim()) return detail.trim();
    if (err.status === 401 || err.status === 403) return t('profile.passwordSessionExpired');
  }
  return t('profile.passwordError');
}

/**
 * Sahifadagi barcha kartochkalar uchun yagona ko'rinish.
 *
 * Ilgari har blok o'z sinflarini takrorlardi: birida `rounded-[2rem]`,
 * boshqasida `rounded-2xl`, soyalar ham har xil edi. Bitta joyda turgani
 * uchun endi sahifa bir butun bo'lib ko'rinadi.
 */
const CARD = 'rounded-2xl bg-white ring-1 ring-slate-900/[0.06]';

/** Kartochka sarlavhasi: rangli belgi, nom va ixtiyoriy amal. */
function SectionHead({
  icon: Icon,
  tint,
  title,
  action,
}: {
  icon: typeof User;
  tint: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 border-b border-slate-900/[0.06] px-5 py-4 sm:px-6">
      <Icon size={15} className={`shrink-0 ${tint}`} />
      <h3 className="min-w-0 flex-1 truncate text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        {title}
      </h3>
      {action}
    </div>
  );
}

/**
 * Matn maydoni.
 *
 * Telefonda shrift 16px: undan kichik bo'lsa iOS maydonga bosilganda
 * sahifani kattalashtirib yuboradi va foydalanuvchi uni qo'lda
 * qaytarishga majbur bo'ladi.
 */
function Field({
  label,
  icon: Icon,
  value,
  onChange,
  placeholder,
  readOnly,
  hint,
  inputMode,
}: {
  label: string;
  icon: typeof User;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  hint?: string;
  inputMode?: 'text' | 'tel' | 'email';
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block px-0.5 text-[12.5px] font-semibold text-black/55">{label}</span>
      <span className="relative block">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-black/30">
          <Icon size={17} />
        </span>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          readOnly={readOnly}
          inputMode={inputMode}
          className={`w-full rounded-xl border py-3 pl-11 pr-4 text-[16px] font-medium transition sm:text-[14px] ${
            readOnly
              ? 'cursor-not-allowed border-black/[0.05] bg-slate-50 text-black/45'
              : 'border-black/[0.08] bg-white text-black/80 focus:border-blue-400 focus:outline-none focus:ring-4 focus:ring-blue-500/10'
          }`}
        />
      </span>
      {hint && <span className="mt-1.5 block px-0.5 text-[11.5px] text-black/40">{hint}</span>}
    </label>
  );
}

/** Muvaffaqiyat yoki xato xabari. */
function Notice({ message }: { message: { text: string; type: 'success' | 'error' } }) {
  const ok = message.type === 'success';
  return (
    <div
      className={`flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-[13px] font-medium ${
        ok
          ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
          : 'bg-rose-50 text-rose-700 ring-1 ring-rose-100'
      }`}
    >
      {ok ? (
        <CheckCircle2 size={17} className="mt-px shrink-0" />
      ) : (
        <AlertCircle size={17} className="mt-px shrink-0" />
      )}
      <span className="min-w-0 flex-1">{message.text}</span>
    </div>
  );
}

/**
 * Ko'z tugmasi bilan parol maydoni.
 *
 * Parol maydonlari yulduzcha ko'rsatgani uchun foydalanuvchi nima
 * terganini ko'rmaydi: brauzer avtoto'ldirgan eski parol, tasodifan
 * yoqilgan Caps Lock yoki qo'shimcha bo'sh joy — hammasi bir xil
 * nuqtalar bo'lib turadi va server "joriy parol noto'g'ri" deydi.
 *
 * Modul darajasida turibdi: komponent ichida e'lon qilinsa, har bir
 * harfda qaytadan yaratilib, kursor maydondan chiqib ketardi.
 */
function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  autoComplete,
  minLength,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  minLength?: number;
  hint?: React.ReactNode;
}) {
  const [shown, setShown] = useState(false);
  return (
    <label className="block">
      <span className="mb-1.5 block px-0.5 text-[12.5px] font-semibold text-black/55">{label}</span>
      <span className="relative block">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-black/30">
          <Lock size={17} />
        </span>
        <input
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          minLength={minLength}
          autoComplete={autoComplete}
          className="w-full rounded-xl border border-black/[0.08] bg-white py-3 pl-11 pr-12 text-[16px] font-medium text-black/80 transition focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-500/10 sm:text-[14px]"
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-label={label}
          aria-pressed={shown}
          tabIndex={-1}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-black/30 transition hover:text-violet-600"
        >
          {shown ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </span>
      {hint}
    </label>
  );
}

/** Sozlamalar ichida (embedded) o'z sahifa qobig'isiz — tashqi sahifa paddingi takrorlanmasin. */
function PageShell({ embedded, children }: { embedded: boolean; children: React.ReactNode }) {
  if (embedded) return <div className="space-y-5">{children}</div>;
  return <StaffPageLayout className="flex flex-col h-full">{children}</StaffPageLayout>;
}

/**
 * `embedded` — o'qituvchi sozlamalari ichida: ism va fanlar u yerda alohida bo'limda
 * (serverga saqlanadi), bu yerda takror ko'rsatilmaydi — faqat rasm va parol qoladi.
 */
export default function UserProfile({ embedded = false }: { embedded?: boolean } = {}) {
  const { t, language } = useUiText();
  const [user, setUser] = useState<LocalStaffUser | null>(() => getCurrentLocalUser());
  
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{text: string, type: 'success' | 'error'} | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loadingPassword, setLoadingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{text: string, type: 'success' | 'error'} | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarMessage, setAvatarMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [editingSubjects, setEditingSubjects] = useState(false);
  const [subjectRows, setSubjectRows] = useState<CourseSyllabusRow[]>([]);
  const [subjectsLoading, setSubjectsLoading] = useState(false);

  const isGoogleAuth = false;
  const isHodim = Boolean(user && normalizeUserRole(user) === 'hodim');

  const reloadSubjects = async () => {
    if (!isHodim) return;
    setSubjectsLoading(true);
    try {
      const rows = await fetchMyCourseSelections();
      const seen = new Set<number>();
      const unique: CourseSyllabusRow[] = [];
      for (const row of rows) {
        if (!row.syllabus || seen.has(row.syllabus.id)) continue;
        seen.add(row.syllabus.id);
        unique.push(row.syllabus);
      }
      // Fan nomi XOM holda saqlanmaydi — til almashganda ham to'g'ri
      // ko'rinishi uchun qator saqlanadi va render paytida o'giriladi.
      setSubjectRows(unique);
      cacheSyllabusRows(unique);
    } catch {
      setSubjectRows([]);
    } finally {
      setSubjectsLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
      setPhone(user.phoneDisplay);
    }
  }, [user]);

  useEffect(() => subscribeLocalAuth(() => setUser(getCurrentLocalUser())), []);

  useEffect(() => {
    if (!isHodim) return;
    void reloadSubjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on role/user change
  }, [user?.uid, isHodim]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    setLoadingProfile(true);
    setProfileMessage(null);
    try {
      const parts = displayName.trim().split(/\s+/);
      const firstName = parts[0] || user.firstName;
      const lastName = parts.slice(1).join(' ') || user.lastName;
      const updated = updateCurrentLocalUser({
        displayName: displayName.trim(),
        firstName,
        lastName,
        phoneDisplay: phone.trim(),
      });
      setUser(updated);
      setProfileMessage({ text: t('profile.updateSuccess'), type: 'success' });
      
      setTimeout(() => setProfileMessage(null), 3000);
    } catch (err) {
      console.error(err);
      setProfileMessage({ text: t('profile.updateError'), type: 'error' });
    } finally {
      setLoadingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (newPassword !== confirmPassword) {
      setPasswordMessage({ text: t('profile.passwordMismatch'), type: 'error' });
      return;
    }

    if (newPassword.length < 6) {
      setPasswordMessage({ text: t('profile.passwordTooShort'), type: 'error' });
      return;
    }

    setLoadingPassword(true);
    setPasswordMessage(null);
    
    try {
      await syncCurrentUserPasswordToBackend(currentPassword, newPassword);
      setPasswordMessage({ text: t('profile.passwordSuccess'), type: 'success' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      console.error(err);
      // Ilgari har qanday nosozlik — muddati o'tgan seans, tarmoq
      // uzilishi, tashqi tizim orqali kiradigan hisob — bir xil xabar
      // bilan tugardi. Foydalanuvchi to'g'ri parolini yozib turib
      // "parol noto'g'ri" degan javob olardi va nima qilishni bilmasdi.
      setPasswordMessage({ text: passwordErrorText(err, t), type: 'error' });
    } finally {
      setLoadingPassword(false);
    }
  };

  const handleLogout = async () => {
    clearBackendAuthTokens();
    logoutLocalStaff();
  };

  const handleAvatarFile = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file || !user) return;
    setUploadingAvatar(true);
    setAvatarMessage(null);
    try {
      const blob = await fileToAvatarBlob(file);
      const photoUrl = await uploadStaffAvatar(blob);
      const updated = updateCurrentLocalUser({ photoURL: photoUrl });
      setUser(updated);
      setAvatarMessage({ text: t('profile.avatarSaved'), type: 'success' });
      setTimeout(() => setAvatarMessage(null), 3000);
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'invalid-type') {
        setAvatarMessage({ text: t('profile.avatarInvalidType'), type: 'error' });
      } else if (code === 'too-large' || code === 'compress-failed') {
        setAvatarMessage({ text: t('profile.avatarTooLarge'), type: 'error' });
      } else if (code === 'no-backend-token') {
        setAvatarMessage({ text: t('profile.avatarNoToken'), type: 'error' });
      } else {
        setAvatarMessage({ text: t('profile.avatarUploadFailed'), type: 'error' });
      }
    } finally {
      setUploadingAvatar(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  const handleRemoveAvatar = async () => {
    if (!user?.photoURL) return;
    setUploadingAvatar(true);
    setAvatarMessage(null);
    try {
      try {
        await deleteStaffAvatarOnServer();
      } catch (err) {
        const code = err instanceof Error ? err.message : '';
        if (code !== 'no-backend-token') throw err;
      }
      const updated = updateCurrentLocalUser({ photoURL: null });
      setUser(updated);
      setAvatarMessage({ text: t('profile.avatarRemoved'), type: 'success' });
      setTimeout(() => setAvatarMessage(null), 3000);
    } catch {
      setAvatarMessage({ text: t('profile.avatarRemoveFailed'), type: 'error' });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const role = user ? normalizeUserRole(user) : 'hodim';
  const displayRole = translateRoleLabel(language, role);
  // Server rasmni faqat xodimdan qabul qiladi — talabaga tugma ko'rsatilsa
  // har urinish "Ruxsat yo'q" bilan tugardi.
  const canEditAvatar = role !== 'student';

  return (
    <PageShell embedded={embedded}>
      {/* ─────────────── Kim ekanligi ─────────────── */}
      <section className={`${CARD} overflow-hidden`}>
        <div className="flex flex-col gap-6 p-5 sm:p-7 md:flex-row md:items-start">
          {/* Avatar */}
          <div className="flex shrink-0 flex-col items-center gap-3 md:items-start">
            <input
              ref={avatarInputRef}
              type="file"
              accept={AVATAR_ACCEPT}
              className="hidden"
              onChange={(e) => void handleAvatarFile(e.target.files)}
            />
            <div className="relative">
              <div className="h-28 w-28 overflow-hidden rounded-[26px] bg-slate-100 ring-1 ring-black/[0.06] sm:h-32 sm:w-32">
                {user?.photoURL ? (
                  <img
                    key={user.photoURL}
                    src={resolveProfilePhotoUrl(user.photoURL)}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-slate-300">
                    <User size={52} />
                  </div>
                )}
              </div>
              {canEditAvatar && (
              <button
                type="button"
                disabled={uploadingAvatar}
                onClick={() => avatarInputRef.current?.click()}
                aria-label={t('profile.uploadPhotoAria')}
                className="absolute -bottom-2 -right-2 flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-500 ring-1 ring-slate-900/[0.10] transition hover:text-slate-900 active:scale-95 disabled:opacity-60"
              >
                {uploadingAvatar ? (
                  <Loader2 size={19} className="animate-spin" />
                ) : (
                  <Camera size={19} />
                )}
              </button>
              )}
            </div>

            {canEditAvatar && (
            <div className="flex items-center gap-3 text-[12px] font-semibold">
              <button
                type="button"
                disabled={uploadingAvatar}
                onClick={() => avatarInputRef.current?.click()}
                className="text-blue-600 transition hover:text-blue-700 disabled:opacity-50"
              >
                {t('profile.uploadPhoto')}
              </button>
              {user?.photoURL && (
                <>
                  <span className="text-black/15">·</span>
                  <button
                    type="button"
                    disabled={uploadingAvatar}
                    onClick={handleRemoveAvatar}
                    className="text-rose-500 transition hover:text-rose-600 disabled:opacity-50"
                  >
                    {t('profile.removePhoto')}
                  </button>
                </>
              )}
            </div>
            )}

            {avatarMessage && (
              <p
                className={`text-[11.5px] font-medium ${
                  avatarMessage.type === 'success' ? 'text-emerald-600' : 'text-rose-600'
                }`}
              >
                {avatarMessage.text}
              </p>
            )}
          </div>

          {/* Ism, rol va kafedra */}
          <div className="min-w-0 flex-1 text-center md:text-left">
            <div className="flex flex-wrap items-center justify-center gap-2 md:justify-start">
              <h1 className={`text-[22px] font-bold tracking-tight sm:text-[26px] ${STAFF_HEADING}`}>
                {localizedProfileValue(user?.displayName, t) || t('profile.defaultName')}
              </h1>
              <span className="rounded-lg bg-sky-50 px-2.5 py-1 text-[12px] font-semibold text-sky-700 ring-1 ring-sky-100">
                {displayRole}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 text-[12px] font-semibold text-emerald-700 ring-1 ring-emerald-100">
                <ShieldCheck size={13} />
                {t('profile.localMode')}
              </span>
            </div>

            {/* Uchta qator bitta xatboshida edi — endi o'qiladigan ustunlar. */}
            {user?.faculty && (
              <dl className="mt-4 grid gap-x-6 gap-y-3 text-left sm:grid-cols-3">
                {[
                  { label: t('profile.faculty'), value: user.faculty },
                  { label: t('profile.department'), value: user.department },
                  { label: t('profile.direction'), value: user.direction },
                ].map((item) => (
                  <div key={item.label} className="min-w-0">
                    <dt className="text-[10.5px] font-bold uppercase tracking-wider text-black/35">
                      {item.label}
                    </dt>
                    <dd className="mt-0.5 text-[13.5px] font-medium leading-snug text-black/70">
                      {localizedProfileValue(item.value, t) || '—'}
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            <p className="mt-4 font-mono text-[11.5px] text-black/35">
              {t('profile.systemId')} {user?.email || '—'}
            </p>
          </div>

          {/* Chiqish — suzib turgan emas, o'z o'rnida */}
          <div className="flex justify-center md:justify-end">
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-2 rounded-xl border border-rose-100 bg-rose-50/70 px-4 py-2.5 text-[13px] font-semibold text-rose-600 transition hover:bg-rose-50 active:scale-[0.98]"
            >
              <LogOut size={16} />
              {t('profile.logout')}
            </button>
          </div>
        </div>
      </section>

      <div className={`grid w-full grid-cols-1 gap-5 ${embedded ? "" : "lg:grid-cols-2"}`}>
        {/* ─────────────── Chap ustun ─────────────── */}
        <div className="space-y-5">
          {!embedded && (
          <section className={CARD}>
            <SectionHead icon={User} tint="bg-blue-50 text-blue-600" title={t('profile.personalTitle')} />

            <form onSubmit={handleUpdateProfile} className="space-y-4 px-5 pb-5 sm:px-6 sm:pb-6">
              <Field
                label={t('profile.fullName')}
                icon={User}
                value={displayName}
                onChange={setDisplayName}
                placeholder={t('profile.fullNamePlaceholder')}
              />
              <Field
                label={t('profile.phoneNumber')}
                icon={Phone}
                value={phone}
                onChange={setPhone}
                placeholder="+998 90 123 45 67"
                inputMode="tel"
              />
              <Field
                label={t('profile.internalLogin')}
                icon={Mail}
                value={user?.email || ''}
                readOnly
                hint={t('profile.internalLoginHint')}
              />

              {profileMessage && <Notice message={profileMessage} />}

              <button
                type="submit"
                disabled={loadingProfile}
                className={`w-full ${staffBtnPrimary} py-3`}
              >
                {loadingProfile ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                {t('profile.saveChanges')}
              </button>
            </form>
          </section>
          )}

          {isHodim && !embedded && (
            <section className={CARD}>
              <SectionHead
                icon={GraduationCap}
                tint="bg-indigo-50 text-indigo-600"
                title={t('teachingSubjects.profileTitle')}
                action={
                  !editingSubjects && subjectRows.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setEditingSubjects(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-black/[0.08] bg-white px-2.5 py-1.5 text-[12.5px] font-semibold text-[#083047] transition hover:bg-slate-50"
                    >
                      <Pencil size={14} />
                      {t('teachingSubjects.edit')}
                    </button>
                  ) : undefined
                }
              />

              <div className="px-5 pb-5 sm:px-6 sm:pb-6">
                {editingSubjects ? (
                  <StaffTeachingSubjectsPicker
                    variant="profile"
                    showHeader={false}
                    onSaved={() => {
                      setEditingSubjects(false);
                      void reloadSubjects();
                    }}
                  />
                ) : subjectsLoading ? (
                  <div className="flex items-center gap-2 py-3 text-[13px] text-black/45">
                    <Loader2 size={17} className="animate-spin" />
                    {t('teachingSubjects.loading')}
                  </div>
                ) : subjectRows.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-black/10 bg-slate-50/60 px-4 py-6 text-center">
                    <GraduationCap size={22} className="mx-auto mb-2 text-slate-300" />
                    <p className="text-[13px] leading-relaxed text-black/55">
                      {t('syllabus.noAssignedCoursesHint')}
                    </p>
                    <button
                      type="button"
                      onClick={() => setEditingSubjects(true)}
                      className={`mt-3 ${staffBtnPrimary} px-4 py-2.5 text-[13.5px]`}
                    >
                      <Pencil size={15} />
                      {t('teachingSubjects.edit')}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <p className="text-[11.5px] font-semibold text-black/40">
                      {t('teachingSubjects.selectedCount', { count: subjectRows.length })}
                    </p>
                    <ul className="flex flex-wrap gap-1.5">
                      {subjectRows.map((row) => (
                        <li
                          key={row.id}
                          className="max-w-full truncate rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12.5px] font-semibold text-slate-700 ring-1 ring-black/[0.05]"
                        >
                          {localizedSubjectName(row, language)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        {/* ─────────────── O'ng ustun ─────────────── */}
        <section className={`${CARD} lg:self-start`}>
          <SectionHead icon={Lock} tint="bg-violet-50 text-violet-600" title={t('profile.passwordTitle')} />

          <div className="px-5 pb-5 sm:px-6 sm:pb-6">
            {isGoogleAuth ? (
              <div className="px-4 py-10 text-center">
                <Lock size={22} className="mx-auto mb-3 text-slate-300" />
                <h4 className="text-[15px] font-bold text-black/80">
                  {t('profile.googleLinkedTitle')}
                </h4>
                <p className="mx-auto mt-1 max-w-xs text-[13px] leading-relaxed text-black/50">
                  {t('profile.googleLinkedHint')}
                </p>
              </div>
            ) : (
              <form onSubmit={handleChangePassword} className="space-y-4">
                <PasswordField
                  label={t('profile.currentPassword')}
                  value={currentPassword}
                  onChange={setCurrentPassword}
                  placeholder={t('profile.currentPasswordPlaceholder')}
                  autoComplete="current-password"
                />

                <PasswordField
                  label={t('profile.newPassword')}
                  value={newPassword}
                  onChange={setNewPassword}
                  placeholder={t('profile.newPasswordPlaceholder')}
                  autoComplete="new-password"
                  minLength={6}
                  hint={
                    newPassword.length > 0 && newPassword.length < 6 ? (
                      <p className="px-0.5 text-[12px] font-medium text-amber-600">
                        {t('profile.passwordTooShort')}
                      </p>
                    ) : undefined
                  }
                />

                <PasswordField
                  label={t('profile.confirmPassword')}
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  placeholder={t('profile.confirmPasswordPlaceholder')}
                  autoComplete="new-password"
                  minLength={6}
                  hint={
                    confirmPassword.length > 0 && confirmPassword !== newPassword ? (
                      <p className="px-0.5 text-[12px] font-medium text-rose-500">
                        {t('profile.passwordMismatch')}
                      </p>
                    ) : undefined
                  }
                />

                {passwordMessage && <Notice message={passwordMessage} />}

                <button
                  type="submit"
                  disabled={loadingPassword}
                  className={`w-full ${staffBtnPrimary} py-3`}
                >
                  {loadingPassword ? <Loader2 size={18} className="animate-spin" /> : <Lock size={18} />}
                  {t('profile.updatePassword')}
                </button>
              </form>
            )}
          </div>
        </section>
      </div>
    </PageShell>
  );
}
