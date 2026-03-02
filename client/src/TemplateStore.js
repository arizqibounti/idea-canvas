const TEMPLATES_KEY = 'THOUGHT_TEMPLATES';
const MAX_TEMPLATES = 20;

export function readTemplates() {
  try { return JSON.parse(localStorage.getItem(TEMPLATES_KEY) || '[]'); }
  catch { return []; }
}

export function saveTemplate(template) {
  const templates = readTemplates();
  const newTemplate = {
    id: `tpl_${Date.now()}`,
    domain: template.domain || 'general',
    idea_summary: template.idea_summary || '',
    structure: template.structure || [],
    timestamp: Date.now(),
    useCount: 0,
  };
  const updated = [newTemplate, ...templates].slice(0, MAX_TEMPLATES);
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(updated));
  return updated;
}

export function findMatchingTemplate(domain) {
  const templates = readTemplates();
  if (!templates.length) return null;

  const domainLower = (domain || '').toLowerCase();

  // Exact domain match
  const exactMatch = templates.find(t =>
    t.domain.toLowerCase() === domainLower
  );
  if (exactMatch) {
    incrementUseCount(exactMatch.id);
    return exactMatch;
  }

  // Partial domain match
  const partialMatch = templates.find(t =>
    domainLower.includes(t.domain.toLowerCase()) ||
    t.domain.toLowerCase().includes(domainLower)
  );
  if (partialMatch) {
    incrementUseCount(partialMatch.id);
    return partialMatch;
  }

  return null;
}

function incrementUseCount(templateId) {
  const templates = readTemplates();
  const updated = templates.map(t =>
    t.id === templateId ? { ...t, useCount: t.useCount + 1 } : t
  );
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(updated));
}
