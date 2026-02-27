import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import { getNodeConfig } from './nodeConfig';

// ── Semantic cluster centers (YZ plane — X is reserved for temporal axis) ─────
const TYPE_CLUSTERS = {
  seed:           { y:    0, z:    0 },
  problem:        { y: -110, z:   80 },
  user_segment:   { y:  110, z:   80 },
  job_to_be_done: { y:   50, z:  150 },
  feature:        { y:    0, z: -110 },
  component:      { y:  -60, z: -180 },
  api_endpoint:   { y:   60, z: -180 },
  data_model:     { y: -110, z: -110 },
  constraint:     { y: -180, z:    0 },
  metric:         { y:  180, z:    0 },
  insight:        { y:  130, z:  -70 },
  tech_debt:      { y: -130, z:  -70 },
  critique:       { y:    0, z:  190 },
};

// ── Round Z-layer labels ───────────────────────────────────────────────────────
const ROUND_LABELS = {
  0:  'SEED',
  1:  'GENERATE',
  2:  'R1 CRITIQUE',
  3:  'R1 REBUT',
  4:  'R2 CRITIQUE',
  5:  'R2 REBUT',
  6:  'R3 CRITIQUE',
  7:  'R3 REBUT',
  8:  'R4 CRITIQUE',
  9:  'R4 REBUT',
  10: 'R5 CRITIQUE',
  11: 'R5 REBUT',
  12: 'SYNTHESIS',
};

// Short labels for timeline ticks
const ROUND_SHORT = {
  0: 'SEED', 1: 'GEN', 2: 'C1', 3: 'B1', 4: 'C2', 5: 'B2',
  6: 'C3', 7: 'B3', 8: 'C4', 9: 'B4', 10: 'C5', 11: 'B5', 12: 'SYN',
};

// Floor plane colors by round phase
function getPlaneColor(roundIndex) {
  if (roundIndex === 0 || roundIndex === 1) return 0x1a3a1a; // green — seed/generate
  if (roundIndex === 12) return 0x3a3a1a;                    // gold  — synthesis
  if (roundIndex % 2 === 0) return 0x3a1a1a;                 // red   — critique
  return 0x1a1a3a;                                            // blue  — rebut
}

const ROUND_SPACING = 160; // units per round along X-axis (left→right)
const PLANE_SIZE = 500;    // height/depth of vertical divider planes

// ── Round index from node ─────────────────────────────────────────────────────
function getRoundIndex(node) {
  const id   = node.id || '';
  const type = (node.data?.type || node.type || '').toLowerCase();
  if (type === 'seed') return 0;
  const crit  = id.match(/crit_r(\d+)/);  if (crit)  return parseInt(crit[1])  * 2;
  const rebut = id.match(/rebut_r(\d+)/); if (rebut) return parseInt(rebut[1]) * 2 + 1;
  if (/^(fin_|syn_|finalize_|synthesis_)/.test(id)) return 12;
  return 1; // default: generate
}

