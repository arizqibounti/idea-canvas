/**
 * exportMarkdown.js — Pure functions to convert node tree + debate data → markdown files
 * No React, no side effects.
 */

// ── Helpers ──────────────────────────────────────────────────────

function buildTree(nodes) {
  const map = {};
  const roots = [];
  const normalized = nodes.map(n => ({
    id: n.id,
    type: n.data?.type || n.type || 'unknown',
    label: n.data?.label || n.label || n.id,
    reasoning: n.data?.reasoning || n.reasoning || '',
    parentId: n.data?.parentId || n.parentId || null,
  }));
  normalized.forEach(n => { map[n.id] = { ...n, children: [] }; });
  normalized.forEach(n => {
    if (n.parentId && map[n.parentId]) {
      map[n.parentId].children.push(map[n.id]);
    } else {
      roots.push(map[n.id]);
    }
  });
  return { roots, map, flat: normalized };
}

function slugify(text, maxWords = 5) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, maxWords)
    .join('-')
    || 'idea-export';
}

function nodesByType(flat, ...types) {
  return flat.filter(n => types.includes(n.type));
}

function indent(text, level) {
  const pad = '  '.repeat(level);
  return text.split('\n').map(l => pad + l).join('\n');
}

function renderTreeMd(node, depth = 0) {
  const prefix = depth === 0 ? '##' : depth === 1 ? '###' : '-';
  const isHeading = depth < 2;
  let md = '';
  if (isHeading) {
    md += `${prefix} ${node.label}\n`;
    if (node.reasoning) md += `${node.reasoning}\n`;
    md += '\n';
  } else {
    md += `${'  '.repeat(depth - 2)}${prefix} **${node.label}**`;
    if (node.reasoning) md += ` — ${node.reasoning}`;
    md += '\n';
  }
  if (node.children?.length) {
    node.children.forEach(c => { md += renderTreeMd(c, depth + 1); });
  }
  return md;
}

// ── Generators ───────────────────────────────────────────────────

export function generateRepoName(idea) {
  return 'idea-graph-' + slugify(idea);
}

export function generateREADME(idea, nodes) {
  const { roots, flat } = buildTree(nodes);
  const seed = flat.find(n => n.type === 'seed');
  const problems = nodesByType(flat, 'problem');
  const segments = nodesByType(flat, 'user_segment');
  const features = nodesByType(flat, 'feature', 'sub_feature');
  const metrics = nodesByType(flat, 'metric');

  let md = `# ${seed?.label || idea}\n\n`;
  md += `> Exported from Idea Graph — product thinking canvas\n\n`;

  // Executive Summary
  md += `## Executive Summary\n\n`;
  md += `${seed?.reasoning || idea}\n\n`;

  // Problems
  if (problems.length) {
    md += `## Problems Solved\n\n`;
    problems.forEach(p => {
      md += `- **${p.label}** — ${p.reasoning}\n`;
    });
    md += '\n';
  }

  // Target Users
  if (segments.length) {
    md += `## Target Users\n\n`;
    segments.forEach(s => {
      md += `- **${s.label}** — ${s.reasoning}\n`;
    });
    md += '\n';
  }

  // Key Features
  if (features.length) {
    md += `## Key Features\n\n`;
    features.forEach(f => {
      md += `- **${f.label}** — ${f.reasoning}\n`;
    });
    md += '\n';
  }

  // Success Metrics
  if (metrics.length) {
    md += `## Success Metrics\n\n`;
    metrics.forEach(m => {
      md += `- **${m.label}** — ${m.reasoning}\n`;
    });
    md += '\n';
  }

  md += `---\n\n`;
  md += `📋 See [SPEC.md](./SPEC.md) for the full product spec.\n`;
  md += `⚔ See [DEBATE.md](./DEBATE.md) for VC debate history.\n`;
  md += `🤖 See [CLAUDE.md](./CLAUDE.md) for Claude Code project context.\n`;

  return md;
}

