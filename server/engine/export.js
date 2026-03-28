// ── Export Engine ─────────────────────────────────────────────
// Transforms thinking trees into deliverables (PPTX, DOCX, PDF, MD)
// using Claude tool_use for intelligent content structuring +
// server-side libraries for file generation.
//
// Architecture:
//   1. Serialize tree nodes into compact context
//   2. Call Claude with tool definitions (create_slide, create_section, etc.)
//   3. Execute tool calls locally (build file data structures)
//   4. Loop until Claude finishes (agentic loop)
//   5. Render final file and return buffer
//
// Path A: Direct tool_use with local file generation libraries
// Path B: (future) Anthropic Agent Skills for hosted file gen

const Anthropic = require('@anthropic-ai/sdk');
const { sseHeaders } = require('../utils/sse');
const { updateSessionBrief, generateSessionSummary } = require('./sessionBrief');
const { appendArtifact } = require('../gateway/sessions');

// ── Lazy-load file generation libraries ──────────────────────
let PptxGenJS = null;
let _Document = null; // docx library

function getPptxGen() {
  if (!PptxGenJS) {
    try { PptxGenJS = require('pptxgenjs'); } catch { return null; }
  }
  return PptxGenJS;
}

// ── Tree Serialization ──────────────────────────────────────
function serializeTree(nodes) {
  return nodes.map(n => {
    const d = n.data || n;
    const parentIds = d.parentIds || (d.parentId ? [d.parentId] : []);
    return {
      id: d.id || n.id,
      type: d.type || 'unknown',
      label: d.label || '(unlabeled)',
      reasoning: (d.reasoning || '').slice(0, 300),
      parentIds,
    };
  });
}

function treeToText(nodes) {
  const serialized = serializeTree(nodes);
  return serialized.map(n => {
    const parents = n.parentIds.length ? ` (parents: ${n.parentIds.join(', ')})` : ' (root)';
    return `[${n.type}] "${n.label}"${parents}\n  ${n.reasoning}`;
  }).join('\n\n');
}

// ── Tool Definitions ────────────────────────────────────────

const SLIDE_TOOL = {
  name: 'add_slide',
  description: 'Add a slide to the presentation. Call this once per slide. Order matters — slides are appended in sequence.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Slide title (short, punchy)' },
      bullets: {
        type: 'array',
        items: { type: 'string' },
        description: 'Bullet points for the slide body (3-6 bullets ideal)',
      },
      speaker_notes: { type: 'string', description: 'Speaker notes for this slide (optional)' },
      layout: {
        type: 'string',
        enum: ['title', 'content', 'two_column', 'section_break', 'closing'],
        description: 'Slide layout type',
      },
    },
    required: ['title', 'bullets', 'layout'],
  },
};

const DOC_SECTION_TOOL = {
  name: 'add_section',
  description: 'Add a section to the document. Call once per section, in order.',
  input_schema: {
    type: 'object',
    properties: {
      heading: { type: 'string', description: 'Section heading' },
      level: { type: 'integer', description: 'Heading level (1=top, 2=sub, 3=subsub)', enum: [1, 2, 3] },
      body: { type: 'string', description: 'Section body text (can include markdown-style formatting)' },
      bullets: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional bullet list within section',
      },
    },
    required: ['heading', 'level', 'body'],
  },
};

const COMPLETE_TOOL = {
  name: 'finish_export',
  description: 'Signal that the export is complete. Call this LAST after adding all slides or sections.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Brief summary of what was created' },
    },
    required: ['summary'],
  },
};

// ── System Prompts ──────────────────────────────────────────

const DECK_SYSTEM = `You are an expert presentation designer. You transform thinking trees into compelling slide decks.

Rules:
- Create 8-15 slides from the thinking tree
- Start with a title slide (layout: "title") with a compelling headline
- Use "section_break" layout to separate major themes
- End with a "closing" slide (key takeaway + call to action)
- Each content slide should have 3-6 concise bullets
- Speaker notes should expand on the bullets with talking points
- Transform raw thinking nodes into a narrative arc
- Don't just list nodes — synthesize them into a story
- Use the add_slide tool for each slide, then call finish_export when done`;

