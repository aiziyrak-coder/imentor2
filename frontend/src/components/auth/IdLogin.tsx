import React, { useState } from 'react';
import { BadgeCheck, CreditCard, Hash, Loader2, ScanFace } from 'lucide-react';
import { FaceLoginError, getBackendAccessToken, loginWithIdentity, syncSessionRoleFromServer } from '../../utils/backendAuth';
import { PASSPORT_SERIES } from '../../utils/passportSeries';
import { useUiText } from '../../i18n/useUiText';

type Mode = 'pinfl' | 'passport' | 'institute';

type Props = {
  /** Yuz skaneriga o'tish. Berilmasa tugma ko'rsatilmaydi. */
  onUseFace?: () => void;
  /** Kirgandan keyin (portal o'z holatini yangilaydi). */
  onDone?: () => void;
};

/**
 * Kirish: JSHSHIR yoki pasport. PAROL YO'Q (2026-10-02).
 *
 * Pasport seriyasi ro'yxatdan tanlanadi, qolgan raqamni odam o'zi yozadi —
 * seriyani qo'lda yozganda kirill "А" va lotin "A" chalkashib, hech kim
 * topilmasdi.
 *
 * Xodim ham, talaba ham shu oynadan kiradi; kimligi serverda aniqlanadi.
 */
export default function IdLogin({ onUseFace, onDone }: Props) {
  const { t } = useUiText();
  const [mode, setMode] = useState<Mode>('pinfl');
  const [pinfl, setPinfl] = useState('');
  const [series, setSeries] = useState('');
  const [number, setNumber] = useState('');
  const [instituteId, setInstituteId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const digitsOnly = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);
  const ready =
    mode === 'pinfl'
      ? pinfl.length === 14
      : mode === 'institute'
        ? instituteId.trim().length >= 4
        : Boolean(series) && number.length >= 5;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || loading) return;
    setLoading(true);
    setError('');
    try {
      await loginWithIdentity(
        mode === 'pinfl'
          ? { pinfl }
          : mode === 'institute'
            ? { instituteId: instituteId.trim() }
            : { passportSeries: series, passportNumber: number },
      );
      await getBackendAccessToken();
      await syncSessionRoleFromServer();
      onDone?.();
    } catch (err) {
      if (err instanceof FaceLoginError) {
        setError(err.status === 0 ? t('auth.mobileLogin.connectionError') : err.detail || t('auth.id.notFound'));
      } else {
        setError(t('auth.id.notFound'));
      }
    } finally {
      setLoading(false);
    }
  };

  const tab = (value: Mode, label: string, Icon: typeof Hash) => (
    <button
      type="button"
      onClick={() => {
        setMode(value);
        setError('');
      }}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-[13.5px] font-semibold transition ${
        mode === value ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500'
      }`}
    >
      <Icon size={16} />
      {label}
    </button>
  );

  return (
    <form onSubmit={submit} className="w-full space-y-4">
      <div className="flex gap-1 rounded-2xl bg-slate-100 p-1">
        {tab('pinfl', t('auth.id.pinflTab'), Hash)}
        {tab('passport', t('auth.id.passportTab'), CreditCard)}
        {tab('institute', t('auth.id.instituteTab'), BadgeCheck)}
      </div>

      {mode === 'pinfl' && (
        <div className="space-y-1.5">
          <label htmlFor="id-pinfl" className="text-xs font-semibold uppercase tracking-wide text-black/55">
            {t('auth.id.pinflLabel')}
          </label>
          <input
            id="id-pinfl"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={pinfl}
            onChange={(e) => setPinfl(digitsOnly(e.target.value, 14))}
            placeholder={t('auth.id.pinflPlaceholder')}
            className="w-full rounded-xl border border-black/10 bg-white/70 px-4 py-3.5 text-[16px] font-medium tracking-[0.08em] tabular-nums text-black/90 outline-none focus:ring-2 focus:ring-sky-500/40"
          />
          <p className="text-[12px] text-black/45">
            {pinfl.length}/14 · {t('auth.id.pinflHint')}
          </p>
        </div>
      )}

      {mode === 'passport' && (
        <div className="space-y-1.5">
          <label htmlFor="id-passport-number" className="text-xs font-semibold uppercase tracking-wide text-black/55">
            {t('auth.id.passportLabel')}
          </label>
          <div className="flex gap-2">
            <select
              aria-label={t('auth.id.seriesLabel')}
              value={series}
              onChange={(e) => setSeries(e.target.value)}
              className="w-[108px] shrink-0 rounded-xl border border-black/10 bg-white/70 px-3 py-3.5 text-[16px] font-semibold text-black/90 outline-none focus:ring-2 focus:ring-sky-500/40"
            >
              <option value="">{t('auth.id.seriesLabel')}</option>
              {PASSPORT_SERIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input
              id="id-passport-number"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={number}
              onChange={(e) => setNumber(digitsOnly(e.target.value, 9))}
              placeholder={t('auth.id.passportPlaceholder')}
              className="w-full rounded-xl border border-black/10 bg-white/70 px-4 py-3.5 text-[16px] font-medium tracking-[0.08em] tabular-nums text-black/90 outline-none focus:ring-2 focus:ring-sky-500/40"
            />
          </div>
          <p className="text-[12px] text-black/45">{t('auth.id.passportHint')}</p>
        </div>
      )}

      {mode === 'institute' && (
        <div className="space-y-1.5">
          <label htmlFor="id-institute" className="text-xs font-semibold uppercase tracking-wide text-black/55">
            {t('auth.id.instituteLabel')}
          </label>
          <input
            id="id-institute"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={instituteId}
            onChange={(e) => setInstituteId(e.target.value.replace(/\s/g, '').slice(0, 32))}
            placeholder={t('auth.id.institutePlaceholder')}
            className="w-full rounded-xl border border-black/10 bg-white/70 px-4 py-3.5 text-[16px] font-medium tracking-[0.08em] tabular-nums text-black/90 outline-none focus:ring-2 focus:ring-sky-500/40"
          />
          <p className="text-[12px] text-black/45">{t('auth.id.instituteHint')}</p>
        </div>
      )}

      {error && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-700">{error}</p>
      )}

      <button
        type="submit"
        disabled={!ready || loading}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 py-3.5 text-[15px] font-semibold text-white shadow-md shadow-sky-600/25 transition hover:bg-sky-500 disabled:opacity-50"
      >
        {loading ? <Loader2 className="animate-spin" size={20} /> : null}
        {t('auth.submitLogin')}
      </button>

      {onUseFace && (
        <button
          type="button"
          onClick={onUseFace}
          className="flex w-full items-center justify-center gap-1.5 text-[13px] font-semibold text-sky-700 hover:underline"
        >
          <ScanFace size={16} />
          {t('auth.face.useFace')}
        </button>
      )}

      <p className="text-center text-[12.5px] text-black/45">{t('auth.id.noPassword')}</p>
    </form>
  );
}
