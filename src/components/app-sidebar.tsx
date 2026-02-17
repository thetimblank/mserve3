import { Home, Server, Settings, Target, TrendingUp } from 'lucide-react';
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

// Menu items.
const items = [
	{
		title: 'Home',
		url: '/',
		icon: Home,
	},
	{
		title: 'Servers',
		url: '/servers',
		icon: Server,
	},
	{
		title: 'Settings',
		url: '/settings',
		icon: Settings,
	},
];

export function AppSidebar() {
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
			</SidebarContent>
		</Sidebar>
	);
}
