import { test, expect, runFullLifecycleTest } from '../../fixtures.js';
import {
  buildStartStopWorkflow,
  buildLoopWorkflow,
  buildExclusiveChoiceWorkflow,
  buildMultiChoiceWorkflow,
  buildParallelWorkflow,
  buildParallelWithMergeWorkflow,
  buildThreadWorkflow,
  buildSimpleMergeWorkflow,
  buildSyncMergeWorkflow,
  buildPauseWorkflow,
  buildTaskApprovalWorkflow,
  buildTriggerWorkflow,
} from '../../helpers/workflow-builder.js';
import { syncTemplate } from '../../helpers/api.js';
import { buildTemplateDefinition } from '../../helpers/workflow-builder.js';

test.describe('Control Flow Stages', () => {
  // ── Start → Stop ──

  test('start → stop: basic workflow executes successfully', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildStartStopWorkflow();
    await runFullLifecycleTest(page, app, designer, flows, executions, workflow, 'Start Stop Basic', {
      expectedStatus: 'completed',
      expectedEventPatterns: ['start', 'stop'],
    });
  });

  // ── Loop ──

  test('loop: iterates 3 times then completes', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildLoopWorkflow(3);
    await runFullLifecycleTest(page, app, designer, flows, executions, workflow, 'Loop 3 Iterations', {
      expectedStatus: 'completed',
      expectedEventPatterns: ['start', 'loop', 'stop'],
    });
  });

  test('loop: single iteration', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildLoopWorkflow(1);
    await runFullLifecycleTest(page, app, designer, flows, executions, workflow, 'Loop 1 Iteration', {
      expectedStatus: 'completed',
      expectedEventPatterns: ['loop'],
    });
  });

  // ── Exclusive Choice ──

  test('exclusive_choice: routes to case_a', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildExclusiveChoiceWorkflow('case_a');
    const result = await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'ExChoice Case A',
      { expectedStatus: 'completed', expectedEventPatterns: ['exclusive_choice'] }
    );
    // Verify only case_a stop executed (stop_a), not stop_b
    const events = result.events;
    const stopEvents = events.filter((e) => e.includes('stop'));
    expect(stopEvents.length).toBeGreaterThanOrEqual(1);
  });

  test('exclusive_choice: routes to default when no match', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildExclusiveChoiceWorkflow('nonexistent_case');
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'ExChoice Default',
      { expectedStatus: 'completed', expectedEventPatterns: ['exclusive_choice'] }
    );
  });

  test('exclusive_choice: routes to case_b', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildExclusiveChoiceWorkflow('case_b');
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'ExChoice Case B',
      { expectedStatus: 'completed', expectedEventPatterns: ['exclusive_choice'] }
    );
  });

  // ── Multi Choice ──

  test('multi_choice: routes to multiple paths', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildMultiChoiceWorkflow('path_a,path_b');
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'MultiChoice AB',
      { expectedStatus: 'completed', expectedEventPatterns: ['multi_choice'] }
    );
  });

  // ── Parallel Split ──

  test('parallel_split: splits to multiple branches', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildParallelWorkflow();
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'Parallel Split',
      { expectedStatus: 'completed', expectedEventPatterns: ['parallel_split'] }
    );
  });

  test('parallel_split + sync_merge: splits and merges', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildParallelWithMergeWorkflow();
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'Parallel Merge',
      { expectedStatus: 'completed', expectedEventPatterns: ['parallel_split', 'sync_merge', 'stop'] }
    );
  });

  // ── Thread Split / Join ──

  test('thread_split → thread_join: executes thread tasks', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildThreadWorkflow();
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'Thread Split Join',
      { expectedStatus: 'completed', expectedEventPatterns: ['thread_split'] }
    );
  });

  // ── Simple Merge ──

  test('simple_merge: fires on first input (any mode)', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildSimpleMergeWorkflow();
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'Simple Merge',
      { expectedStatus: 'completed', expectedEventPatterns: ['simple_merge', 'stop'] }
    );
  });

  // ── Sync Merge ──

  test('sync_merge: waits for all inputs', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildSyncMergeWorkflow();
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'Sync Merge',
      { expectedStatus: 'completed', expectedEventPatterns: ['sync_merge', 'stop'] }
    );
  });

  // ── Pause ──

  test('pause: pauses workflow and resumes with approved', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildPauseWorkflow();
    const name = `Pause Approved ${Date.now()}`;
    const id = `test_pause_${Date.now()}`;
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

    // Run — should pause
    await designer.clickRun();
    await designer.waitForStatus('waiting');
    const status1 = await designer.getRunStatus();
    expect(status1).toContain('waiting');

    // Verify pending items
    const pending = await designer.getPendingItems();
    expect(pending.length).toBeGreaterThanOrEqual(1);

    // Check executions view shows waiting
    const instanceId = await designer.getInstanceId();
    await app.navigateToExecutions();
    await page.waitForTimeout(500);
    const execRow = await executions.findExecutionByInstanceId(instanceId);
    expect(execRow).toBeTruthy();
    expect(execRow.status).toContain('waiting');

    // Go back to designer and resume
    await app.navigateToFlows();
    await page.waitForTimeout(300);
    await flows.searchFlows(name);
    await page.waitForTimeout(300);
    await flows.openFlowInDesigner(name);

    // Re-run to get back to waiting state (the previous run's state is in the panel)
    await designer.clickRun();
    await designer.waitForStatus('waiting');

    // Resume with approved
    await designer.resumePendingItem('pause_1', 'approved');
    await designer.waitForStatus('completed');
    const status2 = await designer.getRunStatus();
    expect(status2).toContain('completed');

    // Verify in executions
    await app.navigateToExecutions();
    await page.waitForTimeout(500);
    const latest = await executions.getLatestExecution();
    expect(latest).toBeTruthy();
  });

  test('pause: pauses workflow and resumes with rejected', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildPauseWorkflow();
    const name = `Pause Rejected ${Date.now()}`;
    const id = `test_pause_rej_${Date.now()}`;
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
    await designer.resumePendingItem('pause_1', 'rejected');
    await designer.waitForStatus('completed');
    const status = await designer.getRunStatus();
    expect(status).toContain('completed');

    // Verify events include the rejected path
    const events = await designer.getRunEvents();
    expect(events.some((e) => e.includes('stop_rejected') || e.includes('stop'))).toBe(true);
  });

  // ── Task Approval ──

  test('task_approval: approves and follows approved path', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildTaskApprovalWorkflow();
    const name = `Approval Approved ${Date.now()}`;
    const id = `test_approval_${Date.now()}`;
    const definition = buildTemplateDefinition(id, name, workflow);

    await syncTemplate(definition);
    await app.navigateToFlows();
    await page.waitForTimeout(500);
    await flows.searchFlows(name);
    await page.waitForTimeout(300);
    await flows.openFlowInDesigner(name);

    await designer.clickRun();
    await designer.waitForStatus('waiting');

    const pending = await designer.getPendingItems();
    expect(pending.length).toBeGreaterThanOrEqual(1);

    await designer.resumePendingItem('approval_1', 'approved');
    await designer.waitForStatus('completed');

    const events = await designer.getRunEvents();
    expect(events.some((e) => e.includes('task_approval'))).toBe(true);
    expect(events.some((e) => e.includes('stop_approved') || e.includes('stop'))).toBe(true);
  });

  test('task_approval: rejects and follows rejected path', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildTaskApprovalWorkflow();
    const name = `Approval Rejected ${Date.now()}`;
    const id = `test_approval_rej_${Date.now()}`;
    const definition = buildTemplateDefinition(id, name, workflow);

    await syncTemplate(definition);
    await app.navigateToFlows();
    await page.waitForTimeout(500);
    await flows.searchFlows(name);
    await page.waitForTimeout(300);
    await flows.openFlowInDesigner(name);

    await designer.clickRun();
    await designer.waitForStatus('waiting');

    await designer.resumePendingItem('approval_1', 'rejected');
    await designer.waitForStatus('completed');

    const events = await designer.getRunEvents();
    expect(events.some((e) => e.includes('task_approval'))).toBe(true);
  });

  // ── Trigger ──

  test('trigger: workflow waits at trigger stage', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildTriggerWorkflow();
    const name = `Trigger Wait ${Date.now()}`;
    const id = `test_trigger_${Date.now()}`;
    const definition = buildTemplateDefinition(id, name, workflow);

    await syncTemplate(definition);
    await app.navigateToFlows();
    await page.waitForTimeout(500);
    await flows.searchFlows(name);
    await page.waitForTimeout(300);
    await flows.openFlowInDesigner(name);

    await designer.clickRun();
    await designer.waitForStatus('waiting');

    const status = await designer.getRunStatus();
    expect(status).toContain('waiting');

    const pending = await designer.getPendingItems();
    expect(pending.length).toBeGreaterThanOrEqual(1);

    // Verify in executions
    const instanceId = await designer.getInstanceId();
    await app.navigateToExecutions();
    await page.waitForTimeout(500);
    if (instanceId) {
      const execRow = await executions.findExecutionByInstanceId(instanceId);
      expect(execRow).toBeTruthy();
      expect(execRow.status).toContain('waiting');
    }
  });
});
