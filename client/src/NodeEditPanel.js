import React, { useState, useEffect } from 'react';
import { getNodeConfig } from './nodeConfig';
import PrototypePlayer from './PrototypePlayer';
import { authFetch } from './api';

const API_URL = process.env.REACT_APP_API_URL || '';

export default function NodeEditPanel({ node, onClose, onSave, onRegenerate, isDisabled, onGetAncestors, allowRegenerate = true }) {
  const [localLabel, setLocalLabel] = useState('');
  const [localReasoning, setLocalReasoning] = useState('');
  const [showMockup, setShowMockup] = useState(false);
  const [protoHtml, setProtoHtml] = useState(null);
  const [mockupLoading, setMockupLoading] = useState(false);
  const [mockupError, setMockupError] = useState(null);

  useEffect(() => {
    if (node) {
      setLocalLabel(node.data.label || '');
      setLocalReasoning(node.data.reasoning || '');
      setShowMockup(false);
      setProtoHtml(null);
      setMockupError(null);
    }
  }, [node]);

  const isOpen = !!node;
  const config = node ? getNodeConfig(node.data.type) : null;

  const handleSave = () => {
    onSave(node.id, { label: localLabel, reasoning: localReasoning });
  };

  const handleRegenerate = () => {
    onSave(node.id, { label: localLabel, reasoning: localReasoning });
    onRegenerate(node.id);
  };

  const handleMockupToggle = async () => {
    if (showMockup) {
      setShowMockup(false);
      return;
    }

    setShowMockup(true);

    // Already have HTML for this node — just show it
    if (protoHtml) return;

    setMockupLoading(true);
    setMockupError(null);

    try {
      const ancestors = onGetAncestors ? onGetAncestors(node.id) : [];
      const ancestorContext = ancestors.map((n) => ({
        id: n.id,
        type: n.data.type,
        label: n.data.label,
        reasoning: n.data.reasoning,
        parentId: n.data.parentId,
      }));

      const featureNode = {
        id: node.id,
        type: node.data.type,
        label: localLabel,
        reasoning: localReasoning,
        parentId: node.data.parentId,
      };

      const res = await authFetch(`${API_URL}/api/mockup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ featureNode, ancestorContext }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Server error ${res.status}`);
      }

      const data = await res.json();
      setProtoHtml(data.html);
    } catch (err) {
      setMockupError(err.message);
    } finally {
      setMockupLoading(false);
    }
  };

  // Regenerate a fresh prototype (discard cached html)
  const handleMockupRegenerate = async () => {
    setProtoHtml(null);
    setMockupError(null);
    setShowMockup(true);
    setMockupLoading(true);

    try {
      const ancestors = onGetAncestors ? onGetAncestors(node.id) : [];
      const ancestorContext = ancestors.map((n) => ({
        id: n.id,
        type: n.data.type,
        label: n.data.label,
        reasoning: n.data.reasoning,
        parentId: n.data.parentId,
      }));

      const featureNode = {
        id: node.id,
        type: node.data.type,
        label: localLabel,
        reasoning: localReasoning,
        parentId: node.data.parentId,
      };

      const res = await authFetch(`${API_URL}/api/mockup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ featureNode, ancestorContext }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Server error ${res.status}`);
      }

      const data = await res.json();
      setProtoHtml(data.html);
    } catch (err) {
      setMockupError(err.message);
    } finally {
      setMockupLoading(false);
    }
  };

  return (
    <div className={`node-edit-panel ${isOpen ? 'open' : ''}`}>
      {node && config && (
        <>
          <div className="panel-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: config.color, fontSize: 14 }}>{config.icon}</span>
              <span style={{ color: config.color, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em' }}>
                {config.label}
              </span>
            </div>
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>

          <div className="panel-body">
            <div>
              <div className="panel-field-label">LABEL</div>
              <textarea
                className="panel-textarea"
                rows={2}
                value={localLabel}
                onChange={(e) => setLocalLabel(e.target.value)}
                disabled={isDisabled}
                placeholder="Node label..."
              />
            </div>
            <div>
              <div className="panel-field-label">REASONING</div>
              <textarea
                className="panel-textarea"
                rows={5}
                value={localReasoning}
                onChange={(e) => setLocalReasoning(e.target.value)}
                disabled={isDisabled}
                placeholder="Reasoning..."
              />
            </div>

            {showMockup && node.data.type === 'feature' && (
              <div className="mockup-section">
                {protoHtml && !mockupLoading && (
                  <div className="mockup-regen-row">
                    <span className="mockup-regen-label">▶ PROTOTYPE</span>
                    <button className="btn-mockup-regen" onClick={handleMockupRegenerate}>
                      ↺ regenerate
                    </button>
                  </div>
                )}
                <PrototypePlayer
                  html={protoHtml}
                  isLoading={mockupLoading}
                  error={mockupError}
                />
              </div>
            )}
          </div>

          <div className="panel-footer">
            <button
              className="btn btn-save"
              onClick={handleSave}
              disabled={isDisabled || (!localLabel.trim())}
            >
              ✓ SAVE EDITS
            </button>
            {allowRegenerate && node.data.type !== 'seed' && (
              <button
                className="btn btn-regen"
                onClick={handleRegenerate}
                disabled={isDisabled || (!localLabel.trim())}
              >
                ↺ REGENERATE SUBTREE
              </button>
            )}
            {allowRegenerate && node.data.type === 'feature' && (
              <button
                className="btn btn-mockup"
                onClick={handleMockupToggle}
                disabled={isDisabled}
              >
                {showMockup ? '✕ CLOSE MOCKUP' : '▶ PROTOTYPE'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
