import puppeteer, { type Page } from 'puppeteer';
import type { PensionHoldingOutput, PensionScraper, PensionScrapingResult } from './interface';

export type BasePensionScraperOptions = {
  args?: string[];
  timeout?: number;
  showBrowser?: boolean;
};

export abstract class BasePensionScraper implements PensionScraper {
  constructor(protected options: BasePensionScraperOptions) {}

  async scrape(credentials: Record<string, unknown>): Promise<PensionScrapingResult> {
    const browser = await puppeteer.launch({
      headless: !this.options.showBrowser,
      args: this.options.args,
    });
    try {
      const page = await browser.newPage();
      if (this.options.timeout !== undefined) {
        page.setDefaultTimeout(this.options.timeout);
      }
      const result = await this.fetchPension(page, credentials);
      return { success: true, ...result };
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      return { success: false, errorType: 'UNKNOWN', errorMessage };
    } finally {
      try {
        await browser.close();
      } catch {
        // ignore close errors — the real error (if any) was already captured above
      }
    }
  }

  protected abstract fetchPension(
    page: Page,
    credentials: Record<string, unknown>,
  ): Promise<{ holdings: PensionHoldingOutput[]; asOfDate: string }>;
}
