# ThoughtClaw

An AI-powered structured thinking visualization tool that transforms any input — product ideas, marketing campaigns, sales strategies, content plans, resumes, decisions, writing projects, and project plans — into interactive, domain-adaptive trees streamed in real-time from Claude AI. The AI analyzes the input domain, selects the most appropriate node types, and generates a tree with distinct visual styling per type.

## Features

### Core canvas modes
- **Domain-Adaptive Idea Trees**: Enter any input and Claude AI automatically detects the domain, selects appropriate node types, and generates 18–25 interconnected nodes. The AI emits a `_meta` header declaring the domain and types, which the frontend uses to configure colors, icons, and legend dynamically.
- **Six Canvas Modes**: Idea, Code (codebase), Resume, Decide, Write, Plan — each with tailored system prompts, mode-specific debate personas, and contextual UI labels. Auto-detected from input text or manually locked via mode tabs.
- **URL Auto-Detection & Fetching**: URLs in the input are automatically detected, fetched via the server proxy, and their content is included as reference context for the AI.
- **Multi-Agent Research**: Deep research mode that plans a research strategy, fetches multiple URLs, and synthesizes findings into a comprehensive tree.
- **Branch Regeneration**: Expand any node with 5–10 new AI-generated child nodes
- **Deep Drill-Down**: Perform a 12–15 node deep-dive on a specific branch for granular exploration (double-click any node)
- **Fractal Exploration**: Infinitely deepen any branch like a fractal:
  - **Inline ⊕ Expansion**: Click the ⊕ button on any leaf node to generate 2–7 adaptive AI children based on concept complexity
  - **Branch Collapse/Expand**: Chevron toggles (▸/▾) on parent nodes to collapse/expand subtrees with child counts
  - **Depth Visualization**: Level indicators (L2, L3, ...) on nodes at depth ≥ 2; unexplored leaf nodes glow to signal "there's more"
  - **Autonomous ∞ Explore**: AI autonomously explores the tree for 1–10 configurable rounds, selecting the most promising node at each step and drilling deeper — a curiosity engine that explores for you
- **Feature Mockup Generator**: Generate a self-contained, animated HTML prototype from any feature node
- **Codebase Analysis**: Upload a codebase and Claude reverse-engineers it into a product thinking tree
- **Steering Instructions**: Guide tree expansion in a specific direction using natural language
- **Resume Mode**: Paste a job description or enter a JD URL, optionally upload your resume PDF. Generates a resume strategy tree. After debate, **Apply to Resume** produces an actionable change manifest.
- **File Upload**: Attach plain-text files (.txt, .md, .csv, .json, .html, .rtf) to prefill the idea field
- **Node Scoring**: Automated quality scoring of nodes (relevance, specificity, actionability)
- **Template Extraction**: Extract structural templates from generated trees for reuse

### Stress-testing and debate
- **Mode-Specific Debate**: Multi-round autonomous debate between domain-specific personas:
  - **Idea**: VC Critic vs Architect
  - **Resume**: Hiring Manager vs Career Coach
  - **Codebase**: Security Auditor vs Tech Lead
  - **Decision**: Devil's Advocate vs Strategic Advisor
  - **Writing**: Senior Editor vs Writer
  - **Plan**: Risk Analyst vs Project Manager
- **Debate Finalize**: After consensus, the responder synthesizes the debate into the tree via streamed updates
- **Debate Suggestions**: Clickable suggestion chips from debate insights that can be expanded into new tree branches
- **Sprint Mode**: Gamified 20-minute focused session with 3 phases: Generate, Critique, Converge

### AI Chat Companion
- **Mode-Specific Personas**: Product Strategist (idea), Career Coach (resume), Tech Advisor (code), Decision Analyst (decide), Writing Editor (write), Project Advisor (plan)
- **Tree-Aware Context**: The full thinking tree is loaded as context for grounded, specific responses
- **Markdown Rendering**: Rich markdown output with syntax-highlighted code blocks, tables, lists, and copy buttons
- **Quick Actions**: Mode-specific quick action buttons (e.g., "Cover Letter", "LinkedIn Summary" for resume mode)

### A2UI Canvas Panel
- **Interactive Visualizations**: Generate self-contained HTML artifacts from tree analysis
- **Multiple Artifacts**: Manage a collection of generated visual outputs

### Visualization and navigation
- **3D Graph**: Toggle to a 3D force-directed view with temporal rounds on the X-axis and node-type clusters on YZ
- **2D Temporal Navigation**: Timeline bar with round range slider, play/pause, playback speed, and optional round isolation
- **Cross-Links**: Toggle visibility of cross-relationship edges between non-parent nodes
- **Node Search**: Filter nodes by text with dimming of non-matching nodes

### Export and sharing
- **Share via Link**: Generate shareable tree links stored in Firestore
- **Export Dropdown**: Export as PNG, SVG, interactive HTML, or copy to clipboard
- **Export to GitHub**: Create a new GitHub repo with markdown files generated from the tree and debate history

