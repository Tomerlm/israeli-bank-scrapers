"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SwiftnessPensionScraper = void 0;
exports.normalizeHolding = normalizeHolding;
exports.numOrNull = numOrNull;
var _basePensionScraper = require("./base-pension-scraper");
const LOGIN_URL = 'https://auth.swiftness.co.il/login';
const SAVER_HOST = 'savernew.swiftness.co.il';
const API_MARKER = 'getSavingProductsDetails';
const MARK_ID_INPUT = 'ibs-swiftness-id';
const MARK_PHONE_INPUT = 'ibs-swiftness-phone';
const MARK_OTP_PREFIX = 'ibs-swiftness-otp';

// ── normalizeHolding & helpers (pure, unit-testable) ──────────────────────

function strVal(v, fallback = '') {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return fallback;
}
function numVal(v, fallback = 0) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
const COVERAGE_FIELDS = ['lossWorkingCapacityMonthly', 'accumulatedMateSurvivalPension', 'accumulatedChildSurvivalPension', 'accumulatedParentSurvivalPension', 'deathInsuranceAmountMonthly', 'deathInsuranceAmountOnce'];
function buildCoverage(p) {
  const coverage = {};
  for (const key of COVERAGE_FIELDS) {
    const n = numOrNull(p[key]);
    if (n !== null && n !== 0) coverage[key] = n;
  }
  return Object.keys(coverage).length > 0 ? coverage : null;
}
function monthlyDeposit(employee, employer) {
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
function normalizeHolding(p) {
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
    coverage: buildCoverage(p)
  };
}

// ── DOM helpers ─────────────────────────────────────────────────────────
// The auth.swiftness.co.il / savernew.swiftness.co.il portal has no known stable
// selectors, so inputs/buttons are located by label/placeholder text (falling back to
// input order) and "marked" with a data attribute that a subsequent page.type() targets.
// This keeps real key events (needed for Angular-style reactive forms) while remaining
// mockable in tests.

async function clickButtonByText(page, text) {
  return page.evaluate(function clickButtonByTextInPage(t) {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === t);
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }, text);
}
async function markInputByLabel(page, labelText, mark, fallbackIndex) {
  return page.evaluate(function markInputByLabelInPage(text, markAttr, nth) {
    const inputs = Array.from(document.querySelectorAll('input'));
    let el = inputs.find(i => (i.getAttribute('aria-label') ?? '').includes(text)) ?? inputs.find(i => (i.getAttribute('placeholder') ?? '').includes(text));
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
  }, labelText, mark, fallbackIndex);
}
async function fillIdAndPhone(page, id, phone) {
  await page.waitForFunction(function inputsReady() {
    return document.querySelectorAll('input').length >= 1;
  }, {
    timeout: 30_000
  });
  const idMarked = await markInputByLabel(page, 'מספר תעודת זהות', MARK_ID_INPUT, 0);
  const phoneMarked = await markInputByLabel(page, 'מספר נייד', MARK_PHONE_INPUT, 1);
  if (!idMarked || !phoneMarked) {
    throw new Error('Swiftness login: could not locate ID/phone inputs');
  }
  await page.type(`input[data-ibs-mark="${MARK_ID_INPUT}"]`, id);
  await page.type(`input[data-ibs-mark="${MARK_PHONE_INPUT}"]`, phone);
}
async function markOtpInputs(page, markPrefix) {
  return page.evaluate(function markOtpInputsInPage(prefix) {
    let candidates = Array.from(document.querySelectorAll('input[maxlength="1"]'));
    if (candidates.length < 6) {
      candidates = Array.from(document.querySelectorAll('input'));
    }
    candidates.slice(0, 6).forEach((el, i) => el.setAttribute('data-ibs-mark', `${prefix}-${i}`));
    return Math.min(candidates.length, 6);
  }, markPrefix);
}
async function readSwiftnessKey(page) {
  return page.evaluate(function readSwiftnessKeyFromStorage() {
    return localStorage.getItem('cachedSwiftnessKey');
  });
}
class SwiftnessPensionScraper extends _basePensionScraper.BasePensionScraper {
  async fetchPension(page, credentials) {
    const id = typeof credentials['id'] === 'string' ? credentials['id'] : '';
    const phone = typeof credentials['phone'] === 'string' ? credentials['phone'] : '';
    const otpChannel = credentials['otpChannel'] === 'email' ? 'email' : 'sms';
    const otpCodeRetriever = credentials['otpCodeRetriever'];

    // ── Interceptor: the getSavingProductsDetails API response ───────────
    let capturedProducts;
    // The saver desktop's own API calls (e.g. getDesktopEventStatus?swiftnessKey=<uuid>) carry the
    // per-retrieval swiftnessKey — capture it from any request URL rather than relying on it being
    // in localStorage (it isn't, until you navigate into a holdings page) or on DOM clicking.
    let capturedSwiftnessKey = null;
    page.on('request', request => {
      const m = /swiftnessKey=([0-9a-fA-F-]{36})/.exec(request.url());
      if (m && !capturedSwiftnessKey) capturedSwiftnessKey = m[1];
    });
    page.on('response', response => {
      const url = response.url();
      if (!url.includes(API_MARKER)) return;
      void response.json().then(body => {
        const arr = body?.savingProductsDetails;
        if (Array.isArray(arr)) capturedProducts = arr;
      }).catch(() => undefined);
    });

    // ── 1. Login (skipped if a persistent session is already authenticated) ─
    // A caller may pass --user-data-dir in args to persist the session across runs; if that session
    // is still valid we land on the saver domain authenticated and can skip the whole login/OTP.
    await page.goto(`https://${SAVER_HOST}/`, {
      waitUntil: 'networkidle2',
      timeout: 60_000
    }).catch(() => undefined);
    const alreadyAuthed = page.url().includes(SAVER_HOST) && (await page.evaluate(() => !!localStorage.getItem('auth_token')).catch(() => false));
    if (!alreadyAuthed) {
      await page.goto(LOGIN_URL, {
        waitUntil: 'networkidle2',
        timeout: 60_000
      });
      // eslint-disable-next-line no-console
      console.log('[swiftness-scraper] login page loaded');
      const toggleText = otpChannel === 'email' ? 'מייל' : 'סמס';
      await clickButtonByText(page, toggleText);
      await fillIdAndPhone(page, id, phone);
      await page.waitForFunction(function continueEnabled() {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'המשך');
        return !!btn && !btn.disabled;
      }, {
        timeout: 15_000
      }).catch(() => undefined);
      await clickButtonByText(page, 'המשך');
      // eslint-disable-next-line no-console
      console.log('[swiftness-scraper] submitted id/phone, channel:', otpChannel);

      // ── 2. OTP (optional) ─────────────────────────────────────────────
      const otpAppeared = await page.waitForFunction(function otpReady() {
        return document.querySelectorAll('input[maxlength="1"]').length >= 6 || document.querySelectorAll('input').length >= 6;
      }, {
        timeout: 20_000
      }).then(() => true).catch(() => false);
      if (otpAppeared && otpCodeRetriever) {
        // eslint-disable-next-line no-console
        console.log('[swiftness-scraper] OTP required');
        const count = await markOtpInputs(page, MARK_OTP_PREFIX);
        if (count >= 6) {
          const code = await otpCodeRetriever();
          // These OTP boxes are a React component that auto-advances focus on each keystroke.
          // Setting values programmatically fights its internal state (only some digits stick).
          // The reliable way is to focus the first box and type the whole code as real keystrokes,
          // letting the component advance focus box-to-box itself — exactly like a human.
          await page.focus(`input[data-ibs-mark="${MARK_OTP_PREFIX}-0"]`);
          await page.keyboard.type(code, {
            delay: 80
          });
        }
      }

      // ── 3. Wait for redirect to the saver desktop ─────────────────────
      try {
        await page.waitForFunction(function onSaverDomain(host) {
          return location.hostname.includes(host);
        }, {
          timeout: 60_000
        }, SAVER_HOST);
      } catch (e) {
        // Diagnostic: capture what the page looks like when the post-OTP redirect never happens
        // (e.g. an OTP-rejected error still on the auth screen).
        try {
          await page.screenshot({
            path: `/tmp/swiftness-otp-fail-${Date.now()}.png`
          });
          const visible = await page.evaluate(() => document.body.innerText.slice(0, 400));
          // eslint-disable-next-line no-console
          console.log('[swiftness-scraper] post-OTP redirect failed; page text:', visible);
        } catch {
          // ignore diagnostic failures
        }
        throw e;
      }
      // eslint-disable-next-line no-console
      console.log('[swiftness-scraper] logged in, redirected to savernew');
    } else {
      // eslint-disable-next-line no-console
      console.log('[swiftness-scraper] reusing existing authenticated session, skipping login');
    }

