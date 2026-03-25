# AGENTS.md — How to Work With This Codebase

> This file is for AI coding agents (Claude Code, Cursor, etc.) working on ThoughtClaw. Read this before making any changes.

## Golden Rules

1. **Chat-first development.** Every feature MUST be callable from the chat panel via `<<<ACTIONS>>>` JSON. If it's a button, it's also a chat command. No exceptions.
2. **Use the provider abstraction.** Never call Anthropic or Google APIs directly. Use `ai.call()` / `ai.stream()` from `server/ai/providers.js`.
3. **SSE for streaming, REST for CRUD.** Generation, debate, refine all stream via SSE. Session save/load, scoring, config are REST.
4. **Non-fatal context injection.** External context (knowledge, email, files, Claude Code) is injected via string concatenation into the user message. Wrap in try/catch — failures must never block generation.
5. **Hook ordering matters in App.js.** The file is 3900+ lines with 20+ hooks. Declaration order affects initialization. Don't reorder hooks without understanding dependencies.

---

## Project Structure

```
server/
├── server.js              # Express entrypoint, all route mounting
├── ai/providers.js        # Unified Claude/Gemini: ai.call(), ai.stream(), ai.parseJSON()
├── engine/                # AI pipelines (one file per capability)
│   ├── generate.js        # Tree generation, drill, fractal expand
│   ├── debate.js          # Multi-round adversarial critique
│   ├── refine.js          # Critique → strengthen → score loop
│   ├── portfolio.js       # Generate 3-5 alternative trees + scoring
│   ├── chat.js            # Chat companion with <<<ACTIONS>>> dispatch
│   ├── forest.js          # Multi-canvas decomposition
│   ├── prototype.js       # Interactive prototype builder (4-step SSE pipeline)
│   ├── learn.js           # Socratic teaching loop
│   ├── experiment.js      # Autonomous mutation/scoring/iteration
│   ├── nodeTools.js       # Split, merge, edit operations
│   ├── analyze.js         # Codebase analysis, node scoring
│   ├── prompts.js         # ALL system prompts (master file, 148KB)
│   ├── patternExecutor.js # State machine for declarative thinking patterns
│   ├── builtinPatterns.js # Built-in pattern definitions
│   └── sessionFiles.js    # File upload + text extraction
├── gateway/               # Persistence + real-time
│   ├── websocket.js       # WebSocket message routing
│   ├── sessions.js        # Session CRUD (Firestore or in-memory)
│   ├── knowledge.js       # Cross-session Zettelkasten layer
│   ├── patternStore.js    # Pattern CRUD with versioning
│   └── promptStore.js     # Prompt CRUD
├── integrations/          # External services (Gmail, Claude Code)
│   ├── registry.js        # Plugin system
│   └── gmail/             # Gmail OAuth integration
│   └── claude-code/       # Claude Code context importer

client/src/
├── App.js                 # Main shell (3900+ lines) — ALL hook orchestration
├── App.css                # All styles (dark theme, 240KB)
├── useCanvasMode.js       # Central canvas state, node CRUD, SSE reader
├── usePatternExecutor.js  # Pattern execution SSE hook
├── usePortfolio.js        # Portfolio generation + navigation stack
├── useAutoRefine.js       # Auto-refine loop
├── useLearnLoop.js        # Learn mode
├── usePrototypeBuilder.js # Prototype build SSE hook
├── ChatPanel.js           # Chat UI + action parsing
├── IdeaCanvas.js          # ReactFlow force-directed canvas
├── FlowchartView.js       # ReactFlow dagre tree canvas
├── IdeaNode.js            # Node component (expand, collapse, badges)
├── layoutUtils.js         # Force-directed layout + edge computation
├── nodeConfig.js          # Node type colors, icons, labels
├── ForestContext.js       # Multi-canvas context provider
├── api.js                 # authFetch() with token injection
└── settings/              # Settings pages (patterns, prompts, billing)
```

---

## Data Flow

```
User types idea → clicks GENERATE
    ↓
App.js builds genParams { idea, mode, fetchedUrlContent, emailThread, claudeCodeContext, sessionFileContext }
    ↓
WebSocket: gateway.send('generate', genParams)  OR  REST: POST /api/generate
    ↓
server/engine/generate.js: handleGenerate()
    ├── Injects: template guidance, email context, claude code context, session files, knowledge
    ├── Calls ai.stream({ model: 'claude:opus', system: systemPrompt, messages })
    └── Streams SSE: data: {"id":"node_1","type":"feature","label":"...","reasoning":"...","parentId":"seed"}
    ↓
Client: useCanvasMode.readSSEStream() → buildFlowNode() → applyLayout() → ReactFlow renders
```

---

## How to Add a New Feature

### 1. Design the action shape FIRST
```json
{"myFeature": true}
{"myFeature": {"nodeId": "node_xyz", "mode": "deep"}}
```

### 2. Server handler (`server/engine/myFeature.js`)
```javascript
const { sseHeaders, attachAbortSignal } = require('../utils/sse');
const ai = require('../ai/providers');

async function handleMyFeature(_client, req, res) {
  const { nodes, idea } = req.body;
  sseHeaders(res);
  const signal = attachAbortSignal(req, res);

  const { stream } = await ai.stream({
    model: 'claude:sonnet',
    system: '...',
    messages: [{ role: 'user', content: '...' }],
    signal,
  });

  // Stream results as SSE
  for await (const chunk of stream) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  res.write('data: [DONE]\n\n');
  res.end();
}
module.exports = { handleMyFeature };
```

