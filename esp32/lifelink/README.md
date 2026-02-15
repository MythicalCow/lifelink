# LifeLink Node Firmware (`esp32/lifelink`)

Firmware for Heltec WiFi LoRa 32 V3 nodes.

## Includes

- LoRa mesh packet handling (`HEARTBEAT`, `DATA`, `ACK`)
- BLE control commands
- Frequency hopping metadata
- On-device triage classifier (`vital`, `intent`, `urgency`)
- Per-node message history ring buffer (sent + received)
- History fetch over BLE (`HISTCOUNT`, `HISTGET`)

## Build

```bash
cd esp32/lifelink
pio run
```

## Upload

```bash
pio run -t upload --upload-port /dev/ttyUSB0
```

## Multi-board upload

```bash
for p in /dev/ttyUSB0 /dev/ttyUSB1 /dev/ttyUSB2; do
  pio run -t upload --upload-port "$p" || break
done
```

## Monitor

```bash
pio device monitor -p /dev/ttyUSB0 -b 115200
```

## BLE Command API

Write ASCII commands to BLE RX characteristic:

- `WHOAMI` -> `OK|WHOAMI|<id>|<name>`
- `STATUS` -> `OK|STATUS|<id>|<name>|<leader>|<seed>|<seq>|<ch>|<freq>`
- `NAME|<name>` -> `OK|NAME|<name>`
- `SEND|<dst_hex>|<text>` -> `OK|SEND|queued` or `ERR|SEND|...`
- `HISTCOUNT` -> `OK|HISTCOUNT|<count>`
- `HISTGET|<idx>` -> `OK|HIST|<idx>|<dir>|<peer>|<msg_id>|<vital>|<intent>|<urg>|<hex_body>`

Field notes:

- `<dir>`: `S` (sent) or `R` (received)
- `<vital>`: `1` or `0`
- `<urg>`: urgency class
- `<hex_body>`: hex-encoded original message body

## Message History Behavior

- History is stored per-node in RAM ring buffer.
- Latest entries are retained, oldest are overwritten when full.
- Received compact payloads are decoded to expose triage metadata.
