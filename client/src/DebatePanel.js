import React, { useState, useCallback, useRef, useEffect } from 'react';
import { buildFlowNode, readSSEStream } from './useCanvasMode';
import { authFetch } from './api';

const API_URL = process.env.REACT_APP_API_URL || '';
const MAX_ROUNDS = 5;

const CATEGORY_COLORS = {
  // Idea / product mode
  obsolescence: '#ff4757',
  market:       '#ffa94d',
  moat:         '#cc5de8',
  execution:    '#ff922b',
  gtm:          '#4dabf7',
  model:        '#ffd43b',
  // Resume mode
  match:        '#51cf66',
  gap:          '#ff6b6b',
  clarity:      '#ffa94d',
  impact:       '#ffd43b',
  keywords:     '#20c997',
  positioning:  '#da77f2',
  // Codebase mode
  security:     '#ff4757',
  debt:         '#fd7e14',
  scalability:  '#4dabf7',
  coverage:     '#69db7c',
  coupling:     '#cc5de8',
  performance:  '#20c997',
  // Decide mode
  bias:         '#ff6b6b',
  tradeoff:     '#ffa94d',
  alternative:  '#51cf66',
  consequence:  '#ff4757',
  assumption:   '#ffd43b',
  blindspot:    '#cc5de8',
  // Write mode
  structure:    '#51cf66',
  audience:     '#ffd43b',
  argument:     '#ffa94d',
  voice:        '#cc5de8',
  evidence:     '#4dabf7',
  // Plan mode
  timeline:     '#ff4757',
  dependency:   '#fd7e14',
  resource:     '#ffd43b',
  scope:        '#4dabf7',
  risk:         '#ff6b6b',
  milestone:    '#51cf66',
};

const CATEGORY_LABELS = {
  // Idea / product mode
  obsolescence: 'AI OBSOLESCENCE',
  market:       'MARKET',
  moat:         'MOAT',
  execution:    'EXECUTION',
  gtm:          'GO-TO-MARKET',
  model:        'BIZ MODEL',
  // Resume mode
  match:        'MATCH',
  gap:          'GAP',
  clarity:      'CLARITY',
  impact:       'IMPACT',
  keywords:     'KEYWORDS',
  positioning:  'POSITIONING',
  // Codebase mode
  security:     'SECURITY',
  debt:         'TECH DEBT',
  scalability:  'SCALABILITY',
  coverage:     'COVERAGE',
  coupling:     'COUPLING',
  performance:  'PERFORMANCE',
  // Decide mode
  bias:         'BIAS',
  tradeoff:     'TRADEOFF',
  alternative:  'ALTERNATIVE',
  consequence:  'CONSEQUENCE',
  assumption:   'ASSUMPTION',
  blindspot:    'BLIND SPOT',
  // Write mode
  structure:    'STRUCTURE',
  audience:     'AUDIENCE',
  argument:     'ARGUMENT',
  voice:        'VOICE',
  evidence:     'EVIDENCE',
  // Plan mode
  timeline:     'TIMELINE',
  dependency:   'DEPENDENCY',
  resource:     'RESOURCE',
  scope:        'SCOPE',
  risk:         'RISK',
  milestone:    'MILESTONE',
};

