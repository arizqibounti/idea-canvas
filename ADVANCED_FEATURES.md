# Advanced Features: Cellular Automata-Inspired Canvas Intelligence

Three experimental features that push the thinking canvas toward emergent, self-organizing behavior — inspired by cellular automata, evolutionary biology, and morphogenetic systems.

---

## A. The "Neural Neighborhood" Protocol

### Concept
Nodes shouldn't just have `parentIds`; they should have **influence radii**. Every node exerts a semantic field that attracts and repels other nodes based on meaning, not just manual linking.

### How It Works

**Semantic Vectors per Node:**
- On generation, each node gets a lightweight embedding vector (computed from `label + reasoning` via a fast embedding model or TF-IDF)
- Stored as `node.data.vector` — a 256-dim float array

**Dynamic Neighborhoods:**
- Every node has a configurable `influenceRadius` (default: 0.7 cosine similarity threshold)
- A background process scans for nodes within each other's radius across the entire canvas
- Matches create **soft links** — dashed edges rendered with opacity proportional to similarity
- These soft links are NOT in `parentIds` — they're a separate `relatedIds` layer with similarity scores

**Cross-Domain Discovery:**
- Reuse the URL Auto-Detection logic (entity extraction → similarity lookup) but apply it to nodes instead of URLs
- A "Codebase" node about "authentication middleware" and a "Writing" node about "user trust frameworks" could discover semantic overlap
- Surface these as "Neural Neighborhood" suggestions in the chat: *"These 3 nodes from different domains share a common thread around user trust..."*

**Canvas Visualization:**
- Toggle "Neighborhood View" — dims the tree edges and highlights influence connections
- Clusters of semantically related nodes glow with a shared hue
- Zoom-dependent: at far zoom, neighborhoods appear as colored regions (like a heatmap)

### Implementation Sketch

```
// Background worker (runs after generation settles)
async function computeNeighborhoods(nodes) {
  const vectors = await embedBatch(nodes.map(n => `${n.label} ${n.reasoning}`));
  const neighborhoods = [];

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const sim = cosineSimilarity(vectors[i], vectors[j]);
      if (sim > 0.7 && !isAncestor(nodes[i], nodes[j])) {
        neighborhoods.push({ a: nodes[i].id, b: nodes[j].id, similarity: sim });
      }
    }
  }
  return neighborhoods;
}
```

### AGI Relevance
This enables **Cross-Domain Synthesis** — the system discovers connections humans miss because they're thinking within one domain. A financial constraint node might resonate with a technical architecture node, revealing that the cost problem IS the architecture problem.

---

## B. Recursive Refinement Loops (The "Life" Rule)

### Concept
Use the Auto-Refine Pipeline as a **survival mechanism**. Nodes aren't static artifacts — they're living entities with energy that must be maintained through relevance and logical soundness.

### How It Works

**Cognitive Energy Metric:**
Each node gets a `cognitiveEnergy` score (0.0–1.0) computed from:
- **Debate survival rate** — how many critique rounds has this node survived? (from Multi-Dimensional Scoring)
- **Child vitality** — are this node's descendants being referenced, expanded, starred?
- **Staleness** — time since last interaction or refinement
- **Coherence** — does this node's reasoning align with its siblings and parent?

```
cognitiveEnergy = (
  0.3 * debateSurvival +     // survived 3/5 critique rounds = 0.6
  0.25 * childVitality +      // 4 active children out of 6 = 0.67
  0.25 * (1 - staleness) +    // last touched 2 hours ago = 0.8
  0.2 * coherenceScore         // semantic alignment with siblings = 0.75
)
```

**Replication (High Energy ≥ 0.8):**
- Nodes with high cognitive energy automatically **generate children** — the system expands on strong ideas
- Uses the existing generate pipeline but scoped to that node's subtree
- Replication is rate-limited (max 1 per node per session) to prevent runaway growth