    // ── 4. Resolve swiftnessKey and reach the holdings page ────────────
    // The swiftnessKey lands either in the desktop's own API request URLs (captured above) or in
    // localStorage (cachedSwiftnessKey) a few seconds after the desktop finishes loading — poll both.
    let swiftnessKey = null;
    {
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        swiftnessKey = capturedSwiftnessKey ?? (await readSwiftnessKey(page).catch(() => null));
        if (swiftnessKey) break;
        await new Promise(r => setTimeout(r, 500));
      }
    }
    if (!swiftnessKey) {
      // Fallback: wait for the completed-request card to render, then click it to navigate in.
      // eslint-disable-next-line no-console
      console.log('[swiftness-scraper] swiftnessKey not captured, waiting for completed-request button');
      await page.waitForFunction(function completedRequestButtonReady() {
        return Array.from(document.querySelectorAll('button')).some(b => (b.textContent ?? '').includes('מידע מלא'));
      }, {
        timeout: 45_000
      }).catch(() => undefined);
      await page.evaluate(function clickCompletedRequest() {
        const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent ?? '').includes('מידע מלא'));
        if (btn instanceof HTMLElement) btn.click();
      });
      await page.waitForFunction(function swiftnessKeyInUrl() {
        return location.href.includes('swiftnessKey=');
      }, {
        timeout: 30_000
      }).catch(() => undefined);
      const match = /swiftnessKey=([^&]+)/.exec(page.url());
      swiftnessKey = capturedSwiftnessKey ?? (match ? match[1] : null) ?? (await readSwiftnessKey(page));
    }
    if (!swiftnessKey) {
      throw new Error('Swiftness: could not resolve swiftnessKey after login');
    }
    // eslint-disable-next-line no-console
    console.log('[swiftness-scraper] resolved swiftnessKey');
    await page.goto(`https://${SAVER_HOST}/holdings/myProducts?swiftnessKey=${swiftnessKey}&eventType=9100`, {
      waitUntil: 'networkidle2',
      timeout: 60_000
    });

    // ── 5. Poll for the intercepted products response ──────────────────
    const products = await new Promise((resolve, reject) => {
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
    const holdings = [];
    for (const raw of products) {
      try {
        holdings.push(normalizeHolding(raw));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.log('[swiftness-scraper] skipping unparsable product row:', e instanceof Error ? e.message : String(e));
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[swiftness-scraper] done — ${holdings.length} holdings`);
    return {
      holdings,
      asOfDate: new Date().toISOString().slice(0, 10)
    };
  }
}
exports.SwiftnessPensionScraper = SwiftnessPensionScraper;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfYmFzZVBlbnNpb25TY3JhcGVyIiwicmVxdWlyZSIsIkxPR0lOX1VSTCIsIlNBVkVSX0hPU1QiLCJBUElfTUFSS0VSIiwiTUFSS19JRF9JTlBVVCIsIk1BUktfUEhPTkVfSU5QVVQiLCJNQVJLX09UUF9QUkVGSVgiLCJzdHJWYWwiLCJ2IiwiZmFsbGJhY2siLCJTdHJpbmciLCJudW1WYWwiLCJ1bmRlZmluZWQiLCJuIiwiTnVtYmVyIiwiaXNGaW5pdGUiLCJudW1Pck51bGwiLCJDT1ZFUkFHRV9GSUVMRFMiLCJidWlsZENvdmVyYWdlIiwicCIsImNvdmVyYWdlIiwia2V5IiwiT2JqZWN0Iiwia2V5cyIsImxlbmd0aCIsIm1vbnRobHlEZXBvc2l0IiwiZW1wbG95ZWUiLCJlbXBsb3llciIsImVtcEFic2VudCIsImVyQWJzZW50Iiwibm9ybWFsaXplSG9sZGluZyIsInByb2R1Y3RUeXBlIiwibWFuYWdpbmdDb21wYW55IiwicG9saWN5TnVtYmVyIiwiYmFsYW5jZUlscyIsImZlZUZyb21CYWxhbmNlUGN0IiwiZmVlRnJvbURlcG9zaXRQY3QiLCJ0cmFjayIsInN0YXR1cyIsInlpZWxkUGN0IiwibW9udGhseURlcG9zaXRJbHMiLCJwcm9qZWN0ZWRQZW5zaW9uSWxzIiwiY2xpY2tCdXR0b25CeVRleHQiLCJwYWdlIiwidGV4dCIsImV2YWx1YXRlIiwiY2xpY2tCdXR0b25CeVRleHRJblBhZ2UiLCJ0IiwiYnRuIiwiQXJyYXkiLCJmcm9tIiwiZG9jdW1lbnQiLCJxdWVyeVNlbGVjdG9yQWxsIiwiZmluZCIsImIiLCJ0ZXh0Q29udGVudCIsInRyaW0iLCJjbGljayIsIm1hcmtJbnB1dEJ5TGFiZWwiLCJsYWJlbFRleHQiLCJtYXJrIiwiZmFsbGJhY2tJbmRleCIsIm1hcmtJbnB1dEJ5TGFiZWxJblBhZ2UiLCJtYXJrQXR0ciIsIm50aCIsImlucHV0cyIsImVsIiwiaSIsImdldEF0dHJpYnV0ZSIsImluY2x1ZGVzIiwibGFiZWwiLCJsIiwiZm9ySWQiLCJieUlkIiwiZ2V0RWxlbWVudEJ5SWQiLCJIVE1MSW5wdXRFbGVtZW50IiwibmVzdGVkIiwicXVlcnlTZWxlY3RvciIsInNpYmxpbmciLCJwYXJlbnRFbGVtZW50Iiwic2V0QXR0cmlidXRlIiwiZmlsbElkQW5kUGhvbmUiLCJpZCIsInBob25lIiwid2FpdEZvckZ1bmN0aW9uIiwiaW5wdXRzUmVhZHkiLCJ0aW1lb3V0IiwiaWRNYXJrZWQiLCJwaG9uZU1hcmtlZCIsIkVycm9yIiwidHlwZSIsIm1hcmtPdHBJbnB1dHMiLCJtYXJrUHJlZml4IiwibWFya090cElucHV0c0luUGFnZSIsInByZWZpeCIsImNhbmRpZGF0ZXMiLCJzbGljZSIsImZvckVhY2giLCJNYXRoIiwibWluIiwicmVhZFN3aWZ0bmVzc0tleSIsInJlYWRTd2lmdG5lc3NLZXlGcm9tU3RvcmFnZSIsImxvY2FsU3RvcmFnZSIsImdldEl0ZW0iLCJTd2lmdG5lc3NQZW5zaW9uU2NyYXBlciIsIkJhc2VQZW5zaW9uU2NyYXBlciIsImZldGNoUGVuc2lvbiIsImNyZWRlbnRpYWxzIiwib3RwQ2hhbm5lbCIsIm90cENvZGVSZXRyaWV2ZXIiLCJjYXB0dXJlZFByb2R1Y3RzIiwiY2FwdHVyZWRTd2lmdG5lc3NLZXkiLCJvbiIsInJlcXVlc3QiLCJtIiwiZXhlYyIsInVybCIsInJlc3BvbnNlIiwianNvbiIsInRoZW4iLCJib2R5IiwiYXJyIiwic2F2aW5nUHJvZHVjdHNEZXRhaWxzIiwiaXNBcnJheSIsImNhdGNoIiwiZ290byIsIndhaXRVbnRpbCIsImFscmVhZHlBdXRoZWQiLCJjb25zb2xlIiwibG9nIiwidG9nZ2xlVGV4dCIsImNvbnRpbnVlRW5hYmxlZCIsImRpc2FibGVkIiwib3RwQXBwZWFyZWQiLCJvdHBSZWFkeSIsImNvdW50IiwiY29kZSIsImZvY3VzIiwia2V5Ym9hcmQiLCJkZWxheSIsIm9uU2F2ZXJEb21haW4iLCJob3N0IiwibG9jYXRpb24iLCJob3N0bmFtZSIsImUiLCJzY3JlZW5zaG90IiwicGF0aCIsIkRhdGUiLCJub3ciLCJ2aXNpYmxlIiwiaW5uZXJUZXh0Iiwic3dpZnRuZXNzS2V5IiwiZGVhZGxpbmUiLCJQcm9taXNlIiwiciIsInNldFRpbWVvdXQiLCJjb21wbGV0ZWRSZXF1ZXN0QnV0dG9uUmVhZHkiLCJzb21lIiwiY2xpY2tDb21wbGV0ZWRSZXF1ZXN0IiwiSFRNTEVsZW1lbnQiLCJzd2lmdG5lc3NLZXlJblVybCIsImhyZWYiLCJtYXRjaCIsInByb2R1Y3RzIiwicmVzb2x2ZSIsInJlamVjdCIsImNoZWNrIiwic2V0SW50ZXJ2YWwiLCJjbGVhckludGVydmFsIiwiaG9sZGluZ3MiLCJyYXciLCJwdXNoIiwibWVzc2FnZSIsImFzT2ZEYXRlIiwidG9JU09TdHJpbmciLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vc3JjL3BlbnNpb24tc2NyYXBlcnMvc3dpZnRuZXNzLnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHR5cGUgUGFnZSB9IGZyb20gJ3B1cHBldGVlcic7XG5pbXBvcnQgeyBCYXNlUGVuc2lvblNjcmFwZXIgfSBmcm9tICcuL2Jhc2UtcGVuc2lvbi1zY3JhcGVyJztcbmltcG9ydCB0eXBlIHsgUGVuc2lvbkhvbGRpbmdPdXRwdXQgfSBmcm9tICcuL2ludGVyZmFjZSc7XG5cbmNvbnN0IExPR0lOX1VSTCA9ICdodHRwczovL2F1dGguc3dpZnRuZXNzLmNvLmlsL2xvZ2luJztcbmNvbnN0IFNBVkVSX0hPU1QgPSAnc2F2ZXJuZXcuc3dpZnRuZXNzLmNvLmlsJztcbmNvbnN0IEFQSV9NQVJLRVIgPSAnZ2V0U2F2aW5nUHJvZHVjdHNEZXRhaWxzJztcblxuY29uc3QgTUFSS19JRF9JTlBVVCA9ICdpYnMtc3dpZnRuZXNzLWlkJztcbmNvbnN0IE1BUktfUEhPTkVfSU5QVVQgPSAnaWJzLXN3aWZ0bmVzcy1waG9uZSc7XG5jb25zdCBNQVJLX09UUF9QUkVGSVggPSAnaWJzLXN3aWZ0bmVzcy1vdHAnO1xuXG4vLyDilIDilIAgbm9ybWFsaXplSG9sZGluZyAmIGhlbHBlcnMgKHB1cmUsIHVuaXQtdGVzdGFibGUpIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG5mdW5jdGlvbiBzdHJWYWwodjogdW5rbm93biwgZmFsbGJhY2sgPSAnJyk6IHN0cmluZyB7XG4gIGlmICh0eXBlb2YgdiA9PT0gJ3N0cmluZycpIHJldHVybiB2O1xuICBpZiAodHlwZW9mIHYgPT09ICdudW1iZXInKSByZXR1cm4gU3RyaW5nKHYpO1xuICByZXR1cm4gZmFsbGJhY2s7XG59XG5cbmZ1bmN0aW9uIG51bVZhbCh2OiB1bmtub3duLCBmYWxsYmFjayA9IDApOiBudW1iZXIge1xuICBpZiAodiA9PT0gbnVsbCB8fCB2ID09PSB1bmRlZmluZWQgfHwgdiA9PT0gJycpIHJldHVybiBmYWxsYmFjaztcbiAgY29uc3QgbiA9IE51bWJlcih2KTtcbiAgcmV0dXJuIE51bWJlci5pc0Zpbml0ZShuKSA/IG4gOiBmYWxsYmFjaztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG51bU9yTnVsbCh2OiB1bmtub3duKTogbnVtYmVyIHwgbnVsbCB7XG4gIGlmICh2ID09PSBudWxsIHx8IHYgPT09IHVuZGVmaW5lZCB8fCB2ID09PSAnJykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IG4gPSBOdW1iZXIodik7XG4gIHJldHVybiBOdW1iZXIuaXNGaW5pdGUobikgPyBuIDogbnVsbDtcbn1cblxuY29uc3QgQ09WRVJBR0VfRklFTERTID0gW1xuICAnbG9zc1dvcmtpbmdDYXBhY2l0eU1vbnRobHknLFxuICAnYWNjdW11bGF0ZWRNYXRlU3Vydml2YWxQZW5zaW9uJyxcbiAgJ2FjY3VtdWxhdGVkQ2hpbGRTdXJ2aXZhbFBlbnNpb24nLFxuICAnYWNjdW11bGF0ZWRQYXJlbnRTdXJ2aXZhbFBlbnNpb24nLFxuICAnZGVhdGhJbnN1cmFuY2VBbW91bnRNb250aGx5JyxcbiAgJ2RlYXRoSW5zdXJhbmNlQW1vdW50T25jZScsXG5dIGFzIGNvbnN0O1xuXG5mdW5jdGlvbiBidWlsZENvdmVyYWdlKHA6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCBudWxsIHtcbiAgY29uc3QgY292ZXJhZ2U6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge307XG4gIGZvciAoY29uc3Qga2V5IG9mIENPVkVSQUdFX0ZJRUxEUykge1xuICAgIGNvbnN0IG4gPSBudW1Pck51bGwocFtrZXldKTtcbiAgICBpZiAobiAhPT0gbnVsbCAmJiBuICE9PSAwKSBjb3ZlcmFnZVtrZXldID0gbjtcbiAgfVxuICByZXR1cm4gT2JqZWN0LmtleXMoY292ZXJhZ2UpLmxlbmd0aCA+IDAgPyBjb3ZlcmFnZSA6IG51bGw7XG59XG5cbmZ1bmN0aW9uIG1vbnRobHlEZXBvc2l0KGVtcGxveWVlOiB1bmtub3duLCBlbXBsb3llcjogdW5rbm93bik6IG51bWJlciB8IG51bGwge1xuICBjb25zdCBlbXBBYnNlbnQgPSBlbXBsb3llZSA9PT0gbnVsbCB8fCBlbXBsb3llZSA9PT0gdW5kZWZpbmVkIHx8IGVtcGxveWVlID09PSAnJztcbiAgY29uc3QgZXJBYnNlbnQgPSBlbXBsb3llciA9PT0gbnVsbCB8fCBlbXBsb3llciA9PT0gdW5kZWZpbmVkIHx8IGVtcGxveWVyID09PSAnJztcbiAgaWYgKGVtcEFic2VudCAmJiBlckFic2VudCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiBudW1WYWwoZW1wbG95ZWUpICsgbnVtVmFsKGVtcGxveWVyKTtcbn1cblxuLyoqXG4gKiBNYXBzIGEgc2luZ2xlIGBzYXZpbmdQcm9kdWN0c0RldGFpbHNbaV1gIG9iamVjdCAoZnJvbSB0aGUgU3dpZnRuZXNzXG4gKiBgZ2V0U2F2aW5nUHJvZHVjdHNEZXRhaWxzYCBBUEkpIHRvIGZpbmRhc2gncyBgUGVuc2lvbkhvbGRpbmdJbnB1dGAgc2hhcGUuXG4gKiBTZWUgZG9jcy9zdXBlcnBvd2Vycy9zcGVjcy8yMDI2LTA3LTEzLXN3aWZ0bmVzcy1hcGktZGlzY292ZXJ5Lm1kIGZvciB0aGUgZmllbGQgbWFwcGluZy5cbiAqXG4gKiBgdHJhY2tgIChpbnZlc3RtZW50IHRyYWNrKSBoYXMgbm8gY2xlYW4gZmllbGQgaW4gdGhpcyBBUEkgcmVzcG9uc2Ug4oCUIGZpcnN0IGN1dCBzZW5kcyAnJy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZUhvbGRpbmcocDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiBQZW5zaW9uSG9sZGluZ091dHB1dCB7XG4gIHJldHVybiB7XG4gICAgcHJvZHVjdFR5cGU6IHN0clZhbChwWydwcm9kdWN0VHlwZU5hbWUnXSksXG4gICAgbWFuYWdpbmdDb21wYW55OiBzdHJWYWwocFsnbWFudWZhY3R1cmVyTmFtZSddKSxcbiAgICBwb2xpY3lOdW1iZXI6IHN0clZhbChwWydwb2xpY3lOdW1iZXInXSksXG4gICAgYmFsYW5jZUlsczogbnVtVmFsKHBbJ2FjY3VtdWxhdGVkQmFsYW5jZSddKSxcbiAgICBmZWVGcm9tQmFsYW5jZVBjdDogbnVtVmFsKHBbJ3llYWxyeU1hbmFnZW1lbnRGZWVQZXJjZW50QWdncmVnYXRpb24nXSksXG4gICAgZmVlRnJvbURlcG9zaXRQY3Q6IG51bVZhbChwWyd5ZWFscnlNYW5hZ2VtZW50RmVlUGVyY2VudERlcG9zaXQnXSksXG4gICAgdHJhY2s6ICcnLFxuICAgIHN0YXR1czogc3RyVmFsKHBbJ3BvbGljeVN0YXR1c05hbWUnXSksXG4gICAgeWllbGRQY3Q6IG51bU9yTnVsbChwWyduZXRZaWVsZFBlcmNlbnQnXSksXG4gICAgbW9udGhseURlcG9zaXRJbHM6IG1vbnRobHlEZXBvc2l0KHBbJ2RlcG9zaXRBbW91bnRFbXBsb3llZSddLCBwWydkZXBvc2l0QW1vdW50RW1wbG95ZXInXSksXG4gICAgcHJvamVjdGVkUGVuc2lvbklsczogbnVtT3JOdWxsKHBbJ2FjY3VtdWxhdGVkT2xkQWdlUGVuc2lvbiddKSxcbiAgICBjb3ZlcmFnZTogYnVpbGRDb3ZlcmFnZShwKSxcbiAgfTtcbn1cblxuLy8g4pSA4pSAIERPTSBoZWxwZXJzIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuLy8gVGhlIGF1dGguc3dpZnRuZXNzLmNvLmlsIC8gc2F2ZXJuZXcuc3dpZnRuZXNzLmNvLmlsIHBvcnRhbCBoYXMgbm8ga25vd24gc3RhYmxlXG4vLyBzZWxlY3RvcnMsIHNvIGlucHV0cy9idXR0b25zIGFyZSBsb2NhdGVkIGJ5IGxhYmVsL3BsYWNlaG9sZGVyIHRleHQgKGZhbGxpbmcgYmFjayB0b1xuLy8gaW5wdXQgb3JkZXIpIGFuZCBcIm1hcmtlZFwiIHdpdGggYSBkYXRhIGF0dHJpYnV0ZSB0aGF0IGEgc3Vic2VxdWVudCBwYWdlLnR5cGUoKSB0YXJnZXRzLlxuLy8gVGhpcyBrZWVwcyByZWFsIGtleSBldmVudHMgKG5lZWRlZCBmb3IgQW5ndWxhci1zdHlsZSByZWFjdGl2ZSBmb3Jtcykgd2hpbGUgcmVtYWluaW5nXG4vLyBtb2NrYWJsZSBpbiB0ZXN0cy5cblxuYXN5bmMgZnVuY3Rpb24gY2xpY2tCdXR0b25CeVRleHQocGFnZTogUGFnZSwgdGV4dDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIHJldHVybiBwYWdlLmV2YWx1YXRlKGZ1bmN0aW9uIGNsaWNrQnV0dG9uQnlUZXh0SW5QYWdlKHQ6IHN0cmluZykge1xuICAgIGNvbnN0IGJ0biA9IEFycmF5LmZyb20oZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnYnV0dG9uJykpLmZpbmQoYiA9PiBiLnRleHRDb250ZW50Py50cmltKCkgPT09IHQpO1xuICAgIGlmIChidG4pIHtcbiAgICAgIGJ0bi5jbGljaygpO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfSwgdGV4dCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIG1hcmtJbnB1dEJ5TGFiZWwocGFnZTogUGFnZSwgbGFiZWxUZXh0OiBzdHJpbmcsIG1hcms6IHN0cmluZywgZmFsbGJhY2tJbmRleDogbnVtYmVyKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIHJldHVybiBwYWdlLmV2YWx1YXRlKFxuICAgIGZ1bmN0aW9uIG1hcmtJbnB1dEJ5TGFiZWxJblBhZ2UodGV4dDogc3RyaW5nLCBtYXJrQXR0cjogc3RyaW5nLCBudGg6IG51bWJlcikge1xuICAgICAgY29uc3QgaW5wdXRzID0gQXJyYXkuZnJvbShkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCdpbnB1dCcpKTtcbiAgICAgIGxldCBlbDogSFRNTElucHV0RWxlbWVudCB8IHVuZGVmaW5lZCA9XG4gICAgICAgIGlucHV0cy5maW5kKGkgPT4gKGkuZ2V0QXR0cmlidXRlKCdhcmlhLWxhYmVsJykgPz8gJycpLmluY2x1ZGVzKHRleHQpKSA/P1xuICAgICAgICBpbnB1dHMuZmluZChpID0+IChpLmdldEF0dHJpYnV0ZSgncGxhY2Vob2xkZXInKSA/PyAnJykuaW5jbHVkZXModGV4dCkpO1xuICAgICAgaWYgKCFlbCkge1xuICAgICAgICBjb25zdCBsYWJlbCA9IEFycmF5LmZyb20oZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnbGFiZWwnKSkuZmluZChsID0+IGwudGV4dENvbnRlbnQ/LmluY2x1ZGVzKHRleHQpKTtcbiAgICAgICAgaWYgKGxhYmVsKSB7XG4gICAgICAgICAgY29uc3QgZm9ySWQgPSBsYWJlbC5nZXRBdHRyaWJ1dGUoJ2ZvcicpO1xuICAgICAgICAgIGlmIChmb3JJZCkge1xuICAgICAgICAgICAgY29uc3QgYnlJZCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGZvcklkKTtcbiAgICAgICAgICAgIGlmIChieUlkIGluc3RhbmNlb2YgSFRNTElucHV0RWxlbWVudCkgZWwgPSBieUlkO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoIWVsKSB7XG4gICAgICAgICAgICBjb25zdCBuZXN0ZWQgPSBsYWJlbC5xdWVyeVNlbGVjdG9yKCdpbnB1dCcpO1xuICAgICAgICAgICAgaWYgKG5lc3RlZCkgZWwgPSBuZXN0ZWQ7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICghZWwpIHtcbiAgICAgICAgICAgIGNvbnN0IHNpYmxpbmcgPSBsYWJlbC5wYXJlbnRFbGVtZW50Py5xdWVyeVNlbGVjdG9yKCdpbnB1dCcpO1xuICAgICAgICAgICAgaWYgKHNpYmxpbmcpIGVsID0gc2libGluZztcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmICghZWwpIGVsID0gaW5wdXRzW250aF07XG4gICAgICBpZiAoIWVsKSByZXR1cm4gZmFsc2U7XG4gICAgICBlbC5zZXRBdHRyaWJ1dGUoJ2RhdGEtaWJzLW1hcmsnLCBtYXJrQXR0cik7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9LFxuICAgIGxhYmVsVGV4dCxcbiAgICBtYXJrLFxuICAgIGZhbGxiYWNrSW5kZXgsXG4gICk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZpbGxJZEFuZFBob25lKHBhZ2U6IFBhZ2UsIGlkOiBzdHJpbmcsIHBob25lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgYXdhaXQgcGFnZS53YWl0Rm9yRnVuY3Rpb24oXG4gICAgZnVuY3Rpb24gaW5wdXRzUmVhZHkoKSB7XG4gICAgICByZXR1cm4gZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnaW5wdXQnKS5sZW5ndGggPj0gMTtcbiAgICB9LFxuICAgIHsgdGltZW91dDogMzBfMDAwIH0sXG4gICk7XG4gIGNvbnN0IGlkTWFya2VkID0gYXdhaXQgbWFya0lucHV0QnlMYWJlbChwYWdlLCAn157Xodek16gg16rXoteV15PXqiDXlteU15XXqicsIE1BUktfSURfSU5QVVQsIDApO1xuICBjb25zdCBwaG9uZU1hcmtlZCA9IGF3YWl0IG1hcmtJbnB1dEJ5TGFiZWwocGFnZSwgJ9ee16HXpNeoINeg15nXmdeTJywgTUFSS19QSE9ORV9JTlBVVCwgMSk7XG4gIGlmICghaWRNYXJrZWQgfHwgIXBob25lTWFya2VkKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdTd2lmdG5lc3MgbG9naW46IGNvdWxkIG5vdCBsb2NhdGUgSUQvcGhvbmUgaW5wdXRzJyk7XG4gIH1cbiAgYXdhaXQgcGFnZS50eXBlKGBpbnB1dFtkYXRhLWlicy1tYXJrPVwiJHtNQVJLX0lEX0lOUFVUfVwiXWAsIGlkKTtcbiAgYXdhaXQgcGFnZS50eXBlKGBpbnB1dFtkYXRhLWlicy1tYXJrPVwiJHtNQVJLX1BIT05FX0lOUFVUfVwiXWAsIHBob25lKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbWFya090cElucHV0cyhwYWdlOiBQYWdlLCBtYXJrUHJlZml4OiBzdHJpbmcpOiBQcm9taXNlPG51bWJlcj4ge1xuICByZXR1cm4gcGFnZS5ldmFsdWF0ZShmdW5jdGlvbiBtYXJrT3RwSW5wdXRzSW5QYWdlKHByZWZpeDogc3RyaW5nKSB7XG4gICAgbGV0IGNhbmRpZGF0ZXM6IEVsZW1lbnRbXSA9IEFycmF5LmZyb20oZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnaW5wdXRbbWF4bGVuZ3RoPVwiMVwiXScpKTtcbiAgICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPCA2KSB7XG4gICAgICBjYW5kaWRhdGVzID0gQXJyYXkuZnJvbShkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCdpbnB1dCcpKTtcbiAgICB9XG4gICAgY2FuZGlkYXRlcy5zbGljZSgwLCA2KS5mb3JFYWNoKChlbCwgaSkgPT4gZWwuc2V0QXR0cmlidXRlKCdkYXRhLWlicy1tYXJrJywgYCR7cHJlZml4fS0ke2l9YCkpO1xuICAgIHJldHVybiBNYXRoLm1pbihjYW5kaWRhdGVzLmxlbmd0aCwgNik7XG4gIH0sIG1hcmtQcmVmaXgpO1xufVxuXG5hc3luYyBmdW5jdGlvbiByZWFkU3dpZnRuZXNzS2V5KHBhZ2U6IFBhZ2UpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgcmV0dXJuIHBhZ2UuZXZhbHVhdGUoZnVuY3Rpb24gcmVhZFN3aWZ0bmVzc0tleUZyb21TdG9yYWdlKCkge1xuICAgIHJldHVybiBsb2NhbFN0b3JhZ2UuZ2V0SXRlbSgnY2FjaGVkU3dpZnRuZXNzS2V5Jyk7XG4gIH0pO1xufVxuXG5leHBvcnQgY2xhc3MgU3dpZnRuZXNzUGVuc2lvblNjcmFwZXIgZXh0ZW5kcyBCYXNlUGVuc2lvblNjcmFwZXIge1xuICBwcm90ZWN0ZWQgYXN5bmMgZmV0Y2hQZW5zaW9uKFxuICAgIHBhZ2U6IFBhZ2UsXG4gICAgY3JlZGVudGlhbHM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICApOiBQcm9taXNlPHsgaG9sZGluZ3M6IFBlbnNpb25Ib2xkaW5nT3V0cHV0W107IGFzT2ZEYXRlOiBzdHJpbmcgfT4ge1xuICAgIGNvbnN0IGlkID0gdHlwZW9mIGNyZWRlbnRpYWxzWydpZCddID09PSAnc3RyaW5nJyA/IGNyZWRlbnRpYWxzWydpZCddIDogJyc7XG4gICAgY29uc3QgcGhvbmUgPSB0eXBlb2YgY3JlZGVudGlhbHNbJ3Bob25lJ10gPT09ICdzdHJpbmcnID8gY3JlZGVudGlhbHNbJ3Bob25lJ10gOiAnJztcbiAgICBjb25zdCBvdHBDaGFubmVsID0gY3JlZGVudGlhbHNbJ290cENoYW5uZWwnXSA9PT0gJ2VtYWlsJyA/ICdlbWFpbCcgOiAnc21zJztcbiAgICBjb25zdCBvdHBDb2RlUmV0cmlldmVyID0gY3JlZGVudGlhbHNbJ290cENvZGVSZXRyaWV2ZXInXSBhcyAoKCkgPT4gUHJvbWlzZTxzdHJpbmc+KSB8IHVuZGVmaW5lZDtcblxuICAgIC8vIOKUgOKUgCBJbnRlcmNlcHRvcjogdGhlIGdldFNhdmluZ1Byb2R1Y3RzRGV0YWlscyBBUEkgcmVzcG9uc2Ug4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgbGV0IGNhcHR1cmVkUHJvZHVjdHM6IHVua25vd25bXSB8IHVuZGVmaW5lZDtcbiAgICAvLyBUaGUgc2F2ZXIgZGVza3RvcCdzIG93biBBUEkgY2FsbHMgKGUuZy4gZ2V0RGVza3RvcEV2ZW50U3RhdHVzP3N3aWZ0bmVzc0tleT08dXVpZD4pIGNhcnJ5IHRoZVxuICAgIC8vIHBlci1yZXRyaWV2YWwgc3dpZnRuZXNzS2V5IOKAlCBjYXB0dXJlIGl0IGZyb20gYW55IHJlcXVlc3QgVVJMIHJhdGhlciB0aGFuIHJlbHlpbmcgb24gaXQgYmVpbmdcbiAgICAvLyBpbiBsb2NhbFN0b3JhZ2UgKGl0IGlzbid0LCB1bnRpbCB5b3UgbmF2aWdhdGUgaW50byBhIGhvbGRpbmdzIHBhZ2UpIG9yIG9uIERPTSBjbGlja2luZy5cbiAgICBsZXQgY2FwdHVyZWRTd2lmdG5lc3NLZXk6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAgIHBhZ2Uub24oJ3JlcXVlc3QnLCByZXF1ZXN0ID0+IHtcbiAgICAgIGNvbnN0IG0gPSAvc3dpZnRuZXNzS2V5PShbMC05YS1mQS1GLV17MzZ9KS8uZXhlYyhyZXF1ZXN0LnVybCgpKTtcbiAgICAgIGlmIChtICYmICFjYXB0dXJlZFN3aWZ0bmVzc0tleSkgY2FwdHVyZWRTd2lmdG5lc3NLZXkgPSBtWzFdO1xuICAgIH0pO1xuICAgIHBhZ2Uub24oJ3Jlc3BvbnNlJywgcmVzcG9uc2UgPT4ge1xuICAgICAgY29uc3QgdXJsID0gcmVzcG9uc2UudXJsKCk7XG4gICAgICBpZiAoIXVybC5pbmNsdWRlcyhBUElfTUFSS0VSKSkgcmV0dXJuO1xuICAgICAgdm9pZCByZXNwb25zZVxuICAgICAgICAuanNvbigpXG4gICAgICAgIC50aGVuKChib2R5OiB1bmtub3duKSA9PiB7XG4gICAgICAgICAgY29uc3QgYXJyID0gKGJvZHkgYXMgeyBzYXZpbmdQcm9kdWN0c0RldGFpbHM/OiB1bmtub3duW10gfSk/LnNhdmluZ1Byb2R1Y3RzRGV0YWlscztcbiAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShhcnIpKSBjYXB0dXJlZFByb2R1Y3RzID0gYXJyO1xuICAgICAgICB9KVxuICAgICAgICAuY2F0Y2goKCkgPT4gdW5kZWZpbmVkKTtcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgCAxLiBMb2dpbiAoc2tpcHBlZCBpZiBhIHBlcnNpc3RlbnQgc2Vzc2lvbiBpcyBhbHJlYWR5IGF1dGhlbnRpY2F0ZWQpIOKUgFxuICAgIC8vIEEgY2FsbGVyIG1heSBwYXNzIC0tdXNlci1kYXRhLWRpciBpbiBhcmdzIHRvIHBlcnNpc3QgdGhlIHNlc3Npb24gYWNyb3NzIHJ1bnM7IGlmIHRoYXQgc2Vzc2lvblxuICAgIC8vIGlzIHN0aWxsIHZhbGlkIHdlIGxhbmQgb24gdGhlIHNhdmVyIGRvbWFpbiBhdXRoZW50aWNhdGVkIGFuZCBjYW4gc2tpcCB0aGUgd2hvbGUgbG9naW4vT1RQLlxuICAgIGF3YWl0IHBhZ2UuZ290byhgaHR0cHM6Ly8ke1NBVkVSX0hPU1R9L2AsIHsgd2FpdFVudGlsOiAnbmV0d29ya2lkbGUyJywgdGltZW91dDogNjBfMDAwIH0pLmNhdGNoKCgpID0+IHVuZGVmaW5lZCk7XG4gICAgY29uc3QgYWxyZWFkeUF1dGhlZCA9XG4gICAgICBwYWdlLnVybCgpLmluY2x1ZGVzKFNBVkVSX0hPU1QpICYmXG4gICAgICAoYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiAhIWxvY2FsU3RvcmFnZS5nZXRJdGVtKCdhdXRoX3Rva2VuJykpLmNhdGNoKCgpID0+IGZhbHNlKSk7XG4gICAgaWYgKCFhbHJlYWR5QXV0aGVkKSB7XG4gICAgICBhd2FpdCBwYWdlLmdvdG8oTE9HSU5fVVJMLCB7IHdhaXRVbnRpbDogJ25ldHdvcmtpZGxlMicsIHRpbWVvdXQ6IDYwXzAwMCB9KTtcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gICAgICBjb25zb2xlLmxvZygnW3N3aWZ0bmVzcy1zY3JhcGVyXSBsb2dpbiBwYWdlIGxvYWRlZCcpO1xuXG4gICAgY29uc3QgdG9nZ2xlVGV4dCA9IG90cENoYW5uZWwgPT09ICdlbWFpbCcgPyAn157XmdeZ15wnIDogJ9eh157XoSc7XG4gICAgYXdhaXQgY2xpY2tCdXR0b25CeVRleHQocGFnZSwgdG9nZ2xlVGV4dCk7XG5cbiAgICBhd2FpdCBmaWxsSWRBbmRQaG9uZShwYWdlLCBpZCwgcGhvbmUpO1xuXG4gICAgYXdhaXQgcGFnZVxuICAgICAgLndhaXRGb3JGdW5jdGlvbihcbiAgICAgICAgZnVuY3Rpb24gY29udGludWVFbmFibGVkKCkge1xuICAgICAgICAgIGNvbnN0IGJ0biA9IEFycmF5LmZyb20oZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnYnV0dG9uJykpLmZpbmQoYiA9PiBiLnRleHRDb250ZW50Py50cmltKCkgPT09ICfXlNee16nXmicpO1xuICAgICAgICAgIHJldHVybiAhIWJ0biAmJiAhYnRuLmRpc2FibGVkO1xuICAgICAgICB9LFxuICAgICAgICB7IHRpbWVvdXQ6IDE1XzAwMCB9LFxuICAgICAgKVxuICAgICAgLmNhdGNoKCgpID0+IHVuZGVmaW5lZCk7XG4gICAgYXdhaXQgY2xpY2tCdXR0b25CeVRleHQocGFnZSwgJ9eU157XqdeaJyk7XG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgICBjb25zb2xlLmxvZygnW3N3aWZ0bmVzcy1zY3JhcGVyXSBzdWJtaXR0ZWQgaWQvcGhvbmUsIGNoYW5uZWw6Jywgb3RwQ2hhbm5lbCk7XG5cbiAgICAvLyDilIDilIAgMi4gT1RQIChvcHRpb25hbCkg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgY29uc3Qgb3RwQXBwZWFyZWQgPSBhd2FpdCBwYWdlXG4gICAgICAud2FpdEZvckZ1bmN0aW9uKFxuICAgICAgICBmdW5jdGlvbiBvdHBSZWFkeSgpIHtcbiAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnaW5wdXRbbWF4bGVuZ3RoPVwiMVwiXScpLmxlbmd0aCA+PSA2IHx8XG4gICAgICAgICAgICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCdpbnB1dCcpLmxlbmd0aCA+PSA2XG4gICAgICAgICAgKTtcbiAgICAgICAgfSxcbiAgICAgICAgeyB0aW1lb3V0OiAyMF8wMDAgfSxcbiAgICAgIClcbiAgICAgIC50aGVuKCgpID0+IHRydWUpXG4gICAgICAuY2F0Y2goKCkgPT4gZmFsc2UpO1xuXG4gICAgaWYgKG90cEFwcGVhcmVkICYmIG90cENvZGVSZXRyaWV2ZXIpIHtcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gICAgICBjb25zb2xlLmxvZygnW3N3aWZ0bmVzcy1zY3JhcGVyXSBPVFAgcmVxdWlyZWQnKTtcbiAgICAgIGNvbnN0IGNvdW50ID0gYXdhaXQgbWFya090cElucHV0cyhwYWdlLCBNQVJLX09UUF9QUkVGSVgpO1xuICAgICAgaWYgKGNvdW50ID49IDYpIHtcbiAgICAgICAgY29uc3QgY29kZSA9IGF3YWl0IG90cENvZGVSZXRyaWV2ZXIoKTtcbiAgICAgICAgLy8gVGhlc2UgT1RQIGJveGVzIGFyZSBhIFJlYWN0IGNvbXBvbmVudCB0aGF0IGF1dG8tYWR2YW5jZXMgZm9jdXMgb24gZWFjaCBrZXlzdHJva2UuXG4gICAgICAgIC8vIFNldHRpbmcgdmFsdWVzIHByb2dyYW1tYXRpY2FsbHkgZmlnaHRzIGl0cyBpbnRlcm5hbCBzdGF0ZSAob25seSBzb21lIGRpZ2l0cyBzdGljaykuXG4gICAgICAgIC8vIFRoZSByZWxpYWJsZSB3YXkgaXMgdG8gZm9jdXMgdGhlIGZpcnN0IGJveCBhbmQgdHlwZSB0aGUgd2hvbGUgY29kZSBhcyByZWFsIGtleXN0cm9rZXMsXG4gICAgICAgIC8vIGxldHRpbmcgdGhlIGNvbXBvbmVudCBhZHZhbmNlIGZvY3VzIGJveC10by1ib3ggaXRzZWxmIOKAlCBleGFjdGx5IGxpa2UgYSBodW1hbi5cbiAgICAgICAgYXdhaXQgcGFnZS5mb2N1cyhgaW5wdXRbZGF0YS1pYnMtbWFyaz1cIiR7TUFSS19PVFBfUFJFRklYfS0wXCJdYCk7XG4gICAgICAgIGF3YWl0IHBhZ2Uua2V5Ym9hcmQudHlwZShjb2RlLCB7IGRlbGF5OiA4MCB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyDilIDilIAgMy4gV2FpdCBmb3IgcmVkaXJlY3QgdG8gdGhlIHNhdmVyIGRlc2t0b3Ag4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHBhZ2Uud2FpdEZvckZ1bmN0aW9uKFxuICAgICAgICBmdW5jdGlvbiBvblNhdmVyRG9tYWluKGhvc3Q6IHN0cmluZykge1xuICAgICAgICAgIHJldHVybiBsb2NhdGlvbi5ob3N0bmFtZS5pbmNsdWRlcyhob3N0KTtcbiAgICAgICAgfSxcbiAgICAgICAgeyB0aW1lb3V0OiA2MF8wMDAgfSxcbiAgICAgICAgU0FWRVJfSE9TVCxcbiAgICAgICk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgLy8gRGlhZ25vc3RpYzogY2FwdHVyZSB3aGF0IHRoZSBwYWdlIGxvb2tzIGxpa2Ugd2hlbiB0aGUgcG9zdC1PVFAgcmVkaXJlY3QgbmV2ZXIgaGFwcGVuc1xuICAgICAgLy8gKGUuZy4gYW4gT1RQLXJlamVjdGVkIGVycm9yIHN0aWxsIG9uIHRoZSBhdXRoIHNjcmVlbikuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBwYWdlLnNjcmVlbnNob3QoeyBwYXRoOiBgL3RtcC9zd2lmdG5lc3Mtb3RwLWZhaWwtJHtEYXRlLm5vdygpfS5wbmdgIH0pO1xuICAgICAgICBjb25zdCB2aXNpYmxlID0gYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiBkb2N1bWVudC5ib2R5LmlubmVyVGV4dC5zbGljZSgwLCA0MDApKTtcbiAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgICAgICAgY29uc29sZS5sb2coJ1tzd2lmdG5lc3Mtc2NyYXBlcl0gcG9zdC1PVFAgcmVkaXJlY3QgZmFpbGVkOyBwYWdlIHRleHQ6JywgdmlzaWJsZSk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gaWdub3JlIGRpYWdub3N0aWMgZmFpbHVyZXNcbiAgICAgIH1cbiAgICAgIHRocm93IGU7XG4gICAgfVxuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgICAgIGNvbnNvbGUubG9nKCdbc3dpZnRuZXNzLXNjcmFwZXJdIGxvZ2dlZCBpbiwgcmVkaXJlY3RlZCB0byBzYXZlcm5ldycpO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICAgICAgY29uc29sZS5sb2coJ1tzd2lmdG5lc3Mtc2NyYXBlcl0gcmV1c2luZyBleGlzdGluZyBhdXRoZW50aWNhdGVkIHNlc3Npb24sIHNraXBwaW5nIGxvZ2luJyk7XG4gICAgfVxuXG4gICAgLy8g4pSA4pSAIDQuIFJlc29sdmUgc3dpZnRuZXNzS2V5IGFuZCByZWFjaCB0aGUgaG9sZGluZ3MgcGFnZSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvLyBUaGUgc3dpZnRuZXNzS2V5IGxhbmRzIGVpdGhlciBpbiB0aGUgZGVza3RvcCdzIG93biBBUEkgcmVxdWVzdCBVUkxzIChjYXB0dXJlZCBhYm92ZSkgb3IgaW5cbiAgICAvLyBsb2NhbFN0b3JhZ2UgKGNhY2hlZFN3aWZ0bmVzc0tleSkgYSBmZXcgc2Vjb25kcyBhZnRlciB0aGUgZGVza3RvcCBmaW5pc2hlcyBsb2FkaW5nIOKAlCBwb2xsIGJvdGguXG4gICAgbGV0IHN3aWZ0bmVzc0tleTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAge1xuICAgICAgY29uc3QgZGVhZGxpbmUgPSBEYXRlLm5vdygpICsgMjBfMDAwO1xuICAgICAgd2hpbGUgKERhdGUubm93KCkgPCBkZWFkbGluZSkge1xuICAgICAgICBzd2lmdG5lc3NLZXkgPSBjYXB0dXJlZFN3aWZ0bmVzc0tleSA/PyAoYXdhaXQgcmVhZFN3aWZ0bmVzc0tleShwYWdlKS5jYXRjaCgoKSA9PiBudWxsKSk7XG4gICAgICAgIGlmIChzd2lmdG5lc3NLZXkpIGJyZWFrO1xuICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyID0+IHNldFRpbWVvdXQociwgNTAwKSk7XG4gICAgICB9XG4gICAgfVxuICAgIGlmICghc3dpZnRuZXNzS2V5KSB7XG4gICAgICAvLyBGYWxsYmFjazogd2FpdCBmb3IgdGhlIGNvbXBsZXRlZC1yZXF1ZXN0IGNhcmQgdG8gcmVuZGVyLCB0aGVuIGNsaWNrIGl0IHRvIG5hdmlnYXRlIGluLlxuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgICAgIGNvbnNvbGUubG9nKCdbc3dpZnRuZXNzLXNjcmFwZXJdIHN3aWZ0bmVzc0tleSBub3QgY2FwdHVyZWQsIHdhaXRpbmcgZm9yIGNvbXBsZXRlZC1yZXF1ZXN0IGJ1dHRvbicpO1xuICAgICAgYXdhaXQgcGFnZVxuICAgICAgICAud2FpdEZvckZ1bmN0aW9uKFxuICAgICAgICAgIGZ1bmN0aW9uIGNvbXBsZXRlZFJlcXVlc3RCdXR0b25SZWFkeSgpIHtcbiAgICAgICAgICAgIHJldHVybiBBcnJheS5mcm9tKGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJ2J1dHRvbicpKS5zb21lKGIgPT5cbiAgICAgICAgICAgICAgKGIudGV4dENvbnRlbnQgPz8gJycpLmluY2x1ZGVzKCfXnteZ15PXoiDXntec15AnKSxcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfSxcbiAgICAgICAgICB7IHRpbWVvdXQ6IDQ1XzAwMCB9LFxuICAgICAgICApXG4gICAgICAgIC5jYXRjaCgoKSA9PiB1bmRlZmluZWQpO1xuICAgICAgYXdhaXQgcGFnZS5ldmFsdWF0ZShmdW5jdGlvbiBjbGlja0NvbXBsZXRlZFJlcXVlc3QoKSB7XG4gICAgICAgIGNvbnN0IGJ0biA9IEFycmF5LmZyb20oZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnYnV0dG9uJykpLmZpbmQoYiA9PlxuICAgICAgICAgIChiLnRleHRDb250ZW50ID8/ICcnKS5pbmNsdWRlcygn157XmdeT16Ig157XnNeQJyksXG4gICAgICAgICk7XG4gICAgICAgIGlmIChidG4gaW5zdGFuY2VvZiBIVE1MRWxlbWVudCkgYnRuLmNsaWNrKCk7XG4gICAgICB9KTtcbiAgICAgIGF3YWl0IHBhZ2VcbiAgICAgICAgLndhaXRGb3JGdW5jdGlvbihmdW5jdGlvbiBzd2lmdG5lc3NLZXlJblVybCgpIHsgcmV0dXJuIGxvY2F0aW9uLmhyZWYuaW5jbHVkZXMoJ3N3aWZ0bmVzc0tleT0nKTsgfSwge1xuICAgICAgICAgIHRpbWVvdXQ6IDMwXzAwMCxcbiAgICAgICAgfSlcbiAgICAgICAgLmNhdGNoKCgpID0+IHVuZGVmaW5lZCk7XG4gICAgICBjb25zdCBtYXRjaCA9IC9zd2lmdG5lc3NLZXk9KFteJl0rKS8uZXhlYyhwYWdlLnVybCgpKTtcbiAgICAgIHN3aWZ0bmVzc0tleSA9IGNhcHR1cmVkU3dpZnRuZXNzS2V5ID8/IChtYXRjaCA/IG1hdGNoWzFdIDogbnVsbCkgPz8gKGF3YWl0IHJlYWRTd2lmdG5lc3NLZXkocGFnZSkpO1xuICAgIH1cbiAgICBpZiAoIXN3aWZ0bmVzc0tleSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdTd2lmdG5lc3M6IGNvdWxkIG5vdCByZXNvbHZlIHN3aWZ0bmVzc0tleSBhZnRlciBsb2dpbicpO1xuICAgIH1cbiAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICAgIGNvbnNvbGUubG9nKCdbc3dpZnRuZXNzLXNjcmFwZXJdIHJlc29sdmVkIHN3aWZ0bmVzc0tleScpO1xuXG4gICAgYXdhaXQgcGFnZS5nb3RvKGBodHRwczovLyR7U0FWRVJfSE9TVH0vaG9sZGluZ3MvbXlQcm9kdWN0cz9zd2lmdG5lc3NLZXk9JHtzd2lmdG5lc3NLZXl9JmV2ZW50VHlwZT05MTAwYCwge1xuICAgICAgd2FpdFVudGlsOiAnbmV0d29ya2lkbGUyJyxcbiAgICAgIHRpbWVvdXQ6IDYwXzAwMCxcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgCA1LiBQb2xsIGZvciB0aGUgaW50ZXJjZXB0ZWQgcHJvZHVjdHMgcmVzcG9uc2Ug4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgY29uc3QgcHJvZHVjdHMgPSBhd2FpdCBuZXcgUHJvbWlzZTx1bmtub3duW10+KChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNvbnN0IGRlYWRsaW5lID0gRGF0ZS5ub3coKSArIDMwXzAwMDtcbiAgICAgIGNvbnN0IGNoZWNrID0gc2V0SW50ZXJ2YWwoKCkgPT4ge1xuICAgICAgICBpZiAoY2FwdHVyZWRQcm9kdWN0cykge1xuICAgICAgICAgIGNsZWFySW50ZXJ2YWwoY2hlY2spO1xuICAgICAgICAgIHJlc29sdmUoY2FwdHVyZWRQcm9kdWN0cyk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmIChEYXRlLm5vdygpID4gZGVhZGxpbmUpIHtcbiAgICAgICAgICBjbGVhckludGVydmFsKGNoZWNrKTtcbiAgICAgICAgICByZWplY3QobmV3IEVycm9yKCdTd2lmdG5lc3M6IGdldFNhdmluZ1Byb2R1Y3RzRGV0YWlscyByZXNwb25zZSBub3QgY2FwdHVyZWQgd2l0aGluIDMwcycpKTtcbiAgICAgICAgfVxuICAgICAgfSwgNTAwKTtcbiAgICB9KTtcbiAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICAgIGNvbnNvbGUubG9nKGBbc3dpZnRuZXNzLXNjcmFwZXJdIGNhcHR1cmVkICR7cHJvZHVjdHMubGVuZ3RofSBzYXZpbmcgcHJvZHVjdHNgKTtcblxuICAgIC8vIOKUgOKUgCA2LiBOb3JtYWxpemUgKHNraXAgaW5kaXZpZHVhbGx5LWJhZCByb3dzIHJhdGhlciB0aGFuIGZhaWxpbmcgdGhlIHdob2xlIHNjcmFwZSkg4pSA4pSAXG4gICAgY29uc3QgaG9sZGluZ3M6IFBlbnNpb25Ib2xkaW5nT3V0cHV0W10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IHJhdyBvZiBwcm9kdWN0cykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgaG9sZGluZ3MucHVzaChub3JtYWxpemVIb2xkaW5nKHJhdyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikpO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICAgICAgICBjb25zb2xlLmxvZyhcbiAgICAgICAgICAnW3N3aWZ0bmVzcy1zY3JhcGVyXSBza2lwcGluZyB1bnBhcnNhYmxlIHByb2R1Y3Qgcm93OicsXG4gICAgICAgICAgZSBpbnN0YW5jZW9mIEVycm9yID8gZS5tZXNzYWdlIDogU3RyaW5nKGUpLFxuICAgICAgICApO1xuICAgICAgfVxuICAgIH1cbiAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICAgIGNvbnNvbGUubG9nKGBbc3dpZnRuZXNzLXNjcmFwZXJdIGRvbmUg4oCUICR7aG9sZGluZ3MubGVuZ3RofSBob2xkaW5nc2ApO1xuXG4gICAgcmV0dXJuIHsgaG9sZGluZ3MsIGFzT2ZEYXRlOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApIH07XG4gIH1cbn1cbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7QUFDQSxJQUFBQSxtQkFBQSxHQUFBQyxPQUFBO0FBR0EsTUFBTUMsU0FBUyxHQUFHLG9DQUFvQztBQUN0RCxNQUFNQyxVQUFVLEdBQUcsMEJBQTBCO0FBQzdDLE1BQU1DLFVBQVUsR0FBRywwQkFBMEI7QUFFN0MsTUFBTUMsYUFBYSxHQUFHLGtCQUFrQjtBQUN4QyxNQUFNQyxnQkFBZ0IsR0FBRyxxQkFBcUI7QUFDOUMsTUFBTUMsZUFBZSxHQUFHLG1CQUFtQjs7QUFFM0M7O0FBRUEsU0FBU0MsTUFBTUEsQ0FBQ0MsQ0FBVSxFQUFFQyxRQUFRLEdBQUcsRUFBRSxFQUFVO0VBQ2pELElBQUksT0FBT0QsQ0FBQyxLQUFLLFFBQVEsRUFBRSxPQUFPQSxDQUFDO0VBQ25DLElBQUksT0FBT0EsQ0FBQyxLQUFLLFFBQVEsRUFBRSxPQUFPRSxNQUFNLENBQUNGLENBQUMsQ0FBQztFQUMzQyxPQUFPQyxRQUFRO0FBQ2pCO0FBRUEsU0FBU0UsTUFBTUEsQ0FBQ0gsQ0FBVSxFQUFFQyxRQUFRLEdBQUcsQ0FBQyxFQUFVO0VBQ2hELElBQUlELENBQUMsS0FBSyxJQUFJLElBQUlBLENBQUMsS0FBS0ksU0FBUyxJQUFJSixDQUFDLEtBQUssRUFBRSxFQUFFLE9BQU9DLFFBQVE7RUFDOUQsTUFBTUksQ0FBQyxHQUFHQyxNQUFNLENBQUNOLENBQUMsQ0FBQztFQUNuQixPQUFPTSxNQUFNLENBQUNDLFFBQVEsQ0FBQ0YsQ0FBQyxDQUFDLEdBQUdBLENBQUMsR0FBR0osUUFBUTtBQUMxQztBQUVPLFNBQVNPLFNBQVNBLENBQUNSLENBQVUsRUFBaUI7RUFDbkQsSUFBSUEsQ0FBQyxLQUFLLElBQUksSUFBSUEsQ0FBQyxLQUFLSSxTQUFTLElBQUlKLENBQUMsS0FBSyxFQUFFLEVBQUUsT0FBTyxJQUFJO0VBQzFELE1BQU1LLENBQUMsR0FBR0MsTUFBTSxDQUFDTixDQUFDLENBQUM7RUFDbkIsT0FBT00sTUFBTSxDQUFDQyxRQUFRLENBQUNGLENBQUMsQ0FBQyxHQUFHQSxDQUFDLEdBQUcsSUFBSTtBQUN0QztBQUVBLE1BQU1JLGVBQWUsR0FBRyxDQUN0Qiw0QkFBNEIsRUFDNUIsZ0NBQWdDLEVBQ2hDLGlDQUFpQyxFQUNqQyxrQ0FBa0MsRUFDbEMsNkJBQTZCLEVBQzdCLDBCQUEwQixDQUNsQjtBQUVWLFNBQVNDLGFBQWFBLENBQUNDLENBQTBCLEVBQWtDO0VBQ2pGLE1BQU1DLFFBQWlDLEdBQUcsQ0FBQyxDQUFDO0VBQzVDLEtBQUssTUFBTUMsR0FBRyxJQUFJSixlQUFlLEVBQUU7SUFDakMsTUFBTUosQ0FBQyxHQUFHRyxTQUFTLENBQUNHLENBQUMsQ0FBQ0UsR0FBRyxDQUFDLENBQUM7SUFDM0IsSUFBSVIsQ0FBQyxLQUFLLElBQUksSUFBSUEsQ0FBQyxLQUFLLENBQUMsRUFBRU8sUUFBUSxDQUFDQyxHQUFHLENBQUMsR0FBR1IsQ0FBQztFQUM5QztFQUNBLE9BQU9TLE1BQU0sQ0FBQ0MsSUFBSSxDQUFDSCxRQUFRLENBQUMsQ0FBQ0ksTUFBTSxHQUFHLENBQUMsR0FBR0osUUFBUSxHQUFHLElBQUk7QUFDM0Q7QUFFQSxTQUFTSyxjQUFjQSxDQUFDQyxRQUFpQixFQUFFQyxRQUFpQixFQUFpQjtFQUMzRSxNQUFNQyxTQUFTLEdBQUdGLFFBQVEsS0FBSyxJQUFJLElBQUlBLFFBQVEsS0FBS2QsU0FBUyxJQUFJYyxRQUFRLEtBQUssRUFBRTtFQUNoRixNQUFNRyxRQUFRLEdBQUdGLFFBQVEsS0FBSyxJQUFJLElBQUlBLFFBQVEsS0FBS2YsU0FBUyxJQUFJZSxRQUFRLEtBQUssRUFBRTtFQUMvRSxJQUFJQyxTQUFTLElBQUlDLFFBQVEsRUFBRSxPQUFPLElBQUk7RUFDdEMsT0FBT2xCLE1BQU0sQ0FBQ2UsUUFBUSxDQUFDLEdBQUdmLE1BQU0sQ0FBQ2dCLFFBQVEsQ0FBQztBQUM1Qzs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNPLFNBQVNHLGdCQUFnQkEsQ0FBQ1gsQ0FBMEIsRUFBd0I7RUFDakYsT0FBTztJQUNMWSxXQUFXLEVBQUV4QixNQUFNLENBQUNZLENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO0lBQ3pDYSxlQUFlLEVBQUV6QixNQUFNLENBQUNZLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO0lBQzlDYyxZQUFZLEVBQUUxQixNQUFNLENBQUNZLENBQUMsQ0FBQyxjQUFjLENBQUMsQ0FBQztJQUN2Q2UsVUFBVSxFQUFFdkIsTUFBTSxDQUFDUSxDQUFDLENBQUMsb0JBQW9CLENBQUMsQ0FBQztJQUMzQ2dCLGlCQUFpQixFQUFFeEIsTUFBTSxDQUFDUSxDQUFDLENBQUMsdUNBQXVDLENBQUMsQ0FBQztJQUNyRWlCLGlCQUFpQixFQUFFekIsTUFBTSxDQUFDUSxDQUFDLENBQUMsbUNBQW1DLENBQUMsQ0FBQztJQUNqRWtCLEtBQUssRUFBRSxFQUFFO0lBQ1RDLE1BQU0sRUFBRS9CLE1BQU0sQ0FBQ1ksQ0FBQyxDQUFDLGtCQUFrQixDQUFDLENBQUM7SUFDckNvQixRQUFRLEVBQUV2QixTQUFTLENBQUNHLENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO0lBQ3pDcUIsaUJBQWlCLEVBQUVmLGNBQWMsQ0FBQ04sQ0FBQyxDQUFDLHVCQUF1QixDQUFDLEVBQUVBLENBQUMsQ0FBQyx1QkFBdUIsQ0FBQyxDQUFDO0lBQ3pGc0IsbUJBQW1CLEVBQUV6QixTQUFTLENBQUNHLENBQUMsQ0FBQywwQkFBMEIsQ0FBQyxDQUFDO0lBQzdEQyxRQUFRLEVBQUVGLGFBQWEsQ0FBQ0MsQ0FBQztFQUMzQixDQUFDO0FBQ0g7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLGVBQWV1QixpQkFBaUJBLENBQUNDLElBQVUsRUFBRUMsSUFBWSxFQUFvQjtFQUMzRSxPQUFPRCxJQUFJLENBQUNFLFFBQVEsQ0FBQyxTQUFTQyx1QkFBdUJBLENBQUNDLENBQVMsRUFBRTtJQUMvRCxNQUFNQyxHQUFHLEdBQUdDLEtBQUssQ0FBQ0MsSUFBSSxDQUFDQyxRQUFRLENBQUNDLGdCQUFnQixDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUNDLElBQUksQ0FBQ0MsQ0FBQyxJQUFJQSxDQUFDLENBQUNDLFdBQVcsRUFBRUMsSUFBSSxDQUFDLENBQUMsS0FBS1QsQ0FBQyxDQUFDO0lBQ2xHLElBQUlDLEdBQUcsRUFBRTtNQUNQQSxHQUFHLENBQUNTLEtBQUssQ0FBQyxDQUFDO01BQ1gsT0FBTyxJQUFJO0lBQ2I7SUFDQSxPQUFPLEtBQUs7RUFDZCxDQUFDLEVBQUViLElBQUksQ0FBQztBQUNWO0FBRUEsZUFBZWMsZ0JBQWdCQSxDQUFDZixJQUFVLEVBQUVnQixTQUFpQixFQUFFQyxJQUFZLEVBQUVDLGFBQXFCLEVBQW9CO0VBQ3BILE9BQU9sQixJQUFJLENBQUNFLFFBQVEsQ0FDbEIsU0FBU2lCLHNCQUFzQkEsQ0FBQ2xCLElBQVksRUFBRW1CLFFBQWdCLEVBQUVDLEdBQVcsRUFBRTtJQUMzRSxNQUFNQyxNQUFNLEdBQUdoQixLQUFLLENBQUNDLElBQUksQ0FBQ0MsUUFBUSxDQUFDQyxnQkFBZ0IsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUM3RCxJQUFJYyxFQUFnQyxHQUNsQ0QsTUFBTSxDQUFDWixJQUFJLENBQUNjLENBQUMsSUFBSSxDQUFDQSxDQUFDLENBQUNDLFlBQVksQ0FBQyxZQUFZLENBQUMsSUFBSSxFQUFFLEVBQUVDLFFBQVEsQ0FBQ3pCLElBQUksQ0FBQyxDQUFDLElBQ3JFcUIsTUFBTSxDQUFDWixJQUFJLENBQUNjLENBQUMsSUFBSSxDQUFDQSxDQUFDLENBQUNDLFlBQVksQ0FBQyxhQUFhLENBQUMsSUFBSSxFQUFFLEVBQUVDLFFBQVEsQ0FBQ3pCLElBQUksQ0FBQyxDQUFDO0lBQ3hFLElBQUksQ0FBQ3NCLEVBQUUsRUFBRTtNQUNQLE1BQU1JLEtBQUssR0FBR3JCLEtBQUssQ0FBQ0MsSUFBSSxDQUFDQyxRQUFRLENBQUNDLGdCQUFnQixDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUNDLElBQUksQ0FBQ2tCLENBQUMsSUFBSUEsQ0FBQyxDQUFDaEIsV0FBVyxFQUFFYyxRQUFRLENBQUN6QixJQUFJLENBQUMsQ0FBQztNQUNyRyxJQUFJMEIsS0FBSyxFQUFFO1FBQ1QsTUFBTUUsS0FBSyxHQUFHRixLQUFLLENBQUNGLFlBQVksQ0FBQyxLQUFLLENBQUM7UUFDdkMsSUFBSUksS0FBSyxFQUFFO1VBQ1QsTUFBTUMsSUFBSSxHQUFHdEIsUUFBUSxDQUFDdUIsY0FBYyxDQUFDRixLQUFLLENBQUM7VUFDM0MsSUFBSUMsSUFBSSxZQUFZRSxnQkFBZ0IsRUFBRVQsRUFBRSxHQUFHTyxJQUFJO1FBQ2pEO1FBQ0EsSUFBSSxDQUFDUCxFQUFFLEVBQUU7VUFDUCxNQUFNVSxNQUFNLEdBQUdOLEtBQUssQ0FBQ08sYUFBYSxDQUFDLE9BQU8sQ0FBQztVQUMzQyxJQUFJRCxNQUFNLEVBQUVWLEVBQUUsR0FBR1UsTUFBTTtRQUN6QjtRQUNBLElBQUksQ0FBQ1YsRUFBRSxFQUFFO1VBQ1AsTUFBTVksT0FBTyxHQUFHUixLQUFLLENBQUNTLGFBQWEsRUFBRUYsYUFBYSxDQUFDLE9BQU8sQ0FBQztVQUMzRCxJQUFJQyxPQUFPLEVBQUVaLEVBQUUsR0FBR1ksT0FBTztRQUMzQjtNQUNGO0lBQ0Y7SUFDQSxJQUFJLENBQUNaLEVBQUUsRUFBRUEsRUFBRSxHQUFHRCxNQUFNLENBQUNELEdBQUcsQ0FBQztJQUN6QixJQUFJLENBQUNFLEVBQUUsRUFBRSxPQUFPLEtBQUs7SUFDckJBLEVBQUUsQ0FBQ2MsWUFBWSxDQUFDLGVBQWUsRUFBRWpCLFFBQVEsQ0FBQztJQUMxQyxPQUFPLElBQUk7RUFDYixDQUFDLEVBQ0RKLFNBQVMsRUFDVEMsSUFBSSxFQUNKQyxhQUNGLENBQUM7QUFDSDtBQUVBLGVBQWVvQixjQUFjQSxDQUFDdEMsSUFBVSxFQUFFdUMsRUFBVSxFQUFFQyxLQUFhLEVBQWlCO0VBQ2xGLE1BQU14QyxJQUFJLENBQUN5QyxlQUFlLENBQ3hCLFNBQVNDLFdBQVdBLENBQUEsRUFBRztJQUNyQixPQUFPbEMsUUFBUSxDQUFDQyxnQkFBZ0IsQ0FBQyxPQUFPLENBQUMsQ0FBQzVCLE1BQU0sSUFBSSxDQUFDO0VBQ3ZELENBQUMsRUFDRDtJQUFFOEQsT0FBTyxFQUFFO0VBQU8sQ0FDcEIsQ0FBQztFQUNELE1BQU1DLFFBQVEsR0FBRyxNQUFNN0IsZ0JBQWdCLENBQUNmLElBQUksRUFBRSxpQkFBaUIsRUFBRXZDLGFBQWEsRUFBRSxDQUFDLENBQUM7RUFDbEYsTUFBTW9GLFdBQVcsR0FBRyxNQUFNOUIsZ0JBQWdCLENBQUNmLElBQUksRUFBRSxXQUFXLEVBQUV0QyxnQkFBZ0IsRUFBRSxDQUFDLENBQUM7RUFDbEYsSUFBSSxDQUFDa0YsUUFBUSxJQUFJLENBQUNDLFdBQVcsRUFBRTtJQUM3QixNQUFNLElBQUlDLEtBQUssQ0FBQyxtREFBbUQsQ0FBQztFQUN0RTtFQUNBLE1BQU05QyxJQUFJLENBQUMrQyxJQUFJLENBQUMsd0JBQXdCdEYsYUFBYSxJQUFJLEVBQUU4RSxFQUFFLENBQUM7RUFDOUQsTUFBTXZDLElBQUksQ0FBQytDLElBQUksQ0FBQyx3QkFBd0JyRixnQkFBZ0IsSUFBSSxFQUFFOEUsS0FBSyxDQUFDO0FBQ3RFO0FBRUEsZUFBZVEsYUFBYUEsQ0FBQ2hELElBQVUsRUFBRWlELFVBQWtCLEVBQW1CO0VBQzVFLE9BQU9qRCxJQUFJLENBQUNFLFFBQVEsQ0FBQyxTQUFTZ0QsbUJBQW1CQSxDQUFDQyxNQUFjLEVBQUU7SUFDaEUsSUFBSUMsVUFBcUIsR0FBRzlDLEtBQUssQ0FBQ0MsSUFBSSxDQUFDQyxRQUFRLENBQUNDLGdCQUFnQixDQUFDLHNCQUFzQixDQUFDLENBQUM7SUFDekYsSUFBSTJDLFVBQVUsQ0FBQ3ZFLE1BQU0sR0FBRyxDQUFDLEVBQUU7TUFDekJ1RSxVQUFVLEdBQUc5QyxLQUFLLENBQUNDLElBQUksQ0FBQ0MsUUFBUSxDQUFDQyxnQkFBZ0IsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUM3RDtJQUNBMkMsVUFBVSxDQUFDQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDQyxPQUFPLENBQUMsQ0FBQy9CLEVBQUUsRUFBRUMsQ0FBQyxLQUFLRCxFQUFFLENBQUNjLFlBQVksQ0FBQyxlQUFlLEVBQUUsR0FBR2MsTUFBTSxJQUFJM0IsQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUM3RixPQUFPK0IsSUFBSSxDQUFDQyxHQUFHLENBQUNKLFVBQVUsQ0FBQ3ZFLE1BQU0sRUFBRSxDQUFDLENBQUM7RUFDdkMsQ0FBQyxFQUFFb0UsVUFBVSxDQUFDO0FBQ2hCO0FBRUEsZUFBZVEsZ0JBQWdCQSxDQUFDekQsSUFBVSxFQUEwQjtFQUNsRSxPQUFPQSxJQUFJLENBQUNFLFFBQVEsQ0FBQyxTQUFTd0QsMkJBQTJCQSxDQUFBLEVBQUc7SUFDMUQsT0FBT0MsWUFBWSxDQUFDQyxPQUFPLENBQUMsb0JBQW9CLENBQUM7RUFDbkQsQ0FBQyxDQUFDO0FBQ0o7QUFFTyxNQUFNQyx1QkFBdUIsU0FBU0Msc0NBQWtCLENBQUM7RUFDOUQsTUFBZ0JDLFlBQVlBLENBQzFCL0QsSUFBVSxFQUNWZ0UsV0FBb0MsRUFDNkI7SUFDakUsTUFBTXpCLEVBQUUsR0FBRyxPQUFPeUIsV0FBVyxDQUFDLElBQUksQ0FBQyxLQUFLLFFBQVEsR0FBR0EsV0FBVyxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUU7SUFDekUsTUFBTXhCLEtBQUssR0FBRyxPQUFPd0IsV0FBVyxDQUFDLE9BQU8sQ0FBQyxLQUFLLFFBQVEsR0FBR0EsV0FBVyxDQUFDLE9BQU8sQ0FBQyxHQUFHLEVBQUU7SUFDbEYsTUFBTUMsVUFBVSxHQUFHRCxXQUFXLENBQUMsWUFBWSxDQUFDLEtBQUssT0FBTyxHQUFHLE9BQU8sR0FBRyxLQUFLO0lBQzFFLE1BQU1FLGdCQUFnQixHQUFHRixXQUFXLENBQUMsa0JBQWtCLENBQXdDOztJQUUvRjtJQUNBLElBQUlHLGdCQUF1QztJQUMzQztJQUNBO0lBQ0E7SUFDQSxJQUFJQyxvQkFBbUMsR0FBRyxJQUFJO0lBQzlDcEUsSUFBSSxDQUFDcUUsRUFBRSxDQUFDLFNBQVMsRUFBRUMsT0FBTyxJQUFJO01BQzVCLE1BQU1DLENBQUMsR0FBRyxpQ0FBaUMsQ0FBQ0MsSUFBSSxDQUFDRixPQUFPLENBQUNHLEdBQUcsQ0FBQyxDQUFDLENBQUM7TUFDL0QsSUFBSUYsQ0FBQyxJQUFJLENBQUNILG9CQUFvQixFQUFFQSxvQkFBb0IsR0FBR0csQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUM3RCxDQUFDLENBQUM7SUFDRnZFLElBQUksQ0FBQ3FFLEVBQUUsQ0FBQyxVQUFVLEVBQUVLLFFBQVEsSUFBSTtNQUM5QixNQUFNRCxHQUFHLEdBQUdDLFFBQVEsQ0FBQ0QsR0FBRyxDQUFDLENBQUM7TUFDMUIsSUFBSSxDQUFDQSxHQUFHLENBQUMvQyxRQUFRLENBQUNsRSxVQUFVLENBQUMsRUFBRTtNQUMvQixLQUFLa0gsUUFBUSxDQUNWQyxJQUFJLENBQUMsQ0FBQyxDQUNOQyxJQUFJLENBQUVDLElBQWEsSUFBSztRQUN2QixNQUFNQyxHQUFHLEdBQUlELElBQUksRUFBNENFLHFCQUFxQjtRQUNsRixJQUFJekUsS0FBSyxDQUFDMEUsT0FBTyxDQUFDRixHQUFHLENBQUMsRUFBRVgsZ0JBQWdCLEdBQUdXLEdBQUc7TUFDaEQsQ0FBQyxDQUFDLENBQ0RHLEtBQUssQ0FBQyxNQUFNaEgsU0FBUyxDQUFDO0lBQzNCLENBQUMsQ0FBQzs7SUFFRjtJQUNBO0lBQ0E7SUFDQSxNQUFNK0IsSUFBSSxDQUFDa0YsSUFBSSxDQUFDLFdBQVczSCxVQUFVLEdBQUcsRUFBRTtNQUFFNEgsU0FBUyxFQUFFLGNBQWM7TUFBRXhDLE9BQU8sRUFBRTtJQUFPLENBQUMsQ0FBQyxDQUFDc0MsS0FBSyxDQUFDLE1BQU1oSCxTQUFTLENBQUM7SUFDaEgsTUFBTW1ILGFBQWEsR0FDakJwRixJQUFJLENBQUN5RSxHQUFHLENBQUMsQ0FBQyxDQUFDL0MsUUFBUSxDQUFDbkUsVUFBVSxDQUFDLEtBQzlCLE1BQU15QyxJQUFJLENBQUNFLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQ3lELFlBQVksQ0FBQ0MsT0FBTyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUNxQixLQUFLLENBQUMsTUFBTSxLQUFLLENBQUMsQ0FBQztJQUN0RixJQUFJLENBQUNHLGFBQWEsRUFBRTtNQUNsQixNQUFNcEYsSUFBSSxDQUFDa0YsSUFBSSxDQUFDNUgsU0FBUyxFQUFFO1FBQUU2SCxTQUFTLEVBQUUsY0FBYztRQUFFeEMsT0FBTyxFQUFFO01BQU8sQ0FBQyxDQUFDO01BQzFFO01BQ0EwQyxPQUFPLENBQUNDLEdBQUcsQ0FBQyx1Q0FBdUMsQ0FBQztNQUV0RCxNQUFNQyxVQUFVLEdBQUd0QixVQUFVLEtBQUssT0FBTyxHQUFHLE1BQU0sR0FBRyxLQUFLO01BQzFELE1BQU1sRSxpQkFBaUIsQ0FBQ0MsSUFBSSxFQUFFdUYsVUFBVSxDQUFDO01BRXpDLE1BQU1qRCxjQUFjLENBQUN0QyxJQUFJLEVBQUV1QyxFQUFFLEVBQUVDLEtBQUssQ0FBQztNQUVyQyxNQUFNeEMsSUFBSSxDQUNQeUMsZUFBZSxDQUNkLFNBQVMrQyxlQUFlQSxDQUFBLEVBQUc7UUFDekIsTUFBTW5GLEdBQUcsR0FBR0MsS0FBSyxDQUFDQyxJQUFJLENBQUNDLFFBQVEsQ0FBQ0MsZ0JBQWdCLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQ0MsSUFBSSxDQUFDQyxDQUFDLElBQUlBLENBQUMsQ0FBQ0MsV0FBVyxFQUFFQyxJQUFJLENBQUMsQ0FBQyxLQUFLLE1BQU0sQ0FBQztRQUN2RyxPQUFPLENBQUMsQ0FBQ1IsR0FBRyxJQUFJLENBQUNBLEdBQUcsQ0FBQ29GLFFBQVE7TUFDL0IsQ0FBQyxFQUNEO1FBQUU5QyxPQUFPLEVBQUU7TUFBTyxDQUNwQixDQUFDLENBQ0FzQyxLQUFLLENBQUMsTUFBTWhILFNBQVMsQ0FBQztNQUN6QixNQUFNOEIsaUJBQWlCLENBQUNDLElBQUksRUFBRSxNQUFNLENBQUM7TUFDckM7TUFDQXFGLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLGtEQUFrRCxFQUFFckIsVUFBVSxDQUFDOztNQUUzRTtNQUNBLE1BQU15QixXQUFXLEdBQUcsTUFBTTFGLElBQUksQ0FDM0J5QyxlQUFlLENBQ2QsU0FBU2tELFFBQVFBLENBQUEsRUFBRztRQUNsQixPQUNFbkYsUUFBUSxDQUFDQyxnQkFBZ0IsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDNUIsTUFBTSxJQUFJLENBQUMsSUFDN0QyQixRQUFRLENBQUNDLGdCQUFnQixDQUFDLE9BQU8sQ0FBQyxDQUFDNUIsTUFBTSxJQUFJLENBQUM7TUFFbEQsQ0FBQyxFQUNEO1FBQUU4RCxPQUFPLEVBQUU7TUFBTyxDQUNwQixDQUFDLENBQ0FpQyxJQUFJLENBQUMsTUFBTSxJQUFJLENBQUMsQ0FDaEJLLEtBQUssQ0FBQyxNQUFNLEtBQUssQ0FBQztNQUVyQixJQUFJUyxXQUFXLElBQUl4QixnQkFBZ0IsRUFBRTtRQUNuQztRQUNBbUIsT0FBTyxDQUFDQyxHQUFHLENBQUMsa0NBQWtDLENBQUM7UUFDL0MsTUFBTU0sS0FBSyxHQUFHLE1BQU01QyxhQUFhLENBQUNoRCxJQUFJLEVBQUVyQyxlQUFlLENBQUM7UUFDeEQsSUFBSWlJLEtBQUssSUFBSSxDQUFDLEVBQUU7VUFDZCxNQUFNQyxJQUFJLEdBQUcsTUFBTTNCLGdCQUFnQixDQUFDLENBQUM7VUFDckM7VUFDQTtVQUNBO1VBQ0E7VUFDQSxNQUFNbEUsSUFBSSxDQUFDOEYsS0FBSyxDQUFDLHdCQUF3Qm5JLGVBQWUsTUFBTSxDQUFDO1VBQy9ELE1BQU1xQyxJQUFJLENBQUMrRixRQUFRLENBQUNoRCxJQUFJLENBQUM4QyxJQUFJLEVBQUU7WUFBRUcsS0FBSyxFQUFFO1VBQUcsQ0FBQyxDQUFDO1FBQy9DO01BQ0Y7O01BRUE7TUFDQSxJQUFJO1FBQ0YsTUFBTWhHLElBQUksQ0FBQ3lDLGVBQWUsQ0FDeEIsU0FBU3dELGFBQWFBLENBQUNDLElBQVksRUFBRTtVQUNuQyxPQUFPQyxRQUFRLENBQUNDLFFBQVEsQ0FBQzFFLFFBQVEsQ0FBQ3dFLElBQUksQ0FBQztRQUN6QyxDQUFDLEVBQ0Q7VUFBRXZELE9BQU8sRUFBRTtRQUFPLENBQUMsRUFDbkJwRixVQUNGLENBQUM7TUFDSCxDQUFDLENBQUMsT0FBTzhJLENBQUMsRUFBRTtRQUNWO1FBQ0E7UUFDQSxJQUFJO1VBQ0YsTUFBTXJHLElBQUksQ0FBQ3NHLFVBQVUsQ0FBQztZQUFFQyxJQUFJLEVBQUUsMkJBQTJCQyxJQUFJLENBQUNDLEdBQUcsQ0FBQyxDQUFDO1VBQU8sQ0FBQyxDQUFDO1VBQzVFLE1BQU1DLE9BQU8sR0FBRyxNQUFNMUcsSUFBSSxDQUFDRSxRQUFRLENBQUMsTUFBTU0sUUFBUSxDQUFDcUUsSUFBSSxDQUFDOEIsU0FBUyxDQUFDdEQsS0FBSyxDQUFDLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQztVQUNoRjtVQUNBZ0MsT0FBTyxDQUFDQyxHQUFHLENBQUMsMERBQTBELEVBQUVvQixPQUFPLENBQUM7UUFDbEYsQ0FBQyxDQUFDLE1BQU07VUFDTjtRQUFBO1FBRUYsTUFBTUwsQ0FBQztNQUNUO01BQ0U7TUFDQWhCLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLHVEQUF1RCxDQUFDO0lBQ3RFLENBQUMsTUFBTTtNQUNMO01BQ0FELE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLDRFQUE0RSxDQUFDO0lBQzNGOztJQUVBO0lBQ0E7SUFDQTtJQUNBLElBQUlzQixZQUEyQixHQUFHLElBQUk7SUFDdEM7TUFDRSxNQUFNQyxRQUFRLEdBQUdMLElBQUksQ0FBQ0MsR0FBRyxDQUFDLENBQUMsR0FBRyxNQUFNO01BQ3BDLE9BQU9ELElBQUksQ0FBQ0MsR0FBRyxDQUFDLENBQUMsR0FBR0ksUUFBUSxFQUFFO1FBQzVCRCxZQUFZLEdBQUd4QyxvQkFBb0IsS0FBSyxNQUFNWCxnQkFBZ0IsQ0FBQ3pELElBQUksQ0FBQyxDQUFDaUYsS0FBSyxDQUFDLE1BQU0sSUFBSSxDQUFDLENBQUM7UUFDdkYsSUFBSTJCLFlBQVksRUFBRTtRQUNsQixNQUFNLElBQUlFLE9BQU8sQ0FBQ0MsQ0FBQyxJQUFJQyxVQUFVLENBQUNELENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQztNQUM1QztJQUNGO0lBQ0EsSUFBSSxDQUFDSCxZQUFZLEVBQUU7TUFDakI7TUFDQTtNQUNBdkIsT0FBTyxDQUFDQyxHQUFHLENBQUMscUZBQXFGLENBQUM7TUFDbEcsTUFBTXRGLElBQUksQ0FDUHlDLGVBQWUsQ0FDZCxTQUFTd0UsMkJBQTJCQSxDQUFBLEVBQUc7UUFDckMsT0FBTzNHLEtBQUssQ0FBQ0MsSUFBSSxDQUFDQyxRQUFRLENBQUNDLGdCQUFnQixDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUN5RyxJQUFJLENBQUN2RyxDQUFDLElBQzNELENBQUNBLENBQUMsQ0FBQ0MsV0FBVyxJQUFJLEVBQUUsRUFBRWMsUUFBUSxDQUFDLFVBQVUsQ0FDM0MsQ0FBQztNQUNILENBQUMsRUFDRDtRQUFFaUIsT0FBTyxFQUFFO01BQU8sQ0FDcEIsQ0FBQyxDQUNBc0MsS0FBSyxDQUFDLE1BQU1oSCxTQUFTLENBQUM7TUFDekIsTUFBTStCLElBQUksQ0FBQ0UsUUFBUSxDQUFDLFNBQVNpSCxxQkFBcUJBLENBQUEsRUFBRztRQUNuRCxNQUFNOUcsR0FBRyxHQUFHQyxLQUFLLENBQUNDLElBQUksQ0FBQ0MsUUFBUSxDQUFDQyxnQkFBZ0IsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDQyxJQUFJLENBQUNDLENBQUMsSUFDaEUsQ0FBQ0EsQ0FBQyxDQUFDQyxXQUFXLElBQUksRUFBRSxFQUFFYyxRQUFRLENBQUMsVUFBVSxDQUMzQyxDQUFDO1FBQ0QsSUFBSXJCLEdBQUcsWUFBWStHLFdBQVcsRUFBRS9HLEdBQUcsQ0FBQ1MsS0FBSyxDQUFDLENBQUM7TUFDN0MsQ0FBQyxDQUFDO01BQ0YsTUFBTWQsSUFBSSxDQUNQeUMsZUFBZSxDQUFDLFNBQVM0RSxpQkFBaUJBLENBQUEsRUFBRztRQUFFLE9BQU9sQixRQUFRLENBQUNtQixJQUFJLENBQUM1RixRQUFRLENBQUMsZUFBZSxDQUFDO01BQUUsQ0FBQyxFQUFFO1FBQ2pHaUIsT0FBTyxFQUFFO01BQ1gsQ0FBQyxDQUFDLENBQ0RzQyxLQUFLLENBQUMsTUFBTWhILFNBQVMsQ0FBQztNQUN6QixNQUFNc0osS0FBSyxHQUFHLHNCQUFzQixDQUFDL0MsSUFBSSxDQUFDeEUsSUFBSSxDQUFDeUUsR0FBRyxDQUFDLENBQUMsQ0FBQztNQUNyRG1DLFlBQVksR0FBR3hDLG9CQUFvQixLQUFLbUQsS0FBSyxHQUFHQSxLQUFLLENBQUMsQ0FBQyxDQUFDLEdBQUcsSUFBSSxDQUFDLEtBQUssTUFBTTlELGdCQUFnQixDQUFDekQsSUFBSSxDQUFDLENBQUM7SUFDcEc7SUFDQSxJQUFJLENBQUM0RyxZQUFZLEVBQUU7TUFDakIsTUFBTSxJQUFJOUQsS0FBSyxDQUFDLHVEQUF1RCxDQUFDO0lBQzFFO0lBQ0E7SUFDQXVDLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLDJDQUEyQyxDQUFDO0lBRXhELE1BQU10RixJQUFJLENBQUNrRixJQUFJLENBQUMsV0FBVzNILFVBQVUscUNBQXFDcUosWUFBWSxpQkFBaUIsRUFBRTtNQUN2R3pCLFNBQVMsRUFBRSxjQUFjO01BQ3pCeEMsT0FBTyxFQUFFO0lBQ1gsQ0FBQyxDQUFDOztJQUVGO0lBQ0EsTUFBTTZFLFFBQVEsR0FBRyxNQUFNLElBQUlWLE9BQU8sQ0FBWSxDQUFDVyxPQUFPLEVBQUVDLE1BQU0sS0FBSztNQUNqRSxNQUFNYixRQUFRLEdBQUdMLElBQUksQ0FBQ0MsR0FBRyxDQUFDLENBQUMsR0FBRyxNQUFNO01BQ3BDLE1BQU1rQixLQUFLLEdBQUdDLFdBQVcsQ0FBQyxNQUFNO1FBQzlCLElBQUl6RCxnQkFBZ0IsRUFBRTtVQUNwQjBELGFBQWEsQ0FBQ0YsS0FBSyxDQUFDO1VBQ3BCRixPQUFPLENBQUN0RCxnQkFBZ0IsQ0FBQztVQUN6QjtRQUNGO1FBQ0EsSUFBSXFDLElBQUksQ0FBQ0MsR0FBRyxDQUFDLENBQUMsR0FBR0ksUUFBUSxFQUFFO1VBQ3pCZ0IsYUFBYSxDQUFDRixLQUFLLENBQUM7VUFDcEJELE1BQU0sQ0FBQyxJQUFJNUUsS0FBSyxDQUFDLHNFQUFzRSxDQUFDLENBQUM7UUFDM0Y7TUFDRixDQUFDLEVBQUUsR0FBRyxDQUFDO0lBQ1QsQ0FBQyxDQUFDO0lBQ0Y7SUFDQXVDLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLGdDQUFnQ2tDLFFBQVEsQ0FBQzNJLE1BQU0sa0JBQWtCLENBQUM7O0lBRTlFO0lBQ0EsTUFBTWlKLFFBQWdDLEdBQUcsRUFBRTtJQUMzQyxLQUFLLE1BQU1DLEdBQUcsSUFBSVAsUUFBUSxFQUFFO01BQzFCLElBQUk7UUFDRk0sUUFBUSxDQUFDRSxJQUFJLENBQUM3SSxnQkFBZ0IsQ0FBQzRJLEdBQThCLENBQUMsQ0FBQztNQUNqRSxDQUFDLENBQUMsT0FBTzFCLENBQUMsRUFBRTtRQUNWO1FBQ0FoQixPQUFPLENBQUNDLEdBQUcsQ0FDVCxzREFBc0QsRUFDdERlLENBQUMsWUFBWXZELEtBQUssR0FBR3VELENBQUMsQ0FBQzRCLE9BQU8sR0FBR2xLLE1BQU0sQ0FBQ3NJLENBQUMsQ0FDM0MsQ0FBQztNQUNIO0lBQ0Y7SUFDQTtJQUNBaEIsT0FBTyxDQUFDQyxHQUFHLENBQUMsOEJBQThCd0MsUUFBUSxDQUFDakosTUFBTSxXQUFXLENBQUM7SUFFckUsT0FBTztNQUFFaUosUUFBUTtNQUFFSSxRQUFRLEVBQUUsSUFBSTFCLElBQUksQ0FBQyxDQUFDLENBQUMyQixXQUFXLENBQUMsQ0FBQyxDQUFDOUUsS0FBSyxDQUFDLENBQUMsRUFBRSxFQUFFO0lBQUUsQ0FBQztFQUN0RTtBQUNGO0FBQUMrRSxPQUFBLENBQUF2RSx1QkFBQSxHQUFBQSx1QkFBQSIsImlnbm9yZUxpc3QiOltdfQ==