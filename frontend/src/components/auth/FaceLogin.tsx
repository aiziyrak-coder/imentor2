import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, KeyRound, Loader2, QrCode, RefreshCw, ScanFace } from 'lucide-react';
import { FaceLoginError, loginWithFaceFrames, syncSessionRoleFromServer } from '../../utils/backendAuth';
import { useUiText } from '../../i18n/useUiText';

type Props = {
  /** Login va parol bilan kirish ekraniga o'tish. */
  onUsePassword: () => void;
  /** Kompyuterda QR orqali kirish (telefonda berilmaydi). */
  onUseQr?: () => void;
  /** Telefonda butun ekran. */
  fullScreen?: boolean;
  /** Kadrlarni yuborish. Berilmasa — iMentor seansi (`loginWithFaceFrames`). Onlayn/malaka
   *  portali o'z seansiga yozadi; xato `FaceLoginError` bo'lishi kerak. */
  submitFrames?: (frames: Blob[]) => Promise<void>;
  /** Muvaffaqiyatli kirgandan keyin (masalan test sahifasi talaba holatini yangilaydi). */
  onLoggedIn?: () => void;
};

type Phase = 'starting' | 'looking' | 'checking' | 'stopped' | 'denied' | 'unsupported';

/** Avtomatik urinishlar soni — keyin "Qayta urinish" tugmasi (CPU va navbat tejaladi). */
const AUTO_ATTEMPTS = 4;
/**
 * Kadrlar orasidagi va urinishlar orasidagi kutish (2026-10-02 da qisqartirildi).
 *
 * Kirish 10-15 soniya ketayotgani haqida shikoyat keldi. Vaqtning kattasi
 * serverdagi navbat edi (u alohida tuzatildi), lekin shu kutishlar ham to'rt
 * urinishda 5 soniyadan ortiq qo'shardi. Kadrlar orasida qisqa tanaffus kerak
 * — ikki kadr BIR XIL bo'lib qolmasligi uchun, lekin 350 ms shart emas.
 */
const FRAME_GAP_MS = 180;
/** Kamera ekspozitsiyaga moslashsin — birinchi kadr qorong'i chiqmasin. */
const FIRST_WAIT_MS = 400;
/** Urinishlar orasida: odam joyini to'g'rilashga ulguradi. */
const RETRY_WAIT_MS = 700;
const MAX_SIDE = 640;

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function grabFrame(video: HTMLVideoElement): Promise<Blob | null> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return Promise.resolve(null);
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.88));
}

/**
 * Yuz orqali kirish. Kamera yoqiladi, yuz ramkaga tushgach ketma-ket ikki
 * kadr serverga yuboriladi. Server ikkala kadrda ham bitta o'qituvchini
 * ishonchli tanisagina kiritadi. Login-parol va QR zaxira yo'l bo'lib qoladi.
 */
const FACE_REGISTRATION_URL = 'https://cam.fermi.uz/royxatdan-otish';

async function defaultSubmit(frames: Blob[]): Promise<void> {
  await loginWithFaceFrames(frames);
  await syncSessionRoleFromServer();
}

