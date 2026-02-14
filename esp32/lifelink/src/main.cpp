/**
 * LifeLink LoRa Node-to-Node Test
 * 
 * Board: Heltec WiFi LoRa 32 V3 (ESP32-S3 + SX1262)
 * Library: RadioLib (https://github.com/jgromes/RadioLib)
 * 
 * This firmware implements a simple ping-pong test between two nodes.
 * Flash the same code to both boards - they will automatically
 * alternate between sending and receiving.
 * 
 * Serial output shows:
 *   - Packets sent/received
 *   - RSSI (signal strength)
 *   - SNR (signal-to-noise ratio)
 */

#include <RadioLib.h>
#include <esp_mac.h>

// ═══════════════════════════════════════════════════════════════════
// Heltec WiFi LoRa 32 V3 Pin Definitions (SX1262)
// ═══════════════════════════════════════════════════════════════════

#define LORA_NSS    8
#define LORA_DIO1   14
#define LORA_RESET  12
#define LORA_BUSY   13

#define LORA_SCK    9
#define LORA_MISO   11
#define LORA_MOSI   10

// ═══════════════════════════════════════════════════════════════════
// LoRa Configuration - Must match on both nodes!
// ═══════════════════════════════════════════════════════════════════

#define RF_FREQUENCY          915.0     // MHz (US: 915.0, EU: 868.0)
#define TX_OUTPUT_POWER       14        // dBm (max 22 for SX1262)
#define LORA_BANDWIDTH        125.0     // kHz
#define LORA_SPREADING_FACTOR 7         // SF7-SF12 (higher = longer range, slower)
#define LORA_CODINGRATE       5         // 5=4/5, 6=4/6, 7=4/7, 8=4/8
#define LORA_PREAMBLE_LENGTH  8         // symbols
#define LORA_SYNC_WORD        0x12      // Private network sync word

#define RX_TIMEOUT_MS         3000      // ms
#define BUFFER_SIZE           64        // max packet size

// ═══════════════════════════════════════════════════════════════════
// State Machine
// ═══════════════════════════════════════════════════════════════════

typedef enum {
    STATE_IDLE,
    STATE_TX,
    STATE_RX,
    STATE_TX_DONE,
    STATE_RX_DONE,
    STATE_TX_TIMEOUT,
    STATE_RX_TIMEOUT,
    STATE_RX_ERROR
} NodeState_t;

// ═══════════════════════════════════════════════════════════════════
// Globals
// ═══════════════════════════════════════════════════════════════════

// Create SPI instance for LoRa
SPIClass loraSPI(HSPI);

// Create SX1262 instance
SX1262 radio = new Module(LORA_NSS, LORA_DIO1, LORA_RESET, LORA_BUSY, loraSPI);

static NodeState_t state = STATE_IDLE;

static char txPacket[BUFFER_SIZE];
static char rxPacket[BUFFER_SIZE];
static uint16_t rxSize = 0;
static float rxRssi = 0;
static float rxSnr = 0;

static uint32_t txCount = 0;
static uint32_t rxCount = 0;
static uint32_t errorCount = 0;

// Unique node ID (derived from chip ID)
static uint32_t nodeId = 0;

// Flag for interrupt-driven operation
volatile bool operationDone = false;

// ═══════════════════════════════════════════════════════════════════
// Interrupt Handler
// ═══════════════════════════════════════════════════════════════════

#if defined(ESP8266) || defined(ESP32)
  ICACHE_RAM_ATTR
#endif
void setFlag(void) {
    operationDone = true;
}

// ═══════════════════════════════════════════════════════════════════
// Setup
// ═══════════════════════════════════════════════════════════════════

