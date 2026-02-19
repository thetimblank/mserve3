import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Nav from './components/nav';
import Animations from './lib/animations/lazy';
import { ThemeProvider } from '@/components/theme-provider';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { ServersProvider } from './data/servers';
import { UserProvider } from './data/user';
import Home from './pages/Home';
import Settings from './pages/Settings';
import Server from './pages/Server';
import { Toaster } from './components/ui/sonner';
import Setup from './pages/Setup';
import MserveRepairDialog from '@/components/mserve-repair-dialog';

const RootLayout: React.FC = () => {
	return (
		<BrowserRouter>
			<Toaster />
			<MserveRepairDialog />
			<Animations>
				<ThemeProvider defaultTheme='dark' storageKey='vite-ui-theme'>
					<SidebarProvider>
						<UserProvider>
							<ServersProvider>
								<Nav />
								<AppSidebar />
								<Routes>
									<Route path='/' element={<Home />} />
									<Route path='/setup' element={<Setup />} />
									<Route path='/servers/:serverName' element={<Server />} />
									<Route path='/settings' element={<Settings />} />
								</Routes>
							</ServersProvider>
						</UserProvider>
					</SidebarProvider>
				</ThemeProvider>
			</Animations>
		</BrowserRouter>
	);
};

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
	<React.StrictMode>
		<RootLayout />
	</React.StrictMode>,
);
