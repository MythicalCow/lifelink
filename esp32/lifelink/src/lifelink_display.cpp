#include "lifelink_display.h"

#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Wire.h>
#include <cstring>

#define SSD1306_I2C_ADDR 0x3C

namespace {
Adafruit_SSD1306* g_display = nullptr;
char g_ble_state_buf[20] = "--";
char g_lora_state_buf[20] = "listening";
bool g_ble_connected = false;

// 16x16 Bluetooth logo (Adafruit GFX row-major, 2 bytes per row, MSB left)
const unsigned char kBtLogo16[] PROGMEM = {
  0x00, 0x00, 0x00, 0x00, 0x01, 0x80, 0x01, 0xC0,
  0x01, 0xE0, 0x0D, 0x30, 0x07, 0xE0, 0x03, 0xC0,
  0x03, 0x80, 0x07, 0xC0, 0x0D, 0x30, 0x09, 0x30,
  0x01, 0xE0, 0x01, 0x80, 0x01, 0x00, 0x00, 0x00,
};
}  // namespace

namespace LifeLinkDisplay {

void init() {
  Wire.begin(kOledSdaPin, kOledSclPin);
  Adafruit_SSD1306* disp = new Adafruit_SSD1306(kOledWidth, kOledHeight, &Wire, kOledRstPin);
  if (!disp->begin(SSD1306_SWITCHCAPVCC, SSD1306_I2C_ADDR)) {
    delete disp;
    return;
  }
  g_display = disp;
  g_display->clearDisplay();
  g_display->setTextColor(SSD1306_WHITE);
  g_display->setTextSize(1);
  g_display->cp437(true);
  update();
}

void setBleState(const char* state) {
  if (!state)
    return;
  strncpy(g_ble_state_buf, state, sizeof(g_ble_state_buf) - 1);
  g_ble_state_buf[sizeof(g_ble_state_buf) - 1] = '\0';
  if (g_display)
    update();
}

void setLoraState(const char* state) {
  if (!state)
    return;
  strncpy(g_lora_state_buf, state, sizeof(g_lora_state_buf) - 1);
  g_lora_state_buf[sizeof(g_lora_state_buf) - 1] = '\0';
  if (g_display)
    update();
}

void setBleConnected(bool connected) {
  if (g_ble_connected == connected)
    return;
  g_ble_connected = connected;
  if (g_display)
    update();
}

void update() {
  if (!g_display)
    return;
  g_display->clearDisplay();

  // ----- Top half: Bluetooth -----
  g_display->setCursor(0, 0);
  g_display->print("Bluetooth");
  if (g_ble_connected) {
    g_display->drawBitmap(kOledWidth - 18, 0, kBtLogo16, 16, 16, SSD1306_WHITE);
  }
  g_display->setCursor(0, 10);
  g_display->print(g_ble_state_buf);

  // ----- Separator bar -----
  g_display->drawFastHLine(0, 31, kOledWidth, SSD1306_WHITE);
  g_display->drawFastHLine(0, 32, kOledWidth, SSD1306_WHITE);

  // ----- Bottom half: LoRa -----
  g_display->setCursor(0, 36);
  g_display->print("LoRa");
  g_display->setCursor(0, 46);
  g_display->print(g_lora_state_buf);

  g_display->display();
}

}  // namespace LifeLinkDisplay
