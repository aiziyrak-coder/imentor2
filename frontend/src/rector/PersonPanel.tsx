import { Fragment, useEffect, useState } from 'react';
import { Check, Laptop, Minus, Monitor, X } from 'lucide-react';
import {
  fetchControlStudent,
  fetchControlTeacher,
  type ReportFilters,
  type ScheduledLessonRow,
  type ControlStudentDetail,
  type ControlTeacherDetail,
} from './rectorApi';
import { Spinner } from './RectorUi';
import { minutesText, RoomTable } from './ControlReport';

/**
 * Ism bosilganda o'ngdan chiqadigan batafsil oyna (2026-09-25).
 * O'qituvchi uchun — har bir darsi va materiallari; talaba uchun — har bir testi.
 */

export type Person = { kind: 'teacher' | 'student'; key: string; name: string };

/** Profil bandlari — server kalitlari uchun nom. */
const PROFILE_LABEL: Record<string, string> = {
  photo: 'Surat',
  department: 'Kafedra',
  job_title: 'Lavozim',
  subject: 'Fan biriktirilgan',
  face: 'Yuz ro‘yxatda',
};

const DEPTH_TONE: Record<string, string> = {
  worked: 'bg-emerald-100 text-emerald-800',
  viewed: 'bg-amber-100 text-amber-800',
  visit: 'bg-orange-100 text-orange-800',
  none: 'bg-rose-100 text-rose-800',
};

function day(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit' });
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[12.5px] text-slate-500">{label}</span>
      <span className="text-right text-[13px] font-medium text-slate-800">{value}</span>
    </div>
  );
}