void setup() {
    Serial.begin(115200);
    delay(1000);
    
    // Get unique node ID from hardware base MAC.
    // Using low 16 bits keeps logs compact while remaining unique for nearby test nodes.
    uint8_t mac[6] = {0};
    esp_err_t macErr = esp_read_mac(mac, ESP_MAC_WIFI_STA);
    if (macErr == ESP_OK) {
        nodeId = ((uint32_t)mac[4] << 8) | (uint32_t)mac[5];
    } else {
        // Fallback if MAC read fails for any reason.
        uint64_t chipId = ESP.getEfuseMac();
        nodeId = (uint32_t)(chipId & 0xFFFF);
    }
    
    Serial.println();
    Serial.println("╔════════════════════════════════════════════╗");
    Serial.println("║     LifeLink LoRa Node-to-Node Test        ║");
    Serial.println("╠════════════════════════════════════════════╣");
    Serial.printf( "║  Node ID:    0x%04X                        ║\n", nodeId);
    Serial.printf( "║  Frequency:  %.1f MHz                     ║\n", RF_FREQUENCY);
    Serial.printf( "║  TX Power:   %d dBm                        ║\n", TX_OUTPUT_POWER);
    Serial.printf( "║  SF:         %d                            ║\n", LORA_SPREADING_FACTOR);
    Serial.printf( "║  BW:         %.0f kHz                       ║\n", LORA_BANDWIDTH);
    Serial.println("╚════════════════════════════════════════════╝");
    Serial.println();
    
    // Initialize SPI for LoRa
    loraSPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_NSS);
    
    // Initialize SX1262
    Serial.print("[INIT] Initializing SX1262... ");
    int initState = radio.begin(
        RF_FREQUENCY,
        LORA_BANDWIDTH,
        LORA_SPREADING_FACTOR,
        LORA_CODINGRATE,
        LORA_SYNC_WORD,
        TX_OUTPUT_POWER,
        LORA_PREAMBLE_LENGTH
    );
    
    if (initState == RADIOLIB_ERR_NONE) {
        Serial.println("success!");
    } else {
        Serial.printf("failed, code %d\n", initState);
        Serial.println("Check your wiring and pin definitions!");
        while (true) {
            delay(1000);
        }
    }
    
    // Set up interrupt-driven operation
    radio.setDio1Action(setFlag);
    
    // Enable CRC
    radio.setCRC(true);
    
    Serial.println("[INIT] Radio initialized. Starting in RX mode...");
    Serial.println();
    
    // Start in RX mode, waiting for a packet
    state = STATE_RX;
}

// ═══════════════════════════════════════════════════════════════════
// Main Loop - State Machine
// ═══════════════════════════════════════════════════════════════════

