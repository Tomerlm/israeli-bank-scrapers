import { type Page } from 'puppeteer';
import type { PortfolioCash, PortfolioPosition, PortfolioScraper, PortfolioScrapingResult } from './interface';
export type BasePortfolioScraperOptions = {
    args?: string[];
    timeout?: number;
    showBrowser?: boolean;
};
export declare abstract class BasePortfolioScraper implements PortfolioScraper {
    protected options: BasePortfolioScraperOptions;
    constructor(options: BasePortfolioScraperOptions);
    scrape(credentials: Record<string, unknown>): Promise<PortfolioScrapingResult>;
    protected abstract fetchPortfolio(page: Page, credentials: Record<string, unknown>): Promise<{
        positions: PortfolioPosition[];
        cash: PortfolioCash[];
        asOfDate: string;
    }>;
}
