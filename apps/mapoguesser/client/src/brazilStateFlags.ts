// Brazilian state flag images, hosted directly on Wikimedia's upload CDN.
// These are the resolved final targets of each file's Special:FilePath
// redirect (looked up once via the Commons API) rather than the redirect
// URL itself: the mastery modal can render all ~26 of a country's flags at
// once, and that burst of concurrent requests was tripping Wikimedia's rate
// limiter when each one had to hop through 3 redirects
// (Special:FilePath -> Special:Redirect/file -> upload.wikimedia.org) to
// get there. Pointing straight at upload.wikimedia.org is a single request
// per flag instead of four, unlike usStateFlags.ts's single-hop jsDelivr
// GitHub mirror, there's no equivalent curated "Brazil state flags" repo to
// point at instead.
//
// buildFlagPin (WorldViewer.tsx) still falls back to a plain colored flag on
// any image load failure, so this degrades gracefully if a URL ever goes
// stale (e.g. the file is renamed/moved on Commons).
const FLAG_URLS: Record<string, string> = {
  Acre: 'https://upload.wikimedia.org/wikipedia/commons/4/4c/Bandeira_do_Acre.svg',
  Alagoas: 'https://upload.wikimedia.org/wikipedia/commons/8/88/Bandeira_de_Alagoas.svg',
  Amapá: 'https://upload.wikimedia.org/wikipedia/commons/0/0c/Bandeira_do_Amap%C3%A1.svg',
  Amazonas: 'https://upload.wikimedia.org/wikipedia/commons/6/6b/Bandeira_do_Amazonas.svg',
  Bahia: 'https://upload.wikimedia.org/wikipedia/commons/2/28/Bandeira_da_Bahia.svg',
  Ceará: 'https://upload.wikimedia.org/wikipedia/commons/2/2e/Bandeira_do_Cear%C3%A1.svg',
  'Espírito Santo':
    'https://upload.wikimedia.org/wikipedia/commons/4/43/Bandeira_do_Esp%C3%ADrito_Santo.svg',
  Goiás: 'https://upload.wikimedia.org/wikipedia/commons/b/be/Flag_of_Goi%C3%A1s.svg',
  Maranhão: 'https://upload.wikimedia.org/wikipedia/commons/4/45/Bandeira_do_Maranh%C3%A3o.svg',
  'Mato Grosso':
    'https://upload.wikimedia.org/wikipedia/commons/0/0b/Bandeira_de_Mato_Grosso.svg',
  'Mato Grosso do Sul':
    'https://upload.wikimedia.org/wikipedia/commons/6/64/Bandeira_de_Mato_Grosso_do_Sul.svg',
  'Minas Gerais':
    'https://upload.wikimedia.org/wikipedia/commons/f/f4/Bandeira_de_Minas_Gerais.svg',
  Paraná: 'https://upload.wikimedia.org/wikipedia/commons/9/93/Bandeira_do_Paran%C3%A1.svg',
  Paraíba: 'https://upload.wikimedia.org/wikipedia/commons/b/bb/Bandeira_da_Para%C3%ADba.svg',
  Pará: 'https://upload.wikimedia.org/wikipedia/commons/0/02/Bandeira_do_Par%C3%A1.svg',
  Pernambuco: 'https://upload.wikimedia.org/wikipedia/commons/5/59/Bandeira_de_Pernambuco.svg',
  Piauí: 'https://upload.wikimedia.org/wikipedia/commons/3/33/Bandeira_do_Piau%C3%AD.svg',
  'Rio Grande do Norte':
    'https://upload.wikimedia.org/wikipedia/commons/3/30/Bandeira_do_Rio_Grande_do_Norte.svg',
  'Rio Grande do Sul':
    'https://upload.wikimedia.org/wikipedia/commons/6/63/Bandeira_do_Rio_Grande_do_Sul.svg',
  'Rio de Janeiro':
    'https://upload.wikimedia.org/wikipedia/commons/7/73/Bandeira_do_estado_do_Rio_de_Janeiro.svg',
  Rondônia: 'https://upload.wikimedia.org/wikipedia/commons/f/fa/Bandeira_de_Rond%C3%B4nia.svg',
  Roraima: 'https://upload.wikimedia.org/wikipedia/commons/9/98/Bandeira_de_Roraima.svg',
  'Santa Catarina':
    'https://upload.wikimedia.org/wikipedia/commons/1/1a/Bandeira_de_Santa_Catarina.svg',
  Sergipe: 'https://upload.wikimedia.org/wikipedia/commons/b/be/Bandeira_de_Sergipe.svg',
  'São Paulo':
    'https://upload.wikimedia.org/wikipedia/commons/2/2b/Bandeira_do_estado_de_S%C3%A3o_Paulo.svg',
  Tocantins: 'https://upload.wikimedia.org/wikipedia/commons/f/ff/Bandeira_do_Tocantins.svg',
}

export const brazilStateFlagUrl = (stateName: string): string | undefined =>
  FLAG_URLS[stateName]
