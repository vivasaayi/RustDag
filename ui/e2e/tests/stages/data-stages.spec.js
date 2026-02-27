import { test, expect, runFullLifecycleTest } from '../../fixtures.js';
import {
  buildStringTemplateWorkflow,
  buildSingleControlStageWorkflow,
} from '../../helpers/workflow-builder.js';

test.describe('Data / AI Stages', () => {
  // ── String Template ──

  test('string_template: renders template and completes', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildStringTemplateWorkflow('Hello {{name}}');
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'String Template Basic',
      {
        expectedStatus: 'completed',
        expectedEventPatterns: ['start', 'string_template', 'stop'],
      }
    );
  });

  test('string_template: empty template renders correctly', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildStringTemplateWorkflow('');
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'String Template Empty',
      {
        expectedStatus: 'completed',
        expectedEventPatterns: ['string_template'],
      }
    );
  });

  test('string_template: static text without variables', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildStringTemplateWorkflow('This is a static message');
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'String Template Static',
      {
        expectedStatus: 'completed',
        expectedEventPatterns: ['string_template'],
      }
    );
  });

  test('string_template: multiple variables in template', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildStringTemplateWorkflow('Hello {{first}} {{last}}, welcome to {{place}}');
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'String Template Multi Vars',
      {
        expectedStatus: 'completed',
        expectedEventPatterns: ['string_template'],
      }
    );
  });

  // ── LLM Agent (dry run) ──

  test('llm_agent: executes in dry run mode', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildSingleControlStageWorkflow('llm_agent', {
      dryRun: true,
      prompt: 'Test prompt for dry run',
    });
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'LLM Agent DryRun',
      {
        expectedStatus: 'completed',
        expectedEventPatterns: ['llm_agent'],
      }
    );
  });

  // ── Custom LLM Agent (dry run) ──

  test('custom_llm_agent: executes in dry run mode', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildSingleControlStageWorkflow('custom_llm_agent', {
      dryRun: true,
      prompt: 'Custom test prompt',
      model: 'test-model',
    });
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'Custom LLM Agent DryRun',
      {
        expectedStatus: 'completed',
        expectedEventPatterns: ['custom_llm_agent'],
      }
    );
  });
});
