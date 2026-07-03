import React from 'react';
import { m } from 'motion/react';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ArrowUpRight, Bug, Github, Lightbulb, MessageCircle, Send } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const DISCORD_INVITE_URL = 'https://discord.gg/v9dA5B5qX4';
const GITHUB_REPO_URL = 'https://github.com/thetimblank/mserve3';

type FeedbackMode = 'bug' | 'feedback';

// Prefill a GitHub issue via query params so whatever the user typed here lands
// straight in the issue body — no server, webhook or secret required.
function buildGithubIssueUrl(title: string, body: string, labels: string): string {
	const params = new URLSearchParams();
	if (title) params.set('title', title);
	if (body) params.set('body', body);
	if (labels) params.set('labels', labels);
	return `${GITHUB_REPO_URL}/issues/new?${params.toString()}`;
}

function buildIssueBody(
	mode: FeedbackMode,
	description: string,
	steps: string,
	environment: string,
): string {
	const sections: string[] = [];
	sections.push(description.trim() || '_Describe it here…_');
	if (mode === 'bug' && steps.trim()) {
		sections.push(`## Steps to reproduce\n${steps.trim()}`);
	}
	sections.push(`## Environment\n${environment}`);
	return sections.join('\n\n');
}

const Feedback: React.FC = () => {
	const [mode, setMode] = React.useState<FeedbackMode>('bug');
	const [description, setDescription] = React.useState('');
	const [steps, setSteps] = React.useState('');
	const [version, setVersion] = React.useState<string | null>(null);

	React.useEffect(() => {
		getVersion()
			.then(setVersion)
			.catch(() => setVersion(null));
	}, []);

	const isBug = mode === 'bug';

	const environment = [
		`- mserve version: ${version ?? 'unknown'}`,
		`- Platform: ${navigator.userAgent}`,
	].join('\n');

	const titlePrefix = isBug ? '[Bug] ' : '[Feedback] ';
	const firstLine = description.trim().split('\n')[0]?.slice(0, 80) ?? '';
	const issueTitle = titlePrefix + firstLine;
	const issueBody = buildIssueBody(mode, description, steps, environment);
	const githubIssueUrl = buildGithubIssueUrl(issueTitle, issueBody, isBug ? 'bug' : 'enhancement');

	const handleOpenGithubIssue = () => void openUrl(githubIssueUrl);
	const handleOpenDiscord = () => void openUrl(DISCORD_INVITE_URL);
	const handleBrowseGithub = () =>
		void openUrl(`${GITHUB_REPO_URL}/${isBug ? 'issues' : 'pulls'}`);

	return (
		<main className='h-full px-12 py-18 w-full overflow-y-auto app-scroll-area'>
			<div className='flex flex-col max-w-3xl'>
				<m.h1
					initial={{ y: 50, opacity: 0 }}
					whileInView={{ y: 0, opacity: 1 }}
					transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
					className='text-3xl flex gap-5 items-center font-black mb-2 w-fit'>
					Feedback &amp; Bug Reports
				</m.h1>
				<m.p
					initial={{ y: 50, opacity: 0 }}
					whileInView={{ y: 0, opacity: 1 }}
					transition={{ type: 'spring', duration: 0.5, delay: 0.05, bounce: 0 }}
					className='text-muted-foreground mb-6'>
					Found a bug or have an idea? Jot it down below and send it straight to GitHub, or
					come chat with us on Discord. Your app version and platform are attached
					automatically so we can reproduce issues faster.
				</m.p>

				<div className='space-y-6'>
					{/* Mode toggle */}
					<m.div
						initial={{ scale: 0.75, y: 10, opacity: 0 }}
						whileInView={{ scale: 1, y: 0, opacity: 1 }}
						transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
						className='inline-flex rounded-lg border p-1 bg-muted/40'>
						<button
							type='button'
							onClick={() => setMode('bug')}
							className={cn(
								'cursor-pointer inline-flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
								isBug
									? 'bg-accent text-accent-foreground'
									: 'text-muted-foreground hover:text-foreground',
							)}>
							<Bug className='w-4 h-4' />
							Report a Bug
						</button>
						<button
							type='button'
							onClick={() => setMode('feedback')}
							className={cn(
								'cursor-pointer inline-flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
								!isBug
									? 'bg-accent text-accent-foreground'
									: 'text-muted-foreground hover:text-foreground',
							)}>
							<Lightbulb className='w-4 h-4' />
							Share Feedback
						</button>
					</m.div>

					<m.div
						key={mode}
						initial={{ scale: 0.75, y: 10, opacity: 0 }}
						whileInView={{ scale: 1, y: 0, opacity: 1 }}
						transition={{ type: 'spring', duration: 0.5, delay: 0.05, bounce: 0 }}>
						<Card>
							<CardHeader>
								<CardTitle className='flex items-center gap-2'>
									{isBug ? <Bug className='w-5 h-5' /> : <Lightbulb className='w-5 h-5' />}
									{isBug ? 'Report a Bug' : 'Share Feedback'}
								</CardTitle>
								<CardDescription>
									{isBug
										? 'Tell us what went wrong. The more detail, the better.'
										: 'Suggest a feature, an improvement, or just tell us what you think.'}
								</CardDescription>
							</CardHeader>
							<CardContent className='space-y-4'>
								<div className='space-y-2'>
									<Label htmlFor='feedback-description'>
										{isBug ? 'What happened?' : 'Your feedback'}
									</Label>
									<Textarea
										id='feedback-description'
										value={description}
										onChange={(e) => setDescription(e.target.value)}
										placeholder={
											isBug
												? 'Describe the bug — what you expected vs. what actually happened.'
												: 'What would make mserve better for you?'
										}
										className='min-h-28'
									/>
								</div>

								{isBug && (
									<div className='space-y-2'>
										<Label htmlFor='feedback-steps'>
											Steps to reproduce{' '}
											<span className='text-muted-foreground font-normal'>(optional)</span>
										</Label>
										<Textarea
											id='feedback-steps'
											value={steps}
											onChange={(e) => setSteps(e.target.value)}
											placeholder={'1. Go to…\n2. Click…\n3. See the error'}
											className='min-h-24'
										/>
									</div>
								)}

								<div className='flex flex-wrap gap-3 pt-1'>
									<Button onClick={handleOpenGithubIssue}>
										<Github className='w-4 h-4' />
										Open a GitHub issue
									</Button>
									<Button variant='outline' onClick={handleOpenDiscord}>
										<MessageCircle className='w-4 h-4' />
										{isBug ? 'Report on Discord' : 'Share on Discord'}
									</Button>
								</div>
								<p className='text-xs text-muted-foreground'>
									The GitHub button opens your browser with the details above pre-filled —
									review and submit there. GitHub issues are public.
								</p>
							</CardContent>
						</Card>
					</m.div>

					{/* Community / links card */}
					<m.div
						initial={{ scale: 0.75, y: 10, opacity: 0 }}
						whileInView={{ scale: 1, y: 0, opacity: 1 }}
						transition={{ type: 'spring', duration: 0.5, delay: 0.1, bounce: 0 }}>
						<Card>
							<CardHeader>
								<CardTitle className='flex items-center gap-2'>
									<Send className='w-5 h-5' />
									Get involved
								</CardTitle>
								<CardDescription>
									Chat with the community, follow development, or browse what others have
									reported.
								</CardDescription>
							</CardHeader>
							<CardContent>
								<div className='flex flex-wrap gap-3'>
									<Button variant='outline' onClick={handleOpenDiscord}>
										<MessageCircle className='w-4 h-4' />
										Join our Discord
									</Button>
									<Button variant='outline' onClick={handleBrowseGithub}>
										<Github className='w-4 h-4' />
										{isBug ? 'Browse open issues' : 'Browse pull requests'}
										<ArrowUpRight className='w-4 h-4' />
									</Button>
								</div>
							</CardContent>
						</Card>
					</m.div>
				</div>
			</div>
		</main>
	);
};

export default Feedback;
