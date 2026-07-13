import { type Page } from 'puppeteer';
import { BasePensionScraper } from './base-pension-scraper';
import type { PensionHoldingOutput } from './interface';

const LOGIN_URL = 'https://auth.swiftness.co.il/login';
const SAVER_HOST = 'savernew.swiftness.co.il';
const API_MARKER = 'getSavingProductsDetails';

const MARK_ID_INPUT = 'ibs-swiftness-id';
const MARK_PHONE_INPUT = 'ibs-swiftness-phone';
const MARK_OTP_PREFIX = 'ibs-swiftness-otp';

// ── normalizeHolding & helpers (pure, unit-testable) ──────────────────────

function strVal(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return fallback;
}

function numVal(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const COVERAGE_FIELDS = [
  'lossWorkingCapacityMonthly',
  'accumulatedMateSurvivalPension',
  'accumulatedChildSurvivalPension',
  'accumulatedParentSurvivalPension',
  'deathInsuranceAmountMonthly',
  'deathInsuranceAmountOnce',
] as const;

function buildCoverage(p: Record<string, unknown>): Record<string, unknown> | null {
  const coverage: Record<string, unknown> = {};
  for (const key of COVERAGE_FIELDS) {
    const n = numOrNull(p[key]);
    if (n !== null && n !== 0) coverage[key] = n;
  }
  return Object.keys(coverage).length > 0 ? coverage : null;
}

function monthlyDeposit(employee: unknown, employer: unknown): number | null {
  const empAbsent = employee === null || employee === undefined || employee === '';
  const erAbsent = employer === null || employer === undefined || employer === '';
  if (empAbsent && erAbsent) return null;
  return numVal(employee) + numVal(employer);
}

/**
 * Maps a single `savingProductsDetails[i]` object (from the Swiftness
 * `getSavingProductsDetails` API) to findash's `PensionHoldingInput` shape.
 * See docs/superpowers/specs/2026-07-13-swiftness-api-discovery.md for the field mapping.
 *
 * `track` (investment track) has no clean field in this API response — first cut sends ''.
 */
export function normalizeHolding(p: Record<string, unknown>): PensionHoldingOutput {
  return {
    productType: strVal(p['productTypeName']),
    managingCompany: strVal(p['manufacturerName']),
    policyNumber: strVal(p['policyNumber']),
    balanceIls: numVal(p['accumulatedBalance']),
    feeFromBalancePct: numVal(p['yealryManagementFeePercentAggregation']),
    feeFromDepositPct: numVal(p['yealryManagementFeePercentDeposit']),
    track: '',
    status: strVal(p['policyStatusName']),
    yieldPct: numOrNull(p['netYieldPercent']),
    monthlyDepositIls: monthlyDeposit(p['depositAmountEmployee'], p['depositAmountEmployer']),
    projectedPensionIls: numOrNull(p['accumulatedOldAgePension']),
    coverage: buildCoverage(p),
  };
}

// ── DOM helpers ─────────────────────────────────────────────────────────
// The auth.swiftness.co.il / savernew.swiftness.co.il portal has no known stable
// selectors, so inputs/buttons are located by label/placeholder text (falling back to
// input order) and "marked" with a data attribute that a subsequent page.type() targets.
// This keeps real key events (needed for Angular-style reactive forms) while remaining
// mockable in tests.

async function clickButtonByText(page: Page, text: string): Promise<boolean> {
  return page.evaluate(function clickButtonByTextInPage(t: string) {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === t);
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }, text);
}

