// User

'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// ── Types ─────────────────────────────────────────────────────────────────────
type Attribute  = { field: string; value: string };
type Pole       = { id: string; lat: number; lon: number; attributes: Attribute[] };
type ActiveTab  = 'Details' | 'Layers';
type ExpandedGroups = { Segment: boolean; 'Distribution Structure': boolean; Equipment: boolean };
type ActiveTool = 'Locate' | 'Select' | 'Draw' | 'Measure' | 'Clear' | 'Plugins' | null;
type DrawGeometry = 'point' | 'line' | 'polygon';
type BottomRow  = {
  key: string; id: string; type: string; status: string; owner: string;
  material: string; height: string; municipality: string; designId: string;
  onClick?: () => void; selected?: boolean;
};

// ── Map config ────────────────────────────────────────────────────────────────
const GOOGLE_ROAD_TILES_URL = '';
const GOOGLE_SAT_TILES_URL  = '';

const BASE_MAPS: Record<string, { tiles: string[]; attr: string; label: string; group: string }> = {
  'OSM':               { label: 'OSM Standard',       group: 'Road',      attr: '© OpenStreetMap contributors',            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'] },
  'CartoDB Light':     { label: 'CartoDB Light',       group: 'Road',      attr: '© CartoDB, © OpenStreetMap contributors', tiles: ['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'] },
  'CartoDB Dark':      { label: 'CartoDB Dark',        group: 'Road',      attr: '© CartoDB, © OpenStreetMap contributors', tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'] },
  'Stadia Watercolor': { label: 'Stadia Watercolor',   group: 'Thematic',  attr: '© Stadia Maps, © Stamen, © OSM',         tiles: ['https://tiles.stadiamaps.com/tiles/stamen_watercolor/{z}/{x}/{y}.jpg'] },
  'OpenTopoMap':       { label: 'OpenTopoMap',         group: 'Thematic',  attr: '© OpenTopoMap contributors, © OSM',      tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'] },
  'HOT':               { label: 'OSM Humanitarian',    group: 'Thematic',  attr: '© HOT, © OpenStreetMap contributors',    tiles: ['https://tile-a.openstreetmap.fr/hot/{z}/{x}/{y}.png'] },
  'ESRI Satellite':    { label: 'ESRI Satellite',      group: 'Satellite', attr: '© Esri, © Earthstar Geographics',        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'] },
  'ESRI Street':       { label: 'ESRI World Street',   group: 'Satellite', attr: '© Esri',                                 tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'] },
  'Google':            { label: 'Google Road',         group: 'Google',    attr: '© Google',                               tiles: GOOGLE_ROAD_TILES_URL ? [GOOGLE_ROAD_TILES_URL] : ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'] },
  'Google Satellite':  { label: 'Google Satellite',    group: 'Google',    attr: '© Google',                               tiles: GOOGLE_SAT_TILES_URL  ? [GOOGLE_SAT_TILES_URL]  : ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'] },
};

const OSM_TILES = ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'];
const OSM_ATTR  = '© OpenStreetMap contributors';
const DEFAULT_CENTER: [number, number] = [121.1866, 14.5943];
const DEFAULT_ZOOM = 15;

const ASSIGNED_PROJECTS = [
  { name: 'Pole_test', desc: 'Condition of the pole', date: '6/4/2026', status: 'Active', assignTo: 'user@redplanet.com', dueDate: '' },
];

function makeRasterStyle(tiles: string[], src: string, attr: string, night = false): maplibregl.StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: { [src]: { type: 'raster', tiles, tileSize: 256, attribution: attr, maxzoom: 22 } },
    layers: [{ id: `${src}-tiles`, type: 'raster', source: src, minzoom: 0, maxzoom: 24, paint: night ? { 'raster-brightness-max': 0.42, 'raster-saturation': -0.9, 'raster-contrast': 0.28 } : {} }],
  };
}

function getBaseMapStyle(baseMap: string, isNight: boolean): maplibregl.StyleSpecification {
  const bm = BASE_MAPS[baseMap] ?? BASE_MAPS['OSM'];
  return makeRasterStyle(bm.tiles, 'basemap', bm.attr, isNight);
}

function haversineKm(la1: number, lo1: number, la2: number, lo2: number) {
  const R = 6371, dLa = ((la2-la1)*Math.PI)/180, dLo = ((lo2-lo1)*Math.PI)/180;
  const a = Math.sin(dLa/2)**2 + Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dLo/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function buildGrid() {
  const features: any[] = [];
  for (let la = -80; la <= 80; la += 5) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[-180, la],[180, la]] }, properties: {} });
  for (let lo = -180; lo <= 180; lo += 5) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[lo,-80],[lo,80]] }, properties: {} });
  return { type: 'FeatureCollection' as const, features };
}

// ── Poles data ────────────────────────────────────────────────────────────────
const POLES: Pole[] = [
  { id: 'PL-00231', lat: 14.5943, lon: 121.1866, attributes: [{field:'asset_id',value:'PL-00231'},{field:'feature_type',value:'Pole'},{field:'status',value:'Active'},{field:'owner',value:'Utility Network'},{field:'material',value:'Concrete'},{field:'height_m',value:'10.5'},{field:'municipality',value:'Quezon City'},{field:'design_id',value:'DSN-1045'}] },
  { id: 'PL-00232', lat: 14.5951, lon: 121.1882, attributes: [{field:'asset_id',value:'PL-00232'},{field:'feature_type',value:'Pole'},{field:'status',value:'Active'},{field:'owner',value:'City Grid'},{field:'material',value:'Steel'},{field:'height_m',value:'11.0'},{field:'municipality',value:'Quezon City'},{field:'design_id',value:'DSN-1046'}] },
  { id: 'PL-00233', lat: 14.5928, lon: 121.1848, attributes: [{field:'asset_id',value:'PL-00233'},{field:'feature_type',value:'Pole'},{field:'status',value:'Proposed'},{field:'owner',value:'Utility Network'},{field:'material',value:'Concrete'},{field:'height_m',value:'9.8'},{field:'municipality',value:'Quezon City'},{field:'design_id',value:'DSN-1047'}] },
  { id: 'PL-00234', lat: 14.5964, lon: 121.1854, attributes: [{field:'asset_id',value:'PL-00234'},{field:'feature_type',value:'Pole'},{field:'status',value:'Inactive'},{field:'owner',value:'North Utility'},{field:'material',value:'Wood'},{field:'height_m',value:'8.9'},{field:'municipality',value:'Quezon City'},{field:'design_id',value:'DSN-1048'}] },
  { id: 'PL-00235', lat: 14.5936, lon: 121.1902, attributes: [{field:'asset_id',value:'PL-00235'},{field:'feature_type',value:'Pole'},{field:'status',value:'Active'},{field:'owner',value:'Metro Utility'},{field:'material',value:'Steel'},{field:'height_m',value:'12.1'},{field:'municipality',value:'Quezon City'},{field:'design_id',value:'DSN-1049'}] },
];

const PLUGINS = [
  { id: 'minimap',    label: 'Mini Map',     desc: 'Live overview minimap' },
  { id: 'heatmap',   label: 'Heatmap',       desc: 'Density heatmap on poles' },
  { id: 'export',    label: 'Export PNG',    desc: 'Download map as PNG' },
  { id: 'fullscreen',label: 'Fullscreen',    desc: 'Toggle fullscreen mode' },
  { id: 'geoloc',    label: 'Geolocate Me',  desc: 'Fly to your GPS location' },
  { id: 'grid',      label: 'Grid Overlay',  desc: 'Lat/lon grid overlay' },
  { id: 'nightmode', label: 'Night Mode',    desc: 'Dark desaturated map' },
  { id: 'cluster',   label: 'Cluster Poles', desc: 'Group nearby poles' },
];

