import { type Page } from 'puppeteer';
import { BasePortfolioScraper } from './base-portfolio-scraper';
import type { PortfolioCash, PortfolioPosition } from './interface';

const BASE_URL = 'https://online.fibi.co.il';
const LOGIN_URL = `${BASE_URL}/MatafLoginService/MatafLoginServlet?bankId=FIBIPORTAL&site=Private&KODSAFA=HE`;
// Classic ("old capital market") securities portfolio page. Rendered by a WebSphere
// portlet whose holdings DataTable (#table322) is populated client-side by its own JS.
const PORTFOLIO_URL = `${BASE_URL}/wps/myportal/FibiMenu/Online/OnCapitalMarket/OnMyportfolio/NewPortfolio`;
// Classic account-balance/transactions view. Its `.main_balance` element holds the current
// עו"ש balance (same selector the transactions scraper reads in base-beinleumi-group.ts).
const BALANCE_URL = `${BASE_URL}/wps/myportal/FibiMenu/Online/OnAccountMngment/OnBalanceTrans/PrivateAccountFlow`;

// Same login selectors as scrapers/base-beinleumi-group.ts (the transactions scraper).
const OTP_SEND_SMS_SELECTOR = '#sendSms';
const OTP_INPUT_SELECTOR = '#codeinput';
const OTP_SUBMIT_SELECTOR = '.otpSubmitButton';

async function waitAny(page: Page, selectors: string[], timeout: number): Promise<string | null> {
  return Promise.race(
    selectors.map(sel =>
      page
        .waitForSelector(sel, { timeout })
        .then(() => sel)
        .catch(() => null),
    ),
  );
}

