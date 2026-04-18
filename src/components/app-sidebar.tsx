import { Home, Network, Plus, Server, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';

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
		title: 'Settings',
		url: '/settings',
		icon: Settings,
		bottom: true,
	},
];

export function AppSidebar() {
	const { servers } = useServers();

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
							{servers.map((server) => (
								<SidebarMenuItem key={server.id}>
									<SidebarMenuButton asChild>
										<Link to={`/servers/${encodeURIComponent(server.id)}`}>
											<Server />
											<span>{server.name}</span>
										</Link>
									</SidebarMenuButton>
								</SidebarMenuItem>
							))}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>

				<SidebarGroup className='mt-auto'>
					<SidebarGroupLabel>Extra</SidebarGroupLabel>
					<SidebarGroupContent>
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
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>
		</Sidebar>
	);
}
