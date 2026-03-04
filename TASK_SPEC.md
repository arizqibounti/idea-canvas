# Idea Canvas — Task Spec

## Project Overview
An AI-powered structured thinking visualization tool. Enter any input — product ideas, marketing campaigns, sales strategies, technical architectures, content plans, resumes, decisions, writing projects, project plans — and Claude generates a domain-adaptive visual tree with the most appropriate node types, streamed in real-time. The AI detects the domain, declares types via a `_meta` protocol, and the frontend renders each type with distinct colors and icons. Features mode-specific debate, AI chat companion, sharing, export, and Firebase authentication.

## Core Capabilities

### 1. Domain-Adaptive Tree Generation
- Free-text input of any domain (or paste/attach plain-text file: .txt, .md, .csv, .json, .html, .rtf)
- URLs auto-detected, fetched via `/api/fetch-url`, content included as reference context
- Claude emits `_meta` header declaring types, then streams 18–25 nodes
- Frontend configures dynamic rendering (12-color palette, icons, legend) from `_meta`
- Optional steering instruction to shift AI focus; supports incremental expansion
- **Six modes**: Idea, Code, Resume, Decide, Write, Plan — auto-detected or manually locked

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
- 12–15 node deep-dive into any branch
- Breadcrumb UI tracks drill depth; preserves adaptive types

### 6. Feature Mockup Generator
- Generate animated HTML prototype from any feature node
- Self-contained, no external dependencies; 320×568px phone viewport

### 7. Codebase Analysis
- Drag-and-drop codebase folder for reverse-engineering
- Surfaces features, architecture patterns, user segments, tech debt (20–30 nodes)
- Configurable goals: features / architecture / users

### 8. Resume Mode
- Paste JD or enter JD URL; optionally upload resume PDF
- Generates resume strategy tree (requirement, skill_match, skill_gap, achievement, keyword, story, positioning)
- Mode-specific debate (hiring manager vs career coach)
- **Apply to Resume** → change manifest modal with specific text changes

### 9. Mode-Specific Autonomous Debate
- Multi-round debate (up to 5 rounds) with domain-specific personas:
  - Idea: VC Critic vs Architect (panel: "VC CRITIQUE")
  - Resume: Hiring Manager vs Career Coach ("HIRING REVIEW")
  - Codebase: Security Auditor vs Tech Lead ("CODE AUDIT")
  - Decision: Devil's Advocate vs Strategic Advisor ("DEVIL'S ADVOCATE")
  - Writing: Senior Editor vs Writer ("EDITORIAL REVIEW")
  - Plan: Risk Analyst vs Project Manager ("RISK ANALYSIS")
- Debate finalize synthesizes consensus into tree updates
- Suggestion chips expand debate insights into new tree branches

### 10. AI Chat Companion
- Mode-specific personas (Product Strategist, Career Coach, Tech Advisor, Decision Analyst, Writing Editor, Project Advisor)
- Full thinking tree loaded as context for grounded responses
- Rich markdown rendering: code blocks with syntax highlighting and copy buttons, tables, lists, blockquotes
- Mode-specific quick action buttons

### 11. A2UI Canvas Panel
- Generate self-contained interactive HTML visualizations from tree analysis
- Manage collection of generated artifacts with tabbed preview

### 12. Export & Sharing
- **Share via Link**: Firestore-backed shareable links with public viewer
- **Export**: PNG, SVG, interactive HTML, clipboard copy
- **GitHub Export**: Create new repo with README.md, SPEC.md, DEBATE.md, CLAUDE.md

### 13. Authentication & Persistence
- **Firebase Auth**: Google sign-in with landing page for unauthenticated users
- **Session Dashboard**: Grid of saved sessions with mode badges, node counts, timestamps
- **Firestore**: Server-side session/share/usage persistence
- **WebSocket**: Real-time session sync gateway
- **localStorage**: Auto-save, versions (15 per idea), memory layer (20 sessions)
- **Rate Limiting**: 60 req/min general, 10 req/min generation
- **Usage Tracking**: Daily generation limits with visual indicator

### 14. Visualization
- **3D Graph**: Force-directed view with rounds on X-axis, type clusters on YZ
- **2D Timeline**: Round range slider, play/pause, speed, round isolation
- **Cross-Links**: Toggle non-parent relationship edges
- **Node Search**: Text filter with dimming of non-matching nodes

### 15. Meta Features
- **Node Scoring**: Quality scoring (relevance, specificity, actionability)
- **Template Extraction**: Extract structural templates for reuse
- **Memory Layer**: Cross-session pattern analysis (blindspots, biases, strengths)
- **Sprint Mode**: Gamified 20-minute session (Generate → Critique → Converge)
- **Version History**: Up to 15 versions per idea for iteration comparison

## Technical Stack

- **Frontend**: React 19, Create React App, @xyflow/react, dagre, react-markdown, remark-gfm, react-force-graph-3d, Firebase Auth SDK
- **Backend**: Node.js, Express, @anthropic-ai/sdk, firebase-admin, ws, express-rate-limit
- **AI Models**: `claude-opus-4-5` (debate/generation with extended thinking), `claude-sonnet-4-20250514` (chat/utilities)
- **Streaming**: Server-Sent Events (SSE)
- **Persistence**: Firebase/Firestore (server) + localStorage (client) + WebSocket (sync)
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
