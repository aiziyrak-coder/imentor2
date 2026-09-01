import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BookMarked,
  Check,
  ChevronDown,
  GraduationCap,
  Loader2,
  Plus,
  Search,
  Users,
  X,
} from 'lucide-react';
import {
  addOnlineTeacher,
  assignGroupCourse,
  assignTeacherCourse,
  fetchDepartments,
  fetchOnlineGroups,
  fetchOnlineTeachers,
  fetchStaffOptions,
  fetchSubjectDetail,
  unassignGroupCourse,
  unassignTeacherCourse,
  updateOnlineSyllabus,
  type DeptOption,
  type OnlineGroup,
  type StaffOption,
  type SubjectDetail,
} from '../../utils/onlineEduApi';

/**
 * Bitta fanning ish maydoni.
 *
 * Ilgari fan, o'qituvchi va guruh uch xil bo'limda edi: adminга fanni qo'shib,
 * keyin o'qituvchilar bo'limiga o'tib, kartochkasini topib, ikkita kichik
 * tanlagichdan fanni qayta tanlash kerak bo'lardi. Nima nimaga bog'langanini
 * ko'rish uchun uch joyni aylanib chiqish kerak edi.
 *
 * Endi ish birligi — FAN. Kafedrasi, o'qituvchisi, guruhlari, mavzulari va
 * darslari bir ekranda va bir tartibda turadi.
 */

function errText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/"detail"\s*:\s*"([^"]+)"/);
  return m ? m[1] : msg || 'Xatolik';
}

function Section({
  n,
  title,
  hint,
  done,
  children,
}: {
  n: number;
  title: string;
  hint?: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <header className="flex items-start gap-3 border-b border-slate-100 px-4 py-3">
        <span
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11.5px] font-bold ${
            done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
          }`}
        >
          {done ? <Check size={13} /> : n}
        </span>
        <div className="min-w-0">
          <h3 className="text-[14px] font-bold text-slate-900">{title}</h3>
          {hint && <p className="text-[12.5px] text-slate-500">{hint}</p>}
        </div>
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function Chip({
  label,
  sub,
  onRemove,
  tone = 'slate',
}: {
  label: string;
  sub?: string;
  onRemove?: () => void;
  tone?: 'slate' | 'amber';
}) {
  const bg = tone === 'amber' ? 'bg-amber-50 text-amber-900' : 'bg-slate-100 text-slate-700';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full py-1 pl-3 pr-1 text-[12.5px] ${bg}`}>
      <span className="font-medium">{label}</span>
      {sub && <span className="opacity-60">{sub}</span>}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="rounded-full p-0.5 opacity-50 hover:bg-black/10 hover:opacity-100"
          aria-label="Olib tashlash"
        >
          <X size={12} />
        </button>
      )}
    </span>
  );
}

