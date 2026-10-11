import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { deflateSync } from 'node:zlib'

const execFileAsync = promisify(execFile)

// Synthetic calibration text, not a customer document or a legal accuracy oracle.
export const scanLines = [
  'DOCUMENTO SINTETICO PARA TESTE',
  'O arquivo apresenta palavras claras.',
  'Cada linha possui texto horizontal.',
  'A leitura deve preservar os dados.',
  'Este exemplo verifica imagens locais.',
  'Nenhum dado pertence a uma pessoa.',
  'O processo utiliza somente ferramentas.',
  'A pagina termina com palavras simples.',
] as const

export async function createRotatedScanPdf() {
  const objects: Buffer[] = []
  const add = (value: string | Buffer) => {
    objects.push(Buffer.isBuffer(value) ? value : Buffer.from(value))
  }
  add('<< /Type /Catalog /Pages 2 0 R >>')
  add('<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>')
  for (const [index, angle] of [-90, 0].entries()) {
    const { stdout } = await execFileAsync(
      'magick',
      [
        '-size',
        '1000x1000',
        'xc:white',
        '-font',
        'DejaVu-Sans',
        '-pointsize',
        '28',
        '-fill',
        'black',
        '-interline-spacing',
        '12',
        '-annotate',
        '+70+100',
        scanLines.join('\n'),
        '-rotate',
        String(angle),
        '+repage',
        '-colorspace',
        'Gray',
        '-depth',
        '8',
        'gray:-',
      ],
      { encoding: 'buffer', timeout: 30_000, maxBuffer: 2_000_000 }
    )
    if (stdout.length !== 1_000_000) {
      throw new Error(`Expected a 1000x1000 grayscale raster, received ${stdout.length} bytes`)
    }
    const pageId = 3 + index * 3
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 240] /Rotate 0 /Resources << /XObject << /Scan ${pageId + 2} 0 R >> >> /Contents ${pageId + 1} 0 R >>`
    )
    const content = 'q 240 0 0 240 0 0 cm /Scan Do Q\n'
    add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`)
    const image = deflateSync(stdout)
    add(
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width 1000 /Height 1000 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.length} >>\nstream\n`
        ),
        image,
        Buffer.from('\nendstream'),
      ])
    )
  }
  const chunks = [Buffer.from('%PDF-1.4\n')]
  const offsets = [0]
  let length = chunks[0].length
  for (const [index, object] of objects.entries()) {
    offsets.push(length)
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from('\nendobj\n'),
    ])
    chunks.push(chunk)
    length += chunk.length
  }
  chunks.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
        offsets
          .slice(1)
          .map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`)
          .join('') +
        `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`
    )
  )
  return Buffer.concat(chunks)
}
