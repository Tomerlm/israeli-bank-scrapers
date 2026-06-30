import { type Page } from 'puppeteer';
import { PsagotScraper } from './psagot';

const MOCK_SESSION_KEY = 'mock-session-key-1234';

const MOCK_ACCOUNTS_RESPONSE = {
  UserAccounts: { UserAccount: [{ '-key': 'ACC-001' }] },
};

const MOCK_BALANCES_RESPONSE = {
  View: {
    Account: {
      OnlineCash: 500,
      AccountPosition: {
        Balance: [
          {
            EquityNumber: '1159250',
            LastRate: 23880,   // agorot → 238.80 ILS
            OnlineNV: 10,
            AveragePrice: 22000,
            AveragePriceProfitLoss: 188,
            CurrencyCode: 'ILS',
          },
        ],
      },
    },
    Meta: {
      Security: { '-Key': '1159250', HebName: 'iShares S&P 500' },
    },
  },
};

type MockPage = {
  on: jest.Mock;
  setUserAgent: jest.Mock;
  goto: jest.Mock;
  waitForSelector: jest.Mock;
  type: jest.Mock;
  evaluate: jest.Mock;
  waitForFunction: jest.Mock;
};

function makeMockPage(): MockPage {
  return {
    on: jest.fn().mockImplementation((event: string, handler: (r: unknown) => void) => {
      if (event === 'response') {
        // Call synchronously so the .then(sessionKey = key) microtask is queued
        // before the first `await` in fetchPortfolio, ensuring sessionKey is set in time.
        handler({
          url: () => 'https://trade1.psagot.co.il/V2/json2/login?catalog=unified',
          json: () => Promise.resolve({ Login: { SessionKey: MOCK_SESSION_KEY } }),
        });
      }
    }),
    setUserAgent: jest.fn().mockResolvedValue(null),
    goto: jest.fn().mockResolvedValue(null),
    waitForSelector: jest.fn().mockResolvedValue({ click: jest.fn() }),
    type: jest.fn().mockResolvedValue(null),
    evaluate: jest.fn().mockImplementation(async (_fn: unknown, ...args: unknown[]) => {
      const firstArg = args[0] as string | undefined;
      if (typeof firstArg === 'string' && firstArg.includes('accounts')) return MOCK_ACCOUNTS_RESPONSE;
      if (typeof firstArg === 'string' && firstArg.includes('balances')) return MOCK_BALANCES_RESPONSE;
      // DOM calls (no URL arg): return a mock aria-label array so OTP flow can proceed
      if (typeof _fn === 'function' && args.length === 0) {
        return ['Mock OTP Label'];
      }
      return undefined;
    }),
    waitForFunction: jest.fn().mockResolvedValue(null),
  };
}

describe('PsagotScraper', () => {
  test('calls accessibility setup and fills credentials', async () => {
    const mockPage = makeMockPage();
    const scraper = new PsagotScraper({});
    await (
      scraper as unknown as { fetchPortfolio: (p: Page, c: Record<string, unknown>) => Promise<unknown> }
    ).fetchPortfolio(mockPage as unknown as Page, { username: 'testuser', password: 'testpass' });

    expect(mockPage.evaluate).toHaveBeenCalled();
    expect(mockPage.type).toHaveBeenCalledWith(expect.stringContaining('Username'), 'testuser');
    expect(mockPage.type).toHaveBeenCalledWith(expect.stringContaining('Password'), 'testpass');
  });

  test('returns positions and cash extracted from balances API', async () => {
    const mockPage = makeMockPage();
    const scraper = new PsagotScraper({});
    const result = (await (
      scraper as unknown as { fetchPortfolio: (p: Page, c: Record<string, unknown>) => Promise<unknown> }
    ).fetchPortfolio(mockPage as unknown as Page, { username: 'u', password: 'p' })) as {
      positions: Array<{ identifier: string; quantity: number; price: number }>;
      cash: Array<{ currency: string; amount: number }>;
      asOfDate: string;
    };

    expect(result.asOfDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.positions).toHaveLength(1);
    expect(result.positions[0]).toMatchObject({
      identifier: 'psagot-1159250',
      quantity: 10,
      price: 238.8,   // 23880 agorot / 100
    });
    expect(result.cash).toEqual([{ currency: 'ILS', amount: 500 }]);
  });

  test('calls otpCodeRetriever when provided', async () => {
    const mockOtpRetriever = jest.fn().mockResolvedValue('123456');
    const mockPage = makeMockPage();
    mockPage.waitForFunction.mockResolvedValue(null);

    const scraper = new PsagotScraper({});
    await (
      scraper as unknown as { fetchPortfolio: (p: Page, c: Record<string, unknown>) => Promise<unknown> }
    ).fetchPortfolio(mockPage as unknown as Page, {
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
      (
        scraper as unknown as { fetchPortfolio: (p: Page, c: Record<string, unknown>) => Promise<unknown> }
      ).fetchPortfolio(mockPage as unknown as Page, { username: 'u', password: 'p' }),
    ).resolves.not.toThrow();
  });
});
