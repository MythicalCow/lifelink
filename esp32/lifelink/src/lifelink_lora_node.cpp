#include "lifelink_lora_node.h"

#include <cstdlib>
#include <cstring>
#include <esp_mac.h>
#include "ai_triage.h"

LifeLinkLoRaNode* LifeLinkLoRaNode::instance_ = nullptr;
volatile bool LifeLinkLoRaNode::operation_done_ = false;
namespace {
constexpr float kHopChannelsMhz[8] = {
    903.9f, 904.1f, 904.3f, 904.5f, 904.7f, 904.9f, 905.1f, 905.3f};
}

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
  hop_seed_ = static_cast<uint32_t>((node_id_ << 16) ^ 0xA5B35713UL);
  hop_leader_id_ = static_cast<uint16_t>(node_id_ & 0xFFFF);
  snprintf(node_name_, sizeof(node_name_), "Node-%04X", static_cast<unsigned>(node_id_ & 0xFFFF));
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
  randomSeed(static_cast<unsigned long>(node_id_) ^ micros());

  const uint32_t now = millis();
  next_heartbeat_at_ms_ = now + 1000 + (node_id_ % 700);
  next_hop_at_ms_ = now + kHopIntervalMs;
  next_test_data_at_ms_ = now + 4000 + (node_id_ % 3000);
  next_membership_print_at_ms_ = now + 6000;

  Serial.println("[INIT] Radio initialized, entering mesh mode.");
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
  Serial.printf("Hop seed:   0x%08lX\n", static_cast<unsigned long>(hop_seed_));
  Serial.printf("Hop ch:     %u @ %.1f MHz\n", static_cast<unsigned>(current_hop_channel_), kHopChannelsMhz[current_hop_channel_]);
  Serial.println();
}

void LifeLinkLoRaNode::runStateIdle() {
  delay(100);
  runSchedulers();
  state_ = (tx_q_size_ > 0) ? NodeState::kTx : NodeState::kRx;
}

void LifeLinkLoRaNode::runStateTx() {
  if (!dequeueFrame(tx_packet_)) {
    state_ = NodeState::kRx;
    return;
  }
  ++tx_count_;
  Serial.printf("[TX] %s\n", tx_packet_);

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
    ++rx_count_;
    parseAndHandlePacket(rx_packet_);
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
  state_ = (tx_q_size_ > 0) ? NodeState::kTx : NodeState::kRx;
}

void LifeLinkLoRaNode::runStateRxDone() {
  radio_.standby();
  runSchedulers();
  state_ = (tx_q_size_ > 0) ? NodeState::kTx : NodeState::kRx;
}

void LifeLinkLoRaNode::runStateTxTimeout() {
  ++error_count_;
  Serial.printf("[TX] Timeout (errors: %lu)\n", static_cast<unsigned long>(error_count_));
  radio_.standby();
  delay(250);
  state_ = NodeState::kRx;
}

void LifeLinkLoRaNode::runStateRxTimeout() {
  radio_.standby();
  runSchedulers();
  state_ = (tx_q_size_ > 0) ? NodeState::kTx : NodeState::kRx;
}

void LifeLinkLoRaNode::runStateRxError() {
  ++error_count_;
  Serial.printf("[RX] Error (possible CRC fail) - errors: %lu\n", static_cast<unsigned long>(error_count_));
  radio_.standby();
  state_ = NodeState::kRx;
}

void LifeLinkLoRaNode::runSchedulers() {
  const uint32_t now = millis();
  expirePendingData();
  maybeApplyFrequencyHop(now);

  if (now >= next_heartbeat_at_ms_) {
    sendHeartbeat();
    next_heartbeat_at_ms_ = now + kHeartbeatIntervalMs + static_cast<uint32_t>(random(0, 1000));
  }
  if (now >= next_test_data_at_ms_) {
    sendTestDataIfPossible();
    next_test_data_at_ms_ = now + kTestDataIntervalMs + static_cast<uint32_t>(random(0, 2500));
  }
  if (now >= next_membership_print_at_ms_) {
    printMembership();
    next_membership_print_at_ms_ = now + 10000;
  }
}

