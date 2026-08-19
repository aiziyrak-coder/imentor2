import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  BriefcaseMedical,
  ClipboardList,
  Loader2,
  RefreshCw,
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  FileText,
  KeyRound,
  Download,
  Building2,
  X,
} from 'lucide-react';
import type { AppLanguage } from '../../i18n/language';
import { localeForLanguage } from '../../i18n/language';
import { translate } from '../../i18n/translations';
import { groupCatalogBySubject } from '../../utils/contentCatalogApi';
import { downloadCaseAnswerKeyPdf, downloadCaseScenariosPdf } from '../../utils/buildCasePdf';
import { downloadTestAnswerKeyPdf, downloadTestQuestionsPdf } from '../../utils/buildTestPdf';
import type { CatalogPdfMeta } from '../../utils/catalogPdfVerification';
import {
  fetchAllPublicCatalogItems,
  fetchPublicCatalogItemDetail,
  type PublicCatalogItemDetail,
  type PublicCatalogItemSummary,
} from '../../utils/publicContentCatalogApi';
import type { CaseStudySession, TestQuestion, TestSession } from '../../services/aiService';
import { caseFocusBadgeClass, caseFocusLabel } from '../../utils/caseFocusLabels';
import MedicalReferencesList from '../staff/MedicalReferencesList';
import CaseAnswerView from '../staff/CaseAnswerView';
import CaseScenarioView from '../staff/CaseScenarioView';
import ProtectedContentShell from './ProtectedContentShell';
import { stripOptionLetterPrefix } from '../../utils/testOptionText';

type KindFilter = '' | 'case' | 'test';

function t(lang: AppLanguage, key: Parameters<typeof translate>[1], params?: Record<string, string | number>) {
  return translate(lang, key, params);
}

/** Bir qatordagi filtr tugmalari. Kafedra/fan ko'p bo'lsa panel cho'zilib
 *  ketmasligi uchun boshida faqat bir qismi ko'rsatiladi — aks holda natijalar
 *  ekrandan pastga tushib ketadi va filtr "ishlamayotgandek" tuyuladi. */
function ChipRow({
  label,
  icon,
  groupLabel,
  chips,
  moreLabel,
  lessLabel,
  visibleLimit = 8,
}: {
  label: string;
  icon: React.ReactNode;
  groupLabel: string;
  chips: React.ReactNode[];
  moreLabel: (n: number) => string;
  lessLabel: string;
  visibleLimit?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const hidden = Math.max(0, chips.length - visibleLimit);
  const visible = showAll ? chips : chips.slice(0, visibleLimit);
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-bold uppercase tracking-wide text-black/40 flex items-center gap-1.5">
        {icon} {label}
      </p>
      <div role="group" aria-label={groupLabel} className="flex flex-wrap gap-2">
        {visible}
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="inline-flex items-center gap-1 px-3.5 py-2 rounded-xl text-[13px] font-semibold border border-dashed border-[#0c5a7e]/40 text-[#0c5a7e] bg-white hover:bg-[#0c5a7e]/5"
          >
            {showAll ? lessLabel : moreLabel(hidden)}
          </button>
        )}
      </div>
    </div>
  );
}

