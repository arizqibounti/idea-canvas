// ── Inline Learn Card for Chat ──────────────────────────────
// Renders comprehension loop progress/probes directly in the chat stream.
// Follows the RefineCard.js pattern.

import React, { useState } from 'react';

function MasteryBadge({ mastery }) {
  const color = mastery >= 8 ? '#22c55e' : mastery >= 5 ? '#fbbf24' : mastery >= 1 ? '#ef4444' : '#6b7280';
  const label = mastery >= 8 ? 'MASTERED' : mastery >= 5 ? 'PARTIAL' : mastery >= 1 ? 'GAP' : 'NEW';
  return (
    <span className="learn-mastery-badge" style={{ background: `${color}18`, color, borderColor: `${color}40` }}>
      {mastery}/10 {label}
    </span>
  );
}

export default function LearnCard({ state, onAction }) {
  const [answer, setAnswer] = useState('');
  // eslint-disable-next-line no-unused-vars
  const [hintIndex, setHintIndex] = useState(0);

  if (!state) return null;

  const { status, conceptId, conceptLabel, conceptReasoning, mastery,
    probe, feedback, correct, misconceptions, nextAction,
    milestoneId: _milestoneId, milestoneLabel, challenge, coveredConcepts, followUpQuestions: _followUpQuestions, // eslint-disable-line no-unused-vars
    detail, error, masteryMap: finalMasteryMap, totalConcepts, showHint } = state;

  const isActive = status === 'generating_probe' || status === 'evaluating' || status === 'adapting';
  const isDone = status === 'done' || status === 'complete';
  const isProbing = status === 'probing';
  const isFeedback = status === 'feedback' || status === 'milestone_feedback';
  const isSocratic = status === 'socratic' && challenge;
  const isError = status === 'error';

  return (
    <div className={`chat-learn-card ${isActive ? 'learn-card-active' : ''} ${isDone ? 'learn-card-done' : ''} ${isError ? 'learn-card-error' : ''}`}>
      {/* Header */}
      <div className="learn-card-header">
        <span className="learn-card-icon">
          {isActive && <span className="learn-pulse">●</span>}
          {isProbing && '?'}
          {isSocratic && '?'}
          {isFeedback && (correct ? '✓' : '✗')}
          {isDone && '★'}
          {isError && '✗'}
        </span>
        <span className="learn-card-title">
          {status === 'generating_probe' && `Preparing question for "${conceptLabel}"`}
          {isProbing && `Quiz: ${conceptLabel}`}
          {status === 'evaluating' && 'Evaluating your answer...'}
          {isFeedback && `Feedback: ${conceptLabel}`}
          {status === 'adapting' && 'Generating alternative explanation...'}
          {isSocratic && `Milestone: ${milestoneLabel}`}
          {isDone && `Learning Complete${totalConcepts ? ` — ${totalConcepts} concepts` : ''}`}
          {isError && 'Learning Error'}
        </span>
        {(isActive || isProbing || isSocratic) && (
          <button className="learn-card-stop" onClick={() => onAction?.({ actionType: 'stopLearn' })}>Stop</button>
        )}
      </div>

      {/* Active spinner states */}
      {isActive && (
        <div className="learn-card-status">
          {detail || 'Processing...'}
        </div>
      )}

      {/* Concept context */}
      {(isProbing || isSocratic) && conceptReasoning && (
        <div className="learn-card-context">
          {conceptReasoning}
        </div>
      )}

      {/* Probe question with answer input */}
      {isProbing && probe && (
        <div className="learn-card-probe">
          <div className="learn-probe-question">
            <span className="learn-probe-type">{probe.probeType?.toUpperCase() || 'PROBE'}</span>
            {probe.question}
          </div>

          {/* Hints */}
          {showHint > 0 && probe.hints?.length > 0 && (
            <div className="learn-probe-hints">
              {probe.hints.slice(0, showHint).map((hint, i) => (
                <div key={i} className="learn-probe-hint">Hint {i + 1}: {hint}</div>
              ))}
            </div>
          )}

          <textarea
            className="learn-answer-input"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Type your answer here..."
            rows={3}
          />
          <div className="learn-card-actions">
            <button
              className="learn-card-btn learn-card-btn-primary"
              disabled={!answer.trim()}
              onClick={() => {
                onAction?.({ actionType: 'submitLearnAnswer', answer: answer.trim() });
                setAnswer('');
                setHintIndex(0);
              }}
            >
              Submit Answer
            </button>
            {probe.hints?.length > 0 && (showHint || 0) < probe.hints.length && (
              <button className="learn-card-btn" onClick={() => onAction?.({ actionType: 'learnHint' })}>
                Hint
              </button>
            )}
            <button className="learn-card-btn learn-card-btn-skip" onClick={() => onAction?.({ actionType: 'learnSkip', conceptId })}>
              Skip
            </button>
          </div>
        </div>
      )}

      {/* Socratic challenge */}
      {isSocratic && (
        <div className="learn-card-probe">
          <div className="learn-probe-question">
            <span className="learn-probe-type">MILESTONE CHALLENGE</span>
            {challenge}
          </div>

          {coveredConcepts?.length > 0 && (
            <div className="learn-card-covered">
              Covers: {coveredConcepts.map(c => c.label).join(', ')}
            </div>
          )}

          <textarea
            className="learn-answer-input"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Type your answer here..."
            rows={4}
          />
          <div className="learn-card-actions">
            <button
              className="learn-card-btn learn-card-btn-primary"
              disabled={!answer.trim()}
              onClick={() => {
                onAction?.({ actionType: 'submitLearnAnswer', answer: answer.trim() });
                setAnswer('');
              }}
            >
              Submit
            </button>
          </div>
        </div>
      )}

      {/* Feedback */}
      {isFeedback && (
        <div className="learn-card-feedback">
          <MasteryBadge mastery={mastery || 0} />
          {feedback && <div className="learn-feedback-text">{feedback}</div>}

          {misconceptions?.length > 0 && (
            <div className="learn-feedback-misconceptions">
              <strong>Misconceptions detected:</strong>
              <ul>{misconceptions.map((m, i) => <li key={i}>{m}</li>)}</ul>
            </div>
          )}

          <div className="learn-card-actions">
            <button className="learn-card-btn learn-card-btn-primary" onClick={() => onAction?.({ actionType: 'learnContinue' })}>
              {nextAction === 'advance' ? 'Next Concept' : 'Continue'}
            </button>
            {nextAction !== 'advance' && (
              <button className="learn-card-btn" onClick={() => onAction?.({ actionType: 'learnExplainDifferently', conceptId })}>
                Explain Differently
              </button>
            )}
          </div>
        </div>
      )}

      {/* Complete */}
      {isDone && finalMasteryMap && (
        <div className="learn-card-complete">
          <div className="learn-complete-summary">
            {Object.entries(finalMasteryMap).map(([id, data]) => (
              <div key={id} className="learn-complete-row">
                <span className="learn-complete-label">{id}</span>
                <MasteryBadge mastery={data.score || 0} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {isError && <div className="learn-card-error-msg">{error}</div>}
    </div>
  );
}
