import { useEffect, useState } from 'react';

/** Necha daqiqada bir tekshiriladi. */
const CHECK_MS = 5 * 60_000;

function entryScript(html: string): string | null {
  const m = /<script[^>]+src="([^"]*\/assets\/index-[^"]+\.js)"/.exec(html);
  return m ? m[1] : null;
}

function loadedScript(): string | null {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  return el ? new URL(el.src, window.location.href).pathname : null;
}

/**
 * Serverga yangi versiya chiqqanini aniqlaydi.
 *
 * Sinf doskasidagi brauzer kun bo'yi ochiq turadi va bir sahifali ilova o'zi
 * yangilanmaydi: deploydan keyin ham ESKI kod ishlayveradi. 2026-10-12 da
 * shu sababli o'qituvchi ekranida talabalar balli eski hisob bilan 4/9
 * chiqqan, aslida 9/9 edi. `index.html` keshlanmaydi — undagi asosiy skript
 * nomi yuklangan nomdan farq qilsa, yangi versiya bor.
 */
export function useNewVersionAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const current = loadedScript();
    if (!current) return; // dev rejimi (Vite) — tekshirilmaydi
    let stopped = false;
    const check = async () => {
      if (stopped || document.hidden) return;
      try {
        const res = await fetch('/', { cache: 'no-store' });
        if (!res.ok) return;
        const latest = entryScript(await res.text());
        if (latest && latest !== current) {
          setAvailable(true);
          stopped = true;
        }
      } catch {
        /* tarmoq yo'q — keyingi safar */
      }
    };
    const timer = window.setInterval(check, CHECK_MS);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  return available;
}
