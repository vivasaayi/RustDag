let edgeCounter = 0;

export class WorkflowBuilder {
  constructor() {
    this.nodes = [];
    this.edges = [];
  }

  addNode(stageId, id, { x = 100, y = 100 } = {}, properties = {}, ports = null) {
    const defaultPorts = getDefaultPorts(stageId);
    this.nodes.push({
      id,
      type: 'stage',
      position: { x, y },
      stageId,
      label: stageId,
      properties,
      ports: ports || defaultPorts,
    });
    return this;
  }

  connect(sourceId, targetId, sourceHandle = 'out', targetHandle = 'in') {
    edgeCounter += 1;
    this.edges.push({
      id: `e_${edgeCounter}_${Date.now()}`,
      source: sourceId,
      target: targetId,
      sourceHandle,
      targetHandle,
    });
    return this;
  }

  build() {
    return {
      version: 1,
      nodes: this.nodes,
      edges: this.edges,
    };
  }
}

function getDefaultPorts(stageId) {
  const portDefs = {
    start: { inputs: [], outputs: [{ id: 'out', label: 'Out', dataType: 'control' }] },
    stop: { inputs: [{ id: 'in', label: 'In', dataType: 'control' }], outputs: [] },
    loop: {
      inputs: [{ id: 'in', label: 'In', dataType: 'control' }],
      outputs: [
        { id: 'next', label: 'Next', dataType: 'control' },
        { id: 'done', label: 'Done', dataType: 'control' },
      ],
    },
    parallel_split: {
      inputs: [{ id: 'in', label: 'In', dataType: 'control' }],
      outputs: [
        { id: 'branch_a', label: 'Branch A', dataType: 'control' },
        { id: 'branch_b', label: 'Branch B', dataType: 'control' },
        { id: 'branch_c', label: 'Branch C', dataType: 'control' },
      ],
    },
    exclusive_choice: {
      inputs: [{ id: 'in', label: 'In', dataType: 'control' }],
      outputs: [
        { id: 'case_a', label: 'Case A', dataType: 'control' },
        { id: 'case_b', label: 'Case B', dataType: 'control' },
        { id: 'default', label: 'Default', dataType: 'control' },
      ],
    },
    multi_choice: {
      inputs: [{ id: 'in', label: 'In', dataType: 'control' }],
      outputs: [
        { id: 'path_a', label: 'Path A', dataType: 'control' },
        { id: 'path_b', label: 'Path B', dataType: 'control' },
        { id: 'path_c', label: 'Path C', dataType: 'control' },
        { id: 'default', label: 'Default', dataType: 'control' },
      ],
    },
    thread_split: {
      inputs: [{ id: 'in', label: 'In', dataType: 'control' }],
      outputs: [
        { id: 'threads', label: 'Threads', dataType: 'control' },
        { id: 'error', label: 'Error', dataType: 'control' },
      ],
    },
    thread_join: {
      inputs: [{ id: 'in', label: 'In', dataType: 'control' }],
      outputs: [{ id: 'out', label: 'Out', dataType: 'control' }],
    },
    simple_merge: {
      inputs: [{ id: 'in', label: 'In', dataType: 'control' }],
      outputs: [{ id: 'out', label: 'Out', dataType: 'control' }],
    },
    sync_merge: {
      inputs: [{ id: 'in', label: 'In', dataType: 'control' }],
      outputs: [{ id: 'out', label: 'Out', dataType: 'control' }],
    },
    pause: {
      inputs: [{ id: 'in', label: 'In', dataType: 'control' }],
      outputs: [
        { id: 'approved', label: 'Approved', dataType: 'control' },
        { id: 'rejected', label: 'Rejected', dataType: 'control' },
      ],
    },
    task_approval: {
      inputs: [{ id: 'in', label: 'In', dataType: 'control' }],
      outputs: [
        { id: 'approved', label: 'Approved', dataType: 'control' },
        { id: 'rejected', label: 'Rejected', dataType: 'control' },
      ],
    },
    trigger: {
      inputs: [],
      outputs: [{ id: 'out', label: 'Out', dataType: 'control' }],
    },
    string_template: {
      inputs: [{ id: 'in', label: 'In', dataType: 'control' }],
      outputs: [{ id: 'out', label: 'Out', dataType: 'control' }],
    },
    llm_agent: {
      inputs: [{ id: 'in', label: 'In', dataType: 'control' }],
      outputs: [{ id: 'out', label: 'Out', dataType: 'control' }],
    },
    custom_llm_agent: {
      inputs: [{ id: 'in', label: 'In', dataType: 'control' }],
      outputs: [{ id: 'out', label: 'Out', dataType: 'control' }],
    },
    send_mail: {
      inputs: [{ id: 'in', label: 'In', dataType: 'control' }],
      outputs: [
        { id: 'success', label: 'Success', dataType: 'control' },
        { id: 'error', label: 'Error', dataType: 'control' },
      ],
    },
    notify_user: {
      inputs: [{ id: 'in', label: 'In', dataType: 'control' }],
      outputs: [
        { id: 'success', label: 'Success', dataType: 'control' },
        { id: 'error', label: 'Error', dataType: 'control' },
      ],
    },
    api_call: {
      inputs: [{ id: 'in', label: 'In', dataType: 'control' }],
      outputs: [
        { id: 'success', label: 'Success', dataType: 'control' },
        { id: 'error', label: 'Error', dataType: 'control' },
      ],
    },
    exec_process: {
      inputs: [{ id: 'in', label: 'In', dataType: 'control' }],
      outputs: [
        { id: 'success', label: 'Success', dataType: 'control' },
        { id: 'error', label: 'Error', dataType: 'control' },
      ],
    },
    mysql_query: {
      inputs: [{ id: 'in', label: 'In', dataType: 'control' }],
      outputs: [
        { id: 'success', label: 'Success', dataType: 'control' },
        { id: 'error', label: 'Error', dataType: 'control' },
      ],
    },
    postgres_query: {
      inputs: [{ id: 'in', label: 'In', dataType: 'control' }],
      outputs: [
        { id: 'success', label: 'Success', dataType: 'control' },
        { id: 'error', label: 'Error', dataType: 'control' },
      ],
    },
    mongo_query: {
      inputs: [{ id: 'in', label: 'In', dataType: 'control' }],
      outputs: [
        { id: 'success', label: 'Success', dataType: 'control' },
        { id: 'error', label: 'Error', dataType: 'control' },
      ],
    },
    aws_s3: {
      inputs: [{ id: 'in', label: 'In', dataType: 'control' }],
      outputs: [
        { id: 'success', label: 'Success', dataType: 'control' },
        { id: 'error', label: 'Error', dataType: 'control' },
      ],
    },
    aws_sqs: {
      inputs: [{ id: 'in', label: 'In', dataType: 'control' }],
      outputs: [
        { id: 'success', label: 'Success', dataType: 'control' },
        { id: 'error', label: 'Error', dataType: 'control' },
      ],
    },
    aws_kinesis: {
      inputs: [{ id: 'in', label: 'In', dataType: 'control' }],
      outputs: [
        { id: 'success', label: 'Success', dataType: 'control' },
        { id: 'error', label: 'Error', dataType: 'control' },
      ],
    },
    aws_cloudwatch: {
      inputs: [{ id: 'in', label: 'In', dataType: 'control' }],
      outputs: [
        { id: 'success', label: 'Success', dataType: 'control' },
        { id: 'error', label: 'Error', dataType: 'control' },
      ],
    },
    kubernetes: {
      inputs: [{ id: 'in', label: 'In', dataType: 'control' }],
      outputs: [
        { id: 'success', label: 'Success', dataType: 'control' },
        { id: 'error', label: 'Error', dataType: 'control' },
      ],
    },
    inline_script: {
      inputs: [{ id: 'in', label: 'In', dataType: 'control' }],
      outputs: [
        { id: 'success', label: 'Success', dataType: 'control' },
        { id: 'error', label: 'Error', dataType: 'control' },
      ],
    },
  };
  return portDefs[stageId] || {
    inputs: [{ id: 'in', label: 'In', dataType: 'control' }],
    outputs: [{ id: 'out', label: 'Out', dataType: 'control' }],
  };
}