export default function OnlineSubjectWorkspace({
  syllabusId,
  onBack,
  onChanged,
}: {
  syllabusId: number;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<SubjectDetail | null>(null);
  const [depts, setDepts] = useState<DeptOption[]>([]);
  const [groups, setGroups] = useState<OnlineGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [d, g] = await Promise.all([fetchSubjectDetail(syllabusId), fetchOnlineGroups()]);
      setData(d);
      setGroups(g);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [syllabusId]);

  useEffect(() => {
    void reload();
    fetchDepartments().then(setDepts).catch(() => {});
  }, [reload]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await reload();
      onChanged();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex justify-center py-16 text-slate-400">
        <Loader2 size={22} className="animate-spin" />
      </div>
    );
  }
  if (!data) {
    return <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>;
  }

  const dept = depts.find((d) => d.id === data.department_id);
  const totalTopics = data.variants.reduce((n, v) => n + v.topic_count, 0);
  const totalReady = data.variants.reduce((n, v) => n + v.ready_count, 0);

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        Barcha fanlar
      </button>

      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{data.subject_name}</h2>
          <p className="font-mono text-[11.5px] text-slate-400">{data.subject_code}</p>
        </div>
        {!data.is_active && (
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11.5px] font-semibold text-slate-500">
            Nofaol
          </span>
        )}
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Yopish">
            <X size={14} />
          </button>
        </div>
      )}

      <Section
        n={1}
        title="Kafedra"
        hint="AI ma'ruza va testni shu kafedra darsliklaridan yozadi"
        done={Boolean(data.department_id)}
      >
        <DeptPicker
          depts={depts}
          current={data.department_id}
          busy={busy}
          onPick={(d) =>
            void run(() =>
              updateOnlineSyllabus(data.id, {
                subject_name: data.subject_name,
                department_name: d.name,
                department_id: d.id,
                is_active: data.is_active,
              }),
            )
          }
        />
        {dept && dept.book_chunks === 0 && (
          <p className="mt-2 flex items-start gap-1.5 text-[12.5px] text-amber-700">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            Bu kafedrada darslik yuklanmagan — AI faqat o'z bilimidan yozadi.
          </p>
        )}
      </Section>

      <Section
        n={2}
        title="O'qituvchilar"
        hint="Ism bo'yicha qidiring — telefon raqamini yodlash shart emas"
        done={data.teachers.length > 0}
      >
        <div className="mb-2 flex flex-wrap gap-1.5">
          {data.teachers.map((t) => (
            <Chip
              key={t.link_id}
              label={t.full_name || t.owner_key}
              sub={t.variant_label || undefined}
              onRemove={() => void run(() => unassignTeacherCourse(t.link_id))}
            />
          ))}
          {data.teachers.length === 0 && (
            <span className="text-[12.5px] text-slate-400">Hali biriktirilmagan</span>
          )}
        </div>
        <StaffPicker
          variants={data.variant_labels}
          busy={busy}
          onPick={async (staff, variant) => {
            await run(async () => {
              const teachers = await fetchOnlineTeachers();
              let teacher = teachers.find((t) => t.owner_key === staff.owner_key);
              if (!teacher) {
                teacher = await addOnlineTeacher(staff.owner_key, staff.full_name);
              }
              await assignTeacherCourse(teacher.id, data.id, variant);
            });
          }}
        />
      </Section>

      <Section
        n={3}
        title="Guruhlar"
        hint="Talaba portalga kirsa, guruhi o'zi ro'yxatga tushadi"
        done={data.groups.length > 0}
      >
        <div className="mb-2 flex flex-wrap gap-1.5">
          {data.groups.map((g) => (
            <Chip
              key={g.link_id}
              label={g.name}
              sub={g.is_active ? g.variant_label || undefined : 'nofaol'}
              tone={g.is_active ? 'slate' : 'amber'}
              onRemove={() => void run(() => unassignGroupCourse(g.link_id))}
            />
          ))}
          {data.groups.length === 0 && (
            <span className="text-[12.5px] text-slate-400">Hali biriktirilmagan</span>
          )}
        </div>
        <GroupPicker
          groups={groups.filter((g) => !data.groups.some((x) => x.group_id === g.id))}
          variants={data.variant_labels}
          busy={busy}
          onPick={(groupId, variant) =>
            void run(() => assignGroupCourse(groupId, data.id, variant))
          }
        />
      </Section>

      <Section
        n={4}
        title="Mavzular va materiallar"
        hint={`${totalReady} / ${totalTopics} mavzu to'liq tayyor`}
        done={totalTopics > 0 && totalReady === totalTopics}
      >
        {data.variants.map((v) => (
          <div key={v.label} className="mb-3 last:mb-0">
            {data.variants.length > 1 && (
              <p className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-slate-400">
                {v.label || 'asosiy'}
              </p>
            )}
            <div className="space-y-1">
              {v.topics.map((t) => (
                <div
                  key={t.code}
                  className="flex items-center gap-2.5 rounded-lg bg-slate-50 px-2.5 py-1.5"
                >
                  <span className="w-7 shrink-0 text-center font-mono text-[11.5px] text-slate-400">
                    {t.code}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-slate-700">
                    {t.title}
                  </span>
                  {t.opened_for.length > 0 && (
                    <span className="hidden shrink-0 text-[11.5px] text-emerald-700 sm:inline">
                      {t.opened_for.join(', ')} uchun ochiq
                    </span>
                  )}
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                      t.ready === 6
                        ? 'bg-emerald-100 text-emerald-700'
                        : t.ready > 0
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-slate-200 text-slate-500'
                    }`}
                  >
                    {t.ready}/6
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
        <p className="mt-2 text-[12px] text-slate-500">
          Materiallarni o'qituvchi <span className="font-mono">onlinetalim.fermi.uz</span> da
          tayyorlaydi.
        </p>
      </Section>

      {data.lessons.length > 0 && (
        <Section n={5} title="Video darslar" hint={`${data.lessons.length} ta yozuv`} done>
          <div className="space-y-1">
            {data.lessons.slice(0, 12).map((l) => (
              <div
                key={l.id}
                className="flex items-center gap-2.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12.5px]"
              >
                <span className="w-7 shrink-0 text-center font-mono text-[11.5px] text-slate-400">
                  {l.topic_code}
                </span>
                <span className="min-w-0 flex-1 truncate text-slate-700">{l.group_name}</span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    l.is_opened
                      ? 'bg-emerald-100 text-emerald-700'
                      : l.started_at && !l.ended_at
                        ? 'bg-sky-100 text-sky-700'
                        : 'bg-slate-200 text-slate-500'
                  }`}
                >
                  {l.is_opened ? 'ochiq' : l.started_at && !l.ended_at ? 'ketyapti' : 'yopiq'}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

/* ==================== Tanlagichlar ==================== */

function DeptPicker({
  depts,
  current,
  busy,
  onPick,
}: {
  depts: DeptOption[];
  current: number | null;
  busy: boolean;
  onPick: (d: DeptOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const chosen = depts.find((d) => d.id === current);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = term ? depts.filter((d) => d.name.toLowerCase().includes(term)) : depts;
    // Darsligi ko'p kafedra tepada — admin qaysi biri to'la ekanini ko'rsin.
    return [...list].sort((a, b) => b.book_chunks - a.book_chunks).slice(0, 40);
  }, [depts, q]);

  if (!open) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-[13px] hover:bg-slate-50 disabled:opacity-50"
      >
        <BookMarked size={15} className="shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1 truncate">
          {chosen ? (
            <>
              <span className="text-slate-800">{chosen.name}</span>
              <span className="ml-2 text-[11.5px] text-slate-400 tabular-nums">
                {chosen.book_chunks.toLocaleString('uz-UZ')} parcha
              </span>
            </>
          ) : (
            <span className="text-slate-400">Kafedra tanlanmagan — tanlash uchun bosing</span>
          )}
        </span>
        <ChevronDown size={15} className="shrink-0 text-slate-300" />
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200">
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
        <Search size={14} className="shrink-0 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Kafedra nomi…"
          autoFocus
          className="w-full bg-transparent text-[13px] outline-none"
        />
        <button type="button" onClick={() => setOpen(false)} aria-label="Yopish">
          <X size={14} className="text-slate-400" />
        </button>
      </div>
      <ul className="max-h-64 overflow-y-auto">
        {shown.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              onClick={() => {
                onPick(d);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-slate-50"
            >
              <span className="min-w-0 flex-1 truncate text-slate-700">{d.name}</span>
              <span
                className={`shrink-0 text-[11.5px] tabular-nums ${
                  d.book_chunks > 0 ? 'text-slate-400' : 'text-amber-600'
                }`}
              >
                {d.book_chunks > 0 ? `${d.book_chunks.toLocaleString('uz-UZ')} parcha` : 'darslik yo‘q'}
              </span>
            </button>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="px-3 py-3 text-[12.5px] text-slate-400">Topilmadi</li>
        )}
      </ul>
    </div>
  );
}

function VariantSelect({
  variants,
  value,
  onChange,
}: {
  variants: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  if (variants.length <= 1) return null;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-slate-200 px-2 py-1.5 text-[12.5px]"
    >
      <option value="">Barcha yo'nalish</option>
      {variants.map((v) => (
        <option key={v} value={v}>
          {v}
        </option>
      ))}
    </select>
  );
}

function StaffPicker({
  variants,
  busy,
  onPick,
}: {
  variants: string[];
  busy: boolean;
  onPick: (staff: StaffOption, variant: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [variant, setVariant] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const t = window.setTimeout(() => {
      fetchStaffOptions(q)
        .then(setRows)
        .catch(() => setRows([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(t);
  }, [open, q]);

  if (!open) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        <Plus size={14} />
        O'qituvchi qo'shish
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
        <Search size={14} className="shrink-0 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ism yoki telefon…"
          autoFocus
          className="min-w-[8rem] flex-1 bg-transparent text-[13px] outline-none"
        />
        <VariantSelect variants={variants} value={variant} onChange={setVariant} />
        <button type="button" onClick={() => setOpen(false)} aria-label="Yopish">
          <X size={14} className="text-slate-400" />
        </button>
      </div>
      <ul className="max-h-56 overflow-y-auto">
        {loading && (
          <li className="flex items-center gap-2 px-3 py-3 text-[12.5px] text-slate-400">
            <Loader2 size={13} className="animate-spin" />
            Qidirilmoqda…
          </li>
        )}
        {!loading &&
          rows.map((s) => (
            <li key={s.owner_key}>
              <button
                type="button"
                onClick={() => {
                  void onPick(s, variant);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
              >
                <GraduationCap size={14} className="shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-slate-800">{s.full_name}</span>
                  <span className="block truncate text-[11.5px] text-slate-400">
                    {s.department || s.owner_key}
                  </span>
                </span>
                {s.is_online_teacher && (
                  <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700">
                    online
                  </span>
                )}
              </button>
            </li>
          ))}
        {!loading && rows.length === 0 && (
          <li className="px-3 py-3 text-[12.5px] text-slate-400">Topilmadi</li>
        )}
      </ul>
    </div>
  );
}

function GroupPicker({
  groups,
  variants,
  busy,
  onPick,
}: {
  groups: OnlineGroup[];
  variants: string[];
  busy: boolean;
  onPick: (groupId: number, variant: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [variant, setVariant] = useState('');

  if (!open) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        <Plus size={14} />
        Guruh qo'shish
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200">
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
        <Users size={14} className="shrink-0 text-slate-400" />
        <span className="flex-1 text-[12.5px] text-slate-500">Ro'yxatdagi guruhlar</span>
        <VariantSelect variants={variants} value={variant} onChange={setVariant} />
        <button type="button" onClick={() => setOpen(false)} aria-label="Yopish">
          <X size={14} className="text-slate-400" />
        </button>
      </div>
      <ul className="max-h-56 overflow-y-auto">
        {groups.map((g) => (
          <li key={g.id}>
            <button
              type="button"
              onClick={() => {
                onPick(g.id, variant);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] text-slate-800">{g.name}</span>
              {!g.is_active && (
                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-medium text-amber-700">
                  hali yoqilmagan
                </span>
              )}
              {g.student_count > 0 && (
                <span className="shrink-0 text-[11.5px] text-slate-400 tabular-nums">
                  {g.student_count} talaba
                </span>
              )}
            </button>
          </li>
        ))}
        {groups.length === 0 && (
          <li className="px-3 py-3 text-[12.5px] text-slate-400">
            Guruh yo'q. Talaba portalga kirgach guruhi shu yerda paydo bo'ladi.
          </li>
        )}
      </ul>
    </div>
  );
}
