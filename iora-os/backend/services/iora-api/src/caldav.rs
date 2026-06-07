//! CalDAV interface for IORA API.
//!
//! Maps Home Assistant calendar entities to standard CalDAV calendars,
//! allowing access from iOS Calendar, Thunderbird, Outlook, etc.
//!
//! CalDAV uses WebDAV extensions (RFC 4791) for calendar data.

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, Method, StatusCode},
    response::{IntoResponse, Redirect, Response},
};
use chrono::Utc;
use std::sync::Arc;

pub async fn well_known_redirect() -> impl IntoResponse {
    Redirect::permanent("/caldav/")
}

pub async fn caldav_handler_root(
    state: State<Arc<crate::AppState>>,
    method: Method,
    headers: HeaderMap,
    body: Body,
) -> impl IntoResponse {
    handle_caldav(&state, &method, "/", &headers, body).await
}

pub async fn caldav_handler(
    state: State<Arc<crate::AppState>>,
    Path(path): Path<String>,
    method: Method,
    headers: HeaderMap,
    body: Body,
) -> impl IntoResponse {
    handle_caldav(&state, &method, &path, &headers, body).await
}

async fn handle_caldav(
    state: &crate::AppState,
    method: &Method,
    path: &str,
    headers: &HeaderMap,
    body: Body,
) -> Response {
    let token = match extract_token(headers) {
        Some(t) => t,
        None => {
            return Response::builder()
                .status(StatusCode::UNAUTHORIZED)
                .header("WWW-Authenticate", "Basic realm=\"IORA CalDAV\"")
                .body(Body::from("Authentication required"))
                .unwrap();
        }
    };

    match method.as_str() {
        "OPTIONS" => caldav_options().await,
        "PROPFIND" => caldav_propfind(state, path, &token, headers).await,
        "REPORT" => {
            let body_bytes = match axum::body::to_bytes(body, 1024 * 1024).await {
                Ok(b) => b.to_vec(),
                Err(_) => Vec::new(),
            };
            caldav_report(state, path, &token, headers, &body_bytes).await
        }
        "GET" => caldav_get(state, path, &token).await,
        _ => Response::builder()
            .status(StatusCode::METHOD_NOT_ALLOWED)
            .body(Body::from("Method not allowed"))
            .unwrap(),
    }
}

async fn caldav_options() -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header("Allow", "OPTIONS, GET, PROPFIND, REPORT")
        .header("DAV", "1, calendar-access")
        .body(Body::empty())
        .unwrap()
}

