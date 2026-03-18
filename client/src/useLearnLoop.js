// ── Learn Loop Hook ──────────────────────────────────────────
// Client-orchestrated comprehension loop: probe → evaluate → adapt.
// Follows the useAutoRefine.js pattern.

import { useState, useCallback, useRef, useEffect } from 'react';
import { buildFlowNode, readSSEStream } from './useCanvasMode';
import { authFetch } from './api';

const API_URL = process.env.REACT_APP_API_URL || '';

export function useLearnLoop({ rawNodesRef, applyLayout, drillStackRef, dynamicTypesRef, yjsSyncRef, setNodeCount }) {
  const [isLearning, setIsLearning] = useState(false);
  const [learnProgress, setLearnProgress] = useState(null);
  const [masteryMap, setMasteryMap] = useState(() => {
    try {
      const stored = localStorage.getItem('tc_learn_mastery');
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  }); // { conceptId: { score, label, probeCount, lastProbe } }
  // Persist mastery to localStorage
  useEffect(() => {
    try { localStorage.setItem('tc_learn_mastery', JSON.stringify(masteryMap)); }
    catch { /* quota exceeded, ignore */ }
  }, [masteryMap]);

  const learnAbortRef = useRef(null);
  const answerResolverRef = useRef(null); // resolves when user submits answer

  // Serialize raw nodes for API calls
  const serializeNodes = useCallback(() => {
    return rawNodesRef.current.map(n => ({
      id: n.id,
      type: n.data?.type || n.type,
      label: n.data?.label || n.label,
      reasoning: n.data?.reasoning || n.reasoning,
      parentIds: n.data?.parentIds || [],
      difficulty: n.data?.difficulty,
    }));
  }, [rawNodesRef]);

  // Find next concept to probe (topological order, prerequisites first)
  const pickNextConcept = useCallback((targetMastery) => {
    const nodes = serializeNodes();
    const concepts = nodes.filter(n =>
      n.type === 'concept' || n.type === 'prerequisite'
    );

    // Sort by difficulty (lower first) then by depth in tree
    concepts.sort((a, b) => (a.difficulty || 1) - (b.difficulty || 1));

    for (const concept of concepts) {
      const mastery = masteryMap[concept.id]?.score || 0;
      if (mastery >= targetMastery) continue; // already mastered

      // Check if all prerequisites are met
      const prereqsMet = (concept.parentIds || []).every(pid => {
        const parent = nodes.find(n => n.id === pid);
        if (!parent) return true; // seed or missing parent
        if (parent.type !== 'concept' && parent.type !== 'prerequisite') return true;
        return (masteryMap[pid]?.score || 0) >= targetMastery;
      });

      if (prereqsMet) return concept;
    }

    return null; // all concepts mastered or blocked
  }, [serializeNodes, masteryMap]);

  // Check if a node is a milestone
  const findNextMilestone = useCallback((completedConceptIds) => {
    const nodes = serializeNodes();
    const milestones = nodes.filter(n => n.type === 'milestone');

    for (const milestone of milestones) {
      // Check if all parent concepts are in completedConceptIds
      const allParentsMastered = (milestone.parentIds || []).every(
        pid => completedConceptIds.has(pid)
      );
      if (allParentsMastered && !completedConceptIds.has(milestone.id)) {
        return milestone;
      }
    }
    return null;
  }, [serializeNodes]);

  // ── Main learning loop ─────────────────────────────────────
  const handleStartLearn = useCallback(async (topic, targetMastery = 7, onProgress, { startConceptId } = {}) => {
    if (isLearning) return;
    setIsLearning(true);
    setLearnProgress(null);

    const abortController = new AbortController();
    learnAbortRef.current = abortController;

    const completedConcepts = new Set();
    const probeHistory = [];
    let forcedConceptId = startConceptId || null;

    try {
      let iterations = 0;
      const maxIterations = 50; // safety limit

      while (iterations < maxIterations) {
        if (abortController.signal.aborted) break;
        iterations++;

        // Check for milestone
        const milestone = findNextMilestone(completedConcepts);
        if (milestone) {
          // Socratic challenge at milestone
          const socraticStatus = {
            status: 'socratic',
            milestoneId: milestone.id,
            milestoneLabel: milestone.label || milestone.reasoning,
            detail: 'Preparing milestone challenge...',
          };
          setLearnProgress(socraticStatus);
          onProgress?.(socraticStatus);

          try {
            const socRes = await authFetch(`${API_URL}/api/learn/socratic`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                nodes: serializeNodes(),
                topic,
                milestoneId: milestone.id,
                masteryMap,
              }),
              signal: abortController.signal,
            });

            if (socRes.ok) {
              const challenge = await socRes.json();
              const challengeStatus = {
                status: 'socratic',
                milestoneId: milestone.id,
                milestoneLabel: milestone.label,
                challenge: challenge.challenge,
                coveredConcepts: challenge.coveredConcepts,
                followUpQuestions: challenge.followUpQuestions,
              };
              setLearnProgress(challengeStatus);
              onProgress?.(challengeStatus);

              // Wait for user answer
              const answer = await new Promise((resolve) => {
                answerResolverRef.current = resolve;
              });
              if (abortController.signal.aborted) break;

              // Evaluate milestone answer (reuse evaluate endpoint)
              const evalRes = await authFetch(`${API_URL}/api/learn/evaluate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  nodes: serializeNodes(),
                  topic,
                  conceptId: milestone.id,
                  probe: { question: challenge.challenge, expectedInsight: challenge.expectedDepth },
                  answer,
                  currentMastery: 0,
                }),
                signal: abortController.signal,
              });

              if (evalRes.ok) {
                const evaluation = await evalRes.json();
                completedConcepts.add(milestone.id);

                const feedbackStatus = {
                  status: 'milestone_feedback',
                  milestoneId: milestone.id,
                  milestoneLabel: milestone.label,
                  mastery: evaluation.mastery,
                  feedback: evaluation.feedback,
                  correct: evaluation.correct,
                };
                setLearnProgress(feedbackStatus);
                onProgress?.(feedbackStatus);

                // Wait for user to continue
                await new Promise((resolve) => { answerResolverRef.current = resolve; });
                if (abortController.signal.aborted) break;
              }
            }
          } catch (err) {
            if (err.name === 'AbortError') break;
            console.error('Socratic challenge error:', err.message);
            completedConcepts.add(milestone.id); // skip on error
          }
          continue;
        }

        // Pick next concept (or use forced concept on first pass)
        let concept;
        if (forcedConceptId) {
          const nodes = serializeNodes();
          concept = nodes.find(n => n.id === forcedConceptId);
          forcedConceptId = null; // only force once
        }
        if (!concept) concept = pickNextConcept(targetMastery);
        if (!concept) {
          // All concepts mastered!
          const completeStatus = {
            status: 'complete',
            masteryMap: { ...masteryMap },
            totalConcepts: completedConcepts.size,
            detail: 'All concepts mastered!',
          };
          setLearnProgress(completeStatus);
          onProgress?.(completeStatus);
          break;
        }

        const currentMastery = masteryMap[concept.id]?.score || 0;

        // ── Step 0: Teach concept (skip if already partially learned) ──
        if (currentMastery < 5) {
          const teachingStatus = {
            status: 'teaching',
            conceptId: concept.id,
            conceptLabel: concept.label,
            conceptReasoning: concept.reasoning,
            mastery: currentMastery,
            detail: 'Preparing lesson...',
          };
          setLearnProgress(teachingStatus);
          onProgress?.(teachingStatus);

          try {
            const teachRes = await authFetch(`${API_URL}/api/learn/teach`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                nodes: serializeNodes(),
                topic,
                conceptId: concept.id,
              }),
              signal: abortController.signal,
            });

            if (teachRes.ok) {
              const teachContent = await teachRes.json();
              const lessonStatus = {
                status: 'teaching',
                conceptId: concept.id,
                conceptLabel: concept.label,
                teachContent,
                mastery: currentMastery,
              };
              setLearnProgress(lessonStatus);
              onProgress?.(lessonStatus);

              // Wait for user to click "Ready for Quiz"
              await new Promise((resolve) => { answerResolverRef.current = resolve; });
              if (abortController.signal.aborted) break;
            }
          } catch (err) {
            if (err.name === 'AbortError') break;
            console.warn('Teach phase failed, skipping to probe:', err.message);
          }
        }

        // ── Step 1: Generate probe ────────────────────────────
        const probingStatus = {
          status: 'generating_probe',
          conceptId: concept.id,
          conceptLabel: concept.label,
          conceptReasoning: concept.reasoning,
          mastery: currentMastery,
          detail: 'Generating question...',
        };
        setLearnProgress(probingStatus);
        onProgress?.(probingStatus);

        const probeRes = await authFetch(`${API_URL}/api/learn/probe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nodes: serializeNodes(),
            topic,
            conceptId: concept.id,
            mastery: currentMastery,
            priorProbes: probeHistory.filter(p => p.conceptId === concept.id),
          }),
          signal: abortController.signal,
        });

        if (!probeRes.ok) throw new Error(`Probe error: ${probeRes.status}`);
        const probe = await probeRes.json();

        // ── Step 2: Show probe, wait for answer ───────────────
        const probeStatus = {
          status: 'probing',
          conceptId: concept.id,
          conceptLabel: concept.label,
          conceptReasoning: concept.reasoning,
          mastery: currentMastery,
          probe,
        };
        setLearnProgress(probeStatus);
        onProgress?.(probeStatus);

        // Wait for user to submit answer
        const answer = await new Promise((resolve) => {
          answerResolverRef.current = resolve;
        });
        if (abortController.signal.aborted) break;

        // ── Step 3: Evaluate answer ───────────────────────────
        const evaluatingStatus = {
          status: 'evaluating',
          conceptId: concept.id,
          conceptLabel: concept.label,
          detail: 'Evaluating your answer...',
        };
        setLearnProgress(evaluatingStatus);
        onProgress?.(evaluatingStatus);

        const evalRes = await authFetch(`${API_URL}/api/learn/evaluate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nodes: serializeNodes(),
            topic,
            conceptId: concept.id,
            probe,
            answer,
            currentMastery,
          }),
          signal: abortController.signal,
        });

        if (!evalRes.ok) throw new Error(`Evaluate error: ${evalRes.status}`);
        const evaluation = await evalRes.json();

        // Update mastery map
        const newMastery = {
          score: evaluation.mastery,
          label: concept.label,
          probeCount: (masteryMap[concept.id]?.probeCount || 0) + 1,
          lastProbe: Date.now(),
        };
        setMasteryMap(prev => ({ ...prev, [concept.id]: newMastery }));

        probeHistory.push({ conceptId: concept.id, question: probe.question, mastery: evaluation.mastery });

        if (evaluation.mastery >= targetMastery) {
          completedConcepts.add(concept.id);
        }

        // ── Step 4: Show feedback ─────────────────────────────
        const feedbackStatus = {
          status: 'feedback',
          conceptId: concept.id,
          conceptLabel: concept.label,
          mastery: evaluation.mastery,
          correct: evaluation.correct,
          feedback: evaluation.feedback,
          correctAnswer: evaluation.correctAnswer,
          misconceptions: evaluation.misconceptions,
          nextAction: evaluation.nextAction,
          prerequisiteGap: evaluation.prerequisiteGap,
        };
        setLearnProgress(feedbackStatus);
        onProgress?.(feedbackStatus);

        // Wait for user to continue or request adaptation
        const continueAction = await new Promise((resolve) => {
          answerResolverRef.current = resolve;
        });
        if (abortController.signal.aborted) break;

        // ── Step 5: Adapt if needed ───────────────────────────
        if (continueAction === 'explain_differently' || evaluation.nextAction === 'explain_differently') {
          const adaptingStatus = {
            status: 'adapting',
            conceptId: concept.id,
            conceptLabel: concept.label,
            detail: 'Generating alternative explanation...',
          };
          setLearnProgress(adaptingStatus);
          onProgress?.(adaptingStatus);

          const adaptRes = await authFetch(`${API_URL}/api/learn/adapt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              nodes: serializeNodes(),
              topic,
              conceptId: concept.id,
              evaluation,
              mastery: evaluation.mastery,
              dynamicTypes: dynamicTypesRef?.current || undefined,
            }),
            signal: abortController.signal,
          });

          if (adaptRes.ok) {
            const existingDynConfig = rawNodesRef.current[0]?.data?.dynamicConfig || null;
            const preAdaptCount = rawNodesRef.current.length;

            await readSSEStream(adaptRes, (nodeData) => {
              if (nodeData._progress) {
                setLearnProgress(prev => ({ ...prev, detail: nodeData.stage }));
                return;
              }
              if (nodeData.id && !nodeData._progress) {
                const flowNode = buildFlowNode(nodeData);
                if (existingDynConfig) flowNode.data.dynamicConfig = existingDynConfig;
                rawNodesRef.current = [...rawNodesRef.current, flowNode];
                yjsSyncRef?.current?.addNodeToYjs(flowNode);
              }
              applyLayout(rawNodesRef.current, drillStackRef?.current);
              setNodeCount?.(rawNodesRef.current.length);
            });

            // Collect adapted node content for inline summary
            const adaptedNodes = rawNodesRef.current.slice(preAdaptCount);
            const adaptSummary = adaptedNodes
              .filter(n => n.data?.reasoning)
              .map(n => `**${n.data.label}:** ${n.data.reasoning}`)
              .join('\n\n');

            if (adaptSummary) {
              const adaptDoneStatus = {
                status: 'adapt_summary',
                conceptId: concept.id,
                conceptLabel: concept.label,
                adaptSummary,
                detail: 'Here is an alternative explanation:',
              };
              setLearnProgress(adaptDoneStatus);
              onProgress?.(adaptDoneStatus);

              // Wait for user to continue before looping
              await new Promise(resolve => { answerResolverRef.current = resolve; });
              if (abortController.signal.aborted) break;
            }
          } else {
            // Brief pause on failure then continue loop
            await new Promise(r => setTimeout(r, 400));
          }
        }

        // Brief pause between concepts
        await new Promise(r => setTimeout(r, 300));
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        const errStatus = { status: 'error', error: err.message };
        setLearnProgress(errStatus);
        onProgress?.(errStatus);
      }
    } finally {
      setIsLearning(false);
      learnAbortRef.current = null;
      applyLayout(rawNodesRef.current, drillStackRef?.current);
      onProgress?.({ status: 'done', masteryMap: { ...masteryMap } });
    }
  }, [isLearning, rawNodesRef, applyLayout, drillStackRef, dynamicTypesRef, yjsSyncRef, setNodeCount, serializeNodes, pickNextConcept, findNextMilestone, masteryMap]);

  const handleStopLearn = useCallback(() => {
    if (learnAbortRef.current) {
      learnAbortRef.current.abort();
      learnAbortRef.current = null;
    }
    // Resolve any pending answer promise
    if (answerResolverRef.current) {
      answerResolverRef.current = null;
    }
    setIsLearning(false);
  }, []);

  const submitAnswer = useCallback((answer) => {
    if (answerResolverRef.current) {
      const resolve = answerResolverRef.current;
      answerResolverRef.current = null;
      resolve(answer);
    }
  }, []);

  const continueLoop = useCallback(() => {
    if (answerResolverRef.current) {
      const resolve = answerResolverRef.current;
      answerResolverRef.current = null;
      resolve('continue');
    }
  }, []);

  const requestExplainDifferently = useCallback(() => {
    if (answerResolverRef.current) {
      const resolve = answerResolverRef.current;
      answerResolverRef.current = null;
      resolve('explain_differently');
    }
  }, []);

  const skipConcept = useCallback((conceptId) => {
    setMasteryMap(prev => ({ ...prev, [conceptId]: { score: -1, probeCount: 0, skipped: true } }));
    if (answerResolverRef.current) {
      const resolve = answerResolverRef.current;
      answerResolverRef.current = null;
      resolve('continue');
    }
  }, []);

  const requestHint = useCallback(() => {
    // Don't resolve the answer promise — just update UI to show hint
    setLearnProgress(prev => prev ? { ...prev, showHint: (prev.showHint || 0) + 1 } : prev);
  }, []);

  return {
    isLearning,
    learnProgress,
    masteryMap,
    handleStartLearn,
    handleStopLearn,
    submitAnswer,
    continueLoop,
    requestExplainDifferently,
    skipConcept,
    requestHint,
  };
}
