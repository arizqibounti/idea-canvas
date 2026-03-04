# Idea Canvas — Implementation Plan

## Status: Implemented

The application is fully built and running. This document reflects the actual implemented architecture.

## What's Built

### Backend (`server/`)

The server has been refactored from a monolithic `server.js` into a modular architecture:

#### Core (`server/server.js`)
- [x] Express server on port 5001 (8080 in Docker)
- [x] Firebase Auth middleware (token verification)
- [x] Rate limiting (general + generation-specific)
- [x] WebSocket server for real-time session sync
- [x] CORS configuration
- [x] Route wiring to engine/gateway modules

#### Engine (`server/engine/`)
- [x] `prompts.js` — All system prompts, debate personas (per-mode critic/architect/finalize), chat personas, mode server metadata, user message builders
- [x] `generate.js` — Tree generation handlers:
  - `handleGenerate` — Single-agent adaptive generation with `_meta` protocol
  - `handleGenerateMulti` — Multi-agent (first principles + analogical + adversarial → merge)
  - `handleGenerateResearch` — Research mode (plan → crawl → synthesize)
  - `handleRegenerate` — Branch expansion (5–10 nodes)
  - `handleDrill` — Deep-dive (12–15 nodes)
- [x] `debate.js` — Debate handlers (critique, rebut, finalize, expand-suggestion)
- [x] `chat.js` — AI chat companion (mode-specific personas, tree-aware context)
- [x] `analyze.js` — Codebase analysis, node scoring, template extraction
- [x] `specialty.js` — Mockup generation, resume changes, reflect, critique

#### Canvas (`server/canvas/`)
- [x] `engine.js` — A2UI interactive visualization generation
- [x] `prompts.js` — Canvas-specific system prompts

#### Gateway (`server/gateway/`)
- [x] `sessions.js` — Firestore session CRUD (list, get, save, delete)
- [x] `shares.js` — Firestore share link CRUD (create, get, delete)
- [x] `usage.js` — Per-user daily generation tracking
- [x] `websocket.js` — WebSocket server setup and connection handling
- [x] `protocol.js` — Gateway WebSocket message protocol handler

#### Middleware (`server/middleware/`)
- [x] `auth.js` — Firebase token verification (requireAuth + optionalAuth)
- [x] `rateLimit.js` — Express rate limiting (general: 60/min, generation: 10/min)

#### Utilities (`server/utils/`)
- [x] `sse.js` — SSE streaming helpers (sseHeaders, streamToSSE)
- [x] `web.js` — URL fetching, HTML stripping, site crawling
- [x] `research.js` — Multi-URL research planner and crawler

### Frontend (`client/src/`)

#### Core App
- [x] `App.js` — Main shell, mode switching (6 modes), toolbar with mode-specific labels, 2D timeline bar, file upload, URL auto-detection, `_meta` parsing, dynamic legend
- [x] `App.css` — Full dark-theme stylesheet (~2000 lines)
- [x] `index.js` — App entry point with AuthProvider wrapper

#### Authentication & Navigation
- [x] `AuthContext.js` — Firebase auth provider with Google sign-in, token management
- [x] `LandingPage.js` — Marketing landing page for unauthenticated users
- [x] `SessionDashboard.js` — Grid view of saved sessions (filters empty/untitled)
- [x] `api.js` — Auth-aware fetch wrapper (auto-injects Firebase token)

#### Canvas & Nodes
- [x] `IdeaCanvas.js` — ReactFlow canvas with dagre hierarchical layout
- [x] `IdeaNode.js` — Individual node rendering with type-based color/icon, search dimming, lens indicator tooltips
- [x] `NodeEditPanel.js` — Node detail and edit panel + mockup generation
- [x] `NodeContextMenu.js` — Right-click context menu (drill down, mark as focus)
- [x] `DrillBreadcrumb.js` — Breadcrumb navigation for drill-down mode
- [x] `Graph3D.js` — 3D force-directed graph (temporal rounds + type clusters)

