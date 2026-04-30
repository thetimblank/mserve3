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

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
	constructor(props: { children: React.ReactNode }) {
		super(props);
		this.state = { error: null };
	}

	static getDerivedStateFromError(error: Error) {
		return { error };
	}

	componentDidCatch(error: Error) {
		console.error('Application failed to render', error);
	}

	render() {
		if (!this.state.error) {
			return this.props.children;
		}

		return (
			<div className='flex h-svh w-full items-center justify-center bg-background px-6 text-foreground'>
				<div className='w-full max-w-xl rounded-3xl border bg-card p-8 shadow-2xl'>
					<p className='text-sm font-medium uppercase tracking-[0.3em] text-muted-foreground'>
						Application error
					</p>
					<h1 className='mt-3 text-3xl font-semibold'>MSERVE could not finish loading</h1>
					<p className='mt-3 text-sm text-muted-foreground'>
						A rendering error occurred before the interface could open. This is usually caused by a
						browser-side module issue or incompatible local data.
					</p>
					<pre className='mt-4 max-h-56 overflow-auto rounded-2xl border bg-muted/50 p-4 text-xs text-destructive'>
						{this.state.error.message}
					</pre>
					<div className='mt-6 flex flex-wrap gap-3'>
						<button
							type='button'
							className='rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground'
							onClick={() => window.location.reload()}>
							Reload app
						</button>
						<button
							type='button'
							className='rounded-xl border px-4 py-2 text-sm font-medium'
							onClick={() => {
								localStorage.removeItem('mserve.user.v1');
								localStorage.removeItem('mserve.servers.v4');
								localStorage.removeItem('vite-ui-theme');
								window.location.reload();
							}}>
							Clear app data and reload [THIS CANNOT BE UNDONE]
						</button>
					</div>
				</div>
			</div>
		);
	}
}

const RootLayout: React.FC = () => {
	return (
		<BrowserRouter>
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

void invoke('complete_startup').catch(() => {
	// Ignore failures so startup does not block in browser-only contexts.
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
	<React.StrictMode>
		<AppErrorBoundary>
			<RootLayout />
		</AppErrorBoundary>
	</React.StrictMode>,
);
