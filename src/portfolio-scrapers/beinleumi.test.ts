import { type Page } from 'puppeteer';
import { BeinleumiPortfolioScraper } from './beinleumi';
import type { PortfolioDeposit } from './interface';

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

type MockDepositsPage = {
  evaluate: jest.Mock;
  waitForResponse: jest.Mock;
};

function extractDeposits(scraper: BeinleumiPortfolioScraper, page: MockDepositsPage) {
  return (
    scraper as unknown as {
      extractDeposits: (p: Page) => Promise<PortfolioDeposit[]>;
    }
  ).extractDeposits(page as unknown as Page);
}

// Shape verified live against the real bff-MyDeposits/api/v1/portfolio/savings response
// (2026-08-20, account 008-575572) — field names are real, amounts/ids are sanitized.
function mockDepositsResponse(overrides?: Partial<{ outNoData: unknown }>) {
  return {
    json: jest.fn().mockResolvedValue({
      MyDepositsScreen: {
        outNoData: overrides?.outNoData ?? null,
        outMasachPikdonot: {
          outMasachPerMtb: {
            outPikTable: [
              {
                outShemMatbeaEng3: 'NIS',
                outPikListMatbea: {
                  outPikLine: [
                    {
                      outPikNo: '000000000099999999',
                      outMisparPikadon: '111-000022',
                      outKinuyByUser: 'פקדון שבוע- שלושה חודשים בריבית קבועה',
                      outKerenPkd: '50,000.00',
                      outShoviPkdn: '50,073.98',
                      outTrPeraon: '15/11/2026',
                      outMoadimMeshihotHafkadot: { outTrMoedHafkada: '15/08/2026' },
                      outRibit: {
                        outRbHalufotTbl: {
                          outRbHlfLine: [{ outRbHlfTeurSugHatzmada: 'ללא הצמדה', outRbHlfAchuzRbText: '3.5000' }],
                        },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    }),
  };
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

describe('BeinleumiPortfolioScraper.extractDeposits', () => {
  test('parses a deposit from the bff-MyDeposits response, including its own rate', async () => {
    const page: MockDepositsPage = {
      // 1st evaluate checks we're on the shell document; 2nd sets location.hash.
      evaluate: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(undefined),
      waitForResponse: jest.fn().mockResolvedValue(mockDepositsResponse()),
    };

    const deposits = await extractDeposits(new BeinleumiPortfolioScraper({}), page);

    expect(deposits).toEqual([
      {
        identifier: '111-000022',
        name: 'פקדון שבוע- שלושה חודשים בריבית קבועה',
        currency: 'ILS',
        principal: 50000,
        currentValue: 50073.98,
        maturityDate: '2026-11-15',
        openDate: '2026-08-15',
        interestRatePercent: 3.5,
        linkage: 'ללא הצמדה',
      },
    ]);
  });

  test('degrades to an empty array when not on the shell document', async () => {
    const page: MockDepositsPage = {
      evaluate: jest.fn().mockResolvedValueOnce(false),
      waitForResponse: jest.fn(),
    };

    const deposits = await extractDeposits(new BeinleumiPortfolioScraper({}), page);

    expect(deposits).toEqual([]);
    expect(page.waitForResponse).not.toHaveBeenCalled();
  });

  test('degrades to an empty array when the deposits response never arrives', async () => {
    const page: MockDepositsPage = {
      evaluate: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(undefined),
      waitForResponse: jest.fn().mockRejectedValue(new Error('timeout')),
    };

    const deposits = await extractDeposits(new BeinleumiPortfolioScraper({}), page);

    expect(deposits).toEqual([]);
  });

  test('returns an empty array when the account has no deposits', async () => {
    const page: MockDepositsPage = {
      evaluate: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(undefined),
      waitForResponse: jest.fn().mockResolvedValue(mockDepositsResponse({ outNoData: {} })),
    };

    const deposits = await extractDeposits(new BeinleumiPortfolioScraper({}), page);

    expect(deposits).toEqual([]);
  });
});
