import React from 'react';

export default function FlowsView({
  flowQuery,
  setFlowQuery,
  flowTypeFilter,
  setFlowTypeFilter,
  flowStateFilter,
  setFlowStateFilter,
  flowSort,
  setFlowSort,
  flowRows,
  selectedFlowId,
  setSelectedFlowId,
  rowMenuFlowId,
  setRowMenuFlowId,
  openFlowInDesigner,
  runTemplateNow,
  updateTemplateConfig,
  copyFlow,
  exportSingleFlow,
  formatDateTime,
}) {
  return (
    <section className="panel page-panel">
      <div className="page-header">
        <div>
          <div className="page-title">Flow Library</div>
          <div className="page-subtitle">Predefined flows are read-only. Copy them to customize.</div>
        </div>
      </div>

      <div className="flow-toolbar">
        <input
          className="input flow-search"
          placeholder="Search flows"
          value={flowQuery}
          onChange={(event) => setFlowQuery(event.target.value)}
        />
        <select className="input table-input" value={flowTypeFilter} onChange={(event) => setFlowTypeFilter(event.target.value)}>
          <option value="all">all types</option>
          <option value="predefined">predefined</option>
          <option value="custom">custom</option>
        </select>
        <select className="input table-input" value={flowStateFilter} onChange={(event) => setFlowStateFilter(event.target.value)}>
          <option value="all">all states</option>
          <option value="enabled">enabled</option>
          <option value="disabled">disabled</option>
        </select>
        <select className="input table-input" value={flowSort} onChange={(event) => setFlowSort(event.target.value)}>
          <option value="name_asc">name a-z</option>
          <option value="name_desc">name z-a</option>
          <option value="last_run_desc">last run latest</option>
          <option value="last_run_asc">last run oldest</option>
        </select>
      </div>

      {flowRows.length === 0 && (
        <div className="run-log">No flows match this filter. Try a different filter or create a new flow.</div>
      )}

      {flowRows.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Flow</th>
                <th>Type</th>
                <th>Enabled</th>
                <th>Auto</th>
                <th>Schedule</th>
                <th>Device</th>
                <th>Last Run</th>
                <th>Status</th>
                <th>Menu</th>
              </tr>
            </thead>
            <tbody>
              {flowRows.map((flow) => (
                <tr
                  key={flow.id}
                  className={selectedFlowId === flow.id ? 'is-selected' : ''}
                  onClick={() => {
                    setSelectedFlowId(flow.id);
                    setRowMenuFlowId('');
                  }}
                >
                  <td>
                    <div className="table-title">{flow.name}</div>
                    <div className="table-subtitle">{flow.description || flow.id}</div>
                  </td>
                  <td>
                    <span className={`status-pill ${flow.isPredefined ? 'status-waiting' : 'status-completed'}`}>
                      {flow.isPredefined ? 'predefined' : 'custom'}
                    </span>
                  </td>
                  <td>{flow.config.enabled ? 'yes' : 'no'}</td>
                  <td>{flow.config.autoRun ? 'yes' : 'no'}</td>
                  <td>{flow.config.schedule || 'manual'}</td>
                  <td>{flow.config.device || 'local'}</td>
                  <td>{formatDateTime(flow.config.lastRunAt)}</td>
                  <td>
                    <span className={`status-pill status-${flow.config.lastStatus || 'idle'}`}>{flow.config.lastStatus || 'idle'}</span>
                  </td>
                  <td className="menu-cell">
                    <button
                      className="btn ghost menu-trigger"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedFlowId(flow.id);
                        setRowMenuFlowId((prev) => (prev === flow.id ? '' : flow.id));
                      }}
                    >
                      Actions
                    </button>
                    {rowMenuFlowId === flow.id && (
                      <div className="row-menu" onClick={(event) => event.stopPropagation()}>
                        <button className="row-menu-item" onClick={() => { openFlowInDesigner(flow); setRowMenuFlowId(''); }}>Open in Designer</button>
                        <button className="row-menu-item" onClick={async () => { await runTemplateNow(flow, 'table'); setRowMenuFlowId(''); }}>Run Now</button>
                        <button className="row-menu-item" onClick={async () => { await updateTemplateConfig(flow.id, { enabled: !flow.config.enabled }); setRowMenuFlowId(''); }}>
                          {flow.config.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button className="row-menu-item" onClick={async () => { await updateTemplateConfig(flow.id, { autoRun: !flow.config.autoRun }); setRowMenuFlowId(''); }}>
                          {flow.config.autoRun ? 'Auto-run: off' : 'Auto-run: on'}
                        </button>
                        <button className="row-menu-item" onClick={async () => { await updateTemplateConfig(flow.id, { schedule: 'manual' }); setRowMenuFlowId(''); }}>Schedule: manual</button>
                        <button className="row-menu-item" onClick={async () => { await updateTemplateConfig(flow.id, { schedule: 'hourly' }); setRowMenuFlowId(''); }}>Schedule: hourly</button>
                        <button className="row-menu-item" onClick={async () => { await updateTemplateConfig(flow.id, { schedule: 'every_15m' }); setRowMenuFlowId(''); }}>Schedule: every 15m</button>
                        <button className="row-menu-item" onClick={async () => { await updateTemplateConfig(flow.id, { schedule: 'daily_9am' }); setRowMenuFlowId(''); }}>Schedule: daily 9am</button>
                        <button className="row-menu-item" onClick={async () => { await copyFlow(flow); setRowMenuFlowId(''); }}>Copy Flow</button>
                        <button className="row-menu-item" onClick={() => { exportSingleFlow(flow); setRowMenuFlowId(''); }}>Export Flow</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
