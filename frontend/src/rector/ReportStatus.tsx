export const STATUS_LABELS = {
  red: 'Qizil',
  yellow: 'Sariq',
  green: 'Yashil',
  none: 'Baholanmaydi / ma’lumot kam',
};
export const STATUS_STYLES = {
  red: 'border-rose-200 bg-rose-50 text-rose-800',
  yellow: 'border-amber-200 bg-amber-50 text-amber-900',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  none: 'border-slate-200 bg-slate-50 text-slate-600',
};
export function ReportStatus({ status }: { status?: keyof typeof STATUS_LABELS }) {
  return (
    <span
      className={`inline-flex rounded-lg border px-2 py-1 text-xs font-semibold ${STATUS_STYLES[status || 'none']}`}
    >
      {STATUS_LABELS[status || 'none']}
    </span>
  );
}
