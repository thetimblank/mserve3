import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { parsePropertiesMap } from '@/components/server-config-file-editor/properties-config';
import {
	auditServerProperties,
	type SecurityFinding,
	type SecurityAuditContext,
} from '@/lib/server-security-audit';
import type { Server } from '@/data/servers';

type ManagedConfigFileContent = { fileName: string; content: string };

const readManagedFile = async (directory: string, fileName: string): Promise<string | null> => {
	try {
		const result = await invoke<ManagedConfigFileContent>('read_managed_server_config_file', {
			payload: { directory, fileName },
		});
		return result.content;
	} catch {
		// Missing/unreadable file — the audit treats these as vanilla defaults.
		return null;
	}
};

const countWhitelist = (content: string | null): number | null => {
	if (!content) return null;
	try {
		const parsed = JSON.parse(content);
		return Array.isArray(parsed) ? parsed.length : null;
	} catch {
		return null;
	}
};

/**
 * Reads the server's `server.properties` (and `whitelist.json` count), runs the
 * pure {@link auditServerProperties} rules, and exposes a one-click `applyFix`
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

	const refresh = React.useCallback(async () => {
		setIsLoading(true);
		try {
			const [properties, whitelist] = await Promise.all([
				readManagedFile(directory, 'server.properties'),
				readManagedFile(directory, 'whitelist.json'),
			]);
			const props = properties ? parsePropertiesMap(properties) : new Map<string, string>();
			const ctx: SecurityAuditContext = {
				maxRamGb: Math.max(1, Number(ram) || 1),
				whitelistCount: countWhitelist(whitelist),
			};
			setFindings(auditServerProperties(props, ctx));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not run the security audit.');
			setFindings([]);
		} finally {
			setIsLoading(false);
		}
	}, [directory, ram]);

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
				toast.success(successMessage);
				await refresh();
			} catch (err) {
				toast.error(err instanceof Error ? err.message : 'Could not apply the fix.');
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
