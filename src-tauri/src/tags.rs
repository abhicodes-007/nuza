//! `#tag`s written in notes, for the sidebar's list of them.
//!
//! The editor's parser decides what is a tag on screen; this reads the same
//! rules out of raw text, so the vault can be searched without opening every
//! note in a webview. The two are kept to the same few rules on purpose:
//!
//! - a tag is a `#` followed by letters, digits, `_` or `-`, in any script,
//!   with at least one character that is not a digit - `#2024` and `#1` are
//!   numbers, not tags;
//! - the `#` has to start the line or follow whitespace, which is what keeps
//!   `example.com#section`, `[x](#heading)`, `[[note#heading]]` and `&#39;`
//!   from being read as tags;
//! - nothing inside a fenced code block, an indented code block, an inline
//!   code span, or a note's frontmatter counts.
//!
//! One difference is left: an indented block is taken to be code when it
//! follows a blank line, which is the rule for one outside a list. Inside a
//! list the editor knows better and this does not.

use crate::search::PREVIEW_LENGTH;

/// How far down a note its frontmatter's closing fence is looked for, the
/// same limit the editor uses.
const FRONTMATTER_SEARCH_LIMIT: usize = 200;

/// A `#tag` written in a note: which note, which line, and what the line says.
#[derive(serde::Serialize, Debug, PartialEq)]
pub struct TagRef {
    pub from: String,
    /// The tag without its `#`, as written.
    pub tag: String,
    /// 1-based.
    pub line: usize,
    /// The line, cut down when it is long.
    pub preview: String,
}

fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '-'
}

/// The tags in one line of prose, without their `#`.
fn tags_in_line(line: &str) -> Vec<&str> {
    let bytes = line.as_bytes();
    let mut tags = Vec::new();
    // Always on a character boundary: it only moves by whole characters, or
    // by backticks and a `#`, which are one byte each.
    let mut at = 0;

    while let Some(c) = line[at..].chars().next() {
        match c {
            '`' => {
                let run = bytes[at..].iter().take_while(|&&b| b == b'`').count();
                // A span runs to the next run of the same length; with none,
                // the backticks are just backticks.
                at = closing_run(bytes, at + run, run).unwrap_or(at + run);
            }
            '#' => {
                let start = at + 1;
                let length: usize = line[start..]
                    .chars()
                    .take_while(|&c| is_tag_char(c))
                    .map(char::len_utf8)
                    .sum();
                let body = &line[start..start + length];
                let after_boundary = line[..at]
                    .chars()
                    .next_back()
                    .is_none_or(char::is_whitespace);
                if after_boundary && body.chars().any(|c| !c.is_numeric()) {
                    tags.push(body);
                }
                // The rest of the word is not looked at again, so `#a#b` is
                // one thing that is not a tag, rather than a tag after it.
                at = start + length;
            }
            _ => at += c.len_utf8(),
        }
    }

    tags
}

/// Where the run of exactly `length` backticks at or after `from` ends.
fn closing_run(bytes: &[u8], from: usize, length: usize) -> Option<usize> {
    let mut at = from;
    while at < bytes.len() {
        if bytes[at] == b'`' {
            let run = bytes[at..].iter().take_while(|&&b| b == b'`').count();
            if run == length {
                return Some(at + run);
            }
            at += run;
        } else {
            at += 1;
        }
    }
    None
}

/// The first line after the frontmatter block at the top of `lines`, or 0 if
/// there is none. It needs `---` to open it and `---` to close it, both
/// alone on their line.
fn body_start(lines: &[&str]) -> usize {
    if lines.first().map(|line| line.trim()) != Some("---") {
        return 0;
    }
    let furthest = lines.len().min(FRONTMATTER_SEARCH_LIMIT);
    (1..furthest)
        .find(|&index| lines[index].trim() == "---")
        .map_or(0, |closing| closing + 1)
}

/// The fence a line opens, as its character and how many of them: three or
/// more backticks or tildes, up to three spaces in.
fn fence_of(line: &str) -> Option<(u8, usize)> {
    let indent = line.len() - line.trim_start_matches(' ').len();
    if indent > 3 {
        return None;
    }
    let rest = &line.as_bytes()[indent..];
    let character = *rest.first().filter(|&&b| b == b'`' || b == b'~')?;
    let length = rest.iter().take_while(|&&b| b == character).count();
    (length >= 3).then_some((character, length))
}

/// Whether a line is indented far enough to be part of a code block.
fn is_indented(line: &str) -> bool {
    line.starts_with('\t') || line.starts_with("    ")
}

