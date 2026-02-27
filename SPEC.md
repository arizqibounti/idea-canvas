# Idea Graph — Specification

## Project Overview
An AI-powered structured thinking visualization tool that takes any input — product ideas, marketing campaigns, sales strategies, technical architectures, content plans — and generates a domain-adaptive, interactive visual tree. The AI analyzes the input domain, selects the most appropriate node types via a `_meta` protocol, and streams nodes in real-time. Includes meta-features for stress-testing: devil's advocate critique, multi-round debate, sprint mode, and cross-session memory/pattern analysis.

## Functional Requirements

### Core Features

1. **Domain-Adaptive Tree Generation**
   - User enters any free-text input (or pastes/attaches a plain-text file: .txt, .md, .csv, .json, .html, .rtf)
   - URLs in the input are auto-detected, fetched via `/api/fetch-url`, and their content included as reference context
   - Claude analyzes the input domain and emits a `_meta` header as the first SSE line: `{"_meta": true, "domain": "...", "types": [{"type": "...", "label": "...", "icon": "..."}]}`
   - Frontend intercepts `_meta` to configure dynamic rendering (colors, icons, legend) before tree nodes arrive
   - Claude generates 18–25 interconnected nodes using the declared domain-specific types
   - Nodes stream in one at a time via SSE
   - Optional steering instruction shifts the AI's focus
   - Supports incremental expansion of existing trees
   - **Multi-mode**: Request body can include `mode` (e.g. `idea`, `resume`). Resume mode accepts `jdText` and optional `resumePdf` (base64) for JD + resume analysis.

2. **Branch Regeneration**
   - Right-click any node to expand its subtree
   - Claude generates 5–10 new child nodes from the selected node
   - Accepts optional `dynamicTypes` to preserve adaptive node types from the original generation

3. **Deep Drill-Down**
   - Drill into a specific node for a 12–15 node deep-dive
   - Goes significantly more granular than the base tree
   - Breadcrumb UI (`DrillBreadcrumb.js`) tracks drill depth
   - Accepts optional `dynamicTypes` to preserve adaptive node types

4. **Feature Mockup Generator**
   - Select any feature node to generate an animated HTML prototype
   - Self-contained single HTML file, no external dependencies
   - Auto-plays and loops a scripted demo; 320×568px phone viewport
   - Dark theme with monospace font; timeline-based animations

5. **Codebase Analysis**
   - Drag-and-drop or folder-select a local codebase
   - Claude reverse-engineers a product thinking tree from the code (20–30 nodes)
   - Surfaces features, architecture patterns, user segments, and tech debt
   - Configurable analysis goals: features / architecture / users
   - File filtering: skips node_modules, build artifacts, binaries; max 150 files / 50KB total

5a. **Resume Mode**
   - User can paste a job description or enter a JD URL (fetched via `/api/fetch-url`, stripped to plain text).
   - User can optionally upload a resume PDF (sent as base64 to `/api/generate` with `mode: 'resume'`).
   - Claude generates a resume strategy tree (18–25 nodes): seed, requirement, skill_match, skill_gap, achievement, keyword, story, positioning.
   - After debate, **Apply to Resume** calls `/api/resume/changes` with tree, debate history, and optional PDF; returns a change manifest (summary + list of changes: section, type, original, replacement, reason). Shown in `ResumeChangesModal`.

5b. **Multi-mode and auto-detection**
   - Six canvas modes: Idea, Code (codebase), Resume, Decide, Write, Plan. Each has a dedicated system prompt and (where applicable) mode-specific debate critic/architect/finalize prompts.
   - Mode can be auto-detected from input text (keyword-based in `modeConfig.js`). User can lock/release mode by clicking the mode tab.

### Meta Features

6. **Devil's Advocate Mode**
   - Generates 8–12 `critique` nodes challenging the current tree's assumptions
   - Uses `/api/critique` endpoint; streams critique nodes onto the canvas

7. **VC Debate Mode**
   - Multi-round pitch simulation (up to 5 rounds)
   - Round flow: critic critique (`/api/debate/critique`) → architect/responder rebuttal (`/api/debate/rebut`). Request bodies include `mode` (idea | resume | codebase | decision | writing | plan) for mode-specific prompts (e.g. hiring manager vs career coach for resume, risk analyst vs PM for plan).
   - VC/critic gives structured critique; verdict and critiques returned as JSON.
   - Rebuttal nodes streamed via SSE, added to canvas with round prefix (e.g. `rebut_r2_`).
   - **Debate finalize**: After consensus, `/api/debate/finalize` (SSE) synthesizes the debate into the tree: streamed payloads may include `_update: true` for existing nodes (id, label, reasoning updates) or new synthesis nodes. Frontend applies updates in place and adds new nodes.

8. **Sprint Mode**
   - Gamified 20-minute focused session with 3 timed phases:
     - **Generate** (10 min): build the tree with optional steering
     - **Critique** (5 min): auto-triggers devil's advocate critique
     - **Converge** (5 min): star top 3 focus nodes using context menu
   - Visual countdown timer; phase-specific UI hints