const DOC_SYSTEM = `You are an expert document writer. You transform thinking trees into well-structured documents.

Rules:
- Create a comprehensive document with clear hierarchy
- Use level 1 headings for major sections (3-5 sections)
- Use level 2 headings for subsections
- Write clear, professional prose in the body
- Include bullet lists where appropriate for key points
- Synthesize the thinking tree into a coherent narrative
- Don't just list nodes — weave them into flowing text
- Use the add_section tool for each section, then call finish_export when done`;

// ── Agentic Tool Loop ───────────────────────────────────────

async function runToolLoop({ system, userMessage, tools, onToolCall, signal, onProgress }) {
  const claude = new Anthropic();
  const messages = [{ role: 'user', content: userMessage }];
  let iteration = 0;
  const MAX_ITERATIONS = 25;

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    if (signal?.aborted) throw new Error('Export cancelled');

    onProgress?.({ status: 'thinking', iteration, detail: `Claude is structuring content (step ${iteration})...` });

    const response = await claude.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system,
      messages,
      tools,
    });

    // Process content blocks
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    const textBlocks = response.content.filter(b => b.type === 'text');

    if (textBlocks.length > 0) {
      onProgress?.({ status: 'text', text: textBlocks.map(b => b.text).join('') });
    }

    // If no tool calls, we're done
    if (response.stop_reason !== 'tool_use' || toolUseBlocks.length === 0) {
      onProgress?.({ status: 'complete', detail: 'Content generation finished' });
      break;
    }

    // Execute tool calls
    const toolResults = [];
    for (const block of toolUseBlocks) {
      const result = onToolCall(block.name, block.input, block.id);
      onProgress?.({
        status: 'tool_call',
        tool: block.name,
        input: block.input,
        iteration,
      });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }

    // Append assistant response + tool results for next iteration
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });

    // Check for finish signal
    const finishCall = toolUseBlocks.find(b => b.name === 'finish_export');
    if (finishCall) {
      onProgress?.({ status: 'complete', detail: finishCall.input.summary || 'Export complete' });
      break;
    }
  }

  return messages;
}

// ── PPTX Generator ──────────────────────────────────────────

function buildPptxBuffer(slides) {
  const PptxGen = getPptxGen();
  if (!PptxGen) throw new Error('pptxgenjs not installed. Run: npm install pptxgenjs');

  const pptx = new PptxGen();
  pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
  pptx.layout = 'WIDE';

  for (const slide of slides) {
    const s = pptx.addSlide();

    // Background
    s.background = { fill: '0F0F1A' };

    if (slide.layout === 'title') {
      // Title slide
      s.addText(slide.title, {
        x: 0.5, y: 2.0, w: 12.33, h: 1.5,
        fontSize: 36, color: 'FFFFFF', bold: true,
        align: 'center', fontFace: 'Arial',
      });
      if (slide.bullets?.length) {
        s.addText(slide.bullets[0], {
          x: 1.5, y: 3.8, w: 10.33, h: 1,
          fontSize: 18, color: '888899',
          align: 'center', fontFace: 'Arial',
        });
      }
    } else if (slide.layout === 'section_break') {
      s.addText(slide.title, {
        x: 0.5, y: 2.5, w: 12.33, h: 1.5,
        fontSize: 32, color: '6C63FF', bold: true,
        align: 'center', fontFace: 'Arial',
      });
    } else if (slide.layout === 'closing') {
      s.addText(slide.title, {
        x: 0.5, y: 2.0, w: 12.33, h: 1.5,
        fontSize: 32, color: 'FFFFFF', bold: true,
        align: 'center', fontFace: 'Arial',
      });
      if (slide.bullets?.length) {
        const bulletText = slide.bullets.map(b => ({ text: b, options: { bullet: true, color: 'AAAACC' } }));
        s.addText(bulletText, {
          x: 2.0, y: 3.8, w: 9.33, h: 2.5,
          fontSize: 16, fontFace: 'Arial',
          valign: 'top',
        });
      }
    } else {
      // Content / two_column
      s.addText(slide.title, {
        x: 0.5, y: 0.3, w: 12.33, h: 0.8,
        fontSize: 24, color: 'FFFFFF', bold: true,
        fontFace: 'Arial',
      });
      // Divider line
      s.addShape('rect', {
        x: 0.5, y: 1.15, w: 12.33, h: 0.02,
        fill: { color: '6C63FF' },
      });

      if (slide.bullets?.length) {
        const bulletText = slide.bullets.map(b => ({
          text: b,
          options: { bullet: { type: 'bullet' }, color: 'CCCCDD', breakLine: true, paraSpaceAfter: 8 },
        }));
        s.addText(bulletText, {
          x: 0.7, y: 1.4, w: 11.93, h: 5.2,
          fontSize: 16, fontFace: 'Arial',
          valign: 'top', lineSpacingMultiple: 1.3,
        });
      }
    }

    // Speaker notes
    if (slide.speaker_notes) {
      s.addNotes(slide.speaker_notes);
    }
  }

  return pptx.write({ outputType: 'nodebuffer' });
}

