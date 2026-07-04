//! OS process plumbing that keeps server processes tied to mserve's own
//! lifetime and lets us act on processes we didn't spawn.
//!
//! * **Job object** (Windows): every child we spawn is assigned to a single
//!   kill-on-close job. If mserve dies for *any* reason — task manager "End
//!   task", a crash, `std::process::exit` — the OS closes the job handle and
//!   terminates every server (and its whole subtree) with it. This is what
//!   guarantees no orphaned `java.exe` keeps squatting on a port after mserve
//!   goes away.
//! * **Process groups + exit hooks** (Unix): every child we spawn gets its own
//!   process group (see [`isolate_in_own_process_group`]) and its pgid is
//!   recorded in a signal-safe registry. An `atexit` hook plus SIGTERM/SIGINT/
//!   SIGHUP handlers SIGKILL every registered group, so a normal quit,
//!   `std::process::exit`, or a `kill <mserve>` never orphans a server. Unlike
//!   the Windows job object this cannot survive `SIGKILL` of mserve itself —
//!   that one case can leave a server running (best-effort, documented).
//! * **Port → PID lookup + tree kill**: for adopted (externally started)
//!   servers we own no `Child` handle, so force-kill resolves the PID that is
//!   actually listening on the server's port and terminates that tree.

#[cfg(any(windows, all(unix, not(target_os = "linux"))))]
use super::core::no_window_command;
use std::process::{Child, Command};

/// Ties `child` to mserve's lifetime. Best-effort: if the job can't be created
/// or the assignment fails we still run the server, we just lose the
/// die-with-the-app guarantee.
#[cfg(windows)]
pub(in crate::app) fn tie_child_to_app_lifetime(child: &Child) {
    use std::os::windows::io::AsRawHandle;
    use std::sync::OnceLock;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject,
    };

    /// The app-lifetime job handle. Intentionally never closed: the OS closes
    /// it when the mserve process terminates, which is exactly the trigger for
    /// KILL_ON_JOB_CLOSE.
    struct JobHandle(isize);
    // SAFETY: a job object handle is a kernel handle; using it from multiple
    // threads for AssignProcessToJobObject is supported by the API.
    unsafe impl Send for JobHandle {}
    unsafe impl Sync for JobHandle {}

    static APP_JOB: OnceLock<Option<JobHandle>> = OnceLock::new();

    let job = APP_JOB.get_or_init(|| unsafe {
        let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if handle.is_null() {
            return None;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = SetInformationJobObject(
            handle,
            JobObjectExtendedLimitInformation,
            std::ptr::from_ref(&info).cast(),
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if ok == 0 {
            windows_sys::Win32::Foundation::CloseHandle(handle);
            return None;
        }
        Some(JobHandle(handle as isize))
    });

    if let Some(job) = job {
        unsafe {
            AssignProcessToJobObject(job.0 as _, child.as_raw_handle());
        }
    }
}

#[cfg(unix)]
pub(in crate::app) fn tie_child_to_app_lifetime(child: &Child) {
    unix_lifetime::track_process_group(child.id());
}

#[cfg(not(any(windows, unix)))]
pub(in crate::app) fn tie_child_to_app_lifetime(_child: &Child) {}

/// Configures `command` so the spawned child (and everything it spawns) can be
/// signalled as one unit. On Unix this puts the child in its own process group
/// (pgid = its pid), which [`kill_process_tree`] and the exit hooks rely on.
/// No-op on Windows, where the job object plays this role.
pub(in crate::app) fn isolate_in_own_process_group(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(not(unix))]
    {
        let _ = command;
    }
}

/// SIGKILLs the child's whole process group on Unix. `Child::kill` only signals
/// the direct process, so anything the server spawned would survive; the child
/// was made its own group leader by [`isolate_in_own_process_group`]. No-op on
/// Windows, where the job object / `taskkill /T` covers the subtree.
pub(in crate::app) fn kill_child_process_group(child: &Child) {
    #[cfg(unix)]
    if let Ok(pgid) = i32::try_from(child.id()) {
        unsafe {
            libc::kill(-pgid, libc::SIGKILL);
        }
    }
    #[cfg(not(unix))]
    {
        let _ = child;
    }
}

