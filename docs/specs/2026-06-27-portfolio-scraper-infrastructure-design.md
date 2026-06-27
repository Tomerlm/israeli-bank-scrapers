# Portfolio Scraper Infrastructure — Design Spec

**Date:** 2026-06-27
**Scope:** `israeli-bank-scrapers` fork only. findash integration is tracked in `docs/observations.md`.

---

## Goal

Add a generic portfolio scraping capability to the library — a new scraper entity parallel to the existing transaction scraper. Portfolio scrapers return positions and cash holdings, not transactions. Psagot will be the first implementation, but the infrastructure must not encode any Psagot-specific assumptions.

---

## New files

```
src/
  portfolio-definitions.ts
  portfolio-scrapers/
    interface.ts
    base-portfolio-scraper.ts
    factory.ts
```

---

## `portfolio-definitions.ts`

```ts
export enum PortfolioCompanyTypes {
  psagot = 'psagot',
}

export const PORTFOLIO_SCRAPERS: Record<PortfolioCompanyTypes, { name: string; loginFields: string[] }> = {
  [PortfolioCompanyTypes.psagot]: {
    name: 'Psagot',
    loginFields: ['username', 'password'],
  },
}
```

`PORTFOLIO_SCRAPERS` is the metadata registry (analogous to `SCRAPERS`) — name and expected credential field names. Consumers use this for display and credential validation without importing individual scraper classes.

---

## `portfolio-scrapers/interface.ts`

```ts
export type PortfolioPosition = {
  identifier: string   // ISIN preferred; provider-specific ID if ISIN unavailable
  name: string
  quantity: number
  price: number
  currency: string
  avgCost?: number
  unrealizedPnl?: number
}

export type PortfolioCash = {
  currency: string
  amount: number
}

export type PortfolioScrapingResult =
  | { success: true; positions: PortfolioPosition[]; cash: PortfolioCash[]; asOfDate: string }
  | { success: false; errorType: string; errorMessage: string }

export interface PortfolioScraper {
  scrape(credentials: Record<string, string>): Promise<PortfolioScrapingResult>
}
```

`avgCost` and `unrealizedPnl` are optional because not all providers expose cost basis. `asOfDate` is ISO date (`YYYY-MM-DD`). `identifier` should be ISIN when available — it is the most portable key across providers and consumers.

---

## `portfolio-scrapers/base-portfolio-scraper.ts`

Abstract class handling the Puppeteer lifecycle. Concrete scrapers extend it and implement one method.

```ts
export type BasePortfolioScraperOptions = {
  args?: string[]
  timeout?: number
  showBrowser?: boolean
}

abstract class BasePortfolioScraper implements PortfolioScraper {
  constructor(protected options: BasePortfolioScraperOptions) {}

  async scrape(credentials: Record<string, string>): Promise<PortfolioScrapingResult> {
    // 1. Launch browser with this.options.args / showBrowser
    // 2. Open a new page, set default timeout
    // 3. Call this.fetchPortfolio(page, credentials)
    // 4. Close browser
    // 5. Return { success: true, ...result }
    // Catches any thrown error → { success: false, errorType: 'UNKNOWN', errorMessage }
  }

  protected abstract fetchPortfolio(
    page: Page,
    credentials: Record<string, string>,
  ): Promise<{ positions: PortfolioPosition[]; cash: PortfolioCash[]; asOfDate: string }>
}
```

The base class does not validate `credentials` — that is the concrete scraper's responsibility inside `fetchPortfolio`, keeping the base class provider-agnostic.

---

## `portfolio-scrapers/factory.ts`

```ts
export type PortfolioScraperOptions = BasePortfolioScraperOptions & {
  companyId: PortfolioCompanyTypes
}

export function createPortfolioScraper(options: PortfolioScraperOptions): PortfolioScraper {
  switch (options.companyId) {
    case PortfolioCompanyTypes.psagot:
      return new PsagotScraper(options)
    default:
      throw new Error(`Unknown portfolio company: ${options.companyId}`)
  }
}
```

---

## `index.ts` exports (additions)

```ts
export { PortfolioCompanyTypes, PORTFOLIO_SCRAPERS } from './portfolio-definitions'
export { createPortfolioScraper } from './portfolio-scrapers/factory'
export type { PortfolioScraper, PortfolioScrapingResult, PortfolioPosition, PortfolioCash } from './portfolio-scrapers/interface'
```

---

## What is NOT in scope

- Psagot scraper implementation (`fetchPortfolio` logic, login, DOM parsing)
- findash integration (tracked in `docs/observations.md`)
- Non-browser portfolio scrapers (API-based providers can extend `PortfolioScraper` directly without going through `BasePortfolioScraper`)
