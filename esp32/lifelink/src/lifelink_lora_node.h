#pragma once

#include <Arduino.h>
#include <RadioLib.h>

class LifeLinkLoRaNode {
 public:
  void begin();
  void tick();

 private:
  enum class NodeState {
    kIdle,
    kTx,
    kRx,
    kTxDone,
    kRxDone,
    kTxTimeout,
    kRxTimeout,
    kRxError,
  };

  static constexpr int kLoraNssPin = 8;
  static constexpr int kLoraDio1Pin = 14;
  static constexpr int kLoraResetPin = 12;
  static constexpr int kLoraBusyPin = 13;
  static constexpr int kLoraSckPin = 9;
  static constexpr int kLoraMisoPin = 11;
  static constexpr int kLoraMosiPin = 10;

  static constexpr float kRfFrequencyMhz = 915.0f;
  static constexpr int kTxPowerDbm = 14;
  static constexpr float kBandwidthKhz = 125.0f;
  static constexpr int kSpreadingFactor = 7;
  static constexpr int kCodingRate = 5;
  static constexpr int kPreambleLength = 8;
  static constexpr int kSyncWord = 0x12;
  static constexpr unsigned long kRxTimeoutMs = 3000;
  static constexpr size_t kBufferSize = 64;

  static LifeLinkLoRaNode* instance_;
  static volatile bool operation_done_;

  static void onDio1Rise();

  void printBanner() const;
  uint32_t resolveNodeId() const;

  void runStateIdle();
  void runStateTx();
  void runStateRx();
  void runStateTxDone();
  void runStateRxDone();
  void runStateTxTimeout();
  void runStateRxTimeout();
  void runStateRxError();

  SPIClass lora_spi_{HSPI};
  SX1262 radio_{new Module(kLoraNssPin, kLoraDio1Pin, kLoraResetPin, kLoraBusyPin, lora_spi_)};

  NodeState state_ = NodeState::kIdle;
  char tx_packet_[kBufferSize] = {};
  char rx_packet_[kBufferSize] = {};
  uint16_t rx_size_ = 0;
  float rx_rssi_ = 0;
  float rx_snr_ = 0;
  uint32_t tx_count_ = 0;
  uint32_t rx_count_ = 0;
  uint32_t error_count_ = 0;
  uint32_t node_id_ = 0;
};

