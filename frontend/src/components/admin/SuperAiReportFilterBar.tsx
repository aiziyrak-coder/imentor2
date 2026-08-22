import {
  Filter,
  Search,
  X,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { useUiText } from '../../i18n/useUiText';
import {
  DEFAULT_TEACHER_FILTERS,
  type TeacherFilterState,
  type TeacherSortKey,
  activeFilterCount,
} from '../../utils/superAiReportFilters';

export type ReportFacets = {
  departments: Array<{ name: string; count: number }>;
  tiers: Record<string, number>;
  flags: Record<string, number>;
};

type Props = {
  filters: TeacherFilterState;
  onChange: (next: TeacherFilterState) => void;
  facets: ReportFacets | null;
  total: number;
  filteredTotal: number;
  loading?: boolean;
};

const TIER_KEYS = ['inactive', 'low', 'sufficient', 'active'] as const;
const FLAG_KEYS = ['no_cases', 'no_tests', 'no_live_tests', 'inactive'] as const;

const SORT_KEYS: TeacherSortKey[] = [
  'minutes_desc',
  'minutes_asc',
  'name',
  'geofence_asc',
  'alerts_desc',
  'risk_desc',
];

function toggleList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

export default function SuperAiReportFilterBar({
  filters,
  onChange,
  facets,
  total,
  filteredTotal,
  loading,
}: Props) {
  const { t } = useUiText();
  const active = activeFilterCount(filters);

  const set = (patch: Partial<TeacherFilterState>) => onChange({ ...filters, ...patch });

  const presets: Array<{ id: string; label: string; apply: () => void }> = [
    {
      id: 'risk',
      label: t('admin.superAi.presetRisk'),
      apply: () =>
        set({
          ...DEFAULT_TEACHER_FILTERS,
          riskOnly: true,
          sort: 'risk_desc',
        }),
    },
    {
      id: 'inactive',
      label: t('admin.superAi.presetInactive'),
      apply: () => set({ tiers: ['inactive'], flags: [], riskOnly: false, minGeofence: null }),
    },
    {
      id: 'no_content',
      label: t('admin.superAi.presetNoContent'),
      apply: () => set({ flags: ['no_cases', 'no_tests'], tiers: [], riskOnly: false }),
    },
    {
      id: 'gps',
      label: t('admin.superAi.presetGps'),
      apply: () => set({ minGeofence: 50, sort: 'geofence_asc', riskOnly: false }),
    },
    {
      id: 'top',
      label: t('admin.superAi.presetTop'),
      apply: () =>
        set({
          ...DEFAULT_TEACHER_FILTERS,
          tiers: ['active'],
          sort: 'minutes_desc',
        }),
    },
  ];

  return (
    <div className="ios-glass rounded-2xl border border-white/60 p-4 space-y-3">
      <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
        <div className="relative flex-1 min-w-0">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/35" />
          <input
            value={filters.smartQuery}
            onChange={(e) => set({ smartQuery: e.target.value })}
            placeholder={t('admin.superAi.smartSearchPlaceholder')}
            className="w-full rounded-xl border border-black/10 bg-white/90 pl-9 pr-9 py-2.5 text-[13px] font-medium"
          />
          {filters.smartQuery && (
            <button
              type="button"
              onClick={() => set({ smartQuery: '' })}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-lg hover:bg-black/5"
              aria-label={t('admin.superAi.clearFilters')}
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <select
            value={filters.department}
            onChange={(e) => set({ department: e.target.value })}
            className="text-[12px] rounded-xl border border-black/10 bg-white/90 px-3 py-2 max-w-[200px]"
          >
            <option value="">{t('admin.superAi.allDepartments')}</option>
            {(facets?.departments ?? []).map((d) => (
              <option key={d.name} value={d.name === '—' ? '' : d.name}>
                {d.name} ({d.count})
              </option>
            ))}
          </select>
          <select
            value={filters.sort}
            onChange={(e) => set({ sort: e.target.value as TeacherSortKey })}
            className="text-[12px] rounded-xl border border-black/10 bg-white/90 px-3 py-2"
          >
            {SORT_KEYS.map((k) => (
              <option key={k} value={k}>
                {t(`admin.superAi.sort.${k}` as 'admin.superAi.sort.minutes_desc')}
              </option>
            ))}
          </select>
          {active > 0 && (
            <button
              type="button"
              onClick={() => onChange({ ...DEFAULT_TEACHER_FILTERS })}
              className="inline-flex items-center gap-1 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 px-2.5 py-2 text-[11px] font-bold"
            >
              <X size={12} />
              {t('admin.superAi.clearFilters')} ({active})
            </button>
          )}
        </div>
      </div>

      <p className="text-[11px] text-black/45 flex items-start gap-1.5">
        <Sparkles size={12} className="shrink-0 mt-0.5 text-violet-500" />
        {t('admin.superAi.smartSearchHint')}
      </p>

      <div className="flex flex-wrap gap-1.5">
        <span className="text-[10px] font-bold uppercase text-black/40 py-1.5 pr-1 flex items-center gap-1">
          <SlidersHorizontal size={11} />
          {t('admin.superAi.presets')}
        </span>
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={p.apply}
            className="rounded-full bg-violet-50 text-violet-800 border border-violet-200/80 px-2.5 py-1 text-[11px] font-semibold hover:bg-violet-100 transition-colors"
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 pt-1 border-t border-black/5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase text-black/40 mr-1">{t('admin.superAi.colTier')}</span>
          {TIER_KEYS.map((tier) => {
            const on = filters.tiers.includes(tier);
            const count = facets?.tiers?.[tier] ?? 0;
            return (
              <button
                key={tier}
                type="button"
                onClick={() => set({ tiers: toggleList(filters.tiers, tier) })}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border transition-colors ${
                  on
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white/70 text-black/65 border-black/10 hover:border-indigo-300'
                }`}
              >
                {t(`admin.superAi.tier.${tier}` as 'admin.superAi.tier.inactive')} ({count})
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase text-black/40 mr-1">{t('admin.superAi.colFlags')}</span>
          {FLAG_KEYS.map((flag) => {
            const on = filters.flags.includes(flag);
            const count = facets?.flags?.[flag] ?? 0;
            if (!count && !on) return null;
            return (
              <button
                key={flag}
                type="button"
                onClick={() => set({ flags: toggleList(filters.flags, flag) })}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border transition-colors ${
                  on
                    ? 'bg-amber-600 text-white border-amber-600'
                    : 'bg-white/70 text-black/65 border-black/10 hover:border-amber-300'
                }`}
              >
                {t(`admin.superAi.flag.${flag}` as 'admin.superAi.flag.no_cases')} ({count})
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => set({ riskOnly: !filters.riskOnly, sort: filters.riskOnly ? filters.sort : 'risk_desc' })}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border transition-colors ${
              filters.riskOnly
                ? 'bg-rose-600 text-white border-rose-600'
                : 'bg-white/70 text-black/65 border-black/10 hover:border-rose-300'
            }`}
          >
            {t('admin.superAi.presetRisk')}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between text-[12px] text-black/50 pt-1">
        <span className="inline-flex items-center gap-1.5">
          <Filter size={13} />
          {loading ? t('admin.superAi.filtering') : t('admin.superAi.filterResult', { shown: filteredTotal, total })}
        </span>
      </div>
    </div>
  );
}
