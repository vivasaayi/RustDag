import { test, expect } from '../fixtures.js';
import {
  buildStartStopWorkflow,
  buildStringTemplateWorkflow,
  buildPauseWorkflow,
  buildTemplateDefinition,
} from '../helpers/workflow-builder.js';
import { syncTemplate, executeWorkflow, listExecutions } from '../helpers/api.js';

test.describe('Execution Persistence', () => {
  test('completed workflow appears in execution history with correct data', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildStartStopWorkflow();
    const name = `Persist Complete ${Date.now()}`;
    const id = `test_persist_${Date.now()}`;
    const definition = buildTemplateDefinition(id, name, workflow);

    await syncTemplate(definition);
    await app.navigateToFlows();
    await page.waitForTimeout(500);
    await flows.searchFlows(name);
    await page.waitForTimeout(300);
    await flows.openFlowInDesigner(name);

    // Run
    await designer.clickRun();
    await designer.waitForRunComplete();

    const instanceId = await designer.getInstanceId();

    // Navigate to Executions
    await app.navigateToExecutions();
    await page.waitForTimeout(500);

    // Find the execution
    const execRow = await executions.findExecutionByInstanceId(instanceId);
    expect(execRow).toBeTruthy();
    expect(execRow.status).toContain('completed');
    expect(parseInt(execRow.eventCount)).toBeGreaterThanOrEqual(2); // start + stop
    expect(parseInt(execRow.pendingCount)).toBe(0);
    expect(execRow.source).toBeTruthy();
    expect(execRow.time).toBeTruthy();
  });

  test('waiting workflow appears with correct pending count', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildPauseWorkflow();
    const name = `Persist Waiting ${Date.now()}`;
    const id = `test_persist_wait_${Date.now()}`;
    const definition = buildTemplateDefinition(id, name, workflow);

    await syncTemplate(definition);
    await app.navigateToFlows();
    await page.waitForTimeout(500);
    await flows.searchFlows(name);
    await page.waitForTimeout(300);
    await flows.openFlowInDesigner(name);

    // Run — will pause
    await designer.clickRun();
    await designer.waitForStatus('waiting');

    const instanceId = await designer.getInstanceId();

    // Navigate to Executions
    await app.navigateToExecutions();
    await page.waitForTimeout(500);

    const execRow = await executions.findExecutionByInstanceId(instanceId);
    expect(execRow).toBeTruthy();
    expect(execRow.status).toContain('waiting');
    expect(parseInt(execRow.pendingCount)).toBeGreaterThanOrEqual(1);
  });

  test('multiple executions appear in correct order (newest first)', async ({
    page, app, designer, flows, executions,
  }) => {
    // Run two workflows via API
    const workflow1 = buildStartStopWorkflow();
    const result1 = await executeWorkflow(workflow1);
    await page.waitForTimeout(200);

    const workflow2 = buildStringTemplateWorkflow('test template');
    const result2 = await executeWorkflow(workflow2);

    const id1 = result1?.result?.instance_id;
    const id2 = result2?.result?.instance_id;

    // Navigate to Executions
    await app.navigateToExecutions();
    await page.waitForTimeout(1000);

    // Refresh to get latest
    await executions.clickRefresh();

    const rows = await executions.getExecutionRows();
    expect(rows.length).toBeGreaterThanOrEqual(2);

    // Most recent should be first
    if (id1 && id2) {
      const idx1 = rows.findIndex((r) => r.instanceId.includes(id1));
      const idx2 = rows.findIndex((r) => r.instanceId.includes(id2));
      // workflow2 ran later, so should appear first (lower index)
      expect(idx2).toBeLessThan(idx1);
    }
  });

  test('status summary pills show correct counts', async ({
    page, app, executions,
  }) => {
    // Navigate to Executions view
    await app.navigateToExecutions();
    await page.waitForTimeout(500);

    const summary = await executions.getStatusSummary();

    // Summary texts should contain numbers
    expect(summary.completed).toMatch(/completed:\s*\d+/);
    expect(summary.waiting).toMatch(/waiting:\s*\d+/);
    expect(summary.other).toMatch(/other:\s*\d+/);
  });

  test('execution via API shows in UI after refresh', async ({
    page, app, executions,
  }) => {
    // Navigate to Executions
    await app.navigateToExecutions();
    await page.waitForTimeout(500);

    const beforeCount = await executions.getExecutionCount();

    // Execute workflow via API
    const workflow = buildStartStopWorkflow();
    await executeWorkflow(workflow);

    // Refresh
    await executions.clickRefresh();

    const afterCount = await executions.getExecutionCount();
    expect(afterCount).toBeGreaterThan(beforeCount);
  });

  test('execution row displays all columns correctly', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildStartStopWorkflow();
    const name = `Persist Columns ${Date.now()}`;
    const id = `test_persist_cols_${Date.now()}`;
    const definition = buildTemplateDefinition(id, name, workflow);

    await syncTemplate(definition);
    await app.navigateToFlows();
    await page.waitForTimeout(500);
    await flows.searchFlows(name);
    await page.waitForTimeout(300);
    await flows.openFlowInDesigner(name);

    await designer.clickRun();
    await designer.waitForRunComplete();

    const instanceId = await designer.getInstanceId();

    await app.navigateToExecutions();
    await page.waitForTimeout(500);

    const execRow = await executions.findExecutionByInstanceId(instanceId);
    expect(execRow).toBeTruthy();

    // Validate all columns have data
    expect(execRow.time).toBeTruthy();
    expect(execRow.time).not.toBe('never');
    expect(execRow.source).toBeTruthy();
    expect(execRow.instanceId).toBeTruthy();
    expect(execRow.status).toBeTruthy();
    expect(execRow.eventCount).toBeTruthy();
    expect(execRow.pendingCount).toBeDefined();
  });
});
