# Idea Graph — Task Plan

## Current Status: Fully Implemented

The application is running. All core and meta features are built.

---

## Completed

### Backend
- [x] Express backend with Anthropic SDK integration
- [x] SSE streaming for real-time node delivery
- [x] `/api/generate` — domain-adaptive tree generation (supports `mode`: idea, resume; resume: jdText, resumePdf; idea mode: adaptive prompt with `_meta` protocol, `fetchedUrlContent` for URL context)
- [x] `/api/regenerate` — branch expansion (5–10 nodes); accepts `dynamicTypes` for adaptive mode
- [x] `/api/drill` — deep-dive node generation (12–15 nodes); accepts `dynamicTypes` for adaptive mode
- [x] `/api/mockup` — animated HTML prototype generation
- [x] `/api/analyze-codebase` — codebase reverse-engineering (20–30 nodes)
- [x] `/api/critique` — devil's advocate critique nodes
- [x] `/api/debate/critique` — mode-specific structured evaluation (idea, resume, codebase, decision, writing, plan)
- [x] `/api/debate/rebut` — architect/responder rebuttal nodes (mode-aware)
- [x] `/api/debate/finalize` — synthesize debate into tree updates (SSE)
- [x] `/api/reflect` — cross-session thinking pattern analysis
- [x] `/api/export/github` — create repo and push markdown files
- [x] `/api/resume/changes` — resume change manifest from debate + optional PDF
- [x] `/api/fetch-url` — proxy fetch URL, return stripped plain text (JD scraping)

### Frontend
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
- [x] Load saved sessions modal
- [x] Version history modal (up to 15 versions per idea)
- [x] Debate panel (multi-round critique + rebuttal + finalize; mode-specific prompts)
- [x] Memory layer (blindspot / bias / strength pattern display)
- [x] Sprint mode (20-min timer, 3 phases; component present)
- [x] Session auto-save to localStorage
- [x] Resume banner for recent sessions
- [x] Export to GitHub modal (README, SPEC, DEBATE, CLAUDE markdown)
- [x] 3D graph view (Graph3D — temporal rounds + type clusters)
- [x] 2D temporal timeline (round range, play/pause, speed, isolate round)

---

### Domain-Adaptive Mode
- [x] Adaptive system prompt: Claude analyzes input domain, declares types via `_meta` header, generates tree — single streaming call
- [x] URL auto-detection in idea input (client-side regex), auto-fetch via `/api/fetch-url`, content passed as `fetchedUrlContent`
- [x] `_meta` protocol parsing in SSE stream, `buildDynamicConfig()` for dynamic color/icon mapping
- [x] 12-color dark-theme `DYNAMIC_PALETTE` for AI-declared types
- [x] Dynamic legend (derives from actual node types when adaptive config active)
- [x] `dynamicTypes` threading to regenerate and drill endpoints
- [x] `dynamicConfig` attached to flow nodes for `IdeaNode` rendering

## Potential Next Steps

- [ ] Server-side persistence (database)
- [ ] Export tree as PNG or JSON (markdown export to GitHub done)
- [ ] Shareable graph URLs
- [ ] Node search and filtering
- [ ] Undo/redo support
- [ ] Upgrade model to `claude-sonnet-4-6` for faster streaming
- [ ] Multiple trees / project switcher
- [ ] Wire Sprint mode into main UI (component exists)