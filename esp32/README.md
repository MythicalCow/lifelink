# LifeLink ESP32 Firmware Guide

This directory contains firmware for Heltec WiFi LoRa 32 V3 nodes used by LifeLink.

## Hardware

- Board: Heltec WiFi LoRa 32 V3
- MCU: ESP32-S3
- Radio: SX1262

## Prerequisites

- Python 3.10+
- PlatformIO CLI

Install PlatformIO:

```bash
pipx install platformio
```

## Build

```bash
cd /home/mythicalcow/lifelink/esp32/lifelink
pio run
```

## Flash

List serial ports:

```bash
cd /home/mythicalcow/lifelink/esp32/lifelink
pio device list
```

Flash one board:

```bash
pio run -t upload --upload-port /dev/ttyUSB0
```

Flash three boards:

```bash
for p in /dev/ttyUSB0 /dev/ttyUSB1 /dev/ttyUSB2; do
  pio run -t upload --upload-port "$p" || break
done
```

## Serial Logs

```bash
pio device monitor -p /dev/ttyUSB0 -b 115200
```

## USB Re-enumeration Notes

If upload fails with `port doesn't exist`, the board likely re-enumerated.
Run `pio device list` again and use the current `/dev/ttyUSB*` path.
