export { CompanyTypes, SCRAPERS } from './definitions';
export { default as createScraper } from './scrapers/factory';

// Note: the typo ScaperScrapingResult & ScraperLoginResult (sic) are exported here for backward compatibility
export {
  ScraperLoginResult as ScaperLoginResult,
  ScraperScrapingResult as ScaperScrapingResult,
  Scraper,
  ScraperCredentials,
  ScraperLoginResult,
  ScraperOptions,
  ScraperScrapingResult,
} from './scrapers/interface';

export { default as OneZeroScraper } from './scrapers/one-zero';

export function getPuppeteerConfig() {
  return { chromiumRevision: '1250580' }; // https://github.com/puppeteer/puppeteer/releases/tag/puppeteer-core-v22.5.0
}

export { PortfolioCompanyTypes, PORTFOLIO_SCRAPERS } from './portfolio-definitions';
export { createPortfolioScraper } from './portfolio-scrapers/factory';
export type {
  PortfolioScraper,
  PortfolioScrapingResult,
  PortfolioPosition,
  PortfolioCash,
} from './portfolio-scrapers/interface';
export type { BasePortfolioScraperOptions } from './portfolio-scrapers/base-portfolio-scraper';
export type { PortfolioScraperOptions } from './portfolio-scrapers/factory';