/// Every `#tag` in `text`, in the order written.
pub fn tags_in(from: &str, text: &str) -> Vec<TagRef> {
    let lines: Vec<&str> = text.lines().collect();
    let mut found = Vec::new();
    let mut fence: Option<(u8, usize)> = None;
    // Whether the line above was blank or code, which is what makes an
    // indented line code rather than a continuation of a paragraph.
    let mut after_gap = true;

    for (index, line) in lines.iter().enumerate().skip(body_start(&lines)) {
        if let Some((character, length)) = fence {
            // Closed by a fence of the same kind, at least as long, and
            // carrying nothing else.
            if let Some((closing, run)) = fence_of(line) {
                if closing == character && run >= length && line.trim().len() == run {
                    fence = None;
                }
            }
            continue;
        }
        if let Some(opened) = fence_of(line) {
            fence = Some(opened);
            continue;
        }

        if line.trim().is_empty() {
            after_gap = true;
            continue;
        }
        if after_gap && is_indented(line) {
            continue;
        }
        after_gap = false;

        for tag in tags_in_line(line) {
            found.push(TagRef {
                from: from.to_string(),
                tag: tag.to_string(),
                line: index + 1,
                preview: line.trim().chars().take(PREVIEW_LENGTH).collect(),
            });
        }
    }

    found
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tags(text: &str) -> Vec<String> {
        tags_in("n.md", text).into_iter().map(|t| t.tag).collect()
    }

    #[test]
    fn finds_tags_in_prose() {
        assert_eq!(
            tags("a #one and #two_2 and #three-3"),
            ["one", "two_2", "three-3"]
        );
    }

    #[test]
    fn finds_a_tag_that_starts_the_line_or_a_list_item() {
        assert_eq!(tags("#first\n- #second"), ["first", "second"]);
    }

    #[test]
    fn a_heading_is_not_a_tag() {
        assert!(tags("# Heading\n## Another\n###### Deep").is_empty());
    }

    #[test]
    fn a_number_is_not_a_tag() {
        assert_eq!(tags("see #123 and #2024-05 and #1a"), ["2024-05", "1a"]);
    }

    #[test]
    fn needs_a_boundary_before_the_hash() {
        assert!(tags("https://example.com#section and a#b and &#39; and ##x").is_empty());
    }

    #[test]
    fn heading_links_are_not_tags() {
        assert!(tags("[text](#heading) and [[note#heading]] and [[#heading]]").is_empty());
    }

    #[test]
    fn a_hash_with_nothing_after_it_is_nothing() {
        assert!(tags("# \n#\n a # b #").is_empty());
    }

    #[test]
    fn stops_at_the_end_of_the_word() {
        assert_eq!(
            tags("#tag, #tag. #tag) #tag!"),
            ["tag", "tag", "tag", "tag"]
        );
    }

    #[test]
    fn leaves_out_inline_code() {
        assert_eq!(tags("`#no` #yes ``a ` #no`` #yes2"), ["yes", "yes2"]);
        // An unclosed backtick is only a backtick.
        assert_eq!(tags("a ` #yes"), ["yes"]);
    }

    #[test]
    fn leaves_out_fenced_code() {
        let text = "#before\n```sh\n#!/bin/sh\n#include\n```\n#after\n~~~\n#no\n~~~\n#end";
        assert_eq!(tags(text), ["before", "after", "end"]);
    }

    #[test]
    fn a_fence_is_closed_by_one_as_long() {
        let text = "````\n```\n#no\n```\n````\n#yes";
        assert_eq!(tags(text), ["yes"]);
    }

    #[test]
    fn leaves_out_indented_code_after_a_gap_only() {
        let text =
            "para\n\n    #no\n\tnor #this\n\n    #no\n\ntext\n    #yes continues the paragraph";
        assert_eq!(tags(text), ["yes"]);
    }

    #[test]
    fn leaves_out_frontmatter() {
        let text = "---\ntitle: x\ntags: #no\n---\n#yes";
        assert_eq!(tags(text), ["yes"]);
    }

    #[test]
    fn frontmatter_only_counts_at_the_top_and_when_closed() {
        assert_eq!(tags("#a\n---\n#b\n---\n#c"), ["a", "b", "c"]);
        assert_eq!(tags("---\n#unclosed"), ["unclosed"]);
    }

    #[test]
    fn reads_tags_in_any_script() {
        assert_eq!(
            tags("日本語 #tag café #café #日本語"),
            ["tag", "café", "日本語"]
        );
    }

    #[test]
    fn says_where_and_what_around_it() {
        let found = tags_in("n.md", "one\ntwo #tag here\n");
        assert_eq!(
            found,
            [TagRef {
                from: "n.md".to_string(),
                tag: "tag".to_string(),
                line: 2,
                preview: "two #tag here".to_string(),
            }]
        );
    }
}
