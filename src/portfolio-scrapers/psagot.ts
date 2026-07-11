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

// The API returns HTTP 200/401/500 with an {"Exception": ...} JSON body on failure —
// e.g. InvalidSessionException when the csession header doesn't match the one the app
// used at login, or MinIntervalException when the same endpoint is hit within 1000ms.
async function apiFetch(page: Page, sessionKey: string, csession: string, url: string): Promise<unknown> {
  const raw = (await page.evaluate(
    async (targetUrl: string, key: string, cs: string) => {
      const res = await fetch(targetUrl, { headers: { session: key, csession: cs } });
      return { status: res.status, text: await res.text() };
    },
    url,
    sessionKey,
    csession,
  )) as { status: number; text: string };

  let body: unknown;
  try {
    body = JSON.parse(raw.text);
  } catch {
    throw new Error(`Psagot API non-JSON response (HTTP ${raw.status}) from ${url}: ${raw.text.slice(0, 200)}`);
  }
  const exception = (body as { Exception?: { '-ExceptionType'?: string; Message?: string } })?.Exception;
  if (exception) {
    throw new Error(`Psagot API ${exception['-ExceptionType'] ?? 'Exception'} from ${url}: ${exception.Message ?? ''}`);
  }
  if (raw.status < 200 || raw.status >= 300) throw new Error(`HTTP ${raw.status} from ${url}`);
  return body;
}

// The Flutter app polls some endpoints itself; an explicit fetch can collide with its
// polling and get MinIntervalException — back off and retry instead of failing the scan.
async function apiFetchWithRetry(page: Page, sessionKey: string, csession: string, url: string): Promise<unknown> {
  const maxAttempts = 3;
  for (let attempt = 1; ; attempt++) {
    try {
      return await apiFetch(page, sessionKey, csession, url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < maxAttempts && msg.includes('MinIntervalException')) {
        await new Promise(r => setTimeout(r, 1_600));
        continue;
      }
      throw err;
    }
  }
}