// ── Pre-built workflow factories ──

export function buildStartStopWorkflow() {
  return new WorkflowBuilder()
    .addNode('start', 'start_1', { x: 120, y: 140 })
    .addNode('stop', 'stop_1', { x: 420, y: 140 })
    .connect('start_1', 'stop_1', 'out', 'in')
    .build();
}

export function buildLoopWorkflow(maxIterations = 3) {
  return new WorkflowBuilder()
    .addNode('start', 'start_1', { x: 100, y: 140 })
    .addNode('loop', 'loop_1', { x: 350, y: 140 }, { maxIterations, expression: '' })
    .addNode('stop', 'stop_1', { x: 600, y: 140 })
    .connect('start_1', 'loop_1', 'out', 'in')
    .connect('loop_1', 'loop_1', 'next', 'in')
    .connect('loop_1', 'stop_1', 'done', 'in')
    .build();
}

export function buildExclusiveChoiceWorkflow(expression = 'case_a') {
  return new WorkflowBuilder()
    .addNode('start', 'start_1', { x: 100, y: 200 })
    .addNode('exclusive_choice', 'choice_1', { x: 350, y: 200 }, { expression })
    .addNode('stop', 'stop_a', { x: 600, y: 100 })
    .addNode('stop', 'stop_b', { x: 600, y: 200 })
    .addNode('stop', 'stop_default', { x: 600, y: 300 })
    .connect('start_1', 'choice_1', 'out', 'in')
    .connect('choice_1', 'stop_a', 'case_a', 'in')
    .connect('choice_1', 'stop_b', 'case_b', 'in')
    .connect('choice_1', 'stop_default', 'default', 'in')
    .build();
}

