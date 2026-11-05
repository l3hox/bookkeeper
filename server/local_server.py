"""Serves the app on localhost and keeps its data as JSON files in a data directory.

Layout of the data directory:

    settings.json
    meta.json
    contacts/<id>.json
    invoices/<number>.json
    pdf/                 printed invoices, saved there from the print dialog
    trash/               every replaced or removed file, timestamped, never deleted

Only the standard library is used, so `python3` is the whole runtime.
"""

import argparse
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATA_DIR = Path.home() / "Documents" / "Finance"
DATA_DIR_ENV = "INVOICES_DATA_DIR"
SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
API_HEADER = "X-Invoices-Api"


class DataError(Exception):
    """A request that would write outside the data directory or carries malformed data."""


def utc_stamp():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")


def resolve_inside(data_dir, *parts):
    """Returns the canonical path of `parts` under `data_dir`, refusing any path that escapes it."""
    root = data_dir.resolve()
    candidate = root.joinpath(*parts).resolve()
    if candidate != root and root not in candidate.parents:
        raise DataError(f"path escapes the data directory: {'/'.join(parts)}")
    return candidate


def file_name_for(value):
    if not isinstance(value, str) or not SAFE_NAME.match(value):
        raise DataError(f"unusable file name: {value!r}")
    return f"{value}.json"


def write_atomically(path, payload):
    """Writes bytes to a temporary file beside `path`, flushes it to disk, then renames it over `path`."""
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".tmp-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=4) + "\n").encode("utf-8")


def read_json(path, fallback):
    if not path.exists():
        return fallback
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


class DataStore:
    def __init__(self, data_dir):
        self.data_dir = data_dir.resolve()
        for folder in ("contacts", "invoices", "pdf", "trash"):
            (self.data_dir / folder).mkdir(parents=True, exist_ok=True)

    def trash_path_for(self, path):
        relative = path.relative_to(self.data_dir)
        stamp = utc_stamp()
        candidate = resolve_inside(self.data_dir, "trash", *relative.parent.parts, f"{path.stem}-{stamp}{path.suffix}")
        sequence = 1
        while candidate.exists():
            sequence += 1
            candidate = resolve_inside(self.data_dir, "trash", *relative.parent.parts, f"{path.stem}-{stamp}-{sequence}{path.suffix}")
        return candidate

    def move_to_trash(self, path):
        target = self.trash_path_for(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        os.replace(path, target)

    def write_file(self, path, value):
        payload = json_bytes(value)
        if path.exists():
            previous = path.read_bytes()
            if previous == payload:
                return
            write_atomically(self.trash_path_for(path), previous)
        write_atomically(path, payload)

    def read_folder(self, folder):
        records = []
        for path in sorted((self.data_dir / folder).glob("*.json")):
            records.append(read_json(path, None))
        return [record for record in records if record is not None]

    def state(self):
        return {
            "settings": read_json(self.data_dir / "settings.json", None),
            "meta": read_json(self.data_dir / "meta.json", None),
            "contacts": self.read_folder("contacts"),
            "invoices": self.read_folder("invoices"),
            "dataDir": str(self.data_dir),
        }

    def save_object(self, name, value):
        if not isinstance(value, dict):
            raise DataError(f"{name} must be an object")
        self.write_file(resolve_inside(self.data_dir, f"{name}.json"), value)

    def save_collection(self, folder, records, name_of):
        if not isinstance(records, list) or not all(isinstance(record, dict) for record in records):
            raise DataError(f"{folder} must be a list of objects")
        existing_by_id = {}
        for path in (self.data_dir / folder).glob("*.json"):
            record = read_json(path, None)
            if isinstance(record, dict) and "id" in record:
                existing_by_id[record["id"]] = path
        planned = []
        planned_paths = set()
        for record in records:
            if "id" not in record:
                raise DataError(f"a record in {folder} has no id")
            path = resolve_inside(self.data_dir, folder, file_name_for(name_of(record)))
            if path in planned_paths:
                raise DataError(f"two records in {folder} map to {path.name}")
            planned.append((record, path))
            planned_paths.add(path)
        planned_by_id = {record["id"]: path for record, path in planned}
        for record_id, previous_path in existing_by_id.items():
            if planned_by_id.get(record_id) != previous_path and previous_path.exists():
                self.move_to_trash(previous_path)
        for record, path in planned:
            self.write_file(path, record)


def invoice_file_stem(invoice):
    number = str(invoice.get("number", "")).strip()
    return number if SAFE_NAME.match(number) else str(invoice["id"])


def contact_file_stem(contact):
    return str(contact["id"])


class AppRequestHandler(SimpleHTTPRequestHandler):
    store = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP_ROOT), **kwargs)

    def log_message(self, format, *args):
        sys.stderr.write(f"{self.log_date_time_string()} {format % args}\n")

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, status, value):
        payload = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def request_is_from_the_app(self):
        """A custom header forces a CORS preflight that is never granted, so other sites cannot call the API."""
        if self.headers.get(API_HEADER) != "1":
            return False
        origin = self.headers.get("Origin")
        host = self.headers.get("Host", "")
        return origin is None or origin in (f"http://{host}",)

    def do_GET(self):
        if self.path.startswith("/api/"):
            if not self.request_is_from_the_app():
                self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
                return
            if self.path == "/api/state":
                self.send_json(HTTPStatus.OK, self.store.state())
                return
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "unknown endpoint"})
            return
        if not self.is_app_file(Path(self.translate_path(self.path)).resolve()):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        super().do_GET()

    @staticmethod
    def is_app_file(resolved):
        app_root = APP_ROOT.resolve()
        app_assets = app_root / "app"
        return resolved in (app_root, app_root / "index.html") or app_assets in resolved.parents

    def do_PUT(self):
        if not self.path.startswith("/api/") or not self.request_is_from_the_app():
            self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            if self.path == "/api/settings":
                self.store.save_object("settings", body)
            elif self.path == "/api/meta":
                self.store.save_object("meta", body)
            elif self.path == "/api/contacts":
                self.store.save_collection("contacts", body, contact_file_stem)
            elif self.path == "/api/invoices":
                self.store.save_collection("invoices", body, invoice_file_stem)
            else:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "unknown endpoint"})
                return
        except (DataError, ValueError) as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        except OSError as error:
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"disk write failed: {error}"})
            return
        self.send_json(HTTPStatus.OK, {"saved": True})


def refuse_data_dir_inside_repository(data_dir):
    resolved = data_dir.resolve()
    repository = APP_ROOT.resolve()
    if resolved == repository or repository in resolved.parents:
        raise SystemExit(f"Refusing a data directory inside the repository ({resolved}); invoices must never be committed.")


def parse_arguments(argv):
    parser = argparse.ArgumentParser(description="Serve the invoicing app with its data on disk.")
    parser.add_argument("--data", default=os.environ.get(DATA_DIR_ENV) or str(DEFAULT_DATA_DIR), help="data directory")
    parser.add_argument("--port", type=int, default=8765)
    return parser.parse_args(argv)


def main(argv=None):
    arguments = parse_arguments(argv)
    data_dir = Path(arguments.data).expanduser()
    refuse_data_dir_inside_repository(data_dir)
    AppRequestHandler.store = DataStore(data_dir)
    server = HTTPServer(("127.0.0.1", arguments.port), AppRequestHandler)
    print(f"Invoices: http://127.0.0.1:{arguments.port}/  data: {AppRequestHandler.store.data_dir}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
