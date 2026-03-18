# ThoughtClaw — Task Spec

## Project Overview
An AI-powered structured thinking visualization tool. Enter any input — product ideas, marketing campaigns, sales strategies, technical architectures, content plans, resumes, decisions, writing projects, project plans — and Claude generates a domain-adaptive visual tree with the most appropriate node types, streamed in real-time. The AI detects the domain, declares types via a `_meta` protocol, and the frontend renders each type with distinct colors and icons. Features mode-specific debate, AI chat companion, sharing, export, and Firebase authentication.

## Core Capabilities

### 1. Domain-Adaptive Tree Generation
- Free-text input of any domain (or paste/attach plain-text file: .txt, .md, .csv, .json, .html, .rtf)
- URLs auto-detected, fetched via `/api/fetch-url`, content included as reference context
- Claude emits `_meta` header declaring types, then streams 18–25 nodes
- Frontend configures dynamic rendering (12-color palette, icons, legend) from `_meta`
- Optional steering instruction to shift AI focus; supports incremental expansion
- **Seven modes**: Idea, Code, Resume, Decide, Write, Plan, Learn — auto-detected or manually locked

### 2. Multi-Agent Generation
- Three parallel AI agents: first principles, analogical reasoning, adversarial thinking
- Merge agent synthesizes the best perspectives into a unified tree
- Progress indicators for each agent during generation

### 3. Research Mode Generation
- AI plans a research strategy from the user's input
- Automatically crawls multiple URLs for source material
- Synthesizes all findings into a comprehensive, grounded tree

### 4. Branch Regeneration
- Right-click any node → expand its subtree (5–10 new children)
- Preserves adaptive types via `dynamicTypes` parameter

### 5. Deep Drill-Down
- 12–15 node deep-dive into any branch (double-click any node)
- Breadcrumb UI tracks drill depth; preserves adaptive types

### 6. Fractal Exploration
- **Inline ⊕ Expansion**: Click the ⊕ button on any leaf node to fractally expand it into 2–7 adaptive AI children (count based on concept complexity)
- **Branch Collapse/Expand**: Chevron toggles (▸/▾) on parent nodes to collapse/expand subtrees with child count badges
- **Depth Visualization**: Level indicators (L2, L3, ...) on nodes at depth ≥ 2; unexplored leaf nodes glow purple
- **Autonomous ∞ Explore Mode**: AI curiosity engine that autonomously explores the tree for 1–10 configurable rounds — selects most promising leaf, expands it, repeats. Live progress with AI reasoning, stoppable anytime, ∞ badge on auto-explored nodes
- Supports infinite depth — expand any node, then expand its children, indefinitely

### 7. Feature Mockup Generator
- Generate animated HTML prototype from any feature node
- Self-contained, no external dependencies; 320×568px phone viewport

### 8. Codebase Analysis
- Drag-and-drop codebase folder for reverse-engineering
- Surfaces features, architecture patterns, user segments, tech debt (20–30 nodes)
- Configurable goals: features / architecture / users

### 9. Resume Mode
- Paste JD or enter JD URL; optionally upload resume PDF
- Generates resume strategy tree (requirement, skill_match, skill_gap, achievement, keyword, story, positioning)
- Mode-specific debate (hiring manager vs career coach)
- **Apply to Resume** → change manifest modal with specific text changes

### 10. Mode-Specific Autonomous Debate
- Multi-round debate (up to 5 rounds) with domain-specific personas:
  - Idea: VC Critic vs Architect (panel: "VC CRITIQUE")
  - Resume: Hiring Manager vs Career Coach ("HIRING REVIEW")
  - Codebase: Security Auditor vs Tech Lead ("CODE AUDIT")
  - Decision: Devil's Advocate vs Strategic Advisor ("DEVIL'S ADVOCATE")
  - Writing: Senior Editor vs Writer ("EDITORIAL REVIEW")
  - Plan: Risk Analyst vs Project Manager ("RISK ANALYSIS")
- Debate finalize synthesizes consensus into tree updates
- Suggestion chips expand debate insights into new tree branches

### 11. AI Chat Companion
- Mode-specific personas (Product Strategist, Career Coach, Tech Advisor, Decision Analyst, Writing Editor, Project Advisor)
- Full thinking tree loaded as context for grounded responses
- Rich markdown rendering: code blocks with syntax highlighting and copy buttons, tables, lists, blockquotes
- Mode-specific quick action buttons