9. **Memory Layer**
   - Tracks the last 20 sessions in localStorage
   - Sends session summaries to `/api/reflect` for pattern analysis
   - Identifies: blindspots (under-generated node types), biases (tendencies), strengths (rich areas)
   - Helps users recognize and correct thinking patterns over time

10. **Session Persistence & Version History**
    - Auto-saves canvas to localStorage on node count change (debounced 500ms)
    - Up to 10 saved sessions per mode (idea / codebase)
    - Up to 15 versions per unique idea (normalized + lowercased)
    - Load modal lists sessions with timestamp and node count
    - Resume banner on app open if a recent session exists

11. **Dual Canvas**
    - Independent idea mode and codebase mode
    - Switchable via tabs without losing state
    - Each mode has its own localStorage storage key
    - Resume, Decide, Write, Plan use the idea canvas and idea storage.

12. **Export to GitHub**
    - User can export the current tree (and optionally debate history) to a new GitHub repository.
    - `POST /api/export/github`: body `token`, `repoName`, `files` (object: filename → content), `isPrivate`. Creates repo and pushes files via GitHub Contents API.
    - Frontend generates markdown via `exportMarkdown.js`: README.md, SPEC.md, optionally DEBATE.md, CLAUDE.md. PAT can be stored in localStorage.

13. **3D Graph and 2D Temporal Navigation**
    - **3D view**: Toggle to a 3D force-directed graph (Graph3D.js, react-force-graph-3d): temporal round on X-axis, node-type clusters on YZ. Same node set as 2D.
    - **2D timeline**: When not in 3D, a timeline bar allows filtering by round range (SEED, GENERATE, R1 CRITIQUE, R1 REBUT, … SYNTHESIS). Play/pause and playback speed (0.5×, 1×, 2×); optional isolation of a single round. Nodes and edges outside the range are dimmed/hidden.

## Technical Stack

### Frontend
- **React 19.2.4**: Functional components and hooks
- **Create React App**: Build tooling and dev server (port 3000)
- **@xyflow/react 12.10.1**: Node-and-edge canvas visualization
- **dagre 0.8.5**: Hierarchical tree layout algorithm (top-to-bottom)
- **Fetch API / EventSource**: SSE streaming from backend
- **localStorage**: Session, version, and memory persistence

### Backend
- **Node.js + Express 4.18.2**: API server (port 5001)
- **@anthropic-ai/sdk 0.32.1**: Claude `claude-opus-4-5` model integration
- **SSE (Server-Sent Events)**: Real-time node streaming to frontend
- **CORS**: Configured for localhost:3000

## API Specification

### Base URL
```
http://localhost:5001/api
```

### POST /api/generate
Generate a full domain-adaptive thinking tree.

**Request:**
```json
{
  "idea": "string (required)",
  "steeringInstruction": "string (optional)",
  "existingNodes": "Node[] (optional, for steering)",
  "fetchedUrlContent": "[{url, text}] (optional, auto-fetched URL content)"
}
```
**Response:** SSE stream. First line is a `_meta` header: `{"_meta": true, "domain": "...", "types": [...]}`. Subsequent lines are node JSON objects. Terminated with `[DONE]`.

### POST /api/regenerate
Expand a node with new children.

**Request:**
```json
{
  "node": "Node (required)",
  "parentContext": "Node[] (optional)",
  "dynamicTypes": "[{type, label, icon}] (optional, for adaptive mode)"
}
```
**Response:** SSE stream of 5–10 new node JSON objects

### POST /api/drill
Deep-dive into a specific node.

**Request:**
```json
{
  "node": "Node (required)",
  "fullContext": "Node[] (optional)",
  "dynamicTypes": "[{type, label, icon}] (optional, for adaptive mode)"
}
```
**Response:** SSE stream of 12–15 new deep-dive node JSON objects

### POST /api/mockup
Generate an animated HTML prototype for a feature. **Non-streaming.**

**Request:**
```json
{
  "featureNode": "Node (required)",
  "ancestorContext": "Node[] (optional)"
}
```
**Response:** `{ "html": "string" }` — complete self-contained HTML file

### POST /api/analyze-codebase
Reverse-engineer a codebase into a product thinking tree.

**Request:**
```json
{
  "files": [{ "path": "string", "content": "string" }],
  "analysisGoals": ["features", "architecture", "users"],
  "folderName": "string",
  "filesOmitted": "number"
}
```
**Response:** SSE stream of 20–30 node JSON objects

### POST /api/critique
Generate devil's advocate critique nodes for the current tree.

**Request:**
```json
{
  "nodes": "Node[]",
  "idea": "string"
}
```
**Response:** SSE stream of 8–12 `critique` node JSON objects

### POST /api/debate/critique
VC-style structured evaluation. **Non-streaming.**

**Request:**
```json
{
  "nodes": "Node[]",
  "idea": "string",
  "round": "number (1–5)",
  "priorCritiques": "string[]"
}
```
**Response:**
```json
{
  "verdict": "YES | NO",
  "critiques": [{ "category": "string", "text": "string" }],
  "consensus_blockers": ["string"]
}
```

