
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { HttpError } from '../api/httpClient';
import { fetchMonitorReport, type MonitorReport as MonitorReportData, type ReportFilters } from './rectorApi';
import MonitorDrill, { type MonitorDrillKind } from './MonitorDrill';
import MonitorExplorer from './MonitorExplorer';
import { shiftDays } from './rectorDates';
import { Stat, statusOf } from './RectorUi';

function pct(v: number | null | undefined): string {
  return v == null ? '—' : `${v}%`;
}


export default function MonitorReport({ filters, onUnauthorized }: { filters: ReportFilters; onUnauthorized: () => void }) {
  const [report, setReport] = useState<MonitorReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drill, setDrill] = useState<MonitorDrillKind | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    fetchMonitorReport({ from: filters.from, to: filters.to, department: filters.department })
      .then((r) => {
        if (!alive) return;
        setReport(r);
      })
      .catch((err) => {
        if (!alive) return;
        if (err instanceof HttpError && (err.status === 401 || err.status === 403)) onUnauthorized();
        else setError('Monitor hisoboti yuklanmadi. Sahifani yangilab qayta urinib ko‘ring.');
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [filters.from, filters.to, filters.department, filters.refreshKey, onUnauthorized]);


  if (loading && !report) {
    return (
      <div className="flex min-h-[45vh] items-center justify-center rounded-2xl border border-slate-200 bg-white">
        <Loader2 className="animate-spin text-slate-400" size={30} />
      </div>
    );
  }

  if (error) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700">{error}</div>;
  }

  if (!report) return null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Stat label="Monitorlar" value={report.totals.monitors} hint="ID berilgan xona-monitorlar" onClick={() => setDrill('monitors')} />
        <Stat label="Jadvaldagi o‘qituvchi" value={report.totals.teachers} hint="Familiya bo‘yicha ro‘yxat" onClick={() => setDrill('teachers')} />
        <Stat label="Rejalashtirilgan slot" value={report.totals.planned_slots} hint="Kim, qachon, qaysi xonada" onClick={() => setDrill('planned')} />
        <Stat
          label="Ishlatilgan slot"
          value={report.totals.used_slots}
          hint={`${Math.max(0, report.totals.planned_slots - report.totals.used_slots)} ta ishlatilmagan`}
          status={report.totals.planned_slots ? statusOf(report.totals.usage_percent) : undefined}
          onClick={() => setDrill('used')}
        />
        <Stat label="Bo‘sh imkoniyat" value={report.totals.free_slots} hint="Monitorlar bo‘yicha" onClick={() => setDrill('free')} />
        <Stat
          label="Foydalanish"
          value={pct(report.totals.usage_percent)}
          hint="O‘qituvchilar bo‘yicha"
          status={report.totals.planned_slots ? statusOf(report.totals.usage_percent) : undefined}
          onClick={() => setDrill('usage')}
        />
      </div>
      {drill && <MonitorDrill kind={drill} report={report} onClose={() => setDrill(null)} />}

      <MonitorExplorer report={report} today={shiftDays(0)} />
    </div>
  );
}