### 12. A2UI Canvas Panel
- Generate self-contained interactive HTML visualizations from tree analysis
- Manage collection of generated artifacts with tabbed preview

### 13. Export & Sharing
- **Share via Link**: Firestore-backed shareable links with public viewer
- **Export**: PNG, SVG, interactive HTML, clipboard copy
- **GitHub Export**: Create new repo with README.md, SPEC.md, DEBATE.md, CLAUDE.md

### 14. Authentication & Persistence
- **Firebase Auth**: Google sign-in with landing page for unauthenticated users
- **Session Dashboard**: Grid of saved sessions with mode badges, node counts, timestamps
- **Firestore**: Server-side session/share/usage persistence
- **WebSocket**: Real-time session sync gateway
- **localStorage**: Auto-save, versions (15 per idea), memory layer (20 sessions)
- **Rate Limiting**: 60 req/min general, 10 req/min generation
- **Usage Tracking**: Daily generation limits with visual indicator

### 15. Visualization
- **3D Graph**: Force-directed view with rounds on X-axis, type clusters on YZ
- **2D Timeline**: Round range slider, play/pause, speed, round isolation
- **Cross-Links**: Toggle non-parent relationship edges
- **Node Search**: Text filter with dimming of non-matching nodes

### 16. Meta Features
- **Node Scoring**: Quality scoring (relevance, specificity, actionability)
- **Template Extraction**: Extract structural templates for reuse
- **Memory Layer**: Cross-session pattern analysis (blindspots, biases, strengths)
- **Sprint Mode**: Gamified 20-minute session (Generate → Critique → Converge)
- **Version History**: Up to 15 versions per idea for iteration comparison

### 17. Refine Pipeline
- **Auto-Refine Engine**: Research-agent-enriched critique → strengthen → score loop
- Multi-agent lens analysis (analogical, first-principles, adversarial) for enrichment
- Severity-badged critique results with approach recommendations
- Recursive strengthening with SSE-streamed node updates
- RefinePanel side panel and inline RefineCard in chat

### 18. Portfolio Generation
- **Alternative Approaches**: Generates 3–5 alternative solution trees with mini-trees
- Multi-agent enrichment pipeline (market, tech, audience research agents)
- Multi-dimensional scoring (market potential, feasibility, innovation, etc.)
- PortfolioPanel with tabbed navigation and scoring visualizations
- Inline PortfolioCard in chat with mini dimension bars

### 19. Learn Mode (Autonomous Comprehension)
- **Concept DAG Generation**: AI generates a directed acyclic graph of concepts for any topic
- **Comprehension Loop**: Probe → Evaluate → Adapt cycle for each concept node
- **Socratic Questioning**: AI uses Socratic dialogue to deepen understanding
- **Mastery Tracking**: Per-node mastery badges and prerequisite dependency checking
- **Curriculum-Quality Critique**: Learn-specific critique prompts for educational quality
- Inline LearnCard in chat with quiz interactions and mastery progress

### 20. Memory Mnemonics (Veo 3)
- **Mnemonic Video Generation**: Claude crafts vivid visual metaphor → Veo 3 generates 6-second mnemonic video
- Videos stored in Google Cloud Storage (`gs://lasttouchashar-mnemonics/`)
- 🎬 button on learn-mode concept nodes → polling with progress → ▶ playback
- VideoModal with strategy description, scene description, and HTML5 video player

### 21. AutoIdea Experiment Loop
- **Autonomous Iteration**: Mutate → Score → Compare → Keep/Discard across multiple iterations
- Strategy badges (refine, pivot, explore, combine, niche) per mutation
- Comparative scoring against baseline with score delta visualization
- Inline ExperimentCard in chat with iteration progress

### 22. Node Tools (Precision Editing)
- **Razor Split**: AI splits a single node into two complementary specific nodes
- **Merge**: AI synthesizes two nodes into one unified node
- **Ripple Delete**: Remove a node and reconnect its children
- **Slip Edit**: Adjust node positioning in the tree
- PreviewOverlay for atomic preview/reject before committing AI results

### 23. Action Execution Engine
- Dispatches node actions to mode-specific executors (Code mode via Claude Code CLI)
- Concurrency control with SSE streaming for execution progress
- Stoppable execution with `/api/stop-execution`

### 24. Knowledge Graph (Zettelkasten)
- Cross-session node clustering and similarity search
- Persistent knowledge store with embedding-based retrieval
- KnowledgeGraph view for exploring connections across sessions

