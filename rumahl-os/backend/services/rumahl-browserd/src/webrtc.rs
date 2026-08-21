//! WebRTC render session (GStreamer webrtcbin, gst-rs bindings).
//!
//! Pipeline (sendonly):
//!   appsrc(image/jpeg) -> jpegdec -> videoconvert -> vp8enc -> rtpvp8pay
//!   -> webrtcbin
//!
//! The service feeds CDP screencast JPEG frames into `appsrc`; the browser
//! receives VP8 over WebRTC. Signaling is non-blocking trickle:
//!
//!   service -> session: offer SDP  (start())
//!   session -> service: answer SDP + local ICE candidates (events)
//!   service -> session: remote ICE candidates (remote_ice())
//!   service -> session: JPEG frames (push_frame())
//!
//! ICE candidates are rewritten to `RUMAHL_WEBRTC_CANDIDATE_HOST` when set
//! (dev VM: 127.0.0.1 + QEMU UDP forwarding - the host cannot reach the
//! guest's private IP otherwise).

use glib::prelude::*;
use gstreamer::prelude::*;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::Duration;

pub enum SessionEvent {
    Answer { sdp: String },
    Ice { candidate: String },
    Error(String),
}

pub struct WebRtcSession {
    frames_tx: Sender<Vec<u8>>,
    ice_tx: Sender<String>,
    #[allow(dead_code)]
    handle: Option<thread::JoinHandle<()>>,
}

impl Drop for WebRtcSession {
    fn drop(&mut self) {
        // Closing the channels ends the session thread (GLib main loop
        // quits when both receivers are dropped).
        let _ = self.frames_tx.send(Vec::new());
    }
}

impl WebRtcSession {
    /// Start a session for the given remote offer. Returns immediately;
    /// the answer arrives asynchronously via `events`.
    pub fn start(
        offer_sdp: &str,
        events: Sender<SessionEvent>,
        candidate_host: Option<String>,
    ) -> Result<Self, String> {
        let (frames_tx, frames_rx) = mpsc::channel::<Vec<u8>>();
        let (ice_tx, ice_rx) = mpsc::channel::<String>();
        let offer = offer_sdp.to_string();
        let handle = thread::spawn(move || {
            run_session(offer, events, frames_rx, ice_rx, candidate_host);
        });
        Ok(WebRtcSession {
            frames_tx,
            ice_tx,
            handle: Some(handle),
        })
    }

    pub fn push_frame(&self, jpeg: &[u8]) {
        if !jpeg.is_empty() {
            let _ = self.frames_tx.send(jpeg.to_vec());
        }
    }

    pub fn remote_ice(&self, candidate: &str) {
        let _ = self.ice_tx.send(candidate.to_string());
    }
}

fn run_session(
    offer_sdp: String,
    events: Sender<SessionEvent>,
    frames_rx: Receiver<Vec<u8>>,
    ice_rx: Receiver<String>,
    candidate_host: Option<String>,
) {
    eprintln!("[webrtc] session starting");
    if gstreamer::init().is_err() {
        let _ = events.send(SessionEvent::Error("gstreamer::init failed".into()));
        return;
    }
    let main_loop = glib::MainLoop::new(None, false);

    // Everything below must run with this context as the thread default
    // (promises are dispatched on it); the frame/ICE threads are spawned
    // inside the guard so they inherit it as well.
    let ctx = main_loop.context().clone();
    let _ = ctx.with_thread_default(|| {
        run_session_inner(
            offer_sdp,
            events,
            frames_rx,
            ice_rx,
            candidate_host,
            &main_loop,
        );
    });
}

