import React, { useMemo, useCallback, useRef, useState, useEffect } from 'react';
import { addEdge, useEdgesState, useNodesState } from 'reactflow';
import 'reactflow/dist/style.css';
import stageLibraryData from './stages/stageLibrary.json';
import templateLibraryData from './templates/workflowTemplates.json';
import AppHeader from './components/layout/AppHeader.jsx';
import ExecutionsView from './components/views/ExecutionsView.jsx';
import FlowsView from './components/views/FlowsView.jsx';
import DesignerView from './components/views/DesignerView.jsx';
import SecretsModal from './components/modals/SecretsModal.jsx';
import {
  deleteSecret,
  executeWorkflow,
  listExecutions,
  listSecrets,
  listTemplates,
  runTemplate as runTemplateById,
  resumeWorkflow,
  syncTemplates,
  setSecret,
  updateTemplateConfig as saveTemplateConfig,
} from './nativeBackend.js';

function buildDefaults(stage) {
  const schema = stage?.propertiesSchema?.properties || {};
  const defaults = {};
  Object.entries(schema).forEach(([key, def]) => {
    if (def.default !== undefined) {
      defaults[key] = def.default;
    } else if (def.type === 'boolean') {
      defaults[key] = false;
    } else {
      defaults[key] = '';
    }
  });
  return defaults;
}

function mergeProperties(stage, props) {
  return {
    ...buildDefaults(stage),
    ...(props || {}),
  };
}

function clonePorts(stage) {
  const ports = stage?.ports || { inputs: [], outputs: [] };
  return {
    inputs: ports.inputs ? ports.inputs.map((port) => ({ ...port })) : [],
    outputs: ports.outputs ? ports.outputs.map((port) => ({ ...port })) : [],
  };
}

function serializeGraph(nodes, edges) {
  const safePosition = (node, fallback = { x: 80, y: 80 }) => {
    const candidate = node?.position || node?.positionAbsolute || fallback;
    const x = Number(candidate?.x);
    const y = Number(candidate?.y);
    return {
      x: Number.isFinite(x) ? x : fallback.x,
      y: Number.isFinite(y) ? y : fallback.y,
    };
  };

  return {
    version: 1,
    nodes: nodes.map((node, index) => {
      const fallback = {
        x: 80 + (index % 4) * 220,
        y: 80 + Math.floor(index / 4) * 160,
      };
      return {
        id: node.id,
        type: node.type,
        position: safePosition(node, fallback),
        stageId: node.data.stageId,
        label: node.data.label,
        properties: node.data.properties,
        ports: node.data.ports,
      };
    }),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    })),
  };
}

