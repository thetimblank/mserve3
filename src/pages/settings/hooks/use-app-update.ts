import React from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { toast } from 'sonner';

type State = {
	isDesktopApp: boolean;
	isVersionReady: boolean;
	currentVersion: string;
	status: 'idle' | 'checking' | 'installing';
	availableUpdate: Update | null;
	message: string;
	errorMessage: string | null;
};

type Action =
	| { type: 'setDesktopMode'; isDesktopApp: boolean; message: string }
	| { type: 'setVersion'; version: string }
	| { type: 'setChecking' }
	| { type: 'setInstalling' }
	| { type: 'setAvailableUpdate'; update: Update; message: string }
	| { type: 'setNoUpdate'; message: string }
	| { type: 'setInstalled'; message: string }
	| { type: 'setError'; message: string }
	| { type: 'setIdle' };

const initialState: State = {
	isDesktopApp: false,
	isVersionReady: false,
	currentVersion: '',
	status: 'idle',
	availableUpdate: null,
	message: 'Not checked yet.',
	errorMessage: null,
};

const reducer = (state: State, action: Action): State => {
	switch (action.type) {
		case 'setDesktopMode':
			return {
				...state,
				isDesktopApp: action.isDesktopApp,
				message: action.message,
				errorMessage: null,
			};
		case 'setVersion':
			return {
				...state,
				currentVersion: action.version,
				isVersionReady: true,
			};
		case 'setChecking':
			return {
				...state,
				status: 'checking',
				errorMessage: null,
			};
		case 'setInstalling':
			return {
				...state,
				status: 'installing',
				errorMessage: null,
			};
		case 'setAvailableUpdate':
			return {
				...state,
				availableUpdate: action.update,
				message: action.message,
				errorMessage: null,
			};
		case 'setNoUpdate':
			return {
				...state,
				availableUpdate: null,
				message: action.message,
				errorMessage: null,
			};
		case 'setInstalled':
			return {
				...state,
				availableUpdate: null,
				message: action.message,
				errorMessage: null,
			};
		case 'setError':
			return {
				...state,
				errorMessage: action.message,
				message: action.message,
			};
		case 'setIdle':
			return {
				...state,
				status: 'idle',
			};
		default:
			return state;
	}
};

export const useAppUpdate = () => {
	const [state, dispatch] = React.useReducer(reducer, initialState);

	React.useEffect(() => {
		if (!isTauri()) {
			dispatch({
				type: 'setDesktopMode',
				isDesktopApp: false,
				message: 'Updater is available in desktop app builds only.',
			});
			dispatch({ type: 'setVersion', version: 'Web build' });
			return;
		}

		dispatch({
			type: 'setDesktopMode',
			isDesktopApp: true,
			message: state.message,
		});

		let mounted = true;
		getVersion()
			.then((version) => {
				if (!mounted) return;
				dispatch({ type: 'setVersion', version });
			})
			.catch(() => {
				if (!mounted) return;
				dispatch({ type: 'setVersion', version: 'Unavailable' });
			});

		return () => {
			mounted = false;
		};
	}, []);

	const checkForUpdates = React.useCallback(async () => {
		if (!state.isDesktopApp) {
			toast.error('Updater is only available in desktop app builds.');
			return;
		}

		dispatch({ type: 'setChecking' });
		try {
			const update = await check();
			if (!update) {
				const message = 'You are on the latest version.';
				dispatch({ type: 'setNoUpdate', message });
				toast.success(message);
				return;
			}

			const message = `Update ${update.version} is available.`;
			dispatch({ type: 'setAvailableUpdate', update, message });
			toast.info(message);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Failed to check for updates.';
			dispatch({ type: 'setError', message });
			toast.error(message);
		} finally {
			dispatch({ type: 'setIdle' });
		}
	}, [state.isDesktopApp]);

	const installUpdate = React.useCallback(async () => {
		if (!state.availableUpdate) {
			return;
		}

		dispatch({ type: 'setInstalling' });
		try {
			await state.availableUpdate.downloadAndInstall();
			const message = 'Update installed. Restart MSERVE to finish updating.';
			dispatch({ type: 'setInstalled', message });
			toast.success(message);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Failed to install update.';
			dispatch({ type: 'setError', message });
			toast.error(message);
		} finally {
			dispatch({ type: 'setIdle' });
		}
	}, [state.availableUpdate]);

	return {
		currentVersion: state.currentVersion,
		isVersionReady: state.isVersionReady,
		isCheckingUpdate: state.status === 'checking',
		isInstallingUpdate: state.status === 'installing',
		availableUpdate: state.availableUpdate,
		updateMessage: state.message,
		errorMessage: state.errorMessage,
		checkForUpdates,
		installUpdate,
	};
};
