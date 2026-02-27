export class DesignerPage {
  constructor(page) {
    this.page = page;
  }

  // ── Palette ──

  async searchPalette(text) {
    const input = this.page.locator('.palette .search');
    await input.fill(text);
  }

  async addStageFromPalette(stageLabel) {
    const btn = this.page.locator('.palette-icon-btn', { hasText: stageLabel }).first();
    await btn.click();
    await this.page.waitForTimeout(200);
  }

  async selectPaletteCategory(category) {
    await this.page.locator('.palette-chip', { hasText: category }).click();
  }

  // ── Canvas ──

  async getCanvasNodeCount() {
    return this.page.locator('.react-flow__node').count();
  }

  async getCanvasNodes() {
    const nodes = this.page.locator('.react-flow__node');
    const count = await nodes.count();
    const result = [];
    for (let i = 0; i < count; i++) {
      const node = nodes.nth(i);
      const id = await node.getAttribute('data-id');
      const text = await node.textContent();
      result.push({ id, text });
    }
    return result;
  }

  async selectNode(nodeId) {
    const node = this.page.locator(`.react-flow__node[data-id="${nodeId}"]`);
    await node.click();
    await this.page.waitForTimeout(200);
  }

  async getEdgeCount() {
    return this.page.locator('.react-flow__edge').count();
  }

  // ── Inspector ──

  async setNodeProperty(key, value) {
    // Open the accordion containing the field if not open
    const fieldLabel = this.page.locator('.field-label', { hasText: key }).first();
    await fieldLabel.scrollIntoViewIfNeeded();

    // Find the closest inspector-section and its input
    const section = fieldLabel.locator('..');
    const input = section.locator('.input').first();

    const tagName = await input.evaluate((el) => el.tagName.toLowerCase());

    if (tagName === 'select') {
      await input.selectOption(value);
    } else if (tagName === 'textarea') {
      await input.fill(String(value));
    } else {
      const inputType = await input.getAttribute('type');
      if (inputType === 'checkbox') {
        const checked = await input.isChecked();
        if (checked !== Boolean(value)) {
          await input.click();
        }
      } else {
        await input.fill(String(value));
      }
    }
  }

  async getNodeProperty(key) {
    const fieldLabel = this.page.locator('.field-label', { hasText: key }).first();
    const section = fieldLabel.locator('..');
    const input = section.locator('.input').first();

    const tagName = await input.evaluate((el) => el.tagName.toLowerCase());
    if (tagName === 'select') {
      return input.inputValue();
    }
    const inputType = await input.getAttribute('type');
    if (inputType === 'checkbox') {
      return input.isChecked();
    }
    return input.inputValue();
  }

  async expandAccordion(title) {
    const accordion = this.page.locator('.inspector-accordion', { hasText: title });
    const isOpen = await accordion.getAttribute('open');
    if (isOpen === null) {
      await accordion.locator('summary').click();
      await this.page.waitForTimeout(100);
    }
  }

  // ── Toolbar ──

  async clickValidate() {
    await this.page.locator('.canvas-toolbar .btn.ghost', { hasText: 'Validate' }).click();
  }

  async clickAutoLayout() {
    await this.page.locator('.btn.ghost', { hasText: 'Auto-Layout' }).click();
  }

  async clickUndo() {
    await this.page.locator('.btn.ghost', { hasText: 'Undo' }).click();
  }

  async clickRedo() {
    await this.page.locator('.btn.ghost', { hasText: 'Redo' }).click();
  }

  // ── Header actions ──

  async clickRun() {
    await this.page.locator('.run-actions .btn.primary', { hasText: 'Run' }).click();
  }

  async clickSave() {
    await this.page.locator('.header-actions .btn.ghost', { hasText: /Save Flow|Save As Copy/ }).click();
    await this.page.waitForTimeout(500);
  }

  async clickBackToFlows() {
    await this.page.locator('.btn.ghost', { hasText: 'Back to Flows' }).click();
    await this.page.waitForTimeout(300);
  }

  async clickHeaderRun() {
    await this.page.locator('.header-actions .btn.primary', { hasText: 'Run' }).click();
  }

  // ── Run panel ──

  async getRunStatus() {
    const subtitle = this.page.locator('.run-subtitle').first();
    return subtitle.textContent();
  }

  async getRunEvents() {
    const events = this.page.locator('.run-body .run-log');
    const count = await events.count();
    const result = [];
    for (let i = 0; i < count; i++) {
      result.push(await events.nth(i).textContent());
    }
    return result;
  }

  async getRunEventsCount() {
    // Subtract 1 if the only element is "No run events yet."
    const events = this.page.locator('.run-body .run-log');
    const count = await events.count();
    if (count === 1) {
      const text = await events.first().textContent();
      if (text.includes('No run events yet')) return 0;
    }
    return count;
  }

  async getPendingItems() {
    const items = this.page.locator('.pending-item');
    const count = await items.count();
    const result = [];
    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      const meta = await item.locator('.pending-meta').textContent();
      result.push({ meta, element: item });
    }
    return result;
  }

  async resumePendingItem(nodeId, decision = 'approved') {
    const item = this.page.locator('.pending-item').filter({
      has: this.page.locator('.pending-meta', { hasText: nodeId }),
    });
    const select = item.locator('select.input');
    const hasSelect = await select.count();
    if (hasSelect > 0) {
      await select.selectOption(decision);
    }
    await item.locator('.btn.ghost', { hasText: 'Resume' }).click();
    await this.page.waitForTimeout(500);
  }

  async getInstanceId() {
    const status = await this.getRunStatus();
    const match = status.match(/instance:\s*(\S+)/);
    return match ? match[1] : '';
  }

  async waitForRunComplete(timeout = 15000) {
    await this.page.waitForFunction(
      () => {
        const el = document.querySelector('.run-subtitle');
        if (!el) return false;
        const text = el.textContent || '';
        return text.includes('completed') || text.includes('waiting') || text.includes('failed');
      },
      { timeout }
    );
  }

  async waitForStatus(status, timeout = 15000) {
    await this.page.waitForFunction(
      (s) => {
        const el = document.querySelector('.run-subtitle');
        return el && el.textContent.includes(s);
      },
      status,
      { timeout }
    );
  }

  // ── Validation ──

  async getValidationErrors() {
    const issues = this.page.locator('.pending-panel .run-log.error');
    const count = await issues.count();
    const result = [];
    for (let i = 0; i < count; i++) {
      result.push(await issues.nth(i).textContent());
    }
    return result;
  }

  async getValidationWarnings() {
    const issues = this.page.locator('.pending-panel .run-log.warn');
    const count = await issues.count();
    const result = [];
    for (let i = 0; i < count; i++) {
      result.push(await issues.nth(i).textContent());
    }
    return result;
  }

  async getRunError() {
    const errorEl = this.page.locator('.run-log.error').first();
    const exists = await errorEl.count();
    return exists > 0 ? errorEl.textContent() : null;
  }
}
