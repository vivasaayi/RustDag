import React from 'react';

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function WorkflowMetaPanel({ workflowMeta, onChange }) {
  if (!workflowMeta) {
    return (
      <div className="workflow-meta-panel">
        <div className="field-label">Workflow</div>
        <div className="inspector-empty">Open a flow to edit workflow metadata.</div>
      </div>
    );
  }

  const profileValue = Array.isArray(workflowMeta.profiles) ? workflowMeta.profiles.join(', ') : '';
  const tagsValue = Array.isArray(workflowMeta.tags) ? workflowMeta.tags.join(', ') : '';

  return (
    <div className="workflow-meta-panel">
      <div className="field-label">Workflow</div>
      <div className="inspector-section">
        <div className="field-label">Name *</div>
        <input
          className="input"
          value={workflowMeta.name || ''}
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </div>
      <div className="inspector-section">
        <div className="field-label">Description</div>
        <textarea
          className="input"
          rows={3}
          value={workflowMeta.description || ''}
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </div>
      <div className="inspector-section">
        <div className="field-label">Category</div>
        <input
          className="input"
          value={workflowMeta.category || ''}
          onChange={(event) => onChange({ category: event.target.value })}
        />
      </div>
      <div className="inspector-section">
        <div className="field-label">Classification</div>
        <input
          className="input"
          value={workflowMeta.classification || ''}
          onChange={(event) => onChange({ classification: event.target.value })}
        />
      </div>
      <div className="inspector-section">
        <div className="field-label">Risk Level</div>
        <select
          className="input"
          value={workflowMeta.riskLevel || 'low'}
          onChange={(event) => onChange({ riskLevel: event.target.value })}
        >
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
        </select>
      </div>
      <div className="inspector-section">
        <div className="field-label">Default Device</div>
        <input
          className="input"
          value={workflowMeta.defaultDevice || 'local'}
          onChange={(event) => onChange({ defaultDevice: event.target.value })}
        />
      </div>
      <div className="inspector-section">
        <div className="field-label">Recommended Schedule</div>
        <select
          className="input"
          value={workflowMeta.recommendedSchedule || 'manual'}
          onChange={(event) => onChange({ recommendedSchedule: event.target.value })}
        >
          <option value="manual">manual</option>
          <option value="every_15m">every 15m</option>
          <option value="hourly">hourly</option>
          <option value="daily_9am">daily 9am</option>
        </select>
      </div>
      <div className="inspector-section">
        <div className="field-label">Profiles (CSV)</div>
        <input
          className="input"
          value={profileValue}
          onChange={(event) => onChange({ profiles: splitCsv(event.target.value) })}
          placeholder="everyday, devices, robots, advanced"
        />
      </div>
      <div className="inspector-section">
        <div className="field-label">Tags (CSV)</div>
        <input
          className="input"
          value={tagsValue}
          onChange={(event) => onChange({ tags: splitCsv(event.target.value) })}
          placeholder="home, planning, notification"
        />
      </div>
    </div>
  );
}
