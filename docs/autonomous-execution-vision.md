# Autonomous Idea-to-Execution Engine — Vision

> March 2026. The goal and architectural assessment.

---

## The Goal

Build an engine that autonomously takes all actions needed once a problem or idea has been fully vetted through structured thinking. Examples:

- Create the PRD for features
- Prototype them
- Come up with marketing messaging docs
- Generate all content including web content needed to drive leads
- The system recursively learns from itself along the way

---

## Three Systems Required

### System 1: Vetting Engine (Thinking)
- User inputs idea → AI decomposes into structured graph → critique/debate → refinement
- The graph cycles through critique→rebuttal loops until convergence
- **Maps to: Causal Loops (the brain's computational architecture)**

### System 2: Autonomous Execution Engine (Acting)
- Once vetted, the system autonomously generates artifacts:
  - PRD from feature + constraint + metric nodes
  - Prototypes from component nodes
  - Marketing copy from user_segment + problem + feature nodes
  - Landing pages, ad copy, email sequences
- Each output feeds back into the graph as new nodes
- **Maps to: Graph of Thoughts (the brain's problem-solving procedure)**

### System 3: Recursive Learning Loop (Remembering)
- Cross-session pattern recognition
- Learns from its own outputs
- Outcome tracking
- **Maps to: Zettelkasten (the brain's memory system)**

---

## Brain-to-System Mapping

| Brain System | App System | Structure |
|---|---|---|
| Causal Loops (processing) | Vetting Engine — cycles of critique→rebuttal→refinement | Cyclic graph with +/- polarity |
| Graph of Thoughts (problem-solving) | Execution Engine — parallel generation, aggregate, refine | Multi-agent pipeline |
| Zettelkasten (memory) | Recursive Learning — cross-session knowledge | Persistent knowledge graph with embeddings |

---

## What's Missing to Get There

1. **Action nodes** — New node category for artifacts/outputs (prd_document, prototype_screen, landing_page, email_sequence)
2. **Confidence threshold** — Drift-diffusion decision boundary that triggers execution when vetting is "done enough"
3. **Graph traversal → execution prompts** — System reads the vetted graph and auto-extracts context for each artifact type
4. **Output→graph feedback loop** — Generated artifacts become nodes, critique engine evaluates them against original problem nodes
5. **Persistent Zettelkasten layer** — Embeddings, cross-session linking, outcome tracking for recursive self-improvement

---

## Current Readiness

| System | Readiness | What Exists | What's Needed |
|---|---|---|---|
| Vetting Engine | 70% | Tree decomposition, critique/debate, scoring | DAG/causal loops, cyclic graph support |
| Execution Engine | 10% | SSE streaming, multi-agent generation | Action nodes, graph→prompt traversal, artifact generation |
| Recursive Learning | 20% | Memory feature tracks thinking patterns | Zettelkasten with embeddings, outcome tracking |
