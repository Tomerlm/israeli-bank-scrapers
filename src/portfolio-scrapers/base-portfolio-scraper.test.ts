import puppeteer, { type Page } from 'puppeteer';
import { BasePortfolioScraper } from './base-portfolio-scraper';
import type { PortfolioCash, PortfolioPosition } from './interface';

jest.mock('puppeteer');

type FetchResult = { positions: PortfolioPosition[]; cash: PortfolioCash[]; asOfDate: string };

const mockPage: Partial<Page> = { setDefaultTimeout: jest.fn() };
const mockBrowser = {
  newPage: jest.fn(),
  close: jest.fn(),
};

beforeEach(() => {
  mockBrowser.newPage.mockResolvedValue(mockPage);
  mockBrowser.close.mockResolvedValue(undefined);
  (puppeteer.launch as jest.MockedFunction<typeof puppeteer.launch>).mockResolvedValue(
    mockBrowser as unknown as Awaited<ReturnType<typeof puppeteer.launch>>,
  );
});

class SuccessStub extends BasePortfolioScraper {
  constructor(private result: FetchResult) {
    super({});
  }

  protected async fetchPortfolio(
    _page: Page,
    _credentials: Record<string, string>,
  ): Promise<FetchResult> {
    return this.result;
  }
}

class ThrowingStub extends BasePortfolioScraper {
  constructor(private message: string) {
    super({});
  }

  protected async fetchPortfolio(
    _page: Page,
    _credentials: Record<string, string>,
  ): Promise<FetchResult> {
    throw new Error(this.message);
  }
}

describe('BasePortfolioScraper', () => {
  test('returns success result when fetchPortfolio resolves', async () => {
    const positions: PortfolioPosition[] = [
      { identifier: 'IL0011320343', name: 'Test Security', quantity: 10, price: 100, currency: 'ILS' },
    ];
    const cash: PortfolioCash[] = [{ currency: 'ILS', amount: 500 }];
    const asOfDate = '2026-06-27';

    const scraper = new SuccessStub({ positions, cash, asOfDate });
    const result = await scraper.scrape({ username: 'user', password: 'pass' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.positions).toEqual(positions);
      expect(result.cash).toEqual(cash);
      expect(result.asOfDate).toBe(asOfDate);
    }
  });

  test('returns failure result when fetchPortfolio throws', async () => {
    const scraper = new ThrowingStub('login failed');
    const result = await scraper.scrape({ username: 'user', password: 'pass' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorType).toBe('UNKNOWN');
      expect(result.errorMessage).toBe('login failed');
    }
  });

  test('closes browser even when fetchPortfolio throws', async () => {
    const scraper = new ThrowingStub('crash');
    await scraper.scrape({});

    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  test('passes args and timeout options to puppeteer', async () => {
    const scraper = new SuccessStub({
      positions: [],
      cash: [],
      asOfDate: '2026-06-27',
    });
    await scraper.scrape({});

    expect(puppeteer.launch).toHaveBeenCalledWith(
      expect.objectContaining({ headless: true }),
    );
  });
});
