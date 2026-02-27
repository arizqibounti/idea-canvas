# Idea Graph

An AI-powered structured thinking visualization tool that transforms any input — product ideas, marketing campaigns, sales strategies, content plans, and more — into interactive, domain-adaptive trees streamed in real-time from Claude AI. The AI analyzes the input domain, selects the most appropriate node types, and generates a tree with distinct visual styling per type.

## Features

### Core canvas modes
- **Domain-Adaptive Idea Trees**: Enter any input — product ideas, marketing campaigns, sales strategies, technical architectures, content plans — and Claude AI automatically detects the domain, selects appropriate node types, and generates 18–25 interconnected nodes. The AI emits a `_meta` header declaring the domain and types, which the frontend uses to configure colors, icons, and legend dynamically.
- **URL Auto-Detection & Fetching**: URLs in the input are automatically detected, fetched via the server proxy, and their content is included as reference context for the AI — no need to copy-paste website content manually.
- **Branch Regeneration**: Expand any node with 5–10 new AI-generated child nodes (uses the same domain-specific types via `dynamicTypes` threading)
- **Deep Drill-Down**: Perform a 12–15 node deep-dive on a specific branch for granular exploration (preserves adaptive types)
- **Feature Mockup Generator**: Generate a self-contained, animated HTML prototype from any feature node
- **Codebase Analysis**: Upload a codebase and Claude reverse-engineers it into a product thinking tree — surfacing features, architecture patterns, user segments, and tech debt
- **Steering Instructions**: Guide tree expansion in a specific direction using natural language
- **Multi-mode canvases**: Six modes with auto-detection from input text — **Idea**, **Code** (codebase), **Resume**, **Decide**, **Write**, **Plan**. Each mode uses a tailored system prompt and (where applicable) mode-specific debate (e.g. hiring manager vs career coach for Resume, risk analyst vs PM for Plan). Manual mode lock: click a tab to lock or release.
- **Resume mode**: Paste a job description or enter a JD URL (fetched and stripped server-side), optionally upload your resume PDF. Generates a resume strategy tree (requirements, skill matches/gaps, achievements, keywords, stories, positioning). After debate, **Apply to Resume** produces an actionable change manifest (summary + specific text changes) shown in a modal.
- **File upload (idea input)**: Attach plain-text files (.txt, .md, .csv, .json, .html, .rtf) to prefill the idea field; content is loaded into the textarea (no PDF/Word).

