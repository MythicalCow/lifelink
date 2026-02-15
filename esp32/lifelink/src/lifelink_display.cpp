/* ── LifeLink OLED Display ─────────────────────────────
 * Uses the on-board SSD1306 128×64 OLED on Heltec V3.
 * I2C: SDA=17, SCL=18, RST=21, Vext=36 (active LOW).
 *
 * Library: ThingPulse SSD1306 driver (via PlatformIO).
 * ───────────────────────────────────────────────────── */

#include "lifelink_display.h"

#include <Wire.h>
#include <SSD1306Wire.h>

static SSD1306Wire* oled = nullptr;

void LifeLinkDisplay::begin() {
  // Power the OLED via Vext (active LOW on Heltec V3)
  pinMode(kVextPin, OUTPUT);
  digitalWrite(kVextPin, LOW);
  delay(50);

  // Reset the display
  pinMode(kRstPin, OUTPUT);
  digitalWrite(kRstPin, LOW);
  delay(20);
  digitalWrite(kRstPin, HIGH);
  delay(20);

  // ThingPulse SSD1306Wire constructor: (addr, sda, scl, geometry)
  oled = new SSD1306Wire(kI2cAddr, kSdaPin, kSclPin, GEOMETRY_128_64);
  oled->init();
  oled->flipScreenVertically();
  oled->setFont(ArialMT_Plain_10);
  oled->clear();
  oled->setTextAlignment(TEXT_ALIGN_CENTER);
  oled->drawString(64, 20, "LifeLink");
  oled->drawString(64, 36, "Initializing...");
  oled->display();
  initialized_ = true;
  last_refresh_ms_ = millis();
  Serial.println("[OLED] Display initialized.");
}

void LifeLinkDisplay::update(const LifeLinkLoRaNode& node) {
  if (!initialized_ || oled == nullptr) return;
  const unsigned long now = millis();
  if (now - last_refresh_ms_ < kRefreshIntervalMs) return;
  last_refresh_ms_ = now;

  oled->clear();
  oled->setFont(ArialMT_Plain_10);

  // ── Line 1: LifeLink | node name ──
  oled->setTextAlignment(TEXT_ALIGN_LEFT);
  char line1[32];
  snprintf(line1, sizeof(line1), "LifeLink | %s", node.nodeName());
  oled->drawString(0, 0, line1);

  // ── Line 2: ID + members ──
  char line2[32];
  snprintf(line2, sizeof(line2), "ID: %04X  Peers: %u",
      node.nodeId16(), node.activeMemberCount());
  oled->drawString(0, 12, line2);

  // ── Line 3: Hop + RSSI ──
  char line3[32];
  snprintf(line3, sizeof(line3), "Hop: ch%u  RSSI: %.0f dBm",
      node.currentHopChannel(), node.lastRssi());
  oled->drawString(0, 24, line3);

  // ── Line 4: Last RX message (truncated) ──
  const char* body = node.lastRxBody();
  if (body != nullptr && body[0] != '\0') {
    char line4[26];
    snprintf(line4, sizeof(line4), "RX: %.22s", body);
    oled->drawString(0, 36, line4);
  } else {
    oled->drawString(0, 36, "RX: (waiting...)");
  }

  // ── Line 5: Triage result ──
  const TriageOutput& t = node.lastRxTriage();
  if (t.is_vital) {
    char line5[32];
    snprintf(line5, sizeof(line5), "VITAL %s U%u",
        t.intent.c_str(), t.urgency);
    oled->drawString(0, 48, line5);
  } else {
    oled->drawString(0, 48, "Triage: --");
  }

  // ── Stats bar (bottom-right) ──
  oled->setTextAlignment(TEXT_ALIGN_RIGHT);
  char stats[20];
  snprintf(stats, sizeof(stats), "TX:%lu RX:%lu",
      static_cast<unsigned long>(node.txCount()),
      static_cast<unsigned long>(node.rxCount()));
  oled->drawString(128, 54, stats);

  oled->display();
}
