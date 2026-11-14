#!/usr/bin/env python3
"""Aggregate privacy-safe public-menu traffic from Nginx access logs."""

from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import ipaddress
import json
import math
import re
import sys
from dataclasses import dataclass, field
from datetime import date, datetime
from glob import glob
from pathlib import Path
from urllib.parse import unquote, urlsplit
from zoneinfo import ZoneInfo


TIMEZONE = ZoneInfo("Asia/Tehran")
HLL_PRECISION = 12
HLL_SIZE = 1 << HLL_PRECISION
HLL_HASH_BITS = 64
HLL_PERSON = b"menu-analytics"
DEFAULT_LOG_GLOB = "/var/log/nginx/access.log*"
DEFAULT_DATA_DIR = "/var/lib/cafe-menu-analytics"

LEGACY_ACCESS_LINE = re.compile(
    r'^(?P<ip>\S+) \S+ \S+ \[(?P<time>[^\]]+)\] '
    r'"(?P<method>\S+) (?P<target>\S+) [^"]+" '
    r'(?P<status>\d{3}) (?P<bytes>\d+|-)'
)

IMAGE_EXTENSIONS = {".avif", ".gif", ".ico", ".jpeg", ".jpg", ".png", ".svg", ".webp"}
STATIC_EXTENSIONS = {
    ".css", ".js", ".json", ".map", ".otf", ".ttf", ".woff", ".woff2", ".xml",
}


@dataclass(slots=True)
class RequestEvent:
    timestamp: datetime
    client_ip: str
    method: str
    path: str
    status: int
    body_bytes: int
    content_type: str = ""
    qr_request_id: str = ""
    qr_visit_id: str = ""


class HyperLogLog:
    """Small mergeable estimate of distinct client IPs."""

    def __init__(self, registers: bytes | bytearray | None = None) -> None:
        self.registers = bytearray(registers if registers is not None else HLL_SIZE)
        if len(self.registers) != HLL_SIZE:
            raise ValueError("invalid HLL register count")

    def add_ip(self, address: str) -> None:
        packed_ip = ipaddress.ip_address(address).packed
        hashed = int.from_bytes(
            hashlib.blake2b(packed_ip, digest_size=8, person=HLL_PERSON).digest(), "big"
        )
        index = hashed >> (HLL_HASH_BITS - HLL_PRECISION)
        remainder = hashed & ((1 << (HLL_HASH_BITS - HLL_PRECISION)) - 1)
        width = HLL_HASH_BITS - HLL_PRECISION
        rank = width + 1 if remainder == 0 else width - remainder.bit_length() + 1
        self.registers[index] = max(self.registers[index], rank)

    def merge(self, other: HyperLogLog) -> None:
        for index, value in enumerate(other.registers):
            if value > self.registers[index]:
                self.registers[index] = value

    def estimate(self) -> int:
        size = len(self.registers)
        alpha = 0.7213 / (1 + 1.079 / size)
        raw = alpha * size * size / sum(2.0 ** -register for register in self.registers)
        empty = self.registers.count(0)
        if raw <= 2.5 * size and empty:
            raw = size * math.log(size / empty)
        elif raw > (1 << HLL_HASH_BITS) / 30:
            raw = -(1 << HLL_HASH_BITS) * math.log1p(-raw / (1 << HLL_HASH_BITS))
        return max(0, round(raw))

    def encode(self) -> str:
        return base64.b64encode(self.registers).decode("ascii")

    @classmethod
    def decode(cls, encoded: str) -> HyperLogLog:
        return cls(base64.b64decode(encoded, validate=True))


