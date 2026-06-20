/**
 * Schema + helpers for server "networks": a proxy (Velocity) plus the backend
 * servers wired behind it. A network is the source of truth the app uses to
 * automatically assign backend ports and write Velocity modern-forwarding config
 * across the proxy and each backend. See {@link file://./network-config-engine.ts}.
 */

export type NetworkForwardingMode = 'modern';

export interface NetworkForwarding {
	mode: NetworkForwardingMode;
	/** Shared Velocity modern-forwarding secret synced proxy <-> backends. */
	secret: string;
}

export interface NetworkMember {
	/** References a {@link Server} id whose provider kind is 'plugin' | 'vanilla'. */
	serverId: string;
	/** Velocity `[servers]` table key, e.g. "lobby". Unique within the network. */
	alias: string;
	/** Address the proxy uses to reach this backend. Defaults to 127.0.0.1. */
	host: string;
	/** Auto-assigned backend port, unique within the network. */
	port: number;
	/** Whether this backend is part of the Velocity `try` fallback list. */
	inTry: boolean;
	/** Ordering within the `try` list (lower = tried first). */
	tryIndex: number;
}

export interface NetworkNodePosition {
	x: number;
	y: number;
}

export interface ManagedNetwork {
	id: string;
	name: string;
	created_at: string;
	updated_at: string;
	/** References a {@link Server} id whose provider kind is 'proxy', or null. */
	proxyServerId: string | null;
	members: NetworkMember[];
	forwarding: NetworkForwarding;
	/** First port auto-assigned to backends. */
	basePort: number;
	/** React Flow node positions, keyed by Server id (proxy + members). */
	layout: Record<string, NetworkNodePosition>;
}

export const DEFAULT_NETWORK_BASE_PORT = 25566;
export const DEFAULT_BACKEND_HOST = '127.0.0.1';
export const DEFAULT_PROXY_BIND = '0.0.0.0:25577';
export const FORWARDING_SECRET_FILE = 'forwarding.secret';
export const PAPER_GLOBAL_CONFIG_RELATIVE = 'config/paper-global.yml';

const SECRET_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export const generateForwardingSecret = (length = 24): string => {
	const alphabetLength = SECRET_ALPHABET.length;
	if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
		const bytes = new Uint8Array(length);
		crypto.getRandomValues(bytes);
		return Array.from(bytes, (byte) => SECRET_ALPHABET[byte % alphabetLength]).join('');
	}

	let result = '';
	for (let index = 0; index < length; index += 1) {
		result += SECRET_ALPHABET[Math.floor(Math.random() * alphabetLength)];
	}
	return result;
};

