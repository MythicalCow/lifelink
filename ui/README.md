# LifeLink UI + BLE Gateway

This is the operator UI for LifeLink. It includes:

- `Setup` tab: connect BLE nodes, set name/location, save config
- `Map` tab: display configured nodes
- `Messages` tab: send via BLE -> LoRa and view node-stored message history + triage metadata

## Prerequisites

- Node.js 20+
- Python 3.10+
- Bluetooth adapter enabled on host machine

## 1) Install UI dependencies

```bash
cd /home/mythicalcow/lifelink/ui
npm install
```

## 2) Create BLE gateway venv and install Python deps (includes bleak)

```bash
cd /home/mythicalcow/lifelink/ui
python3 -m venv .venv-ble-gateway
. .venv-ble-gateway/bin/activate
pip install -U pip
pip install -r tools/requirements-ble-gateway.txt
```

`tools/requirements-ble-gateway.txt` installs:

- `bleak` (BLE client)
- `fastapi`
- `uvicorn`

## 3) Start BLE gateway

```bash
cd /home/mythicalcow/lifelink/ui
npm run gateway
```

Gateway endpoint: `http://127.0.0.1:8765`

Useful checks:

```bash
curl -s http://127.0.0.1:8765/state
curl -s 'http://127.0.0.1:8765/devices?timeout=3'
```

## 4) Start UI app

In a second terminal:

```bash
cd /home/mythicalcow/lifelink/ui
npm run dev
```

Open: `http://localhost:3000`

---

## Clean test sequence

1. In `Setup`:
   - Scan BLE devices
   - Connect node
   - Set node name + location (+ anchor if needed)
   - Save
   - Repeat for all nodes
2. In `Messages`:
   - Select receiver (`To`)
   - Select sender device (`From`)
   - Send message
   - Verify node message history panel updates with triage metadata (`VITAL`, `intent`, `urgency`)

---

## Troubleshooting

### Gateway not reachable

```bash
cd /home/mythicalcow/lifelink/ui
pkill -9 -f 'tools/ble_gateway.py|npm run gateway|uvicorn.*8765' || true
npm run gateway
```

### Only 1-2 devices found

- Re-scan with longer timeout
- Ensure all boards are powered and advertising
- Keep only one gateway instance running

```bash
curl -s 'http://127.0.0.1:8765/devices?timeout=6'
```

### BLE permission issues on Linux

Run with proper permissions / user in Bluetooth-related groups as needed by your distro.
