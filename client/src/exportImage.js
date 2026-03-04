// ── Tree Export Utilities ─────────────────────────────────────
// PNG, SVG, clipboard, and interactive HTML export using html-to-image
// and the ReactFlow instance (via useReactFlow bridge).

import { toPng, toSvg, toBlob } from 'html-to-image';
import { getViewportForBounds } from '@xyflow/react';
import { getNodeConfig } from './nodeConfig';

const BG_COLOR = '#0a0a0f';
const PADDING = 0.1;      // 10% padding around nodes
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;

function getViewportElement() {
  return document.querySelector('.react-flow__viewport');
}

function filterChrome(node) {
  const cl = node?.classList;
  if (!cl) return true;
  if (cl.contains('react-flow__controls')) return false;
  if (cl.contains('react-flow__minimap')) return false;
  if (cl.contains('react-flow__panel')) return false;
  if (cl.contains('react-flow__background')) return false;
  return true;
}

/**
 * Core capture: sets viewport transform to show all nodes, captures, returns data.
 * Uses getViewportForBounds to compute the correct transform so all nodes fit.
 */
async function captureTree(rfInstance, captureFn, options = {}) {
  const viewportEl = getViewportElement();
  if (!viewportEl || !rfInstance) throw new Error('ReactFlow viewport not found');

  const { scale = 2 } = options;
  const nodes = rfInstance.getNodes();
  if (nodes.length === 0) throw new Error('No nodes to export');

  const nodesBounds = rfInstance.getNodesBounds(nodes);

  // Add generous padding to bounds
  const pad = 100;
  const bounds = {
    x: nodesBounds.x - pad,
    y: nodesBounds.y - pad,
    width: nodesBounds.width + pad * 2,
    height: nodesBounds.height + pad * 2,
  };

  // Image dimensions
  const imageWidth = bounds.width * scale;
  const imageHeight = bounds.height * scale;

  // Calculate the viewport transform that fits all nodes into the image
  const viewport = getViewportForBounds(
    bounds,
    imageWidth,
    imageHeight,
    MIN_ZOOM,
    MAX_ZOOM,
    PADDING
  );

  return captureFn(viewportEl, {
    backgroundColor: BG_COLOR,
    width: imageWidth,
    height: imageHeight,
    style: {
      width: `${imageWidth}px`,
      height: `${imageHeight}px`,
      transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
    },
    filter: filterChrome,
  });
}

/**
 * Export full tree as PNG data URL (2× resolution).
 */
export async function exportToPng(rfInstance, options = {}) {
  return captureTree(rfInstance, toPng, options);
}

/**
 * Export full tree as SVG string.
 */
export async function exportToSvg(rfInstance, options = {}) {
  return captureTree(rfInstance, toSvg, options);
}

/**
 * Copy tree image to clipboard (for pasting into Slack, Docs, etc.)
 */
export async function copyToClipboard(rfInstance, options = {}) {
  const blob = await captureTree(rfInstance, toBlob, options);
  await navigator.clipboard.write([
    new ClipboardItem({ 'image/png': blob }),
  ]);
}

/**
 * Trigger file download from data URL or blob URL.
 */