export function buildMultiChoiceWorkflow(expressions = 'path_a,path_b') {
  return new WorkflowBuilder()
    .addNode('start', 'start_1', { x: 100, y: 200 })
    .addNode('multi_choice', 'multi_1', { x: 350, y: 200 }, { expressions })
    .addNode('stop', 'stop_a', { x: 600, y: 100 })
    .addNode('stop', 'stop_b', { x: 600, y: 200 })
    .addNode('stop', 'stop_c', { x: 600, y: 300 })
    .connect('start_1', 'multi_1', 'out', 'in')
    .connect('multi_1', 'stop_a', 'path_a', 'in')
    .connect('multi_1', 'stop_b', 'path_b', 'in')
    .connect('multi_1', 'stop_c', 'path_c', 'in')
    .build();
}

export function buildParallelWorkflow() {
  return new WorkflowBuilder()
    .addNode('start', 'start_1', { x: 100, y: 200 })
    .addNode('parallel_split', 'split_1', { x: 300, y: 200 })
    .addNode('stop', 'stop_a', { x: 550, y: 100 })
    .addNode('stop', 'stop_b', { x: 550, y: 200 })
    .addNode('stop', 'stop_c', { x: 550, y: 300 })
    .connect('start_1', 'split_1', 'out', 'in')
    .connect('split_1', 'stop_a', 'branch_a', 'in')
    .connect('split_1', 'stop_b', 'branch_b', 'in')
    .connect('split_1', 'stop_c', 'branch_c', 'in')
    .build();
}

export function buildParallelWithMergeWorkflow() {
  return new WorkflowBuilder()
    .addNode('start', 'start_1', { x: 100, y: 200 })
    .addNode('parallel_split', 'split_1', { x: 300, y: 200 })
    .addNode('string_template', 'tmpl_a', { x: 550, y: 100 }, { template: 'branch_a' })
    .addNode('string_template', 'tmpl_b', { x: 550, y: 300 }, { template: 'branch_b' })
    .addNode('sync_merge', 'merge_1', { x: 800, y: 200 })
    .addNode('stop', 'stop_1', { x: 1050, y: 200 })
    .connect('start_1', 'split_1', 'out', 'in')
    .connect('split_1', 'tmpl_a', 'branch_a', 'in')
    .connect('split_1', 'tmpl_b', 'branch_b', 'in')
    .connect('tmpl_a', 'merge_1', 'out', 'in')
    .connect('tmpl_b', 'merge_1', 'out', 'in')
    .connect('merge_1', 'stop_1', 'out', 'in')
    .build();
}