void LifeLinkLoRaNode::sendHeartbeat() {
  ++heartbeat_seq_;
  if (hop_leader_id_ == static_cast<uint16_t>(node_id_ & 0xFFFF)) {
    last_hop_seq_ = heartbeat_seq_;
    maybeApplyFrequencyHop(millis(), true);
  }
  char frame[kBufferSize];
  snprintf(
      frame,
      sizeof(frame),
      "H|%04X|%lu|%08lX|%s",
      node_id_,
      static_cast<unsigned long>(heartbeat_seq_),
      static_cast<unsigned long>(hop_seed_),
      node_name_);
  enqueueFrame(frame);
}

uint16_t LifeLinkLoRaNode::selectHopLeader() const {
  uint16_t leader = static_cast<uint16_t>(node_id_ & 0xFFFF);
  const uint32_t now = millis();
  for (size_t i = 0; i < kMaxMembers; ++i) {
    if (!members_[i].used) {
      continue;
    }
    if (now - members_[i].last_seen_ms > kMembershipTimeoutMs) {
      continue;
    }
    if (members_[i].node_id < leader) {
      leader = members_[i].node_id;
    }
  }
  return leader;
}

uint8_t LifeLinkLoRaNode::computeHopChannelIndex(uint32_t seed, uint32_t seq) const {
  uint32_t mixed = seed ^ (seq * 1103515245UL + 12345UL);
  mixed ^= (mixed >> 13);
  return static_cast<uint8_t>(mixed % kHopChannelCount);
}

void LifeLinkLoRaNode::maybeApplyFrequencyHop(uint32_t now_ms, bool force) {
  if (!force && now_ms < next_hop_at_ms_) {
    return;
  }
  next_hop_at_ms_ = now_ms + kHopIntervalMs;

  hop_leader_id_ = selectHopLeader();
  uint32_t leader_seed = hop_seed_;
  uint32_t leader_seq = heartbeat_seq_;
  if (hop_leader_id_ != static_cast<uint16_t>(node_id_ & 0xFFFF)) {
    for (size_t i = 0; i < kMaxMembers; ++i) {
      if (!members_[i].used || members_[i].node_id != hop_leader_id_) {
        continue;
      }
      leader_seed = members_[i].hop_seed != 0 ? members_[i].hop_seed : hop_seed_;
      leader_seq = members_[i].last_heartbeat_seq;
      break;
    }
  }
  if (!force && leader_seq == last_hop_seq_) {
    return;
  }
  last_hop_seq_ = leader_seq;

  const uint8_t next_channel = computeHopChannelIndex(leader_seed, leader_seq);
  if (!force && next_channel == current_hop_channel_) {
    return;
  }
  const int rc = radio_.setFrequency(kHopChannelsMhz[next_channel]);
  if (rc == RADIOLIB_ERR_NONE) {
    current_hop_channel_ = next_channel;
    Serial.printf(
        "[HOP] leader=0x%04X seed=0x%08lX seq=%lu ch=%u freq=%.1f\n",
        hop_leader_id_,
        static_cast<unsigned long>(leader_seed),
        static_cast<unsigned long>(leader_seq),
        static_cast<unsigned>(current_hop_channel_),
        kHopChannelsMhz[current_hop_channel_]);
  } else {
    Serial.printf("[HOP] setFrequency failed rc=%d\n", rc);
  }
}

void LifeLinkLoRaNode::setNodeName(const char* name) {
  if (name == nullptr || name[0] == '\0') {
    return;
  }
  strncpy(node_name_, name, sizeof(node_name_) - 1);
  node_name_[sizeof(node_name_) - 1] = '\0';
}

uint16_t LifeLinkLoRaNode::messageHistoryCount() const {
  return history_count_;
}

