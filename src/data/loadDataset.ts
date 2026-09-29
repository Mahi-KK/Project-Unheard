import { feature, mesh } from 'topojson-client'
import type { FeatureCollection, MultiLineString, Geometry } from 'geojson'
import type { Topology, GeometryCollection } from 'topojson-specification'
import type { Dataset } from '../types/data'

export interface GeoBundle {
  districts: FeatureCollection<Geometry, { id: string; name: string; state: string }>
  stateLines: MultiLineString
  outline: MultiLineString
}

const TOPO_KEY = 'india-districts-2019-734'

/** Loads the bundled, offline dataset and boundaries (no network, no API key). */
export async function loadDataset(): Promise<{ dataset: Dataset; geo: GeoBundle }> {
  const [ds, topo] = await Promise.all([
    fetch('/data/districts.json').then((r) => {
      if (!r.ok) throw new Error(`districts.json ${r.status}`)
      return r.json() as Promise<Dataset>
    }),
    fetch('/data/districts.topo.json').then((r) => {
      if (!r.ok) throw new Error(`districts.topo.json ${r.status}`)
      return r.json() as Promise<Topology>
    }),
  ])
  const obj = topo.objects[TOPO_KEY] as GeometryCollection<{ id: string; name: string; state: string }>
  const districts = feature(topo, obj) as unknown as GeoBundle['districts']
  const stateLines = mesh(topo, obj, (a, b) => a !== b && (a.properties as { state: string }).state !== (b.properties as { state: string }).state)
  const outline = mesh(topo, obj, (a, b) => a === b)
  return { dataset: ds, geo: { districts, stateLines, outline } }
}
