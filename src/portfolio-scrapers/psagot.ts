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
  // waitForFunction avoids visibility checks that fail on Flutter's 1×1 px elements
  await page.waitForFunction((sel: string) => document.querySelector(sel) !== null, { timeout }, selector);
}

async function enableA11y(page: Page): Promise<void> {
  await waitForElement(page, 'flt-semantics-placeholder', 30_000);
  await page.evaluate(() => {
    const el = document.querySelector('flt-semantics-placeholder');
    if (el instanceof HTMLElement) el.click();
  });
}

async function flutterClick(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    if (el instanceof HTMLElement) el.click();
  }, selector);
}

async function flutterClickByText(page: Page, text: string): Promise<void> {
  await page.evaluate((t: string) => {
    const el = Array.from(document.querySelectorAll('flt-semantics[role="button"]')).find(
      node => node.textContent?.trim() === t,
    ) as HTMLElement | null;
    if (el) el.click();
  }, text);
}

// Extracts positions and cash from the currently active account.
// DOM patterns (Flutter a11y mode):
//   Position name + qty:  flt-semantics[role="img"][aria-label^="Position:"]
//     label = "Position: \nCompany logo\n{name}\nQuantity\n {qty} "
//   Financial data: leaf flt-semantics (no flt-semantics children), in row order:
//     "Last rate: \n{price}Agorot\n{+/-}%"   (price in Agorot → divide by 100 for ILS)
//     "Daily profit loss: \n {amount} Israeli Shekel"
//     "Total Profit Loss: \n {amount} Israeli Shekel\n{Plus|Minus} {pct}%"
//     "Total value: \n {amount} Israeli Shekel"
//     "Actions menu"
//   Cash: flt-semantics[role="img"][aria-label^="ILS\n"]
async function extractAccountData(page: Page): Promise<{
  accountId: string;
  positions: PortfolioPosition[];
  cash: PortfolioCash[];
}> {
  await page.waitForFunction(() => document.querySelectorAll('flt-semantics[role="img"]').length > 0, {
    timeout: 60_000,
  });

  return page.evaluate(() => {
    // Current account ID from the profile menu button text ("Profile menu\n150-259840")
    const profileBtn = Array.from(document.querySelectorAll('flt-semantics[role="button"]')).find(el =>
      el.textContent?.includes('Profile menu'),
    );
    const accountId =
      profileBtn?.textContent
        ?.split('\n')
        .find(s => /^\d{3}-\d+$/.test(s.trim()))
        ?.trim() ?? '';

    // Position name + quantity from aria-label on role="img" elements
    const posImgs = Array.from(document.querySelectorAll<Element>('flt-semantics[role="img"]')).filter(el =>
      el.getAttribute('aria-label')?.startsWith('Position:'),
    );

    const positionInfos = posImgs.map(el => {
      const label = el.getAttribute('aria-label') ?? '';
      // "Position: \nCompany logo\nISH.FRF SP 500\nQuantity\n 6 "
      const nameMatch = label.match(/Company logo\n(.+?)\nQuantity/s);
      const qtyMatch = label.match(/Quantity\n\s*([\d.,]+)/);
      return {
        name: nameMatch?.[1]?.trim() ?? '',
        quantity: parseFloat((qtyMatch?.[1] ?? '0').replace(/,/g, '')),
      };
    });

    // Financial data rows from leaf nodes (nodes with no flt-semantics children)
    const leaves = Array.from(document.querySelectorAll('flt-semantics'))
      .filter(el => !el.querySelector('flt-semantics') && el.textContent?.trim())
      .map(el => el.textContent?.trim() ?? '');

    const financialRows: Array<{ priceAgorot: number; totalPnl: number; totalValue: number }> = [];

    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i];
      if (!leaf?.startsWith('Last rate: ')) continue;

      // Price in Agorot (100 Agorot = 1 ILS)
      const priceMatch = leaf.match(/([\d.]+)Agorot/);
      const priceAgorot = parseFloat(priceMatch?.[1] ?? '0');

      i++; // skip "Daily profit loss: ..."
      i++; // move to "Total Profit Loss: ..."

      const pnlLeaf = leaves[i] ?? '';
      const pnlSign = pnlLeaf.includes('Minus') ? -1 : 1;
      const pnlMatch = pnlLeaf.match(/([\d.,]+) Israeli Shekel/);
      const totalPnl = pnlSign * parseFloat((pnlMatch?.[1] ?? '0').replace(/,/g, ''));

      i++; // move to "Total value: ..."

      const valueLeaf = leaves[i] ?? '';
      const valueMatch = valueLeaf.match(/([\d.,]+) Israeli Shekel/);
      const totalValue = parseFloat((valueMatch?.[1] ?? '0').replace(/,/g, ''));

      financialRows.push({ priceAgorot, totalPnl, totalValue });
    }

    // Cash balance from ILS img label ("ILS\n 818 Israeli Shekel")
    const cashImg = Array.from(document.querySelectorAll('flt-semantics[role="img"]')).find(el =>
      el.getAttribute('aria-label')?.startsWith('ILS\n'),
    );
    const cashLabel = cashImg?.getAttribute('aria-label') ?? '';
    const cashMatch = cashLabel.match(/([\d.,]+) Israeli Shekel/);
    const cashIls = parseFloat((cashMatch?.[1] ?? '0').replace(/,/g, ''));

    const positions: PortfolioPosition[] = positionInfos.map((pos, idx) => {
      const fin = financialRows[idx] ?? { priceAgorot: 0, totalPnl: 0, totalValue: 0 };
      const priceIls = fin.priceAgorot / 100;
      const avgCostIls = pos.quantity > 0 ? (fin.totalValue - fin.totalPnl) / pos.quantity : 0;
      return {
        identifier: `psagot-${accountId}-${pos.name.replace(/[^A-Za-z0-9]/g, '_')}`,
        name: `${pos.name} (${accountId})`,
        quantity: pos.quantity,
        price: priceIls,
        avgCost: avgCostIls,
        unrealizedPnl: fin.totalPnl,
        currency: 'ILS',
      };
    });

    const cash: PortfolioCash[] = cashIls > 0 ? [{ currency: 'ILS', amount: cashIls }] : [];

    return { accountId, positions, cash };
  });
}