const MODE_CONFIG = {
  idea: {
    panelTitle:       'VC CRITIQUE',
    panelIcon:        '⚔',
    emptyTitle:       'VC CRITIQUE',
    startLabel:       'START CRITIQUE',
    stopLabel:        'STOP CRITIQUE',
    statusIdle:       'Ready to tear apart your idea.',
    statusCritiquing: 'VC researching and analyzing...',
    statusRebutting:  'Architect researching and responding...',
    responderLabel:   'ARCHITECT',
    emptyDesc:        (maxRounds) => `The VC critic will challenge every assumption in your tree. The architect will respond with concrete solutions. This loops until consensus or ${maxRounds} rounds.`,
    consensusTitle:   'CONSENSUS REACHED',
    consensusDesc:    (rounds, fc) => `After ${rounds} round${rounds !== 1 ? 's' : ''}, the VC critic is satisfied.${fc > 0 ? ` ${fc} nodes in the tree have been updated to reflect the debate insights.` : ''}`,
  },
  resume: {
    panelTitle:       'HIRING REVIEW',
    panelIcon:        '◎',
    emptyTitle:       'HIRING REVIEW',
    startLabel:       'START REVIEW',
    stopLabel:        'STOP REVIEW',
    statusIdle:       'Ready to stress-test your resume strategy.',
    statusCritiquing: 'Hiring manager reviewing strategy...',
    statusRebutting:  'Career coach building responses...',
    responderLabel:   'CAREER COACH',
    emptyDesc:        (maxRounds) => `A hiring manager will challenge your resume strategy — gaps, weak stories, missing keywords, vague positioning. A career coach will respond with concrete evidence, STAR stories, and targeted fixes. Loops until the hiring manager is satisfied or ${maxRounds} rounds.`,
    consensusTitle:   'STRATEGY APPROVED',
    consensusDesc:    (rounds, fc) => `After ${rounds} round${rounds !== 1 ? 's' : ''}, the hiring manager would advance this candidate.${fc > 0 ? ` ${fc} nodes updated with the strengthened strategy.` : ''}`,
  },
  codebase: {
    panelTitle:       'CODE AUDIT',
    panelIcon:        '⟨/⟩',
    emptyTitle:       'CODE AUDIT',
    startLabel:       'START AUDIT',
    stopLabel:        'STOP AUDIT',
    statusIdle:       'Ready to audit your codebase architecture.',
    statusCritiquing: 'Security auditor reviewing code...',
    statusRebutting:  'Tech lead proposing solutions...',
    responderLabel:   'TECH LEAD',
    emptyDesc:        (maxRounds) => `A security auditor will challenge every architectural decision — vulnerabilities, tech debt, scalability bottlenecks, and coupling issues. A senior tech lead will respond with specific patterns, refactoring strategies, and technical solutions. Loops until the auditor is satisfied or ${maxRounds} rounds.`,
    consensusTitle:   'AUDIT COMPLETE',
    consensusDesc:    (rounds, fc) => `After ${rounds} round${rounds !== 1 ? 's' : ''}, the security auditor is satisfied with the architectural approach.${fc > 0 ? ` ${fc} nodes updated with hardened technical solutions.` : ''}`,
  },
  decision: {
    panelTitle:       "DEVIL'S ADVOCATE",
    panelIcon:        '⚖',
    emptyTitle:       "DEVIL'S ADVOCATE",
    startLabel:       'START DEBATE',
    stopLabel:        'STOP DEBATE',
    statusIdle:       'Ready to stress-test your decision.',
    statusCritiquing: "Devil's advocate analyzing...",
    statusRebutting:  'Strategic advisor responding...',
    responderLabel:   'STRATEGIC ADVISOR',
    emptyDesc:        (maxRounds) => `A devil's advocate will surface cognitive biases, hidden assumptions, overlooked alternatives, and second-order consequences. A strategic advisor will respond with frameworks, precedents, and evidence-based reasoning. Loops until consensus or ${maxRounds} rounds.`,
    consensusTitle:   'DECISION VALIDATED',
    consensusDesc:    (rounds, fc) => `After ${rounds} round${rounds !== 1 ? 's' : ''}, the devil's advocate is satisfied the decision is well-reasoned.${fc > 0 ? ` ${fc} nodes updated with the strengthened analysis.` : ''}`,
  },
  writing: {
    panelTitle:       'EDITORIAL REVIEW',
    panelIcon:        '✦',
    emptyTitle:       'EDITORIAL REVIEW',
    startLabel:       'START REVIEW',
    stopLabel:        'STOP REVIEW',
    statusIdle:       'Ready to critique your writing.',
    statusCritiquing: 'Senior editor reviewing...',
    statusRebutting:  'Writer addressing critiques...',
    responderLabel:   'WRITER',
    emptyDesc:        (maxRounds) => `A senior editor will challenge every structural decision — muddled logic, weak arguments, audience misalignment, and unsupported claims. The writer will respond with concrete rewrites, structural fixes, and supporting evidence. Loops until the editor is satisfied or ${maxRounds} rounds.`,
    consensusTitle:   'WRITING APPROVED',
    consensusDesc:    (rounds, fc) => `After ${rounds} round${rounds !== 1 ? 's' : ''}, the senior editor is satisfied with the writing plan.${fc > 0 ? ` ${fc} nodes updated with the refined editorial direction.` : ''}`,
  },
  plan: {
    panelTitle:       'RISK ANALYSIS',
    panelIcon:        '◉',
    emptyTitle:       'RISK ANALYSIS',
    startLabel:       'START ANALYSIS',
    stopLabel:        'STOP ANALYSIS',
    statusIdle:       'Ready to stress-test your plan.',
    statusCritiquing: 'Risk analyst reviewing...',
    statusRebutting:  'Project manager mitigating...',
    responderLabel:   'PROJECT MANAGER',
    emptyDesc:        (maxRounds) => `A risk analyst will challenge every assumption — optimistic timelines, unidentified dependencies, resource gaps, and scope risks. A project manager will respond with mitigations, contingencies, and realistic solutions. Loops until the analyst is satisfied or ${maxRounds} rounds.`,
    consensusTitle:   'PLAN APPROVED',
    consensusDesc:    (rounds, fc) => `After ${rounds} round${rounds !== 1 ? 's' : ''}, the risk analyst is satisfied the plan is executable.${fc > 0 ? ` ${fc} nodes updated with hardened risk mitigations.` : ''}`,
  },
};

