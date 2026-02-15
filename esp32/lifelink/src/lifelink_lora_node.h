#pragma once

#include <Arduino.h>
#include <RadioLib.h>
#include "ai_triage.h"

class LifeLinkLoRaNode {
 public:
  struct MessageHistoryEntry {
    char direction;
    uint16_t peer;
    uint16_t msg_id;
    bool vital;
    char intent[12];
    uint8_t urgency;
    char body[52];
  };

  struct MemberSnapshot {
    uint16_t node_id;
    uint32_t age_ms;
    uint32_t heartbeat_seq;
    uint32_t hop_seed;
    uint8_t hops_away;
    char name[24];
  };

  /* ── Gossip entry (piggybacked in heartbeats, matches sim) ── */
  struct GossipEntry {
    uint16_t node_id;
    uint32_t seq;
    uint8_t hops_away;
    char name[16];
  };

  void begin();
  void tick();
  bool queueBleMessage(uint16_t dst, const char* text);
  void setNodeName(const char* name);
  uint16_t activeMemberCount() const;
  bool getActiveMember(uint16_t idx, MemberSnapshot* out) const;
  uint16_t messageHistoryCount() const;
  bool getMessageHistory(uint16_t idx, MessageHistoryEntry* out) const;
  uint16_t nodeId16() const { return static_cast<uint16_t>(node_id_ & 0xFFFF); }
  const char* nodeName() const { return node_name_; }
  uint16_t hopLeaderId() const { return hop_leader_id_; }
  uint32_t hopSeed() const { return hop_seed_; }
  uint32_t hopSeq() const { return last_hop_seq_; }
  uint8_t currentHopChannel() const { return current_hop_channel_; }
  float lastRssi() const { return rx_rssi_; }
  float lastSnr() const { return rx_snr_; }
  uint32_t txCount() const { return tx_count_; }
  uint32_t rxCount() const { return rx_count_; }
  uint32_t errorCount() const { return error_count_; }
  const char* lastRxBody() const { return last_rx_body_; }
  const TriageOutput& lastRxTriage() const { return last_rx_triage_; }

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

  /* ── Hardware pin constants (Heltec WiFi LoRa 32 V3) ── */
  static constexpr int kLoraNssPin = 8;
  static constexpr int kLoraDio1Pin = 14;
  static constexpr int kLoraResetPin = 12;
  static constexpr int kLoraBusyPin = 13;
  static constexpr int kLoraSckPin = 9;
  static constexpr int kLoraMisoPin = 11;
  static constexpr int kLoraMosiPin = 10;

  /* ── LoRa radio config ── */
  static constexpr float kRfFrequencyMhz = 903.9f;
  static constexpr int kTxPowerDbm = 14;
  static constexpr float kBandwidthKhz = 125.0f;
  static constexpr int kSpreadingFactor = 7;
  static constexpr int kCodingRate = 5;
  static constexpr int kPreambleLength = 8;
  static constexpr int kSyncWord = 0x12;
  static constexpr unsigned long kRxTimeoutMs = 1500;

  /* ── Protocol constants (aligned with simulation) ── */
  static constexpr size_t kBufferSize = 220;         // increased for gossip
  static constexpr unsigned long kHeartbeatIntervalMs = 1500;
  static constexpr unsigned long kHeartbeatJitterMs = 1500;
  static constexpr unsigned long kMembershipTimeoutMs = 15000;
  static constexpr unsigned long kTestDataIntervalMs = 12000;
  static constexpr unsigned long kAckTimeoutMs = 12000;
  static constexpr uint8_t kDefaultTtl = 4;
  static constexpr size_t kMaxGossipEntries = 12;    // blast full membership in every heartbeat
  static constexpr size_t kMaxMembers = 24;
  static constexpr size_t kMaxSeen = 64;
  static constexpr size_t kMaxTxQueue = 12;
  static constexpr size_t kMaxPendingData = 12;
  static constexpr size_t kMaxMessageHistory = 64;
  static constexpr size_t kHopChannelCount = 2;
  static constexpr unsigned long kHopIntervalMs = 5000;
  static constexpr unsigned long kDiscoverySweepIntervalMs = 10000; // return to ch0 every 10s
  static constexpr unsigned long kDiscoverySweepDurationMs = 3000;  // stay on ch0 for 3s

  enum class PacketType : uint8_t {
    kHeartbeat = 1,
    kData = 2,
    kAck = 3,
  };

