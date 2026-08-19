import type { HandoutScene } from '../../utils/handoutScenes';

/** html2canvas uchun faqat inline SVG + qattiq ranglar. */
export default function HandoutMedicalArt({
  scene,
  width,
  height,
}: {
  scene: HandoutScene;
  width?: number | string;
  height?: number | string;
}) {
  return (
    <svg
      viewBox="0 0 400 200"
      width={width ?? '100%'}
      height={height ?? '100%'}
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid slice"
    >
      <rect width="400" height="200" fill={bgOf(scene)} />
      {renderScene(scene)}
    </svg>
  );
}

function bgOf(scene: HandoutScene): string {
  switch (scene) {
    case 'child':
      return '#dbeafe';
    case 'urinary':
      return '#fce7f3';
    case 'kidney':
      return '#fee2e2';
    case 'liver':
      return '#ffedd5';
    case 'heart':
      return '#ffe4e6';
    case 'lungs':
      return '#e0f2fe';
    case 'brain':
      return '#ede9fe';
    case 'gi':
      return '#fef3c7';
    case 'skin':
      return '#fde68a';
    case 'blood':
      return '#fecaca';
    case 'infection':
      return '#dcfce7';
    case 'inflammation':
      return '#fed7aa';
    case 'microscope':
      return '#e2e8f0';
    case 'clinic':
      return '#ccfbf1';
    case 'treatment':
      return '#dbeafe';
    case 'surgery':
      return '#e0e7ff';
    case 'prevention':
      return '#d1fae5';
    case 'bones':
      return '#f1f5f9';
    case 'eye':
      return '#e0f2fe';
    case 'ear':
      return '#fae8ff';
    case 'tooth':
      return '#f8fafc';
    case 'endocrine':
      return '#fce7f3';
    case 'pregnancy':
      return '#fce7f3';
    case 'immune':
      return '#ecfccb';
    default:
      return '#dbeafe';
  }
}

function renderScene(scene: HandoutScene) {
  switch (scene) {
    case 'child':
      return <ChildExam />;
    case 'urinary':
      return <UrinaryTract />;
    case 'kidney':
      return <Kidney />;
    case 'liver':
      return <Liver />;
    case 'heart':
      return <Heart />;
    case 'lungs':
      return <Lungs />;
    case 'brain':
      return <Brain />;
    case 'gi':
      return <GiTract />;
    case 'skin':
      return <SkinDerm />;
    case 'blood':
      return <BloodCells />;
    case 'infection':
      return <Infection />;
    case 'inflammation':
      return <Inflammation />;
    case 'microscope':
      return <MicroscopeView />;
    case 'clinic':
      return <ClinicExam />;
    case 'treatment':
      return <Treatment />;
    case 'surgery':
      return <Surgery />;
    case 'prevention':
      return <Prevention />;
    case 'bones':
      return <Bones />;
    case 'eye':
      return <Eye />;
    case 'ear':
      return <Ear />;
    case 'tooth':
      return <Tooth />;
    case 'endocrine':
      return <Endocrine />;
    case 'pregnancy':
      return <Pregnancy />;
    case 'immune':
      return <Immune />;
    default:
      return <DefaultAnatomy />;
  }
}