async fn caldav_propfind(
    state: &crate::AppState,
    path: &str,
    token: &str,
    headers: &HeaderMap,
) -> Response {
    let depth = headers
        .get("Depth")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("1");

    // Fetch calendar entities from HA via IORA Home
    let resp = state
        .http_client
        .get(format!("{}/api/calendars", state.iora_home_url))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await;

    let calendars: Vec<serde_json::Value> = match resp {
        Ok(r) if r.status().is_success() => r.json().await.unwrap_or_default(),
        _ => vec![],
    };

    let mut xml = String::from("<?xml version=\"1.0\" encoding=\"utf-8\" ?>\n");
    xml.push_str("<D:multistatus xmlns:D=\"DAV:\" xmlns:C=\"urn:ietf:params:xml:ns:caldav\" xmlns:CS=\"http://calendarserver.org/ns/\">\n");

    if path == "/" || path.is_empty() {
        // Root: list all calendars
        xml.push_str("  <D:response>\n");
        xml.push_str("    <D:href>/caldav/</D:href>\n");
        xml.push_str("    <D:propstat>\n      <D:prop>\n");
        xml.push_str("        <D:resourcetype><D:collection/></D:resourcetype>\n");
        xml.push_str("        <D:displayname>IORA Calendars</D:displayname>\n");
        xml.push_str(
            "      </D:prop>\n      <D:status>HTTP/1.1 200 OK</D:status>\n    </D:propstat>\n",
        );
        xml.push_str("  </D:response>\n");

        if depth != "0" {
            for cal in &calendars {
                let entity_id = cal["entity_id"].as_str().unwrap_or("");
                let name = cal["name"].as_str().unwrap_or(entity_id);
                let cal_path = entity_id.replace('.', "_");

                xml.push_str("  <D:response>\n");
                xml.push_str(&format!("    <D:href>/caldav/{}/</D:href>\n", cal_path));
                xml.push_str("    <D:propstat>\n      <D:prop>\n");
                xml.push_str(
                    "        <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>\n",
                );
                xml.push_str(&format!(
                    "        <D:displayname>{}</D:displayname>\n",
                    name
                ));
                xml.push_str("        <C:supported-calendar-component-set>\n");
                xml.push_str("          <C:comp name=\"VEVENT\"/>\n");
                xml.push_str("        </C:supported-calendar-component-set>\n");
                xml.push_str("      </D:prop>\n      <D:status>HTTP/1.1 200 OK</D:status>\n    </D:propstat>\n");
                xml.push_str("  </D:response>\n");
            }
        }
    } else {
        // Specific calendar: list events
        let cal_path = path.trim_matches('/');
        let entity_id = cal_path.replacen('_', ".", 1);

        xml.push_str("  <D:response>\n");
        xml.push_str(&format!("    <D:href>/caldav/{}/</D:href>\n", cal_path));
        xml.push_str("    <D:propstat>\n      <D:prop>\n");
        xml.push_str("        <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>\n");
        xml.push_str(&format!(
            "        <D:displayname>{}</D:displayname>\n",
            entity_id
        ));
        xml.push_str(
            "      </D:prop>\n      <D:status>HTTP/1.1 200 OK</D:status>\n    </D:propstat>\n",
        );
        xml.push_str("  </D:response>\n");

        if depth != "0" {
            // Fetch events for this calendar
            let now = Utc::now();
            let start = (now - chrono::Duration::days(30)).format("%Y-%m-%dT%H:%M:%S");
            let end = (now + chrono::Duration::days(90)).format("%Y-%m-%dT%H:%M:%S");

            let events_resp = state
                .http_client
                .get(format!(
                    "{}/api/calendars/{}/events?start={}&end={}",
                    state.iora_home_url, entity_id, start, end
                ))
                .header("Authorization", format!("Bearer {}", token))
                .send()
                .await;

            let events: Vec<serde_json::Value> = match events_resp {
                Ok(r) if r.status().is_success() => r.json().await.unwrap_or_default(),
                _ => vec![],
            };

            for (idx, event) in events.iter().enumerate() {
                let summary = event["summary"].as_str().unwrap_or("Event");
                let uid = format!("{}-{}", cal_path, idx);

                xml.push_str("  <D:response>\n");
                xml.push_str(&format!(
                    "    <D:href>/caldav/{}/{}.ics</D:href>\n",
                    cal_path, uid
                ));
                xml.push_str("    <D:propstat>\n      <D:prop>\n");
                xml.push_str("        <D:resourcetype/>\n");
                xml.push_str(&format!(
                    "        <D:displayname>{}</D:displayname>\n",
                    summary
                ));
                xml.push_str("        <D:getcontenttype>text/calendar</D:getcontenttype>\n");
                xml.push_str("      </D:prop>\n      <D:status>HTTP/1.1 200 OK</D:status>\n    </D:propstat>\n");
                xml.push_str("  </D:response>\n");
            }
        }
    }

    xml.push_str("</D:multistatus>\n");

    Response::builder()
        .status(StatusCode::MULTI_STATUS)
        .header(header::CONTENT_TYPE, "application/xml; charset=utf-8")
        .body(Body::from(xml))
        .unwrap()
}