### POST /api/debate/rebut
Architect rebuttal nodes responding to VC critiques.

**Request:**
```json
{
  "nodes": "Node[]",
  "idea": "string",
  "critiques": "Critique[]",
  "round": "number"
}
```
**Response:** SSE stream of 1–3 rebuttal nodes per critique (prefixed `rebut_r{round}_`)

### POST /api/reflect
Analyze past idea sessions to identify thinking patterns. **Non-streaming.**

**Request:**
```json
{
  "sessions": [{ "idea": "string", "nodeCount": "number", "nodeTypeCounts": {}, "topLabels": ["string"] }]
}
```
**Response:**
```json
{
  "patterns": [{ "type": "blindspot | bias | strength", "title": "string", "description": "string" }]
}
```

### POST /api/debate/finalize
Synthesize debate into tree updates. **Streaming (SSE).** Payloads are JSON objects per line: either `{"_update": true, "id": "...", "type": "...", "label": "...", "reasoning": "..."}` to update an existing node, or new nodes `{"id": "final_N", "parentId": "...", "type": "...", "label": "...", "reasoning": "..."}`.

**Request:** `{ "nodes", "idea", "debateHistory", "mode" }`

### POST /api/export/github
Create a GitHub repo and push files. **Non-streaming.**

**Request:** `{ "token", "repoName", "repoDescription?", "isPrivate?", "files": { "filename": "content" } }`  
**Response:** `{ "repoUrl", "repoFullName" }`

### POST /api/resume/changes
Generate resume change manifest from debate and optional PDF. **Non-streaming.**

**Request:** `{ "resumePdf?", "nodes", "debateHistory", "idea" }`  
**Response:** `{ "summary", "changes": [{ "id", "section", "type", "original", "replacement", "category", "reason" }] }`

### POST /api/fetch-url
Proxy-fetch a URL and return stripped plain text (e.g. for job description scraping). **Non-streaming.**

**Request:** `{ "url" }`  
**Response:** `{ "text" }`

### GET /api/health
```json
{ "status": "ok" }
```

## Data Model

### Node Object
```javascript
{
  id: String,               // Unique identifier (e.g. "seed_1", "problem_2")
  parentId: String | null,  // Parent node id (null for seed node only)
  type: String,             // See node types below
  label: String,            // Short label (max 8 words)
  reasoning: String         // 1-2 sentence explanation
}
```

### Node Types

#### Static Types (hardcoded rendering config)
| Type | Description |
|------|-------------|
| `seed` | Root idea — exactly one per tree, parentId null |
| `problem` | Core problems the idea solves |
| `user_segment` | Target user groups |
| `job_to_be_done` | What users are trying to accomplish |
| `feature` | Specific product features |
| `constraint` | Technical, legal, or resource constraints |
| `metric` | How success is measured |
| `insight` | Strategic or market insights |
| `component` | Significant UI/code component (codebase analysis) |
| `api_endpoint` | API route or surface area (codebase analysis) |
| `data_model` | Schema or data structure (codebase analysis) |
| `tech_debt` | Code smell, coupling issue, or bottleneck (codebase analysis) |
| `critique` | Devil's advocate challenge node |
| *Resume mode* | |
| `requirement` | Key requirement from the job description |
| `skill_match` | Candidate background satisfying a requirement |
| `skill_gap` | Requirement candidate is weak on |
| `achievement` | Quantified accomplishment to highlight |
| `keyword` | Critical ATS/recruiter keyword |
| `story` | STAR-format narrative to prepare |
| `positioning` | Strategic framing angle for the resume |

#### Dynamic Types (adaptive mode)
In Idea mode, the AI declares domain-specific node types via the `_meta` protocol. These are not hardcoded — the AI chooses types that best fit the input domain. Examples:

- **Marketing/Ads**: `audience`, `pain_point`, `value_prop`, `keywords`, `negative`, `ad_copy`, `landing`, `metric`
- **Sales Strategy**: `target_account`, `buyer_persona`, `objection`, `value_prop`, `talk_track`, `closing_technique`
- **Content Strategy**: `audience`, `topic_cluster`, `content_format`, `distribution_channel`, `seo_keyword`, `cta`

Each dynamic type gets a distinct color from a 12-color dark-theme palette (`DYNAMIC_PALETTE` in `nodeConfig.js`). The `buildDynamicConfig(metaTypes)` function maps AI-declared types to palette slots using the AI-provided icon and label. `getNodeConfig(type, dynamicConfig)` checks dynamic config first, then falls back to static types.

## AI Model Configuration

- **Model**: `claude-opus-4-5`
- **Max tokens**: 4096 (generate/regenerate/drill/critique/debate/rebut), 6000 (mockup), 8192 (codebase analysis), 2048 (debate/critique), 1024 (reflect)
- **Output format**: One JSON object per line, no markdown, no arrays (streaming endpoints)
- **Streaming**: All endpoints use SSE except `/api/mockup`, `/api/debate/critique`, `/api/reflect`, `/api/export/github`, `/api/resume/changes`, `/api/fetch-url`
