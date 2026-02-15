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
    self._lock = asyncio.Lock()
    self._response_event = asyncio.Event()
    self._identity_task: asyncio.Task[None] | None = None
    self._recent_devices: dict[str, tuple[dict[str, Any], float]] = {}

  def _log(self, line: str) -> None:
    ts = time.strftime("%H:%M:%S")
    self._logs.appendleft(f"[{ts}] {line}")

  def _on_disconnect(self, _client: BleakClient) -> None:
    self._state.connected = False
    self._log("BLE disconnected.")

  def _on_notify(self, _sender: int, data: bytearray) -> None:
    text = data.decode("utf-8", errors="replace").strip()
    if not text:
      return
    self._state.last_response = text
    self._log(f"RX: {text}")
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
    # Two short scans + short-term cache gives much more stable multi-node discovery.
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
    # Keep recently seen devices for a short window to avoid flicker from missed advert intervals.
    fresh: list[dict[str, Any]] = []
    for addr, (entry, seen_at) in list(self._recent_devices.items()):
      if now - seen_at <= DEVICE_CACHE_TTL_S:
        fresh.append(entry)
      else:
        del self._recent_devices[addr]

    # A connected BLE peripheral may stop advertising, so it can disappear from scanner results.
    # Keep it visible in the device list while connected to avoid the "only 2 nodes" UX.
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
    async with self._lock:
      if (
          self._client is not None
          and self._client.is_connected
          and self._state.connected
          and self._state.ble_address.upper() == address.upper()
      ):
        self._log(f"Already connected to {address}.")
        return
      await self.disconnect()
      self._log(f"Connecting to {address}...")
      client = BleakClient(address, disconnected_callback=self._on_disconnect)
      try:
        await asyncio.wait_for(client.connect(timeout=4.0), timeout=5.0)
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
        self._recent_devices[address] = (
            {
                "name": "LifeLink",
                "address": address,
                "rssi": 0,
            },
            time.time(),
        )
        self._log("BLE connected.")
        # Fetch identity in background so /connect returns quickly.
        if self._identity_task is not None and not self._identity_task.done():
          self._identity_task.cancel()
        self._identity_task = asyncio.create_task(self._refresh_identity())
      except Exception:
        await self.disconnect()
        raise

  async def disconnect(self) -> None:
    if self._client is None:
      self._state.connected = False
      return
    try:
      if self._tx_char is not None:
        await self._client.stop_notify(self._tx_char)
    except Exception:
      pass
    try:
      await self._client.disconnect()
    except Exception:
      pass
    self._client = None
    self._rx_char = None
    self._tx_char = None
    self._state.connected = False
    self._state.ble_name = ""
    self._state.ble_address = ""
    self._state.node_id = ""
    self._state.node_name = ""
    self._state.hop_leader = ""
    self._state.hop_seed = ""
    self._state.hop_seq = 0
    self._state.hop_channel = 0
    self._state.hop_frequency_mhz = 0.0
    self._state.last_response = ""
    self._log("BLE disconnected (manual).")
    if self._identity_task is not None and not self._identity_task.done():
      self._identity_task.cancel()

  async def send_command(self, command: str) -> None:
    async with self._lock:
      if self._client is None or not self._client.is_connected or self._rx_char is None:
        raise RuntimeError("No BLE device connected.")
      expected_prefixes: tuple[str, ...] = ()
      timeout_s = 1.0
      attempts = 2
      if command == "WHOAMI":
        expected_prefixes = ("OK|WHOAMI|",)
        timeout_s = 1.4
        attempts = 3
      elif command == "STATUS":
        expected_prefixes = ("OK|STATUS|",)
        timeout_s = 1.6
        attempts = 4
      elif command.startswith("NAME|"):
        expected_prefixes = ("OK|NAME|",)
        timeout_s = 1.4
        attempts = 3
      elif command.startswith("SEND|"):
        expected_prefixes = ("OK|SEND|", "ERR|SEND|")
        timeout_s = 1.4
        attempts = 3
      elif command == "HISTCOUNT":
        expected_prefixes = ("OK|HISTCOUNT|",)
        timeout_s = 1.6
        attempts = 3
      elif command.startswith("HISTGET|"):
        expected_prefixes = ("OK|HIST|", "ERR|HIST|")
        timeout_s = 1.6
        attempts = 3
      elif command == "MEMCOUNT":
        expected_prefixes = ("OK|MEMCOUNT|",)
        timeout_s = 1.6
        attempts = 3
      elif command.startswith("MEMGET|"):
        expected_prefixes = ("OK|MEM|", "ERR|MEM|")
        timeout_s = 1.6
        attempts = 3
      await self._send_and_wait_locked(command, expected_prefixes, timeout=timeout_s, attempts=attempts)

  async def fetch_messages(self, limit: int = 40) -> list[dict[str, Any]]:
    async with self._lock:
      if self._client is None or not self._client.is_connected or self._rx_char is None:
        raise RuntimeError("No BLE device connected.")
      await self._send_and_wait_locked("HISTCOUNT", ("OK|HISTCOUNT|",), timeout=1.6, attempts=3)
      parts = self._state.last_response.split("|")
      if len(parts) < 3:
        return []
      try:
        count = int(parts[2])
      except ValueError:
        return []
      start = max(0, count - max(1, min(limit, 200)))
      out: list[dict[str, Any]] = []
      for idx in range(start, count):
        await self._send_and_wait_locked(f"HISTGET|{idx}", ("OK|HIST|",), timeout=1.6, attempts=3)
        row = self._state.last_response.split("|")
        # OK|HIST|idx|dir|peer|msg|vital|intent|urg|hexbody
        if len(row) < 10:
          continue
        hex_body = row[9]
        try:
          body = bytes.fromhex(hex_body).decode("utf-8", errors="replace")
        except ValueError:
          body = ""
        out.append(
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
      return out

  async def fetch_members(self, limit: int = 40) -> list[dict[str, Any]]:
    async with self._lock:
      if self._client is None or not self._client.is_connected or self._rx_char is None:
        raise RuntimeError("No BLE device connected.")
      await self._send_and_wait_locked("MEMCOUNT", ("OK|MEMCOUNT|",), timeout=1.6, attempts=3)
      parts = self._state.last_response.split("|")
      if len(parts) < 3:
        return []
      try:
        count = int(parts[2])
      except ValueError:
        return []
      start = max(0, count - max(1, min(limit, 200)))
      out: list[dict[str, Any]] = []
      for idx in range(start, count):
        await self._send_and_wait_locked(f"MEMGET|{idx}", ("OK|MEM|",), timeout=1.6, attempts=3)
        row = self._state.last_response.split("|")
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
      return out

  async def _send_and_wait_locked(
      self,
      command: str,
      expected_prefixes: tuple[str, ...],
      timeout: float,
      attempts: int,
  ) -> None:
    if self._client is None or not self._client.is_connected or self._rx_char is None:
      raise RuntimeError("No BLE device connected.")

    for attempt in range(attempts):
      self._response_event.clear()
      self._log(f"TX: {command}")
      payload = command.encode("utf-8")
      await asyncio.wait_for(self._client.write_gatt_char(self._rx_char, payload, response=False), timeout=3.0)
      if not expected_prefixes:
        return
      try:
        await asyncio.wait_for(self._response_event.wait(), timeout=timeout)
      except asyncio.TimeoutError:
        if attempt + 1 == attempts:
          raise RuntimeError(f"No response to '{command}'")
        continue

      if any(self._state.last_response.startswith(prefix) for prefix in expected_prefixes):
        return
      if attempt + 1 == attempts:
        raise RuntimeError(f"Unexpected response '{self._state.last_response}' for '{command}'")
      await asyncio.sleep(0.03)

  async def _refresh_identity(self) -> None:
    await asyncio.sleep(0.02)
    try:
      async with self._lock:
        if self._client is None or not self._client.is_connected:
          return
        try:
          await self._send_and_wait_locked("STATUS", ("OK|STATUS|",), timeout=0.7, attempts=2)
        except Exception:
          await self._send_and_wait_locked("WHOAMI", ("OK|WHOAMI|",), timeout=0.7, attempts=2)
    except asyncio.CancelledError:
      return
    except Exception as exc:
      self._log(f"Identity warmup failed: {exc}")
      return

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
  return {"ok": True, "state": gateway.state()}


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
  return {"state": gateway.state(), "logs": gateway.logs()}


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
