import { useState } from 'react';
import { Copy, Check, KeyRound } from 'lucide-react';
import { copyTextToClipboard } from '../utils/copyText';
import { useUiText } from '../i18n/useUiText';

/**
 * Namoyish uchun talaba hisoblari — jonli test QR kodi yonida koʻrinadi.
 *
 * Mehmon QR ni skanerlaydi, shu yerdagi login va parolni terib testni sinab
 * koʻradi. Login bilan parol adashtirilmasligi uchun ikkalasi alohida
 * yorliqlangan qatorda, har biri oʻz nusxa olish tugmasi bilan beriladi.
 *
 * Panel butunlay `VITE_DEMO_STUDENT_IDS` ga bogʻliq — boʻsh boʻlsa
 * chizilmaydi. Olib tashlash uchun sozlamadagi qiymatni boʻshatish kifoya.
 */

function accounts(): Array<{ id: string; password: string }> {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const ids = (env?.VITE_DEMO_STUDENT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const password = (env?.VITE_DEMO_STUDENT_PASSWORD || '').trim();
  if (ids.length === 0 || !password) return [];
  return ids.map((id) => ({ id, password }));
}

function Field({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 w-11 shrink-0">
        {label}
      </span>
      <code className="flex-1 min-w-0 truncate rounded-lg bg-slate-50 border border-slate-200 px-2 py-1 text-[13px] font-semibold text-slate-800">
        {value}
      </code>
      <button
        type="button"
        onClick={onCopy}
        className="shrink-0 p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        aria-label={label}
        title={label}
      >
        {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
      </button>
    </div>
  );
}

export default function DemoStudentAccounts() {
  const { t } = useUiText();
  const [copied, setCopied] = useState('');
  const list = accounts();
  if (list.length === 0) return null;

  const copy = async (value: string, key: string) => {
    const ok = await copyTextToClipboard(value);
    if (!ok) return;
    setCopied(key);
    window.setTimeout(() => setCopied((c) => (c === key ? '' : c)), 1500);
  };

  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50/50 p-4">
      <div className="flex items-center gap-2 mb-1">
        <KeyRound size={16} className="text-sky-700 shrink-0" />
        <p className="text-[13.5px] font-bold text-sky-900">{t('test.trialAccountsTitle')}</p>
      </div>
      <p className="text-[12px] text-sky-900/70 mb-3">{t('test.trialAccountsHint')}</p>

      <div className="grid gap-2 sm:grid-cols-2">
        {list.map((a, i) => (
          <div
            key={a.id}
            className="rounded-xl bg-white border border-sky-100 px-3 py-2.5 space-y-1.5"
          >
            <p className="text-[11px] font-bold text-sky-800">
              {t('test.trialAccountNo', { n: i + 1 })}
            </p>
            <Field
              label={t('test.trialLogin')}
              value={a.id}
              copied={copied === `${a.id}-l`}
              onCopy={() => void copy(a.id, `${a.id}-l`)}
            />
            <Field
              label={t('test.trialPassword')}
              value={a.password}
              copied={copied === `${a.id}-p`}
              onCopy={() => void copy(a.password, `${a.id}-p`)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
