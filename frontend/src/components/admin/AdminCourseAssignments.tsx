import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FileText,
  GraduationCap,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  User,
  Users,
} from 'lucide-react';
import {
  assignStaffToCourseSyllabus,
  fetchAdminCourseSyllabuses,
  fetchAdminSyllabusCatalogStats,
  fetchAllStaffCourseSelections,
  removeStaffCourseSelection,
  type AdminStaffCourseSelectionRow,
  type CourseSyllabusRow,
} from '../../utils/syllabusApi';
import { fetchAcademicCatalog } from '../../utils/academicCatalogApi';
import { fetchStaffDirectory, type StaffDirectoryEntry } from '../../utils/staffDirectoryApi';
import { resolveSyllabusVariants } from '../../utils/syllabusVariant';
import { backendErrorMessage } from '../../utils/apiError';
import { useUiText } from '../../i18n/useUiText';
import SearchableSelect from './SearchableSelect';
import { matchDepartmentByName, namesSoftMatch } from '../../utils/departmentMatch';

type FanBucket = {
  fanId: number;
  fanName: string;
  departmentName: string;
  pdfNames: string[];
  rows: AdminStaffCourseSelectionRow[];
};
type TeacherGroup = {
  ownerKey: string;
  name: string;
  phone: string;
  fans: FanBucket[];
};

type DeptOption = {
  key: string;
  name: string;
  code: string;
  academicId: number | null;
};

function syllabusPdfNames(row: CourseSyllabusRow | AdminStaffCourseSelectionRow['syllabus']): string[] {
  const fromVariants = resolveSyllabusVariants(row)
    .map((v) => (v.file_name || '').trim())
    .filter(Boolean);
  if (fromVariants.length) return [...new Set(fromVariants)];
  const single = (row.file_name || '').trim();
  return single ? [single] : [];
}

