import React from 'react';

type State = {
	isBusy: boolean;
	hideBackgroundTelemetry: boolean;
	errorMessage: string | null;
	terminalInput: string;
};

type Action =
	| { type: 'setBusy'; value: boolean }
	| { type: 'setHideBackgroundTelemetry'; value: boolean }
	| { type: 'setErrorMessage'; value: string | null }
	| { type: 'setTerminalInput'; value: string };

const initialState: State = {
	isBusy: false,
	hideBackgroundTelemetry: true,
	errorMessage: null,
	terminalInput: '',
};

const reducer = (state: State, action: Action): State => {
	switch (action.type) {
		case 'setBusy':
			return { ...state, isBusy: action.value };
		case 'setHideBackgroundTelemetry':
			return { ...state, hideBackgroundTelemetry: action.value };
		case 'setErrorMessage':
			return { ...state, errorMessage: action.value };
		case 'setTerminalInput':
			return { ...state, terminalInput: action.value };
		default:
			return state;
	}
};

const resolveNext = <T>(current: T, next: React.SetStateAction<T>) =>
	typeof next === 'function' ? (next as (value: T) => T)(current) : next;

export const useServerUiState = () => {
	const [state, dispatch] = React.useReducer(reducer, initialState);

	const setIsBusy = React.useCallback(
		(next: React.SetStateAction<boolean>) => {
			dispatch({ type: 'setBusy', value: resolveNext(state.isBusy, next) });
		},
		[state.isBusy],
	);

	const setHideBackgroundTelemetry = React.useCallback(
		(next: React.SetStateAction<boolean>) => {
			dispatch({
				type: 'setHideBackgroundTelemetry',
				value: resolveNext(state.hideBackgroundTelemetry, next),
			});
		},
		[state.hideBackgroundTelemetry],
	);

	const setErrorMessage = React.useCallback(
		(next: React.SetStateAction<string | null>) => {
			dispatch({ type: 'setErrorMessage', value: resolveNext(state.errorMessage, next) });
		},
		[state.errorMessage],
	);

	const setTerminalInput = React.useCallback(
		(next: React.SetStateAction<string>) => {
			dispatch({ type: 'setTerminalInput', value: resolveNext(state.terminalInput, next) });
		},
		[state.terminalInput],
	);

	return {
		isBusy: state.isBusy,
		hideBackgroundTelemetry: state.hideBackgroundTelemetry,
		errorMessage: state.errorMessage,
		terminalInput: state.terminalInput,
		setIsBusy,
		setHideBackgroundTelemetry,
		setErrorMessage,
		setTerminalInput,
	};
};
