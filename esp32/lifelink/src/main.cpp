#include "lifelink_lora_node.h"
#include "lifelink_bluetooth.h"

#include <cstdlib>
#include <cstring>

namespace {
LifeLinkLoRaNode g_lora_node;
LifeLinkBluetooth g_bluetooth;

void hexEncode(const char* in, char* out, size_t out_size) {
  static const char* kHex = "0123456789ABCDEF";
  if (out_size == 0) {
    return;
  }
  if (in == nullptr) {
    out[0] = '\0';
    return;
  }
  size_t j = 0;
  for (size_t i = 0; in[i] != '\0' && j + 2 < out_size; ++i) {
    const uint8_t b = static_cast<uint8_t>(in[i]);
    out[j++] = kHex[(b >> 4) & 0x0F];
    out[j++] = kHex[b & 0x0F];
  }
  out[j] = '\0';
}

void onBluetoothMessage(const char* msg, size_t len) {
  if (msg == nullptr || len == 0) {
    return;
  }

  char cmd[LifeLinkBluetooth::kMessageBufferSize];
  const size_t copy_len = (len < sizeof(cmd) - 1) ? len : sizeof(cmd) - 1;
  memcpy(cmd, msg, copy_len);
  cmd[copy_len] = '\0';

  if (strncmp(cmd, "WHOAMI", 6) == 0) {
    char out[64];
    snprintf(out, sizeof(out), "OK|WHOAMI|%04X|%s", g_lora_node.nodeId16(), g_lora_node.nodeName());
    g_bluetooth.sendText(out);
    return;
  }

  if (strncmp(cmd, "STATUS", 6) == 0) {
    const float hop_freq_mhz = 903.9f + (0.2f * static_cast<float>(g_lora_node.currentHopChannel()));
    char out[128];
    snprintf(
        out,
        sizeof(out),
        "OK|STATUS|%04X|%s|%04X|%08lX|%lu|%u|%.1f",
        g_lora_node.nodeId16(),
        g_lora_node.nodeName(),
        g_lora_node.hopLeaderId(),
        static_cast<unsigned long>(g_lora_node.hopSeed()),
        static_cast<unsigned long>(g_lora_node.hopSeq()),
        static_cast<unsigned>(g_lora_node.currentHopChannel()),
        hop_freq_mhz);
    g_bluetooth.sendText(out);
    return;
  }

  if (strncmp(cmd, "NAME|", 5) == 0) {
    const char* name = cmd + 5;
    g_lora_node.setNodeName(name);
    char out[64];
    snprintf(out, sizeof(out), "OK|NAME|%s", g_lora_node.nodeName());
    g_bluetooth.sendText(out);
    return;
  }

  if (strncmp(cmd, "SEND|", 5) == 0) {
    char* save = nullptr;
    strtok_r(cmd, "|", &save);  // SEND
    char* dst_s = strtok_r(nullptr, "|", &save);
    char* body = strtok_r(nullptr, "", &save);
    if (dst_s == nullptr || body == nullptr || body[0] == '\0') {
      g_bluetooth.sendText("ERR|SEND|format");
      return;
    }
    const uint16_t dst = static_cast<uint16_t>(strtoul(dst_s, nullptr, 16));
    const bool ok = g_lora_node.queueBleMessage(dst, body);
    g_bluetooth.sendText(ok ? "OK|SEND|queued" : "ERR|SEND|queue_full");
    return;
  }

  if (strncmp(cmd, "HISTCOUNT", 9) == 0) {
    char out[48];
    snprintf(out, sizeof(out), "OK|HISTCOUNT|%u", static_cast<unsigned>(g_lora_node.messageHistoryCount()));
    g_bluetooth.sendText(out);
    return;
  }

  if (strncmp(cmd, "HISTGET|", 8) == 0) {
    const uint16_t idx = static_cast<uint16_t>(strtoul(cmd + 8, nullptr, 10));
    LifeLinkLoRaNode::MessageHistoryEntry entry{};
    if (!g_lora_node.getMessageHistory(idx, &entry)) {
      g_bluetooth.sendText("ERR|HIST|range");
      return;
    }
    char body_hex[sizeof(entry.body) * 2 + 1];
    hexEncode(entry.body, body_hex, sizeof(body_hex));
    char out[220];
    snprintf(
        out,
        sizeof(out),
        "OK|HIST|%u|%c|%04X|%u|%u|%s|%u|%s",
        static_cast<unsigned>(idx),
        entry.direction,
        static_cast<unsigned>(entry.peer),
        static_cast<unsigned>(entry.msg_id),
        entry.vital ? 1U : 0U,
        entry.intent,
        static_cast<unsigned>(entry.urgency),
        body_hex);
    g_bluetooth.sendText(out);
    return;
  }

  g_bluetooth.sendText("ERR|CMD|unknown");
}
}

void setup() {
  g_lora_node.begin();
  g_bluetooth.setMessageCallback(onBluetoothMessage);
  g_bluetooth.begin();
}

void loop() {
  g_bluetooth.tick();
  g_lora_node.tick();
}
