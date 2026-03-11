// ── One unique color per type for clear visual decoding (no reuse across types) ──
export const NODE_TYPES_CONFIG = {
  seed: {
    color: '#a78bfa',
    bg: '#1a1830',
    border: '#a78bfa',
    glow: 'rgba(167, 139, 250, 0.4)',
    icon: '◈',
    label: 'SEED',
  },
  problem: {
    color: '#f87171',
    bg: '#1f1520',
    border: '#f87171',
    glow: 'rgba(248, 113, 113, 0.3)',
    icon: '⚠',
    label: 'PROBLEM',
  },
  user_segment: {
    color: '#fb923c',
    bg: '#1f1a12',
    border: '#fb923c',
    glow: 'rgba(251, 146, 60, 0.3)',
    icon: '◎',
    label: 'USER',
  },
  job_to_be_done: {
    color: '#facc15',
    bg: '#1f1d10',
    border: '#facc15',
    glow: 'rgba(250, 204, 21, 0.3)',
    icon: '▶',
    label: 'JTBD',
  },
  feature: {
    color: '#22c55e',
    bg: '#111f14',
    border: '#22c55e',
    glow: 'rgba(34, 197, 94, 0.3)',
    icon: '◆',
    label: 'FEATURE',
  },
  constraint: {
    color: '#ec4899',
    bg: '#1f1218',
    border: '#ec4899',
    glow: 'rgba(236, 72, 153, 0.3)',
    icon: '⬡',
    label: 'CONSTRAINT',
  },
  metric: {
    color: '#0ea5e9',
    bg: '#111a24',
    border: '#0ea5e9',
    glow: 'rgba(14, 165, 233, 0.3)',
    icon: '◉',
    label: 'METRIC',
  },
  insight: {
    color: '#a855f7',
    bg: '#1a1220',
    border: '#a855f7',
    glow: 'rgba(168, 85, 247, 0.3)',
    icon: '✦',
    label: 'INSIGHT',
  },
  // ── Codebase analysis (distinct from product/resume) ─────
  component: {
    color: '#14b8a6',
    bg: '#101f1c',
    border: '#14b8a6',
    glow: 'rgba(20, 184, 166, 0.3)',
    icon: '▣',
    label: 'COMPONENT',
  },
  api_endpoint: {
    color: '#38bdf8',
    bg: '#0f1922',
    border: '#38bdf8',
    glow: 'rgba(56, 189, 248, 0.3)',
    icon: '⇌',
    label: 'ENDPOINT',
  },
  data_model: {
    color: '#c084fc',
    bg: '#1a1225',
    border: '#c084fc',
    glow: 'rgba(192, 132, 252, 0.3)',
    icon: '▦',
    label: 'DATA MODEL',
  },
  tech_debt: {
    color: '#f97316',
    bg: '#1f1610',
    border: '#f97316',
    glow: 'rgba(249, 115, 22, 0.3)',
    icon: '⚡',
    label: 'TECH DEBT',
  },
  // ── Resume (each type visually distinct) ──────────────────
  requirement: {
    color: '#06b6d4',
    bg: '#0f1922',
    border: '#06b6d4',
    glow: 'rgba(6, 182, 212, 0.3)',
    icon: '◷',
    label: 'REQUIREMENT',
  },
  skill_match: {
    color: '#4ade80',
    bg: '#111f14',
    border: '#4ade80',
    glow: 'rgba(74, 222, 128, 0.3)',
    icon: '✓',
    label: 'MATCH',
  },
  skill_gap: {
    color: '#ef4444',
    bg: '#1f1212',
    border: '#ef4444',
    glow: 'rgba(239, 68, 68, 0.3)',
    icon: '△',
    label: 'GAP',
  },
  achievement: {
    color: '#eab308',
    bg: '#1f1d10',
    border: '#eab308',
    glow: 'rgba(234, 179, 8, 0.3)',
    icon: '★',
    label: 'ACHIEVEMENT',
  },
  keyword: {
    color: '#10b981',
    bg: '#101f1c',
    border: '#10b981',
    glow: 'rgba(16, 185, 129, 0.3)',
    icon: '#',
    label: 'KEYWORD',
  },
  story: {
    color: '#d946ef',
    bg: '#1f1218',
    border: '#d946ef',
    glow: 'rgba(217, 70, 239, 0.3)',
    icon: '▷',
    label: 'STORY',
  },
  positioning: {
    color: '#8b5cf6',
    bg: '#1a1220',
    border: '#8b5cf6',
    glow: 'rgba(139, 92, 246, 0.3)',
    icon: '⊕',
    label: 'POSITIONING',
  },
  critique: {
    color: '#dc2626',
    bg: '#1f1015',
    border: '#dc2626',
    glow: 'rgba(220, 38, 38, 0.35)',
    icon: '⚔',
    label: 'CRITIQUE',
  },
  // ── Brain architecture: Causal Loops ──────────────────────
  variable: {
    color: '#06b6d4',
    bg: '#0f1922',
    border: '#06b6d4',
    glow: 'rgba(6, 182, 212, 0.3)',
    icon: '⟡',
    label: 'VARIABLE',
  },
  reinforcing_loop: {
    color: '#22c55e',
    bg: '#111f14',
    border: '#22c55e',
    glow: 'rgba(34, 197, 94, 0.3)',
    icon: '⟲',
    label: 'REINFORCING',
  },
  balancing_loop: {
    color: '#f59e0b',
    bg: '#1f1a12',
    border: '#f59e0b',
    glow: 'rgba(245, 158, 11, 0.3)',
    icon: '⟳',
    label: 'BALANCING',
  },
  // ── Brain architecture: GoT synthesis ─────────────────────
  synthesis: {
    color: '#c084fc',
    bg: '#1a1225',
    border: '#c084fc',
    glow: 'rgba(192, 132, 252, 0.3)',
    icon: '◇',
    label: 'SYNTHESIS',
  },
  aggregation: {
    color: '#818cf8',
    bg: '#1a1830',
    border: '#818cf8',
    glow: 'rgba(129, 140, 248, 0.3)',
    icon: '⬡',
    label: 'AGGREGATION',
  },
};

