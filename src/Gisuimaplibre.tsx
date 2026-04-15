'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

type Attribute = { field: string; value: string };
type Pole = { id: string; lat: number; lon: number; attributes: Attribute[] };
type ActiveTab = 'Details' | 'Layers';
type ExpandedGroups = { Segment: boolean; 'Distribution Structure': boolean; Equipment: boolean };
type ActiveTool = 'Locate' | 'Select' | 'Draw' | 'Measure' | 'Clear' | 'Plugins' | null;
type DrawGeometry = 'point' | 'line' | 'polygon';
type BottomRow = {
  key: string;
  id: string;
  type: string;
  status: string;
  owner: string;
  material: string;
  height: string;
  municipality: string;
  designId: string;
  onClick?: () => void;
  selected?: boolean;
};

// ─── Replace with your real Google Map Tiles API URLs ───────────────────────
const GOOGLE_ROAD_TILES_URL = '';
const GOOGLE_SAT_TILES_URL = '';
const OSM_TILES = ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'];
const OSM_ATTR = '© OpenStreetMap contributors';

// Default center — Quezon City, Philippines
const DEFAULT_CENTER: [number, number] = [121.1866, 14.5943];
const DEFAULT_ZOOM = 15;

function makeRasterStyle(
  tiles: string[],
  src: string,
  attr: string,
  night = false
): maplibregl.StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      [src]: {
        type: 'raster',
        tiles,
        tileSize: 256,
        attribution: attr,
        maxzoom: 22,
      },
    },
    layers: [
      {
        id: `${src}-tiles`,
        type: 'raster',
        source: src,
        minzoom: 0,
        maxzoom: 24,
        paint: night
          ? {
              'raster-brightness-max': 0.42,
              'raster-saturation': -0.9,
              'raster-contrast': 0.28,
            }
          : {},
      },
    ],
  };
}

function getBaseMapStyle(baseMap: string, isNight: boolean): maplibregl.StyleSpecification {
  if (baseMap === 'Google') {
    const t = GOOGLE_ROAD_TILES_URL ? [GOOGLE_ROAD_TILES_URL] : OSM_TILES;
    return makeRasterStyle(t, 'basemap', GOOGLE_ROAD_TILES_URL ? 'Google' : OSM_ATTR, isNight);
  }
  if (baseMap === 'Google Satellite') {
    const t = GOOGLE_SAT_TILES_URL ? [GOOGLE_SAT_TILES_URL] : OSM_TILES;
    return makeRasterStyle(t, 'basemap', GOOGLE_SAT_TILES_URL ? 'Google' : OSM_ATTR, isNight);
  }
  return makeRasterStyle(OSM_TILES, 'basemap', OSM_ATTR, isNight);
}

const PLUGINS = [
  { id: 'minimap', label: 'Mini Map', desc: 'Live overview minimap' },
  { id: 'heatmap', label: 'Heatmap', desc: 'Density heatmap on poles' },
  { id: 'export', label: 'Export PNG', desc: 'Download map as PNG' },
  { id: 'fullscreen', label: 'Fullscreen', desc: 'Toggle fullscreen mode' },
  { id: 'geoloc', label: 'Geolocate Me', desc: 'Fly to your GPS location' },
  { id: 'grid', label: 'Grid Overlay', desc: 'Lat/lon grid overlay' },
  { id: 'nightmode', label: 'Night Mode', desc: 'Dark desaturated map' },
  { id: 'cluster', label: 'Cluster Poles', desc: 'Group nearby poles' },
];

function haversineKm(la1: number, lo1: number, la2: number, lo2: number) {
  const R = 6371;
  const dLa = ((la2 - la1) * Math.PI) / 180;
  const dLo = ((lo2 - lo1) * Math.PI) / 180;
  const a =
    Math.sin(dLa / 2) ** 2 +
    Math.cos((la1 * Math.PI) / 180) *
      Math.cos((la2 * Math.PI) / 180) *
      Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Sample poles — [lon, lat] for MapLibre
const POLES: Pole[] = [
  {
    id: 'PL-00231',
    lat: 14.5943,
    lon: 121.1866,
    attributes: [
      { field: 'asset_id', value: 'PL-00231' },
      { field: 'feature_type', value: 'Pole' },
      { field: 'status', value: 'Active' },
      { field: 'owner', value: 'Utility Network' },
      { field: 'material', value: 'Concrete' },
      { field: 'height_m', value: '10.5' },
      { field: 'municipality', value: 'Quezon City' },
      { field: 'design_id', value: 'DSN-1045' },
    ],
  },
  {
    id: 'PL-00232',
    lat: 14.5951,
    lon: 121.1882,
    attributes: [
      { field: 'asset_id', value: 'PL-00232' },
      { field: 'feature_type', value: 'Pole' },
      { field: 'status', value: 'Active' },
      { field: 'owner', value: 'City Grid' },
      { field: 'material', value: 'Steel' },
      { field: 'height_m', value: '11.0' },
      { field: 'municipality', value: 'Quezon City' },
      { field: 'design_id', value: 'DSN-1046' },
    ],
  },
  {
    id: 'PL-00233',
    lat: 14.5928,
    lon: 121.1848,
    attributes: [
      { field: 'asset_id', value: 'PL-00233' },
      { field: 'feature_type', value: 'Pole' },
      { field: 'status', value: 'Proposed' },
      { field: 'owner', value: 'Utility Network' },
      { field: 'material', value: 'Concrete' },
      { field: 'height_m', value: '9.8' },
      { field: 'municipality', value: 'Quezon City' },
      { field: 'design_id', value: 'DSN-1047' },
    ],
  },
  {
    id: 'PL-00234',
    lat: 14.5964,
    lon: 121.1854,
    attributes: [
      { field: 'asset_id', value: 'PL-00234' },
      { field: 'feature_type', value: 'Pole' },
      { field: 'status', value: 'Inactive' },
      { field: 'owner', value: 'North Utility' },
      { field: 'material', value: 'Wood' },
      { field: 'height_m', value: '8.9' },
      { field: 'municipality', value: 'Quezon City' },
      { field: 'design_id', value: 'DSN-1048' },
    ],
  },
  {
    id: 'PL-00235',
    lat: 14.5936,
    lon: 121.1902,
    attributes: [
      { field: 'asset_id', value: 'PL-00235' },
      { field: 'feature_type', value: 'Pole' },
      { field: 'status', value: 'Active' },
      { field: 'owner', value: 'Metro Utility' },
      { field: 'material', value: 'Steel' },
      { field: 'height_m', value: '12.1' },
      { field: 'municipality', value: 'Quezon City' },
      { field: 'design_id', value: 'DSN-1049' },
    ],
  },
];

function buildGrid() {
  const features: any[] = [];
  for (let la = -80; la <= 80; la += 5) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[-180, la], [180, la]] },
      properties: {},
    });
  }
  for (let lo = -180; lo <= 180; lo += 5) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[lo, -80], [lo, 80]] },
      properties: {},
    });
  }
  return { type: 'FeatureCollection' as const, features };
}

// ── Rounded icon system ─────────────────────────────────────────────────────
const ToolShell = ({
  active,
  children,
}: {
  active?: boolean;
  children: React.ReactNode;
}) => (
  <div
    className={`flex h-full w-full items-center justify-center rounded-[14px] transition-all ${
      active ? 'bg-[#111] text-[#e0e0e0] shadow-[0_6px_18px_rgba(0,0,0,0.22)]' : 'bg-transparent text-[#111]'
    }`}
  >
    {children}
  </div>
);

const IconHomePin = ({ active }: { active?: boolean }) => (
  <ToolShell active={active}>
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 21C12 21 18 15.4 18 10.2C18 6.78 15.31 4 12 4C8.69 4 6 6.78 6 10.2C6 15.4 12 21 12 21Z"
        stroke={active ? '#e0e0e0' : '#111'}
        strokeWidth="1.8"
      />
      <circle cx="12" cy="10" r="2.4" fill={active ? '#e0e0e0' : '#111'} />
    </svg>
  </ToolShell>
);

const IconSelect = ({ active }: { active?: boolean }) => (
  <ToolShell active={active}>
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
      <path
        d="M6 5H10M14 5H18M19 6V10M19 14V18M18 19H14M10 19H6M5 18V14M5 10V6"
        stroke={active ? '#e0e0e0' : '#111'}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <rect
        x="8.2"
        y="8.2"
        width="7.6"
        height="7.6"
        rx="1.4"
        fill={active ? '#e0e0e0' : '#111'}
        opacity="0.9"
      />
    </svg>
  </ToolShell>
);

const IconDraw = ({ active }: { active?: boolean }) => (
  <ToolShell active={active}>
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
      <path
        d="M5 18L17.7 5.3C18.09 4.91 18.72 4.91 19.11 5.3L20.7 6.89C21.09 7.28 21.09 7.91 20.7 8.3L8 21H5V18Z"
        stroke={active ? '#e0e0e0' : '#111'}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M14.5 8.5L17.5 11.5" stroke={active ? '#e0e0e0' : '#111'} strokeWidth="1.7" />
    </svg>
  </ToolShell>
);

const IconMeasure = ({ active }: { active?: boolean }) => (
  <ToolShell active={active}>
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
      <rect
        x="5"
        y="8"
        width="14"
        height="8"
        rx="2"
        stroke={active ? '#e0e0e0' : '#111'}
        strokeWidth="1.8"
      />
      <path
        d="M8 10V12M11 10V11.4M14 10V12M17 10V11.4"
        stroke={active ? '#e0e0e0' : '#111'}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  </ToolShell>
);

const IconClear = ({ active }: { active?: boolean }) => (
  <ToolShell active={active}>
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" stroke={active ? '#e0e0e0' : '#e11d48'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  </ToolShell>
);

const IconPlugins = ({ active }: { active?: boolean }) => (
  <ToolShell active={active}>
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
      <path
        d="M9.2 7.5C9.2 6.12 10.32 5 11.7 5C13.08 5 14.2 6.12 14.2 7.5V8.1H16.6C18.15 8.1 19.4 9.35 19.4 10.9C19.4 12.45 18.15 13.7 16.6 13.7H15.8V16.5C15.8 17.88 14.68 19 13.3 19C11.92 19 10.8 17.88 10.8 16.5V13.7H8C6.45 13.7 5.2 12.45 5.2 10.9C5.2 9.35 6.45 8.1 8 8.1H9.2V7.5Z"
        stroke={active ? '#e0e0e0' : '#111'}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  </ToolShell>
);

const IconPoint = ({ active }: { active: boolean }) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
    <circle cx="12" cy="12" r="7.4" fill={active ? '#e0e0e0' : '#111'} />
    <circle cx="12" cy="12" r="3.4" fill={active ? '#111' : '#e0e0e0'} />
  </svg>
);

const IconLine = ({ active }: { active: boolean }) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
    <circle cx="5" cy="19" r="2.8" fill={active ? '#e0e0e0' : '#111'} />
    <circle cx="19" cy="5" r="2.8" fill={active ? '#e0e0e0' : '#111'} />
    <path
      d="M6.8 17.2L17.2 6.8"
      stroke={active ? '#e0e0e0' : '#111'}
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

const IconPolygon = ({ active }: { active: boolean }) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
    <polygon
      points="12,3 21,18.5 3,18.5"
      fill={active ? 'rgba(255,255,255,0.18)' : 'rgba(17,17,17,0.08)'}
      stroke={active ? '#e0e0e0' : '#111'}
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="3" r="2" fill={active ? '#e0e0e0' : '#111'} />
    <circle cx="21" cy="18.5" r="2" fill={active ? '#e0e0e0' : '#111'} />
    <circle cx="3" cy="18.5" r="2" fill={active ? '#e0e0e0' : '#111'} />
  </svg>
);

