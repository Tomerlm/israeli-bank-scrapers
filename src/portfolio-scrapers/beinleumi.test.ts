import { type Page } from 'puppeteer';
import { BeinleumiPortfolioScraper } from './beinleumi';

type MockPage = {
  evaluate: jest.Mock;
  waitForFunction: jest.Mock;
};

function extractCash(scraper: BeinleumiPortfolioScraper, page: MockPage) {
  return (
    scraper as unknown as {
      extractCash: (p: Page) => Promise<Array<{ currency: string; amount: number }>>;
    }
  ).extractCash(page as unknown as Page);
}

describe('BeinleumiPortfolioScraper.extractCash', () => {
  test('returns the checking balance as ILS cash', async () => {
    const page: MockPage = {
      // 1st evaluate injects the iframe (no return); 2nd reads .main_balance text.
      evaluate: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce('12,345.67 ₪'),
      waitForFunction: jest.fn().mockResolvedValue(null),
    };

    const cash = await extractCash(new BeinleumiPortfolioScraper({}), page);

    expect(cash).toEqual([{ currency: 'ILS', amount: 12345.67 }]);
  });

  test('degrades to empty cash when the balance cannot be read', async () => {
    const page: MockPage = {
      evaluate: jest.fn().mockResolvedValue(undefined),
      waitForFunction: jest.fn().mockRejectedValue(new Error('timeout')),
    };

    const cash = await extractCash(new BeinleumiPortfolioScraper({}), page);

    expect(cash).toEqual([]);
  });
});
