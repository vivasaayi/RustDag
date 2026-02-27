export class FlowsPage {
  constructor(page) {
    this.page = page;
  }

  async createNewFlow() {
    await this.page.locator('.btn.primary', { hasText: 'New Flow' }).click();
    await this.page.waitForTimeout(500);
  }

  async searchFlows(query) {
    const input = this.page.locator('.page-panel input[type="text"]').first();
    await input.fill(query);
    await this.page.waitForTimeout(200);
  }

  async getFlowRows() {
    const rows = this.page.locator('.data-table tbody tr');
    const count = await rows.count();
    const result = [];
    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const cells = row.locator('td');
      const cellCount = await cells.count();
      const cellTexts = [];
      for (let j = 0; j < cellCount; j++) {
        cellTexts.push(await cells.nth(j).textContent());
      }
      result.push({
        name: cellTexts[0] || '',
        type: cellTexts[1] || '',
        enabled: cellTexts[2] || '',
        auto: cellTexts[3] || '',
        schedule: cellTexts[4] || '',
        device: cellTexts[5] || '',
        lastRun: cellTexts[6] || '',
        status: cellTexts[7] || '',
        element: row,
      });
    }
    return result;
  }

  async findFlowByName(name) {
    const rows = await this.getFlowRows();
    return rows.find((row) => row.name.includes(name));
  }

  async openFlowInDesigner(name) {
    const row = this.page.locator('.data-table tbody tr', { hasText: name }).first();
    // Right-click to open context menu
    await row.click({ button: 'right' });
    await this.page.waitForTimeout(200);
    // Click "Open in Designer"
    const menuItem = this.page.locator('.row-menu-item, .menu-action', { hasText: 'Open in Designer' }).first();
    const menuExists = await menuItem.count();
    if (menuExists > 0) {
      await menuItem.click();
    } else {
      // Double-click the row as fallback
      await row.dblclick();
    }
    await this.page.waitForTimeout(500);
  }

  async runFlowNow(name) {
    const row = this.page.locator('.data-table tbody tr', { hasText: name }).first();
    await row.click({ button: 'right' });
    await this.page.waitForTimeout(200);
    await this.page.locator('.row-menu-item, .menu-action', { hasText: 'Run Now' }).first().click();
    await this.page.waitForTimeout(500);
  }

  async getFlowCount() {
    const rows = this.page.locator('.data-table tbody tr');
    return rows.count();
  }

  async hasNoFlowsMessage() {
    const msg = this.page.locator('.run-log', { hasText: 'No execution records' });
    return (await msg.count()) > 0;
  }
}
