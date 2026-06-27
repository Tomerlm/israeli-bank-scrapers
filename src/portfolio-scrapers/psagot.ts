import { type Page } from 'puppeteer';
import { BasePortfolioScraper } from './base-portfolio-scraper';
import type { PortfolioCash, PortfolioPosition } from './interface';

const LOGIN_URL = 'https://trade.psagot.co.il/';

// Selectors verified against live portal 2026-06-27 (Flutter web app — requires accessibility mode)
const SEL = {
  username: 'input[aria-label="Username required"]',
  password: 'input[aria-label="Password required"]',
  termsCheckbox: 'flt-semantics[role="checkbox"]',
  // OTP and holdings selectors below are placeholders — verify after first live login
  otpInput: 'input[aria-label*="OTP"], input[aria-label*="code"], input[aria-label*="קוד"]',
} as const;

async function enableA11y(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.querySelector('flt-semantics-placeholder') as HTMLElement | null;
    if (el) el.click();
  });
}

async function waitForFlutterInput(page: Page, selector: string): Promise<void> {
  await page.waitForFunction(
    (sel: string) => document.querySelector(sel) !== null,
    { timeout: 30_000 },
    selector,
  );
}

async function flutterClick(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) el.click();
  }, selector);
}

async function flutterClickByText(page: Page, text: string): Promise<void> {
  await page.evaluate((t: string) => {
    const el = Array.from(document.querySelectorAll('flt-semantics[role="button"]')).find(
      (node) => node.textContent?.trim() === t,
    ) as HTMLElement | null;
    if (el) el.click();
  }, text);
}

export class PsagotScraper extends BasePortfolioScraper {
  protected async fetchPortfolio(
    page: Page,
    credentials: Record<string, unknown>,
  ): Promise<{ positions: PortfolioPosition[]; cash: PortfolioCash[]; asOfDate: string }> {
    const username = String(credentials['username'] ?? '');
    const password = String(credentials['password'] ?? '');
    const otpCodeRetriever = credentials['otpCodeRetriever'] as (() => Promise<string>) | undefined;

    // 1. Navigate and enable Flutter accessibility
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle2' });
    await enableA11y(page);
    await waitForFlutterInput(page, SEL.username);

    // 2. Fill credentials
    await page.type(SEL.username, username);
    await page.type(SEL.password, password);

    // 3. Check "I agree to terms of use" checkbox (required before login button enables)
    await flutterClick(page, SEL.termsCheckbox);

    // 4. Wait for login button to enable, then click
    await page.waitForFunction(
      () => {
        const btn = Array.from(document.querySelectorAll('flt-semantics[role="button"]')).find(
          (el) => el.textContent?.trim() === 'Login',
        );
        return btn != null && btn.getAttribute('aria-disabled') !== 'true';
      },
      { timeout: 10_000 },
    );
    await flutterClickByText(page, 'Login');

    // 5. Handle OTP challenge
    if (otpCodeRetriever) {
      // Wait for OTP input to appear after login
      // TODO: verify exact aria-label of OTP input after first live login
      const otpInputHandle = await page.waitForSelector(SEL.otpInput, { timeout: 60_000 });
      if (otpInputHandle) {
        const code = await otpCodeRetriever();
        await page.type(SEL.otpInput, code);
        // TODO: verify OTP confirm button text/selector after first live login
        await flutterClickByText(page, 'אשר');
      }
    }

    // 6. Wait for post-login page to settle
    // TODO: replace condition with a reliable post-login selector after live testing
    await page.waitForFunction(
      () => (document.querySelector('flt-semantics-placeholder') === null),
      { timeout: 60_000 },
    );

    // 7. Extract positions
    // TODO: replace with real selectors discovered from the live holdings page
    const positions: PortfolioPosition[] = await page.evaluate(() => {
      return [] as PortfolioPosition[];
    });

    // 8. Extract cash balances
    const cash: PortfolioCash[] = await page.evaluate(() => {
      return [] as PortfolioCash[];
    });

    const asOfDate = new Date().toISOString().slice(0, 10);
    return { positions, cash, asOfDate };
  }
}
