#pragma once

#include <Arduino.h>
#include <BLEDevice.h>

class LifeLinkServerCallbacks;
class LifeLinkRxCallbacks;
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#include <cstddef>

class LifeLinkBluetooth {
 public:
  enum class BtState {
    kDisconnected,   // Not connected; timer triggers connection attempt every 30s
    kConnecting,     // Advertising, waiting for client
    kStandby,        // Connected, waiting for message
    kMessageReceived // Received message; run decision tree then return to Standby
  };

  static constexpr size_t kMessageBufferSize = 256;
  static constexpr unsigned long kConnectAttemptIntervalMs = 30000;

  using MessageCallback = void (*)(const char* msg, size_t len);

  LifeLinkBluetooth();
  ~LifeLinkBluetooth() = default;

  void begin();
  void tick();
  bool sendText(const char* text);

  BtState state() const { return state_; }
  void setMessageCallback(MessageCallback cb) { message_callback_ = cb; }

  // Last received message (valid only after entering kMessageReceived)
  const char* lastMessage() const { return message_buffer_; }
  size_t lastMessageLen() const { return message_len_; }

 private:
  friend class LifeLinkServerCallbacks;
  friend class LifeLinkRxCallbacks;

  void startAdvertising();
  void onClientConnect();
  void onClientDisconnect();
  void onMessageWritten(const uint8_t* data, size_t len);
  void runStateDisconnected();
  void runStateConnecting();
  void runStateStandby();
  void runStateMessageReceived();

  static LifeLinkBluetooth* instance_;
  static void IRAM_ATTR onTimer();

  static volatile bool timer_fired_;

  BtState state_ = BtState::kDisconnected;
  MessageCallback message_callback_ = nullptr;

  char message_buffer_[kMessageBufferSize];
  size_t message_len_ = 0;

  hw_timer_t* connect_timer_ = nullptr;

  BLEServer* ble_server_ = nullptr;
  BLECharacteristic* rx_characteristic_ = nullptr;
  BLECharacteristic* tx_characteristic_ = nullptr;
  bool device_connected_ = false;
  bool advertising_started_ = false;
  unsigned long last_adv_restart_ms_ = 0;
};