@dataclass
class DailyMetrics:
    local_date: str
    menu_requests: int = 0
    menu_get_requests: int = 0
    menu_successful_requests: int = 0
    qr_redirect_requests: int = 0
    qr_redirect_responses: int = 0
    correlated_qr_redirect_requests: int = 0
    unlinked_qr_route_requests: int = 0
    qr_origin_menu_requests: int = 0
    paired_qr_visits: int = 0
    unpaired_qr_redirects: int = 0
    hourly_menu_get_requests: list[int] = field(default_factory=lambda: [0] * 24)
    payload_bytes: dict[str, int] = field(
        default_factory=lambda: {
            "menu_page": 0, "menu_data": 0, "menu_api": 0, "images": 0, "static_files": 0,
        }
    )
    payload_requests: dict[str, int] = field(
        default_factory=lambda: {
            "menu_page": 0, "menu_data": 0, "menu_api": 0, "images": 0, "static_files": 0,
        }
    )
    menu_service_payload_bytes: int = 0
    other_service_payload_bytes: int = 0
    status_counts: dict[str, int] = field(default_factory=dict)
    menu_status_counts: dict[str, int] = field(default_factory=dict)
    other_service_status_counts: dict[str, int] = field(default_factory=dict)
    ip_sketch: HyperLogLog = field(default_factory=HyperLogLog)
    qr_redirect_ids: list[tuple[str, int]] = field(default_factory=list)
    qr_landing_ids: list[tuple[str, int]] = field(default_factory=list)

    def add(self, event: RequestEvent, hour: int) -> None:
        status_code = str(event.status)
        self.status_counts[status_code] = self.status_counts.get(status_code, 0) + 1
        menu_service_request = is_menu_service_path(event.path)
        status_bucket = self.menu_status_counts if menu_service_request else self.other_service_status_counts
        status_bucket[status_code] = status_bucket.get(status_code, 0) + 1
        if menu_service_request:
            self.menu_service_payload_bytes += event.body_bytes
        else:
            self.other_service_payload_bytes += event.body_bytes

        if event.path == "/menu":
            self.menu_requests += 1
            if event.method == "GET":
                self.menu_get_requests += 1
                self.hourly_menu_get_requests[hour] += 1
                try:
                    self.ip_sketch.add_ip(event.client_ip)
                except ValueError:
                    pass
            if 200 <= event.status < 300:
                self.menu_successful_requests += 1
            if event.qr_visit_id:
                self.qr_landing_ids.append((event.qr_visit_id, event.status))

        if event.path.startswith("/t/"):
            self.qr_redirect_requests += 1
            if event.qr_request_id:
                self.correlated_qr_redirect_requests += 1
            else:
                self.unlinked_qr_route_requests += 1
            if 300 <= event.status < 400:
                self.qr_redirect_responses += 1
            if event.qr_request_id:
                self.qr_redirect_ids.append((event.qr_request_id, event.status))

        category = classify_payload(event.path, event.content_type)
        if category:
            self.payload_bytes[category] += event.body_bytes
            self.payload_requests[category] += 1

    def as_json(self) -> dict[str, object]:
        return {
            "schema_version": 2,
            "date": self.local_date,
            "menu_requests": self.menu_requests,
            "menu_get_requests": self.menu_get_requests,
            "menu_successful_requests": self.menu_successful_requests,
            "qr_redirect_requests": self.qr_redirect_requests,
            "qr_redirect_responses": self.qr_redirect_responses,
            "correlated_qr_redirect_requests": self.correlated_qr_redirect_requests,
            "unlinked_qr_route_requests": self.unlinked_qr_route_requests,
            "qr_origin_menu_requests": self.qr_origin_menu_requests,
            "paired_qr_visits": self.paired_qr_visits,
            "unpaired_qr_redirects": self.unpaired_qr_redirects,
            "hourly_menu_get_requests": self.hourly_menu_get_requests,
            "payload_bytes": self.payload_bytes,
            "payload_requests": self.payload_requests,
            "menu_service_payload_bytes": self.menu_service_payload_bytes,
            "other_service_payload_bytes": self.other_service_payload_bytes,
            "status_counts": self.status_counts,
            "menu_status_counts": self.menu_status_counts,
            "other_service_status_counts": self.other_service_status_counts,
            "unique_client_ip_estimate": self.ip_sketch.estimate(),
            "ip_sketch": self.ip_sketch.encode(),
        }


