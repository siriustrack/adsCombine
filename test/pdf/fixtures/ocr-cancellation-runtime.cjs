const assert = require('node:assert/strict')
const { once } = require('node:events')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

if (process.argv[2] === '--child') {
	const socket = net.connect(process.argv[3])
	socket.on('connect', () => socket.write(JSON.stringify({
		pid: process.pid,
		file: path.basename(process.argv.slice(4).find(value => value.endsWith('.pdf'))),
	})))
	socket.on('data', () => socket.write('alive'))
	socket.on('end', () => process.exit(0))
} else {
	; (async () => {
		const { OcrProcessPool } = require('../../../src/lib/ocr-process-pool.ts')
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-cancel-'))
		const socketPath = path.join(directory, 'child.sock')
		const server = net.createServer()
		const guard = AbortSignal.timeout(10_000)
		const previousPath = process.env.PATH
		const previousLogs = process.env.PDF_WORKER_LOGS
		process.env.PATH = `${directory}:${previousPath}`
		process.env.PDF_WORKER_LOGS = 'false'
		fs.writeFileSync(path.join(directory, 'pdftoppm'),
			`#!/bin/sh\nexec "${process.execPath}" "${__filename}" --child "${socketPath}" "$@"\n`,
			{ mode: 0o700 })
		const pool = new OcrProcessPool(
			path.resolve(__dirname, '../../../src/core/services/messages/pdfChunkWorker.js'), 2
		)
		const peers = new Map()
		let resolveConnections
		const connected = new Promise((resolve, reject) => {
			resolveConnections = resolve
			guard.addEventListener('abort', () => reject(guard.reason), { once: true })
		})
		server.on('connection', socket => {
			socket.once('data', bytes => {
				const hello = JSON.parse(bytes.toString())
				peers.set(hello.file, { socket, pid: hello.pid })
				if (peers.size === 2) resolveConnections()
			})
		})
		const controller = new AbortController()
		const siblingController = new AbortController()
		try {
			server.listen(socketPath)
			await once(server, 'listening', { signal: guard })
			const payload = file => ({
				pdfPath: path.join(directory, file), pageRange: { first: 1, last: 1 },
				fileId: file, totalPages: 1,
			})
			const task = pool.run(payload('cancelled.pdf'), { signal: controller.signal })
			const rejected = assert.rejects(task, { name: 'AbortError' })
			const sibling = pool.run(payload('independent.pdf'), { signal: siblingController.signal })
			await connected
			const queued = pool.run(payload('queued.pdf'), { signal: controller.signal })
			const queuedRejected = assert.rejects(queued, { name: 'AbortError' })
			const cancelled = peers.get('cancelled.pdf')
			const independent = peers.get('independent.pdf')
			// Subscribe to actual pipe closure before requesting cancellation.
			const closed = once(cancelled.socket, 'close', { signal: guard })
			controller.abort()
			await Promise.all([rejected, queuedRejected, closed])
			assert.equal(cancelled.socket.destroyed, true)
			assert.equal(peers.has('queued.pdf'), false)
			const response = once(independent.socket, 'data', { signal: guard })
			independent.socket.write('probe')
			assert.equal((await response)[0].toString(), 'alive')
			independent.socket.end()
			assert.equal(await sibling, '')
			console.log(JSON.stringify({
				cancelled: true, queuedCancelled: true, isolated: true, subprocessSurvived: false,
			}))
		} finally {
			controller.abort()
			siblingController.abort()
			for (const { socket } of peers.values()) socket.destroy()
			server.close()
			process.env.PATH = previousPath
			if (previousLogs === undefined) delete process.env.PDF_WORKER_LOGS
			else process.env.PDF_WORKER_LOGS = previousLogs
			fs.rmSync(directory, { recursive: true, force: true })
		}
	})().catch(error => { console.error(error); process.exitCode = 1 })
}