function parseNumber(raw: string | undefined): number {
  if (!raw) return 0;
  // Strip currency symbols, thousands separators, and stray whitespace/RTL marks.
  const cleaned = raw.replace(/[₪$€,\s‎‏]/g, '').replace(/%$/, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export class BeinleumiPortfolioScraper extends BasePortfolioScraper {
  protected async fetchPortfolio(
    page: Page,
    credentials: Record<string, unknown>,
  ): Promise<{ positions: PortfolioPosition[]; cash: PortfolioCash[]; asOfDate: string }> {
    const username = typeof credentials['username'] === 'string' ? credentials['username'] : '';
    const password = typeof credentials['password'] === 'string' ? credentials['password'] : '';
    const otpCodeRetriever = credentials['otpCodeRetriever'] as (() => Promise<string>) | undefined;

    await this.login(page, username, password, otpCodeRetriever);
    const { positions, asOfDate } = await this.extractPortfolio(page);
    const cash = await this.extractCash(page);

    // The FIBI checking (עו"ש) balance is emitted here as the SINGLE source of that value for
    // net worth — it must never also be counted as a standalone bank-account line elsewhere.
    return { positions, cash, asOfDate };
  }

  private async login(
    page: Page,
    username: string,
    password: string,
    otpCodeRetriever?: () => Promise<string>,
  ): Promise<void> {
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle2', timeout: 60_000 });
    await page.waitForSelector('#username', { timeout: 30_000 });
    await page.type('#username', username);
    await page.type('#password', password);
    // The login button click doesn't register without a short settle delay
    // (same workaround as the transactions scraper's preAction).
    await new Promise(r => setTimeout(r, 1_000));
    await page.click('#continueBtn');

    const state = await waitAny(
      page,
      [OTP_SEND_SMS_SELECTOR, '#card-header', '#account_num', '#matafLogoutLink', '#validationMsg'],
      30_000,
    );

    if (state === '#validationMsg') {
      throw new Error('Beinleumi login failed: validation message shown (bad credentials?)');
    }

    if (state === OTP_SEND_SMS_SELECTOR) {
      if (!otpCodeRetriever) {
        throw new Error('Beinleumi login requires OTP but no otpCodeRetriever was provided');
      }
      await page.click(OTP_SEND_SMS_SELECTOR);
      await page.waitForSelector(OTP_INPUT_SELECTOR, { timeout: 30_000 });
      const code = await otpCodeRetriever();
      await page.type(OTP_INPUT_SELECTOR, code);
      await page.click(OTP_SUBMIT_SELECTOR);
      const postOtp = await waitAny(page, ['#card-header', '#account_num', '#matafLogoutLink'], 60_000);
      if (!postOtp) throw new Error('Beinleumi login: dashboard not reached after OTP submit');
    } else if (!state) {
      throw new Error('Beinleumi login: neither OTP challenge nor dashboard appeared');
    }
  }

  /**
   * Extracts holdings from the classic securities-portfolio portlet.
   *
   * We must NOT navigate the top window to PORTFOLIO_URL: FIBI now wraps everything in a
   * Angular "PortalNG" shell whose SSO token exchange races on hard navigations, 401s, and
   * bounces the tab to the public marketing site (whose cookieCleaner then wipes the
   * session). Instead we stay on the post-login shell page and inject a same-origin iframe
   * pointing at the classic portlet URL — the iframe renders the portlet (running its JS,
   * which populates the #table322 DataTable) without ever moving the top frame.
   */
  private async extractPortfolio(page: Page): Promise<{ positions: PortfolioPosition[]; asOfDate: string }> {
    const IFRAME_ID = 'ibs-portfolio-probe';

    await page.evaluate(
      (id: string, url: string) => {
        const existing = document.getElementById(id);
        if (existing) existing.remove();
        const ifr = document.createElement('iframe');
        ifr.id = id;
        ifr.style.cssText = 'position:absolute;left:-9999px;width:1400px;height:1000px';
        ifr.src = url;
        document.body.appendChild(ifr);
      },
      IFRAME_ID,
      PORTFOLIO_URL,
    );

    // Wait for the portlet's holdings DataTable to render inside the iframe.
    // `.regulartr1` rows are the actual security rows (template/summary rows lack it).
    await page.waitForFunction(
      (id: string) => {
        const ifr = document.getElementById(id) as HTMLIFrameElement | null;
        const doc = ifr?.contentDocument;
        if (!doc) return false;
        // Either at least one holding row, or the portlet's "empty portfolio" marker.
        return (
          doc.querySelectorAll('#table322 tbody tr.regulartr1').length > 0 ||
          /אין ניירות|לא נמצאו/.test(doc.body?.innerText ?? '')
        );
      },
      { timeout: 60_000 },
      IFRAME_ID,
    );

    const extracted = await page.evaluate((id: string) => {
      const ifr = document.getElementById(id) as HTMLIFrameElement | null;
      const doc = ifr?.contentDocument;
      if (!doc) return { rows: [] as string[][], dateText: '' };

      const rows = Array.from(doc.querySelectorAll('#table322 tbody tr.regulartr1')).map(tr =>
        Array.from(tr.querySelectorAll('td')).map(td => (td as HTMLElement).innerText.replace(/\s+/g, ' ').trim()),
      );

      // "תיק ני"ע סניף:8 חשבון:575572 תאריך:11.07.2026 ..." — pull the as-of date.
      const bodyText = doc.body?.innerText ?? '';
      const dateMatch = bodyText.match(/תאריך:\s*(\d{2})\.(\d{2})\.(\d{4})/);
      const dateText = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : '';

      return { rows, dateText };
    }, IFRAME_ID);

    const asOfDate = extracted.dateText || new Date().toISOString().slice(0, 10);

    // Column layout of a `tr.regulartr1` row (14 cells), verified against the live portlet:
    //  0 action (ק/מ)  1 name  2 quantity  3 last-rate  4 daily-%  5 adj-cost-rate
    //  6 nominal-cost-rate  7 adj-P&L ₪  8 adj-P&L %  9 nominal-P&L ₪  10 nominal-P&L %
    //  11 holding-value ₪  12 portfolio %  13 (empty)
    // Rates are quoted in agorot (÷100), same convention as the Psagot scraper.
    const positions: PortfolioPosition[] = [];
    for (const cells of extracted.rows) {
      if (cells.length < 12) continue;
      const name = cells[1] || 'Unknown';
      const quantity = parseNumber(cells[2]);
      const price = parseNumber(cells[3]) / 100;
      const avgCost = parseNumber(cells[5]) / 100;
      const unrealizedPnl = parseNumber(cells[7]);
      const marketValue = parseNumber(cells[11]);
      if (quantity === 0 && marketValue === 0) continue;

      positions.push({
        identifier: `beinleumi-${name}`,
        name,
        quantity,
        price,
        avgCost,
        unrealizedPnl,
        currency: 'ILS',
      });
    }

    return { positions, asOfDate };
  }

  /**
   * Reads the current עו"ש checking balance and returns it as ILS portfolio cash.
   *
   * Uses the same same-origin-iframe technique as extractPortfolio: we must NOT navigate the
   * top frame (FIBI's PortalNG SSO exchange races on hard navigations and bounces the tab to
   * the public site, whose cookieCleaner wipes the session). Best-effort: any failure returns
   * [] so the portfolio scrape still succeeds on its positions alone.
   */
  private async extractCash(page: Page): Promise<PortfolioCash[]> {
    const IFRAME_ID = 'ibs-balance-probe';
    try {
      await page.evaluate(
        (id: string, url: string) => {
          const existing = document.getElementById(id);
          if (existing) existing.remove();
          const ifr = document.createElement('iframe');
          ifr.id = id;
          ifr.style.cssText = 'position:absolute;left:-9999px;width:1400px;height:1000px';
          ifr.src = url;
          document.body.appendChild(ifr);
        },
        IFRAME_ID,
        BALANCE_URL,
      );

      await page.waitForFunction(
        (id: string) => {
          const ifr = document.getElementById(id) as HTMLIFrameElement | null;
          const el = ifr?.contentDocument?.querySelector('.main_balance') as HTMLElement | null;
          return !!el && el.innerText.trim().length > 0;
        },
        { timeout: 60_000 },
        IFRAME_ID,
      );

      const raw = await page.evaluate((id: string) => {
        const ifr = document.getElementById(id) as HTMLIFrameElement | null;
        const el = ifr?.contentDocument?.querySelector('.main_balance') as HTMLElement | null;
        return el ? el.innerText : null;
      }, IFRAME_ID);

      if (raw == null) return [];
      return [{ currency: 'ILS', amount: parseNumber(raw) }];
    } catch {
      return [];
    }
  }
}
