# LifeLink ESP32 LoRa Firmware

Firmware for the **Heltec WiFi LoRa 32 V3** board (ESP32-S3 + SX1262).

## Hardware

- **Board**: Heltec WiFi LoRa 32 V3
- **MCU**: ESP32-S3
- **LoRa Chip**: SX1262
- **Frequency**: 863-928 MHz (configurable)
- **Antenna**: 915 MHz (US) or 868 MHz (EU)

## Project Structure

```
esp32/
├── drivers/
│   └── Heltec_ESP32/     # Heltec library (git submodule)
└── lifelink/
    ├── platformio.ini    # PlatformIO config
    └── src/
        └── main.cpp      # Node-to-node LoRa test
```

## Quick Start

### Option 1: PlatformIO (Recommended)

1. **Install PlatformIO**:
   ```bash
   # Using pipx (recommended)
   pipx install platformio
   
   # Or using pip
   pip install platformio
   ```

2. **Build & Upload**:
   ```bash
   cd esp32/lifelink
   pio run -t upload
   ```

3. **Monitor Serial**:
   ```bash
   pio device monitor
   ```

### Option 2: Arduino IDE

1. **Install Heltec Board Support**:
   - Open Arduino IDE → Preferences
   - Add to "Additional Board Manager URLs":
     ```
     https://github.com/Heltec-Aaron-Lee/WiFi_Kit_series/releases/download/0.0.9/package_heltec_esp32_index.json
     ```
   - Tools → Board → Board Manager → Search "Heltec" → Install

2. **Select Board**:
   - Tools → Board → Heltec ESP32 Series → WiFi LoRa 32(V3)

3. **Install Library**:
   - Copy `drivers/Heltec_ESP32/` to your Arduino libraries folder
   - Or: Sketch → Include Library → Add .ZIP Library

4. **Upload**:
   - Open `lifelink/src/main.cpp`
   - Click Upload

## Testing Node-to-Node Communication

1. Flash the same firmware to **two** boards
2. Open serial monitors for both (115200 baud)
3. They will automatically ping-pong messages

**Expected output**:
```
╔════════════════════════════════════════════╗
║     LifeLink LoRa Node-to-Node Test        ║
╠════════════════════════════════════════════╣
║  Node ID:    0x1A3F                        ║
║  Frequency:  915.0 MHz                     ║
║  TX Power:   14 dBm                        ║
║  SF:         7                             ║
║  BW:         125 kHz                       ║
╚════════════════════════════════════════════╝

[INIT] Radio initialized. Starting in RX mode...
[RX] Listening...
┌────────────────────────────────────────────┐
│ [RX] Packet #1 received                   
│  Payload: "PING from 0x2B4E #1 RSSI:-45"
│  Size:    28 bytes
│  RSSI:    -45 dBm
│  SNR:     10 dB
└────────────────────────────────────────────┘

[TX] Sending: "PING from 0x1A3F #1 RSSI:-45" (30 bytes)
[TX] ✓ Sent successfully
```

## Configuration

Edit `main.cpp` to change:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `RF_FREQUENCY` | 915 MHz | US: 915MHz, EU: 868MHz |
| `TX_OUTPUT_POWER` | 14 dBm | Range: 2-22 dBm |
| `LORA_SPREADING_FACTOR` | 7 | SF7-SF12 (higher = longer range) |
| `LORA_BANDWIDTH` | 0 (125kHz) | 0=125, 1=250, 2=500 kHz |

## Troubleshooting

### No communication between boards
- Ensure both boards have **matching** LoRa settings (frequency, SF, BW)
- Check antenna connections
- Try increasing `TX_OUTPUT_POWER` (max 22 dBm)
- Try higher spreading factor (SF9-SF12) for longer range

### Build errors
- Ensure the Heltec library is properly linked
- Check that `WIFI_LORA_32_V3` is defined in build flags

### Serial not showing output
- Baud rate must be **115200**
- Press the RST button on the board after connecting

## Next Steps

This test firmware validates basic LoRa communication. The next phase will implement:

1. **Mesh Protocol**: Gossip-based membership + gradient routing
2. **Packet Framing**: Structured headers with node ID, TTL, hop count
3. **Collision Avoidance**: CSMA/CA with random backoff
4. **BLE Gateway**: Connect phones to nodes via Bluetooth