def parse_timestamp(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return datetime.strptime(value, "%d/%b/%Y:%H:%M:%S %z")


def parse_event(line: str) -> RequestEvent | None:
    """Parse current JSON records and legacy Nginx combined records."""
    try:
        record = json.loads(line)
    except json.JSONDecodeError:
        record = None

    if isinstance(record, dict) and "timestamp" in record:
        try:
            timestamp = parse_timestamp(str(record["timestamp"]))
            return RequestEvent(
                timestamp=timestamp,
                client_ip=str(record.get("client_ip", "")),
                method=str(record.get("method", "")),
                path=unquote(urlsplit(str(record.get("uri", ""))).path),
                status=int(record.get("status", 0)),
                body_bytes=max(0, int(record.get("body_bytes_sent", 0))),
                content_type=str(record.get("content_type", "")).lower(),
                qr_request_id=str(record.get("qr_request_id", "")),
                qr_visit_id=str(record.get("qr_visit_id", "")),
            )
        except (KeyError, TypeError, ValueError, OverflowError):
            return None

    match = LEGACY_ACCESS_LINE.match(line)
    if not match:
        return None
    try:
        return RequestEvent(
            timestamp=parse_timestamp(match.group("time")),
            client_ip=match.group("ip"),
            method=match.group("method"),
            path=unquote(urlsplit(match.group("target")).path),
            status=int(match.group("status")),
            body_bytes=0 if match.group("bytes") == "-" else int(match.group("bytes")),
        )
    except (TypeError, ValueError, OverflowError):
        return None


def classify_payload(path: str, content_type: str) -> str | None:
    if path == "/menu":
        return "menu_page"
    if path == "/api/public-menu":
        return "menu_data"
    if path.startswith("/api/product-images/"):
        return "images"
    if path.startswith("/api/"):
        return "menu_api"
    if path.startswith("/_next/image"):
        return "images"

    is_known_menu_asset = path.startswith(
        ("/_next/static/", "/_next/image", "/items_pictures/", "/items/", "/fonts/")
    )
    is_root_static_asset = path.startswith("/") and path.rsplit("/", 1)[-1].find(".") > 0
    if not is_known_menu_asset and not is_root_static_asset:
        return None
    if path.startswith(("/api/", "/pos/", "/t/")):
        return None

    extension = Path(path).suffix.lower()
    if content_type.startswith("image/") or extension in IMAGE_EXTENSIONS:
        return "images"
    if (
        content_type.startswith(("font/", "text/css", "text/javascript", "application/javascript"))
        or extension in STATIC_EXTENSIONS
        or is_known_menu_asset
        or is_root_static_asset
    ):
        return "static_files"
    return None


def is_menu_service_path(path: str) -> bool:
    if path == "/pos" or path.startswith("/pos/"):
        return False
    if path in {"/", "/menu"} or path.startswith(
        ("/t/", "/api/", "/_next/", "/items_pictures/", "/items/", "/fonts/")
    ):
        return True
    return path.startswith("/") and path.rsplit("/", 1)[-1].find(".") > 0


def aggregate(log_pattern: str, data_dir: Path) -> int:
    metrics: dict[str, DailyMetrics] = {}
    redirect_ids: dict[str, tuple[str, int]] = {}
    landing_events: list[tuple[str, str, int]] = []
    bad_lines = 0
    parsed_lines = 0
    skipped_files = 0

    paths = [Path(item) for item in sorted(glob(log_pattern)) if Path(item).is_file()]
    for path in paths:
        try:
            opener = gzip.open if path.name.endswith(".gz") else Path.open
            with opener(path, "rt", encoding="utf-8", errors="replace") as source:
                for line in source:
                    parsed_lines += 1
                    event = parse_event(line)
                    if event is None:
                        bad_lines += 1
                        continue
                    local_time = event.timestamp.astimezone(TIMEZONE)
                    day = local_time.date().isoformat()
                    daily = metrics.setdefault(day, DailyMetrics(day))
                    daily.add(event, local_time.hour)
                    if event.path.startswith("/t/") and event.qr_request_id:
                        redirect_ids[event.qr_request_id] = (day, event.status)
                    if event.path == "/menu" and event.qr_visit_id:
                        landing_events.append((event.qr_visit_id, day, event.status))
        except OSError:
            skipped_files += 1

    successful_landings: set[str] = set()
    paired_landing_days: dict[str, str] = {}
    for visit_id, landing_day, status in landing_events:
        redirect = redirect_ids.get(visit_id)
        if not redirect or not (300 <= redirect[1] < 400):
            continue
        metrics[landing_day].qr_origin_menu_requests += 1
        if 200 <= status < 400:
            successful_landings.add(visit_id)
            paired_landing_days.setdefault(visit_id, landing_day)

    for landing_day in paired_landing_days.values():
        metrics[landing_day].paired_qr_visits += 1

    for day, daily in metrics.items():
        for visit_id, status in daily.qr_redirect_ids:
            if 300 <= status < 400 and visit_id not in successful_landings:
                daily.unpaired_qr_redirects += 1

    data_dir.mkdir(parents=True, exist_ok=True)
    for day, daily in metrics.items():
        destination = data_dir / f"{day}.json"
        temporary = destination.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(daily.as_json(), separators=(",", ":")) + "\n", encoding="utf-8")
        temporary.replace(destination)

    print(
        f"Aggregated {parsed_lines - bad_lines} access-log records into {len(metrics)} Tehran-date summaries; "
        f"skipped {bad_lines} malformed lines and {skipped_files} unreadable log files."
    )
    return 0