/** Bir bosishli filtr tugmasi — nomi + shu filtrdagi material soni. */
function FilterChip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-semibold border transition-colors ${
        active
          ? 'bg-[#0c5a7e] text-white border-[#0c5a7e] shadow-sm'
          : 'bg-white text-[#083047]/75 border-black/10 hover:border-[#0c5a7e]/30 hover:text-[#083047]'
      }`}
    >
      <span className="truncate max-w-[15rem]">{label}</span>
      <span
        className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md ${
          active ? 'bg-white/20 text-white' : 'bg-black/5 text-black/45'
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function PublicCatalogDetail({
  detail,
  language,
  onClose,
}: {
  detail: PublicCatalogItemDetail;
  language: AppLanguage;
  onClose: () => void;
}) {
  const locale = localeForLanguage(language);
  const [downloadingMain, setDownloadingMain] = useState(false);
  const [downloadingKey, setDownloadingKey] = useState(false);

  const pdfMeta: CatalogPdfMeta = {
    documentId: detail.document_id,
    verificationCode: detail.verification_code,
  };

  const handleDownloadMain = async () => {
    setDownloadingMain(true);
    try {
      if (detail.kind === 'case') {
        await downloadCaseScenariosPdf(detail.payload as CaseStudySession, language, pdfMeta);
      } else {
        await downloadTestQuestionsPdf(detail.payload as TestSession, language, pdfMeta);
      }
    } finally {
      setDownloadingMain(false);
    }
  };

  const handleDownloadKey = async () => {
    setDownloadingKey(true);
    try {
      if (detail.kind === 'case') {
        await downloadCaseAnswerKeyPdf(detail.payload as CaseStudySession, language, pdfMeta);
      } else {
        await downloadTestAnswerKeyPdf(detail.payload as TestSession, language, pdfMeta);
      }
    } finally {
      setDownloadingKey(false);
    }
  };

  const header = (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-5">
      <div className="min-w-0">
        <p
          className={`text-[11px] font-bold uppercase tracking-wide ${
            detail.kind === 'case' ? 'text-emerald-700' : 'text-indigo-700'
          }`}
        >
          {detail.kind === 'case' ? t(language, 'catalog.kindCase') : t(language, 'catalog.kindTest')}
        </p>
        <h2 className="text-xl font-bold text-black/90 mt-1">{detail.topic}</h2>
        <p className="text-[12px] text-black/45 mt-1">
          {detail.subject_name || t(language, 'catalog.otherTopics')} · {detail.author_display_name} ·{' '}
          {new Date(detail.created_at).toLocaleString(locale)}
        </p>
        {detail.document_id && (
          <p className="text-[10px] font-mono text-emerald-700/80 mt-1">{detail.document_id}</p>
        )}
      </div>
      <div className="flex flex-col items-stretch sm:items-end gap-2 shrink-0">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleDownloadMain()}
            disabled={downloadingMain || downloadingKey}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-[12px] font-semibold border disabled:opacity-50 ${
              detail.kind === 'case'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                : 'bg-indigo-50 text-indigo-800 border-indigo-200 hover:bg-indigo-100'
            }`}
          >
            {downloadingMain ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
            {detail.kind === 'case' ? t(language, 'case.downloadCasesPdf') : t(language, 'test.downloadTestPdf')}
          </button>
          <button
            type="button"
            onClick={() => void handleDownloadKey()}
            disabled={downloadingMain || downloadingKey}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-blue-50 text-blue-800 border border-blue-200 text-[12px] font-semibold hover:bg-blue-100 disabled:opacity-50"
          >
            {downloadingKey ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
            {detail.kind === 'case' ? t(language, 'case.downloadKeyPdf') : t(language, 'test.downloadKeyPdf')}
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[13px] font-semibold text-black/50 hover:text-black/80 text-right"
        >
          {t(language, 'catalog.close')}
        </button>
      </div>
    </div>
  );

  const downloadNote = (
    <p className="mb-4 flex items-start gap-2 rounded-xl border border-sky-200/80 bg-sky-50/80 px-3 py-2.5 text-[12px] text-sky-900/85">
      <Download size={14} className="shrink-0 mt-0.5" />
      {t(language, 'publicCatalog.downloadHint')}
    </p>
  );

  if (detail.kind === 'case') {
    const session = detail.payload as CaseStudySession;
    return (
      <div className="rounded-3xl border border-white/70 bg-white/90 backdrop-blur-xl shadow-2xl p-6 sm:p-7 lg:p-8">
        {header}
        {downloadNote}
        <ProtectedContentShell
          language={language}
          documentId={detail.document_id}
          verificationCode={detail.verification_code}
        >
          <div className="space-y-8">
            {session.questions.map((q, i) => (
              <div key={i} className="space-y-3 border-b border-black/5 pb-6 last:border-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-emerald-700">{i + 1}.</span>
                  {q.focus && (
                    <span
                      className={`px-2 py-0.5 rounded-lg border text-[10px] font-bold uppercase ${caseFocusBadgeClass(q.focus)}`}
                    >
                      {caseFocusLabel(q.focus, language)}
                    </span>
                  )}
                </div>
                <CaseScenarioView
                  text={q.scenario}
                  language={language}
                  focus={q.focus}
                  domain={session.domain}
                />
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-600 mb-2">{t(language, session.domain === 'academic' ? 'case.academicOpinion' : 'case.clinicalOpinion')}</p>
                  <CaseAnswerView text={q.answer} />
                </div>
                {q.references && q.references.length > 0 && (
                  <MedicalReferencesList references={q.references} title={t(language, 'catalog.references')} compact />
                )}
              </div>
            ))}
          </div>
        </ProtectedContentShell>
      </div>
    );
  }

  const session = detail.payload as TestSession;
  return (
    <div className="rounded-3xl border border-white/70 bg-white/90 backdrop-blur-xl shadow-2xl p-6 sm:p-7 lg:p-8">
      {header}
      {downloadNote}
      <ProtectedContentShell
        language={language}
        documentId={detail.document_id}
        verificationCode={detail.verification_code}
      >
        {session.references && session.references.length > 0 && (
          <MedicalReferencesList references={session.references} />
        )}
        <div className="space-y-8">
          {session.questions.map((q: TestQuestion, i: number) => (
            <div key={i} className="space-y-3 border-b border-black/5 pb-6 last:border-0">
              <p className="font-bold text-black/90 text-[15px] leading-relaxed">
                {i + 1}. {q.question}
              </p>
              <div className="space-y-1.5">
                {q.options.map((opt, optIdx) => (
                  <p
                    key={optIdx}
                    className={`text-[14px] px-3 py-2 rounded-lg border ${
                      optIdx === q.correctOptionIndex
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-900 font-semibold'
                        : 'bg-white border-black/10 text-black/75'
                    }`}
                  >
                    {String.fromCharCode(65 + optIdx)}) {stripOptionLetterPrefix(opt, optIdx)}
                  </p>
                ))}
              </div>
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                <p className="text-[11px] font-bold uppercase text-blue-800 mb-2">{t(language, 'catalog.explanation')}</p>
                <p className="text-[14px] text-blue-900/90 whitespace-pre-wrap">{q.explanation}</p>
              </div>
            </div>
          ))}
        </div>
      </ProtectedContentShell>
    </div>
  );
}