bool LifeLinkLoRaNode::getMessageHistory(uint16_t idx, MessageHistoryEntry* out) const {
  if (out == nullptr || idx >= history_count_) {
    return false;
  }
  const uint16_t start =
      static_cast<uint16_t>((history_head_ + kMaxMessageHistory - history_count_) % kMaxMessageHistory);
  const uint16_t slot = static_cast<uint16_t>((start + idx) % kMaxMessageHistory);
  *out = history_[slot];
  return true;
}

void LifeLinkLoRaNode::appendHistory(
    char direction,
    uint16_t peer,
    uint16_t msg_id,
    const char* body,
    const TriageOutput* triage) {
  MessageHistoryEntry& entry = history_[history_head_];
  entry.direction = direction;
  entry.peer = peer;
  entry.msg_id = msg_id;
  entry.vital = (triage != nullptr) ? triage->is_vital : false;
  entry.urgency = (triage != nullptr) ? triage->urgency : 0;
  strncpy(entry.intent, (triage != nullptr) ? triage->intent.c_str() : "CHAT", sizeof(entry.intent) - 1);
  entry.intent[sizeof(entry.intent) - 1] = '\0';
  strncpy(entry.body, (body != nullptr) ? body : "", sizeof(entry.body) - 1);
  entry.body[sizeof(entry.body) - 1] = '\0';

  history_head_ = static_cast<uint16_t>((history_head_ + 1) % kMaxMessageHistory);
  if (history_count_ < kMaxMessageHistory) {
    ++history_count_;
  }
}

TriageOutput LifeLinkLoRaNode::decodeTriageFromPayload(const char* body) const {
  TriageOutput out{};
  out.is_vital = false;
  out.wire_payload = String((body != nullptr) ? body : "");
  out.intent = String("CHAT");
  out.urgency = 0;
  out.flags = 0;
  out.count = 0;
  out.location = String("unknown");

  if (body == nullptr || body[0] == '\0') {
    return out;
  }

  const char* u_pos = strstr(body, "|U");
  if (u_pos == nullptr) {
    return out;
  }

  out.is_vital = true;
  const char* first_sep = strchr(body, '|');
  if (first_sep != nullptr) {
    char intent_buf[12];
    size_t n = static_cast<size_t>(first_sep - body);
    if (n > sizeof(intent_buf) - 1) {
      n = sizeof(intent_buf) - 1;
    }
    memcpy(intent_buf, body, n);
    intent_buf[n] = '\0';
    out.intent = String(intent_buf);
  } else {
    out.intent = String("INFO");
  }
  out.urgency = static_cast<uint8_t>(strtoul(u_pos + 2, nullptr, 10));
  if (out.urgency > 3) {
    out.urgency = 3;
  }
  return out;
}

bool LifeLinkLoRaNode::queueBleMessage(uint16_t dst, const char* text) {
  if (text == nullptr || text[0] == '\0') {
    return false;
  }

  const uint16_t msg_id = ++local_msg_seq_;
  markLocalMessageSeen(PacketType::kData, node_id_, msg_id);
  const TriageOutput triage = runTriage(String(text));
  String body_text = triage.wire_payload;
  if (body_text.length() > 48) {
    body_text = body_text.substring(0, 48);
  }

  char frame[kBufferSize];
  snprintf(
      frame,
      sizeof(frame),
      "D|%04X|%04X|%04X|%u|%u|%u|%s",
      node_id_,
      node_id_,
      dst,
      msg_id,
      kDefaultTtl,
      0,
      body_text.c_str());

  if (!enqueueFrame(frame)) {
    return false;
  }

  addPendingData(msg_id, dst);
  appendHistory('S', dst, msg_id, body_text.c_str(), &triage);
  Serial.printf(
      "[BLE->LORA] queued msg=%u to 0x%04X vital=%s intent=%s urg=%u payload=\"%s\"\n",
      msg_id,
      dst,
      triage.is_vital ? "yes" : "no",
      triage.intent.c_str(),
      triage.urgency,
      body_text.c_str());
  return true;
}