export const generateNetworkId = (): string => {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `network-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * Turn an arbitrary server name into a Velocity-safe table key (lowercase,
 * alphanumeric + dashes). Velocity server names may not contain spaces.
 */
export const sanitizeNetworkAlias = (value: string): string => {
	const slug = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return slug || 'server';
};

/** Ensure an alias is unique within a set of already-used aliases. */
export const uniqueNetworkAlias = (base: string, used: Set<string>): string => {
	const sanitized = sanitizeNetworkAlias(base);
	if (!used.has(sanitized)) return sanitized;
	for (let index = 2; index < 1000; index += 1) {
		const candidate = `${sanitized}-${index}`;
		if (!used.has(candidate)) return candidate;
	}
	return `${sanitized}-${Date.now()}`;
};

export const createDefaultNetwork = (name: string): ManagedNetwork => {
	const now = new Date().toISOString();
	return {
		id: generateNetworkId(),
		name: name.trim() || 'New Network',
		created_at: now,
		updated_at: now,
		proxyServerId: null,
		members: [],
		forwarding: { mode: 'modern', secret: generateForwardingSecret() },
		basePort: DEFAULT_NETWORK_BASE_PORT,
		layout: {},
	};
};

const toIsoDateString = (value?: string): string => {
	if (!value) return new Date().toISOString();
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
};

const normalizePort = (value: unknown, fallback: number): number => {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return fallback;
	return parsed;
};

const normalizeMember = (member: Partial<NetworkMember>, index: number): NetworkMember | null => {
	const serverId = typeof member.serverId === 'string' ? member.serverId.trim() : '';
	if (!serverId) return null;
	return {
		serverId,
		alias: sanitizeNetworkAlias(member.alias ?? `server-${index + 1}`),
		host: typeof member.host === 'string' && member.host.trim() ? member.host.trim() : DEFAULT_BACKEND_HOST,
		port: normalizePort(member.port, DEFAULT_NETWORK_BASE_PORT + index),
		inTry: member.inTry ?? true,
		tryIndex: Number.isInteger(member.tryIndex) ? Number(member.tryIndex) : index,
	};
};

/**
 * Give every member a unique, valid port. Existing valid/unique ports are kept
 * stable; missing, out-of-range, duplicate, or reserved ports are reassigned
 * sequentially from `basePort`. `reserved` lets callers exclude known ports
 * (e.g. the proxy bind port).
 */
export const assignMemberPorts = (
	members: NetworkMember[],
	basePort: number,
	reserved: number[] = [],
): NetworkMember[] => {
	const used = new Set<number>(reserved.filter((port) => port >= 1 && port <= 65535));
	const result = members.map((member) => ({ ...member }));

	for (const member of result) {
		if (member.port >= 1 && member.port <= 65535 && !used.has(member.port)) {
			used.add(member.port);
		} else {
			member.port = 0;
		}
	}

	let next = Math.min(Math.max(basePort, 1), 65535);
	for (const member of result) {
		if (member.port !== 0) continue;
		while (next <= 65535 && used.has(next)) next += 1;
		member.port = next <= 65535 ? next : basePort;
		used.add(member.port);
		next += 1;
	}

	return result;
};

const normalizeLayout = (layout: unknown): Record<string, NetworkNodePosition> => {
	if (!layout || typeof layout !== 'object') return {};
	const result: Record<string, NetworkNodePosition> = {};
	for (const [key, value] of Object.entries(layout as Record<string, unknown>)) {
		if (value && typeof value === 'object') {
			const position = value as Partial<NetworkNodePosition>;
			const x = Number(position.x);
			const y = Number(position.y);
			if (Number.isFinite(x) && Number.isFinite(y)) {
				result[key] = { x, y };
			}
		}
	}
	return result;
};

export const normalizeNetwork = (network: Partial<ManagedNetwork>): ManagedNetwork => {
	const usedAliases = new Set<string>();
	const members: NetworkMember[] = [];
	(network.members ?? []).forEach((member, index) => {
		const normalized = normalizeMember(member, index);
		if (!normalized) return;
		normalized.alias = uniqueNetworkAlias(normalized.alias, usedAliases);
		usedAliases.add(normalized.alias);
		members.push(normalized);
	});

	members.sort((left, right) => left.tryIndex - right.tryIndex);
	members.forEach((member, index) => {
		member.tryIndex = index;
	});

	const basePort = normalizePort(network.basePort, DEFAULT_NETWORK_BASE_PORT);
	const portedMembers = assignMemberPorts(members, basePort, [Number(DEFAULT_PROXY_BIND.split(':')[1])]);

	const secret =
		typeof network.forwarding?.secret === 'string' && network.forwarding.secret.trim()
			? network.forwarding.secret.trim()
			: generateForwardingSecret();

	return {
		id: typeof network.id === 'string' && network.id.trim() ? network.id.trim() : generateNetworkId(),
		name: typeof network.name === 'string' && network.name.trim() ? network.name.trim() : 'New Network',
		created_at: toIsoDateString(network.created_at),
		updated_at: toIsoDateString(network.updated_at),
		proxyServerId:
			typeof network.proxyServerId === 'string' && network.proxyServerId.trim()
				? network.proxyServerId.trim()
				: null,
		members: portedMembers,
		forwarding: { mode: 'modern', secret },
		basePort,
		layout: normalizeLayout(network.layout),
	};
};

export const normalizeNetworks = (networks: Partial<ManagedNetwork>[]): ManagedNetwork[] =>
	networks.map(normalizeNetwork);

/** All Server ids referenced by a network (proxy + members). */
export const getNetworkServerIds = (network: ManagedNetwork): string[] => {
	const ids = network.members.map((member) => member.serverId);
	if (network.proxyServerId) ids.unshift(network.proxyServerId);
	return ids;
};
