# mserve

a webapp tool that helps manage and setup minecraft servers easily with full customizations.

mserve is a Tauri + React desktop app for end-to-end Minecraft server management: it lets users create or import servers, run a guided setup flow (directory, jar, RAM, backups, auto-restart), control server runtime with start/stop/restart plus terminal access, manage server contents (plugins, worlds, datapacks, backups, provider-aware settings), run a Java compatibility guide that detects installed runtimes and checks them against server requirements, and use a hosting setup wizard for firewall/port-forwarding and connection basics; it also includes data repair/sync for mserve.json and in-app update handling.

## Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Releasing OTA updates

This project now uses the Tauri updater plugin.

## 1) Version bump rule

Always bump app version before building a release:

- `package.json` -> `version`
- `src-tauri/Cargo.toml` -> `version`
- `src-tauri/tauri.conf.json` -> `version`

Use the same semantic version across all three files.

## 2) Build release artifacts

```bash
npm install
npm run release:build
```

## 3) Where to publish

Publish to your repository Releases page:

- <https://github.com/thetimblank/mserve3/releases>

Create a release tag like `v3.3.0`, then upload all files above as assets.

With your updater endpoint, users will always read `latest.json` from the latest release asset URL.

## Roadmap

### Version

**Stable versions:**
v(major feature update).(minor feature update).(patch/fix update)
e.g. v3.3.0

**Unstable Versions:**
v(major feature update).(minor feature update).(patch/fix update)pre(subpatch/fix)
e.g. v4.0.12pre0

### Checklist

(May not be up-to-date)
**v3**
Big
✅ OTA updates
✅ read from mserve.json
✅ rewrite & cleanup of backend code.
✅ splash screen
✅ inform user about proper java versions
✅ inform user & read minecraft settings (properties, ops, whitelist, etc.)
✅ motd generator
✅ auto fetch provider server jars [BETA]
🟨 better explaination of hosting setup and integrate with server specific ports/ip
⬛ Please add a complete and thourough system to test. Testing should cover all types of starting, stopping, different versions, custom jars, modded servers, telementry, etc. Think about what else testing should cover. It should be robust and actually valuable to catch bugs from and run before prod after each change, it should be scalable. Help me out here, because i am not too familiar with testing, so what is good here? Ask questions as needed.
⬛ Please add a update server that will automatically also check if there is an update available for servers. Add an option to disable this in global settings. It should check for updates on each server when mserve loads, do not notify the user, simply add an update available text in each server's jar section and a check for updates button. (Use the same/similar UI to the apps overall updater). If it changes a major MC version, please warn the user before updating (after clicking the update button) that this may have unwanted effects that include data loss or corruption. To this modal add a cancel button, proceed button, and a backup & proceed button. Think of anything else that could be good here. Ask questions as needed.
⬛ Please add developer & AI friendly docs. Analayze the project for help and ask me for help as needed! You can also ask for design choices! Please make things like a claude.md file (if needed) and fully optimize this project for a claude workflow. (If im missing anything big)
⬛ Please add a user-friendly focused onboarding/welcome screen. Lay it out as slides. Subjects that need to be covered [not in order]:

1. Advanced or Beginner/Intermediate? (user.advanced mode)
2. Theme
3. Anything else you can think of

Small
⬛ When java version is set as automatic, and the java version isnt detected
⬛ --nogui is sticky the first time and doesn't appear in the settings, until changed.
⬛ Please let users rename servers, this should also rename the folder they are stored in.
⬛ Fix motd not working. Users Cannot save file once the MOTD is changed.
⬛ "Shutdown all servers and close app does not work, all servers just keep running and this error triggers in console "[0624/121402.697:ERROR:ui\gfx\win\window_impl.cc:172] Failed to unregister class Chrome_WidgetWin_0. Error = 1412". They obviously force shutdown though
⬛ Remember window size
⬛ Smart networking: When start server alone, it will change port. Also display IP & port per server. Let users either start just alone or with network when it is within a network. Also Fix IP showing local IP, always show public. (This bug occurs on the setup hosting page.)

