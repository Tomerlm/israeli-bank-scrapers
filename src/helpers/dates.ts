import moment, { type Moment } from 'moment';

export default function getAllMonthMoments(startMoment: Moment | string, futureMonths?: number) {
  let monthMoment = moment(startMoment).startOf('month');

  const allMonths: Moment[] = [];
  let lastMonth = moment().startOf('month');
  if (futureMonths && futureMonths > 0) {
    lastMonth = lastMonth.add(futureMonths, 'month');
  }
  while (monthMoment.isSameOrBefore(lastMonth)) {
    allMonths.push(monthMoment);
    monthMoment = moment(monthMoment).add(1, 'month');
  }

  return allMonths;
}

/**
 * Drops months after `endDate`'s month + `trailingMonths`. Card transactions are listed under
 * their billing month, which is usually the month after the purchase, so a window ending on
 * `endDate` needs one trailing month to see all of its purchases.
 */
export function capMonthsAt(months: Moment[], endDate: Date | undefined, trailingMonths = 1): Moment[] {
  if (!endDate) return months;
  const lastMonth = moment(endDate).startOf('month').add(trailingMonths, 'month');
  return months.filter(m => m.isSameOrBefore(lastMonth));
}
