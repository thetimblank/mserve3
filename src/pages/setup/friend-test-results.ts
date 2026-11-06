/** What a friend's Minecraft client shows when they try to join, and what it means. */
export type FriendTestResult = {
	/** What the friend sees. */
	sees: string;
	/** What it means for the setup. */
	means: string;
	/** What to check or do next. */
	next: string;
	/** True when the network part works and the problem is elsewhere. */
	networkWorks?: boolean;
};

export const FRIEND_TEST_RESULTS: readonly FriendTestResult[] = [
	{
		sees: 'The server appears with its MOTD and ping bars',
		means: 'It works.',
		next: 'Nothing to fix. They can join.',
		networkWorks: true,
	},
	{
		sees: '"Can\'t connect to server" or "Connection timed out"',
		means: "The request isn't reaching this PC.",
		next: 'Check the router forward (TCP, pointing at this PC\'s local IP) and the PC firewall. CGNAT or an internet provider that blocks the port also causes this. The tunnel works around all of these.',
	},
	{
		sees: '"Connection refused"',
		means: "It reached a device, but nothing is listening on that port.",
		next: 'Check that the server is online (not still starting), that the port is right, and that the forward points at this PC and not another device.',
	},
	{
		sees: '"Unknown host"',
		means: "The address can't be found.",
		next: 'Check the address for typos. A new custom domain can take a while to start working.',
	},
	{
		sees: '"Not whitelisted", "Failed to verify username", or "Outdated client/server"',
		means: 'The network works.',
		next: 'It is a server setting (whitelist, online mode) or a version mismatch between the game and the server.',
		networkWorks: true,
	},
];

/** Ways a test can fail or pass for the wrong reason. */
export const FRIEND_TEST_FALSE_RESULTS: readonly string[] = [
	'Your friend is on your Wi-Fi: that tests the local path, not the internet.',
	"Testing your own public IP from this PC: many routers don't loop it back, so it can fail (or pass) misleadingly.",
	'Checked too early: the server was still starting, or the router had not applied the rule yet (some need a restart).',
	'A stale server list: press Refresh in Multiplayer.',
	'Your public IP changed since you shared it.',
	'A VPN on either side.',
	'A wrong port typed after the address.',
];
