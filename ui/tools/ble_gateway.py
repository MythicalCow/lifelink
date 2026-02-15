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

  async def scan(self, timeout: float = 4.0) -> list[dict[str, Any]]:
    devices = await BleakScanner.discover(timeout=timeout)
    results: list[dict[str, Any]] = []
    for d in devices:
      uuids = {(u or "").lower() for u in (d.metadata.get("uuids") or [])}
      name = d.name or d.metadata.get("local_name") or ""
      if NUS_SERVICE_UUID in uuids or name.startswith("LifeLink"):
        results.append(
            {
                "name": name or "LifeLink",
                "address": d.address,
                "rssi": d.rssi,
            }
        )
    results.sort(key=lambda x: x.get("rssi", -999), reverse=True)
    return results

  async def connect(self, address: str) -> None:
    async with self._lock:
      await self.disconnect()
      self._log(f"Connecting to {address}...")
      client = BleakClient(address, disconnected_callback=self._on_disconnect)
      try:
        await asyncio.wait_for(client.connect(timeout=8.0), timeout=10.0)
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
        self._log("BLE connected.")
        await self._send_and_wait_locked("WHOAMI", ("OK|WHOAMI|",), timeout=2.0, attempts=4)
        await self._send_and_wait_locked("STATUS", ("OK|STATUS|",), timeout=2.0, attempts=4)
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

  async def send_command(self, command: str) -> None:
    async with self._lock:
      if self._client is None or not self._client.is_connected or self._rx_char is None:
        raise RuntimeError("No BLE device connected.")
      expected_prefixes: tuple[str, ...] = ()
      if command == "WHOAMI":
        expected_prefixes = ("OK|WHOAMI|",)
      elif command == "STATUS":
        expected_prefixes = ("OK|STATUS|",)
      elif command.startswith("NAME|"):
        expected_prefixes = ("OK|NAME|",)
      elif command.startswith("SEND|"):
        expected_prefixes = ("OK|SEND|", "ERR|SEND|")
      await self._send_and_wait_locked(command, expected_prefixes, timeout=2.5, attempts=3)

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
      await asyncio.sleep(0.1)

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
async def devices(timeout: float = 4.0) -> dict[str, Any]:
  return {"devices": await gateway.scan(timeout=max(1.0, min(timeout, 12.0)))}


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


if __name__ == "__main__":
  uvicorn.run(app, host="127.0.0.1", port=8765)