### 25. Workspaces & Team Collaboration
- Workspace CRUD with role-based access control (owner, admin, member)
- Token-based invitation system with accept/revoke
- Pro-plan gating for additional workspace creation
- InviteAccept page for `/invite/:token` URLs

### 26. Gmail Integration
- OAuth2 connection for reading email threads
- Thread search and picker modal
- Email content as tree generation context
- In-memory token storage (privacy-first, no persistence)

### 27. Billing (Stripe)
- Stripe checkout and customer portal integration
- Billing status tracking per user
- Webhook handling for subscription events

### 28. Enhanced UI/UX
- **Sidebar Navigation**: Session navigation with mode config, date-grouped sessions, import/create flows
- **Ghost Nodes**: Shimmer-animated placeholder nodes during AI streaming
- **Undo Stack**: Up to 60 canvas snapshots with Ctrl+Z/Ctrl+Y keyboard support
- **Hover Preview**: Floating preview card on 400ms node hover with full metadata
- **Pipeline Overlay**: Banner showing Generate→Debate→Refine→Portfolio stage progress
- **Cinematic Controller**: AI video-like replay of tree-building with smooth camera movements
- **Inspector Panel**: Deep node editing with full metadata control (label, reasoning, type, parents, children, scores)
- **Flowchart View**: Main ReactFlow canvas with auto-fit, toolbar, search, collapse/expand, and drill navigation
- **Timeline Filmstrip**: Horizontal node thumbnail strip with transport controls and type filtering
- **Chat-First Node Interaction**: NodeFocusCard replaces separate edit panels with inline chat actions
- **User Profiles**: `/api/me` endpoint for user profile management

## Technical Stack

- **Frontend**: React 19, Create React App, @xyflow/react, dagre, react-markdown, remark-gfm, react-force-graph-3d, Firebase Auth SDK
- **Backend**: Node.js, Express, @anthropic-ai/sdk, @google/genai, @google-cloud/storage, firebase-admin, ws, express-rate-limit, stripe
- **AI Models**: `claude-opus-4-5` (debate/generation with extended thinking), `claude-sonnet-4-20250514` (chat/utilities/fractal expand/fractal select), Veo 3 (`veo-3.0-generate-001`) for mnemonic video generation, Gemini for experiment scoring
- **Streaming**: Server-Sent Events (SSE)
- **Persistence**: Firebase/Firestore (server) + localStorage (client) + WebSocket (sync) + Google Cloud Storage (videos)
- **Payments**: Stripe (checkout, portal, webhooks)
- **Infrastructure**: Docker, CORS, rate limiting, Firebase Auth
- **Ports**: Frontend 3000, Backend 5001

## Node Types

### Static Types
Product/codebase: `seed` · `problem` · `user_segment` · `job_to_be_done` · `feature` · `constraint` · `metric` · `insight` · `component` · `api_endpoint` · `data_model` · `tech_debt` · `critique`

Resume: `requirement` · `skill_match` · `skill_gap` · `achievement` · `keyword` · `story` · `positioning`

### Dynamic Types (adaptive mode)
AI declares domain-specific types via `_meta` protocol. Assigned colors from 12-color palette via `buildDynamicConfig()`.

## Information Architecture

### Mode-Specific Labels
Each mode has consistent, tailored labels across all UI touchpoints:

| Mode | Toolbar Debate | Toolbar Chat | Debate Panel | Chat Panel | Server Critic | Server Responder |
|------|---------------|-------------|-------------|-----------|--------------|-----------------|
| Idea | ⚔ CRITIQUE | ✦ STRATEGIST | VC CRITIQUE | PRODUCT STRATEGIST | VC Critic | Architect |
| Resume | ◎ REVIEW | ✦ COACH | HIRING REVIEW | CAREER COACH | Hiring Manager | Career Coach |
| Codebase | ⟨/⟩ AUDIT | ✦ ADVISOR | CODE AUDIT | TECH ADVISOR | Security Auditor | Tech Lead |
| Decision | ⚖ ADVOCATE | ✦ ANALYST | DEVIL'S ADVOCATE | DECISION ANALYST | Devil's Advocate | Strategic Advisor |
| Writing | ✦ EDITORIAL | ✦ EDITOR | EDITORIAL REVIEW | WRITING EDITOR | Senior Editor | Writer |
| Plan | ◉ RISK | ✦ PLANNER | RISK ANALYSIS | PROJECT ADVISOR | Risk Analyst | Project Manager |
| Learn | — | ✦ TUTOR | — | LEARNING TUTOR | — | — |
