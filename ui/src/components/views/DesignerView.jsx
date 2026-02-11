import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, { Background, Controls, MiniMap } from 'reactflow';
import Inspector from '../Inspector.jsx';
import StageNode from '../StageNode.jsx';
import WorkflowMetaPanel from '../WorkflowMetaPanel.jsx';

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
  onAutoLayout,
  onAlign,
  onZoomReset,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  handleSelectionChange,
  isValidConnection,
  workflowMeta,
  onWorkflowMetaChange,
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
  registerDesignerApi,
}) {
  const [activeCategory, setActiveCategory] = useState('all');
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const [pointerDrag, setPointerDrag] = useState(null);
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

  const placeStageAtClientPoint = useCallback((stageId, clientX, clientY) => {
    if (!stageId || !reactFlowInstance) return;
    const stage = stageMapById[stageId];
    if (!stage) return;
    const bounds = reactFlowWrapper.current?.getBoundingClientRect();
    if (!bounds) return;
    if (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) {
      return;
    }

    let position = null;
    if (typeof reactFlowInstance.screenToFlowPosition === 'function') {
      position = reactFlowInstance.screenToFlowPosition({ x: clientX, y: clientY });
    } else if (typeof reactFlowInstance.project === 'function') {
      position = reactFlowInstance.project({
        x: clientX - bounds.left,
        y: clientY - bounds.top,
      });
    }
    if (!position) return;
    addStage(stage, position);
  }, [reactFlowInstance, stageMapById, addStage]);

  const onPalettePointerDown = (event, stage) => {
    if (event.button !== 0) return;
    event.preventDefault();
    if (typeof event.currentTarget?.setPointerCapture === 'function') {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch (_) {
        // Some WebKit variants can throw when capture is unavailable.
      }
    }
    setPointerDrag({
      stageId: stage.id,
      label: stage.label,
      icon: stage.icon || 'ST',
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    });
  };

  const finishPointerDrag = useCallback((clientX, clientY) => {
    setPointerDrag((current) => {
      if (!current) return null;
      const dropX = Number.isFinite(clientX) ? clientX : current.x;
      const dropY = Number.isFinite(clientY) ? clientY : current.y;

      if (current.moved) {
        placeStageAtClientPoint(current.stageId, dropX, dropY);
      } else {
        const stage = stageMapById[current.stageId];
        if (stage) addStage(stage);
      }
      return null;
    });
  }, [addStage, placeStageAtClientPoint, stageMapById]);

  useEffect(() => {
    if (!pointerDrag) return undefined;

    const updateDrag = (clientX, clientY) => {
      if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
      setPointerDrag((current) => {
        if (!current) return current;
        const moved = current.moved || Math.hypot(clientX - current.startX, clientY - current.startY) > 6;
        return {
          ...current,
          x: clientX,
          y: clientY,
          moved,
        };
      });
    };

    const onPointerMove = (event) => updateDrag(event.clientX, event.clientY);
    const onMouseMove = (event) => updateDrag(event.clientX, event.clientY);
    const onPointerUp = (event) => finishPointerDrag(event.clientX, event.clientY);
    const onMouseUp = (event) => finishPointerDrag(event.clientX, event.clientY);
    const onPointerCancel = () => finishPointerDrag(undefined, undefined);
    const onWindowBlur = () => finishPointerDrag(undefined, undefined);

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [pointerDrag, finishPointerDrag]);

  useEffect(() => {
    if (typeof registerDesignerApi !== 'function') return undefined;
    registerDesignerApi({
      getNodes: () => (reactFlowInstance?.getNodes ? reactFlowInstance.getNodes() : nodes),
      getEdges: () => (reactFlowInstance?.getEdges ? reactFlowInstance.getEdges() : edges),
      fitView: (...args) => reactFlowInstance?.fitView?.(...args),
      setViewport: (...args) => reactFlowInstance?.setViewport?.(...args),
      zoomTo: (...args) => reactFlowInstance?.zoomTo?.(...args),
    });
    return () => registerDesignerApi(null);
  }, [registerDesignerApi, reactFlowInstance, nodes, edges]);

  return (
    <div className={`designer-page ${pointerDrag ? 'is-dragging-stage' : ''}`}>
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
                className="palette-icon-btn"
                title={`${stage.label}\n${stage.description || ''}\nrisk: ${stage.riskLevel || 'medium'}`}
                draggable={false}
                onDragStart={(event) => event.preventDefault()}
                onPointerDown={(event) => onPalettePointerDown(event, stage)}
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
            <button className="btn ghost" onClick={onAutoLayout}>Auto-Layout</button>
            <button className="btn ghost" onClick={onAlign}>Align</button>
            <button className="btn ghost" onClick={onZoomReset}>Zoom 100%</button>
            <div className="spacer" />
            <button className="btn ghost" onClick={onUndo} disabled={!canUndo}>Undo</button>
            <button className="btn ghost" onClick={onRedo} disabled={!canRedo}>Redo</button>
          </div>

          <div
            className="canvas-grid"
            ref={reactFlowWrapper}
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
          <WorkflowMetaPanel workflowMeta={workflowMeta} onChange={onWorkflowMetaChange} />
          <Inspector
            node={selectedNode}
            onUpdateProperties={updateSelectedNodeProperties}
            onUpdatePorts={updateSelectedNodePorts}
            onRemovePort={removePort}
          />
        </aside>
      </div>

      {pointerDrag?.moved && (
        <div
          className="palette-drag-preview"
          style={{ left: pointerDrag.x + 14, top: pointerDrag.y + 14 }}
        >
          <span className="palette-drag-icon">{pointerDrag.icon}</span>
          <span>{pointerDrag.label}</span>
        </div>
      )}

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
