import { Search, SlidersHorizontal, X } from 'lucide-react';
import SearchableSelect, { type Option } from './SearchableSelect';

export type ChipOption = { value: string; label: string };

export function FilterChipGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ChipOption[];
}) {
  return (
    <div className="space-y-1.5 min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value || '__all__'}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`h-8 px-2.5 rounded-lg text-[12px] font-semibold transition-colors ${
                active
                  ? 'bg-[#083047] text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type SelectField = {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  placeholder: string;
  disabled?: boolean;
};

type Props = {
  search: string;
  onSearch: (v: string) => void;
  searchPlaceholder: string;
  selects?: SelectField[];
  chips?: Array<{
    id: string;
    label: string;
    value: string;
    onChange: (v: string) => void;
    options: ChipOption[];
  }>;
  resultText: string;
  resetLabel: string;
  noMatchText: string;
  onReset: () => void;
  canReset: boolean;
};

/** Kutubxona/ro'yxat tepasidagi qidiruv + filtrlash paneli. */
export default function AdminSmartFilter({
  search,
  onSearch,
  searchPlaceholder,
  selects = [],
  chips = [],
  resultText,
  resetLabel,
  noMatchText,
  onReset,
  canReset,
}: Props) {
  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white/90 shadow-sm p-4 sm:p-5 space-y-4">
      <div className="flex items-center gap-2 text-slate-800">
        <span className="w-8 h-8 rounded-xl bg-[#083047] text-white flex items-center justify-center shrink-0">
          <SlidersHorizontal size={15} />
        </span>
        <div className="min-w-0 flex-1 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full h-11 pl-10 pr-10 rounded-xl border border-slate-200 bg-white text-[13.5px] outline-none focus:border-[#083047]/40 focus:ring-2 focus:ring-[#083047]/10"
          />
          {search ? (
            <button
              type="button"
              onClick={() => onSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-700"
              aria-label="clear"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
        {canReset ? (
          <button
            type="button"
            onClick={onReset}
            className="shrink-0 h-11 px-3 rounded-xl border border-slate-200 bg-white text-[12px] font-semibold text-slate-600 hover:bg-slate-50"
          >
            {resetLabel}
          </button>
        ) : null}
      </div>

      {selects.length > 0 ? (
        <div className={`grid gap-3 ${selects.length === 1 ? 'sm:grid-cols-1' : 'sm:grid-cols-2'}`}>
          {selects.map((s) => (
            <div key={s.id} className="space-y-1.5 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{s.label}</p>
              <SearchableSelect
                value={s.value}
                onChange={s.onChange}
                options={s.options}
                placeholder={s.placeholder}
                noMatchText={noMatchText}
                disabled={s.disabled}
              />
            </div>
          ))}
        </div>
      ) : null}

      {chips.length > 0 ? (
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-4">
          {chips.map((c) => (
            <FilterChipGroup
              key={c.id}
              label={c.label}
              value={c.value}
              onChange={c.onChange}
              options={c.options}
            />
          ))}
        </div>
      ) : null}

      <p className="text-[12px] font-semibold text-slate-500 tabular-nums">{resultText}</p>
    </div>
  );
}