function buildNodeFromStage(stage, position) {
  const id = `n_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  return {
    id,
    type: 'stage',
    position,
    data: {
      stageId: stage.id,
      stage,
      label: stage.label,
      properties: mergeProperties(stage, null),
      ports: clonePorts(stage),
    },
  };
}

function mapStageById(stages) {
  return stages.reduce((acc, stage) => {
    acc[stage.id] = stage;
    return acc;
  }, {});
}

function findPort(stage, portGroup, handleId, portsOverride) {
  const ports = portsOverride || stage?.ports || {};
  if (!ports?.[portGroup]) return null;
  if (!handleId) return ports[portGroup][0] || null;
  return ports[portGroup].find((p) => p.id === handleId) || null;
}

function materializeWorkflow(workflow, stageById) {
  const nextNodes = (workflow?.nodes || []).map((node, index) => {
    const stage = stageById[node.stageId] || {
      id: node.stageId,
      label: node.label || 'Unknown Stage',
      ports: { inputs: [], outputs: [] },
      propertiesSchema: { type: 'object', properties: {} },
      riskLevel: 'high',
    };

    const fallbackPosition = {
      x: 80 + (index % 4) * 240,
      y: 80 + Math.floor(index / 4) * 180,
    };
    const x = Number(node?.position?.x);
    const y = Number(node?.position?.y);
    const nextPosition = {
      x: Number.isFinite(x) ? x : fallbackPosition.x,
      y: Number.isFinite(y) ? y : fallbackPosition.y,
    };

    return {
      id: node.id,
      type: 'stage',
      position: nextPosition,
      data: {
        stageId: node.stageId,
        stage,
        label: node.label || stage.label,
        properties: mergeProperties(stage, node.properties),
        ports: node.ports || clonePorts(stage),
      },
    };
  });

  const nextEdges = (workflow?.edges || []).map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    type: 'smoothstep',
  }));

  return { nodes: nextNodes, edges: nextEdges };
}

function cloneGraphSnapshot(nodes, edges) {
  return JSON.parse(JSON.stringify({ nodes, edges }));
}

function computeAutoLayout(nodes, edges) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map();
  const indegree = new Map();

  nodes.forEach((node) => {
    outgoing.set(node.id, []);
    indegree.set(node.id, 0);
  });

  edges.forEach((edge) => {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) return;
    outgoing.get(edge.source).push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
  });

  const levelById = new Map();
  const queue = [];
  indegree.forEach((degree, id) => {
    if (degree === 0) queue.push(id);
  });
  if (queue.length === 0 && nodes.length > 0) queue.push(nodes[0].id);

  while (queue.length > 0) {
    const currentId = queue.shift();
    const currentLevel = levelById.get(currentId) || 0;
    const nextIds = outgoing.get(currentId) || [];
    nextIds.forEach((nextId) => {
      const nextLevel = Math.max(levelById.get(nextId) || 0, currentLevel + 1);
      levelById.set(nextId, nextLevel);
      const nextDegree = (indegree.get(nextId) || 0) - 1;
      indegree.set(nextId, nextDegree);
      if (nextDegree === 0) queue.push(nextId);
    });
  }

  const groupedByLevel = new Map();
  nodes.forEach((node) => {
    const level = levelById.get(node.id) || 0;
    if (!groupedByLevel.has(level)) groupedByLevel.set(level, []);
    groupedByLevel.get(level).push(node);
  });

  groupedByLevel.forEach((groupNodes) => {
    groupNodes.sort((a, b) => (a.position?.y || 0) - (b.position?.y || 0));
  });

  const columnGap = 300;
  const rowGap = 190;
  const startX = 120;
  const startY = 100;
  const layoutById = new Map();

  Array.from(groupedByLevel.keys())
    .sort((a, b) => a - b)
    .forEach((level) => {
      const groupNodes = groupedByLevel.get(level) || [];
      groupNodes.forEach((node, index) => {
        layoutById.set(node.id, {
          x: startX + level * columnGap,
          y: startY + index * rowGap,
        });
      });
    });

  return nodes.map((node) => ({
    ...node,
    position: layoutById.get(node.id) || node.position,
  }));
}

function collectSecretRefs(value, refs) {
  if (typeof value === 'string') {
    if (value.startsWith('secret://')) {
      refs.add(value.slice('secret://'.length));
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectSecretRefs(item, refs));
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectSecretRefs(item, refs));
  }
}

function parseCapabilityList(value) {
  if (!value || typeof value !== 'string') return [];
  return value
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function validateWorkflowGraph(workflow, stageById, secretSet) {
  const issues = [];
  const hasSafetyGuard = (workflow.nodes || []).some((node) => node.stageId === 'safety_guard');
  const hasEmergencyStop = (workflow.nodes || []).some((node) => node.stageId === 'emergency_stop');

  if (!(workflow.nodes || []).some((node) => node.stageId === 'start' || node.stageId === 'trigger')) {
    issues.push({ severity: 'warning', message: 'Workflow has no start or trigger stage.', nodeId: null });
  }

  (workflow.nodes || []).forEach((node) => {
    const stage = stageById[node.stageId];
    if (!stage) {
      issues.push({
        severity: 'error',
        message: `Unknown stage: ${node.stageId}`,
        nodeId: node.id,
      });
      return;
    }

    const properties = node.properties || {};
    const required = stage?.propertiesSchema?.required || [];

    required.forEach((key) => {
      const val = properties[key];
      const missing = val === null || val === undefined || (typeof val === 'string' && val.trim() === '');
      if (missing) {
        issues.push({
          severity: 'error',
          message: `Missing required property '${key}' for ${stage.label}.`,
          nodeId: node.id,
          field: key,
        });
      }
    });

    const refs = new Set();
    collectSecretRefs(properties, refs);
    refs.forEach((name) => {
      if (!secretSet.has(name)) {
        issues.push({
          severity: 'error',
          message: `Secret '${name}' not found for ${stage.label}.`,
          nodeId: node.id,
        });
      }
    });

    if (stage.riskLevel === 'high') {
      if (!hasSafetyGuard) {
        issues.push({
          severity: 'error',
          message: 'High-risk stages require at least one Safety Guard stage.',
          nodeId: node.id,
        });
      }
      if (!hasEmergencyStop) {
        issues.push({
          severity: 'warning',
          message: 'High-risk stages should include an Emergency Stop stage.',
          nodeId: node.id,
        });
      }
    }

    const requiredCaps = Array.isArray(stage.requiredCapabilities) ? stage.requiredCapabilities : [];
    if (requiredCaps.length > 0) {
      const configuredCaps = parseCapabilityList(properties.requiredCapabilities);
      const missingCaps = requiredCaps.filter((cap) => !configuredCaps.includes(cap));
      if (missingCaps.length > 0) {
        issues.push({
          severity: 'warning',
          message: `Recommended capabilities missing: ${missingCaps.join(', ')}.`,
          nodeId: node.id,
        });
      }
    }
  });

  return issues;
}

function defaultTemplateConfig(template) {
  return {
    enabled: true,
    autoRun: false,
    schedule: template?.recommendedSchedule || 'manual',
    device: template?.defaultDevice || 'local',
    lastRunAt: 0,
    lastStatus: '',
    lastError: '',
    lastInstanceId: '',
  };
}

function mergeTemplateConfigsFromBackend(records, templates) {
  const merged = {};

  (records || []).forEach((record) => {
    merged[record.id] = {
      ...defaultTemplateConfig(record),
      enabled: record?.enabled ?? true,
      autoRun: record?.autoRun ?? false,
      schedule: record?.schedule || record?.recommendedSchedule || 'manual',
      device: record?.device || record?.defaultDevice || 'local',
      lastRunAt: record?.lastRunAt || 0,
      lastStatus: record?.lastStatus || '',
      lastError: record?.lastError || '',
      lastInstanceId: record?.lastInstanceId || '',
    };
  });

  (templates || []).forEach((template) => {
    if (!merged[template.id]) {
      merged[template.id] = defaultTemplateConfig(template);
    }
  });

  return merged;
}

function downloadJsonFile(name, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatDateTime(ts) {
  if (!ts) return 'never';
  try {
    return new Date(ts).toLocaleString();
  } catch (_) {
    return 'invalid';
  }
}

const DEFAULT_CUSTOM_PROFILES = ['everyday', 'devices', 'robots', 'advanced'];

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'flow';
}

function uniqueName(base, existingNames) {
  if (!existingNames.has(base)) return base;
  let idx = 2;
  while (existingNames.has(`${base} ${idx}`)) idx += 1;
  return `${base} ${idx}`;
}

function starterWorkflow() {
  return {
    version: 1,
    nodes: [
      {
        id: 'start_1',
        stageId: 'start',
        position: { x: 120, y: 140 },
        label: 'Start',
        properties: {},
        ports: { inputs: [], outputs: [{ id: 'out' }] },
      },
      {
        id: 'stop_1',
        stageId: 'stop',
        position: { x: 420, y: 140 },
        label: 'Stop',
        properties: {},
        ports: { inputs: [{ id: 'in' }], outputs: [] },
      },
    ],
    edges: [
      {
        id: 'edge_1',
        source: 'start_1',
        target: 'stop_1',
        sourceHandle: 'out',
        targetHandle: 'in',
      },
    ],
  };
}

export default function App() {
  const stageLibrary = stageLibraryData.stages || [];
  const templateLibrary = templateLibraryData.templates || [];
  const stageById = useMemo(() => mapStageById(stageLibrary), [stageLibrary]);

  const initialNodes = useMemo(() => {
    const startStage = stageById.start;
    const stopStage = stageById.stop;
    if (!startStage || !stopStage) return [];
    return [
      buildNodeFromStage(startStage, { x: 80, y: 80 }),
      buildNodeFromStage(stopStage, { x: 480, y: 260 }),
    ];
  }, [stageById]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [search, setSearch] = useState('');
  const [profileMode, setProfileMode] = useState('everyday');
  const [activeView, setActiveView] = useState('executions');
  const [selectedFlowId, setSelectedFlowId] = useState('');
  const [flowQuery, setFlowQuery] = useState('');
  const [flowTypeFilter, setFlowTypeFilter] = useState('all');
  const [flowStateFilter, setFlowStateFilter] = useState('all');
  const [flowSort, setFlowSort] = useState('name_asc');
  const [rowMenuFlowId, setRowMenuFlowId] = useState('');
  const [designerFlowId, setDesignerFlowId] = useState('');
  const [designerFlowIsPredefined, setDesignerFlowIsPredefined] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [runStatus, setRunStatus] = useState('idle');
  const [runEvents, setRunEvents] = useState([]);
  const [pendingItems, setPendingItems] = useState([]);
  const [instanceId, setInstanceId] = useState('');
  const [runError, setRunError] = useState('');
  const [decisionByNode, setDecisionByNode] = useState({});
  const [validationIssues, setValidationIssues] = useState([]);
  const [showSecrets, setShowSecrets] = useState(false);
  const [secretNames, setSecretNames] = useState([]);
  const [secretNameInput, setSecretNameInput] = useState('');
  const [secretValueInput, setSecretValueInput] = useState('');
  const [secretsError, setSecretsError] = useState('');
  const [templateRecords, setTemplateRecords] = useState([]);
  const [templateConfigs, setTemplateConfigs] = useState(() => mergeTemplateConfigsFromBackend([], templateLibrary));
  const [executionRows, setExecutionRows] = useState([]);
  const [autoRunMessage, setAutoRunMessage] = useState('');
  const [designerFlowMeta, setDesignerFlowMeta] = useState(null);
  const workflowFileInputRef = useRef(null);
  const templateFileInputRef = useRef(null);
  const designerApiRef = useRef(null);
  const historyPastRef = useRef([]);
  const historyFutureRef = useRef([]);
  const historyLockRef = useRef(false);
  const [historyVersion, setHistoryVersion] = useState(0);

  const visibleProfiles = useMemo(() => {
    if (profileMode === 'everyday') return new Set(['everyday']);
    if (profileMode === 'devices') return new Set(['everyday', 'devices']);
    if (profileMode === 'robots') return new Set(['everyday', 'devices', 'robots']);
    return new Set(['everyday', 'devices', 'robots', 'advanced']);
  }, [profileMode]);

  const predefinedFlowIds = useMemo(
    () => new Set((templateLibrary || []).map((item) => item.id)),
    [templateLibrary]
  );

  const effectiveTemplateRecords = useMemo(() => {
    if (templateRecords.length > 0) return templateRecords;
    return templateLibrary;
  }, [templateRecords, templateLibrary]);

  const handleSelectionChange = useCallback(({ nodes: selected }) => {
    setSelectedNodeId(selected?.[0]?.id || null);
  }, []);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;

  const resetHistory = useCallback(() => {
    historyPastRef.current = [];
    historyFutureRef.current = [];
    setHistoryVersion((v) => v + 1);
  }, []);

  const pushHistorySnapshot = useCallback((snapshotNodes = nodes, snapshotEdges = edges) => {
    if (historyLockRef.current) return;
    const serialized = JSON.stringify(cloneGraphSnapshot(snapshotNodes, snapshotEdges));
    const last = historyPastRef.current[historyPastRef.current.length - 1];
    if (serialized === last) return;
    historyPastRef.current.push(serialized);
    if (historyPastRef.current.length > 120) {
      historyPastRef.current.shift();
    }
    historyFutureRef.current = [];
    setHistoryVersion((v) => v + 1);
  }, [nodes, edges]);

  const restoreHistorySnapshot = useCallback((serialized) => {
    if (!serialized) return;
    let parsed;
    try {
      parsed = JSON.parse(serialized);
    } catch (_) {
      return;
    }
    historyLockRef.current = true;
    setNodes(parsed.nodes || []);
    setEdges(parsed.edges || []);
    requestAnimationFrame(() => {
      historyLockRef.current = false;
    });
  }, [setNodes, setEdges]);

  const canUndo = useMemo(() => historyPastRef.current.length > 0, [historyVersion]);
  const canRedo = useMemo(() => historyFutureRef.current.length > 0, [historyVersion]);

  const undoGraph = useCallback(() => {
    if (historyPastRef.current.length === 0) return;
    const previous = historyPastRef.current.pop();
    const current = JSON.stringify(cloneGraphSnapshot(nodes, edges));
    historyFutureRef.current.push(current);
    restoreHistorySnapshot(previous);
    setHistoryVersion((v) => v + 1);
  }, [nodes, edges, restoreHistorySnapshot]);

  const redoGraph = useCallback(() => {
    if (historyFutureRef.current.length === 0) return;
    const next = historyFutureRef.current.pop();
    const current = JSON.stringify(cloneGraphSnapshot(nodes, edges));
    historyPastRef.current.push(current);
    restoreHistorySnapshot(next);
    setHistoryVersion((v) => v + 1);
  }, [nodes, edges, restoreHistorySnapshot]);

  const addStage = useCallback(
    (stage, position) => {
      const defaultPosition = { x: 100, y: 100 };
      const nextPosition = position || defaultPosition;
      pushHistorySnapshot();
      setNodes((nds) => nds.concat(buildNodeFromStage(stage, nextPosition)));
    },
    [setNodes, pushHistorySnapshot]
  );

  const onConnect = useCallback(
    (connection) => {
      pushHistorySnapshot();
      setEdges((eds) => addEdge({ ...connection, type: 'smoothstep' }, eds));
    },
    [setEdges, pushHistorySnapshot]
  );

  const onNodesChangeTracked = useCallback((changes) => {
    const shouldRecord = changes.some((change) =>
      change.type === 'add' ||
      change.type === 'remove' ||
      (change.type === 'position' && change.dragging === false)
    );
    if (shouldRecord) pushHistorySnapshot();
    onNodesChange(changes);
  }, [onNodesChange, pushHistorySnapshot]);

  const onEdgesChangeTracked = useCallback((changes) => {
    const shouldRecord = changes.some((change) => change.type === 'add' || change.type === 'remove');
    if (shouldRecord) pushHistorySnapshot();
    onEdgesChange(changes);
  }, [onEdgesChange, pushHistorySnapshot]);

  const isValidConnection = useCallback(
    (connection) => {
      const sourceNode = nodes.find((node) => node.id === connection.source);
      const targetNode = nodes.find((node) => node.id === connection.target);
      if (!sourceNode || !targetNode) return false;
      const sourcePort = findPort(sourceNode.data.stage, 'outputs', connection.sourceHandle, sourceNode.data.ports);
      const targetPort = findPort(targetNode.data.stage, 'inputs', connection.targetHandle, targetNode.data.ports);
      if (!sourcePort || !targetPort) return false;
      if (sourcePort.dataType && targetPort.dataType && sourcePort.dataType !== targetPort.dataType) return false;
      return true;
    },
    [nodes]
  );

  const updateSelectedNodeProperties = useCallback(
    (nextProperties) => {
      if (!selectedNodeId) return;
      pushHistorySnapshot();
      setNodes((nds) =>
        nds.map((node) =>
          node.id === selectedNodeId
            ? { ...node, data: { ...node.data, properties: nextProperties } }
            : node
        )
      );
    },
    [selectedNodeId, setNodes, pushHistorySnapshot]
  );

  const updateSelectedNodePorts = useCallback(
    (nextPorts) => {
      if (!selectedNodeId) return;
      pushHistorySnapshot();
      setNodes((nds) =>
        nds.map((node) =>
          node.id === selectedNodeId
            ? { ...node, data: { ...node.data, ports: nextPorts } }
            : node
        )
      );
    },
    [selectedNodeId, setNodes, pushHistorySnapshot]
  );

  const removePort = useCallback(
    (kind, portId) => {
      if (!selectedNodeId) return;
      pushHistorySnapshot();
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id !== selectedNodeId) return node;
          const ports = node.data.ports || { inputs: [], outputs: [] };
          const nextPorts = {
            ...ports,
            [kind]: ports[kind].filter((port) => port.id !== portId),
          };
          return { ...node, data: { ...node.data, ports: nextPorts } };
        })
      );
      setEdges((eds) =>
        eds.filter((edge) => {
          if (kind === 'inputs' && edge.target === selectedNodeId && edge.targetHandle === portId) return false;
          if (kind === 'outputs' && edge.source === selectedNodeId && edge.sourceHandle === portId) return false;
          return true;
        })
      );
    },
    [selectedNodeId, setNodes, setEdges, pushHistorySnapshot]
  );

  const handleExport = () => {
    const liveNodes = designerApiRef.current?.getNodes?.();
    const liveEdges = designerApiRef.current?.getEdges?.();
    const payload = serializeGraph(Array.isArray(liveNodes) ? liveNodes : nodes, Array.isArray(liveEdges) ? liveEdges : edges);
    downloadJsonFile('workflow.json', payload);
  };

  const loadWorkflowToCanvas = useCallback((workflow) => {
    const materialized = materializeWorkflow(workflow, stageById);
    historyLockRef.current = true;
    setNodes(materialized.nodes);
    setEdges(materialized.edges);
    requestAnimationFrame(() => {
      historyLockRef.current = false;
      resetHistory();
    });
    setRunStatus('idle');
    setRunEvents([]);
    setPendingItems([]);
    setInstanceId('');
    setRunError('');
    setValidationIssues([]);
  }, [stageById, setNodes, setEdges, resetHistory]);

  const handleImportWorkflow = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        loadWorkflowToCanvas(parsed);
      } catch (err) {
        setRunError('Invalid workflow JSON file.');
      }
    };
    reader.readAsText(file);
  };

  const refreshSecrets = useCallback(async () => {
    setSecretsError('');
    try {
      const response = await listSecrets();
      setSecretNames(response?.secrets || []);
      return response?.secrets || [];
    } catch (error) {
      setSecretsError(error?.message || 'Failed to load secrets');
      return [];
    }
  }, []);

  const refreshTemplateConfigs = useCallback(async () => {
    try {
      const response = await listTemplates();
      const records = response?.templates || [];
      setTemplateRecords(records);
      setTemplateConfigs(mergeTemplateConfigsFromBackend(records, templateLibrary.length > 0 ? templateLibrary : records));
      if (selectedFlowId && !records.some((item) => item.id === selectedFlowId)) {
        setSelectedFlowId('');
      }
    } catch (error) {
      setRunError(error?.message || 'Failed to load templates');
    }
  }, [templateLibrary, selectedFlowId]);

  const refreshExecutions = useCallback(async () => {
    try {
      const response = await listExecutions(300);
      setExecutionRows(response?.executions || []);
    } catch (error) {
      setRunError(error?.message || 'Failed to load executions');
    }
  }, []);

  const syncTemplateLibrary = useCallback(async () => {
    try {
      await syncTemplates(templateLibrary);
      await refreshTemplateConfigs();
    } catch (error) {
      setRunError(error?.message || 'Failed to sync templates');
    }
  }, [templateLibrary, refreshTemplateConfigs]);

  useEffect(() => {
    syncTemplateLibrary();
  }, [syncTemplateLibrary]);

  useEffect(() => {
    refreshExecutions();
  }, [refreshExecutions]);

  useEffect(() => {
    if (activeView !== 'executions') return undefined;
    const timer = setInterval(() => {
      refreshExecutions();
    }, 15000);
    return () => clearInterval(timer);
  }, [activeView, refreshExecutions]);

  useEffect(() => {
    if (!rowMenuFlowId) return undefined;
    const close = () => setRowMenuFlowId('');
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setRowMenuFlowId('');
    };
    document.addEventListener('click', close);
    document.addEventListener('contextmenu', close);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('contextmenu', close);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [rowMenuFlowId]);

  const validateCurrentWorkflow = useCallback(async (workflow) => {
    const secretList = await refreshSecrets();
    const issues = validateWorkflowGraph(workflow, stageById, new Set(secretList));
    setValidationIssues(issues);
    return issues;
  }, [refreshSecrets, stageById]);

  const runWorkflowGraph = useCallback(async (workflow, runSource = 'manual') => {
    setRunLoading(true);
    setRunError('');
    try {
      const issues = await validateCurrentWorkflow(workflow);
      const blockingErrors = issues.filter((item) => item.severity === 'error');
      if (blockingErrors.length > 0) {
        setRunStatus('validation_failed');
        setRunError(`Run blocked by ${blockingErrors.length} validation error(s).`);
        return { executed: false };
      }

      const response = await executeWorkflow(workflow);
      const result = response?.result || {};
      setInstanceId(result.instance_id || '');
      setRunStatus(result.status || 'unknown');
      setRunEvents(result.events || []);
      setPendingItems(result.pending || []);
      setAutoRunMessage(runSource.startsWith('scheduled:') ? `Scheduled run completed: ${runSource.replace('scheduled:', '')}` : '');
      await refreshExecutions();
      return { executed: true, result };
    } catch (error) {
      setRunError(error?.message || 'Run failed');
      return { executed: false };
    } finally {
      setRunLoading(false);
    }
  }, [validateCurrentWorkflow, refreshExecutions]);

  const runWorkflow = useCallback(async () => {
    const liveNodes = designerApiRef.current?.getNodes?.();
    const liveEdges = designerApiRef.current?.getEdges?.();
    const workflow = serializeGraph(Array.isArray(liveNodes) ? liveNodes : nodes, Array.isArray(liveEdges) ? liveEdges : edges);
    await runWorkflowGraph(workflow, 'canvas');
  }, [nodes, edges, runWorkflowGraph]);

  const runValidateOnly = useCallback(async () => {
    const liveNodes = designerApiRef.current?.getNodes?.();
    const liveEdges = designerApiRef.current?.getEdges?.();
    const workflow = serializeGraph(Array.isArray(liveNodes) ? liveNodes : nodes, Array.isArray(liveEdges) ? liveEdges : edges);
    setRunError('');
    await validateCurrentWorkflow(workflow);
  }, [nodes, edges, validateCurrentWorkflow]);

  const autoLayoutCanvas = useCallback(() => {
    const liveNodes = designerApiRef.current?.getNodes?.();
    const liveEdges = designerApiRef.current?.getEdges?.();
    const currentNodes = Array.isArray(liveNodes) ? liveNodes : nodes;
    const currentEdges = Array.isArray(liveEdges) ? liveEdges : edges;
    if (currentNodes.length === 0) return;
    pushHistorySnapshot(currentNodes, currentEdges);
    const laidOut = computeAutoLayout(currentNodes, currentEdges);
    setNodes(laidOut);
    requestAnimationFrame(() => {
      designerApiRef.current?.fitView?.({ padding: 0.18, duration: 220 });
    });
  }, [nodes, edges, pushHistorySnapshot, setNodes]);

  const alignToGrid = useCallback(() => {
    const liveNodes = designerApiRef.current?.getNodes?.();
    const liveEdges = designerApiRef.current?.getEdges?.();
    const currentNodes = Array.isArray(liveNodes) ? liveNodes : nodes;
    const currentEdges = Array.isArray(liveEdges) ? liveEdges : edges;
    if (currentNodes.length === 0) return;
    pushHistorySnapshot(currentNodes, currentEdges);
    const grid = 24;
    setNodes(currentNodes.map((node) => ({
      ...node,
      position: {
        x: Math.round((node.position?.x || 0) / grid) * grid,
        y: Math.round((node.position?.y || 0) / grid) * grid,
      },
    })));
  }, [nodes, edges, pushHistorySnapshot, setNodes]);

  const resetZoom = useCallback(() => {
    if (designerApiRef.current?.setViewport) {
      designerApiRef.current.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 180 });
      return;
    }
    if (designerApiRef.current?.zoomTo) {
      designerApiRef.current.zoomTo(1, { duration: 180 });
    }
  }, []);

  const resumePending = useCallback(
    async (item) => {
      if (!instanceId) return;
      setRunLoading(true);
      setRunError('');
      try {
        const response = await resumeWorkflow(instanceId, {
          node_id: item.node_id,
          decision: decisionByNode[item.node_id] || 'approved',
          payload: null,
        });
        const result = response?.result || {};
        setRunStatus(result.status || 'unknown');
        setRunEvents((prev) => [...prev, ...(result.events || [])]);
        setPendingItems(result.pending || []);
        await refreshExecutions();
      } catch (error) {
        setRunError(error?.message || 'Resume failed');
      } finally {
        setRunLoading(false);
      }
    },
    [instanceId, decisionByNode, refreshExecutions]
  );

  const saveSecret = useCallback(async () => {
    if (!secretNameInput.trim() || !secretValueInput) return;
    setSecretsError('');
    try {
      await setSecret(secretNameInput.trim(), secretValueInput);
      setSecretNameInput('');
      setSecretValueInput('');
      await refreshSecrets();
    } catch (error) {
      setSecretsError(error?.message || 'Failed to save secret');
    }
  }, [secretNameInput, secretValueInput, refreshSecrets]);

  const removeSecret = useCallback(
    async (name) => {
      setSecretsError('');
      try {
        await deleteSecret(name);
        await refreshSecrets();
      } catch (error) {
        setSecretsError(error?.message || 'Failed to delete secret');
      }
    },
    [refreshSecrets]
  );

  const openSecrets = useCallback(async () => {
    setShowSecrets(true);
    await refreshSecrets();
  }, [refreshSecrets]);

  const handleExportTemplates = useCallback(() => {
    downloadJsonFile('flowforge-templates.json', {
      version: 1,
      templates: templateRecords,
    });
  }, [templateRecords]);

  const handleImportTemplates = useCallback((event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(reader.result);
        const templates = Array.isArray(parsed) ? parsed : parsed.templates;
        if (!Array.isArray(templates)) {
          setRunError('Invalid template file format.');
          return;
        }
        const response = await syncTemplates(templates);
        if (response?.error) {
          setRunError(response.error);
          return;
        }
        await refreshTemplateConfigs();
      } catch (err) {
        setRunError('Invalid template JSON file.');
      }
    };
    reader.readAsText(file);
  }, [refreshTemplateConfigs]);

  const upsertFlow = useCallback(async (definition) => {
    const response = await syncTemplates([definition]);
    if (response?.error) {
      throw new Error(response.error);
    }
    await refreshTemplateConfigs();
  }, [refreshTemplateConfigs]);

  const flowMapById = useMemo(() => {
    const map = {};
    effectiveTemplateRecords.forEach((item) => {
      map[item.id] = item;
    });
    return map;
  }, [effectiveTemplateRecords]);

  const openFlowInDesigner = useCallback((flow) => {
    const isPredefined = predefinedFlowIds.has(flow.id);
    loadWorkflowToCanvas(flow.workflow);
    setDesignerFlowId(flow.id);
    setDesignerFlowIsPredefined(isPredefined);
    setDesignerFlowMeta({
      id: flow.id,
      name: flow.name || '',
      description: flow.description || '',
      category: flow.category || 'User Flows',
      classification: flow.classification || '',
      riskLevel: flow.riskLevel || 'low',
      defaultDevice: flow.defaultDevice || 'local',
      recommendedSchedule: flow.recommendedSchedule || 'manual',
      profiles: Array.isArray(flow.profiles) ? flow.profiles : DEFAULT_CUSTOM_PROFILES,
      tags: Array.isArray(flow.tags) ? flow.tags : [],
    });
    setActiveView('designer');
  }, [loadWorkflowToCanvas, predefinedFlowIds]);

  const createNewFlow = useCallback(async () => {
    try {
      const names = new Set(effectiveTemplateRecords.map((item) => item.name));
      const name = uniqueName('New Flow', names);
      const id = `custom_${slugify(name)}_${Date.now()}`;
      const definition = {
        id,
        name,
        category: 'User Flows',
        description: 'User-defined flow',
        classification: 'general',
        tags: [],
        profiles: DEFAULT_CUSTOM_PROFILES,
        riskLevel: 'low',
        defaultDevice: 'local',
        recommendedSchedule: 'manual',
        workflow: starterWorkflow(),
      };
      await upsertFlow(definition);
      openFlowInDesigner(definition);
    } catch (error) {
      setRunError(error?.message || 'Failed to create new flow');
    }
  }, [effectiveTemplateRecords, openFlowInDesigner, upsertFlow]);

  const copyFlow = useCallback(async (flow) => {
    if (!flow) return;
    try {
      const names = new Set(effectiveTemplateRecords.map((item) => item.name));
      const baseName = `${flow.name || 'Flow'}-copy`;
      const name = uniqueName(baseName, names);
      const id = `custom_${slugify(name)}_${Date.now()}`;
      const definition = {
        id,
        name,
        category: flow.category || 'User Flows',
        description: flow.description || `Copy of ${flow.name}`,
        classification: flow.classification || 'general',
        tags: Array.isArray(flow.tags) ? flow.tags : [],
        profiles: Array.isArray(flow.profiles) && flow.profiles.length > 0 ? flow.profiles : DEFAULT_CUSTOM_PROFILES,
        riskLevel: flow.riskLevel || 'low',
        defaultDevice: flow.defaultDevice || 'local',
        recommendedSchedule: flow.recommendedSchedule || 'manual',
        workflow: flow.workflow || starterWorkflow(),
      };
      await upsertFlow(definition);
      openFlowInDesigner(definition);
    } catch (error) {
      setRunError(error?.message || 'Failed to copy flow');
    }
  }, [effectiveTemplateRecords, openFlowInDesigner, upsertFlow]);

  const copySelectedFlow = useCallback(async () => {
    const selected = flowMapById[selectedFlowId];
    if (!selected) return;
    await copyFlow(selected);
  }, [flowMapById, selectedFlowId, copyFlow]);

  const updateDesignerMeta = useCallback((patch) => {
    setDesignerFlowMeta((prev) => ({ ...(prev || {}), ...patch }));
  }, []);

  const exportSingleFlow = useCallback((flow) => {
    if (!flow) return;
    downloadJsonFile(`${slugify(flow.name || flow.id)}.json`, {
      version: 1,
      templates: [flow],
    });
  }, []);

  const saveDesignerFlow = useCallback(async () => {
    const liveNodes = designerApiRef.current?.getNodes?.();
    const liveEdges = designerApiRef.current?.getEdges?.();
    const workflow = serializeGraph(Array.isArray(liveNodes) ? liveNodes : nodes, Array.isArray(liveEdges) ? liveEdges : edges);
    const source = flowMapById[designerFlowId];
    if (!source) {
      setRunError('No active flow selected in designer.');
      return;
    }
    const meta = designerFlowMeta || source;

    try {
      if (designerFlowIsPredefined) {
        await copyFlow({
          ...source,
          name: (meta.name || source.name || '').trim() || source.name,
          description: meta.description || source.description || '',
          category: meta.category || source.category || 'User Flows',
          classification: meta.classification || source.classification || '',
          tags: Array.isArray(meta.tags) ? meta.tags : (source.tags || []),
          riskLevel: meta.riskLevel || source.riskLevel || 'low',
          defaultDevice: meta.defaultDevice || source.defaultDevice || 'local',
          recommendedSchedule: meta.recommendedSchedule || source.recommendedSchedule || 'manual',
          profiles: Array.isArray(meta.profiles) && meta.profiles.length > 0 ? meta.profiles : (source.profiles || DEFAULT_CUSTOM_PROFILES),
          workflow,
        });
        return;
      }

      const definition = {
        id: source.id,
        name: (meta.name || source.name || '').trim() || source.name,
        category: meta.category || source.category || 'User Flows',
        description: meta.description || source.description || 'User-defined flow',
        classification: meta.classification || source.classification || '',
        tags: Array.isArray(meta.tags) ? meta.tags : (source.tags || []),
        profiles: Array.isArray(meta.profiles) && meta.profiles.length > 0 ? meta.profiles : (source.profiles || DEFAULT_CUSTOM_PROFILES),
        riskLevel: meta.riskLevel || source.riskLevel || 'low',
        defaultDevice: meta.defaultDevice || source.defaultDevice || 'local',
        recommendedSchedule: meta.recommendedSchedule || source.recommendedSchedule || 'manual',
        workflow,
      };
      await upsertFlow(definition);
    } catch (error) {
      setRunError(error?.message || 'Failed to save flow');
    }
  }, [nodes, edges, flowMapById, designerFlowId, designerFlowIsPredefined, copyFlow, upsertFlow, designerFlowMeta]);

  const filteredStages = useMemo(() => {
    const byProfile = stageLibrary.filter((stage) => {
      const profiles = stage.profiles || ['advanced'];
      return profiles.some((profile) => visibleProfiles.has(profile));
    });

    if (!search.trim()) return byProfile;
    const term = search.toLowerCase();
    return byProfile.filter((stage) =>
      [stage.label, stage.id, stage.description, stage.category].some((text) =>
        String(text || '').toLowerCase().includes(term)
      )
    );
  }, [search, stageLibrary, visibleProfiles]);

  const groupedStages = useMemo(() => {
    return filteredStages.reduce((acc, stage) => {
      const category = stage.category || 'Other';
      if (!acc[category]) acc[category] = [];
      acc[category].push(stage);
      return acc;
    }, {});
  }, [filteredStages]);

  const visibleTemplateRecords = useMemo(() => {
    return effectiveTemplateRecords.filter((template) => {
      const profiles = template.profiles || ['advanced'];
      return profiles.some((profile) => visibleProfiles.has(profile));
    });
  }, [effectiveTemplateRecords, visibleProfiles]);

  const flowRows = useMemo(() => {
    const query = flowQuery.trim().toLowerCase();
    const rows = visibleTemplateRecords
      .map((template) => {
        const config = templateConfigs[template.id] || defaultTemplateConfig(template);
        return {
          ...template,
          config,
          isPredefined: predefinedFlowIds.has(template.id),
        };
      })
      .filter((row) => {
        if (flowTypeFilter === 'predefined' && !row.isPredefined) return false;
        if (flowTypeFilter === 'custom' && row.isPredefined) return false;
        if (flowStateFilter === 'enabled' && !row.config.enabled) return false;
        if (flowStateFilter === 'disabled' && row.config.enabled) return false;
        if (!query) return true;
        const hay = [row.name, row.description, row.id, row.category].map((v) => String(v || '').toLowerCase()).join(' ');
        return hay.includes(query);
      });

    rows.sort((a, b) => {
      if (flowSort === 'last_run_desc') {
        return (b.config.lastRunAt || 0) - (a.config.lastRunAt || 0);
      }
      if (flowSort === 'last_run_asc') {
        return (a.config.lastRunAt || 0) - (b.config.lastRunAt || 0);
      }
      if (flowSort === 'name_desc') {
        return String(b.name || '').localeCompare(String(a.name || ''));
      }
      return String(a.name || '').localeCompare(String(b.name || ''));
    });

    return rows;
  }, [
    visibleTemplateRecords,
    templateConfigs,
    predefinedFlowIds,
    flowTypeFilter,
    flowStateFilter,
    flowQuery,
    flowSort,
  ]);

  const updateTemplateConfig = useCallback(async (templateId, patch) => {
    setTemplateConfigs((prev) => {
      const current = prev[templateId] || defaultTemplateConfig(templateLibrary.find((item) => item.id === templateId));
      return {
        ...prev,
        [templateId]: {
          ...current,
          ...patch,
        },
      };
    });

    try {
      const response = await saveTemplateConfig({
        id: templateId,
        enabled: patch.enabled,
        autoRun: patch.autoRun,
        schedule: patch.schedule,
        device: patch.device,
      });
      if (response?.error) {
        setRunError(response.error);
      }
      await refreshTemplateConfigs();
    } catch (error) {
      setRunError(error?.message || 'Failed to update template config');
      await refreshTemplateConfigs();
    }
  }, [refreshTemplateConfigs]);

  const runTemplateNow = useCallback(async (template, source = 'template') => {
    setRunLoading(true);
    setRunError('');
    try {
      const response = await runTemplateById(template.id);
      if (response?.error) {
        setRunStatus('failed');
        setRunError(response.error);
        return { executed: false };
      }

      const result = response?.result || {};
      setInstanceId(result.instance_id || '');
      setRunStatus(result.status || 'unknown');
      setRunEvents(result.events || []);
      setPendingItems(result.pending || []);
      setAutoRunMessage(source === 'template' ? '' : `Scheduled run completed: ${template.name}`);
      await refreshTemplateConfigs();
      await refreshExecutions();
      if (source === 'table') {
        setActiveView('executions');
      }
      return { executed: true, result };
    } catch (error) {
      setRunError(error?.message || 'Template run failed');
      return { executed: false };
    } finally {
      setRunLoading(false);
    }
  }, [refreshTemplateConfigs, refreshExecutions]);

  const validationSummary = useMemo(() => {
    const errors = validationIssues.filter((item) => item.severity === 'error').length;
    const warnings = validationIssues.filter((item) => item.severity === 'warning').length;
    return { errors, warnings };
  }, [validationIssues]);

  const executionStatusSummary = useMemo(() => {
    const summary = { completed: 0, waiting: 0, failed: 0, total: executionRows.length };
    executionRows.forEach((row) => {
      if (row.status === 'completed') summary.completed += 1;
      else if (row.status === 'waiting') summary.waiting += 1;
      else summary.failed += 1;
    });
    return summary;
  }, [executionRows]);

  const selectedFlowRow = useMemo(
    () => flowRows.find((row) => row.id === selectedFlowId) || null,
    [flowRows, selectedFlowId]
  );

  return (
    <div className="app-shell">
      <AppHeader
        activeView={activeView}
        setActiveView={setActiveView}
        profileMode={profileMode}
        setProfileMode={setProfileMode}
        onRefreshExecutions={refreshExecutions}
        onCreateFlow={createNewFlow}
        onCopyFlow={copySelectedFlow}
        hasSelectedFlow={Boolean(selectedFlowRow)}
        onExportFlows={handleExportTemplates}
        onBackToFlows={() => setActiveView('flows')}
        onSaveFlow={saveDesignerFlow}
        canSaveFlow={Boolean(designerFlowId)}
        saveIsCopy={designerFlowIsPredefined}
        onExportWorkflow={handleExport}
        onRunWorkflow={runWorkflow}
        runLoading={runLoading}
        onOpenSecrets={openSecrets}
        workflowFileInputRef={workflowFileInputRef}
        templateFileInputRef={templateFileInputRef}
        onImportWorkflow={handleImportWorkflow}
        onImportTemplates={handleImportTemplates}
      />

      {runError && activeView !== 'designer' && (
        <section className="run-panel inline-error-panel">
          <div className="run-log error">{runError}</div>
        </section>
      )}

      {activeView === 'executions' && (
        <ExecutionsView
          executionStatusSummary={executionStatusSummary}
          executionRows={executionRows}
          formatDateTime={formatDateTime}
        />
      )}

      {activeView === 'flows' && (
        <FlowsView
          flowQuery={flowQuery}
          setFlowQuery={setFlowQuery}
          flowTypeFilter={flowTypeFilter}
          setFlowTypeFilter={setFlowTypeFilter}
          flowStateFilter={flowStateFilter}
          setFlowStateFilter={setFlowStateFilter}
          flowSort={flowSort}
          setFlowSort={setFlowSort}
          flowRows={flowRows}
          selectedFlowId={selectedFlowId}
          setSelectedFlowId={setSelectedFlowId}
          rowMenuFlowId={rowMenuFlowId}
          setRowMenuFlowId={setRowMenuFlowId}
          openFlowInDesigner={openFlowInDesigner}
          runTemplateNow={runTemplateNow}
          updateTemplateConfig={updateTemplateConfig}
          copyFlow={copyFlow}
          exportSingleFlow={exportSingleFlow}
          formatDateTime={formatDateTime}
        />
      )}

      {activeView === 'designer' && (
        <DesignerView
          search={search}
          setSearch={setSearch}
          groupedStages={groupedStages}
          addStage={addStage}
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChangeTracked}
          onEdgesChange={onEdgesChangeTracked}
          onConnect={onConnect}
          onAutoLayout={autoLayoutCanvas}
          onAlign={alignToGrid}
          onZoomReset={resetZoom}
          onUndo={undoGraph}
          onRedo={redoGraph}
          canUndo={canUndo}
          canRedo={canRedo}
          handleSelectionChange={handleSelectionChange}
          isValidConnection={isValidConnection}
          workflowMeta={designerFlowMeta}
          onWorkflowMetaChange={updateDesignerMeta}
          selectedNode={selectedNode}
          updateSelectedNodeProperties={updateSelectedNodeProperties}
          updateSelectedNodePorts={updateSelectedNodePorts}
          removePort={removePort}
          runValidateOnly={runValidateOnly}
          runWorkflow={runWorkflow}
          runLoading={runLoading}
          runStatus={runStatus}
          instanceId={instanceId}
          autoRunMessage={autoRunMessage}
          runError={runError}
          validationSummary={validationSummary}
          validationIssues={validationIssues}
          runEvents={runEvents}
          pendingItems={pendingItems}
          decisionByNode={decisionByNode}
          setDecisionByNode={setDecisionByNode}
          resumePending={resumePending}
          registerDesignerApi={(api) => {
            designerApiRef.current = api;
          }}
        />
      )}

      <SecretsModal
        show={showSecrets}
        onClose={() => setShowSecrets(false)}
        secretsError={secretsError}
        secretNameInput={secretNameInput}
        setSecretNameInput={setSecretNameInput}
        secretValueInput={secretValueInput}
        setSecretValueInput={setSecretValueInput}
        onSaveSecret={saveSecret}
        secretNames={secretNames}
        onDeleteSecret={removeSecret}
        onRefreshSecrets={refreshSecrets}
      />
    </div>
  );
}
