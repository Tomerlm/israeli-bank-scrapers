import { PortfolioCompanyTypes } from '../portfolio-definitions';
import { type BasePortfolioScraperOptions } from './base-portfolio-scraper';
import type { PortfolioScraper } from './interface';
export type PortfolioScraperOptions = BasePortfolioScraperOptions & {
    companyId: PortfolioCompanyTypes;
};
export declare function createPortfolioScraper(options: PortfolioScraperOptions): PortfolioScraper;
