# ThoughtClaw: Structure Evolution Plan

> Researched March 2026. Alternatives to the current single-parent tree data model.

---

## The Core Problem

The current data model pins every node to **exactly one parent** (`parentId: string`). But thinking doesn't work that way. A "feature" often addresses *multiple* problems. A "metric" measures *multiple* features. An "insight" synthesizes *multiple* observations. The `relatedIds` field is a patch for this, but it's second-class — dashed lines, no layout weight, no AI awareness.

---

## 6 Structure Ideas (Ranked by Impact-to-Effort)

### 1. DAG — Directed Acyclic Graph (Multiple Parents)

**How it works:** Replace `parentId: string` with `parentIds: string[]`. A node can have 2-3 parents. Layout uses a modified dagre that respects multi-parent rank constraints.

**Why it's better:** Right now when a feature addresses 3 problems, you're forced to pick ONE parent and shove the others into `relatedIds`. In a DAG, the feature sits below all 3 problems naturally. The AI can express "this feature is a convergence of these concerns."

**Example in the app:**
```
problem_1: "Slow feedback loops"
problem_2: "Data silos across teams"
    ↘  ↙
feature_1: "Real-time cross-team dashboard"  (parentIds: [problem_1, problem_2])
    ↓
metric_1: "Time-to-insight < 2 hours"
```

**New capability:** **Convergence nodes** — the AI can explicitly say "this is where these threads merge." This is where the most interesting strategic insights live, and the current tree literally can't represent them.

**Effort:** Low — change one field, update dagre layout to handle multi-parent, update prompts.

**Files to change:**
- `server/engine/prompts.js` — update node schema in system prompt
- `client/src/layoutUtils.js` — dagre multi-parent support
- `client/src/useCanvasMode.js` — edge building from parentIds[]
- `client/src/IdeaNode.js` — visual indicator for convergence nodes

---

### 2. IBIS — Issue-Based Information System (Question-Driven)

**How it works:** Three node types: **Questions**, **Ideas** (answers), and **Arguments** (pro/con). Questions spawn Ideas. Ideas spawn Arguments. Arguments can raise new Questions. It's inherently a DAG with typed edges.

**Why it's better:** The DECIDE mode currently decomposes a decision into a tree of options/criteria — but it's answer-first. IBIS flips it: start with the *question*, then explore answers with explicit for/against arguments. This matches how real deliberation works.

**Example in the app:**
```
Q: "Should we build in-house or use a vendor?"
├─ Idea: "Build in-house"
│  ├─ Pro: "Full control over roadmap"
│  ├─ Con: "6-month development timeline"
│  │  └─ Q: "Can we hire fast enough?"  ← NEW QUESTION spawns
│  │     ├─ Idea: "Contract team for MVP"
│  │     └─ Idea: "Hire 3 seniors"
│  └─ Pro: "No vendor lock-in"
├─ Idea: "Use Vendor X"
│  ├─ Pro: "Launch in 2 weeks"
│  └─ Con: "$50k/year recurring cost"
```

**New capability:** Questions beget questions. The structure naturally deepens where uncertainty is highest, rather than where the tree happens to branch.

**Effort:** Medium — new node meta-types (Q/I/A), new prompt template, new layout that shows question→idea→argument hierarchy.

**Files to change:**
- `client/src/nodeConfig.js` — add Q/I/A types with distinct visual treatment
- `server/engine/prompts.js` — IBIS-specific generation prompt
- `client/src/modeConfig.js` — new mode or enhance DECIDE mode
- `client/src/layoutUtils.js` — Q→I→A layout hierarchy

---

### 3. Toulmin Argument Structure (For Debates)

**How it works:** Six components: **Claim** → supported by **Data** → connected via **Warrant** (the reasoning link) → backed by **Backing** (evidence) → with **Qualifier** (certainty level) → and **Rebuttal** (counter-argument).

**Why it's better:** The current critique mode just generates flat critiques. Toulmin forces the AI to surface the *warrant* — the hidden assumption connecting evidence to claim. This is where most bad thinking hides.

**Example:** When the AI critiques "Your TAM estimate of $5B is too optimistic":
```
Claim: "TAM is overestimated"
  Data: "You assumed 100% of SMBs need this"
  Warrant: "Most SMBs already have partial solutions" ← THE HIDDEN ASSUMPTION
  Backing: "Gartner report shows 60% adoption of alternatives"
  Qualifier: "Likely" (vs "Certainly")
  Rebuttal: "But existing solutions don't cover X niche"
```

**New capability:** Debates become rigorous. Instead of "here's 8 critiques," you get structured arguments where users can attack the *warrant* specifically.

**Effort:** Medium — enhances existing debate flow, new node types, prompt engineering.

**Files to change:**
- `server/engine/prompts.js` — Toulmin-structured critique prompt
- `client/src/DebatePanel.js` — structured critique display
- `client/src/nodeConfig.js` — claim/warrant/backing/rebuttal types

---

### 4. Causal Loop Diagrams (Systems Thinking — Cycles Allowed)

**How it works:** Nodes are *variables* (things that increase/decrease). Edges are *influences* with polarity: `+` (same direction) or `-` (opposite direction). **Cycles are intentional** — they represent feedback loops. A loop where all edges are `+` is *reinforcing* (growth/collapse). A loop with an odd number of `-` edges is *balancing* (stabilizing).

**Why it's better:** Trees can't represent "more users → more data → better AI → more users." That's a reinforcing loop, and it's the most important structural insight for any platform business. The current tree flattens this into a linear chain and loses the feedback dynamic.

**Example:**
```
[User Growth] ──+──→ [Data Volume] ──+──→ [AI Quality]
      ↑                                        │
      └────────────────── + ───────────────────┘

      ⟲ REINFORCING LOOP: "Data Flywheel"
```