/// Signal-safe registry of the process groups mserve spawned, killed as a whole
/// when mserve exits. Fixed-size atomics only: the cleanup runs inside `atexit`
/// and signal handlers, where allocation and locks are off-limits.
#[cfg(unix)]
mod unix_lifetime {
    use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};

    const MAX_TRACKED: usize = 256;
    static TRACKED_PGIDS: [AtomicI32; MAX_TRACKED] = [const { AtomicI32::new(0) }; MAX_TRACKED];
    static HOOKS_INSTALLED: AtomicBool = AtomicBool::new(false);

    pub(super) fn track_process_group(pid: u32) {
        install_exit_hooks_once();

        let Ok(pgid) = i32::try_from(pid) else {
            return;
        };

        for slot in &TRACKED_PGIDS {
            let current = slot.load(Ordering::Relaxed);
            // Take an empty slot, or recycle one whose group no longer exists
            // (signal 0 = liveness probe) so long sessions don't exhaust slots.
            let free = current == 0 || (current > 0 && unsafe { libc::kill(-current, 0) } != 0);
            if free
                && slot
                    .compare_exchange(current, pgid, Ordering::SeqCst, Ordering::Relaxed)
                    .is_ok()
            {
                return;
            }
        }
    }

    /// SIGKILLs every registered process group. Async-signal-safe: touches only
    /// atomics and `kill(2)`.
    extern "C" fn kill_tracked_groups() {
        for slot in &TRACKED_PGIDS {
            let pgid = slot.load(Ordering::Relaxed);
            if pgid > 0 {
                unsafe {
                    libc::kill(-pgid, libc::SIGKILL);
                }
            }
        }
    }

    extern "C" fn terminating_signal_handler(_signal: libc::c_int) {
        kill_tracked_groups();
        unsafe {
            libc::_exit(0);
        }
    }

    fn install_exit_hooks_once() {
        if HOOKS_INSTALLED.swap(true, Ordering::SeqCst) {
            return;
        }
        unsafe {
            libc::atexit(kill_tracked_groups);
            for signal in [libc::SIGTERM, libc::SIGINT, libc::SIGHUP] {
                libc::signal(
                    signal,
                    terminating_signal_handler as *const () as libc::sighandler_t,
                );
            }
        }
    }
}

/// Resolves the PID of the process listening on local TCP `port`, if any.
pub(in crate::app) fn pid_listening_on_port(port: u16) -> Option<u32> {
    #[cfg(windows)]
    {
        let output = no_window_command("netstat")
            .args(["-ano", "-p", "TCP"])
            .output()
            .ok()?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let suffix = format!(":{port}");

        for line in stdout.lines() {
            // "  TCP  0.0.0.0:25565  0.0.0.0:0  LISTENING  12345"
            let mut columns = line.split_whitespace();
            let (Some("TCP"), Some(local), _, Some("LISTENING"), Some(pid)) = (
                columns.next(),
                columns.next(),
                columns.next(),
                columns.next(),
                columns.next(),
            ) else {
                continue;
            };
            if local.ends_with(&suffix) {
                return pid.parse::<u32>().ok().filter(|pid| *pid > 4);
            }
        }
        None
    }

    #[cfg(target_os = "linux")]
    {
        let inodes = linux_proc::listening_socket_inodes(port);
        if inodes.is_empty() {
            return None;
        }
        linux_proc::pid_owning_socket_inode(&inodes)
    }

    #[cfg(target_os = "macos")]
    {
        let output = no_window_command("lsof")
            .args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN", "-t"])
            .output()
            .ok()?;
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .find_map(|line| line.trim().parse::<u32>().ok())
    }

    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = port;
        None
    }
}

/// Force-terminates `pid` and its whole child tree. Best-effort.
pub(in crate::app) fn kill_process_tree(pid: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        let output = no_window_command("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output()
            .map_err(|err| err.to_string())?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
        }
    }

    #[cfg(unix)]
    {
        let target = i32::try_from(pid).map_err(|_| format!("PID {pid} is out of range."))?;

        // Collect descendants before killing anything — a dead parent reparents
        // its children to init and they'd escape the walk.
        let descendants = descendant_pids(pid);

        unsafe {
            // The group first (covers everything we spawned; pgid == pid), then
            // each process individually for adopted trees that aren't their own
            // group leader.
            libc::kill(-target, libc::SIGKILL);
            for descendant in descendants {
                if let Ok(descendant) = i32::try_from(descendant) {
                    libc::kill(descendant, libc::SIGKILL);
                }
            }
            libc::kill(target, libc::SIGKILL);
        }

        // SIGKILL cannot be blocked; a target that still shows up afterwards is
        // an unreaped zombie, which no longer holds the port. Treat delivery as
        // success — this mirrors the "best-effort" contract of the doc comment.
        Ok(())
    }

    #[cfg(not(any(windows, unix)))]
    {
        let _ = pid;
        Err("Killing a process tree is not supported on this platform.".to_string())
    }
}

/// PIDs of every (transitive) child of `pid`.
#[cfg(target_os = "linux")]
fn descendant_pids(pid: u32) -> Vec<u32> {
    linux_proc::descendant_pids(pid)
}

