import { PensionCompanyTypes } from '../pension-definitions';
import { type BasePensionScraperOptions } from './base-pension-scraper';
import type { PensionScraper } from './interface';
export type PensionScraperOptions = BasePensionScraperOptions & {
    companyId: PensionCompanyTypes;
};
export declare function createPensionScraper(options: PensionScraperOptions): PensionScraper;
