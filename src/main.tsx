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
import Home from './pages/Home';
import Settings from './pages/Settings';
import Servers from './pages/Servers';
import Server from './pages/Server';

const RootLayout: React.FC = () => {
	return (
		<BrowserRouter>
			<Animations>
				<ThemeProvider defaultTheme='dark' storageKey='vite-ui-theme'>
					<SidebarProvider>
						<ServersProvider>
							<Nav />
							<AppSidebar />
							<Routes>
								<Route path='/' element={<Home />} />
								<Route path='/servers' element={<Servers />} />
								<Route path='/servers/:serverName' element={<Server />} />
								<Route path='/settings' element={<Settings />} />
							</Routes>
						</ServersProvider>
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