export function buildThreadWorkflow() {
  return new WorkflowBuilder()
    .addNode('start', 'start_1', { x: 100, y: 200 })
    .addNode('thread_split', 'tsplit_1', { x: 300, y: 200 })
    .addNode('string_template', 'tmpl_1', { x: 550, y: 200 }, { template: 'thread_task' })
    .addNode('thread_join', 'tjoin_1', { x: 800, y: 200 })
    .addNode('stop', 'stop_1', { x: 1050, y: 200 })
    .connect('start_1', 'tsplit_1', 'out', 'in')
    .connect('tsplit_1', 'tmpl_1', 'threads', 'in')
    .connect('tmpl_1', 'tjoin_1', 'out', 'in')
    .connect('tjoin_1', 'stop_1', 'out', 'in')
    .build();
}

export function buildSimpleMergeWorkflow() {
  return new WorkflowBuilder()
    .addNode('start', 'start_1', { x: 100, y: 100 })
    .addNode('start', 'start_2', { x: 100, y: 300 })
    .addNode('simple_merge', 'merge_1', { x: 400, y: 200 })
    .addNode('stop', 'stop_1', { x: 650, y: 200 })
    .connect('start_1', 'merge_1', 'out', 'in')
    .connect('start_2', 'merge_1', 'out', 'in')
    .connect('merge_1', 'stop_1', 'out', 'in')
    .build();
}

export function buildSyncMergeWorkflow() {
  return new WorkflowBuilder()
    .addNode('start', 'start_1', { x: 100, y: 100 })
    .addNode('start', 'start_2', { x: 100, y: 300 })
    .addNode('sync_merge', 'merge_1', { x: 400, y: 200 })
    .addNode('stop', 'stop_1', { x: 650, y: 200 })
    .connect('start_1', 'merge_1', 'out', 'in')
    .connect('start_2', 'merge_1', 'out', 'in')
    .connect('merge_1', 'stop_1', 'out', 'in')
    .build();
}

export function buildPauseWorkflow() {
  return new WorkflowBuilder()
    .addNode('start', 'start_1', { x: 100, y: 200 })
    .addNode('pause', 'pause_1', { x: 350, y: 200 })
    .addNode('stop', 'stop_approved', { x: 600, y: 100 })
    .addNode('stop', 'stop_rejected', { x: 600, y: 300 })
    .connect('start_1', 'pause_1', 'out', 'in')
    .connect('pause_1', 'stop_approved', 'approved', 'in')
    .connect('pause_1', 'stop_rejected', 'rejected', 'in')
    .build();
}

export function buildTaskApprovalWorkflow() {
  return new WorkflowBuilder()
    .addNode('start', 'start_1', { x: 100, y: 200 })
    .addNode('task_approval', 'approval_1', { x: 350, y: 200 })
    .addNode('stop', 'stop_approved', { x: 600, y: 100 })
    .addNode('stop', 'stop_rejected', { x: 600, y: 300 })
    .connect('start_1', 'approval_1', 'out', 'in')
    .connect('approval_1', 'stop_approved', 'approved', 'in')
    .connect('approval_1', 'stop_rejected', 'rejected', 'in')
    .build();
}

export function buildTriggerWorkflow() {
  return new WorkflowBuilder()
    .addNode('trigger', 'trigger_1', { x: 100, y: 200 })
    .addNode('stop', 'stop_1', { x: 400, y: 200 })
    .connect('trigger_1', 'stop_1', 'out', 'in')
    .build();
}

export function buildStringTemplateWorkflow(template = 'Hello {{name}}') {
  return new WorkflowBuilder()
    .addNode('start', 'start_1', { x: 100, y: 200 })
    .addNode('string_template', 'tmpl_1', { x: 350, y: 200 }, { template })
    .addNode('stop', 'stop_1', { x: 600, y: 200 })
    .connect('start_1', 'tmpl_1', 'out', 'in')
    .connect('tmpl_1', 'stop_1', 'out', 'in')
    .build();
}

export function buildSingleStageWorkflow(stageId, properties = {}) {
  return new WorkflowBuilder()
    .addNode('start', 'start_1', { x: 100, y: 200 })
    .addNode(stageId, 'stage_1', { x: 350, y: 200 }, properties)
    .addNode('stop', 'stop_1', { x: 600, y: 200 })
    .connect('start_1', 'stage_1', 'out', 'in')
    .connect('stage_1', 'stop_1', 'success', 'in')
    .build();
}

