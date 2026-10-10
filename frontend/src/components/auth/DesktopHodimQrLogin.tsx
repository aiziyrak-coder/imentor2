import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Monitor, RefreshCw, Smartphone } from 'lucide-react';
import QRCode from 'qrcode';
import { HttpError } from '../../api/httpClient';
import {
  createDevicePairingSession,
  pollDevicePairingStatus,
} from '../../utils/devicePairingApi';
import { syncStaffPhotoFromServer, writeBackendTokensFromPair } from '../../utils/backendAuth';
import {
  establishLocalSessionFromProfile,
  type LocalStaffUser,
} from '../../utils/localStaffAuth';
import { markDesktopPairedSession } from '../../utils/deviceSession';
import { useUiText } from '../../i18n/useUiText';

/** Oyna ochiq qolib ketsa cheksiz sessiya yaratilmasin: ~1 soatdan keyin to'xtaydi. */
const MAX_AUTO_REFRESH = 6;

/**
 * Kompyuterda xodim FAQAT shu yerdan kiradi.
 *
 * Ilgari "boshqa rollar" havolasi parol oynasini ochardi; u olib tashlandi —
 * kirish telefonda bo'lishi kerak, chunki joylashuv faqat telefonda qayd
 * etiladi (2026-10-02). Administrator uchun alohida manzil: `/admin`.
 */