export class PsagotScraper extends BasePortfolioScraper {
  protected async fetchPortfolio(
    page: Page,
    credentials: Record<string, unknown>,
  ): Promise<{ positions: PortfolioPosition[]; cash: PortfolioCash[]; asOfDate: string }> {
    const username = typeof credentials['username'] === 'string' ? credentials['username'] : '';
    const password = typeof credentials['password'] === 'string' ? credentials['password'] : '';
    const otpCodeRetriever = credentials['otpCodeRetriever'] as (() => Promise<string>) | undefined;

    // ── 1. Interceptors: SessionKey, csession, and the app's own API responses ─
    let sessionKey = '';
    // The API binds the SessionKey to the csession value the Flutter app generated at
    // login. Explicit fetches with any other csession get InvalidSessionException, so
    // capture the app's value from its own authenticated requests.
    let appSessionKey = '';
    let appCsession = '';
    let capturedAccounts: unknown;
    // Balances responses intercepted from the Flutter app's own polling — used instead of
    // explicit apiFetch for accounts the app auto-loads (avoids concurrent-request 401s).
    const capturedBalances = new Map<string, unknown>();

    page.on('request', request => {
      const url = request.url();
      if (!url.includes('trade1.psagot.co.il')) return;
      const headers = request.headers();
      const sk = headers['session'];
      const cs = headers['csession'];
      if (sk && !appSessionKey) appSessionKey = sk;
      if (cs && !appCsession) appCsession = cs;
    });

    page.on('response', response => {
      const url = response.url();
      if (url.includes('/login')) {
        void response
          .json()
          .then((body: unknown) => {
            const key = (body as { Login?: { SessionKey?: string } })?.Login?.SessionKey;
            if (key) sessionKey = key;
          })
          .catch(() => undefined);
        return;
      }
      if (url.includes('/V2/json/accounts')) {
        void response
          .json()
          .then((body: unknown) => {
            if ((body as { UserAccounts?: unknown })?.UserAccounts) capturedAccounts = body;
          })
          .catch(() => undefined);
        return;
      }
      if (url.includes('/account/view/balances')) {
        const accountMatch = url.match(/account=([^&]+)/);
        if (accountMatch) {
          void response
            .json()
            .then((body: unknown) => { capturedBalances.set(accountMatch[1], body); })
            .catch(() => undefined);
        }
      }
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
        // Flutter may auto-submit after all OTP digits are entered.
        // Try clicking Login only if it becomes active within 5s; ignore if it doesn't.
        await page
          .waitForFunction(
            () => {
              const btn = Array.from(document.querySelectorAll('flt-semantics[role="button"]')).find(
                el => el.textContent?.trim() === 'Login',
              );
              return btn != null && btn.getAttribute('aria-disabled') !== 'true';
            },
            { timeout: 5_000 },
          )
          .then(() => flutterClickByText(page, 'Login'))
          .catch(() => undefined);
      }
    }

    // ── 5. Wait for post-login SessionKey (polls Node.js variable set by response listener) ──
    // URL-based heuristics fail for Flutter SPAs that stay at '/' after login.
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 60_000;
      const check = setInterval(() => {
        if (sessionKey || appSessionKey) { clearInterval(check); resolve(); return; }
        if (Date.now() > deadline) { clearInterval(check); reject(new Error('Login timed out: no SessionKey received')); }
      }, 500);
    });
    // eslint-disable-next-line no-console
    console.log('[psagot-scraper] logged in, sessionKey captured:', sessionKey || appSessionKey ? 'yes' : 'NO');

    // Wait for the app's first authenticated request (carries the csession the server
    // bound at login) — ideally its own accounts response arrives in the same window.
    await new Promise<void>(resolve => {
      const deadline = Date.now() + 15_000;
      const check = setInterval(() => {
        if (capturedAccounts !== undefined || appCsession || Date.now() > deadline) {
          clearInterval(check);
          resolve();
        }
      }, 250);
    });
    const effectiveKey = sessionKey || appSessionKey;
    const csession = appCsession || String(Math.random());
    // eslint-disable-next-line no-console
    console.log('[psagot-scraper] csession captured:', appCsession ? 'yes' : 'NO (fallback random — API calls will likely fail)');

    if (!effectiveKey) throw new Error('Psagot login succeeded but SessionKey was not captured from response');

    // ── 6. Fetch accounts (prefer the app's own response, intercepted above) ──
    let accountsRes: {
      UserAccounts?: { UserAccount?: Array<{ '-key': string }> | { '-key': string } };
    };
    if (capturedAccounts !== undefined) {
      // eslint-disable-next-line no-console
      console.log('[psagot-scraper] using intercepted accounts response');
      accountsRes = capturedAccounts as typeof accountsRes;
    } else {
      accountsRes = (await apiFetchWithRetry(
        page,
        effectiveKey,
        csession,
        `${BASE_URL}/V2/json/accounts?catalog=unified`,
      )) as typeof accountsRes;
    }
    const rawAccounts = accountsRes?.UserAccounts?.UserAccount;
    const accountIds = (Array.isArray(rawAccounts) ? rawAccounts : rawAccounts ? [rawAccounts] : []).map(
      a => a['-key'],
    );
    // eslint-disable-next-line no-console
    console.log('[psagot-scraper] accounts:', accountIds);
    if (accountIds.length === 0) {
      throw new Error(`Psagot returned no accounts — raw: ${JSON.stringify(accountsRes).slice(0, 300)}`);
    }

    // ── 7. Fetch balances for each account ────────────────────────────────────
    const allPositions: PortfolioPosition[] = [];
    let totalCashIls = 0;
    let lastExplicitFetch = 0; // ms timestamp — enforce 1500ms min between explicit apiFetch calls

    for (const accountId of accountIds) {
      // Wait up to 5s for the Flutter app to auto-populate this account's balances
      // (it continuously polls primary accounts — intercepting avoids concurrent-request 401s).
      const captured = await new Promise<unknown>(resolve => {
        const deadline = Date.now() + 5_000;
        const check = setInterval(() => {
          const val = capturedBalances.get(accountId);
          if (val !== undefined) { clearInterval(check); resolve(val); return; }
          if (Date.now() > deadline) { clearInterval(check); resolve(undefined); }
        }, 200);
      });

      let balancesRes: unknown;
      if (captured !== undefined) {
        // eslint-disable-next-line no-console
        console.log(`[psagot-scraper] using intercepted balances for ${accountId}`);
        balancesRes = captured;
      } else {
        // Not auto-fetched by the app — do an explicit fetch, respecting the 1000ms server rate limit.
        const now = Date.now();
        const wait = 1_500 - (now - lastExplicitFetch);
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        // eslint-disable-next-line no-console
        console.log(`[psagot-scraper] explicit apiFetch balances for ${accountId}`);
        balancesRes = await apiFetchWithRetry(
          page,
          effectiveKey,
          csession,
          `${BASE_URL}/V2/json2/account/view/balances?account=${accountId}&fields=hebName&currency=ils&catalog=unified`,
        );
        lastExplicitFetch = Date.now();
      }

      const typedRes = balancesRes as {
        View?: {
          Account?: {
            OnlineCash?: number;
            AccountPosition?: { Balance?: Array<Record<string, unknown>> | Record<string, unknown> };
          };
          Meta?: { Security?: Array<{ '-Key': string; HebName?: string }> | { '-Key': string; HebName?: string } };
        };
      };

      const account = typedRes?.View?.Account;
      if (!account) {
        // eslint-disable-next-line no-console
        console.log(`[psagot-scraper] no Account in balances response for ${accountId}`);
        continue;
      }

      totalCashIls += Number(account.OnlineCash ?? 0);

      // Build a map of security ID → name from Meta.Security
      const rawMeta = typedRes?.View?.Meta?.Security;
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
