// Assigner — with CAD Tools + Analytical Tools

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
type ProjectTab = 'dashboard' | 'project';
type ActiveTool = 'Locate' | 'Select' | 'Draw' | 'Measure' | 'Clear' | 'Plugins' | null;
// NEW: CAD and Analytical tool types
type ActiveCADTool       = 'Duplicate' | 'Move' | 'Snap' | 'Vertex' | 'Scale' | 'Rotate' | null;
type ActiveAnalyticalTool = 'Buffer' | 'Distance' | 'Nearest' | 'Overlay' | 'Intersect' | 'Union' | 'Clip' | 'Routing' | 'Contour' | 'Isochrone' | null;
type DrawGeometry = 'point' | 'line' | 'polygon';
type BottomRow  = {
  key: string; id: string; type: string; status: string; owner: string;
  material: string; height: string; municipality: string; designId: string;
  onClick?: () => void; selected?: boolean;
};
type Project    = { name: string; desc: string; date: string; status: string; assignTo?: string; dueDate?: string };
type Assignment = { project: string; user: string; status: string; due: string; created: string };

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

function makeRasterStyle(
  tiles: string[], src: string, attr: string, night = false
): maplibregl.StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: { [src]: { type: 'raster', tiles, tileSize: 256, attribution: attr, maxzoom: 22 } },
    layers: [{
      id: `${src}-tiles`, type: 'raster', source: src, minzoom: 0, maxzoom: 24,
      paint: night ? { 'raster-brightness-max': 0.42, 'raster-saturation': -0.9, 'raster-contrast': 0.28 } : {},
    }],
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

// ── CAD & Analytical tool definitions ─────────────────────────────────────────
const CAD_TOOLS: { id: ActiveCADTool; label: string; desc: string; icon: string }[] = [
  { id: 'Duplicate', label: 'Duplicate', desc: 'Copy selected feature',   icon: 'M' },
  { id: 'Move',      label: 'Move',      desc: 'Drag feature to new pos', icon: 'M' },
  { id: 'Snap',      label: 'Snap',      desc: 'Snap to nearby features', icon: 'S' },
  { id: 'Vertex',    label: 'Vertex',    desc: 'Edit feature vertices',   icon: 'V' },
  { id: 'Scale',     label: 'Scale',     desc: 'Resize selected feature', icon: 'S' },
  { id: 'Rotate',    label: 'Rotate',    desc: 'Rotate selected feature', icon: 'R' },
];

