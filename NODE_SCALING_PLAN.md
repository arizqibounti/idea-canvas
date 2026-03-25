# Node Scaling & Compaction Plan

## The Problem: 3 Bottlenecks at Scale

When we hit hundreds/thousands of nodes, we break in three places: rendering performance, LLM context limits, and UX navigation.

## 1. LLM Context Compaction

### How Claude & ChatGPT Do It
- **Claude**: Server-side compaction auto-summarizes older conversation turns when approaching context limit. Uses cheaper model (Haiku) for structured summary generation.
- **OpenAI**: Opaque compressed representation via `/responses/compact` — 99.3% compression.
- **AgentFold (JetBrains)**: Sublinear context growth (<7K tokens after 100 turns vs >91K naive) with multi-scale workspace folding.

### Our Strategy: Three-Tier Memory Hierarchy

| Tier | Content | Token Budget |
|------|---------|-------------|
| **Focus nodes** (selected + neighbors) | Full text, scores, debate history | 50-60% |
| **Branch summaries** (ancestor/sibling branches) | 1-2 sentence summary per branch | 20-30% |
| **Tree overview** | Total nodes, top themes, score distribution | 10% |

When running "debate on features" with 500 nodes, send full detail for ~20 most relevant feature nodes, summaries for surrounding branches, and statistical overview of the whole tree.

## 2. Rendering at Scale

| Node Count | Rendering Strategy |
|-----------|-------------------|
| < 500 | SVG (current) — full DOM interactivity |
| 500 - 5,000 | Canvas (D3 + Canvas) — 10x faster |
| 5,000+ | WebGL (3d-force-graph, D3FC) — GPU-accelerated |

### D3 Force Simulation Optimizations
- Web Workers — offload force physics to background thread
- Throttle rendering — update visuals every 3-5 ticks instead of every tick
- Freeze stabilized nodes — stop computing forces for settled subgraphs
- d3-force-reuse — reuses Barnes-Hut approximations for 2-5x speedup

## 3. Semantic Zoom (3 Levels)

1. **Bird's eye** (>100 nodes visible): Cluster bubbles — "Architecture Ideas (12 nodes, avg score 7.2)"
2. **Neighborhood** (20-100): Node titles, edges, color-coded by score
3. **Detail** (<20): Full node content, scores, debate summaries

## 4. UX Patterns for Navigation

- **Virtualize tree view** — only render visible rows (React Arborist / TanStack Virtual)
- **Type-ahead search/filter** — instant filtering across node titles/content
- **Mini-map** — overview panel showing full tree with viewport indicator
- **Auto-clustering** — Louvain/Leiden community detection to group related nodes

## 5. GraphRAG for Smart Retrieval

Instead of sending entire tree to LLM, embed each node's content and retrieve relevant subgraph:
- Build embeddings for each node
- On debate/refine request, retrieve top-K nodes by embedding similarity
- Include structural context (parent chain, sibling summaries)
- Enables multi-hop reasoning without exceeding context limits

## Implementation Roadmap

### Phase 1 — Quick Wins
1. Virtualize tree view (React Arborist / react-vtree)
2. Add search/filter to tree view
3. Token budgeting for LLM calls (debate, refine, score, portfolio)
4. Canvas rendering toggle for >300 nodes

### Phase 2 — Structural
5. Hierarchical branch summarization (auto-generate summaries, store as metadata)
6. Semantic zoom (3 levels in D3 force view)
7. Mini-map overlay in CanvasPanel
8. GraphRAG retrieval for LLM operations

### Phase 3 — Full Scale (1000+)
9. WebGL rendering (3d-force-graph / D3FC)
10. Web Worker for force simulation physics
11. Server-side layout pre-computation
12. Automatic clustering (Louvain/Leiden)
13. AgentFold-style context folding

## References
- Claude Compaction: https://platform.claude.com/docs/en/build-with-claude/compaction
- Factory.ai Compression Eval: https://factory.ai/news/evaluating-compression
- JetBrains AgentFold: https://blog.jetbrains.com/research/2025/12/efficient-context-management/
- GraphRAG Survey: https://arxiv.org/abs/2408.08921
- d3-force-reuse: https://github.com/twosixlabs/d3-force-reuse
- 3d-force-graph: https://github.com/vasturiano/3d-force-graph
