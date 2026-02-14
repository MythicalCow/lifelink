#pragma once

#include <cstddef>

namespace LifeLinkDisplay {

// Heltec WiFi LoRa 32 V3: OLED 128x64, I2C
static constexpr int kOledSdaPin = 17;
static constexpr int kOledSclPin = 18;
static constexpr int kOledRstPin = 21;
static constexpr int kOledWidth = 128;
static constexpr int kOledHeight = 64;

void init();
void setBleState(const char* state);
void setLoraState(const char* state);
void setBleConnected(bool connected);
void update();

}  // namespace LifeLinkDisplay
