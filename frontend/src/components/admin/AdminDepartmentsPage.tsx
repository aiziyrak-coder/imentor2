import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, EyeOff, Landmark, Loader2, Search } from 'lucide-react';
import { useUiText } from '../../i18n/useUiText';
import {
  listAdminDepartments,
  setDepartmentReportExcluded,
  setSubjectReportExcluded,
  type AdminDepartmentDto,
  type DepartmentSubjectDto,
} from '../../utils/staffLocationApi';

/**
 * Kafedralar: har kafedra va unga biriktirilgan fanlar.
 *
 * Kafedra yoki fan "hisobotdan chiqarilsa", rektor hisobotiga tushmaydi:
 * kafedra — uning barcha o'qituvchilari bilan, fan — hech bir o'qituvchining
 * statistikasida (`backend_fastapi/app/services/report_exclusion.py`).
 */

function ReportToggle({
  on,
  disabled,
  busy,
  onChange,
  label,
}: {
  on: boolean;
  disabled?: boolean;
  busy?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled || busy}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${
        on ? 'bg-emerald-500' : 'bg-black/20'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[22px]' : 'translate-x-0.5'}`}
      />
      {busy && <Loader2 size={12} className="absolute left-1/2 -translate-x-1/2 animate-spin text-black/50" />}
    </button>
  );
}

