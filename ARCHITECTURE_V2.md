# ThoughtClaw Architecture v2 — Refactor Plan

## Implementation Status

| # | Item | Status | Files |
|---|------|--------|-------|
| 1 | Provider abstraction layer | ✅ Done | `server/ai/providers.js` |
| 2 | Prompt caching | ✅ Done | Built into providers.js (`cache_control: ephemeral`) |
| 3 | Unified tool registry | ✅ Done | `server/ai/registry.js` |
| 4 | Generic loop controller (client) | ✅ Done | `client/src/useAgentLoop.js` |
| 5 | Research-as-a-tool with caching | ✅ Done | `server/ai/research.js` (30min cache, Gemini grounding + classic fallback) |
| 6 | Abort signal propagation | ✅ Done | `server/utils/sse.js` (`attachAbortSignal`) |
| 7 | Batch API for scoring | ✅ Done | Built into providers.js (`submitBatch`, `pollBatch`) |
| 10 | Gemini grounding for research | ✅ Done | Built into `server/ai/research.js` (`callWithGrounding`) |

### Migrated Engines (using provider abstraction)
- `server/engine/learn.js` — ✅ All 5 handlers migrated
- `server/engine/analyze.js` — ✅ All 5 handlers migrated

### Remaining Engine Migrations (backward-compatible, can be done incrementally)
- `server/engine/generate.js` — Still uses raw `client.messages.stream()`
- `server/engine/debate.js` — Still uses raw `gemini.models.generateContent()`
- `server/engine/refine.js` — Still uses raw `client.messages.create()`
- `server/engine/portfolio.js` — Still uses raw `gemini.models.generateContentStream()`
- `server/engine/experiment.js` — Still uses raw `client.messages.stream()`
- `server/engine/chat.js` — Still uses raw `client.messages.stream()`
- `server/engine/nodeTools.js` — Still uses raw `client.messages.stream()`
- `server/utils/research.js` — Superseded by `server/ai/research.js` but still used as fallback

---

## Context
Deep analysis of our codebase + research on OpenClaw (320K★ agent framework), Claude API (March 2026), Gemini API, and modern agent architecture patterns.

---

## Problem 1: Every Engine is a Bespoke Monolith
We have 12 engine files — each hardcodes its model, streaming mode, prompt construction, response parsing, and duplicates research pipeline logic.

**Solution: Unified Tool Registry (Everything-as-a-Tool)**

Each capability becomes a declarative config. The runtime handles model dispatch, streaming, error handling, abort signals, and knowledge persistence. Adding a new capability = adding a config entry, not a new Express handler.

```
ToolRegistry
  ├── generate-tree    { model: 'opus', stream: true, prompt: SYSTEM_PROMPT }
  ├── refine-critique  { model: 'sonnet', stream: false, prompt: REFINE_CRITIQUE }
  ├── debate-critique  { model: 'gemini', stream: false, prompt: CRITIC_PROMPT }
  ├── learn-teach      { model: 'sonnet', stream: false, prompt: TEACH_PROMPT }
  └── ...
```

---

## Problem 2: AI Provider Lock-in
Claude hardcoded in 8 places, Gemini in 4. Can't swap models without code changes.

**Solution: Provider Abstraction Layer**

```js
const stream = await ai.call('generate-tree', {
  provider: config.providers.generation,
  system: prompt,
  messages,
  stream: true,
});
```

Normalizes: tool schemas, response formats, streaming protocols, node output format.

---

## Problem 3: Client Orchestration Loops are Duplicated
`useAutoRefine`, `useLearnLoop`, `useExperimentLoop` all implement the same pattern.

**Solution: Generic Loop Controller**

```js
const refineLoop = useAgentLoop({
  steps: [
    { name: 'critique', endpoint: '/api/refine/critique', stream: false },
    { name: 'strengthen', endpoint: '/api/refine/strengthen', stream: true },
    { name: 'score', endpoint: '/api/refine/score', stream: false },
  ],
  shouldContinue: (result, round) => result.score < 8 && round < maxRounds,
  onStepComplete: (step, data) => updateUI(step, data),
});
```

