import { type Page } from 'puppeteer';
import { PsagotScraper } from './psagot';

type MockPage = {
  goto: jest.Mock;
  waitForSelector: jest.Mock;
  type: jest.Mock;
  evaluate: jest.Mock;
  waitForFunction: jest.Mock;
};

function makeMockPage(): MockPage {
  return {
    goto: jest.fn().mockResolvedValue(null),
    waitForSelector: jest.fn().mockResolvedValue({ click: jest.fn() }),
    type: jest.fn().mockResolvedValue(null),
    evaluate: jest.fn().mockImplementation((fn: unknown, ...args: unknown[]) => {
      // If no extra args, run the function directly in Node context.
      // Evaluate callbacks that only return data (e.g. `() => []`) work fine;
      // setup callbacks that access `document` throw and resolve to undefined.
      if (typeof fn === 'function' && args.length === 0) {
        try {
          return Promise.resolve((fn as () => unknown)());
        } catch {
          return Promise.resolve(undefined);
        }
      }
      return Promise.resolve(undefined);
    }),
    waitForFunction: jest.fn().mockResolvedValue(null),
  };
}

describe('PsagotScraper', () => {
  test('calls accessibility setup before filling credentials', async () => {
    const mockPage = makeMockPage();
    const scraper = new PsagotScraper({});
    await (scraper as unknown as { fetchPortfolio: (p: Page, c: Record<string, unknown>) => Promise<unknown> })
      .fetchPortfolio(mockPage as unknown as Page, { username: 'u', password: 'p' });

    // First evaluate call should enable Flutter accessibility
    expect(mockPage.evaluate).toHaveBeenCalled();
    // Should type into both username and password fields
    expect(mockPage.type).toHaveBeenCalledWith(
      expect.stringContaining('Username'),
      'u',
    );
    expect(mockPage.type).toHaveBeenCalledWith(
      expect.stringContaining('Password'),
      'p',
    );
  });

  test('returns result with asOfDate and empty positions/cash from placeholder impl', async () => {
    const mockPage = makeMockPage();
    const scraper = new PsagotScraper({});
    const result = await (scraper as unknown as { fetchPortfolio: (p: Page, c: Record<string, unknown>) => Promise<unknown> })
      .fetchPortfolio(mockPage as unknown as Page, { username: 'u', password: 'p' });

    // positions/cash are placeholder empty arrays until live holdings page selectors are added
    expect(result).toMatchObject({ positions: [], cash: [] });
    expect((result as { asOfDate: string }).asOfDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('calls otpCodeRetriever when provided', async () => {
    const mockOtpRetriever = jest.fn().mockResolvedValue('123456');
    const mockPage = makeMockPage();

    const scraper = new PsagotScraper({});
    await (scraper as unknown as { fetchPortfolio: (p: Page, c: Record<string, unknown>) => Promise<unknown> })
      .fetchPortfolio(mockPage as unknown as Page, {
        username: 'u',
        password: 'p',
        otpCodeRetriever: mockOtpRetriever,
      });

    expect(mockOtpRetriever).toHaveBeenCalledTimes(1);
  });

  test('skips OTP flow when otpCodeRetriever is not provided', async () => {
    const mockPage = makeMockPage();
    const scraper = new PsagotScraper({});
    await expect(
      (scraper as unknown as { fetchPortfolio: (p: Page, c: Record<string, unknown>) => Promise<unknown> })
        .fetchPortfolio(mockPage as unknown as Page, { username: 'u', password: 'p' }),
    ).resolves.not.toThrow();
  });
});
