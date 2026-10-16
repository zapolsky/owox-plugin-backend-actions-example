import { initWasm, Resvg } from '@resvg/resvg-wasm'
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm'
import regular from '../vendor/fonts/Roboto-Regular.ttf'
import medium from '../vendor/fonts/Roboto-Medium.ttf'

let ready: Promise<void> | undefined

/** An SVG drawn as a PNG at twice its size, so it stays sharp in a Doc. A Worker has no fonts of its own. */
export async function png(svg: string): Promise<Uint8Array> {
  await (ready ??= initWasm(resvgWasm))
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: 2 },
    font: { fontBuffers: [new Uint8Array(regular), new Uint8Array(medium)], defaultFontFamily: 'Roboto', loadSystemFonts: false },
  })
  return resvg.render().asPng()
}
