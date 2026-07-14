import { type Page } from 'puppeteer';
import { normalizeHolding, SwiftnessPensionScraper } from './swiftness';

// Values from docs/superpowers/specs/2026-07-13-swiftness-api-discovery.md's live-captured example.
const SAMPLE_PRODUCT: Record<string, unknown> = {
  productTypeName: 'פנסיה חדשה מקיפה',
  manufacturerName: 'הראל פנסיה וגמל בע"מ',
  policyNumber: 123456,
  policyStatusName: 'פעיל',
  accumulatedBalance: 538136.48,
  yealryManagementFeePercentAggregation: 0.05,
  yealryManagementFeePercentDeposit: 1.5,
  netYieldPercent: 2.83,
  accumulatedOldAgePension: 29581.93,
  // Decoy: the lower current-accrued forecast — must NOT be used for projectedPensionIls.
  monthlyOldAgePensionForecast: 11508,
  depositAmountEmployee: 1626,
  depositAmountEmployer: 4020,
  lossWorkingCapacityMonthly: 5000,
  accumulatedMateSurvivalPension: 0,
  accumulatedChildSurvivalPension: null,
  deathInsuranceAmountMonthly: 0,
  deathInsuranceAmountOnce: 250000,
};

describe('normalizeHolding', () => {
  test('maps the full field set per the discovery-doc spec', () => {
    const result = normalizeHolding(SAMPLE_PRODUCT);

    expect(result).toEqual({
      productType: 'פנסיה חדשה מקיפה',
      managingCompany: 'הראל פנסיה וגמל בע"מ',
      policyNumber: '123456',
      balanceIls: 538136.48,
      feeFromBalancePct: 0.05,
      feeFromDepositPct: 1.5,
      track: '',
      status: 'פעיל',
      yieldPct: 2.83,
      monthlyDepositIls: 5646, // 1626 + 4020
      projectedPensionIls: 29581.93, // accumulatedOldAgePension, NOT monthlyOldAgePensionForecast (11508)
      coverage: {
        lossWorkingCapacityMonthly: 5000,
        deathInsuranceAmountOnce: 250000,
      },
    });
  });

  test('optional numeric fields default to null when missing, null, or empty string', () => {
    const result = normalizeHolding({
      productTypeName: 'קרן השתלמות',
      manufacturerName: 'מגדל מקפת קרנות פנסיה וקופות גמל בע"מ',
      policyNumber: '9',
      policyStatusName: 'פעיל',
      accumulatedBalance: 1000,
      yealryManagementFeePercentAggregation: 0.5,
      yealryManagementFeePercentDeposit: 0,
      netYieldPercent: null,
      accumulatedOldAgePension: '',
      // depositAmountEmployee / depositAmountEmployer intentionally absent
    });

    expect(result.yieldPct).toBeNull();
    expect(result.projectedPensionIls).toBeNull();
    expect(result.monthlyDepositIls).toBeNull();
    expect(result.coverage).toBeNull();
    expect(result.track).toBe('');
  });

  test('monthlyDepositIls sums when only one of employee/employer deposit is present', () => {
    const result = normalizeHolding({
      ...SAMPLE_PRODUCT,
      depositAmountEmployee: 500,
      depositAmountEmployer: null,
    });

    expect(result.monthlyDepositIls).toBe(500);
  });

  test('coverage aggregates only the non-null, non-zero coverage fields', () => {
    const result = normalizeHolding({
      ...SAMPLE_PRODUCT,
      lossWorkingCapacityMonthly: 0,
      accumulatedMateSurvivalPension: 1200,
      accumulatedChildSurvivalPension: 300,
      accumulatedParentSurvivalPension: 0,
      deathInsuranceAmountMonthly: null,
      deathInsuranceAmountOnce: 0,
    });

    expect(result.coverage).toEqual({
      accumulatedMateSurvivalPension: 1200,
      accumulatedChildSurvivalPension: 300,
    });
  });

  test('policyNumber is coerced to a string', () => {
    const result = normalizeHolding({ ...SAMPLE_PRODUCT, policyNumber: 987654 });
    expect(result.policyNumber).toBe('987654');
  });
});

// ── Flow test: mocked Puppeteer Page ────────────────────────────────────

const MOCK_SWIFTNESS_KEY = 'mock-swiftness-key-1234';

const MOCK_PRODUCTS_RESPONSE = {
  savingProductsDetails: [SAMPLE_PRODUCT],
};

