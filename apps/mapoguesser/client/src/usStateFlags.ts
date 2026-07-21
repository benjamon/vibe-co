// US state flag images: public-domain SVGs mirrored from Wikipedia, served via
// jsDelivr's GitHub mirror (same hosting pattern as the Natural Earth GeoJSON
// datasets in WorldViewer.tsx). Filenames match Natural Earth's state NAME
// field exactly except for the three overrides below.
const US_STATE_FLAG_BASE =
  'https://cdn.jsdelivr.net/gh/nibsbin/us-state-flags-svg@master/flags/'

const FILENAME_OVERRIDES: Record<string, string> = {
  Colorado: 'Flag_of_Colorado_designed_by_Andrew_Carlisle_Carson.svg',
  Georgia: 'Flag_of_Georgia_(U.S._state).svg',
  'District of Columbia': 'Flag_of_the_District_of_Columbia.svg',
}

export const usStateFlagUrl = (stateName: string): string => {
  const filename =
    FILENAME_OVERRIDES[stateName] ??
    `Flag_of_${stateName.replace(/ /g, '_')}.svg`
  return US_STATE_FLAG_BASE + encodeURIComponent(filename)
}
