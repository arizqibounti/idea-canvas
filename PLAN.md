# Idea Graph — Implementation Plan

## Status: Implemented

The application is fully built and running. This document reflects the actual implemented architecture.

## What's Built

### Backend (`server/server.js`)
- [x] Express server on port 5001
- [x] Anthropic SDK integration with `claude-opus-4-5`
- [x] SSE streaming helper (`streamToSSE`)
- [x] `POST /api/generate` — full tree generation with optional steering; supports `mode` (idea | resume), `jdText`, `resumePdf` for resume; accepts `fetchedUrlContent` for URL context; uses adaptive system prompt that emits `_meta` header declaring domain-specific node types
- [x] `POST /api/regenerate` — branch expansion (5–10 nodes); accepts optional `dynamicTypes` to use adaptive node types
- [x] `POST /api/drill` — deep-dive generation (12–15 nodes); accepts optional `dynamicTypes` to use adaptive node types
- [x] `POST /api/mockup` — animated HTML prototype generation (non-streaming)
- [x] `POST /api/analyze-codebase` — reverse-engineer codebase into product tree
- [x] `POST /api/critique` — devil's advocate critique nodes (8–12)
- [x] `POST /api/debate/critique` — mode-specific structured evaluation (idea, resume, codebase, decision, writing, plan)
- [x] `POST /api/debate/rebut` — architect/responder rebuttal (mode-aware)
- [x] `POST /api/debate/finalize` — synthesize debate into tree updates (SSE)
- [x] `POST /api/reflect` — analyze past sessions for thinking patterns (non-streaming)
- [x] `POST /api/export/github` — create GitHub repo and push markdown files
- [x] `POST /api/resume/changes` — resume change manifest from debate + optional PDF
- [x] `POST /api/fetch-url` — proxy fetch URL, return stripped plain text
- [x] `GET /api/health` — health check

### Frontend (`client/src/`)
- [x] `App.js` — main shell, mode switching (idea / codebase / resume / decide / write / plan), 2D timeline bar, file upload for idea, URL auto-detection + fetch, `_meta` parsing for adaptive node types, dynamic legend
- [x] `IdeaCanvas.js` — ReactFlow canvas with dagre hierarchical layout
- [x] `IdeaNode.js` — individual node rendering with type-based color and icon; supports dynamic config from `_meta`
- [x] `NodeEditPanel.js` — node detail and edit panel + mockup generation
- [x] `NodeContextMenu.js` — right-click context menu (drill down, mark as focus)
- [x] `DrillBreadcrumb.js` — breadcrumb navigation for drill-down mode
- [x] `PrototypePlayer.js` — sandboxed iframe viewer for generated HTML mockups
- [x] `CodebaseUpload.js` — drag-and-drop file upload for codebase analysis
- [x] `LoadModal.js` — load saved sessions modal
- [x] `HistoryModal.js` — version history modal (up to 15 versions per idea)
- [x] `DebatePanel.js` — multi-round debate (critique + rebut + finalize), mode-specific
- [x] `MemoryLayer.js` — thinking pattern analysis display (blindspots, biases, strengths)
- [x] `SprintMode.js` — 20-minute sprint timer with 3 phases
- [x] `ResumeInput.js` — resume mode: JD URL fetch, paste JD, PDF upload
- [x] `ResumeChangesModal.js` — resume change manifest (summary + changes list)
- [x] `ExportGitHubModal.js` — export tree + debate to new GitHub repo
- [x] `exportMarkdown.js` — generate README.md, SPEC.md, DEBATE.md, CLAUDE.md
- [x] `Graph3D.js` — 3D force-directed graph (temporal rounds + type clusters)
- [x] `modeConfig.js` — mode definitions and auto-detect from input text
- [x] `useCanvasMode.js` — canvas state hook (nodes, sessions, handlers, auto-save); stores `dynamicTypesRef` for adaptive regen/drill
- [x] `layoutUtils.js` — dagre layout, edge building, BFS subtree extraction
- [x] `nodeConfig.js` — node type colors, icons, labels (incl. resume types); `DYNAMIC_PALETTE` (12 colors), `buildDynamicConfig()`, `getNodeConfig()` with dynamic override

### Persistence
- [x] LocalStorage auto-save (debounced 500ms on node count change)
- [x] Up to 10 sessions per mode (idea / codebase)
- [x] Up to 15 versions per idea
- [x] Last 20 sessions tracked for memory/pattern analysis
- [x] Resume banner on app open if recent session exists

## Running the App

```bash
npm run dev          # start both frontend and backend
npm run server       # backend only
npm run client       # frontend only
npm run install-all  # install all dependencies
```

- Frontend: http://localhost:3000
- Backend: http://localhost:5001

### Domain-Adaptive Mode (Idea Canvas)
- [x] Adaptive system prompt: Claude analyzes input domain, declares appropriate node types via `_meta` header, then generates tree — all in one streaming call
- [x] `_meta` protocol: first SSE line is `{"_meta": true, "domain": "...", "types": [{"type": "...", "label": "...", "icon": "..."}]}`, intercepted by frontend to configure rendering
- [x] URL auto-detection: client-side regex detects URLs in idea input, fetches content via `/api/fetch-url`, passes as `fetchedUrlContent` in generate request body
- [x] Dynamic color palette: 12 pre-tested dark-theme color sets assigned to AI-declared types
- [x] Dynamic legend: footer legend derives from actual node types present when adaptive config is active; falls back to static legend groups otherwise
- [x] Dynamic types threading: `dynamicTypes` passed to `/api/regenerate` and `/api/drill` so expanded branches use the same domain-specific type system

## Potential Future Enhancements

- [ ] Persist graphs to a database (server-side)
- [ ] Export tree as image or JSON (GitHub export already exists for markdown)
- [ ] Collaborative / shareable graph URLs
- [ ] Node search and filtering
- [ ] Undo/redo history
- [ ] Multiple trees / project management view
- [ ] Upgrade to `claude-sonnet-4-6` for faster streaming
- [ ] Wire Sprint mode into main nav (component exists)