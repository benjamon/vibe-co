// Facts for the US States mode's after-guess info card. Not part of any
// Natural Earth field (the admin-1 polygon dataset carries no population) —
// hand curated from general reference (~2023 Census population estimates,
// state capitals, year admitted to the Union). Treat population as
// approximate; capital and admission year are settled historical fact.
export interface UsStateFacts {
  population: number
  capital: string
  // Year the state was admitted to the Union.
  admitted: number
}

export const US_STATE_FACTS: Record<string, UsStateFacts> = {
  Alabama: { population: 5108468, capital: 'Montgomery', admitted: 1819 },
  Alaska: { population: 733406, capital: 'Juneau', admitted: 1959 },
  Arizona: { population: 7431344, capital: 'Phoenix', admitted: 1912 },
  Arkansas: { population: 3067732, capital: 'Little Rock', admitted: 1836 },
  California: { population: 38965193, capital: 'Sacramento', admitted: 1850 },
  Colorado: { population: 5877610, capital: 'Denver', admitted: 1876 },
  Connecticut: { population: 3617176, capital: 'Hartford', admitted: 1788 },
  Delaware: { population: 1031890, capital: 'Dover', admitted: 1787 },
  Florida: { population: 22610726, capital: 'Tallahassee', admitted: 1845 },
  Georgia: { population: 11029227, capital: 'Atlanta', admitted: 1788 },
  Hawaii: { population: 1435138, capital: 'Honolulu', admitted: 1959 },
  Idaho: { population: 1964726, capital: 'Boise', admitted: 1890 },
  Illinois: { population: 12549689, capital: 'Springfield', admitted: 1818 },
  Indiana: { population: 6862199, capital: 'Indianapolis', admitted: 1816 },
  Iowa: { population: 3200517, capital: 'Des Moines', admitted: 1846 },
  Kansas: { population: 2940546, capital: 'Topeka', admitted: 1861 },
  Kentucky: { population: 4526154, capital: 'Frankfort', admitted: 1792 },
  Louisiana: { population: 4573749, capital: 'Baton Rouge', admitted: 1812 },
  Maine: { population: 1395722, capital: 'Augusta', admitted: 1820 },
  Maryland: { population: 6180253, capital: 'Annapolis', admitted: 1788 },
  Massachusetts: { population: 7001399, capital: 'Boston', admitted: 1788 },
  Michigan: { population: 10037261, capital: 'Lansing', admitted: 1837 },
  Minnesota: { population: 5737915, capital: 'Saint Paul', admitted: 1858 },
  Mississippi: { population: 2939690, capital: 'Jackson', admitted: 1817 },
  Missouri: { population: 6196010, capital: 'Jefferson City', admitted: 1821 },
  Montana: { population: 1132812, capital: 'Helena', admitted: 1889 },
  Nebraska: { population: 1978379, capital: 'Lincoln', admitted: 1867 },
  Nevada: { population: 3194176, capital: 'Carson City', admitted: 1864 },
  'New Hampshire': { population: 1402054, capital: 'Concord', admitted: 1788 },
  'New Jersey': { population: 9290841, capital: 'Trenton', admitted: 1787 },
  'New Mexico': { population: 2114371, capital: 'Santa Fe', admitted: 1912 },
  'New York': { population: 19571216, capital: 'Albany', admitted: 1788 },
  'North Carolina': { population: 10835491, capital: 'Raleigh', admitted: 1789 },
  'North Dakota': { population: 783926, capital: 'Bismarck', admitted: 1889 },
  Ohio: { population: 11785935, capital: 'Columbus', admitted: 1803 },
  Oklahoma: { population: 4053824, capital: 'Oklahoma City', admitted: 1907 },
  Oregon: { population: 4233358, capital: 'Salem', admitted: 1859 },
  Pennsylvania: { population: 12961683, capital: 'Harrisburg', admitted: 1787 },
  'Rhode Island': { population: 1095962, capital: 'Providence', admitted: 1790 },
  'South Carolina': { population: 5373555, capital: 'Columbia', admitted: 1788 },
  'South Dakota': { population: 909824, capital: 'Pierre', admitted: 1889 },
  Tennessee: { population: 7126489, capital: 'Nashville', admitted: 1796 },
  Texas: { population: 30503301, capital: 'Austin', admitted: 1845 },
  Utah: { population: 3417734, capital: 'Salt Lake City', admitted: 1896 },
  Vermont: { population: 647464, capital: 'Montpelier', admitted: 1791 },
  Virginia: { population: 8715698, capital: 'Richmond', admitted: 1788 },
  Washington: { population: 7812880, capital: 'Olympia', admitted: 1889 },
  'West Virginia': { population: 1770071, capital: 'Charleston', admitted: 1863 },
  Wisconsin: { population: 5910955, capital: 'Madison', admitted: 1848 },
  Wyoming: { population: 584057, capital: 'Cheyenne', admitted: 1890 },
}

// A state's population rank among all 50 states (1 = most populous), or null
// if it isn't in the table.
export const usStatePopulationRank = (name: string): number | null => {
  const facts = US_STATE_FACTS[name]
  if (!facts) return null
  const pops = Object.values(US_STATE_FACTS)
    .map((f) => f.population)
    .sort((a, b) => b - a)
  const rank = pops.indexOf(facts.population)
  return rank === -1 ? null : rank + 1
}