void LifeLinkLoRaNode::sendTestDataIfPossible() {
  static const char* const kTestTexts[] = {
      "need a medic for 2 injured near the bridge asap",
      "we are out of clean water at camp",
      "any update near the library",
      "shots fired behind the market urgent",
      "hello team checking in all good",
      "need shelter tonight at school",
  };

  uint16_t peers[kMaxMembers] = {};
  const size_t peer_count = collectActivePeers(peers, kMaxMembers);
  if (peer_count == 0) {
    return;
  }

  const uint16_t dst = peers[random(static_cast<long>(peer_count))];
  const uint16_t msg_id = ++local_msg_seq_;
  markLocalMessageSeen(PacketType::kData, node_id_, msg_id);

  const char* src_text = kTestTexts[random(static_cast<long>(sizeof(kTestTexts) / sizeof(kTestTexts[0])))];
  const TriageOutput triage = runTriage(String(src_text));
  String body_text = triage.wire_payload;
  if (body_text.length() > 48) {
    body_text = body_text.substring(0, 48);
  }

  char frame[kBufferSize];
  snprintf(
      frame,
      sizeof(frame),
      "D|%04X|%04X|%04X|%u|%u|%u|%s",
      node_id_,
      node_id_,
      dst,
      msg_id,
      kDefaultTtl,
      0,
      body_text.c_str());
  if (enqueueFrame(frame)) {
    addPendingData(msg_id, dst);
    appendHistory('S', dst, msg_id, body_text.c_str(), &triage);
    Serial.printf(
        "[AI] queued DATA msg=%u -> 0x%04X vital=%s intent=%s urg=%u payload=\"%s\"\n",
        msg_id,
        dst,
        triage.is_vital ? "yes" : "no",
        triage.intent.c_str(),
        triage.urgency,
        body_text.c_str());
  }
}

bool LifeLinkLoRaNode::enqueueFrame(const char* frame) {
  if (tx_q_size_ >= kMaxTxQueue) {
    return false;
  }
  strncpy(tx_queue_[tx_q_tail_].payload, frame, kBufferSize - 1);
  tx_queue_[tx_q_tail_].payload[kBufferSize - 1] = '\0';
  tx_queue_[tx_q_tail_].used = true;
  tx_q_tail_ = (tx_q_tail_ + 1) % kMaxTxQueue;
  ++tx_q_size_;
  return true;
}

bool LifeLinkLoRaNode::dequeueFrame(char* out_payload) {
  if (tx_q_size_ == 0) {
    return false;
  }
  strncpy(out_payload, tx_queue_[tx_q_head_].payload, kBufferSize - 1);
  out_payload[kBufferSize - 1] = '\0';
  tx_queue_[tx_q_head_].used = false;
  tx_q_head_ = (tx_q_head_ + 1) % kMaxTxQueue;
  --tx_q_size_;
  return true;
}

