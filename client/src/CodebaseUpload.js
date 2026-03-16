import React, { useState, useRef, useCallback } from 'react';

// ── File filtering constants ──────────────────────────────────
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out',
  '__pycache__', '.cache', 'coverage', '.nyc_output',
  'vendor', 'venv', '.venv', 'env', '.env',
  '.idea', '.vscode', 'target', 'bin', 'obj',
]);

const SKIP_EXTENSIONS = new Set([
  '.lock', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
  '.woff', '.woff2', '.ttf', '.eot', '.otf', '.pdf',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.map', '.min.js', '.min.css',
  '.pyc', '.pyo', '.class', '.o', '.a', '.so', '.dll', '.exe',
  '.DS_Store', '.log',
]);

const PRIORITY_PATTERNS = [
  { re: /^(index|main|app|server|routes?|router)\.(js|ts|jsx|tsx|py|go|rb|java)$/i, score: 10 },
  { re: /\.(routes?|controller|handler|endpoint|api)\.(js|ts|py|go|rb)$/i, score: 9 },
  { re: /\.(model|schema|entity|migration)\.(js|ts|py|go|rb)$/i, score: 9 },
  { re: /package\.json$/i, score: 8 },
  { re: /README\.md$/i, score: 8 },
  { re: /\.md$/i, score: 6 },
  { re: /\.(component|page|view|screen|container)\.(jsx|tsx|js|ts)$/i, score: 7 },
  { re: /\.(config|settings|constants)\.(js|ts|py|json)$/i, score: 5 },
  { re: /\.(service|store|context|hook|util|helper)\.(js|ts)$/i, score: 4 },
];

const MAX_FILES = 150;
const MAX_TOTAL_CHARS = 50000;
const MAX_FILE_CHARS = 3000;

function getFilePriority(filename) {
  for (const { re, score } of PRIORITY_PATTERNS) {
    if (re.test(filename)) return score;
  }
  return 1;
}

function shouldSkipFile(path) {
  const parts = path.split('/');
  if (parts.some((p) => SKIP_DIRS.has(p))) return true;
  const lower = path.toLowerCase();
  return SKIP_EXTENSIONS.has(
    [...SKIP_EXTENSIONS].find((ext) => lower.endsWith(ext)) || ''
  );
}

// ── Recursive directory reader ────────────────────────────────
async function readDirectoryEntry(dirEntry, basePath = '') {
  return new Promise((resolve) => {
    const reader = dirEntry.createReader();
    const allEntries = [];

    const readBatch = () => {
      reader.readEntries((entries) => {
        if (!entries.length) return resolve(allEntries);
        allEntries.push(...entries);
        readBatch();
      }, () => resolve(allEntries));
    };
    readBatch();
  });
}

async function collectFilesFromEntry(entry, path = '') {
  const fullPath = path ? `${path}/${entry.name}` : entry.name;

  if (entry.isFile) {
    if (shouldSkipFile(fullPath)) return [];
    return [{ entry, path: fullPath }];
  }

  if (entry.isDirectory) {
    if (SKIP_DIRS.has(entry.name)) return [];
    const children = await readDirectoryEntry(entry, fullPath);
    const results = await Promise.all(
      children.map((child) => collectFilesFromEntry(child, fullPath))
    );
    return results.flat();
  }

  return [];
}

function readFileAsText(fileEntry) {
  return new Promise((resolve, reject) => {
    fileEntry.file((file) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error(`Failed to read ${fileEntry.fullPath}`));
      reader.readAsText(file);
    }, reject);
  });
}

