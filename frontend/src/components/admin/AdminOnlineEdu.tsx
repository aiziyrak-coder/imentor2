import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  GraduationCap,
  Loader2,
  Monitor,
  Plus,
  Download,
  RefreshCw,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import {
  addOnlineGroup,
  addOnlineTeacher,
  assignGroupCourse,
  assignTeacherCourse,
  createOnlineSyllabus,
  deleteOnlineSyllabus,
  fetchOnlineGroups,
  fetchOnlineLessons,
  fetchOnlineOverview,
  fetchOnlineProgress,
  fetchOnlineSyllabuses,
  fetchOnlineTeachers,
  removeOnlineGroup,
  removeOnlineTeacher,
  unassignGroupCourse,
  unassignTeacherCourse,
  type OnlineGroup,
  type OnlineLessonRow,
  type OnlineOverview,
  fetchOnlineReport,
  type OnlineProgressRow,
  type OnlineReport,
  type OnlineSyllabusBrief,
  type OnlineTeacher,
  type OnlineTopic,
  type OnlineVariant,
} from '../../utils/onlineEduApi';
import { parseVariantLabel } from '../../utils/syllabusVariant';

/**
 * Online ta'lim boshqaruvi — 6-kurs masofaviy dasturi.
 *
 * Bu sahifa FAQAT `online_*` jadvallari bilan ishlaydi. Hozirgi iMentor
 * fanlari, materiallari va talabalari bu yerdan ko'rinmaydi va bu yerdagi
 * hech narsa u yerga tushmaydi.
 */

type Tab = 'subjects' | 'teachers' | 'groups' | 'lessons' | 'results';

const TABS: Array<{ id: Tab; label: string; icon: typeof BookOpen }> = [
  { id: 'subjects', label: 'Fanlar', icon: BookOpen },
  { id: 'teachers', label: "O'qituvchilar", icon: GraduationCap },
  { id: 'groups', label: 'Guruhlar', icon: Users },
  { id: 'lessons', label: 'Darslar', icon: Monitor },
  { id: 'results', label: 'Natijalar', icon: Users },
];

function errText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // Backend xatoni `detail` da qaytaradi; JSON bo'lsa o'shani ko'rsatamiz.
  const m = msg.match(/"detail"\s*:\s*"([^"]+)"/);
  return m ? m[1] : msg;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-xl font-bold text-slate-900 tabular-nums">{value}</p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-8 text-center text-[13px] text-slate-500">
      {text}
    </div>
  );
}

