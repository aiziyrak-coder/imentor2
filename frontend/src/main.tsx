import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {lazy, Suspense} from 'react';
import App from './App.tsx';
import {ErrorBoundary} from './components/ErrorBoundary.tsx';
import './index.css';

/**
 * Yangi versiya joylanganda eski sahifa ochiq qolsa, u endi mavjud bo\'lmagan
 * bo\'lakni yuklamoqchi bo\'ladi va "Failed to fetch dynamically imported module"
 * xatosi chiqadi. Bunday holatda sahifani bir marta yangilaymiz — belgi
 * sessionStorage da saqlanadi, shuning uchun aylanma qayta yuklash bo\'lmaydi.
 */
const RELOAD_FLAG = 'imentor-chunk-reloaded';

function reloadOnceForNewBuild(): void {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) return;
    sessionStorage.setItem(RELOAD_FLAG, '1');
  } catch {
    // sessionStorage yopiq bo'lsa ham yangilash foydali, lekin bir martalik
    // kafolat yo'q — shuning uchun bu holatda umuman yangilamaymiz.
    return;
  }
  window.location.reload();
}

window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  reloadOnceForNewBuild();
});

window.addEventListener('unhandledrejection', (e) => {
  const msg = String((e.reason as { message?: string })?.message || e.reason || '');
  if (/dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(msg)) {
    reloadOnceForNewBuild();
  }
});

// Muvaffaqiyatli yuklangach belgini tozalaymiz — keyingi deployda yana ishlasin.
window.addEventListener('load', () => {
  try {
    sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    /* muhim emas */
  }
});

/**
 * Online ta'lim portali AYRIM domenda turadi (`onlinetalim.fermi.uz`) va
 * butunlay boshqa daraxt — mavjud `App` ga umuman tegilmaydi.
 *
 * Portal o'z domeni va O'Z konteynerida (`frontend_online`) turadi — uni
 * yangilash iMentor frontendini qimirlatmaydi. Bundle bir xil bo'lgani uchun
 * qaysi qobiq ko'rsatilishini shu yerda, domen nomi hal qiladi.
 *
 * `VITE_ONLINE_HOST` — domen sozlamasi. `?online=1` esa FAQAT ishlab chiqish
 * va tez tekshirish uchun; haqiqiy manzil har doim o'z domeni.
 */
const OnlineApp = lazy(() => import('./online/OnlineApp.tsx'));

function isOnlinePortal(): boolean {
  try {
    const env = (import.meta as ImportMeta & {env?: Record<string, string | undefined>}).env;
    const configured = (env?.VITE_ONLINE_HOST || 'onlinetalim.fermi.uz').toLowerCase();
    const host = window.location.hostname.toLowerCase();
    if (host === configured) return true;
    return new URLSearchParams(window.location.search).get('online') === '1';
  } catch {
    return false;
  }
}

const Root = isOnlinePortal()
  ? () => (
      <Suspense fallback={<div className="p-6 text-slate-500">Yuklanmoqda…</div>}>
        <OnlineApp />
      </Suspense>
    )
  : App;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);
