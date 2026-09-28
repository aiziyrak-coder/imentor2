import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Check, Loader2, LogOut, MapPin, Monitor, QrCode } from 'lucide-react';
import { HttpError } from '../../api/httpClient';
import {
  confirmDevicePairing,
  parsePairingTokenFromScan,
} from '../../utils/devicePairingApi';
import { getCurrentLocalUser, logoutLocalStaff } from '../../utils/localStaffAuth';
import { clearBackendAuthTokens } from '../../utils/backendAuth';
import { clearDesktopPairedSession } from '../../utils/deviceSession';
import { useStaffLocationTracking } from '../../hooks/useStaffLocationTracking';
import { requestOneShotStaffLocationPing } from '../../utils/staffLocationGeo';
import { useUiText } from '../../i18n/useUiText';

const SCANNER_ID = 'hodim-qr-scanner-region';

type GeoPermission = 'unknown' | 'granted' | 'prompt' | 'denied';

/**
 * Joylashuv ruxsati. Ekranda joylashuv haqida tushuntirish yo'q (2026-09-18 so'rovi) —
 * faqat ruxsat berilmagan bo'lsa, qisqa "ruxsat bering" kartochkasi chiqadi.
 * Joylashuvning o'zi fonda `useStaffLocationTracking` orqali yuboriladi.
 */
function useGeoPermission(): { state: GeoPermission; request: () => Promise<void>; busy: boolean } {
  const [state, setState] = useState<GeoPermission>('unknown');
  const [busy, setBusy] = useState(false);

  const request = useCallback(async () => {
    setBusy(true);
    try {
      await requestOneShotStaffLocationPing();
      setState('granted');
    } catch (e) {
      if ((e as GeolocationPositionError)?.code === 1) setState('denied');
    } finally {
      setBusy(false);
    }
  }, []);

  // Avval holat so'raladi; ruxsat hali berilmagan yoki holatni bilib bo'lmasa (eski iOS) — ruxsat oynasi ochiladi.
  useEffect(() => {
    let cancelled = false;
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
    if (!perms?.query) {
      void request();
      return;
    }
    perms
      .query({ name: 'geolocation' as PermissionName })
      .then((status) => {
        if (cancelled) return;
        setState(status.state as GeoPermission);
        status.onchange = () => setState(status.state as GeoPermission);
        if (status.state === 'prompt') void request();
      })
      .catch(() => {
        if (!cancelled) void request();
      });
    return () => {
      cancelled = true;
    };
  }, [request]);

  return { state, request, busy };
}

function LocationPermissionCard() {
  const { t } = useUiText();
  const { state, request, busy } = useGeoPermission();
  if (state === 'granted' || state === 'unknown') return null;
  const denied = state === 'denied';
  return (
    <div className="rounded-2xl bg-amber-50 p-3.5 ring-1 ring-amber-200">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white">
          <MapPin size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-slate-900">{t('staff.companion.locationTitle')}</p>
          {denied && <p className="mt-0.5 text-[12.5px] leading-snug text-slate-600">{t('staff.companion.locationDenied')}</p>}
        </div>
      </div>
      <button
        type="button"
        onClick={() => void request()}
        disabled={busy}
        className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-500 text-[14px] font-semibold text-white active:scale-[0.98] disabled:opacity-60"
      >
        {busy ? <Loader2 size={18} className="animate-spin" /> : <MapPin size={16} />}
        {t('staff.companion.locationButton')}
      </button>
    </div>
  );
}

