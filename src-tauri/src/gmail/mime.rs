//! Minimal RFC 5322 building (plain-text outgoing mail) and Gmail payload parsing.

use base64::alphabet;
use base64::engine::general_purpose::{GeneralPurpose, GeneralPurposeConfig, STANDARD, URL_SAFE_NO_PAD};
use base64::engine::DecodePaddingMode;
use base64::Engine;
use serde_json::Value;

/// Gmail returns base64url bodies with or without padding.
const URL_SAFE_LENIENT: GeneralPurpose = GeneralPurpose::new(
    &alphabet::URL_SAFE,
    GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::Indifferent),
);

pub struct OutgoingMessage<'a> {
    pub to: &'a str,
    pub cc: &'a str,
    pub bcc: &'a str,
    pub subject: &'a str,
    pub body: &'a str,
    pub in_reply_to: Option<&'a str>,
    pub references: Option<&'a str>,
}

/// RFC 2047 encoded-word for non-ASCII header values.
fn encode_header_value(value: &str) -> String {
    let clean: String = value.chars().filter(|c| *c != '\r' && *c != '\n').collect();
    if clean.is_ascii() {
        clean
    } else {
        format!("=?UTF-8?B?{}?=", STANDARD.encode(clean.as_bytes()))
    }
}

fn single_line(value: &str) -> String {
    value.chars().filter(|c| *c != '\r' && *c != '\n').collect()
}

/// Build the message and return it base64url-encoded for the Gmail `raw` field.
pub fn build_raw(msg: &OutgoingMessage) -> String {
    let mut headers = vec![format!("To: {}", single_line(msg.to))];
    if !msg.cc.trim().is_empty() {
        headers.push(format!("Cc: {}", single_line(msg.cc)));
    }
    if !msg.bcc.trim().is_empty() {
        headers.push(format!("Bcc: {}", single_line(msg.bcc)));
    }
    headers.push(format!("Subject: {}", encode_header_value(msg.subject)));
    if let Some(id) = msg.in_reply_to {
        headers.push(format!("In-Reply-To: {}", single_line(id)));
    }
    if let Some(refs) = msg.references {
        headers.push(format!("References: {}", single_line(refs)));
    }
    headers.push("MIME-Version: 1.0".into());
    headers.push("Content-Type: text/plain; charset=UTF-8".into());
    headers.push("Content-Transfer-Encoding: base64".into());

    let body = msg.body.replace("\r\n", "\n").replace('\n', "\r\n");
    let encoded_body = STANDARD
        .encode(body.as_bytes())
        .as_bytes()
        .chunks(76)
        .map(|c| String::from_utf8_lossy(c).into_owned())
        .collect::<Vec<_>>()
        .join("\r\n");

    let raw = format!("{}\r\n\r\n{}\r\n", headers.join("\r\n"), encoded_body);
    URL_SAFE_NO_PAD.encode(raw.as_bytes())
}

pub fn reply_subject(original: &str) -> String {
    let trimmed = original.trim();
    if trimmed.to_ascii_lowercase().starts_with("re:") {
        trimmed.to_string()
    } else {
        format!("Re: {trimmed}")
    }
}

/// Case-insensitive header lookup on a Gmail `payload`.
pub fn header<'a>(payload: &'a Value, name: &str) -> Option<&'a str> {
    payload
        .get("headers")?
        .as_array()?
        .iter()
        .find(|h| {
            h.get("name")
                .and_then(|n| n.as_str())
                .is_some_and(|n| n.eq_ignore_ascii_case(name))
        })?
        .get("value")?
        .as_str()
}

