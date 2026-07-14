import { type Page } from 'puppeteer';
import { BasePortfolioScraper } from './base-portfolio-scraper';
import type { PortfolioCash, PortfolioPosition } from './interface';
export declare class PsagotScraper extends BasePortfolioScraper {
    protected fetchPortfolio(page: Page, credentials: Record<string, unknown>): Promise<{
        positions: PortfolioPosition[];
        cash: PortfolioCash[];
        asOfDate: string;
    }>;
}
