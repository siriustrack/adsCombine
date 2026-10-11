import fs from 'node:fs/promises'
import path from 'node:path'
import { env } from '@config/env'
import { TEXTS_DIR } from 'config/dirs'
import express, { type NextFunction, type Request, type Response } from 'express'
import { verifySignedTextDownload } from '../../core/services/texts/signed-text-download'

const textsRouter = express.Router()

async function getSafeArtifactPath(conversationId: string, filename: string): Promise<string> {
  const root = await fs.realpath(TEXTS_DIR)
  const candidate = path.join(root, conversationId, filename)
  const [resolved, stat] = await Promise.all([fs.realpath(candidate), fs.lstat(candidate)])
  const relative = path.relative(root, resolved)
  if (
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    stat.isSymbolicLink() ||
    !stat.isFile()
  ) {
    throw new Error('Unsafe text artifact')
  }
  return resolved
}

async function downloadText(req: Request, res: Response, next: NextFunction) {
  const verification = verifySignedTextDownload({
    baseUrl: env.BASE_URL,
    secret: env.TEXTS_SIGNING_SECRET,
    token: env.TOKEN,
    ttlSeconds: env.TEXTS_URL_TTL_SECONDS,
    method: req.method,
    requestTarget: req.originalUrl,
  })
  if (!verification.authorized) {
    const status = verification.reason === 'invalid_path' ? 400 : 403
    return res.status(status).json({ error: 'Invalid or expired download link' })
  }

  try {
    const filePath = await getSafeArtifactPath(
      verification.artifact.conversationId,
      verification.artifact.filename
    )
    res.set({
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${verification.artifact.filename}"`,
      'Content-Type': 'text/plain; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    })
    return res.sendFile(filePath, error => {
      if (error) next(error)
    })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Text artifact not found' })
    }
    return next(error)
  }
}

/**
 * @openapi
 * /texts/{conversationId}/{filename}:
 *   parameters:
 *     - in: path
 *       name: conversationId
 *       required: true
 *       schema: { type: string, pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' }
 *     - in: path
 *       name: filename
 *       required: true
 *       schema: { type: string, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*\.txt$' }
 *     - in: query
 *       name: v
 *       required: true
 *       schema: { type: string, enum: ['1'] }
 *     - in: query
 *       name: exp
 *       required: true
 *       schema: { type: integer, minimum: 1 }
 *     - in: query
 *       name: sig
 *       required: true
 *       schema: { type: string, pattern: '^[A-Za-z0-9_-]{43}$' }
 *   get:
 *     tags: [Textos]
 *     summary: Baixa texto com assinatura e validade verificadas
 *     description: A URL completa é a credencial. Obtenha uma nova URL pelo resultado autenticado do job quando expirar.
 *     security: []
 *     responses:
 *       200:
 *         description: Texto completo; cache desabilitado.
 *         headers:
 *           Cache-Control:
 *             schema: { type: string, enum: [no-store] }
 *         content:
 *           text/plain:
 *             schema: { type: string }
 *       400: { description: Caminho inválido }
 *       403: { description: Assinatura ausente, inválida ou expirada }
 *       404: { description: Artefato não encontrado }
 *   head:
 *     tags: [Textos]
 *     summary: Verifica o download assinado sem retornar o corpo
 *     security: []
 *     responses:
 *       200: { description: Cabeçalhos do artefato autorizado }
 *       400: { description: Caminho inválido }
 *       403: { description: Assinatura ausente, inválida ou expirada }
 *       404: { description: Artefato não encontrado }
 */
textsRouter.get('/:conversationId/:filename', downloadText)
textsRouter.all('/:conversationId/:filename', (_req, res) =>
  res.status(405).json({ error: 'Method not allowed' })
)

export default textsRouter
