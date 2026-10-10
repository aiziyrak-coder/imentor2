import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Clock, Loader2, MonitorCheck, Users } from 'lucide-react';
import {
  fetchMonitorDay,
  type MonitorDayLesson,
  type MonitorDayReport,
} from './monitorDayApi';

/**
 * Monitorli xonalar — BITTA KUN, har bir dars bo'yicha alohida javob.
 *
 * Rektor talabi (2026-10-09): "umumiy ma'lumotlar emas, individual yondashuv.
 * Har bir monitorli xonadagi har bir o'qituvchiga aniq tahlil: qaysi darsida
 * nima qilgan, qancha foydalangan, qaysi fandan qaysi mavzuni o'tishi kerak
 * edi va NEGA degan savolga javob."
 *
 * Shuning uchun bu sahifada umumiy qator yo'q: o'qituvchi ochilganda uning
 * HAR BIR darsi o'z qatori, o'z mavzusi va o'z sababi bilan chiqadi.
 */

const DECISION: Record<MonitorDayLesson['decision'], { label: string; cls: string }> = {
  full: { label: 'To‘liq o‘tilgan', cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  proved: { label: 'Tasdiqlangan', cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  short: { label: 'Yetarsiz', cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
  blamed: { label: 'Bahona yo‘q', cls: 'bg-rose-50 text-rose-800 ring-rose-200' },
  check_room: { label: 'Xonani tekshirish', cls: 'bg-slate-100 text-slate-700 ring-slate-200' },
  dead_room: { label: 'Doska ishlamaydi', cls: 'bg-slate-200 text-slate-700 ring-slate-300' },
  pending: { label: 'Dars tugamagan', cls: 'bg-sky-50 text-sky-800 ring-sky-200' },
  unlinked: { label: 'Hisobi yo‘q', cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
  on_leave: { label: 'Ta’tilda', cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
};

function Badge({ decision }: { decision: MonitorDayLesson['decision'] }) {
  const d = DECISION[decision];
  return (
    <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${d.cls}`}>
      {d.label}
    </span>
  );
}

function Stat({ label, value, tone = '' }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="min-w-[88px]">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`text-[19px] font-bold tabular-nums ${tone || 'text-slate-900'}`}>{value}</p>
    </div>
  );
}

/** Bitta dars: vaqt, mavzu, daqiqa va sabab. */
function LessonRow({ row }: { row: MonitorDayLesson }) {
  const [open, setOpen] = useState(false);
  const pages = row.pages.filter((p) => p.seconds > 0).sort((a, b) => b.seconds - a.seconds);
  return (
    <li className="px-3 py-2">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <span className="w-[86px] shrink-0 font-mono text-[12px] text-slate-500">{row.time}</span>
        <Badge decision={row.decision} />
        <span className="min-w-0 flex-1 text-[13px] text-slate-800">
          <b className="font-semibold">{row.subject || '—'}</b>
          {row.lesson_type ? <span className="text-slate-400"> · {row.lesson_type}</span> : null}
          {row.groups.length ? <span className="text-slate-400"> · {row.groups.join(', ')}</span> : null}
        </span>
        <span className="shrink-0 tabular-nums text-[12px] text-slate-600">
          {row.minutes} / {row.required_minutes} daq
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 text-slate-400 hover:text-slate-700"
          aria-label="Dalillarni ko‘rsatish"
        >
          <ChevronDown size={15} className={open ? 'rotate-180 transition' : 'transition'} />
        </button>
      </div>

      <p className="mt-1 pl-[86px] text-[12px] text-slate-600">{row.reason}</p>

      <p className="mt-0.5 pl-[86px] text-[12px]">
        <span className="text-slate-400">Mavzu: </span>
        {row.topic ? (
          <span className="text-slate-700">
            {row.index}/{row.total}. {row.topic}
          </span>
        ) : (
          <span className="text-amber-700">{row.note || 'sillabus topilmadi'}</span>
        )}
      </p>

      {open && (
        <div className="mt-2 ml-[86px] rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
          <p>
            <span className="text-slate-400">Xona: </span>
            {row.room || '—'}
            <span className="text-slate-400"> · HEMIS: </span>
            {row.hemis_room || '—'}
            <span className="text-slate-400"> · {row.building || '—'}</span>
            {row.monitor_id ? <span className="text-slate-400"> · {row.monitor_id}</span> : null}
          </p>
          {row.syllabus ? (
            <p className="mt-1">
              <span className="text-slate-400">Sillabus: </span>
              {row.syllabus}
            </p>
          ) : null}
          <p className="mt-1">
            <span className="text-slate-400">Qaydlar: </span>
            {row.event_count} hodisa
            {row.first_event ? ` · birinchi ${row.first_event.slice(11, 16)}` : ''}
            {row.last_event ? ` · oxirgi ${row.last_event.slice(11, 16)}` : ''}
            {row.students ? ` · ${row.students} talaba test topshirgan` : ''}
          </p>
          {pages.length ? (
            <p className="mt-1">
              <span className="text-slate-400">Bo‘limlar: </span>
              {pages.map((p) => `${p.page} ${Math.round(p.seconds / 60)} daq`).join(' · ')}
            </p>
          ) : (
            <p className="mt-1 text-slate-400">Dars vaqtida bo‘lim ochilmagan.</p>
          )}
        </div>
      )}
    </li>
  );
}

function TeacherCard({ teacher }: { teacher: MonitorDayReport['teachers'][number] }) {
  const [open, setOpen] = useState(false);
  const tone = teacher.full === teacher.lessons.length
    ? 'text-emerald-700'
    : teacher.full === 0 ? 'text-rose-700' : 'text-amber-700';
  return (
    <section className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-900/[0.07]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold text-slate-900">
            {teacher.teacher_name || '—'}
          </span>
          <span className="block truncate text-[11.5px] text-slate-500">
            {teacher.department}
            {teacher.faculty ? ` · ${teacher.faculty}` : ''}
          </span>
        </span>
        <span className={`shrink-0 tabular-nums text-[12.5px] font-semibold ${tone}`}>
          {teacher.full}/{teacher.lessons.length} dars
        </span>
        <span className="shrink-0 tabular-nums text-[12px] text-slate-500">{teacher.minutes} daq</span>
        <ChevronDown size={15} className={`shrink-0 text-slate-400 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {teacher.lessons.map((row) => (
            <LessonRow key={row.lesson_id} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}

export default function MonitorDay({
  day,
  onUnauthorized,
}: {
  day: string;
  onUnauthorized: () => void;
}) {
  const [data, setData] = useState<MonitorDayReport | null>(null);
  const [error, setError] = useState('');
  const [faculty, setFaculty] = useState('');
  const [department, setDepartment] = useState('');
  const [monitor, setMonitor] = useState('');
  const [onlyProblem, setOnlyProblem] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError('');
    fetchMonitorDay({ day, faculty, department, monitor })
      .then((d) => alive && setData(d))
      .catch((e) => {
        if (/401|403/.test(String(e))) onUnauthorized();
        else if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [day, faculty, department, monitor, onUnauthorized]);

  const teachers = useMemo(() => {
    if (!data) return [];
    return onlyProblem ? data.teachers.filter((t) => t.full < t.lessons.length) : data.teachers;
  }, [data, onlyProblem]);

  if (error) {
    return (
      <p className="rounded-xl bg-rose-50 px-4 py-3 text-[13px] text-rose-800 ring-1 ring-rose-200">
        {error}
      </p>
    );
  }
  if (!data) {
    return (
      <p className="flex items-center gap-2 px-1 py-6 text-[13px] text-slate-500">
        <Loader2 size={15} className="animate-spin" /> Kun bo‘yicha hisoblanmoqda…
      </p>
    );
  }

  const h = data.headline;
  const quiet = data.rooms.filter((r) => r.state === 'quiet');

  return (
    <div className="space-y-3">
      {/* --- Kun bo'yicha asosiy raqamlar */}
      <section className="rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-900/[0.07]">
        <h2 className="flex items-center gap-2 text-[13.5px] font-bold text-slate-800">
          <MonitorCheck size={15} className="text-slate-400" />
          {data.day} — monitorli xonalardagi darslar
          <span className="ml-auto text-[11.5px] font-normal text-slate-400">
            soat {data.now} holatiga
          </span>
        </h2>
        <div className="mt-2.5 flex flex-wrap gap-x-6 gap-y-2">
          <Stat label="Baholangan dars" value={h.lessons} />
          <Stat label="To‘liq o‘tilgan" value={`${h.full}${h.percent === null ? '' : ` · ${h.percent}%`}`} tone="text-emerald-700" />
          <Stat label="Yetarsiz" value={h.short} tone="text-amber-700" />
          <Stat label="Bahona yo‘q" value={h.blamed} tone="text-rose-700" />
          <Stat label="Xonani tekshirish" value={h.check_room} />
          <Stat label="O‘qituvchi" value={h.teachers} />
          <Stat label="Xona" value={`${h.rooms - h.quiet_rooms}/${h.rooms}`} />
        </div>
        <p className="mt-2 text-[12px] text-slate-500">
          Dars “o‘tilgan” deb kamida <b className="text-slate-700">{data.required_minutes} daqiqa</b>{' '}
          ishlangan bo‘lsa sanaladi. Tugamagan dars ({h.pending}), hisobi bog‘lanmagan ({h.unlinked}) va
          ta’tildagi ({h.on_leave}) va doskasi ishlamaydigan xonadagi ({h.dead_room}) darslar
          maxrajga kirmaydi. Sillabusi topilmagan dars: {h.no_syllabus}.
        </p>
      </section>

      {/* --- Filtrlar */}
      <section className="flex flex-wrap items-center gap-2 rounded-2xl bg-white px-3 py-2.5 ring-1 ring-slate-900/[0.07]">
        <select
          value={faculty}
          onChange={(e) => setFaculty(e.target.value)}
          className="rounded-lg bg-slate-100 px-2 py-1.5 text-[12.5px] text-slate-700"
        >
          <option value="">Barcha fakultetlar</option>
          {data.filters.faculties.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <select
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          className="max-w-[260px] rounded-lg bg-slate-100 px-2 py-1.5 text-[12.5px] text-slate-700"
        >
          <option value="">Barcha kafedralar</option>
          {data.filters.departments.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <select
          value={monitor}
          onChange={(e) => setMonitor(e.target.value)}
          className="max-w-[300px] rounded-lg bg-slate-100 px-2 py-1.5 text-[12.5px] text-slate-700"
        >
          <option value="">Barcha monitorlar</option>
          {data.filters.monitors.map((m) => (
            <option key={m.monitor_id} value={m.monitor_id}>
              {m.monitor_id} — {m.room}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[12.5px] text-slate-600">
          <input
            type="checkbox"
            checked={onlyProblem}
            onChange={(e) => setOnlyProblem(e.target.checked)}
            className="rounded"
          />
          faqat muammoli
        </label>
      </section>

      {/* --- Foizdan CHIQARILGAN xonalar. Istisno ko'rinadigan bo'lishi shart:
             aks holda u sekin-asta foizni chiroyli ko'rsatadigan yashirin
             chiqarib tashlashga aylanadi (2026-10-09). */}
      {data.broken_rooms.length > 0 && (
        <section className="rounded-2xl bg-rose-50/70 px-4 py-3 ring-1 ring-rose-200">
          <h3 className="flex items-center gap-2 text-[13px] font-bold text-rose-900">
            <AlertTriangle size={15} /> Doska tekshirilishi kerak ({data.broken_rooms.length}) —
            bu xonalardagi {h.dead_room} dars foizga qo‘shilmadi
          </h3>
          <p className="mt-1 text-[12px] text-rose-900/80">
            Shu xonalarda bir necha o‘qituvchi bir necha darsda bir marta ham iMentor ochmagan.
            Texnik xizmat tekshirib, ishlatilgandan keyin xona bu ro‘yxatdan o‘zi chiqadi.
          </p>
          <ul className="mt-2 space-y-1">
            {data.broken_rooms.map((r) => (
              <li key={r.monitor_id} className="text-[12.5px] text-rose-950">
                <span className="font-mono text-[11.5px] text-rose-700">{r.monitor_id}</span>{' '}
                {r.room || '—'}
                <span className="text-rose-700">
                  {' '}· {r.days} kunda {r.lessons} dars, {r.teachers} o‘qituvchi, nol foydalanish
                </span>
                {r.today ? <span className="text-rose-700/80"> · bugun {r.today} dars</span> : null}
                {r.department ? (
                  <span className="text-rose-700/70"> · {r.department}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --- Xonasi jim qolgan: ayblashdan oldin tekshirish kerak */}
      {quiet.length > 0 && (
        <section className="rounded-2xl bg-amber-50/70 px-4 py-3 ring-1 ring-amber-200">
          <h3 className="flex items-center gap-2 text-[13px] font-bold text-amber-900">
            <AlertTriangle size={15} /> Kun bo‘yi hech kim ochmagan xonalar ({quiet.length})
          </h3>
          <p className="mt-1 text-[12px] text-amber-900/80">
            Bu xonalardagi darslar bo‘yicha o‘qituvchini ayblashdan oldin monitorning o‘zi
            tekshirilishi kerak.
          </p>
          <ul className="mt-2 space-y-1">
            {quiet.map((r) => (
              <li key={r.monitor_id} className="text-[12.5px] text-amber-950">
                <span className="font-mono text-[11.5px] text-amber-700">{r.monitor_id}</span>{' '}
                {r.room || '—'}
                <span className="text-amber-700"> · {r.lessons} dars</span>
                {r.department ? <span className="text-amber-700/70"> · {r.department}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --- O'qituvchilar: har biri ochilganda HAR BIR darsi alohida */}
      <h3 className="flex items-center gap-2 px-1 text-[13px] font-bold text-slate-800">
        <Users size={15} className="text-slate-400" />
        O‘qituvchilar ({teachers.length})
        <span className="font-normal text-slate-400">— ismga bosing, har bir darsi ochiladi</span>
      </h3>
      {teachers.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-[13px] text-slate-500 ring-1 ring-slate-900/[0.07]">
          <CheckCircle2 size={15} className="text-emerald-600" /> Bu filtr bo‘yicha dars topilmadi.
        </p>
      ) : (
        <div className="space-y-2">
          {teachers.map((t) => (
            <TeacherCard key={t.teacher_key || t.teacher_name} teacher={t} />
          ))}
        </div>
      )}

      <p className="flex items-center gap-1.5 px-1 pb-2 text-[11.5px] text-slate-400">
        <Clock size={13} /> Manba: HEMIS dars jadvali, interaktiv doska inventari, iMentor
        faollik qaydlari va o‘qituvchi biriktirgan sillabus tematikasi.
      </p>
    </div>
  );
}
