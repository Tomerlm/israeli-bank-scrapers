import { type Page } from 'puppeteer';
import { BasePortfolioScraper } from './base-portfolio-scraper';
import type { PortfolioCash, PortfolioPosition } from './interface';

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

// Heuristic: does this JSON body look like a portfolio holdings response?
// We look for an array of objects that each have a numeric quantity field.
function looksLikeHoldings(body: unknown): boolean {
  const candidates = [
    body,
    ...(typeof body === 'object' && body !== null ? Object.values(body as Record<string, unknown>) : []),
  ];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate) || candidate.length === 0) continue;
    const first = candidate[0] as Record<string, unknown>;
    if (
      typeof first === 'object' &&
      first !== null &&
      Object.keys(first).some(k => /qty|quantity|amount|units|shares/i.test(k))
    ) {
      return true;
    }
  }
  return false;
}

export class PsagotScraper extends BasePortfolioScraper {
  protected async fetchPortfolio(
    page: Page,
    credentials: Record<string, unknown>,
  ): Promise<{ positions: PortfolioPosition[]; cash: PortfolioCash[]; asOfDate: string }> {
    const username = typeof credentials['username'] === 'string' ? credentials['username'] : '';
    const password = typeof credentials['password'] === 'string' ? credentials['password'] : '';
    const otpCodeRetriever = credentials['otpCodeRetriever'] as (() => Promise<string>) | undefined;

    // Capture all JSON API responses made by the Flutter app after login.
    const capturedApis: Array<{ url: string; body: unknown }> = [];
    page.on('response', response => {
      const ct = response.headers()['content-type'] ?? '';
      if (!ct.includes('json')) return;
      void response
        .json()
        .then((body: unknown) => capturedApis.push({ url: response.url(), body }))
        .catch(() => undefined);
    });

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

    // ── 4. Wait for portfolio page + let API calls settle ────────────────────────
    await page.waitForFunction(() => !location.href.includes('/login') && !location.href.endsWith('/'), {
      timeout: 60_000,
    });
    // eslint-disable-next-line no-console
    console.log('[psagot-scraper] navigated to:', await page.evaluate(() => location.href));

    // Give the Flutter app time to load portfolio data from its backend APIs
    await new Promise(r => setTimeout(r, 4_000));

    // ── 5. Extract data from captured API responses ───────────────────────────────
    // eslint-disable-next-line no-console
    console.log('[psagot-scraper] captured API responses:', capturedApis.length);
    for (const api of capturedApis) {
      // eslint-disable-next-line no-console
      console.log(`[psagot-scraper] API ${api.url} → ${JSON.stringify(api.body).slice(0, 300)}`);
    }

    // Find the holdings response: an array of objects with quantity-like fields.
    const holdingsApi = capturedApis.find(r => looksLikeHoldings(r.body));
    if (!holdingsApi) {
      // Log all response URLs so we can identify the right one manually
      const urls = capturedApis.map(r => r.url).join('\n  ');
      throw new Error(
        `[psagot-scraper] Could not detect portfolio holdings in captured API responses.\nCaptured URLs:\n  ${urls}`,
      );
    }

    // eslint-disable-next-line no-console
    console.log('[psagot-scraper] holdings API:', holdingsApi.url);
    // eslint-disable-next-line no-console
    console.log('[psagot-scraper] holdings body:', JSON.stringify(holdingsApi.body).slice(0, 600));

    // ── 6. Map holdings → PortfolioPosition[] ────────────────────────────────────
    // Extract the array from the response (handles both top-level array and wrapped {data:[...]})
    const rawRows: Record<string, unknown>[] = (() => {
      const body = holdingsApi.body;
      if (Array.isArray(body)) return body as Record<string, unknown>[];
      if (typeof body === 'object' && body !== null) {
        for (const v of Object.values(body as Record<string, unknown>)) {
          if (Array.isArray(v)) return v as Record<string, unknown>[];
        }
      }
      return [];
    })();

    // eslint-disable-next-line no-console
    console.log('[psagot-scraper] position rows:', rawRows.length);
    if (rawRows.length > 0) {
      // eslint-disable-next-line no-console
      console.log('[psagot-scraper] first row keys:', Object.keys(rawRows[0] ?? {}).join(', '));
    }

    function strField(row: Record<string, unknown>, ...keys: string[]): string {
      for (const k of keys) {
        const v = row[k];
        if (typeof v === 'string') return v;
        if (typeof v === 'number') return String(v);
      }
      return '';
    }
    const positions: PortfolioPosition[] = rawRows
      .map(row => {
        // Field names are discovered from the first log run — update these after seeing the actual keys.
        const secId = strField(row, 'securityId', 'SecurityId', 'security_id', 'EquityNum', 'id');
        const name = strField(row, 'name', 'Name', 'HebName', 'EngName') || secId;
        const qty = Number(row['quantity'] ?? row['Quantity'] ?? row['qty'] ?? row['units'] ?? row['amount'] ?? 0);
        const price = Number(row['price'] ?? row['Price'] ?? row['LastRate'] ?? row['lastRate'] ?? row['rate'] ?? 0);
        const avgCost = Number(row['avgCost'] ?? row['AvgCost'] ?? row['avg_cost'] ?? row['avgRate'] ?? 0);
        const pnl = Number(row['unrealizedPnl'] ?? row['UnrealizedPnl'] ?? row['profitLoss'] ?? row['ProfitLoss'] ?? 0);
        const currency = strField(row, 'currency', 'Currency', 'CurrencyCode') || 'ILS';
        return { secId, name, qty, price, avgCost, pnl, currency };
      })
      .filter(r => r.qty !== 0)
      .map(r => ({
        identifier: `psagot-${r.secId}`,
        name: r.name,
        quantity: r.qty,
        price: r.price,
        avgCost: r.avgCost,
        unrealizedPnl: r.pnl,
        currency: r.currency as 'ILS' | 'USD',
      }));

    // ── 7. Cash: look for a response containing cash/balance data ─────────────────
    let cashIls = 0;
    const cashApi = capturedApis.find(r => {
      const s = JSON.stringify(r.body).toLowerCase();
      return s.includes('cash') || s.includes('buyingpower') || s.includes('buying_power');
    });
    if (cashApi) {
      const s = JSON.stringify(cashApi.body);
      const m = s.match(/"(?:cash|buyingPower|BuyingPower|buying_power)"\s*:\s*([\d.]+)/);
      if (m) cashIls = parseFloat(m[1]);
    }

    const cash: PortfolioCash[] = cashIls > 0 ? [{ currency: 'ILS', amount: cashIls }] : [];
    const asOfDate = new Date().toISOString().slice(0, 10);

    // eslint-disable-next-line no-console
    console.log(`[psagot-scraper] done — ${positions.length} positions, cash ${cashIls} ILS`);
    return { positions, cash, asOfDate };
  }
}