### Authentication and persistence
- **Firebase Authentication**: Google sign-in with landing page for unauthenticated users
- **Session Dashboard**: Grid view of all saved sessions with node counts, timestamps, and mode badges
- **Firestore Persistence**: Server-side session storage via Firebase/Firestore gateway
- **Usage Tracking**: Per-user generation limits with visual usage indicator
- **Rate Limiting**: Request throttling for generation and general API endpoints
- **Local Auto-Save**: Automatic canvas saves to localStorage with session resume banners
- **Version History**: Up to 15 versions per idea for comparing iterations
- **Memory Layer**: Cross-session pattern analysis identifying blindspots, biases, and strengths

## Project Structure

```
├── client/                          # React frontend
│   └── src/
│       ├── App.js                   # Main shell, mode switching, toolbar, timeline
│       ├── App.css                  # All styles (dark theme)
│       ├── AuthContext.js           # Firebase auth provider + Google sign-in
│       ├── LandingPage.js           # Unauthenticated landing page
│       ├── SessionDashboard.js      # Saved sessions grid view
│       ├── IdeaCanvas.js            # ReactFlow canvas with node layout, double-click drill
│       ├── IdeaNode.js              # Node component (⊕ expand, collapse chevron, depth, glow)
│       ├── NodeEditPanel.js         # Node detail/edit panel + mockup generation
│       ├── NodeContextMenu.js       # Right-click context menu
│       ├── DrillBreadcrumb.js       # Drill-down breadcrumb navigation
│       ├── PrototypePlayer.js       # iframe viewer for HTML mockups
│       ├── CodebaseUpload.js        # Drag-and-drop codebase file upload
│       ├── DebatePanel.js           # Mode-specific debate loop (critique + rebut + finalize)
│       ├── ChatPanel.js             # AI chat companion with markdown rendering
│       ├── CanvasPanel.js           # A2UI interactive visualization panel
│       ├── MemoryLayer.js           # Thinking pattern analysis UI
│       ├── SprintMode.js            # 20-minute sprint timer + phase management
│       ├── ResumeInput.js           # Resume mode: JD URL fetch, paste JD, PDF upload
│       ├── ResumeChangesModal.js    # Resume change manifest modal
│       ├── ShareModal.js            # Share tree via link modal
│       ├── ShareViewer.js           # Public shared tree viewer
│       ├── ExportDropdown.js        # PNG/SVG/HTML/clipboard export dropdown
│       ├── ExportGitHubModal.js     # Export tree + debate to GitHub repo
│       ├── LoadModal.js             # Load saved sessions modal
│       ├── HistoryModal.js          # Version history modal
│       ├── Graph3D.js               # 3D force-directed graph
│       ├── api.js                   # Auth-aware fetch wrapper (token injection)
│       ├── exportImage.js           # PNG, SVG, clipboard, interactive HTML export
│       ├── exportMarkdown.js        # Markdown generation for GitHub export
│       ├── modeConfig.js            # Mode definitions + auto-detect from input
│       ├── useCanvasMode.js         # Canvas state hook (nodes, sessions, fractal expand/collapse, auto-fractal)
│       ├── layoutUtils.js           # Dagre layout, edge building, collapse filtering, depth computation
│       ├── nodeConfig.js            # Node type colors/icons, dynamic palette
│       ├── TemplateStore.js         # Structural template persistence
│       └── gateway/
│           └── useGateway.js        # Firestore session sync gateway hook
├── server/                          # Node.js/Express backend
│   ├── server.js                    # Express app, route wiring, WebSocket setup
│   ├── engine/
│   │   ├── prompts.js               # All system prompts + debate/chat/fractal personas
│   │   ├── generate.js              # Tree generation (single, multi-agent, research, fractal expand/select)
│   │   ├── debate.js                # Debate handlers (critique, rebut, finalize)
│   │   ├── chat.js                  # Chat companion handler
│   │   ├── analyze.js               # Codebase analysis, scoring, templates
│   │   └── specialty.js             # Mockup, resume changes, reflect, critique
│   ├── canvas/
│   │   ├── engine.js                # A2UI canvas generation
│   │   └── prompts.js               # Canvas system prompts
│   ├── gateway/
│   │   ├── protocol.js              # Gateway WebSocket protocol handler
│   │   ├── sessions.js              # Firestore session CRUD
│   │   ├── shares.js                # Firestore share link CRUD
│   │   ├── usage.js                 # Per-user usage tracking
│   │   └── websocket.js             # WebSocket server setup
│   ├── middleware/
│   │   ├── auth.js                  # Firebase token verification middleware
│   │   └── rateLimit.js             # Request rate limiting
│   └── utils/
│       ├── sse.js                   # SSE streaming helpers
│       ├── web.js                   # URL fetching + HTML stripping
│       └── research.js              # Multi-URL research crawler
├── .env.example                     # Environment variable template
├── Dockerfile                       # Production Docker build
└── package.json                     # Root package.json (runs both with concurrently)
```

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- An Anthropic API key
- Firebase project with Authentication enabled (Google sign-in)

### Environment Variables

Copy `.env.example` and fill in your values:

```bash
cp .env.example .env
```

