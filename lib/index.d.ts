export { CompanyTypes, SCRAPERS } from './definitions';
export { default as createScraper } from './scrapers/factory';
export { ScraperLoginResult as ScaperLoginResult, ScraperScrapingResult as ScaperScrapingResult, Scraper, ScraperCredentials, ScraperLoginResult, ScraperOptions, ScraperScrapingResult, } from './scrapers/interface';
export { default as OneZeroScraper } from './scrapers/one-zero';
export declare function getPuppeteerConfig(): {
    chromiumRevision: string;
};
export { PortfolioCompanyTypes, PORTFOLIO_SCRAPERS } from './portfolio-definitions';
export { createPortfolioScraper } from './portfolio-scrapers/factory';
export type { PortfolioScraper, PortfolioScrapingResult, PortfolioPosition, PortfolioCash, } from './portfolio-scrapers/interface';
export { BasePortfolioScraper } from './portfolio-scrapers/base-portfolio-scraper';
export type { BasePortfolioScraperOptions } from './portfolio-scrapers/base-portfolio-scraper';
export type { PortfolioScraperOptions } from './portfolio-scrapers/factory';
