import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
	isExperienceAtLeast,
	normalizeExperienceLevel,
	resolveServerPageDisplay,
	useExperience,
	useServerPageDisplay,
	UserProvider,
	useUser,
} from './user';

const STORAGE_KEY = 'mserve.user.v1';

const wrapper = ({ children }: { children: React.ReactNode }) => <UserProvider>{children}</UserProvider>;

const renderUser = () =>
	renderHook(() => ({ user: useUser(), experience: useExperience() }), { wrapper });

afterEach(() => {
	localStorage.clear();
});

describe('normalizeExperienceLevel', () => {
	it('keeps a known level', () => {
		expect(normalizeExperienceLevel('beginner')).toBe('beginner');
		expect(normalizeExperienceLevel('advanced')).toBe('advanced');
	});

	it('defaults missing or unknown values to standard', () => {
		expect(normalizeExperienceLevel(undefined)).toBe('standard');
		expect(normalizeExperienceLevel('expert')).toBe('standard');
		expect(normalizeExperienceLevel(true)).toBe('standard');
	});
});

describe('isExperienceAtLeast', () => {
	it('orders beginner < standard < advanced', () => {
		expect(isExperienceAtLeast('beginner', 'standard')).toBe(false);
		expect(isExperienceAtLeast('standard', 'standard')).toBe(true);
		expect(isExperienceAtLeast('standard', 'advanced')).toBe(false);
		expect(isExperienceAtLeast('advanced', 'beginner')).toBe(true);
	});
});

describe('useExperience', () => {
	it('defaults to standard, ignoring a legacy advanced_mode flag', async () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ advanced_mode: true }));
		const { result } = renderUser();
		await waitFor(() => expect(result.current.user.isReady).toBe(true));

		expect(result.current.experience.level).toBe('standard');
		expect(result.current.experience.isAdvanced).toBe(false);
		expect(result.current.experience.isBeginner).toBe(false);
		expect(result.current.experience.atLeast('standard')).toBe(true);
		expect('advanced_mode' in result.current.user.user).toBe(false);
	});

	it('loads a stored level', async () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ experience_level: 'beginner' }));
		const { result } = renderUser();
		await waitFor(() => expect(result.current.user.isReady).toBe(true));

		expect(result.current.experience.isBeginner).toBe(true);
		expect(result.current.experience.atLeast('standard')).toBe(false);
	});

	it('follows updates and persists them', async () => {
		const { result } = renderUser();
		await waitFor(() => expect(result.current.user.isReady).toBe(true));

		act(() => result.current.user.updateUserField('experience_level', 'advanced'));

		expect(result.current.experience.isAdvanced).toBe(true);
		expect(result.current.experience.atLeast('standard')).toBe(true);
		await waitFor(() =>
			expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').experience_level).toBe('advanced'),
		);
	});
});

describe('resolveServerPageDisplay', () => {
	const unset = { show_live_stats: null, show_details: null };

	it('hides both sections for beginners and shows them otherwise when unset', () => {
		expect(resolveServerPageDisplay(unset, 'beginner')).toEqual({ showLiveStats: false, showDetails: false });
		expect(resolveServerPageDisplay(unset, 'standard')).toEqual({ showLiveStats: true, showDetails: true });
		expect(resolveServerPageDisplay(unset, 'advanced')).toEqual({ showLiveStats: true, showDetails: true });
	});

	it('lets an explicit choice win over the tier default', () => {
		expect(resolveServerPageDisplay({ show_live_stats: true, show_details: null }, 'beginner')).toEqual({
			showLiveStats: true,
			showDetails: false,
		});
		expect(resolveServerPageDisplay({ show_live_stats: null, show_details: false }, 'advanced')).toEqual({
			showLiveStats: true,
			showDetails: false,
		});
	});
});

describe('useServerPageDisplay', () => {
	const renderDisplay = () =>
		renderHook(() => ({ user: useUser(), display: useServerPageDisplay() }), { wrapper });

	it('treats missing or malformed stored prefs as unset', async () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ experience_level: 'beginner', server_page_display: { show_live_stats: 'yes' } }),
		);
		const { result } = renderDisplay();
		await waitFor(() => expect(result.current.user.isReady).toBe(true));

		expect(result.current.user.user.server_page_display).toEqual({ show_live_stats: null, show_details: null });
		expect(result.current.display).toEqual({ showLiveStats: false, showDetails: false });
	});

	it('follows the tier while unset and keeps an explicit choice across tier changes', async () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ experience_level: 'beginner' }));
		const { result } = renderDisplay();
		await waitFor(() => expect(result.current.user.isReady).toBe(true));

		act(() =>
			result.current.user.updateUserField('server_page_display', (previous) => ({
				...previous,
				show_details: true,
			})),
		);
		act(() => result.current.user.updateUserField('experience_level', 'standard'));
		expect(result.current.display).toEqual({ showLiveStats: true, showDetails: true });

		act(() => result.current.user.updateUserField('experience_level', 'beginner'));
		expect(result.current.display).toEqual({ showLiveStats: false, showDetails: true });
	});
});
