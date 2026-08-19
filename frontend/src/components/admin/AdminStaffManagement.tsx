import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Users, Plus, Pencil, Trash2, Loader2, AlertCircle, Shield, ArrowUpDown, ArrowUp, ArrowDown, X, Search, FilterX, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { isValidStaffLogin, normalizeStaffLogin, type UserRole } from '../../utils/localStaffAuth';
import {
  fetchStaffDirectory,
  removeStaffMember,
  upsertStaffMember,
  type StaffDirectoryEntry,
} from '../../utils/staffDirectoryApi';
import { fetchAdminSyllabusCatalogStats } from '../../utils/syllabusApi';
import { fetchPublicKafedralar } from '../../utils/academicCatalogApi';
import { matchDepartmentByName } from '../../utils/departmentMatch';
import { HttpError } from '../../api/httpClient';
import { roleLabel } from '../../i18n/translations';
import { useUiText } from '../../i18n/useUiText';

type DeptOption = { id: number | null; name: string; code: string };

/** Select `value` — sillabus kafedralarida id bor, akademik katalogdan kelganlarida faqat nom. */
function deptOptionValue(d: DeptOption): string {
  return d.id != null ? String(d.id) : `name:${d.name}`;
}

function formatLastActive(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('uz-UZ', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

const emptyForm = {
  phoneDisplay: '+998',
  password: '',
  firstName: '',
  lastName: '',
  department: '',
  departmentId: null as number | null,
  role: 'hodim' as UserRole,
};

type SortKey = 'displayName' | 'phoneDisplay' | 'role' | 'department' | 'lastActiveAt';
type SortDirection = 'asc' | 'desc';

function loadErrorMessage(err: unknown, t: ReturnType<typeof useUiText>['t']): string {
  if (err instanceof HttpError) {
    if (err.status === 403) return t('admin.error.adminRequired');
    if (err.status === 401) return t('admin.error.reloginRequired');
  }
  return t('admin.error.loadFailed');
}

function httpDetail(err: HttpError): string {
  const body = err.body;
  if (!body || typeof body !== 'object') return typeof err.body === 'string' ? err.body : '';
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail[0] && typeof detail[0] === 'object' && detail[0] && 'msg' in (detail[0] as object)) {
    return String((detail[0] as { msg: unknown }).msg);
  }
  return '';
}

export default function AdminStaffManagement() {
  const { t, language } = useUiText();
  const [rows, setRows] = useState<StaffDirectoryEntry[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('lastActiveAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<StaffDirectoryEntry | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [showAdd, setShowAdd] = useState(false);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [departments, setDepartments] = useState<DeptOption[]>([]);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await fetchStaffDirectory();
      // Faqat xodimlar: admin / o'qituvchi / klinika_admin (talaba emas).
      setRows(
        all.filter((u) => ['admin', 'hodim', 'klinika_admin'].includes(String(u.role || ''))),
      );
    } catch (err) {
      setRows([]);
      setError(loadErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void Promise.allSettled([fetchAdminSyllabusCatalogStats(), fetchPublicKafedralar()]).then(
      ([statsRes, kafedraRes]) => {
        const academic: DeptOption[] = [];
        if (statsRes.status === 'fulfilled') {
          for (const d of statsRes.value?.by_department || []) {
            academic.push({ id: d.id, name: d.name, code: d.code || d.name });
          }
        }
        const merged: DeptOption[] = [];
        const seen = new Set<string>();
        const push = (opt: DeptOption) => {
          const key = opt.name.trim().toLocaleLowerCase();
          if (!key || seen.has(key)) return;
          seen.add(key);
          merged.push(opt);
        };
        if (kafedraRes.status === 'fulfilled' && (kafedraRes.value || []).length > 0) {
          for (const k of kafedraRes.value) {
            const hit = matchDepartmentByName(k.name, k.code, academic);
            push({ id: hit?.id ?? null, name: k.name, code: k.code || k.name });
          }
          for (const d of academic) {
            if (!matchDepartmentByName(d.name, d.code, merged)) push(d);
          }
        } else {
          for (const d of academic) push(d);
        }
        merged.sort((a, b) => a.name.localeCompare(b.name));
        setDepartments(merged);
      },
    );
  }, []);

  const startEdit = (u: StaffDirectoryEntry) => {
    setEditing(u);
    const deptId =
      u.department_id ??
      departments.find((d) => d.name === u.department)?.id ??
      null;
    setForm({
      phoneDisplay: u.phone_display,
      password: '',
      firstName: u.first_name,
      lastName: u.last_name,
      department: u.department,
      departmentId: deptId,
      role: (u.role || 'hodim') as UserRole,
    });
    setShowAdd(false);
  };

  const closeForm = () => {
    setEditing(null);
    setShowAdd(false);
    setForm(emptyForm);
    setError(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (form.password.length < 6) {
        setError(t('admin.error.passwordMin'));
        return;
      }
      if (!isValidStaffLogin(form.phoneDisplay.trim())) {
        setError(t('admin.error.invalidPhone'));
        return;
      }
      // Telefon raqami yoki Xodim ID — ikkalasi ham username sifatida saqlanadi.
      const phoneDigits = normalizeStaffLogin(form.phoneDisplay.trim());
      await upsertStaffMember({
        phone_digits: phoneDigits,
        password: form.password,
        role: 'hodim',
        first_name: form.firstName.trim(),
        last_name: form.lastName.trim(),
        faculty: '',
        department: form.department.trim(),
        department_id: form.departmentId,
        direction: '',
      });
      setForm(emptyForm);
      setShowAdd(false);
      await load();
    } catch (err: unknown) {
      if (err instanceof HttpError && err.status === 400) {
        setError(t('admin.error.phoneAlreadyExists'));
      } else if (err instanceof HttpError && err.status === 403) {
        setError(t('admin.error.forbidden'));
      } else if (err instanceof Error && err.message === 'no-admin-token') {
        setError(t('admin.error.noAdminToken'));
      } else if (err instanceof HttpError) {
        setError(httpDetail(err) || t('admin.error.createFailed'));
      } else {
        setError(t('admin.error.createFailed'));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      await upsertStaffMember({
        phone_digits: editing.phone_digits,
        password: form.password.trim().length >= 6 ? form.password.trim() : '',
        role: form.role,
        first_name: form.firstName.trim(),
        last_name: form.lastName.trim(),
        faculty: editing.faculty || '',
        department: form.department.trim(),
        department_id: form.departmentId,
        direction: editing.direction || '',
      });
      setEditing(null);
      setForm(emptyForm);
      await load();
    } catch (err: unknown) {
      if (err instanceof HttpError && err.status === 403) {
        setError(t('admin.error.forbidden'));
      } else if (err instanceof Error && err.message === 'no-admin-token') {
        setError(t('admin.error.noAdminToken'));
      } else if (err instanceof HttpError) {
        setError(httpDetail(err) || t('admin.error.updateFailed'));
      } else {
        setError(t('admin.error.updateFailed'));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (u: StaffDirectoryEntry) => {
    if (!window.confirm(t('admin.error.confirmDeleteUser', { name: u.display_name }))) return;
    setError(null);
    setSaving(true);
    try {
      await removeStaffMember(u.phone_digits);
      await load();
    } catch (err: unknown) {
      if (err instanceof HttpError && err.status === 400) {
        setError(t('admin.error.cannotDeleteSelf'));
      } else if (err instanceof HttpError && err.status === 403) {
        setError(t('admin.error.lastAdminDelete'));
      } else if (err instanceof HttpError && err.status === 409) {
        const detail =
          err.body && typeof err.body === 'object' && 'detail' in err.body
            ? String((err.body as { detail: unknown }).detail)
            : '';
        setError(detail || t('admin.error.deleteFailed'));
      } else if (err instanceof Error && err.message === 'no-admin-token') {
        setError(t('admin.error.noAdminToken'));
      } else {
        setError(t('admin.error.deleteFailed'));
      }
    } finally {
      setSaving(false);
    }
  };

  const sortedRows = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      let left: string | number = '';
      let right: string | number = '';

      switch (sortKey) {
        case 'displayName':
          left = (a.display_name || '').toLocaleLowerCase();
          right = (b.display_name || '').toLocaleLowerCase();
          break;
        case 'phoneDisplay':
          left = (a.phone_display || '').toLocaleLowerCase();
          right = (b.phone_display || '').toLocaleLowerCase();
          break;
        case 'role':
          left = a.role;
          right = b.role;
          break;
        case 'department':
          left = (a.department || '').toLocaleLowerCase();
          right = (b.department || '').toLocaleLowerCase();
          break;
        case 'lastActiveAt':
          left = a.last_login ? new Date(a.last_login).getTime() : 0;
          right = b.last_login ? new Date(b.last_login).getTime() : 0;
          break;
        default:
          break;
      }

      if (left < right) return sortDirection === 'asc' ? -1 : 1;
      if (left > right) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [rows, sortDirection, sortKey]);

  const roleOptions = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const u of rows) {
      const role = String(u.role || 'hodim');
      if (seen.has(role)) continue;
      seen.add(role);
      list.push(role);
    }
    return list;
  }, [rows]);

  const deptFilterOptions = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    let hasUnassigned = false;
    for (const u of rows) {
      const name = (u.department || '').trim();
      if (!name) {
        hasUnassigned = true;
        continue;
      }
      const key = name.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
    names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return { names, hasUnassigned };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return sortedRows.filter((u) => {
      if (roleFilter && String(u.role || 'hodim') !== roleFilter) return false;
      const dept = (u.department || '').trim();
      if (deptFilter === '__none__' && dept) return false;
      if (deptFilter && deptFilter !== '__none__' && dept !== deptFilter) return false;
      if (!q) return true;
      const hay = [u.display_name, u.phone_display, u.phone_digits, u.role, u.department]
        .join(' ')
        .toLocaleLowerCase();
      return hay.includes(q);
    });
  }, [deptFilter, query, roleFilter, sortedRows]);

  useEffect(() => {
    setPage(1);
  }, [query, roleFilter, deptFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagedRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, safePage]);

  const filtersActive = Boolean(query.trim() || roleFilter || deptFilter);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDirection('asc');
  };

  useEffect(() => {
    if (!(showAdd || editing)) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [showAdd, editing]);

  const sortLabel = (key: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => handleSort(key)}
      className="inline-flex items-center gap-1.5 hover:text-black/80 transition-colors"
      title={`${label} ${t('admin.sortBy')}`}
    >
      <span>{label}</span>
      {sortKey !== key && <ArrowUpDown size={13} className="text-black/40" />}
      {sortKey === key && sortDirection === 'asc' && <ArrowUp size={13} className="text-indigo-600" />}
      {sortKey === key && sortDirection === 'desc' && <ArrowDown size={13} className="text-indigo-600" />}
    </button>
  );

  return (
    <div className="w-full space-y-6 pb-16 px-3 sm:px-5 lg:px-6 py-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center">
            <Users size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-black/90">{t('admin.staffManagementTitle')}</h1>
            <p className="text-[12px] text-black/50">{t('admin.staffManagementSubtitle')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowAdd(true);
            setEditing(null);
            setForm({ ...emptyForm });
            setError(null);
          }}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-[13px] font-semibold shadow-md"
        >
          <Plus size={18} /> {t('admin.addStaff')}
        </button>
      </div>

      {error && !(showAdd || editing) && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      <div className="ios-glass rounded-2xl border border-white/70 p-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-200 bg-white text-[13px] outline-none"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('admin.searchPlaceholder')}
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="h-10 px-3 rounded-xl border border-slate-200 bg-white text-[13px]"
        >
          <option value="">{t('admin.filterAllRoles')}</option>
          {roleOptions.map((role) => (
            <option key={role} value={role}>
              {roleLabel(language, role)}
            </option>
          ))}
        </select>
        <select
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className="h-10 px-3 rounded-xl border border-slate-200 bg-white text-[13px]"
        >
          <option value="">{t('admin.filterAllDepartments')}</option>
          {deptFilterOptions.hasUnassigned ? (
            <option value="__none__">{t('admin.departmentUnassigned')}</option>
          ) : null}
          {deptFilterOptions.names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <div className="sm:col-span-2 lg:col-span-4 flex items-center justify-between gap-2 flex-wrap">
          <p className="text-[12px] text-black/50 font-medium">
            {t('admin.staffShownCount', { shown: filteredRows.length, total: rows.length })}
            {filteredRows.length > PAGE_SIZE
              ? ` · ${t('admin.pageStatus', {
                  from: String((safePage - 1) * PAGE_SIZE + 1),
                  to: String(Math.min(safePage * PAGE_SIZE, filteredRows.length)),
                  total: String(filteredRows.length),
                })}`
              : ''}
          </p>
          {filtersActive ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setRoleFilter('');
                setDeptFilter('');
              }}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-slate-200 bg-white text-[12px] font-semibold text-slate-600 hover:bg-slate-50"
            >
              <FilterX size={14} />
              {t('admin.clearFilters')}
            </button>
          ) : null}
        </div>
      </div>

      <div className="ios-glass rounded-2xl border border-white/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-black/[0.04] text-black/55 font-semibold">
              <tr>
                <th className="px-4 py-3 w-14 whitespace-nowrap">{t('admin.serialNo')}</th>
                <th className="px-4 py-3">{sortLabel('displayName', t('admin.fullName'))}</th>
                <th className="px-4 py-3">{sortLabel('phoneDisplay', t('admin.phone'))}</th>
                <th className="px-4 py-3">{sortLabel('role', t('admin.role'))}</th>
                <th className="px-4 py-3">{sortLabel('department', t('admin.department'))}</th>
                <th className="px-4 py-3 whitespace-nowrap min-w-[140px]">{sortLabel('lastActiveAt', t('admin.lastActivity'))}</th>
                <th className="px-4 py-3 w-28"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-black/45">
                    <Loader2 className="animate-spin inline mr-2" size={18} />
                    {t('admin.loading')}
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-black/45">
                    {filtersActive ? t('admin.noResults') : t('admin.noStaffInList')}
                  </td>
                </tr>
              ) : (
                pagedRows.map((u, index) => (
                  <tr key={u.phone_digits} className="hover:bg-black/[0.02]">
                    <td className="px-4 py-2.5 text-black/45 tabular-nums text-[12px]">{(safePage - 1) * PAGE_SIZE + index + 1}</td>
                    <td className="px-4 py-2.5 font-medium text-black/90">{u.display_name}</td>
                    <td className="px-4 py-2.5 font-mono text-[12px]">{u.phone_display}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-black/5 text-[11px] font-semibold">
                        {u.role === 'admin' && <Shield size={12} />}
                        {roleLabel(language, u.role || 'hodim')}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-black/65 max-w-[180px] truncate">{u.department}</td>
                    <td className="px-4 py-2.5 text-black/55 tabular-nums text-[12px] whitespace-nowrap">
                      {formatLastActive(u.last_login)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(u)}
                          className="p-2 rounded-lg hover:bg-black/5 text-indigo-600"
                          title={t('admin.edit')}
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(u)}
                          className="p-2 rounded-lg hover:bg-rose-500/10 text-rose-600"
                          title={t('admin.delete')}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filteredRows.length > PAGE_SIZE ? (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-black/5">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 h-9 px-3 rounded-xl border border-slate-200 bg-white text-[12px] font-semibold text-slate-600 disabled:opacity-40"
            >
              <ChevronLeft size={16} /> {t('common.prev')}
            </button>
            <span className="text-[12px] text-slate-500 font-medium">
              {t('admin.pageStatus', {
                from: String((safePage - 1) * PAGE_SIZE + 1),
                to: String(Math.min(safePage * PAGE_SIZE, filteredRows.length)),
                total: String(filteredRows.length),
              })}
            </span>
            <button
              type="button"
              disabled={safePage >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              className="inline-flex items-center gap-1 h-9 px-3 rounded-xl border border-slate-200 bg-white text-[12px] font-semibold text-slate-600 disabled:opacity-40"
            >
              {t('common.next')} <ChevronRight size={16} />
            </button>
          </div>
        ) : null}
      </div>

      <AnimatePresence>
        {(showAdd || editing) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[240] flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4"
            role="dialog"
            aria-modal="true"
            onClick={closeForm}
          >
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              className="ios-glass w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-white/60 p-6 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-bold text-black/90">{editing ? t('admin.editStaff') : t('admin.newStaff')}</h2>
              <button
                type="button"
                onClick={closeForm}
                className="p-2 rounded-lg hover:bg-black/5 text-black/50"
                aria-label={t('admin.cancel')}
              >
                <X size={18} />
              </button>
            </div>
            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
                <AlertCircle size={18} className="shrink-0 mt-0.5" />
                {error}
              </div>
            )}
            <form onSubmit={editing ? handleUpdate : handleCreate} className="grid sm:grid-cols-2 gap-3">
              <label className="space-y-1 sm:col-span-2">
                <span className="text-[11px] font-semibold text-black/50">{t('admin.phone')}</span>
                <input
                  className="w-full rounded-xl border border-black/10 px-3 py-2 text-[14px] disabled:bg-black/[0.03] disabled:text-black/70"
                  value={form.phoneDisplay}
                  onChange={(e) => setForm((f) => ({ ...f, phoneDisplay: e.target.value }))}
                  required
                  disabled={Boolean(editing)}
                  readOnly={Boolean(editing)}
                />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="text-[11px] font-semibold text-black/50">
                  {t('admin.password')} {editing && `(${t('admin.passwordEmpty')})`}
                </span>
                <input
                  type="password"
                  className="w-full rounded-xl border border-black/10 px-3 py-2 text-[14px]"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  required={!editing}
                  placeholder={editing ? '••••••' : ''}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-semibold text-black/50">{t('admin.firstName')}</span>
                <input
                  className="w-full rounded-xl border border-black/10 px-3 py-2 text-[14px]"
                  value={form.firstName}
                  onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                  required
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-semibold text-black/50">{t('admin.lastName')}</span>
                <input
                  className="w-full rounded-xl border border-black/10 px-3 py-2 text-[14px]"
                  value={form.lastName}
                  onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                  required
                />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="text-[11px] font-semibold text-black/50">{t('admin.department')}</span>
                {departments.length > 0 ? (
                  <select
                    className="w-full rounded-xl border border-black/10 px-3 py-2 text-[14px]"
                    value={
                      form.departmentId != null
                        ? String(form.departmentId)
                        : form.department
                          ? `name:${form.department}`
                          : ''
                    }
                    onChange={(e) => {
                      const raw = e.target.value;
                      const dept = departments.find((d) => deptOptionValue(d) === raw) || null;
                      setForm((f) => ({
                        ...f,
                        departmentId: dept?.id ?? null,
                        department: dept?.name || '',
                      }));
                    }}
                  >
                    <option value="">{t('admin.notSelected')}</option>
                    {form.departmentId == null &&
                    form.department &&
                    !departments.some((d) => d.name === form.department) ? (
                      <option value={`name:${form.department}`}>{form.department}</option>
                    ) : null}
                    {departments.map((d) => (
                      <option key={deptOptionValue(d)} value={deptOptionValue(d)}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="w-full rounded-xl border border-black/10 px-3 py-2 text-[14px]"
                    value={form.department}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        department: e.target.value,
                        departmentId: null,
                      }))
                    }
                  />
                )}
                <span className="block text-[11px] text-black/45">{t('admin.departmentFansHint')}</span>
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="text-[11px] font-semibold text-black/50">{t('admin.role')}</span>
                {editing ? (
                  <select
                    className="w-full rounded-xl border border-black/10 px-3 py-2 text-[14px]"
                    value={form.role}
                    onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as UserRole }))}
                  >
                    <option value="hodim">{roleLabel(language, 'hodim')}</option>
                    <option value="admin">{roleLabel(language, 'admin')}</option>
                  </select>
                ) : (
                  <input
                    className="w-full rounded-xl border border-black/10 bg-black/[0.03] px-3 py-2 text-[14px] text-black/80"
                    value={roleLabel(language, 'hodim')}
                    readOnly
                    tabIndex={-1}
                  />
                )}
              </label>
              <div className="sm:col-span-2 flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-3 rounded-xl bg-indigo-600 text-white font-semibold disabled:opacity-50"
                >
                  {saving ? <Loader2 className="animate-spin inline" /> : editing ? t('admin.save') : t('admin.create')}
                </button>
                <button
                  type="button"
                  onClick={closeForm}
                  className="px-6 py-3 rounded-xl border border-black/10 font-semibold"
                >
                  {t('admin.cancel')}
                </button>
              </div>
            </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