// Dismisses the "Welcome to the New Psagot Trade" onboarding overlay if present.
// Waits for the page to settle into either the welcome dialog or the portfolio view before deciding.
async function dismissWelcomeDialogIfPresent(page: Page): Promise<void> {
  // Wait until Flutter renders either the welcome dialog OR the profile menu button
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('flt-semantics')).some(
        el => el.textContent?.includes('Welcome to the New Psagot Trade') || el.textContent?.includes('Profile menu'),
      ),
    { timeout: 30_000 },
  );

  const hasDialog = await page.evaluate(() =>
    Array.from(document.querySelectorAll('flt-semantics')).some(el =>
      el.textContent?.includes('Welcome to the New Psagot Trade'),
    ),
  );
  if (!hasDialog) return;

  // eslint-disable-next-line no-console
  console.log('[psagot-scraper] welcome dialog detected — stepping through');

  // The wizard has multiple slides. Prefer Skip/Close (exits wizard) over Next (advances slide).
  // After clicking Skip, verify by checking Skip is absent — the portfolio page has Next but not Skip.
  const SKIP_LABELS = ['Skip', 'Close', 'Done', 'סגור', 'דלג'];

  for (let attempt = 0; attempt < 12; attempt++) {
    const result = await page.evaluate((skipLabels: string[]) => {
      const buttons = Array.from(document.querySelectorAll('flt-semantics[role="button"]'));

      // Prefer Skip/Close/Done — these exit the wizard entirely
      const skipBtn = buttons.find(el => skipLabels.includes(el.textContent?.trim() ?? '')) as HTMLElement | null;
      if (skipBtn) {
        // eslint-disable-next-line no-console
        console.log('[psagot-scraper] clicking wizard dismiss button:', skipBtn.textContent?.trim());
        skipBtn.click();
        return 'skip';
      }

      // Fall back to Next — advances to the next wizard slide
      const nextBtn = buttons.find(el => el.textContent?.trim() === 'Next') as HTMLElement | null;
      if (nextBtn) {
        // eslint-disable-next-line no-console
        console.log('[psagot-scraper] clicking wizard next button');
        nextBtn.click();
        return 'next';
      }

      return null;
    }, SKIP_LABELS);

    if (result === null) break;

    await new Promise(r => setTimeout(r, 1_500));

    if (result === 'skip') {
      // Verify wizard is closed: portfolio page has Next but not Skip
      const wizardGone = await page.evaluate((skipLabels: string[]) => {
        const buttons = Array.from(document.querySelectorAll('flt-semantics[role="button"]'));
        return !buttons.some(el => skipLabels.includes(el.textContent?.trim() ?? ''));
      }, SKIP_LABELS);
      if (wizardGone) break;
    }
  }

  // eslint-disable-next-line no-console
  console.log('[psagot-scraper] welcome dialog dismissed');
}

