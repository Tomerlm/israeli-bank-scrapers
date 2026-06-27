# Portfolio Scraper — Handoff

## What exists

The fork has a complete generic portfolio scraping infrastructure. All files are in `src/`:

| File | Purpose |
|------|---------|
| `portfolio-definitions.ts` | `PortfolioCompanyTypes` enum, `PORTFOLIO_SCRAPERS` registry |
| `portfolio-scrapers/interface.ts` | `PortfolioPosition`, `PortfolioCash`, `PortfolioScrapingResult`, `PortfolioScraper` |
| `portfolio-scrapers/base-portfolio-scraper.ts` | Abstract base — Puppeteer lifecycle, error wrapping |
| `portfolio-scrapers/psagot.ts` | `PsagotScraper` stub — extends base, `fetchPortfolio` throws "Not implemented" |
| `portfolio-scrapers/factory.ts` | `createPortfolioScraper({ companyId, ...opts })` |

All exported from `src/index.ts`.

## Next step 1 — Implement PsagotScraper (in the fork)

Open `src/portfolio-scrapers/psagot.ts`. Replace `fetchPortfolio` with real logic:

```ts
protected async fetchPortfolio(
  page: Page,
  credentials: Record<string, string>,
): Promise<{ positions: PortfolioPosition[]; cash: PortfolioCash[]; asOfDate: string }> {
  // 1. navigate to Psagot login, fill credentials, submit
  // 2. navigate to portfolio/holdings page
  // 3. scrape positions → PortfolioPosition[]
  //    identifier: ISIN if available, otherwise provider-specific ID
  // 4. scrape cash balances → PortfolioCash[]
  // 5. return { positions, cash, asOfDate: today's ISO date }
}
```

To add a second broker later: create `src/portfolio-scrapers/<broker>.ts` extending `BasePortfolioScraper`, add its value to `PortfolioCompanyTypes` in `portfolio-definitions.ts`, add a case to the factory switch, add metadata to `PORTFOLIO_SCRAPERS`.

## Next step 2 — Wire findash (in apps/be)

The DB schema (`portfolioSource`, `positionSnapshot`, `cashHolding`) and `ingestPositions` query are already fully ready. Only the HTTP layer needs updating.

### 2a. New file: `apps/be/src/scrapers/portfolioConfig.ts`

```ts
import { PortfolioCompanyTypes } from 'israeli-bank-scrapers'
import { z } from 'zod'

export const PORTFOLIO_PROVIDER_TYPES = {
  psagot: {
    companyId: PortfolioCompanyTypes.psagot,
    credentialsSchema: z.object({ username: z.string(), password: z.string() }),
  },
} as const

export type PortfolioProviderTypeKey = keyof typeof PORTFOLIO_PROVIDER_TYPES

export function isPortfolioProviderTypeKey(type: string): type is PortfolioProviderTypeKey {
  return type in PORTFOLIO_PROVIDER_TYPES
}
```

### 2b. Update `apps/be/src/routes/providers.ts`

`validateCredentials` currently only checks `PROVIDER_TYPES`. It also needs to fall through to `PORTFOLIO_PROVIDER_TYPES` so portfolio providers can be registered via `POST /providers`.

### 2c. Update `apps/be/src/routes/portfolio.ts` — scan endpoint

`POST /portfolio/sources/:id/scan` currently hard-gates on `kind === 'ibkr'`. Add an `else if` branch:

```ts
} else if (isPortfolioProviderTypeKey(row.kind)) {
  const config = PORTFOLIO_PROVIDER_TYPES[row.kind]
  const creds = config.credentialsSchema.parse(parsedCreds)
  const scraper = createPortfolioScraper({
    companyId: config.companyId,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })
  const result = await scraper.scrape(creds)
  if (!result.success) throw new ApiError(502, result.errorType, result.errorMessage)
  await ingestPositions(db, {
    sourceId: req.params.id,
    asOfDate: result.asOfDate,
    positions: result.positions.map((p) => ({
      securityId: p.identifier,
      displayName: p.name,
      shares: p.quantity,
      price: p.price,
      avgCost: p.avgCost ?? 0,
      unrealizedPnl: p.unrealizedPnl ?? 0,
      currency: p.currency as 'USD' | 'ILS',
    })),
    cash: result.cash,
  })
  res.json(ok({ positionCount: result.positions.length, asOfDate: result.asOfDate }, new Date().toISOString()))
}
```

## Key facts for the implementer

- The fork is symlinked into findash: `"israeli-bank-scrapers": "link:../../../repos/israeli-bank-scrapers"` — changes to the fork are immediately available in findash with no reinstall.
- `portfolioSource.kind` already accepts `'psagot'` in the create-source route schema.
- `ingestPositions` upserts by `(sourceId, asOfDate)` — re-scanning the same day overwrites cleanly.
- `PortfolioPosition.identifier` should be ISIN when available — this becomes `securityId` in the DB and is the dedup key across providers.
- `avgCost` and `unrealizedPnl` are optional in the library type — default to `0` when not available (as shown in 2c above).