function ChildExam() {
  return (
    <g>
      <ellipse cx="200" cy="188" rx="90" ry="10" fill="#93c5fd" />
      <ellipse cx="200" cy="46" rx="28" ry="30" fill="#f2c2a3" />
      <ellipse cx="190" cy="42" rx="4" ry="5" fill="#1e3a5f" />
      <ellipse cx="210" cy="42" rx="4" ry="5" fill="#1e3a5f" />
      <path d="M188 58 Q200 66 212 58" fill="none" stroke="#b45309" strokeWidth="2" />
      <rect x="172" y="74" width="56" height="62" rx="12" fill="#38bdf8" />
      <rect x="178" y="80" width="44" height="28" rx="6" fill="#e0f2fe" />
      <rect x="176" y="134" width="22" height="40" rx="8" fill="#1d4ed8" />
      <rect x="202" y="134" width="22" height="40" rx="8" fill="#1d4ed8" />
      <rect x="148" y="82" width="22" height="48" rx="10" fill="#f2c2a3" />
      <rect x="230" y="82" width="22" height="48" rx="10" fill="#f2c2a3" />
      <circle cx="268" cy="70" r="22" fill="#fff" stroke="#0369a1" strokeWidth="3" />
      <circle cx="268" cy="70" r="8" fill="#0ea5e9" />
      <path d="M286 88 L304 108" stroke="#0369a1" strokeWidth="6" strokeLinecap="round" />
      <circle cx="132" cy="54" r="10" fill="#fbbf24" />
      <circle cx="118" cy="92" r="8" fill="#34d399" />
      <circle cx="140" cy="118" r="7" fill="#f87171" />
    </g>
  );
}

function UrinaryTract() {
  return (
    <g>
      <ellipse cx="148" cy="72" rx="34" ry="22" fill="#fb7185" />
      <ellipse cx="148" cy="72" rx="18" ry="10" fill="#fecdd3" />
      <ellipse cx="252" cy="72" rx="34" ry="22" fill="#fb7185" />
      <ellipse cx="252" cy="72" rx="18" ry="10" fill="#fecdd3" />
      <path d="M148 94 C148 120 168 130 200 148" fill="none" stroke="#e11d48" strokeWidth="6" />
      <path d="M252 94 C252 120 232 130 200 148" fill="none" stroke="#e11d48" strokeWidth="6" />
      <ellipse cx="200" cy="158" rx="32" ry="22" fill="#fda4af" />
      <path d="M200 178 L200 194" stroke="#e11d48" strokeWidth="7" strokeLinecap="round" />
      <ellipse cx="200" cy="118" rx="10" ry="14" fill="#f43f5e" />
      <ellipse cx="178" cy="178" rx="14" ry="18" fill="#fb7185" />
      <ellipse cx="222" cy="178" rx="14" ry="18" fill="#fb7185" />
      <ellipse cx="178" cy="172" rx="6" ry="5" fill="#be123c" />
      <ellipse cx="222" cy="172" rx="6" ry="5" fill="#be123c" />
    </g>
  );
}

function Kidney() {
  return (
    <g>
      <ellipse cx="168" cy="108" rx="58" ry="78" fill="#f43f5e" />
      <ellipse cx="168" cy="108" rx="38" ry="54" fill="#fecdd3" />
      <polygon points="168,70 186,108 168,146 150,108" fill="#e11d48" />
      <path d="M226 108 C268 92 300 108 318 108" fill="none" stroke="#be123c" strokeWidth="8" />
      <ellipse cx="328" cy="108" rx="18" ry="12" fill="#fb7185" />
      <circle cx="250" cy="48" r="16" fill="#fff" stroke="#e11d48" strokeWidth="3" />
      <path d="M250 40 L250 56 M242 48 L258 48" stroke="#e11d48" strokeWidth="3" />
    </g>
  );
}

function Liver() {
  return (
    <g>
      <path
        d="M70 90 C90 40 180 30 250 55 C310 75 340 100 330 130 C318 168 250 175 180 170 C110 164 55 140 70 90Z"
        fill="#b45309"
      />
      <path
        d="M120 95 C150 70 220 68 270 90 C250 120 180 130 130 118Z"
        fill="#f59e0b"
      />
      <ellipse cx="210" cy="128" rx="28" ry="18" fill="#78350f" />
      <path d="M238 128 C280 140 300 160 292 180" fill="none" stroke="#a16207" strokeWidth="5" />
    </g>
  );
}

