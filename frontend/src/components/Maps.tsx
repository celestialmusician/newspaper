import L from 'leaflet'
import { LocateFixed } from 'lucide-react'
import * as React from 'react'
import { MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { Button } from '@/components/ui/button'

const TILE = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

export function numberedIcon(n: number | string, tone: 'navy' | 'done' | 'missed' | 'pending' | 'start' = 'navy') {
  const bg = { navy: 'var(--brand)', done: '#2f7d4f', missed: '#b42318', pending: '#c2410c', start: '#b7791f' }[tone]
  return L.divIcon({
    className: 'stop-pin',
    iconSize: [30, 38],
    iconAnchor: [15, 36],
    popupAnchor: [0, -32],
    html: `<div style="position:relative;width:30px;height:38px"><svg width="30" height="38" viewBox="0 0 30 38"><path d="M15 37c0 0 13-12.2 13-22A13 13 0 0 0 2 15c0 9.8 13 22 13 22z" fill="${bg}" stroke="#fff" stroke-width="2"/></svg><span style="position:absolute;top:6px;left:0;width:30px;text-align:center;color:#fff;font:700 12px Manrope Variable,system-ui">${n}</span></div>`,
  })
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  const sig = points.map((p) => p.join(',')).join('|')
  React.useEffect(() => {
    if (points.length === 1) map.setView(points[0]!, 16)
    else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [36, 36] })
  }, [sig]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

export interface MapStop {
  id: string
  lat: number
  lng: number
  label: string
  sub?: string
  seq: number | string
  tone?: 'navy' | 'done' | 'missed' | 'pending' | 'start'
}

/** Route map: numbered stops in delivery sequence joined by a path line. */
export function RouteMap({ stops, height = 420, onSelect, showPath = true }: { stops: MapStop[]; height?: number; onSelect?: (id: string) => void; showPath?: boolean }) {
  const pts = stops.map((s) => [s.lat, s.lng] as [number, number])
  const center = pts[0] ?? [8.5241, 76.9366]
  return (
    <div style={{ height }} className="relative z-0 overflow-hidden rounded-2xl border border-border shadow-card">
      <MapContainer center={center} zoom={14} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
        <TileLayer url={TILE} attribution={ATTR} />
        <FitBounds points={pts} />
        {showPath && pts.length > 1 && <Polyline positions={pts} pathOptions={{ color: 'var(--brand)', weight: 3.5, opacity: 0.8, dashArray: '6 7' }} />}
        {stops.map((s) => (
          <Marker key={s.id} position={[s.lat, s.lng]} icon={numberedIcon(s.seq, s.tone)} eventHandlers={onSelect ? { click: () => onSelect(s.id) } : undefined}>
            <Tooltip direction="top" offset={[0, -30]}>
              {s.label}
            </Tooltip>
            <Popup>
              <div className="text-[13px]">
                <div className="font-semibold">{s.label}</div>
                {s.sub && <div className="text-muted-foreground">{s.sub}</div>}
                <a className="mt-1 inline-block font-semibold text-masthead" href={`https://www.openstreetmap.org/directions?to=${s.lat}%2C${s.lng}`} target="_blank" rel="noreferrer">
                  Directions ↗
                </a>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}

function ClickToPin({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(round(e.latlng.lat), round(e.latlng.lng)) })
  return null
}
const round = (v: number) => Math.round(v * 1e5) / 1e5

/** Map pin selection for customer addresses. Tap the map or drag the pin. */
export function MapPicker({ lat, lng, onChange, height = 280, fallback }: { lat?: number; lng?: number; onChange: (lat: number, lng: number) => void; height?: number | string; fallback?: [number, number] }) {
  const has = typeof lat === 'number' && typeof lng === 'number' && !Number.isNaN(lat)
  const pos: [number, number] = has ? [lat!, lng!] : fallback ?? [8.5241, 76.9366]
  const [locating, setLocating] = React.useState(false)
  const locate = () => {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        onChange(round(p.coords.latitude), round(p.coords.longitude))
        setLocating(false)
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }
  return (
    <div className="space-y-2">
      <div style={{ height }} className="relative z-0 overflow-hidden rounded-2xl border border-border shadow-card">
        <MapContainer center={pos} zoom={15} style={{ height: '100%', width: '100%' }}>
          <TileLayer url={TILE} attribution={ATTR} />
          <Recenter pos={pos} />
          <ClickToPin onPick={onChange} />
          <Marker
            position={pos}
            draggable
            icon={numberedIcon('•', has ? 'pending' : 'start')}
            eventHandlers={{ dragend: (e) => { const ll = (e.target as L.Marker).getLatLng(); onChange(round(ll.lat), round(ll.lng)) } }}
          />
        </MapContainer>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-muted-foreground">
        <span>{has ? `Pinned at ${lat!.toFixed(5)}, ${lng!.toFixed(5)}` : 'Tap the map or drag the pin to the exact gate.'}</span>
        <Button type="button" variant="outline" size="sm" onClick={locate} loading={locating}>
          <LocateFixed /> Use my location
        </Button>
      </div>
    </div>
  )
}

function Recenter({ pos }: { pos: [number, number] }) {
  const map = useMap()
  React.useEffect(() => {
    map.setView(pos, Math.max(map.getZoom(), 15))
  }, [pos[0], pos[1]]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}
