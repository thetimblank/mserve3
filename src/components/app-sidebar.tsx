import { Home, Network, Server, Settings } from 'lucide-react';
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
		title: 'Setup',
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
			<SidebarContent>
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
				{servers.length > 0 && (
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
				)}

				<SidebarGroup className='mt-auto'>
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
