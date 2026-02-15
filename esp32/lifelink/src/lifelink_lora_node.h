#pragma once

#include <Arduino.h>
#include <RadioLib.h>

class LifeLinkLoRaNode {
 public:
  void begin();
  void tick();
  bool queueBleMessage(uint16_t dst, const char* text);
  void setNodeName(const char* name);
  uint16_t nodeId16() const { return static_cast<uint16_t>(node_id_ & 0xFFFF); }
  const char* nodeName() const { return node_name_; }
  uint16_t hopLeaderId() const { return hop_leader_id_; }
  uint32_t hopSeed() const { return hop_seed_; }
  uint32_t hopSeq() const { return last_hop_seq_; }
  uint8_t currentHopChannel() const { return current_hop_channel_; }

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

  static constexpr float kRfFrequencyMhz = 903.9f;
  static constexpr int kTxPowerDbm = 14;
  static constexpr float kBandwidthKhz = 125.0f;
  static constexpr int kSpreadingFactor = 7;
  static constexpr int kCodingRate = 5;
  static constexpr int kPreambleLength = 8;
  static constexpr int kSyncWord = 0x12;
  static constexpr unsigned long kRxTimeoutMs = 3000;
  static constexpr size_t kBufferSize = 128;
  static constexpr unsigned long kHeartbeatIntervalMs = 5000;
  static constexpr unsigned long kMembershipTimeoutMs = 30000;
  static constexpr unsigned long kTestDataIntervalMs = 9000;
  static constexpr unsigned long kAckTimeoutMs = 12000;
  static constexpr uint8_t kDefaultTtl = 4;
  static constexpr size_t kMaxMembers = 24;
  static constexpr size_t kMaxSeen = 64;
  static constexpr size_t kMaxTxQueue = 12;
  static constexpr size_t kMaxPendingData = 12;
  static constexpr size_t kHopChannelCount = 8;
  static constexpr unsigned long kHopIntervalMs = 5000;

  enum class PacketType : uint8_t {
    kHeartbeat = 1,
    kData = 2,
    kAck = 3,
  };

  struct MemberEntry {
    uint16_t node_id;
    uint32_t last_seen_ms;
    uint32_t last_heartbeat_seq;
    uint32_t hop_seed;
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

  bool enqueueFrame(const char* frame);
  bool dequeueFrame(char* out_payload);
  void parseAndHandlePacket(const char* packet);
  void handleHeartbeat(uint16_t from, uint32_t seq, uint32_t hop_seed, const char* name);
  void handleData(uint16_t from, uint16_t origin, uint16_t dst, uint16_t msg_id, uint8_t ttl, uint8_t hops, const char* body);
  void handleAck(uint16_t from, uint16_t origin, uint16_t dst, uint16_t msg_id, uint8_t ttl, uint8_t hops);
  void relayPacket(PacketType type, uint16_t origin, uint16_t dst, uint16_t msg_id, uint8_t ttl, uint8_t hops, const char* body);

  void upsertMember(uint16_t node_id, uint32_t heartbeat_seq);
  size_t collectActivePeers(uint16_t* out_peers, size_t max_out) const;
  bool hasSeenAndRemember(PacketType type, uint16_t origin, uint16_t msg_id);
  void markLocalMessageSeen(PacketType type, uint16_t origin, uint16_t msg_id);
  void addPendingData(uint16_t msg_id, uint16_t dst);
  void ackPendingData(uint16_t msg_id, uint16_t from);
  void expirePendingData();
  void printMembership() const;

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
  uint32_t next_test_data_at_ms_ = 0;
  uint32_t next_membership_print_at_ms_ = 0;

  MemberEntry members_[kMaxMembers] = {};
  SeenEntry seen_[kMaxSeen] = {};
  TxFrame tx_queue_[kMaxTxQueue] = {};
  PendingData pending_data_[kMaxPendingData] = {};
  size_t tx_q_head_ = 0;
  size_t tx_q_tail_ = 0;
  size_t tx_q_size_ = 0;
};

