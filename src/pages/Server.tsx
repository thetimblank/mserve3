import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useServers } from '@/data/servers';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
	Archive,
	ArrowLeft,
	ArrowUpRightFromSquare,
	Check,
	CircleCheck,
	Folder,
	HardDrive,
	LinkIcon,
	OctagonX,
	RefreshCcw,
	X,
} from 'lucide-react';
import ServerStatus from '@/components/server-status';
import { openUrl } from '@tauri-apps/plugin-opener';

const Server: React.FC = () => {
	const { serverName } = useParams();
	const resolvedServerName = serverName ? decodeURIComponent(serverName) : undefined;
	const { servers, isReady } = useServers();

	const server = React.useMemo(
		() => servers.find((item) => item.name === resolvedServerName),
		[servers, resolvedServerName],
	);

	if (!isReady) {
		return (
			<main className='pt-15 min-h-[calc(100vh-40px)] p-12 w-full overflow-y-auto'>
				<div className='text-muted-foreground'>Loading server...</div>
			</main>
		);
	}

	if (!server) {
		return (
			<main className='pt-15 min-h-[calc(100vh-40px)] p-12 w-full overflow-y-auto'>
				<div className='text-muted-foreground'>Server "{resolvedServerName ?? 'Unknown'}" not found.</div>
				<div className='mt-6'>
					<Button asChild variant='outline'>
						<Link to='/servers'>Back to All Servers</Link>
					</Button>
				</div>
			</main>
		);
	}

	return (
		<main className='pt-15 min-h-[calc(100vh-40px)] p-12 w-full overflow-y-auto'>
			<div className='flex items-center justify-between mb-8'>
				<div>
					<div className='flex gap-2 items-center'>
						<Link to='/servers'>
							<ArrowLeft className='size-8' />
						</Link>

						<h1 className='text-4xl font-black'>{server.name}</h1>
					</div>
				</div>
				<Button asChild variant='outline'>
					<Link to='/servers'>All Servers</Link>
				</Button>
			</div>

			<div className='flex my-6 gap-4'>
				<div className='flex flex-col gap-2 min-w-40'>
					<ServerStatus server={server} size='xl' />
					{server.status === 'online' && (
						<Button>
							{/* TODO: implement */}
							<OctagonX />
							<p>Stop</p>
						</Button>
					)}
					{server.status === 'online' && (
						<Button variant='secondary'>
							{/* TODO: implement */}
							<RefreshCcw />
							<p>Restart</p>
						</Button>
					)}
					{server.status === 'offline' && (
						<Button>
							{/* TODO: implement */}
							<CircleCheck />
							<p>Start</p>
						</Button>
					)}
				</div>
				<div className='bg-black rounded-xl w-full flex font-mono flex-col'>
					<div className='h-full  px-4 py-2'>
						<p>Hello</p>
						<p>Hello</p>
						<p>Hello</p>
					</div>
					<input className='w-full outline-none border-t border-muted px-4 py-2' placeholder='> test' />
				</div>
			</div>
			<div className='mb-16'>
				<Button variant='secondary'>
					{/* TODO: implement */}
					<Folder />
					<p>Open Folder</p>
				</Button>
				{server.createdAt && (
					<p className='text-sm text-muted-foreground mb-1'>
						Server started {new Date(server.createdAt).toLocaleDateString()}
					</p>
				)}
				{server.ram && <p className='text-sm text-muted-foreground mb-1'>Ram {server.ram}</p>}
			</div>

			<div className='grid gap-10 lg:grid-cols-[1.1fr_1fr]'>
				<div className='flex flex-col gap-1'>
					<div className='flex justify-between gap-5'>
						<div className='flex-col gap-1'>
							<p className='text-3xl font-bold'>Plugins</p>
							<p className='text-muted-foreground'>See and manage the server plugins here.</p>
						</div>
						<Button onClick={() => openUrl('https://modrinth.com/discover/plugins')}>
							Download More
							<ArrowUpRightFromSquare />
						</Button>
					</div>
					<input
						className='bg-input rounded-lg h-10 outline-none border border-border px-4 py-2'
						placeholder='Search...'
					/>
					<div className='flex flex-col gap-4 mt-4'>
						{server.plugins.map((plugin, i) => (
							<Card key={i}>
								<CardHeader className='border-b border-b-border'>
									<CardTitle>{plugin.name ?? plugin.file}</CardTitle>
									<CardDescription className='flex gap-6'>
										{plugin.activated ? (
											<div className='flex items-center font-bold lg:text-lg gap-1 text-green-500'>
												<Check className='size-4' />
												Active
											</div>
										) : (
											<div className='flex items-center font-bold lg:text-lg gap-1 text-red-400'>
												<X className='size-4' />
												Inactive
											</div>
										)}
										{plugin.size && (
											<div className='flex items-center lg:text-lg gap-1'>
												<HardDrive className='size-4' />
												{plugin.size > 100000
													? `${(plugin.size / 1048576).toFixed(2)}TB`
													: plugin.size > 1000
														? `${(plugin.size / 1024).toFixed(2)}GB`
														: `${plugin.size}MB`}
											</div>
										)}
										{plugin.url && (
											<div className='flex items-center lg:text-lg gap-1'>
												<LinkIcon className='size-4' />
												{plugin.url}
											</div>
										)}
									</CardDescription>
								</CardHeader>
								<CardContent className='flex gap-2'>
									<Button variant='secondary'>Open Folder</Button>
									{plugin.activated ? (
										<Button variant='secondary'>Deactivate</Button>
									) : (
										<Button variant='secondary'>Activate</Button>
									)}
									<Button variant='destructive'>Uninstall</Button>
								</CardContent>
							</Card>
						))}
					</div>
				</div>
				<div className='flex flex-col gap-1'>
					<div className='flex justify-between gap-5'>
						<div className='flex-col gap-1'>
							<p className='text-3xl font-bold'>Worlds</p>
							<p className='text-muted-foreground'>See and manage the server worlds here.</p>
						</div>
						<Button onClick={() => openUrl('https://modrinth.com/discover/plugins')}>
							Backup Worlds
							<Archive />
						</Button>
					</div>
					<input
						className='bg-input rounded-lg h-10 outline-none border border-border px-4 py-2'
						placeholder='Search...'
					/>
					<div className='flex flex-col gap-4 mt-4'>
						{server.worlds.map((world, i) => (
							<Card key={i}>
								<CardHeader className='border-b border-b-border'>
									<CardTitle>{world.name ?? world.file}</CardTitle>
									<CardDescription className='flex gap-6'>
										{world.activated ? (
											<div className='flex items-center font-bold lg:text-lg gap-1 text-green-500'>
												<Check className='size-4' />
												Active
											</div>
										) : (
											<div className='flex items-center font-bold lg:text-lg gap-1 text-red-400'>
												<X className='size-4' />
												Inactive
											</div>
										)}
										{world.size && (
											<div className='flex items-center lg:text-lg gap-1'>
												<HardDrive className='size-4' />
												{world.size > 100000
													? `${(world.size / 1048576).toFixed(2)}TB`
													: world.size > 1000
														? `${(world.size / 1024).toFixed(2)}GB`
														: `${world.size}MB`}
											</div>
										)}
									</CardDescription>
									<CardAction></CardAction>
								</CardHeader>
								<CardContent className='flex gap-2'>
									<Button variant='secondary'>Export</Button>
									<Button variant='secondary'>Open Folder</Button>
									{world.activated ? (
										<Button variant='secondary'>Deactivate</Button>
									) : (
										<Button variant='secondary'>Activate</Button>
									)}
									<Button variant='destructive'>Delete</Button>
								</CardContent>
							</Card>
						))}
					</div>
				</div>
				<div className='flex flex-col gap-1'>
					<div className='flex justify-between gap-5'>
						<div className='flex-col gap-1'>
							<p className='text-3xl font-bold'>Datapacks</p>
							<p className='text-muted-foreground'>See and manage the server datapacks here.</p>
						</div>
						<Button onClick={() => openUrl('https://modrinth.com/discover/plugins')}>
							Add More
							<ArrowUpRightFromSquare />
						</Button>
					</div>
					<input
						className='bg-input rounded-lg h-10 outline-none border border-border px-4 py-2'
						placeholder='Search...'
					/>
					<div className='flex flex-col gap-4 mt-4'>
						{server.datapacks.length <= 0 ? (
							<p className='text-xl text-muted-foreground'>No Datapacks were found.</p>
						) : (
							server.datapacks.map((datapack, i) => (
								<Card key={i}>
									<CardHeader className='border-b border-b-border'>
										<CardTitle>{datapack.name ?? datapack.file}</CardTitle>
										<CardDescription>50mb</CardDescription>
										<CardAction></CardAction>
									</CardHeader>
									<CardContent className='flex gap-2'>
										<Button variant='secondary'>Uninstall</Button>
										<Button variant='secondary'>Unload</Button>
										<Button variant='secondary'>Open Folder</Button>
									</CardContent>
								</Card>
							))
						)}
					</div>
				</div>
			</div>
		</main>
	);
};

export default Server;
