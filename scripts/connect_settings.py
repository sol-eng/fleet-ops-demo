"""Set the vanity URL and process limits for one content item on Connect.

Usage: connect_settings.py <server-nickname> <content-url> <vanity-path> <max-processes>

Reads the server URL and API key from the rsconnect-python server store,
so the key never appears on the command line.
"""

import json
import sys
import urllib.request

from rsconnect.metadata import ServerStore


def call(server, key, method, path, body=None):
    req = urllib.request.Request(
        server.rstrip("/") + "/__api__" + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Key {key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as res:
        return json.loads(res.read() or "null")


def main(nickname, content_url, vanity, max_processes):
    entry = ServerStore().get_by_name(nickname)
    server, key = entry["url"], entry["api_key"]
    guid = content_url.rstrip("/").split("/")[-1]
    call(server, key, "PATCH", f"/v1/content/{guid}", {"min_processes": 1, "max_processes": int(max_processes)})
    vanity_info = call(server, key, "PUT", f"/v1/content/{guid}/vanity", {"path": vanity, "force": False})
    print(server.rstrip("/") + vanity_info["path"])


if __name__ == "__main__":
    main(*sys.argv[1:])
