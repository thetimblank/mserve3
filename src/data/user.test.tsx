import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
	isExperienceAtLeast,
	normalizeExperienceLevel,
	useExperience,
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
