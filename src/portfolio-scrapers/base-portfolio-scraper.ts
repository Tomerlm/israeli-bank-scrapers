import puppeteer, { type Page } from 'puppeteer';
import type { PortfolioCash, PortfolioPosition, PortfolioScraper, PortfolioScrapingResult } from './interface';

export type BasePortfolioScraperOptions = {
  args?: string[];
  timeout?: number;
  showBrowser?: boolean;
};

export abstract class BasePortfolioScraper implements PortfolioScraper {
  constructor(protected options: BasePortfolioScraperOptions) {}

  async scrape(credentials: Record<string, unknown>): Promise<PortfolioScrapingResult> {
    const browser = await puppeteer.launch({
      headless: !this.options.showBrowser,
      args: this.options.args,
    });
    try {
      const page = await browser.newPage();
      if (this.options.timeout !== undefined) {
        page.setDefaultTimeout(this.options.timeout);
      }
      const result = await this.fetchPortfolio(page, credentials);
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

  protected abstract fetchPortfolio(
    page: Page,
    credentials: Record<string, unknown>,
  ): Promise<{ positions: PortfolioPosition[]; cash: PortfolioCash[]; asOfDate: string }>;
}
