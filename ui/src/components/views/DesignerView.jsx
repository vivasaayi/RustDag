import React from 'react';
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
  return (
    <>
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
                  <button key={stage.id} type="button" className="stage-card" onClick={() => addStage(stage)}>
                    <div className="stage-icon">{stage.icon || 'ST'}</div>
                    <div>
                      <div className="stage-title">{stage.label}</div>
                      <div className="stage-subtitle">{stage.description}</div>
                      <div className={`risk-pill risk-${stage.riskLevel || 'medium'}`}>
                        risk: {stage.riskLevel || 'medium'}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
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
    </>
  );
}
