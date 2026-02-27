# Idea Graph — Task Spec

## Project Overview
An AI-powered structured thinking visualization tool. Enter any input — product ideas, marketing campaigns, sales strategies, technical architectures, content plans — and Claude generates a domain-adaptive visual tree with the most appropriate node types, streamed in real-time. The AI detects the domain, declares types via a `_meta` protocol, and the frontend renders each type with distinct colors and icons. Meta-features let you stress-test ideas via devil's advocate critique, multi-round debate, sprint mode, and cross-session memory analysis.

## Core Capabilities

### 1. Domain-Adaptive Tree Generation
- Free-text input of any domain (or paste/attach plain-text file: .txt, .md, .csv, .json, .html, .rtf)
- URLs in input are auto-detected, fetched via `/api/fetch-url`, and content included as reference context
- Claude analyzes domain, emits `_meta` header (first SSE line) declaring types with labels/icons, then streams 18–25 nodes
- Frontend intercepts `_meta` to configure dynamic rendering (12-color palette, icons, legend)
- Optional steering instruction to shift AI focus
- Supports incremental expansion of existing trees
- **Multi-mode**: Idea, Code, Resume, Decide, Write, Plan — mode can be auto-detected from input or locked via tab. Resume mode: JD text/URL + optional PDF resume → resume strategy tree.

### 2. Branch Regeneration
- Right-click any node → expand its subtree
- 5–10 new child nodes generated from the selected node
- Preserves adaptive types via `dynamicTypes` parameter

### 3. Deep Drill-Down
- Select any node for a 12–15 node deep-dive
- Goes significantly more granular than the base tree
- Breadcrumb UI tracks drill depth
- Preserves adaptive types via `dynamicTypes` parameter

### 4. Feature Mockup Generator
- Select any feature node → generate an animated HTML prototype
- Self-contained, no external dependencies
- Auto-plays and loops a scripted UI demo; 320×568px phone viewport

### 5. Codebase Analysis
- Drag-and-drop any local codebase folder
- Claude reverse-engineers a product thinking tree from the code (20–30 nodes)
- Surfaces features, architecture patterns, user segments, and tech debt
- Configurable goals: features / architecture / users
- Auto-filters non-essential files (node_modules, build artifacts, binaries)

### 5a. Resume Mode
- Paste JD or enter JD URL (fetched via `/api/fetch-url`). Optionally upload resume PDF.
- Generates resume strategy tree (requirement, skill_match, skill_gap, achievement, keyword, story, positioning).
- Mode-specific debate (hiring manager vs career coach). **Apply to Resume** → `/api/resume/changes` → change manifest modal (summary + specific text changes).

### 6. Devil's Advocate Mode
- Generates 8–12 `critique` nodes challenging the current tree's assumptions
- Critique nodes stream onto the canvas via `/api/critique`

### 7. VC Debate Mode
- Multi-round pitch simulation (up to 5 rounds)
- Mode-specific critic/architect: Idea (VC vs architect), Resume (hiring manager vs career coach), Codebase (auditor vs tech lead), Decide/Write/Plan (domain-specific).
- Critic returns verdict + structured critiques; architect rebuts via SSE (`/api/debate/rebut`). **Debate finalize** (`/api/debate/finalize`, SSE): synthesizes debate into tree (node updates + new synthesis nodes).

### 8. Sprint Mode
- Gamified 20-minute session with 3 phases: Generate (10 min) → Critique (5 min) → Converge (5 min)
- Auto-triggers devil's advocate critique at end of Generate phase
- Converge phase enables starring focus nodes via context menu
- (Component present; optional in main UI.)

### 9. Memory Layer
- Tracks last 20 sessions in localStorage
- `/api/reflect` analyzes node type distributions to surface patterns
- Shows blindspots (types you under-generate), biases (tendencies), and strengths

### 10. Session Persistence & Version History
- Auto-saves canvas to localStorage; up to 10 sessions per mode (idea vs codebase)
- Up to 15 versions tracked per idea
- Resume banner on app open for quick re-entry

### 11. Export to GitHub
- Export tree (and optional debate) to a new GitHub repo. Generates README.md, SPEC.md, optionally DEBATE.md, CLAUDE.md. `POST /api/export/github`.

### 12. 3D Graph & 2D Temporal Navigation
- **3D**: Toggle to 3D force-directed view; rounds on X-axis, type clusters on YZ.
- **2D timeline**: Round range slider, play/pause, speed; filter visible nodes/edges by round (SEED → … → SYNTHESIS).

## Technical Stack

- **Frontend**: React 19, Create React App, @xyflow/react, dagre
- **Backend**: Node.js, Express, Anthropic SDK
- **AI Model**: `claude-opus-4-5`
- **Streaming**: Server-Sent Events (SSE) for real-time node delivery
- **Persistence**: Browser localStorage
- **Ports**: Frontend 3000, Backend 5001

## Node Types

### Static Types
Product/codebase: `seed` · `problem` · `user_segment` · `job_to_be_done` · `feature` · `constraint` · `metric` · `insight` · `component` · `api_endpoint` · `data_model` · `tech_debt` · `critique`

Resume: `requirement` · `skill_match` · `skill_gap` · `achievement` · `keyword` · `story` · `positioning`

### Dynamic Types (adaptive mode)
In Idea mode, the AI declares domain-specific types via the `_meta` protocol. Types are not hardcoded — they are chosen by the AI to best fit the input domain (e.g. `audience`, `ad_copy`, `keywords` for marketing; `target_account`, `objection`, `talk_track` for sales). Each dynamic type gets a distinct color from a 12-color palette via `buildDynamicConfig()` in `nodeConfig.js`.
