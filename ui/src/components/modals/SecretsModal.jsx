import React from 'react';

export default function SecretsModal({
  show,
  onClose,
  secretsError,
  secretNameInput,
  setSecretNameInput,
  secretValueInput,
  setSecretValueInput,
  onSaveSecret,
  secretNames,
  onDeleteSecret,
  onRefreshSecrets,
}) {
  if (!show) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="panel-title">Secrets Manager</div>
        <div className="run-log">Use values in stage properties as <code>secret://name</code>.</div>
        {secretsError && <div className="run-log warn">{secretsError}</div>}

        <div className="secret-form">
          <input
            className="input"
            placeholder="name"
            value={secretNameInput}
            onChange={(event) => setSecretNameInput(event.target.value)}
          />
          <input
            className="input"
            placeholder="value"
            value={secretValueInput}
            onChange={(event) => setSecretValueInput(event.target.value)}
          />
          <button className="btn primary" onClick={onSaveSecret}>Save Secret</button>
        </div>

        <div className="secret-list">
          {secretNames.length === 0 && <div className="run-log">No secrets saved.</div>}
          {secretNames.map((name) => (
            <div key={name} className="pending-item">
              <span>{name}</span>
              <button className="btn ghost" onClick={() => onDeleteSecret(name)}>Delete</button>
            </div>
          ))}
        </div>

        <div className="run-actions">
          <button className="btn ghost" onClick={onRefreshSecrets}>Refresh</button>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
