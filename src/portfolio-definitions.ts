export enum PortfolioCompanyTypes {
  psagot = 'psagot',
}

export const PORTFOLIO_SCRAPERS: Record<PortfolioCompanyTypes, { name: string; loginFields: string[] }> = {
  [PortfolioCompanyTypes.psagot]: {
    name: 'Psagot',
    loginFields: ['username', 'password'],
  },
};
