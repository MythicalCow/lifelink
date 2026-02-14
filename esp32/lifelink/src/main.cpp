#include "lifelink_lora_node.h"

namespace {
LifeLinkLoRaNode g_lora_node;
}

void setup() {
  g_lora_node.begin();
}

void loop() {
  g_lora_node.tick();
}
