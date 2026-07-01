//! OS process plumbing that keeps server processes tied to mserve's own
//! lifetime and lets us act on processes we didn't spawn.
//!
//! * **Job object** (Windows): every child we spawn is assigned to a single
//!   kill-on-close job. If mserve dies for *any* reason — task manager "End
//!   task", a crash, `std::process::exit` — the OS closes the job handle and
//!   terminates every server (and its whole subtree) with it. This is what
//!   guarantees no orphaned `java.exe` keeps squatting on a port after mserve
//!   goes away.
//! * **Port → PID lookup + tree kill**: for adopted (externally started)
//!   servers we own no `Child` handle, so force-kill resolves the PID that is
//!   actually listening on the server's port and terminates that tree.

use super::core::no_window_command;
use std::process::Child;

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

#[cfg(not(windows))]
pub(in crate::app) fn tie_child_to_app_lifetime(_child: &Child) {}

/// Resolves the PID of the process listening on local TCP `port`, if any.
/// Windows-only (netstat); returns `None` elsewhere.
pub(in crate::app) fn pid_listening_on_port(port: u16) -> Option<u32> {
    #[cfg(not(windows))]
    {
        let _ = port;
        None
    }

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

    #[cfg(not(windows))]
    {
        no_window_command("kill")
            .args(["-9", &pid.to_string()])
            .output()
            .map_err(|err| err.to_string())
            .map(|_| ())
    }
}
