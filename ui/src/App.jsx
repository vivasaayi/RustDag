import React, { useMemo, useCallback, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
} from 'reactflow';
import 'reactflow/dist/style.css';
import stageLibraryData from './stages/stageLibrary.json';
import StageNode from './components/StageNode.jsx';
import Inspector from './components/Inspector.jsx';

const nodeTypes = { stage: StageNode };

function buildDefaults(stage) {
  const schema = stage?.propertiesSchema?.properties || {};
  const defaults = {};
  Object.entries(schema).forEach(([key, def]) => {
    if (def.default !== undefined) {
      defaults[key] = def.default;
    } else if (def.type === 'boolean') {
      defaults[key] = false;
    } else {
      defaults[key] = '';
    }
  });
  return defaults;
}

function clonePorts(stage) {
  const ports = stage?.ports || { inputs: [], outputs: [] };
  return {
    inputs: ports.inputs ? ports.inputs.map((port) => ({ ...port })) : [],
    outputs: ports.outputs ? ports.outputs.map((port) => ({ ...port })) : [],
  };
}

function serializeGraph(nodes, edges) {
  return {
    version: 1,
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      stageId: node.data.stageId,
      label: node.data.label,
      properties: node.data.properties,
      ports: node.data.ports,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    })),
  };
}

