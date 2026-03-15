# Agent & Tool Architecture

> Every capability built into the app MUST also be exposed as a tool the chat agent can invoke.

## Golden Rule: Chat-First Development

**When building ANY new functionality, the chat tool call MUST be implemented as part of the feature — not as an afterthought.** The implementation checklist below is not optional. If a feature ships without a chat action, it is incomplete.

This means: design the action JSON shape first, then build the feature around it.

## Principle

The chat panel is the user's natural-language interface to the entire app. If a feature exists as a button or panel, the AI assistant should be able to trigger it when the user asks. "Run a debate", "generate the portfolio", "feed this into idea mode" — these should all work from chat.

## How Chat Tools Work

The chat backend (`server/engine/chat.js`) instructs the LLM to emit a `<<<ACTIONS>>>` JSON block at the end of its response. The client (`ChatPanel.js`) parses this and dispatches it to `handleChatAction` in `App.js`.

### Implemented Actions

| Action | JSON Shape | What It Does |
|--------|-----------|--------------|
| `filter` | `{"filter":{"types":["feature"]}}` or `{"filter":{"nodeIds":["id1"]}}` | Dims all nodes except matching ones |
| `clear` | `{"clear":true}` | Removes all filters, restores full graph |
| `addNodes` | `{"addNodes":[{"id":"chat_1","type":"feature","label":"...","reasoning":"...","parentId":"seed"}]}` | Creates new nodes on the canvas |
| `debate` | `{"debate":true}` or `{"debate":{"types":["feature"]}}` | Opens DebatePanel and starts critique flow (supports scoping) |
| `refine` | `{"refine":true}` or `{"refine":{"types":["tech_debt"]}}` | Opens RefinePanel and starts auto-refine (supports scoping) |
| `portfolio` | `{"portfolio":true}` or `{"portfolio":{"types":["feature"]}}` | Opens PortfolioPanel with dynamic prompt based on focus |
| `fractalExpand` | `{"fractalExpand":{"rounds":3}}` | Starts fractal auto-expand for N rounds |
| `scoreNodes` | `{"scoreNodes":true}` or `{"scoreNodes":{"types":["feature"]}}` | Runs node scoring (supports scoping) |
| `drill` | `{"drill":{"nodeId":"node_xyz"}}` | Drills into a specific node to expand it |
| `feedToIdea` | `{"feedToIdea":true}` or `{"feedToIdea":{"types":["feature"]}}` | Bridges CODE→IDEA: serializes code tree as idea seed and switches to IDEA mode |

### Planned Actions (Phase 2)

| Action | JSON Shape | Triggers |
|--------|-----------|----------|
| `exportGithub` | `{"exportGithub":true}` | Triggers GitHub export flow |
| `exportMarkdown` | `{"exportMarkdown":true}` | Downloads README + SPEC + DEBATE + CLAUDE.md |
| `mockup` | `{"mockup":{"nodeId":"node_xyz"}}` | Generates a UI mockup for a specific node |
| `buildArtifact` | `{"buildArtifact":{"nodeId":"node_xyz"}}` | Generates implementable artifact from a node (Phase 2) |

## Adding a New Tool — Checklist

**This checklist is MANDATORY for every new feature.**

1. **Design the action shape first** — Define the JSON the LLM will emit (e.g. `{"myAction":true}` or `{"myAction":{"param":"value"}}`)
2. **Add to chat.js prompt** — Add the action to the `AVAILABLE ACTIONS` section with a clear example
3. **Add trigger phrases** — Add `WHEN TO USE` entries so the LLM knows when to emit it
4. **Add dispatch in App.js** — Add the case in `handleChatAction` that maps the action to the handler
5. **Add ACTION_LABELS entry** — In `ChatPanel.js` so the visual badge shows the right label
6. **Build the backend** — Create the API endpoint in `server/engine/` if needed
7. **Build the UI** — Add the panel/button in the React client
8. **Update this doc** — Add the action to the table above

Steps 1-5 are the chat integration. Steps 6-7 are the feature itself. Step 8 keeps this doc current. **Do not skip steps 1-5.**

## Architecture Diagram

```
User message
    │
    ▼
ChatPanel.js ──POST──► /api/chat (chat.js)
    │                       │
    │                       ▼
    │                  LLM generates response
    │                  + optional <<<ACTIONS>>> block
    │                       │
    ▼                       ▼
parseActions()         SSE stream back
    │
    ├─ displayText → rendered in chat
    │
    ├─ executedActions → ⚡ badge indicators
    │
    └─ actions → onChatAction → handleChatAction (App.js)
                                    │
                                    ├─ filter → setChatFilter()
                                    ├─ clear → setChatFilter(null)
                                    ├─ addNodes → buildFlowNode() + applyLayout()
                                    ├─ debate → openDebatePanel() + startCritique()
                                    ├─ refine → openRefinePanel() + startRefine()
                                    ├─ portfolio → openPortfolioPanel() + generate() [dynamic prompt based on focus]
                                    ├─ fractalExpand → startAutoFractal(rounds)
                                    ├─ scoreNodes → triggerScoring() [supports scoped nodes]
                                    ├─ drill → handleDrill(nodeId)
                                    └─ feedToIdea → bridge CODE tree → IDEA mode seed
```

## Cross-Mode Bridging

### CODE → IDEA (feedToIdea)

Bottom-up meets top-down. The CODE tree (components, endpoints, tech debt) becomes the seed context for IDEA mode, which does a top-down pass generating new features, refinements, and portfolios grounded in what actually exists in the code.

Flow:
1. User analyzes codebase in CODE mode → tree of what exists
2. User says "feed this into idea mode" (or scoped: "feed the features into idea mode")
3. Chat emits `{"feedToIdea":true}` or `{"feedToIdea":{"types":["feature"]}}`
4. App serializes the CODE tree (or scoped subset) into a structured summary
5. Switches to IDEA mode with the summary pre-filled as the idea input
6. User generates an IDEA tree that builds ON TOP of the code understanding

### Phase 2: Artifact Generation (BUILD)

Selected IDEA nodes → implementable artifacts (CLAUDE.md, API contracts, migration plans, PR descriptions). Design TBD.

## Code Mode Specifics

In CODE mode, files are read client-side (max 150 files, 50K chars), scored by priority (index/main/routes/models rank highest), and sent to `/api/analyze-codebase`. The analysis produces a thinking tree of components, endpoints, data models, tech debt, etc.

If the README or docs describe features that don't match the code, the codebase analysis tree is the source of truth — it's built bottom-up from the actual implementation.

## Dynamic Prompts

Portfolio and scoring prompts adapt based on focus context:
- **Features** → product strategist persona, user value / market differentiation dimensions
- **Tech debt** → engineering director persona, risk reduction / developer velocity dimensions
- **Architecture** (default) → CTO persona, architecture quality / scalability dimensions
- **No scope** → uses the mode's default static prompt