Required variables:
- `ANTHROPIC_API_KEY` — Your Anthropic API key
- `REACT_APP_FIREBASE_API_KEY` — Firebase client API key
- `REACT_APP_FIREBASE_AUTH_DOMAIN` — Firebase auth domain
- `REACT_APP_FIREBASE_PROJECT_ID` — Firebase project ID

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

### Docker

```bash
docker build -t thoughtclaw .
docker run -p 8080:8080 --env-file .env thoughtclaw
```

## API Endpoints

All AI responses stream in real-time using Server-Sent Events (SSE) unless noted.

### Authentication
All `/api/*` endpoints (except `/api/health` and `/api/shares/:id`) require a Firebase ID token in the `Authorization: Bearer <token>` header.

### Generation

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/generate` | POST | Generate a full domain-adaptive tree. Body: `idea`, `mode`, optional `steeringInstruction`, `existingNodes`, `fetchedUrlContent`; resume: `jdText`, `resumePdf`. SSE stream with `_meta` header. |
| `/api/generate-multi` | POST | Multi-agent generation (first principles + analogical + adversarial → merge). SSE stream. |
| `/api/generate-research` | POST | Research-mode generation: plans research strategy, crawls URLs, synthesizes findings. SSE stream. |
| `/api/regenerate` | POST | Expand a specific node with 5–10 child nodes. Accepts `dynamicTypes`. |
| `/api/drill` | POST | Deep-dive into a branch (12–15 nodes). Accepts `dynamicTypes`. |
| `/api/fractal-expand` | POST | Fractal expand a leaf node into 2–7 adaptive children based on concept complexity. SSE stream. |
| `/api/fractal-select` | POST | AI evaluates leaf nodes and selects the most promising one for autonomous exploration. Non-streaming JSON. |

### Analysis & Scoring

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/analyze-codebase` | POST | Reverse-engineer codebase files into a tree |
| `/api/score-nodes` | POST | Score nodes for relevance, specificity, actionability |
| `/api/extract-template` | POST | Extract structural template from a tree |
| `/api/critique` | POST | Generate 8–12 devil's advocate critique nodes |

### Debate

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/debate/critique` | POST | Mode-specific structured evaluation. Non-streaming JSON. |
| `/api/debate/rebut` | POST | Mode-specific responder rebuttal nodes. SSE stream. |
| `/api/debate/finalize` | POST | Synthesize debate into tree updates. SSE stream. |
| `/api/expand-suggestion` | POST | Expand a debate suggestion into new tree nodes. SSE stream. |

### Chat & Canvas

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chat` | POST | Mode-specific AI chat companion. SSE stream of text chunks. |
| `/api/canvas/generate` | POST | Generate interactive HTML visualization. SSE stream. |

### Specialty

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mockup` | POST | Generate animated HTML prototype. Non-streaming. |
| `/api/resume/changes` | POST | Resume change manifest from debate. Non-streaming. |
| `/api/reflect` | POST | Analyze past sessions for thinking patterns. Non-streaming. |

### Export & Sharing

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/export/github` | POST | Create GitHub repo and push markdown files |
| `/api/shares` | POST | Create a shareable link for a tree |
| `/api/shares/:id` | GET | Retrieve shared tree data (public, no auth) |
| `/api/shares/:id` | DELETE | Delete a shared link |

### Sessions & Usage

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sessions` | GET | List user's saved sessions |
| `/api/sessions/:id` | GET | Get a specific session |
| `/api/sessions/:id` | DELETE | Delete a session |
| `/api/usage` | GET | Get user's daily generation usage |

### Utilities

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/fetch-url` | POST | Proxy-fetch URL, return stripped plain text |
| `/api/crawl-site` | POST | Crawl multiple pages from a site |
| `/api/health` | GET | Health check |

### WebSocket

| Endpoint | Description |
|----------|-------------|
| `/ws` | Gateway WebSocket for real-time session sync and persistence |

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
| `component` | UI/code components (codebase analysis) |
| `api_endpoint` | API surface area (codebase analysis) |
| `data_model` | Data schemas (codebase analysis) |
| `tech_debt` | Code smells and bottlenecks (codebase analysis) |
| `critique` | Devil's advocate challenge nodes |

**Resume mode**: `requirement` · `skill_match` · `skill_gap` · `achievement` · `keyword` · `story` · `positioning`

### Dynamic Types (adaptive mode)

In Idea mode, the AI analyzes the input domain and declares its own node types via the `_meta` protocol. Each dynamic type is assigned a distinct color from a 12-color dark-theme palette.

## Technologies Used

- **Frontend**: React 19, Create React App, @xyflow/react (ReactFlow), dagre, react-markdown, remark-gfm, react-force-graph-3d
- **Backend**: Node.js, Express, WebSocket (ws)
- **AI**: Anthropic Claude (`claude-opus-4-5` for debate/generation, `claude-sonnet-4-20250514` for chat/utilities) via streaming SSE
- **Authentication**: Firebase Auth (Google sign-in)
- **Persistence**: Firebase/Firestore (server-side sessions, shares, usage) + browser localStorage (auto-save, versions, memory)
- **Infrastructure**: Docker, CORS, rate limiting
- **Development**: Concurrently (runs client + server)
