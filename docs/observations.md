# Observations

## findash integration (future)

Once the portfolio scraper infrastructure is in the fork, findash will need:

- `scrapers/portfolioConfig.ts` — a `PORTFOLIO_PROVIDER_TYPES` registry (analogous to `PROVIDER_TYPES`) mapping each `PortfolioCompanyTypes` to a zod credential schema, used for provider registration and scan dispatch.
- `routes/portfolio.ts` — make `POST /portfolio/sources/:id/scan` a generic dispatcher: IBKR path stays as-is, portfolio kinds go through `createPortfolioScraper` → `ingestPositions`.
- `routes/providers.ts` — credential validation needs to also check `PORTFOLIO_PROVIDER_TYPES` so portfolio providers can be registered.
- A `mapPositions` helper translating the library's `PortfolioPosition[]` to the `ingestPositions` payload shape (normalizing `identifier` → `securityId`, defaulting absent `avgCost`/`unrealizedPnl` to `0`).
