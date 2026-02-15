#!/usr/bin/env python3
"""
LifeLink local BLE gateway service.

Runs a localhost HTTP API that the Next.js /bridge page can call:
- scan BLE devices
- connect/disconnect to one ESP32 node
- send commands (WHOAMI / NAME / SEND)
- fetch state and logs
"""

from __future__ import annotations

import asyncio
import time
from collections import deque
from dataclasses import dataclass, asdict
from typing import Any

from bleak import BleakClient, BleakScanner
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn


NUS_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
NUS_RX_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
NUS_TX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"
KNOWN_ESP32_OUI_PREFIXES = ("3C:0F:02",)
DEVICE_CACHE_TTL_S = 180.0

# BLE response timeouts tuned for real-world ESP32 latency
# First BLE command after connect can take 1-2s (connection interval warmup)
# Subsequent commands are typically <200ms
BLE_TIMEOUT_FIRST = 2.0    # first command right after connect
BLE_TIMEOUT_NORMAL = 0.8   # normal command timeouts
BLE_TIMEOUT_FAST = 0.5     # fast simple lookups (HISTGET etc. after warm link)

# ---------------------------------------------------------------------------
# Single global lock for ALL outgoing Bluetooth operations (connect, send,
# disconnect).  Every code path that touches the BLE adapter acquires this
# lock first so requests are fully serialised.
# ---------------------------------------------------------------------------
_ble_lock = asyncio.Lock()


@dataclass
class GatewayState:
  connected: bool = False
  ble_name: str = ""
  ble_address: str = ""
  node_id: str = ""
  node_name: str = ""
  hop_leader: str = ""
  hop_seed: str = ""
  hop_seq: int = 0
  hop_channel: int = 0
  hop_frequency_mhz: float = 0.0
  last_response: str = ""


class ConnectBody(BaseModel):
  address: str = Field(min_length=2)


class CommandBody(BaseModel):
  command: str = Field(min_length=1, max_length=512)