export function downloadDataUrl(dataUrl, filename) {
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function downloadSvg(svgString, filename) {
  const blob = new Blob([svgString], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  downloadDataUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Generate a self-contained interactive HTML file with the tree data.
 * Opens in any browser — dark theme, pan/zoom, same node colors.
 */
export function generateInteractiveHtml(rawNodes, idea) {
  const treeData = rawNodes.map((n) => {
    const d = n.data || n;
    const config = getNodeConfig(d.type, d.dynamicConfig);
    return {
      id: n.id || d.id,
      type: d.type,
      label: d.label,
      reasoning: d.reasoning || '',
      parentId: d.parentId || null,
      score: d.score,
      color: config.color,
      bg: config.bg,
      icon: config.icon,
      typeLabel: config.label,
    };
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ThoughtClaw — ${(idea || 'Export').replace(/[<>"]/g, '')}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0f;overflow:hidden;font-family:'SF Mono',Monaco,'Cascadia Code',monospace;color:#e8e8f0}
#canvas{width:100vw;height:100vh;position:relative;cursor:grab}
#canvas.dragging{cursor:grabbing}
.node{position:absolute;width:260px;border-radius:8px;padding:12px 14px;cursor:pointer;transition:box-shadow .2s}
.node:hover{box-shadow:0 0 20px rgba(108,99,255,0.3)!important}
.node-accent{position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:0 2px 2px 0;opacity:.7}
.node-type{display:flex;align-items:center;gap:6px;margin-bottom:8px}
.node-type-icon{font-size:12px}
.node-type-label{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;opacity:.95}
.node-label{font-size:13px;font-weight:600;line-height:1.4;margin-bottom:8px;letter-spacing:.01em}
.node-reasoning{color:#7070a0;font-size:11px;line-height:1.5;border-top:1px solid rgba(255,255,255,.06);padding-top:7px;font-style:italic}
.node-score{position:absolute;top:7px;right:10px;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700}
.edge{position:absolute;pointer-events:none}
svg{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible}
#info{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#16161f;border:1px solid #2a2a3a;border-radius:20px;padding:8px 18px;font-size:11px;color:#8888aa;letter-spacing:.06em;z-index:10}
#zoom-info{position:fixed;top:12px;right:16px;background:#16161f;border:1px solid #2a2a3a;border-radius:8px;padding:6px 12px;font-size:10px;color:#8888aa;z-index:10}
</style>
</head>
<body>
<div id="canvas"></div>
<div id="info">${treeData.length} nodes — scroll to zoom, drag to pan</div>
<div id="zoom-info">100%</div>
<script>
const DATA=${JSON.stringify(treeData)};
const canvas=document.getElementById('canvas');
const zoomInfo=document.getElementById('zoom-info');
let scale=1,tx=0,ty=0,dragging=false,dragX=0,dragY=0;

// Simple top-down layout
function layout(nodes){
  const byParent={};const depths={};const positions={};
  nodes.forEach(n=>{
    const pid=n.parentId||'__root__';
    if(!byParent[pid])byParent[pid]=[];
    byParent[pid].push(n);
  });
  function calcDepth(id,d){
    depths[id]=d;
    (byParent[id]||[]).forEach(c=>calcDepth(c.id,d+1));
  }
  const roots=nodes.filter(n=>!n.parentId);
  roots.forEach(r=>calcDepth(r.id,0));
  const depthNodes={};
  nodes.forEach(n=>{
    const d=depths[n.id]||0;
    if(!depthNodes[d])depthNodes[d]=[];
    depthNodes[d].push(n);
  });
  Object.keys(depthNodes).forEach(d=>{
    const arr=depthNodes[d];
    const totalWidth=arr.length*340;
    const startX=-totalWidth/2+170;
    arr.forEach((n,i)=>{
      positions[n.id]={x:startX+i*340,y:d*200};
    });
  });
  return positions;
}

const pos=layout(DATA);

// Center on nodes
const xs=Object.values(pos).map(p=>p.x);
const ys=Object.values(pos).map(p=>p.y);
const cx=(Math.min(...xs)+Math.max(...xs))/2;
const cy=(Math.min(...ys)+Math.max(...ys))/2;
tx=window.innerWidth/2-cx;
ty=window.innerHeight/2-cy+60;

// Draw edges
const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
svg.style.position='absolute';svg.style.top='0';svg.style.left='0';
svg.style.width='100%';svg.style.height='100%';svg.style.overflow='visible';
canvas.appendChild(svg);

function drawEdges(){
  svg.innerHTML='';
  DATA.forEach(n=>{
    if(!n.parentId||!pos[n.parentId])return;
    const p1=pos[n.parentId];const p2=pos[n.id];
    const x1=p1.x+130;const y1=p1.y+100;
    const x2=p2.x+130;const y2=p2.y;
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    const my=(y1+y2)/2;
    path.setAttribute('d','M '+x1+' '+y1+' C '+x1+' '+my+' '+x2+' '+my+' '+x2+' '+y2);
    path.setAttribute('fill','none');
    path.setAttribute('stroke',n.color);
    path.setAttribute('stroke-width','1.5');
    path.setAttribute('stroke-opacity','0.35');
    svg.appendChild(path);
  });
}
drawEdges();

// Draw nodes
DATA.forEach(n=>{
  const p=pos[n.id];if(!p)return;
  const div=document.createElement('div');
  div.className='node';
  div.style.left=p.x+'px';div.style.top=p.y+'px';
  div.style.background=n.bg;
  div.style.border='1px solid '+n.color;
  div.style.boxShadow='0 0 12px '+n.color+'50, 0 2px 8px rgba(0,0,0,0.4)';
  div.innerHTML=
    '<div class="node-accent" style="background:'+n.color+'"></div>'+
    '<div class="node-type"><span class="node-type-icon" style="color:'+n.color+'">'+n.icon+'</span>'+
    '<span class="node-type-label" style="color:'+n.color+'">'+n.typeLabel+'</span></div>'+
    '<div class="node-label">'+n.label+'</div>'+
    (n.reasoning?'<div class="node-reasoning">'+n.reasoning+'</div>':'')+
    (n.score!=null?'<div class="node-score" style="background:'+(n.score>=8?'rgba(34,197,94,0.15)':n.score>=5?'rgba(250,204,21,0.15)':'rgba(248,113,113,0.15)')+';color:'+(n.score>=8?'#22c55e':n.score>=5?'#facc15':'#f87171')+';border:1px solid '+(n.score>=8?'rgba(34,197,94,0.3)':n.score>=5?'rgba(250,204,21,0.3)':'rgba(248,113,113,0.3)')+'">'+n.score+'/10</div>':'');
  div.title=n.label+(n.reasoning?'\\n\\n'+n.reasoning:'');
  canvas.appendChild(div);
});

function applyTransform(){
  canvas.style.transform='translate('+tx+'px,'+ty+'px) scale('+scale+')';
  canvas.style.transformOrigin='0 0';
  zoomInfo.textContent=Math.round(scale*100)+'%';
}
applyTransform();

// Pan
document.addEventListener('mousedown',e=>{if(e.target.closest('.node'))return;dragging=true;dragX=e.clientX-tx;dragY=e.clientY-ty;canvas.classList.add('dragging')});
document.addEventListener('mousemove',e=>{if(!dragging)return;tx=e.clientX-dragX;ty=e.clientY-dragY;applyTransform()});
document.addEventListener('mouseup',()=>{dragging=false;canvas.classList.remove('dragging')});

// Zoom
document.addEventListener('wheel',e=>{
  e.preventDefault();
  const rect=document.body.getBoundingClientRect();
  const mx=e.clientX;const my=e.clientY;
  const oldScale=scale;
  scale*=e.deltaY>0?0.9:1.1;
  scale=Math.max(0.05,Math.min(5,scale));
  tx=mx-(mx-tx)*(scale/oldScale);
  ty=my-(my-ty)*(scale/oldScale);
  applyTransform();
},{passive:false});
</script>
</body>
</html>`;
}

export function downloadHtml(htmlString, filename) {
  const blob = new Blob([htmlString], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  downloadDataUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
