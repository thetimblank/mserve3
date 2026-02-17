import { Home, Server, Settings } from 'lucide-react';
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

// Menu items.
const items = [
	{
		title: 'Dashboard',
		url: '/',
		icon: Home,
	},
	{
		title: 'Settings',
		url: '/settings',
		icon: Settings,
	},
];

export function AppSidebar() {
	const { servers } = useServers();

	return (
		<Sidebar className='mt-10'>
			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupLabel>Application</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarMenu>
							{items.map((item) => (
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
							{servers.map((server) => (
								<SidebarMenuItem key={server.name}>
									<SidebarMenuButton asChild>
										<Link to={`/servers/${server.name}`}>
											<Server />
											<span>{server.name}</span>
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