**Pruning (Low Energy ≤ 0.2):**
- Nodes below the threshold get flagged with a dim visual treatment (faded, dotted border)
- After 2 debate cycles below threshold, the node is "archived" — moved to a graveyard layer
- Leverages the existing Yjs 30-second GC logic for distributed cleanup
- Archived nodes can be restored (they're not deleted, just hidden)

**Energy Visualization:**
- Node border glow intensity maps to cognitive energy
- Bright green glow = thriving, dim red = endangered
- A "Health" overlay mode shows the entire tree's energy distribution as a heatmap

### The "Life" Cycle

```
Generation → Debate → Score → Energy Update →
  High energy → Replicate (generate children)
  Medium energy → Stable (no action)
  Low energy → Flag for pruning
  → Next debate round → Score → Energy Update → ...
```

### AGI Relevance
This creates **Natural Selection of Ideas**. The canvas becomes an ecosystem where strong, well-supported ideas propagate and weak, contradicted ideas fade. Over multiple cycles, the tree evolves toward the strongest possible reasoning structure — without human intervention picking winners.

---

## C. Pattern-Driven "Morphogenesis"

### Concept
Use the Thinking Pattern System as the **DNA** of the system. Patterns aren't just user-selected modes — they're autonomous regulatory programs that the system injects in response to detected bottlenecks.

### How It Works

**Bottleneck Detection:**
The system monitors the canvas for structural pathologies:
- **Decision deadlock** — a Decision node has been debated 3+ rounds with no consensus
- **Exploration starvation** — a branch has only 1-2 children despite being high-energy
- **Echo chamber** — all nodes in a cluster score similarly (no diversity of perspective)
- **Orphan accumulation** — too many leaf nodes with no connections or follow-up

**Autonomous Pattern Injection:**
When a pathology is detected, the system **hot-reloads** an appropriate thinking pattern into that local cluster:

| Pathology | Injected Pattern | Effect |
|-----------|-----------------|--------|
| Decision deadlock | Adversarial Debate | Two-agent critique breaks the impasse |
| Exploration starvation | Portfolio Exploration | Generates 3-5 alternative branches |
| Echo chamber | Expert Committee | Introduces diverse perspective agents |
| Orphan accumulation | Progressive Refinement | Consolidates and strengthens orphan nodes |
| Contradictory siblings | Evolutionary Search | Breeds hybrid solutions from conflicting ideas |
| Depth without breadth | Diffusion Refinement | Broadens the branch laterally |

**Hot-Reload Mechanism:**
- Patterns are loaded from the pattern store (already supports hot-reload via `patternLoader.js`)
- Injection is scoped to a **local cluster** of nodes, not the entire tree
- The injected pattern runs as a background pipeline — results stream into the canvas in real-time
- A "Morphogenesis Log" in the chat shows what patterns were injected and why

```
// Morphogenesis engine (runs periodically or after debate rounds)
function detectAndInject(nodes, debateHistory) {
  const clusters = identifyClusters(nodes);

  for (const cluster of clusters) {
    const pathology = diagnose(cluster, debateHistory);
    if (pathology) {
      const pattern = PATHOLOGY_PATTERN_MAP[pathology.type];
      patternExecutor.executeScoped(pattern, cluster.nodeIds, {
        reason: pathology.description,
        urgency: pathology.severity,
      });
      log(`Morphogenesis: Injected "${pattern.name}" into cluster "${cluster.label}" — ${pathology.description}`);
    }
  }
}
```

**Self-Regulation:**
- The system tracks which patterns have been injected and their outcomes
- If a pattern injection didn't resolve the pathology after 2 attempts, it escalates to a different pattern
- Successful injections are remembered and weighted higher for future similar situations
- This creates a **meta-learning loop** — the system learns which patterns work for which pathologies

### Visualization
- When morphogenesis is active, affected nodes pulse with the injected pattern's color
- A subtle "DNA helix" icon appears on clusters undergoing pattern injection
- The chat shows a timeline of injections: *"Detected decision deadlock on 'pricing strategy' cluster → Injecting Adversarial Debate pattern..."*

### AGI Relevance
This is **Cognitive Self-Regulation** — the system doesn't just think, it thinks about how it's thinking and corrects course. When reasoning gets stuck, the system doesn't wait for the user to notice and manually select a pattern. It diagnoses the problem and applies the appropriate cognitive tool autonomously. This is the closest analogy to how biological neural networks dynamically rewire in response to persistent signals.

---

## Integration Path

These three features build on each other:

1. **Neural Neighborhoods** (A) → enables cross-domain discovery
2. **Life Rules** (B) → uses neighborhood data to compute coherence scores and replicate/prune
3. **Morphogenesis** (C) → uses energy data and neighborhood pathologies to inject patterns

Together, they transform the canvas from a static tree of generated nodes into a **living, self-organizing reasoning ecosystem** that discovers its own connections, evolves toward stronger ideas, and self-corrects when thinking patterns fail.

The key architectural principle: **every feature we've already built becomes a primitive for emergent behavior.** Debate becomes natural selection pressure. Patterns become regulatory DNA. The canvas becomes a substrate for artificial reasoning that improves itself.
