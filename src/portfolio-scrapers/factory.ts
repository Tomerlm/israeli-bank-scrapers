import { assertNever } from '../assertNever';
import { PortfolioCompanyTypes } from '../portfolio-definitions';
import { type BasePortfolioScraperOptions } from './base-portfolio-scraper';
import type { PortfolioScraper } from './interface';
import { BeinleumiPortfolioScraper } from './beinleumi';
import { PsagotScraper } from './psagot';

export type PortfolioScraperOptions = BasePortfolioScraperOptions & {
  companyId: PortfolioCompanyTypes;
};

export function createPortfolioScraper(options: PortfolioScraperOptions): PortfolioScraper {
  switch (options.companyId) {
    case PortfolioCompanyTypes.psagot:
      return new PsagotScraper(options);
    case PortfolioCompanyTypes.beinleumi:
      return new BeinleumiPortfolioScraper(options);
    default:
      assertNever(options.companyId, `Unknown portfolio company: ${options.companyId}`);
  }
}