void LifeLinkLoRaNode::parseAndHandlePacket(const char* packet) {
  char copy[kBufferSize];
  strncpy(copy, packet, sizeof(copy) - 1);
  copy[sizeof(copy) - 1] = '\0';

  char* save = nullptr;
  char* t = strtok_r(copy, "|", &save);
  if (!t || !t[0]) {
    return;
  }

  if (t[0] == 'H') {
    const char* from_s = strtok_r(nullptr, "|", &save);
    const char* seq_s = strtok_r(nullptr, "|", &save);
    const char* seed_or_name_s = strtok_r(nullptr, "|", &save);
    const char* maybe_name_s = strtok_r(nullptr, "|", &save);
    if (!from_s || !seq_s) return;
    const uint16_t from = static_cast<uint16_t>(strtoul(from_s, nullptr, 16));
    const uint32_t seq = static_cast<uint32_t>(strtoul(seq_s, nullptr, 10));
    uint32_t hop_seed = 0;
    const char* name_s = "";
    if (seed_or_name_s != nullptr) {
      const bool looks_seed = strlen(seed_or_name_s) == 8;
      if (looks_seed && maybe_name_s != nullptr) {
        hop_seed = static_cast<uint32_t>(strtoul(seed_or_name_s, nullptr, 16));
        name_s = maybe_name_s;
      } else {
        name_s = seed_or_name_s;
      }
    }
    handleHeartbeat(from, seq, hop_seed, name_s ? name_s : "");
    return;
  }

  const char* from_s = strtok_r(nullptr, "|", &save);
  const char* origin_s = strtok_r(nullptr, "|", &save);
  const char* dst_s = strtok_r(nullptr, "|", &save);
  const char* msg_s = strtok_r(nullptr, "|", &save);
  const char* ttl_s = strtok_r(nullptr, "|", &save);
  const char* hops_s = strtok_r(nullptr, "|", &save);
  if (!from_s || !origin_s || !dst_s || !msg_s || !ttl_s || !hops_s) {
    return;
  }

  const uint16_t from = static_cast<uint16_t>(strtoul(from_s, nullptr, 16));
  const uint16_t origin = static_cast<uint16_t>(strtoul(origin_s, nullptr, 16));
  const uint16_t dst = static_cast<uint16_t>(strtoul(dst_s, nullptr, 16));
  const uint16_t msg_id = static_cast<uint16_t>(strtoul(msg_s, nullptr, 10));
  const uint8_t ttl = static_cast<uint8_t>(strtoul(ttl_s, nullptr, 10));
  const uint8_t hops = static_cast<uint8_t>(strtoul(hops_s, nullptr, 10));

  if (t[0] == 'D') {
    const char* body = strtok_r(nullptr, "", &save);
    handleData(from, origin, dst, msg_id, ttl, hops, body ? body : "");
  } else if (t[0] == 'A') {
    handleAck(from, origin, dst, msg_id, ttl, hops);
  }
}

void LifeLinkLoRaNode::handleHeartbeat(uint16_t from, uint32_t seq, uint32_t hop_seed, const char* name) {
  if (from == node_id_) {
    return;
  }
  upsertMember(from, seq);
  for (size_t i = 0; i < kMaxMembers; ++i) {
    if (!members_[i].used || members_[i].node_id != from) {
      continue;
    }
    if (name != nullptr && name[0] != '\0') {
      strncpy(members_[i].name, name, sizeof(members_[i].name) - 1);
      members_[i].name[sizeof(members_[i].name) - 1] = '\0';
    }
    if (hop_seed != 0) {
      members_[i].hop_seed = hop_seed;
    }
    break;
  }
  maybeApplyFrequencyHop(millis(), true);
  Serial.printf(
      "[HB] node 0x%04X (%s) seq=%lu seed=0x%08lX RSSI=%.1f SNR=%.1f\n",
      from,
      (name != nullptr && name[0] != '\0') ? name : "unknown",
      static_cast<unsigned long>(seq),
      static_cast<unsigned long>(hop_seed),
      rx_rssi_,
      rx_snr_);
}

void LifeLinkLoRaNode::handleData(
    uint16_t from,
    uint16_t origin,
    uint16_t dst,
    uint16_t msg_id,
    uint8_t ttl,
    uint8_t hops,
    const char* body) {
  upsertMember(from, 0);
  if (origin != node_id_) {
    upsertMember(origin, 0);
  }

  if (hasSeenAndRemember(PacketType::kData, origin, msg_id)) {
    return;
  }

  if (dst == node_id_) {
    Serial.printf(
        "[DATA] recv msg=%u from 0x%04X origin 0x%04X hops=%u body=\"%s\"\n",
        msg_id,
        from,
        origin,
        hops,
        body);

    if (strstr(body, "|U") != nullptr && strstr(body, "|F") != nullptr && strstr(body, "|N") != nullptr &&
        strstr(body, "|L") != nullptr) {
      Serial.println("[AI] received compact vital payload");
    }
    const TriageOutput triage_meta = decodeTriageFromPayload(body);
    appendHistory('R', origin, msg_id, body, &triage_meta);

    // Send ACK back to source (origin of DATA) via the same flooding relay behavior.
    const uint16_t ack_origin = node_id_;
    markLocalMessageSeen(PacketType::kAck, ack_origin, msg_id);
    char ack_frame[kBufferSize];
    snprintf(
        ack_frame,
        sizeof(ack_frame),
        "A|%04X|%04X|%04X|%u|%u|%u",
        node_id_,
        ack_origin,
        origin,
        msg_id,
        kDefaultTtl,
        0);
    enqueueFrame(ack_frame);
    return;
  }

  relayPacket(PacketType::kData, origin, dst, msg_id, ttl, hops, body);
}

