import React, { useState } from 'react';
import IdLogin from './IdLogin';
import FaceLogin from './FaceLogin';
import { useUiText } from '../../i18n/useUiText';

/**
 * Telefonda tizimga kirmagan foydalanuvchi uchun butun ekran — landing sahifa
 * ko'rsatilmaydi.
 *
 * Uch yo'l, hammasi PAROLSIZ (2026-10-02): yuz skaneri, JSHSHIR yoki pasport.
 * Ro'yxatdan o'tish yo'q — hisob kadrlar ma'lumoti asosida o'zi topiladi.
 */
export default function MobileAuthScreen() {
  const { t } = useUiText();
  const [screen, setScreen] = useState<'face' | 'id'>('face');

  if (screen === 'face') {
    return <FaceLogin fullScreen onUsePassword={() => setScreen('id')} />;
  }

  return (
    <div
      className="flex min-h-[100dvh] justify-center bg-[#f8fafc] px-4"
      style={{
        paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
      }}
    >
      <div className="w-full max-w-sm space-y-6 pt-6">
        <div className="text-center">
          <img
            src="/imentor-logo.png"
            alt="iMentor"
            className="mx-auto mb-3 h-16 w-16 rounded-2xl border border-white/70 bg-white object-cover shadow-lg"
          />
          <h1 className="text-xl font-bold tracking-tight text-black/90">{t('auth.loginTitle')}</h1>
        </div>
        <IdLogin onUseFace={() => setScreen('face')} />
      </div>
    </div>
  );
}
