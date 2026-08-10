"""ORA Browser WebRTC signaling worker (GStreamer webrtcbin).

Protocol over stdin/stdout (JSON lines, then binary frames with a 4-byte
big-endian length prefix):

  -> {"sdp": "<remote offer>"}        client offer
  <- {"sdp": "<local answer>"}        answer (trickle: no candidates inside)
  <- {"ice": "<candidate>"}           local ICE candidate (trickle)
  -> {"ice": "<candidate>"}           remote ICE candidate
  -> <4-byte length><jpeg bytes>...   screencast frames pushed into appsrc

Pipeline: appsrc(jpeg) -> jpegdec -> videoconvert -> vp8enc -> rtpvp8pay
-> webrtcbin (sendonly). Everything runs inside the GLib main loop; stdin
is read via an IO watch.
"""
import json
import os
import struct
import sys

import gi

for ns in ("Gst", "GstSdp", "GstWebRTC"):
    gi.require_version(ns, "1.0")
from gi.repository import Gst, GstSdp, GstWebRTC, GLib  # noqa: E402

Gst.init(None)
loop = GLib.MainLoop()

pipeline = Gst.parse_launch(
    "appsrc name=src is-live=true format=time "
    "caps=image/jpeg,framerate=30/1 ! jpegdec ! videoconvert ! "
    "vp8enc deadline=1 keyframe-max-dist=30 ! rtpvp8pay name=pay pt=96"
)
webrtc = Gst.ElementFactory.make("webrtcbin", "webrtc")
webrtc.set_property("bundle-policy", GstWebRTC.WebRTCBundlePolicy.MAX_BUNDLE)
pipeline.add(webrtc)

webrtc.emit("add-transceiver", GstWebRTC.WebRTCRTPTransceiverDirection.SENDONLY, None)
pipeline.set_state(Gst.State.PLAYING)

pay = pipeline.get_by_name("pay")
appsrc = pipeline.get_by_name("src")


def on_pad_added(_webrtc, pad):
    if not pad.is_linked():
        pay.get_static_pad("src").link(pad)


webrtc.connect("pad-added", on_pad_added)


def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def on_ice_candidate(_webrtc, _mlineindex, candidate):
    if candidate:
        send({"ice": candidate})


webrtc.connect("on-ice-candidate", on_ice_candidate)


def on_answer_created(promise, _user_data):
    reply = promise.get_reply()
    answer = reply.get_value("answer")
    promise2 = Gst.Promise.new()
    webrtc.emit("set-local-description", answer, promise2)
    promise2.interrupt()
    send({"sdp": answer.sdp})


def on_offer_set(promise, _user_data):
    promise.interrupt()
    answer_promise = Gst.Promise.new_with_change_func(on_answer_created, None, None)
    webrtc.emit("create-answer", None, answer_promise)


# --- Remote offer -----------------------------------------------------------
line = sys.stdin.readline()
if not line:
    sys.exit(1)
try:
    offer = json.loads(line)
except json.JSONDecodeError:
    sys.exit(1)

sdp_message = GstSdp.SDPMessage()
GstSdp.sdp_message_parse_buffer(offer["sdp"].encode("utf-8"), sdp_message)
offer_desc = GstWebRTC.WebRTCSessionDescription.new(
    GstWebRTC.WebRTCSDPType.OFFER, sdp_message
)
# Keep the parsed message alive — gi may collect it while GStreamer still
# references the session description (segfault otherwise).
_KEEPALIVE = (sdp_message, offer_desc)

promise = Gst.Promise.new_with_change_func(on_offer_set, None, None)
webrtc.emit("set-remote-description", offer_desc, promise)

# --- stdin: remote ICE + JPEG frames ---------------------------------------
_buf = bytearray()
pts = 0
frame_dur = Gst.SECOND // 30


def handle_payload(payload):
    global pts
    if payload[:1] == b"{" and b'"ice"' in payload[:96]:
        try:
            msg = json.loads(payload.decode("utf-8", "replace"))
        except json.JSONDecodeError:
            return
        if msg.get("ice"):
            cand = GstWebRTC.WebRTCICECandidate.new(msg["ice"])
            p = Gst.Promise.new()
            webrtc.emit("add-ice-candidate", cand, p)
            p.interrupt()
        return
    buf = Gst.Buffer.new_allocate(None, len(payload), None)
    buf.fill(0, payload)
    buf.pts = pts
    buf.duration = frame_dur
    pts += frame_dur
    appsrc.emit("push-buffer", buf)


def on_stdin(fd, _condition):
    global _buf
    chunk = os.read(fd, 65536)
    if not chunk:
        loop.quit()
        return False
    _buf += chunk
    while len(_buf) >= 4:
        (size,) = struct.unpack(">I", bytes(_buf[:4]))
        if len(_buf) < 4 + size:
            break
        payload = bytes(_buf[4 : 4 + size])
        del _buf[: 4 + size]
        handle_payload(payload)
    return True


GLib.io_add_watch(sys.stdin.fileno(), GLib.IO_IN, on_stdin)

try:
    loop.run()
except KeyboardInterrupt:
    pass
finally:
    pipeline.set_state(Gst.State.NULL)
