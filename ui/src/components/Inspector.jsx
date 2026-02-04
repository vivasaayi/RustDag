import React from 'react';

function isTextAreaField(key, schema) {
  if (schema?.format === 'textarea' || schema?.format === 'multiline') return true;
  if (key.toLowerCase().includes('prompt')) return true;
  if (key.toLowerCase().includes('body')) return true;
  if (key.toLowerCase().includes('code')) return true;
  if (key.toLowerCase().includes('query')) return true;
  return false;
}

function Field({ name, schema, required, value, onChange }) {
  const label = `${name}${required ? ' *' : ''}`;

  if (schema?.enum) {
    return (
      <div className="inspector-section">
        <div className="field-label">{label}</div>
        <select className="input" value={value ?? schema.default ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>Choose...</option>
          {schema.enum.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
    );
  }

  if (schema?.type === 'boolean') {
    return (
      <div className="inspector-section">
        <label className="checkbox">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          <span>{label}</span>
        </label>
      </div>
    );
  }

  if (schema?.type === 'number') {
    return (
      <div className="inspector-section">
        <div className="field-label">{label}</div>
        <input
          className="input"
          type="number"
          value={value ?? schema.default ?? ''}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
    );
  }

  if (schema?.type === 'string' && isTextAreaField(name, schema)) {
    return (
      <div className="inspector-section">
        <div className="field-label">{label}</div>
        <textarea
          className="input"
          rows={5}
          value={value ?? schema.default ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  return (
    <div className="inspector-section">
      <div className="field-label">{label}</div>
      <input
        className="input"
        value={value ?? schema?.default ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function buildPortId(kind, ports) {
  const base = kind === 'inputs' ? 'in' : 'out';
  let idx = ports[kind].length + 1;
  let id = `${base}_${idx}`;
  const existing = new Set(ports[kind].map((p) => p.id));
  while (existing.has(id)) {
    idx += 1;
    id = `${base}_${idx}`;
  }
  return id;
}

export default function Inspector({ node, onUpdateProperties, onUpdatePorts, onRemovePort }) {
  if (!node) {
    return <div className="inspector-empty">Select a stage to edit properties.</div>;
  }

  const schema = node.data.stage?.propertiesSchema || { type: 'object', properties: {} };
  const properties = node.data.properties || {};
  const required = new Set(schema.required || []);
  const stage = node.data.stage || {};
  const ports = node.data.ports || stage.ports || { inputs: [], outputs: [] };
  const dynamicInputs = stage.dynamicPorts?.inputs;
  const dynamicOutputs = stage.dynamicPorts?.outputs;

  const handleFieldChange = (key, nextValue) => {
    onUpdateProperties({
      ...properties,
      [key]: nextValue,
    });
  };

  const updatePort = (kind, index, patch) => {
    const nextPorts = {
      ...ports,
      [kind]: ports[kind].map((port, i) => (i === index ? { ...port, ...patch } : port)),
    };
    onUpdatePorts(nextPorts);
  };

  const addPort = (kind) => {
    const defaultType = ports[kind][0]?.dataType || (kind === 'inputs' ? 'control' : 'control');
    const nextPort = {
      id: buildPortId(kind, ports),
      label: kind === 'inputs' ? 'In' : 'Out',
      dataType: defaultType,
    };
    const nextPorts = {
      ...ports,
      [kind]: [...ports[kind], nextPort],
    };
    onUpdatePorts(nextPorts);
  };

  return (
    <>
      <div className="inspector-section">
        <div className="field-label">Stage</div>
        <div className="pill">{node.data.stage?.label || node.data.label}</div>
      </div>
      {Object.entries(schema.properties || {}).map(([key, fieldSchema]) => (
        <Field
          key={key}
          name={key}
          schema={fieldSchema}
          required={required.has(key)}
          value={properties[key]}
          onChange={(value) => handleFieldChange(key, value)}
        />
      ))}

      {(dynamicInputs || dynamicOutputs) && (
        <div className="inspector-section">
          <div className="field-label">Ports</div>

          {dynamicInputs && (
            <div className="ports-block">
              <div className="ports-title">Inputs</div>
              {ports.inputs.map((port, index) => (
                <div key={port.id} className="port-row">
                  <input
                    className="input"
                    value={port.label}
                    onChange={(event) => updatePort('inputs', index, { label: event.target.value })}
                  />
                  <select
                    className="input small"
                    value={port.dataType || 'control'}
                    onChange={(event) => updatePort('inputs', index, { dataType: event.target.value })}
                  >
                    <option value="control">control</option>
                    <option value="data">data</option>
                  </select>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => onRemovePort('inputs', port.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button type="button" className="btn ghost" onClick={() => addPort('inputs')}>
                Add input
              </button>
            </div>
          )}

          {dynamicOutputs && (
            <div className="ports-block">
              <div className="ports-title">Outputs</div>
              {ports.outputs.map((port, index) => (
                <div key={port.id} className="port-row">
                  <input
                    className="input"
                    value={port.label}
                    onChange={(event) => updatePort('outputs', index, { label: event.target.value })}
                  />
                  <select
                    className="input small"
                    value={port.dataType || 'control'}
                    onChange={(event) => updatePort('outputs', index, { dataType: event.target.value })}
                  >
                    <option value="control">control</option>
                    <option value="data">data</option>
                  </select>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => onRemovePort('outputs', port.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button type="button" className="btn ghost" onClick={() => addPort('outputs')}>
                Add output
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
