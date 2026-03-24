// ── Session File Manager ─────────────────────────────────────
// Upload, parse, store, and retrieve files attached to sessions.
// Extracts text from PDF, DOCX, XLSX, PPTX, TXT, MD, and code files.

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// In-memory store: sessionId -> [{ id, name, size, type, extractedText, uploadedAt }]
const sessionFilesStore = new Map();

// ── Multer config ────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionDir = path.join(UPLOAD_DIR, req.params.sessionId || 'tmp');
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
    cb(null, sessionDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowed = [
      '.pdf', '.docx', '.doc', '.xlsx', '.xls', '.csv',
      '.pptx', '.txt', '.md', '.json', '.yaml', '.yml',
      '.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs',
      '.java', '.rb', '.html', '.css', '.sql', '.sh',
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// ── Text extraction per file type ────────────────────────────
async function extractText(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();

  try {
    // Plain text files
    if (['.txt', '.md', '.json', '.yaml', '.yml', '.js', '.ts', '.jsx', '.tsx',
         '.py', '.go', '.rs', '.java', '.rb', '.html', '.css', '.sql', '.sh',
         '.csv'].includes(ext)) {
      const text = fs.readFileSync(filePath, 'utf8');
      return text.slice(0, 50000); // 50k char limit per file
    }

    // PDF
    if (ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      const buffer = fs.readFileSync(filePath);
      const data = await pdfParse(buffer);
      return (data.text || '').slice(0, 50000);
    }

    // DOCX
    if (ext === '.docx' || ext === '.doc') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      return (result.value || '').slice(0, 50000);
    }

    // XLSX / XLS
    if (ext === '.xlsx' || ext === '.xls') {
      const XLSX = require('xlsx');
      const wb = XLSX.readFile(filePath);
      const parts = [];
      for (const name of wb.SheetNames.slice(0, 5)) { // max 5 sheets
        const sheet = wb.Sheets[name];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        parts.push(`[Sheet: ${name}]\n${csv.slice(0, 10000)}`);
      }
      return parts.join('\n\n').slice(0, 50000);
    }

    // PPTX — extract text from slides using xlsx (which can read Office XML)
    if (ext === '.pptx') {
      // Basic: read as zip, extract text from slide XML
      const XLSX = require('xlsx');
      try {
        const wb = XLSX.readFile(filePath);
        const parts = [];
        for (const name of wb.SheetNames.slice(0, 20)) {
          const sheet = wb.Sheets[name];
          const text = XLSX.utils.sheet_to_csv(sheet);
          if (text.trim()) parts.push(text.slice(0, 2000));
        }
        return parts.join('\n\n').slice(0, 50000) || `[PPTX file: ${originalName} — text extraction limited]`;
      } catch {
        return `[PPTX file: ${originalName} — could not extract text]`;
      }
    }

    return `[File: ${originalName} — unsupported format for text extraction]`;
  } catch (err) {
    console.error(`Text extraction failed for ${originalName}:`, err.message);
    return `[File: ${originalName} — extraction failed: ${err.message}]`;
  }
}

// ── CRUD operations ──────────────────────────────────────────

function getSessionFiles(sessionId) {
  return sessionFilesStore.get(sessionId) || [];
}

async function addSessionFile(sessionId, multerFile) {
  const extracted = await extractText(multerFile.path, multerFile.originalname);

  const fileRecord = {
    id: path.basename(multerFile.filename, path.extname(multerFile.filename)),
    name: multerFile.originalname,
    size: multerFile.size,
    type: path.extname(multerFile.originalname).toLowerCase(),
    extractedText: extracted,
    diskPath: multerFile.path,
    uploadedAt: new Date().toISOString(),
  };

  if (!sessionFilesStore.has(sessionId)) {
    sessionFilesStore.set(sessionId, []);
  }
  sessionFilesStore.get(sessionId).push(fileRecord);

  return {
    id: fileRecord.id,
    name: fileRecord.name,
    size: fileRecord.size,
    type: fileRecord.type,
    textLength: extracted.length,
    uploadedAt: fileRecord.uploadedAt,
  };
}

function removeSessionFile(sessionId, fileId) {
  const files = sessionFilesStore.get(sessionId);
  if (!files) return false;

  const idx = files.findIndex(f => f.id === fileId);
  if (idx === -1) return false;

  const file = files[idx];
  // Clean up disk file
  try { fs.unlinkSync(file.diskPath); } catch {}
  files.splice(idx, 1);
  return true;
}

// ── Build context block for AI injection ─────────────────────
function buildFileContext(sessionId) {
  const files = getSessionFiles(sessionId);
  if (!files.length) return null;

  const parts = [`SESSION FILES — The user has attached ${files.length} file(s) as context for this session:\n`];

  for (const f of files) {
    // Budget: ~8000 chars per file, max 40000 total
    const budget = Math.min(8000, Math.floor(40000 / files.length));
    const text = f.extractedText.slice(0, budget);
    parts.push(`=== FILE: ${f.name} (${formatSize(f.size)}) ===`);
    parts.push(text);
    if (f.extractedText.length > budget) {
      parts.push(`[... truncated — full file is ${f.extractedText.length} chars]`);
    }
    parts.push('');
  }

  parts.push('INSTRUCTION: Use the content from these files to ground your analysis. Reference specific data, quotes, and details from the attached documents.');

  return parts.join('\n');
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

module.exports = {
  upload,
  getSessionFiles,
  addSessionFile,
  removeSessionFile,
  buildFileContext,
};