---

## Problem 4: Research Pipeline Duplication
Research enrichment (plan → 3 agents → brief → lens analysis) copy-pasted across refine.js, portfolio.js, generate.js.

**Solution: Research-as-a-Tool**

```js
const brief = await ai.call('research', {
  topic: idea, depth: 'deep',
  lenses: ['adversarial', 'first-principles', 'analogical'],
});
```

---

## Problem 5: No Abort Handling
If user navigates away mid-generation, server keeps streaming. Only execute.js uses AbortController.

**Solution: Pass `req.signal` through to all AI calls.**

---

## Problem 6: Missing Cost Optimizations

**Prompt Caching** — System prompts are identical across requests. 90% discount on cached tokens.

**Batch API** — For non-interactive operations (scoring, clustering), 50% cost reduction. Stacks with caching.

---

## Problem 7: Custom Research Pipeline vs Native Grounding

**Solution: Gemini Grounding** — Use Gemini's built-in Google Search grounding instead of our custom Serper/Zyte pipeline for research enrichment. Native, cheaper, more reliable.

---

## Proposed Architecture (v2)

```
┌─────────────────────────────────────────────┐
│                   Client                     │
│  useAgentLoop() ← generic loop controller    │
│  EventStream ← single SSE/WS connection      │
│  ReactFlow canvas ← unchanged                │
└─────────────┬───────────────────────────────┘
              │ SSE / WebSocket
┌─────────────▼───────────────────────────────┐
│              API Gateway                      │
│  Express routes → ToolDispatcher              │
│  Auth, rate-limit, abort signal               │
└─────────────┬───────────────────────────────┘
              │
┌─────────────▼───────────────────────────────┐
│           Tool Registry                       │
│  tools.json: declarative tool configs         │
│  Each tool: { provider, model, stream,        │
│              prompt, inputSchema, hooks }      │
│  Hooks: beforeCall, afterCall, onNode         │
└─────────────┬───────────────────────────────┘
              │
┌─────────────▼───────────────────────────────┐
│         Provider Abstraction                  │
│  claude.call() | gemini.call() | openai.call()│
│  Unified streaming, tool schemas, parsing     │
│  Prompt caching, batching, abort signals      │
└─────────────┬───────────────────────────────┘
              │
┌─────────────▼───────────────────────────────┐
│        Persistence Layer                      │
│  Sessions, Knowledge Graph, Mastery           │
│  Auto-save on every tool completion           │
│  Version history                              │
└─────────────────────────────────────────────┘
```

---

## Implementation Order

| # | Idea | Impact | Effort | Priority |
|---|------|--------|--------|----------|
| 1 | Provider abstraction layer | High | Medium | **P0** |
| 2 | Prompt caching | High — 90% cost reduction | Low | **P0** |
| 3 | Unified tool registry | High — eliminates duplication | High | **P1** |
| 4 | Generic loop controller (client) | Medium — eliminates hook duplication | Medium | **P1** |
| 5 | Research-as-a-tool with caching | Medium — deduplicates + saves cost | Medium | **P1** |
| 6 | Abort signal propagation | Medium — stops wasted compute | Low | **P2** |
| 7 | Batch API for scoring | Medium — 50% cost savings | Low | **P2** |
| 10 | Gemini grounding for research | Medium — replaces custom pipeline | Medium | **P3** |

---

---

## Thinking Patterns System (v3 Architecture)

### Problem: Every Pipeline is Hardcoded

The debate, refine, and portfolio pipelines are hardcoded as separate Express handlers with mode-specific prompts (~200 lines × 7 modes × 5 stages). Adding a new processing pattern (e.g., diffusion-style iterative refinement) requires writing new handlers, hooks, and UI components.