// ── Make a canvas-texture label sprite ───────────────────────────────────────
function makeLabelSprite(text, color, fontSize = 20, canvasW = 320, canvasH = 64) {
  const canvas = document.createElement('canvas');
  canvas.width  = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvasW, canvasH);
  ctx.font = `bold ${fontSize}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.fillText(text, 4, canvasH * 0.72);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.92, depthWrite: false });
}

// ── Link key helper ──────────────────────────────────────────────────────────
function linkKey(link) {
  const src = typeof link.source === 'object' ? link.source.id : link.source;
  const tgt = typeof link.target === 'object' ? link.target.id : link.target;
  return `${src}→${tgt}`;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Graph3D({ nodes, onNodeClick }) {
  const fgRef        = useRef();
  const containerRef = useRef();
  const planesRef    = useRef([]);
  const nodeObjsRef  = useRef(new Map());  // nodeId → THREE.Group

  // ── Core UI state ──────────────────────────────────────────────────────────
  const [dims, setDims]               = useState({ width: 800, height: 600 });
  const [hoverNode, setHoverNode]     = useState(null);

  // ── Temporal navigation state ──────────────────────────────────────────────
  const [roundRange, setRoundRange]       = useState([0, 12]);
  const [isPlaying, setIsPlaying]         = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isolatedRound, setIsolatedRound] = useState(null);
  const playbackRef = useRef(null);
  const pathAnimRef = useRef({ chain: [], litUpTo: -1, startTime: 0, frameId: null });

  // Track container size
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setDims({ width, height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // ── Build graph data + adjacency maps ───────────────────────────────────────
  const graphData = useMemo(() => {
    const nodeMap = {};
    const gNodes = nodes.map(n => {
      const type       = (n.data?.type || n.type || 'feature').toLowerCase();
      const cluster    = TYPE_CLUSTERS[type] || { y: 0, z: 0 };
      const roundIndex = getRoundIndex(n);
      const jitter     = () => (Math.random() - 0.5) * 120;
      const node = {
        id:         n.id,
        label:      n.data?.label    || n.label    || '',
        reasoning:  n.data?.reasoning|| n.reasoning|| '',
        type,
        roundIndex,
        x: roundIndex * ROUND_SPACING,   // temporal axis: left → right
        y: cluster.y + jitter(),
        z: cluster.z + jitter(),
        color: getNodeConfig(type).color,
      };
      nodeMap[n.id] = node;
      return node;
    });

    const links = nodes
      .filter(n => n.data?.parentId || n.parentId)
      .map(n => ({ source: n.data?.parentId || n.parentId, target: n.id }))
      .filter(l => nodeMap[l.source] && nodeMap[l.target]);

    // Build adjacency for path tracing
    const parentMap   = {}; // childId  → parentId
    const childrenMap = {}; // parentId → [childId, …]
    links.forEach(l => {
      parentMap[l.target] = l.source;
      if (!childrenMap[l.source]) childrenMap[l.source] = [];
      childrenMap[l.source].push(l.target);
    });

    return { nodes: gNodes, links, parentMap, childrenMap, nodeMap };
  }, [nodes]);

  // Max round present in data
  const maxRound = useMemo(() => {
    return Math.max(0, ...graphData.nodes.map(n => n.roundIndex));
  }, [graphData]);

  // Sync roundRange max when data changes
  useEffect(() => {
    setRoundRange(prev => [prev[0], Math.min(prev[1], maxRound) || maxRound]);
  }, [maxRound]);

  // ── Visibility map: combines roundRange + isolatedRound ─────────────────────
  const visibility = useMemo(() => {
    const map = new Map();
    graphData.nodes.forEach(node => {
      let inRange;
      if (isolatedRound !== null) {
        inRange = node.roundIndex === isolatedRound;
      } else {
        inRange = node.roundIndex >= roundRange[0] && node.roundIndex <= roundRange[1];
      }
      map.set(node.id, { inRange });
    });
    return map;
  }, [graphData, roundRange, isolatedRound]);

  // ── Compute highlighted path on hover ───────────────────────────────────────
  const highlight = useMemo(() => {
    const nodeIds  = new Set();
    const linkKeys = new Set();
    if (!hoverNode) return { nodeIds, linkKeys, active: false };

    nodeIds.add(hoverNode.id);

    // Walk full ancestor chain up to root
    let cur = hoverNode.id;
    while (graphData.parentMap[cur]) {
      const parent = graphData.parentMap[cur];
      linkKeys.add(`${parent}→${cur}`);
      nodeIds.add(parent);
      cur = parent;
    }

    // Walk descendants (all, recursively)
    const walkDown = (id) => {
      (graphData.childrenMap[id] || []).forEach(childId => {
        nodeIds.add(childId);
        linkKeys.add(`${id}→${childId}`);
        walkDown(childId);
      });
    };
    walkDown(hoverNode.id);

    return { nodeIds, linkKeys, active: true };
  }, [hoverNode, graphData]);

  // ── Unified material update ─────────────────────────────────────────────────
  const updateNodeMaterials = useCallback(() => {
    const hasHover   = highlight.active;
    const animChain  = pathAnimRef.current.chain;
    const animLitUpTo = pathAnimRef.current.litUpTo;

    nodeObjsRef.current.forEach((group, id) => {
      const vis      = visibility.get(id) || { inRange: true };
      const onPath   = hasHover && highlight.nodeIds.has(id);
      const isHovered = hoverNode && id === hoverNode.id;

      // Temporal cascade: is this node lit yet?
      let cascadeLit = true;
      if (hasHover && animChain.length > 0) {
        const chainIdx = animChain.indexOf(id);
        if (chainIdx !== -1 && chainIdx > animLitUpTo) {
          cascadeLit = false;
        }
      }

      let opacity, emissive;

      if (!vis.inRange) {
        // Out of visible range
        if (onPath && cascadeLit) {
          opacity = 0.22;  // ghost path through hidden rounds
          emissive = 0.18;
        } else {
          opacity = 0.04;
          emissive = 0.02;
        }
      } else if (hasHover) {
        if (isHovered) {
          opacity = 1; emissive = 0.9;
        } else if (onPath && cascadeLit) {
          opacity = 1; emissive = 0.35;
        } else if (onPath && !cascadeLit) {
          opacity = 0.12; emissive = 0.04; // will animate to full
        } else {
          opacity = 0.08; emissive = 0.02;
        }
      } else {
        opacity = 1; emissive = 0.35;
      }

      const sphere = group.children[0];
      const label  = group.children[1];

      if (sphere?.material) {
        sphere.material.transparent = true;
        sphere.material.opacity = opacity;
        sphere.material.emissiveIntensity = emissive;
      }
      if (label?.material) {
        label.material.opacity = opacity > 0.4 ? 0.92 : opacity * 2;
      }
    });
  }, [visibility, highlight, hoverNode]);

  useEffect(() => { updateNodeMaterials(); }, [updateNodeMaterials]);

  // ── Temporal path cascade animation ─────────────────────────────────────────
  useEffect(() => {
    // Cancel previous animation
    if (pathAnimRef.current.frameId) {
      cancelAnimationFrame(pathAnimRef.current.frameId);
      pathAnimRef.current.frameId = null;
    }

    if (!hoverNode) {
      pathAnimRef.current = { chain: [], litUpTo: -1, startTime: 0, frameId: null };
      updateNodeMaterials();
      return;
    }

    // Build ordered chain: root → … → hoverNode
    const chain = [];
    let cur = hoverNode.id;
    while (cur) {
      chain.unshift(cur);
      cur = graphData.parentMap[cur];
    }

    pathAnimRef.current.chain = chain;
    pathAnimRef.current.litUpTo = -1;
    pathAnimRef.current.startTime = performance.now();

    const DELAY_PER_HOP = 80; // ms between each node lighting up

    const animate = (now) => {
      const elapsed = now - pathAnimRef.current.startTime;
      const newLitUpTo = Math.min(Math.floor(elapsed / DELAY_PER_HOP), chain.length - 1);

      if (newLitUpTo !== pathAnimRef.current.litUpTo) {
        pathAnimRef.current.litUpTo = newLitUpTo;
        updateNodeMaterials();

        // Emit particle on the newly-lit link
        if (newLitUpTo > 0) {
          const fg = fgRef.current;
          if (fg && fg.emitParticle) {
            const fromId = chain[newLitUpTo - 1];
            const toId = chain[newLitUpTo];
            const matchingLink = graphData.links.find(l => {
              const src = typeof l.source === 'object' ? l.source.id : l.source;
              const tgt = typeof l.target === 'object' ? l.target.id : l.target;
              return src === fromId && tgt === toId;
            });
            if (matchingLink) {
              try { fg.emitParticle(matchingLink); } catch (e) { /* ignore */ }
            }
          }
        }
      }

      if (newLitUpTo < chain.length - 1) {
        pathAnimRef.current.frameId = requestAnimationFrame(animate);
      } else {
        pathAnimRef.current.frameId = null;
      }
    };

    pathAnimRef.current.frameId = requestAnimationFrame(animate);

    return () => {
      if (pathAnimRef.current.frameId) {
        cancelAnimationFrame(pathAnimRef.current.frameId);
        pathAnimRef.current.frameId = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverNode, graphData]);

  // ── Playback engine ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (playbackRef.current) {
      clearInterval(playbackRef.current);
      playbackRef.current = null;
    }

    if (!isPlaying) return;

    const intervalMs = 1200 / playbackSpeed;

    playbackRef.current = setInterval(() => {
      setRoundRange(prev => {
        const next = Math.min(prev[1] + 1, maxRound);
        if (next >= maxRound) setIsPlaying(false);
        return [0, next];
      });
    }, intervalMs);

    return () => {
      if (playbackRef.current) clearInterval(playbackRef.current);
    };
  }, [isPlaying, playbackSpeed, maxRound]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (playbackRef.current) clearInterval(playbackRef.current);
      if (pathAnimRef.current.frameId) cancelAnimationFrame(pathAnimRef.current.frameId);
    };
  }, []);

  // ── Camera reset helper ──────────────────────────────────────────────────
  const resetCamera = useCallback((duration = 800) => {
    const fg = fgRef.current;
    if (!fg) return;
    // Center of the timeline along X
    const midX = (maxRound * ROUND_SPACING) / 2;
    fg.cameraPosition(
      { x: midX, y: -150, z: 900 },      // camera position: front-above
      { x: midX, y:    0, z:   0 },       // look-at: center of graph
      duration
    );
  }, [maxRound]);

  // ── D3 force customization ────────────────────────────────────────────────
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    try {
      const d3force3d = require('d3-force-3d');
      // X = temporal axis (left → right, very strong)
      fg.d3Force('temporal', d3force3d.forceX().strength(0.95).x(n => n.roundIndex * ROUND_SPACING));
      // Y & Z = semantic clustering (weak, keeps types grouped)
      fg.d3Force('clusterY', d3force3d.forceY().strength(0.12).y(n => TYPE_CLUSTERS[n.type]?.y ?? 0));
      fg.d3Force('clusterZ', d3force3d.forceZ().strength(0.12).z(n => TYPE_CLUSTERS[n.type]?.z ?? 0));
      // Remove default centering forces that would fight temporal layout
      fg.d3Force('center', null);
    } catch (e) {
      // fallback
    }
    fg.d3Force('charge')?.strength(-180);
    fg.d3Force('link')?.distance(80);

    // Initial camera: side view looking at the center of the timeline
    setTimeout(() => {
      resetCamera(800);
    }, 400);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Floor planes per round (enhanced) ───────────────────────────────────────
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || graphData.nodes.length === 0) return;

    const scene = fg.scene();
    planesRef.current.forEach(obj => {
      scene.remove(obj);
      // Dispose geometries/materials
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
    planesRef.current = [];

    const presentRounds = [...new Set(graphData.nodes.map(n => n.roundIndex))].sort((a, b) => a - b);

    presentRounds.forEach(ri => {
      const xPos = ri * ROUND_SPACING;
      const isActive = isolatedRound === ri;
      const inRange = isolatedRound !== null ? isActive : (ri >= roundRange[0] && ri <= roundRange[1]);

      // ─ Vertical divider plane (YZ plane at this X position) ─
      const planeMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE),
        new THREE.MeshBasicMaterial({
          color: getPlaneColor(ri),
          transparent: true,
          opacity: isActive ? 0.18 : inRange ? 0.07 : 0.02,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      planeMesh.rotation.y = Math.PI / 2;  // face along X-axis
      planeMesh.position.set(xPos, 0, 0);
      planeMesh.userData = { roundIndex: ri };
      scene.add(planeMesh);
      planesRef.current.push(planeMesh);

      // ─ Border edges ─
      const edgeGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE));
      const edgeMat = new THREE.LineBasicMaterial({
        color: getPlaneColor(ri),
        transparent: true,
        opacity: isActive ? 0.4 : inRange ? 0.15 : 0.04,
        depthWrite: false,
      });
      const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
      edgeLines.rotation.y = Math.PI / 2;
      edgeLines.position.set(xPos, 0, 0);
      scene.add(edgeLines);
      planesRef.current.push(edgeLines);

      // ─ Round label (positioned at top of divider) ─
      const label = ROUND_LABELS[ri] || `ROUND ${ri}`;
      const labelColor = ri % 2 === 0 && ri > 0 && ri < 12 ? '#f87171'
        : ri % 2 === 1 ? '#60a5fa'
        : ri === 12 ? '#fbbf24' : '#4ade80';
      const spriteMat = makeLabelSprite(label, labelColor, 24, 300, 60);
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.set(90, 18, 1);
      sprite.position.set(xPos, PLANE_SIZE / 2 + 20, 0);
      sprite.material.opacity = inRange ? 0.92 : 0.15;
      scene.add(sprite);
      planesRef.current.push(sprite);
    });
  }, [graphData, isolatedRound, roundRange]);

  // ── Custom node 3D object ─────────────────────────────────────────────────
  const nodeThreeObject = useCallback((node) => {
    const group = new THREE.Group();

    const radius = node.type === 'seed' ? 9 : 5.5;
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 16, 16),
      new THREE.MeshLambertMaterial({
        color:            node.color,
        emissive:         node.color,
        emissiveIntensity: 0.35,
        transparent:       true,
        opacity:           1,
      })
    );
    group.add(sphere);

    const spriteMat = makeLabelSprite(node.label.slice(0, 36), node.color, 22, 360, 64);
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(72, 16, 1);
    sprite.position.set(34, 4, 0);
    group.add(sprite);

    nodeObjsRef.current.set(node.id, group);
    return group;
  }, []);

  // ── Dynamic link styling ────────────────────────────────────────────────────
  const getLinkColor = useCallback((link) => {
    const srcNode = typeof link.source === 'object' ? link.source : null;
    const tgtNode = typeof link.target === 'object' ? link.target : null;
    const srcVis  = visibility.get(srcNode?.id);
    const tgtVis  = visibility.get(tgtNode?.id);
    const bothOut = srcVis && tgtVis && !srcVis.inRange && !tgtVis.inRange;
    const anyOut  = srcVis && tgtVis && (!srcVis.inRange || !tgtVis.inRange);

    if (bothOut && !highlight.active) return 'rgba(255,255,255,0.02)';

    if (!highlight.active) {
      if (anyOut) return 'rgba(255,255,255,0.06)';
      return 'rgba(255,255,255,0.18)';
    }

    const key = linkKey(link);
    if (highlight.linkKeys.has(key)) {
      return tgtNode?.color || '#ffffff';
    }
    return 'rgba(255,255,255,0.03)';
  }, [highlight, visibility]);

  const getLinkWidth = useCallback((link) => {
    if (!highlight.active) {
      const srcVis = visibility.get(typeof link.source === 'object' ? link.source.id : link.source);
      const tgtVis = visibility.get(typeof link.target === 'object' ? link.target.id : link.target);
      if (srcVis && tgtVis && !srcVis.inRange && !tgtVis.inRange) return 0.1;
      return 0.8;
    }
    return highlight.linkKeys.has(linkKey(link)) ? 2.8 : 0.2;
  }, [highlight, visibility]);

  const getLinkParticles = useCallback((link) => {
    if (!highlight.active) return 0;
    return highlight.linkKeys.has(linkKey(link)) ? 4 : 0;
  }, [highlight]);

  const getLinkParticleWidth = useCallback((link) => {
    return highlight.linkKeys.has(linkKey(link)) ? 2.5 : 0;
  }, [highlight]);

  // ── Hover handler ───────────────────────────────────────────────────────────
  const handleNodeHover = useCallback((node) => {
    setHoverNode(node || null);
  }, []);

  // ── Click handler: fly to node ──────────────────────────────────────────────
  const handleNodeClick = useCallback((node) => {
    const fg = fgRef.current;
    if (fg && node) {
      const dist = 280;
      fg.cameraPosition(
        { x: node.x, y: node.y - 80, z: node.z + dist },   // front-above view of node
        { x: node.x, y: node.y,      z: node.z },
        800
      );
    }
    onNodeClick?.(node);
  }, [onNodeClick]);

  // ── Background click: floor plane raycasting ────────────────────────────────
  const handleBackgroundClick = useCallback((event) => {
    const fg = fgRef.current;
    if (!fg) return;

    const camera   = fg.camera();
    const renderer = fg.renderer();
    const rect     = renderer.domElement.getBoundingClientRect();

    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    const planeMeshes = planesRef.current.filter(obj => obj.isMesh);
    const hits = raycaster.intersectObjects(planeMeshes);

    if (hits.length > 0) {
      const ri = hits[0].object.userData.roundIndex;
      if (ri !== undefined) {
        setIsolatedRound(prev => prev === ri ? null : ri);
        if (isPlaying) setIsPlaying(false);
      }
    } else {
      setIsolatedRound(null);
    }
  }, [isPlaying]);

  // ── Tooltip derived from hover ──────────────────────────────────────────────
  const tooltip = hoverNode ? {
    label:     hoverNode.label,
    reasoning: hoverNode.reasoning,
    type:      hoverNode.type,
    round:     ROUND_LABELS[hoverNode.roundIndex] || `Round ${hoverNode.roundIndex}`,
    color:     hoverNode.color,
    ancestors: (() => {
      const chain = [];
      let cur = hoverNode.id;
      while (graphData.parentMap[cur]) {
        cur = graphData.parentMap[cur];
        const n = graphData.nodeMap[cur];
        if (n) chain.push(n.label);
      }
      return chain;
    })(),
    childCount: (graphData.childrenMap[hoverNode.id] || []).length,
  } : null;

  // ── Playback controls ──────────────────────────────────────────────────────
  const handlePlay = useCallback(() => {
    if (isolatedRound !== null) setIsolatedRound(null);
    if (!isPlaying && roundRange[1] >= maxRound) {
      setRoundRange([0, 0]);
    }
    setIsPlaying(p => !p);
  }, [isolatedRound, isPlaying, roundRange, maxRound]);

  const handleSliderMin = useCallback((e) => {
    const v = Number(e.target.value);
    setRoundRange(prev => [Math.min(v, prev[1]), prev[1]]);
    setIsolatedRound(null);
    if (isPlaying) setIsPlaying(false);
  }, [isPlaying]);

  const handleSliderMax = useCallback((e) => {
    const v = Number(e.target.value);
    setRoundRange(prev => [prev[0], Math.max(v, prev[0])]);
    setIsolatedRound(null);
    if (isPlaying) setIsPlaying(false);
  }, [isPlaying]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', background: '#0a0a0f' }}>

      {/* Range input thumb styling */}
      <style>{`
        .g3d-range { margin: 0; padding: 0; }
        .g3d-range::-webkit-slider-thumb {
          pointer-events: all;
          -webkit-appearance: none;
          width: 14px; height: 14px;
          border-radius: 50%;
          background: #6c63ff;
          border: 2px solid #0a0a0f;
          cursor: pointer;
          position: relative;
          z-index: 5;
          margin-top: -5px;
        }
        .g3d-range::-moz-range-thumb {
          pointer-events: all;
          width: 14px; height: 14px;
          border-radius: 50%;
          background: #6c63ff;
          border: 2px solid #0a0a0f;
          cursor: pointer;
        }
        .g3d-range::-webkit-slider-runnable-track {
          height: 4px; background: transparent;
        }
        .g3d-range::-moz-range-track {
          height: 4px; background: transparent;
        }
      `}</style>

      <ForceGraph3D
        ref={fgRef}
        graphData={graphData}
        backgroundColor="#0a0a0f"
        controlType="orbit"
        nodeThreeObject={nodeThreeObject}
        nodeThreeObjectExtend={false}
        linkColor={getLinkColor}
        linkWidth={getLinkWidth}
        linkOpacity={0.9}
        linkDirectionalParticles={getLinkParticles}
        linkDirectionalParticleWidth={getLinkParticleWidth}
        linkDirectionalParticleSpeed={0.006}
        linkDirectionalArrowLength={5}
        linkDirectionalArrowRelPos={0.85}
        linkDirectionalArrowColor={getLinkColor}
        enableNodeDrag={false}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        onBackgroundClick={handleBackgroundClick}
        width={dims.width}
        height={dims.height}
        showNavInfo={false}
      />

      {/* ── Hover tooltip ──────────────────────────────────────────────────── */}
      {tooltip && (
        <div style={{
          position: 'absolute', bottom: 72, left: 24,
          background: 'rgba(10,10,20,0.94)',
          border: `1px solid ${tooltip.color}55`,
          borderRadius: 10, padding: '12px 16px',
          maxWidth: 360, pointerEvents: 'none',
          zIndex: 10, backdropFilter: 'blur(8px)',
        }}>
          <div style={{ color: tooltip.color, fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
            {tooltip.label}
          </div>
          <div style={{ color: '#888', fontSize: 10, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
            {tooltip.type} · {tooltip.round}
          </div>
          {tooltip.ancestors.length > 0 && (
            <div style={{ marginBottom: 6, fontSize: 10, color: '#666', lineHeight: 1.6 }}>
              <span style={{ color: '#555', textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 4 }}>Path:</span>
              {[...tooltip.ancestors].reverse().map((a, i) => (
                <span key={i}>
                  <span style={{ color: '#999' }}>{a.length > 28 ? a.slice(0, 28) + '…' : a}</span>
                  <span style={{ color: '#444', margin: '0 3px' }}> → </span>
                </span>
              ))}
              <span style={{ color: tooltip.color, fontWeight: 600 }}>this</span>
            </div>
          )}
          {tooltip.childCount > 0 && (
            <div style={{ fontSize: 10, color: '#555', marginBottom: 6 }}>
              ↳ {tooltip.childCount} child node{tooltip.childCount > 1 ? 's' : ''}
            </div>
          )}
          <div style={{ color: '#ccc', fontSize: 12, lineHeight: 1.5 }}>
            {tooltip.reasoning}
          </div>
        </div>
      )}

      {/* ── Legend ──────────────────────────────────────────────────────────── */}
      <div style={{
        position: 'absolute', top: 16, right: 16,
        background: 'rgba(10,10,20,0.85)',
        border: '1px solid #ffffff11',
        borderRadius: 8, padding: '10px 14px',
        fontSize: 10, color: '#666',
      }}>
        <div style={{ color: '#888', fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>LEFT → RIGHT = TIME</div>
        {[
          { label: 'SEED',       color: '#ffffff' },
          { label: 'GENERATE',   color: '#4ade80' },
          { label: 'CRITIQUE',   color: '#f87171' },
          { label: 'REBUT',      color: '#60a5fa' },
          { label: 'SYNTHESIS',  color: '#fbbf24' },
        ].map(({ label, color }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, pointerEvents: 'none' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
            <span style={{ color: '#aaa' }}>{label}</span>
          </div>
        ))}
        <div style={{ marginTop: 8, color: '#555', lineHeight: 1.6, borderTop: '1px solid #ffffff0a', paddingTop: 8, pointerEvents: 'none' }}>
          Hover → trace path<br/>
          Click node → fly to focus<br/>
          Left drag → orbit<br/>
          Right drag → pan / move<br/>
          Scroll → zoom
        </div>
        <button
          onClick={() => resetCamera(800)}
          style={{
            marginTop: 8, width: '100%',
            background: 'transparent',
            border: '1px solid #6c63ff44',
            color: '#6c63ff',
            fontFamily: 'monospace', fontSize: 10, fontWeight: 700,
            padding: '5px 0', borderRadius: 4, cursor: 'pointer',
            letterSpacing: '0.08em',
            transition: 'border-color 0.15s, background 0.15s',
          }}
          onMouseEnter={e => { e.target.style.background = '#6c63ff22'; e.target.style.borderColor = '#6c63ff'; }}
          onMouseLeave={e => { e.target.style.background = 'transparent'; e.target.style.borderColor = '#6c63ff44'; }}
        >
          ↺ RESET VIEW
        </button>
      </div>

      {/* ── Timeline Controls ──────────────────────────────────────────────── */}
      <div style={{
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
        background: 'rgba(10,10,20,0.92)',
        borderTop: '1px solid #2a2a3a',
        padding: '8px 16px 10px',
        zIndex: 10,
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>

        {/* Play / Pause */}
        <button
          onClick={handlePlay}
          style={{
            background: 'transparent',
            border: `1px solid ${isPlaying ? '#ff5f6d' : '#6c63ff'}`,
            color: isPlaying ? '#ff5f6d' : '#6c63ff',
            fontFamily: 'monospace',
            fontSize: 12,
            fontWeight: 700,
            padding: '3px 0',
            borderRadius: 5,
            cursor: 'pointer',
            width: 32,
            flexShrink: 0,
            lineHeight: 1,
          }}
        >
          {isPlaying ? '■' : '▶'}
        </button>

        {/* Speed */}
        <select
          value={playbackSpeed}
          onChange={e => setPlaybackSpeed(Number(e.target.value))}
          style={{
            background: '#111118',
            border: '1px solid #2a2a3a',
            color: '#888',
            fontFamily: 'monospace',
            fontSize: 9,
            padding: '3px 2px',
            borderRadius: 4,
            cursor: 'pointer',
            width: 40,
            flexShrink: 0,
          }}
        >
          <option value={0.5}>0.5×</option>
          <option value={1}>1×</option>
          <option value={2}>2×</option>
        </select>

        {/* Dual range slider */}
        <div style={{ flex: 1, position: 'relative', height: 36, display: 'flex', alignItems: 'center' }}>

          {/* Track bg */}
          <div style={{
            position: 'absolute', left: 0, right: 0, height: 4, top: 10,
            background: '#1a1a2a', borderRadius: 2, pointerEvents: 'none',
          }} />

          {/* Active range segment */}
          <div style={{
            position: 'absolute',
            left: `${(roundRange[0] / (maxRound || 1)) * 100}%`,
            width: `${(((roundRange[1] - roundRange[0]) / (maxRound || 1)) * 100)}%`,
            height: 4, top: 10,
            background: isolatedRound !== null ? '#fbbf24' : '#6c63ff',
            borderRadius: 2, pointerEvents: 'none',
          }} />

          {/* Tick marks + labels */}
          {Array.from({ length: (maxRound || 0) + 1 }, (_, i) => {
            const inRange = isolatedRound !== null
              ? i === isolatedRound
              : i >= roundRange[0] && i <= roundRange[1];
            return (
              <div key={i} style={{
                position: 'absolute',
                left: `${(i / (maxRound || 1)) * 100}%`,
                top: 0,
                transform: 'translateX(-50%)',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                pointerEvents: 'none',
              }}>
                <div style={{
                  width: 1, height: 6,
                  background: inRange ? '#6c63ff' : '#333',
                  marginBottom: 1,
                }} />
                <div style={{ height: 8 }} /> {/* spacer for slider track */}
                <span style={{
                  fontSize: 7, marginTop: 2,
                  color: inRange ? '#888' : '#383838',
                  whiteSpace: 'nowrap',
                  letterSpacing: '0.02em',
                  fontFamily: 'monospace',
                }}>
                  {ROUND_SHORT[i] || i}
                </span>
              </div>
            );
          })}

          {/* Min handle */}
          <input
            type="range" className="g3d-range"
            min={0} max={maxRound || 1} step={1}
            value={roundRange[0]}
            onChange={handleSliderMin}
            style={{
              position: 'absolute', width: '100%', top: 4,
              appearance: 'none', WebkitAppearance: 'none',
              background: 'transparent', pointerEvents: 'none',
              zIndex: 3, height: 16,
            }}
          />

          {/* Max handle */}
          <input
            type="range" className="g3d-range"
            min={0} max={maxRound || 1} step={1}
            value={roundRange[1]}
            onChange={handleSliderMax}
            style={{
              position: 'absolute', width: '100%', top: 4,
              appearance: 'none', WebkitAppearance: 'none',
              background: 'transparent', pointerEvents: 'none',
              zIndex: 4, height: 16,
            }}
          />
        </div>

        {/* Round label display */}
        <span style={{
          color: '#888', fontSize: 9, fontWeight: 700,
          letterSpacing: '0.06em', flexShrink: 0, minWidth: 90,
          textAlign: 'right', fontFamily: 'monospace',
        }}>
          {isolatedRound !== null
            ? `⦿ ${ROUND_LABELS[isolatedRound] || `R${isolatedRound}`}`
            : `${ROUND_LABELS[roundRange[0]] || roundRange[0]} — ${ROUND_LABELS[roundRange[1]] || roundRange[1]}`
          }
        </span>
      </div>
    </div>
  );
}
