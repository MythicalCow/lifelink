#include "lifelink_bluetooth.h"

// Nordic UART Service (NUS) UUIDs for BLE serial-style messaging
#define BLE_UART_SERVICE_UUID          "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define BLE_UART_RX_CHARACTERISTIC_UUID "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
#define BLE_UART_TX_CHARACTERISTIC_UUID "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"

#define CONNECT_TIMER_GROUP 0
#define CONNECT_TIMER_IDX   0
#define CONNECT_TIMER_DIVIDER 80   // 80 MHz / 80 = 1 MHz (1 tick = 1 us)
#define CONNECT_TIMER_PERIOD_US (30ULL * 1000 * 1000)  // 30 seconds
#define ADV_RESTART_INTERVAL_MS 5000UL

LifeLinkBluetooth* LifeLinkBluetooth::instance_ = nullptr;
volatile bool LifeLinkBluetooth::timer_fired_ = false;

void IRAM_ATTR LifeLinkBluetooth::onTimer() {
  timer_fired_ = true;
}

class LifeLinkServerCallbacks : public BLEServerCallbacks {
 public:
  explicit LifeLinkServerCallbacks(LifeLinkBluetooth* bt) : bt_(bt) {}
  void onConnect(BLEServer* /*pServer*/) override { bt_->onClientConnect(); }
  void onDisconnect(BLEServer* /*pServer*/) override { bt_->onClientDisconnect(); }

 private:
  LifeLinkBluetooth* bt_;
};

class LifeLinkRxCallbacks : public BLECharacteristicCallbacks {
 public:
  explicit LifeLinkRxCallbacks(LifeLinkBluetooth* bt) : bt_(bt) {}
  void onWrite(BLECharacteristic* pCharacteristic) override {
    std::string value = pCharacteristic->getValue();
    if (!value.empty()) {
      bt_->onMessageWritten(
          reinterpret_cast<const uint8_t*>(value.data()),
          value.size());
    }
  }

 private:
  LifeLinkBluetooth* bt_;
};

LifeLinkBluetooth::LifeLinkBluetooth() {
  message_buffer_[0] = '\0';
  instance_ = this;
}

