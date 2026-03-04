import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { authFetch } from './api';

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
    return `- [${d.type || 'node'}] ${d.label || n.id}${d.reasoning ? ': ' + d.reasoning : ''}`;
  }).join('\n');
}

const CHAT_MODE_CONFIG = {
  idea:     { title: 'PRODUCT STRATEGIST', icon: '✦', emptyDesc: 'Your thinking tree is loaded as context. Ask questions or use a quick action below to generate actionable outputs.' },
  codebase: { title: 'TECH ADVISOR',       icon: '⟨/⟩', emptyDesc: 'Your codebase analysis is loaded as context. Ask questions or use a quick action below to generate technical docs.' },
  resume:   { title: 'CAREER COACH',       icon: '◎', emptyDesc: 'Your resume strategy tree is loaded as context. Ask questions or use a quick action below to generate career materials.' },
  decision: { title: 'DECISION ANALYST',   icon: '⚖', emptyDesc: 'Your decision tree is loaded as context. Ask questions or use a quick action below to generate decision docs.' },
  writing:  { title: 'WRITING EDITOR',     icon: '✦', emptyDesc: 'Your writing analysis is loaded as context. Ask questions or use a quick action below to generate content.' },
  plan:     { title: 'PROJECT ADVISOR',    icon: '◉', emptyDesc: 'Your project plan is loaded as context. Ask questions or use a quick action below to generate project docs.' },
};

export default function ChatPanel({ isOpen, onClose, nodes, idea, mode = 'idea' }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const abortRef = useRef(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingText]);

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
          messages: newMessages,
          treeContext,
          idea,
          mode,
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

      setMessages(prev => [...prev, { role: 'assistant', content: fullText }]);
      setStreamingText('');
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Chat error:', err);
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
      setStreamingText('');
    } finally {
      setIsStreaming(false);
    }
  }, [messages, nodes, idea, mode, isStreaming]);

  const handleStop = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    if (streamingText) {
      setMessages(prev => [...prev, { role: 'assistant', content: streamingText }]);
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
          <div key={i} className={`chat-msg chat-msg-${msg.role}`}>
            <div className="chat-msg-label">
              {msg.role === 'user' ? 'YOU' : 'AI'}
            </div>
            <div className="chat-msg-content">
              {msg.role === 'assistant'
                ? <ChatMarkdown content={msg.content} />
                : msg.content}
            </div>
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
        ))}

        {streamingText && (
          <div className="chat-msg chat-msg-assistant">
            <div className="chat-msg-label">AI</div>
            <div className="chat-msg-content chat-msg-streaming">
              <ChatMarkdown content={streamingText} />
              <span className="chat-cursor">▊</span>
            </div>
          </div>
        )}
      </div>

      {/* Quick actions — shown after first exchange too */}
      {messages.length > 0 && hasTree && (
        <div className="chat-quick-bar">
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
