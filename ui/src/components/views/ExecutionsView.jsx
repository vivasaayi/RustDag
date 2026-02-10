import React from 'react';

export default function ExecutionsView({ executionStatusSummary, executionRows, formatDateTime }) {
  return (
    <section className="panel page-panel">
      <div className="page-header">
        <div>
          <div className="page-title">Execution Monitor</div>
          <div className="page-subtitle">Primary daily view for triggers, runs, and outcomes.</div>
        </div>
        <div className="status-cluster">
          <span className="risk-pill risk-low">completed: {executionStatusSummary.completed}</span>
          <span className="risk-pill risk-medium">waiting: {executionStatusSummary.waiting}</span>
          <span className="risk-pill risk-high">other: {executionStatusSummary.failed}</span>
        </div>
      </div>

      {executionRows.length === 0 && (
        <div className="run-log">No execution records yet. Run a workflow or template to populate this table.</div>
      )}

      {executionRows.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Source</th>
                <th>Instance</th>
                <th>Status</th>
                <th>Events</th>
                <th>Pending</th>
                <th>Outputs</th>
              </tr>
            </thead>
            <tbody>
              {executionRows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.timestamp_ms)}</td>
                  <td>{row.source}</td>
                  <td>{row.instance_id}</td>
                  <td>
                    <span className={`status-pill status-${row.status || 'unknown'}`}>{row.status || 'unknown'}</span>
                  </td>
                  <td>{row.event_count}</td>
                  <td>{row.pending_count}</td>
                  <td>{Array.isArray(row.output_keys) && row.output_keys.length > 0 ? row.output_keys.join(', ') : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
