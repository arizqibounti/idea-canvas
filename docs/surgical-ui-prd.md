# Product Requirements Document: Surgical UI for AI Thinking Trees

## Executive Summary

Transform the existing AI thinking tree platform into a precision editing interface that borrows interaction paradigms from professional video editing software. This "surgical UI" will enable users to manipulate complex reasoning structures with the same fluency and confidence that video editors trim, split, and arrange footage.

## Problem Statement

Current AI thinking tree interfaces overwhelm users with complex branching structures and lack precision tools for restructuring AI-generated reasoning. Users need surgical control over their thought processes — the ability to split, merge, reorder, and refine reasoning nodes without losing semantic relationships or AI collaboration context.

---

## Core Features

### F1: Timeline-Based Tree Navigation

*Based on nodes: metaphor_1, component_1, interaction_3*

- Transform DAG structure into dependency-respecting timeline using topological sorting
- Filmstrip view below graph showing nodes as draggable thumbnails
- J/K/L keyboard navigation with priority-based branch selection algorithm
- Playhead cursor with real-time position sync across all panels

### F2: Parallel Track System

*Based on nodes: metaphor_2, component_2, insight_1*

- Multiple reasoning streams displayed as stacked tracks
- Track headers with solo/mute controls for branch types (FEATURE, RISK, INSIGHT)
- Visual track isolation for focused reasoning on specific node types
- Infinite fractal expansion becomes "split to new track"

### F3: Precision Editing Tools

*Based on nodes: flow_1, flow_3, interaction_1, interaction_2*

- **Razor Tool**: Split nodes into two refined versions (R key)
- **Merge Tool**: Combine two nodes with AI synthesis (M key)
- **Ripple Edit**: Delete propagation with orphan management
- **Slip Edit**: Edit node content without changing tree structure

### F4: AI-Safe Collaboration

*Based on nodes: constraint_2, refinement_3, synthesis_3*

- Ghost nodes for pending AI output with mid-stream cancellation
- Undo stack as version timeline with 50+ state snapshots
- Atomic preview/reject for all AI regeneration operations
- Temporal versioning enables bold experimentation without data loss

### F5: Advanced Interaction Layer

*Based on nodes: refinement_1, refinement_2, component_4*

- Magnetic snapping to semantically related nodes
- Hover preview showing debate excerpts and reasoning snippets
- Inspector panel for deep node editing with metadata control
- Cross-view node identity tracking between 3D and timeline modes

---

## Technical Constraints

### C1: Performance Requirements

*Based on nodes: constraint_3, ref_r1_5, ref_r1_6*

- Support 500+ nodes with smooth 60fps interaction
- 50MB memory budget for mobile compatibility
- 16ms render budget with virtualized filmstrip rendering
- WebGL instanced rendering for identical node shapes

### C2: Preserve Existing Features

*Based on nodes: constraint_1, constraint_2*

- Maintain 3D force-graph visualization with spatial anchor system
- Preserve real-time collaboration via Yjs integration
- Keep existing debate panel, chat panel, and codebase analysis
- Ensure all 6 canvas modes remain functional

### C3: Semantic Integrity

*Based on nodes: synthesis_2, synthesis_4, syn_7*

- AI validates logical coherence during merge operations
- Split operations preserve complete logical components
- Magnetic relationships maintain conceptual proximity
- Dependency parsing identifies semantic boundaries for atomic edits

---

## Success Metrics

### M1: Navigation Efficiency

- **Target**: Reduce average time-to-target-node from 3.6s to 2.3s (35% improvement)
- **Baseline**: Current hierarchical list navigation benchmark
- **Measurement**: A/B testing with controlled tree traversal tasks

### M2: Error Reduction

- **Target**: Navigation error rate below 0.15 mistakes per task
- **Current**: 0.35 errors per task with text-only interfaces
- **Measurement**: Wrong-path selections during tree traversal

### M3: Cognitive Load Reduction

- **Target**: 30-40% reduction in working memory demands
- **Method**: Task completion time analysis with complex reasoning tasks
- **Indicator**: Reduced backtrack frequency and faster decision-making

### M4: User Adoption Among Video Editors

- **Target**: 80% faster onboarding for users with video editing background
- **Measurement**: Time to proficiency with J/K/L navigation
- **Retention**: Track continued usage after initial 30-day period

---

## User Stories

### Story 1: The Overwhelmed Strategist

> As a product strategist working with complex feature trees
> I want to isolate specific reasoning tracks (solo/mute)
> So that I can focus on risk analysis without visual noise from 20+ feature nodes

**Acceptance**: Solo button shows only RISK nodes, mute grays them out, toggle restores full view

### Story 2: The Precision Editor

> As a user refining AI-generated reasoning
> I want to split vague nodes into specific components
> So that I can maintain logical precision without losing parent relationships

**Acceptance**: Razor tool creates two nodes with preserved dependencies and atomic undo

### Story 3: The Collaborative Researcher

> As a team member editing shared thinking trees
> I want to experiment with structural changes without fear
> So that I can explore bold reasoning paths knowing I can revert

**Acceptance**: Version timeline shows 50+ states, any edit is undoable, ghost previews show pending changes

### Story 4: The Video Editor Convert

> As a professional video editor learning the platform
> I want to use familiar J/K/L navigation
> So that I can leverage existing muscle memory for immediate productivity

**Acceptance**: J/K/L keys work identically to video editing software, with predictable branch routing

### Story 5: The Mobile Power User

> As a consultant working on mobile devices
> I want smooth performance with large reasoning trees
> So that I can work effectively during travel without desktop access

**Acceptance**: 500+ nodes render at 60fps, 50MB memory limit respected, no browser crashes

---

## Technical Architecture

### Component Hierarchy

- **TimelineView**: New main editing interface
  - **FilmstripComponent**: Virtualized node thumbnail navigation
  - **TrackHeaders**: Branch type controls with solo/mute
  - **PlayheadCursor**: Position sync across all panels
- **InspectorPanel**: Node deep editing interface
- **GhostNodes**: Pending AI output visualization

### Integration Points

- **Graph3D**: Maintain spatial view with anchor system
- **DebatePanel**: Auto-focus on playhead position
- **ChatPanel**: Context injection from timeline selection
- **YjsProvider**: Real-time collaboration for timeline edits
