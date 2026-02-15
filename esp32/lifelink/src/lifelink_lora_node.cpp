/* ── LifeLinkLoRaNode ─────────────────────────────────
 * Mesh protocol: Epidemic Gossip membership + Flood routing
 * Matches the simulation in ui/src/simulation/mesh-node.ts
 * ───────────────────────────────────────────────────── */

#include "lifelink_lora_node.h"

#include <cstdlib>
#include <cstring>
#include <esp_mac.h>
#include "ai_triage.h"

LifeLinkLoRaNode* LifeLinkLoRaNode::instance_ = nullptr;
volatile bool LifeLinkLoRaNode::operation_done_ = false;

namespace {
constexpr float kHopChannelsMhz[2] = {
    903.9f, 904.1f};
}

#if defined(ESP8266) || defined(ESP32)
ICACHE_RAM_ATTR
#endif
void LifeLinkLoRaNode::onDio1Rise() {
  operation_done_ = true;
}

/* ═══════════════════════════════════════════════════════
 *  begin / tick
 * ═══════════════════════════════════════════════════════ */

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
      kRfFrequencyMhz, kBandwidthKhz, kSpreadingFactor,
      kCodingRate, kSyncWord, kTxPowerDbm, kPreambleLength);

  if (init_state == RADIOLIB_ERR_NONE) {
    Serial.println("success");
  } else {
    Serial.printf("failed, code %d\n", init_state);
    Serial.println("Check wiring and pin definitions.");
    while (true) { delay(1000); }
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
    case NodeState::kIdle:     runStateIdle();      break;
    case NodeState::kTx:       runStateTx();        break;
    case NodeState::kRx:       runStateRx();        break;
    case NodeState::kTxDone:   runStateTxDone();    break;
    case NodeState::kRxDone:   runStateRxDone();    break;
    case NodeState::kTxTimeout:runStateTxTimeout();  break;
    case NodeState::kRxTimeout:runStateRxTimeout();  break;
    case NodeState::kRxError:  runStateRxError();    break;
  }
}

/* ═══════════════════════════════════════════════════════
 *  Helpers
 * ═══════════════════════════════════════════════════════ */

uint32_t LifeLinkLoRaNode::resolveNodeId() const {
  // Use the BLE MAC so that the node ID matches what users see during BLE scan.
  // On ESP32-S3 the BLE MAC is base MAC + 1, while WiFi STA is base MAC + 0.
  uint8_t mac[6] = {0};
  if (esp_read_mac(mac, ESP_MAC_BT) == ESP_OK) {
    return (static_cast<uint32_t>(mac[4]) << 8) | static_cast<uint32_t>(mac[5]);
  }
  // Fallback: WiFi STA MAC
  if (esp_read_mac(mac, ESP_MAC_WIFI_STA) == ESP_OK) {
    return (static_cast<uint32_t>(mac[4]) << 8) | static_cast<uint32_t>(mac[5]);
  }
  const uint64_t chip_id = ESP.getEfuseMac();
  return static_cast<uint32_t>(chip_id & 0xFFFF);
}

void LifeLinkLoRaNode::printBanner() const {
  Serial.println();
  Serial.println("LifeLink LoRa Mesh Node (Epidemic Gossip)");
  Serial.printf("Node ID:    0x%04X\n", node_id_);
  Serial.printf("Name:       %s\n", node_name_);
  Serial.printf("Frequency:  %.1f MHz\n", kRfFrequencyMhz);
  Serial.printf("TX Power:   %d dBm\n", kTxPowerDbm);
  Serial.printf("SF:         %d\n", kSpreadingFactor);
  Serial.printf("BW:         %.0f kHz\n", kBandwidthKhz);
  Serial.printf("Hop seed:   0x%08lX\n", static_cast<unsigned long>(hop_seed_));
  Serial.printf("Gossip max: %u entries/heartbeat\n", static_cast<unsigned>(kMaxGossipEntries));
  Serial.println();
}

/* ═══════════════════════════════════════════════════════
 *  Radio state machine
 * ═══════════════════════════════════════════════════════ */

void LifeLinkLoRaNode::runStateIdle() {
  delay(100);
  runSchedulers();
  state_ = (tx_q_size_ > 0) ? NodeState::kTx : NodeState::kRx;
}

void LifeLinkLoRaNode::runStateTx() {
  if (!dequeueFrame(tx_packet_)) { state_ = NodeState::kRx; return; }
  ++tx_count_;
  Serial.printf("[TX] %s\n", tx_packet_);

  operation_done_ = false;
  const int tx_state = radio_.startTransmit(tx_packet_);
  if (tx_state != RADIOLIB_ERR_NONE) {
    Serial.printf("[TX] Failed, code %d\n", tx_state);
    ++error_count_;
    state_ = NodeState::kIdle;
    return;
  }
  const unsigned long start = millis();
  while (!operation_done_ && (millis() - start < 3000)) { yield(); }
  state_ = operation_done_ ? NodeState::kTxDone : NodeState::kTxTimeout;
}

