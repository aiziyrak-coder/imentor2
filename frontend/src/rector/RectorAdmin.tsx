import { useState } from 'react';
import {
  fetchAiUsage,
  fetchAttendanceAlerts,
  fetchAttendanceLive,
  fetchContentBank,
  fetchOnlineGroups,
  fetchRisk,
  fetchSubjects,
  type AiUsageReport,
  type AttendanceAlerts,
  type AttendanceLive,
  type ContentBank,
  type OnlineGroupsReport,
  type ReportFilters,
  type RiskPeriod,
  type RiskReport,
  type SubjectsReport,
} from './rectorApi';
import { useAsync } from './RectorCoverage';
import {
  Empty,
  ErrorBox,
  fmtDate,
  fmtMinutes,
  SectionTitle,
  SortableTable,
  Spinner,
  Stat,
  StatusChip,
  StatusDot,
  statusOf,
  statusOfLow,
  type Status,
} from './RectorUi';

/**
 * Admin panelidan rektor sahifasiga ko'chirilgan hisobotlar.
 *
 * Har biri admin ekrani tayangan XIZMATNING o'zidan o'qiydi (backend
 * `rector_admin_service`), shuning uchun rektor ko'rgan raqam admin
 * ko'rgani bilan bir xil. Hammasi svetofor rangida: yashil — joyida,
 * sariq — e'tibor kerak, qizil — muammo, kulrang — ma'lumot yo'q.
 */

type SectionProps = { filters: ReportFilters; onUnauthorized: () => void };

function share(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part * 100) / whole) : null;
}

function mean(values: Array<number | null>): number | null {
  const real = values.filter((v): v is number => v !== null && v !== undefined);
  return real.length ? Math.round(real.reduce((a, b) => a + b, 0) / real.length) : null;
}

function Pct({ value, status }: { value: number | null; status: Status }) {
  if (value === null) return <span className="text-slate-300">—</span>;
  return <StatusChip status={status}>{value}%</StatusChip>;
}

