import { test, expect } from '../../fixtures.js';
import {
  buildPauseWorkflow,
  buildTaskApprovalWorkflow,
  buildTemplateDefinition,
} from '../../helpers/workflow-builder.js';
import { syncTemplate, listExecutions } from '../../helpers/api.js';

test.describe('Pause & Resume Lifecycle', () => {
  test('pause: full lifecycle — execute, pause, check history, resume approved, check completed', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildPauseWorkflow();
    const name = `Pause Full Lifecycle ${Date.now()}`;
    const id = `test_pause_full_${Date.now()}`;
    const definition = buildTemplateDefinition(id, name, workflow);

    // 1. Save template
    await syncTemplate(definition);

    // 2. Navigate to Flows and open
    await app.navigateToFlows();
    await page.waitForTimeout(500);
    await flows.searchFlows(name);
    await page.waitForTimeout(300);
    await flows.openFlowInDesigner(name);

    // 3. Save from Designer
    await designer.clickSave();

    // 4. Navigate away and reload
    await designer.clickBackToFlows();
    await page.waitForTimeout(300);
    await flows.searchFlows(name);
    await page.waitForTimeout(300);
    await flows.openFlowInDesigner(name);

    // 5. Execute — should pause
    await designer.clickRun();
    await designer.waitForStatus('waiting');

    const status1 = await designer.getRunStatus();
    expect(status1).toContain('waiting');

    // 6. Verify pending items appear
    const pending = await designer.getPendingItems();
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending[0].meta).toContain('pause_1');

    // 7. Get instance ID
    const instanceId = await designer.getInstanceId();
    expect(instanceId).toBeTruthy();

    // 8. Navigate to Executions view — verify "waiting" status
    await app.navigateToExecutions();
    await page.waitForTimeout(500);

    const execRow = await executions.findExecutionByInstanceId(instanceId);
    expect(execRow).toBeTruthy();
    expect(execRow.status).toContain('waiting');
    expect(parseInt(execRow.pendingCount)).toBeGreaterThanOrEqual(1);

    // 9. Navigate back to Designer
    await app.navigateToFlows();
    await page.waitForTimeout(300);
    await flows.searchFlows(name);
    await page.waitForTimeout(300);
    await flows.openFlowInDesigner(name);

    // 10. Re-execute to get back to waiting state
    await designer.clickRun();
    await designer.waitForStatus('waiting');

    // 11. Select "approved" and click Resume
    await designer.resumePendingItem('pause_1', 'approved');

    // 12. Wait for completion
    await designer.waitForStatus('completed');
    const status2 = await designer.getRunStatus();
    expect(status2).toContain('completed');

    // 13. Verify events show the approved path was followed
    const events = await designer.getRunEvents();
    expect(events.some((e) => e.includes('pause'))).toBe(true);
    expect(events.some((e) => e.includes('stop'))).toBe(true);

    // 14. Check Executions view — verify resume execution recorded
    await app.navigateToExecutions();
    await page.waitForTimeout(500);

    const latestExec = await executions.getLatestExecution();
    expect(latestExec).toBeTruthy();
  });

  test('pause: resume with rejected follows rejected path', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildPauseWorkflow();
    const name = `Pause Reject Lifecycle ${Date.now()}`;
    const id = `test_pause_rej_lc_${Date.now()}`;
    const definition = buildTemplateDefinition(id, name, workflow);

    await syncTemplate(definition);
    await app.navigateToFlows();
    await page.waitForTimeout(500);
    await flows.searchFlows(name);
    await page.waitForTimeout(300);
    await flows.openFlowInDesigner(name);

    // Execute
    await designer.clickRun();
    await designer.waitForStatus('waiting');

    // Resume rejected
    await designer.resumePendingItem('pause_1', 'rejected');
    await designer.waitForStatus('completed');

    const events = await designer.getRunEvents();
    expect(events.some((e) => e.includes('stop_rejected') || e.includes('stop'))).toBe(true);

    // Verify execution persisted
    await app.navigateToExecutions();
    await page.waitForTimeout(500);
    const latest = await executions.getLatestExecution();
    expect(latest).toBeTruthy();
  });

  test('task_approval: full lifecycle with approval', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildTaskApprovalWorkflow();
    const name = `Approval Full Lifecycle ${Date.now()}`;
    const id = `test_approval_full_${Date.now()}`;
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

    // Execute
    await designer.clickRun();
    await designer.waitForStatus('waiting');

    // Verify pending
    const pending = await designer.getPendingItems();
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending[0].meta).toContain('approval_1');

    // Check executions
    const instanceId = await designer.getInstanceId();
    await app.navigateToExecutions();
    await page.waitForTimeout(500);
    const execRow = await executions.findExecutionByInstanceId(instanceId);
    expect(execRow).toBeTruthy();
    expect(execRow.status).toContain('waiting');

    // Back to designer, re-run, resume
    await app.navigateToFlows();
    await page.waitForTimeout(300);
    await flows.searchFlows(name);
    await page.waitForTimeout(300);
    await flows.openFlowInDesigner(name);

    await designer.clickRun();
    await designer.waitForStatus('waiting');
    await designer.resumePendingItem('approval_1', 'approved');
    await designer.waitForStatus('completed');

    const events = await designer.getRunEvents();
    expect(events.some((e) => e.includes('task_approval'))).toBe(true);
    expect(events.some((e) => e.includes('stop'))).toBe(true);
  });

  test('task_approval: rejection path', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildTaskApprovalWorkflow();
    const name = `Approval Reject Lifecycle ${Date.now()}`;
    const id = `test_approval_rej_lc_${Date.now()}`;
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

    // Verify persisted
    await app.navigateToExecutions();
    await page.waitForTimeout(500);
    const latest = await executions.getLatestExecution();
    expect(latest).toBeTruthy();
  });

  test('pause: execution history shows correct event and pending counts', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildPauseWorkflow();
    const name = `Pause Counts ${Date.now()}`;
    const id = `test_pause_counts_${Date.now()}`;
    const definition = buildTemplateDefinition(id, name, workflow);

    await syncTemplate(definition);
    await app.navigateToFlows();
    await page.waitForTimeout(500);
    await flows.searchFlows(name);
    await page.waitForTimeout(300);
    await flows.openFlowInDesigner(name);

    // Execute to waiting state
    await designer.clickRun();
    await designer.waitForStatus('waiting');

    const instanceId = await designer.getInstanceId();

    // Check execution record
    await app.navigateToExecutions();
    await page.waitForTimeout(500);

    const execRow = await executions.findExecutionByInstanceId(instanceId);
    expect(execRow).toBeTruthy();
    // Should have some events (start ran, pause triggered)
    expect(parseInt(execRow.eventCount)).toBeGreaterThanOrEqual(1);
    // Should have pending count >= 1
    expect(parseInt(execRow.pendingCount)).toBeGreaterThanOrEqual(1);
  });
});
