import { useEffect, useRef, useState } from 'react';
import { Loader2, VideoOff } from 'lucide-react';
import { fetchOnlineConfig, reportAttendance } from './onlineLessonApi';

/**
 * Jitsi video xonasi.
 *
 * Jitsi domeni SERVERDAN olinadi (`/online/config/`), frontendga qotirilmaydi:
 * o'z serverimizdagi Jitsi tayyor bo'lgach bitta env o'zgaradi va portalni
 * qayta qurish shart bo'lmaydi.
 *
 * Talaba uchun `reportJoin` yoqiladi — brauzer xonaga kirganda va chiqqanda
 * backendga xabar beradi. Vaqtni SERVER qo'yadi, shuning uchun bu hodisalar
 * davomat vaqtini uzaytirish uchun ishlatib bo'lmaydi.
 */

type JitsiApi = {
  addEventListener: (event: string, handler: (...args: unknown[]) => void) => void;
  executeCommand: (cmd: string, ...args: unknown[]) => void;
  dispose: () => void;
};

type JitsiCtor = new (
  domain: string,
  options: Record<string, unknown>,
) => JitsiApi;

declare global {
  interface Window {
    JitsiMeetExternalAPI?: JitsiCtor;
  }
}

/** `external_api.js` ni bir marta yuklaydi va keyingi chaqiruvlarda kutadi. */
const loaded = new Map<string, Promise<void>>();

function loadJitsiScript(domain: string): Promise<void> {
  const existing = loaded.get(domain);
  if (existing) return existing;

  const p = new Promise<void>((resolve, reject) => {
    if (window.JitsiMeetExternalAPI) {
      resolve();
      return;
    }
    const el = document.createElement('script');
    el.src = `https://${domain}/external_api.js`;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () =>
      reject(new Error(`Video xizmatiga ulanib bo'lmadi (${domain}).`));
    document.head.appendChild(el);
  });
  loaded.set(domain, p);
  return p;
}

export default function JitsiRoom({
  roomName,
  displayName,
  reportJoin = false,
  onLeave,
  height = 520,
}: {
  roomName: string;
  displayName: string;
  reportJoin?: boolean;
  onLeave?: () => void;
  height?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const apiRef = useRef<JitsiApi | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let joined = false;

    (async () => {
      try {
        const { jitsi_domain: domain } = await fetchOnlineConfig();
        await loadJitsiScript(domain);
        if (cancelled || !box.current) return;

        const Ctor = window.JitsiMeetExternalAPI;
        if (!Ctor) throw new Error("Video xizmati yuklanmadi.");

        const api = new Ctor(domain, {
          roomName,
          parentNode: box.current,
          width: '100%',
          height,
          userInfo: { displayName },
          configOverwrite: {
            prejoinPageEnabled: false,
            startWithAudioMuted: reportJoin,
            disableDeepLinking: true,
          },
          interfaceConfigOverwrite: {
            SHOW_JITSI_WATERMARK: false,
            MOBILE_APP_PROMO: false,
          },
        });
        apiRef.current = api;
        setLoading(false);

        api.addEventListener('videoConferenceJoined', () => {
          joined = true;
          if (reportJoin) void reportAttendance(roomName, 'join').catch(() => {});
        });
        api.addEventListener('videoConferenceLeft', () => {
          if (reportJoin && joined) void reportAttendance(roomName, 'leave').catch(() => {});
          joined = false;
          onLeave?.();
        });
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      // Sahifa yopilganda ham chiqishni yozamiz — aks holda davomat yozuvi
      // ochiq qolib, vaqt hisoblanmasdi.
      if (reportJoin && joined) void reportAttendance(roomName, 'leave').catch(() => {});
      try {
        apiRef.current?.dispose();
      } catch {
        /* xona allaqachon yopilgan bo'lishi mumkin */
      }
      apiRef.current = null;
    };
  }, [roomName, displayName, reportJoin, height, onLeave]);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-8 text-center">
        <VideoOff size={22} className="text-amber-600" />
        <p className="text-[13.5px] font-semibold text-amber-900">{error}</p>
        <p className="text-[12.5px] text-amber-800">
          Internet aloqasini tekshiring yoki administratorga murojaat qiling.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-900">
      {loading && (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-[13px]">Video xona ochilmoqda…</span>
        </div>
      )}
      <div ref={box} style={{ height: loading ? 0 : height }} />
    </div>
  );
}