function Heart() {
  return (
    <g>
      <path
        d="M200 170 C120 110 108 70 148 52 C176 40 200 62 200 62 C200 62 224 40 252 52 C292 70 280 110 200 170Z"
        fill="#e11d48"
      />
      <path d="M168 78 C184 70 200 88 200 88 C200 88 216 70 232 78 C220 110 200 128 200 128 C200 128 180 110 168 78Z" fill="#fecaca" />
      <path d="M186 48 C186 28 170 18 170 18" fill="none" stroke="#9f1239" strokeWidth="7" strokeLinecap="round" />
      <path d="M214 48 C226 24 250 22 250 22" fill="none" stroke="#9f1239" strokeWidth="7" strokeLinecap="round" />
    </g>
  );
}

function Lungs() {
  return (
    <g>
      <path d="M186 40 L186 168" stroke="#64748b" strokeWidth="10" strokeLinecap="round" />
      <path d="M214 40 L214 168" stroke="#64748b" strokeWidth="10" strokeLinecap="round" />
      <path d="M200 28 L186 42 M200 28 L214 42" stroke="#475569" strokeWidth="8" strokeLinecap="round" />
      <ellipse cx="128" cy="118" rx="70" ry="68" fill="#38bdf8" />
      <ellipse cx="272" cy="118" rx="70" ry="68" fill="#38bdf8" />
      <ellipse cx="128" cy="118" rx="42" ry="40" fill="#e0f2fe" />
      <ellipse cx="272" cy="118" rx="42" ry="40" fill="#e0f2fe" />
      <path d="M128 80 Q110 118 128 156" fill="none" stroke="#0369a1" strokeWidth="3" />
      <path d="M272 80 Q290 118 272 156" fill="none" stroke="#0369a1" strokeWidth="3" />
    </g>
  );
}

function Brain() {
  return (
    <g>
      <ellipse cx="200" cy="108" rx="92" ry="70" fill="#c4b5fd" />
      <path d="M130 90 Q160 60 200 78 Q240 60 270 90" fill="none" stroke="#6d28d9" strokeWidth="6" />
      <path d="M124 118 Q170 100 200 118 Q240 136 276 118" fill="none" stroke="#7c3aed" strokeWidth="5" />
      <path d="M140 148 Q200 132 260 148" fill="none" stroke="#5b21b6" strokeWidth="5" />
      <ellipse cx="200" cy="168" rx="28" ry="14" fill="#a78bfa" />
      <circle cx="168" cy="100" r="10" fill="#ede9fe" />
      <circle cx="232" cy="96" r="10" fill="#ede9fe" />
    </g>
  );
}

function GiTract() {
  return (
    <g>
      <ellipse cx="200" cy="70" rx="70" ry="36" fill="#fb923c" />
      <ellipse cx="200" cy="70" rx="42" ry="18" fill="#fed7aa" />
      <path
        d="M170 100 C120 120 110 160 160 168 C230 178 250 140 220 128 C180 116 210 150 260 158"
        fill="none"
        stroke="#ea580c"
        strokeWidth="14"
        strokeLinecap="round"
      />
      <ellipse cx="292" cy="86" rx="22" ry="16" fill="#f59e0b" />
    </g>
  );
}

function SkinDerm() {
  return (
    <g>
      <rect x="80" y="40" width="240" height="128" rx="18" fill="#f2c2a3" />
      <rect x="80" y="40" width="240" height="28" rx="18" fill="#e8b089" />
      <ellipse cx="160" cy="110" rx="28" ry="22" fill="#ef4444" />
      <ellipse cx="230" cy="128" rx="18" ry="14" fill="#f97316" />
      <ellipse cx="270" cy="92" rx="12" ry="10" fill="#dc2626" />
      <path d="M90 150 C140 170 200 140 250 160 C280 172 310 150 320 155" fill="none" stroke="#b45309" strokeWidth="4" />
    </g>
  );
}