export default function FaceLogin({
  onUsePassword,
  onUseQr,
  fullScreen = false,
  submitFrames = defaultSubmit,
  onLoggedIn,
}: Props) {
  const { t } = useUiText();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const aliveRef = useRef(true);
  const runningRef = useRef(false);
  const [phase, setPhase] = useState<Phase>('starting');
  const [message, setMessage] = useState<string>('');

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const runAttempts = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      for (let attempt = 0; attempt < AUTO_ATTEMPTS && aliveRef.current; attempt += 1) {
        setPhase('looking');
        await sleep(attempt === 0 ? FIRST_WAIT_MS : RETRY_WAIT_MS);
        const video = videoRef.current;
        if (!video || !aliveRef.current) return;
        const first = await grabFrame(video);
        await sleep(FRAME_GAP_MS);
        const second = await grabFrame(video);
        if (!first || !second) continue;
        setPhase('checking');
        try {
          await submitFrames([first, second]);
          stopCamera();
          onLoggedIn?.();
          return;
        } catch (err) {
          if (!(err instanceof FaceLoginError)) throw err;
          const text = err.detail || (err.status === 0 ? t('auth.face.network') : t('auth.face.notRecognized'));
          setMessage(text);
          // Tanildi-yu bog'lanmagan, hisob mos emas yoki xizmat ishlamayapti — qayta urinish befoyda.
          if (err.status === 404 || err.status === 403 || err.status === 503 || err.status === 429) {
            setPhase('stopped');
            return;
          }
        }
      }
      if (aliveRef.current) setPhase('stopped');
    } finally {
      runningRef.current = false;
    }
  }, [stopCamera, submitFrames, onLoggedIn, t]);

  useEffect(() => {
    aliveRef.current = true;
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase('unsupported');
      return;
    }
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } },
          audio: false,
        });
        if (!aliveRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        void runAttempts();
      } catch (err) {
        const name = err instanceof DOMException ? err.name : '';
        setPhase(name === 'NotFoundError' || name === 'OverconstrainedError' ? 'unsupported' : 'denied');
      }
    })();
    return () => {
      aliveRef.current = false;
      stopCamera();
    };
  }, [runAttempts, stopCamera]);

  const noCamera = phase === 'denied' || phase === 'unsupported';

  return (
    <div
      className={
        fullScreen
          ? 'flex min-h-[100dvh] flex-col justify-center bg-[#f8fafc] px-6 py-8'
          : 'mx-auto w-full max-w-md'
      }
      style={
        fullScreen
          ? { paddingTop: 'max(1.5rem, env(safe-area-inset-top))', paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }
          : undefined
      }
    >
      <div className="mx-auto w-full max-w-[360px] text-center">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-600 text-white shadow-lg">
          <ScanFace size={22} />
        </div>
        <h2 className="text-xl font-bold tracking-tight text-slate-900">{t('auth.face.title')}</h2>
        <p className="mt-1 text-[13px] leading-snug text-slate-500">{t('auth.face.subtitle')}</p>

        <div className="relative mx-auto mt-5 aspect-[3/4] w-full max-w-[300px] overflow-hidden rounded-[28px] bg-slate-900 shadow-xl ring-1 ring-slate-900/10">
          {!noCamera && (
            <video
              ref={videoRef}
              playsInline
              muted
              className="h-full w-full scale-x-[-1] object-cover"
              aria-label={t('auth.face.videoAria')}
            />
          )}
          {/* Yuz uchun oval ramka */}
          {!noCamera && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className={`h-[62%] w-[70%] rounded-[50%] border-[3px] transition-colors ${
                  phase === 'checking' ? 'border-emerald-400' : 'border-white/85'
                }`}
                style={{ boxShadow: '0 0 0 9999px rgba(15,23,42,0.35)' }}
              />
            </div>
          )}
          {(phase === 'starting' || phase === 'checking') && (
            <div className="absolute inset-x-0 bottom-4 flex justify-center">
              <span className="inline-flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-[12.5px] font-medium text-white">
                <Loader2 size={14} className="animate-spin" />
                {phase === 'starting' ? t('auth.face.starting') : t('auth.face.checking')}
              </span>
            </div>
          )}
          {noCamera && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-white/80">
              <ScanFace size={40} className="text-white/40" />
              <p className="text-[13.5px] leading-snug">
                {phase === 'denied' ? t('auth.face.cameraDenied') : t('auth.face.noCamera')}
              </p>
            </div>
          )}
        </div>

        <p className="mt-4 min-h-[40px] text-[13.5px] font-medium leading-snug text-slate-600" role="status">
          {phase === 'looking' && !message ? t('auth.face.hint') : message}
        </p>

        {phase === 'stopped' && (
          <button
            type="button"
            onClick={() => {
              setMessage('');
              void runAttempts();
            }}
            className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-sky-600 text-[15px] font-semibold text-white shadow-md active:scale-[0.99]"
          >
            <RefreshCw size={16} />
            {t('auth.face.retry')}
          </button>
        )}

        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => {
              aliveRef.current = false;
              stopCamera();
              onUsePassword();
            }}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white text-[14.5px] font-semibold text-slate-800 ring-1 ring-slate-900/10 hover:bg-slate-50"
          >
            <KeyRound size={16} />
            {t('auth.face.usePassword')}
          </button>
          {onUseQr && (
            <button
              type="button"
              onClick={() => {
                aliveRef.current = false;
                stopCamera();
                onUseQr();
              }}
              className="inline-flex h-10 w-full items-center justify-center gap-2 text-[13.5px] font-semibold text-slate-500 hover:text-sky-700"
            >
              <QrCode size={15} />
              {t('auth.face.useQr')}
            </button>
          )}
          {/* Yuzi hali bazada yo'q xodim shu yerda ro'yxatdan o'tadi — yuz cam.fermi.uz'dan soatlik sinxronlanadi. */}
          <a
            href={FACE_REGISTRATION_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 rounded-xl bg-sky-50 px-3 py-2.5 text-center text-[13px] leading-snug text-slate-600 ring-1 ring-sky-100"
          >
            {t('auth.face.notRegistered')}{' '}
            <span className="inline-flex items-center gap-1 font-semibold text-sky-700 underline underline-offset-2">
              {t('auth.face.registerLink')}
              <ExternalLink size={13} />
            </span>
          </a>
        </div>
      </div>
    </div>
  );
}