export default function AdminOnlineEdu() {
  const [tab, setTab] = useState<Tab>('subjects');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [overview, setOverview] = useState<OnlineOverview | null>(null);
  const [syllabuses, setSyllabuses] = useState<OnlineSyllabusBrief[]>([]);
  const [teachers, setTeachers] = useState<OnlineTeacher[]>([]);
  const [groups, setGroups] = useState<OnlineGroup[]>([]);
  const [lessons, setLessons] = useState<OnlineLessonRow[]>([]);
  const [progress, setProgress] = useState<OnlineProgressRow[]>([]);
  const [report, setReport] = useState<OnlineReport | null>(null);
  const [filterSyllabus, setFilterSyllabus] = useState('');
  const [filterGroup, setFilterGroup] = useState('');

  const flash = useCallback((text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((n) => (n === text ? '' : n)), 3000);
  }, []);

  const reload = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const [ov, syl, tch, grp] = await Promise.all([
        fetchOnlineOverview(),
        fetchOnlineSyllabuses(),
        fetchOnlineTeachers(),
        fetchOnlineGroups(),
      ]);
      setOverview(ov);
      setSyllabuses(syl);
      setTeachers(tch);
      setGroups(grp);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (tab !== 'lessons') return;
    fetchOnlineLessons().then(setLessons).catch((e) => setError(errText(e)));
  }, [tab]);

  useEffect(() => {
    if (tab !== 'results') return;
    const params = {
      syllabusId: filterSyllabus ? Number(filterSyllabus) : undefined,
      groupName: filterGroup || undefined,
    };
    fetchOnlineProgress(params).then(setProgress).catch((e) => setError(errText(e)));
    fetchOnlineReport(params).then(setReport).catch((e) => setError(errText(e)));
  }, [tab, filterSyllabus, filterGroup]);

  const run = useCallback(
    async (fn: () => Promise<unknown>, okText: string) => {
      setBusy(true);
      setError('');
      try {
        await fn();
        await reload();
        flash(okText);
      } catch (e) {
        setError(errText(e));
      } finally {
        setBusy(false);
      }
    },
    [reload, flash],
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Online ta'lim</h2>
          <p className="text-[12.5px] text-slate-500">
            6-kurs masofaviy dasturi — <span className="font-mono">onlinetalim.fermi.uz</span>.
            Bu yerdagi fanlar va materiallar hozirgi iMentor'ga tushmaydi.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Yangilash
        </button>
      </header>

      {overview && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <Stat label="Fanlar" value={overview.syllabuses} />
          <Stat label="O'qituvchi" value={overview.teachers} />
          <Stat label="Guruh" value={overview.groups} />
          <Stat label="Material" value={overview.materials} />
          <Stat label="Dars" value={overview.lessons} />
          <Stat label="Ochilgan mavzu" value={overview.opened_topics} />
          <Stat label="Topshirilgan test" value={overview.tests_submitted} />
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-800">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Yopish">
            <X size={15} />
          </button>
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[13px] text-emerald-800">
          {notice}
        </div>
      )}

      <nav className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
                active
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon size={14} />
              {t.label}
            </button>
          );
        })}
      </nav>

      {tab === 'subjects' && (
        <SubjectsTab syllabuses={syllabuses} busy={busy} run={run} />
      )}
      {tab === 'teachers' && (
        <TeachersTab teachers={teachers} syllabuses={syllabuses} busy={busy} run={run} />
      )}
      {tab === 'groups' && (
        <GroupsTab groups={groups} syllabuses={syllabuses} busy={busy} run={run} />
      )}
      {tab === 'lessons' && <LessonsTab rows={lessons} />}
      {tab === 'results' && (
        <ResultsTab
          rows={progress}
          report={report}
          syllabuses={syllabuses}
          groups={groups}
          filterSyllabus={filterSyllabus}
          filterGroup={filterGroup}
          onFilterSyllabus={setFilterSyllabus}
          onFilterGroup={setFilterGroup}
        />
      )}
    </div>
  );
}

/* ============================ Fanlar ============================ */