type Props = {
  language: AppLanguage;
  embedded?: boolean;
  compact?: boolean;
  expanded?: boolean;
  onExpandChange?: (expanded: boolean) => void;
  previewLimit?: number;
};

export default function PublicContentCatalog({
  language,
  embedded = false,
  compact = false,
  expanded: expandedProp,
  onExpandChange,
  previewLimit = 6,
}: Props) {
  const [expandedInternal, setExpandedInternal] = useState(false);
  const expanded = expandedProp ?? expandedInternal;
  const setExpanded = (v: boolean) => {
    setExpandedInternal(v);
    onExpandChange?.(v);
  };
  const [kindFilter, setKindFilter] = useState<KindFilter>('');
  const [subjectCode, setSubjectCode] = useState('');
  const [departmentCode, setDepartmentCode] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'subject' | 'topic' | 'newest'>('subject');
  const isCompactCollapsed = compact && !expanded;
  const [allItems, setAllItems] = useState<PublicCatalogItemSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<PublicCatalogItemDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const sectionRef = useRef<HTMLElement | null>(null);
  const [expandedSubject, setExpandedSubject] = useState<string | null>(null);
  const locale = localeForLanguage(language);

  // Butun katalog BIR MARTA olinadi, filtrlash esa brauzerda bo'ladi. Ilgari
  // har harf yozilganda yangi so'rov ketardi (sekin, "sakrab" turadigan
  // ro'yxat) va server faqat 1-sahifani (50 ta) qaytarardi — qolgan
  // materiallar talabaga umuman ko'rinmasdi.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAllItems(await fetchAllPublicCatalogItems());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const otherDepartmentLabel = t(language, 'catalog.otherDepartment');
  const departmentNameOf = useCallback(
    (row: PublicCatalogItemSummary) => (row.department_name || '').trim() || otherDepartmentLabel,
    [otherDepartmentLabel],
  );
  /** Kafedrasi yo'q yozuvlar ham bitta guruhga tushishi uchun barqaror kalit. */
  const departmentKeyOf = useCallback(
    (row: PublicCatalogItemSummary) => (row.department_code || '').trim() || `name:${departmentNameOf(row)}`,
    [departmentNameOf],
  );

  const matchesSearch = useCallback(
    (row: PublicCatalogItemSummary) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return [row.topic, row.subject_name, row.department_name, row.author_display_name]
        .some((v) => (v || '').toLowerCase().includes(q));
    },
    [search],
  );

  const matchesKind = useCallback(
    (row: PublicCatalogItemSummary) => !kindFilter || row.kind === kindFilter,
    [kindFilter],
  );

  const caseCount = useMemo(() => allItems.filter((i) => i.kind === 'case').length, [allItems]);
  const testCount = useMemo(() => allItems.filter((i) => i.kind === 'test').length, [allItems]);

  // Kafedra tugmalari — sanoq joriy tur/qidiruv doirasida hisoblanadi, ya'ni
  // "0 ta" chiqadigan tugma ko'rinmaydi.
  const departmentOptions = useMemo(() => {
    const map = new Map<string, { key: string; name: string; count: number }>();
    for (const row of allItems) {
      if (!matchesKind(row) || !matchesSearch(row)) continue;
      const key = departmentKeyOf(row);
      const entry = map.get(key) ?? { key, name: departmentNameOf(row), count: 0 };
      entry.count += 1;
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'uz'));
  }, [allItems, matchesKind, matchesSearch, departmentKeyOf, departmentNameOf]);

  const subjectOptions = useMemo(() => {
    const map = new Map<string, { code: string; name: string; count: number }>();
    for (const row of allItems) {
      if (!matchesKind(row) || !matchesSearch(row)) continue;
      if (departmentCode && departmentKeyOf(row) !== departmentCode) continue;
      const code = (row.subject_code || '').trim() || `name:${row.subject_name}`;
      const entry = map.get(code) ?? {
        code,
        name: (row.subject_name || '').trim() || t(language, 'catalog.otherTopics'),
        count: 0,
      };
      entry.count += 1;
      map.set(code, entry);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'uz'));
  }, [allItems, matchesKind, matchesSearch, departmentCode, departmentKeyOf, language]);

  const items = useMemo(() => {
    const rows = allItems.filter((row) => {
      if (!matchesKind(row) || !matchesSearch(row)) return false;
      if (departmentCode && departmentKeyOf(row) !== departmentCode) return false;
      if (subjectCode) {
        const code = (row.subject_code || '').trim() || `name:${row.subject_name}`;
        if (code !== subjectCode) return false;
      }
      return true;
    });
    if (sort === 'newest') {
      return rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    if (sort === 'topic') {
      return rows.sort((a, b) => a.topic.localeCompare(b.topic, 'uz'));
    }
    return rows.sort(
      (a, b) =>
        (a.subject_name || '').localeCompare(b.subject_name || '', 'uz') ||
        a.topic.localeCompare(b.topic, 'uz'),
    );
  }, [allItems, matchesKind, matchesSearch, departmentCode, subjectCode, departmentKeyOf, sort]);

  // Kafedra almashsa, boshqa kafedraning fani tanlangan bo'lib qolmasin.
  useEffect(() => {
    if (!subjectCode) return;
    if (subjectOptions.some((s) => s.code === subjectCode)) return;
    setSubjectCode('');
  }, [subjectCode, subjectOptions]);

  // Filtr paneli baland (qidiruv + 3 qator tugma) — chipni bosgach natijalar
  // ekrandan pastda qolib ketardi va foydalanuvchi "filtr ishlamayapti" deb
  // o'ylardi. Shuning uchun har filtrdan keyin ro'yxatga olib tushamiz.
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const applyFilter = useCallback((change: () => void) => {
    change();
    requestAnimationFrame(() => {
      const node = resultsRef.current;
      if (!node) return;
      const top = node.getBoundingClientRect().top + window.scrollY - 96;
      window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
    });
  }, []);

  const hasFilters = Boolean(kindFilter || departmentCode || subjectCode || search.trim());
  const clearFilters = () => {
    setKindFilter('');
    setDepartmentCode('');
    setSubjectCode('');
    setSearch('');
  };

  const grouped = useMemo(() => groupCatalogBySubject(items, language), [items, language]);
  const departmentBySubjectName = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of items) {
      const key = (row.subject_name || '').trim() || t(language, 'catalog.otherTopics');
      if (!map.has(key)) map.set(key, row.department_name || '');
    }
    return map;
  }, [items, language]);

  // Bo'lim boshiga qaytaramiz — sahifa tepasiga sakramasligi uchun.
  const scrollToSection = useCallback(() => {
    const node = sectionRef.current;
    if (!node) return;
    const top = node.getBoundingClientRect().top + window.scrollY - 88;
    window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
  }, []);

  const openDetail = async (id: number) => {
    setDetailLoading(true);
    setDetail(null);
    scrollToSection();
    try {
      const row = await fetchPublicCatalogItemDetail(id);
      setDetail(row);
    } finally {
      setDetailLoading(false);
    }
  };

  const previewItems = useMemo(
    () =>
      [...items]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, previewLimit),
    [items, previewLimit],
  );

  const renderItemRow = (row: PublicCatalogItemSummary, compactRow = false) => (
    <button
      key={row.id}
      type="button"
      onClick={() => void openDetail(row.id)}
      className={`w-full flex items-center gap-3 text-left rounded-2xl border border-black/[0.06] bg-white/70 hover:bg-[#083047]/[0.03] hover:border-[#083047]/10 transition-colors ${
        compactRow ? 'px-3 py-3' : 'px-4 sm:px-5 py-4 gap-4'
      }`}
    >
      <div
        className={`rounded-xl flex items-center justify-center shrink-0 ${
          compactRow ? 'w-9 h-9' : 'w-10 h-10'
        } ${row.kind === 'case' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-indigo-500/10 text-indigo-700'}`}
      >
        {row.kind === 'case' ? <BriefcaseMedical size={compactRow ? 16 : 18} /> : <ClipboardList size={compactRow ? 16 : 18} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`font-semibold text-black/90 truncate ${compactRow ? 'text-[13px]' : ''}`}>{row.topic}</p>
        <p className={`text-black/45 mt-0.5 truncate ${compactRow ? 'text-[11px]' : 'text-[12px]'}`}>
          {row.kind === 'case' ? t(language, 'catalog.kindCase') : t(language, 'catalog.kindTest')} ·{' '}
          {row.question_count} · {row.author_display_name}
        </p>
      </div>
      <span className={`inline-flex items-center gap-1 font-semibold text-indigo-600 shrink-0 ${compactRow ? 'text-[11px]' : 'text-[12px] gap-1.5 pl-2'}`}>
        <Eye size={compactRow ? 13 : 14} /> {t(language, 'catalog.view')}
      </span>
    </button>
  );

  return (
    <section
      id="public-catalog"
      ref={sectionRef}
      className={
        embedded
          ? compact
            ? 'space-y-4'
            : 'space-y-6 p-5 sm:p-7 lg:p-8'
          : 'w-full px-3 sm:px-5 lg:px-8 py-6 pb-20 space-y-6'
      }
    >
      {!isCompactCollapsed && (
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-600 via-teal-600 to-indigo-600 text-white flex items-center justify-center shrink-0 shadow-lg">
              <BookOpen size={26} />
            </div>
            <div>
              <h2 className="text-2xl sm:text-3xl font-black text-[#083047] tracking-tight">
                {t(language, 'publicCatalog.title')}
              </h2>
              <p className="text-[14px] text-[#0b425e]/70 mt-1 max-w-2xl leading-relaxed">
                {t(language, 'publicCatalog.subtitle')}
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">
                  <BriefcaseMedical size={12} /> {t(language, 'publicCatalog.caseCount', { count: caseCount })}
                </span>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-indigo-800 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-lg">
                  <ClipboardList size={12} /> {t(language, 'publicCatalog.testCount', { count: testCount })}
                </span>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg">
                  <Clock size={12} /> {t(language, 'catalog.delayNotice')}
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#0c5a7e]/20 bg-white/80 text-[13px] font-semibold shrink-0 shadow-sm hover:bg-white"
          >
            <RefreshCw size={16} /> {t(language, 'catalog.refresh')}
          </button>
        </div>
      )}

      {isCompactCollapsed && !detail && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">
            <BriefcaseMedical size={12} /> {t(language, 'publicCatalog.caseCount', { count: caseCount })}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-indigo-800 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-lg">
            <ClipboardList size={12} /> {t(language, 'publicCatalog.testCount', { count: testCount })}
          </span>
          <div className="flex flex-wrap gap-1.5 ml-auto">
            {(['', 'case', 'test'] as KindFilter[]).map((k) => (
              <button
                key={k || 'all'}
                type="button"
                onClick={() => setKindFilter(k)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
                  kindFilter === k
                    ? 'bg-[#083047] text-white border-[#083047]'
                    : 'bg-white text-[#083047]/80 border-black/10 hover:border-[#0c5a7e]/30'
                }`}
              >
                {k === '' ? t(language, 'catalog.filterAll') : k === 'case' ? t(language, 'catalog.kindCase') : t(language, 'catalog.kindTest')}
              </button>
            ))}
          </div>
        </div>
      )}

      {!isCompactCollapsed && (
      <div className="rounded-3xl border border-white/70 bg-white/75 backdrop-blur-xl p-5 sm:p-6 lg:p-7 space-y-5 shadow-lg">
        {/* Qidiruv — eng katta va birinchi element: talaba ko'pincha shundan boshlaydi. */}
        <div className="relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-black/30 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t(language, 'catalog.searchPlaceholder')}
            aria-label={t(language, 'catalog.filterSearch')}
            className="w-full pl-11 pr-11 py-3.5 rounded-2xl border border-black/10 bg-white text-[15px] shadow-sm focus:outline-none focus:ring-2 focus:ring-[#0c5a7e]/30"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label={t(language, 'catalog.clearFilters')}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-black/40 hover:bg-black/5"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2.5">
          {(['', 'case', 'test'] as KindFilter[]).map((k) => (
            <button
              key={k || 'all'}
              type="button"
              onClick={() => applyFilter(() => setKindFilter(k))}
              className={`px-4 py-2 rounded-xl text-[13px] font-semibold border transition-colors ${
                kindFilter === k
                  ? 'bg-[#083047] text-white border-[#083047]'
                  : 'bg-white text-[#083047]/80 border-black/10 hover:border-[#0c5a7e]/30'
              }`}
            >
              {k === '' ? t(language, 'catalog.filterAll') : k === 'case' ? t(language, 'catalog.kindCase') : t(language, 'catalog.kindTest')}
            </button>
          ))}
        </div>

        {/* Kafedra — bir bosishli tugmalar. Uzun `select` ro'yxatidan ko'ra
            talaba uchun tezroq: qaysi kafedrada nechta material borligi ham
            darrov ko'rinadi. */}
        <ChipRow
          label={t(language, 'catalog.stepDepartment')}
          icon={<Building2 size={12} />}
          groupLabel={t(language, 'catalog.filterDepartment')}
          moreLabel={(n) => t(language, 'catalog.showMore', { count: n })}
          lessLabel={t(language, 'catalog.showLess')}
          chips={[
            <FilterChip
              key="__all__"
              active={!departmentCode}
              label={t(language, 'catalog.allDepartments')}
              count={departmentOptions.reduce((n, d) => n + d.count, 0)}
              onClick={() => applyFilter(() => setDepartmentCode(''))}
            />,
            ...departmentOptions.map((d) => (
              <FilterChip
                key={d.key}
                active={departmentCode === d.key}
                label={d.name}
                count={d.count}
                onClick={() => applyFilter(() => setDepartmentCode((cur) => (cur === d.key ? '' : d.key)))}
              />
            )),
          ]}
        />

        <ChipRow
          label={t(language, 'catalog.stepSubject')}
          icon={<Filter size={12} />}
          groupLabel={t(language, 'catalog.filterSubject')}
          moreLabel={(n) => t(language, 'catalog.showMore', { count: n })}
          lessLabel={t(language, 'catalog.showLess')}
          chips={[
            <FilterChip
              key="__all__"
              active={!subjectCode}
              label={t(language, 'catalog.allSubjects')}
              count={subjectOptions.reduce((n, s) => n + s.count, 0)}
              onClick={() => applyFilter(() => setSubjectCode(''))}
            />,
            ...subjectOptions.map((s) => (
              <FilterChip
                key={s.code}
                active={subjectCode === s.code}
                label={s.name}
                count={s.count}
                onClick={() => applyFilter(() => setSubjectCode((cur) => (cur === s.code ? '' : s.code)))}
              />
            )),
          ]}
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-black/5">
          <p className="text-[13px] font-semibold text-[#083047] pt-3">
            {t(language, 'catalog.resultCount', { count: items.length })}
          </p>
          <div className="flex items-center gap-2 pt-3">
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-black/10 bg-white text-[12px] font-semibold text-black/60 hover:text-black/85 hover:border-black/20"
              >
                <X size={14} /> {t(language, 'catalog.clearFilters')}
              </button>
            )}
            <label className="inline-flex items-center gap-2">
              <span className="text-[12px] text-black/45">{t(language, 'catalog.filterSort')}</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
                className="px-3 py-2 rounded-xl border border-black/10 bg-white text-[12px]"
              >
                <option value="subject">{t(language, 'catalog.sortSubject')}</option>
                <option value="topic">{t(language, 'catalog.sortTopic')}</option>
                <option value="newest">{t(language, 'catalog.sortNewest')}</option>
              </select>
            </label>
          </div>
        </div>
      </div>
      )}

      {detailLoading && (
        <div className="flex justify-center py-8">
          <Loader2 className="animate-spin text-indigo-600" size={32} />
        </div>
      )}

      {detail && !detailLoading && (
        <PublicCatalogDetail
          detail={detail}
          language={language}
          onClose={() => {
            setDetail(null);
            scrollToSection();
          }}
        />
      )}

      <div ref={resultsRef} className="scroll-mt-24" />

      {!detail && loading && (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-indigo-600" size={36} />
        </div>
      )}

      {!detail && !loading && items.length === 0 && (
        <div className={`rounded-2xl border border-white/70 bg-white/70 text-center text-black/45 ${isCompactCollapsed ? 'p-8 text-[13px]' : 'p-12 text-[14px] rounded-3xl'}`}>
          {isCompactCollapsed ? (
            t(language, 'publicCatalog.previewEmpty')
          ) : hasFilters ? (
            // Baza bo'sh emas — shunchaki filtrga mos kelmadi. Talaba
            // "material yo'q" deb o'ylab ketmasligi uchun chiqish yo'lini ham beramiz.
            <div className="space-y-3">
              <p className="text-black/60 font-semibold">{t(language, 'catalog.noMatch')}</p>
              <p className="text-[13px]">{t(language, 'catalog.noMatchHint')}</p>
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#083047] text-white text-[13px] font-semibold hover:bg-[#0c5a7e]"
              >
                <X size={14} /> {t(language, 'catalog.clearFilters')}
              </button>
            </div>
          ) : (
            t(language, 'catalog.empty')
          )}
        </div>
      )}

      {!detail && !loading && items.length > 0 && isCompactCollapsed && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-2.5">
          {previewItems.map((row) => renderItemRow(row, true))}
        </div>
      )}

      {!detail && !loading && items.length > 0 && !isCompactCollapsed && (
        <div className="space-y-5">
          {[...grouped.entries()].map(([subjectName, rows]) => {
            const isOpen = expandedSubject === null || expandedSubject === subjectName;
            return (
              <div
                key={subjectName}
                className="rounded-3xl border border-white/70 bg-white/80 backdrop-blur-xl overflow-hidden shadow-md"
              >
                <button
                  type="button"
                  onClick={() => setExpandedSubject((s) => (s === subjectName ? null : subjectName))}
                  className="w-full flex items-center justify-between px-5 sm:px-6 lg:px-7 py-4 bg-gradient-to-r from-[#083047]/5 to-transparent hover:from-[#083047]/8"
                >
                  <div className="flex items-center gap-3 text-left min-w-0">
                    <BookOpen size={18} className="text-indigo-600 shrink-0" />
                    <div className="min-w-0">
                      <span className="font-bold text-[#083047] truncate block">{subjectName}</span>
                      {departmentBySubjectName.get(subjectName) && (
                        <span className="text-[11px] text-black/40 truncate block">
                          {departmentBySubjectName.get(subjectName)}
                        </span>
                      )}
                    </div>
                    <span className="text-[12px] text-black/40 shrink-0">({rows.length})</span>
                  </div>
                  {isOpen ? <ChevronUp size={18} className="shrink-0 ml-3" /> : <ChevronDown size={18} className="shrink-0 ml-3" />}
                </button>
                {isOpen && (
                  <div className="px-3 sm:px-4 pb-4 pt-1 space-y-2">
                    {(rows as PublicCatalogItemSummary[]).map((row) => renderItemRow(row))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
