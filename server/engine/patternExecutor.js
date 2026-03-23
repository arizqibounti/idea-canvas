// ── Pattern Executor: State Machine ──────────────────────────
// Walks a pattern's stage graph, executing each stage with the
// right model/prompt, handling branching, looping, fan-out/merge,
// and streaming results via SSE.

const ai = require('../ai/providers');
const { sseHeaders, autoStreamToSSE, streamToSSECollect, geminiStreamToSSE } = require('../utils/sse');
const promptLoader = require('./promptLoader');

// ── Safe expression evaluator (no eval) ──────────────────────

function resolveSlot(path, context) {
  const parts = path.split('.');
  let val = context;
  for (const part of parts) {
    if (val == null) return undefined;
    val = val[part];
  }
  return val;
}

function interpolate(template, context) {
  if (!template || typeof template !== 'string') return template || '';
  return template.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
    const trimmed = path.trim();
    const val = resolveSlot(trimmed, context);
    if (val === undefined || val === null) return '';
    if (typeof val === 'object') return JSON.stringify(val, null, 2);
    return String(val);
  });
}

function evaluateCondition(expression, context) {
  // Simple recursive descent for: val === val, val >= val, &&, ||
  const resolved = expression.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
    const val = resolveSlot(path.trim(), context);
    if (val === undefined || val === null) return 'null';
    if (typeof val === 'boolean') return String(val);
    if (typeof val === 'number') return String(val);
    return JSON.stringify(val);
  });

  // Tokenize and evaluate
  try {
    return evalTokens(resolved.trim());
  } catch {
    return false;
  }
}

function evalTokens(expr) {
  // Handle || (lowest precedence)
  const orParts = splitOnOperator(expr, '||');
  if (orParts.length > 1) return orParts.some(p => evalTokens(p.trim()));

  // Handle &&
  const andParts = splitOnOperator(expr, '&&');
  if (andParts.length > 1) return andParts.every(p => evalTokens(p.trim()));

  // Handle comparison operators
  for (const op of ['===', '!==', '>=', '<=', '>', '<']) {
    const idx = expr.indexOf(op);
    if (idx !== -1) {
      const left = parseValue(expr.slice(0, idx).trim());
      const right = parseValue(expr.slice(idx + op.length).trim());
      switch (op) {
        case '===': return left === right;
        case '!==': return left !== right;
        case '>=': return left >= right;
        case '<=': return left <= right;
        case '>': return left > right;
        case '<': return left < right;
      }
    }
  }

  // Bare value
  return !!parseValue(expr);
}

function splitOnOperator(expr, op) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === '(') depth++;
    if (expr[i] === ')') depth--;
    if (depth === 0 && expr.slice(i, i + op.length) === op) {
      parts.push(current);
      current = '';
      i += op.length - 1;
    } else {
      current += expr[i];
    }
  }
  parts.push(current);
  return parts.length > 1 ? parts : [expr];
}

function parseValue(str) {
  str = str.trim();
  if (str === 'true') return true;
  if (str === 'false') return false;
  if (str === 'null' || str === 'undefined') return null;
  if (str.startsWith('"') && str.endsWith('"')) return str.slice(1, -1);
  if (str.startsWith("'") && str.endsWith("'")) return str.slice(1, -1);
  const num = Number(str);
  if (!isNaN(num) && str !== '') return num;
  return str;
}

// ── Pattern Executor Class ───────────────────────────────────

