import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { authFetch } from './api';
import RefineCard from './chat/RefineCard';
import PortfolioCard from './chat/PortfolioCard';
import NodeFocusCard from './chat/NodeFocusCard';

const API_URL = process.env.REACT_APP_API_URL || '';

const QUICK_ACTIONS = {
  idea:     [
    { label: 'Write Proposal',  prompt: 'Write a structured proposal based on this thinking tree. Include an executive summary, problem statement, proposed solution, key metrics, and next steps.' },
    { label: 'Draft Email',     prompt: 'Draft a professional email summarizing this analysis. Make it suitable for sharing with stakeholders or investors.' },
    { label: 'Create PRD',      prompt: 'Create a Product Requirements Document based on this tree. Include features, constraints, success metrics, and user stories.' },
    { label: 'Pitch Summary',   prompt: 'Create a concise pitch summary or slide outline from this tree. Include the problem, solution, market, and traction/metrics.' },
  ],
  codebase: [
    { label: 'Tech Spec',       prompt: 'Write a technical specification based on this codebase analysis. Include architecture decisions, data models, API endpoints, and technical constraints.' },
    { label: 'Architecture Doc', prompt: 'Write an architecture document summarizing the system design from this analysis.' },
    { label: 'README',          prompt: 'Draft a README.md for this project based on the analysis tree.' },
    { label: 'Migration Plan',  prompt: 'Create a migration or refactoring plan based on the tech debt and issues identified in this tree.' },
  ],
  resume:   [
    { label: 'Cover Letter',    prompt: 'Write a tailored cover letter based on this resume strategy tree. Reference specific matches and position the candidate strongly.' },
    { label: 'LinkedIn Summary', prompt: 'Write a LinkedIn summary/about section optimized for this target role based on the tree analysis.' },
    { label: 'Interview Prep',  prompt: 'Create interview preparation notes based on this tree — likely questions, STAR stories to prepare, and key talking points.' },
    { label: 'Resume Bullets',  prompt: 'Write optimized resume bullet points for each skill match and achievement in this tree. Use strong action verbs and quantify results.' },
  ],
  decision: [
    { label: 'Decision Brief',  prompt: 'Write a decision brief summarizing the analysis. Include the decision context, options considered, trade-offs, and a clear recommendation.' },
    { label: 'Pros/Cons',       prompt: 'Create a structured pros and cons summary from this decision tree.' },
    { label: 'Stakeholder Email', prompt: 'Draft an email to stakeholders explaining this decision and the reasoning behind it.' },
    { label: 'Risk Assessment',  prompt: 'Write a risk assessment document based on the decision analysis in this tree.' },
  ],
  writing:  [
    { label: 'Article Outline', prompt: 'Create a detailed article outline based on this writing analysis tree. Include section headers, key arguments, and supporting evidence.' },
    { label: 'Blog Post',       prompt: 'Write a blog post draft based on this writing tree analysis.' },
    { label: 'Social Thread',   prompt: 'Create a social media thread (Twitter/X style) summarizing the key insights from this writing tree.' },
    { label: 'Executive Summary', prompt: 'Write an executive summary of the key points from this writing analysis.' },
  ],
  plan:     [
    { label: 'Project Plan',    prompt: 'Write a project plan based on this planning tree. Include phases, milestones, dependencies, and timeline estimates.' },
    { label: 'Timeline',        prompt: 'Create a timeline or Gantt-style breakdown from this planning tree.' },
    { label: 'Status Update',   prompt: 'Draft a project status update based on the current state of this plan.' },
    { label: 'Resource Brief',  prompt: 'Write a resource requirements brief based on the dependencies and scope identified in this tree.' },
  ],
};

// ── Markdown Renderer ─────────────────────────────────────────
function ChatMarkdown({ content }) {
  const components = useMemo(() => ({
    // Code blocks with copy button + language badge
    code({ node, inline, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '');
      const lang = match ? match[1] : '';
      const codeText = String(children).replace(/\n$/, '');

      if (!inline && (lang || codeText.includes('\n'))) {
        return (
          <div className="chat-code-block">
            {lang && <span className="chat-code-lang">{lang}</span>}
            <button
              className="chat-code-copy"
              onClick={() => navigator.clipboard?.writeText(codeText)}
              title="Copy code"
            >⧉</button>
            <pre><code className={className} {...props}>{children}</code></pre>
          </div>
        );
      }
      return <code className="chat-inline-code" {...props}>{children}</code>;
    },
    // Open links in new tab
    a({ href, children, ...props }) {
      return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
    },
    // Tables get wrapper for horizontal scroll
    table({ children, ...props }) {
      return (
        <div className="chat-table-wrap">
          <table {...props}>{children}</table>
        </div>
      );
    },
  }), []);

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
}

