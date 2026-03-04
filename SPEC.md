# Idea Canvas — Specification

## Project Overview
An AI-powered structured thinking visualization tool that takes any input — product ideas, marketing campaigns, sales strategies, technical architectures, content plans, resumes, decisions, writing projects, and project plans — and generates a domain-adaptive, interactive visual tree. The AI analyzes the input domain, selects the most appropriate node types via a `_meta` protocol, and streams nodes in real-time. Includes mode-specific debate, AI chat companion, sharing, export, and Firebase authentication.

## Functional Requirements

### Core Features

1. **Domain-Adaptive Tree Generation**
   - User enters any free-text input (or pastes/attaches a plain-text file: .txt, .md, .csv, .json, .html, .rtf)
   - URLs in the input are auto-detected, fetched via `/api/fetch-url`, and their content included as reference context
   - Claude analyzes the input domain and emits a `_meta` header as the first SSE line: `{"_meta": true, "domain": "...", "types": [...]}`
   - Frontend intercepts `_meta` to configure dynamic rendering (colors, icons, legend) before tree nodes arrive
   - Claude generates 18–25 interconnected nodes using the declared domain-specific types
   - Nodes stream in one at a time via SSE
   - Optional steering instruction shifts the AI's focus
   - Supports incremental expansion of existing trees
   - **Multi-mode**: Six modes — Idea, Code, Resume, Decide, Write, Plan. Auto-detected from input or locked via tabs.

2. **Multi-Agent Generation**
   - Three parallel AI agents (first principles, analogical, adversarial) generate trees independently
   - A merge agent synthesizes the best nodes from all three perspectives
   - Progress indicators show each agent's status during generation

3. **Research Mode Generation**
   - AI plans a research strategy from the input
   - Crawls multiple URLs for source material
   - Synthesizes research findings into a comprehensive tree

4. **Branch Regeneration**
   - Right-click any node to expand its subtree
   - Claude generates 5–10 new child nodes from the selected node
   - Accepts optional `dynamicTypes` to preserve adaptive node types

5. **Deep Drill-Down**
   - Drill into a specific node for a 12–15 node deep-dive (double-click any node)
   - Goes significantly more granular than the base tree
   - Breadcrumb UI tracks drill depth; preserves adaptive types

6. **Fractal Exploration**
   - **Inline ⊕ Expansion**: Click the ⊕ button on any leaf node to fractally decompose it into 2–7 adaptive AI-generated children based on concept complexity (simple → 2–3, moderate → 3–5, rich/abstract → 5–7)
   - **Branch Collapse/Expand**: Chevron toggles (▸/▾) on parent nodes to collapse/expand subtrees; collapsed nodes display child count badge
   - **Depth Visualization**: Level indicators (L2, L3, ...) shown on nodes at depth ≥ 2; unexplored leaf nodes emit a subtle purple glow to signal further exploration potential
   - **Autonomous ∞ Explore Mode**: AI-driven curiosity engine that autonomously explores the tree for 1–10 configurable rounds:
     1. Collects all leaf (unexplored) nodes
     2. AI selects the most promising node based on novelty, strategic importance, and surprise factor
     3. Fractally expands the selected node
     4. Repeats for N rounds with live progress (round indicator, AI reasoning, node count)
     5. User can stop at any time; auto-explored nodes marked with ∞ badge
   - Supports infinite depth — expand any node, then expand its children, and so on

7. **Feature Mockup Generator**
   - Select any feature node to generate an animated HTML prototype
   - Self-contained single HTML file, no external dependencies
   - Auto-plays and loops a scripted demo; 320×568px phone viewport

7. **Codebase Analysis**
   - Drag-and-drop or folder-select a local codebase
   - Claude reverse-engineers a product thinking tree from the code (20–30 nodes)
   - Surfaces features, architecture patterns, user segments, and tech debt

8. **Resume Mode**
   - Paste a job description or enter a JD URL (fetched and stripped server-side)
   - Optionally upload resume PDF (base64)
   - Generates a resume strategy tree (requirement, skill_match, skill_gap, achievement, keyword, story, positioning)
   - After debate, **Apply to Resume** → change manifest modal

### Debate System