  /* ── Membership/Neighbor table (matches sim NeighborEntry) ── */
  struct MemberEntry {
    uint16_t node_id;
    uint32_t last_seen_ms;
    uint32_t last_heartbeat_seq;
    uint32_t hop_seed;
    uint8_t hops_away;          // 1 = direct, 2+ = learned via gossip
    uint16_t via_node;          // which direct neighbor told us about this
    char name[24];
    bool used;
  };

  struct SeenEntry {
    PacketType type;
    uint16_t origin;
    uint16_t msg_id;
    uint32_t seen_at_ms;
    bool used;
  };

  struct TxFrame {
    char payload[kBufferSize];
    bool used;
  };

  struct PendingData {
    uint16_t msg_id;
    uint16_t dst;
    uint32_t sent_at_ms;
    bool acked;
    bool used;
  };

  static LifeLinkLoRaNode* instance_;
  static volatile bool operation_done_;

  static void onDio1Rise();

  void printBanner() const;
  uint32_t resolveNodeId() const;
  void runSchedulers();
  void sendHeartbeat();
  void sendTestDataIfPossible();
  void maybeApplyFrequencyHop(uint32_t now_ms, bool force = false);
  uint16_t selectHopLeader() const;
  uint8_t computeHopChannelIndex(uint32_t seed, uint32_t seq) const;

  /* ── Gossip (epidemic protocol matching sim) ── */
  size_t buildGossipEntries(GossipEntry* out, size_t max_entries) const;
  void processGossipEntries(const GossipEntry* entries, size_t count, uint16_t via_node);

  bool enqueueFrame(const char* frame);
  bool dequeueFrame(char* out_payload);
  void parseAndHandlePacket(const char* packet);
  void handleHeartbeat(uint16_t from, uint32_t seq, uint32_t hop_seed, const char* name, uint8_t ttl, uint8_t hops, const char* gossip_str);
  void handleData(uint16_t from, uint16_t origin, uint16_t dst, uint16_t msg_id, uint8_t ttl, uint8_t hops, const char* body);
  void handleAck(uint16_t from, uint16_t origin, uint16_t dst, uint16_t msg_id, uint8_t ttl, uint8_t hops);
  void relayPacket(PacketType type, uint16_t origin, uint16_t dst, uint16_t msg_id, uint8_t ttl, uint8_t hops, const char* body);

  void upsertMember(uint16_t node_id, uint32_t heartbeat_seq, uint8_t hops_away = 1, uint16_t via_node = 0);
  size_t collectActivePeers(uint16_t* out_peers, size_t max_out) const;
  bool hasSeenAndRemember(PacketType type, uint16_t origin, uint16_t msg_id);
  void markLocalMessageSeen(PacketType type, uint16_t origin, uint16_t msg_id);
  void addPendingData(uint16_t msg_id, uint16_t dst);
  void ackPendingData(uint16_t msg_id, uint16_t from);
  void expirePendingData();
  void printMembership() const;
  void appendHistory(char direction, uint16_t peer, uint16_t msg_id, const char* body, const TriageOutput* triage);
  TriageOutput decodeTriageFromPayload(const char* body) const;

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
  uint32_t hop_seed_ = 0;
  uint8_t current_hop_channel_ = 0;
  uint32_t last_hop_seq_ = 0;
  uint16_t hop_leader_id_ = 0;
  char node_name_[24] = "Node";
  uint32_t heartbeat_seq_ = 0;
  uint16_t local_msg_seq_ = 0;
  uint32_t next_heartbeat_at_ms_ = 0;
  uint32_t next_hop_at_ms_ = 0;
  uint32_t next_discovery_sweep_at_ms_ = 0;
  uint32_t discovery_sweep_end_ms_ = 0;
  bool in_discovery_sweep_ = false;
  uint32_t next_test_data_at_ms_ = 0;
  uint32_t next_membership_print_at_ms_ = 0;

  /* ── Display data (latest received) ── */
  char last_rx_body_[52] = {};
  TriageOutput last_rx_triage_ = {};

  MemberEntry members_[kMaxMembers] = {};
  SeenEntry seen_[kMaxSeen] = {};
  TxFrame tx_queue_[kMaxTxQueue] = {};
  PendingData pending_data_[kMaxPendingData] = {};
  MessageHistoryEntry history_[kMaxMessageHistory] = {};
  uint16_t history_head_ = 0;
  uint16_t history_count_ = 0;
  size_t tx_q_head_ = 0;
  size_t tx_q_tail_ = 0;
  size_t tx_q_size_ = 0;
};
