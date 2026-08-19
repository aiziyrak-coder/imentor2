import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BriefcaseMedical, Trash2, RefreshCw, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  deleteAdminCatalogItem,
  fetchAdminCatalogItemDetail,
  fetchAdminCatalogItems,
  type CatalogItemDetail,
  type CatalogItemSummary,
} from '../../utils/contentCatalogApi';
import type { CaseStudySession } from '../../services/aiService';
import { useUiText } from '../../i18n/useUiText';
import AdminSmartFilter from './AdminSmartFilter';

export default function AdminCasesLibrary() {
  const { t } = useUiText();
  const [rows, setRows] = useState<CatalogItemSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [detailById, setDetailById] = useState<Record<number, CatalogItemDetail>>({});
  const [detailLoading, setDetailLoading] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [fanFilter, setFanFilter] = useState('');
  const [variantFilter, setVariantFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchAdminCatalogItems({ kind: 'case' }));
    } catch {
      setRows([]);
      setError(t('admin.error.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleOpen = async (row: CatalogItemSummary) => {
    const next = openId === row.id ? null : row.id;
    setOpenId(next);
    if (next !== null && !detailById[next]) {
      setDetailLoading(next);
      const detail = await fetchAdminCatalogItemDetail(next);
      if (detail) setDetailById((prev) => ({ ...prev, [next]: detail }));
      setDetailLoading(null);
    }
  };

  const handleDelete = useCallback(
    async (id: number) => {
      if (!window.confirm(t('admin.deleteCaseConfirm'))) return;
      try {
        await deleteAdminCatalogItem(id);
        setOpenId((cur) => (cur === id ? null : cur));
        await load();
      } catch {
        setError(t('admin.error.deleteFailedGeneric'));
      }
    },
    [t, load],
  );

  const deptOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      const name = (r.department_name || '').trim();
      if (name) map.set(name, name);
    }
    return [...map.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const fanOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      if (deptFilter && (r.department_name || '').trim() !== deptFilter) continue;
      const code = r.subject_code?.trim() || r.subject_name?.trim();
      if (!code) continue;
      map.set(code, r.subject_name?.trim() || code);
    }
    return [...map.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows, deptFilter]);

  const variantOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const v = (r.variant_label || '').trim();
      if (v) set.add(v);
    }
    return [...set].sort().map((v) => ({ value: v, label: v }));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (deptFilter && (r.department_name || '').trim() !== deptFilter) return false;
      if (fanFilter && r.subject_code !== fanFilter && r.subject_name !== fanFilter) return false;
      if (variantFilter && (r.variant_label || '').trim() !== variantFilter) return false;
      if (q) {
        const hay = `${r.topic} ${r.author_display_name} ${r.subject_name} ${r.department_name || ''} ${r.variant_label} ${r.topic_code}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, deptFilter, fanFilter, variantFilter]);

  return (
    <div className="w-full space-y-6 pb-16 px-3 sm:px-5 lg:px-6 py-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center">
            <BriefcaseMedical size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-black/90">{t('admin.casesLibraryTitle')}</h1>
            <p className="text-[12px] text-black/50">{t('admin.casesLibrarySubtitle')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-black/10 bg-white text-[13px] font-semibold"
        >
          <RefreshCw size={16} /> {t('admin.refresh')}
        </button>
      </div>

      {error && <p className="text-[13px] text-rose-600 font-medium">{error}</p>}

      {!loading && rows.length > 0 && (
        <AdminSmartFilter
          search={search}
          onSearch={setSearch}
          searchPlaceholder={t('admin.casesSearchPlaceholder')}
          selects={[
            {
              id: 'dept',
              label: t('admin.filterByKafedra'),
              value: deptFilter,
              onChange: (v) => {
                setDeptFilter(v);
                setFanFilter('');
              },
              options: deptOptions,
              placeholder: t('admin.filterAllDepartments'),
            },
            {
              id: 'fan',
              label: t('admin.filterSubject'),
              value: fanFilter,
              onChange: setFanFilter,
              options: fanOptions,
              placeholder: t('admin.filterAllSubjects'),
            },
          ]}
          chips={
            variantOptions.length
              ? [
                  {
                    id: 'variant',
                    label: t('admin.filterVariant'),
                    value: variantFilter,
                    onChange: setVariantFilter,
                    options: [
                      { value: '', label: t('admin.filterAllVariants') },
                      ...variantOptions,
                    ],
                  },
                ]
              : []
          }
          resultText={t('admin.filterResultCases', { count: String(filtered.length) })}
          resetLabel={t('admin.clearFilters')}
          noMatchText={t('admin.noResults')}
          canReset={Boolean(search || deptFilter || fanFilter || variantFilter)}
          onReset={() => {
            setSearch('');
            setDeptFilter('');
            setFanFilter('');
            setVariantFilter('');
          }}
        />
      )}

      <div className="space-y-3">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="animate-spin text-indigo-600" size={40} />
          </div>
        ) : rows.length === 0 ? (
          <div className="ios-glass rounded-2xl border p-10 text-center text-black/45 text-[14px]">
            {t('admin.noRecordsYet', { action: t('admin.caseCreationAction') })}
          </div>
        ) : filtered.length === 0 ? (
          <div className="ios-glass rounded-2xl border p-10 text-center text-black/45 text-[14px]">
            {t('admin.noResults')}
          </div>
        ) : (
          filtered.map((row) => {
            const detail = detailById[row.id];
            const payload = detail?.payload as CaseStudySession | undefined;
            return (
              <div key={row.id} className="ios-glass rounded-2xl border border-white/60 overflow-hidden">
                <button
                  type="button"
                  onClick={() => void toggleOpen(row)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-black/[0.02]"
                >
                  <div>
                    <p className="font-semibold text-black/90">{row.topic}</p>
                    <p className="text-[12px] text-black/45 mt-0.5">
                      {row.author_display_name} · {row.subject_name} ·{' '}
                      {new Date(row.created_at).toLocaleString()} · {row.question_count}{' '}
                      {t('admin.caseRecordsPlural')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(row.id);
                      }}
                      className="p-2 rounded-xl text-rose-600 hover:bg-rose-500/10"
                      title={t('admin.delete')}
                    >
                      <Trash2 size={18} />
                    </button>
                    {openId === row.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                  </div>
                </button>
                <AnimatePresence>
                  {openId === row.id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="border-t border-black/5 bg-black/[0.02] px-4 py-3 text-[13px] text-black/80 space-y-4 max-h-[60vh] overflow-y-auto"
                    >
                      {detailLoading === row.id ? (
                        <div className="flex justify-center py-4">
                          <Loader2 className="animate-spin text-indigo-600" size={20} />
                        </div>
                      ) : (
                        payload?.questions.map((q, i) => (
                          <div key={i} className="space-y-2">
                            <p className="font-semibold text-emerald-800">{t('admin.caseNumber', { number: i + 1 })}</p>
                            <p className="whitespace-pre-wrap leading-relaxed">{q.scenario}</p>
                            <p className="text-[12px] text-black/55">
                              <span className="font-semibold">{t('admin.answer')}:</span> {q.answer.slice(0, 500)}
                              {q.answer.length > 500 ? '…' : ''}
                            </p>
                          </div>
                        ))
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
