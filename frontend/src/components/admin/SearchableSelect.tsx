import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';

/**
 * `dot` — bitta holat chiroqchasi (yashil = bor, qizil = yo'q).
 * `dots` — bir nechta chiroqcha (masalan UZ / RU / EN uchun alohida);
 * `dotLabels` ular ustiga olib borilganda ko'rinadigan izoh.
 */
export type Option = {
  value: string;
  label: string;
  searchText?: string;
  dot?: DotTone;
  dots?: DotTone[];
  dotLabels?: string[];
};

export type DotTone = 'green' | 'amber' | 'red';

const DOT_CLASS: Record<DotTone, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-rose-500',
};

function DotRow({ o }: { o: Option }) {
  const list = o.dots ?? (o.dot ? [o.dot] : []);
  if (list.length === 0) return null;
  return (
    <span className="shrink-0 flex items-center gap-1" aria-hidden>
      {list.map((d, i) => (
        <span
          key={i}
          title={o.dotLabels?.[i]}
          className={`w-2.5 h-2.5 rounded-full ${DOT_CLASS[d]}`}
        />
      ))}
    </span>
  );
}

/** Yozib qidirish + tanlash (typeahead) — native select o'rniga. */
export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder,
  noMatchText,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  placeholder: string;
  noMatchText: string;
  disabled?: boolean;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = useMemo(
    () => options.find((o) => o.value === value) || null,
    [options, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    const parts = q.split(/\s+/).filter(Boolean);
    return options.filter((o) => {
      const hay = (o.searchText || o.label).toLowerCase();
      return parts.every((p) => hay.includes(p));
    });
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const displayValue = open ? query : selected?.label ?? '';

  return (
    <div className="relative" ref={rootRef}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          disabled={disabled}
          value={displayValue}
          placeholder={placeholder}
          onFocus={() => {
            setOpen(true);
            setQuery('');
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (value) onChange('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              setQuery('');
              inputRef.current?.blur();
            }
            if (e.key === 'Enter' && filtered.length === 1) {
              e.preventDefault();
              onChange(filtered[0].value);
              setOpen(false);
              setQuery('');
            }
            if (e.key === 'ArrowDown') {
              setOpen(true);
            }
          }}
          className={`w-full h-11 pr-16 rounded-xl border border-slate-200 bg-white text-[13px] disabled:bg-slate-50 ${
            !open && (selected?.dots?.length || selected?.dot)
              ? (selected?.dots?.length ?? 1) > 1
                ? 'pl-[4.25rem]'
                : 'pl-8'
              : 'pl-3'
          }`}
        />
        {selected && !open && (selected.dots?.length || selected.dot) ? (
          <span className="absolute left-3 top-1/2 -translate-y-1/2">
            <DotRow o={selected} />
          </span>
        ) : null}
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {value && !disabled ? (
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange('');
                setQuery('');
                setOpen(true);
                inputRef.current?.focus();
              }}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Clear"
            >
              <X size={14} />
            </button>
          ) : null}
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onMouseDown={(e) => {
              e.preventDefault();
              if (disabled) return;
              setOpen((v) => !v);
              setQuery('');
              inputRef.current?.focus();
            }}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
            aria-label="Toggle"
          >
            <ChevronDown size={16} className={open ? 'rotate-180 transition' : 'transition'} />
          </button>
        </div>
      </div>

      {open && !disabled && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-40 mt-1 w-full max-h-72 overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg text-[13px]"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2.5 text-slate-400">{noMatchText}</li>
          ) : (
            filtered.map((o) => (
              <li key={o.value} role="option" aria-selected={o.value === value}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange(o.value);
                    setOpen(false);
                    setQuery('');
                  }}
                  className={`w-full text-left px-3 py-2.5 hover:bg-indigo-50 flex items-center gap-2 ${
                    o.value === value ? 'bg-indigo-50 font-semibold text-indigo-700' : 'text-slate-700'
                  }`}
                >
                  <DotRow o={o} />
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
