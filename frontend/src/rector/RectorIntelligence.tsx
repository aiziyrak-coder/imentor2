import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { HttpError } from '../api/httpClient';
import { fetchTeacherDetail, type ReportFilters, type TeacherDetail } from './rectorApi';
import {
  analyzeIntelligence,
  downloadIntelligenceCsv,
  fetchIntelligence,
  FILTER_DEFAULTS,
  type IntelligenceAnalysis,
  type IntelligenceFilters,
  type IntelligenceReport,
  type IntelligenceRow,
  type LocalFilters,
} from './intelligenceApi';
import { downloadIntelligencePdf } from './intelligencePdf';
import { ReportStatus, STATUS_LABELS, STATUS_STYLES } from './ReportStatus';
import { InteractiveBoard } from './InteractiveBoard';

const INPUT =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/10';
const BUTTON =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40';
const PRIMARY =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-40';
const SIGNALS: Record<string, string> = {
  no_activity: 'Faollik yo‘q',
  no_lessons: 'Dars yo‘q',
  no_materials: 'Material yo‘q',
  low_results: 'Natija past',
  no_results: 'Natija yo‘q',
};
const STORAGE = 'imentor-rector-searches-v1';
const time = (iso: string) =>
  new Date(iso).toLocaleString('uz-UZ', {
    timeZone: 'Asia/Tashkent',
    dateStyle: 'short',
    timeStyle: 'short',
  });
const diff = (n: number | undefined) =>
  n === undefined ? 'Solishtirish o‘chiq' : `${n > 0 ? '+' : ''}${n} oldingi davrdan`;
const score = (r: IntelligenceRow) =>
  r.avg_student_score === null ? 'Ma’lumot yo‘q' : `${r.avg_student_score}%`;

function errorText(error: unknown) {
  if (error instanceof HttpError && error.body && typeof error.body === 'object') {
    const detail = (error.body as { detail?: unknown }).detail;
    if (typeof detail === 'string') return detail;
    if (error.status === 422)
      return 'Sana va filtr qiymatlarini tekshiring: boshlanish tugashdan keyin bo‘lmasin, oraliq 366 kundan oshmasin.';
    if (error.status === 429) return 'So‘rovlar ko‘paydi. Bir oz kutib qayta urinib ko‘ring.';
  }
  return 'Hisobotni olishda xato. Qayta urinib ko‘ring.';
}

function Metric({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
        {value}
      </p>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </div>
  );
}

