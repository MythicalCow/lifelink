#include "lifelink_lora_node.h"
#include "lifelink_display.h"

#include <esp_mac.h>

LifeLinkLoRaNode* LifeLinkLoRaNode::instance_ = nullptr;
volatile bool LifeLinkLoRaNode::operation_done_ = false;

#if defined(ESP8266) || defined(ESP32)
ICACHE_RAM_ATTR
#endif
void LifeLinkLoRaNode::onDio1Rise() {
  operation_done_ = true;
}

void LifeLinkLoRaNode::begin() {
  Serial.begin(115200);
  delay(1000);

  node_id_ = resolveNodeId();
  printBanner();

  lora_spi_.begin(kLoraSckPin, kLoraMisoPin, kLoraMosiPin, kLoraNssPin);

  Serial.print("[INIT] Initializing SX1262... ");
  const int init_state = radio_.begin(
      kRfFrequencyMhz,
      kBandwidthKhz,
      kSpreadingFactor,
      kCodingRate,
      kSyncWord,
      kTxPowerDbm,
      kPreambleLength);

  if (init_state == RADIOLIB_ERR_NONE) {
    Serial.println("success");
  } else {
    Serial.printf("failed, code %d\n", init_state);
    Serial.println("Check wiring and pin definitions.");
    while (true) {
      delay(1000);
    }
  }

  instance_ = this;
  radio_.setDio1Action(onDio1Rise);
  radio_.setCRC(true);

  Serial.println("[INIT] Radio initialized, entering RX mode.");
  state_ = NodeState::kRx;
}

void LifeLinkLoRaNode::tick() {
  switch (state_) {
    case NodeState::kIdle:
      runStateIdle();
      break;
    case NodeState::kTx:
      runStateTx();
      break;
    case NodeState::kRx:
      runStateRx();
      break;
    case NodeState::kTxDone:
      runStateTxDone();
      break;
    case NodeState::kRxDone:
      runStateRxDone();
      break;
    case NodeState::kTxTimeout:
      runStateTxTimeout();
      break;
    case NodeState::kRxTimeout:
      runStateRxTimeout();
      break;
    case NodeState::kRxError:
      runStateRxError();
      break;
  }
}

uint32_t LifeLinkLoRaNode::resolveNodeId() const {
  uint8_t mac[6] = {0};
  if (esp_read_mac(mac, ESP_MAC_WIFI_STA) == ESP_OK) {
    return (static_cast<uint32_t>(mac[4]) << 8) | static_cast<uint32_t>(mac[5]);
  }

  const uint64_t chip_id = ESP.getEfuseMac();
  return static_cast<uint32_t>(chip_id & 0xFFFF);
}

void LifeLinkLoRaNode::printBanner() const {
  Serial.println();
  Serial.println("LifeLink LoRa Node-to-Node Test");
  Serial.printf("Node ID:    0x%04X\n", node_id_);
  Serial.printf("Frequency:  %.1f MHz\n", kRfFrequencyMhz);
  Serial.printf("TX Power:   %d dBm\n", kTxPowerDbm);
  Serial.printf("SF:         %d\n", kSpreadingFactor);
  Serial.printf("BW:         %.0f kHz\n", kBandwidthKhz);
  Serial.println();
}

void LifeLinkLoRaNode::runStateIdle() {
  delay(100);
  state_ = NodeState::kRx;
}

void LifeLinkLoRaNode::runStateTx() {
  LifeLinkDisplay::setLoraState("Sending");
  ++tx_count_;
  snprintf(
      tx_packet_,
      kBufferSize,
      "PING from 0x%04X #%lu RSSI:%.0f",
      node_id_,
      static_cast<unsigned long>(tx_count_),
      rx_rssi_);

  Serial.printf("[TX] Sending: \"%s\" (%d bytes)\n", tx_packet_, strlen(tx_packet_));

  operation_done_ = false;
  const int tx_state = radio_.startTransmit(tx_packet_);
  if (tx_state != RADIOLIB_ERR_NONE) {
    Serial.printf("[TX] Failed to start TX, code %d\n", tx_state);
    ++error_count_;
    state_ = NodeState::kIdle;
    return;
  }

  const unsigned long start_time = millis();
  while (!operation_done_ && (millis() - start_time < 3000)) {
    yield();
  }
  state_ = operation_done_ ? NodeState::kTxDone : NodeState::kTxTimeout;
}

