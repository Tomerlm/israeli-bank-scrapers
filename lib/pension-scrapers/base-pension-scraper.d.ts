import { type Page } from 'puppeteer';
import type { PensionHoldingOutput, PensionScraper, PensionScrapingResult } from './interface';
export type BasePensionScraperOptions = {
    args?: string[];
    timeout?: number;
    showBrowser?: boolean;
};
export declare abstract class BasePensionScraper implements PensionScraper {
    protected options: BasePensionScraperOptions;
    constructor(options: BasePensionScraperOptions);
    scrape(credentials: Record<string, unknown>): Promise<PensionScrapingResult>;
    protected abstract fetchPension(page: Page, credentials: Record<string, unknown>): Promise<{
        holdings: PensionHoldingOutput[];
        asOfDate: string;
    }>;
}