// ── Icons ─────────────────────────────────────────────────────────────────────
const ToolShell = ({ active, children }: { active?: boolean; children: React.ReactNode }) => (
  <div className={`flex h-full w-full items-center justify-center rounded-[14px] transition-all ${active ? 'bg-[#111] text-[#e0e0e0] shadow-[0_6px_18px_rgba(0,0,0,0.22)]' : 'bg-transparent text-[#111]'}`}>
    {children}
  </div>
);
const IconLocate  = ({ active }: { active?: boolean }) => (<ToolShell active={active}><svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M12 21C12 21 18 15.4 18 10.2C18 6.78 15.31 4 12 4C8.69 4 6 6.78 6 10.2C6 15.4 12 21 12 21Z" stroke={active ? '#e0e0e0' : '#111'} strokeWidth="1.8"/><circle cx="12" cy="10" r="2.4" fill={active ? '#e0e0e0' : '#111'}/></svg></ToolShell>);
const IconSelect  = ({ active }: { active?: boolean }) => (<ToolShell active={active}><svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M6 5H10M14 5H18M19 6V10M19 14V18M18 19H14M10 19H6M5 18V14M5 10V6" stroke={active ? '#e0e0e0' : '#111'} strokeWidth="1.8" strokeLinecap="round"/><rect x="8.2" y="8.2" width="7.6" height="7.6" rx="1.4" fill={active ? '#e0e0e0' : '#111'} opacity="0.9"/></svg></ToolShell>);
const IconDraw    = ({ active }: { active?: boolean }) => (<ToolShell active={active}><svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M5 18L17.7 5.3C18.09 4.91 18.72 4.91 19.11 5.3L20.7 6.89C21.09 7.28 21.09 7.91 20.7 8.3L8 21H5V18Z" stroke={active ? '#e0e0e0' : '#111'} strokeWidth="1.7" strokeLinejoin="round"/><path d="M14.5 8.5L17.5 11.5" stroke={active ? '#e0e0e0' : '#111'} strokeWidth="1.7"/></svg></ToolShell>);
const IconMeasure = ({ active }: { active?: boolean }) => (<ToolShell active={active}><svg width="17" height="17" viewBox="0 0 24 24" fill="none"><rect x="5" y="8" width="14" height="8" rx="2" stroke={active ? '#e0e0e0' : '#111'} strokeWidth="1.8"/><path d="M8 10V12M11 10V11.4M14 10V12M17 10V11.4" stroke={active ? '#e0e0e0' : '#111'} strokeWidth="1.6" strokeLinecap="round"/></svg></ToolShell>);
const IconClear   = ({ active }: { active?: boolean }) => (<ToolShell active={active}><svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" stroke={active ? '#e0e0e0' : '#e11d48'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg></ToolShell>);
const IconPlugins = ({ active }: { active?: boolean }) => (<ToolShell active={active}><svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M9.2 7.5C9.2 6.12 10.32 5 11.7 5C13.08 5 14.2 6.12 14.2 7.5V8.1H16.6C18.15 8.1 19.4 9.35 19.4 10.9C19.4 12.45 18.15 13.7 16.6 13.7H15.8V16.5C15.8 17.88 14.68 19 13.3 19C11.92 19 10.8 17.88 10.8 16.5V13.7H8C6.45 13.7 5.2 12.45 5.2 10.9C5.2 9.35 6.45 8.1 8 8.1H9.2V7.5Z" stroke={active ? '#e0e0e0' : '#111'} strokeWidth="1.7" strokeLinejoin="round"/></svg></ToolShell>);
const IcPt  = ({ active }: { active: boolean }) => (<svg viewBox="0 0 24 24" width="13" height="13" fill="none"><circle cx="12" cy="12" r="6.5" stroke={active ? '#e0e0e0' : '#111'} strokeWidth="3"/><circle cx="12" cy="12" r="2" fill={active ? '#e0e0e0' : '#111'}/></svg>);
const IcLn  = ({ active }: { active: boolean }) => (<svg viewBox="0 0 24 24" width="13" height="13" fill="none"><circle cx="5" cy="19" r="2.8" fill={active ? '#e0e0e0' : '#111'}/><circle cx="19" cy="5" r="2.8" fill={active ? '#e0e0e0' : '#111'}/><path d="M6.8 17.2L17.2 6.8" stroke={active ? '#e0e0e0' : '#111'} strokeWidth="2" strokeLinecap="round"/></svg>);
const IcPg  = ({ active }: { active: boolean }) => (<svg viewBox="0 0 24 24" width="13" height="13" fill="none"><polygon points="12,3 21,18.5 3,18.5" fill={active ? 'rgba(255,255,255,0.18)' : 'rgba(17,17,17,0.08)'} stroke={active ? '#e0e0e0' : '#111'} strokeWidth="1.8" strokeLinejoin="round"/><circle cx="12" cy="3" r="2" fill={active ? '#e0e0e0' : '#111'}/><circle cx="21" cy="18.5" r="2" fill={active ? '#e0e0e0' : '#111'}/><circle cx="3" cy="18.5" r="2" fill={active ? '#e0e0e0' : '#111'}/></svg>);

// ── Component ─────────────────────────────────────────────────────────────────
export default function UserPanelPage() {
  const navigate = useNavigate();

  // ── Map refs ──────────────────────────────────────────────────────────────
  const mapContainerRef     = useRef<HTMLDivElement | null>(null);
  const mapRef              = useRef<maplibregl.Map | null>(null);
  const mapReadyRef         = useRef(false);
  const initializedRef      = useRef(false);
  const openPoleRef         = useRef<(p: Pole) => void>(() => {});
  const minimapContainerRef = useRef<HTMLDivElement | null>(null);
  const minimapRef          = useRef<maplibregl.Map | null>(null);
  const minimapBoxMarkerRef = useRef<maplibregl.Marker | null>(null);
  const activeToolRef       = useRef<ActiveTool>(null);
  const drawGeomRef         = useRef<DrawGeometry>('point');
  const drawPtsRef          = useRef<[number, number][]>([]);
  const rulerPtsRef         = useRef<[number, number][]>([]);
  const rulerMarkersRef     = useRef<maplibregl.Marker[]>([]);
  const rulerPopupRef       = useRef<maplibregl.Popup | null>(null);
  const poleClickRef        = useRef<((e: maplibregl.MapLayerMouseEvent) => void) | null>(null);
  const poleEnterRef        = useRef<(() => void) | null>(null);
  const poleLeaveRef        = useRef<(() => void) | null>(null);
  const clusterClickRef     = useRef<((e: maplibregl.MapLayerMouseEvent) => void) | null>(null);
  const unclusterClickRef   = useRef<((e: maplibregl.MapLayerMouseEvent) => void) | null>(null);

  // ── State ─────────────────────────────────────────────────────────────────
  const [isMobile, setIsMobile]                   = useState(false);
  const [zoomLevel, setZoomLevel]                 = useState(DEFAULT_ZOOM);
  const [latLon, setLatLon]                       = useState({ lat: DEFAULT_CENTER[1], lon: DEFAULT_CENTER[0] });
  const [compassAngle, setCompassAngle]           = useState(0);
  const [selectedBaseMap, setSelectedBaseMap]     = useState('OSM');
  const [showBaseMapDropdown, setShowBaseMapDropdown] = useState(false);
  const [activeTool, setActiveTool]               = useState<ActiveTool>(null);
  const [showDrawPopup, setShowDrawPopup]         = useState(false);
  const [drawGeometry, setDrawGeometry]           = useState<DrawGeometry>('point');
  const [drawCount, setDrawCount]                 = useState(0);
  const [drawFinished, setDrawFinished]           = useState(false);
  const [measureTotal, setMeasureTotal]           = useState<number | null>(null);
  const [activePlugins, setActivePlugins]         = useState<Record<string, boolean>>({});
  const [searchText, setSearchText]               = useState('');
  const [layerVisibility, setLayerVisibility]     = useState<Record<string, boolean>>({ Pole: true, Substation: true, Cabinate: true, Cable: true });
  const [showTopMenu, setShowTopMenu]             = useState(false);
  const [showOC, setShowOC]                       = useState(false);
  const [showProject, setShowProject]             = useState(false);
  const [showUserPopup, setShowUserPopup]         = useState(false);
  const [showBottomPanel, setShowBottomPanel]     = useState(false);
  const [activeTab, setActiveTab]                 = useState<ActiveTab>('Details');
  const [isEditing, setIsEditing]                 = useState(false);
  const [selectedObjectId, setSelectedObjectId]   = useState<string | null>(null);
  const [selectedObjectItem, setSelectedObjectItem] = useState('');
  const [attributes, setAttributes]               = useState<Attribute[]>([]);
  const [draftAttributes, setDraftAttributes]     = useState<Attribute[]>([]);
  const [showSaveMenu, setShowSaveMenu]           = useState(false);
  const [expandedGroups, setExpandedGroups]       = useState<ExpandedGroups>({ Segment: false, 'Distribution Structure': false, Equipment: false });
  const [tableFilterMode, setTableFilterMode]     = useState('By ID');
  const [tableFilterInput, setTableFilterInput]   = useState('');
  const [appliedTableFilter, setAppliedTableFilter] = useState('');

  const ocGroups = [
    { key: 'Segment',                items: ['Cable', 'Cable Segment', 'Fiber Optic', 'Wire'] },
    { key: 'Distribution Structure', items: ['Pole', 'Manhole', 'Cabinate'] },
    { key: 'Equipment',              items: ['Power Transformer', 'Service Point', 'Light', 'Meter'] },
  ];

  // ── Sync refs ──────────────────────────────────────────────────────────────
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
  useEffect(() => { drawGeomRef.current = drawGeometry; }, [drawGeometry]);

  const activePluginsRef = useRef(activePlugins);
  useEffect(() => { activePluginsRef.current = activePlugins; }, [activePlugins]);

  const layerVisibilityRef = useRef(layerVisibility);
  useEffect(() => { layerVisibilityRef.current = layerVisibility; }, [layerVisibility]);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check(); window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // ── openPole ──────────────────────────────────────────────────────────────
  const openPole = useCallback((pole: Pole) => {
    setSelectedObjectItem('Pole'); setSelectedObjectId(pole.id);
    setAttributes(pole.attributes.map(i => ({ ...i }))); setDraftAttributes(pole.attributes.map(i => ({ ...i })));
    setIsEditing(false); setShowSaveMenu(false);
    if (window.innerWidth < 640) { setShowOC(false); setShowProject(false); }
    mapRef.current?.flyTo({ center: [pole.lon, pole.lat], zoom: 18, essential: true });
  }, []);
  useEffect(() => { openPoleRef.current = openPole; }, [openPole]);

  // ── Minimap ───────────────────────────────────────────────────────────────
  const updateMinimapViewport = useCallback(() => {
    const map = mapRef.current, mm = minimapRef.current;
    if (!map || !mm) return;
    const center = map.getCenter();
    mm.jumpTo({ center, zoom: Math.max(0, map.getZoom() - 4), bearing: 0, pitch: 0 });
    const box = document.createElement('div');
    box.style.cssText = 'width:26px;height:18px;border:2px solid #111;border-radius:5px;background:rgba(255,255,255,0.18);box-shadow:0 1px 4px rgba(0,0,0,0.25);';
    if (minimapBoxMarkerRef.current) minimapBoxMarkerRef.current.remove();
    minimapBoxMarkerRef.current = new maplibregl.Marker({ element: box, anchor: 'center' }).setLngLat(center).addTo(mm);
  }, []);

  // ── Handler cleanup ───────────────────────────────────────────────────────
  const removeLayerHandlers = useCallback((map: maplibregl.Map) => {
    try { if (poleClickRef.current)      map.off('click',      'poles-hit',           poleClickRef.current);      } catch {}
    try { if (poleEnterRef.current)      map.off('mouseenter', 'poles-hit',           poleEnterRef.current);      } catch {}
    try { if (poleLeaveRef.current)      map.off('mouseleave', 'poles-hit',           poleLeaveRef.current);      } catch {}
    try { if (clusterClickRef.current)   map.off('click',      'cluster-circles',     clusterClickRef.current);   } catch {}
    try { if (unclusterClickRef.current) map.off('click',      'cluster-unclustered', unclusterClickRef.current); } catch {}
  }, []);

  // ── Pole layer ────────────────────────────────────────────────────────────
  const addPoleMarkers = useCallback((map: maplibregl.Map) => {
    const SRC = 'poles-src', LAYER = 'poles-layer', HIT = 'poles-hit';
    removeLayerHandlers(map);
    if (map.getLayer(HIT))   map.removeLayer(HIT);
    if (map.getLayer(LAYER)) map.removeLayer(LAYER);
    if (map.getSource(SRC))  map.removeSource(SRC);

    map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: POLES.map(p => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] }, properties: { id: p.id } })) } });
    map.addLayer({ id: LAYER, type: 'circle', source: SRC, paint: { 'circle-radius': ['interpolate',['linear'],['zoom'],10,5,18,10], 'circle-color': '#111111', 'circle-stroke-width': 2.5, 'circle-stroke-color': '#ffffff', 'circle-opacity': 1 } });
    map.addLayer({ id: HIT, type: 'circle', source: SRC, paint: { 'circle-radius': ['interpolate',['linear'],['zoom'],10,14,18,22], 'circle-color': 'rgba(0,0,0,0)', 'circle-opacity': 0 } });

    poleEnterRef.current = () => {
      const tool = activeToolRef.current;
      if (tool !== 'Draw' && tool !== 'Measure') map.getCanvas().style.cursor = 'pointer';
    };
    poleLeaveRef.current = () => {
      const t = activeToolRef.current;
      map.getCanvas().style.cursor = (t==='Draw'||t==='Measure')?'crosshair':t==='Select'?'pointer':'default';
    };
    poleClickRef.current = (e: maplibregl.MapLayerMouseEvent) => {
      const tool = activeToolRef.current;
      if (tool === 'Draw' || tool === 'Measure') return;
      e.preventDefault();
      const pid = e.features?.[0]?.properties?.id as string;
      const pole = POLES.find(p => p.id === pid);
      if (pole) openPoleRef.current(pole);
    };

    map.on('mouseenter', HIT, poleEnterRef.current);
    map.on('mouseleave', HIT, poleLeaveRef.current);
    map.on('click',      HIT, poleClickRef.current);
  }, [removeLayerHandlers]);

  // ── Draw data ─────────────────────────────────────────────────────────────
  const setDrawData = useCallback((map: maplibregl.Map, pts: [number, number][], geom: DrawGeometry) => {
    const ptF = pts.map(([x,y]) => ({ type:'Feature', geometry:{ type:'Point', coordinates:[x,y] }, properties:{} }));
    const liF = (geom==='line'||geom==='polygon') && pts.length>=2 ? [{ type:'Feature', geometry:{ type:'LineString', coordinates:(geom==='polygon'&&pts.length>=3)?[...pts,pts[0]]:pts }, properties:{} }] : [];
    const pgF = geom==='polygon' && pts.length>=3 ? [{ type:'Feature', geometry:{ type:'Polygon', coordinates:[[...pts,pts[0]]] }, properties:{} }] : [];
    try {
      (map.getSource('draw-pts-src') as maplibregl.GeoJSONSource)?.setData({ type:'FeatureCollection', features: ptF as any });
      (map.getSource('draw-ln-src')  as maplibregl.GeoJSONSource)?.setData({ type:'FeatureCollection', features: liF as any });
      (map.getSource('draw-pg-src')  as maplibregl.GeoJSONSource)?.setData({ type:'FeatureCollection', features: pgF as any });
    } catch {}
  }, []);

  // ── Overlay sources ───────────────────────────────────────────────────────
  const addOverlaySources = useCallback((map: maplibregl.Map) => {
    const sa = (id: string, cb: () => void) => { if (!map.getSource(id)) cb(); };
    sa('draw-pts-src', () => { map.addSource('draw-pts-src',{ type:'geojson', data:{ type:'FeatureCollection', features:[] } }); map.addLayer({ id:'draw-pts-layer', type:'circle', source:'draw-pts-src', paint:{ 'circle-radius':5.5, 'circle-color':'#111', 'circle-stroke-width':2, 'circle-stroke-color':'#e0e0e0' } }); });
    sa('draw-ln-src',  () => { map.addSource('draw-ln-src', { type:'geojson', data:{ type:'FeatureCollection', features:[] } }); map.addLayer({ id:'draw-ln-layer',  type:'line',   source:'draw-ln-src',  paint:{ 'line-color':'#111', 'line-width':2.5, 'line-dasharray':[3,2] } }); });
    sa('draw-pg-src',  () => { map.addSource('draw-pg-src', { type:'geojson', data:{ type:'FeatureCollection', features:[] } }); map.addLayer({ id:'draw-pg-layer',  type:'fill',   source:'draw-pg-src',  paint:{ 'fill-color':'#111', 'fill-opacity':0.18 } }); });
    sa('ruler-src',    () => { map.addSource('ruler-src',   { type:'geojson', data:{ type:'FeatureCollection', features:[] } }); map.addLayer({ id:'ruler-layer',    type:'line',   source:'ruler-src',    paint:{ 'line-color':'#e11d48', 'line-width':2.5, 'line-dasharray':[4,2] } }); });
    sa('grid-src',     () => { map.addSource('grid-src', { type:'geojson', data: buildGrid() }); map.addLayer({ id:'grid-layer', type:'line', source:'grid-src', paint:{ 'line-color':'rgba(0,0,0,0.18)', 'line-width':0.7 }, layout:{ visibility:'none' } }); });

    sa('heatmap-src',  () => {
      map.addSource('heatmap-src', { type:'geojson', data:{ type:'FeatureCollection', features: POLES.map(p=>({ type:'Feature' as const, geometry:{ type:'Point' as const, coordinates:[p.lon,p.lat] }, properties:{} })) } });
      map.addLayer({ id:'heatmap-layer', type:'heatmap', source:'heatmap-src', layout: { visibility: 'none' }, paint:{ 'heatmap-weight':1, 'heatmap-intensity':2, 'heatmap-color':['interpolate',['linear'],['heatmap-density'],0,'rgba(0,0,255,0)',0.2,'rgba(0,200,255,0.6)',0.5,'rgba(0,220,80,0.8)',0.8,'rgba(255,220,0,0.9)',1,'rgba(255,40,0,1)'], 'heatmap-radius':50, 'heatmap-opacity':0 } });
    });

    sa('cluster-src',  () => {
      map.addSource('cluster-src', { type:'geojson', cluster:true, clusterMaxZoom:14, clusterRadius:50, data:{ type:'FeatureCollection', features: POLES.map(p=>({ type:'Feature' as const, geometry:{ type:'Point' as const, coordinates:[p.lon,p.lat] }, properties:{ id:p.id } })) } });
      map.addLayer({ id:'cluster-circles',     type:'circle', source:'cluster-src', filter:['has','point_count'],   paint:{ 'circle-color':'#111', 'circle-radius':18, 'circle-stroke-width':2, 'circle-stroke-color':'#e0e0e0' }, layout:{ visibility:'none' } });
      map.addLayer({ id:'cluster-count',       type:'symbol', source:'cluster-src', filter:['has','point_count'],   layout:{ 'text-field':'{point_count_abbreviated}', 'text-size':12, visibility:'none' }, paint:{ 'text-color':'#e0e0e0' } });
      map.addLayer({ id:'cluster-unclustered', type:'circle', source:'cluster-src', filter:['!',['has','point_count']], paint:{ 'circle-radius':['interpolate',['linear'],['zoom'],10,5,18,10], 'circle-color':'#111111', 'circle-stroke-width':2.5, 'circle-stroke-color':'#ffffff' }, layout:{ visibility:'none' } });

      clusterClickRef.current = (e: maplibregl.MapLayerMouseEvent) => {
        const f = e.features?.[0], src = map.getSource('cluster-src') as any, cid = f?.properties?.cluster_id;
        if (!src || cid==null) return;
        src.getClusterExpansionZoom(cid, (err: any, zoom: number) => { if(err) return; const c=(f?.geometry as any)?.coordinates; if(c) map.easeTo({ center:c, zoom }); });
      };
      unclusterClickRef.current = (e: maplibregl.MapLayerMouseEvent) => {
        const tool = activeToolRef.current;
        if (tool === 'Draw' || tool === 'Measure') return;
        e.preventDefault();
        const pid = e.features?.[0]?.properties?.id as string;
        const pole = POLES.find(p => p.id === pid);
        if (pole) openPoleRef.current(pole);
      };

      map.on('mouseenter', 'cluster-unclustered', () => {
        const tool = activeToolRef.current;
        if (tool !== 'Draw' && tool !== 'Measure') map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'cluster-unclustered', () => { map.getCanvas().style.cursor = ''; });

      map.on('click', 'cluster-circles',     clusterClickRef.current);
      map.on('click', 'cluster-unclustered', unclusterClickRef.current);
    });
  }, []);

  // ── Layer visibility ──────────────────────────────────────────────────────
  const applyLayerVisibility = useCallback((map: maplibregl.Map, ls: Record<string, boolean>, plugins: Record<string, boolean>) => {
    const pv = ls['Pole'] !== false, co = !!plugins['cluster'];
    const pm = pv&&!co?'visible':'none', cm = pv&&co?'visible':'none';
    try { map.setLayoutProperty('poles-layer',         'visibility', pm); } catch {}
    try { map.setLayoutProperty('poles-hit',           'visibility', pm); } catch {}
    try { map.setLayoutProperty('cluster-circles',     'visibility', cm); } catch {}
    try { map.setLayoutProperty('cluster-count',       'visibility', cm); } catch {}
    try { map.setLayoutProperty('cluster-unclustered', 'visibility', cm); } catch {}
    const hmVisible = pv && plugins['heatmap'];
    try { map.setLayoutProperty('heatmap-layer', 'visibility', hmVisible ? 'visible' : 'none'); } catch {}
    try { map.setPaintProperty('heatmap-layer',  'heatmap-opacity', hmVisible ? 0.75 : 0); } catch {}
  }, []);

  const applyPluginVisuals = useCallback((map: maplibregl.Map, plugins: Record<string, boolean>, layers: Record<string, boolean>) => {
    try { map.setLayoutProperty('grid-layer','visibility', plugins['grid']?'visible':'none'); } catch {}
    applyLayerVisibility(map, layers, plugins);
  }, [applyLayerVisibility]);

  // ── Map init ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (initializedRef.current || !mapContainerRef.current) return;
    initializedRef.current = true;
    const map = new maplibregl.Map({ container: mapContainerRef.current, style: getBaseMapStyle('OSM', false), center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, attributionControl: false, preserveDrawingBuffer: true });

    map.on('load', () => { mapReadyRef.current = true; map.resize(); addOverlaySources(map); addPoleMarkers(map); applyPluginVisuals(map, activePlugins, layerVisibility); map.jumpTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }); });
    map.on('move',   () => { const c = map.getCenter(); setLatLon({ lat: c.lat, lon: c.lng }); updateMinimapViewport(); });
    map.on('zoom',   () => { setZoomLevel(Math.round(map.getZoom())); updateMinimapViewport(); });
    map.on('rotate', () => setCompassAngle(map.getBearing()));

    map.on('click', (e) => {
      const lng = e.lngLat.lng, lat = e.lngLat.lat;
      const tool = activeToolRef.current, geom = drawGeomRef.current;
      if ((e as any).defaultPrevented) return;
      if (tool === 'Draw') {
        if (drawFinished) return;
        const pts = geom==='point' ? [[lng,lat] as [number,number]] : [...drawPtsRef.current,[lng,lat] as [number,number]];
        drawPtsRef.current = pts; setDrawCount(pts.length);
        if (mapReadyRef.current) setDrawData(map, pts, geom); return;
      }
      if (tool === 'Measure') {
        const pts = [...rulerPtsRef.current, [lng,lat] as [number,number]];
        rulerPtsRef.current = pts;
        if (mapReadyRef.current && pts.length >= 2) {
          try { (map.getSource('ruler-src') as maplibregl.GeoJSONSource)?.setData({ type:'FeatureCollection', features:[{ type:'Feature', geometry:{ type:'LineString', coordinates:pts }, properties:{} }] }); } catch {}
          let dist = 0; for (let i=1;i<pts.length;i++) dist += haversineKm(pts[i-1][1],pts[i-1][0],pts[i][1],pts[i][0]);
          setMeasureTotal(dist);
          rulerPopupRef.current?.remove();
          rulerPopupRef.current = new maplibregl.Popup({ closeButton:false, offset:10 }).setLngLat([lng,lat]).setHTML(`<div style="font:bold 12px sans-serif;padding:6px 10px;color:#111;">${dist<1?`${(dist*1000).toFixed(0)} m`:`${dist.toFixed(3)} km`}</div>`).addTo(map);
        }
        const el = document.createElement('div'); el.style.cssText = 'width:10px;height:10px;border-radius:9999px;background:#e11d48;border:2px solid #e0e0e0;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.22);';
        rulerMarkersRef.current.push(new maplibregl.Marker({ element:el }).setLngLat([lng,lat]).addTo(map)); return;
      }
      setShowTopMenu(false); setShowBaseMapDropdown(false); setShowUserPopup(false);
    });

    const onResize = () => { map.resize(); minimapRef.current?.resize(); updateMinimapViewport(); };
    window.addEventListener('resize', onResize);
    mapRef.current = map;
    return () => {
      window.removeEventListener('resize', onResize); removeLayerHandlers(map);
      minimapRef.current?.remove(); minimapRef.current = null;
      minimapBoxMarkerRef.current?.remove(); minimapBoxMarkerRef.current = null;
      map.remove(); mapRef.current = null; mapReadyRef.current = false; initializedRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Style switch ──────────────────────────────────────────────────────────
  const isNightMode = !!activePlugins['nightmode'];
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const center = map.getCenter(), zoom = map.getZoom(), bearing = map.getBearing();
    mapReadyRef.current = false;
    map.setStyle(getBaseMapStyle(selectedBaseMap, isNightMode));
    map.once('style.load', () => {
      mapReadyRef.current = true;
      addOverlaySources(map); addPoleMarkers(map);
      applyPluginVisuals(map, activePluginsRef.current, layerVisibilityRef.current);
      setDrawData(map, drawPtsRef.current, drawGeomRef.current);
      map.jumpTo({ center, zoom, bearing }); map.resize(); updateMinimapViewport();
    });
  }, [selectedBaseMap, isNightMode, addOverlaySources, addPoleMarkers, applyPluginVisuals, setDrawData, updateMinimapViewport]);

  // ── Plugin effects ────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    applyPluginVisuals(map, activePlugins, layerVisibility);
    if (activePlugins['export']) {
      setActivePlugins(p => ({ ...p, export:false }));
      map.once('idle', () => { try { const a=document.createElement('a'); a.href=map.getCanvas().toDataURL('image/png'); a.download=`gis-map-${Date.now()}.png`; document.body.appendChild(a); a.click(); document.body.removeChild(a); } catch { alert('Export failed.'); } });
    }
    if (activePlugins['fullscreen']) {
      setActivePlugins(p=>({...p,fullscreen:false}));
      if(!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(()=>{}); else document.exitFullscreen?.().catch(()=>{});
    }
    if (activePlugins['geoloc']) {
      setActivePlugins(p=>({...p,geoloc:false}));
      if (!navigator.geolocation) { alert('Geolocation not supported.'); return; }
      navigator.geolocation.getCurrentPosition(pos => {
        map.flyTo({ center:[pos.coords.longitude,pos.coords.latitude], zoom:16, essential:true });
        new maplibregl.Popup({ closeButton:true, offset:12 }).setLngLat([pos.coords.longitude,pos.coords.latitude]).setHTML('<div style="padding:6px 10px;font:12px sans-serif;color:#111;">📍 You are here</div>').addTo(map);
      }, () => alert('Location access denied.'));
    }
    if (activePlugins['minimap']) {
      if (!minimapRef.current && minimapContainerRef.current) {
        const mm = new maplibregl.Map({ container:minimapContainerRef.current, style:makeRasterStyle(OSM_TILES,'mm-base',OSM_ATTR), center:map.getCenter(), zoom:Math.max(0,map.getZoom()-4), interactive:false, attributionControl:false });
        mm.on('load', () => { mm.resize(); updateMinimapViewport(); }); minimapRef.current = mm;
      } else { updateMinimapViewport(); }
    } else {
      minimapBoxMarkerRef.current?.remove(); minimapBoxMarkerRef.current = null;
      if (minimapRef.current) { minimapRef.current.remove(); minimapRef.current = null; }
    }
  }, [activePlugins, applyPluginVisuals, layerVisibility, updateMinimapViewport]);

  useEffect(() => { const c=mapRef.current?.getCanvas(); if(!c) return; const cs:Record<string,string>={Locate:'crosshair',Select:'pointer',Draw:'crosshair',Measure:'crosshair',Clear:'default',Plugins:'default'}; c.style.cursor=activeTool?(cs[activeTool]||'default'):'default'; }, [activeTool]);
  useEffect(() => { setTimeout(() => mapRef.current?.resize(), 320); }, [showOC, selectedObjectId, showBottomPanel, showProject, isMobile]);

  // ── Zoom sync ─────────────────────────────────────────────────────────────
  const zoomSyncRef = useRef(false);
  useEffect(() => { const map=mapRef.current; if(!map) return; if(zoomSyncRef.current){zoomSyncRef.current=false;return;} if(Math.abs(map.getZoom()-zoomLevel)>0.4) map.setZoom(zoomLevel); }, [zoomLevel]);
  useEffect(() => { const map=mapRef.current; if(!map) return; const onZoom=()=>{zoomSyncRef.current=true;setZoomLevel(Math.round(map.getZoom()));}; map.on('zoom',onZoom); return()=>{map.off('zoom',onZoom);}; }, []);

  // ── Clear helpers ─────────────────────────────────────────────────────────
  const clearDraw = useCallback(() => {
    drawPtsRef.current=[]; setDrawCount(0); setDrawFinished(false);
    try { (mapRef.current?.getSource('draw-pts-src') as maplibregl.GeoJSONSource)?.setData({type:'FeatureCollection',features:[]}); (mapRef.current?.getSource('draw-ln-src') as maplibregl.GeoJSONSource)?.setData({type:'FeatureCollection',features:[]}); (mapRef.current?.getSource('draw-pg-src') as maplibregl.GeoJSONSource)?.setData({type:'FeatureCollection',features:[]}); } catch {}
  }, []);
  const clearMeasure = useCallback(() => {
    rulerPtsRef.current=[]; setMeasureTotal(null); rulerMarkersRef.current.forEach(m=>m.remove()); rulerMarkersRef.current=[]; rulerPopupRef.current?.remove(); rulerPopupRef.current=null;
    try { (mapRef.current?.getSource('ruler-src') as maplibregl.GeoJSONSource)?.setData({type:'FeatureCollection',features:[]}); } catch {}
  }, []);
  const saveDraw = useCallback(() => { alert(`Saved ${drawCount} point(s) as ${drawGeomRef.current}`); clearDraw(); setActiveTool(null); setShowDrawPopup(false); }, [drawCount, clearDraw]);

  // ── Search with object-type keywords ─────────────────────────────────────
  const getPoleValue = useCallback((pole: Pole, field: string) => pole.attributes.find(a=>a.field===field)?.value||'', []);

  const OBJECT_TYPE_KEYWORDS: Record<string, string> = {
    'pole': 'Pole', 'poles': 'Pole',
    'manhole': 'Manhole', 'manholes': 'Manhole',
    'cabinate': 'Cabinate', 'cabinet': 'Cabinate', 'cabinets': 'Cabinate',
    'cable': 'Cable', 'cables': 'Cable',
    'cable segment': 'Cable Segment',
    'fiber': 'Fiber Optic', 'fiber optic': 'Fiber Optic',
    'wire': 'Wire', 'wires': 'Wire',
    'transformer': 'Power Transformer', 'power transformer': 'Power Transformer',
    'service point': 'Service Point',
    'light': 'Light', 'lights': 'Light',
    'meter': 'Meter', 'meters': 'Meter',
  };

  const runSearch = useCallback(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return;
    const objectType = OBJECT_TYPE_KEYWORDS[q];
    if (objectType) {
      setSelectedObjectItem(objectType); setShowBottomPanel(true); setAppliedTableFilter(''); setTableFilterInput(''); setShowProject(false);
      if (objectType === 'Pole') {
        setSelectedObjectId(null); setAttributes([]); setDraftAttributes([]); setIsEditing(false); setShowSaveMenu(false);
      } else {
        const code = objectType.toUpperCase().slice(0, 2), oid = `${code}-001`;
        const data: Attribute[] = [{ field:'asset_id',value:oid },{ field:'feature_type',value:objectType },{ field:'status',value:'Active' },{ field:'owner',value:'Utility Network' },{ field:'material',value:objectType==='Manhole'?'Concrete':'Steel' },{ field:'municipality',value:'Quezon City' },{ field:'design_id',value:`${code}-1001` }];
        setSelectedObjectId(oid); setAttributes(data); setDraftAttributes(data); setIsEditing(false); setShowSaveMenu(false);
      }
      return;
    }
    const found = POLES.find(pole => [pole.id, getPoleValue(pole,'design_id'), getPoleValue(pole,'municipality'), getPoleValue(pole,'owner'), getPoleValue(pole,'status'), getPoleValue(pole,'material')].join(' ').toLowerCase().includes(q));
    if (!found) { alert('No matching object found.'); return; }
    mapRef.current?.flyTo({ center:[found.lon, found.lat], zoom:18, essential:true });
    openPole(found); setSelectedObjectItem('Pole'); setShowBottomPanel(true);
  }, [searchText, getPoleValue, openPole]);

  // ── Tool handler ──────────────────────────────────────────────────────────
  const handleToolClick = (tool: ActiveTool) => {
    if (tool==='Locate') { mapRef.current?.flyTo({center:DEFAULT_CENTER,zoom:DEFAULT_ZOOM,essential:true}); setActiveTool(null); setShowDrawPopup(false); return; }
    if (tool==='Draw')   { setActiveTool(prev=>prev==='Draw'?null:'Draw'); setShowDrawPopup(prev=>activeTool==='Draw'?!prev:true); return; }
    if (tool==='Clear')  { clearDraw(); clearMeasure(); setActiveTool(null); setShowDrawPopup(false); return; }
    if (tool==='Plugins'){ setShowDrawPopup(false); setActiveTool(prev=>prev==='Plugins'?null:'Plugins'); return; }
    setShowDrawPopup(false);
    setActiveTool(prev => { if(prev===tool){if(tool==='Measure')clearMeasure();return null;} if(prev==='Measure')clearMeasure(); return tool; });
  };
  const selectDrawType = (geom: DrawGeometry) => { setDrawGeometry(geom); drawGeomRef.current=geom; clearDraw(); setActiveTool('Draw'); setShowDrawPopup(false); setDrawFinished(false); };
  const togglePlugin = (id: string) => { setActivePlugins((prev) => ({ ...prev, [id]: !prev[id] })); };

  // ── Object helpers ────────────────────────────────────────────────────────
  const getPV = (pole: Pole, f: string) => pole.attributes.find(a=>a.field===f)?.value||'-';
  const getDisplayLabel = () => { const n=selectedObjectItem||'Object'; return selectedObjectId?`${n} (${selectedObjectId})`:n; };
  const getSelectedPole = () => POLES.find(p=>p.id===selectedObjectId)||null;
  const zoomToSelected = () => { const p=getSelectedPole(); if(p) mapRef.current?.flyTo({center:[p.lon,p.lat],zoom:18,essential:true}); };
  const startEditing  = () => { setDraftAttributes(attributes.map(i=>({...i}))); setIsEditing(true); setShowSaveMenu(false); };
  const cancelEditing = () => { setDraftAttributes(attributes.map(i=>({...i}))); setIsEditing(false); setShowSaveMenu(false); };
  const handleDraft   = (field: string, value: string) => setDraftAttributes(prev=>prev.map(i=>i.field===field?{...i,value}:i));
  const saveChanges   = (cont: boolean) => { setAttributes(draftAttributes.map(i=>({...i}))); setIsEditing(cont); setShowSaveMenu(false); };
  const deleteObj     = () => { setSelectedObjectId(null); setAttributes([]); setDraftAttributes([]); setIsEditing(false); setShowSaveMenu(false); };
  const closeEditor   = () => { setSelectedObjectId(null); setIsEditing(false); setShowSaveMenu(false); };
  const zoomIn  = () => { const z=Math.min((mapRef.current?.getZoom()||zoomLevel)+1,20); setZoomLevel(z); mapRef.current?.setZoom(z); };
  const zoomOut = () => { const z=Math.max((mapRef.current?.getZoom()||zoomLevel)-1,1);  setZoomLevel(z); mapRef.current?.setZoom(z); };
  const toggleGroup = (g: string) => setExpandedGroups(prev=>({...prev,[g as keyof ExpandedGroups]:!prev[g as keyof ExpandedGroups]}));

  const createObjectData = (name: string) => {
    const code=name.toUpperCase().slice(0,2), oid=`${code}-001`;
    const data: Attribute[] = [{ field:'asset_id',value:oid },{ field:'feature_type',value:name },{ field:'status',value:'Active' },{ field:'owner',value:'Utility Network' },{ field:'material',value:name==='Manhole'?'Concrete':'Steel' },{ field:'municipality',value:'Quezon City' },{ field:'design_id',value:`${code}-1001` }];
    setSelectedObjectItem(name); setSelectedObjectId(oid); setAttributes(data); setDraftAttributes(data); setIsEditing(false); setShowSaveMenu(false);
    if (isMobile) { setShowOC(false); setShowProject(false); }
  };
  const selectObjectItem = (name: string) => {
    setSelectedObjectItem(name); setShowBottomPanel(true); setAppliedTableFilter(''); setTableFilterInput(''); setShowProject(false);
    if (name==='Pole') { setSelectedObjectId(null); setAttributes([]); setDraftAttributes([]); setIsEditing(false); setShowSaveMenu(false); return; }
    createObjectData(name);
  };

  // ── Table rows ────────────────────────────────────────────────────────────
  const makeMH = (id: string, status: string, designId: string, extra?: Partial<BottomRow>): BottomRow => ({ key:id, id, type:'Manhole', status, owner:'Utility Network', material:'Concrete', height:'-', municipality:'Quezon City', designId, ...extra });
  const makeCB = (id: string, status: string, designId: string, extra?: Partial<BottomRow>): BottomRow => ({ key:id, id, type:'Cabinate', status, owner:'Metro Utility', material:'Steel', height:'-', municipality:'Quezon City', designId, ...extra });
  const bottomPanelRows: BottomRow[] = selectedObjectItem==='Pole'
    ? POLES.map(pole=>({ key:pole.id, id:pole.id, type:getPV(pole,'feature_type'), status:getPV(pole,'status'), owner:getPV(pole,'owner'), material:getPV(pole,'material'), height:getPV(pole,'height_m'), municipality:getPV(pole,'municipality'), designId:getPV(pole,'design_id'), selected:selectedObjectId===pole.id, onClick:()=>openPole(pole) }))
    : selectedObjectItem==='Manhole' ? [makeMH('MH-001','Active','MH-2101',{selected:selectedObjectId==='MH-001',onClick:()=>createObjectData('Manhole')}),makeMH('MH-002','Proposed','MH-2102',{})]
    : selectedObjectItem==='Cabinate' ? [makeCB('CB-001','Active','CB-3101',{selected:selectedObjectId==='CB-001',onClick:()=>createObjectData('Cabinate')}),makeCB('CB-002','Inactive','CB-3102',{})]
    : [];

  const filteredRows = useMemo(() => {
    if (!appliedTableFilter.trim()) return bottomPanelRows;
    const q = appliedTableFilter.trim().toLowerCase();
    return tableFilterMode==='By ID' ? bottomPanelRows.filter(r=>r.id.toLowerCase().includes(q)) : bottomPanelRows;
  }, [bottomPanelRows, appliedTableFilter, tableFilterMode]);

  const downloadTable = () => {
    const headers=['ID','Type','Status','Owner','Material','Height','Municipality','Design ID'];
    const csv=[headers,...filteredRows.map(r=>[r.id,r.type,r.status,r.owner,r.material,r.height,r.municipality,r.designId])].map(l=>l.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'})); a.download=`${selectedObjectItem||'objects'}-table.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  // ── Layout ────────────────────────────────────────────────────────────────
  const ocPW = !isMobile&&showOC ? 250 : 0, prPW = !isMobile&&showProject ? 250 : 0;
  const tlLeft = ocPW+prPW+12, blLeft = ocPW+prPW+12;
  const rightShift = !isMobile&&selectedObjectId ? 'right-[332px]' : 'right-3 sm:right-4';
  const ctrlBot = isMobile ? (selectedObjectId?'bottom-[calc(50vh+10px)]':showBottomPanel?'bottom-[calc(30vh+8px)]':'bottom-3') : (showBottomPanel?'bottom-[calc(20vh+8px)]':'bottom-4');
  const llBot   = isMobile ? (selectedObjectId?'bottom-[calc(50vh+14px)]':showBottomPanel?'bottom-[calc(30vh+10px)]':'bottom-3') : (showBottomPanel?'bottom-[calc(20vh+8px)]':'bottom-4');

  const ib = 'flex items-center justify-center border border-[#c0c0c0] bg-[#e0e0e0]/96 text-[#111] shadow-[0_6px_18px_rgba(0,0,0,0.10)] backdrop-blur-md transition-all hover:bg-[#d5d5d5] active:scale-[0.98]';
  const pb = 'border border-[#111] bg-[#111] text-[#e0e0e0] hover:bg-[#262626] transition-all';
  const gb = 'border border-[#b0b0b0] bg-[#d0d0d0] text-[#111] hover:bg-[#c5c5c5] transition-all';

  const tools = [
    { label:'Locate'  as ActiveTool, Icon:IconLocate  },
    { label:'Select'  as ActiveTool, Icon:IconSelect  },
    { label:'Draw'    as ActiveTool, Icon:IconDraw    },
    { label:'Measure' as ActiveTool, Icon:IconMeasure },
    { label:'Clear'   as ActiveTool, Icon:IconClear   },
    { label:'Plugins' as ActiveTool, Icon:IconPlugins },
  ];

  // ── Sub-components ────────────────────────────────────────────────────────
  const LayersIcon = () => (<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1L15 5L8 9L1 5L8 1Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none"/><path d="M1 9L8 13L15 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>);

  const SmallCompass = ({ size=48 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 54 54" style={{ transform:`rotate(${-compassAngle}deg)`, transition:'transform 0.3s ease', filter:'drop-shadow(0 4px 12px rgba(0,0,0,0.18))', cursor:'pointer' }} onClick={() => mapRef.current?.resetNorth({duration:500})} title="Click to reset north">
      <circle cx="27" cy="27" r="26" fill="#f7f7f7" stroke="#d9d9d9" strokeWidth="1"/>
      <circle cx="27" cy="27" r="22" fill="none" stroke="#e6e6e6" strokeWidth="0.6"/>
      {Array.from({length:16},(_,i)=>{ const deg=i*22.5,rad=(deg*Math.PI)/180,isMaj=i%4===0,isMid=i%2===0&&!isMaj,r1=isMaj?18:isMid?19.5:20.5; return <line key={i} x1={27+r1*Math.sin(rad)} y1={27-r1*Math.cos(rad)} x2={27+23*Math.sin(rad)} y2={27-23*Math.cos(rad)} stroke={isMaj?'#666':'#bbb'} strokeWidth={isMaj?1:0.55}/>; })}
      <circle cx="27" cy="27" r="16" fill="#efefef" stroke="#d9d9d9" strokeWidth="0.7"/>
      <polygon points="27,4 29.7,27 27,21 24.3,27" fill="#e11d48"/>
      <polygon points="27,50 29.7,27 27,33 24.3,27" fill="#b9b9b9"/>
      <polygon points="50,27 27,24.3 33,27 27,29.7" fill="#8a8a8a"/>
      <polygon points="4,27 27,24.3 21,27 27,29.7" fill="#8a8a8a"/>
      <circle cx="27" cy="27" r="6" fill="#f7f7f7" stroke="#d9d9d9" strokeWidth="0.7"/>
      <circle cx="27" cy="27" r="2.8" fill="#222"/><circle cx="27" cy="27" r="1.2" fill="#f7f7f7"/>
      <text x="27" y="14.5" textAnchor="middle" fontSize="5.5" fontWeight="700" fill="#111" fontFamily="sans-serif">N</text>
      <text x="27" y="44.5" textAnchor="middle" fontSize="5" fontWeight="500" fill="#999" fontFamily="sans-serif">S</text>
      <text x="43.5" y="28.8" textAnchor="middle" fontSize="5" fontWeight="500" fill="#999" fontFamily="sans-serif">E</text>
      <text x="10.5" y="28.8" textAnchor="middle" fontSize="5" fontWeight="500" fill="#999" fontFamily="sans-serif">W</text>
    </svg>
  );

  const DrawPopup = () => (
    <div className="absolute right-[calc(100%+8px)] top-0 z-50 flex flex-col items-end gap-1">
      <div className="rounded-full border border-[#d0d0d0] bg-[#e0e0e0]/95 px-2.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-[#666] shadow-sm whitespace-nowrap mb-0.5">Draw</div>
      {([{key:'point' as DrawGeometry,label:'Point',Ic:IcPt},{key:'line' as DrawGeometry,label:'Line',Ic:IcLn},{key:'polygon' as DrawGeometry,label:'Polygon',Ic:IcPg}]).map(({key,label,Ic}) => {
        const active = drawGeometry===key;
        return (
          <button key={key} type="button" onClick={()=>selectDrawType(key)}
            className={['flex h-7 items-center gap-1.5 rounded-full border px-2.5 shadow-sm transition-all duration-200 active:scale-[0.95] whitespace-nowrap',
              active?'border-[#111] bg-[#111] text-white':'border-[#d0d0d0] bg-[#e0e0e0] text-[#111] hover:bg-[#d5d5d5]'].join(' ')}>
            <span className={`flex h-4 w-4 items-center justify-center rounded-full ${active?'bg-white/20':'bg-black/10'}`}><Ic active={active}/></span>
            <span className="text-[10px] font-semibold">{label}</span>
          </button>
        );
      })}
    </div>
  );

  const PluginsPanel = () => (
    <div className="absolute right-[calc(100%+8px)] top-0 z-50 w-[220px] overflow-hidden rounded-2xl border border-[#d7d7d7] bg-[#e0e0e0]/96 shadow-[0_14px_36px_rgba(0,0,0,0.18)] backdrop-blur-md">
      <div className="border-b border-[#e8e8e8] bg-[#e0e0e0] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#666]">Map Plugins</div>
      {PLUGINS.map((p,i) => (
        <div key={p.id} className={`flex items-center justify-between px-3 py-2 ${i>0?'border-t border-[#d0d0d0]':''} hover:bg-[#d5d5d5] transition-all`}>
          <div className="flex flex-col gap-0.5"><span className="text-[11px] font-semibold text-[#111] leading-tight">{p.label}</span><span className="text-[9px] text-[#777] leading-tight">{p.desc}</span></div>
          <button type="button" onClick={()=>togglePlugin(p.id)} className={`relative ml-2 h-5 w-9 shrink-0 rounded-full transition-all duration-200 border ${activePlugins[p.id]?'bg-[#111] border-[#111]':'bg-[#d8d8d8] border-[#cfcfcf]'}`}>
            <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-[#e0e0e0] shadow-sm transition-all duration-200 ${activePlugins[p.id]?'left-[18px]':'left-[2px]'}`}/>
          </button>
        </div>
      ))}
    </div>
  );

  // ── renderDetails (matched to Assigner) ───────────────────────────────────
  const renderDetails = (small: boolean) => {
    const attrs = isEditing ? draftAttributes : attributes;
    const statusAttr = attrs.find(a => a.field === 'status');
    const statusColor = statusAttr?.value === 'Active' ? '#3a7a3a' : statusAttr?.value === 'Inactive' ? '#888' : '#555';
    return (
      <div className="flex flex-col">
        {statusAttr && (
          <div className="flex items-center justify-between border-b border-[#d0d0d0] px-3 py-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#555]">Status</span>
            <div className="flex items-center gap-2">
              {isEditing ? (
                <select value={statusAttr.value} onChange={e=>handleDraft('status',e.target.value)} className="rounded border border-[#c0c0c0] bg-[#e8e8e8] px-2 py-0.5 text-[12px] font-bold outline-none focus:border-[#999] transition-colors" style={{color:statusColor}}>
                  <option>Active</option><option>Proposed</option><option>Inactive</option>
                </select>
              ) : (
                <span className="text-[12px] font-bold" style={{color:statusColor}}>{statusAttr.value}</span>
              )}
              <div className="h-2 w-2 rounded-full shrink-0" style={{background:statusColor}}/>
            </div>
          </div>
        )}
        {attrs.filter(a => a.field !== 'status').map((item, idx, arr) => (
          <div key={item.field} className={`flex items-center justify-between px-3 py-1.5 ${idx < arr.length - 1 ? 'border-b border-[#d0d0d0]' : ''}`}>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#555] shrink-0 w-[100px]">{item.field.replace(/_/g,' ')}</span>
            {isEditing ? (
              <input value={item.value} onChange={e=>handleDraft(item.field,e.target.value)} className="ml-2 flex-1 rounded border border-[#c0c0c0] bg-[#ebebeb] px-2 py-0.5 text-right text-[12px] font-semibold text-[#111] outline-none focus:border-[#999] transition-colors"/>
            ) : (
              <span className="ml-2 text-right text-[12px] font-semibold text-[#111] truncate">{item.value}</span>
            )}
          </div>
        ))}
      </div>
    );
  };

  // ── renderLayers (matched to Assigner) ────────────────────────────────────
  const renderLayers = (small: boolean) => (
    <div className="flex flex-col gap-2 p-3">
      <div className="text-[9px] font-bold uppercase tracking-widest text-[#888] px-1 mb-0.5">Layer Visibility</div>
      {['Pole','Substation','Cabinate','Cable'].map((layer) => (
        <div key={layer} className="flex items-center justify-between rounded-2xl border border-[#d0d0d0] bg-[#d8d8d8] px-3 py-2.5 shadow-sm hover:bg-[#d3d3d3] transition-colors">
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${layerVisibility[layer]!==false?'bg-[#111]':'bg-[#aaa]'}`}/>
            <span className="text-[12px] font-semibold text-[#111]">{layer}</span>
          </div>
          <button type="button" onClick={()=>setLayerVisibility(prev=>({...prev,[layer]:!(prev[layer]!==false)}))}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-all duration-200 border ${layerVisibility[layer]!==false?'bg-[#111] border-[#111]':'bg-[#d0d0d0] border-[#c0c0c0]'}`}>
            <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-[#e0e0e0] shadow-sm transition-all duration-200 ${layerVisibility[layer]!==false?'left-[18px]':'left-[2px]'}`}/>
          </button>
        </div>
      ))}
    </div>
  );

  // ── My Projects content ───────────────────────────────────────────────────
  const renderAssignedProjects = () => (
    <div className="p-3 space-y-2">
      {ASSIGNED_PROJECTS.length === 0 && <div className="text-center text-[12px] text-[#888] py-8">No projects assigned to you yet.</div>}
      {ASSIGNED_PROJECTS.map((p, i) => (
        <div key={i} className="rounded-2xl border border-[#d0d0d0] bg-[#e0e0e0]/70 p-3 shadow-[0_4px_12px_rgba(0,0,0,0.05)] backdrop-blur-sm">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="min-w-0"><div className="text-[13px] font-semibold text-[#111] truncate">{p.name}</div><div className="text-[11px] text-[#666] truncate mt-0.5">{p.desc||'No description'}</div></div>
            <span className="shrink-0 rounded-full bg-[#111] px-2 py-0.5 text-[10px] font-semibold text-white">{p.status}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2">
            <span className="text-[11px] text-[#888]">Created: {p.date}</span>
            {p.dueDate&&<span className="text-[11px] text-[#888]">Due: {p.dueDate}</span>}
            <span className="text-[11px] font-medium text-green-700">Boundary defined</span>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#e8e8e8] border border-[#ccc] text-[11px] font-bold text-[#111]">U</div>
            <span className="text-[11px] text-[#555]">Assigned to you</span>
          </div>
          <button type="button" className="w-full rounded-xl bg-[#111] hover:bg-[#333] text-[#e0e0e0] py-2 text-[12px] font-semibold transition-colors shadow-[0_4px_12px_rgba(0,0,0,0.15)]"
            onClick={()=>{ mapRef.current?.flyTo({center:DEFAULT_CENTER,zoom:DEFAULT_ZOOM,essential:true}); setShowProject(false); }}>
            GoTo Project
          </button>
        </div>
      ))}
    </div>
  );

  const mobileSheetOpen  = isMobile && (showOC || showProject);
  const mobileSheetTitle = showProject ? 'My Projects' : 'Object Controller';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#d0d0d0] font-sans text-[#111]">
      <div ref={mapContainerRef} className="absolute inset-0 z-0" style={{ width: '100%', height: '100%' }}/>
      <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(rgba(0,0,0,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.02)_1px,transparent_1px)] bg-[size:40px_40px]"/>

      {activePlugins['minimap'] && <div ref={minimapContainerRef} className={`absolute z-30 overflow-hidden rounded-2xl border border-[#d7d7d7] bg-[#e0e0e0]/90 shadow-[0_12px_30px_rgba(0,0,0,0.16)] backdrop-blur-sm ${isMobile?'bottom-20 left-20 h-[80px] w-[112px]':'bottom-24 left-20 h-[132px] w-[190px]'}`}/>}
      {mobileSheetOpen && <div className="absolute inset-0 z-[28] bg-black/20" onClick={()=>{setShowOC(false);setShowProject(false);}}/>}

      {/* ── DESKTOP OC ── */}
      {!isMobile && (
        <div className={`absolute inset-y-0 left-0 z-30 border-r border-[#c0c0c0] bg-[#e0e0e0]/96 shadow-[0_16px_40px_rgba(0,0,0,0.12)] backdrop-blur-md transition-transform duration-300 ease-in-out ${showOC?'translate-x-0':'-translate-x-full'}`} style={{width:'250px'}}>
          <div className="flex items-center justify-between border-b border-[#d0d0d0] bg-[#d5d5d5] px-3 py-2 text-[13px] font-semibold text-[#111]">
            <span>Object Controller</span>
            <button type="button" onClick={()=>setShowOC(false)} className={`${ib} h-7 w-7 shrink-0 rounded-xl text-xs font-bold`}>←</button>
          </div>
          <div className="h-[calc(100%-41px)] overflow-y-auto px-2 py-2">
            {ocGroups.map((group,gi) => (
              <div key={group.key} className={gi>0?'mt-1 space-y-0.5':'space-y-0.5'}>
                <button type="button" onClick={()=>toggleGroup(group.key as any)} className="flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left font-medium text-[#111] transition-all hover:bg-[#d5d5d5]">
                  <span className="text-[13px] leading-tight">{group.key}</span>
                  <span className="shrink-0 text-[10px]">{expandedGroups[group.key as keyof ExpandedGroups]?'▾':'▸'}</span>
                </button>
                {expandedGroups[group.key as keyof ExpandedGroups] && (
                  <div className="ml-3 space-y-0.5 border-l border-[#c0c0c0] pl-2.5">
                    {group.items.map(item => (<button key={item} type="button" onClick={()=>selectObjectItem(item)} className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-all ${selectedObjectItem===item?'bg-[#111] text-[#e0e0e0]':'text-[#555] hover:bg-[#d5d5d5] hover:text-[#111]'}`}>{item}</button>))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── MOBILE drawer ── */}
      {isMobile && (
        <div className={`absolute left-0 top-0 bottom-0 z-[39] flex flex-col border-r border-[#c0c0c0] bg-[#e0e0e0]/96 shadow-[0_16px_40px_rgba(0,0,0,0.12)] backdrop-blur-md transition-transform duration-300 ease-in-out ${mobileSheetOpen?'translate-x-0':'-translate-x-full'}`} style={{width:'75vw',maxWidth:'280px'}}>
          <div className="flex items-center justify-between border-b border-[#d0d0d0] bg-[#d5d5d5] px-3 py-2.5 shrink-0">
            <span className="text-[13px] font-semibold text-[#111]">{mobileSheetTitle}</span>
            <button type="button" onClick={()=>{setShowOC(false);setShowProject(false);}} className={`${ib} h-8 w-8 rounded-xl text-xs font-bold`}>←</button>
          </div>
          {showOC&&!showProject && (
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {ocGroups.map((group,gi) => (
                <div key={group.key} className={gi>0?'mt-1 space-y-0.5':'space-y-0.5'}>
                  <button type="button" onClick={()=>toggleGroup(group.key as any)} className="flex w-full items-center justify-between rounded-xl px-2 py-1.5 text-left font-medium text-[#111] bg-[#e0e0e0] hover:bg-[#d5d5d5] transition-all">
                    <span className="text-[11px] leading-tight truncate pr-1">{group.key}</span>
                    <span className="shrink-0 text-[10px]">{expandedGroups[group.key as keyof ExpandedGroups]?'▾':'▸'}</span>
                  </button>
                  {expandedGroups[group.key as keyof ExpandedGroups] && (
                    <div className="ml-2 space-y-0.5 border-l border-[#c0c0c0] pl-2">
                      {group.items.map(item => (<button key={item} type="button" onClick={()=>{selectObjectItem(item);setShowOC(false);setShowProject(false);}} className={`block w-full rounded-lg px-2 py-1.5 text-left text-[11px] transition-all ${selectedObjectItem===item?'bg-[#111] text-[#e0e0e0]':'bg-[#e0e0e0] text-[#555] hover:bg-[#d5d5d5] hover:text-[#111]'}`}>{item}</button>))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {showProject && <div className="flex-1 overflow-y-auto">{renderAssignedProjects()}</div>}
        </div>
      )}

      {/* ── DESKTOP My Projects panel ── */}
      {!isMobile&&showProject && (
        <div className="absolute inset-y-0 z-30 border-r border-[#c0c0c0] bg-[#e0e0e0]/96 shadow-[0_16px_40px_rgba(0,0,0,0.12)] backdrop-blur-md" style={{left:`${ocPW}px`,width:'250px'}}>
          <div className="flex items-center justify-between border-b border-[#d0d0d0] bg-[#d5d5d5] px-3 py-2 text-[13px] font-semibold text-[#111]">
            <span>My Projects</span>
            <button type="button" onClick={()=>setShowProject(false)} className={`${ib} h-7 w-7 shrink-0 rounded-xl text-xs font-bold`}>←</button>
          </div>
          <div className="h-[calc(100%-41px)] overflow-y-auto">{renderAssignedProjects()}</div>
        </div>
      )}

      {/* ── TOP LEFT ── */}
      <div className="absolute top-2 z-30 flex items-center gap-1.5 transition-all duration-300" style={{left:`${tlLeft}px`}}>
        <button type="button" onClick={()=>{setShowTopMenu(p=>!p);setShowBaseMapDropdown(false);setShowDrawPopup(false);}} className={`${ib} h-9 w-9 rounded-2xl`}>
          <div className="flex flex-col gap-[3px]"><span className="block h-[2px] w-[14px] rounded bg-current"/><span className="block h-[2px] w-[14px] rounded bg-current"/><span className="block h-[2px] w-[14px] rounded bg-current"/></div>
        </button>
        <div className="flex h-9 w-[190px] sm:w-[280px] items-center rounded-2xl border border-[#c0c0c0] bg-[#e0e0e0]/95 px-3 shadow-[0_8px_22px_rgba(0,0,0,0.10)] backdrop-blur-md">
          <input value={searchText} onChange={e=>setSearchText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')runSearch();}} className="w-full bg-transparent text-[11px] sm:text-[12px] text-[#111] outline-none placeholder:text-[#8a8a8a]" placeholder="Search pole, cable, manhole..."/>
          <button type="button" onClick={runSearch} className="ml-2 flex h-7 w-7 items-center justify-center rounded-xl border border-[#d0d0d0] bg-[#d5d5d5] text-[#111] hover:bg-[#e0e0e0]" title="Search">⌕</button>
        </div>
        {showTopMenu && (
          <div className={`absolute left-0 z-50 overflow-hidden rounded-2xl border border-[#d7d7d7] bg-[#e0e0e0]/96 shadow-[0_14px_36px_rgba(0,0,0,0.18)] ${isMobile?'top-11 min-w-[132px]':'top-11 min-w-[176px]'}`}>
            {[
              {label:'Home',              action:()=>{mapRef.current?.flyTo({center:DEFAULT_CENTER,zoom:DEFAULT_ZOOM,essential:true});setShowTopMenu(false);}},
              {label:'Bookmark',          action:()=>setShowTopMenu(false)},
              {label:'Object Controller', action:()=>{setShowOC(p=>!p);if(isMobile)setShowProject(false);setShowTopMenu(false);}},
              {label:'My Projects',       action:()=>{setShowProject(p=>!p);if(isMobile)setShowOC(false);if(!showProject)setShowBottomPanel(false);setShowTopMenu(false);}},
            ].map((item,i) => (<button key={item.label} type="button" onClick={item.action} className={`flex w-full items-center text-left text-[#111] hover:bg-[#d5d5d5] ${isMobile?'px-3 py-2 text-[11px]':'px-4 py-2.5 text-[13px]'} ${i>0?'border-t border-[#d0d0d0]':''}`}>{item.label}</button>))}
          </div>
        )}
      </div>

      {/* ── TOP RIGHT ── */}
      <div className={`absolute top-2 z-[60] flex items-center gap-1.5 sm:gap-2 transition-all duration-300 ${rightShift}`}>
        <a href="https://redplanetgrp.com" target="_blank" rel="noreferrer" className="block">
          <img src="https://redplanetgrp.com/wp-content/uploads/2025/04/Redplanet-Solutions.webp" alt="RedPlanet" className="h-7 sm:h-9 w-auto object-contain"/>
        </a>
        <div className="relative">
          <button type="button" onClick={()=>{setShowUserPopup(p=>!p);setShowBaseMapDropdown(false);setShowTopMenu(false);}} className={`${ib} h-9 w-9 rounded-2xl`}><span className="text-sm">👤</span></button>
          {showUserPopup && (
            <div className="absolute right-0 top-[calc(100%+8px)] z-[70] w-[210px] overflow-hidden rounded-2xl border border-[#d7d7d7] bg-[#e0e0e0]/96 shadow-[0_14px_36px_rgba(0,0,0,0.18)] backdrop-blur-md">
              <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[#d0d0d0]">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#111] text-[#e0e0e0] text-[14px] font-bold select-none shadow-[0_4px_12px_rgba(0,0,0,0.2)]">U</div>
                <div className="min-w-0"><div className="truncate text-[12px] font-semibold text-[#111]">User</div><div className="truncate text-[10px] text-[#777]">user@redplanet.com</div></div>
              </div>
              <button type="button" onClick={()=>{setShowUserPopup(false);navigate('/');}} className="flex w-full items-center gap-2 px-4 py-3 text-left text-[12px] text-[#e11d48] font-semibold hover:bg-[#d5d5d5] transition-colors">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M11 11l3-3-3-3M14 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Logout
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT toolbar ── */}
      <div className={`absolute top-[46px] sm:top-[52px] z-30 flex flex-col gap-2 transition-all duration-300 ${rightShift} ${showUserPopup?'top-[58px] sm:top-[64px]':'top-[46px] sm:top-[52px]'}`}>
        <div className="relative">
          <button type="button" title="Base Map" onClick={()=>{setShowBaseMapDropdown(p=>!p);setShowTopMenu(false);setShowDrawPopup(false);setActiveTool(p=>p==='Plugins'?null:p);}} className={`${ib} h-10 w-10 rounded-2xl`}><LayersIcon/></button>
          {showBaseMapDropdown && (
            <div className="absolute right-[calc(100%+8px)] top-0 z-50 w-[200px] overflow-hidden rounded-2xl border border-[#d7d7d7] bg-[#e0e0e0]/96 shadow-[0_14px_36px_rgba(0,0,0,0.18)] backdrop-blur-md max-h-[70vh] overflow-y-auto">
              <div className="sticky top-0 border-b border-[#d0d0d0] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#666] bg-[#e0e0e0]">Base Map</div>
              {(['Road', 'Thematic', 'Satellite', 'Google'] as const).map(group => {
                const entries = Object.entries(BASE_MAPS).filter(([, v]) => v.group === group);
                return (
                  <div key={group}>
                    <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-[#888] bg-[#d8d8d8] border-t border-[#d0d0d0]">{group}</div>
                    {entries.map(([key, bm]) => (
                      <button key={key} type="button"
                        onClick={() => { setSelectedBaseMap(key); setShowBaseMapDropdown(false); if ((key==='Google'||key==='Google Satellite')&&!GOOGLE_ROAD_TILES_URL) alert('Set GOOGLE_ROAD_TILES_URL / GOOGLE_SAT_TILES_URL constants to use Google tiles. Falling back to OSM.'); }}
                        className={`flex w-full items-center justify-between px-3 py-2 text-left text-[11px] transition-all border-t border-[#d0d0d0] ${selectedBaseMap===key?'bg-[#111] text-[#e0e0e0]':'text-[#111] hover:bg-[#d5d5d5]'}`}>
                        <span>{bm.label}</span>
                        {selectedBaseMap===key && <span className="text-xs">✓</span>}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {tools.map(tool => {
          const isActive = activeTool===tool.label;
          return (
            <div key={tool.label} className="relative">
              <button type="button" title={tool.label} onClick={()=>handleToolClick(tool.label)}
                className={`h-10 w-10 rounded-2xl border border-[#c0c0c0] bg-[#e0e0e0]/95 shadow-[0_8px_22px_rgba(0,0,0,0.10)] backdrop-blur-md transition-all hover:bg-[#d5d5d5] active:scale-[0.98]`}>
                <tool.Icon active={isActive}/>
              </button>
              {tool.label==='Plugins'&&isActive&&<PluginsPanel/>}
              {tool.label==='Draw'&&isActive&&showDrawPopup&&<DrawPopup/>}
            </div>
          );
        })}
      </div>

      {/* ── Draw status bar ── */}
      {activeTool==='Draw'&&drawCount>0 && (
        <div className={`absolute left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-full border border-[#c0c0c0] bg-[#e0e0e0]/96 px-4 py-2 shadow-[0_10px_28px_rgba(0,0,0,0.16)] backdrop-blur-md text-[11px] text-[#111] whitespace-nowrap ${showBottomPanel?'bottom-[calc(20vh+52px)]':'bottom-14'}`}>
          <span className="font-medium capitalize">{drawGeometry}</span>
          <span className="text-[#888]">{drawCount} pt{drawCount!==1?'s':''}</span>
          <span className="text-[#c0c0c0]">|</span>
          {!drawFinished ? <button onClick={()=>setDrawFinished(true)} className={`${pb} rounded-full px-3 py-1 text-[10px] font-semibold`}>Finish</button> : <button onClick={saveDraw} className={`${pb} rounded-full px-3 py-1 text-[10px] font-semibold`}>Save</button>}
          <button onClick={clearDraw} className="text-[10px] text-[#e11d48] underline font-medium">Clear</button>
        </div>
      )}

      {/* ── Measure bar ── */}
      {activeTool==='Measure' && (
        <div className={`absolute left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-full border border-[#c0c0c0] bg-[#e0e0e0]/96 px-4 py-2 shadow-[0_10px_28px_rgba(0,0,0,0.16)] backdrop-blur-md text-[11px] text-[#111] whitespace-nowrap ${showBottomPanel?'bottom-[calc(20vh+52px)]':'bottom-14'}`}>
          <span className="font-medium">Measure</span>
          <span className="text-[#888]">{measureTotal!=null?(measureTotal<1?`${(measureTotal*1000).toFixed(0)} m`:`${measureTotal.toFixed(3)} km`):'Click map to start'}</span>
          <span className="text-[#c0c0c0]">|</span>
          <button onClick={clearMeasure} className="text-[10px] text-[#e11d48] underline font-medium">Clear</button>
        </div>
      )}

      {/* ── Zoom + Compass ── */}
      <div className={`absolute z-30 flex flex-col items-center gap-2 transition-all duration-300 ${ctrlBot}`} style={{left:`${blLeft}px`}}>
        <div className="flex flex-col items-center overflow-hidden rounded-[20px] border border-[#c0c0c0] bg-[#e0e0e0]/95 shadow-[0_10px_24px_rgba(0,0,0,0.12)] backdrop-blur-md">
          <button type="button" onClick={zoomIn} className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center border-b border-[#c0c0c0] text-sm sm:text-base font-bold text-[#111] hover:bg-[#d5d5d5] transition-all">+</button>
          <div className="flex items-center justify-center px-1 py-1.5">
            <input type="range" min="1" max="20" value={zoomLevel} onChange={e=>{const z=Number(e.target.value);setZoomLevel(z);mapRef.current?.setZoom(z);}} className="vertical-zoom-slider cursor-pointer appearance-none bg-transparent" style={{writingMode:'vertical-lr',direction:'rtl',width:'7px',height:isMobile?'42px':'48px'}}/>
          </div>
          <button type="button" onClick={zoomOut} className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center border-t border-[#c0c0c0] text-sm sm:text-base font-bold text-[#111] hover:bg-[#d5d5d5] transition-all">−</button>
        </div>
        <div className="rounded-[20px] border border-[#c0c0c0] bg-[#e0e0e0]/95 p-1 shadow-[0_10px_24px_rgba(0,0,0,0.12)] backdrop-blur-md">
          <SmallCompass size={isMobile?44:48}/>
        </div>
      </div>

      {/* ── Lat/Lon display ── */}
      <div className={`absolute z-30 rounded-2xl border border-[#c0c0c0] bg-[#e0e0e0]/95 px-2 py-1 sm:px-2.5 sm:py-1.5 text-[10px] sm:text-[11px] text-[#555] shadow-[0_10px_24px_rgba(0,0,0,0.12)] backdrop-blur-md transition-all duration-300 ${rightShift} ${llBot}`}>
        <span className="font-bold text-[#111]">Lat:</span> {latLon.lat.toFixed(4)}{' '}<span className="text-[#a0a0a0]">|</span>{' '}<span className="font-bold text-[#111]">Lon:</span> {latLon.lon.toFixed(4)}
      </div>

      {/* ── Object Editor – mobile ── */}
      {selectedObjectId&&isMobile && (
        <div className="absolute bottom-0 left-0 right-0 z-30 flex flex-col rounded-t-2xl border-t border-[#c0c0c0] bg-[#e0e0e0]/96 shadow-[0_-10px_30px_rgba(0,0,0,0.16)] backdrop-blur-md" style={{maxHeight:'50vh'}}>
          <div className="flex shrink-0 justify-center pb-1 pt-2"><div className="h-[3px] w-8 rounded-full bg-[#b0b0b0]"/></div>
          <div className="flex shrink-0 items-center justify-between border-b border-[#d0d0d0] bg-[#d5d5d5] px-3 py-1.5">
            <span className="text-[12px] font-semibold text-[#111]">Object Editor</span>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={zoomToSelected} className={`${ib} h-7 w-7 rounded-xl text-xs`}>⌖</button>
              {!isEditing&&<button onClick={startEditing} className={`${gb} rounded-xl px-2 py-1 text-[11px] font-medium`}>Edit</button>}
              <button type="button" onClick={closeEditor} className={`${ib} h-7 w-7 rounded-xl text-xs font-bold`}>↓</button>
            </div>
          </div>
          <div className="shrink-0 border-b border-[#d0d0d0] bg-[#d8d8d8] px-3 py-1"><span className="text-[11px] text-[#555]">Selected: </span><span className="text-[11px] font-semibold text-[#111]">{getDisplayLabel()}</span></div>
          <div className="flex shrink-0 border-b border-[#d0d0d0] bg-[#d5d5d5]">
            {(['Details','Layers'] as const).map(tab=>(<button key={tab} onClick={()=>setActiveTab(tab)} className={`px-5 py-1.5 transition text-[11px] ${activeTab===tab?'border-b-[2px] border-[#111] bg-[#e0e0e0] font-semibold text-[#111]':'text-[#666] border-b-[2px] border-transparent hover:bg-[#d8d8d8]'}`}>{tab}</button>))}
          </div>
          <div className="flex-1 overflow-y-auto">{activeTab==='Details'?renderDetails(true):renderLayers(true)}</div>
          {isEditing && (
            <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-[#d0d0d0] bg-[#d5d5d5] px-2 py-1.5">
              <button onClick={cancelEditing} className={`${gb} rounded-xl px-2 py-1 text-[11px] font-medium`}>Cancel</button>
              <button onClick={deleteObj}     className={`${gb} rounded-xl px-2 py-1 text-[11px] font-medium`}>Delete</button>
              <div className="relative">
                <button type="button" onClick={()=>setShowSaveMenu(p=>!p)} className={`${pb} rounded-xl px-2 py-1 text-[11px] font-medium`}>Save ▾</button>
                {showSaveMenu && (<div className="absolute bottom-full right-0 mb-1 min-w-[140px] overflow-hidden rounded-xl border border-[#c0c0c0] bg-[#e0e0e0] shadow-[0_12px_30px_rgba(0,0,0,0.15)]"><button type="button" onClick={()=>saveChanges(false)} className="block w-full px-3 py-2 text-left text-[11px] text-[#111] hover:bg-[#d5d5d5]">Save</button><button type="button" onClick={()=>saveChanges(true)} className="block w-full border-t border-[#d0d0d0] px-3 py-2 text-left text-[11px] text-[#111] hover:bg-[#d5d5d5]">Save &amp; Continue</button></div>)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Object Editor – desktop ── */}
      {selectedObjectId&&!isMobile && (
        <div className="absolute inset-y-0 right-0 z-30 flex w-[320px] flex-col border-l border-[#c0c0c0] bg-[#e0e0e0]/96 shadow-[0_16px_40px_rgba(0,0,0,0.12)] backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-[#d0d0d0] bg-[#d5d5d5] px-3 py-2">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#111]">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="3" stroke="#e0e0e0" strokeWidth="1.3"/><path d="M4 5h8M4 8h5M4 11h6" stroke="#e0e0e0" strokeWidth="1.2" strokeLinecap="round"/></svg>
              </div>
              <div className="text-[13px] font-semibold text-[#111]">Object Editor</div>
            </div>
            <button type="button" onClick={closeEditor} className={`${ib} h-7 w-7 rounded-xl text-sm font-bold`}>→</button>
          </div>
          <div className="flex items-center justify-between gap-2 border-b border-[#d0d0d0] bg-[#d8d8d8] px-3 py-1.5">
            <div className="truncate text-[11px] text-[#555]">Selected: <span className="font-semibold text-[#111]">{getDisplayLabel()}</span></div>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={zoomToSelected} className={`${ib} h-7 w-7 rounded-xl text-xs font-bold`}>⌖</button>
              {!isEditing&&<button onClick={startEditing} className={`${gb} rounded-xl px-2.5 py-1 text-[11px] font-medium`}>Edit</button>}
            </div>
          </div>
          <div className="flex border-b border-[#d0d0d0] bg-[#d5d5d5]">
            {(['Details','Layers'] as const).map(tab=>(<button key={tab} onClick={()=>setActiveTab(tab)} className={`px-5 py-1.5 transition text-[11px] ${activeTab===tab?'border-b-[2px] border-[#111] bg-[#e0e0e0] font-semibold text-[#111]':'text-[#666] border-b-[2px] border-transparent hover:bg-[#d8d8d8]'}`}>{tab}</button>))}
          </div>
          <div className={`${isEditing?'h-[calc(100%-106px)]':'h-[calc(100%-84px)]'} overflow-y-auto`}>
            {activeTab==='Details'?renderDetails(false):renderLayers(false)}
          </div>
          {isEditing && (
            <div className="flex items-center justify-end gap-2 border-t border-[#d0d0d0] bg-[#d5d5d5] px-2 py-2">
              <button onClick={cancelEditing} className={`${gb} rounded-xl px-2.5 py-1.5 text-[11px] font-medium`}>Cancel</button>
              <button onClick={deleteObj}     className={`${gb} rounded-xl px-2.5 py-1.5 text-[11px] font-medium`}>Delete</button>
              <div className="relative">
                <button type="button" onClick={()=>setShowSaveMenu(p=>!p)} className={`${pb} rounded-xl px-2.5 py-1.5 text-[11px] font-medium`}>Save ▾</button>
                {showSaveMenu && (<div className="absolute bottom-full right-0 mb-2 min-w-[160px] overflow-hidden rounded-xl border border-[#c0c0c0] bg-[#e0e0e0] shadow-[0_12px_30px_rgba(0,0,0,0.15)]"><button type="button" onClick={()=>saveChanges(false)} className="block w-full px-3 py-2 text-left text-[11px] text-[#111] hover:bg-[#d5d5d5]">Save</button><button type="button" onClick={()=>saveChanges(true)} className="block w-full border-t border-[#d0d0d0] px-3 py-2 text-left text-[11px] text-[#111] hover:bg-[#d5d5d5]">Save &amp; Continue</button></div>)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Bottom Table ── */}
      {showBottomPanel&&!showProject && (
        <div className={`absolute bottom-0 left-0 right-0 z-40 border-t border-[#c0c0c0] bg-[#e0e0e0]/96 shadow-[0_-10px_30px_rgba(0,0,0,0.14)] backdrop-blur-md ${isMobile?'h-[30vh]':'h-[20vh] min-h-[140px] max-h-[190px]'}`}>
          <div className="flex items-center gap-1.5 border-b border-[#d0d0d0] bg-[#d5d5d5] px-2 py-1.5 flex-wrap">
            <div className="mr-auto shrink-0 truncate text-[12px] font-semibold text-[#111]">{selectedObjectItem||'Objects'}</div>
            <select value={tableFilterMode} onChange={e=>setTableFilterMode(e.target.value)} className="h-7 rounded-xl border border-[#c0c0c0] bg-[#e0e0e0] px-1.5 text-[11px] font-medium text-[#111] outline-none"><option>By ID</option></select>
            <input value={tableFilterInput} onChange={e=>setTableFilterInput(e.target.value)} placeholder="Filter…" className="h-7 w-[80px] rounded-xl border border-[#c0c0c0] bg-[#e0e0e0] px-2 text-[11px] text-[#111] outline-none placeholder:text-[#888]"/>
            <button type="button" onClick={()=>setAppliedTableFilter(tableFilterInput)} className={`${pb} h-7 rounded-xl px-2.5 text-[11px] font-semibold`}>Run</button>
            <button type="button" onClick={downloadTable} className={`${gb} h-7 rounded-xl px-2.5 text-[11px] font-semibold`}>Download</button>
            <button onClick={()=>setShowBottomPanel(false)} className={`${ib} h-7 w-7 rounded-xl text-xs font-bold`}>↓</button>
          </div>
          <div className="h-[calc(100%-42px)] overflow-auto">
            <table className="min-w-full table-fixed text-[11px]">
              <thead className="sticky top-0 bg-[#d5d5d5]">
                <tr className="text-left text-[#111]">
                  {['ID','Type','Status','Owner','Material','Height','Municipality','Design ID'].map(h=>(<th key={h} className="truncate whitespace-nowrap px-2 py-[5px] font-semibold">{h}</th>))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row,idx) => (
                  <tr key={row.key} onClick={row.onClick} className={`h-[24px] leading-none transition-colors ${row.onClick?'cursor-pointer':''} ${row.selected?'border-l-2 border-l-[#111] bg-[#d0d0d0]':idx%2===0?'bg-[#e0e0e0] hover:bg-[#d5d5d5]':'bg-[#dcdcdc] hover:bg-[#d5d5d5]'}`}>
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
                {filteredRows.length===0 && <tr><td colSpan={8} className="px-3 py-4 text-center text-[11px] text-[#888]">No records found.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <style>{`
        .maplibregl-ctrl-bottom-left,.maplibregl-ctrl-bottom-right,.maplibregl-ctrl-top-left,.maplibregl-ctrl-top-right{display:none!important;}
        .maplibregl-canvas{outline:none;}
        .maplibregl-popup-content{padding:0!important;border-radius:12px!important;overflow:hidden;box-shadow:0 8px 22px rgba(0,0,0,0.18)!important;background-color:#e0e0e0!important;}
        .maplibregl-popup-tip{border-top-color:#e0e0e0!important;border-bottom-color:#e0e0e0!important;}
        .vertical-zoom-slider::-webkit-slider-runnable-track{width:5px;border-radius:9999px;background:#c0c0c0;}
        .vertical-zoom-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:12px;height:12px;border-radius:9999px;background:#111;border:2px solid #e0e0e0;box-shadow:0 2px 8px rgba(0,0,0,.24);margin-left:-4px;}
        .vertical-zoom-slider::-moz-range-track{width:5px;border-radius:9999px;background:#c0c0c0;}
        .vertical-zoom-slider::-moz-range-thumb{width:12px;height:12px;border-radius:9999px;background:#111;border:2px solid #e0e0e0;box-shadow:0 2px 8px rgba(0,0,0,.24);}
      `}</style>
    </div>
  );
}