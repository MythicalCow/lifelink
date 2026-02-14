import type { SensorNode, SuggestedNode } from "@/types/sensor";

/**
 * Stanford campus center for initial map view.
 */
export const MAP_CENTER: [number, number] = [37.4275, -122.1697];
export const MAP_ZOOM = 15;

/**
 * Sensor nodes placed across Stanford campus.
 * Coordinates are real lat/lng, radius is coverage in meters.
 */
export const SENSOR_NODES: SensorNode[] = [
  { id: 1, lat: 37.4275, lng: -122.1700, radius: 180, label: "Main Quad" },
  { id: 2, lat: 37.4265, lng: -122.1670, radius: 150, label: "Hoover Tower" },
  { id: 3, lat: 37.4300, lng: -122.1745, radius: 200, label: "Gates CS Building" },
  { id: 4, lat: 37.4260, lng: -122.1620, radius: 170, label: "The Oval" },
  { id: 5, lat: 37.4320, lng: -122.1710, radius: 160, label: "Cantor Arts Center" },
  { id: 6, lat: 37.4244, lng: -122.1710, radius: 190, label: "Tresidder Union" },
  { id: 7, lat: 37.4345, lng: -122.1610, radius: 210, label: "Stanford Stadium" },
  { id: 8, lat: 37.4235, lng: -122.1735, radius: 150, label: "Law School" },
  { id: 9, lat: 37.4255, lng: -122.1640, radius: 170, label: "GSB" },
  { id: 10, lat: 37.4315, lng: -122.1665, radius: 180, label: "Bing Concert Hall" },
  { id: 11, lat: 37.4285, lng: -122.1745, radius: 160, label: "Jen-Hsun Huang" },
  { id: 12, lat: 37.4225, lng: -122.1680, radius: 150, label: "Roble Hall" },
  { id: 13, lat: 37.4290, lng: -122.1670, radius: 170, label: "Science & Engineering Quad" },
  { id: 14, lat: 37.4240, lng: -122.1635, radius: 160, label: "Frost Amphitheater" },
  { id: 15, lat: 37.4365, lng: -122.1605, radius: 200, label: "Maples Pavilion" },
  { id: 16, lat: 37.4273, lng: -122.1700, radius: 140, label: "Memorial Church" },
  { id: 17, lat: 37.4230, lng: -122.1760, radius: 170, label: "Escondido Village" },
  { id: 18, lat: 37.4335, lng: -122.1740, radius: 180, label: "Medical Center" },
];

/**
 * Suggested placements to improve coverage in gaps.
 */
export const SUGGESTED_NODES: SuggestedNode[] = [
  { id: "s1", lat: 37.4210, lng: -122.1650, reason: "Gap — south of Roble Hall" },
  { id: "s2", lat: 37.4310, lng: -122.1600, reason: "Gap — east campus near athletics" },
  { id: "s3", lat: 37.4380, lng: -122.1700, reason: "Gap — north of Medical Center" },
  { id: "s4", lat: 37.4250, lng: -122.1780, reason: "Gap — west Escondido" },
  { id: "s5", lat: 37.4340, lng: -122.1670, reason: "Gap — between Bing & Cantor" },
];
