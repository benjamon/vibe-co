// Approximate Brazilian state populations (2022 census ballpark), used only
// to rank states for the "top N by population" item-unlocking gate (see
// store.ts's unlockedCountFor). Doesn't need to track live data — just a
// stable most-populous-first ordering. Keys match Natural Earth's state
// NAME field, same convention as usStatePopulations.ts.
const STATE_POPULATIONS: Record<string, number> = {
  'São Paulo': 44_400_000,
  'Minas Gerais': 20_500_000,
  'Rio de Janeiro': 16_050_000,
  Bahia: 14_100_000,
  Paraná: 11_440_000,
  'Rio Grande do Sul': 10_880_000,
  Pernambuco: 9_050_000,
  Ceará: 8_790_000,
  Pará: 8_120_000,
  'Santa Catarina': 7_610_000,
  Goiás: 7_110_000,
  Maranhão: 6_780_000,
  Amazonas: 4_200_000,
  'Espírito Santo': 4_100_000,
  Paraíba: 4_030_000,
  'Mato Grosso': 3_660_000,
  'Rio Grande do Norte': 3_400_000,
  Piauí: 3_270_000,
  Alagoas: 3_130_000,
  'Mato Grosso do Sul': 2_830_000,
  Sergipe: 2_210_000,
  Rondônia: 1_580_000,
  Tocantins: 1_510_000,
  Acre: 830_000,
  Amapá: 730_000,
  Roraima: 630_000,
}

export const brazilStatePopulation = (stateName: string): number =>
  STATE_POPULATIONS[stateName] ?? 0