9. **Mode-Specific Autonomous Debate**
   - Multi-round debate (up to 5 rounds) between domain-specific personas:
     - **Idea**: VC Critic vs Architect → panel title "VC CRITIQUE"
     - **Resume**: Hiring Manager vs Career Coach → "HIRING REVIEW"
     - **Codebase**: Security Auditor vs Tech Lead → "CODE AUDIT"
     - **Decision**: Devil's Advocate vs Strategic Advisor → "DEVIL'S ADVOCATE"
     - **Writing**: Senior Editor vs Writer → "EDITORIAL REVIEW"
     - **Plan**: Risk Analyst vs Project Manager → "RISK ANALYSIS"
   - Critic returns verdict + structured critiques; responder rebuts via SSE
   - **Debate finalize**: Synthesizes debate into tree updates (node updates + new synthesis nodes)
   - **Suggestion expansion**: Clickable suggestion chips from debate insights expand into new tree branches

### AI Chat Companion

10. **Mode-Specific Chat**
    - Mode-aware personas matching server-side `CHAT_PERSONAS`:
      - Idea → Product Strategist
      - Resume → Career Coach
      - Codebase → Tech Advisor
      - Decision → Decision Analyst
      - Writing → Writing Editor
      - Plan → Project Advisor
    - Full thinking tree loaded as context for grounded responses
    - Rich markdown rendering: syntax-highlighted code blocks (with copy buttons), tables, lists, blockquotes, links
    - Mode-specific quick action buttons (e.g., Cover Letter, LinkedIn Summary for resume)

### A2UI Canvas Panel

11. **Interactive Visualizations**
    - Generate self-contained HTML artifacts from tree analysis
    - Manage a collection of generated visual outputs
    - Panel with artifact tabs and live preview

### Visualization & Navigation

12. **3D Graph**
    - Toggle to 3D force-directed view (react-force-graph-3d)
    - Temporal rounds on X-axis, node-type clusters on YZ

13. **2D Temporal Navigation**
    - Timeline bar: round range slider, play/pause, playback speed (0.5×, 1×, 2×)
    - Optional round isolation to filter visible nodes/edges
    - Cross-link toggle for non-parent relationship edges

14. **Node Search**
    - Text search with real-time filtering
    - Non-matching nodes dimmed with opacity + brightness + saturation filters

### Export & Sharing

15. **Share via Link**
    - Generate shareable Firestore-backed links
    - Public viewer for shared trees (no auth required)

16. **Export**
    - **PNG**: High-res canvas screenshot
    - **SVG**: Vector export
    - **Interactive HTML**: Self-contained HTML file with full tree
    - **Clipboard**: Copy tree as image
    - **GitHub**: Create new repo with README.md, SPEC.md, DEBATE.md, CLAUDE.md

### Authentication & Persistence

17. **Firebase Authentication**
    - Google sign-in via Firebase Auth
    - Landing page for unauthenticated users
    - All API endpoints require auth (except health + public shares)
    - Token-based auth via `Authorization: Bearer <token>` header

18. **Session Dashboard**
    - Grid view of all saved sessions
    - Shows: mode badge, idea text preview, node count, timestamp, save indicator
    - Filters out empty/untitled sessions with 0 nodes
    - Click to load session into canvas

19. **Server-Side Persistence (Firestore)**
    - Session CRUD via REST endpoints + WebSocket gateway
    - Share link storage
    - Per-user daily usage tracking

20. **Client-Side Persistence (localStorage)**
    - Auto-save canvas on node count change (debounced 500ms)
    - Up to 10 sessions per mode, 15 versions per idea
    - Resume banner on app open
    - Memory layer: last 20 sessions for pattern analysis

21. **Rate Limiting & Usage**
    - General: 60 requests/minute
    - Generation: 10 requests/minute
    - Daily generation limits with visual usage indicator

### Meta Features

22. **Node Scoring**
    - Automated quality scoring (1–10) on three dimensions: relevance, specificity, actionability

23. **Template Extraction**
    - Extract structural templates from generated trees for reuse across inputs

24. **Memory Layer**
    - Tracks last 20 sessions for pattern analysis
    - Identifies blindspots, biases, and strengths in thinking patterns

25. **Sprint Mode**
    - Gamified 20-minute session: Generate (10 min) → Critique (5 min) → Converge (5 min)

## Technical Stack

### Frontend
- **React 19**: Functional components and hooks
- **Create React App**: Build tooling and dev server (port 3000)
- **@xyflow/react 12**: Node-and-edge canvas visualization
- **dagre**: Hierarchical tree layout algorithm
- **react-markdown + remark-gfm**: Markdown rendering in chat
- **react-force-graph-3d**: 3D force-directed graph
- **Firebase Auth SDK**: Client-side Google authentication