function BloodCells() {
  return (
    <g>
      <circle cx="130" cy="90" r="36" fill="#ef4444" />
      <circle cx="130" cy="90" r="16" fill="#fecaca" />
      <circle cx="210" cy="70" r="30" fill="#dc2626" />
      <circle cx="210" cy="70" r="12" fill="#fecaca" />
      <circle cx="270" cy="120" r="34" fill="#b91c1c" />
      <circle cx="270" cy="120" r="14" fill="#fecaca" />
      <circle cx="170" cy="150" r="22" fill="#f87171" />
      <circle cx="90" cy="150" r="16" fill="#fff" stroke="#64748b" strokeWidth="2" />
      <circle cx="310" cy="60" r="14" fill="#1d4ed8" />
    </g>
  );
}

function Infection() {
  return (
    <g>
      <circle cx="150" cy="100" r="48" fill="#22c55e" />
      <circle cx="150" cy="100" r="22" fill="#bbf7d0" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
        const r = (deg * Math.PI) / 180;
        const x = 150 + Math.cos(r) * 56;
        const y = 100 + Math.sin(r) * 56;
        return <circle key={deg} cx={x} cy={y} r="8" fill="#166534" />;
      })}
      <ellipse cx="280" cy="70" rx="40" ry="18" fill="#4ade80" />
      <ellipse cx="280" cy="70" rx="18" ry="8" fill="#dcfce7" />
      <ellipse cx="300" cy="140" rx="36" ry="16" fill="#86efac" />
      <circle cx="240" cy="150" r="14" fill="#16a34a" />
    </g>
  );
}

function Inflammation() {
  return (
    <g>
      <ellipse cx="200" cy="110" rx="110" ry="70" fill="#fdba74" />
      <ellipse cx="200" cy="110" rx="70" ry="44" fill="#fb923c" />
      <ellipse cx="200" cy="110" rx="36" ry="24" fill="#ef4444" />
      <path d="M200 40 L210 78 L200 70 L190 78 Z" fill="#dc2626" />
      <path d="M280 70 L268 100 L258 90 L250 108" fill="none" stroke="#b91c1c" strokeWidth="4" />
      <path d="M120 70 L132 100 L142 90 L150 108" fill="none" stroke="#b91c1c" strokeWidth="4" />
    </g>
  );
}

function MicroscopeView() {
  return (
    <g>
      <circle cx="200" cy="100" r="80" fill="#1e293b" />
      <circle cx="200" cy="100" r="68" fill="#0f766e" />
      <circle cx="170" cy="88" r="18" fill="#fca5a5" />
      <circle cx="220" cy="80" r="14" fill="#86efac" />
      <circle cx="230" cy="120" r="20" fill="#fde68a" />
      <circle cx="180" cy="130" r="12" fill="#93c5fd" />
      <circle cx="205" cy="105" r="8" fill="#fda4af" />
      <rect x="40" y="40" width="70" height="14" rx="4" fill="#334155" />
      <rect x="48" y="62" width="54" height="90" rx="6" fill="#64748b" />
      <circle cx="75" cy="88" r="16" fill="#94a3b8" />
    </g>
  );
}

function ClinicExam() {
  return (
    <g>
      <ellipse cx="250" cy="150" rx="70" ry="14" fill="#99f6e4" />
      <rect x="210" y="88" width="80" height="62" rx="12" fill="#5eead6" />
      <ellipse cx="250" cy="70" rx="24" ry="26" fill="#f2c2a3" />
      <rect x="110" y="70" width="70" height="90" rx="16" fill="#0f766e" />
      <ellipse cx="145" cy="58" rx="22" ry="24" fill="#e8b89a" />
      <circle cx="168" cy="108" r="20" fill="#fff" stroke="#0f766e" strokeWidth="4" />
      <path d="M184 124 L204 144" stroke="#0f766e" strokeWidth="6" strokeLinecap="round" />
    </g>
  );
}

