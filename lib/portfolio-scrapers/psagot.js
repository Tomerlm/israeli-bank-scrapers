"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PsagotScraper = void 0;
var _basePortfolioScraper = require("./base-portfolio-scraper");
const BASE_URL = 'https://trade1.psagot.co.il';
const LOGIN_URL = 'https://trade.psagot.co.il/';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const SEL = {
  username: 'input[aria-label="Username required"]',
  password: 'input[aria-label="Password required"]'
};
async function waitForElement(page, selector, timeout = 60_000) {
  await page.waitForFunction(sel => document.querySelector(sel) !== null, {
    timeout
  }, selector);
}
async function flutterClickByText(page, text) {
  await page.evaluate(t => {
    const el = Array.from(document.querySelectorAll('flt-semantics[role="button"]')).find(node => node.textContent?.trim() === t);
    if (el) el.click();
  }, text);
}
function strVal(v, fallback = '') {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return fallback;
}

// The API returns HTTP 200/401/500 with an {"Exception": ...} JSON body on failure —
// e.g. InvalidSessionException when the csession header doesn't match the one the app
// used at login, or MinIntervalException when the same endpoint is hit within 1000ms.
async function apiFetch(page, sessionKey, csession, url) {
  const raw = await page.evaluate(async (targetUrl, key, cs) => {
    const res = await fetch(targetUrl, {
      headers: {
        session: key,
        csession: cs
      }
    });
    return {
      status: res.status,
      text: await res.text()
    };
  }, url, sessionKey, csession);
  let body;
  try {
    body = JSON.parse(raw.text);
  } catch {
    throw new Error(`Psagot API non-JSON response (HTTP ${raw.status}) from ${url}: ${raw.text.slice(0, 200)}`);
  }
  const exception = body?.Exception;
  if (exception) {
    throw new Error(`Psagot API ${exception['-ExceptionType'] ?? 'Exception'} from ${url}: ${exception.Message ?? ''}`);
  }
  if (raw.status < 200 || raw.status >= 300) throw new Error(`HTTP ${raw.status} from ${url}`);
  return body;
}

