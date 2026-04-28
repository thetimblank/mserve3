import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import Nav from './components/nav';
import Animations from './lib/animations/lazy';
import { ThemeProvider } from '@/components/theme-provider';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { ServersProvider } from './data/servers';
import { UserProvider } from './data/user';
import Home from './pages/Home';
import Settings from './pages/Settings';
import Server from './pages/Server';
import JavaGuide from './pages/JavaGuide';
import { Toaster } from './components/ui/sonner';
import Setup from './pages/Setup';
import MserveRepairDialog from '@/components/mserve-repair-dialog';
import CreateServerPage from './pages/CreateServer';
import { CreateServerProvider } from './pages/create-server/CreateServerContext';

let startupCompleted = false;

const StartupReadySignal: React.FC = () => {
	React.useEffect(() => {
		if (startupCompleted) return;
		startupCompleted = true;

		void invoke('complete_startup').catch(() => {
			// Ignore failures so startup does not block in browser-only contexts.
		});
	}, []);

	return null;
};

const RootLayout: React.FC = () => {
	return (
		<BrowserRouter>
			<StartupReadySignal />
			<Toaster />
			<Animations>
				<ThemeProvider defaultTheme='dark' storageKey='vite-ui-theme'>
					<SidebarProvider className='h-svh overflow-hidden pt-10'>
						<UserProvider>
							<ServersProvider>
								<CreateServerProvider>
									<MserveRepairDialog />
									<Nav />
									<AppSidebar />
									<SidebarInset className='h-full min-h-0 overflow-hidden'>
										<Routes>
											<Route path='/' element={<Home />} />
											<Route path='/setup' element={<Setup />} />
											<Route path='/java-guide' element={<JavaGuide />} />
											<Route path='/servers/new' element={<CreateServerPage />} />
											<Route path='/servers/:serverId/:tab?' element={<Server />} />
											<Route path='/settings' element={<Settings />} />
										</Routes>
									</SidebarInset>
								</CreateServerProvider>
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