// Opens the account switcher dropdown and returns all account IDs.
async function getAllAccountIds(page: Page): Promise<string[]> {
  // Wait for Flutter a11y tree to be ready on the portfolio page before clicking
  await waitForElement(page, 'flt-semantics[role="button"]', 30_000);

  const buttonTexts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('flt-semantics[role="button"]')).map(el => el.textContent?.trim()),
  );
  // eslint-disable-next-line no-console
  console.log('[psagot-scraper] buttons visible on portfolio page:', JSON.stringify(buttonTexts));

  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('flt-semantics[role="button"]')).find(el =>
      el.textContent?.includes('Profile menu'),
    ) as HTMLElement | null;
    // eslint-disable-next-line no-console
    console.log('[psagot-scraper] profile menu btn found:', btn !== null);
    if (btn) btn.click();
  });

  // eslint-disable-next-line no-console
  console.log('[psagot-scraper] waiting for account IDs in dropdown...');
  await page
    .waitForFunction(
      () => Array.from(document.querySelectorAll('flt-semantics')).some(el => /\d{3}-\d{6}/.test(el.textContent ?? '')),
      { timeout: 10_000 },
    )
    .catch(async err => {
      const allText = await page.evaluate(() =>
        Array.from(document.querySelectorAll('flt-semantics'))
          .map(el => el.textContent?.trim())
          .filter(Boolean)
          .slice(0, 50),
      );
      // eslint-disable-next-line no-console
      console.log('[psagot-scraper] flt-semantics text samples (first 50):', JSON.stringify(allText));
      throw err;
    });

  const ids = await page.evaluate(() =>
    Array.from(document.querySelectorAll('flt-semantics'))
      .map(el => el.textContent?.match(/(\d{3}-\d{6})/)?.[1])
      .filter((t): t is string => !!t),
  );

  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 500));

  return [...new Set(ids)];
}

// Switches the active account to targetAccountId via the Flutter account dropdown.
async function switchAccount(page: Page, targetAccountId: string): Promise<void> {
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('flt-semantics[role="button"]')).find(el =>
      el.textContent?.includes('Profile menu'),
    ) as HTMLElement | null;
    btn?.click();
  });

  await page.waitForFunction(
    (id: string) => Array.from(document.querySelectorAll('flt-semantics')).some(el => el.textContent?.includes(id)),
    { timeout: 10_000 },
    targetAccountId,
  );

  await page.evaluate((id: string) => {
    // Prefer role="button" elements (actual clickable items in the dropdown).
    // Fall back to the deepest flt-semantics element containing the id (last in DOM order = deepest).
    const buttons = Array.from(document.querySelectorAll('flt-semantics[role="button"]'));
    const btn = buttons.find(el => el.textContent?.includes(id)) as HTMLElement | null;
    if (btn) {
      // eslint-disable-next-line no-console
      console.log('[psagot-scraper] switching account via button:', btn.textContent?.trim().slice(0, 80));
      btn.click();
      return;
    }
    const all = Array.from(document.querySelectorAll('flt-semantics')).filter(el =>
      (el.textContent ?? '').includes(id),
    );
    const el = all[all.length - 1] as HTMLElement | null;
    // eslint-disable-next-line no-console
    console.log('[psagot-scraper] switching account via fallback element:', el?.textContent?.trim().slice(0, 80));
    el?.click();
  }, targetAccountId);

  // Wait for the profile menu button to reflect the new account
  await page.waitForFunction(
    (id: string) => {
      const btn = Array.from(document.querySelectorAll('flt-semantics[role="button"]')).find(el =>
        el.textContent?.includes('Profile menu'),
      );
      return btn?.textContent?.includes(id) === true;
    },
    { timeout: 30_000 },
    targetAccountId,
  );

  // Give Flutter time to re-render the portfolio after the account switch
  await new Promise(r => setTimeout(r, 3_000));
}

