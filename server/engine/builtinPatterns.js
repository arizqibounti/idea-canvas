// ── Built-in Thinking Patterns ────────────────────────────────
// These map the existing hardcoded pipelines (debate, refine, portfolio)
// into the pattern schema, plus new DL-inspired patterns.

const adversarial = {
  id: 'adversarial',
  name: 'Adversarial Critique',
  description: 'Generator vs critic, iterated until consensus. Inspired by GANs — a discriminator attacks the tree while a responder strengthens it.',
  icon: '⚔',
  color: '#ff4757',
  builtIn: true,

  autoSelect: {
    keywords: ['debate', 'critique', 'stress test', 'challenge', 'review', 'audit', 'devil\'s advocate', 'vet', 'validate'],
    domainHints: ['any'],
    description: 'Best when you want adversarial stress-testing of ideas, plans, or analyses',
  },

  framework: {
    criticPersonaTemplate: 'You are a ruthless {{domain}} critic who challenges assumptions, surfaces blind spots, and demands specificity. You evaluate the {{treeLabel}} with the sharpness of someone who has seen hundreds fail.',
    responderPersonaTemplate: 'You are an expert {{domain}} architect who addresses each critique with specific, concrete, evidence-based improvements. You defend with substance, not rhetoric.',
    evaluationDimensions: [
      { key: 'feasibility', label: 'FEASIBILITY' },
      { key: 'specificity', label: 'SPECIFICITY' },
      { key: 'completeness', label: 'COMPLETENESS' },
      { key: 'evidence', label: 'EVIDENCE' },
      { key: 'blindspot', label: 'BLINDSPOT' },
      { key: 'risk', label: 'RISK' },
    ],
    chatPersonaTemplate: 'You are a {{domain}} strategist who has deep context on the thinking tree and can answer questions, suggest improvements, and help the user refine their work.',
    quickActionTemplates: [
      { label: 'Write Proposal', prompt: 'Write a structured proposal based on this thinking tree. Include an executive summary, problem statement, proposed solution, key metrics, and next steps.' },
      { label: 'Draft Email', prompt: 'Draft a professional email summarizing this analysis. Make it suitable for sharing with stakeholders.' },
      { label: 'Key Insights', prompt: 'Extract the 5 most important insights from this thinking tree, ranked by impact.' },
      { label: 'Action Plan', prompt: 'Create a prioritized action plan based on the insights and recommendations in this tree.' },
    ],
    debateLabels: {
      panelTitle: 'ADVERSARIAL CRITIQUE',
      panelIcon: '⚔',
      startLabel: 'START CRITIQUE',
      responderLabel: 'ARCHITECT',
    },
  },

  stages: {
    critique: {
      type: 'transform',
      model: 'gemini:pro',
      promptKey: 'PATTERN_ADVERSARIAL_CRITIQUE',
      promptFallback: `You are a {{framework.criticPersona}}

Your job: generate 6-10 critique nodes that stress-test this {{framework.treeLabel}}.

**EVALUATION CATEGORIES — assess each dimension:**
{{#each framework.evaluationDimensions}}
- **{{label}}**: Evaluate this dimension thoroughly. Name specific nodes, specific gaps, specific risks.
{{/each}}

**Output format — valid JSON object, nothing else:**
{
  "verdict": "NO" | "YES",
  "satisfied": false | true,
  "round_summary": "string (2-3 sentences)",
  "critiques": [
    {
      "id": "string (e.g. dc_1)",
      "targetNodeId": "string (real id from the tree)",
      "targetNodeLabel": "string",
      "category": "string (one of the evaluation dimensions)",
      "challenge": "string (1 punchy sentence, max 12 words)",
      "reasoning": "string (2-3 sentences with specifics)"
    }
  ],
  "suggestions": ["string (specific, actionable improvements)"]
}

**Verdict rules:**
- "YES" / satisfied:true = This tree is sound — major risks addressed, specifics are concrete.
- "NO" / satisfied:false = Significant weaknesses remain.
- You CAN say YES in round 1 if the analysis is genuinely strong.

Output ONLY the JSON object. No markdown fences, no explanation.`,
      outputFormat: 'json',
      stream: false,
      modelConfig: { maxTokens: 10000, extra: { thinkingConfig: { thinkingLevel: 'MEDIUM' } } },
    },

    respond: {
      type: 'generate',
      model: 'gemini:pro',
      promptKey: 'PATTERN_ADVERSARIAL_RESPOND',
      promptFallback: `You are a {{framework.responderPersona}}

A critic has challenged this {{framework.treeLabel}}. Your job: address each critique by generating new nodes with specific improvements.

For each critique, respond with a new node that directly addresses the gap:
- Be ruthlessly concrete. Vague improvements are rejected.
- parentId must be the targetNodeId from the critique being addressed.
- All new ids must be prefixed with "rebut_r{{round}}_"
- Do NOT re-output existing nodes. Only generate new ones.

Output rules: one JSON object per line, no markdown, no arrays.
Each node: {"id": "string", "parentId": "string", "type": "string", "label": "string (max 8 words)", "reasoning": "string (2-3 sentences)"}`,
      outputFormat: 'node-stream',
      stream: true,
      modelConfig: { maxTokens: 12000, extra: { thinkingConfig: { thinkingLevel: 'MEDIUM' } } },
    },

    check_consensus: {
      type: 'branch',
      condition: '{{critique.satisfied}} === true || {{round}} >= {{maxRounds}}',
      onTrue: 'finalize',
      onFalse: 'critique',
    },

    finalize: {
      type: 'generate',
      model: 'gemini:pro',
      promptKey: 'PATTERN_ADVERSARIAL_FINALIZE',
      promptFallback: `You are a {{domain}} strategist synthesizing a completed critique session into tree updates.

**WHAT TO DO:**
1. Review which nodes were challenged and what improvements were established
2. UPDATE challenged nodes with sharper reasoning ({"_update": true, "id": "existing-id", ...})
3. ADD new synthesis nodes for gaps that rebuttals didn't cover ({"id": "final_N", ...})

**STRICT RULES:**
- Only update nodes that were directly challenged
- Updated reasoning MUST embed the specific evidence from the debate
- Do NOT output critique or rebuttal nodes
- Output 3-8 nodes total

Output ONLY node JSON objects, one per line. No markdown.`,
      outputFormat: 'node-stream',
      stream: true,
      terminal: true,
      modelConfig: { maxTokens: 8000, extra: { thinkingConfig: { thinkingLevel: 'MEDIUM' } } },
    },
  },

  graph: {
    entrypoint: 'critique',
    edges: [
      { from: 'critique', to: 'respond' },
      { from: 'respond', to: 'check_consensus' },
      { from: 'check_consensus', to: 'critique', condition: 'loop' },
      { from: 'check_consensus', to: 'finalize', condition: 'exit' },
    ],
  },

  config: { maxRounds: 5, abortable: true },
};

