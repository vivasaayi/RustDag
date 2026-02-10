import React, { useMemo, useRef, useState } from 'react';
import ReactFlow, { Background, Controls, MiniMap } from 'reactflow';
import Inspector from '../Inspector.jsx';
import StageNode from '../StageNode.jsx';

const nodeTypes = { stage: StageNode };

export default function DesignerView({
  search,
  setSearch,
  groupedStages,
  addStage,
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  handleSelectionChange,
  isValidConnection,
  selectedNode,
  updateSelectedNodeProperties,
  updateSelectedNodePorts,
  removePort,
  runValidateOnly,
  runWorkflow,
  runLoading,
  runStatus,
  instanceId,
  autoRunMessage,
  runError,
  validationSummary,
  validationIssues,
  runEvents,
  pendingItems,
  decisionByNode,
  setDecisionByNode,
  resumePending,
}) {
  const [activeCategory, setActiveCategory] = useState('all');
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const reactFlowWrapper = useRef(null);

  const categories = useMemo(
    () => ['all', ...Object.keys(groupedStages)],
    [groupedStages]
  );

  const visibleStages = useMemo(() => {
    if (activeCategory === 'all') {
      return Object.values(groupedStages).flat();
    }
    return groupedStages[activeCategory] || [];
  }, [groupedStages, activeCategory]);

  const stageMapById = useMemo(() => {
    const map = {};
    Object.values(groupedStages).flat().forEach((stage) => {
      map[stage.id] = stage;
    });
    return map;
  }, [groupedStages]);

  const onPaletteDragStart = (event, stage) => {
    event.dataTransfer.setData('application/x-flowforge-stage', stage.id);
    event.dataTransfer.setData('text/plain', stage.id);
    event.dataTransfer.effectAllowed = 'copy';
  };

  const onCanvasDragOver = (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const onCanvasDrop = (event) => {
    event.preventDefault();
    const stageId =
      event.dataTransfer.getData('application/x-flowforge-stage') ||
      event.dataTransfer.getData('text/plain');
    if (!stageId || !reactFlowInstance) return;
    const stage = stageMapById[stageId];
    if (!stage) return;
    const bounds = reactFlowWrapper.current?.getBoundingClientRect();
    if (!bounds) return;
    const position = reactFlowInstance.project({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });
    addStage(stage, position);
  };

  return (
    <div className="designer-page">
      <div className="designer">
        <aside className="panel palette">
          <div className="panel-title">Palette</div>
          <input
            className="search"
            placeholder="Search stages"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="palette-categories">
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                className={`palette-chip ${activeCategory === category ? 'active' : ''}`}
                onClick={() => setActiveCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>
          <div className="palette-icon-grid">
            {visibleStages.map((stage) => (
              <button
                key={stage.id}
                type="button"
                draggable
                className="palette-icon-btn"
                title={`${stage.label}\n${stage.description || ''}\nrisk: ${stage.riskLevel || 'medium'}`}
                onClick={() => addStage(stage)}
                onDragStart={(event) => onPaletteDragStart(event, stage)}
              >
                <span className="palette-icon-main">{stage.icon || 'ST'}</span>
                <span className="palette-icon-label">{stage.label}</span>
              </button>
            ))}
          </div>
        </aside>

        <main className="panel canvas">
          <div className="canvas-toolbar">
            <button className="btn ghost" onClick={runValidateOnly}>Validate</button>
            <button className="btn ghost">Auto-Layout</button>
            <button className="btn ghost">Align</button>
            <button className="btn ghost">Zoom 100%</button>
            <div className="spacer" />
            <button className="btn ghost">Undo</button>
            <button className="btn ghost">Redo</button>
          </div>

          <div
            className="canvas-grid"
            ref={reactFlowWrapper}
            onDragOver={onCanvasDragOver}
            onDrop={onCanvasDrop}
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onSelectionChange={handleSelectionChange}
              isValidConnection={isValidConnection}
              onInit={setReactFlowInstance}
              defaultViewport={{ x: 0, y: 0, zoom: 1 }}
              minZoom={0.3}
              maxZoom={1.5}
            >
              <Background gap={24} color="#d6e3e6" />
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
            <div className="run-subtitle">status: {runStatus}{instanceId ? ` | instance: ${instanceId}` : ''}</div>
          </div>
          <div className="run-actions">
            <button className="btn ghost" onClick={runValidateOnly}>Validate</button>
            <button className="btn primary" onClick={runWorkflow} disabled={runLoading}>Run</button>
          </div>
        </div>

        {autoRunMessage && <div className="run-log ok">{autoRunMessage}</div>}
        {runError && <div className="run-log error">{runError}</div>}

        <div className="pending-panel">
          <div className="panel-title">Validation</div>
          <div className="run-subtitle">errors: {validationSummary.errors} | warnings: {validationSummary.warnings}</div>
          {validationIssues.length === 0 && <div className="run-log ok">No validation issues.</div>}
          {validationIssues.map((issue, idx) => (
            <div key={`v-${idx}`} className={`run-log ${issue.severity === 'error' ? 'error' : 'warn'}`}>
              [{issue.severity}] {issue.message}{issue.nodeId ? ` (node: ${issue.nodeId})` : ''}
            </div>
          ))}
        </div>

        <div className="run-body">
          {runEvents.length === 0 && <div className="run-log">No run events yet.</div>}
          {runEvents.map((event, idx) => (
            <div key={`${event.node_id}-${idx}`} className={`run-log ${event.status === 'ok' || event.status === 'resumed' ? 'ok' : ''}`}>
              {event.stage_id} ({event.node_id}) {'->'} {event.status}{event.detail ? `: ${event.detail}` : ''}
            </div>
          ))}
        </div>

        <div className="pending-panel">
          <div className="panel-title">Approvals and Triggers Inbox</div>
          {pendingItems.length === 0 && <div className="run-log">No pending approvals or triggers.</div>}
          {pendingItems.map((item) => (
            <div key={item.node_id} className="pending-item">
              <div className="pending-meta">
                <strong>{item.stage_id}</strong> ({item.node_id})
                <span className="pending-action">action: {item.action}</span>
              </div>
              {(item.action === 'approval' || item.action === 'pause') && (
                <select
                  className="input small"
                  value={decisionByNode[item.node_id] || 'approved'}
                  onChange={(event) =>
                    setDecisionByNode((prev) => ({ ...prev, [item.node_id]: event.target.value }))
                  }
                >
                  <option value="approved">approved</option>
                  <option value="rejected">rejected</option>
                  <option value="timeout">timeout</option>
                </select>
              )}
              <button className="btn ghost" onClick={() => resumePending(item)} disabled={runLoading || !instanceId}>
                Resume
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