export default function HodimMobileCompanion() {
  const { t } = useUiText();
  const user = getCurrentLocalUser();
  const [phase, setPhase] = useState<'ready' | 'scanning' | 'linked' | 'error'>('ready');
  // Ilgari har qanday xato "Kamera ochilmadi" deb chiqardi — eskirgan QR'da ham.
  // O'qituvchi kamerani aybdor deb o'ylab bir xil eski kodni qayta-qayta skanerlardi.
  const [errorKind, setErrorKind] = useState<'camera' | 'expired' | 'confirm'>('camera');
  const confirmingRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  // Joylashuv fonda yuboriladi; ekranda xabar ko'rsatilmaydi (ruxsat kartochkasi alohida).
  useStaffLocationTracking(true, { silent: true });

  const stopScanner = useCallback(async () => {
    const s = scannerRef.current;
    scannerRef.current = null;
    if (!s) return;
    try {
      if (s.isScanning) await s.stop();
      await s.clear();
    } catch {
      /* ignore */
    }
  }, []);

  const onScanSuccess = useCallback(
    async (decoded: string) => {
      const token = parsePairingTokenFromScan(decoded);
      // Skaner soniyasiga 10 marta chaqiradi — bitta kod bir marta yuborilsin.
      if (!token || !user || confirmingRef.current) return;
      confirmingRef.current = true;
      setBusy(true);
      try {
        await stopScanner();
        await confirmDevicePairing(token, user);
        setPhase('linked');
      } catch (err) {
        const expired = err instanceof HttpError && (err.status === 400 || err.status === 404);
        setErrorKind(expired ? 'expired' : 'confirm');
        setPhase('error');
        await stopScanner();
      } finally {
        confirmingRef.current = false;
        setBusy(false);
      }
    },
    [user, stopScanner],
  );

  const startScanner = useCallback(async () => {
    setBusy(true);
    setPhase('scanning');
    await stopScanner();
    try {
      const scanner = new Html5Qrcode(SCANNER_ID);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          // html5-qrcode 50 pikseldan kichik ramkani rad etib yiqiladi (kichik ekran, 2026-09-25).
          qrbox: (w, h) => {
            const side = Math.max(50, Math.floor(Math.min(w, h) * 0.65));
            return { width: side, height: side };
          },
        },
        (text) => void onScanSuccess(text),
        () => {},
      );
    } catch {
      await stopScanner();
      setErrorKind('camera');
      setPhase('error');
    } finally {
      setBusy(false);
    }
  }, [onScanSuccess, stopScanner]);

  useEffect(() => {
    return () => {
      void stopScanner();
    };
  }, [stopScanner]);

  const handleLogout = () => {
    void stopScanner();
    clearBackendAuthTokens();
    clearDesktopPairedSession(user?.uid);
    logoutLocalStaff();
  };

  if (!user) return null;

  const PHONE_STEPS = [
    { n: 1, text: t('staff.companion.step1') },
    { n: 2, text: t('staff.companion.step2') },
    { n: 3, text: t('staff.companion.step3') },
  ];

  return (
    <div
      className="flex min-h-[100dvh] flex-col bg-slate-50 text-slate-900"
      style={{
        paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
      }}
    >
      <header className="flex shrink-0 items-center justify-between px-4 py-2">
        <div className="flex items-center gap-2.5">
          <img src="/imentor-logo.png" alt="iMentor" className="h-10 w-10 rounded-xl object-cover ring-1 ring-slate-200" />
          <div className="leading-tight">
            <p className="text-[15px] font-bold">iMentor</p>
            <p className="max-w-[45vw] truncate text-[12px] text-slate-500">{user.displayName || ''}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          aria-label={t('staff.companion.logout')}
          className="flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-[13px] font-medium text-slate-600 ring-1 ring-slate-200"
        >
          <LogOut size={16} />
          {t('staff.companion.logout')}
        </button>
      </header>

      {phase === 'linked' ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/25">
            <Check size={52} strokeWidth={2.5} />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold">{t('staff.companion.linkedTitle')}</h2>
            <p className="text-[15px] leading-relaxed text-slate-600">{t('staff.companion.linkedSubtitle')}</p>
          </div>
          <div className="w-full max-w-md">
            <LocationPermissionCard />
          </div>
        </div>
      ) : (
        <>
          <section className="mx-4 mb-3 shrink-0 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="mb-3 flex items-center gap-2">
              <Monitor size={20} className="shrink-0 text-sky-600" />
              <h1 className="text-[17px] font-bold leading-snug">{t('staff.companion.connectTitle')}</h1>
            </div>
            <ol className="space-y-2.5">
              {PHONE_STEPS.map((s) => (
                <li key={s.n} className="flex gap-3 text-[14px] leading-snug text-slate-700">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-600 text-[12px] font-bold text-white">
                    {s.n}
                  </span>
                  <span className="pt-0.5">{s.text}</span>
                </li>
              ))}
            </ol>
          </section>

          <div className="relative mx-4 mb-3 min-h-[220px] flex-1 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
            <div
              id={SCANNER_ID}
              className={`absolute inset-0 h-full w-full [&_video]:object-cover ${phase === 'scanning' ? '' : 'hidden'}`}
            />

            {phase !== 'scanning' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
                  <QrCode size={34} />
                </div>
                <p className="text-[13px] text-slate-500">{t('staff.companion.scanPrompt')}</p>
              </div>
            )}

            {phase === 'scanning' && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                <div className="aspect-square w-[min(65vw,240px)] rounded-2xl border-2 border-white shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]" />
              </div>
            )}
          </div>

          <div className="shrink-0 space-y-2 px-4">
            <LocationPermissionCard />
            {phase === 'error' && (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-center text-[14px] font-medium text-amber-800 ring-1 ring-amber-200">
                {errorKind === 'expired'
                  ? t('staff.companion.qrExpired')
                  : errorKind === 'confirm'
                    ? t('staff.companion.confirmFailed')
                    : t('staff.companion.scanError')}
              </p>
            )}

            {phase === 'ready' || phase === 'error' ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void startScanner()}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-sky-600 text-[16px] font-semibold text-white shadow-md shadow-sky-600/25 active:scale-[0.98] disabled:opacity-60"
              >
                {busy ? <Loader2 size={22} className="animate-spin" /> : <QrCode size={20} />}
                {t('staff.companion.scanButton')}
              </button>
            ) : (
              <p className="py-2 text-center text-[14px] text-slate-600">{t('staff.companion.scanning')}</p>
            )}

            {phase === 'scanning' && (
              <button
                type="button"
                onClick={() => {
                  void stopScanner();
                  setPhase('ready');
                }}
                className="w-full py-3 text-[14px] font-medium text-slate-500"
              >
                {t('staff.companion.cancel')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