async function markInputByLabel(page: Page, labelText: string, mark: string, fallbackIndex: number): Promise<boolean> {
  return page.evaluate(
    function markInputByLabelInPage(text: string, markAttr: string, nth: number) {
      const inputs = Array.from(document.querySelectorAll('input'));
      let el: HTMLInputElement | undefined =
        inputs.find(i => (i.getAttribute('aria-label') ?? '').includes(text)) ??
        inputs.find(i => (i.getAttribute('placeholder') ?? '').includes(text));
      if (!el) {
        const label = Array.from(document.querySelectorAll('label')).find(l => l.textContent?.includes(text));
        if (label) {
          const forId = label.getAttribute('for');
          if (forId) {
            const byId = document.getElementById(forId);
            if (byId instanceof HTMLInputElement) el = byId;
          }
          if (!el) {
            const nested = label.querySelector('input');
            if (nested) el = nested;
          }
          if (!el) {
            const sibling = label.parentElement?.querySelector('input');
            if (sibling) el = sibling;
          }
        }
      }
      if (!el) el = inputs[nth];
      if (!el) return false;
      el.setAttribute('data-ibs-mark', markAttr);
      return true;
    },
    labelText,
    mark,
    fallbackIndex,
  );
}

async function fillIdAndPhone(page: Page, id: string, phone: string): Promise<void> {
  await page.waitForFunction(
    function inputsReady() {
      return document.querySelectorAll('input').length >= 1;
    },
    { timeout: 30_000 },
  );
  const idMarked = await markInputByLabel(page, 'מספר תעודת זהות', MARK_ID_INPUT, 0);
  const phoneMarked = await markInputByLabel(page, 'מספר נייד', MARK_PHONE_INPUT, 1);
  if (!idMarked || !phoneMarked) {
    throw new Error('Swiftness login: could not locate ID/phone inputs');
  }
  await page.type(`input[data-ibs-mark="${MARK_ID_INPUT}"]`, id);
  await page.type(`input[data-ibs-mark="${MARK_PHONE_INPUT}"]`, phone);
}

async function markOtpInputs(page: Page, markPrefix: string): Promise<number> {
  return page.evaluate(function markOtpInputsInPage(prefix: string) {
    let candidates: Element[] = Array.from(document.querySelectorAll('input[maxlength="1"]'));
    if (candidates.length < 6) {
      candidates = Array.from(document.querySelectorAll('input'));
    }
    candidates.slice(0, 6).forEach((el, i) => el.setAttribute('data-ibs-mark', `${prefix}-${i}`));
    return Math.min(candidates.length, 6);
  }, markPrefix);
}

async function readSwiftnessKey(page: Page): Promise<string | null> {
  return page.evaluate(function readSwiftnessKeyFromStorage() {
    return localStorage.getItem('cachedSwiftnessKey');
  });
}

export class SwiftnessPensionScraper extends BasePensionScraper {
  protected async fetchPension(
    page: Page,
    credentials: Record<string, unknown>,
  ): Promise<{ holdings: PensionHoldingOutput[]; asOfDate: string }> {
    const id = typeof credentials['id'] === 'string' ? credentials['id'] : '';
    const phone = typeof credentials['phone'] === 'string' ? credentials['phone'] : '';
    const otpChannel = credentials['otpChannel'] === 'email' ? 'email' : 'sms';
    const otpCodeRetriever = credentials['otpCodeRetriever'] as (() => Promise<string>) | undefined;

    // ── Interceptor: the getSavingProductsDetails API response ───────────
    let capturedProducts: unknown[] | undefined;
    page.on('response', response => {
      const url = response.url();
      if (!url.includes(API_MARKER)) return;
      void response
        .json()
        .then((body: unknown) => {
          const arr = (body as { savingProductsDetails?: unknown[] })?.savingProductsDetails;
          if (Array.isArray(arr)) capturedProducts = arr;
        })
        .catch(() => undefined);
    });

    // ── 1. Login ───────────────────────────────────────────────────────
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle2', timeout: 60_000 });
    // eslint-disable-next-line no-console
    console.log('[swiftness-scraper] login page loaded');

    const toggleText = otpChannel === 'email' ? 'מייל' : 'סמס';
    await clickButtonByText(page, toggleText);

    await fillIdAndPhone(page, id, phone);

    await page
      .waitForFunction(
        function continueEnabled() {
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'המשך');
          return !!btn && !btn.disabled;
        },
        { timeout: 15_000 },
      )
      .catch(() => undefined);
    await clickButtonByText(page, 'המשך');
    // eslint-disable-next-line no-console
    console.log('[swiftness-scraper] submitted id/phone, channel:', otpChannel);

