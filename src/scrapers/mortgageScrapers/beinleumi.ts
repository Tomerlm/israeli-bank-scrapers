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
 * Extract mortgages from the classic portlet page using iframe injection.
 *
 * We must NOT navigate the top window to MORTGAGE_URL: FIBI's PortalNG shell bounces on hard
 * navigations and wipes the session. Instead, we inject a same-origin iframe pointing at the
 * classic portlet URL — the iframe renders the portlet without moving the top frame.
 *
 * Returns null if no mortgages found or iframe times out.
 */
async function extractMortgages(page: Page): Promise<MortgageAccount | null> {
  const IFRAME_ID = 'ibs-mortgage-probe';

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
      MORTGAGE_URL,
    );

    // Wait for the mortgage table to render. Allow for "no mortgages" message.
    await page.waitForFunction(
      (id: string) => {
        const ifr = document.getElementById(id) as HTMLIFrameElement | null;
        const doc = ifr?.contentDocument;
        if (!doc) return false;
        // Either at least one mortgage row, or "no mortgages" message
        return (
          doc.querySelectorAll('table tbody tr').length > 0 ||
          /אין משכנתאות|לא נמצאו|לא קיימות/.test(doc.body?.innerText ?? '')
        );
      },
      { timeout: 10_000 },
      IFRAME_ID,
    );

    // Extract mortgage data from the iframe
    const extracted = await page.evaluate((id: string) => {
      const ifr = document.getElementById(id) as HTMLIFrameElement | null;
      const doc = ifr?.contentDocument;
      if (!doc) return { rows: [] as Array<{ labelValues: Record<string, string> }>, dateText: '' };

      const rows = Array.from(doc.querySelectorAll('table tbody tr')).map((tr) => {
        const row = tr as HTMLTableRowElement;
        // Extract label-value pairs from this row
        // Using style="font-weight:bold" to detect label cells
        const labelValues: Record<string, string> = {};

        // Expected field labels (in Hebrew):
        // סוג המשכנתא / סוג הריבית (track type / interest type)
        // יתרת קרן (outstanding principal)
        // תשלום חודשי (monthly payment)
        // שיעור הריבית (interest rate)
        // טווח זמן שנותר (remaining term)
        // צמד ל- (linkage/indexation)
        // סכום המשכנתא המקורי (original loan amount)

        const cells = Array.from(row.querySelectorAll('td'));
        for (let i = 0; i < cells.length; i++) {
          const cell = cells[i] as HTMLElement;
          if (cell.style?.fontWeight === 'bold') {
            const label = cell.innerText?.trim() ?? '';
            const nextCell = cells[i + 1];
            const value = nextCell ? (nextCell as HTMLElement).innerText?.trim() ?? '' : '';
            if (label && value) {
              labelValues[label] = value;
            }
          }
        }

        return { labelValues };
      });

      // Extract as-of date from page text (if available)
      const bodyText = doc.body?.innerText ?? '';
      const dateMatch = bodyText.match(/תאריך:\s*(\d{2})\.(\d{2})\.(\d{4})/);
      const dateText = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : '';

      return { rows, dateText };
    }, IFRAME_ID);

    const asOfDate = extracted.dateText || new Date().toISOString().slice(0, 10);

    // Check if we found any mortgages
    if (extracted.rows.length === 0) {
      return null; // No mortgages — graceful exit
    }

    // Parse each row into a MortgageTrack
    const tracks: MortgageTrack[] = [];

    for (const rowData of extracted.rows) {
      const { labelValues } = rowData;

      // Map Hebrew labels to field names. These are approximate — actual page may vary.
      // Will be updated based on real discovery findings.
      const trackType = labelValues['סוג המשכנתא'] || labelValues['סוג הריבית'] || 'Unknown';
      const outstandingPrincipal = parseNumber(labelValues['יתרת קרן']);
      const monthlyPayment = parseNumber(labelValues['תשלום חודשי']);
      const interestRateStr = labelValues['שיעור הריבית'] || '';
      // Rate is already in percent — do NOT divide by 100
      const interestRate = parseNumber(interestRateStr);
      const remainingTermStr = labelValues['טווח זמן שנותר'] || '';
      // Parse remaining term (usually "X חודשים" = X months)
      const remainingTermMatch = remainingTermStr.match(/(\d+)/);
      const remainingTerm = remainingTermMatch ? parseInt(remainingTermMatch[1], 10) : null;
      const linkage = labelValues['צמד ל-'] || 'No Indexation';
      const originalAmount = parseNumber(labelValues['סכום המשכנתא המקורי']);

      // Skip rows with zero outstanding balance (likely headers or empty rows)
      if (outstandingPrincipal === 0) continue;

      tracks.push({
        trackType,
        originalLoanAmountIls: originalAmount,
        outstandingPrincipalIls: outstandingPrincipal,
        monthlyPaymentIls: monthlyPayment,
        interestRatePercent: interestRate,
        remainingTermMonths: remainingTerm,
        linkage,
        asOfDate,
      });
    }

    if (tracks.length === 0) {
      return null; // No valid mortgage tracks found
    }

    return {
      lender: 'בנק לאומי', // Beinleumi in Hebrew (for consistency)
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
