import { test, expect, runFullLifecycleTest } from '../fixtures.js';
import { buildStartStopWorkflow } from '../helpers/workflow-builder.js';
import { syncTemplate } from '../helpers/api.js';
import { buildTemplateDefinition } from '../helpers/workflow-builder.js';

test.describe('Workflow Lifecycle', () => {
  test('create new flow from Flows view, save, reload, execute, verify', async ({
    page,
    app,
    designer,
    flows,
    executions,
  }) => {
    // 1. Navigate to Flows view
    await app.navigateToFlows();

    // 2. Click "New Flow" → auto-opens Designer with start+stop
    await flows.createNewFlow();
    await page.waitForTimeout(500);

    // 3. Verify we're in the designer with nodes
    const nodeCount = await designer.getCanvasNodeCount();
    expect(nodeCount).toBeGreaterThanOrEqual(2);

    // 4. Click "Save Flow"
    await designer.clickSave();

    // 5. Click "Back to Flows"
    await designer.clickBackToFlows();

    // 6. Verify the flow appears in the table
    const flowRows = await flows.getFlowRows();
    expect(flowRows.length).toBeGreaterThan(0);

    // 7. Find the new flow (should be named "New Flow" or similar)
    const newFlow = flowRows.find((r) => r.name.includes('New Flow'));
    expect(newFlow).toBeTruthy();

    // 8. Open it in designer (verifies reload)
    await flows.openFlowInDesigner('New Flow');

    // 9. Assert canvas has start + stop nodes after reload
    const reloadedCount = await designer.getCanvasNodeCount();
    expect(reloadedCount).toBeGreaterThanOrEqual(2);

    // 10. Click "Run"
    await designer.clickRun();

    // 11. Wait for run to complete
    await designer.waitForRunComplete();

    // 12. Assert run status = "completed"
    const status = await designer.getRunStatus();
    expect(status).toContain('completed');

    // 13. Assert run events show start and stop
    const events = await designer.getRunEvents();
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.some((e) => e.includes('start'))).toBe(true);
    expect(events.some((e) => e.includes('stop'))).toBe(true);

    // 14. Navigate to Executions view
    await app.navigateToExecutions();
    await page.waitForTimeout(500);

    // 15. Assert latest execution row shows correct status
    const latest = await executions.getLatestExecution();
    expect(latest).toBeTruthy();
    expect(latest.status).toContain('completed');
  });

  test('start-stop workflow full lifecycle via API template', async ({
    page,
    app,
    designer,
    flows,
    executions,
  }) => {
    const workflow = buildStartStopWorkflow();

    await runFullLifecycleTest(page, app, designer, flows, executions, workflow, 'Start Stop Lifecycle', {
      expectedStatus: 'completed',
      expectedEventPatterns: ['start', 'stop'],
    });
  });

  test('save preserves workflow structure after reload', async ({
    page,
    app,
    designer,
    flows,
  }) => {
    const workflow = buildStartStopWorkflow();
    const name = `Reload Test ${Date.now()}`;
    const id = `test_reload_${Date.now()}`;
    const definition = buildTemplateDefinition(id, name, workflow);

    // Save via API
    await syncTemplate(definition);

    // Open in designer
    await app.navigateToFlows();
    await page.waitForTimeout(500);
    await flows.searchFlows(name);
    await page.waitForTimeout(300);
    await flows.openFlowInDesigner(name);

    // Note initial state
    const initialNodeCount = await designer.getCanvasNodeCount();
    const initialEdgeCount = await designer.getEdgeCount();

    // Save
    await designer.clickSave();

    // Navigate away
    await designer.clickBackToFlows();
    await page.waitForTimeout(300);

    // Reload
    await flows.searchFlows(name);
    await page.waitForTimeout(300);
    await flows.openFlowInDesigner(name);

    // Assert structure preserved
    const reloadedNodeCount = await designer.getCanvasNodeCount();
    const reloadedEdgeCount = await designer.getEdgeCount();

    expect(reloadedNodeCount).toBe(initialNodeCount);
    expect(reloadedEdgeCount).toBe(initialEdgeCount);
  });
});
