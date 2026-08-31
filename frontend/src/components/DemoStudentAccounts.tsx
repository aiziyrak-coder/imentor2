import { useState } from 'react';
import { Copy, Check, Users } from 'lucide-react';
import { copyTextToClipboard } from '../utils/copyText';
import { useUiText } from '../i18n/useUiText';

/**
 * VAQTINCHA — mijozga koʻrsatish uchun demo talaba hisoblari.
 *
 * Jonli test QR kodi yonida koʻrinadi: mijoz QR ni skanerlaydi, shu yerdagi
 * login/parolni teradi va talaba sifatida testni sinab koʻradi.
 *
 * Butunlay `VITE_DEMO_STUDENT_IDS` ga bogʻliq — u boʻsh boʻlsa panel umuman
 * chizilmaydi. Olib tashlash uchun compose'dagi build argumentini boʻshatish
 * kifoya, kodga tegish shart emas.
 */

function demoStudents(): Array<{ id: string; password: string }> {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const ids = (env?.VITE_DEMO_STUDENT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const password = (env?.VITE_DEMO_STUDENT_PASSWORD || '').trim();
  if (ids.length === 0 || !password) return [];
  return ids.map((id) => ({ id, password }));
}

export default function DemoStudentAccounts() {
  const { t } = useUiText();
  const [copied, setCopied] = useState('');
  const list = demoStudents();
  if (list.length === 0) return null;

  const copy = async (value: string, key: string) => {
    const ok = await copyTextToClipboard(value);
    if (!ok) return;
    setCopied(key);
    window.setTimeout(() => setCopied((c) => (c === key ? '' : c)), 1500);
  };

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
      <div className="flex items-center gap-2 mb-1">
        <Users size={16} className="text-amber-700 shrink-0" />
        <p className="text-[13.5px] font-bold text-amber-900">{t('test.demoStudentsTitle')}</p>
      </div>
      <p className="text-[12px] text-amber-900/70 mb-3">{t('test.demoStudentsHint')}</p>

      <div className="grid gap-1.5 sm:grid-cols-2">
        {list.map((s) => {
          const key = s.id;
          return (
            <div
              key={key}
              className="flex items-center gap-2 rounded-xl bg-white/80 border border-amber-100 px-3 py-2"
            >
              <span className="font-mono text-[13px] font-semibold text-black/80 min-w-0 flex-1 truncate">
                {s.id}
              </span>
              <span className="font-mono text-[12px] text-black/50 shrink-0">{s.password}</span>
              <button
                type="button"
                onClick={() => void copy(`${s.id}  ${s.password}`, key)}
                className="shrink-0 p-1.5 rounded-lg text-amber-800 hover:bg-amber-100"
                title={t('common.link')}
                aria-label={t('common.link')}
              >
                {copied === key ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
