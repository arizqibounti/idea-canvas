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

// ── Mixture of Experts (MoE-inspired) ────────────────────────

const mixtureOfExperts = {
  id: 'mixture-of-experts',
  name: 'Expert Committee',
  description: 'Route subtrees to domain specialists for parallel deep analysis, then merge into a unified view. Inspired by Mixture of Experts routing.',
  icon: '⬡',
  color: '#14b8a6',
  builtIn: true,

  autoSelect: {
    keywords: ['complex', 'multidisciplinary', 'cross-functional', 'comprehensive', 'multi-domain', 'committee'],
    domainHints: ['any'],
    description: 'Best for complex problems spanning multiple domains that need specialist analysis',
  },

  framework: {
    criticPersonaTemplate: 'You are a synthesis evaluator checking whether the merged {{domain}} analysis is coherent and non-contradictory.',
    responderPersonaTemplate: 'You are a domain expert committee that provides deep specialist analysis.',
    evaluationDimensions: [
      { key: 'depth', label: 'DEPTH' },
      { key: 'coherence', label: 'COHERENCE' },
      { key: 'coverage', label: 'COVERAGE' },
    ],
    chatPersonaTemplate: 'You are a {{domain}} advisor with access to multi-expert analysis.',
    quickActionTemplates: [
      { label: 'Expert Comparison', prompt: 'Compare what each expert found and highlight where they agree vs disagree.' },
      { label: 'Blind Spots', prompt: 'What did no expert cover? Identify gaps between the specialist analyses.' },
    ],
    debateLabels: { panelTitle: 'EXPERT COMMITTEE', panelIcon: '⬡', startLabel: 'CONSULT EXPERTS', responderLabel: 'COMMITTEE' },
  },

  stages: {
    classify: {
      type: 'transform',
      model: 'gemini:flash',
      promptFallback: `Analyze the nodes in this {{domain}} tree and classify each into one of these expert domains: "market" (business strategy, competitive analysis, market sizing), "technical" (architecture, implementation, scalability, security), "design" (UX, user needs, information architecture), "operations" (process, team, timeline, risk).

Output JSON: { "classifications": { "node_id": "domain", ... }, "market_nodes": [...ids], "technical_nodes": [...ids], "design_nodes": [...ids], "operations_nodes": [...ids] }`,
      outputFormat: 'json',
      stream: false,
      modelConfig: { maxTokens: 4096 },
    },

    fan: {
      type: 'fan_out',
      branches: ['expert_market', 'expert_technical', 'expert_design'],
      mergeTo: 'synthesis',
    },

    expert_market: {
      type: 'generate',
      model: 'claude:sonnet',
      promptFallback: `You are a market strategy expert. Analyze the market-classified nodes in this tree and generate 5-8 new nodes that deepen the market analysis: competitive positioning, market sizing, go-to-market strategy, pricing, customer segmentation.

New node ids: "mkt_N". Reference existing nodes as parents where relevant.
Output: one JSON per line.`,
      outputFormat: 'node-stream',
      stream: true,
      modelConfig: { maxTokens: 6000 },
    },

    expert_technical: {
      type: 'generate',
      model: 'claude:sonnet',
      promptFallback: `You are a technical architecture expert. Analyze the technical nodes in this tree and generate 5-8 new nodes that deepen the technical analysis: system design, scalability concerns, tech stack decisions, security considerations, performance bottlenecks.

New node ids: "tech_N". Reference existing nodes as parents where relevant.
Output: one JSON per line.`,
      outputFormat: 'node-stream',
      stream: true,
      modelConfig: { maxTokens: 6000 },
    },

    expert_design: {
      type: 'generate',
      model: 'claude:sonnet',
      promptFallback: `You are a product design expert. Analyze the design-classified nodes in this tree and generate 5-8 new nodes that deepen the design analysis: user journeys, interaction patterns, information architecture, accessibility, design system decisions.

New node ids: "ux_N". Reference existing nodes as parents where relevant.
Output: one JSON per line.`,
      outputFormat: 'node-stream',
      stream: true,
      modelConfig: { maxTokens: 6000 },
    },

    synthesis: {
      type: 'merge',
      sources: ['expert_market', 'expert_technical', 'expert_design'],
      strategy: 'ai_merge',
      model: 'claude:sonnet',
      mergePrompt: `You are a synthesis strategist. Three domain experts have independently analyzed aspects of this tree. Merge their findings into a unified set of synthesis nodes that:
1. Resolve any contradictions between experts
2. Identify cross-cutting insights (where market + tech + design converge)
3. Surface the 3-5 most important cross-domain insights as new nodes

New node ids: "syn_N". Output: one JSON per line.`,
      terminal: true,
      modelConfig: { maxTokens: 8000 },
    },
  },

  graph: {
    entrypoint: 'classify',
    edges: [{ from: 'classify', to: 'fan' }],
  },

  config: { maxRounds: 1, abortable: true },
};