function Lesson({ l }: { l: ScheduledLessonRow }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rounded-lg ${l.hemis_status === 'missing_from_hemis' ? 'bg-amber-50' : l.monitor_id ? (l.used ? 'bg-emerald-50' : 'bg-rose-50') : 'bg-slate-50'}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 px-2.5 py-1.5 text-left text-[12px]"
        title="HEMIS yozuvini ochish"
      >
        <span className="w-[74px] shrink-0 font-medium text-slate-700">
          {day(l.date)} <span className="text-slate-400">{l.weekday.slice(0, 3)}</span>
        </span>
        <span className="w-[54px] shrink-0 text-slate-500">{l.para}</span>
        <span className="min-w-0 flex-1 truncate text-slate-800" title={l.subject}>
          {l.subject || '—'}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-slate-500">
          {l.monitor_id ? <Monitor size={11} className="text-sky-600" /> : <Laptop size={11} className="text-slate-400" />}
          {l.room || '—'}
        </span>
        <span className="w-[76px] shrink-0 text-right font-medium">
          {l.used ? (
            <span className="text-emerald-700">qayd bor</span>
          ) : l.monitor_id ? (
            <span className="text-rose-700">qayd yo‘q</span>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </span>
      </button>
      {open && (
        // Dalil: «menda bunday dars yo'q edi» deyilsa, HEMIS yozuvining o'zi shu yerda.
        <dl className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-0.5 border-t border-white/70 px-2.5 py-1.5 text-[11.5px]">
          {([
            ['HEMIS dars ID', l.hemis_id || '—'],
            ['Vaqti', `${l.start_time || '?'}–${l.end_time || '?'}`],
            ['Guruh', l.group || '—'],
            ['Dars turi', l.lesson_type || '—'],
            ['Kafedra', l.department || '—'],
            ['Xona', `${l.room || '—'}${l.building ? ` · ${l.building}` : ''}${l.auditorium_code ? ` (kod ${l.auditorium_code})` : ''}`],
            [
              'Monitor',
              l.monitor_id
                ? `${l.monitor_id} · ${l.monitor_room || '—'}${l.monitor_department ? ` · ${l.monitor_department}` : ''}`
                : 'inventarda monitor biriktirilmagan; xona holati tasdiqlanmagan',
            ],
          ] as Array<[string, string]>).map(([k, v]) => (
            <Fragment key={k}>
              <dt className="text-slate-500">{k}</dt>
              <dd className="text-slate-800">{v}</dd>
            </Fragment>
          ))}
          {l.evidence && <>
            {l.hemis_status === 'missing_from_hemis' && <><dt>HEMIS holati</dt><dd>Keyingi sinxronlashda topilmadi; yozuv saqlandi, bekor qilinganligi tasdiqlanmagan.</dd></>}
            <dt>Faollik dalili</dt><dd>{l.evidence.note}</dd>
            <dt>Qurilma bildirgan vaqt</dt><dd>{(l.evidence.seconds / 60).toFixed(1)} daqiqa</dd>
            <dt>Takroriy vaqt</dt><dd>{((l.evidence.overlap_seconds || 0) / 60).toFixed(1)} daqiqa — umumiy vaqtga qayta qo‘shilmagan</dd>
            <dt>HEMIS yangilanishi</dt><dd>{l.synced_at ? new Date(l.synced_at).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' }) : 'Sinxronlash vaqti qayd etilmagan'}</dd>
            <dt>Dars o‘tilganligi</dt><dd>Platforma faolligi dars o‘tilganligini mustaqil tasdiqlamaydi</dd>
            {l.evidence.pages.map(p => <Fragment key={p.page}>
              <dt>{p.page}</dt><dd>{(p.seconds / 60).toFixed(1)} daqiqa · {p.opens} ochilish</dd>
            </Fragment>)}
            <dt>Harakatlar</dt><dd>
              {l.evidence.events.map(e => <div key={e.id}>
                {new Date(e.at).toLocaleTimeString('uz-UZ', { timeZone: 'Asia/Tashkent' })}
                {' · '}{e.action}{' · '}{e.page}{' · qayd №'}{e.id}
              </div>)}
            </dd>
          </>}
        </dl>
      )}
    </div>
  );
}

function TeacherBody({ data }: { data: ControlTeacherDetail }) {
  const [lessonFilter, setLessonFilter] = useState('all');
  const evidenceCounts = data.lessons.reduce<Record<string, number>>((counts, lesson) => {
    const status = lesson.evidence?.status || 'unverified';
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  const visibleLessons = data.lessons.filter(l => lessonFilter === 'all' || (l.evidence?.status || 'unverified') === lessonFilter);
  const s = data.summary;
  const m = data.materials;
  const e = data.engagement;
  const pc = data.profile_check;
  const sm = data.subject_materials;
  const topMinutes = Math.max(1, ...e.modules.map((x) => x.minutes));
  return (
    <div className="space-y-4">
      <section className="rounded-xl bg-slate-50 p-3">
        <Row label="Kafedra" value={data.profile.department || '—'} />
        {data.profile.job_title && <Row label="Lavozim" value={data.profile.job_title} />}
        {/* Davr ichidagi faollik BIRINCHI: rektor kechani ochsa, kechagi holatni ko'rsin.
            Umumiy oxirgi kirish esa alohida, "davrdan tashqari" deb belgilanadi. */}
        <Row
          label="Bu davrdagi oxirgi faollik"
          value={data.profile.last_active ? day(data.profile.last_active) : 'Bu davrda faollik sanasi aniqlanmagan'}
        />
        <Row label="Oxirgi kirish (umuman)" value={day(data.profile.last_login)} />
        <Row
          label="Bu davrda"
          value={
            <span className="inline-flex items-center gap-2">
              <span>
                {minutesText(e.minutes)} · {e.active_days} kun
              </span>
              <span className={`rounded px-1.5 py-px text-[11px] font-medium ${DEPTH_TONE[e.depth] || DEPTH_TONE.none}`}>
                {e.depth_label}
              </span>
            </span>
          }
        />
      </section>

      {/* Qaysi bo'limda qancha vaqt — «shunchaki kirib qo'ydimi» degan savolga javob. */}
      <section>
        <h3 className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-slate-500">Bo‘limlar bo‘yicha vaqt</h3>
        {e.modules.length === 0 ? (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
            Bu davrda bo‘limlardan foydalanish qaydi topilmadi.
          </p>
        ) : (
          <div className="space-y-1">
            {e.modules.map((x) => (
              <div key={x.page} className="flex items-center gap-2 text-[12px]">
                <span className="w-[120px] shrink-0 truncate text-slate-700" title={x.label}>
                  {x.label}
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <span
                    className="block h-full rounded-full bg-sky-500"
                    style={{ width: `${Math.max(3, (x.minutes / topMinutes) * 100)}%` }}
                  />
                </span>
                <span className="w-[68px] shrink-0 text-right font-semibold tabular-nums text-slate-700">
                  {minutesText(x.minutes)}
                </span>
                <span className="w-[52px] shrink-0 text-right tabular-nums text-slate-400">{x.opens} marta</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Nima YARATGAN — kirgani emas, ishi. */}
      <section>
        <h3 className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-slate-500">
          Shu davrda yaratgani ({e.created_total})
        </h3>
        <div className="grid grid-cols-4 gap-1.5">
          {Object.entries(e.created_labels).map(([key, label]) => {
            const n = e.created[key] ?? 0;
            return (
              <div key={key} className={`rounded-lg p-2 text-center ${n ? 'bg-emerald-50' : 'bg-slate-50'}`}>
                <p className={`text-[16px] font-bold tabular-nums ${n ? 'text-emerald-800' : 'text-slate-400'}`}>{n}</p>
                <p className="text-[10.5px] text-slate-500">{label}</p>
              </div>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11.5px] text-slate-400">
          Ko‘rgani: {e.viewed.videos} video · {e.viewed.handouts} tarqatma
        </p>
      </section>

      {/* Profil to'liqmi */}
      <section>
        <h3 className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-slate-500">
          Profil to‘liqligi — {pc.percent}%
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(pc.have).map(([key, ok]) => (
            <span
              key={key}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11.5px] ${
                ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
              }`}
            >
              {ok ? <Check size={11} /> : <Minus size={11} />}
              {PROFILE_LABEL[key] || key}
            </span>
          ))}
        </div>
      </section>

      {/* Biriktirgan fanlarining mavzulari to'ldirilganmi */}
      <section>
        <h3 className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-slate-500">Fanlari va material qamrovi</h3>
        {sm.rows.length === 0 ? (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
            Hech qanday fan biriktirmagan — material yuklashi ham, mavzu bo‘yicha ishlashi ham mumkin emas.
          </p>
        ) : (
          <>
            <div className="mb-1.5 rounded-xl bg-slate-50 p-3">
              <Row label="Jami mavzu" value={sm.topics} />
              <Row label="Materialsiz mavzu" value={<span className={sm.empty ? 'text-rose-700' : ''}>{sm.empty}</span>} />
              <Row label="Tarqatma / Taqdimot / Video" value={`${sm.handout} / ${sm.presentation} / ${sm.video}`} />
            </div>
            <div className="space-y-1">
              {sm.rows.map((x) => (
                <div
                  key={`${x.syllabus_id}-${x.variant}`}
                  className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12px]"
                >
                  <span className="min-w-0 flex-1 truncate text-slate-700" title={x.subject}>
                    {x.subject}
                    {x.variant && <span className="text-slate-400"> · {x.variant}</span>}
                  </span>
                  <span className="shrink-0 text-slate-500">
                    {x.topics - x.empty}/{x.topics} mavzu
                  </span>
                  <span
                    className={`w-10 shrink-0 text-right font-semibold ${
                      x.percent >= 70 ? 'text-emerald-700' : x.percent >= 40 ? 'text-amber-700' : 'text-rose-700'
                    }`}
                  >
                    {x.percent}%
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {s && (
        <section className="grid grid-cols-2 gap-2">
          {[
            ['Monitorli darslar', `${s.monitor_used}/${s.monitor_lessons}`, s.monitor_percent === null ? '—' : `${s.monitor_percent}%`],
            ['Monitorsiz darslar', `${s.other_used}/${s.other_lessons}`, 'majburiy emas'],
            ['Dars kuni', String(s.days), `${s.lessons} dars`],
            ['Jonli testda talaba', String(s.students), 'jami'],
          ].map(([label, value, hint]) => (
            <div key={label} className="rounded-xl bg-white p-2.5 ring-1 ring-slate-900/[0.06]">
              <p className="text-[11px] text-slate-500">{label}</p>
              <p className="text-[17px] font-bold tabular-nums text-slate-900">{value}</p>
              <p className="text-[10.5px] text-slate-400">{hint}</p>
            </div>
          ))}
        </section>
      )}

      <section>
        <h3 className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-slate-500">Yaratgan materiallari</h3>
        <div className="rounded-xl bg-slate-50 p-3">
          <Row label="Tarqatma" value={m.handouts} />
          <Row label="Taqdimot" value={m.presentations} />
          <Row label="Video" value={m.videos} />
          <Row label="Jonli test sessiyasi" value={m.live_sessions} />
          <Row label="Test topshirgan talaba" value={`${m.students_taught} (${m.student_attempts} urinish)`} />
        </div>
      </section>

      {data.subjects.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-slate-500">Fanlar bo‘yicha</h3>
          <div className="space-y-1">
            {data.subjects.slice(0, 8).map((x) => (
              <div key={x.subject} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12px]">
                <span className="min-w-0 flex-1 truncate text-slate-700" title={x.subject}>
                  {x.subject}
                </span>
                <span className="shrink-0 text-slate-500">{x.lessons} dars</span>
                <span className="w-12 shrink-0 text-right font-semibold text-slate-700">
                  {x.monitor ? `${x.percent}%` : '—'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.rooms.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-slate-500">
            Dars o‘tadigan monitor xonalari
          </h3>
          <RoomTable rows={data.rooms} compact />
        </section>
      )}

      <section>
        <h3 className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-slate-500">
          Darslari ({data.lessons.length}) <span className="font-normal normal-case text-slate-400">— qatorni bosing, HEMIS yozuvi ochiladi</span>
        </h3>
        <p className="mb-2 text-[12px] text-slate-600">Quyidagi holatlar HEMIS va platforma qaydlarini bildiradi. Ular intizomiy ayb yoki dars o‘tilmaganligi haqida avtomatik hukm emas.</p>
        <div className="mb-2 flex flex-wrap gap-1">
          {Object.entries({ all: 'Barcha darslar', recorded: 'Faollik qaydi bor', no_record: 'Qayd topilmadi', pending: 'Hali tugamagan', missing_schedule_time: 'HEMIS vaqti yetishmaydi', unlinked_teacher: 'Hisob bog‘lanmagan', unverified: 'Dalil olinmagan' }).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setLessonFilter(key)} className={`rounded-lg px-2 py-1 text-[11px] ${lessonFilter === key ? 'bg-sky-100 text-sky-900' : 'bg-slate-100 text-slate-600'}`}>
              {label} · {key === 'all' ? data.lessons.length : evidenceCounts[key] || 0}
            </button>
          ))}
        </div>
        <div className="space-y-1">
          {visibleLessons.map((l) => (
            <Lesson key={l.id} l={l} />
          ))}
          {!visibleLessons.length && <p className="text-[12px] text-slate-500">Bu holatga mos dars yo‘q.</p>}
        </div>
      </section>
    </div>
  );
}

function StudentBody({ data }: { data: ControlStudentDetail }) {
  const c = data.contingent;
  const attempts = (data.attempts as Array<Record<string, unknown>>) || [];
  const totals = (data.totals as Record<string, number>) || {};
  return (
    <div className="space-y-4">
      {c ? (
        <section className="rounded-xl bg-slate-50 p-3">
          <Row label="Guruh" value={c.group_name || '—'} />
          <Row label="Kurs" value={c.course ?? '—'} />
          <Row label="Fakultet" value={c.faculty || '—'} />
          <Row label="Yo‘nalish" value={c.direction || '—'} />
          <Row label="Ta’lim shakli" value={`${c.education_form || '—'}${c.education_language ? ` · ${c.education_language}` : ''}`} />
          <Row label="Talaba ID" value={c.student_id} />
        </section>
      ) : (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
          Bu talaba HEMIS kontingentida topilmadi — test ID’siz (QR orqali) topshirilgan bo‘lishi mumkin.
        </p>
      )}

      <section className="grid grid-cols-3 gap-2">
        {[
          ['Urinish', totals.attempts ?? attempts.length],
          ['O‘rtacha ball', totals.avg_score != null ? `${totals.avg_score}%` : '—'],
          ['Fanlar', totals.subjects ?? '—'],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl bg-white p-2.5 ring-1 ring-slate-900/[0.06]">
            <p className="text-[11px] text-slate-500">{label}</p>
            <p className="text-[17px] font-bold tabular-nums text-slate-900">{String(value)}</p>
          </div>
        ))}
      </section>

      <section>
        <h3 className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-slate-500">
          Testlari ({attempts.length})
        </h3>
        {attempts.length === 0 ? (
          <p className="text-[12.5px] text-slate-400">Bu davrda test topshirmagan.</p>
        ) : (
          <div className="space-y-1">
            {attempts.slice(0, 40).map((a, i) => {
              const score = Number(a.score ?? 0);
              const total = Number(a.total ?? 0);
              const pct = total ? Math.round((100 * score) / total) : 0;
              return (
                <div key={String(a.id ?? i)} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12px]">
                  <span className="w-[62px] shrink-0 text-slate-500">{day(String(a.submitted_date ?? a.date ?? ''))}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-700" title={String(a.topic ?? '')}>
                    {String(a.topic ?? a.subject_code ?? '—')}
                  </span>
                  <span
                    className={`w-14 shrink-0 text-right font-semibold ${
                      pct >= 60 ? 'text-emerald-700' : pct >= 40 ? 'text-amber-700' : 'text-rose-700'
                    }`}
                  >
                    {score}/{total}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export default function PersonPanel({
  person,
  filters,
  onClose,
}: {
  person: Person;
  filters: ReportFilters;
  onClose: () => void;
}) {
  const [data, setData] = useState<ControlTeacherDetail | ControlStudentDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setData(null);
    setError('');
    const load = person.kind === 'teacher'
      ? fetchControlTeacher(person.key, filters)
      : fetchControlStudent(person.key, filters);
    load
      .then((d) => alive && setData(d as ControlTeacherDetail | ControlStudentDetail))
      .catch(() => alive && setError('Ma’lumotni yuklab bo‘lmadi.'));
    return () => {
      alive = false;
    };
  }, [person.kind, person.key, filters.from, filters.to]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-slate-900/30" onClick={onClose} aria-label="Yopish" />
      <aside className="relative flex h-full w-full max-w-[560px] flex-col bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {person.kind === 'teacher' ? 'O‘qituvchi' : 'Talaba'}
            </p>
            <h2 className="truncate text-[16px] font-bold text-slate-900">{person.name}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Yopish"
          >
            <X size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {error ? (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>
          ) : !data ? (
            <Spinner />
          ) : person.kind === 'teacher' ? (
            <TeacherBody data={data as ControlTeacherDetail} />
          ) : (
            <StudentBody data={data as ControlStudentDetail} />
          )}
        </div>
      </aside>
    </div>
  );
}
