import { PortfolioCompanyTypes, PORTFOLIO_SCRAPERS } from '../portfolio-definitions';

describe('portfolio-definitions', () => {
  test('PortfolioCompanyTypes.psagot equals the string "psagot"', () => {
    expect(PortfolioCompanyTypes.psagot).toBe('psagot');
  });

  test('PORTFOLIO_SCRAPERS has an entry for every PortfolioCompanyTypes value', () => {
    const allTypes = Object.values(PortfolioCompanyTypes);
    for (const type of allTypes) {
      expect(PORTFOLIO_SCRAPERS[type]).toBeDefined();
      expect(typeof PORTFOLIO_SCRAPERS[type].name).toBe('string');
      expect(Array.isArray(PORTFOLIO_SCRAPERS[type].loginFields)).toBe(true);
    }
  });

  test('psagot entry has the expected loginFields', () => {
    expect(PORTFOLIO_SCRAPERS[PortfolioCompanyTypes.psagot].loginFields).toEqual(['username', 'password']);
  });
});