// ── Evolutionary (Genetic Algorithm-inspired) ────────────────

const evolutionary = {
  id: 'evolutionary',
  name: 'Evolutionary Search',
  description: 'Generate a population of tree variants, score them, select the fittest, crossover their best parts, and mutate. Inspired by genetic algorithms.',
  icon: '🧬',
  color: '#22c55e',
  builtIn: true,

  autoSelect: {
    keywords: ['creative', 'innovative', 'novel', 'breakthrough', 'unconventional', 'wild', 'surprising'],
    domainHints: ['any'],
    description: 'Best for creative exploration where you want surprising, non-obvious approaches',
  },

  framework: {
    criticPersonaTemplate: 'You are a fitness evaluator scoring {{domain}} approaches on novelty and viability.',
    responderPersonaTemplate: 'You are a creative mutator generating surprising variants of {{domain}} ideas.',
    evaluationDimensions: [
      { key: 'novelty', label: 'NOVELTY' },
      { key: 'viability', label: 'VIABILITY' },
      { key: 'surprise', label: 'SURPRISE' },
    ],
    chatPersonaTemplate: 'You are a {{domain}} innovation advisor who has seen the full evolution of ideas.',
    quickActionTemplates: [
      { label: 'Evolution Summary', prompt: 'Trace the evolutionary lineage — which traits survived from which generation?' },
      { label: 'Best Mutation', prompt: 'What was the single most valuable mutation across all generations?' },
    ],
    debateLabels: { panelTitle: 'EVOLUTION', panelIcon: '🧬', startLabel: 'EVOLVE', responderLabel: 'MUTATOR' },
  },

  stages: {
    generate_population: {
      type: 'generate',
      model: 'claude:opus',
      promptFallback: `Generate 3 genuinely different tree variants for this {{domain}} challenge. Each variant should take a RADICALLY different approach — not variations on the same theme.

For each variant, output a header: {"_alternative": true, "index": N, "title": "...", "thesis": "1 sentence"}
Then 6-8 nodes for that variant with ids prefixed "gen0_alt{N}_".

CRITICAL: Maximize diversity. If variant 1 is conservative, variant 2 should be radical. If variant 1 is bottom-up, variant 2 should be top-down.
Output: one JSON per line.`,
      outputFormat: 'node-stream',
      stream: true,
      modelConfig: { maxTokens: 12000 },
    },

    score_fitness: {
      type: 'score',
      model: 'gemini:pro',
      promptFallback: `Score each variant on fitness (1-10 per dimension):
- NOVELTY: How different is this from the obvious approach?
- VIABILITY: Could this actually work in practice?
- SURPRISE: Does this reveal something non-obvious?

Output JSON: { "variants": [{"index": N, "scores": {"novelty": N, "viability": N, "surprise": N}, "composite": N}], "fittest": [indices of top 2] }`,
      outputFormat: 'json',
      stream: false,
      dimensions: ['novelty', 'viability', 'surprise'],
      modelConfig: { maxTokens: 4096, extra: { thinkingConfig: { thinkingLevel: 'MEDIUM' } } },
    },

    crossover: {
      type: 'generate',
      model: 'claude:sonnet',
      promptFallback: `Take the fittest variants and CROSSOVER their best traits. Create a new hybrid tree that:
1. Keeps the strongest nodes from each surviving variant
2. Combines complementary strengths (e.g., one variant's market insight + another's technical approach)
3. Resolves conflicts by choosing the higher-scoring trait

Output 8-12 new nodes with ids prefixed "cross_". Each must reference parents from the surviving variants.
Output: one JSON per line.`,
      outputFormat: 'node-stream',
      stream: true,
      modelConfig: { maxTokens: 8000 },
    },

    mutate: {
      type: 'generate',
      model: 'claude:sonnet',
      promptFallback: `Apply MUTATIONS to the crossover result. For 2-3 nodes, apply one of these mutation operators:
- INVERT: Flip an assumption (what if the opposite were true?)
- WILDCARD: Insert a completely unexpected element from an unrelated domain
- AMPLIFY: Take a minor detail and make it the central focus
- SWAP: Replace a node's approach with one from a completely different industry

Output mutated nodes with ids prefixed "mut_". Mark each with "mutation": "invert|wildcard|amplify|swap".
Output: one JSON per line.`,
      outputFormat: 'node-stream',
      stream: true,
      modelConfig: { maxTokens: 4000 },
    },

    check_generations: {
      type: 'branch',
      condition: '{{round}} >= {{maxRounds}}',
      onTrue: 'finalize',
      onFalse: 'score_fitness',
    },

    finalize: {
      type: 'generate',
      model: 'claude:sonnet',
      promptFallback: `Select the single best evolved tree variant and output it as a clean, final tree. Remove dead-end mutations. Keep only the nodes that survived selection pressure.

Output: one JSON per line. Use clean ids prefixed "final_". Include _update nodes for any existing nodes that should be strengthened.`,
      outputFormat: 'node-stream',
      stream: true,
      terminal: true,
      modelConfig: { maxTokens: 8000 },
    },
  },

  graph: {
    entrypoint: 'generate_population',
    edges: [
      { from: 'generate_population', to: 'score_fitness' },
      { from: 'score_fitness', to: 'crossover' },
      { from: 'crossover', to: 'mutate' },
      { from: 'mutate', to: 'check_generations' },
      { from: 'check_generations', to: 'score_fitness', condition: 'loop' },
      { from: 'check_generations', to: 'finalize', condition: 'exit' },
    ],
  },

  config: { maxRounds: 2, abortable: true },
};