const ANALYTICAL_TOOLS: { id: ActiveAnalyticalTool; label: string; desc: string; icon: string }[] = [
  { id: 'Buffer',    label: 'Buffer',    desc: 'Create buffer around feature', icon: 'B' },
  { id: 'Distance',  label: 'Distance',  desc: 'Measure straight-line distance', icon: 'D' },
  { id: 'Nearest',   label: 'Nearest',   desc: 'Find nearest feature',          icon: 'N' },
  { id: 'Overlay',   label: 'Overlay',   desc: 'Overlay two feature layers',    icon: 'O' },
  { id: 'Intersect', label: 'Intersect', desc: 'Compute layer intersection',    icon: 'I' },
  { id: 'Union',     label: 'Union',     desc: 'Merge two layers',              icon: 'U' },
  { id: 'Clip',      label: 'Clip',      desc: 'Clip layer by boundary',        icon: 'C' },
  { id: 'Routing',   label: 'Routing',   desc: 'Find optimal route',            icon: 'R' },
  { id: 'Contour',   label: 'Contour',   desc: 'Generate contour lines',        icon: 'C' },
  { id: 'Isochrone', label: 'Isochrone', desc: 'Travel-time zones',             icon: 'I' },
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

// NEW: CAD & Analytical Icons
const IconCAD = ({ active }: { active?: boolean }) => (
  <ToolShell active={active}>
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
      <path d="M3 21L10 14M21 3L14 10M10 14L14 10" stroke={active ? '#e0e0e0' : '#111'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="10" cy="14" r="2" fill={active ? '#e0e0e0' : '#111'}/>
      <circle cx="14" cy="10" r="2" fill={active ? '#e0e0e0' : '#111'}/>
      <path d="M17 3h4v4M7 21H3v-4" stroke={active ? '#e0e0e0' : '#111'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  </ToolShell>
);

const IconAnalytical = ({ active }: { active?: boolean }) => (
  <ToolShell active={active}>
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
      <circle cx="8"  cy="8"  r="4.5" stroke={active ? '#e0e0e0' : '#111'} strokeWidth="1.6"/>
      <circle cx="16" cy="16" r="4.5" stroke={active ? '#e0e0e0' : '#111'} strokeWidth="1.6"/>
      <path d="M11.5 11.5L12.5 12.5" stroke={active ? '#e0e0e0' : '#111'} strokeWidth="1.4" strokeLinecap="round" opacity="0.7"/>
    </svg>
  </ToolShell>
);

const IcPt  = ({ active }: { active: boolean }) => (<svg viewBox="0 0 24 24" width="13" height="13" fill="none"><circle cx="12" cy="12" r="6.5" stroke={active ? '#e0e0e0' : '#111'} strokeWidth="3"/><circle cx="12" cy="12" r="2" fill={active ? '#e0e0e0' : '#111'}/></svg>);
const IcLn  = ({ active }: { active: boolean }) => (<svg viewBox="0 0 24 24" width="13" height="13" fill="none"><circle cx="5" cy="19" r="2.8" fill={active ? '#e0e0e0' : '#111'}/><circle cx="19" cy="5" r="2.8" fill={active ? '#e0e0e0' : '#111'}/><path d="M6.8 17.2L17.2 6.8" stroke={active ? '#e0e0e0' : '#111'} strokeWidth="2" strokeLinecap="round"/></svg>);
const IcPg  = ({ active }: { active: boolean }) => (<svg viewBox="0 0 24 24" width="13" height="13" fill="none"><polygon points="12,3 21,18.5 3,18.5" fill={active ? 'rgba(255,255,255,0.18)' : 'rgba(17,17,17,0.08)'} stroke={active ? '#e0e0e0' : '#111'} strokeWidth="1.8" strokeLinejoin="round"/><circle cx="12" cy="3" r="2" fill={active ? '#e0e0e0' : '#111'}/><circle cx="21" cy="18.5" r="2" fill={active ? '#e0e0e0' : '#111'}/><circle cx="3" cy="18.5" r="2" fill={active ? '#e0e0e0' : '#111'}/></svg>);

// ── SVG icons per CAD tool ─────────────────────────────────────────────────────
function CADToolIcon({ id }: { id: ActiveCADTool }) {
  const s = '#111';
  switch (id) {
    case 'Duplicate': return <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="7" width="11" height="13" rx="2" stroke={s} strokeWidth="1.5"/><path d="M8 7V5a2 2 0 012-2h9a2 2 0 012 2v10a2 2 0 01-2 2h-2" stroke={s} strokeWidth="1.5" strokeLinecap="round"/></svg>;
    case 'Move':      return <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 3v18M3 12h18M12 3L9 6M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" stroke={s} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case 'Snap':      return <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" fill={s}/><circle cx="12" cy="12" r="7" stroke={s} strokeWidth="1.5" strokeDasharray="3 2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke={s} strokeWidth="1.5" strokeLinecap="round"/></svg>;
    case 'Vertex':    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><polygon points="12,3 21,18 3,18" fill="none" stroke={s} strokeWidth="1.5" strokeLinejoin="round"/><circle cx="12" cy="3" r="2.5" fill={s}/><circle cx="21" cy="18" r="2.5" fill={s}/><circle cx="3" cy="18" r="2.5" fill={s}/></svg>;
    case 'Scale':     return <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="12" height="12" rx="2" stroke={s} strokeWidth="1.5"/><rect x="3" y="3" width="8" height="8" rx="1.5" stroke={s} strokeWidth="1.5" strokeDasharray="2 1.5"/><path d="M15 3l6 6M3 15l6 6" stroke={s} strokeWidth="1.5" strokeLinecap="round"/></svg>;
    case 'Rotate':    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 12a9 9 0 109-9H9" stroke={s} strokeWidth="1.5" strokeLinecap="round"/><path d="M9 3L9 9H3" stroke={s} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    default:          return null;
  }
}

// ── SVG icons per Analytical tool ─────────────────────────────────────────────
function AnalyticalToolIcon({ id }: { id: ActiveAnalyticalTool }) {
  const s = '#111';
  switch (id) {
    case 'Buffer':    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" fill={s} opacity=".3"/><circle cx="12" cy="12" r="4" stroke={s} strokeWidth="1.5"/><circle cx="12" cy="12" r="8" stroke={s} strokeWidth="1.2" strokeDasharray="3 2"/></svg>;
    case 'Distance':  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="5" cy="12" r="2.5" fill={s}/><circle cx="19" cy="12" r="2.5" fill={s}/><path d="M7.5 12h9" stroke={s} strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 1.5"/><path d="M8 9l-2 3 2 3M16 9l2 3-2 3" stroke={s} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case 'Nearest':   return <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3" fill={s} opacity=".35"/><circle cx="4"  cy="18" r="2" stroke={s} strokeWidth="1.3"/><circle cx="20" cy="18" r="2" stroke={s} strokeWidth="1.3"/><path d="M12 11l-6.5 6.5M12 11l6.5 6.5" stroke={s} strokeWidth="1.3" strokeLinecap="round" strokeDasharray="2.5 1.5"/></svg>;
    case 'Overlay':   return <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="12" height="12" rx="2" stroke={s} strokeWidth="1.4" opacity=".6"/><rect x="9" y="9" width="12" height="12" rx="2" stroke={s} strokeWidth="1.4" opacity=".9" fill={s} fillOpacity=".12"/></svg>;
    case 'Intersect': return <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="9"  cy="12" r="6" stroke={s} strokeWidth="1.4"/><circle cx="15" cy="12" r="6" stroke={s} strokeWidth="1.4"/><path d="M12 6.8a6 6 0 010 10.4A6 6 0 0112 6.8z" fill={s} fillOpacity=".2"/></svg>;
    case 'Union':     return <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 18C3.8 18 2 16.2 2 14V10C2 7.8 3.8 6 6 6h12c2.2 0 4 1.8 4 4v4c0 2.2-1.8 4-4 4H6z" stroke={s} strokeWidth="1.4" fill={s} fillOpacity=".1"/><path d="M9 12h6M12 9v6" stroke={s} strokeWidth="1.4" strokeLinecap="round"/></svg>;
    case 'Clip':      return <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 4l16 16M4 4h8v8H4V4zM4 4l16 16" stroke={s} strokeWidth="1.4" strokeLinecap="round"/><path d="M12 12h8v8h-8v-8z" stroke={s} strokeWidth="1.4" fill={s} fillOpacity=".12"/><path d="M4 12h8M12 4v8" stroke={s} strokeWidth="1" strokeLinecap="round" strokeDasharray="2 1.5" opacity=".5"/></svg>;
    case 'Routing':   return <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="5" cy="5" r="2.5" fill={s}/><circle cx="19" cy="19" r="2.5" fill={s}/><path d="M5 7.5V13a2 2 0 002 2h10a2 2 0 012 2v.5" stroke={s} strokeWidth="1.5" strokeLinecap="round"/><path d="M17 4l4 4-4 4" stroke={s} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case 'Contour':   return <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 16c2-4 5-6 8-6s6 2 8 6" stroke={s} strokeWidth="1.4" strokeLinecap="round"/><path d="M6 12c1.5-3 3.5-5 6-5s4.5 2 6 5" stroke={s} strokeWidth="1.2" strokeLinecap="round" opacity=".65"/><path d="M8 8c1-2 2-3 4-3s3 1 4 3" stroke={s} strokeWidth="1" strokeLinecap="round" opacity=".45"/></svg>;
    case 'Isochrone': return <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="2.5" fill={s}/><ellipse cx="12" cy="12" rx="6" ry="4" stroke={s} strokeWidth="1.2" strokeDasharray="3 2"/><ellipse cx="12" cy="12" rx="9.5" ry="6.5" stroke={s} strokeWidth="1" strokeDasharray="2.5 2.5" opacity=".55"/></svg>;
    default: return null;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function AssignerPanelPage() {
  const navigate = useNavigate();
  const handleLogout = () => { navigate('/'); };

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
  const [isMobile, setIsMobile]                     = useState(false);
  const [zoomLevel, setZoomLevel]                   = useState(DEFAULT_ZOOM);
  const [latLon, setLatLon]                         = useState({ lat: DEFAULT_CENTER[1], lon: DEFAULT_CENTER[0] });
  const [compassAngle, setCompassAngle]             = useState(0);
  const [selectedBaseMap, setSelectedBaseMap]       = useState('OSM');
  const [showBaseMapDropdown, setShowBaseMapDropdown] = useState(false);
  const [activeTool, setActiveTool]                 = useState<ActiveTool>(null);
  const [showDrawPopup, setShowDrawPopup]           = useState(false);
  const [drawGeometry, setDrawGeometry]             = useState<DrawGeometry>('point');
  const [drawCount, setDrawCount]                   = useState(0);
  const [drawFinished, setDrawFinished]             = useState(false);
  const [measureTotal, setMeasureTotal]             = useState<number | null>(null);
  const [activePlugins, setActivePlugins]           = useState<Record<string, boolean>>({});
  const [searchText, setSearchText]                 = useState('');
  const [layerVisibility, setLayerVisibility]       = useState<Record<string, boolean>>({ Pole: true, Substation: true, Cabinate: true, Cable: true });
  const [showTopMenu, setShowTopMenu]               = useState(false);
  const [showOC, setShowOC]                         = useState(false);
  const [showProject, setShowProject]               = useState(false);
  const [showUserPopup, setShowUserPopup]           = useState(false);
  const [showBottomPanel, setShowBottomPanel]       = useState(false);
  const [activeTab, setActiveTab]                   = useState<ActiveTab>('Details');
  const [isEditing, setIsEditing]                   = useState(false);
  const [selectedObjectId, setSelectedObjectId]     = useState<string | null>(null);
  const [selectedObjectItem, setSelectedObjectItem] = useState('');
  const [attributes, setAttributes]                 = useState<Attribute[]>([]);
  const [draftAttributes, setDraftAttributes]       = useState<Attribute[]>([]);
  const [showSaveMenu, setShowSaveMenu]             = useState(false);
  const [expandedGroups, setExpandedGroups]         = useState<ExpandedGroups>({ Segment: false, 'Distribution Structure': false, Equipment: false });
  const [tableFilterMode, setTableFilterMode]       = useState('By ID');
  const [tableFilterInput, setTableFilterInput]     = useState('');
  const [appliedTableFilter, setAppliedTableFilter] = useState('');
  const [projectTab, setProjectTab]                 = useState<ProjectTab>('dashboard');
  const [projects, setProjects]                     = useState<Project[]>([{ name: 'Pole_test', desc: 'Condition of the pole', date: '6/4/2026', status: 'Active' }]);
  const [assignments]                               = useState<Assignment[]>([]);
  const [showProjectForm, setShowProjectForm]       = useState(false);
  const [projName, setProjName]                     = useState('');
  const [projDesc, setProjDesc]                     = useState('');
  const [projStatus, setProjStatus]                 = useState('New');
  const [projAssignTo, setProjAssignTo]             = useState('');
  const [projDueDate, setProjDueDate]               = useState('');

  // ── NEW: CAD / Analytical state ───────────────────────────────────────────
  const [showCADPanel, setShowCADPanel]             = useState(false);
  const [activeCADTool, setActiveCADTool]           = useState<ActiveCADTool>(null);
  const [showAnalyticalPanel, setShowAnalyticalPanel] = useState(false);
  const [activeAnalyticalTool, setActiveAnalyticalTool] = useState<ActiveAnalyticalTool>(null);
  // Buffer radius state for the Buffer tool
  const [bufferRadius, setBufferRadius]             = useState(100);
  const [bufferUnit, setBufferUnit]                 = useState<'m' | 'km'>('m');

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
      addOverlaySources(map);
      addPoleMarkers(map);
      applyPluginVisuals(map, activePluginsRef.current, layerVisibilityRef.current);
      setDrawData(map, drawPtsRef.current, drawGeomRef.current);
      map.jumpTo({ center, zoom, bearing });
      map.resize();
      updateMinimapViewport();
    });
  }, [selectedBaseMap, isNightMode, addOverlaySources, addPoleMarkers, applyPluginVisuals, setDrawData, updateMinimapViewport]);

  // ── Plugin fast visual effects ────────────────────────────────────────────
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

  // ── Search ────────────────────────────────────────────────────────────────
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
      if (objectType === 'Pole') { setSelectedObjectId(null); setAttributes([]); setDraftAttributes([]); setIsEditing(false); setShowSaveMenu(false); }
      else {
        const code = objectType.toUpperCase().slice(0, 2), oid = `${code}-001`;
        const data: Attribute[] = [{ field:'asset_id', value:oid }, { field:'feature_type', value:objectType }, { field:'status', value:'Active' }, { field:'owner', value:'Utility Network' }, { field:'material', value:objectType==='Manhole'?'Concrete':'Steel' }, { field:'municipality', value:'Quezon City' }, { field:'design_id', value:`${code}-1001` }];
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
    if (tool==='Plugins'){ setShowDrawPopup(false); setActiveTool(prev=>prev==='Plugins'?null:'Plugins'); setShowCADPanel(false); setShowAnalyticalPanel(false); return; }
    setShowDrawPopup(false);
    setActiveTool(prev => { if(prev===tool){if(tool==='Measure')clearMeasure();return null;} if(prev==='Measure')clearMeasure(); return tool; });
  };

  const selectDrawType = (geom: DrawGeometry) => { setDrawGeometry(geom); drawGeomRef.current=geom; clearDraw(); setActiveTool('Draw'); setShowDrawPopup(false); setDrawFinished(false); };
  const togglePlugin   = (id: string) => { setActivePlugins((prev) => ({ ...prev, [id]: !prev[id] })); };

  // ── NEW: CAD/Analytical handlers ──────────────────────────────────────────
  const handleCADClick = () => {
    setShowCADPanel(p => !p);
    setShowAnalyticalPanel(false);
    setActiveTool(null);
    setShowDrawPopup(false);
  };

  const handleAnalyticalClick = () => {
    setShowAnalyticalPanel(p => !p);
    setShowCADPanel(false);
    setActiveTool(null);
    setShowDrawPopup(false);
  };

  const selectCADTool = (id: ActiveCADTool) => {
    setActiveCADTool(prev => prev === id ? null : id);
  };

  const selectAnalyticalTool = (id: ActiveAnalyticalTool) => {
    setActiveAnalyticalTool(prev => prev === id ? null : id);
  };

  const runCADTool = (id: ActiveCADTool) => {
    const msgs: Record<string, string> = {
      Duplicate: 'Select a feature on the map to duplicate.',
      Move:      'Click a feature, then click its destination.',
      Snap:      'Snapping is now active. Draw to snap to nearby vertices.',
      Vertex:    'Click a feature to edit its vertices.',
      Scale:     'Select a feature and drag handles to scale.',
      Rotate:    'Select a feature, then drag to rotate it.',
    };
    alert(msgs[id as string] || `${id} activated.`);
  };

  const runAnalyticalTool = (id: ActiveAnalyticalTool) => {
    if (id === 'Buffer') {
      alert(`Buffer of ${bufferRadius}${bufferUnit} will be applied to the selected feature.`);
      return;
    }
    const msgs: Record<string, string> = {
      Distance:  'Click two points on the map to measure distance.',
      Nearest:   'Click a point to find the nearest pole.',
      Overlay:   'Select two layers to overlay.',
      Intersect: 'Select two layers to compute intersection.',
      Union:     'Select two layers to merge.',
      Clip:      'Draw a boundary to clip the active layer.',
      Routing:   'Click a start point, then an end point for routing.',
      Contour:   'Generating contour lines from elevation data...',
      Isochrone: 'Click a point to generate isochrone zones.',
    };
    alert(msgs[id as string] || `${id} activated.`);
  };

  // ── Object helpers ────────────────────────────────────────────────────────
  const getPV = (pole: Pole, f: string) => pole.attributes.find(a=>a.field===f)?.value||'-';
  const getDisplayLabel = () => { const n=selectedObjectItem||'Object'; return selectedObjectId?`${n} (${selectedObjectId})`:n; };
  const getSelectedPole = () => POLES.find(p=>p.id===selectedObjectId)||null;
  const zoomToSelected  = () => { const p=getSelectedPole(); if(p) mapRef.current?.flyTo({center:[p.lon,p.lat],zoom:18,essential:true}); };
  const startEditing    = () => { setDraftAttributes(attributes.map(i=>({...i}))); setIsEditing(true); setShowSaveMenu(false); };
  const cancelEditing   = () => { setDraftAttributes(attributes.map(i=>({...i}))); setIsEditing(false); setShowSaveMenu(false); };
  const handleDraft     = (field: string, value: string) => setDraftAttributes(prev=>prev.map(i=>i.field===field?{...i,value}:i));
  const saveChanges     = (cont: boolean) => { setAttributes(draftAttributes.map(i=>({...i}))); setIsEditing(cont); setShowSaveMenu(false); };
  const deleteObj       = () => { setSelectedObjectId(null); setAttributes([]); setDraftAttributes([]); setIsEditing(false); setShowSaveMenu(false); };
  const closeEditor     = () => { setSelectedObjectId(null); setIsEditing(false); setShowSaveMenu(false); };
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

  // ── Project helpers ───────────────────────────────────────────────────────
  const saveProject = () => {
    if (!projName.trim()) return;
    setProjects(prev=>[...prev,{ name:projName.trim(), desc:projDesc.trim(), date:new Date().toLocaleDateString('en-US'), status:projStatus, assignTo:projAssignTo, dueDate:projDueDate }]);
    setProjName(''); setProjDesc(''); setProjStatus('New'); setProjAssignTo(''); setProjDueDate(''); setShowProjectForm(false);
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

  // Original tools
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
      <text x="27" y="14.5"   textAnchor="middle" fontSize="5.5" fontWeight="700" fill="#111" fontFamily="sans-serif">N</text>
      <text x="27" y="44.5"  textAnchor="middle" fontSize="5"  fontWeight="500" fill="#999" fontFamily="sans-serif">S</text>
      <text x="43.5" y="28.8" textAnchor="middle" fontSize="5"  fontWeight="500" fill="#999" fontFamily="sans-serif">E</text>
      <text x="10.5" y="28.8" textAnchor="middle" fontSize="5"  fontWeight="500" fill="#999" fontFamily="sans-serif">W</text>
    </svg>
  );

  const DrawPopup = () => (
    <div className="absolute right-[calc(100%+8px)] top-0 z-50 flex flex-col items-end gap-1">
      <div className="rounded-full border border-[#d0d0d0] bg-[#e0e0e0]/95 px-2.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-[#666] shadow-sm whitespace-nowrap mb-0.5">Draw</div>
      {([{key:'point' as DrawGeometry,label:'Point',Ic:IcPt},{key:'line' as DrawGeometry,label:'Line',Ic:IcLn},{key:'polygon' as DrawGeometry,label:'Polygon',Ic:IcPg}]).map(({key,label,Ic}) => {
        const active = drawGeometry===key;
        return (
          <button key={key} type="button" onClick={()=>selectDrawType(key)} className={['flex h-7 items-center gap-1.5 rounded-full border px-2.5 shadow-sm transition-all duration-200 active:scale-[0.95] whitespace-nowrap', active?'border-[#111] bg-[#111] text-white':'border-[#d0d0d0] bg-[#e0e0e0] text-[#111] hover:bg-[#d5d5d5]'].join(' ')}>
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

  // ── NEW: CAD Panel ─────────────────────────────────────────────────────────
  const CADPanel = () => (
    <div className="absolute right-[calc(100%+8px)] top-0 z-50 w-[230px] overflow-hidden rounded-2xl border border-[#d7d7d7] bg-[#e0e0e0]/96 shadow-[0_14px_36px_rgba(0,0,0,0.18)] backdrop-blur-md">
      <div className="border-b border-[#d0d0d0] bg-[#d8d8d8] px-3 py-2 flex items-center gap-2">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M3 21L10 14M21 3L14 10M10 14L14 10" stroke="#555" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="10" cy="14" r="2.5" fill="#555"/><circle cx="14" cy="10" r="2.5" fill="#555"/></svg>
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#555]">CAD Tools</span>
      </div>
      <div className="divide-y divide-[#d0d0d0]">
        {CAD_TOOLS.map(tool => {
          const isActive = activeCADTool === tool.id;
          return (
            <div key={tool.id} className={`flex items-center justify-between px-3 py-2 transition-all ${isActive ? 'bg-[#111]' : 'hover:bg-[#d5d5d5]'}`}>
              <div className="flex items-center gap-2.5 min-w-0">
                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border transition-all ${isActive ? 'border-[#444] bg-[#333]' : 'border-[#c0c0c0] bg-[#d8d8d8]'}`}>
                  {isActive
                    ? <span className="w-3.5 h-3.5 text-[#e0e0e0] [&>svg]:stroke-[#e0e0e0]"><CADToolIcon id={tool.id}/></span>
                    : <CADToolIcon id={tool.id}/>
                  }
                </div>
                <div className="min-w-0">
                  <div className={`text-[11px] font-semibold leading-tight ${isActive ? 'text-[#e0e0e0]' : 'text-[#111]'}`}>{tool.label}</div>
                  <div className={`text-[9px] leading-tight truncate ${isActive ? 'text-[#aaa]' : 'text-[#777]'}`}>{tool.desc}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { selectCADTool(tool.id); if (activeCADTool !== tool.id) runCADTool(tool.id); }}
                className={`ml-2 shrink-0 rounded-xl px-2 py-1 text-[10px] font-semibold transition-all ${isActive ? 'bg-[#e0e0e0] text-[#111]' : 'bg-[#111] text-[#e0e0e0] hover:bg-[#333]'}`}
              >
                {isActive ? 'Active' : 'Run'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );

  // ── NEW: Analytical Panel ──────────────────────────────────────────────────
  const AnalyticalPanel = () => (
  <div className="absolute right-[calc(100%+8px)] top-0 -translate-y-[5%] z-50 w-[248px] overflow-hidden rounded-2xl border border-[#d7d7d7] bg-[#e0e0e0]/96 shadow-[0_14px_36px_rgba(0,0,0,0.18)] backdrop-blur-md">
      <div className="border-b border-[#d0d0d0] bg-[#d8d8d8] px-3 py-2 flex items-center gap-2">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><circle cx="8" cy="8" r="4.5" stroke="#555" strokeWidth="1.8"/><circle cx="16" cy="16" r="4.5" stroke="#555" strokeWidth="1.8"/></svg>
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#555]">Analytical Tools</span>
      </div>
      <div className="divide-y divide-[#d0d0d0]">
        {ANALYTICAL_TOOLS.map(tool => {
          const isActive = activeAnalyticalTool === tool.id;
          return (
            <div key={tool.id} className={`transition-all ${isActive ? 'bg-[#111]' : 'hover:bg-[#d5d5d5]'}`}>
              <div className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border transition-all ${isActive ? 'border-[#444] bg-[#333]' : 'border-[#c0c0c0] bg-[#d8d8d8]'}`}>
                    {isActive
                      ? <span className="[&>svg>*]:stroke-[#e0e0e0] [&>svg>circle]:stroke-[#e0e0e0] [&>svg>path]:stroke-[#e0e0e0]"><AnalyticalToolIcon id={tool.id}/></span>
                      : <AnalyticalToolIcon id={tool.id}/>
                    }
                  </div>
                  <div className="min-w-0">
                    <div className={`text-[11px] font-semibold leading-tight ${isActive ? 'text-[#e0e0e0]' : 'text-[#111]'}`}>{tool.label}</div>
                    <div className={`text-[9px] leading-tight truncate ${isActive ? 'text-[#aaa]' : 'text-[#777]'}`}>{tool.desc}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => selectAnalyticalTool(tool.id)}
                  className={`ml-2 shrink-0 rounded-xl px-2 py-1 text-[10px] font-semibold transition-all ${isActive ? 'bg-[#e0e0e0] text-[#111]' : 'bg-[#111] text-[#e0e0e0] hover:bg-[#333]'}`}
                >
                  {isActive ? 'Close' : 'Open'}
                </button>
              </div>
              {/* Expanded config for active tool */}
              {isActive && (
                <div className="px-3 pb-2.5 pt-0.5 flex flex-col gap-2">
                  {tool.id === 'Buffer' && (
                    <div className="rounded-xl border border-[#333] bg-[#1a1a1a] p-2.5 flex flex-col gap-2">
                      <div className="text-[9px] font-bold uppercase tracking-widest text-[#888]">Buffer radius</div>
                      <div className="flex items-center gap-2">
                        <input type="range" min="10" max="5000" step="10" value={bufferRadius} onChange={e=>setBufferRadius(Number(e.target.value))} className="flex-1 h-1 accent-[#e0e0e0]"/>
                        <span className="text-[11px] font-semibold text-[#e0e0e0] min-w-[32px] text-right">{bufferRadius}</span>
                      </div>
                      <div className="flex gap-1">
                        {(['m','km'] as const).map(u => (
                          <button key={u} type="button" onClick={()=>setBufferUnit(u)} className={`flex-1 rounded-lg py-1 text-[10px] font-semibold transition-all ${bufferUnit===u?'bg-[#e0e0e0] text-[#111]':'bg-[#333] text-[#999] hover:bg-[#444]'}`}>{u}</button>
                        ))}
                      </div>
                      <button type="button" onClick={()=>runAnalyticalTool('Buffer')} className="w-full rounded-xl bg-[#e0e0e0] py-1.5 text-[11px] font-semibold text-[#111] hover:bg-white transition-all">Apply Buffer</button>
                    </div>
                  )}
                  {tool.id === 'Distance' && (
                    <div className="rounded-xl border border-[#333] bg-[#1a1a1a] p-2.5">
                      <p className="text-[10px] text-[#aaa]">Click two points on the map to measure straight-line distance.</p>
                      <button type="button" onClick={()=>runAnalyticalTool('Distance')} className="mt-2 w-full rounded-xl bg-[#e0e0e0] py-1.5 text-[11px] font-semibold text-[#111] hover:bg-white transition-all">Activate</button>
                    </div>
                  )}
                  {tool.id === 'Nearest' && (
                    <div className="rounded-xl border border-[#333] bg-[#1a1a1a] p-2.5">
                      <p className="text-[10px] text-[#aaa]">Click a point to highlight the nearest pole.</p>
                      <button type="button" onClick={()=>runAnalyticalTool('Nearest')} className="mt-2 w-full rounded-xl bg-[#e0e0e0] py-1.5 text-[11px] font-semibold text-[#111] hover:bg-white transition-all">Activate</button>
                    </div>
                  )}
                  {(tool.id === 'Overlay' || tool.id === 'Intersect' || tool.id === 'Union' || tool.id === 'Clip') && (
                    <div className="rounded-xl border border-[#333] bg-[#1a1a1a] p-2.5 flex flex-col gap-1.5">
                      <div className="text-[9px] font-bold uppercase tracking-widest text-[#888]">Layer A</div>
                      <select className="w-full rounded-lg border border-[#444] bg-[#222] px-2 py-1.5 text-[11px] text-[#e0e0e0] outline-none"><option>Poles</option><option>Cables</option><option>Substations</option></select>
                      <div className="text-[9px] font-bold uppercase tracking-widest text-[#888] mt-0.5">Layer B</div>
                      <select className="w-full rounded-lg border border-[#444] bg-[#222] px-2 py-1.5 text-[11px] text-[#e0e0e0] outline-none"><option>Service Area</option><option>Municipality Boundary</option><option>Flood Zone</option></select>
                      <button type="button" onClick={()=>runAnalyticalTool(tool.id)} className="mt-1 w-full rounded-xl bg-[#e0e0e0] py-1.5 text-[11px] font-semibold text-[#111] hover:bg-white transition-all">Run {tool.label}</button>
                    </div>
                  )}
                  {tool.id === 'Routing' && (
                    <div className="rounded-xl border border-[#333] bg-[#1a1a1a] p-2.5 flex flex-col gap-1.5">
                      <p className="text-[10px] text-[#aaa]">Click a start point, then an end point on the map to compute the optimal route.</p>
                      <button type="button" onClick={()=>runAnalyticalTool('Routing')} className="mt-1 w-full rounded-xl bg-[#e0e0e0] py-1.5 text-[11px] font-semibold text-[#111] hover:bg-white transition-all">Activate Routing</button>
                    </div>
                  )}
                  {(tool.id === 'Contour' || tool.id === 'Isochrone') && (
                    <div className="rounded-xl border border-[#333] bg-[#1a1a1a] p-2.5">
                      <p className="text-[10px] text-[#aaa]">{tool.id === 'Isochrone' ? 'Click a point on the map to generate travel-time zones.' : 'Generating contour lines from elevation data in the current view.'}</p>
                      <button type="button" onClick={()=>runAnalyticalTool(tool.id)} className="mt-2 w-full rounded-xl bg-[#e0e0e0] py-1.5 text-[11px] font-semibold text-[#111] hover:bg-white transition-all">Generate</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

const renderDetails = (small: boolean) => {
  const attrs = isEditing ? draftAttributes : attributes;
  const statusAttr = attrs.find(a => a.field === 'status');
  const statusColor = statusAttr?.value === 'Active' ? '#3a7a3a' : statusAttr?.value === 'Inactive' ? '#888' : '#555';
  return (
    <div className="flex flex-col">
      {statusAttr && (
        <div className="flex items-center justify-between border-b border-[#d0d0d0] px-3 py-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[#555]">Status</span>
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
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[#555] shrink-0 w-[100px]">{item.field.replace(/_/g,' ')}</span>
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

  const renderLayers = (small: boolean) => (
    <div className="flex flex-col gap-2 p-3">
      <div className="text-[9px] font-bold uppercase tracking-widest text-[#888] px-1 mb-0.5">Layer Visibility</div>
      {['Pole','Substation','Cabinate','Cable'].map((layer) => (
        <div key={layer} className="flex items-center justify-between rounded-2xl border border-[#d0d0d0] bg-[#d8d8d8] px-3 py-2.5 shadow-sm hover:bg-[#d3d3d3] transition-colors">
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${layerVisibility[layer]!==false?'bg-[#111]':'bg-[#aaa]'}`}/>
            <span className="text-[12px] font-semibold text-[#111]">{layer}</span>
          </div>
          <button type="button" onClick={()=>setLayerVisibility(prev=>({...prev,[layer]:!(prev[layer]!==false)}))} className={`relative h-5 w-9 shrink-0 rounded-full transition-all duration-200 border ${layerVisibility[layer]!==false?'bg-[#111] border-[#111]':'bg-[#d0d0d0] border-[#c0c0c0]'}`}>
            <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-[#e0e0e0] shadow-sm transition-all duration-200 ${layerVisibility[layer]!==false?'left-[18px]':'left-[2px]'}`}/>
          </button>
        </div>
      ))}
    </div>
  );

  // ── Dashboard / project content ───────────────────────────────────────────
  const dashboardStats = [
    { label:'Total Project', value:projects.length, accent:'#111', icon:<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="3" stroke="#555" strokeWidth="1.3"/><path d="M4 8h8M4 5h5M4 11h6" stroke="#555" strokeWidth="1.2" strokeLinecap="round"/></svg> },
    { label:'Pending',       value:assignments.filter(a=>a.status==='Pending').length, accent:'#888', icon:<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="#888" strokeWidth="1.3"/><path d="M8 5v3.5l2 2" stroke="#888" strokeWidth="1.3" strokeLinecap="round"/></svg> },
    { label:'In Progress',   value:assignments.filter(a=>a.status==='In Progress').length, accent:'#555', icon:<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 8a6 6 0 016-6v2a4 4 0 00-4 4H2z" fill="#555"/><circle cx="8" cy="8" r="6" stroke="#555" strokeWidth="1.3" strokeDasharray="3 2"/></svg> },
    { label:'Completed',     value:assignments.filter(a=>a.status==='Completed').length, accent:'#3a7a3a', icon:<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="#3a7a3a" strokeWidth="1.3"/><path d="M5 8l2 2 4-4" stroke="#3a7a3a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> },
  ];
  const projectTabs: { key: ProjectTab; label: string }[] = [{ key:'dashboard', label:'Dashboard' }, { key:'project', label:'Projects' }];

  const renderProjectContent = () => {
    if (projectTab === 'dashboard') return (
      <div className="p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          {dashboardStats.map((stat,i) => (
            <div key={i} className="rounded-2xl border border-[#d0d0d0] bg-[#e0e0e0]/50 shadow-sm p-3 backdrop-blur-sm">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] font-semibold text-[#666] uppercase tracking-wide leading-tight break-words pr-1 w-full">{stat.label}</span>
                <span className="shrink-0 opacity-70">{stat.icon}</span>
              </div>
              <div className="text-[20px] font-bold leading-none" style={{ color:stat.accent }}>{stat.value}</div>
            </div>
          ))}
        </div>
      </div>
    );
    return (
      <div className="h-full overflow-auto p-3 space-y-2">
        {showProjectForm && (
          <div className="rounded-2xl border border-[#c0c0c0] bg-[#e0e0e0] p-3 shadow-sm backdrop-blur-md">
            <div className="text-[13px] font-semibold text-[#111] mb-2">New Project</div>
            <div className="space-y-2">
              <div><label className="block text-[11px] font-bold text-[#555] mb-1">Project name</label><input value={projName} onChange={e=>setProjName(e.target.value)} placeholder="Enter project name" className="w-full rounded-xl border border-[#c0c0c0] bg-[#e8e8e8] px-3 py-2 text-[12px] text-[#111] outline-none focus:border-[#999]"/></div>
              <div><label className="block text-[11px] font-bold text-[#555] mb-1">Description</label><textarea value={projDesc} onChange={e=>setProjDesc(e.target.value)} placeholder="Brief description..." rows={2} className="w-full rounded-xl border border-[#c0c0c0] bg-[#e8e8e8] px-3 py-2 text-[12px] text-[#111] outline-none resize-none focus:border-[#999]"/></div>
              <div><label className="block text-[11px] font-bold text-[#555] mb-1">Status</label><select value={projStatus} onChange={e=>setProjStatus(e.target.value)} className="w-full rounded-xl border border-[#c0c0c0] bg-[#e8e8e8] px-3 py-2 text-[12px] text-[#111] outline-none focus:border-[#999]"><option>New</option><option>Designing</option><option>Awaiting Approval</option><option>Approved</option><option>Complete</option></select></div>
              <div><label className="block text-[11px] font-bold text-[#555] mb-1">Assign</label><select value={projAssignTo} onChange={e=>setProjAssignTo(e.target.value)} className="w-full rounded-xl border border-[#c0c0c0] bg-[#e8e8e8] px-3 py-2 text-[12px] text-[#111] outline-none focus:border-[#999]"><option value="">Select assignee</option><option>user@redplanet.com</option><option>user2</option><option>user3</option></select></div>
              <div><label className="block text-[11px] font-bold text-[#555] mb-1">Due Date</label><input type="date" value={projDueDate} onChange={e=>setProjDueDate(e.target.value)} className="w-full rounded-xl border border-[#c0c0c0] bg-[#e8e8e8] px-3 py-2 text-[12px] text-[#111] outline-none focus:border-[#999]"/></div>
              <div><label className="block text-[11px] font-bold text-[#555] mb-1">Boundary</label><div className="rounded-xl border border-dashed border-[#a0a0a0] bg-[#e0e0e0] px-3 py-2 text-[11px] text-[#666] flex items-center gap-2"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="3" stroke="#888" strokeWidth="1" strokeDasharray="3 2"/><circle cx="1" cy="1" r="1.5" fill="#888"/><circle cx="15" cy="1" r="1.5" fill="#888"/><circle cx="15" cy="15" r="1.5" fill="#888"/><circle cx="1" cy="15" r="1.5" fill="#888"/></svg>Draw a boundary using the Draw tool</div></div>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={()=>{setProjName('');setProjDesc('');setProjStatus('New');setProjAssignTo('');setProjDueDate('');setShowProjectForm(false);}} className={`${gb} rounded-xl px-3 py-2 text-[12px] font-medium`}>Clear</button>
                <button type="button" onClick={saveProject} className={`${pb} rounded-xl px-3 py-2 text-[12px] font-semibold`}>Save project</button>
              </div>
            </div>
          </div>
        )}
        {projects.length===0&&!showProjectForm && <div className="text-center text-[12px] text-[#888] py-8">No projects yet. Click + New to create one.</div>}
        {projects.map((p,i) => (
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
            <button type="button" className="w-full rounded-xl bg-[#111] hover:bg-[#333] text-[#e0e0e0] py-2 text-[12px] font-semibold transition-colors shadow-[0_4px_12px_rgba(0,0,0,0.15)]" onClick={()=>mapRef.current?.flyTo({center:DEFAULT_CENTER,zoom:DEFAULT_ZOOM,essential:true})}>GoTo Project</button>
          </div>
        ))}
      </div>
    );
  };

  const mobileSheetOpen  = isMobile && (showOC || showProject);
  const mobileSheetTitle = showProject ? 'Project' : 'Object Controller';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#d0d0d0] font-sans text-[#111]">
      <div ref={mapContainerRef} className="absolute inset-0 z-0" style={{ width: '100%', height: '100%' }}/>
      <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(rgba(0,0,0,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.02)_1px,transparent_1px)] bg-[size:40px_40px]"/>

      {/* Minimap */}
      {activePlugins['minimap'] && <div ref={minimapContainerRef} className={`absolute z-30 overflow-hidden rounded-2xl border border-[#d7d7d7] bg-[#e0e0e0]/90 shadow-[0_12px_30px_rgba(0,0,0,0.16)] backdrop-blur-sm ${isMobile?'bottom-20 left-20 h-[80px] w-[112px]':'bottom-24 left-20 h-[132px] w-[190px]'}`}/>}

      {/* Backdrops */}
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
          {showProject && (
            <div className="flex flex-col flex-1 min-h-0">
              <div className="px-3 pt-2.5 pb-2 shrink-0">
                <div className="flex rounded-2xl border border-[#c0c0c0] bg-[#d5d5d5] p-[3px] gap-[3px]">
                  {projectTabs.map(t => (<button key={t.key} type="button" onClick={()=>{setProjectTab(t.key);setShowProjectForm(false);}} className={`flex-1 rounded-xl py-2 text-center text-[13px] font-semibold transition-all duration-150 ${projectTab===t.key?'bg-[#e0e0e0] text-[#111] shadow-[0_4px_12px_rgba(0,0,0,0.1)]':'text-[#666] hover:text-[#333]'}`}>{t.label}</button>))}
                </div>
              </div>
              {projectTab==='project' && <div className="border-b border-[#d0d0d0] px-3 pb-2.5 shrink-0"><button type="button" onClick={()=>setShowProjectForm(p=>!p)} className={`${pb} w-full rounded-xl py-2 text-[13px] font-semibold shadow-[0_4px_12px_rgba(0,0,0,0.15)]`}>+ New</button></div>}
              <div className="flex-1 overflow-y-auto">{renderProjectContent()}</div>
            </div>
          )}
        </div>
      )}

      {/* ── DESKTOP Project panel ── */}
      {!isMobile&&showProject && (
        <div className="absolute inset-y-0 z-30 border-r border-[#c0c0c0] bg-[#e0e0e0]/96 shadow-[0_16px_40px_rgba(0,0,0,0.12)] backdrop-blur-md" style={{left:`${ocPW}px`,width:'250px'}}>
          <div className="flex items-center justify-between border-b border-[#d0d0d0] bg-[#d5d5d5] px-3 py-2 text-[13px] font-semibold text-[#111]">
            <span>Project</span>
            <button type="button" onClick={()=>setShowProject(false)} className={`${ib} h-7 w-7 shrink-0 rounded-xl text-xs font-bold`}>←</button>
          </div>
          <div className="px-2 pt-2 pb-1.5 shrink-0">
            <div className="flex rounded-xl border border-[#c0c0c0] bg-[#d5d5d5] p-[3px] gap-[3px]">
              {projectTabs.map(t => (<button key={t.key} type="button" onClick={()=>{setProjectTab(t.key);setShowProjectForm(false);}} className={`flex-1 rounded-lg py-1.5 text-center text-[10px] font-semibold transition-all duration-150 ${projectTab===t.key?'bg-[#e0e0e0] text-[#111] shadow-[0_4px_8px_rgba(0,0,0,0.1)]':'text-[#666] hover:text-[#333]'}`}>{t.label}</button>))}
            </div>
          </div>
          {projectTab==='project' && <div className="border-b border-[#d0d0d0] px-2 py-1.5"><button type="button" onClick={()=>setShowProjectForm(p=>!p)} className={`${pb} w-full rounded-xl py-1.5 text-[11px] font-semibold shadow-[0_4px_12px_rgba(0,0,0,0.15)]`}>+ New</button></div>}
          <div className="overflow-y-auto" style={{height:projectTab==='project'?'calc(100% - 115px)':'calc(100% - 80px)'}}>{renderProjectContent()}</div>
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
              {label:'Project',           action:()=>{setShowProject(p=>!p);if(isMobile)setShowOC(false);if(!showProject)setShowBottomPanel(false);setShowTopMenu(false);}},
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
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#111] text-[#e0e0e0] text-[14px] font-bold select-none shadow-[0_4px_12px_rgba(0,0,0,0.2)]">A</div>
                <div className="min-w-0"><div className="truncate text-[12px] font-semibold text-[#111]">Assigner</div><div className="truncate text-[10px] text-[#777]">assigner@redplanet.com</div></div>
              </div>
              <button type="button" onClick={()=>{setShowUserPopup(false);handleLogout();}} className="flex w-full items-center gap-2 px-4 py-3 text-left text-[12px] text-[#e11d48] font-semibold hover:bg-[#d5d5d5] transition-colors">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M11 11l3-3-3-3M14 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Logout
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT TOOLBAR — original tools + divider + CAD + Analytical ── */}
      <div className={`absolute top-[46px] sm:top-[52px] z-30 flex flex-col gap-2 transition-all duration-300 ${rightShift} ${showUserPopup?'top-[58px] sm:top-[64px]':'top-[46px] sm:top-[52px]'}`}>

        {/* Base Map dropdown */}
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
                        onClick={() => {
                          setSelectedBaseMap(key); setShowBaseMapDropdown(false);
                          if ((key === 'Google' || key === 'Google Satellite') && !GOOGLE_ROAD_TILES_URL) alert('Set GOOGLE_ROAD_TILES_URL / GOOGLE_SAT_TILES_URL constants to use Google tiles. Falling back to OSM.');
                        }}
                        className={`flex w-full items-center justify-between px-3 py-2 text-left text-[11px] transition-all border-t border-[#d0d0d0] ${selectedBaseMap === key ? 'bg-[#111] text-[#e0e0e0]' : 'text-[#111] hover:bg-[#d5d5d5]'}`}>
                        <span>{bm.label}</span>
                        {selectedBaseMap === key && <span className="text-xs">✓</span>}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Original tool buttons */}
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

        {/* ── Divider ── */}
        <div className="mx-auto h-px w-7 bg-[#b0b0b0] rounded-full"/>

        {/* ── CAD Tools button ── */}
        <div className="relative">
          {/* Active indicator dot */}
          {activeCADTool && (
            <div className="absolute -top-1 -right-1 z-10 h-3 w-3 rounded-full bg-[#111] border-2 border-[#e0e0e0] shadow-sm"/>
          )}
          <button
            type="button"
            title="CAD Tools"
            onClick={handleCADClick}
            className={`h-10 w-10 rounded-2xl border border-[#c0c0c0] shadow-[0_8px_22px_rgba(0,0,0,0.10)] backdrop-blur-md transition-all hover:bg-[#d5d5d5] active:scale-[0.98] ${showCADPanel ? 'bg-[#111] border-[#111]' : 'bg-[#e0e0e0]/95'}`}
          >
            <IconCAD active={showCADPanel}/>
          </button>
          {/* CAD label pill */}
          {showCADPanel && (
            <div className="absolute right-[calc(100%+8px)] top-1 z-40 whitespace-nowrap rounded-full border border-[#d0d0d0] bg-[#e0e0e0]/95 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-[#555] shadow-sm pointer-events-none">
              CAD
            </div>
          )}
          {showCADPanel && <CADPanel/>}
        </div>

        {/* ── Analytical Tools button ── */}
        <div className="relative">
          {/* Active indicator dot */}
          {activeAnalyticalTool && (
            <div className="absolute -top-1 -right-1 z-10 h-3 w-3 rounded-full bg-[#111] border-2 border-[#e0e0e0] shadow-sm"/>
          )}
          <button
            type="button"
            title="Analytical Tools"
            onClick={handleAnalyticalClick}
            className={`h-10 w-10 rounded-2xl border border-[#c0c0c0] shadow-[0_8px_22px_rgba(0,0,0,0.10)] backdrop-blur-md transition-all hover:bg-[#d5d5d5] active:scale-[0.98] ${showAnalyticalPanel ? 'bg-[#111] border-[#111]' : 'bg-[#e0e0e0]/95'}`}
          >
            <IconAnalytical active={showAnalyticalPanel}/>
          </button>
          {/* Analytical label pill */}
          {showAnalyticalPanel && (
            <div className="absolute right-[calc(100%+8px)] top-1 z-40 whitespace-nowrap rounded-full border border-[#d0d0d0] bg-[#e0e0e0]/95 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-[#555] shadow-sm pointer-events-none">
              Analysis
            </div>
          )}
          {showAnalyticalPanel && <AnalyticalPanel/>}
        </div>
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

      {/* ── Active CAD/Analytical status bar ── */}
      {(activeCADTool || activeAnalyticalTool) && (
        <div className={`absolute left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-full border border-[#c0c0c0] bg-[#e0e0e0]/96 px-4 py-2 shadow-[0_10px_28px_rgba(0,0,0,0.16)] backdrop-blur-md text-[11px] text-[#111] whitespace-nowrap ${showBottomPanel?'bottom-[calc(20vh+80px)]':'bottom-[3.5rem]'}`}>
          {activeCADTool && (
            <>
              <div className="flex items-center gap-1.5">
                <div className="flex h-5 w-5 items-center justify-center rounded-lg bg-[#111]">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M3 21L10 14M21 3L14 10M10 14L14 10" stroke="#e0e0e0" strokeWidth="2" strokeLinecap="round"/><circle cx="10" cy="14" r="2" fill="#e0e0e0"/><circle cx="14" cy="10" r="2" fill="#e0e0e0"/></svg>
                </div>
                <span className="font-semibold">CAD:</span>
                <span className="text-[#555]">{activeCADTool}</span>
              </div>
              <span className="text-[#c0c0c0]">|</span>
              <button onClick={()=>setActiveCADTool(null)} className="text-[10px] text-[#e11d48] underline font-medium">Deactivate</button>
            </>
          )}
          {activeAnalyticalTool && (
            <>
              <div className="flex items-center gap-1.5">
                <div className="flex h-5 w-5 items-center justify-center rounded-lg bg-[#111]">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><circle cx="8" cy="8" r="4" stroke="#e0e0e0" strokeWidth="1.8"/><circle cx="16" cy="16" r="4" stroke="#e0e0e0" strokeWidth="1.8"/></svg>
                </div>
                <span className="font-semibold">Analysis:</span>
                <span className="text-[#555]">{activeAnalyticalTool}</span>
              </div>
              <span className="text-[#c0c0c0]">|</span>
              <button onClick={()=>setActiveAnalyticalTool(null)} className="text-[10px] text-[#e11d48] underline font-medium">Clear</button>
            </>
          )}
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
            {(['Details','Layers'] as const).map(tab=>(
              <button key={tab} onClick={()=>setActiveTab(tab)} className={`px-5 py-1.5 transition text-[11px] ${activeTab===tab?'border-b-[2px] border-[#111] bg-[#e0e0e0] font-semibold text-[#111]':'text-[#666] border-b-[2px] border-transparent hover:bg-[#d8d8d8]'}`}>{tab}</button>
            ))}
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
            {(['Details','Layers'] as const).map(tab=>(
              <button key={tab} onClick={()=>setActiveTab(tab)} className={`px-5 py-1.5 transition text-[11px] ${activeTab===tab?'border-b-[2px] border-[#111] bg-[#e0e0e0] font-semibold text-[#111]':'text-[#666] border-b-[2px] border-transparent hover:bg-[#d8d8d8]'}`}>{tab}</button>
            ))}
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






















// // Assigner

// 'use client';

// import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
// import { useNavigate } from 'react-router-dom';
// import maplibregl from 'maplibre-gl';
// import 'maplibre-gl/dist/maplibre-gl.css';

// // ── Types ─────────────────────────────────────────────────────────────────────
// type Attribute  = { field: string; value: string };
// type Pole       = { id: string; lat: number; lon: number; attributes: Attribute[] };
// type ActiveTab  = 'Details' | 'Layers';
// type ExpandedGroups = { Segment: boolean; 'Distribution Structure': boolean; Equipment: boolean };
// type ProjectTab = 'dashboard' | 'project';
// type ActiveTool = 'Locate' | 'Select' | 'Draw' | 'Measure' | 'Clear' | 'Plugins' | null;
// type DrawGeometry = 'point' | 'line' | 'polygon';
// type BottomRow  = {
//   key: string; id: string; type: string; status: string; owner: string;
//   material: string; height: string; municipality: string; designId: string;
//   onClick?: () => void; selected?: boolean;
// };
// type Project    = { name: string; desc: string; date: string; status: string; assignTo?: string; dueDate?: string };
// type Assignment = { project: string; user: string; status: string; due: string; created: string };

// // ── Map config ────────────────────────────────────────────────────────────────
// const GOOGLE_ROAD_TILES_URL = '';
// const GOOGLE_SAT_TILES_URL  = '';

// const BASE_MAPS: Record<string, { tiles: string[]; attr: string; label: string; group: string }> = {
//   'OSM':               { label: 'OSM Standard',       group: 'Road',      attr: '© OpenStreetMap contributors',            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'] },
//   'CartoDB Light':     { label: 'CartoDB Light',       group: 'Road',      attr: '© CartoDB, © OpenStreetMap contributors', tiles: ['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'] },
//   'CartoDB Dark':      { label: 'CartoDB Dark',        group: 'Road',      attr: '© CartoDB, © OpenStreetMap contributors', tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'] },
//   'Stadia Watercolor': { label: 'Stadia Watercolor',   group: 'Thematic',  attr: '© Stadia Maps, © Stamen, © OSM',         tiles: ['https://tiles.stadiamaps.com/tiles/stamen_watercolor/{z}/{x}/{y}.jpg'] },
//   'OpenTopoMap':       { label: 'OpenTopoMap',         group: 'Thematic',  attr: '© OpenTopoMap contributors, © OSM',      tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'] },
//   'HOT':               { label: 'OSM Humanitarian',    group: 'Thematic',  attr: '© HOT, © OpenStreetMap contributors',    tiles: ['https://tile-a.openstreetmap.fr/hot/{z}/{x}/{y}.png'] },
//   'ESRI Satellite':    { label: 'ESRI Satellite',      group: 'Satellite', attr: '© Esri, © Earthstar Geographics',        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'] },
//   'ESRI Street':       { label: 'ESRI World Street',   group: 'Satellite', attr: '© Esri',                                 tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'] },
//   'Google':            { label: 'Google Road',         group: 'Google',    attr: '© Google',                               tiles: GOOGLE_ROAD_TILES_URL ? [GOOGLE_ROAD_TILES_URL] : ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'] },
//   'Google Satellite':  { label: 'Google Satellite',    group: 'Google',    attr: '© Google',                               tiles: GOOGLE_SAT_TILES_URL  ? [GOOGLE_SAT_TILES_URL]  : ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'] },
// };

// const OSM_TILES = ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'];
// const OSM_ATTR  = '© OpenStreetMap contributors';
// const DEFAULT_CENTER: [number, number] = [121.1866, 14.5943];
// const DEFAULT_ZOOM = 15;

// function makeRasterStyle(
//   tiles: string[], src: string, attr: string, night = false
// ): maplibregl.StyleSpecification {
//   return {
//     version: 8,
//     glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
//     sources: { [src]: { type: 'raster', tiles, tileSize: 256, attribution: attr, maxzoom: 22 } },
//     layers: [{
//       id: `${src}-tiles`, type: 'raster', source: src, minzoom: 0, maxzoom: 24,
//       paint: night ? { 'raster-brightness-max': 0.42, 'raster-saturation': -0.9, 'raster-contrast': 0.28 } : {},
//     }],
//   };
// }

// function getBaseMapStyle(baseMap: string, isNight: boolean): maplibregl.StyleSpecification {
//   const bm = BASE_MAPS[baseMap] ?? BASE_MAPS['OSM'];
//   return makeRasterStyle(bm.tiles, 'basemap', bm.attr, isNight);
// }

// function haversineKm(la1: number, lo1: number, la2: number, lo2: number) {
//   const R = 6371, dLa = ((la2-la1)*Math.PI)/180, dLo = ((lo2-lo1)*Math.PI)/180;
//   const a = Math.sin(dLa/2)**2 + Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dLo/2)**2;
//   return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
// }

// function buildGrid() {
//   const features: any[] = [];
//   for (let la = -80; la <= 80; la += 5) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[-180, la],[180, la]] }, properties: {} });
//   for (let lo = -180; lo <= 180; lo += 5) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[lo,-80],[lo,80]] }, properties: {} });
//   return { type: 'FeatureCollection' as const, features };
// }

// // ── Poles data ────────────────────────────────────────────────────────────────
// const POLES: Pole[] = [
//   { id: 'PL-00231', lat: 14.5943, lon: 121.1866, attributes: [{field:'asset_id',value:'PL-00231'},{field:'feature_type',value:'Pole'},{field:'status',value:'Active'},{field:'owner',value:'Utility Network'},{field:'material',value:'Concrete'},{field:'height_m',value:'10.5'},{field:'municipality',value:'Quezon City'},{field:'design_id',value:'DSN-1045'}] },
//   { id: 'PL-00232', lat: 14.5951, lon: 121.1882, attributes: [{field:'asset_id',value:'PL-00232'},{field:'feature_type',value:'Pole'},{field:'status',value:'Active'},{field:'owner',value:'City Grid'},{field:'material',value:'Steel'},{field:'height_m',value:'11.0'},{field:'municipality',value:'Quezon City'},{field:'design_id',value:'DSN-1046'}] },
//   { id: 'PL-00233', lat: 14.5928, lon: 121.1848, attributes: [{field:'asset_id',value:'PL-00233'},{field:'feature_type',value:'Pole'},{field:'status',value:'Proposed'},{field:'owner',value:'Utility Network'},{field:'material',value:'Concrete'},{field:'height_m',value:'9.8'},{field:'municipality',value:'Quezon City'},{field:'design_id',value:'DSN-1047'}] },
//   { id: 'PL-00234', lat: 14.5964, lon: 121.1854, attributes: [{field:'asset_id',value:'PL-00234'},{field:'feature_type',value:'Pole'},{field:'status',value:'Inactive'},{field:'owner',value:'North Utility'},{field:'material',value:'Wood'},{field:'height_m',value:'8.9'},{field:'municipality',value:'Quezon City'},{field:'design_id',value:'DSN-1048'}] },
//   { id: 'PL-00235', lat: 14.5936, lon: 121.1902, attributes: [{field:'asset_id',value:'PL-00235'},{field:'feature_type',value:'Pole'},{field:'status',value:'Active'},{field:'owner',value:'Metro Utility'},{field:'material',value:'Steel'},{field:'height_m',value:'12.1'},{field:'municipality',value:'Quezon City'},{field:'design_id',value:'DSN-1049'}] },
// ];

// const PLUGINS = [
//   { id: 'minimap',    label: 'Mini Map',     desc: 'Live overview minimap' },
//   { id: 'heatmap',   label: 'Heatmap',       desc: 'Density heatmap on poles' },
//   { id: 'export',    label: 'Export PNG',    desc: 'Download map as PNG' },
//   { id: 'fullscreen',label: 'Fullscreen',    desc: 'Toggle fullscreen mode' },
//   { id: 'geoloc',    label: 'Geolocate Me',  desc: 'Fly to your GPS location' },
//   { id: 'grid',      label: 'Grid Overlay',  desc: 'Lat/lon grid overlay' },
//   { id: 'nightmode', label: 'Night Mode',    desc: 'Dark desaturated map' },
//   { id: 'cluster',   label: 'Cluster Poles', desc: 'Group nearby poles' },
// ];

// // ── Icons ─────────────────────────────────────────────────────────────────────
// const ToolShell = ({ active, children }: { active?: boolean; children: React.ReactNode }) => (
//   <div className={`flex h-full w-full items-center justify-center rounded-[14px] transition-all ${active ? 'bg-[#111] text-[#e0e0e0] shadow-[0_6px_18px_rgba(0,0,0,0.22)]' : 'bg-transparent text-[#111]'}`}>
//     {children}
//   </div>
// );
// const IconLocate  = ({ active }: { active?: boolean }) => (<ToolShell active={active}><svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M12 21C12 21 18 15.4 18 10.2C18 6.78 15.31 4 12 4C8.69 4 6 6.78 6 10.2C6 15.4 12 21 12 21Z" stroke={active ? '#e0e0e0' : '#111'} strokeWidth="1.8"/><circle cx="12" cy="10" r="2.4" fill={active ? '#e0e0e0' : '#111'}/></svg></ToolShell>);
// const IconSelect  = ({ active }: { active?: boolean }) => (<ToolShell active={active}><svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M6 5H10M14 5H18M19 6V10M19 14V18M18 19H14M10 19H6M5 18V14M5 10V6" stroke={active ? '#e0e0e0' : '#111'} strokeWidth="1.8" strokeLinecap="round"/><rect x="8.2" y="8.2" width="7.6" height="7.6" rx="1.4" fill={active ? '#e0e0e0' : '#111'} opacity="0.9"/></svg></ToolShell>);
// const IconDraw    = ({ active }: { active?: boolean }) => (<ToolShell active={active}><svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M5 18L17.7 5.3C18.09 4.91 18.72 4.91 19.11 5.3L20.7 6.89C21.09 7.28 21.09 7.91 20.7 8.3L8 21H5V18Z" stroke={active ? '#e0e0e0' : '#111'} strokeWidth="1.7" strokeLinejoin="round"/><path d="M14.5 8.5L17.5 11.5" stroke={active ? '#e0e0e0' : '#111'} strokeWidth="1.7"/></svg></ToolShell>);
// const IconMeasure = ({ active }: { active?: boolean }) => (<ToolShell active={active}><svg width="17" height="17" viewBox="0 0 24 24" fill="none"><rect x="5" y="8" width="14" height="8" rx="2" stroke={active ? '#e0e0e0' : '#111'} strokeWidth="1.8"/><path d="M8 10V12M11 10V11.4M14 10V12M17 10V11.4" stroke={active ? '#e0e0e0' : '#111'} strokeWidth="1.6" strokeLinecap="round"/></svg></ToolShell>);
// const IconClear   = ({ active }: { active?: boolean }) => (<ToolShell active={active}><svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" stroke={active ? '#e0e0e0' : '#e11d48'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg></ToolShell>);
// const IconPlugins = ({ active }: { active?: boolean }) => (<ToolShell active={active}><svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M9.2 7.5C9.2 6.12 10.32 5 11.7 5C13.08 5 14.2 6.12 14.2 7.5V8.1H16.6C18.15 8.1 19.4 9.35 19.4 10.9C19.4 12.45 18.15 13.7 16.6 13.7H15.8V16.5C15.8 17.88 14.68 19 13.3 19C11.92 19 10.8 17.88 10.8 16.5V13.7H8C6.45 13.7 5.2 12.45 5.2 10.9C5.2 9.35 6.45 8.1 8 8.1H9.2V7.5Z" stroke={active ? '#e0e0e0' : '#111'} strokeWidth="1.7" strokeLinejoin="round"/></svg></ToolShell>);
// const IcPt  = ({ active }: { active: boolean }) => (<svg viewBox="0 0 24 24" width="13" height="13" fill="none"><circle cx="12" cy="12" r="6.5" stroke={active ? '#e0e0e0' : '#111'} strokeWidth="3"/><circle cx="12" cy="12" r="2" fill={active ? '#e0e0e0' : '#111'}/></svg>);
// const IcLn  = ({ active }: { active: boolean }) => (<svg viewBox="0 0 24 24" width="13" height="13" fill="none"><circle cx="5" cy="19" r="2.8" fill={active ? '#e0e0e0' : '#111'}/><circle cx="19" cy="5" r="2.8" fill={active ? '#e0e0e0' : '#111'}/><path d="M6.8 17.2L17.2 6.8" stroke={active ? '#e0e0e0' : '#111'} strokeWidth="2" strokeLinecap="round"/></svg>);
// const IcPg  = ({ active }: { active: boolean }) => (<svg viewBox="0 0 24 24" width="13" height="13" fill="none"><polygon points="12,3 21,18.5 3,18.5" fill={active ? 'rgba(255,255,255,0.18)' : 'rgba(17,17,17,0.08)'} stroke={active ? '#e0e0e0' : '#111'} strokeWidth="1.8" strokeLinejoin="round"/><circle cx="12" cy="3" r="2" fill={active ? '#e0e0e0' : '#111'}/><circle cx="21" cy="18.5" r="2" fill={active ? '#e0e0e0' : '#111'}/><circle cx="3" cy="18.5" r="2" fill={active ? '#e0e0e0' : '#111'}/></svg>);

// // ── Component ─────────────────────────────────────────────────────────────────
// export default function AssignerPanelPage() {
//   const navigate = useNavigate();
//   const handleLogout = () => { navigate('/'); };

//   // ── Map refs ──────────────────────────────────────────────────────────────
//   const mapContainerRef     = useRef<HTMLDivElement | null>(null);
//   const mapRef              = useRef<maplibregl.Map | null>(null);
//   const mapReadyRef         = useRef(false);
//   const initializedRef      = useRef(false);
//   const openPoleRef         = useRef<(p: Pole) => void>(() => {});
//   const minimapContainerRef = useRef<HTMLDivElement | null>(null);
//   const minimapRef          = useRef<maplibregl.Map | null>(null);
//   const minimapBoxMarkerRef = useRef<maplibregl.Marker | null>(null);
//   const activeToolRef       = useRef<ActiveTool>(null);
//   const drawGeomRef         = useRef<DrawGeometry>('point');
//   const drawPtsRef          = useRef<[number, number][]>([]);
//   const rulerPtsRef         = useRef<[number, number][]>([]);
//   const rulerMarkersRef     = useRef<maplibregl.Marker[]>([]);
//   const rulerPopupRef       = useRef<maplibregl.Popup | null>(null);
//   const poleClickRef        = useRef<((e: maplibregl.MapLayerMouseEvent) => void) | null>(null);
//   const poleEnterRef        = useRef<(() => void) | null>(null);
//   const poleLeaveRef        = useRef<(() => void) | null>(null);
//   const clusterClickRef     = useRef<((e: maplibregl.MapLayerMouseEvent) => void) | null>(null);
//   const unclusterClickRef   = useRef<((e: maplibregl.MapLayerMouseEvent) => void) | null>(null);

//   // ── State ─────────────────────────────────────────────────────────────────
//   const [isMobile, setIsMobile]                   = useState(false);
//   const [zoomLevel, setZoomLevel]                 = useState(DEFAULT_ZOOM);
//   const [latLon, setLatLon]                       = useState({ lat: DEFAULT_CENTER[1], lon: DEFAULT_CENTER[0] });
//   const [compassAngle, setCompassAngle]           = useState(0);
//   const [selectedBaseMap, setSelectedBaseMap]     = useState('OSM');
//   const [showBaseMapDropdown, setShowBaseMapDropdown] = useState(false);
//   const [activeTool, setActiveTool]               = useState<ActiveTool>(null);
//   const [showDrawPopup, setShowDrawPopup]         = useState(false);
//   const [drawGeometry, setDrawGeometry]           = useState<DrawGeometry>('point');
//   const [drawCount, setDrawCount]                 = useState(0);
//   const [drawFinished, setDrawFinished]           = useState(false);
//   const [measureTotal, setMeasureTotal]           = useState<number | null>(null);
//   const [activePlugins, setActivePlugins]         = useState<Record<string, boolean>>({});
//   const [searchText, setSearchText]               = useState('');
//   const [layerVisibility, setLayerVisibility]     = useState<Record<string, boolean>>({ Pole: true, Substation: true, Cabinate: true, Cable: true });
//   const [showTopMenu, setShowTopMenu]             = useState(false);
//   const [showOC, setShowOC]                       = useState(false);
//   const [showProject, setShowProject]             = useState(false);
//   const [showUserPopup, setShowUserPopup]         = useState(false);
//   const [showBottomPanel, setShowBottomPanel]     = useState(false);
//   const [activeTab, setActiveTab]                 = useState<ActiveTab>('Details');
//   const [isEditing, setIsEditing]                 = useState(false);
//   const [selectedObjectId, setSelectedObjectId]   = useState<string | null>(null);
//   const [selectedObjectItem, setSelectedObjectItem] = useState('');
//   const [attributes, setAttributes]               = useState<Attribute[]>([]);
//   const [draftAttributes, setDraftAttributes]     = useState<Attribute[]>([]);
//   const [showSaveMenu, setShowSaveMenu]           = useState(false);
//   const [expandedGroups, setExpandedGroups]       = useState<ExpandedGroups>({ Segment: false, 'Distribution Structure': false, Equipment: false });
//   const [tableFilterMode, setTableFilterMode]     = useState('By ID');
//   const [tableFilterInput, setTableFilterInput]   = useState('');
//   const [appliedTableFilter, setAppliedTableFilter] = useState('');
//   const [projectTab, setProjectTab]               = useState<ProjectTab>('dashboard');
//   const [projects, setProjects]                   = useState<Project[]>([{ name: 'Pole_test', desc: 'Condition of the pole', date: '6/4/2026', status: 'Active' }]);
//   const [assignments]                             = useState<Assignment[]>([]);
//   const [showProjectForm, setShowProjectForm]     = useState(false);
//   const [projName, setProjName]                   = useState('');
//   const [projDesc, setProjDesc]                   = useState('');
//   const [projStatus, setProjStatus]               = useState('New');
//   const [projAssignTo, setProjAssignTo]           = useState('');
//   const [projDueDate, setProjDueDate]             = useState('');

//   const ocGroups = [
//     { key: 'Segment',                items: ['Cable', 'Cable Segment', 'Fiber Optic', 'Wire'] },
//     { key: 'Distribution Structure', items: ['Pole', 'Manhole', 'Cabinate'] },
//     { key: 'Equipment',              items: ['Power Transformer', 'Service Point', 'Light', 'Meter'] },
//   ];

//   // ── Sync refs ──────────────────────────────────────────────────────────────
//   useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
//   useEffect(() => { drawGeomRef.current = drawGeometry; }, [drawGeometry]);

//   const activePluginsRef = useRef(activePlugins);
//   useEffect(() => { activePluginsRef.current = activePlugins; }, [activePlugins]);

//   const layerVisibilityRef = useRef(layerVisibility);
//   useEffect(() => { layerVisibilityRef.current = layerVisibility; }, [layerVisibility]);

//   useEffect(() => {
//     const check = () => setIsMobile(window.innerWidth < 640);
//     check(); window.addEventListener('resize', check);
//     return () => window.removeEventListener('resize', check);
//   }, []);

//   // ── openPole ──────────────────────────────────────────────────────────────
//   const openPole = useCallback((pole: Pole) => {
//     setSelectedObjectItem('Pole'); setSelectedObjectId(pole.id);
//     setAttributes(pole.attributes.map(i => ({ ...i }))); setDraftAttributes(pole.attributes.map(i => ({ ...i })));
//     setIsEditing(false); setShowSaveMenu(false);
//     if (window.innerWidth < 640) { setShowOC(false); setShowProject(false); }
//     mapRef.current?.flyTo({ center: [pole.lon, pole.lat], zoom: 18, essential: true });
//   }, []);
//   useEffect(() => { openPoleRef.current = openPole; }, [openPole]);

//   // ── Minimap ───────────────────────────────────────────────────────────────
//   const updateMinimapViewport = useCallback(() => {
//     const map = mapRef.current, mm = minimapRef.current;
//     if (!map || !mm) return;
//     const center = map.getCenter();
//     mm.jumpTo({ center, zoom: Math.max(0, map.getZoom() - 4), bearing: 0, pitch: 0 });
//     const box = document.createElement('div');
//     box.style.cssText = 'width:26px;height:18px;border:2px solid #111;border-radius:5px;background:rgba(255,255,255,0.18);box-shadow:0 1px 4px rgba(0,0,0,0.25);';
//     if (minimapBoxMarkerRef.current) minimapBoxMarkerRef.current.remove();
//     minimapBoxMarkerRef.current = new maplibregl.Marker({ element: box, anchor: 'center' }).setLngLat(center).addTo(mm);
//   }, []);

//   // ── Handler cleanup ───────────────────────────────────────────────────────
//   const removeLayerHandlers = useCallback((map: maplibregl.Map) => {
//     try { if (poleClickRef.current)      map.off('click',      'poles-hit',           poleClickRef.current);      } catch {}
//     try { if (poleEnterRef.current)      map.off('mouseenter', 'poles-hit',           poleEnterRef.current);      } catch {}
//     try { if (poleLeaveRef.current)      map.off('mouseleave', 'poles-hit',           poleLeaveRef.current);      } catch {}
//     try { if (clusterClickRef.current)   map.off('click',      'cluster-circles',     clusterClickRef.current);   } catch {}
//     try { if (unclusterClickRef.current) map.off('click',      'cluster-unclustered', unclusterClickRef.current); } catch {}
//   }, []);

//   // ── Pole layer ────────────────────────────────────────────────────────────
//   const addPoleMarkers = useCallback((map: maplibregl.Map) => {
//     const SRC = 'poles-src', LAYER = 'poles-layer', HIT = 'poles-hit';
//     removeLayerHandlers(map);
//     if (map.getLayer(HIT))   map.removeLayer(HIT);
//     if (map.getLayer(LAYER)) map.removeLayer(LAYER);
//     if (map.getSource(SRC))  map.removeSource(SRC);

//     map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: POLES.map(p => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] }, properties: { id: p.id } })) } });
//     map.addLayer({ id: LAYER, type: 'circle', source: SRC, paint: { 'circle-radius': ['interpolate',['linear'],['zoom'],10,5,18,10], 'circle-color': '#111111', 'circle-stroke-width': 2.5, 'circle-stroke-color': '#ffffff', 'circle-opacity': 1 } });
//     map.addLayer({ id: HIT, type: 'circle', source: SRC, paint: { 'circle-radius': ['interpolate',['linear'],['zoom'],10,14,18,22], 'circle-color': 'rgba(0,0,0,0)', 'circle-opacity': 0 } });

//     poleEnterRef.current = () => {
//       const tool = activeToolRef.current;
//       if (tool !== 'Draw' && tool !== 'Measure') map.getCanvas().style.cursor = 'pointer';
//     };
//     poleLeaveRef.current = () => {
//       const t = activeToolRef.current;
//       map.getCanvas().style.cursor = (t==='Draw'||t==='Measure')?'crosshair':t==='Select'?'pointer':'default';
//     };
//     poleClickRef.current = (e: maplibregl.MapLayerMouseEvent) => {
//       const tool = activeToolRef.current;
//       if (tool === 'Draw' || tool === 'Measure') return;
//       e.preventDefault();
//       const pid = e.features?.[0]?.properties?.id as string;
//       const pole = POLES.find(p => p.id === pid);
//       if (pole) openPoleRef.current(pole);
//     };

//     map.on('mouseenter', HIT, poleEnterRef.current);
//     map.on('mouseleave', HIT, poleLeaveRef.current);
//     map.on('click',      HIT, poleClickRef.current);
//   }, [removeLayerHandlers]);

//   // ── Draw data ─────────────────────────────────────────────────────────────
//   const setDrawData = useCallback((map: maplibregl.Map, pts: [number, number][], geom: DrawGeometry) => {
//     const ptF = pts.map(([x,y]) => ({ type:'Feature', geometry:{ type:'Point', coordinates:[x,y] }, properties:{} }));
//     const liF = (geom==='line'||geom==='polygon') && pts.length>=2 ? [{ type:'Feature', geometry:{ type:'LineString', coordinates:(geom==='polygon'&&pts.length>=3)?[...pts,pts[0]]:pts }, properties:{} }] : [];
//     const pgF = geom==='polygon' && pts.length>=3 ? [{ type:'Feature', geometry:{ type:'Polygon', coordinates:[[...pts,pts[0]]] }, properties:{} }] : [];
//     try {
//       (map.getSource('draw-pts-src') as maplibregl.GeoJSONSource)?.setData({ type:'FeatureCollection', features: ptF as any });
//       (map.getSource('draw-ln-src')  as maplibregl.GeoJSONSource)?.setData({ type:'FeatureCollection', features: liF as any });
//       (map.getSource('draw-pg-src')  as maplibregl.GeoJSONSource)?.setData({ type:'FeatureCollection', features: pgF as any });
//     } catch {}
//   }, []);

//   // ── Overlay sources ───────────────────────────────────────────────────────
//   const addOverlaySources = useCallback((map: maplibregl.Map) => {
//     const sa = (id: string, cb: () => void) => { if (!map.getSource(id)) cb(); };
//     sa('draw-pts-src', () => { map.addSource('draw-pts-src',{ type:'geojson', data:{ type:'FeatureCollection', features:[] } }); map.addLayer({ id:'draw-pts-layer', type:'circle', source:'draw-pts-src', paint:{ 'circle-radius':5.5, 'circle-color':'#111', 'circle-stroke-width':2, 'circle-stroke-color':'#e0e0e0' } }); });
//     sa('draw-ln-src',  () => { map.addSource('draw-ln-src', { type:'geojson', data:{ type:'FeatureCollection', features:[] } }); map.addLayer({ id:'draw-ln-layer',  type:'line',   source:'draw-ln-src',  paint:{ 'line-color':'#111', 'line-width':2.5, 'line-dasharray':[3,2] } }); });
//     sa('draw-pg-src',  () => { map.addSource('draw-pg-src', { type:'geojson', data:{ type:'FeatureCollection', features:[] } }); map.addLayer({ id:'draw-pg-layer',  type:'fill',   source:'draw-pg-src',  paint:{ 'fill-color':'#111', 'fill-opacity':0.18 } }); });
//     sa('ruler-src',    () => { map.addSource('ruler-src',   { type:'geojson', data:{ type:'FeatureCollection', features:[] } }); map.addLayer({ id:'ruler-layer',    type:'line',   source:'ruler-src',    paint:{ 'line-color':'#e11d48', 'line-width':2.5, 'line-dasharray':[4,2] } }); });
//     sa('grid-src',     () => { map.addSource('grid-src', { type:'geojson', data: buildGrid() }); map.addLayer({ id:'grid-layer', type:'line', source:'grid-src', paint:{ 'line-color':'rgba(0,0,0,0.18)', 'line-width':0.7 }, layout:{ visibility:'none' } }); });

//     sa('heatmap-src',  () => {
//       map.addSource('heatmap-src', { type:'geojson', data:{ type:'FeatureCollection', features: POLES.map(p=>({ type:'Feature' as const, geometry:{ type:'Point' as const, coordinates:[p.lon,p.lat] }, properties:{} })) } });
//       map.addLayer({ id:'heatmap-layer', type:'heatmap', source:'heatmap-src', layout: { visibility: 'none' }, paint:{ 'heatmap-weight':1, 'heatmap-intensity':2, 'heatmap-color':['interpolate',['linear'],['heatmap-density'],0,'rgba(0,0,255,0)',0.2,'rgba(0,200,255,0.6)',0.5,'rgba(0,220,80,0.8)',0.8,'rgba(255,220,0,0.9)',1,'rgba(255,40,0,1)'], 'heatmap-radius':50, 'heatmap-opacity':0 } });
//     });

//     sa('cluster-src',  () => {
//       map.addSource('cluster-src', { type:'geojson', cluster:true, clusterMaxZoom:14, clusterRadius:50, data:{ type:'FeatureCollection', features: POLES.map(p=>({ type:'Feature' as const, geometry:{ type:'Point' as const, coordinates:[p.lon,p.lat] }, properties:{ id:p.id } })) } });
//       map.addLayer({ id:'cluster-circles',     type:'circle', source:'cluster-src', filter:['has','point_count'],   paint:{ 'circle-color':'#111', 'circle-radius':18, 'circle-stroke-width':2, 'circle-stroke-color':'#e0e0e0' }, layout:{ visibility:'none' } });
//       map.addLayer({ id:'cluster-count',       type:'symbol', source:'cluster-src', filter:['has','point_count'],   layout:{ 'text-field':'{point_count_abbreviated}', 'text-size':12, visibility:'none' }, paint:{ 'text-color':'#e0e0e0' } });
//       map.addLayer({ id:'cluster-unclustered', type:'circle', source:'cluster-src', filter:['!',['has','point_count']], paint:{ 'circle-radius':['interpolate',['linear'],['zoom'],10,5,18,10], 'circle-color':'#111111', 'circle-stroke-width':2.5, 'circle-stroke-color':'#ffffff' }, layout:{ visibility:'none' } });

//       clusterClickRef.current = (e: maplibregl.MapLayerMouseEvent) => {
//         const f = e.features?.[0], src = map.getSource('cluster-src') as any, cid = f?.properties?.cluster_id;
//         if (!src || cid==null) return;
//         src.getClusterExpansionZoom(cid, (err: any, zoom: number) => { if(err) return; const c=(f?.geometry as any)?.coordinates; if(c) map.easeTo({ center:c, zoom }); });
//       };
//       unclusterClickRef.current = (e: maplibregl.MapLayerMouseEvent) => {
//         const tool = activeToolRef.current;
//         if (tool === 'Draw' || tool === 'Measure') return;
//         e.preventDefault();
//         const pid = e.features?.[0]?.properties?.id as string;
//         const pole = POLES.find(p => p.id === pid);
//         if (pole) openPoleRef.current(pole);
//       };

//       map.on('mouseenter', 'cluster-unclustered', () => {
//         const tool = activeToolRef.current;
//         if (tool !== 'Draw' && tool !== 'Measure') map.getCanvas().style.cursor = 'pointer';
//       });
//       map.on('mouseleave', 'cluster-unclustered', () => { map.getCanvas().style.cursor = ''; });

//       map.on('click', 'cluster-circles',     clusterClickRef.current);
//       map.on('click', 'cluster-unclustered', unclusterClickRef.current);
//     });
//   }, []);

//   // ── Layer visibility ──────────────────────────────────────────────────────
//   const applyLayerVisibility = useCallback((map: maplibregl.Map, ls: Record<string, boolean>, plugins: Record<string, boolean>) => {
//     const pv = ls['Pole'] !== false, co = !!plugins['cluster'];
//     const pm = pv&&!co?'visible':'none', cm = pv&&co?'visible':'none';
//     try { map.setLayoutProperty('poles-layer',         'visibility', pm); } catch {}
//     try { map.setLayoutProperty('poles-hit',           'visibility', pm); } catch {}
//     try { map.setLayoutProperty('cluster-circles',     'visibility', cm); } catch {}
//     try { map.setLayoutProperty('cluster-count',       'visibility', cm); } catch {}
//     try { map.setLayoutProperty('cluster-unclustered', 'visibility', cm); } catch {}

//     const hmVisible = pv && plugins['heatmap'];
//     try { map.setLayoutProperty('heatmap-layer', 'visibility', hmVisible ? 'visible' : 'none'); } catch {}
//     try { map.setPaintProperty('heatmap-layer',  'heatmap-opacity', hmVisible ? 0.75 : 0); } catch {}
//   }, []);

//   const applyPluginVisuals = useCallback((map: maplibregl.Map, plugins: Record<string, boolean>, layers: Record<string, boolean>) => {
//     try { map.setLayoutProperty('grid-layer','visibility', plugins['grid']?'visible':'none'); } catch {}
//     applyLayerVisibility(map, layers, plugins);
//   }, [applyLayerVisibility]);

//   // ── Map init ──────────────────────────────────────────────────────────────
//   useEffect(() => {
//     if (initializedRef.current || !mapContainerRef.current) return;
//     initializedRef.current = true;
//     const map = new maplibregl.Map({ container: mapContainerRef.current, style: getBaseMapStyle('OSM', false), center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, attributionControl: false, preserveDrawingBuffer: true });

//     map.on('load', () => { mapReadyRef.current = true; map.resize(); addOverlaySources(map); addPoleMarkers(map); applyPluginVisuals(map, activePlugins, layerVisibility); map.jumpTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }); });
//     map.on('move',   () => { const c = map.getCenter(); setLatLon({ lat: c.lat, lon: c.lng }); updateMinimapViewport(); });
//     map.on('zoom',   () => { setZoomLevel(Math.round(map.getZoom())); updateMinimapViewport(); });
//     map.on('rotate', () => setCompassAngle(map.getBearing()));

//     map.on('click', (e) => {
//       const lng = e.lngLat.lng, lat = e.lngLat.lat;
//       const tool = activeToolRef.current, geom = drawGeomRef.current;
//       if ((e as any).defaultPrevented) return;
//       if (tool === 'Draw') {
//         if (drawFinished) return;
//         const pts = geom==='point' ? [[lng,lat] as [number,number]] : [...drawPtsRef.current,[lng,lat] as [number,number]];
//         drawPtsRef.current = pts; setDrawCount(pts.length);
//         if (mapReadyRef.current) setDrawData(map, pts, geom); return;
//       }
//       if (tool === 'Measure') {
//         const pts = [...rulerPtsRef.current, [lng,lat] as [number,number]];
//         rulerPtsRef.current = pts;
//         if (mapReadyRef.current && pts.length >= 2) {
//           try { (map.getSource('ruler-src') as maplibregl.GeoJSONSource)?.setData({ type:'FeatureCollection', features:[{ type:'Feature', geometry:{ type:'LineString', coordinates:pts }, properties:{} }] }); } catch {}
//           let dist = 0; for (let i=1;i<pts.length;i++) dist += haversineKm(pts[i-1][1],pts[i-1][0],pts[i][1],pts[i][0]);
//           setMeasureTotal(dist);
//           rulerPopupRef.current?.remove();
//           rulerPopupRef.current = new maplibregl.Popup({ closeButton:false, offset:10 }).setLngLat([lng,lat]).setHTML(`<div style="font:bold 12px sans-serif;padding:6px 10px;color:#111;">${dist<1?`${(dist*1000).toFixed(0)} m`:`${dist.toFixed(3)} km`}</div>`).addTo(map);
//         }
//         const el = document.createElement('div'); el.style.cssText = 'width:10px;height:10px;border-radius:9999px;background:#e11d48;border:2px solid #e0e0e0;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.22);';
//         rulerMarkersRef.current.push(new maplibregl.Marker({ element:el }).setLngLat([lng,lat]).addTo(map)); return;
//       }
//       setShowTopMenu(false); setShowBaseMapDropdown(false); setShowUserPopup(false);
//     });

//     const onResize = () => { map.resize(); minimapRef.current?.resize(); updateMinimapViewport(); };
//     window.addEventListener('resize', onResize);
//     mapRef.current = map;
//     return () => {
//       window.removeEventListener('resize', onResize); removeLayerHandlers(map);
//       minimapRef.current?.remove(); minimapRef.current = null;
//       minimapBoxMarkerRef.current?.remove(); minimapBoxMarkerRef.current = null;
//       map.remove(); mapRef.current = null; mapReadyRef.current = false; initializedRef.current = false;
//     };
//   // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, []);

//   // ── Style switch ──────────────────────────────────────────────────────────
//   const isNightMode = !!activePlugins['nightmode'];
//   useEffect(() => {
//     const map = mapRef.current; if (!map) return;
//     const center = map.getCenter(), zoom = map.getZoom(), bearing = map.getBearing();
//     mapReadyRef.current = false;

//     map.setStyle(getBaseMapStyle(selectedBaseMap, isNightMode));

//     map.once('style.load', () => {
//       mapReadyRef.current = true;
//       addOverlaySources(map);
//       addPoleMarkers(map);
//       applyPluginVisuals(map, activePluginsRef.current, layerVisibilityRef.current);
//       setDrawData(map, drawPtsRef.current, drawGeomRef.current);
//       map.jumpTo({ center, zoom, bearing });
//       map.resize();
//       updateMinimapViewport();
//     });
//   }, [selectedBaseMap, isNightMode, addOverlaySources, addPoleMarkers, applyPluginVisuals, setDrawData, updateMinimapViewport]);

//   // ── Plugin fast visual effects ────────────────────────────────────────────
//   useEffect(() => {
//     const map = mapRef.current;
//     if (!map || !mapReadyRef.current) return;

//     applyPluginVisuals(map, activePlugins, layerVisibility);

//     if (activePlugins['export']) {
//       setActivePlugins(p => ({ ...p, export:false }));
//       map.once('idle', () => { try { const a=document.createElement('a'); a.href=map.getCanvas().toDataURL('image/png'); a.download=`gis-map-${Date.now()}.png`; document.body.appendChild(a); a.click(); document.body.removeChild(a); } catch { alert('Export failed.'); } });
//     }
//     if (activePlugins['fullscreen']) {
//       setActivePlugins(p=>({...p,fullscreen:false}));
//       if(!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(()=>{}); else document.exitFullscreen?.().catch(()=>{});
//     }
//     if (activePlugins['geoloc']) {
//       setActivePlugins(p=>({...p,geoloc:false}));
//       if (!navigator.geolocation) { alert('Geolocation not supported.'); return; }
//       navigator.geolocation.getCurrentPosition(pos => {
//         map.flyTo({ center:[pos.coords.longitude,pos.coords.latitude], zoom:16, essential:true });
//         new maplibregl.Popup({ closeButton:true, offset:12 }).setLngLat([pos.coords.longitude,pos.coords.latitude]).setHTML('<div style="padding:6px 10px;font:12px sans-serif;color:#111;">📍 You are here</div>').addTo(map);
//       }, () => alert('Location access denied.'));
//     }
//     if (activePlugins['minimap']) {
//       if (!minimapRef.current && minimapContainerRef.current) {
//         const mm = new maplibregl.Map({ container:minimapContainerRef.current, style:makeRasterStyle(OSM_TILES,'mm-base',OSM_ATTR), center:map.getCenter(), zoom:Math.max(0,map.getZoom()-4), interactive:false, attributionControl:false });
//         mm.on('load', () => { mm.resize(); updateMinimapViewport(); }); minimapRef.current = mm;
//       } else { updateMinimapViewport(); }
//     } else {
//       minimapBoxMarkerRef.current?.remove(); minimapBoxMarkerRef.current = null;
//       if (minimapRef.current) { minimapRef.current.remove(); minimapRef.current = null; }
//     }
//   }, [activePlugins, applyPluginVisuals, layerVisibility, updateMinimapViewport]);

//   useEffect(() => { const c=mapRef.current?.getCanvas(); if(!c) return; const cs:Record<string,string>={Locate:'crosshair',Select:'pointer',Draw:'crosshair',Measure:'crosshair',Clear:'default',Plugins:'default'}; c.style.cursor=activeTool?(cs[activeTool]||'default'):'default'; }, [activeTool]);
//   useEffect(() => { setTimeout(() => mapRef.current?.resize(), 320); }, [showOC, selectedObjectId, showBottomPanel, showProject, isMobile]);

//   // ── Zoom sync ─────────────────────────────────────────────────────────────
//   const zoomSyncRef = useRef(false);
//   useEffect(() => { const map=mapRef.current; if(!map) return; if(zoomSyncRef.current){zoomSyncRef.current=false;return;} if(Math.abs(map.getZoom()-zoomLevel)>0.4) map.setZoom(zoomLevel); }, [zoomLevel]);
//   useEffect(() => { const map=mapRef.current; if(!map) return; const onZoom=()=>{zoomSyncRef.current=true;setZoomLevel(Math.round(map.getZoom()));}; map.on('zoom',onZoom); return()=>{map.off('zoom',onZoom);}; }, []);

//   // ── Clear helpers ─────────────────────────────────────────────────────────
//   const clearDraw = useCallback(() => {
//     drawPtsRef.current=[]; setDrawCount(0); setDrawFinished(false);
//     try { (mapRef.current?.getSource('draw-pts-src') as maplibregl.GeoJSONSource)?.setData({type:'FeatureCollection',features:[]}); (mapRef.current?.getSource('draw-ln-src') as maplibregl.GeoJSONSource)?.setData({type:'FeatureCollection',features:[]}); (mapRef.current?.getSource('draw-pg-src') as maplibregl.GeoJSONSource)?.setData({type:'FeatureCollection',features:[]}); } catch {}
//   }, []);
//   const clearMeasure = useCallback(() => {
//     rulerPtsRef.current=[]; setMeasureTotal(null); rulerMarkersRef.current.forEach(m=>m.remove()); rulerMarkersRef.current=[]; rulerPopupRef.current?.remove(); rulerPopupRef.current=null;
//     try { (mapRef.current?.getSource('ruler-src') as maplibregl.GeoJSONSource)?.setData({type:'FeatureCollection',features:[]}); } catch {}
//   }, []);
//   const saveDraw = useCallback(() => { alert(`Saved ${drawCount} point(s) as ${drawGeomRef.current}`); clearDraw(); setActiveTool(null); setShowDrawPopup(false); }, [drawCount, clearDraw]);

//   // ── Search — now handles object-type keywords too ─────────────────────────
//   const getPoleValue = useCallback((pole: Pole, field: string) => pole.attributes.find(a=>a.field===field)?.value||'', []);

//   // All searchable object type keywords mapped to their OC item name
//   const OBJECT_TYPE_KEYWORDS: Record<string, string> = {
//     'pole': 'Pole', 'poles': 'Pole',
//     'manhole': 'Manhole', 'manholes': 'Manhole',
//     'cabinate': 'Cabinate', 'cabinet': 'Cabinate', 'cabinets': 'Cabinate',
//     'cable': 'Cable', 'cables': 'Cable',
//     'cable segment': 'Cable Segment',
//     'fiber': 'Fiber Optic', 'fiber optic': 'Fiber Optic',
//     'wire': 'Wire', 'wires': 'Wire',
//     'transformer': 'Power Transformer', 'power transformer': 'Power Transformer',
//     'service point': 'Service Point',
//     'light': 'Light', 'lights': 'Light',
//     'meter': 'Meter', 'meters': 'Meter',
//   };

//   const runSearch = useCallback(() => {
//     const q = searchText.trim().toLowerCase();
//     if (!q) return;

//     // Check if the query matches an object type keyword
//     const objectType = OBJECT_TYPE_KEYWORDS[q];
//     if (objectType) {
//       // Same behavior as clicking the item in the Object Controller
//       setSelectedObjectItem(objectType);
//       setShowBottomPanel(true);
//       setAppliedTableFilter('');
//       setTableFilterInput('');
//       setShowProject(false);
//       if (objectType === 'Pole') {
//         setSelectedObjectId(null);
//         setAttributes([]);
//         setDraftAttributes([]);
//         setIsEditing(false);
//         setShowSaveMenu(false);
//       } else {
//         // For non-pole objects, create dummy data like selectObjectItem does
//         const code = objectType.toUpperCase().slice(0, 2);
//         const oid = `${code}-001`;
//         const data: Attribute[] = [
//           { field:'asset_id', value:oid },
//           { field:'feature_type', value:objectType },
//           { field:'status', value:'Active' },
//           { field:'owner', value:'Utility Network' },
//           { field:'material', value:objectType==='Manhole'?'Concrete':'Steel' },
//           { field:'municipality', value:'Quezon City' },
//           { field:'design_id', value:`${code}-1001` },
//         ];
//         setSelectedObjectId(oid);
//         setAttributes(data);
//         setDraftAttributes(data);
//         setIsEditing(false);
//         setShowSaveMenu(false);
//       }
//       return;
//     }

//     // Fall back: search within poles by field values
//     const found = POLES.find(pole =>
//       [pole.id, getPoleValue(pole,'design_id'), getPoleValue(pole,'municipality'),
//        getPoleValue(pole,'owner'), getPoleValue(pole,'status'), getPoleValue(pole,'material')]
//         .join(' ').toLowerCase().includes(q)
//     );
//     if (!found) { alert('No matching object found.'); return; }
//     mapRef.current?.flyTo({ center:[found.lon, found.lat], zoom:18, essential:true });
//     openPole(found);
//     setSelectedObjectItem('Pole');
//     setShowBottomPanel(true);
//   }, [searchText, getPoleValue, openPole]);

//   // ── Tool handler ──────────────────────────────────────────────────────────
//   const handleToolClick = (tool: ActiveTool) => {
//     if (tool==='Locate') { mapRef.current?.flyTo({center:DEFAULT_CENTER,zoom:DEFAULT_ZOOM,essential:true}); setActiveTool(null); setShowDrawPopup(false); return; }
//     if (tool==='Draw')   { setActiveTool(prev=>prev==='Draw'?null:'Draw'); setShowDrawPopup(prev=>activeTool==='Draw'?!prev:true); return; }
//     if (tool==='Clear')  { clearDraw(); clearMeasure(); setActiveTool(null); setShowDrawPopup(false); return; }
//     if (tool==='Plugins'){ setShowDrawPopup(false); setActiveTool(prev=>prev==='Plugins'?null:'Plugins'); return; }
//     setShowDrawPopup(false);
//     setActiveTool(prev => { if(prev===tool){if(tool==='Measure')clearMeasure();return null;} if(prev==='Measure')clearMeasure(); return tool; });
//   };
//   const selectDrawType = (geom: DrawGeometry) => { setDrawGeometry(geom); drawGeomRef.current=geom; clearDraw(); setActiveTool('Draw'); setShowDrawPopup(false); setDrawFinished(false); };
//   const togglePlugin = (id: string) => { setActivePlugins((prev) => ({ ...prev, [id]: !prev[id] })); };

//   // ── Object helpers ────────────────────────────────────────────────────────
//   const getPV = (pole: Pole, f: string) => pole.attributes.find(a=>a.field===f)?.value||'-';
//   const getDisplayLabel = () => { const n=selectedObjectItem||'Object'; return selectedObjectId?`${n} (${selectedObjectId})`:n; };
//   const getSelectedPole = () => POLES.find(p=>p.id===selectedObjectId)||null;
//   const zoomToSelected = () => { const p=getSelectedPole(); if(p) mapRef.current?.flyTo({center:[p.lon,p.lat],zoom:18,essential:true}); };
//   const startEditing  = () => { setDraftAttributes(attributes.map(i=>({...i}))); setIsEditing(true); setShowSaveMenu(false); };
//   const cancelEditing = () => { setDraftAttributes(attributes.map(i=>({...i}))); setIsEditing(false); setShowSaveMenu(false); };
//   const handleDraft   = (field: string, value: string) => setDraftAttributes(prev=>prev.map(i=>i.field===field?{...i,value}:i));
//   const saveChanges   = (cont: boolean) => { setAttributes(draftAttributes.map(i=>({...i}))); setIsEditing(cont); setShowSaveMenu(false); };
//   const deleteObj     = () => { setSelectedObjectId(null); setAttributes([]); setDraftAttributes([]); setIsEditing(false); setShowSaveMenu(false); };
//   const closeEditor   = () => { setSelectedObjectId(null); setIsEditing(false); setShowSaveMenu(false); };
//   const zoomIn  = () => { const z=Math.min((mapRef.current?.getZoom()||zoomLevel)+1,20); setZoomLevel(z); mapRef.current?.setZoom(z); };
//   const zoomOut = () => { const z=Math.max((mapRef.current?.getZoom()||zoomLevel)-1,1);  setZoomLevel(z); mapRef.current?.setZoom(z); };
//   const toggleGroup = (g: string) => setExpandedGroups(prev=>({...prev,[g as keyof ExpandedGroups]:!prev[g as keyof ExpandedGroups]}));

//   const createObjectData = (name: string) => {
//     const code=name.toUpperCase().slice(0,2), oid=`${code}-001`;
//     const data: Attribute[] = [{ field:'asset_id',value:oid },{ field:'feature_type',value:name },{ field:'status',value:'Active' },{ field:'owner',value:'Utility Network' },{ field:'material',value:name==='Manhole'?'Concrete':'Steel' },{ field:'municipality',value:'Quezon City' },{ field:'design_id',value:`${code}-1001` }];
//     setSelectedObjectItem(name); setSelectedObjectId(oid); setAttributes(data); setDraftAttributes(data); setIsEditing(false); setShowSaveMenu(false);
//     if (isMobile) { setShowOC(false); setShowProject(false); }
//   };
//   const selectObjectItem = (name: string) => {
//     setSelectedObjectItem(name); setShowBottomPanel(true); setAppliedTableFilter(''); setTableFilterInput(''); setShowProject(false);
//     if (name==='Pole') { setSelectedObjectId(null); setAttributes([]); setDraftAttributes([]); setIsEditing(false); setShowSaveMenu(false); return; }
//     createObjectData(name);
//   };

//   // ── Table rows ────────────────────────────────────────────────────────────
//   const makeMH = (id: string, status: string, designId: string, extra?: Partial<BottomRow>): BottomRow => ({ key:id, id, type:'Manhole', status, owner:'Utility Network', material:'Concrete', height:'-', municipality:'Quezon City', designId, ...extra });
//   const makeCB = (id: string, status: string, designId: string, extra?: Partial<BottomRow>): BottomRow => ({ key:id, id, type:'Cabinate', status, owner:'Metro Utility', material:'Steel', height:'-', municipality:'Quezon City', designId, ...extra });
//   const bottomPanelRows: BottomRow[] = selectedObjectItem==='Pole'
//     ? POLES.map(pole=>({ key:pole.id, id:pole.id, type:getPV(pole,'feature_type'), status:getPV(pole,'status'), owner:getPV(pole,'owner'), material:getPV(pole,'material'), height:getPV(pole,'height_m'), municipality:getPV(pole,'municipality'), designId:getPV(pole,'design_id'), selected:selectedObjectId===pole.id, onClick:()=>openPole(pole) }))
//     : selectedObjectItem==='Manhole' ? [makeMH('MH-001','Active','MH-2101',{selected:selectedObjectId==='MH-001',onClick:()=>createObjectData('Manhole')}),makeMH('MH-002','Proposed','MH-2102',{})]
//     : selectedObjectItem==='Cabinate' ? [makeCB('CB-001','Active','CB-3101',{selected:selectedObjectId==='CB-001',onClick:()=>createObjectData('Cabinate')}),makeCB('CB-002','Inactive','CB-3102',{})]
//     : [];

//   const filteredRows = useMemo(() => {
//     if (!appliedTableFilter.trim()) return bottomPanelRows;
//     const q = appliedTableFilter.trim().toLowerCase();
//     return tableFilterMode==='By ID' ? bottomPanelRows.filter(r=>r.id.toLowerCase().includes(q)) : bottomPanelRows;
//   }, [bottomPanelRows, appliedTableFilter, tableFilterMode]);

//   const downloadTable = () => {
//     const headers=['ID','Type','Status','Owner','Material','Height','Municipality','Design ID'];
//     const csv=[headers,...filteredRows.map(r=>[r.id,r.type,r.status,r.owner,r.material,r.height,r.municipality,r.designId])].map(l=>l.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
//     const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'})); a.download=`${selectedObjectItem||'objects'}-table.csv`; a.click(); URL.revokeObjectURL(a.href);
//   };

//   // ── Project helpers ───────────────────────────────────────────────────────
//   const saveProject = () => {
//     if (!projName.trim()) return;
//     setProjects(prev=>[...prev,{ name:projName.trim(), desc:projDesc.trim(), date:new Date().toLocaleDateString('en-US'), status:projStatus, assignTo:projAssignTo, dueDate:projDueDate }]);
//     setProjName(''); setProjDesc(''); setProjStatus('New'); setProjAssignTo(''); setProjDueDate(''); setShowProjectForm(false);
//   };

//   // ── Layout ────────────────────────────────────────────────────────────────
//   const ocPW = !isMobile&&showOC ? 250 : 0, prPW = !isMobile&&showProject ? 250 : 0;
//   const tlLeft = ocPW+prPW+12, blLeft = ocPW+prPW+12;
//   const rightShift = !isMobile&&selectedObjectId ? 'right-[332px]' : 'right-3 sm:right-4';
//   const ctrlBot = isMobile ? (selectedObjectId?'bottom-[calc(50vh+10px)]':showBottomPanel?'bottom-[calc(30vh+8px)]':'bottom-3') : (showBottomPanel?'bottom-[calc(20vh+8px)]':'bottom-4');
//   const llBot   = isMobile ? (selectedObjectId?'bottom-[calc(50vh+14px)]':showBottomPanel?'bottom-[calc(30vh+10px)]':'bottom-3') : (showBottomPanel?'bottom-[calc(20vh+8px)]':'bottom-4');

//   const ib = 'flex items-center justify-center border border-[#c0c0c0] bg-[#e0e0e0]/96 text-[#111] shadow-[0_6px_18px_rgba(0,0,0,0.10)] backdrop-blur-md transition-all hover:bg-[#d5d5d5] active:scale-[0.98]';
//   const pb = 'border border-[#111] bg-[#111] text-[#e0e0e0] hover:bg-[#262626] transition-all';
//   const gb = 'border border-[#b0b0b0] bg-[#d0d0d0] text-[#111] hover:bg-[#c5c5c5] transition-all';

//   const tools = [
//     { label:'Locate'  as ActiveTool, Icon:IconLocate  },
//     { label:'Select'  as ActiveTool, Icon:IconSelect  },
//     { label:'Draw'    as ActiveTool, Icon:IconDraw    },
//     { label:'Measure' as ActiveTool, Icon:IconMeasure },
//     { label:'Clear'   as ActiveTool, Icon:IconClear   },
//     { label:'Plugins' as ActiveTool, Icon:IconPlugins },
//   ];

//   // ── Sub-components ────────────────────────────────────────────────────────
//   const LayersIcon = () => (<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1L15 5L8 9L1 5L8 1Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none"/><path d="M1 9L8 13L15 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>);

//   const SmallCompass = ({ size=48 }: { size?: number }) => (
//     <svg width={size} height={size} viewBox="0 0 54 54" style={{ transform:`rotate(${-compassAngle}deg)`, transition:'transform 0.3s ease', filter:'drop-shadow(0 4px 12px rgba(0,0,0,0.18))', cursor:'pointer' }} onClick={() => mapRef.current?.resetNorth({duration:500})} title="Click to reset north">
//       <circle cx="27" cy="27" r="26" fill="#f7f7f7" stroke="#d9d9d9" strokeWidth="1"/>
//       <circle cx="27" cy="27" r="22" fill="none" stroke="#e6e6e6" strokeWidth="0.6"/>
//       {Array.from({length:16},(_,i)=>{ const deg=i*22.5,rad=(deg*Math.PI)/180,isMaj=i%4===0,isMid=i%2===0&&!isMaj,r1=isMaj?18:isMid?19.5:20.5; return <line key={i} x1={27+r1*Math.sin(rad)} y1={27-r1*Math.cos(rad)} x2={27+23*Math.sin(rad)} y2={27-23*Math.cos(rad)} stroke={isMaj?'#666':'#bbb'} strokeWidth={isMaj?1:0.55}/>; })}
//       <circle cx="27" cy="27" r="16" fill="#efefef" stroke="#d9d9d9" strokeWidth="0.7"/>
//       <polygon points="27,4 29.7,27 27,21 24.3,27" fill="#e11d48"/>
//       <polygon points="27,50 29.7,27 27,33 24.3,27" fill="#b9b9b9"/>
//       <polygon points="50,27 27,24.3 33,27 27,29.7" fill="#8a8a8a"/>
//       <polygon points="4,27 27,24.3 21,27 27,29.7" fill="#8a8a8a"/>
//       <circle cx="27" cy="27" r="6" fill="#f7f7f7" stroke="#d9d9d9" strokeWidth="0.7"/>
//       <circle cx="27" cy="27" r="2.8" fill="#222"/><circle cx="27" cy="27" r="1.2" fill="#f7f7f7"/>
//       <text x="27" y="14.5"   textAnchor="middle" fontSize="5.5" fontWeight="700" fill="#111" fontFamily="sans-serif">N</text>
//       <text x="27" y="44.5"  textAnchor="middle" fontSize="5"  fontWeight="500" fill="#999" fontFamily="sans-serif">S</text>
//       <text x="43.5" y="28.8" textAnchor="middle" fontSize="5"  fontWeight="500" fill="#999" fontFamily="sans-serif">E</text>
//       <text x="10.5" y="28.8" textAnchor="middle" fontSize="5"  fontWeight="500" fill="#999" fontFamily="sans-serif">W</text>
//     </svg>
//   );

//   // FIX 2: Draw popup — compact/small, anchored to left of the Draw button
//   const DrawPopup = () => (
//     <div className="absolute right-[calc(100%+8px)] top-0 z-50 flex flex-col items-end gap-1">
//       <div className="rounded-full border border-[#d0d0d0] bg-[#e0e0e0]/95 px-2.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-[#666] shadow-sm whitespace-nowrap mb-0.5">
//         Draw
//       </div>
//       {([{key:'point' as DrawGeometry,label:'Point',Ic:IcPt},{key:'line' as DrawGeometry,label:'Line',Ic:IcLn},{key:'polygon' as DrawGeometry,label:'Polygon',Ic:IcPg}]).map(({key,label,Ic}) => {
//         const active = drawGeometry===key;
//         return (
//           <button key={key} type="button" onClick={()=>selectDrawType(key)}
//             className={['flex h-7 items-center gap-1.5 rounded-full border px-2.5 shadow-sm transition-all duration-200 active:scale-[0.95] whitespace-nowrap',
//               active?'border-[#111] bg-[#111] text-white':'border-[#d0d0d0] bg-[#e0e0e0] text-[#111] hover:bg-[#d5d5d5]'].join(' ')}>
//             <span className={`flex h-4 w-4 items-center justify-center rounded-full ${active?'bg-white/20':'bg-black/10'}`}>
//               <Ic active={active}/>
//             </span>
//             <span className="text-[10px] font-semibold">{label}</span>
//           </button>
//         );
//       })}
//     </div>
//   );

//   const PluginsPanel = () => (
//     // FIX 1: Positioned to the LEFT of the toolbar so it doesn't overlap tools
//     <div className="absolute right-[calc(100%+8px)] top-0 z-50 w-[220px] overflow-hidden rounded-2xl border border-[#d7d7d7] bg-[#e0e0e0]/96 shadow-[0_14px_36px_rgba(0,0,0,0.18)] backdrop-blur-md">
//       <div className="border-b border-[#e8e8e8] bg-[#e0e0e0] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#666]">Map Plugins</div>
//       {PLUGINS.map((p,i) => (
//         <div key={p.id} className={`flex items-center justify-between px-3 py-2 ${i>0?'border-t border-[#d0d0d0]':''} hover:bg-[#d5d5d5] transition-all`}>
//           <div className="flex flex-col gap-0.5"><span className="text-[11px] font-semibold text-[#111] leading-tight">{p.label}</span><span className="text-[9px] text-[#777] leading-tight">{p.desc}</span></div>
//           <button type="button" onClick={()=>togglePlugin(p.id)} className={`relative ml-2 h-5 w-9 shrink-0 rounded-full transition-all duration-200 border ${activePlugins[p.id]?'bg-[#111] border-[#111]':'bg-[#d8d8d8] border-[#cfcfcf]'}`}>
//             <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-[#e0e0e0] shadow-sm transition-all duration-200 ${activePlugins[p.id]?'left-[18px]':'left-[2px]'}`}/>
//           </button>
//         </div>
//       ))}
//     </div>
//   );

//   // FIX 3: Object Editor renderers — gray bg like left panel, tight row spacing
// const renderDetails = (small: boolean) => {
//   const attrs = isEditing ? draftAttributes : attributes;
//   const statusAttr = attrs.find(a => a.field === 'status');
//   const statusColor = statusAttr?.value === 'Active' ? '#3a7a3a' : statusAttr?.value === 'Inactive' ? '#888' : '#555';
//   return (
//     <div className="flex flex-col">
//       {statusAttr && (
//         <div className="flex items-center justify-between border-b border-[#d0d0d0] px-3 py-1.5">
//           <span className="text-[10px] font-semibold uppercase tracking-widest text-[#555]">Status</span>
//           <div className="flex items-center gap-2">
//             {isEditing ? (
//               <select value={statusAttr.value} onChange={e=>handleDraft('status',e.target.value)} className="rounded border border-[#c0c0c0] bg-[#e8e8e8] px-2 py-0.5 text-[12px] font-bold outline-none focus:border-[#999] transition-colors" style={{color:statusColor}}>
//                 <option>Active</option><option>Proposed</option><option>Inactive</option>
//               </select>
//             ) : (
//               <span className="text-[12px] font-bold" style={{color:statusColor}}>{statusAttr.value}</span>
//             )}
//             <div className="h-2 w-2 rounded-full shrink-0" style={{background:statusColor}}/>
//           </div>
//         </div>
//       )}
//       {attrs.filter(a => a.field !== 'status').map((item, idx, arr) => (
//         <div key={item.field} className={`flex items-center justify-between px-3 py-1.5 ${idx < arr.length - 1 ? 'border-b border-[#d0d0d0]' : ''}`}>
//           <span className="text-[10px] font-semibold uppercase tracking-widest text-[#555] shrink-0 w-[100px]">{item.field.replace(/_/g,' ')}</span>
//           {isEditing ? (
//             <input value={item.value} onChange={e=>handleDraft(item.field,e.target.value)} className="ml-2 flex-1 rounded border border-[#c0c0c0] bg-[#ebebeb] px-2 py-0.5 text-right text-[12px] font-semibold text-[#111] outline-none focus:border-[#999] transition-colors"/>
//           ) : (
//             <span className="ml-2 text-right text-[12px] font-semibold text-[#111] truncate">{item.value}</span>
//           )}
//         </div>
//       ))}
//     </div>
//   );
// };

//     const renderLayers = (small: boolean) => (
//     <div className="flex flex-col gap-2 p-3">
//         <div className="text-[9px] font-bold uppercase tracking-widest text-[#888] px-1 mb-0.5">Layer Visibility</div>
//         {['Pole','Substation','Cabinate','Cable'].map((layer) => (
//         <div key={layer} className="flex items-center justify-between rounded-2xl border border-[#d0d0d0] bg-[#d8d8d8] px-3 py-2.5 shadow-sm hover:bg-[#d3d3d3] transition-colors">
//             <div className="flex items-center gap-2">
//             <div className={`h-2 w-2 rounded-full ${layerVisibility[layer]!==false?'bg-[#111]':'bg-[#aaa]'}`}/>
//             <span className="text-[12px] font-semibold text-[#111]">{layer}</span>
//             </div>
//             <button
//             type="button"
//             onClick={()=>setLayerVisibility(prev=>({...prev,[layer]:!(prev[layer]!==false)}))}
//             className={`relative h-5 w-9 shrink-0 rounded-full transition-all duration-200 border ${layerVisibility[layer]!==false?'bg-[#111] border-[#111]':'bg-[#d0d0d0] border-[#c0c0c0]'}`}>
//             <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-[#e0e0e0] shadow-sm transition-all duration-200 ${layerVisibility[layer]!==false?'left-[18px]':'left-[2px]'}`}/>
//             </button>
//         </div>
//         ))}
//     </div>
//     );

//   // ── Dashboard / project content ───────────────────────────────────────────
//   const dashboardStats = [
//     { label:'Total Project', value:projects.length, accent:'#111', icon:<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="3" stroke="#555" strokeWidth="1.3"/><path d="M4 8h8M4 5h5M4 11h6" stroke="#555" strokeWidth="1.2" strokeLinecap="round"/></svg> },
//     { label:'Pending',       value:assignments.filter(a=>a.status==='Pending').length, accent:'#888', icon:<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="#888" strokeWidth="1.3"/><path d="M8 5v3.5l2 2" stroke="#888" strokeWidth="1.3" strokeLinecap="round"/></svg> },
//     { label:'In Progress',   value:assignments.filter(a=>a.status==='In Progress').length, accent:'#555', icon:<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 8a6 6 0 016-6v2a4 4 0 00-4 4H2z" fill="#555"/><circle cx="8" cy="8" r="6" stroke="#555" strokeWidth="1.3" strokeDasharray="3 2"/></svg> },
//     { label:'Completed',     value:assignments.filter(a=>a.status==='Completed').length, accent:'#3a7a3a', icon:<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="#3a7a3a" strokeWidth="1.3"/><path d="M5 8l2 2 4-4" stroke="#3a7a3a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> },
//   ];
//   const projectTabs: { key: ProjectTab; label: string }[] = [{ key:'dashboard', label:'Dashboard' }, { key:'project', label:'Projects' }];

//   const renderProjectContent = () => {
//     if (projectTab === 'dashboard') return (
//       <div className="p-3 space-y-2">
//         <div className="grid grid-cols-2 gap-2">
//           {dashboardStats.map((stat,i) => (
//             <div key={i} className="rounded-2xl border border-[#d0d0d0] bg-[#e0e0e0]/50 shadow-sm p-3 backdrop-blur-sm">
//               <div className="flex items-center justify-between mb-1">
//                 <span className="text-[9px] font-semibold text-[#666] uppercase tracking-wide leading-tight break-words pr-1 w-full">{stat.label}</span>
//                 <span className="shrink-0 opacity-70">{stat.icon}</span>
//               </div>
//               <div className="text-[20px] font-bold leading-none" style={{ color:stat.accent }}>{stat.value}</div>
//             </div>
//           ))}
//         </div>
//       </div>
//     );
//     return (
//       <div className="h-full overflow-auto p-3 space-y-2">
//         {showProjectForm && (
//           <div className="rounded-2xl border border-[#c0c0c0] bg-[#e0e0e0] p-3 shadow-sm backdrop-blur-md">
//             <div className="text-[13px] font-semibold text-[#111] mb-2">New Project</div>
//             <div className="space-y-2">
//               <div><label className="block text-[11px] font-bold text-[#555] mb-1">Project name</label><input value={projName} onChange={e=>setProjName(e.target.value)} placeholder="Enter project name" className="w-full rounded-xl border border-[#c0c0c0] bg-[#e8e8e8] px-3 py-2 text-[12px] text-[#111] outline-none focus:border-[#999]"/></div>
//               <div><label className="block text-[11px] font-bold text-[#555] mb-1">Description</label><textarea value={projDesc} onChange={e=>setProjDesc(e.target.value)} placeholder="Brief description..." rows={2} className="w-full rounded-xl border border-[#c0c0c0] bg-[#e8e8e8] px-3 py-2 text-[12px] text-[#111] outline-none resize-none focus:border-[#999]"/></div>
//               <div><label className="block text-[11px] font-bold text-[#555] mb-1">Status</label><select value={projStatus} onChange={e=>setProjStatus(e.target.value)} className="w-full rounded-xl border border-[#c0c0c0] bg-[#e8e8e8] px-3 py-2 text-[12px] text-[#111] outline-none focus:border-[#999]"><option>New</option><option>Designing</option><option>Awaiting Approval</option><option>Approved</option><option>Complete</option></select></div>
//               <div><label className="block text-[11px] font-bold text-[#555] mb-1">Assign</label><select value={projAssignTo} onChange={e=>setProjAssignTo(e.target.value)} className="w-full rounded-xl border border-[#c0c0c0] bg-[#e8e8e8] px-3 py-2 text-[12px] text-[#111] outline-none focus:border-[#999]"><option value="">Select assignee</option><option>user@redplanet.com</option><option>user2</option><option>user3</option></select></div>
//               <div><label className="block text-[11px] font-bold text-[#555] mb-1">Due Date</label><input type="date" value={projDueDate} onChange={e=>setProjDueDate(e.target.value)} className="w-full rounded-xl border border-[#c0c0c0] bg-[#e8e8e8] px-3 py-2 text-[12px] text-[#111] outline-none focus:border-[#999]"/></div>
//               <div><label className="block text-[11px] font-bold text-[#555] mb-1">Boundary</label><div className="rounded-xl border border-dashed border-[#a0a0a0] bg-[#e0e0e0] px-3 py-2 text-[11px] text-[#666] flex items-center gap-2"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="3" stroke="#888" strokeWidth="1" strokeDasharray="3 2"/><circle cx="1" cy="1" r="1.5" fill="#888"/><circle cx="15" cy="1" r="1.5" fill="#888"/><circle cx="15" cy="15" r="1.5" fill="#888"/><circle cx="1" cy="15" r="1.5" fill="#888"/></svg>Draw a boundary using the Draw tool</div></div>
//               <div className="flex justify-end gap-2 pt-1">
//                 <button type="button" onClick={()=>{setProjName('');setProjDesc('');setProjStatus('New');setProjAssignTo('');setProjDueDate('');setShowProjectForm(false);}} className={`${gb} rounded-xl px-3 py-2 text-[12px] font-medium`}>Clear</button>
//                 <button type="button" onClick={saveProject} className={`${pb} rounded-xl px-3 py-2 text-[12px] font-semibold`}>Save project</button>
//               </div>
//             </div>
//           </div>
//         )}
//         {projects.length===0&&!showProjectForm && <div className="text-center text-[12px] text-[#888] py-8">No projects yet. Click + New to create one.</div>}
//         {projects.map((p,i) => (
//           <div key={i} className="rounded-2xl border border-[#d0d0d0] bg-[#e0e0e0]/70 p-3 shadow-[0_4px_12px_rgba(0,0,0,0.05)] backdrop-blur-sm">
//             <div className="flex items-start justify-between gap-2 mb-2">
//               <div className="min-w-0"><div className="text-[13px] font-semibold text-[#111] truncate">{p.name}</div><div className="text-[11px] text-[#666] truncate mt-0.5">{p.desc||'No description'}</div></div>
//               <span className="shrink-0 rounded-full bg-[#111] px-2 py-0.5 text-[10px] font-semibold text-white">{p.status}</span>
//             </div>
//             <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2">
//               <span className="text-[11px] text-[#888]">Created: {p.date}</span>
//               {p.dueDate&&<span className="text-[11px] text-[#888]">Due: {p.dueDate}</span>}
//               <span className="text-[11px] font-medium text-green-700">Boundary defined</span>
//             </div>
//             <button type="button" className="w-full rounded-xl bg-[#111] hover:bg-[#333] text-[#e0e0e0] py-2 text-[12px] font-semibold transition-colors shadow-[0_4px_12px_rgba(0,0,0,0.15)]" onClick={()=>mapRef.current?.flyTo({center:DEFAULT_CENTER,zoom:DEFAULT_ZOOM,essential:true})}>GoTo Project</button>
//           </div>
//         ))}
//       </div>
//     );
//   };

//   const mobileSheetOpen  = isMobile && (showOC || showProject);
//   const mobileSheetTitle = showProject ? 'Project' : 'Object Controller';

//   // ── Render ────────────────────────────────────────────────────────────────
//   return (
//     <div className="relative h-screen w-full overflow-hidden bg-[#d0d0d0] font-sans text-[#111]">
//       <div ref={mapContainerRef} className="absolute inset-0 z-0" style={{ width: '100%', height: '100%' }}/>
//       <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(rgba(0,0,0,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.02)_1px,transparent_1px)] bg-[size:40px_40px]"/>

//       {/* Minimap */}
//       {activePlugins['minimap'] && <div ref={minimapContainerRef} className={`absolute z-30 overflow-hidden rounded-2xl border border-[#d7d7d7] bg-[#e0e0e0]/90 shadow-[0_12px_30px_rgba(0,0,0,0.16)] backdrop-blur-sm ${isMobile?'bottom-20 left-20 h-[80px] w-[112px]':'bottom-24 left-20 h-[132px] w-[190px]'}`}/>}

//       {/* Backdrops */}
//       {mobileSheetOpen && <div className="absolute inset-0 z-[28] bg-black/20" onClick={()=>{setShowOC(false);setShowProject(false);}}/>}

//       {/* ── DESKTOP OC ── */}
//       {!isMobile && (
//         <div className={`absolute inset-y-0 left-0 z-30 border-r border-[#c0c0c0] bg-[#e0e0e0]/96 shadow-[0_16px_40px_rgba(0,0,0,0.12)] backdrop-blur-md transition-transform duration-300 ease-in-out ${showOC?'translate-x-0':'-translate-x-full'}`} style={{width:'250px'}}>
//           <div className="flex items-center justify-between border-b border-[#d0d0d0] bg-[#d5d5d5] px-3 py-2 text-[13px] font-semibold text-[#111]">
//             <span>Object Controller</span>
//             <button type="button" onClick={()=>setShowOC(false)} className={`${ib} h-7 w-7 shrink-0 rounded-xl text-xs font-bold`}>←</button>
//           </div>
//           <div className="h-[calc(100%-41px)] overflow-y-auto px-2 py-2">
//             {ocGroups.map((group,gi) => (
//               <div key={group.key} className={gi>0?'mt-1 space-y-0.5':'space-y-0.5'}>
//                 <button type="button" onClick={()=>toggleGroup(group.key as any)} className="flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left font-medium text-[#111] transition-all hover:bg-[#d5d5d5]">
//                   <span className="text-[13px] leading-tight">{group.key}</span>
//                   <span className="shrink-0 text-[10px]">{expandedGroups[group.key as keyof ExpandedGroups]?'▾':'▸'}</span>
//                 </button>
//                 {expandedGroups[group.key as keyof ExpandedGroups] && (
//                   <div className="ml-3 space-y-0.5 border-l border-[#c0c0c0] pl-2.5">
//                     {group.items.map(item => (<button key={item} type="button" onClick={()=>selectObjectItem(item)} className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-all ${selectedObjectItem===item?'bg-[#111] text-[#e0e0e0]':'text-[#555] hover:bg-[#d5d5d5] hover:text-[#111]'}`}>{item}</button>))}
//                   </div>
//                 )}
//               </div>
//             ))}
//           </div>
//         </div>
//       )}

//       {/* ── MOBILE drawer ── */}
//       {isMobile && (
//         <div className={`absolute left-0 top-0 bottom-0 z-[39] flex flex-col border-r border-[#c0c0c0] bg-[#e0e0e0]/96 shadow-[0_16px_40px_rgba(0,0,0,0.12)] backdrop-blur-md transition-transform duration-300 ease-in-out ${mobileSheetOpen?'translate-x-0':'-translate-x-full'}`} style={{width:'75vw',maxWidth:'280px'}}>
//           <div className="flex items-center justify-between border-b border-[#d0d0d0] bg-[#d5d5d5] px-3 py-2.5 shrink-0">
//             <span className="text-[13px] font-semibold text-[#111]">{mobileSheetTitle}</span>
//             <button type="button" onClick={()=>{setShowOC(false);setShowProject(false);}} className={`${ib} h-8 w-8 rounded-xl text-xs font-bold`}>←</button>
//           </div>
//           {showOC&&!showProject && (
//             <div className="flex-1 overflow-y-auto px-2 py-2">
//               {ocGroups.map((group,gi) => (
//                 <div key={group.key} className={gi>0?'mt-1 space-y-0.5':'space-y-0.5'}>
//                   <button type="button" onClick={()=>toggleGroup(group.key as any)} className="flex w-full items-center justify-between rounded-xl px-2 py-1.5 text-left font-medium text-[#111] bg-[#e0e0e0] hover:bg-[#d5d5d5] transition-all">
//                     <span className="text-[11px] leading-tight truncate pr-1">{group.key}</span>
//                     <span className="shrink-0 text-[10px]">{expandedGroups[group.key as keyof ExpandedGroups]?'▾':'▸'}</span>
//                   </button>
//                   {expandedGroups[group.key as keyof ExpandedGroups] && (
//                     <div className="ml-2 space-y-0.5 border-l border-[#c0c0c0] pl-2">
//                       {group.items.map(item => (<button key={item} type="button" onClick={()=>{selectObjectItem(item);setShowOC(false);setShowProject(false);}} className={`block w-full rounded-lg px-2 py-1.5 text-left text-[11px] transition-all ${selectedObjectItem===item?'bg-[#111] text-[#e0e0e0]':'bg-[#e0e0e0] text-[#555] hover:bg-[#d5d5d5] hover:text-[#111]'}`}>{item}</button>))}
//                     </div>
//                   )}
//                 </div>
//               ))}
//             </div>
//           )}
//           {showProject && (
//             <div className="flex flex-col flex-1 min-h-0">
//               <div className="px-3 pt-2.5 pb-2 shrink-0">
//                 <div className="flex rounded-2xl border border-[#c0c0c0] bg-[#d5d5d5] p-[3px] gap-[3px]">
//                   {projectTabs.map(t => (<button key={t.key} type="button" onClick={()=>{setProjectTab(t.key);setShowProjectForm(false);}} className={`flex-1 rounded-xl py-2 text-center text-[13px] font-semibold transition-all duration-150 ${projectTab===t.key?'bg-[#e0e0e0] text-[#111] shadow-[0_4px_12px_rgba(0,0,0,0.1)]':'text-[#666] hover:text-[#333]'}`}>{t.label}</button>))}
//                 </div>
//               </div>
//               {projectTab==='project' && <div className="border-b border-[#d0d0d0] px-3 pb-2.5 shrink-0"><button type="button" onClick={()=>setShowProjectForm(p=>!p)} className={`${pb} w-full rounded-xl py-2 text-[13px] font-semibold shadow-[0_4px_12px_rgba(0,0,0,0.15)]`}>+ New</button></div>}
//               <div className="flex-1 overflow-y-auto">{renderProjectContent()}</div>
//             </div>
//           )}
//         </div>
//       )}

//       {/* ── DESKTOP Project panel ── */}
//       {!isMobile&&showProject && (
//         <div className="absolute inset-y-0 z-30 border-r border-[#c0c0c0] bg-[#e0e0e0]/96 shadow-[0_16px_40px_rgba(0,0,0,0.12)] backdrop-blur-md" style={{left:`${ocPW}px`,width:'250px'}}>
//           <div className="flex items-center justify-between border-b border-[#d0d0d0] bg-[#d5d5d5] px-3 py-2 text-[13px] font-semibold text-[#111]">
//             <span>Project</span>
//             <button type="button" onClick={()=>setShowProject(false)} className={`${ib} h-7 w-7 shrink-0 rounded-xl text-xs font-bold`}>←</button>
//           </div>
//           <div className="px-2 pt-2 pb-1.5 shrink-0">
//             <div className="flex rounded-xl border border-[#c0c0c0] bg-[#d5d5d5] p-[3px] gap-[3px]">
//               {projectTabs.map(t => (<button key={t.key} type="button" onClick={()=>{setProjectTab(t.key);setShowProjectForm(false);}} className={`flex-1 rounded-lg py-1.5 text-center text-[10px] font-semibold transition-all duration-150 ${projectTab===t.key?'bg-[#e0e0e0] text-[#111] shadow-[0_4px_8px_rgba(0,0,0,0.1)]':'text-[#666] hover:text-[#333]'}`}>{t.label}</button>))}
//             </div>
//           </div>
//           {projectTab==='project' && <div className="border-b border-[#d0d0d0] px-2 py-1.5"><button type="button" onClick={()=>setShowProjectForm(p=>!p)} className={`${pb} w-full rounded-xl py-1.5 text-[11px] font-semibold shadow-[0_4px_12px_rgba(0,0,0,0.15)]`}>+ New</button></div>}
//           <div className="overflow-y-auto" style={{height:projectTab==='project'?'calc(100% - 115px)':'calc(100% - 80px)'}}>{renderProjectContent()}</div>
//         </div>
//       )}

//       {/* ── TOP LEFT ── */}
//       <div className="absolute top-2 z-30 flex items-center gap-1.5 transition-all duration-300" style={{left:`${tlLeft}px`}}>
//         <button type="button" onClick={()=>{setShowTopMenu(p=>!p);setShowBaseMapDropdown(false);setShowDrawPopup(false);}} className={`${ib} h-9 w-9 rounded-2xl`}>
//           <div className="flex flex-col gap-[3px]"><span className="block h-[2px] w-[14px] rounded bg-current"/><span className="block h-[2px] w-[14px] rounded bg-current"/><span className="block h-[2px] w-[14px] rounded bg-current"/></div>
//         </button>
//         <div className="flex h-9 w-[190px] sm:w-[280px] items-center rounded-2xl border border-[#c0c0c0] bg-[#e0e0e0]/95 px-3 shadow-[0_8px_22px_rgba(0,0,0,0.10)] backdrop-blur-md">
//           <input value={searchText} onChange={e=>setSearchText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')runSearch();}} className="w-full bg-transparent text-[11px] sm:text-[12px] text-[#111] outline-none placeholder:text-[#8a8a8a]" placeholder="Search pole, cable, manhole..."/>
//           <button type="button" onClick={runSearch} className="ml-2 flex h-7 w-7 items-center justify-center rounded-xl border border-[#d0d0d0] bg-[#d5d5d5] text-[#111] hover:bg-[#e0e0e0]" title="Search">⌕</button>
//         </div>
//         {showTopMenu && (
//           <div className={`absolute left-0 z-50 overflow-hidden rounded-2xl border border-[#d7d7d7] bg-[#e0e0e0]/96 shadow-[0_14px_36px_rgba(0,0,0,0.18)] ${isMobile?'top-11 min-w-[132px]':'top-11 min-w-[176px]'}`}>
//             {[
//               {label:'Home',              action:()=>{mapRef.current?.flyTo({center:DEFAULT_CENTER,zoom:DEFAULT_ZOOM,essential:true});setShowTopMenu(false);}},
//               {label:'Bookmark',          action:()=>setShowTopMenu(false)},
//               {label:'Object Controller', action:()=>{setShowOC(p=>!p);if(isMobile)setShowProject(false);setShowTopMenu(false);}},
//               {label:'Project',           action:()=>{setShowProject(p=>!p);if(isMobile)setShowOC(false);if(!showProject)setShowBottomPanel(false);setShowTopMenu(false);}},
//             ].map((item,i) => (<button key={item.label} type="button" onClick={item.action} className={`flex w-full items-center text-left text-[#111] hover:bg-[#d5d5d5] ${isMobile?'px-3 py-2 text-[11px]':'px-4 py-2.5 text-[13px]'} ${i>0?'border-t border-[#d0d0d0]':''}`}>{item.label}</button>))}
//           </div>
//         )}
//       </div>

//       {/* ── TOP RIGHT ── */}
//       <div className={`absolute top-2 z-[60] flex items-center gap-1.5 sm:gap-2 transition-all duration-300 ${rightShift}`}>
//         <a href="https://redplanetgrp.com" target="_blank" rel="noreferrer" className="block">
//           <img src="https://redplanetgrp.com/wp-content/uploads/2025/04/Redplanet-Solutions.webp" alt="RedPlanet" className="h-7 sm:h-9 w-auto object-contain"/>
//         </a>
//         <div className="relative">
//           <button type="button" onClick={()=>{setShowUserPopup(p=>!p);setShowBaseMapDropdown(false);setShowTopMenu(false);}} className={`${ib} h-9 w-9 rounded-2xl`}><span className="text-sm">👤</span></button>
//           {showUserPopup && (
//             <div className="absolute right-0 top-[calc(100%+8px)] z-[70] w-[210px] overflow-hidden rounded-2xl border border-[#d7d7d7] bg-[#e0e0e0]/96 shadow-[0_14px_36px_rgba(0,0,0,0.18)] backdrop-blur-md">
//               <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[#d0d0d0]">
//                 <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#111] text-[#e0e0e0] text-[14px] font-bold select-none shadow-[0_4px_12px_rgba(0,0,0,0.2)]">A</div>
//                 <div className="min-w-0"><div className="truncate text-[12px] font-semibold text-[#111]">Assigner</div><div className="truncate text-[10px] text-[#777]">assigner@redplanet.com</div></div>
//               </div>
//               <button type="button" onClick={()=>{setShowUserPopup(false);handleLogout();}} className="flex w-full items-center gap-2 px-4 py-3 text-left text-[12px] text-[#e11d48] font-semibold hover:bg-[#d5d5d5] transition-colors">
//                 <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M11 11l3-3-3-3M14 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
//                 Logout
//               </button>
//             </div>
//           )}
//         </div>
//       </div>

//       {/* ── RIGHT toolbar ── */}
//       <div className={`absolute top-[46px] sm:top-[52px] z-30 flex flex-col gap-2 transition-all duration-300 ${rightShift} ${showUserPopup?'top-[58px] sm:top-[64px]':'top-[46px] sm:top-[52px]'}`}>
//         {/* FIX 1: Base Map dropdown opens to the LEFT — positioned right-[calc(100%+8px)] */}
//         <div className="relative">
//           <button type="button" title="Base Map" onClick={()=>{setShowBaseMapDropdown(p=>!p);setShowTopMenu(false);setShowDrawPopup(false);setActiveTool(p=>p==='Plugins'?null:p);}} className={`${ib} h-10 w-10 rounded-2xl`}><LayersIcon/></button>
//           {showBaseMapDropdown && (
//             <div className="absolute right-[calc(100%+8px)] top-0 z-50 w-[200px] overflow-hidden rounded-2xl border border-[#d7d7d7] bg-[#e0e0e0]/96 shadow-[0_14px_36px_rgba(0,0,0,0.18)] backdrop-blur-md max-h-[70vh] overflow-y-auto">
//               <div className="sticky top-0 border-b border-[#d0d0d0] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#666] bg-[#e0e0e0]">Base Map</div>
//               {(['Road', 'Thematic', 'Satellite', 'Google'] as const).map(group => {
//                 const entries = Object.entries(BASE_MAPS).filter(([, v]) => v.group === group);
//                 return (
//                   <div key={group}>
//                     <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-[#888] bg-[#d8d8d8] border-t border-[#d0d0d0]">{group}</div>
//                     {entries.map(([key, bm]) => (
//                       <button key={key} type="button"
//                         onClick={() => {
//                           setSelectedBaseMap(key);
//                           setShowBaseMapDropdown(false);
//                           if ((key === 'Google' || key === 'Google Satellite') && !GOOGLE_ROAD_TILES_URL)
//                             alert('Set GOOGLE_ROAD_TILES_URL / GOOGLE_SAT_TILES_URL constants to use Google tiles. Falling back to OSM.');
//                         }}
//                         className={`flex w-full items-center justify-between px-3 py-2 text-left text-[11px] transition-all border-t border-[#d0d0d0] ${selectedBaseMap === key ? 'bg-[#111] text-[#e0e0e0]' : 'text-[#111] hover:bg-[#d5d5d5]'}`}>
//                         <span>{bm.label}</span>
//                         {selectedBaseMap === key && <span className="text-xs">✓</span>}
//                       </button>
//                     ))}
//                   </div>
//                 );
//               })}
//             </div>
//           )}
//         </div>

//         {/* ── Tool buttons ── */}
//         {tools.map(tool => {
//           const isActive = activeTool===tool.label;
//           return (
//             <div key={tool.label} className="relative">
//               <button type="button" title={tool.label} onClick={()=>handleToolClick(tool.label)}
//                 className={`h-10 w-10 rounded-2xl border border-[#c0c0c0] bg-[#e0e0e0]/95 shadow-[0_8px_22px_rgba(0,0,0,0.10)] backdrop-blur-md transition-all hover:bg-[#d5d5d5] active:scale-[0.98]`}>
//                 <tool.Icon active={isActive}/>
//               </button>
//               {tool.label==='Plugins'&&isActive&&<PluginsPanel/>}
//               {tool.label==='Draw'&&isActive&&showDrawPopup&&<DrawPopup/>}
//             </div>
//           );
//         })}
//       </div>

//       {/* ── Draw status bar ── */}
//       {activeTool==='Draw'&&drawCount>0 && (
//         <div className={`absolute left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-full border border-[#c0c0c0] bg-[#e0e0e0]/96 px-4 py-2 shadow-[0_10px_28px_rgba(0,0,0,0.16)] backdrop-blur-md text-[11px] text-[#111] whitespace-nowrap ${showBottomPanel?'bottom-[calc(20vh+52px)]':'bottom-14'}`}>
//           <span className="font-medium capitalize">{drawGeometry}</span>
//           <span className="text-[#888]">{drawCount} pt{drawCount!==1?'s':''}</span>
//           <span className="text-[#c0c0c0]">|</span>
//           {!drawFinished ? <button onClick={()=>setDrawFinished(true)} className={`${pb} rounded-full px-3 py-1 text-[10px] font-semibold`}>Finish</button> : <button onClick={saveDraw} className={`${pb} rounded-full px-3 py-1 text-[10px] font-semibold`}>Save</button>}
//           <button onClick={clearDraw} className="text-[10px] text-[#e11d48] underline font-medium">Clear</button>
//         </div>
//       )}

//       {/* ── Measure bar ── */}
//       {activeTool==='Measure' && (
//         <div className={`absolute left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-full border border-[#c0c0c0] bg-[#e0e0e0]/96 px-4 py-2 shadow-[0_10px_28px_rgba(0,0,0,0.16)] backdrop-blur-md text-[11px] text-[#111] whitespace-nowrap ${showBottomPanel?'bottom-[calc(20vh+52px)]':'bottom-14'}`}>
//           <span className="font-medium">Measure</span>
//           <span className="text-[#888]">{measureTotal!=null?(measureTotal<1?`${(measureTotal*1000).toFixed(0)} m`:`${measureTotal.toFixed(3)} km`):'Click map to start'}</span>
//           <span className="text-[#c0c0c0]">|</span>
//           <button onClick={clearMeasure} className="text-[10px] text-[#e11d48] underline font-medium">Clear</button>
//         </div>
//       )}

//       {/* ── Zoom + Compass ── */}
//       <div className={`absolute z-30 flex flex-col items-center gap-2 transition-all duration-300 ${ctrlBot}`} style={{left:`${blLeft}px`}}>
//         <div className="flex flex-col items-center overflow-hidden rounded-[20px] border border-[#c0c0c0] bg-[#e0e0e0]/95 shadow-[0_10px_24px_rgba(0,0,0,0.12)] backdrop-blur-md">
//           <button type="button" onClick={zoomIn} className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center border-b border-[#c0c0c0] text-sm sm:text-base font-bold text-[#111] hover:bg-[#d5d5d5] transition-all">+</button>
//           <div className="flex items-center justify-center px-1 py-1.5">
//             <input type="range" min="1" max="20" value={zoomLevel} onChange={e=>{const z=Number(e.target.value);setZoomLevel(z);mapRef.current?.setZoom(z);}} className="vertical-zoom-slider cursor-pointer appearance-none bg-transparent" style={{writingMode:'vertical-lr',direction:'rtl',width:'7px',height:isMobile?'42px':'48px'}}/>
//           </div>
//           <button type="button" onClick={zoomOut} className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center border-t border-[#c0c0c0] text-sm sm:text-base font-bold text-[#111] hover:bg-[#d5d5d5] transition-all">−</button>
//         </div>
//         <div className="rounded-[20px] border border-[#c0c0c0] bg-[#e0e0e0]/95 p-1 shadow-[0_10px_24px_rgba(0,0,0,0.12)] backdrop-blur-md">
//           <SmallCompass size={isMobile?44:48}/>
//         </div>
//       </div>

//       {/* ── Lat/Lon display ── */}
//       <div className={`absolute z-30 rounded-2xl border border-[#c0c0c0] bg-[#e0e0e0]/95 px-2 py-1 sm:px-2.5 sm:py-1.5 text-[10px] sm:text-[11px] text-[#555] shadow-[0_10px_24px_rgba(0,0,0,0.12)] backdrop-blur-md transition-all duration-300 ${rightShift} ${llBot}`}>
//         <span className="font-bold text-[#111]">Lat:</span> {latLon.lat.toFixed(4)}{' '}<span className="text-[#a0a0a0]">|</span>{' '}<span className="font-bold text-[#111]">Lon:</span> {latLon.lon.toFixed(4)}
//       </div>

//       {/* ── Object Editor – mobile ── */}
//       {selectedObjectId&&isMobile && (
//         <div className="absolute bottom-0 left-0 right-0 z-30 flex flex-col rounded-t-2xl border-t border-[#c0c0c0] bg-[#e0e0e0]/96 shadow-[0_-10px_30px_rgba(0,0,0,0.16)] backdrop-blur-md" style={{maxHeight:'50vh'}}>
//           <div className="flex shrink-0 justify-center pb-1 pt-2"><div className="h-[3px] w-8 rounded-full bg-[#b0b0b0]"/></div>
//           <div className="flex shrink-0 items-center justify-between border-b border-[#d0d0d0] bg-[#d5d5d5] px-3 py-1.5">
//             <span className="text-[12px] font-semibold text-[#111]">Object Editor</span>
//             <div className="flex items-center gap-1.5">
//               <button type="button" onClick={zoomToSelected} className={`${ib} h-7 w-7 rounded-xl text-xs`}>⌖</button>
//               {!isEditing&&<button onClick={startEditing} className={`${gb} rounded-xl px-2 py-1 text-[11px] font-medium`}>Edit</button>}
//               <button type="button" onClick={closeEditor} className={`${ib} h-7 w-7 rounded-xl text-xs font-bold`}>↓</button>
//             </div>
//           </div>
//           <div className="shrink-0 border-b border-[#d0d0d0] bg-[#d8d8d8] px-3 py-1"><span className="text-[11px] text-[#555]">Selected: </span><span className="text-[11px] font-semibold text-[#111]">{getDisplayLabel()}</span></div>
//           <div className="flex shrink-0 border-b border-[#d0d0d0] bg-[#d5d5d5]">
//             {(['Details','Layers'] as const).map(tab=>(
//               <button key={tab} onClick={()=>setActiveTab(tab)} className={`px-5 py-1.5 transition text-[11px] ${activeTab===tab?'border-b-[2px] border-[#111] bg-[#e0e0e0] font-semibold text-[#111]':'text-[#666] border-b-[2px] border-transparent hover:bg-[#d8d8d8]'}`}>{tab}</button>
//             ))}
//           </div>
//           <div className="flex-1 overflow-y-auto">{activeTab==='Details'?renderDetails(true):renderLayers(true)}</div>
//           {isEditing && (
//             <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-[#d0d0d0] bg-[#d5d5d5] px-2 py-1.5">
//               <button onClick={cancelEditing} className={`${gb} rounded-xl px-2 py-1 text-[11px] font-medium`}>Cancel</button>
//               <button onClick={deleteObj}     className={`${gb} rounded-xl px-2 py-1 text-[11px] font-medium`}>Delete</button>
//               <div className="relative">
//                 <button type="button" onClick={()=>setShowSaveMenu(p=>!p)} className={`${pb} rounded-xl px-2 py-1 text-[11px] font-medium`}>Save ▾</button>
//                 {showSaveMenu && (<div className="absolute bottom-full right-0 mb-1 min-w-[140px] overflow-hidden rounded-xl border border-[#c0c0c0] bg-[#e0e0e0] shadow-[0_12px_30px_rgba(0,0,0,0.15)]"><button type="button" onClick={()=>saveChanges(false)} className="block w-full px-3 py-2 text-left text-[11px] text-[#111] hover:bg-[#d5d5d5]">Save</button><button type="button" onClick={()=>saveChanges(true)} className="block w-full border-t border-[#d0d0d0] px-3 py-2 text-left text-[11px] text-[#111] hover:bg-[#d5d5d5]">Save &amp; Continue</button></div>)}
//               </div>
//             </div>
//           )}
//         </div>
//       )}

//       {/* ── Object Editor – desktop ── */}
//       {selectedObjectId&&!isMobile && (
//         <div className="absolute inset-y-0 right-0 z-30 flex w-[320px] flex-col border-l border-[#c0c0c0] bg-[#e0e0e0]/96 shadow-[0_16px_40px_rgba(0,0,0,0.12)] backdrop-blur-md">
//           {/* Header — same style as OC header */}
//             <div className="flex items-center justify-between border-b border-[#d0d0d0] bg-[#d5d5d5] px-3 py-2">
//             <div className="flex items-center gap-2">
//                 <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#111]">
//                 <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
//                     <rect x="1" y="1" width="14" height="14" rx="3" stroke="#e0e0e0" strokeWidth="1.3"/>
//                     <path d="M4 5h8M4 8h5M4 11h6" stroke="#e0e0e0" strokeWidth="1.2" strokeLinecap="round"/>
//                 </svg>
//                 </div>
//                 <div className="text-[13px] font-semibold text-[#111]">Object Editor</div>
//             </div>
//             <button type="button" onClick={closeEditor} className={`${ib} h-7 w-7 rounded-xl text-sm font-bold`}>→</button>
//             </div>
//           {/* Selected label row */}
//           <div className="flex items-center justify-between gap-2 border-b border-[#d0d0d0] bg-[#d8d8d8] px-3 py-1.5">
//             <div className="truncate text-[11px] text-[#555]">Selected: <span className="font-semibold text-[#111]">{getDisplayLabel()}</span></div>
//             <div className="flex items-center gap-1.5">
//               <button type="button" onClick={zoomToSelected} className={`${ib} h-7 w-7 rounded-xl text-xs font-bold`}>⌖</button>
//               {!isEditing&&<button onClick={startEditing} className={`${gb} rounded-xl px-2.5 py-1 text-[11px] font-medium`}>Edit</button>}
//             </div>
//           </div>
//           {/* Tabs */}
//           <div className="flex border-b border-[#d0d0d0] bg-[#d5d5d5]">
//             {(['Details','Layers'] as const).map(tab=>(
//               <button key={tab} onClick={()=>setActiveTab(tab)} className={`px-5 py-1.5 transition text-[11px] ${activeTab===tab?'border-b-[2px] border-[#111] bg-[#e0e0e0] font-semibold text-[#111]':'text-[#666] border-b-[2px] border-transparent hover:bg-[#d8d8d8]'}`}>{tab}</button>
//             ))}
//           </div>
//           {/* Content */}
//           <div className={`${isEditing?'h-[calc(100%-106px)]':'h-[calc(100%-84px)]'} overflow-y-auto`}>
//             {activeTab==='Details'?renderDetails(false):renderLayers(false)}
//           </div>
//           {/* Edit actions */}
//           {isEditing && (
//             <div className="flex items-center justify-end gap-2 border-t border-[#d0d0d0] bg-[#d5d5d5] px-2 py-2">
//               <button onClick={cancelEditing} className={`${gb} rounded-xl px-2.5 py-1.5 text-[11px] font-medium`}>Cancel</button>
//               <button onClick={deleteObj}     className={`${gb} rounded-xl px-2.5 py-1.5 text-[11px] font-medium`}>Delete</button>
//               <div className="relative">
//                 <button type="button" onClick={()=>setShowSaveMenu(p=>!p)} className={`${pb} rounded-xl px-2.5 py-1.5 text-[11px] font-medium`}>Save ▾</button>
//                 {showSaveMenu && (<div className="absolute bottom-full right-0 mb-2 min-w-[160px] overflow-hidden rounded-xl border border-[#c0c0c0] bg-[#e0e0e0] shadow-[0_12px_30px_rgba(0,0,0,0.15)]"><button type="button" onClick={()=>saveChanges(false)} className="block w-full px-3 py-2 text-left text-[11px] text-[#111] hover:bg-[#d5d5d5]">Save</button><button type="button" onClick={()=>saveChanges(true)} className="block w-full border-t border-[#d0d0d0] px-3 py-2 text-left text-[11px] text-[#111] hover:bg-[#d5d5d5]">Save &amp; Continue</button></div>)}
//               </div>
//             </div>
//           )}
//         </div>
//       )}

//       {/* ── Bottom Table ── */}
//       {showBottomPanel&&!showProject && (
//         <div className={`absolute bottom-0 left-0 right-0 z-40 border-t border-[#c0c0c0] bg-[#e0e0e0]/96 shadow-[0_-10px_30px_rgba(0,0,0,0.14)] backdrop-blur-md ${isMobile?'h-[30vh]':'h-[20vh] min-h-[140px] max-h-[190px]'}`}>
//           <div className="flex items-center gap-1.5 border-b border-[#d0d0d0] bg-[#d5d5d5] px-2 py-1.5 flex-wrap">
//             <div className="mr-auto shrink-0 truncate text-[12px] font-semibold text-[#111]">{selectedObjectItem||'Objects'}</div>
//             <select value={tableFilterMode} onChange={e=>setTableFilterMode(e.target.value)} className="h-7 rounded-xl border border-[#c0c0c0] bg-[#e0e0e0] px-1.5 text-[11px] font-medium text-[#111] outline-none"><option>By ID</option></select>
//             <input value={tableFilterInput} onChange={e=>setTableFilterInput(e.target.value)} placeholder="Filter…" className="h-7 w-[80px] rounded-xl border border-[#c0c0c0] bg-[#e0e0e0] px-2 text-[11px] text-[#111] outline-none placeholder:text-[#888]"/>
//             <button type="button" onClick={()=>setAppliedTableFilter(tableFilterInput)} className={`${pb} h-7 rounded-xl px-2.5 text-[11px] font-semibold`}>Run</button>
//             <button type="button" onClick={downloadTable} className={`${gb} h-7 rounded-xl px-2.5 text-[11px] font-semibold`}>Download</button>
//             <button onClick={()=>setShowBottomPanel(false)} className={`${ib} h-7 w-7 rounded-xl text-xs font-bold`}>↓</button>
//           </div>
//           <div className="h-[calc(100%-42px)] overflow-auto">
//             <table className="min-w-full table-fixed text-[11px]">
//               <thead className="sticky top-0 bg-[#d5d5d5]">
//                 <tr className="text-left text-[#111]">
//                   {['ID','Type','Status','Owner','Material','Height','Municipality','Design ID'].map(h=>(<th key={h} className="truncate whitespace-nowrap px-2 py-[5px] font-semibold">{h}</th>))}
//                 </tr>
//               </thead>
//               <tbody>
//                 {filteredRows.map((row,idx) => (
//                   <tr key={row.key} onClick={row.onClick} className={`h-[24px] leading-none transition-colors ${row.onClick?'cursor-pointer':''} ${row.selected?'border-l-2 border-l-[#111] bg-[#d0d0d0]':idx%2===0?'bg-[#e0e0e0] hover:bg-[#d5d5d5]':'bg-[#dcdcdc] hover:bg-[#d5d5d5]'}`}>
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
//                 {filteredRows.length===0 && <tr><td colSpan={8} className="px-3 py-4 text-center text-[11px] text-[#888]">No records found.</td></tr>}
//               </tbody>
//             </table>
//           </div>
//         </div>
//       )}

//       <style>{`
//         .maplibregl-ctrl-bottom-left,.maplibregl-ctrl-bottom-right,.maplibregl-ctrl-top-left,.maplibregl-ctrl-top-right{display:none!important;}
//         .maplibregl-canvas{outline:none;}
//         .maplibregl-popup-content{padding:0!important;border-radius:12px!important;overflow:hidden;box-shadow:0 8px 22px rgba(0,0,0,0.18)!important;background-color:#e0e0e0!important;}
//         .maplibregl-popup-tip{border-top-color:#e0e0e0!important;border-bottom-color:#e0e0e0!important;}
//         .vertical-zoom-slider::-webkit-slider-runnable-track{width:5px;border-radius:9999px;background:#c0c0c0;}
//         .vertical-zoom-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:12px;height:12px;border-radius:9999px;background:#111;border:2px solid #e0e0e0;box-shadow:0 2px 8px rgba(0,0,0,.24);margin-left:-4px;}
//         .vertical-zoom-slider::-moz-range-track{width:5px;border-radius:9999px;background:#c0c0c0;}
//         .vertical-zoom-slider::-moz-range-thumb{width:12px;height:12px;border-radius:9999px;background:#111;border:2px solid #e0e0e0;box-shadow:0 2px 8px rgba(0,0,0,.24);}
//       `}</style>
//     </div>
//   );
// }