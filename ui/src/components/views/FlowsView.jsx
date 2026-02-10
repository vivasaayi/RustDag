import React from 'react';
import HeadlessSelect from '../ui/HeadlessSelect.jsx';

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
        <HeadlessSelect
          className="table-input"
          value={flowTypeFilter}
          onValueChange={setFlowTypeFilter}
          options={[
            { value: 'all', label: 'all types' },
            { value: 'predefined', label: 'predefined' },
            { value: 'custom', label: 'custom' },
          ]}
        />
        <HeadlessSelect
          className="table-input"
          value={flowStateFilter}
          onValueChange={setFlowStateFilter}
          options={[
            { value: 'all', label: 'all states' },
            { value: 'enabled', label: 'enabled' },
            { value: 'disabled', label: 'disabled' },
          ]}
        />
        <HeadlessSelect
          className="table-input"
          value={flowSort}
          onValueChange={setFlowSort}
          options={[
            { value: 'name_asc', label: 'name a-z' },
            { value: 'name_desc', label: 'name z-a' },
            { value: 'last_run_desc', label: 'last run latest' },
            { value: 'last_run_asc', label: 'last run oldest' },
          ]}
        />
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