async fn caldav_report(
    state: &crate::AppState,
    path: &str,
    token: &str,
    _headers: &HeaderMap,
    body: &[u8],
) -> Response {
    // CalDAV REPORT: parse calendar-query (time-range, comp-filter) and
    // calendar-multiget (list of <D:href>) requests.
    let body_str = std::str::from_utf8(body).unwrap_or("");

    // Extract optional time-range filter: <C:time-range start="..." end="..."/>
    let (range_start, range_end) = parse_time_range(body_str);

    // Extract requested hrefs for calendar-multiget
    let requested_hrefs: Vec<String> = parse_hrefs(body_str);
    let is_multiget = body_str.contains("calendar-multiget") && !requested_hrefs.is_empty();

    let cal_path = path.trim_matches('/');
    if cal_path.is_empty() {
        return caldav_propfind(state, path, token, _headers).await;
    }
    let entity_id = cal_path.replacen('_', ".", 1);

    // Default time window: ±30/90 days; override from request if provided.
    let now = Utc::now();
    let default_start = now - chrono::Duration::days(30);
    let default_end = now + chrono::Duration::days(90);
    let start_dt = range_start.unwrap_or(default_start);
    let end_dt = range_end.unwrap_or(default_end);

    let events_resp = state
        .http_client
        .get(format!(
            "{}/api/calendars/{}/events?start={}&end={}",
            state.iora_home_url,
            entity_id,
            start_dt.format("%Y-%m-%dT%H:%M:%S"),
            end_dt.format("%Y-%m-%dT%H:%M:%S")
        ))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await;
    let events: Vec<serde_json::Value> = match events_resp {
        Ok(r) if r.status().is_success() => r.json().await.unwrap_or_default(),
        _ => vec![],
    };

    let mut xml = String::from("<?xml version=\"1.0\" encoding=\"utf-8\" ?>\n");
    xml.push_str("<D:multistatus xmlns:D=\"DAV:\" xmlns:C=\"urn:ietf:params:xml:ns:caldav\">\n");

    for (idx, event) in events.iter().enumerate() {
        let uid = format!("{}-{}", cal_path, idx);
        let href = format!("/caldav/{}/{}.ics", cal_path, uid);

        if is_multiget
            && !requested_hrefs
                .iter()
                .any(|h| h.ends_with(&format!("{}.ics", uid)))
        {
            continue;
        }

        let summary = event["summary"].as_str().unwrap_or("Event");
        let dtstart = event["start"]
            .as_str()
            .or_else(|| event["dtstart"].as_str())
            .unwrap_or("");
        let dtend = event["end"]
            .as_str()
            .or_else(|| event["dtend"].as_str())
            .unwrap_or("");

        let ics = format!(
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//IORA//CalDAV//EN\r\nBEGIN:VEVENT\r\nUID:{uid}\r\nSUMMARY:{summary}\r\nDTSTART:{dtstart}\r\nDTEND:{dtend}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
            uid = uid,
            summary = xml_escape(summary),
            dtstart = ics_format_time(dtstart),
            dtend = ics_format_time(dtend),
        );

        xml.push_str("  <D:response>\n");
        xml.push_str(&format!("    <D:href>{}</D:href>\n", href));
        xml.push_str("    <D:propstat>\n      <D:prop>\n");
        xml.push_str("        <D:getcontenttype>text/calendar; charset=utf-8; component=VEVENT</D:getcontenttype>\n");
        xml.push_str(&format!(
            "        <C:calendar-data>{}</C:calendar-data>\n",
            xml_escape(&ics)
        ));
        xml.push_str(
            "      </D:prop>\n      <D:status>HTTP/1.1 200 OK</D:status>\n    </D:propstat>\n",
        );
        xml.push_str("  </D:response>\n");
    }

    xml.push_str("</D:multistatus>\n");

    Response::builder()
        .status(StatusCode::MULTI_STATUS)
        .header(header::CONTENT_TYPE, "application/xml; charset=utf-8")
        .body(Body::from(xml))
        .unwrap()
}