function SubjectsTab({
  syllabuses,
  busy,
  run,
}: {
  syllabuses: OnlineSyllabusBrief[];
  busy: boolean;
  run: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [dept, setDept] = useState('');
  const [variants, setVariants] = useState<OnlineVariant[]>([]);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState('');

  const topicTotal = useMemo(
    () => variants.reduce((n, v) => n + v.topics.length, 0),
    [variants],
  );

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setParsing(true);
    setParseError('');
    try {
      // Mavjud iMentor'dagi AYNAN o'sha tahlilchi ishlatiladi — sillabus
      // formati bir xil, shuning uchun ikkinchi tahlilchi yozilmaydi.
      const { readXlsxRows } = await import('../../utils/xlsxRows');
      const { parseSyllabusExcel } = await import('../../utils/syllabusExcelParse');
      const next: OnlineVariant[] = [];
      for (const file of Array.from(files)) {
        const rows = await readXlsxRows(await file.arrayBuffer());
        const parsed = parseSyllabusExcel(rows, file.name);
        if (!parsed.topics.length) {
          throw new Error(`"${file.name}" faylidan mavzu topilmadi.`);
        }
        next.push({
          label: parseVariantLabel(file.name) || 'asosiy',
          file_name: file.name,
          topics: parsed.topics as unknown as OnlineTopic[],
        });
      }
      setVariants(next);
      if (!name.trim() && next[0]) {
        setName(next[0].file_name.replace(/\.[a-z0-9]+$/i, ''));
      }
    } catch (e) {
      setParseError(errText(e));
      setVariants([]);
    } finally {
      setParsing(false);
    }
  };

  const create = () =>
    run(async () => {
      if (!name.trim()) throw new Error('Fan nomini kiriting.');
      if (!variants.length) throw new Error('Sillabus faylini yuklang.');
      await createOnlineSyllabus({
        subject_name: name.trim(),
        department_name: dept.trim(),
        variants,
      });
      setName('');
      setDept('');
      setVariants([]);
    }, 'Fan qo‘shildi.');

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <h3 className="text-[14px] font-bold text-slate-900">Yangi fan qo'shish</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Fan nomi"
            className="rounded-lg border border-slate-200 px-3 py-2 text-[13.5px]"
          />
          <input
            value={dept}
            onChange={(e) => setDept(e.target.value)}
            placeholder="Kafedra (ixtiyoriy)"
            className="rounded-lg border border-slate-200 px-3 py-2 text-[13.5px]"
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-[13px] text-slate-600 hover:bg-slate-100">
          {parsing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          <span>
            Sillabus faylini tanlang (.xlsx) — bir nechta yo'nalish uchun bir nechta fayl
          </span>
          <input
            type="file"
            accept=".xlsx,.xls"
            multiple
            className="hidden"
            onChange={(e) => void onFiles(e.target.files)}
          />
        </label>

        {parseError && <p className="text-[12.5px] text-rose-700">{parseError}</p>}

        {variants.length > 0 && (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-700">
            <p className="font-semibold">
              {variants.length} ta yo'nalish, jami {topicTotal} ta mavzu:
            </p>
            <ul className="mt-1 space-y-0.5">
              {variants.map((v) => (
                <li key={v.file_name}>
                  <span className="font-medium">{v.label}</span> — {v.topics.length} mavzu
                  <span className="text-slate-400"> ({v.file_name})</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <button
          type="button"
          onClick={() => void create()}
          disabled={busy || parsing || !variants.length || !name.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          <Plus size={15} />
          Fanni qo'shish
        </button>
      </section>

      {syllabuses.length === 0 ? (
        <Empty text="Hali fan qo'shilmagan. Yuqoridan sillabus yuklang." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Fan</th>
                <th className="px-3 py-2 text-left font-semibold">Kafedra</th>
                <th className="px-3 py-2 text-left font-semibold">Yo'nalishlar</th>
                <th className="px-3 py-2 text-right font-semibold">Mavzu</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {syllabuses.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-800">{s.subject_name}</td>
                  <td className="px-3 py-2 text-slate-600">{s.department_name || '—'}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {s.variant_labels.length ? s.variant_labels.join(', ') : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                    {s.topic_count}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() =>
                        void run(() => deleteOnlineSyllabus(s.id), 'Fan o‘chirildi.')
                      }
                      disabled={busy}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                      aria-label="O'chirish"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ============================ O'qituvchilar ============================ */

function CourseAssigner({
  syllabuses,
  busy,
  onAssign,
}: {
  syllabuses: OnlineSyllabusBrief[];
  busy: boolean;
  onAssign: (syllabusId: number, variant: string) => void;
}) {
  const [sid, setSid] = useState('');
  const [variant, setVariant] = useState('');
  const chosen = syllabuses.find((s) => String(s.id) === sid);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={sid}
        onChange={(e) => {
          setSid(e.target.value);
          setVariant('');
        }}
        className="rounded-lg border border-slate-200 px-2 py-1 text-[12.5px]"
      >
        <option value="">Fan tanlang…</option>
        {syllabuses.map((s) => (
          <option key={s.id} value={s.id}>
            {s.subject_name}
          </option>
        ))}
      </select>
      {chosen && chosen.variant_labels.length > 0 && (
        <select
          value={variant}
          onChange={(e) => setVariant(e.target.value)}
          className="rounded-lg border border-slate-200 px-2 py-1 text-[12.5px]"
        >
          <option value="">Barcha yo'nalish</option>
          {chosen.variant_labels.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        disabled={busy || !sid}
        onClick={() => {
          onAssign(Number(sid), variant);
          setSid('');
          setVariant('');
        }}
        className="rounded-lg bg-slate-100 px-2.5 py-1 text-[12.5px] font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50"
      >
        Biriktirish
      </button>
    </div>
  );
}

function TeachersTab({
  teachers,
  syllabuses,
  busy,
  run,
}: {
  teachers: OnlineTeacher[];
  syllabuses: OnlineSyllabusBrief[];
  busy: boolean;
  run: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
}) {
  const [phone, setPhone] = useState('');

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
        <h3 className="text-[14px] font-bold text-slate-900">O'qituvchi qo'shish</h3>
        <p className="text-[12.5px] text-slate-500">
          O'qituvchi iMentor'da allaqachon ro'yxatdan o'tgan bo'lishi kerak — bu yerda
          faqat "online ham o'tadi" deb belgilanadi.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="998901112233"
            inputMode="numeric"
            className="flex-1 min-w-[12rem] rounded-lg border border-slate-200 px-3 py-2 text-[13.5px] font-mono"
          />
          <button
            type="button"
            disabled={busy || !phone.trim()}
            onClick={() =>
              void run(async () => {
                await addOnlineTeacher(phone.replace(/\D/g, ''));
                setPhone('');
              }, 'O‘qituvchi qo‘shildi.')
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            <Plus size={15} />
            Qo'shish
          </button>
        </div>
      </section>

      {teachers.length === 0 ? (
        <Empty text="Hali online o'qituvchi belgilanmagan." />
      ) : (
        <div className="space-y-2">
          {teachers.map((t) => (
            <div key={t.id} className="rounded-2xl border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[13.5px] font-semibold text-slate-800">
                    {t.full_name || t.owner_key}
                  </p>
                  <p className="font-mono text-[11.5px] text-slate-500">{t.owner_key}</p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void run(() => removeOnlineTeacher(t.id), 'O‘qituvchi olib tashlandi.')
                  }
                  disabled={busy}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                  aria-label="Olib tashlash"
                >
                  <Trash2 size={15} />
                </button>
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {t.courses.map((c) => (
                  <span
                    key={c.id}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-2.5 pr-1 text-[12px] text-slate-700"
                  >
                    {c.subject_name}
                    {c.variant_label ? ` · ${c.variant_label}` : ''}
                    <button
                      type="button"
                      onClick={() =>
                        void run(() => unassignTeacherCourse(c.id), 'Biriktiruv olindi.')
                      }
                      disabled={busy}
                      className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                      aria-label="Olib tashlash"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
                {t.courses.length === 0 && (
                  <span className="text-[12px] text-slate-400">Fan biriktirilmagan</span>
                )}
              </div>

              <div className="mt-2">
                <CourseAssigner
                  syllabuses={syllabuses}
                  busy={busy}
                  onAssign={(sid, variant) =>
                    void run(
                      () => assignTeacherCourse(t.id, sid, variant),
                      'Fan biriktirildi.',
                    )
                  }
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================ Guruhlar ============================ */

function GroupsTab({
  groups,
  syllabuses,
  busy,
  run,
}: {
  groups: OnlineGroup[];
  syllabuses: OnlineSyllabusBrief[];
  busy: boolean;
  run: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
}) {
  const [name, setName] = useState('');

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
        <h3 className="text-[14px] font-bold text-slate-900">Guruh qo'shish</h3>
        <p className="text-[12.5px] text-slate-500">
          Guruh nomi OnlineTest tizimidagi nom bilan AYNAN bir xil bo'lishi kerak —
          talaba kirganda tizim uni shu nom orqali topadi.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="601-guruh"
            className="flex-1 min-w-[12rem] rounded-lg border border-slate-200 px-3 py-2 text-[13.5px]"
          />
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={() =>
              void run(async () => {
                await addOnlineGroup(name.trim());
                setName('');
              }, 'Guruh qo‘shildi.')
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            <Plus size={15} />
            Qo'shish
          </button>
        </div>
      </section>

      {groups.length === 0 ? (
        <Empty text="Hali guruh qo'shilmagan." />
      ) : (
        <div className="space-y-2">
          {groups.map((g) => (
            <div key={g.id} className="rounded-2xl border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13.5px] font-semibold text-slate-800">{g.name}</p>
                <button
                  type="button"
                  onClick={() => void run(() => removeOnlineGroup(g.id), 'Guruh o‘chirildi.')}
                  disabled={busy}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                  aria-label="O'chirish"
                >
                  <Trash2 size={15} />
                </button>
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {g.courses.map((c) => (
                  <span
                    key={c.id}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-2.5 pr-1 text-[12px] text-slate-700"
                  >
                    {c.subject_name}
                    {c.variant_label ? ` · ${c.variant_label}` : ''}
                    <button
                      type="button"
                      onClick={() =>
                        void run(() => unassignGroupCourse(c.id), 'Biriktiruv olindi.')
                      }
                      disabled={busy}
                      className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                      aria-label="Olib tashlash"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
                {g.courses.length === 0 && (
                  <span className="text-[12px] text-slate-400">Fan biriktirilmagan</span>
                )}
              </div>

              <div className="mt-2">
                <CourseAssigner
                  syllabuses={syllabuses}
                  busy={busy}
                  onAssign={(sid, variant) =>
                    void run(() => assignGroupCourse(g.id, sid, variant), 'Fan biriktirildi.')
                  }
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================ Darslar ============================ */

function fmt(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('uz-UZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function LessonsTab({ rows }: { rows: OnlineLessonRow[] }) {
  if (rows.length === 0) return <Empty text="Hali video dars o'tkazilmagan." />;
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200">
      <table className="w-full text-[13px]">
        <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Fan / mavzu</th>
            <th className="px-3 py-2 text-left font-semibold">Guruh</th>
            <th className="px-3 py-2 text-left font-semibold">Boshlandi</th>
            <th className="px-3 py-2 text-left font-semibold">Tugadi</th>
            <th className="px-3 py-2 text-right font-semibold">Qatnashdi</th>
            <th className="px-3 py-2 text-left font-semibold">Holat</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="px-3 py-2">
                <span className="font-medium text-slate-800">{r.subject_name}</span>
                <span className="block text-[12px] text-slate-500">
                  {r.topic_code}. {r.topic_title || '—'}
                </span>
              </td>
              <td className="px-3 py-2 text-slate-600">{r.group_name}</td>
              <td className="px-3 py-2 tabular-nums text-slate-600">{fmt(r.started_at)}</td>
              <td className="px-3 py-2 tabular-nums text-slate-600">{fmt(r.ended_at)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                {r.attendance_count}
              </td>
              <td className="px-3 py-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${
                    r.is_opened
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {r.is_opened ? 'Mavzu ochiq' : 'Yopiq'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ============================ Natijalar ============================ */

function csvEscape(v: unknown): string {
  const t = String(v ?? '');
  return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** Hisobotni CSV qilib yuklab beradi — dekanat Excel'da ochadi. */
function downloadCsv(report: OnlineReport): void {
  const head = [
    'Talaba ID', 'F.I.Sh.', 'Guruh', 'Ochilgan mavzu',
    'Test topshirdi', 'Ball', 'Foiz', 'Darsga keldi', 'Davomat %', 'Daqiqa',
  ];
  const lines = [head.join(';')];
  for (const r of report.rows) {
    lines.push([
      r.student_id, r.student_name, r.group_name, r.topics_touched,
      r.tests_taken, `${r.score_sum}/${r.score_max}`,
      r.avg_pct === null ? '' : r.avg_pct,
      `${r.lessons_attended}/${report.lessons_total}`,
      r.attendance_pct === null ? '' : r.attendance_pct,
      r.minutes_total,
    ].map(csvEscape).join(';'));
  }
  // Excel UTF-8 ni BOM'siz tanimaydi va o'zbekcha harflar buziladi.
  const blob = new Blob(['\ufeff' + lines.join('\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'online-talim-hisobot.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function Bar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-slate-300">—</span>;
  const tone =
    pct >= 80 ? 'bg-emerald-500' : pct >= 55 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-200">
        <span className={`block h-full ${tone}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
      <span className="tabular-nums text-slate-700">{pct}%</span>
    </span>
  );
}

function ResultsTab({
  rows,
  report,
  syllabuses,
  groups,
  filterSyllabus,
  filterGroup,
  onFilterSyllabus,
  onFilterGroup,
}: {
  rows: OnlineProgressRow[];
  report: OnlineReport | null;
  syllabuses: OnlineSyllabusBrief[];
  groups: OnlineGroup[];
  filterSyllabus: string;
  filterGroup: string;
  onFilterSyllabus: (v: string) => void;
  onFilterGroup: (v: string) => void;
}) {
  const [view, setView] = useState<'summary' | 'detail'>('summary');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filterSyllabus}
          onChange={(e) => onFilterSyllabus(e.target.value)}
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px]"
        >
          <option value="">Barcha fanlar</option>
          {syllabuses.map((s) => (
            <option key={s.id} value={s.id}>{s.subject_name}</option>
          ))}
        </select>
        <select
          value={filterGroup}
          onChange={(e) => onFilterGroup(e.target.value)}
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px]"
        >
          <option value="">Barcha guruhlar</option>
          {groups.map((g) => (
            <option key={g.id} value={g.name}>{g.name}</option>
          ))}
        </select>

        <div className="ml-auto flex gap-1">
          {(['summary', 'detail'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium ${
                view === v ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {v === 'summary' ? 'Talabalar kesimida' : 'Mavzular kesimida'}
            </button>
          ))}
          {report && report.rows.length > 0 && (
            <button
              type="button"
              onClick={() => downloadCsv(report)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50"
            >
              <Download size={13} />
              CSV
            </button>
          )}
        </div>
      </div>

      {view === 'summary' ? (
        !report || report.rows.length === 0 ? (
          <Empty text="Hali natija yo'q." />
        ) : (
          <>
            <p className="text-[12.5px] text-slate-500">
              {report.lessons_total} ta dars o'tilgan · {report.topics_opened} ta mavzu ochilgan
            </p>
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full text-[13px]">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Talaba</th>
                    <th className="px-3 py-2 text-left font-semibold">Guruh</th>
                    <th className="px-3 py-2 text-right font-semibold">Test</th>
                    <th className="px-3 py-2 text-left font-semibold">O'zlashtirish</th>
                    <th className="px-3 py-2 text-left font-semibold">Davomat</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.student_id} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        <span className="font-medium text-slate-800">{r.student_name}</span>
                        <span className="block font-mono text-[11.5px] text-slate-500">
                          {r.student_id}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{r.group_name || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {r.tests_taken > 0 ? `${r.score_sum}/${r.score_max}` : '—'}
                      </td>
                      <td className="px-3 py-2"><Bar pct={r.avg_pct} /></td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-2">
                          <Bar pct={r.attendance_pct} />
                          <span className="text-[11.5px] text-slate-400">
                            {r.lessons_attended}/{report.lessons_total}
                          </span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : rows.length === 0 ? (
        <Empty text="Hali natija yo'q." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Talaba</th>
                <th className="px-3 py-2 text-left font-semibold">Guruh</th>
                <th className="px-3 py-2 text-left font-semibold">Fan / mavzu</th>
                <th className="px-3 py-2 text-right font-semibold">Ball</th>
                <th className="px-3 py-2 text-left font-semibold">Topshirdi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.student_id}-${r.topic_code}-${i}`} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <span className="font-medium text-slate-800">
                      {r.student_name || r.student_id}
                    </span>
                    <span className="block font-mono text-[11.5px] text-slate-500">
                      {r.student_id}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{r.group_name || '—'}</td>
                  <td className="px-3 py-2">
                    <span className="text-slate-800">{r.subject_name}</span>
                    <span className="block text-[12px] text-slate-500">
                      {r.topic_code}. {r.topic_title || '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-800">
                    {r.test_submitted_at ? `${r.test_score} / ${r.test_total}` : '—'}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-600">
                    {fmt(r.test_submitted_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
