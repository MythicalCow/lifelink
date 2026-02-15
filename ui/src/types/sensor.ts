export interface SensorNode {
  /** Unique identifier for this sensor node */
  id: number;
  /** Latitude (WGS84) */
  lat: number;
  /** Longitude (WGS84) */
  lng: number;
  /** Coverage radius in meters */
  radius?: number;
  /** Optional label for the node */
  label?: string;
  /** Whether this node is currently active */
  active?: boolean;
  /** Whether this node is a GPS anchor (known position) */
  isAnchor?: boolean;
  /** Hardware LoRa node ID as uppercase hex (e.g. "E504") */
  hardwareIdHex?: string;
  /** BLE address used during setup/connect */
  bleAddress?: string;
}

export interface SuggestedNode {
  /** Unique identifier */
  id: string;
  /** Latitude (WGS84) */
  lat: number;
  /** Longitude (WGS84) */
  lng: number;
  /** Why this placement is suggested */
  reason: string;
}