function Treatment() {
  return (
    <g>
      <rect x="70" y="70" width="44" height="90" rx="8" fill="#ef4444" />
      <rect x="70" y="70" width="44" height="28" rx="8" fill="#fecaca" />
      <rect x="130" y="58" width="44" height="102" rx="8" fill="#2563eb" />
      <rect x="130" y="58" width="44" height="32" rx="8" fill="#bfdbfe" />
      <rect x="190" y="80" width="44" height="80" rx="8" fill="#059669" />
      <rect x="250" y="50" width="70" height="28" rx="14" fill="#f8fafc" stroke="#64748b" strokeWidth="3" />
      <rect x="268" y="40" width="34" height="18" rx="6" fill="#cbd5e1" />
      <circle cx="300" cy="140" r="28" fill="#fbbf24" />
      <circle cx="300" cy="140" r="12" fill="#fff" />
    </g>
  );
}

function Surgery() {
  return (
    <g>
      <rect x="90" y="40" width="220" height="130" rx="12" fill="#e0e7ff" />
      <ellipse cx="200" cy="108" rx="70" ry="40" fill="#f2c2a3" />
      <path d="M160 108 L240 108" stroke="#1e3a8a" strokeWidth="3" />
      <path d="M90 70 L150 100" stroke="#334155" strokeWidth="6" strokeLinecap="round" />
      <path d="M310 70 L250 100" stroke="#334155" strokeWidth="6" strokeLinecap="round" />
      <rect x="70" y="58" width="28" height="10" rx="2" fill="#64748b" />
      <rect x="302" y="58" width="28" height="10" rx="2" fill="#64748b" />
      <circle cx="200" cy="48" r="10" fill="#22c55e" />
    </g>
  );
}