export function generateSPEC(idea, nodes) {
  const { roots, flat, map } = buildTree(nodes);
  const seed = flat.find(n => n.type === 'seed');

  // Filter out debate nodes (critique/rebuttal/finalize/synthesis)
  const productTypes = ['seed', 'problem', 'user_segment', 'job_to_be_done', 'feature', 'sub_feature',
    'constraint', 'metric', 'insight', 'component', 'api_endpoint', 'data_model',
    'architecture', 'go_to_market', 'monetization', 'competitive_advantage', 'risk', 'tech_debt'];

  let md = `# Product Specification: ${seed?.label || idea}\n\n`;
  md += `> Auto-generated from Idea Graph product thinking tree (${flat.length} nodes)\n\n`;

  // Full tree by section
  const sectionOrder = [
    { types: ['problem'], title: 'Problems & Pain Points' },
    { types: ['user_segment', 'job_to_be_done'], title: 'Target Users & Jobs to Be Done' },
    { types: ['feature', 'sub_feature'], title: 'Features' },
    { types: ['architecture', 'component', 'api_endpoint', 'data_model'], title: 'Architecture & Technical Design' },
    { types: ['risk', 'constraint', 'tech_debt'], title: 'Risks & Constraints' },
    { types: ['metric'], title: 'Success Metrics' },
    { types: ['go_to_market', 'monetization'], title: 'Go-to-Market & Monetization' },
    { types: ['competitive_advantage'], title: 'Competitive Advantages' },
    { types: ['insight'], title: 'Key Insights' },
  ];

  sectionOrder.forEach(({ types, title }) => {
    const items = flat.filter(n => types.includes(n.type));
    if (!items.length) return;

    md += `## ${title}\n\n`;
    items.forEach(item => {
      const parent = item.parentId && map[item.parentId];
      md += `### ${item.label}\n`;
      if (parent && parent.type !== 'seed') md += `*Parent: ${parent.label}*\n\n`;
      else md += '\n';
      md += `${item.reasoning}\n\n`;
    });
  });

  // Full tree dump (compact)
  md += `## Full Node Tree\n\n`;
  md += `| ID | Type | Label | Parent |\n`;
  md += `|----|------|-------|--------|\n`;
  flat.filter(n => productTypes.includes(n.type)).forEach(n => {
    const parentLabel = n.parentId && map[n.parentId] ? map[n.parentId].label : '—';
    md += `| ${n.id} | ${n.type} | ${n.label} | ${parentLabel} |\n`;
  });
  md += '\n';

  return md;
}

export function generateDEBATE(rounds) {
  if (!rounds || !rounds.length) {
    return `# VC Debate History\n\n> No debate rounds were run for this idea.\n`;
  }

  let md = `# VC Debate History\n\n`;
  md += `> ${rounds.length} round(s) of autonomous VC debate\n\n`;

  rounds.forEach(r => {
    md += `## Round ${r.round}\n\n`;
    md += `**Verdict:** ${r.verdict === 'YES' ? '✅ CONSENSUS' : '❌ NOT YET'}\n\n`;
    if (r.summary) md += `**Summary:** ${r.summary}\n\n`;

    // Critiques
    if (r.critiques?.length) {
      md += `### Critiques\n\n`;
      r.critiques.forEach(c => {
        md += `- **[${(c.category || 'general').toUpperCase()}]** ${c.challenge}\n`;
        md += `  - Target: *${c.targetNodeLabel || c.targetNodeId || '—'}*\n`;
        md += `  - ${c.reasoning}\n\n`;
      });
    }

    // Suggestions / blockers
    const suggestions = r.blockers || r.suggestions || [];
    if (suggestions.length) {
      md += `### Suggestions\n\n`;
      suggestions.forEach(s => {
        md += `- ${s}\n`;
      });
      md += '\n';
    }

    // Rebuttal nodes
    if (r.rebutNodes?.length) {
      md += `### Architect Responses\n\n`;
      r.rebutNodes.forEach(n => {
        const label = n.data?.label || n.label || n.id;
        const reasoning = n.data?.reasoning || n.reasoning || '';
        md += `- **${label}** — ${reasoning}\n`;
      });
      md += '\n';
    }

    md += `---\n\n`;
  });

  return md;
}

