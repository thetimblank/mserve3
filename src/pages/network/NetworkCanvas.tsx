import React from 'react';
import {
	Background,
	BackgroundVariant,
	Controls,
	ReactFlow,
	useEdgesState,
	useNodesState,
	type Edge,
	type Node,
	type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { Server } from '@/data/servers';
import { resolveProviderKind } from '@/lib/server-provider-capabilities';
import {
	buildNetworkAliasMap,
	getProxyBind,
	type ManagedNetwork,
	type NetworkNodePosition,
} from '@/lib/network-schema';
import type { NetworkDiagnostic } from '@/lib/network-config-engine';

import { networkNodeTypes, type BackendNodeData, type ProxyNodeData } from './nodes';

interface NetworkCanvasProps {
	network: ManagedNetwork;
	servers: Server[];
	diagnostics: NetworkDiagnostic[];
	selectedServerId: string | null;
	onSelectServer: (serverId: string | null) => void;
	onLayoutChange: (serverId: string, position: NetworkNodePosition) => void;
	onRemoveMember: (serverId: string) => void;
	onRemoveProxy: () => void;
}

const getColorMode = (): 'dark' | 'light' => {
	if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) {
		return 'dark';
	}
	return 'light';
};

const buildNodes = (
	network: ManagedNetwork,
	byId: Map<string, Server>,
	diagnostics: NetworkDiagnostic[],
	selectedServerId: string | null,
	onRemoveMember: (serverId: string) => void,
	onRemoveProxy: () => void,
): Node[] => {
	const nodes: Node[] = [];
	const warningByServer = new Map<string, string>();
	let proxyWarnings = 0;
	for (const diagnostic of diagnostics) {
		if (!diagnostic.serverId) continue;
		if (!warningByServer.has(diagnostic.serverId)) {
			warningByServer.set(diagnostic.serverId, diagnostic.message);
		}
	}

	const proxy = network.proxyServerId ? byId.get(network.proxyServerId) : undefined;
	const aliasMap = buildNetworkAliasMap(network.members, byId);

	network.members.forEach((member, index) => {
		const server = byId.get(member.serverId);
		if (!server) return;
		if (warningByServer.has(server.id)) proxyWarnings += 1;
		const position = network.layout[server.id] ?? { x: 420, y: 40 + index * 150 };
		const data: BackendNodeData = {
			server,
			member,
			alias: aliasMap.get(server.id) ?? server.id,
			kind: resolveProviderKind(server.provider),
			warning: warningByServer.get(server.id),
			selected: selectedServerId === server.id,
			onRemove: () => onRemoveMember(server.id),
		};
		nodes.push({
			id: server.id,
			type: 'backend',
			position,
			data,
		});
	});

	if (proxy) {
		const position = network.layout[proxy.id] ?? { x: 40, y: 140 };
		const data: ProxyNodeData = {
			server: proxy,
			memberCount: network.members.length,
			warningCount: proxyWarnings,
			bind: getProxyBind(network),
			selected: selectedServerId === proxy.id,
			onRemove: onRemoveProxy,
		};
		nodes.push({
			id: proxy.id,
			type: 'proxy',
			position,
			data,
		});
	}

	return nodes;
};

const buildEdges = (network: ManagedNetwork, byId: Map<string, Server>): Edge[] => {
	if (!network.proxyServerId || !byId.has(network.proxyServerId)) return [];
	return network.members
		.filter((member) => byId.has(member.serverId))
		.map((member) => ({
			id: `edge-${network.proxyServerId}-${member.serverId}`,
			source: network.proxyServerId as string,
			target: member.serverId,
			animated: true,
			style: { strokeWidth: 2 },
		}));
};

export const NetworkCanvas: React.FC<NetworkCanvasProps> = ({
	network,
	servers,
	diagnostics,
	selectedServerId,
	onSelectServer,
	onLayoutChange,
	onRemoveMember,
	onRemoveProxy,
}) => {
	const byId = React.useMemo(() => new Map(servers.map((server) => [server.id, server])), [servers]);
	const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
	const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

	React.useEffect(() => {
		setNodes(buildNodes(network, byId, diagnostics, selectedServerId, onRemoveMember, onRemoveProxy));
		setEdges(buildEdges(network, byId));
	}, [network, byId, diagnostics, selectedServerId, onRemoveMember, onRemoveProxy, setNodes, setEdges]);

	const handleNodesChange = React.useCallback(
		(changes: NodeChange<Node>[]) => {
			onNodesChange(changes);
			for (const change of changes) {
				if (change.type === 'position' && change.dragging === false && change.position) {
					onLayoutChange(change.id, change.position);
				}
			}
		},
		[onNodesChange, onLayoutChange],
	);

	return (
		<ReactFlow
			colorMode={getColorMode()}
			nodes={nodes}
			edges={edges}
			nodeTypes={networkNodeTypes}
			onNodesChange={handleNodesChange}
			onEdgesChange={onEdgesChange}
			onNodeClick={(_, node) => onSelectServer(node.id)}
			onPaneClick={() => onSelectServer(null)}
			fitView
			fitViewOptions={{ padding: 0.25 }}
			minZoom={0.3}
			proOptions={{ hideAttribution: true }}>
			<Background variant={BackgroundVariant.Dots} gap={20} size={1.5} />
			<Controls showInteractive={false} />
		</ReactFlow>
	);
};
