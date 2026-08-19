"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.BeinleumiPortfolioScraper = void 0;
var _basePortfolioScraper = require("./base-portfolio-scraper");
const BASE_URL = 'https://online.fibi.co.il';
const LOGIN_URL = `${BASE_URL}/MatafLoginService/MatafLoginServlet?bankId=FIBIPORTAL&site=Private&KODSAFA=HE`;
// Classic ("old capital market") securities portfolio page. Rendered by a WebSphere
// portlet whose holdings DataTable (#table322) is populated client-side by its own JS.
const PORTFOLIO_URL = `${BASE_URL}/wps/myportal/FibiMenu/Online/OnCapitalMarket/OnMyportfolio/NewPortfolio`;
// Classic account-balance/transactions view. Its `.main_balance` element holds the current
// עו"ש balance (same selector the transactions scraper reads in base-beinleumi-group.ts).
const BALANCE_URL = `${BASE_URL}/wps/myportal/FibiMenu/Online/OnAccountMngment/OnBalanceTrans/PrivateAccountFlow`;
// Deposits/savings ("פקדונות וחסכונות") live in the *modern* Angular PortalNG shell, not the
// classic WebSphere portlets above — there is no legacy /wps/myportal twin for this one.
// Post-login FIBI already lands the top frame on the shell document itself, so a plain
// same-document hash change (never a page.goto to a shell URL, which races the SSO token
// exchange and gets bounced) is enough to trigger the Angular route — no iframe needed.
// The route itself fires one clean JSON REST call we can just await and parse.
const DEPOSITS_HASH_ROUTE = '#/myDeposits';
const DEPOSITS_RESPONSE_URL_FRAGMENT = '/bff-MyDeposits/api/v1/portfolio/savings';

