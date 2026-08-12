// Facts for the Brazil States mode's after-guess info card. Mirrors
// usStateFacts.ts, minus a US-style "admitted" year — Brazilian state
// formation history (colonial captaincies, later splits/creations like
// Tocantins in 1988) doesn't map onto a single clean "founded" date the way
// US statehood does. Hand curated from general reference (~2022 census
// population estimates, state capitals). Treat population as approximate.
export interface BrazilStateFacts {
  population: number
  capital: string
}

export const BRAZIL_STATE_FACTS: Record<string, BrazilStateFacts> = {
  Acre: { population: 830000, capital: 'Rio Branco' },
  Alagoas: { population: 3130000, capital: 'Maceió' },
  Amapá: { population: 730000, capital: 'Macapá' },
  Amazonas: { population: 4200000, capital: 'Manaus' },
  Bahia: { population: 14100000, capital: 'Salvador' },
  Ceará: { population: 8790000, capital: 'Fortaleza' },
  'Espírito Santo': { population: 4100000, capital: 'Vitória' },
  Goiás: { population: 7110000, capital: 'Goiânia' },
  Maranhão: { population: 6780000, capital: 'São Luís' },
  'Mato Grosso': { population: 3660000, capital: 'Cuiabá' },
  'Mato Grosso do Sul': { population: 2830000, capital: 'Campo Grande' },
  'Minas Gerais': { population: 20500000, capital: 'Belo Horizonte' },
  Paraná: { population: 11440000, capital: 'Curitiba' },
  Paraíba: { population: 4030000, capital: 'João Pessoa' },
  Pará: { population: 8120000, capital: 'Belém' },
  Pernambuco: { population: 9050000, capital: 'Recife' },
  Piauí: { population: 3270000, capital: 'Teresina' },
  'Rio Grande do Norte': { population: 3400000, capital: 'Natal' },
  'Rio Grande do Sul': { population: 10880000, capital: 'Porto Alegre' },
  'Rio de Janeiro': { population: 16050000, capital: 'Rio de Janeiro' },
  Rondônia: { population: 1580000, capital: 'Porto Velho' },
  Roraima: { population: 630000, capital: 'Boa Vista' },
  'Santa Catarina': { population: 7610000, capital: 'Florianópolis' },
  Sergipe: { population: 2210000, capital: 'Aracaju' },
  'São Paulo': { population: 44400000, capital: 'São Paulo' },
  Tocantins: { population: 1510000, capital: 'Palmas' },
}

// A state's population rank among all 26 states (1 = most populous), or
// null if it isn't in the table.
export const brazilStatePopulationRank = (name: string): number | null => {
  const facts = BRAZIL_STATE_FACTS[name]
  if (!facts) return null
  const pops = Object.values(BRAZIL_STATE_FACTS)
    .map((f) => f.population)
    .sort((a, b) => b - a)
  const rank = pops.indexOf(facts.population)
  return rank === -1 ? null : rank + 1
}
