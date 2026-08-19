import React from 'react';
import { BookOpen, Check, FlaskConical, Loader2, Microscope, NotebookPen, Stethoscope, X } from 'lucide-react';
import type { SyllabusTopic } from '../../services/aiService';
import type { AppLanguage } from '../../i18n/language';
import { instructionLanguageBadge } from '../../utils/syllabusInstructionLanguage';
import { countTopicsByType } from '../../utils/syllabusVariant';
import type { SyllabusVariant as VariantRow } from '../../utils/syllabusVariant';
import { formatTopicLessonLabel } from '../../utils/topicLessonLabel';
import { useUiText } from '../../i18n/useUiText';

export type SyllabusUploadPreviewData = {
  subjectName: string;
  description: string;
  instructionLanguage: AppLanguage;
  variants: Array<VariantRow & { editableLabel: string; directionCode?: string }>;
};

type Props = {
  data: SyllabusUploadPreviewData;
  saving: boolean;
  directionOptions?: string[];
  requireDirection?: boolean;
  onChange: (data: SyllabusUploadPreviewData) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function SyllabusUploadPreview({
  data,
  saving,
  directionOptions = [],
  requireDirection = false,
  onChange,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useUiText();

  const totalLectures = data.variants.reduce(
    (n, v) => n + countTopicsByType(v.topics).lectures,
    0,
  );
  const totalPracticals = data.variants.reduce(
    (n, v) => n + countTopicsByType(v.topics).practicals,
    0,
  );
  const totalIndependents = data.variants.reduce(
    (n, v) => n + countTopicsByType(v.topics).independents,
    0,
  );
  const totalLabs = data.variants.reduce(
    (n, v) => n + countTopicsByType(v.topics).labs,
    0,
  );
  const totalTopics = data.variants.reduce((n, v) => n + v.topics.length, 0);
  const missingDirection =
    requireDirection && data.variants.some((v) => !(v.directionCode || '').trim());

  const updateTopicTitle = (variantIndex: number, topicIndex: number, title: string) => {
    const variants = data.variants.map((v, i) => {
      if (i !== variantIndex) return v;
      const topics = v.topics.map((topic, ti) => (ti === topicIndex ? { ...topic, title } : topic));
      return { ...v, topics };
    });
    onChange({ ...data, variants });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/50">
      <div className="w-full sm:max-w-2xl max-h-[92vh] overflow-hidden bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col">
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900">{t('admin.previewTitle')}</h3>
            <p className="text-[12px] text-slate-500 mt-0.5 leading-relaxed">{t('admin.previewSubtitle')}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="p-2 rounded-lg text-slate-400 hover:bg-slate-100"
            aria-label={t('common.close')}
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <StatCard label={t('admin.previewTotal')} value={String(totalTopics)} />
            <StatCard label={t('admin.previewLecture')} value={String(totalLectures)} icon={<BookOpen size={14} />} />
            <StatCard label={t('admin.previewPractical')} value={String(totalPracticals)} icon={<FlaskConical size={14} />} />
            <StatCard label={t('admin.previewClinical')} value={String(totalClinicals)} icon={<Stethoscope size={14} />} />
            <StatCard label={t('admin.previewIndependent')} value={String(totalIndependents)} icon={<NotebookPen size={14} />} />
            <StatCard label={t('admin.previewLab')} value={String(totalLabs)} icon={<Microscope size={14} />} />
          </div>

          <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-[11px] text-indigo-900 leading-relaxed">
            {t('admin.previewInfo')}
          </div>

          {data.variants.map((variant, index) => {
            const counts = countTopicsByType(variant.topics);
            const lectures = variant.topics.filter((x) => x.type === 'lecture');
            const practicals = variant.topics.filter((x) => x.type === 'practical');
            const clinicals = variant.topics.filter((x) => x.type === 'clinical');
            const independents = variant.topics.filter((x) => x.type === 'independent');
            const labs = variant.topics.filter((x) => x.type === 'lab');
            return (
              <div
                key={`${variant.file_name}-${index}`}
                className="rounded-2xl border border-slate-200 overflow-hidden"
              >
                <div className="bg-slate-50 px-3 py-2 flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-semibold text-slate-800 truncate flex-1 min-w-0">
                    {variant.file_name}
                  </span>
                  {directionOptions.length > 0 ? (
                    <select
                      value={variant.directionCode || ''}
                      disabled={saving}
                      onChange={(e) => {
                        const variants = data.variants.map((v, i) =>
                          i === index ? { ...v, directionCode: e.target.value } : v,
                        );
                        onChange({ ...data, variants });
                      }}
                      className="h-7 max-w-[140px] px-1.5 rounded-lg border border-indigo-200 bg-white text-[11px] font-semibold text-indigo-800"
                      title={t('admin.syllabusPreview.direction')}
                    >
                      <option value="">{t('admin.selectVariantPlaceholder')}</option>
                      {directionOptions.map((code) => (
                        <option key={code} value={code}>{code}</option>
                      ))}
                    </select>
                  ) : null}
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white border border-slate-200">
                    {instructionLanguageBadge(data.instructionLanguage)}
                  </span>
                </div>
                <div className="px-3 py-2 text-[11px] text-slate-600 border-b border-slate-100">
                  {t('admin.previewTopicsLine', {
                    total: variant.topics.length,
                    lectures: counts.lectures,
                    practicals: counts.practicals,
                    clinicals: counts.clinicals,
                    independents: counts.independents,
                    labs: counts.labs,
                  })}
                </div>
                <div className="max-h-56 overflow-y-auto divide-y divide-slate-50">
                  {lectures.length > 0 && (
                    <TopicGroup
                      title={t('admin.lecturesSection')}
                      topics={lectures}
                      saving={saving}
                      onTitleChange={(topicId, title) => {
                        const ti = variant.topics.findIndex((x) => x.id === topicId && x.type === 'lecture');
                        if (ti >= 0) updateTopicTitle(index, ti, title);
                      }}
                    />
                  )}
                  {practicals.length > 0 && (
                    <TopicGroup
                      title={t('admin.practicalsSection')}
                      topics={practicals}
                      saving={saving}
                      onTitleChange={(topicId, title) => {
                        const ti = variant.topics.findIndex((x) => x.id === topicId && x.type === 'practical');
                        if (ti >= 0) updateTopicTitle(index, ti, title);
                      }}
                    />
                  )}
                  {clinicals.length > 0 && (
                    <TopicGroup
                      title={t('admin.clinicalsSection')}
                      topics={clinicals}
                      saving={saving}
                      onTitleChange={(topicId, title) => {
                        const ti = variant.topics.findIndex((x) => x.id === topicId && x.type === 'clinical');
                        if (ti >= 0) updateTopicTitle(index, ti, title);
                      }}
                    />
                  )}
                  {independents.length > 0 && (
                    <TopicGroup
                      title={t('admin.independentsSection')}
                      topics={independents}
                      saving={saving}
                      onTitleChange={(topicId, title) => {
                        const ti = variant.topics.findIndex((x) => x.id === topicId && x.type === 'independent');
                        if (ti >= 0) updateTopicTitle(index, ti, title);
                      }}
                    />
                  )}
                  {labs.length > 0 && (
                    <TopicGroup
                      title={t('admin.labsSection')}
                      topics={labs}
                      saving={saving}
                      onTitleChange={(topicId, title) => {
                        const ti = variant.topics.findIndex((x) => x.id === topicId && x.type === 'lab');
                        if (ti >= 0) updateTopicTitle(index, ti, title);
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-5 py-4 border-t border-slate-100 flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-[13px] font-semibold text-slate-700"
          >
            {t('admin.previewCancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving || totalTopics === 0 || missingDirection}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-[13px] font-semibold disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {t('admin.previewSave')}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-center">
      <p className="text-[10px] text-slate-500 flex items-center justify-center gap-1">
        {icon}
        {label}
      </p>
      <p className="text-lg font-bold text-slate-900">{value}</p>
    </div>
  );
}

function TopicGroup({
  title,
  topics,
  saving,
  onTitleChange,
}: {
  title: string;
  topics: SyllabusTopic[];
  saving: boolean;
  onTitleChange: (topicId: string, title: string) => void;
}) {
  const { t } = useUiText();
  return (
    <div className="px-3 py-2 space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{title}</p>
      {topics.map((topic) => {
        const chip =
          topic.type === 'lecture'
            ? 'bg-blue-50 text-blue-700'
            : topic.type === 'clinical'
              ? 'bg-teal-50 text-teal-700'
              : topic.type === 'independent'
                ? 'bg-amber-50 text-amber-800'
                : topic.type === 'lab'
                  ? 'bg-slate-100 text-slate-700'
                  : 'bg-violet-50 text-violet-700';
        return (
          <div key={`${topic.type}-${topic.id}`} className="flex items-start gap-2">
            <span
              className={`shrink-0 mt-1.5 font-bold px-1.5 py-0.5 rounded text-[10px] max-w-[11rem] leading-tight ${chip}`}
            >
              {formatTopicLessonLabel(topic.type, topic.id, t)}
            </span>
            <input
              value={topic.title}
              onChange={(e) => onTitleChange(topic.id, e.target.value)}
              disabled={saving}
              className="flex-1 min-w-0 h-8 px-2 rounded-lg border border-slate-200 text-[12px] text-slate-800"
              aria-label={title}
            />
          </div>
        );
      })}
    </div>
  );
}
