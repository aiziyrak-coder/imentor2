import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { MonitorReport, MonitorRow, MonitorSlot, MonitorTeacherRow } from './rectorApi';
import { SortableTable, StatusChip, StatusDot, StatusLegend, statusOf, type Status } from './RectorUi';
import { shiftDays } from './rectorDates';
import TeacherName, { TeacherNames } from './TeacherName';

/**
 * Monitor hisobotidagi kartalar ortidagi ro'yxatlar.
 *
 * Har kartaning raqami shu yerda "kim, qayerda, qachon" bo'lib ochiladi:
 * odamlar familiya bo'yicha, har qator svetofor rangida.
 */

export type MonitorDrillKind = 'monitors' | 'teachers' | 'planned' | 'used' | 'free' | 'usage';

const TITLE: Record<MonitorDrillKind, string> = {
  monitors: 'Monitorlar',
  teachers: 'Jadvaldagi o‘qituvchilar',
  planned: 'Rejalashtirilgan slotlar',
  used: 'Ishlatilgan slotlar',
  free: 'Bo‘sh imkoniyat — monitorlar bo‘yicha',
  usage: 'Foydalanish — o‘qituvchilar bo‘yicha',
};

/** Slot holati: ishlatilgan — yashil, vaqti o'tib ishlatilmagan — qizil, hali kelmagan — kulrang. */
export function slotStatus(s: MonitorSlot, today: string): { status: Status; text: string } {
  if (s.used) return { status: 'good', text: 'Ishlatilgan' };
  // `today` "YYYY-MM-DD" yoki "YYYY-MM-DD HH:MM" — bugungi hali tugamagan para "ishlatilmadi" emas.
  const now = today.length > 10 ? today : `${today} ${new Date().toTimeString().slice(0, 5)}`;
  if (`${s.date} ${s.end_time}` > now) return { status: 'none', text: 'Kutilmoqda' };
  return { status: 'bad', text: 'Ishlatilmagan' };
}

/** O'qituvchi foydalanishi: 70%+ yashil, 40–69% sariq, undan past qizil; hisobi yo'q — kulrang. */
export function teacherUsageStatus(t: MonitorTeacherRow): Status {
  if (t.linked === false) return 'none';
  return statusOf(t.usage_percent ?? (t.planned_slots ? 0 : null));
}

export function keyByName(report: MonitorReport): Map<string, string> {
  return new Map(report.teachers.filter((t) => t.teacher_key).map((t) => [t.teacher_name, t.teacher_key]));
}

function pct(v: number | null | undefined): string {
  return v == null ? '—' : `${v}%`;
}

function TeacherTable({ rows, slots }: { rows: MonitorTeacherRow[]; slots: MonitorSlot[] }) {
  return (
    <SortableTable
      rows={rows}
      rowKey={(t) => t.teacher_key || t.teacher_name}
      initialSort={{ key: 'name', dir: 'asc' }}
      cardSubtitle="usage"
      columns={[
        {
          key: 'name',
          label: 'F.I.Sh.',
          value: (t) => t.teacher_name,
          render: (t) => (
            <span className="flex items-center gap-1.5">
              <StatusDot status={teacherUsageStatus(t)} />
              <span>
                <TeacherName
                  teacherKey={t.teacher_key}
                  name={t.teacher_name}
                  slots={slots.filter((s) => s.planned && s.teacher_name.split(' / ').includes(t.teacher_name))}
                  className="block font-medium text-slate-900"
                />
                <span className={`block text-[11px] ${t.linked === false ? 'text-amber-600' : 'text-slate-400'}`}>
                  {t.linked === false ? 'iMentor hisobi topilmadi' : t.department}
                </span>
              </span>
            </span>
          ),
        },
        {
          key: 'usage',
          label: 'Foydalanish',
          align: 'right',
          value: (t) => t.usage_percent,
          render: (t) => <StatusChip status={teacherUsageStatus(t)}>{pct(t.usage_percent)}</StatusChip>,
        },
        { key: 'planned', label: 'Reja', align: 'right', value: (t) => t.planned_slots },
        { key: 'used', label: 'Ishlatildi', align: 'right', value: (t) => t.used_slots },
        {
          key: 'missed',
          label: 'Ishlatilmadi',
          align: 'right',
          value: (t) => t.planned_slots - t.used_slots,
          render: (t) => {
            const n = t.planned_slots - t.used_slots;
            return n ? <StatusChip status="bad">{n}</StatusChip> : <span className="text-slate-300">0</span>;
          },
        },
        { key: 'students', label: 'Talaba', align: 'right', value: (t) => t.students },
      ]}
    />
  );
}