void LifeLinkLoRaNode::runStateRx() {
  operation_done_ = false;
  const int rx_state = radio_.startReceive();
  if (rx_state != RADIOLIB_ERR_NONE) {
    Serial.printf("[RX] Failed, code %d\n", rx_state);
    ++error_count_;
    state_ = NodeState::kIdle;
    return;
  }
  const unsigned long start = millis();
  while (!operation_done_ && (millis() - start < kRxTimeoutMs)) { yield(); }
  if (!operation_done_) { state_ = NodeState::kRxTimeout; return; }

  rx_size_ = radio_.getPacketLength();
  if (rx_size_ > kBufferSize - 1) rx_size_ = kBufferSize - 1;
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
  Serial.printf("[RX] CRC error (errors: %lu)\n", static_cast<unsigned long>(error_count_));
  radio_.standby();
  state_ = NodeState::kRx;
}

/* ═══════════════════════════════════════════════════════
 *  Schedulers
 * ═══════════════════════════════════════════════════════ */

void LifeLinkLoRaNode::runSchedulers() {
  const uint32_t now = millis();
  expirePendingData();
  maybeApplyFrequencyHop(now);

  if (now >= next_heartbeat_at_ms_) {
    sendHeartbeat();
    next_heartbeat_at_ms_ = now + kHeartbeatIntervalMs
        + static_cast<uint32_t>(random(0, static_cast<long>(kHeartbeatJitterMs)));
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

/* ═══════════════════════════════════════════════════════
 *  HEARTBEAT with Epidemic Gossip (matches sim)
 *
 *  Wire format:
 *    H|from|seq|seed|name|ttl|hops|G id:name:seq:hops;id:name:seq:hops;...
 *
 *  The gossip payload (after "G ") carries this node's
 *  knowledge of the whole network — exactly like the
 *  simulation's getGossipEntries().
 * ═══════════════════════════════════════════════════════ */

size_t LifeLinkLoRaNode::buildGossipEntries(GossipEntry* out, size_t max_entries) const {
  if (max_entries == 0) return 0;
  size_t count = 0;

  // 1) Self entry (hops=0) — matches sim: always include self first
  out[count].node_id = static_cast<uint16_t>(node_id_ & 0xFFFF);
  out[count].seq = heartbeat_seq_;
  out[count].hops_away = 0;
  strncpy(out[count].name, node_name_, sizeof(out[count].name) - 1);
  out[count].name[sizeof(out[count].name) - 1] = '\0';
  ++count;

  // 2) Most recently seen neighbors (up to max_entries-1), sorted by freshness
  //    Matches sim: [...neighborTable.values()].sort(lastSeenTick desc).slice(0, MAX-1)
  const uint32_t now = millis();
  struct SortHelper { size_t idx; uint32_t age; };
  SortHelper helpers[kMaxMembers];
  size_t n_active = 0;
  for (size_t i = 0; i < kMaxMembers; ++i) {
    if (!members_[i].used) continue;
    const uint32_t age = now - members_[i].last_seen_ms;
    if (age > kMembershipTimeoutMs) continue;
    helpers[n_active++] = {i, age};
  }
  // Simple insertion sort by ascending age (freshest first)
  for (size_t i = 1; i < n_active; ++i) {
    SortHelper key = helpers[i];
    size_t j = i;
    while (j > 0 && helpers[j - 1].age > key.age) {
      helpers[j] = helpers[j - 1];
      --j;
    }
    helpers[j] = key;
  }
  for (size_t i = 0; i < n_active && count < max_entries; ++i) {
    const MemberEntry& m = members_[helpers[i].idx];
    out[count].node_id = m.node_id;
    out[count].seq = m.last_heartbeat_seq;
    out[count].hops_away = m.hops_away;
    strncpy(out[count].name, m.name, sizeof(out[count].name) - 1);
    out[count].name[sizeof(out[count].name) - 1] = '\0';
    ++count;
  }
  return count;
}

void LifeLinkLoRaNode::processGossipEntries(
    const GossipEntry* entries, size_t count, uint16_t via_node) {
  /* Matches sim processHeartbeat() gossip loop:
   *   for entry in gossipEntries:
   *     if entry.nodeId == myId: skip
   *     newHops = entry.hopsAway + 1
   *     shouldUpdate if !existing || seqNum < entry.seq ||
   *       (same seq && existing.hops > newHops)
   */
  for (size_t i = 0; i < count; ++i) {
    const GossipEntry& ge = entries[i];
    if (ge.node_id == static_cast<uint16_t>(node_id_ & 0xFFFF)) continue;
    const uint8_t new_hops = ge.hops_away + 1;

    // Find existing member
    bool found = false;
    for (size_t m = 0; m < kMaxMembers; ++m) {
      if (!members_[m].used || members_[m].node_id != ge.node_id) continue;
      found = true;
      // Should update? (sim logic)
      const bool should_update =
          members_[m].last_heartbeat_seq < ge.seq ||
          (members_[m].last_heartbeat_seq == ge.seq && members_[m].hops_away > new_hops);
      if (should_update) {
        members_[m].last_seen_ms = millis();
        members_[m].last_heartbeat_seq = ge.seq;
        members_[m].hops_away = new_hops;
        members_[m].via_node = via_node;
        if (ge.name[0] != '\0') {
          strncpy(members_[m].name, ge.name, sizeof(members_[m].name) - 1);
          members_[m].name[sizeof(members_[m].name) - 1] = '\0';
        }
      }
      break;
    }
    if (!found) {
      // Insert new member via gossip
      upsertMember(ge.node_id, ge.seq, new_hops, via_node);
      // Update name
      for (size_t m = 0; m < kMaxMembers; ++m) {
        if (!members_[m].used || members_[m].node_id != ge.node_id) continue;
        if (ge.name[0] != '\0') {
          strncpy(members_[m].name, ge.name, sizeof(members_[m].name) - 1);
          members_[m].name[sizeof(members_[m].name) - 1] = '\0';
        }
        break;
      }
    }
  }
}

void LifeLinkLoRaNode::sendHeartbeat() {
  ++heartbeat_seq_;
  if (hop_leader_id_ == static_cast<uint16_t>(node_id_ & 0xFFFF)) {
    last_hop_seq_ = heartbeat_seq_;
    maybeApplyFrequencyHop(millis(), true);
  }
  markLocalMessageSeen(
      PacketType::kHeartbeat,
      static_cast<uint16_t>(node_id_ & 0xFFFF),
      static_cast<uint16_t>(heartbeat_seq_ & 0xFFFF));

  // Build gossip table
  GossipEntry gossip[kMaxGossipEntries];
  const size_t gossip_count = buildGossipEntries(gossip, kMaxGossipEntries);

  // Build gossip string:  "G id:name:seq:hops;id:name:seq:hops;..."
  char gossip_str[120] = {};
  size_t pos = 0;
  gossip_str[pos++] = 'G';
  gossip_str[pos++] = ' ';
  for (size_t i = 0; i < gossip_count && pos + 30 < sizeof(gossip_str); ++i) {
    if (i > 0) gossip_str[pos++] = ';';
    pos += snprintf(gossip_str + pos, sizeof(gossip_str) - pos,
        "%04X:%s:%lu:%u",
        gossip[i].node_id,
        gossip[i].name,
        static_cast<unsigned long>(gossip[i].seq),
        static_cast<unsigned>(gossip[i].hops_away));
  }
  gossip_str[pos] = '\0';

  char frame[kBufferSize];
  snprintf(frame, sizeof(frame),
      "H|%04X|%lu|%08lX|%s|%u|%u|%s",
      node_id_,
      static_cast<unsigned long>(heartbeat_seq_),
      static_cast<unsigned long>(hop_seed_),
      node_name_,
      static_cast<unsigned>(kDefaultTtl),
      0U,
      gossip_str);
  enqueueFrame(frame);
}

/* ═══════════════════════════════════════════════════════
 *  Frequency Hopping
 * ═══════════════════════════════════════════════════════ */

uint16_t LifeLinkLoRaNode::selectHopLeader() const {
  uint16_t leader = static_cast<uint16_t>(node_id_ & 0xFFFF);
  const uint32_t now = millis();
  for (size_t i = 0; i < kMaxMembers; ++i) {
    if (!members_[i].used) continue;
    if (now - members_[i].last_seen_ms > kMembershipTimeoutMs) continue;
    if (members_[i].node_id < leader) leader = members_[i].node_id;
  }
  return leader;
}

uint8_t LifeLinkLoRaNode::computeHopChannelIndex(uint32_t seed, uint32_t seq) const {
  uint32_t mixed = seed ^ (seq * 1103515245UL + 12345UL);
  mixed ^= (mixed >> 13);
  return static_cast<uint8_t>(mixed % kHopChannelCount);
}

void LifeLinkLoRaNode::maybeApplyFrequencyHop(uint32_t now_ms, bool force) {
  if (!force && now_ms < next_hop_at_ms_) return;
  next_hop_at_ms_ = now_ms + kHopIntervalMs;

  hop_leader_id_ = selectHopLeader();
  uint32_t leader_seed = hop_seed_;
  uint32_t leader_seq = heartbeat_seq_;
  if (hop_leader_id_ != static_cast<uint16_t>(node_id_ & 0xFFFF)) {
    for (size_t i = 0; i < kMaxMembers; ++i) {
      if (!members_[i].used || members_[i].node_id != hop_leader_id_) continue;
      leader_seed = members_[i].hop_seed != 0 ? members_[i].hop_seed : hop_seed_;
      leader_seq = members_[i].last_heartbeat_seq;
      break;
    }
  }
  if (!force && leader_seq == last_hop_seq_) return;
  last_hop_seq_ = leader_seq;

  const uint8_t next_ch = computeHopChannelIndex(leader_seed, leader_seq);
  if (!force && next_ch == current_hop_channel_) return;
  const int rc = radio_.setFrequency(kHopChannelsMhz[next_ch]);
  if (rc == RADIOLIB_ERR_NONE) {
    current_hop_channel_ = next_ch;
    Serial.printf("[HOP] leader=0x%04X seed=0x%08lX seq=%lu ch=%u freq=%.1f\n",
        hop_leader_id_, static_cast<unsigned long>(leader_seed),
        static_cast<unsigned long>(leader_seq),
        static_cast<unsigned>(current_hop_channel_),
        kHopChannelsMhz[current_hop_channel_]);
  }
}

/* ═══════════════════════════════════════════════════════
 *  Node name / member queries
 * ═══════════════════════════════════════════════════════ */

void LifeLinkLoRaNode::setNodeName(const char* name) {
  if (name == nullptr || name[0] == '\0') return;
  size_t j = 0;
  for (size_t i = 0; name[i] != '\0' && j + 1 < sizeof(node_name_); ++i) {
    char c = name[i];
    if (c == '|' || c == ':' || c == ';') c = '_';
    node_name_[j++] = c;
  }
  node_name_[j] = '\0';
}

uint16_t LifeLinkLoRaNode::activeMemberCount() const {
  const uint32_t now = millis();
  uint16_t count = 0;
  for (size_t i = 0; i < kMaxMembers; ++i) {
    if (!members_[i].used) continue;
    if (now - members_[i].last_seen_ms > kMembershipTimeoutMs) continue;
    ++count;
  }
  return count;
}

bool LifeLinkLoRaNode::getActiveMember(uint16_t idx, MemberSnapshot* out) const {
  if (out == nullptr) return false;
  const uint32_t now = millis();
  uint16_t cursor = 0;
  for (size_t i = 0; i < kMaxMembers; ++i) {
    if (!members_[i].used) continue;
    if (now - members_[i].last_seen_ms > kMembershipTimeoutMs) continue;
    if (cursor == idx) {
      out->node_id = members_[i].node_id;
      out->age_ms = now - members_[i].last_seen_ms;
      out->heartbeat_seq = members_[i].last_heartbeat_seq;
      out->hop_seed = members_[i].hop_seed;
      out->hops_away = members_[i].hops_away;
      strncpy(out->name, members_[i].name, sizeof(out->name) - 1);
      out->name[sizeof(out->name) - 1] = '\0';
      return true;
    }
    ++cursor;
  }
  return false;
}

/* ═══════════════════════════════════════════════════════
 *  Message history
 * ═══════════════════════════════════════════════════════ */

uint16_t LifeLinkLoRaNode::messageHistoryCount() const { return history_count_; }

bool LifeLinkLoRaNode::getMessageHistory(uint16_t idx, MessageHistoryEntry* out) const {
  if (out == nullptr || idx >= history_count_) return false;
  const uint16_t start =
      static_cast<uint16_t>((history_head_ + kMaxMessageHistory - history_count_) % kMaxMessageHistory);
  const uint16_t slot = static_cast<uint16_t>((start + idx) % kMaxMessageHistory);
  *out = history_[slot];
  return true;
}

void LifeLinkLoRaNode::appendHistory(
    char direction, uint16_t peer, uint16_t msg_id,
    const char* body, const TriageOutput* triage) {
  MessageHistoryEntry& entry = history_[history_head_];
  entry.direction = direction;
  entry.peer = peer;
  entry.msg_id = msg_id;
  entry.vital = (triage != nullptr) ? triage->is_vital : false;
  entry.urgency = (triage != nullptr) ? triage->urgency : 0;
  strncpy(entry.intent,
      (triage != nullptr) ? triage->intent.c_str() : "CHAT",
      sizeof(entry.intent) - 1);
  entry.intent[sizeof(entry.intent) - 1] = '\0';
  strncpy(entry.body, (body != nullptr) ? body : "", sizeof(entry.body) - 1);
  entry.body[sizeof(entry.body) - 1] = '\0';

  history_head_ = static_cast<uint16_t>((history_head_ + 1) % kMaxMessageHistory);
  if (history_count_ < kMaxMessageHistory) ++history_count_;
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
  if (body == nullptr || body[0] == '\0') return out;
  const char* u_pos = strstr(body, "|U");
  if (u_pos == nullptr) return out;
  out.is_vital = true;
  const char* first_sep = strchr(body, '|');
  if (first_sep != nullptr) {
    char intent_buf[12];
    size_t n = static_cast<size_t>(first_sep - body);
    if (n > sizeof(intent_buf) - 1) n = sizeof(intent_buf) - 1;
    memcpy(intent_buf, body, n);
    intent_buf[n] = '\0';
    out.intent = String(intent_buf);
  } else {
    out.intent = String("INFO");
  }
  out.urgency = static_cast<uint8_t>(strtoul(u_pos + 2, nullptr, 10));
  if (out.urgency > 3) out.urgency = 3;
  return out;
}

/* ═══════════════════════════════════════════════════════
 *  BLE → LoRa message injection (AI triage applied)
 * ═══════════════════════════════════════════════════════ */

bool LifeLinkLoRaNode::queueBleMessage(uint16_t dst, const char* text) {
  if (text == nullptr || text[0] == '\0') return false;

  const uint16_t msg_id = ++local_msg_seq_;
  markLocalMessageSeen(PacketType::kData, node_id_, msg_id);
  const TriageOutput triage = runTriage(String(text));
  String body_text = triage.wire_payload;
  if (body_text.length() > 48) body_text = body_text.substring(0, 48);

  char frame[kBufferSize];
  snprintf(frame, sizeof(frame), "D|%04X|%04X|%04X|%u|%u|%u|%s",
      node_id_, node_id_, dst, msg_id, kDefaultTtl, 0, body_text.c_str());

  if (!enqueueFrame(frame)) return false;

  addPendingData(msg_id, dst);
  appendHistory('S', dst, msg_id, body_text.c_str(), &triage);
  Serial.printf("[BLE->LORA] msg=%u -> 0x%04X vital=%s intent=%s urg=%u\n",
      msg_id, dst, triage.is_vital ? "Y" : "N",
      triage.intent.c_str(), triage.urgency);
  return true;
}

/* ═══════════════════════════════════════════════════════
 *  Test data sender (periodic, with AI triage)
 * ═══════════════════════════════════════════════════════ */

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
  if (peer_count == 0) return;

  const uint16_t dst = peers[random(static_cast<long>(peer_count))];
  const uint16_t msg_id = ++local_msg_seq_;
  markLocalMessageSeen(PacketType::kData, node_id_, msg_id);

  const char* src_text = kTestTexts[random(static_cast<long>(sizeof(kTestTexts) / sizeof(kTestTexts[0])))];
  const TriageOutput triage = runTriage(String(src_text));
  String body_text = triage.wire_payload;
  if (body_text.length() > 48) body_text = body_text.substring(0, 48);

  char frame[kBufferSize];
  snprintf(frame, sizeof(frame), "D|%04X|%04X|%04X|%u|%u|%u|%s",
      node_id_, node_id_, dst, msg_id, kDefaultTtl, 0, body_text.c_str());
  if (enqueueFrame(frame)) {
    addPendingData(msg_id, dst);
    appendHistory('S', dst, msg_id, body_text.c_str(), &triage);
    Serial.printf("[AI] DATA msg=%u -> 0x%04X vital=%s intent=%s urg=%u\n",
        msg_id, dst, triage.is_vital ? "Y" : "N",
        triage.intent.c_str(), triage.urgency);
  }
}

/* ═══════════════════════════════════════════════════════
 *  TX queue
 * ═══════════════════════════════════════════════════════ */

bool LifeLinkLoRaNode::enqueueFrame(const char* frame) {
  if (tx_q_size_ >= kMaxTxQueue) return false;
  strncpy(tx_queue_[tx_q_tail_].payload, frame, kBufferSize - 1);
  tx_queue_[tx_q_tail_].payload[kBufferSize - 1] = '\0';
  tx_queue_[tx_q_tail_].used = true;
  tx_q_tail_ = (tx_q_tail_ + 1) % kMaxTxQueue;
  ++tx_q_size_;
  return true;
}

bool LifeLinkLoRaNode::dequeueFrame(char* out_payload) {
  if (tx_q_size_ == 0) return false;
  strncpy(out_payload, tx_queue_[tx_q_head_].payload, kBufferSize - 1);
  out_payload[kBufferSize - 1] = '\0';
  tx_queue_[tx_q_head_].used = false;
  tx_q_head_ = (tx_q_head_ + 1) % kMaxTxQueue;
  --tx_q_size_;
  return true;
}

/* ═══════════════════════════════════════════════════════
 *  Packet parser + handlers
 * ═══════════════════════════════════════════════════════ */

void LifeLinkLoRaNode::parseAndHandlePacket(const char* packet) {
  char copy[kBufferSize];
  strncpy(copy, packet, sizeof(copy) - 1);
  copy[sizeof(copy) - 1] = '\0';

  char* save = nullptr;
  char* t = strtok_r(copy, "|", &save);
  if (!t || !t[0]) return;

  if (t[0] == 'H') {
    const char* from_s = strtok_r(nullptr, "|", &save);
    const char* seq_s = strtok_r(nullptr, "|", &save);
    const char* seed_s = strtok_r(nullptr, "|", &save);
    const char* name_s = strtok_r(nullptr, "|", &save);
    const char* ttl_s = strtok_r(nullptr, "|", &save);
    const char* hops_s = strtok_r(nullptr, "|", &save);
    const char* gossip_s = strtok_r(nullptr, "", &save); // rest = "G ..." or null
    if (!from_s || !seq_s) return;
    const uint16_t from = static_cast<uint16_t>(strtoul(from_s, nullptr, 16));
    const uint32_t seq = static_cast<uint32_t>(strtoul(seq_s, nullptr, 10));
    uint32_t hop_seed = 0;
    if (seed_s) hop_seed = static_cast<uint32_t>(strtoul(seed_s, nullptr, 16));
    uint8_t ttl = 0;
    uint8_t hops = 0;
    if (ttl_s) ttl = static_cast<uint8_t>(strtoul(ttl_s, nullptr, 10));
    if (hops_s) hops = static_cast<uint8_t>(strtoul(hops_s, nullptr, 10));
    handleHeartbeat(from, seq, hop_seed, name_s ? name_s : "", ttl, hops, gossip_s);
    return;
  }

  // DATA or ACK
  const char* from_s = strtok_r(nullptr, "|", &save);
  const char* origin_s = strtok_r(nullptr, "|", &save);
  const char* dst_s = strtok_r(nullptr, "|", &save);
  const char* msg_s = strtok_r(nullptr, "|", &save);
  const char* ttl_s = strtok_r(nullptr, "|", &save);
  const char* hops_s = strtok_r(nullptr, "|", &save);
  if (!from_s || !origin_s || !dst_s || !msg_s || !ttl_s || !hops_s) return;

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

/* ── Heartbeat handler with gossip ── */
void LifeLinkLoRaNode::handleHeartbeat(
    uint16_t from, uint32_t seq, uint32_t hop_seed,
    const char* name, uint8_t ttl, uint8_t hops,
    const char* gossip_str) {
  if (from == node_id_) return;
  if (hasSeenAndRemember(PacketType::kHeartbeat, from, static_cast<uint16_t>(seq & 0xFFFF))) return;

  // Direct neighbor entry (hops_away = hops + 1, min 1)
  const uint8_t effective_hops = (hops == 0) ? 1 : static_cast<uint8_t>(hops + 1);
  upsertMember(from, seq, effective_hops, from);
  for (size_t i = 0; i < kMaxMembers; ++i) {
    if (!members_[i].used || members_[i].node_id != from) continue;
    if (name != nullptr && name[0] != '\0') {
      strncpy(members_[i].name, name, sizeof(members_[i].name) - 1);
      members_[i].name[sizeof(members_[i].name) - 1] = '\0';
    }
    if (hop_seed != 0) members_[i].hop_seed = hop_seed;
    break;
  }

  // Parse & process gossip entries (epidemic protocol)
  if (gossip_str != nullptr && gossip_str[0] == 'G' && gossip_str[1] == ' ') {
    GossipEntry entries[kMaxGossipEntries];
    size_t ge_count = 0;
    char gossip_copy[120];
    strncpy(gossip_copy, gossip_str + 2, sizeof(gossip_copy) - 1);
    gossip_copy[sizeof(gossip_copy) - 1] = '\0';
    char* ge_save = nullptr;
    char* token = strtok_r(gossip_copy, ";", &ge_save);
    while (token != nullptr && ge_count < kMaxGossipEntries) {
      // Parse "id:name:seq:hops"
      char* f_save = nullptr;
      const char* id_s = strtok_r(token, ":", &f_save);
      const char* n_s = strtok_r(nullptr, ":", &f_save);
      const char* s_s = strtok_r(nullptr, ":", &f_save);
      const char* h_s = strtok_r(nullptr, ":", &f_save);
      if (id_s && n_s && s_s && h_s) {
        entries[ge_count].node_id = static_cast<uint16_t>(strtoul(id_s, nullptr, 16));
        strncpy(entries[ge_count].name, n_s, sizeof(entries[ge_count].name) - 1);
        entries[ge_count].name[sizeof(entries[ge_count].name) - 1] = '\0';
        entries[ge_count].seq = static_cast<uint32_t>(strtoul(s_s, nullptr, 10));
        entries[ge_count].hops_away = static_cast<uint8_t>(strtoul(h_s, nullptr, 10));
        ++ge_count;
      }
      token = strtok_r(nullptr, ";", &ge_save);
    }
    if (ge_count > 0) {
      processGossipEntries(entries, ge_count, from);
    }
  }

  maybeApplyFrequencyHop(millis(), true);

  // Relay heartbeat (with decremented TTL) — flood propagation
  if (ttl > 0) {
    // Rebuild gossip from OUR table (re-gossip with our knowledge, like sim)
    GossipEntry our_gossip[kMaxGossipEntries];
    const size_t our_count = buildGossipEntries(our_gossip, kMaxGossipEntries);
    char our_gossip_str[120] = {};
    size_t pos = 0;
    our_gossip_str[pos++] = 'G';
    our_gossip_str[pos++] = ' ';
    for (size_t i = 0; i < our_count && pos + 30 < sizeof(our_gossip_str); ++i) {
      if (i > 0) our_gossip_str[pos++] = ';';
      pos += snprintf(our_gossip_str + pos, sizeof(our_gossip_str) - pos,
          "%04X:%s:%lu:%u",
          our_gossip[i].node_id, our_gossip[i].name,
          static_cast<unsigned long>(our_gossip[i].seq),
          static_cast<unsigned>(our_gossip[i].hops_away));
    }
    our_gossip_str[pos] = '\0';

    char frame[kBufferSize];
    snprintf(frame, sizeof(frame), "H|%04X|%lu|%08lX|%s|%u|%u|%s",
        from, static_cast<unsigned long>(seq),
        static_cast<unsigned long>(hop_seed),
        (name != nullptr && name[0] != '\0') ? name : "unknown",
        static_cast<unsigned>(ttl - 1),
        static_cast<unsigned>(hops + 1),
        our_gossip_str);
    enqueueFrame(frame);
  }

  Serial.printf("[HB] 0x%04X (%s) seq=%lu hops=%u ttl=%u RSSI=%.1f SNR=%.1f\n",
      from, (name && name[0]) ? name : "?",
      static_cast<unsigned long>(seq),
      static_cast<unsigned>(hops), static_cast<unsigned>(ttl),
      rx_rssi_, rx_snr_);
}

/* ── Data handler ── */
void LifeLinkLoRaNode::handleData(
    uint16_t from, uint16_t origin, uint16_t dst,
    uint16_t msg_id, uint8_t ttl, uint8_t hops, const char* body) {
  upsertMember(from, 0, 1, from);
  if (origin != node_id_) upsertMember(origin, 0);
  if (hasSeenAndRemember(PacketType::kData, origin, msg_id)) return;

  if (dst == node_id_) {
    Serial.printf("[DATA] recv msg=%u from 0x%04X origin 0x%04X hops=%u body=\"%s\"\n",
        msg_id, from, origin, hops, body);

    // Decode triage + store for display
    const TriageOutput triage_meta = decodeTriageFromPayload(body);
    last_rx_triage_ = triage_meta;
    strncpy(last_rx_body_, body ? body : "", sizeof(last_rx_body_) - 1);
    last_rx_body_[sizeof(last_rx_body_) - 1] = '\0';
    appendHistory('R', origin, msg_id, body, &triage_meta);

    if (triage_meta.is_vital) {
      Serial.printf("[AI] VITAL intent=%s urg=%u flags=%u\n",
          triage_meta.intent.c_str(), triage_meta.urgency, triage_meta.flags);
    }

    // ACK
    const uint16_t ack_origin = node_id_;
    markLocalMessageSeen(PacketType::kAck, ack_origin, msg_id);
    char ack_frame[kBufferSize];
    snprintf(ack_frame, sizeof(ack_frame), "A|%04X|%04X|%04X|%u|%u|%u",
        node_id_, ack_origin, origin, msg_id, kDefaultTtl, 0);
    enqueueFrame(ack_frame);
    return;
  }
  relayPacket(PacketType::kData, origin, dst, msg_id, ttl, hops, body);
}

/* ── ACK handler ── */
void LifeLinkLoRaNode::handleAck(
    uint16_t from, uint16_t origin, uint16_t dst,
    uint16_t msg_id, uint8_t ttl, uint8_t hops) {
  upsertMember(from, 0, 1, from);
  if (origin != node_id_) upsertMember(origin, 0);
  if (hasSeenAndRemember(PacketType::kAck, origin, msg_id)) return;
  if (dst == node_id_) {
    Serial.printf("[ACK] msg=%u confirmed by 0x%04X (hops=%u)\n", msg_id, origin, hops);
    ackPendingData(msg_id, origin);
    return;
  }
  relayPacket(PacketType::kAck, origin, dst, msg_id, ttl, hops, "");
}

/* ── Relay (flood) ── */
void LifeLinkLoRaNode::relayPacket(
    PacketType type, uint16_t origin, uint16_t dst,
    uint16_t msg_id, uint8_t ttl, uint8_t hops, const char* body) {
  if (ttl == 0) return;
  const uint8_t next_ttl = ttl - 1;
  const uint8_t next_hops = hops + 1;
  char frame[kBufferSize];
  if (type == PacketType::kData) {
    snprintf(frame, sizeof(frame), "D|%04X|%04X|%04X|%u|%u|%u|%s",
        node_id_, origin, dst, msg_id, next_ttl, next_hops, body);
  } else {
    snprintf(frame, sizeof(frame), "A|%04X|%04X|%04X|%u|%u|%u",
        node_id_, origin, dst, msg_id, next_ttl, next_hops);
  }
  enqueueFrame(frame);
}

/* ═══════════════════════════════════════════════════════
 *  Membership table
 * ═══════════════════════════════════════════════════════ */

void LifeLinkLoRaNode::upsertMember(uint16_t node_id, uint32_t heartbeat_seq,
                                     uint8_t hops_away, uint16_t via_node) {
  if (node_id == node_id_) return;
  const uint32_t now = millis();
  for (size_t i = 0; i < kMaxMembers; ++i) {
    if (members_[i].used && members_[i].node_id == node_id) {
      members_[i].last_seen_ms = now;
      if (heartbeat_seq != 0) members_[i].last_heartbeat_seq = heartbeat_seq;
      // Update hops/via if better path
      if (hops_away > 0 && hops_away < members_[i].hops_away) {
        members_[i].hops_away = hops_away;
        if (via_node != 0) members_[i].via_node = via_node;
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
      members_[i].hops_away = (hops_away > 0) ? hops_away : 1;
      members_[i].via_node = (via_node != 0) ? via_node : node_id;
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
    if (!members_[i].used) continue;
    if (now - members_[i].last_seen_ms <= kMembershipTimeoutMs)
      out_peers[count++] = members_[i].node_id;
  }
  return count;
}

bool LifeLinkLoRaNode::hasSeenAndRemember(PacketType type, uint16_t origin, uint16_t msg_id) {
  const uint32_t now = millis();
  for (size_t i = 0; i < kMaxSeen; ++i) {
    if (!seen_[i].used) continue;
    if (now - seen_[i].seen_at_ms > kMembershipTimeoutMs) { seen_[i].used = false; continue; }
    if (seen_[i].type == type && seen_[i].origin == origin && seen_[i].msg_id == msg_id) return true;
  }
  for (size_t i = 0; i < kMaxSeen; ++i) {
    if (!seen_[i].used) {
      seen_[i] = {type, origin, msg_id, now, true};
      return false;
    }
  }
  size_t oldest = 0;
  for (size_t i = 1; i < kMaxSeen; ++i) {
    if (seen_[i].seen_at_ms < seen_[oldest].seen_at_ms) oldest = i;
  }
  seen_[oldest] = {type, origin, msg_id, now, true};
  return false;
}

void LifeLinkLoRaNode::markLocalMessageSeen(PacketType type, uint16_t origin, uint16_t msg_id) {
  (void)hasSeenAndRemember(type, origin, msg_id);
}

void LifeLinkLoRaNode::addPendingData(uint16_t msg_id, uint16_t dst) {
  const uint32_t now = millis();
  for (size_t i = 0; i < kMaxPendingData; ++i) {
    if (!pending_data_[i].used) {
      pending_data_[i] = {msg_id, dst, now, false, true};
      return;
    }
  }
}

void LifeLinkLoRaNode::ackPendingData(uint16_t msg_id, uint16_t from) {
  for (size_t i = 0; i < kMaxPendingData; ++i) {
    if (!pending_data_[i].used || pending_data_[i].acked) continue;
    if (pending_data_[i].msg_id == msg_id) {
      pending_data_[i].acked = true;
      pending_data_[i].used = false;
      Serial.printf("[ACK-OK] msg=%u via 0x%04X\n", msg_id, from);
      return;
    }
  }
}

void LifeLinkLoRaNode::expirePendingData() {
  const uint32_t now = millis();
  for (size_t i = 0; i < kMaxPendingData; ++i) {
    if (!pending_data_[i].used || pending_data_[i].acked) continue;
    if (now - pending_data_[i].sent_at_ms > kAckTimeoutMs) {
      Serial.printf("[TIMEOUT] msg=%u to 0x%04X\n", pending_data_[i].msg_id, pending_data_[i].dst);
      pending_data_[i].used = false;
    }
  }
}

void LifeLinkLoRaNode::printMembership() const {
  const uint32_t now = millis();
  Serial.printf("[MESH] %u peers (leader=0x%04X ch=%u freq=%.1f):\n",
      activeMemberCount(), hop_leader_id_,
      static_cast<unsigned>(current_hop_channel_),
      kHopChannelsMhz[current_hop_channel_]);
  for (size_t i = 0; i < kMaxMembers; ++i) {
    if (!members_[i].used) continue;
    const uint32_t age = now - members_[i].last_seen_ms;
    if (age > kMembershipTimeoutMs) continue;
    Serial.printf("  0x%04X (%s) hops=%u via=0x%04X age=%lums seq=%lu\n",
        members_[i].node_id, members_[i].name,
        static_cast<unsigned>(members_[i].hops_away),
        members_[i].via_node,
        static_cast<unsigned long>(age),
        static_cast<unsigned long>(members_[i].last_heartbeat_seq));
  }
}