### 3. Mount route (`server/server.js`)
```javascript
app.post('/api/my-feature', requireAuth, handleMyFeature);
```

### 4. Add to chat prompt (`server/engine/prompts.js`)
Add to `CHAT_PERSONAS` so the LLM knows when to emit the action.

### 5. Client hook (`client/src/useMyFeature.js`)
```javascript
import { authFetch } from './api';
import { readSSEStream } from './useCanvasMode';

export function useMyFeature() {
  const [isRunning, setIsRunning] = useState(false);
  const execute = useCallback(async (params) => {
    setIsRunning(true);
    const res = await authFetch('/api/my-feature', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    await readSSEStream(res, (data) => { /* handle events */ });
    setIsRunning(false);
  }, []);
  return { isRunning, execute };
}
```

### 6. Wire in App.js
```javascript
const myFeature$ = useMyFeature();
// Add to handleChatAction for chat dispatch
// Add button to toolbar
```

### 7. Update this doc and `docs/agents.md`

---

## Chat Tool System

The chat backend (`server/engine/chat.js`) instructs the LLM to emit `<<<ACTIONS>>>` JSON. The client parses and dispatches to `handleChatAction` in App.js.

### Implemented Actions

| Action | JSON Shape | Effect |
|--------|-----------|--------|
| `filter` | `{"filter":{"types":["feature"]}}` | Dims non-matching nodes |
| `clear` | `{"clear":true}` | Removes all filters |
| `addNodes` | `{"addNodes":[{id,type,label,reasoning,parentId}]}` | Creates nodes on canvas |
| `debate` | `{"debate":true}` | Starts critique flow |
| `refine` | `{"refine":true}` | Starts auto-refine |
| `portfolio` | `{"portfolio":true}` | Generates alternatives |
| `fractalExpand` | `{"fractalExpand":{"rounds":3}}` | Auto-expand N rounds |
| `scoreNodes` | `{"scoreNodes":true}` | Runs node scoring |
| `drill` | `{"drill":{"nodeId":"..."}}` | Drills into a node |
| `feedToIdea` | `{"feedToIdea":true}` | Bridges CODE→IDEA mode |

---

## Common Gotchas

| Problem | Cause | Fix |
|---------|-------|-----|
| Edges disappear on session switch | Edges render before ReactFlow measures nodes | Defer with double `requestAnimationFrame` |
| App crashes silently on mount | Hook references `startPrototypeBuild` before declaration | Check hook ordering in App.js |
| Generation stuck on "Research & multi-agent thinking" | JSON parse errors in research planning (non-fatal retries) | Check server logs, usually self-resolves |
| Chat action not firing | `<<<ACTIONS>>>` delimiter not parsed | Check `parseActions()` in ChatPanel.js |
| Portfolio "Expand" loses original tree | Only one level of undo stored | Fixed: now uses navigation stack in usePortfolio.js |
| Firestore unavailable locally | No service account configured | Expected: falls back to in-memory store |
| Port conflicts on restart | Previous process still running | `lsof -ti :5001 \| xargs kill` |

---

## File Naming Conventions

| Pattern | Example | Purpose |
|---------|---------|---------|
| `useXxx.js` | `useCanvasMode.js` | React hooks |
| `XxxPanel.js` | `DebatePanel.js` | Full panels |
| `XxxCard.js` | `NodeFocusCard.js` | Inline cards |
| `XxxContext.js` | `ForestContext.js` | React Context providers |
| `xxxStore.js` | `patternStore.js` | Firestore CRUD |
| `xxxLoader.js` | `patternLoader.js` | In-memory cache |
| `xxxExecutor.js` | `patternExecutor.js` | Pipeline runner |

---

## Environment

**Required:** `ANTHROPIC_API_KEY` in `server/.env`

**Optional:** `GEMINI_API_KEY`, `ENABLE_AUTH=true`, `GOOGLE_APPLICATION_CREDENTIALS`, `ALLOWED_EMAILS`

**Dev:** Auth disabled by default. Firestore falls back to in-memory. Rate limits bypassed with `RATE_LIMIT_DEV_BYPASS=true`.

---

## Provider Abstraction

```javascript
const ai = require('./ai/providers');

// Non-streaming
const result = await ai.call({ model: 'claude:sonnet', system, messages, maxTokens });

// Streaming
const { stream } = await ai.stream({ model: 'claude:opus', system, messages });

// JSON parsing with retry
const parsed = await ai.parseJSON({ model: 'gemini:flash', system, messages });

// Model aliases: 'claude:opus', 'claude:sonnet', 'claude:haiku', 'gemini:pro', 'gemini:flash'
```

---

## Critical Files (Handle With Care)

| File | Why it's fragile |
|------|-----------------|
| `client/src/App.js` | 3900 lines, 20+ hooks, order-dependent initialization |
| `server/engine/prompts.js` | 148KB, changes propagate to ALL AI calls |
| `client/src/useCanvasMode.js` | Central state — many consumers depend on exact return shape |
| `server/ai/providers.js` | All AI calls route through here |
| `server/engine/patternExecutor.js` | Complex state machine with safe expression eval |
| `client/src/layoutUtils.js` | Performance-critical force layout computation |

---

## Deployment

```bash
# Local dev
npm run dev              # Runs client (3000) + server (5001) concurrently

# Production (Google Cloud Run)
gcloud builds submit --config cloudbuild.yaml
# or
gcloud run deploy thoughtclaw --source . --region us-central1
```

Production URL: `https://thoughtclaw-670534823635.us-central1.run.app`