export default function AdminDepartmentsPage() {
  const { t } = useUiText();
  const [rows, setRows] = useState<AdminDepartmentDto[]>([]);
  const [unassigned, setUnassigned] = useState<DepartmentSubjectDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await listAdminDepartments();
      setRows(data.results || []);
      setUnassigned(data.unassigned_subjects || []);
    } catch {
      setError(t('admin.departmentsLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleDepartment = async (d: AdminDepartmentDto, inReport: boolean) => {
    setBusy(`d${d.id}`);
    setError(null);
    try {
      await setDepartmentReportExcluded(d.id, !inReport);
      setRows((prev) => prev.map((r) => (r.id === d.id ? { ...r, report_excluded: !inReport } : r)));
    } catch {
      setError(t('admin.departmentsSaveFailed'));
    } finally {
      setBusy(null);
    }
  };

  const toggleSubject = async (s: DepartmentSubjectDto, inReport: boolean) => {
    setBusy(`s${s.id}`);
    setError(null);
    const patch = (list: DepartmentSubjectDto[]) =>
      list.map((x) => (x.id === s.id ? { ...x, report_excluded: !inReport } : x));
    try {
      await setSubjectReportExcluded(s.id, !inReport);
      setRows((prev) => prev.map((r) => ({ ...r, subjects: patch(r.subjects) })));
      setUnassigned(patch);
    } catch {
      setError(t('admin.departmentsSaveFailed'));
    } finally {
      setBusy(null);
    }
  };

  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const all: AdminDepartmentDto[] = unassigned.length
      ? [
          ...rows,
          {
            id: -1,
            name: t('admin.departmentsUnassigned'),
            code: '',
            hemis_name: '',
            is_active: true,
            report_excluded: false,
            teacher_count: 0,
            subjects: unassigned,
          },
        ]
      : rows;
    if (!needle) return all;
    return all
      .map((d) => {
        if (d.name.toLowerCase().includes(needle) || d.hemis_name.toLowerCase().includes(needle)) return d;
        const subjects = d.subjects.filter(
          (s) => s.subject_name.toLowerCase().includes(needle) || s.subject_code.toLowerCase().includes(needle)
        );
        return subjects.length ? { ...d, subjects } : null;
      })
      .filter((d): d is AdminDepartmentDto => d !== null);
  }, [rows, unassigned, needle, t]);

  const excludedCount = rows.filter((r) => r.report_excluded).length;

  return (
    <div className="w-full space-y-5 px-3 sm:px-5 lg:px-6 pb-24 py-4">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-slate-700 text-white flex items-center justify-center">
          <Landmark size={24} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-black/90">{t('admin.departmentsTitle')}</h1>
          <p className="text-[12px] text-black/50">{t('admin.departmentsSubtitle')}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/40" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('admin.departmentsSearch')}
            className="w-full rounded-xl border border-black/10 bg-white/70 pl-9 pr-3 py-2 text-[14px]"
          />
        </label>
        {excludedCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-800 px-3 py-1 text-[12px] font-semibold">
            <EyeOff size={14} />
            {t('admin.departmentsExcluded')}: {excludedCount}
          </span>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-black/50 gap-2">
          <Loader2 className="animate-spin" size={20} />
          {t('admin.loading')}
        </div>
      ) : visible.length === 0 ? (
        <div className="px-4 py-10 text-center text-black/45 text-[13px]">{t('admin.departmentsEmpty')}</div>
      ) : (
        <div className="space-y-2">
          {visible.map((d) => {
            const isOpen = open.has(d.id) || !!needle;
            const isReal = d.id > 0;
            const deptInReport = !d.report_excluded;
            const subjectsOff = d.subjects.filter((s) => s.report_excluded).length;
            return (
              <div
                key={d.id}
                className={`ios-glass rounded-2xl border overflow-hidden ${
                  deptInReport ? 'border-white/60' : 'border-amber-300 bg-amber-50/40'
                }`}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    setOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(d.id)) next.delete(d.id);
                      else next.add(d.id);
                      return next;
                    })
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      (e.currentTarget as HTMLElement).click();
                    }
                  }}
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
                >
                  {isOpen ? <ChevronDown size={18} className="text-black/40" /> : <ChevronRight size={18} className="text-black/40" />}
                  <div className="min-w-0 flex-1">
                    <div className={`font-semibold text-[14px] truncate ${deptInReport ? 'text-black/85' : 'text-black/50 line-through'}`}>
                      {d.name}
                    </div>
                    <div className="text-[12px] text-black/45">
                      {d.subjects.length} {t('admin.departmentsSubjects')}
                      {isReal && ` · ${d.teacher_count} ${t('admin.departmentsTeachers')}`}
                      {subjectsOff > 0 && ` · ${subjectsOff} ${t('admin.departmentsExcluded').toLowerCase()}`}
                    </div>
                  </div>
                  {isReal && (
                    <div className="flex items-center gap-2">
                      <span className={`hidden sm:inline text-[12px] font-medium ${deptInReport ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {deptInReport ? t('admin.departmentsInReport') : t('admin.departmentsExcluded')}
                      </span>
                      <ReportToggle
                        on={deptInReport}
                        busy={busy === `d${d.id}`}
                        label={`${d.name}: ${deptInReport ? t('admin.departmentsInReport') : t('admin.departmentsExcluded')}`}
                        onChange={(next) => void toggleDepartment(d, next)}
                      />
                    </div>
                  )}
                </div>

                {isOpen && (
                  <div className="border-t border-black/5">
                    {!deptInReport && (
                      <div className="px-4 py-2 text-[12px] text-amber-800 bg-amber-100/60">{t('admin.departmentsExcludedHint')}</div>
                    )}
                    {d.subjects.length === 0 ? (
                      <div className="px-4 py-4 text-[13px] text-black/45">{t('admin.departmentsNoSubjects')}</div>
                    ) : (
                      <ul>
                        {d.subjects.map((s) => {
                          const subjectInReport = deptInReport && !s.report_excluded;
                          return (
                            <li key={s.id} className="flex items-center gap-3 px-4 py-2.5 pl-11 border-t border-black/5 first:border-t-0">
                              <div className="min-w-0 flex-1">
                                <div className={`text-[13px] truncate ${subjectInReport ? 'text-black/80' : 'text-black/45 line-through'}`}>
                                  {s.subject_name}
                                </div>
                                <div className="text-[11px] text-black/40 font-mono">{s.subject_code}</div>
                              </div>
                              <ReportToggle
                                on={subjectInReport}
                                disabled={!deptInReport}
                                busy={busy === `s${s.id}`}
                                label={`${s.subject_name}: ${subjectInReport ? t('admin.departmentsInReport') : t('admin.departmentsExcluded')}`}
                                onChange={(next) => void toggleSubject(s, next)}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
