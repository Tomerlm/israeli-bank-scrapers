export enum PortfolioCompanyTypes {
  psagot = 'psagot',
  beinleumi = 'beinleumi',
}

export const PORTFOLIO_SCRAPERS: Record<PortfolioCompanyTypes, { name: string; loginFields: string[] }> = {
  [PortfolioCompanyTypes.psagot]: {
    name: 'Psagot',
    loginFields: ['username', 'password'],
  },
  [PortfolioCompanyTypes.beinleumi]: {
    name: 'Beinleumi',
    loginFields: ['username', 'password'],
  },
};