```
[Feature Complexity] ──+──→ [Bug Count] ──+──→ [Support Load]
         ↑                                         │
         └──────────────── - ──────────────────────┘

      ⟳ BALANCING LOOP: "Complexity Brake"
```

**New capability:** The AI can identify feedback loops in your strategy and label them. This is the single most powerful analytical lens for business strategy, and no tree can express it.

**Effort:** High — requires allowing cycles (breaks dagre), new layout algorithm (circular/force-directed), new edge types with polarity, loop detection algorithm.

**Files to change:**
- `client/src/layoutUtils.js` — force-directed or circular layout (not dagre)
- `client/src/nodeConfig.js` — variable node type, polarity edge type
- `server/engine/prompts.js` — causal loop generation prompt
- `client/src/IdeaCanvas.js` — polarity labels on edges, loop highlighting
- New: loop detection algorithm (DFS cycle finder with polarity analysis)

---

### 5. Zettelkasten Layer (Cross-Session Knowledge Graph)

**How it works:** Every node ever generated gets a permanent ID. When starting a new session, the AI can *link back* to nodes from past sessions. Over time, clusters emerge — themes you keep returning to, blind spots you keep missing.

**Why it's better:** Right now each session is an island. Session 1 about "AI feedback tool" and Session 2 about "customer success platform" might share 40% of their problem space, but you'd never know. A Zettelkasten layer surfaces these connections.

**Example:** After 20 sessions, the system shows:
```
CLUSTER: "Data Integration Challenges"
  ├─ Session 3, Node 12: "API compatibility across vendors"
  ├─ Session 7, Node 5: "Data silo problem in enterprise"
  ├─ Session 15, Node 8: "ETL pipeline complexity"
  └─ Session 20, Node 3: "Cross-platform data sync"

INSIGHT: You've identified data integration as a problem in 4/20 sessions.
         Consider: is this your core thesis, or a recurring blind spot?
```

**New capability:** Compounding intelligence. The tool gets smarter the more you use it, because it builds a personal knowledge graph across all your thinking.

**Effort:** High — persistent node storage, embedding-based similarity, cross-session linking UI.

**Files to change:**
- `server/gateway/` — new `knowledge.js` for persistent node store
- `server/engine/` — embedding generation + similarity search
- `client/src/` — new Knowledge Graph view, cross-session link UI
- `client/src/MemoryLayer.js` — extend existing memory system

---

### 6. Graph of Thoughts (GoT) Generation Pipeline

**How it works:** Based on the 2023 Google/ETH Zurich paper. Instead of single-pass generation, use a multi-phase pipeline:

1. **Generate** — produce multiple independent thought branches
2. **Aggregate** — merge the best ideas from different branches into new synthesis nodes
3. **Refine** — improve aggregated thoughts
4. **Score & Select** — evaluate and prune

**Why it's better:** Current generation is single-pass: the AI produces one tree in one shot. GoT generates *multiple candidate decompositions*, then *merges the best parts*. Research shows GoT achieves 62% better quality on sorting tasks vs. Tree of Thoughts.

**Example:**
```
Pass 1 (Business lens): seed → problems → features → metrics
Pass 2 (Technical lens): seed → components → integrations → constraints
Pass 3 (User lens): seed → personas → journeys → pain points
    ↓ AGGREGATE
Synthesis: merge best nodes from all 3 passes
    ↓ REFINE
Final graph: richer than any single pass
```

**New capability:** The `generate-multi` endpoint already does 3-lens generation! GoT formalizes this with an explicit aggregate+refine step, producing convergence nodes that synthesize across lenses.

**Effort:** Medium — extends existing multi-agent flow, adds aggregation prompt, needs merge-node UI.

**Files to change:**
- `server/engine/generate.js` — aggregate + refine steps after multi-lens
- `server/engine/prompts.js` — aggregation prompt
- `client/src/useCanvasMode.js` — handle GoT multi-phase streaming
- `client/src/IdeaCanvas.js` — visual distinction for synthesis nodes

---

## Implementation Priority

| Phase | Structure | Changes | Impact |
|-------|-----------|---------|--------|
| **1** | **DAG** | `parentId` → `parentIds[]`, layout update, prompt update | Fixes the fundamental limitation |
| **2** | **IBIS for DECIDE mode** | New Q/I/A node types, question-first generation | Transforms decision-making |
| **3** | **Toulmin for debates** | Structured critique format, warrant surfacing | Makes debates rigorous |
| **4** | **Causal Loops as a new mode** | Cycle-allowing layout, polarity edges, loop detection | Unlocks systems thinking |
| **5** | **Zettelkasten layer** | Persistent cross-session graph, embeddings | Compounding value |
| **6** | **GoT pipeline** | Multi-pass generation, aggregation step | Better generation quality |

---

## Key Research References

- **Graph of Thoughts** — Besta et al. (2023), ETH Zurich / Google. Multi-path reasoning with aggregation.
- **Tree of Thoughts** — Yao et al. (2023), Princeton. BFS/DFS over thought trees.
- **Everything of Thoughts** — Ding et al. (2023). Monte Carlo tree search for thought generation.
- **IBIS / gIBIS** — Conklin & Begeman (1988). Issue-based information systems for design deliberation.
- **Toulmin Model** — Toulmin, S. (1958). "The Uses of Argument." Cambridge University Press.
- **Causal Loop Diagrams** — Sterman, J. (2000). "Business Dynamics: Systems Thinking." McGraw-Hill.
- **Zettelkasten** — Luhmann, N. Originated 1960s. Digital adaptations: Roam Research, Obsidian.
- **Wardley Maps** — Wardley, S. (2016). Value chain mapping with evolution axis.
