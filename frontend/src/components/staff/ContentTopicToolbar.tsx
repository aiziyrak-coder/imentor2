import React, { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import type { PreparedContentSummary } from '../../utils/preparedContentStore';
import SavedWorkBanner from './SavedWorkBanner';
import SavedWorkList from './SavedWorkList';
import { useUiText } from '../../i18n/useUiText';
import StaffTopicHeader, { type StaffTopicInfo } from './StaffTopicHeader';
import { staffBtnPrimary, staffBtnSecondary, staffInput, staffLabel } from './staffUi';

type Props = {
  moduleLabel: string;
  topic: StaffTopicInfo | null;
  topicValue: string;
  onTopicChange: (value: string) => void;
  topicLabel: string;
  topicPlaceholder: string;
  createLabel: string;
  loading: boolean;
  onCreate: () => void;
  hint?: string;
  versions: PreparedContentSummary[];
  activeVersionId: string | null;
  onSelectVersion: (id: string) => void;
  onDeleteVersion?: (id: string) => void;
  versionsTitle?: string;
  /** Syllabus mavzusi bo'lsa — input yashirin, faqat chip header */
  lockTopicFromSyllabus?: boolean;
  extra?: React.ReactNode;
  /** Panelda allaqachon faol kontent ko'rsatilayotgan bo'lsa (masalan yangi yaratilgan test/QR),
   *  "Hali saqlangan variant yo'q" degan chalkashtiruvchi maslahat ko'rsatilmaydi —
   *  fon saqlash jarayoni tugamagan bo'lishi mumkin, lekin kontent allaqachon foydalanuvchiga ko'rinadi. */
  hasUnsavedActiveContent?: boolean;
};

export default function ContentTopicToolbar({
  moduleLabel,
  topic,
  topicValue,
  onTopicChange,
  topicLabel,
  topicPlaceholder,
  createLabel,
  loading,
  onCreate,
  hint,
  versions,
  activeVersionId,
  onSelectVersion,
  onDeleteVersion,
  versionsTitle,
  lockTopicFromSyllabus = false,
  hasUnsavedActiveContent = false,
  extra,
}: Props) {
  const { t } = useUiText();
  const resolvedVersionsTitle = versionsTitle ?? t('toolbar.saved');
  const [showVersions, setShowVersions] = useState(false);
  const showTopicInput = !lockTopicFromSyllabus || !topic;

  const createButton = (
    <button
      type="button"
      onClick={onCreate}
      disabled={loading || !topicValue.trim()}
      className={`${staffBtnPrimary} h-11 shrink-0`}
    >
      {loading ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
      {createLabel}
    </button>
  );

  return (
    <StaffTopicHeader moduleLabel={moduleLabel} topic={topic} hint={hint}>
      <div className="space-y-4 pt-1">
        {showTopicInput && (
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1 min-w-0 space-y-1.5">
              <label className={staffLabel}>{topicLabel}</label>
              <input
                type="text"
                value={topicValue}
                onChange={(e) => onTopicChange(e.target.value)}
                placeholder={topicPlaceholder}
                className={staffInput}
              />
            </div>
            {createButton}
          </div>
        )}

        {!showTopicInput && (
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            {createButton}
          </div>
        )}

        {extra}

        {/* Baza yopiq turadi (4 bo'limda bir xil): avval ingichka eslatma qatori
            ko'rinadi, "Baza" bosilganda saqlangan versiyalar ro'yxati ochiladi. */}
        {versions.length > 0 && !showVersions && (
          <SavedWorkBanner count={versions.length} onOpen={() => setShowVersions(true)} />
        )}

        {versions.length > 0 && showVersions && (
          <div className="space-y-2 pt-1 border-t border-black/5">
            <div className="flex items-center justify-between gap-2">
              <p className={staffLabel}>
                {resolvedVersionsTitle} ({versions.length})
              </p>
              <button
                type="button"
                onClick={() => setShowVersions(false)}
                className="shrink-0 rounded-lg border border-black/10 bg-white/70 px-2.5 py-1 text-[12px] font-semibold text-black/60 hover:border-black/20"
              >
                {t('common.close')}
              </button>
            </div>
            <SavedWorkList
              items={versions}
              activeId={activeVersionId}
              onSelect={onSelectVersion}
              onDelete={onDeleteVersion}
            />
          </div>
        )}

        {!loading && versions.length === 0 && topicValue.trim() && !hasUnsavedActiveContent && (
          <p className="text-[12px] text-black/45">{t('toolbar.noVersions', { action: createLabel })}</p>
        )}
      </div>
    </StaffTopicHeader>
  );
}

/** Ichki sekundar tugmalar (PDF, yangilash) */
export function StaffToolbarActions({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

export function StaffToolbarButton({
  children,
  onClick,
  disabled,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  const cls = primary ? staffBtnPrimary : staffBtnSecondary;
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  );
}
