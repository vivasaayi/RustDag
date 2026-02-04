import React from 'react';
import { Handle, Position } from 'reactflow';

const PORT_SPACING = 20;
const PORT_START = 46;

function PortHandle({ id, type, index, label }) {
  const top = PORT_START + index * PORT_SPACING;
  return (
    <div className={`rf-port rf-port-${type}`} style={{ top }}>
      <Handle
        id={id}
        type={type}
        position={type === 'target' ? Position.Left : Position.Right}
      />
      <span className="rf-port-label">{label}</span>
    </div>
  );
}

export default function StageNode({ data, selected }) {
  const stage = data.stage || {};
  const ports = data.ports || stage.ports || { inputs: [], outputs: [] };
  const inputs = ports.inputs || [];
  const outputs = ports.outputs || [];

  return (
    <div className={`rf-node ${selected ? 'selected' : ''}`}>
      <div className="rf-node__header">
        <span className="rf-node__icon">{stage.icon || 'ST'}</span>
        <span className="rf-node__title">{data.label || stage.label || 'Stage'}</span>
      </div>
      <div className="rf-node__body">{stage.description || 'Configure properties'}</div>

      {inputs.map((port, index) => (
        <PortHandle key={port.id} id={port.id} type="target" index={index} label={port.label} />
      ))}
      {outputs.map((port, index) => (
        <PortHandle key={port.id} id={port.id} type="source" index={index} label={port.label} />
      ))}
    </div>
  );
}
