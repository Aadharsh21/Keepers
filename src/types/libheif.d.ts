// Minimal types for the parts of libheif-js that Keeper uses (HEIC fallback decoder).
declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  export interface HeifImage {
    get_width(): number
    get_height(): number
    display(target: ImageData, callback: (result: ImageData | null) => void): void
    free?(): void
  }
  export interface HeifDecoderInstance {
    decode(buffer: Uint8Array): HeifImage[]
  }
  export interface LibHeif {
    HeifDecoder: new () => HeifDecoderInstance
  }
  const factory: (options?: Record<string, unknown>) => LibHeif
  export default factory
}
