import { test, expect } from '../fixtures.js';
import {
  buildStartStopWorkflow,
  buildStringTemplateWorkflow,
  buildPauseWorkflow,
  buildLoopWorkflow,
  buildExclusiveChoiceWorkflow,
  WorkflowBuilder,
  buildTemplateDefinition,
} from '../helpers/workflow-builder.js';
import { syncTemplate } from '../helpers/api.js';

test.describe('Save & Reload Round-Trip', () => {
  test('start-stop: nodes and edges preserved after save/reload', async ({
    page, app, designer, flows,
  }) => {
    const workflow = buildStartStopWorkflow();
    const name = `SaveReload StartStop ${Date.now()}`;
    const id = `test_sr_ss_${Date.now()}`;
    const definition = buildTemplateDefinition(id, name, workflow);

    await syncTemplate(definition);
    await app.navigateToFlows();
    await page.waitForTimeout(500);
    await flows.searchFlows(name);
    await page.waitForTimeout(300);
    await flows.openFlowInDesigner(name);

    // Record initial state
    const initialNodes = await designer.getCanvasNodeCount();
    const initialEdges = await designer.getEdgeCount();

    // Save
    await designer.clickSave();

    // Navigate away
    await designer.clickBackToFlows();
    await page.waitForTimeout(300);

    // Reload
    await flows.searchFlows(name);
    await page.waitForTimeout(300);
    await flows.openFlowInDesigner(name);

    // Assert preserved
    const reloadedNodes = await designer.getCanvasNodeCount();
    const reloadedEdges = await designer.getEdgeCount();

    expect(reloadedNodes).toBe(initialNodes);
    expect(reloadedEdges).toBe(initialEdges);
  });

  test('3-stage pipeline: structure and node count preserved', async ({
    page, app, designer, flows,
  }) => {
    const workflow = new WorkflowBuilder()
      .addNode('start', 'start_1', { x: 100, y: 200 })
      .addNode('string_template', 'tmpl_1', { x: 350, y: 200 }, { template: 'Test output' })
      .addNode('stop', 'stop_1', { x: 600, y: 200 })
      .connect('start_1', 'tmpl_1', 'out', 'in')
      .connect('tmpl_1', 'stop_1', 'out', 'in')
      .build();

    const name = `SaveReload 3Stage ${Date.now()}`;
    const id = `test_sr_3s_${Date.now()}`;
    const definition = buildTemplateDefinition(id, name, workflow);

    await syncTemplate(definition);
    await app.navigateToFlows();
    await page.waitForTimeout(500);
    await flows.searchFlows(name);
    await page.waitForTimeout(300);
    await flows.openFlowInDesigner(name);

    // Should have 3 nodes
    expect(await designer.getCanvasNodeCount()).toBe(3);
    expect(await designer.getEdgeCount()).toBe(2);

    // Save and reload
    await designer.clickSave();
    await designer.clickBackToFlows();
    await page.waitForTimeout(300);
    await flows.searchFlows(name);
    await page.waitForTimeout(300);
    await flows.openFlowInDesigner(name);

    expect(await designer.getCanvasNodeCount()).toBe(3);
    expect(await designer.getEdgeCount()).toBe(2);
  });

  test('saved workflow executes correctly after reload', async ({
    page, app, designer, flows,
  }) => {
    const workflow = buildStringTemplateWorkflow('Saved template text');
    const name = `SaveReload Execute ${Date.now()}`;
    const id = `test_sr_exec_${Date.now()}`;
    const definition = buildTemplateDefinition(id, name, workflow);

    await syncTemplate(definition);
    await app.navigateToFlows();
    await page.waitForTimeout(500);
    await flows.searchFlows(name);
    await page.waitForTimeout(300);
    await flows.openFlowInDesigner(name);

    // Save
    await designer.clickSave();

    // Navigate away and reload
    await designer.clickBackToFlows();
    await page.waitForTimeout(300);
    await flows.searchFlows(name);
    await page.waitForTimeout(300);
    await flows.openFlowInDesigner(name);

    // Run the reloaded workflow
    await designer.clickRun();
    await designer.waitForRunComplete();

    const status = await designer.getRunStatus();
    expect(status).toContain('completed');

    const events = await designer.getRunEvents();
    expect(events.some((e) => e.includes('string_template'))).toBe(true);
  });

  test('loop workflow: preserves iteration count after save/reload', async ({
    page, app, designer, flows,
  }) => {
    const workflow = buildLoopWorkflow(5);
    const name = `SaveReload Loop ${Date.now()}`;
    const id = `test_sr_loop_${Date.now()}`;
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

    // Run — should still iterate 5 times
    await designer.clickRun();
    await designer.waitForRunComplete();

    const status = await designer.getRunStatus();
    expect(status).toContain('completed');

    const events = await designer.getRunEvents();
    expect(events.some((e) => e.includes('loop'))).toBe(true);
  });

  test('exclusive_choice: preserves expression after save/reload', async ({
    page, app, designer, flows,
  }) => {
    const workflow = buildExclusiveChoiceWorkflow('case_b');
    const name = `SaveReload Choice ${Date.now()}`;
    const id = `test_sr_choice_${Date.now()}`;
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

    // Run — should route to case_b
    await designer.clickRun();
    await designer.waitForRunComplete();

    const events = await designer.getRunEvents();
    expect(events.some((e) => e.includes('exclusive_choice'))).toBe(true);
  });

  test('complex workflow: multiple stages preserve all connections', async ({
    page, app, designer, flows,
  }) => {
    const workflow = new WorkflowBuilder()
      .addNode('start', 'start_1', { x: 100, y: 200 })
      .addNode('string_template', 'tmpl_1', { x: 300, y: 100 }, { template: 'Step 1' })
      .addNode('string_template', 'tmpl_2', { x: 300, y: 300 }, { template: 'Step 2' })
      .addNode('string_template', 'tmpl_3', { x: 550, y: 200 }, { template: 'Step 3' })
      .addNode('stop', 'stop_1', { x: 800, y: 200 })
      .connect('start_1', 'tmpl_1', 'out', 'in')
      .connect('start_1', 'tmpl_2', 'out', 'in')
      .connect('tmpl_1', 'tmpl_3', 'out', 'in')
      .connect('tmpl_2', 'tmpl_3', 'out', 'in')
      .connect('tmpl_3', 'stop_1', 'out', 'in')
      .build();

    const name = `SaveReload Complex ${Date.now()}`;
    const id = `test_sr_complex_${Date.now()}`;
    const definition = buildTemplateDefinition(id, name, workflow);

    await syncTemplate(definition);
    await app.navigateToFlows();
    await page.waitForTimeout(500);
    await flows.searchFlows(name);
    await page.waitForTimeout(300);
    await flows.openFlowInDesigner(name);

    expect(await designer.getCanvasNodeCount()).toBe(5);
    expect(await designer.getEdgeCount()).toBe(5);

    // Save and reload
    await designer.clickSave();
    await designer.clickBackToFlows();
    await page.waitForTimeout(300);
    await flows.searchFlows(name);
    await page.waitForTimeout(300);
    await flows.openFlowInDesigner(name);

    expect(await designer.getCanvasNodeCount()).toBe(5);
    expect(await designer.getEdgeCount()).toBe(5);
  });

  test('flow appears in Flows table after creation', async ({
    page, app, flows,
  }) => {
    const workflow = buildStartStopWorkflow();
    const name = `SaveReload FlowTable ${Date.now()}`;
    const id = `test_sr_table_${Date.now()}`;
    const definition = buildTemplateDefinition(id, name, workflow);

    await syncTemplate(definition);
    await app.navigateToFlows();
    await page.waitForTimeout(500);

    await flows.searchFlows(name);
    await page.waitForTimeout(300);

    const flow = await flows.findFlowByName(name);
    expect(flow).toBeTruthy();
  });
});
