# Portfolio Scraper Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generic portfolio scraping capability to the `israeli-bank-scrapers` fork — a new scraper entity parallel to the existing transaction scraper, returning positions and cash holdings.

**Architecture:** Three new source files (`portfolio-definitions.ts`, `portfolio-scrapers/interface.ts`, `portfolio-scrapers/base-portfolio-scraper.ts`) define the generic types and Puppeteer lifecycle base class. A factory (`portfolio-scrapers/factory.ts`) dispatches by `PortfolioCompanyTypes`, with a stub `PsagotScraper` as the first registered provider. All new exports are surfaced from `src/index.ts`.

**Tech Stack:** TypeScript 4.7.4, Puppeteer 24, Jest 29 with ts-jest.

## Global Constraints

- TypeScript strict mode with `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch` — all must pass `npm run type-check`
- Test runner: `npm test` (Jest with ts-jest, `rootDir: ./src`)
- No new npm dependencies
- Module format: CommonJS (`"module": "commonjs"`)
- Do NOT use `satisfies` keyword — TypeScript 4.7 does not support it
- All new code lives in `src/`

---

### Task 1: Types and definitions

**Files:**
- Create: `src/portfolio-definitions.ts`
- Create: `src/portfolio-scrapers/interface.ts`
- Create: `src/portfolio-scrapers/definitions.test.ts`

**Interfaces:**
- Produces:
  - `PortfolioCompanyTypes` enum with value `psagot = 'psagot'`
  - `PORTFOLIO_SCRAPERS` registry object mapping each `PortfolioCompanyTypes` to `{ name: string; loginFields: string[] }`
  - `PortfolioPosition` type
  - `PortfolioCash` type
  - `PortfolioScrapingResult` discriminated union
  - `PortfolioScraper` interface

- [ ] **Step 1: Write the failing test**

Create `src/portfolio-scrapers/definitions.test.ts`:

```ts
import { PortfolioCompanyTypes, PORTFOLIO_SCRAPERS } from '../portfolio-definitions';

describe('portfolio-definitions', () => {
  test('PortfolioCompanyTypes.psagot equals the string "psagot"', () => {
    expect(PortfolioCompanyTypes.psagot).toBe('psagot');
  });

  test('PORTFOLIO_SCRAPERS has an entry for every PortfolioCompanyTypes value', () => {
    const allTypes = Object.values(PortfolioCompanyTypes);
    for (const type of allTypes) {
      expect(PORTFOLIO_SCRAPERS[type]).toBeDefined();
      expect(typeof PORTFOLIO_SCRAPERS[type].name).toBe('string');
      expect(Array.isArray(PORTFOLIO_SCRAPERS[type].loginFields)).toBe(true);
    }
  });

  test('psagot entry has the expected loginFields', () => {
    expect(PORTFOLIO_SCRAPERS[PortfolioCompanyTypes.psagot].loginFields).toEqual(['username', 'password']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/tomerlm/repos/israeli-bank-scrapers
npm test -- --testPathPattern=portfolio-scrapers/definitions
```

Expected: FAIL — `Cannot find module '../portfolio-definitions'`

- [ ] **Step 3: Create `src/portfolio-definitions.ts`**

```ts
export enum PortfolioCompanyTypes {
  psagot = 'psagot',
}

export const PORTFOLIO_SCRAPERS: Record<PortfolioCompanyTypes, { name: string; loginFields: string[] }> = {
  [PortfolioCompanyTypes.psagot]: {
    name: 'Psagot',
    loginFields: ['username', 'password'],
  },
};
```

- [ ] **Step 4: Create `src/portfolio-scrapers/interface.ts`**

```ts
export type PortfolioPosition = {
  identifier: string;
  name: string;
  quantity: number;
  price: number;
  currency: string;
  avgCost?: number;
  unrealizedPnl?: number;
};

export type PortfolioCash = {
  currency: string;
  amount: number;
};

export type PortfolioScrapingResult =
  | { success: true; positions: PortfolioPosition[]; cash: PortfolioCash[]; asOfDate: string }
  | { success: false; errorType: string; errorMessage: string };

export interface PortfolioScraper {
  scrape(credentials: Record<string, string>): Promise<PortfolioScrapingResult>;
}
```