// The Flutter app polls some endpoints itself; an explicit fetch can collide with its
// polling and get MinIntervalException — back off and retry instead of failing the scan.
async function apiFetchWithRetry(page, sessionKey, csession, url) {
  const maxAttempts = 3;
  for (let attempt = 1;; attempt++) {
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
class PsagotScraper extends _basePortfolioScraper.BasePortfolioScraper {
  async fetchPortfolio(page, credentials) {
    const username = typeof credentials['username'] === 'string' ? credentials['username'] : '';
    const password = typeof credentials['password'] === 'string' ? credentials['password'] : '';
    const otpCodeRetriever = credentials['otpCodeRetriever'];

    // ── 1. Interceptors: SessionKey, csession, and the app's own API responses ─
    let sessionKey = '';
    // The API binds the SessionKey to the csession value the Flutter app generated at
    // login. Explicit fetches with any other csession get InvalidSessionException, so
    // capture the app's value from its own authenticated requests.
    let appSessionKey = '';
    let appCsession = '';
    let capturedAccounts;
    // Balances responses intercepted from the Flutter app's own polling — used instead of
    // explicit apiFetch for accounts the app auto-loads (avoids concurrent-request 401s).
    const capturedBalances = new Map();
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
        void response.json().then(body => {
          const key = body?.Login?.SessionKey;
          if (key) sessionKey = key;
        }).catch(() => undefined);
        return;
      }
      if (url.includes('/V2/json/accounts')) {
        void response.json().then(body => {
          if (body?.UserAccounts) capturedAccounts = body;
        }).catch(() => undefined);
        return;
      }
      if (url.includes('/account/view/balances')) {
        const accountMatch = url.match(/account=([^&]+)/);
        if (accountMatch) {
          void response.json().then(body => {
            capturedBalances.set(accountMatch[1], body);
          }).catch(() => undefined);
        }
      }
    });

    // ── 2. Boot Flutter ───────────────────────────────────────────────────────
    await page.setUserAgent(USER_AGENT);
    await page.goto(LOGIN_URL, {
      waitUntil: 'load',
      timeout: 120_000
    });
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
    await page.waitForFunction(() => document.querySelector('flt-semantics[role="checkbox"]')?.getAttribute('aria-checked') === 'true', {
      timeout: 10_000
    });
    await page.waitForFunction(() => {
      const btn = Array.from(document.querySelectorAll('flt-semantics[role="button"]')).find(el => el.textContent?.trim() === 'Login');
      return btn != null && btn.getAttribute('aria-disabled') !== 'true';
    }, {
      timeout: 30_000
    });
    await flutterClickByText(page, 'Login');
    await page.waitForFunction(() => !document.querySelector('input[aria-label="Username required"]'), {
      timeout: 60_000
    });

    // ── 4. OTP (optional) ─────────────────────────────────────────────────────
    const otpInputAppeared = await page.waitForFunction(() => document.querySelectorAll('input').length > 0, {
      timeout: 10_000
    }).then(() => true).catch(() => false);
    if (otpInputAppeared && otpCodeRetriever) {
      const inputs = await page.evaluate(() => Array.from(document.querySelectorAll('input')).map(el => el.getAttribute('aria-label')));
      const otpAriaLabel = inputs[0] ?? '';
      if (otpAriaLabel) {
        // eslint-disable-next-line no-console
        console.log('[psagot-scraper] OTP required');
        const code = await otpCodeRetriever();
        await page.type(`input[aria-label="${otpAriaLabel}"]`, code);
        // Flutter may auto-submit after all OTP digits are entered.
        // Try clicking Login only if it becomes active within 5s; ignore if it doesn't.
        await page.waitForFunction(() => {
          const btn = Array.from(document.querySelectorAll('flt-semantics[role="button"]')).find(el => el.textContent?.trim() === 'Login');
          return btn != null && btn.getAttribute('aria-disabled') !== 'true';
        }, {
          timeout: 5_000
        }).then(() => flutterClickByText(page, 'Login')).catch(() => undefined);
      }
    }

    // ── 5. Wait for post-login SessionKey (polls Node.js variable set by response listener) ──
    // URL-based heuristics fail for Flutter SPAs that stay at '/' after login.
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 60_000;
      const check = setInterval(() => {
        if (sessionKey || appSessionKey) {
          clearInterval(check);
          resolve();
          return;
        }
        if (Date.now() > deadline) {
          clearInterval(check);
          reject(new Error('Login timed out: no SessionKey received'));
        }
      }, 500);
    });
    // eslint-disable-next-line no-console
    console.log('[psagot-scraper] logged in, sessionKey captured:', sessionKey || appSessionKey ? 'yes' : 'NO');

    // Wait for the app's first authenticated request (carries the csession the server
    // bound at login) — ideally its own accounts response arrives in the same window.
    await new Promise(resolve => {
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
    let accountsRes;
    if (capturedAccounts !== undefined) {
      // eslint-disable-next-line no-console
      console.log('[psagot-scraper] using intercepted accounts response');
      accountsRes = capturedAccounts;
    } else {
      accountsRes = await apiFetchWithRetry(page, effectiveKey, csession, `${BASE_URL}/V2/json/accounts?catalog=unified`);
    }
    const rawAccounts = accountsRes?.UserAccounts?.UserAccount;
    const accountIds = (Array.isArray(rawAccounts) ? rawAccounts : rawAccounts ? [rawAccounts] : []).map(a => a['-key']);
    // eslint-disable-next-line no-console
    console.log('[psagot-scraper] accounts:', accountIds);
    if (accountIds.length === 0) {
      throw new Error(`Psagot returned no accounts — raw: ${JSON.stringify(accountsRes).slice(0, 300)}`);
    }

    // ── 7. Fetch balances for each account ────────────────────────────────────
    const allPositions = [];
    let totalCashIls = 0;
    let lastExplicitFetch = 0; // ms timestamp — enforce 1500ms min between explicit apiFetch calls

    for (const accountId of accountIds) {
      // Wait up to 5s for the Flutter app to auto-populate this account's balances
      // (it continuously polls primary accounts — intercepting avoids concurrent-request 401s).
      const captured = await new Promise(resolve => {
        const deadline = Date.now() + 5_000;
        const check = setInterval(() => {
          const val = capturedBalances.get(accountId);
          if (val !== undefined) {
            clearInterval(check);
            resolve(val);
            return;
          }
          if (Date.now() > deadline) {
            clearInterval(check);
            resolve(undefined);
          }
        }, 200);
      });
      let balancesRes;
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
        balancesRes = await apiFetchWithRetry(page, effectiveKey, csession, `${BASE_URL}/V2/json2/account/view/balances?account=${accountId}&fields=hebName&currency=ils&catalog=unified`);
        lastExplicitFetch = Date.now();
      }
      const typedRes = balancesRes;
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
      const nameById = new Map(metaSecurities.map(s => [s['-Key'], s.HebName ?? '']));
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
          currency
        });
      }
    }

    // eslint-disable-next-line no-console
    console.log(`[psagot-scraper] done — ${allPositions.length} positions, cash ${totalCashIls} ILS`);
    const cash = totalCashIls > 0 ? [{
      currency: 'ILS',
      amount: totalCashIls
    }] : [];
    return {
      positions: allPositions,
      cash,
      asOfDate: new Date().toISOString().slice(0, 10)
    };
  }
}
exports.PsagotScraper = PsagotScraper;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfYmFzZVBvcnRmb2xpb1NjcmFwZXIiLCJyZXF1aXJlIiwiQkFTRV9VUkwiLCJMT0dJTl9VUkwiLCJVU0VSX0FHRU5UIiwiU0VMIiwidXNlcm5hbWUiLCJwYXNzd29yZCIsIndhaXRGb3JFbGVtZW50IiwicGFnZSIsInNlbGVjdG9yIiwidGltZW91dCIsIndhaXRGb3JGdW5jdGlvbiIsInNlbCIsImRvY3VtZW50IiwicXVlcnlTZWxlY3RvciIsImZsdXR0ZXJDbGlja0J5VGV4dCIsInRleHQiLCJldmFsdWF0ZSIsInQiLCJlbCIsIkFycmF5IiwiZnJvbSIsInF1ZXJ5U2VsZWN0b3JBbGwiLCJmaW5kIiwibm9kZSIsInRleHRDb250ZW50IiwidHJpbSIsImNsaWNrIiwic3RyVmFsIiwidiIsImZhbGxiYWNrIiwiU3RyaW5nIiwiYXBpRmV0Y2giLCJzZXNzaW9uS2V5IiwiY3Nlc3Npb24iLCJ1cmwiLCJyYXciLCJ0YXJnZXRVcmwiLCJrZXkiLCJjcyIsInJlcyIsImZldGNoIiwiaGVhZGVycyIsInNlc3Npb24iLCJzdGF0dXMiLCJib2R5IiwiSlNPTiIsInBhcnNlIiwiRXJyb3IiLCJzbGljZSIsImV4Y2VwdGlvbiIsIkV4Y2VwdGlvbiIsIk1lc3NhZ2UiLCJhcGlGZXRjaFdpdGhSZXRyeSIsIm1heEF0dGVtcHRzIiwiYXR0ZW1wdCIsImVyciIsIm1zZyIsIm1lc3NhZ2UiLCJpbmNsdWRlcyIsIlByb21pc2UiLCJyIiwic2V0VGltZW91dCIsIlBzYWdvdFNjcmFwZXIiLCJCYXNlUG9ydGZvbGlvU2NyYXBlciIsImZldGNoUG9ydGZvbGlvIiwiY3JlZGVudGlhbHMiLCJvdHBDb2RlUmV0cmlldmVyIiwiYXBwU2Vzc2lvbktleSIsImFwcENzZXNzaW9uIiwiY2FwdHVyZWRBY2NvdW50cyIsImNhcHR1cmVkQmFsYW5jZXMiLCJNYXAiLCJvbiIsInJlcXVlc3QiLCJzayIsInJlc3BvbnNlIiwianNvbiIsInRoZW4iLCJMb2dpbiIsIlNlc3Npb25LZXkiLCJjYXRjaCIsInVuZGVmaW5lZCIsIlVzZXJBY2NvdW50cyIsImFjY291bnRNYXRjaCIsIm1hdGNoIiwic2V0Iiwic2V0VXNlckFnZW50IiwiZ290byIsIndhaXRVbnRpbCIsImNvbnNvbGUiLCJsb2ciLCJIVE1MRWxlbWVudCIsInR5cGUiLCJjYiIsImdldEF0dHJpYnV0ZSIsImJ0biIsIm90cElucHV0QXBwZWFyZWQiLCJsZW5ndGgiLCJpbnB1dHMiLCJtYXAiLCJvdHBBcmlhTGFiZWwiLCJjb2RlIiwicmVzb2x2ZSIsInJlamVjdCIsImRlYWRsaW5lIiwiRGF0ZSIsIm5vdyIsImNoZWNrIiwic2V0SW50ZXJ2YWwiLCJjbGVhckludGVydmFsIiwiZWZmZWN0aXZlS2V5IiwiTWF0aCIsInJhbmRvbSIsImFjY291bnRzUmVzIiwicmF3QWNjb3VudHMiLCJVc2VyQWNjb3VudCIsImFjY291bnRJZHMiLCJpc0FycmF5IiwiYSIsInN0cmluZ2lmeSIsImFsbFBvc2l0aW9ucyIsInRvdGFsQ2FzaElscyIsImxhc3RFeHBsaWNpdEZldGNoIiwiYWNjb3VudElkIiwiY2FwdHVyZWQiLCJ2YWwiLCJnZXQiLCJiYWxhbmNlc1JlcyIsIndhaXQiLCJ0eXBlZFJlcyIsImFjY291bnQiLCJWaWV3IiwiQWNjb3VudCIsIk51bWJlciIsIk9ubGluZUNhc2giLCJyYXdNZXRhIiwiTWV0YSIsIlNlY3VyaXR5IiwibWV0YVNlY3VyaXRpZXMiLCJuYW1lQnlJZCIsInMiLCJIZWJOYW1lIiwicmF3QmFsYW5jZXMiLCJBY2NvdW50UG9zaXRpb24iLCJCYWxhbmNlIiwiYmFsYW5jZXMiLCJiIiwic2VjSWQiLCJxdHkiLCJwcmljZSIsImF2Z0Nvc3QiLCJwbmwiLCJjdXJyZW5jeSIsIm5hbWUiLCJwdXNoIiwiaWRlbnRpZmllciIsInF1YW50aXR5IiwidW5yZWFsaXplZFBubCIsImNhc2giLCJhbW91bnQiLCJwb3NpdGlvbnMiLCJhc09mRGF0ZSIsInRvSVNPU3RyaW5nIiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9wb3J0Zm9saW8tc2NyYXBlcnMvcHNhZ290LnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHR5cGUgUGFnZSB9IGZyb20gJ3B1cHBldGVlcic7XG5pbXBvcnQgeyBCYXNlUG9ydGZvbGlvU2NyYXBlciB9IGZyb20gJy4vYmFzZS1wb3J0Zm9saW8tc2NyYXBlcic7XG5pbXBvcnQgdHlwZSB7IFBvcnRmb2xpb0Nhc2gsIFBvcnRmb2xpb1Bvc2l0aW9uIH0gZnJvbSAnLi9pbnRlcmZhY2UnO1xuXG5jb25zdCBCQVNFX1VSTCA9ICdodHRwczovL3RyYWRlMS5wc2Fnb3QuY28uaWwnO1xuY29uc3QgTE9HSU5fVVJMID0gJ2h0dHBzOi8vdHJhZGUucHNhZ290LmNvLmlsLyc7XG5jb25zdCBVU0VSX0FHRU5UID1cbiAgJ01vemlsbGEvNS4wIChXaW5kb3dzIE5UIDEwLjA7IFdpbjY0OyB4NjQpIEFwcGxlV2ViS2l0LzUzNy4zNiAoS0hUTUwsIGxpa2UgR2Vja28pIENocm9tZS8xMjQuMC4wLjAgU2FmYXJpLzUzNy4zNic7XG5cbmNvbnN0IFNFTCA9IHtcbiAgdXNlcm5hbWU6ICdpbnB1dFthcmlhLWxhYmVsPVwiVXNlcm5hbWUgcmVxdWlyZWRcIl0nLFxuICBwYXNzd29yZDogJ2lucHV0W2FyaWEtbGFiZWw9XCJQYXNzd29yZCByZXF1aXJlZFwiXScsXG59IGFzIGNvbnN0O1xuXG5hc3luYyBmdW5jdGlvbiB3YWl0Rm9yRWxlbWVudChwYWdlOiBQYWdlLCBzZWxlY3Rvcjogc3RyaW5nLCB0aW1lb3V0ID0gNjBfMDAwKTogUHJvbWlzZTx2b2lkPiB7XG4gIGF3YWl0IHBhZ2Uud2FpdEZvckZ1bmN0aW9uKChzZWw6IHN0cmluZykgPT4gZG9jdW1lbnQucXVlcnlTZWxlY3RvcihzZWwpICE9PSBudWxsLCB7IHRpbWVvdXQgfSwgc2VsZWN0b3IpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBmbHV0dGVyQ2xpY2tCeVRleHQocGFnZTogUGFnZSwgdGV4dDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gIGF3YWl0IHBhZ2UuZXZhbHVhdGUoKHQ6IHN0cmluZykgPT4ge1xuICAgIGNvbnN0IGVsID0gQXJyYXkuZnJvbShkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCdmbHQtc2VtYW50aWNzW3JvbGU9XCJidXR0b25cIl0nKSkuZmluZChcbiAgICAgIG5vZGUgPT4gbm9kZS50ZXh0Q29udGVudD8udHJpbSgpID09PSB0LFxuICAgICkgYXMgSFRNTEVsZW1lbnQgfCBudWxsO1xuICAgIGlmIChlbCkgZWwuY2xpY2soKTtcbiAgfSwgdGV4dCk7XG59XG5cbmZ1bmN0aW9uIHN0clZhbCh2OiB1bmtub3duLCBmYWxsYmFjayA9ICcnKTogc3RyaW5nIHtcbiAgaWYgKHR5cGVvZiB2ID09PSAnc3RyaW5nJykgcmV0dXJuIHY7XG4gIGlmICh0eXBlb2YgdiA9PT0gJ251bWJlcicpIHJldHVybiBTdHJpbmcodik7XG4gIHJldHVybiBmYWxsYmFjaztcbn1cblxuLy8gVGhlIEFQSSByZXR1cm5zIEhUVFAgMjAwLzQwMS81MDAgd2l0aCBhbiB7XCJFeGNlcHRpb25cIjogLi4ufSBKU09OIGJvZHkgb24gZmFpbHVyZSDigJRcbi8vIGUuZy4gSW52YWxpZFNlc3Npb25FeGNlcHRpb24gd2hlbiB0aGUgY3Nlc3Npb24gaGVhZGVyIGRvZXNuJ3QgbWF0Y2ggdGhlIG9uZSB0aGUgYXBwXG4vLyB1c2VkIGF0IGxvZ2luLCBvciBNaW5JbnRlcnZhbEV4Y2VwdGlvbiB3aGVuIHRoZSBzYW1lIGVuZHBvaW50IGlzIGhpdCB3aXRoaW4gMTAwMG1zLlxuYXN5bmMgZnVuY3Rpb24gYXBpRmV0Y2gocGFnZTogUGFnZSwgc2Vzc2lvbktleTogc3RyaW5nLCBjc2Vzc2lvbjogc3RyaW5nLCB1cmw6IHN0cmluZyk6IFByb21pc2U8dW5rbm93bj4ge1xuICBjb25zdCByYXcgPSAoYXdhaXQgcGFnZS5ldmFsdWF0ZShcbiAgICBhc3luYyAodGFyZ2V0VXJsOiBzdHJpbmcsIGtleTogc3RyaW5nLCBjczogc3RyaW5nKSA9PiB7XG4gICAgICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaCh0YXJnZXRVcmwsIHsgaGVhZGVyczogeyBzZXNzaW9uOiBrZXksIGNzZXNzaW9uOiBjcyB9IH0pO1xuICAgICAgcmV0dXJuIHsgc3RhdHVzOiByZXMuc3RhdHVzLCB0ZXh0OiBhd2FpdCByZXMudGV4dCgpIH07XG4gICAgfSxcbiAgICB1cmwsXG4gICAgc2Vzc2lvbktleSxcbiAgICBjc2Vzc2lvbixcbiAgKSkgYXMgeyBzdGF0dXM6IG51bWJlcjsgdGV4dDogc3RyaW5nIH07XG5cbiAgbGV0IGJvZHk6IHVua25vd247XG4gIHRyeSB7XG4gICAgYm9keSA9IEpTT04ucGFyc2UocmF3LnRleHQpO1xuICB9IGNhdGNoIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFBzYWdvdCBBUEkgbm9uLUpTT04gcmVzcG9uc2UgKEhUVFAgJHtyYXcuc3RhdHVzfSkgZnJvbSAke3VybH06ICR7cmF3LnRleHQuc2xpY2UoMCwgMjAwKX1gKTtcbiAgfVxuICBjb25zdCBleGNlcHRpb24gPSAoYm9keSBhcyB7IEV4Y2VwdGlvbj86IHsgJy1FeGNlcHRpb25UeXBlJz86IHN0cmluZzsgTWVzc2FnZT86IHN0cmluZyB9IH0pPy5FeGNlcHRpb247XG4gIGlmIChleGNlcHRpb24pIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFBzYWdvdCBBUEkgJHtleGNlcHRpb25bJy1FeGNlcHRpb25UeXBlJ10gPz8gJ0V4Y2VwdGlvbid9IGZyb20gJHt1cmx9OiAke2V4Y2VwdGlvbi5NZXNzYWdlID8/ICcnfWApO1xuICB9XG4gIGlmIChyYXcuc3RhdHVzIDwgMjAwIHx8IHJhdy5zdGF0dXMgPj0gMzAwKSB0aHJvdyBuZXcgRXJyb3IoYEhUVFAgJHtyYXcuc3RhdHVzfSBmcm9tICR7dXJsfWApO1xuICByZXR1cm4gYm9keTtcbn1cblxuLy8gVGhlIEZsdXR0ZXIgYXBwIHBvbGxzIHNvbWUgZW5kcG9pbnRzIGl0c2VsZjsgYW4gZXhwbGljaXQgZmV0Y2ggY2FuIGNvbGxpZGUgd2l0aCBpdHNcbi8vIHBvbGxpbmcgYW5kIGdldCBNaW5JbnRlcnZhbEV4Y2VwdGlvbiDigJQgYmFjayBvZmYgYW5kIHJldHJ5IGluc3RlYWQgb2YgZmFpbGluZyB0aGUgc2Nhbi5cbmFzeW5jIGZ1bmN0aW9uIGFwaUZldGNoV2l0aFJldHJ5KHBhZ2U6IFBhZ2UsIHNlc3Npb25LZXk6IHN0cmluZywgY3Nlc3Npb246IHN0cmluZywgdXJsOiBzdHJpbmcpOiBQcm9taXNlPHVua25vd24+IHtcbiAgY29uc3QgbWF4QXR0ZW1wdHMgPSAzO1xuICBmb3IgKGxldCBhdHRlbXB0ID0gMTsgOyBhdHRlbXB0KyspIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IGFwaUZldGNoKHBhZ2UsIHNlc3Npb25LZXksIGNzZXNzaW9uLCB1cmwpO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgY29uc3QgbXNnID0gZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIubWVzc2FnZSA6IFN0cmluZyhlcnIpO1xuICAgICAgaWYgKGF0dGVtcHQgPCBtYXhBdHRlbXB0cyAmJiBtc2cuaW5jbHVkZXMoJ01pbkludGVydmFsRXhjZXB0aW9uJykpIHtcbiAgICAgICAgYXdhaXQgbmV3IFByb21pc2UociA9PiBzZXRUaW1lb3V0KHIsIDFfNjAwKSk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgdGhyb3cgZXJyO1xuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgUHNhZ290U2NyYXBlciBleHRlbmRzIEJhc2VQb3J0Zm9saW9TY3JhcGVyIHtcbiAgcHJvdGVjdGVkIGFzeW5jIGZldGNoUG9ydGZvbGlvKFxuICAgIHBhZ2U6IFBhZ2UsXG4gICAgY3JlZGVudGlhbHM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICApOiBQcm9taXNlPHsgcG9zaXRpb25zOiBQb3J0Zm9saW9Qb3NpdGlvbltdOyBjYXNoOiBQb3J0Zm9saW9DYXNoW107IGFzT2ZEYXRlOiBzdHJpbmcgfT4ge1xuICAgIGNvbnN0IHVzZXJuYW1lID0gdHlwZW9mIGNyZWRlbnRpYWxzWyd1c2VybmFtZSddID09PSAnc3RyaW5nJyA/IGNyZWRlbnRpYWxzWyd1c2VybmFtZSddIDogJyc7XG4gICAgY29uc3QgcGFzc3dvcmQgPSB0eXBlb2YgY3JlZGVudGlhbHNbJ3Bhc3N3b3JkJ10gPT09ICdzdHJpbmcnID8gY3JlZGVudGlhbHNbJ3Bhc3N3b3JkJ10gOiAnJztcbiAgICBjb25zdCBvdHBDb2RlUmV0cmlldmVyID0gY3JlZGVudGlhbHNbJ290cENvZGVSZXRyaWV2ZXInXSBhcyAoKCkgPT4gUHJvbWlzZTxzdHJpbmc+KSB8IHVuZGVmaW5lZDtcblxuICAgIC8vIOKUgOKUgCAxLiBJbnRlcmNlcHRvcnM6IFNlc3Npb25LZXksIGNzZXNzaW9uLCBhbmQgdGhlIGFwcCdzIG93biBBUEkgcmVzcG9uc2VzIOKUgFxuICAgIGxldCBzZXNzaW9uS2V5ID0gJyc7XG4gICAgLy8gVGhlIEFQSSBiaW5kcyB0aGUgU2Vzc2lvbktleSB0byB0aGUgY3Nlc3Npb24gdmFsdWUgdGhlIEZsdXR0ZXIgYXBwIGdlbmVyYXRlZCBhdFxuICAgIC8vIGxvZ2luLiBFeHBsaWNpdCBmZXRjaGVzIHdpdGggYW55IG90aGVyIGNzZXNzaW9uIGdldCBJbnZhbGlkU2Vzc2lvbkV4Y2VwdGlvbiwgc29cbiAgICAvLyBjYXB0dXJlIHRoZSBhcHAncyB2YWx1ZSBmcm9tIGl0cyBvd24gYXV0aGVudGljYXRlZCByZXF1ZXN0cy5cbiAgICBsZXQgYXBwU2Vzc2lvbktleSA9ICcnO1xuICAgIGxldCBhcHBDc2Vzc2lvbiA9ICcnO1xuICAgIGxldCBjYXB0dXJlZEFjY291bnRzOiB1bmtub3duO1xuICAgIC8vIEJhbGFuY2VzIHJlc3BvbnNlcyBpbnRlcmNlcHRlZCBmcm9tIHRoZSBGbHV0dGVyIGFwcCdzIG93biBwb2xsaW5nIOKAlCB1c2VkIGluc3RlYWQgb2ZcbiAgICAvLyBleHBsaWNpdCBhcGlGZXRjaCBmb3IgYWNjb3VudHMgdGhlIGFwcCBhdXRvLWxvYWRzIChhdm9pZHMgY29uY3VycmVudC1yZXF1ZXN0IDQwMXMpLlxuICAgIGNvbnN0IGNhcHR1cmVkQmFsYW5jZXMgPSBuZXcgTWFwPHN0cmluZywgdW5rbm93bj4oKTtcblxuICAgIHBhZ2Uub24oJ3JlcXVlc3QnLCByZXF1ZXN0ID0+IHtcbiAgICAgIGNvbnN0IHVybCA9IHJlcXVlc3QudXJsKCk7XG4gICAgICBpZiAoIXVybC5pbmNsdWRlcygndHJhZGUxLnBzYWdvdC5jby5pbCcpKSByZXR1cm47XG4gICAgICBjb25zdCBoZWFkZXJzID0gcmVxdWVzdC5oZWFkZXJzKCk7XG4gICAgICBjb25zdCBzayA9IGhlYWRlcnNbJ3Nlc3Npb24nXTtcbiAgICAgIGNvbnN0IGNzID0gaGVhZGVyc1snY3Nlc3Npb24nXTtcbiAgICAgIGlmIChzayAmJiAhYXBwU2Vzc2lvbktleSkgYXBwU2Vzc2lvbktleSA9IHNrO1xuICAgICAgaWYgKGNzICYmICFhcHBDc2Vzc2lvbikgYXBwQ3Nlc3Npb24gPSBjcztcbiAgICB9KTtcblxuICAgIHBhZ2Uub24oJ3Jlc3BvbnNlJywgcmVzcG9uc2UgPT4ge1xuICAgICAgY29uc3QgdXJsID0gcmVzcG9uc2UudXJsKCk7XG4gICAgICBpZiAodXJsLmluY2x1ZGVzKCcvbG9naW4nKSkge1xuICAgICAgICB2b2lkIHJlc3BvbnNlXG4gICAgICAgICAgLmpzb24oKVxuICAgICAgICAgIC50aGVuKChib2R5OiB1bmtub3duKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBrZXkgPSAoYm9keSBhcyB7IExvZ2luPzogeyBTZXNzaW9uS2V5Pzogc3RyaW5nIH0gfSk/LkxvZ2luPy5TZXNzaW9uS2V5O1xuICAgICAgICAgICAgaWYgKGtleSkgc2Vzc2lvbktleSA9IGtleTtcbiAgICAgICAgICB9KVxuICAgICAgICAgIC5jYXRjaCgoKSA9PiB1bmRlZmluZWQpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBpZiAodXJsLmluY2x1ZGVzKCcvVjIvanNvbi9hY2NvdW50cycpKSB7XG4gICAgICAgIHZvaWQgcmVzcG9uc2VcbiAgICAgICAgICAuanNvbigpXG4gICAgICAgICAgLnRoZW4oKGJvZHk6IHVua25vd24pID0+IHtcbiAgICAgICAgICAgIGlmICgoYm9keSBhcyB7IFVzZXJBY2NvdW50cz86IHVua25vd24gfSk/LlVzZXJBY2NvdW50cykgY2FwdHVyZWRBY2NvdW50cyA9IGJvZHk7XG4gICAgICAgICAgfSlcbiAgICAgICAgICAuY2F0Y2goKCkgPT4gdW5kZWZpbmVkKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgaWYgKHVybC5pbmNsdWRlcygnL2FjY291bnQvdmlldy9iYWxhbmNlcycpKSB7XG4gICAgICAgIGNvbnN0IGFjY291bnRNYXRjaCA9IHVybC5tYXRjaCgvYWNjb3VudD0oW14mXSspLyk7XG4gICAgICAgIGlmIChhY2NvdW50TWF0Y2gpIHtcbiAgICAgICAgICB2b2lkIHJlc3BvbnNlXG4gICAgICAgICAgICAuanNvbigpXG4gICAgICAgICAgICAudGhlbigoYm9keTogdW5rbm93bikgPT4geyBjYXB0dXJlZEJhbGFuY2VzLnNldChhY2NvdW50TWF0Y2hbMV0sIGJvZHkpOyB9KVxuICAgICAgICAgICAgLmNhdGNoKCgpID0+IHVuZGVmaW5lZCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgCAyLiBCb290IEZsdXR0ZXIg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgYXdhaXQgcGFnZS5zZXRVc2VyQWdlbnQoVVNFUl9BR0VOVCk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKExPR0lOX1VSTCwgeyB3YWl0VW50aWw6ICdsb2FkJywgdGltZW91dDogMTIwXzAwMCB9KTtcbiAgICBhd2FpdCB3YWl0Rm9yRWxlbWVudChwYWdlLCAnZmx0LWdsYXNzLXBhbmUnLCAxMjBfMDAwKTtcbiAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICAgIGNvbnNvbGUubG9nKCdbcHNhZ290LXNjcmFwZXJdIEZsdXR0ZXIgaW5pdGlhbGl6ZWQnKTtcblxuICAgIC8vIOKUgOKUgCAzLiBMb2dpbiDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICBhd2FpdCB3YWl0Rm9yRWxlbWVudChwYWdlLCAnZmx0LXNlbWFudGljcy1wbGFjZWhvbGRlcicsIDMwXzAwMCk7XG4gICAgYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiB7XG4gICAgICBjb25zdCBlbCA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJ2ZsdC1zZW1hbnRpY3MtcGxhY2Vob2xkZXInKTtcbiAgICAgIGlmIChlbCBpbnN0YW5jZW9mIEhUTUxFbGVtZW50KSBlbC5jbGljaygpO1xuICAgIH0pO1xuICAgIGF3YWl0IHdhaXRGb3JFbGVtZW50KHBhZ2UsIFNFTC51c2VybmFtZSwgMzBfMDAwKTtcbiAgICBhd2FpdCBwYWdlLnR5cGUoU0VMLnVzZXJuYW1lLCB1c2VybmFtZSk7XG4gICAgYXdhaXQgcGFnZS50eXBlKFNFTC5wYXNzd29yZCwgcGFzc3dvcmQpO1xuXG4gICAgYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiB7XG4gICAgICBjb25zdCBjYiA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJ2ZsdC1zZW1hbnRpY3Nbcm9sZT1cImNoZWNrYm94XCJdJyk7XG4gICAgICBpZiAoY2IgaW5zdGFuY2VvZiBIVE1MRWxlbWVudCkgY2IuY2xpY2soKTtcbiAgICB9KTtcbiAgICBhd2FpdCBwYWdlLndhaXRGb3JGdW5jdGlvbihcbiAgICAgICgpID0+IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJ2ZsdC1zZW1hbnRpY3Nbcm9sZT1cImNoZWNrYm94XCJdJyk/LmdldEF0dHJpYnV0ZSgnYXJpYS1jaGVja2VkJykgPT09ICd0cnVlJyxcbiAgICAgIHsgdGltZW91dDogMTBfMDAwIH0sXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlLndhaXRGb3JGdW5jdGlvbihcbiAgICAgICgpID0+IHtcbiAgICAgICAgY29uc3QgYnRuID0gQXJyYXkuZnJvbShkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCdmbHQtc2VtYW50aWNzW3JvbGU9XCJidXR0b25cIl0nKSkuZmluZChcbiAgICAgICAgICBlbCA9PiBlbC50ZXh0Q29udGVudD8udHJpbSgpID09PSAnTG9naW4nLFxuICAgICAgICApO1xuICAgICAgICByZXR1cm4gYnRuICE9IG51bGwgJiYgYnRuLmdldEF0dHJpYnV0ZSgnYXJpYS1kaXNhYmxlZCcpICE9PSAndHJ1ZSc7XG4gICAgICB9LFxuICAgICAgeyB0aW1lb3V0OiAzMF8wMDAgfSxcbiAgICApO1xuICAgIGF3YWl0IGZsdXR0ZXJDbGlja0J5VGV4dChwYWdlLCAnTG9naW4nKTtcbiAgICBhd2FpdCBwYWdlLndhaXRGb3JGdW5jdGlvbigoKSA9PiAhZG9jdW1lbnQucXVlcnlTZWxlY3RvcignaW5wdXRbYXJpYS1sYWJlbD1cIlVzZXJuYW1lIHJlcXVpcmVkXCJdJyksIHtcbiAgICAgIHRpbWVvdXQ6IDYwXzAwMCxcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgCA0LiBPVFAgKG9wdGlvbmFsKSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICBjb25zdCBvdHBJbnB1dEFwcGVhcmVkID0gYXdhaXQgcGFnZVxuICAgICAgLndhaXRGb3JGdW5jdGlvbigoKSA9PiBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCdpbnB1dCcpLmxlbmd0aCA+IDAsIHsgdGltZW91dDogMTBfMDAwIH0pXG4gICAgICAudGhlbigoKSA9PiB0cnVlKVxuICAgICAgLmNhdGNoKCgpID0+IGZhbHNlKTtcblxuICAgIGlmIChvdHBJbnB1dEFwcGVhcmVkICYmIG90cENvZGVSZXRyaWV2ZXIpIHtcbiAgICAgIGNvbnN0IGlucHV0cyA9IGF3YWl0IHBhZ2UuZXZhbHVhdGUoKCkgPT5cbiAgICAgICAgQXJyYXkuZnJvbShkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCdpbnB1dCcpKS5tYXAoZWwgPT4gZWwuZ2V0QXR0cmlidXRlKCdhcmlhLWxhYmVsJykpLFxuICAgICAgKTtcbiAgICAgIGNvbnN0IG90cEFyaWFMYWJlbCA9IGlucHV0c1swXSA/PyAnJztcbiAgICAgIGlmIChvdHBBcmlhTGFiZWwpIHtcbiAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgICAgICAgY29uc29sZS5sb2coJ1twc2Fnb3Qtc2NyYXBlcl0gT1RQIHJlcXVpcmVkJyk7XG4gICAgICAgIGNvbnN0IGNvZGUgPSBhd2FpdCBvdHBDb2RlUmV0cmlldmVyKCk7XG4gICAgICAgIGF3YWl0IHBhZ2UudHlwZShgaW5wdXRbYXJpYS1sYWJlbD1cIiR7b3RwQXJpYUxhYmVsfVwiXWAsIGNvZGUpO1xuICAgICAgICAvLyBGbHV0dGVyIG1heSBhdXRvLXN1Ym1pdCBhZnRlciBhbGwgT1RQIGRpZ2l0cyBhcmUgZW50ZXJlZC5cbiAgICAgICAgLy8gVHJ5IGNsaWNraW5nIExvZ2luIG9ubHkgaWYgaXQgYmVjb21lcyBhY3RpdmUgd2l0aGluIDVzOyBpZ25vcmUgaWYgaXQgZG9lc24ndC5cbiAgICAgICAgYXdhaXQgcGFnZVxuICAgICAgICAgIC53YWl0Rm9yRnVuY3Rpb24oXG4gICAgICAgICAgICAoKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IGJ0biA9IEFycmF5LmZyb20oZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnZmx0LXNlbWFudGljc1tyb2xlPVwiYnV0dG9uXCJdJykpLmZpbmQoXG4gICAgICAgICAgICAgICAgZWwgPT4gZWwudGV4dENvbnRlbnQ/LnRyaW0oKSA9PT0gJ0xvZ2luJyxcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgcmV0dXJuIGJ0biAhPSBudWxsICYmIGJ0bi5nZXRBdHRyaWJ1dGUoJ2FyaWEtZGlzYWJsZWQnKSAhPT0gJ3RydWUnO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHsgdGltZW91dDogNV8wMDAgfSxcbiAgICAgICAgICApXG4gICAgICAgICAgLnRoZW4oKCkgPT4gZmx1dHRlckNsaWNrQnlUZXh0KHBhZ2UsICdMb2dpbicpKVxuICAgICAgICAgIC5jYXRjaCgoKSA9PiB1bmRlZmluZWQpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIOKUgOKUgCA1LiBXYWl0IGZvciBwb3N0LWxvZ2luIFNlc3Npb25LZXkgKHBvbGxzIE5vZGUuanMgdmFyaWFibGUgc2V0IGJ5IHJlc3BvbnNlIGxpc3RlbmVyKSDilIDilIBcbiAgICAvLyBVUkwtYmFzZWQgaGV1cmlzdGljcyBmYWlsIGZvciBGbHV0dGVyIFNQQXMgdGhhdCBzdGF5IGF0ICcvJyBhZnRlciBsb2dpbi5cbiAgICBhd2FpdCBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBjb25zdCBkZWFkbGluZSA9IERhdGUubm93KCkgKyA2MF8wMDA7XG4gICAgICBjb25zdCBjaGVjayA9IHNldEludGVydmFsKCgpID0+IHtcbiAgICAgICAgaWYgKHNlc3Npb25LZXkgfHwgYXBwU2Vzc2lvbktleSkgeyBjbGVhckludGVydmFsKGNoZWNrKTsgcmVzb2x2ZSgpOyByZXR1cm47IH1cbiAgICAgICAgaWYgKERhdGUubm93KCkgPiBkZWFkbGluZSkgeyBjbGVhckludGVydmFsKGNoZWNrKTsgcmVqZWN0KG5ldyBFcnJvcignTG9naW4gdGltZWQgb3V0OiBubyBTZXNzaW9uS2V5IHJlY2VpdmVkJykpOyB9XG4gICAgICB9LCA1MDApO1xuICAgIH0pO1xuICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gICAgY29uc29sZS5sb2coJ1twc2Fnb3Qtc2NyYXBlcl0gbG9nZ2VkIGluLCBzZXNzaW9uS2V5IGNhcHR1cmVkOicsIHNlc3Npb25LZXkgfHwgYXBwU2Vzc2lvbktleSA/ICd5ZXMnIDogJ05PJyk7XG5cbiAgICAvLyBXYWl0IGZvciB0aGUgYXBwJ3MgZmlyc3QgYXV0aGVudGljYXRlZCByZXF1ZXN0IChjYXJyaWVzIHRoZSBjc2Vzc2lvbiB0aGUgc2VydmVyXG4gICAgLy8gYm91bmQgYXQgbG9naW4pIOKAlCBpZGVhbGx5IGl0cyBvd24gYWNjb3VudHMgcmVzcG9uc2UgYXJyaXZlcyBpbiB0aGUgc2FtZSB3aW5kb3cuXG4gICAgYXdhaXQgbmV3IFByb21pc2U8dm9pZD4ocmVzb2x2ZSA9PiB7XG4gICAgICBjb25zdCBkZWFkbGluZSA9IERhdGUubm93KCkgKyAxNV8wMDA7XG4gICAgICBjb25zdCBjaGVjayA9IHNldEludGVydmFsKCgpID0+IHtcbiAgICAgICAgaWYgKGNhcHR1cmVkQWNjb3VudHMgIT09IHVuZGVmaW5lZCB8fCBhcHBDc2Vzc2lvbiB8fCBEYXRlLm5vdygpID4gZGVhZGxpbmUpIHtcbiAgICAgICAgICBjbGVhckludGVydmFsKGNoZWNrKTtcbiAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgIH1cbiAgICAgIH0sIDI1MCk7XG4gICAgfSk7XG4gICAgY29uc3QgZWZmZWN0aXZlS2V5ID0gc2Vzc2lvbktleSB8fCBhcHBTZXNzaW9uS2V5O1xuICAgIGNvbnN0IGNzZXNzaW9uID0gYXBwQ3Nlc3Npb24gfHwgU3RyaW5nKE1hdGgucmFuZG9tKCkpO1xuICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gICAgY29uc29sZS5sb2coJ1twc2Fnb3Qtc2NyYXBlcl0gY3Nlc3Npb24gY2FwdHVyZWQ6JywgYXBwQ3Nlc3Npb24gPyAneWVzJyA6ICdOTyAoZmFsbGJhY2sgcmFuZG9tIOKAlCBBUEkgY2FsbHMgd2lsbCBsaWtlbHkgZmFpbCknKTtcblxuICAgIGlmICghZWZmZWN0aXZlS2V5KSB0aHJvdyBuZXcgRXJyb3IoJ1BzYWdvdCBsb2dpbiBzdWNjZWVkZWQgYnV0IFNlc3Npb25LZXkgd2FzIG5vdCBjYXB0dXJlZCBmcm9tIHJlc3BvbnNlJyk7XG5cbiAgICAvLyDilIDilIAgNi4gRmV0Y2ggYWNjb3VudHMgKHByZWZlciB0aGUgYXBwJ3Mgb3duIHJlc3BvbnNlLCBpbnRlcmNlcHRlZCBhYm92ZSkg4pSA4pSAXG4gICAgbGV0IGFjY291bnRzUmVzOiB7XG4gICAgICBVc2VyQWNjb3VudHM/OiB7IFVzZXJBY2NvdW50PzogQXJyYXk8eyAnLWtleSc6IHN0cmluZyB9PiB8IHsgJy1rZXknOiBzdHJpbmcgfSB9O1xuICAgIH07XG4gICAgaWYgKGNhcHR1cmVkQWNjb3VudHMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgICAgIGNvbnNvbGUubG9nKCdbcHNhZ290LXNjcmFwZXJdIHVzaW5nIGludGVyY2VwdGVkIGFjY291bnRzIHJlc3BvbnNlJyk7XG4gICAgICBhY2NvdW50c1JlcyA9IGNhcHR1cmVkQWNjb3VudHMgYXMgdHlwZW9mIGFjY291bnRzUmVzO1xuICAgIH0gZWxzZSB7XG4gICAgICBhY2NvdW50c1JlcyA9IChhd2FpdCBhcGlGZXRjaFdpdGhSZXRyeShcbiAgICAgICAgcGFnZSxcbiAgICAgICAgZWZmZWN0aXZlS2V5LFxuICAgICAgICBjc2Vzc2lvbixcbiAgICAgICAgYCR7QkFTRV9VUkx9L1YyL2pzb24vYWNjb3VudHM/Y2F0YWxvZz11bmlmaWVkYCxcbiAgICAgICkpIGFzIHR5cGVvZiBhY2NvdW50c1JlcztcbiAgICB9XG4gICAgY29uc3QgcmF3QWNjb3VudHMgPSBhY2NvdW50c1Jlcz8uVXNlckFjY291bnRzPy5Vc2VyQWNjb3VudDtcbiAgICBjb25zdCBhY2NvdW50SWRzID0gKEFycmF5LmlzQXJyYXkocmF3QWNjb3VudHMpID8gcmF3QWNjb3VudHMgOiByYXdBY2NvdW50cyA/IFtyYXdBY2NvdW50c10gOiBbXSkubWFwKFxuICAgICAgYSA9PiBhWycta2V5J10sXG4gICAgKTtcbiAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICAgIGNvbnNvbGUubG9nKCdbcHNhZ290LXNjcmFwZXJdIGFjY291bnRzOicsIGFjY291bnRJZHMpO1xuICAgIGlmIChhY2NvdW50SWRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBQc2Fnb3QgcmV0dXJuZWQgbm8gYWNjb3VudHMg4oCUIHJhdzogJHtKU09OLnN0cmluZ2lmeShhY2NvdW50c1Jlcykuc2xpY2UoMCwgMzAwKX1gKTtcbiAgICB9XG5cbiAgICAvLyDilIDilIAgNy4gRmV0Y2ggYmFsYW5jZXMgZm9yIGVhY2ggYWNjb3VudCDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICBjb25zdCBhbGxQb3NpdGlvbnM6IFBvcnRmb2xpb1Bvc2l0aW9uW10gPSBbXTtcbiAgICBsZXQgdG90YWxDYXNoSWxzID0gMDtcbiAgICBsZXQgbGFzdEV4cGxpY2l0RmV0Y2ggPSAwOyAvLyBtcyB0aW1lc3RhbXAg4oCUIGVuZm9yY2UgMTUwMG1zIG1pbiBiZXR3ZWVuIGV4cGxpY2l0IGFwaUZldGNoIGNhbGxzXG5cbiAgICBmb3IgKGNvbnN0IGFjY291bnRJZCBvZiBhY2NvdW50SWRzKSB7XG4gICAgICAvLyBXYWl0IHVwIHRvIDVzIGZvciB0aGUgRmx1dHRlciBhcHAgdG8gYXV0by1wb3B1bGF0ZSB0aGlzIGFjY291bnQncyBiYWxhbmNlc1xuICAgICAgLy8gKGl0IGNvbnRpbnVvdXNseSBwb2xscyBwcmltYXJ5IGFjY291bnRzIOKAlCBpbnRlcmNlcHRpbmcgYXZvaWRzIGNvbmN1cnJlbnQtcmVxdWVzdCA0MDFzKS5cbiAgICAgIGNvbnN0IGNhcHR1cmVkID0gYXdhaXQgbmV3IFByb21pc2U8dW5rbm93bj4ocmVzb2x2ZSA9PiB7XG4gICAgICAgIGNvbnN0IGRlYWRsaW5lID0gRGF0ZS5ub3coKSArIDVfMDAwO1xuICAgICAgICBjb25zdCBjaGVjayA9IHNldEludGVydmFsKCgpID0+IHtcbiAgICAgICAgICBjb25zdCB2YWwgPSBjYXB0dXJlZEJhbGFuY2VzLmdldChhY2NvdW50SWQpO1xuICAgICAgICAgIGlmICh2YWwgIT09IHVuZGVmaW5lZCkgeyBjbGVhckludGVydmFsKGNoZWNrKTsgcmVzb2x2ZSh2YWwpOyByZXR1cm47IH1cbiAgICAgICAgICBpZiAoRGF0ZS5ub3coKSA+IGRlYWRsaW5lKSB7IGNsZWFySW50ZXJ2YWwoY2hlY2spOyByZXNvbHZlKHVuZGVmaW5lZCk7IH1cbiAgICAgICAgfSwgMjAwKTtcbiAgICAgIH0pO1xuXG4gICAgICBsZXQgYmFsYW5jZXNSZXM6IHVua25vd247XG4gICAgICBpZiAoY2FwdHVyZWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICAgICAgICBjb25zb2xlLmxvZyhgW3BzYWdvdC1zY3JhcGVyXSB1c2luZyBpbnRlcmNlcHRlZCBiYWxhbmNlcyBmb3IgJHthY2NvdW50SWR9YCk7XG4gICAgICAgIGJhbGFuY2VzUmVzID0gY2FwdHVyZWQ7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBOb3QgYXV0by1mZXRjaGVkIGJ5IHRoZSBhcHAg4oCUIGRvIGFuIGV4cGxpY2l0IGZldGNoLCByZXNwZWN0aW5nIHRoZSAxMDAwbXMgc2VydmVyIHJhdGUgbGltaXQuXG4gICAgICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XG4gICAgICAgIGNvbnN0IHdhaXQgPSAxXzUwMCAtIChub3cgLSBsYXN0RXhwbGljaXRGZXRjaCk7XG4gICAgICAgIGlmICh3YWl0ID4gMCkgYXdhaXQgbmV3IFByb21pc2UociA9PiBzZXRUaW1lb3V0KHIsIHdhaXQpKTtcbiAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgICAgICAgY29uc29sZS5sb2coYFtwc2Fnb3Qtc2NyYXBlcl0gZXhwbGljaXQgYXBpRmV0Y2ggYmFsYW5jZXMgZm9yICR7YWNjb3VudElkfWApO1xuICAgICAgICBiYWxhbmNlc1JlcyA9IGF3YWl0IGFwaUZldGNoV2l0aFJldHJ5KFxuICAgICAgICAgIHBhZ2UsXG4gICAgICAgICAgZWZmZWN0aXZlS2V5LFxuICAgICAgICAgIGNzZXNzaW9uLFxuICAgICAgICAgIGAke0JBU0VfVVJMfS9WMi9qc29uMi9hY2NvdW50L3ZpZXcvYmFsYW5jZXM/YWNjb3VudD0ke2FjY291bnRJZH0mZmllbGRzPWhlYk5hbWUmY3VycmVuY3k9aWxzJmNhdGFsb2c9dW5pZmllZGAsXG4gICAgICAgICk7XG4gICAgICAgIGxhc3RFeHBsaWNpdEZldGNoID0gRGF0ZS5ub3coKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgdHlwZWRSZXMgPSBiYWxhbmNlc1JlcyBhcyB7XG4gICAgICAgIFZpZXc/OiB7XG4gICAgICAgICAgQWNjb3VudD86IHtcbiAgICAgICAgICAgIE9ubGluZUNhc2g/OiBudW1iZXI7XG4gICAgICAgICAgICBBY2NvdW50UG9zaXRpb24/OiB7IEJhbGFuY2U/OiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj4gfCBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB9O1xuICAgICAgICAgIH07XG4gICAgICAgICAgTWV0YT86IHsgU2VjdXJpdHk/OiBBcnJheTx7ICctS2V5Jzogc3RyaW5nOyBIZWJOYW1lPzogc3RyaW5nIH0+IHwgeyAnLUtleSc6IHN0cmluZzsgSGViTmFtZT86IHN0cmluZyB9IH07XG4gICAgICAgIH07XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBhY2NvdW50ID0gdHlwZWRSZXM/LlZpZXc/LkFjY291bnQ7XG4gICAgICBpZiAoIWFjY291bnQpIHtcbiAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgICAgICAgY29uc29sZS5sb2coYFtwc2Fnb3Qtc2NyYXBlcl0gbm8gQWNjb3VudCBpbiBiYWxhbmNlcyByZXNwb25zZSBmb3IgJHthY2NvdW50SWR9YCk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICB0b3RhbENhc2hJbHMgKz0gTnVtYmVyKGFjY291bnQuT25saW5lQ2FzaCA/PyAwKTtcblxuICAgICAgLy8gQnVpbGQgYSBtYXAgb2Ygc2VjdXJpdHkgSUQg4oaSIG5hbWUgZnJvbSBNZXRhLlNlY3VyaXR5XG4gICAgICBjb25zdCByYXdNZXRhID0gdHlwZWRSZXM/LlZpZXc/Lk1ldGE/LlNlY3VyaXR5O1xuICAgICAgY29uc3QgbWV0YVNlY3VyaXRpZXMgPSBBcnJheS5pc0FycmF5KHJhd01ldGEpID8gcmF3TWV0YSA6IHJhd01ldGEgPyBbcmF3TWV0YV0gOiBbXTtcbiAgICAgIGNvbnN0IG5hbWVCeUlkID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4obWV0YVNlY3VyaXRpZXMubWFwKHMgPT4gW3NbJy1LZXknXSwgcy5IZWJOYW1lID8/ICcnXSkpO1xuXG4gICAgICBjb25zdCByYXdCYWxhbmNlcyA9IGFjY291bnQuQWNjb3VudFBvc2l0aW9uPy5CYWxhbmNlO1xuICAgICAgY29uc3QgYmFsYW5jZXMgPSBBcnJheS5pc0FycmF5KHJhd0JhbGFuY2VzKSA/IHJhd0JhbGFuY2VzIDogcmF3QmFsYW5jZXMgPyBbcmF3QmFsYW5jZXNdIDogW107XG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICAgICAgY29uc29sZS5sb2coYFtwc2Fnb3Qtc2NyYXBlcl0gYWNjb3VudCAke2FjY291bnRJZH06ICR7YmFsYW5jZXMubGVuZ3RofSBwb3NpdGlvbnNgKTtcblxuICAgICAgZm9yIChjb25zdCBiIG9mIGJhbGFuY2VzKSB7XG4gICAgICAgIGNvbnN0IHNlY0lkID0gc3RyVmFsKGJbJ0VxdWl0eU51bWJlciddKTtcbiAgICAgICAgY29uc3QgcXR5ID0gTnVtYmVyKGJbJ09ubGluZU5WJ10gPz8gMCk7XG4gICAgICAgIGlmIChxdHkgPT09IDApIGNvbnRpbnVlO1xuICAgICAgICAvLyBQcmljZXMgYXJlIGluIGFnb3JvdCAoMS8xMDAgSUxTKVxuICAgICAgICBjb25zdCBwcmljZSA9IE51bWJlcihiWydMYXN0UmF0ZSddID8/IDApIC8gMTAwO1xuICAgICAgICBjb25zdCBhdmdDb3N0ID0gTnVtYmVyKGJbJ0F2ZXJhZ2VQcmljZSddID8/IDApIC8gMTAwO1xuICAgICAgICBjb25zdCBwbmwgPSBOdW1iZXIoYlsnQXZlcmFnZVByaWNlUHJvZml0TG9zcyddID8/IDApO1xuICAgICAgICBjb25zdCBjdXJyZW5jeSA9IHN0clZhbChiWydDdXJyZW5jeUNvZGUnXSwgJ0lMUycpO1xuICAgICAgICBjb25zdCBuYW1lID0gbmFtZUJ5SWQuZ2V0KHNlY0lkKSB8fCBzZWNJZDtcblxuICAgICAgICBhbGxQb3NpdGlvbnMucHVzaCh7XG4gICAgICAgICAgaWRlbnRpZmllcjogYHBzYWdvdC0ke3NlY0lkfWAsXG4gICAgICAgICAgbmFtZTogYCR7bmFtZX0gKCR7YWNjb3VudElkfSlgLFxuICAgICAgICAgIHF1YW50aXR5OiBxdHksXG4gICAgICAgICAgcHJpY2UsXG4gICAgICAgICAgYXZnQ29zdCxcbiAgICAgICAgICB1bnJlYWxpemVkUG5sOiBwbmwsXG4gICAgICAgICAgY3VycmVuY3ksXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gICAgY29uc29sZS5sb2coYFtwc2Fnb3Qtc2NyYXBlcl0gZG9uZSDigJQgJHthbGxQb3NpdGlvbnMubGVuZ3RofSBwb3NpdGlvbnMsIGNhc2ggJHt0b3RhbENhc2hJbHN9IElMU2ApO1xuXG4gICAgY29uc3QgY2FzaDogUG9ydGZvbGlvQ2FzaFtdID0gdG90YWxDYXNoSWxzID4gMCA/IFt7IGN1cnJlbmN5OiAnSUxTJywgYW1vdW50OiB0b3RhbENhc2hJbHMgfV0gOiBbXTtcbiAgICByZXR1cm4geyBwb3NpdGlvbnM6IGFsbFBvc2l0aW9ucywgY2FzaCwgYXNPZkRhdGU6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkgfTtcbiAgfVxufVxuIl0sIm1hcHBpbmdzIjoiOzs7Ozs7QUFDQSxJQUFBQSxxQkFBQSxHQUFBQyxPQUFBO0FBR0EsTUFBTUMsUUFBUSxHQUFHLDZCQUE2QjtBQUM5QyxNQUFNQyxTQUFTLEdBQUcsNkJBQTZCO0FBQy9DLE1BQU1DLFVBQVUsR0FDZCxpSEFBaUg7QUFFbkgsTUFBTUMsR0FBRyxHQUFHO0VBQ1ZDLFFBQVEsRUFBRSx1Q0FBdUM7RUFDakRDLFFBQVEsRUFBRTtBQUNaLENBQVU7QUFFVixlQUFlQyxjQUFjQSxDQUFDQyxJQUFVLEVBQUVDLFFBQWdCLEVBQUVDLE9BQU8sR0FBRyxNQUFNLEVBQWlCO0VBQzNGLE1BQU1GLElBQUksQ0FBQ0csZUFBZSxDQUFFQyxHQUFXLElBQUtDLFFBQVEsQ0FBQ0MsYUFBYSxDQUFDRixHQUFHLENBQUMsS0FBSyxJQUFJLEVBQUU7SUFBRUY7RUFBUSxDQUFDLEVBQUVELFFBQVEsQ0FBQztBQUMxRztBQUVBLGVBQWVNLGtCQUFrQkEsQ0FBQ1AsSUFBVSxFQUFFUSxJQUFZLEVBQWlCO0VBQ3pFLE1BQU1SLElBQUksQ0FBQ1MsUUFBUSxDQUFFQyxDQUFTLElBQUs7SUFDakMsTUFBTUMsRUFBRSxHQUFHQyxLQUFLLENBQUNDLElBQUksQ0FBQ1IsUUFBUSxDQUFDUyxnQkFB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