### Stress-testing and debate
- **Devil's Advocate Mode**: Generate 8–12 critique nodes that challenge the assumptions in your tree
- **VC Debate Mode**: Multi-round pitch simulation — a VC critic evaluates your idea, an architect rebuts, up to 5 rounds with a final YES/NO verdict. Mode-specific variants: Resume (hiring manager vs career coach), Codebase (auditor vs tech lead), Decide (devil's advocate vs strategic advisor), Write (editor vs writer), Plan (risk analyst vs PM).
- **Debate finalize**: After consensus, the architect (or mode equivalent) synthesizes the debate into the tree via streamed updates: existing nodes can be updated and new synthesis nodes added.
- **Sprint Mode**: Gamified 20-minute focused session with 3 phases: Generate (10 min), Critique (5 min), Converge (5 min) — component present; optional in UI.

### Visualization and export
- **3D Graph**: Toggle to a 3D force-directed view (react-force-graph-3d) with temporal rounds on the X-axis and node-type clusters on YZ.
- **2D Temporal navigation**: Timeline bar for idea canvas: round range slider (SEED → GENERATE → R1 CRITIQUE → R1 REBUT → … → SYNTHESIS), play/pause, playback speed (0.5×, 1×, 2×), and optional isolation of a single round to filter visible nodes/edges.
- **Export to GitHub**: Create a new GitHub repo and push markdown files (README.md, SPEC.md, optionally DEBATE.md and CLAUDE.md) generated from the tree and debate history. Uses GitHub PAT (stored in localStorage).

### Persistence and memory
- **Memory Layer**: Tracks thinking patterns across sessions — identifies blindspots, biases, and strengths
- **Session Persistence**: Auto-saves canvas to localStorage; load any previous session via the Load modal
- **Version History**: Keeps up to 15 versions per idea for comparing iterations
- **Dual Canvas**: Independent idea mode and codebase mode, switchable without losing state (resume/decide/write/plan use the idea canvas and storage).

## Project Structure

```
├── client/          # React frontend (canvas-based UI)
│   └── src/
│       ├── App.js                # Main shell, mode switching, top-level state, 2D timeline
│       ├── IdeaCanvas.js         # ReactFlow canvas with node layout
│       ├── IdeaNode.js           # Individual node component
│       ├── NodeEditPanel.js      # Node detail/edit panel + mockup generation
│       ├── NodeContextMenu.js    # Right-click context menu
│       ├── DrillBreadcrumb.js    # Drill-down breadcrumb navigation
│       ├── PrototypePlayer.js    # iframe viewer for generated HTML mockups
│       ├── CodebaseUpload.js     # Drag-and-drop codebase file upload
│       ├── LoadModal.js          # Load saved sessions modal
│       ├── HistoryModal.js       # Version history modal
│       ├── DebatePanel.js        # Multi-mode debate loop (critique + rebut + finalize)
│       ├── MemoryLayer.js        # Thinking pattern analysis UI
│       ├── SprintMode.js         # 20-minute sprint timer + phase management
│       ├── ResumeInput.js        # Resume mode: JD URL fetch, paste JD, PDF upload
│       ├── ResumeChangesModal.js # Resume change manifest (from debate + optional PDF)
│       ├── ExportGitHubModal.js  # Export tree + debate to new GitHub repo
│       ├── exportMarkdown.js     # Generate README.md, SPEC.md, DEBATE.md, CLAUDE.md
│       ├── Graph3D.js            # 3D force-directed graph (temporal rounds + type clusters)
│       ├── modeConfig.js         # Mode definitions + auto-detect from input
│       ├── useCanvasMode.js      # Canvas state hook (nodes, sessions, handlers, dynamicTypesRef)
│       ├── layoutUtils.js        # Dagre tree layout + edge building
│       └── nodeConfig.js         # Node type colors/icons, dynamic palette, buildDynamicConfig()
├── server/          # Node.js/Express backend
│   └── server.js                 # All API routes + Anthropic SDK integration
└── package.json     # Root package.json (runs both with concurrently)
```

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- An Anthropic API key set as `ANTHROPIC_API_KEY` in your environment

### Installation

```bash
npm run install-all
```

### Running the Application

```bash
npm run dev
```

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:5001

## API Endpoints

All AI responses stream in real-time using Server-Sent Events (SSE) unless noted. Non-streaming: `/api/mockup`, `/api/debate/critique`, `/api/reflect`, `/api/export/github`, `/api/resume/changes`, `/api/fetch-url`.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/generate` | POST | Generate a full tree from an idea. Body: `idea`, `mode` (e.g. `idea` \| `resume`), optional `steeringInstruction` + `existingNodes`, `fetchedUrlContent`; for resume: `jdText`, `resumePdf` (base64). Idea mode uses an adaptive prompt; first SSE line is a `_meta` header declaring domain-specific types. |
| `/api/regenerate` | POST | Expand a specific node with new child nodes. Accepts optional `dynamicTypes` for adaptive mode. |
| `/api/drill` | POST | Deep-dive into a specific branch. Accepts optional `dynamicTypes` for adaptive mode. |
| `/api/mockup` | POST | Generate an animated HTML prototype for a feature node |
| `/api/analyze-codebase` | POST | Reverse-engineer codebase files into a product tree |
| `/api/critique` | POST | Generate devil's advocate critique nodes |
| `/api/debate/critique` | POST | Mode-specific structured evaluation (body: `nodes`, `idea`, `round`, `priorCritiques`, `mode`). Returns JSON verdict + critiques. |
| `/api/debate/rebut` | POST | Architect/responder rebuttal nodes (body includes `mode`). SSE stream. |
| `/api/debate/finalize` | POST | Synthesize debate into tree updates (updates + new nodes). Body: `nodes`, `idea`, `debateHistory`, `mode`. SSE stream. |
| `/api/reflect` | POST | Analyze past sessions to identify thinking patterns |
| `/api/export/github` | POST | Create GitHub repo and push markdown files (token, repoName, files, isPrivate) |
| `/api/resume/changes` | POST | Generate resume change manifest from debate + optional `resumePdf` and tree |
| `/api/fetch-url` | POST | Proxy-fetch URL, return stripped plain text (e.g. for JD scraping). Body: `url`. |
| `/api/health` | GET | Health check |

## Node Types

### Static Types (hardcoded rendering)

| Type | Description |
|------|-------------|
| `seed` | Root idea node |
| `problem` | Core problems the idea solves |
| `user_segment` | Target user groups |
| `job_to_be_done` | What users are trying to accomplish |
| `feature` | Specific product features |
| `constraint` | Technical, legal, or resource constraints |
| `metric` | How success is measured |
| `insight` | Strategic or market insights |
| `component` | Significant UI/code components (codebase analysis) |
| `api_endpoint` | API surface area (codebase analysis) |
| `data_model` | Data schemas and structures (codebase analysis) |
| `tech_debt` | Code smells and bottlenecks (codebase analysis) |
| `critique` | Devil's advocate challenge nodes |
| *Resume mode* | |
| `requirement` | Key requirements from the job description |
| `skill_match` | Where the candidate's background satisfies a requirement |
| `skill_gap` | Requirement the candidate is weak on or missing |
| `achievement` | Quantified accomplishment to lead with |
| `keyword` | Critical ATS/recruiter keyword from the JD |
| `story` | STAR-format narrative to prepare |
| `positioning` | Strategic framing angle for the resume |

### Dynamic Types (adaptive mode)

In Idea mode, the AI analyzes the input domain and declares its own node types via the `_meta` protocol. For example, a Google Ads campaign input might produce types like `audience`, `pain_point`, `value_prop`, `keywords`, `negative`, `ad_copy`, `landing`, `metric`. Each dynamic type is assigned a distinct color from a 12-color dark-theme palette. If the AI-declared type matches a static type (e.g. `seed`, `metric`), the static config is used; otherwise the dynamic palette takes over.

## Technologies Used

- **Frontend**: React 19, Create React App, @xyflow/react (ReactFlow), dagre
- **Backend**: Node.js, Express
- **AI**: Anthropic Claude (`claude-opus-4-5`) via streaming SSE
- **Persistence**: Browser localStorage (sessions, versions, memory patterns)
- **Development**: Concurrently
