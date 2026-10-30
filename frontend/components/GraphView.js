import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import CytoscapeComponent from 'react-cytoscapejs';
import {
  Network,
  LayoutGrid,
  Radio,
  CircleDot,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Search,
  Filter,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Zap,
  Info,
  X,
  Eye,
  Layers,
} from 'lucide-react';

export default function GraphView({ elements = [], onNodeClick, layoutType = 'cose', selectedNodeId }) {
  const cyRef = useRef(null);
  const [currentLayout, setCurrentLayout] = useState(layoutType);
  const [filterMode, setFilterMode] = useState('ALL'); // 'ALL' | 'RINGS' | 'HIGH_VALUE' | 'FROZEN' | 'SAFE'
  const [searchTerm, setSearchTerm] = useState('');
  const [hoveredNode, setHoveredNode] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Filter elements based on selection
  const filteredElements = useMemo(() => {
    let nodes = elements.filter(e => !e.data.source);
    let edges = elements.filter(e => e.data.source);

    if (filterMode === 'RINGS') {
      // Focus on known fraud syndicates, relays, leaves, sinks, smurfs
      nodes = nodes.filter(n => {
        const role = (n.data.role || '').toUpperCase();
        const level = (n.data.risk_level || '').toUpperCase();
        return ['SINK', 'SYNDICATE', 'RELAY', 'MULE', 'SMURF', 'ATO', 'HAWALA'].includes(role) || level === 'CRITICAL' || level === 'HIGH';
      });
      const validIds = new Set(nodes.map(n => n.data.id));
      edges = edges.filter(e => validIds.has(e.data.source) || validIds.has(e.data.target));
    } else if (filterMode === 'FROZEN') {
      nodes = nodes.filter(n => (n.data.risk_status || '').toUpperCase() === 'FROZEN');
      const validIds = new Set(nodes.map(n => n.data.id));
      edges = edges.filter(e => validIds.has(e.data.source) || validIds.has(e.data.target));
    } else if (filterMode === 'HIGH_VALUE') {
      edges = edges.filter(e => (e.data.amount || 0) >= 10000);
      const edgeNodeIds = new Set();
      edges.forEach(e => {
        edgeNodeIds.add(e.data.source);
        edgeNodeIds.add(e.data.target);
      });
      nodes = nodes.filter(n => edgeNodeIds.has(n.data.id));
    } else if (filterMode === 'SAFE') {
      nodes = nodes.filter(n => (n.data.risk_level || '').toUpperCase() === 'LOW');
      const validIds = new Set(nodes.map(n => n.data.id));
      edges = edges.filter(e => validIds.has(e.data.source) && validIds.has(e.data.target));
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const matchedNodes = nodes.filter(n =>
        (n.data.id && n.data.id.toLowerCase().includes(term)) ||
        (n.data.vpa_address && n.data.vpa_address.toLowerCase().includes(term)) ||
        (n.data.account_holder_name && n.data.account_holder_name.toLowerCase().includes(term)) ||
        (n.data.role && n.data.role.toLowerCase().includes(term))
      );
      const matchedIds = new Set(matchedNodes.map(n => n.data.id));
      edges = edges.filter(e => matchedIds.has(e.data.source) || matchedIds.has(e.data.target));
      return [...matchedNodes, ...edges];
    }

    return [...nodes, ...edges];
  }, [elements, filterMode, searchTerm]);

  // Run or re-run layout
  const runLayout = useCallback((layoutName) => {
    if (!cyRef.current) return;
    const cy = cyRef.current;

    let layoutConfig;
    switch (layoutName) {
      case 'hierarchical':
        layoutConfig = {
          name: 'breadthfirst',
          directed: true,
          padding: 50,
          spacingFactor: 1.6,
          animate: true,
          animationDuration: 500,
        };
        break;
      case 'concentric':
        layoutConfig = {
          name: 'concentric',
          concentric: (node) => {
            const r = node.data('risk_level');
            if (r === 'CRITICAL') return 4;
            if (r === 'HIGH') return 3;
            if (r === 'MEDIUM') return 2;
            return 1;
          },
          levelWidth: () => 1,
          padding: 50,
          animate: true,
          animationDuration: 500,
        };
        break;
      case 'circle':
        layoutConfig = {
          name: 'circle',
          padding: 50,
          animate: true,
          animationDuration: 500,
        };
        break;
      case 'cose':
      default:
        layoutConfig = {
          name: 'cose',
          animate: true,
          animationDuration: 600,
          randomize: false,
          nodeRepulsion: 14000,
          idealEdgeLength: 120,
          edgeElasticity: 80,
          gravity: 40,
          padding: 50,
          componentSpacing: 100,
          nodeOverlap: 20,
        };
    }

    const layout = cy.layout(layoutConfig);
    layout.run();
  }, []);

  // Update Cytoscape instance and listeners
  useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;

    runLayout(currentLayout);
    cy.fit(undefined, 40);

    // Remove old event listeners
    cy.removeAllListeners();

    // Node click
    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      if (onNodeClick) onNodeClick(node.data());
      
      // Spotlight connected neighborhood
      highlightNeighborhood(node);
    });

    // Background tap resets highlighting
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        resetHighlighting();
        setHoveredNode(null);
      }
    });

    // Hover
    cy.on('mouseover', 'node', (evt) => {
      document.body.style.cursor = 'pointer';
      const node = evt.target;
      const renderedPos = node.renderedPosition();
      setTooltipPos({ x: renderedPos.x, y: renderedPos.y });
      setHoveredNode(node.data());
    });

    cy.on('mouseout', 'node', () => {
      document.body.style.cursor = 'default';
      setHoveredNode(null);
    });

    function highlightNeighborhood(node) {
      cy.batch(() => {
        cy.elements().removeClass('highlighted faded');
        const neighborhood = node.closedNeighborhood();
        cy.elements().not(neighborhood).addClass('faded');
        neighborhood.addClass('highlighted');
      });
    }

    function resetHighlighting() {
      cy.batch(() => {
        cy.elements().removeClass('highlighted faded');
      });
    }

  }, [filteredElements, currentLayout, onNodeClick, runLayout]);

  // When selectedNodeId prop changes, focus and zoom to it
  useEffect(() => {
    if (cyRef.current && selectedNodeId) {
      const cy = cyRef.current;
      const targetNode = cy.getElementById(selectedNodeId);
      if (targetNode && targetNode.length > 0) {
        cy.animate(
          {
            center: { eles: targetNode },
            zoom: 1.4,
          },
          { duration: 400 }
        );
        cy.elements().removeClass('highlighted faded');
        const neighborhood = targetNode.closedNeighborhood();
        cy.elements().not(neighborhood).addClass('faded');
        neighborhood.addClass('highlighted');
      }
    }
  }, [selectedNodeId]);

  // Handle Search Enter
  const handleSearchSubmit = (e) => {
    if (e.key === 'Enter' && searchTerm.trim() && cyRef.current) {
      const cy = cyRef.current;
      const term = searchTerm.toLowerCase();
      const match = cy.nodes().filter(n => {
        const d = n.data();
        return (d.account_holder_name && d.account_holder_name.toLowerCase().includes(term)) ||
               (d.vpa_address && d.vpa_address.toLowerCase().includes(term)) ||
               (d.id && d.id.toLowerCase().includes(term));
      }).first();

      if (match && match.length > 0) {
        cy.animate({ center: { eles: match }, zoom: 1.5 }, { duration: 400 });
        if (onNodeClick) onNodeClick(match.data());
        cy.elements().removeClass('highlighted faded');
        const neighborhood = match.closedNeighborhood();
        cy.elements().not(neighborhood).addClass('faded');
        neighborhood.addClass('highlighted');
      }
    }
  };

  // Modern Clean Light-Theme Stylesheet
  const stylesheet = [
    {
      selector: 'node',
      style: {
        'background-color': (ele) => {
          const risk = ele.data('risk_level');
          if (risk === 'CRITICAL') return '#dc2626';
          if (risk === 'HIGH') return '#ea580c';
          if (risk === 'MEDIUM') return '#2563eb';
          return '#059669';
        },
        'border-color': (ele) => {
          const risk = ele.data('risk_level');
          if (risk === 'CRITICAL') return '#b91c1c';
          if (risk === 'HIGH') return '#c2410c';
          if (risk === 'MEDIUM') return '#1d4ed8';
          return '#047857';
        },
        'border-width': 3,
        'border-opacity': 0.9,
        // Label placed underneath the node with clean pill styling
        'label': (ele) => {
          const name = ele.data('account_holder_name') || ele.data('label') || ele.data('id');
          const cleanName = name.length > 20 ? name.substring(0, 18) + '..' : name;
          const role = ele.data('role') || 'USER';
          return `${cleanName}\n[${role}]`;
        },
        'text-wrap': 'wrap',
        'text-max-width': '110px',
        'color': '#0f172a',
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 7,
        'font-size': '10px',
        'font-family': 'Inter, system-ui, sans-serif',
        'font-weight': 700,
        'text-background-color': '#ffffff',
        'text-background-opacity': 0.95,
        'text-background-padding': '3px',
        'text-background-shape': 'roundrectangle',
        'text-border-color': '#cbd5e1',
        'text-border-width': 1,
        'text-border-opacity': 0.9,
        // Node dimensions
        'width': (ele) => {
          const role = ele.data('role');
          if (role === 'SINK' || role === 'SYNDICATE') return 48;
          if (role === 'RELAY') return 44;
          if (role === 'MULE' || role === 'SMURF' || role === 'ATO' || role === 'HAWALA') return 38;
          return 34;
        },
        'height': (ele) => {
          const role = ele.data('role');
          if (role === 'SINK' || role === 'SYNDICATE') return 48;
          if (role === 'RELAY') return 44;
          if (role === 'MULE' || role === 'SMURF' || role === 'ATO' || role === 'HAWALA') return 38;
          return 34;
        },
        // Shape based on role
        'shape': (ele) => {
          const role = ele.data('role');
          if (role === 'SINK') return 'diamond';
          if (role === 'SYNDICATE') return 'hexagon';
          if (role === 'MERCHANT') return 'roundrectangle';
          return 'ellipse';
        },
        'shadow-blur': 12,
        'shadow-color': (ele) => {
          const risk = ele.data('risk_level');
          if (risk === 'CRITICAL') return 'rgba(220, 38, 38, 0.4)';
          if (risk === 'HIGH') return 'rgba(234, 88, 12, 0.35)';
          if (risk === 'MEDIUM') return 'rgba(37, 99, 235, 0.3)';
          return 'rgba(5, 150, 105, 0.25)';
        },
        'shadow-opacity': 0.7,
        'transition-property': 'background-color, border-color, width, height, opacity, shadow-blur',
        'transition-duration': '0.25s',
      },
    },
    {
      selector: 'node:selected, node.highlighted',
      style: {
        'border-width': 5,
        'border-color': '#2563eb',
        'shadow-blur': 24,
        'shadow-color': '#2563eb',
        'shadow-opacity': 1,
        'z-index': 999,
      },
    },
    {
      selector: 'node.faded',
      style: {
        'opacity': 0.16,
      },
    },
    {
      selector: 'edge',
      style: {
        'width': (ele) => {
          const amt = ele.data('amount') || 0;
          if (amt > 50000) return 4;
          if (amt > 15000) return 3;
          if (amt > 5000) return 2.2;
          return 1.6;
        },
        'line-color': (ele) => {
          const status = ele.data('status');
          const isFraud = ele.data('is_fraud');
          if (status === 'BLOCKED' || status === 'FLAGGED' || isFraud) return '#ef4444';
          return '#94a3b8';
        },
        'target-arrow-color': (ele) => {
          const status = ele.data('status');
          const isFraud = ele.data('is_fraud');
          if (status === 'BLOCKED' || status === 'FLAGGED' || isFraud) return '#ef4444';
          return '#64748b';
        },
        'target-arrow-shape': 'triangle',
        'arrow-scale': 1.15,
        'curve-style': 'bezier',
        'opacity': 0.85,
        'line-style': (ele) => {
          const status = ele.data('status');
          return status === 'FLAGGED' || status === 'BLOCKED' ? 'dashed' : 'solid';
        },
        'label': (ele) => {
          const amt = ele.data('amount');
          if (!amt) return '';
          if (amt >= 1000) return `₹${(amt / 1000).toFixed(amt % 1000 === 0 ? 0 : 1)}k`;
          return `₹${amt}`;
        },
        'font-size': '10px',
        'font-family': 'Inter, system-ui, sans-serif',
        'font-weight': 700,
        'color': '#1e293b',
        'text-rotation': 'autorotate',
        'text-background-color': '#ffffff',
        'text-background-opacity': 0.95,
        'text-background-padding': '3px',
        'text-background-shape': 'roundrectangle',
        'text-border-color': '#cbd5e1',
        'text-border-width': 1,
        'text-border-opacity': 0.8,
        'transition-property': 'opacity, width, line-color',
        'transition-duration': '0.25s',
      },
    },
    {
      selector: 'edge.highlighted',
      style: {
        'width': 4.5,
        'line-color': '#2563eb',
        'target-arrow-color': '#2563eb',
        'opacity': 1,
        'z-index': 998,
      },
    },
    {
      selector: 'edge.faded',
      style: {
        'opacity': 0.08,
      },
    },
  ];

  const handleZoom = (delta) => {
    if (cyRef.current) {
      const cy = cyRef.current;
      cy.animate({ zoom: cy.zoom() * delta }, { duration: 250 });
    }
  };

  const handleFit = () => {
    if (cyRef.current) {
      cyRef.current.animate({ fit: { padding: 40 } }, { duration: 400 });
      cyRef.current.elements().removeClass('highlighted faded');
    }
  };

  const totalNodes = elements.filter(e => !e.data.source).length;
  const totalEdges = elements.filter(e => e.data.source).length;

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', background: '#f8fafc' }}>
      
      {/* ─── TOP GRAPH CONTROLS BAR ─── */}
      <div
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#ffffff',
          zIndex: 10,
          gap: 12,
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
        }}
      >
        {/* Left: Search & Preset Filter Chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, flexWrap: 'wrap' }}>
          
          {/* Search Box */}
          <div style={{ position: 'relative', width: 220 }}>
            <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              placeholder="Search node or press Enter..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleSearchSubmit}
              style={{
                background: '#f8fafc',
                border: '1px solid #cbd5e1',
                borderRadius: 8,
                padding: '6px 28px 6px 30px',
                fontSize: '0.75rem',
                color: '#0f172a',
                width: '100%',
                outline: 'none',
                transition: 'border-color 0.2s',
              }}
              onFocus={(e) => { e.target.style.borderColor = '#2563eb'; }}
              onBlur={(e) => { e.target.style.borderColor = '#cbd5e1'; }}
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#94a3b8',
                  padding: 0,
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Preset Filter Chips */}
          <div style={{ display: 'flex', gap: 4, background: '#f1f5f9', padding: '3px 4px', borderRadius: 8 }}>
            {[
              { id: 'ALL', label: `All (${totalNodes})`, icon: <Layers size={12} /> },
              { id: 'RINGS', label: '🚨 Fraud Rings', icon: <ShieldAlert size={12} /> },
              { id: 'FROZEN', label: '❄️ Frozen', icon: <CircleDot size={12} /> },
              { id: 'HIGH_VALUE', label: '💰 > ₹10k', icon: <Zap size={12} /> },
              { id: 'SAFE', label: '✅ Safe', icon: <ShieldCheck size={12} /> },
            ].map((f) => {
              const active = filterMode === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => setFilterMode(f.id)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: 'none',
                    background: active ? '#2563eb' : 'transparent',
                    color: active ? '#ffffff' : '#64748b',
                    fontSize: '0.72rem',
                    fontWeight: active ? 700 : 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    transition: 'all 0.15s ease',
                  }}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Layout Switchers & Camera Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          
          {/* Layout Selector */}
          <div style={{ display: 'flex', gap: 3, background: '#f1f5f9', padding: '3px 4px', borderRadius: 8 }}>
            {[
              { id: 'cose', label: 'Physics', icon: <Network size={13} />, title: 'Force-Directed Spring Physics' },
              { id: 'hierarchical', label: 'Flow Tree', icon: <LayoutGrid size={13} />, title: 'Hierarchical Inflow-Outflow DAG' },
              { id: 'concentric', label: 'Rings', icon: <Radio size={13} />, title: 'Threat Rings' },
              { id: 'circle', label: 'Circle', icon: <CircleDot size={13} />, title: 'Radial Circle' },
            ].map((ly) => {
              const active = currentLayout === ly.id;
              return (
                <button
                  key={ly.id}
                  onClick={() => {
                    setCurrentLayout(ly.id);
                    runLayout(ly.id);
                  }}
                  title={ly.title}
                  style={{
                    padding: '4px 9px',
                    borderRadius: 6,
                    border: 'none',
                    background: active ? '#ffffff' : 'transparent',
                    color: active ? '#2563eb' : '#64748b',
                    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: '0.72rem',
                    fontWeight: active ? 700 : 600,
                    transition: 'all 0.15s',
                  }}
                >
                  {ly.icon} {ly.label}
                </button>
              );
            })}
          </div>

          {/* Zoom & Fit Action Buttons */}
          <div style={{ display: 'flex', gap: 2, background: '#f1f5f9', padding: '3px 4px', borderRadius: 8 }}>
            <button
              onClick={() => handleZoom(1.3)}
              style={{ background: 'transparent', border: 'none', color: '#64748b', padding: '5px 7px', cursor: 'pointer', borderRadius: 4 }}
              title="Zoom In"
              onMouseEnter={(e) => { e.currentTarget.style.color = '#0f172a'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#64748b'; }}
            >
              <ZoomIn size={14} />
            </button>
            <button
              onClick={() => handleZoom(0.75)}
              style={{ background: 'transparent', border: 'none', color: '#64748b', padding: '5px 7px', cursor: 'pointer', borderRadius: 4 }}
              title="Zoom Out"
              onMouseEnter={(e) => { e.currentTarget.style.color = '#0f172a'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#64748b'; }}
            >
              <ZoomOut size={14} />
            </button>
            <button
              onClick={handleFit}
              style={{ background: 'transparent', border: 'none', color: '#64748b', padding: '5px 7px', cursor: 'pointer', borderRadius: 4 }}
              title="Reset View / Fit All"
              onMouseEnter={(e) => { e.currentTarget.style.color = '#0f172a'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#64748b'; }}
            >
              <Maximize2 size={14} />
            </button>
            <button
              onClick={() => runLayout(currentLayout)}
              style={{ background: 'transparent', border: 'none', color: '#64748b', padding: '5px 7px', cursor: 'pointer', borderRadius: 4 }}
              title="Re-run Layout Simulation"
              onMouseEnter={(e) => { e.currentTarget.style.color = '#0f172a'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#64748b'; }}
            >
              <RotateCcw size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* ─── CYTOSCAPE CANVAS WITH GRID BACKGROUND ─── */}
      <div
        style={{
          flex: 1,
          position: 'relative',
          width: '100%',
          height: '100%',
          backgroundImage: 'radial-gradient(#cbd5e1 1.2px, transparent 1.2px)',
          backgroundSize: '22px 22px',
          backgroundColor: '#f8fafc',
          overflow: 'hidden',
        }}
      >
        <CytoscapeComponent
          elements={CytoscapeComponent.normalizeElements(filteredElements)}
          style={{ width: '100%', height: '100%' }}
          stylesheet={stylesheet}
          cy={(cy) => { cyRef.current = cy; }}
        />

        {/* ─── ON-CANVAS TOP-LEFT TOPOLOGY HUD ─── */}
        <div
          style={{
            position: 'absolute',
            top: 14,
            left: 14,
            background: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(8px)',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            padding: '8px 14px',
            fontSize: '0.72rem',
            color: '#334155',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            pointerEvents: 'none',
            zIndex: 5,
          }}
        >
          <div>
            <span style={{ color: '#94a3b8', fontSize: 10, textTransform: 'uppercase', fontWeight: 700 }}>Entities</span>
            <div style={{ fontWeight: 800, fontSize: 13, color: '#0f172a' }}>{filteredElements.filter(e => !e.data.source).length} / {totalNodes}</div>
          </div>
          <div style={{ height: 20, width: 1, background: '#e2e8f0' }} />
          <div>
            <span style={{ color: '#94a3b8', fontSize: 10, textTransform: 'uppercase', fontWeight: 700 }}>Flow Channels</span>
            <div style={{ fontWeight: 800, fontSize: 13, color: '#0f172a' }}>{filteredElements.filter(e => e.data.source).length} edges</div>
          </div>
          <div style={{ height: 20, width: 1, background: '#e2e8f0' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#2563eb', fontWeight: 700, fontSize: 11 }}>
            <Eye size={13} />
            <span>Click any node to isolate its money trail</span>
          </div>
        </div>

        {/* ─── HOVER TOOLTIP POPUP ─── */}
        {hoveredNode && (
          <div
            style={{
              position: 'absolute',
              left: Math.min(window.innerWidth - 320, Math.max(20, tooltipPos.x + 18)),
              top: Math.max(20, tooltipPos.y - 40),
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: 10,
              padding: '10px 14px',
              boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
              zIndex: 50,
              pointerEvents: 'none',
              minWidth: 200,
              animation: 'fadeIn 0.15s ease-out',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background:
                    hoveredNode.risk_level === 'CRITICAL' ? '#dc2626' :
                    hoveredNode.risk_level === 'HIGH' ? '#ea580c' :
                    hoveredNode.risk_level === 'MEDIUM' ? '#2563eb' : '#059669',
                }}
              />
              <span style={{ fontWeight: 800, fontSize: 13, color: '#0f172a' }}>
                {hoveredNode.account_holder_name || hoveredNode.id}
              </span>
            </div>
            <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace', marginBottom: 6 }}>
              {hoveredNode.vpa_address}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, borderTop: '1px solid #f1f5f9', paddingTop: 6 }}>
              <span style={{ color: '#64748b' }}>Role / Status:</span>
              <span style={{ fontWeight: 700, color: hoveredNode.risk_status === 'FROZEN' ? '#dc2626' : '#0f172a' }}>
                {hoveredNode.role || 'USER'} · {hoveredNode.risk_status || 'ACTIVE'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 4 }}>
              <span style={{ color: '#64748b' }}>Risk Score:</span>
              <span style={{ fontWeight: 800, color: hoveredNode.risk_score > 0.7 ? '#dc2626' : '#059669' }}>
                {(Number(hoveredNode.risk_score || 0) * 100).toFixed(1)}%
              </span>
            </div>
          </div>
        )}

        {/* ─── BOTTOM PRESENTATION LEGEND ─── */}
        <div
          style={{
            position: 'absolute',
            bottom: 14,
            left: 14,
            background: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(8px)',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            padding: '8px 14px',
            fontSize: '0.72rem',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            color: '#475569',
            zIndex: 5,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#dc2626', border: '2px solid #b91c1c' }} />
            <span>Mule / Sink (Frozen)</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ea580c', border: '2px solid #c2410c' }} />
            <span>ATO / Smurfing Hub</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#059669', border: '2px solid #047857' }} />
            <span>Verified Merchant / Clean</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
            <span style={{ width: 18, height: 2, background: '#ef4444', borderTop: '2px dashed #ef4444' }} />
            <span>Fraud Transfer Path</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
            <span style={{ width: 18, height: 2, background: '#94a3b8' }} />
            <span>Clean Transaction</span>
          </span>
        </div>

      </div>
    </div>
  );
}
