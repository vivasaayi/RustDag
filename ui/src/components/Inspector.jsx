import React, { useMemo } from 'react';

function isTextAreaField(key, schema) {
  if (schema?.format === 'textarea' || schema?.format === 'multiline') return true;
  if (key.toLowerCase().includes('prompt')) return true;
  if (key.toLowerCase().includes('body')) return true;
  if (key.toLowerCase().includes('code')) return true;
  if (key.toLowerCase().includes('query')) return true;
  if (key.toLowerCase().includes('notes')) return true;
  return false;
}

function isSecretField(name) {
  const key = name.toLowerCase();
  return (
    key.includes('password') ||
    key.includes('secret') ||
    key.includes('token') ||
    key.includes('apikey') ||
    key.includes('api_key')
  );
}

function Field({ name, schema, required, value, onChange }) {
  const label = `${name}${required ? ' *' : ''}`;
  const description = schema?.description || '';

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
        {description && <div className="field-help">{description}</div>}
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
        {description && <div className="field-help">{description}</div>}
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
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
        {description && <div className="field-help">{description}</div>}
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
        {description && <div className="field-help">{description}</div>}
      </div>
    );
  }

  return (
    <div className="inspector-section">
      <div className="field-label">{label}</div>
      <input
        className="input"
        type={isSecretField(name) ? 'password' : 'text'}
        value={value ?? schema?.default ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
      {description && <div className="field-help">{description}</div>}
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

function sectionForField(key) {
  const name = key.toLowerCase();

  if (['enabled', 'executionmode', 'timeoutms', 'retrymax', 'retrybackoffms', 'onerror'].includes(name)) {
    return 'Operations';
  }

  if (
    name.includes('secret') ||
    name.includes('auth') ||
    name.includes('password') ||
    name.includes('token') ||
    name.includes('username') ||
    name.includes('connection')
  ) {
    return 'Auth & Secrets';
  }

  if (
    name.includes('dryrun') ||
    name.includes('risk') ||
    name.includes('policy') ||
    name.includes('safe') ||
    name.includes('zone') ||
    name.includes('presence') ||
    name.includes('capabilities') ||
    name.includes('emergency')
  ) {
    return 'Safety';
  }

  if (
    name.includes('cron') ||
    name.includes('timezone') ||
    name.includes('quiet') ||
    name.includes('schedule') ||
    name.includes('timeoutminutes') ||
    name.includes('delay') ||
    name.includes('starttime') ||
    name.includes('endtime') ||
    name.includes('dedupe') ||
    name.includes('event')
  ) {
    return 'Scheduling';
  }

  if (name.includes('audit') || name.includes('notes') || name.includes('trace') || name.includes('log')) {
    return 'Observability';
  }

  return 'Stage Config';
}

function sectionOrder(section) {
  const order = {
    'Operations': 1,
    'Stage Config': 2,
    'Auth & Secrets': 3,
    'Safety': 4,
    'Scheduling': 5,
    'Observability': 6,
  };
  return order[section] || 99;
}

function normalizeSchemaGroups(schema) {
  const groups = schema?.ui?.groups || schema?.groups || [];
  return Array.isArray(groups) ? groups : [];
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

  const groupedFields = useMemo(() => {
    const fieldEntries = Object.entries(schema.properties || {});
    const groupSpecs = normalizeSchemaGroups(schema);

    if (groupSpecs.length > 0) {
      const used = new Set();
      const built = groupSpecs
        .map((spec, idx) => {
          const ids = Array.isArray(spec.fields) ? spec.fields : [];
          const fields = ids
            .map((id) => {
              const fieldSchema = schema?.properties?.[id];
              if (!fieldSchema) return null;
              used.add(id);
              return [id, fieldSchema];
            })
            .filter(Boolean);
          return {
            id: spec.id || `group_${idx}`,
            title: spec.title || spec.id || `Group ${idx + 1}`,
            defaultOpen: spec.defaultOpen !== false,
            fields,
          };
        })
        .filter((g) => g.fields.length > 0);

      const ungrouped = fieldEntries.filter(([key]) => !used.has(key));
      if (ungrouped.length > 0) {
        built.push({
          id: 'group_ungrouped',
          title: 'Stage Config',
          defaultOpen: true,
          fields: ungrouped,
        });
      }
      return built;
    }

    const fallbackGroups = {};
    for (const [key, fieldSchema] of fieldEntries) {
      const section = sectionForField(key);
      if (!fallbackGroups[section]) fallbackGroups[section] = [];
      fallbackGroups[section].push([key, fieldSchema]);
    }

    return Object.entries(fallbackGroups)
      .sort((a, b) => sectionOrder(a[0]) - sectionOrder(b[0]))
      .map(([title, fields]) => ({
        id: `group_${title.toLowerCase().replace(/\s+/g, '_')}`,
        title,
        defaultOpen: title === 'Operations' || title === 'Stage Config',
        fields,
      }));
  }, [schema]);

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
    const defaultType = ports[kind][0]?.dataType || 'control';
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
        <div className="inspector-meta-row">
          <span className={`risk-pill risk-${stage.riskLevel || 'medium'}`}>risk: {stage.riskLevel || 'medium'}</span>
          <span className="pill">required fields: {required.size}</span>
        </div>
      </div>

      {groupedFields.map((group) => (
        <details key={group.id} className="inspector-accordion" open={group.defaultOpen}>
          <summary className="inspector-accordion-title">
            <span>{group.title}</span>
            <span className="inspector-accordion-count">{group.fields.length}</span>
          </summary>
          <div className="inspector-accordion-body">
            {group.fields.map(([key, fieldSchema]) => (
              <Field
                key={key}
                name={key}
                schema={fieldSchema}
                required={required.has(key)}
                value={properties[key]}
                onChange={(value) => handleFieldChange(key, value)}
              />
            ))}
          </div>
        </details>
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
