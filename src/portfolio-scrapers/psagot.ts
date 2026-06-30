import { type Page } from 'puppeteer';
import { BasePortfolioScraper } from './base-portfolio-scraper';
import type { PortfolioCash, PortfolioPosition } from './interface';

const BASE_URL = 'https://trade1.psagot.co.il';
const LOGIN_URL = 'https://trade.psagot.co.il/';

const SEL = {
  username: 'input[aria-label="Username required"]',
  password: 'input[aria-label="Password required"]',
  termsCheckbox: 'flt-semantics[role="checkbox"]',
} as const;

async function waitForElement(page: Page, selector: string, timeout = 60_000): Promise<void> {
  await page.waitForFunction((sel: string) => document.querySelector(sel) !== null, { timeout }, selector);
}

async function enableA11y(page: Page): Promise<void> {
  await waitForElement(page, 'flt-semantics-placeholder', 30_000);
  await page.evaluate(() => {
    const el = document.querySelector('flt-semantics-placeholder');
    if (el instanceof HTMLElement) el.click();
  });
}

async function flutterClickByText(page: Page, text: string): Promise<void> {
  await page.evaluate((t: string) => {
    const el = Array.from(document.querySelectorAll('flt-semantics[role="button"]')).find(
      node => node.textContent?.trim() === t,
    ) as HTMLElement | null;
    if (el) el.click();
  }, text);
}

// Runs a fetch from inside the browser (so session cookies are automatically included).
async function apiFetch(page: Page, url: string): Promise<unknown> {
  return page.evaluate(async (u: string) => {
    const res = await fetch(u, { credentials: 'include' });
    return res.json() as unknown;
  }, url);
}

export class PsagotScraper extends BasePortfolioScraper {
  protected async fetchPortfolio(
    page: Page,
    credentials: Record<string, unknown>,
  ): Promise<{ positions: PortfolioPosition[]; cash: PortfolioCash[]; asOfDate: string }> {
    const username = typeof credentials['username'] === 'string' ? credentials['username'] : '';
    const password = typeof credentials['password'] === 'string' ? credentials['password'] : '';
    const otpCodeRetriever = credentials['otpCodeRetriever'] as (() => Promise<string>) | undefined;

    // ── 1. Boot Flutter ──────────────────────────────────────────────────────────
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    );
    await page.goto(LOGIN_URL, { waitUntil: 'load', timeout: 120_000 });
    await waitForElement(page, 'flt-glass-pane', 120_000);
    // eslint-disable-next-line no-console
    console.log('[psagot-scraper] Flutter initialized');

    // ── 2. Login ─────────────────────────────────────────────────────────────────
    await enableA11y(page);
    await waitForElement(page, SEL.username, 30_000);
    await page.type(SEL.username, username);
    await page.type(SEL.password, password);

    await page.evaluate(() => {
      const cb = document.querySelector('flt-semantics[role="checkbox"]');
      if (cb instanceof HTMLElement) cb.click();
    });
    await page.waitForFunction(
      () => document.querySelector('flt-semantics[role="checkbox"]')?.getAttribute('aria-checked') === 'true',
      { timeout: 10_000 },
    );
    await page.waitForFunction(
      () => {
        const btn = Array.from(document.querySelectorAll('flt-semantics[role="button"]')).find(
          el => el.textContent?.trim() === 'Login',
        );
        return btn != null && btn.getAttribute('aria-disabled') !== 'true';
      },
      { timeout: 30_000 },
    );
    await flutterClickByText(page, 'Login');
    await page.waitForFunction(() => !document.querySelector('input[aria-label="Username required"]'), {
      timeout: 60_000,
    });

    // ── 3. OTP (optional) ────────────────────────────────────────────────────────
    const otpInputAppeared = await page
      .waitForFunction(() => document.querySelectorAll('input').length > 0, { timeout: 10_000 })
      .then(() => true)
      .catch(() => false);

