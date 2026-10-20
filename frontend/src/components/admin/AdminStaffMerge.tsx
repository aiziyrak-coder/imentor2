import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, GitMerge, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { HttpError } from '../../api/httpClient';
import {
  fetchMergeCandidates,
  fetchMergeLog,
  fetchPinflStatus,
  mergeAccounts,
  type MergeAccount,
  type MergeGroup,
  type MergeLogEntry,
  type PinflStatus,
} from '../../utils/staffMergeApi';
import AdminStaffDetail from './AdminStaffDetail';

type Tab = 'candidates' | 'pinfl' | 'log';

function errorText(err: unknown): string {
  if (err instanceof HttpError) {
    const detail = (err.body as { detail?: unknown } | null)?.detail;
    if (typeof detail === 'string') return detail;
  }
  return "So'rov bajarilmadi. Qayta urinib ko'ring.";
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('uz-UZ', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function loginLabel(a: { username: string; login_kind: string }): string {
  return a.login_kind === 'phone' ? `+${a.username} (telefon)` : `${a.username} (Xodim ID)`;
}

const MOVED_LABELS: Record<string, string> = {
  'core_staffcourseselection.owner_key': 'tanlangan fanlar',
  'core_preparedcontent.owner_key': 'tayyor kontent',
  'core_facetemplate.owner_key': 'yuz shablonlari',
  'core_staffpinfl.owner_key': 'JSHSHIR bog\'lanishi',
  'core_staffprofile.owner_key': 'profil maydonlari',
  'core_useractivityevent.owner_key': 'faollik yozuvlari',
  'core_hemislesson.teacher_username': 'HEMIS darslari',
  'core_monitorschedule.teacher_username': 'monitor jadvali',
  'online_teacher.owner_key': 'online o\'qituvchi yozuvi',
  parol: 'parol',
};

function movedSummary(moved: Record<string, number>, skipped: number): string {
  const parts = Object.entries(moved)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${MOVED_LABELS[k] ?? k.split('.')[0]}: ${n}`);
  if (skipped > 0) parts.push(`takror (qo'shilmadi): ${skipped}`);
  return parts.length ? parts.join(' · ') : "ko'chiriladigan ma'lumot yo'q edi";
}

function GroupCard({
  group,
  onMerged,
  onOpen,
}: {
  group: MergeGroup;
  onMerged: (message: string) => void;
  onOpen: (username: string) => void;
}) {
  const [primary, setPrimary] = useState(group.primary);
  const [copyPassword, setCopyPassword] = useState(group.suggest_copy_password);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const others = group.accounts.filter((a) => a.username !== primary);
  const primaryAcc = group.accounts.find((a) => a.username === primary);

  const run = async () => {
    if (!primaryAcc || group.blocked) return;
    const text =
      `"${primaryAcc.display_name}" hisobi (${loginLabel(primaryAcc)}) qoladi.\n` +
      `Qolgan ${others.length} ta hisobning hamma ma'lumoti (fanlar, kontent, yuz, JSHSHIR) unga ko'chadi, ` +
      `o'zi esa nofaol bo'ladi.${copyPassword ? '\nQo\'shilgan hisobning paroli qoladigan hisobga o\'tadi.' : ''}\n\nTasdiqlaysizmi?`;
    if (!window.confirm(text)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await mergeAccounts({
        primary,
        secondaries: others.map((a) => a.username),
        copy_password: copyPassword,
      });
      onMerged(
        `${primaryAcc.display_name}: ${res.results.length} ta hisob birlashtirildi. ` +
          res.results.map((r) => movedSummary(r.moved, r.skipped_duplicates)).join(' | '),
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ios-glass rounded-2xl border border-white/60 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px] text-black/55">
          Ism o'xshashligi <b className="text-black/80">{Math.round(group.similarity * 100)}%</b> · kafedra bir xil:{' '}
          <b className="text-black/80">{group.accounts[0]?.department || '—'}</b>
        </div>
        {group.blocked ? (
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
            <ShieldAlert size={14} /> Birlashtirib bo'lmaydi
          </span>
        ) : null}
      </div>
      {group.blocked ? <p className="text-[13px] text-amber-800">{group.blocked}</p> : null}

      <div className="grid gap-2 md:grid-cols-2">
        {group.accounts.map((a: MergeAccount) => {
          const isPrimary = a.username === primary;
          return (
            <label
              key={a.username}
              className={`block rounded-xl border p-3 cursor-pointer text-[13px] ${
                isPrimary ? 'border-indigo-400 bg-indigo-50/60' : 'border-black/10 bg-white/70'
              } ${group.blocked ? 'cursor-not-allowed opacity-80' : ''}`}
            >
              <div className="flex items-start gap-2">
                <input
                  type="radio"
                  name={`primary-${group.accounts[0]?.username}`}
                  checked={isPrimary}
                  disabled={!!group.blocked}
                  onChange={() => {
                    setPrimary(a.username);
                    setCopyPassword(
                      a.password_is_initial && group.accounts.some((o) => o.username !== a.username && !o.password_is_initial && o.last_login != null),
                    );
                  }}
                  className="mt-1"
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="font-semibold text-black/90">
                    {a.display_name}{' '}
                    {isPrimary ? <span className="text-[11px] font-bold text-indigo-700">· QOLADI</span> : <span className="text-[11px] text-black/40">· qo'shiladi</span>}
                  </div>
                  <div className="font-mono text-[12px] text-black/65">{loginLabel(a)}</div>
                  <div className="text-black/55">JSHSHIR: {a.pinfl ? <span className="font-mono">{a.pinfl}</span> : 'bog\'lanmagan'}</div>
                  <div className="text-black/55">
                    Fan va kontent: <b>{a.activity}</b> · Oxirgi kirish: {fmt(a.last_login)}
                    {a.password_is_initial ? ' · boshlang\'ich parol' : ''}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      onOpen(a.username);
                    }}
                    className="text-[12px] font-semibold text-indigo-600 hover:underline"
                  >
                    To'liq ma'lumot
                  </button>
                </div>
              </div>
            </label>
          );
        })}
      </div>

      {!group.blocked ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-[13px] text-black/70">
            <input type="checkbox" checked={copyPassword} onChange={(e) => setCopyPassword(e.target.checked)} />
            Qo'shilgan hisobning parolini qoladigan hisobga ko'chirish
            {group.suggest_copy_password && primary === group.primary ? (
              <span className="text-[11px] text-indigo-700 font-semibold">(tavsiya: qoladigan hisobga hali kirilmagan)</span>
            ) : null}
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-[13px] font-semibold shadow-md disabled:opacity-50"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <GitMerge size={16} />} Birlashtirish
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
          <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Bir o'qituvchining takror hisoblarini topadi (o'qituvchi + ism-familiya ≥90% + bir xil kafedra)
 * va admin tasdiqlagach bitta hisobga birlashtiradi.
 */
export default function AdminStaffMerge() {
  const [tab, setTab] = useState<Tab>('candidates');
  const [groups, setGroups] = useState<MergeGroup[] | null>(null);
  const [status, setStatus] = useState<PinflStatus | null>(null);
  const [log, setLog] = useState<MergeLogEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [detailFor, setDetailFor] = useState<string | null>(null);

  const load = useCallback(async (which: Tab) => {
    setLoading(true);
    setError(null);
    try {
      if (which === 'candidates') setGroups((await fetchMergeCandidates()).groups);
      else if (which === 'pinfl') setStatus(await fetchPinflStatus());
      else setLog(await fetchMergeLog());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(tab);
  }, [tab, load]);

  const mergeable = useMemo(() => (groups ?? []).filter((g) => !g.blocked).length, [groups]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'candidates', label: `Takror hisoblar${groups ? ` (${groups.length})` : ''}` },
    { id: 'pinfl', label: 'JSHSHIR holati' },
    { id: 'log', label: 'Tarix' },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-black/90 flex items-center gap-2">
            <GitMerge size={22} /> O'qituvchilarni birlashtirish
          </h2>
          <p className="text-[13px] text-black/55 mt-1 max-w-2xl">
            Bir odamning ikki hisobi (masalan, Xodim ID va telefon raqami bilan ochilgani) topiladi: ikkalasi ham
            o'qituvchi, ism-familiya kamida 90% o'xshash va kafedra bir xil. Siz tasdiqlagach fanlar, tayyor kontent,
            yuz va JSHSHIR bitta hisobga yig'iladi.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load(tab)}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-black/10 text-black/70 text-[13px] font-semibold shadow-sm disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Yangilash
        </button>
      </div>

      <div className="flex gap-2 border-b border-black/10">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-[13px] font-semibold -mb-px border-b-2 ${
              tab === t.id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-black/50 hover:text-black/75'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {notice ? (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">
          <Check size={16} className="shrink-0 mt-0.5" /> {notice}
        </div>
      ) : null}
      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
          <AlertCircle size={18} className="shrink-0 mt-0.5" /> {error}
        </div>
      ) : null}
      {loading ? (
        <div className="py-10 text-center text-black/45">
          <Loader2 className="animate-spin inline mr-2" size={18} /> Yuklanmoqda…
        </div>
      ) : null}

      {tab === 'candidates' && groups && !loading ? (
        groups.length === 0 ? (
          <div className="py-10 text-center text-black/50 text-[14px]">Takror hisob topilmadi.</div>
        ) : (
          <div className="space-y-4">
            <p className="text-[13px] text-black/55">
              {groups.length} ta guruh topildi, shundan {mergeable} tasini birlashtirish mumkin.
            </p>
            {groups.map((g) => (
              <GroupCard
                key={g.accounts.map((a) => a.username).join('|')}
                group={g}
                onOpen={setDetailFor}
                onMerged={(msg) => {
                  setNotice(msg);
                  void load('candidates');
                }}
              />
            ))}
          </div>
        )
      ) : null}

      {tab === 'pinfl' && status && !loading ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['cam.fermi.uz xodimlari', `${status.cam_staff_with_pinfl} / ${status.cam_staff}`, 'JSHSHIRi borlari'],
              ['Hisobga bog\'langan JSHSHIR', `${status.pinfl_linked} / ${status.pinfl_records}`, `bog'lanmagan: ${status.pinfl_unlinked}`],
              ["iMentor o'qituvchilari", `${status.teachers_with_pinfl} / ${status.teachers_total}`, 'JSHSHIRi bor'],
              ['Oxirgi sinxronlash', fmt(status.last_synced_at), 'har soatda avtomatik'],
            ].map(([title, value, hint]) => (
              <div key={title} className="ios-glass rounded-2xl border border-white/60 p-4">
                <div className="text-[12px] text-black/50">{title}</div>
                <div className="text-lg font-bold text-black/90 tabular-nums">{value}</div>
                <div className="text-[12px] text-black/45">{hint}</div>
              </div>
            ))}
          </div>
          <div className="ios-glass rounded-2xl border border-white/60 overflow-hidden">
            <div className="px-4 py-3 text-[13px] font-semibold text-black/70 border-b border-black/5">
              JSHSHIRi bog'lanmagan o'qituvchilar ({status.teachers_without_pinfl.length})
            </div>
            <div className="overflow-x-auto max-h-[480px]">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-black/[0.04] text-black/55 font-semibold sticky top-0">
                  <tr>
                    <th className="px-4 py-2">F.I.Sh.</th>
                    <th className="px-4 py-2">Login</th>
                    <th className="px-4 py-2">Kafedra</th>
                    <th className="px-4 py-2">Oxirgi kirish</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5">
                  {status.teachers_without_pinfl.map((t) => (
                    <tr key={t.username} className="hover:bg-black/[0.02] cursor-pointer" onClick={() => setDetailFor(t.username)}>
                      <td className="px-4 py-2 font-medium">{t.display_name}</td>
                      <td className="px-4 py-2 font-mono text-[12px]">{t.username}</td>
                      <td className="px-4 py-2 text-black/65">{t.department}</td>
                      <td className="px-4 py-2 text-black/55 whitespace-nowrap">{fmt(t.last_login)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'log' && log && !loading ? (
        log.length === 0 ? (
          <div className="py-10 text-center text-black/50 text-[14px]">Hali birlashtirish bo'lmagan.</div>
        ) : (
          <div className="ios-glass rounded-2xl border border-white/60 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-black/[0.04] text-black/55 font-semibold">
                <tr>
                  <th className="px-4 py-2">Sana</th>
                  <th className="px-4 py-2">Qo'shilgan</th>
                  <th className="px-4 py-2">Qolgan</th>
                  <th className="px-4 py-2">Ko'chirilgan</th>
                  <th className="px-4 py-2">Admin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {log.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-2 whitespace-nowrap text-black/55">{fmt(l.merged_at)}</td>
                    <td className="px-4 py-2">
                      {l.merged_name} <span className="font-mono text-[12px] text-black/50">{l.merged}</span>
                    </td>
                    <td className="px-4 py-2 font-mono text-[12px]">{l.primary}</td>
                    <td className="px-4 py-2 text-black/65">{movedSummary(l.moved, l.skipped_duplicates)}</td>
                    <td className="px-4 py-2 font-mono text-[12px] text-black/55">{l.actor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {detailFor ? <AdminStaffDetail username={detailFor} onClose={() => setDetailFor(null)} /> : null}
    </div>
  );
}