void LifeLinkLoRaNode::handleAck(
    uint16_t from,
    uint16_t origin,
    uint16_t dst,
    uint16_t msg_id,
    uint8_t ttl,
    uint8_t hops) {
  upsertMember(from, 0);
  if (origin != node_id_) {
    upsertMember(origin, 0);
  }

  if (hasSeenAndRemember(PacketType::kAck, origin, msg_id)) {
    return;
  }

  if (dst == node_id_) {
    Serial.printf("[ACK] msg=%u confirmed by 0x%04X (hops=%u)\n", msg_id, origin, hops);
    ackPendingData(msg_id, origin);
    return;
  }

  relayPacket(PacketType::kAck, origin, dst, msg_id, ttl, hops, "");
}

void LifeLinkLoRaNode::relayPacket(
    PacketType type,
    uint16_t origin,
    uint16_t dst,
    uint16_t msg_id,
    uint8_t ttl,
    uint8_t hops,
    const char* body) {
  if (ttl == 0) {
    return;
  }
  const uint8_t next_ttl = ttl - 1;
  const uint8_t next_hops = hops + 1;

  char frame[kBufferSize];
  if (type == PacketType::kData) {
    snprintf(
        frame,
        sizeof(frame),
        "D|%04X|%04X|%04X|%u|%u|%u|%s",
        node_id_,
        origin,
        dst,
        msg_id,
        next_ttl,
        next_hops,
        body);
  } else {
    snprintf(
        frame,
        sizeof(frame),
        "A|%04X|%04X|%04X|%u|%u|%u",
        node_id_,
        origin,
        dst,
        msg_id,
        next_ttl,
        next_hops);
  }
  enqueueFrame(frame);
}

void LifeLinkLoRaNode::upsertMember(uint16_t node_id, uint32_t heartbeat_seq) {
  if (node_id == node_id_) {
    return;
  }
  const uint32_t now = millis();
  for (size_t i = 0; i < kMaxMembers; ++i) {
    if (members_[i].used && members_[i].node_id == node_id) {
      members_[i].last_seen_ms = now;
      if (heartbeat_seq != 0) {
        members_[i].last_heartbeat_seq = heartbeat_seq;
      }
      return;
    }
  }
  for (size_t i = 0; i < kMaxMembers; ++i) {
    if (!members_[i].used) {
      members_[i].used = true;
      members_[i].node_id = node_id;
      members_[i].last_seen_ms = now;
      members_[i].last_heartbeat_seq = heartbeat_seq;
      members_[i].hop_seed = 0;
      strncpy(members_[i].name, "unknown", sizeof(members_[i].name) - 1);
      members_[i].name[sizeof(members_[i].name) - 1] = '\0';
      return;
    }
  }
}

size_t LifeLinkLoRaNode::collectActivePeers(uint16_t* out_peers, size_t max_out) const {
  const uint32_t now = millis();
  size_t count = 0;
  for (size_t i = 0; i < kMaxMembers && count < max_out; ++i) {
    if (!members_[i].used) {
      continue;
    }
    if (now - members_[i].last_seen_ms <= kMembershipTimeoutMs) {
      out_peers[count++] = members_[i].node_id;
    }
  }
  return count;
}