### Solution: Declarative Thinking Patterns

A **thinking pattern** is a JSON document defining a composable processing graph. Patterns replace hardcoded pipelines with a graph of stages that the executor walks at runtime.

```
PatternDefinition
  ├── stages: { [name]: StageDef }      # Named stage definitions
  ├── graph: { entrypoint, edges[] }     # DAG connecting stages
  ├── framework: { critic, responder, chat, quickActions }  # UI metadata
  ├── autoSelect: { keywords, domainHints }  # AI pattern recommendation
  └── config: { maxRounds, abortable }   # Execution config
```

**9 stage types**: `generate` (stream nodes), `transform` (JSON output), `score` (with dimension aggregation), `branch` (conditional routing), `loop` (iterated body), `merge` (combine parallel results), `filter` (prune nodes), `enrich` (research/knowledge injection), `fan_out` (parallel execution).

### Built-in Patterns

| Pattern | Stages | Maps to |
|---------|--------|---------|
| `adversarial` | critique → respond → branch → finalize | Current debate |
| `progressive-refine` | critique → enrich → strengthen → score → branch | Current refine |
| `portfolio-explore` | enrich → generate-alternatives → score | Current portfolio |
| `diffusion` | sketch → expand → detail → sharpen → reconstruct | NEW |

### Pattern Executor

`server/engine/patternExecutor.js` — State machine that:
- Walks the stage graph from entrypoint
- Executes each stage via `ai.call()` or `ai.stream()` from the provider abstraction
- Handles branching (safe expression evaluator, no `eval()`), looping, fan-out/merge
- Streams SSE events: `_patternProgress`, `_patternStageResult`, `_checkpoint`, `_patternComplete`
- Emits checkpoints at branch/loop points for client intervention
- Propagates abort signals through all AI calls

### Extended _meta Protocol

Generation now includes pattern selection:
```json
{"_meta": true, "domain": "...", "types": [...], "pattern": "adversarial", "frameworkSkeleton": {"criticRole": "...", "evaluationDimensions": [...]}}
```

### Admin UI

Settings > PATTERNS tab — two-pane editor with:
- Visual DAG renderer (SVG arrows + positioned stage boxes)
- Form-based stage editor (type, model, prompt template with `{{slot}}` interpolation)
- AI-assisted prompt generation/improvement (reuses `/api/prompt-improve/`)
- Test runner (execute pattern against sample input, view stage-by-stage results)
- Version history with revert
- AI pattern generation from natural language descriptions

### Files

| File | Purpose |
|------|---------|
| `server/engine/patternSchema.js` | Validation + defaults |
| `server/engine/patternExecutor.js` | Core state machine |
| `server/engine/patternHandler.js` | Express handlers (execute, resume, recommend, generate) |
| `server/engine/patternLoader.js` | In-memory cache + hot-reload |
| `server/engine/builtinPatterns.js` | 4 built-in pattern definitions |
| `server/gateway/patternStore.js` | Firestore/memory CRUD with versioning |
| `server/routes/patterns.js` | REST CRUD router |
| `client/src/usePatternExecutor.js` | React hook for SSE-based execution |
| `client/src/settings/PatternsTab.js` | Admin UI (editor + test runner) |
| `client/src/settings/PatternGraphView.js` | Visual DAG renderer |

---

## Research Sources
- OpenClaw: github.com/openclaw/openclaw (320K★, MIT, tool registry + skills architecture)
- Claude API: prompt caching, batch API, compaction, MCP connector, adaptive thinking
- Gemini API: function calling, grounding, code execution, Interactions API
- Patterns: canonical while-loop + tools, event-driven inter-agent, provider abstraction via MCP
- DL Architecture Inspiration: GAN (adversarial), Diffusion (progressive refinement), MoE (expert routing), Evolutionary (population search), Transformer (attention/cross-linking), ResNet (skip connections), RAG (per-node retrieval)
