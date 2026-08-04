mod channels;
mod manager;
mod state;

use anyhow::Result;
use clap::Parser;
use crossterm::{
    event::{Event, EventStream, KeyCode, KeyEventKind},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use futures::StreamExt;
use manager::{read_tail, Manager, Probe};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, List, ListItem, Paragraph, Tabs, Wrap},
    Frame, Terminal,
};
use state::NetworkMode;
use std::{
    collections::VecDeque,
    io::{stdout, Stdout},
    path::PathBuf,
    time::Duration,
};
use tokio::time::interval;

#[derive(Parser)]
#[command(
    name = "iora-dev-manager",
    about = "Cross-platform IORA development VM control plane"
)]
struct Args {
    #[arg(long)]
    root: Option<PathBuf>,
    #[arg(long)]
    doctor: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum View {
    Dashboard,
    Vm,
    Services,
    Doctor,
    Logs,
    Help,
}
impl View {
    const ALL: [Self; 6] = [
        Self::Dashboard,
        Self::Vm,
        Self::Services,
        Self::Doctor,
        Self::Logs,
        Self::Help,
    ];
    fn title(self) -> &'static str {
        match self {
            Self::Dashboard => "Dashboard",
            Self::Vm => "VM",
            Self::Services => "Services",
            Self::Doctor => "Doctor",
            Self::Logs => "Logs",
            Self::Help => "Help",
        }
    }
}

