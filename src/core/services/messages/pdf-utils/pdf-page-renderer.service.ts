import { execFile as execFileCb } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import tmp from 'tmp'
import type { PdfPageRenderer, RenderedPdfPage } from './visual-fallback.types'

export class PdfPageRendererService implements PdfPageRenderer {
  private readonly execFile = promisify(execFileCb)

  async renderPages(
    buffer: Buffer,
    pageNumbers: number[],
    signal?: AbortSignal
  ): Promise<RenderedPdfPage[]> {
    const selectedPages = [...new Set(pageNumbers)].sort((left, right) => left - right)
    if (selectedPages.length === 0) return []
    if (signal?.aborted) throw signal.reason ?? new Error('PDF page rendering aborted')

    const tempPdf = tmp.fileSync({ postfix: '.pdf' })
    const tempDir = tmp.dirSync({ unsafeCleanup: true })

    try {
      await fs.promises.writeFile(tempPdf.name, buffer, { signal })
      const pages: RenderedPdfPage[] = []
      for (const pageNumber of selectedPages) {
        if (signal?.aborted) throw signal.reason ?? new Error('PDF page rendering aborted')
        const outputPrefix = path.join(tempDir.name, `page-${pageNumber}`)
        await this.execFile(
          'pdftoppm',
          [
            '-png',
            '-r',
            '200',
            '-f',
            String(pageNumber),
            '-l',
            String(pageNumber),
            '-singlefile',
            tempPdf.name,
            outputPrefix,
          ],
          { timeout: 30_000, signal }
        )
        if (signal?.aborted) throw signal.reason ?? new Error('PDF page rendering aborted')
        pages.push({ pageNumber, image: await fs.promises.readFile(`${outputPrefix}.png`) })
      }
      return pages
    } finally {
      tempPdf.removeCallback()
      tempDir.removeCallback()
    }
  }
}
