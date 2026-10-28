import React from 'react';

/**
 * Page-level UI state for the server detail page. Plain `useState` so the
 * setters keep one identity: `useServerRuntime` resets on `setErrorMessage`,
 * and a setter that changed with its value cleared every error it showed.
 */
export const useServerUiState = () => {
	const [isBusy, setIsBusy] = React.useState(false);
	const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
	const [terminalInput, setTerminalInput] = React.useState('');

	return { isBusy, setIsBusy, errorMessage, setErrorMessage, terminalInput, setTerminalInput };
};