type MockPage = {
  on: jest.Mock;
  goto: jest.Mock;
  evaluate: jest.Mock;
  waitForFunction: jest.Mock;
  type: jest.Mock;
  url: jest.Mock;
};

function makeMockPage(): MockPage {
  return {
    on: jest.fn().mockImplementation((event: string, handler: (r: unknown) => void) => {
      if (event === 'response') {
        // Call synchronously so the .then(capturedProducts = ...) microtask is queued
        // before the polling loop's first tick, mirroring psagot.test.ts's approach.
        handler({
          url: () => 'https://portalapi.swiftness.co.il/api/holdings/getSavingProductsDetails',
          json: () => Promise.resolve(MOCK_PRODUCTS_RESPONSE),
        });
      }
    }),
    goto: jest.fn().mockResolvedValue(null),
    evaluate: jest.fn().mockImplementation((fn: { name: string }) => {
      switch (fn.name) {
        case 'clickButtonByTextInPage':
          return true;
        case 'markInputByLabelInPage':
          return true;
        case 'markOtpInputsInPage':
          return 6;
        case 'readSwiftnessKeyFromStorage':
          // Simulates an already-cached swiftnessKey, bypassing the
          // "click התקבל מידע מלא" fallback branch (unverified without a live login).
          return MOCK_SWIFTNESS_KEY;
        default:
          return undefined;
      }
    }),
    waitForFunction: jest.fn().mockResolvedValue(null),
    type: jest.fn().mockResolvedValue(null),
    url: jest.fn().mockReturnValue(`https://savernew.swiftness.co.il/?swiftnessKey=${MOCK_SWIFTNESS_KEY}`),
  };
}

type FetchPension = (p: Page, c: Record<string, unknown>) => Promise<{ holdings: unknown[]; asOfDate: string }>;

function fetchPension(scraper: SwiftnessPensionScraper, page: MockPage, credentials: Record<string, unknown>) {
  return (scraper as unknown as { fetchPension: FetchPension }).fetchPension(
    page as unknown as Page,
    credentials,
  );
}

describe('SwiftnessPensionScraper', () => {
  test('fills id and phone via marked inputs', async () => {
    const mockPage = makeMockPage();
    const scraper = new SwiftnessPensionScraper({});
    await fetchPension(scraper, mockPage, { id: '123456789', phone: '0501234567', otpChannel: 'sms' });

    expect(mockPage.type).toHaveBeenCalledWith(expect.stringContaining('ibs-swiftness-id'), '123456789');
    expect(mockPage.type).toHaveBeenCalledWith(expect.stringContaining('ibs-swiftness-phone'), '0501234567');
  });

  test('calls otpCodeRetriever once when provided and types the 6 digits', async () => {
    const mockOtpRetriever = jest.fn().mockResolvedValue('654321');
    const mockPage = makeMockPage();
    const scraper = new SwiftnessPensionScraper({});
    await fetchPension(scraper, mockPage, {
      id: '123456789',
      phone: '0501234567',
      otpChannel: 'sms',
      otpCodeRetriever: mockOtpRetriever,
    });

    expect(mockOtpRetriever).toHaveBeenCalledTimes(1);
    const digits = '654321';
    for (let i = 0; i < 6; i++) {
      expect(mockPage.type).toHaveBeenCalledWith(expect.stringContaining(`ibs-swiftness-otp-${i}`), digits[i]);
    }
  });

  test('skips OTP flow when otpCodeRetriever is not provided', async () => {
    const mockPage = makeMockPage();
    const scraper = new SwiftnessPensionScraper({});
    await expect(
      fetchPension(scraper, mockPage, { id: '1', phone: '2', otpChannel: 'sms' }),
    ).resolves.not.toThrow();
  });

  test('parses an intercepted getSavingProductsDetails response into holdings', async () => {
    const mockPage = makeMockPage();
    const scraper = new SwiftnessPensionScraper({});
    const result = await fetchPension(scraper, mockPage, {
      id: '123456789',
      phone: '0501234567',
      otpChannel: 'sms',
    });

    expect(result.asOfDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0]).toMatchObject({
      productType: 'פנסיה חדשה מקיפה',
      managingCompany: 'הראל פנסיה וגמל בע"מ',
      policyNumber: '123456',
      balanceIls: 538136.48,
    });
  });
});
