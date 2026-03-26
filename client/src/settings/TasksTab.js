// ── Scheduled Tasks Management Tab ───────────────────────────
import React, { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../api';

const API_URL = process.env.REACT_APP_API_URL || '';

const TASK_TYPES = [
  { id: 'research', label: 'Research', icon: '◎' },
  { id: 'generate', label: 'Generate', icon: '◈' },
  { id: 'custom', label: 'Custom', icon: '◇' },
];

export default function TasksTab() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newTask, setNewTask] = useState({ name: '', type: 'research', prompt: '', cron: '' });
  const [runningId, setRunningId] = useState(null);

  const fetchTasks = useCallback(() => {
    authFetch(`${API_URL}/api/tasks`)
      .then(r => r.json())
      .then(data => { setTasks(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const handleCreate = async () => {
    if (!newTask.name.trim() || !newTask.prompt.trim()) return;
    await authFetch(`${API_URL}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newTask.name,
        type: newTask.type,
        prompt: newTask.prompt,
        schedule: newTask.cron ? { cron: newTask.cron } : null,
      }),
    });
    setNewTask({ name: '', type: 'research', prompt: '', cron: '' });
    setShowCreate(false);
    fetchTasks();
  };

  const handleToggle = async (taskId, enabled) => {
    await authFetch(`${API_URL}/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    fetchTasks();
  };

  const handleDelete = async (taskId) => {
    await authFetch(`${API_URL}/api/tasks/${taskId}`, { method: 'DELETE' });
    fetchTasks();
  };

  const handleRun = async (taskId) => {
    setRunningId(taskId);
    await authFetch(`${API_URL}/api/tasks/${taskId}/run`, { method: 'POST' });
    setRunningId(null);
    fetchTasks();
  };

  const formatDate = (iso) => {
    if (!iso) return 'Never';
    return new Date(iso).toLocaleString();
  };

  if (loading) return <div className="tasks-loading">Loading tasks...</div>;

  return (
    <div className="tasks-tab">
      <div className="tasks-header">
        <h2 className="tasks-title">Scheduled Tasks</h2>
        <button className="tasks-create-btn" onClick={() => setShowCreate(v => !v)}>
          {showCreate ? '✕ Cancel' : '+ New Task'}
        </button>
      </div>

      {showCreate && (
        <div className="tasks-create-form">
          <input
            className="tasks-input"
            placeholder="Task name..."
            value={newTask.name}
            onChange={e => setNewTask(p => ({ ...p, name: e.target.value }))}
          />
          <div className="tasks-form-row">
            <select
              className="tasks-select"
              value={newTask.type}
              onChange={e => setNewTask(p => ({ ...p, type: e.target.value }))}
            >
              {TASK_TYPES.map(t => (
                <option key={t.id} value={t.id}>{t.icon} {t.label}</option>
              ))}
            </select>
            <input
              className="tasks-input"
              placeholder="Cron (e.g. 0 9 * * 1-5)"
              value={newTask.cron}
              onChange={e => setNewTask(p => ({ ...p, cron: e.target.value }))}
            />
          </div>
          <textarea
            className="tasks-textarea"
            placeholder="Prompt / instructions..."
            value={newTask.prompt}
            onChange={e => setNewTask(p => ({ ...p, prompt: e.target.value }))}
            rows={3}
          />
          <button className="tasks-save-btn" onClick={handleCreate} disabled={!newTask.name.trim() || !newTask.prompt.trim()}>
            Create Task
          </button>
        </div>
      )}

      {tasks.length === 0 ? (
        <div className="tasks-empty">
          No scheduled tasks yet. Create one above or use chat: <em>"schedule a daily research task about AI developments"</em>
        </div>
      ) : (
        <div className="tasks-list">
          {tasks.map(task => (
            <div key={task.id} className={`tasks-item ${!task.enabled ? 'tasks-item--disabled' : ''}`}>
              <div className="tasks-item-header">
                <span className="tasks-item-name">{task.name}</span>
                <span className={`tasks-item-status tasks-item-status--${task.lastRunStatus || 'idle'}`}>
                  {task.lastRunStatus || 'idle'}
                </span>
              </div>
              <div className="tasks-item-meta">
                <span className="tasks-item-type">{task.type}</span>
                <span className="tasks-item-schedule">{task.scheduleDescription || 'Manual'}</span>
                <span className="tasks-item-runs">{task.runCount} runs</span>
                <span className="tasks-item-last">Last: {formatDate(task.lastRunAt)}</span>
              </div>
              <div className="tasks-item-prompt">{task.prompt?.slice(0, 100)}{task.prompt?.length > 100 ? '...' : ''}</div>
              {task.lastRunResult?.summary && (
                <div className="tasks-item-result">{task.lastRunResult.summary.slice(0, 150)}...</div>
              )}
              <div className="tasks-item-actions">
                <button
                  className="tasks-action-btn"
                  onClick={() => handleRun(task.id)}
                  disabled={runningId === task.id}
                >
                  {runningId === task.id ? '◌ Running...' : '▶ Run Now'}
                </button>
                <button
                  className="tasks-action-btn"
                  onClick={() => handleToggle(task.id, !task.enabled)}
                >
                  {task.enabled ? '⏸ Pause' : '▶ Enable'}
                </button>
                <button
                  className="tasks-action-btn tasks-action-btn--danger"
                  onClick={() => handleDelete(task.id)}
                >
                  ✕ Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
