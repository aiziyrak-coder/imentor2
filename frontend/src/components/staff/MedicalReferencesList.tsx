import { BookOpen, ExternalLink } from 'lucide-react';
import type { MedicalReference } from '../../utils/medicalReferences';
import { useUiText } from '../../i18n/useUiText';

type Props = {
  references: MedicalReference[];
  title?: string;
  compact?: boolean;
  className?: string;
  anchorPrefix?: string;
};

type SourceKind = NonNullable<MedicalReference['kind']>;

function inferKind(ref: MedicalReference): SourceKind {
  if (ref.kind) return ref.kind;
  const host = (ref.url || '').toLowerCase();
  const pub = (ref.publisher || '').toLowerCase();
  if (!ref.url || pub.includes('darslik') || pub.includes('textbook')) return 'book';
  if (host.includes('pubmed') || host.includes('ncbi.nlm.nih')) return 'pubmed';
  if (host.includes('wikipedia')) return 'wikipedia';
  if (host.includes('doi.org') || pub.includes('scholar')) return 'scholar';
  return 'journal';
}

const KIND_LINK: Record<SourceKind, string> = {
  book: 'font-semibold text-emerald-800',
  pubmed: 'font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900',
  scholar: 'font-medium text-indigo-700 underline underline-offset-2 hover:text-indigo-900',
  journal: 'font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900',
  wikipedia: 'font-medium text-sky-700 underline underline-offset-2 hover:text-sky-900',
};

const KIND_BADGE: Record<SourceKind, string> = {
  book: 'bg-emerald-700 text-white',
  pubmed: 'bg-blue-600 text-white',
  scholar: 'bg-indigo-600 text-white',
  journal: 'bg-blue-600 text-white',
  wikipedia: 'bg-sky-600 text-white',
};

function kindLabel(
  kind: SourceKind,
  t: (key: 'staff.medical.sourceBook' | 'staff.medical.sourceJournal' | 'staff.medical.sourceWeb') => string,
): string {
  if (kind === 'book') return t('staff.medical.sourceBook');
  if (kind === 'wikipedia') return t('staff.medical.sourceWeb');
  return t('staff.medical.sourceJournal');
}

export default function MedicalReferencesList({
  references,
  title,
  compact = false,
  className = '',
  anchorPrefix,
}: Props) {
  const { t } = useUiText();
  if (!references?.length) return null;

  const displayTitle = title ?? t('staff.medical.referencesTitle');
  const useCiteIndex = references.some((r) => typeof r.citeIndex === 'number');

  return (
    <div className={`rounded-xl border border-slate-200 bg-white/90 ${compact ? 'p-3' : 'p-5'} ${className}`}>
      <h4
        className={`flex items-center gap-2 font-bold uppercase tracking-wide text-slate-700 ${compact ? 'text-[11px] mb-2' : 'text-[12px] mb-3'}`}
      >
        <BookOpen size={compact ? 14 : 16} className="shrink-0" />
        {displayTitle}
      </h4>
      <ol className={`space-y-2.5 ${useCiteIndex ? 'list-none' : 'list-decimal list-inside'} ${compact ? 'text-[12.5px]' : 'text-[13.5px]'}`}>
        {references.map((ref, idx) => {
          const cite = ref.citeIndex ?? idx + 1;
          const kind = inferKind(ref);
          const anchorId = anchorPrefix ? `${anchorPrefix}-${cite}` : undefined;
          const linkClass = KIND_LINK[kind];
          return (
            <li
              key={`${ref.url || ref.title}-${idx}`}
              id={anchorId}
              className={`${useCiteIndex ? 'flex gap-2' : ''} scroll-mt-20 leading-relaxed text-slate-800`}
            >
              {useCiteIndex ? (
                ref.url ? (
                  <a
                    href={ref.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`shrink-0 inline-flex items-center justify-center px-1.5 h-5 min-w-[1.5rem] rounded-md text-[11px] font-bold hover:opacity-90 no-underline ${KIND_BADGE[kind]}`}
                    title={`Manba [${cite}]`}
                  >
                    {cite}
                  </a>
                ) : (
                  <span className={`shrink-0 inline-flex items-center justify-center px-1.5 h-5 min-w-[1.5rem] rounded-md text-[11px] font-bold ${KIND_BADGE[kind]}`}>
                    {cite}
                  </span>
                )
              ) : null}
              <span className="min-w-0">
                <span className="mr-1.5 inline-block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  {kindLabel(kind, t)}
                </span>
                {ref.url ? (
                  <a href={ref.url} target="_blank" rel="noopener noreferrer" className={`${linkClass} inline-flex items-center gap-1 break-words`}>
                    {ref.title}
                    <ExternalLink size={12} className="shrink-0 opacity-70" />
                  </a>
                ) : (
                  <span className={KIND_LINK.book}>{ref.title}</span>
                )}
                <span className="text-slate-500">
                  {ref.pages ? ` — ${ref.pages}-bet` : ''}
                  {ref.authors ? ` — ${ref.authors}` : ''}
                  {ref.year ? ` (${ref.year})` : ''}
                  {ref.publisher && kind !== 'book' ? `. ${ref.publisher}` : ''}
                  {ref.publisher && kind === 'book' && !ref.pages ? `. ${ref.publisher}` : ''}
                </span>
                {ref.note ? <span className="block text-slate-500 mt-0.5 not-italic">{ref.note}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
