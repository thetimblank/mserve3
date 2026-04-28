import { Coffee, Home, Network, Plus, Server, Settings } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import clsx from 'clsx';

import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from '@/components/ui/sidebar';
import { useServers } from '@/data/servers';
import { getAvailableServerContentTabs, getServerContentTabUrl } from '@/pages/server/server-content-tabs';
import { getServerProviderCapabilities } from '@/lib/server-provider-capabilities';

const items = [
	{
		title: 'Dashboard',
		url: '/',
		icon: Home,
	},
	{
		title: 'Setup Hosting',
		url: '/setup',
		icon: Network,
	},
	{
		title: 'Java Guide',
		url: '/java-guide',
		icon: Coffee,
	},
	{
		title: 'Settings',
		url: '/settings',
		icon: Settings,
		bottom: true,
	},
];

export function AppSidebar() {
	const { servers } = useServers();
	const location = useLocation();

	return (
		<Sidebar className='pt-10'>
			<SidebarContent className='p-2'>
				<SidebarGroup>
					<SidebarGroupLabel>Application</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarMenu>
							{items
								.filter((item) => !item.bottom)
								.map((item) => (
									<SidebarMenuItem key={item.title}>
										<SidebarMenuButton asChild>
											<Link to={item.url}>
												<item.icon />
												<span>{item.title}</span>
											</Link>
										</SidebarMenuButton>
									</SidebarMenuItem>
								))}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
				<SidebarGroup>
					<SidebarGroupLabel>Servers</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarMenu>
							<SidebarMenuItem>
								<SidebarMenuButton asChild>
									<Link to='/servers/new'>
										<Plus />
										<span>Create Server</span>
									</Link>
								</SidebarMenuButton>
							</SidebarMenuItem>
							{servers.length === 0 && (
								<SidebarMenuItem>
									<SidebarMenuButton disabled>
										<Server />
										<span>No servers yet</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
							)}
							{servers.map((server) =>
								(() => {
									const providerCapabilities = getServerProviderCapabilities(server.provider);
									const availableTabs = getAvailableServerContentTabs(providerCapabilities.kind);

									return (
										<SidebarMenuItem key={server.id}>
											<SidebarMenuButton
												className={
													location.pathname.startsWith(
														`/servers/${encodeURIComponent(server.id)}`,
													)
														? 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground cursor-default'
														: ''
												}
												asChild>
												<Link to={`/servers/${encodeURIComponent(server.id)}`}>
													<Server />
													<span>{server.name}</span>
												</Link>
											</SidebarMenuButton>

											{location.pathname.startsWith(
												`/servers/${encodeURIComponent(server.id)}`,
											) && (
												<div className='ml-4 flex flex-col'>
													{availableTabs.map((tab) => (
														<Link
															className={clsx(
																'border-l-2 py-1 capitalize pl-4 rounded-r-lg',
																location.pathname === getServerContentTabUrl(server.id, tab)
																	? 'text-accent-foreground border-l-accent bg-accent/75 cursor-default'
																	: 'text-muted-foreground hover:bg-muted',
															)}
															to={getServerContentTabUrl(server.id, tab)}>
															{tab}
														</Link>
													))}
												</div>
											)}
										</SidebarMenuItem>
									);
								})(),
							)}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>

				<SidebarGroup className='mt-auto'>
					<SidebarGroupLabel>Extra</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarMenu>
							{items
								.filter((item) => item.bottom)
								.map((item) => (
									<SidebarMenuItem key={item.title}>
										<SidebarMenuButton asChild>
											<Link to={item.url}>
												<item.icon />
												<span>{item.title}</span>
											</Link>
										</SidebarMenuButton>
									</SidebarMenuItem>
								))}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>
		</Sidebar>
	);
}
