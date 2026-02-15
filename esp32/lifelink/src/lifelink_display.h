#pragma once

#include <Arduino.h>
#include "lifelink_lora_node.h"

/* ── LifeLink OLED Display ────────────────────────────
 * Drives the on-board SSD1306 (128×64 OLED) on the
 * Heltec WiFi LoRa 32 V3 via I2C.
 *
 * Shows:
 *   Line 1:  LifeLink + node name
 *   Line 2:  Node ID + members count
 *   Line 3:  Hop channel + RSSI
 *   Line 4:  Last RX message (truncated)
 *   Line 5:  Triage: vital/intent/urgency
 * ───────────────────────────────────────────────────── */

class LifeLinkDisplay {
 public:
  void begin();
  void update(const LifeLinkLoRaNode& node);

 private:
  static constexpr uint8_t kSdaPin = 17;
  static constexpr uint8_t kSclPin = 18;
  static constexpr uint8_t kRstPin = 21;
  static constexpr uint8_t kVextPin = 36;
  static constexpr uint8_t kI2cAddr = 0x3C;
  static constexpr uint16_t kWidth = 128;
  static constexpr uint16_t kHeight = 64;
  static constexpr unsigned long kRefreshIntervalMs = 500;

  unsigned long last_refresh_ms_ = 0;
  bool initialized_ = false;
};
