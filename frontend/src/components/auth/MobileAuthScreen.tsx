import React, { useState } from 'react';
import MobileMinimalLogin from './MobileMinimalLogin';
import FaceLogin from './FaceLogin';
import RegisterPage from './RegisterPage';

/**
 * Telefonda tizimga kirmagan foydalanuvchi uchun butun ekran — landing sahifa
 * ko'rsatilmaydi. Avval yuz orqali kirish (old kamera), zaxira — login va
 * parol. Hisobi yo'q xodim shu yerdan ro'yxatdan o'tadi.
 */
export default function MobileAuthScreen() {
  const [screen, setScreen] = useState<'face' | 'login' | 'register'>('face');

  if (screen === 'face') {
    return <FaceLogin fullScreen onUsePassword={() => setScreen('login')} />;
  }

  if (screen === 'register') {
    return (
      <div
        className="flex min-h-[100dvh] justify-center bg-[#f8fafc] px-4"
        style={{
          paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
          paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
        }}
      >
        <RegisterPage onSwitchToLogin={() => setScreen('login')} />
      </div>
    );
  }

  return (
    <MobileMinimalLogin
      onSwitchToRegister={() => setScreen('register')}
      onUseFace={() => setScreen('face')}
    />
  );
}