// ── Backpropagation (score chains, not nodes) ────────────────

const backpropagation = {
  id: 'backpropagation',
  name: 'Chain Strengthening',
  description: 'Score leaf nodes, propagate quality signals back through the tree to find weak reasoning chains, then strengthen the weakest ancestors. Inspired by neural network backpropagation.',
  icon: '↩',
  color: '#f97316',
  builtIn: true,

  autoSelect: {
    keywords: ['quality', 'strengthen', 'weak', 'shallow', 'vague', 'generic', 'depth'],
    domainHints: ['any'],
    description: 'Best for trees that look good on the surface but have weak reasoning chains underneath',
  },

  framework: {
    criticPersonaTemplate: 'You are a depth evaluator who traces reasoning chains from leaf to root, scoring each link in the {{domain}} tree.',
    responderPersonaTemplate: 'You are a chain strengthener who surgically fixes weak links in {{domain}} reasoning chains.',
    evaluationDimensions: [
      { key: 'chain_strength', label: 'CHAIN STRENGTH' },
      { key: 'leaf_quality', label: 'LEAF QUALITY' },
      { key: 'ancestor_support', label: 'ANCESTOR SUPPORT' },
    ],
    chatPersonaTemplate: 'You are a {{domain}} advisor focused on depth and rigor of reasoning.',
    quickActionTemplates: [
      { label: 'Weakest Chain', prompt: 'What is the single weakest reasoning chain from root to leaf in this tree?' },
      { label: 'Depth Report', prompt: 'Summarize the depth and quality of reasoning at each level of the tree.' },
    ],
    debateLabels: { panelTitle: 'BACKPROP', panelIcon: '↩', startLabel: 'STRENGTHEN CHAINS', responderLabel: 'STRENGTHENER' },
  },

  stages: {
    score_leaves: {
      type: 'transform',
      model: 'gemini:pro',
      promptFallback: `Score every LEAF node (nodes with no children) in this {{domain}} tree on 1-10:
- How specific and concrete is this leaf? (not generic or vague)
- How well does it support its parent's claim?
- Could someone act on this node alone?

Then for each leaf, trace back to root and score each LINK (parent-child relationship):
- Does the child actually support/elaborate the parent? Or is it tangentially related?

Output JSON: {
  "leafScores": [{"id": "...", "score": N, "reason": "..."}],
  "chainScores": [{"from": "parent_id", "to": "child_id", "linkStrength": N, "reason": "..."}],
  "weakestChains": [{"path": ["root_id", ..., "leaf_id"], "avgScore": N, "bottleneck": "node_id_with_weakest_link"}]
}`,
      outputFormat: 'json',
      stream: false,
      modelConfig: { maxTokens: 8000, extra: { thinkingConfig: { thinkingLevel: 'MEDIUM' } } },
    },

    strengthen: {
      type: 'generate',
      model: 'claude:sonnet',
      promptFallback: `You have scored the reasoning chains in this tree and found weak links. For the 3-5 weakest chains:

1. For weak LINKS (low linkStrength): Either rewrite the child node to better support its parent, or add an intermediate "bridge" node that makes the connection explicit.
2. For weak LEAVES (low leaf score): Rewrite with concrete specifics — names, numbers, timelines, examples.
3. For weak ANCESTORS (bottleneck nodes): Rewrite the node's reasoning to be more specific and load-bearing.

Output: {"_update": true, "id": "existing_id", ...} for rewrites, or new nodes with ids prefixed "bp_" for bridge nodes.
One JSON per line.`,
      outputFormat: 'node-stream',
      stream: true,
      modelConfig: { maxTokens: 8000 },
    },

    rescore: {
      type: 'score',
      model: 'gemini:flash',
      promptFallback: `Re-score the tree after strengthening. Has the average chain quality improved?
Output JSON: { "overallScore": N, "improvement": N, "feedback": "..." }`,
      outputFormat: 'json',
      stream: false,
      dimensions: ['chain_strength', 'leaf_quality', 'ancestor_support'],
      modelConfig: { maxTokens: 2048 },
    },

    check_quality: {
      type: 'branch',
      condition: '{{rescore.overallScore}} >= 8 || {{round}} >= {{maxRounds}}',
      onTrue: 'done',
      onFalse: 'score_leaves',
    },

    done: {
      type: 'transform',
      model: 'gemini:flash',
      promptFallback: 'Output: {"complete": true, "finalScore": {{rescore.overallScore}}, "rounds": {{round}}}',
      outputFormat: 'json',
      stream: false,
      terminal: true,
      modelConfig: { maxTokens: 256 },
    },
  },

  graph: {
    entrypoint: 'score_leaves',
    edges: [
      { from: 'score_leaves', to: 'strengthen' },
      { from: 'strengthen', to: 'rescore' },
      { from: 'rescore', to: 'check_quality' },
      { from: 'check_quality', to: 'score_leaves', condition: 'loop' },
      { from: 'check_quality', to: 'done', condition: 'exit' },
    ],
  },

  config: { maxRounds: 3, abortable: true },
};

