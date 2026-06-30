import { type Page } from 'puppeteer';
import { BasePortfolioScraper } from './base-portfolio-scraper';
import type { PortfolioCash, PortfolioPosition } from './interface';

const BASE_URL = 'https://trade1.psagot.co.il';
const LOGIN_URL = 'https://trade.psagot.co.il/';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const SEL = {
  username: 'input[aria-label="Username required"]',
  password: 'input[aria-label="Password required"]',
} as const;

async function waitForElement(page: Page, selector: string, timeout = 60_000): Promise<void> {
  await page.waitForFunction((sel: string) => document.querySelector(sel) !== null, { timeout }, selector);
}

async function flutterClickByText(page: Page, text: string): Promise<void> {
  await page.evaluate((t: string) => {
    const el = Array.from(document.querySelectorAll('flt-semantics[role="button"]')).find(
      node => node.textContent?.trim() === t,
    ) as HTMLElement | null;
    if (el) el.click();
  }, text);
}

function strVal(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return fallback;
}

async function apiFetch(page: Page, sessionKey: string, url: string): Promise<unknown> {
  return page.evaluate(
    async (targetUrl: string, key: string) => {
      const res = await fetch(targetUrl, {
        headers: { session: key, csession: String(Math.random()) },
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${targetUrl}`);
      return res.json();
    },
    url,
    sessionKey,
  );
}

export class PsagotScraper extends BasePortfolioScraper {
  protected async fetchPortfolio(
    page: Page,
    credentials: Record<string, unknown>,
  ): Promise<{ positions: PortfolioPosition[]; cash: PortfolioCash[]; asOfDate: string }> {
    const username = typeof credentials['username'] === 'string' ? credentials['username'] : '';
    const password = typeof credentials['password'] === 'string' ? credentials['password'] : '';
    const otpCodeRetriever = credentials['otpCodeRetriever'] as (() => Promise<string>) | undefined;

    // ── 1. Set up login response interceptor to capture SessionKey ────────────
    let sessionKey = '';
    page.on('response', response => {
      if (!response.url().includes('/login')) return;
      void response
        .json()
        .then((body: unknown) => {
          const key = (body as { Login?: { SessionKey?: string } })?.Login?.SessionKey;
          if (key) sessionKey = key;
        })
        .catch(() => undefined);
    });

    // ── 2. Boot Flutter ───────────────────────────────────────────────────────
    await page.setUserAgent(USER_AGENT);
    await page.goto(LOGIN_URL, { waitUntil: 'load', timeout: 120_000 });
    await waitForElement(page, 'flt-glass-pane', 120_000);
    // eslint-disable-next-line no-console
    console.log('[psagot-scraper] Flutter initialized');

    // ── 3. Login ──────────────────────────────────────────────────────────────
    await waitForElement(page, 'flt-semantics-placeholder', 30_000);
    await page.evaluate(() => {
      const el = document.querySelector('flt-semantics-placeholder');
      if (el instanceof HTMLElement) el.click();
    });
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

    // ── 4. OTP (optional) ─────────────────────────────────────────────────────
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

    // ── 5. Wait for post-login navigation ────────────────────────────────────
    await page.waitForFunction(() => !location.href.includes('/login') && !location.href.endsWith('/'), {
      timeout: 60_000,
    });
    // eslint-disable-next-line no-console
    console.log('[psagot-scraper] logged in, sessionKey captured:', sessionKey ? 'yes' : 'NO');

    if (!sessionKey) throw new Error('Psagot login succeeded but SessionKey was not captured from response');

    // ── 6. Fetch accounts ─────────────────────────────────────────────────────
    const accountsRes = (await apiFetch(page, sessionKey, `${BASE_URL}/V2/json/accounts?catalog=unified`)) as {
      UserAccounts?: { UserAccount?: Array<{ '-key': string }> | { '-key': string } };
    };
    const rawAccounts = accountsRes?.UserAccounts?.UserAccount;
    const accountIds = (Array.isArray(rawAccounts) ? rawAccounts : rawAccounts ? [rawAccounts] : []).map(
      a => a['-key'],
    );
    // eslint-disable-next-line no-console
    console.log('[psagot-scraper] accounts:', accountIds);

    // ── 7. Fetch balances for each account ────────────────────────────────────
    const allPositions: PortfolioPosition[] = [];
    let totalCashIls = 0;

    for (const accountId of accountIds) {
      const balancesRes = (await apiFetch(
        page,
        sessionKey,
        `${BASE_URL}/V2/json2/account/view/balances?account=${accountId}&fields=hebName&currency=ils&catalog=unified`,
      )) as {
        View?: {
          Account?: {
            OnlineCash?: number;
            AccountPosition?: { Balance?: Array<Record<string, unknown>> | Record<string, unknown> };
          };
          Meta?: { Security?: Array<{ '-Key': string; HebName?: string }> | { '-Key': string; HebName?: string } };
        };
      };

      const account = balancesRes?.View?.Account;
      if (!account) {
        // eslint-disable-next-line no-console
        console.log(`[psagot-scraper] no Account in balances response for ${accountId}`);
        continue;
      }

      totalCashIls += Number(account.OnlineCash ?? 0);

      // Build a map of security ID → name from Meta.Security
      const rawMeta = balancesRes?.View?.Meta?.Security;
      const metaSecurities = Array.isArray(rawMeta) ? rawMeta : rawMeta ? [rawMeta] : [];
      const nameById = new Map<string, string>(metaSecurities.map(s => [s['-Key'], s.HebName ?? '']));

      const rawBalances = account.AccountPosition?.Balance;
      const balances = Array.isArray(rawBalances) ? rawBalances : rawBalances ? [rawBalances] : [];
      // eslint-disable-next-line no-console
      console.log(`[psagot-scraper] account ${accountId}: ${balances.length} positions`);

      for (const b of balances) {
        const secId = strVal(b['EquityNumber']);
        const qty = Number(b['OnlineNV'] ?? 0);
        if (qty === 0) continue;
        // Prices are in agorot (1/100 ILS)
        const price = Number(b['LastRate'] ?? 0) / 100;
        const avgCost = Number(b['AveragePrice'] ?? 0) / 100;
        const pnl = Number(b['AveragePriceProfitLoss'] ?? 0);
        const currency = strVal(b['CurrencyCode'], 'ILS');
        const name = nameById.get(secId) || secId;

        allPositions.push({
          identifier: `psagot-${secId}`,
          name: `${name} (${accountId})`,
          quantity: qty,
          price,
          avgCost,
          unrealizedPnl: pnl,
          currency,
        });
      }
    }

    // eslint-disable-next-line no-console
    console.log(`[psagot-scraper] done — ${allPositions.length} positions, cash ${totalCashIls} ILS`);

    const cash: PortfolioCash[] = totalCashIls > 0 ? [{ currency: 'ILS', amount: totalCashIls }] : [];
    return { positions: allPositions, cash, asOfDate: new Date().toISOString().slice(0, 10) };
  }
}
