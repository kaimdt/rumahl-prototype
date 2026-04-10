//! System command execution module.
//!
//! Handles execution of system-level commands received from Home Assistant:
//! - Shutdown
//! - Reboot
//! - Sleep/Suspend
//! - Lock screen
//! - Hibernate
//! - etc.

use anyhow::Result;
use std::process::Command;

#[derive(Debug, Clone)]
pub enum SystemCommand {
    Shutdown,
    Reboot,
    Sleep,
    Hibernate,
    Lock,
    LogOut,
}

impl SystemCommand {
    pub fn from_string(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "shutdown" | "poweroff" => Some(Self::Shutdown),
            "reboot" | "restart" => Some(Self::Reboot),
            "sleep" | "suspend" => Some(Self::Sleep),
            "hibernate" => Some(Self::Hibernate),
            "lock" => Some(Self::Lock),
            "logout" | "logoff" => Some(Self::LogOut),
            _ => None,
        }
    }
}

/// Execute a system command
pub fn execute_system_command(cmd: SystemCommand) -> Result<()> {
    tracing::info!("Executing system command: {:?}", cmd);

    #[cfg(target_os = "windows")]
    {
        execute_windows_command(cmd)?;
    }

    #[cfg(target_os = "linux")]
    {
        execute_linux_command(cmd)?;
    }

    #[cfg(target_os = "macos")]
    {
        execute_macos_command(cmd)?;
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn execute_windows_command(cmd: SystemCommand) -> Result<()> {
    match cmd {
        SystemCommand::Shutdown => {
            Command::new("shutdown")
                .args(["/s", "/t", "0"])
                .spawn()?;
        }
        SystemCommand::Reboot => {
            Command::new("shutdown")
                .args(["/r", "/t", "0"])
                .spawn()?;
        }
        SystemCommand::Sleep => {
            // Use rundll32 to call powrprof.dll
            Command::new("rundll32.exe")
                .args(["powrprof.dll,SetSuspendState", "0,1,0"])
                .spawn()?;
        }
        SystemCommand::Hibernate => {
            Command::new("shutdown")
                .args(["/h"])
                .spawn()?;
        }
        SystemCommand::Lock => {
            Command::new("rundll32.exe")
                .args(["user32.dll,LockWorkStation"])
                .spawn()?;
        }
        SystemCommand::LogOut => {
            Command::new("shutdown")
                .args(["/l"])
                .spawn()?;
        }
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn execute_linux_command(cmd: SystemCommand) -> Result<()> {
    match cmd {
        SystemCommand::Shutdown => {
            // Try systemctl first, fall back to shutdown command
            if Command::new("systemctl").arg("poweroff").spawn().is_err() {
                Command::new("shutdown").args(["-h", "now"]).spawn()?;
            }
        }
        SystemCommand::Reboot => {
            if Command::new("systemctl").arg("reboot").spawn().is_err() {
                Command::new("shutdown").args(["-r", "now"]).spawn()?;
            }
        }
        SystemCommand::Sleep => {
            Command::new("systemctl").arg("suspend").spawn()?;
        }
        SystemCommand::Hibernate => {
            Command::new("systemctl").arg("hibernate").spawn()?;
        }
        SystemCommand::Lock => {
            // Try different lock commands based on desktop environment
            if Command::new("loginctl").arg("lock-session").spawn().is_err() {
                if Command::new("xdg-screensaver").arg("lock").spawn().is_err() {
                    Command::new("gnome-screensaver-command")
                        .arg("--lock")
                        .spawn()?;
                }
            }
        }
        SystemCommand::LogOut => {
            Command::new("loginctl")
                .arg("terminate-session")
                .arg("")
                .spawn()?;
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn execute_macos_command(cmd: SystemCommand) -> Result<()> {
    match cmd {
        SystemCommand::Shutdown => {
            Command::new("osascript")
                .args(["-e", "tell app \"System Events\" to shut down"])
                .spawn()?;
        }
        SystemCommand::Reboot => {
            Command::new("osascript")
                .args(["-e", "tell app \"System Events\" to restart"])
                .spawn()?;
        }
        SystemCommand::Sleep => {
            Command::new("pmset").args(["sleepnow"]).spawn()?;
        }
        SystemCommand::Hibernate => {
            // macOS doesn't have traditional hibernate, use deep sleep
            Command::new("pmset").args(["sleepnow"]).spawn()?;
        }
        SystemCommand::Lock => {
            Command::new("/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession")
                .arg("-suspend")
                .spawn()?;
        }
        SystemCommand::LogOut => {
            Command::new("osascript")
                .args(["-e", "tell app \"System Events\" to log out"])
                .spawn()?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_command_parsing() {
        assert!(matches!(
            SystemCommand::from_string("shutdown"),
            Some(SystemCommand::Shutdown)
        ));
        assert!(matches!(
            SystemCommand::from_string("reboot"),
            Some(SystemCommand::Reboot)
        ));
        assert!(matches!(
            SystemCommand::from_string("sleep"),
            Some(SystemCommand::Sleep)
        ));
        assert!(SystemCommand::from_string("invalid").is_none());
    }
}