// ── Compression / Distillation ───────────────────────────────

const compression = {
  id: 'compression',
  name: 'Distillation',
  description: 'Generate a deliberately large, detailed tree, then cluster semantically similar nodes, distill each cluster to its essence, and reconstruct a tight tree. Inspired by knowledge distillation.',
  icon: '◇',
  color: '#a855f7',
  builtIn: true,

  autoSelect: {
    keywords: ['summary', 'executive', 'elevator pitch', 'distill', 'compress', 'essence', 'core', 'tight'],
    domainHints: ['any'],
    description: 'Best when you need a concise, tight output from a complex exploration — executive summaries, elevator pitches',
  },

  framework: {
    criticPersonaTemplate: 'You are a distillation evaluator ensuring no essential insight is lost in the {{domain}} compression.',
    responderPersonaTemplate: 'You are a master synthesizer who extracts the essence of complex {{domain}} analysis.',
    evaluationDimensions: [
      { key: 'essential_captured', label: 'ESSENTIALS' },
      { key: 'redundancy_removed', label: 'EFFICIENCY' },
      { key: 'coherence', label: 'COHERENCE' },
    ],
    chatPersonaTemplate: 'You are a {{domain}} advisor who excels at crisp, essential summaries.',
    quickActionTemplates: [
      { label: 'What Was Lost', prompt: 'What insights from the original tree did NOT survive compression? Were any important?' },
      { label: 'Elevator Pitch', prompt: 'Distill this compressed tree into a single paragraph elevator pitch.' },
    ],
    debateLabels: { panelTitle: 'DISTILL', panelIcon: '◇', startLabel: 'DISTILL', responderLabel: 'SYNTHESIZER' },
  },

  stages: {
    cluster: {
      type: 'transform',
      model: 'gemini:pro',
      promptFallback: `Analyze all nodes in this {{domain}} tree and group semantically similar nodes into clusters. Two nodes belong in the same cluster if they:
- Address the same sub-topic
- Could be merged without losing distinct value
- Overlap significantly in their reasoning

Output JSON: {
  "clusters": [
    {"id": "c1", "label": "cluster theme", "nodeIds": ["id1", "id2", ...], "essence": "1 sentence capturing what this cluster is about"},
    ...
  ],
  "standalone": ["ids of nodes that don't cluster with anything"]
}`,
      outputFormat: 'json',
      stream: false,
      modelConfig: { maxTokens: 6000, extra: { thinkingConfig: { thinkingLevel: 'MEDIUM' } } },
    },

    distill: {
      type: 'generate',
      model: 'claude:sonnet',
      promptFallback: `For each cluster, generate a SINGLE distilled node that captures the essence of all nodes in that cluster. This distilled node should be more specific and concrete than any individual node — it should be the synthesis.

For standalone nodes, keep them as-is but sharpen their reasoning.

Output a NEW tight tree with 6-10 nodes total:
- One seed node (same as original)
- One distilled node per cluster
- Standalone nodes (if essential)

Use ids prefixed "dist_". Each must have parentIds linking to the seed or other distilled nodes.
Output: one JSON per line.`,
      outputFormat: 'node-stream',
      stream: true,
      terminal: true,
      modelConfig: { maxTokens: 6000 },
    },
  },

  graph: {
    entrypoint: 'cluster',
    edges: [{ from: 'cluster', to: 'distill' }],
  },

  config: { maxRounds: 1, abortable: true },
};