function buildNodeFromStage(stage, position) {
  const id = `n_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  return {
    id,
    type: 'stage',
    position,
    data: {
      stageId: stage.id,
      stage,
      label: stage.label,
      properties: buildDefaults(stage),
      ports: clonePorts(stage),
    },
  };
}

function mapStageById(stages) {
  return stages.reduce((acc, stage) => {
    acc[stage.id] = stage;
    return acc;
  }, {});
}

function findPort(stage, portGroup, handleId, portsOverride) {
  const ports = portsOverride || stage?.ports || {};
  if (!ports?.[portGroup]) return null;
  if (!handleId) return ports[portGroup][0] || null;
  return ports[portGroup].find((p) => p.id === handleId) || null;
}

export default function App() {
  const stageLibrary = stageLibraryData.stages || [];
  const stageById = useMemo(() => mapStageById(stageLibrary), [stageLibrary]);

  const initialNodes = useMemo(() => {
    const startStage = stageById.start;
    const stopStage = stageById.stop;
    if (!startStage || !stopStage) return [];
    return [
      buildNodeFromStage(startStage, { x: 80, y: 80 }),
      buildNodeFromStage(stopStage, { x: 480, y: 260 }),
    ];
  }, [stageById]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [search, setSearch] = useState('');
  const fileInputRef = useRef(null);

  const handleSelectionChange = useCallback(({ nodes: selected }) => {
    setSelectedNodeId(selected?.[0]?.id || null);
  }, []);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;

  const addStage = useCallback(
    (stage) => {
      const position = { x: 120 + Math.random() * 260, y: 120 + Math.random() * 260 };
      setNodes((nds) => nds.concat(buildNodeFromStage(stage, position)));
    },
    [setNodes]
  );

  const onConnect = useCallback(
    (connection) => {
      setEdges((eds) => addEdge({ ...connection, type: 'smoothstep' }, eds));
    },
    [setEdges]
  );

  const isValidConnection = useCallback(
    (connection) => {
      const sourceNode = nodes.find((node) => node.id === connection.source);
      const targetNode = nodes.find((node) => node.id === connection.target);
      if (!sourceNode || !targetNode) return false;
      const sourcePort = findPort(
        sourceNode.data.stage,
        'outputs',
        connection.sourceHandle,
        sourceNode.data.ports
      );
      const targetPort = findPort(
        targetNode.data.stage,
        'inputs',
        connection.targetHandle,
        targetNode.data.ports
      );
      if (!sourcePort || !targetPort) return false;
      if (sourcePort.dataType && targetPort.dataType && sourcePort.dataType !== targetPort.dataType) return false;
      return true;
    },
    [nodes]
  );

  const updateSelectedNodeProperties = useCallback(
    (nextProperties) => {
      if (!selectedNodeId) return;
      setNodes((nds) =>
        nds.map((node) =>
          node.id === selectedNodeId
            ? { ...node, data: { ...node.data, properties: nextProperties } }
            : node
        )
      );
    },
    [selectedNodeId, setNodes]
  );

  const updateSelectedNodePorts = useCallback(
    (nextPorts) => {
      if (!selectedNodeId) return;
      setNodes((nds) =>
        nds.map((node) =>
          node.id === selectedNodeId
            ? { ...node, data: { ...node.data, ports: nextPorts } }
            : node
        )
      );
    },
    [selectedNodeId, setNodes]
  );

  const removePort = useCallback(
    (kind, portId) => {
      if (!selectedNodeId) return;
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id !== selectedNodeId) return node;
          const ports = node.data.ports || { inputs: [], outputs: [] };
          const nextPorts = {
            ...ports,
            [kind]: ports[kind].filter((port) => port.id !== portId),
          };
          return { ...node, data: { ...node.data, ports: nextPorts } };
        })
      );
      setEdges((eds) =>
        eds.filter((edge) => {
          if (kind === 'inputs' && edge.target === selectedNodeId && edge.targetHandle === portId) {
            return false;
          }
          if (kind === 'outputs' && edge.source === selectedNodeId && edge.sourceHandle === portId) {
            return false;
          }
          return true;
        })
      );
    },
    [selectedNodeId, setNodes, setEdges]
  );

  const handleExport = () => {
    const payload = serializeGraph(nodes, edges);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'workflow.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const nextNodes = (parsed.nodes || []).map((node) => {
          const stage = stageById[node.stageId] || { label: node.label || 'Unknown', ports: { inputs: [], outputs: [] } };
          return {
            id: node.id,
            type: 'stage',
            position: node.position || { x: 0, y: 0 },
            data: {
              stageId: node.stageId,
              stage,
              label: node.label || stage.label,
              properties: node.properties || buildDefaults(stage),
              ports: node.ports || clonePorts(stage),
            },
          };
        });
        const nextEdges = (parsed.edges || []).map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
          type: 'smoothstep',
        }));
        setNodes(nextNodes);
        setEdges(nextEdges);
      } catch (err) {
        console.error('Invalid workflow JSON', err);
      }
    };
    reader.readAsText(file);
  };

  const filteredStages = useMemo(() => {
    if (!search.trim()) return stageLibrary;
    const term = search.toLowerCase();
    return stageLibrary.filter((stage) =>
      [stage.label, stage.id, stage.description, stage.category].some((text) =>
        String(text || '').toLowerCase().includes(term)
      )
    );
  }, [search, stageLibrary]);

  const groupedStages = useMemo(() => {
    return filteredStages.reduce((acc, stage) => {
      const category = stage.category || 'Other';
      if (!acc[category]) acc[category] = [];
      acc[category].push(stage);
      return acc;
    }, {});
  }, [filteredStages]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">WF</div>
          <div>
            <div className="brand-title">FlowForge</div>
            <div className="brand-subtitle">Workflow Designer</div>
          </div>
        </div>
        <div className="header-actions">
          <button className="btn ghost" onClick={() => fileInputRef.current?.click()}>Import</button>
          <button className="btn ghost" onClick={handleExport}>Save</button>
          <button className="btn primary">Run</button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          hidden
          onChange={handleImport}
        />
      </header>

      <div className="designer">
        <aside className="panel palette">
          <div className="panel-title">Palette</div>
          <input
            className="search"
            placeholder="Search stages"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {Object.entries(groupedStages).map(([category, stages]) => (
            <div key={category}>
              <div className="section-label">{category}</div>
              <div className="palette-grid">
                {stages.map((stage) => (
                  <button
                    key={stage.id}
                    type="button"
                    className="stage-card"
                    onClick={() => addStage(stage)}
                  >
                    <div className="stage-icon">{stage.icon || 'ST'}</div>
                    <div>
                      <div className="stage-title">{stage.label}</div>
                      <div className="stage-subtitle">{stage.description}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </aside>

        <main className="panel canvas">
          <div className="canvas-toolbar">
            <button className="btn ghost">Auto-Layout</button>
            <button className="btn ghost">Align</button>
            <button className="btn ghost">Zoom 100%</button>
            <div className="spacer" />
            <button className="btn ghost">Undo</button>
            <button className="btn ghost">Redo</button>
          </div>

          <div className="canvas-grid">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onSelectionChange={handleSelectionChange}
              isValidConnection={isValidConnection}
              fitView
            >
              <Background gap={24} color="#eadfce" />
              <Controls />
              <MiniMap pannable zoomable />
            </ReactFlow>
          </div>
        </main>

        <aside className="panel inspector">
          <div className="panel-title">Inspector</div>
          <Inspector
            node={selectedNode}
            onUpdateProperties={updateSelectedNodeProperties}
            onUpdatePorts={updateSelectedNodePorts}
            onRemovePort={removePort}
          />
        </aside>
      </div>

      <section className="run-panel">
        <div className="run-header">
          <div>
            <div className="run-title">Run Panel</div>
            <div className="run-subtitle">staging - last run 12:41 PM</div>
          </div>
          <div className="run-actions">
            <button className="btn ghost">Validate</button>
            <button className="btn primary">Run</button>
          </div>
        </div>
        <div className="run-body">
          <div className="run-log ok">Start -> ok (124 ms)</div>
          <div className="run-log ok">LLM -> ok (2.1 s)</div>
          <div className="run-log warn">Transform -> warning: field \"priority\" missing</div>
          <div className="run-log">Mailer -> queued</div>
        </div>
      </section>
    </div>
  );
}