function Prevention() {
  return (
    <g>
      <path d="M200 36 L286 70 L286 118 C286 156 248 178 200 188 C152 178 114 156 114 118 L114 70 Z" fill="#10b981" />
      <path d="M200 52 L262 78 L262 116 C262 146 234 164 200 172 C166 164 138 146 138 116 L138 78 Z" fill="#d1fae5" />
      <path d="M176 112 L194 130 L230 90" fill="none" stroke="#047857" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

function Bones() {
  return (
    <g>
      <rect x="188" y="30" width="24" height="140" rx="10" fill="#f8fafc" stroke="#94a3b8" strokeWidth="3" />
      <circle cx="200" cy="30" r="18" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="3" />
      <circle cx="200" cy="170" r="20" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="3" />
      <rect x="120" y="88" width="160" height="22" rx="8" fill="#cbd5e1" />
      <circle cx="120" cy="99" r="16" fill="#f1f5f9" stroke="#94a3b8" strokeWidth="3" />
      <circle cx="280" cy="99" r="16" fill="#f1f5f9" stroke="#94a3b8" strokeWidth="3" />
    </g>
  );
}

function Eye() {
  return (
    <g>
      <ellipse cx="200" cy="100" rx="110" ry="62" fill="#f8fafc" stroke="#64748b" strokeWidth="4" />
      <circle cx="200" cy="100" r="48" fill="#38bdf8" />
      <circle cx="200" cy="100" r="22" fill="#0f172a" />
      <circle cx="188" cy="88" r="8" fill="#fff" />
      <path d="M90 70 Q200 20 310 70" fill="none" stroke="#334155" strokeWidth="6" />
      <path d="M90 130 Q200 180 310 130" fill="none" stroke="#334155" strokeWidth="6" />
    </g>
  );
}

function Ear() {
  return (
    <g>
      <ellipse cx="200" cy="100" rx="70" ry="88" fill="#f2c2a3" />
      <ellipse cx="210" cy="100" rx="40" ry="58" fill="#e8b89a" />
      <ellipse cx="218" cy="108" rx="18" ry="24" fill="#c4896a" />
      <path d="M236 108 C280 108 310 90 318 70" fill="none" stroke="#b45309" strokeWidth="6" />
      <circle cx="318" cy="62" r="14" fill="#fda4af" />
    </g>
  );
}

function Tooth() {
  return (
    <g>
      <path d="M160 40 C150 40 142 55 142 70 L148 160 C150 178 168 182 176 160 L184 90 L200 90 L216 90 L224 160 C232 182 250 178 252 160 L258 70 C258 55 250 40 240 40 Z" fill="#f8fafc" stroke="#94a3b8" strokeWidth="4" />
      <rect x="150" y="48" width="100" height="28" rx="8" fill="#e2e8f0" />
      <ellipse cx="200" cy="150" rx="10" ry="16" fill="#fca5a5" />
    </g>
  );
}

function Endocrine() {
  return (
    <g>
      <ellipse cx="200" cy="56" rx="50" ry="22" fill="#f472b6" />
      <path d="M200 78 L200 118" stroke="#db2777" strokeWidth="8" />
      <polygon points="200,118 160,170 240,170" fill="#fb7185" />
      <circle cx="110" cy="90" r="22" fill="#f9a8d4" />
      <circle cx="290" cy="90" r="22" fill="#f9a8d4" />
      <ellipse cx="148" cy="150" rx="20" ry="14" fill="#e11d48" />
      <ellipse cx="252" cy="150" rx="20" ry="14" fill="#e11d48" />
    </g>
  );
}

function Pregnancy() {
  return (
    <g>
      <ellipse cx="200" cy="48" rx="26" ry="28" fill="#f2c2a3" />
      <path d="M170 78 C160 110 150 150 186 168 L214 168 C250 150 240 110 230 78 Z" fill="#f9a8d4" />
      <ellipse cx="200" cy="128" rx="36" ry="32" fill="#fbcfe8" />
      <ellipse cx="200" cy="132" rx="16" ry="20" fill="#f2c2a3" />
      <rect x="176" y="168" width="18" height="28" rx="6" fill="#1d4ed8" />
      <rect x="206" y="168" width="18" height="28" rx="6" fill="#1d4ed8" />
    </g>
  );
}

function Immune() {
  return (
    <g>
      <path d="M200 36 L286 70 L286 118 C286 156 248 178 200 188 C152 178 114 156 114 118 L114 70 Z" fill="#84cc16" />
      <circle cx="200" cy="112" r="36" fill="#ecfccb" />
      <circle cx="188" cy="104" r="10" fill="#65a30d" />
      <circle cx="214" cy="120" r="8" fill="#4d7c0f" />
      <circle cx="206" cy="96" r="6" fill="#a3e635" />
    </g>
  );
}

function DefaultAnatomy() {
  return (
    <g>
      <ellipse cx="200" cy="40" rx="22" ry="24" fill="#f2c2a3" />
      <rect x="178" y="64" width="44" height="70" rx="14" fill="#0ea5e9" />
      <ellipse cx="200" cy="92" rx="16" ry="18" fill="#ef4444" />
      <ellipse cx="184" cy="108" rx="10" ry="16" fill="#38bdf8" />
      <ellipse cx="216" cy="108" rx="10" ry="16" fill="#38bdf8" />
      <rect x="186" y="134" width="12" height="40" rx="6" fill="#1e3a8a" />
      <rect x="202" y="134" width="12" height="40" rx="6" fill="#1e3a8a" />
      <rect x="156" y="72" width="18" height="46" rx="8" fill="#f2c2a3" />
      <rect x="226" y="72" width="18" height="46" rx="8" fill="#f2c2a3" />
      <circle cx="300" cy="70" r="28" fill="#fff" stroke="#0369a1" strokeWidth="4" />
      <circle cx="300" cy="70" r="10" fill="#0ea5e9" />
      <path d="M322 92 L344 118" stroke="#0369a1" strokeWidth="8" strokeLinecap="round" />
    </g>
  );
}
