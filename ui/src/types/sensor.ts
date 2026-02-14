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
