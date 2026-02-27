export class ExecutionsPage {
  constructor(page) {
    this.page = page;
  }

  async getExecutionRows() {
    const rows = this.page.locator('.data-table tbody tr');
    const count = await rows.count();
    const result = [];
    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const cells = row.locator('td');
      const cellCount = await cells.count();
      if (cellCount < 7) continue;
      result.push({
        time: await cells.nth(0).textContent(),
        source: await cells.nth(1).textContent(),
        instanceId: await cells.nth(2).textContent(),
        status: (await cells.nth(3).textContent()).trim(),
        eventCount: await cells.nth(4).textContent(),
        pendingCount: await cells.nth(5).textContent(),
        outputs: await cells.nth(6).textContent(),
        element: row,
      });
    }
    return result;
  }

  async getStatusSummary() {
    const completed = this.page.locator('.risk-pill.risk-low').first();
    const waiting = this.page.locator('.risk-pill.risk-medium').first();
    const other = this.page.locator('.risk-pill.risk-high').first();
    return {
      completed: await completed.textContent(),
      waiting: await waiting.textContent(),
      other: await other.textContent(),
    };
  }

  async findExecutionByInstanceId(instanceId) {
    const rows = await this.getExecutionRows();
    return rows.find((row) => row.instanceId.includes(instanceId));
  }

  async getLatestExecution() {
    const rows = await this.getExecutionRows();
    return rows[0] || null;
  }

  async waitForExecution(instanceId, timeout = 20000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const row = await this.findExecutionByInstanceId(instanceId);
      if (row) return row;
      await this.page.waitForTimeout(1000);
      // Refresh page to get new data
      await this.page.locator('.btn.ghost', { hasText: 'Refresh' }).click();
      await this.page.waitForTimeout(500);
    }
    throw new Error(`Execution ${instanceId} not found within ${timeout}ms`);
  }

  async getExecutionCount() {
    const rows = this.page.locator('.data-table tbody tr');
    return rows.count();
  }

  async hasNoExecutionsMessage() {
    const msg = this.page.locator('.run-log', { hasText: 'No execution records yet' });
    return (await msg.count()) > 0;
  }

  async clickRefresh() {
    await this.page.locator('.btn.ghost', { hasText: 'Refresh' }).click();
    await this.page.waitForTimeout(500);
  }
}
