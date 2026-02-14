<div align="center">

# LifeLink

**Decentralized emergency communication for civilians when infrastructure fails.**

`LoRa mesh` · `zero-config deployment` · `jam-resilient` · `~$5/node at scale`

---

</div>

## The Problem

When internet is cut, cell towers are down, and Wi-Fi is blocked, civilians lose the ability to do three critical things: **ask for help**, **share safety information**, and **avoid dangerous areas**. Existing communication infrastructure is centralized and fragile by design. There are no options for a normal person caught in a blackout zone.

LifeLink fixes that. We give civilians their own infrastructure.

## What It Is

LifeLink is a decentralized mesh communication network built on cheap LoRa hardware. Any citizen can deploy a node by pressing a single button. It auto-joins the mesh, requires no technical knowledge, and works entirely offline. Users connect to the nearest node over Bluetooth with a phone app and send messages that the mesh relays across the network.

**Citizens create the infrastructure. No towers. No ISPs. No permission.**

## Architecture

```
┌──────────┐  Bluetooth   ┌──────────┐  LoRa 915MHz  ┌──────────┐  LoRa  ┌──────────┐
│  Phone   │◄────────────►│  Node A  │◄──────────────►│  Node B  │◄──────►│  Node C  │
│  (App)   │              │  ESP32   │                │  ESP32   │        │  ESP32   │
└──────────┘              └──────────┘                └──────────┘        └──────────┘
                                                            ▲
                                                            │ LoRa
                                                            ▼
                                                      ┌──────────┐
                                                      │  Node D  │
                                                      │  ESP32   │
                                                      └──────────┘

                          ┌─────────────────────────────────────┐
                          │  Coordination Dashboard (optional)  │
                          │  Laptop — listen-only, no control   │
                          │  Node map · Interference heatmap    │
                          └─────────────────────────────────────┘
```

Each node runs a gossip-based mesh protocol with heartbeats, neighbor discovery, multi-hop routing, and packet deduplication — designed to map 1:1 to C structs on the ESP32.

## Core Features

### Intelligent Message Compression

LoRa airtime is scarce. If every message is treated equally the network clogs and urgent messages die in the noise. A tiny on-node model trained on crisis language detects whether a message contains safety-critical information (medical, danger, evacuation, water, time-critical cues). Recognized messages are converted into compact structured packets the mesh can prioritize, deduplicate, and verify.

```
Input:   "Need a medic for 2 injured people near the bridge ASAP!"
Output:   MEDIC|U3|F0|N2|Lbridge
```

| Benefit | How |
|---|---|
| **Priority** | `U3` messages get more retransmits and longer TTL |
| **Reliability** | Structured packets are easier to deduplicate and confirm |
| **Speed** | Nodes route emergency traffic preferentially |
| **Bandwidth** | No long chat strings flooding the mesh |

Unrecognized messages are still forwarded as plain text — they just don't consume the same network budget as verified urgent alerts.

### Decentralized Trust System

In a crisis, misinformation spreads fast. LifeLink handles this without any central authority:

- Nodes track **sender reputation** based on whether past alerts are corroborated
- "Verified" alerts require **k-of-n confirmations** from independent devices in the same area and time window
- Low-trust senders cannot cause network-wide floods
- **Trust emerges from independent confirmation**, not central moderation

### Jamming Detection & Adaptive Channels

In contested environments, radio jamming is real. LifeLink responds at two levels:

- **Detection** — Nodes continuously monitor link health (delivery success rate, RSSI/SNR trends). Abnormal loss patterns in a region are flagged as likely interference.
- **Mitigation** — Nodes adapt via frequency hopping and adaptive channel selection. If part of the band degrades, the mesh shifts traffic away automatically.
- **Alerts** — The system pushes safety messages: *"High interference reported near Market St — route around."*