/** Kunlik ustunlar — qizil rangda, chunki bu yerda har bir ustun muammo. */
function DayBars({
  days,
  label,
  barClass = 'bg-rose-400',
}: {
  days: Array<{ date: string; value: number }>;
  label: string;
  /** Ustun rangi: ogohlantirishda qizil, neytral o'lchovda boshqa. */
  barClass?: string;
}) {
  const max = Math.max(1, ...days.map((d) => d.value));
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
      <p className="mb-3 text-[12.5px] font-semibold text-slate-600">{label}</p>
      <div className="flex h-28 items-end gap-1 overflow-x-auto">
        {days.map((d) => (
          <div key={d.date} className="flex min-w-[18px] flex-1 flex-col items-center gap-1">
            <div className="flex h-20 w-full items-end justify-center">
              <div
                className={`w-2/3 rounded-t ${d.value ? barClass : 'bg-slate-100'}`}
                style={{ height: `${d.value ? Math.max(6, (d.value / max) * 100) : 4}%` }}
                title={`${d.date}: ${d.value}`}
              />
            </div>
            <span className="text-[9.5px] text-slate-400">{d.date.slice(8)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ==================== Davomat (GPS) ==================== */

function LiveBlock({ data }: { data: AttendanceLive }) {
  if (!data.total) {
    return (
      <Empty text="Ayni daqiqada jadval bo‘yicha dars yo‘q — tanaffus yoki darsdan tashqari vaqt. Dars boshlanganda bu yer o‘zi to‘ladi." />
    );
  }
  const absentPct = share(data.absent, data.total);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Darsda bo‘lishi kerak" value={data.total} hint="jadval bo‘yicha hozir" />
        <Stat
          label="Joyida"
          value={data.present}
          hint={`${data.percent ?? 0}% — belgilangan binoda`}
          status={statusOf(data.percent, 85, 60)}
        />
        <Stat
          label="Joyida emas"
          value={data.absent}
          hint={`${absentPct ?? 0}% — binodan tashqarida yoki signal yo‘q`}
          status={statusOfLow(absentPct, 15, 40)}
        />
        <Stat label="Tekshirildi" value={fmtDate(data.checked_at)} hint="har daqiqada yangilanadi" />
      </div>

      {data.departments.length > 1 && (
        <SortableTable
          rows={data.departments}
          rowKey={(r) => r.department}
          initialSort={{ key: 'percent', dir: 'asc' }}
          columns={[
            {
              key: 'department',
              label: 'Kafedra',
              value: (r) => r.department,
              render: (r) => (
                <span className="flex items-center gap-2">
                  <StatusDot status={statusOf(r.percent, 85, 60)} />
                  {r.department}
                </span>
              ),
            },
            {
              key: 'present',
              label: 'Joyida',
              align: 'right',
              value: (r) => r.present,
              render: (r) => `${r.present} / ${r.total}`,
            },
            { key: 'absent', label: 'Joyida emas', align: 'right', value: (r) => r.absent },
            {
              key: 'percent',
              label: 'Davomat',
              align: 'right',
              value: (r) => r.percent,
              render: (r) => <Pct value={r.percent} status={statusOf(r.percent, 85, 60)} />,
            },
          ]}
        />
      )}

      <SortableTable
        rows={data.rows}
        rowKey={(r) => `${r.owner_key}-${r.slot_start}`}
        initialSort={{ key: 'status', dir: 'asc' }}
        columns={[
          {
            key: 'name',
            label: 'O‘qituvchi',
            value: (r) => r.display_name,
            render: (r) => (
              <span className="flex items-center gap-2">
                <StatusDot status={r.present ? 'good' : 'bad'} />
                <span>
                  <span className="block font-medium text-slate-900">{r.display_name}</span>
                  <span className="block text-[11px] text-slate-400">{r.department || '—'}</span>
                </span>
              </span>
            ),
          },
          {
            key: 'status',
            label: 'Holat',
            value: (r) => (r.present ? 1 : 0),
            render: (r) =>
              r.present ? (
                <StatusChip status="good">Joyida</StatusChip>
              ) : (
                <StatusChip status="bad">Joyida emas</StatusChip>
              ),
          },
          { key: 'building', label: 'Bino', value: (r) => r.building_name || '—' },
          {
            key: 'slot',
            label: 'Dars vaqti',
            value: (r) => r.slot_start,
            render: (r) => (
              <span>
                <span className="block tabular-nums">
                  {r.slot_start}–{r.slot_end}
                </span>
                {r.title && <span className="block text-[11px] text-slate-400">{r.title}</span>}
              </span>
            ),
          },
          {
            key: 'ping',
            label: 'Oxirgi signal',
            align: 'right',
            value: (r) => r.ping_age_min,
            render: (r) =>
              r.ping_age_min === null ? (
                <StatusChip status="bad" title="Telefondan joylashuv kelmagan">
                  signal yo‘q
                </StatusChip>
              ) : (
                <span className="tabular-nums text-slate-600">{r.ping_age_min} daq oldin</span>
              ),
          },
        ]}
      />
    </div>
  );
}

function AlertsBlock({ data }: { data: AttendanceAlerts }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Ogohlantirishlar" value={data.total} status={statusOfLow(data.total, 0, 10)} />
        <Stat
          label="Qoidani buzgan o‘qituvchi"
          value={data.staff_affected}
          status={statusOfLow(data.staff_affected, 0, 5)}
        />
        <Stat label="Kafedralar" value={data.departments.length} hint="ogohlantirish bo‘lgan" />
      </div>

      {data.total === 0 ? (
        <Empty text="Bu oraliqda bitta ham ogohlantirish yo‘q. Eslatma: agar o‘qituvchilar GPS kuzatuvini yoqmagan bo‘lsa, nol — isbot emas; “Xavf guruhi” bo‘limidagi GPS ko‘rsatkichiga qarang." />
      ) : (
        <>
          <DayBars
            days={data.days.map((d) => ({ date: d.date, value: d.alerts }))}
            label="Kunlar bo‘yicha ogohlantirishlar"
          />
          <SortableTable
            rows={data.teachers}
            rowKey={(r) => r.owner_key}
            initialSort={{ key: 'alerts', dir: 'desc' }}
            columns={[
              {
                key: 'name',
                label: 'O‘qituvchi',
                value: (r) => r.display_name,
                render: (r) => (
                  <span className="flex items-center gap-2">
                    <StatusDot status={r.alerts >= 3 ? 'bad' : 'warn'} />
                    <span>
                      <span className="block font-medium text-slate-900">{r.display_name}</span>
                      <span className="block text-[11px] text-slate-400">{r.department}</span>
                    </span>
                  </span>
                ),
              },
              {
                key: 'alerts',
                label: 'Ogohlantirish',
                align: 'right',
                value: (r) => r.alerts,
                render: (r) => (
                  <StatusChip status={r.alerts >= 3 ? 'bad' : 'warn'}>{r.alerts}</StatusChip>
                ),
              },
              { key: 'buildings', label: 'Binolar', value: (r) => r.buildings.join(', ') || '—' },
              {
                key: 'last',
                label: 'Oxirgisi',
                align: 'right',
                value: (r) => r.last_at || '',
                render: (r) => <span className="text-slate-500">{fmtDate(r.last_at)}</span>,
              },
            ]}
          />
        </>
      )}
    </div>
  );
}

export function AttendanceSection({ filters, onUnauthorized }: SectionProps) {
  const { from, to, refreshKey } = filters;
  const live = useAsync<AttendanceLive>(() => fetchAttendanceLive(), [refreshKey], onUnauthorized);
  const alerts = useAsync<AttendanceAlerts>(
    () => fetchAttendanceAlerts({ from, to }),
    [from, to, refreshKey],
    onUnauthorized,
  );

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <SectionTitle
          title="Hozir — darsda kim bor"
          hint="Jadval bo‘yicha ayni daqiqada darsda bo‘lishi kerak bo‘lgan o‘qituvchilar va telefonidan kelgan joylashuv. Admin “Jonli monitoring” ekrani bilan bir xil manba."
        />
        {live.loading && !live.data ? (
          <Spinner />
        ) : live.error ? (
          <ErrorBox text={live.error} />
        ) : (
          live.data && <LiveBlock data={live.data} />
        )}
      </section>

      <section className="space-y-2">
        <SectionTitle
          title="Davr bo‘yicha ogohlantirishlar"
          hint={`${from} — ${to}: dars vaqtida belgilangan binodan tashqarida bo‘lgan holatlar.`}
        />
        {alerts.loading && !alerts.data ? (
          <Spinner />
        ) : alerts.error ? (
          <ErrorBox text={alerts.error} />
        ) : (
          alerts.data && <AlertsBlock data={alerts.data} />
        )}
      </section>
    </div>
  );
}

/* ==================== Xavf guruhi ==================== */

const PERIODS: Array<{ key: RiskPeriod; label: string }> = [
  { key: 'daily', label: 'Kun' },
  { key: 'weekly', label: 'Hafta' },
  { key: 'monthly', label: 'Oy' },
  { key: 'quarterly', label: 'Chorak' },
  { key: 'yearly', label: 'O‘quv yili' },
];

const TIER: Record<string, { label: string; status: Status; hint: string; order: number }> = {
  inactive: { label: 'Nofaol', status: 'bad', hint: '30 kunda umuman kirmagan', order: 0 },
  low: { label: 'Past', status: 'warn', hint: 'oyda 60 daqiqadan kam', order: 1 },
  sufficient: { label: 'Yetarli', status: 'good', hint: 'oyda 60–180 daqiqa', order: 2 },
  active: { label: 'Faol', status: 'good', hint: 'oyda 180 daqiqadan ko‘p', order: 3 },
};

const FLAG_LABEL: Record<string, string> = {
  no_cases: 'Keys yo‘q',
  no_tests: 'Test yo‘q',
  no_live_tests: 'Jonli test yo‘q',
  inactive: 'Nofaol',
};

export function RiskSection({ filters, onUnauthorized }: SectionProps) {
  const [period, setPeriod] = useState<RiskPeriod>('monthly');
  const { to, department, refreshKey } = filters;
  const { data, loading, error } = useAsync<RiskReport>(
    () => fetchRisk(period, to, department || ''),
    [period, to, department, refreshKey],
    onUnauthorized,
  );

  const periodBar = (
    <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 py-2">
      <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Davr</span>
      {PERIODS.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => setPeriod(p.key)}
          className={`rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold transition ${
            period === p.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          {p.label}
        </button>
      ))}
      <span className="text-[11.5px] text-slate-400">
        {data ? `${data.from} — ${data.to}` : ''} · daraja oylik faollikdan hisoblanadi
      </span>
    </div>
  );

  if (loading && !data) {
    return (
      <div className="space-y-2">
        {periodBar}
        <Spinner />
      </div>
    );
  }
  if (error) return <ErrorBox text={error} />;
  if (!data) return null;

  const total = data.total;
  const risky = data.tiers.inactive + data.tiers.low;
  const flag = (key: string) => data.flags[key] || 0;

  return (
    <div className="space-y-4">
      {periodBar}

      <section className="space-y-2">
        <SectionTitle
          title="O‘qituvchilar faollik darajasi"
          hint="Admin “Super AI hisobot”idagi darajalar va o‘sha ro‘yxat (hisobi faol barcha xodimlar) — shuning uchun jami soni “O‘qituvchilar” bo‘limidagidan biroz farq qilishi mumkin. Nofaol va past darajadagilar — xavf guruhi."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Stat
            label="Xavf guruhida"
            value={risky}
            hint={`${share(risky, total) ?? 0}% — nofaol yoki past`}
            status={statusOfLow(share(risky, total), 20, 50)}
          />
          {(['inactive', 'low', 'sufficient', 'active'] as const).map((k) => (
            <Stat
              key={k}
              label={TIER[k].label}
              value={data.tiers[k]}
              hint={`${share(data.tiers[k], total) ?? 0}% · ${TIER[k].hint}`}
              status={TIER[k].status}
            />
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <SectionTitle title="Nima qilmayapti" hint="Davr ichida bitta ham yaratmagan o‘qituvchilar ulushi." />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label="Keys yaratmagan"
            value={flag('no_cases')}
            hint={`${share(flag('no_cases'), total) ?? 0}% o‘qituvchi`}
            status={statusOfLow(share(flag('no_cases'), total), 50, 85)}
          />
          <Stat
            label="Test yaratmagan"
            value={flag('no_tests')}
            hint={`${share(flag('no_tests'), total) ?? 0}% o‘qituvchi`}
            status={statusOfLow(share(flag('no_tests'), total), 50, 85)}
          />
          <Stat
            label="Jonli test o‘tkazmagan"
            value={flag('no_live_tests')}
            hint={`${share(flag('no_live_tests'), total) ?? 0}% o‘qituvchi`}
            status={statusOfLow(share(flag('no_live_tests'), total), 50, 85)}
          />
          <Stat
            label="GPS muvofiqligi"
            value={data.geofence_avg === null ? '—' : `${data.geofence_avg}%`}
            hint={
              data.geofence_tracked
                ? `${data.geofence_tracked} o‘qituvchi kuzatilgan`
                : 'hech kim GPS kuzatuvini yoqmagan'
            }
            status={data.geofence_tracked ? statusOf(data.geofence_avg, 90, 70) : 'none'}
          />
        </div>
      </section>

      <section className="space-y-2">
        <SectionTitle title="Kafedralar — xavf ulushi bo‘yicha" />
        <SortableTable
          rows={data.departments}
          rowKey={(r) => r.department}
          initialSort={{ key: 'risk', dir: 'desc' }}
          columns={[
            {
              key: 'department',
              label: 'Kafedra',
              value: (r) => r.department,
              render: (r) => (
                <span className="flex items-center gap-2">
                  <StatusDot status={statusOfLow(r.at_risk_pct, 20, 50)} />
                  <span>
                    <span className="block font-medium text-slate-900">{r.department}</span>
                    <span className="block text-[11px] text-slate-400">{r.teachers} o‘qituvchi</span>
                  </span>
                </span>
              ),
            },
            {
              key: 'risk',
              label: 'Xavf guruhi',
              align: 'right',
              value: (r) => r.at_risk_pct,
              render: (r) => <Pct value={r.at_risk_pct} status={statusOfLow(r.at_risk_pct, 20, 50)} />,
            },
            { key: 'inactive', label: 'Nofaol', align: 'right', value: (r) => r.inactive },
            { key: 'low', label: 'Past', align: 'right', value: (r) => r.low },
            { key: 'no_cases', label: 'Keys yo‘q', align: 'right', value: (r) => r.no_cases },
            { key: 'no_tests', label: 'Test yo‘q', align: 'right', value: (r) => r.no_tests },
            {
              key: 'alerts',
              label: 'GPS ogohl.',
              align: 'right',
              value: (r) => r.alerts,
              render: (r) =>
                r.alerts ? <StatusChip status={r.alerts >= 5 ? 'bad' : 'warn'}>{r.alerts}</StatusChip> : 0,
            },
            {
              key: 'geo',
              label: 'GPS',
              align: 'right',
              value: (r) => r.geofence_pct,
              render: (r) => <Pct value={r.geofence_pct} status={statusOf(r.geofence_pct, 90, 70)} />,
            },
          ]}
        />
      </section>

      <section className="space-y-2">
        <SectionTitle title={`O‘qituvchilar (${total})`} hint="Qizildan boshlab: nofaol → past → yetarli → faol." />
        <SortableTable
          rows={data.rows}
          rowKey={(r) => r.owner_key}
          initialSort={{ key: 'tier', dir: 'asc' }}
          columns={[
            {
              key: 'name',
              label: 'F.I.Sh.',
              value: (r) => r.display_name,
              render: (r) => (
                <span className="flex items-center gap-2">
                  <StatusDot status={TIER[r.tier]?.status || 'none'} />
                  <span>
                    <span className="block font-medium text-slate-900">{r.display_name}</span>
                    <span className="block text-[11px] text-slate-400">{r.department || '—'}</span>
                  </span>
                </span>
              ),
            },
            {
              key: 'tier',
              label: 'Daraja',
              value: (r) => TIER[r.tier]?.order ?? 9,
              render: (r) => (
                <StatusChip status={TIER[r.tier]?.status || 'none'} title={TIER[r.tier]?.hint}>
                  {TIER[r.tier]?.label || r.tier}
                </StatusChip>
              ),
            },
            {
              key: 'period',
              label: 'Davrda',
              align: 'right',
              value: (r) => r.active_minutes_period,
              render: (r) => fmtMinutes(r.active_minutes_period),
            },
            {
              key: 'month',
              label: 'Shu oy',
              align: 'right',
              value: (r) => r.active_minutes_month,
              render: (r) => fmtMinutes(r.active_minutes_month),
            },
            { key: 'cases', label: 'Keys', align: 'right', value: (r) => r.cases_created },
            { key: 'tests', label: 'Test', align: 'right', value: (r) => r.tests_created },
            { key: 'live', label: 'Jonli test', align: 'right', value: (r) => r.live_sessions_count },
            {
              key: 'geo',
              label: 'GPS',
              align: 'right',
              value: (r) => (r.pings_count ? r.in_geofence_pct : null),
              render: (r) =>
                r.pings_count ? (
                  <Pct value={r.in_geofence_pct} status={statusOf(r.in_geofence_pct, 90, 70)} />
                ) : (
                  <span className="text-slate-300">—</span>
                ),
            },
            {
              key: 'flags',
              label: 'Belgilar',
              value: (r) => (r.flags.length ? r.flags.length : null),
              render: (r) =>
                r.flags.length ? (
                  <span className="flex flex-wrap gap-1">
                    {r.flags.map((f) => (
                      <StatusChip key={f} status={f === 'inactive' ? 'bad' : 'warn'}>
                        {FLAG_LABEL[f] || f}
                      </StatusChip>
                    ))}
                  </span>
                ) : (
                  <span className="text-slate-300">—</span>
                ),
            },
          ]}
        />
      </section>
    </div>
  );
}

/* ==================== Fanlar ==================== */

export function SubjectsSection({ filters, onUnauthorized }: SectionProps) {
  const { from, to, refreshKey } = filters;
  const { data, loading, error } = useAsync<SubjectsReport>(
    () => fetchSubjects({ from, to }),
    [from, to, refreshKey],
    onUnauthorized,
  );

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox text={error} />;
  if (!data) return null;
  if (!data.results.length) {
    return <Empty text="Bu oraliqda iMentor orqali test topshirilmagan — fanlar bo‘yicha natija yo‘q." />;
  }

  const failed = data.results.reduce((n, r) => n + r.failed, 0);
  const weak = data.results.filter((r) => statusOf(r.pass_rate, 80, 60) === 'bad').length;

  return (
    <div className="space-y-2">
      <SectionTitle
        title="Fanlar kesimida natija"
        hint={`O‘tish chegarasi — ${data.pass_percent}% (“qoniqarli”). Eng yomon natijali fan birinchi.`}
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Fanlar" value={data.subjects} hint={`${weak} tasida o‘tish past`} status={statusOfLow(weak, 0, 3)} />
        <Stat label="Urinishlar" value={data.attempts} />
        <Stat
          label="O‘tish foizi"
          value={data.pass_rate === null ? '—' : `${data.pass_rate}%`}
          status={statusOf(data.pass_rate, 80, 60)}
        />
        <Stat
          label="O‘tolmagan urinish"
          value={failed}
          hint={`${share(failed, data.attempts) ?? 0}%`}
          status={statusOfLow(share(failed, data.attempts), 20, 40)}
        />
      </div>

      <SortableTable
        rows={data.results}
        rowKey={(r) => r.subject_code || '__none__'}
        initialSort={{ key: 'pass', dir: 'asc' }}
        columns={[
          {
            key: 'subject',
            label: 'Fan',
            value: (r) => r.subject_name,
            render: (r) => (
              <span className="flex items-center gap-2">
                <StatusDot status={statusOf(r.pass_rate, 80, 60)} />
                <span>
                  <span className="block font-medium text-slate-900">{r.subject_name}</span>
                  <span className="block text-[11px] text-slate-400">{r.department || '—'}</span>
                </span>
              </span>
            ),
          },
          {
            key: 'pass',
            label: 'O‘tish foizi',
            align: 'right',
            value: (r) => r.pass_rate,
            render: (r) => <Pct value={r.pass_rate} status={statusOf(r.pass_rate, 80, 60)} />,
          },
          {
            key: 'avg',
            label: 'O‘rtacha ball',
            align: 'right',
            value: (r) => r.avg_percent,
            render: (r) => <Pct value={r.avg_percent} status={statusOf(r.avg_percent, 71, 56)} />,
          },
          { key: 'students', label: 'Talaba', align: 'right', value: (r) => r.students },
          { key: 'attempts', label: 'Urinish', align: 'right', value: (r) => r.attempts },
          { key: 'failed', label: 'O‘tolmagan', align: 'right', value: (r) => r.failed },
          { key: 'sessions', label: 'Test sessiyasi', align: 'right', value: (r) => r.sessions },
          { key: 'teachers', label: 'O‘qituvchi', align: 'right', value: (r) => r.teachers },
        ]}
      />
    </div>
  );
}

/* ==================== Online guruhlar ==================== */

export function GroupsSection({ filters, onUnauthorized }: SectionProps) {
  const { from, to, refreshKey } = filters;
  const { data, loading, error } = useAsync<OnlineGroupsReport>(
    () => fetchOnlineGroups({ from, to }),
    [from, to, refreshKey],
    onUnauthorized,
  );

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox text={error} />;
  if (!data) return null;
  if (!data.results.length) return <Empty text="Online ta’lim yoki malaka oshirish guruhlari topilmadi." />;

  const rows = data.results;
  const held = rows.reduce((n, r) => n + r.lessons_held, 0);
  const attendance = mean(rows.map((r) => r.attendance_pct));
  const avg = mean(rows.map((r) => r.avg_percent));

  return (
    <div className="space-y-2">
      <SectionTitle
        title="Online ta’lim va malaka oshirish guruhlari"
        hint="Davomat = darsga kirishlar ÷ (o‘tilgan darslar × guruh hajmi). Malaka guruhlarida hajm tinglovchilar ro‘yxatidan, online guruhlarda iz qoldirgan talabalardan olinadi."
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Guruhlar" value={rows.length} />
        <Stat label="O‘tilgan darslar" value={held} status={held ? undefined : 'bad'} />
        <Stat
          label="O‘rtacha davomat"
          value={attendance === null ? '—' : `${attendance}%`}
          status={statusOf(attendance, 80, 60)}
        />
        <Stat label="O‘rtacha natija" value={avg === null ? '—' : `${avg}%`} status={statusOf(avg, 71, 56)} />
      </div>

      <SortableTable
        rows={rows}
        rowKey={(r) => String(r.group_id)}
        initialSort={{ key: 'attendance', dir: 'asc' }}
        columns={[
          {
            key: 'group',
            label: 'Guruh',
            value: (r) => r.group_name,
            render: (r) => (
              <span className="flex items-center gap-2">
                <StatusDot status={r.lessons_held ? statusOf(r.attendance_pct, 80, 60) : 'none'} />
                <span>
                  <span className="block font-medium text-slate-900">{r.group_name}</span>
                  <span className="block text-[11px] text-slate-400">{r.program_label}</span>
                </span>
              </span>
            ),
          },
          {
            key: 'size',
            label: 'Hajm',
            align: 'right',
            value: (r) => r.size,
            render: (r) => (
              <span title={r.size_is_roster ? 'ro‘yxat bo‘yicha' : 'iz qoldirganlar bo‘yicha (taxminiy)'}>
                {r.size}
                {!r.size_is_roster && r.size ? <span className="text-slate-400">*</span> : null}
              </span>
            ),
          },
          { key: 'held', label: 'Dars', align: 'right', value: (r) => r.lessons_held },
          {
            key: 'attendance',
            label: 'Davomat',
            align: 'right',
            value: (r) => r.attendance_pct,
            render: (r) => <Pct value={r.attendance_pct} status={statusOf(r.attendance_pct, 80, 60)} />,
          },
          { key: 'attended', label: 'Qatnashgan', align: 'right', value: (r) => r.students_attended },
          {
            key: 'minutes',
            label: 'Darsda vaqt',
            align: 'right',
            value: (r) => r.minutes,
            render: (r) => fmtMinutes(r.minutes),
          },
          { key: 'tests', label: 'Test', align: 'right', value: (r) => r.tests },
          {
            key: 'avg',
            label: 'Natija',
            align: 'right',
            value: (r) => r.avg_percent,
            render: (r) => <Pct value={r.avg_percent} status={statusOf(r.avg_percent, 71, 56)} />,
          },
        ]}
      />
    </div>
  );
}

/* ==================== Kontent bazasi ==================== */

type Loose = Record<string, unknown>;

function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(v) || 0;
}

function text(...values: unknown[]): string {
  const hit = values.find((v) => typeof v === 'string' && v.trim());
  return typeof hit === 'string' ? hit : '—';
}

export function BankSection({ filters, onUnauthorized }: SectionProps) {
  const { refreshKey } = filters;
  const { data, loading, error } = useAsync<ContentBank>(() => fetchContentBank(), [refreshKey], onUnauthorized);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox text={error} />;
  if (!data) return null;

  const t = (data.catalog.totals || {}) as Loose;
  const s = data.syllabus;
  const bySubject = ((data.catalog.by_subject || []) as Loose[]).slice(0, 20);
  const byAuthor = ((data.catalog.by_author || []) as Loose[]).slice(0, 20);
  const pending = num(t.pending_publish_count);
  const week = num(t.created_last_7d);

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <SectionTitle title="O‘quv tuzilmasi" hint="Admin bosh sahifasi bilan bir xil manba; sana oralig‘iga bog‘liq emas." />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Kafedralar" value={s.departments_count} />
          <Stat label="Fanlar" value={s.subjects_count} />
          <Stat label="Yo‘nalishlar" value={s.variants_count} />
          <Stat label="Mavzular" value={s.topics_count} />
        </div>
      </section>

      <section className="space-y-2">
        <SectionTitle title="Test va keys bazasi" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Jami to‘plam" value={num(t.total_count)} />
          <Stat label="Testlar" value={num(t.test_count)} />
          <Stat label="Keyslar" value={num(t.case_count)} />
          <Stat label="Savollar" value={num(t.questions_total)} />
          <Stat
            label="Oxirgi 7 kunda"
            value={week}
            hint={`30 kunda: ${num(t.created_last_30d)}`}
            status={week ? 'good' : 'bad'}
          />
          <Stat
            label="E’lon kutmoqda"
            value={pending}
            hint={`e’lon qilingan: ${num(t.published_count)}`}
            status={statusOfLow(share(pending, num(t.total_count)), 10, 30)}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Mualliflar" value={num(t.authors_distinct)} />
          <Stat label="Fan qamrovi" value={num(t.subjects_distinct)} hint={`jami fan: ${s.subjects_count}`} status={statusOf(share(num(t.subjects_distinct), s.subjects_count), 60, 25)} />
          <Stat label="Mavzu qamrovi" value={num(t.topics_distinct)} hint={`jami mavzu: ${s.topics_count}`} status={statusOf(share(num(t.topics_distinct), s.topics_count), 50, 15)} />
          <Stat label="Yo‘nalishlar" value={num(t.variants_distinct)} />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        {bySubject.length > 0 && (
          <section className="space-y-2">
            <SectionTitle title="Eng ko‘p material bor fanlar" />
            <SortableTable<Loose>
              rows={bySubject}
              rowKey={(r) => text(r.subject_code, r.subject_name, r.name) + num(r.total_count ?? r.total ?? r.count)}
              initialSort={{ key: 'count', dir: 'desc' }}
              columns={[
                { key: 'name', label: 'Fan', value: (r) => text(r.subject_name, r.name, r.subject_code) },
                {
                  key: 'count',
                  label: 'To‘plam',
                  align: 'right',
                  value: (r) => num(r.total_count ?? r.total ?? r.count),
                },
              ]}
            />
          </section>
        )}
        {byAuthor.length > 0 && (
          <section className="space-y-2">
            <SectionTitle title="Eng faol mualliflar" />
            <SortableTable<Loose>
              rows={byAuthor}
              rowKey={(r) => text(r.owner_key, r.author_display_name, r.author, r.name) + num(r.total_count ?? r.total ?? r.count)}
              initialSort={{ key: 'count', dir: 'desc' }}
              columns={[
                {
                  key: 'name',
                  label: 'Muallif',
                  value: (r) => text(r.author_display_name, r.author, r.name, r.owner_key),
                },
                {
                  key: 'count',
                  label: 'To‘plam',
                  align: 'right',
                  value: (r) => num(r.total_count ?? r.total ?? r.count),
                },
              ]}
            />
          </section>
        )}
      </div>

      {s.by_department.length > 0 && (
        <section className="space-y-2">
          <SectionTitle title="Kafedralar bo‘yicha fanlar soni" />
          <SortableTable
            rows={s.by_department}
            rowKey={(r) => r.code || r.name}
            initialSort={{ key: 'subjects', dir: 'desc' }}
            columns={[
              { key: 'name', label: 'Kafedra', value: (r) => r.name },
              {
                key: 'subjects',
                label: 'Fanlar',
                align: 'right',
                value: (r) => r.subjects_count,
                render: (r) =>
                  r.subjects_count ? r.subjects_count : <StatusChip status="bad">0</StatusChip>,
              },
            ]}
          />
        </section>
      )}
    </div>
  );
}

/* ==================== AI sarfi ==================== */

/** Texnik kalit → odam o'qiydigan nom. Yangi funksiya qo'shilsa shu yerga ham. */
export const AI_KIND_LABEL: Record<string, string> = {
  test_generate: 'Test yaratish',
  test_generate_brief: 'Test yaratish (qisqa izoh)',
  test_option_explanations: 'Test tahlili va variant izohlari',
  test_translate: 'Test tarjimasi',
  case_generate: 'Vaziyatli masala yaratish',
  lecture_generate: 'Ma’ruza matni',
  presentation_generate: 'Taqdimot',
  presentation_generate_fallback: 'Taqdimot (zaxira urinish)',
  presentation_continue: 'Taqdimot (davomi)',
  syllabus_extract: 'Sillabusni o‘qish',
  syllabus_extract_retry: 'Sillabusni o‘qish (kuchli model)',
  handout_infographic: 'Tarqatma infografikasi',
  external_mcq: 'Tashqi API (fermi.uz) testlari',
  online_case_review: 'Talaba keysini AI tekshirishi',
  malaka_test_import: 'Malaka: fayldan test o‘qish',
  embedding: 'Darslikdan qidiruv (embedding)',
  education_ai: 'Boshqa AI so‘rovlari',
  education_ai_stream: 'Boshqa AI so‘rovlari (oqim)',
  chat: 'Fon ishlari (tarjima va b.)',
  chat_stream: 'Fon ishlari (oqim)',
  text: 'Boshqa',
  boshqa: 'Belgilanmagan',
};

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} mln`;
  if (n >= 10_000) return `${Math.round(n / 1000)} ming`;
  return n.toLocaleString('uz-UZ');
}

function fmtUsd(n: number): string {
  if (n > 0 && n < 0.01) return '<$0.01';
  return `$${n.toFixed(2)}`;
}

export function AiUsageSection({ filters, onUnauthorized }: SectionProps) {
  const { from, to, refreshKey } = filters;
  const { data, loading, error } = useAsync<AiUsageReport>(
    () => fetchAiUsage({ from, to }),
    [from, to, refreshKey],
    onUnauthorized,
  );

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox text={error} />;
  if (!data) return null;

  const rows = data.results;
  const input = rows.reduce((n, r) => n + r.prompt_tokens, 0);
  const output = rows.reduce((n, r) => n + r.completion_tokens, 0);
  const activeDays = data.days.filter((d) => d.calls > 0).length;
  const perDay = activeDays ? data.cost_usd / activeDays : null;

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <SectionTitle
          title="AI (OpenAI) sarfi"
          hint={`${data.from} — ${data.to}. Har bir AI chaqiruvi bazaga yoziladi: qaysi funksiya, qaysi model, nechta token. Hisob 2026-09-13 dan boshlangan — undan oldingi sarf yozilmagan. ${data.prices_note}`}
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Stat
            label="Taxminiy narx"
            value={fmtUsd(data.cost_usd)}
            hint={perDay === null ? 'bu oraliqda chaqiruv yo‘q' : `faol kunga o‘rtacha ${fmtUsd(perDay)}`}
          />
          <Stat label="Chaqiruvlar" value={data.calls} />
          <Stat
            label="Jami token"
            value={fmtTokens(data.tokens)}
            hint={`kirish ${fmtTokens(input)} · chiqish ${fmtTokens(output)}`}
          />
          <Stat
            label="Keshdan o‘qilgan"
            value={data.cached_pct === null ? '—' : `${data.cached_pct}%`}
            hint="kirish tokenlari — taxminan 50% arzon"
            status={data.calls ? statusOf(data.cached_pct, 40, 15) : 'none'}
          />
          <Stat
            label="Chaqiruvga o‘rtacha"
            value={data.calls ? fmtTokens(Math.round(data.tokens / data.calls)) : '—'}
            hint="token"
          />
        </div>
      </section>

      {!rows.length ? (
        <Empty text="Bu oraliqda AI chaqiruvi yozilmagan. Hisob 2026-09-13 dan boshlangan — o‘qituvchilar AI funksiyalaridan foydalanganda bu yer o‘zi to‘ladi." />
      ) : (
        <>
          <DayBars
            days={data.days.map((d) => ({ date: d.date, value: d.tokens }))}
            label="Kunlar bo‘yicha token"
            barClass="bg-sky-400"
          />

          <section className="space-y-2">
            <SectionTitle
              title="Funksiyalar bo‘yicha — eng qimmatidan"
              hint="Chiqish tokeni (model yozgan matn) kirishdan taxminan 4 barobar qimmat. Keshdan o‘qilgan ulush qancha yuqori bo‘lsa, shuncha arzon."
            />
            <SortableTable
              rows={rows}
              rowKey={(r) => `${r.kind}-${r.model}`}
              initialSort={{ key: 'cost', dir: 'desc' }}
              columns={[
                {
                  key: 'kind',
                  label: 'Funksiya',
                  value: (r) => AI_KIND_LABEL[r.kind] || r.kind,
                  render: (r) => (
                    <span>
                      <span className="block font-medium text-slate-900">{AI_KIND_LABEL[r.kind] || r.kind}</span>
                      <span className="block font-mono text-[11px] text-slate-400">
                        {r.kind} · {r.model}
                      </span>
                    </span>
                  ),
                },
                {
                  key: 'cost',
                  label: 'Narx',
                  align: 'right',
                  value: (r) => r.cost_usd,
                  render: (r) => <span className="font-semibold tabular-nums">{fmtUsd(r.cost_usd)}</span>,
                },
                {
                  key: 'share',
                  label: 'Ulushi',
                  align: 'right',
                  value: (r) => share(r.cost_usd, data.cost_usd),
                  render: (r) => `${share(r.cost_usd, data.cost_usd) ?? 0}%`,
                },
                { key: 'calls', label: 'Chaqiruv', align: 'right', value: (r) => r.calls },
                {
                  key: 'in',
                  label: 'Kirish',
                  align: 'right',
                  value: (r) => r.prompt_tokens,
                  render: (r) => fmtTokens(r.prompt_tokens),
                },
                {
                  key: 'out',
                  label: 'Chiqish',
                  align: 'right',
                  value: (r) => r.completion_tokens,
                  render: (r) => fmtTokens(r.completion_tokens),
                },
                {
                  key: 'cached',
                  label: 'Keshdan',
                  align: 'right',
                  value: (r) => r.cached_pct,
                  render: (r) => <Pct value={r.cached_pct} status={statusOf(r.cached_pct, 40, 15)} />,
                },
                {
                  key: 'avg',
                  label: 'Chaqiruvga',
                  align: 'right',
                  value: (r) => r.avg_tokens,
                  render: (r) => fmtTokens(r.avg_tokens),
                },
              ]}
            />
          </section>
        </>
      )}
    </div>
  );
}

