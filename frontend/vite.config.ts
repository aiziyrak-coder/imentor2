import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import {legacyColors} from './src/utils/legacyCss';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const isProd = mode === 'production';
  const openaiKey = isProd
    ? ''
    : env.OPENAI_API_KEY || env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || '';
  return {
    // legacyColors: Tailwind v4 oklch ranglari Chrome <111 da ko'rinmaydi (Windows 7).
    plugins: [react(), tailwindcss(), legacyColors()],
    build: {
      // Eski telefonlar (Chrome 80, Samsung Internet) uchun: yangi sintaksis
      // (masalan `?.`, `??`, sinf maydonlari) eskisiga o'giriladi. Yangi METODLAR
      // `src/utils/polyfills.ts` da qo'shiladi — target ularni qo'shmaydi.
      target: ['chrome80', 'safari13', 'firefox78', 'edge88'],
    },
    define: {
      'process.env.OPENAI_API_KEY': JSON.stringify(openaiKey),
      'process.env.DEEPSEEK_API_KEY': JSON.stringify(openaiKey),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      strictPort: true,
      // Mahalliy: /api → FastAPI (docker 8100 yoki VITE_API_PROXY_TARGET).
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8100',
          changeOrigin: true,
        },
        '/media': {
          target: env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8100',
          changeOrigin: true,
        },
      },
      // With --host 0.0.0.0, pin HMR to localhost so the browser ws:// URL matches dev machine access.
      hmr:
        process.env.DISABLE_HMR === 'true'
          ? false
          : {
              host: 'localhost',
              port: 3000,
              protocol: 'ws',
            },
    },
  };
});
