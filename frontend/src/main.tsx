// Eski telefon brauzerlari (Chrome 80, Samsung Internet) uchun — ENG BIRINCHI.
import './utils/polyfills';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {lazy, Suspense} from 'react';
import App from './App.tsx';
import {ErrorBoundary} from './components/ErrorBoundary.tsx';
import './index.css';
import {detectProgram} from './online/program';
import {installClientErrorReporter} from './utils/clientErrorReporter';

// Brauzer xatolari serverga yoziladi — admin «Sayt xatolari» bo'limida ko'radi.
installClientErrorReporter();

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
 * Malaka oshirish ham shu portal, faqat boshqa dastur bilan
 * (`malaka.fermi.uz`, qarang: `online/program.ts`).
 *
 * `VITE_ONLINE_HOST` / `VITE_MALAKA_HOST` — domen sozlamalari. `?online=1` va
 * `?malaka=1` esa FAQAT ishlab chiqish va tez tekshirish uchun; haqiqiy
 * manzil har doim o'z domeni.
 */
const OnlineApp = lazy(() => import('./online/OnlineApp.tsx'));
const RectorApp = lazy(() => import('./rector/RectorApp.tsx'));

/**
 * Rektor hisoboti ALOHIDA manzilda: `imentor.uz/rektor`.
 *
 * U iMentor ilovasining bo'limi emas — o'z paroli bilan ochiladi, faqat
 * hisobotlarni ko'rsatadi va hech narsani o'zgartirmaydi. Shu sababli
 * bu yerda, ilova daraxtidan tashqarida tanlanadi.
 */
function isRectorPath(): boolean {
  try {
    const path = window.location.pathname.replace(/\/+$/, '').toLowerCase();
    return path === '/rektor' || path === '/rector';
  } catch {
    return false;
  }
}

const portalProgram = detectProgram();
const loadingFallback = <div className="p-6 text-slate-500">Yuklanmoqda…</div>;

const Root = isRectorPath()
  ? () => <Suspense fallback={loadingFallback}>{<RectorApp />}</Suspense>
  : portalProgram
    ? () => (
        <Suspense fallback={loadingFallback}>
          <OnlineApp program={portalProgram} />
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