function SlotTable({ rows, today, keyByName, allSlots }: { rows: MonitorSlot[]; today: string; keyByName: Map<string, string>; allSlots: MonitorSlot[] }) {
  return (
    <SortableTable
      rows={rows}
      rowKey={(s) => `${s.monitor_id}-${s.date}-${s.para}-${s.teacher_key || s.teacher_name}`}
      initialSort={{ key: 'teacher', dir: 'asc' }}
      cardPrimary="teacher"
      cardSubtitle="status"
      columns={[
        {
          key: 'teacher',
          label: 'O‘qituvchi',
          value: (s) => `${s.teacher_name} ${s.date} ${s.start_time}`,
          render: (s) => (
            <span className="flex items-center gap-1.5">
              <StatusDot status={slotStatus(s, today).status} />
              <TeacherNames names={s.teacher_name} keyByName={keyByName} slots={allSlots} className="font-medium text-slate-900" />
            </span>
          ),
        },
        {
          key: 'status',
          label: 'Holat',
          value: (s) => slotStatus(s, today).text,
          render: (s) => {
            const st = slotStatus(s, today);
            return <StatusChip status={st.status}>{st.text}</StatusChip>;
          },
        },
        {
          key: 'date',
          label: 'Sana',
          value: (s) => `${s.date} ${s.start_time}`,
          render: (s) => (
            <span className="whitespace-nowrap">
              {s.date} <span className="text-slate-400">{s.weekday}</span>
            </span>
          ),
        },
        {
          key: 'para',
          label: 'Para',
          value: (s) => s.start_time,
          render: (s) => (
            <span className="whitespace-nowrap">
              {s.para} <span className="text-slate-400">{s.start_time}–{s.end_time}</span>
            </span>
          ),
        },
        {
          key: 'monitor',
          label: 'Monitor / xona',
          value: (s) => s.monitor_id,
          render: (s) => (
            <span>
              <span className="block font-semibold text-slate-900">{s.monitor_id}</span>
              <span className="block text-[11px] text-slate-400">{s.room_full}</span>
            </span>
          ),
        },
        {
          key: 'subject',
          label: 'Fan / guruh',
          value: (s) => s.subject,
          render: (s) => (
            <span>
              <span className="block">{s.subject || '—'}</span>
              <span className="block text-[11px] text-slate-400">{s.group}</span>
            </span>
          ),
        },
        {
          key: 'source',
          label: 'Manba',
          value: (s) => s.source || '',
          render: (s) =>
            s.source === 'hemis' ? (
              <span
                className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700"
                title="HEMIS'dan olingan — jadval o‘zgarsa o‘zi yangilanadi"
              >
                HEMIS
              </span>
            ) : s.source === 'excel' ? (
              <span
                className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500"
                title="Kafedra yuborgan Excel jadvalidan — qo‘lda yangilanadi"
              >
                Excel
              </span>
            ) : (
              <span className="text-slate-300">—</span>
            ),
        },
        { key: 'students', label: 'Talaba', align: 'right', value: (s) => s.student_count },
      ]}
    />
  );
}

