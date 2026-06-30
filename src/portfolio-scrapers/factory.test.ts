import { PortfolioCompanyTypes } from '../portfolio-definitions';
import { createPortfolioScraper } from './factory';

describe('createPortfolioScraper', () => {
  test('returns a PortfolioScraper with a scrape method for psagot', () => {
    const scraper = createPortfolioScraper({ companyId: PortfolioCompanyTypes.psagot });
    expect(scraper).toBeDefined();
    expect(typeof scraper.scrape).toBe('function');
  });

  test('throws for an unrecognised companyId', () => {
    expect(() => createPortfolioScraper({ companyId: 'unknown' as PortfolioCompanyTypes })).toThrow(
      'Unknown portfolio company: unknown',
    );
  });
});