// ── Progressive Refine (maps current auto-refine loop) ───────

const progressiveRefine = {
  id: 'progressive-refine',
  name: 'Progressive Refinement',
  description: 'Critique → Research-Enrich → Strengthen → Score loop. Iteratively improves tree quality until score threshold is met.',
  icon: '⟳',
  color: '#f59e0b',
  builtIn: true,

  autoSelect: {
    keywords: ['refine', 'improve', 'strengthen', 'polish', 'iterate', 'quality'],
    domainHints: ['any'],
    description: 'Best for iteratively improving an existing tree with research-backed enhancements',
  },

  framework: {
    criticPersonaTemplate: 'You are a quality evaluator analyzing a {{domain}} {{treeLabel}} for weaknesses in specificity, actionability, and evidence.',
    responderPersonaTemplate: 'You are a surgical tree improver who fixes specific weaknesses with concrete, research-backed improvements.',
    evaluationDimensions: [
      { key: 'specificity', label: 'SPECIFICITY' },
      { key: 'actionability', label: 'ACTIONABILITY' },
      { key: 'evidence', label: 'EVIDENCE' },
      { key: 'depth', label: 'DEPTH' },
    ],
    chatPersonaTemplate: 'You are a {{domain}} advisor with deep context on the refined thinking tree.',
    quickActionTemplates: [
      { label: 'Summary', prompt: 'Summarize the key improvements made during refinement.' },
      { label: 'Weak Spots', prompt: 'What areas still need the most work?' },
    ],
    debateLabels: {
      panelTitle: 'AUTO-REFINE',
      panelIcon: '⟳',
      startLabel: 'START REFINE',
      responderLabel: 'IMPROVER',
    },
  },

  stages: {
    critique: {
      type: 'transform',
      model: 'claude:sonnet',
      promptKey: 'PATTERN_REFINE_CRITIQUE',
      promptFallback: `Analyze this {{framework.treeLabel}} and identify 3-6 weaknesses.

For each weakness, specify:
- nodeLabel: which node is weak
- reason: what's wrong (be specific)
- severity: "high" | "medium" | "low"
- approach: "expand" | "deepen" | "rewrite" | "add_evidence"

Output JSON: { "weaknesses": [...] }`,
      outputFormat: 'json',
      stream: false,
      modelConfig: { maxTokens: 4096 },
    },

    enrich: {
      type: 'enrich',
      source: 'research',
      perNode: false,
      critical: false,
    },

    strengthen: {
      type: 'generate',
      model: 'claude:sonnet',
      promptKey: 'PATTERN_REFINE_STRENGTHEN',
      promptFallback: `You are a surgical tree improver. For each weakness identified, generate new or updated nodes that fix the issue.

Approaches:
- "expand": Add 2-3 child nodes exploring the gap
- "deepen": Rewrite the node's reasoning with more depth
- "rewrite": Change the label and reasoning entirely
- "add_evidence": Add a child node with specific data/metrics

New node ids: "ref_r{{round}}_N". Updated nodes: {"_update": true, "id": "existing-id", ...}
Output: one JSON per line.`,
      outputFormat: 'node-stream',
      stream: true,
      modelConfig: { maxTokens: 8000 },
    },

    score: {
      type: 'score',
      model: 'gemini:flash',
      promptKey: 'PATTERN_REFINE_SCORE',
      promptFallback: `Score the overall quality of this {{framework.treeLabel}} on a scale of 1-10:
- 9-10: Production-ready, specific, actionable
- 7-8: Strong with minor gaps
- 5-6: Decent but vague
- 3-4: Weak, generic
- 1-2: Hand-waving

Output JSON: { "overallScore": N, "feedback": "1-2 sentences" }`,
      outputFormat: 'json',
      stream: false,
      dimensions: ['relevance', 'specificity', 'actionability'],
      modelConfig: { maxTokens: 2048 },
    },

    check_quality: {
      type: 'branch',
      condition: '{{score.overallScore}} >= 8 || {{round}} >= {{maxRounds}}',
      onTrue: 'done',
      onFalse: 'critique',
    },

    done: {
      type: 'transform',
      model: 'gemini:flash',
      promptFallback: 'Output: {"complete": true, "finalScore": {{score.overallScore}}, "rounds": {{round}}}',
      outputFormat: 'json',
      stream: false,
      terminal: true,
      modelConfig: { maxTokens: 256 },
    },
  },

  graph: {
    entrypoint: 'critique',
    edges: [
      { from: 'critique', to: 'enrich' },
      { from: 'enrich', to: 'strengthen' },
      { from: 'strengthen', to: 'score' },
      { from: 'score', to: 'check_quality' },
      { from: 'check_quality', to: 'critique', condition: 'loop' },
      { from: 'check_quality', to: 'done', condition: 'exit' },
    ],
  },

  config: { maxRounds: 3, abortable: true },
};