    if (otpInputAppeared && otpCodeRetriever) {
      const inputs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('input')).map(el => el.getAttribute('aria-label')),
      );
      const otpAriaLabel = inputs[0] ?? '';
      if (otpAriaLabel) {
        // eslint-disable-next-line no-console
        console.log('[psagot-scraper] OTP required');
        const code = await otpCodeRetriever();
        await page.type(`input[aria-label="${otpAriaLabel}"]`, code);
        await page.waitForFunction(
          () => {
            const btn = Array.from(document.querySelectorAll('flt-semantics[role="button"]')).find(
              el => el.textContent?.trim() === 'Login',
            );
            return btn != null && btn.getAttribute('aria-disabled') !== 'true';
          },
          { timeout: 30_000 },
        );
        await flutterClickByText(page, 'Login');
      }
    }

    // ── 4. Wait for portfolio page ────────────────────────────────────────────────
    await page.waitForFunction(() => !location.href.includes('/login') && !location.href.endsWith('/'), {
      timeout: 60_000,
    });
    // eslint-disable-next-line no-console
    console.log('[psagot-scraper] navigated to:', await page.evaluate(() => location.href));

    // ── 5. Fetch accounts ─────────────────────────────────────────────────────────
    const accountsRes = (await apiFetch(page, `${BASE_URL}/V2/json/accounts?catalog=unified`)) as {
      UserAccounts?: { UserAccount?: Array<{ '-key': string }> | { '-key': string } };
    };
    const rawAccounts = accountsRes?.UserAccounts?.UserAccount;
    const accountIds = (Array.isArray(rawAccounts) ? rawAccounts : rawAccounts ? [rawAccounts] : []).map(
      a => a['-key'],
    );
    // eslint-disable-next-line no-console
    console.log('[psagot-scraper] accounts:', accountIds);

    // ── 6. Fetch balances for each account (contains positions + cash) ────────────
    const allPositions: PortfolioPosition[] = [];
    let totalCashIls = 0;

    for (const accountId of accountIds) {
      const balancesRes = await apiFetch(
        page,
        `${BASE_URL}/V2/json2/account/view/balances?account=${accountId}&fields=hebName&currency=ils&catalog=unified`,
      );
      // eslint-disable-next-line no-console
      console.log(`[psagot-scraper] balances ${accountId}:`, JSON.stringify(balancesRes));

      const account = (balancesRes as { View?: { Account?: Record<string, unknown> } })?.View?.Account;
      if (!account) continue;

      // Cash
      const cash = Number(account['OnlineCash'] ?? account['MorningCash'] ?? 0);
      totalCashIls += cash;

      // Positions — look for a Portfolio or Securities sub-object
      const portfolioSection =
        account['Portfolio'] ?? account['Securities'] ?? account['Positions'] ?? account['Holdings'];
      // eslint-disable-next-line no-console
      console.log(`[psagot-scraper] portfolio section for ${accountId}:`, JSON.stringify(portfolioSection));

      const rawSecurities = (() => {
        if (!portfolioSection) return [];
        if (Array.isArray(portfolioSection)) return portfolioSection as Record<string, unknown>[];
        const inner =
          (portfolioSection as Record<string, unknown>)['Security'] ??
          (portfolioSection as Record<string, unknown>)['Position'];
        if (Array.isArray(inner)) return inner as Record<string, unknown>[];
        if (inner && typeof inner === 'object') return [inner as Record<string, unknown>];
        return [];
      })();

      // eslint-disable-next-line no-console
      console.log(`[psagot-scraper] account ${accountId}: ${rawSecurities.length} raw securities`);

      for (const sec of rawSecurities) {
        const strVal = (...keys: string[]): string => {
          for (const k of keys) {
            const v = sec[k];
            if (typeof v === 'string') return v;
            if (typeof v === 'number') return String(v);
          }
          return '';
        };
        const secId = strVal('-Key', 'Key', 'SecurityId', 'EquityNum');
        const name = strVal('HebName', 'EngName', 'Name') || secId;
        const qty = Number(sec['Quantity'] ?? sec['qty'] ?? sec['Amount'] ?? 0);
        const price = Number(sec['Rate'] ?? sec['Price'] ?? sec['LastRate'] ?? 0);
        const avgCost = Number(sec['AvgCost'] ?? sec['AverageCost'] ?? sec['avgRate'] ?? 0);
        const pnl = Number(sec['ProfitLoss'] ?? sec['UnrealizedPnl'] ?? 0);
        if (qty === 0) continue;
        allPositions.push({
          identifier: `psagot-${secId}`,
          name: `${name} (${accountId})`,
          quantity: qty,
          price,
          avgCost,
          unrealizedPnl: pnl,
          currency: 'ILS',
        });
      }
    }

    // eslint-disable-next-line no-console
    console.log(`[psagot-scraper] done — ${allPositions.length} positions, cash ${totalCashIls} ILS`);

    const cash: PortfolioCash[] = totalCashIls > 0 ? [{ currency: 'ILS', amount: totalCashIls }] : [];
    const asOfDate = new Date().toISOString().slice(0, 10);
    return { positions: allPositions, cash, asOfDate };
  }
}