// ── File System Access API directory reader ──────────────────
async function collectFilesFromHandle(dirHandle, path = '') {
  const files = [];
  for await (const entry of dirHandle.values()) {
    const fullPath = path ? `${path}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') {
      if (SKIP_DIRS.has(entry.name)) continue;
      const children = await collectFilesFromHandle(entry, fullPath);
      files.push(...children);
    } else if (entry.kind === 'file') {
      if (shouldSkipFile(fullPath)) continue;
      files.push({ handle: entry, path: fullPath });
    }
  }
  return files;
}

// ── Main component ────────────────────────────────────────────
const GOALS = [
  { key: 'features', label: 'Product Features', desc: 'What the app does — routes, components, handlers' },
  { key: 'architecture', label: 'Architecture & Constraints', desc: 'Tech debt, coupling, bottlenecks, patterns' },
  { key: 'users', label: 'User Segments & Flows', desc: 'Inferred user types from auth, roles, data models' },
];

export default function CodebaseUpload({ onAnalysisReady, isAnalyzing }) {
  const [goals, setGoals] = useState({ features: true, architecture: true, users: true });
  const [phase, setPhase] = useState('idle'); // idle | reading | ready | error
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState(null); // { fileCount, folderName, filesOmitted }
  const [errorMsg, setErrorMsg] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const payloadRef = useRef(null);

  const processEntries = useCallback(async (entries, folderName) => {
    setPhase('reading');
    setErrorMsg('');

    try {
      // Collect all candidate file entries
      const allCandidates = (
        await Promise.all(entries.map((e) => collectFilesFromEntry(e)))
      ).flat();

      // Score and sort by priority
      const scored = allCandidates.map((c) => ({
        ...c,
        score: getFilePriority(c.path.split('/').pop()),
      })).sort((a, b) => b.score - a.score);

      const selected = scored.slice(0, MAX_FILES);
      const filesOmitted = Math.max(0, scored.length - MAX_FILES);

      setProgress({ done: 0, total: selected.length });

      // Read files with budget enforcement
      const files = [];
      let totalChars = 0;

      for (let i = 0; i < selected.length; i++) {
        const { entry, path } = selected[i];
        setProgress({ done: i + 1, total: selected.length });

        try {
          let content = await readFileAsText(entry);

          // Truncate large files
          if (content.length > MAX_FILE_CHARS) {
            const omitted = content.length - MAX_FILE_CHARS;
            content = content.slice(0, MAX_FILE_CHARS) + `\n// [truncated — ${omitted} chars omitted]`;
          }

          // Budget check
          if (totalChars + content.length > MAX_TOTAL_CHARS) break;
          totalChars += content.length;
          files.push({ path, content });
        } catch {
          // skip unreadable files silently
        }
      }

      const activeGoals = Object.entries(goals)
        .filter(([, v]) => v)
        .map(([k]) => k);

      payloadRef.current = { files, analysisGoals: activeGoals, folderName, filesOmitted };
      setSummary({ fileCount: files.length, folderName, filesOmitted });
      setPhase('ready');
    } catch (err) {
      setErrorMsg(err.message || 'Failed to read files');
      setPhase('error');
    }
  }, [goals]);

  // Handle modern File System Access API (no browser popup)
  const handleDirectoryPicker = useCallback(async () => {
    try {
      const dirHandle = await window.showDirectoryPicker();
      const folderName = dirHandle.name || 'project';

      setPhase('reading');
      setErrorMsg('');

      // Recursively collect files (skips excluded dirs/extensions during traversal)
      const allCandidates = await collectFilesFromHandle(dirHandle);

      // Score and sort by priority
      const scored = allCandidates.map((c) => ({
        ...c,
        score: getFilePriority(c.path.split('/').pop()),
      })).sort((a, b) => b.score - a.score);

      const selected = scored.slice(0, MAX_FILES);
      const filesOmitted = Math.max(0, scored.length - MAX_FILES);

      setProgress({ done: 0, total: selected.length });

      // Read files with budget enforcement
      const files = [];
      let totalChars = 0;

      for (let i = 0; i < selected.length; i++) {
        const { handle, path } = selected[i];
        setProgress({ done: i + 1, total: selected.length });

        try {
          const file = await handle.getFile();
          let content = await file.text();

          if (content.length > MAX_FILE_CHARS) {
            const omitted = content.length - MAX_FILE_CHARS;
            content = content.slice(0, MAX_FILE_CHARS) + `\n// [truncated — ${omitted} chars omitted]`;
          }

          if (totalChars + content.length > MAX_TOTAL_CHARS) break;
          totalChars += content.length;
          files.push({ path, content });
        } catch {
          // skip unreadable files silently
        }
      }

      const activeGoals = Object.entries(goals)
        .filter(([, v]) => v)
        .map(([k]) => k);

      payloadRef.current = { files, analysisGoals: activeGoals, folderName, filesOmitted };
      setSummary({ fileCount: files.length, folderName, filesOmitted });
      setPhase('ready');
    } catch (err) {
      if (err.name === 'AbortError') return; // user cancelled picker
      setErrorMsg(err.message || 'Failed to read directory');
      setPhase('error');
    }
  }, [goals]);

  // Handle <input webkitdirectory> change
  const handleInputChange = useCallback((e) => {
    const fileList = e.target.files;
    if (!fileList || !fileList.length) return;

    // Get folder name from first file path
    const firstPath = fileList[0].webkitRelativePath || fileList[0].name;
    const folderName = firstPath.split('/')[0] || 'project';

    // Use webkitGetAsEntry if available for better filtering, else fallback
    // For input[webkitdirectory], we get File objects directly
    const candidates = [];
    let totalChars = 0;

    const scored = Array.from(fileList)
      .filter((f) => !shouldSkipFile(f.webkitRelativePath || f.name))
      .map((f) => ({
        file: f,
        path: f.webkitRelativePath || f.name,
        score: getFilePriority(f.name),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_FILES);

    const filesOmitted = Math.max(0, fileList.length - scored.length);

    setPhase('reading');
    setProgress({ done: 0, total: scored.length });

    const readNext = (index) => {
      if (index >= scored.length) {
        const activeGoals = Object.entries(goals)
          .filter(([, v]) => v)
          .map(([k]) => k);
        payloadRef.current = { files: candidates, analysisGoals: activeGoals, folderName, filesOmitted };
        setSummary({ fileCount: candidates.length, folderName, filesOmitted });
        setPhase('ready');
        return;
      }

      setProgress({ done: index + 1, total: scored.length });
      const { file, path } = scored[index];
      const reader = new FileReader();
      reader.onload = (ev) => {
        let content = ev.target.result || '';
        if (content.length > MAX_FILE_CHARS) {
          const omitted = content.length - MAX_FILE_CHARS;
          content = content.slice(0, MAX_FILE_CHARS) + `\n// [truncated — ${omitted} chars omitted]`;
        }
        if (totalChars + content.length <= MAX_TOTAL_CHARS) {
          totalChars += content.length;
          candidates.push({ path, content });
        }
        readNext(index + 1);
      };
      reader.onerror = () => readNext(index + 1);
      reader.readAsText(file);
    };

    readNext(0);
  }, [goals]);

  // Handle drag-and-drop
  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    setIsDragOver(false);

    const items = e.dataTransfer?.items;
    if (!items) return;

    const entries = [];
    let folderName = 'project';

    for (const item of items) {
      const entry = item.webkitGetAsEntry?.();
      if (!entry) continue;
      if (entry.isDirectory && !folderName) folderName = entry.name;
      if (entry.isDirectory) folderName = entry.name;
      entries.push(entry);
    }

    if (!entries.length) return;
    processEntries(entries, folderName);
  }, [processEntries]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleAnalyze = useCallback(() => {
    if (!payloadRef.current) return;
    onAnalysisReady(payloadRef.current);
  }, [onAnalysisReady]);

  const handleReset = useCallback(() => {
    payloadRef.current = null;
    setSummary(null);
    setPhase('idle');
    setProgress({ done: 0, total: 0 });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const toggleGoal = (key) => {
    setGoals((prev) => ({ ...prev, [key]: !prev[key] }));
    // Reset ready state if goals change after files loaded
    if (phase === 'ready') {
      setPhase('idle');
      payloadRef.current = null;
      setSummary(null);
    }
  };

  return (
    <div className="codebase-upload-wrapper">
    <div className="codebase-upload">
      <div className="upload-header">
        <span className="upload-icon">⟨/⟩</span>
        <div className="upload-title">ANALYZE CODEBASE</div>
        <div className="upload-subtitle">bottom-up product thinking from real code</div>
      </div>

      {/* Analysis goals */}
      <div className="upload-goals">
        {GOALS.map(({ key, label, desc }) => (
          <label key={key} className={`upload-goal-item ${goals[key] ? 'checked' : ''}`}>
            <input
              type="checkbox"
              checked={goals[key]}
              onChange={() => toggleGoal(key)}
            />
            <div className="upload-goal-text">
              <span className="upload-goal-label">{label}</span>
              <span className="upload-goal-desc">{desc}</span>
            </div>
          </label>
        ))}
      </div>

      {/* Drop zone */}
      {phase === 'idle' && (
        <div
          className={`upload-drop-zone ${isDragOver ? 'drag-over' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={async () => {
            // File System Access API is blocked in iframes (e.g. preview);
            // detect iframe or missing API and fall back to <input webkitdirectory>
            const inIframe = window.self !== window.top;
            if (!inIframe && window.showDirectoryPicker) {
              try {
                await handleDirectoryPicker();
              } catch {
                // Fallback if blocked by permissions policy
                fileInputRef.current?.click();
              }
            } else {
              fileInputRef.current?.click();
            }
          }}
        >
          <div className="upload-drop-icon">⬇</div>
          <div className="upload-drop-label">Drop a project folder here</div>
          <div className="upload-drop-sub">or click to select folder</div>
          <input
            ref={fileInputRef}
            type="file"
            webkitdirectory="true"
            multiple
            style={{ display: 'none' }}
            onChange={handleInputChange}
          />
        </div>
      )}

      {/* Reading progress */}
      {phase === 'reading' && (
        <div className="upload-progress-wrap">
          <div className="upload-progress-label">
            Reading files… {progress.done} / {progress.total}
          </div>
          <div className="upload-progress-bar">
            <div
              className="upload-progress-fill"
              style={{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : '0%' }}
            />
          </div>
        </div>
      )}

      {/* Ready state */}
      {phase === 'ready' && summary && (
        <div className="upload-ready">
          <div className="upload-ready-info">
            <span className="upload-ready-icon">✓</span>
            <div>
              <div className="upload-ready-name">{summary.folderName}</div>
              <div className="upload-ready-meta">
                {summary.fileCount} files indexed
                {summary.filesOmitted > 0 && ` · ${summary.filesOmitted} skipped`}
              </div>
            </div>
          </div>
          <div className="upload-ready-actions">
            <button
              className="btn btn-generate"
              onClick={handleAnalyze}
              disabled={isAnalyzing || !Object.values(goals).some(Boolean)}
            >
              {isAnalyzing ? '⟳ ANALYZING…' : '▶ ANALYZE'}
            </button>
            <button className="btn btn-stop" onClick={handleReset}>
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {phase === 'error' && (
        <div className="upload-error">
          <span>⚠ {errorMsg}</span>
          <button onClick={handleReset}>Try again</button>
        </div>
      )}

      <div className="upload-hint">
        Supports JavaScript, TypeScript, Python, Go, Ruby, Java, Markdown and more.
        node_modules and build artifacts are automatically excluded.
      </div>
    </div>
    </div>
  );
}