struct App {
    manager: Manager,
    probe: Probe,
    view: View,
    tab: usize,
    message: String,
    services: Vec<String>,
    logs: VecDeque<String>,
    qga_command: Option<String>,
}
impl App {
    async fn new(manager: Manager) -> Self {
        let mut app = Self {
            manager,
            probe: Probe::default(),
            view: View::Dashboard,
            tab: 0,
            message: "Control plane initialized".into(),
            services: vec![],
            logs: VecDeque::new(),
            qga_command: None,
        };
        app.refresh().await;
        app
    }
    async fn refresh(&mut self) {
        self.probe = self.manager.probe().await;
        if self.probe.qga {
            if let Ok(value)=self.manager.guest("systemctl list-units --type=service 'iora-*' --all --no-legend --no-pager | awk '{print $1\"  \"$3\"/\"$4}'").await { self.services=value.lines().map(str::to_owned).collect(); }
        }
    }
    fn set_message(&mut self, result: Result<impl Into<String>>) {
        self.message = match result {
            Ok(value) => value.into(),
            Err(error) => format!("Error: {error:#}"),
        };
    }
    async fn key(&mut self, code: KeyCode) -> bool {
        if let Some(mut command) = self.qga_command.take() {
            match code {
                KeyCode::Esc => self.message = "QGA command cancelled".into(),
                KeyCode::Backspace => {
                    command.pop();
                    self.qga_command = Some(command);
                }
                KeyCode::Char(character) => {
                    command.push(character);
                    self.qga_command = Some(command);
                }
                KeyCode::Enter => {
                    let result = self.manager.guest(&command).await;
                    match result {
                        Ok(output) => {
                            self.logs = output.lines().map(str::to_owned).collect();
                            self.view = View::Logs;
                            self.message = format!("QGA command completed: {command}");
                        }
                        Err(error) => self.message = format!("QGA command failed: {error:#}"),
                    }
                }
                _ => self.qga_command = Some(command),
            }
            return false;
        }
        match code {
            KeyCode::Char('q') => return true,
            KeyCode::Tab | KeyCode::Right => {
                self.tab = (self.tab + 1) % View::ALL.len();
                self.view = View::ALL[self.tab];
            }
            KeyCode::BackTab | KeyCode::Left => {
                self.tab = (self.tab + View::ALL.len() - 1) % View::ALL.len();
                self.view = View::ALL[self.tab];
            }
            KeyCode::Char('1') => {
                self.set_message(
                    self.manager
                        .start(NetworkMode::Slirp)
                        .map(|_| "Slirp VM start requested"),
                );
            }
            KeyCode::Char('2') => {
                self.set_message(
                    self.manager
                        .start(NetworkMode::Bridge)
                        .map(|_| "Bridge VM start requested"),
                );
            }
            KeyCode::Char('p') => {
                self.set_message(self.manager.qmp_action("stop").await.map(|_| "VM paused"));
            }
            KeyCode::Char('c') => {
                self.set_message(self.manager.qmp_action("cont").await.map(|_| "VM resumed"));
            }
            KeyCode::Char('r') => {
                self.set_message(
                    self.manager
                        .qmp_action("system_reset")
                        .await
                        .map(|_| "VM reset requested"),
                );
            }
            KeyCode::Char('s') => {
                self.set_message(
                    self.manager
                        .graceful_stop()
                        .await
                        .map(|_| "Graceful shutdown requested"),
                );
            }
            KeyCode::Char('x') => {
                self.set_message(self.manager.hard_stop().map(|_| "VM process terminated"));
            }
            KeyCode::Char('o') => {
                self.set_message(self.manager.open_url().map(|_| "Website opened"));
            }
            KeyCode::Char('a') => {
                disable_raw_mode().ok();
                execute!(stdout(), LeaveAlternateScreen).ok();
                let result = self.manager.open_ssh();
                execute!(stdout(), EnterAlternateScreen).ok();
                enable_raw_mode().ok();
                self.set_message(result.map(|_| "SSH session closed"));
            }
            KeyCode::Char('g') => {
                if self.probe.qga {
                    self.qga_command = Some(String::new());
                    self.message = "Enter a guest command; Escape cancels".into();
                } else {
                    self.message = "QGA is unavailable".into();
                }
            }
            KeyCode::Char('f') => {
                match self.manager.guest("systemctl --failed --no-pager").await {
                    Ok(value) => {
                        self.logs.extend(value.lines().map(str::to_owned));
                        self.message = "Failed-unit diagnosis completed".into();
                    }
                    Err(error) => self.message = format!("Error: {error:#}"),
                };
                self.view = View::Logs;
            }
            KeyCode::Char('h') => {
                self.set_message(
                    self.manager
                        .guest("systemctl restart iora-home && systemctl is-active iora-home")
                        .await
                        .map(|_| "iora-home restarted and validated"),
                );
            }
            KeyCode::Char('l') => {
                let value = self
                    .manager
                    .guest("journalctl -u iora-home -n 150 --no-pager")
                    .await
                    .unwrap_or_else(|_| {
                        read_tail(&self.manager.root.join(".cache/dev-manager.log"), 150)
                    });
                self.logs = value.lines().map(str::to_owned).collect();
                self.view = View::Logs;
            }
            KeyCode::Char('?') => self.view = View::Help,
            _ => {}
        }
        self.refresh().await;
        false
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let manager = Manager::discover(args.root)?;
    let mut app = App::new(manager).await;
    if args.doctor {
        print_doctor(&app);
        std::process::exit(if app.probe.lifecycle() == "Ready" {
            0
        } else {
            1
        });
    }
    enable_raw_mode()?;
    let mut out = stdout();
    execute!(out, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(out);
    let mut terminal = Terminal::new(backend)?;
    let result = run(&mut terminal, &mut app).await;
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    result
}

async fn run(terminal: &mut Terminal<CrosstermBackend<Stdout>>, app: &mut App) -> Result<()> {
    let mut events = EventStream::new();
    let mut tick = interval(Duration::from_secs(3));
    loop {
        terminal.draw(|frame| draw(frame, app))?;
        tokio::select! { _=tick.tick()=>app.refresh().await, event=events.next()=>if let Some(Ok(Event::Key(key)))=event { if key.kind==KeyEventKind::Press && app.key(key.code).await { return Ok(()); } } }
    }
}

fn draw(frame: &mut Frame, app: &App) {
    let area = frame.area();
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(10),
            Constraint::Length(3),
        ])
        .split(area);
    let titles = View::ALL
        .iter()
        .map(|v| Line::from(v.title()))
        .collect::<Vec<_>>();
    frame.render_widget(
        Tabs::new(titles)
            .select(app.tab)
            .highlight_style(
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            )
            .block(
                Block::default()
                    .title(" IORA Dev Manager ")
                    .borders(Borders::ALL),
            ),
        chunks[0],
    );
    match app.view {
        View::Dashboard => dashboard(frame, chunks[1], app),
        View::Vm => vm(frame, chunks[1], app),
        View::Services => services(frame, chunks[1], app),
        View::Doctor => doctor(frame, chunks[1], app),
        View::Logs => logs(frame, chunks[1], app),
        View::Help => help(frame, chunks[1]),
    }
    let footer = if let Some(command) = &app.qga_command {
        Line::from(vec![
            Span::styled(" QGA root command: ", Style::default().fg(Color::Cyan)),
            Span::raw(command),
            Span::styled("_", Style::default().fg(Color::White)),
        ])
    } else {
        Line::from(vec![
            Span::styled(" Status: ", Style::default().fg(Color::DarkGray)),
            Span::raw(&app.message),
            Span::styled(
                "   Tab/Shift-Tab navigate   q quit ",
                Style::default().fg(Color::DarkGray),
            ),
        ])
    };
    frame.render_widget(
        Paragraph::new(footer).block(Block::default().borders(Borders::ALL)),
        chunks[2],
    );
}