export default function GISUiMapLibre() {
  // ── Refs ──────────────────────────────────────────────────────────────────
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapReadyRef = useRef(false);
  const openPoleRef = useRef<(p: Pole) => void>(() => {});
  const minimapContainerRef = useRef<HTMLDivElement | null>(null);
  const minimapRef = useRef<maplibregl.Map | null>(null);
  const drawPtsRef = useRef<[number, number][]>([]);
  const rulerPtsRef = useRef<[number, number][]>([]);
  const rulerMarkersRef = useRef<maplibregl.Marker[]>([]);
  const rulerPopupRef = useRef<maplibregl.Popup | null>(null);
  const activeToolRef = useRef<ActiveTool>(null);
  const drawGeomRef = useRef<DrawGeometry>('point');
  const initializedRef = useRef(false);
  const minimapBoxMarkerRef = useRef<maplibregl.Marker | null>(null);

  const poleClickHandlerRef = useRef<((e: maplibregl.MapLayerMouseEvent) => void) | null>(null);
  const poleMouseEnterRef = useRef<(() => void) | null>(null);
  const poleMouseLeaveRef = useRef<(() => void) | null>(null);
  const clusterClickHandlerRef = useRef<((e: maplibregl.MapLayerMouseEvent) => void) | null>(null);
  const unclusterClickHandlerRef = useRef<((e: maplibregl.MapLayerMouseEvent) => void) | null>(null);

  // ── State ─────────────────────────────────────────────────────────────────
  const [isMobile, setIsMobile] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(DEFAULT_ZOOM);
  const [latLon, setLatLon] = useState({ lat: DEFAULT_CENTER[1], lon: DEFAULT_CENTER[0] });
  const [compassAngle, setCompassAngle] = useState(0);
  const [selectedBaseMap, setSelectedBaseMap] = useState('OSM');
  const [showBaseMapDrop, setShowBaseMapDrop] = useState(false);
  const [activeTool, setActiveTool] = useState<ActiveTool>(null);
  const [showTopMenu, setShowTopMenu] = useState(false);
  const [activePlugins, setActivePlugins] = useState<Record<string, boolean>>({});
  const [showDrawPopup, setShowDrawPopup] = useState(false);
  const [drawGeometry, setDrawGeometry] = useState<DrawGeometry>('point');
  const [showOC, setShowOC] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<ExpandedGroups>({
    Segment: false,
    'Distribution Structure': false,
    Equipment: false,
  });
  const [selectedObjectItem, setSelectedObjectItem] = useState('');
  const [activeTab, setActiveTab] = useState<ActiveTab>('Details');
  const [isEditing, setIsEditing] = useState(false);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [draftAttributes, setDraftAttributes] = useState<Attribute[]>([]);
  const [showSaveMenu, setShowSaveMenu] = useState(false);
  const [showBottomPanel, setShowBottomPanel] = useState(false);
  const [tableFilterMode, setTableFilterMode] = useState('By ID');
  const [tableFilterInput, setTableFilterInput] = useState('');
  const [appliedFilter, setAppliedFilter] = useState('');
  const [drawCount, setDrawCount] = useState(0);
  const [measureTotal, setMeasureTotal] = useState<number | null>(null);
  const [drawFinished, setDrawFinished] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({
    Pole: true,
    Substation: true,
    Cabinate: true,
    Cable: true,
  });

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  useEffect(() => {
    drawGeomRef.current = drawGeometry;
  }, [drawGeometry]);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const getPoleValue = useCallback((pole: Pole, field: string) => {
    return pole.attributes.find((a) => a.field === field)?.value || '';
  }, []);

  const openPole = useCallback((pole: Pole) => {
    setSelectedObjectItem('Pole');
    setSelectedObjectId(pole.id);
    setAttributes(pole.attributes.map((i) => ({ ...i })));
    setDraftAttributes(pole.attributes.map((i) => ({ ...i })));
    setIsEditing(false);
    setShowSaveMenu(false);
    if (window.innerWidth < 640) setShowOC(false);
  }, []);
  useEffect(() => {
    openPoleRef.current = openPole;
  }, [openPole]);

  const updateMinimapViewport = useCallback(() => {
    const map = mapRef.current;
    const mm = minimapRef.current;
    if (!map || !mm) return;

    const center = map.getCenter();
    mm.jumpTo({ center, zoom: Math.max(0, map.getZoom() - 4), bearing: 0, pitch: 0 });

    const box = document.createElement('div');
    box.style.width = '26px';
    box.style.height = '18px';
    box.style.border = '2px solid #111';
    box.style.borderRadius = '5px';
    box.style.background = 'rgba(255,255,255,0.18)';
    box.style.boxShadow = '0 1px 4px rgba(0,0,0,0.25)';

    if (minimapBoxMarkerRef.current) minimapBoxMarkerRef.current.remove();
    minimapBoxMarkerRef.current = new maplibregl.Marker({
      element: box,
      anchor: 'center',
    })
      .setLngLat(center)
      .addTo(mm);
  }, []);

  const removeLayerHandlers = useCallback((map: maplibregl.Map) => {
    try {
      if (poleClickHandlerRef.current) map.off('click', 'poles-hit', poleClickHandlerRef.current);
    } catch {}
    try {
      if (poleMouseEnterRef.current) map.off('mouseenter', 'poles-hit', poleMouseEnterRef.current);
    } catch {}
    try {
      if (poleMouseLeaveRef.current) map.off('mouseleave', 'poles-hit', poleMouseLeaveRef.current);
    } catch {}
    try {
      if (clusterClickHandlerRef.current) map.off('click', 'cluster-circles', clusterClickHandlerRef.current);
    } catch {}
    try {
      if (unclusterClickHandlerRef.current) map.off('click', 'cluster-unclustered', unclusterClickHandlerRef.current);
    } catch {}
  }, []);

  const addPoleMarkers = useCallback(
    (map: maplibregl.Map) => {
      const sourceId = 'poles-src';
      const layerId = 'poles-layer';
      const hitId = 'poles-hit';

      removeLayerHandlers(map);

      if (map.getLayer(hitId)) map.removeLayer(hitId);
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);

      map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: POLES.map((p) => ({
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
            properties: { id: p.id },
          })),
        },
      });

      map.addLayer({
        id: layerId,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 18, 10],
          'circle-color': '#111111',
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 1,
        },
      });

      map.addLayer({
        id: hitId,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 14, 18, 22],
          'circle-color': 'rgba(0,0,0,0)',
          'circle-opacity': 0,
        },
      });

      poleMouseEnterRef.current = () => {
        if (activeToolRef.current === 'Select') {
          map.getCanvas().style.cursor = 'pointer';
        }
      };

      poleMouseLeaveRef.current = () => {
        const tool = activeToolRef.current;
        map.getCanvas().style.cursor = tool
          ? tool === 'Locate'
            ? 'crosshair'
            : tool === 'Select'
              ? 'pointer'
              : tool === 'Draw'
                ? 'crosshair'
                : tool === 'Measure'
                  ? 'crosshair'
                  : 'default'
          : 'default';
      };

      poleClickHandlerRef.current = (e: maplibregl.MapLayerMouseEvent) => {
        if (activeToolRef.current !== 'Select') return;
        e.preventDefault();
        const feat = e.features?.[0];
        if (!feat) return;
        const pid = feat.properties?.id as string;
        const pole = POLES.find((p) => p.id === pid);
        if (pole) openPoleRef.current(pole);
      };

      map.on('mouseenter', hitId, poleMouseEnterRef.current);
      map.on('mouseleave', hitId, poleMouseLeaveRef.current);
      map.on('click', hitId, poleClickHandlerRef.current);
    },
    [removeLayerHandlers]
  );

  const setDrawData = useCallback(
    (map: maplibregl.Map, pts: [number, number][], geom: DrawGeometry) => {
      const ptF = pts.map(([x, y]) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [x, y] },
        properties: {},
      }));
      const liF =
        (geom === 'line' || geom === 'polygon') && pts.length >= 2
          ? [
              {
                type: 'Feature',
                geometry: {
                  type: 'LineString',
                  coordinates: (geom === 'polygon' && pts.length >= 3) ? [...pts, pts[0]] : pts,
                },
                properties: {},
              },
            ]
          : [];
      const pgF =
        geom === 'polygon' && pts.length >= 3
          ? [
              {
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]]] },
                properties: {},
              },
            ]
          : [];

      try {
        (map.getSource('draw-pts-src') as maplibregl.GeoJSONSource)?.setData({
          type: 'FeatureCollection',
          features: ptF as any,
        });
        (map.getSource('draw-ln-src') as maplibregl.GeoJSONSource)?.setData({
          type: 'FeatureCollection',
          features: liF as any,
        });
        (map.getSource('draw-pg-src') as maplibregl.GeoJSONSource)?.setData({
          type: 'FeatureCollection',
          features: pgF as any,
        });
      } catch {}
    },
    [drawFinished]
  );

  const addOverlaySources = useCallback((map: maplibregl.Map) => {
    const addIfMissing = (id: string, cb: () => void) => {
      if (!map.getSource(id)) cb();
    };

    addIfMissing('draw-pts-src', () => {
      map.addSource('draw-pts-src', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'draw-pts-layer',
        type: 'circle',
        source: 'draw-pts-src',
        paint: {
          'circle-radius': 5.5,
          'circle-color': '#111',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#e0e0e0',
        },
      });
    });

    addIfMissing('draw-ln-src', () => {
      map.addSource('draw-ln-src', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'draw-ln-layer',
        type: 'line',
        source: 'draw-ln-src',
        paint: {
          'line-color': '#111',
          'line-width': 2.5,
          'line-dasharray': [3, 2],
        },
      });
    });

    addIfMissing('draw-pg-src', () => {
      map.addSource('draw-pg-src', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'draw-pg-layer',
        type: 'fill',
        source: 'draw-pg-src',
        paint: {
          'fill-color': '#111',
          'fill-opacity': 0.18,
        },
      });
    });

    addIfMissing('ruler-src', () => {
      map.addSource('ruler-src', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'ruler-layer',
        type: 'line',
        source: 'ruler-src',
        paint: {
          'line-color': '#e11d48',
          'line-width': 2.5,
          'line-dasharray': [4, 2],
        },
      });
    });

    addIfMissing('grid-src', () => {
      map.addSource('grid-src', { type: 'geojson', data: buildGrid() });
      map.addLayer({
        id: 'grid-layer',
        type: 'line',
        source: 'grid-src',
        paint: {
          'line-color': 'rgba(0,0,0,0.18)',
          'line-width': 0.7,
        },
        layout: { visibility: 'none' },
      });
    });

    addIfMissing('heatmap-src', () => {
      map.addSource('heatmap-src', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: POLES.map((p) => ({
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
            properties: {},
          })),
        },
      });
      map.addLayer({
        id: 'heatmap-layer',
        type: 'heatmap',
        source: 'heatmap-src',
        paint: {
          'heatmap-weight': 1,
          'heatmap-intensity': 2,
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0,
            'rgba(0,0,255,0)',
            0.2,
            'rgba(0,200,255,0.6)',
            0.5,
            'rgba(0,220,80,0.8)',
            0.8,
            'rgba(255,220,0,0.9)',
            1,
            'rgba(255,40,0,1)',
          ],
          'heatmap-radius': 50,
          'heatmap-opacity': 0,
        },
      });
    });

    addIfMissing('cluster-src', () => {
      map.addSource('cluster-src', {
        type: 'geojson',
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
        data: {
          type: 'FeatureCollection',
          features: POLES.map((p) => ({
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
            properties: { id: p.id },
          })),
        },
      });

      map.addLayer({
        id: 'cluster-circles',
        type: 'circle',
        source: 'cluster-src',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#111',
          'circle-radius': 18,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#e0e0e0',
        },
        layout: { visibility: 'none' },
      });

      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'cluster-src',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-size': 12,
          visibility: 'none',
        },
        paint: { 'text-color': '#e0e0e0' },
      });

      map.addLayer({
        id: 'cluster-unclustered',
        type: 'circle',
        source: 'cluster-src',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 18, 10],
          'circle-color': '#111111',
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#ffffff',
        },
        layout: { visibility: 'none' },
      });

      clusterClickHandlerRef.current = (e: maplibregl.MapLayerMouseEvent) => {
        const f = e.features?.[0];
        const src = map.getSource('cluster-src') as any;
        const clusterId = f?.properties?.cluster_id;
        if (!src || clusterId == null) return;
        src.getClusterExpansionZoom(clusterId, (err: any, zoom: number) => {
          if (err) return;
          const c = (f?.geometry as any)?.coordinates;
          if (c) map.easeTo({ center: c, zoom });
        });
      };

      unclusterClickHandlerRef.current = (e: maplibregl.MapLayerMouseEvent) => {
        e.preventDefault();
        const feat = e.features?.[0];
        if (!feat) return;
        const pid = feat.properties?.id as string;
        const pole = POLES.find((p) => p.id === pid);
        if (pole) openPoleRef.current(pole);
      };

      map.on('click', 'cluster-circles', clusterClickHandlerRef.current);
      map.on('click', 'cluster-unclustered', unclusterClickHandlerRef.current);
    });
  }, []);

  const applyLayerVisibility = useCallback(
    (map: maplibregl.Map, layerState: Record<string, boolean>, plugins: Record<string, boolean>) => {
      const poleVisible = layerState['Pole'] !== false;
      const clusterOn = !!plugins['cluster'];
      const poleModeVisible = poleVisible && !clusterOn ? 'visible' : 'none';
      const clusterModeVisible = poleVisible && clusterOn ? 'visible' : 'none';

      try {
        map.setLayoutProperty('poles-layer', 'visibility', poleModeVisible);
      } catch {}
      try {
        map.setLayoutProperty('poles-hit', 'visibility', poleModeVisible);
      } catch {}
      try {
        map.setLayoutProperty('cluster-circles', 'visibility', clusterModeVisible);
      } catch {}
      try {
        map.setLayoutProperty('cluster-count', 'visibility', clusterModeVisible);
      } catch {}
      try {
        map.setLayoutProperty('cluster-unclustered', 'visibility', clusterModeVisible);
      } catch {}
      try {
        map.setPaintProperty(
          'heatmap-layer',
          'heatmap-opacity',
          poleVisible && plugins['heatmap'] ? 0.75 : 0
        );
      } catch {}
    },
    []
  );

  const applyPluginVisuals = useCallback(
    (map: maplibregl.Map, plugins: Record<string, boolean>, layers: Record<string, boolean>) => {
      try {
        map.setLayoutProperty('grid-layer', 'visibility', plugins['grid'] ? 'visible' : 'none');
      } catch {}
      applyLayerVisibility(map, layers, plugins);
    },
    [applyLayerVisibility]
  );

  useEffect(() => {
    if (initializedRef.current || !mapContainerRef.current) return;
    initializedRef.current = true;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: getBaseMapStyle('OSM', false),
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: false,
      preserveDrawingBuffer: true,
    });

    map.on('load', () => {
      mapReadyRef.current = true;
      map.resize();
      addOverlaySources(map);
      addPoleMarkers(map);
      applyPluginVisuals(map, activePlugins, layerVisibility);
      map.jumpTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM });
    });

    map.on('move', () => {
      const c = map.getCenter();
      setLatLon({ lat: c.lat, lon: c.lng });
      updateMinimapViewport();
    });

    map.on('zoom', () => {
      setZoomLevel(Math.round(map.getZoom()));
      updateMinimapViewport();
    });

    map.on('rotate', () => setCompassAngle(map.getBearing()));

    map.on('click', (e) => {
      const lng = e.lngLat.lng;
      const lat = e.lngLat.lat;
      const tool = activeToolRef.current;
      const geom = drawGeomRef.current;

      if ((e as any).defaultPrevented) return;

      if (tool === 'Draw') {
        if (drawFinished) return;
        const pts = geom === 'point' ? [[lng, lat] as [number, number]] : [...drawPtsRef.current, [lng, lat]];
        drawPtsRef.current = pts;
        setDrawCount(pts.length);
        if (mapReadyRef.current) setDrawData(map, pts, geom);
        return;
      }

      if (tool === 'Measure') {
        const pts = [...rulerPtsRef.current, [lng, lat] as [number, number]];
        rulerPtsRef.current = pts;

        if (mapReadyRef.current && pts.length >= 2) {
          try {
            (map.getSource('ruler-src') as maplibregl.GeoJSONSource)?.setData({
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  geometry: { type: 'LineString', coordinates: pts },
                  properties: {},
                },
              ],
            });
          } catch {}

          let dist = 0;
          for (let i = 1; i < pts.length; i++) {
            dist += haversineKm(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]);
          }
          setMeasureTotal(dist);

          rulerPopupRef.current?.remove();
          rulerPopupRef.current = new maplibregl.Popup({ closeButton: false, offset: 10 })
            .setLngLat([lng, lat])
            .setHTML(
              `<div style="font:bold 12px sans-serif;padding:6px 10px;color:#111;">${
                dist < 1 ? `${(dist * 1000).toFixed(0)} m` : `${dist.toFixed(3)} km`
              }</div>`
            )
            .addTo(map);
        }

        const el = document.createElement('div');
        el.style.cssText =
          'width:10px;height:10px;border-radius:9999px;background:#e11d48;border:2px solid #e0e0e0;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.22);';
        rulerMarkersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map));
      }
    });

    const onResize = () => {
      map.resize();
      minimapRef.current?.resize();
      updateMinimapViewport();
    };

    window.addEventListener('resize', onResize);
    mapRef.current = map;

    return () => {
      window.removeEventListener('resize', onResize);
      removeLayerHandlers(map);
      minimapRef.current?.remove();
      minimapRef.current = null;
      minimapBoxMarkerRef.current?.remove();
      minimapBoxMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
      mapReadyRef.current = false;
      initializedRef.current = false;
    };
  }, [addOverlaySources, addPoleMarkers, applyPluginVisuals, layerVisibility, activePlugins, removeLayerHandlers, setDrawData, updateMinimapViewport]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const center = map.getCenter();
    const zoom = map.getZoom();
    const bearing = map.getBearing();

    mapReadyRef.current = false;
    map.setStyle(getBaseMapStyle(selectedBaseMap, !!activePlugins['nightmode']));

    map.once('style.load', () => {
      mapReadyRef.current = true;
      addOverlaySources(map);
      addPoleMarkers(map);
      applyPluginVisuals(map, activePlugins, layerVisibility);
      setDrawData(map, drawPtsRef.current, drawGeomRef.current);
      map.jumpTo({ center, zoom, bearing });
      map.resize();
      updateMinimapViewport();
    });
  }, [selectedBaseMap, activePlugins, addOverlaySources, addPoleMarkers, applyPluginVisuals, layerVisibility, setDrawData, updateMinimapViewport]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (mapReadyRef.current) applyPluginVisuals(map, activePlugins, layerVisibility);

    if (activePlugins['export']) {
      setActivePlugins((p) => ({ ...p, export: false }));
      map.once('idle', () => {
        try {
          const link = document.createElement('a');
          link.href = map.getCanvas().toDataURL('image/png');
          link.download = `gis-map-${Date.now()}.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        } catch {
          alert('Export failed.');
        }
      });
    }

    if (activePlugins['fullscreen']) {
      setActivePlugins((p) => ({ ...p, fullscreen: false }));
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
      else document.exitFullscreen?.().catch(() => {});
    }

    if (activePlugins['geoloc']) {
      setActivePlugins((p) => ({ ...p, geoloc: false }));
      if (!navigator.geolocation) {
        alert('Geolocation not supported.');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lng = pos.coords.longitude;
          const lat = pos.coords.latitude;
          map.flyTo({ center: [lng, lat], zoom: 16, essential: true });
          new maplibregl.Popup({ closeButton: true, offset: 12 })
            .setLngLat([lng, lat])
            .setHTML('<div style="padding:6px 10px;font:12px sans-serif;color:#111;">📍 You are here</div>')
            .addTo(map);
        },
        () => alert('Location access denied. Please allow location in browser settings.')
      );
    }

    if (activePlugins['minimap']) {
      if (!minimapRef.current && minimapContainerRef.current) {
        const mm = new maplibregl.Map({
          container: minimapContainerRef.current,
          style: makeRasterStyle(OSM_TILES, 'mm-base', OSM_ATTR),
          center: map.getCenter(),
          zoom: Math.max(0, map.getZoom() - 4),
          interactive: false,
          attributionControl: false,
        });
        mm.on('load', () => {
          mm.resize();
          updateMinimapViewport();
        });
        minimapRef.current = mm;
      } else {
        updateMinimapViewport();
      }
    } else {
      minimapBoxMarkerRef.current?.remove();
      minimapBoxMarkerRef.current = null;
      if (minimapRef.current) {
        minimapRef.current.remove();
        minimapRef.current = null;
      }
    }
  }, [activePlugins, applyPluginVisuals, layerVisibility, updateMinimapViewport]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    applyLayerVisibility(map, layerVisibility, activePlugins);
  }, [layerVisibility, activePlugins, applyLayerVisibility]);

  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (!canvas) return;
    const cursors: Record<string, string> = {
      Locate: 'crosshair',
      Select: 'pointer',
      Draw: 'crosshair',
      Measure: 'crosshair',
      Clear: 'default',
      Plugins: 'default',
    };
    canvas.style.cursor = activeTool ? cursors[activeTool] || 'default' : 'default';
  }, [activeTool]);

  const zoomSyncRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (zoomSyncRef.current) {
      zoomSyncRef.current = false;
      return;
    }
    if (Math.abs(map.getZoom() - zoomLevel) > 0.4) map.setZoom(zoomLevel);
  }, [zoomLevel]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onZoom = () => {
      zoomSyncRef.current = true;
      setZoomLevel(Math.round(map.getZoom()));
    };
    map.on('zoom', onZoom);
    return () => {
      map.off('zoom', onZoom);
    };
  }, []);

  const clearDraw = useCallback(() => {
    drawPtsRef.current = [];
    setDrawCount(0);
    setDrawFinished(false);
    try {
      (mapRef.current?.getSource('draw-pts-src') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection',
        features: [],
      });
      (mapRef.current?.getSource('draw-ln-src') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection',
        features: [],
      });
      (mapRef.current?.getSource('draw-pg-src') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection',
        features: [],
      });
    } catch {}
  }, []);

  const clearMeasure = useCallback(() => {
    rulerPtsRef.current = [];
    setMeasureTotal(null);
    rulerMarkersRef.current.forEach((m) => m.remove());
    rulerMarkersRef.current = [];
    rulerPopupRef.current?.remove();
    rulerPopupRef.current = null;
    try {
      (mapRef.current?.getSource('ruler-src') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection',
        features: [],
      });
    } catch {}
  }, []);

  const saveDraw = useCallback(() => {
    alert(`Saved ${drawCount} point(s) as ${drawGeomRef.current}`);
    clearDraw();
    setActiveTool(null);
    setShowDrawPopup(false);
  }, [drawCount, clearDraw]);

  const runSearch = useCallback(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return;

    const found = POLES.find((pole) => {
      const allText = [
        pole.id,
        getPoleValue(pole, 'design_id'),
        getPoleValue(pole, 'municipality'),
        getPoleValue(pole, 'owner'),
        getPoleValue(pole, 'status'),
        getPoleValue(pole, 'material'),
      ]
        .join(' ')
        .toLowerCase();
      return allText.includes(q);
    });

    if (!found) {
      alert('No matching object found.');
      return;
    }

    mapRef.current?.flyTo({ center: [found.lon, found.lat], zoom: 18, essential: true });
    openPole(found);
    setSelectedObjectItem('Pole');
    setShowBottomPanel(true);
  }, [searchText, getPoleValue, openPole]);

  const handleToolClick = (tool: ActiveTool) => {
    if (tool === 'Locate') {
      mapRef.current?.flyTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, essential: true });
      setActiveTool(null);
      setShowDrawPopup(false);
      return;
    }

    if (tool === 'Draw') {
      setActiveTool((prev) => (prev === 'Draw' ? null : 'Draw'));
      setShowDrawPopup((prev) => (activeTool === 'Draw' ? !prev : true));
      return;
    }

    if (tool === 'Clear') {
      clearDraw();
      clearMeasure();
      setActiveTool(null);
      setShowDrawPopup(false);
      return;
    }

    if (tool === 'Plugins') {
      setShowDrawPopup(false);
      setActiveTool((prev) => (prev === 'Plugins' ? null : 'Plugins'));
      return;
    }

    setShowDrawPopup(false);
    setActiveTool((prev) => {
      if (prev === tool) {
        if (tool === 'Measure') clearMeasure();
        return null;
      }
      if (prev === 'Measure') clearMeasure();
      return tool;
    });
  };

  const selectDrawType = (geom: DrawGeometry) => {
    setDrawGeometry(geom);
    drawGeomRef.current = geom;
    clearDraw();
    setActiveTool('Draw');
    setShowDrawPopup(false);
    setDrawFinished(false);
  };

  const togglePlugin = (id: string) => {
    setActivePlugins((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const getPV = (pole: Pole, field: string) => pole.attributes.find((a) => a.field === field)?.value || '-';

  const getLabel = () => {
    const n = selectedObjectItem || 'Object';
    return selectedObjectId ? `${n} (${selectedObjectId})` : n;
  };

  const getSelPole = () => POLES.find((p) => p.id === selectedObjectId) || null;

  const zoomToSel = () => {
    const p = getSelPole();
    if (p) mapRef.current?.flyTo({ center: [p.lon, p.lat], zoom: 18, essential: true });
  };

  const startEditing = () => {
    setDraftAttributes(attributes.map((i) => ({ ...i })));
    setIsEditing(true);
    setShowSaveMenu(false);
  };

  const cancelEditing = () => {
    setDraftAttributes(attributes.map((i) => ({ ...i })));
    setIsEditing(false);
    setShowSaveMenu(false);
  };

  const handleDraft = (field: string, value: string) =>
    setDraftAttributes((prev) => prev.map((i) => (i.field === field ? { ...i, value } : i)));

  const saveChanges = (cont: boolean) => {
    setAttributes(draftAttributes.map((i) => ({ ...i })));
    setIsEditing(cont);
    setShowSaveMenu(false);
  };

  const deleteObj = () => {
    setSelectedObjectId(null);
    setAttributes([]);
    setDraftAttributes([]);
    setIsEditing(false);
    setShowSaveMenu(false);
  };

  const closeEditor = () => {
    setSelectedObjectId(null);
    setIsEditing(false);
    setShowSaveMenu(false);
  };

  const zoomIn = () => {
    const z = Math.min((mapRef.current?.getZoom() || zoomLevel) + 1, 20);
    setZoomLevel(z);
    mapRef.current?.setZoom(z);
  };

  const zoomOut = () => {
    const z = Math.max((mapRef.current?.getZoom() || zoomLevel) - 1, 1);
    setZoomLevel(z);
    mapRef.current?.setZoom(z);
  };

  const toggleGroup = (g: keyof ExpandedGroups) =>
    setExpandedGroups((prev) => ({ ...prev, [g]: !prev[g] }));

  const createObjectData = (name: string) => {
    const code = name.toUpperCase().slice(0, 2);
    const oid = `${code}-001`;
    const data: Attribute[] = [
      { field: 'asset_id', value: oid },
      { field: 'feature_type', value: name },
      { field: 'status', value: 'Active' },
      { field: 'owner', value: 'Utility Network' },
      { field: 'material', value: name === 'Manhole' ? 'Concrete' : 'Steel' },
      { field: 'municipality', value: 'Quezon City' },
      { field: 'design_id', value: `${code}-1001` },
    ];
    setSelectedObjectItem(name);
    setSelectedObjectId(oid);
    setAttributes(data);
    setDraftAttributes(data);
    setIsEditing(false);
    setShowSaveMenu(false);
    if (isMobile) setShowOC(false);
  };

  const selectObjectItem = (name: string) => {
    setSelectedObjectItem(name);
    setShowBottomPanel(true);
    setAppliedFilter('');
    setTableFilterInput('');
    if (name === 'Pole') {
      setSelectedObjectId(null);
      setAttributes([]);
      setDraftAttributes([]);
      setIsEditing(false);
      setShowSaveMenu(false);
      return;
    }
    createObjectData(name);
  };

  const bottomRows: BottomRow[] =
    selectedObjectItem === 'Pole'
      ? POLES.map((pole) => ({
          key: pole.id,
          id: pole.id,
          type: getPV(pole, 'feature_type'),
          status: getPV(pole, 'status'),
          owner: getPV(pole, 'owner'),
          material: getPV(pole, 'material'),
          height: getPV(pole, 'height_m'),
          municipality: getPV(pole, 'municipality'),
          designId: getPV(pole, 'design_id'),
          selected: selectedObjectId === pole.id,
          onClick: () => openPole(pole),
        }))
      : selectedObjectItem === 'Manhole'
        ? [
            {
              key: 'MH-001',
              id: 'MH-001',
              type: 'Manhole',
              status: 'Active',
              owner: 'Utility Network',
              material: 'Concrete',
              height: '-',
              municipality: 'Quezon City',
              designId: 'MH-2101',
              selected: selectedObjectId === 'MH-001',
              onClick: () => createObjectData('Manhole'),
            },
            {
              key: 'MH-002',
              id: 'MH-002',
              type: 'Manhole',
              status: 'Proposed',
              owner: 'Utility Network',
              material: 'Concrete',
              height: '-',
              municipality: 'Quezon City',
              designId: 'MH-2102',
            },
          ]
        : selectedObjectItem === 'Cabinate'
          ? [
              {
                key: 'CB-001',
                id: 'CB-001',
                type: 'Cabinate',
                status: 'Active',
                owner: 'Metro Utility',
                material: 'Steel',
                height: '-',
                municipality: 'Quezon City',
                designId: 'CB-3101',
                selected: selectedObjectId === 'CB-001',
                onClick: () => createObjectData('Cabinate'),
              },
              {
                key: 'CB-002',
                id: 'CB-002',
                type: 'Cabinate',
                status: 'Inactive',
                owner: 'Metro Utility',
                material: 'Steel',
                height: '-',
                municipality: 'Quezon City',
                designId: 'CB-3102',
              },
            ]
          : [];

  const filteredRows = useMemo(() => {
    if (!appliedFilter.trim()) return bottomRows;
    const q = appliedFilter.trim().toLowerCase();
    return tableFilterMode === 'By ID' ? bottomRows.filter((r) => r.id.toLowerCase().includes(q)) : bottomRows;
  }, [bottomRows, appliedFilter, tableFilterMode]);

  const downloadTable = () => {
    const headers = ['ID', 'Type', 'Status', 'Owner', 'Material', 'Height', 'Municipality', 'Design ID'];
    const csv = [headers, ...filteredRows.map((r) => [r.id, r.type, r.status, r.owner, r.material, r.height, r.municipality, r.designId])]
      .map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `${selectedObjectItem || 'objects'}-table.csv`;
    a.click();
  };

  const ocW = showOC ? (isMobile ? Math.min(window.innerWidth * 0.3, 140) : 250) : 0;
  const tlLeft = showOC ? ocW + 12 : 12;
  const blLeft = showOC ? ocW + 12 : 12;
  const rightShift = !isMobile && selectedObjectId ? 'right-[332px]' : 'right-3 sm:right-4';
  const ctrlBot = isMobile
    ? selectedObjectId
      ? 'bottom-[calc(50vh+10px)]'
      : showBottomPanel
        ? 'bottom-[calc(30vh+8px)]'
        : 'bottom-3'
    : showBottomPanel
      ? 'bottom-[calc(20vh+8px)]'
      : 'bottom-4';
  const llBot = isMobile
    ? selectedObjectId
      ? 'bottom-[calc(50vh+14px)]'
      : showBottomPanel
        ? 'bottom-[calc(30vh+10px)]'
        : 'bottom-3'
    : showBottomPanel
      ? 'bottom-[calc(20vh+8px)]'
      : 'bottom-4';

  const ib =
    'flex items-center justify-center border border-[#c0c0c0] bg-[#e0e0e0]/96 text-[#111] shadow-[0_6px_18px_rgba(0,0,0,0.10)] backdrop-blur-md transition-all hover:bg-[#d5d5d5] active:scale-[0.98]';
  const pb = 'border border-[#111] bg-[#111] text-[#e0e0e0] hover:bg-[#262626] transition-all';
  const gb = 'border border-[#b0b0b0] bg-[#d0d0d0] text-[#111] hover:bg-[#c5c5c5] transition-all';

  const tools = [
    { label: 'Locate' as ActiveTool, Icon: IconHomePin },
    { label: 'Select' as ActiveTool, Icon: IconSelect },
    { label: 'Draw' as ActiveTool, Icon: IconDraw },
    { label: 'Measure' as ActiveTool, Icon: IconMeasure },
    { label: 'Clear' as ActiveTool, Icon: IconClear },
    { label: 'Plugins' as ActiveTool, Icon: IconPlugins },
  ];

  const LayersIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M8 1L15 5L8 9L1 5L8 1Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M1 9L8 13L15 9"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  const SmallCompass = ({ size = 48 }: { size?: number }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 54 54"
      style={{
        transform: `rotate(${-compassAngle}deg)`,
        transition: 'transform 0.3s ease',
        filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.18))',
        cursor: 'pointer',
      }}
      onClick={() => mapRef.current?.resetNorth({ duration: 500 })}
      title="Click to reset north"
    >
      <circle cx="27" cy="27" r="26" fill="#f7f7f7" stroke="#d9d9d9" strokeWidth="1" />
      <circle cx="27" cy="27" r="22" fill="none" stroke="#e6e6e6" strokeWidth="0.6" />
      {Array.from({ length: 16 }, (_, i) => {
        const deg = i * 22.5;
        const rad = (deg * Math.PI) / 180;
        const isMaj = i % 4 === 0;
        const isMid = i % 2 === 0 && !isMaj;
        const r1 = isMaj ? 18 : isMid ? 19.5 : 20.5;
        return (
          <line
            key={i}
            x1={27 + r1 * Math.sin(rad)}
            y1={27 - r1 * Math.cos(rad)}
            x2={27 + 23 * Math.sin(rad)}
            y2={27 - 23 * Math.cos(rad)}
            stroke={isMaj ? '#666' : '#bbb'}
            strokeWidth={isMaj ? 1 : 0.55}
          />
        );
      })}
      <circle cx="27" cy="27" r="16" fill="#efefef" stroke="#d9d9d9" strokeWidth="0.7" />
      <polygon points="27,4 29.7,27 27,21 24.3,27" fill="#e11d48" />
      <polygon points="27,50 29.7,27 27,33 24.3,27" fill="#b9b9b9" />
      <polygon points="50,27 27,24.3 33,27 27,29.7" fill="#8a8a8a" />
      <polygon points="4,27 27,24.3 21,27 27,29.7" fill="#8a8a8a" />
      <circle cx="27" cy="27" r="6" fill="#f7f7f7" stroke="#d9d9d9" strokeWidth="0.7" />
      <circle cx="27" cy="27" r="2.8" fill="#222" />
      <circle cx="27" cy="27" r="1.2" fill="#f7f7f7" />
      <text x="27" y="14.5" textAnchor="middle" fontSize="5.5" fontWeight="700" fill="#111" fontFamily="sans-serif">
        N
      </text>
      <text x="27" y="44.5" textAnchor="middle" fontSize="5" fontWeight="500" fill="#999" fontFamily="sans-serif">
        S
      </text>
      <text x="43.5" y="28.8" textAnchor="middle" fontSize="5" fontWeight="500" fill="#999" fontFamily="sans-serif">
        E
      </text>
      <text x="10.5" y="28.8" textAnchor="middle" fontSize="5" fontWeight="500" fill="#999" fontFamily="sans-serif">
        W
      </text>
    </svg>
  );

  const DrawPopup = () => (
    <div className="absolute right-14 top-0 z-50 flex flex-col items-end gap-3">
      <div className="rounded-full border border-[#c0c0c0] bg-[#e0e0e0]/95 px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-[#555] shadow-md backdrop-blur-sm">
        Drawing Tools
      </div>
      {[
        { key: 'point' as DrawGeometry, label: 'Point', Ic: IconPoint },
        { key: 'line' as DrawGeometry, label: 'Line', Ic: IconLine },
        { key: 'polygon' as DrawGeometry, label: 'Polygon', Ic: IconPolygon },
      ].map(({ key, label, Ic }) => {
        const active = drawGeometry === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => selectDrawType(key)}
            title={label}
            className={[
              'flex items-center gap-3 rounded-full border px-4 py-2.5 shadow-[0_4px_12px_rgba(0,0,0,0.1)] transition-all duration-200 active:scale-[0.95] whitespace-nowrap backdrop-blur-sm',
              active
                ? 'border-[#111] bg-[#111] text-[#e0e0e0] scale-105'
                : 'border-[#c0c0c0] bg-[#e0e0e0]/95 text-[#111] hover:bg-[#d0d0d0]',
            ].join(' ')}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/10">
              <Ic active={active} />
            </span>
            <span className="text-[12px] font-bold pr-1">{label}</span>
          </button>
        );
      })}
    </div>
  );

  const PluginsPanel = () => (
    <div className="absolute right-12 top-0 z-50 w-[250px] overflow-hidden rounded-2xl border border-[#d7d7d7] bg-[#e0e0e0]/96 shadow-[0_14px_36px_rgba(0,0,0,0.18)] backdrop-blur-md">
      <div className="border-b border-[#e8e8e8] bg-[#e0e0e0] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#666]">
        Map Plugins
      </div>
      {PLUGINS.map((p, i) => (
        <div
          key={p.id}
          className={`flex items-center justify-between px-4 py-3 ${
            i > 0 ? 'border-t border-[#d0d0d0]' : ''
          } hover:bg-[#d5d5d5] transition-all`}
        >
          <div className="flex flex-col gap-0.5">
            <span className="text-[12px] font-semibold text-[#111] leading-tight">{p.label}</span>
            <span className="text-[10px] text-[#777] leading-tight">{p.desc}</span>
          </div>
          <button
            type="button"
            onClick={() => togglePlugin(p.id)}
            className={`relative ml-3 h-5 w-10 shrink-0 rounded-full transition-all duration-200 border ${
              activePlugins[p.id] ? 'bg-[#111] border-[#111]' : 'bg-[#d8d8d8] border-[#cfcfcf]'
            }`}
          >
            <span
              className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-[#e0e0e0] shadow-sm transition-all duration-200 ${
                activePlugins[p.id] ? 'left-[22px]' : 'left-[2px]'
              }`}
            />
          </button>
        </div>
      ))}
    </div>
  );

  const renderDetails = (small: boolean) =>
    (isEditing ? draftAttributes : attributes).map((item, idx) => (
      <div
        key={item.field}
        className={`grid items-center border-b border-[#ececec] leading-none ${
          small ? 'min-h-[24px] grid-cols-[82px_1fr] text-[11px]' : 'min-h-[26px] grid-cols-[100px_1fr] text-[12px]'
        } ${idx % 2 === 0 ? 'bg-[#d5d5d5]' : 'bg-[#e0e0e0]'}`}
      >
        <div className="truncate border-r border-[#cfcfcf] px-2 py-[3px] font-semibold text-[#111]">{item.field}</div>
        <div className="px-2 py-[2px]">
          {isEditing ? (
            item.field === 'status' ? (
              <select
                value={item.value}
                onChange={(e) => handleDraft(item.field, e.target.value)}
                className={`w-full rounded-lg border border-[#dddddd] bg-[#e0e0e0] px-1.5 text-[#111] outline-none ${
                  small ? 'h-[20px] text-[11px]' : 'h-6 text-[12px]'
                }`}
              >
                <option>Active</option>
                <option>Proposed</option>
                <option>Inactive</option>
              </select>
            ) : (
              <input
                value={item.value}
                onChange={(e) => handleDraft(item.field, e.target.value)}
                className={`w-full rounded-lg border border-[#dddddd] bg-[#e0e0e0] px-1.5 text-[#111] outline-none ${
                  small ? 'h-[20px] text-[11px]' : 'h-6 text-[12px]'
                }`}
              />
            )
          ) : (
            <div className={`truncate text-[#444] ${small ? 'text-[11px]' : 'text-[12px]'}`}>{item.value}</div>
          )}
        </div>
      </div>
    ));

  const renderLayers = (small: boolean) =>
    ['Pole', 'Substation', 'Cabinate', 'Cable'].map((layer, idx) => (
      <div
        key={layer}
        className={`grid grid-cols-[1fr_auto] items-center border-b border-[#ececec] px-3 leading-none ${
          small ? 'min-h-[24px] py-[3px] text-[11px]' : 'min-h-[26px] py-[4px] text-[12px]'
        } ${idx % 2 === 0 ? 'bg-[#d5d5d5]' : 'bg-[#e0e0e0]'}`}
      >
        <span className="truncate text-[#555]">{layer}</span>
        <input
          type="checkbox"
          checked={layerVisibility[layer] !== false}
          onChange={() =>
            setLayerVisibility((prev) => ({
              ...prev,
              [layer]: !(prev[layer] !== false),
            }))
          }
          className="accent-[#111]"
        />
      </div>
    ));

  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#d0d0d0] font-sans text-[#111]">
      <div ref={mapContainerRef} className="absolute inset-0 z-0" style={{ width: '100%', height: '100%' }} />

      <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(rgba(0,0,0,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.02)_1px,transparent_1px)] bg-[size:40px_40px]" />

      {activePlugins['minimap'] && (
        <div
          ref={minimapContainerRef}
          className={`absolute z-30 overflow-hidden rounded-2xl border border-[#d7d7d7] bg-[#e0e0e0]/90 shadow-[0_12px_30px_rgba(0,0,0,0.16)] backdrop-blur-sm ${
            isMobile ? 'bottom-20 left-20 h-[80px] w-[112px]' : 'bottom-24 left-20 h-[132px] w-[190px]'
          }`}
        />
      )}

      {isMobile && showOC && (
        <div className="absolute inset-0 z-[28] bg-black/20" onClick={() => setShowOC(false)} />
      )}

      {/* ── Top-left: hamburger + search ── */}
      <div className="absolute top-2 z-30 flex items-center gap-1.5 transition-all duration-300" style={{ left: `${tlLeft}px` }}>
        <button
          type="button"
          onClick={() => {
            setShowTopMenu((p) => !p);
            setShowBaseMapDrop(false);
            setShowDrawPopup(false);
          }}
          className={`${ib} h-9 w-9 rounded-2xl`}
        >
          <div className="flex flex-col gap-[3px]">
            <span className="block h-[2px] w-[14px] rounded bg-current" />
            <span className="block h-[2px] w-[14px] rounded bg-current" />
            <span className="block h-[2px] w-[14px] rounded bg-current" />
          </div>
        </button>

        <div className="flex h-9 w-[190px] sm:w-[280px] items-center rounded-2xl border border-[#c0c0c0] bg-[#e0e0e0]/95 px-3 shadow-[0_8px_22px_rgba(0,0,0,0.10)] backdrop-blur-md">
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runSearch();
            }}
            className="w-full bg-transparent text-[11px] sm:text-[12px] text-[#111] outline-none placeholder:text-[#8a8a8a]"
            placeholder="Search pole, design id, municipality..."
          />
          <button
            type="button"
            onClick={runSearch}
            className="ml-2 flex h-7 w-7 items-center justify-center rounded-xl border border-[#d0d0d0] bg-[#d5d5d5] text-[#111] hover:bg-[#e0e0e0]"
            title="Search"
          >
            ⌕
          </button>
        </div>

        {showTopMenu && (
          <div
            className={`absolute left-0 z-50 overflow-hidden rounded-2xl border border-[#d7d7d7] bg-[#e0e0e0]/96 shadow-[0_14px_36px_rgba(0,0,0,0.18)] ${
              isMobile ? 'top-11 min-w-[132px]' : 'top-11 min-w-[176px]'
            }`}
          >
            {[
              {
                label: 'Home',
                action: () => {
                  mapRef.current?.flyTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, essential: true });
                  setShowTopMenu(false);
                },
              },
              { label: 'Bookmark', action: () => setShowTopMenu(false) },
              {
                label: 'Object Controller',
                action: () => {
                  setShowOC((p) => !p);
                  setShowTopMenu(false);
                },
              },
            ].map((item, i) => (
              <button
                key={item.label}
                type="button"
                onClick={item.action}
                className={`flex w-full items-center text-left text-[#111] hover:bg-[#d5d5d5] ${
                  isMobile ? 'px-3 py-2 text-[11px]' : 'px-4 py-2.5 text-[13px]'
                } ${i > 0 ? 'border-t border-[#d0d0d0]' : ''}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Top-right: logo + user ── */}
      <div className={`absolute top-2 z-30 flex items-center gap-1.5 sm:gap-2 transition-all duration-300 ${rightShift}`}>
        <a href="https://redplanetgrp.com" target="_blank" rel="noreferrer">
          <img
            src="https://redplanetgrp.com/wp-content/uploads/2025/04/Redplanet-Solutions.webp"
            alt="RedPlanet"
            className="h-7 sm:h-9 w-auto object-contain"
          />
        </a>
        <button type="button" className={`${ib} h-9 w-9 rounded-2xl`}>
          <span className="text-sm">👤</span>
        </button>
      </div>

      {/* ── Right toolbar ── */}
      <div className={`absolute top-[46px] sm:top-[52px] z-30 flex flex-col gap-2 transition-all duration-300 ${rightShift}`}>
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setShowBaseMapDrop((p) => !p);
              setShowTopMenu(false);
              setShowDrawPopup(false);
              setActiveTool((p) => (p === 'Plugins' ? null : p));
            }}
            className={`${ib} h-10 w-10 rounded-2xl`}
            title="Base Maps"
          >
            <LayersIcon />
          </button>

          {showBaseMapDrop && (
            <div className="absolute right-0 top-12 z-50 min-w-[170px] overflow-hidden rounded-2xl border border-[#d7d7d7] bg-[#e0e0e0]/96 shadow-[0_14px_36px_rgba(0,0,0,0.18)] backdrop-blur-md">
              <div className="border-b border-[#d0d0d0] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#666]">
                Base Map
              </div>
              {['OSM', 'Google', 'Google Satellite'].map((bm, i) => (
                <button
                  key={bm}
                  type="button"
                  onClick={() => {
                    setSelectedBaseMap(bm);
                    setShowBaseMapDrop(false);
                    if (bm === 'Google' && !GOOGLE_ROAD_TILES_URL) {
                      alert('Set GOOGLE_ROAD_TILES_URL constant with your Google Map Tiles API URL.');
                    }
                    if (bm === 'Google Satellite' && !GOOGLE_SAT_TILES_URL) {
                      alert('Set GOOGLE_SAT_TILES_URL constant with your Google Map Tiles API URL.');
                    }
                  }}
                  className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-[12px] transition-all ${
                    selectedBaseMap === bm ? 'bg-[#111] text-[#e0e0e0]' : 'text-[#111] hover:bg-[#d5d5d5]'
                  } ${i > 0 ? 'border-t border-[#d0d0d0]' : ''}`}
                >
                  <span>{bm}</span>
                  {selectedBaseMap === bm && <span className="text-xs">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {tools.map((tool) => {
          const isActive = activeTool === tool.label;
          return (
            <div key={tool.label} className="relative">
              <button
                type="button"
                title={tool.label}
                onClick={() => handleToolClick(tool.label)}
                className={`h-10 w-10 rounded-2xl border border-[#c0c0c0] bg-[#e0e0e0]/95 shadow-[0_8px_22px_rgba(0,0,0,0.10)] backdrop-blur-md transition-all hover:bg-[#d5d5d5] active:scale-[0.98]`}
              >
                <tool.Icon active={isActive} />
              </button>

              {tool.label === 'Plugins' && isActive && <PluginsPanel />}
              {tool.label === 'Draw' && activeTool === 'Draw' && showDrawPopup && <DrawPopup />}
            </div>
          );
        })}
      </div>

      {/* ── Draw status bar ── */}
      {activeTool === 'Draw' && drawCount > 0 && (
        <div
          className={`absolute left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-full border border-[#c0c0c0] bg-[#e0e0e0]/96 px-4 py-2 shadow-[0_10px_28px_rgba(0,0,0,0.16)] text-[11px] text-[#111] whitespace-nowrap backdrop-blur-md ${
            showBottomPanel ? 'bottom-[calc(20vh+52px)]' : 'bottom-14'
          }`}
        >
          <span className="font-medium capitalize">{drawGeometry}</span>
          <span className="text-[#888]">{drawCount} pt{drawCount !== 1 ? 's' : ''}</span>
          <span className="text-[#c0c0c0]">|</span>
          {!drawFinished ? (
            <button onClick={() => setDrawFinished(true)} className={`${pb} rounded-full px-3 py-1 text-[10px] font-semibold`}>
              Finish
            </button>
          ) : (
            <button onClick={saveDraw} className={`${pb} rounded-full px-3 py-1 text-[10px] font-semibold`}>
              Save
            </button>
          )}
          <button onClick={clearDraw} className="text-[10px] text-[#e11d48] underline font-medium">
            Clear
          </button>
        </div>
      )}

      {/* ── Measure bar ── */}
      {activeTool === 'Measure' && (
        <div
          className={`absolute left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-full border border-[#c0c0c0] bg-[#e0e0e0]/96 px-4 py-2 shadow-[0_10px_28px_rgba(0,0,0,0.16)] text-[11px] text-[#111] whitespace-nowrap backdrop-blur-md ${
            showBottomPanel ? 'bottom-[calc(20vh+52px)]' : 'bottom-14'
          }`}
        >
          <span className="font-medium">Measure</span>
          <span className="text-[#888]">
            {measureTotal != null
              ? measureTotal < 1
                ? `${(measureTotal * 1000).toFixed(0)} m`
                : `${measureTotal.toFixed(3)} km`
              : 'Click map to start'}
          </span>
          <span className="text-[#c0c0c0]">|</span>
          <button onClick={clearMeasure} className="text-[10px] text-[#e11d48] underline font-medium">
            Clear
          </button>
        </div>
      )}

      {/* ── Object Controller ── */}
      <div
        className={`absolute inset-y-0 left-0 z-30 border-r border-[#c0c0c0] bg-[#e0e0e0]/96 shadow-[0_16px_40px_rgba(0,0,0,0.12)] backdrop-blur-md transition-transform duration-300 ease-in-out ${
          showOC ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ width: isMobile ? 'min(30vw,140px)' : '250px' }}
      >
        <div className="flex items-center justify-between border-b border-[#d0d0d0] bg-[#d5d5d5] px-2 py-2 text-[11px] font-semibold text-[#111] sm:px-3 sm:text-[13px]">
          <span>Object Controller</span>
          <button type="button" onClick={() => setShowOC(false)} className={`${ib} h-7 w-7 shrink-0 rounded-xl text-xs font-bold`}>
            ←
          </button>
        </div>

        <div className="h-[calc(100%-41px)] overflow-y-auto px-1 py-2 sm:px-2">
          {[
            { key: 'Segment' as keyof ExpandedGroups, items: ['Cable', 'Cable Segment', 'Fiber Optic', 'Wire'] },
            { key: 'Distribution Structure' as keyof ExpandedGroups, items: ['Pole', 'Manhole', 'Cabinate'] },
            { key: 'Equipment' as keyof ExpandedGroups, items: ['Power Transformer', 'Service Point', 'Light', 'Meter'] },
          ].map((group, gi) => (
            <div key={group.key} className={gi > 0 ? 'mt-1 space-y-0.5' : 'space-y-0.5'}>
              <button
                type="button"
                onClick={() => toggleGroup(group.key)}
                className="flex w-full items-center justify-between rounded-xl px-1 py-1 text-left font-medium text-[#111] transition-all hover:bg-[#d5d5d5] sm:px-2.5 sm:py-2"
              >
                <span className={isMobile ? 'text-[9.5px] leading-tight' : 'text-[13px] leading-tight'}>{group.key}</span>
                <span className="shrink-0 text-[8px] sm:text-[10px]">{expandedGroups[group.key] ? '▾' : '▸'}</span>
              </button>

              {expandedGroups[group.key] && (
                <div className="ml-1.5 space-y-0.5 border-l border-[#c0c0c0] pl-1.5 sm:ml-3 sm:pl-2.5">
                  {group.items.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => selectObjectItem(item)}
                      className={`block w-full rounded-lg px-1 py-1 text-left transition-all sm:px-2.5 sm:py-1.5 ${
                        isMobile ? 'text-[9px] leading-tight' : 'text-[12px]'
                      } ${
                        selectedObjectItem === item
                          ? 'bg-[#111] text-[#e0e0e0]'
                          : 'text-[#555] hover:bg-[#d5d5d5] hover:text-[#111]'
                      }`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Object editor – desktop ── */}
      {selectedObjectId && !isMobile && (
        <div className="absolute inset-y-0 right-0 z-30 flex w-[320px] flex-col border-l border-[#c0c0c0] bg-[#e0e0e0]/96 shadow-[0_16px_40px_rgba(0,0,0,0.12)] backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-[#d0d0d0] bg-[#d5d5d5] px-3 py-2">
            <div className="text-sm font-semibold text-[#111]">Object Editor</div>
            <button type="button" onClick={closeEditor} className={`${ib} h-8 w-8 rounded-xl text-sm font-bold`}>
              →
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 border-b border-[#d0d0d0] bg-[#e0e0e0] px-3 py-2">
            <div className="truncate text-xs text-[#555]">
              Selected: <span className="font-semibold text-[#111]">{getLabel()}</span>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={zoomToSel} className={`${ib} h-8 w-8 rounded-xl text-sm font-bold`}>
                ⌖
              </button>
              {!isEditing && (
                <button onClick={startEditing} className={`${gb} rounded-xl px-3 py-1.5 text-xs font-medium`}>
                  Edit
                </button>
              )}
            </div>
          </div>

          <div className="flex border-b border-[#d0d0d0] bg-[#d5d5d5] text-xs">
            {(['Details', 'Layers'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 transition ${
                  activeTab === tab
                    ? 'border-b-2 border-[#111] bg-[#e0e0e0] font-semibold text-[#111]'
                    : 'text-[#555] hover:bg-[#d0d0d0]'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className={`${isEditing ? 'h-[calc(100%-120px)]' : 'h-[calc(100%-96px)]'} overflow-y-auto bg-[#e0e0e0]`}>
            {activeTab === 'Details' ? renderDetails(false) : renderLayers(false)}
          </div>

          {isEditing && (
            <div className="flex items-center justify-end gap-2 border-t border-[#d0d0d0] bg-[#d5d5d5] px-2 py-2">
              <button onClick={cancelEditing} className={`${gb} rounded-xl px-2.5 py-1.5 text-xs font-medium`}>
                Cancel
              </button>
              <button onClick={deleteObj} className={`${gb} rounded-xl px-2.5 py-1.5 text-xs font-medium`}>
                Delete
              </button>
              <div className="relative">
                <button type="button" onClick={() => setShowSaveMenu((p) => !p)} className={`${pb} rounded-xl px-2.5 py-1.5 text-xs font-medium`}>
                  Save ▾
                </button>
                {showSaveMenu && (
                  <div className="absolute bottom-full right-0 mb-2 min-w-[160px] overflow-hidden rounded-xl border border-[#c0c0c0] bg-[#e0e0e0] shadow-[0_12px_30px_rgba(0,0,0,0.15)]">
                    <button
                      type="button"
                      onClick={() => saveChanges(false)}
                      className="block w-full px-3 py-2 text-left text-xs text-[#111] hover:bg-[#d5d5d5]"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => saveChanges(true)}
                      className="block w-full border-t border-[#d0d0d0] px-3 py-2 text-left text-xs text-[#111] hover:bg-[#d5d5d5]"
                    >
                      Save &amp; Continue
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Object editor – mobile ── */}
      {selectedObjectId && isMobile && (
        <div
          className="absolute bottom-0 left-0 right-0 z-30 flex flex-col rounded-t-2xl border-t border-[#c0c0c0] bg-[#e0e0e0]/96 shadow-[0_-10px_30px_rgba(0,0,0,0.16)] backdrop-blur-md"
          style={{ maxHeight: '50vh' }}
        >
          <div className="flex shrink-0 justify-center pb-1 pt-2">
            <div className="h-[3px] w-8 rounded-full bg-[#b0b0b0]" />
          </div>

          <div className="flex shrink-0 items-center justify-between border-b border-[#d0d0d0] bg-[#d5d5d5] px-3 py-1.5">
            <span className="text-[12px] font-semibold text-[#111]">Object Editor</span>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={zoomToSel} className={`${ib} h-7 w-7 rounded-xl text-xs`}>
                ⌖
              </button>
              {!isEditing && (
                <button onClick={startEditing} className={`${gb} rounded-xl px-2 py-1 text-[11px] font-medium`}>
                  Edit
                </button>
              )}
              <button type="button" onClick={closeEditor} className={`${ib} h-7 w-7 rounded-xl text-xs font-bold`}>
                ↓
              </button>
            </div>
          </div>

          <div className="shrink-0 border-b border-[#d0d0d0] px-3 py-1">
            <span className="text-[11px] text-[#555]">Selected: </span>
            <span className="text-[11px] font-semibold text-[#111]">{getLabel()}</span>
          </div>

          <div className="flex shrink-0 border-b border-[#d0d0d0] bg-[#d5d5d5] text-[11px]">
            {(['Details', 'Layers'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 transition ${
                  activeTab === tab
                    ? 'border-b-2 border-[#111] bg-[#e0e0e0] font-semibold text-[#111]'
                    : 'text-[#555] hover:bg-[#d0d0d0]'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto bg-[#e0e0e0]">{activeTab === 'Details' ? renderDetails(true) : renderLayers(true)}</div>

          {isEditing && (
            <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-[#d0d0d0] bg-[#d5d5d5] px-2 py-1.5">
              <button onClick={cancelEditing} className={`${gb} rounded-xl px-2 py-1 text-[11px] font-medium`}>
                Cancel
              </button>
              <button onClick={deleteObj} className={`${gb} rounded-xl px-2 py-1 text-[11px] font-medium`}>
                Delete
              </button>
              <div className="relative">
                <button type="button" onClick={() => setShowSaveMenu((p) => !p)} className={`${pb} rounded-xl px-2 py-1 text-[11px] font-medium`}>
                  Save ▾
                </button>
                {showSaveMenu && (
                  <div className="absolute bottom-full right-0 mb-1 min-w-[140px] overflow-hidden rounded-xl border border-[#c0c0c0] bg-[#e0e0e0] shadow-[0_12px_30px_rgba(0,0,0,0.15)]">
                    <button
                      type="button"
                      onClick={() => saveChanges(false)}
                      className="block w-full px-3 py-2 text-left text-[11px] text-[#111] hover:bg-[#d5d5d5]"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => saveChanges(true)}
                      className="block w-full border-t border-[#d0d0d0] px-3 py-2 text-left text-[11px] text-[#111] hover:bg-[#d5d5d5]"
                    >
                      Save &amp; Continue
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Zoom + Compass ── */}
      <div
        className={`absolute z-30 flex flex-col items-center gap-2 transition-all duration-300 ${ctrlBot}`}
        style={{ left: `${blLeft}px` }}
      >
        <div className="flex flex-col items-center overflow-hidden rounded-[20px] border border-[#c0c0c0] bg-[#e0e0e0]/95 shadow-[0_10px_24px_rgba(0,0,0,0.12)] backdrop-blur-md">
          <button
            type="button"
            onClick={zoomIn}
            className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center border-b border-[#c0c0c0] text-sm sm:text-base font-bold text-[#111] hover:bg-[#d5d5d5] transition-all"
          >
            +
          </button>

          <div className="flex items-center justify-center px-1 py-1.5">
            <input
              type="range"
              min="1"
              max="20"
              value={zoomLevel}
              onChange={(e) => {
                const z = Number(e.target.value);
                setZoomLevel(z);
                mapRef.current?.setZoom(z);
              }}
              className="vertical-zoom-slider cursor-pointer appearance-none bg-transparent"
              style={{ writingMode: 'vertical-lr', direction: 'rtl', width: '7px', height: isMobile ? '42px' : '48px' }}
            />
          </div>

          <button
            type="button"
            onClick={zoomOut}
            className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center border-t border-[#c0c0c0] text-sm sm:text-base font-bold text-[#111] hover:bg-[#d5d5d5] transition-all"
          >
            −
          </button>
        </div>

        <div className="rounded-[20px] border border-[#c0c0c0] bg-[#e0e0e0]/95 p-1 shadow-[0_10px_24px_rgba(0,0,0,0.12)] backdrop-blur-md">
          <SmallCompass size={isMobile ? 44 : 48} />
        </div>
      </div>

      {/* ── Lat/Lon display ── */}
      <div
        className={`absolute z-30 rounded-2xl border border-[#c0c0c0] bg-[#e0e0e0]/95 px-2 py-1 sm:px-2.5 sm:py-1.5 text-[10px] sm:text-[11px] text-[#555] shadow-[0_10px_24px_rgba(0,0,0,0.12)] backdrop-blur-md transition-all duration-300 ${rightShift} ${llBot}`}
      >
        <span className="font-bold text-[#111]">Lat:</span> {latLon.lat.toFixed(4)} <span className="text-[#a0a0a0]">|</span>{' '}
        <span className="font-bold text-[#111]">Lon:</span> {latLon.lon.toFixed(4)}
      </div>

      {/* ── Bottom table panel ── */}
      {showBottomPanel && (
        <div
          className={`absolute bottom-0 left-0 right-0 z-40 border-t border-[#c0c0c0] bg-[#e0e0e0]/96 shadow-[0_-10px_30px_rgba(0,0,0,0.14)] backdrop-blur-md ${
            isMobile ? 'h-[30vh]' : 'h-[20vh] min-h-[140px] max-h-[190px]'
          }`}
        >
          <div className="flex items-center gap-1.5 border-b border-[#d0d0d0] bg-[#d5d5d5] px-2 py-1.5 flex-wrap">
            <div className="mr-auto shrink-0 truncate text-[12px] font-semibold text-[#111]">{selectedObjectItem || 'Objects'}</div>
            <select
              value={tableFilterMode}
              onChange={(e) => setTableFilterMode(e.target.value)}
              className="h-7 rounded-xl border border-[#c0c0c0] bg-[#e0e0e0] px-1.5 text-[11px] font-medium text-[#111] outline-none"
            >
              <option>By ID</option>
            </select>
            <input
              value={tableFilterInput}
              onChange={(e) => setTableFilterInput(e.target.value)}
              placeholder="Filter..."
              className="h-7 w-[80px] rounded-xl border border-[#c0c0c0] bg-[#e0e0e0] px-2 text-[11px] text-[#111] outline-none placeholder:text-[#888]"
            />
            <button type="button" onClick={() => setAppliedFilter(tableFilterInput)} className={`${pb} h-7 rounded-xl px-2.5 text-[11px] font-semibold`}>
              Run
            </button>
            <button type="button" onClick={downloadTable} className={`${gb} h-7 rounded-xl px-2.5 text-[11px] font-semibold`}>
              Download
            </button>
            <button onClick={() => setShowBottomPanel(false)} className={`${ib} h-7 w-7 rounded-xl text-xs font-bold`}>
              ↓
            </button>
          </div>

          <div className="h-[calc(100%-42px)] overflow-auto">
            <table className="min-w-full table-fixed text-[11px]">
              <thead className="sticky top-0 bg-[#d5d5d5]">
                <tr className="text-left text-[#111]">
                  {['ID', 'Type', 'Status', 'Owner', 'Material', 'Height', 'Municipality', 'Design ID'].map((h) => (
                    <th key={h} className="truncate whitespace-nowrap px-2 py-[5px] font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, idx) => (
                  <tr
                    key={row.key}
                    onClick={row.onClick}
                    className={`h-[24px] leading-none transition-colors ${
                      row.onClick ? 'cursor-pointer' : ''
                    } ${
                      row.selected
                        ? 'border-l-2 border-l-[#111] bg-[#d0d0d0]'
                        : idx % 2 === 0
                          ? 'bg-[#e0e0e0] hover:bg-[#d5d5d5]'
                          : 'bg-[#dcdcdc] hover:bg-[#d5d5d5]'
                    }`}
                  >
                    <td className="truncate px-2 py-[4px] font-medium text-[#111]">{row.id}</td>
                    <td className="truncate px-2 py-[4px] text-[#555]">{row.type}</td>
                    <td className="truncate px-2 py-[4px] text-[#555]">{row.status}</td>
                    <td className="truncate px-2 py-[4px] text-[#555]">{row.owner}</td>
                    <td className="truncate px-2 py-[4px] text-[#555]">{row.material}</td>
                    <td className="truncate px-2 py-[4px] text-[#555]">{row.height}</td>
                    <td className="truncate px-2 py-[4px] text-[#555]">{row.municipality}</td>
                    <td className="truncate px-2 py-[4px] text-[#555]">{row.designId}</td>
                  </tr>
                ))}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-4 text-center text-[11px] text-[#888]">
                      No records found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <style>{`
        .maplibregl-ctrl-bottom-left,
        .maplibregl-ctrl-bottom-right,
        .maplibregl-ctrl-top-left,
        .maplibregl-ctrl-top-right {
          display: none !important;
        }

        .vertical-zoom-slider::-webkit-slider-runnable-track {
          width: 5px;
          border-radius: 9999px;
          background: #c0c0c0;
        }

        .vertical-zoom-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 9999px;
          background: #111;
          border: 2px solid #e0e0e0;
          box-shadow: 0 2px 8px rgba(0,0,0,.24);
          margin-left: -4px;
        }

        .vertical-zoom-slider::-moz-range-track {
          width: 5px;
          border-radius: 9999px;
          background: #c0c0c0;
        }

        .vertical-zoom-slider::-moz-range-thumb {
          width: 12px;
          height: 12px;
          border-radius: 9999px;
          background: #111;
          border: 2px solid #e0e0e0;
          box-shadow: 0 2px 8px rgba(0,0,0,.24);
        }

        .maplibregl-canvas {
          outline: none;
        }

        .maplibregl-popup-content {
          padding: 0 !important;
          border-radius: 12px !important;
          overflow: hidden;
          box-shadow: 0 8px 22px rgba(0,0,0,0.18) !important;
          background-color: #e0e0e0 !important;
        }

        .maplibregl-popup-tip {
          border-top-color: #e0e0e0 !important;
          border-bottom-color: #e0e0e0 !important;
        }
      `}</style>
    </div>
  );
}















// 'use client';

// import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
// import maplibregl from 'maplibre-gl';
// import 'maplibre-gl/dist/maplibre-gl.css';

// type Attribute = { field: string; value: string };
// type Pole = { id: string; lat: number; lon: number; attributes: Attribute[] };
// type ActiveTab = 'Details' | 'Layers';
// type ExpandedGroups = { Segment: boolean; 'Distribution Structure': boolean; Equipment: boolean };
// type ActiveTool = 'Locate' | 'Select' | 'Draw' | 'Measure' | 'Plugins' | null;
// type DrawGeometry = 'point' | 'line' | 'polygon';
// type BottomRow = {
//   key: string;
//   id: string;
//   type: string;
//   status: string;
//   owner: string;
//   material: string;
//   height: string;
//   municipality: string;
//   designId: string;
//   onClick?: () => void;
//   selected?: boolean;
// };

// // ─── Replace with your real Google Map Tiles API URLs ───────────────────────
// const GOOGLE_ROAD_TILES_URL = '';
// const GOOGLE_SAT_TILES_URL = '';
// const OSM_TILES = ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'];
// const OSM_ATTR = '© OpenStreetMap contributors';

// // Default center — Quezon City, Philippines
// const DEFAULT_CENTER: [number, number] = [121.1866, 14.5943];
// const DEFAULT_ZOOM = 15;

// function makeRasterStyle(
//   tiles: string[],
//   src: string,
//   attr: string,
//   night = false
// ): maplibregl.StyleSpecification {
//   return {
//     version: 8,
//     glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
//     sources: {
//       [src]: {
//         type: 'raster',
//         tiles,
//         tileSize: 256,
//         attribution: attr,
//         maxzoom: 22,
//       },
//     },
//     layers: [
//       {
//         id: `${src}-tiles`,
//         type: 'raster',
//         source: src,
//         minzoom: 0,
//         maxzoom: 24,
//         paint: night
//           ? {
//               'raster-brightness-max': 0.42,
//               'raster-saturation': -0.9,
//               'raster-contrast': 0.28,
//             }
//           : {},
//       },
//     ],
//   };
// }

// function getBaseMapStyle(baseMap: string, isNight: boolean): maplibregl.StyleSpecification {
//   if (baseMap === 'Google') {
//     const t = GOOGLE_ROAD_TILES_URL ? [GOOGLE_ROAD_TILES_URL] : OSM_TILES;
//     return makeRasterStyle(t, 'basemap', GOOGLE_ROAD_TILES_URL ? 'Google' : OSM_ATTR, isNight);
//   }
//   if (baseMap === 'Google Satellite') {
//     const t = GOOGLE_SAT_TILES_URL ? [GOOGLE_SAT_TILES_URL] : OSM_TILES;
//     return makeRasterStyle(t, 'basemap', GOOGLE_SAT_TILES_URL ? 'Google' : OSM_ATTR, isNight);
//   }
//   return makeRasterStyle(OSM_TILES, 'basemap', OSM_ATTR, isNight);
// }

// const PLUGINS = [
//   { id: 'minimap', label: 'Mini Map', desc: 'Live overview minimap' },
//   { id: 'heatmap', label: 'Heatmap', desc: 'Density heatmap on poles' },
//   { id: 'export', label: 'Export PNG', desc: 'Download map as PNG' },
//   { id: 'fullscreen', label: 'Fullscreen', desc: 'Toggle fullscreen mode' },
//   { id: 'geoloc', label: 'Geolocate Me', desc: 'Fly to your GPS location' },
//   { id: 'grid', label: 'Grid Overlay', desc: 'Lat/lon grid overlay' },
//   { id: 'nightmode', label: 'Night Mode', desc: 'Dark desaturated map' },
//   { id: 'cluster', label: 'Cluster Poles', desc: 'Group nearby poles' },
// ];

// function haversineKm(la1: number, lo1: number, la2: number, lo2: number) {
//   const R = 6371;
//   const dLa = ((la2 - la1) * Math.PI) / 180;
//   const dLo = ((lo2 - lo1) * Math.PI) / 180;
//   const a =
//     Math.sin(dLa / 2) ** 2 +
//     Math.cos((la1 * Math.PI) / 180) *
//       Math.cos((la2 * Math.PI) / 180) *
//       Math.sin(dLo / 2) ** 2;
//   return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
// }

// // Sample poles — [lon, lat] for MapLibre
// const POLES: Pole[] = [
//   {
//     id: 'PL-00231',
//     lat: 14.5943,
//     lon: 121.1866,
//     attributes: [
//       { field: 'asset_id', value: 'PL-00231' },
//       { field: 'feature_type', value: 'Pole' },
//       { field: 'status', value: 'Active' },
//       { field: 'owner', value: 'Utility Network' },
//       { field: 'material', value: 'Concrete' },
//       { field: 'height_m', value: '10.5' },
//       { field: 'municipality', value: 'Quezon City' },
//       { field: 'design_id', value: 'DSN-1045' },
//     ],
//   },
//   {
//     id: 'PL-00232',
//     lat: 14.5951,
//     lon: 121.1882,
//     attributes: [
//       { field: 'asset_id', value: 'PL-00232' },
//       { field: 'feature_type', value: 'Pole' },
//       { field: 'status', value: 'Active' },
//       { field: 'owner', value: 'City Grid' },
//       { field: 'material', value: 'Steel' },
//       { field: 'height_m', value: '11.0' },
//       { field: 'municipality', value: 'Quezon City' },
//       { field: 'design_id', value: 'DSN-1046' },
//     ],
//   },
//   {
//     id: 'PL-00233',
//     lat: 14.5928,
//     lon: 121.1848,
//     attributes: [
//       { field: 'asset_id', value: 'PL-00233' },
//       { field: 'feature_type', value: 'Pole' },
//       { field: 'status', value: 'Proposed' },
//       { field: 'owner', value: 'Utility Network' },
//       { field: 'material', value: 'Concrete' },
//       { field: 'height_m', value: '9.8' },
//       { field: 'municipality', value: 'Quezon City' },
//       { field: 'design_id', value: 'DSN-1047' },
//     ],
//   },
//   {
//     id: 'PL-00234',
//     lat: 14.5964,
//     lon: 121.1854,
//     attributes: [
//       { field: 'asset_id', value: 'PL-00234' },
//       { field: 'feature_type', value: 'Pole' },
//       { field: 'status', value: 'Inactive' },
//       { field: 'owner', value: 'North Utility' },
//       { field: 'material', value: 'Wood' },
//       { field: 'height_m', value: '8.9' },
//       { field: 'municipality', value: 'Quezon City' },
//       { field: 'design_id', value: 'DSN-1048' },
//     ],
//   },
//   {
//     id: 'PL-00235',
//     lat: 14.5936,
//     lon: 121.1902,
//     attributes: [
//       { field: 'asset_id', value: 'PL-00235' },
//       { field: 'feature_type', value: 'Pole' },
//       { field: 'status', value: 'Active' },
//       { field: 'owner', value: 'Metro Utility' },
//       { field: 'material', value: 'Steel' },
//       { field: 'height_m', value: '12.1' },
//       { field: 'municipality', value: 'Quezon City' },
//       { field: 'design_id', value: 'DSN-1049' },
//     ],
//   },
// ];

// function buildGrid() {
//   const features: any[] = [];
//   for (let la = -80; la <= 80; la += 5) {
//     features.push({
//       type: 'Feature',
//       geometry: { type: 'LineString', coordinates: [[-180, la], [180, la]] },
//       properties: {},
//     });
//   }
//   for (let lo = -180; lo <= 180; lo += 5) {
//     features.push({
//       type: 'Feature',
//       geometry: { type: 'LineString', coordinates: [[lo, -80], [lo, 80]] },
//       properties: {},
//     });
//   }
//   return { type: 'FeatureCollection' as const, features };
// }

// // ── Rounded icon system ─────────────────────────────────────────────────────
// const ToolShell = ({
//   active,
//   children,
// }: {
//   active?: boolean;
//   children: React.ReactNode;
// }) => (
//   <div
//     className={`flex h-full w-full items-center justify-center rounded-[14px] transition-all ${
//       active ? 'bg-[#111] text-white shadow-[0_6px_18px_rgba(0,0,0,0.22)]' : 'bg-transparent text-[#111]'
//     }`}
//   >
//     {children}
//   </div>
// );

// const IconHomePin = ({ active }: { active?: boolean }) => (
//   <ToolShell active={active}>
//     <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
//       <path
//         d="M12 21C12 21 18 15.4 18 10.2C18 6.78 15.31 4 12 4C8.69 4 6 6.78 6 10.2C6 15.4 12 21 12 21Z"
//         stroke={active ? 'white' : '#111'}
//         strokeWidth="1.8"
//       />
//       <circle cx="12" cy="10" r="2.4" fill={active ? 'white' : '#111'} />
//     </svg>
//   </ToolShell>
// );

// const IconSelect = ({ active }: { active?: boolean }) => (
//   <ToolShell active={active}>
//     <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
//       <path
//         d="M6 5H10M14 5H18M19 6V10M19 14V18M18 19H14M10 19H6M5 18V14M5 10V6"
//         stroke={active ? 'white' : '#111'}
//         strokeWidth="1.8"
//         strokeLinecap="round"
//       />
//       <rect
//         x="8.2"
//         y="8.2"
//         width="7.6"
//         height="7.6"
//         rx="1.4"
//         fill={active ? 'white' : '#111'}
//         opacity="0.9"
//       />
//     </svg>
//   </ToolShell>
// );

// const IconDraw = ({ active }: { active?: boolean }) => (
//   <ToolShell active={active}>
//     <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
//       <path
//         d="M5 18L17.7 5.3C18.09 4.91 18.72 4.91 19.11 5.3L20.7 6.89C21.09 7.28 21.09 7.91 20.7 8.3L8 21H5V18Z"
//         stroke={active ? 'white' : '#111'}
//         strokeWidth="1.7"
//         strokeLinejoin="round"
//       />
//       <path d="M14.5 8.5L17.5 11.5" stroke={active ? 'white' : '#111'} strokeWidth="1.7" />
//     </svg>
//   </ToolShell>
// );

// const IconMeasure = ({ active }: { active?: boolean }) => (
//   <ToolShell active={active}>
//     <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
//       <rect
//         x="5"
//         y="8"
//         width="14"
//         height="8"
//         rx="2"
//         stroke={active ? 'white' : '#111'}
//         strokeWidth="1.8"
//       />
//       <path
//         d="M8 10V12M11 10V11.4M14 10V12M17 10V11.4"
//         stroke={active ? 'white' : '#111'}
//         strokeWidth="1.6"
//         strokeLinecap="round"
//       />
//     </svg>
//   </ToolShell>
// );

// const IconPlugins = ({ active }: { active?: boolean }) => (
//   <ToolShell active={active}>
//     <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
//       <path
//         d="M9.2 7.5C9.2 6.12 10.32 5 11.7 5C13.08 5 14.2 6.12 14.2 7.5V8.1H16.6C18.15 8.1 19.4 9.35 19.4 10.9C19.4 12.45 18.15 13.7 16.6 13.7H15.8V16.5C15.8 17.88 14.68 19 13.3 19C11.92 19 10.8 17.88 10.8 16.5V13.7H8C6.45 13.7 5.2 12.45 5.2 10.9C5.2 9.35 6.45 8.1 8 8.1H9.2V7.5Z"
//         stroke={active ? 'white' : '#111'}
//         strokeWidth="1.7"
//         strokeLinejoin="round"
//       />
//     </svg>
//   </ToolShell>
// );

// const IconPoint = ({ active }: { active: boolean }) => (
//   <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
//     <circle cx="12" cy="12" r="7.4" fill={active ? 'white' : '#111'} />
//     <circle cx="12" cy="12" r="3.4" fill={active ? '#111' : 'white'} />
//   </svg>
// );

// const IconLine = ({ active }: { active: boolean }) => (
//   <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
//     <circle cx="5" cy="19" r="2.8" fill={active ? 'white' : '#111'} />
//     <circle cx="19" cy="5" r="2.8" fill={active ? 'white' : '#111'} />
//     <path
//       d="M6.8 17.2L17.2 6.8"
//       stroke={active ? 'white' : '#111'}
//       strokeWidth="2"
//       strokeLinecap="round"
//     />
//   </svg>
// );

// const IconPolygon = ({ active }: { active: boolean }) => (
//   <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
//     <polygon
//       points="12,3 21,18.5 3,18.5"
//       fill={active ? 'rgba(255,255,255,0.18)' : 'rgba(17,17,17,0.08)'}
//       stroke={active ? 'white' : '#111'}
//       strokeWidth="1.8"
//       strokeLinejoin="round"
//     />
//     <circle cx="12" cy="3" r="2" fill={active ? 'white' : '#111'} />
//     <circle cx="21" cy="18.5" r="2" fill={active ? 'white' : '#111'} />
//     <circle cx="3" cy="18.5" r="2" fill={active ? 'white' : '#111'} />
//   </svg>
// );

// export default function GISUiMapLibre() {
//   // ── Refs ──────────────────────────────────────────────────────────────────
//   const mapContainerRef = useRef<HTMLDivElement | null>(null);
//   const mapRef = useRef<maplibregl.Map | null>(null);
//   const mapReadyRef = useRef(false);
//   const openPoleRef = useRef<(p: Pole) => void>(() => {});
//   const minimapContainerRef = useRef<HTMLDivElement | null>(null);
//   const minimapRef = useRef<maplibregl.Map | null>(null);
//   const drawPtsRef = useRef<[number, number][]>([]);
//   const rulerPtsRef = useRef<[number, number][]>([]);
//   const rulerMarkersRef = useRef<maplibregl.Marker[]>([]);
//   const rulerPopupRef = useRef<maplibregl.Popup | null>(null);
//   const activeToolRef = useRef<ActiveTool>(null);
//   const drawGeomRef = useRef<DrawGeometry>('point');
//   const initializedRef = useRef(false);
//   const minimapBoxMarkerRef = useRef<maplibregl.Marker | null>(null);

//   const poleClickHandlerRef = useRef<((e: maplibregl.MapLayerMouseEvent) => void) | null>(null);
//   const poleMouseEnterRef = useRef<(() => void) | null>(null);
//   const poleMouseLeaveRef = useRef<(() => void) | null>(null);
//   const clusterClickHandlerRef = useRef<((e: maplibregl.MapLayerMouseEvent) => void) | null>(null);
//   const unclusterClickHandlerRef = useRef<((e: maplibregl.MapLayerMouseEvent) => void) | null>(null);

//   // ── State ─────────────────────────────────────────────────────────────────
//   const [isMobile, setIsMobile] = useState(false);
//   const [zoomLevel, setZoomLevel] = useState(DEFAULT_ZOOM);
//   const [latLon, setLatLon] = useState({ lat: DEFAULT_CENTER[1], lon: DEFAULT_CENTER[0] });
//   const [compassAngle, setCompassAngle] = useState(0);
//   const [selectedBaseMap, setSelectedBaseMap] = useState('OSM');
//   const [showBaseMapDrop, setShowBaseMapDrop] = useState(false);
//   const [activeTool, setActiveTool] = useState<ActiveTool>(null);
//   const [showTopMenu, setShowTopMenu] = useState(false);
//   const [activePlugins, setActivePlugins] = useState<Record<string, boolean>>({});
//   const [showDrawPopup, setShowDrawPopup] = useState(false);
//   const [drawGeometry, setDrawGeometry] = useState<DrawGeometry>('point');
//   const [showOC, setShowOC] = useState(false);
//   const [expandedGroups, setExpandedGroups] = useState<ExpandedGroups>({
//     Segment: false,
//     'Distribution Structure': false,
//     Equipment: false,
//   });
//   const [selectedObjectItem, setSelectedObjectItem] = useState('');
//   const [activeTab, setActiveTab] = useState<ActiveTab>('Details');
//   const [isEditing, setIsEditing] = useState(false);
//   const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
//   const [attributes, setAttributes] = useState<Attribute[]>([]);
//   const [draftAttributes, setDraftAttributes] = useState<Attribute[]>([]);
//   const [showSaveMenu, setShowSaveMenu] = useState(false);
//   const [showBottomPanel, setShowBottomPanel] = useState(false);
//   const [tableFilterMode, setTableFilterMode] = useState('By ID');
//   const [tableFilterInput, setTableFilterInput] = useState('');
//   const [appliedFilter, setAppliedFilter] = useState('');
//   const [drawCount, setDrawCount] = useState(0);
//   const [measureTotal, setMeasureTotal] = useState<number | null>(null);
//   const [drawFinished, setDrawFinished] = useState(false);
//   const [searchText, setSearchText] = useState('');
//   const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({
//     Pole: true,
//     Substation: true,
//     Cabinate: true,
//     Cable: true,
//   });

//   useEffect(() => {
//     activeToolRef.current = activeTool;
//   }, [activeTool]);

//   useEffect(() => {
//     drawGeomRef.current = drawGeometry;
//   }, [drawGeometry]);

//   useEffect(() => {
//     const check = () => setIsMobile(window.innerWidth < 640);
//     check();
//     window.addEventListener('resize', check);
//     return () => window.removeEventListener('resize', check);
//   }, []);

//   const getPoleValue = useCallback((pole: Pole, field: string) => {
//     return pole.attributes.find((a) => a.field === field)?.value || '';
//   }, []);

//   const openPole = useCallback((pole: Pole) => {
//     setSelectedObjectItem('Pole');
//     setSelectedObjectId(pole.id);
//     setAttributes(pole.attributes.map((i) => ({ ...i })));
//     setDraftAttributes(pole.attributes.map((i) => ({ ...i })));
//     setIsEditing(false);
//     setShowSaveMenu(false);
//     if (window.innerWidth < 640) setShowOC(false);
//   }, []);
//   useEffect(() => {
//     openPoleRef.current = openPole;
//   }, [openPole]);

//   const updateMinimapViewport = useCallback(() => {
//     const map = mapRef.current;
//     const mm = minimapRef.current;
//     if (!map || !mm) return;

//     const center = map.getCenter();
//     mm.jumpTo({ center, zoom: Math.max(0, map.getZoom() - 4), bearing: 0, pitch: 0 });

//     const box = document.createElement('div');
//     box.style.width = '26px';
//     box.style.height = '18px';
//     box.style.border = '2px solid #111';
//     box.style.borderRadius = '5px';
//     box.style.background = 'rgba(255,255,255,0.18)';
//     box.style.boxShadow = '0 1px 4px rgba(0,0,0,0.25)';

//     if (minimapBoxMarkerRef.current) minimapBoxMarkerRef.current.remove();
//     minimapBoxMarkerRef.current = new maplibregl.Marker({
//       element: box,
//       anchor: 'center',
//     })
//       .setLngLat(center)
//       .addTo(mm);
//   }, []);

//   const removeLayerHandlers = useCallback((map: maplibregl.Map) => {
//     try {
//       if (poleClickHandlerRef.current) map.off('click', 'poles-hit', poleClickHandlerRef.current);
//     } catch {}
//     try {
//       if (poleMouseEnterRef.current) map.off('mouseenter', 'poles-hit', poleMouseEnterRef.current);
//     } catch {}
//     try {
//       if (poleMouseLeaveRef.current) map.off('mouseleave', 'poles-hit', poleMouseLeaveRef.current);
//     } catch {}
//     try {
//       if (clusterClickHandlerRef.current) map.off('click', 'cluster-circles', clusterClickHandlerRef.current);
//     } catch {}
//     try {
//       if (unclusterClickHandlerRef.current) map.off('click', 'cluster-unclustered', unclusterClickHandlerRef.current);
//     } catch {}
//   }, []);

//   const addPoleMarkers = useCallback(
//     (map: maplibregl.Map) => {
//       const sourceId = 'poles-src';
//       const layerId = 'poles-layer';
//       const hitId = 'poles-hit';

//       removeLayerHandlers(map);

//       if (map.getLayer(hitId)) map.removeLayer(hitId);
//       if (map.getLayer(layerId)) map.removeLayer(layerId);
//       if (map.getSource(sourceId)) map.removeSource(sourceId);

//       map.addSource(sourceId, {
//         type: 'geojson',
//         data: {
//           type: 'FeatureCollection',
//           features: POLES.map((p) => ({
//             type: 'Feature' as const,
//             geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
//             properties: { id: p.id },
//           })),
//         },
//       });

//       map.addLayer({
//         id: layerId,
//         type: 'circle',
//         source: sourceId,
//         paint: {
//           'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 18, 10],
//           'circle-color': '#111111',
//           'circle-stroke-width': 2.5,
//           'circle-stroke-color': '#ffffff',
//           'circle-opacity': 1,
//         },
//       });

//       map.addLayer({
//         id: hitId,
//         type: 'circle',
//         source: sourceId,
//         paint: {
//           'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 14, 18, 22],
//           'circle-color': 'rgba(0,0,0,0)',
//           'circle-opacity': 0,
//         },
//       });

//       poleMouseEnterRef.current = () => {
//         map.getCanvas().style.cursor = 'pointer';
//       };

//       poleMouseLeaveRef.current = () => {
//         const tool = activeToolRef.current;
//         map.getCanvas().style.cursor = tool
//           ? tool === 'Locate'
//             ? 'crosshair'
//             : tool === 'Select'
//               ? 'pointer'
//               : tool === 'Draw'
//                 ? 'crosshair'
//                 : tool === 'Measure'
//                   ? 'crosshair'
//                   : 'default'
//           : 'default';
//       };

//       poleClickHandlerRef.current = (e: maplibregl.MapLayerMouseEvent) => {
//         e.preventDefault();
//         const feat = e.features?.[0];
//         if (!feat) return;
//         const pid = feat.properties?.id as string;
//         const pole = POLES.find((p) => p.id === pid);
//         if (pole) openPoleRef.current(pole);
//       };

//       map.on('mouseenter', hitId, poleMouseEnterRef.current);
//       map.on('mouseleave', hitId, poleMouseLeaveRef.current);
//       map.on('click', hitId, poleClickHandlerRef.current);
//     },
//     [removeLayerHandlers]
//   );

//   const setDrawData = useCallback(
//     (map: maplibregl.Map, pts: [number, number][], geom: DrawGeometry) => {
//       const ptF = pts.map(([x, y]) => ({
//         type: 'Feature',
//         geometry: { type: 'Point', coordinates: [x, y] },
//         properties: {},
//       }));
//       const liF =
//         (geom === 'line' || geom === 'polygon') && pts.length >= 2
//           ? [
//               {
//                 type: 'Feature',
//                 geometry: {
//                   type: 'LineString',
//                   coordinates: geom === 'polygon' && drawFinished ? [...pts, pts[0]] : pts,
//                 },
//                 properties: {},
//               },
//             ]
//           : [];
//       const pgF =
//         geom === 'polygon' && pts.length >= 3 && drawFinished
//           ? [
//               {
//                 type: 'Feature',
//                 geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]]] },
//                 properties: {},
//               },
//             ]
//           : [];

//       try {
//         (map.getSource('draw-pts-src') as maplibregl.GeoJSONSource)?.setData({
//           type: 'FeatureCollection',
//           features: ptF as any,
//         });
//         (map.getSource('draw-ln-src') as maplibregl.GeoJSONSource)?.setData({
//           type: 'FeatureCollection',
//           features: liF as any,
//         });
//         (map.getSource('draw-pg-src') as maplibregl.GeoJSONSource)?.setData({
//           type: 'FeatureCollection',
//           features: pgF as any,
//         });
//       } catch {}
//     },
//     [drawFinished]
//   );

//   const addOverlaySources = useCallback((map: maplibregl.Map) => {
//     const addIfMissing = (id: string, cb: () => void) => {
//       if (!map.getSource(id)) cb();
//     };

//     addIfMissing('draw-pts-src', () => {
//       map.addSource('draw-pts-src', {
//         type: 'geojson',
//         data: { type: 'FeatureCollection', features: [] },
//       });
//       map.addLayer({
//         id: 'draw-pts-layer',
//         type: 'circle',
//         source: 'draw-pts-src',
//         paint: {
//           'circle-radius': 5.5,
//           'circle-color': '#111',
//           'circle-stroke-width': 2,
//           'circle-stroke-color': '#fff',
//         },
//       });
//     });

//     addIfMissing('draw-ln-src', () => {
//       map.addSource('draw-ln-src', {
//         type: 'geojson',
//         data: { type: 'FeatureCollection', features: [] },
//       });
//       map.addLayer({
//         id: 'draw-ln-layer',
//         type: 'line',
//         source: 'draw-ln-src',
//         paint: {
//           'line-color': '#111',
//           'line-width': 2.5,
//           'line-dasharray': [3, 2],
//         },
//       });
//     });

//     addIfMissing('draw-pg-src', () => {
//       map.addSource('draw-pg-src', {
//         type: 'geojson',
//         data: { type: 'FeatureCollection', features: [] },
//       });
//       map.addLayer({
//         id: 'draw-pg-layer',
//         type: 'fill',
//         source: 'draw-pg-src',
//         paint: {
//           'fill-color': '#111',
//           'fill-opacity': 0.18,
//         },
//       });
//     });

//     addIfMissing('ruler-src', () => {
//       map.addSource('ruler-src', {
//         type: 'geojson',
//         data: { type: 'FeatureCollection', features: [] },
//       });
//       map.addLayer({
//         id: 'ruler-layer',
//         type: 'line',
//         source: 'ruler-src',
//         paint: {
//           'line-color': '#e11d48',
//           'line-width': 2.5,
//           'line-dasharray': [4, 2],
//         },
//       });
//     });

//     addIfMissing('grid-src', () => {
//       map.addSource('grid-src', { type: 'geojson', data: buildGrid() });
//       map.addLayer({
//         id: 'grid-layer',
//         type: 'line',
//         source: 'grid-src',
//         paint: {
//           'line-color': 'rgba(0,0,0,0.18)',
//           'line-width': 0.7,
//         },
//         layout: { visibility: 'none' },
//       });
//     });

//     addIfMissing('heatmap-src', () => {
//       map.addSource('heatmap-src', {
//         type: 'geojson',
//         data: {
//           type: 'FeatureCollection',
//           features: POLES.map((p) => ({
//             type: 'Feature' as const,
//             geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
//             properties: {},
//           })),
//         },
//       });
//       map.addLayer({
//         id: 'heatmap-layer',
//         type: 'heatmap',
//         source: 'heatmap-src',
//         paint: {
//           'heatmap-weight': 1,
//           'heatmap-intensity': 2,
//           'heatmap-color': [
//             'interpolate',
//             ['linear'],
//             ['heatmap-density'],
//             0,
//             'rgba(0,0,255,0)',
//             0.2,
//             'rgba(0,200,255,0.6)',
//             0.5,
//             'rgba(0,220,80,0.8)',
//             0.8,
//             'rgba(255,220,0,0.9)',
//             1,
//             'rgba(255,40,0,1)',
//           ],
//           'heatmap-radius': 50,
//           'heatmap-opacity': 0,
//         },
//       });
//     });

//     addIfMissing('cluster-src', () => {
//       map.addSource('cluster-src', {
//         type: 'geojson',
//         cluster: true,
//         clusterMaxZoom: 14,
//         clusterRadius: 50,
//         data: {
//           type: 'FeatureCollection',
//           features: POLES.map((p) => ({
//             type: 'Feature' as const,
//             geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
//             properties: { id: p.id },
//           })),
//         },
//       });

//       map.addLayer({
//         id: 'cluster-circles',
//         type: 'circle',
//         source: 'cluster-src',
//         filter: ['has', 'point_count'],
//         paint: {
//           'circle-color': '#111',
//           'circle-radius': 18,
//           'circle-stroke-width': 2,
//           'circle-stroke-color': '#fff',
//         },
//         layout: { visibility: 'none' },
//       });

//       map.addLayer({
//         id: 'cluster-count',
//         type: 'symbol',
//         source: 'cluster-src',
//         filter: ['has', 'point_count'],
//         layout: {
//           'text-field': '{point_count_abbreviated}',
//           'text-size': 12,
//           visibility: 'none',
//         },
//         paint: { 'text-color': '#fff' },
//       });

//       map.addLayer({
//         id: 'cluster-unclustered',
//         type: 'circle',
//         source: 'cluster-src',
//         filter: ['!', ['has', 'point_count']],
//         paint: {
//           'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 18, 10],
//           'circle-color': '#111111',
//           'circle-stroke-width': 2.5,
//           'circle-stroke-color': '#ffffff',
//         },
//         layout: { visibility: 'none' },
//       });

//       clusterClickHandlerRef.current = (e: maplibregl.MapLayerMouseEvent) => {
//         const f = e.features?.[0];
//         const src = map.getSource('cluster-src') as any;
//         const clusterId = f?.properties?.cluster_id;
//         if (!src || clusterId == null) return;
//         src.getClusterExpansionZoom(clusterId, (err: any, zoom: number) => {
//           if (err) return;
//           const c = (f?.geometry as any)?.coordinates;
//           if (c) map.easeTo({ center: c, zoom });
//         });
//       };

//       unclusterClickHandlerRef.current = (e: maplibregl.MapLayerMouseEvent) => {
//         e.preventDefault();
//         const feat = e.features?.[0];
//         if (!feat) return;
//         const pid = feat.properties?.id as string;
//         const pole = POLES.find((p) => p.id === pid);
//         if (pole) openPoleRef.current(pole);
//       };

//       map.on('click', 'cluster-circles', clusterClickHandlerRef.current);
//       map.on('click', 'cluster-unclustered', unclusterClickHandlerRef.current);
//     });
//   }, []);

//   const applyLayerVisibility = useCallback(
//     (map: maplibregl.Map, layerState: Record<string, boolean>, plugins: Record<string, boolean>) => {
//       const poleVisible = layerState['Pole'] !== false;
//       const clusterOn = !!plugins['cluster'];
//       const poleModeVisible = poleVisible && !clusterOn ? 'visible' : 'none';
//       const clusterModeVisible = poleVisible && clusterOn ? 'visible' : 'none';

//       try {
//         map.setLayoutProperty('poles-layer', 'visibility', poleModeVisible);
//       } catch {}
//       try {
//         map.setLayoutProperty('poles-hit', 'visibility', poleModeVisible);
//       } catch {}
//       try {
//         map.setLayoutProperty('cluster-circles', 'visibility', clusterModeVisible);
//       } catch {}
//       try {
//         map.setLayoutProperty('cluster-count', 'visibility', clusterModeVisible);
//       } catch {}
//       try {
//         map.setLayoutProperty('cluster-unclustered', 'visibility', clusterModeVisible);
//       } catch {}
//       try {
//         map.setPaintProperty(
//           'heatmap-layer',
//           'heatmap-opacity',
//           poleVisible && plugins['heatmap'] ? 0.75 : 0
//         );
//       } catch {}
//     },
//     []
//   );

//   const applyPluginVisuals = useCallback(
//     (map: maplibregl.Map, plugins: Record<string, boolean>, layers: Record<string, boolean>) => {
//       try {
//         map.setLayoutProperty('grid-layer', 'visibility', plugins['grid'] ? 'visible' : 'none');
//       } catch {}
//       applyLayerVisibility(map, layers, plugins);
//     },
//     [applyLayerVisibility]
//   );

//   useEffect(() => {
//     if (initializedRef.current || !mapContainerRef.current) return;
//     initializedRef.current = true;

//     const map = new maplibregl.Map({
//       container: mapContainerRef.current,
//       style: getBaseMapStyle('OSM', false),
//       center: DEFAULT_CENTER,
//       zoom: DEFAULT_ZOOM,
//       attributionControl: false,
//       preserveDrawingBuffer: true,
//     });

//     map.on('load', () => {
//       mapReadyRef.current = true;
//       map.resize();
//       addOverlaySources(map);
//       addPoleMarkers(map);
//       applyPluginVisuals(map, activePlugins, layerVisibility);
//       map.jumpTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM });
//     });

//     map.on('move', () => {
//       const c = map.getCenter();
//       setLatLon({ lat: c.lat, lon: c.lng });
//       updateMinimapViewport();
//     });

//     map.on('zoom', () => {
//       setZoomLevel(Math.round(map.getZoom()));
//       updateMinimapViewport();
//     });

//     map.on('rotate', () => setCompassAngle(map.getBearing()));

//     map.on('click', (e) => {
//       const lng = e.lngLat.lng;
//       const lat = e.lngLat.lat;
//       const tool = activeToolRef.current;
//       const geom = drawGeomRef.current;

//       if ((e as any).defaultPrevented) return;

//       if (tool === 'Draw') {
//         if (drawFinished) return;
//         const pts = geom === 'point' ? [[lng, lat] as [number, number]] : [...drawPtsRef.current, [lng, lat]];
//         drawPtsRef.current = pts;
//         setDrawCount(pts.length);
//         if (mapReadyRef.current) setDrawData(map, pts, geom);
//         return;
//       }

//       if (tool === 'Measure') {
//         const pts = [...rulerPtsRef.current, [lng, lat] as [number, number]];
//         rulerPtsRef.current = pts;

//         if (mapReadyRef.current && pts.length >= 2) {
//           try {
//             (map.getSource('ruler-src') as maplibregl.GeoJSONSource)?.setData({
//               type: 'FeatureCollection',
//               features: [
//                 {
//                   type: 'Feature',
//                   geometry: { type: 'LineString', coordinates: pts },
//                   properties: {},
//                 },
//               ],
//             });
//           } catch {}

//           let dist = 0;
//           for (let i = 1; i < pts.length; i++) {
//             dist += haversineKm(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]);
//           }
//           setMeasureTotal(dist);

//           rulerPopupRef.current?.remove();
//           rulerPopupRef.current = new maplibregl.Popup({ closeButton: false, offset: 10 })
//             .setLngLat([lng, lat])
//             .setHTML(
//               `<div style="font:bold 12px sans-serif;padding:6px 10px;color:#111;">${
//                 dist < 1 ? `${(dist * 1000).toFixed(0)} m` : `${dist.toFixed(3)} km`
//               }</div>`
//             )
//             .addTo(map);
//         }

//         const el = document.createElement('div');
//         el.style.cssText =
//           'width:10px;height:10px;border-radius:9999px;background:#e11d48;border:2px solid #fff;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.22);';
//         rulerMarkersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map));
//       }
//     });

//     const onResize = () => {
//       map.resize();
//       minimapRef.current?.resize();
//       updateMinimapViewport();
//     };

//     window.addEventListener('resize', onResize);
//     mapRef.current = map;

//     return () => {
//       window.removeEventListener('resize', onResize);
//       removeLayerHandlers(map);
//       minimapRef.current?.remove();
//       minimapRef.current = null;
//       minimapBoxMarkerRef.current?.remove();
//       minimapBoxMarkerRef.current = null;
//       map.remove();
//       mapRef.current = null;
//       mapReadyRef.current = false;
//       initializedRef.current = false;
//     };
//   }, [addOverlaySources, addPoleMarkers, applyPluginVisuals, layerVisibility, activePlugins, removeLayerHandlers, setDrawData, updateMinimapViewport]);

//   useEffect(() => {
//     const map = mapRef.current;
//     if (!map) return;

//     const center = map.getCenter();
//     const zoom = map.getZoom();
//     const bearing = map.getBearing();

//     mapReadyRef.current = false;
//     map.setStyle(getBaseMapStyle(selectedBaseMap, !!activePlugins['nightmode']));

//     map.once('style.load', () => {
//       mapReadyRef.current = true;
//       addOverlaySources(map);
//       addPoleMarkers(map);
//       applyPluginVisuals(map, activePlugins, layerVisibility);
//       setDrawData(map, drawPtsRef.current, drawGeomRef.current);
//       map.jumpTo({ center, zoom, bearing });
//       map.resize();
//       updateMinimapViewport();
//     });
//   }, [selectedBaseMap, activePlugins, addOverlaySources, addPoleMarkers, applyPluginVisuals, layerVisibility, setDrawData, updateMinimapViewport]);

//   useEffect(() => {
//     const map = mapRef.current;
//     if (!map) return;
//     if (mapReadyRef.current) applyPluginVisuals(map, activePlugins, layerVisibility);

//     if (activePlugins['export']) {
//       setActivePlugins((p) => ({ ...p, export: false }));
//       map.once('idle', () => {
//         try {
//           const link = document.createElement('a');
//           link.href = map.getCanvas().toDataURL('image/png');
//           link.download = `gis-map-${Date.now()}.png`;
//           document.body.appendChild(link);
//           link.click();
//           document.body.removeChild(link);
//         } catch {
//           alert('Export failed.');
//         }
//       });
//     }

//     if (activePlugins['fullscreen']) {
//       setActivePlugins((p) => ({ ...p, fullscreen: false }));
//       if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
//       else document.exitFullscreen?.().catch(() => {});
//     }

//     if (activePlugins['geoloc']) {
//       setActivePlugins((p) => ({ ...p, geoloc: false }));
//       if (!navigator.geolocation) {
//         alert('Geolocation not supported.');
//         return;
//       }
//       navigator.geolocation.getCurrentPosition(
//         (pos) => {
//           const lng = pos.coords.longitude;
//           const lat = pos.coords.latitude;
//           map.flyTo({ center: [lng, lat], zoom: 16, essential: true });
//           new maplibregl.Popup({ closeButton: true, offset: 12 })
//             .setLngLat([lng, lat])
//             .setHTML('<div style="padding:6px 10px;font:12px sans-serif;color:#111;">📍 You are here</div>')
//             .addTo(map);
//         },
//         () => alert('Location access denied. Please allow location in browser settings.')
//       );
//     }

//     if (activePlugins['minimap']) {
//       if (!minimapRef.current && minimapContainerRef.current) {
//         const mm = new maplibregl.Map({
//           container: minimapContainerRef.current,
//           style: makeRasterStyle(OSM_TILES, 'mm-base', OSM_ATTR),
//           center: map.getCenter(),
//           zoom: Math.max(0, map.getZoom() - 4),
//           interactive: false,
//           attributionControl: false,
//         });
//         mm.on('load', () => {
//           mm.resize();
//           updateMinimapViewport();
//         });
//         minimapRef.current = mm;
//       } else {
//         updateMinimapViewport();
//       }
//     } else {
//       minimapBoxMarkerRef.current?.remove();
//       minimapBoxMarkerRef.current = null;
//       if (minimapRef.current) {
//         minimapRef.current.remove();
//         minimapRef.current = null;
//       }
//     }
//   }, [activePlugins, applyPluginVisuals, layerVisibility, updateMinimapViewport]);

//   useEffect(() => {
//     const map = mapRef.current;
//     if (!map || !mapReadyRef.current) return;
//     applyLayerVisibility(map, layerVisibility, activePlugins);
//   }, [layerVisibility, activePlugins, applyLayerVisibility]);

//   useEffect(() => {
//     const canvas = mapRef.current?.getCanvas();
//     if (!canvas) return;
//     const cursors: Record<string, string> = {
//       Locate: 'crosshair',
//       Select: 'pointer',
//       Draw: 'crosshair',
//       Measure: 'crosshair',
//       Plugins: 'default',
//     };
//     canvas.style.cursor = activeTool ? cursors[activeTool] || 'default' : 'default';
//   }, [activeTool]);

//   const zoomSyncRef = useRef(false);
//   useEffect(() => {
//     const map = mapRef.current;
//     if (!map) return;
//     if (zoomSyncRef.current) {
//       zoomSyncRef.current = false;
//       return;
//     }
//     if (Math.abs(map.getZoom() - zoomLevel) > 0.4) map.setZoom(zoomLevel);
//   }, [zoomLevel]);

//   useEffect(() => {
//     const map = mapRef.current;
//     if (!map) return;
//     const onZoom = () => {
//       zoomSyncRef.current = true;
//       setZoomLevel(Math.round(map.getZoom()));
//     };
//     map.on('zoom', onZoom);
//     return () => {
//       map.off('zoom', onZoom);
//     };
//   }, []);

//   const clearDraw = useCallback(() => {
//     drawPtsRef.current = [];
//     setDrawCount(0);
//     setDrawFinished(false);
//     try {
//       (mapRef.current?.getSource('draw-pts-src') as maplibregl.GeoJSONSource)?.setData({
//         type: 'FeatureCollection',
//         features: [],
//       });
//       (mapRef.current?.getSource('draw-ln-src') as maplibregl.GeoJSONSource)?.setData({
//         type: 'FeatureCollection',
//         features: [],
//       });
//       (mapRef.current?.getSource('draw-pg-src') as maplibregl.GeoJSONSource)?.setData({
//         type: 'FeatureCollection',
//         features: [],
//       });
//     } catch {}
//   }, []);

//   const clearMeasure = useCallback(() => {
//     rulerPtsRef.current = [];
//     setMeasureTotal(null);
//     rulerMarkersRef.current.forEach((m) => m.remove());
//     rulerMarkersRef.current = [];
//     rulerPopupRef.current?.remove();
//     rulerPopupRef.current = null;
//     try {
//       (mapRef.current?.getSource('ruler-src') as maplibregl.GeoJSONSource)?.setData({
//         type: 'FeatureCollection',
//         features: [],
//       });
//     } catch {}
//   }, []);

//   const saveDraw = useCallback(() => {
//     alert(`Saved ${drawCount} point(s) as ${drawGeomRef.current}`);
//     clearDraw();
//     setActiveTool(null);
//     setShowDrawPopup(false);
//   }, [drawCount, clearDraw]);

//   const runSearch = useCallback(() => {
//     const q = searchText.trim().toLowerCase();
//     if (!q) return;

//     const found = POLES.find((pole) => {
//       const allText = [
//         pole.id,
//         getPoleValue(pole, 'design_id'),
//         getPoleValue(pole, 'municipality'),
//         getPoleValue(pole, 'owner'),
//         getPoleValue(pole, 'status'),
//         getPoleValue(pole, 'material'),
//       ]
//         .join(' ')
//         .toLowerCase();
//       return allText.includes(q);
//     });

//     if (!found) {
//       alert('No matching object found.');
//       return;
//     }

//     mapRef.current?.flyTo({ center: [found.lon, found.lat], zoom: 18, essential: true });
//     openPole(found);
//     setSelectedObjectItem('Pole');
//     setShowBottomPanel(true);
//   }, [searchText, getPoleValue, openPole]);

//   const handleToolClick = (tool: ActiveTool) => {
//     if (tool === 'Locate') {
//       mapRef.current?.flyTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, essential: true });
//       setActiveTool(null);
//       setShowDrawPopup(false);
//       return;
//     }

//     if (tool === 'Draw') {
//       setActiveTool((prev) => (prev === 'Draw' ? null : 'Draw'));
//       setShowDrawPopup((prev) => (activeTool === 'Draw' ? !prev : true));
//       return;
//     }

//     if (tool === 'Plugins') {
//       setShowDrawPopup(false);
//       setActiveTool((prev) => (prev === 'Plugins' ? null : 'Plugins'));
//       return;
//     }

//     setShowDrawPopup(false);
//     setActiveTool((prev) => {
//       if (prev === tool) {
//         if (tool === 'Measure') clearMeasure();
//         return null;
//       }
//       if (prev === 'Measure') clearMeasure();
//       return tool;
//     });
//   };

//   const selectDrawType = (geom: DrawGeometry) => {
//     setDrawGeometry(geom);
//     drawGeomRef.current = geom;
//     clearDraw();
//     setActiveTool('Draw');
//     setShowDrawPopup(false);
//     setDrawFinished(false);
//   };

//   const togglePlugin = (id: string) => {
//     setActivePlugins((prev) => ({ ...prev, [id]: !prev[id] }));
//   };

//   const getPV = (pole: Pole, field: string) => pole.attributes.find((a) => a.field === field)?.value || '-';

//   const getLabel = () => {
//     const n = selectedObjectItem || 'Object';
//     return selectedObjectId ? `${n} (${selectedObjectId})` : n;
//   };

//   const getSelPole = () => POLES.find((p) => p.id === selectedObjectId) || null;

//   const zoomToSel = () => {
//     const p = getSelPole();
//     if (p) mapRef.current?.flyTo({ center: [p.lon, p.lat], zoom: 18, essential: true });
//   };

//   const startEditing = () => {
//     setDraftAttributes(attributes.map((i) => ({ ...i })));
//     setIsEditing(true);
//     setShowSaveMenu(false);
//   };

//   const cancelEditing = () => {
//     setDraftAttributes(attributes.map((i) => ({ ...i })));
//     setIsEditing(false);
//     setShowSaveMenu(false);
//   };

//   const handleDraft = (field: string, value: string) =>
//     setDraftAttributes((prev) => prev.map((i) => (i.field === field ? { ...i, value } : i)));

//   const saveChanges = (cont: boolean) => {
//     setAttributes(draftAttributes.map((i) => ({ ...i })));
//     setIsEditing(cont);
//     setShowSaveMenu(false);
//   };

//   const deleteObj = () => {
//     setSelectedObjectId(null);
//     setAttributes([]);
//     setDraftAttributes([]);
//     setIsEditing(false);
//     setShowSaveMenu(false);
//   };

//   const closeEditor = () => {
//     setSelectedObjectId(null);
//     setIsEditing(false);
//     setShowSaveMenu(false);
//   };

//   const zoomIn = () => {
//     const z = Math.min((mapRef.current?.getZoom() || zoomLevel) + 1, 20);
//     setZoomLevel(z);
//     mapRef.current?.setZoom(z);
//   };

//   const zoomOut = () => {
//     const z = Math.max((mapRef.current?.getZoom() || zoomLevel) - 1, 1);
//     setZoomLevel(z);
//     mapRef.current?.setZoom(z);
//   };

//   const toggleGroup = (g: keyof ExpandedGroups) =>
//     setExpandedGroups((prev) => ({ ...prev, [g]: !prev[g] }));

//   const createObjectData = (name: string) => {
//     const code = name.toUpperCase().slice(0, 2);
//     const oid = `${code}-001`;
//     const data: Attribute[] = [
//       { field: 'asset_id', value: oid },
//       { field: 'feature_type', value: name },
//       { field: 'status', value: 'Active' },
//       { field: 'owner', value: 'Utility Network' },
//       { field: 'material', value: name === 'Manhole' ? 'Concrete' : 'Steel' },
//       { field: 'municipality', value: 'Quezon City' },
//       { field: 'design_id', value: `${code}-1001` },
//     ];
//     setSelectedObjectItem(name);
//     setSelectedObjectId(oid);
//     setAttributes(data);
//     setDraftAttributes(data);
//     setIsEditing(false);
//     setShowSaveMenu(false);
//     if (isMobile) setShowOC(false);
//   };

//   const selectObjectItem = (name: string) => {
//     setSelectedObjectItem(name);
//     setShowBottomPanel(true);
//     setAppliedFilter('');
//     setTableFilterInput('');
//     if (name === 'Pole') {
//       setSelectedObjectId(null);
//       setAttributes([]);
//       setDraftAttributes([]);
//       setIsEditing(false);
//       setShowSaveMenu(false);
//       return;
//     }
//     createObjectData(name);
//   };

//   const bottomRows: BottomRow[] =
//     selectedObjectItem === 'Pole'
//       ? POLES.map((pole) => ({
//           key: pole.id,
//           id: pole.id,
//           type: getPV(pole, 'feature_type'),
//           status: getPV(pole, 'status'),
//           owner: getPV(pole, 'owner'),
//           material: getPV(pole, 'material'),
//           height: getPV(pole, 'height_m'),
//           municipality: getPV(pole, 'municipality'),
//           designId: getPV(pole, 'design_id'),
//           selected: selectedObjectId === pole.id,
//           onClick: () => openPole(pole),
//         }))
//       : selectedObjectItem === 'Manhole'
//         ? [
//             {
//               key: 'MH-001',
//               id: 'MH-001',
//               type: 'Manhole',
//               status: 'Active',
//               owner: 'Utility Network',
//               material: 'Concrete',
//               height: '-',
//               municipality: 'Quezon City',
//               designId: 'MH-2101',
//               selected: selectedObjectId === 'MH-001',
//               onClick: () => createObjectData('Manhole'),
//             },
//             {
//               key: 'MH-002',
//               id: 'MH-002',
//               type: 'Manhole',
//               status: 'Proposed',
//               owner: 'Utility Network',
//               material: 'Concrete',
//               height: '-',
//               municipality: 'Quezon City',
//               designId: 'MH-2102',
//             },
//           ]
//         : selectedObjectItem === 'Cabinate'
//           ? [
//               {
//                 key: 'CB-001',
//                 id: 'CB-001',
//                 type: 'Cabinate',
//                 status: 'Active',
//                 owner: 'Metro Utility',
//                 material: 'Steel',
//                 height: '-',
//                 municipality: 'Quezon City',
//                 designId: 'CB-3101',
//                 selected: selectedObjectId === 'CB-001',
//                 onClick: () => createObjectData('Cabinate'),
//               },
//               {
//                 key: 'CB-002',
//                 id: 'CB-002',
//                 type: 'Cabinate',
//                 status: 'Inactive',
//                 owner: 'Metro Utility',
//                 material: 'Steel',
//                 height: '-',
//                 municipality: 'Quezon City',
//                 designId: 'CB-3102',
//               },
//             ]
//           : [];

//   const filteredRows = useMemo(() => {
//     if (!appliedFilter.trim()) return bottomRows;
//     const q = appliedFilter.trim().toLowerCase();
//     return tableFilterMode === 'By ID' ? bottomRows.filter((r) => r.id.toLowerCase().includes(q)) : bottomRows;
//   }, [bottomRows, appliedFilter, tableFilterMode]);

//   const downloadTable = () => {
//     const headers = ['ID', 'Type', 'Status', 'Owner', 'Material', 'Height', 'Municipality', 'Design ID'];
//     const csv = [headers, ...filteredRows.map((r) => [r.id, r.type, r.status, r.owner, r.material, r.height, r.municipality, r.designId])]
//       .map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
//       .join('\n');

//     const a = document.createElement('a');
//     a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
//     a.download = `${selectedObjectItem || 'objects'}-table.csv`;
//     a.click();
//   };

//   const ocW = showOC ? (isMobile ? Math.min(window.innerWidth * 0.3, 140) : 250) : 0;
//   const tlLeft = showOC ? ocW + 12 : 12;
//   const blLeft = showOC ? ocW + 12 : 12;
//   const rightShift = !isMobile && selectedObjectId ? 'right-[332px]' : 'right-3 sm:right-4';
//   const ctrlBot = isMobile
//     ? selectedObjectId
//       ? 'bottom-[calc(50vh+10px)]'
//       : showBottomPanel
//         ? 'bottom-[calc(30vh+8px)]'
//         : 'bottom-3'
//     : showBottomPanel
//       ? 'bottom-[calc(20vh+8px)]'
//       : 'bottom-4';
//   const llBot = isMobile
//     ? selectedObjectId
//       ? 'bottom-[calc(50vh+14px)]'
//       : showBottomPanel
//         ? 'bottom-[calc(30vh+10px)]'
//         : 'bottom-3'
//     : showBottomPanel
//       ? 'bottom-[calc(20vh+8px)]'
//       : 'bottom-4';

//   const ib =
//     'flex items-center justify-center border border-[#d6d6d6] bg-[#f5f5f5]/96 text-[#111] shadow-[0_6px_18px_rgba(0,0,0,0.10)] backdrop-blur-md transition-all hover:bg-white active:scale-[0.98]';
//   const pb = 'border border-[#111] bg-[#111] text-white hover:bg-[#262626] transition-all';
//   const gb = 'border border-[#d0d0d0] bg-[#f3f3f3] text-[#111] hover:bg-white transition-all';

//   const tools = [
//     { label: 'Locate' as ActiveTool, Icon: IconHomePin },
//     { label: 'Select' as ActiveTool, Icon: IconSelect },
//     { label: 'Draw' as ActiveTool, Icon: IconDraw },
//     { label: 'Measure' as ActiveTool, Icon: IconMeasure },
//     { label: 'Plugins' as ActiveTool, Icon: IconPlugins },
//   ];

//   const LayersIcon = () => (
//     <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
//       <path
//         d="M8 1L15 5L8 9L1 5L8 1Z"
//         stroke="currentColor"
//         strokeWidth="1.3"
//         strokeLinejoin="round"
//         fill="none"
//       />
//       <path
//         d="M1 9L8 13L15 9"
//         stroke="currentColor"
//         strokeWidth="1.3"
//         strokeLinecap="round"
//         strokeLinejoin="round"
//       />
//     </svg>
//   );

//   const SmallCompass = ({ size = 48 }: { size?: number }) => (
//     <svg
//       width={size}
//       height={size}
//       viewBox="0 0 54 54"
//       style={{
//         transform: `rotate(${-compassAngle}deg)`,
//         transition: 'transform 0.3s ease',
//         filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.18))',
//         cursor: 'pointer',
//       }}
//       onClick={() => mapRef.current?.resetNorth({ duration: 500 })}
//       title="Click to reset north"
//     >
//       <circle cx="27" cy="27" r="26" fill="#f7f7f7" stroke="#d9d9d9" strokeWidth="1" />
//       <circle cx="27" cy="27" r="22" fill="none" stroke="#e6e6e6" strokeWidth="0.6" />
//       {Array.from({ length: 16 }, (_, i) => {
//         const deg = i * 22.5;
//         const rad = (deg * Math.PI) / 180;
//         const isMaj = i % 4 === 0;
//         const isMid = i % 2 === 0 && !isMaj;
//         const r1 = isMaj ? 18 : isMid ? 19.5 : 20.5;
//         return (
//           <line
//             key={i}
//             x1={27 + r1 * Math.sin(rad)}
//             y1={27 - r1 * Math.cos(rad)}
//             x2={27 + 23 * Math.sin(rad)}
//             y2={27 - 23 * Math.cos(rad)}
//             stroke={isMaj ? '#666' : '#bbb'}
//             strokeWidth={isMaj ? 1 : 0.55}
//           />
//         );
//       })}
//       <circle cx="27" cy="27" r="16" fill="#efefef" stroke="#d9d9d9" strokeWidth="0.7" />
//       <polygon points="27,4 29.7,27 27,21 24.3,27" fill="#e11d48" />
//       <polygon points="27,50 29.7,27 27,33 24.3,27" fill="#b9b9b9" />
//       <polygon points="50,27 27,24.3 33,27 27,29.7" fill="#8a8a8a" />
//       <polygon points="4,27 27,24.3 21,27 27,29.7" fill="#8a8a8a" />
//       <circle cx="27" cy="27" r="6" fill="#f7f7f7" stroke="#d9d9d9" strokeWidth="0.7" />
//       <circle cx="27" cy="27" r="2.8" fill="#222" />
//       <circle cx="27" cy="27" r="1.2" fill="#f7f7f7" />
//       <text x="27" y="14.5" textAnchor="middle" fontSize="5.5" fontWeight="700" fill="#111" fontFamily="sans-serif">
//         N
//       </text>
//       <text x="27" y="44.5" textAnchor="middle" fontSize="5" fontWeight="500" fill="#999" fontFamily="sans-serif">
//         S
//       </text>
//       <text x="43.5" y="28.8" textAnchor="middle" fontSize="5" fontWeight="500" fill="#999" fontFamily="sans-serif">
//         E
//       </text>
//       <text x="10.5" y="28.8" textAnchor="middle" fontSize="5" fontWeight="500" fill="#999" fontFamily="sans-serif">
//         W
//       </text>
//     </svg>
//   );

//   const DrawPopup = () => (
//     <div className="absolute right-12 top-0 z-50 flex flex-col items-end gap-2">
//       <div className="rounded-full border border-[#dadada] bg-white/96 px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.24em] text-[#666] shadow-[0_6px_18px_rgba(0,0,0,0.14)] backdrop-blur-sm">
//         Draw Type
//       </div>
//       {[
//         { key: 'point' as DrawGeometry, label: 'Point', Ic: IconPoint },
//         { key: 'line' as DrawGeometry, label: 'Line', Ic: IconLine },
//         { key: 'polygon' as DrawGeometry, label: 'Polygon', Ic: IconPolygon },
//       ].map(({ key, label, Ic }) => {
//         const active = drawGeometry === key;
//         return (
//           <button
//             key={key}
//             type="button"
//             onClick={() => selectDrawType(key)}
//             title={label}
//             className={[
//               'flex items-center gap-2 rounded-2xl border px-3 py-2 shadow-[0_8px_20px_rgba(0,0,0,0.14)] transition-all duration-150 active:scale-[0.98] whitespace-nowrap backdrop-blur-sm',
//               active
//                 ? 'border-[#111] bg-[#111] text-white'
//                 : 'border-[#d7d7d7] bg-white/96 text-[#111] hover:bg-white',
//             ].join(' ')}
//           >
//             <span className="flex h-6 w-6 items-center justify-center rounded-xl bg-white/10">
//               <Ic active={active} />
//             </span>
//             <span className="text-[11px] font-semibold leading-none">{label}</span>
//           </button>
//         );
//       })}
//     </div>
//   );

//   const PluginsPanel = () => (
//     <div className="absolute right-12 top-0 z-50 w-[250px] overflow-hidden rounded-2xl border border-[#d7d7d7] bg-white/96 shadow-[0_14px_36px_rgba(0,0,0,0.18)] backdrop-blur-md">
//       <div className="border-b border-[#e8e8e8] bg-[#fafafa] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#666]">
//         Map Plugins
//       </div>
//       {PLUGINS.map((p, i) => (
//         <div
//           key={p.id}
//           className={`flex items-center justify-between px-4 py-3 ${
//             i > 0 ? 'border-t border-[#f0f0f0]' : ''
//           } hover:bg-[#fafafa] transition-all`}
//         >
//           <div className="flex flex-col gap-0.5">
//             <span className="text-[12px] font-semibold text-[#111] leading-tight">{p.label}</span>
//             <span className="text-[10px] text-[#777] leading-tight">{p.desc}</span>
//           </div>
//           <button
//             type="button"
//             onClick={() => togglePlugin(p.id)}
//             className={`relative ml-3 h-5 w-10 shrink-0 rounded-full transition-all duration-200 border ${
//               activePlugins[p.id] ? 'bg-[#111] border-[#111]' : 'bg-[#d8d8d8] border-[#cfcfcf]'
//             }`}
//           >
//             <span
//               className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-all duration-200 ${
//                 activePlugins[p.id] ? 'left-[22px]' : 'left-[2px]'
//               }`}
//             />
//           </button>
//         </div>
//       ))}
//     </div>
//   );

//   const renderDetails = (small: boolean) =>
//     (isEditing ? draftAttributes : attributes).map((item, idx) => (
//       <div
//         key={item.field}
//         className={`grid items-center border-b border-[#ececec] leading-none ${
//           small ? 'min-h-[24px] grid-cols-[82px_1fr] text-[11px]' : 'min-h-[26px] grid-cols-[100px_1fr] text-[12px]'
//         } ${idx % 2 === 0 ? 'bg-[#fafafa]' : 'bg-white'}`}
//       >
//         <div className="truncate border-r border-[#efefef] px-2 py-[3px] font-semibold text-[#111]">{item.field}</div>
//         <div className="px-2 py-[2px]">
//           {isEditing ? (
//             item.field === 'status' ? (
//               <select
//                 value={item.value}
//                 onChange={(e) => handleDraft(item.field, e.target.value)}
//                 className={`w-full rounded-lg border border-[#dddddd] bg-white px-1.5 text-[#111] outline-none ${
//                   small ? 'h-[20px] text-[11px]' : 'h-6 text-[12px]'
//                 }`}
//               >
//                 <option>Active</option>
//                 <option>Proposed</option>
//                 <option>Inactive</option>
//               </select>
//             ) : (
//               <input
//                 value={item.value}
//                 onChange={(e) => handleDraft(item.field, e.target.value)}
//                 className={`w-full rounded-lg border border-[#dddddd] bg-white px-1.5 text-[#111] outline-none ${
//                   small ? 'h-[20px] text-[11px]' : 'h-6 text-[12px]'
//                 }`}
//               />
//             )
//           ) : (
//             <div className={`truncate text-[#444] ${small ? 'text-[11px]' : 'text-[12px]'}`}>{item.value}</div>
//           )}
//         </div>
//       </div>
//     ));

//   const renderLayers = (small: boolean) =>
//     ['Pole', 'Substation', 'Cabinate', 'Cable'].map((layer, idx) => (
//       <div
//         key={layer}
//         className={`grid grid-cols-[1fr_auto] items-center border-b border-[#ececec] px-3 leading-none ${
//           small ? 'min-h-[24px] py-[3px] text-[11px]' : 'min-h-[26px] py-[4px] text-[12px]'
//         } ${idx % 2 === 0 ? 'bg-[#fafafa]' : 'bg-white'}`}
//       >
//         <span className="truncate text-[#555]">{layer}</span>
//         <input
//           type="checkbox"
//           checked={layerVisibility[layer] !== false}
//           onChange={() =>
//             setLayerVisibility((prev) => ({
//               ...prev,
//               [layer]: !(prev[layer] !== false),
//             }))
//           }
//           className="accent-[#111]"
//         />
//       </div>
//     ));

//   return (
//     <div className="relative h-screen w-full overflow-hidden bg-[#f2f2f2] font-sans text-[#111]">
//       <div ref={mapContainerRef} className="absolute inset-0 z-0" style={{ width: '100%', height: '100%' }} />

//       <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(rgba(0,0,0,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.02)_1px,transparent_1px)] bg-[size:40px_40px]" />

//       {activePlugins['minimap'] && (
//         <div
//           ref={minimapContainerRef}
//           className={`absolute z-30 overflow-hidden rounded-2xl border border-[#d7d7d7] bg-white/90 shadow-[0_12px_30px_rgba(0,0,0,0.16)] backdrop-blur-sm ${
//             isMobile ? 'bottom-20 left-20 h-[80px] w-[112px]' : 'bottom-24 left-20 h-[132px] w-[190px]'
//           }`}
//         />
//       )}

//       {isMobile && showOC && (
//         <div className="absolute inset-0 z-[28] bg-black/20" onClick={() => setShowOC(false)} />
//       )}

//       {/* ── Top-left: hamburger + search ── */}
//       <div className="absolute top-2 z-30 flex items-center gap-1.5 transition-all duration-300" style={{ left: `${tlLeft}px` }}>
//         <button
//           type="button"
//           onClick={() => {
//             setShowTopMenu((p) => !p);
//             setShowBaseMapDrop(false);
//             setShowDrawPopup(false);
//           }}
//           className={`${ib} h-9 w-9 rounded-2xl`}
//         >
//           <div className="flex flex-col gap-[3px]">
//             <span className="block h-[2px] w-[14px] rounded bg-current" />
//             <span className="block h-[2px] w-[14px] rounded bg-current" />
//             <span className="block h-[2px] w-[14px] rounded bg-current" />
//           </div>
//         </button>

//         <div className="flex h-9 w-[190px] sm:w-[280px] items-center rounded-2xl border border-[#dddddd] bg-white/95 px-3 shadow-[0_8px_22px_rgba(0,0,0,0.10)] backdrop-blur-md">
//           <input
//             value={searchText}
//             onChange={(e) => setSearchText(e.target.value)}
//             onKeyDown={(e) => {
//               if (e.key === 'Enter') runSearch();
//             }}
//             className="w-full bg-transparent text-[11px] sm:text-[12px] text-[#111] outline-none placeholder:text-[#8a8a8a]"
//             placeholder="Search pole, design id, municipality..."
//           />
//           <button
//             type="button"
//             onClick={runSearch}
//             className="ml-2 flex h-7 w-7 items-center justify-center rounded-xl border border-[#e2e2e2] bg-[#fafafa] text-[#111] hover:bg-white"
//             title="Search"
//           >
//             ⌕
//           </button>
//         </div>

//         {showTopMenu && (
//           <div
//             className={`absolute left-0 z-50 overflow-hidden rounded-2xl border border-[#d7d7d7] bg-white/96 shadow-[0_14px_36px_rgba(0,0,0,0.18)] ${
//               isMobile ? 'top-11 min-w-[132px]' : 'top-11 min-w-[176px]'
//             }`}
//           >
//             {[
//               {
//                 label: 'Home',
//                 action: () => {
//                   mapRef.current?.flyTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, essential: true });
//                   setShowTopMenu(false);
//                 },
//               },
//               { label: 'Bookmark', action: () => setShowTopMenu(false) },
//               {
//                 label: 'Object Controller',
//                 action: () => {
//                   setShowOC((p) => !p);
//                   setShowTopMenu(false);
//                 },
//               },
//             ].map((item, i) => (
//               <button
//                 key={item.label}
//                 type="button"
//                 onClick={item.action}
//                 className={`flex w-full items-center text-left text-[#111] hover:bg-[#fafafa] ${
//                   isMobile ? 'px-3 py-2 text-[11px]' : 'px-4 py-2.5 text-[13px]'
//                 } ${i > 0 ? 'border-t border-[#efefef]' : ''}`}
//               >
//                 {item.label}
//               </button>
//             ))}
//           </div>
//         )}
//       </div>

//       {/* ── Top-right: logo + user ── */}
//       <div className={`absolute top-2 z-30 flex items-center gap-1.5 sm:gap-2 transition-all duration-300 ${rightShift}`}>
//         <a href="https://redplanetgrp.com" target="_blank" rel="noreferrer">
//           <img
//             src="https://redplanetgrp.com/wp-content/uploads/2025/04/Redplanet-Solutions.webp"
//             alt="RedPlanet"
//             className="h-7 sm:h-9 w-auto object-contain"
//           />
//         </a>
//         <button type="button" className={`${ib} h-9 w-9 rounded-2xl`}>
//           <span className="text-sm">👤</span>
//         </button>
//       </div>

//       {/* ── Right toolbar ── */}
//       <div className={`absolute top-[46px] sm:top-[52px] z-30 flex flex-col gap-2 transition-all duration-300 ${rightShift}`}>
//         <div className="relative">
//           <button
//             type="button"
//             onClick={() => {
//               setShowBaseMapDrop((p) => !p);
//               setShowTopMenu(false);
//               setShowDrawPopup(false);
//               setActiveTool((p) => (p === 'Plugins' ? null : p));
//             }}
//             className={`${ib} h-10 w-10 rounded-2xl`}
//             title="Base Maps"
//           >
//             <LayersIcon />
//           </button>

//           {showBaseMapDrop && (
//             <div className="absolute right-0 top-12 z-50 min-w-[170px] overflow-hidden rounded-2xl border border-[#d7d7d7] bg-white/96 shadow-[0_14px_36px_rgba(0,0,0,0.18)] backdrop-blur-md">
//               <div className="border-b border-[#ededed] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#666]">
//                 Base Map
//               </div>
//               {['OSM', 'Google', 'Google Satellite'].map((bm, i) => (
//                 <button
//                   key={bm}
//                   type="button"
//                   onClick={() => {
//                     setSelectedBaseMap(bm);
//                     setShowBaseMapDrop(false);
//                     if (bm === 'Google' && !GOOGLE_ROAD_TILES_URL) {
//                       alert('Set GOOGLE_ROAD_TILES_URL constant with your Google Map Tiles API URL.');
//                     }
//                     if (bm === 'Google Satellite' && !GOOGLE_SAT_TILES_URL) {
//                       alert('Set GOOGLE_SAT_TILES_URL constant with your Google Map Tiles API URL.');
//                     }
//                   }}
//                   className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-[12px] transition-all ${
//                     selectedBaseMap === bm ? 'bg-[#111] text-white' : 'text-[#111] hover:bg-[#fafafa]'
//                   } ${i > 0 ? 'border-t border-[#efefef]' : ''}`}
//                 >
//                   <span>{bm}</span>
//                   {selectedBaseMap === bm && <span className="text-xs">✓</span>}
//                 </button>
//               ))}
//             </div>
//           )}
//         </div>

//         {tools.map((tool) => {
//           const isActive = activeTool === tool.label;
//           return (
//             <div key={tool.label} className="relative">
//               <button
//                 type="button"
//                 title={tool.label}
//                 onClick={() => handleToolClick(tool.label)}
//                 className={`h-10 w-10 rounded-2xl border border-[#d8d8d8] bg-white/95 shadow-[0_8px_22px_rgba(0,0,0,0.10)] backdrop-blur-md transition-all hover:bg-white active:scale-[0.98]`}
//               >
//                 <tool.Icon active={isActive} />
//               </button>

//               {tool.label === 'Plugins' && isActive && <PluginsPanel />}
//               {tool.label === 'Draw' && activeTool === 'Draw' && showDrawPopup && <DrawPopup />}
//             </div>
//           );
//         })}
//       </div>

//       {/* ── Draw status bar ── */}
//       {activeTool === 'Draw' && drawCount > 0 && (
//         <div
//           className={`absolute left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-full border border-[#dcdcdc] bg-white/96 px-4 py-2 shadow-[0_10px_28px_rgba(0,0,0,0.16)] text-[11px] text-[#111] whitespace-nowrap backdrop-blur-md ${
//             showBottomPanel ? 'bottom-[calc(20vh+52px)]' : 'bottom-14'
//           }`}
//         >
//           <span className="font-medium capitalize">{drawGeometry}</span>
//           <span className="text-[#888]">{drawCount} pt{drawCount !== 1 ? 's' : ''}</span>
//           <span className="text-[#d0d0d0]">|</span>
//           {!drawFinished ? (
//             <button onClick={() => setDrawFinished(true)} className={`${pb} rounded-full px-3 py-1 text-[10px] font-semibold`}>
//               Finish
//             </button>
//           ) : (
//             <button onClick={saveDraw} className={`${pb} rounded-full px-3 py-1 text-[10px] font-semibold`}>
//               Save
//             </button>
//           )}
//           <button onClick={clearDraw} className="text-[10px] text-[#e11d48] underline font-medium">
//             Clear
//           </button>
//         </div>
//       )}

//       {/* ── Measure bar ── */}
//       {activeTool === 'Measure' && (
//         <div
//           className={`absolute left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-full border border-[#dcdcdc] bg-white/96 px-4 py-2 shadow-[0_10px_28px_rgba(0,0,0,0.16)] text-[11px] text-[#111] whitespace-nowrap backdrop-blur-md ${
//             showBottomPanel ? 'bottom-[calc(20vh+52px)]' : 'bottom-14'
//           }`}
//         >
//           <span className="font-medium">Measure</span>
//           <span className="text-[#888]">
//             {measureTotal != null
//               ? measureTotal < 1
//                 ? `${(measureTotal * 1000).toFixed(0)} m`
//                 : `${measureTotal.toFixed(3)} km`
//               : 'Click map to start'}
//           </span>
//           <span className="text-[#d0d0d0]">|</span>
//           <button onClick={clearMeasure} className="text-[10px] text-[#e11d48] underline font-medium">
//             Clear
//           </button>
//         </div>
//       )}

//       {/* ── Object Controller ── */}
//       <div
//         className={`absolute inset-y-0 left-0 z-30 border-r border-[#dddddd] bg-white/96 shadow-[0_16px_40px_rgba(0,0,0,0.12)] backdrop-blur-md transition-transform duration-300 ease-in-out ${
//           showOC ? 'translate-x-0' : '-translate-x-full'
//         }`}
//         style={{ width: isMobile ? 'min(30vw,140px)' : '250px' }}
//       >
//         <div className="flex items-center justify-between border-b border-[#efefef] bg-[#fafafa] px-2 py-2 text-[11px] font-semibold text-[#111] sm:px-3 sm:text-[13px]">
//           <span>Object Controller</span>
//           <button type="button" onClick={() => setShowOC(false)} className={`${ib} h-7 w-7 shrink-0 rounded-xl text-xs font-bold`}>
//             ←
//           </button>
//         </div>

//         <div className="h-[calc(100%-41px)] overflow-y-auto px-1 py-2 sm:px-2">
//           {[
//             { key: 'Segment' as keyof ExpandedGroups, items: ['Cable', 'Cable Segment', 'Fiber Optic', 'Wire'] },
//             { key: 'Distribution Structure' as keyof ExpandedGroups, items: ['Pole', 'Manhole', 'Cabinate'] },
//             { key: 'Equipment' as keyof ExpandedGroups, items: ['Power Transformer', 'Service Point', 'Light', 'Meter'] },
//           ].map((group, gi) => (
//             <div key={group.key} className={gi > 0 ? 'mt-1 space-y-0.5' : 'space-y-0.5'}>
//               <button
//                 type="button"
//                 onClick={() => toggleGroup(group.key)}
//                 className="flex w-full items-center justify-between rounded-xl px-1 py-1 text-left font-medium text-[#111] transition-all hover:bg-[#fafafa] sm:px-2.5 sm:py-2"
//               >
//                 <span className={isMobile ? 'text-[9.5px] leading-tight' : 'text-[13px] leading-tight'}>{group.key}</span>
//                 <span className="shrink-0 text-[8px] sm:text-[10px]">{expandedGroups[group.key] ? '▾' : '▸'}</span>
//               </button>

//               {expandedGroups[group.key] && (
//                 <div className="ml-1.5 space-y-0.5 border-l border-[#ececec] pl-1.5 sm:ml-3 sm:pl-2.5">
//                   {group.items.map((item) => (
//                     <button
//                       key={item}
//                       type="button"
//                       onClick={() => selectObjectItem(item)}
//                       className={`block w-full rounded-lg px-1 py-1 text-left transition-all sm:px-2.5 sm:py-1.5 ${
//                         isMobile ? 'text-[9px] leading-tight' : 'text-[12px]'
//                       } ${
//                         selectedObjectItem === item
//                           ? 'bg-[#111] text-white'
//                           : 'text-[#555] hover:bg-[#fafafa] hover:text-[#111]'
//                       }`}
//                     >
//                       {item}
//                     </button>
//                   ))}
//                 </div>
//               )}
//             </div>
//           ))}
//         </div>
//       </div>

//       {/* ── Object editor – desktop ── */}
//       {selectedObjectId && !isMobile && (
//         <div className="absolute inset-y-0 right-0 z-30 flex w-[320px] flex-col border-l border-[#dddddd] bg-white/96 shadow-[0_16px_40px_rgba(0,0,0,0.12)] backdrop-blur-md">
//           <div className="flex items-center justify-between border-b border-[#efefef] bg-[#fafafa] px-3 py-2">
//             <div className="text-sm font-semibold text-[#111]">Object Editor</div>
//             <button type="button" onClick={closeEditor} className={`${ib} h-8 w-8 rounded-xl text-sm font-bold`}>
//               →
//             </button>
//           </div>

//           <div className="flex items-center justify-between gap-2 border-b border-[#efefef] bg-white px-3 py-2">
//             <div className="truncate text-xs text-[#555]">
//               Selected: <span className="font-semibold text-[#111]">{getLabel()}</span>
//             </div>
//             <div className="flex items-center gap-2">
//               <button type="button" onClick={zoomToSel} className={`${ib} h-8 w-8 rounded-xl text-sm font-bold`}>
//                 ⌖
//               </button>
//               {!isEditing && (
//                 <button onClick={startEditing} className={`${gb} rounded-xl px-3 py-1.5 text-xs font-medium`}>
//                   Edit
//                 </button>
//               )}
//             </div>
//           </div>

//           <div className="flex border-b border-[#efefef] bg-[#fafafa] text-xs">
//             {(['Details', 'Layers'] as const).map((tab) => (
//               <button
//                 key={tab}
//                 onClick={() => setActiveTab(tab)}
//                 className={`px-4 py-2 transition ${
//                   activeTab === tab
//                     ? 'border-b-2 border-[#111] bg-white font-semibold text-[#111]'
//                     : 'text-[#555] hover:bg-[#f7f7f7]'
//                 }`}
//               >
//                 {tab}
//               </button>
//             ))}
//           </div>

//           <div className={`${isEditing ? 'h-[calc(100%-120px)]' : 'h-[calc(100%-96px)]'} overflow-y-auto bg-white`}>
//             {activeTab === 'Details' ? renderDetails(false) : renderLayers(false)}
//           </div>

//           {isEditing && (
//             <div className="flex items-center justify-end gap-2 border-t border-[#efefef] bg-[#fafafa] px-2 py-2">
//               <button onClick={cancelEditing} className={`${gb} rounded-xl px-2.5 py-1.5 text-xs font-medium`}>
//                 Cancel
//               </button>
//               <button onClick={deleteObj} className={`${gb} rounded-xl px-2.5 py-1.5 text-xs font-medium`}>
//                 Delete
//               </button>
//               <div className="relative">
//                 <button type="button" onClick={() => setShowSaveMenu((p) => !p)} className={`${pb} rounded-xl px-2.5 py-1.5 text-xs font-medium`}>
//                   Save ▾
//                 </button>
//                 {showSaveMenu && (
//                   <div className="absolute bottom-full right-0 mb-2 min-w-[160px] overflow-hidden rounded-xl border border-[#dddddd] bg-white shadow-[0_12px_30px_rgba(0,0,0,0.15)]">
//                     <button
//                       type="button"
//                       onClick={() => saveChanges(false)}
//                       className="block w-full px-3 py-2 text-left text-xs text-[#111] hover:bg-[#fafafa]"
//                     >
//                       Save
//                     </button>
//                     <button
//                       type="button"
//                       onClick={() => saveChanges(true)}
//                       className="block w-full border-t border-[#efefef] px-3 py-2 text-left text-xs text-[#111] hover:bg-[#fafafa]"
//                     >
//                       Save &amp; Continue
//                     </button>
//                   </div>
//                 )}
//               </div>
//             </div>
//           )}
//         </div>
//       )}

//       {/* ── Object editor – mobile ── */}
//       {selectedObjectId && isMobile && (
//         <div
//           className="absolute bottom-0 left-0 right-0 z-30 flex flex-col rounded-t-2xl border-t border-[#dddddd] bg-white/96 shadow-[0_-10px_30px_rgba(0,0,0,0.16)] backdrop-blur-md"
//           style={{ maxHeight: '50vh' }}
//         >
//           <div className="flex shrink-0 justify-center pb-1 pt-2">
//             <div className="h-[3px] w-8 rounded-full bg-[#cfcfcf]" />
//           </div>

//           <div className="flex shrink-0 items-center justify-between border-b border-[#efefef] bg-[#fafafa] px-3 py-1.5">
//             <span className="text-[12px] font-semibold text-[#111]">Object Editor</span>
//             <div className="flex items-center gap-1.5">
//               <button type="button" onClick={zoomToSel} className={`${ib} h-7 w-7 rounded-xl text-xs`}>
//                 ⌖
//               </button>
//               {!isEditing && (
//                 <button onClick={startEditing} className={`${gb} rounded-xl px-2 py-1 text-[11px] font-medium`}>
//                   Edit
//                 </button>
//               )}
//               <button type="button" onClick={closeEditor} className={`${ib} h-7 w-7 rounded-xl text-xs font-bold`}>
//                 ↓
//               </button>
//             </div>
//           </div>

//           <div className="shrink-0 border-b border-[#efefef] px-3 py-1">
//             <span className="text-[11px] text-[#555]">Selected: </span>
//             <span className="text-[11px] font-semibold text-[#111]">{getLabel()}</span>
//           </div>

//           <div className="flex shrink-0 border-b border-[#efefef] bg-[#fafafa] text-[11px]">
//             {(['Details', 'Layers'] as const).map((tab) => (
//               <button
//                 key={tab}
//                 onClick={() => setActiveTab(tab)}
//                 className={`px-4 py-1.5 transition ${
//                   activeTab === tab
//                     ? 'border-b-2 border-[#111] bg-white font-semibold text-[#111]'
//                     : 'text-[#555] hover:bg-[#f7f7f7]'
//                 }`}
//               >
//                 {tab}
//               </button>
//             ))}
//           </div>

//           <div className="flex-1 overflow-y-auto bg-white">{activeTab === 'Details' ? renderDetails(true) : renderLayers(true)}</div>

//           {isEditing && (
//             <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-[#efefef] bg-[#fafafa] px-2 py-1.5">
//               <button onClick={cancelEditing} className={`${gb} rounded-xl px-2 py-1 text-[11px] font-medium`}>
//                 Cancel
//               </button>
//               <button onClick={deleteObj} className={`${gb} rounded-xl px-2 py-1 text-[11px] font-medium`}>
//                 Delete
//               </button>
//               <div className="relative">
//                 <button type="button" onClick={() => setShowSaveMenu((p) => !p)} className={`${pb} rounded-xl px-2 py-1 text-[11px] font-medium`}>
//                   Save ▾
//                 </button>
//                 {showSaveMenu && (
//                   <div className="absolute bottom-full right-0 mb-1 min-w-[140px] overflow-hidden rounded-xl border border-[#dddddd] bg-white shadow-[0_12px_30px_rgba(0,0,0,0.15)]">
//                     <button
//                       type="button"
//                       onClick={() => saveChanges(false)}
//                       className="block w-full px-3 py-2 text-left text-[11px] text-[#111] hover:bg-[#fafafa]"
//                     >
//                       Save
//                     </button>
//                     <button
//                       type="button"
//                       onClick={() => saveChanges(true)}
//                       className="block w-full border-t border-[#efefef] px-3 py-2 text-left text-[11px] text-[#111] hover:bg-[#fafafa]"
//                     >
//                       Save &amp; Continue
//                     </button>
//                   </div>
//                 )}
//               </div>
//             </div>
//           )}
//         </div>
//       )}

//       {/* ── Zoom + Compass ── */}
//       <div
//         className={`absolute z-30 flex flex-col items-center gap-2 transition-all duration-300 ${ctrlBot}`}
//         style={{ left: `${blLeft}px` }}
//       >
//         <div className="flex flex-col items-center overflow-hidden rounded-[20px] border border-[#d8d8d8] bg-white/95 shadow-[0_10px_24px_rgba(0,0,0,0.12)] backdrop-blur-md">
//           <button
//             type="button"
//             onClick={zoomIn}
//             className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center border-b border-[#ececec] text-sm sm:text-base font-bold text-[#111] hover:bg-[#fafafa] transition-all"
//           >
//             +
//           </button>

//           <div className="flex items-center justify-center px-1 py-1.5">
//             <input
//               type="range"
//               min="1"
//               max="20"
//               value={zoomLevel}
//               onChange={(e) => {
//                 const z = Number(e.target.value);
//                 setZoomLevel(z);
//                 mapRef.current?.setZoom(z);
//               }}
//               className="vertical-zoom-slider cursor-pointer appearance-none bg-transparent"
//               style={{ writingMode: 'vertical-lr', direction: 'rtl', width: '7px', height: isMobile ? '42px' : '48px' }}
//             />
//           </div>

//           <button
//             type="button"
//             onClick={zoomOut}
//             className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center border-t border-[#ececec] text-sm sm:text-base font-bold text-[#111] hover:bg-[#fafafa] transition-all"
//           >
//             −
//           </button>
//         </div>

//         <div className="rounded-[20px] border border-[#d8d8d8] bg-white/95 p-1 shadow-[0_10px_24px_rgba(0,0,0,0.12)] backdrop-blur-md">
//           <SmallCompass size={isMobile ? 44 : 48} />
//         </div>
//       </div>

//       {/* ── Lat/Lon display ── */}
//       <div
//         className={`absolute z-30 rounded-2xl border border-[#d8d8d8] bg-white/95 px-2 py-1 sm:px-2.5 sm:py-1.5 text-[10px] sm:text-[11px] text-[#555] shadow-[0_10px_24px_rgba(0,0,0,0.12)] backdrop-blur-md transition-all duration-300 ${rightShift} ${llBot}`}
//       >
//         <span className="font-bold text-[#111]">Lat:</span> {latLon.lat.toFixed(4)} <span className="text-[#d0d0d0]">|</span>{' '}
//         <span className="font-bold text-[#111]">Lon:</span> {latLon.lon.toFixed(4)}
//       </div>

//       {/* ── Bottom table panel ── */}
//       {showBottomPanel && (
//         <div
//           className={`absolute bottom-0 left-0 right-0 z-40 border-t border-[#dddddd] bg-white/96 shadow-[0_-10px_30px_rgba(0,0,0,0.14)] backdrop-blur-md ${
//             isMobile ? 'h-[30vh]' : 'h-[20vh] min-h-[140px] max-h-[190px]'
//           }`}
//         >
//           <div className="flex items-center gap-1.5 border-b border-[#efefef] bg-[#fafafa] px-2 py-1.5 flex-wrap">
//             <div className="mr-auto shrink-0 truncate text-[12px] font-semibold text-[#111]">{selectedObjectItem || 'Objects'}</div>
//             <select
//               value={tableFilterMode}
//               onChange={(e) => setTableFilterMode(e.target.value)}
//               className="h-7 rounded-xl border border-[#dddddd] bg-white px-1.5 text-[11px] font-medium text-[#111] outline-none"
//             >
//               <option>By ID</option>
//             </select>
//             <input
//               value={tableFilterInput}
//               onChange={(e) => setTableFilterInput(e.target.value)}
//               placeholder="Filter..."
//               className="h-7 w-[80px] rounded-xl border border-[#dddddd] bg-white px-2 text-[11px] text-[#111] outline-none placeholder:text-[#888]"
//             />
//             <button type="button" onClick={() => setAppliedFilter(tableFilterInput)} className={`${pb} h-7 rounded-xl px-2.5 text-[11px] font-semibold`}>
//               Run
//             </button>
//             <button type="button" onClick={downloadTable} className={`${gb} h-7 rounded-xl px-2.5 text-[11px] font-semibold`}>
//               Download
//             </button>
//             <button onClick={() => setShowBottomPanel(false)} className={`${ib} h-7 w-7 rounded-xl text-xs font-bold`}>
//               ↓
//             </button>
//           </div>

//           <div className="h-[calc(100%-42px)] overflow-auto">
//             <table className="min-w-full table-fixed text-[11px]">
//               <thead className="sticky top-0 bg-[#fafafa]">
//                 <tr className="text-left text-[#111]">
//                   {['ID', 'Type', 'Status', 'Owner', 'Material', 'Height', 'Municipality', 'Design ID'].map((h) => (
//                     <th key={h} className="truncate whitespace-nowrap px-2 py-[5px] font-semibold">
//                       {h}
//                     </th>
//                   ))}
//                 </tr>
//               </thead>
//               <tbody>
//                 {filteredRows.map((row, idx) => (
//                   <tr
//                     key={row.key}
//                     onClick={row.onClick}
//                     className={`h-[24px] leading-none transition-colors ${
//                       row.onClick ? 'cursor-pointer' : ''
//                     } ${
//                       row.selected
//                         ? 'border-l-2 border-l-[#111] bg-[#f1f1f1]'
//                         : idx % 2 === 0
//                           ? 'bg-white hover:bg-[#fafafa]'
//                           : 'bg-[#fcfcfc] hover:bg-[#fafafa]'
//                     }`}
//                   >
//                     <td className="truncate px-2 py-[4px] font-medium text-[#111]">{row.id}</td>
//                     <td className="truncate px-2 py-[4px] text-[#555]">{row.type}</td>
//                     <td className="truncate px-2 py-[4px] text-[#555]">{row.status}</td>
//                     <td className="truncate px-2 py-[4px] text-[#555]">{row.owner}</td>
//                     <td className="truncate px-2 py-[4px] text-[#555]">{row.material}</td>
//                     <td className="truncate px-2 py-[4px] text-[#555]">{row.height}</td>
//                     <td className="truncate px-2 py-[4px] text-[#555]">{row.municipality}</td>
//                     <td className="truncate px-2 py-[4px] text-[#555]">{row.designId}</td>
//                   </tr>
//                 ))}
//                 {filteredRows.length === 0 && (
//                   <tr>
//                     <td colSpan={8} className="px-3 py-4 text-center text-[11px] text-[#888]">
//                       No records found.
//                     </td>
//                   </tr>
//                 )}
//               </tbody>
//             </table>
//           </div>
//         </div>
//       )}

//       <style>{`
//         .maplibregl-ctrl-bottom-left,
//         .maplibregl-ctrl-bottom-right,
//         .maplibregl-ctrl-top-left,
//         .maplibregl-ctrl-top-right {
//           display: none !important;
//         }

//         .vertical-zoom-slider::-webkit-slider-runnable-track {
//           width: 5px;
//           border-radius: 9999px;
//           background: #d0d0d0;
//         }

//         .vertical-zoom-slider::-webkit-slider-thumb {
//           -webkit-appearance: none;
//           appearance: none;
//           width: 12px;
//           height: 12px;
//           border-radius: 9999px;
//           background: #111;
//           border: 2px solid #fff;
//           box-shadow: 0 2px 8px rgba(0,0,0,.24);
//           margin-left: -4px;
//         }

//         .vertical-zoom-slider::-moz-range-track {
//           width: 5px;
//           border-radius: 9999px;
//           background: #d0d0d0;
//         }

//         .vertical-zoom-slider::-moz-range-thumb {
//           width: 12px;
//           height: 12px;
//           border-radius: 9999px;
//           background: #111;
//           border: 2px solid #fff;
//           box-shadow: 0 2px 8px rgba(0,0,0,.24);
//         }

//         .maplibregl-canvas {
//           outline: none;
//         }

//         .maplibregl-popup-content {
//           padding: 0 !important;
//           border-radius: 12px !important;
//           overflow: hidden;
//           box-shadow: 0 8px 22px rgba(0,0,0,0.18) !important;
//         }

//         .maplibregl-popup-tip {
//           border-top-color: white !important;
//           border-bottom-color: white !important;
//         }
//       `}</style>
//     </div>
//   );
// }


























// 'use client';

// import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
// import maplibregl from 'maplibre-gl';
// import 'maplibre-gl/dist/maplibre-gl.css';

// type Attribute = { field: string; value: string };
// type Pole = { id: string; lat: number; lon: number; attributes: Attribute[] };
// type ActiveTab = 'Details' | 'Layers';
// type ExpandedGroups = { Segment: boolean; 'Distribution Structure': boolean; Equipment: boolean };
// // Pan removed — MapLibre handles panning natively via click+drag
// type ActiveTool = 'Locate' | 'Select' | 'Draw' | 'Measure' | 'Plugins' | null;
// type DrawGeometry = 'point' | 'line' | 'polygon';
// type BottomRow = {
//   key: string; id: string; type: string; status: string; owner: string;
//   material: string; height: string; municipality: string; designId: string;
//   onClick?: () => void; selected?: boolean;
// };

// // ─── Replace with your real Google Map Tiles API URLs ───────────────────────
// const GOOGLE_ROAD_TILES_URL = '';
// const GOOGLE_SAT_TILES_URL  = '';
// const OSM_TILES = ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'];
// const OSM_ATTR  = '© OpenStreetMap contributors';

// // Default center — Quezon City, Philippines
// const DEFAULT_CENTER: [number, number] = [121.1866, 14.5943];
// const DEFAULT_ZOOM = 15;

// function makeRasterStyle(
//   tiles: string[], src: string, attr: string, night = false
// ): maplibregl.StyleSpecification {
//   return {
//     version: 8,
//     glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
//     sources: { [src]: { type: 'raster', tiles, tileSize: 256, attribution: attr, maxzoom: 20 } },
//     layers: [{
//       id: `${src}-tiles`, type: 'raster', source: src, minzoom: 0, maxzoom: 22,
//       paint: night ? { 'raster-brightness-max': 0.4, 'raster-saturation': -1, 'raster-contrast': 0.3 } : {},
//     }],
//   };
// }

// function getBaseMapStyle(baseMap: string, isNight: boolean): maplibregl.StyleSpecification {
//   if (baseMap === 'Google') {
//     const t = GOOGLE_ROAD_TILES_URL ? [GOOGLE_ROAD_TILES_URL] : OSM_TILES;
//     return makeRasterStyle(t, 'basemap', GOOGLE_ROAD_TILES_URL ? 'Google' : OSM_ATTR, isNight);
//   }
//   if (baseMap === 'Google Satellite') {
//     const t = GOOGLE_SAT_TILES_URL ? [GOOGLE_SAT_TILES_URL] : OSM_TILES;
//     return makeRasterStyle(t, 'basemap', GOOGLE_SAT_TILES_URL ? 'Google' : OSM_ATTR, isNight);
//   }
//   return makeRasterStyle(OSM_TILES, 'basemap', OSM_ATTR, isNight);
// }

// const PLUGINS = [
//   { id: 'minimap',    label: 'Mini Map',     desc: 'Live overview minimap' },
//   { id: 'heatmap',   label: 'Heatmap',       desc: 'Density heatmap on poles' },
//   { id: 'export',    label: 'Export PNG',    desc: 'Download map as PNG' },
//   { id: 'fullscreen',label: 'Fullscreen',    desc: 'Toggle fullscreen mode' },
//   { id: 'geoloc',    label: 'Geolocate Me',  desc: 'Fly to your GPS location' },
//   { id: 'grid',      label: 'Grid Overlay',  desc: 'Lat/lon 5-degree grid' },
//   { id: 'nightmode', label: 'Night Mode',    desc: 'Dark desaturated map' },
//   { id: 'cluster',   label: 'Cluster Poles', desc: 'Group nearby markers' },
// ];

// function haversineKm(la1: number, lo1: number, la2: number, lo2: number) {
//   const R = 6371, dLa = ((la2-la1)*Math.PI)/180, dLo = ((lo2-lo1)*Math.PI)/180;
//   const a = Math.sin(dLa/2)**2 + Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dLo/2)**2;
//   return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
// }

// // Poles at exact Quezon City coordinates — [lon, lat] for MapLibre
// const POLES: Pole[] = [
//   { id:'PL-00231', lat:14.5943, lon:121.1866, attributes:[
//     {field:'asset_id',value:'PL-00231'},{field:'feature_type',value:'Pole'},
//     {field:'status',value:'Active'},{field:'owner',value:'Utility Network'},
//     {field:'material',value:'Concrete'},{field:'height_m',value:'10.5'},
//     {field:'municipality',value:'Quezon City'},{field:'design_id',value:'DSN-1045'}]},
//   { id:'PL-00232', lat:14.5951, lon:121.1882, attributes:[
//     {field:'asset_id',value:'PL-00232'},{field:'feature_type',value:'Pole'},
//     {field:'status',value:'Active'},{field:'owner',value:'City Grid'},
//     {field:'material',value:'Steel'},{field:'height_m',value:'11.0'},
//     {field:'municipality',value:'Quezon City'},{field:'design_id',value:'DSN-1046'}]},
//   { id:'PL-00233', lat:14.5928, lon:121.1848, attributes:[
//     {field:'asset_id',value:'PL-00233'},{field:'feature_type',value:'Pole'},
//     {field:'status',value:'Proposed'},{field:'owner',value:'Utility Network'},
//     {field:'material',value:'Concrete'},{field:'height_m',value:'9.8'},
//     {field:'municipality',value:'Quezon City'},{field:'design_id',value:'DSN-1047'}]},
//   { id:'PL-00234', lat:14.5964, lon:121.1854, attributes:[
//     {field:'asset_id',value:'PL-00234'},{field:'feature_type',value:'Pole'},
//     {field:'status',value:'Inactive'},{field:'owner',value:'North Utility'},
//     {field:'material',value:'Wood'},{field:'height_m',value:'8.9'},
//     {field:'municipality',value:'Quezon City'},{field:'design_id',value:'DSN-1048'}]},
//   { id:'PL-00235', lat:14.5936, lon:121.1902, attributes:[
//     {field:'asset_id',value:'PL-00235'},{field:'feature_type',value:'Pole'},
//     {field:'status',value:'Active'},{field:'owner',value:'Metro Utility'},
//     {field:'material',value:'Steel'},{field:'height_m',value:'12.1'},
//     {field:'municipality',value:'Quezon City'},{field:'design_id',value:'DSN-1049'}]},
// ];

// function buildGrid() {
//   const f: any[] = [];
//   for (let la=-80; la<=80; la+=5) f.push({type:'Feature',geometry:{type:'LineString',coordinates:[[-180,la],[180,la]]},properties:{}});
//   for (let lo=-180; lo<=180; lo+=5) f.push({type:'Feature',geometry:{type:'LineString',coordinates:[[lo,-80],[lo,80]]},properties:{}});
//   return {type:'FeatureCollection' as const, features:f};
// }

// // ── Compact SVG icons for draw type buttons ───────────────────────────────
// const IconPoint = ({active}: {active:boolean}) => (
//   <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
//     <circle cx="12" cy="12" r="7" fill={active?'white':'#333'}/>
//     <circle cx="12" cy="12" r="3.5" fill={active?'#333':'white'}/>
//   </svg>
// );
// const IconLine = ({active}: {active:boolean}) => (
//   <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
//     <circle cx="4" cy="20" r="3" fill={active?'white':'#333'}/>
//     <circle cx="20" cy="4"  r="3" fill={active?'white':'#333'}/>
//     <line x1="4" y1="20" x2="20" y2="4" stroke={active?'white':'#333'} strokeWidth="2" strokeLinecap="round"/>
//   </svg>
// );
// const IconPolygon = ({active}: {active:boolean}) => (
//   <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
//     <polygon points="12,2 22,20 2,20"
//       fill={active?'rgba(255,255,255,0.25)':'rgba(0,0,0,0.1)'}
//       stroke={active?'white':'#333'} strokeWidth="1.8" strokeLinejoin="round"/>
//     <circle cx="12" cy="2"  r="2.2" fill={active?'white':'#333'}/>
//     <circle cx="22" cy="20" r="2.2" fill={active?'white':'#333'}/>
//     <circle cx="2"  cy="20" r="2.2" fill={active?'white':'#333'}/>
//   </svg>
// );

// export default function GISUiMapLibre() {
//   // ── Refs ──────────────────────────────────────────────────────────────────
//   const mapContainerRef     = useRef<HTMLDivElement|null>(null);
//   const mapRef              = useRef<maplibregl.Map|null>(null);
//   const mapReadyRef         = useRef(false);
//   const openPoleRef         = useRef<(p:Pole)=>void>(()=>{});
//   const markersRef          = useRef<maplibregl.Marker[]>([]);
//   const minimapContainerRef = useRef<HTMLDivElement|null>(null);
//   const minimapRef          = useRef<maplibregl.Map|null>(null);
//   const drawPtsRef          = useRef<[number,number][]>([]);
//   const rulerPtsRef         = useRef<[number,number][]>([]);
//   const rulerMarkersRef     = useRef<maplibregl.Marker[]>([]);
//   const rulerPopupRef       = useRef<maplibregl.Popup|null>(null);
//   const activeToolRef       = useRef<ActiveTool>(null);
//   const drawGeomRef         = useRef<DrawGeometry>('point');
//   const initializedRef      = useRef(false); // guard against double-init (React StrictMode)

//   // ── State ─────────────────────────────────────────────────────────────────
//   const [isMobile, setIsMobile]                   = useState(false);
//   const [zoomLevel, setZoomLevel]                 = useState(DEFAULT_ZOOM);
//   const [latLon, setLatLon]                       = useState({lat:DEFAULT_CENTER[1],lon:DEFAULT_CENTER[0]});
//   const [compassAngle, setCompassAngle]           = useState(0);
//   const [selectedBaseMap, setSelectedBaseMap]     = useState('OSM');
//   const [showBaseMapDrop, setShowBaseMapDrop]     = useState(false);
//   const [activeTool, setActiveTool]               = useState<ActiveTool>(null);
//   const [showTopMenu, setShowTopMenu]             = useState(false);
//   const [activePlugins, setActivePlugins]         = useState<Record<string,boolean>>({});
//   const [showDrawPopup, setShowDrawPopup]         = useState(false);
//   const [drawGeometry, setDrawGeometry]           = useState<DrawGeometry>('point');
//   const [showOC, setShowOC]                       = useState(false);
//   const [expandedGroups, setExpandedGroups]       = useState<ExpandedGroups>({
//     Segment:false,'Distribution Structure':false,Equipment:false});
//   const [selectedObjectItem, setSelectedObjectItem] = useState('');
//   const [activeTab, setActiveTab]                 = useState<ActiveTab>('Details');
//   const [isEditing, setIsEditing]                 = useState(false);
//   const [selectedObjectId, setSelectedObjectId]   = useState<string|null>(null);
//   const [attributes, setAttributes]               = useState<Attribute[]>([]);
//   const [draftAttributes, setDraftAttributes]     = useState<Attribute[]>([]);
//   const [showSaveMenu, setShowSaveMenu]           = useState(false);
//   const [showBottomPanel, setShowBottomPanel]     = useState(false);
//   const [tableFilterMode, setTableFilterMode]     = useState('By ID');
//   const [tableFilterInput, setTableFilterInput]   = useState('');
//   const [appliedFilter, setAppliedFilter]         = useState('');
//   const [drawCount, setDrawCount]                 = useState(0);
//   const [measureTotal, setMeasureTotal]           = useState<number|null>(null);
//   const [drawFinished, setDrawFinished]           = useState(false);

//   // keep refs in sync
//   useEffect(()=>{ activeToolRef.current = activeTool; },[activeTool]);
//   useEffect(()=>{ drawGeomRef.current   = drawGeometry; },[drawGeometry]);

//   useEffect(()=>{
//     const check=()=>setIsMobile(window.innerWidth<640);
//     check(); window.addEventListener('resize',check);
//     return ()=>window.removeEventListener('resize',check);
//   },[]);

//   // ── openPole stored in ref — marker handlers never get stale closures ─────
//   const openPole = useCallback((pole:Pole)=>{
//     setSelectedObjectItem('Pole');
//     setSelectedObjectId(pole.id);
//     setAttributes(pole.attributes.map(i=>({...i})));
//     setDraftAttributes(pole.attributes.map(i=>({...i})));
//     setIsEditing(false); setShowSaveMenu(false);
//     if(window.innerWidth<640) setShowOC(false);
//   },[]);
//   useEffect(()=>{ openPoleRef.current = openPole; },[openPole]);

//   // ── Add pole markers ──────────────────────────────────────────────────────
//   // Uses GeoJSON symbol layer instead of DOM markers so they stay fixed to
//   // map coordinates and never drift or stack during zoom.
//   const addPoleMarkers = useCallback((map: maplibregl.Map) => {
//     // Remove any existing DOM markers (fallback cleanup)
//     markersRef.current.forEach(m => m.remove());
//     markersRef.current = [];

//     const sourceId = 'poles-src';
//     const layerId  = 'poles-layer';
//     const hitId    = 'poles-hit';

//     // Remove existing layers/source if re-adding after style change
//     if (map.getLayer(hitId))    map.removeLayer(hitId);
//     if (map.getLayer(layerId))  map.removeLayer(layerId);
//     if (map.getSource(sourceId)) map.removeSource(sourceId);

//     map.addSource(sourceId, {
//       type: 'geojson',
//       data: {
//         type: 'FeatureCollection',
//         features: POLES.map(p => ({
//           type: 'Feature' as const,
//           geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
//           properties: { id: p.id },
//         })),
//       },
//     });

//     // Outer ring
//     map.addLayer({
//       id: layerId,
//       type: 'circle',
//       source: sourceId,
//       paint: {
//         'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 18, 10],
//         'circle-color': '#1a1a1a',
//         'circle-stroke-width': 2.5,
//         'circle-stroke-color': '#aaaaaa',
//         'circle-opacity': 1,
//       },
//     });

//     // Invisible wider hit area for easier clicking
//     map.addLayer({
//       id: hitId,
//       type: 'circle',
//       source: sourceId,
//       paint: {
//         'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 14, 18, 22],
//         'circle-color': 'rgba(0,0,0,0)',
//         'circle-opacity': 0,
//       },
//     });

//     // Hover cursor
//     map.on('mouseenter', hitId, () => { map.getCanvas().style.cursor = 'pointer'; });
//     map.on('mouseleave', hitId, () => { map.getCanvas().style.cursor = activeToolRef.current ? (
//       activeToolRef.current === 'Locate' ? 'crosshair' :
//       activeToolRef.current === 'Select' ? 'pointer'   :
//       activeToolRef.current === 'Draw'   ? 'crosshair' :
//       activeToolRef.current === 'Measure'? 'crosshair' : 'default'
//     ) : 'default'; });

//     // Click on pole
//     map.on('click', hitId, e => {
//       e.preventDefault();
//       const feat = e.features?.[0];
//       if (!feat) return;
//       const pid = feat.properties?.id as string;
//       const pole = POLES.find(p => p.id === pid);
//       if (pole) openPoleRef.current(pole);
//     });
//   }, []);

//   // ── Draw GeoJSON helpers ──────────────────────────────────────────────────
//   const setDrawData = useCallback((map:maplibregl.Map, pts:[number,number][], geom:DrawGeometry)=>{
//     const ptF = pts.map(([x,y])=>({type:'Feature',geometry:{type:'Point',coordinates:[x,y]},properties:{}}));
//     const liF = (geom==='line'||geom==='polygon') && pts.length>=2
//       ? [{type:'Feature',geometry:{type:'LineString',coordinates:geom==='polygon'?[...pts,pts[0]]:pts},properties:{}}]
//       : [];
//     const pgF = geom==='polygon' && pts.length>=3
//       ? [{type:'Feature',geometry:{type:'Polygon',coordinates:[[...pts,pts[0]]]},properties:{}}]
//       : [];
//     try{
//       (map.getSource('draw-pts-src') as maplibregl.GeoJSONSource)?.setData({type:'FeatureCollection',features:ptF as any});
//       (map.getSource('draw-ln-src')  as maplibregl.GeoJSONSource)?.setData({type:'FeatureCollection',features:liF as any});
//       (map.getSource('draw-pg-src')  as maplibregl.GeoJSONSource)?.setData({type:'FeatureCollection',features:pgF as any});
//     }catch{}
//   },[]);

//   // ── Add overlay sources (idempotent) ──────────────────────────────────────
//   const addOverlaySources = useCallback((map:maplibregl.Map)=>{
//     const sa=(id:string,cb:()=>void)=>{ if(!map.getSource(id)) cb(); };

//     sa('draw-pts-src',()=>{
//       map.addSource('draw-pts-src',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
//       map.addLayer({id:'draw-pts-layer',type:'circle',source:'draw-pts-src',
//         paint:{'circle-radius':5,'circle-color':'#111','circle-stroke-width':2,'circle-stroke-color':'#fff'}});
//     });
//     sa('draw-ln-src',()=>{
//       map.addSource('draw-ln-src',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
//       map.addLayer({id:'draw-ln-layer',type:'line',source:'draw-ln-src',
//         paint:{'line-color':'#111','line-width':2,'line-dasharray':[3,2]}});
//     });
//     sa('draw-pg-src',()=>{
//       map.addSource('draw-pg-src',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
//       map.addLayer({id:'draw-pg-layer',type:'fill',source:'draw-pg-src',
//         paint:{'fill-color':'#111','fill-opacity':0.18}});
//     });
//     sa('ruler-src',()=>{
//       map.addSource('ruler-src',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
//       map.addLayer({id:'ruler-layer',type:'line',source:'ruler-src',
//         paint:{'line-color':'#e11d48','line-width':2,'line-dasharray':[4,2]}});
//     });
//     sa('grid-src',()=>{
//       map.addSource('grid-src',{type:'geojson',data:buildGrid()});
//       map.addLayer({id:'grid-layer',type:'line',source:'grid-src',
//         paint:{'line-color':'rgba(0,0,0,0.18)','line-width':0.7},layout:{visibility:'none'}});
//     });
//     sa('heatmap-src',()=>{
//       map.addSource('heatmap-src',{type:'geojson',data:{type:'FeatureCollection',
//         features:POLES.map(p=>({type:'Feature' as const,geometry:{type:'Point' as const,coordinates:[p.lon,p.lat]},properties:{}}))}});
//       map.addLayer({id:'heatmap-layer',type:'heatmap',source:'heatmap-src',paint:{
//         'heatmap-weight':1,'heatmap-intensity':2,
//         'heatmap-color':['interpolate',['linear'],['heatmap-density'],
//           0,'rgba(0,0,255,0)',0.2,'rgba(0,200,255,0.6)',0.5,'rgba(0,220,80,0.8)',
//           0.8,'rgba(255,220,0,0.9)',1,'rgba(255,40,0,1)'],
//         'heatmap-radius':50,'heatmap-opacity':0}});
//     });
//     sa('cluster-src',()=>{
//       map.addSource('cluster-src',{type:'geojson',cluster:true,clusterMaxZoom:14,clusterRadius:50,
//         data:{type:'FeatureCollection',features:POLES.map(p=>({
//           type:'Feature' as const,geometry:{type:'Point' as const,coordinates:[p.lon,p.lat]},properties:{id:p.id}}))}});
//       map.addLayer({id:'cluster-circles',type:'circle',source:'cluster-src',filter:['has','point_count'],
//         paint:{'circle-color':'#111','circle-radius':18,'circle-stroke-width':2,'circle-stroke-color':'#fff'},layout:{visibility:'none'}});
//       map.addLayer({id:'cluster-count',type:'symbol',source:'cluster-src',filter:['has','point_count'],
//         layout:{'text-field':'{point_count_abbreviated}','text-size':12,visibility:'none'},paint:{'text-color':'#fff'}});
//       map.on('click','cluster-circles',e=>{
//         const f=e.features?.[0], src=map.getSource('cluster-src') as any, cid=f?.properties?.cluster_id;
//         if(!src||cid==null) return;
//         src.getClusterExpansionZoom(cid,(err:any,zoom:number)=>{
//           if(err) return;
//           const c=(f?.geometry as any)?.coordinates;
//           if(c) map.easeTo({center:c,zoom});
//         });
//       });
//     });
//   },[]);

//   // ── Apply plugin layer visuals ────────────────────────────────────────────
//   const applyPluginVisuals = useCallback((map:maplibregl.Map, plugins:Record<string,boolean>)=>{
//     try{ map.setLayoutProperty('grid-layer','visibility',plugins['grid']?'visible':'none'); }catch{}
//     try{ map.setPaintProperty('heatmap-layer','heatmap-opacity',plugins['heatmap']?0.75:0); }catch{}
//     try{
//       const v=plugins['cluster']?'visible':'none';
//       map.setLayoutProperty('cluster-circles','visibility',v);
//       map.setLayoutProperty('cluster-count','visibility',v);
//       // Hide/show GeoJSON pole layer when clustering
//       try{ map.setLayoutProperty('poles-layer','visibility',plugins['cluster']?'none':'visible'); }catch{}
//       try{ map.setLayoutProperty('poles-hit','visibility',plugins['cluster']?'none':'visible'); }catch{}
//     }catch{}
//   },[]);

//   // ── Map init ──────────────────────────────────────────────────────────────
//   useEffect(()=>{
//     // Guard: only initialize once (React StrictMode calls effects twice in dev)
//     if(initializedRef.current || !mapContainerRef.current) return;
//     initializedRef.current = true;

//     const map = new maplibregl.Map({
//       container: mapContainerRef.current,
//       style: getBaseMapStyle('OSM', false),
//       center: DEFAULT_CENTER,
//       zoom: DEFAULT_ZOOM,
//       attributionControl: false,
//       preserveDrawingBuffer: true,
//     });

//     map.on('load', () => {
//       mapReadyRef.current = true;
//       map.resize();
//       addOverlaySources(map);
//       addPoleMarkers(map);
//       // Ensure we're correctly centred at the right location with right zoom
//       map.jumpTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM });
//     });

//     map.on('move', () => {
//       const c = map.getCenter();
//       setLatLon({ lat: c.lat, lon: c.lng });
//       if (minimapRef.current) minimapRef.current.jumpTo({ center: map.getCenter(), zoom: Math.max(0, map.getZoom()-4) });
//     });

//     map.on('zoom', () => {
//       setZoomLevel(Math.round(map.getZoom()));
//     });

//     map.on('rotate', () => { setCompassAngle(map.getBearing()); });

//     // ── Map canvas click: draw + measure only
//     // (pole clicks are handled by the GeoJSON layer click handler)
//     map.on('click', e => {
//       const lng = e.lngLat.lng, lat = e.lngLat.lat;
//       const tool = activeToolRef.current, geom = drawGeomRef.current;

//       // Prevent draw/measure from firing when clicking on a pole
//       if ((e as any).defaultPrevented) return;

//       if (tool === 'Draw') {
//         let pts: [number,number][];
//         pts = geom === 'point' ? [[lng,lat]] : [...drawPtsRef.current, [lng,lat]];
//         drawPtsRef.current = pts;
//         setDrawCount(pts.length);
//         if (mapReadyRef.current) setDrawData(map, pts, geom);
//         return;
//       }

//       if (tool === 'Measure') {
//         const pts: [number,number][] = [...rulerPtsRef.current, [lng,lat]];
//         rulerPtsRef.current = pts;
//         if (mapReadyRef.current && pts.length >= 2) {
//           try {
//             (map.getSource('ruler-src') as maplibregl.GeoJSONSource)?.setData({
//               type: 'FeatureCollection',
//               features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: {} }],
//             });
//           } catch {}
//           let dist = 0;
//           for (let i = 1; i < pts.length; i++)
//             dist += haversineKm(pts[i-1][1], pts[i-1][0], pts[i][1], pts[i][0]);
//           setMeasureTotal(dist);
//           rulerPopupRef.current?.remove();
//           rulerPopupRef.current = new maplibregl.Popup({ closeButton: false, offset: 10 })
//             .setLngLat([lng, lat])
//             .setHTML(`<div style="font:bold 12px monospace;padding:4px 8px;color:#111;">${dist<1?`${(dist*1000).toFixed(0)} m`:`${dist.toFixed(3)} km`}</div>`)
//             .addTo(map);
//         }
//         const el = document.createElement('div');
//         el.style.cssText = 'width:9px;height:9px;border-radius:50%;background:#e11d48;border:2px solid #fff;pointer-events:none;';
//         rulerMarkersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([lng,lat]).addTo(map));
//       }
//     });

//     const onResize = () => { map.resize(); minimapRef.current?.resize(); };
//     window.addEventListener('resize', onResize);
//     mapRef.current = map;

//     return () => {
//       window.removeEventListener('resize', onResize);
//       minimapRef.current?.remove(); minimapRef.current = null;
//       map.remove(); mapRef.current = null; mapReadyRef.current = false;
//       initializedRef.current = false;
//     };
//   // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, []);

//   // ── Base map / night mode ─────────────────────────────────────────────────
//   useEffect(()=>{
//     const map = mapRef.current;
//     if (!map) return;
//     const center = map.getCenter(), zoom = map.getZoom();
//     mapReadyRef.current = false;
//     map.setStyle(getBaseMapStyle(selectedBaseMap, !!activePlugins['nightmode']));
//     map.once('style.load', () => {
//       mapReadyRef.current = true;
//       addOverlaySources(map);
//       addPoleMarkers(map);
//       applyPluginVisuals(map, activePlugins);
//       setDrawData(map, drawPtsRef.current, drawGeomRef.current);
//       map.jumpTo({ center, zoom });
//       map.resize();
//     });
//   // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [selectedBaseMap, activePlugins['nightmode']]);

//   // ── Plugin side-effects ───────────────────────────────────────────────────
//   useEffect(()=>{
//     const map = mapRef.current;
//     if (!map) return;
//     if (mapReadyRef.current) applyPluginVisuals(map, activePlugins);

//     if (activePlugins['export']) {
//       setActivePlugins(p=>({...p,export:false}));
//       map.once('idle', () => {
//         try {
//           const link = document.createElement('a');
//           link.href = map.getCanvas().toDataURL('image/png');
//           link.download = `gis-map-${Date.now()}.png`;
//           document.body.appendChild(link); link.click(); document.body.removeChild(link);
//         } catch { alert('Export failed.'); }
//       });
//     }

//     if (activePlugins['fullscreen']) {
//       setActivePlugins(p=>({...p,fullscreen:false}));
//       if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(()=>{});
//       else document.exitFullscreen?.().catch(()=>{});
//     }

//     if (activePlugins['geoloc']) {
//       setActivePlugins(p=>({...p,geoloc:false}));
//       if (!navigator.geolocation) { alert('Geolocation not supported.'); return; }
//       navigator.geolocation.getCurrentPosition(
//         pos => {
//           map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 15, essential: true });
//           new maplibregl.Popup({ closeButton: true, offset: 12 })
//             .setLngLat([pos.coords.longitude, pos.coords.latitude])
//             .setHTML('<div style="padding:5px 10px;font:12px sans-serif;color:#111;">📍 You are here</div>')
//             .addTo(map);
//         },
//         () => alert('Location access denied. Please allow location in browser settings.')
//       );
//     }

//     if (activePlugins['minimap']) {
//       if (!minimapRef.current && minimapContainerRef.current) {
//         const mm = new maplibregl.Map({
//           container: minimapContainerRef.current,
//           style: makeRasterStyle(OSM_TILES, 'mm-base', OSM_ATTR),
//           center: map.getCenter(),
//           zoom: Math.max(0, map.getZoom()-4),
//           interactive: false,
//           attributionControl: false,
//         });
//         mm.on('load', () => { mm.resize(); });
//         minimapRef.current = mm;
//       }
//     } else {
//       if (minimapRef.current) { minimapRef.current.remove(); minimapRef.current = null; }
//     }
//   // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [activePlugins]);

//   // ── Cursor — based on active tool ─────────────────────────────────────────
//   useEffect(()=>{
//     const canvas = mapRef.current?.getCanvas();
//     if (!canvas) return;
//     const c: Record<string,string> = {
//       Locate: 'crosshair', Select: 'pointer',
//       Draw: 'crosshair',   Measure: 'crosshair',
//       Plugins: 'default',
//     };
//     canvas.style.cursor = activeTool ? (c[activeTool] || 'default') : 'default';
//   }, [activeTool]);

//   // ── Zoom sync (slider → map) ──────────────────────────────────────────────
//   const zoomSyncRef = useRef(false);
//   useEffect(()=>{
//     const map = mapRef.current;
//     if (!map) return;
//     if (zoomSyncRef.current) { zoomSyncRef.current = false; return; }
//     if (Math.abs(map.getZoom() - zoomLevel) > 0.4) map.setZoom(zoomLevel);
//   }, [zoomLevel]);

//   // Sync state when map zoom changes (e.g. scroll wheel)
//   useEffect(()=>{
//     const map = mapRef.current;
//     if (!map) return;
//     const onZoom = () => {
//       zoomSyncRef.current = true;
//       setZoomLevel(Math.round(map.getZoom()));
//     };
//     map.on('zoom', onZoom);
//     return () => { map.off('zoom', onZoom); };
//   // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, []);

//   // ── Clear helpers ─────────────────────────────────────────────────────────
//   const clearDraw = useCallback(() => {
//     drawPtsRef.current = []; setDrawCount(0); setDrawFinished(false);
//     try {
//       (mapRef.current?.getSource('draw-pts-src') as maplibregl.GeoJSONSource)?.setData({type:'FeatureCollection',features:[]});
//       (mapRef.current?.getSource('draw-ln-src')  as maplibregl.GeoJSONSource)?.setData({type:'FeatureCollection',features:[]});
//       (mapRef.current?.getSource('draw-pg-src')  as maplibregl.GeoJSONSource)?.setData({type:'FeatureCollection',features:[]});
//     } catch {}
//   }, []);

//   const clearMeasure = useCallback(() => {
//     rulerPtsRef.current = []; setMeasureTotal(null);
//     rulerMarkersRef.current.forEach(m => m.remove()); rulerMarkersRef.current = [];
//     rulerPopupRef.current?.remove(); rulerPopupRef.current = null;
//     try { (mapRef.current?.getSource('ruler-src') as maplibregl.GeoJSONSource)?.setData({type:'FeatureCollection',features:[]}); } catch {}
//   }, []);

//   const saveDraw = useCallback(() => {
//     alert(`Saved ${drawCount} point(s) as ${drawGeomRef.current}`);
//     clearDraw(); setActiveTool(null); setShowDrawPopup(false);
//   }, [drawCount, clearDraw]);

//   // ── Tool click ───────────────────────────────────────────────────────────
//   const handleToolClick = (label: string) => {
//     const tool = label as ActiveTool;
//     if (tool === 'Locate') {
//       mapRef.current?.flyTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, essential: true });
//       return;
//     }
//     if (tool === 'Draw') {
//       setShowDrawPopup(p => !p);
//       if (activeTool !== 'Draw') setActiveTool('Draw');
//       return;
//     }
//     setShowDrawPopup(false);
//     setActiveTool(prev => {
//       if (prev === tool) { if (tool === 'Measure') clearMeasure(); return null; }
//       if (prev === 'Measure') clearMeasure();
//       return tool;
//     });
//   };

//   const selectDrawType = (geom: DrawGeometry) => {
//     setDrawGeometry(geom); drawGeomRef.current = geom;
//     clearDraw(); setActiveTool('Draw'); setShowDrawPopup(false); setDrawFinished(false);
//   };

//   const togglePlugin = (id: string) => setActivePlugins(prev => ({...prev, [id]: !prev[id]}));

//   // ── Object helpers ────────────────────────────────────────────────────────
//   const getPV = (pole:Pole, f:string) => pole.attributes.find(a=>a.field===f)?.value||'-';
//   const getLabel = () => { const n=selectedObjectItem||'Object'; return selectedObjectId?`${n} (${selectedObjectId})`:n; };
//   const getSelPole = () => POLES.find(p=>p.id===selectedObjectId)||null;
//   const zoomToSel = () => { const p=getSelPole(); if(p) mapRef.current?.flyTo({center:[p.lon,p.lat],zoom:18,essential:true}); };
//   const startEditing = () => { setDraftAttributes(attributes.map(i=>({...i}))); setIsEditing(true); setShowSaveMenu(false); };
//   const cancelEditing = () => { setDraftAttributes(attributes.map(i=>({...i}))); setIsEditing(false); setShowSaveMenu(false); };
//   const handleDraft = (f:string, v:string) => setDraftAttributes(prev=>prev.map(i=>i.field===f?{...i,value:v}:i));
//   const saveChanges = (cont:boolean) => { setAttributes(draftAttributes.map(i=>({...i}))); setIsEditing(cont); setShowSaveMenu(false); };
//   const deleteObj = () => { setSelectedObjectId(null); setAttributes([]); setDraftAttributes([]); setIsEditing(false); setShowSaveMenu(false); };
//   const closeEditor = () => { setSelectedObjectId(null); setIsEditing(false); setShowSaveMenu(false); };
//   const zoomIn  = () => { const z=Math.min((mapRef.current?.getZoom()||zoomLevel)+1,20); setZoomLevel(z); mapRef.current?.setZoom(z); };
//   const zoomOut = () => { const z=Math.max((mapRef.current?.getZoom()||zoomLevel)-1,1);  setZoomLevel(z); mapRef.current?.setZoom(z); };
//   const toggleGroup = (g:keyof ExpandedGroups) => setExpandedGroups(prev=>({...prev,[g]:!prev[g]}));

//   const createObjectData = (name:string) => {
//     const code=name.toUpperCase().slice(0,2), oid=`${code}-001`;
//     const data: Attribute[] = [
//       {field:'asset_id',value:oid},{field:'feature_type',value:name},{field:'status',value:'Active'},
//       {field:'owner',value:'Utility Network'},{field:'material',value:name==='Manhole'?'Concrete':'Steel'},
//       {field:'municipality',value:'Quezon City'},{field:'design_id',value:`${code}-1001`}];
//     setSelectedObjectItem(name); setSelectedObjectId(oid);
//     setAttributes(data); setDraftAttributes(data); setIsEditing(false); setShowSaveMenu(false);
//     if (isMobile) setShowOC(false);
//   };

//   const selectObjectItem = (name:string) => {
//     setSelectedObjectItem(name); setShowBottomPanel(true); setAppliedFilter(''); setTableFilterInput('');
//     if (name==='Pole') { setSelectedObjectId(null); setAttributes([]); setDraftAttributes([]); setIsEditing(false); setShowSaveMenu(false); return; }
//     createObjectData(name);
//   };

//   const bottomRows: BottomRow[] =
//     selectedObjectItem==='Pole' ? POLES.map(pole=>({
//       key:pole.id,id:pole.id,type:getPV(pole,'feature_type'),status:getPV(pole,'status'),
//       owner:getPV(pole,'owner'),material:getPV(pole,'material'),height:getPV(pole,'height_m'),
//       municipality:getPV(pole,'municipality'),designId:getPV(pole,'design_id'),
//       selected:selectedObjectId===pole.id,onClick:()=>openPole(pole)}))
//     : selectedObjectItem==='Manhole' ? [
//         {key:'MH-001',id:'MH-001',type:'Manhole',status:'Active',owner:'Utility Network',material:'Concrete',height:'-',municipality:'Quezon City',designId:'MH-2101',selected:selectedObjectId==='MH-001',onClick:()=>createObjectData('Manhole')},
//         {key:'MH-002',id:'MH-002',type:'Manhole',status:'Proposed',owner:'Utility Network',material:'Concrete',height:'-',municipality:'Quezon City',designId:'MH-2102'}]
//     : selectedObjectItem==='Cabinate' ? [
//         {key:'CB-001',id:'CB-001',type:'Cabinate',status:'Active',owner:'Metro Utility',material:'Steel',height:'-',municipality:'Quezon City',designId:'CB-3101',selected:selectedObjectId==='CB-001',onClick:()=>createObjectData('Cabinate')},
//         {key:'CB-002',id:'CB-002',type:'Cabinate',status:'Inactive',owner:'Metro Utility',material:'Steel',height:'-',municipality:'Quezon City',designId:'CB-3102'}]
//     : [];

//   const filteredRows = useMemo(()=>{
//     if (!appliedFilter.trim()) return bottomRows;
//     const q = appliedFilter.trim().toLowerCase();
//     return tableFilterMode==='By ID' ? bottomRows.filter(r=>r.id.toLowerCase().includes(q)) : bottomRows;
//   }, [bottomRows, appliedFilter, tableFilterMode]);

//   const downloadTable = () => {
//     const headers = ['ID','Type','Status','Owner','Material','Height','Municipality','Design ID'];
//     const csv = [headers, ...filteredRows.map(r=>[r.id,r.type,r.status,r.owner,r.material,r.height,r.municipality,r.designId])]
//       .map(l=>l.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
//     const a = document.createElement('a');
//     a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
//     a.download = `${selectedObjectItem||'objects'}-table.csv`; a.click();
//   };

//   // ── Layout ────────────────────────────────────────────────────────────────
//   const ocW        = showOC ? (isMobile ? Math.min(window.innerWidth*0.3,140) : 250) : 0;
//   const tlLeft     = showOC ? ocW+12 : 12;
//   const blLeft     = showOC ? ocW+12 : 12;
//   const rightShift = !isMobile && selectedObjectId ? 'right-[332px]' : 'right-3 sm:right-4';
//   const ctrlBot    = isMobile
//     ? (selectedObjectId ? 'bottom-[calc(50vh+10px)]' : showBottomPanel ? 'bottom-[calc(30vh+8px)]' : 'bottom-3')
//     : (showBottomPanel ? 'bottom-[calc(20vh+8px)]' : 'bottom-4');
//   const llBot      = isMobile
//     ? (selectedObjectId ? 'bottom-[calc(50vh+14px)]' : showBottomPanel ? 'bottom-[calc(30vh+10px)]' : 'bottom-3')
//     : (showBottomPanel ? 'bottom-[calc(20vh+8px)]' : 'bottom-4');

//   const ib = 'flex items-center justify-center border border-[#c8c8c8] bg-[#e8e8e8] text-[#111] shadow-sm transition-all hover:bg-[#d4d4d4] active:bg-[#c0c0c0]';
//   const pb = 'border border-[#111] bg-[#111] text-white hover:bg-[#333] transition-all';
//   const gb = 'border border-[#c8c8c8] bg-[#e8e8e8] text-[#111] hover:bg-[#d4d4d4] transition-all';

//   // Pan tool removed — MapLibre natively supports panning via click+drag
//   const tools = [
//     { icon:'⌖',  label:'Locate'  },
//     { icon:'⬚',  label:'Select'  },
//     { icon:'✚',  label:'Draw'    },
//     { icon:'📏', label:'Measure' },
//     { icon:'⚙',  label:'Plugins' },
//   ];

//   // ── Sub-components ────────────────────────────────────────────────────────
//   const LayersIcon = () => (
//     <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
//       <path d="M8 1L15 5L8 9L1 5L8 1Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none"/>
//       <path d="M1 9L8 13L15 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
//     </svg>
//   );

//   const SmallCompass = ({size=48}: {size?:number}) => (
//     <svg width={size} height={size} viewBox="0 0 54 54"
//       style={{transform:`rotate(${-compassAngle}deg)`,transition:'transform 0.3s ease',
//               filter:'drop-shadow(0 1px 3px rgba(0,0,0,0.2))',cursor:'pointer'}}
//       onClick={()=>mapRef.current?.resetNorth({duration:500})}
//       title="Click to reset north">
//       <circle cx="27" cy="27" r="26" fill="#e8e8e8" stroke="#c8c8c8" strokeWidth="0.8"/>
//       <circle cx="27" cy="27" r="22" fill="none" stroke="#d4d4d4" strokeWidth="0.4"/>
//       {Array.from({length:16},(_,i)=>{
//         const deg=i*22.5, rad=(deg*Math.PI)/180;
//         const isMaj=i%4===0, isMid=i%2===0&&!isMaj;
//         const r1=isMaj?18:isMid?19.5:20.5;
//         return <line key={i}
//           x1={27+r1*Math.sin(rad)} y1={27-r1*Math.cos(rad)}
//           x2={27+23*Math.sin(rad)} y2={27-23*Math.cos(rad)}
//           stroke={isMaj?'#666':'#bbb'} strokeWidth={isMaj?1:0.55}/>;
//       })}
//       <circle cx="27" cy="27" r="16" fill="#dedede" stroke="#c8c8c8" strokeWidth="0.6"/>
//       {[45,135,225,315].map(deg=>{
//         const rad=(deg*Math.PI)/180;
//         const tip={x:27+12*Math.sin(rad),y:27-12*Math.cos(rad)};
//         const l2={x:27+3.2*Math.sin(rad+Math.PI/2),y:27-3.2*Math.cos(rad+Math.PI/2)};
//         const r2={x:27+3.2*Math.sin(rad-Math.PI/2),y:27-3.2*Math.cos(rad-Math.PI/2)};
//         return <polygon key={deg} points={`${tip.x},${tip.y} ${l2.x},${l2.y} ${r2.x},${r2.y}`} fill="#c0c0c0"/>;
//       })}
//       <polygon points="27,3.5 29.5,27 27,21 24.5,27" fill="#e11d48"/>
//       <polygon points="27,50.5 29.5,27 27,33 24.5,27" fill="#bbb"/>
//       <polygon points="50.5,27 27,24.5 33,27 27,29.5" fill="#888"/>
//       <polygon points="3.5,27 27,24.5 21,27 27,29.5" fill="#888"/>
//       <circle cx="27" cy="27" r="6" fill="#e8e8e8" stroke="#c8c8c8" strokeWidth="0.6"/>
//       <circle cx="27" cy="27" r="2.8" fill="#222"/>
//       <circle cx="27" cy="27" r="1.2" fill="#e8e8e8"/>
//       <text x="27" y="15" textAnchor="middle" fontSize="5.5" fontWeight="700" fill="#111" fontFamily="sans-serif">N</text>
//       <text x="27" y="44.5" textAnchor="middle" fontSize="5" fontWeight="500" fill="#999" fontFamily="sans-serif">S</text>
//       <text x="43.5" y="28.8" textAnchor="middle" fontSize="5" fontWeight="500" fill="#999" fontFamily="sans-serif">E</text>
//       <text x="10.5" y="28.8" textAnchor="middle" fontSize="5" fontWeight="500" fill="#999" fontFamily="sans-serif">W</text>
//     </svg>
//   );

//   // ── Draw popup: compact inline buttons ───────────────────────────────────
//   const DrawPopup = () => (
//     <div className="absolute right-10 top-0 z-50 flex flex-col items-end gap-1.5">
//       <div className="mb-0.5 rounded-full border border-[#c8c8c8] bg-white/90 px-2.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-[#555] shadow-sm whitespace-nowrap backdrop-blur-sm">
//         Draw Type
//       </div>
//       {([
//         { key: 'point'   as DrawGeometry, label: 'Point',   Ic: IconPoint   },
//         { key: 'line'    as DrawGeometry, label: 'Line',    Ic: IconLine    },
//         { key: 'polygon' as DrawGeometry, label: 'Polygon', Ic: IconPolygon },
//       ]).map(({ key, label, Ic }) => {
//         const active = drawGeometry === key;
//         return (
//           <button key={key} type="button" onClick={() => selectDrawType(key)} title={label}
//             className={[
//               'flex items-center gap-1.5 rounded-full px-2.5 py-1.5 shadow border transition-all duration-150 active:scale-95 select-none whitespace-nowrap',
//               active
//                 ? 'bg-[#111] border-[#111] text-white scale-105'
//                 : 'bg-white border-[#d4d4d4] text-[#333] hover:border-[#999] hover:scale-105',
//             ].join(' ')}>
//             <Ic active={active} />
//             <span className="text-[10px] font-semibold leading-none">{label}</span>
//           </button>
//         );
//       })}
//     </div>
//   );

//   // ── Plugins panel ─────────────────────────────────────────────────────────
//   const PluginsPanel = () => (
//     <div className="absolute right-10 top-0 z-50 w-[230px] overflow-hidden rounded-xl border border-[#c8c8c8] bg-[#e8e8e8] shadow-2xl">
//       <div className="border-b border-[#c8c8c8] bg-[#dedede] px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-[#555]">Map Plugins</div>
//       {PLUGINS.map((p,i) => (
//         <div key={p.id} className={`flex items-center justify-between px-3 py-2.5 ${i>0?'border-t border-[#e0e0e0]':''} hover:bg-[#d8d8d8] transition-all`}>
//           <div className="flex flex-col gap-0.5">
//             <span className="text-[12px] font-semibold text-[#111] leading-tight">{p.label}</span>
//             <span className="text-[10px] text-[#888] leading-tight">{p.desc}</span>
//           </div>
//           <button type="button" onClick={() => togglePlugin(p.id)}
//             className={`relative ml-3 h-5 w-9 shrink-0 rounded-full transition-all duration-200 border ${activePlugins[p.id]?'bg-[#111] border-[#111]':'bg-[#ccc] border-[#bbb]'}`}>
//             <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-all duration-200 ${activePlugins[p.id]?'left-[18px]':'left-[2px]'}`}/>
//           </button>
//         </div>
//       ))}
//     </div>
//   );

//   const renderDetails = (small: boolean) =>
//     (isEditing ? draftAttributes : attributes).map((item, idx) => (
//       <div key={item.field}
//         className={`grid items-center border-b border-[#d4d4d4] leading-none ${small?'min-h-[24px] grid-cols-[82px_1fr] text-[11px]':'min-h-[26px] grid-cols-[100px_1fr] text-[12px]'} ${idx%2===0?'bg-[#e8e8e8]':'bg-[#efefef]'}`}>
//         <div className="truncate border-r border-[#d4d4d4] px-2 py-[3px] font-medium text-[#111]">{item.field}</div>
//         <div className="px-2 py-[2px]">
//           {isEditing ? (
//             item.field==='status' ? (
//               <select value={item.value} onChange={e=>handleDraft(item.field,e.target.value)}
//                 className={`w-full rounded border border-[#c8c8c8] bg-white px-1.5 text-[#111] outline-none ${small?'h-[20px] text-[11px]':'h-6 text-[12px]'}`}>
//                 <option>Active</option><option>Proposed</option><option>Inactive</option>
//               </select>
//             ) : (
//               <input value={item.value} onChange={e=>handleDraft(item.field,e.target.value)}
//                 className={`w-full rounded border border-[#c8c8c8] bg-white px-1.5 text-[#111] outline-none ${small?'h-[20px] text-[11px]':'h-6 text-[12px]'}`}/>
//             )
//           ) : (
//             <div className={`truncate text-[#333] ${small?'text-[11px]':'text-[12px]'}`}>{item.value}</div>
//           )}
//         </div>
//       </div>
//     ));

//   const renderLayers = (small: boolean) =>
//     ['Pole','Substation','Cabinate','Cable'].map((layer, idx) => (
//       <div key={layer}
//         className={`grid grid-cols-[1fr_auto] items-center border-b border-[#d4d4d4] px-3 leading-none ${small?'min-h-[24px] py-[3px] text-[11px]':'min-h-[26px] py-[4px] text-[12px]'} ${idx%2===0?'bg-[#e8e8e8]':'bg-[#efefef]'}`}>
//         <span className="truncate text-[#555]">{layer}</span>
//         <input type="checkbox" defaultChecked className="accent-[#111]"/>
//       </div>
//     ));

//   // ── Render ────────────────────────────────────────────────────────────────
//   return (
//     <div className="relative h-screen w-full overflow-hidden bg-[#f2f2f2] font-sans text-[#111]">

//       {/* Map canvas */}
//       <div ref={mapContainerRef} className="absolute inset-0 z-0" style={{width:'100%',height:'100%'}}/>

//       {/* Subtle grid texture overlay */}
//       <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(rgba(0,0,0,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.03)_1px,transparent_1px)] bg-[size:40px_40px]"/>

//       {/* ── Minimap ── */}
//       {activePlugins['minimap'] && (
//         <div ref={minimapContainerRef}
//           className={`absolute z-30 overflow-hidden rounded-xl border-2 border-[#c8c8c8] shadow-lg ${isMobile?'bottom-20 left-20 w-[100px] h-[70px]':'bottom-24 left-20 w-[180px] h-[120px]'}`}/>
//       )}

//       {/* Mobile OC backdrop */}
//       {isMobile && showOC && <div className="absolute inset-0 z-[28] bg-black/20" onClick={()=>setShowOC(false)}/>}

//       {/* ── Top-left: hamburger + search ── */}
//       <div className="absolute top-2 z-30 flex items-center gap-1.5 transition-all duration-300" style={{left:`${tlLeft}px`}}>
//         <button type="button" onClick={()=>{setShowTopMenu(p=>!p);setShowBaseMapDrop(false);setShowDrawPopup(false);}}
//           className={`${ib} h-8 w-8 sm:h-9 sm:w-9 rounded-full`}>
//           <div className="flex flex-col gap-[3px]">
//             <span className="block h-[2px] w-[14px] rounded bg-current"/>
//             <span className="block h-[2px] w-[14px] rounded bg-current"/>
//             <span className="block h-[2px] w-[14px] rounded bg-current"/>
//           </div>
//         </button>
//         <div className="flex h-8 sm:h-9 w-[160px] sm:w-[240px] items-center rounded-full border border-[#c8c8c8] bg-[#f2f2f2]/98 px-3 shadow-sm">
//           <input className="w-full bg-transparent text-[11px] sm:text-[12px] text-[#111] outline-none placeholder:text-[#888]" placeholder="Search..."/>
//         </div>
//         {showTopMenu && (
//           <div className={`absolute left-0 z-50 overflow-hidden rounded-xl border border-[#c8c8c8] bg-[#e8e8e8] shadow-lg ${isMobile?'top-10 min-w-[128px]':'top-11 min-w-[170px]'}`}>
//             {[
//               {label:'Home',action:()=>{mapRef.current?.flyTo({center:DEFAULT_CENTER,zoom:DEFAULT_ZOOM,essential:true});setShowTopMenu(false);}},
//               {label:'Bookmark',action:()=>setShowTopMenu(false)},
//               {label:'Object Controller',action:()=>{setShowOC(p=>!p);setShowTopMenu(false);}},
//             ].map((item,i) => (
//               <button key={item.label} type="button" onClick={item.action}
//                 className={`flex w-full items-center text-left text-[#111] hover:bg-[#d4d4d4] ${isMobile?'px-3 py-2 text-[11px]':'px-4 py-2.5 text-[13px]'} ${i>0?'border-t border-[#c8c8c8]':''}`}>
//                 {item.label}
//               </button>
//             ))}
//           </div>
//         )}
//       </div>

//       {/* ── Top-right: logo + user ── */}
//       <div className={`absolute top-2 z-30 flex items-center gap-1.5 sm:gap-2 transition-all duration-300 ${rightShift}`}>
//         <a href="https://redplanetgrp.com" target="_blank" rel="noreferrer">
//           <img src="https://redplanetgrp.com/wp-content/uploads/2025/04/Redplanet-Solutions.webp" alt="RedPlanet" className="h-7 sm:h-9 w-auto object-contain"/>
//         </a>
//         <button type="button" className={`${ib} h-8 w-8 sm:h-9 sm:w-9 rounded-full`}>
//           <span className="text-sm">👤</span>
//         </button>
//       </div>

//       {/* ── Right toolbar ── */}
//       <div className={`absolute top-[46px] sm:top-[52px] z-30 flex flex-col gap-1.5 transition-all duration-300 ${rightShift}`}>
//         {/* Base map */}
//         <div className="relative">
//           <button type="button" onClick={()=>{setShowBaseMapDrop(p=>!p);setShowTopMenu(false);setShowDrawPopup(false);}}
//             className={`${ib} h-8 w-8 sm:h-9 sm:w-9 rounded-xl`}>
//             <LayersIcon/>
//           </button>
//           {showBaseMapDrop && (
//             <div className="absolute right-0 top-10 sm:top-11 z-50 min-w-[160px] overflow-hidden rounded-xl border border-[#c8c8c8] bg-[#e8e8e8] shadow-lg">
//               <div className="border-b border-[#c8c8c8] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#555]">Base Map</div>
//               {['OSM','Google','Google Satellite'].map((bm,i) => (
//                 <button key={bm} type="button"
//                   onClick={()=>{
//                     setSelectedBaseMap(bm); setShowBaseMapDrop(false);
//                     if(bm==='Google'&&!GOOGLE_ROAD_TILES_URL) alert('Set GOOGLE_ROAD_TILES_URL constant with your Google Map Tiles API URL.');
//                     if(bm==='Google Satellite'&&!GOOGLE_SAT_TILES_URL) alert('Set GOOGLE_SAT_TILES_URL constant with your Google Map Tiles API URL.');
//                   }}
//                   className={`flex w-full items-center justify-between px-3 py-2 text-left text-[12px] transition-all ${selectedBaseMap===bm?'bg-[#111] text-white':'text-[#111] hover:bg-[#d4d4d4]'} ${i>0?'border-t border-[#c8c8c8]':''}`}>
//                   <span>{bm}</span>
//                   {selectedBaseMap===bm && <span className="text-xs">✓</span>}
//                 </button>
//               ))}
//             </div>
//           )}
//         </div>

//         {/* Tool buttons */}
//         {tools.map(tool => {
//           const isActive = activeTool === tool.label;
//           return (
//             <div key={tool.label} className="relative">
//               <button type="button" title={tool.label} onClick={()=>handleToolClick(tool.label)}
//                 className={`h-8 w-8 sm:h-9 sm:w-9 rounded-xl text-xs sm:text-sm font-bold border transition-all flex items-center justify-center shadow-sm ${isActive?'bg-[#111] text-white border-[#111]':'bg-[#e8e8e8] text-[#111] border-[#c8c8c8] hover:bg-[#d4d4d4]'}`}>
//                 {tool.icon}
//               </button>
//               {tool.label==='Plugins' && isActive && <PluginsPanel/>}
//               {tool.label==='Draw' && activeTool==='Draw' && showDrawPopup && <DrawPopup/>}
//             </div>
//           );
//         })}
//       </div>

//       {/* ── Draw status bar ── */}
//       {activeTool==='Draw' && drawCount>0 && (
//         <div className={`absolute left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-full border border-[#c8c8c8] bg-[#e8e8e8]/98 px-4 py-1.5 shadow text-[11px] text-[#111] whitespace-nowrap ${showBottomPanel?'bottom-[calc(20vh+52px)]':'bottom-14'}`}>
//           <span className="font-medium capitalize">{drawGeometry}</span>
//           <span className="text-[#888]">{drawCount} pt{drawCount!==1?'s':''}</span>
//           <span className="text-[#d4d4d4]">|</span>
//           {!drawFinished
//             ? <button onClick={()=>setDrawFinished(true)} className={`${pb} rounded-full px-3 py-1 text-[10px] font-semibold`}>Finish</button>
//             : <button onClick={saveDraw} className={`${pb} rounded-full px-3 py-1 text-[10px] font-semibold`}>💾 Save</button>
//           }
//           <button onClick={clearDraw} className="text-[10px] text-[#e11d48] underline font-medium">Clear</button>
//         </div>
//       )}

//       {/* ── Measure bar ── */}
//       {activeTool==='Measure' && (
//         <div className={`absolute left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-full border border-[#c8c8c8] bg-[#e8e8e8]/98 px-4 py-1.5 shadow text-[11px] text-[#111] whitespace-nowrap ${showBottomPanel?'bottom-[calc(20vh+52px)]':'bottom-14'}`}>
//           <span className="font-medium">Measure</span>
//           <span className="text-[#888]">
//             {measureTotal!=null
//               ? (measureTotal<1 ? `${(measureTotal*1000).toFixed(0)} m` : `${measureTotal.toFixed(3)} km`)
//               : 'Click map to start'}
//           </span>
//           <span className="text-[#d4d4d4]">|</span>
//           <button onClick={clearMeasure} className="text-[10px] text-[#e11d48] underline font-medium">Clear</button>
//         </div>
//       )}

//       {/* ── Object Controller ── */}
//       <div className={`absolute inset-y-0 left-0 z-30 border-r border-[#c8c8c8] bg-[#e8e8e8]/98 shadow-xl transition-transform duration-300 ease-in-out ${showOC?'translate-x-0':'-translate-x-full'}`}
//         style={{width:isMobile?'min(30vw,140px)':'250px'}}>
//         <div className="flex items-center justify-between border-b border-[#c8c8c8] bg-[#dedede] px-2 py-2 text-[11px] font-semibold text-[#111] sm:px-3 sm:text-[13px]">
//           <span>Object Controller</span>
//           <button type="button" onClick={()=>setShowOC(false)} className={`${ib} h-6 w-6 shrink-0 rounded-md text-xs font-bold`}>←</button>
//         </div>
//         <div className="h-[calc(100%-41px)] overflow-y-auto px-1 py-2 sm:px-2">
//           {([
//             {key:'Segment' as keyof ExpandedGroups, items:['Cable','Cable Segment','Fiber Optic','Wire']},
//             {key:'Distribution Structure' as keyof ExpandedGroups, items:['Pole','Manhole','Cabinate']},
//             {key:'Equipment' as keyof ExpandedGroups, items:['Power Transformer','Service Point','Light','Meter']},
//           ]).map((group,gi) => (
//             <div key={group.key} className={gi>0?'mt-1 space-y-0.5':'space-y-0.5'}>
//               <button type="button" onClick={()=>toggleGroup(group.key)}
//                 className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-left font-medium text-[#111] transition-all hover:bg-[#d4d4d4] sm:px-2.5 sm:py-1.5">
//                 <span className={isMobile?'text-[9.5px] leading-tight':'text-[13px] leading-tight'}>{group.key}</span>
//                 <span className="shrink-0 text-[8px] sm:text-[10px]">{expandedGroups[group.key]?'▾':'▸'}</span>
//               </button>
//               {expandedGroups[group.key] && (
//                 <div className="ml-1.5 space-y-0.5 border-l border-[#c8c8c8] pl-1.5 sm:ml-3 sm:pl-2.5">
//                   {group.items.map(item => (
//                     <button key={item} type="button" onClick={()=>selectObjectItem(item)}
//                       className={`block w-full rounded-md px-1 py-1 text-left transition-all sm:px-2.5 sm:py-1.5 ${isMobile?'text-[9px] leading-tight':'text-[12px]'} ${selectedObjectItem===item?'bg-[#111] text-white':'text-[#555] hover:bg-[#d4d4d4] hover:text-[#111]'}`}>
//                       {item}
//                     </button>
//                   ))}
//                 </div>
//               )}
//             </div>
//           ))}
//         </div>
//       </div>

//       {/* ── Object editor – desktop ── */}
//       {selectedObjectId && !isMobile && (
//         <div className="absolute inset-y-0 right-0 z-30 flex w-[320px] flex-col border-l border-[#c8c8c8] bg-[#e8e8e8]/98 shadow-xl">
//           <div className="flex items-center justify-between border-b border-[#c8c8c8] bg-[#dedede] px-3 py-2">
//             <div className="text-sm font-semibold text-[#111]">Object Editor</div>
//             <button type="button" onClick={closeEditor} className={`${ib} h-7 w-7 rounded-md text-sm font-bold`}>→</button>
//           </div>
//           <div className="flex items-center justify-between gap-2 border-b border-[#c8c8c8] bg-[#e8e8e8] px-3 py-2">
//             <div className="truncate text-xs text-[#555]">Selected: <span className="font-semibold text-[#111]">{getLabel()}</span></div>
//             <div className="flex items-center gap-2">
//               <button type="button" onClick={zoomToSel} className={`${ib} h-8 w-8 rounded-md text-sm font-bold`}>⌖</button>
//               {!isEditing && <button onClick={startEditing} className={`${gb} rounded-md px-3 py-1.5 text-xs font-medium`}>Edit</button>}
//             </div>
//           </div>
//           <div className="flex border-b border-[#c8c8c8] bg-[#dedede] text-xs">
//             {(['Details','Layers'] as const).map(tab => (
//               <button key={tab} onClick={()=>setActiveTab(tab)}
//                 className={`px-4 py-2 transition ${activeTab===tab?'border-b-2 border-[#111] bg-[#e8e8e8] font-semibold text-[#111]':'text-[#555] hover:bg-[#d4d4d4]'}`}>
//                 {tab}
//               </button>
//             ))}
//           </div>
//           <div className={`${isEditing?'h-[calc(100%-120px)]':'h-[calc(100%-96px)]'} overflow-y-auto bg-[#e8e8e8]`}>
//             {activeTab==='Details' ? renderDetails(false) : renderLayers(false)}
//           </div>
//           {isEditing && (
//             <div className="flex items-center justify-end gap-2 border-t border-[#c8c8c8] bg-[#dedede] px-2 py-2">
//               <button onClick={cancelEditing} className={`${gb} rounded-md px-2.5 py-1.5 text-xs font-medium`}>Cancel</button>
//               <button onClick={deleteObj}     className={`${gb} rounded-md px-2.5 py-1.5 text-xs font-medium`}>Delete</button>
//               <div className="relative">
//                 <button type="button" onClick={()=>setShowSaveMenu(p=>!p)} className={`${pb} rounded-md px-2.5 py-1.5 text-xs font-medium`}>Save ▾</button>
//                 {showSaveMenu && (
//                   <div className="absolute bottom-full right-0 mb-2 min-w-[160px] overflow-hidden rounded-md border border-[#c8c8c8] bg-[#e8e8e8] shadow-lg">
//                     <button type="button" onClick={()=>saveChanges(false)} className="block w-full px-3 py-2 text-left text-xs text-[#111] hover:bg-[#d4d4d4]">Save</button>
//                     <button type="button" onClick={()=>saveChanges(true)}  className="block w-full border-t border-[#c8c8c8] px-3 py-2 text-left text-xs text-[#111] hover:bg-[#d4d4d4]">Save &amp; Continue</button>
//                   </div>
//                 )}
//               </div>
//             </div>
//           )}
//         </div>
//       )}

//       {/* ── Object editor – mobile ── */}
//       {selectedObjectId && isMobile && (
//         <div className="absolute bottom-0 left-0 right-0 z-30 flex flex-col rounded-t-xl border-t border-[#c8c8c8] bg-[#e8e8e8]/98 shadow-2xl" style={{maxHeight:'50vh'}}>
//           <div className="flex shrink-0 justify-center pb-1 pt-2"><div className="h-[3px] w-8 rounded-full bg-[#c0c0c0]"/></div>
//           <div className="flex shrink-0 items-center justify-between border-b border-[#c8c8c8] bg-[#dedede] px-3 py-1.5">
//             <span className="text-[12px] font-semibold text-[#111]">Object Editor</span>
//             <div className="flex items-center gap-1.5">
//               <button type="button" onClick={zoomToSel} className={`${ib} h-6 w-6 rounded-md text-xs`}>⌖</button>
//               {!isEditing && <button onClick={startEditing} className={`${gb} rounded-md px-2 py-1 text-[11px] font-medium`}>Edit</button>}
//               <button type="button" onClick={closeEditor} className={`${ib} h-6 w-6 rounded-md text-xs font-bold`}>↓</button>
//             </div>
//           </div>
//           <div className="shrink-0 border-b border-[#c8c8c8] px-3 py-1">
//             <span className="text-[11px] text-[#555]">Selected: </span>
//             <span className="text-[11px] font-semibold text-[#111]">{getLabel()}</span>
//           </div>
//           <div className="flex shrink-0 border-b border-[#c8c8c8] bg-[#dedede] text-[11px]">
//             {(['Details','Layers'] as const).map(tab => (
//               <button key={tab} onClick={()=>setActiveTab(tab)}
//                 className={`px-4 py-1.5 transition ${activeTab===tab?'border-b-2 border-[#111] bg-[#e8e8e8] font-semibold text-[#111]':'text-[#555] hover:bg-[#d4d4d4]'}`}>
//                 {tab}
//               </button>
//             ))}
//           </div>
//           <div className="flex-1 overflow-y-auto bg-[#e8e8e8]">{activeTab==='Details' ? renderDetails(true) : renderLayers(true)}</div>
//           {isEditing && (
//             <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-[#c8c8c8] bg-[#dedede] px-2 py-1.5">
//               <button onClick={cancelEditing} className={`${gb} rounded-md px-2 py-1 text-[11px] font-medium`}>Cancel</button>
//               <button onClick={deleteObj}     className={`${gb} rounded-md px-2 py-1 text-[11px] font-medium`}>Delete</button>
//               <div className="relative">
//                 <button type="button" onClick={()=>setShowSaveMenu(p=>!p)} className={`${pb} rounded-md px-2 py-1 text-[11px] font-medium`}>Save ▾</button>
//                 {showSaveMenu && (
//                   <div className="absolute bottom-full right-0 mb-1 min-w-[140px] overflow-hidden rounded-md border border-[#c8c8c8] bg-[#e8e8e8] shadow-lg">
//                     <button type="button" onClick={()=>saveChanges(false)} className="block w-full px-3 py-2 text-left text-[11px] text-[#111] hover:bg-[#d4d4d4]">Save</button>
//                     <button type="button" onClick={()=>saveChanges(true)}  className="block w-full border-t border-[#c8c8c8] px-3 py-2 text-left text-[11px] text-[#111] hover:bg-[#d4d4d4]">Save &amp; Continue</button>
//                   </div>
//                 )}
//               </div>
//             </div>
//           )}
//         </div>
//       )}

//       {/* ── Zoom + Compass ── */}
//       <div className={`absolute z-30 flex flex-col items-center gap-1.5 transition-all duration-300 ${ctrlBot}`} style={{left:`${blLeft}px`}}>
//         <div className="flex flex-col items-center overflow-hidden rounded-2xl border border-[#c8c8c8] bg-[#e8e8e8]/95 shadow-sm">
//           <button type="button" onClick={zoomIn}
//             className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center border-b border-[#c8c8c8] text-sm sm:text-base font-bold text-[#111] hover:bg-[#d4d4d4] transition-all">+</button>
//           <div className="flex items-center justify-center px-1 py-1.5">
//             <input type="range" min="1" max="20" value={zoomLevel} onChange={e=>{const z=Number(e.target.value);setZoomLevel(z);mapRef.current?.setZoom(z);}}
//               className="vertical-zoom-slider cursor-pointer appearance-none bg-transparent"
//               style={{writingMode:'vertical-lr',direction:'rtl',width:'7px',height:isMobile?'42px':'48px'}}/>
//           </div>
//           <button type="button" onClick={zoomOut}
//             className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center border-t border-[#c8c8c8] text-sm sm:text-base font-bold text-[#111] hover:bg-[#d4d4d4] transition-all">−</button>
//         </div>
//         <SmallCompass size={isMobile?44:48}/>
//       </div>

//       {/* ── Lat/Lon display ── */}
//       <div className={`absolute z-30 rounded-xl border border-[#c8c8c8] bg-[#e8e8e8]/95 px-2 py-1 sm:px-2.5 sm:py-1.5 text-[10px] sm:text-[11px] text-[#555] shadow-sm transition-all duration-300 ${rightShift} ${llBot}`}>
//         <span className="font-bold text-[#111]">Lat:</span> {latLon.lat.toFixed(4)}{' '}
//         <span className="text-[#c8c8c8]">|</span>{' '}
//         <span className="font-bold text-[#111]">Lon:</span> {latLon.lon.toFixed(4)}
//       </div>

//       {/* ── Bottom table panel ── */}
//       {showBottomPanel && (
//         <div className={`absolute bottom-0 left-0 right-0 z-40 border-t border-[#c8c8c8] bg-[#e8e8e8]/98 shadow-xl ${isMobile?'h-[30vh]':'h-[20vh] min-h-[140px] max-h-[190px]'}`}>
//           <div className="flex items-center gap-1.5 border-b border-[#c8c8c8] bg-[#dedede] px-2 py-1.5 flex-wrap">
//             <div className="mr-auto shrink-0 truncate text-[12px] font-semibold text-[#111]">{selectedObjectItem||'Objects'}</div>
//             <select value={tableFilterMode} onChange={e=>setTableFilterMode(e.target.value)}
//               className="h-7 rounded-md border border-[#c8c8c8] bg-[#e8e8e8] px-1.5 text-[11px] font-medium text-[#111] outline-none">
//               <option>By ID</option>
//             </select>
//             <input value={tableFilterInput} onChange={e=>setTableFilterInput(e.target.value)} placeholder="Filter..."
//               className="h-7 w-[80px] rounded-md border border-[#c8c8c8] bg-white px-2 text-[11px] text-[#111] outline-none placeholder:text-[#888]"/>
//             <button type="button" onClick={()=>setAppliedFilter(tableFilterInput)} className={`${pb} h-7 rounded-md px-2.5 text-[11px] font-semibold`}>Run</button>
//             <button type="button" onClick={downloadTable} className={`${gb} h-7 rounded-md px-2.5 text-[11px] font-semibold`}>Download</button>
//             <button onClick={()=>setShowBottomPanel(false)} className={`${ib} h-7 w-7 rounded-md text-xs font-bold`}>↓</button>
//           </div>
//           <div className="h-[calc(100%-42px)] overflow-auto">
//             <table className="min-w-full table-fixed text-[11px]">
//               <thead className="sticky top-0 bg-[#dedede]">
//                 <tr className="text-left text-[#111]">
//                   {['ID','Type','Status','Owner','Material','Height','Municipality','Design ID'].map(h=>(
//                     <th key={h} className="truncate whitespace-nowrap px-2 py-[3px] font-semibold">{h}</th>
//                   ))}
//                 </tr>
//               </thead>
//               <tbody>
//                 {filteredRows.map((row,idx) => (
//                   <tr key={row.key} onClick={row.onClick}
//                     className={`h-[23px] leading-none transition-colors ${row.onClick?'cursor-pointer':''} ${row.selected?'border-l-2 border-l-[#111] bg-[#d4d4d4]':idx%2===0?'bg-[#e8e8e8] hover:bg-[#d4d4d4]':'bg-[#efefef] hover:bg-[#d4d4d4]'}`}>
//                     <td className="truncate px-2 py-[3px] font-medium text-[#111]">{row.id}</td>
//                     <td className="truncate px-2 py-[3px] text-[#555]">{row.type}</td>
//                     <td className="truncate px-2 py-[3px] text-[#555]">{row.status}</td>
//                     <td className="truncate px-2 py-[3px] text-[#555]">{row.owner}</td>
//                     <td className="truncate px-2 py-[3px] text-[#555]">{row.material}</td>
//                     <td className="truncate px-2 py-[3px] text-[#555]">{row.height}</td>
//                     <td className="truncate px-2 py-[3px] text-[#555]">{row.municipality}</td>
//                     <td className="truncate px-2 py-[3px] text-[#555]">{row.designId}</td>
//                   </tr>
//                 ))}
//                 {filteredRows.length===0 && (
//                   <tr><td colSpan={8} className="px-3 py-4 text-center text-[11px] text-[#888]">No records found.</td></tr>
//                 )}
//               </tbody>
//             </table>
//           </div>
//         </div>
//       )}

//       <style>{`
//         .maplibregl-ctrl-bottom-left,
//         .maplibregl-ctrl-bottom-right,
//         .maplibregl-ctrl-top-left,
//         .maplibregl-ctrl-top-right { display: none !important; }

//         .vertical-zoom-slider::-webkit-slider-runnable-track{width:5px;border-radius:9999px;background:#c8c8c8;}
//         .vertical-zoom-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:10px;height:10px;border-radius:9999px;background:#111;border:2px solid #e8e8e8;box-shadow:0 1px 3px rgba(0,0,0,.3);margin-left:-3px;}
//         .vertical-zoom-slider::-moz-range-track{width:5px;border-radius:9999px;background:#c8c8c8;}
//         .vertical-zoom-slider::-moz-range-thumb{width:10px;height:10px;border-radius:9999px;background:#111;border:2px solid #e8e8e8;box-shadow:0 1px 3px rgba(0,0,0,.3);}
//         .maplibregl-canvas{outline:none;}
//         .maplibregl-popup-content{padding:0!important;border-radius:8px!important;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.2)!important;}
//       `}</style>
//     </div>
//   );
// }