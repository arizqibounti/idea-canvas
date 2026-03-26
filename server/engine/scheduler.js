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
    let result;

    switch (task.type) {
      case 'generate': {
        const { getSystemPrompt } = require('./prompts');
        const systemPrompt = getSystemPrompt(task.mode, {});
        const text = await ai.call({
          model: 'claude:sonnet',
          system: systemPrompt,
          messages: [{ role: 'user', content: `Analyze and generate insights:\n\n"${task.prompt}"` }],
          maxTokens: 4096,
        });
        result = { type: 'generate', summary: text?.slice(0, 500) || 'Generated' };
        break;
      }
      case 'research': {
        const text = await ai.call({
          model: 'gemini:flash',
          system: 'You are a research assistant. Provide a concise, actionable research brief.',
          messages: [{ role: 'user', content: task.prompt }],
          maxTokens: 4096,
        });
        result = { type: 'research', summary: text?.slice(0, 500) || 'Researched' };
        break;
      }
      case 'custom': {
        const text = await ai.call({
          model: task.config?.model || 'claude:sonnet',
          system: task.config?.systemPrompt || 'You are a helpful assistant.',
          messages: [{ role: 'user', content: task.prompt }],
          maxTokens: task.config?.maxTokens || 4096,
        });
        result = { type: 'custom', summary: text?.slice(0, 500) || 'Completed' };
        break;
      }
      default:
        result = { type: task.type, summary: `${task.type} tasks require an active session.` };
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
