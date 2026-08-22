import type { AppLanguage } from '../i18n/language';
import { renderHtmlToPdf } from './htmlToPdf';
import { localeForLanguage } from '../i18n/language';
import { translate, type UiTextKey } from '../i18n/translations';
import type { CaseStudySession, MedicalReference } from '../services/aiService';
import { caseFocusLabel, sortCaseQuestionsByFocus } from './caseFocusLabels';
import { catalogPdfVerificationFooter, type CatalogPdfMeta } from './catalogPdfVerification';

function t(lang: AppLanguage, key: UiTextKey, params?: Record<string, string | number>): string {
  return translate(lang, key, params);
}

function slugifyTopic(topic: string): string {
  return topic.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 60) || 'Keys';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatReference(ref: MedicalReference): string {
  const parts = [ref.authors, ref.title, ref.year, ref.publisher].filter(Boolean);
  return parts.join(', ');
}

function referencesBlock(refs: MedicalReference[] | undefined, title: string): string {
  if (!refs?.length) return '';
  const items = refs
    .map((r) => `<li style="margin:4px 0;font-size:13px;color:#1e3a5f;">${escapeHtml(formatReference(r))}</li>`)
    .join('');
  return `
    <div data-pdf-block style="margin:16px 0;padding:12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;">
      <p data-pdf-keep-next style="margin:0 0 8px;font-size:12px;font-weight:700;color:#1d4ed8;text-transform:uppercase;">${escapeHtml(title)}</p>
      <ul style="margin:0;padding-left:18px;">${items}</ul>
    </div>
  `;
}

function keywordsBlock(keywords: string[] | undefined, lang: AppLanguage): string {
  if (!keywords?.length) return '';
  return `
    <p style="margin:0 0 24px;font-size:13px;color:#047857;background:#ecfdf5;border:1px solid #a7f3d0;padding:10px 12px;border-radius:8px;">
      <strong>${escapeHtml(t(lang, 'pdf.keywordsLabel'))}</strong> ${escapeHtml(keywords.join(', '))}
    </p>
  `;
}

function buildScenariosHtml(session: CaseStudySession, lang: AppLanguage, meta?: CatalogPdfMeta): string {
  const locale = localeForLanguage(lang);
  // Ekrandagi bilan bir xil ketma-ketlik: tashxis → davolash → profilaktika.
  const items = sortCaseQuestionsByFocus(session.questions)
    .map(
      (q, i) => `
        <div data-pdf-block style="margin-bottom:28px;">
          ${q.focus ? `<p data-pdf-keep-next style="margin:0 0 6px;font-size:11px;font-weight:700;color:#047857;text-transform:uppercase;">${escapeHtml(caseFocusLabel(q.focus, lang, session.domain))}</p>` : ''}
          <p style="margin:0 0 10px;font-size:15px;font-weight:700;color:#111827;line-height:1.6;white-space:pre-wrap;">
            ${i + 1}. ${escapeHtml(q.scenario || '')}
          </p>
        </div>
      `
    )
    .join('');

  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:32px;background:#fff;color:#111827;max-width:760px;">
      <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.08em;color:#059669;text-transform:uppercase;">${escapeHtml(t(lang, 'pdf.caseScenariosTitle'))}</p>
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:800;line-height:1.3;">${escapeHtml(session.topic)}</h1>
      <p style="margin:0 0 12px;font-size:13px;color:#6b7280;">${escapeHtml(t(lang, 'pdf.casesMeta', { count: session.questions.length }))} · ${new Date().toLocaleString(locale)}</p>
      ${keywordsBlock(session.keywords, lang)}
      ${referencesBlock(session.references, t(lang, 'pdf.commonReferences'))}
      ${items}
      ${catalogPdfVerificationFooter(meta, lang)}
    </div>
  `;
}

function buildAnswerKeyHtml(session: CaseStudySession, lang: AppLanguage, meta?: CatalogPdfMeta): string {
  const locale = localeForLanguage(lang);
  const items = sortCaseQuestionsByFocus(session.questions)
    .map((q, i) => {
      const refs = referencesBlock(q.references, t(lang, 'pdf.caseReferences'));
      return `
        <div data-pdf-block style="margin-bottom:32px;">
          ${q.focus ? `<p data-pdf-keep-next style="margin:0 0 6px;font-size:11px;font-weight:700;color:#1d4ed8;text-transform:uppercase;">${escapeHtml(caseFocusLabel(q.focus, lang, session.domain))}</p>` : ''}
          <p style="margin:0 0 10px;font-size:14px;font-weight:700;color:#374151;line-height:1.5;white-space:pre-wrap;">
            ${i + 1}. ${escapeHtml((q.scenario || '').slice(0, 180))}${(q.scenario || '').length > 180 ? '…' : ''}
          </p>
          <div style="margin-top:12px;padding:12px;background:#eff6ff;border-radius:8px;border-left:4px solid #3b82f6;">
            <p data-pdf-keep-next style="margin:0 0 6px;font-size:12px;font-weight:700;color:#1d4ed8;text-transform:uppercase;">${escapeHtml(t(lang, 'pdf.caseAnswerLabel'))}</p>
            <p style="margin:0;font-size:14px;color:#1e3a8a;line-height:1.6;white-space:pre-wrap;">${escapeHtml(q.answer || '')}</p>
          </div>
          ${refs}
        </div>
      `;
    })
    .join('');

  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:32px;background:#fff;color:#111827;max-width:760px;">
      <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.08em;color:#2563eb;text-transform:uppercase;">${escapeHtml(t(lang, 'pdf.caseAnswerKeyTitle'))}</p>
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:800;line-height:1.3;">${escapeHtml(session.topic)}</h1>
      <p style="margin:0 0 12px;font-size:13px;color:#6b7280;">${escapeHtml(t(lang, 'pdf.casesMeta', { count: session.questions.length }))} · ${new Date().toLocaleString(locale)}</p>
      ${keywordsBlock(session.keywords, lang)}
      ${items}
      ${catalogPdfVerificationFooter(meta, lang)}
    </div>
  `;
}

export async function downloadCaseScenariosPdf(
  session: CaseStudySession,
  lang: AppLanguage = 'uz',
  meta?: CatalogPdfMeta,
): Promise<void> {
  const slug = slugifyTopic(session.topic);
  await renderHtmlToPdf(buildScenariosHtml(session, lang, meta), t(lang, 'pdf.filenameCase', { slug }));
}

export async function downloadCaseAnswerKeyPdf(
  session: CaseStudySession,
  lang: AppLanguage = 'uz',
  meta?: CatalogPdfMeta,
): Promise<void> {
  const slug = slugifyTopic(session.topic);
  await renderHtmlToPdf(buildAnswerKeyHtml(session, lang, meta), t(lang, 'pdf.filenameCaseKey', { slug }));
}