function TeacherProfile({
  row,
  report,
  onClose,
  onAnalyze,
  analysis,
}: {
  row: IntelligenceRow;
  report: IntelligenceReport;
  onClose: () => void;
  onAnalyze: (owner: string) => void;
  analysis: IntelligenceAnalysis | null;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<TeacherDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    modal.current?.showModal();
  }, []);
  useEffect(() => {
    let alive = true;
    fetchTeacherDetail(row.owner_key, { from: report.from, to: report.to })
      .then((d) => {
        if (alive) setDetail(d);
      })
      .catch(() => {
        if (alive) setError('Kunlik tafsilot yuklanmadi. Oynani qayta ochib ko‘ring.');
      });
    return () => {
      alive = false;
    };
  }, [row.owner_key, report.from, report.to]);
  return (
    <dialog
      ref={modal}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) modal.current?.close();
      }}
      className="m-auto max-h-[90dvh] w-[min(1050px,95vw)] rounded-3xl bg-slate-50 p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/50"
      aria-labelledby="teacher-title"
    >
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-teal-700">
            Shaxsiy hisobot
          </p>
          <h2 id="teacher-title" className="mt-1 text-xl font-bold">
            {row.display_name}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {row.department || 'Kafedra belgilanmagan'} · {row.job_title || 'O‘qituvchi'}
          </p>
          <p className="text-xs text-slate-400">
            Login: {row.owner_key} · {report.from} — {report.to}
          </p>
        </div>
        <button
          type="button"
          aria-label="Yopish"
          onClick={() => modal.current?.close()}
          className={BUTTON}
        >
          <X size={18} />
        </button>
      </div>
      <div className="space-y-5 p-5">
        <InteractiveBoard board={row.board} full />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Faol daqiqa" value={row.minutes} note={diff(row.delta?.minutes)} />
          <Metric
            label="Material"
            value={row.created_total}
            note={diff(row.delta?.created_total)}
          />
          <Metric label="Dars" value={row.lessons_total} note={diff(row.delta?.lessons_total)} />
          <Metric
            label="Talabalar natijasi"
            value={score(row)}
            note={`${row.student_attempts} urinish${row.small_sample ? ' · xulosa uchun namuna kichik' : ''}`}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <ReportStatus status={row.status} />
          {row.signals.map((s) => (
            <span
              key={s}
              className="rounded-lg bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900"
            >
              {report.signal_labels[s]}
            </span>
          ))}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-7">
          <p>
            <b>Materiallar:</b> {row.cases_created} keys · {row.tests_created} test ·{' '}
            {row.handouts_created} tarqatma · {row.videos_created} video ·{' '}
            {row.presentations_created} taqdimot
          </p>
          <p>
            <b>Darslar:</b> {row.live_sessions} jonli test · {row.online_lessons} online dars ·{' '}
            {row.students_taught} talaba
          </p>
          <p>
            <b>Foydalanish:</b> {row.active_days} faol kun · {row.videos_viewed} video ko‘rish ·{' '}
            {row.handouts_viewed} tarqatma ochish
          </p>
          <p>
            <b>Oxirgi kirish:</b> {row.last_login ? time(row.last_login) : 'Qayd etilmagan'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className={PRIMARY}
            onClick={() => {
              onAnalyze(row.owner_key);
              modal.current?.close();
            }}
          >
            <Sparkles size={16} /> Shu o‘qituvchini AI tahlil qilsin
          </button>
          <button
            className={BUTTON}
            disabled={!detail || busy}
            onClick={() => {
              setBusy(true);
              void downloadIntelligencePdf(report, [row], analysis, detail!)
                .catch(() => setError('PDF tayyorlab bo‘lmadi.'))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? <Loader2 className="animate-spin" size={16} /> : <ArrowDownToLine size={16} />}{' '}
            Shaxsiy PDF
          </button>
          <button className={BUTTON} onClick={() => downloadIntelligenceCsv(report, [row])}>
            Excel (CSV)
          </button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-rose-700">
            {error}
          </p>
        )}
        {!detail && !error && (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="animate-spin" size={16} /> Kunlik yozuvlar yuklanmoqda…
          </p>
        )}
        {detail && (
          <>
            <h3 className="font-semibold">Kunma-kun faollik</h3>
            <p className="text-xs text-slate-400">Daqiqalar kun va bo‘lim kesimida yaxlitlangan.</p>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100">
                  <tr>
                    {['Sana', 'Daqiqa', 'Video ko‘rish', 'Tarqatma ochish', 'Keys / test'].map(
                      (h) => (
                        <th className="p-3" key={h}>
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {detail.days.map((d) => (
                    <tr key={d.date} className="border-t border-slate-100">
                      <td className="p-3">{d.date}</td>
                      <td>{d.minutes}</td>
                      <td>{d.videos_viewed}</td>
                      <td>{d.handouts_viewed}</td>
                      <td>
                        {d.cases_created} / {d.tests_created}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!detail.days.length && (
                <p className="p-4 text-sm text-slate-500">
                  Bu davrda kunlik faollik qayd etilmagan.
                </p>
              )}
            </div>
            <h3 className="font-semibold">O‘tilgan darslar · {detail.lessons.length}</h3>
            <div className="space-y-2">
              {detail.lessons.map((l) => (
                <div
                  key={`${l.kind}-${l.id}`}
                  className="rounded-xl border border-slate-200 bg-white p-3 text-sm"
                >
                  <b>{l.topic || l.subject_name || 'Mavzu ko‘rsatilmagan'}</b>
                  <p className="mt-1 text-xs text-slate-500">
                    {l.held_at ? time(l.held_at) : 'Sana yo‘q'} · {l.kind_label} · {l.students}{' '}
                    talaba · {l.avg_score === null ? 'Natija yo‘q' : `${l.avg_score}%`}
                  </p>
                </div>
              ))}
              {!detail.lessons.length && (
                <p className="text-sm text-slate-500">Bu davrda dars qayd etilmagan.</p>
              )}
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}

export default function RectorIntelligence({
  filters,
  onUnauthorized,
}: {
  filters: ReportFilters;
  onUnauthorized: () => void;
}) {
  const [local, setLocal] = useState<LocalFilters>({ ...FILTER_DEFAULTS });
  const [query, setQuery] = useState('');
  const [report, setReport] = useState<IntelligenceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState<IntelligenceRow | null>(null);
  const [analysis, setAnalysis] = useState<IntelligenceAnalysis | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [question, setQuestion] = useState('Kimga qanday yordam kerak va qaysi ishlar ustuvor?');
  const [saveName, setSaveName] = useState('');
  const [saved, setSaved] = useState<Array<{ name: string; filters: LocalFilters }>>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(STORAGE) || '[]');
      return Array.isArray(v)
        ? v
            .filter((x) => typeof x?.name === 'string' && typeof x?.filters?.q === 'string')
            .slice(0, 8)
        : [];
    } catch {
      return [];
    }
  });
  const analysisRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = window.setTimeout(() => setQuery(local.q.trim()), 350);
    return () => window.clearTimeout(id);
  }, [local.q]);
  const request: IntelligenceFilters = useMemo(
    () => ({
      ...local,
      q: query,
      date_from: filters.from,
      date_to: filters.to,
      department: filters.department || '',
    }),
    [local, query, filters.from, filters.to, filters.department],
  );
  // Only the debounced query changes the request identity.
  const key = JSON.stringify({ ...request, q: query });
  const currentKey = useRef(key);
  currentKey.current = key;
  const revision = useRef(0);
  const loadedKey = useRef('');
  const pending = local.q.trim() !== query;
  useEffect(() => {
    const changed = loadedKey.current !== key;
    if (!changed && (aiBusy || open)) return;
    loadedKey.current = key;
    let alive = true;
    const rev = ++revision.current;
    setLoading(true);
    setError('');
    if (changed) {
      setReport(null);
      setAnalysis(null);
      setSelected([]);
      setOpen(null);
      setPage(1);
      setAiBusy(false);
    }
    void fetchIntelligence(JSON.parse(key))
      .then((r) => {
        if (alive && rev === revision.current) setReport(r);
      })
      .catch((e) => {
        if (!alive) return;
        if (e instanceof HttpError && [401, 403].includes(e.status)) {
          onUnauthorized();
          return;
        }
        setError(errorText(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [key, filters.refreshKey, retry, onUnauthorized]);
  const update = (patch: Partial<LocalFilters>) => setLocal((v) => ({ ...v, ...patch }));
  const toggleFocus = (flag: string) => {
    const list = local.focus.split(',').filter(Boolean);
    update({
      focus: list.includes(flag)
        ? list.filter((x) => x !== flag).join(',')
        : [...list, flag].join(','),
    });
  };
  const saveSearch = () => {
    if (!saveName.trim()) return;
    const next = [
      { name: saveName.trim().slice(0, 50), filters: { ...local } },
      ...saved.filter((s) => s.name !== saveName.trim()),
    ].slice(0, 8);
    setSaved(next);
    try {
      localStorage.setItem(STORAGE, JSON.stringify(next));
      setSaveName('');
    } catch {
      setError('Bu brauzerda qidiruvni saqlab bo‘lmadi.');
    }
  };
  const runAnalysis = async (owners = selected) => {
    if (!report || pending) return;
    const started = key;
    const rev = revision.current;
    setAiBusy(true);
    setError('');
    setAnalysis(null);
    analysisRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      const result = await analyzeIntelligence(request, question, owners);
      if (currentKey.current === started && revision.current === rev) {
        setAnalysis(result);
        if (result.report) setReport(result.report);
      }
    } catch (e) {
      if (currentKey.current === started && revision.current === rev) {
        if (e instanceof HttpError && [401, 403].includes(e.status)) onUnauthorized();
        else setError(errorText(e));
      }
    } finally {
      if (currentKey.current === started && revision.current === rev) setAiBusy(false);
    }
  };
  const rows = report?.rows || [];
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const visible = rows.slice((page - 1) * pageSize, page * pageSize);
  const selectedRows = rows.filter((r) => selected.includes(r.owner_key));
  return (
    <div className="w-full min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-900">O‘qituvchilar hisoboti</h1>
        <p className="text-sm text-slate-500">
          {report ? `${report.count} mos / ${report.total} o‘qituvchi` : 'Yuklanmoqda…'}
        </p>
      </div>
      <section
        aria-label="Rang bo‘yicha filtr"
        className="rounded-2xl border border-slate-200 bg-white p-4"
      >
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-slate-600">
            Baholash mezoni
            <select
              aria-label="Baholash mezoni"
              className={`${INPUT} mt-1`}
              value={local.criterion}
              onChange={(e) =>
                update({ criterion: e.target.value as LocalFilters['criterion'], status: 'all' })
              }
            >
              <option value="usage">iMentordan foydalanish</option>
              <option value="materials">Material yaratish</option>
              <option value="lessons">Dars o‘tish</option>
              <option value="results">Talabalar natijasi</option>
            </select>
          </label>
          {local.criterion === 'usage' && (
            <label className="text-xs font-medium text-slate-600">
              Yashil chegara (daqiqa / kun)
              <input
                aria-label="Yashil chegara"
                type="number"
                min={1}
                max={1440}
                value={local.green_minutes_per_day}
                className={`${INPUT} mt-1 max-w-48`}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (n >= 1 && n <= 1440) update({ green_minutes_per_day: n });
                }}
              />
            </label>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <button
            type="button"
            aria-pressed={local.status === 'all'}
            onClick={() => update({ status: 'all' })}
            className={`rounded-xl border p-3 text-left ${local.status === 'all' ? 'ring-2 ring-slate-700' : ''}`}
          >
            <span className="text-xs">Barchasi</span>
            <b className="block text-2xl">
              {report?.status_counts
                ? Object.values(report.status_counts).reduce((a, b) => a + b, 0)
                : (report?.count ?? '—')}
            </b>
          </button>
          {(Object.keys(STATUS_LABELS) as Array<keyof typeof STATUS_LABELS>).map((status) => (
            <button
              key={status}
              type="button"
              aria-label={`${STATUS_LABELS[status]} ro‘yxat`}
              aria-pressed={local.status === status}
              onClick={() => update({ status: local.status === status ? 'all' : status })}
              className={`rounded-xl border p-3 text-left ${STATUS_STYLES[status]} ${local.status === status ? 'ring-2 ring-slate-700' : ''}`}
            >
              <span className="text-xs">{STATUS_LABELS[status]}</span>
              <b className="block text-2xl">{report?.status_counts?.[status] ?? '—'}</b>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-600">
          {local.criterion === 'usage'
            ? `Qizil: 0 daqiqa. Sariq: faollik bor, kuniga o‘rtacha ${local.green_minutes_per_day} daqiqadan kam. Yashil: kamida ${local.green_minutes_per_day} daqiqa / kun (tanlangan barcha kalendar kunlar hisoblanadi).`
            : local.criterion === 'materials'
              ? 'Qizil: 0 material. Sariq: 1–4 material. Yashil: 5 va undan ko‘p material.'
              : local.criterion === 'lessons'
                ? 'Faqat doskasi bor kafedralar: qizil 0 dars, sariq 1–2 dars, yashil 3+ dars. Doska yo‘q yoki mavjudligi aniqlanmagan bo‘lsa kulrang — dars ko‘rsatkichi baholanmaydi.'
                : 'Kamida 5 test urinishi bo‘lsa: qizil 56% dan past, sariq 56–70%, yashil 71% va yuqori. Natija yo‘q yoki urinishlar kam bo‘lsa kulrang.'}{' '}
          Rangni bosing — ro‘yxat filtrlanadi. Bu platformadagi yozuvlar bo‘yicha mezon.
        </p>
      </section>
      <section
        className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"
        aria-label="Aqlli filtrlar"
      >
        <div className="grid gap-3 md:grid-cols-[minmax(220px,2fr)_1fr_1fr]">
          <label className="text-xs font-medium text-slate-500">
            Familiya, ism yoki login
            <div className="relative mt-1">
              <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
              <input
                aria-label="Familiya, ism yoki login"
                value={local.q}
                maxLength={128}
                onChange={(e) => update({ q: e.target.value })}
                placeholder="Masalan: Rahimov yoki Раҳимов"
                className={`${INPUT} pl-10`}
              />
            </div>
          </label>
          <label className="text-xs font-medium text-slate-500">
            Qidirish usuli
            <select
              className={`${INPUT} mt-1`}
              value={local.match_mode}
              onChange={(e) => update({ match_mode: e.target.value as LocalFilters['match_mode'] })}
            >
              <option value="contains">Yozilgan qism bo‘yicha</option>
              <option value="exact">Aniq so‘z bo‘yicha</option>
            </select>
          </label>
          <label className="text-xs font-medium text-slate-500">
            Saralash
            <select
              className={`${INPUT} mt-1`}
              value={local.sort}
              onChange={(e) => update({ sort: e.target.value as LocalFilters['sort'] })}
            >
              {Object.entries({
                name: 'Familiya A–Z',
                name_desc: 'Familiya Z–A',
                department: 'Kafedra A–Z',
                attention: 'E’tibor talab qiladiganlar',
                minutes_desc: 'Ko‘p ishlagandan',
                minutes_asc: 'Kam ishlagandan',
                lessons: 'Ko‘p dars o‘tgandan',
                lessons_asc: 'Kam dars o‘tgandan',
                materials: 'Ko‘p material yaratgandan',
                materials_asc: 'Kam material yaratgandan',
                days: 'Ko‘p faol kundan',
                days_asc: 'Kam faol kundan',
                students: 'Ko‘p talabadan',
                students_asc: 'Kam talabadan',
                score: 'Natijasi pastdan',
                score_desc: 'Natijasi yuqoridan',
              }).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
            Interaktiv doska
            <select
              aria-label="Interaktiv doska"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2"
              value={local.board}
              onChange={(e) => update({ board: e.target.value as LocalFilters['board'] })}
            >
              <option value="all">Barchasi</option>
              <option value="available">Doska mavjud</option>
              <option value="unavailable">Doska mavjud emas</option>
              <option value="unknown">Mavjudligi aniqlanmagan</option>
            </select>
          </label>
          {Object.entries(SIGNALS).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={local.focus.split(',').includes(value)}
              onClick={() => toggleFocus(value)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${local.focus.split(',').includes(value) ? 'border-teal-800 bg-teal-800 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              {label}
            </button>
          ))}
          {report?.board_inventory && (
            <a
              className="self-center text-xs text-slate-500 underline"
              href={report.board_inventory.source_url}
              target="_blank"
              rel="noreferrer"
            >
              Doska jadvali · {report.board_inventory.checked_on}
            </a>
          )}
        </div>
        <details className="rounded-xl bg-slate-50 p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">
            Qo‘shimcha filtrlar va saqlangan qidiruvlar
          </summary>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
            <label className="text-xs text-slate-500">
              Faollik
              <select
                value={local.activity}
                onChange={(e) => update({ activity: e.target.value as LocalFilters['activity'] })}
                className={`${INPUT} mt-1`}
              >
                <option value="all">Barchasi</option>
                <option value="active">Faollar</option>
                <option value="inactive">Faollik yo‘q</option>
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Natija mavjudligi
              <select
                value={local.results}
                onChange={(e) => update({ results: e.target.value as LocalFilters['results'] })}
                className={`${INPUT} mt-1`}
              >
                <option value="all">Barchasi</option>
                <option value="has">Natija bor</option>
                <option value="none">Natija yo‘q</option>
              </select>
            </label>
            {(['min_minutes', 'max_minutes', 'min_score', 'max_score'] as const).map((k, i) => (
              <label key={k} className="text-xs text-slate-500">
                {
                  [
                    'Eng kam daqiqa',
                    'Eng ko‘p daqiqa',
                    'Eng kam natija (%)',
                    'Eng ko‘p natija (%)',
                  ][i]
                }
                <input
                  type="number"
                  min={0}
                  max={k.includes('score') ? 100 : 1000000}
                  value={local[k] ?? ''}
                  onChange={(e) =>
                    update({ [k]: e.target.value === '' ? null : Number(e.target.value) })
                  }
                  className={`${INPUT} mt-1`}
                />
              </label>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              aria-label="Qidiruv nomi"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Qidiruv nomi"
              className={`${INPUT} max-w-52`}
            />
            <button onClick={saveSearch} disabled={!saveName.trim()} className={BUTTON}>
              Qidiruvni saqlash
            </button>
            {saved.map((s) => (
              <button
                key={s.name}
                className={BUTTON}
                onClick={() => setLocal({ ...FILTER_DEFAULTS, ...s.filters })}
              >
                {s.name}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Saqlangan qidiruv tanlangan sana va kafedraga qo‘llanadi.
          </p>
        </details>
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
          <p>
            Lotin va kirill moslashtiriladi. Bir nechta belgi tanlansa, ularning barchasiga mos
            kelganlar chiqadi.
          </p>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={local.compare}
                onChange={(e) => update({ compare: e.target.checked })}
              />{' '}
              Oldingi teng davr bilan solishtirish
            </label>
            <button
              className="font-semibold text-teal-800"
              onClick={() => setLocal({ ...FILTER_DEFAULTS })}
            >
              Tozalash
            </button>
          </div>
        </div>
      </section>
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
        >
          {error}
          <button onClick={() => setRetry((v) => v + 1)} className={BUTTON}>
            Yangilash
          </button>
        </div>
      )}
      {loading && (
        <div role="status" className="flex justify-center gap-2 p-8 text-slate-500">
          <Loader2 className="animate-spin" /> Hisobot hisoblanmoqda…
        </div>
      )}
      {report && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Metric label="Filtrdagi o‘qituvchi" value={report.count} />
            <Metric label="Platformada faol" value={report.summary.active} />
            <Metric label="Jami daqiqa" value={report.summary.minutes} />
            <Metric label="Yaratilgan material" value={report.summary.materials} />
            <Metric label="Qayd etilgan dars" value={report.summary.lessons} />
            <Metric label="Test urinishi" value={report.summary.attempts} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              {time(report.generated_at)} · Toshkent
              {report.previous_from
                ? ` · Oldingi davr: ${report.previous_from} — ${report.previous_to}`
                : ''}
            </p>
            <div className="flex gap-2">
              <button
                disabled={pending || !rows.length || pdfBusy}
                className={BUTTON}
                onClick={() => {
                  setPdfBusy(true);
                  void downloadIntelligencePdf(report, rows, analysis)
                    .catch(() => setError('PDF tayyorlab bo‘lmadi.'))
                    .finally(() => setPdfBusy(false));
                }}
              >
                {pdfBusy ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <ArrowDownToLine size={16} />
                )}{' '}
                Filtrlangan PDF
              </button>
              <button
                disabled={pending || !rows.length}
                className={BUTTON}
                onClick={() => downloadIntelligenceCsv(report)}
              >
                Excel (CSV)
              </button>
            </div>
          </div>
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
              <h2 className="flex items-center gap-2 font-semibold text-slate-800">
                <Users size={18} /> Familiyalar bo‘yicha · {rows.length}
              </h2>
              <span className="text-xs text-slate-500">
                Familiyani bosing — shaxsiy hisobot. AI uchun 30 tagacha tanlang.
              </span>
            </div>
            <div className="grid gap-3 p-3 md:hidden">
              {visible.map((r) => (
                <article key={r.owner_key} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <button
                        className="text-left text-sm font-semibold text-slate-900"
                        onClick={() => setOpen(r)}
                      >
                        {r.display_name}
                      </button>
                      <p className="mt-1 text-xs text-slate-500">
                        {r.department || 'Kafedra belgilanmagan'}
                      </p>
                      <p className="mt-1 text-[10px] text-slate-400">{r.owner_key}</p>
                    </div>
                    <input
                      type="checkbox"
                      aria-label={`${r.display_name}ni tanlash`}
                      checked={selected.includes(r.owner_key)}
                      disabled={!selected.includes(r.owner_key) && selected.length >= 30}
                      onChange={() =>
                        setSelected((v) =>
                          v.includes(r.owner_key)
                            ? v.filter((x) => x !== r.owner_key)
                            : [...v, r.owner_key],
                        )
                      }
                    />
                  </div>
                  <div className="mt-2">
                    <ReportStatus status={r.status} />
                  </div>
                  <div className="mt-2">
                    <InteractiveBoard board={r.board} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <p>
                      Daqiqa: <b>{r.minutes}</b>
                    </p>
                    <p>
                      Material: <b>{r.created_total}</b>
                    </p>
                    <p>
                      Dars: <b>{r.lessons_total}</b>
                    </p>
                    <p>
                      Natija: <b>{score(r)}</b>
                    </p>
                  </div>
                  <p className="mt-2 text-[10px] text-slate-400">
                    {diff(r.delta?.minutes)} · {r.student_attempts} urinish
                    {r.small_sample ? ' · namuna kichik' : ''}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {r.signals.map((s) => (
                      <span
                        key={s}
                        className="rounded bg-slate-100 px-2 py-1 text-[10px] text-slate-600"
                      >
                        {SIGNALS[s]}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[850px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="p-3">Tanlash</th>
                    {(
                      [
                        ['Familiya, ism / kafedra', 'name', 'name_desc'],
                        ['Daqiqa / farq', 'minutes_desc', 'minutes_asc'],
                        ['Material', 'materials', 'materials_asc'],
                        ['Dars', 'lessons', 'lessons_asc'],
                        ['Faol kun', 'days', 'days_asc'],
                        ['Talaba', 'students', 'students_asc'],
                        ['Talaba natijasi', 'score', 'score_desc'],
                      ] as const
                    ).map(([label, first, second]) => (
                      <th
                        key={label}
                        aria-sort={
                          local.sort === first
                            ? first === 'name' || first === 'score'
                              ? 'ascending'
                              : 'descending'
                            : local.sort === second
                              ? first === 'name' || first === 'score'
                                ? 'descending'
                                : 'ascending'
                              : 'none'
                        }
                      >
                        <button
                          type="button"
                          className="whitespace-nowrap py-3 pr-3 font-semibold hover:text-teal-800"
                          onClick={() => update({ sort: local.sort === first ? second : first })}
                        >
                          {label}{' '}
                          {local.sort === first
                            ? first === 'name' || first === 'score'
                              ? '↑'
                              : '↓'
                            : local.sort === second
                              ? first === 'name' || first === 'score'
                                ? '↓'
                                : '↑'
                              : '↕'}
                        </button>
                      </th>
                    ))}
                    <th>Holat</th>
                    <th>Interaktiv doska</th>
                    <th>Belgilar</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr
                      key={r.owner_key}
                      className="border-t border-slate-100 align-top hover:bg-teal-50/30"
                    >
                      <td className="p-3">
                        <input
                          type="checkbox"
                          aria-label={`${r.display_name}ni tanlash`}
                          checked={selected.includes(r.owner_key)}
                          disabled={!selected.includes(r.owner_key) && selected.length >= 30}
                          onChange={() =>
                            setSelected((v) =>
                              v.includes(r.owner_key)
                                ? v.filter((x) => x !== r.owner_key)
                                : [...v, r.owner_key],
                            )
                          }
                        />
                      </td>
                      <td className="py-3 pr-3">
                        <button
                          className="max-w-80 text-left font-semibold text-slate-900 underline-offset-4 hover:text-teal-800 hover:underline"
                          onClick={() => setOpen(r)}
                        >
                          {r.display_name}
                        </button>
                        <p className="mt-1 max-w-72 text-xs text-slate-500">
                          {r.department || 'Kafedra belgilanmagan'}
                        </p>
                        <p className="mt-1 text-[10px] text-slate-400">{r.owner_key}</p>
                      </td>
                      <td className="py-3 pr-3 tabular-nums">
                        {r.minutes}
                        <p className="mt-1 text-[10px] text-slate-500">{diff(r.delta?.minutes)}</p>
                      </td>
                      <td className="py-3 pr-3 tabular-nums">{r.created_total}</td>
                      <td className="py-3 pr-3 tabular-nums">{r.lessons_total}</td>
                      <td className="py-3 pr-3 tabular-nums">{r.active_days}</td>
                      <td className="py-3 pr-3 tabular-nums">{r.students_taught}</td>
                      <td className="py-3 pr-3">
                        <span
                          className={
                            r.avg_student_score !== null && r.avg_student_score < 56
                              ? 'text-amber-800'
                              : 'text-slate-700'
                          }
                        >
                          {score(r)}
                        </span>
                        <p className="mt-1 text-[10px] text-slate-500">
                          {r.student_attempts} urinish{r.small_sample ? ' · namuna kichik' : ''}
                        </p>
                      </td>
                      <td className="py-3 pr-3">
                        <ReportStatus status={r.status} />
                      </td>
                      <td className="max-w-48 py-3 pr-3">
                        <InteractiveBoard board={r.board} />
                      </td>
                      <td className="max-w-48 py-3 pr-3">
                        <div className="flex flex-wrap gap-1">
                          {r.signals.map((s) => (
                            <span
                              key={s}
                              className={`rounded-md px-1.5 py-0.5 text-[10px] ${s === 'no_results' ? 'bg-slate-100 text-slate-500' : 'bg-amber-50 text-amber-900'}`}
                            >
                              {SIGNALS[s]}
                            </span>
                          ))}
                          {!r.signals.length && (
                            <span className="text-xs text-teal-700">Tanlangan belgilar yo‘q</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!rows.length && (
              <div className="p-10 text-center">
                <p className="font-semibold text-slate-700">
                  Bu shartlarga mos o‘qituvchi topilmadi
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  Familiyani qisqaroq yozing yoki biror filtrni olib tashlang.
                </p>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
              <span>
                {rows.length
                  ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, rows.length)} / ${rows.length}`
                  : '0 natija'}{' '}
                · PDF va CSVda barcha mos qatorlar
              </span>
              <div className="flex items-center gap-3">
                <select
                  aria-label="Sahifadagi qatorlar"
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="rounded-lg border border-slate-200 bg-white p-2"
                >
                  <option value={25}>25 qator</option>
                  <option value={50}>50 qator</option>
                  <option value={100}>100 qator</option>
                </select>
                <button
                  aria-label="Oldingi sahifa"
                  className={BUTTON}
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft size={15} />
                </button>
                {page} / {pages}
                <button
                  aria-label="Keyingi sahifa"
                  className={BUTTON}
                  disabled={page >= pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          </section>
          {selectedRows.length > 0 && (
            <section className="rounded-2xl border border-teal-200 bg-teal-50/40 p-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-teal-950">
                  Tanlanganlar · {selectedRows.length}
                </h2>
                <button className="text-xs text-teal-800" onClick={() => setSelected([])}>
                  Tanlovni tozalash
                </button>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {selectedRows.slice(0, 3).map((r) => (
                  <button
                    key={r.owner_key}
                    className="rounded-xl border border-teal-100 bg-white p-4 text-left"
                    onClick={() => setOpen(r)}
                  >
                    <b className="text-sm">{r.display_name}</b>
                    <p className="mt-2 text-xs text-slate-600">
                      {r.minutes} daqiqa · {r.created_total} material · {r.lessons_total} dars
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {score(r)} · {r.student_attempts} urinish
                    </p>
                  </button>
                ))}
              </div>
              {selectedRows.length > 3 && (
                <p className="mt-2 text-xs text-slate-500">
                  Taqqoslashda dastlabki 3 kishi, AI tahlilida tanlangan {selectedRows.length}{' '}
                  kishining barchasi.
                </p>
              )}
            </section>
          )}
          <section
            ref={analysisRef}
            className="scroll-mt-44 rounded-3xl border border-teal-900/15 bg-white p-5 sm:p-6"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="text-teal-700" size={20} />
              <h2 className="text-lg font-semibold text-slate-900">AI bilan dalilli tahlil</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {selected.length
                ? `Tanlangan ${selected.length} o‘qituvchi`
                : 'Filtrdagi e’tibor belgisi ko‘p bo‘lgan 30 tagacha o‘qituvchi'}{' '}
              tahlil qilinadi. Tavsiya yonida uning asosidagi raqamlar ko‘rsatiladi.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {[
                'Kimga qanday yordam kerak va qaysi ishlar ustuvor?',
                'Material yaratmaganlar bilan qanday ishlash kerak?',
                'Darslar va talabalar natijalari bo‘yicha amaliy reja tuzing.',
              ].map((q) => (
                <button
                  key={q}
                  className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-600 hover:bg-teal-50"
                  onClick={() => setQuestion(q)}
                >
                  {q}
                </button>
              ))}
            </div>
            <label className="mt-4 block text-xs font-medium text-slate-500">
              Rektorning savoli
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                maxLength={600}
                rows={2}
                className={`${INPUT} mt-1`}
              />
            </label>
            <button
              disabled={aiBusy || pending || !rows.length || !question.trim()}
              className={`${PRIMARY} mt-3`}
              onClick={() => void runAnalysis()}
            >
              {aiBusy ? <Loader2 size={17} className="animate-spin" /> : <Sparkles size={17} />}{' '}
              {aiBusy ? 'Dalillar tahlil qilinmoqda…' : 'AI tahlilini tayyorlash'}
            </button>
            {analysis && (
              <div className="mt-5 space-y-3">
                <div className="rounded-xl bg-teal-50 p-4">
                  <p className="text-xs font-medium text-teal-700">
                    AI tavsiyasi · {analysis.analyzed_count} / {analysis.matched_count} o‘qituvchi ·{' '}
                    {time(analysis.generated_at)}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-800">
                    {analysis.summary}
                  </p>
                </div>
                {analysis.priorities.map((p, i) => (
                  <div
                    key={`${p.owner_key}-${i}`}
                    className="rounded-xl border border-slate-200 p-4"
                  >
                    <button
                      className="text-left text-sm font-semibold text-teal-900 hover:underline"
                      onClick={() => setOpen(rows.find((r) => r.owner_key === p.owner_key) || null)}
                    >
                      {i + 1}. {p.display_name}
                    </button>
                    <p className="text-xs text-slate-400">{p.department}</p>
                    {p.equipment_reason && (
                      <p className="mt-2 text-xs text-slate-600">{p.equipment_reason}</p>
                    )}
                    <p className="mt-2 text-sm leading-6 text-slate-700">{p.action}</p>
                    <p className="mt-2 text-xs leading-5 text-teal-800">
                      <b>Tekshirish:</b> {p.verification}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {p.evidence.map((e) => (
                        <span
                          key={e.key}
                          className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600"
                        >
                          {e.label}: <b>{e.value ?? 'Ma’lumot yo‘q'}</b>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-4 text-xs leading-5 text-slate-400">
              Hisobot platformadagi yozuvlarga tayanadi. Faollik ishga kelish yoki kasbiy malaka
              bahosi emas. 5 tadan kam urinishda natija bo‘yicha qat’iy xulosa berilmaydi.
            </p>
          </section>
        </>
      )}
      {open && report && (
        <TeacherProfile
          key={open.owner_key}
          row={open}
          report={report}
          analysis={analysis}
          onClose={() => setOpen(null)}
          onAnalyze={(owner) => {
            setSelected([owner]);
            void runAnalysis([owner]);
          }}
        />
      )}
    </div>
  );
}