/// Best-effort extraction of the first `<C:time-range start="..." end="..."/>` element.
fn parse_time_range(xml: &str) -> (Option<chrono::DateTime<Utc>>, Option<chrono::DateTime<Utc>>) {
    let lower = xml.to_lowercase();
    let Some(idx) = lower.find("time-range") else {
        return (None, None);
    };
    let segment = &xml[idx..(idx + 256).min(xml.len())];
    let extract = |attr: &str| -> Option<chrono::DateTime<Utc>> {
        let pat = format!("{}=\"", attr);
        let pos = segment.find(&pat)?;
        let rest = &segment[pos + pat.len()..];
        let end = rest.find('"')?;
        let value = &rest[..end];
        chrono::NaiveDateTime::parse_from_str(value, "%Y%m%dT%H%M%SZ")
            .or_else(|_| chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%SZ"))
            .ok()
            .map(|n| n.and_utc())
    };
    (extract("start"), extract("end"))
}

fn parse_hrefs(xml: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cursor = 0;
    while let Some(start) = xml[cursor..]
        .find("<D:href>")
        .or_else(|| xml[cursor..].find("<href>"))
    {
        let abs = cursor + start;
        let after = abs + xml[abs..].find('>').map(|p| p + 1).unwrap_or(0);
        if let Some(end_rel) = xml[after..].find("</") {
            out.push(xml[after..after + end_rel].trim().to_string());
            cursor = after + end_rel;
        } else {
            break;
        }
    }
    out
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn ics_format_time(s: &str) -> String {
    if s.is_empty() {
        return String::from("19700101T000000Z");
    }
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return dt.with_timezone(&Utc).format("%Y%m%dT%H%M%SZ").to_string();
    }
    s.replace(['-', ':'], "")
}

async fn caldav_get(state: &crate::AppState, path: &str, token: &str) -> Response {
    // GET on an .ics file: return iCalendar data
    let parts: Vec<&str> = path.trim_matches('/').split('/').collect();

    if parts.len() < 2 {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("Not found"))
            .unwrap();
    }

    let cal_path = parts[0];
    let entity_id = cal_path.replacen('_', ".", 1);
    let event_file = parts[1].trim_end_matches(".ics");

    // Parse event index from UID
    let event_idx: usize = event_file
        .rsplit('-')
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    // Fetch events
    let now = Utc::now();
    let start = (now - chrono::Duration::days(30)).format("%Y-%m-%dT%H:%M:%S");
    let end = (now + chrono::Duration::days(90)).format("%Y-%m-%dT%H:%M:%S");

    let events_resp = state
        .http_client
        .get(format!(
            "{}/api/calendars/{}/events?start={}&end={}",
            state.iora_home_url, entity_id, start, end
        ))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await;

    let events: Vec<serde_json::Value> = match events_resp {
        Ok(r) if r.status().is_success() => r.json().await.unwrap_or_default(),
        _ => vec![],
    };

    let event = match events.get(event_idx) {
        Some(e) => e,
        None => {
            return Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(Body::from("Event not found"))
                .unwrap();
        }
    };

    // Build iCalendar output
    let summary = event["summary"].as_str().unwrap_or("Event");
    let description = event["description"].as_str().unwrap_or("");
    let start_dt = event["start"]
        .as_str()
        .or(event["start"]["dateTime"].as_str())
        .unwrap_or("");
    let end_dt = event["end"]
        .as_str()
        .or(event["end"]["dateTime"].as_str())
        .unwrap_or("");
    let location = event["location"].as_str().unwrap_or("");
    let uid = format!("{}-{}@iora", cal_path, event_idx);

    let ical = format!(
        "BEGIN:VCALENDAR\r\n\
        VERSION:2.0\r\n\
        PRODID:-//IORA//CalDAV//EN\r\n\
        BEGIN:VEVENT\r\n\
        UID:{}\r\n\
        SUMMARY:{}\r\n\
        DESCRIPTION:{}\r\n\
        DTSTART:{}\r\n\
        DTEND:{}\r\n\
        LOCATION:{}\r\n\
        END:VEVENT\r\n\
        END:VCALENDAR\r\n",
        uid, summary, description, start_dt, end_dt, location,
    );

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/calendar; charset=utf-8")
        .body(Body::from(ical))
        .unwrap()
}

fn extract_token(headers: &HeaderMap) -> Option<String> {
    if let Some(auth) = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
    {
        if let Some(token) = auth.strip_prefix("Bearer ") {
            return Some(token.to_string());
        }
        if let Some(encoded) = auth.strip_prefix("Basic ") {
            // Decode base64 and use password as bearer token
            if let Ok(decoded) = String::from_utf8(base64_decode(encoded)) {
                if let Some((_user, pass)) = decoded.split_once(':') {
                    return Some(pass.to_string());
                }
            }
        }
    }
    None
}

fn base64_decode(input: &str) -> Vec<u8> {
    let table = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = Vec::new();
    let mut buffer = 0u32;
    let mut bits = 0u32;

    for &byte in input.as_bytes() {
        if byte == b'=' {
            break;
        }
        if let Some(val) = table.iter().position(|&b| b == byte) {
            buffer = (buffer << 6) | val as u32;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                output.push((buffer >> bits) as u8);
                buffer &= (1 << bits) - 1;
            }
        }
    }

    output
}
