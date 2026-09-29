import { useState } from 'react';
import { Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { HttpError } from '../../api/httpClient';
import { inferPdfLanguage, type AppLanguage } from '../../i18n/language';
import { useUiText } from '../../i18n/useUiText';
import type { SyllabusTopic } from '../../services/aiService';
import { parseSyllabusExcel } from '../../utils/syllabusExcelParse';
import {
  createOwnSyllabus,
  updateOwnSyllabus,
  type CourseSyllabusRow,
  type OwnSyllabusUpdateStats,
} from '../../utils/syllabusApi';
import { readXlsxRows } from '../../utils/xlsxRows';
import { readDocxSyllabus } from '../../utils/docxSyllabus';
import { subjectNameFromRows } from '../../utils/ownSubjectTemplate';
import { isInternationalSyllabus } from '../../utils/syllabusInstructionLanguage';
import { staffBtnPrimary, staffInput, staffLabel } from './staffUi';

const INTL_MARK = /\s*\((xorijiy|xalqaro|international)[^)]*\)/gi;

/** Guruh tanlovi nomdagi "(Xalqaro)" belgisi orqali saqlanadi — fanlar ro'yxati shu bo'yicha ajratadi. */
function nameForScope(raw: string, intl: boolean): string {
  const base = raw.replace(INTL_MARK, '').replace(/\s+/g, ' ').trim();
  return intl ? `${base} (Xalqaro)` : base;
}

/** Namuna fayl `public/` dan beriladi — o'qituvchi uni to'ldirib qaytaradi. */
export const OWN_SUBJECT_TEMPLATE_URL = '/namuna-fan-mavzulari.xlsx';

const TYPE_ORDER = ['lecture', 'practical', 'clinical', 'independent', 'lab'] as const;

/**
 * O'qituvchi bu yilgi mavzular ro'yxatini Excel'da o'zi yuklaydi.
 *
 * Katalogdagi sillabuslar o'tgan yilniki bo'lib, bu yilgisidan farq qiladi.
 * Fayl brauzerda o'qiladi (mavjud `parseSyllabusExcel`), o'qituvchi nechta
 * mavzu topilganini va fan nomini ko'rib tasdiqlaydi, server esa fanni faqat
 * shu o'qituvchiga ko'rinadigan qilib yaratadi va ro'yxatiga qo'shadi.
 */