fn run_session_inner(
    offer_sdp: String,
    events: Sender<SessionEvent>,
    frames_rx: Receiver<Vec<u8>>,
    ice_rx: Receiver<String>,
    candidate_host: Option<String>,
    main_loop: &glib::MainLoop,
) {
    let pipeline = match gstreamer::parse::launch(
        "appsrc name=src is-live=true format=time \
         caps=image/jpeg,framerate=30/1 ! jpegdec ! videoconvert ! \
         vp8enc deadline=1 keyframe-max-dist=30 ! rtpvp8pay name=pay pt=96",
    ) {
        Ok(p) => p
            .downcast::<gstreamer::Pipeline>()
            .expect("pipeline downcast"),
        Err(e) => {
            let _ = events.send(SessionEvent::Error(format!("parse_launch: {e}")));
            return;
        }
    };
    let webrtc = match gstreamer::ElementFactory::make("webrtcbin").build() {
        Ok(w) => w,
        Err(e) => {
            let _ = events.send(SessionEvent::Error(format!("webrtcbin: {e}")));
            return;
        }
    };
    webrtc.set_property(
        "bundle-policy",
        gstreamer_webrtc::WebRTCBundlePolicy::MaxBundle,
    );
    if pipeline.add(&webrtc).is_err() {
        let _ = events.send(SessionEvent::Error("pipeline.add(webrtcbin) failed".into()));
        return;
    }
    let _ = webrtc.sync_state_with_parent();
    eprintln!("[webrtc] webrtcbin created, transceiver requested");

    // Sendonly transceiver.
    let _transceiver = webrtc.emit_by_name::<gstreamer_webrtc::WebRTCRTPTransceiver>(
        "add-transceiver",
        &[
            &gstreamer_webrtc::WebRTCRTPTransceiverDirection::Sendonly,
            &None::<gstreamer::Caps>,
        ],
    );

    let _ = pipeline.set_state(gstreamer::State::Playing);

    // Link the payloader once webrtcbin instantiates its sink pad.
    let pay_link = match pipeline.by_name("pay") {
        Some(p) => p,
        None => {
            let _ = events.send(SessionEvent::Error("pay element missing".into()));
            return;
        }
    };
    webrtc.connect("pad-added", false, move |values| {
        if let Ok(pad) = values[1].get::<gstreamer::Pad>() {
            if !pad.is_linked() {
                if let Some(src) = pay_link.static_pad("src") {
                    let _ = src.link(&pad);
                }
            }
        }
        None
    });

    // Local ICE candidates. In the dev VM the guest IP is unreachable from
    // the host browser: rewrite every UDP candidate to 127.0.0.1:40000
    // (QEMU UDP forwarding) and start a socat hop to the real session port
    // once. TCP candidates are dropped (their ports are not forwarded).
    // Without a configured candidate host the candidates pass through
    // unchanged (production OS: direct LAN connectivity).
    let evt_ice = events.clone();
    let forwarded_port = std::sync::Arc::new(std::sync::atomic::AtomicU16::new(0));
    webrtc.connect("on-ice-candidate", false, move |values| {
        if let Ok(candidate) = values[2].get::<&str>() {
            let tokens: Vec<&str> = candidate.split_whitespace().collect();
            let is_udp = tokens.len() >= 7 && tokens.get(2).copied() == Some("UDP");
            let rewritten = if candidate_host.is_some() && is_udp {
                let port: u16 = tokens[5].parse().unwrap_or(0);
                if forwarded_port.load(std::sync::atomic::Ordering::Relaxed) == 0 && port != 0 {
                    let _ = std::process::Command::new("socat")
                        .args([
                            "UDP4-LISTEN:40000,reuseaddr,fork",
                            &format!("UDP4:127.0.0.1:{port}"),
                        ])
                        .spawn();
                    forwarded_port.store(port, std::sync::atomic::Ordering::Relaxed);
                }
                // Single fixed host port for every UDP candidate.
                format!(
                    "{} {} {} {} {} 127.0.0.1 40000 {}",
                    tokens[0],
                    tokens[1],
                    tokens[2],
                    tokens[3],
                    tokens[4],
                    tokens[6..].join(" ")
                )
            } else {
                candidate.to_string()
            };
            let _ = evt_ice.send(SessionEvent::Ice {
                candidate: rewritten,
            });
        }
        None
    });

    // Remote offer -> answer.
    let sdp_message = match gstreamer_sdp::SDPMessage::parse_buffer(offer_sdp.as_bytes()) {
        Ok(m) => m,
        Err(e) => {
            let _ = events.send(SessionEvent::Error(format!("sdp parse: {e}")));
            return;
        }
    };
    let offer_desc = gstreamer_webrtc::WebRTCSessionDescription::new(
        gstreamer_webrtc::WebRTCSDPType::Offer,
        sdp_message,
    );

    let webrtc_answer = webrtc.clone();
    let evt_answer = events.clone();
    let answer_promise = gstreamer::Promise::with_change_func(move |promise| {
        eprintln!("[webrtc] answer promise resolved");
        if let Ok(Some(reply)) = promise {
            eprintln!("[webrtc] reply: {}", reply);
            match reply.get::<gstreamer_webrtc::WebRTCSessionDescription>("answer") {
                Ok(desc) => {
                    eprintln!("[webrtc] answer extracted, sending");
                    let local = gstreamer::Promise::new();
                    webrtc_answer.emit_by_name::<()>("set-local-description", &[&desc, &local]);
                    local.interrupt();
                    let sent = evt_answer.send(SessionEvent::Answer {
                        sdp: desc.sdp().as_text().unwrap_or_default(),
                    });
                    eprintln!("[webrtc] answer send result: {}", sent.is_ok());
                }
                Err(e) => eprintln!("[webrtc] answer get failed: {e}"),
            }
        } else {
            eprintln!("[webrtc] answer promise reply missing");
        }
    });

    // Documented flow: create the answer from the set-remote-description
    // change callback (no interrupt - the promise resolves on the main
    // context once the offer has been applied).
    let webrtc_offer = webrtc.clone();
    let offer_promise = gstreamer::Promise::with_change_func(move |promise| {
        let _ = promise;
        eprintln!("[webrtc] remote description set, creating answer");
        webrtc_offer.emit_by_name::<()>(
            "create-answer",
            &[&None::<gstreamer::Structure>, &answer_promise],
        );
    });
    eprintln!("[webrtc] setting remote description");
    webrtc.emit_by_name::<()>("set-remote-description", &[&offer_desc, &offer_promise]);
    eprintln!("[webrtc] entering main loop");

    // Frame pusher thread: CDP JPEGs -> appsrc.
    let appsrc = match pipeline.by_name("src") {
        Some(s) => s
            .downcast::<gstreamer_app::AppSrc>()
            .expect("appsrc downcast"),
        None => {
            let _ = events.send(SessionEvent::Error("appsrc missing".into()));
            return;
        }
    };
    let mut pts = 0u64;
    let frame_dur = Duration::from_secs_f64(1.0 / 30.0);
    let evt_err = events.clone();
    let app_thread = thread::spawn(move || {
        while let Ok(frame) = frames_rx.recv() {
            if frame.is_empty() {
                break;
            }
            let mut buf = gstreamer::Buffer::with_size(frame.len()).expect("buffer alloc");
            if let Some(buf_ref) = buf.get_mut() {
                {
                    let mut data = buf_ref.map_writable().expect("buffer map");
                    data.copy_from_slice(&frame);
                }
                buf_ref.set_pts(gstreamer::ClockTime::from_nseconds(
                    pts * frame_dur.as_nanos() as u64,
                ));
                buf_ref.set_duration(gstreamer::ClockTime::from_nseconds(
                    frame_dur.as_nanos() as u64
                ));
            }
            pts += 1;
            if appsrc.push_buffer(buf).is_err() {
                let _ = evt_err.send(SessionEvent::Error("appsrc push failed".into()));
                break;
            }
        }
        let _ = appsrc.end_of_stream();
    });

    // Remote ICE from the service.
    let ice_webrtc = webrtc.clone();
    let ice_thread = thread::spawn(move || {
        while let Ok(candidate) = ice_rx.recv() {
            ice_webrtc.emit_by_name::<()>("add-ice-candidate", &[&0u32, &candidate]);
        }
    });

    main_loop.run();
    let _ = pipeline.set_state(gstreamer::State::Null);
    let _ = app_thread.join();
    let _ = ice_thread.join();
}

/// Rewrite the IP in a GStreamer ICE candidate string to the configured
/// host (dev VM: 127.0.0.1 with QEMU UDP forwarding). Returns the
/// candidate unchanged when no rewrite host is configured.
#[allow(dead_code)]
fn rewrite_candidate(candidate: &str, host: Option<&str>) -> String {
    let Some(host) = host else {
        return candidate.to_string();
    };
    let tokens: Vec<&str> = candidate.split_whitespace().collect();
    if tokens.len() >= 6 && tokens[0].starts_with("candidate:") {
        let mut out = tokens.clone();
        out[4] = host;
        out.join(" ")
    } else {
        candidate.to_string()
    }
}