void LifeLinkLoRaNode::runStateRx() {
  LifeLinkDisplay::setLoraState("listening");
  Serial.println("[RX] Listening...");

  operation_done_ = false;
  const int rx_state = radio_.startReceive();
  if (rx_state != RADIOLIB_ERR_NONE) {
    Serial.printf("[RX] Failed to start RX, code %d\n", rx_state);
    ++error_count_;
    state_ = NodeState::kIdle;
    return;
  }

  const unsigned long start_time = millis();
  while (!operation_done_ && (millis() - start_time < kRxTimeoutMs)) {
    yield();
  }

  if (!operation_done_) {
    state_ = NodeState::kRxTimeout;
    return;
  }

  rx_size_ = radio_.getPacketLength();
  if (rx_size_ > kBufferSize - 1) {
    rx_size_ = kBufferSize - 1;
  }

  const int read_state = radio_.readData(reinterpret_cast<uint8_t*>(rx_packet_), rx_size_);
  rx_packet_[rx_size_] = '\0';
  if (read_state == RADIOLIB_ERR_NONE) {
    rx_rssi_ = radio_.getRSSI();
    rx_snr_ = radio_.getSNR();
    state_ = NodeState::kRxDone;
  } else if (read_state == RADIOLIB_ERR_CRC_MISMATCH) {
    state_ = NodeState::kRxError;
  } else {
    Serial.printf("[RX] Read error, code %d\n", read_state);
    state_ = NodeState::kRxError;
  }
}

void LifeLinkLoRaNode::runStateTxDone() {
  radio_.finishTransmit();
  LifeLinkDisplay::setLoraState("sent");
  Serial.println("[TX] Sent successfully");
  Serial.println();
  state_ = NodeState::kRx;
}

void LifeLinkLoRaNode::runStateRxDone() {
  ++rx_count_;
  radio_.standby();
  LifeLinkDisplay::setLoraState("received");

  Serial.println("----------------------------------------");
  Serial.printf("[RX] Packet #%lu received\n", static_cast<unsigned long>(rx_count_));
  Serial.printf("Payload: \"%s\"\n", rx_packet_);
  Serial.printf("Size:    %u bytes\n", rx_size_);
  Serial.printf("RSSI:    %.1f dBm\n", rx_rssi_);
  Serial.printf("SNR:     %.1f dB\n", rx_snr_);
  Serial.println("----------------------------------------");
  Serial.println();

  delay(500 + (node_id_ % 500));
  state_ = NodeState::kTx;
}

void LifeLinkLoRaNode::runStateTxTimeout() {
  ++error_count_;
  LifeLinkDisplay::setLoraState("timeout");
  Serial.printf("[TX] Timeout (errors: %lu)\n", static_cast<unsigned long>(error_count_));
  radio_.standby();
  delay(1000);
  state_ = NodeState::kRx;
}

void LifeLinkLoRaNode::runStateRxTimeout() {
  Serial.println("[RX] Timeout - no packet received");
  radio_.standby();

  if (rx_count_ == 0) {
    Serial.println("[RX] No peers found. Sending initial PING...");
    delay(1000 + (node_id_ % 2000));
    state_ = NodeState::kTx;
    return;
  }
  state_ = NodeState::kRx;
}

void LifeLinkLoRaNode::runStateRxError() {
  ++error_count_;
  LifeLinkDisplay::setLoraState("error");
  Serial.printf("[RX] Error (possible CRC fail) - errors: %lu\n", static_cast<unsigned long>(error_count_));
  radio_.standby();
  state_ = NodeState::kRx;
}