export default function DesktopHodimQrLogin() {
  const { t } = useUiText();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expiresLabel, setExpiresLabel] = useState('');
  const [waitingPhone, setWaitingPhone] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const aliveRef = useRef(true);
  const autoRefreshRef = useRef(0);
  const startPairingRef = useRef<() => Promise<void>>(async () => {});
  const desktopSecretRef = useRef('');

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPairing = useCallback(async () => {
    stopPoll();
    setLoading(true);
    setError(null);
    setWaitingPhone(false);
    try {
      const created = await createDevicePairingSession();
      desktopSecretRef.current = created.desktop_secret || '';
      if (!desktopSecretRef.current) {
        setError(t('auth.qrNoSecret'));
        return;
      }
      const url = await QRCode.toDataURL(created.qr_payload, {
        width: 280,
        margin: 2,
        color: { dark: '#083047', light: '#ffffff' },
      });
      setQrDataUrl(url);
      const exp = new Date(created.expires_at);
      setExpiresLabel(exp.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }));
      setWaitingPhone(true);

      pollRef.current = setInterval(async () => {
        if (!aliveRef.current) return;
        try {
          const st = await pollDevicePairingStatus(
            created.pairing_token,
            desktopSecretRef.current,
          );
          if (!aliveRef.current) return;
          if (st.status === 'expired') {
            stopPoll();
            // Muddati tugagan QR o'zi yangilanadi — o'qituvchi tugma qidirmasin,
            // telefon esa ekrandagi yangi kodni darhol skanerlay oladi.
            if (autoRefreshRef.current < MAX_AUTO_REFRESH) {
              autoRefreshRef.current += 1;
              void startPairingRef.current();
              return;
            }
            setWaitingPhone(false);
            setError(t('auth.qrExpired'));
            return;
          }
          if (st.status !== 'confirmed' || !st.access || !st.refresh) return;
          stopPoll();
          setWaitingPhone(false);
          const profile = (st.profile ?? {}) as Partial<LocalStaffUser>;
          const phoneDigits = profile.phoneDigits || st.username || '';
          if (!phoneDigits) {
            setError(t('auth.qrProfileIncomplete'));
            return;
          }
          writeBackendTokensFromPair({
            access: st.access,
            refresh: st.refresh,
            role: (st.role as 'hodim') || 'hodim',
            username: st.username || phoneDigits,
          });
          const sessionUser = establishLocalSessionFromProfile({
            uid: profile.uid || `pair_${phoneDigits}`,
            displayName: profile.displayName || phoneDigits,
            firstName: profile.firstName || '',
            lastName: profile.lastName || '',
            phoneDisplay: profile.phoneDisplay || phoneDigits,
            phoneDigits,
            faculty: profile.faculty || '',
            department: profile.department || '',
            direction: profile.direction || '',
            email: profile.email || '',
            password: '',
            role: (st.role as LocalStaffUser['role']) || profile.role || 'hodim',
            photoURL: profile.photoURL ?? null,
            createdAt: profile.createdAt ?? Date.now(),
            updatedAt: Date.now(),
          });
          markDesktopPairedSession(sessionUser.uid);
          void syncStaffPhotoFromServer();
        } catch (err) {
          if (err instanceof HttpError && err.status === 403) {
            stopPoll();
            setWaitingPhone(false);
            setError(t('auth.qrRejected'));
          }
        }
      }, 2000);
    } catch {
      setError(t('auth.qrCreateFailed'));
    } finally {
      setLoading(false);
    }
  }, [stopPoll, t]);

  startPairingRef.current = startPairing;

  useEffect(() => {
    aliveRef.current = true;
    void startPairing();
    return () => {
      aliveRef.current = false;
      stopPoll();
    };
  }, [startPairing, stopPoll]);

  return (
    <div className="w-full max-w-md mx-auto space-y-4">
      <div className="text-center space-y-1">
        <div className="mx-auto w-11 h-11 rounded-2xl bg-sky-600 text-white flex items-center justify-center shadow-lg">
          <Monitor size={22} />
        </div>
        <h2 className="text-xl font-bold text-[#083047] tracking-tight">{t('auth.qrTitle')}</h2>
        <p className="text-[13px] text-black/55 leading-snug">
          {t('auth.qrSubtitle')}
        </p>
      </div>

      <div className="rounded-2xl border border-sky-100 bg-sky-50/90 px-3.5 py-2.5">
        <div className="flex items-center gap-2 mb-1.5">
          <Smartphone size={16} className="text-sky-700 shrink-0" />
          <span className="text-[12px] font-bold text-sky-900">{t('auth.qrPhoneInstructions')}</span>
        </div>
        <ol className="space-y-1">
          {([1, 2, 3] as const).map((n) => (
            <li key={n} className="flex gap-2 text-[12px] text-sky-950/90 leading-snug">
              <span className="font-bold text-sky-700 shrink-0">{n}.</span>
              <span>{t((`auth.qrStep${n}`) as 'auth.qrStep1' | 'auth.qrStep2' | 'auth.qrStep3')}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="rounded-2xl border border-white/80 bg-white/90 p-4 shadow-xl flex flex-col items-center gap-3">
        {loading && !qrDataUrl ? (
          <div className="py-8 flex flex-col items-center gap-3 text-black/50">
            <Loader2 className="animate-spin text-sky-600" size={32} />
            <span className="text-sm font-medium">{t('auth.qrPreparing')}</span>
          </div>
        ) : qrDataUrl ? (
          <>
            <img src={qrDataUrl} alt={t('auth.qrAlt')} className="w-[210px] h-[210px] rounded-xl" />
            {expiresLabel && (
              <p className="text-[12px] text-black/45">{t('auth.qrExpires', { time: expiresLabel })}</p>
            )}
            {waitingPhone && (
              <p className="text-[13px] text-sky-700 font-medium text-center animate-pulse">
                {t('auth.qrWaiting')}
              </p>
            )}
          </>
        ) : null}

        {error && (
          <p className="text-[13px] text-rose-600 font-medium text-center">{error}</p>
        )}

        <button
          type="button"
          onClick={() => {
            autoRefreshRef.current = 0;
            void startPairing();
          }}
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-sky-200 bg-white text-sky-800 font-semibold text-[14px] hover:bg-sky-50 transition-colors"
        >
          <RefreshCw size={16} />
          {t('auth.qrNew')}
        </button>
      </div>

      <p className="w-full text-center text-[12.5px] text-black/45">{t('auth.phoneOnlyHint')}</p>
    </div>
  );
}
