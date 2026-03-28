// ── Task Scheduler ───────────────────────────────────────────
// Cron-based recurring tasks that run AI operations on sessions.
// Persists to Firestore with in-memory fallback (same pattern as sessions.js).

const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

// ── Persistence layer ────────────────────────────────────────
let db = null;
let useFirestore = false;
const memoryStore = new Map();
const activeTimers = new Map();
const COLLECTION = 'scheduled_tasks';
const LOCAL_FILE = path.join(__dirname, '..', '.scheduled-tasks.json');

function initFirestore() {
  try {
    const { Firestore } = require('@google-cloud/firestore');
    db = new Firestore();
    db.collection(COLLECTION).limit(1).get()
      .then(() => {
        useFirestore = true;
        console.log('Scheduler: Firestore connected');
        // Restore and reschedule persisted tasks
        restoreAllTasks();
      })
      .catch(() => {
        console.log('Scheduler: Firestore unavailable — using local file');
        restoreFromFile();
      });
  } catch {
    console.log('Scheduler: Firestore SDK not configured — using local file');
    restoreFromFile();
  }
}

initFirestore();

async function restoreAllTasks() {
  if (!useFirestore) return;
  try {
    const snapshot = await db.collection(COLLECTION).where('enabled', '==', true).get();
    let count = 0;
    snapshot.forEach(doc => {
      const task = { id: doc.id, ...doc.data() };
      memoryStore.set(task.id, task);
      if (task.schedule?.cron) {
        scheduleTask(task);
        count++;
      }
    });
    if (count) console.log(`Scheduler: restored ${count} active tasks`);
  } catch (err) {
    console.error('Scheduler: failed to restore tasks:', err.message);
  }
}

// File-based persistence for local dev (no Firestore)
function saveToFile() {
  if (useFirestore) return;
  try {
    const tasks = Array.from(memoryStore.values());
    fs.writeFileSync(LOCAL_FILE, JSON.stringify(tasks, null, 2));
  } catch {}
}

function restoreFromFile() {
  if (useFirestore) return;
  try {
    if (!fs.existsSync(LOCAL_FILE)) return;
    const tasks = JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8'));
    let count = 0;
    for (const task of tasks) {
      memoryStore.set(task.id, task);
      if (task.enabled && task.schedule?.cron) {
        scheduleTask(task);
        count++;
      }
    }
    if (count) console.log(`Scheduler: restored ${count} tasks from local file`);
  } catch (err) {
    console.warn('Scheduler: failed to restore from file:', err.message);
  }
}

async function saveTask(task) {
  memoryStore.set(task.id, task);
  if (useFirestore) {
    try {
      await db.collection(COLLECTION).doc(task.id).set(task);
    } catch (err) {
      console.warn('Scheduler: failed to persist task:', err.message);
    }
  }
  saveToFile(); // local fallback
}

async function removeTask(taskId) {
  memoryStore.delete(taskId);
  saveToFile(); // local fallback
  if (useFirestore) {
    try {
      await db.collection(COLLECTION).doc(taskId).delete();
    } catch {}
  }
}

// ── Task CRUD ────────────────────────────────────────────────

