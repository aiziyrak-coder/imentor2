import type { CSSProperties } from 'react';
import type { AppLanguage } from '../../i18n/language';
import {
  HANDOUT_POSTER_H,
  HANDOUT_POSTER_W,
  pickHandoutText,
  type HandoutInfographicPack,
  type HandoutSection,
} from '../../utils/handoutInfographic';
import HandoutMedicalArt from './HandoutMedicalArt';

const ACCENTS = ['#1d4ed8', '#b45309', '#be185d', '#7c3aed', '#0f766e', '#0369a1', '#c2410c', '#047857'];

function hexRgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function txt(packField: { uz: string; ru: string; en: string }, lang: AppLanguage): string {
  return pickHandoutText(packField, lang);
}

export default function HandoutInfographicPoster({
  pack,
  lang,
  subjectName,
  topicId,
}: {
  pack: HandoutInfographicPack;
  lang: AppLanguage;
  subjectName?: string;
  topicId?: string;
}) {
  const title = txt(pack.title, lang);
  const kicker = txt(pack.kicker, lang);
  const heroCaption = txt(pack.heroCaption, lang);

  return (
    <div
      data-handout-poster="1"
      style={{
        width: HANDOUT_POSTER_W,
        height: HANDOUT_POSTER_H,
        background: '#edf2f7',
        color: '#0f172a',
        fontFamily: "Segoe UI, system-ui, -apple-system, Arial, sans-serif",
        boxSizing: 'border-box',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header
        style={{
          background: '#083047',
          padding: '18px 28px 16px',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          gap: 22,
          flexShrink: 0,
        }}
      >
        <div style={{ width: 168, height: 92, borderRadius: 10, overflow: 'hidden', flexShrink: 0, background: '#0b3d59' }}>
          <HandoutMedicalArt scene={pack.heroScene} width={168} height={92} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              display: 'inline-block',
              background: '#fbbf24',
              color: '#083047',
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 1.1,
              textTransform: 'uppercase',
              padding: '4px 10px',
              borderRadius: 5,
              marginBottom: 8,
            }}
          >
            {kicker || "O'quv posteri"} · 30:21
          </div>
          <h1 style={{ margin: 0, fontSize: 32, lineHeight: 1.18, fontWeight: 800, color: '#fff' }}>{title}</h1>
          <p style={{ margin: '8px 0 0', fontSize: 14, color: 'rgba(255,255,255,0.78)', fontWeight: 600 }}>
            {[topicId, subjectName, heroCaption].filter(Boolean).join('  ·  ')}
          </p>
        </div>
      </header>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: '14px 16px 8px',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
          gap: 12,
        }}
      >
        {pack.sections.map((section, i) => (
          <SectionPanel key={section.id} section={section} lang={lang} accent={ACCENTS[i % ACCENTS.length]} />
        ))}
      </div>

      <footer
        style={{
          padding: '8px 28px 10px',
          fontSize: 12,
          color: '#64748b',
          fontWeight: 700,
          display: 'flex',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <span>iMentor · FJSTI · tibbiy o'quv posteri</span>
        <span>{lang.toUpperCase()}</span>
      </footer>
    </div>
  );
}

function SectionPanel({
  section,
  lang,
  accent,
}: {
  section: HandoutSection;
  lang: AppLanguage;
  accent: string;
}) {
  const heading = txt(section.heading, lang);
  const lead = txt(section.lead, lang);
  const caption = txt(section.caption, lang);
  const points = section.points.map((p) => txt(p, lang)).filter(Boolean);
  const box: CSSProperties = {
    background: '#fff',
    border: '1px solid #d5dee8',
    borderRadius: 12,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  };

  return (
    <section style={box}>
      <div style={{ height: 118, flexShrink: 0, position: 'relative', background: hexRgba(accent, 0.12), overflow: 'hidden' }}>
        <HandoutMedicalArt scene={section.scene} width={520} height={118} />
        {caption ? (
          <div
            style={{
              position: 'absolute',
              left: 8,
              bottom: 6,
              background: 'rgba(8,48,71,0.78)',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              padding: '2px 7px',
              borderRadius: 4,
              maxWidth: '92%',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
            }}
          >
            {caption}
          </div>
        ) : null}
      </div>
      <div style={{ padding: '10px 12px 12px', minHeight: 0, overflow: 'hidden', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
          <span
            style={{
              width: 26,
              height: 26,
              borderRadius: 999,
              background: accent,
              color: '#fff',
              fontWeight: 800,
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {section.n}
          </span>
          <h2 style={{ margin: 0, fontSize: 15, lineHeight: 1.25, fontWeight: 800, color: '#083047', paddingTop: 3 }}>
            {heading}
          </h2>
        </div>
        {lead ? (
          <p style={{ margin: '0 0 7px', fontSize: 12.5, lineHeight: 1.38, color: '#334155' }}>{lead}</p>
        ) : null}
        {section.cards.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: points.length ? 7 : 0 }}>
            {section.cards.map((card, ci) => {
              const cardAccent = ACCENTS[(ci + 1) % ACCENTS.length];
              return (
                <div
                  key={`${section.id}-c-${ci}`}
                  style={{
                    background: hexRgba(cardAccent, 0.08),
                    borderLeft: `4px solid ${cardAccent}`,
                    borderRadius: 6,
                    padding: '6px 8px',
                  }}
                >
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: cardAccent }}>{txt(card.title, lang)}</p>
                  {card.points.map((pt, pi) => {
                    const line = txt(pt, lang);
                    if (!line) return null;
                    return (
                      <p key={`${section.id}-c-${ci}-p-${pi}`} style={{ margin: '3px 0 0', fontSize: 11.5, lineHeight: 1.35, color: '#334155' }}>
                        {line}
                      </p>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
        {section.cards.length < 2 && points.length > 0 && (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {points.map((p, pi) => (
              <li
                key={`${section.id}-p-${pi}`}
                style={{
                  position: 'relative',
                  padding: '2px 0 2px 12px',
                  fontSize: 12,
                  lineHeight: 1.35,
                  color: '#1e293b',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 8,
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: accent,
                  }}
                />
                {p}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
