import { type Page } from 'puppeteer';
import type { MortgageAccount, MortgageTrack } from './types';

const BASE_URL = 'https://online.fibi.co.il';
const LOGIN_URL = `${BASE_URL}/MatafLoginService/MatafLoginServlet?bankId=FIBIPORTAL&site=Private&KODSAFA=HE`;
// Classic portlet page for mortgage/loan listings. Rendered client-side by WebSphere portlet.
const MORTGAGE_URL = `${BASE_URL}/wps/myportal/FibiMenu/Online/OnLoansMortgageMenu/OnMortgages/mortgageList`;

// Same login selectors as the portfolio scraper (from base-beinleumi-group.ts)
const OTP_SEND_SMS_SELECTOR = '#sendSms';
const OTP_INPUT_SELECTOR = '#codeinput';
const OTP_SUBMIT_SELECTOR = '.otpSubmitButton';

/**
 * Race multiple selectors and return which one appeared first.
 * Returns null if none appeared within timeout.
 */
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

/**
 * Parse a number string, stripping currency symbols, percentage signs, and RTL marks.
 */
function parseNumber(raw: string | undefined): number {
  if (!raw) return 0;
  // Strip currency symbols (₪, $, €), thousands separators (,), percentage signs (%), RTL marks (‎, ‏), and whitespace
  const cleaned = raw.replace(/[₪$€,\s‎‏]/g, '').replace(/%$/, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Login to Beinleumi using the MatafLoginServlet (classic Mataf session).
 * Handles optional OTP challenge.
 */
async function loginBeinleumi(
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
  await new Promise((r) => setTimeout(r, 1_000));
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
 * Compute whole months between an as-of date (YYYY-MM-DD) and a future
 * "last payment" date (dd.mm.yyyy). Returns null if the date can't be parsed.
 */
function monthsBetween(asOfIso: string, lastPaymentDmy: string | null): number | null {
  if (!lastPaymentDmy) return null;
  const m = lastPaymentDmy.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return null;
  const last = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const asOf = new Date(asOfIso);
  if (Number.isNaN(last.getTime()) || Number.isNaN(asOf.getTime())) return null;
  const months = (last.getFullYear() - asOf.getFullYear()) * 12 + (last.getMonth() - asOf.getMonth());
  return months > 0 ? months : null;
}

/**
 * Extract mortgages from the classic portlet page using iframe injection.
 *
 * We must NOT navigate the top window to MORTGAGE_URL: FIBI's PortalNG shell bounces on hard
 * navigations and wipes the session. Instead, we inject a same-origin iframe pointing at the
 * classic portlet URL — the iframe renders the portlet without moving the top frame.
 *
 * Flow (verified against the live page on 2026-07-15, account 008-575572):
 *   1. Inject iframe → MORTGAGE_URL (the mortgage *summary* page "המשכנתאות שלי").
 *      This page has ONLY aggregate totals + a per-track-type breakdown — NO per-loan
 *      detail. It exposes a "לפירוט משכנתאות >" link: `javascript:goToBackasha(<id>)`.
 *   2. Read the backasha id from that link and call goToBackasha(id) inside the iframe.
 *      This navigates the portlet (in place, no top-window bounce) to the *detail* page
 *      "פירוט משכנתאות", which renders one `table.tbl_layout` per mortgage sub-track,
 *      each carrying its own rate / principal / monthly payment / original amount / term.
 *   3. Parse each sub-track table into a MortgageTrack.
 *
 * Returns null if no mortgages found or the iframe/detail page times out.
 */
async function extractMortgages(page: Page): Promise<MortgageAccount | null> {
  const IFRAME_ID = 'ibs-mortgage-probe';

  try {
    // ── Step 1: inject the iframe pointing at the mortgage summary page ────────
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
      MORTGAGE_URL,
    );

    // Wait for the summary page to render: either the "details" navigation link
    // (goToBackasha) appears, or an explicit "no mortgages" message.
    await page.waitForFunction(
      (id: string) => {
        const ifr = document.getElementById(id) as HTMLIFrameElement | null;
        const doc = ifr?.contentDocument;
        if (!doc) return false;
        const hasDetailLink = Array.from(doc.querySelectorAll('a')).some((a) =>
          /goToBackasha\(\s*\d+\s*\)/.test(a.getAttribute('href') ?? ''),
        );
        const noMortgages = /אין משכנתאות|לא נמצאו|לא קיימות/.test(doc.body?.innerText ?? '');
        return hasDetailLink || noMortgages;
      },
      { timeout: 30_000 },
      IFRAME_ID,
    );

    // Read the backasha id from the "לפירוט משכנתאות >" link.
    const backashaId = await page.evaluate((id: string) => {
      const ifr = document.getElementById(id) as HTMLIFrameElement | null;
      const doc = ifr?.contentDocument;
      if (!doc) return null;
      const link = Array.from(doc.querySelectorAll('a')).find((a) =>
        /goToBackasha\(\s*\d+\s*\)/.test(a.getAttribute('href') ?? ''),
      );
      if (!link) return null;
      const m = (link.getAttribute('href') ?? '').match(/goToBackasha\(\s*(\d+)\s*\)/);
      return m ? Number(m[1]) : null;
    }, IFRAME_ID);

    // No detail link → no mortgages on this account. Graceful exit.
    if (backashaId == null) {
      return null;
    }

    // ── Step 2: navigate the portlet to the per-loan detail page ──────────────
    await page.evaluate(
      (id: string, bid: number) => {
        const ifr = document.getElementById(id) as HTMLIFrameElement | null;
        const win = ifr?.contentWindow as (Window & { goToBackasha?: (n: number) => void }) | null;
        win?.goToBackasha?.(bid);
      },
      IFRAME_ID,
      backashaId,
    );

    // Wait for the detail page: at least one per-sub-track table
    // ("ריבית נוכחית (ליום מסירת המידע)" + "מסלול:") must render.
    await page.waitForFunction(
      (id: string) => {
        const ifr = document.getElementById(id) as HTMLIFrameElement | null;
        const doc = ifr?.contentDocument;
        if (!doc) return false;
        return Array.from(doc.querySelectorAll('table')).some(
          (t) =>
            /ריבית נוכחית \(ליום מסירת המידע\)/.test((t as HTMLElement).innerText) &&
            /מסלול:/.test((t as HTMLElement).innerText),
        );
      },
      { timeout: 30_000 },
      IFRAME_ID,
    );

    // ── Step 3: parse every sub-track table into raw label→value records ──────
    const extracted = await page.evaluate((id: string) => {
      const ifr = document.getElementById(id) as HTMLIFrameElement | null;
      const doc = ifr?.contentDocument;
      if (!doc) return { tracks: [] as Array<Record<string, string>>, dateText: '' };

      // Each mortgage sub-track is a table carrying both the "current interest
      // rate" label and the "track:" label. Within it, labels and values are
      // adjacent cells: [ ..., "label:", "value", ... ].
      const subTrackTables = Array.from(doc.querySelectorAll('table')).filter(
        (t) =>
          /ריבית נוכחית \(ליום מסירת המידע\)/.test((t as HTMLElement).innerText) &&
          /מסלול:/.test((t as HTMLElement).innerText),
      );

      const grab = (table: Element, label: string): string => {
        const rows = Array.from(table.querySelectorAll('tr'));
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll('td,th')).map((c) =>
            (c as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
          );
          for (let j = 0; j < cells.length - 1; j++) {
            if (cells[j].indexOf(label) === 0) return cells[j + 1];
          }
        }
        return '';
      };

      const tracks = subTrackTables.map((t) => ({
        trackType: grab(t, 'מסלול:'),
        rate: grab(t, 'ריבית נוכחית (ליום מסירת המידע):'),
        // "יתרה לסילוק" (balance to settle) is the true payoff the bank shows as
        // the account total; it reconciles to the summary headline total.
        balance: grab(t, 'יתרה לסילוק'),
        original: grab(t, 'סכום תת הלוואה מקורי:'),
        monthly: grab(t, 'תשלום אחרון לחיוב'),
        linkage: grab(t, 'בסיס ההצמדה:'),
        lastPayment: grab(t, 'המועד הצפוי לתשלום האחרון:'),
      }));

      // As-of date: prefer "נכון ל:dd/mm/yyyy", fall back to "תאריך:dd/mm/yyyy".
      const bodyText = doc.body?.innerText ?? '';
      const dateMatch =
        bodyText.match(/נכון ל:\s*(\d{2})\/(\d{2})\/(\d{4})/) ||
        bodyText.match(/תאריך:\s*(\d{2})\/(\d{2})\/(\d{4})/);
      const dateText = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : '';

      return { tracks, dateText };
    }, IFRAME_ID);

    const asOfDate = extracted.dateText || new Date().toISOString().slice(0, 10);

    const tracks: MortgageTrack[] = extracted.tracks
      .map((raw) => ({
        trackType: raw.trackType || 'Unknown',
        originalLoanAmountIls: parseNumber(raw.original),
        // Rate is already in PERCENT — do NOT divide by 100 (different from Psagot).
        outstandingPrincipalIls: parseNumber(raw.balance),
        monthlyPaymentIls: parseNumber(raw.monthly),
        interestRatePercent: parseNumber(raw.rate),
        remainingTermMonths: monthsBetween(asOfDate, raw.lastPayment || null),
        linkage: raw.linkage || 'לא צמודה',
        asOfDate,
      }))
      // Drop any table that yielded no outstanding balance (defensive).
      .filter((t) => t.outstandingPrincipalIls > 0);

    if (tracks.length === 0) {
      return null; // No usable mortgage tracks — graceful exit.
    }

    return {
      lender: 'בנק לאומי', // Beinleumi in Hebrew
      currency: 'ILS',
      tracks,
      asOfDate,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // Timeout or parse error — log and return null (graceful, like securities scraper)
    if (msg.includes('timeout') || msg.includes('Timeout')) {
      return null;
    }
    throw error;
  }
}

/**
 * Extract mortgages from Beinleumi via MatafLoginServlet + iframe injection.
 *
 * @param page Puppeteer page with active browser
 * @param credentials Object with username, password, and optional otpCodeRetriever
 * @returns MortgageAccount with all tracks, or null if none found
 */
export async function extractBeinleumiMortgages(
  page: Page,
  credentials: Record<string, unknown>,
): Promise<MortgageAccount | null> {
  const username = typeof credentials['username'] === 'string' ? credentials['username'] : '';
  const password = typeof credentials['password'] === 'string' ? credentials['password'] : '';
  const otpCodeRetriever = credentials['otpCodeRetriever'] as (() => Promise<string>) | undefined;

  await loginBeinleumi(page, username, password, otpCodeRetriever);
  return extractMortgages(page);
}

/**
 * Factory function for creating a Beinleumi mortgage scraper.
 * Follows the same pattern as portfolio and pension scrapers.
 */
export function createBeinleumiMortgageScraper() {
  return {
    bank: 'Beinleumi',
    extractMortgages: (page: Page, credentials: Record<string, unknown>) =>
      extractBeinleumiMortgages(page, credentials),
  };
}
