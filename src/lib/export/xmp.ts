import { baseNameOf } from '../formats/detect'

/**
 * XMP sidecars carry star ratings and color labels to Lightroom Classic,
 * Lightroom, Capture One and Bridge. They are only read for RAW files;
 * JPEG and HEIC keep their metadata inside the file itself.
 */
export interface RatingTags {
  rating?: number
  /** Color label to set. Leave undefined to keep whatever label is there. */
  label?: string
  /** Remove the label only if it is this one (Keepers' own reject label), so people's labels survive. */
  clearLabelIf?: string
}

/** Byte order mark that XMP packets carry in their begin attribute. */
const BOM = String.fromCharCode(0xfeff)
const NS_X = 'adobe:ns:meta/'
const NS_RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const NS_XMP = 'http://ns.adobe.com/xap/1.0/'

export function sidecarName(rawName: string): string {
  return `${baseNameOf(rawName)}.xmp`
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

export function freshSidecar(tags: RatingTags): string {
  const attrs = [
    tags.rating !== undefined ? `\n    xmp:Rating="${tags.rating}"` : '',
    tags.label ? `\n    xmp:Label="${escapeAttr(tags.label)}"` : '',
  ].join('')
  return `<?xpacket begin="${BOM}" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="${NS_X}" x:xmptk="Keepers">
 <rdf:RDF xmlns:rdf="${NS_RDF}">
  <rdf:Description rdf:about=""
    xmlns:xmp="${NS_XMP}"${attrs}/>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>
`
}

/**
 * Updates rating and label in an existing sidecar without touching anything
 * else (develop settings, keywords, crops). Returns null if the file is not
 * XMP we understand, so the caller can leave it alone.
 */
export function mergeSidecar(existing: string, tags: RatingTags): string | null {
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(existing, 'application/xml')
  } catch {
    return null
  }
  if (doc.getElementsByTagName('parsererror').length) return null
  const descriptions = doc.getElementsByTagNameNS(NS_RDF, 'Description')
  if (!descriptions.length) return null
  const desc = descriptions[0]

  const set = (name: 'Rating' | 'Label', value: string | undefined) => {
    // Remove any element form first, then write the attribute form Lightroom uses.
    for (const el of Array.from(doc.getElementsByTagNameNS(NS_XMP, name))) el.parentNode?.removeChild(el)
    for (const d of Array.from(descriptions)) if (d !== desc) d.removeAttributeNS(NS_XMP, name)
    if (value === undefined) desc.removeAttributeNS(NS_XMP, name)
    else desc.setAttributeNS(NS_XMP, `xmp:${name}`, value)
  }
  if (tags.rating !== undefined) set('Rating', String(tags.rating))
  if (tags.label !== undefined) set('Label', tags.label || undefined)
  else if (tags.clearLabelIf) {
    const el = doc.getElementsByTagNameNS(NS_XMP, 'Label')[0]
    const current = desc.getAttributeNS(NS_XMP, 'Label') ?? el?.textContent?.trim()
    if (current === tags.clearLabelIf) set('Label', undefined)
  }

  const body = new XMLSerializer().serializeToString(doc)
  // XMLSerializer drops the XML declaration only if there was none; keep packet wrappers intact.
  return body.endsWith('\n') ? body : `${body}\n`
}
