// Wrangler bundles these as modules: WebAssembly as a compiled module, fonts as bytes (see wrangler.toml).
declare module '*.wasm' {
  const module: WebAssembly.Module
  export default module
}

declare module '*.ttf' {
  const bytes: ArrayBuffer
  export default bytes
}