// Same login selectors as scrapers/base-beinleumi-group.ts (the transactions scraper).
const OTP_SEND_SMS_SELECTOR = '#sendSms';
const OTP_INPUT_SELECTOR = '#codeinput';
const OTP_SUBMIT_SELECTOR = '.otpSubmitButton';
async function waitAny(page, selectors, timeout) {
  return Promise.race(selectors.map(sel => page.waitForSelector(sel, {
    timeout
  }).then(() => sel).catch(() => null)));
}
function parseNumber(raw) {
  if (!raw) return 0;
  // Strip currency symbols, thousands separators, and stray whitespace/RTL marks.
  const cleaned = raw.replace(/[₪$€,\s‎‏]/g, '').replace(/%$/, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// bff-MyDeposits returns dd/mm/yyyy (the classic portlets use dd.mm.yyyy elsewhere in this
// file — accept both separators defensively).
function parseIlDate(raw) {
  if (!raw) return undefined;
  const m = raw.match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
  if (!m) return undefined;
  return `${m[3]}-${m[2]}-${m[1]}`;
}
function normalizeDepositCurrency(raw) {
  if (!raw) return 'ILS';
  return raw.toUpperCase() === 'NIS' ? 'ILS' : raw.toUpperCase();
}
class BeinleumiPortfolioScraper extends _basePortfolioScraper.BasePortfolioScraper {
  async fetchPortfolio(page, credentials) {
    const username = typeof credentials['username'] === 'string' ? credentials['username'] : '';
    const password = typeof credentials['password'] === 'string' ? credentials['password'] : '';
    const otpCodeRetriever = credentials['otpCodeRetriever'];
    await this.login(page, username, password, otpCodeRetriever);
    const {
      positions,
      asOfDate
    } = await this.extractPortfolio(page);
    const cash = await this.extractCash(page);
    // Run last: if the deposits hash-navigation ever misbehaves, positions/cash are
    // already safely captured before we touch it.
    const deposits = await this.extractDeposits(page);

    // The FIBI checking (עו"ש) balance is emitted here as the SINGLE source of that value for
    // net worth — it must never also be counted as a standalone bank-account line elsewhere.
    return {
      positions,
      cash,
      deposits,
      asOfDate
    };
  }
  async login(page, username, password, otpCodeRetriever) {
    await page.goto(LOGIN_URL, {
      waitUntil: 'networkidle2',
      timeout: 60_000
    });
    await page.waitForSelector('#username', {
      timeout: 30_000
    });
    await page.type('#username', username);
    await page.type('#password', password);
    // The login button click doesn't register without a short settle delay
    // (same workaround as the transactions scraper's preAction).
    await new Promise(r => setTimeout(r, 1_000));
    await page.click('#continueBtn');
    const state = await waitAny(page, [OTP_SEND_SMS_SELECTOR, '#card-header', '#account_num', '#matafLogoutLink', '#validationMsg'], 30_000);
    if (state === '#validationMsg') {
      throw new Error('Beinleumi login failed: validation message shown (bad credentials?)');
    }
    if (state === OTP_SEND_SMS_SELECTOR) {
      if (!otpCodeRetriever) {
        throw new Error('Beinleumi login requires OTP but no otpCodeRetriever was provided');
      }
      await page.click(OTP_SEND_SMS_SELECTOR);
      await page.waitForSelector(OTP_INPUT_SELECTOR, {
        timeout: 30_000
      });
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
  async extractPortfolio(page) {
    const IFRAME_ID = 'ibs-portfolio-probe';
    await page.evaluate((id, url) => {
      const existing = document.getElementById(id);
      if (existing) existing.remove();
      const ifr = document.createElement('iframe');
      ifr.id = id;
      ifr.style.cssText = 'position:absolute;left:-9999px;width:1400px;height:1000px';
      ifr.src = url;
      document.body.appendChild(ifr);
    }, IFRAME_ID, PORTFOLIO_URL);

    // Wait for the portlet's holdings DataTable to render inside the iframe.
    // `.regulartr1` rows are the actual security rows (template/summary rows lack it).
    await page.waitForFunction(id => {
      const ifr = document.getElementById(id);
      const doc = ifr?.contentDocument;
      if (!doc) return false;
      // Either at least one holding row, or the portlet's "empty portfolio" marker.
      return doc.querySelectorAll('#table322 tbody tr.regulartr1').length > 0 || /אין ניירות|לא נמצאו/.test(doc.body?.innerText ?? '');
    }, {
      timeout: 60_000
    }, IFRAME_ID);
    const extracted = await page.evaluate(id => {
      const ifr = document.getElementById(id);
      const doc = ifr?.contentDocument;
      if (!doc) return {
        rows: [],
        dateText: ''
      };
      const rows = Array.from(doc.querySelectorAll('#table322 tbody tr.regulartr1')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.innerText.replace(/\s+/g, ' ').trim()));

      // "תיק ני"ע סניף:8 חשבון:575572 תאריך:11.07.2026 ..." — pull the as-of date.
      const bodyText = doc.body?.innerText ?? '';
      const dateMatch = bodyText.match(/תאריך:\s*(\d{2})\.(\d{2})\.(\d{4})/);
      const dateText = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : '';
      return {
        rows,
        dateText
      };
    }, IFRAME_ID);
    const asOfDate = extracted.dateText || new Date().toISOString().slice(0, 10);

    // Column layout of a `tr.regulartr1` row (14 cells), verified against the live portlet:
    //  0 action (ק/מ)  1 name  2 quantity  3 last-rate  4 daily-%  5 adj-cost-rate
    //  6 nominal-cost-rate  7 adj-P&L ₪  8 adj-P&L %  9 nominal-P&L ₪  10 nominal-P&L %
    //  11 holding-value ₪  12 portfolio %  13 (empty)
    // Rates are quoted in agorot (÷100), same convention as the Psagot scraper.
    const positions = [];
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
        currency: 'ILS'
      });
    }
    return {
      positions,
      asOfDate
    };
  }

  /**
   * Reads the current עו"ש checking balance and returns it as ILS portfolio cash.
   *
   * Uses the same same-origin-iframe technique as extractPortfolio: we must NOT navigate the
   * top frame (FIBI's PortalNG SSO exchange races on hard navigations and bounces the tab to
   * the public site, whose cookieCleaner wipes the session). Best-effort: any failure returns
   * [] so the portfolio scrape still succeeds on its positions alone.
   */
  async extractCash(page) {
    const IFRAME_ID = 'ibs-balance-probe';
    try {
      await page.evaluate((id, url) => {
        const existing = document.getElementById(id);
        if (existing) existing.remove();
        const ifr = document.createElement('iframe');
        ifr.id = id;
        ifr.style.cssText = 'position:absolute;left:-9999px;width:1400px;height:1000px';
        ifr.src = url;
        document.body.appendChild(ifr);
      }, IFRAME_ID, BALANCE_URL);
      await page.waitForFunction(id => {
        const ifr = document.getElementById(id);
        const el = ifr?.contentDocument?.querySelector('.main_balance');
        return !!el && el.innerText.trim().length > 0;
      }, {
        timeout: 60_000
      }, IFRAME_ID);
      const raw = await page.evaluate(id => {
        const ifr = document.getElementById(id);
        const el = ifr?.contentDocument?.querySelector('.main_balance');
        return el ? el.innerText : null;
      }, IFRAME_ID);
      if (raw == null) return [];
      return [{
        currency: 'ILS',
        amount: parseNumber(raw)
      }];
    } catch {
      return [];
    }
  }

  /**
   * Reads term deposits/savings ("פקדונות וחסכונות") from the modern Angular shell's
   * myDeposits route. Unlike extractPortfolio/extractCash this needs no iframe injection and
   * no DOM scraping at all: post-login FIBI already leaves the top frame on the shell
   * document, so a same-document hash change is enough to trigger the Angular route (verified
   * live — it does not bounce the session the way a hard navigation to a shell URL would), and
   * that route fires exactly one JSON REST call (bff-MyDeposits) with everything we need,
   * including each deposit's own interest rate — no "more details" click required.
   * Best-effort: any failure returns [] so the portfolio scrape still succeeds on its
   * positions/cash alone.
   */
  async extractDeposits(page) {
    try {
      const onShell = await page.evaluate(() => location.pathname.includes('/appsng/Resources/PortalNG/shell'));
      if (!onShell) return [];
      const responsePromise = page.waitForResponse(res => res.url().includes(DEPOSITS_RESPONSE_URL_FRAGMENT) && res.request().method() === 'GET', {
        timeout: 30_000
      }).catch(() => null);
      await page.evaluate(hash => {
        location.hash = hash;
      }, DEPOSITS_HASH_ROUTE);
      const response = await responsePromise;
      if (!response) return [];
      const body = await response.json();
      const screen = body.MyDepositsScreen;
      if (!screen || screen.outNoData != null) return [];
      const groups = screen.outMasachPikdonot?.outMasachPerMtb?.outPikTable ?? [];
      const deposits = [];
      for (const group of groups) {
        const currency = normalizeDepositCurrency(group.outShemMatbeaEng3);
        const lines = group.outPikListMatbea?.outPikLine ?? [];
        for (const line of lines) {
          const rateLine = line.outRibit?.outRbHalufotTbl?.outRbHlfLine?.[0];
          const identifier = line.outMisparPikadon || line.outPikNo || `beinleumi-deposit-${deposits.length}`;
          deposits.push({
            identifier,
            name: line.outKinuyByUser || identifier,
            currency,
            principal: parseNumber(line.outKerenPkd),
            currentValue: parseNumber(line.outShoviPkdn),
            maturityDate: parseIlDate(line.outTrPeraon),
            openDate: parseIlDate(line.outMoadimMeshihotHafkadot?.outTrMoedHafkada),
            interestRatePercent: rateLine?.outRbHlfAchuzRbText ? parseNumber(rateLine.outRbHlfAchuzRbText) : undefined,
            linkage: rateLine?.outRbHlfTeurSugHatzmada || undefined
          });
        }
      }
      return deposits;
    } catch {
      return [];
    }
  }
}
exports.BeinleumiPortfolioScraper = BeinleumiPortfolioScraper;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfYmFzZVBvcnRmb2xpb1NjcmFwZXIiLCJyZXF1aXJlIiwiQkFTRV9VUkwiLCJMT0dJTl9VUkwiLCJQT1JURk9MSU9fVVJMIiwiQkFMQU5DRV9VUkwiLCJERVBPU0lUU19IQVNIX1JPVVRFIiwiREVQT1NJVFNfUkVTUE9OU0VfVVJMX0ZSQUdNRU5UIiwiT1RQX1NFTkRfU01TX1NFTEVDVE9SIiwiT1RQX0lOUFVUX1NFTEVDVE9SIiwiT1RQX1NVQk1JVF9TRUxFQ1RPUiIsIndhaXRBbnkiLCJwYWdlIiwic2VsZWN0b3JzIiwidGltZW91dCIsIlByb21pc2UiLCJyYWNlIiwibWFwIiwic2VsIiwid2FpdEZvclNlbGVjdG9yIiwidGhlbiIsImNhdGNoIiwicGFyc2VOdW1iZXIiLCJyYXciLCJjbGVhbmVkIiwicmVwbGFjZSIsIm4iLCJOdW1iZXIiLCJpc0Zpbml0ZSIsInBhcnNlSWxEYXRlIiwidW5kZWZpbmVkIiwibSIsIm1hdGNoIiwibm9ybWFsaXplRGVwb3NpdEN1cnJlbmN5IiwidG9VcHBlckNhc2UiLCJCZWlubGV1bWlQb3J0Zm9saW9TY3JhcGVyIiwiQmFzZVBvcnRmb2xpb1NjcmFwZXIiLCJmZXRjaFBvcnRmb2xpbyIsImNyZWRlbnRpYWxzIiwidXNlcm5hbWUiLCJwYXNzd29yZCIsIm90cENvZGVSZXRyaWV2ZXIiLCJsb2dpbiIsInBvc2l0aW9ucyIsImFzT2ZEYXRlIiwiZXh0cmFjdFBvcnRmb2xpbyIsImNhc2giLCJleHRyYWN0Q2FzaCIsImRlcG9zaXRzIiwiZXh0cmFjdERlcG9zaXRzIiwiZ290byIsIndhaXRVbnRpbCIsInR5cGUiLCJyIiwic2V0VGltZW91dCIsImNsaWNrIiwic3RhdGUiLCJFcnJvciIsImNvZGUiLCJwb3N0T3RwIiwiSUZSQU1FX0lEIiwiZXZhbHVhdGUiLCJpZCIsInVybCIsImV4aXN0aW5nIiwiZG9jdW1lbnQiLCJnZXRFbGVtZW50QnlJZCIsInJlbW92ZSIsImlmciIsImNyZWF0ZUVsZW1lbnQiLCJzdHlsZSIsImNzc1RleHQiLCJzcmMiLCJib2R5IiwiYXBwZW5kQ2hpbGQiLCJ3YWl0Rm9yRnVuY3Rpb24iLCJkb2MiLCJjb250ZW50RG9jdW1lbnQiLCJxdWVyeVNlbGVjdG9yQWxsIiwibGVuZ3RoIiwidGVzdCIsImlubmVyVGV4dCIsImV4dHJhY3RlZCIsInJvd3MiLCJkYXRlVGV4dCIsIkFycmF5IiwiZnJvbSIsInRyIiwidGQiLCJ0cmltIiwiYm9keVRleHQiLCJkYXRlTWF0Y2giLCJEYXRlIiwidG9JU09TdHJpbmciLCJzbGljZSIsImNlbGxzIiwibmFtZSIsInF1YW50aXR5IiwicHJpY2UiLCJhdmdDb3N0IiwidW5yZWFsaXplZFBubCIsIm1hcmtldFZhbHVlIiwicHVzaCIsImlkZW50aWZpZXIiLCJjdXJyZW5jeSIsImVsIiwicXVlcnlTZWxlY3RvciIsImFtb3VudCIsIm9uU2hlbGwiLCJsb2NhdGlvbiIsInBhdGhuYW1lIiwiaW5jbHVkZXMiLCJyZXNwb25zZVByb21pc2UiLCJ3YWl0Rm9yUmVzcG9uc2UiLCJyZXMiLCJyZXF1ZXN0IiwibWV0aG9kIiwiaGFzaCIsInJlc3BvbnNlIiwianNvbiIsInNjcmVlbiIsIk15RGVwb3NpdHNTY3JlZW4iLCJvdXROb0RhdGEiLCJncm91cHMiLCJvdXRNYXNhY2hQaWtkb25vdCIsIm91dE1hc2FjaFBlck10YiIsIm91dFBpa1RhYmxlIiwiZ3JvdXAiLCJvdXRTaGVtTWF0YmVhRW5nMyIsImxpbmVzIiwib3V0UGlrTGlzdE1hdGJlYSIsIm91dFBpa0xpbmUiLCJsaW5lIiwicmF0ZUxpbmUiLCJvdXRSaWJpdCIsIm91dFJiSGFsdWZvdFRibCIsIm91dFJiSGxmTGluZSIsIm91dE1pc3BhclBpa2Fkb24iLCJvdXRQaWtObyIsIm91dEtpbnV5QnlVc2VyIiwicHJpbmNpcGFsIiwib3V0S2VyZW5Qa2QiLCJjdXJyZW50VmFsdWUiLCJvdXRTaG92aVBrZG4iLCJtYXR1cml0eURhdGUiLCJvdXRUclBlcmFvbiIsIm9wZW5EYXRlIiwib3V0TW9hZGltTWVzaGlob3RIYWZrYWRvdCIsIm91dFRyTW9lZEhhZmthZGEiLCJpbnRlcmVzdFJhdGVQZXJjZW50Iiwib3V0UmJIbGZBY2h1elJiVGV4dCIsImxpbmthZ2UiLCJvdXRSYkhsZlRldXJTdWdIYXR6bWFkYSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi9zcmMvcG9ydGZvbGlvLXNjcmFwZXJzL2JlaW5sZXVtaS50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyB0eXBlIFBhZ2UgfSBmcm9tICdwdXBwZXRlZXInO1xuaW1wb3J0IHsgQmFzZVBvcnRmb2xpb1NjcmFwZXIgfSBmcm9tICcuL2Jhc2UtcG9ydGZvbGlvLXNjcmFwZXInO1xuaW1wb3J0IHR5cGUgeyBQb3J0Zm9saW9DYXNoLCBQb3J0Zm9saW9EZXBvc2l0LCBQb3J0Zm9saW9Qb3NpdGlvbiB9IGZyb20gJy4vaW50ZXJmYWNlJztcblxuY29uc3QgQkFTRV9VUkwgPSAnaHR0cHM6Ly9vbmxpbmUuZmliaS5jby5pbCc7XG5jb25zdCBMT0dJTl9VUkwgPSBgJHtCQVNFX1VSTH0vTWF0YWZMb2dpblNlcnZpY2UvTWF0YWZMb2dpblNlcnZsZXQ/YmFua0lkPUZJQklQT1JUQUwmc2l0ZT1Qcml2YXRlJktPRFNBRkE9SEVgO1xuLy8gQ2xhc3NpYyAoXCJvbGQgY2FwaXRhbCBtYXJrZXRcIikgc2VjdXJpdGllcyBwb3J0Zm9saW8gcGFnZS4gUmVuZGVyZWQgYnkgYSBXZWJTcGhlcmVcbi8vIHBvcnRsZXQgd2hvc2UgaG9sZGluZ3MgRGF0YVRhYmxlICgjdGFibGUzMjIpIGlzIHBvcHVsYXRlZCBjbGllbnQtc2lkZSBieSBpdHMgb3duIEpTLlxuY29uc3QgUE9SVEZPTElPX1VSTCA9IGAke0JBU0VfVVJMfS93cHMvbXlwb3J0YWwvRmliaU1lbnUvT25saW5lL09uQ2FwaXRhbE1hcmtldC9Pbk15cG9ydGZvbGlvL05ld1BvcnRmb2xpb2A7XG4vLyBDbGFzc2ljIGFjY291bnQtYmFsYW5jZS90cmFuc2FjdGlvbnMgdmlldy4gSXRzIGAubWFpbl9iYWxhbmNlYCBlbGVtZW50IGhvbGRzIHRoZSBjdXJyZW50XG4vLyDXoteVXCLXqSBiYWxhbmNlIChzYW1lIHNlbGVjdG9yIHRoZSB0cmFuc2FjdGlvbnMgc2NyYXBlciByZWFkcyBpbiBiYXNlLWJlaW5sZXVtaS1ncm91cC50cykuXG5jb25zdCBCQUxBTkNFX1VSTCA9IGAke0JBU0VfVVJMfS93cHMvbXlwb3J0YWwvRmliaU1lbnUvT25saW5lL09uQWNjb3VudE1uZ21lbnQvT25CYWxhbmNlVHJhbnMvUHJpdmF0ZUFjY291bnRGbG93YDtcbi8vIERlcG9zaXRzL3NhdmluZ3MgKFwi16TXp9eT15XXoNeV16og15XXl9eh15vXldeg15XXqlwiKSBsaXZlIGluIHRoZSAqbW9kZXJuKiBBbmd1bGFyIFBvcnRhbE5HIHNoZWxsLCBub3QgdGhlXG4vLyBjbGFzc2ljIFdlYlNwaGVyZSBwb3J0bGV0cyBhYm92ZSDigJQgdGhlcmUgaXMgbm8gbGVnYWN5IC93cHMvbXlwb3J0YWwgdHdpbiBmb3IgdGhpcyBvbmUuXG4vLyBQb3N0LWxvZ2luIEZJQkkgYWxyZWFkeSBsYW5kcyB0aGUgdG9wIGZyYW1lIG9uIHRoZSBzaGVsbCBkb2N1bWVudCBpdHNlbGYsIHNvIGEgcGxhaW5cbi8vIHNhbWUtZG9jdW1lbnQgaGFzaCBjaGFuZ2UgKG5ldmVyIGEgcGFnZS5nb3RvIHRvIGEgc2hlbGwgVVJMLCB3aGljaCByYWNlcyB0aGUgU1NPIHRva2VuXG4vLyBleGNoYW5nZSBhbmQgZ2V0cyBib3VuY2VkKSBpcyBlbm91Z2ggdG8gdHJpZ2dlciB0aGUgQW5ndWxhciByb3V0ZSDigJQgbm8gaWZyYW1lIG5lZWRlZC5cbi8vIFRoZSByb3V0ZSBpdHNlbGYgZmlyZXMgb25lIGNsZWFuIEpTT04gUkVTVCBjYWxsIHdlIGNhbiBqdXN0IGF3YWl0IGFuZCBwYXJzZS5cbmNvbnN0IERFUE9TSVRTX0hBU0hfUk9VVEUgPSAnIy9teURlcG9zaXRzJztcbmNvbnN0IERFUE9TSVRTX1JFU1BPTlNFX1VSTF9GUkFHTUVOVCA9ICcvYmZmLU15RGVwb3NpdHMvYXBpL3YxL3BvcnRmb2xpby9zYXZpbmdzJztcblxuLy8gU2FtZSBsb2dpbiBzZWxlY3RvcnMgYXMgc2NyYXBlcnMvYmFzZS1iZWlubGV1bWktZ3JvdXAudHMgKHRoZSB0cmFuc2FjdGlvbnMgc2NyYXBlcikuXG5jb25zdCBPVFBfU0VORF9TTVNfU0VMRUNUT1IgPSAnI3NlbmRTbXMnO1xuY29uc3QgT1RQX0lOUFVUX1NFTEVDVE9SID0gJyNjb2RlaW5wdXQnO1xuY29uc3QgT1RQX1NVQk1JVF9TRUxFQ1RPUiA9ICcub3RwU3VibWl0QnV0dG9uJztcblxuYXN5bmMgZnVuY3Rpb24gd2FpdEFueShwYWdlOiBQYWdlLCBzZWxlY3RvcnM6IHN0cmluZ1tdLCB0aW1lb3V0OiBudW1iZXIpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgcmV0dXJuIFByb21pc2UucmFjZShcbiAgICBzZWxlY3RvcnMubWFwKHNlbCA9PlxuICAgICAgcGFnZVxuICAgICAgICAud2FpdEZvclNlbGVjdG9yKHNlbCwgeyB0aW1lb3V0IH0pXG4gICAgICAgIC50aGVuKCgpID0+IHNlbClcbiAgICAgICAgLmNhdGNoKCgpID0+IG51bGwpLFxuICAgICksXG4gICk7XG59XG5cbmZ1bmN0aW9uIHBhcnNlTnVtYmVyKHJhdzogc3RyaW5nIHwgdW5kZWZpbmVkKTogbnVtYmVyIHtcbiAgaWYgKCFyYXcpIHJldHVybiAwO1xuICAvLyBTdHJpcCBjdXJyZW5jeSBzeW1ib2xzLCB0aG91c2FuZHMgc2VwYXJhdG9ycywgYW5kIHN0cmF5IHdoaXRlc3BhY2UvUlRMIG1hcmtzLlxuICBjb25zdCBjbGVhbmVkID0gcmF3LnJlcGxhY2UoL1vigqok4oKsLFxcc+KAjuKAj10vZywgJycpLnJlcGxhY2UoLyUkLywgJycpO1xuICBjb25zdCBuID0gTnVtYmVyKGNsZWFuZWQpO1xuICByZXR1cm4gTnVtYmVyLmlzRmluaXRlKG4pID8gbiA6IDA7XG59XG5cbi8vIGJmZi1NeURlcG9zaXRzIHJldHVybnMgZGQvbW0veXl5eSAodGhlIGNsYXNzaWMgcG9ydGxldHMgdXNlIGRkLm1tLnl5eXkgZWxzZXdoZXJlIGluIHRoaXNcbi8vIGZpbGUg4oCUIGFjY2VwdCBib3RoIHNlcGFyYXRvcnMgZGVmZW5zaXZlbHkpLlxuZnVuY3Rpb24gcGFyc2VJbERhdGUocmF3OiBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgaWYgKCFyYXcpIHJldHVybiB1bmRlZmluZWQ7XG4gIGNvbnN0IG0gPSByYXcubWF0Y2goL14oXFxkezJ9KVsuL10oXFxkezJ9KVsuL10oXFxkezR9KSQvKTtcbiAgaWYgKCFtKSByZXR1cm4gdW5kZWZpbmVkO1xuICByZXR1cm4gYCR7bVszXX0tJHttWzJdfS0ke21bMV19YDtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplRGVwb3NpdEN1cnJlbmN5KHJhdzogc3RyaW5nIHwgdW5kZWZpbmVkKTogc3RyaW5nIHtcbiAgaWYgKCFyYXcpIHJldHVybiAnSUxTJztcbiAgcmV0dXJuIHJhdy50b1VwcGVyQ2FzZSgpID09PSAnTklTJyA/ICdJTFMnIDogcmF3LnRvVXBwZXJDYXNlKCk7XG59XG5cbnR5cGUgUmF3RGVwb3NpdExpbmUgPSB7XG4gIG91dFBpa05vPzogc3RyaW5nO1xuICBvdXRLaW51eUJ5VXNlcj86IHN0cmluZztcbiAgb3V0TWlzcGFyUGlrYWRvbj86IHN0cmluZztcbiAgb3V0S2VyZW5Qa2Q/OiBzdHJpbmc7XG4gIG91dFNob3ZpUGtkbj86IHN0cmluZztcbiAgb3V0VHJQZXJhb24/OiBzdHJpbmc7XG4gIG91dE1vYWRpbU1lc2hpaG90SGFma2Fkb3Q/OiB7IG91dFRyTW9lZEhhZmthZGE/OiBzdHJpbmcgfCBudWxsIH07XG4gIG91dFJpYml0Pzoge1xuICAgIG91dFJiSGFsdWZvdFRibD86IHtcbiAgICAgIG91dFJiSGxmTGluZT86IHsgb3V0UmJIbGZUZXVyU3VnSGF0em1hZGE/OiBzdHJpbmc7IG91dFJiSGxmQWNodXpSYlRleHQ/OiBzdHJpbmcgfVtdO1xuICAgIH07XG4gIH07XG59O1xuXG50eXBlIFJhd0RlcG9zaXRDdXJyZW5jeUdyb3VwID0ge1xuICBvdXRTaGVtTWF0YmVhRW5nMz86IHN0cmluZztcbiAgb3V0UGlrTGlzdE1hdGJlYT86IHsgb3V0UGlrTGluZT86IFJhd0RlcG9zaXRMaW5lW10gfTtcbn07XG5cbnR5cGUgUmF3RGVwb3NpdHNSZXNwb25zZSA9IHtcbiAgTXlEZXBvc2l0c1NjcmVlbj86IHtcbiAgICBvdXROb0RhdGE/OiB1bmtub3duO1xuICAgIG91dE1hc2FjaFBpa2Rvbm90Pzoge1xuICAgICAgb3V0TWFzYWNoUGVyTXRiPzogeyBvdXRQaWtUYWJsZT86IFJhd0RlcG9zaXRDdXJyZW5jeUdyb3VwW10gfTtcbiAgICB9O1xuICB9O1xufTtcblxuZXhwb3J0IGNsYXNzIEJlaW5sZXVtaVBvcnRmb2xpb1NjcmFwZXIgZXh0ZW5kcyBCYXNlUG9ydGZvbGlvU2NyYXBlciB7XG4gIHByb3RlY3RlZCBhc3luYyBmZXRjaFBvcnRmb2xpbyhcbiAgICBwYWdlOiBQYWdlLFxuICAgIGNyZWRlbnRpYWxzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPixcbiAgKTogUHJvbWlzZTx7IHBvc2l0aW9uczogUG9ydGZvbGlvUG9zaXRpb25bXTsgY2FzaDogUG9ydGZvbGlvQ2FzaFtdOyBkZXBvc2l0czogUG9ydGZvbGlvRGVwb3NpdFtdOyBhc09mRGF0ZTogc3RyaW5nIH0+IHtcbiAgICBjb25zdCB1c2VybmFtZSA9IHR5cGVvZiBjcmVkZW50aWFsc1sndXNlcm5hbWUnXSA9PT0gJ3N0cmluZycgPyBjcmVkZW50aWFsc1sndXNlcm5hbWUnXSA6ICcnO1xuICAgIGNvbnN0IHBhc3N3b3JkID0gdHlwZW9mIGNyZWRlbnRpYWxzWydwYXNzd29yZCddID09PSAnc3RyaW5nJyA/IGNyZWRlbnRpYWxzWydwYXNzd29yZCddIDogJyc7XG4gICAgY29uc3Qgb3RwQ29kZVJldHJpZXZlciA9IGNyZWRlbnRpYWxzWydvdHBDb2RlUmV0cmlldmVyJ10gYXMgKCgpID0+IFByb21pc2U8c3RyaW5nPikgfCB1bmRlZmluZWQ7XG5cbiAgICBhd2FpdCB0aGlzLmxvZ2luKHBhZ2UsIHVzZXJuYW1lLCBwYXNzd29yZCwgb3RwQ29kZVJldHJpZXZlcik7XG4gICAgY29uc3QgeyBwb3NpdGlvbnMsIGFzT2ZEYXRlIH0gPSBhd2FpdCB0aGlzLmV4dHJhY3RQb3J0Zm9saW8ocGFnZSk7XG4gICAgY29uc3QgY2FzaCA9IGF3YWl0IHRoaXMuZXh0cmFjdENhc2gocGFnZSk7XG4gICAgLy8gUnVuIGxhc3Q6IGlmIHRoZSBkZXBvc2l0cyBoYXNoLW5hdmlnYXRpb24gZXZlciBtaXNiZWhhdmVzLCBwb3NpdGlvbnMvY2FzaCBhcmVcbiAgICAvLyBhbHJlYWR5IHNhZmVseSBjYXB0dXJlZCBiZWZvcmUgd2UgdG91Y2ggaXQuXG4gICAgY29uc3QgZGVwb3NpdHMgPSBhd2FpdCB0aGlzLmV4dHJhY3REZXBvc2l0cyhwYWdlKTtcblxuICAgIC8vIFRoZSBGSUJJIGNoZWNraW5nICjXoteVXCLXqSkgYmFsYW5jZSBpcyBlbWl0dGVkIGhlcmUgYXMgdGhlIFNJTkdMRSBzb3VyY2Ugb2YgdGhhdCB2YWx1ZSBmb3JcbiAgICAvLyBuZXQgd29ydGgg4oCUIGl0IG11c3QgbmV2ZXIgYWxzbyBiZSBjb3VudGVkIGFzIGEgc3RhbmRhbG9uZSBiYW5rLWFjY291bnQgbGluZSBlbHNld2hlcmUuXG4gICAgcmV0dXJuIHsgcG9zaXRpb25zLCBjYXNoLCBkZXBvc2l0cywgYXNPZkRhdGUgfTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgbG9naW4oXG4gICAgcGFnZTogUGFnZSxcbiAgICB1c2VybmFtZTogc3RyaW5nLFxuICAgIHBhc3N3b3JkOiBzdHJpbmcsXG4gICAgb3RwQ29kZVJldHJpZXZlcj86ICgpID0+IFByb21pc2U8c3RyaW5nPixcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgcGFnZS5nb3RvKExPR0lOX1VSTCwgeyB3YWl0VW50aWw6ICduZXR3b3JraWRsZTInLCB0aW1lb3V0OiA2MF8wMDAgfSk7XG4gICAgYXdhaXQgcGFnZS53YWl0Rm9yU2VsZWN0b3IoJyN1c2VybmFtZScsIHsgdGltZW91dDogMzBfMDAwIH0pO1xuICAgIGF3YWl0IHBhZ2UudHlwZSgnI3VzZXJuYW1lJywgdXNlcm5hbWUpO1xuICAgIGF3YWl0IHBhZ2UudHlwZSgnI3Bhc3N3b3JkJywgcGFzc3dvcmQpO1xuICAgIC8vIFRoZSBsb2dpbiBidXR0b24gY2xpY2sgZG9lc24ndCByZWdpc3RlciB3aXRob3V0IGEgc2hvcnQgc2V0dGxlIGRlbGF5XG4gICAgLy8gKHNhbWUgd29ya2Fyb3VuZCBhcyB0aGUgdHJhbnNhY3Rpb25zIHNjcmFwZXIncyBwcmVBY3Rpb24pLlxuICAgIGF3YWl0IG5ldyBQcm9taXNlKHIgPT4gc2V0VGltZW91dChyLCAxXzAwMCkpO1xuICAgIGF3YWl0IHBhZ2UuY2xpY2soJyNjb250aW51ZUJ0bicpO1xuXG4gICAgY29uc3Qgc3RhdGUgPSBhd2FpdCB3YWl0QW55KFxuICAgICAgcGFnZSxcbiAgICAgIFtPVFBfU0VORF9TTVNfU0VMRUNUT1IsICcjY2FyZC1oZWFkZXInLCAnI2FjY291bnRfbnVtJywgJyNtYXRhZkxvZ291dExpbmsnLCAnI3ZhbGlkYXRpb25Nc2cnXSxcbiAgICAgIDMwXzAwMCxcbiAgICApO1xuXG4gICAgaWYgKHN0YXRlID09PSAnI3ZhbGlkYXRpb25Nc2cnKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JlaW5sZXVtaSBsb2dpbiBmYWlsZWQ6IHZhbGlkYXRpb24gbWVzc2FnZSBzaG93biAoYmFkIGNyZWRlbnRpYWxzPyknKTtcbiAgICB9XG5cbiAgICBpZiAoc3RhdGUgPT09IE9UUF9TRU5EX1NNU19TRUxFQ1RPUikge1xuICAgICAgaWYgKCFvdHBDb2RlUmV0cmlldmVyKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignQmVpbmxldW1pIGxvZ2luIHJlcXVpcmVzIE9UUCBidXQgbm8gb3RwQ29kZVJldHJpZXZlciB3YXMgcHJvdmlkZWQnKTtcbiAgICAgIH1cbiAgICAgIGF3YWl0IHBhZ2UuY2xpY2soT1RQX1NFTkRfU01TX1NFTEVDVE9SKTtcbiAgICAgIGF3YWl0IHBhZ2Uud2FpdEZvclNlbGVjdG9yKE9UUF9JTlBVVF9TRUxFQ1RPUiwgeyB0aW1lb3V0OiAzMF8wMDAgfSk7XG4gICAgICBjb25zdCBjb2RlID0gYXdhaXQgb3RwQ29kZVJldHJpZXZlcigpO1xuICAgICAgYXdhaXQgcGFnZS50eXBlKE9UUF9JTlBVVF9TRUxFQ1RPUiwgY29kZSk7XG4gICAgICBhd2FpdCBwYWdlLmNsaWNrKE9UUF9TVUJNSVRfU0VMRUNUT1IpO1xuICAgICAgY29uc3QgcG9zdE90cCA9IGF3YWl0IHdhaXRBbnkocGFnZSwgWycjY2FyZC1oZWFkZXInLCAnI2FjY291bnRfbnVtJywgJyNtYXRhZkxvZ291dExpbmsnXSwgNjBfMDAwKTtcbiAgICAgIGlmICghcG9zdE90cCkgdGhyb3cgbmV3IEVycm9yKCdCZWlubGV1bWkgbG9naW46IGRhc2hib2FyZCBub3QgcmVhY2hlZCBhZnRlciBPVFAgc3VibWl0Jyk7XG4gICAgfSBlbHNlIGlmICghc3RhdGUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQmVpbmxldW1pIGxvZ2luOiBuZWl0aGVyIE9UUCBjaGFsbGVuZ2Ugbm9yIGRhc2hib2FyZCBhcHBlYXJlZCcpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0cyBob2xkaW5ncyBmcm9tIHRoZSBjbGFzc2ljIHNlY3VyaXRpZXMtcG9ydGZvbGlvIHBvcnRsZXQuXG4gICAqXG4gICAqIFdlIG11c3QgTk9UIG5hdmlnYXRlIHRoZSB0b3Agd2luZG93IHRvIFBPUlRGT0xJT19VUkw6IEZJQkkgbm93IHdyYXBzIGV2ZXJ5dGhpbmcgaW4gYVxuICAgKiBBbmd1bGFyIFwiUG9ydGFsTkdcIiBzaGVsbCB3aG9zZSBTU08gdG9rZW4gZXhjaGFuZ2UgcmFjZXMgb24gaGFyZCBuYXZpZ2F0aW9ucywgNDAxcywgYW5kXG4gICAqIGJvdW5jZXMgdGhlIHRhYiB0byB0aGUgcHVibGljIG1hcmtldGluZyBzaXRlICh3aG9zZSBjb29raWVDbGVhbmVyIHRoZW4gd2lwZXMgdGhlXG4gICAqIHNlc3Npb24pLiBJbnN0ZWFkIHdlIHN0YXkgb24gdGhlIHBvc3QtbG9naW4gc2hlbGwgcGFnZSBhbmQgaW5qZWN0IGEgc2FtZS1vcmlnaW4gaWZyYW1lXG4gICAqIHBvaW50aW5nIGF0IHRoZSBjbGFzc2ljIHBvcnRsZXQgVVJMIOKAlCB0aGUgaWZyYW1lIHJlbmRlcnMgdGhlIHBvcnRsZXQgKHJ1bm5pbmcgaXRzIEpTLFxuICAgKiB3aGljaCBwb3B1bGF0ZXMgdGhlICN0YWJsZTMyMiBEYXRhVGFibGUpIHdpdGhvdXQgZXZlciBtb3ZpbmcgdGhlIHRvcCBmcmFtZS5cbiAgICovXG4gIHByaXZhdGUgYXN5bmMgZXh0cmFjdFBvcnRmb2xpbyhwYWdlOiBQYWdlKTogUHJvbWlzZTx7IHBvc2l0aW9uczogUG9ydGZvbGlvUG9zaXRpb25bXTsgYXNPZkRhdGU6IHN0cmluZyB9PiB7XG4gICAgY29uc3QgSUZSQU1FX0lEID0gJ2licy1wb3J0Zm9saW8tcHJvYmUnO1xuXG4gICAgYXdhaXQgcGFnZS5ldmFsdWF0ZShcbiAgICAgIChpZDogc3RyaW5nLCB1cmw6IHN0cmluZykgPT4ge1xuICAgICAgICBjb25zdCBleGlzdGluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKTtcbiAgICAgICAgaWYgKGV4aXN0aW5nKSBleGlzdGluZy5yZW1vdmUoKTtcbiAgICAgICAgY29uc3QgaWZyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnaWZyYW1lJyk7XG4gICAgICAgIGlmci5pZCA9IGlkO1xuICAgICAgICBpZnIuc3R5bGUuY3NzVGV4dCA9ICdwb3NpdGlvbjphYnNvbHV0ZTtsZWZ0Oi05OTk5cHg7d2lkdGg6MTQwMHB4O2hlaWdodDoxMDAwcHgnO1xuICAgICAgICBpZnIuc3JjID0gdXJsO1xuICAgICAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGlmcik7XG4gICAgICB9LFxuICAgICAgSUZSQU1FX0lELFxuICAgICAgUE9SVEZPTElPX1VSTCxcbiAgICApO1xuXG4gICAgLy8gV2FpdCBmb3IgdGhlIHBvcnRsZXQncyBob2xkaW5ncyBEYXRhVGFibGUgdG8gcmVuZGVyIGluc2lkZSB0aGUgaWZyYW1lLlxuICAgIC8vIGAucmVndWxhcnRyMWAgcm93cyBhcmUgdGhlIGFjdHVhbCBzZWN1cml0eSByb3dzICh0ZW1wbGF0ZS9zdW1tYXJ5IHJvd3MgbGFjayBpdCkuXG4gICAgYXdhaXQgcGFnZS53YWl0Rm9yRnVuY3Rpb24oXG4gICAgICAoaWQ6IHN0cmluZykgPT4ge1xuICAgICAgICBjb25zdCBpZnIgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCkgYXMgSFRNTElGcmFtZUVsZW1lbnQgfCBudWxsO1xuICAgICAgICBjb25zdCBkb2MgPSBpZnI/LmNvbnRlbnREb2N1bWVudDtcbiAgICAgICAgaWYgKCFkb2MpIHJldHVybiBmYWxzZTtcbiAgICAgICAgLy8gRWl0aGVyIGF0IGxlYXN0IG9uZSBob2xkaW5nIHJvdywgb3IgdGhlIHBvcnRsZXQncyBcImVtcHR5IHBvcnRmb2xpb1wiIG1hcmtlci5cbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICBkb2MucXVlcnlTZWxlY3RvckFsbCgnI3RhYmxlMzIyIHRib2R5IHRyLnJlZ3VsYXJ0cjEnKS5sZW5ndGggPiAwIHx8XG4gICAgICAgICAgL9eQ15nXnyDXoNeZ15nXqNeV16p815zXkCDXoNee16bXkNeVLy50ZXN0KGRvYy5ib2R5Py5pbm5lclRleHQgPz8gJycpXG4gICAgICAgICk7XG4gICAgICB9LFxuICAgICAgeyB0aW1lb3V0OiA2MF8wMDAgfSxcbiAgICAgIElGUkFNRV9JRCxcbiAgICApO1xuXG4gICAgY29uc3QgZXh0cmFjdGVkID0gYXdhaXQgcGFnZS5ldmFsdWF0ZSgoaWQ6IHN0cmluZykgPT4ge1xuICAgICAgY29uc3QgaWZyID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpIGFzIEhUTUxJRnJhbWVFbGVtZW50IHwgbnVsbDtcbiAgICAgIGNvbnN0IGRvYyA9IGlmcj8uY29udGVudERvY3VtZW50O1xuICAgICAgaWYgKCFkb2MpIHJldHVybiB7IHJvd3M6IFtdIGFzIHN0cmluZ1tdW10sIGRhdGVUZXh0OiAnJyB9O1xuXG4gICAgICBjb25zdCByb3dzID0gQXJyYXkuZnJvbShkb2MucXVlcnlTZWxlY3RvckFsbCgnI3RhYmxlMzIyIHRib2R5IHRyLnJlZ3VsYXJ0cjEnKSkubWFwKHRyID0+XG4gICAgICAgIEFycmF5LmZyb20odHIucXVlcnlTZWxlY3RvckFsbCgndGQnKSkubWFwKHRkID0+ICh0ZCBhcyBIVE1MRWxlbWVudCkuaW5uZXJUZXh0LnJlcGxhY2UoL1xccysvZywgJyAnKS50cmltKCkpLFxuICAgICAgKTtcblxuICAgICAgLy8gXCLXqteZ16cg16DXmVwi16Ig16HXoNeZ16M6OCDXl9ep15HXldefOjU3NTU3MiDXqteQ16jXmdeaOjExLjA3LjIwMjYgLi4uXCIg4oCUIHB1bGwgdGhlIGFzLW9mIGRhdGUuXG4gICAgICBjb25zdCBib2R5VGV4dCA9IGRvYy5ib2R5Py5pbm5lclRleHQgPz8gJyc7XG4gICAgICBjb25zdCBkYXRlTWF0Y2ggPSBib2R5VGV4dC5tYXRjaCgv16rXkNeo15nXmjpcXHMqKFxcZHsyfSlcXC4oXFxkezJ9KVxcLihcXGR7NH0pLyk7XG4gICAgICBjb25zdCBkYXRlVGV4dCA9IGRhdGVNYXRjaCA/IGAke2RhdGVNYXRjaFszXX0tJHtkYXRlTWF0Y2hbMl19LSR7ZGF0ZU1hdGNoWzFdfWAgOiAnJztcblxuICAgICAgcmV0dXJuIHsgcm93cywgZGF0ZVRleHQgfTtcbiAgICB9LCBJRlJBTUVfSUQpO1xuXG4gICAgY29uc3QgYXNPZkRhdGUgPSBleHRyYWN0ZWQuZGF0ZVRleHQgfHwgbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcblxuICAgIC8vIENvbHVtbiBsYXlvdXQgb2YgYSBgdHIucmVndWxhcnRyMWAgcm93ICgxNCBjZWxscyksIHZlcmlmaWVkIGFnYWluc3QgdGhlIGxpdmUgcG9ydGxldDpcbiAgICAvLyAgMCBhY3Rpb24gKNenL9eeKSAgMSBuYW1lICAyIHF1YW50aXR5ICAzIGxhc3QtcmF0ZSAgNCBkYWlseS0lICA1IGFkai1jb3N0LXJhdGVcbiAgICAvLyAgNiBub21pbmFsLWNvc3QtcmF0ZSAgNyBhZGotUCZMIOKCqiAgOCBhZGotUCZMICUgIDkgbm9taW5hbC1QJkwg4oKqICAxMCBub21pbmFsLVAmTCAlXG4gICAgLy8gIDExIGhvbGRpbmctdmFsdWUg4oKqICAxMiBwb3J0Zm9saW8gJSAgMTMgKGVtcHR5KVxuICAgIC8vIFJhdGVzIGFyZSBxdW90ZWQgaW4gYWdvcm90ICjDtzEwMCksIHNhbWUgY29udmVudGlvbiBhcyB0aGUgUHNhZ290IHNjcmFwZXIuXG4gICAgY29uc3QgcG9zaXRpb25zOiBQb3J0Zm9saW9Qb3NpdGlvbltdID0gW107XG4gICAgZm9yIChjb25zdCBjZWxscyBvZiBleHRyYWN0ZWQucm93cykge1xuICAgICAgaWYgKGNlbGxzLmxlbmd0aCA8IDEyKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IG5hbWUgPSBjZWxsc1sxXSB8fCAnVW5rbm93bic7XG4gICAgICBjb25zdCBxdWFudGl0eSA9IHBhcnNlTnVtYmVyKGNlbGxzWzJdKTtcbiAgICAgIGNvbnN0IHByaWNlID0gcGFyc2VOdW1iZXIoY2VsbHNbM10pIC8gMTAwO1xuICAgICAgY29uc3QgYXZnQ29zdCA9IHBhcnNlTnVtYmVyKGNlbGxzWzVdKSAvIDEwMDtcbiAgICAgIGNvbnN0IHVucmVhbGl6ZWRQbmwgPSBwYXJzZU51bWJlcihjZWxsc1s3XSk7XG4gICAgICBjb25zdCBtYXJrZXRWYWx1ZSA9IHBhcnNlTnVtYmVyKGNlbGxzWzExXSk7XG4gICAgICBpZiAocXVhbnRpdHkgPT09IDAgJiYgbWFya2V0VmFsdWUgPT09IDApIGNvbnRpbnVlO1xuXG4gICAgICBwb3NpdGlvbnMucHVzaCh7XG4gICAgICAgIGlkZW50aWZpZXI6IGBiZWlubGV1bWktJHtuYW1lfWAsXG4gICAgICAgIG5hbWUsXG4gICAgICAgIHF1YW50aXR5LFxuICAgICAgICBwcmljZSxcbiAgICAgICAgYXZnQ29zdCxcbiAgICAgICAgdW5yZWFsaXplZFBubCxcbiAgICAgICAgY3VycmVuY3k6ICdJTFMnLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHsgcG9zaXRpb25zLCBhc09mRGF0ZSB9O1xuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHRoZSBjdXJyZW50INei15VcItepIGNoZWNraW5nIGJhbGFuY2UgYW5kIHJldHVybnMgaXQgYXMgSUxTIHBvcnRmb2xpbyBjYXNoLlxuICAgKlxuICAgKiBVc2VzIHRoZSBzYW1lIHNhbWUtb3JpZ2luLWlmcmFtZSB0ZWNobmlxdWUgYXMgZXh0cmFjdFBvcnRmb2xpbzogd2UgbXVzdCBOT1QgbmF2aWdhdGUgdGhlXG4gICAqIHRvcCBmcmFtZSAoRklCSSdzIFBvcnRhbE5HIFNTTyBleGNoYW5nZSByYWNlcyBvbiBoYXJkIG5hdmlnYXRpb25zIGFuZCBib3VuY2VzIHRoZSB0YWIgdG9cbiAgICogdGhlIHB1YmxpYyBzaXRlLCB3aG9zZSBjb29raWVDbGVhbmVyIHdpcGVzIHRoZSBzZXNzaW9uKS4gQmVzdC1lZmZvcnQ6IGFueSBmYWlsdXJlIHJldHVybnNcbiAgICogW10gc28gdGhlIHBvcnRmb2xpbyBzY3JhcGUgc3RpbGwgc3VjY2VlZHMgb24gaXRzIHBvc2l0aW9ucyBhbG9uZS5cbiAgICovXG4gIHByaXZhdGUgYXN5bmMgZXh0cmFjdENhc2gocGFnZTogUGFnZSk6IFByb21pc2U8UG9ydGZvbGlvQ2FzaFtdPiB7XG4gICAgY29uc3QgSUZSQU1FX0lEID0gJ2licy1iYWxhbmNlLXByb2JlJztcbiAgICB0cnkge1xuICAgICAgYXdhaXQgcGFnZS5ldmFsdWF0ZShcbiAgICAgICAgKGlkOiBzdHJpbmcsIHVybDogc3RyaW5nKSA9PiB7XG4gICAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCk7XG4gICAgICAgICAgaWYgKGV4aXN0aW5nKSBleGlzdGluZy5yZW1vdmUoKTtcbiAgICAgICAgICBjb25zdCBpZnIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdpZnJhbWUnKTtcbiAgICAgICAgICBpZnIuaWQgPSBpZDtcbiAgICAgICAgICBpZnIuc3R5bGUuY3NzVGV4dCA9ICdwb3NpdGlvbjphYnNvbHV0ZTtsZWZ0Oi05OTk5cHg7d2lkdGg6MTQwMHB4O2hlaWdodDoxMDAwcHgnO1xuICAgICAgICAgIGlmci5zcmMgPSB1cmw7XG4gICAgICAgICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChpZnIpO1xuICAgICAgICB9LFxuICAgICAgICBJRlJBTUVfSUQsXG4gICAgICAgIEJBTEFOQ0VfVVJMLFxuICAgICAgKTtcblxuICAgICAgYXdhaXQgcGFnZS53YWl0Rm9yRnVuY3Rpb24oXG4gICAgICAgIChpZDogc3RyaW5nKSA9PiB7XG4gICAgICAgICAgY29uc3QgaWZyID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpIGFzIEhUTUxJRnJhbWVFbGVtZW50IHwgbnVsbDtcbiAgICAgICAgICBjb25zdCBlbCA9IGlmcj8uY29udGVudERvY3VtZW50Py5xdWVyeVNlbGVjdG9yKCcubWFpbl9iYWxhbmNlJykgYXMgSFRNTEVsZW1lbnQgfCBudWxsO1xuICAgICAgICAgIHJldHVybiAhIWVsICYmIGVsLmlubmVyVGV4dC50cmltKCkubGVuZ3RoID4gMDtcbiAgICAgICAgfSxcbiAgICAgICAgeyB0aW1lb3V0OiA2MF8wMDAgfSxcbiAgICAgICAgSUZSQU1FX0lELFxuICAgICAgKTtcblxuICAgICAgY29uc3QgcmF3ID0gYXdhaXQgcGFnZS5ldmFsdWF0ZSgoaWQ6IHN0cmluZykgPT4ge1xuICAgICAgICBjb25zdCBpZnIgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCkgYXMgSFRNTElGcmFtZUVsZW1lbnQgfCBudWxsO1xuICAgICAgICBjb25zdCBlbCA9IGlmcj8uY29udGVudERvY3VtZW50Py5xdWVyeVNlbGVjdG9yKCcubWFpbl9iYWxhbmNlJykgYXMgSFRNTEVsZW1lbnQgfCBudWxsO1xuICAgICAgICByZXR1cm4gZWwgPyBlbC5pbm5lclRleHQgOiBudWxsO1xuICAgICAgfSwgSUZSQU1FX0lEKTtcblxuICAgICAgaWYgKHJhdyA9PSBudWxsKSByZXR1cm4gW107XG4gICAgICByZXR1cm4gW3sgY3VycmVuY3k6ICdJTFMnLCBhbW91bnQ6IHBhcnNlTnVtYmVyKHJhdykgfV07XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gW107XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHRlcm0gZGVwb3NpdHMvc2F2aW5ncyAoXCLXpNen15PXldeg15XXqiDXldeX16HXm9eV16DXldeqXCIpIGZyb20gdGhlIG1vZGVybiBBbmd1bGFyIHNoZWxsJ3NcbiAgICogbXlEZXBvc2l0cyByb3V0ZS4gVW5saWtlIGV4dHJhY3RQb3J0Zm9saW8vZXh0cmFjdENhc2ggdGhpcyBuZWVkcyBubyBpZnJhbWUgaW5qZWN0aW9uIGFuZFxuICAgKiBubyBET00gc2NyYXBpbmcgYXQgYWxsOiBwb3N0LWxvZ2luIEZJQkkgYWxyZWFkeSBsZWF2ZXMgdGhlIHRvcCBmcmFtZSBvbiB0aGUgc2hlbGxcbiAgICogZG9jdW1lbnQsIHNvIGEgc2FtZS1kb2N1bWVudCBoYXNoIGNoYW5nZSBpcyBlbm91Z2ggdG8gdHJpZ2dlciB0aGUgQW5ndWxhciByb3V0ZSAodmVyaWZpZWRcbiAgICogbGl2ZSDigJQgaXQgZG9lcyBub3QgYm91bmNlIHRoZSBzZXNzaW9uIHRoZSB3YXkgYSBoYXJkIG5hdmlnYXRpb24gdG8gYSBzaGVsbCBVUkwgd291bGQpLCBhbmRcbiAgICogdGhhdCByb3V0ZSBmaXJlcyBleGFjdGx5IG9uZSBKU09OIFJFU1QgY2FsbCAoYmZmLU15RGVwb3NpdHMpIHdpdGggZXZlcnl0aGluZyB3ZSBuZWVkLFxuICAgKiBpbmNsdWRpbmcgZWFjaCBkZXBvc2l0J3Mgb3duIGludGVyZXN0IHJhdGUg4oCUIG5vIFwibW9yZSBkZXRhaWxzXCIgY2xpY2sgcmVxdWlyZWQuXG4gICAqIEJlc3QtZWZmb3J0OiBhbnkgZmFpbHVyZSByZXR1cm5zIFtdIHNvIHRoZSBwb3J0Zm9saW8gc2NyYXBlIHN0aWxsIHN1Y2NlZWRzIG9uIGl0c1xuICAgKiBwb3NpdGlvbnMvY2FzaCBhbG9uZS5cbiAgICovXG4gIHByaXZhdGUgYXN5bmMgZXh0cmFjdERlcG9zaXRzKHBhZ2U6IFBhZ2UpOiBQcm9taXNlPFBvcnRmb2xpb0RlcG9zaXRbXT4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBvblNoZWxsID0gYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PlxuICAgICAgICBsb2NhdGlvbi5wYXRobmFtZS5pbmNsdWRlcygnL2FwcHNuZy9SZXNvdXJjZXMvUG9ydGFsTkcvc2hlbGwnKSxcbiAgICAgICk7XG4gICAgICBpZiAoIW9uU2hlbGwpIHJldHVybiBbXTtcblxuICAgICAgY29uc3QgcmVzcG9uc2VQcm9taXNlID0gcGFnZVxuICAgICAgICAud2FpdEZvclJlc3BvbnNlKFxuICAgICAgICAgIHJlcyA9PiByZXMudXJsKCkuaW5jbHVkZXMoREVQT1NJVFNfUkVTUE9OU0VfVVJMX0ZSQUdNRU5UKSAmJiByZXMucmVxdWVzdCgpLm1ldGhvZCgpID09PSAnR0VUJyxcbiAgICAgICAgICB7IHRpbWVvdXQ6IDMwXzAwMCB9LFxuICAgICAgICApXG4gICAgICAgIC5jYXRjaCgoKSA9PiBudWxsKTtcblxuICAgICAgYXdhaXQgcGFnZS5ldmFsdWF0ZSgoaGFzaDogc3RyaW5nKSA9PiB7XG4gICAgICAgIGxvY2F0aW9uLmhhc2ggPSBoYXNoO1xuICAgICAgfSwgREVQT1NJVFNfSEFTSF9ST1VURSk7XG5cbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgcmVzcG9uc2VQcm9taXNlO1xuICAgICAgaWYgKCFyZXNwb25zZSkgcmV0dXJuIFtdO1xuXG4gICAgICBjb25zdCBib2R5ID0gKGF3YWl0IHJlc3BvbnNlLmpzb24oKSkgYXMgUmF3RGVwb3NpdHNSZXNwb25zZTtcbiAgICAgIGNvbnN0IHNjcmVlbiA9IGJvZHkuTXlEZXBvc2l0c1NjcmVlbjtcbiAgICAgIGlmICghc2NyZWVuIHx8IHNjcmVlbi5vdXROb0RhdGEgIT0gbnVsbCkgcmV0dXJuIFtdO1xuXG4gICAgICBjb25zdCBncm91cHMgPSBzY3JlZW4ub3V0TWFzYWNoUGlrZG9ub3Q/Lm91dE1hc2FjaFBlck10Yj8ub3V0UGlrVGFibGUgPz8gW107XG4gICAgICBjb25zdCBkZXBvc2l0czogUG9ydGZvbGlvRGVwb3NpdFtdID0gW107XG5cbiAgICAgIGZvciAoY29uc3QgZ3JvdXAgb2YgZ3JvdXBzKSB7XG4gICAgICAgIGNvbnN0IGN1cnJlbmN5ID0gbm9ybWFsaXplRGVwb3NpdEN1cnJlbmN5KGdyb3VwLm91dFNoZW1NYXRiZWFFbmczKTtcbiAgICAgICAgY29uc3QgbGluZXMgPSBncm91cC5vdXRQaWtMaXN0TWF0YmVhPy5vdXRQaWtMaW5lID8/IFtdO1xuICAgICAgICBmb3IgKGNvbnN0IGxpbmUgb2YgbGluZXMpIHtcbiAgICAgICAgICBjb25zdCByYXRlTGluZSA9IGxpbmUub3V0UmliaXQ/Lm91dFJiSGFsdWZvdFRibD8ub3V0UmJIbGZMaW5lPy5bMF07XG4gICAgICAgICAgY29uc3QgaWRlbnRpZmllciA9IGxpbmUub3V0TWlzcGFyUGlrYWRvbiB8fCBsaW5lLm91dFBpa05vIHx8IGBiZWlubGV1bWktZGVwb3NpdC0ke2RlcG9zaXRzLmxlbmd0aH1gO1xuICAgICAgICAgIGRlcG9zaXRzLnB1c2goe1xuICAgICAgICAgICAgaWRlbnRpZmllcixcbiAgICAgICAgICAgIG5hbWU6IGxpbmUub3V0S2ludXlCeVVzZXIgfHwgaWRlbnRpZmllcixcbiAgICAgICAgICAgIGN1cnJlbmN5LFxuICAgICAgICAgICAgcHJpbmNpcGFsOiBwYXJzZU51bWJlcihsaW5lLm91dEtlcmVuUGtkKSxcbiAgICAgICAgICAgIGN1cnJlbnRWYWx1ZTogcGFyc2VOdW1iZXIobGluZS5vdXRTaG92aVBrZG4pLFxuICAgICAgICAgICAgbWF0dXJpdHlEYXRlOiBwYXJzZUlsRGF0ZShsaW5lLm91dFRyUGVyYW9uKSxcbiAgICAgICAgICAgIG9wZW5EYXRlOiBwYXJzZUlsRGF0ZShsaW5lLm91dE1vYWRpbU1lc2hpaG90SGFma2Fkb3Q/Lm91dFRyTW9lZEhhZmthZGEpLFxuICAgICAgICAgICAgaW50ZXJlc3RSYXRlUGVyY2VudDogcmF0ZUxpbmU/Lm91dFJiSGxmQWNodXpSYlRleHQgPyBwYXJzZU51bWJlcihyYXRlTGluZS5vdXRSYkhsZkFjaHV6UmJUZXh0KSA6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgIGxpbmthZ2U6IHJhdGVMaW5lPy5vdXRSYkhsZlRldXJTdWdIYXR6bWFkYSB8fCB1bmRlZmluZWQsXG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGRlcG9zaXRzO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cbiAgfVxufVxuIl0sIm1hcHBpbmdzIjoiOzs7Ozs7QUFDQSxJQUFBQSxxQkFBQSxHQUFBQyxPQUFBO0FBR0EsTUFBTUMsUUFBUSxHQUFHLDJCQUEyQjtBQUM1QyxNQUFNQyxTQUFTLEdBQUcsR0FBR0QsUUFBUSxnRkFBZ0Y7QUFDN0c7QUFDQTtBQUNBLE1BQU1FLGFBQWEsR0FBRyxHQUFHRixRQUFRLDBFQUEwRTtBQUMzRztBQUNBO0FBQ0EsTUFBTUcsV0FBVyxHQUFHLEdBQUdILFFBQVEsa0ZBQWtGO0FBQ2pIO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLE1BQU1JLG1CQUFtQixHQUFHLGNBQWM7QUFDMUMsTUFBTUMsOEJBQThCLEdBQUcsMENBQTBDOztBQUVqRjtBQUNBLE1BQU1DLHFCQUFxQixHQUFHLFVBQVU7QUFDeEMsTUFBTUMsa0JBQWtCLEdBQUcsWUFBWTtBQUN2QyxNQUFNQyxtQkFBbUIsR0FBRyxrQkFBa0I7QUFFOUMsZUFBZUMsT0FBT0EsQ0FBQ0MsSUFBVSxFQUFFQyxTQUFtQixFQUFFQyxPQUFlLEVBQTBCO0VBQy9GLE9BQU9DLE9BQU8sQ0FB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