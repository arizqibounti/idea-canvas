# ThoughtClaw — Task Plan

## Current Status: Fully Implemented

The application is running with all core, meta, and infrastructure features built.

---

## Completed

### Backend — Server Modularization
- [x] Express backend with Anthropic SDK integration
- [x] Refactored monolithic `server.js` into modular architecture:
  - `engine/` — AI generation, debate, chat, analysis, specialty handlers
  - `gateway/` — Firestore persistence (sessions, shares, usage, WebSocket)
  - `middleware/` — Auth (Firebase token verification) + rate limiting
  - `utils/` — SSE helpers, web fetching, research crawler
- [x] Firebase Admin SDK for server-side auth and Firestore
- [x] WebSocket server for real-time session sync

### Backend — API Endpoints
- [x] `/api/generate` — Domain-adaptive tree generation (supports all 6 modes; adaptive prompt with `_meta` protocol; resume: jdText + resumePdf; `fetchedUrlContent` for URL context)
- [x] `/api/generate-multi` — Multi-agent generation (first principles + analogical + adversarial → merge)
- [x] `/api/generate-research` — Research mode (plan strategy → crawl URLs → synthesize tree)
- [x] `/api/regenerate` — Branch expansion (5–10 nodes); accepts `dynamicTypes`
- [x] `/api/drill` — Deep-dive node generation (12–15 nodes); accepts `dynamicTypes`
- [x] `/api/fractal-expand` — Fractal expansion of leaf nodes (2–7 adaptive children based on complexity)
- [x] `/api/fractal-select` — AI evaluates leaf nodes, selects most promising for autonomous exploration
- [x] `/api/mockup` — Animated HTML prototype generation
- [x] `/api/analyze-codebase` — Codebase reverse-engineering (20–30 nodes)
- [x] `/api/score-nodes` — Node quality scoring (relevance, specificity, actionability)
- [x] `/api/extract-template` — Structural template extraction
- [x] `/api/critique` — Devil's advocate critique nodes
- [x] `/api/debate/critique` — Mode-specific structured evaluation (idea, resume, codebase, decision, writing, plan)
- [x] `/api/debate/rebut` — Mode-specific responder rebuttal nodes
- [x] `/api/debate/finalize` — Synthesize debate into tree updates (SSE)
- [x] `/api/expand-suggestion` — Expand debate suggestions into tree branches
- [x] `/api/chat` — Mode-specific AI chat companion with tree context
- [x] `/api/canvas/generate` — A2UI interactive visualization generation
- [x] `/api/reflect` — Cross-session thinking pattern analysis
- [x] `/api/export/github` — Create repo and push markdown files
- [x] `/api/resume/changes` — Resume change manifest from debate + optional PDF
- [x] `/api/fetch-url` — Proxy fetch URL, return stripped plain text
- [x] `/api/crawl-site` — Multi-URL site crawler
- [x] `/api/sessions` — Session CRUD (list, get, delete)
- [x] `/api/shares` — Share link CRUD (create, get, delete)
- [x] `/api/usage` — Per-user daily generation usage

### Frontend — Authentication & Navigation
- [x] Firebase Authentication with Google sign-in (`AuthContext.js`)
- [x] Landing page for unauthenticated users (`LandingPage.js`)
- [x] Session dashboard with grid of saved sessions (`SessionDashboard.js`)
- [x] Auth-aware fetch wrapper with token injection (`api.js`)

### Frontend — Canvas & Core
- [x] React canvas UI with ReactFlow + dagre hierarchical layout
- [x] Dual-mode canvas (idea mode / codebase mode); idea canvas shared by idea, resume, decide, write, plan
- [x] Multi-mode tabs: Idea, Code, Resume, Decide, Write, Plan — auto-detect from input + manual lock
- [x] Resume mode: ResumeInput (JD URL fetch, paste JD, PDF upload), resume strategy tree, Apply to Resume → ResumeChangesModal
- [x] File upload for idea input (.txt, .md, .csv, .json, .html, .rtf)
- [x] Domain-adaptive mode: URL auto-detection + fetch, `_meta` parsing, dynamic config/colors/icons, dynamic legend
- [x] Node context menu (drill down, mark as focus)
- [x] Drill-down breadcrumb navigation
- [x] Prototype player (sandboxed iframe for generated HTML mockups)
- [x] Codebase upload UI (drag-and-drop, file filtering)
- [x] Node search with dimming of non-matching nodes
- [x] Cross-link toggle for non-parent relationship edges
- [x] Fractal exploration: ⊕ inline expand on leaf nodes, branch collapse/expand (▸/▾ chevrons), depth indicators (L2+), unexplored leaf node glow, double-click drill
- [x] Autonomous ∞ Explore mode: AI-driven curiosity engine (1–10 configurable rounds), live progress with AI reasoning, ∞ badge on auto-explored nodes, stop anytime

### Frontend — Panels
- [x] Debate panel with mode-specific titles, personas, start/stop labels, consensus messages, suggestion chips (`DebatePanel.js`)
- [x] AI chat companion with mode-specific personas, markdown rendering, code blocks with copy buttons, quick actions (`ChatPanel.js`)
- [x] A2UI canvas panel for interactive visualizations (`CanvasPanel.js`)