void loop() {
    switch (state) {
        
        // ─────────────────────────────────────────────────────────────
        // IDLE - Should not stay here long
        // ─────────────────────────────────────────────────────────────
        case STATE_IDLE:
            // After a short delay, go to RX
            delay(100);
            state = STATE_RX;
            break;
        
        // ─────────────────────────────────────────────────────────────
        // TX - Send a packet
        // ─────────────────────────────────────────────────────────────
        case STATE_TX: {
            txCount++;
            snprintf(txPacket, BUFFER_SIZE, 
                     "PING from 0x%04X #%lu RSSI:%.0f", 
                     nodeId, txCount, rxRssi);
            
            Serial.printf("[TX] Sending: \"%s\" (%d bytes)\n", 
                          txPacket, strlen(txPacket));
            
            operationDone = false;
            int txState = radio.startTransmit(txPacket);
            
            if (txState != RADIOLIB_ERR_NONE) {
                Serial.printf("[TX] Failed to start TX, code %d\n", txState);
                errorCount++;
                state = STATE_IDLE;
            } else {
                // Wait for TX to complete
                unsigned long startTime = millis();
                while (!operationDone && (millis() - startTime < 3000)) {
                    yield();
                }
                
                if (operationDone) {
                    state = STATE_TX_DONE;
                } else {
                    state = STATE_TX_TIMEOUT;
                }
            }
            break;
        }
        
        // ─────────────────────────────────────────────────────────────
        // RX - Enter receive mode
        // ─────────────────────────────────────────────────────────────
        case STATE_RX: {
            Serial.println("[RX] Listening...");
            
            operationDone = false;
            int rxState = radio.startReceive();
            
            if (rxState != RADIOLIB_ERR_NONE) {
                Serial.printf("[RX] Failed to start RX, code %d\n", rxState);
                errorCount++;
                state = STATE_IDLE;
            } else {
                // Wait for RX or timeout
                unsigned long startTime = millis();
                while (!operationDone && (millis() - startTime < RX_TIMEOUT_MS)) {
                    yield();
                }
                
                if (operationDone) {
                    // Read the received data
                    rxSize = radio.getPacketLength();
                    if (rxSize > BUFFER_SIZE - 1) {
                        rxSize = BUFFER_SIZE - 1;
                    }
                    
                    int readState = radio.readData((uint8_t*)rxPacket, rxSize);
                    rxPacket[rxSize] = '\0';
                    
                    if (readState == RADIOLIB_ERR_NONE) {
                        rxRssi = radio.getRSSI();
                        rxSnr = radio.getSNR();
                        state = STATE_RX_DONE;
                    } else if (readState == RADIOLIB_ERR_CRC_MISMATCH) {
                        state = STATE_RX_ERROR;
                    } else {
                        Serial.printf("[RX] Read error, code %d\n", readState);
                        state = STATE_RX_ERROR;
                    }
                } else {
                    state = STATE_RX_TIMEOUT;
                }
            }
            break;
        }
        
        // ─────────────────────────────────────────────────────────────
        // TX_DONE - Packet sent successfully
        // ─────────────────────────────────────────────────────────────
        case STATE_TX_DONE:
            radio.finishTransmit();
            Serial.println("[TX] ✓ Sent successfully");
            Serial.println();
            
            // Go back to RX mode to wait for response
            state = STATE_RX;
            break;
        
        // ─────────────────────────────────────────────────────────────
        // RX_DONE - Packet received
        // ─────────────────────────────────────────────────────────────
        case STATE_RX_DONE:
            rxCount++;
            radio.standby();
            
            Serial.println("┌────────────────────────────────────────────┐");
            Serial.printf( "│ [RX] Packet #%lu received                   \n", rxCount);
            Serial.printf( "│  Payload: \"%s\"\n", rxPacket);
            Serial.printf( "│  Size:    %d bytes\n", rxSize);
            Serial.printf( "│  RSSI:    %.1f dBm\n", rxRssi);
            Serial.printf( "│  SNR:     %.1f dB\n", rxSnr);
            Serial.println("└────────────────────────────────────────────┘");
            Serial.println();
            
            // Wait a bit, then send a response
            delay(500 + (nodeId % 500));  // Jitter based on node ID
            state = STATE_TX;
            break;
        
        // ─────────────────────────────────────────────────────────────
        // TX_TIMEOUT - TX took too long
        // ─────────────────────────────────────────────────────────────
        case STATE_TX_TIMEOUT:
            errorCount++;
            Serial.printf("[TX] ✗ Timeout! (errors: %lu)\n", errorCount);
            radio.standby();
            delay(1000);
            state = STATE_RX;
            break;
        
        // ─────────────────────────────────────────────────────────────
        // RX_TIMEOUT - No packet received in time
        // ─────────────────────────────────────────────────────────────
        case STATE_RX_TIMEOUT:
            Serial.println("[RX] Timeout - no packet received");
            radio.standby();
            
            // If we haven't received anything yet, send a PING to start
            if (rxCount == 0) {
                Serial.println("[RX] No peers found. Sending initial PING...");
                delay(1000 + (nodeId % 2000));  // Random delay to avoid collision
                state = STATE_TX;
            } else {
                // Otherwise, keep listening
                state = STATE_RX;
            }
            break;
        
        // ─────────────────────────────────────────────────────────────
        // RX_ERROR - CRC error or other issue
        // ─────────────────────────────────────────────────────────────
        case STATE_RX_ERROR:
            errorCount++;
            Serial.printf("[RX] ✗ Error (CRC fail?) - errors: %lu\n", errorCount);
            radio.standby();
            state = STATE_RX;
            break;
    }
}