export function buildSingleControlStageWorkflow(stageId, properties = {}) {
  return new WorkflowBuilder()
    .addNode('start', 'start_1', { x: 100, y: 200 })
    .addNode(stageId, 'stage_1', { x: 350, y: 200 }, properties)
    .addNode('stop', 'stop_1', { x: 600, y: 200 })
    .connect('start_1', 'stage_1', 'out', 'in')
    .connect('stage_1', 'stop_1', 'out', 'in')
    .build();
}

// ── Complex multi-stage workflows ──

export function buildLinearPipelineWorkflow() {
  return new WorkflowBuilder()
    .addNode('start', 'start_1', { x: 100, y: 200 })
    .addNode('string_template', 'tmpl_1', { x: 300, y: 200 }, { template: 'Hello World' })
    .addNode('notify_user', 'notify_1', { x: 550, y: 200 }, { message: 'Pipeline complete', dryRun: true })
    .addNode('stop', 'stop_1', { x: 800, y: 200 })
    .connect('start_1', 'tmpl_1', 'out', 'in')
    .connect('tmpl_1', 'notify_1', 'out', 'in')
    .connect('notify_1', 'stop_1', 'success', 'in')
    .build();
}

export function buildBranchMergeWorkflow() {
  return new WorkflowBuilder()
    .addNode('start', 'start_1', { x: 100, y: 200 })
    .addNode('exclusive_choice', 'choice_1', { x: 300, y: 200 }, { expression: 'case_a' })
    .addNode('string_template', 'tmpl_a', { x: 550, y: 100 }, { template: 'Path A' })
    .addNode('string_template', 'tmpl_b', { x: 550, y: 300 }, { template: 'Path B' })
    .addNode('sync_merge', 'merge_1', { x: 800, y: 200 })
    .addNode('stop', 'stop_1', { x: 1050, y: 200 })
    .connect('start_1', 'choice_1', 'out', 'in')
    .connect('choice_1', 'tmpl_a', 'case_a', 'in')
    .connect('choice_1', 'tmpl_b', 'case_b', 'in')
    .connect('tmpl_a', 'merge_1', 'out', 'in')
    .connect('tmpl_b', 'merge_1', 'out', 'in')
    .connect('merge_1', 'stop_1', 'out', 'in')
    .build();
}

export function buildLoopWithSideEffectsWorkflow(maxIterations = 3) {
  return new WorkflowBuilder()
    .addNode('start', 'start_1', { x: 100, y: 200 })
    .addNode('loop', 'loop_1', { x: 300, y: 200 }, { maxIterations, expression: '' })
    .addNode('string_template', 'tmpl_1', { x: 550, y: 100 }, { template: 'Iteration {{iteration}}' })
    .addNode('stop', 'stop_1', { x: 550, y: 350 })
    .connect('start_1', 'loop_1', 'out', 'in')
    .connect('loop_1', 'tmpl_1', 'next', 'in')
    .connect('tmpl_1', 'loop_1', 'out', 'in')
    .connect('loop_1', 'stop_1', 'done', 'in')
    .build();
}

export function buildApprovalGateWorkflow() {
  return new WorkflowBuilder()
    .addNode('start', 'start_1', { x: 100, y: 200 })
    .addNode('task_approval', 'approval_1', { x: 350, y: 200 })
    .addNode('string_template', 'tmpl_approved', { x: 600, y: 100 }, { template: 'Approved action' })
    .addNode('string_template', 'tmpl_rejected', { x: 600, y: 300 }, { template: 'Rejected notice' })
    .addNode('stop', 'stop_approved', { x: 850, y: 100 })
    .addNode('stop', 'stop_rejected', { x: 850, y: 300 })
    .connect('start_1', 'approval_1', 'out', 'in')
    .connect('approval_1', 'tmpl_approved', 'approved', 'in')
    .connect('approval_1', 'tmpl_rejected', 'rejected', 'in')
    .connect('tmpl_approved', 'stop_approved', 'out', 'in')
    .connect('tmpl_rejected', 'stop_rejected', 'out', 'in')
    .build();
}

export function buildTemplateDefinition(id, name, workflow) {
  return {
    id,
    name,
    category: 'Test Flows',
    description: `Test workflow: ${name}`,
    classification: 'general',
    tags: ['test'],
    profiles: ['everyday', 'devices', 'robots', 'advanced'],
    riskLevel: 'low',
    defaultDevice: 'local',
    recommendedSchedule: 'manual',
    workflow,
  };
}