### Backend
- **Node.js + Express**: API server (port 5001)
- **@anthropic-ai/sdk**: Claude model integration
- **firebase-admin**: Server-side token verification + Firestore
- **ws**: WebSocket server for real-time sync
- **express-rate-limit**: Request throttling
- **SSE**: Real-time node streaming to frontend
- **CORS**: Configured for client origin

### AI Models
- **claude-opus-4-5**: Debate critique/rebut/finalize, tree generation (extended thinking enabled)
- **claude-sonnet-4-20250514**: Chat companion, regeneration, drill, scoring, utilities

## API Specification

### Base URL
```
http://localhost:5001/api
```

### Authentication
All endpoints (except `GET /api/health` and `GET /api/shares/:id`) require:
```
Authorization: Bearer <firebase-id-token>
```

### POST /api/generate
Generate a full domain-adaptive thinking tree.

**Request:**
```json
{
  "idea": "string (required)",
  "mode": "idea|resume|codebase|decision|writing|plan",
  "steeringInstruction": "string (optional)",
  "existingNodes": "Node[] (optional)",
  "fetchedUrlContent": "[{url, text}] (optional)",
  "jdText": "string (resume mode)",
  "resumePdf": "string (base64, resume mode)",
  "templateHint": "object (optional)"
}
```
**Response:** SSE stream. First line: `_meta` header. Then node JSON objects. `[DONE]` terminator.

### POST /api/generate-multi
Multi-agent generation (3 perspectives → merged tree).

**Request:** Same as `/api/generate`
**Response:** SSE stream with progress events + merged nodes

### POST /api/generate-research
Research-mode generation with URL crawling.

**Request:** Same as `/api/generate`
**Response:** SSE stream with research progress + synthesized nodes

### POST /api/regenerate
Expand a node with new children.

**Request:**
```json
{
  "node": "Node (required)",
  "parentContext": "Node[] (optional)",
  "dynamicTypes": "[{type, label, icon}] (optional)"
}
```
**Response:** SSE stream of 5–10 new nodes

### POST /api/drill
Deep-dive into a specific node.

**Request:**
```json
{
  "node": "Node (required)",
  "fullContext": "Node[] (optional)",
  "dynamicTypes": "[{type, label, icon}] (optional)"
}
```
**Response:** SSE stream of 12–15 new nodes

### POST /api/fractal-expand
Fractal expand a leaf node into adaptive children.

**Request:**
```json
{
  "node": "Node (required)",
  "ancestorChain": "Node[] (ancestor path from root to focus node)",
  "dynamicTypes": "[{type, label, icon}] (optional)",
  "treeSnapshot": "Node[] (full tree for duplicate avoidance)"
}
```
**Response:** SSE stream of 2–7 new child nodes

### POST /api/fractal-select
AI evaluates leaf nodes and selects the most promising for autonomous exploration. **Non-streaming.**

**Request:**
```json
{
  "leafNodes": "Node[] (unexplored leaf nodes)",
  "fullContext": "string (tree context summary)",
  "idea": "string (original input)"
}
```
**Response:**
```json
{
  "selectedNodeId": "string",
  "reasoning": "string (1-2 sentences why)"
}
```

### POST /api/analyze-codebase
Reverse-engineer codebase into a tree.

**Request:**
```json
{
  "files": [{ "path": "string", "content": "string" }],
  "analysisGoals": ["features", "architecture", "users"],
  "folderName": "string"
}
```
**Response:** SSE stream of 20–30 nodes

### POST /api/score-nodes
Score nodes for quality. **Non-streaming.**

**Request:** `{ "nodes": Node[], "idea": "string" }`
**Response:** `{ "scores": { "nodeId": { score, relevance, specificity, actionability } } }`

### POST /api/extract-template
Extract structural template. **Non-streaming.**

**Request:** `{ "nodes": Node[] }`
**Response:** Template object

### POST /api/critique
Generate devil's advocate critique nodes.

**Request:** `{ "nodes": Node[], "idea": "string" }`
**Response:** SSE stream of 8–12 critique nodes

### POST /api/debate/critique
Mode-specific structured evaluation. **Non-streaming.**