def format_bytes(value: int) -> str:
    if value < 1000:
        return f"{value} B"
    units = ("KB", "MB", "GB", "TB")
    amount = float(value)
    for unit in units:
        amount /= 1000
        if amount < 1000 or unit == units[-1]:
            return f"{amount:.2f} {unit}"
    return f"{value} B"


def load_summaries(data_dir: Path, selector: str, selector_value: str) -> list[dict[str, object]]:
    summaries: list[dict[str, object]] = []
    for path in sorted(data_dir.glob("*.json")):
        if path.name == "metadata.json":
            continue
        if selector == "day" and path.stem != selector_value:
            continue
        if selector == "month" and not path.stem.startswith(selector_value):
            continue
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            if value.get("schema_version") == 2:
                summaries.append(value)
        except (OSError, json.JSONDecodeError, AttributeError):
            continue
    return summaries


def build_report(rows: list[dict[str, object]]) -> dict[str, object]:
    hourly = [0] * 24
    byte_totals = {
        "menu_page": 0, "menu_data": 0, "menu_api": 0, "images": 0, "static_files": 0,
    }
    request_totals = {key: 0 for key in byte_totals}
    status_totals: dict[str, int] = {}
    menu_status_totals: dict[str, int] = {}
    other_service_status_totals: dict[str, int] = {}
    ip_sketch = HyperLogLog()
    daily_payload_rows: list[dict[str, object]] = []
    sums = {
        "menu_requests": 0,
        "menu_get_requests": 0,
        "menu_successful_requests": 0,
        "qr_redirect_requests": 0,
        "qr_redirect_responses": 0,
        "correlated_qr_redirect_requests": 0,
        "unlinked_qr_route_requests": 0,
        "qr_origin_menu_requests": 0,
        "paired_qr_visits": 0,
        "unpaired_qr_redirects": 0,
    }
    for row in rows:
        for key in sums:
            sums[key] += int(row.get(key, 0))
        row_hours = row.get("hourly_menu_get_requests", [])
        if isinstance(row_hours, list) and len(row_hours) == 24:
            for hour, value in enumerate(row_hours):
                hourly[hour] += int(value)
        row_bytes = row.get("payload_bytes", {})
        if isinstance(row_bytes, dict):
            for key in byte_totals:
                byte_totals[key] += int(row_bytes.get(key, 0))
        row_requests = row.get("payload_requests", {})
        if isinstance(row_requests, dict):
            for key in request_totals:
                request_totals[key] += int(row_requests.get(key, 0))
        for field_name, destination in (
            ("status_counts", status_totals),
            ("menu_status_counts", menu_status_totals),
            ("other_service_status_counts", other_service_status_totals),
        ):
            row_statuses = row.get(field_name, {})
            if isinstance(row_statuses, dict):
                for code, count in row_statuses.items():
                    key = str(code)
                    destination[key] = destination.get(key, 0) + int(count)
        menu_bytes = int(row.get("menu_service_payload_bytes", sum(int(v) for v in row_bytes.values()) if isinstance(row_bytes, dict) else 0))
        other_bytes = int(row.get("other_service_payload_bytes", 0))
        daily_payload_rows.append({
            "date": str(row["date"]),
            "menu_bytes": menu_bytes,
            "other_service_bytes": other_bytes,
            "total_bytes": menu_bytes + other_bytes,
            "image_bytes": int(row_bytes.get("images", 0)) if isinstance(row_bytes, dict) else 0,
        })
        try:
            ip_sketch.merge(HyperLogLog.decode(str(row["ip_sketch"])))
        except (KeyError, ValueError, TypeError):
            continue

    peak_day = max(daily_payload_rows, key=lambda item: int(item["total_bytes"]))
    return {
        "period_start": min(str(row["date"]) for row in rows),
        "period_end": max(str(row["date"]) for row in rows),
        "days_with_data": len(rows),
        **sums,
        "hourly_menu_get_requests": hourly,
        "payload_bytes": byte_totals,
        "payload_requests": request_totals,
        "menu_service_payload_bytes": sum(int(item["menu_bytes"]) for item in daily_payload_rows),
        "other_service_payload_bytes": sum(int(item["other_service_bytes"]) for item in daily_payload_rows),
        "total_origin_payload_bytes": sum(int(item["total_bytes"]) for item in daily_payload_rows),
        "status_counts": status_totals,
        "menu_status_counts": menu_status_totals,
        "other_service_status_counts": other_service_status_totals,
        "peak_daily_payload": peak_day,
        "unique_client_ip_estimate": ip_sketch.estimate(),
    }