function RoundBadge({ round, verdict }) {
  return (
    <div className="debate-round-badge">
      <span className="debate-round-num">ROUND {round}</span>
      {verdict && (
        <span
          className="debate-verdict-chip"
          style={{
            color: verdict === 'YES' ? '#51cf66' : '#ff4757',
            borderColor: verdict === 'YES' ? '#51cf66' : '#ff4757',
            background: verdict === 'YES' ? 'rgba(81,207,102,0.08)' : 'rgba(255,71,87,0.08)',
          }}
        >
          {verdict === 'YES' ? '✓ CONSENSUS' : '✗ NOT YET'}
        </span>
      )}
    </div>
  );
}

function CritiqueCard({ critique }) {
  const color = CATEGORY_COLORS[critique.category] || '#8888aa';
  const label = CATEGORY_LABELS[critique.category] || critique.category?.toUpperCase();
  return (
    <div className="debate-critique-card">
      <div className="debate-critique-meta">
        <span className="debate-critique-category" style={{ color, borderColor: color }}>
          {label}
        </span>
        <span className="debate-critique-target">↳ {critique.targetNodeLabel}</span>
      </div>
      <div className="debate-critique-challenge">{critique.challenge}</div>
      <div className="debate-critique-reasoning">{critique.reasoning}</div>
    </div>
  );
}