export default function OwnSubjectUpload({
  onCreated,
  editing,
  onUpdated,
}: {
  onCreated?: (syllabusId: number) => void;
  /** Berilsa — tahrirlash rejimi: nom/til o'zgartiriladi, Excel ixtiyoriy. */
  editing?: CourseSyllabusRow;
  onUpdated?: (stats: OwnSyllabusUpdateStats) => void;
}) {
  const { t } = useUiText();
  const [fileName, setFileName] = useState('');
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [topics, setTopics] = useState<SyllabusTopic[]>([]);
  const [name, setName] = useState(editing?.subject_name ?? '');
  const [lang, setLang] = useState<AppLanguage>((editing?.instruction_language as AppLanguage) || 'uz');
  const [intl, setIntl] = useState(() => (editing ? isInternationalSyllabus(editing) : false));

  const onFile = async (file: File) => {
    setError(null);
    setNotice(null);
    setTopics([]);
    setFileName(file.name);
    setParsing(true);
    try {
      // Word ishchi dastur / kalendar reja — Excel'ga ko'chirmasdan o'qiladi.
      if (/\.docx$/i.test(file.name)) {
        const doc = await readDocxSyllabus(await file.arrayBuffer(), file.name);
        if (!doc.topics.length) {
          setError(t('ownSubjects.errorNoTopicsDocx'));
          return;
        }
        setTopics(doc.topics);
        if (doc.otherLanguageDropped) {
          setNotice(t('ownSubjects.otherLanguageDropped', { count: String(doc.otherLanguageDropped) }));
        }
        if (!editing) {
          setName(doc.subjectName);
          if (isInternationalSyllabus({ subject_name: doc.subjectName, direction_code: '' })) setIntl(true);
          setLang(inferPdfLanguage(doc.topics.map((x) => x.title).join('\n')));
        }
        return;
      }
      const rows = await readXlsxRows(await file.arrayBuffer());
      const parsed = parseSyllabusExcel(rows, file.name);
      if (!parsed.topics.length) {
        setError(t('ownSubjects.errorNoTopics'));
        return;
      }
      setTopics(parsed.topics);
      // Tahrirlashda o'qituvchi yozgan nom va til saqlanadi.
      if (!editing) {
        const fromFile = subjectNameFromRows(rows, file.name);
        setName(fromFile);
        if (isInternationalSyllabus({ subject_name: fromFile, direction_code: '' })) setIntl(true);
        setLang(inferPdfLanguage(parsed.topics.map((x) => x.title).join('\n')));
      }
    } catch {
      setError(t('ownSubjects.errorRead'));
    } finally {
      setParsing(false);
    }
  };

  const save = async () => {
    if (name.trim().length < 2) return;
    if (editing) {
      setSaving(true);
      setError(null);
      try {
        const res = await updateOwnSyllabus(editing.id, {
          subjectName: nameForScope(name, intl),
          instructionLanguage: lang,
          ...(topics.length
            ? { fileName, topics: topics.map((x) => ({ title: x.title, type: x.type || 'lecture' })) }
            : {}),
        });
        window.dispatchEvent(new CustomEvent('imentor:teaching-subjects-changed'));
        onUpdated?.(res.stats || {});
      } catch (err) {
        const detail = err instanceof HttpError ? (err.body as { detail?: unknown } | null)?.detail : null;
        setError(typeof detail === 'string' && detail ? detail : t('ownSubjects.errorSave'));
      } finally {
        setSaving(false);
      }
      return;
    }
    if (!topics.length) return;
    setSaving(true);
    setError(null);
    try {
      const row = await createOwnSyllabus({
        subjectName: nameForScope(name, intl),
        fileName,
        instructionLanguage: lang,
        topics: topics.map((x) => ({ title: x.title, type: x.type || 'lecture' })),
      });
      window.dispatchEvent(new CustomEvent('imentor:teaching-subjects-changed'));
      onCreated?.(row.syllabus.id);
    } catch (err) {
      const detail = err instanceof HttpError ? (err.body as { detail?: unknown } | null)?.detail : null;
      setError(typeof detail === 'string' && detail ? detail : t('ownSubjects.errorSave'));
    } finally {
      setSaving(false);
    }
  };

  const counts = TYPE_ORDER.map((type) => ({
    type,
    n: topics.filter((x) => x.type === type).length,
  })).filter((c) => c.n > 0);
  const typeLabel: Record<(typeof TYPE_ORDER)[number], string> = {
    lecture: t('syllabus.lectures'),
    practical: t('syllabus.practicals'),
    clinical: t('syllabus.clinicals'),
    independent: t('syllabus.independents'),
    lab: t('syllabus.labs'),
  };

  const nameAndLang = (
    <div className="space-y-3">
    <div className="space-y-1">
      <span className={staffLabel}>Guruh turi</span>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 sm:max-w-md" role="radiogroup">
        {([
          [false, 'O‘zbek guruhlari'],
          [true, 'Xalqaro (xorijiy)'],
        ] as const).map(([value, label]) => (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={intl === value}
            onClick={() => {
              setIntl(value);
              setName((prev) => nameForScope(prev, value));
              if (value && lang === 'uz') setLang('en');
            }}
            className={`rounded-lg px-2 py-2 text-[13px] font-semibold transition ${
              intl === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
    <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
      <label className="block space-y-1">
        <span className={staffLabel}>{t('ownSubjects.nameLabel')}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={255} className={staffInput} />
      </label>
      <label className="block space-y-1">
        <span className={staffLabel}>{t('ownSubjects.langLabel')}</span>
        <select value={lang} onChange={(e) => setLang(e.target.value as AppLanguage)} className={staffInput}>
          <option value="uz">O‘zbekcha</option>
          <option value="ru">Русский</option>
          <option value="en">English</option>
        </select>
      </label>
    </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {editing && (
        <section className="space-y-3">
          {nameAndLang}
          <p className="text-[12.5px] leading-relaxed text-slate-500">{t('ownSubjects.editHint')}</p>
        </section>
      )}
      <section className="space-y-2">
        <p className="text-[13px] font-semibold text-slate-800">{t('ownSubjects.templateTitle')}</p>
        <p className="text-[12.5px] leading-relaxed text-slate-500">{t('ownSubjects.templateHint')}</p>
        <a
          href={OWN_SUBJECT_TEMPLATE_URL}
          download="namuna-fan-mavzulari.xlsx"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Download size={15} />
          {t('ownSubjects.downloadTemplate')}
        </a>
      </section>

      <section className="space-y-2">
        <p className="text-[13px] font-semibold text-slate-800">{t('ownSubjects.fileTitle')}</p>
        <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-[13px] text-slate-600 hover:bg-slate-100">
          {parsing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          <span className="min-w-0 truncate">
            {parsing ? t('ownSubjects.parsing') : fileName || t('ownSubjects.chooseFile')}
          </span>
          <input
            type="file"
            accept=".xlsx,.docx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void onFile(f);
            }}
          />
        </label>
      </section>

      {notice && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] font-medium text-amber-800">
          {notice}
        </p>
      )}

      {error && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] font-medium text-rose-700">
          {error}
        </p>
      )}

      {editing && topics.length === 0 && (
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || name.trim().length < 2}
          className={`${staffBtnPrimary} w-full justify-center disabled:opacity-50 sm:w-auto`}
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          {saving ? t('ownSubjects.saving') : t('ownSubjects.saveChanges')}
        </button>
      )}

      {topics.length > 0 && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-emerald-700">
            <FileSpreadsheet size={16} />
            {t('ownSubjects.previewCount', { count: String(topics.length) })}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {counts.map((c) => (
              <span key={c.type} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11.5px] font-medium text-slate-600">
                {typeLabel[c.type]}: {c.n}
              </span>
            ))}
          </div>
          <ol className="max-h-40 space-y-0.5 overflow-y-auto text-[12px] text-slate-600">
            {topics.slice(0, 60).map((x) => (
              <li key={`${x.id}-${x.title}`} className="truncate">
                <span className="mr-1.5 font-mono text-slate-400">{x.id}</span>
                {x.title}
              </li>
            ))}
          </ol>
          {!editing && nameAndLang}
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || name.trim().length < 2}
            className={`${staffBtnPrimary} w-full justify-center disabled:opacity-50 sm:w-auto`}
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {saving ? t('ownSubjects.saving') : editing ? t('ownSubjects.saveChanges') : t('ownSubjects.save')}
          </button>
          <p className="text-[11.5px] text-slate-400">{t('ownSubjects.privateNote')}</p>
        </section>
      )}
    </div>
  );
}
