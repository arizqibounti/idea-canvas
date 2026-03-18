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
    probe, feedback, correctAnswer, correct, misconceptions, nextAction,
    teachContent, adaptSummary,
    milestoneId: _milestoneId, milestoneLabel, challenge, coveredConcepts, followUpQuestions: _followUpQuestions, // eslint-disable-line no-unused-vars
    detail, error, masteryMap: finalMasteryMap, totalConcepts, showHint } = state;

  const isActive = status === 'generating_probe' || status === 'evaluating' || status === 'adapting';
  const isDone = status === 'done' || status === 'complete';
  const isProbing = status === 'probing';
  const isFeedback = status === 'feedback' || status === 'milestone_feedback';
  const isSocratic = status === 'socratic' && challenge;
  const isTeaching = status === 'teaching';
  const isAdaptSummary = status === 'adapt_summary';
  const isError = status === 'error';

  return (
    <div className={`chat-learn-card ${isActive ? 'learn-card-active' : ''} ${isDone ? 'learn-card-done' : ''} ${isError ? 'learn-card-error' : ''}`}>
      {/* Header */}
      <div className="learn-card-header">
        <span className="learn-card-icon">
          {(isActive || (isTeaching && !teachContent)) && <span className="learn-pulse">●</span>}
          {isTeaching && teachContent && '📖'}
          {isProbing && '?'}
          {isSocratic && '?'}
          {isFeedback && (correct ? '✓' : '✗')}
          {isAdaptSummary && '💡'}
          {isDone && '★'}
          {isError && '✗'}
        </span>
        <span className="learn-card-title">
          {isTeaching && !teachContent && `Preparing lesson for "${conceptLabel}"`}
          {isTeaching && teachContent && `Lesson: ${conceptLabel}`}
          {status === 'generating_probe' && `Preparing question for "${conceptLabel}"`}
          {isProbing && `Quiz: ${conceptLabel}`}
          {status === 'evaluating' && 'Evaluating your answer...'}
          {isFeedback && `Feedback: ${conceptLabel}`}
          {status === 'adapting' && 'Generating alternative explanation...'}
          {isAdaptSummary && `Alternative Explanation: ${conceptLabel}`}
          {isSocratic && `Milestone: ${milestoneLabel}`}
          {isDone && `Learning Complete${totalConcepts ? ` — ${totalConcepts} concepts` : ''}`}
          {isError && 'Learning Error'}
        </span>
        {(isActive || isProbing || isSocratic || (isTeaching && !teachContent)) && (
          <button className="learn-card-stop" onClick={() => onAction?.({ actionType: 'stopLearn' })}>Stop</button>
        )}
      </div>

      {/* Active spinner states */}
      {(isActive || (isTeaching && !teachContent)) && (
        <div className="learn-card-status">
          {detail || 'Processing...'}
        </div>
      )}

      {/* Teaching lesson */}
      {isTeaching && teachContent && (
        <div className="learn-card-lesson">
          <div className="learn-lesson-explanation">{teachContent.explanation}</div>

          {teachContent.keyTakeaways?.length > 0 && (
            <div className="learn-lesson-takeaways">
              <strong>Key Takeaways:</strong>
              <ul>{teachContent.keyTakeaways.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
          )}

          {teachContent.example && (
            <div className="learn-lesson-example">
              <strong>Example:</strong>
              <div>{teachContent.example}</div>
            </div>
          )}

          {teachContent.analogy && (
            <div className="learn-lesson-analogy">
              <strong>Think of it like:</strong> {teachContent.analogy}
            </div>
          )}

          <div className="learn-card-actions">
            <button className="learn-card-btn learn-card-btn-primary"
              onClick={() => onAction?.({ actionType: 'learnContinue' })}>
              Ready for Quiz →
            </button>
          </div>
        </div>
      )}

      {/* Adapt summary (inline alternative explanation) */}
      {isAdaptSummary && adaptSummary && (
        <div className="learn-card-lesson">
          <div className="learn-lesson-explanation">{adaptSummary}</div>
          <div className="learn-card-actions">
            <button className="learn-card-btn learn-card-btn-primary"
              onClick={() => onAction?.({ actionType: 'learnContinue' })}>
              Try Again
            </button>
          </div>
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

          {correctAnswer && mastery < 8 && (
            <div className="learn-feedback-correct">
              <strong>The key insight:</strong> {correctAnswer}
            </div>
          )}

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
                <span className="learn-complete-label">{data.label || id}</span>
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
