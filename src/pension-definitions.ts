export enum PensionCompanyTypes {
  swiftness = 'swiftness',
}

export const PENSION_SCRAPERS: Record<PensionCompanyTypes, { name: string; loginFields: string[] }> = {
  [PensionCompanyTypes.swiftness]: {
    name: 'Swiftness (Maslaka)',
    loginFields: ['id', 'phone', 'otpChannel'],
  },
};
