import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// ── Map Style Helper ──
const OSM_TILES = ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'];
const OSM_ATTR  = '© OpenStreetMap contributors';

function getBaseMapStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      basemap: {
        type: 'raster',
        tiles: OSM_TILES,
        tileSize: 256,
        attribution: OSM_ATTR,
      },
    },
    layers: [
      {
        id: 'basemap-tiles',
        type: 'raster',
        source: 'basemap',
        minzoom: 0,
        maxzoom: 24,
      },
    ],
  };
}

export default function LoginPage() {
  const navigate = useNavigate();
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<maplibregl.Map | null>(null);

  // Default credentials for quick testing
  const [username, setUsername] = useState('admin@redplanet.com');
  const [password, setPassword] = useState('admin@123');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isMobile, setIsMobile] = useState(false);

  // Check screen size for responsiveness
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // ── Initialize MapLibre Background Map ──
  useEffect(() => {
    if (!mapContainerRef.current || mapInstance.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: getBaseMapStyle(),
      center: [121.1866, 14.5943], // Centered on Quezon City
      zoom: 14,
      interactive: false, // Freezes the map (no pan, zoom, or scroll)
      attributionControl: false,
    });

    mapInstance.current = map;

    return () => {
      map.remove();
      mapInstance.current = null;
    };
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // ── Routing Logic ──
    
    if (username === 'admin@redplanet.com' && password === 'admin@123') {
      setError('');
      navigate('/admin');
      return;
    }

    if (username === 'assigner@redplanet.com' && password === 'assigner@123') {
      setError('');
      navigate('/assigner');
      return;
    }

    if (username === 'user@redplanet.com' && password === 'user@123') {
      setError('');
      navigate('/user');
      return;
    }

    setError('Invalid username or password');
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden font-sans bg-[#eef2f4]">
      
      {/* ── Background Map ── */}
      {/* Forced to absolute bottom layer */}
      <div 
        ref={mapContainerRef} 
        className="absolute inset-0 z-0" 
        style={{ width: '100%', height: '100%' }} 
      />

      {/* ── Blur Overlay & Content Wrapper ── */}
      {/* Forced to top layer, wrapping the login card so it never disappears */}
      <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/40 backdrop-blur-[4px] px-3 sm:px-4">
        
        {/* ── Login Card ── */}
        <div className={`flex w-full flex-col items-center ${isMobile ? 'max-w-[288px]' : 'max-w-[360px]'} -translate-y-[5%]`}>

          {/* Logo */}
          <div className={`${isMobile ? 'mb-4' : 'mb-6'} flex flex-col items-center`}>
            <img
              src="https://redplanetgrp.com/wp-content/uploads/2025/04/Redplanet-Solutions.webp"
              alt="Redplanet Solutions"
              className={`${isMobile ? 'h-9 mb-1' : 'h-[86px] mb-1'} w-auto object-contain`}
              onError={(e) => {
                const target = e.currentTarget;
                target.style.display = 'none';
                const fallback = document.createElement('div');
                fallback.textContent = 'Redplanet Solutions';
                fallback.style.cssText = 'font-size:20px;font-weight:700;color:#c0392b;letter-spacing:-0.5px;margin-bottom:4px;';
                target.parentNode?.insertBefore(fallback, target);
              }}
            />
            <p className={`${isMobile ? 'text-[11px]' : 'text-[13.5px]'} text-[#333] font-bold tracking-wide drop-shadow-md`}>
              Sign in to your account
            </p>
          </div>

          {/* Form Card */}
          <div
            className={`w-full border border-white/60 bg-white/90 shadow-[0_20px_50px_rgba(0,0,0,0.16)] backdrop-blur-xl ${
              isMobile ? 'rounded-[20px] p-4' : 'rounded-[27px] p-[30px]'
            }`}
          >
            <form onSubmit={handleSubmit} className={isMobile ? 'space-y-3' : 'space-y-5'}>
              <div>
                <label className={`block font-medium text-[#374151] ${isMobile ? 'mb-1.5 text-[11px]' : 'mb-2 text-[12px]'}`}>
                  Username or email
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={`w-full rounded-[18px] border border-gray-300 bg-white/90 px-3.5 text-[13px] shadow-sm outline-none transition-all focus:border-[#3F9AAE] focus:ring-2 focus:ring-[#3F9AAE]/20 ${
                    isMobile ? 'h-9' : 'h-[44px]'
                  }`}
                />
              </div>

              <div>
                <label className={`block font-medium text-[#374151] ${isMobile ? 'mb-1.5 text-[11px]' : 'mb-2 text-[12px]'}`}>
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`w-full rounded-[18px] border border-gray-300 bg-white/90 px-3.5 pr-11 text-[13px] shadow-sm outline-none transition-all focus:border-[#3F9AAE] focus:ring-2 focus:ring-[#3F9AAE]/20 ${
                      isMobile ? 'h-9' : 'h-[44px]'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((p) => !p)}
                    className={`absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-800 ${isMobile ? 'text-[12px]' : 'text-[14px]'}`}
                  >
                    {showPassword ? '✕' : '👁'}
                  </button>
                </div>
              </div>

              {error && <div className="text-[12px] font-medium text-red-600 text-center">{error}</div>}

              <button
                type="submit"
                className={`w-full rounded-[18px] bg-[#111] font-semibold text-white shadow-md transition-all hover:bg-[#333] hover:shadow-lg active:scale-[0.98] ${
                  isMobile ? 'mt-2 h-10 text-[13px]' : 'mt-2 h-[44px] text-[13.5px]'
                }`}
              >
                Sign In
              </button>
            </form>

            {/* Helper Text */}
            <div className={`${isMobile ? 'mt-4 text-[10px]' : 'mt-6 text-[11px]'} text-center text-gray-500 leading-relaxed`}>
              Admin: <b>admin@redplanet.com</b> / <b>admin@123</b>
              <br />
              Assigner: <b>assigner@redplanet.com</b> / <b>assigner@123</b>
              <br />
              User: <b>user@redplanet.com</b> / <b>user@123</b>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}