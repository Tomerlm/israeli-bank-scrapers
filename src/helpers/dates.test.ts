import moment from 'moment';
import getAllMonthMoments, { capMonthsAt } from './dates';

const fmt = (ms: moment.Moment[]) => ms.map(m => m.format('YYYY-MM'));

describe('capMonthsAt', () => {
  const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'].map(s => moment(s, 'YYYY-MM'));

  test('returns all months when endDate is unset', () => {
    expect(fmt(capMonthsAt(months, undefined))).toEqual(fmt(months));
  });

  test("keeps months up to endDate's month + 1 billing month", () => {
    expect(fmt(capMonthsAt(months, new Date('2026-02-20')))).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  test('a 30-day window fetches at most 3 billing months, not every month up to today', () => {
    const start = moment().subtract(210, 'days');
    const end = moment().subtract(180, 'days').toDate();
    const all = getAllMonthMoments(start, 1);
    const capped = capMonthsAt(all, end);
    expect(all.length).toBeGreaterThanOrEqual(8);
    expect(capped.length).toBeLessThanOrEqual(3);
    expect(capped[0].isSame(start.clone().startOf('month'))).toBe(true);
  });

  test('respects a custom trailing window', () => {
    expect(fmt(capMonthsAt(months, new Date('2026-02-20'), 0))).toEqual(['2026-01', '2026-02']);
  });
});