### Frontend — Export & Sharing
- [x] Share modal for generating Firestore-backed shareable links (`ShareModal.js`)
- [x] Public shared tree viewer (`ShareViewer.js`)
- [x] Export dropdown: PNG, SVG, interactive HTML, clipboard (`ExportDropdown.js`, `exportImage.js`)
- [x] Export to GitHub repo (README, SPEC, DEBATE, CLAUDE) (`ExportGitHubModal.js`, `exportMarkdown.js`)

### Frontend — Visualization
- [x] 3D graph view (Graph3D — temporal rounds + type clusters)
- [x] 2D temporal timeline (round range, play/pause, speed, isolate round)

### Frontend — Meta Features
- [x] Memory layer (blindspot / bias / strength pattern display)
- [x] Sprint mode (20-min timer, 3 phases; component present)
- [x] Node scoring display
- [x] Template extraction and reuse
- [x] Version history modal (up to 15 versions per idea)
- [x] Session auto-save to localStorage + Firestore gateway

### UI/UX Polish
- [x] Toolbar visual grouping with separator dividers
- [x] Mode-specific toolbar button labels (CRITIQUE/REVIEW/AUDIT/ADVOCATE/EDITORIAL/RISK for debate; STRATEGIST/COACH/ADVISOR/ANALYST/EDITOR/PLANNER for chat)
- [x] Better hover states, disabled states, search dimming
- [x] Panel headers with subtle background tints
- [x] Responsive modal sizing and larger close buttons
- [x] Dashboard card hover effects
- [x] Chat markdown styling (code blocks, tables, blockquotes, inline code, links)
- [x] Lens indicator tooltips on nodes (FP, AN, ADV, SYN)

### Information Architecture
- [x] Mode-specific debate panel titles (VC CRITIQUE, HIRING REVIEW, CODE AUDIT, DEVIL'S ADVOCATE, EDITORIAL REVIEW, RISK ANALYSIS)
- [x] Mode-specific chat panel titles matching server personas (PRODUCT STRATEGIST, CAREER COACH, TECH ADVISOR, DECISION ANALYST, WRITING EDITOR, PROJECT ADVISOR)
- [x] Mode-specific start/stop labels, consensus status, toolbar tooltips
- [x] Consistent mode-specific content across server prompts and client UI

### Infrastructure
- [x] Firebase Auth integration (client + server)
- [x] Firestore for sessions, shares, usage tracking
- [x] Rate limiting (general: 60/min, generation: 10/min)
- [x] Usage tracking with daily limits and visual indicator
- [x] WebSocket gateway for real-time session sync
- [x] Dockerfile for production deployment
- [x] `.env.example` for environment configuration

### Domain-Adaptive Mode
- [x] Adaptive system prompt: Claude analyzes input domain, declares types via `_meta` header, generates tree
- [x] URL auto-detection in idea input, auto-fetch via `/api/fetch-url`
- [x] `_meta` protocol parsing, `buildDynamicConfig()` for dynamic color/icon mapping
- [x] 12-color dark-theme `DYNAMIC_PALETTE` for AI-declared types
- [x] Dynamic legend (derives from actual node types)
- [x] `dynamicTypes` threading to regenerate and drill endpoints

---

### Fractal Exploration
- [x] Server: `FRACTAL_EXPAND_PROMPT` — adaptive 2–7 child decomposition with complexity-based count
- [x] Server: `FRACTAL_SELECT_PROMPT` — AI evaluates leaf nodes for autonomous selection
- [x] Server: `handleFractalExpand` — SSE streaming of fractal children (max_tokens 2048)
- [x] Server: `handleFractalSelect` — non-streaming JSON response with selectedNodeId + reasoning
- [x] Server: Routes `/api/fractal-expand` and `/api/fractal-select` wired
- [x] Client: `handleFractalExpand(nodeId)` — builds ancestor chain, streams children, marks expanded
- [x] Client: `handleToggleCollapse(nodeId)` — toggles collapse state, re-layouts canvas
- [x] Client: `handleAutoFractal(idea, maxRounds, onProgress)` — autonomous loop with abort controller
- [x] Client: `filterCollapsed(nodes, collapsedSet)` — BFS utility to hide collapsed subtrees
- [x] Client: `computeDepths(nodes)` — BFS depth assignment for all nodes
- [x] Client: IdeaNode ⊕ expand button on leaf nodes, collapse chevron (▸/▾ + count) on parents
- [x] Client: Unexplored leaf glow effect, depth indicator (L2+), ∞ auto-explore badge
- [x] Client: ∞ EXPLORE toolbar button + auto-fractal panel (slider 1–10 rounds, progress, stop)
- [x] Client: Double-click drill via `onNodeDoubleClick` in IdeaCanvas
- [x] CSS: Fractal expand/collapse/glow/pulse animations, auto-fractal panel styles

## Potential Next Steps

- [ ] Collaborative real-time editing (multiple users on same tree)
- [ ] Undo/redo support
- [ ] Upgrade model to `claude-sonnet-4-6` for faster streaming on utility endpoints
- [ ] Wire Sprint mode into main UI navigation
- [ ] Mobile-responsive layout
- [ ] Custom domain deployment with production Firebase config
