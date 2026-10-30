type RegistryActText = {
  readonly key: string
  readonly start: number
  readonly end: number
  readonly text: string
}

function registryActs(text: string): RegistryActText[] {
  const headings = [...text.matchAll(/^[\t ]*(AV|R)[\t ]*[.-][\t ]*(\d{1,4})\b/gimu)]
  return headings.map((heading, index) => {
    const start = heading.index
    const end = headings[index + 1]?.index ?? text.length
    return {
      key: `${heading[1]?.toUpperCase()}.${Number(heading[2])}`,
      start,
      end,
      text: text.slice(start, end),
    }
  })
}

/** Missing acquisition verbs are reading gaps, never proof of a reversed transfer. */
export function unreadAcquisitionClauses(text: string): RegistryActText[] {
  return registryActs(text).filter(act => {
    const purchase = /\bpor\s+compra\s+feita[\s-]+[aà](?=\s|$)/iu.exec(act.text)
    return purchase !== null && !/\badquir(?:iu|iram)\b/iu.test(act.text.slice(0, purchase.index))
  })
}

/** Returns an observed complete introductory clause, without inventing party roles. */
export function acquisitionClauseFromBaseImage(text: string, actKey: string): string | undefined {
  const matches = registryActs(text).filter(act => act.key === actKey)
  if (matches.length !== 1) return undefined
  const act = matches[0]
  if (!act) return undefined
  const headingEnd = act.text.indexOf('\n')
  const price = /\bpelo\s+pre[cç]o\b/iu.exec(act.text)
  if (headingEnd < 0 || !price || price.index <= headingEnd || price.index > 1800) {
    return undefined
  }
  const clause = act.text.slice(headingEnd + 1, price.index).trim()
  return /\badquir(?:iu|iram)\s+o\s+im[oó]vel\s+por\s+compra\s+feita[\s-]+[aà](?=\s|$)/iu.test(
    clause
  )
    ? clause
    : undefined
}
