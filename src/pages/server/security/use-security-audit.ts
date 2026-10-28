import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { isNetworkBackend, type SecurityFinding } from '@/lib/server-security-audit';
import { forgetCriticalCount, scanServerSecurity } from '@/lib/server-security-scan';
import type { Server } from '@/data/servers';
import { useNetworks } from '@/data/networks';
import { getErrorMessage } from '@/lib/utils';

/**
 * Reads the server's `server.properties` (and `whitelist.json` count), runs the
 * pure audit rules (`lib/server-security-scan`), and exposes a one-click `applyFix`
 * that writes back through the comment-preserving `apply_server_properties`
 * backend command. Fixes should only be offered while the server is stopped
 * (server.properties is read at boot).
 */
export const useSecurityAudit = (server: Server) => {
	const [findings, setFindings] = React.useState<SecurityFinding[]>([]);
	const [isLoading, setIsLoading] = React.useState(true);
	const [isApplying, setIsApplying] = React.useState(false);

	const directory = server.directory;
	const ram = server.ram;
	const { networks } = useNetworks();
	const behindProxy = isNetworkBackend(server.id, networks);

	const refresh = React.useCallback(async () => {
		setIsLoading(true);
		try {
			setFindings(await scanServerSecurity({ directory, ram }, behindProxy));
		} catch (err) {
			toast.error(getErrorMessage(err, 'Could not run the security audit.'));
			setFindings([]);
		} finally {
			setIsLoading(false);
		}
	}, [directory, ram, behindProxy]);

	React.useEffect(() => {
		void refresh();
	}, [refresh]);

	/** Writes a set of property updates, then re-audits. */
	const applyPropertyUpdates = React.useCallback(
		async (updates: { key: string; value: string }[], successMessage: string) => {
			if (updates.length === 0) return;
			setIsApplying(true);
			try {
				await invoke('apply_server_properties', { payload: { directory, updates } });
				// The dashboard's "Could use a look" feed re-reads on its next visit.
				forgetCriticalCount(directory);
				toast.success(successMessage);
				await refresh();
			} catch (err) {
				toast.error(getErrorMessage(err, 'Could not apply the fix.'));
			} finally {
				setIsApplying(false);
			}
		},
		[directory, refresh],
	);

	/** Applies every property-based fix across the current findings in one write. */
	const applyAllRecommended = React.useCallback(async () => {
		const updates = new Map<string, string>();
		for (const finding of findings) {
			if (finding.fix?.kind === 'properties') {
				for (const update of finding.fix.updates) updates.set(update.key, update.value);
			}
		}
		const merged = [...updates.entries()].map(([key, value]) => ({ key, value }));
		await applyPropertyUpdates(merged, 'Applied all recommended security fixes.');
	}, [findings, applyPropertyUpdates]);

	return { findings, isLoading, isApplying, refresh, applyPropertyUpdates, applyAllRecommended };
};