// ── RAG (Retrieval-Augmented per-node) ───────────────────────

const ragEnrich = {
  id: 'rag-enrich',
  name: 'Evidence Grounding',
  description: 'After generating a tree, retrieve external evidence for each node and rewrite them to be grounded in real data. Inspired by Retrieval-Augmented Generation.',
  icon: '🔍',
  color: '#0ea5e9',
  builtIn: true,

  autoSelect: {
    keywords: ['evidence', 'data', 'research', 'verify', 'fact-check', 'ground', 'substantiate', 'prove'],
    domainHints: ['any'],
    description: 'Best when you need every claim backed by external evidence — research, due diligence, fact-heavy analysis',
  },

  framework: {
    criticPersonaTemplate: 'You are an evidence auditor checking whether claims in this {{domain}} tree are substantiated by real data.',
    responderPersonaTemplate: 'You are a research analyst who grounds abstract claims in concrete evidence.',
    evaluationDimensions: [
      { key: 'evidence_quality', label: 'EVIDENCE' },
      { key: 'source_credibility', label: 'CREDIBILITY' },
      { key: 'claim_accuracy', label: 'ACCURACY' },
    ],
    chatPersonaTemplate: 'You are a {{domain}} research analyst with deep knowledge of the evidence behind each claim.',
    quickActionTemplates: [
      { label: 'Unverified Claims', prompt: 'Which nodes still have claims not backed by evidence?' },
      { label: 'Source Summary', prompt: 'List all external evidence sources used to ground this tree.' },
    ],
    debateLabels: { panelTitle: 'EVIDENCE GROUNDING', panelIcon: '🔍', startLabel: 'GROUND IN EVIDENCE', responderLabel: 'RESEARCHER' },
  },

  stages: {
    enrich: {
      type: 'enrich',
      source: 'research',
      perNode: false,
      critical: false,
    },

    identify_claims: {
      type: 'transform',
      model: 'gemini:flash',
      promptFallback: `Analyze each node in this {{domain}} tree and identify which ones make claims that need external evidence. Classify each node as:
- "grounded": Already has specific data, numbers, or named sources
- "needs_evidence": Makes a claim that should be backed by data (market sizes, statistics, precedents)
- "opinion": Subjective judgment that can't be fact-checked

Output JSON: { "nodes": [{"id": "...", "status": "grounded|needs_evidence|opinion", "claim": "what needs verifying"}] }`,
      outputFormat: 'json',
      stream: false,
      modelConfig: { maxTokens: 4096 },
    },

    ground: {
      type: 'generate',
      model: 'claude:sonnet',
      promptFallback: `For each node flagged as "needs_evidence", rewrite it with concrete evidence from the research context provided. Each rewritten node should include:
- Specific data points (numbers, percentages, dollar amounts)
- Named sources where possible
- Date/recency indicators

Output: {"_update": true, "id": "existing_id", "label": "...", "reasoning": "rewritten with evidence: [specific data]"}
For claims where no evidence was found, add a child node flagging it: {"id": "unverified_N", "parentId": "...", "type": "constraint", "label": "Unverified claim", "reasoning": "No supporting evidence found for: [claim]"}

One JSON per line.`,
      outputFormat: 'node-stream',
      stream: true,
      terminal: true,
      modelConfig: { maxTokens: 10000 },
    },
  },

  graph: {
    entrypoint: 'enrich',
    edges: [
      { from: 'enrich', to: 'identify_claims' },
      { from: 'identify_claims', to: 'ground' },
    ],
  },

  config: { maxRounds: 1, abortable: true },
};

module.exports = [adversarial, progressiveRefine, portfolioExplore, diffusion, mixtureOfExperts, evolutionary, backpropagation, compression, ragEnrich];
