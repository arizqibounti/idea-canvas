// ── Blog / Manifesto Page ─────────────────────────────────────
import React from 'react';

export default function BlogPage() {
  const goHome = () => { window.location.href = '/'; };

  return (
    <div className="blog-page">
      <nav className="blog-nav">
        <button className="blog-nav-home" onClick={goHome}>
          <span className="blog-nav-logo">◈</span> THOUGHTCLAW
        </button>
      </nav>

      <article className="blog-article">
        <header className="blog-header">
          <div className="blog-date">March 2026</div>
          <h1 className="blog-title">The End of Linear Thinking</h1>
          <p className="blog-subtitle">
            Why the next generation of AI tools won't give you answers — they'll give you structure.
          </p>
        </header>

        <section className="blog-section">
          <p>
            We've been building AI wrong.
          </p>
          <p>
            Not the models — those are extraordinary. The <em>interfaces</em>. We took the most powerful
            reasoning engines ever created and gave them the same interface as AIM circa 2003: a text box
            and a response. Ask a question, get an answer. The entire interaction model is
            linear, transactional, and disposable.
          </p>
          <p>
            But real thinking isn't linear. When you're wrestling with a hard problem — launching a product,
            architecting a system, making a career decision — your mind doesn't produce a single stream of
            text. It branches. It contradicts itself. It holds multiple hypotheses simultaneously, tests them
            against each other, prunes the weak ones, and strengthens the survivors. It builds a <em>tree</em>,
            not a thread.
          </p>
          <p>
            That's what ThoughtClaw is. Not a chatbot. A thinking environment.
          </p>
        </section>

        <section className="blog-section">
          <h2>The thesis</h2>
          <p>
            The era of dopamine manipulation in tech is ending. The companies that win will build AI aligned
            with what people actually need — not engagement metrics, not addiction loops, but genuine
            cognitive leverage. Tools that make you <em>smarter</em>, not more dependent.
          </p>
          <p>
            I believe structured thinking is the highest-leverage application of AI. Not because it's flashy —
            it's the opposite of flashy. It's the quiet, methodical process of taking a messy idea and
            turning it into something you can actually act on. And it's the one thing that AI chatbots,
            despite their brilliance, fundamentally can't do in a text thread.
          </p>
          <p>
            A thinking tree gives you three things a chat thread never will:
          </p>
          <ul className="blog-list">
            <li><strong>Structure you can navigate.</strong> Fifty nodes organized by type, scored, critiqued, and
            connected — not fifty paragraphs you have to re-read to find the one insight that matters.</li>
            <li><strong>Multi-agent pressure testing.</strong> Your idea doesn't just get a response.
            It gets a critic, an architect, and a synthesizer — three AI agents that debate each other
            until the weak nodes die and the strong ones evolve.</li>
            <li><strong>Persistence that compounds.</strong> Every session builds your knowledge graph.
            Patterns from past sessions inform future ones. Your thinking gets better over time,
            not reset with every new thread.</li>
          </ul>
        </section>

        <section className="blog-section">
          <h2>How I got here</h2>
          <p>
            My name is Ashar Rizqi. I've spent fifteen years building infrastructure that people trust
            with their most critical operations.
          </p>
          <p>
            I was a founding SRE at Box during their Series B, where I built the SRE and Platform teams from
            scratch and architected the FedRAMP/HIPAA-compliant systems that enabled their enterprise push.
            Then Director of Platform Engineering at MuleSoft, building Kubernetes-native infrastructure
            through their IPO and Salesforce acquisition.
          </p>
          <p>
            In 2018 I co-founded Blameless — the industry's first end-to-end SRE platform, built on the
            thesis that systems should assume blame, not people. Y Combinator 2017. Raised $50M+ from
            Accel, Lightspeed, and Third Point Ventures. Enterprise customers saw 90% faster incident
            resolution and 43% fewer critical incidents. Acquired by FireHydrant in 2024, then Freshworks.
          </p>
          <p>
            After Blameless, I did something unusual. I ran a blameless postmortem on my own company. Not
            the product or the tech — the culture, the decisions, the moments where we got it right and
            where we didn't. That produced a document that became the blueprint for everything I built next.
            First line: <em>"We are high integrity good humans demonstrating love and gratitude to one
            another."</em>
          </p>
          <p>
            Today I'm co-founder of Bounti.ai — an AI-powered real estate platform serving 180,000 agents
            across Keller Williams, CBRE, Century 21, RE/MAX, Compass, and eXp Realty. $16M seed led by
            Google Ventures. We built two complementary systems: GenNodes, a proprietary typed workflow
            runtime in Rust with 43+ composable node types, and B.Claw, an agent-facing AI operating system
            with 87 tools across 15 domains. A full listing launch went from 4-6 hours to 15 minutes.
          </p>
        </section>

        <section className="blog-section">
          <h2>Why this matters now</h2>
          <p>
            At Bounti, I learned something that changed how I think about AI. We built two architectures
            side by side: agentic loops for flexibility (conversation, reasoning, ambiguity) and typed
            pipelines for cost and reliability. The agentic approach cost $3-5 per listing. The typed
            pipeline approach cost $0.80. Same output quality. The difference was <em>structure</em>.
          </p>
          <p>
            That insight — that structure is the multiplier, not more intelligence — is what drives
            ThoughtClaw. The AI models are already brilliant. What's missing is the scaffolding that
            turns their brilliance into something you can navigate, challenge, and build on.
          </p>
          <p>
            Here's what that scaffolding looks like:
          </p>
          <ul className="blog-list">
            <li><strong>Thinking patterns</strong> — declarative state machines that walk a DAG of
            processing stages. Adversarial critique, progressive refinement, evolutionary search,
            expert committee. Nine stage types, hot-reloadable, composable. The DNA of how AI reasons
            about your problem.</li>
            <li><strong>Forest decomposition</strong> — complex problems broken into 4-6 interconnected
            canvases, each generated with cross-canvas context. A product strategy canvas knows about
            the constraints in the regulatory canvas. Cross-canvas critique catches contradictions that
            no single-tree analysis would surface.</li>
            <li><strong>Research grounding</strong> — AI agents research the web in real-time, grounding
            every node in actual data. Not hallucinated market sizes. Real competitors, real pricing,
            real technical constraints.</li>
          </ul>
        </section>

        <section className="blog-section">
          <h2>The 30-year mission</h2>
          <p>
            Use AI to change knowledge work for the better, forever.
          </p>
          <p>
            That's not a tagline. It's a commitment. I'm reading Sapolsky on free will, Anil Seth on
            consciousness as controlled hallucination, Christof Koch on integrated information theory.
            I'm wrestling with what agency actually means — right as I build systems that simulate it.
          </p>
          <p>
            The conclusion I keep arriving at: the tools we build shape how we think. A chat interface
            makes you think in responses. A canvas makes you think in structures. A forest makes you
            think in systems. The medium isn't just the message — it's the cognition.
          </p>
          <p>
            ThoughtClaw is 30,000 lines of production code built almost entirely on Claude's API.
            Multi-agent debate pipelines, streaming structured thinking trees, seven canvas modes,
            declarative thinking patterns, prompt caching, document blocks. It's a reference
            implementation for what's possible when you take AI seriously as a thinking partner
            rather than a question-answering machine.
          </p>
          <p>
            Trust is the only thing that compounds. That's true in infrastructure, in companies,
            and in the tools we build. ThoughtClaw earns trust by making your thinking visible,
            challengeable, and improvable — not by giving you answers you can't verify.
          </p>
        </section>

        <section className="blog-section blog-cta-section">
          <p>
            If this resonates, try it. Type an idea. Watch it branch. Challenge it. Refine it.
            See what your thinking looks like when it has structure.
          </p>
          <button className="blog-cta-btn" onClick={goHome}>
            Start thinking →
          </button>
        </section>
      </article>

      <footer className="blog-footer">
        <span>Ashar Rizqi · 2026</span>
        <span className="blog-contact">reach me at asharrizqi [at] gmail dot com</span>
      </footer>
    </div>
  );
}