1. Remove the cards where ther is no data available (E.g. TPS card on servers that dont support TPS).
2. On advanced mode display ram as XX.X% ...mb/...mb rather than just the XX.X%

---

There are a some issues, please fix these (Note, if i mention the same server name/type multiple times, it is the same server):

1. RCON shuts down repeatedly every 5 seconds on some versions (especially newer ones) incorrect info is pulled.

[INCORRECT]Tested on Paper 26.2 4gb clean slate server.
(TPS was 1.0 constant which is incorrect as it was 20, note this may be because RCON didnt work.).
Console log:
[stdout] [11:11:45 INFO]: Done (10.251s)! For help, type "help"
[stdout] [11:11:45 INFO]: **\*\*\*\***\*\*\*\***\*\*\*\***\*\***\*\*\*\***\*\*\*\***\*\*\*\***\***\*\*\*\***\*\*\*\***\*\*\*\***\*\***\*\*\*\***\*\*\*\***\*\*\*\***
[stdout] [11:11:45 INFO]: This is the first time you're starting this server.
[stdout] [11:11:45 INFO]: It's recommended you read our 'Getting Started' documentation for guidance.
[stdout] [11:11:45 INFO]: View this and more helpful information here: https://docs.papermc.io/paper/next-steps
[stdout] [11:11:45 INFO]: **\*\*\*\***\*\*\*\***\*\*\*\***\*\***\*\*\*\***\*\*\*\***\*\*\*\***\***\*\*\*\***\*\*\*\***\*\*\*\***\*\***\*\*\*\***\*\*\*\***\*\*\*\***
[stdout] [11:11:49 INFO]: Thread RCON Client /127.0.0.1 started
[stdout] [11:11:49 INFO]: Thread RCON Client /127.0.0.1 shutting down
[stdout] [11:11:54 INFO]: Thread RCON Client /127.0.0.1 started
[stdout] [11:11:54 INFO]: Thread RCON Client /127.0.0.1 shutting down
[stdout] [11:11:59 INFO]: Thread RCON Client /127.0.0.1 started
[stdout] [11:11:59 INFO]: Thread RCON Client /127.0.0.1 shutting down

[INCORRECT] Tested on Folia 1.21.11 4gb clean slate server.
(TPS did not load at all even though folia supports tps, note this may be because RCON didnt work.).
Console log:
[stdout] [11:20:42 INFO]: Done preparing level "world" (2.999s)
[stdout] [11:20:42 INFO]: [spark] The spark plugin has been preferred but was not loaded. The bundled spark profiler will enabled instead.
[stdout] [11:20:42 INFO]: [spark] The spark profiler will not be enabled because it is currently disabled in the configuration.
[stdout] [11:20:42 INFO]: Starting remote control listener
[stdout] [11:20:42 INFO]: Thread RCON Listener started
[stdout] [11:20:42 INFO]: RCON running on 0.0.0.0:60154
[stdout] [11:20:42 INFO]: Done (12.447s)! For help, type "help"
[stdout] [11:20:46 INFO]: Thread RCON Client /127.0.0.1 started
[stdout] [11:20:46 INFO]: Thread RCON Client /127.0.0.1 shutting down

