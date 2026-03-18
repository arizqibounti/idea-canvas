// ── Generic Agent Loop Controller ─────────────────────────────
// Replaces duplicated loop logic in useAutoRefine, useLearnLoop, useExperimentLoop.
// Each loop is defined as a sequence of steps with conditions.

import { useState, useRef, useCallback } from 'react';
import { authFetch } from './api';
import { readSSEStream, buildFlowNode } from './useCanvasMode';

const API_URL = process.env.REACT_APP_API_URL || '';

/**
 * Generic agent loop hook.
 *
 * @param {object} config
 * @param {Array<object>} config.steps - Step definitions:
 *   { name, endpoint, stream, buildBody, parseResult, onComplete }
 * @param {Function} config.shouldContinue - (stepResults, round) => boolean
 * @param {Function} [config.onRoundStart] - (round) => void
 * @param {Function} [config.onRoundEnd] - (round, stepResults) => void
 * @param {Function} [config.onComplete] - (allResults) => void
 * @param {Function} [config.onError] - (error, step) => void
 * @param {number} [config.maxRounds] - Maximum loop iterations (default: 5)
 */
export function useAgentLoop(config) {
  const {
    steps,
    shouldContinue,
    onRoundStart,
    onRoundEnd,
    onComplete,
    onError,
    maxRounds = 5,
  } = config;

  const [isRunning, setIsRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(null);
  const [currentRound, setCurrentRound] = useState(0);
  const [stepResults, setStepResults] = useState({});
  const [error, setError] = useState(null);
  const abortRef = useRef(null);
  const runningRef = useRef(false);

  const stop = useCallback(() => {
    runningRef.current = false;
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsRunning(false);
    setCurrentStep(null);
  }, []);

  const runStep = useCallback(async (step, body, onNode) => {
    const controller = new AbortController();
    abortRef.current = controller;

    const res = await authFetch(`${API_URL}${step.endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `Step ${step.name} failed: ${res.status}`);
    }

    if (step.stream) {
      // SSE streaming step — collect nodes
      const collectedNodes = [];
      await readSSEStream(res, (raw) => {
        const node = buildFlowNode(raw);
        if (node) {
          collectedNodes.push(node);
          if (onNode) onNode(node, raw);
        }
      });
      return step.parseResult
        ? step.parseResult(collectedNodes)
        : { nodes: collectedNodes };
    } else {
      // JSON response step
      const data = await res.json();
      return step.parseResult ? step.parseResult(data) : data;
    }
  }, []);

  const start = useCallback(async (initialContext = {}) => {
    if (runningRef.current) return;
    runningRef.current = true;
    setIsRunning(true);
    setError(null);

    const allResults = {};
    let round = 0;

    try {
      while (runningRef.current && round < maxRounds) {
        round++;
        setCurrentRound(round);
        if (onRoundStart) onRoundStart(round);

        const roundResults = {};

        for (const step of steps) {
          if (!runningRef.current) break;

          setCurrentStep(step.name);

          // Build request body — step can customize or use defaults
          const body = step.buildBody
            ? step.buildBody({ ...initialContext, round, previousResults: allResults, roundResults })
            : { ...initialContext, round };

          // Skip step if buildBody returns null
          if (body === null) continue;

          const result = await runStep(step, body, step.onNode);
          roundResults[step.name] = result;

          if (step.onComplete) {
            step.onComplete(result, { round, context: initialContext });
          }
        }

        allResults[round] = roundResults;
        if (onRoundEnd) onRoundEnd(round, roundResults);

        // Check if we should continue
        if (!shouldContinue(roundResults, round)) break;
      }

      if (onComplete) onComplete(allResults);
    } catch (err) {
      if (err.name === 'AbortError') {
        // User stopped — not an error
        return;
      }
      console.error('Agent loop error:', err);
      setError(err.message);
      if (onError) onError(err, currentStep);
    } finally {
      runningRef.current = false;
      setIsRunning(false);
      setCurrentStep(null);
      abortRef.current = null;
    }
  }, [steps, shouldContinue, onRoundStart, onRoundEnd, onComplete, onError, maxRounds, runStep, currentStep]);

  return {
    start,
    stop,
    isRunning,
    currentStep,
    currentRound,
    stepResults,
    error,
  };
}

export default useAgentLoop;
