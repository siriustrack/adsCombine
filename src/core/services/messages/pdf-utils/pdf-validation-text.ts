/** Recognizes only standalone verification furniture, never strips source text. */
export function isValidationOnlyText(text: string): boolean {
  const lines = text
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return false
  // Match complete known forms: an unknown suffix may be documentary content.
  const signature =
    /^documento assinado digitalmente(?: por [\p{L}\p{M}\d][\p{L}\p{M}\d '-]{0,119} em \d{2}\/\d{2}\/\d{4})?\.?$/iu
  const instruction =
    /^(?:valide este documento|confira os dados do ato) em https?:\/\/(?:assinador-web|registradores)\.onr\.org\.br\/\S+$/iu
  const seal = /^selo digital de fiscalização [a-z\d-]+\.?$/iu
  const verification = (line: string): boolean =>
    signature.test(line) || instruction.test(line) || seal.test(line)
  const pageNumber = /^página\s+\d+\s+de\s+\d+\.?$/iu
  const verificationUrl = /^https?:\/\/(?:assinador-web|registradores)\.onr\.org\.br\/\S*$/iu
  return (
    lines.some(verification) &&
    lines.every(line => verification(line) || pageNumber.test(line) || verificationUrl.test(line))
  )
}

export class PdfValidationOnlyTextError extends Error {
  readonly code = 'PDF_VALIDATION_ONLY_TEXT'

  constructor() {
    super('PDF contém somente texto de validação; o conteúdo documental não foi recuperado.')
    this.name = 'PdfValidationOnlyTextError'
  }
}
