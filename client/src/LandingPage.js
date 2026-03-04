// ── Landing Page ──────────────────────────────────────────────
// Public page for unauthenticated users: value prop + Google sign-in.

import { useAuth } from './AuthContext';

const FEATURES = [
  { icon: '◈', title: 'Idea Exploration', desc: 'Transform a raw idea into a structured thinking tree with AI agents', color: '#6c63ff' },
  { icon: '⚖', title: 'Multi-Agent Debate', desc: 'Challenge your thinking with adversarial critique, rebuttal, and synthesis', color: '#ffa94d' },
  { icon: '⟨/⟩', title: 'Research-Grounded', desc: 'AI agents research the web to ground every node in real data', color: '#20c997' },
  { icon: '✦', title: 'Export & Share', desc: 'Share interactive trees via link, export as PNG, SVG, or HTML', color: '#f06595' },
];

const MODES = [
  { icon: '◈', label: 'IDEA', desc: 'Product & startup thinking', color: '#6c63ff' },
  { icon: '⟨/⟩', label: 'CODE', desc: 'Codebase reverse-engineering', color: '#20c997' },
  { icon: '◎', label: 'RESUME', desc: 'Job application analysis', color: '#74c0fc' },
  { icon: '⚖', label: 'DECIDE', desc: 'Decision frameworks', color: '#ffa94d' },
  { icon: '✦', label: 'WRITE', desc: 'Content planning', color: '#f06595' },
  { icon: '◉', label: 'PLAN', desc: 'Project roadmapping', color: '#69db7c' },
];

export default function LandingPage() {
  const { login } = useAuth();

  return (
    <div className="landing">
      {/* Hero */}
      <header className="landing-hero">
        <div className="landing-logo">◈</div>
        <h1 className="landing-title">IDEA CANVAS</h1>
        <p className="landing-tagline">
          AI-powered structured thinking. Turn any idea into a visual thinking tree
          with research agents, multi-agent debate, and interactive exploration.
        </p>
        <button className="landing-cta" onClick={login}>
          <svg width="18" height="18" viewBox="0 0 24 24" style={{ marginRight: 8, verticalAlign: 'middle' }}>
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        </button>
      </header>

      {/* Features */}
      <section className="landing-features">
        {FEATURES.map((f, i) => (
          <div key={i} className="landing-feature-card">
            <div className="landing-feature-icon" style={{ color: f.color }}>{f.icon}</div>
            <h3 className="landing-feature-title">{f.title}</h3>
            <p className="landing-feature-desc">{f.desc}</p>
          </div>
        ))}
      </section>

      {/* Modes */}
      <section className="landing-modes">
        <h2 className="landing-section-title">6 THINKING MODES</h2>
        <div className="landing-mode-grid">
          {MODES.map((m, i) => (
            <div key={i} className="landing-mode-card" style={{ borderColor: m.color + '40' }}>
              <span className="landing-mode-icon" style={{ color: m.color }}>{m.icon}</span>
              <span className="landing-mode-label" style={{ color: m.color }}>{m.label}</span>
              <span className="landing-mode-desc">{m.desc}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <span style={{ opacity: 0.4 }}>Built with Claude &middot; Idea Canvas</span>
      </footer>
    </div>
  );
}