export default function AdminCourseAssignments() {
  const { t } = useUiText();
  const [fans, setFans] = useState<CourseSyllabusRow[]>([]);
  const [teachers, setTeachers] = useState<StaffDirectoryEntry[]>([]);
  const [selections, setSelections] = useState<AdminStaffCourseSelectionRow[]>([]);
  const [departments, setDepartments] = useState<DeptOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Biriktirish: o'qituvchi → kafedra → fan(lar) (syllabus)
  const [phone, setPhone] = useState('');
  const [deptKey, setDeptKey] = useState('');
  const [fanIds, setFanIds] = useState<string[]>([]);
  const [fanSearch, setFanSearch] = useState('');
  const [assigning, setAssigning] = useState(false);

  const [search, setSearch] = useState('');
  const [teacherFilter, setTeacherFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [fanFilter, setFanFilter] = useState('');
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fanRows, staff, sels, catalog, stats] = await Promise.all([
        fetchAdminCourseSyllabuses(),
        fetchStaffDirectory(),
        fetchAllStaffCourseSelections(),
        fetchAcademicCatalog().catch(() => null),
        fetchAdminSyllabusCatalogStats().catch(() => null),
      ]);
      setFans(fanRows);
      setTeachers(staff.filter((u) => u.role === 'hodim'));
      setSelections(sels);

      const academic = (stats?.by_department || []).map((d) => ({
        id: d.id,
        name: d.name,
        code: d.code || d.name,
      }));
      const kafedralar = catalog?.kafedralar || [];
      if (kafedralar.length > 0) {
        // OnlineTest academic-catalog — 28 kafedra (asosiy manba).
        setDepartments(
          kafedralar.map((k, idx) => {
            const hit = matchDepartmentByName(k.name, k.code, academic);
            return {
              key: `catalog:${k.id || idx}`,
              name: k.name,
              code: (k.code || '').trim(),
              academicId: hit?.id ?? null,
            };
          }),
        );
      } else {
        // Fallback: DB / syllabusdan.
        setDepartments(
          academic
            .map((d) => ({
              key: `id:${d.id}`,
              name: d.name,
              code: d.code,
              academicId: d.id,
            }))
            .sort((a, b) => a.name.localeCompare(b.name, 'uz')),
        );
      }
    } catch {
      setError(t('admin.error.loadFailed'));
      setFans([]);
      setTeachers([]);
      setSelections([]);
      setDepartments([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedDept = useMemo(
    () => departments.find((d) => d.key === deptKey) || null,
    [departments, deptKey],
  );

  const fansInDept = useMemo(() => {
    if (!selectedDept) return [];
    return fans
      .filter((f) => {
        if (selectedDept.academicId != null && f.department === selectedDept.academicId) return true;
        const fanDept = (f.department_name || '').trim();
        if (fanDept && namesSoftMatch(fanDept, selectedDept.name)) return true;
        const fanCode = (f.department_code || '').trim();
        if (fanCode && selectedDept.code && namesSoftMatch(fanCode, selectedDept.code)) return true;
        return false;
      })
      .sort((a, b) => a.subject_name.localeCompare(b.subject_name, 'uz'));
  }, [fans, selectedDept]);

  const selectedFans = useMemo(
    () => fansInDept.filter((f) => fanIds.includes(String(f.id))),
    [fansInDept, fanIds],
  );
  const selectedPdfs = useMemo(() => {
    const names: string[] = [];
    for (const f of selectedFans) {
      for (const n of syllabusPdfNames(f)) {
        if (!names.includes(n)) names.push(n);
      }
    }
    return names;
  }, [selectedFans]);

  useEffect(() => {
    setFanIds([]);
    setFanSearch('');
  }, [deptKey]);

  useEffect(() => {
    const allowed = new Set(fansInDept.map((f) => String(f.id)));
    setFanIds((prev) => {
      const next = prev.filter((id) => allowed.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [fansInDept]);

  const fanOptionsVisible = useMemo(() => {
    const q = fanSearch.trim().toLowerCase();
    const parts = q ? q.split(/\s+/).filter(Boolean) : [];
    return fansInDept.filter((f) => {
      if (!parts.length) return true;
      const hay = `${f.subject_name} ${f.subject_code || ''} ${syllabusPdfNames(f).join(' ')}`.toLowerCase();
      return parts.every((p) => hay.includes(p));
    });
  }, [fansInDept, fanSearch]);

  const toggleFan = (id: string) => {
    setFanIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const assignedFanIds = useMemo(() => {
    if (!phone) return new Set<string>();
    const set = new Set<string>();
    for (const sel of selections) {
      if (sel.owner_key === phone) set.add(String(sel.syllabus.id));
    }
    return set;
  }, [selections, phone]);

  const fanIdsToAssign = useMemo(
    () => fanIds.filter((id) => !assignedFanIds.has(id)),
    [fanIds, assignedFanIds],
  );

  const teacherGroups = useMemo<TeacherGroup[]>(() => {
    const map = new Map<
      string,
      { ownerKey: string; name: string; phone: string; fans: Map<number, FanBucket> }
    >();
    for (const sel of selections) {
      const key = sel.owner_key;
      if (!map.has(key)) {
        map.set(key, {
          ownerKey: key,
          name: sel.owner_name || sel.owner_phone_display,
          phone: sel.owner_phone_display,
          fans: new Map(),
        });
      }
      const g = map.get(key)!;
      if (!g.fans.has(sel.syllabus.id)) {
        g.fans.set(sel.syllabus.id, {
          fanId: sel.syllabus.id,
          fanName: sel.syllabus.subject_name,
          departmentName: (sel.syllabus.department_name || '').trim(),
          pdfNames: syllabusPdfNames(sel.syllabus),
          rows: [],
        });
      }
      g.fans.get(sel.syllabus.id)!.rows.push(sel);
    }
    return [...map.values()]
      .map((g) => ({
        ownerKey: g.ownerKey,
        name: g.name,
        phone: g.phone,
        fans: [...g.fans.values()].sort((a, b) => a.fanName.localeCompare(b.fanName, 'uz')),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'uz'));
  }, [selections]);

  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return teacherGroups.filter((g) => {
      if (teacherFilter && g.ownerKey !== teacherFilter) return false;
      if (
        deptFilter &&
        !g.fans.some((f) => f.departmentName && namesSoftMatch(f.departmentName, deptFilter))
      ) {
        return false;
      }
      if (fanFilter && !g.fans.some((f) => String(f.fanId) === fanFilter)) return false;
      if (q) {
        const inTeacher = g.name.toLowerCase().includes(q) || g.phone.toLowerCase().includes(q);
        const inFan = g.fans.some(
          (f) =>
            f.fanName.toLowerCase().includes(q) ||
            f.departmentName.toLowerCase().includes(q) ||
            f.pdfNames.some((p) => p.toLowerCase().includes(q)),
        );
        if (!inTeacher && !inFan) return false;
      }
      return true;
    });
  }, [teacherGroups, search, teacherFilter, deptFilter, fanFilter]);

  useEffect(() => {
    setPage(1);
  }, [search, teacherFilter, deptFilter, fanFilter]);

  const groupPageCount = Math.max(1, Math.ceil(visibleGroups.length / PAGE_SIZE));
  const groupSafePage = Math.min(page, groupPageCount);
  const pagedGroups = useMemo(() => {
    const start = (groupSafePage - 1) * PAGE_SIZE;
    return visibleGroups.slice(start, start + PAGE_SIZE);
  }, [visibleGroups, groupSafePage]);

  const detailGroup = useMemo(
    () => (detailKey ? teacherGroups.find((g) => g.ownerKey === detailKey) ?? null : null),
    [detailKey, teacherGroups],
  );

  const assign = async () => {
    if (!phone || fanIdsToAssign.length === 0) return;
    setAssigning(true);
    setError(null);
    try {
      // Yo'nalish tanlanmaydi — tanlangan har bir fan (syllabus) biriktiriladi.
      await Promise.all(fanIdsToAssign.map((id) => assignStaffToCourseSyllabus(phone, Number(id), [])));
      setPhone('');
      setDeptKey('');
      setFanIds([]);
      setSelections(await fetchAllStaffCourseSelections());
    } catch (err) {
      setError(backendErrorMessage(err) || t('admin.error.assignFailed'));
    } finally {
      setAssigning(false);
    }
  };

  const unassignFan = async (rows: AdminStaffCourseSelectionRow[]) => {
    try {
      await Promise.all(rows.map((r) => removeStaffCourseSelection(r.id)));
      const ids = new Set(rows.map((r) => r.id));
      setSelections((prev) => prev.filter((s) => !ids.has(s.id)));
    } catch {
      setError(t('admin.error.unassignFailed'));
    }
  };

  const canAssign = Boolean(phone) && fanIdsToAssign.length > 0 && !assigning;

  useEffect(() => {
    if (detailKey && !loading && !teacherGroups.some((g) => g.ownerKey === detailKey)) {
      setDetailKey(null);
    }
  }, [detailKey, teacherGroups, loading]);

  const listDeptNames = useMemo(
    () => departments.map((d) => d.name),
    [departments],
  );

  return (
    <div className="p-3 sm:p-5 lg:p-6 h-full overflow-y-auto w-full space-y-6">
      <div className="ios-glass rounded-3xl border border-white/70 p-6 shadow-sm flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center">
            <GraduationCap size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">{t('admin.assignmentsTitle')}</h2>
            <p className="text-[13px] text-slate-500 leading-relaxed">{t('admin.assignmentsSubtitle')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white text-[13px] font-semibold text-slate-700"
        >
          <RefreshCw size={16} /> {t('admin.refresh')}
        </button>
      </div>

      <div className="ios-glass rounded-2xl border border-white/70 p-5 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[12px] font-semibold text-slate-600">1 · {t('admin.teacher')}</span>
            <SearchableSelect
              value={phone}
              onChange={setPhone}
              disabled={assigning}
              placeholder={t('admin.selectTeacherPlaceholder')}
              noMatchText={t('admin.noResults')}
              options={teachers.map((tch) => ({
                value: tch.phone_digits,
                label: `${tch.display_name} (${tch.phone_digits})`,
              }))}
            />
          </label>

          <label className="space-y-1">
            <span className="text-[12px] font-semibold text-slate-600">2 · {t('admin.department')}</span>
            <SearchableSelect
              value={deptKey}
              onChange={setDeptKey}
              disabled={assigning}
              placeholder={t('admin.selectDepartmentPlaceholder')}
              noMatchText={t('admin.noResults')}
              options={departments.map((d) => ({ value: d.key, label: d.name }))}
            />
          </label>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[12px] font-semibold text-slate-600">3 · {t('admin.subjectName')}</span>
            {fanIds.length > 0 && (
              <span className="text-[11px] font-medium text-indigo-700">
                {t('admin.subjectsSelectedCount', { count: fanIds.length })}
              </span>
            )}
          </div>

          {!deptKey ? (
            <p className="text-[12px] text-slate-400 rounded-xl border border-dashed border-slate-200 px-3 py-4">
              {t('admin.selectDepartmentFirst')}
            </p>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="relative border-b border-slate-100">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={fanSearch}
                  onChange={(e) => setFanSearch(e.target.value)}
                  disabled={assigning}
                  placeholder={t('admin.selectSubjectsPlaceholder')}
                  className="w-full h-11 pl-9 pr-3 text-[13px] outline-none disabled:bg-slate-50"
                />
              </div>
              <ul className="max-h-64 overflow-auto divide-y divide-slate-50">
                {fanOptionsVisible.length === 0 ? (
                  <li className="px-3 py-3 text-[12px] text-slate-400">{t('admin.noResults')}</li>
                ) : (
                  fanOptionsVisible.map((f) => {
                    const id = String(f.id);
                    const checked = fanIds.includes(id);
                    const assigned = assignedFanIds.has(id);
                    const inactive = !f.is_active;
                    return (
                      <li key={id}>
                        <label
                          className={`flex items-center gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-indigo-50/60 ${
                            checked ? 'bg-indigo-50/40' : ''
                          } ${assigning ? 'opacity-60 pointer-events-none' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleFan(id)}
                            disabled={assigning}
                            className="w-4 h-4 accent-indigo-600 shrink-0"
                          />
                          <span className="min-w-0 flex-1 text-[13px] text-slate-800 truncate">
                            {f.subject_name}
                            {inactive ? (
                              <span className="text-slate-400"> · {t('admin.toggleInactive')}</span>
                            ) : null}
                          </span>
                          {assigned && (
                            <span className="text-[10px] font-semibold text-emerald-600 shrink-0">
                              {t('admin.alreadyAssigned')}
                            </span>
                          )}
                        </label>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          )}
        </div>

        {fanIds.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5 space-y-1.5">
            <span className="text-[12px] font-semibold text-slate-600">{t('admin.attachedPdfs')}</span>
            {selectedPdfs.length === 0 ? (
              <p className="text-[12px] text-amber-700">{t('admin.noDocumentUploaded')}</p>
            ) : (
              <ul className="space-y-1">
                {selectedPdfs.map((name) => (
                  <li key={name} className="flex items-center gap-1.5 text-[12px] text-slate-700 min-w-0">
                    <FileText size={13} className="text-slate-400 shrink-0" />
                    <span className="truncate">{name}</span>
                  </li>
                ))}
              </ul>
            )}
            {fanIdsToAssign.length === 0 && (
              <p className="text-[11px] font-semibold text-emerald-600">{t('admin.alreadyAssigned')}</p>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => void assign()}
            disabled={!canAssign}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-[13px] font-semibold disabled:opacity-40"
          >
            {assigning ? <Loader2 className="animate-spin" size={16} /> : <Users size={16} />}
            {t('admin.assign')}
          </button>
          {error && <p className="text-[13px] text-rose-600 font-medium">{error}</p>}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-indigo-600" size={40} />
        </div>
      ) : detailGroup ? (
        <TeacherDetail group={detailGroup} onBack={() => setDetailKey(null)} onUnassignFan={unassignFan} t={t} />
      ) : (
        <div className="space-y-3">
          <div className="ios-glass rounded-2xl border border-white/70 p-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative lg:col-span-1 sm:col-span-2">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('admin.searchPlaceholder')}
                className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-200 bg-white text-[13px]"
              />
            </div>
            <select
              value={teacherFilter}
              onChange={(e) => setTeacherFilter(e.target.value)}
              className="h-10 px-3 rounded-xl border border-slate-200 bg-white text-[13px]"
            >
              <option value="">{t('admin.filterAllTeachers')}</option>
              {teachers.map((tch) => (
                <option key={tch.phone_digits} value={tch.phone_digits}>
                  {tch.display_name}
                </option>
              ))}
            </select>
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="h-10 px-3 rounded-xl border border-slate-200 bg-white text-[13px]"
            >
              <option value="">{t('admin.filterAllDepartments')}</option>
              {listDeptNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <select
              value={fanFilter}
              onChange={(e) => setFanFilter(e.target.value)}
              className="h-10 px-3 rounded-xl border border-slate-200 bg-white text-[13px]"
            >
              <option value="">{t('admin.filterAllSubjects')}</option>
              {fans.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.subject_name}
                </option>
              ))}
            </select>
          </div>

          {teacherGroups.length === 0 ? (
            <div className="ios-glass rounded-2xl border p-10 text-center text-slate-400 text-[14px]">
              {t('admin.assignmentsEmpty')}
            </div>
          ) : visibleGroups.length === 0 ? (
            <div className="ios-glass rounded-2xl border p-10 text-center text-slate-400 text-[14px]">
              {t('admin.noResults')}
            </div>
          ) : (
            <div className="space-y-3">
            <ul className="space-y-2">
              {pagedGroups.map((g) => (
                <li key={g.ownerKey}>
                  <button
                    type="button"
                    onClick={() => setDetailKey(g.ownerKey)}
                    className="w-full ios-glass rounded-2xl border border-white/70 px-4 py-3 flex items-center gap-3 text-left hover:border-indigo-300 transition"
                  >
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                      <User size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-slate-900 truncate">{g.name}</p>
                      <p className="text-[12px] text-slate-500">
                        {g.phone} · {t('admin.subjectsCount', { count: g.fans.length })}
                      </p>
                    </div>
                    <ChevronRight size={18} className="text-slate-400 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
            {visibleGroups.length > PAGE_SIZE ? (
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={groupSafePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 h-9 px-3 rounded-xl border border-slate-200 bg-white text-[12px] font-semibold text-slate-600 disabled:opacity-40"
                >
                  <ChevronLeft size={16} /> {t('common.prev')}
                </button>
                <span className="text-[12px] text-slate-500 font-medium">
                  {t('admin.pageStatus', {
                    from: String((groupSafePage - 1) * PAGE_SIZE + 1),
                    to: String(Math.min(groupSafePage * PAGE_SIZE, visibleGroups.length)),
                    total: String(visibleGroups.length),
                  })}
                </span>
                <button
                  type="button"
                  disabled={groupSafePage >= groupPageCount}
                  onClick={() => setPage((p) => Math.min(groupPageCount, p + 1))}
                  className="inline-flex items-center gap-1 h-9 px-3 rounded-xl border border-slate-200 bg-white text-[12px] font-semibold text-slate-600 disabled:opacity-40"
                >
                  {t('common.next')} <ChevronRight size={16} />
                </button>
              </div>
            ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TeacherDetail({
  group,
  onBack,
  onUnassignFan,
  t,
}: {
  group: TeacherGroup;
  onBack: () => void;
  onUnassignFan: (rows: AdminStaffCourseSelectionRow[]) => void;
  t: ReturnType<typeof useUiText>['t'];
}) {
  return (
    <div className="space-y-3">
      <div className="ios-glass rounded-2xl border border-white/70 p-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
          <User size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-slate-900 truncate">{group.name}</p>
          <p className="text-[12px] text-slate-500">
            {group.phone} · {t('admin.subjectsCount', { count: group.fans.length })}
          </p>
        </div>
      </div>

      <ul className="space-y-3">
        {group.fans.map((fan) => (
          <li key={fan.fanId} className="ios-glass rounded-2xl border border-white/70 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/60 flex items-start gap-2">
              <GraduationCap size={16} className="text-indigo-600 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="font-bold text-slate-900">{fan.fanName}</p>
                {fan.departmentName ? (
                  <p className="text-[12px] text-slate-500">{fan.departmentName}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => onUnassignFan(fan.rows)}
                className="p-1.5 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg shrink-0"
                title={t('admin.delete')}
              >
                <Trash2 size={15} />
              </button>
            </div>
            <ul className="divide-y divide-slate-50">
              {fan.pdfNames.length === 0 ? (
                <li className="px-4 py-2.5 text-[12px] text-slate-400">{t('admin.noDocumentUploaded')}</li>
              ) : (
                fan.pdfNames.map((name) => (
                  <li key={name} className="flex items-center gap-2 px-4 py-2.5">
                    <FileText size={13} className="text-slate-400 shrink-0" />
                    <span className="text-[12px] text-slate-600 truncate">{name}</span>
                  </li>
                ))
              )}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
