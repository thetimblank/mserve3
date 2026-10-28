import * as React from 'react';

const COPIED_RESET_MS = 2000;

/** Copies text and reports `copied` for two seconds, for a check-mark affordance. */
export function useCopyToClipboard() {
	const [copied, setCopied] = React.useState(false);
	const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

	React.useEffect(
		() => () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		},
		[],
	);

	const copy = React.useCallback((text: string | null | false | undefined) => {
		if (!text) return;
		void navigator.clipboard.writeText(text).then(() => {
			setCopied(true);
			if (timerRef.current) clearTimeout(timerRef.current);
			timerRef.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
		});
	}, []);

	return { copied, copy };
}