#### Panels
- [x] `DebatePanel.js` — Mode-specific debate loop with per-mode titles (VC Critique, Hiring Review, Code Audit, Devil's Advocate, Editorial Review, Risk Analysis), start/stop labels, consensus status, suggestion chips
- [x] `ChatPanel.js` — AI chat companion with mode-specific personas (Product Strategist, Career Coach, Tech Advisor, etc.), markdown rendering (code blocks with copy buttons, tables, links), quick actions
- [x] `CanvasPanel.js` — A2UI interactive visualization panel with artifact management

#### Export & Sharing
- [x] `ShareModal.js` — Generate shareable tree links (Firestore-backed)
- [x] `ShareViewer.js` — Public shared tree viewer
- [x] `ExportDropdown.js` — Export dropdown (PNG, SVG, interactive HTML, clipboard)
- [x] `ExportGitHubModal.js` — Export to new GitHub repo
- [x] `exportImage.js` — PNG, SVG, clipboard, interactive HTML export logic
- [x] `exportMarkdown.js` — Markdown generation (README, SPEC, DEBATE, CLAUDE)

#### Modals & Utilities
- [x] `LoadModal.js` — Load saved sessions modal
- [x] `HistoryModal.js` — Version history modal (up to 15 versions per idea)
- [x] `MemoryLayer.js` — Thinking pattern analysis display
- [x] `SprintMode.js` — 20-minute sprint timer with 3 phases
- [x] `ResumeInput.js` — Resume mode: JD URL fetch, paste JD, PDF upload
- [x] `ResumeChangesModal.js` — Resume change manifest modal
- [x] `CodebaseUpload.js` — Drag-and-drop codebase file upload
- [x] `PrototypePlayer.js` — Sandboxed iframe viewer for HTML mockups

#### Config & State
- [x] `modeConfig.js` — Mode definitions (6 modes) and auto-detect from input text
- [x] `useCanvasMode.js` — Canvas state hook (nodes, sessions, handlers, auto-save, dynamicTypesRef)
- [x] `layoutUtils.js` — Dagre layout, edge building, BFS subtree extraction
- [x] `nodeConfig.js` — Node type colors/icons (static + dynamic 12-color palette)
- [x] `TemplateStore.js` — Structural template persistence
- [x] `gateway/useGateway.js` — Firestore session sync gateway hook

### Persistence
- [x] **Firestore** — Server-side session storage, share links, usage tracking
- [x] **LocalStorage** — Auto-save (debounced), sessions, versions, memory patterns
- [x] **WebSocket** — Real-time session sync between client and server
- [x] Up to 10 sessions per mode (idea / codebase)
- [x] Up to 15 versions per idea
- [x] Last 20 sessions tracked for memory/pattern analysis
- [x] Resume banner on app open if recent session exists

### Infrastructure
- [x] Firebase Authentication (Google sign-in)
- [x] Rate limiting (general + generation)
- [x] Usage tracking with daily generation limits
- [x] Dockerfile for production deployment
- [x] `.env.example` for environment configuration

## Running the App

```bash
npm run dev          # start both frontend and backend
npm run server       # backend only
npm run client       # frontend only
npm run install-all  # install all dependencies
```

- Frontend: http://localhost:3000
- Backend: http://localhost:5001

### Docker

```bash
docker build -t idea-canvas .
docker run -p 8080:8080 --env-file .env idea-canvas
```

## Architecture Decisions

### Server Modularization
The original monolithic `server.js` (~2000 lines) was refactored into focused modules:
- **engine/** — AI generation logic (prompts, generate, debate, chat, analyze, specialty)
- **gateway/** — Persistence layer (sessions, shares, usage, WebSocket)
- **middleware/** — Cross-cutting concerns (auth, rate limiting)
- **utils/** — Shared utilities (SSE, web fetching, research)

### Mode-Specific Information Architecture
Each of the 6 modes has consistent, tailored content across all touchpoints:
- Toolbar button labels (e.g., "CRITIQUE" vs "REVIEW" vs "AUDIT")
- Debate panel titles, start/stop labels, status text, consensus messages
- Chat panel titles matching server-side personas
- Mode-specific debate prompts (critic, architect, finalize) on the server
- Mode-specific chat personas on the server

### Authentication Flow
1. Unauthenticated users see the LandingPage
2. Google sign-in via Firebase Auth
3. Authenticated users see SessionDashboard
4. All API calls include Firebase ID token via `api.js` wrapper
5. Server verifies tokens via `middleware/auth.js`