// ── Dynamic palette for AI-declared node types ──────────────
const DYNAMIC_PALETTE = [
  { color: '#a78bfa', bg: '#1a1830', border: '#a78bfa', glow: 'rgba(167,139,250,0.4)' },
  { color: '#f87171', bg: '#1f1520', border: '#f87171', glow: 'rgba(248,113,113,0.3)' },
  { color: '#fb923c', bg: '#1f1a12', border: '#fb923c', glow: 'rgba(251,146,60,0.3)' },
  { color: '#facc15', bg: '#1f1d10', border: '#facc15', glow: 'rgba(250,204,21,0.3)' },
  { color: '#22c55e', bg: '#111f14', border: '#22c55e', glow: 'rgba(34,197,94,0.3)' },
  { color: '#0ea5e9', bg: '#111a24', border: '#0ea5e9', glow: 'rgba(14,165,233,0.3)' },
  { color: '#ec4899', bg: '#1f1218', border: '#ec4899', glow: 'rgba(236,72,153,0.3)' },
  { color: '#14b8a6', bg: '#101f1c', border: '#14b8a6', glow: 'rgba(20,184,166,0.3)' },
  { color: '#a855f7', bg: '#1a1220', border: '#a855f7', glow: 'rgba(168,85,247,0.3)' },
  { color: '#38bdf8', bg: '#0f1922', border: '#38bdf8', glow: 'rgba(56,189,248,0.3)' },
  { color: '#f97316', bg: '#1f1610', border: '#f97316', glow: 'rgba(249,115,22,0.3)' },
  { color: '#d946ef', bg: '#1f1218', border: '#d946ef', glow: 'rgba(217,70,239,0.3)' },
];

export function buildDynamicConfig(metaTypes) {
  const config = {};
  metaTypes.forEach((t, i) => {
    const paletteIdx = i % DYNAMIC_PALETTE.length;
    config[t.type] = {
      ...DYNAMIC_PALETTE[paletteIdx],
      icon: t.icon || '✦',
      label: (t.label || t.type.replace(/_/g, ' ')).toUpperCase(),
    };
  });
  return config;
}

export const getNodeConfig = (type, dynamicConfig) => {
  if (dynamicConfig?.[type]) return dynamicConfig[type];
  return NODE_TYPES_CONFIG[type] || NODE_TYPES_CONFIG.insight;
};
