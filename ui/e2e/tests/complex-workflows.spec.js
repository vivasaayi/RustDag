import { test, expect, runFullLifecycleTest } from '../fixtures.js';
import {
  buildLinearPipelineWorkflow,
  buildBranchMergeWorkflow,
  buildLoopWithSideEffectsWorkflow,
  buildParallelWithMergeWorkflow,
  buildApprovalGateWorkflow,
  WorkflowBuilder,
  buildTemplateDefinition,
} from '../helpers/workflow-builder.js';
import { syncTemplate } from '../helpers/api.js';

test.describe('Complex Multi-Stage Workflows', () => {
  // ── Linear Pipeline ──

  test('linear pipeline: start → string_template → notify_user → stop', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildLinearPipelineWorkflow();
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'Linear Pipeline',
      {
        expectedStatus: 'completed',
        expectedEventPatterns: ['start', 'string_template', 'notify_user', 'stop'],
      }
    );
  });

  // ── Branch + Merge ──

  test('branch + merge: exclusive_choice routes case_a through merge to stop', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildBranchMergeWorkflow();
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'Branch Merge',
      {
        expectedStatus: 'completed',
        expectedEventPatterns: ['start', 'exclusive_choice'],
      }
    );
  });

  // ── Loop with Side Effects ──

  test('loop with side effects: iterates and executes template each time', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildLoopWithSideEffectsWorkflow(3);
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'Loop Side Effects',
      {
        expectedStatus: 'completed',
        expectedEventPatterns: ['start', 'loop', 'string_template'],
      }
    );
  });

  test('loop with side effects: single iteration', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildLoopWithSideEffectsWorkflow(1);
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'Loop Side Effects 1',
      {
        expectedStatus: 'completed',
        expectedEventPatterns: ['loop'],
      }
    );
  });

  // ── Parallel Execution ──

  test('parallel execution: split to branches, process, merge, stop', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildParallelWithMergeWorkflow();
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'Parallel Execution',
      {
        expectedStatus: 'completed',
        expectedEventPatterns: ['start', 'parallel_split', 'sync_merge', 'stop'],
      }
    );
  });

  // ── Approval Gate ──

  test('approval gate: approved path executes template and stops', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildApprovalGateWorkflow();
    const name = `Approval Gate Approved ${Date.now()}`;
    const id = `test_ag_approved_${Date.now()}`;
    const definition = buildTemplateDefinition(id, name, workflow);

    await syncTemplate(definition);
    await app.navigateToFlows();
    await page.waitForTimeout(500);
    await flows.searchFlows(name);
    await page.waitForTimeout(300);
    await flows.openFlowInDesigner(name);

    // Save and reload
    await designer.clickSave();
    await designer.clickBackToFlows();
    await page.waitForTimeout(300);
    await flows.searchFlows(name);
    await page.waitForTimeout(300);
    await flows.openFlowInDesigner(name);

    // Run — will wait at approval
    await designer.clickRun();
    await designer.waitForStatus('waiting');

    // Resume with approved
    await designer.resumePendingItem('approval_1', 'approved');
    await designer.waitForStatus('completed');

    const events = await designer.getRunEvents();
    expect(events.some((e) => e.includes('task_approval'))).toBe(true);
    expect(events.some((e) => e.includes('tmpl_approved') || e.includes('string_template'))).toBe(true);
    expect(events.some((e) => e.includes('stop'))).toBe(true);

    // Verify execution persisted
    await app.navigateToExecutions();
    await page.waitForTimeout(500);
    const latest = await executions.getLatestExecution();
    expect(latest).toBeTruthy();
  });

  test('approval gate: rejected path executes different template', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildApprovalGateWorkflow();
    const name = `Approval Gate Rejected ${Date.now()}`;
    const id = `test_ag_rejected_${Date.now()}`;
    const definition = buildTemplateDefinition(id, name, workflow);

    await syncTemplate(definition);
    await app.navigateToFlows();
    await page.waitForTimeout(500);
    await flows.searchFlows(name);
    await page.waitForTimeout(300);
    await flows.openFlowInDesigner(name);

    await designer.clickRun();
    await designer.waitForStatus('waiting');

    // Resume with rejected
    await designer.resumePendingItem('approval_1', 'rejected');
    await designer.waitForStatus('completed');

    const events = await designer.getRunEvents();
    expect(events.some((e) => e.includes('task_approval'))).toBe(true);
    expect(events.some((e) => e.includes('stop'))).toBe(true);
  });

  // ── Diamond Pattern ──

  test('diamond: start → split → A + B → merge → stop', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = new WorkflowBuilder()
      .addNode('start', 'start_1', { x: 100, y: 200 })
      .addNode('parallel_split', 'split_1', { x: 300, y: 200 })
      .addNode('string_template', 'node_a', { x: 550, y: 100 }, { template: 'Branch A result' })
      .addNode('string_template', 'node_b', { x: 550, y: 300 }, { template: 'Branch B result' })
      .addNode('sync_merge', 'merge_1', { x: 800, y: 200 })
      .addNode('stop', 'stop_1', { x: 1050, y: 200 })
      .connect('start_1', 'split_1', 'out', 'in')
      .connect('split_1', 'node_a', 'branch_a', 'in')
      .connect('split_1', 'node_b', 'branch_b', 'in')
      .connect('node_a', 'merge_1', 'out', 'in')
      .connect('node_b', 'merge_1', 'out', 'in')
      .connect('merge_1', 'stop_1', 'out', 'in')
      .build();

    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'Diamond Pattern',
      {
        expectedStatus: 'completed',
        expectedEventPatterns: ['start', 'parallel_split', 'string_template', 'sync_merge', 'stop'],
      }
    );
  });

  // ── Long Chain ──

  test('long chain: 6 sequential stages', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = new WorkflowBuilder()
      .addNode('start', 'start_1', { x: 100, y: 200 })
      .addNode('string_template', 's1', { x: 250, y: 200 }, { template: 'Step 1' })
      .addNode('string_template', 's2', { x: 400, y: 200 }, { template: 'Step 2' })
      .addNode('string_template', 's3', { x: 550, y: 200 }, { template: 'Step 3' })
      .addNode('string_template', 's4', { x: 700, y: 200 }, { template: 'Step 4' })
      .addNode('stop', 'stop_1', { x: 850, y: 200 })
      .connect('start_1', 's1', 'out', 'in')
      .connect('s1', 's2', 'out', 'in')
      .connect('s2', 's3', 'out', 'in')
      .connect('s3', 's4', 'out', 'in')
      .connect('s4', 'stop_1', 'out', 'in')
      .build();

    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'Long Chain 6',
      {
        expectedStatus: 'completed',
        expectedEventPatterns: ['start', 'string_template', 'stop'],
        expectedEventCount: 6,
      }
    );
  });

  // ── Mixed Control + Data ──

  test('mixed: loop iterations with string_template processing', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildLoopWithSideEffectsWorkflow(2);
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'Mixed Loop Template',
      {
        expectedStatus: 'completed',
        expectedEventPatterns: ['loop', 'string_template', 'stop'],
      }
    );
  });
});
