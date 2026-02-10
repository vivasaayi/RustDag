import React from 'react';

export default function AppHeader({
  activeView,
  setActiveView,
  profileMode,
  setProfileMode,
  onRefreshExecutions,
  onCreateFlow,
  onCopyFlow,
  hasSelectedFlow,
  onExportFlows,
  onBackToFlows,
  onSaveFlow,
  canSaveFlow,
  saveIsCopy,
  onExportWorkflow,
  onRunWorkflow,
  runLoading,
  onOpenSecrets,
  workflowFileInputRef,
  templateFileInputRef,
  onImportWorkflow,
  onImportTemplates,
}) {
  return (
    <header className="app-header">
      <div className="brand">
        <div className="brand-mark">WF</div>
        <div>
          <div className="brand-title">FlowForge</div>
          <div className="brand-subtitle">Workflow Designer</div>
        </div>
      </div>

      <div className="header-menu">
        <button
          className={`menu-item ${activeView === 'executions' ? 'active' : ''}`}
          onClick={() => setActiveView('executions')}
        >
          Executions
        </button>
        <button
          className={`menu-item ${activeView === 'flows' ? 'active' : ''}`}
          onClick={() => setActiveView('flows')}
        >
          Flows
        </button>
        {activeView === 'designer' && <button className="menu-item active">Designer</button>}
      </div>

      <div className="header-actions">
        <select
          className="input mode-select"
          value={profileMode}
          onChange={(event) => setProfileMode(event.target.value)}
        >
          <option value="everyday">Everyday</option>
          <option value="devices">Home Devices</option>
          <option value="robots">Robots + Devices</option>
          <option value="advanced">Advanced Builder</option>
        </select>

        {activeView === 'executions' && (
          <button className="btn ghost" onClick={onRefreshExecutions}>
            Refresh
          </button>
        )}

        {activeView === 'flows' && (
          <button className="btn primary" onClick={onCreateFlow}>
            New Flow
          </button>
        )}

        {activeView === 'flows' && (
          <button className="btn ghost" onClick={onCopyFlow} disabled={!hasSelectedFlow}>
            Copy Flow
          </button>
        )}

        {activeView === 'flows' && (
          <button className="btn ghost" onClick={() => templateFileInputRef.current?.click()}>
            Import Flows
          </button>
        )}

        {activeView === 'flows' && (
          <button className="btn ghost" onClick={onExportFlows}>
            Export Flows
          </button>
        )}

        {activeView === 'designer' && (
          <button className="btn ghost" onClick={onBackToFlows}>
            Back to Flows
          </button>
        )}

        {activeView === 'designer' && (
          <button className="btn ghost" onClick={onSaveFlow} disabled={!canSaveFlow}>
            {saveIsCopy ? 'Save As Copy' : 'Save Flow'}
          </button>
        )}

        {activeView === 'designer' && (
          <button className="btn ghost" onClick={() => workflowFileInputRef.current?.click()}>
            Import
          </button>
        )}

        {activeView === 'designer' && (
          <button className="btn ghost" onClick={onExportWorkflow}>
            Save
          </button>
        )}

        {activeView === 'designer' && (
          <button className="btn primary" onClick={onRunWorkflow} disabled={runLoading}>
            Run
          </button>
        )}

        <button className="btn ghost" onClick={onOpenSecrets}>
          Secrets
        </button>
      </div>

      <input
        ref={workflowFileInputRef}
        type="file"
        accept="application/json"
        hidden
        onChange={onImportWorkflow}
      />

      <input
        ref={templateFileInputRef}
        type="file"
        accept="application/json"
        hidden
        onChange={onImportTemplates}
      />
    </header>
  );
}
