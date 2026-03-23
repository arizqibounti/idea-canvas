// ── Pattern Schema: validation + defaults ─────────────────────
// Validates and normalizes a thinking pattern definition.

const VALID_STAGE_TYPES = ['generate', 'transform', 'score', 'branch', 'loop', 'merge', 'filter', 'enrich', 'fan_out'];
const VALID_MODELS = ['claude:opus', 'claude:sonnet', 'gemini:pro', 'gemini:flash', 'auto'];
const VALID_OUTPUT_FORMATS = ['node-stream', 'json', 'score'];
const VALID_MERGE_STRATEGIES = ['concatenate', 'ai_merge', 'vote'];
const VALID_ENRICH_SOURCES = ['research', 'knowledge', 'url'];
const VALID_FILTER_STRATEGIES = ['threshold', 'classify'];

function validatePattern(def) {
  const errors = [];
  if (!def.id || typeof def.id !== 'string') errors.push('id is required (kebab-case string)');
  if (!def.name || typeof def.name !== 'string') errors.push('name is required');
  if (!def.stages || typeof def.stages !== 'object' || Object.keys(def.stages).length === 0) {
    errors.push('stages must be a non-empty object');
  }
  if (!def.graph?.entrypoint) errors.push('graph.entrypoint is required');
  if (def.graph?.entrypoint && def.stages && !def.stages[def.graph.entrypoint]) {
    errors.push(`graph.entrypoint "${def.graph.entrypoint}" not found in stages`);
  }

  // Validate each stage
  if (def.stages) {
    for (const [name, stage] of Object.entries(def.stages)) {
      if (!VALID_STAGE_TYPES.includes(stage.type)) {
        errors.push(`stage "${name}": invalid type "${stage.type}"`);
      }
      if (stage.model && !VALID_MODELS.includes(stage.model)) {
        errors.push(`stage "${name}": invalid model "${stage.model}"`);
      }
      if (stage.outputFormat && !VALID_OUTPUT_FORMATS.includes(stage.outputFormat)) {
        errors.push(`stage "${name}": invalid outputFormat "${stage.outputFormat}"`);
      }
      // Branch requires condition + targets
      if (stage.type === 'branch') {
        if (!stage.condition) errors.push(`stage "${name}": branch requires condition`);
        if (!stage.onTrue) errors.push(`stage "${name}": branch requires onTrue`);
        if (!stage.onFalse) errors.push(`stage "${name}": branch requires onFalse`);
      }
      // fan_out requires branches + mergeTo
      if (stage.type === 'fan_out') {
        if (!stage.branches?.length) errors.push(`stage "${name}": fan_out requires branches[]`);
        if (!stage.mergeTo) errors.push(`stage "${name}": fan_out requires mergeTo`);
      }
      // merge requires sources
      if (stage.type === 'merge') {
        if (!stage.sources?.length) errors.push(`stage "${name}": merge requires sources[]`);
      }
    }
  }

  // Validate edges reference existing stages
  if (def.graph?.edges && def.stages) {
    for (const edge of def.graph.edges) {
      if (!def.stages[edge.from]) errors.push(`edge from "${edge.from}" not found in stages`);
      if (!def.stages[edge.to]) errors.push(`edge to "${edge.to}" not found in stages`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function applyDefaults(def) {
  return {
    version: 1,
    description: '',
    icon: '◈',
    color: '#6c63ff',
    builtIn: false,
    autoSelect: { keywords: [], domainHints: ['any'], description: '', ...def.autoSelect },
    framework: {
      criticPersonaTemplate: '',
      responderPersonaTemplate: '',
      evaluationDimensions: [],
      chatPersonaTemplate: '',
      quickActionTemplates: [],
      debateLabels: { panelTitle: 'PATTERN', panelIcon: '◈', startLabel: 'START', responderLabel: 'RESPONDER' },
      ...def.framework,
    },
    config: { maxRounds: 5, abortable: true, ...def.config },
    ...def,
    stages: Object.fromEntries(
      Object.entries(def.stages || {}).map(([name, stage]) => [
        name,
        {
          stream: false,
          terminal: false,
          critical: true,
          modelConfig: { maxTokens: 4096 },
          ...stage,
        },
      ])
    ),
  };
}

module.exports = { validatePattern, applyDefaults, VALID_STAGE_TYPES, VALID_MODELS };
