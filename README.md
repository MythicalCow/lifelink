# LifeLink

Decentralized emergency communication using ESP32 LoRa mesh nodes and a local control UI.

This repo contains:

- `esp32/lifelink`: firmware for Heltec WiFi LoRa 32 V3 nodes (LoRa mesh + BLE control + on-device triage)
- `ui`: Next.js app for Setup/Map/Messages + local BLE gateway service

## What Works Today

- BLE node setup from UI (`Setup` tab)
- LoRa multi-hop send via connected BLE sender (`Messages` tab)
- Frequency hopping metadata surfaced in UI status
- On-device triage/classifier in firmware (vital/intent/urgency)
- Per-node persisted message history (sent + received) retrievable over BLE and shown in UI

---

## End-to-End Quick Start

### 1) Prerequisites

- Linux/macOS with USB access to ESP32 boards
- Node.js 20+
- Python 3.10+
- `pipx` and PlatformIO CLI

Install tooling:

```bash
pipx install platformio
```

### 2) Build + Flash ESP32 Firmware

From repo root:

```bash
cd esp32/lifelink
pio run
```

List boards:

```bash
pio device list
```

Flash one board:

```bash
pio run -t upload --upload-port /dev/ttyUSB0
```

Flash multiple boards (example):

```bash
for p in /dev/ttyUSB0 /dev/ttyUSB1 /dev/ttyUSB2; do
  pio run -t upload --upload-port "$p" || break
done
```

### 3) Start UI + BLE Gateway

In a new terminal:

```bash
cd ui
npm install
python3 -m venv .venv-ble-gateway
. .venv-ble-gateway/bin/activate
pip install -r tools/requirements-ble-gateway.txt
```

Run gateway:

```bash
npm run gateway
```

Run app (second terminal):

```bash
cd ui
npm run dev
```

Open:

- `http://localhost:3000`

---

## Operational Test Flow (Clean)

1. **Setup tab**
   - Scan BLE devices
   - Connect node
   - Set node name + location + anchor flag
   - Save config
   - Repeat for all nodes

2. **Map tab**
   - Confirm saved nodes render immediately

3. **Messages tab**
   - Scan devices
   - Select **From** (BLE sender)
   - Select **To** (LoRa receiver)
   - Send message
   - Verify node history panel updates with triage metadata (`VITAL`, intent, urgency)

---

## Repo Layout

```text
lifelink/
├── esp32/
│   ├── README.md
│   └── lifelink/
│       ├── platformio.ini
│       ├── README.md
│       └── src/
├── ui/
│   ├── README.md
│   ├── tools/ble_gateway.py
│   └── src/
└── py_decision_tree/
```

---

## Troubleshooting

### Only 1-2 boards appear in scan

- Ensure only one gateway process is running
- Replug USB cable for missing board
- Re-scan with a longer timeout
- Confirm serial enumeration:

```bash
cd esp32/lifelink
pio device list
```

### Upload fails (`port doesn't exist`)

The board likely re-enumerated to a different `/dev/ttyUSB*`. Re-run `pio device list` and flash using the current port.

### Gateway offline in UI

From `ui`:

```bash
npm run gateway
```

If needed, kill duplicates and restart:

```bash
pkill -9 -f 'tools/ble_gateway.py|npm run gateway|uvicorn.*8765' || true
npm run gateway
```

### BLE connected but save/send is slow

- Keep one gateway instance
- Keep boards powered and nearby during setup
- Use the UI scan before connect to refresh address list

---

## License

MIT
