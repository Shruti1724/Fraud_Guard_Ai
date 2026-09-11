import React, { useRef, useEffect, useState, useMemo } from 'react';
import CytoscapeComponent from 'react-cytoscapejs';
import { Network, LayoutGrid, Radio, CircleDot, ZoomIn, ZoomOut, Maximize2, Search, Filter } from 'lucide-react';

export default function GraphView({ elements = [], onNodeClick, layoutType = 'cose', selectedNodeId }) {
  const cyRef = useRef(null);
  const [currentLayout, setCurrentLayout] = useState(layoutType);
  const [filterMode, setFilterMode] = useState('ALL'); // 'ALL' | 'THREATS' | 'ACTIVE'
  const [searchTerm, setSearchTerm] = useState('');

  // Filter elements based on selection
  const filteredElements = useMemo(() => {
    let nodes = elements.filter(e => !e.data.source);
    let edges = elements.filter(e => e.data.source);

    if (filterMode === 'THREATS') {
      nodes = nodes.filter(n => n.data.risk_level === 'CRITICAL' || n.data.risk_level === 'HIGH');
      const validIds = new Set(nodes.map(n => n.data.id));
      edges = edges.filter(e => validIds.has(e.data.source) || validIds.has(e.data.target));
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const matchedNodes = nodes.filter(n => 
        (n.data.id && n.data.id.toLowerCase().includes(term)) ||
        (n.data.vpa_address && n.data.vpa_address.toLowerCase().includes(term)) ||
        (n.data.account_holder_name && n.data.account_holder_name.toLowerCase().includes(term))
      );
      const matchedIds = new Set(matchedNodes.map(n => n.data.id));
      edges = edges.filter(e => matchedIds.has(e.data.source) || matchedIds.has(e.data.target));
      return [...matchedNodes, ...edges];
    }

    return [...nodes, ...edges];
  }, [elements, filterMode, searchTerm]);

  // Handle Cytoscape layout and interactions
  useEffect(() => {
    if (cyRef.current) {
      const cy = cyRef.current;
      
      let layoutConfig;
      switch (currentLayout) {
        case 'hierarchical':
          layoutConfig = { name: 'breadthfirst', directed: true, spacingFactor: 1.4, animationDuration: 400 };
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
            animationDuration: 400,
          };
          break;
        case 'circle':
          layoutConfig = { name: 'circle', animationDuration: 400 };
          break;
        case 'cose':
        default:
          layoutConfig = {
            name: 'cose',
            animate: true,
            animationDuration: 400,
            nodeRepulsion: 6000,
            idealEdgeLength: 80,
            edgeElasticity: 100,
            gravity: 80,
            padding: 40,
          };
      }

      cy.layout(layoutConfig).run();
      cy.fit(undefined, 30);

      cy.removeAllListeners();

      cy.on('tap', 'node', (evt) => {
        const node = evt.target;
        if (onNodeClick) onNodeClick(node.data());
      });

      cy.on('mouseover', 'node', (evt) => {
        document.body.style.cursor = 'pointer';
        evt.target.style({ 'border-width': 3, 'border-color': '#38bdf8' });
      });

      cy.on('mouseout', 'node', (evt) => {
        document.body.style.cursor = 'default';
        const isCritical = evt.target.data('risk_level') === 'CRITICAL';
        const isHigh = evt.target.data('risk_level') === 'HIGH';
        evt.target.style({
          'border-width': isCritical || isHigh ? 2 : 1,
          'border-color': isCritical ? '#dc2626' : isHigh ? '#f59e0b' : '#334155'
        });
      });
    }
  }, [filteredElements, currentLayout, onNodeClick]);

  // Cytoscape High-Tech Cyber Stylesheet
  const stylesheet = [
    {
      selector: 'node',
      style: {
        'background-color': (ele) => {
          const risk = ele.data('risk_level');
          if (risk === 'CRITICAL') return '#991b1b';
          if (risk === 'HIGH') return '#b45309';
          if (risk === 'MEDIUM') return '#d97706';
          return '#065f46';
        },
        'border-color': (ele) => {
          const risk = ele.data('risk_level');
          if (risk === 'CRITICAL') return '#ef4444';
          if (risk === 'HIGH') return '#f59e0b';
          return '#10b981';
        },
        'border-width': 2,
        'label': (ele) => {
          const vpa = ele.data('vpa_address') || ele.data('label') || ele.data('id');
          return vpa.length > 18 ? vpa.substring(0, 16) + '...' : vpa;
        },
        'color': '#f8fafc',
        'text-valign': 'bottom',
        'text-margin-y': 6,
        'font-size': '11px',
        'font-family': 'Inter, sans-serif',
        'font-weight': 600,
        'text-background-color': 'rgba(15, 23, 42, 0.85)',
        'text-background-opacity': 1,
        'text-background-padding': '3px',
        'text-background-shape': 'roundrectangle',
        'text-border-color': 'rgba(255, 255, 255, 0.1)',
        'text-border-width': 1,
        'text-border-opacity': 1,
        'width': (ele) => {
          const risk = ele.data('risk_level');
          if (risk === 'CRITICAL') return 36;
          if (risk === 'HIGH') return 32;
          return 26;
        },
        'height': (ele) => {
          const risk = ele.data('risk_level');
          if (risk === 'CRITICAL') return 36;
          if (risk === 'HIGH') return 32;
          return 26;
        },
        'shape': (ele) => {
          const id = ele.data('id') || '';
          if (id.includes('sink') || id.includes('crypto')) return 'diamond';
          if (id.includes('syndicate')) return 'hexagon';
          return 'ellipse';
        },
        'transition-property': 'background-color, border-color, width, height',
        'transition-duration': '0.3s',
      },
    },
    {
      selector: 'node:selected',
      style: {
        'border-width': 4,
        'border-color': '#38bdf8',
        'shadow-blur': 20,
        'shadow-color': '#38bdf8',
        'shadow-opacity': 0.8,
      },
    },
    {
      selector: 'edge',
      style: {
        'width': (ele) => {
          const amt = ele.data('amount') || 0;
          if (amt > 50000) return 3.5;
          if (amt > 10000) return 2.5;
          return 1.5;
        },
        'line-color': (ele) => {
          const status = ele.data('status');
          const isFraud = ele.data('is_fraud');
          if (status === 'BLOCKED' || status === 'FLAGGED' || isFraud) return '#ef4444';
          return '#334155';
        },
        'target-arrow-color': (ele) => {
          const status = ele.data('status');
          const isFraud = ele.data('is_fraud');
          if (status === 'BLOCKED' || status === 'FLAGGED' || isFraud) return '#ef4444';
          return '#475569';
        },
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'opacity': 0.8,
        'line-style': (ele) => {
          const status = ele.data('status');
          return status === 'FLAGGED' || status === 'BLOCKED' ? 'dashed' : 'solid';
        },
        'label': (ele) => {
          const amt = ele.data('amount');
          return amt ? `₹${(amt / 1000).toFixed(1)}k` : '';
        },
        'font-size': '9px',
        'color': '#94a3b8',
        'text-rotation': 'autorotate',
        'text-background-color': 'rgba(10, 15, 25, 0.9)',
        'text-background-opacity': 0.9,
        'text-background-padding': '2px',
      },
    },
  ];

  const handleZoom = (delta) => {
    if (cyRef.current) {
      const cy = cyRef.current;
      cy.zoom(cy.zoom() * delta);
      cy.center();
    }
  };

  const handleFit = () => {
    if (cyRef.current) {
      cyRef.current.fit(undefined, 30);
    }
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}>
      {/* Top Graph Controls Bar */}
      <div
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'rgba(15, 18, 24, 0.9)',
          zIndex: 10,
          gap: 12,
        }}
      >
        {/* Left: Search & Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
          <div style={{ position: 'relative', width: 220 }}>
            <Search size={14} color="#64748b" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              placeholder="Search Account / VPA..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                background: 'rgba(0, 0, 0, 0.35)',
                border: '1px solid var(--border-color)',
                borderRadius: 6,
                padding: '6px 10px 6px 30px',
                fontSize: '0.75rem',
                color: '#fff',
                width: '100%',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 4, background: 'rgba(0,0,0,0.3)', padding: 3, borderRadius: 6 }}>
            <button
              onClick={() => setFilterMode('ALL')}
              style={{
                padding: '4px 8px',
                borderRadius: 4,
                border: 'none',
                background: filterMode === 'ALL' ? 'var(--accent-color)' : 'transparent',
                color: filterMode === 'ALL' ? '#fff' : '#94a3b8',
                fontSize: '0.7rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              All Nodes ({elements.filter(e => !e.data.source).length})
            </button>
            <button
              onClick={() => setFilterMode('THREATS')}
              style={{
                padding: '4px 8px',
                borderRadius: 4,
                border: 'none',
                background: filterMode === 'THREATS' ? 'var(--risk-critical)' : 'transparent',
                color: filterMode === 'THREATS' ? '#fff' : '#ef4444',
                fontSize: '0.7rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Threats Only
            </button>
          </div>
        </div>

        {/* Right: Layout Switchers & Zoom */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', gap: 4, background: 'rgba(0,0,0,0.3)', padding: 3, borderRadius: 6 }}>
            <button
              onClick={() => setCurrentLayout('cose')}
              title="Force Directed"
              style={{
                padding: '4px 8px',
                borderRadius: 4,
                border: 'none',
                background: currentLayout === 'cose' ? 'rgba(59, 130, 246, 0.25)' : 'transparent',
                color: currentLayout === 'cose' ? 'var(--accent-color)' : '#94a3b8',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: '0.7rem',
                fontWeight: 600,
              }}
            >
              <Network size={13} /> Force
            </button>
            <button
              onClick={() => setCurrentLayout('concentric')}
              title="Concentric Ring"
              style={{
                padding: '4px 8px',
                borderRadius: 4,
                border: 'none',
                background: currentLayout === 'concentric' ? 'rgba(59, 130, 246, 0.25)' : 'transparent',
                color: currentLayout === 'concentric' ? 'var(--accent-color)' : '#94a3b8',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: '0.7rem',
                fontWeight: 600,
              }}
            >
              <Radio size={13} /> Rings
            </button>
            <button
              onClick={() => setCurrentLayout('hierarchical')}
              title="Hierarchical Tree"
              style={{
                padding: '4px 8px',
                borderRadius: 4,
                border: 'none',
                background: currentLayout === 'hierarchical' ? 'rgba(59, 130, 246, 0.25)' : 'transparent',
                color: currentLayout === 'hierarchical' ? 'var(--accent-color)' : '#94a3b8',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: '0.7rem',
                fontWeight: 600,
              }}
            >
              <LayoutGrid size={13} /> Tree
            </button>
          </div>

          <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,0.3)', padding: 3, borderRadius: 6 }}>
            <button onClick={() => handleZoom(1.25)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', padding: '4px 6px', cursor: 'pointer' }} title="Zoom In"><ZoomIn size={14} /></button>
            <button onClick={() => handleZoom(0.8)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', padding: '4px 6px', cursor: 'pointer' }} title="Zoom Out"><ZoomOut size={14} /></button>
            <button onClick={handleFit} style={{ background: 'transparent', border: 'none', color: '#94a3b8', padding: '4px 6px', cursor: 'pointer' }} title="Fit to View"><Maximize2 size={14} /></button>
          </div>
        </div>
      </div>

      {/* Cytoscape Canvas */}
      <div style={{ flex: 1, position: 'relative', width: '100%', height: '100%' }}>
        <CytoscapeComponent
          elements={CytoscapeComponent.normalizeElements(filteredElements)}
          style={{ width: '100%', height: '100%' }}
          stylesheet={stylesheet}
          cy={(cy) => { cyRef.current = cy; }}
        />

        {/* Legend Overlay */}
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            left: 12,
            background: 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(10px)',
            border: '1px solid var(--border-color)',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: '0.7rem',
            display: 'flex',
            gap: 12,
            color: 'var(--text-muted)',
            zIndex: 5,
            pointerEvents: 'none',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#dc2626' }} /> Critical Mule Ring
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b' }} /> ATO Suspect
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} /> Verified Safe
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 14, height: 2, background: '#ef4444', borderTop: '1px dashed #ef4444' }} /> Flagged Path
          </span>
        </div>
      </div>
    </div>
  );
}