> LifeLink's design goal is not "jam-proof." It's **jam-resilient at civilian scale**, where the cost to suppress the network is orders of magnitude higher than the cost to deploy it. Signal jammers are expensive and power-hungry; blanketing a city-scale mesh is neither cheap nor quiet.

### Optional Coordination Dashboard

A laptop running the LifeLink dashboard can be operated by volunteers or first responders. It **does not control the network** — it only listens and visualizes:

- Node density and mesh connectivity
- Approximate node locations (for placement of new nodes to bridge gaps)
- Hotspots: high message volume, interference zones, verified alerts

If the laptop goes down, the mesh keeps working.

## Project Structure

```
lifelink/
├── esp32/              # Firmware & drivers for Heltec ESP32 LoRa nodes
│   └── drivers/        # Heltec_ESP32 library (LoRa, LoRaWAN, OLED, sensors)
├── ui/                 # Coordination dashboard & mesh simulator
│   └── src/
│       ├── app/            # Next.js app (layout, pages, styles)
│       ├── components/     # Map, messenger, controls, header
│       ├── simulation/     # Mesh protocol simulator (types, config, nodes)
│       ├── hooks/          # React hooks (simulation state)
│       └── config/         # Node configuration
└── README.md
```

## Hardware

### Bill of Materials

| Component | Purpose | Cost |
|---|---|---|
| ESP32 LoRa Kit (Heltec) | MCU + LoRa radio + battery holder + antenna | $35.00 |
| Solar Panel | Passive power | $16.89 |
| Charge Controller | Bridges solar panel, LiPo, and ESP32 | $6.49 |
| USB LiPo Charger | Backup charging | $9.99 |
| 2mm JST Connectors | Charge controller interface | $9.99 |
| 1.25mm JST Connectors | ESP32 battery interface | $6.99 |

**Prototype cost: ~$40/node** — at scale the core BOM drops toward **~$5/node**.

That cost asymmetry is the point. To suppress a network like this, an adversary must spend orders of magnitude more to jam large areas consistently.

### Assembly

1. **Battery to controller** — Solder a 1.25mm JST female pigtail to a 2mm JST male pigtail. Connect the LiPo battery to the charge controller's battery terminal.
2. **ESP32 to controller** — Solder a 1.25mm JST male pigtail to a 2mm JST male pigtail. Connect the ESP32 battery input to the charge controller's SYS terminal.
3. **Solar to controller** — Solder a 2mm JST male pigtail to the solar panel leads. Connect to the charge controller's SOLAR terminal.
4. **Enclose** — Place all components into the chassis. Tape exposed solder joints.

Power on. The node auto-joins the mesh. Done.

## Dashboard Development

The coordination dashboard is built with Next.js 16, React 19, Leaflet, and Tailwind CSS. It includes a real-time mesh simulator that models the LoRa protocol with realistic parameters (radio range, capture effect, beacon intervals, gossip propagation, packet deduplication).

```bash
cd ui
npm install
npm run dev
```

### Simulation Parameters

| Parameter | Value | Real-World Mapping |
|---|---|---|
| Radio range | 450 m | LoRa on campus with buildings |
| Capture threshold | 6 dB | Strongest packet wins if above delta |
| Beacon interval | ~4 sec | Heartbeat + gossip propagation |
| Max TTL | 12 hops | Network diameter limit |
| Neighbor expiry | ~20 sec | Stale route cleanup |

## Demo

The live demo showcases:

- **One-button node setup** — power on, auto-mesh
- **Phone-to-node messaging** — Bluetooth connection, type and send
- **Automatic compression** — crisis language detection into structured packets
- **Prioritized emergency propagation** — urgent messages get preferential routing
- **Trust-based verification** — k-of-n confirmation from independent nodes
- **Interference detection** — RSSI/SNR monitoring with adaptive channel switching
- **Live dashboard** — real-time mesh state, node map, and alert visualization

## License

[MIT](LICENSE) — Raghav Tirumale, 2026