async function createTask(userId, taskDef) {
  const task = {
    id: uuidv4(),
    userId,
    name: taskDef.name || 'Untitled Task',
    description: taskDef.description || '',
    type: taskDef.type || 'custom', // generate | research | debate | refine | custom
    prompt: taskDef.prompt || '',
    sessionId: taskDef.sessionId || null,
    mode: taskDef.mode || 'idea',
    schedule: taskDef.schedule || null, // { cron: '0 9 * * 1-5' }
    enabled: taskDef.enabled !== false,
    config: taskDef.config || {},
    lastRunAt: null,
    lastRunStatus: null, // 'success' | 'error' | 'running'
    lastRunResult: null,
    runCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await saveTask(task);

  if (task.enabled && task.schedule?.cron) {
    scheduleTask(task);
  }

  return task;
}

function getTask(taskId) {
  return memoryStore.get(taskId) || null;
}

function listTasks(userId) {
  return Array.from(memoryStore.values())
    .filter(t => t.userId === userId)
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

async function updateTask(taskId, updates) {
  const task = memoryStore.get(taskId);
  if (!task) return null;

  Object.assign(task, updates, { updatedAt: new Date().toISOString() });
  await saveTask(task);

  // Reschedule if schedule or enabled changed
  if ('schedule' in updates || 'enabled' in updates) {
    clearScheduledTask(taskId);
    if (task.enabled && task.schedule?.cron) {
      scheduleTask(task);
    }
  }

  return task;
}

async function deleteTask(taskId) {
  clearScheduledTask(taskId);
  await removeTask(taskId);
}

// ── Cron Scheduling ──────────────────────────────────────────

function parseCron(cronExpr) {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  return { minute: parts[0], hour: parts[1], dom: parts[2], month: parts[3], dow: parts[4] };
}

function shouldRunNow(cronExpr) {
  const cron = parseCron(cronExpr);
  if (!cron) return false;

  const now = new Date();
  const minute = now.getMinutes();
  const hour = now.getHours();
  const dom = now.getDate();
  const month = now.getMonth() + 1;
  const dow = now.getDay();

  function matches(field, value) {
    if (field === '*') return true;
    if (field.startsWith('*/')) return value % parseInt(field.slice(2)) === 0;
    if (field.includes(',')) return field.split(',').map(Number).includes(value);
    if (field.includes('-')) {
      const [lo, hi] = field.split('-').map(Number);
      return value >= lo && value <= hi;
    }
    return parseInt(field) === value;
  }

  return matches(cron.minute, minute) && matches(cron.hour, hour) &&
         matches(cron.dom, dom) && matches(cron.month, month) && matches(cron.dow, dow);
}

function scheduleTask(task) {
  clearScheduledTask(task.id); // clear any existing timer

  const timer = setInterval(() => {
    if (shouldRunNow(task.schedule.cron)) {
      const current = memoryStore.get(task.id);
      if (current && current.enabled && current.lastRunStatus !== 'running') {
        executeTask(task.id);
      }
    }
  }, 60000); // check every minute

  activeTimers.set(task.id, timer);
  console.log(`Scheduler: "${task.name}" active (${task.schedule.cron})`);
}

function clearScheduledTask(taskId) {
  const timer = activeTimers.get(taskId);
  if (timer) {
    clearInterval(timer);
    activeTimers.delete(taskId);
  }
}

// ── Task Execution ───────────────────────────────────────────

async function executeTask(taskId) {
  const task = memoryStore.get(taskId);
  if (!task) return { error: 'Task not found' };

  task.lastRunAt = new Date().toISOString();
  task.lastRunStatus = 'running';
  task.runCount++;
  await saveTask(task);

  try {
    const ai = require('../ai/providers');
    const sessions = require('../gateway/sessions');
    let result;

    // Load session context if task is session-linked
    let sessionNodes = [];
    let sessionIdea = task.prompt;
    if (task.sessionId) {
      try {
        const session = await sessions.loadSession(task.sessionId);
        if (session) {
          sessionNodes = session.nodes || [];
          sessionIdea = session.idea || task.prompt;
        }
      } catch {}
    }

    // Build tree context string from session nodes
    const treeContext = sessionNodes.length > 0
      ? sessionNodes.map(n => {
          const d = n.data || n;
          return `[${d.type || 'node'}] ${d.label || ''}: ${(d.reasoning || '').slice(0, 150)}`;
        }).join('\n')
      : '';

    // Execute based on task type
    switch (task.type) {
      case 'research': {
        const prompt = treeContext
          ? `Research the following topic in the context of this existing thinking tree:\n\nTOPIC: ${task.prompt}\n\nEXISTING TREE:\n${treeContext}\n\nProvide new findings, updated data, and actionable insights that build on or challenge the existing analysis.`
          : task.prompt;
        const res = await ai.call({
          model: 'claude:sonnet',
          system: 'You are a research assistant. Provide a concise, actionable research brief with specific data points, trends, and sources. Format with clear sections and bullet points.',
          messages: [{ role: 'user', content: prompt }],
          maxTokens: 4096,
        });
        result = { type: 'research', summary: (res?.text || '').slice(0, 2000), fullText: res?.text };
        break;
      }

      case 'refine': {
        if (!sessionNodes.length) {
          result = { type: 'refine', error: 'No session linked — refine requires an existing tree.' };
          break;
        }
        const res = await ai.call({
          model: 'claude:sonnet',
          system: 'You are a senior product strategist reviewing a thinking tree. Identify the 3-5 weakest nodes and provide specific, actionable improvements for each. Format as JSON array: [{"nodeId":"...","currentLabel":"...","improvedLabel":"...","improvedReasoning":"...","issue":"..."}]',
          messages: [{ role: 'user', content: `Review this thinking tree about "${sessionIdea}":\n\n${treeContext}\n\nIdentify weak nodes and provide improvements.` }],
          maxTokens: 4096,
        });
        // Try to parse improvements and apply to session
        try {
          const text = res?.text || '';
          const jsonMatch = text.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const improvements = JSON.parse(jsonMatch[0]);
            const updatedNodes = [...sessionNodes];
            let appliedCount = 0;
            for (const imp of improvements) {
              const node = updatedNodes.find(n => (n.data?.label || n.label) === imp.currentLabel || n.id === imp.nodeId);
              if (node) {
                const d = node.data || node;
                if (imp.improvedLabel) d.label = imp.improvedLabel;
                if (imp.improvedReasoning) d.reasoning = imp.improvedReasoning;
                appliedCount++;
              }
            }
            if (appliedCount > 0 && task.sessionId) {
              await sessions.updateSession(task.sessionId, { nodes: updatedNodes });
            }
            result = { type: 'refine', summary: `Refined ${appliedCount} nodes`, improvements, appliedCount };
          } else {
            result = { type: 'refine', summary: text.slice(0, 1000) };
          }
        } catch {
          result = { type: 'refine', summary: (res?.text || '').slice(0, 1000) };
        }
        break;
      }

      case 'debate': {
        if (!sessionNodes.length) {
          result = { type: 'debate', error: 'No session linked — debate requires an existing tree.' };
          break;
        }
        const res = await ai.call({
          model: 'claude:sonnet',
          system: 'You are a sharp critic reviewing a product thinking tree. Your job is to find the 3-5 most critical weaknesses, contradictions, or blind spots. Be specific — reference exact nodes. Then provide concrete suggestions for each critique. Format clearly with numbered critiques.',
          messages: [{ role: 'user', content: `Critically analyze this thinking tree about "${sessionIdea}":\n\n${treeContext}` }],
          maxTokens: 4096,
        });
        result = { type: 'debate', summary: (res?.text || '').slice(0, 2000), fullText: res?.text };
        break;
      }

      case 'pipeline': {
        // Chained operations: research → refine → summarize
        const steps = task.config?.steps || ['research', 'refine', 'summarize'];
        const stepResults = [];

        for (const step of steps) {
          switch (step) {
            case 'research': {
              const res = await ai.call({
                model: 'claude:sonnet',
                system: 'You are a research assistant. Provide updated findings on the topic.',
                messages: [{ role: 'user', content: `Research update for "${sessionIdea}": ${task.prompt}` }],
                maxTokens: 2048,
              });
              stepResults.push({ step: 'research', summary: (res?.text || '').slice(0, 500) });
              break;
            }
            case 'refine': {
              if (!sessionNodes.length) { stepResults.push({ step: 'refine', summary: 'Skipped — no session' }); break; }
              const res = await ai.call({
                model: 'claude:sonnet',
                system: 'Identify the 3 weakest nodes in this tree and suggest improvements. Be brief.',
                messages: [{ role: 'user', content: `Tree: ${treeContext}` }],
                maxTokens: 1024,
              });
              stepResults.push({ step: 'refine', summary: (res?.text || '').slice(0, 500) });
              break;
            }
            case 'summarize': {
              const priorContext = stepResults.map(s => `[${s.step}]: ${s.summary}`).join('\n\n');
              const res = await ai.call({
                model: 'claude:sonnet',
                system: 'Create a concise executive summary of the following task results. Use bullet points. Include key findings, actions needed, and any critical issues.',
                messages: [{ role: 'user', content: `Task: ${task.name}\nSession: ${sessionIdea}\n\nResults:\n${priorContext}` }],
                maxTokens: 1024,
              });
              stepResults.push({ step: 'summarize', summary: (res?.text || '').slice(0, 1000) });
              break;
            }
          }
        }
        result = { type: 'pipeline', steps: stepResults, summary: stepResults.map(s => `[${s.step}] ${s.summary.slice(0, 100)}`).join('\n') };
        break;
      }

      case 'iterate_and_export': {
        // ── Full pipeline: iterate the tree + export to Google Doc ──
        // config.iterateWith: 'refine' | 'debate' | 'experiment' | 'rotate'
        // config.exportTo: 'google_doc' | 'email' | 'both'
        if (!sessionNodes.length) {
          result = { type: 'iterate_and_export', error: 'No session linked — requires an existing tree.' };
          break;
        }

        const iterateWith = task.config?.iterateWith || 'refine';
        const exportTo = task.config?.exportTo || 'google_doc';
        const stepResults = [];

        // Determine which iteration to run (rotate = cycle through)
        let iterationType = iterateWith;
        if (iterateWith === 'rotate') {
          const rotation = ['refine', 'debate', 'refine']; // refine-heavy rotation
          iterationType = rotation[task.runCount % rotation.length];
        }

        // Step 1: Iterate the tree
        try {
          const iteratePrompt = iterationType === 'debate'
            ? `Critically analyze this thinking tree about "${sessionIdea}" and identify 3-5 weaknesses:\n\n${treeContext}`
            : `Review this thinking tree about "${sessionIdea}". Identify 3-5 weak nodes and provide improvements as JSON: [{"nodeId":"...","currentLabel":"...","improvedLabel":"...","improvedReasoning":"..."}]\n\n${treeContext}`;

          const iterateSystem = iterationType === 'debate'
            ? 'You are a sharp critic. Find weaknesses, contradictions, and blind spots. Be specific.'
            : 'You are a senior strategist. Improve weak nodes. Return JSON array of improvements.';

          const iterRes = await ai.call({
            model: 'claude:sonnet',
            system: iterateSystem,
            messages: [{ role: 'user', content: iteratePrompt }],
            maxTokens: 4096,
          });

          const iterText = iterRes?.text || '';

          // Try to apply improvements if refine
          if (iterationType === 'refine') {
            try {
              const jsonMatch = iterText.match(/\[[\s\S]*\]/);
              if (jsonMatch) {
                const improvements = JSON.parse(jsonMatch[0]);
                const updatedNodes = [...sessionNodes];
                let appliedCount = 0;
                for (const imp of improvements) {
                  const node = updatedNodes.find(n => (n.data?.label || n.label) === imp.currentLabel || n.id === imp.nodeId);
                  if (node) {
                    const d = node.data || node;
                    if (imp.improvedLabel) d.label = imp.improvedLabel;
                    if (imp.improvedReasoning) d.reasoning = imp.improvedReasoning;
                    appliedCount++;
                  }
                }
                if (appliedCount > 0 && task.sessionId) {
                  await sessions.updateSession(task.sessionId, { nodes: updatedNodes });
                  sessionNodes = updatedNodes; // use updated nodes for export
                }
                stepResults.push({ step: 'iterate', type: iterationType, summary: `Refined ${appliedCount} nodes`, appliedCount });
              } else {
                stepResults.push({ step: 'iterate', type: iterationType, summary: iterText.slice(0, 500) });
              }
            } catch {
              stepResults.push({ step: 'iterate', type: iterationType, summary: iterText.slice(0, 500) });
            }
          } else {
            stepResults.push({ step: 'iterate', type: iterationType, summary: iterText.slice(0, 500) });
          }
        } catch (err) {
          stepResults.push({ step: 'iterate', type: iterationType, error: err.message });
        }

        // Step 2: Export to Google Doc
        if (exportTo === 'google_doc' || exportTo === 'both') {
          try {
            const { generateAndExportToGoogleDoc } = require('./export');
            const exportResult = await generateAndExportToGoogleDoc(sessionNodes, sessionIdea);
            stepResults.push({
              step: 'export',
              type: 'google_doc',
              summary: `Created Google Doc: ${exportResult.docUrl}`,
              docUrl: exportResult.docUrl,
              docId: exportResult.docId,
              sectionCount: exportResult.sectionCount,
            });
          } catch (err) {
            stepResults.push({ step: 'export', type: 'google_doc', error: err.message });
          }
        }

        const docUrl = stepResults.find(s => s.docUrl)?.docUrl;
        result = {
          type: 'iterate_and_export',
          steps: stepResults,
          docUrl,
          summary: stepResults.map(s => s.error ? `[${s.step}] Error: ${s.error}` : `[${s.step}] ${s.summary?.slice(0, 150)}`).join('\n'),
        };
        break;
      }

      case 'evolve': {
        // ── Autonomous Evolution Plan ─────────────────────────────
        // Multi-step plan that executes one step per run.
        // config.plan: ['refine', 'debate', 'experiment', 'refine', 'synthesize_export']
        // Each run advances to the next step based on runCount.
        if (!sessionNodes.length) {
          result = { type: 'evolve', error: 'No session linked — requires an existing tree.' };
          break;
        }

        const plan = task.config?.plan || ['refine', 'debate', 'experiment', 'refine', 'synthesize_export'];
        const stepIndex = (task.runCount || 0) % plan.length; // runCount already incremented before executeTask
        const currentStep = plan[stepIndex];
        const evolutionHistory = task.config?.evolutionHistory || [];

        // Optionally reorder remaining steps using meta-evolution
        let metaHint = null;
        try {
          const { getBestStrategy } = require('./meta-evolution');
          const best = await getBestStrategy(task.userId || 'local', task.mode || 'idea', ['refine', 'debate', 'experiment']);
          if (best) metaHint = best;
        } catch { /* non-fatal */ }

        let stepResult = { step: currentStep, stepIndex };

        try {
          if (currentStep === 'refine') {
            const iterPrompt = `Review this thinking tree about "${sessionIdea}". Identify 3-5 weak nodes and provide improvements as JSON: [{"nodeId":"...","currentLabel":"...","improvedLabel":"...","improvedReasoning":"..."}]\n\n${treeContext}`;
            const iterRes = await ai.call({
              model: 'claude:sonnet',
              system: 'You are a senior strategist. Improve weak nodes. Return JSON array of improvements.',
              messages: [{ role: 'user', content: iterPrompt }],
              maxTokens: 4096,
            });
            const iterText = iterRes?.text || '';
            try {
              const jsonMatch = iterText.match(/\[[\s\S]*\]/);
              if (jsonMatch) {
                const improvements = JSON.parse(jsonMatch[0]);
                let appliedCount = 0;
                for (const imp of improvements) {
                  const node = sessionNodes.find(n => (n.data?.label || n.label) === imp.currentLabel || n.id === imp.nodeId);
                  if (node) {
                    const d = node.data || node;
                    if (imp.improvedLabel) d.label = imp.improvedLabel;
                    if (imp.improvedReasoning) d.reasoning = imp.improvedReasoning;
                    appliedCount++;
                  }
                }
                if (appliedCount > 0 && task.sessionId) {
                  await sessions.updateSession(task.sessionId, { nodes: sessionNodes });
                }
                stepResult.summary = `Refined ${appliedCount} nodes`;
                stepResult.appliedCount = appliedCount;
              } else {
                stepResult.summary = iterText.slice(0, 300);
              }
            } catch {
              stepResult.summary = iterText.slice(0, 300);
            }
          } else if (currentStep === 'debate') {
            const debatePrompt = `Critically analyze this thinking tree about "${sessionIdea}" and identify 3-5 weaknesses, contradictions, and blind spots:\n\n${treeContext}`;
            const debateRes = await ai.call({
              model: 'claude:sonnet',
              system: 'You are a sharp critic. Find weaknesses, contradictions, and blind spots. Be specific and constructive.',
              messages: [{ role: 'user', content: debatePrompt }],
              maxTokens: 4096,
            });
            stepResult.summary = (debateRes?.text || '').slice(0, 500);
          } else if (currentStep === 'experiment') {
            // Server-side experiment: generate alternative, score, keep if better
            const mutatePrompt = `Generate a completely different approach to "${sessionIdea}". Create 5-8 nodes as JSON array: [{"id":"...","type":"...","label":"...","reasoning":"...","parentIds":[]}]\n\n${treeContext}`;
            const mutateRes = await ai.call({
              model: 'claude:sonnet',
              system: 'You are a creative strategist. Generate a bold alternative approach. Return JSON array of nodes.',
              messages: [{ role: 'user', content: mutatePrompt }],
              maxTokens: 4096,
            });
            const mutateText = mutateRes?.text || '';
            try {
              const jsonMatch = mutateText.match(/\[[\s\S]*\]/);
              if (jsonMatch) {
                const candidateNodes = JSON.parse(jsonMatch[0]);
                // Simple heuristic score comparison: count of nodes with reasoning > 50 chars
                const baselineQuality = sessionNodes.filter(n => ((n.data?.reasoning || n.reasoning) || '').length > 50).length;
                const candidateQuality = candidateNodes.filter(n => (n.reasoning || '').length > 50).length;
                if (candidateQuality > baselineQuality && task.sessionId) {
                  await sessions.updateSession(task.sessionId, { nodes: candidateNodes });
                  sessionNodes = candidateNodes;
                  stepResult.summary = `Experiment: replaced tree (candidate quality ${candidateQuality} > baseline ${baselineQuality})`;
                  stepResult.swapped = true;
                } else {
                  stepResult.summary = `Experiment: kept baseline (baseline ${baselineQuality} >= candidate ${candidateQuality})`;
                  stepResult.swapped = false;
                }
              } else {
                stepResult.summary = 'Experiment: could not parse candidate tree';
              }
            } catch {
              stepResult.summary = 'Experiment: failed to evaluate candidate';
            }
          } else if (currentStep === 'synthesize_export') {
            try {
              const { generateAndExportToGoogleDoc } = require('./export');
              const exportResult = await generateAndExportToGoogleDoc(sessionNodes, sessionIdea);
              stepResult.summary = `Exported to Google Doc: ${exportResult.docUrl}`;
              stepResult.docUrl = exportResult.docUrl;
              stepResult.docId = exportResult.docId;
            } catch (err) {
              stepResult.summary = `Export failed: ${err.message}`;
              stepResult.error = err.message;
            }
          }

          // Record for meta-evolution
          try {
            const { recordOutcome } = require('./meta-evolution');
            await recordOutcome(task.userId || 'local', task.mode || 'idea', currentStep, stepResult.appliedCount || 0, task.sessionId);
          } catch { /* non-fatal */ }

        } catch (err) {
          stepResult.error = err.message;
          stepResult.summary = `Step failed: ${err.message}`;
        }

        // Store step in evolution history
        stepResult.timestamp = new Date().toISOString();
        if (metaHint) stepResult.metaHint = metaHint;
        evolutionHistory.push(stepResult);

        // Auto-disable when all steps complete
        const isComplete = (task.runCount || 0) >= plan.length - 1;
        if (isComplete) {
          task.enabled = false;
        }

        // Persist evolution history back to task config
        task.config = { ...task.config, evolutionHistory };
        try {
          await updateTask(task.id, { config: task.config, enabled: task.enabled });
        } catch { /* non-fatal */ }

        result = {
          type: 'evolve',
          step: currentStep,
          stepIndex,
          totalSteps: plan.length,
          isComplete,
          evolutionHistory,
          metaHint,
          summary: `[Step ${stepIndex + 1}/${plan.length}: ${currentStep}] ${stepResult.summary || 'Done'}`,
        };
        break;
      }

      case 'custom': {
        const prompt = treeContext
          ? `Context from existing thinking tree:\n${treeContext}\n\nTask: ${task.prompt}`
          : task.prompt;
        const res = await ai.call({
          model: task.config?.model || 'claude:sonnet',
          system: task.config?.systemPrompt || 'You are a helpful assistant.',
          messages: [{ role: 'user', content: prompt }],
          maxTokens: task.config?.maxTokens || 4096,
        });
        result = { type: 'custom', summary: (res?.text || '').slice(0, 2000), fullText: res?.text };
        break;
      }

      default:
        result = { type: task.type, summary: `Unknown task type: ${task.type}` };
    }

    // ── Result delivery ──────────────────────────────────────
    // Store result as a chat message in the session (notification)
    if (task.sessionId && result && !result.error) {
      try {
        const notification = {
          role: 'system',
          content: `[Scheduled Task: ${task.name}] Completed at ${new Date().toLocaleString()}\n\n${result.summary || 'Done'}`,
          timestamp: new Date().toISOString(),
          taskId: task.id,
          taskType: task.type,
        };
        await sessions.appendChatMessage(task.sessionId, notification);
      } catch {}
    }

    // Email delivery if configured
    if (task.config?.emailTo && result && !result.error) {
      try {
        await sendTaskEmail(task, result);
      } catch (emailErr) {
        console.warn('Scheduler: failed to send email:', emailErr.message);
      }
    }

    task.lastRunStatus = result.error ? 'error' : 'success';
    task.lastRunResult = result;
    task.updatedAt = new Date().toISOString();
    await saveTask(task);
    return result;
  } catch (err) {
    task.lastRunStatus = 'error';
    task.lastRunResult = { error: err.message };
    task.updatedAt = new Date().toISOString();
    await saveTask(task);
    return { error: err.message };
  }
}

// ── Email delivery (uses nodemailer or SMTP) ─────────────────
async function sendTaskEmail(task, result) {
  // Use a simple email approach — generate an HTML email body via AI, then send
  const ai = require('../ai/providers');
  const res = await ai.call({
    model: 'claude:haiku',
    system: 'Convert the following task result into a clean, professional HTML email body. Use simple inline styles. Include a header with the task name and date, then the content formatted with headings and bullet points. Keep it concise.',
    messages: [{ role: 'user', content: `Task: ${task.name}\nDate: ${new Date().toLocaleDateString()}\n\nResult:\n${result.summary || result.fullText || 'Completed'}` }],
    maxTokens: 2048,
  });

  const htmlBody = res?.text || `<p>${result.summary}</p>`;

  // Try nodemailer if available, otherwise store for pickup
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: task.config.emailTo,
      subject: `[ThoughtClaw] ${task.name} — ${new Date().toLocaleDateString()}`,
      html: htmlBody,
    });
    console.log(`Scheduler: emailed task result to ${task.config.emailTo}`);
  } catch (err) {
    // If SMTP not configured, store the email content for manual pickup
    task.lastRunResult.pendingEmail = {
      to: task.config.emailTo,
      subject: `[ThoughtClaw] ${task.name} — ${new Date().toLocaleDateString()}`,
      html: htmlBody,
    };
    console.log(`Scheduler: email queued (SMTP not configured) for ${task.config.emailTo}`);
  }
}