function RoundEntry({ round, summary, verdict, critiques, blockers, rebutNodes, isLatest, mode, onSuggestionExpand, expandedSuggestions, expandingSuggestion }) {
  const [expanded, setExpanded] = useState(isLatest);

  useEffect(() => {
    if (isLatest) setExpanded(true);
  }, [isLatest]);

  return (
    <div className={`debate-round-entry ${isLatest ? 'latest' : ''}`}>
      <RoundBadge round={round} verdict={verdict} />

      <button className="debate-summary-toggle" onClick={() => setExpanded((v) => !v)}>
        <span className="debate-summary-text">{summary}</span>
        <span className="debate-toggle-icon">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="debate-round-body">
          {/* Critiques */}
          {critiques?.length > 0 && (
            <div className="debate-section">
              <div className="debate-section-label">⚔ CRITIQUES ({critiques.length})</div>
              {critiques.map((c) => <CritiqueCard key={c.id} critique={c} />)}
            </div>
          )}

          {/* Suggestions */}
          {blockers?.length > 0 && (
            <div className="debate-section">
              <div className="debate-section-label">💡 SUGGESTIONS</div>
              {blockers.map((b, i) => {
                const key = `r${round}_${i}`;
                const isAdded = expandedSuggestions?.has(key);
                const isExpanding = expandingSuggestion === key;
                return (
                  <div
                    key={i}
                    className={`debate-blocker debate-blocker-clickable ${isAdded ? 'debate-blocker-added' : ''} ${isExpanding ? 'debate-blocker-expanding' : ''}`}
                    onClick={() => {
                      if (!isAdded && !isExpanding && onSuggestionExpand) {
                        onSuggestionExpand(b, key);
                      }
                    }}
                  >
                    <span className="debate-blocker-text">{b}</span>
                    <span className="debate-blocker-action">
                      {isExpanding ? '◌' : isAdded ? '✓' : '+'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Rebut nodes */}
          {rebutNodes?.length > 0 && (
            <div className="debate-section">
              <div className="debate-section-label">◆ {(MODE_CONFIG[mode] || MODE_CONFIG.idea).responderLabel} RESPONSE ({rebutNodes.length} new nodes)</div>
              {rebutNodes.map((n) => (
                <div key={n.id} className="debate-rebut-node">
                  <span className="debate-rebut-label">{n.data?.label || n.label}</span>
                  <span className="debate-rebut-reasoning">{n.data?.reasoning || n.reasoning}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DebatePanel({ isOpen, onClose, nodes, idea, onNodesAdded, onNodeUpdate, autoStart, debateRoundsRef, mode = 'idea', onApplyToResume, onConsensusReached, onSuggestionExpand }) {
  const [rounds, setRounds] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | critiquing | rebutting | finalizing | consensus | stopped
  const [currentRound, setCurrentRound] = useState(0);
  const [finalizeCount, setFinalizeCount] = useState(0);
  const abortRef = useRef(null);
  const loopRef = useRef(false);
  const scrollRef = useRef(null);
  const allRoundsRef = useRef([]); // tracks full history for finalize endpoint
  const [expandedSuggestions, setExpandedSuggestions] = useState(new Set());
  const [expandingSuggestion, setExpandingSuggestion] = useState(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [rounds, status]);

  // Sync rounds to parent ref for export
  useEffect(() => {
    if (debateRoundsRef) debateRoundsRef.current = rounds;
  }, [rounds, debateRoundsRef]);

  // Reset when panel opens fresh for a new idea
  useEffect(() => {
    if (isOpen) {
      setRounds([]);
      setCurrentRound(0);
      setStatus('idle');
      setIsRunning(false);
      setFinalizeCount(0);
      allRoundsRef.current = [];
      setExpandedSuggestions(new Set());
      setExpandingSuggestion(null);
    }
  }, [isOpen, idea]);

  const handleSuggestionExpand = useCallback(async (suggestionText, key) => {
    if (!onSuggestionExpand) return;
    setExpandingSuggestion(key);
    try {
      await onSuggestionExpand(suggestionText);
      setExpandedSuggestions(prev => new Set([...prev, key]));
    } finally {
      setExpandingSuggestion(null);
    }
  }, [onSuggestionExpand]);

  const stop = useCallback(() => {
    loopRef.current = false;
    if (abortRef.current) abortRef.current.abort();
    setIsRunning(false);
    setStatus('stopped');
  }, []);

  const runFinalize = useCallback(async (currentNodes) => {
    if (!allRoundsRef.current.length) return;

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await authFetch(`${API_URL}/api/debate/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes: currentNodes.map((n) => ({
            id: n.id,
            type: n.data?.type || n.type,
            label: n.data?.label || n.label,
            reasoning: n.data?.reasoning || n.reasoning,
            parentId: n.data?.parentId || n.parentId,
          })),
          idea,
          debateHistory: allRoundsRef.current,
          mode,
        }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      let updateCount = 0;
      let addCount = 0;

      await readSSEStream(res, (nodeData) => {
        if (nodeData._update) {
          // Update existing node in place
          onNodeUpdate(nodeData);
          updateCount++;
        } else {
          // Add new synthesis node
          const flowNode = buildFlowNode(nodeData);
          onNodesAdded([flowNode]);
          addCount++;
        }
        setFinalizeCount(updateCount + addCount);
      });
      // Notify parent for template extraction
      if (onConsensusReached) onConsensusReached();
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Finalize error:', err);
    }
  }, [idea, onNodesAdded, onNodeUpdate, onConsensusReached]);

  const runDebateLoop = useCallback(async (startRound, accumulatedNodes, priorBlockers) => {
    loopRef.current = true;
    let round = startRound;
    let currentNodes = [...accumulatedNodes];
    let blockers = [...(priorBlockers || [])];

    while (loopRef.current && round <= MAX_ROUNDS) {
      // ── Step 1: Critique ──────────────────────────────────
      setStatus('critiquing');
      setCurrentRound(round);

      let critiqueResult;
      try {
        const controller = new AbortController();
        abortRef.current = controller;

        const res = await authFetch(`${API_URL}/api/debate/critique`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nodes: currentNodes.map((n) => ({
              id: n.id,
              type: n.data?.type || n.type,
              label: n.data?.label || n.label,
              reasoning: n.data?.reasoning || n.reasoning,
              parentId: n.data?.parentId || n.parentId,
            })),
            idea,
            round,
            priorCritiques: blockers,
            mode,
          }),
          signal: controller.signal,
        });

        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        critiqueResult = await res.json();
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('Critique error:', err);
        setStatus('stopped');
        return;
      }

      if (!loopRef.current) return;

      const { verdict, round_summary, critiques, consensus_blockers, suggestions } = critiqueResult;
      // Support both old "consensus_blockers" and new "suggestions" field
      blockers = suggestions || consensus_blockers || [];

      // Add critique nodes to canvas
      const critiqueNodes = (critiques || []).map((c) => buildFlowNode({
        id: `crit_r${round}_${c.id}`,
        parentId: c.targetNodeId,
        type: 'critique',
        label: c.challenge,
        reasoning: c.reasoning,
      }));

      if (critiqueNodes.length) {
        currentNodes = [...currentNodes, ...critiqueNodes];
        onNodesAdded(critiqueNodes);
      }

      const roundEntry = {
        round,
        verdict,
        summary: round_summary,
        critiques: critiques || [],
        blockers: suggestions || consensus_blockers || [],
        rebutNodes: [],
        critiqueNodes,
      };

      // Record round entry (no rebut nodes yet)
      setRounds((prev) => [...prev, roundEntry]);

      // If consensus reached, run finalize then stop
      if (verdict === 'YES') {
        allRoundsRef.current = [...allRoundsRef.current, roundEntry];
        setStatus('finalizing');
        await runFinalize(currentNodes);
        setStatus('consensus');
        setIsRunning(false);
        loopRef.current = false;
        return;
      }

      if (!loopRef.current) return;
      if (round >= MAX_ROUNDS) {
        allRoundsRef.current = [...allRoundsRef.current, roundEntry];
        setStatus('stopped');
        setIsRunning(false);
        loopRef.current = false;
        return;
      }

      // ── Step 2: Rebut ─────────────────────────────────────
      setStatus('rebutting');

      const rebutNodes = [];
      try {
        const controller = new AbortController();
        abortRef.current = controller;

        const res = await authFetch(`${API_URL}/api/debate/rebut`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nodes: currentNodes.map((n) => ({
              id: n.id,
              type: n.data?.type || n.type,
              label: n.data?.label || n.label,
              reasoning: n.data?.reasoning || n.reasoning,
              parentId: n.data?.parentId || n.parentId,
            })),
            idea,
            round,
            critiques: critiques || [],
            mode,
          }),
          signal: controller.signal,
        });

        if (!res.ok) throw new Error(`Server error: ${res.status}`);

        await readSSEStream(res, (nodeData) => {
          const flowNode = buildFlowNode(nodeData);
          rebutNodes.push(flowNode);
          currentNodes = [...currentNodes, flowNode];
          onNodesAdded([flowNode]);
        });
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('Rebut error:', err);
        setStatus('stopped');
        return;
      }

      // Update round entry with rebut nodes and save to history ref
      const completedRound = { ...roundEntry, rebutNodes };
      setRounds((prev) => prev.map((r) =>
        r.round === round ? completedRound : r
      ));
      allRoundsRef.current = [...allRoundsRef.current, completedRound];

      round++;
    }

    if (loopRef.current) {
      setStatus('stopped');
      setIsRunning(false);
      loopRef.current = false;
    }
  }, [idea, onNodesAdded, runFinalize]);

  const handleStart = useCallback(() => {
    if (!nodes?.length) return;
    setRounds([]);
    setCurrentRound(1);
    setIsRunning(true);
    allRoundsRef.current = [];
    runDebateLoop(1, nodes, []);
  }, [nodes, runDebateLoop]);

  const handleResume = useCallback(() => {
    if (!nodes?.length) return;
    const lastRound = rounds[rounds.length - 1];
    const nextRound = (lastRound?.round || 0) + 1;
    const blockers = lastRound?.blockers || [];
    setIsRunning(true);
    setStatus('critiquing');
    runDebateLoop(nextRound, nodes, blockers);
  }, [nodes, rounds, runDebateLoop]);

  // Auto-start when panel opens with autoStart=true
  useEffect(() => {
    if (isOpen && autoStart && !isRunning && rounds.length === 0) {
      handleStart();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, autoStart]);

  if (!isOpen) return null;

  const hasConsensus = status === 'consensus';
  const isFinalizing = status === 'finalizing';
  const isStopped = status === 'stopped' && !isRunning;
  const canResume = isStopped && rounds.length > 0 && rounds.length < MAX_ROUNDS;

  return (
    <div className="debate-panel">
      <div className="debate-panel-header">
        <div className="debate-panel-title">
          <span className="debate-panel-icon">{(MODE_CONFIG[mode] || MODE_CONFIG.idea).panelIcon}</span>
          <span>{(MODE_CONFIG[mode] || MODE_CONFIG.idea).panelTitle}</span>
          {currentRound > 0 && (
            <span className="debate-panel-round-counter">
              round {currentRound}/{MAX_ROUNDS}
            </span>
          )}
        </div>
        <button className="modal-close" onClick={onClose}>✕</button>
      </div>

      {/* Status bar */}
      <div className="debate-status-bar">
        {status === 'idle' && (
          <span className="debate-status-text">
            {(MODE_CONFIG[mode] || MODE_CONFIG.idea).statusIdle}
          </span>
        )}
        {status === 'critiquing' && (
          <span className="debate-status-text critiquing">
            <span className="debate-pulse" />
            {(MODE_CONFIG[mode] || MODE_CONFIG.idea).statusCritiquing}
          </span>
        )}
        {status === 'rebutting' && (
          <span className="debate-status-text rebutting">
            <span className="debate-pulse rebutting-pulse" />
            {(MODE_CONFIG[mode] || MODE_CONFIG.idea).statusRebutting}
          </span>
        )}
        {isFinalizing && (
          <span className="debate-status-text rebutting">
            <span className="debate-pulse rebutting-pulse" />
            Synthesizing consensus into tree...{finalizeCount > 0 ? ` (${finalizeCount} nodes updated)` : ''}
          </span>
        )}
        {hasConsensus && (
          <span className="debate-status-text consensus">
            ✓ {(MODE_CONFIG[mode] || MODE_CONFIG.idea).consensusTitle} — tree updated
          </span>
        )}
        {isStopped && rounds.length === 0 && <span className="debate-status-text">Stopped.</span>}
        {isStopped && rounds.length > 0 && !hasConsensus && (
          <span className="debate-status-text stopped">
            {rounds.length >= MAX_ROUNDS ? `Max ${MAX_ROUNDS} rounds reached.` : 'Paused.'}
          </span>
        )}
      </div>

      {/* Rounds log */}
      <div className="debate-rounds-log" ref={scrollRef}>
        {rounds.length === 0 && status === 'idle' && (
          <div className="debate-empty">
            <div className="debate-empty-icon">{(MODE_CONFIG[mode] || MODE_CONFIG.idea).panelIcon}</div>
            <div className="debate-empty-title">{(MODE_CONFIG[mode] || MODE_CONFIG.idea).emptyTitle}</div>
            <div className="debate-empty-desc">
              {(MODE_CONFIG[mode] || MODE_CONFIG.idea).emptyDesc(MAX_ROUNDS)}
            </div>
          </div>
        )}

        {rounds.map((r, i) => (
          <RoundEntry
            key={r.round}
            {...r}
            isLatest={i === rounds.length - 1}
            mode={mode}
            onSuggestionExpand={handleSuggestionExpand}
            expandedSuggestions={expandedSuggestions}
            expandingSuggestion={expandingSuggestion}
          />
        ))}

        {hasConsensus && (
          <div className="debate-consensus-banner">
            <div className="debate-consensus-icon">✦</div>
            <div className="debate-consensus-title">
              {(MODE_CONFIG[mode] || MODE_CONFIG.idea).consensusTitle}
            </div>
            <div className="debate-consensus-desc">
              {(MODE_CONFIG[mode] || MODE_CONFIG.idea).consensusDesc(rounds.length, finalizeCount)}
            </div>
            {mode === 'resume' && onApplyToResume && (
              <button className="btn btn-apply-resume" onClick={onApplyToResume}>
                ✦ APPLY CHANGES TO RESUME
              </button>
            )}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="debate-footer">
        {!isRunning && status === 'idle' && (
          <button
            className="btn btn-debate-start"
            onClick={handleStart}
            disabled={!nodes?.length}
          >
            {(MODE_CONFIG[mode] || MODE_CONFIG.idea).panelIcon} {(MODE_CONFIG[mode] || MODE_CONFIG.idea).startLabel}
          </button>
        )}
        {isRunning && (
          <button className="btn btn-stop" onClick={stop}>■ {(MODE_CONFIG[mode] || MODE_CONFIG.idea).stopLabel}</button>
        )}
        {canResume && (
          <button className="btn btn-debate-resume" onClick={handleResume}>
            ↺ RESUME ({MAX_ROUNDS - rounds.length} rounds left)
          </button>
        )}
        {!isRunning && rounds.length > 0 && (
          <button
            className="btn btn-debate-restart"
            onClick={() => {
              setRounds([]);
              setCurrentRound(0);
              setStatus('idle');
              setFinalizeCount(0);
              allRoundsRef.current = [];
            }}
          >
            ↺ RESTART
          </button>
        )}
      </div>
    </div>
  );
}
