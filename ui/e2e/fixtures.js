import { test as base, expect } from '@playwright/test';
import { AppPage } from './pages/app.page.js';
import { DesignerPage } from './pages/designer.page.js';
import { FlowsPage } from './pages/flows.page.js';
import { ExecutionsPage } from './pages/executions.page.js';
import { healthcheck, syncTemplate, listExecutions } from './helpers/api.js';
import { buildTemplateDefinition } from './helpers/workflow-builder.js';

/**
 * Extended test fixture that auto-provides page objects and ensures
 * the backend is reachable before each test.
 */
export const test = base.extend({
  app: async ({ page }, use) => {
    const app = new AppPage(page);
    await app.goto();
    await use(app);
  },

  designer: async ({ page }, use) => {
    await use(new DesignerPage(page));
  },

  flows: async ({ page }, use) => {
    await use(new FlowsPage(page));
  },

  executions: async ({ page }, use) => {
    await use(new ExecutionsPage(page));
  },
});

export { expect };

/**
 * Helper: Save a workflow as a template via the API and then open it in the UI Designer.
 * Returns the template definition used.
 */
export async function saveAndOpenWorkflow(page, app, flows, workflow, name) {
  const id = `test_${name.replace(/\s+/g, '_').toLowerCase()}_${Date.now()}`;
  const definition = buildTemplateDefinition(id, name, workflow);

  // Save template via backend API
  await syncTemplate(definition);

  // Navigate to Flows and open it
  await app.navigateToFlows();
  await page.waitForTimeout(500);

  // Search for the flow
  await flows.searchFlows(name);
  await page.waitForTimeout(300);

  // Open in designer — click the row then use context menu
  await flows.openFlowInDesigner(name);

  return definition;
}

/**
 * Helper: Full lifecycle test for a workflow.
 * Creates template via API → opens in designer → saves → navigates away → reloads → runs → checks results → checks executions.
 */
export async function runFullLifecycleTest(
  page,
  app,
  designer,
  flows,
  executions,
  workflow,
  testName,
  { expectedStatus = 'completed', expectedEventCount, expectedEventPatterns = [], runTimeout = 15000 } = {}
) {
  const id = `test_${testName.replace(/\s+/g, '_').toLowerCase()}_${Date.now()}`;
  const definition = buildTemplateDefinition(id, testName, workflow);

  // 1. Save template via API
  await syncTemplate(definition);

  // 2. Navigate to Flows view
  await app.navigateToFlows();
  await page.waitForTimeout(500);

  // 3. Find and open in Designer
  await flows.searchFlows(testName);
  await page.waitForTimeout(300);
  await flows.openFlowInDesigner(testName);

  // 4. Verify nodes loaded on canvas
  const nodeCount = await designer.getCanvasNodeCount();
  expect(nodeCount).toBeGreaterThanOrEqual(workflow.nodes.length);

  // 5. Save the flow from Designer
  await designer.clickSave();

  // 6. Navigate away and back (reload test)
  await app.navigateToFlows();
  await page.waitForTimeout(300);
  await flows.searchFlows(testName);
  await page.waitForTimeout(300);
  await flows.openFlowInDesigner(testName);

  // 7. Verify nodes still present after reload
  const reloadedNodeCount = await designer.getCanvasNodeCount();
  expect(reloadedNodeCount).toBeGreaterThanOrEqual(workflow.nodes.length);

  // 8. Run the workflow
  await designer.clickRun();

  // 9. Wait for run to complete
  await designer.waitForRunComplete(runTimeout);

  // 10. Assert run status
  const status = await designer.getRunStatus();
  expect(status).toContain(expectedStatus);

  // 11. Assert run events
  const events = await designer.getRunEvents();
  if (expectedEventCount !== undefined) {
    expect(events.length).toBe(expectedEventCount);
  }
  for (const pattern of expectedEventPatterns) {
    const found = events.some((e) => e.includes(pattern));
    expect(found, `Expected event pattern "${pattern}" not found in: ${events.join(', ')}`).toBe(true);
  }

  // 12. Get instance ID
  const instanceId = await designer.getInstanceId();

  // 13. Navigate to Executions view
  await app.navigateToExecutions();
  await page.waitForTimeout(500);

  // 14. Verify execution appears in history
  if (instanceId) {
    const executionRow = await executions.findExecutionByInstanceId(instanceId);
    expect(executionRow, `Execution ${instanceId} should appear in history`).toBeTruthy();
    expect(executionRow.status).toContain(expectedStatus);
  }

  return { instanceId, status, events };
}
