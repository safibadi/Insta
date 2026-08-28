#!/usr/bin/env python3
"""
Generate test fixtures that mirror the real shapes of an Instagram export.

Run from the repo root:  python3 tests/make-fixtures.py

The expected analysis for this data:
  following = alice, bob, charlie, dave, evil<script>, unicode, MixedCase
  followers = alice, bob, zoe, mallory, MIXEDCASE   (split across two files)
  -> not following back : charlie, dave, evil<script>, unicode   (4)
  -> fans               : zoe, mallory                           (2)
  -> mutuals            : alice, bob, MixedCase                  (3)

MixedCase vs MIXEDCASE exists to prove username comparison is case-insensitive:
Instagram handles are, so treating them as two people would be a real bug.
"""

import json
import os
import zipfile

ROOT = os.path.join(os.path.dirname(__file__), "fixtures")
BASE_TS = 1700000000

FOLLOWERS_A = ["alice", "bob"]
FOLLOWERS_B = ["zoe", "mallory", "MIXEDCASE"]
FOLLOWING = [
    "alice", "bob", "charlie", "dave",
    "<script>alert(1)</script>",   # a username must never become markup
    "ünïcode_user",                # non-ASCII handles must survive intact
    "MixedCase",
]
PENDING = ["pending_person"]


def entry(username, index):
    return {
        "title": "",
        "media_list_data": [],
        "string_list_data": [{
            "href": f"https://www.instagram.com/{username}",
            "value": username,
            "timestamp": BASE_TS + index * 86400,
        }],
    }


def bare_array(names):
    """followers_*.json is a bare array at the root."""
    return [entry(name, i) for i, name in enumerate(names)]


def wrapped(key, names):
    """following.json and friends wrap the array in a relationships_* key."""
    return {key: [entry(name, i) for i, name in enumerate(names)]}


def html_export(names, title):
    """
    Mimics the shape of Meta's HTML export: a link per account with a
    human-readable date in a sibling element, and generated class names that
    carry no stable meaning.
    """
    rows = []
    for i, name in enumerate(names):
        safe = (name.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
        rows.append(
            '<div class="pam _3-95 _2ph- _a6-g uiBoxWhite noborder">'
            '<div class="_a6-p"><div>'
            f'<a href="https://www.instagram.com/{safe}" target="_blank">{safe}</a>'
            "</div></div>"
            f'<div class="_a6-q"><div>Mar {(i % 28) + 1}, 2024 5:12 pm</div></div>'
            "</div>"
        )
    return (
        f"<!doctype html><html><head><meta charset='utf-8'><title>{title}</title></head>"
        # Navigation chrome that must NOT be mistaken for an account.
        '<body><div class="_3-8y _3-95"><a href="https://www.instagram.com/">Instagram</a>'
        '<a href="https://www.instagram.com/accounts/login/">Log in</a></div>'
        f'<div role="main">{"".join(rows)}</div></body></html>'
    )


def write(path, content):
    full = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    mode = "wb" if isinstance(content, bytes) else "w"
    with open(full, mode, **({} if isinstance(content, bytes) else {"encoding": "utf-8"})) as handle:
        handle.write(content)
    return full


def main():
    os.makedirs(ROOT, exist_ok=True)

    json_files = {
        "followers_1.json": json.dumps(bare_array(FOLLOWERS_A), indent=2),
        "followers_2.json": json.dumps(bare_array(FOLLOWERS_B), indent=2),
        "following.json": json.dumps(wrapped("relationships_following", FOLLOWING), indent=2),
        "pending_follow_requests.json": json.dumps(
            wrapped("relationships_follow_requests_sent", PENDING), indent=2
        ),
    }
    for name, content in json_files.items():
        write(f"json/{name}", content)

    html_files = {
        "followers_1.html": html_export(FOLLOWERS_A + FOLLOWERS_B, "Followers"),
        "following.html": html_export(FOLLOWING, "Following"),
    }
    for name, content in html_files.items():
        write(f"html/{name}", content)

    # An export with no followers at all - a brand new account.
    write("edge/followers_1.json", json.dumps([], indent=2))
    write("edge/following.json", json.dumps(wrapped("relationships_following", ["solo"]), indent=2))

    # A future-proofing case: the wrapper key gets renamed. The parser should
    # still find the array rather than returning nothing.
    write(
        "edge/renamed_following.json",
        json.dumps({"relationships_following_v2": [entry("renamed_ok", 0)]}, indent=2),
    )

    export_dir = "connections/followers_and_following"

    # A minimal export: only what the tool needs.
    with zipfile.ZipFile(os.path.join(ROOT, "export-small.zip"), "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in json_files.items():
            zf.writestr(f"{export_dir}/{name}", content)
        zf.writestr("start_here.html", "<html><body>Start here</body></html>")

    # A full export: the same files buried under the media and metadata a user
    # gets when they tick "All information". The reader must ignore all of it
    # without ever decompressing it.
    with zipfile.ZipFile(os.path.join(ROOT, "export-full.zip"), "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in json_files.items():
            zf.writestr(f"{export_dir}/{name}", content)
        zf.writestr("start_here.html", "<html><body>Start here</body></html>")
        for i in range(120):
            zf.writestr(f"media/posts/photo_{i:03}.jpg", os.urandom(2048))
        for i in range(20):
            zf.writestr(f"messages/inbox/thread_{i}/message_1.json",
                        json.dumps({"messages": [{"content": "hi"} for _ in range(50)]}))
        zf.writestr("personal_information/personal_information.json",
                    json.dumps({"profile_user": [{"title": "me"}]}))
        # Same basenames, wrong folder - these are decoys only in the sense
        # that they prove we match on filename regardless of location.
        zf.writestr("ads_information/advertisers_using_your_activity.json", json.dumps([]))

    # An HTML-format export archive.
    with zipfile.ZipFile(os.path.join(ROOT, "export-html.zip"), "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in html_files.items():
            zf.writestr(f"{export_dir}/{name}", content)

    # Not a ZIP at all - should produce a clear error, not a stack trace.
    write("not-a-zip.zip", b"this is definitely not a zip file")

    print("Fixtures written to", ROOT)
    for root, _, files in sorted(os.walk(ROOT)):
        for name in sorted(files):
            path = os.path.join(root, name)
            print(f"  {os.path.relpath(path, ROOT):50} {os.path.getsize(path):>9,} bytes")


if __name__ == "__main__":
    main()
