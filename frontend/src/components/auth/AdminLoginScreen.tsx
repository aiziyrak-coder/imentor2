import React from 'react';
import LoginPage from './LoginPage';

/**
 * Administrator uchun alohida kirish sahifasi: `imentor.uz/admin`.
 *
 * Xodim va talaba parolsiz kiradi (JSHSHIR, pasport yoki yuz), lekin
 * administratorning telefonga bog'langan hisobi yo'q va u QR bilan kira
 * olmaydi — shuning uchun parol oynasi faqat shu manzilda qoldi.
 *
 * Bu BUTUN SAHIFA, `/rektor` kabi: reklama sahifasi ham, ochilishi kerak
 * bo'lgan oynacha ham yo'q. Ilgari u landing sahifa ustidagi modal edi va
 * telefonda umuman chiqmasdi (telefonda landing ko'rsatilmaydi), kompyuterda
 * esa modal ochilishiga bog'liq edi — 2026-10-03 da shikoyat shundan chiqdi.
 */
export default function AdminLoginScreen() {
  return (
    <div
      className="flex min-h-[100dvh] justify-center bg-[#f8fafc] px-4"
      style={{
        paddingTop: 'max(2rem, env(safe-area-inset-top))',
        paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
      }}
    >
      <div className="w-full max-w-md self-center">
        <LoginPage />
      </div>
    </div>
  );
}