/// Non-Linux Unix (macOS): walk children via `pgrep -P` since /proc is absent.
#[cfg(all(unix, not(target_os = "linux")))]
fn descendant_pids(pid: u32) -> Vec<u32> {
    let mut result = Vec::new();
    let mut queue = vec![pid];

    while let Some(parent) = queue.pop() {
        let Ok(output) = no_window_command("pgrep")
            .args(["-P", &parent.to_string()])
            .output()
        else {
            continue;
        };
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            if let Ok(child) = line.trim().parse::<u32>()
                && !result.contains(&child)
            {
                result.push(child);
                queue.push(child);
            }
        }
    }

    result
}

/// /proc-based helpers: socket-inode lookup for port→PID resolution and a
/// ppid map for descendant walks. No external tools, works on every distro.
#[cfg(target_os = "linux")]
mod linux_proc {
    use std::collections::HashMap;
    use std::fs;
    use std::path::Path;

    /// Kernel socket inodes listening on local TCP `port` (IPv4 + IPv6).
    /// `/proc/net/tcp*` rows: `sl local_address rem_address st ... inode`,
    /// where `local_address` is `HEXADDR:HEXPORT` and st `0A` = LISTEN.
    pub(super) fn listening_socket_inodes(port: u16) -> Vec<u64> {
        let port_hex = format!("{port:04X}");
        let mut inodes = Vec::new();

        for table in ["/proc/net/tcp", "/proc/net/tcp6"] {
            let Ok(content) = fs::read_to_string(table) else {
                continue;
            };
            for line in content.lines().skip(1) {
                let mut columns = line.split_whitespace();
                let (Some(_sl), Some(local), Some(_remote), Some(state)) = (
                    columns.next(),
                    columns.next(),
                    columns.next(),
                    columns.next(),
                ) else {
                    continue;
                };
                if state != "0A" || !local.ends_with(&format!(":{port_hex}")) {
                    continue;
                }
                // Remaining columns: tx_queue:rx_queue tr:tm->when retrnsmt uid
                // timeout inode — inode is the 6th of those.
                if let Some(inode) = columns.nth(5).and_then(|value| value.parse::<u64>().ok()) {
                    inodes.push(inode);
                }
            }
        }

        inodes
    }

    /// Scans `/proc/<pid>/fd` symlinks for `socket:[<inode>]` to find which
    /// process owns one of `inodes`. Only readable for same-user processes,
    /// which covers every server mserve manages.
    pub(super) fn pid_owning_socket_inode(inodes: &[u64]) -> Option<u32> {
        let targets: Vec<String> = inodes
            .iter()
            .map(|inode| format!("socket:[{inode}]"))
            .collect();

        for entry in fs::read_dir("/proc").ok()?.flatten() {
            let name = entry.file_name();
            let Some(pid) = name.to_str().and_then(|value| value.parse::<u32>().ok()) else {
                continue;
            };

            let fd_dir = Path::new("/proc").join(pid.to_string()).join("fd");
            let Ok(fds) = fs::read_dir(&fd_dir) else {
                continue;
            };
            for fd in fds.flatten() {
                if let Ok(link) = fs::read_link(fd.path())
                    && let Some(link) = link.to_str()
                    && targets.iter().any(|target| target == link)
                {
                    return Some(pid);
                }
            }
        }

        None
    }

    /// Transitive children of `pid` via one pass over `/proc/*/stat` ppids.
    pub(super) fn descendant_pids(pid: u32) -> Vec<u32> {
        let mut children_of: HashMap<u32, Vec<u32>> = HashMap::new();

        let Ok(entries) = fs::read_dir("/proc") else {
            return Vec::new();
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(child) = name.to_str().and_then(|value| value.parse::<u32>().ok()) else {
                continue;
            };
            let Ok(stat) = fs::read_to_string(entry.path().join("stat")) else {
                continue;
            };
            // stat: `pid (comm) state ppid …` — comm may contain spaces and
            // parens, so parse from after the *last* ')'.
            let Some((_, after_comm)) = stat.rsplit_once(')') else {
                continue;
            };
            let Some(ppid) = after_comm
                .split_whitespace()
                .nth(1)
                .and_then(|value| value.parse::<u32>().ok())
            else {
                continue;
            };
            children_of.entry(ppid).or_default().push(child);
        }

        let mut result = Vec::new();
        let mut queue = vec![pid];
        while let Some(parent) = queue.pop() {
            if let Some(children) = children_of.get(&parent) {
                for &child in children {
                    if !result.contains(&child) {
                        result.push(child);
                        queue.push(child);
                    }
                }
            }
        }
        result
    }
}