- [ ] **Step 5: Run test and type-check to verify they pass**

```bash
cd /home/tomerlm/repos/israeli-bank-scrapers
npm test -- --testPathPattern=portfolio-scrapers/definitions
npm run type-check
```

Expected: PASS (1 test suite, 3 tests), type-check exits 0.

- [ ] **Step 6: Commit**

```bash
cd /home/tomerlm/repos/israeli-bank-scrapers
git add src/portfolio-definitions.ts src/portfolio-scrapers/interface.ts src/portfolio-scrapers/definitions.test.ts
git commit -m "feat: add PortfolioCompanyTypes, PORTFOLIO_SCRAPERS, and core portfolio types"
```

---

### Task 2: Base portfolio scraper

**Files:**
- Create: `src/portfolio-scrapers/base-portfolio-scraper.ts`
- Create: `src/portfolio-scrapers/base-portfolio-scraper.test.ts`

**Interfaces:**
- Consumes (from Task 1):
  - `PortfolioPosition`, `PortfolioCash`, `PortfolioScrapingResult`, `PortfolioScraper` from `./interface`
- Produces:
  - `BasePortfolioScraperOptions` type: `{ args?: string[]; timeout?: number; showBrowser?: boolean }`
  - `BasePortfolioScraper` abstract class implementing `PortfolioScraper`:
    - `constructor(options: BasePortfolioScraperOptions)`
    - `async scrape(credentials: Record<string, string>): Promise<PortfolioScrapingResult>`
    - `protected abstract fetchPortfolio(page: Page, credentials: Record<string, string>): Promise<{ positions: PortfolioPosition[]; cash: PortfolioCash[]; asOfDate: string }>`

- [ ] **Step 1: Write the failing tests**

Create `src/portfolio-scrapers/base-portfolio-scraper.test.ts`:

```ts
import puppeteer, { type Page } from 'puppeteer';
import { BasePortfolioScraper } from './base-portfolio-scraper';
import type { PortfolioCash, PortfolioPosition } from './interface';

jest.mock('puppeteer');

type FetchResult = { positions: PortfolioPosition[]; cash: PortfolioCash[]; asOfDate: string };

const mockPage: Partial<Page> = { setDefaultTimeout: jest.fn() };
const mockBrowser = {
  newPage: jest.fn(),
  close: jest.fn(),
};

beforeEach(() => {
  mockBrowser.newPage.mockResolvedValue(mockPage);
  mockBrowser.close.mockResolvedValue(undefined);
  (puppeteer.launch as jest.MockedFunction<typeof puppeteer.launch>).mockResolvedValue(
    mockBrowser as unknown as Awaited<ReturnType<typeof puppeteer.launch>>,
  );
});

class SuccessStub extends BasePortfolioScraper {
  constructor(private result: FetchResult) {
    super({});
  }

  protected async fetchPortfolio(
    _page: Page,
    _credentials: Record<string, string>,
  ): Promise<FetchResult> {
    return this.result;
  }
}

class ThrowingStub extends BasePortfolioScraper {
  constructor(private message: string) {
    super({});
  }

  protected async fetchPortfolio(
    _page: Page,
    _credentials: Record<string, string>,
  ): Promise<FetchResult> {
    throw new Error(this.message);
  }
}

describe('BasePortfolioScraper', () => {
  test('returns success result when fetchPortfolio resolves', async () => {
    const positions: PortfolioPosition[] = [
      { identifier: 'IL0011320343', name: 'Test Security', quantity: 10, price: 100, currency: 'ILS' },
    ];
    const cash: PortfolioCash[] = [{ currency: 'ILS', amount: 500 }];
    const asOfDate = '2026-06-27';

    const scraper = new SuccessStub({ positions, cash, asOfDate });
    const result = await scraper.scrape({ username: 'user', password: 'pass' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.positions).toEqual(positions);
      expect(result.cash).toEqual(cash);
      expect(result.asOfDate).toBe(asOfDate);
    }
  });

  test('returns failure result when fetchPortfolio throws', async () => {
    const scraper = new ThrowingStub('login failed');
    const result = await scraper.scrape({ username: 'user', password: 'pass' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorType).toBe('UNKNOWN');
      expect(result.errorMessage).toBe('login failed');
    }
  });

  test('closes browser even when fetchPortfolio throws', async () => {
    const scraper = new ThrowingStub('crash');
    await scraper.scrape({});

    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  test('passes args and timeout options to puppeteer', async () => {
    const scraper = new SuccessStub({
      positions: [],
      cash: [],
      asOfDate: '2026-06-27',
    });
    await scraper.scrape({});

    expect(puppeteer.launch).toHaveBeenCalledWith(
      expect.objectContaining({ headless: true }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/tomerlm/repos/israeli-bank-scrapers
npm test -- --testPathPattern=portfolio-scrapers/base-portfolio-scraper
```