fn decode_part_body(part: &Value) -> Option<String> {
    let data = part.pointer("/body/data")?.as_str()?;
    let bytes = URL_SAFE_LENIENT.decode(data).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

fn find_body(part: &Value, mime: &str) -> Option<String> {
    let part_mime = part.get("mimeType").and_then(|m| m.as_str()).unwrap_or("");
    let is_attachment = part
        .get("filename")
        .and_then(|f| f.as_str())
        .is_some_and(|f| !f.is_empty());
    if part_mime.eq_ignore_ascii_case(mime) && !is_attachment {
        if let Some(text) = decode_part_body(part) {
            return Some(text);
        }
    }
    part.get("parts")?
        .as_array()?
        .iter()
        .find_map(|child| find_body(child, mime))
}

/// Crude HTML to text for messages without a text/plain part.
fn html_to_text(html: &str) -> String {
    use std::sync::OnceLock;
    static PATTERNS: OnceLock<[regex::Regex; 4]> = OnceLock::new();
    let [drop, breaks, tags, blank] = PATTERNS.get_or_init(|| {
        [
            regex::Regex::new(r"(?is)<(style|script|head)[^>]*>.*?</(style|script|head)>").unwrap(),
            regex::Regex::new(r"(?i)<br\s*/?>|</p>|</div>|</tr>|</li>|</h[1-6]>").unwrap(),
            regex::Regex::new(r"(?s)<[^>]+>").unwrap(),
            regex::Regex::new(r"\n\s*\n(\s*\n)+").unwrap(),
        ]
    });
    let text = drop.replace_all(html, "");
    let text = breaks.replace_all(&text, "\n");
    let text = tags.replace_all(&text, "");
    let text = text
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");
    blank.replace_all(&text, "\n\n").trim().to_string()
}

/// Plain-text body of a Gmail message payload, falling back to stripped HTML.
pub fn body_text(payload: &Value) -> String {
    if let Some(text) = find_body(payload, "text/plain") {
        return text.trim().to_string();
    }
    find_body(payload, "text/html")
        .map(|html| html_to_text(&html))
        .unwrap_or_default()
}

pub fn attachment_names(payload: &Value) -> Vec<String> {
    let mut out = Vec::new();
    fn walk(part: &Value, out: &mut Vec<String>) {
        if let Some(name) = part.get("filename").and_then(|f| f.as_str()) {
            if !name.is_empty() {
                out.push(name.to_string());
            }
        }
        if let Some(parts) = part.get("parts").and_then(|p| p.as_array()) {
            for child in parts {
                walk(child, out);
            }
        }
    }
    walk(payload, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn decode_raw(raw: &str) -> String {
        String::from_utf8(URL_SAFE_LENIENT.decode(raw).unwrap()).unwrap()
    }

    #[test]
    fn builds_reply_with_threading_headers_and_encoded_subject() {
        let raw = build_raw(&OutgoingMessage {
            to: "a@example.com",
            cc: "",
            bcc: "",
            subject: "Re: caf\u{e9}",
            body: "hi\nthere",
            in_reply_to: Some("<x@mail>"),
            references: Some("<w@mail> <x@mail>"),
        });
        let text = decode_raw(&raw);
        assert!(text.contains("To: a@example.com\r\n"));
        assert!(!text.contains("Cc:"));
        assert!(text.contains("Subject: =?UTF-8?B?"));
        assert!(text.contains("In-Reply-To: <x@mail>\r\n"));
        assert!(text.contains("References: <w@mail> <x@mail>\r\n"));
        let body_b64 = text.split("\r\n\r\n").nth(1).unwrap().replace("\r\n", "");
        assert_eq!(STANDARD.decode(body_b64).unwrap(), b"hi\r\nthere");
    }

    #[test]
    fn strips_header_injection() {
        let raw = build_raw(&OutgoingMessage {
            to: "a@example.com\r\nBcc: evil@example.com",
            cc: "",
            bcc: "",
            subject: "x",
            body: "",
            in_reply_to: None,
            references: None,
        });
        assert!(!decode_raw(&raw).contains("\r\nBcc:"));
    }

    #[test]
    fn prefers_plain_text_and_lists_attachments() {
        let payload = json!({
            "mimeType": "multipart/mixed",
            "parts": [
                { "mimeType": "multipart/alternative", "parts": [
                    { "mimeType": "text/html", "body": { "data": URL_SAFE_NO_PAD.encode("<p>html</p>") } },
                    { "mimeType": "text/plain", "body": { "data": URL_SAFE_NO_PAD.encode("plain") } }
                ]},
                { "mimeType": "application/pdf", "filename": "a.pdf", "body": { "attachmentId": "1" } }
            ]
        });
        assert_eq!(body_text(&payload), "plain");
        assert_eq!(attachment_names(&payload), vec!["a.pdf".to_string()]);
    }

    #[test]
    fn falls_back_to_html() {
        let payload = json!({
            "mimeType": "text/html",
            "body": { "data": URL_SAFE_NO_PAD.encode("<style>x{}</style><p>Hello&nbsp;there</p><p>Bye</p>") }
        });
        assert_eq!(body_text(&payload), "Hello there\nBye");
    }

    #[test]
    fn reply_subject_does_not_double_prefix() {
        assert_eq!(reply_subject("Lunch"), "Re: Lunch");
        assert_eq!(reply_subject("RE: Lunch"), "RE: Lunch");
    }
}