export function generateCLAUDE(idea, nodes, rounds) {
  const { flat, map } = buildTree(nodes);
  const seed = flat.find(n => n.type === 'seed');
  const problems = nodesByType(flat, 'problem');
  const features = nodesByType(flat, 'feature', 'sub_feature');
  const risks = nodesByType(flat, 'risk', 'constraint');
  const segments = nodesByType(flat, 'user_segment');
  const metrics = nodesByType(flat, 'metric');
  const architecture = nodesByType(flat, 'architecture', 'component', 'api_endpoint', 'data_model');
  const insights = nodesByType(flat, 'insight', 'competitive_advantage');

  let md = `# CLAUDE.md — Project Context for Claude Code\n\n`;
  md += `> This file provides context about the product so that Claude Code can build it effectively.\n`;
  md += `> Generated from Idea Graph product thinking canvas.\n\n`;

  // Purpose
  md += `## What This Product Does\n\n`;
  md += `**${seed?.label || idea}**\n\n`;
  md += `${seed?.reasoning || idea}\n\n`;

  // Problems
  if (problems.length) {
    md += `## Core Problems Being Solved\n\n`;
    problems.forEach(p => { md += `- ${p.label}: ${p.reasoning}\n`; });
    md += '\n';
  }

  // Target Users
  if (segments.length) {
    md += `## Target Users\n\n`;
    segments.forEach(s => { md += `- **${s.label}**: ${s.reasoning}\n`; });
    md += '\n';
  }

  // Features — priority order (first features in tree = highest priority)
  if (features.length) {
    md += `## Features (Priority Order)\n\n`;
    features.forEach((f, i) => {
      md += `${i + 1}. **${f.label}** — ${f.reasoning}\n`;
    });
    md += '\n';
  }

  // Architecture decisions
  if (architecture.length) {
    md += `## Architecture & Technical Decisions\n\n`;
    architecture.forEach(a => { md += `- **${a.label}**: ${a.reasoning}\n`; });
    md += '\n';
  }

  // Key insights from debate
  if (insights.length) {
    md += `## Key Insights & Competitive Advantages\n\n`;
    insights.forEach(i => { md += `- ${i.label}: ${i.reasoning}\n`; });
    md += '\n';
  }

  // Risks
  if (risks.length) {
    md += `## Known Risks & Constraints\n\n`;
    risks.forEach(r => { md += `- ⚠ **${r.label}**: ${r.reasoning}\n`; });
    md += '\n';
  }

  // Metrics
  if (metrics.length) {
    md += `## Success Metrics\n\n`;
    metrics.forEach(m => { md += `- ${m.label}: ${m.reasoning}\n`; });
    md += '\n';
  }

  // Debate summary
  if (rounds?.length) {
    const lastRound = rounds[rounds.length - 1];
    md += `## VC Debate Summary\n\n`;
    md += `The product went through ${rounds.length} round(s) of autonomous VC debate.\n`;
    md += `Final verdict: **${lastRound.verdict === 'YES' ? 'CONSENSUS REACHED' : 'NO CONSENSUS'}**\n\n`;
    if (lastRound.summary) md += `> ${lastRound.summary}\n\n`;

    // Key suggestions from all rounds
    const allSuggestions = rounds.flatMap(r => r.blockers || r.suggestions || []);
    if (allSuggestions.length) {
      md += `### Suggestions from VC Review\n\n`;
      allSuggestions.forEach(s => { md += `- ${s}\n`; });
      md += '\n';
    }
  }

  // Build guidance
  md += `## Build Guidance\n\n`;
  md += `When implementing this product:\n`;
  md += `1. Start with the core features listed above in priority order\n`;
  md += `2. Pay attention to the risks and constraints — they inform architectural choices\n`;
  md += `3. The success metrics should guide what you instrument and measure\n`;
  md += `4. Refer to SPEC.md for detailed feature breakdowns\n`;
  if (rounds?.length) md += `5. Refer to DEBATE.md for the full VC debate history and reasoning\n`;
  md += '\n';

  return md;
}

export { buildTree, slugify };