def print_report(
    report: dict[str, object], label: str, *, partial_day: bool = False, month_to_date: bool = False,
) -> None:
    hours = report["hourly_menu_get_requests"]
    assert isinstance(hours, list)
    top_hours = sorted(range(24), key=lambda hour: (-int(hours[hour]), hour))[:3]
    top_display = ", ".join(
        f"{hour:02d}:00–{hour:02d}:59 ({hours[hour]} requests)"
        for hour in top_hours
        if int(hours[hour]) > 0
    ) or "No menu GET requests"

    payload = report["payload_bytes"]
    assert isinstance(payload, dict)
    payload_requests = report["payload_requests"]
    assert isinstance(payload_requests, dict)
    peak_daily_payload = report["peak_daily_payload"]
    assert isinstance(peak_daily_payload, dict)
    print(f"Menu traffic report — {label} (Asia/Tehran)")
    period_note = " (current day is partial)" if partial_day or month_to_date else ""
    print(
        f"Summary coverage: {report['days_with_data']} day(s), "
        f"{report['period_start']} through {report['period_end']}{period_note}"
    )
    print(
        f"/menu requests: {report['menu_requests']} total; "
        f"{report['menu_get_requests']} GET; {report['menu_successful_requests']} successful 2xx"
    )
    print(
        f"Table QR routes: {report['qr_redirect_requests']} requests, "
        f"{report['qr_redirect_responses']} redirects "
        f"({report['correlated_qr_redirect_requests']} ID-correlated, "
        f"{report['unlinked_qr_route_requests']} without an ID); "
        f"{report['paired_qr_visits']} correlated menu landings; "
        f"{report['unpaired_qr_redirects']} unpaired redirects"
    )
    print("QR landings are a subset of /menu requests; never add redirect counts to page totals.")
    if int(report["unlinked_qr_route_requests"]):
        print("QR route requests without an ID cannot be paired to /menu and are excluded from correlated visit counts.")
    print("HTTP status codes (all Nginx-routed responses): " + format_status_counts(report["status_counts"]))
    print("  Menu service: " + format_status_counts(report["menu_status_counts"]))
    print("  Other services: " + format_status_counts(report["other_service_status_counts"]))
    print(f"Peak menu-request hours: {top_display}")
    print(f"Approx. distinct client IPs: {report['unique_client_ip_estimate']}")
    print(
        f"Highest daily origin payload: {peak_daily_payload['date']} — "
        f"{format_bytes(int(peak_daily_payload['total_bytes']))} total "
        f"(menu {format_bytes(int(peak_daily_payload['menu_bytes']))}; "
        f"other services {format_bytes(int(peak_daily_payload['other_service_bytes']))})"
    )
    print(
        f"Response-body payload in period: {format_bytes(int(report['total_origin_payload_bytes']))} total "
        f"(menu {format_bytes(int(report['menu_service_payload_bytes']))}; "
        f"other services {format_bytes(int(report['other_service_payload_bytes']))})"
    )
    print(
        f"  Menu page: {payload_requests['menu_page']} responses, "
        f"{format_bytes(int(payload['menu_page']))}"
    )
    print(
        f"  Public-menu data: {payload_requests['menu_data']} responses, "
        f"{format_bytes(int(payload['menu_data']))}"
    )
    print(
        f"  Other menu API: {payload_requests['menu_api']} responses, "
        f"{format_bytes(int(payload['menu_api']))}"
    )
    print(
        f"  Menu images (including /_next/image and product-image uploads): {payload_requests['images']} responses, "
        f"{format_bytes(int(payload['images']))}"
    )
    print(
        f"  Other static files: {payload_requests['static_files']} responses, "
        f"{format_bytes(int(payload['static_files']))}"
    )
    print("Counts are HTTP requests, not confirmed people or page renders; body bytes exclude headers and transport overhead.")


