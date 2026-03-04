import { test, expect, runFullLifecycleTest } from '../../fixtures.js';
import { buildSingleStageWorkflow } from '../../helpers/workflow-builder.js';

test.describe('Integration Stages (dryRun)', () => {
  // ── API Call ──

  test('api_call: GET request in dry run', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildSingleStageWorkflow('api_call', {
      method: 'GET',
      url: 'https://httpbin.org/get',
      dryRun: true,
    });
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'API Call GET DryRun',
      { expectedStatus: 'completed', expectedEventPatterns: ['api_call'] }
    );
  });

  test('api_call: POST request in dry run', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildSingleStageWorkflow('api_call', {
      method: 'POST',
      url: 'https://httpbin.org/post',
      body: '{"test": true}',
      dryRun: true,
    });
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'API Call POST DryRun',
      { expectedStatus: 'completed', expectedEventPatterns: ['api_call'] }
    );
  });

  // ── Send Mail ──

  test('send_mail: sends email in dry run', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildSingleStageWorkflow('send_mail', {
      to: 'test@example.com',
      subject: 'Test Email',
      body: 'This is a test email',
      from: 'sender@example.com',
      smtpHost: 'localhost',
      smtpPort: 587,
      dryRun: true,
    });
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'Send Mail DryRun',
      { expectedStatus: 'completed', expectedEventPatterns: ['send_mail'] }
    );
  });

  // ── Notify User ──

  test('notify_user: sends notification', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildSingleStageWorkflow('notify_user', {
      message: 'Test notification message',
      userId: 'test_user',
      dryRun: true,
    });
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'Notify User',
      { expectedStatus: 'completed', expectedEventPatterns: ['notify_user'] }
    );
  });

  // ── Exec Process ──

  test('exec_process: executes command in dry run', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildSingleStageWorkflow('exec_process', {
      command: 'echo hello',
      timeoutSeconds: 10,
      dryRun: true,
    });
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'Exec Process DryRun',
      { expectedStatus: 'completed', expectedEventPatterns: ['exec_process'] }
    );
  });

  // ── MySQL Query ──

  test('mysql_query: executes query in dry run', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildSingleStageWorkflow('mysql_query', {
      connection: 'mysql://user:pass@localhost:3306/testdb',
      query: 'SELECT 1',
      dryRun: true,
    });
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'MySQL Query DryRun',
      { expectedStatus: 'completed', expectedEventPatterns: ['mysql_query'] }
    );
  });

  // ── Postgres Query ──

  test('postgres_query: executes query in dry run', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildSingleStageWorkflow('postgres_query', {
      connection: 'postgres://user:pass@localhost:5432/testdb',
      query: 'SELECT 1',
      dryRun: true,
    });
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'Postgres Query DryRun',
      { expectedStatus: 'completed', expectedEventPatterns: ['postgres_query'] }
    );
  });

  // ── MongoDB Query ──

  test('mongo_query: executes operation in dry run', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildSingleStageWorkflow('mongo_query', {
      connection: 'mongodb://localhost:27017',
      database: 'testdb',
      collection: 'test',
      operation: 'find',
      filter: '{}',
      dryRun: true,
    });
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'Mongo Query DryRun',
      { expectedStatus: 'completed', expectedEventPatterns: ['mongo_query'] }
    );
  });

  // ── AWS S3 ──

  test('aws_s3: list operation in dry run', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildSingleStageWorkflow('aws_s3', {
      action: 'list',
      bucket: 'test-bucket',
      prefix: 'test/',
      dryRun: true,
    });
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'AWS S3 List DryRun',
      { expectedStatus: 'completed', expectedEventPatterns: ['aws_s3'] }
    );
  });

  test('aws_s3: put operation in dry run', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildSingleStageWorkflow('aws_s3', {
      action: 'put',
      bucket: 'test-bucket',
      key: 'test/file.txt',
      body: 'test content',
      dryRun: true,
    });
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'AWS S3 Put DryRun',
      { expectedStatus: 'completed', expectedEventPatterns: ['aws_s3'] }
    );
  });

  // ── AWS SQS ──

  test('aws_sqs: send message in dry run', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildSingleStageWorkflow('aws_sqs', {
      action: 'send',
      queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789/test-queue',
      body: '{"test": true}',
      dryRun: true,
    });
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'AWS SQS Send DryRun',
      { expectedStatus: 'completed', expectedEventPatterns: ['aws_sqs'] }
    );
  });

  test('aws_sqs: receive message in dry run', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildSingleStageWorkflow('aws_sqs', {
      action: 'receive',
      queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789/test-queue',
      max: 1,
      dryRun: true,
    });
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'AWS SQS Receive DryRun',
      { expectedStatus: 'completed', expectedEventPatterns: ['aws_sqs'] }
    );
  });

  // ── AWS Kinesis ──

  test('aws_kinesis: put record in dry run', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildSingleStageWorkflow('aws_kinesis', {
      action: 'put',
      stream: 'test-stream',
      data: '{"test": true}',
      partitionKey: 'test-key',
      dryRun: true,
    });
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'AWS Kinesis DryRun',
      { expectedStatus: 'completed', expectedEventPatterns: ['aws_kinesis'] }
    );
  });

  // ── AWS CloudWatch ──

  test('aws_cloudwatch: put metric in dry run', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildSingleStageWorkflow('aws_cloudwatch', {
      action: 'put_metric',
      namespace: 'TestNamespace',
      metricName: 'TestMetric',
      value: 42,
      dryRun: true,
    });
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'AWS CloudWatch DryRun',
      { expectedStatus: 'completed', expectedEventPatterns: ['aws_cloudwatch'] }
    );
  });

  // ── Kubernetes ──

  test('kubernetes: list operation in dry run', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildSingleStageWorkflow('kubernetes', {
      namespace: 'default',
      kind: 'pods',
      operation: 'list',
      dryRun: true,
    });
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'Kubernetes List DryRun',
      { expectedStatus: 'completed', expectedEventPatterns: ['kubernetes'] }
    );
  });

  // ── Inline Script ──

  test('inline_script: placeholder execution', async ({
    page, app, designer, flows, executions,
  }) => {
    const workflow = buildSingleStageWorkflow('inline_script', {
      code: 'console.log("hello")',
      dryRun: true,
    });
    await runFullLifecycleTest(
      page, app, designer, flows, executions, workflow, 'Inline Script',
      { expectedStatus: 'completed', expectedEventPatterns: ['inline_script'] }
    );
  });
});