**Request:**
```json
{
  "nodes": "Node[]",
  "idea": "string",
  "round": "number (1–5)",
  "priorCritiques": "string[]",
  "mode": "idea|resume|codebase|decision|writing|plan"
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
Mode-specific responder rebuttal.

**Request:** `{ "nodes", "idea", "critiques", "round", "mode" }`
**Response:** SSE stream of rebuttal nodes

### POST /api/debate/finalize
Synthesize debate into tree updates.

**Request:** `{ "nodes", "idea", "debateHistory", "mode" }`
**Response:** SSE stream (`_update: true` for existing nodes, new nodes for synthesis)

### POST /api/expand-suggestion
Expand a debate suggestion into tree branches.

**Request:** `{ "suggestion", "idea", "nodes", "mode", "dynamicTypes" }`
**Response:** SSE stream of 5–8 new nodes

### POST /api/chat
Mode-specific AI chat companion.

**Request:** `{ "messages": [{role, content}], "treeContext": "string", "idea": "string", "mode": "string" }`
**Response:** SSE stream of text chunks (`{text: "..."}`) terminated by `[DONE]`

### POST /api/canvas/generate
Generate interactive HTML visualization.

**Request:** `{ "nodes", "idea", "instruction" }`
**Response:** SSE stream of HTML content

### POST /api/mockup
Generate animated HTML prototype. **Non-streaming.**

**Request:** `{ "featureNode": Node, "ancestorContext": Node[] }`
**Response:** `{ "html": "string" }`

### POST /api/resume/changes
Resume change manifest. **Non-streaming.**

**Request:** `{ "resumePdf?", "nodes", "debateHistory", "idea" }`
**Response:** `{ "summary", "changes": [{ id, section, type, original, replacement, category, reason }] }`

### POST /api/reflect
Analyze past sessions for patterns. **Non-streaming.**

**Request:** `{ "sessions": [{ idea, nodeCount, nodeTypeCounts, topLabels }] }`
**Response:** `{ "patterns": [{ type, title, description }] }`

### POST /api/export/github
Create GitHub repo and push files. **Non-streaming.**

**Request:** `{ "token", "repoName", "repoDescription?", "isPrivate?", "files": { filename: content } }`
**Response:** `{ "repoUrl", "repoFullName" }`

### POST /api/shares
Create shareable link. **Non-streaming.**

**Request:** `{ "nodes", "idea", "mode", "edges?" }`
**Response:** `{ "id": "shareId", "url": "..." }`

### GET /api/shares/:id
Get shared tree data. **Public — no auth required.**

**Response:** `{ "nodes", "idea", "mode", "edges", "createdAt" }`

### DELETE /api/shares/:id
Delete a shared link.

### GET /api/sessions
List user's saved sessions.

**Response:** `[{ "id", "idea", "mode", "nodeCount", "updatedAt", ... }]`

### GET /api/sessions/:id
Get a specific session.

### DELETE /api/sessions/:id
Delete a session.

### GET /api/usage
Get user's daily generation usage.

**Response:** `{ "generationsToday", "limit", "remaining", "resetsAt" }`

### POST /api/fetch-url
Proxy-fetch URL, return stripped text. **Non-streaming.**

**Request:** `{ "url" }`
**Response:** `{ "text" }`

### POST /api/crawl-site
Crawl multiple pages from a site. **Non-streaming.**

**Request:** `{ "urls": ["..."] }`
**Response:** `[{ "url", "text" }]`

### GET /api/health
```json
{ "status": "ok" }
```

### WebSocket: /ws
Real-time session sync gateway. Supports save, load, list, delete operations via JSON messages.

## Data Model

### Node Object
```javascript
{
  id: String,               // e.g. "seed_1", "problem_2"
  parentId: String | null,  // null for seed node only
  type: String,             // node type (static or dynamic)
  label: String,            // short label (max 8 words)
  reasoning: String,        // 1-2 sentence explanation
  relatedIds: String[]      // optional cross-link references
}
```

### Node Types

#### Static Types
Product/codebase: `seed` · `problem` · `user_segment` · `job_to_be_done` · `feature` · `constraint` · `metric` · `insight` · `component` · `api_endpoint` · `data_model` · `tech_debt` · `critique`

Resume: `requirement` · `skill_match` · `skill_gap` · `achievement` · `keyword` · `story` · `positioning`

#### Dynamic Types (adaptive mode)
In Idea mode, the AI declares domain-specific types via the `_meta` protocol. Each dynamic type gets a color from a 12-color palette via `buildDynamicConfig()`.

## AI Model Configuration

- **claude-opus-4-5**: Debate (critique/rebut/finalize), generation — extended thinking enabled (8000 budget tokens)
- **claude-sonnet-4-20250514**: Chat companion, regeneration, drill, fractal expand, fractal select, scoring, expand-suggestion, canvas
- **Max tokens**: Varies by endpoint (4096–12000)
- **Streaming**: SSE for generation, debate rebut/finalize, chat, canvas; non-streaming for critique verdict, mockup, reflect, export