class BleGateway:
  def __init__(self) -> None:
    self._client: BleakClient | None = None
    self._rx_char: Any = None
    self._tx_char: Any = None
    self._state = GatewayState()
    self._logs: deque[str] = deque(maxlen=300)
    self._response_event = asyncio.Event()
    self._recent_devices: dict[str, tuple[dict[str, Any], float]] = {}
    self._message_cache: list[dict[str, Any]] = []
    self._member_cache: list[dict[str, Any]] = []

  def _log(self, line: str) -> None:
    ts = time.strftime("%H:%M:%S")
    self._logs.appendleft(f"[{ts}] {line}")
    print(f"log: {line}")

  def _on_disconnect(self, _client: BleakClient) -> None:
    self._state.connected = False
    self._log("BLE disconnected.")

  def _on_notify(self, _sender: int, data: bytearray) -> None:
    text = data.decode("utf-8", errors="replace").strip()
    if not text:
      return
    self._state.last_response = text
    self._log(f"RX {self._state.ble_address}: {text}")
    self._response_event.set()

    if text.startswith("OK|WHOAMI|"):
      parts = text.split("|")
      if len(parts) >= 4:
        self._state.node_id = parts[2].upper()
        self._state.node_name = parts[3]
    elif text.startswith("OK|NAME|"):
      parts = text.split("|")
      if len(parts) >= 3:
        self._state.node_name = parts[2]
    elif text.startswith("OK|STATUS|"):
      parts = text.split("|")
      # OK|STATUS|id|name|leader|seed|seq|channel|freq
      if len(parts) >= 9:
        self._state.node_id = parts[2].upper()
        self._state.node_name = parts[3]
        self._state.hop_leader = parts[4].upper()
        self._state.hop_seed = parts[5].upper()
        try:
          self._state.hop_seq = int(parts[6])
          self._state.hop_channel = int(parts[7])
          self._state.hop_frequency_mhz = float(parts[8])
        except ValueError:
          pass

  async def scan(self, timeout: float = 2.2) -> list[dict[str, Any]]:
    rounds = max(1, min(3, int(timeout // 1) + 1))
    per_round = max(0.6, min(1.2, timeout / rounds))
    for _ in range(rounds):
      devices = await BleakScanner.discover(timeout=per_round)
      now = time.time()
      for d in devices:
        uuids = {(u or "").lower() for u in (d.metadata.get("uuids") or [])}
        name = d.name or d.metadata.get("local_name") or ""
        addr = (d.address or "").upper()
        looks_esp32 = any(addr.startswith(prefix) for prefix in KNOWN_ESP32_OUI_PREFIXES)
        if NUS_SERVICE_UUID in uuids or name.startswith("LifeLink") or looks_esp32:
          self._recent_devices[d.address] = (
              {
                  "name": name or "LifeLink",
                  "address": d.address,
                  "rssi": d.rssi,
              },
              now,
          )
      await asyncio.sleep(0.05)

    now = time.time()
    fresh: list[dict[str, Any]] = []
    for addr, (entry, seen_at) in list(self._recent_devices.items()):
      if now - seen_at <= DEVICE_CACHE_TTL_S:
        fresh.append(entry)
      else:
        del self._recent_devices[addr]

    if self._state.connected and self._state.ble_address:
      connected_addr = self._state.ble_address
      if not any((d.get("address") or "").upper() == connected_addr.upper() for d in fresh):
        cached = self._recent_devices.get(connected_addr)
        cached_rssi = cached[0].get("rssi", 0) if cached else 0
        fresh.append(
            {
                "name": self._state.node_name or "LifeLink",
                "address": connected_addr,
                "rssi": cached_rssi,
            }
        )

    fresh.sort(key=lambda x: x.get("rssi", -999), reverse=True)
    return fresh

  async def connect(self, address: str) -> None:
    # -- Connection setup under lock (all BLE adapter access) ---------------
    async with _ble_lock:
      if (
          self._client is not None
          and self._client.is_connected
          and self._state.connected
          and self._state.ble_address.upper() == address.upper()
      ):
        self._log(f"Already connected to {address}.")
        return

      # Non-blocking disconnect of previous connection
      await self._disconnect_inner_fast()
      # Brief pause to let BlueZ finish tearing down the old connection
      await asyncio.sleep(0.3)

      self._log(f"Connecting to {address}...")

      # On Linux/BlueZ, BleakClient(address_str) can fail if the device isn't
      # in the adapter cache. Use find_device_by_address to resolve first.
      device = await BleakScanner.find_device_by_address(address, timeout=2.0)
      if device is None:
        raise RuntimeError(f"Device {address} not found. Try scanning first.")

      client = BleakClient(device, disconnected_callback=self._on_disconnect)
      try:
        await asyncio.wait_for(client.connect(timeout=3.0), timeout=4.0)
        svcs = await client.get_services()
        rx = svcs.get_characteristic(NUS_RX_UUID)
        tx = svcs.get_characteristic(NUS_TX_UUID)
        if rx is None or tx is None:
          raise RuntimeError("NUS RX/TX characteristics not found on device.")

        await client.start_notify(tx, self._on_notify)
        self._client = client
        self._rx_char = rx
        self._tx_char = tx
        self._state.connected = True
        self._state.ble_address = address
        self._state.ble_name = client.address
        self._state.last_response = ""
        self._message_cache = []
        self._member_cache = []
        self._recent_devices[address] = (
            {
                "name": "LifeLink",
                "address": address,
                "rssi": 0,
            },
            time.time(),
        )
        self._log("BLE connected.")

      except Exception:
        await self._disconnect_inner_fast()
        raise

    # -- Post-connect identity fetch (each acquires _ble_lock via
    #    _send_and_wait_locked) ------------------------------------------------
    try:
      await self._send_and_wait_locked("WHOAMI", ("OK|WHOAMI|",), timeout=BLE_TIMEOUT_FIRST, attempts=1)
    except Exception:
      pass
    try:
      await self._send_and_wait_locked("STATUS", ("OK|STATUS|",), timeout=BLE_TIMEOUT_NORMAL, attempts=1)
    except Exception:
      pass

  async def _disconnect_inner_fast(self) -> None:
    """Quick disconnect — doesn't wait for BLE teardown."""
    if self._client is None:
      self._state = GatewayState()
      self._message_cache = []
      self._member_cache = []
      return

    client = self._client
    tx_char = self._tx_char
    self._client = None
    self._rx_char = None
    self._tx_char = None
    self._state = GatewayState()
    self._message_cache = []
    self._member_cache = []
    self._log("BLE disconnecting...")

    # Fire-and-forget BLE teardown in background
    async def _teardown() -> None:
      try:
        if tx_char is not None:
          await client.stop_notify(tx_char)
      except Exception:
        pass
      try:
        await client.disconnect()
      except Exception:
        pass

    asyncio.create_task(_teardown())

  async def disconnect(self) -> None:
    async with _ble_lock:
      await self._disconnect_inner_fast()

  async def send_command(self, command: str) -> None:
    expected_prefixes: tuple[str, ...] = ()
    timeout_s = BLE_TIMEOUT_NORMAL
    attempts = 2
    if command == "WHOAMI":
      expected_prefixes = ("OK|WHOAMI|",)
    elif command == "STATUS":
      expected_prefixes = ("OK|STATUS|",)
    elif command.startswith("NAME|"):
      expected_prefixes = ("OK|NAME|",)
    elif command.startswith("SEND|"):
      expected_prefixes = ("OK|SEND|", "ERR|SEND|")
    elif command == "HISTCOUNT":
      expected_prefixes = ("OK|HISTCOUNT|",)
    elif command.startswith("HISTGET|"):
      expected_prefixes = ("OK|HIST|", "ERR|HIST|")
    elif command == "MEMCOUNT":
      expected_prefixes = ("OK|MEMCOUNT|",)
    elif command.startswith("MEMGET|"):
      expected_prefixes = ("OK|MEM|", "ERR|MEM|")
    await self._send_and_wait_locked(command, expected_prefixes, timeout=timeout_s, attempts=attempts)

  async def fetch_messages(self, limit: int = 40) -> list[dict[str, Any]]:
    if self._client is None or not self._client.is_connected or self._rx_char is None:
      return self._message_cache[:]

    try:
      resp = await self._send_and_wait_locked("HISTCOUNT", ("OK|HISTCOUNT|",), timeout=BLE_TIMEOUT_NORMAL, attempts=2)
    except Exception:
      return self._message_cache[:]

    parts = resp.split("|")
    if len(parts) < 3:
      return self._message_cache[:]
    try:
      count = int(parts[2])
    except ValueError:
      return self._message_cache[:]

    if count <= 0:
      self._message_cache = []
      return []

    # Poll every message — each HISTGET gets enough attempts to succeed
    fresh: list[dict[str, Any]] = []
    for idx in range(count):
      try:
        resp = await self._send_and_wait_locked(f"HISTGET|{idx}", ("OK|HIST|",), timeout=BLE_TIMEOUT_FAST, attempts=5)
      except Exception:
        continue
      row = resp.split("|")
      # OK|HIST|idx|dir|peer|msg|vital|intent|urg|hexbody  (10 fields)
      if len(row) < 10:
        continue
      hex_body = row[9]
      try:
        body = bytes.fromhex(hex_body).decode("utf-8", errors="replace")
      except ValueError:
        body = ""
      fresh.append(
          {
              "idx": int(row[2]),
              "direction": row[3],
              "peer": row[4].upper(),
              "msg_id": int(row[5]),
              "vital": row[6] == "1",
              "intent": row[7],
              "urgency": int(row[8]),
              "body": body,
          }
      )

    fresh_list = fresh

    self._message_cache = fresh_list

    # Log a plain text summary of the full message history
    if fresh_list:
      self._log(f"--- Message history ({len(fresh_list)} messages) ---")
      for m in fresh_list:
        direction = "SENT" if m["direction"] == "S" else "RECV"
        vital_tag = " [VITAL]" if m["vital"] else ""
        self._log(
            f"  #{m['idx']} {direction} peer={m['peer']} "
            f"msg_id={m['msg_id']}{vital_tag} "
            f"intent={m['intent']} urg={m['urgency']} "
            f"body=\"{m['body']}\""
        )
      self._log("--- End message history ---")
    else:
      self._log("Message history: empty (0 messages)")

    clipped_limit = max(1, min(limit, 200))
    return self._message_cache[-clipped_limit:]

  async def fetch_members(self, limit: int = 40) -> list[dict[str, Any]]:
    if self._client is None or not self._client.is_connected or self._rx_char is None:
      return self._member_cache[:]

    try:
      resp = await self._send_and_wait_locked("MEMCOUNT", ("OK|MEMCOUNT|",), timeout=BLE_TIMEOUT_NORMAL, attempts=2)
    except Exception:
      return self._member_cache[:]

    parts = resp.split("|")
    if len(parts) < 3:
      return self._member_cache[:]
    try:
      count = int(parts[2])
    except ValueError:
      return self._member_cache[:]

    start = max(0, count - max(1, min(limit, 200)))
    out: list[dict[str, Any]] = []
    for idx in range(start, count):
      try:
        resp = await self._send_and_wait_locked(f"MEMGET|{idx}", ("OK|MEM|",), timeout=BLE_TIMEOUT_FAST, attempts=2)
      except Exception:
        break
      row = resp.split("|")
      # OK|MEM|idx|node_id|name|age_ms|hb_seq|seed|hops_away
      if len(row) < 8:
        continue
      out.append(
          {
              "idx": int(row[2]),
              "node_id": row[3].upper(),
              "name": row[4],
              "age_ms": int(row[5]),
              "heartbeat_seq": int(row[6]),
              "hop_seed": row[7].upper(),
              "hops_away": int(row[8]) if len(row) > 8 else 1,
          }
      )
    self._member_cache = out
    return out

  async def _send_and_wait_locked(
      self,
      command: str,
      expected_prefixes: tuple[str, ...],
      timeout: float,
      attempts: int,
  ) -> str:
    """Send a BLE command and wait for the expected response.

    Acquires ``_ble_lock`` for the entire send-wait cycle so that only
    one BLE command is in flight at a time.  Returns the response string
    captured from the device.
    """
    async with _ble_lock:
      if self._client is None or not self._client.is_connected or self._rx_char is None:
        raise RuntimeError("No BLE device connected.")

      for attempt in range(attempts):
        self._response_event.clear()
        self._log(f"TX: {command}")
        payload = command.encode("utf-8")
        await asyncio.wait_for(self._client.write_gatt_char(self._rx_char, payload, response=False), timeout=1.5)
        if not expected_prefixes:
          return self._state.last_response
        try:
          await asyncio.wait_for(self._response_event.wait(), timeout=timeout)
        except asyncio.TimeoutError:
          if attempt + 1 == attempts:
            raise RuntimeError(f"No response to '{command}'")
          continue

        if any(self._state.last_response.startswith(prefix) for prefix in expected_prefixes):
          return self._state.last_response
        if attempt + 1 == attempts:
          raise RuntimeError(f"Unexpected response '{self._state.last_response}' for '{command}'")
        await asyncio.sleep(0.02)

      return self._state.last_response

  def state(self) -> dict[str, Any]:
    return asdict(self._state)

  def logs(self) -> list[str]:
    return list(self._logs)


gateway = BleGateway()
app = FastAPI(title="LifeLink BLE Gateway", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health() -> dict[str, Any]:
  return {"ok": True, "busy": _ble_lock.locked(), "state": gateway.state()}


@app.get("/devices")
async def devices(timeout: float = 2.2) -> dict[str, Any]:
  return {"devices": await gateway.scan(timeout=max(0.6, min(timeout, 6.0)))}


@app.post("/connect")
async def connect(body: ConnectBody) -> dict[str, Any]:
  try:
    await gateway.connect(body.address)
    return {"ok": True, "state": gateway.state()}
  except Exception as exc:
    raise HTTPException(status_code=400, detail=str(exc))


@app.post("/disconnect")
async def disconnect() -> dict[str, Any]:
  await gateway.disconnect()
  return {"ok": True}


@app.post("/command")
async def command(body: CommandBody) -> dict[str, Any]:
  try:
    await gateway.send_command(body.command.strip())
    return {"ok": True}
  except Exception as exc:
    raise HTTPException(status_code=400, detail=str(exc))


@app.get("/state")
async def state() -> dict[str, Any]:
  return {"state": gateway.state(), "busy": _ble_lock.locked(), "logs": gateway.logs()}


@app.get("/messages")
async def messages(limit: int = 40) -> dict[str, Any]:
  try:
    items = await gateway.fetch_messages(limit=max(1, min(limit, 200)))
    return {"messages": items}
  except Exception as exc:
    raise HTTPException(status_code=400, detail=str(exc))


@app.get("/members")
async def members(limit: int = 40) -> dict[str, Any]:
  try:
    items = await gateway.fetch_members(limit=max(1, min(limit, 200)))
    return {"members": items}
  except Exception as exc:
    raise HTTPException(status_code=400, detail=str(exc))


if __name__ == "__main__":
  uvicorn.run(app, host="127.0.0.1", port=8765)