Expected: FAIL — `Cannot find module './base-portfolio-scraper'`

- [ ] **Step 3: Create `src/portfolio-scrapers/base-portfolio-scraper.ts`**

```ts
import puppeteer, { type Page } from 'puppeteer';
import type { PortfolioCash, PortfolioPosition, PortfolioScraper, PortfolioScrapingResult } from './interface';

export type BasePortfolioScraperOptions = {
  args?: string[];
  timeout?: number;
  showBrowser?: boolean;
};

export abstract class BasePortfolioScraper implements PortfolioScraper {
  constructor(protected options: BasePortfolioScraperOptions) {}

  async scrape(credentials: Record<string, string>): Promise<PortfolioScrapingResult> {
    const browser = await puppeteer.launch({
      headless: !this.options.showBrowser,
      args: this.options.args,
    });
    try {
      const page = await browser.newPage();
      if (this.options.timeout !== undefined) {
        page.setDefaultTimeout(this.options.timeout);
      }
      const result = await this.fetchPortfolio(page, credentials);
      return { success: true, ...result };
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      return { success: false, errorType: 'UNKNOWN', errorMessage };
    } finally {
      try {
        await browser.close();
      } catch {
        // ignore close errors
      }
    }
  }

  protected abstract fetchPortfolio(
    page: Page,
    credentials: Record<string, string>,
  ): Promise<{ positions: PortfolioPosition[]; cash: PortfolioCash[]; asOfDate: string }>;
}
```

- [ ] **Step 4: Run tests and type-check**

```bash
cd /home/tomerlm/repos/israeli-bank-scrapers
npm test -- --testPathPattern=portfolio-scrapers/base-portfolio-scraper
npm run type-check
```

Expected: PASS (1 suite, 4 tests), type-check exits 0.

- [ ] **Step 5: Commit**

```bash
cd /home/tomerlm/repos/israeli-bank-scrapers
git add src/portfolio-scrapers/base-portfolio-scraper.ts src/portfolio-scrapers/base-portfolio-scraper.test.ts
git commit -m "feat: add BasePortfolioScraper with Puppeteer lifecycle and error wrapping"
```

---

### Task 3: Psagot stub, factory, and index exports

**Files:**
- Create: `src/portfolio-scrapers/psagot.ts`
- Create: `src/portfolio-scrapers/factory.ts`
- Create: `src/portfolio-scrapers/factory.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes (from Task 1): `PortfolioCompanyTypes` from `../portfolio-definitions`
- Consumes (from Task 2): `BasePortfolioScraper`, `BasePortfolioScraperOptions` from `./base-portfolio-scraper`
- Consumes (from Task 1): `PortfolioScraper` from `./interface`
- Produces:
  - `PsagotScraper` class (stub — `fetchPortfolio` throws `Error('Not implemented')`)
  - `PortfolioScraperOptions` type: `BasePortfolioScraperOptions & { companyId: PortfolioCompanyTypes }`
  - `createPortfolioScraper(options: PortfolioScraperOptions): PortfolioScraper` function
  - All new types and functions re-exported from `src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `src/portfolio-scrapers/factory.test.ts`:

