import { createBackend } from '@owox/plugin-sdk/server'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export default createBackend({
  actions: {
    'list-data-marts': async (_input, ctx) => {
      const dataMarts = await ctx.owox.dataMarts.list()
      return dataMarts.map(dataMart => dataMart.title)
    },

    // Runs longer than one poll, so the page waits across several of them.
    'slow-count': async (_input, ctx) => {
      let count = 0
      while (count < 120) {
        ctx.signal.throwIfAborted()
        await sleep(1000)
        count += 1
      }
      return { count }
    },

    fail: async () => {
      throw Object.assign(new Error('This action fails on purpose'), { code: 'DEMO_FAILURE' })
    },

    'read-rows': async (input, ctx) => {
      const { dataMartId } = input as { dataMartId: string }
      const data = await ctx.owox.dataMarts.traverseData(dataMartId, { limit: 10 })
      const rows: Record<string, unknown>[] = []
      for await (const chunk of data.rowChunks()) rows.push(...chunk)
      return { runId: data.runId ?? null, rows: rows.slice(0, 10) }
    },
  },
})
