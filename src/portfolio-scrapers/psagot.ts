import { type Page } from 'puppeteer';
import { BasePortfolioScraper } from './base-portfolio-scraper';
import type { PortfolioCash, PortfolioPosition } from './interface';

export class PsagotScraper extends BasePortfolioScraper {
  protected async fetchPortfolio(
    _page: Page,
    _credentials: Record<string, string>,
  ): Promise<{ positions: PortfolioPosition[]; cash: PortfolioCash[]; asOfDate: string }> {
    throw new Error('Not implemented');
  }
}