    // ── 2. OTP (optional) ─────────────────────────────────────────────
    const otpAppeared = await page
      .waitForFunction(
        function otpReady() {
          return (
            document.querySelectorAll('input[maxlength="1"]').length >= 6 ||
            document.querySelectorAll('input').length >= 6
          );
        },
        { timeout: 20_000 },
      )
      .then(() => true)
      .catch(() => false);

    if (otpAppeared && otpCodeRetriever) {
      // eslint-disable-next-line no-console
      console.log('[swiftness-scraper] OTP required');
      const count = await markOtpInputs(page, MARK_OTP_PREFIX);
      if (count >= 6) {
        const code = await otpCodeRetriever();
        for (let i = 0; i < 6; i++) {
          await page.type(`input[data-ibs-mark="${MARK_OTP_PREFIX}-${i}"]`, code[i] ?? '');
        }
      }
    }

    // ── 3. Wait for redirect to the saver desktop ─────────────────────
    await page.waitForFunction(
      function onSaverDomain(host: string) {
        return location.hostname.includes(host);
      },
      { timeout: 60_000 },
      SAVER_HOST,
    );
    // eslint-disable-next-line no-console
    console.log('[swiftness-scraper] logged in, redirected to savernew');

    // ── 4. Resolve swiftnessKey and reach the holdings page ────────────
    let swiftnessKey = await readSwiftnessKey(page);
    if (!swiftnessKey) {
      // eslint-disable-next-line no-console
      console.log('[swiftness-scraper] no cached swiftnessKey, clicking completed-request button');
      await clickButtonByText(page, 'התקבל מידע מלא');
      await page
        .waitForFunction(
          function swiftnessKeyInUrl() {
            return location.href.includes('swiftnessKey=');
          },
          { timeout: 30_000 },
        )
        .catch(() => undefined);
      const match = /swiftnessKey=([^&]+)/.exec(page.url());
      swiftnessKey = match ? match[1] : null;
    }
    if (!swiftnessKey) {
      throw new Error('Swiftness: could not resolve swiftnessKey after login');
    }

    await page.goto(`https://${SAVER_HOST}/holdings/myProducts?swiftnessKey=${swiftnessKey}&eventType=9100`, {
      waitUntil: 'networkidle2',
      timeout: 60_000,
    });

    // ── 5. Poll for the intercepted products response ──────────────────
    const products = await new Promise<unknown[]>((resolve, reject) => {
      const deadline = Date.now() + 30_000;
      const check = setInterval(() => {
        if (capturedProducts) {
          clearInterval(check);
          resolve(capturedProducts);
          return;
        }
        if (Date.now() > deadline) {
          clearInterval(check);
          reject(new Error('Swiftness: getSavingProductsDetails response not captured within 30s'));
        }
      }, 500);
    });
    // eslint-disable-next-line no-console
    console.log(`[swiftness-scraper] captured ${products.length} saving products`);

    // ── 6. Normalize (skip individually-bad rows rather than failing the whole scrape) ──
    const holdings: PensionHoldingOutput[] = [];
    for (const raw of products) {
      try {
        holdings.push(normalizeHolding(raw as Record<string, unknown>));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.log(
          '[swiftness-scraper] skipping unparsable product row:',
          e instanceof Error ? e.message : String(e),
        );
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[swiftness-scraper] done — ${holdings.length} holdings`);

    return { holdings, asOfDate: new Date().toISOString().slice(0, 10) };
  }
}
