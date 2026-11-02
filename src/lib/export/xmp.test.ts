// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { freshSidecar, mergeSidecar, sidecarName } from './xmp'

const lightroom = (label: string) => `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    xmp:Rating="1"
    crs:Exposure2012="+0.35">
   <xmp:Label>${label}</xmp:Label>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`

describe('XMP sidecars', () => {
  it('names sidecars the way Lightroom and Capture One expect', () => {
    expect(sidecarName('IMG_0042.CR3')).toBe('IMG_0042.xmp')
    expect(sidecarName('DSC09812.ARW')).toBe('DSC09812.xmp')
  })

  it('writes a fresh sidecar with rating and label', () => {
    const xml = freshSidecar({ rating: 3, label: 'Red' })
    expect(xml).toContain('xmp:Rating="3"')
    expect(xml).toContain('xmp:Label="Red"')
    const doc = new DOMParser().parseFromString(xml.replace(/<\?xpacket[^>]*\?>/g, ''), 'application/xml')
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
  })

  it('updates the rating but keeps develop settings and a person’s own label', () => {
    const merged = mergeSidecar(lightroom('Blue'), { rating: 4, clearLabelIf: 'Red' })!
    expect(merged).toContain('xmp:Rating="4"')
    expect(merged).toContain('crs:Exposure2012="+0.35"')
    expect(merged).toContain('Blue')
  })

  it('clears only the red label Keeper wrote for rejects', () => {
    const merged = mergeSidecar(lightroom('Red'), { rating: 4, clearLabelIf: 'Red' })!
    expect(merged).not.toContain('Red')
    expect(merged).toContain('xmp:Rating="4"')
  })

  it('marks a reject with a red label', () => {
    const merged = mergeSidecar(lightroom('Blue'), { rating: 0, label: 'Red' })!
    expect(merged).toContain('xmp:Label="Red"')
    expect(merged).not.toContain('Blue')
  })

  it('leaves files it cannot parse alone', () => {
    expect(mergeSidecar('this is not xml <', { rating: 2 })).toBeNull()
    expect(mergeSidecar('<a><b/></a>', { rating: 2 })).toBeNull()
  })
})
