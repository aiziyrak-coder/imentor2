import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Link2, Loader2, ScanFace, Search, Unlink, X } from 'lucide-react';
import { HttpError } from '../../api/httpClient';
import { fetchFaceLinks, updateFaceLink, type FaceLink } from '../../utils/faceLinksApi';
import type { StaffDirectoryEntry } from '../../utils/staffDirectoryApi';

type Filter = 'unlinked' | 'linked' | 'all';

type Props = {
  staff: StaffDirectoryEntry[];
  onClose: () => void;
};

function errorText(err: unknown): string {
  if (err instanceof HttpError) {
    const detail = (err.body as { detail?: unknown } | null)?.detail;
    if (typeof detail === 'string') return detail;
  }
  return "Saqlab bo'lmadi. Qayta urinib ko'ring.";
}

/**
 * Yuz orqali kirish uchun: cam.fermi.uz'da yuzi tasdiqlangan xodimni iMentor
 * hisobiga bog'lash. Ism-familiyasi aniq mos kelganlar avtomatik bog'lanadi,
 * qolganini admin shu yerda bog'laydi.
 */
export default function AdminFaceLinks({ staff, onClose }: Props) {
  const [items, setItems] = useState<FaceLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('unlinked');
  const [query, setQuery] = useState('');
  const [savingId, setSavingId] = useState<number | null>(null);
  const [picked, setPicked] = useState<Record<number, string>>({});

  useEffect(() => {
    let alive = true;
    fetchFaceLinks()
      .then((rows) => alive && setItems(rows))
      .catch((err) => alive && setError(errorText(err)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const teachers = useMemo(
    () =>
      staff
        .filter((s) => s.role === 'hodim' && s.is_active)
        .map((s) => ({
          username: s.phone_digits,
          label: `${s.last_name} ${s.first_name}`.trim() + ` — ${s.phone_display}${s.department ? ` · ${s.department}` : ''}`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [staff],
  );

  const counts = useMemo(() => {
    const active = items.filter((i) => i.is_active);
    return { all: active.length, linked: active.filter((i) => i.owner_key).length };
  }, [items]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (!i.is_active) return false;
      if (filter === 'linked' && !i.owner_key) return false;
      if (filter === 'unlinked' && i.owner_key) return false;
      if (!q) return true;
      return `${i.full_name} ${i.position} ${i.owner_name} ${i.owner_key}`.toLowerCase().includes(q);
    });
  }, [items, filter, query]);

  const save = async (item: FaceLink, ownerKey: string) => {
    setSavingId(item.id);
    setError(null);
    try {
      const updated = await updateFaceLink(item.id, ownerKey);
      setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, ...updated, suggestions: p.suggestions } : p)));
    } catch (err) {
      setError(`${item.full_name}: ${errorText(err)}`);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="rounded-2xl border border-sky-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-600 text-white">
            <ScanFace size={20} />
          </div>
          <div>
            <h2 className="text-[16px] font-bold text-slate-900">Yuz orqali kirish — bog'lash</h2>
            <p className="text-[12.5px] text-slate-500">
              cam.fermi.uz'da yuzi tasdiqlangan xodimlar: {counts.all} ta, iMentor hisobiga bog'langan: {counts.linked} ta
            </p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Yopish">
          <X size={18} />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {(
          [
            ['unlinked', `Bog'lanmagan (${counts.all - counts.linked})`],
            ['linked', `Bog'langan (${counts.linked})`],
            ['all', 'Hammasi'],
          ] as [Filter, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`h-9 rounded-lg px-3 text-[13px] font-semibold ${
              filter === key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
        <div className="relative ml-auto w-full sm:w-72">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ism yoki bo'lim bo'yicha qidirish"
            className="h-9 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-[13px] outline-none focus:border-sky-400"
          />
        </div>
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-slate-500">
          <Loader2 size={18} className="animate-spin" /> Yuklanmoqda…
        </div>
      ) : visible.length === 0 ? (
        <p className="py-8 text-center text-[13.5px] text-slate-500">Bu ro'yxatda hech kim yo'q.</p>
      ) : (
        <div className="mt-3 max-h-[560px] divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-100">
          {visible.map((item) => (
            <div key={item.id} className="flex flex-col gap-2 px-3 py-3 lg:flex-row lg:items-center">
              <div className="min-w-0 lg:w-[34%]">
                <p className="truncate text-[13.5px] font-semibold text-slate-900">{item.full_name}</p>
                <p className="truncate text-[12px] text-slate-500">{item.position || '—'}</p>
              </div>
              {item.owner_key ? (
                <div className="flex flex-1 items-center gap-2">
                  <Check size={16} className="shrink-0 text-emerald-600" />
                  <p className="min-w-0 flex-1 truncate text-[13px] text-slate-700">
                    {item.owner_name} <span className="text-slate-400">({item.owner_key})</span>
                    {item.owner_department ? <span className="text-slate-400"> · {item.owner_department}</span> : null}
                    <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase text-slate-500">
                      {item.link_source === 'auto' ? 'avto' : 'admin'}
                    </span>
                  </p>
                  <button
                    type="button"
                    disabled={savingId === item.id}
                    onClick={() => void save(item, '')}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                  >
                    <Unlink size={14} /> Uzish
                  </button>
                </div>
              ) : (
                <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
                  <select
                    value={picked[item.id] ?? item.suggestions[0]?.username ?? ''}
                    onChange={(e) => setPicked((prev) => ({ ...prev, [item.id]: e.target.value }))}
                    className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-[13px]"
                  >
                    <option value="">— iMentor hisobini tanlang —</option>
                    {item.suggestions.length > 0 && (
                      <optgroup label="Mos kelishi mumkin">
                        {item.suggestions.map((s) => (
                          <option key={`s-${s.username}`} value={s.username}>
                            {s.name} — {s.username}
                            {s.department ? ` · ${s.department}` : ''}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="Barcha o'qituvchilar">
                      {teachers.map((tch) => (
                        <option key={tch.username} value={tch.username}>
                          {tch.label}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                  <button
                    type="button"
                    disabled={savingId === item.id || !(picked[item.id] ?? item.suggestions[0]?.username)}
                    onClick={() => void save(item, picked[item.id] ?? item.suggestions[0]?.username ?? '')}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-3 text-[13px] font-semibold text-white disabled:opacity-50"
                  >
                    {savingId === item.id ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
                    Bog'lash
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