bool LifeLinkLoRaNode::hasSeenAndRemember(PacketType type, uint16_t origin, uint16_t msg_id) {
  const uint32_t now = millis();
  for (size_t i = 0; i < kMaxSeen; ++i) {
    if (!seen_[i].used) {
      continue;
    }
    if (now - seen_[i].seen_at_ms > kMembershipTimeoutMs) {
      seen_[i].used = false;
      continue;
    }
    if (seen_[i].type == type && seen_[i].origin == origin && seen_[i].msg_id == msg_id) {
      return true;
    }
  }
  for (size_t i = 0; i < kMaxSeen; ++i) {
    if (!seen_[i].used) {
      seen_[i].used = true;
      seen_[i].type = type;
      seen_[i].origin = origin;
      seen_[i].msg_id = msg_id;
      seen_[i].seen_at_ms = now;
      return false;
    }
  }
  // Replace oldest entry if table is full.
  size_t oldest = 0;
  for (size_t i = 1; i < kMaxSeen; ++i) {
    if (seen_[i].seen_at_ms < seen_[oldest].seen_at_ms) {
      oldest = i;
    }
  }
  seen_[oldest].used = true;
  seen_[oldest].type = type;
  seen_[oldest].origin = origin;
  seen_[oldest].msg_id = msg_id;
  seen_[oldest].seen_at_ms = now;
  return false;
}

void LifeLinkLoRaNode::markLocalMessageSeen(PacketType type, uint16_t origin, uint16_t msg_id) {
  (void)hasSeenAndRemember(type, origin, msg_id);
}

void LifeLinkLoRaNode::addPendingData(uint16_t msg_id, uint16_t dst) {
  const uint32_t now = millis();
  for (size_t i = 0; i < kMaxPendingData; ++i) {
    if (!pending_data_[i].used) {
      pending_data_[i].used = true;
      pending_data_[i].msg_id = msg_id;
      pending_data_[i].dst = dst;
      pending_data_[i].sent_at_ms = now;
      pending_data_[i].acked = false;
      return;
    }
  }
}

void LifeLinkLoRaNode::ackPendingData(uint16_t msg_id, uint16_t from) {
  for (size_t i = 0; i < kMaxPendingData; ++i) {
    if (!pending_data_[i].used || pending_data_[i].acked) {
      continue;
    }
    if (pending_data_[i].msg_id == msg_id) {
      pending_data_[i].acked = true;
      pending_data_[i].used = false;
      Serial.printf("[TEST] delivery ok msg=%u via ACK from 0x%04X\n", msg_id, from);
      return;
    }
  }
}

void LifeLinkLoRaNode::expirePendingData() {
  const uint32_t now = millis();
  for (size_t i = 0; i < kMaxPendingData; ++i) {
    if (!pending_data_[i].used || pending_data_[i].acked) {
      continue;
    }
    if (now - pending_data_[i].sent_at_ms > kAckTimeoutMs) {
      Serial.printf("[TEST] delivery timeout msg=%u to 0x%04X\n", pending_data_[i].msg_id, pending_data_[i].dst);
      pending_data_[i].used = false;
    }
  }
}

void LifeLinkLoRaNode::printMembership() const {
  const uint32_t now = millis();
  Serial.printf(
      "[MEMBERS] active peers (hop leader=0x%04X ch=%u freq=%.1f):\n",
      hop_leader_id_,
      static_cast<unsigned>(current_hop_channel_),
      kHopChannelsMhz[current_hop_channel_]);
  bool any = false;
  for (size_t i = 0; i < kMaxMembers; ++i) {
    if (!members_[i].used) {
      continue;
    }
    const uint32_t age = now - members_[i].last_seen_ms;
    if (age > kMembershipTimeoutMs) {
      continue;
    }
    any = true;
    Serial.printf("  - 0x%04X (%s) last_seen=%lums hb_seq=%lu seed=0x%08lX\n",
                  members_[i].node_id,
                  members_[i].name,
                  static_cast<unsigned long>(age),
                  static_cast<unsigned long>(members_[i].last_heartbeat_seq),
                  static_cast<unsigned long>(members_[i].hop_seed));
  }
  if (!any) {
    Serial.println("  (none)");
  }
}