// ── Portfolio Explore (maps current portfolio generation) ────

const portfolioExplore = {
  id: 'portfolio-explore',
  name: 'Portfolio Exploration',
  description: 'Generate multiple alternative approaches, score them, rank them. Inspired by ensemble methods — multiple independent views reduce bias.',
  icon: '◇',
  color: '#cc5de8',
  builtIn: true,

  autoSelect: {
    keywords: ['alternatives', 'portfolio', 'options', 'approaches', 'compare', 'explore', 'brainstorm'],
    domainHints: ['any'],
    description: 'Best for generating and comparing multiple alternative approaches to a problem',
  },

  framework: {
    criticPersonaTemplate: 'You are a comparative analyst evaluating alternative {{domain}} approaches.',
    responderPersonaTemplate: 'You are a creative strategist generating genuinely different {{domain}} approaches.',
    evaluationDimensions: [
      { key: 'feasibility', label: 'FEASIBILITY' },
      { key: 'innovation', label: 'INNOVATION' },
      { key: 'risk', label: 'RISK' },
      { key: 'impact', label: 'IMPACT' },
    ],
    chatPersonaTemplate: 'You are a {{domain}} strategist who can compare approaches and help the user choose.',
    quickActionTemplates: [
      { label: 'Compare', prompt: 'Create a detailed comparison of all alternatives with tradeoffs.' },
      { label: 'Recommend', prompt: 'Which alternative do you recommend and why?' },
    ],
    debateLabels: {
      panelTitle: 'PORTFOLIO',
      panelIcon: '◇',
      startLabel: 'EXPLORE ALTERNATIVES',
      responderLabel: 'STRATEGIST',
    },
  },

  stages: {
    enrich: {
      type: 'enrich',
      source: 'research',
      perNode: false,
      critical: false,
    },

    generate_alternatives: {
      type: 'generate',
      model: 'claude:opus',
      promptKey: 'PATTERN_PORTFOLIO_GENERATE',
      promptFallback: `Generate 3-5 genuinely different alternative approaches to this {{domain}} challenge.

For EACH alternative:
1. Output a header line: {"_alternative": true, "index": N, "title": "...", "thesis": "1 sentence", "approach": "1 sentence"}
2. Then output 8-12 analysis nodes for that alternative using the tree's node types.
   - Use ids prefixed with "alt{N}_" (e.g. "alt1_feature_1")
   - The first node of each alternative should have parentIds: [] (new root)

CRITICAL: Each alternative must be GENUINELY different — not variations on the same idea.
Output: one JSON per line.`,
      outputFormat: 'node-stream',
      stream: true,
      modelConfig: { maxTokens: 16000 },
    },

    score_alternatives: {
      type: 'score',
      model: 'gemini:pro',
      promptKey: 'PATTERN_PORTFOLIO_SCORE',
      promptFallback: `Score each alternative on these dimensions (1-10 each):
{{#each framework.evaluationDimensions}}
- {{label}}: Rate 1-10
{{/each}}

Output JSON: {
  "alternatives": [
    { "index": N, "title": "...", "scores": {"dim1": N, ...}, "composite": N, "strengths": "...", "weaknesses": "..." }
  ],
  "recommendation": "Which alternative is best and why (1-2 sentences)"
}`,
      outputFormat: 'json',
      stream: false,
      terminal: true,
      dimensions: ['feasibility', 'innovation', 'risk', 'impact'],
      modelConfig: { maxTokens: 4096 },
    },
  },

  graph: {
    entrypoint: 'enrich',
    edges: [
      { from: 'enrich', to: 'generate_alternatives' },
      { from: 'generate_alternatives', to: 'score_alternatives' },
    ],
  },

  config: { maxRounds: 1, abortable: true },
};

