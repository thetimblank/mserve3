import { describe, expect, it } from 'vitest';
import { describeAutoBackup } from './review-summary';

describe('describeAutoBackup', () => {
	it('says Off with no modes', () => {
		expect(describeAutoBackup([], 120)).toBe('Off');
	});

	it('spells out the timer and the triggers in a fixed order', () => {
		expect(describeAutoBackup(['on_close'], 120)).toBe('When it stops');
		expect(describeAutoBackup(['on_close', 'interval'], 120)).toBe('Every 2 hours, when it stops');
		expect(describeAutoBackup(['on_start', 'interval', 'on_close'], 90)).toBe(
			'Every 1 hour 30 minutes, when it stops, when it starts',
		);
	});
});