// ── Cron description helper ──────────────────────────────────
function describeCron(cronExpr) {
  const cron = parseCron(cronExpr);
  if (!cron) return cronExpr;

  const { minute, hour, dom, month, dow } = cron;

  if (minute.startsWith('*/')) return `Every ${minute.slice(2)} minutes`;
  if (hour.startsWith('*/')) return `Every ${hour.slice(2)} hours`;

  const timeStr = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;

  if (dow === '1-5' && dom === '*' && month === '*') return `Weekdays at ${timeStr}`;
  if (dow === '*' && dom === '*' && month === '*') return `Daily at ${timeStr}`;
  if (dow === '1' && dom === '*') return `Mondays at ${timeStr}`;

  return `Cron: ${cronExpr}`;
}

// ── REST Handlers ────────────────────────────────────────────

function mountSchedulerRoutes(app) {
  app.get('/api/tasks', (req, res) => {
    const userId = req.user?.uid || 'local';
    const taskList = listTasks(userId).map(t => ({
      ...t,
      scheduleDescription: t.schedule?.cron ? describeCron(t.schedule.cron) : 'Manual only',
      isActive: activeTimers.has(t.id),
    }));
    res.json(taskList);
  });

  app.post('/api/tasks', async (req, res) => {
    try {
      const userId = req.user?.uid || 'local';
      const task = await createTask(userId, req.body);
      res.json(task);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/tasks/:id', (req, res) => {
    const task = getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  });

  app.put('/api/tasks/:id', async (req, res) => {
    try {
      const task = await updateTask(req.params.id, req.body);
      if (!task) return res.status(404).json({ error: 'Task not found' });
      res.json(task);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/tasks/:id', async (req, res) => {
    try {
      await deleteTask(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/tasks/:id/run', async (req, res) => {
    try {
      const result = await executeTask(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { mountSchedulerRoutes, createTask, executeTask, listTasks, getTask };
