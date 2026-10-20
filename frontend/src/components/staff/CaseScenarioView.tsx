import React from 'react';
import type { AppLanguage } from '../../i18n/language';
import type { CaseStudyFocus } from '../../utils/generationVariety';
import { isPatientFree, type SubjectDomain } from '../../utils/subjectDomain';
import { parseCaseScenario } from '../../utils/parseCaseScenario';
import { renderBold, stripBold } from '../../utils/boldMarkers';
import { useUiText } from '../../i18n/useUiText';
import type { UiTextKey } from '../../i18n/translations';

type Props = {
  text: string;
  language?: AppLanguage;
  focus?: CaseStudyFocus;
  domain?: SubjectDomain;
  className?: string;
};

const TASK_KEY: Record<CaseStudyFocus, UiTextKey> = {
  tashxis: 'case.taskTashxis',
  davolash: 'case.taskDavolash',
  profilaktika: 'case.taskProfilaktika',
};

const TASK_KEY_ACADEMIC: Record<CaseStudyFocus, UiTextKey> = {
  tashxis: 'case.taskTashxisAcademic',
  davolash: 'case.taskDavolashAcademic',
  profilaktika: 'case.taskProfilaktikaAcademic',
};

const TASK_TITLE_RE = /^(topshiriq|задание|task)$/i;

/** Klinik keys — kasalxona kartasi: sarlavha + matn, qalin devor emas. */
export default function CaseScenarioView({
  text,
  language = 'uz',
  focus,
  domain = 'clinical',
  className = '',
}: Props) {
  const { t } = useUiText();
  const blocks = parseCaseScenario(text, language);
  const keys = isPatientFree(domain) ? TASK_KEY_ACADEMIC : TASK_KEY;
  // 2026-10-20 dan keys o'zining aniq "Topshiriq" bo'limi bilan keladi —
  // unda fokusga bog'langan umumiy savol takror ko'rsatilmaydi.
  const hasOwnTask = blocks.some((b) => TASK_TITLE_RE.test(stripBold(b.title)));
  const task = focus && !hasOwnTask ? t(keys[focus]) : '';
  const taskLabel = t('case.taskLabel');

  if (blocks.length === 1 && !blocks[0].title) {
    return (
      <div className={className}>
        <p className="text-[15px] leading-[1.7] text-[#083047]/90 whitespace-pre-wrap">
          {renderBold(blocks[0].body)}
        </p>
        {task ? <TaskBanner label={taskLabel} text={task} /> : null}
      </div>
    );
  }

  return (
    <div className={className}>
      <dl className="divide-y divide-slate-200/80 border border-slate-200/90 rounded-2xl overflow-hidden bg-white/80">
        {blocks.map((block) => (
          <div
            key={block.id}
            className="grid grid-cols-1 sm:grid-cols-[8.5rem_1fr] gap-1 sm:gap-4 px-4 py-3 sm:px-5 sm:py-3.5"
          >
            <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500 pt-0.5">
              {stripBold(block.title)}
            </dt>
            <dd className="text-[14.5px] sm:text-[15px] leading-[1.65] text-[#083047]/90 font-normal whitespace-pre-wrap">
              {/* Klinik fikrlash uchun muhim joylar qalin: AI ularni `**...**`
                  bilan belgilaydi, bu yer esa yulduzchalarni ko'rsatmaydi. */}
              {renderBold(block.body, block.id)}
            </dd>
          </div>
        ))}
      </dl>
      {task ? <TaskBanner label={taskLabel} text={task} /> : null}
    </div>
  );
}

function TaskBanner({ label, text }: { label: string; text: string }) {
  return (
    <p className="mt-3 px-4 py-2.5 rounded-xl border border-indigo-200/80 bg-indigo-50/70 text-[13.5px] leading-snug text-indigo-950">
      <span className="font-bold uppercase tracking-wide text-[11px] text-indigo-700 mr-2">{label}</span>
      {text}
    </p>
  );
}
