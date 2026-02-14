#include "lifelink_lora_node.h"
#include "lifelink_bluetooth.h"
#include "lifelink_display.h"

namespace {
LifeLinkLoRaNode g_lora_node;
LifeLinkBluetooth g_bt;

void onBtMessage(const char* msg, size_t len) {
  (void)len;
  Serial.printf("[MAIN] BLE message (run decision tree): \"%s\"\n", msg);
  // TODO: encode features, run decision tree, then queue LoRa TX (vital compact or normal ASCII).
}
}  // namespace

void setup() {
  g_lora_node.begin();
  LifeLinkDisplay::init();
  LifeLinkDisplay::setBleState("--");
  LifeLinkDisplay::setLoraState("listening");
  g_bt.begin(g_lora_node.nodeId());
  g_bt.setMessageCallback(onBtMessage);
}

void loop() {
  g_lora_node.tick();
  g_bt.tick();
}
