export class AppPage {
  constructor(page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto('/');
    await this.page.waitForLoadState('networkidle');
  }

  async navigateToExecutions() {
    await this.page.locator('.menu-item', { hasText: 'Executions' }).click();
    await this.page.waitForTimeout(300);
  }

  async navigateToFlows() {
    await this.page.locator('.menu-item', { hasText: 'Flows' }).click();
    await this.page.waitForTimeout(300);
  }

  async getActiveView() {
    const active = this.page.locator('.menu-item.active');
    return active.textContent();
  }

  async setProfileMode(mode) {
    const select = this.page.locator('.mode-select');
    await select.click();
    await this.page.locator(`[data-value="${mode}"]`).click();
  }

  async openSecrets() {
    await this.page.locator('.btn.ghost', { hasText: 'Secrets' }).click();
  }
}