void LifeLinkBluetooth::begin() {
  BLEDevice::init("LifeLink");
  ble_server_ = BLEDevice::createServer();
  ble_server_->setCallbacks(new LifeLinkServerCallbacks(this));

  BLEService* uart = ble_server_->createService(BLE_UART_SERVICE_UUID);

  rx_characteristic_ = uart->createCharacteristic(
      BLE_UART_RX_CHARACTERISTIC_UUID,
      BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  rx_characteristic_->setCallbacks(new LifeLinkRxCallbacks(this));

  tx_characteristic_ = uart->createCharacteristic(
      BLE_UART_TX_CHARACTERISTIC_UUID,
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  tx_characteristic_->addDescriptor(new BLE2902());

  uart->start();

  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(BLE_UART_SERVICE_UUID);
  adv->setScanResponse(true);
  // Faster discover/connect turnaround for rapid node-by-node setup.
  adv->setMinInterval(0x20);  // ~20 ms
  adv->setMaxInterval(0x40);  // ~40 ms
  adv->setMinPreferred(0x06);
  adv->setMaxPreferred(0x12);

  state_ = BtState::kDisconnected;
  device_connected_ = false;
  advertising_started_ = false;
  last_adv_restart_ms_ = millis();

  // Timer interrupt: every 30 s set flag to try connect when disconnected
  connect_timer_ = timerBegin(CONNECT_TIMER_IDX, CONNECT_TIMER_DIVIDER, true);
  timerAttachInterrupt(connect_timer_, &onTimer, true);
  timerAlarmWrite(connect_timer_, CONNECT_TIMER_PERIOD_US, true);
  timerAlarmEnable(connect_timer_);

  // First connection attempt immediately; thereafter timer fires every 30s when disconnected.
  startAdvertising();
  state_ = BtState::kConnecting;
  Serial.println("[BT] BLE initialized; connection attempts every 30s when disconnected.");
}

void LifeLinkBluetooth::tick() {
  switch (state_) {
    case BtState::kDisconnected:
      runStateDisconnected();
      break;
    case BtState::kConnecting:
      runStateConnecting();
      break;
    case BtState::kStandby:
      runStateStandby();
      break;
    case BtState::kMessageReceived:
      runStateMessageReceived();
      break;
  }
}

bool LifeLinkBluetooth::sendText(const char* text) {
  if (!device_connected_ || tx_characteristic_ == nullptr || text == nullptr) {
    return false;
  }
  last_ble_activity_ms_ = millis();
  tx_characteristic_->setValue(reinterpret_cast<uint8_t*>(const_cast<char*>(text)), strlen(text));
  tx_characteristic_->notify();
  return true;
}

void LifeLinkBluetooth::startAdvertising() {
  if (advertising_started_)
    return;
  BLEDevice::startAdvertising();
  advertising_started_ = true;
  Serial.println("[BT] Advertising started.");
}

void LifeLinkBluetooth::onClientConnect() {
  device_connected_ = true;
  advertising_started_ = false;
  last_ble_activity_ms_ = millis();
  state_ = BtState::kStandby;
  Serial.println("[BT] Client connected; standby for message.");
}

void LifeLinkBluetooth::onClientDisconnect() {
  device_connected_ = false;
  advertising_started_ = false;
  // Re-advertise immediately so setup can quickly switch to another node.
  startAdvertising();
  last_adv_restart_ms_ = millis();
  state_ = BtState::kConnecting;
  Serial.println("[BT] Client disconnected; advertising resumed.");
}

void LifeLinkBluetooth::onMessageWritten(const uint8_t* data, size_t len) {
  last_ble_activity_ms_ = millis();
  if (len == 0)
    return;
  if (len > kMessageBufferSize - 1)
    len = kMessageBufferSize - 1;
  memcpy(message_buffer_, data, len);
  message_buffer_[len] = '\0';
  message_len_ = len;
  state_ = BtState::kMessageReceived;
}

void LifeLinkBluetooth::runStateDisconnected() {
  if (!timer_fired_)
    return;
  timer_fired_ = false;
  startAdvertising();
  last_adv_restart_ms_ = millis();
  state_ = BtState::kConnecting;
}

void LifeLinkBluetooth::runStateConnecting() {
  // Stay here until onClientConnect (Standby). No delay—return immediately
  // so loop() keeps ticking and LoRa can receive messages from other nodes.
  if (device_connected_) {
    return;
  }
  const unsigned long now = millis();
  if (now - last_adv_restart_ms_ >= ADV_RESTART_INTERVAL_MS) {
    // Self-heal: if BLE stack dropped advertising silently, force a restart.
    advertising_started_ = false;
    startAdvertising();
    last_adv_restart_ms_ = now;
    Serial.println("[BT] Advertising watchdog restart.");
  }
}

void LifeLinkBluetooth::runStateStandby() {
  // Detect stale connections (e.g., gateway process killed without graceful disconnect).
  // If no BLE activity for kBleInactivityTimeoutMs, force-disconnect and re-advertise.
  const unsigned long now = millis();
  if (now - last_ble_activity_ms_ >= kBleInactivityTimeoutMs) {
    Serial.println("[BT] Stale connection detected — forcing disconnect.");
    device_connected_ = false;
    advertising_started_ = false;
    // Tell BLE stack to drop the connection
    if (ble_server_ != nullptr) {
      ble_server_->disconnect(ble_server_->getConnId());
    }
    startAdvertising();
    last_adv_restart_ms_ = now;
    state_ = BtState::kConnecting;
  }
}

void LifeLinkBluetooth::runStateMessageReceived() {
  // Run decision tree (callback); then return to standby.
  if (message_callback_) {
    message_callback_(message_buffer_, message_len_);
  } else {
    Serial.printf("[BT] Message received (%u bytes): run decision tree (callback not set).\n",
                  static_cast<unsigned>(message_len_));
  }
  state_ = BtState::kStandby;
}