[INCORRECT] Tested on Vanilla 26.2 2gb clean slate server.
(TPS worked correctly, RAM was incorrect [Task manager value].)
Consloe log:
[stdout] [12:25:56] [Server thread/INFO]: Done (1.711s)! For help, type "help"
[stdout] [12:25:56] [Server thread/INFO]: Starting remote control listener
[stdout] [12:25:56] [Server thread/INFO]: Thread RCON Listener started
[stdout] [12:25:56] [Server thread/INFO]: RCON running on 0.0.0.0:64026
...
[stdout] [12:26:01] [RCON Listener #1/INFO]: Thread RCON Client /127.0.0.1 started
[stdout] [12:26:01] [RCON Client /127.0.0.1 #2/INFO]: Thread RCON Client /127.0.0.1 shutting down
[stdout] [12:26:06] [RCON Listener #1/INFO]: Thread RCON Client /127.0.0.1 started
[stdout] [12:26:06] [RCON Client /127.0.0.1 #3/INFO]: Thread RCON Client /127.0.0.1 shutting down

[CORRECT] Tested on Vanilla 1.12 2gb clean slate server.
(TPS incorrect (No value detected), RAM was incorrect [Task manager value].)
Console log:
[stdout] [12:28:31] [Server thread/INFO]: Done (0.856s)! For help, type "help" or "?"
[stdout] [12:28:31] [Server thread/INFO]: Starting remote control listener
[stdout] [12:28:31] [RCON Listener #1/INFO]: RCON running on 0.0.0.0:50968
[stdout] [12:28:31] [RCON Listener #1/INFO]: Rcon connection from: /127.0.0.1

2. RAM usage is not correct and uses the task manager RAM usage instead of the ingame one for non-proxies.
   It seems there are mainly 2 cases:
   a) Ram way too low at about 10mb while ram was supposed to be at about 700-800 (Vanilla 26.2, Paper 26.2)
   b) Ram way too high at over 1gb [same value as taskmgr shows] while ram was supposed to be at about 700-800 (Folia 1.21.11, Vanilla 1.12 [note this was suppoed so be 60mb, and taskmgr said 500, which mserve reported as well, still validates this case], Velocity 3.5s and 3.4 [Note, for proxies i couldn't check actual value, but taskmgr reported the same as mserve, so it is either correct or this case])

   [INCORRECT] Tested on Folia 1.21.11 4gb clean slate server.
   Average MB (From the default java --gui) was about 700 with 80% free
   Reported MB by mserve was 34% with 1.37GB
   Task manager reported the same as MSERVE

[INCORRECT] Tested on Paper 26.2 4gb clean slate server.
Average MB (From the default java --gui) was about 700 with 80% free
Reported MB by mserve was 0% with 10MB
Task manager reported about 1800mb.

[INCORRECT] Tested on Vanilla 1.12, ram was reported by task mgr and mserve at 500 even though --gui reported about 60mb.

[INCORRECT] Tested on Vanilla 26.2, ram was about 800 on avg on --gui, but mserve reported 10mb, task mgr reported about 1.1gb

[UNKNOWN] Tested on Velocity 3.4 1gb clean slate server. Average MB by taskmgr was 180mb and reported by mserve was 180mb
[UNKNOWN] Tested on Velocity 3.5.0snapshot 1gb clean slate server. Average MB by taskmgr was 160mb and reported by mserve was 180mb

3. TPS usage is incorrect or doesnt work as mentioned earlier.
   [INCORRECT] Tested on Vanilla 1.12, --gui mentions "Avg Tick: 0.132ms" (or similar) but TPS is empty
   [CORRECT] Tested on Vanilla 26.2, --gui mentions 20 TPS (or similar) and TPS is reported as 20 in mserve (Note that, this server also had the rcon disconnect bug and incorrect ram [way too little memory usage])

4. ONLY on a fresh launch of the app, once ANY server is started, ALL servers appear ONLINE, and some statistics carry over.
   [INCORRECT] Tested by starting a clean slate server "A", then simply clicking on a different server "B", which showed as online and had some of the same stats as "A" (E.g. Player count 500, Uptime, NOT CPU, NOT RAM) This same thing happened when clicking on the "C" or "D" (just other servers). Once "stopping" all of the servers, it worked correctly.

Supported Providers
Test & support all providers thoroughly
🟨 Velocity
🟨 Paper
🟨 Folia
🟨 Vanilla

**v4**
⬛ linux support!!!
⬛ setup networks and server groups
⬛ major cleanup of backend (rust & typescript) code/performance optimizations, simple and reusable, delete uneeded normalizations, etc.
⬛ add tab completion to terminal
⬛ add graphs & data on players, uptime %, ram usage, cpu usage
⬛ rehaul UI
⬛ advanced statistics systems (plugins, etc to track stats instead of v3 system)

Supported Providers
⬛ Modded servers
⬛ Spigot
⬛ Bungee

**Future**
⬛ change plugin settings?
⬛ accounts and remote start on website?