class PatternExecutor {
  constructor(patternDef, initialContext, res, signal) {
    this.pattern = patternDef;
    this.res = res;
    this.signal = signal;
    this.aborted = false;

    // Build execution context
    this.context = {
      idea: initialContext.idea || '',
      nodes: initialContext.nodes || [],
      mode: initialContext.mode || 'idea',
      round: 0,
      maxRounds: initialContext.maxRounds || patternDef.config?.maxRounds || 5,
      domain: initialContext.domain || '',
      framework: initialContext.resolvedFramework || patternDef.framework || {},
      ...initialContext,
    };

    this.stageHistory = [];
    this.currentStage = null;
    this.checkpointResolve = null;
    this.executionId = `exec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    // Abort on disconnect
    if (signal) {
      signal.addEventListener('abort', () => { this.aborted = true; });
    }
  }

  // ── Main execution loop ──────────────────────────────────

  async execute() {
    this.currentStage = this.pattern.graph.entrypoint;

    while (this.currentStage && !this.aborted) {
      const stageDef = this.pattern.stages[this.currentStage];
      if (!stageDef) {
        this.sendSSE({ _patternError: true, stage: this.currentStage, error: `Stage "${this.currentStage}" not found`, fatal: true });
        break;
      }

      // Progress event
      this.sendSSE({ _patternProgress: true, stage: this.currentStage, type: stageDef.type, round: this.context.round });

      const startTime = Date.now();
      let result = null;
      let error = null;

      try {
        result = await this.executeStage(stageDef, this.currentStage);
      } catch (err) {
        if (err.name === 'AbortError' || this.aborted) break;
        error = err.message;
        if (stageDef.critical !== false) {
          this.sendSSE({ _patternError: true, stage: this.currentStage, error, fatal: true });
          break;
        }
        this.sendSSE({ _patternError: true, stage: this.currentStage, error, fatal: false });
      }

      const duration = Date.now() - startTime;
      this.stageHistory.push({ stage: this.currentStage, type: stageDef.type, timestamp: new Date().toISOString(), duration, error });

      // Store result in context
      if (result !== null && result !== undefined) {
        this.context[this.currentStage] = result;

        // Send stage result for non-streaming stages
        if (!stageDef.stream && stageDef.type !== 'branch' && stageDef.type !== 'fan_out') {
          this.sendSSE({ _patternStageResult: true, stage: this.currentStage, data: result });
        }
      }

      // Terminal stage?
      if (stageDef.terminal) {
        this.currentStage = null;
        break;
      }

      // Find next stage
      this.currentStage = this.findNextStage(this.currentStage, result);
    }

    // Send completion
    this.sendSSE({
      _patternComplete: true,
      executionId: this.executionId,
      totalRounds: this.context.round,
      stagesExecuted: this.stageHistory.length,
    });

    return { finalNodes: this.context.nodes, stageHistory: this.stageHistory };
  }

  // ── Stage dispatcher ─────────────────────────────────────

  async executeStage(stageDef, stageName) {
    switch (stageDef.type) {
      case 'generate': return this.executeGenerate(stageDef, stageName);
      case 'transform': return this.executeTransform(stageDef, stageName);
      case 'score': return this.executeScore(stageDef, stageName);
      case 'branch': return this.executeBranch(stageDef, stageName);
      case 'fan_out': return this.executeFanOut(stageDef, stageName);
      case 'merge': return this.executeMerge(stageDef, stageName);
      case 'filter': return this.executeFilter(stageDef, stageName);
      case 'enrich': return this.executeEnrich(stageDef, stageName);
      case 'loop': return this.executeLoop(stageDef, stageName);
      default:
        throw new Error(`Unknown stage type: ${stageDef.type}`);
    }
  }

  // ── Generate: stream nodes via SSE ───────────────────────

  async executeGenerate(stageDef, stageName) {
    const prompt = this.resolvePrompt(stageDef);
    const userMessage = this.buildUserMessage(stageName);

    const { stream, provider } = await ai.stream({
      model: stageDef.model || 'claude:sonnet',
      system: prompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: stageDef.modelConfig?.maxTokens || 4096,
      signal: this.signal,
      extra: stageDef.modelConfig?.extra,
    });

    // Collect nodes while streaming
    const collectedNodes = [];
    const collectAndForward = (text) => {
      // We let autoStreamToSSE handle the actual SSE writing
      // but we also need to collect nodes for context
    };

    // Use streamToSSECollect to both stream and collect
    if (provider === 'gemini') {
      // Gemini: async iterable
      let buffer = '';
      for await (const chunk of stream) {
        if (this.aborted) break;
        const text = chunk.text || '';
        if (!text) continue;
        buffer += text;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const node = JSON.parse(trimmed);
            this.res.write(`data: ${JSON.stringify(node)}\n\n`);
            if (!node._meta && !node._progress && !node._alternative) {
              collectedNodes.push(node);
            }
          } catch { /* skip non-JSON */ }
        }
      }
      if (buffer.trim()) {
        try {
          const node = JSON.parse(buffer.trim());
          this.res.write(`data: ${JSON.stringify(node)}\n\n`);
          if (!node._meta && !node._progress && !node._alternative) {
            collectedNodes.push(node);
          }
        } catch { /* skip */ }
      }
    } else {
      // Claude: event emitter
      const collected = await streamToSSECollect(this.res, stream);
      collectedNodes.push(...collected);
    }

    return { nodes: collectedNodes, count: collectedNodes.length };
  }

  // ── Transform: call AI, parse JSON ───────────────────────

  async executeTransform(stageDef, stageName) {
    const prompt = this.resolvePrompt(stageDef);
    const userMessage = this.buildUserMessage(stageName);

    const { text } = await ai.call({
      model: stageDef.model || 'claude:sonnet',
      system: prompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: stageDef.modelConfig?.maxTokens || 4096,
      signal: this.signal,
      extra: stageDef.modelConfig?.extra,
    });

    return ai.parseJSON(text);
  }

  // ── Score: transform with dimension aggregation ──────────

  async executeScore(stageDef, stageName) {
    const result = await this.executeTransform(stageDef, stageName);

    // Ensure scores are properly structured
    if (result && !result.overallScore && result.scores) {
      const values = Object.values(result.scores).filter(v => typeof v === 'number');
      result.overallScore = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    }

    return result;
  }

  // ── Branch: evaluate condition, emit checkpoint ──────────

  async executeBranch(stageDef, stageName) {
    const shouldExit = evaluateCondition(stageDef.condition, this.context);

    // Emit checkpoint for client intervention
    const checkpoint = {
      _checkpoint: true,
      executionId: this.executionId,
      stage: stageName,
      round: this.context.round,
      condition: stageDef.condition,
      evaluated: shouldExit,
      nextStage: shouldExit ? stageDef.onTrue : stageDef.onFalse,
      options: ['continue', 'stop'],
    };

    // Add pattern-specific options
    if (!shouldExit && stageDef.onTrue) {
      checkpoint.options.push(`skip_to_${stageDef.onTrue}`);
    }

    this.sendSSE(checkpoint);

    // If looping back, increment round
    if (!shouldExit) {
      this.context.round++;
    }

    // Return the branch decision for findNextStage
    return { _branchResult: shouldExit, nextStage: shouldExit ? stageDef.onTrue : stageDef.onFalse };
  }

  // ── Fan-out: parallel execution ──────────────────────────

  async executeFanOut(stageDef, stageName) {
    const branchResults = await Promise.all(
      stageDef.branches.map(async (branchName) => {
        const branchDef = this.pattern.stages[branchName];
        if (!branchDef) return { branch: branchName, error: 'Stage not found' };
        try {
          const result = await this.executeStage(branchDef, branchName);
          this.context[branchName] = result;
          return { branch: branchName, result };
        } catch (err) {
          return { branch: branchName, error: err.message };
        }
      })
    );

    return { branches: branchResults };
  }

  // ── Merge: combine fan-out results ───────────────────────

  async executeMerge(stageDef, stageName) {
    const sourceResults = stageDef.sources.map(s => this.context[s]).filter(Boolean);

    if (stageDef.strategy === 'concatenate' || !stageDef.strategy) {
      const allNodes = [];
      for (const result of sourceResults) {
        if (result?.nodes) allNodes.push(...result.nodes);
        else if (Array.isArray(result)) allNodes.push(...result);
      }
      return { nodes: allNodes, count: allNodes.length };
    }

    if (stageDef.strategy === 'ai_merge') {
      const mergePrompt = this.resolvePrompt(stageDef);
      const sourceSummary = sourceResults.map((r, i) =>
        `=== SOURCE ${i + 1}: ${stageDef.sources[i]} ===\n${JSON.stringify(r, null, 2)}`
      ).join('\n\n');

      const { stream, provider } = await ai.stream({
        model: stageDef.model || 'claude:sonnet',
        system: mergePrompt || 'Synthesize these analyses into a unified tree. Output _meta first, then nodes.',
        messages: [{ role: 'user', content: `Merge these results:\n\n${sourceSummary}` }],
        maxTokens: stageDef.modelConfig?.maxTokens || 8000,
        signal: this.signal,
      });

      if (provider === 'gemini') {
        await geminiStreamToSSE(this.res, stream);
      } else {
        const collected = await streamToSSECollect(this.res, stream);
        return { nodes: collected, count: collected.length };
      }
    }

    return { nodes: [], count: 0 };
  }

  // ── Filter: prune nodes ──────────────────────────────────

  async executeFilter(stageDef, stageName) {
    if (stageDef.strategy === 'threshold') {
      const threshold = stageDef.threshold || 5.0;
      const scoreField = stageDef.scoreField || 'composite';
      // Get scores from previous score stage
      const scores = this.findLatestScores();
      if (scores) {
        const filtered = this.context.nodes.filter(n => {
          const nodeScore = scores[n.id || n.data?.id];
          return !nodeScore || nodeScore >= threshold;
        });
        this.context.nodes = filtered;
        return { removed: this.context.nodes.length - filtered.length, remaining: filtered.length };
      }
    }

    if (stageDef.strategy === 'classify') {
      const result = await this.executeTransform(stageDef, stageName);
      if (result?.keep) {
        const keepIds = new Set(result.keep);
        this.context.nodes = this.context.nodes.filter(n => keepIds.has(n.id || n.data?.id));
      }
      return result;
    }

    return { unchanged: true };
  }

  // ── Enrich: research + knowledge context ─────────────────

  async executeEnrich(stageDef, stageName) {
    try {
      if (stageDef.source === 'research') {
        const research = require('../ai/research');
        const brief = await research.research({
          topic: this.context.idea,
          depth: stageDef.researchConfig?.depth || 'deep',
          context: JSON.stringify(this.context.nodes.slice(0, 10)),
        });
        this.context.enrichment = brief;
        return brief;
      }

      if (stageDef.source === 'knowledge') {
        const { getKnowledgeContext } = require('../gateway/knowledge');
        const knowledge = await getKnowledgeContext(this.context.userId, this.context.idea);
        this.context.knowledgeContext = knowledge;
        return knowledge;
      }
    } catch (err) {
      // Enrich is non-critical by default
      return { error: err.message, source: stageDef.source };
    }

    return null;
  }

  // ── Loop: sugar for body[] + branch ──────────────────────

  async executeLoop(stageDef, stageName) {
    const maxIter = stageDef.maxIterations || this.context.maxRounds;
    let iteration = 0;

    while (iteration < maxIter && !this.aborted) {
      iteration++;
      this.context.round = iteration;

      for (const bodyStage of stageDef.body) {
        if (this.aborted) break;
        const bodyDef = this.pattern.stages[bodyStage];
        if (!bodyDef) continue;

        this.sendSSE({ _patternProgress: true, stage: bodyStage, type: bodyDef.type, round: iteration });
        const result = await this.executeStage(bodyDef, bodyStage);
        this.context[bodyStage] = result;

        if (!bodyDef.stream && bodyDef.type !== 'branch') {
          this.sendSSE({ _patternStageResult: true, stage: bodyStage, data: result });
        }
      }

      // Check exit condition
      if (stageDef.exitCondition && evaluateCondition(stageDef.exitCondition, this.context)) {
        break;
      }
    }

    return { iterations: iteration, exitTo: stageDef.exitTo };
  }

  // ── Helpers ──────────────────────────────────────────────

  resolvePrompt(stageDef) {
    // Try promptKey from promptStore first (admin-editable)
    if (stageDef.promptKey) {
      const stored = promptLoader.get(stageDef.promptKey);
      if (stored && stored.variant !== 'missing') {
        return interpolate(stored.text, this.context);
      }
    }
    // Fall back to inline template
    return interpolate(stageDef.promptFallback || stageDef.mergePrompt || '', this.context);
  }

  buildUserMessage(stageName) {
    const parts = [];

    if (this.context.idea) {
      parts.push(`Input: "${this.context.idea}"`);
    }
    if (this.context.round > 0) {
      parts.push(`Round: ${this.context.round}`);
    }

    // Include relevant prior stage results
    const stageDef = this.pattern.stages[stageName];
    if (stageDef) {
      // For respond/strengthen stages, include critiques
      if (this.context.critique) {
        parts.push(`\nCritiques to address:\n${JSON.stringify(this.context.critique, null, 2)}`);
      }

      // Include current nodes
      if (this.context.nodes?.length > 0) {
        const compact = this.context.nodes.map(n => {
          const d = n.data || n;
          return { id: d.id || n.id, type: d.type, label: d.label, reasoning: d.reasoning, parentIds: d.parentIds };
        });
        parts.push(`\nCurrent tree (${compact.length} nodes):\n${JSON.stringify(compact, null, 2)}`);
      }

      // Include enrichment if available
      if (this.context.enrichment?.brief) {
        parts.push(`\nResearch context:\n${this.context.enrichment.brief}`);
      }

      // Include score feedback
      if (this.context.score) {
        parts.push(`\nPrior score: ${JSON.stringify(this.context.score)}`);
      }
    }

    return parts.join('\n');
  }

  findNextStage(currentStage, result) {
    // Branch stages return their own next stage
    if (result?._branchResult !== undefined) {
      return result.nextStage;
    }

    // Loop stages return exitTo
    if (result?.exitTo) {
      return result.exitTo;
    }

    // Fan-out stages go to mergeTo
    const stageDef = this.pattern.stages[currentStage];
    if (stageDef?.type === 'fan_out') {
      return stageDef.mergeTo;
    }

    // Follow graph edges
    const edges = this.pattern.graph.edges || [];
    const outgoing = edges.filter(e => e.from === currentStage);

    if (outgoing.length === 0) return null;
    if (outgoing.length === 1) return outgoing[0].to;

    // Multiple edges: pick the one without a condition, or 'exit' condition
    const defaultEdge = outgoing.find(e => !e.condition) || outgoing.find(e => e.condition === 'exit') || outgoing[0];
    return defaultEdge.to;
  }

  findLatestScores() {
    // Look for the most recent score stage result in context
    for (const [key, val] of Object.entries(this.context)) {
      if (val?.nodeScores || val?.scoresByNode || val?.scores) {
        return val.nodeScores || val.scoresByNode || val.scores;
      }
    }
    return null;
  }

  sendSSE(data) {
    if (this.aborted) return;
    try {
      this.res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch { /* client disconnected */ }
  }

  abort() {
    this.aborted = true;
  }
}

module.exports = { PatternExecutor, interpolate, evaluateCondition };
