import React, { useMemo, useCallback, useRef, useState, useEffect } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
} from 'reactflow';
import 'reactflow/dist/style.css';
import stageLibraryData from './stages/stageLibrary.json';
import templateLibraryData from './templates/workflowTemplates.json';
import StageNode from './components/StageNode.jsx';
import Inspector from './components/Inspector.jsx';
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

const nodeTypes = { stage: StageNode };

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
  return {
    version: 1,
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      stageId: node.data.stageId,
      label: node.data.label,
      properties: node.data.properties,
      ports: node.data.ports,
    })),
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
  const nextNodes = (workflow?.nodes || []).map((node) => {
    const stage = stageById[node.stageId] || {
      id: node.stageId,
      label: node.label || 'Unknown Stage',
      ports: { inputs: [], outputs: [] },
      propertiesSchema: { type: 'object', properties: {} },
      riskLevel: 'high',
    };

    return {
      id: node.id,
      type: 'stage',
      position: node.position || { x: 0, y: 0 },
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
        label: 'Start',
        properties: {},
        ports: { inputs: [], outputs: [{ id: 'out' }] },
      },
      {
        id: 'stop_1',
        stageId: 'stop',
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
  const [designerFlowName, setDesignerFlowName] = useState('');
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
  const workflowFileInputRef = useRef(null);
  const templateFileInputRef = useRef(null);

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

  const addStage = useCallback(
    (stage) => {
      const position = { x: 120 + Math.random() * 260, y: 120 + Math.random() * 260 };
      setNodes((nds) => nds.concat(buildNodeFromStage(stage, position)));
    },
    [setNodes]
  );

  const onConnect = useCallback(
    (connection) => {
      setEdges((eds) => addEdge({ ...connection, type: 'smoothstep' }, eds));
    },
    [setEdges]
  );

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
      setNodes((nds) =>
        nds.map((node) =>
          node.id === selectedNodeId
            ? { ...node, data: { ...node.data, properties: nextProperties } }
            : node
        )
      );
    },
    [selectedNodeId, setNodes]
  );

  const updateSelectedNodePorts = useCallback(
    (nextPorts) => {
      if (!selectedNodeId) return;
      setNodes((nds) =>
        nds.map((node) =>
          node.id === selectedNodeId
            ? { ...node, data: { ...node.data, ports: nextPorts } }
            : node
        )
      );
    },
    [selectedNodeId, setNodes]
  );

  const removePort = useCallback(
    (kind, portId) => {
      if (!selectedNodeId) return;
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
    [selectedNodeId, setNodes, setEdges]
  );

  const handleExport = () => {
    const payload = serializeGraph(nodes, edges);
    downloadJsonFile('workflow.json', payload);
  };

  const loadWorkflowToCanvas = useCallback((workflow) => {
    const materialized = materializeWorkflow(workflow, stageById);
    setNodes(materialized.nodes);
    setEdges(materialized.edges);
    setRunStatus('idle');
    setRunEvents([]);
    setPendingItems([]);
    setInstanceId('');
    setRunError('');
    setValidationIssues([]);
  }, [stageById, setNodes, setEdges]);

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
    const workflow = serializeGraph(nodes, edges);
    await runWorkflowGraph(workflow, 'canvas');
  }, [nodes, edges, runWorkflowGraph]);

  const runValidateOnly = useCallback(async () => {
    const workflow = serializeGraph(nodes, edges);
    setRunError('');
    await validateCurrentWorkflow(workflow);
  }, [nodes, edges, validateCurrentWorkflow]);

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
    setDesignerFlowName(flow.name || flow.id);
    setDesignerFlowIsPredefined(isPredefined);
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

  const exportSingleFlow = useCallback((flow) => {
    if (!flow) return;
    downloadJsonFile(`${slugify(flow.name || flow.id)}.json`, {
      version: 1,
      templates: [flow],
    });
  }, []);

  const saveDesignerFlow = useCallback(async () => {
    const workflow = serializeGraph(nodes, edges);
    const source = flowMapById[designerFlowId];
    if (!source) {
      setRunError('No active flow selected in designer.');
      return;
    }

    try {
      if (designerFlowIsPredefined) {
        await copyFlow({
          ...source,
          workflow,
        });
        return;
      }

      const definition = {
        id: source.id,
        name: source.name,
        category: source.category || 'User Flows',
        description: source.description || 'User-defined flow',
        profiles: Array.isArray(source.profiles) && source.profiles.length > 0 ? source.profiles : DEFAULT_CUSTOM_PROFILES,
        riskLevel: source.riskLevel || 'low',
        defaultDevice: source.defaultDevice || 'local',
        recommendedSchedule: source.recommendedSchedule || 'manual',
        workflow,
      };
      await upsertFlow(definition);
      setDesignerFlowName(definition.name);
    } catch (error) {
      setRunError(error?.message || 'Failed to save flow');
    }
  }, [nodes, edges, flowMapById, designerFlowId, designerFlowIsPredefined, copyFlow, upsertFlow]);

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
          {activeView === 'designer' && (
            <button className="menu-item active">Designer</button>
          )}
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
          {activeView === 'executions' && <button className="btn ghost" onClick={refreshExecutions}>Refresh</button>}
          {activeView === 'flows' && <button className="btn primary" onClick={createNewFlow}>New Flow</button>}
          {activeView === 'flows' && (
            <button className="btn ghost" onClick={copySelectedFlow} disabled={!selectedFlowRow}>
              Copy Flow
            </button>
          )}
          {activeView === 'flows' && <button className="btn ghost" onClick={() => templateFileInputRef.current?.click()}>Import Flows</button>}
          {activeView === 'flows' && <button className="btn ghost" onClick={handleExportTemplates}>Export Flows</button>}
          {activeView === 'designer' && <button className="btn ghost" onClick={() => setActiveView('flows')}>Back to Flows</button>}
          {activeView === 'designer' && (
            <button className="btn ghost" onClick={saveDesignerFlow} disabled={!designerFlowId}>
              {designerFlowIsPredefined ? 'Save As Copy' : 'Save Flow'}
            </button>
          )}
          {activeView === 'designer' && <button className="btn ghost" onClick={() => workflowFileInputRef.current?.click()}>Import</button>}
          {activeView === 'designer' && <button className="btn ghost" onClick={handleExport}>Save</button>}
          {activeView === 'designer' && <button className="btn primary" onClick={runWorkflow} disabled={runLoading}>Run</button>}
          <button className="btn ghost" onClick={openSecrets}>Secrets</button>
        </div>
        <input
          ref={workflowFileInputRef}
          type="file"
          accept="application/json"
          hidden
          onChange={handleImportWorkflow}
        />
        <input
          ref={templateFileInputRef}
          type="file"
          accept="application/json"
          hidden
          onChange={handleImportTemplates}
        />
      </header>

      {activeView === 'executions' && (
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
      )}

      {activeView === 'flows' && (
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
      )}

      {activeView === 'designer' && (
        <>
          <div className="designer">
            <aside className="panel palette">
              <div className="panel-title">Palette</div>
              <input
                className="search"
                placeholder="Search stages"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {Object.entries(groupedStages).map(([category, stages]) => (
                <div key={category}>
                  <div className="section-label">{category}</div>
                  <div className="palette-grid">
                    {stages.map((stage) => (
                      <button
                        key={stage.id}
                        type="button"
                        className="stage-card"
                        onClick={() => addStage(stage)}
                      >
                        <div className="stage-icon">{stage.icon || 'ST'}</div>
                        <div>
                          <div className="stage-title">{stage.label}</div>
                          <div className="stage-subtitle">{stage.description}</div>
                          <div className={`risk-pill risk-${stage.riskLevel || 'medium'}`}>
                            risk: {stage.riskLevel || 'medium'}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </aside>

            <main className="panel canvas">
              <div className="canvas-toolbar">
                <button className="btn ghost" onClick={runValidateOnly}>Validate</button>
                <button className="btn ghost">Auto-Layout</button>
                <button className="btn ghost">Align</button>
                <button className="btn ghost">Zoom 100%</button>
                <div className="spacer" />
                <button className="btn ghost">Undo</button>
                <button className="btn ghost">Redo</button>
              </div>

              <div className="canvas-grid">
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  onSelectionChange={handleSelectionChange}
                  isValidConnection={isValidConnection}
                  fitView
                >
                  <Background gap={24} color="#d6e3e6" />
                  <Controls />
                  <MiniMap pannable zoomable />
                </ReactFlow>
              </div>
            </main>

            <aside className="panel inspector">
              <div className="panel-title">Inspector</div>
              <Inspector
                node={selectedNode}
                onUpdateProperties={updateSelectedNodeProperties}
                onUpdatePorts={updateSelectedNodePorts}
                onRemovePort={removePort}
              />
            </aside>
          </div>

          <section className="run-panel">
            <div className="run-header">
              <div>
                <div className="run-title">Run Panel</div>
                <div className="run-subtitle">status: {runStatus}{instanceId ? ` | instance: ${instanceId}` : ''}</div>
              </div>
              <div className="run-actions">
                <button className="btn ghost" onClick={runValidateOnly}>Validate</button>
                <button className="btn primary" onClick={runWorkflow} disabled={runLoading}>Run</button>
              </div>
            </div>

            {autoRunMessage && <div className="run-log ok">{autoRunMessage}</div>}
            {runError && <div className="run-log error">{runError}</div>}

            <div className="pending-panel">
              <div className="panel-title">Validation</div>
              <div className="run-subtitle">errors: {validationSummary.errors} | warnings: {validationSummary.warnings}</div>
              {validationIssues.length === 0 && <div className="run-log ok">No validation issues.</div>}
              {validationIssues.map((issue, idx) => (
                <div key={`v-${idx}`} className={`run-log ${issue.severity === 'error' ? 'error' : 'warn'}`}>
                  [{issue.severity}] {issue.message}{issue.nodeId ? ` (node: ${issue.nodeId})` : ''}
                </div>
              ))}
            </div>

            <div className="run-body">
              {runEvents.length === 0 && <div className="run-log">No run events yet.</div>}
              {runEvents.map((event, idx) => (
                <div key={`${event.node_id}-${idx}`} className={`run-log ${event.status === 'ok' || event.status === 'resumed' ? 'ok' : ''}`}>
                  {event.stage_id} ({event.node_id}) {'->'} {event.status}{event.detail ? `: ${event.detail}` : ''}
                </div>
              ))}
            </div>

            <div className="pending-panel">
              <div className="panel-title">Approvals and Triggers Inbox</div>
              {pendingItems.length === 0 && <div className="run-log">No pending approvals or triggers.</div>}
              {pendingItems.map((item) => (
                <div key={item.node_id} className="pending-item">
                  <div className="pending-meta">
                    <strong>{item.stage_id}</strong> ({item.node_id})
                    <span className="pending-action">action: {item.action}</span>
                  </div>
                  {(item.action === 'approval' || item.action === 'pause') && (
                    <select
                      className="input small"
                      value={decisionByNode[item.node_id] || 'approved'}
                      onChange={(event) =>
                        setDecisionByNode((prev) => ({ ...prev, [item.node_id]: event.target.value }))
                      }
                    >
                      <option value="approved">approved</option>
                      <option value="rejected">rejected</option>
                      <option value="timeout">timeout</option>
                    </select>
                  )}
                  <button className="btn ghost" onClick={() => resumePending(item)} disabled={runLoading || !instanceId}>
                    Resume
                  </button>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {showSecrets && (
        <div className="modal-backdrop" onClick={() => setShowSecrets(false)}>
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
              <button className="btn primary" onClick={saveSecret}>Save Secret</button>
            </div>
            <div className="secret-list">
              {secretNames.length === 0 && <div className="run-log">No secrets saved.</div>}
              {secretNames.map((name) => (
                <div key={name} className="pending-item">
                  <span>{name}</span>
                  <button className="btn ghost" onClick={() => removeSecret(name)}>Delete</button>
                </div>
              ))}
            </div>
            <div className="run-actions">
              <button className="btn ghost" onClick={refreshSecrets}>Refresh</button>
              <button className="btn ghost" onClick={() => setShowSecrets(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