function MonitorTable({ rows, sortFree }: { rows: MonitorRow[]; sortFree?: boolean }) {
  const status = (m: MonitorRow): Status => statusOf(m.planned_slots ? m.usage_percent ?? 0 : null);
  return (
    <SortableTable
      rows={rows}
      rowKey={(m) => m.monitor_id}
      initialSort={sortFree ? { key: 'free', dir: 'desc' } : { key: 'department', dir: 'asc' }}
      cardPrimary="id"
      cardSubtitle="department"
      columns={[
        {
          key: 'id',
          label: 'ID',
          value: (m) => m.monitor_id,
          render: (m) => (
            <span className="flex items-center gap-1.5 font-bold text-slate-900">
              <StatusDot status={status(m)} />
              {m.monitor_id}
            </span>
          ),
        },
        { key: 'department', label: 'Kafedra', value: (m) => `${m.department} ${m.monitor_id}`, render: (m) => m.department },
        { key: 'room', label: 'Xona', value: (m) => m.room_full },
        { key: 'planned', label: 'Reja', align: 'right', value: (m) => m.planned_slots },
        { key: 'used', label: 'Ishlatildi', align: 'right', value: (m) => m.used_slots },
        { key: 'free', label: 'Bo‘sh', align: 'right', value: (m) => m.free_slots },
        {
          key: 'usage',
          label: 'Foydalanish',
          align: 'right',
          value: (m) => m.usage_percent,
          render: (m) => <StatusChip status={status(m)}>{m.planned_slots ? pct(m.usage_percent) : 'jadval yo‘q'}</StatusChip>,
        },
        { key: 'teachers', label: 'O‘qituvchi', align: 'right', value: (m) => m.teacher_count },
      ]}
    />
  );
}

export default function MonitorDrill({
  kind,
  report,
  onClose,
}: {
  kind: MonitorDrillKind;
  report: MonitorReport;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const today = shiftDays(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const needle = q.trim().toLowerCase();
  const has = (...parts: Array<string | undefined>) => !needle || parts.some((p) => (p || '').toLowerCase().includes(needle));

  const content = useMemo(() => {
    if (kind === 'monitors' || kind === 'free') {
      const rows = report.monitors.filter((m) => has(m.monitor_id, m.department, m.room_full));
      return { count: rows.length, node: <MonitorTable rows={rows} sortFree={kind === 'free'} /> };
    }
    if (kind === 'teachers' || kind === 'usage') {
      const rows = report.teachers.filter((t) => has(t.teacher_name, t.department));
      return { count: rows.length, node: <TeacherTable rows={rows} slots={report.slots} /> };
    }
    const rows = report.slots.filter(
      (s) => s.planned && (kind === 'planned' || s.used) && has(s.teacher_name, s.monitor_id, s.subject, s.group, s.room_full),
    );
    return { count: rows.length, node: <SlotTable rows={rows} today={today} keyByName={keyByName(report)} allSlots={report.slots} /> };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, report, needle, today]);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={TITLE[kind]}
        className="flex max-h-[100dvh] w-full max-w-6xl flex-col overflow-hidden bg-slate-50 shadow-2xl sm:max-h-[90vh] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-bold text-slate-950">{TITLE[kind]}</h2>
            <p className="text-[12px] text-slate-500">
              {content.count} ta · {report.from} — {report.to} · ustun sarlavhasini bosib saralash mumkin
            </p>
          </div>
          <label className="flex w-full items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 sm:w-64">
            <Search size={14} className="text-slate-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Familiya, monitor, fan…" className="w-full bg-transparent py-1.5 text-[13px] outline-none" />
          </label>
          <button type="button" onClick={onClose} aria-label="Yopish" className="rounded-lg border border-slate-200 p-2 hover:bg-slate-50">
            <X size={16} />
          </button>
        </div>
        <div className="border-b border-slate-200 bg-white px-4 py-2">
          <StatusLegend />
        </div>
        <div className="flex-1 overflow-auto p-3">
          {content.count === 0 ? <p className="py-10 text-center text-[13px] text-slate-500">Ma’lumot yo‘q.</p> : content.node}
        </div>
      </div>
    </div>
  );
}