// ── Diffusion (new DL-inspired pattern) ──────────────────────

const diffusion = {
  id: 'diffusion',
  name: 'Diffusion Refinement',
  description: 'Start coarse, iteratively sharpen. Inspired by diffusion models — begin with a vague "noisy" sketch and progressively add detail, removing noise at each step.',
  icon: '🌊',
  color: '#0ea5e9',
  builtIn: true,

  autoSelect: {
    keywords: ['explore', 'vague', 'rough idea', 'not sure', 'brainstorm', 'early stage', 'sketch'],
    domainHints: ['any'],
    description: 'Best for exploratory problems where the user has a vague idea and wants to progressively clarify it',
  },

  framework: {
    criticPersonaTemplate: 'You are a clarity enforcer who scores every node on specificity and prunes anything vague or generic from a {{domain}} analysis.',
    responderPersonaTemplate: 'You are a detail architect who takes vague concepts in {{domain}} and adds concrete names, numbers, timelines, and examples.',
    evaluationDimensions: [
      { key: 'specificity', label: 'SPECIFICITY' },
      { key: 'concreteness', label: 'CONCRETENESS' },
      { key: 'actionability', label: 'ACTIONABILITY' },
    ],
    chatPersonaTemplate: 'You are a {{domain}} advisor helping progressively clarify and sharpen a rough idea.',
    quickActionTemplates: [
      { label: 'Sharpen More', prompt: 'Which nodes are still vague? Identify and suggest concrete replacements.' },
      { label: 'Extract Core', prompt: 'What is the single most important insight that emerged from this diffusion process?' },
    ],
    debateLabels: {
      panelTitle: 'DIFFUSION',
      panelIcon: '🌊',
      startLabel: 'START DIFFUSION',
      responderLabel: 'SHARPENER',
    },
  },

  stages: {
    sketch: {
      type: 'generate',
      model: 'gemini:flash',
      promptKey: 'PATTERN_DIFFUSION_SKETCH',
      promptFallback: `Generate a rough, high-level sketch tree with 6-8 nodes. These are broad strokes — it's OK to be vague at this stage. Think of this as the "noisy" starting point.

Use the tree's declared node types. Each node: {"id": "sk_N", "parentIds": [...], "type": "...", "label": "max 8 words", "reasoning": "1 sentence, can be broad"}

Output: _meta line first, then nodes. One JSON per line.`,
      outputFormat: 'node-stream',
      stream: true,
      modelConfig: { maxTokens: 2048 },
    },

    expand: {
      type: 'generate',
      model: 'claude:sonnet',
      promptKey: 'PATTERN_DIFFUSION_EXPAND',
      promptFallback: `Take each node in the existing tree and add 2-3 children that add one level of detail. Don't make them perfectly specific yet — add structure and direction.

New node ids: "ex_N". Each must reference a parentId from the existing tree.
Target: 15-20 new nodes total.
Output: one JSON per line.`,
      outputFormat: 'node-stream',
      stream: true,
      modelConfig: { maxTokens: 6000 },
    },

    detail: {
      type: 'generate',
      model: 'claude:sonnet',
      promptKey: 'PATTERN_DIFFUSION_DETAIL',
      promptFallback: `Now add concrete specifics to every node that is still vague. For each vague node, either:
1. Rewrite it with specifics: {"_update": true, "id": "existing_id", "label": "concrete label", "reasoning": "specific details"}
2. Add 1-2 child nodes with concrete examples, numbers, names, timelines.

New node ids: "dt_N". Output: one JSON per line.`,
      outputFormat: 'node-stream',
      stream: true,
      modelConfig: { maxTokens: 8000 },
    },

    sharpen: {
      type: 'transform',
      model: 'gemini:pro',
      promptKey: 'PATTERN_DIFFUSION_SHARPEN',
      promptFallback: `Score every node 1-10 on specificity. A node scores low if:
- The label could apply to any domain ("improve quality", "user experience")
- The reasoning doesn't name anything concrete (no names, numbers, timelines)
- It restates the obvious without adding value

Output JSON: {
  "nodeScores": [{"id": "...", "score": N, "reason": "..."}],
  "nodesToRemove": ["id1", "id2"],
  "nodesToRewrite": [{"id": "...", "suggestedLabel": "...", "suggestedReasoning": "..."}]
}`,
      outputFormat: 'json',
      stream: false,
      modelConfig: { maxTokens: 6000, extra: { thinkingConfig: { thinkingLevel: 'MEDIUM' } } },
    },

    reconstruct: {
      type: 'generate',
      model: 'claude:sonnet',
      promptKey: 'PATTERN_DIFFUSION_RECONSTRUCT',
      promptFallback: `Apply the sharpening feedback:
1. Remove nodes flagged for removal (do NOT output them)
2. Rewrite nodes flagged for rewriting: {"_update": true, "id": "...", ...}
3. For any remaining vague nodes (score < 5), rewrite with concrete specifics

Output: one JSON per line. Only output _update nodes and any new replacement nodes.`,
      outputFormat: 'node-stream',
      stream: true,
      terminal: true,
      modelConfig: { maxTokens: 8000 },
    },
  },

  graph: {
    entrypoint: 'sketch',
    edges: [
      { from: 'sketch', to: 'expand' },
      { from: 'expand', to: 'detail' },
      { from: 'detail', to: 'sharpen' },
      { from: 'sharpen', to: 'reconstruct' },
    ],
  },

  config: { maxRounds: 1, abortable: true },
};

module.exports = [adversarial, progressiveRefine, portfolioExplore, diffusion];