export class PsagotScraper extends BasePortfolioScraper {
  protected async fetchPortfolio(
    page: Page,
    credentials: Record<string, unknown>,
  ): Promise<{ positions: PortfolioPosition[]; cash: PortfolioCash[]; asOfDate: string }> {
    const username = typeof credentials['username'] === 'string' ? credentials['username'] : '';
    const password = typeof credentials['password'] === 'string' ? credentials['password'] : '';
    const otpCodeRetriever = credentials['otpCodeRetriever'] as (() => Promise<string>) | undefined;

    // 1. Navigate and wait for Flutter WASM to boot
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    );
    await page.goto(LOGIN_URL, { waitUntil: 'load', timeout: 120_000 });
    await waitForElement(page, 'flt-glass-pane', 120_000);
    // eslint-disable-next-line no-console
    console.log('[psagot-scraper] Flutter initialized');

    // 2. Enable Flutter accessibility and fill credentials
    await enableA11y(page);
    await waitForElement(page, SEL.username, 30_000);
    await page.type(SEL.username, username);
    await page.type(SEL.password, password);

    // 3. Check terms checkbox (required before Login button enables)
    await flutterClick(page, SEL.termsCheckbox);
    await page.waitForFunction(
      () => document.querySelector('flt-semantics[role="checkbox"]')?.getAttribute('aria-checked') === 'true',
      { timeout: 10_000 },
    );

    // 4. Wait for Login button to enable, then click
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

    // 5. Wait for login form to disappear
    await page.waitForFunction(() => !document.querySelector('input[aria-label="Username required"]'), {
      timeout: 60_000,
    });

    // 6. Handle OTP challenge
    await page.waitForFunction(() => document.querySelectorAll('input').length > 0, { timeout: 60_000 });

    if (otpCodeRetriever) {
      const pageState = await page.evaluate(() => ({
        inputs: Array.from(document.querySelectorAll('input')).map(el => el.getAttribute('aria-label')),
      }));
      const otpAriaLabel = pageState.inputs[0] ?? '';
      if (otpAriaLabel) {
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

    // 7. Wait for navigation away from login
    await page.waitForFunction(() => !location.href.includes('/login') && !location.href.endsWith('/'), {
      timeout: 60_000,
    });
    // eslint-disable-next-line no-console
    console.log('[psagot-scraper] navigated to:', await page.evaluate(() => location.href));

    // 8. Dismiss onboarding overlay if shown, then collect accounts.
    await dismissWelcomeDialogIfPresent(page);
    const accountIds = await getAllAccountIds(page);
    // eslint-disable-next-line no-console
    console.log('[psagot-scraper] accounts found:', accountIds);

    const firstData = await extractAccountData(page);
    // eslint-disable-next-line no-console
    console.log(`[psagot-scraper] account ${firstData.accountId}: ${firstData.positions.length} positions`);
    const allData = [firstData];

    for (const accountId of accountIds) {
      if (accountId === firstData.accountId) continue;
      await switchAccount(page, accountId);
      const data = await extractAccountData(page);
      // eslint-disable-next-line no-console
      console.log(`[psagot-scraper] account ${data.accountId}: ${data.positions.length} positions`);
      allData.push(data);
    }

    // 9. Combine positions and cash across all accounts
    const positions: PortfolioPosition[] = allData.flatMap(d => d.positions);
    const totalIlsCash = allData.flatMap(d => d.cash).reduce((sum, c) => sum + c.amount, 0);
    const cash: PortfolioCash[] = totalIlsCash > 0 ? [{ currency: 'ILS', amount: totalIlsCash }] : [];

    const asOfDate = new Date().toISOString().slice(0, 10);
    return { positions, cash, asOfDate };
  }
}