// ── Markdown Generator ──────────────────────────────────────

function buildMarkdown(sections) {
  let md = '';
  for (const section of sections) {
    const prefix = '#'.repeat(section.level || 1);
    md += `${prefix} ${section.heading}\n\n`;
    if (section.body) md += `${section.body}\n\n`;
    if (section.bullets?.length) {
      md += section.bullets.map(b => `- ${b}`).join('\n') + '\n\n';
    }
  }
  return md;
}

// ── Export Handlers ─────────────────────────────────────────

async function exportDeck(nodes, idea, req, res) {
  sseHeaders(res);
  const treeText = treeToText(nodes);
  const slides = [];

  const userMessage = `Create a compelling pitch deck from this thinking tree about: "${idea}"

THINKING TREE:
${treeText}

Use the add_slide tool for each slide. Create 8-15 slides. Call finish_export when done.`;

  try {
    await runToolLoop({
      system: DECK_SYSTEM,
      userMessage,
      tools: [SLIDE_TOOL, COMPLETE_TOOL],
      signal: req.signal,
      onToolCall: (name, input, id) => {
        if (name === 'add_slide') {
          slides.push(input);
          res.write(`data: ${JSON.stringify({ _progress: true, type: 'slide_added', slideIndex: slides.length, title: input.title, layout: input.layout })}\n\n`);
          return { success: true, slideIndex: slides.length };
        }
        if (name === 'finish_export') {
          return { success: true, totalSlides: slides.length };
        }
        return { error: `Unknown tool: ${name}` };
      },
      onProgress: (p) => {
        res.write(`data: ${JSON.stringify({ _progress: true, ...p })}\n\n`);
      },
    });

    if (slides.length === 0) {
      res.write(`data: ${JSON.stringify({ _error: 'No slides were generated' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // Generate PPTX buffer
    res.write(`data: ${JSON.stringify({ _progress: true, status: 'rendering', detail: `Rendering ${slides.length} slides to PPTX...` })}\n\n`);

    const PptxGen = getPptxGen();
    if (PptxGen) {
      const buffer = await buildPptxBuffer(slides);
      const base64 = buffer.toString('base64');
      res.write(`data: ${JSON.stringify({ _file: true, format: 'pptx', base64, filename: `${(idea || 'deck').slice(0, 40).replace(/[^a-zA-Z0-9]/g, '_')}.pptx`, slideCount: slides.length })}\n\n`);
    } else {
      // Fallback: return slide data as JSON for client-side rendering
      res.write(`data: ${JSON.stringify({ _file: true, format: 'json', slides, filename: 'deck.json' })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();

    // Fire-and-forget: record artifact + update brief + generate summary (milestone)
    const sessionId = req.body?.sessionId;
    const userId = req.user?.uid || 'local';
    if (sessionId) {
      appendArtifact(sessionId, {
        type: 'export_deck',
        title: `Pitch deck (${slides.length} slides)`,
        summary: `Exported ${slides.length}-slide deck for "${(idea || '').slice(0, 60)}"`,
      }).catch(console.error);
      updateSessionBrief(sessionId, userId, 'export_deck', {
        slideCount: slides.length, idea,
      }).catch(console.error);
      generateSessionSummary(sessionId).catch(console.error);
    }
  } catch (err) {
    if (err.name === 'AbortError' || err.message === 'Export cancelled') {
      res.write(`data: ${JSON.stringify({ _error: 'Export cancelled' })}\n\n`);
    } else {
      console.error('Export deck error:', err);
      res.write(`data: ${JSON.stringify({ _error: err.message })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

async function exportDocument(nodes, idea, format, req, res) {
  sseHeaders(res);
  const treeText = treeToText(nodes);
  const sections = [];

  const userMessage = `Create a comprehensive document from this thinking tree about: "${idea}"

THINKING TREE:
${treeText}

Use the add_section tool for each section. Create a well-structured document. Call finish_export when done.`;

  try {
    await runToolLoop({
      system: DOC_SYSTEM,
      userMessage,
      tools: [DOC_SECTION_TOOL, COMPLETE_TOOL],
      signal: req.signal,
      onToolCall: (name, input, id) => {
        if (name === 'add_section') {
          sections.push(input);
          res.write(`data: ${JSON.stringify({ _progress: true, type: 'section_added', sectionIndex: sections.length, heading: input.heading, level: input.level })}\n\n`);
          return { success: true, sectionIndex: sections.length };
        }
        if (name === 'finish_export') {
          return { success: true, totalSections: sections.length };
        }
        return { error: `Unknown tool: ${name}` };
      },
      onProgress: (p) => {
        res.write(`data: ${JSON.stringify({ _progress: true, ...p })}\n\n`);
      },
    });

    if (sections.length === 0) {
      res.write(`data: ${JSON.stringify({ _error: 'No sections were generated' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    res.write(`data: ${JSON.stringify({ _progress: true, status: 'rendering', detail: `Rendering ${sections.length} sections...` })}\n\n`);

    // Generate markdown (works for all formats as intermediate)
    const markdown = buildMarkdown(sections);

    if (format === 'md') {
      const base64 = Buffer.from(markdown, 'utf-8').toString('base64');
      res.write(`data: ${JSON.stringify({ _file: true, format: 'md', base64, filename: `${(idea || 'doc').slice(0, 40).replace(/[^a-zA-Z0-9]/g, '_')}.md`, sectionCount: sections.length })}\n\n`);
    } else {
      // Return sections as JSON for now (DOCX can be added with `docx` library)
      const base64 = Buffer.from(markdown, 'utf-8').toString('base64');
      res.write(`data: ${JSON.stringify({ _file: true, format: 'md', base64, filename: `${(idea || 'doc').slice(0, 40).replace(/[^a-zA-Z0-9]/g, '_')}.md`, sectionCount: sections.length })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();

    // Fire-and-forget: record artifact + brief + summary
    const sessionId = req.body?.sessionId;
    const userId = req.user?.uid || 'local';
    if (sessionId) {
      appendArtifact(sessionId, {
        type: 'export_doc',
        title: `Document (${sections.length} sections)`,
        summary: `Exported ${sections.length}-section ${format} for "${(idea || '').slice(0, 60)}"`,
      }).catch(console.error);
      updateSessionBrief(sessionId, userId, 'export_doc', {
        sectionCount: sections.length, format, idea,
      }).catch(console.error);
      generateSessionSummary(sessionId).catch(console.error);
    }
  } catch (err) {
    if (err.name === 'AbortError' || err.message === 'Export cancelled') {
      res.write(`data: ${JSON.stringify({ _error: 'Export cancelled' })}\n\n`);
    } else {
      console.error('Export document error:', err);
      res.write(`data: ${JSON.stringify({ _error: err.message })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

// ── Google Docs Export ──────────────────────────────────────
// Creates a Google Doc with formatted content from sections.
// Requires Gmail OAuth with documents + drive.file scopes.

async function exportToGoogleDoc(sections, title) {
  const { google } = require('googleapis');
  const registry = require('../integrations/registry');
  const gmailIntegration = registry.get('gmail');

  if (!gmailIntegration?.api?.getAuthenticatedClient) {
    throw new Error('Gmail/Google not connected — sign in with Google first');
  }

  const auth = gmailIntegration.api.getAuthenticatedClient();
  if (!auth) {
    throw new Error('Google OAuth session expired — reconnect Gmail');
  }

  const docs = google.docs({ version: 'v1', auth });
  const drive = google.drive({ version: 'v3', auth });

  // Step 1: Create blank document
  let createRes;
  try {
    createRes = await docs.documents.create({
      requestBody: { title: title || 'ThoughtClaw Export' },
    });
  } catch (err) {
    if (err.message?.includes('insufficient authentication scopes') || err.code === 403) {
      throw new Error('Google Docs permission not granted. Disconnect Gmail and reconnect to grant document access.');
    }
    throw err;
  }
  const docId = createRes.data.documentId;
  const docUrl = `https://docs.google.com/document/d/${docId}/edit`;

  // Step 2: Build batchUpdate requests (forward-tracking index approach)
  const requests = [];
  let index = 1; // Google Docs body starts at index 1

  for (const section of sections) {
    // Insert heading
    const headingStyle = section.level === 1 ? 'HEADING_1' : section.level === 2 ? 'HEADING_2' : 'HEADING_3';
    const headingText = section.heading + '\n';
    requests.push({ insertText: { location: { index }, text: headingText } });
    requests.push({
      updateParagraphStyle: {
        range: { startIndex: index, endIndex: index + headingText.length },
        paragraphStyle: { namedStyleType: headingStyle },
        fields: 'namedStyleType',
      },
    });
    index += headingText.length;

    // Insert body text
    if (section.body) {
      const bodyText = section.body + '\n\n';
      requests.push({ insertText: { location: { index }, text: bodyText } });
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: index, endIndex: index + bodyText.length },
          paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
          fields: 'namedStyleType',
        },
      });
      index += bodyText.length;
    }

    // Insert bullets
    if (section.bullets?.length) {
      const bulletStartIdx = index;
      const bulletText = section.bullets.map(b => b + '\n').join('');
      requests.push({ insertText: { location: { index }, text: bulletText } });
      index += bulletText.length;
      requests.push({
        createParagraphBullets: {
          range: { startIndex: bulletStartIdx, endIndex: index },
          bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
        },
      });
      // Add spacing after bullets
      const spacer = '\n';
      requests.push({ insertText: { location: { index }, text: spacer } });
      index += spacer.length;
    }
  }

  // Step 3: Apply all formatting
  if (requests.length > 0) {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests },
    });
  }

  return { docId, docUrl, title, sectionCount: sections.length };
}

// ── Unified Export: Document + optional Google Docs push ─────
// Used by scheduler pipeline: generates sections via tool_use, then pushes to Google Docs

async function generateAndExportToGoogleDoc(nodes, idea) {
  const treeText = treeToText(nodes);
  const sections = [];

  const userMessage = `Create a comprehensive document from this thinking tree about: "${idea}"

THINKING TREE:
${treeText}

Use the add_section tool for each section. Create a well-structured document. Call finish_export when done.`;

  await runToolLoop({
    system: DOC_SYSTEM,
    userMessage,
    tools: [DOC_SECTION_TOOL, COMPLETE_TOOL],
    onToolCall: (name, input) => {
      if (name === 'add_section') {
        sections.push(input);
        return { success: true, sectionIndex: sections.length };
      }
      if (name === 'finish_export') {
        return { success: true, totalSections: sections.length };
      }
      return { error: `Unknown tool: ${name}` };
    },
    onProgress: () => {}, // silent for scheduled runs
  });

  if (sections.length === 0) {
    throw new Error('No sections generated');
  }

  // Push to Google Docs
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const docTitle = `${idea} — ${dateStr}`;
  const result = await exportToGoogleDoc(sections, docTitle);

  return {
    ...result,
    sections,
    markdown: buildMarkdown(sections),
  };
}

module.exports = { exportDeck, exportDocument, exportToGoogleDoc, generateAndExportToGoogleDoc, serializeTree, treeToText, buildMarkdown };
