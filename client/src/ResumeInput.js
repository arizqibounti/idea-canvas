import React, { useState, useRef, useCallback } from 'react';
import { authFetch } from './api';

const API_URL = process.env.REACT_APP_API_URL || '';

// ── ResumeInput ───────────────────────────────────────────────
// Full-panel component shown when resume mode is active and the canvas is empty.
// Lets the user:
//   1. Paste a job description URL → fetched and stripped server-side
//   2. Upload their resume as a PDF (read as base64 for Claude document API)
//   3. Click ANALYSE RESUME → calls onAnalyzeReady({ jdText, pdfBase64, pdfName, jdUrl })

export default function ResumeInput({ onAnalyzeReady }) {
  const [jdUrl, setJdUrl]         = useState('');
  const [jdText, setJdText]       = useState('');
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [pdfBase64, setPdfBase64] = useState(null);
  const [pdfName, setPdfName]     = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef(null);

  // ── Fetch JD URL ────────────────────────────────────────────
  const handleFetchJD = useCallback(async () => {
    if (!jdUrl.trim()) return;
    setIsFetching(true);
    setFetchError(null);
    try {
      const res = await authFetch(`${API_URL}/api/fetch-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: jdUrl.trim() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setJdText(data.text);
    } catch (err) {
      setFetchError(err.message);
    } finally {
      setIsFetching(false);
    }
  }, [jdUrl]);

  // ── PDF file reader ──────────────────────────────────────────
  const handlePdfFile = useCallback((file) => {
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setFetchError('Please upload a PDF file (.pdf)');
      return;
    }
    setFetchError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      // FileReader returns "data:application/pdf;base64,<data>" — strip the prefix
      const base64 = e.target.result.split(',')[1];
      setPdfBase64(base64);
      setPdfName(file.name);
    };
    reader.readAsDataURL(file);
  }, []);

  // ── Drag-and-drop ───────────────────────────────────────────
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
    handlePdfFile(e.dataTransfer?.files?.[0]);
  }, [handlePdfFile]);

  // ── Trigger analysis ────────────────────────────────────────
  const handleAnalyze = useCallback(() => {
    const effectiveJdText = jdText || jdUrl.trim();
    if (!effectiveJdText) return;
    onAnalyzeReady({
      jdText: effectiveJdText,
      pdfBase64,
      pdfName,
      jdUrl: jdUrl.trim(),
    });
  }, [jdText, jdUrl, pdfBase64, pdfName, onAnalyzeReady]);

  const canAnalyze = !!(jdText || jdUrl.trim());

  return (
    <div className="resume-input-wrapper">
      <div className="resume-input-card">

        {/* ── Header ── */}
        <div className="resume-input-header">
          <span className="resume-input-icon">◎</span>
          <div>
            <div className="resume-input-title">RESUME ANALYSIS</div>
            <div className="resume-input-subtitle">map your experience to any job description</div>
          </div>
        </div>

        {/* ── Job Description ── */}
        <div className="resume-section-label">JOB DESCRIPTION</div>
        <div className="resume-url-row">
          <input
            className="resume-url-input"
            placeholder="paste job description URL…"
            value={jdUrl}
            onChange={e => { setJdUrl(e.target.value); setJdText(''); }}
            onKeyDown={e => e.key === 'Enter' && handleFetchJD()}
          />
          <button
            className="btn btn-generate"
            style={{ flexShrink: 0 }}
            onClick={handleFetchJD}
            disabled={!jdUrl.trim() || isFetching}
          >
            {isFetching ? '⟳ FETCHING…' : '↓ FETCH'}
          </button>
        </div>

        {fetchError && (
          <div className="resume-fetch-error">⚠ {fetchError}</div>
        )}

        {jdText && (
          <div className="resume-jd-preview">
            <div className="resume-jd-meta">
              <span className="resume-jd-ok">✓ JD loaded</span>
              <span className="resume-jd-chars">{jdText.length.toLocaleString()} chars</span>
            </div>
            <div className="resume-jd-snippet">{jdText.slice(0, 160)}…</div>
          </div>
        )}

        {/* ── PDF Resume ── */}
        <div className="resume-section-label" style={{ marginTop: 20 }}>YOUR RESUME <span className="resume-section-optional">(PDF — optional)</span></div>
        <div
          className={`resume-drop-zone${isDragOver ? ' drag-over' : ''}${pdfBase64 ? ' has-file' : ''}`}
          onClick={() => !pdfBase64 && fileInputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
        >
          {pdfBase64 ? (
            <div className="resume-file-attached">
              <span className="resume-file-icon">📄</span>
              <span className="resume-file-name">{pdfName}</span>
              <button
                className="resume-file-remove"
                onClick={e => { e.stopPropagation(); setPdfBase64(null); setPdfName(null); }}
              >
                ✕
              </button>
            </div>
          ) : (
            <>
              <span className="resume-drop-arrow">↑</span>
              <span className="resume-drop-label">Drop resume PDF here</span>
              <span className="resume-drop-sub">or click to browse</span>
            </>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          style={{ display: 'none' }}
          onChange={e => { handlePdfFile(e.target.files?.[0]); e.target.value = ''; }}
        />

        {/* ── Analyse button ── */}
        <button
          className="resume-analyze-btn"
          onClick={handleAnalyze}
          disabled={!canAnalyze}
        >
          ◎ ANALYSE RESUME
        </button>

        <div className="resume-input-tip">
          {pdfBase64
            ? 'Ready — Claude will compare your resume against the JD to find matches, gaps, and positioning angles'
            : 'Attach your PDF resume for deeper match / gap analysis, or just fetch the JD to get started'}
        </div>

      </div>
    </div>
  );
}