function serializeTree(nodes) {
  if (!nodes || !nodes.length) return '';
  return nodes.map(n => {
    const d = n.data || n;
    return `- [${d.type || 'node'}] (id: ${n.id}) ${d.label || n.id}${d.reasoning ? ': ' + d.reasoning : ''}`;
  }).join('\n');
}

const ACTION_DELIMITER = '<<<ACTIONS>>>';

const ACTION_LABELS = {
  filter: 'Filtered Graph',
  clear: 'Cleared Filters',
  addNodes: 'Added Nodes',
  debate: 'Started Debate',
  refine: 'Started Refine',
  portfolio: 'Generating Portfolio',
  fractalExpand: 'Fractal Expanding',
  scoreNodes: 'Scoring Nodes',
  drill: 'Drilling Into Node',
  feedToIdea: 'Bridging to Idea Mode',
  executeAction: 'Executing Fix',
  refineMore: 'Continuing Refine',
  portfolioMore: 'More Alternatives',
};

function parseActions(fullText) {
  // Find <<<ACTIONS>>> — may be preceded by ``` code fence
  const idx = fullText.indexOf(ACTION_DELIMITER);
  if (idx === -1) return { displayText: fullText, actions: null };

  // Strip display text: remove any trailing ``` or ```json before the delimiter
  let displayText = fullText.slice(0, idx);
  displayText = displayText.replace(/```(?:json)?\s*$/, '').trimEnd();

  // Extract JSON after delimiter, strip any trailing ``` code fence
  let actionJson = fullText.slice(idx + ACTION_DELIMITER.length).trim();
  actionJson = actionJson.replace(/```\s*$/, '').trim();

  try {
    const actions = JSON.parse(actionJson);
    return { displayText, actions };
  } catch (e) {
    // Try to extract JSON object from the string (AI may add extra text)
    const jsonMatch = actionJson.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const actions = JSON.parse(jsonMatch[0]);
        return { displayText, actions };
      } catch (_) { /* fall through */ }
    }
    console.warn('Failed to parse chat actions:', e, actionJson);
    return { displayText, actions: null };
  }
}

const CHAT_MODE_CONFIG = {
  idea:     { title: 'PRODUCT STRATEGIST', icon: '✦', emptyDesc: 'Your thinking tree is loaded as context. Ask questions or use a quick action below to generate actionable outputs.' },
  codebase: { title: 'TECH ADVISOR',       icon: '⟨/⟩', emptyDesc: 'Your codebase analysis is loaded as context. Ask questions or use a quick action below to generate technical docs.' },
  resume:   { title: 'CAREER COACH',       icon: '◎', emptyDesc: 'Your resume strategy tree is loaded as context. Ask questions or use a quick action below to generate career materials.' },
  decision: { title: 'DECISION ANALYST',   icon: '⚖', emptyDesc: 'Your decision tree is loaded as context. Ask questions or use a quick action below to generate decision docs.' },
  writing:  { title: 'WRITING EDITOR',     icon: '✦', emptyDesc: 'Your writing analysis is loaded as context. Ask questions or use a quick action below to generate content.' },
  plan:     { title: 'PROJECT ADVISOR',    icon: '◉', emptyDesc: 'Your project plan is loaded as context. Ask questions or use a quick action below to generate project docs.' },
};

export default function ChatPanel({ isOpen, onClose, nodes, idea, mode = 'idea', onChatAction, chatFilterActive, onClearFilter, pendingChatCards, onClearPendingCards, onCardButtonClick, executionStream, onStopExecution, onDismissStream, refineStream, portfolioStream, emailContext, pipelineStages, onClosePipeline, focusedNode, onDismissFocus }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const abortRef = useRef(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const execStreamRef = useRef(null);

  // Auto-scroll on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingText, executionStream, refineStream, portfolioStream, pipelineStages]);

  // Auto-scroll execution stream output to bottom
  useEffect(() => {
    if (execStreamRef.current) {
      execStreamRef.current.scrollTop = execStreamRef.current.scrollHeight;
    }
  }, [executionStream]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current.focus(), 200);
    }
  }, [isOpen]);

  // Reset when idea changes
  useEffect(() => {
    setMessages([]);
    setStreamingText('');
    setInput('');
  }, [idea]);

  // Consume pending action cards from parent
  useEffect(() => {
    if (pendingChatCards?.length > 0) {
      setMessages(prev => [...prev, ...pendingChatCards.map(card => ({
        role: 'system',
        type: 'action_card',
        ...card,
      }))]);
      onClearPendingCards?.();
    }
  }, [pendingChatCards, onClearPendingCards]);

  const sendMessage = useCallback(async (content) => {
    if (!content.trim() || isStreaming) return;

    const userMsg = { role: 'user', content: content.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsStreaming(true);
    setStreamingText('');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const treeContext = serializeTree(nodes);
      const res = await authFetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.filter(m => m.role === 'user' || m.role === 'assistant'),
          treeContext,
          idea,
          mode,
          emailThread: emailContext?.formatted || null,
        }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') break;

          try {
            const parsed = JSON.parse(payload);
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.text) {
              fullText += parsed.text;
              setStreamingText(fullText);
            }
          } catch (e) {
            if (e.message && !e.message.includes('JSON')) throw e;
          }
        }
      }

      const { displayText, actions } = parseActions(fullText);
      // Build list of executed action names for visual indicator
      const executedActions = actions ? Object.keys(actions).filter(k =>
        ['filter', 'clear', 'addNodes', 'debate', 'refine', 'portfolio',
         'fractalExpand', 'scoreNodes', 'drill', 'feedToIdea', 'refineMore', 'portfolioMore'].includes(k) && actions[k]
      ) : [];
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: displayText,
        executedActions: executedActions.length ? executedActions : undefined,
      }]);
      setStreamingText('');
      if (actions && onChatAction) onChatAction(actions);
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Chat error:', err);
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
      setStreamingText('');
    } finally {
      setIsStreaming(false);
    }
  }, [messages, nodes, idea, mode, isStreaming, onChatAction]);

  const handleStop = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    if (streamingText) {
      const { displayText } = parseActions(streamingText);
      setMessages(prev => [...prev, { role: 'assistant', content: displayText }]);
      setStreamingText('');
    }
    setIsStreaming(false);
  }, [streamingText]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }, [input, sendMessage]);

  const handleCopy = useCallback((text) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {
        // Fallback for non-HTTPS / unfocused contexts
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      });
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  }, []);

  if (!isOpen) return null;

  const actions = QUICK_ACTIONS[mode] || QUICK_ACTIONS.idea;
  const hasTree = nodes && nodes.length > 0;

  return (
    <div className="chat-panel">
      <div className="chat-panel-header">
        <div className="chat-panel-title">
          <span className="chat-panel-icon">{(CHAT_MODE_CONFIG[mode] || CHAT_MODE_CONFIG.idea).icon}</span>
          <span>{(CHAT_MODE_CONFIG[mode] || CHAT_MODE_CONFIG.idea).title}</span>
          {hasTree && (
            <span className="chat-node-count">{nodes.length} nodes</span>
          )}
          {chatFilterActive && (
            <button className="chat-filter-badge" onClick={onClearFilter}>
              FILTERED ✕
            </button>
          )}
        </div>
        <button className="modal-close" onClick={onClose}>✕</button>
      </div>

      {/* Messages area */}
      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && !streamingText && (
          <div className="chat-empty">
            <div className="chat-empty-icon">{(CHAT_MODE_CONFIG[mode] || CHAT_MODE_CONFIG.idea).icon}</div>
            <div className="chat-empty-title">{(CHAT_MODE_CONFIG[mode] || CHAT_MODE_CONFIG.idea).title}</div>
            <div className="chat-empty-desc">
              {hasTree
                ? (CHAT_MODE_CONFIG[mode] || CHAT_MODE_CONFIG.idea).emptyDesc
                : 'Generate a thinking tree first, then use the companion to create actionable outputs from it.'}
            </div>
            {hasTree && (
              <div className="chat-quick-actions">
                {actions.map((a) => (
                  <button
                    key={a.label}
                    className="chat-quick-btn"
                    onClick={() => sendMessage(a.prompt)}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((msg, i) => (
          msg.type === 'refine_card' ? (
            <RefineCard key={i} state={msg.state} onAction={onCardButtonClick} />
          ) : msg.type === 'portfolio_card' ? (
            <PortfolioCard key={i} state={msg.state} onAction={onCardButtonClick} />
          ) : msg.type === 'action_card' ? (
            <div key={i} className="chat-action-card">
              <div className="chat-action-card-header">
                <span className="chat-action-card-icon">⚡</span>
                <span className="chat-action-card-label">{msg.label}</span>
              </div>
              {msg.detail && <div className="chat-action-card-detail">{msg.detail}</div>}
              {msg.buttons?.length > 0 && (
                <div className="chat-action-card-buttons">
                  {msg.buttons.map((btn, j) => (
                    <button
                      key={j}
                      className="chat-action-card-btn"
                      onClick={() => onCardButtonClick?.(btn)}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div key={i} className={`chat-msg chat-msg-${msg.role}`}>
              <div className="chat-msg-label">
                {msg.role === 'user' ? 'YOU' : 'AI'}
              </div>
              <div className="chat-msg-content">
                {msg.role === 'assistant'
                  ? <ChatMarkdown content={msg.content} />
                  : msg.content}
              </div>
              {msg.executedActions?.length > 0 && (
                <div className="chat-tool-badges">
                  {msg.executedActions.map(action => (
                    <span key={action} className="chat-tool-badge">
                      ⚡ {ACTION_LABELS[action] || action}
                    </span>
                  ))}
                </div>
              )}
              {msg.role === 'assistant' && (
                <button
                  className="chat-copy-btn"
                  onClick={() => handleCopy(msg.content)}
                  title="Copy to clipboard"
                >
                  ⧉ Copy
                </button>
              )}
            </div>
          )
        ))}

        {/* ── Pipeline Progress ── */}
        {pipelineStages && (() => {
          const activeStage = pipelineStages.find(s => s.status === 'active');
          const allDone = pipelineStages.every(s => s.status === 'done');
          const completedCount = pipelineStages.filter(s => s.status === 'done').length;
          const totalCount = pipelineStages.length;
          const ICONS = { generate: '◈', debate: '⚔', refine: '⟲', portfolio: '◆' };
          return (
            <div className={`pipeline-chat-card ${allDone ? 'pipeline-chat-done' : ''}`}>
              <div className="pipeline-chat-header">
                <span className="pipeline-chat-icon">⟡</span>
                <span className="pipeline-chat-title">
                  {allDone ? 'PIPELINE COMPLETE' : 'PIPELINE ACTIVE'}
                </span>
                <span className="pipeline-chat-counter">{completedCount}/{totalCount}</span>
                <button className="pipeline-chat-close" onClick={onClosePipeline}>✕</button>
              </div>
              <div className="pipeline-chat-stepper">
                {pipelineStages.map((stage, i) => (
                  <React.Fragment key={stage.id}>
                    <div className={`pipeline-chat-stage ${
                      stage.status === 'done' ? 'pcs-done' :
                      stage.status === 'active' ? 'pcs-active' : 'pcs-pending'
                    }`}>
                      <div className="pcs-icon">
                        {stage.status === 'done' ? '✓' : ICONS[stage.id] || '●'}
                      </div>
                      <div className="pcs-label">{stage.label}</div>
                    </div>
                    {i < pipelineStages.length - 1 && (
                      <div className={`pcs-connector ${stage.status === 'done' ? 'pcs-connector-done' : ''}`} />
                    )}
                  </React.Fragment>
                ))}
              </div>
              {activeStage && (
                <div className="pipeline-chat-detail">
                  <span className="pipeline-pulse">●</span>
                  {activeStage.detail || activeStage.label}
                  {activeStage.round && (
                    <span className="pipeline-chat-round"> — Round {activeStage.round}/{activeStage.maxRounds}</span>
                  )}
                </div>
              )}
              {activeStage?.substages && (
                <div className="pipeline-chat-substages">
                  {activeStage.substages.map((sub, i) => (
                    <span key={i} className={`pcs-sub ${
                      sub.status === 'done' ? 'sub-done' :
                      sub.status === 'active' ? 'sub-active' : 'sub-pending'
                    }`}>
                      {sub.status === 'done' ? '✓' : sub.status === 'active' ? '●' : '○'} {sub.label}
                    </span>
                  ))}
                </div>
              )}
              {allDone && (
                <div className="pipeline-chat-done-msg">All stages complete ✓</div>
              )}
            </div>
          );
        })()}

        {/* ── Live Execution Stream ── */}
        {executionStream && (
          <div className={`exec-stream-card ${executionStream.done ? (executionStream.error ? 'exec-stream-error' : 'exec-stream-done') : 'exec-stream-live'}`}>
            <div className="exec-stream-header">
              <span className="exec-stream-icon">{executionStream.done ? (executionStream.error ? '✗' : '✓') : '⟳'}</span>
              <span className="exec-stream-title">
                {executionStream.done
                  ? (executionStream.error ? 'Fix failed' : 'Fix completed')
                  : `Fixing: ${executionStream.nodeLabel}`}
              </span>
              {!executionStream.done && (
                <button className="exec-stream-stop" onClick={onStopExecution} title="Stop execution">⏹ Stop</button>
              )}
              {executionStream.done && (
                <button className="exec-stream-dismiss" onClick={onDismissStream} title="Dismiss">✕</button>
              )}
            </div>
            <div className="exec-stream-body" ref={execStreamRef}>
              <pre className="exec-stream-output">{executionStream.text || 'Starting Claude Code…'}{!executionStream.done && <span className="chat-cursor">▊</span>}</pre>
            </div>
          </div>
        )}

        {/* ── Live Refine Stream ── */}
        {refineStream && (
          <RefineCard state={refineStream} onAction={onCardButtonClick} />
        )}

        {/* ── Live Portfolio Stream ── */}
        {portfolioStream && (
          <PortfolioCard state={portfolioStream} onAction={onCardButtonClick} />
        )}

        {/* ── Node Focus Card (sticky) ── */}
        {focusedNode && (
          <NodeFocusCard
            node={focusedNode.node}
            surgicalExpanded={focusedNode.surgicalExpanded}
            isSplitting={focusedNode.isSplitting}
            isMerging={focusedNode.isMerging}
            mergeTarget={focusedNode.mergeTarget}
            onAction={onCardButtonClick}
            onDismiss={onDismissFocus}
          />
        )}

        {streamingText && (() => {
          let visibleStream = streamingText.indexOf(ACTION_DELIMITER) > -1
            ? streamingText.slice(0, streamingText.indexOf(ACTION_DELIMITER))
            : streamingText;
          // Strip any trailing code fence before the delimiter
          visibleStream = visibleStream.replace(/```(?:json)?\s*$/, '').trimEnd();
          return visibleStream ? (
            <div className="chat-msg chat-msg-assistant">
              <div className="chat-msg-label">AI</div>
              <div className="chat-msg-content chat-msg-streaming">
                <ChatMarkdown content={visibleStream} />
                <span className="chat-cursor">▊</span>
              </div>
            </div>
          ) : null;
        })()}
      </div>

      {/* Quick actions — shown after first exchange too */}
      {messages.length > 0 && hasTree && (
        <div className="chat-quick-bar">
          {chatFilterActive && (
            <button
              className="chat-quick-chip chat-clear-chip"
              onClick={onClearFilter}
              disabled={isStreaming}
            >
              ✕ Clear Filters
            </button>
          )}
          {actions.map((a) => (
            <button
              key={a.label}
              className="chat-quick-chip"
              onClick={() => sendMessage(a.prompt)}
              disabled={isStreaming}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="chat-input-area">
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={hasTree ? 'Ask anything about your tree...' : 'Generate a tree first...'}
          disabled={isStreaming || !hasTree}
          rows={1}
        />
        {isStreaming ? (
          <button className="chat-send-btn chat-stop-btn" onClick={handleStop}>■</button>
        ) : (
          <button
            className="chat-send-btn"
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || !hasTree}
          >
            ▶
          </button>
        )}
      </div>
    </div>
  );
}