```ts
import { PortfolioCompanyTypes } from '../portfolio-definitions';
import { createPortfolioScraper } from './factory';

describe('createPortfolioScraper', () => {
  test('returns a PortfolioScraper with a scrape method for psagot', () => {
    const scraper = createPortfolioScraper({ companyId: PortfolioCompanyTypes.psagot });
    expect(scraper).toBeDefined();
    expect(typeof scraper.scrape).toBe('function');
  });

  test('throws for an unrecognised companyId', () => {
    expect(() =>
      createPortfolioScraper({ companyId: 'unknown' as PortfolioCompanyTypes }),
    ).toThrow('Unknown portfolio company: unknown');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/tomerlm/repos/israeli-bank-scrapers
npm test -- --testPathPattern=portfolio-scrapers/factory
```

Expected: FAIL — `Cannot find module './factory'`

- [ ] **Step 3: Create `src/portfolio-scrapers/psagot.ts`**

```ts
import { type Page } from 'puppeteer';
import { BasePortfolioScraper } from './base-portfolio-scraper';
import type { PortfolioCash, PortfolioPosition } from './interface';

export class PsagotScraper extends BasePortfolioScraper {
  protected async fetchPortfolio(
    _page: Page,
    _credentials: Record<string, string>,
  ): Promise<{ positions: PortfolioPosition[]; cash: PortfolioCash[]; asOfDate: string }> {
    throw new Error('Not implemented');
  }
}
```

- [ ] **Step 4: Create `src/portfolio-scrapers/factory.ts`**

```ts
import { PortfolioCompanyTypes } from '../portfolio-definitions';
import { type BasePortfolioScraperOptions } from './base-portfolio-scraper';
import type { PortfolioScraper } from './interface';
import { PsagotScraper } from './psagot';

export type PortfolioScraperOptions = BasePortfolioScraperOptions & {
  companyId: PortfolioCompanyTypes;
};

export function createPortfolioScraper(options: PortfolioScraperOptions): PortfolioScraper {
  switch (options.companyId) {
    case PortfolioCompanyTypes.psagot:
      return new PsagotScraper(options);
    default: {
      const exhausted: never = options.companyId;
      throw new Error(`Unknown portfolio company: ${exhausted}`);
    }
  }
}
```

- [ ] **Step 5: Add new exports to `src/index.ts`**

Append to the existing `src/index.ts` (keep all existing exports untouched):

```ts
export { PortfolioCompanyTypes, PORTFOLIO_SCRAPERS } from './portfolio-definitions';
export { createPortfolioScraper } from './portfolio-scrapers/factory';
export type {
  PortfolioScraper,
  PortfolioScrapingResult,
  PortfolioPosition,
  PortfolioCash,
} from './portfolio-scrapers/interface';
export type { BasePortfolioScraperOptions, } from './portfolio-scrapers/base-portfolio-scraper';
export type { PortfolioScraperOptions } from './portfolio-scrapers/factory';
```

- [ ] **Step 6: Run all tests and type-check**

```bash
cd /home/tomerlm/repos/israeli-bank-scrapers
npm test
npm run type-check
```

Expected: all existing tests still pass, factory suite passes (2 tests), type-check exits 0.

- [ ] **Step 7: Commit**

```bash
cd /home/tomerlm/repos/israeli-bank-scrapers
git add src/portfolio-scrapers/psagot.ts src/portfolio-scrapers/factory.ts src/portfolio-scrapers/factory.test.ts src/index.ts
git commit -m "feat: add createPortfolioScraper factory and wire portfolio exports to index"
```