fn dashboard(frame: &mut Frame, area: Rect, app: &App) {
    let (host, ssh, home) = app.manager.state.connection();
    let rows = vec![
        line(
            "Lifecycle",
            app.probe.lifecycle(),
            status_color(app.probe.lifecycle() == "Ready"),
        ),
        line(
            "Network",
            &format!("{:?}", app.manager.state.network_mode),
            Color::Cyan,
        ),
        line("VM endpoint", host, Color::White),
        line(
            "SSH",
            &format!("{host}:{ssh} ({})", yes(app.probe.ssh)),
            status_color(app.probe.ssh),
        ),
        line(
            "Website",
            &format!("http://{host}:{home} ({})", yes(app.probe.external_home)),
            status_color(app.probe.external_home),
        ),
        line(
            "QMP / QGA",
            &format!("{} / {}", yes(app.probe.qmp), yes(app.probe.qga)),
            status_color(app.probe.qmp && app.probe.qga),
        ),
        line(
            "Hot reload",
            &app.manager.state.watcher_status,
            Color::Yellow,
        ),
        line("Source sync", &app.manager.state.sync_status, Color::Yellow),
    ];
    frame.render_widget(
        Paragraph::new(rows).block(
            Block::default()
                .title(" Environment ")
                .borders(Borders::ALL),
        ),
        area,
    );
}
fn vm(frame: &mut Frame, area: Rect, app: &App) {
    let text = vec![
        Line::from("VM lifecycle is controlled directly through QMP and QGA."),
        Line::from(""),
        Line::from("1 Start Slirp     2 Start Bridge"),
        Line::from("p Pause           c Continue"),
        Line::from("r Reset           s Graceful shutdown"),
        Line::from("x Hard stop       o Open website"),
        Line::from("a Open SSH        l Home logs"),
        Line::from(""),
        line(
            "PID",
            &app.manager
                .state
                .pid
                .map(|p| p.to_string())
                .unwrap_or_else(|| "-".into()),
            Color::White,
        ),
        line(
            "Disk",
            &app.manager
                .state
                .vm_disk
                .as_ref()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| "-".into()),
            Color::White,
        ),
        line(
            "Firmware",
            app.manager.state.firmware.as_deref().unwrap_or("-"),
            Color::White,
        ),
    ];
    frame.render_widget(
        Paragraph::new(text).block(
            Block::default()
                .title(" Virtual Machine ")
                .borders(Borders::ALL),
        ),
        area,
    );
}
fn services(frame: &mut Frame, area: Rect, app: &App) {
    let items = app
        .services
        .iter()
        .map(|s| {
            ListItem::new(s.as_str()).style(if s.contains("failed") {
                Style::default().fg(Color::Red)
            } else {
                Style::default().fg(Color::Green)
            })
        })
        .collect::<Vec<_>>();
    frame.render_widget(
        List::new(items).block(
            Block::default()
                .title(" Services via QGA   h restart iora-home   f failed units ")
                .borders(Borders::ALL),
        ),
        area,
    );
}
fn doctor(frame: &mut Frame, area: Rect, app: &App) {
    let p = &app.probe;
    let checks = [
        ("QEMU process", p.process),
        ("QMP control", p.qmp),
        ("QGA rescue", p.qga),
        (
            "systemd operational",
            p.systemd == "running" || p.systemd == "degraded",
        ),
        ("Guest network", p.guest_ip.is_some()),
        ("SSH", p.ssh),
        ("iora-home internal", p.internal_home),
        ("iora-home external", p.external_home),
    ];
    let lines = checks
        .into_iter()
        .map(|(name, ok)| line(name, yes(ok), status_color(ok)))
        .collect::<Vec<_>>();
    frame.render_widget(
        Paragraph::new(lines).block(
            Block::default()
                .title(" Live Doctor ")
                .borders(Borders::ALL),
        ),
        area,
    );
}
fn logs(frame: &mut Frame, area: Rect, app: &App) {
    frame.render_widget(
        Paragraph::new(
            app.logs
                .iter()
                .map(|s| Line::from(s.as_str()))
                .collect::<Vec<_>>(),
        )
        .wrap(Wrap { trim: false })
        .block(
            Block::default()
                .title(" Guest / QEMU Logs ")
                .borders(Borders::ALL),
        ),
        area,
    );
}
fn help(frame: &mut Frame, area: Rect) {
    frame.render_widget(Clear, area);
    frame.render_widget(Paragraph::new("IORA Dev Manager is the cross-platform control plane for one development VM.\n\nThe Rust process owns live state reconstruction, QMP, QGA, health, services and the TUI. Existing platform scripts are transitional provisioning backends only. SSH is optional; diagnostics and service operations continue through QGA.\n\nKeys: 1/2 start, p/c pause/resume, r reset, s/x graceful/hard stop, a SSH, g QGA rescue command, o website, f diagnosis, l logs, h restart home, q quit.").wrap(Wrap{trim:false}).block(Block::default().title(" Help ").borders(Borders::ALL)),area);
}
fn line(name: &str, value: &str, color: Color) -> Line<'static> {
    Line::from(vec![
        Span::styled(format!("{name:<22}"), Style::default().fg(Color::DarkGray)),
        Span::styled(value.to_owned(), Style::default().fg(color)),
    ])
}
fn yes(v: bool) -> &'static str {
    if v {
        "OK"
    } else {
        "Unavailable"
    }
}
fn status_color(v: bool) -> Color {
    if v {
        Color::Green
    } else {
        Color::Red
    }
}
fn print_doctor(app: &App) {
    println!("IORA Dev Doctor\nStatus: {}\nQEMU: {}\nQMP: {}\nQGA: {}\nSSH: {}\nHome internal: {}\nHome external: {}",app.probe.lifecycle(),yes(app.probe.process),yes(app.probe.qmp),yes(app.probe.qga),yes(app.probe.ssh),yes(app.probe.internal_home),yes(app.probe.external_home));
}