def format_status_counts(value: object) -> str:
    if not isinstance(value, dict) or not value:
        return "no responses"
    return ", ".join(
        f"{code}={count}"
        for code, count in sorted(value.items(), key=lambda item: int(item[0]))
    )


def report(data_dir: Path, day_value: str | None, month_value: str | None) -> int:
    selector = "day" if day_value else "month"
    selector_value = day_value or month_value or ""
    if selector == "day":
        try:
            date.fromisoformat(selector_value)
        except ValueError:
            print("Day must use YYYY-MM-DD.", file=sys.stderr)
            return 2
    else:
        if not re.fullmatch(r"\d{4}-\d{2}", selector_value):
            print("Month must use YYYY-MM.", file=sys.stderr)
            return 2
        try:
            date.fromisoformat(f"{selector_value}-01")
        except ValueError:
            print("Month must use YYYY-MM.", file=sys.stderr)
            return 2

    rows = load_summaries(data_dir, selector, selector_value)
    if not rows:
        print(f"No summaries found for {selector_value} in {data_dir}.", file=sys.stderr)
        return 1
    now_tehran = datetime.now(TIMEZONE)
    print_report(
        build_report(rows),
        selector_value,
        partial_day=selector == "day" and selector_value == now_tehran.date().isoformat(),
        month_to_date=selector == "month" and selector_value == now_tehran.strftime("%Y-%m"),
    )
    return 0


def make_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default=DEFAULT_DATA_DIR, help=argparse.SUPPRESS)
    commands = parser.add_subparsers(dest="command", required=True)
    aggregate_parser = commands.add_parser("aggregate", help="update summaries from available Nginx logs")
    aggregate_parser.add_argument("--log-glob", default=DEFAULT_LOG_GLOB, help=argparse.SUPPRESS)
    report_parser = commands.add_parser("report", help="print one daily or monthly report")
    period = report_parser.add_mutually_exclusive_group(required=True)
    period.add_argument("--day", help="report one Tehran calendar day as YYYY-MM-DD")
    period.add_argument("--month", help="report one Tehran calendar month as YYYY-MM")
    return parser


def main() -> int:
    args = make_parser().parse_args()
    data_dir = Path(args.data_dir)
    if args.command == "aggregate":
        return aggregate(args.log_glob, data_dir)
    return report(data_dir, args.day, args.month)


if __name__ == "__main__":
    raise SystemExit(main())
